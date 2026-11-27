//! Damage by section, losing limbs, the death in beats, wrecks, and firing
//! shells and volleys.
use crate::data::names::{chassis_name, section_name, Vo, WARN_DAMAGE};
use crate::data::*;
use crate::effects::{explode, hit_sparks, msg, particle, scorch, shed_part};
use crate::feel::feel;
use crate::game::*;
use crate::geom::{center_of, muzzle_of, ray_hit, section_hit, torso_frame};
use crate::math::*;
use crate::melee::knock;
use crate::missiles::{blast, end_guide};
use crate::voice::voice;

pub const DEATH_BEAT: f32 = 0.25;
pub const DEATH_BUCKLE: f32 = 0.3;
pub const DEATH_TOPPLE: f32 = 0.8;
pub const WRECK_SETTLE: f32 = 1.;
pub const WRECK_POPS: f32 = 3.;
pub const WRECK_BURN: f32 = 30.;
const BUCKLE_DROP: f32 = 0.4;
/// Beam damage after this long without any is a new contact: it clangs once.
pub const BEAM_CONTACT_GAP: f32 = 0.6;

fn alert(g: &mut Game, e: MechId, src: Option<MechId>) {
    let t = g.time;
    let belief = src.filter(|&s| s != e).map(|s| g.mechs[s].pos());
    let a = &mut g.mechs[e].ai;
    a.aware = true;
    a.hit_at = Some(t);
    if let Some(p) = belief {
        a.belief = Some((p, [0., 0.], t)); // being hit is a contact; the shooter's spot is the belief
    }
}
/// What a round does beyond its damage: a bolt scrambles and rattles; anything with `knock` shoves.
pub fn on_shot_hit(g: &mut Game, s: &Shot, t: MechId, p: V3) {
    let d = weapon(s.wpn);
    if !g.mechs[t].alive && g.mechs[t].dying.is_none() {
        return;
    }
    if d.scramble > 0. {
        let m = &mut g.mechs[t];
        m.scramble = m.scramble.max(d.scramble);
        let a = m.view_yaw();
        let side = -sign((p.x - m.x) * a.cos() - (p.z - m.z) * a.sin());
        feel(
            g,
            Feel::Bolt,
            Some(t),
            1.,
            if side == 0. { 1. } else { side },
            None,
            if t == PLAYER { None } else { Some(p) },
        );
    }
    if d.knock > 0. && g.mechs[t].alive {
        let h = hypot2(s.v.x, s.v.z).max(1e-6);
        knock(g, t, Some(s.owner), d.knock, [s.v.x / h, s.v.z / h], false);
    }
}
/// The part comes off: an arm as one piece from the shoulder, a leg as thigh, shin and foot.
fn shed_section(g: &mut Game, id: MechId, sec: Sec, p: V3) {
    let m = &g.mechs[id];
    let away = v3(m.x - p.x, 0.4, m.z - p.z).norm();
    let mut pieces: Vec<(Part, V3)> = vec![];
    if sec.is_arm() {
        let at = torso_frame(m).apply(v3(
            if sec == Sec::LA { 1. } else { -1. } * m.geo.arm_x,
            m.geo.arm_y,
            0.,
        ));
        pieces.push((Part::Arm, at));
    } else {
        for i in 0..m.geo.n_legs {
            if (m.geo.legs()[i].hx > 0.) != (sec == Sec::LL) {
                continue;
            }
            let hip = v3(m.x, m.y + m.geo.hip * m.ch.scale, m.z);
            let f = m.feet[i].pos;
            pieces.extend([
                (Part::ULeg, hip.mix(f, 0.3)),
                (Part::LLeg, hip.mix(f, 0.7)),
                (Part::Foot, f),
            ]);
        }
    }
    for (part, at) in pieces {
        let r = &mut g.rng;
        let fling =
            away * -r.range(3., 7.) + v3(r.range(-2., 2.), r.range(4., 8.), r.range(-2., 2.));
        shed_part(g, id, part, at, fling);
    }
}
/// An arm or a leg at zero: its weapons die, it comes off, and the body reels.
pub fn lose_section(g: &mut Game, id: MechId, sec: Sec, p: V3, src: Option<MechId>) {
    let m = &mut g.mechs[id];
    m.hp[sec.i()] = 0.;
    for w in &mut m.w {
        if w.mount == sec {
            w.dead = true;
        }
    }
    shed_section(g, id, sec, p);
    let roll = match sec {
        Sec::LA | Sec::LL => -1.,
        Sec::RA | Sec::RL => 1.,
        Sec::T => 0.,
    };
    feel(
        g,
        Feel::SectionLost,
        Some(id),
        1.,
        roll,
        None,
        if id == PLAYER { None } else { Some(p) },
    );
    explode(g, p, false);
    if id == PLAYER {
        let m = &g.mechs[id];
        if sec.is_leg() && m.hp[Sec::LL.i()] <= 0. && m.hp[Sec::RL.i()] <= 0. {
            voice(g, Vo::LegsLost, None, true, 0.);
        } else {
            voice(
                g,
                if sec.is_leg() {
                    Vo::LegLost
                } else {
                    Vo::ArmLost
                },
                Some(format!("{} destroyed.", section_name(sec))),
                true,
                0.,
            );
        }
    } else if src == Some(PLAYER) {
        let text = format!(
            "{}: {} DESTROYED",
            chassis_name(g.mechs[id].key()),
            section_name(sec).to_uppercase()
        );
        msg(g, text, false);
    }
}
/// The stages of a kill start: a beat of silence but a rising whine.
fn begin_death(g: &mut Game, id: MechId) {
    let fall_yaw =
        g.mechs[id].yaw + if g.rng.chance(0.5) { 0. } else { PI } + g.rng.range(-0.7, 0.7);
    let roll = g.rng.range(-0.6, 0.6);
    let m = &mut g.mechs[id];
    m.alive = false;
    m.dying = Some(Dying {
        fall_yaw,
        roll,
        ..Dying::default()
    });
    let c = center_of(m);
    g.sfx_by(id, Sfx::Whine, c);
    if g.target == Some(id) {
        g.target = None;
    }
}
pub fn destroy(g: &mut Game, id: MechId, src: Option<MechId>) {
    if id == PLAYER {
        end_guide(g, true);
        g.m_down = false;
    }
    begin_death(g, id);
    if id == PLAYER {
        let foe_shutdown = g.mechs.iter().any(|e| e.team != 0 && e.alive && e.shutdown);
        g.death = DeathInfo {
            melee: g.mechs[id].last_hit,
            shutdown: g.mechs[id].shutdown,
            foe_shutdown,
        };
        g.state = State::Over;
        g.end_t = 3.2;
        g.won = false;
        msg(g, "MECH DESTROYED", true);
        return;
    }
    let how = g.mechs[id].last_hit;
    if src == Some(PLAYER) {
        g.stats.kills += 1;
        g.last_kill = Some(how);
    }
    let key = match how {
        Some(HitBy::Stomp) => Vo::KillStomp,
        Some(HitBy::Punch) => Vo::KillPunch,
        None => Vo::Kill,
    };
    voice(g, key, None, true, DEATH_BEAT * 1000.); // after the bang, not before
}
/// A hit on a mech: routed to the section it lands on, overflowing a lost limb into the torso.
/// `beam`: one frame's slice of a beam (it doesn't spark or jolt); `melee`: a punch or a stomp.
pub fn damage(
    g: &mut Game,
    id: MechId,
    p: V3,
    amt: f32,
    src: Option<MechId>,
    beam: bool,
    melee: bool,
) {
    if !g.mechs[id].alive {
        return;
    }
    if !melee {
        g.mechs[id].last_hit = None;
    }
    let mut sec = section_hit(&g.mechs[id], p);
    if g.mechs[id].hp[sec.i()] <= 0. {
        sec = Sec::T;
    }
    g.mechs[id].hp[sec.i()] -= amt;
    if !beam {
        hit_sparks(g, id, p, sec, amt);
    }
    if src == Some(PLAYER) && id != PLAYER {
        if !beam {
            g.stats.hits += 1.;
            g.hit_stop = HIT_STOP;
        }
        g.stats.dealt += amt;
        g.hit_mark = 0.25;
    }
    let m = &g.mechs[id];
    let a = m.view_yaw();
    let side = -sign((p.x - m.x) * a.cos() - (p.z - m.z) * a.sin());
    if !beam {
        // Beams don't jolt: the renderer sways a melting mech instead.
        feel(
            g,
            Feel::Hit,
            Some(id),
            amt / 10. * HIT_BY_SECTION[sec.i()],
            side,
            None,
            if id == PLAYER { None } else { Some(p) },
        );
    }
    if id == PLAYER {
        g.stats.taken += amt;
        // Arms ring, legs thud, the torso is dull. Under beams, one clang on contact, then the sizzle.
        if !beam || !g.beam_on_at.is_some_and(|t| g.time - t < BEAM_CONTACT_GAP) {
            g.sfx(Sfx::Clang(sec), None);
        }
        if beam {
            g.beam_on_at = Some(g.time);
        }
        if g.target.is_none() {
            g.target = src.filter(|&s| g.mechs[s].alive);
        }
    } else if g.mechs[id].team != 0 {
        alert(g, id, src);
    }
    let hp = g.mechs[id].hp[sec.i()];
    if hp > 0. {
        let m = &g.mechs[id];
        if id == PLAYER && sec == Sec::T && m.hp[Sec::T.i()] < m.max[Sec::T.i()] * 0.3 {
            g.say(WARN_DAMAGE, false, 0.);
        }
        return;
    }
    let over = -hp;
    g.mechs[id].hp[sec.i()] = 0.;
    if sec == Sec::T {
        destroy(g, id, src);
        return;
    }
    lose_section(g, id, sec, p, src);
    if over > 0. {
        let m = &mut g.mechs[id];
        m.hp[Sec::T.i()] -= over;
        if m.hp[Sec::T.i()] <= 0. {
            m.hp[Sec::T.i()] = 0.;
            destroy(g, id, src);
        }
    }
}
fn make_wreck(g: &mut Game, id: MechId, roll: f32) {
    if g.wrecks.len() >= MAX_WRECKS {
        g.wrecks.remove(0);
    }
    let m = &g.mechs[id];
    let ammo = m.w.iter().any(|w| w.def.ammo > 0 && w.ammo > 0 && !w.dead);
    let (x, y, z, yaw, ch, scale) = (m.x, m.y, m.z, m.yaw, m.key(), m.ch.scale);
    let n = 2 + g.rng.int(3);
    let mut pops: Vec<f32> = (0..n).map(|_| g.rng.range(0.3, WRECK_POPS)).collect();
    pops.sort_by(f32::total_cmp);
    let big_pop = if ammo {
        Some(g.rng.range(1., 2.))
    } else {
        None
    };
    g.wrecks.push(Wreck {
        x,
        y,
        z,
        yaw,
        ch,
        scale,
        t: 0.,
        roll,
        pops,
        big_pop,
        settle: 0.,
    });
}
/// The death, in beats: a quarter-second freeze with a rising whine, the torso blows (arms and plates
/// fly), the legs buckle, the body topples about its feet, then it is a wreck that pops.
pub fn step_dying(g: &mut Game, dt: f32) {
    for id in 0..g.mechs.len() {
        let Some(mut d) = g.mechs[id].dying else {
            continue;
        };
        d.t += dt;
        if !d.exploded && d.t >= DEATH_BEAT {
            d.exploded = true;
            g.mechs[id].dying = Some(d);
            let c = center_of(&g.mechs[id]);
            explode(g, c, true);
            let off = v3(g.rng.range(-3., 3.), 2., g.rng.range(-3., 3.));
            explode(g, c + off, false);
            for sec in [Sec::LA, Sec::RA] {
                if g.mechs[id].hp[sec.i()] > 0. {
                    g.mechs[id].hp[sec.i()] = 0.;
                    let at = c + v3(g.rng.range(-1., 1.), 0., g.rng.range(-1., 1.));
                    shed_section(g, id, sec, at);
                }
            }
            for _ in 0..4 {
                let r = &mut g.rng;
                let (at, v) = (
                    c + v3(r.range(-1., 1.), r.range(-1., 1.), r.range(-1., 1.)),
                    v3(r.range(-8., 8.), r.range(4., 12.), r.range(-8., 8.)),
                );
                shed_part(g, id, Part::Plate, at, v);
            }
            if id == PLAYER {
                feel(g, Feel::Death, Some(id), 1., 0., None, None);
            }
        }
        if d.exploded {
            let m = &g.mechs[id];
            let b = ((d.t - DEATH_BEAT) / DEATH_BUCKLE).min(1.);
            d.buckle = b;
            d.drop = b * b * BUCKLE_DROP * m.geo.hip * m.ch.scale;
            let u = clamp((d.t - DEATH_BEAT - DEATH_BUCKLE) / DEATH_TOPPLE, 0., 1.);
            d.angle = b * 0.12 + u * u * (PI / 2. - 0.12) * 0.95; // a lean during the buckle, then it falls faster as it goes
            if u >= 1. {
                make_wreck(g, id, d.roll);
                let (x, y, z, s) = {
                    let m = &g.mechs[id];
                    (m.x, m.y, m.z, m.ch.scale)
                };
                scorch(g, x, z, 5. * s, y);
                g.sfx(Sfx::Boom { big: false }, Some(v3(x, y, z)));
                let m = &mut g.mechs[id];
                if id == PLAYER {
                    m.fallen = Some(d);
                }
                m.dying = None;
                m.gone = true;
                continue;
            }
        }
        g.mechs[id].dying = Some(d);
    }
}
pub fn step_wrecks(g: &mut Game, dt: f32) {
    for i in 0..g.wrecks.len() {
        g.wrecks[i].t += dt;
        let w = &mut g.wrecks[i];
        w.settle = (w.t / WRECK_SETTLE).min(1.);
        while !g.wrecks[i].pops.is_empty() && g.wrecks[i].t >= g.wrecks[i].pops[0] {
            g.wrecks[i].pops.remove(0);
            let w = &g.wrecks[i];
            let (x, y, z, s) = (w.x, w.y, w.z, w.scale);
            let r = &mut g.rng;
            let p = v3(
                x + r.range(-2., 2.) * s,
                y + r.range(1., 3.) * s,
                z + r.range(-2., 2.) * s,
            );
            explode(g, p, false);
            for _ in 0..4 {
                let r = &mut g.rng;
                let (v, life, size) = (
                    v3(r.range(-2., 2.), r.range(2., 5.), r.range(-2., 2.)),
                    r.range(1.5, 2.5),
                    r.range(1.2, 2.2) * s,
                );
                particle(g, p, v, life, size, [0.2, 0.19, 0.18], PKind::Smoke, 0.);
            }
        }
        let w = &g.wrecks[i];
        let (x, y, z, s, t) = (w.x, w.y, w.z, w.scale, w.t);
        if w.big_pop.is_some_and(|b| t >= b) {
            g.wrecks[i].big_pop = None; // the ammunition cooks off
            explode(g, v3(x, y + 2. * s, z), true);
        }
        if t < WRECK_BURN && g.rng.chance(dt * 5.) {
            let r = &mut g.rng;
            let (p, v, life, size) = (
                v3(x + r.range(-2., 2.), y + 2., z + r.range(-2., 2.)),
                v3(r.range(-0.5, 0.5), r.range(3., 5.), r.range(-0.5, 0.5)),
                r.range(2., 3.5),
                r.range(1., 2.2),
            );
            particle(g, p, v, life, size, [0.18, 0.17, 0.17], PKind::Smoke, 0.);
        }
    }
}

fn new_shot(g: &mut Game) -> bool {
    if g.shots.len() < MAX_SHOTS {
        return true;
    }
    // Past the cap, the oldest unguided one is dropped silently.
    match g.shots.iter().position(|s| !s.guided) {
        Some(i) => {
            g.shots.swap_remove(i);
            true
        }
        None => false,
    }
}
/// One shell out of the muzzle: a single shot, or one round of a burst.
fn round_out(g: &mut Game, id: MechId, wi: usize, mz: V3, mut dir: V3) {
    let w = g.mechs[id].w[wi];
    let d = w.def;
    if d.jitter > 0. {
        let r = &mut g.rng;
        dir = (dir
            + v3(
                r.range(-d.jitter, d.jitter),
                r.range(-d.jitter, d.jitter),
                r.range(-d.jitter, d.jitter),
            ))
        .norm();
    }
    if !new_shot(g) {
        return;
    }
    g.shots.push(Shot {
        kind: WKind::Shell,
        wpn: w.key,
        p: mz,
        v: dir * d.speed,
        owner: id,
        target: None,
        dmg: d.dmg,
        life: d.range / d.speed,
        smoke: 0.,
        age: 0.,
        vid: 0,
        guided: false,
    });
    for _ in 0..if d.burst_n > 0 { 2 } else { 5 } {
        let r = &mut g.rng;
        let v = dir * r.range(4., 12.) + v3(r.range(-2., 2.), r.range(-1., 2.), r.range(-2., 2.));
        particle(
            g,
            mz + dir * 1.5,
            v,
            0.15,
            0.6,
            [1., 0.8, 0.3],
            PKind::Fire,
            0.,
        );
    }
    let sfx = match d.sfx {
        WSfx::Bonker => Sfx::Bonker,
        WSfx::Peashooter => Sfx::Peashooter,
        WSfx::Thunderclap => Sfx::Thunderclap,
        _ => Sfx::Cannon,
    };
    g.sfx(sfx, Some(mz));
    let frame = g.frame;
    g.mechs[id].flash = Flash {
        frame,
        p: mz,
        dir,
        big: d.burst_n == 0,
    };
    // The recoil's rock shows on whoever fires it; the camera only on the player.
    if id == PLAYER || d.recoil > 0. {
        let ev = if d.bolt {
            Feel::FireBolt
        } else if d.recoil > 0. {
            Feel::FireGauss
        } else if d.burst_n > 0 {
            Feel::FireMg
        } else {
            Feel::FireAc
        };
        feel(
            g,
            ev,
            Some(id),
            1.,
            0.,
            Some([-dir.x, -dir.z]),
            if id == PLAYER { None } else { Some(mz) },
        );
    }
    if d.recoil > 0. {
        let h = hypot2(dir.x, dir.z).max(1e-6);
        let m = &mut g.mechs[id];
        m.push[0] -= dir.x / h * d.recoil; // rocks the shooter back a step, whoever it is
        m.push[1] -= dir.z / h * d.recoil;
    }
}
/// A missile volley from `mz` along `dir`, homing on `target` unless the weapon doesn't.
pub fn volley(
    g: &mut Game,
    owner: MechId,
    wpn: Wpn,
    mz: V3,
    dir: V3,
    target: Option<MechId>,
) -> u32 {
    let d = weapon(wpn);
    g.volley_seq += 1;
    let vid = g.volley_seq;
    for _ in 0..d.count {
        let (sp, lift) = (d.spread.unwrap_or(0.08), d.lift.unwrap_or(0.12));
        let r = &mut g.rng;
        let spread = (dir + v3(r.range(-sp, sp), r.range(0., lift), r.range(-sp, sp))).norm();
        let p = mz + v3(r.range(-0.6, 0.6), r.range(-0.4, 0.4), r.range(-0.6, 0.6));
        let v = spread * (d.speed * r.range(0.85, 1.1));
        if !new_shot(g) {
            break;
        }
        g.shots.push(Shot {
            kind: WKind::Missile,
            wpn,
            p,
            v,
            owner,
            target: if d.homing { target } else { None },
            dmg: d.dmg,
            life: d.range / d.speed + 1.,
            smoke: 0.,
            age: 0.,
            vid,
            guided: false,
        });
    }
    vid
}
/// Fire one weapon at `aim`, if it can. Beams and the fusion cannon are continuous, elsewhere.
pub fn fire(g: &mut Game, id: MechId, wi: usize, aim: V3, target: Option<MechId>) -> bool {
    let m = &g.mechs[id];
    let w = m.w[wi];
    let d = w.def;
    if matches!(d.kind, WKind::Beam | WKind::Fusion)
        || !m.alive
        || m.shutdown
        || w.dead
        || w.cd > 0.
        || (d.ammo > 0 && w.ammo <= 0)
    {
        return false;
    }
    let mz = muzzle_of(m, &w);
    let dir = (aim - mz).norm();
    let m = &mut g.mechs[id];
    m.w[wi].cd = d.cd;
    m.heat += d.heat;
    if d.ammo > 0 {
        m.w[wi].ammo -= 1;
    }
    if id == PLAYER {
        g.stats.shots += if d.count > 0 { d.count as f32 } else { 1. };
    }
    if d.kind == WKind::Shell {
        round_out(g, id, wi, mz, dir);
        if d.burst_n > 0 {
            let w = &mut g.mechs[id].w[wi];
            w.burst_left = d.burst_n - 1;
            w.burst_t = d.burst_dt;
            w.burst_aim = aim;
        }
    } else {
        let vid = volley(g, id, w.key, mz, dir, target);
        let frame = g.frame;
        g.mechs[id].flash = Flash {
            frame,
            p: mz,
            dir,
            big: false,
        };
        if id == PLAYER {
            g.last_volley = vid;
            feel(
                g,
                Feel::FireLrm,
                Some(id),
                1.,
                0.,
                Some([-dir.x, -dir.z]),
                None,
            );
        }
        g.sfx(Sfx::Missile, Some(mz));
    }
    true
}
/// The rest of each burst, one round every `burst_dt`, at the point the trigger was pulled at.
pub fn step_bursts(g: &mut Game, dt: f32) {
    for id in 0..g.mechs.len() {
        for wi in 0..g.mechs[id].w.len() {
            if g.mechs[id].w[wi].burst_left == 0 {
                continue;
            }
            let m = &g.mechs[id];
            if !m.alive || m.shutdown || m.w[wi].dead {
                g.mechs[id].w[wi].burst_left = 0;
                continue;
            }
            g.mechs[id].w[wi].burst_t -= dt;
            while g.mechs[id].w[wi].burst_left > 0 && g.mechs[id].w[wi].burst_t <= 0. {
                let m = &g.mechs[id];
                let w = m.w[wi];
                let mz = muzzle_of(m, &w);
                round_out(g, id, wi, mz, (w.burst_aim - mz).norm());
                if id == PLAYER {
                    g.stats.shots += 1.;
                }
                let w = &mut g.mechs[id].w[wi];
                w.burst_left -= 1;
                w.burst_t += w.def.burst_dt;
            }
        }
    }
}
/// Shells and missiles, one frame: steer, fly, hit, splash.
pub fn step_shots(g: &mut Game, dt: f32) {
    for i in 0..g.shots.len() {
        let mut s = g.shots[i];
        s.life -= dt;
        if s.kind == WKind::Missile {
            if let (true, Some(gd)) = (s.guided, g.guide.filter(|gd| gd.vid == s.vid)) {
                let sp = s.v.len();
                s.v = (s.v.norm() + gd.dir * (dt * 7.)).norm() * sp; // flown by the pilot
            } else if let Some(t) = s.target.filter(|&t| g.mechs[t].alive) {
                let want = (center_of(&g.mechs[t]) - s.p).norm();
                let sp = s.v.len();
                s.v = (s.v.norm() + want * (dt * if s.owner == PLAYER { 1.7 } else { 0.9 })).norm()
                    * sp;
            }
            s.smoke += dt;
            s.age += dt;
            // No trail for the first moments: the racks sit beside the cockpit.
            if s.smoke > 0.05 && (s.age > 0.3 || s.owner != PLAYER) {
                s.smoke = 0.;
                let r = &mut g.rng;
                let v = v3(r.range(-0.5, 0.5), r.range(0., 1.), r.range(-0.5, 0.5));
                particle(g, s.p, v, 0.9, 0.5, [0.55, 0.53, 0.5], PKind::Smoke, 0.);
            }
        } else {
            s.v.y -= 6. * dt;
        }
        let (step, dir) = (s.v.len() * dt, s.v.norm());
        let hit = ray_hit(g, s.p, dir, step, Some(s.owner));
        if let Some(h) = hit {
            s.life = -1.;
            if let Some(t) = h.mech {
                damage(g, t, h.point, s.dmg, Some(s.owner), false, false);
                on_shot_hit(g, &s, t, h.point);
            }
            if s.kind == WKind::Missile {
                blast(g, h.point, s.dmg, s.owner, h.mech);
            }
            explode(g, h.point, false);
        } else {
            s.p += s.v * dt;
        }
        if s.life <= 0. && s.kind == WKind::Missile && hit.is_none() {
            blast(g, s.p, s.dmg, s.owner, None);
            explode(g, s.p, false);
        }
        g.shots[i] = s;
    }
    g.shots.retain(|s| s.life > 0.);
}
