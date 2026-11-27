//! Missiles: tap to fire, hold to fly them from the nose camera, let go to
//! detonate. Blasts fall off with distance and shove.
use crate::combat::{damage, fire};
use crate::data::*;
use crate::effects::explode;
use crate::game::*;
use crate::geom::center_of;
use crate::math::*;
use crate::melee::knock;

/// Seconds the trigger is held before it takes the volley over.
pub const HOLD_TO_GUIDE: f32 = 0.22;
/// A near miss still hurts, within this many metres.
pub const BLAST_R: f32 = 10.;

/// Called every frame with whether the missile control is held. One volley per press.
pub fn missile_trigger(g: &mut Game, down: bool) {
    if down && !g.m_down {
        g.m_down = true;
        g.m_at = g.time;
        g.m_vid = if fire_cat(g, Cat::Missile) {
            g.last_volley
        } else {
            0
        };
    } else if down {
        if g.guide.is_none() && g.m_vid != 0 && g.time - g.m_at >= HOLD_TO_GUIDE {
            start_guide(g, g.m_vid);
        }
    } else if g.m_down {
        g.m_down = false;
        if g.guide.is_some() {
            end_guide(g, true);
        }
    }
}
fn guided_live(g: &Game, vid: u32) -> Vec<usize> {
    (0..g.shots.len())
        .filter(|&i| g.shots[i].vid == vid && g.shots[i].owner == PLAYER && g.shots[i].life > 0.)
        .collect()
}
fn centroid(g: &Game, l: &[usize]) -> V3 {
    l.iter().fold(V3::ZERO, |a, &i| a + g.shots[i].p) * (1. / l.len() as f32)
}
pub fn start_guide(g: &mut Game, vid: u32) {
    let ms = guided_live(g, vid);
    if ms.is_empty() {
        return;
    }
    let d = g.shots[ms[0]].v.norm();
    let pos = centroid(g, &ms);
    g.guide = Some(Guide {
        vid,
        yaw: d.x.atan2(d.z),
        pitch: clamp(d.y, -1., 1.).asin(),
        dir: d,
        pos,
        nose: pos,
        lost: 0.,
        fuel: 0.,
        n: ms.len(),
    });
    for i in ms {
        let s = &mut g.shots[i];
        s.guided = true;
        s.target = None;
        s.life = s.life.max(9.);
    }
    g.zoom = false;
    g.sfx(Sfx::Beep, None);
}
/// Each frame while flying: aim follows input, the camera rides the nose of the one in front.
pub fn steer_volley(g: &mut Game, dt: f32) {
    let Some(mut gd) = g.guide else { return };
    gd.dir = dir_of(gd.yaw, gd.pitch);
    let ms = guided_live(g, gd.vid);
    gd.n = ms.len();
    if !ms.is_empty() {
        gd.pos = centroid(g, &ms);
        gd.fuel = ms.iter().map(|&i| g.shots[i].life).fold(0., f32::max);
        let front = ms
            .iter()
            .copied()
            .max_by(|&a, &b| {
                (g.shots[a].p - gd.pos)
                    .dot(gd.dir)
                    .total_cmp(&(g.shots[b].p - gd.pos).dot(gd.dir))
            })
            .unwrap();
        gd.nose = g.shots[front].p;
    } else {
        gd.lost += dt;
        if gd.lost > 0.6 {
            end_guide(g, false); // all hit something: signal lost, then home
            return;
        }
    }
    g.guide = Some(gd);
}
/// Let go: every missile still flying blows up where it is. Then back to the cockpit.
pub fn end_guide(g: &mut Game, detonate: bool) {
    let Some(gd) = g.guide else { return };
    if detonate {
        for i in guided_live(g, gd.vid) {
            g.shots[i].life = -1.;
            let (p, dmg, owner) = (g.shots[i].p, g.shots[i].dmg, g.shots[i].owner);
            blast(g, p, dmg, owner, None);
            explode(g, p, false);
        }
    }
    g.guide = None;
}
/// Splash: anything within BLAST_R takes damage falling off with distance, on the side facing the
/// blast; not the mech it hit directly, never the mech that fired it. The blast shoves too.
pub fn blast(g: &mut Game, p: V3, dmg: f32, owner: MechId, direct: Option<MechId>) {
    for id in 0..g.mechs.len() {
        let m = &g.mechs[id];
        if !m.alive || id == owner || Some(id) == direct {
            continue;
        }
        let (r, top) = (m.radius(), m.top());
        let (hx, hz) = (p.x - m.x, p.z - m.z);
        let hd = hypot2(hx, hz);
        let dy = if p.y < m.y {
            m.y - p.y
        } else if p.y > top {
            p.y - top
        } else {
            0.
        };
        let d = hypot2((hd - r).max(0.), dy);
        if d >= BLAST_R {
            continue;
        }
        let (nx, nz) = if hd > 0.01 {
            (hx / hd, hz / hd)
        } else {
            (1., 0.)
        };
        let at = v3(m.x + nx * r, clamp(p.y, m.y + 1., top - 1.), m.z + nz * r);
        damage(
            g,
            id,
            at,
            dmg * 0.8 * (1. - d / BLAST_R),
            Some(owner),
            false,
            false,
        );
        if g.mechs[id].alive {
            knock(
                g,
                id,
                Some(owner),
                feel_row(Feel::Blast).push * (1. - d / BLAST_R),
                [-nx, -nz],
                false,
            );
        }
    }
}
/// Fire every weapon of one kind that's ready; held, each refires as it recharges.
pub fn fire_cat(g: &mut Game, cat: Cat) -> bool {
    let mut any = false;
    let (aim, target) = (g.aim, if g.lock { g.target } else { None });
    for wi in 0..g.p().w.len() {
        if g.p().w[wi].def.cat == cat {
            any |= fire(g, PLAYER, wi, aim, target);
        }
    }
    any
}
/// The next target, nearest first.
pub fn cycle_target(g: &mut Game) {
    let p = g.p().pos();
    let mut foes: Vec<MechId> = (0..g.mechs.len())
        .filter(|&i| g.mechs[i].alive && g.mechs[i].team != 0)
        .collect();
    if foes.is_empty() {
        return;
    }
    foes.sort_by(|&a, &b| {
        let d = |i: usize| hypot2(g.mechs[i].x - p.x, g.mechs[i].z - p.z);
        d(a).total_cmp(&d(b))
    });
    let at = g.target.and_then(|t| foes.iter().position(|&f| f == t));
    g.target = Some(foes[at.map_or(0, |i| (i + 1) % foes.len())]);
    g.sfx(Sfx::Beep, None);
}
pub fn lock_center(g: &Game, t: MechId) -> V3 {
    center_of(&g.mechs[t])
}
