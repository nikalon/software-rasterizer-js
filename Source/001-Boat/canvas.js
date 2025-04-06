const viewer = document.getElementById("viewer");
const ctx = viewer.getContext("2d");
const canvas_width = viewer.width;
const canvas_height = viewer.height;

const MM_PER_INCH = 25.4;

let image_data = ctx.createImageData(canvas_width, canvas_height);
let framebuffer = image_data.data;

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
}

// ====================================================================================================================
// Main
// 146 verts
const verts = [
    [  -2.5703,   0.78053,  -2.4e-05], [ -0.89264,  0.022582,  0.018577],
    [   1.6878, -0.017131,  0.022032], [   3.4659,  0.025667,  0.018577],
    [  -2.5703,   0.78969, -0.001202], [ -0.89264,   0.25121,   0.93573],
    [   1.6878,   0.25121,    1.1097], [   3.5031,   0.25293,   0.93573],
    [  -2.5703,    1.0558, -0.001347], [ -0.89264,    1.0558,    1.0487],
    [   1.6878,    1.0558,    1.2437], [   3.6342,    1.0527,    1.0487],
    [  -2.5703,    1.0558,         0], [ -0.89264,    1.0558,         0],
    [   1.6878,    1.0558,         0], [   3.6342,    1.0527,         0],
    [  -2.5703,    1.0558,  0.001347], [ -0.89264,    1.0558,   -1.0487],
    [   1.6878,    1.0558,   -1.2437], [   3.6342,    1.0527,   -1.0487],
    [  -2.5703,   0.78969,  0.001202], [ -0.89264,   0.25121,  -0.93573],
    [   1.6878,   0.25121,   -1.1097], [   3.5031,   0.25293,  -0.93573],
    [   3.5031,   0.25293,         0], [  -2.5703,   0.78969,         0],
    [   1.1091,    1.2179,         0], [    1.145,     6.617,         0],
    [   4.0878,    1.2383,         0], [  -2.5693,    1.1771, -0.081683],
    [  0.98353,    6.4948, -0.081683], [ -0.72112,    1.1364, -0.081683],
    [   0.9297,     6.454,         0], [  -0.7929,     1.279,         0],
    [  0.91176,    1.2994,         0]
];

const tris = [
     4,   0,   5,   0,   1,   5,   1,   2,   5,   5,   2,   6,   3,   7,   2,
     2,   7,   6,   5,   9,   4,   4,   9,   8,   5,   6,   9,   9,   6,  10,
     7,  11,   6,   6,  11,  10,   9,  13,   8,   8,  13,  12,  10,  14,   9,
     9,  14,  13,  10,  11,  14,  14,  11,  15,  17,  16,  13,  12,  13,  16,
    13,  14,  17,  17,  14,  18,  15,  19,  14,  14,  19,  18,  16,  17,  20,
    20,  17,  21,  18,  22,  17,  17,  22,  21,  18,  19,  22,  22,  19,  23,
    20,  21,   0,  21,   1,   0,  22,   2,  21,  21,   2,   1,  22,  23,   2,
     2,  23,   3,   3,  23,  24,   3,  24,   7,  24,  23,  15,  15,  23,  19,
    24,  15,   7,   7,  15,  11,   0,  25,  20,   0,   4,  25,  20,  25,  16,
    16,  25,  12,  25,   4,  12,  12,   4,   8,  26,  27,  28,  29,  30,  31,
    32,  34,  33
];

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

//function frame() {
    // Clear canvas before drawing
    ctx.fillStyle = "rgb(255 255 255)";
    ctx.fillRect(0, 0, canvas_width, canvas_height);

    // Render scene
    for (let i = 0; i < tris.length; i++) {
        // @TODO: Improve memory consumption by reusing vectors instead of allocating memory for each vector every frame
        let a = new Vec3(verts[tris[i*3]]);
        let b = new Vec3(verts[tris[i*3 + 1]]);
        let c = new Vec3(verts[tris[i*3 + 2]]);

        let ras_a = vertex_to_raster_space(a, camera, worldToCamera);
        let ras_b = vertex_to_raster_space(b, camera, worldToCamera);
        let ras_c = vertex_to_raster_space(c, camera, worldToCamera);

        // Draw edges of triangle
        render_line(ras_a, ras_b);
        render_line(ras_b, ras_c);
        render_line(ras_c, ras_a);
    }

    //ctx.putImageData(image_data, 0, 0);
//window.requestAnimationFrame(frame);
//}

//window.requestAnimationFrame(frame);
