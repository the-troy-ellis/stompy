//! The cockpit: the demigod's own head, seen from inside, in 3D (docs/specs/05-cockpit.md).
//! Built in the view's own space (x to the left, y up, z ahead, metres from the eye: a
//! right-handed frame, so faces keep their winding) and drawn with the camera, so every kick, bob
//! and shake moves it with you. Drawing only.
//!
//! There is no pilot (docs/world.md), so nothing in here is an instrument for one. The machine
//! shows its state through its own workings: eyelids that squint when it runs hot, slam shut on
//! a shutdown and flinch when hit, and between those make its face (a glare, a worried tilt, a
//! smug smile after a kill, a sleepy droop, a blink); heat coils under the eye that glow dull red to white and
//! steam when critical; two jet capacitors that fill with light; cracks across the eye as it is
//! hurt; and the maintenance tag the tiny robots tied on, swinging. BARRY's, so far.
use crate::gl::{Gl, Mesh, Mode};
use crate::mesh::Builder;
use stompy_sim::data::{chassis, Ch, Sec};
use stompy_sim::math::*;
use stompy_sim::spring::Spring;
use stompy_sim::{Game, Mech};

const STEEL: [f32; 3] = [0.24, 0.26, 0.31];
const STEEL_DK: [f32; 3] = [0.13, 0.14, 0.17];
const STEEL_LT: [f32; 3] = [0.38, 0.41, 0.47];
const GLASS: [f32; 3] = [0.1, 0.14, 0.17];
const CHARGE: [f32; 3] = [0.45, 1., 0.85];

/// The porthole: an oval window this wide and tall at this distance from the eye.
const WIN: [f32; 3] = [0.88, 0.5, 1.0];
/// The tag's hook, at the top of the window, outside the eyelids: they close over it.
const HOOK: [f32; 3] = [0.14, 0.62, 1.2];
/// How far the tag may swing in toward the eye before it would touch the lids.
const TAG_IN: f32 = 0.3;
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
    /// The tools' mockups: 0 cool, 1 hot, 2 critical, 3 shut down, 4 hurt; 5 on are moods (and 11,
    /// 12 a blink), cool.
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
/// What the eyelids are doing, besides the heat.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Mood {
    Relaxed,
    /// Firing or zoomed in: a V.
    Glare,
    /// A target locked: a milder V.
    Lock,
    /// Badly hurt: the other tilt, the outer ends low.
    Worried,
    /// A beat after a kill: the bottom lid rises in an arch, an eye that smiles.
    Pleased,
    /// Standing about: a heavy droop.
    Sleepy,
    /// A big hit: wide open for a moment, before the flinch.
    Surprised,
}
impl Mood {
    /// The tools' mockups, poses 5 on.
    pub fn pose(n: u8) -> Option<Mood> {
        Some(match n {
            5 => Mood::Glare,
            6 => Mood::Worried,
            7 => Mood::Pleased,
            8 => Mood::Sleepy,
            9 => Mood::Surprised,
            10 => Mood::Lock,
            _ => return None,
        })
    }
}
/// The lids' shape. `top` and `bot` are how far each closes, 0 open to 1 at the middle of the eye.
/// `tilt` turns the top lid's halves: positive about their outer ends, the inner ends down (a V);
/// negative about the middle, the outer ends down (a tent). `smile` turns the bottom lid's the
/// same way: positive, the inner ends up (an arch); negative, the outer ends up.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Face {
    pub top: f32,
    pub bot: f32,
    pub tilt: f32,
    pub smile: f32,
}
pub fn face(m: Mood) -> Face {
    let f = |top, bot, tilt, smile| Face {
        top,
        bot,
        tilt,
        smile,
    };
    match m {
        Mood::Relaxed => f(0.12, 0.06, 0., 0.),
        Mood::Glare => f(0.22, 0.1, 0.2, 0.),
        Mood::Lock => f(0.16, 0.08, 0.1, 0.),
        Mood::Worried => f(0.16, 0.06, -0.24, 0.),
        Mood::Pleased => f(0.14, 0.3, 0., 0.16),
        Mood::Sleepy => f(0.34, 0.1, -0.07, 0.),
        Mood::Surprised => f(-0.06, -0.06, -0.04, 0.),
    }
}
/// What the face can see of the machine this frame, beyond the reading.
#[derive(Clone, Copy, Debug, Default)]
pub struct Cue {
    /// Fired in the last moment, or zoomed in.
    pub attacking: bool,
    pub locked: bool,
    /// Seconds since the player's last kill (large if none).
    pub since_kill: f32,
    /// Seconds since anything was touched.
    pub idle: f32,
    /// A big hit just landed.
    pub struck: bool,
}
/// The mood, by priority: a big hit, a kill a beat ago (the joke comes after the fact), a fight,
/// a bad hurt, a lock, standing about.
pub fn mood_for(r: &Reading, c: &Cue) -> Mood {
    if c.struck {
        Mood::Surprised
    } else if (0.5..3.5).contains(&c.since_kill) {
        Mood::Pleased
    } else if c.attacking {
        Mood::Glare
    } else if r.torso < 0.3 {
        Mood::Worried
    } else if c.locked {
        Mood::Lock
    } else if c.idle > 8. {
        Mood::Sleepy
    } else {
        Mood::Relaxed
    }
}
/// How far the heat squints the eye, 0 to 0.3, as it climbs past 55.
pub fn squint(heat: f32) -> f32 {
    0.3 * smooth((heat - 0.55) / 0.42)
}
/// The lids for a reading and a mood: the mood's face, the heat's squint over it, and shut flat
/// when the machine is off.
pub fn lids_for(r: &Reading, m: Mood) -> Face {
    if r.off {
        return Face {
            top: 1.,
            bot: 1.,
            tilt: 0.,
            smile: 0.,
        };
    }
    let f = face(m);
    let q = squint(r.heat);
    Face {
        top: f.top + q * (1. - f.top),
        bot: f.bot + q * (1. - f.bot),
        ..f
    }
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
    /// The eyelids in halves, so they can tilt: top left, top right, bottom left, bottom right.
    lids: [Mesh; 4],
    coils: Mesh,
    fins: Mesh,
    caps: Mesh,
    fill: Mesh,
    puff: Mesh,
    cracks: [Mesh; 3],
    tag: Mesh,
    swing_x: Spring,
    swing_z: Spring,
    /// The face on springs: top, bottom, tilt, smile.
    face: [Spring; 4],
    torso_was: f32,
    hp_was: f32,
    kills_was: i32,
    kill_at: f32,
    fired_at: f32,
    busy_at: f32,
    /// A big hit holds the eye wide until then, and the flinch follows.
    struck_till: f32,
    blink_at: f32,
    blinks: u32,
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
/// How near the middle of the eye a lid's lip may come outside a blink, so no face covers the
/// crosshair.
const CLEAR: f32 = 0.24;
/// Where the lids' hinged ends sit (top, bottom: heights in the window) and how far each pair's
/// halves turn, for a face `[top, bot, tilt, smile]`. A V or an arch is held back so the lips'
/// inner ends stay `CLEAR` of the middle: a glare flattens as the heat squints the eye, rather
/// than closing over what it glares at. (A tent turns about the middle, which stays put.)
pub fn lid_edges([top, bot, tilt, smile]: [f32; 4]) -> [f32; 4] {
    let open = WIN[1] * 1.04;
    let (top_y, bot_y) = (open * (1. - top), -open * (1. - bot));
    let room = |y: f32| (y.abs() - CLEAR).clamp(0., 0.9).asin();
    [
        top_y,
        if top_y > 0. {
            tilt.min(room(top_y))
        } else {
            0.
        },
        bot_y,
        if bot_y < 0. {
            smile.min(room(bot_y))
        } else {
            0.
        },
    ]
}
/// A blink, `t` seconds in: a shutter, not a lid. It snaps shut in 0.05 s, holds, and opens in
/// 0.1 s; 0 outside it.
fn blink(t: f32) -> f32 {
    match t {
        t if (0.0..0.05).contains(&t) => t / 0.05,
        t if (0.05..0.08).contains(&t) => 1.,
        t if (0.08..0.18).contains(&t) => 1. - (t - 0.08) / 0.1,
        _ => 0.,
    }
}
impl Cockpit {
    /// The face straight to its shape, no springing (a fresh start, a mockup).
    fn snap(&mut self, r: &Reading, mood: Mood) {
        let f = lids_for(r, mood);
        for (sp, to) in self.face.iter_mut().zip([f.top, f.bot, f.tilt, f.smile]) {
            sp.x = to;
            sp.v = 0.;
        }
    }
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

        // The eyelids: each a pair of plates hinged at their outer ends, their leading edges at
        // y 0, overlapping a little in the middle so a tilt opens no gap; a rolled lip, two ribs,
        // and the piston that works it. The bottom pair is built upside down, not mirrored.
        let mut lids = Vec::new();
        for s in [1., -1.] {
            for h in [1., -1.] {
                b.bbox(
                    M4::t(h * 0.5, s * 0.38, 0.),
                    v3(1.0, 0.76, 0.03),
                    0.01,
                    1.,
                    STEEL,
                );
                // A slanted tail past the middle: when the halves tent (a blink, a worry), their
                // inner edges lean apart, and the tails cover the gap.
                b.tri(
                    v3(0., 0., -0.012),
                    v3(0., s * 0.76, -0.012),
                    v3(h * -0.55, s * 0.76, -0.012),
                    STEEL,
                    Some(v3(0., 0., 5.)),
                    false,
                );
                b.rod(
                    v3(h * -0.02, 0., -0.02),
                    v3(h, 0., -0.02),
                    0.05,
                    8,
                    STEEL_LT,
                );
                for x in [0.14, 0.56] {
                    b.bbox(
                        M4::t(h * x, s * 0.3, -0.03),
                        v3(0.05, 0.5, 0.03),
                        0.01,
                        1.,
                        STEEL_DK,
                    );
                }
                b.rod(
                    v3(h * 0.34, s * 0.08, -0.05),
                    v3(h * 0.4, s * 0.62, -0.05),
                    0.04,
                    6,
                    STEEL_LT,
                );
                lids.push(b.upload(gl));
            }
        }
        let lids: [Mesh; 4] = lids.try_into().ok().unwrap();

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

        // The tag: six links of chain down from the hook, then the plate, in the accent.
        let acc = chassis(Ch::Kestrel).acc;
        let dk = [acc[0] * 0.5, acc[1] * 0.5, acc[2] * 0.5];
        for k in 0..6 {
            let y = -0.025 - k as f32 * 0.045;
            let m = M4::t(0., y, 0.) * M4::ry(k as f32 * 1.57);
            b.bbox(m, v3(0.012, 0.04, 0.02), 0.003, 1., STEEL_LT);
        }
        b.bbox(M4::t(0., -0.33, 0.), v3(0.075, 0.1, 0.008), 0.008, 1., acc);
        b.bbox(
            M4::t(0., -0.315, -0.006),
            v3(0.05, 0.008, 0.004),
            0.002,
            1.,
            dk,
        );
        b.bbox(
            M4::t(0., -0.34, -0.006),
            v3(0.04, 0.008, 0.004),
            0.002,
            1.,
            dk,
        );
        let tag = b.upload(gl);
        Cockpit {
            frame,
            lids,
            coils,
            fins,
            caps,
            fill,
            puff,
            cracks: [c1, c2, c3],
            tag,
            swing_x: Spring::new(26., 0.1),
            swing_z: Spring::new(26., 0.1),
            face: [
                Spring::new(220., 0.7),
                Spring::new(220., 0.7),
                Spring::new(120., 0.6),
                Spring::new(90., 0.5),
            ],
            torso_was: 1.,
            hp_was: 1.,
            kills_was: 0,
            kill_at: -100.,
            fired_at: -100.,
            busy_at: 0.,
            struck_till: -1.,
            blink_at: 3.,
            blinks: 0,
            t: -1.,
            eye: V3::ZERO,
            vel: V3::ZERO,
            dir: v3(0., 0., 1.),
            up: v3(0., 1., 0.),
        }
    }

    /// Draws the player's head round the eye. `right`, `up`, `dir` are the camera's own axes this
    /// frame; `pose` forces a reading or a mood (the tools' mockups).
    #[allow(clippy::too_many_arguments)]
    pub fn draw(
        &mut self,
        gl: &mut Gl,
        g: &Game,
        eye: V3,
        right: V3,
        up: V3,
        dir: V3,
        pose: Option<u8>,
    ) {
        let (m, time) = (g.p(), g.time);
        let r = match pose {
            Some(n) if n >= 5 => Reading::pose(0),
            Some(n) => Reading::pose(n),
            None => Reading::of(m),
        };
        // What the face can see: the triggers, the stick, kills and hits.
        let fresh = !(0.0..0.1).contains(&(time - self.t));
        let i = &g.input;
        if i.energy || i.ballistic || i.missile || i.fusion || i.punch {
            self.fired_at = time;
        }
        let touched = [i.thr, i.turn, i.twist, i.pitch]
            .iter()
            .any(|v| v.abs() > 0.05)
            || i.twist_by != 0.
            || i.pitch_by != 0.
            || i.jets
            || time - self.fired_at < 0.1;
        if touched || fresh {
            self.busy_at = time;
        }
        if fresh {
            self.kills_was = g.stats.kills;
            self.struck_till = -1.;
        } else if g.stats.kills > self.kills_was {
            self.kills_was = g.stats.kills;
            self.kill_at = time;
        }
        let hp = m.hp.iter().sum::<f32>() / m.max.iter().sum::<f32>().max(1.);
        if !fresh && hp < self.hp_was - 0.04 {
            self.struck_till = time + 0.3;
        }
        let struck = self.struck_till > time;
        if time >= self.blink_at + 0.18 {
            // The next blink, 2.5 to 6.5 seconds on.
            self.blinks += 1;
            let h = (self.blinks as f32 * 12.9898).sin() * 43758.547;
            self.blink_at = time + 2.5 + 4. * (h - h.floor());
        }
        let cue = Cue {
            attacking: time - self.fired_at < 1.2 || g.zoom,
            locked: g.target.is_some(),
            since_kill: time - self.kill_at,
            idle: time - self.busy_at,
            struck,
        };
        let mood = match pose {
            Some(n) => Mood::pose(n).unwrap_or(Mood::Relaxed),
            None => mood_for(&r, &cue),
        };
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
            self.swing_x.x = self.swing_x.x.clamp(-0.9, TAG_IN);
            self.swing_z.x = self.swing_z.x.clamp(-0.9, 0.9);
            // The face: toward the mood's shape, with the heat's squint over it.
            let f = lids_for(&r, mood);
            for (sp, to) in self.face.iter_mut().zip([f.top, f.bot, f.tilt, f.smile]) {
                sp.step(dt, to);
            }
            // A hit flinches the lids (a big one after its moment wide open).
            if r.torso < self.torso_was - 0.005 && !struck {
                self.face[0].kick(9.);
            }
            if self.struck_till > 0. && time >= self.struck_till {
                self.struck_till = -1.;
                self.face[0].kick(12.);
            }
            for sp in &mut self.face[..2] {
                sp.x = sp.x.clamp(-0.1, 1.);
            }
        } else if !(0.0..0.1).contains(&dt) {
            self.vel = V3::ZERO;
            self.snap(&r, mood);
        }
        if pose.is_some() {
            self.snap(&r, mood); // a mockup shows the pose at rest
        }
        self.hp_was = hp;
        self.torso_was = r.torso;
        self.t = time;
        self.eye = eye;
        (self.dir, self.up) = (dir, up);

        gl.mode(Mode::Lit);
        gl.world(false);
        gl.draw_plain(&self.frame, &view);
        gl.draw_plain(&self.coils, &view);
        gl.draw_plain(&self.caps, &view);
        // The lids, from behind the ring toward the middle of the eye, each half turned about
        // its outer end (a V, an arch) or the middle (a tent). A blink is an aperture: both lids
        // snap to the middle, their outer ends leading, so the eye closes as a shrinking diamond.
        let k = match pose {
            Some(11) => 0.5, // the tools' mockups: a blink half shut, nearly shut
            Some(12) => 0.85,
            Some(_) => 0.,
            None if r.off => 0.,
            None => blink(time - self.blink_at),
        };
        let [top_y, tilt, bot_y, smile] = lid_edges(self.face.map(|sp| sp.x));
        let (top_y, bot_y) = (top_y * (1. - k), bot_y * (1. - k));
        let d = (k * 2.).min(1.);
        let (tilt, smile) = (tilt + (-0.4 - tilt) * d, smile + (-0.4 - smile) * d);
        let pivot = |a: f32, h: f32| if a > 0. { h } else { 0. };
        let halves = [
            (top_y, pivot(tilt, 1.), tilt, 0.),
            (top_y, pivot(tilt, -1.), -tilt, 0.004),
            (bot_y, pivot(smile, 1.), -smile, 0.),
            (bot_y, pivot(smile, -1.), smile, 0.004),
        ];
        for (mesh, (y, h, a, dz)) in self.lids.iter().zip(halves) {
            let at = view * M4::t(h, y, LID_Z + dz) * M4::rz(a) * M4::t(-h, 0., 0.);
            gl.draw_plain(mesh, &at);
        }
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
        let lids = |n| lids_for(&Reading::pose(n), Mood::Relaxed);
        let (cool, hot, critical) = (lids(0), lids(1), lids(2));
        assert!(cool.top <= 0.2 && cool.bot < 0.2, "open at rest: {cool:?}");
        assert!(
            cool.top < hot.top && hot.top < critical.top && critical.top < 0.5,
            "a squint, not shut"
        );
        let off = lids_for(&Reading::pose(3), Mood::Glare);
        assert_eq!((off.top, off.bot, off.tilt), (1., 1., 0.));
    }
    #[test]
    fn the_moods_make_shapes() {
        let (glare, worried, pleased) =
            (face(Mood::Glare), face(Mood::Worried), face(Mood::Pleased));
        assert!(
            glare.tilt > 0.15 && worried.tilt < -0.15,
            "a V and the other way"
        );
        assert!(
            pleased.smile > 0.15 && pleased.bot > 0.25,
            "the bottom lid rises in an arch"
        );
        assert!(face(Mood::Sleepy).top > 0.3, "a droop");
        assert!(
            face(Mood::Surprised).top < face(Mood::Relaxed).top,
            "wide open"
        );
    }
    #[test]
    fn the_mood_goes_by_priority() {
        let cool = Reading::pose(0);
        let hurt = Reading::pose(4);
        let calm = Cue {
            since_kill: 100.,
            ..Cue::default()
        };
        assert_eq!(mood_for(&cool, &calm), Mood::Relaxed);
        let idle = Cue { idle: 9., ..calm };
        assert_eq!(mood_for(&cool, &idle), Mood::Sleepy);
        let locked = Cue {
            locked: true,
            ..idle
        };
        assert_eq!(mood_for(&cool, &locked), Mood::Lock);
        assert_eq!(mood_for(&hurt, &locked), Mood::Worried);
        let fighting = Cue {
            attacking: true,
            ..locked
        };
        assert_eq!(mood_for(&hurt, &fighting), Mood::Glare);
        // The joke comes after the fact: not the instant of the kill, a beat later, and not long.
        let kill = |t| Cue {
            since_kill: t,
            ..fighting
        };
        assert_eq!(mood_for(&cool, &kill(0.2)), Mood::Glare);
        assert_eq!(mood_for(&cool, &kill(1.)), Mood::Pleased);
        assert_eq!(mood_for(&cool, &kill(5.)), Mood::Glare);
        let hit = Cue {
            struck: true,
            ..kill(1.)
        };
        assert_eq!(mood_for(&cool, &hit), Mood::Surprised);
    }
    #[test]
    fn no_face_covers_the_crosshair_however_hot() {
        for m in [
            Mood::Relaxed,
            Mood::Glare,
            Mood::Lock,
            Mood::Worried,
            Mood::Pleased,
            Mood::Sleepy,
            Mood::Surprised,
        ] {
            for heat in [0., 0.6, 0.8, 0.99] {
                let r = Reading {
                    heat,
                    ..Reading::pose(0)
                };
                let f = lids_for(&r, m);
                let [top_y, tilt, bot_y, smile] = lid_edges([f.top, f.bot, f.tilt, f.smile]);
                // The lips' inner ends, one unit in from the hinges (a tent turns about them).
                let (top_mid, bot_mid) = (top_y - tilt.max(0.).sin(), bot_y + smile.max(0.).sin());
                assert!(
                    top_mid > 0.2 && bot_mid < -0.2,
                    "{m:?} at {heat}: {top_mid} {bot_mid}"
                );
            }
        }
    }
    #[test]
    fn a_blink_snaps_shut_holds_and_opens() {
        assert_eq!(blink(-0.01), 0.);
        assert!(
            (blink(0.025) - 0.5).abs() < 0.01,
            "shut in a twentieth of a second"
        );
        assert_eq!(blink(0.06), 1.);
        assert!((blink(0.13) - 0.5).abs() < 0.01, "open again over a tenth");
        assert_eq!(blink(0.19), 0.);
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
