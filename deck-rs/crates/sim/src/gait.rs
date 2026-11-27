//! Legs: planted feet and two-bone IK. A planted foot stays exactly where it
//! landed while the body moves over it; once the hip has passed it by half a
//! stride it lifts, arcs, and lands half a stride ahead of where the body will
//! be at touchdown. Feet never slide, and faster walking just means quicker
//! steps: the gait clock is distance travelled, not time.
use crate::data::*;
use crate::effects::{dust_col, particle};
use crate::feel::feel;
use crate::game::*;
use crate::math::*;
use crate::spring::Spring;
use crate::terrain::Terrain;

pub fn gait_of(m: &Mech) -> &'static Gait {
    &GAIT[m.ch.legs.i()]
}
/// Where foot i would stand, `ahead` metres along the heading.
pub fn rest_foot(ter: &Terrain, m: &Mech, i: usize, ahead: f32) -> V3 {
    let s = m.ch.scale;
    let l = &m.geo.legs()[i];
    let (c, sn) = (m.yaw.cos(), m.yaw.sin());
    let (lx, lz) = (l.fx * s, l.fz * s + ahead);
    let (x, z) = (m.x + c * lx + sn * lz, m.z - sn * lx + c * lz);
    v3(x, ter.height(x, z), z)
}
/// A point in the cycle where no leg is mid-swing: 0.45 for the stock plans.
fn rest_cyc(g: &Geo) -> f32 {
    let free = |c: f32| {
        g.legs()
            .iter()
            .all(|l| (c - l.ph).rem_euclid(1.) >= g.swing)
    };
    if free(0.45) {
        return 0.45;
    }
    let mut c = 0.;
    while c < 1. {
        if free(c) && free(c + 0.01) {
            return c + 0.005;
        }
        c += 0.005;
    }
    0.45
}
fn still_body(m: &mut Mech) {
    m.torso = None;
    m.torso_drop = 0.;
    m.torso_nod = 0.;
    m.hull = None;
    m.p_vault = None;
    m.p_ahead = 0.;
}
pub fn init_feet(ter: &Terrain, m: &mut Mech) {
    for i in 0..m.geo.n_legs {
        let pos = rest_foot(ter, m, i, 0.);
        m.feet[i] = Foot {
            pos,
            from: pos,
            lifted: false,
            yaw: m.yaw,
        };
    }
    m.bob = 0.;
    m.cyc = rest_cyc(&m.geo);
    still_body(m);
}
fn swing_target(
    ter: &Terrain,
    m: &Mech,
    i: usize,
    u: f32,
    d: f32,
    dir: f32,
    sw: f32,
    back: f32,
) -> V3 {
    rest_foot(
        ter,
        m,
        i,
        dir * ((1. - u) * sw * d + ((1. - sw) / 2.) * d - back),
    )
}
/// How far into its run a mech is at this pace, 0 to 1 (a heavy one walks).
pub fn run_of(m: &Mech, pace: f32) -> f32 {
    let gp = gait_of(m);
    let t = clamp((pace - gp.run_at) / 0.2, 0., 1.);
    if m.max_speed >= gp.run_min {
        t * t * (3. - 2. * t)
    } else {
        0.
    }
}
/// The share of the cycle a foot is in the air now: a runner's grows to a flight phase.
pub fn swing_now(m: &Mech, pace: f32) -> f32 {
    lerp(
        m.geo.swing,
        m.geo.swing.max(gait_of(m).run_swing),
        run_of(m, pace),
    )
}
/// How far a planted foot may sit ahead of or behind its rest spot before its leg is straight.
fn leg_room(g: &Geo, s: f32, crouch: f32) -> f32 {
    let (l, dy) = ((g.l1 + g.l2) * 0.97, g.hip - crouch - g.ankle);
    let mut room = f32::INFINITY;
    for leg in g.legs() {
        let dx = leg.fx - leg.hx;
        let flat = l * l - dy * dy - dx * dx;
        if flat <= 0. {
            return 0.;
        }
        let (r, off) = (flat.sqrt(), leg.fz - leg.hz);
        room = room.min(r - off).min(r + off);
    }
    room.max(0.) * s
}
/// The cycle's length in metres at this pace: from the walking stride up to the class's cadence at
/// top speed, never more than the legs can reach.
pub fn stride_of(m: &Mech, pace: f32, sw: f32) -> f32 {
    let (g, gp, s, top) = (&m.geo, gait_of(m), m.ch.scale, m.max_speed);
    let reach = 2. * leg_room(g, s, gp.crouch * pace) / (1. - sw) * 0.85;
    let cad = lerp(
        gp.cadence,
        if gp.run_cadence > 0. {
            gp.run_cadence
        } else {
            gp.cadence
        },
        run_of(m, pace),
    );
    let want = (s * (g.stride[0] + g.stride[1])).max(2. * top / cad);
    let dtop = (s * g.stride[0]).max(want.min(reach));
    s * g.stride[0] + (dtop - s * g.stride[0]) * pace
}
fn leg_ok(m: &Mech, i: usize) -> bool {
    m.hp[if m.geo.legs()[i].hx > 0. {
        Sec::LL.i()
    } else {
        Sec::RL.i()
    }] > 0.
}

/// The pendulum body: the planted leg is held nearly straight and the hull vaults over it like a
/// weight on a stiff pole, on a spring each footfall pushes down; the torso follows late on a
/// softer spring and nods as it lags. All drawn: the mech's place, speed and feet are unchanged.
fn pendulum_body(m: &mut Mech, pace: f32, v: f32, dt: f32, lame: f32) {
    let (g, gp, s) = (m.geo, gait_of(m), m.ch.scale);
    let (l1, l2, c, sn) = (g.l1 * s, g.l2 * s, m.yaw.cos(), m.yaw.sin());
    let knee = lerp(
        gp.knee - gp.knee_fast * pace,
        if gp.run_knee > 0. {
            gp.run_knee
        } else {
            gp.knee
        },
        run_of(m, pace),
    );
    let pole = (l1 * l1 + l2 * l2 - 2. * l1 * l2 * (knee * PI / 180.).cos()).sqrt();
    let full = (l1 + l2) * 0.98;
    let (mut up, mut cap, mut drop) = (f32::NEG_INFINITY, f32::INFINITY, f32::INFINITY);
    for i in 0..g.n_legs {
        let f = m.feet[i];
        if f.lifted || !leg_ok(m, i) {
            continue;
        }
        let l = &g.legs()[i];
        let (hx, hz) = (
            m.x + (c * l.hx + sn * l.hz) * s,
            m.z + (-sn * l.hx + c * l.hz) * s,
        );
        let (dx, dz) = (f.pos.x - hx, f.pos.z - hz);
        let (flat, side, ay) = (dx * dx + dz * dz, dx * c - dz * sn, f.pos.y + g.ankle * s);
        let h = (pole * pole - flat).max(0.).sqrt();
        let top = ay + (pole * pole - side * side).max(0.).sqrt();
        if top - gp.vault * (top - ay - h) > up {
            drop = top - ay - h;
            up = top - gp.vault * drop;
        }
        cap = cap.min(ay + (full * full - flat).max(0.).sqrt());
    }
    let walk_y = if up == f32::NEG_INFINITY {
        m.p_walk
    } else {
        up.min(cap) - (m.y + g.hip * s)
    };
    if drop == f32::INFINITY {
        drop = m.p_drop;
    }
    if m.hull.is_none() {
        m.p_mean = drop;
    }
    m.p_walk = walk_y;
    m.p_drop = drop;
    m.p_mean += (drop - m.p_mean) * (dt * 2.).min(1.);
    let k = clamp(pace / 0.3, 0., 1.);
    let target = walk_y * k * k * (3. - 2. * k);
    let vault = match m.p_vault {
        None => target,
        Some(pv) => pv + (target - pv) * (dt / 0.04).min(1.),
    };
    m.p_vault = Some(vault);
    let hull = m
        .hull
        .get_or_insert_with(|| Spring::new(gp.body_k, gp.body_zeta));
    hull.tune(gp.body_k, gp.body_zeta);
    hull.step(dt, 0.);
    let hull_y = vault + hull.x;
    let ahead =
        v.abs() * gp.speed_up * clamp((drop - m.p_mean) / (0.05 * (l1 + l2)), -1., 1.) * sign(v);
    m.p_ahead += (ahead - m.p_ahead * 3.) * dt;
    m.surge = m.p_ahead / s;
    let tk = 1. / (gp.lag * gp.lag);
    let torso = m.torso.get_or_insert_with(|| Spring {
        x: hull_y,
        ..Spring::new(tk, 0.7)
    });
    torso.tune(tk, 0.7);
    torso.step(dt, hull_y);
    let lag = torso.x - hull_y;
    m.torso_drop = lag / s;
    m.torso_nod = -lag * gp.nod;
    m.bob = hull_y.min(lame);
}

/// One mech's legs, one frame. Returns the feet that came down (index, pace) for `foot_down`.
fn step_legs(ter: &Terrain, m: &mut Mech, dt: f32, time: f32) -> Vec<(usize, f32)> {
    let mut down = vec![];
    let v = if m.walled() { m.slide } else { m.speed };
    let (gp, g, s) = (gait_of(m), m.geo, m.ch.scale);
    let pace = (v.abs() / m.max_speed).min(1.);
    let crouch = -gp.crouch * s * pace;
    // No legs left: the hull sits on the ground; the torso still turns and fires.
    if m.hp[Sec::LL.i()] <= 0. && m.hp[Sec::RL.i()] <= 0. {
        for i in 0..g.n_legs {
            let pos = rest_foot(ter, m, i, 0.);
            m.feet[i] = Foot {
                pos,
                from: pos,
                lifted: false,
                yaw: m.yaw,
            };
        }
        m.bob = -(g.hip - 0.9) * s;
        (
            m.lean, m.sway, m.hip_yaw, m.surge, m.run_k, m.run_lean, m.last_yaw,
        ) = (0., 0., 0., 0., 0., 0., m.yaw);
        still_body(m);
        return down;
    }
    // One leg gone: lean toward the gap, about 8 degrees.
    m.lean = if m.hp[Sec::LL.i()] <= 0. {
        0.14
    } else if m.hp[Sec::RL.i()] <= 0. {
        -0.14
    } else {
        0.
    };
    let dyaw = wrap(m.yaw - m.last_yaw).abs();
    m.last_yaw = m.yaw;
    if m.air {
        // The legs hang under the body until touchdown.
        for i in 0..g.n_legs {
            let r = rest_foot(ter, m, i, 0.);
            m.feet[i].pos = v3(r.x, m.y + 1.4 * s, r.z);
            m.feet[i].lifted = false;
            m.feet[i].yaw = m.yaw;
        }
        (m.bob, m.sway, m.hip_yaw, m.surge, m.was_air) = (0., 0., 0., 0., true);
        still_body(m);
        return down;
    }
    if m.was_air {
        m.was_air = false;
        m.cyc = rest_cyc(&g);
        for i in 0..g.n_legs {
            m.feet[i].pos = rest_foot(ter, m, i, 0.);
            m.feet[i].yaw = m.yaw;
        }
    }
    let sw = swing_now(m, pace);
    let d = stride_of(m, pace, sw);
    let swing_of = |cyc: f32, i: usize| {
        let u = (cyc - g.legs()[i].ph).rem_euclid(1.) / sw;
        if u < 1. {
            Some(u)
        } else {
            None
        }
    };
    let any_swing = (0..g.n_legs).any(|i| swing_of(m.cyc, i).is_some());
    let moving = v.abs() > 0.3 || dyaw > 1e-4;
    // Stopped mid-stride: finish the step on the clock rather than freeze with a foot up.
    let adv = if moving {
        (v.abs() * dt + dyaw * 2.5 * s) / d
    } else if any_swing {
        dt / 0.6
    } else {
        0.
    };
    m.cyc = (m.cyc + adv.min(0.2)) % 1.;
    let dir = if v.abs() > 0.3 { sign(v) } else { 0. };
    // The hull: sunk by the crouch, dipped by the last footfall; the body lurches ahead after one.
    let since = time - m.step_at;
    let tau = 0.1;
    let dip = if since < 1. {
        (since / tau) * (1. - since / tau).exp()
    } else {
        0.
    };
    m.bob = crouch - dip * gp.drop * s * (0.4 + 0.6 * pace);
    let lurch = if since < 1.5 {
        (since / 0.16) * (1. - since / 0.16).exp()
    } else {
        0.
    };
    m.surge = lurch * gp.surge * pace * dir;
    let back = lerp(gp.plant_back[0], gp.plant_back[1], run_of(m, pace)) * ((1. - sw) / 2.) * d;
    let (mut sway, mut turn, mut lame) = (0., 0., f32::INFINITY);
    for i in 0..g.n_legs {
        let u = swing_of(m.cyc, i);
        if !leg_ok(m, i) {
            // The leg is gone: nothing swings, and the body dips where its step would have carried it.
            m.feet[i].lifted = false;
            if let Some(u) = u {
                lame = lame.min(crouch - (PI * u).sin() * (gp.crouch + 0.35) * s);
            }
            continue;
        }
        let Some(u) = u else {
            if m.feet[i].lifted {
                // The swing just ended: put it down exactly on target.
                m.feet[i].pos = swing_target(ter, m, i, 1., d, dir, sw, back);
                m.feet[i].yaw = m.yaw;
                m.feet[i].lifted = false;
                down.push((i, pace));
            }
            continue;
        };
        if !m.feet[i].lifted {
            m.feet[i].from = m.feet[i].pos;
            m.feet[i].lifted = true;
        }
        // The leg swings as a pendulum does: quickest through the middle; its lift peaks early.
        let t = swing_target(ter, m, i, u, d, dir, sw, back);
        let e = (1. - (PI * u).cos()) / 2.;
        let f = &mut m.feet[i];
        if hypot2(f.from.x - t.x, f.from.z - t.z) > 1.5 * d + 3. * s {
            f.from = t; // shoved mid-stride: start from the target
        }
        let up = (PI * u.powf(gp.lift_early)).sin() * (gp.lift[0] + gp.lift[1] * pace) * s;
        f.pos = v3(
            lerp(f.from.x, t.x, e),
            lerp(f.from.y, t.y, e) + up,
            lerp(f.from.z, t.z, e),
        );
        f.yaw += wrap(m.yaw - f.yaw) * (dt * 10.).min(1.);
        let arc = (PI * u).sin();
        let leg = &g.legs()[i];
        let side = sign(leg.hx) * if leg.hz >= -0.2 { 1. } else { 0. };
        sway -= side * arc * gp.sway * (0.3 + pace).min(1.);
        turn -= side * arc * gp.hip_turn * pace;
    }
    for &(_, p) in &down {
        // The pendulum body: the weight comes down on the new foot.
        if let Some(h) = m.hull.as_mut() {
            h.kick(-gp.sink * s * (0.4 + 0.6 * p));
        }
        m.step_at = time;
    }
    pendulum_body(m, pace, v, dt, lame);
    m.run_k += ((if dir > 0. { run_of(m, pace) } else { 0. }) - m.run_k) * (dt * 4.).min(1.);
    m.run_lean = gp.run_lean * m.run_k;
    m.bob -= gp.run_drop * s * m.run_k;
    m.sway = sway;
    m.hip_yaw = turn;
    // A planted foot left hopelessly far away (shoved) just resets.
    for i in 0..g.n_legs {
        if m.feet[i].lifted {
            continue;
        }
        let r = rest_foot(ter, m, i, 0.);
        if hypot2(m.feet[i].pos.x - r.x, m.feet[i].pos.z - r.z) > 7. * s {
            m.feet[i].pos = r;
        }
    }
    down
}
impl Mech {
    /// Against a wall the legs walk only as fast as the body goes. (No walls yet: the ground is a height field.)
    pub fn walled(&self) -> bool {
        false
    }
}
pub fn gait(g: &mut Game, id: MechId, dt: f32) {
    let time = g.time;
    let down = step_legs(&g.ter, &mut g.mechs[id], dt, time);
    for (i, pace) in down {
        foot_down(g, id, i, pace);
    }
}
/// Touchdown: the sound, the cockpit jolt, a puff of dust; a heavy's steps felt nearby.
fn foot_down(g: &mut Game, id: MechId, i: usize, pace: f32) {
    let (pos, scale) = (g.mechs[id].feet[i].pos, g.mechs[id].ch.scale);
    let (px, pz) = (g.p().x, g.p().z);
    let d = if id == PLAYER {
        0.
    } else {
        hypot2(g.mechs[id].x - px, g.mechs[id].z - pz)
    };
    let at = if id == PLAYER { None } else { Some(pos) };
    feel(
        g,
        Feel::Step,
        Some(id),
        (0.35 + 0.65 * pace) * scale * scale,
        0.,
        None,
        at,
    );
    if id == PLAYER {
        g.sfx(
            Sfx::Step {
                vol: 0.4 + 0.55 * pace,
                scale,
            },
            None,
        );
    } else if d < 350. {
        g.sfx(
            Sfx::Step {
                vol: 0.3 + 0.45 * pace,
                scale,
            },
            Some(pos),
        );
    }
    if id != PLAYER && scale > 1.1 && d < 40. {
        feel(
            g,
            Feel::NearStep,
            Some(PLAYER),
            (1. - d / 40.) * scale * scale,
            0.,
            None,
            Some(pos),
        );
    }
    if pace > 0.25 && d < 260. {
        let col = dust_col(g, 0.8);
        let n = (3. * feel_row(Feel::Step).dust * (0.5 + 0.5 * pace) * scale).round() as i32;
        for _ in 0..n {
            let r = &mut g.rng;
            let (p, v, life, size) = (
                pos + v3(r.range(-1., 1.), 0.3, r.range(-1., 1.)),
                v3(r.range(-2., 2.), r.range(0.5, 1.5), r.range(-2., 2.)),
                r.range(0.6, 1.),
                r.range(0.5, 0.9) * scale,
            );
            particle(g, p, v, life, size, col, PKind::Smoke, 0.);
        }
    }
}
/// The knee by the law of cosines, bending toward `pole`.
pub fn solve_knee(h: V3, a: V3, pole: V3, l1: f32, l2: f32) -> V3 {
    let d = a - h;
    let raw = d.len();
    let n = d * (1. / if raw > 1e-6 { raw } else { 1. });
    let dist = clamp(raw, (l1 - l2).abs() + 1e-3, (l1 + l2) * 0.999);
    let ang = clamp(
        (l1 * l1 + dist * dist - l2 * l2) / (2. * l1 * dist),
        -1.,
        1.,
    )
    .acos();
    let mut p = pole - n * pole.dot(n);
    p = if p.len() < 1e-4 {
        v3(0., 0., 1.)
    } else {
        p.norm()
    };
    h + n * (l1 * ang.cos()) + p * (l1 * ang.sin())
}
