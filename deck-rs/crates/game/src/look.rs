//! The look: each place at each time of day has its own ramp of nine colours, dark to light,
//! and the ground, the sky and the fog are shaded onto it with an ordered dither. Mechs and
//! effects keep their own colours; their light is stepped and dithered the same way.
//! Render-only: the sim's palettes (`PALS`) still give the light, the fog and the tones.
use stompy_sim::data::{Biome, TimeOfDay, PALS};
use stompy_sim::Game;

pub const RAMP: usize = 9;
struct Ramp {
    cols: [u32; RAMP],
    /// Under 1 lifts the dark end (a dark place still uses its whole ramp).
    gamma: f32,
}
const fn r(cols: [u32; RAMP], gamma: f32) -> Ramp {
    Ramp { cols, gamma }
}
/// [biome][native, night, dawn]. Native is the place's own light (dusk or day).
#[rustfmt::skip]
static RAMPS: [[Ramp; 3]; Biome::N] = [
    // The desert: indigo sky, magenta shadows, orange sand, peach light.
    [r([0x1a0f2e, 0x3b1650, 0x6a1f5c, 0xa8324a, 0xd9573b, 0xf08a3c, 0xf5b25a, 0xfbd894, 0xfff4d6], 0.9),
     r([0x05040d, 0x0d0b22, 0x181640, 0x262356, 0x3a3570, 0x524a85, 0x6f6598, 0x9488b0, 0xc4bcd6], 0.8),
     r([0x140c24, 0x2c1a44, 0x4d2a5e, 0x7a3d6e, 0xb05a72, 0xdc8478, 0xf0ac86, 0xf8d0a4, 0xfff0dc], 0.9)],
    // The glacier: navy, teal, white.
    [r([0x06122b, 0x0f2f5c, 0x1b5e8c, 0x2f93b0, 0x5cc3cf, 0x9fe3e3, 0xd2f4f2, 0xeefbfa, 0xffffff], 1.0),
     r([0x02040c, 0x061026, 0x0b1c40, 0x12305c, 0x1c4878, 0x2a6390, 0x4182a8, 0x68a6c4, 0xa6d0e2], 0.8),
     r([0x0e0e2a, 0x1e2050, 0x35386e, 0x56588a, 0x8a7aa0, 0xc497aa, 0xe8b8b4, 0xf6dcd0, 0xfff6f0], 0.9)],
    // The volcanic plain: black, blood, lava.
    [r([0x0a0606, 0x1f0d0d, 0x3d1212, 0x6e1a12, 0xa8300f, 0xe2560e, 0xff9a1f, 0xffd84a, 0xfff2b0], 0.6),
     r([0x040203, 0x0e0506, 0x1c0808, 0x320c0a, 0x52120c, 0x7a1c0e, 0xa82e10, 0xd84c14, 0xff8a2a], 0.6),
     r([0x0c0608, 0x22100f, 0x401a16, 0x66261a, 0x93381e, 0xc25424, 0xe57a34, 0xf6a858, 0xffd690], 0.65)],
    // The forest: deep greens up into grey mist.
    [r([0x07140c, 0x0f2416, 0x1a3a22, 0x2a5530, 0x42703c, 0x6a8a5c, 0x93a88a, 0xbfcab4, 0xe6ebe0], 0.9),
     r([0x020604, 0x06100a, 0x0b1a12, 0x12261b, 0x1b3426, 0x284430, 0x3a5a42, 0x567659, 0x7e9a7e], 0.8),
     r([0x0b0f10, 0x182224, 0x28362e, 0x3c4c38, 0x586440, 0x7f7e4c, 0xaa985e, 0xd0b67e, 0xeedcb0], 0.9)],
];
fn slot(t: TimeOfDay) -> usize {
    match t {
        TimeOfDay::Night => 1,
        TimeOfDay::Dawn => 2,
        _ => 0,
    }
}
fn rgb(c: u32) -> [f32; 3] {
    [
        (c >> 16) as f32 / 255.,
        ((c >> 8) & 255) as f32 / 255.,
        (c & 255) as f32 / 255.,
    ]
}
fn lum(c: [f32; 3]) -> f32 {
    c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114
}
/// The ramp for this match now, and its tone range: (darkest, lightest, gamma). The range runs
/// from the shadow on the darkest ground (or the zenith) to the lit top of the highest (or the
/// horizon), so every place spreads over its whole ramp whatever its light.
pub fn look_for(g: &Game) -> ([[f32; 3]; RAMP], [f32; 3]) {
    let b = g.biome.i();
    let (a, z, t) = match (g.ramp_tod, g.ramp) {
        (Some((a, z)), Some((_, _, secs))) => (a, z, (g.time / secs).min(1.)),
        _ => (g.time_of_day, g.time_of_day, 0.),
    };
    let (ra, rz) = (&RAMPS[b][slot(a)], &RAMPS[b][slot(z)]);
    let mut cols = [[0.; 3]; RAMP];
    for (i, c) in cols.iter_mut().enumerate() {
        let (x, y) = (rgb(ra.cols[i]), rgb(rz.cols[i]));
        *c = [0, 1, 2].map(|k| x[k] + (y[k] - x[k]) * t);
    }
    let gamma = ra.gamma + (rz.gamma - ra.gamma) * t;
    let (p, l) = (&PALS[b], g.pal);
    // g.pal is the light now, already blended along any ramp.
    let shade = lum(l.shade);
    let lo = lum(l.zen).min(lum(p.rock) * 0.2 * shade);
    let hi = lum(l.hor).max(lum(p.high) * 1.1 * shade);
    (cols, [lo, hi.max(lo + 0.05), gamma])
}

#[cfg(test)]
mod tests {
    use super::*;
    use stompy_sim::data::{Ch, Diff, Weather};
    use stompy_sim::state::start_free_play;

    #[test]
    fn every_ramp_runs_dark_to_light() {
        for (b, times) in RAMPS.iter().enumerate() {
            for (t, r) in times.iter().enumerate() {
                let l: Vec<f32> = r.cols.iter().map(|&c| lum(rgb(c))).collect();
                assert!(
                    l.windows(2).all(|w| w[0] < w[1]),
                    "biome {b} time {t}: {l:?}"
                );
                assert!(r.gamma > 0.3 && r.gamma <= 1.5);
            }
        }
    }
    #[test]
    fn every_place_spreads_over_its_ramp() {
        let mut g = Game::new(1);
        for &b in Biome::ALL {
            for &t in TimeOfDay::ALL {
                start_free_play(
                    &mut g,
                    b,
                    t,
                    Weather::Clear,
                    1,
                    1,
                    Ch::Kestrel,
                    Diff::Normal,
                    true,
                );
                let (_, tone) = look_for(&g);
                assert!(
                    tone[0] >= 0. && tone[1] > tone[0] + 0.04,
                    "{b:?} {t:?}: {tone:?}"
                );
            }
        }
    }
}
