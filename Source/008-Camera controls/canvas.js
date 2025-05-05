const MM_PER_INCH = 25.4;
const PI2 = Math.PI * 2;
const PI_HALF = Math.PI / 2;

// UI
let log_output;
let viewer;
let input_file;
let remove_model_button;
let boat_button;
let cube_button;
let monkey_button;
let triangle_button;
let fps_counter;
let rotate_checkbox;

// Scene
let ctx;
let canvas_width;
let canvas_height;
let depth_buffer;
let image_data;

// Object
let mesh;
const angular_velocity = Math.PI; // Radians / Second
let rot_y_rad = 0;
let y_pos = 0;

const fps_smoothing = 0.9; // larger = more smoothing
let fps_smoothed = 0;

// Camera controls
let mouse_down = false;
let mouse_pos_x = 0;
let mouse_pos_y = 0;
let mouse_last_pos_x = 0;
let mouse_last_pos_y = 0;
let mouse_wheel_dir = 0;

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

        // ============================================================================================================
        // Orbit camera
        this.target_pos = new Vec3(0, 0, 0);
        this.target_dist = 15;
        this.target_min_dist = 3;
        this.orbit_v = 0.6; // Constrained in the range [-PI/2, PI/2]
        this.orbit_h = Math.PI; // Constrained in the range [0, 2PI)
    }

    get_projection_matrix() {
        // Rename variables for brevity in the mathematical formulas
        let aspect_ratio = this.resolution_width / this.resolution_height;
        let n = this.near_clip_plane_distance;
        let f = 100; // Far plane distance

        // Aspect ratio is applied automatically because we are basing our calculations on film gate, which has the correct
        // aspect ratio already.
        let zoom_x = this.focal_length_mm / (this.cam_aperture_width_mm / 2);
        let zoom_y = this.focal_length_mm / (this.cam_aperture_height_mm / 2);

        let zz = -(f+n) / (f-n);
        let zw = (-2*f*n) / (f-n);
        return new Mat44(zoom_x,      0,    0,    0,
                              0, zoom_y,    0,    0,
                              0,      0,   zz,   -1,
                              0,      0,   zw,    0);
    }

    get_world_to_camera_matrix() {
        // Old view matrix used in previous exercices. Left here as reference.
        /*let world_to_camera = new Mat44(-0.954241, 0.086124, -0.286371,  0.000000,
                                         0.000000, 0.957630,  0.288002,  0.000000,
                                         0.299040, 0.274823, -0.913809,  0.000000,
                                         0.668532, -3.076821,-16.194227, 1.000000);*/

        // Rotate camera around target
        let mat_rotate_y = new Mat44(Math.cos(this.orbit_h), 0, -Math.sin(this.orbit_h), 0,
                                                          0, 1,                       0, 0,
                                     Math.sin(this.orbit_h), 0,  Math.cos(this.orbit_h), 0,
                                                          0, 0,                       0, 1);

        let mat_rotate_x = new Mat44(1,                       0,                      0, 0,
                                     0,  Math.cos(this.orbit_v), Math.sin(this.orbit_v), 0,
                                     0, -Math.sin(this.orbit_v), Math.cos(this.orbit_v), 0,
                                     0,                       0,                      0, 1);

        // Back away camera from target
        let mat_back_away = new Mat44(1, 0, 0, 0,
                                      0, 1, 0, 0,
                                      0, 0, 1, 0,
                                      0, 0, -this.target_dist, 1);

        let ret_mat = mat_rotate_y.mult(mat_rotate_x).mult(mat_back_away);
        return ret_mat;
    }

    rotate_orbit(disp_h, disp_v) {
        this.orbit_h = (this.orbit_h + disp_h) % PI2;

        this.orbit_v += disp_v;

        if (this.orbit_v > PI_HALF) {
            this.orbit_v = PI_HALF;
        }

        if (this.orbit_v < -PI_HALF) {
            this.orbit_v = -PI_HALF;
        }
    }

    zoom_dolly(disp) {
        this.target_dist += disp;
        if (this.target_dist < this.target_min_dist) {
            this.target_dist = this.target_min_dist;
        }
    }
}

// ====================================================================================================================
// 4x4 Matrix. The matrix is stored in row-major order in memory.
class Mat44 {
    constructor(x1 = 0, x2 = 0, x3 = 0, x4 = 0, y1 = 0, y2 = 0, y3 = 0, y4 = 0, z1 = 0, z2 = 0, z3 = 0, z4 = 0, w1 = 0, w2 = 0, w3 = 0, w4 = 0) {
        this.elems = [x1, x2, x3, x4, y1, y2, y3, y4, z1, z2, z3, z4, w1, w2, w3, w4];
    }

    mult_homogeneous_point(vec3) {
        // Multiply homogeneous point. Assume w coordinate is 1.
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

        // @NOTE: we don't check division by zero but I don't want to put a branch in here just for that special case
        let w = 1/(-vec3.z);

        x *= w;
        y *= w;
        z *= w;

        let out = new Vec3(x, y, z);
        return out;
    }

    mult(mat44) {
        // Unrolled matrix multiplication.
        let a = this.elems;
        let b = mat44.elems;

        // First row:
        let r0 = a[0] * b[0]  + a[1] * b[4]  + a[2] * b[8]  + a[3] * b[12];
        let r1 = a[0] * b[1]  + a[1] * b[5]  + a[2] * b[9]  + a[3] * b[13];
        let r2 = a[0] * b[2]  + a[1] * b[6]  + a[2] * b[10] + a[3] * b[14];
        let r3 = a[0] * b[3]  + a[1] * b[7]  + a[2] * b[11] + a[3] * b[15];

        // Second row:
        let r4 = a[4] * b[0]  + a[5] * b[4]  + a[6] * b[8]  + a[7] * b[12];
        let r5 = a[4] * b[1]  + a[5] * b[5]  + a[6] * b[9]  + a[7] * b[13];
        let r6 = a[4] * b[2]  + a[5] * b[6]  + a[6] * b[10] + a[7] * b[14];
        let r7 = a[4] * b[3]  + a[5] * b[7]  + a[6] * b[11] + a[7] * b[15];

        // Third row:
        let r8  = a[8]  * b[0]  + a[9]  * b[4]  + a[10] * b[8]  + a[11] * b[12];
        let r9  = a[8]  * b[1]  + a[9]  * b[5]  + a[10] * b[9]  + a[11] * b[13];
        let r10 = a[8]  * b[2]  + a[9]  * b[6]  + a[10] * b[10] + a[11] * b[14];
        let r11 = a[8]  * b[3]  + a[9]  * b[7]  + a[10] * b[11] + a[11] * b[15];

        // Fourth row:
        let r12 = a[12] * b[0]  + a[13] * b[4]  + a[14] * b[8]  + a[15] * b[12];
        let r13 = a[12] * b[1]  + a[13] * b[5]  + a[14] * b[9]  + a[15] * b[13];
        let r14 = a[12] * b[2]  + a[13] * b[6]  + a[14] * b[10] + a[15] * b[14];
        let r15 = a[12] * b[3]  + a[13] * b[7]  + a[14] * b[11] + a[15] * b[15];

        return new Mat44(
            r0,  r1,  r2,  r3,
            r4,  r5,  r6,  r7,
            r8,  r9,  r10, r11,
            r12, r13, r14, r15,
        );
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
// Vector of 3 components. The operations performed between vectors and matrices assume that vectors are stored in row-major order.
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

    mult_mat(mat44) {
        // Multiply Vec3 to 4x4 Matrix. Assume w coordinate is 1.
        let x1 = mat44.elems[0]  * this.x;
        let x2 = mat44.elems[4]  * this.y;
        let x3 = mat44.elems[8]  * this.z;
        let x4 = mat44.elems[12];
        let x = x1 + x2 + x3 + x4;

        let y1 = mat44.elems[1]  * this.x;
        let y2 = mat44.elems[5]  * this.y;
        let y3 = mat44.elems[9]  * this.z;
        let y4 = mat44.elems[13];
        let y = y1 + y2 + y3 + y4;

        let z1 = mat44.elems[2]  * this.x;
        let z2 = mat44.elems[6]  * this.y;
        let z3 = mat44.elems[10] * this.z;
        let z4 = mat44.elems[14];
        let z = z1 + z2 + z3 + z4;

        let out = new Vec3(x, y, z);
        return out;
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

function vertex_to_raster_space(vec, camera) {
    // Transform world coordinates to camera space
    let cam_a = vec.mult_mat(camera.get_world_to_camera_matrix());

    // Transform to NDC coordinates in the range [-1, 1]
    let projection_matrix = camera.get_projection_matrix();
    let ndc_a = projection_matrix.mult_homogeneous_point(cam_a);

    // Transform to raster coordinates
    let ras_a = new Vec3(
        (ndc_a.x + 1) / 2 * canvas_width,
        (-ndc_a.y + 1) / 2 * canvas_height,

        //-cam_a.z
        ndc_a.z
    );

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

let frame_last_elapsed_time = 0;
function frame() {
    let frame_start_time = performance.now();

    // ================================================================================================================
    // Input
    let mouse_delta_x = mouse_pos_x - mouse_last_pos_x;
    let mouse_delta_y = mouse_pos_y - mouse_last_pos_y;

    mouse_last_pos_x = mouse_pos_x;
    mouse_last_pos_y = mouse_pos_y;

    let mouse_move_amplitude = 0.01;

    if (mouse_down) {
        camera.rotate_orbit(mouse_delta_x * mouse_move_amplitude, mouse_delta_y * mouse_move_amplitude);
    }

    // Mouse wheel
    //let mouse_wheel_amplitude = 0.05;
    let mouse_wheel_amplitude = (1 + Math.sqrt(camera.target_dist - camera.target_min_dist));
    camera.zoom_dolly(mouse_wheel_dir * mouse_wheel_amplitude);
    mouse_wheel_dir = 0;

    // ================================================================================================================
    // Update tick
    if (rotate_checkbox.checked) {
        rot_y_rad += angular_velocity / 1000 * frame_last_elapsed_time;
        rot_y_rad = rot_y_rad % PI2;

        y_pos = Math.sin(performance.now() / 500);
    }

    // ================================================================================================================
    // Render scene
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
        let mat_rot = new Mat44(Math.cos(rot_y_rad),    0,   -Math.sin(rot_y_rad),    0,
                                                  0,    1,                      0,    0,
                                Math.sin(rot_y_rad),    0,    Math.cos(rot_y_rad),    0,
                                                  0,    0,                      0,    1);
        let mat_pos = new Mat44(1,     0, 0, 0,
                                0,     1, 0, 0,
                                0,     0, 1, 0,
                                0, y_pos, 0, 1);
        let mat_trans = mat_rot.mult(mat_pos);

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

            // Rotate mesh around Y axis
            // @TODO: Factorize mesh, rotation, translation and scale into a single object/entity abstraction
            a = a.mult_mat(mat_trans);
            b = b.mult_mat(mat_trans);
            c = c.mult_mat(mat_trans);

            // Transform from local space coordinates to raster coordinates
            // @TODO: Implement clipping
            let r0 = vertex_to_raster_space(a, camera);
            let r1 = vertex_to_raster_space(b, camera);
            let r2 = vertex_to_raster_space(c, camera);
            let triangle_area_doubled = edge(r0, r1, r2);

            // Render this triangle into the canvas
            let r_min_x = Math.max(0, Math.floor(Math.min(r0.x, r1.x, r2.x)));
            let r_max_x = Math.min(canvas_width, Math.ceil (Math.max(r0.x, r1.x, r2.x)));
            let r_min_y = Math.max(0, Math.floor(Math.min(r0.y, r1.y, r2.y)));
            let r_max_y = Math.min(canvas_height, Math.ceil (Math.max(r0.y, r1.y, r2.y)));
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
    frame_last_elapsed_time = frame_end_time - frame_start_time;

    let fps = Math.round(1/(frame_last_elapsed_time / 1000));
    fps_smoothed = (fps_smoothed * fps_smoothing) + (fps * (1.0 - fps_smoothing))
    fps_counter.innerText = `${Math.round(fps_smoothed)} FPS`;

    window.requestAnimationFrame(frame);
}

window.onload = () => {
    log_output = document.getElementById("logoutput");
    viewer = document.getElementById("viewer");
    input_file = document.getElementById("inputfile");
    remove_model_button = document.getElementById("removemodel");
    boat_button = document.getElementById("boatbutton");
    cube_button = document.getElementById("cubebutton");
    monkey_button = document.getElementById("monkeybutton");
    triangle_button = document.getElementById("trianglebutton");
    fps_counter = document.getElementById("fpscounter");
    rotate_checkbox = document.getElementById("rotate");

    // ================================================================================================================
    // UI
    const ui_reset_model_load_form = () => {
        // Update UI
        input_file.value = null;
        log_output.innerHTML = null;
        input_file.disabled = false;
    };

    const load_obj_mesh_from_url = async (url) => {
        let req = await fetch(url);
        let file_content = await req.text();
        mesh = parse_obj_string_and_display_messages(file_content);
    };

    boat_button.addEventListener("click", () => load_obj_mesh_from_url("../../Assets/Bote coloreado 2.obj"));
    cube_button.addEventListener("click", () => load_obj_mesh_from_url("../../Assets/Cubo coloreado.obj"));
    monkey_button.addEventListener("click", () => load_obj_mesh_from_url("../../Assets/Mono radiactivo.obj"));
    triangle_button.addEventListener("click", () => load_obj_mesh_from_url("../../Assets/Triangulo coloreado.obj"));

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
        }
    };
    input_file.addEventListener("change", handle_attach_file, false);

    remove_model_button.addEventListener("click", () => {
        mesh = null;
        ui_reset_model_load_form();
    });

    // ================================================================================================================
    // Canvas
    viewer.addEventListener("mousedown", e => {
        if (e.buttons & 0x1) {
            // Left mouse click
            mouse_down = true;
            mouse_pos_x = e.pageX;
            mouse_pos_y = e.pageY;
            mouse_last_pos_x = e.pageX;
            mouse_last_pos_y = e.pageY;
        }
    });
    document.addEventListener("mouseup", () => {
        mouse_down = false;
    });
    document.addEventListener("mousemove", e => {
        mouse_pos_x = e.pageX;
        mouse_pos_y = e.pageY;
    });
    viewer.addEventListener("wheel", e => {
        e.preventDefault();
        if (e.deltaY > 0) {
            mouse_wheel_dir = 1.0;
        } else if (e.deltaY < 0) {
            mouse_wheel_dir = -1.0;
        } else {
            mouse_wheel_dir = 0.0;
        }
    });

    ctx = viewer.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    canvas_width = viewer.width;
    canvas_height = viewer.height;

    depth_buffer = new Array(canvas_width * canvas_height);
    image_data = ctx.createImageData(canvas_width, canvas_height);

    window.requestAnimationFrame(frame);
}
