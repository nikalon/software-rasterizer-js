let log_output;
let viewer;
let input_file;
let remove_model_button;
let fps_counter;

let ctx;
let canvas_width;
let canvas_height;
let depth_buffer;
let image_data;
let mesh;
const fps_smoothing = 0.9; // larger = more smoothing
let fps_smoothed = 0;

const MM_PER_INCH = 25.4;

// ====================================================================================================================
// Camera
class Camera {
    constructor(focal_length_mm, film_aperture_width_inches, film_aperture_height_inches, near_clip_dist, resolution_width, resolution_height) {
        this.focal_length_mm = focal_length_mm;
        this.cam_aperture_width_mm = film_aperture_width_inches*MM_PER_INCH;
        this.cam_aperture_height_mm = film_aperture_height_inches*MM_PER_INCH;
        this.near_clip_plane_distance = near_clip_dist;
        this.resolution_width = resolution_width;
        this.resolution_height = resolution_height;

        // Calculate canvas dimensions
        let film_gate_ratio = this.cam_aperture_width_mm / this.cam_aperture_height_mm;

        this.canvas_top = this.cam_aperture_height_mm / 2 / this.focal_length_mm * this.near_clip_plane_distance;
        this.canvas_height = this.canvas_top * 2;

        this.canvas_right = this.canvas_top * film_gate_ratio;
        this.canvas_width = this.canvas_right * 2;
    }
}

// ====================================================================================================================
// 4x4 Matrix
class Mat44 {
    constructor(x1 = 0, x2 = 0, x3 = 0, x4 = 0, y1 = 0, y2 = 0, y3 = 0, y4 = 0, z1 = 0, z2 = 0, z3 = 0, z4 = 0, w1 = 0, w2 = 0, w3 = 0, w4 = 0) {
        this.elems = [x1, x2, x3, x4, y1, y2, y3, y4, z1, z2, z3, z4, w1, w2, w3, w4];
    }

    multPoint(vec3) {
        let x1 = this.elems[0]  * vec3.x;
        let x2 = this.elems[4]  * vec3.y;
        let x3 = this.elems[8]  * vec3.z;
        let x4 = this.elems[12];
        let x = x1 + x2 + x3 + x4;

        let y1 = this.elems[1]  * vec3.x;
        let y2 = this.elems[5]  * vec3.y;
        let y3 = this.elems[9]  * vec3.z;
        let y4 = this.elems[13];
        let y = y1 + y2 + y3 + y4;

        let z1 = this.elems[2]  * vec3.x;
        let z2 = this.elems[6]  * vec3.y;
        let z3 = this.elems[10] * vec3.z;
        let z4 = this.elems[14];
        let z = z1 + z2 + z3 + z4;

        let out = new Vec3(x, y, z);
        return out;
    }
}

// ====================================================================================================================
// Vector of 2 components
class Vec2 {
    constructor(x = 0, y = 0) {
        if (Array.isArray(x)) {
            this.x = x[0];
            this.y = x[1];
        } else {
            this.x = x;
            this.y = y;
        }
    }
}

// ====================================================================================================================
// Vector of 3 components
class Vec3 {
    constructor(x = 0, y = 0, z = 0) {
        if (Array.isArray(x)) {
            this.x = x[0];
            this.y = x[1];
            this.z = x[2];
        } else {
            this.x = x;
            this.y = y;
            this.z = z;
        }
    }

    add(vec) {
        let res = new Vec3(this.x, this.y, this.z);
        res.x += vec.x;
        res.y += vec.y;
        res.z += vec.z;

        return res;
    }

    mult_scalar(scalar) {
        let res = new Vec3(this.x, this.y, this.z);
        res.x *= scalar;
        res.y *= scalar;
        res.z *= scalar;

        return res;
    }
}

// ====================================================================================================================
// Mesh
class Mesh {
    constructor(vertices, triangles, vertex_colors) {
        // Plain array of tries of floating point values
        this.vertices = vertices;

        // Plain array of tries of indices into this.vertices array
        this.triangles = triangles;

        // Plain array of tries of RGB colors. Same length as this.vertices
        if (vertex_colors == null) {
            this.vertex_colors = new Array(this.vertices.length);
            for (let i = 0; i < this.vertex_colors.length; i++) {
                this.vertex_colors[i] = 255;
            }
        } else {
            console.assert(vertices.length === vertex_colors.length);
            this.vertex_colors = vertex_colors
        }
    }

    get_triangle_vertices_at(triangle_index, out_vec_a, out_vec_b, out_vec_c) {
        this._get_vertex_at(triangle_index, out_vec_a);
        this._get_vertex_at(triangle_index + 1, out_vec_b);
        this._get_vertex_at(triangle_index + 2, out_vec_c);
    }

    get_vertex_colors_at(triangle_index, out_vec) {
        let vert_i = this.triangles[triangle_index];

        let r = this.vertex_colors[vert_i * 3];
        let g = this.vertex_colors[vert_i * 3 + 1];
        let b = this.vertex_colors[vert_i * 3 + 2];

        out_vec.x = r;
        out_vec.y = g;
        out_vec.z = b;
    }

    _get_vertex_at(triangle_index, out_vec3) {
        let vert_i = this.triangles[triangle_index];

        let x = this.vertices[vert_i * 3];
        let y = this.vertices[vert_i * 3 + 1];
        let z = this.vertices[vert_i * 3 + 2];

        out_vec3.x = x;
        out_vec3.y = y;
        out_vec3.z = z;
    }
}

// ====================================================================================================================
// OJB Parser
class OBJParseResult {
    constructor() {
        this.mesh = null;
        this.ok = true;

        // Array of messages produced during the parsing stage
        this.messages = [];
    }

    add_info_message(str) {
        this.messages.push(str);
    }

    add_error_message(str) {
        this.messages.push(str);
        this.ok = false;
    }

    create_mesh(vertices, triangles, vertex_colors) {
        this.mesh = new Mesh(vertices, triangles, vertex_colors);
    }
}

function parse_obj_string(str) {
    // References used for the parser:
    // - https://en.wikipedia.org/wiki/Wavefront_.obj_file
    // @TODO: Read vertex colors

    let vertices = [];
    let triangles = [];
    let vertex_color_count = 0;
    let vertex_colors = [];
    let parse_result = new OBJParseResult();

    str.replaceAll('\r', '');
    let lines = str.split('\n');
    for (let unparsed_line of lines) {
        if (!parse_result.ok) break;

        let line = unparsed_line.trim().split(' ');
        if (line.length > 0) {
            switch(line[0]) {
                case '':         // Empty line. Ignored.
                case '#': break; // This is a comment. Ignored

                case 'v': {
                    // Geometrix vertex
                    if (line.length < 4) {
                        parse_result.add_error_message(`Geometric vertex: it contains less than 3 coordinates`);
                        continue;
                    }

                    let x = Number.parseFloat(line[1]);
                    vertices.push(x);

                    let y = Number.parseFloat(line[2]);
                    vertices.push(y);

                    let z = Number.parseFloat(line[3]);
                    vertices.push(z);

                    // @NOTE: We assume 4th, 5th and 6th coordinates are optional vertex colors
                    //let r = Math.round(255 * Math.random());
                    //let g = Math.round(255 * Math.random());
                    //let b = Math.round(255 * Math.random());
                    let r = 255;
                    let g = 255;
                    let b = 255;

                    let read_vertex_color = false;
                    if (line.length >= 5) {
                        r = Math.round(255 * Number.parseFloat(line[4]));
                        read_vertex_color = true;
                    }

                    if (line.length >= 6) {
                        g = Math.round(255 * Number.parseFloat(line[5]));
                        read_vertex_color = true;
                    }

                    if (line.length >= 7) {
                        b = Math.round(255 * Number.parseFloat(line[6]));
                        read_vertex_color = true;
                    }

                    // @NOTE: we ignore the rest of the arguments if there are any
                    vertex_colors.push(r);
                    vertex_colors.push(g);
                    vertex_colors.push(b);

                    if (read_vertex_color) {
                        vertex_color_count += 1;
                    }
                } break;

                case 'f': {
                    // Polygonal face element
                    // @TODO: We can only parse triangles. Any other polygon is not supported, and if found this mesh
                    // will not be imported.
                    if (line.length < 4) {
                        parse_result.add_error_message(`Polygonal face: it contains less than 3 indices`);
                        continue;
                    }

                    if (line.length > 4) {
                        parse_result.add_error_message(`Polygonal face: can't import polygon of ${line.length - 1} vertices. We can only import triangles.`);
                        continue;
                    }

                    for (let i = 0; i < 3; i++) {
                        let index = Number.parseInt(line[i+1], 10);

                        // In OBJ indices are 1-based. We adjust the correct index here.
                        index -= 1;

                        triangles.push(index);
                    }
                } break;

                default: {
                    parse_result.add_info_message(`Warning: unknown element "${line[0]}" at "${unparsed_line}"`);
                } break;
            }
        }
    }

    if (parse_result.ok) {
        // Only create the mesh if it's correct. We don't want to import a wrongly imported mesh.
        parse_result.create_mesh(vertices, triangles, vertex_colors);
        parse_result.add_info_message(`Imported ${vertices.length / 3} vertices, ${triangles.length / 3} triangles and ${vertex_color_count} vertex colors.`);
    }

    return parse_result;
}

function parse_obj_string_and_display_messages(str) {
    let parse_result = parse_obj_string(str);

    let messages = "";
    for (let msg of parse_result.messages) {
        messages += `<li>${msg}</li>`;
    }
    log_output.innerHTML = messages;

    if (parse_result.ok) {
        return parse_result.mesh;
    } else {
        return null;
    }
}

// ====================================================================================================================
// Main
let camera = new Camera(
    35,
    1.995,
    1.500,
    0.1,
    canvas_width,
    canvas_height
);

let worldToCamera = new Mat44(-0.954241, 0.086124, -0.286371,  0.000000,
                               0.000000, 0.957630,  0.288002,  0.000000,
                               0.299040, 0.274823, -0.913809,  0.000000,
                               0.668532, -3.076821,-16.194227, 1.000000);

function vertex_to_raster_space(vec, camera, worldToCamera) {
    // Transform world coordinates to camera space
    let cam_a = worldToCamera.multPoint(vec);

    // Screen coordinate system. Perspective divide.
    let vp_x = cam_a.x / -cam_a.z * camera.near_clip_plane_distance;
    let vp_y = cam_a.y / -cam_a.z * camera.near_clip_plane_distance;
    let vp_z = -cam_a.z;
    if (cam_a.z == 0) {
        vp_x = vp_y = 0;
    }
    let p_a = new Vec3(vp_x, vp_y, vp_z);

    // Transform to Normalized Device Coordinates
    let ndc_a = new Vec3(
        (p_a.x + camera.canvas_right) / camera.canvas_width,
        (camera.canvas_top - p_a.y) / camera.canvas_height,
        vp_z
    );

    // Transform to raster coordinates
    // @TODO: It doesn't make much sense to use Vec3 in raster space, but we need to return the depth coordinate to the caller.
    let ras_a = new Vec3(ndc_a.x * canvas_width, ndc_a.y * canvas_height, vp_z);

    return ras_a;
}

function lerp(a, b, t) {
    // Linearly interpolate t value between a and b
    //let res = a * (1 - t) + b * t;
    let res = a + (b-a)*t;
    return  res;
}

function inverse_lerp(a, b, x) {
    let res;
    if (a === b) {
        // Avoid division by zero
        res = 0;
    } else {
        res = (x - a) / (b - a);
    }

    return res;
}

function edge(a, b, c) {
    let res = (c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x);
    return res;
}

function clear_depth_buffer(depth_buffer) {
    for (let i = 0; i < depth_buffer.length; i++) {
        depth_buffer[i] = Number.POSITIVE_INFINITY;
    }
}

function frame() {
    let frame_start_time = performance.now();

    clear_depth_buffer(depth_buffer);

    // Clear canvas with background gradient
    let gradient_start = 80;
    let gradient_end = 0;
    for (let x = 0; x < canvas_width; x++) {
        for (let y = 0; y < canvas_height; y++) {
            let v = lerp(gradient_start, gradient_end, inverse_lerp(0, canvas_height, y));

            // R
            image_data.data[(canvas_width * y + x) * 4] = v;

            // G
            image_data.data[(canvas_width * y + x) * 4 + 1] = v;

            // B
            image_data.data[(canvas_width * y + x) * 4 + 2] = v;

            // A
            image_data.data[(canvas_width * y + x) * 4 + 3] = 255;
        }
    }

    // Render mesh
    if (mesh != null) {
        for (let i = 0; i < mesh.triangles.length; i += 3) {
            // Load vertices for this triangle
            let a = new Vec3();
            let b = new Vec3();
            let c = new Vec3();
            mesh.get_triangle_vertices_at(i, a, b, c);

            // Load vertex colors for this triangle
            let c0 = new Vec3();
            mesh.get_vertex_colors_at(i, c0);

            let c1 = new Vec3();
            mesh.get_vertex_colors_at(i + 1, c1);

            let c2 = new Vec3();
            mesh.get_vertex_colors_at(i + 2, c2);

            // Transform from local space coordinates to raster coordinates
            let r0 = vertex_to_raster_space(a, camera, worldToCamera);
            let r1 = vertex_to_raster_space(b, camera, worldToCamera);
            let r2 = vertex_to_raster_space(c, camera, worldToCamera);
            let triangle_area_doubled = edge(r0, r1, r2);

            // Render this triangle into the canvas
            let r_min_x = Math.floor(Math.min(r0.x, r1.x, r2.x));
            let r_max_x = Math.ceil (Math.max(r0.x, r1.x, r2.x));
            let r_min_y = Math.floor(Math.min(r0.y, r1.y, r2.y));
            let r_max_y = Math.ceil (Math.max(r0.y, r1.y, r2.y));
            for (let x = r_min_x; x < r_max_x; x++) {
                for (let y = r_min_y; y < r_max_y; y++) {
                    let p = new Vec2(x, y);

                    let w0 = edge(r1, r2, p);
                    let w1 = edge(r2, r0, p);
                    let w2 = edge(r0, r1, p);

                    if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
                        // This pixel overlaps the triangle

                        // Calculate barycentric coordinates for this point in the triangle.
                        w0 /= triangle_area_doubled;
                        w1 /= triangle_area_doubled;
                        w2 /= triangle_area_doubled;

                        // Depth buffer test
                        let point_z = 1/(w0*(1/r0.z) + w1*(1/r1.z) + w2*(1/r2.z));
                        let canvas_i = canvas_width * y + x;
                        if (point_z < depth_buffer[canvas_i]) {
                            // This point is closer to the camera. Render it.
                            depth_buffer[canvas_i] = point_z;

                            // Interpolate color for this pixel using barycentric coordinates
                            //let color_1 = c0.mult_scalar(w0);
                            //let color_2 = c1.mult_scalar(w1);
                            //let color_3 = c2.mult_scalar(w2);
                            let color_1 = c0.mult_scalar(w0).mult_scalar(1/r0.z);
                            let color_2 = c1.mult_scalar(w1).mult_scalar(1/r1.z);
                            let color_3 = c2.mult_scalar(w2).mult_scalar(1/r2.z);

                            let color = color_1.add(color_2.add(color_3));
                            color = color.mult_scalar(point_z);

                            // R
                            image_data.data[(canvas_width * y + x) * 4] = color.x;

                            // G
                            image_data.data[(canvas_width * y + x) * 4 + 1] = color.y;

                            // B
                            image_data.data[(canvas_width * y + x) * 4 + 2] = color.z;

                            // A
                            image_data.data[(canvas_width * y + x) * 4 + 3] = 255;
                        }
                    }
                }
            }
        }
    }

    // Render scene
    ctx.putImageData(image_data, 0, 0);

    // Print FPS
    let frame_end_time = performance.now();
    let frame_elapsed_time = frame_end_time - frame_start_time;
    let fps = Math.round(1/(frame_elapsed_time / 1000));
    fps_smoothed = (fps_smoothed * fps_smoothing) + (fps * (1.0 - fps_smoothing))
    fps_counter.innerText = `${Math.round(fps_smoothed)} FPS`;

    window.requestAnimationFrame(frame);
}

window.onload = () => {
    log_output = document.getElementById("logoutput");
    viewer = document.getElementById("viewer");
    input_file = document.getElementById("inputfile");
    remove_model_button = document.getElementById("removemodel");
    fps_counter = document.getElementById("fpscounter");

    const handle_attach_file = () => {
        if (input_file.files.length > 0) {
            let file = input_file.files[0];
            let reader = new FileReader();
            reader.onload = function(e) {
                let file_content = e.target.result;
                mesh = parse_obj_string_and_display_messages(file_content);
            };
            reader.readAsText(file);

            // Update UI
            input_file.disabled = true;
            remove_model_button.disabled = false;
        }
    };
    input_file.addEventListener("change", handle_attach_file, false);

    remove_model_button.addEventListener("click", () => {
        mesh = null;

        // Update UI
        input_file.value = null;
        log_output.innerHTML = null;
        input_file.disabled = false;
        remove_model_button.disabled = true;
    });

    ctx = viewer.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    canvas_width = viewer.width;
    canvas_height = viewer.height;

    depth_buffer = new Array(canvas_width * canvas_height);
    image_data = ctx.createImageData(canvas_width, canvas_height);

    window.requestAnimationFrame(frame);
}
