//! Lasers: continuous beams whose damage climbs while they stay on target. The
//! ramp lives in the target (its armour melts), shared by every beam on it, and
//! cools whenever nothing is on it.
use crate::combat::damage;
use crate::data::*;
use crate::effects::particle;
use crate::game::*;
use crate::geom::{muzzle_of, ray_hit};
use crate::math::*;

/// Seconds of beam to melt armour fully; the damage multiplier at full melt; melt-seconds lost per second off the beam.
pub const MELT_T: f32 = 3.;
pub const MELT_MAX: f32 = 3.5;
pub const MELT_COOL: f32 = 1.5;
pub fn melt_mult(t: f32) -> f32 {
    let u = (t / MELT_T).min(1.);
    1. + (MELT_MAX - 1.) * (u * u * (3. - 2. * u))
}
pub fn melt_frac(m: &Mech) -> f32 {
    (m.melt / MELT_T).min(1.)
}
pub fn beam_mult(g: &Game, m: &Mech) -> f32 {
    m.beam_mech.map_or(1., |t| melt_mult(g.mechs[t].melt))
}
/// A beam lasts one frame; it's redrawn every frame it's on. Thicker and whiter as the melt climbs.
fn draw_beam(g: &mut Game, a: V3, b: V3, def: &WeaponDef, mult: f32) {
    let k = (mult - 1.) / (MELT_MAX - 1.);
    let stut = if def.stutter > 0. && (g.time * TAU * def.stutter).sin() < 0. {
        0.35
    } else {
        1.
    };
    let t = 0.2 + 0.45 * k;
    let col = [
        lerp(def.col[0], 1., t),
        lerp(def.col[1], 1., t),
        lerp(def.col[2], 1., t),
    ];
    let w = def.w * (0.8 + 0.9 * k) * g.rng.range(0.85, 1.15) * stut;
    g.cbeams.push(CBeam { a, b, col, w });
}
/// A flamer draws no line: a cone of fire puffs from the muzzle.
fn flame_cone(g: &mut Game, a: V3, b: V3, def: &WeaponDef) {
    let (d, life) = (b - a, 0.22);
    for _ in 0..3 {
        let r = &mut g.rng;
        let v = d * (r.range(0.75, 1.05) / life)
            + v3(r.range(-9., 9.), r.range(-3., 7.), r.range(-9., 9.));
        let t = r.next();
        let col = [
            lerp(def.col[0], 1., t),
            lerp(def.col[1], 0.9, t),
            lerp(def.col[2], 0.4, t),
        ];
        let (p, size) = (a + d * r.range(0., 0.15), r.range(0.45, 0.8));
        particle(g, p, v, life, size, col, PKind::Flame, 0.);
    }
}
fn beam_sound(g: &mut Game, id: MechId, at: Option<V3>) {
    let m = &g.mechs[id];
    let live = m.w.iter().filter(|w| w.def.kind == WKind::Beam && !w.dead);
    let (mut toaster, mut plain, mut small) = (false, false, true);
    for w in live {
        if w.def.sfx == WSfx::Toaster {
            toaster = true;
        } else {
            plain = true;
            if w.def.tons >= 5. {
                small = false;
            }
        }
    }
    if toaster {
        g.sfx(Sfx::Toaster, at);
    }
    if plain {
        g.sfx(Sfx::Laser { small }, at);
    }
}
/// One frame of a mech's lasers firing at `aim`.
pub fn beam_tick(g: &mut Game, id: MechId, dt: f32, aim: V3) {
    let m = &g.mechs[id];
    let lasers: Vec<usize> = (0..m.w.len())
        .filter(|&i| m.w[i].def.kind == WKind::Beam && !m.w[i].dead)
        .collect();
    if lasers.is_empty() || m.shutdown || !m.alive {
        let m = &mut g.mechs[id];
        m.beaming = false;
        m.beam_mech = None;
        return;
    }
    if !m.beaming {
        let mz = muzzle_of(m, &m.w[lasers[0]]);
        beam_sound(g, id, if id == PLAYER { None } else { Some(mz) });
    }
    let m = &mut g.mechs[id];
    m.beaming = true;
    m.beam_mech = None;
    for wi in lasers {
        let m = &g.mechs[id];
        let w = m.w[wi];
        let def = w.def;
        let mz = muzzle_of(m, &w);
        let dir = (aim - mz).norm();
        let hit = ray_hit(g, mz, dir, def.range, Some(id));
        let end = hit.map_or(mz + dir * def.range, |h| h.point);
        let t = hit.and_then(|h| h.mech);
        let mult = t.map_or(1., |t| melt_mult(g.mechs[t].melt));
        if def.cone {
            flame_cone(g, mz, end, def);
        } else {
            draw_beam(g, mz, end, def, mult);
        }
        g.mechs[id].heat += def.hps * dt;
        if id == PLAYER {
            g.stats.shots += dt * 4.; // accuracy counts beam time in quarter-seconds
        }
        if hit.is_none() {
            continue;
        }
        if g.rng.chance(dt * 25.) {
            let r = &mut g.rng;
            let v = v3(r.range(-3., 3.), r.range(1., 5.), r.range(-3., 3.));
            particle(g, end, v, 0.25, 0.3 + 0.1 * mult, def.col, PKind::Fire, 0.);
        }
        let Some(t) = t else { continue };
        g.mechs[id].beam_mech = Some(t);
        damage(g, t, end, def.dps * mult * dt, Some(id), true, false);
        if def.target_heat > 0. {
            g.mechs[t].heat += def.target_heat * dt; // TOASTER pours heat in
        }
        if id == PLAYER {
            g.stats.hits += dt * 4.;
        }
        // The melt rises once per frame however many beams are on it, at the fastest rate among them.
        let rate = if def.melt_rate > 0. {
            def.melt_rate
        } else {
            1.
        };
        let (frame, time) = (g.frame, g.time);
        let tm = &mut g.mechs[t];
        if tm.melt_frame != frame {
            tm.melt_frame = frame;
            tm.melt_rate = rate;
            tm.melt = (tm.melt + dt * rate).min(MELT_T);
        } else if rate > tm.melt_rate {
            tm.melt = (tm.melt + dt * (rate - tm.melt_rate)).min(MELT_T);
            tm.melt_rate = rate;
        }
        tm.melt_at = time;
    }
}
/// Armour cools whenever no beam touched it this frame.
pub fn cool_armour(g: &mut Game, dt: f32) {
    let t = g.time;
    for m in &mut g.mechs {
        if m.melt > 0. && m.melt_at != t {
            m.melt = (m.melt - MELT_COOL * dt).max(0.);
        }
    }
}
