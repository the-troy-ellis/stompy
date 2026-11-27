//! Melee: a press starts a wind-up; at the hit frame the nearest mech within
//! reach and arc takes the blow and the knockback; then a recovery with no guns
//! and half the turn rate. Miss and it whiffs. Landing on a mech is a stomp.
use crate::combat::damage;
use crate::data::*;
use crate::feel::feel;
use crate::game::*;
use crate::geom::center_of;
use crate::math::*;

pub const KNOCK_MIN: f32 = 0.3;
pub const KNOCK_MAX: f32 = 2.5;
pub const RECOIL: f32 = 0.2;

pub fn mass_of(m: &Mech) -> f32 {
    m.ch.scale.powi(3)
}
/// A chassis with fists punches with whichever arm it still has; with both gone it shoves.
pub fn melee_of(m: &Mech) -> &'static MeleeDef {
    match m.ch.melee {
        Some(f) if !(f.fists && m.hp[Sec::LA.i()] <= 0. && m.hp[Sec::RA.i()] <= 0.) => f,
        _ => &DEFAULT_MELEE,
    }
}
/// Which fist throws this punch: they take turns, skipping a lost arm.
pub fn punch_arm(m: &Mech) -> Option<Sec> {
    let want = if m.last_arm == Sec::RA {
        Sec::LA
    } else {
        Sec::RA
    };
    let other = if want == Sec::RA { Sec::LA } else { Sec::RA };
    if m.hp[want.i()] > 0. {
        Some(want)
    } else if m.hp[other.i()] > 0. {
        Some(other)
    } else {
        None
    }
}
pub fn can_punch(g: &Game, id: MechId) -> bool {
    let m = &g.mechs[id];
    m.alive
        && !m.shutdown
        && m.melee.is_none()
        && !(m.melee_cd > 0.)
        && !(id == PLAYER && g.guide.is_some())
}
pub fn melee_press(g: &mut Game, id: MechId) -> bool {
    if !can_punch(g, id) {
        return false;
    }
    let m = &mut g.mechs[id];
    let def = melee_of(m);
    let arm = if def.fists { punch_arm(m) } else { None };
    if let Some(a) = arm {
        m.last_arm = a;
    }
    m.melee = Some(Swing {
        t: 0.,
        phase: SwingPhase::Windup,
        arm,
    });
    m.melee_cd = def.cd;
    true
}
/// The mech this one's swing would land on right now.
pub fn melee_target(g: &Game, id: MechId) -> Option<MechId> {
    let m = &g.mechs[id];
    let def = melee_of(m);
    let (facing, reach) = (m.view_yaw(), def.reach * m.ch.scale);
    let mut best: Option<(MechId, f32)> = None;
    for (i, t) in g.mechs.iter().enumerate() {
        if i == id || !t.alive {
            continue;
        }
        let (dx, dz) = (t.x - m.x, t.z - m.z);
        let d = hypot2(dx, dz) - t.radius();
        if d > reach
            || best.is_some_and(|(_, bd)| d >= bd)
            || wrap(dx.atan2(dz) - facing).abs() > def.arc
        {
            continue;
        }
        best = Some((i, d));
    }
    best.map(|b| b.0)
}
/// A horizontal impulse, scaled by the masses involved: a shove sends a light mech skidding and a
/// heavy one barely notices. The attacker takes a little recoil; the blow jolts the target's aim.
pub fn knock(
    g: &mut Game,
    target: MechId,
    attacker: Option<MechId>,
    base: f32,
    dir: [f32; 2],
    recoil: bool,
) -> f32 {
    if !(base > 0.) {
        return 0.;
    }
    let ratio = attacker.map_or(1., |a| {
        clamp(
            mass_of(&g.mechs[a]) / mass_of(&g.mechs[target]),
            KNOCK_MIN,
            KNOCK_MAX,
        )
    });
    let v = base * ratio;
    if let (true, Some(a)) = (recoil, attacker) {
        let am = &mut g.mechs[a];
        am.push[0] -= dir[0] * v * RECOIL;
        am.push[1] -= dir[1] * v * RECOIL;
    }
    let t = &mut g.mechs[target];
    t.push[0] += dir[0] * v;
    t.push[1] += dir[1] * v;
    let a = t.yaw + t.twist;
    let side = sign(dir[0] * a.cos() - dir[1] * a.sin());
    let side = if side == 0. { 1. } else { side };
    let j = clamp(v / 10., 0., 1.);
    t.twist = clamp(t.twist + side * KNOCK_TWIST * j, -1.9, 1.9);
    t.pitch = clamp(t.pitch + KNOCK_PITCH * j, -0.4, 0.45);
    v
}
pub fn melee_tick(g: &mut Game, id: MechId, dt: f32) {
    let m = &mut g.mechs[id];
    m.melee_cd = (m.melee_cd - dt).max(0.);
    let Some(mut sw) = m.melee else { return };
    let def = melee_of(m);
    sw.t += dt;
    m.melee = Some(sw);
    if sw.phase == SwingPhase::Windup && sw.t >= def.windup {
        sw.phase = SwingPhase::Recover;
        g.mechs[id].melee = Some(sw);
        match melee_target(g, id) {
            Some(t) => {
                // The blow lands on the target's skin, facing the attacker, at fist height.
                let (m, tm) = (&g.mechs[id], &g.mechs[t]);
                let (dx, dz) = (tm.x - m.x, tm.z - m.z);
                let hd = hypot2(dx, dz).max(1e-6);
                let (nx, nz) = (dx / hd, dz / hd);
                let p = v3(
                    tm.x - nx * tm.radius(),
                    clamp(m.y + 5. * m.ch.scale, tm.y + 1., tm.top() - 1.),
                    tm.z - nz * tm.radius(),
                );
                let tyaw = tm.view_yaw();
                g.mechs[t].last_hit = Some(HitBy::Punch);
                damage(g, t, p, def.dmg, Some(id), false, true);
                let v = knock(g, t, Some(id), def.knock, [nx, nz], true);
                g.mechs[id].heat += def.heat;
                let side = sign(dx * tyaw.cos() - dz * tyaw.sin());
                let side = if side == 0. { 1. } else { side };
                feel(
                    g,
                    Feel::Punch,
                    Some(id),
                    1.,
                    0.,
                    None,
                    if id == PLAYER { None } else { Some(p) },
                );
                feel(
                    g,
                    Feel::Punched,
                    Some(t),
                    1.,
                    -side,
                    None,
                    if t == PLAYER { None } else { Some(p) },
                );
                g.sfx_by(id, Sfx::Punch { hit: true }, p);
                g.farthest_shove = g.farthest_shove.max(v);
            }
            None => {
                let c = center_of(&g.mechs[id]);
                feel(g, Feel::Whiff, Some(id), 1., 0., None, None);
                g.sfx_by(id, Sfx::Punch { hit: false }, c);
            }
        }
    }
    if sw.phase == SwingPhase::Recover && sw.t >= def.windup + def.recover {
        g.mechs[id].melee = None;
    }
}
/// Landing on a mech: a stomp, after `stomp_air` seconds in the air at least. From a blast-off high
/// enough, an insta-stomp.
pub fn try_stomp(g: &mut Game, id: MechId, air_t: f32) -> Option<MechId> {
    let def = melee_of(&g.mechs[id]);
    if air_t < def.stomp_air {
        return None;
    }
    let m = &g.mechs[id];
    let hit = (0..g.mechs.len()).find(|&i| {
        let t = &g.mechs[i];
        i != id
            && t.alive
            && hypot2(t.x - m.x, t.z - m.z) <= (m.radius() + t.radius()) * 1.2
            && m.y >= t.top() - 1.5
            && m.y <= t.top() + 1.
    })?;
    let (m, t) = (&g.mechs[id], &g.mechs[hit]);
    let (dx, dz) = (t.x - m.x, t.z - m.z);
    let hd = hypot2(dx, dz);
    let (nx, nz) = if hd > 0.01 {
        (dx / hd, dz / hd)
    } else {
        (1., 0.)
    };
    let top = t.top();
    let tp = v3(t.x, top - 0.5, t.z);
    let insta = jets_def(m.jets).is_some_and(|j| m.jet.blasted && m.jet.top - m.y >= j.stomp_fall);
    let locked = m.jet.lock == Some(hit);
    g.mechs[hit].last_hit = Some(HitBy::Stomp);
    damage(
        g,
        hit,
        tp,
        if insta { 1e4 } else { def.stomp_dmg },
        Some(id),
        false,
        true,
    );
    if insta && id == PLAYER && locked {
        g.hit_stop = 2. * HIT_STOP; // an aimed one: the clock stops for a beat
    }
    knock(g, hit, Some(id), def.stomp_knock, [nx, nz], true);
    let m = &mut g.mechs[id];
    m.vy = 4.;
    m.push[0] -= nx * def.stomp_knock * 0.5;
    m.push[1] -= nz * def.stomp_knock * 0.5;
    let at = v3(tp.x, top, tp.z);
    feel(
        g,
        Feel::Stomp,
        Some(id),
        1.,
        0.,
        None,
        if id == PLAYER { None } else { Some(at) },
    );
    feel(
        g,
        Feel::Punched,
        Some(hit),
        1.2,
        0.,
        None,
        if hit == PLAYER { None } else { Some(at) },
    );
    g.sfx_by(id, Sfx::Punch { hit: true }, at);
    Some(hit)
}
/// The drawn pose of a swing: torso lean (+back), shoulder swing (+back), lunge (m forward).
pub fn melee_pose(m: &Mech) -> (f32, f32, f32) {
    let Some(sw) = m.melee else {
        return (0., 0., 0.);
    };
    let def = melee_of(m);
    if sw.phase == SwingPhase::Windup {
        let u = (sw.t / def.windup).min(1.);
        return (0.15 * u, -0.9 * u, 0.);
    }
    let t2 = sw.t - def.windup;
    let snap = if t2 < 0.15 {
        1.
    } else {
        (1. - (t2 - 0.15) / (def.recover - 0.15).max(0.1)).max(0.)
    };
    (-0.2 * snap, 0.6 * snap, 0.6 * snap)
}
