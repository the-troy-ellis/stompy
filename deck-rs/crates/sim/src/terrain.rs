//! The ground: a grid of 24 m cells with value-noise heights and a flat
//! landing zone round the start. `height` samples the same triangle split as
//! the mesh, so mechs stand exactly on what is drawn (an invariant).
use crate::math::*;

pub const CELL: f32 = 24.;
pub const EDGE: f32 = 90.;
pub const NX: usize = 96;
pub const NZ: usize = 96;

#[derive(Clone, Debug)]
pub struct Terrain {
    pub nx: usize,
    pub nz: usize,
    /// Half sizes, and how far out anyone can walk.
    pub hx: f32,
    pub hz: f32,
    pub bx: f32,
    pub bz: f32,
    pub hs: Vec<f32>,
    pub seed: u32,
}
fn hashf(i: i32, j: i32, seed: u32) -> f32 {
    let s = (i as f32 * 127.1 + j as f32 * 311.7 + seed as f32 * 74.7).sin() * 43758.547;
    s - s.floor()
}
fn vn(x: f32, z: f32, seed: u32) -> f32 {
    let (fi, fj) = (x.floor(), z.floor());
    let (i, j, fx, fz) = (fi as i32, fj as i32, x - fi, z - fj);
    let (u, w) = (fx * fx * (3. - 2. * fx), fz * fz * (3. - 2. * fz));
    lerp(
        lerp(hashf(i, j, seed), hashf(i + 1, j, seed), u),
        lerp(hashf(i, j + 1, seed), hashf(i + 1, j + 1, seed), u),
        w,
    )
}
impl Terrain {
    pub fn new(seed: u32, flat: bool) -> Terrain {
        let (hx, hz) = (NX as f32 * CELL / 2., NZ as f32 * CELL / 2.);
        let mut t = Terrain {
            nx: NX,
            nz: NZ,
            hx,
            hz,
            bx: hx - EDGE,
            bz: hz - EDGE,
            hs: vec![0.; (NX + 1) * (NZ + 1)],
            seed,
        };
        if !flat {
            for j in 0..=NZ {
                for i in 0..=NX {
                    let (x, z) = (-hx + i as f32 * CELL, -hz + j as f32 * CELL);
                    let f = vn(x / 380. + 40., z / 380. + 40., seed) * 0.6
                        + vn(x / 140., z / 140., seed) * 0.3
                        + vn(x / 55., z / 55., seed) * 0.1;
                    let h = (f - 0.36).max(0.) * 230. * clamp((hypot2(x, z) - 70.) / 200., 0., 1.);
                    t.hs[j * (NX + 1) + i] = h;
                }
            }
        }
        t
    }
    #[inline]
    pub fn at(&self, i: usize, j: usize) -> f32 {
        self.hs[j * (self.nx + 1) + i]
    }
    pub fn set(&mut self, i: usize, j: usize, h: f32) {
        let w = self.nx + 1;
        self.hs[j * w + i] = h;
    }
    pub fn height(&self, x: f32, z: f32) -> f32 {
        let gx = clamp((x + self.hx) / CELL, 0., self.nx as f32 - 1e-4);
        let gz = clamp((z + self.hz) / CELL, 0., self.nz as f32 - 1e-4);
        let (i, j) = (gx as usize, gz as usize);
        let (fx, fz) = (gx - i as f32, gz - j as f32);
        let (h00, h10, h01, h11) = (
            self.at(i, j),
            self.at(i + 1, j),
            self.at(i, j + 1),
            self.at(i + 1, j + 1),
        );
        if fx + fz < 1. {
            h00 + (h10 - h00) * fx + (h01 - h00) * fz
        } else {
            h11 + (h01 - h11) * (1. - fx) + (h10 - h11) * (1. - fz)
        }
    }
    /// Where a ray first meets the ground: the distance along it. Marches, then bisects.
    pub fn ray(&self, o: V3, d: V3, max_t: f32) -> Option<f32> {
        if !(max_t > 0.) || !o.is_finite() || !d.is_finite() {
            return None;
        }
        if o.y < self.height(o.x, o.z) {
            return Some(0.);
        }
        let (step, mut prev, mut s) = (6., 0., 6.);
        loop {
            let tt = if s < max_t { s } else { max_t };
            let p = o + d * tt;
            if p.y < self.height(p.x, p.z) {
                let (mut lo, mut hi) = (prev, tt);
                for _ in 0..8 {
                    let mid = (lo + hi) / 2.;
                    let q = o + d * mid;
                    if q.y < self.height(q.x, q.z) {
                        hi = mid;
                    } else {
                        lo = mid;
                    }
                }
                return Some(hi);
            }
            if tt >= max_t || (p.y > 400. && d.y > 0.) {
                return None;
            }
            prev = tt;
            s += step;
        }
    }
}
