//! Scalars, 3-vectors and 4x4 column-major matrices. Plain value types.
use std::ops::{Add, AddAssign, Mul, Neg, Sub};

pub const TAU: f32 = std::f32::consts::TAU;
pub const PI: f32 = std::f32::consts::PI;

#[inline]
pub fn clamp(v: f32, lo: f32, hi: f32) -> f32 {
    if v < lo {
        lo
    } else if v > hi {
        hi
    } else {
        v
    }
}
#[inline]
pub fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}
#[inline]
pub fn smooth(t: f32) -> f32 {
    let t = clamp(t, 0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
/// An angle wrapped to -pi..pi.
#[inline]
pub fn wrap(a: f32) -> f32 {
    let mut a = a % TAU;
    if a > PI {
        a -= TAU;
    }
    if a < -PI {
        a += TAU;
    }
    a
}
#[inline]
pub fn sign(v: f32) -> f32 {
    if v > 0.0 {
        1.0
    } else if v < 0.0 {
        -1.0
    } else {
        0.0
    }
}
#[inline]
pub fn hypot2(x: f32, z: f32) -> f32 {
    (x * x + z * z).sqrt()
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct V3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}
#[inline]
pub const fn v3(x: f32, y: f32, z: f32) -> V3 {
    V3 { x, y, z }
}
impl V3 {
    pub const ZERO: V3 = v3(0.0, 0.0, 0.0);
    #[inline]
    pub fn dot(self, b: V3) -> f32 {
        self.x * b.x + self.y * b.y + self.z * b.z
    }
    #[inline]
    pub fn cross(self, b: V3) -> V3 {
        v3(
            self.y * b.z - self.z * b.y,
            self.z * b.x - self.x * b.z,
            self.x * b.y - self.y * b.x,
        )
    }
    #[inline]
    pub fn len(self) -> f32 {
        self.dot(self).sqrt()
    }
    #[inline]
    pub fn norm(self) -> V3 {
        let l = self.len();
        self * (1.0 / if l < 1e-9 { 1.0 } else { l })
    }
    #[inline]
    pub fn mix(self, b: V3, t: f32) -> V3 {
        self + (b - self) * t
    }
    #[inline]
    pub fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite() && self.z.is_finite()
    }
}
impl Add for V3 {
    type Output = V3;
    #[inline]
    fn add(self, b: V3) -> V3 {
        v3(self.x + b.x, self.y + b.y, self.z + b.z)
    }
}
impl AddAssign for V3 {
    #[inline]
    fn add_assign(&mut self, b: V3) {
        *self = *self + b;
    }
}
impl Sub for V3 {
    type Output = V3;
    #[inline]
    fn sub(self, b: V3) -> V3 {
        v3(self.x - b.x, self.y - b.y, self.z - b.z)
    }
}
impl Mul<f32> for V3 {
    type Output = V3;
    #[inline]
    fn mul(self, s: f32) -> V3 {
        v3(self.x * s, self.y * s, self.z * s)
    }
}
impl Neg for V3 {
    type Output = V3;
    #[inline]
    fn neg(self) -> V3 {
        v3(-self.x, -self.y, -self.z)
    }
}
/// The unit vector for a yaw (about +y, growing to the left) and a pitch.
#[inline]
pub fn dir_of(yaw: f32, pitch: f32) -> V3 {
    v3(
        yaw.sin() * pitch.cos(),
        pitch.sin(),
        yaw.cos() * pitch.cos(),
    )
}

/// A 4x4 column-major matrix (OpenGL's layout).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct M4(pub [f32; 16]);
impl Default for M4 {
    fn default() -> Self {
        M4::ID
    }
}
impl M4 {
    pub const ID: M4 = M4([
        1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.,
    ]);
    pub fn t(x: f32, y: f32, z: f32) -> M4 {
        let mut m = M4::ID;
        m.0[12] = x;
        m.0[13] = y;
        m.0[14] = z;
        m
    }
    pub fn s(x: f32, y: f32, z: f32) -> M4 {
        let mut m = M4::ID;
        m.0[0] = x;
        m.0[5] = y;
        m.0[10] = z;
        m
    }
    pub fn s1(k: f32) -> M4 {
        M4::s(k, k, k)
    }
    pub fn ry(a: f32) -> M4 {
        let (s, c) = a.sin_cos();
        M4([c, 0., -s, 0., 0., 1., 0., 0., s, 0., c, 0., 0., 0., 0., 1.])
    }
    pub fn rx(a: f32) -> M4 {
        let (s, c) = a.sin_cos();
        M4([1., 0., 0., 0., 0., c, s, 0., 0., -s, c, 0., 0., 0., 0., 1.])
    }
    pub fn rz(a: f32) -> M4 {
        let (s, c) = a.sin_cos();
        M4([c, s, 0., 0., -s, c, 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.])
    }
    pub fn persp(fovy: f32, aspect: f32, n: f32, f: f32) -> M4 {
        let t = 1.0 / (fovy / 2.0).tan();
        M4([
            t / aspect,
            0.,
            0.,
            0.,
            0.,
            t,
            0.,
            0.,
            0.,
            0.,
            (f + n) / (n - f),
            -1.,
            0.,
            0.,
            (2. * f * n) / (n - f),
            0.,
        ])
    }
    pub fn ortho(l: f32, r: f32, b: f32, t: f32, n: f32, f: f32) -> M4 {
        let mut o = M4::ID;
        o.0[0] = 2.0 / (r - l);
        o.0[5] = 2.0 / (t - b);
        o.0[10] = -2.0 / (f - n);
        o.0[12] = -(r + l) / (r - l);
        o.0[13] = -(t + b) / (t - b);
        o.0[14] = -(f + n) / (f - n);
        o
    }
    pub fn look_at(eye: V3, at: V3, up: V3) -> M4 {
        let z = (eye - at).norm();
        let x = up.cross(z).norm();
        let y = z.cross(x);
        M4([
            x.x,
            y.x,
            z.x,
            0.,
            x.y,
            y.y,
            z.y,
            0.,
            x.z,
            y.z,
            z.z,
            0.,
            -x.dot(eye),
            -y.dot(eye),
            -z.dot(eye),
            1.,
        ])
    }
    pub fn apply(&self, p: V3) -> V3 {
        let m = &self.0;
        v3(
            m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12],
            m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13],
            m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14],
        )
    }
    /// A matrix that hangs a limb mesh (built along -y from its pivot) from `p` to `q`, bending toward `pole`.
    pub fn limb(p: V3, q: V3, pole: V3, s: f32) -> M4 {
        let y = (p - q).norm();
        let pd = pole.dot(y);
        let mut z = pole - y * pd;
        if z.len() < 1e-4 {
            z = v3(0.0, 0.0, 1.0);
        } else {
            z = z.norm();
        }
        let x = y.cross(z);
        M4([
            x.x * s,
            x.y * s,
            x.z * s,
            0.,
            y.x * s,
            y.y * s,
            y.z * s,
            0.,
            z.x * s,
            z.y * s,
            z.z * s,
            0.,
            p.x,
            p.y,
            p.z,
            1.,
        ])
    }
}
impl Mul for M4 {
    type Output = M4;
    fn mul(self, b: M4) -> M4 {
        let (a, b) = (&self.0, &b.0);
        let mut o = [0.0; 16];
        for c in 0..4 {
            for r in 0..4 {
                o[c * 4 + r] = a[r] * b[c * 4]
                    + a[4 + r] * b[c * 4 + 1]
                    + a[8 + r] * b[c * 4 + 2]
                    + a[12 + r] * b[c * 4 + 3];
            }
        }
        M4(o)
    }
}
