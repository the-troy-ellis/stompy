//! Frames, muzzles, the eye, and rays: mechs are vertical cylinders for hits,
//! and the ground is the terrain's height field.
use crate::data::*;
use crate::game::*;
use crate::math::*;

pub fn frame_of(m: &Mech) -> M4 {
    let s = m.ch.scale;
    M4::t(m.x, m.y + m.bob, m.z) * M4::ry(m.yaw) * M4::s1(s)
}
pub fn torso_frame(m: &Mech) -> M4 {
    frame_of(m) * M4::t(0., m.geo.torso_y + m.torso_drop, 0.) * M4::ry(m.twist)
}
pub fn center_of(m: &Mech) -> V3 {
    v3(m.x, m.y + 4.2 * m.ch.scale, m.z)
}
pub fn muzzle_of(m: &Mech, w: &Weapon) -> V3 {
    let tf = torso_frame(m);
    let g = &m.geo;
    if w.mount == Sec::T {
        return tf.apply(if w.def.kind == WKind::Missile {
            v3(if w.side % 2 == 1 { -1.25 } else { 1.25 }, g.rack_y, 0.6)
        } else {
            v3(-0.9, g.ac_y, 1.6)
        });
    }
    tf.apply(v3(
        if w.mount == Sec::LA { 1. } else { -1. } * g.arm_x,
        g.arm_y - 1.2,
        2.4,
    ))
}
pub fn eye_of(m: &Mech) -> V3 {
    torso_frame(m).apply(v3(m.geo.eye[0], m.geo.eye[1], m.geo.eye[2]))
}
/// Where a shell fired now from `from` at `speed` meets a mech walking on its heading.
pub fn lead_point(from: V3, t: &Mech, speed: f32) -> V3 {
    let c = center_of(t);
    let v = v3(t.yaw.sin() * t.speed, 0., t.yaw.cos() * t.speed);
    let mut p = c;
    for _ in 0..2 {
        p = c + v * ((p - from).len() / speed);
    }
    p
}
/// A ray against an upright cylinder standing at (x, y, z): the nearest t >= 0 on its side, within its height.
pub fn ray_upright(o: V3, d: V3, x: f32, y: f32, z: f32, r: f32, h: f32) -> Option<f32> {
    let (ox, oz, a) = (o.x - x, o.z - z, d.x * d.x + d.z * d.z);
    if a < 1e-8 {
        return None;
    }
    let b = 2. * (ox * d.x + oz * d.z);
    let c = ox * ox + oz * oz - r * r;
    let disc = b * b - 4. * a * c;
    if disc < 0. {
        return None;
    }
    let sq = disc.sqrt();
    for t in [(-b - sq) / (2. * a), (-b + sq) / (2. * a)] {
        if t >= 0. {
            let hy = o.y + d.y * t;
            if hy >= y && hy <= y + h {
                return Some(t);
            }
        }
    }
    None
}
pub fn ray_cyl(o: V3, d: V3, m: &Mech) -> Option<f32> {
    ray_upright(o, d, m.x, m.y, m.z, m.radius(), m.geo.height * m.ch.scale)
}
#[derive(Clone, Copy, Debug)]
pub struct Hit {
    pub t: f32,
    pub mech: Option<MechId>,
    pub point: V3,
}
/// The first mech or ground along a ray, ignoring one mech.
pub fn ray_hit(g: &Game, o: V3, d: V3, max_t: f32, ignore: Option<MechId>) -> Option<Hit> {
    let mut best: Option<(f32, Option<MechId>)> = None;
    for (i, m) in g.mechs.iter().enumerate() {
        if !m.alive || Some(i) == ignore {
            continue;
        }
        if let Some(t) = ray_cyl(o, d, m) {
            if t <= max_t && best.is_none_or(|(bt, _)| t < bt) {
                best = Some((t, Some(i)));
            }
        }
    }
    if let Some(tt) = g.ter.ray(o, d, best.map_or(max_t, |b| b.0)) {
        best = Some((tt, None));
    }
    best.map(|(t, mech)| Hit {
        t,
        mech,
        point: o + d * t,
    })
}
/// Which section a point on the body is: legs by side below the leg top, arms out past 1.6 units in torso space.
pub fn section_hit(m: &Mech, p: V3) -> Sec {
    let (dx, dz, ly) = (p.x - m.x, p.z - m.z, (p.y - m.y) / m.ch.scale);
    if ly < m.geo.leg_top {
        let a = m.yaw;
        return if dx * a.cos() - dz * a.sin() > 0. {
            Sec::LL
        } else {
            Sec::RL
        };
    }
    let a = m.view_yaw();
    let lx = (dx * a.cos() - dz * a.sin()) / m.ch.scale;
    if lx > 1.6 {
        Sec::LA
    } else if lx < -1.6 {
        Sec::RA
    } else {
        Sec::T
    }
}
/// Is the ground between two points?
pub fn blocked(g: &Game, a: V3, b: V3) -> bool {
    let d = b - a;
    let l = d.len();
    if l < 1. {
        return false;
    }
    g.ter.ray(a, d * (1. / l), l - 1.).is_some()
}
