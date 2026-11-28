//! Melee: punching is PURPLE PUNCHER's alone (the owner, 2026-11-28); every mech stomps. A
//! press starts a wind-up; at the hit frame the nearest mech within reach and arc takes the
//! blow and the knockback; then a recovery with no guns and half the turn rate. Miss and it
//! whiffs. Landing on a mech is a stomp.
use crate::combat::damage;
use crate::data::*;
use crate::feel::feel;
use crate::game::*;
use crate::geom::{center_of, torso_frame};
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
/// Whether a mech punches at all: only fists do, and only while it has an arm to throw one.
pub fn punches(m: &Mech) -> bool {
    melee_of(m).fists
}
/// How far its punch reaches (metres, to the target's skin); none for a mech that can't punch.
pub fn punch_reach(m: &Mech) -> f32 {
    if !punches(m) {
        return 0.;
    }
    let def = melee_of(m);
    def.chain.map_or(def.reach, |c| c.reach) * m.ch.scale
}
/// Where a fist hangs from: the wrist of that arm, in the world.
pub fn wrist(m: &Mech, arm: Sec) -> V3 {
    let side = if arm == Sec::LA { 1. } else { -1. };
    torso_frame(m).apply(v3(side * m.geo.arm_x, m.geo.arm_y - 1.3, 0.3))
}
pub fn can_punch(g: &Game, id: MechId) -> bool {
    let m = &g.mechs[id];
    punches(m)
        && m.down.is_none()
        && m.alive
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
    let facing = m.view_yaw();
    let (reach, arc) = match def.chain {
        Some(_) => (punch_reach(m), CHAIN_ARC),
        None => (def.reach * m.ch.scale, def.arc),
    };
    let mut best: Option<(MechId, f32)> = None;
    for (i, t) in g.mechs.iter().enumerate() {
        if i == id || !t.alive {
            continue;
        }
        let (dx, dz) = (t.x - m.x, t.z - m.z);
        let d = hypot2(dx, dz) - t.radius();
        if d > reach
            || best.is_some_and(|(_, bd)| d >= bd)
            || wrap(dx.atan2(dz) - facing).abs() > arc
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
/// A wrecking ball leaves its wrist down the aim: the player's crosshair, or an AI's target.
fn launch(g: &mut Game, id: MechId, arm: Sec) {
    let m = &g.mechs[id];
    let from = wrist(m, arm);
    let aim = if id == PLAYER {
        g.aim
    } else {
        m.ai.target.filter(|&t| g.mechs[t].alive).map_or_else(
            || {
                let (y, p) = (m.view_yaw(), m.pitch);
                from + v3(y.sin() * p.cos(), p.sin(), y.cos() * p.cos()) * 50.
            },
            |t| center_of(&g.mechs[t]),
        )
    };
    let dir = (aim - from).norm();
    g.mechs[id].flail = Some(Flail {
        arm,
        dir,
        out: 0.,
        back: false,
        at: from,
    });
    // A heave as it goes, and the chain paying out.
    feel(g, Feel::Whiff, Some(id), 1., 0., None, None);
    g.sfx_by(id, Sfx::Chain { back: false }, from);
}
/// The ball on its chain: out until it meets a mech, the ground or the chain's end, then back.
fn flail_tick(g: &mut Game, id: MechId, dt: f32) {
    let Some(mut f) = g.mechs[id].flail else {
        return;
    };
    let m = &g.mechs[id];
    let Some(c) = melee_of(m).chain.or(FIST_MELEE.chain) else {
        g.mechs[id].flail = None;
        return;
    };
    let (sc, from) = (m.ch.scale, wrist(m, f.arm));
    if f.back {
        f.out -= c.back * sc * dt;
        if f.out <= 0. {
            g.mechs[id].flail = None;
            g.sfx_by(id, Sfx::Punch { hit: false }, from);
            return;
        }
        f.at = from + f.dir * f.out;
        g.mechs[id].flail = Some(f);
        return;
    }
    f.out += c.out * sc * dt;
    let at = from + f.dir * f.out;
    f.at = at;
    let ball = c.ball * sc;
    let hit = g
        .mechs
        .iter()
        .enumerate()
        .filter(|&(i, t)| {
            i != id
                && t.alive
                && hypot2(t.x - at.x, t.z - at.z) <= t.radius() + ball
                && at.y >= t.y - ball
                && at.y <= t.top() + ball
        })
        .min_by(|a, b| {
            let d = |t: &Mech| hypot2(t.x - at.x, t.z - at.z);
            d(a.1).total_cmp(&d(b.1))
        })
        .map(|(i, _)| i);
    if let Some(t) = hit {
        f.back = true;
        g.mechs[id].flail = Some(f);
        wreck(g, id, t, at, f.dir, c);
        return;
    }
    if at.y < g.ter.height(at.x, at.z) + ball * 0.5 {
        // It hits the ground: a thud and dust, and back it comes.
        f.back = true;
        feel(g, Feel::Whiff, Some(id), 0.6, 0., None, None);
        g.sfx_by(id, Sfx::Land(0.5), at);
    } else if f.out >= c.reach * sc {
        f.back = true;
        g.sfx_by(id, Sfx::Chain { back: true }, at);
    }
    g.mechs[id].flail = Some(f);
}
/// A wrecking ball lands: the punch's blow and shove, a stagger, and the hardest feel there is
/// for the one it hit.
fn wreck(g: &mut Game, id: MechId, t: MechId, at: V3, dir: V3, c: &ChainDef) {
    let def = melee_of(&g.mechs[id]);
    let flat = hypot2(dir.x, dir.z).max(1e-6);
    let (nx, nz) = (dir.x / flat, dir.z / flat);
    let tyaw = g.mechs[t].view_yaw();
    g.mechs[t].last_hit = Some(HitBy::Punch);
    damage(g, t, at, def.dmg, Some(id), false, true);
    let v = knock(g, t, Some(id), def.knock, [nx, nz], true);
    let ratio = (v / def.knock.max(1.)).clamp(KNOCK_MIN, KNOCK_MAX);
    g.mechs[id].heat += def.heat;
    g.mechs[t].stagger = g.mechs[t].stagger.max(c.stagger);
    // Two legs go over; SLOWPOKE's four take it and stand.
    crate::down::knock_down(g, t, [nx, nz]);
    // And it's thrown off the ground: higher the lighter it is next to the thrower.
    let u = ((ratio - KNOCK_MIN) / (KNOCK_MAX - KNOCK_MIN)).clamp(0., 1.);
    let tm = &mut g.mechs[t];
    if tm.alive && !tm.air {
        tm.vy = tm
            .vy
            .max(THROW_LIFT[0] + (THROW_LIFT[1] - THROW_LIFT[0]) * u);
        (tm.air, tm.thrown, tm.air_t) = (true, true, 0.);
    }
    let side = sign(nx * tyaw.cos() - nz * tyaw.sin());
    let side = if side == 0. { 1. } else { side };
    feel(
        g,
        Feel::Punch,
        Some(id),
        1.,
        0.,
        None,
        if id == PLAYER { None } else { Some(at) },
    );
    feel(
        g,
        Feel::Wrecked,
        Some(t),
        1.,
        -side,
        None,
        if t == PLAYER { None } else { Some(at) },
    );
    if id == PLAYER || t == PLAYER {
        g.hit_stop = g.hit_stop.max(2. * HIT_STOP);
    }
    g.sfx(Sfx::Wreck, if t == PLAYER { None } else { Some(at) });
    if t == PLAYER {
        g.sfx(Sfx::Ring, None);
    }
    g.farthest_shove = g.farthest_shove.max(v);
}
pub fn melee_tick(g: &mut Game, id: MechId, dt: f32) {
    flail_tick(g, id, dt);
    let m = &mut g.mechs[id];
    m.melee_cd = (m.melee_cd - dt).max(0.);
    let Some(mut sw) = m.melee else { return };
    let def = melee_of(m);
    sw.t += dt;
    m.melee = Some(sw);
    if sw.phase == SwingPhase::Windup && sw.t >= def.windup {
        sw.phase = SwingPhase::Recover;
        g.mechs[id].melee = Some(sw);
        if def.chain.is_some() {
            let arm = sw.arm.unwrap_or(Sec::RA);
            launch(g, id, arm);
            return;
        }
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
    // The recovery lasts until the ball is home.
    if sw.phase == SwingPhase::Recover
        && sw.t >= def.windup + def.recover
        && g.mechs[id].flail.is_none()
    {
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
