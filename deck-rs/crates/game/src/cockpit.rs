//! The cockpit: the demigod's own head, seen from inside, in 3D (docs/specs/05-cockpit.md).
//! Built in the view's own space (x to the left, y up, z ahead, metres from the eye: a
//! right-handed frame, so faces keep their winding) and drawn with the camera, so every kick, bob
//! and shake moves it with you. Drawing only.
//!
//! There is no pilot (docs/world.md), so nothing in here is an instrument for one. The machine
//! shows its state through its own workings: a six-blade iris that squints when it runs hot,
//! twists shut on a shutdown and flinches when hit, and between those makes its face (a glare, a
//! worried peak, a smug dome after a kill, a sleepy droop, a blink); heat coils under the eye that glow dull red to white and
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

/// The porthole: a rounded-square window (a superellipse) this wide and tall at this distance
/// from the eye. Wide, so the battle shows (the owner, 2026-11-28: it was hard to see).
const WIN: [f32; 3] = [0.95, 0.57, 1.0];
/// How square the window's corners are: 2 is an oval, higher fills the corners.
const SQUARE: f32 = 3.5;
/// The tag's hook, at the top of the window, outside the iris: it closes over it.
const HOOK: [f32; 3] = [0.14, 0.74, 1.26];
/// How far the tag may swing in toward the eye before it would touch the iris.
const TAG_IN: f32 = 0.15;
/// The iris sits just behind the lip, so the ring covers the blades' outer parts.
const IRIS_Z: f32 = 1.1;
/// The blades, round from the top: the way each one's edge faces (the normal pointing out of the
/// opening, in the view's x-left frame) when the iris is at rest.
const BLADES: [f32; 6] = [
    90f32.to_radians(),
    150f32.to_radians(),
    210f32.to_radians(),
    270f32.to_radians(),
    330f32.to_radians(),
    30f32.to_radians(),
];
/// Each blade's own stiffness, so they ripple rather than move as one.
const BLADE_K: [f32; 6] = [1., 0.86, 1.12, 0.94, 1.06, 0.9];
/// The blade that sticks when the head is hurt.
const STICKY: usize = 4;
/// The heat coils: a row of fins across the bottom of the eye.
const COILS: usize = 9;
const COIL_Y: f32 = -0.5;
const COIL_Z: f32 = 0.93;
/// The jet capacitors, either side of the coils at the bottom of the eye.
const CAPS: [[f32; 3]; 2] = [[0.47, -0.47, 0.95], [-0.47, -0.47, 0.95]];
const CAP_H: f32 = 0.12;

/// What the head shows, from the machine (or forced, for the tools' mockups).
#[derive(Clone, Copy)]
pub struct Reading {
    /// 0 cold to 1 at shutdown and past.
    pub heat: f32,
    /// The jets' charge, 0 to 1 (1 ready).
    pub fuel: f32,
    /// How much of the torso is left, 0 to 1.
    pub torso: f32,
    /// Shut down or dead: the iris twists shut and everything goes dark.
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
/// What the iris is doing, besides the heat.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Mood {
    Relaxed,
    /// Firing or zoomed in: a slight squint from the top. Subtle.
    Glare,
    /// A target locked: the iris tightens a touch, focusing. Subtle.
    Lock,
    /// Close to destroyed: the top blade pulls back and the upper pair close in, a peak that
    /// grows as the torso goes, the blades trembling. Strong.
    Worried,
    /// A beat after a kill: the bottom blades rise a little, an eye that smiles. Subtle.
    Pleased,
    /// Standing about: the top droops a little. Subtle.
    Sleepy,
    /// A big hit: the iris clamps in hard for a moment. Strong.
    Pain,
}
impl Mood {
    /// The tools' mockups, poses 5 on.
    pub fn pose(n: u8) -> Option<Mood> {
        Some(match n {
            5 => Mood::Glare,
            6 => Mood::Worried,
            7 => Mood::Pleased,
            8 => Mood::Sleepy,
            9 => Mood::Pain,
            10 => Mood::Lock,
            _ => return None,
        })
    }
}
/// The iris's shape: for each blade, round from the top, how open it is (`r`: 1 has its edge
/// touching the window's oval, 0 at the middle) and how far it has turned (`phi`, radians, from
/// its rest). The opening is what all six edges leave: a hexagon, always convex.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Iris {
    pub r: [f32; 6],
    pub phi: [f32; 6],
}
/// A face from: the top blade, the upper pair, the lower pair, the bottom blade (how open), the
/// upper pair turned toward level (a flatter roof), the lower pair
/// turned toward level (a flat keel).
fn shape(top: f32, upper: f32, lower: f32, bottom: f32, roof: f32, keel: f32) -> Iris {
    Iris {
        r: [top, upper, lower, bottom, lower, upper],
        phi: [0., -roof, keel, 0., -keel, roof],
    }
}
pub fn iris(m: Mood) -> Iris {
    match m {
        // The everyday faces are small shifts (the owner, 2026-11-28: subtle, except for pain
        // or being close to destroyed).
        Mood::Relaxed => shape(0.98, 1., 1., 1., 0., 0.),
        Mood::Lock => shape(0.94, 0.94, 0.97, 0.97, 0., 0.),
        Mood::Glare => shape(0.86, 0.9, 1., 0.97, 0.15, 0.),
        Mood::Pleased => shape(1., 1., 0.92, 0.86, 0., 0.15),
        Mood::Sleepy => shape(0.8, 0.9, 1., 1., 0.2, 0.),
        Mood::Worried => shape(1.1, 0.5, 0.88, 0.84, 0.3, 0.),
        Mood::Pain => shape(0.45, 0.5, 0.58, 0.5, 0.2, 0.15),
    }
}
/// How far the window reaches along direction `a`: a blade's edge at `r` 1 just touches it.
fn reach(a: f32) -> f32 {
    let n = v3(a.cos(), a.sin(), 0.);
    (0..64)
        .map(|i| oval(i as f32 / 64. * TAU, 1., 0.).dot(n))
        .fold(0., f32::max)
}
/// How near the middle of the eye a blade's edge may come outside a blink, so no face covers the
/// crosshair.
const CLEAR: f32 = 0.24;
/// The blades' edges for an iris: each one's facing and its distance from the middle.
pub fn edges(i: &Iris) -> [(f32, f32); 6] {
    std::array::from_fn(|k| {
        let a = BLADES[k] + i.phi[k];
        (a, i.r[k] * reach(a))
    })
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
/// Below this much torso the machine is close to destroyed, and shows it.
const DYING: f32 = 0.35;
/// How close to destroyed, 0 (not yet) to 1 (nearly gone).
pub fn dying(torso: f32) -> f32 {
    smooth((DYING - torso) / (DYING - 0.05))
}
/// The mood, by priority: pain, then being close to destroyed (the strong ones), then a kill a
/// beat ago (the joke comes after the fact), a fight, a lock, standing about.
pub fn mood_for(r: &Reading, c: &Cue) -> Mood {
    if c.struck {
        Mood::Pain
    } else if r.torso < DYING {
        Mood::Worried
    } else if (0.5..3.5).contains(&c.since_kill) {
        Mood::Pleased
    } else if c.attacking {
        Mood::Glare
    } else if c.locked {
        Mood::Lock
    } else if c.idle > 8. {
        Mood::Sleepy
    } else {
        Mood::Relaxed
    }
}
/// How far the heat squints the eye, 0 to 0.22, as it climbs past 55.
pub fn squint(heat: f32) -> f32 {
    0.22 * smooth((heat - 0.55) / 0.42)
}
/// The iris for a reading and a mood: the mood's shape and the heat's squint over it (the top and
/// bottom blades most), every edge held `CLEAR` of the middle; twisted shut when the machine is
/// off.
pub fn iris_for(r: &Reading, m: Mood) -> Iris {
    if r.off {
        return Iris {
            r: [0.; 6],
            phi: [0.6; 6],
        };
    }
    let mut i = iris(m);
    if m == Mood::Worried {
        // The peak grows as the torso goes.
        let (rest, s) = (iris(Mood::Relaxed), dying(r.torso).max(0.15));
        for k in 0..6 {
            i.r[k] = rest.r[k] + (i.r[k] - rest.r[k]) * s;
            i.phi[k] = rest.phi[k] + (i.phi[k] - rest.phi[k]) * s;
        }
    }
    let q = squint(r.heat);
    for (k, w) in [1., 0.6, 0.4, 0.8, 0.4, 0.6].into_iter().enumerate() {
        let a = BLADES[k] + i.phi[k];
        i.r[k] = (i.r[k] * (1. - q * w)).max(CLEAR / reach(a));
    }
    i
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
    /// One iris blade, drawn six times.
    blade: Mesh,
    coils: Mesh,
    fins: Mesh,
    caps: Mesh,
    fill: Mesh,
    puff: Mesh,
    cracks: [Mesh; 3],
    tag: Mesh,
    swing_x: Spring,
    swing_z: Spring,
    /// The iris on springs, a pair for each blade: how open, how turned.
    r: [Spring; 6],
    phi: [Spring; 6],
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
/// A point of the window's edge at angle `a`, scaled by `k`, at depth `z`.
fn oval(a: f32, k: f32, z: f32) -> V3 {
    let e = 2. / SQUARE;
    let (c, s) = (a.cos(), a.sin());
    v3(
        c.signum() * c.abs().powf(e) * WIN[0] * k,
        s.signum() * s.abs().powf(e) * WIN[1] * k,
        z,
    )
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
/// A blink, `t` seconds in: an aperture. It snaps shut in 0.05 s, holds, and opens in
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
        let i = iris_for(r, mood);
        for (sp, to) in self
            .r
            .iter_mut()
            .zip(i.r)
            .chain(self.phi.iter_mut().zip(i.phi))
        {
            sp.x = to;
            sp.v = 0.;
        }
    }
    /// BARRY's head.
    pub fn barry(gl: &Gl) -> Cockpit {
        let n = 40;
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

        // An iris blade: a plate with its edge along x, reaching out along y, tipped a little in
        // depth along its length so six of them overlap each other round the circle, each over
        // the next, as an iris's do. A rolled edge, a rib, and the pin it turns on.
        let tip = |x: f32| v3(x, 0., x * 0.05);
        let at = |x: f32, y: f32| tip(x) + v3(0., y, 0.);
        b.quad(
            at(-1.7, 0.),
            at(1.7, 0.),
            at(1.7, 1.3),
            at(-1.7, 1.3),
            STEEL,
            v3(0., 0., 5.),
        );
        b.rod(tip(-1.7), tip(1.7), 0.012, 5, STEEL_LT);
        b.rod(
            at(-0.9, 0.16) - v3(0., 0., 0.01),
            at(0.5, 0.16) - v3(0., 0., 0.01),
            0.012,
            4,
            STEEL_DK,
        );
        b.sphere(
            M4::t(-0.62, 0.62, -0.62 * 0.05 - 0.02) * M4::s1(0.035),
            STEEL_LT,
            6,
            3,
        );
        let blade = b.upload(gl);

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
            let m = M4::t(c[0], c[1], c[2]);
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
            blade,
            coils,
            fins,
            caps,
            fill,
            puff,
            cracks: [c1, c2, c3],
            tag,
            swing_x: Spring::new(26., 0.1),
            swing_z: Spring::new(26., 0.1),
            r: BLADE_K.map(|k| Spring::new(220. * k, 0.7)),
            phi: BLADE_K.map(|k| Spring::new(140. * k, 0.7)),
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
            Some(6) => Reading {
                torso: 0.06,
                ..Reading::pose(0)
            },
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
            self.struck_till = time + 0.4;
        }
        let struck = self.struck_till > time;
        if time >= self.blink_at + 0.25 {
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
            // The iris: toward the mood's shape, with the heat's squint over it. Hurt, one blade
            // sticks and twitches.
            let mut to = iris_for(&r, mood);
            if r.torso < 0.5 && !r.off {
                to.r[STICKY] -= 0.05 * ((time * 11.).sin() * (time * 3.7).sin()).max(0.);
                self.r[STICKY].tune(60., 0.4);
            } else {
                self.r[STICKY].tune(220. * BLADE_K[STICKY], 0.7);
            }
            if mood == Mood::Worried {
                // Close to destroyed, the blades tremble, each on its own beat.
                let shake = 0.04 * dying(r.torso);
                for (k, v) in to.r.iter_mut().enumerate() {
                    *v += shake * (time * 9. + k as f32 * 1.7).sin();
                }
            }
            for k in 0..6 {
                self.r[k].step(dt, to.r[k]);
                self.phi[k].step(dt, to.phi[k]);
            }
            // A small hit flinches the iris a little; a big one is pain (the mood).
            if r.torso < self.torso_was - 0.005 && !struck {
                self.r.iter_mut().for_each(|sp| sp.kick(-2.));
            }
            for sp in &mut self.r {
                sp.x = sp.x.clamp(0., 1.2);
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
        // The iris: each blade's edge on its line, every blade sliding along it as it closes. A
        // blink twists the iris shut to a point and open again, the blades a moment apart.
        let k = |n: usize| match pose {
            Some(11) => 0.5, // the tools' mockups: a blink half shut, nearly shut
            Some(12) => 0.85,
            Some(_) => 0.,
            None if r.off => 0.,
            None => blink(time - self.blink_at - n as f32 * 0.01),
        };
        let now = Iris {
            r: std::array::from_fn(|n| self.r[n].x * (1. - k(n))),
            phi: std::array::from_fn(|n| self.phi[n].x + 0.6 * k(n)),
        };
        for (a, d) in edges(&now) {
            let n = v3(a.cos(), a.sin(), 0.);
            let at = view
                * M4::t(n.x * d, n.y * d, IRIS_Z)
                * M4::rz(a - std::f32::consts::FRAC_PI_2)
                * M4::t(0.4 * (1. - d / reach(a)), 0., 0.);
            gl.draw_plain(&self.blade, &at);
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
            let m = view * M4::t(cap[0], cap[1], cap[2]);
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
    fn the_iris_rests_open_squints_when_hot_and_shuts_when_off() {
        let at = |n| iris_for(&Reading::pose(n), Mood::Relaxed);
        let (cool, hot, critical) = (at(0), at(1), at(2));
        assert!(cool.r.iter().all(|&r| r > 0.9), "open at rest: {cool:?}");
        assert!(
            cool.r[0] > hot.r[0] && hot.r[0] > critical.r[0] && critical.r[0] > 0.5,
            "a squint, not shut"
        );
        let off = iris_for(&Reading::pose(3), Mood::Glare);
        assert!(off.r.iter().all(|&r| r == 0.), "shut");
    }
    #[test]
    fn the_moods_make_shapes() {
        let rest = iris(Mood::Relaxed);
        let (glare, pleased) = (iris(Mood::Glare), iris(Mood::Pleased));
        // The everyday faces are subtle: every blade within a fifth of rest, turned a little.
        for m in [Mood::Glare, Mood::Lock, Mood::Pleased, Mood::Sleepy] {
            let i = iris(m);
            for k in 0..6 {
                assert!((i.r[k] - rest.r[k]).abs() <= 0.2, "{m:?} blade {k}");
                assert!(i.phi[k].abs() <= 0.2, "{m:?} blade {k}");
            }
        }
        // But each still reads. The upper-left blade faces 150 degrees: toward level is less.
        assert!(
            glare.r[0] < rest.r[0] && glare.phi[1] < 0.,
            "the top comes down"
        );
        assert!(
            pleased.r[3] < rest.r[3] && pleased.phi[2] > 0.,
            "the bottom rises"
        );
        assert!(iris(Mood::Sleepy).r[0] < glare.r[0], "a droop");
        assert!(iris(Mood::Lock).r.iter().all(|&r| r < 0.98), "focusing");
        // Pain and being close to destroyed are strong.
        assert!(
            iris(Mood::Pain).r.iter().all(|&r| r < 0.6),
            "pain clamps in"
        );
        let worried = iris(Mood::Worried);
        assert!(worried.r[0] > 1. && worried.r[1] < 0.6, "a peak");
        // Every face is symmetric: blade k mirrors blade 6 - k.
        for m in [
            Mood::Glare,
            Mood::Worried,
            Mood::Pleased,
            Mood::Sleepy,
            Mood::Pain,
        ] {
            let i = iris(m);
            for k in 1..3 {
                assert_eq!(i.r[k], i.r[6 - k]);
                assert_eq!(i.phi[k], -i.phi[6 - k]);
            }
        }
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
        assert_eq!(mood_for(&cool, &fighting), Mood::Glare);
        // Close to destroyed outranks the everyday faces.
        assert_eq!(mood_for(&hurt, &fighting), Mood::Worried);
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
        assert_eq!(mood_for(&cool, &hit), Mood::Pain);
        assert_eq!(mood_for(&hurt, &hit), Mood::Pain);
    }
    #[test]
    fn the_closer_to_destroyed_the_stronger_the_peak() {
        let at = |torso| {
            iris_for(
                &Reading {
                    torso,
                    ..Reading::pose(0)
                },
                Mood::Worried,
            )
        };
        let (start, half, gone) = (at(0.34), at(0.2), at(0.05));
        assert!(start.r[1] > half.r[1] && half.r[1] > gone.r[1]);
        assert!(start.r[1] > 0.9, "it starts gently");
        assert_eq!(dying(0.5), 0.);
        assert_eq!(dying(0.04), 1.);
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
            Mood::Pain,
        ] {
            for heat in [0., 0.6, 0.8, 0.99] {
                let r = Reading {
                    heat,
                    ..Reading::pose(0)
                };
                for (a, d) in edges(&iris_for(&r, m)) {
                    assert!(
                        d >= CLEAR - 1e-4,
                        "{m:?} at {heat}: the blade at {a} is at {d}"
                    );
                }
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
