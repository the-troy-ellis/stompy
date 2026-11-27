//! Thunk (docs/specs/01-thunk.md): the body springs every mech carries, the
//! camera's eased drop, and `feel`: one call per event, one row of the table.
use crate::data::*;
use crate::game::*;
use crate::math::*;
use crate::spring::Spring;

pub fn init_feel(m: &mut Mech) {
    m.push = [0., 0.];
    m.squash = Spring::new(SQUASH_K, SQUASH_ZETA);
    m.wob_p = Spring::new(WOBBLE_K, WOBBLE_ZETA);
    m.wob_r = Spring::new(WOBBLE_K, WOBBLE_ZETA);
    m.sag = Spring::new(SAG_K, SAG_ZETA);
    m.tilt_p = Spring::new(120., 1.);
    m.tilt_r = Spring::new(120., 1.);
    m.tilt_was = None;
}
/// Weight: the body tips about its feet against its own acceleration, back as it speeds up,
/// forward as it brakes, out of a turn. Seen, not simulated.
pub fn inertia_targets(m: &Mech, accel: f32, yaw_rate: f32) -> (f32, f32) {
    if m.air || !m.alive {
        return (0., 0.);
    }
    (
        clamp(-accel * INERTIA_PITCH, -INERTIA_MAX, INERTIA_MAX),
        clamp(m.speed * yaw_rate * INERTIA_ROLL, -INERTIA_MAX, INERTIA_MAX),
    )
}
fn step_tilt(m: &mut Mech, dt: f32) {
    let (sp, yw) = m.tilt_was.unwrap_or((m.speed, m.yaw));
    let accel = if dt > 0. { (m.speed - sp) / dt } else { 0. };
    let yaw_rate = if dt > 0. { wrap(m.yaw - yw) / dt } else { 0. };
    m.tilt_was = Some((m.speed, m.yaw));
    let (p, r) = inertia_targets(m, accel, yaw_rate);
    let k = INERTIA_K / (m.ch.scale * m.ch.scale);
    m.tilt_p.tune(k, INERTIA_ZETA);
    m.tilt_r.tune(k, INERTIA_ZETA);
    m.tilt_p.step(dt, p);
    m.tilt_r.step(dt, r);
}
pub fn step_feel(m: &mut Mech, dt: f32) {
    m.squash.step(dt, 0.);
    m.wob_p.step(dt, 0.);
    m.wob_r.step(dt, 0.);
    step_tilt(m, dt);
    let sag = if m.shutdown {
        feel_row(Feel::Shutdown).sag * m.ch.scale
    } else {
        0.
    };
    m.sag.step(dt, sag); // a reactor down slumps; a running one stands back up
}
/// The camera's eased drop: two critically damped springs in series.
pub fn step_bob(g: &mut Game, dt: f32) {
    g.bob_in.step(dt, 0.);
    let target = g.bob_in.x;
    g.bob.step(dt, target);
}
/// One event, one row of the table. `k` is the intensity; `who` is the mech it happened to (its body
/// springs react; the camera only when it's the player); `roll` leans the wobble toward a side;
/// `dir` is the unit [x, z] a push goes along; `at` places the thump (None: your own).
pub fn feel(
    g: &mut Game,
    ev: Feel,
    who: Option<MechId>,
    k: f32,
    roll: f32,
    dir: Option<[f32; 2]>,
    at: Option<V3>,
) {
    let row = feel_row(ev);
    if !(k > 0.) {
        return;
    }
    let mine = who.is_none_or(|w| w == PLAYER);
    let rm = if mine && g.reduced_motion {
        REDUCED_SCALE
    } else {
        1.
    };
    if mine {
        if row.kick > 0. {
            g.kick = g.kick.max(row.kick * k * rm);
        }
        if row.bob > 0. {
            g.bob_in.kick(row.bob * k * rm);
        }
        if row.shake > 0. {
            g.shake = (g.shake + row.shake * k * rm).min(VIEW_SHAKE_MAX);
        }
        if row.flash > 0. {
            g.flash = (g.flash + row.flash * k).min(VIEW_FLASH_MAX);
        }
        if row.white > 0. {
            g.white_flash = g.white_flash.max(row.white * k);
        }
    }
    if let Some(w) = who {
        let m = &mut g.mechs[w];
        if row.squash > 0. {
            m.squash.kick(row.squash * k * 8. * rm);
        }
        if row.wobble > 0. {
            m.wob_p.kick(row.wobble * k * (1. - 0.5 * roll.abs()));
            if roll != 0. {
                m.wob_r.kick(row.wobble * k * roll);
            }
        }
        if let (true, Some(d)) = (row.push > 0., dir) {
            m.push[0] += d[0] * row.push * k;
            m.push[1] += d[1] * row.push * k;
        }
        if row.overshoot > 0. {
            // The restart snaps the body up past standing height before it settles.
            let w = m.sag.k.sqrt();
            let v = -(w * m.sag.x.max(0.)
                + row.overshoot * m.ch.scale * w * std::f32::consts::E * 1.6)
                - m.sag.v;
            m.sag.kick(v);
        }
    }
    if row.bass > 0. || row.duck > 0. || row.haptic > 0. {
        let haptic = if mine && !g.reduced_motion {
            row.haptic * k
        } else {
            0.
        };
        g.events.push(Event::Thump {
            bass: row.bass * k,
            duck: row.duck * k,
            haptic,
            at,
        });
    }
}
