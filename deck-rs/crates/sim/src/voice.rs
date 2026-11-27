//! The cockpit voice: a pool per event, a seeded pick, no dry line twice in a
//! mission, at most one dry line a minute. `flat` replaces the pool's flat line.
use crate::data::names::{voice_pool, Vo, DRY_GAP};
use crate::game::*;

pub fn voice_line(g: &mut Game, key: Vo, flat: Option<String>) -> String {
    let pool = voice_pool(key);
    let base = flat.unwrap_or_else(|| pool[0].to_string());
    let fresh: Vec<&'static str> = pool[1..]
        .iter()
        .copied()
        .filter(|l| !g.voice.used.contains(l))
        .collect();
    if fresh.is_empty() || g.voice.last_dry.is_some_and(|t| g.time - t < DRY_GAP) {
        return base;
    }
    // The flat line is in the draw too, so dry lines are a treat rather than the rule.
    let pick = g.rng.int(fresh.len() + 1);
    if pick == fresh.len() {
        return base;
    }
    g.voice.used.push(fresh[pick]);
    g.voice.last_dry = Some(g.time);
    fresh[pick].to_string()
}
pub fn voice(g: &mut Game, key: Vo, flat: Option<String>, force: bool, delay_ms: f32) {
    let line = voice_line(g, key, flat);
    g.say(line, force, delay_ms);
}
