//! Blast-off jets: hold JUMP on the ground with the jets ready and they charge;
//! let go and the mech blasts off, up and along, higher the fuller the charge.
//! While charging, a foe in the sights is locked and the blast aims at it.
use crate::data::*;
use crate::effects::{particle, scorch};
use crate::feel::feel;
use crate::game::*;
use crate::geom::center_of;
use crate::math::*;

fn vy_of(t: &JetsDef, c: f32) -> f32 {
    t.vy[0] + (t.vy[1] - t.vy[0]) * (c.max(t.tap) - t.tap) / (1. - t.tap)
}
fn walk_vel(m: &Mech) -> [f32; 2] {
    [
        m.yaw.sin() * m.speed + m.push[0] * 0.4,
        m.yaw.cos() * m.speed + m.push[1] * 0.4,
    ]
}
fn ground_vel(m: &Mech) -> [f32; 2] {
    let w = walk_vel(m);
    if m.air && m.jet.blasted {
        [w[0] + m.jet.fly[0], w[1] + m.jet.fly[1]]
    } else {
        w
    }
}
fn blast_ring(g: &mut Game, p: V3, c: f32, s: f32) {
    let gy = g.ter.height(p.x, p.z);
    particle(
        g,
        v3(p.x, gy + 0.3, p.z),
        V3::ZERO,
        0.45,
        (12. + 22. * c) * s,
        [0.95, 0.86, 0.66],
        PKind::Shock,
        0.,
    );
    if c > 0.5 {
        particle(
            g,
            v3(p.x, gy + 0.2, p.z),
            V3::ZERO,
            0.8,
            (20. + 26. * c) * s,
            [0.85, 0.7, 0.5],
            PKind::Shock,
            0.,
        );
    }
    scorch(g, p.x, p.z, (2.2 + 3.2 * c) * s, gy);
    let low = PALS[g.biome.i()].low;
    let n = (18. + 30. * c) as i32;
    for i in 0..n {
        let r = &mut g.rng;
        let a = (i as f32 / n as f32) * TAU + r.range(-0.1, 0.1);
        let v = r.range(10., 20.) * (0.6 + 0.7 * c);
        let (vy, life, size) = (r.range(0.5, 3.), r.range(0.8, 1.5), r.range(1.2, 2.4) * s);
        particle(
            g,
            v3(p.x + a.sin() * 2. * s, gy + 0.6, p.z + a.cos() * 2. * s),
            v3(a.sin() * v, vy, a.cos() * v),
            life,
            size,
            low,
            PKind::Dust,
            0.,
        );
    }
    for _ in 0..(4. + 8. * c) as i32 {
        let r = &mut g.rng;
        let (a, v) = (r.range(0., TAU), r.range(6., 14.) * (0.5 + 0.5 * c));
        let (vy, life, size) = (
            r.range(6., 14.) * (0.5 + 0.5 * c),
            r.range(0.9, 1.6),
            r.range(0.4, 0.8) * s,
        );
        particle(
            g,
            v3(p.x, gy + 0.8, p.z),
            v3(a.sin() * v, vy, a.cos() * v),
            life,
            size,
            low,
            PKind::Debris,
            18.,
        );
    }
    for _ in 0..(3. + 6. * c) as i32 {
        let r = &mut g.rng;
        let (pp, v, life, size) = (
            v3(
                p.x + r.range(-1., 1.) * s,
                gy + 0.5,
                p.z + r.range(-1., 1.) * s,
            ),
            v3(r.range(-2., 2.), r.range(2., 8.), r.range(-2., 2.)),
            r.range(0.25, 0.5),
            r.range(1.4, 2.4) * s,
        );
        particle(g, pp, v, life, size, [1., 0.6, 0.2], PKind::Fire, 0.);
    }
    for _ in 0..12 {
        let r = &mut g.rng;
        let (pp, v, life, size) = (
            v3(p.x + r.range(-3., 3.), gy + 1., p.z + r.range(-3., 3.)),
            v3(r.range(-2., 2.), r.range(1., 4.), r.range(-2., 2.)),
            r.range(1.6, 2.6),
            r.range(1.8, 3.2) * s,
        );
        particle(g, pp, v, life, size, [0.3, 0.28, 0.26], PKind::Smoke, 0.);
    }
}
/// The speed along an aimed blast takes: to where `o` will be when a flight up at `vy` comes down on its top.
fn aim_blast(m: &Mech, o: &Mech, vy: f32, t: &JetsDef) -> [f32; 2] {
    let y0 = m.y + 0.5;
    let d = vy * vy + 36. * (y0 - o.top());
    let tt = if d > 0. {
        (vy + d.sqrt()) / 18.
    } else {
        vy / 9. + (2. * y0 / 18.).max(0.).sqrt()
    };
    let (v, w) = (ground_vel(o), walk_vel(m));
    let (mut ax, mut az) = (
        (o.x + v[0] * tt - m.x) / tt - w[0],
        (o.z + v[1] * tt - m.z) / tt - w[1],
    );
    let sp = hypot2(ax, az);
    if sp > t.aim_fwd {
        ax *= t.aim_fwd / sp;
        az *= t.aim_fwd / sp;
    }
    [ax, az]
}
pub fn blast_off(g: &mut Game, id: MechId) {
    let m = &g.mechs[id];
    let Some(t) = jets_def(m.jets) else { return };
    let c = m.jet.charge.max(t.tap);
    let k = (c - t.tap) / (1. - t.tap);
    let vy = vy_of(t, c);
    let lock = m
        .jet
        .lock
        .filter(|&l| g.mechs[l].alive && !(m.throttle < 0.));
    let along = t.fwd * c * m.throttle;
    let fly = match lock {
        Some(l) => aim_blast(m, &g.mechs[l], vy, t),
        None => [m.yaw.sin() * along, m.yaw.cos() * along],
    };
    let m = &mut g.mechs[id];
    m.vy = vy;
    m.jet.fly = fly;
    m.y += 0.5;
    m.air = true;
    m.heat += t.heat[0] + (t.heat[1] - t.heat[0]) * k;
    m.fuel = 0.;
    m.jet.blasted = true;
    m.jet.top = m.y;
    m.jet.base = None;
    m.jet.lock = lock;
    m.jet.used = 0.;
    m.jet.away = 0.;
    let (at, s) = (m.pos(), m.ch.scale);
    feel(
        g,
        Feel::Blastoff,
        Some(id),
        0.4 + 0.6 * c,
        0.,
        None,
        if id == PLAYER { None } else { Some(at) },
    );
    blast_ring(g, at, c, s);
    g.sfx_by(id, Sfx::Blastoff(c), at);
}
fn streak(g: &mut Game, id: MechId) {
    if !g.rng.chance(0.6) {
        return;
    }
    let (p, s) = (g.mechs[id].pos(), g.mechs[id].ch.scale);
    let r = &mut g.rng;
    let (pp, v, life, size) = (
        p + v3(r.range(-1., 1.), 0.5, r.range(-1., 1.)),
        v3(r.range(-1., 1.), -2., r.range(-1., 1.)),
        r.range(0.8, 1.6),
        r.range(0.8, 1.4) * s,
    );
    particle(g, pp, v, life, size, [0.4, 0.38, 0.36], PKind::Smoke, 0.);
    particle(
        g,
        p + v3(0., 0.3, 0.),
        v3(0., -6., 0.),
        0.2,
        0.7 * s,
        [1., 0.7, 0.3],
        PKind::Fire,
        0.,
    );
}
pub fn step_jets(g: &mut Game, id: MechId, dt: f32) {
    let m = &mut g.mechs[id];
    let Some(t) = jets_def(m.jets) else {
        m.jet.charge = 0.;
        return;
    };
    let able = m.alive && !m.shutdown && !m.air && m.fuel >= 1.;
    if m.jetting && able {
        m.jet.charge = (m.jet.charge + dt / t.charge).min(1.);
    } else if m.jet.charge > 0. {
        if !m.jetting && able {
            blast_off(g, id); // let go: off it goes
        }
        g.mechs[id].jet.charge = 0.; // or lost: shut down, knocked into the air
    }
    let m = &mut g.mechs[id];
    if m.jet.charge == 0. {
        m.fuel = (m.fuel + dt / t.recharge).min(1.);
    }
    if m.air {
        m.jet.top = m.jet.top.max(m.y);
    } else if m.jet.blasted && m.vy <= 0. {
        m.jet.blasted = false;
        m.jet.lock = None;
        m.jet.at = None;
    }
    if m.jet.blasted && m.vy > 0. {
        streak(g, id);
    }
}
/// A flight stepped at 20 a second for up to 6 s until it meets the ground or a mech's top.
fn flight(
    g: &Game,
    id: MechId,
    mut x: f32,
    mut y: f32,
    mut z: f32,
    vx: f32,
    mut vy: f32,
    vz: f32,
) -> Option<(V3, f32, Option<MechId>)> {
    let (rm, h) = (g.mechs[id].radius(), 0.05);
    let mut t = h;
    while t < 6. {
        vy -= 18. * h;
        x += vx * h;
        y += vy * h;
        z += vz * h;
        if vy < 0. {
            for (i, o) in g.mechs.iter().enumerate() {
                if i == id || !o.alive || y > o.top() + 0.5 || y <= o.top() - 2. {
                    continue;
                }
                let v = ground_vel(o);
                if hypot2(o.x + v[0] * t - x, o.z + v[1] * t - z) < (rm + o.radius()) * 1.2 {
                    return Some((v3(x, o.top(), z), t, Some(i)));
                }
            }
        }
        let gy = g.ter.height(x, z);
        if y <= gy {
            return Some((v3(x, gy, z), t, None));
        }
        t += h;
    }
    None
}
/// In the air after a blast: the movement controls push the flight a little, and a lock pulls it on.
pub fn air_steer(g: &mut Game, id: MechId, along: f32, across: f32, dt: f32) {
    let m = &g.mechs[id];
    let Some(t) = jets_def(m.jets) else { return };
    if !m.jet.blasted || !m.air {
        return;
    }
    let (fx, fz) = (m.yaw.sin(), m.yaw.cos());
    let (sx, sz) = (fx * along + fz * across, fz * along - fx * across);
    let m = &mut g.mechs[id];
    if along != 0. || across != 0. {
        let base = *m.jet.base.get_or_insert(hypot2(m.jet.fly[0], m.jet.fly[1]));
        m.jet.fly[0] += sx * t.steer * dt;
        m.jet.fly[1] += sz * t.steer * dt;
        let (cap, sp) = (base + JETS_STEER_OVER, hypot2(m.jet.fly[0], m.jet.fly[1]));
        if sp > cap {
            m.jet.fly[0] *= cap / sp;
            m.jet.fly[1] *= cap / sp;
        }
    }
    let m = &g.mechs[id];
    let v = ground_vel(m);
    let land = flight(g, id, m.x, m.y, m.z, v[0], m.vy, v[1]);
    let m = &mut g.mechs[id];
    m.jet.at = land.map(|l| l.0);
    m.jet.at_mech = land.and_then(|l| l.2);
    let Some(o) = m.jet.lock else { return };
    let Some((at, tt, _)) = land else {
        m.jet.lock = None;
        return;
    };
    let (ox, oz, oalive, ov) = {
        let om = &g.mechs[o];
        (om.x, om.z, om.alive, ground_vel(om))
    };
    let m = &mut g.mechs[id];
    if !oalive {
        m.jet.lock = None;
        return;
    }
    m.jet.away = if (along != 0. || across != 0.) && sx * (ox - m.x) + sz * (oz - m.z) < 0. {
        m.jet.away + dt
    } else {
        0.
    };
    let (mx, mz) = (ox + ov[0] * tt - at.x, oz + ov[1] * tt - at.z);
    let miss = hypot2(mx, mz);
    if m.jet.away >= t.let_go || miss > JETS_ESCAPE {
        m.jet.lock = None;
        return;
    }
    if miss < 0.05 || tt < 0.1 {
        return;
    }
    let k = (miss / tt)
        .min(t.assist * dt)
        .min(t.assist_max - m.jet.used);
    if k > 0. {
        m.jet.fly[0] += mx / miss * k;
        m.jet.fly[1] += mz / miss * k;
        m.jet.used += k;
    }
}
/// While charging on the ground: the foe this charge would blast at, and where it would land.
pub fn jet_lock(g: &mut Game, id: MechId) {
    let m = &g.mechs[id];
    let Some(t) = jets_def(m.jets) else { return };
    if m.jet.blasted {
        return;
    }
    let was = m.jet.on;
    {
        let m = &mut g.mechs[id];
        m.jet.lock = None;
        m.jet.on = false;
        m.jet.at = None;
    }
    let m = &g.mechs[id];
    if !(m.jet.charge > 0.) || m.air || !m.alive {
        return;
    }
    let cone = JETS_CONE.cos();
    let mut lock = None;
    let mut best = cone;
    for (i, o) in g.mechs.iter().enumerate() {
        if i == id || !o.alive || o.team == m.team || hypot2(o.x - m.x, o.z - m.z) > t.reach {
            continue;
        }
        let d = (center_of(o) - g.eye).norm().dot(g.view);
        if Some(i) == g.target && d > cone {
            lock = Some(i);
            break;
        }
        if d > best {
            best = d;
            lock = Some(i);
        }
    }
    if lock.is_some() {
        g.target = lock;
    }
    let m = &g.mechs[id];
    let (vy, w, back) = (vy_of(t, m.jet.charge), walk_vel(m), m.throttle < 0.);
    let along = t.fwd * m.jet.charge.max(t.tap) * m.throttle;
    let fly = match (lock, back) {
        (Some(l), false) => aim_blast(m, &g.mechs[l], vy, t),
        _ => [m.yaw.sin() * along, m.yaw.cos() * along],
    };
    let land = flight(g, id, m.x, m.y + 0.5, m.z, w[0] + fly[0], vy, w[1] + fly[1]);
    let m = &mut g.mechs[id];
    m.jet.lock = lock;
    m.jet.at = land.map(|l| l.0);
    m.jet.at_mech = land.and_then(|l| l.2);
    m.jet.on = lock.is_some() && !back && land.is_some_and(|l| l.2 == lock);
    if m.jet.on && !was && id == PLAYER {
        g.sfx(Sfx::Lock, None);
    }
}
