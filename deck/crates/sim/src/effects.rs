//! Messages, the particle pool, debris, hit sparks, explosions and scorches.
//! Effects are solid shapes (spec 14 in the reference): the renderer draws a
//! particle by its kind.
use crate::data::*;
use crate::feel::feel;
use crate::game::*;
use crate::math::*;

pub fn msg(g: &mut Game, text: impl Into<String>, warn: bool) {
    if g.msgs.len() >= MAX_MSGS {
        g.msgs.remove(0);
    }
    g.msgs.push(Msg {
        text: text.into(),
        t: 3.5,
        warn,
    });
}
/// One particle into the pool. Past the cap, the oldest (roughly) goes.
pub fn particle(
    g: &mut Game,
    p: V3,
    v: V3,
    life: f32,
    size: f32,
    col: [f32; 3],
    kind: PKind,
    grav: f32,
) {
    let np = Particle {
        p,
        v,
        life,
        life0: life,
        size,
        grav,
        col,
        kind,
    };
    if g.parts.len() < MAX_PARTS {
        g.parts.push(np);
    } else {
        let i = (0..g.parts.len())
            .step_by(7)
            .min_by(|&a, &b| g.parts[a].life.total_cmp(&g.parts[b].life))
            .unwrap_or(0);
        g.parts[i] = np;
    }
}
pub fn step_particles(g: &mut Game, dt: f32) {
    let ter = &g.ter;
    g.parts.retain_mut(|p| {
        p.life -= dt;
        if p.life <= 0. {
            return false;
        }
        match p.kind {
            PKind::Smoke | PKind::Dust => {
                p.v = p.v * (1. - 1.5 * dt).max(0.);
                p.v.y += 1.2 * dt;
                p.size += dt * if p.kind == PKind::Smoke { 1.1 } else { 0.6 };
            }
            PKind::Fire | PKind::Flame => {
                p.v = p.v * (1. - 2.5 * dt).max(0.);
                p.v.y += 2. * dt;
            }
            PKind::Spark | PKind::Debris => {
                p.v.y -= p.grav * dt;
                let gy = ter.height(p.p.x, p.p.z);
                if p.p.y < gy + 0.2 && p.v.y < 0. {
                    p.p.y = gy + 0.2;
                    p.v = v3(p.v.x * 0.4, -p.v.y * 0.3, p.v.z * 0.4);
                }
            }
            PKind::Shock => {}
        }
        p.p += p.v * dt;
        true
    });
}
/// A piece of a mech that fell off: it tumbles, bounces once, and lies there.
pub fn shed_part(g: &mut Game, who: MechId, part: Part, p: V3, v: V3) {
    if g.debris.len() >= MAX_DEBRIS {
        g.debris.remove(0);
    }
    let (ch, scale, yaw) = (g.mechs[who].key(), g.mechs[who].scale(), g.mechs[who].yaw);
    let r = &mut g.rng;
    let rot = v3(r.range(0., TAU), yaw, r.range(0., TAU));
    let spin = v3(r.range(-6., 6.), r.range(-3., 3.), r.range(-6., 6.));
    g.debris.push(Debris {
        part,
        ch,
        scale,
        p,
        v,
        rot,
        spin,
        landed: false,
        bounced: false,
        t: 0.,
        life: 20.,
    });
}
pub fn step_debris(g: &mut Game, dt: f32) {
    let ter = &g.ter;
    g.debris.retain_mut(|d| {
        d.t += dt;
        if !d.landed {
            d.v.y -= 18. * dt;
            d.p += d.v * dt;
            d.rot += d.spin * dt;
            let gy = ter.height(d.p.x, d.p.z) + 0.4 * d.scale;
            if d.p.y <= gy {
                d.p.y = gy;
                if !d.bounced && -d.v.y > 3. {
                    d.bounced = true;
                    d.v = v3(d.v.x * 0.5, -d.v.y * 0.3, d.v.z * 0.5);
                    d.spin = d.spin * 0.4;
                } else {
                    d.landed = true;
                    d.v = V3::ZERO;
                    d.spin = V3::ZERO;
                }
            }
        } else if d.t > d.life - 2. {
            d.p.y -= dt * 0.9 * d.scale; // sinks away over its last two seconds
        }
        d.t < d.life
    });
}
/// The ground's colour, darkened, lit by the time of day: dust and skid streaks.
pub fn dust_col(g: &Game, k: f32) -> [f32; 3] {
    let low = PALS[g.biome.i()].low;
    [
        low[0] * k * g.pal.shade[0],
        low[1] * k * g.pal.shade[1],
        low[2] * k * g.pal.shade[2],
    ]
}
pub const PLATE_DMG: f32 = 6.;
/// Section-specific hit effects: sparks fan off the armour away from the blow; a leg hit kicks dust
/// up at the feet; a torso hit leaves smoke; a big blow knocks a plate loose.
pub fn hit_sparks(g: &mut Game, who: MechId, p: V3, sec: Sec, amt: f32) {
    let (mx, my, mz, s) = {
        let m = &g.mechs[who];
        (m.x, m.y, m.z, m.ch.scale)
    };
    let k = clamp(amt / 10., 0.3, 2.);
    let mut n = (p - v3(mx, p.y, mz)).norm();
    if !(n.len() > 0.5) {
        n = v3(0., 0., 1.);
    }
    let sparks = ((if sec.is_leg() {
        4.
    } else if sec == Sec::T {
        6.
    } else {
        8.
    }) * k)
        .round() as i32;
    for _ in 0..sparks {
        let r = &mut g.rng;
        let (v, life, size, cg) = (
            n * r.range(4., 12.) + v3(r.range(-3., 3.), r.range(1., 6.), r.range(-3., 3.)),
            r.range(0.15, 0.4),
            r.range(0.2, 0.45),
            r.range(0.7, 0.95),
        );
        particle(g, p, v, life, size, [1., cg, 0.3], PKind::Spark, 20.);
    }
    let dust = dust_col(g, 0.8);
    if sec.is_leg() {
        for _ in 0..(4. * k).round() as i32 {
            let r = &mut g.rng;
            let (pp, v, life, size) = (
                v3(
                    mx + r.range(-1.5, 1.5) * s,
                    my + 0.3,
                    mz + r.range(-1.5, 1.5) * s,
                ),
                v3(r.range(-2., 2.), r.range(1., 3.), r.range(-2., 2.)),
                r.range(0.5, 0.9),
                r.range(0.6, 1.2) * s,
            );
            particle(g, pp, v, life, size, dust, PKind::Smoke, 0.);
        }
    }
    if sec == Sec::T {
        for _ in 0..(2. * k).round() as i32 {
            let r = &mut g.rng;
            let (v, life, size) = (
                n * 1.5 + v3(r.range(-0.5, 0.5), r.range(1.5, 3.), r.range(-0.5, 0.5)),
                r.range(1., 1.8),
                r.range(0.8, 1.4),
            );
            particle(
                g,
                p + n * 0.5,
                v,
                life,
                size,
                [0.25, 0.23, 0.22],
                PKind::Smoke,
                0.,
            );
        }
    }
    if amt >= PLATE_DMG {
        for _ in 0..if amt >= PLATE_DMG * 2. { 2 } else { 1 } {
            let r = &mut g.rng;
            let v = n * r.range(3., 7.) + v3(r.range(-2., 2.), r.range(3., 7.), r.range(-2., 2.));
            shed_part(g, who, Part::Plate, p + n * 0.3, v);
        }
    }
}
/// A burn on the ground. Small blasts leave no mark (a volley of ten would tile the ground).
pub fn scorch(g: &mut Game, x: f32, z: f32, r: f32, y: f32) {
    if r < 3.
        || g.scorch
            .iter()
            .any(|s| s.r >= r * 0.8 && hypot2(s.x - x, s.z - z) < s.r * 1.2)
    {
        return;
    }
    let s = Scorch { x, z, r, y };
    if g.scorch.len() < MAX_SCORCH {
        g.scorch.push(s);
    } else {
        g.scorch[g.scorch_at] = s;
    }
    g.scorch_at = (g.scorch_at + 1) % MAX_SCORCH;
}
/// A blast: a shockwave ring if it is near the ground, fire, smoke, debris, the thump by distance.
pub fn explode(g: &mut Game, p: V3, big: bool) {
    let (n, s) = if big { (34, 1.6) } else { (10, 0.7) };
    let gy = g.ter.height(p.x, p.z);
    if p.y - gy < 10. {
        particle(
            g,
            v3(p.x, gy + 0.3, p.z),
            V3::ZERO,
            0.4,
            if big { 26. } else { 9. },
            [0.95, 0.86, 0.66],
            PKind::Shock,
            0.,
        );
        scorch(g, p.x, p.z, if big { 4.5 } else { 1.8 }, gy);
    }
    for _ in 0..n {
        let r = &mut g.rng;
        let col = [1., r.range(0.45, 0.9), 0.1];
        let v = v3(r.range(-1., 1.), r.range(-0.2, 1.), r.range(-1., 1.)).norm()
            * (r.range(3., 14.) * s);
        let (life, size) = (r.range(0.35, 0.9), r.range(0.6, 1.6) * s);
        particle(g, p, v, life, size, col, PKind::Fire, 0.);
    }
    for _ in 0..n / 2 {
        let r = &mut g.rng;
        let (pp, v, life, size) = (
            p + v3(r.range(-2., 2.), r.range(0., 2.), r.range(-2., 2.)),
            v3(r.range(-1., 1.), r.range(2., 5.), r.range(-1., 1.)),
            r.range(1.5, 3.),
            r.range(1., 2.4) * s,
        );
        particle(g, pp, v, life, size, [0.25, 0.23, 0.22], PKind::Smoke, 0.);
    }
    if big {
        for _ in 0..12 {
            let r = &mut g.rng;
            let (v, life, size) = (
                v3(r.range(-9., 9.), r.range(8., 20.), r.range(-9., 9.)),
                r.range(1.5, 2.6),
                r.range(0.4, 1.1),
            );
            particle(g, p, v, life, size, [0.2, 0.2, 0.2], PKind::Debris, 26.);
        }
    }
    let d = (p - g.eye).len();
    feel(
        g,
        Feel::Explosion,
        Some(PLAYER),
        (if big { 1. } else { 0.35 }) * clamp(1. - d / 220., 0., 1.),
        0.,
        None,
        Some(p),
    );
    g.sfx(Sfx::Boom { big }, Some(p));
}
