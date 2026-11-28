//! Detailed models, chassis by chassis, built on the same joints as `mesh.rs`'s boxes: every
//! pivot, the legs' lengths and the gun's muzzle stay where the sim expects them. Every face is
//! still one colour; detail comes from bevels, round joints, pistons, plates and vents.
//! `level` 1 is about 1,500 triangles a mech, 2 about 4,000 (`docs/specs/02-look.md`).
use crate::mesh::Builder;
use stompy_sim::data::*;
use stompy_sim::math::*;

const GLASS: [f32; 3] = [0.08, 0.1, 0.13];
const TUBE: [f32; 3] = [0.06, 0.06, 0.07];
const STEEL: [f32; 3] = [0.3, 0.31, 0.34];

fn t(x: f32, y: f32, z: f32) -> M4 {
    M4::t(x, y, z)
}
fn mulc(c: [f32; 3], k: f32) -> [f32; 3] {
    [c[0] * k, c[1] * k, c[2] * k]
}
/// A joint across x: a drum with a cap on each end.
fn drum(b: &mut Builder, at: V3, d: f32, len: f32, n: usize, col: [f32; 3], cap: [f32; 3]) {
    let x = v3(len * 0.5, 0., 0.);
    b.rod(at - x, at + x, d, n, col);
    for s in [1., -1.] {
        let e = at + x * s;
        b.rod(e, e + x * (0.12 * s), d * 0.6, n, cap);
    }
}
/// Slats across a vent: `k` thin bars in a frame.
fn vent(b: &mut Builder, m: M4, w: f32, h: f32, k: usize, col: [f32; 3]) {
    b.bbox(m, v3(w, h, 0.08), 0.03, 1., mulc(col, 0.6));
    for i in 0..k {
        let y = -h * 0.5 + h * (i as f32 + 0.5) / k as f32;
        b.bbox(
            m * t(0., y, 0.07) * M4::rx(-0.5),
            v3(w * 0.92, h / k as f32 * 0.55, 0.06),
            0.01,
            1.,
            col,
        );
    }
}

pub struct Parts {
    pub hip: Builder,
    pub uleg: Builder,
    pub lleg: Builder,
    pub foot: Builder,
    pub torso: Builder,
    pub arm: Builder,
    /// The gun on the arm, or the fist (PURPLE PUNCHER's), each hung where the box's was.
    pub barrel: Option<Builder>,
    pub fist: Option<Builder>,
    /// The shoulder pods, left (x > 0) then right, in the torso's frame, each on its hinge.
    pub pods: Option<[Builder; 2]>,
    /// The antenna, standing at its own origin; drawn at its socket.
    pub antenna: Option<Builder>,
    /// A toe's two segments, each standing at its own knuckle, pointing along z.
    pub toe1: Builder,
    pub toe2: Builder,
    /// Where the toes' knuckles sit, the near segment's length, and the pistons drawn live.
    pub toes: &'static [[f32; 4]],
    pub toe_len: f32,
    pub knee: Piston,
    pub ankle: Piston,
}
/// BARRY's three toes: where each knuckle sits on the foot (x, y, z) and which way it points.
pub const TOES: [[f32; 4]; 3] = [
    [-0.42, -0.3, 0.68, -0.35],
    [0., -0.3, 0.72, 0.],
    [0.42, -0.3, 0.68, 0.35],
];
/// The near segment's length: where the claw's knuckle is.
pub const TOE_1: f32 = 0.55;
/// A piston drawn live between two parts: `from` in the upper part's frame, `to` in the
/// lower's, a fat cylinder `fat` long from `from`, a rod the rest of the way.
#[derive(Clone, Copy)]
pub struct Piston {
    pub from: [f32; 3],
    pub to: [f32; 3],
    pub d: f32,
    pub fat: f32,
}
/// BARRY's: the knee (thigh to shin, behind) and the ankle (shin to heel).
pub const KNEE: Piston = Piston {
    from: [0., -0.5, -0.62],
    to: [0., -0.7, -0.58],
    d: 0.27,
    fat: 1.15,
};
pub const ANKLE: Piston = Piston {
    from: [0., -1.15, -0.62],
    to: [0., -0.02, -0.55],
    d: 0.22,
    fat: 0.7,
};
impl Parts {
    /// Triangles drawn for one whole mech: one hip and torso, two of everything else.
    #[cfg(test)]
    pub fn tris(&self) -> usize {
        self.hip.tris()
            + self.torso.tris()
            + self.pods.as_ref().map_or(0, |p| p[0].tris() + p[1].tris())
            + self.antenna.as_ref().map_or(0, |a| a.tris())
            + 2 * self.toes.len() * (self.toe1.tris() + self.toe2.tris())
            + 2 * [&self.uleg, &self.lleg, &self.foot, &self.arm]
                .iter()
                .map(|b| b.tris())
                .sum::<usize>()
            + 2 * [&self.barrel, &self.fist]
                .iter()
                .map(|b| b.as_ref().map_or(0, |b| b.tris()))
                .sum::<usize>()
    }
}

/// BARRY: forward knees, a square torso, a domed cockpit, missile pods on the shoulders.
pub fn barry(level: u8, paint: [f32; 3]) -> Parts {
    let c = chassis(Ch::Kestrel);
    let g = geo_for(Ch::Kestrel);
    let (col, dark, acc) = (paint, mulc(paint, 0.55), c.acc);
    let hi = level >= 2;
    let n = if hi { 16 } else { 8 }; // sides on anything round
    let (l1, l2, w) = (g.l1, g.l2, g.girth);

    // The pelvis: a bevelled block, a spine up into the torso, armour hanging in front.
    let mut hip = Builder::default();
    hip.bbox(M4::ID, v3(2.4 * w, 0.9 * w, 1.5 * w), 0.16, 1., dark);
    hip.bbox(t(0., 0.5, -0.05), v3(1.1, 0.5, 1.1), 0.12, 0.85, col);
    hip.bbox(
        t(0., -0.3, 0.82 * w) * M4::rx(0.15),
        v3(1.0, 0.75, 0.22),
        0.06,
        1.2,
        col,
    );
    for s in [1., -1.] {
        hip.rod(
            v3(s * 1.2 * w, 0., 0.),
            v3(s * 1.4 * w, 0., 0.),
            0.75 * w,
            n,
            STEEL,
        );
    }
    if hi {
        vent(
            &mut hip,
            t(0., 0.05, -0.78 * w) * M4::ry(PI),
            1.4,
            0.55,
            4,
            dark,
        );
        for s in [1., -1.] {
            hip.bbox(
                t(s * 0.85, -0.38, 0.55) * M4::rz(s * 0.12),
                v3(0.55, 0.5, 0.18),
                0.05,
                1.,
                col,
            );
        }
    }

    // The thigh: a tapered core, an armour plate down the front, a piston down the back.
    let mut uleg = Builder::default();
    uleg.bbox(
        t(0., -l1 / 2., 0.),
        v3(0.95 * w, l1 + 0.2, 1.2 * w),
        0.14,
        0.88,
        col,
    );
    uleg.bbox(
        t(0., -l1 * 0.42, 0.66 * w) * M4::rx(-0.06),
        v3(1.05 * w, l1 * 0.72, 0.24),
        0.07,
        1.08,
        col,
    );
    uleg.sphere(M4::s1(1.3 * w), dark, n, n / 2);
    drum(
        &mut uleg,
        v3(0., -l1, 0.05),
        1.35 * w,
        1.15 * w,
        n,
        dark,
        STEEL,
    );
    uleg.bbox(
        t(0., -l1 + 0.05, 0.72 * w),
        v3(0.7, 0.6, 0.32),
        0.1,
        0.8,
        col,
    );
    // The knee piston is drawn live (`PISTONS`); here, the lug it hangs from.
    uleg.bbox(t(0., -0.5, -0.6 * w), v3(0.36, 0.36, 0.3), 0.06, 1., dark);
    if hi {
        for s in [1., -1.] {
            uleg.bbox(
                t(s * 0.5 * w, -l1 * 0.5, 0.1),
                v3(0.08, l1 * 0.55, 0.7),
                0.02,
                1.,
                dark,
            );
            for k in 0..3 {
                let y = -0.6 - k as f32 * 0.6;
                uleg.rod(
                    v3(s * 0.49 * w, y, 0.55),
                    v3(s * 0.57 * w, y, 0.55),
                    0.12,
                    6,
                    STEEL,
                );
            }
        }
    }

    // The shin: a core, a guard plate in front, a calf piston, the ankle ball.
    let mut lleg = Builder::default();
    lleg.bbox(
        t(0., -l2 / 2., -0.1),
        v3(0.8 * w, l2, 1.05 * w),
        0.12,
        1.08,
        col,
    );
    lleg.bbox(
        t(0., -l2 * 0.42, 0.48 * w) * M4::rx(0.08),
        v3(0.92 * w, l2 * 0.78, 0.28),
        0.08,
        0.9,
        col,
    );
    // Lugs for the knee piston's lower end and the ankle piston's upper end.
    lleg.bbox(t(0., -0.7, -0.56 * w), v3(0.34, 0.34, 0.3), 0.06, 1., dark);
    lleg.bbox(t(0., -1.15, -0.6 * w), v3(0.32, 0.32, 0.3), 0.06, 1., dark);
    lleg.sphere(t(0., -l2, -0.05) * M4::s1(1.0 * w), dark, n, n / 2);
    if hi {
        vent(
            &mut lleg,
            t(0., -l2 * 0.35, -0.66 * w) * M4::ry(PI),
            0.5,
            0.8,
            3,
            dark,
        );
        lleg.bbox(t(0., -0.25, 0.3), v3(0.85 * w, 0.35, 0.6), 0.08, 1., dark);
    }

    // The foot: a base, three splayed toes, a heel spur, a cuff round the ankle.
    let mut foot = Builder::default();
    foot.rod(v3(0., 0.12, 0.), v3(0., -0.2, 0.), 0.95 * w, n, col);
    foot.bbox(t(0., -0.25, 0.05), v3(1.25 * w, 0.36, 1.3), 0.1, 0.9, dark);
    // The toes are their own pieces, two joints each, so they can curl and grip (anim.rs).
    // Here: the knuckle housings they hinge from at the front of the base.
    for h in TOES {
        foot.rod(
            v3(h[0] - 0.22 * w, h[1] + 0.02, h[2]),
            v3(h[0] + 0.22 * w, h[1] + 0.02, h[2]),
            0.32,
            if hi { 10 } else { 8 },
            STEEL,
        );
    }
    // A toe, standing at its knuckle and pointing along z: the near segment, then the claw.
    let mut toe1 = Builder::default();
    toe1.bbox(
        t(0., 0., TOE_1 * 0.5),
        v3(0.36 * w, 0.3, TOE_1 + 0.08),
        0.07,
        0.85,
        dark,
    );
    toe1.rod(
        v3(-0.17 * w, 0.0, TOE_1),
        v3(0.17 * w, 0.0, TOE_1),
        0.24,
        if hi { 10 } else { 8 },
        STEEL,
    );
    let mut toe2 = Builder::default();
    toe2.bbox(
        t(0., -0.01, 0.24),
        v3(0.32 * w, 0.26, 0.52),
        0.06,
        0.8,
        dark,
    );
    toe2.bbox(
        t(0., -0.06, 0.55) * M4::rx(0.4),
        v3(0.24 * w, 0.18, 0.32),
        0.05,
        0.6,
        STEEL,
    );
    foot.bbox(
        t(0., -0.3, -0.75) * M4::rx(-0.2),
        v3(0.45 * w, 0.3, 0.75),
        0.07,
        0.8,
        dark,
    );
    // The ankle piston's heel lug.
    foot.bbox(t(0., -0.02, -0.52), v3(0.3, 0.3, 0.3), 0.06, 1., dark);

    // The torso: a bevelled hull, chest plates, a waist ring, the dome, the canopy, the pods.
    let mut torso = Builder::default();
    torso.rod(v3(0., -0.2, -0.1), v3(0., 0.35, -0.1), 2.1, n, dark);
    torso.bbox(t(0., 1.35, 0.), v3(3.2, 2.5, 2.4), 0.28, 0.92, col);
    for s in [1., -1.] {
        torso.bbox(
            t(s * 0.74, 1.55, 1.22) * M4::rx(-0.14) * M4::ry(s * 0.1),
            v3(1.3, 1.25, 0.24),
            0.08,
            0.9,
            col,
        );
        // Shoulder mounts the arms hang from.
        torso.bbox(t(s * 1.72, 2.0, 0.), v3(0.45, 0.85, 1.1), 0.1, 1., dark);
    }
    torso.rod(v3(0., 2.55, 0.2), v3(0., 3.3, 0.2), 1.55, n, col);
    torso.sphere(t(0., 3.3, 0.2) * M4::s(1.55, 0.7, 1.5), col, n, n / 2);
    torso.bbox(
        t(0., 3.0, 0.93) * M4::rx(-0.35),
        v3(1.0, 0.34, 0.12),
        0.04,
        1.,
        GLASS,
    );
    torso.bbox(
        t(0., 3.0, 0.97) * M4::rx(-0.35),
        v3(0.08, 0.36, 0.1),
        0.01,
        1.,
        dark,
    );
    // Each pod rides its own hinge, so they can bounce out of step (anim.rs). Left (x > 0)
    // first.
    let mut pods = [Builder::default(), Builder::default()];
    for (k, s) in [1., -1.].into_iter().enumerate() {
        let pods = &mut pods[k];
        let pod = t(s * 1.75, 3.0, -0.1);
        pods.bbox(pod, v3(1.25, 1.25, 1.45), 0.12, 1., acc);
        for i in 0..3 {
            for j in 0..3 {
                let (x, y) = ((i as f32 - 1.) * 0.34, (j as f32 - 1.) * 0.34);
                let at = pod.apply(v3(x, y, 0.7));
                pods.rod(
                    at - v3(0., 0., 0.1),
                    at + v3(0., 0., 0.04),
                    0.22,
                    if hi { 8 } else { 6 },
                    TUBE,
                );
            }
        }
        if hi {
            pods.bbox(pod * t(s * 0.66, 0., 0.), v3(0.1, 1.0, 1.2), 0.03, 1., dark);
            pods.bbox(pod * t(0., 0.66, -0.2), v3(1.0, 0.1, 0.9), 0.03, 1., dark);
        }
    }
    torso.bbox(t(0., 1.0, -1.38), v3(2.0, 1.6, 0.5), 0.12, 1., dark);
    vent(
        &mut torso,
        t(0., 1.0, -1.66) * M4::ry(PI),
        1.6,
        1.2,
        if hi { 6 } else { 4 },
        dark,
    );
    // The antenna is its own piece, so it can whip (anim.rs); its socket stays.
    torso.rod(v3(-0.6, 3.0, -0.4), v3(-0.6, 3.18, -0.4), 0.2, 8, dark);
    let mut antenna = Builder::default();
    antenna.rod(V3::ZERO, v3(-0.02, 1.4, -0.15), 0.05, 6, dark);
    if hi {
        for s in [1., -1.] {
            torso.rod(
                v3(s * 0.6, 0.6, -1.6),
                v3(s * 0.6, 0.6, -2.0),
                0.4,
                n,
                STEEL,
            );
            torso.bbox(
                t(s * 1.62, 0.8, 0.6) * M4::rz(s * 0.1),
                v3(0.2, 1.2, 1.0),
                0.05,
                1.,
                col,
            );
        }
        antenna.sphere(t(-0.02, 1.4, -0.15) * M4::s1(0.14), [1., 0.3, 0.2], 6, 3);
        torso.bbox(t(0., 2.6, 0.95), v3(1.5, 0.12, 0.3), 0.03, 1., dark);
    }

    // The arm: the shoulder drum, the upper arm, a pauldron, a gun mount.
    let mut arm = Builder::default();
    drum(&mut arm, v3(0., 0.15, 0.), 1.4, 1.15, n, dark, STEEL);
    arm.bbox(t(0., -0.6, 0.1), v3(0.95, 1.6, 1.15), 0.12, 1.05, col);
    arm.bbox(t(0., 0.5, 0.05), v3(1.25, 0.5, 1.45), 0.12, 0.8, col);
    arm.bbox(t(0., -1.15, 0.35), v3(0.8, 0.6, 1.1), 0.1, 1., dark);
    if hi {
        for k in 0..3 {
            let y = -0.2 - k as f32 * 0.4;
            arm.bbox(t(0., y, 0.68), v3(0.7, 0.08, 0.06), 0.01, 1., dark);
        }
    }

    // The gun: a housing, a barrel, cooling rings, a muzzle. It ends where the box did (z 2.6).
    let mut barrel = Builder::default();
    barrel.bbox(t(0., -1.15, 0.85), v3(0.62, 0.62, 1.1), 0.1, 1., dark);
    barrel.rod(v3(0., -1.15, 1.3), v3(0., -1.15, 2.42), 0.34, n, STEEL);
    let rings: &[f32] = if hi {
        &[1.45, 1.6, 1.75, 1.9, 2.05]
    } else {
        &[1.5, 1.75, 2.0]
    };
    for &z in rings {
        barrel.rod(v3(0., -1.15, z), v3(0., -1.15, z + 0.06), 0.46, n, dark);
    }
    barrel.rod(v3(0., -1.15, 2.42), v3(0., -1.15, 2.6), 0.48, n, dark);
    if hi {
        barrel.rod(v3(0., -0.85, 0.5), v3(0., -0.85, 1.3), 0.14, 8, STEEL);
    }
    Parts {
        hip,
        uleg,
        lleg,
        foot,
        torso,
        arm,
        barrel: Some(barrel),
        fist: None,
        pods: Some(pods),
        antenna: Some(antenna),
        toe1,
        toe2,
        toes: &TOES,
        toe_len: TOE_1,
        knee: KNEE,
        ankle: ANKLE,
    }
}

/// SKEDADDLE's toes: three long ones, splayed wide for grip at a sprint.
pub const SKED_TOES: [[f32; 4]; 3] = [
    [-0.4, -0.3, 0.62, -0.42],
    [0., -0.3, 0.72, 0.],
    [0.4, -0.3, 0.62, 0.42],
];
pub const SKED_TOE_1: f32 = 0.62;
/// SKEDADDLE's: the knee ram in front of the backward knee (thigh to shin), and the ankle ram
/// down the back of the shin to the heel. A bird leg's limb frame has +z toward the knee, which
/// points back, so the front is -z.
pub const SKED_KNEE: Piston = Piston {
    from: [0., -0.75, -0.62],
    to: [0., -0.75, -0.42],
    d: 0.22,
    fat: 1.0,
};
pub const SKED_ANKLE: Piston = Piston {
    from: [0., -0.9, 0.42],
    to: [0., 0.05, -0.5],
    d: 0.18,
    fat: 0.8,
};

/// SKEDADDLE: a lean sprinter on bird legs. A forward-leaning hull with a wraparound canopy and
/// gulping side intakes, a counterweight behind, thick thighs over slim shins, long
/// three-toed claws with a spur, slim arms with the LIL ZAPPERs, and two twitchy ears. Light
/// plates over an open frame: it runs fast, it breaks fast.
pub fn skedaddle(level: u8, paint: [f32; 3]) -> Parts {
    let c = chassis(Ch::Jackal);
    let g = geo_for(Ch::Jackal);
    let (col, dark, acc) = (paint, mulc(paint, 0.55), c.acc);
    let hi = level >= 2;
    let n = if hi { 14 } else { 8 };
    let (l1, l2) = (g.l1, g.l2);

    // The pelvis: a narrow keel, hip balls at the sides.
    let mut hip = Builder::default();
    hip.bbox(M4::ID, v3(2.2, 0.85, 1.5), 0.14, 0.9, dark);
    hip.bbox(t(0., 0.45, 0.1), v3(1.2, 0.45, 1.0), 0.1, 0.8, col);
    for s in [1., -1.] {
        hip.rod(v3(s * 0.9, 0., 0.), v3(s * 1.25, 0., 0.), 0.8, n, STEEL);
    }
    // A counterweight behind (the owner, 2026-11-28: a tail was too much).
    hip.bbox(
        t(0., 0.1, -0.95) * M4::rx(-0.15),
        v3(1.3, 0.7, 0.6),
        0.1,
        0.8,
        col,
    );
    if hi {
        vent(&mut hip, t(0., 0.1, -1.27) * M4::ry(PI), 1.0, 0.45, 3, dark);
        vent(&mut hip, t(0., 0., 0.76), 1.2, 0.5, 3, dark);
    }

    // The thigh: thick, an armour shell on the outside and the front (-z: the knee points back).
    let mut uleg = Builder::default();
    uleg.sphere(M4::s1(1.4), dark, n, n / 2);
    uleg.bbox(
        t(0., -l1 * 0.48, -0.05),
        v3(1.1, l1 + 0.1, 1.35),
        0.16,
        0.72,
        col,
    );
    uleg.bbox(
        t(0., -l1 * 0.4, -0.66) * M4::rx(0.08),
        v3(1.15, l1 * 0.7, 0.22),
        0.06,
        0.8,
        col,
    );
    drum(&mut uleg, v3(0., -l1, 0.), 1.3, 1.05, n, dark, STEEL);
    // The knee ram's lug, in front.
    uleg.bbox(t(0., -0.75, -0.62), v3(0.3, 0.3, 0.28), 0.05, 1., dark);
    if hi {
        for s in [1., -1.] {
            uleg.bbox(
                t(s * 0.58, -l1 * 0.45, -0.1),
                v3(0.08, l1 * 0.6, 0.9),
                0.02,
                0.9,
                dark,
            );
        }
        for k in 0..3 {
            let y = -0.5 - k as f32 * 0.55;
            uleg.bbox(t(0., y, -0.78), v3(0.9, 0.07, 0.05), 0.01, 1., dark);
        }
    }

    // The shin: slim and long, an open frame of two struts round a core, a guard down the front,
    // the ankle ball.
    let mut lleg = Builder::default();
    lleg.bbox(t(0., -l2 * 0.5, 0.), v3(0.55, l2, 0.6), 0.1, 0.8, dark);
    for s in [1., -1.] {
        lleg.rod(
            v3(s * 0.34, -0.2, 0.1),
            v3(s * 0.3, -l2 + 0.25, 0.05),
            0.16,
            if hi { 8 } else { 6 },
            STEEL,
        );
    }
    lleg.bbox(
        t(0., -l2 * 0.42, -0.34) * M4::rx(-0.05),
        v3(0.7, l2 * 0.7, 0.16),
        0.05,
        0.7,
        col,
    );
    lleg.bbox(t(0., -0.75, -0.42), v3(0.28, 0.28, 0.26), 0.05, 1., dark);
    lleg.bbox(t(0., -0.9, 0.42), v3(0.26, 0.26, 0.26), 0.05, 1., dark);
    lleg.sphere(t(0., -l2, 0.) * M4::s1(0.8), dark, n, n / 2);
    if hi {
        lleg.bbox(t(0., -0.25, 0.), v3(0.8, 0.35, 0.75), 0.08, 0.9, col);
        for k in 0..4 {
            let y = -0.9 - k as f32 * 0.35;
            lleg.bbox(t(0., y, -0.44), v3(0.5, 0.05, 0.04), 0.01, 1., dark);
        }
    }

    // The foot: a cuff, a narrow pad, the knuckles, a long spur behind.
    let mut foot = Builder::default();
    foot.rod(v3(0., 0.15, 0.), v3(0., -0.18, 0.), 0.75, n, col);
    foot.bbox(t(0., -0.25, 0.1), v3(1.0, 0.32, 1.1), 0.09, 0.85, dark);
    for h in SKED_TOES {
        foot.rod(
            v3(h[0] - 0.17, h[1] + 0.02, h[2]),
            v3(h[0] + 0.17, h[1] + 0.02, h[2]),
            0.28,
            if hi { 10 } else { 8 },
            STEEL,
        );
    }
    foot.bbox(
        t(0., -0.28, -0.8) * M4::rx(-0.3),
        v3(0.26, 0.24, 0.85),
        0.05,
        0.5,
        dark,
    );
    foot.bbox(
        t(0., -0.4, -1.2) * M4::rx(0.5),
        v3(0.18, 0.14, 0.35),
        0.03,
        0.4,
        STEEL,
    );
    foot.bbox(t(0., 0.05, -0.5), v3(0.26, 0.26, 0.26), 0.05, 1., dark);
    // A toe: a long slim segment, then a hooked claw.
    let mut toe1 = Builder::default();
    toe1.bbox(
        t(0., 0., SKED_TOE_1 * 0.5),
        v3(0.28, 0.24, SKED_TOE_1 + 0.06),
        0.06,
        0.8,
        dark,
    );
    toe1.rod(
        v3(-0.13, 0., SKED_TOE_1),
        v3(0.13, 0., SKED_TOE_1),
        0.2,
        if hi { 8 } else { 6 },
        STEEL,
    );
    let mut toe2 = Builder::default();
    toe2.bbox(t(0., -0.02, 0.22), v3(0.24, 0.2, 0.46), 0.05, 0.7, dark);
    toe2.bbox(
        t(0., -0.1, 0.52) * M4::rx(0.6),
        v3(0.16, 0.14, 0.36),
        0.03,
        0.4,
        STEEL,
    );

    // The torso: a wedge leaning into the run, the canopy wrapped round the front, intakes at
    // the sides, cooling fins behind, the ears' socket on top.
    let mut torso = Builder::default();
    torso.rod(v3(0., -0.2, 0.), v3(0., 0.3, 0.), 1.7, n, dark);
    torso.bbox(
        t(0., 1.25, -0.1) * M4::rx(0.08),
        v3(2.9, 2.2, 2.4),
        0.24,
        0.78,
        col,
    );
    torso.bbox(
        t(0., 0.75, 1.25) * M4::rx(0.45),
        v3(2.0, 1.1, 0.9),
        0.14,
        0.7,
        col,
    );
    // The canopy, a dome of glass with a frame over it.
    torso.sphere(t(0., 2.2, 1.05) * M4::s(1.0, 0.55, 0.85), GLASS, n, n / 2);
    torso.rod(v3(0., 2.75, 0.4), v3(0., 2.3, 1.85), 0.09, 6, dark);
    for s in [1., -1.] {
        // The intakes: a cowl and a dark throat.
        let at = v3(s * 1.5, 1.35, 0.5);
        torso.rod(at - v3(0., 0., 0.9), at + v3(0., 0., 0.5), 0.78, n, col);
        torso.rod(at + v3(0., 0., 0.45), at + v3(0., 0., 0.52), 0.6, n, TUBE);
        // Shoulder mounts.
        torso.bbox(t(s * 1.6, 2.0, -0.2), v3(0.4, 0.7, 0.9), 0.08, 1., dark);
        // Cooling fins, raked back.
        torso.bbox(
            t(s * 0.55, 2.55, -0.9) * M4::rx(-0.5) * M4::rz(s * 0.12),
            v3(0.08, 0.9, 0.9),
            0.02,
            0.6,
            acc,
        );
    }
    torso.bbox(t(0., 1.0, -1.45), v3(1.8, 1.4, 0.5), 0.1, 0.9, dark);
    torso.rod(v3(0., 2.35, -0.3), v3(0., 2.55, -0.3), 0.22, 8, dark);
    if hi {
        vent(
            &mut torso,
            t(0., 1.0, -1.72) * M4::ry(PI),
            1.4,
            1.0,
            5,
            dark,
        );
        for s in [1., -1.] {
            torso.bbox(
                t(s * 1.0, 1.55, 1.12) * M4::rx(-0.1) * M4::ry(s * 0.35),
                v3(0.7, 1.0, 0.16),
                0.05,
                0.85,
                col,
            );
            torso.rod(
                v3(s * 1.5, 1.35, -0.5),
                v3(s * 1.5, 1.35, -0.75),
                0.5,
                n,
                STEEL,
            );
            for k in 0..3 {
                let z = -0.1 + k as f32 * 0.25;
                torso.rod(
                    v3(s * 1.5, 1.35, z),
                    v3(s * 1.5, 1.35, z + 0.05),
                    0.84,
                    n,
                    dark,
                );
            }
        }
        torso.bbox(
            t(0., 2.0, 1.72) * M4::rx(-0.5),
            v3(0.9, 0.1, 0.2),
            0.02,
            1.,
            dark,
        );
    }
    // The ears: two thin aerials in a V from one socket, so they twitch together (anim.rs).
    let mut antenna = Builder::default();
    for s in [1., -1.] {
        antenna.rod(V3::ZERO, v3(s * 0.35, 1.1, -0.35), 0.045, 5, dark);
        if hi {
            antenna.sphere(t(s * 0.35, 1.1, -0.35) * M4::s1(0.1), acc, 6, 3);
        }
    }

    // The arm: a small shoulder drum and a slim strut: two rods and a light plate.
    let mut arm = Builder::default();
    drum(&mut arm, v3(0., 0.15, 0.), 1.0, 0.9, n, dark, STEEL);
    for z in [-0.2, 0.35] {
        arm.rod(
            v3(0., 0.0, z),
            v3(0., -1.0, z),
            0.16,
            if hi { 8 } else { 6 },
            STEEL,
        );
    }
    arm.bbox(t(0.2, -0.5, 0.08), v3(0.12, 1.0, 0.8), 0.03, 0.85, col);
    arm.bbox(t(0., -1.15, 0.2), v3(0.6, 0.5, 0.8), 0.08, 1., dark);

    // The gun (a LIL ZAPPER): a slim housing, an emitter, two focusing rings, a lens. It ends
    // where the box did (z 2.6).
    let mut barrel = Builder::default();
    barrel.bbox(t(0., -1.15, 0.8), v3(0.5, 0.5, 1.0), 0.08, 0.9, dark);
    barrel.rod(v3(0., -1.15, 1.25), v3(0., -1.15, 2.45), 0.22, n, STEEL);
    for z in if hi {
        &[1.6, 1.95, 2.25][..]
    } else {
        &[1.8][..]
    } {
        barrel.rod(v3(0., -1.15, *z), v3(0., -1.15, z + 0.05), 0.34, n, dark);
    }
    barrel.rod(v3(0., -1.15, 2.45), v3(0., -1.15, 2.6), 0.36, n, dark);
    barrel.rod(v3(0., -1.15, 2.59), v3(0., -1.15, 2.61), 0.22, n, GLASS);
    Parts {
        hip,
        uleg,
        lleg,
        foot,
        torso,
        arm,
        barrel: Some(barrel),
        fist: None,
        pods: None,
        antenna: Some(antenna),
        toe1,
        toe2,
        toes: &SKED_TOES,
        toe_len: SKED_TOE_1,
        knee: SKED_KNEE,
        ankle: SKED_ANKLE,
    }
}

/// PURPLE PUNCHER's toes: three short thick ones on a broad foot. It stomps; it doesn't grab.
pub const PUNCH_TOES: [[f32; 4]; 3] = [
    [-0.58, -0.3, 0.86, -0.22],
    [0., -0.3, 0.92, 0.],
    [0.58, -0.3, 0.86, 0.22],
];
pub const PUNCH_TOE_1: f32 = 0.42;
/// PURPLE PUNCHER's wrecking ball: its centre in the arm's frame and its radius. Flying, it is
/// drawn with this point at the ball's place in the sim.
pub const BALL: [f32; 3] = [0., -2.35, 0.3];
pub const BALL_R: f32 = 1.05;
/// PURPLE PUNCHER's: BARRY's layout, thicker, for its girth.
pub const PUNCH_KNEE: Piston = Piston {
    from: [0., -0.55, -0.84],
    to: [0., -0.75, -0.8],
    d: 0.36,
    fat: 1.1,
};
pub const PUNCH_ANKLE: Piston = Piston {
    from: [0., -1.2, -0.84],
    to: [0., -0.02, -0.72],
    d: 0.3,
    fat: 0.7,
};

/// PURPLE PUNCHER: a heavyweight. A barrel chest under huge rounded shoulders, a low flat head
/// with an eye slit under a brow, a belt with a big buckle, thick legs on broad flat feet,
/// short thick arms, and two big fists in its purple. The BIG BOOMER sits low in the chest,
/// the FIRECRACKERS on the right shoulder. Wider than tall.
pub fn puncher(level: u8, paint: [f32; 3]) -> Parts {
    let c = chassis(Ch::Puncher);
    let g = geo_for(Ch::Puncher);
    let (col, dark, acc) = (paint, mulc(paint, 0.55), c.acc);
    let acc_dk = mulc(acc, 0.65);
    let hi = level >= 2;
    let n = if hi { 16 } else { 8 };
    let (l1, l2, w) = (g.l1, g.l2, g.girth);

    // The pelvis: a broad block, the belt round it with its buckle, armour skirts.
    let mut hip = Builder::default();
    hip.bbox(M4::ID, v3(2.3 * w, 0.9 * w, 1.5 * w), 0.16, 1., dark);
    hip.bbox(t(0., 0.15, 0.), v3(2.45 * w, 0.42, 1.62 * w), 0.08, 1., col);
    hip.bbox(t(0., 0.15, 0.84 * w), v3(0.9, 0.62, 0.18), 0.06, 1., acc);
    for s in [1., -1.] {
        hip.rod(
            v3(s * 1.15 * w, 0., 0.),
            v3(s * 1.35 * w, 0., 0.),
            0.75 * w,
            n,
            STEEL,
        );
    }
    if hi {
        hip.bbox(t(0., 0.15, 0.95 * w), v3(0.5, 0.3, 0.08), 0.03, 1., acc_dk);
        for s in [1., -1.] {
            hip.bbox(
                t(s * 0.85 * w, -0.45, 0.62 * w) * M4::rz(s * 0.1) * M4::rx(0.1),
                v3(0.8, 0.6, 0.18),
                0.05,
                1.,
                col,
            );
        }
        vent(
            &mut hip,
            t(0., 0., -0.78 * w) * M4::ry(PI),
            1.6,
            0.5,
            4,
            dark,
        );
    }

    // The thigh: massive, an armour plate down the front, rivets, the knee drum.
    let mut uleg = Builder::default();
    uleg.bbox(
        t(0., -l1 / 2., 0.),
        v3(1.0 * w, l1 + 0.2, 1.2 * w),
        0.16,
        0.9,
        col,
    );
    uleg.bbox(
        t(0., -l1 * 0.42, 0.66 * w) * M4::rx(-0.06),
        v3(1.1 * w, l1 * 0.74, 0.26),
        0.08,
        1.05,
        col,
    );
    uleg.sphere(M4::s1(1.3 * w), dark, n, n / 2);
    drum(
        &mut uleg,
        v3(0., -l1, 0.05),
        1.35 * w,
        1.2 * w,
        n,
        dark,
        STEEL,
    );
    uleg.bbox(
        t(0., -l1 + 0.05, 0.74 * w),
        v3(0.8 * w, 0.62, 0.34),
        0.1,
        0.8,
        col,
    );
    uleg.bbox(t(0., -0.55, -0.82), v3(0.44, 0.44, 0.36), 0.07, 1., dark);
    if hi {
        for k in 0..3 {
            for s in [1., -1.] {
                uleg.sphere(
                    t(s * 0.4 * w, -0.5 - k as f32 * 0.6, 0.82 * w) * M4::s1(0.07),
                    STEEL,
                    6,
                    3,
                );
            }
        }
        for s in [1., -1.] {
            uleg.bbox(
                t(s * 0.52 * w, -l1 * 0.5, 0.),
                v3(0.08, l1 * 0.6, 0.9 * w),
                0.02,
                1.,
                dark,
            );
        }
    }

    // The shin: a thick column, a guard in front, the calf, the ankle ball.
    let mut lleg = Builder::default();
    lleg.bbox(
        t(0., -l2 / 2., -0.1),
        v3(0.85 * w, l2, 1.1 * w),
        0.14,
        1.12,
        col,
    );
    lleg.bbox(
        t(0., -l2 * 0.42, 0.5 * w) * M4::rx(0.08),
        v3(0.95 * w, l2 * 0.78, 0.3),
        0.09,
        0.9,
        col,
    );
    lleg.bbox(t(0., -0.75, -0.8), v3(0.42, 0.42, 0.36), 0.07, 1., dark);
    lleg.bbox(t(0., -1.2, -0.84), v3(0.4, 0.4, 0.36), 0.07, 1., dark);
    lleg.sphere(t(0., -l2, -0.05) * M4::s1(1.0 * w), dark, n, n / 2);
    if hi {
        vent(
            &mut lleg,
            t(0., -l2 * 0.4, -0.7 * w) * M4::ry(PI),
            0.6,
            0.8,
            3,
            dark,
        );
        lleg.bbox(t(0., -0.25, 0.3), v3(0.9 * w, 0.4, 0.7), 0.08, 1., dark);
    }

    // The foot: broad and flat, the knuckles of three stubby toes, a heel block.
    let mut foot = Builder::default();
    foot.rod(v3(0., 0.12, 0.), v3(0., -0.2, 0.), 1.0 * w, n, col);
    foot.bbox(t(0., -0.25, 0.1), v3(1.35 * w, 0.38, 1.55), 0.1, 0.92, dark);
    for h in PUNCH_TOES {
        foot.rod(
            v3(h[0] - 0.26, h[1] + 0.02, h[2]),
            v3(h[0] + 0.26, h[1] + 0.02, h[2]),
            0.34,
            if hi { 10 } else { 8 },
            STEEL,
        );
    }
    foot.bbox(t(0., -0.28, -0.82), v3(1.0, 0.34, 0.6), 0.08, 0.85, dark);
    foot.bbox(t(0., -0.02, -0.7), v3(0.38, 0.38, 0.36), 0.07, 1., dark);
    let mut toe1 = Builder::default();
    toe1.bbox(
        t(0., 0., PUNCH_TOE_1 * 0.5),
        v3(0.5, 0.34, PUNCH_TOE_1 + 0.08),
        0.08,
        0.9,
        dark,
    );
    toe1.rod(
        v3(-0.22, 0., PUNCH_TOE_1),
        v3(0.22, 0., PUNCH_TOE_1),
        0.28,
        if hi { 10 } else { 8 },
        STEEL,
    );
    let mut toe2 = Builder::default();
    toe2.bbox(t(0., -0.02, 0.18), v3(0.46, 0.3, 0.4), 0.07, 0.8, dark);
    toe2.bbox(
        t(0., -0.08, 0.4) * M4::rx(0.3),
        v3(0.4, 0.2, 0.2),
        0.05,
        0.7,
        STEEL,
    );

    // The torso: a barrel chest, shoulders like fridges, a low flat head with its slit and
    // brow, the BIG BOOMER in the chest, the FIRECRACKERS on the right shoulder.
    let mut torso = Builder::default();
    torso.rod(v3(0., -0.2, -0.1), v3(0., 0.3, -0.1), 2.6, n, dark);
    torso.bbox(t(0., 1.2, 0.), v3(4.2, 2.4, 2.9), 0.32, 0.9, col);
    torso.bbox(
        t(0., 1.35, 1.4) * M4::rx(-0.1),
        v3(3.0, 1.6, 0.3),
        0.1,
        0.9,
        col,
    );
    for s in [1., -1.] {
        // The shoulders: a big rounded mass, a cap of armour over it.
        let at = t(s * 2.35, 1.85, -0.05);
        torso.bbox(at, v3(1.7, 1.8, 2.3), 0.4, 0.9, dark);
        torso.bbox(
            at * t(s * 0.1, 0.35, 0.) * M4::rz(s * -0.2),
            v3(1.7, 0.6, 2.5),
            0.2,
            0.85,
            col,
        );
        torso.bbox(
            at * t(s * 0.15, 0.68, 0.) * M4::rz(s * -0.2),
            v3(1.2, 0.16, 2.0),
            0.05,
            0.9,
            acc,
        );
    }
    // The head: low and flat, sunk between the shoulders.
    torso.bbox(t(0., 2.55, 0.25), v3(1.9, 0.6, 1.7), 0.16, 0.85, col);
    torso.bbox(t(0., 2.0, 1.25), v3(2.2, 0.7, 0.6), 0.12, 0.9, col);
    torso.bbox(t(0., 1.8, 1.53), v3(2.3, 0.24, 0.08), 0.02, 1., GLASS);
    torso.bbox(
        t(0., 2.03, 1.56) * M4::rx(-0.25),
        v3(2.5, 0.16, 0.3),
        0.05,
        1.,
        dark,
    );
    // The BIG BOOMER: a housing in the chest, a short fat barrel, a muzzle.
    torso.bbox(t(-0.9, 0.9, 1.45), v3(0.7, 0.7, 0.4), 0.08, 1., dark);
    torso.rod(v3(-0.9, 0.9, 1.5), v3(-0.9, 0.9, 2.2), 0.42, n, STEEL);
    torso.rod(v3(-0.9, 0.9, 2.2), v3(-0.9, 0.9, 2.35), 0.56, n, dark);
    // The FIRECRACKERS: a box on the right shoulder, six tubes.
    torso.bbox(t(-1.25, 2.55, 0.1), v3(1.0, 0.7, 1.2), 0.08, 1., acc);
    for i in 0..3 {
        for j in 0..2 {
            let at = v3(-1.25 + (i as f32 - 1.) * 0.28, 2.42 + j as f32 * 0.28, 0.72);
            torso.rod(at - v3(0., 0., 0.1), at + v3(0., 0., 0.04), 0.18, 6, TUBE);
        }
    }
    torso.bbox(t(0., 0.95, -1.62), v3(2.8, 1.6, 0.5), 0.12, 1., dark);
    if hi {
        vent(
            &mut torso,
            t(0., 0.95, -1.9) * M4::ry(PI),
            2.2,
            1.2,
            6,
            dark,
        );
        for s in [1., -1.] {
            // Exhaust stacks behind the shoulders.
            torso.rod(
                v3(s * 1.1, 1.8, -1.45),
                v3(s * 1.1, 3.0, -1.6),
                0.36,
                n,
                STEEL,
            );
            torso.rod(
                v3(s * 1.1, 2.95, -1.59),
                v3(s * 1.1, 3.1, -1.61),
                0.42,
                n,
                dark,
            );
            // Pectoral plates and their bolts.
            torso.bbox(
                t(s * 0.95, 1.1, 1.58) * M4::ry(s * 0.12),
                v3(1.2, 0.9, 0.12),
                0.04,
                0.9,
                col,
            );
            for k in 0..2 {
                torso.sphere(
                    t(s * (0.55 + k as f32 * 0.8), 1.5, 1.66) * M4::s1(0.07),
                    STEEL,
                    6,
                    3,
                );
            }
        }
        torso.bbox(t(-1.25, 2.95, 0.1), v3(0.8, 0.08, 1.0), 0.02, 1., acc_dk);
    }

    // The arm: a big shoulder drum, a short thick upper arm, an elbow, a forearm into the wrist.
    let mut arm = Builder::default();
    drum(&mut arm, v3(0., 0.15, 0.), 1.75, 1.5, n, dark, STEEL);
    arm.bbox(t(0., -0.45, 0.1), v3(1.3, 1.2, 1.4), 0.16, 0.92, col);
    arm.sphere(t(0., -0.95, 0.15) * M4::s1(1.05), dark, n, n / 2);
    arm.bbox(t(0., -0.95, 0.2), v3(1.25, 0.5, 1.35), 0.12, 1., col);
    if hi {
        for s in [1., -1.] {
            arm.rod(
                v3(s * 0.6, -0.2, -0.45),
                v3(s * 0.55, -0.95, -0.45),
                0.16,
                8,
                STEEL,
            );
        }
        arm.bbox(t(0., 0.6, 0.05), v3(1.55, 0.45, 1.6), 0.12, 0.85, col);
    }

    // The fist: a wrecking ball in the accent, bigger than the arm (the owner, 2026-11-28: the
    // fists are wrecking balls on chains). Knuckle studs across its face, a steel band round
    // it, and the shackle the chain runs from, docked in a socket at the wrist.
    let mut fist = Builder::default();
    fist.rod(v3(0., -1.0, 0.3), v3(0., -1.3, 0.3), 1.15, n, dark);
    fist.rod(v3(0., -1.3, 0.3), v3(0., -1.42, 0.3), 0.5, n, STEEL);
    fist.sphere(
        t(BALL[0], BALL[1], BALL[2]) * M4::s1(2. * BALL_R),
        acc,
        n,
        n / 2,
    );
    fist.rod(
        v3(BALL[0], BALL[1] - 0.12, BALL[2]),
        v3(BALL[0], BALL[1] + 0.12, BALL[2]),
        BALL_R * 2.08,
        n,
        STEEL,
    );
    for i in 0..4 {
        let x = (i as f32 - 1.5) * 0.36;
        for y in [-0.25, 0.22] {
            fist.sphere(
                t(x, BALL[1] + y, BALL[2] + BALL_R * 0.93) * M4::s1(0.16),
                acc_dk,
                if hi { 8 } else { 5 },
                if hi { 4 } else { 3 },
            );
        }
    }
    if hi {
        for k in 0..8 {
            let a = k as f32 / 8. * TAU;
            fist.sphere(
                t(
                    BALL[0] + a.cos() * BALL_R * 1.04,
                    BALL[1],
                    BALL[2] + a.sin() * BALL_R * 1.04,
                ) * M4::s1(0.07),
                dark,
                6,
                3,
            );
        }
        fist.bbox(
            t(BALL[0], BALL[1] + BALL_R * 0.98, BALL[2]),
            v3(0.18, 0.3, 0.5),
            0.05,
            1.,
            STEEL,
        );
    }
    Parts {
        hip,
        uleg,
        lleg,
        foot,
        torso,
        arm,
        barrel: None,
        fist: Some(fist),
        pods: None,
        antenna: None,
        toe1,
        toe2,
        toes: &PUNCH_TOES,
        toe_len: PUNCH_TOE_1,
        knee: PUNCH_KNEE,
        ankle: PUNCH_ANKLE,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn barry_is_on_budget() {
        let c = chassis(Ch::Kestrel);
        let (a, b) = (barry(1, c.col).tris(), barry(2, c.col).tris());
        println!("BARRY drawn: level 1 {a} triangles, level 2 {b}");
        // A whole mech, both legs and arms. The Deck draws millions a frame; the budget is the
        // look's, not the GPU's: enough faces for detail, few enough that the facets show.
        assert!((2500..6000).contains(&a), "level 1: {a}");
        assert!((6000..12000).contains(&b), "level 2: {b}");
        assert!(b > a * 3 / 2);
    }
    #[test]
    fn purple_puncher_is_on_budget_with_fists_and_no_guns() {
        let c = chassis(Ch::Puncher);
        let (a, b) = (puncher(1, c.col), puncher(2, c.col));
        let (ta, tb) = (a.tris(), b.tris());
        println!("PURPLE PUNCHER drawn: level 1 {ta} triangles, level 2 {tb}");
        assert!((2500..6000).contains(&ta), "level 1: {ta}");
        assert!((6000..12000).contains(&tb), "level 2: {tb}");
        assert!(b.fist.is_some() && b.barrel.is_none() && b.antenna.is_none());
    }
    #[test]
    fn skedaddle_is_on_budget_and_lighter_than_barry() {
        let c = chassis(Ch::Jackal);
        let (a, b) = (skedaddle(1, c.col).tris(), skedaddle(2, c.col).tris());
        println!("SKEDADDLE drawn: level 1 {a} triangles, level 2 {b}");
        assert!((2000..6000).contains(&a), "level 1: {a}");
        assert!((5000..12000).contains(&b), "level 2: {b}");
        assert!(b > a * 3 / 2);
    }
}
