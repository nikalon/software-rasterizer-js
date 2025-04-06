let log_output;
let viewer;
let input_file;

let ctx;
let canvas_width;
let canvas_height;
let image_data;
let mesh;

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

    multScalar(scalar) {
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
    constructor(vertices, triangles) {
        // Plain array of tries of floating point values
        this.vertices = vertices;

        // Plain array of tries of indices into this.vertices array
        this.triangles = triangles;
    }

    getTriangleVerticesAt(triangle_index, out_vec_a, out_vec_b, out_vec_c) {
        this._getVertexAt(triangle_index, out_vec_a);
        this._getVertexAt(triangle_index + 1, out_vec_b);
        this._getVertexAt(triangle_index + 2, out_vec_c);
    }

    _getVertexAt(triangle_index, out_vec3) {
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

        // Array of messages produced during the parsing stage. They could be warnings or errors. In either way the parser
        // tries to parse the mesh as much as it can.
        this.messages = [];

        this.ok = true; // Boolean that indicates that the parse was successful, even if there's warnings
    }

    addMessage(str) {
        this.messages.push(str);
    }

    createMesh(vertices, triangles) {
        this.mesh = new Mesh(vertices, triangles);
    }

    setParseError() {
        this.ok = false;
    }
}

function parse_obj_string(str) {
    // References used for the parser:
    // - https://en.wikipedia.org/wiki/Wavefront_.obj_file
    // @TODO: Read vertex colors

    let vertices = [];
    let triangles = [];
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
                        parse_result.addMessage(`Geometric vertex: it contains less than 3 coordinates`);
                        parse_result.setParseError();
                        continue;
                    }

                    if (line.length > 5) {
                        parse_result.addMessage(`Geometric vertex: it contains more than 4 coordinates`);
                        parse_result.setParseError();
                        continue;
                    }

                    // @NOTE: We ignore w coordinate and assume it's just 1.0
                    let x = Number.parseFloat(line[1]);
                    vertices.push(x);

                    let y = Number.parseFloat(line[2]);
                    vertices.push(y);

                    let z = Number.parseFloat(line[3]);
                    vertices.push(z);
                } break;

                case 'f': {
                    // Polygonal face element
                    // @TODO: We can only parse triangles. Any other polygon is not supported, and if found this mesh
                    // will not be imported.
                    if (line.length < 4) {
                        parse_result.addMessage(`Polygonal face: it contains less than 3 indices`);
                        parse_result.setParseError();
                        continue;
                    }

                    if (line.length > 4) {
                        parse_result.addMessage(`Polygonal face: can't import polygon of ${line.length - 1} vertices. We can only import triangles.`);
                        parse_result.setParseError();
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
                    parse_result.addMessage(`Warning: unknown element "${line[0]}" at "${unparsed_line}"`);
                } break;
            }
        }
    }

    if (parse_result.ok) {
        // Only create the mesh if it's correct. We don't want to import a wrongly imported mesh.
        parse_result.createMesh(vertices, triangles);
        parse_result.addMessage(`Imported ${vertices.length / 3} vertices and ${triangles.length / 3} triangles.`);
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
// 146 verts
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
    if (cam_a.z == 0) {
        vp_x = vp_y = 0;
    }
    let p_a = new Vec2(vp_x, vp_y);

    // Transform to Normalized Device Coordinates
    let ndc_a = new Vec2((p_a.x + camera.canvas_right) / camera.canvas_width, (camera.canvas_top - p_a.y) / camera.canvas_height);

    // Transform to raster coordinates
    let ras_a = new Vec2(ndc_a.x * canvas_width, ndc_a.y * canvas_height);

    // @TODO: Check vertex is drawable

    return ras_a;
}

function render_line(vec_a, vec_b) {
    ctx.beginPath();
    ctx.lineTo(vec_a.x, vec_a.y);
    ctx.lineTo(vec_b.x, vec_b.y);
    ctx.stroke();
}

function lerp(a, b, t) {
    // Linearly interpolate t value between a and b
    let res = a * (1 - t) + b * t;
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

function frame() {
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

    // Vertices for triangle. Counter-clockwise winding.
    let v0 = new Vec3(600, 380, 0);
    let v1 = new Vec3(70,  30,  0);
    let v2 = new Vec3(50,  400, 0);

    // Colors for every vertex in triangle
    let c0 = new Vec3(255, 0,   0);
    let c1 = new Vec3(0,   255, 0);
    let c2 = new Vec3(0,   0,   255);

    let triangle_area_doubled = edge(v0, v1, v2);

    for (let x = 0; x < canvas_width; x++) {
    for (let y = 0; y < canvas_height; y++) {
            let p = new Vec2(x, y);

            let w0 = edge(v1, v2, p);
            let w1 = edge(v2, v0, p);
            let w2 = edge(v0, v1, p);

            if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
                // This pixel overlaps the triangle. Draw a color for this pixel.
                w0 /= triangle_area_doubled;
                w1 /= triangle_area_doubled;
                w2 /= triangle_area_doubled;

                let color_1 = c0.multScalar(w0);
                let color_2 = c1.multScalar(w1);
                let color_3 = c2.multScalar(w2);
                let color = color_1.add(color_2.add(color_3));

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

    // Render scene
    ctx.putImageData(image_data, 0, 0);
    //window.requestAnimationFrame(frame);
}

window.onload = () => {
    log_output = document.getElementById("logoutput");
    viewer = document.getElementById("viewer");
    input_file = document.getElementById("inputfile");

    const handle_attach_file = () => {
        if (input_file.files.length > 0) {
            let file = input_file.files[0];
            let reader = new FileReader();
            reader.onload = function(e) {
                let file_content = e.target.result;
                mesh = parse_obj_string_and_display_messages(file_content);
                window.requestAnimationFrame(frame);
            };
            reader.readAsText(file);
        }
    };
    input_file.addEventListener("change", handle_attach_file, false);

    ctx = viewer.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    canvas_width = viewer.width;
    canvas_height = viewer.height;
    image_data = ctx.createImageData(canvas_width, canvas_height);

    frame();
    //window.requestAnimationFrame(frame);
}
