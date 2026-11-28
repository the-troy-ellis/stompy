//! The cockpit: the demigod's own head, seen from inside, in 3D (docs/specs/05-cockpit.md).
//! Built in the view's own space (x to the left, y up, z ahead, metres from the eye: a
//! right-handed frame, so faces keep their winding) and drawn with
//! the camera, so every kick, bob and shake moves it with you. BARRY first: a porthole eye with
//! a riveted ring, a small dash whose dials and lamps read the machine, and a maintenance tag the
//! tiny robots tied on, swinging on a spring. Drawing only.
use crate::gl::{Gl, Mesh, Mode};
use crate::mesh::Builder;
use stompy_sim::data::{chassis, hot_frac, Ch};
use stompy_sim::math::*;
use stompy_sim::spring::Spring;
use stompy_sim::Mech;

const STEEL: [f32; 3] = [0.24, 0.26, 0.31];
const STEEL_DK: [f32; 3] = [0.13, 0.14, 0.17];
const STEEL_LT: [f32; 3] = [0.38, 0.41, 0.47];
const FACE: [f32; 3] = [0.05, 0.07, 0.06];
const GREEN: [f32; 3] = [0.36, 1., 0.36];
const AMBER: [f32; 3] = [1., 0.8, 0.2];
const RED: [f32; 3] = [1., 0.27, 0.27];

/// The porthole: an oval window this wide and tall at this distance from the eye.
const WIN: [f32; 3] = [0.88, 0.5, 1.0];
/// The dials: where they sit (x, y, z), how big.
const DIALS: [[f32; 3]; 2] = [[-0.2, -0.43, 0.86], [0.2, -0.43, 0.86]];
const DIAL_R: f32 = 0.068;
/// The tag's hook, at the top of the window.
const HOOK: [f32; 3] = [0.14, 0.64, 1.02];

/// A dial's needle angle for a reading `v` (0 empty, 1 full): on the dial's face a needle
/// points cos(a) to the left and sin(a) up, so empty is at the lower left, full at the lower
/// right, and it sweeps clockwise through the top. Off, it drops just past empty.
fn needle(v: f32, on: bool) -> f32 {
    if on {
        PI * (-0.25 + 1.5 * v.clamp(0., 1.))
    } else {
        PI * -0.32
    }
}
pub struct Cockpit {
    frame: Mesh,
    dash: Mesh,
    needle: Mesh,
    lamp: Mesh,
    tag: Mesh,
    swing_x: Spring,
    swing_z: Spring,
    t: f32,
    eye: V3,
    vel: V3,
    /// Last frame's view axes: when the head turns or tips, the tag lags behind.
    dir: V3,
    up: V3,
}
/// A point of the oval window at angle `a`, scaled by `k`, at depth `z`.
fn oval(a: f32, k: f32, z: f32) -> V3 {
    v3(a.cos() * WIN[0] * k, a.sin() * WIN[1] * k, z)
}
/// Where the ray from the window's middle at angle `a` meets a rectangle `x` by `y` (the frame's
/// outer edge, wider than the screen).
fn edge(a: f32, x: f32, y: f32, z: f32) -> V3 {
    let (c, s) = (a.cos(), a.sin());
    let t = (x / c.abs().max(1e-4)).min(y / s.abs().max(1e-4));
    v3(c * t, s * t, z)
}
impl Cockpit {
    /// BARRY's head.
    pub fn barry(gl: &Gl) -> Cockpit {
        let n = 28;
        let mut b = Builder::default();
        let away = v3(0., 0., 5.); // faces point back at the eye
        for i in 0..n {
            let (a0, a1) = (i as f32 / n as f32 * TAU, (i + 1) as f32 / n as f32 * TAU);
            // The lip: the window's edge has depth.
            let (p0, p1) = (oval(a0, 1., WIN[2]), oval(a1, 1., WIN[2]));
            let (q0, q1) = (oval(a0, 1.05, WIN[2] - 0.06), oval(a1, 1.05, WIN[2] - 0.06));
            b.quad(p0, p1, q1, q0, STEEL_DK, away);
            // The raised ring round it, faceted.
            let (r0, r1) = (oval(a0, 1.12, WIN[2] - 0.08), oval(a1, 1.12, WIN[2] - 0.08));
            b.quad(q0, q1, r1, r0, STEEL_LT, away);
            let (s0, s1) = (oval(a0, 1.2, WIN[2] - 0.05), oval(a1, 1.2, WIN[2] - 0.05));
            b.quad(r0, r1, s1, s0, STEEL, away);
            // The dished panel out to past the screen's edge, curving round toward the eye.
            let (e0, e1) = (edge(a0, 2.2, 1.6, 0.55), edge(a1, 2.2, 1.6, 0.55));
            b.quad(
                s0,
                s1,
                e1,
                e0,
                if i % 2 == 0 { STEEL } else { STEEL_DK },
                away,
            );
        }
        // Rivets round the ring.
        for i in 0..24 {
            let a = (i as f32 + 0.5) / 24. * TAU;
            let p = oval(a, 1.16, WIN[2] - 0.085);
            b.sphere(M4::t(p.x, p.y, p.z) * M4::s1(0.026), STEEL_LT, 6, 3);
        }
        let frame = b.upload(gl);
        // The dash: a slanted block low in the middle, the two dials' rims, the lamps' sockets.
        let tilt = M4::rx(-0.9);
        b.bbox(
            M4::t(0., -0.5, 0.9) * tilt,
            v3(0.68, 0.06, 0.28),
            0.02,
            1.,
            STEEL,
        );
        b.bbox(
            M4::t(0., -0.55, 0.95) * tilt,
            v3(0.72, 0.08, 0.34),
            0.02,
            1.,
            STEEL_DK,
        );
        for d in DIALS {
            let m = M4::t(d[0], d[1], d[2]) * tilt;
            b.cyl(
                m * M4::s(DIAL_R * 2.5, 0.03, DIAL_R * 2.5),
                STEEL_LT,
                14,
                1.,
            );
            b.cyl(
                m * M4::t(0., 0.017, 0.) * M4::s(DIAL_R * 2., 0.006, DIAL_R * 2.),
                FACE,
                14,
                1.,
            );
            for k in 0..9 {
                let a = PI * (-0.25 + 1.5 * k as f32 / 8.);
                let tick = m * M4::t(a.cos() * DIAL_R * 0.82, 0.022, a.sin() * DIAL_R * 0.82);
                b.cube1(
                    tick * M4::ry(-a) * M4::s(0.012, 0.004, 0.004),
                    [0.2, 0.5, 0.2],
                );
            }
        }
        for i in 0..3 {
            let m = M4::t(-0.06 + i as f32 * 0.06, -0.452, 0.86) * tilt;
            b.cyl(m * M4::s(0.034, 0.02, 0.034), STEEL_DK, 8, 1.);
        }
        let dash = b.upload(gl);
        // A needle: from the dial's middle out along +x.
        b.cube1(
            M4::t(DIAL_R * 0.38, 0., 0.) * M4::s(DIAL_R * 0.8, 0.005, 0.008),
            [1., 1., 1.],
        );
        let needle = b.upload(gl);
        b.sphere(M4::s1(0.026), [1., 1., 1.], 8, 4);
        let lamp = b.upload(gl);
        // The tag: three links of chain down from the hook, then the plate, in the accent.
        let acc = chassis(Ch::Kestrel).acc;
        for k in 0..3 {
            let y = -0.025 - k as f32 * 0.045;
            b.bbox(
                M4::t(0., y, 0.) * M4::ry(k as f32 * 1.57),
                v3(0.012, 0.04, 0.02),
                0.003,
                1.,
                STEEL_LT,
            );
        }
        b.bbox(M4::t(0., -0.19, 0.), v3(0.075, 0.1, 0.008), 0.008, 1., acc);
        b.bbox(
            M4::t(0., -0.175, -0.006),
            v3(0.05, 0.008, 0.004),
            0.002,
            1.,
            [acc[0] * 0.5, acc[1] * 0.5, acc[2] * 0.5],
        );
        b.bbox(
            M4::t(0., -0.2, -0.006),
            v3(0.04, 0.008, 0.004),
            0.002,
            1.,
            [acc[0] * 0.5, acc[1] * 0.5, acc[2] * 0.5],
        );
        let tag = b.upload(gl);
        Cockpit {
            frame,
            dash,
            needle,
            lamp,
            tag,
            swing_x: Spring::new(26., 0.1),
            swing_z: Spring::new(26., 0.1),
            t: -1.,
            eye: V3::ZERO,
            vel: V3::ZERO,
            dir: v3(0., 0., 1.),
            up: v3(0., 1., 0.),
        }
    }

    /// Draws the head round the eye. `right`, `up`, `dir` are the camera's own axes this frame.
    #[allow(clippy::too_many_arguments)]
    pub fn draw(&mut self, gl: &mut Gl, m: &Mech, time: f32, eye: V3, right: V3, up: V3, dir: V3) {
        let left = right * -1.;
        let view = M4([
            left.x, left.y, left.z, 0., up.x, up.y, up.z, 0., dir.x, dir.y, dir.z, 0., eye.x,
            eye.y, eye.z, 1.,
        ]);
        // The tag swings on the head's jolts, in the view's own frame.
        let dt = time - self.t;
        if (0.0..0.1).contains(&dt) && dt > 0. {
            let vel = (eye - self.eye) * (1. / dt);
            let acc = (vel - self.vel) * (1. / dt);
            self.vel = vel;
            let lim = |a: f32| a.clamp(-80., 80.);
            // Jolts: the head moves, the tag stays behind.
            self.swing_z.v += lim(acc.dot(right)) * 0.03 * dt;
            self.swing_x.v += lim(acc.dot(dir)) * 0.03 * dt;
            // Turns and tips: the head rotates under the hook, the tag hangs on.
            let (yaw, pitch, roll) = (
                (dir - self.dir).dot(right) / dt,
                (dir - self.dir).dot(up) / dt,
                (up - self.up).dot(right) / dt,
            );
            self.swing_z.v += (yaw * 0.8 - roll * 1.2).clamp(-6., 6.) * dt * 20.;
            self.swing_x.v -= pitch.clamp(-6., 6.) * dt * 16.;
            // A footfall's drop sets it bobbing, a little to whichever side it already leans.
            let sway = if self.swing_z.x >= 0. { 1. } else { -1. };
            self.swing_z.v += lim(-acc.dot(up)).max(0.) * 0.006 * dt * sway;
            self.swing_x.step(dt, 0.);
            self.swing_z.step(dt, 0.);
            self.swing_x.x = self.swing_x.x.clamp(-0.9, 0.9);
            self.swing_z.x = self.swing_z.x.clamp(-0.9, 0.9);
        } else if !(0.0..0.1).contains(&dt) {
            self.vel = V3::ZERO;
        }
        self.t = time;
        self.eye = eye;
        (self.dir, self.up) = (dir, up);

        gl.mode(Mode::Lit);
        gl.world(false);
        gl.draw_plain(&self.frame, &view);
        gl.draw_plain(&self.dash, &view);
        let tag = view
            * M4::t(HOOK[0], HOOK[1], HOOK[2])
            * M4::rx(self.swing_x.x)
            * M4::rz(self.swing_z.x);
        gl.draw_plain(&self.tag, &tag);

        // The machine's own readings: heat on the left dial, pace on the right. Dark when off.
        let on = m.alive && !m.shutdown;
        let tilt = M4::rx(-0.9);
        let heat = (m.heat / 100.).clamp(0., 1.3);
        let pace = (m.speed.abs() / m.max_speed.max(0.1)).clamp(0., 1.);
        for (d, v) in DIALS.iter().zip([heat, pace]) {
            let a = needle(v, on);
            let at = view * M4::t(d[0], d[1], d[2]) * tilt * M4::t(0., 0.024, 0.) * M4::ry(-a);
            let col = if on && v >= 0.85 { RED } else { GREEN };
            gl.mode(Mode::Emissive);
            gl.draw(
                &self.needle,
                &at,
                if on { col } else { [0.15, 0.2, 0.15] },
                1.,
            );
        }
        // Lamps: jets ready, heat over 55, heat over 85 (flashing).
        let hot = hot_frac(m.heat);
        let flash = (time * 6.).sin() > 0.;
        let lamps = [
            (GREEN, on && m.fuel >= 1.),
            (AMBER, on && m.heat > 55.),
            (RED, on && hot > 0. && flash),
        ];
        for (i, (col, lit)) in lamps.into_iter().enumerate() {
            let at =
                view * M4::t(-0.06 + i as f32 * 0.06, -0.452, 0.86) * tilt * M4::t(0., 0.012, 0.);
            if lit {
                gl.mode(Mode::Emissive);
                gl.draw(&self.lamp, &at, col, 1.);
            } else {
                gl.mode(Mode::Lit);
                gl.draw(
                    &self.lamp,
                    &at,
                    [col[0] * 0.2, col[1] * 0.2, col[2] * 0.2],
                    0.,
                );
            }
        }
        gl.mode(Mode::Lit);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // (left, up) on the dial's face; "left" is the viewer's left.
    fn at(a: f32) -> (f32, f32) {
        (a.cos(), a.sin())
    }
    #[test]
    fn needles_read_from_lower_left_through_the_top_to_lower_right() {
        let (l, u) = at(needle(0., true));
        assert!(l > 0.5 && u < -0.5, "empty: lower left");
        let (l, u) = at(needle(0.5, true));
        assert!(l.abs() < 1e-3 && u > 0.99, "half: straight up");
        let (l, u) = at(needle(1., true));
        assert!(l < -0.5 && u < -0.5, "full: lower right");
        let (_, u) = at(needle(0.5, false));
        assert!(u < at(needle(0., true)).1, "off: below empty");
    }
}
