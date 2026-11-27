//! One frame of the whole simulation.
use crate::beams::{beam_tick, cool_armour};
use crate::combat::{step_bursts, step_dying, step_shots, step_wrecks};
use crate::data::names::Vo;
use crate::data::*;
use crate::effects::{step_debris, step_particles};
use crate::feel::step_bob;
use crate::fusion::{fusion_tick, update_pulses};
use crate::game::*;
use crate::geom::{center_of, eye_of, ray_hit};
use crate::jets::{air_steer, jet_lock};
use crate::math::*;
use crate::mech::step_mech;
use crate::melee::{melee_press, melee_target, melee_tick};
use crate::missiles::{cycle_target, fire_cat, missile_trigger, steer_volley};
use crate::state::blend_pal;
use crate::voice::voice;

/// Mechs don't walk through each other.
fn apart(g: &mut Game) {
    for i in 0..g.mechs.len() {
        for j in i + 1..g.mechs.len() {
            let (a, b) = (&g.mechs[i], &g.mechs[j]);
            if !a.alive || !b.alive {
                continue;
            }
            let (dx, dz) = (b.x - a.x, b.z - a.z);
            let (d, r) = (hypot2(dx, dz), a.radius() + b.radius());
            let over = a.y > b.top() - 0.5 || b.y > a.top() - 0.5; // one is clear above the other
            if d < r && d > 0.01 && !over {
                let gap = (r - d) * 0.5;
                let (ox, oz) = (dx / d * gap, dz / d * gap);
                g.mechs[i].x -= ox;
                g.mechs[i].z -= oz;
                g.mechs[j].x += ox;
                g.mechs[j].z += oz;
            }
        }
    }
}
/// ELIMINATE: the match is won when no enemy is left.
fn tick_objectives(g: &mut Game) {
    if g.state != State::Play || g.enemies_left() > 0 {
        return;
    }
    g.won = true;
    g.state = State::Over;
    g.end_t = 3.2;
    voice(g, Vo::Complete, None, true, 400.);
}
/// The player's controls into the mech.
fn drive(g: &mut Game, i: &Input, dt: f32) {
    let guiding = g.guide.is_some();
    let p = g.pm();
    if !p.alive || p.shutdown {
        p.jetting = false;
        return;
    }
    if i.thr != 0. {
        p.throttle = clamp(p.throttle + clamp(i.thr, -1., 1.) * dt * 0.9, -0.35, 1.);
    }
    if i.stop {
        p.throttle = 0.;
    }
    // Half the turn rate on one leg, and mid-swing.
    let both = p.hp[Sec::LL.i()] > 0. && p.hp[Sec::RL.i()] > 0.;
    let leg_rate =
        p.ch.turn * dt * if both { 1. } else { 0.5 } * if p.melee.is_some() { 0.5 } else { 1. };
    p.yaw += clamp(i.turn, -1., 1.) * leg_rate;
    if guiding {
        let gd = g.guide.as_mut().unwrap();
        gd.yaw += i.twist * 1.4 * dt + i.twist_by;
        gd.pitch = clamp(gd.pitch + i.pitch * dt + i.pitch_by, -1.3, 1.3);
    } else {
        p.twist = clamp(p.twist + i.twist * 1.6 * dt + i.twist_by, -1.9, 1.9);
        p.pitch = clamp(p.pitch + i.pitch * 0.9 * dt + i.pitch_by, -0.4, 0.45);
    }
    let p = g.pm();
    if i.twist != 0. || i.twist_by != 0. {
        p.centring = false;
    }
    if i.centre || p.centring {
        p.twist *= (1. - 6. * dt).max(0.);
        if p.centring && p.twist.abs() < 0.01 {
            p.twist = 0.;
            p.centring = false;
        }
    }
    p.jetting = i.jets;
    if p.air && p.jet.blasted {
        air_steer(g, PLAYER, clamp(i.thr, -1., 1.), clamp(i.turn, -1., 1.), dt);
    }
}
pub fn update(g: &mut Game, i: &Input, dt: f32) {
    g.time += dt;
    if let Some((a, b, secs)) = g.ramp {
        g.pal = blend_pal(&a, &b, (g.time / secs).min(1.)); // dusk into night
    }
    g.cbeams.clear();
    g.frame += 1;
    g.input = *i;
    drive(g, i, dt);

    let (eye, view) = {
        let p = g.p();
        (eye_of(p), dir_of(p.view_yaw(), p.pitch))
    };
    g.eye = eye;
    g.view = view;
    let hit = ray_hit(g, g.eye, g.view, 1100., Some(PLAYER));
    g.aim = hit.map_or(g.eye + g.view * 1100., |h| h.point);
    g.aim_mech = hit.and_then(|h| h.mech);
    if g.target.is_some_and(|t| !g.mechs[t].alive) {
        g.target = None;
    }
    g.lock = g.target.is_some_and(|t| {
        let c = center_of(&g.mechs[t]);
        (c - g.eye).len() < weapon(Wpn::Lrm).range && (c - g.eye).norm().dot(g.view) > 0.3f32.cos()
    });
    // A lock that means something: you carry missiles that can fly. The brackets snap to a diamond.
    let was = g.lock_on;
    g.lock_on = g.lock
        && g.p()
            .w
            .iter()
            .any(|w| w.def.cat == Cat::Missile && !w.dead && w.ammo > 0);
    if g.lock_on && !was && g.p().alive {
        g.sfx(Sfx::Lock, None);
    }
    if !g.paused {
        jet_lock(g, PLAYER);
    }
    if i.target && g.p().alive && !g.paused {
        cycle_target(g);
    }
    let live = g.p().alive && !g.paused;
    if live && i.punch {
        melee_press(g, PLAYER);
    }
    g.punch_ready = live && g.p().melee.is_none() && melee_target(g, PLAYER).is_some();
    let armed = live && g.p().melee.is_none(); // no guns during a swing or its recovery
    let guiding = g.guide.is_some();
    g.pm().beam_on = armed && i.energy && !guiding;
    fusion_tick(g, PLAYER, dt, armed && i.fusion && !guiding);
    if armed && i.energy && !guiding {
        fire_cat(g, Cat::Energy); // bolts; beams skip themselves
    }
    if armed && i.ballistic {
        fire_cat(g, Cat::Ballistic);
    }
    missile_trigger(g, armed && (i.missile || i.missile_tap));
    steer_volley(g, dt);

    for id in 0..g.mechs.len() {
        if g.mechs[id].team != 0 && g.mechs[id].alive {
            if g.mechs[id].ai.still {
                g.mechs[id].throttle = 0.;
                g.mechs[id].jetting = false;
            } else {
                crate::ai::think(g, id, dt);
            }
        }
        if g.mechs[id].alive {
            step_mech(g, id, dt);
            melee_tick(g, id, dt);
        }
        if g.mechs[id].alive && g.mechs[id].beam_on {
            let aim = if id == PLAYER {
                g.aim
            } else {
                g.mechs[id].ai.beam_aim
            };
            beam_tick(g, id, dt, aim);
        } else {
            g.mechs[id].beaming = false;
        }
        if id != PLAYER {
            g.mechs[id].beam_on = false;
        }
    }
    cool_armour(g, dt);
    apart(g);
    tick_objectives(g);
    step_bursts(g, dt);
    step_shots(g, dt);
    step_dying(g, dt);
    update_pulses(g, dt);
    step_particles(g, dt);
    step_debris(g, dt);
    step_wrecks(g, dt);
    g.msgs.retain_mut(|m| {
        m.t -= dt;
        m.t > 0.
    });
    let rm = g.reduced_motion;
    g.flash = (g.flash - dt * if rm { 2.4 } else { 1.2 }).max(0.);
    g.shake = (g.shake - dt * 2.2).max(0.);
    g.kick = (g.kick - dt * 5.).max(0.);
    step_bob(g, dt);
    g.white_flash = (g.white_flash - dt * if rm { 3.2 } else { 1.6 }).max(0.);
    g.hit_mark = (g.hit_mark - dt).max(0.);
    g.hit_stop = (g.hit_stop - dt).max(0.);
    let tw = g.p().twist;
    g.twist_rate = (tw - g.last_twist).abs() / dt.max(1e-3);
    g.last_twist = tw;
    if g.state == State::Over {
        g.end_t -= dt;
        if g.end_t <= 0. {
            g.state = State::Debrief;
        }
    }
}
