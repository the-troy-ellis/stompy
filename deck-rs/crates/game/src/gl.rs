//! OpenGL 3.3 core through glow. One shader: flat-shaded polygons with a colour
//! per vertex, one light, the palette's sky and fog, an ordered 4x4 dither for
//! the few things that fade (never blending), and a 2D mode for the HUD.
use glow::HasContext;
use stompy_sim::math::*;

pub const FLOATS: usize = 9; // pos, normal, colour per vertex
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Lit = 0,
    Emissive = 1,
    Sky = 2,
    Hud = 3,
}
pub struct Mesh {
    vao: glow::VertexArray,
    vbo: glow::Buffer,
    pub n: i32,
}
struct Uniforms {
    vp: glow::UniformLocation,
    eye: glow::UniformLocation,
    light: glow::UniformLocation,
    shade: glow::UniformLocation,
    mode: glow::UniformLocation,
    fog: glow::UniformLocation,
    fog_range: glow::UniformLocation,
    dither: glow::UniformLocation,
    zen: glow::UniformLocation,
    hor: glow::UniformLocation,
}
pub struct Gl {
    pub gl: glow::Context,
    u: Uniforms,
    inst: glow::Buffer,
    pub draws: usize,
}
const VS: &str = r#"#version 330 core
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec3 aCol;
layout(location=3) in vec4 m0; layout(location=4) in vec4 m1; layout(location=5) in vec4 m2; layout(location=6) in vec4 m3; layout(location=7) in vec4 aInst;
uniform mat4 uVP; uniform vec3 uEye; uniform vec3 uLight; uniform vec3 uShade; uniform int uMode;
out vec3 vCol; out float vDist;
void main() {
  mat4 M = mat4(m0, m1, m2, m3);
  vec4 wp = M * vec4(aPos, 1.0);
  vec3 n = normalize(mat3(M) * aNrm);
  vec3 col = aCol * aInst.rgb;
  float em = max(aInst.a, uMode == 1 ? 1.0 : 0.0);
  float diff = max(0.0, dot(n, uLight)) * 0.72 + 0.28 + 0.1 * n.y;
  vec3 lit = col * diff * uShade;
  vCol = (uMode == 0) ? mix(lit, col, em) : (uMode == 2 ? normalize(aPos) : col);
  vDist = length(wp.xyz - uEye);
  if (uMode == 2) { gl_Position = uVP * vec4(uEye + normalize(aPos) * 1500.0, 1.0); gl_Position.z = gl_Position.w * 0.9999; }
  else gl_Position = uVP * wp;
}"#;
const FS: &str = r#"#version 330 core
in vec3 vCol; in float vDist; out vec4 o;
uniform vec3 uFog; uniform vec2 uFogRange; uniform int uMode; uniform float uDither; uniform vec3 uZen; uniform vec3 uHor;
const float B[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
void main() {
  if (uDither < 1.0) { int x = int(gl_FragCoord.x) & 3, y = int(gl_FragCoord.y) & 3; if ((B[y * 4 + x] + 0.5) / 16.0 >= uDither) discard; }
  vec3 c = vCol;
  if (uMode == 2) { float t = smoothstep(-0.02, 0.35, vCol.y); c = mix(uHor, uZen, t); }
  else if (uMode != 3) { float f = clamp((vDist - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0); c = mix(c, uFog, f * f * (3.0 - 2.0 * f)); }
  o = vec4(c, 1.0);
}"#;
fn bytes(v: &[f32]) -> &[u8] {
    // SAFETY: f32 has no padding and any byte pattern of it is a valid u8 sequence.
    unsafe { std::slice::from_raw_parts(v.as_ptr() as *const u8, std::mem::size_of_val(v)) }
}
impl Gl {
    pub fn new(gl: glow::Context) -> Result<Gl, String> {
        unsafe {
            println!(
                "GL: {} on {}",
                gl.get_parameter_string(glow::VERSION),
                gl.get_parameter_string(glow::RENDERER)
            );
            let prog = gl.create_program()?;
            for (kind, src) in [(glow::VERTEX_SHADER, VS), (glow::FRAGMENT_SHADER, FS)] {
                let s = gl.create_shader(kind)?;
                gl.shader_source(s, src);
                gl.compile_shader(s);
                if !gl.get_shader_compile_status(s) {
                    return Err(format!("shader: {}", gl.get_shader_info_log(s)));
                }
                gl.attach_shader(prog, s);
            }
            gl.link_program(prog);
            if !gl.get_program_link_status(prog) {
                return Err(format!("link: {}", gl.get_program_info_log(prog)));
            }
            gl.use_program(Some(prog));
            let loc = |n: &str| {
                gl.get_uniform_location(prog, n)
                    .ok_or(format!("no uniform {n}"))
            };
            let u = Uniforms {
                vp: loc("uVP")?,
                eye: loc("uEye")?,
                light: loc("uLight")?,
                shade: loc("uShade")?,
                mode: loc("uMode")?,
                fog: loc("uFog")?,
                fog_range: loc("uFogRange")?,
                dither: loc("uDither")?,
                zen: loc("uZen")?,
                hor: loc("uHor")?,
            };
            gl.enable(glow::DEPTH_TEST);
            gl.enable(glow::CULL_FACE);
            gl.cull_face(glow::BACK);
            gl.disable(glow::BLEND);
            let inst = gl.create_buffer()?;
            Ok(Gl {
                gl,
                u,
                inst,
                draws: 0,
            })
        }
    }
    pub fn begin(&mut self, w: i32, h: i32, clear: [f32; 3]) {
        unsafe {
            self.gl.viewport(0, 0, w, h);
            self.gl.clear_color(clear[0], clear[1], clear[2], 1.);
            self.gl.depth_mask(true);
            self.gl
                .clear(glow::COLOR_BUFFER_BIT | glow::DEPTH_BUFFER_BIT);
        }
        self.draws = 0;
        self.dither(1.);
    }
    pub fn camera(&self, vp: &M4, eye: V3) {
        unsafe {
            self.gl
                .uniform_matrix_4_f32_slice(Some(&self.u.vp), false, &vp.0);
            self.gl
                .uniform_3_f32(Some(&self.u.eye), eye.x, eye.y, eye.z);
        }
    }
    pub fn light(&self, l: [f32; 3], shade: [f32; 3], fog: [f32; 3], near: f32, far: f32) {
        unsafe {
            self.gl.uniform_3_f32(Some(&self.u.light), l[0], l[1], l[2]);
            self.gl
                .uniform_3_f32(Some(&self.u.shade), shade[0], shade[1], shade[2]);
            self.gl
                .uniform_3_f32(Some(&self.u.fog), fog[0], fog[1], fog[2]);
            self.gl.uniform_2_f32(Some(&self.u.fog_range), near, far);
        }
    }
    pub fn sky(&self, zen: [f32; 3], hor: [f32; 3]) {
        unsafe {
            self.gl
                .uniform_3_f32(Some(&self.u.zen), zen[0], zen[1], zen[2]);
            self.gl
                .uniform_3_f32(Some(&self.u.hor), hor[0], hor[1], hor[2]);
        }
    }
    pub fn mode(&self, m: Mode) {
        unsafe {
            self.gl.uniform_1_i32(Some(&self.u.mode), m as i32);
            if m == Mode::Hud {
                self.gl.disable(glow::DEPTH_TEST);
                self.gl.disable(glow::CULL_FACE);
            } else {
                self.gl.enable(glow::DEPTH_TEST);
                if m == Mode::Sky {
                    self.gl.disable(glow::CULL_FACE)
                } else {
                    self.gl.enable(glow::CULL_FACE)
                }
            }
        }
    }
    /// 1: solid. Less: an ordered 4x4 dither of drawn and skipped pixels, the 1996 see-through.
    pub fn dither(&self, coverage: f32) {
        unsafe { self.gl.uniform_1_f32(Some(&self.u.dither), coverage) }
    }
    pub fn depth(&self, test: bool, write: bool) {
        unsafe {
            if test {
                self.gl.enable(glow::DEPTH_TEST)
            } else {
                self.gl.disable(glow::DEPTH_TEST)
            }
            self.gl.depth_mask(write);
        }
    }
    pub fn upload(&self, v: &[f32]) -> Mesh {
        unsafe {
            let gl = &self.gl;
            let vao = gl.create_vertex_array().expect("vao");
            let vbo = gl.create_buffer().expect("vbo");
            gl.bind_vertex_array(Some(vao));
            gl.bind_buffer(glow::ARRAY_BUFFER, Some(vbo));
            gl.buffer_data_u8_slice(glow::ARRAY_BUFFER, bytes(v), glow::STATIC_DRAW);
            let st = (FLOATS * 4) as i32;
            for (i, off) in [(0, 0), (1, 12), (2, 24)] {
                gl.enable_vertex_attrib_array(i);
                gl.vertex_attrib_pointer_f32(i, 3, glow::FLOAT, false, st, off);
            }
            gl.bind_vertex_array(None);
            Mesh {
                vao,
                vbo,
                n: (v.len() / FLOATS) as i32,
            }
        }
    }
    /// Re-upload a mesh that changes every frame (the HUD).
    pub fn update(&self, m: &mut Option<Mesh>, v: &[f32]) {
        match m {
            None => *m = Some(self.upload(v)),
            Some(m) => unsafe {
                self.gl.bind_buffer(glow::ARRAY_BUFFER, Some(m.vbo));
                self.gl
                    .buffer_data_u8_slice(glow::ARRAY_BUFFER, bytes(v), glow::STREAM_DRAW);
                m.n = (v.len() / FLOATS) as i32;
            },
        }
    }
    pub fn free(&self, m: Mesh) {
        unsafe {
            self.gl.delete_vertex_array(m.vao);
            self.gl.delete_buffer(m.vbo);
        }
    }
    /// One draw: the model matrix and a colour multiplier ride in generic attributes.
    pub fn draw(&mut self, m: &Mesh, model: &M4, col: [f32; 3], emissive: f32) {
        if m.n == 0 {
            return;
        }
        unsafe {
            let gl = &self.gl;
            gl.bind_vertex_array(Some(m.vao));
            for i in 3..=7 {
                gl.disable_vertex_attrib_array(i);
            }
            for c in 0..4 {
                let k = c * 4;
                gl.vertex_attrib_4_f32(
                    3 + c as u32,
                    model.0[k],
                    model.0[k + 1],
                    model.0[k + 2],
                    model.0[k + 3],
                );
            }
            gl.vertex_attrib_4_f32(7, col[0], col[1], col[2], emissive);
            gl.draw_arrays(glow::TRIANGLES, 0, m.n);
        }
        self.draws += 1;
    }
    pub fn draw_plain(&mut self, m: &Mesh, model: &M4) {
        self.draw(m, model, [1., 1., 1.], 0.);
    }
    /// Many copies of one shape: each instance is a matrix and a colour with its glow (20 floats).
    pub fn draw_inst(&mut self, m: &Mesh, inst: &[f32]) {
        let count = (inst.len() / 20) as i32;
        if m.n == 0 || count == 0 {
            return;
        }
        unsafe {
            let gl = &self.gl;
            gl.bind_vertex_array(Some(m.vao));
            gl.bind_buffer(glow::ARRAY_BUFFER, Some(self.inst));
            gl.buffer_data_u8_slice(glow::ARRAY_BUFFER, bytes(inst), glow::STREAM_DRAW);
            for i in 0..5u32 {
                gl.enable_vertex_attrib_array(3 + i);
                gl.vertex_attrib_pointer_f32(3 + i, 4, glow::FLOAT, false, 80, (i * 16) as i32);
                gl.vertex_attrib_divisor(3 + i, 1);
            }
            gl.draw_arrays_instanced(glow::TRIANGLES, 0, m.n, count);
            for i in 0..5u32 {
                gl.vertex_attrib_divisor(3 + i, 0);
                gl.disable_vertex_attrib_array(3 + i);
            }
            gl.bind_vertex_array(None);
        }
        self.draws += 1;
    }
    /// The frame as RGB, top row first.
    pub fn read_pixels(&self, w: i32, h: i32) -> Vec<u8> {
        let mut px = vec![0u8; (w * h * 3) as usize];
        unsafe {
            self.gl.pixel_store_i32(glow::PACK_ALIGNMENT, 1);
            self.gl.read_pixels(
                0,
                0,
                w,
                h,
                glow::RGB,
                glow::UNSIGNED_BYTE,
                glow::PixelPackData::Slice(&mut px),
            );
        }
        let row = (w * 3) as usize;
        let mut out = Vec::with_capacity(px.len());
        for y in (0..h as usize).rev() {
            out.extend_from_slice(&px[y * row..(y + 1) * row]);
        }
        out
    }
}
