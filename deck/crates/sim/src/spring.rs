//! A damped spring for squash, wobble, sag and the camera bob. Critically
//! damped by default (zeta 1: no overshoot); lower zeta for a wobble that rings.
#[derive(Clone, Copy, Debug, Default)]
pub struct Spring {
    pub x: f32,
    pub v: f32,
    pub k: f32,
    pub c: f32,
}
impl Spring {
    pub fn new(k: f32, zeta: f32) -> Spring {
        let mut s = Spring::default();
        s.tune(k, zeta);
        s
    }
    pub fn tune(&mut self, k: f32, zeta: f32) {
        self.k = k;
        self.c = 2.0 * k.sqrt() * zeta;
    }
    /// Semi-implicit Euler with substeps, so a long frame stays stable.
    pub fn step(&mut self, dt: f32, target: f32) -> f32 {
        let n = ((dt / (1.0 / 120.0)).ceil() as i32).max(1);
        let h = dt / n as f32;
        for _ in 0..n {
            self.v += (-self.k * (self.x - target) - self.c * self.v) * h;
            self.x += self.v * h;
        }
        if (self.x - target).abs() < 1e-5 && self.v.abs() < 1e-5 {
            self.x = target;
            self.v = 0.0;
        }
        self.x
    }
    /// An impulse: velocity, not position, so stacked hits add up.
    pub fn kick(&mut self, v: f32) {
        self.v += v;
    }
}
