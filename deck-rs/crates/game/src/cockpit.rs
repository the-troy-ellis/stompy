//! The cockpit: the demigod's own head, seen from inside, in 3D (docs/specs/05-cockpit.md).
//! Built in the view's own space (x to the left, y up, z ahead, metres from the eye: a
//! right-handed frame, so faces keep their winding) and drawn with the camera, so every kick, bob
//! and shake moves it with you. Drawing only.
//!
//! There is no pilot (docs/world.md), so nothing in here is an instrument for one. The machine
//! shows its state through its own workings: eyelids that squint when it runs hot, slam shut on
//! a shutdown and flinch when hit; heat coils under the eye that glow dull red to white and
//! steam when critical; two jet capacitors that fill with light; cracks across the eye as it is
//! hurt; and the maintenance tag the tiny robots tied on, swinging. BARRY's, so far.
use crate::gl::{Gl, Mesh, Mode};
use crate::mesh::Builder;
use stompy_sim::data::{chassis, Ch, Sec};
use stompy_sim::math::*;
use stompy_sim::spring::Spring;
use stompy_sim::Mech;

const STEEL: [f32; 3] = [0.24, 0.26, 0.31];
const STEEL_DK: [f32; 3] = [0.13, 0.14, 0.17];
const STEEL_LT: [f32; 3] = [0.38, 0.41, 0.47];
const GLASS: [f32; 3] = [0.1, 0.14, 0.17];
const CHARGE: [f32; 3] = [0.45, 1., 0.85];

/// The porthole: an oval window this wide and tall at this distance from the eye.
const WIN: [f32; 3] = [0.88, 0.5, 1.0];
/// The tag's hook, at the top of the window.
const HOOK: [f32; 3] = [0.14, 0.64, 1.02];
/// The eyelids slide just behind the lip, so the ring covers their edges.
const LID_Z: f32 = 1.03;
/// The heat coils: a row of fins across the bottom of the eye.
const COILS: usize = 9;
const COIL_Y: f32 = -0.43;
const COIL_Z: f32 = 0.93;
/// The jet capacitors, in the frame's upper corners (outside the window: they never block it).
const CAPS: [[f32; 3]; 2] = [[0.66, 0.42, 0.92], [-0.66, 0.42, 0.92]];
const CAP_H: f32 = 0.16;

/// What the head shows, from the machine (or forced, for the tools' mockups).
#[derive(Clone, Copy)]
pub struct Reading {
    /// 0 cold to 1 at shutdown and past.
    pub heat: f32,
    /// The jets' charge, 0 to 1 (1 ready).
    pub fuel: f32,
    /// How much of the torso is left, 0 to 1.
    pub torso: f32,
    /// Shut down or dead: the lids close and everything goes dark.
    pub off: bool,
}
impl Reading {
    pub fn of(m: &Mech) -> Reading {
        let t = Sec::T.i();
        Reading {
            heat: m.heat / 100.,
            fuel: m.fuel.clamp(0., 1.),
            torso: (m.hp[t] / m.max[t].max(1.)).clamp(0., 1.),
            off: !m.alive || m.shutdown,
        }
    }
    /// The tools' mockups: 0 cool, 1 hot, 2 critical, 3 shut down, 4 hurt.
    pub fn pose(n: u8) -> Reading {
        let (heat, fuel, torso, off) = match n {
            1 => (0.72, 0.6, 1., false),
            2 => (0.96, 0.2, 0.8, false),
            3 => (1.02, 0., 0.7, true),
            4 => (0.4, 1., 0.18, false),
            _ => (0.15, 1., 1., false),
        };
        Reading {
            heat,
            fuel,
            torso,
            off,
        }
    }
}
/// How far the eyelids close, 0 open to 1 shut: a resting droop, a squint as the heat climbs past
/// 55, shut when the machine is off.
pub fn lids_for(r: &Reading) -> f32 {
    if r.off {
        return 1.;
    }
    0.06 + 0.36 * smooth((r.heat - 0.55) / 0.42)
}
/// The coils' colour for a heat: cold steel, then dull red, orange, and near white at shutdown.
/// The second value is whether they glow.
pub fn coil_colour(heat: f32) -> ([f32; 3], bool) {
    let ramp = [
        (0.35, [0.3, 0.07, 0.05]),
        (0.6, [0.75, 0.16, 0.06]),
        (0.8, [1., 0.45, 0.1]),
        (1., [1., 0.88, 0.55]),
    ];
    if heat < ramp[0].0 {
        return (STEEL_LT, false);
    }
    for w in ramp.windows(2) {
        let ((h0, c0), (h1, c1)) = (w[0], w[1]);
        if heat <= h1 {
            let t = (heat - h0) / (h1 - h0);
            return ([0, 1, 2].map(|k| c0[k] + (c1[k] - c0[k]) * t), true);
        }
    }
    (ramp[3].1, true)
}

pub struct Cockpit {
    frame: Mesh,
    lid_top: Mesh,
    lid_bot: Mesh,
    coils: Mesh,
    fins: Mesh,
    caps: Mesh,
    fill: Mesh,
    puff: Mesh,
    cracks: [Mesh; 3],
    tag: Mesh,
    swing_x: Spring,
    swing_z: Spring,
    lids: Spring,
    torso_was: f32,
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
/// A jagged crack across the eye: a walk from `from` in roughly direction `dir`, with branches.
fn crack(b: &mut Builder, from: V3, dir: f32, steps: usize, seed: f32, branch: bool) {
    let mut p = from;
    let mut a = dir;
    for i in 0..steps {
        let h = ((i as f32 + seed) * 12.9898).sin() * 43758.547;
        let r = h - h.floor();
        a += (r - 0.5) * 1.1;
        let len = 0.035 + r * 0.05;
        let q = p + v3(a.cos() * len, a.sin() * len, 0.);
        b.rod(p, q, 0.0045, 3, [0.82, 0.9, 0.95]);
        if branch && i % 3 == 1 {
            crack(
                b,
                q,
                a + if r > 0.5 { 0.9 } else { -0.9 },
                steps / 3,
                seed + 7.3,
                false,
            );
        }
        p = q;
    }
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
            let shade = if i % 2 == 0 { STEEL } else { STEEL_DK };
            b.quad(s0, s1, e1, e0, shade, away);
        }
        for i in 0..24 {
            let a = (i as f32 + 0.5) / 24. * TAU;
            let p = oval(a, 1.16, WIN[2] - 0.085);
            b.sphere(M4::t(p.x, p.y, p.z) * M4::s1(0.026), STEEL_LT, 6, 3);
        }
        let frame = b.upload(gl);

        // The eyelids: a plate each, its leading edge at the origin, a rolled lip, three ribs,
        // and the piston that works it. The bottom one is built upside down, not mirrored.
        let mut lids = Vec::new();
        for s in [1., -1.] {
            b.bbox(
                M4::t(0., s * 0.38, 0.),
                v3(2.0, 0.76, 0.03),
                0.01,
                1.,
                STEEL,
            );
            b.rod(v3(-1., 0., -0.02), v3(1., 0., -0.02), 0.05, 8, STEEL_LT);
            for x in [-0.45, 0., 0.45] {
                b.bbox(
                    M4::t(x, s * 0.3, -0.03),
                    v3(0.05, 0.5, 0.03),
                    0.01,
                    1.,
                    STEEL_DK,
                );
            }
            b.rod(
                v3(0.3, s * 0.08, -0.05),
                v3(0.36, s * 0.62, -0.05),
                0.04,
                6,
                STEEL_LT,
            );
            lids.push(b.upload(gl));
        }
        let lid_bot = lids.pop().unwrap();
        let lid_top = lids.pop().unwrap();

        // The heat coils: a bracket across the bottom of the eye holding a row of fins.
        b.bbox(
            M4::t(0., COIL_Y - 0.05, COIL_Z),
            v3(0.84, 0.04, 0.07),
            0.01,
            1.,
            STEEL_DK,
        );
        for x in [-0.43, 0.43] {
            b.bbox(
                M4::t(x, COIL_Y - 0.02, COIL_Z),
                v3(0.04, 0.1, 0.07),
                0.01,
                1.,
                STEEL,
            );
        }
        let coils = b.upload(gl);
        for i in 0..COILS {
            let x = -0.36 + 0.72 * i as f32 / (COILS - 1) as f32;
            b.bbox(
                M4::t(x, COIL_Y, COIL_Z),
                v3(0.022, 0.075, 0.05),
                0.006,
                1.,
                [1.; 3],
            );
        }
        let fins = b.upload(gl);

        // The jet capacitors: a cage of thin bars between steel caps, its charge a column of light
        // inside (open, so the light shows), a dark core when empty.
        for c in CAPS {
            let m = M4::t(c[0], c[1], c[2]) * M4::rz(c[0].signum() * -0.35);
            b.cyl(m * M4::s(0.03, CAP_H, 0.03), GLASS, 6, 1.);
            for k in 0..5 {
                let a = k as f32 / 5. * TAU;
                let (x, z) = (a.cos() * 0.036, a.sin() * 0.036);
                let (lo, hi) = (
                    m.apply(v3(x, -CAP_H * 0.5, z)),
                    m.apply(v3(x, CAP_H * 0.5, z)),
                );
                b.rod(lo, hi, 0.008, 4, STEEL_LT);
            }
            for y in [CAP_H * 0.5 + 0.012, -CAP_H * 0.5 - 0.012] {
                b.cyl(
                    m * M4::t(0., y, 0.) * M4::s(0.085, 0.024, 0.085),
                    STEEL_LT,
                    10,
                    1.,
                );
            }
        }
        let caps = b.upload(gl);
        b.cyl(
            M4::t(0., 0.5, 0.) * M4::s(0.058, 1., 0.058),
            [1.; 3],
            10,
            1.,
        );
        let fill = b.upload(gl);

        // Steam: a soft lump.
        b.lump(M4::ID, [1.; 3], 1, 0.25, 5.);
        let puff = b.upload(gl);

        // Cracks across the eye, in three stages, as the torso is hurt.
        let z = WIN[2] - 0.015;
        crack(&mut b, v3(-0.55, -0.32, z), 2.2, 9, 1., true);
        let c1 = b.upload(gl);
        crack(&mut b, v3(-0.55, -0.32, z), 1.2, 7, 3., true);
        crack(&mut b, v3(0.62, -0.2, z), 0.4, 8, 5., true);
        let c2 = b.upload(gl);
        crack(&mut b, v3(0.5, 0.3, z), -2.3, 10, 9., true);
        crack(&mut b, v3(-0.1, 0.42, z), -1.3, 8, 11., true);
        let c3 = b.upload(gl);

        // The tag: three links of chain down from the hook, then the plate, in the accent.
        let acc = chassis(Ch::Kestrel).acc;
        let dk = [acc[0] * 0.5, acc[1] * 0.5, acc[2] * 0.5];
        for k in 0..3 {
            let y = -0.025 - k as f32 * 0.045;
            let m = M4::t(0., y, 0.) * M4::ry(k as f32 * 1.57);
            b.bbox(m, v3(0.012, 0.04, 0.02), 0.003, 1., STEEL_LT);
        }
        b.bbox(M4::t(0., -0.19, 0.), v3(0.075, 0.1, 0.008), 0.008, 1., acc);
        b.bbox(
            M4::t(0., -0.175, -0.006),
            v3(0.05, 0.008, 0.004),
            0.002,
            1.,
            dk,
        );
        b.bbox(
            M4::t(0., -0.2, -0.006),
            v3(0.04, 0.008, 0.004),
            0.002,
            1.,
            dk,
        );
        let tag = b.upload(gl);
        Cockpit {
            frame,
            lid_top,
            lid_bot,
            coils,
            fins,
            caps,
            fill,
            puff,
            cracks: [c1, c2, c3],
            tag,
            swing_x: Spring::new(26., 0.1),
            swing_z: Spring::new(26., 0.1),
            lids: Spring::new(220., 0.7),
            torso_was: 1.,
            t: -1.,
            eye: V3::ZERO,
            vel: V3::ZERO,
            dir: v3(0., 0., 1.),
            up: v3(0., 1., 0.),
        }
    }

    /// Draws the head round the eye. `right`, `up`, `dir` are the camera's own axes this frame;
    /// `pose` forces a reading (the tools' mockups).
    #[allow(clippy::too_many_arguments)]
    pub fn draw(
        &mut self,
        gl: &mut Gl,
        m: &Mech,
        time: f32,
        eye: V3,
        right: V3,
        up: V3,
        dir: V3,
        pose: Option<u8>,
    ) {
        let r = pose.map_or_else(|| Reading::of(m), Reading::pose);
        let left = right * -1.;
        let view = M4([
            left.x, left.y, left.z, 0., up.x, up.y, up.z, 0., dir.x, dir.y, dir.z, 0., eye.x,
            eye.y, eye.z, 1.,
        ]);
        let dt = time - self.t;
        if (0.0..0.1).contains(&dt) && dt > 0. {
            let vel = (eye - self.eye) * (1. / dt);
            let acc = (vel - self.vel) * (1. / dt);
            self.vel = vel;
            let lim = |a: f32| a.clamp(-80., 80.);
            // The tag: jolts, turns and tips leave it behind; a footfall sets it bobbing.
            self.swing_z.v += lim(acc.dot(right)) * 0.03 * dt;
            self.swing_x.v += lim(acc.dot(dir)) * 0.03 * dt;
            let (yaw, pitch, roll) = (
                (dir - self.dir).dot(right) / dt,
                (dir - self.dir).dot(up) / dt,
                (up - self.up).dot(right) / dt,
            );
            self.swing_z.v += (yaw * 0.8 - roll * 1.2).clamp(-6., 6.) * dt * 20.;
            self.swing_x.v -= pitch.clamp(-6., 6.) * dt * 16.;
            let sway = if self.swing_z.x >= 0. { 1. } else { -1. };
            self.swing_z.v += lim(-acc.dot(up)).max(0.) * 0.006 * dt * sway;
            self.swing_x.step(dt, 0.);
            self.swing_z.step(dt, 0.);
            self.swing_x.x = self.swing_x.x.clamp(-0.9, 0.9);
            self.swing_z.x = self.swing_z.x.clamp(-0.9, 0.9);
            // The lids: toward their squint, and a flinch-blink when the torso is hit.
            if r.torso < self.torso_was - 0.005 {
                self.lids.v += 9.;
            }
            self.lids.step(dt, lids_for(&r));
            self.lids.x = self.lids.x.clamp(0., 1.);
        } else if !(0.0..0.1).contains(&dt) {
            self.vel = V3::ZERO;
            self.lids.x = lids_for(&r);
        }
        if pose.is_some() {
            self.lids.x = lids_for(&r); // a mockup shows the pose at rest
        }
        self.torso_was = r.torso;
        self.t = time;
        self.eye = eye;
        (self.dir, self.up) = (dir, up);

        gl.mode(Mode::Lit);
        gl.world(false);
        gl.draw_plain(&self.frame, &view);
        gl.draw_plain(&self.coils, &view);
        gl.draw_plain(&self.caps, &view);
        // The lids, from behind the ring toward the middle of the eye.
        let shut = self.lids.x;
        let gap = WIN[1] * 1.04 * (1. - shut);
        gl.draw_plain(&self.lid_top, &(view * M4::t(0., gap, LID_Z)));
        gl.draw_plain(&self.lid_bot, &(view * M4::t(0., -gap, LID_Z)));
        let tag = view
            * M4::t(HOOK[0], HOOK[1], HOOK[2])
            * M4::rx(self.swing_x.x)
            * M4::rz(self.swing_z.x);
        gl.draw_plain(&self.tag, &tag);
        // Cracks, as the torso is hurt.
        let stage = [0.75, 0.5, 0.25].iter().filter(|&&k| r.torso < k).count();
        for c in &self.cracks[..stage] {
            gl.draw_plain(c, &view);
        }

        // The coils glow with the heat (flickering when critical); off, they cool to a dull red.
        let heat = if r.off { r.heat.min(0.5) } else { r.heat };
        let (col, glows) = coil_colour(heat);
        let flicker = if heat > 0.85 {
            0.85 + 0.15 * (time * 37.).sin()
        } else {
            1.
        };
        gl.mode(if glows { Mode::Emissive } else { Mode::Lit });
        let c = col.map(|v| v * flicker);
        gl.draw(&self.fins, &view, c, if glows { 1. } else { 0. });
        // The capacitors fill with the jets' charge, and hum bright when full.
        for cap in CAPS {
            let m = view * M4::t(cap[0], cap[1], cap[2]) * M4::rz(cap[0].signum() * -0.35);
            let f = if r.off { 0. } else { r.fuel };
            if f > 0.02 {
                let hum = if f >= 1. {
                    0.85 + 0.15 * (time * 9.).sin()
                } else {
                    0.6
                };
                gl.mode(Mode::Emissive);
                let at = m * M4::t(0., -CAP_H * 0.5, 0.) * M4::s(1., CAP_H * f, 1.);
                gl.draw(&self.fill, &at, CHARGE.map(|v| v * hum), 1.);
            }
        }
        // Steam, when critical: puffs rising off the coils and thinning out.
        if heat > 0.85 && !r.off {
            gl.mode(Mode::Lit);
            for k in 0..6 {
                let ph = (time * 0.8 + k as f32 * 0.37).fract();
                let x = -0.3 + 0.12 * k as f32 + (time * 2. + k as f32).sin() * 0.03;
                let at = view
                    * M4::t(x, COIL_Y + 0.03 + ph * 0.32, COIL_Z - 0.02)
                    * M4::s1(0.05 + ph * 0.1);
                let solid = ((1. - ph) * 16.).round().clamp(1., 15.);
                gl.draw(&self.puff, &at, [0.78, 0.8, 0.82], 0.4 + 2. * solid);
            }
        }
        gl.mode(Mode::Lit);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_lids_rest_open_squint_when_hot_and_shut_when_off() {
        let cool = lids_for(&Reading::pose(0));
        let hot = lids_for(&Reading::pose(1));
        let critical = lids_for(&Reading::pose(2));
        assert!(cool < 0.1, "open at rest: {cool}");
        assert!(
            cool < hot && hot < critical && critical < 0.5,
            "a squint, not shut"
        );
        assert_eq!(lids_for(&Reading::pose(3)), 1.);
    }
    #[test]
    fn the_coils_go_from_cold_steel_through_red_and_orange_to_near_white() {
        assert!(!coil_colour(0.1).1);
        let (red, _) = coil_colour(0.5);
        let (orange, _) = coil_colour(0.78);
        let (white, _) = coil_colour(1.);
        assert!(red[0] > red[1] * 3.);
        assert!(orange[1] > red[1] && white[2] > orange[2]);
    }
}
