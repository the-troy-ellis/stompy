//! The fusion cannon (OOPS BUTTON): hold a scan on one mech for three seconds,
//! then the reactor dumps into it. The pulse kills on arrival; the shooter's
//! heat jumps to 140 (a deep shutdown) and its own torso pays.
use crate::combat::destroy;
use crate::data::names::FUSION_LINE;
use crate::data::*;
use crate::effects::{explode, particle};
use crate::feel::feel;
use crate::game::*;
use crate::geom::{center_of, muzzle_of, ray_hit};
use crate::math::*;

fn fusion_weapon(m: &Mech) -> Option<usize> {
    m.w.iter()
        .position(|w| w.def.kind == WKind::Fusion && !w.dead)
}
/// The mech the laser passes closest to, within its radius plus slack, with nothing in the way.
fn near_miss(g: &Game, id: MechId, mz: V3, dir: V3, d: &WeaponDef) -> Option<MechId> {
    let mut best: Option<(MechId, f32)> = None;
    for (i, t) in g.mechs.iter().enumerate() {
        if !t.alive || i == id {
            continue;
        }
        let v = center_of(t) - mz;
        let along = v.dot(dir);
        if along < 0. || along > d.range {
            continue;
        }
        let miss = (v - dir * along).len();
        if miss > t.radius() + d.slack
            || best.is_some_and(|b| miss >= b.1)
            || g.ter.ray(mz, v.norm(), v.len() - 1.).is_some()
        {
            continue;
        }
        best = Some((i, miss));
    }
    best.map(|b| b.0)
}
pub fn fusion_tick(g: &mut Game, id: MechId, dt: f32, on: bool) {
    let m = &g.mechs[id];
    let wi = fusion_weapon(m);
    let ready = wi.is_some_and(|wi| m.w[wi].cd <= 0.);
    if !on || !ready || m.shutdown || !m.alive {
        let m = &mut g.mechs[id];
        m.fusion = FusionScan {
            end: m.fusion.end,
            ..FusionScan::default()
        };
        if id == PLAYER {
            g.events.push(Event::FusionSound { on: false, p: 0. });
        }
        return;
    }
    let wi = wi.unwrap();
    let d = m.w[wi].def;
    let mz = muzzle_of(m, &m.w[wi]);
    let dir = (g.aim - mz).norm();
    let hit = ray_hit(g, mz, dir, d.range, Some(id));
    let tgt = hit
        .and_then(|h| h.mech)
        .or_else(|| near_miss(g, id, mz, dir, d));
    let end = match (tgt, hit) {
        (Some(t), _) => center_of(&g.mechs[t]),
        (None, Some(h)) => h.point,
        _ => mz + dir * d.range,
    };
    let w = 0.05 + 0.035 * (g.time * 37.).sin().abs();
    g.cbeams.push(CBeam {
        a: mz,
        b: end,
        col: d.col,
        w,
    }); // a thin, flickering targeting laser
    let m = &mut g.mechs[id];
    m.fusion.on = true;
    m.fusion.end = end;
    m.heat += d.scan_heat * dt;
    // The scan counts on one mech. A slip shorter than `grace` pauses it; longer, or onto another, and it starts over.
    let f = &mut m.fusion;
    if tgt.is_some() && tgt == f.mech {
        f.t += dt;
        f.off = 0.;
    } else if f.mech.is_some() && tgt.is_none() && {
        f.off += dt;
        f.off < d.grace
    } {
        // slipping: hold
    } else {
        f.mech = tgt;
        f.t = 0.;
        f.off = 0.;
    }
    f.slipping = f.mech.is_some() && f.off > 0.;
    let (scan_mech, slipping, ft) = (f.mech, f.slipping, f.t);
    if let (true, Some(sm), false) = (id == PLAYER, scan_mech, slipping) {
        // Locked and on it: draw the torso gently toward the target.
        let (c, e) = (center_of(&g.mechs[sm]), g.eye);
        let k = 1. - (-d.assist * dt).exp();
        let m = &mut g.mechs[id];
        let want_twist = wrap((c.x - e.x).atan2(c.z - e.z) - m.yaw);
        let want_pitch = (c.y - e.y).atan2(hypot2(c.x - e.x, c.z - e.z));
        m.twist = clamp(m.twist + wrap(want_twist - m.twist) * k, -1.9, 1.9);
        m.pitch = clamp(m.pitch + (want_pitch - m.pitch) * k, -0.4, 0.45);
    }
    let p = if scan_mech.is_some() {
        (ft / d.scan).min(1.)
    } else {
        0.
    };
    if scan_mech.is_some() && g.rng.chance(dt * (20. + 60. * p)) {
        let r = &mut g.rng;
        let (pp, v) = (
            end + v3(r.range(-1., 1.), r.range(-1., 1.), r.range(-1., 1.)),
            v3(r.range(-2., 2.), r.range(0., 3.), r.range(-2., 2.)),
        );
        particle(g, pp, v, 0.3, 0.3, d.col, PKind::Fire, 0.);
    }
    if id == PLAYER {
        g.events.push(Event::FusionSound { on: true, p });
    }
    if let (Some(t), true) = (scan_mech, ft >= d.scan) {
        fusion_fire(g, id, wi, mz, t);
    }
}
/// Fire: launch the pulse down the beam, then the reactor pays: feedback into your own torso, the overload shutdown, a recharge.
pub fn fusion_fire(g: &mut Game, id: MechId, wi: usize, mz: V3, t: MechId) {
    let d = g.mechs[id].w[wi].def;
    launch_pulse(g, mz, t, id);
    let m = &mut g.mechs[id];
    m.heat = d.overload;
    m.shutdown = true;
    m.w[wi].cd = d.cd;
    m.fusion = FusionScan::default();
    feel(
        g,
        Feel::FusionFire,
        Some(id),
        1.,
        0.,
        None,
        if id == PLAYER { None } else { Some(mz) },
    );
    if id == PLAYER {
        g.events.push(Event::FusionSound { on: false, p: 0. });
        g.sfx(Sfx::FusionCrack, None);
        g.sfx(Sfx::Powerdown, None);
    }
    let m = &mut g.mechs[id];
    let cost = m.max[Sec::T.i()] * d.feedback;
    m.hp[Sec::T.i()] -= cost;
    let dead = m.hp[Sec::T.i()] <= 0.;
    if id == PLAYER {
        g.stats.taken += cost;
        g.sfx(Sfx::Clang(Sec::T), None);
    }
    if dead {
        g.mechs[id].hp[Sec::T.i()] = 0.;
        destroy(g, id, None);
        return;
    }
    if id == PLAYER {
        g.say(FUSION_LINE, true, 0.);
    }
}
pub fn launch_pulse(g: &mut Game, a: V3, target: MechId, shooter: MechId) {
    let b = center_of(&g.mechs[target]);
    let dur = ((b - a).len() / weapon(Wpn::Fusion).pulse_speed).max(0.2);
    let seed = g.rng.next() * 100.;
    g.pulses.push(Pulse {
        a,
        b,
        target,
        shooter,
        t: 0.,
        dur,
        hit: false,
        seed,
    });
}
/// The pulse travels the beam to the target (following it); resonance kills on arrival, whatever its armour.
pub fn update_pulses(g: &mut Game, dt: f32) {
    for i in 0..g.pulses.len() {
        let mut pu = g.pulses[i];
        pu.t += dt;
        if g.mechs[pu.target].alive {
            pu.b = center_of(&g.mechs[pu.target]);
        }
        if !pu.hit && pu.t >= pu.dur {
            pu.hit = true;
            explode(g, pu.b, true);
            explode(g, pu.b + v3(0., 3., 0.), true);
            for _ in 0..14 {
                let r = &mut g.rng;
                let (p, v, life, size) = (
                    pu.b + v3(r.range(-2., 2.), r.range(-3., 3.), r.range(-2., 2.)),
                    v3(r.range(-16., 16.), r.range(4., 20.), r.range(-16., 16.)),
                    r.range(0.5, 1.1),
                    r.range(0.8, 2.2),
                );
                particle(g, p, v, life, size, [0.95, 0.85, 1.], PKind::Fire, 0.);
            }
            g.sfx(Sfx::Fusion, Some(pu.b));
            if g.mechs[pu.target].alive {
                g.mechs[pu.target].hp[Sec::T.i()] = 0.;
                destroy(g, pu.target, Some(pu.shooter));
            }
        }
        g.pulses[i] = pu;
    }
    g.pulses.retain(|p| p.t < p.dur + 0.25);
}
