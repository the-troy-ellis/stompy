//! One mech, one frame: speed and the slope, the push, jets, gravity, the
//! landing, heat and the 100/45 shutdown, cooldowns, the springs, the legs.
use crate::data::names::{Vo, WARN_HEAT};
use crate::data::*;
use crate::effects::{dust_col, particle};
use crate::feel::{feel, step_feel};
use crate::game::*;
use crate::math::*;
use crate::voice::voice;
use crate::{gait, jets, melee};

/// How fast a push dies out, per second: an impulse of v m/s moves a mech about v / 2.5 metres.
pub const PUSH_DECAY: f32 = 2.5;

/// A grade (rise over run) as a speed factor: uphill slow, downhill a touch quick.
pub fn grade_factor(grade: f32) -> f32 {
    clamp(
        if grade > 0. {
            1. - grade * SLOPE_UP
        } else {
            1. - grade * SLOPE_DOWN
        },
        SLOPE_MIN,
        SLOPE_MAX,
    )
}
/// Four legs keep their grip: a crawler walks a hill at its flat speed.
pub fn grips(m: &Mech) -> bool {
    m.ch.legs == Legs::Quad
}
/// The grade under the mech along its heading, sampled two metres fore and aft.
pub fn slope_factor(g: &Game, m: &Mech) -> f32 {
    if grips(m) {
        return 1.;
    }
    let (fx, fz) = (m.yaw.sin(), m.yaw.cos());
    grade_factor(
        (g.ter.height(m.x + fx * 2., m.z + fz * 2.) - g.ter.height(m.x - fx * 2., m.z - fz * 2.))
            / 4.,
    )
}
fn landing_dust(g: &mut Game, id: MechId, ground: f32, force: f32) {
    let (mx, mz, s) = (g.mechs[id].x, g.mechs[id].z, g.mechs[id].ch.scale);
    let col = dust_col(g, 0.85);
    for _ in 0..(4. * feel_row(Feel::Land).dust * force * s).round() as i32 {
        let r = &mut g.rng;
        let (p, v, life, size) = (
            v3(
                mx + r.range(-1.5, 1.5) * s,
                ground + 0.3,
                mz + r.range(-1.5, 1.5) * s,
            ),
            v3(r.range(-3., 3.), r.range(1., 3.), r.range(-3., 3.)),
            r.range(0.7, 1.2),
            r.range(0.6, 1.1) * s,
        );
        particle(g, p, v, life, size, col, PKind::Smoke, 0.);
    }
    if force > 0.7 {
        // A hard landing: a ring that races outward along the ground.
        let ring = (6. * feel_row(Feel::Land).dust * s).round() as i32;
        for i in 0..ring {
            let r = &mut g.rng;
            let a = (i as f32 / ring as f32) * TAU + r.range(-0.1, 0.1);
            let v = r.range(9., 14.) * force;
            let (vy, life, size) = (r.range(0.5, 1.5), r.range(0.5, 0.9), r.range(0.8, 1.4) * s);
            particle(
                g,
                v3(mx + a.sin() * 1.2 * s, ground + 0.2, mz + a.cos() * 1.2 * s),
                v3(a.sin() * v, vy, a.cos() * v),
                life,
                size,
                col,
                PKind::Smoke,
                0.,
            );
        }
    }
}
pub fn step_mech(g: &mut Game, id: MechId, dt: f32) {
    let slope = if g.mechs[id].air {
        1.
    } else {
        slope_factor(g, &g.mechs[id])
    };
    let (bx, bz) = (g.ter.bx, g.ter.bz);
    let m = &mut g.mechs[id];
    let legs = (if m.hp[Sec::LL.i()] > 0. { 0.5 } else { 0. })
        + (if m.hp[Sec::RL.i()] > 0. { 0.5 } else { 0. });
    let mut max_s = m.max_speed
        * if legs >= 1. {
            1.
        } else if legs > 0. {
            0.45
        } else {
            0.
        }; // no legs: sat down, a turret
    if m.heat > 85. {
        max_s *= 0.65;
    }
    max_s *= slope;
    if m.dig > 0. {
        // A landing holds the legs for a moment while the feet dig in.
        m.dig = (m.dig - dt).max(0.);
        max_s *= DIG_SLOW;
    }
    let target = if !m.alive || m.shutdown {
        0.
    } else {
        m.throttle * max_s
    };
    m.speed += clamp(target - m.speed, -11. * dt, 7. * dt); // mechs speed up slowly
    let fly = if m.air && m.jet.blasted {
        m.jet.fly
    } else {
        [0., 0.]
    };
    let x0 = m.x;
    let z0 = m.z;
    m.x = clamp(
        m.x + (m.yaw.sin() * m.speed + m.push[0] + fly[0]) * dt,
        -bx,
        bx,
    );
    m.z = clamp(
        m.z + (m.yaw.cos() * m.speed + m.push[1] + fly[1]) * dt,
        -bz,
        bz,
    );
    m.slide = if dt > 0. {
        sign(m.speed) * hypot2(m.x - x0, m.z - z0) / dt
    } else {
        m.speed
    };
    let keep = (1. - PUSH_DECAY * dt).max(0.);
    m.push[0] *= keep;
    m.push[1] *= keep;
    let skid = hypot2(m.push[0], m.push[1]);
    let (alive, air, push, scale) = (m.alive, m.air, m.push, m.ch.scale);
    if skid > 2. && alive && !air && g.rng.chance(dt * KNOCK_SKID_DUST * (skid / 10.).min(1.)) {
        // Skidding: dust streaks behind the feet while the push is strong.
        let col = dust_col(g, 0.8);
        let m = &g.mechs[id];
        let r = &mut g.rng;
        let p = v3(
            m.x - push[0] / skid * 1.5 * scale + r.range(-1., 1.),
            m.y + 0.3,
            m.z - push[1] / skid * 1.5 * scale + r.range(-1., 1.),
        );
        let (v, life, size) = (
            v3(
                -push[0] * 0.3 + r.range(-1., 1.),
                r.range(1., 2.5),
                -push[1] * 0.3 + r.range(-1., 1.),
            ),
            r.range(0.5, 0.9),
            r.range(0.6, 1.1) * scale,
        );
        particle(g, p, v, life, size, col, PKind::Smoke, 0.);
    }
    let ground = {
        let m = &g.mechs[id];
        g.ter.height(m.x, m.z)
    };
    jets::step_jets(g, id, dt);
    let m = &mut g.mechs[id];
    m.vy -= 18. * dt;
    m.y += m.vy * dt;
    if m.air {
        m.air_t += dt;
        let air_t = m.air_t;
        if g.mechs[id].vy < 0. && melee::try_stomp(g, id, air_t).is_some() {
            g.mechs[id].air_t = 0.; // coming down onto a mech: a stomp, and a bounce back up off it
        }
    }
    let m = &g.mechs[id];
    if m.vy <= 0. && m.y - ground < 1.2 {
        if m.air {
            let force = clamp(-m.vy / 20., 0.25, 1.);
            let at = m.pos();
            g.mechs[id].air_t = 0.;
            feel(
                g,
                Feel::Land,
                Some(id),
                force,
                0.,
                None,
                if id == PLAYER { None } else { Some(at) },
            );
            if id == PLAYER {
                g.sfx(Sfx::Land(force), None);
            } else {
                g.sfx(
                    Sfx::Step {
                        vol: force * 0.8,
                        scale,
                    },
                    Some(at),
                );
            }
            landing_dust(g, id, ground, force);
            let m = &mut g.mechs[id];
            m.speed *= 1. - DIG_CUT * force; // the landing digs the feet in
            m.dig = DIG_HOLD * force;
        }
        let m = &mut g.mechs[id];
        m.y = ground;
        m.vy = 0.;
        m.air = false;
    } else if m.y > ground + 1.2 {
        g.mechs[id].air = true;
    }
    let m = &mut g.mechs[id];
    if m.y < ground {
        m.y = ground;
        m.vy = m.vy.max(0.);
    }
    finish_step(g, id, dt);
}
/// Heat, shutdown, cooldowns, springs and legs: the second half of a step.
fn finish_step(g: &mut Game, id: MechId, dt: f32) {
    let m = &mut g.mechs[id];
    m.heat = (m.heat - if m.shutdown { 20. } else { m.sink_rate } * dt).max(0.);
    let at = m.pos();
    let at = if id == PLAYER { None } else { Some(at) };
    if !m.shutdown && m.heat >= 100. {
        // Heat 100 shuts the reactor down.
        m.shutdown = true;
        feel(g, Feel::Shutdown, Some(id), 1., 0., None, at);
        if id == PLAYER {
            g.sfx(Sfx::Powerdown, None);
            voice(g, Vo::Shutdown, None, true, 0.);
        }
    } else if m.shutdown && m.heat < 45. {
        // 45 restarts it.
        m.shutdown = false;
        feel(g, Feel::Restart, Some(id), 1., 0., None, at);
        if id == PLAYER {
            g.sfx(Sfx::Powerup, None);
            voice(g, Vo::Online, None, true, 0.);
        }
    }
    let m = &mut g.mechs[id];
    if id == PLAYER && m.heat > 80. && !m.shutdown {
        g.say(WARN_HEAT, false, 0.);
    }
    let m = &mut g.mechs[id];
    for w in &mut m.w {
        w.cd = (w.cd - dt).max(0.);
    }
    m.scramble = (m.scramble - dt).max(0.);
    step_feel(m, dt);
    gait::gait(g, id, dt);
}
