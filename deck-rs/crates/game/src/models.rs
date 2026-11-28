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
    pub barrel: Builder,
    /// The shoulder pods, in the torso's frame, drawn on their hinge.
    pub pods: Builder,
    /// The antenna, standing at its own origin; drawn at its socket.
    pub antenna: Builder,
}
/// A piston drawn live between two parts: `from` in the upper part's frame, `to` in the
/// lower's, a fat cylinder `fat` long from `from`, a rod the rest of the way.
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
            + self.pods.tris()
            + self.antenna.tris()
            + 2 * [&self.uleg, &self.lleg, &self.foot, &self.arm, &self.barrel]
                .iter()
                .map(|b| b.tris())
                .sum::<usize>()
    }
}

/// BARRY: forward knees, a square torso, a domed cockpit, missile pods on the shoulders.
pub fn barry(level: u8) -> Parts {
    let c = chassis(Ch::Kestrel);
    let g = geo_for(Ch::Kestrel);
    let (col, dark, acc) = (c.col, mulc(c.col, 0.55), c.acc);
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
    for s in [-1., 0., 1.] {
        let m = t(s * 0.4 * w, -0.3, 0.75) * M4::ry(s * 0.35) * t(0., 0., 0.45);
        foot.bbox(m, v3(0.36 * w, 0.3, 1.0), 0.07, 0.8, dark);
        if hi {
            foot.bbox(
                m * t(0., -0.02, 0.6) * M4::rx(0.35),
                v3(0.3 * w, 0.22, 0.35),
                0.05,
                0.7,
                STEEL,
            );
            foot.rod(
                m.apply(v3(-0.2, 0.05, -0.45)),
                m.apply(v3(0.2, 0.05, -0.45)),
                0.2,
                8,
                STEEL,
            );
        }
    }
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
    // The pods ride on their own hinge, so they can bounce (anim.rs).
    let mut pods = Builder::default();
    for s in [1., -1.] {
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
        barrel,
        pods,
        antenna,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn barry_is_on_budget() {
        let (a, b) = (barry(1).tris(), barry(2).tris());
        println!("BARRY drawn: level 1 {a} triangles, level 2 {b}");
        // A whole mech, both legs and arms. The Deck draws millions a frame; the budget is the
        // look's, not the GPU's: enough faces for detail, few enough that the facets show.
        assert!((2500..6000).contains(&a), "level 1: {a}");
        assert!((6000..12000).contains(&b), "level 2: {b}");
        assert!(b > a * 3 / 2);
    }
}
