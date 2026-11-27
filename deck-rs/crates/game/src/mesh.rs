//! Flat-shaded triangle soup, hand-built: each chassis's parts (ported from the
//! reference's mesh/mechParts.js), the effect shapes, the terrain chunks, the sky.
use crate::gl::{Gl, Mesh};
use stompy_sim::data::*;
use stompy_sim::math::*;
use stompy_sim::terrain::{Terrain, CELL};

#[derive(Default)]
pub struct Builder {
    pub d: Vec<f32>,
}
const W: [f32; 3] = [1., 1., 1.];
impl Builder {
    fn push(&mut self, p: V3, n: V3, c: [f32; 3]) {
        self.d
            .extend_from_slice(&[p.x, p.y, p.z, n.x, n.y, n.z, c[0], c[1], c[2]]);
    }
    /// A triangle facing away from `inside` (or up, for the ground), wound to match.
    pub fn tri(
        &mut self,
        a: V3,
        mut b: V3,
        mut c: V3,
        col: [f32; 3],
        inside: Option<V3>,
        up: bool,
    ) {
        let mut n = (b - a).cross(c - a).norm();
        if if up {
            n.y < 0.
        } else {
            inside.is_some_and(|r| n.dot(a - r) < 0.)
        } {
            n = -n;
            std::mem::swap(&mut b, &mut c);
        }
        self.push(a, n, col);
        self.push(b, n, col);
        self.push(c, n, col);
    }
    pub fn quad(&mut self, a: V3, b: V3, c: V3, d: V3, col: [f32; 3], inside: V3) {
        self.tri(a, b, c, col, Some(inside), false);
        self.tri(a, c, d, col, Some(inside), false);
    }
    /// A unit cube (-0.5..0.5) through `m`; the top face can taper.
    pub fn cube(&mut self, m: M4, col: [f32; 3], tx: f32, tz: f32) {
        let k = [-0.5, 0.5];
        let c: Vec<V3> = (0..8)
            .map(|i| {
                let y = k[(i >> 1) & 1];
                let top = y > 0.;
                m.apply(v3(
                    k[i & 1] * if top { tx } else { 1. },
                    y,
                    k[(i >> 2) & 1] * if top { tz } else { 1. },
                ))
            })
            .collect();
        let ctr = m.apply(V3::ZERO);
        for f in [
            [0, 2, 6, 4],
            [1, 3, 7, 5],
            [0, 1, 5, 4],
            [2, 3, 7, 6],
            [0, 1, 3, 2],
            [4, 5, 7, 6],
        ] {
            self.quad(c[f[0]], c[f[1]], c[f[2]], c[f[3]], col, ctr);
        }
    }
    pub fn cube1(&mut self, m: M4, col: [f32; 3]) {
        self.cube(m, col, 1., 1.);
    }
    /// A unit cylinder (radius 0.5, -0.5..0.5) of n sides through `m`; `top` scales the top cap (0: a cone).
    pub fn cyl(&mut self, m: M4, col: [f32; 3], n: usize, top: f32) {
        let ring = |y: f32, r: f32| -> Vec<V3> {
            (0..n)
                .map(|i| {
                    let a = i as f32 / n as f32 * TAU;
                    m.apply(v3(a.sin() * 0.5 * r, y, a.cos() * 0.5 * r))
                })
                .collect()
        };
        let (lo, hi) = (ring(-0.5, 1.), ring(0.5, top));
        let (ctr, c_lo, c_hi) = (
            m.apply(V3::ZERO),
            m.apply(v3(0., -0.5, 0.)),
            m.apply(v3(0., 0.5, 0.)),
        );
        for i in 0..n {
            let j = (i + 1) % n;
            if top > 0. {
                self.quad(lo[i], lo[j], hi[j], hi[i], col, ctr);
            } else {
                self.tri(lo[i], lo[j], hi[0], col, Some(ctr), false);
            }
            self.tri(c_lo, lo[i], lo[j], col, Some(ctr), false);
            if top > 0. {
                self.tri(c_hi, hi[i], hi[j], col, Some(ctr), false);
            }
        }
    }
    /// A unit sphere (radius 0.5): n sides round, r bands pole to pole, flat-shaded facets.
    pub fn sphere(&mut self, m: M4, col: [f32; 3], n: usize, r: usize) {
        let ctr = m.apply(V3::ZERO);
        let p = |i: usize, j: usize| {
            let (t, a) = (j as f32 / r as f32 * PI, i as f32 / n as f32 * TAU);
            m.apply(v3(
                t.sin() * a.sin() * 0.5,
                t.cos() * 0.5,
                t.sin() * a.cos() * 0.5,
            ))
        };
        for j in 0..r {
            for i in 0..n {
                let (a, b, c, d) = (p(i, j), p(i + 1, j), p(i + 1, j + 1), p(i, j + 1));
                if j == 0 {
                    self.tri(a, c, d, col, Some(ctr), false);
                } else if j == r - 1 {
                    self.tri(a, b, c, col, Some(ctr), false);
                } else {
                    self.quad(a, b, c, d, col, ctr);
                }
            }
        }
    }
    pub fn upload(&mut self, gl: &Gl) -> Mesh {
        let m = gl.upload(&self.d);
        self.d.clear();
        m
    }
}

pub struct MechParts {
    pub hip: Mesh,
    pub uleg: Mesh,
    pub lleg: Mesh,
    pub foot: Mesh,
    pub plate: Mesh,
    pub torso: Mesh,
    pub arm: Mesh,
    pub barrel: Option<Mesh>,
    pub fist: Option<Mesh>,
    pub wreck: Mesh,
}
fn t(x: f32, y: f32, z: f32) -> M4 {
    M4::t(x, y, z)
}
fn s(x: f32, y: f32, z: f32) -> M4 {
    M4::s(x, y, z)
}
fn mulc(c: [f32; 3], k: f32) -> [f32; 3] {
    [c[0] * k, c[1] * k, c[2] * k]
}
const GLASS: [f32; 3] = [0.08, 0.1, 0.13];
const TUBE: [f32; 3] = [0.06, 0.06, 0.07];
/// The joints are round, so a limb turning about one never shows a box corner cutting through.
fn hinge(b: &mut Builder, at: V3, d: f32, len: f32, col: [f32; 3]) {
    b.cyl(
        t(at.x, at.y, at.z) * M4::rz(PI / 2.) * s(d, len, d),
        col,
        8,
        1.,
    );
}
fn ball(b: &mut Builder, at: V3, d: f32, col: [f32; 3]) {
    b.sphere(t(at.x, at.y, at.z) * M4::s1(d), col, 8, 4);
}

/// Every part of a chassis: legs from its leg type sized by its body plan, body from its style.
pub fn build_mech_parts(gl: &Gl, ch: Ch) -> MechParts {
    let c = chassis(ch);
    let g = geo_for(ch);
    let (col, dark, acc) = (c.col, mulc(c.col, 0.55), c.acc);
    let mut b = Builder::default();
    let (l1, l2) = (g.l1, g.l2);
    let (hip, uleg, lleg, foot) = match c.legs {
        Legs::Forward => {
            let (k2, w) = (l2 / 2.5, g.girth);
            b.cube1(s(2.6 * w, 0.9 * w, 1.6 * w), dark);
            let hip = b.upload(gl);
            b.cube(
                t(0., -l1 / 2., 0.) * s(0.95 * w, l1 + 0.2, 1.25 * w),
                col,
                0.85,
                0.9,
            );
            ball(&mut b, V3::ZERO, 1.3 * w, dark);
            hinge(&mut b, v3(0., -l1, 0.05), 1.4 * w, 1.15 * w, dark);
            let uleg = b.upload(gl);
            b.cube1(t(0., -l2 / 2., -0.1) * s(0.8 * w, l2, 1.05 * w), col);
            b.cube1(
                t(0., -1.1 * k2, -0.65 * w) * s(0.3 * w, 1.8 * k2, 0.3 * w),
                dark,
            );
            ball(&mut b, v3(0., -l2, -0.05), 1.0 * w, dark);
            let lleg = b.upload(gl);
            b.cube(
                t(0., -0.2, 0.35 * w) * s(1.25 * w, 0.4 * w, 2.3 * w),
                dark,
                0.8,
                0.8,
            );
            (hip, uleg, lleg, b.upload(gl))
        }
        // Bird legs: an armoured thigh, a slimmer shin with a ram, a three-toed claw with a spur.
        Legs::Reverse => {
            let k2 = l2 / 2.9;
            b.cube1(s(2.8, 0.9, 1.8), dark);
            b.cube1(t(0., -0.1, -0.9) * s(1.4, 0.6, 0.5), col);
            let hip = b.upload(gl);
            b.cube(
                t(0., -l1 / 2., 0.) * s(1.15, l1 + 0.2, 1.45),
                col,
                0.8,
                0.85,
            );
            ball(&mut b, V3::ZERO, 1.5, dark);
            hinge(&mut b, v3(0., -l1, 0.), 1.6, 1.25, dark);
            let uleg = b.upload(gl);
            b.cube(t(0., -l2 / 2., 0.) * s(0.7, l2, 0.9), col, 1.2, 1.15);
            b.cube1(t(0., -1.3 * k2, 0.55) * s(0.28, 2.2 * k2, 0.28), dark);
            ball(&mut b, v3(0., -l2, 0.), 0.95, dark);
            let lleg = b.upload(gl);
            b.cube1(t(0., -0.15, 0.) * s(0.8, 0.5, 0.8), dark);
            b.cube(t(0., -0.32, 1.0) * s(0.38, 0.34, 1.7), dark, 0.7, 0.8);
            for sx in [1., -1.] {
                b.cube(
                    t(sx * 0.42, -0.32, 0.75) * M4::ry(sx * 0.42) * s(0.34, 0.32, 1.45),
                    dark,
                    0.7,
                    0.8,
                );
            }
            b.cube(t(0., -0.32, -0.6) * s(0.3, 0.3, 0.9), dark, 0.7, 0.8);
            (hip, uleg, lleg, b.upload(gl))
        }
        // A low armoured hull on four bowed legs: a thigh, a tapering shin, a broad pad of a foot.
        Legs::Quad => {
            b.cube(s(3.4, 1.3, 4.4), col, 0.85, 0.9);
            b.cube(t(0., -0.1, 2.45) * s(2.4, 0.9, 0.7), dark, 0.8, 0.8);
            b.cube1(t(0., 0.15, -2.35) * s(2.6, 1.0, 0.6), dark);
            for sx in [1., -1.] {
                for sz in [1., -1.] {
                    ball(&mut b, v3(sx * 1.45, 0., sz * 1.6), 1.2, acc);
                }
            }
            let hip = b.upload(gl);
            b.cube1(t(0., -l1 / 2., 0.) * s(0.8, l1, 0.9), col);
            hinge(&mut b, v3(0., -l1, 0.), 1.2, 1.05, dark);
            let uleg = b.upload(gl);
            b.cube(t(0., -l2 / 2., 0.) * s(0.55, l2, 0.6), col, 1.45, 1.4);
            ball(&mut b, v3(0., -l2, 0.), 0.8, dark);
            let lleg = b.upload(gl);
            b.cube(t(0., -0.17, 0.) * s(1.15, 0.35, 1.15), dark, 0.75, 0.75);
            (hip, uleg, lleg, b.upload(gl))
        }
    };
    b.cube1(s(0.9, 0.12, 0.7), col);
    let plate = b.upload(gl);
    let (mut barrel, mut fist) = (None, None);
    let mut barrel_part = |b: &mut Builder, at: [f32; 3], w: f32, len: f32| {
        b.cube1(t(at[0], at[1], at[2]) * s(w, w, len), dark);
        barrel = Some(b.upload(gl));
    };
    let (torso, arm) = match c.style {
        // The mech from the sketch: square torso, domed cockpit, missile pods on the shoulders.
        Style::Reverse => {
            b.cube(t(0., 1.3, 0.) * s(3.2, 2.6, 2.4), col, 0.95, 0.95);
            b.cube(t(0., 2.95, 0.2) * s(1.6, 0.8, 1.5), col, 0.6, 0.6);
            b.cube(t(0., 3.42, 0.2) * s(0.95, 0.25, 0.9), col, 0.55, 0.55);
            b.cube1(t(0., 3.0, 0.92) * s(0.95, 0.26, 0.12), GLASS);
            for sx in [1., -1.] {
                b.cube1(t(sx * 1.75, 3.0, -0.1) * s(1.25, 1.25, 1.45), acc);
                for i in 0..3 {
                    for j in 0..3 {
                        b.cube1(
                            t(
                                sx * 1.75 + (i as f32 - 1.) * 0.34,
                                3.0 + (j as f32 - 1.) * 0.34,
                                0.64,
                            ) * s(0.2, 0.2, 0.06),
                            TUBE,
                        );
                    }
                }
            }
            b.cube1(t(0., 1.0, -1.35) * s(2., 1.6, 0.5), dark);
            let torso = b.upload(gl);
            b.cube1(t(0., -0.6, 0.1) * s(0.95, 1.8, 1.15), col);
            hinge(&mut b, v3(0., 0.15, 0.), 1.45, 1.2, dark);
            let arm = b.upload(gl);
            barrel_part(&mut b, [0., -1.15, 1.45], 0.38, 2.3);
            (torso, arm)
        }
        // The quadruped's turret: cockpit at the front, an ANGRY BEES box on top.
        Style::Quad => {
            b.cube(t(0., 0.7, 0.) * s(2.7, 1.4, 2.5), col, 0.85, 0.85);
            b.cube1(t(0., 0.85, 1.3) * s(1.5, 0.5, 0.25), GLASS);
            b.cube1(t(0., 1.75, -0.3) * s(1.8, 0.75, 1.5), acc);
            for i in 0..4 {
                for j in 0..2 {
                    b.cube1(
                        t((i as f32 - 1.5) * 0.4, 1.6 + j as f32 * 0.3, 0.46) * s(0.22, 0.22, 0.06),
                        TUBE,
                    );
                }
            }
            let torso = b.upload(gl);
            b.cube1(t(0., -0.35, 0.2) * s(0.8, 1.1, 1.6), col);
            hinge(&mut b, V3::ZERO, 1.1, 0.9, dark);
            let arm = b.upload(gl);
            barrel_part(&mut b, [0., -0.5, 1.6], 0.36, 2.4);
            (torso, arm)
        }
        // PURPLE PUNCHER: wider than tall, fridge shoulders, a cockpit slit under a flat head, short
        // thick arms, and two oversized yellow fists that read as fists from 400 m.
        Style::Puncher => {
            b.cube(t(0., 1.2, 0.) * s(4.6, 2.4, 3.0), col, 0.92, 0.9);
            for sx in [1., -1.] {
                b.cube(t(sx * 2.45, 1.75, -0.05) * s(1.5, 1.7, 2.3), dark, 0.9, 0.9);
            }
            b.cube(t(0., 2.62, 0.25) * s(1.9, 0.45, 1.6), col, 0.85, 0.85);
            b.cube1(t(0., 1.8, 1.52) * s(2.4, 0.26, 0.08), GLASS);
            b.cube1(t(0., 0.95, -1.75) * s(2.8, 1.6, 0.6), dark);
            b.cube1(t(-0.9, 0.9, 1.75) * s(0.42, 0.42, 1.2), dark);
            b.cube1(t(-1.25, 2.55, 0.1) * s(1.0, 0.7, 1.2), acc);
            for i in 0..3 {
                for j in 0..2 {
                    b.cube1(
                        t(-1.25 + (i as f32 - 1.) * 0.28, 2.42 + j as f32 * 0.28, 0.72)
                            * s(0.18, 0.18, 0.06),
                        TUBE,
                    );
                }
            }
            let torso = b.upload(gl);
            b.cube1(t(0., -0.55, 0.1) * s(1.35, 1.5, 1.45), col);
            hinge(&mut b, v3(0., 0.15, 0.), 1.8, 1.6, dark);
            let arm = b.upload(gl);
            b.cube(t(0., -1.75, 0.3) * s(1.65, 1.5, 1.7), acc, 0.95, 0.95);
            for i in 0..4 {
                b.cube1(
                    t((i as f32 - 1.5) * 0.4, -2.55, 0.35) * s(0.34, 0.22, 1.5),
                    mulc(acc, 0.75),
                );
            }
            b.cube1(t(0.95, -1.6, 0.75) * s(0.35, 0.8, 0.6), mulc(acc, 0.85));
            fist = Some(b.upload(gl));
            (torso, arm)
        }
        // BIG TROUBLE: a narrow torso with one eye slit, a little fin, a RATATAT stub, small arms.
        Style::Light1 => {
            b.cube(t(0., 1.1, 0.) * s(2.2, 2.0, 2.0), col, 0.85, 0.8);
            b.cube1(t(0., 1.55, 1.02) * s(1.3, 0.18, 0.06), GLASS);
            b.cube(t(0., 2.3, -0.25) * s(0.28, 0.6, 1.3), acc, 0.6, 0.7);
            b.cube1(t(0., 0.9, -1.15) * s(1.4, 1.2, 0.4), dark);
            b.cube1(t(-0.7, 0.8, 1.2) * s(0.22, 0.22, 0.9), dark);
            let torso = b.upload(gl);
            b.cube1(t(0., -0.45, 0.05) * s(0.7, 1.2, 0.85), col);
            hinge(&mut b, v3(0., 0.1, 0.), 1.05, 0.9, dark);
            let arm = b.upload(gl);
            barrel_part(&mut b, [0., -0.85, 1.1], 0.3, 1.6);
            (torso, arm)
        }
        // LONG LARRY: a slim torso with a visor, a tall sensor mast with a dish, slim arms.
        Style::Sniper1 => {
            b.cube(t(0., 1.25, 0.) * s(2.6, 2.3, 2.3), col, 0.85, 0.85);
            b.cube1(t(0., 1.95, 1.17) * s(1.4, 0.45, 0.1), GLASS);
            b.cube1(t(0.7, 3.4, -0.5) * s(0.18, 2.3, 0.18), dark);
            b.cube1(t(0.7, 4.6, -0.5) * s(0.7, 0.22, 0.7), acc);
            b.cube1(t(0.7, 4.0, -0.3) * s(0.55, 0.55, 0.1), acc);
            b.cube1(t(0., 1.0, -1.3) * s(1.8, 1.4, 0.5), dark);
            b.cube1(t(-0.9, 1.3, 1.3) * s(0.25, 0.25, 0.7), dark);
            let torso = b.upload(gl);
            b.cube1(t(0., -0.55, 0.1) * s(0.8, 1.6, 1.0), col);
            hinge(&mut b, v3(0., 0.15, 0.), 1.3, 1.05, acc);
            let arm = b.upload(gl);
            barrel_part(&mut b, [0., -1.0, 1.5], 0.34, 2.4);
            (torso, arm)
        }
        Style::Forward => {
            b.cube(t(0., 1.3, 0.) * s(3.4, 2.6, 2.6), col, 0.85, 0.8);
            b.cube(t(0., 2.15, 1.3) * s(1.6, 0.9, 1.), GLASS, 0.75, 0.6);
            b.cube1(t(1.25, 2.85, -0.2) * s(1.15, 0.7, 1.6), acc);
            b.cube1(t(-1.25, 2.85, -0.2) * s(1.15, 0.7, 1.6), acc);
            b.cube1(t(0., 1.0, -1.5) * s(2., 1.6, 0.6), dark);
            let torso = b.upload(gl);
            b.cube1(t(0., -0.6, 0.1) * s(0.95, 1.8, 1.15), col);
            hinge(&mut b, v3(0., 0.15, 0.), 1.5, 1.25, acc);
            let arm = b.upload(gl);
            barrel_part(&mut b, [0., -1.15, 1.45], 0.38, 2.3);
            (torso, arm)
        }
    };
    // A wreck: a flattened, scorched torso and hip, lying there.
    let (dim, dk) = (mulc(col, 0.5), mulc(col, 0.35));
    b.cube(t(0., 0.9, 0.) * s(3.4, 1.6, 3.0), dim, 0.8, 0.8);
    b.cube1(t(0., 0.5, -1.6) * s(2.8, 1.0, 1.8), dk);
    b.cube1(t(1.2, 0.4, 1.4) * M4::ry(0.5) * s(0.8, 0.8, 1.8), dk);
    let wreck = b.upload(gl);
    MechParts {
        hip,
        uleg,
        lleg,
        foot,
        plate,
        torso,
        arm,
        barrel,
        fist,
        wreck,
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Fx {
    Cube,
    Tetra,
    Spark,
    Ring,
    Star,
    Chunk,
    Flat,
    Missile,
    Bolt,
    Beam,
    Disc,
}
pub const FX_ALL: [Fx; 11] = [
    Fx::Cube,
    Fx::Tetra,
    Fx::Spark,
    Fx::Ring,
    Fx::Star,
    Fx::Chunk,
    Fx::Flat,
    Fx::Missile,
    Fx::Bolt,
    Fx::Beam,
    Fx::Disc,
];
/// Effects are solids: each kind has a shape that reads at a glance.
pub fn build_effect(gl: &Gl, k: Fx) -> Mesh {
    let mut b = Builder::default();
    let o = Some(V3::ZERO);
    match k {
        Fx::Cube => b.cube1(M4::ID, W),
        Fx::Flat => b.cube1(s(1.6, 0.35, 1.6), W),
        Fx::Chunk => b.cube(M4::ID, W, 0.6, 0.7),
        Fx::Tetra => {
            let (a, p, q, r) = (
                v3(0., 0.6, 0.),
                v3(-0.5, -0.3, 0.45),
                v3(0.5, -0.3, 0.45),
                v3(0., -0.3, -0.55),
            );
            for (x, y, z) in [(a, p, q), (a, q, r), (a, r, p), (p, r, q)] {
                b.tri(x, y, z, W, o, false);
            }
        }
        Fx::Spark => b.cube1(s(0.16, 0.16, 1.), W),
        Fx::Bolt => b.sphere(M4::ID, W, 8, 4),
        Fx::Missile => {
            b.cyl(M4::rx(PI / 2.) * s(0.5, 1.4, 0.5), W, 6, 1.);
            b.cyl(t(0., 0., 1.) * M4::rx(PI / 2.) * s(0.5, 0.6, 0.5), W, 6, 0.);
        }
        Fx::Beam => b.cube1(t(0., 0.5, 0.), W), // a unit box from y 0 to 1: beam_mat lays it from a to b
        Fx::Ring | Fx::Disc => {
            let (n, inner) = (16, if k == Fx::Ring { 0.82 } else { 0. });
            for i in 0..n {
                let (a0, a1) = (i as f32 / n as f32 * TAU, (i + 1) as f32 / n as f32 * TAU);
                let (p0, p1) = (v3(a0.sin(), 0., a0.cos()), v3(a1.sin(), 0., a1.cos()));
                if inner > 0. {
                    b.tri(p0, p1, p1 * inner, W, None, true);
                    b.tri(p0, p1 * inner, p0 * inner, W, None, true);
                } else {
                    b.tri(p0, p1, V3::ZERO, W, None, true);
                }
            }
        }
        Fx::Star => {
            let n = 7;
            for i in 0..n {
                let f = |k: f32, r: f32| {
                    let a = k / n as f32 * TAU;
                    v3(a.sin() * r, a.cos() * r, 0.)
                };
                let (p, q, r) = (
                    f(i as f32, 0.35),
                    f(i as f32 + 0.5, 1.),
                    f(i as f32 + 1., 0.35),
                );
                b.tri(p, q, r, W, None, false);
                b.tri(r, q, p, W, None, false);
                b.tri(V3::ZERO, p, r, W, None, false);
                b.tri(V3::ZERO, r, p, W, None, false);
            }
        }
    }
    b.upload(gl)
}
pub const TER_CHUNKS: usize = 4;
/// One chunk of the ground: each cell two triangles with the same split `height` samples,
/// coloured by height and slope, with a little grain so flats aren't one slab.
pub fn build_terrain_chunk(gl: &Gl, ter: &Terrain, cx: usize, cz: usize, pal: &PalDef) -> Mesh {
    let mut b = Builder::default();
    let (cw, chh) = (ter.nx / TER_CHUNKS, ter.nz / TER_CHUNKS);
    for j in cz * chh..(cz + 1) * chh {
        for i in cx * cw..(cx + 1) * cw {
            let (x0, z0) = (-ter.hx + i as f32 * CELL, -ter.hz + j as f32 * CELL);
            let (x1, z1) = (x0 + CELL, z0 + CELL);
            let (a, bb, c, d) = (
                v3(x0, ter.at(i, j), z0),
                v3(x1, ter.at(i + 1, j), z0),
                v3(x0, ter.at(i, j + 1), z1),
                v3(x1, ter.at(i + 1, j + 1), z1),
            );
            for (k, tri) in [[a, bb, c], [d, c, bb]].iter().enumerate() {
                let mut n = (tri[1] - tri[0]).cross(tri[2] - tri[0]).norm();
                if n.y < 0. {
                    n = -n;
                }
                let u = clamp((tri[0].y + tri[1].y + tri[2].y) / 3. / 230., 0., 1.);
                let slope = 1. - n.y;
                let h = (i as f32 * 12.9898 + j as f32 * 78.233 + k as f32 * 3.7).sin() * 43758.547;
                let grain = (h - h.floor()) * 0.08 - 0.04;
                let mut col = [0.; 3];
                for q in 0..3 {
                    let base = if u < 0.5 {
                        lerp(pal.low[q], pal.mid[q], u * 2.)
                    } else {
                        lerp(pal.mid[q], pal.high[q], (u - 0.5) * 2.)
                    };
                    col[q] = clamp(
                        lerp(base, pal.rock[q], smooth((slope - 0.25) / 0.3)) * (1. + grain),
                        0.,
                        1.,
                    );
                }
                b.tri(tri[0], tri[1], tri[2], col, None, true);
            }
        }
    }
    b.upload(gl)
}
pub fn build_sky(gl: &Gl) -> Mesh {
    let mut b = Builder::default();
    b.sphere(M4::s1(2.), W, 16, 8);
    b.upload(gl)
}
