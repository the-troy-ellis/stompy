//! Knockdown (docs/specs/06-knockdown.md): a wrecking ball puts a two-legged mech on the ground.
//! It falls the way it was pushed, slams down, and lies there disabled (no walking, turning,
//! aiming, punching or firing) until it is mashed back up: each press of A heaves it part of the
//! way, it sags back if the presses stop, and at the top it gets up and its feet plant afresh.
//! The AI mashes at a rate set by difficulty. SLOWPOKE, on four legs, is never knocked down.
use crate::data::*;
use crate::feel::feel;
use crate::gait::init_feet;
use crate::game::*;
use crate::geom::center_of;
use crate::math::*;

/// Whether this mech can be knocked down: two legs under it, on the ground, alive, not already.
pub fn can_fall(m: &Mech) -> bool {
    m.alive && !m.air && m.ch.legs != Legs::Quad && m.down.is_none() && m.dying.is_none()
}
/// Puts it down, falling along `dir` (a unit [x, z]).
pub fn knock_down(g: &mut Game, id: MechId, dir: [f32; 2]) {
    if !can_fall(&g.mechs[id]) {
        return;
    }
    let roll = g.rng.range(-0.4, 0.4);
    let m = &mut g.mechs[id];
    let fall_yaw = dir[0].atan2(dir[1]);
    // It goes over backward: the blow turns it to face where it came from as it falls.
    let yaw_to = m.yaw + wrap(fall_yaw + PI - m.yaw);
    m.down = Some(Down {
        pose: Dying {
            fall_yaw,
            roll,
            ..Dying::default()
        },
        yaw_to,
        ..Down::default()
    });
    m.throttle = 0.;
    m.jetting = false;
    m.beam_on = false;
    m.melee = None;
}
/// How far over it is, 0 standing to 1 flat out.
pub fn lie(m: &Mech) -> f32 {
    m.down.map_or(0., |d| d.pose.angle / DOWN_ANGLE)
}
/// A press of A while down: a heave up (only counted on the press, not the hold).
pub fn mash(g: &mut Game, id: MechId) {
    let Some(mut d) = g.mechs[id].down else {
        return;
    };
    if d.phase != DownPhase::Lying {
        return;
    }
    d.up = (d.up + 1. / MASH_PRESSES).min(1.);
    d.last_press = d.t;
    g.mechs[id].down = Some(d);
    let c = center_of(&g.mechs[id]);
    feel(
        g,
        Feel::Heave,
        Some(id),
        1.,
        0.,
        None,
        if id == PLAYER { None } else { Some(c) },
    );
    let s = g.mechs[id].ch.scale;
    g.sfx_by(id, Sfx::Step { vol: 0.5, scale: s }, c);
}
/// The player's A while down: a press (not the hold) is a heave.
pub fn mash_input(g: &mut Game, held: bool) {
    let Some(mut d) = g.p().down else {
        return;
    };
    let press = held && !d.held;
    d.held = held;
    g.pm().down = Some(d);
    if press {
        mash(g, PLAYER);
    }
}
pub fn down_tick(g: &mut Game, id: MechId, dt: f32) {
    let Some(mut d) = g.mechs[id].down else {
        return;
    };
    if !g.mechs[id].alive {
        g.mechs[id].down = None;
        return;
    }
    d.t += dt;
    let (hip, sc) = (g.mechs[id].geo.hip, g.mechs[id].ch.scale);
    match d.phase {
        DownPhase::Falling => {
            let u = (d.t / DOWN_FALL).min(1.);
            // Turned by the blow as it goes, to fall on its back; the torso swings round too.
            let m = &mut g.mechs[id];
            let k = (dt / (DOWN_FALL * (1. - u).max(0.15))).min(1.);
            m.yaw += wrap(d.yaw_to - m.yaw) * k;
            m.twist *= 1. - k;
            d.buckle = (u * 2.).min(1.);
            d.pose.angle = u * u * DOWN_ANGLE;
            d.pose.buckle = d.buckle;
            d.pose.drop = d.buckle * DOWN_DROP * hip * sc;
            // Thrown, it goes over in the air and the slam waits for the ground.
            if u >= 1. && !g.mechs[id].air {
                d.phase = DownPhase::Lying;
                g.mechs[id].down = Some(d);
                slam(g, id);
                return;
            }
        }
        DownPhase::Lying => {
            // The heaves sag back once the presses stop.
            if d.t - d.last_press > MASH_GRACE {
                d.up = (d.up - MASH_SAG * dt).max(0.);
            }
            let to = d.up * KNEEL_P;
            d.p += clamp(to - d.p, -GETUP_SAG * dt, GETUP_RATE * dt);
            d.pose.angle = DOWN_ANGLE * (1. - d.p);
            if d.up >= 1. {
                d.phase = DownPhase::Rising;
                d.rise = 0.;
            }
        }
        DownPhase::Rising => {
            d.rise += dt / DOWN_RISE;
            let v = smooth(d.rise.min(1.));
            d.p = KNEEL_P + (1. - KNEEL_P) * v;
            d.pose.angle = DOWN_ANGLE * (1. - d.p);
            d.pose.buckle = 1. - v;
            d.pose.drop = d.pose.buckle * DOWN_DROP * hip * sc;
            if d.rise >= 1. {
                stand(g, id);
                return;
            }
        }
    }
    g.mechs[id].down = Some(d);
}
/// The body hits the ground: the biggest thump a body makes, dust, a clang.
fn slam(g: &mut Game, id: MechId) {
    let m = &g.mechs[id];
    let (d, s) = (m.down.unwrap().pose, m.ch.scale);
    let at = v3(
        m.x + d.fall_yaw.sin() * 4. * s,
        m.y,
        m.z + d.fall_yaw.cos() * 4. * s,
    );
    feel(
        g,
        Feel::Knocked,
        Some(id),
        1.,
        d.roll.signum(),
        None,
        if id == PLAYER { None } else { Some(at) },
    );
    g.sfx_by(id, Sfx::Land(1.2), at);
    g.sfx_by(id, Sfx::Clang(Sec::T), at);
}
/// On its feet again: the feet plant where it stands, a heave and a thump, and a stumble: a shove
/// back that its legs step out of, a wobble, weak legs for a moment.
fn stand(g: &mut Game, id: MechId) {
    let side = if g.rng.chance(0.5) { 1. } else { -1. };
    let Game { ter, mechs, .. } = g;
    let m = &mut mechs[id];
    m.down = None;
    init_feet(ter, m);
    let (s, c, k) = (m.yaw.sin(), m.yaw.cos(), STUMBLE * m.ch.scale);
    m.push[0] -= s * k;
    m.push[1] -= c * k;
    m.stagger = STUMBLE_STAGGER;
    m.wob_p.kick(-1.2);
    m.wob_r.kick(side * 1.4);
    let c = center_of(&g.mechs[id]);
    feel(
        g,
        Feel::Up,
        Some(id),
        1.,
        0.,
        None,
        if id == PLAYER { None } else { Some(c) },
    );
    g.sfx_by(id, Sfx::Land(0.7), c);
}
