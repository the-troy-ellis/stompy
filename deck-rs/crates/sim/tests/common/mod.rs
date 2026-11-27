//! Helpers for the sim tests: a flat-ground game, stepping, and reading what the sim asked for.
#![allow(dead_code, unused_imports)]
pub use stompy_sim::data::names::*;
pub use stompy_sim::data::*;
pub use stompy_sim::math::*;
pub use stompy_sim::state::*;
pub use stompy_sim::update::update;
pub use stompy_sim::*;

pub const DT: f32 = 1. / 60.;
/// A flat-ground game with the player in `ch`, no foes, on NORMAL.
pub fn flat_game(ch: Ch, seed: u32) -> Game {
    let mut g = Game::new(seed);
    start_free_play(
        &mut g,
        Biome::Dusk,
        TimeOfDay::Dusk,
        Weather::Clear,
        0,
        seed,
        ch,
        Diff::Normal,
        true,
    );
    g
}
pub fn steps(g: &mut Game, i: &Input, n: usize) {
    for _ in 0..n {
        update(g, i, DT);
    }
}
pub fn input() -> Input {
    Input::default()
}
/// A foe that stands still where it is put.
pub fn foe(g: &mut Game, ch: Ch, x: f32, z: f32, yaw: f32) -> MechId {
    let id = new_mech(g, ch, 1, x, z, yaw).unwrap();
    g.mechs[id].ai.still = true;
    id
}
/// Skip the stock cooldown stagger.
pub fn ready(g: &mut Game, id: MechId) {
    for w in &mut g.mechs[id].w {
        w.cd = 0.;
    }
}
pub fn sfx_count(g: &Game, kind: &str) -> usize {
    g.events
        .iter()
        .filter(|e| matches!(e, Event::Sfx { sfx, .. } if sfx.kind() == kind))
        .count()
}
pub fn said(g: &Game, sub: &str) -> bool {
    g.events
        .iter()
        .any(|e| matches!(e, Event::Say { line, .. } if line.contains(sub)))
}
pub fn thumps(g: &Game) -> (usize, f32, f32) {
    g.events.iter().fold((0, 0., 0.), |(n, b, h), e| match e {
        Event::Thump { bass, haptic, .. } => (n + 1, b + bass, h + haptic),
        _ => (n, b, h),
    })
}
pub fn total_hp(m: &Mech) -> f32 {
    m.hp.iter().sum()
}
