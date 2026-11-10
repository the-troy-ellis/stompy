//! Enemy AI: perception by line of sight, a per-chassis plan of behaviours, and
//! fire discipline by difficulty. Difficulty scales skill, never stats.
use crate::combat::fire;
use crate::data::*;
use crate::game::*;
use crate::geom::{blocked, center_of, eye_of};
use crate::math::*;
use crate::mech::{grade_factor, grips};
use crate::melee::{can_punch, melee_of, melee_press, melee_target};

fn diff(g: &Game) -> &'static DiffDef {
    &DIFFS[g.diff.i()]
}
fn eye_at(g: &Game, e: &Mech, x: f32, z: f32) -> V3 {
    v3(
        x,
        g.ter.height(x, z) + (e.geo.torso_y + e.geo.eye[1]) * e.ch.scale,
        z,
    )
}
fn in_map(g: &Game, x: f32, z: f32) -> (f32, f32) {
    (
        clamp(x, -g.ter.bx + 40., g.ter.bx - 40.),
        clamp(z, -g.ter.bz + 40., g.ter.bz - 40.),
    )
}

// --- perception ------------------------------------------------------------------------------------
/// Sees the player within the difficulty's sight (less in weather) after its react delay; shouts to
/// allies; searches after losing contact for long enough. Returns where it believes the player is.
fn perceive(g: &mut Game, id: MechId) -> Option<(f32, f32)> {
    let (time, sight) = (g.time, diff(g).sight * WEATHER[g.weather.i()].radar);
    let (px, py, pz, palive, pyaw, pspeed) = {
        let p = g.p();
        (p.x, p.y, p.z, p.alive, p.yaw, p.speed)
    };
    if time >= g.mechs[id].ai.look_t {
        let e = &g.mechs[id];
        let d = hypot2(px - e.x, pz - e.z);
        let seen = palive && d < sight && !blocked(g, eye_of(e), center_of(g.p()));
        let react = diff(g).react;
        let a = &mut g.mechs[id].ai;
        a.look_t = time + LOOK_EVERY;
        if seen {
            if !a.aware {
                let at = *a.react_at.get_or_insert(time + react);
                if time >= at {
                    a.aware = true;
                    a.shout_at = Some(time + SHOUT_DELAY);
                }
            }
            if a.aware {
                a.seen = true;
                a.last_seen = time;
                a.belief = Some((
                    v3(px, py, pz),
                    [pyaw.sin() * pspeed, pyaw.cos() * pspeed],
                    time,
                ));
                a.state = AiState::Fight;
            }
        } else {
            a.seen = false;
            if !a.aware {
                a.react_at = None;
            }
        }
    }
    let a = g.mechs[id].ai;
    if a.aware && a.shout_at.is_some_and(|t| time >= t) {
        // The contact call: allies nearby wake up and share the fix.
        g.mechs[id].ai.shout_at = None;
        let (ex, ez, team) = (g.mechs[id].x, g.mechs[id].z, g.mechs[id].team);
        for (i, o) in g.mechs.iter_mut().enumerate() {
            if i != id
                && o.alive
                && o.team == team
                && !o.ai.aware
                && hypot2(o.x - ex, o.z - ez) < SHOUT_RANGE
            {
                o.ai.aware = true;
                o.ai.belief = a.belief;
            }
        }
    }
    let a = &mut g.mechs[id].ai;
    if a.aware
        && !a.seen
        && a.belief.is_some()
        && time - a.last_seen > LOST_AFTER
        && a.state == AiState::Fight
    {
        a.state = AiState::Search;
        a.wp = None;
        a.cover = None;
    }
    if a.seen {
        return Some((px, pz));
    }
    a.belief.map(|(p, v, at)| {
        let t = EXTRAPOLATE.min(time - at);
        (p.x + v[0] * t, p.z + v[1] * t)
    })
}

// --- behaviours ------------------------------------------------------------------------------------
struct Ctx {
    dist: f32,
    to_yaw: f32,
    seen: bool,
    reach_e: f32,
}
#[derive(Clone, Copy)]
struct Out {
    yaw: f32,
    thr: f32,
    jets: bool,
}
fn go(yaw: f32, thr: f32) -> Option<Out> {
    Some(Out {
        yaw,
        thr,
        jets: false,
    })
}
/// How far a spot is in walking: a climb costs a walker its slope penalty; a cliff is impassable.
fn travel(g: &Game, e: &Mech, x: f32, z: f32) -> f32 {
    let d = hypot2(x - e.x, z - e.z);
    if d < 1. {
        return d;
    }
    let n = (d / 4.).ceil() as i32;
    let mut h = g.ter.height(e.x, e.z);
    for k in 0..n {
        let f = (k + 1) as f32 / n as f32;
        let h2 = g.ter.height(e.x + (x - e.x) * f, e.z + (z - e.z) * f);
        if h2 - h > 1.6 * d / n as f32 {
            return f32::INFINITY;
        }
        h = h2;
    }
    if grips(e) {
        d
    } else {
        d / grade_factor((g.ter.height(x, z) - g.ter.height(e.x, e.z)) / d)
    }
}
fn strafe_tick(g: &mut Game, id: MechId, dt: f32) {
    let t = g.rng.range(3., 7.);
    let a = &mut g.mechs[id].ai;
    a.strafe_t -= dt;
    if a.strafe_t <= 0. {
        a.strafe *= -1.;
        a.strafe_t = t;
    }
}
/// Approach above the band, back off below it, orbit inside it.
fn keep_range(e: &Mech, c: &Ctx, pref: f32, lo: f32, hi: f32) -> Option<Out> {
    let s = e.ai.strafe;
    if c.dist > pref * hi {
        go(c.to_yaw + s * 0.35, 1.)
    } else if c.dist < pref * lo {
        go(c.to_yaw + PI - s * 0.6, 1.)
    } else {
        go(c.to_yaw + s * PI / 2., 0.75)
    }
}
/// Hot or hurt: the nearest spot from which the target cannot be seen.
fn find_cover(g: &Game, e: &Mech) -> Option<[f32; 2]> {
    let tc = center_of(g.p());
    let mut best: Option<([f32; 2], f32)> = None;
    for d in COVER_DISTS {
        for k in 0..8 {
            let a = k as f32 * PI / 4.;
            let (x, z) = in_map(g, e.x + a.sin() * d, e.z + a.cos() * d);
            if !blocked(g, eye_at(g, e, x, z), tc) {
                continue;
            }
            let t = travel(g, e, x, z);
            if t.is_finite() && best.is_none_or(|b| t < b.1) {
                best = Some(([x, z], t));
            }
            if best.is_some_and(|b| b.1 <= COVER_DISTS[0]) {
                return best.map(|b| b.0);
            }
        }
    }
    best.map(|b| b.0)
}
fn cover(g: &mut Game, id: MechId, by_torso: bool, torso: f32) -> Option<Out> {
    let time = g.time;
    let e = &g.mechs[id];
    let (hot, hurt) = (
        e.heat > COVER_HEAT,
        by_torso && e.hp[Sec::T.i()] < e.max[Sec::T.i()] * torso,
    );
    if e.ai.cover.is_none() {
        if !(hot || (hurt && !(e.ai.cover_cd > time))) || e.ai.cover_look_t > time {
            return None;
        }
        g.mechs[id].ai.cover_look_t = time + COVER_EVERY;
        let c = find_cover(g, &g.mechs[id])?;
        g.mechs[id].ai.cover = Some((c, time));
    }
    let e = &mut g.mechs[id];
    let (c, since) = e.ai.cover.unwrap();
    if e.heat < COVER_LEAVE && (!hurt || time - since > COVER_MAX_WAIT) {
        e.ai.cover = None;
        e.ai.cover_cd = time + COVER_RETRY;
        return None;
    }
    e.ai.last_seen = time; // hiding on purpose is not losing contact
    if hypot2(c[0] - e.x, c[1] - e.z) < COVER_ARRIVE {
        return go(e.yaw, 0.);
    }
    go((c[0] - e.x).atan2(c[1] - e.z), 1.)
}
/// Light mechs: orbit close, flip the strafe when hit, jump over the target when near. With `stomp`
/// the jump is a dive onto it.
fn harass(g: &mut Game, id: MechId, c: &Ctx, stomp: bool) -> Option<Out> {
    let time = g.time;
    let flip = g.rng.range(3., 7.);
    let e = &mut g.mechs[id];
    let a = &mut e.ai;
    if let Some(h) = a.hit_at {
        if a.flipped_at != Some(h) && !(h - a.flip_t < HIT_FLIP_EVERY) {
            a.flipped_at = Some(h);
            a.flip_t = h;
            a.strafe *= -1.;
            a.strafe_t = flip;
        }
    }
    if let Some((until, yaw)) = a.jump {
        if stomp && e.air && c.dist < STOMP_OVER {
            a.jump = Some((0., yaw));
            return go(c.to_yaw, 0.);
        }
        if time < until {
            return Some(Out {
                yaw: if stomp { c.to_yaw } else { yaw },
                thr: 1.,
                jets: true,
            });
        }
        if e.air {
            return go(yaw, 1.);
        }
        a.jump = None;
        a.jump_cd = time + JUMP_COOLDOWN;
    }
    if c.seen
        && c.dist < JUMP_WITHIN
        && !e.air
        && e.fuel >= 1.
        && !(a.jump_cd > time)
        && e.melee.is_none()
        && e.jets > 0
    {
        a.jump = Some((time + JUMP_FOR, c.to_yaw));
        return Some(Out {
            yaw: c.to_yaw,
            thr: 1.,
            jets: true,
        });
    }
    let mid = (HARASS_BAND[0] + HARASS_BAND[1]) / 2.;
    keep_range(e, c, mid, HARASS_BAND[0] / mid, HARASS_BAND[1] / mid)
}
/// Snipers: a spot well above the target with a view of it.
fn find_ridge(g: &Game, e: &Mech, avoid: Option<[f32; 2]>) -> Option<[f32; 2]> {
    let t = g.p();
    let (tc, base) = (center_of(t), g.ter.height(t.x, t.z));
    let mut best: Option<([f32; 2], f32)> = None;
    for r in RIDGE_RADII {
        for k in 0..16 {
            let a = k as f32 * PI / 8.;
            let (x, z) = in_map(g, t.x + a.sin() * r, t.z + a.cos() * r);
            if g.ter.height(x, z) < base + RIDGE_ABOVE
                || avoid.is_some_and(|v| hypot2(x - v[0], z - v[1]) < RELOCATE_AWAY)
                || blocked(g, eye_at(g, e, x, z), tc)
            {
                continue;
            }
            let d = travel(g, e, x, z);
            if d.is_finite() && best.is_none_or(|b| d < b.1) {
                best = Some(([x, z], d));
            }
        }
    }
    best.map(|b| b.0)
}
/// After `relocate` shots it moves on, away from where it fired them.
fn ridge(g: &mut Game, id: MechId, relocate: i32) -> Option<Out> {
    let time = g.time;
    let e = &mut g.mechs[id];
    if relocate > 0 && e.ai.shots - e.ai.shots_at >= relocate {
        e.ai.shots_at = e.ai.shots;
        e.ai.move_off = Some([e.x, e.z]);
        e.ai.ridge_look_t = 0.;
    }
    if !(e.ai.ridge_look_t > time) {
        e.ai.ridge_look_t = time + RIDGE_EVERY;
        let avoid = e.ai.move_off;
        let r = find_ridge(g, &g.mechs[id], avoid);
        g.mechs[id].ai.ridge = r;
    }
    let e = &g.mechs[id];
    let r = e.ai.ridge?;
    if hypot2(r[0] - e.x, r[1] - e.z) < RIDGE_ARRIVE {
        return None;
    }
    go((r[0] - e.x).atan2(r[1] - e.z), 1.)
}
/// Heavies advance together: no faster than the slowest ally within 150 m.
fn hold_line(g: &Game, id: MechId, out: &mut Out) {
    let e = &g.mechs[id];
    let slowest = g
        .mechs
        .iter()
        .enumerate()
        .filter(|&(i, o)| {
            i != id && o.team == e.team && o.alive && hypot2(o.x - e.x, o.z - e.z) <= LINE_RANGE
        })
        .map(|(_, o)| o.max_speed)
        .fold(e.max_speed, f32::min);
    if slowest < e.max_speed {
        out.thr = out.thr.min(slowest / e.max_speed);
    }
}
fn avoid_edge(g: &Game, e: &Mech, out: &mut Out) {
    if e.x.abs() > g.ter.bx - 60. || e.z.abs() > g.ter.bz - 60. {
        out.yaw = (-e.x).atan2(-e.z);
    }
}
/// Steer round an ally that is close and ahead.
fn avoid_allies(g: &Game, id: MechId, out: &mut Out) {
    let e = &g.mechs[id];
    for (i, o) in g.mechs.iter().enumerate() {
        if i == id || o.team != e.team || !o.alive {
            continue;
        }
        let (dx, dz) = (o.x - e.x, o.z - e.z);
        let (d, gap) = (hypot2(dx, dz), e.radius() + o.radius() + ALLY_GAP);
        if d > gap {
            continue;
        }
        let rel = wrap(dx.atan2(dz) - out.yaw);
        if rel.abs() > PI / 2. {
            continue;
        }
        let sg = if rel == 0. { 1. } else { sign(rel) };
        out.yaw = out.yaw - sg * 0.7 * (1. - d / gap) - sg * 0.3;
        return;
    }
}
/// Run the chassis's plan: the first driver with an opinion, then the shapers.
fn steer(g: &mut Game, id: MechId, c: &Ctx) -> Out {
    let prof = g.mechs[id].ai.profile;
    let out = match prof {
        Profile::Harass => cover(g, id, false, 0.).or_else(|| harass(g, id, c, false)),
        Profile::Line => keep_range(&g.mechs[id], c, g.mechs[id].ch.pref, 0.6, 1.35),
        Profile::Skirmish => cover(g, id, true, 0.5).or_else(|| harass(g, id, c, true)),
        Profile::Sniper => ridge(g, id, RELOCATE_AFTER)
            .or_else(|| cover(g, id, true, COVER_TORSO))
            .or_else(|| keep_range(&g.mechs[id], c, g.mechs[id].ch.pref, 0.6, 1.35)),
        Profile::Brawler => go(c.to_yaw, if c.dist > c.reach_e * 0.8 { 1. } else { 0. }), // never retreats
        Profile::Baseline => cover(g, id, true, COVER_TORSO)
            .or_else(|| keep_range(&g.mechs[id], c, g.mechs[id].ch.pref, 0.6, 1.35)),
    };
    let mut out = out.unwrap_or(Out {
        yaw: c.to_yaw,
        thr: 1.,
        jets: false,
    });
    if prof == Profile::Line {
        hold_line(g, id, &mut out);
    }
    avoid_allies(g, id, &mut out);
    avoid_edge(g, &g.mechs[id], &mut out);
    out
}

// --- fire discipline ---------------------------------------------------------------------------------
/// HARD aims at the more damaged arm's side; the others at the centre.
fn aim_point(g: &Game) -> V3 {
    let p = g.p();
    let c = center_of(p);
    if !diff(g).sections || (p.hp[Sec::LA.i()] <= 0. && p.hp[Sec::RA.i()] <= 0.) {
        return c;
    }
    let (la, ra) = (
        p.hp[Sec::LA.i()] / p.max[Sec::LA.i()],
        p.hp[Sec::RA.i()] / p.max[Sec::RA.i()],
    );
    let side = if p.hp[Sec::LA.i()] > 0. && (p.hp[Sec::RA.i()] <= 0. || la <= ra) {
        1.
    } else {
        -1.
    };
    if la.min(ra) >= 1. {
        return c;
    }
    let (a, o) = (p.view_yaw(), FIRE_ARM_OFFSET * p.ch.scale);
    c + v3(side * o * a.cos(), 0., -side * o * a.sin())
}
pub fn aim_error(g: &Game, e: &Mech, dist: f32) -> f32 {
    let p = g.p();
    dist * e.ch.acc0 * diff(g).aim_err * (1. + p.speed.abs() / 14.) * if p.air { 1.6 } else { 1. }
}
fn decide_fire(g: &mut Game, id: MechId, dist: f32, to_yaw: f32, dt: f32) {
    let (cap, time) = (diff(g).heat_cap, g.time);
    let palive = g.p().alive;
    let pc = aim_point(g);
    let err = aim_error(g, &g.mechs[id], dist);
    let cool = g.rng.range(1.5, 3.);
    let e = &mut g.mechs[id];
    let off = wrap(to_yaw - e.view_yaw()).abs();
    let a = &mut e.ai;
    a.lock_t = if off < FIRE_LOCK_FACE {
        a.lock_t + dt
    } else {
        0.
    };
    a.jitter -= dt;
    if e.heat > cap {
        a.hot = true;
    } else if a.hot && e.heat < cap - FIRE_COOL_BELOW {
        a.hot = false;
    }
    let may = !a.hot && !e.shutdown && palive;
    // Lasers: in bursts while on target and cool enough, with an aim error that drifts.
    let beam =
        e.w.iter()
            .find(|w| w.def.kind == WKind::Beam && !w.dead)
            .map(|w| w.def.range);
    if let (Some(range), true) = (beam, may && off < 0.3) {
        if dist < range * 0.95 {
            if e.heat > cap - 2. {
                a.cool_t = cool;
            }
            a.cool_t = (a.cool_t - dt).max(0.);
            if a.cool_t == 0. {
                let ph = *a.aim_phase.get_or_insert(a.strafe_t + time * 0.1);
                let k = ph - time * 0.1;
                a.beam_aim = pc
                    + v3(
                        (k * 1.3).sin() * err,
                        (k * 1.7).sin() * err * 0.5,
                        (k * 1.1).cos() * err,
                    );
                e.beam_on = true;
            }
        }
    }
    if !may || off > 0.25 || e.ai.jitter > 0. {
        return;
    }
    let alpha_at = if e.ai.profile == Profile::Brawler {
        0.4
    } else {
        FIRE_ALPHA_TORSO
    };
    let alpha = g.p().hp[Sec::T.i()] < g.p().max[Sec::T.i()] * alpha_at;
    let (pyaw, pspeed) = (g.p().yaw, g.p().speed);
    for wi in 0..g.mechs[id].w.len() {
        let w = g.mechs[id].w[wi];
        let d = w.def;
        if matches!(d.kind, WKind::Beam | WKind::Fusion)
            || w.dead
            || w.cd > 0.
            || dist > d.range * 0.95
        {
            continue;
        }
        // Homing missiles want a lock and some room; dumb-fire ones just need facing.
        if d.kind == WKind::Missile
            && d.homing
            && (dist < FIRE_LRM_MIN || g.mechs[id].ai.lock_t < FIRE_LOCK_FOR)
        {
            continue;
        }
        let mut aim = pc;
        if d.kind == WKind::Shell {
            let t = dist / d.speed;
            aim = pc + v3(pyaw.sin() * pspeed * t, 0., pyaw.cos() * pspeed * t);
        }
        let r = &mut g.rng;
        aim += v3(
            r.range(-err, err),
            r.range(-err, err) * 0.6,
            r.range(-err, err),
        );
        if !fire(g, id, wi, aim, Some(PLAYER)) {
            continue;
        }
        g.mechs[id].ai.shots += 1; // the sniper counts them to know when to move
        if !alpha {
            g.mechs[id].ai.jitter = g.rng.range(0.15, 0.6);
            break;
        }
    }
}

/// One enemy, one frame.
pub fn think(g: &mut Game, id: MechId, dt: f32) {
    let belief = perceive(g, id);
    let e = &g.mechs[id];
    let seen = belief.is_some() && e.ai.seen;
    let (tx, tz) = belief.unwrap_or((g.p().x, g.p().z));
    let (dx, dz) = (tx - e.x, tz - e.z);
    let (dist, to_yaw) = (hypot2(dx, dz), dx.atan2(dz));
    let (bx, bz) = (g.ter.bx, g.ter.bz);
    let (move_yaw, mut thr, mut jets);
    thr = 1.;
    jets = false;
    if !e.ai.aware {
        // A patrol between random waypoints.
        if e.ai.wp.is_none_or(|w| hypot2(w[0] - e.x, w[1] - e.z) < 30.) {
            let (ex, ez) = (e.x, e.z);
            let wp = [
                clamp(ex + g.rng.range(-250., 250.), -bx, bx),
                clamp(ez + g.rng.range(-250., 250.), -bz, bz),
            ];
            g.mechs[id].ai.wp = Some(wp);
        }
        let e = &g.mechs[id];
        let wp = e.ai.wp.unwrap();
        move_yaw = (wp[0] - e.x).atan2(wp[1] - e.z);
        thr = 0.5;
    } else if e.ai.state == AiState::Search {
        // Lost contact: go to where they were last seen, then poke around it.
        let b = e.ai.belief.map_or(v3(tx, 0., tz), |b| b.0);
        if e.ai.wp.is_none_or(|w| hypot2(w[0] - e.x, w[1] - e.z) < 25.) {
            let first = e.ai.wp.is_none() && hypot2(b.x - e.x, b.z - e.z) > 25.;
            let wp = if first {
                [b.x, b.z]
            } else {
                [
                    clamp(b.x + g.rng.range(-SEARCH_RADIUS, SEARCH_RADIUS), -bx, bx),
                    clamp(b.z + g.rng.range(-SEARCH_RADIUS, SEARCH_RADIUS), -bz, bz),
                ]
            };
            g.mechs[id].ai.wp = Some(wp);
        }
        let e = &g.mechs[id];
        let wp = e.ai.wp.unwrap();
        move_yaw = (wp[0] - e.x).atan2(wp[1] - e.z);
        thr = 0.7;
    } else {
        strafe_tick(g, id, dt);
        let (e, p) = (&g.mechs[id], g.p());
        let reach_p = melee_of(p).reach * p.ch.scale + e.radius();
        let reach_e = melee_of(e).reach * e.ch.scale + p.radius();
        let too_close = seen && dist < reach_p * AI_PUNCH_KEEP_OUT;
        let brawling = e.ai.profile == Profile::Brawler;
        let punchable = e.ai.profile != Profile::Sniper
            && p.alive
            && can_punch(g, id)
            && melee_target(g, id) == Some(PLAYER);
        if p.shutdown && p.alive {
            // A shut-down player: walk up and shove them. Correct Stompy behaviour.
            move_yaw = to_yaw;
            thr = if dist < reach_p * 0.6 { 0. } else { 1. };
        } else if punchable || e.melee.is_some() {
            move_yaw = to_yaw;
            thr = 0.;
        } else if too_close && !brawling {
            move_yaw = to_yaw + PI - e.ai.strafe * 0.6;
        } else {
            let o = steer(
                g,
                id,
                &Ctx {
                    dist,
                    to_yaw,
                    seen,
                    reach_e,
                },
            );
            (move_yaw, thr, jets) = (o.yaw, o.thr, o.jets);
        }
        g.mechs[id].jetting = jets;
    }
    let e = &mut g.mechs[id];
    let turn = e.ch.turn * dt;
    e.yaw += clamp(wrap(move_yaw - e.yaw), -turn, turn);
    e.throttle = thr;
    if !e.ai.aware {
        e.twist *= 1. - dt;
        return;
    }
    let want = clamp(wrap(to_yaw - e.yaw), -1.9, 1.9);
    e.twist += clamp(wrap(want - e.twist), -2. * dt, 2. * dt);
    let pc = if seen {
        center_of(g.p())
    } else {
        v3(tx, g.ter.height(tx, tz) + 4.2 * g.p().ch.scale, tz)
    };
    let e = &mut g.mechs[id];
    e.pitch = (pc.y - (e.y + 6. * e.ch.scale)).atan2(dist);
    // In reach and facing: the punch, by difficulty. No guns mid-swing.
    if e.ai.profile != Profile::Sniper
        && g.p().alive
        && can_punch(g, id)
        && melee_target(g, id) == Some(PLAYER)
    {
        let p = AI_PUNCH_CHANCE[g.diff.i()];
        if g.p().shutdown || g.rng.chance(1. - (1. - p).powf(dt)) {
            melee_press(g, id);
        }
    }
    if g.mechs[id].melee.is_some() {
        g.mechs[id].beam_on = false;
        return;
    }
    if !seen {
        g.mechs[id].ai.lock_t = 0.;
        return;
    }
    decide_fire(g, id, dist, to_yaw, dt);
}
