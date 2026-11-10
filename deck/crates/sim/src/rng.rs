//! The simulation's randomness: mulberry32, seeded from the match seed, so a
//! mission replays identically and the tests are reproducible.
#[derive(Clone, Debug)]
pub struct Rng(u32);
impl Rng {
    pub fn new(seed: u32) -> Rng {
        Rng(if seed == 0 { 0x9e37_79b9 } else { seed })
    }
    /// 0 <= x < 1
    pub fn next(&mut self) -> f32 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        ((t ^ (t >> 14)) as f64 / 4_294_967_296.0) as f32
    }
    pub fn range(&mut self, a: f32, b: f32) -> f32 {
        a + self.next() * (b - a)
    }
    pub fn int(&mut self, n: usize) -> usize {
        ((self.next() * n as f32) as usize).min(n.saturating_sub(1))
    }
    pub fn chance(&mut self, p: f32) -> bool {
        self.next() < p
    }
    pub fn sign(&mut self) -> f32 {
        if self.next() < 0.5 {
            1.0
        } else {
            -1.0
        }
    }
}
