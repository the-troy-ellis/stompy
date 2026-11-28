//! A mech thrown or toppled, as a ragdoll: points joined by sticks (Verlet integration and
//! distance constraints), with gravity, the ground and friction. Drawn only: where the mech is,
//! what hits it and the knockdown's timing stay the sim's. The impact drives it, so the struck
//! torso leads and the rest of the body follows, and arms and legs flail and trail by themselves
//! (docs/specs/06-knockdown.md). It is read back as the get-up's pose (`anim::DownPose`), so the
//! drawing, the cockpit's eye and the blend into the get-up are the same as everywhere else.
//! A few microseconds a mech; only falling mechs run one.
use crate::anim::DownPose;
use stompy_sim::data::{Knee, Legs};
use stompy_sim::gait::solve_knee;
use stompy_sim::math::*;
use stompy_sim::{Game, Mech};

/// The points, by name.
const PELVIS: usize = 0;
const CHEST: usize = 1;
const HEAD: usize = 2;
const HIP: [usize; 2] = [3, 4];
const KNEE: [usize; 2] = [5, 6];
const FOOT: [usize; 2] = [7, 8];
const SHOULDER: [usize; 2] = [9, 10];
const HAND: [usize; 2] = [11, 12];
const N: usize = 13;
const GRAVITY: f32 = 18.;
const ITERS: usize = 8;
const SUBSTEPS: usize = 2;
/// How much speed a point on the ground keeps a step (sliding friction), and in the air.
const GRIP: f32 = 0.8;
const AIR: f32 = 0.998;
/// How hard the waist resists folding (0 free, 1 rigid).
const WAIST: f32 = 0.25;

#[derive(Clone, Copy, Debug)]
struct Point {
    p: V3,
    o: V3,
    r: f32,
}
#[derive(Clone, Copy, Debug)]
struct Stick {
    a: usize,
    b: usize,
    len: f32,
    k: f32,
    /// Only keeps them at least this far apart (a leg can't fold up into the hips).
    min_only: bool,
}
#[derive(Clone, Debug)]
pub struct Ragdoll {
    pts: [Point; N],
    sticks: Vec<Stick>,
    t: f32,
    /// Seconds it has lain still.
    still: f32,
    scale: f32,
}
impl Ragdoll {
    /// The mech as it stands now, as points.
    pub fn of(m: &Mech, time: f32) -> Option<Ragdoll> {
        let g = &m.geo;
        let legs = g.legs();
        if legs.len() != 2 || m.ch.legs == Legs::Quad {
            return None;
        }
        let sc = m.ch.scale;
        let ground = M4::t(m.x, m.y, m.z) * M4::ry(m.yaw) * M4::s1(sc);
        let torso = ground * M4::t(0., g.torso_y, 0.) * M4::ry(m.twist);
        let at = |f: &M4, x: f32, y: f32, z: f32| f.apply(v3(x, y, z));
        let mut p = [V3::ZERO; N];
        p[PELVIS] = at(&ground, 0., g.hip, 0.);
        p[CHEST] = at(&torso, 0., 1.2, 0.);
        p[HEAD] = at(&torso, 0., 2.8, 0.1);
        let fwd = v3(m.yaw.sin(), 0., m.yaw.cos());
        let pole = match g.knee {
            Knee::Back => fwd * -1.,
            _ => fwd,
        };
        for (i, l) in legs.iter().enumerate() {
            p[HIP[i]] = at(&ground, l.hx, g.hip, l.hz);
            p[FOOT[i]] = m.feet[i].pos + v3(0., g.ankle * sc, 0.);
            p[KNEE[i]] = solve_knee(p[HIP[i]], p[FOOT[i]], pole, g.l1 * sc, g.l2 * sc);
        }
        for (i, s) in [1., -1.].into_iter().enumerate() {
            p[SHOULDER[i]] = at(&torso, s * g.arm_x, g.arm_y, 0.);
            p[HAND[i]] = at(&torso, s * g.arm_x, g.arm_y - 2.4, 0.3);
        }
        let radius = [
            0.9, 1.2, 0.7, 0.5, 0.5, 0.4, 0.4, 0.35, 0.35, 0.6, 0.6, 0.5, 0.5,
        ];
        let pts = std::array::from_fn(|i| Point {
            p: p[i],
            o: p[i],
            r: radius[i] * sc,
        });
        let mut sticks = vec![];
        let mut tie = |a: usize, b: usize, k: f32| {
            sticks.push(Stick {
                a,
                b,
                len: (p[a] - p[b]).len(),
                k,
                min_only: false,
            })
        };
        // Two rigid blocks, the hips and the upper body, hinged at the chest; the waist resists
        // folding a little.
        let lower = [PELVIS, HIP[0], HIP[1], CHEST];
        let upper = [CHEST, HEAD, SHOULDER[0], SHOULDER[1]];
        for block in [lower, upper] {
            for i in 0..4 {
                for j in i + 1..4 {
                    tie(block[i], block[j], 1.);
                }
            }
        }
        tie(PELVIS, HEAD, WAIST);
        tie(HIP[0], SHOULDER[0], WAIST);
        tie(HIP[1], SHOULDER[1], WAIST);
        for i in 0..2 {
            tie(HIP[i], KNEE[i], 1.);
            tie(KNEE[i], FOOT[i], 1.);
            tie(SHOULDER[i], HAND[i], 1.);
        }
        for i in 0..2 {
            sticks.push(Stick {
                a: HIP[i],
                b: FOOT[i],
                len: (p[HIP[i]] - p[FOOT[i]]).len() * 0.55,
                k: 1.,
                min_only: true,
            });
        }
        Some(Ragdoll {
            pts,
            sticks,
            t: time,
            still: 0.,
            scale: sc,
        })
    }
    /// Everything moving at `v` (m/s): the throw's lift and the shove.
    pub fn carry(&mut self, v: V3) {
        // One integration step's worth (the step's substeps, at 60 a second).
        let dt = 1. / (60. * SUBSTEPS as f32);
        for p in &mut self.pts {
            p.o = p.p - v * dt;
        }
    }
    /// The blow, along `dir`: the struck upper body takes it hardest, the hips less, and the
    /// feet are left behind (they had the ground). Nets out about zero, so the body as a whole
    /// still goes where the sim's shove takes it.
    pub fn strike(&mut self, dir: V3, k: f32) {
        // One integration step's worth (the step's substeps, at 60 a second).
        let dt = 1. / (60. * SUBSTEPS as f32);
        let share = [
            0.0, 0.6, 0.9, -0.1, -0.1, -0.35, -0.35, -0.6, -0.6, 0.6, 0.6, 0.35, 0.35,
        ];
        // Balanced to nothing net: it turns the body, it doesn't add to the shove.
        let mean = share.iter().sum::<f32>() / N as f32;
        for (p, s) in self.pts.iter_mut().zip(share) {
            p.o = p.o - dir * (k * (s - mean) * dt);
        }
    }
    pub fn step(&mut self, g: &Game, m: &Mech) {
        let dt = (g.time - self.t).clamp(0., 0.05);
        self.t = g.time;
        if dt <= 0. {
            return;
        }
        let h = dt / SUBSTEPS as f32;
        let mut speed = 0f32; // the points' average, the last substep
        for _ in 0..SUBSTEPS {
            for p in &mut self.pts {
                let v = (p.p - p.o) * AIR;
                p.o = p.p;
                p.p = p.p + v + v3(0., -GRAVITY * h * h, 0.);
            }
            for _ in 0..ITERS {
                for s in &self.sticks {
                    let (a, b) = (self.pts[s.a].p, self.pts[s.b].p);
                    let d = b - a;
                    let len = d.len().max(1e-4);
                    if s.min_only && len >= s.len {
                        continue;
                    }
                    let fix = d * ((len - s.len) / len * 0.5 * s.k);
                    self.pts[s.a].p = a + fix;
                    self.pts[s.b].p = b - fix;
                }
                for p in &mut self.pts {
                    let floor = g.ter.height(p.p.x, p.p.z) + p.r;
                    if p.p.y < floor {
                        p.p.y = floor;
                    }
                }
            }
            // Friction, once a step, on the points touching the ground: they slide and slow.
            for p in &mut self.pts {
                let floor = g.ter.height(p.p.x, p.p.z) + p.r;
                if p.p.y <= floor + 0.01 {
                    p.o.x = p.p.x - (p.p.x - p.o.x) * GRIP;
                    p.o.z = p.p.z - (p.p.z - p.o.z) * GRIP;
                    p.o.y = p.o.y.max(p.p.y - 0.2 * (p.p.y - p.o.y).abs());
                }
            }
            speed = self.pts.iter().map(|p| (p.p - p.o).len() / h).sum::<f32>() / N as f32;
        }
        // Held loosely to where the sim has the mech, so the body stays on its hitbox.
        let pel = self.pts[PELVIS].p;
        let pull = v3(m.x - pel.x, 0., m.z - pel.z) * 0.15;
        for p in &mut self.pts {
            p.p += pull;
            p.o += pull;
        }
        let on_ground = self
            .pts
            .iter()
            .filter(|p| p.p.y <= g.ter.height(p.p.x, p.p.z) + p.r + 0.05)
            .count()
            >= 3;
        if on_ground && speed < 0.8 * self.scale {
            self.still += dt;
        } else {
            self.still = 0.;
        }
    }
    fn left(&self) -> V3 {
        (self.pts[HIP[0]].p - self.pts[HIP[1]].p).norm()
    }
    fn up(&self) -> V3 {
        (self.pts[CHEST].p - self.pts[PELVIS].p).norm()
    }
    /// Seconds it has lain still on the ground.
    pub fn still(&self) -> f32 {
        self.still
    }
    /// The body now, as the get-up's pose, in the mech's ground frame (the sim's place and
    /// heading), so it's drawn exactly where the points are.
    pub fn pose(&self, m: &Mech) -> DownPose {
        let g = &m.geo;
        let sc = m.ch.scale;
        let (s, c) = (m.yaw.sin(), m.yaw.cos());
        // World to the ground frame: back off the place and heading, and the scale.
        let dir = |v: V3| v3(c * v.x - s * v.z, v.y, s * v.x + c * v.z) * (1. / sc);
        let at = |v: V3| dir(v - v3(m.x, m.y, m.z));
        let pel = at(self.pts[PELVIS].p);
        // The body's frame: x its left, y its up. Read as turn (about y), then roll (about z),
        // then back (about x), the order `scene::down_frames` builds it in: that order only
        // locks up with the body on its side, never on its back.
        let x = dir(self.left()).norm();
        let up0 = dir(self.up()).norm();
        let y = (up0 - x * up0.dot(x)).norm();
        let fwd = x.cross(y).norm();
        let roll = x.y.clamp(-1., 1.).asin();
        let turn = (-x.z).atan2(x.x);
        // Undo the turn and the roll from y: what's left is the tilt back.
        let (ts, tc) = (turn.sin(), turn.cos());
        let y1 = v3(tc * y.x - ts * y.z, y.y, ts * y.x + tc * y.z);
        let (rs, rc) = (roll.sin(), roll.cos());
        let y2 = v3(rc * y1.x + rs * y1.y, -rs * y1.x + rc * y1.y, y1.z);
        let back = -(y2.z.atan2(y2.y));
        let up = y;
        let left = x;
        // The upper body against the hips.
        let t = dir(self.pts[HEAD].p - self.pts[CHEST].p).norm();
        let lean = t.dot(fwd).atan2(t.dot(up));
        let tz = left.cross(t).norm();
        let arm = |i: usize| {
            let v = dir(self.pts[HAND[i]].p - self.pts[SHOULDER[i]].p);
            (-v.dot(tz)).atan2(-v.dot(t))
        };
        let foot = |i: usize| {
            let f = at(self.pts[FOOT[i]].p);
            [f.x, f.y - g.ankle, f.z]
        };
        DownPose {
            hip_x: pel.x,
            hip_h: pel.y / g.hip,
            hip_z: pel.z,
            turn,
            back,
            roll,
            lean,
            feet: [foot(0), foot(1)],
            arms: [arm(0), arm(1)],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use stompy_sim::data::{Biome, Ch, Diff, TimeOfDay, Weather};
    use stompy_sim::state::start_free_play;
    fn game(ch: Ch) -> Game {
        let mut g = Game::new(1);
        start_free_play(
            &mut g,
            Biome::Dusk,
            TimeOfDay::Dusk,
            Weather::Clear,
            0,
            1,
            ch,
            Diff::Normal,
            true,
        );
        g
    }
    fn run(g: &mut Game, r: &mut Ragdoll, secs: f32) {
        for _ in 0..(secs * 60.) as usize {
            g.time += 1. / 60.;
            let m = g.mechs[0].clone();
            r.step(g, &m);
        }
    }
    #[test]
    fn struck_the_head_leads_and_the_feet_lag() {
        let mut g = game(Ch::Kestrel);
        let m = g.mechs[0].clone();
        let mut r = Ragdoll::of(&m, g.time).unwrap();
        let (head0, foot0) = (r.pts[HEAD].p, r.pts[FOOT[0]].p);
        r.strike(v3(0., 0., -1.), 9.);
        run(&mut g, &mut r, 0.15);
        let (head, foot) = (head0.z - r.pts[HEAD].p.z, foot0.z - r.pts[FOOT[0]].p.z);
        assert!(
            head > 0.5 && head > foot + 0.5,
            "head {head} m, foot {foot} m"
        );
    }
    #[test]
    fn it_comes_to_rest_on_the_ground_in_one_piece() {
        for ch in [Ch::Kestrel, Ch::Jackal, Ch::Puncher] {
            let mut g = game(ch);
            let m = g.mechs[0].clone();
            let mut r = Ragdoll::of(&m, g.time).unwrap();
            r.carry(v3(0., 7., -6.));
            r.strike(v3(0., 0., -1.), 9.);
            run(&mut g, &mut r, 6.);
            assert!(r.still() > 0.5, "{ch:?}: still after six seconds");
            for (i, p) in r.pts.iter().enumerate() {
                let floor = g.ter.height(p.p.x, p.p.z);
                assert!(p.p.y >= floor - 0.05, "{ch:?}: point {i} underground");
            }
            for s in &r.sticks {
                let len = (r.pts[s.a].p - r.pts[s.b].p).len();
                if s.k >= 1. && !s.min_only {
                    assert!(
                        (len - s.len).abs() < 0.12 * s.len.max(1.),
                        "{ch:?}: a limb stretched"
                    );
                }
            }
            // Down: the hips near the ground, read back where the points are.
            let m = g.mechs[0].clone();
            let pose = r.pose(&m);
            assert!(pose.hip_h < 0.5, "{ch:?}: lying, hips at {}", pose.hip_h);
        }
    }
    #[test]
    fn quads_have_no_ragdoll() {
        let g = game(Ch::Warden);
        assert!(Ragdoll::of(&g.mechs[0], g.time).is_none());
    }
}
#[cfg(test)]
mod drawn {
    use super::*;
    use stompy_sim::data::{Biome, Ch, Diff, TimeOfDay, Weather};
    use stompy_sim::state::start_free_play;
    #[test]
    fn the_drawn_hips_stay_on_the_ragdoll_through_the_whole_fall() {
        let mut g = Game::new(1);
        start_free_play(
            &mut g,
            Biome::Dusk,
            TimeOfDay::Dusk,
            Weather::Clear,
            0,
            1,
            Ch::Kestrel,
            Diff::Normal,
            true,
        );
        let m = g.mechs[0].clone();
        let mut r = Ragdoll::of(&m, g.time).unwrap();
        r.carry(v3(0., 7., -6.));
        r.strike(v3(0., 0., -1.), 6.);
        let mut worst = 0f32;
        for _ in 0..240 {
            g.time += 1. / 60.;
            let m = g.mechs[0].clone();
            r.step(&g, &m);
            let d = r.pose(&m);
            let gg = &m.geo;
            let ground = M4::t(m.x, m.y, m.z) * M4::ry(m.yaw) * M4::s1(m.ch.scale);
            let base = ground
                * M4::t(d.hip_x, d.hip_h * gg.hip, d.hip_z)
                * M4::ry(d.turn)
                * M4::rz(d.roll)
                * M4::rx(-d.back)
                * M4::t(0., -gg.hip, 0.);
            for (i, l) in gg.legs().iter().enumerate() {
                worst = worst.max((base.apply(v3(l.hx, gg.hip, l.hz)) - r.pts[HIP[i]].p).len());
            }
        }
        // Built in the same order as `scene::down_frames`: no flip at lying flat.
        assert!(
            worst < 0.4,
            "the drawn hip strays {worst} m from the ragdoll's"
        );
    }
}
#[cfg(test)]
mod flight {
    use super::*;
    use stompy_sim::data::{Biome, Ch, Diff, TimeOfDay, Weather};
    use stompy_sim::state::start_free_play;
    #[test]
    fn thrown_it_flies_with_the_mech_and_its_legs_hold_together() {
        let mut g = Game::new(1);
        start_free_play(
            &mut g,
            Biome::Dusk,
            TimeOfDay::Dusk,
            Weather::Clear,
            0,
            1,
            Ch::Kestrel,
            Diff::Normal,
            true,
        );
        stompy_sim::down::knock_down(&mut g, 0, [0., -1.]);
        {
            let m = &mut g.mechs[0];
            (m.vy, m.air, m.thrown, m.push) = (7., true, true, [0., -20.]);
        }
        let m = g.mechs[0].clone();
        let mut r = Ragdoll::of(&m, g.time).unwrap();
        r.carry(v3(m.push[0], m.vy, m.push[1]));
        r.strike(v3(0., 0., -1.), 6.);
        let i = stompy_sim::Input::default();
        let (legs, mut apart, mut long) = ((m.geo.l1 + m.geo.l2) * m.ch.scale, 0f32, 0f32);
        for _ in 0..120 {
            stompy_sim::update::update(&mut g, &i, 1. / 60.);
            let m = g.mechs[0].clone();
            r.step(&g, &m);
            let p = r.pts[PELVIS].p;
            apart = apart.max(hypot2(p.x - m.x, p.z - m.z));
            for k in 0..2 {
                long = long.max((r.pts[HIP[k]].p - r.pts[FOOT[k]].p).len());
            }
        }
        assert!(apart < 4., "it keeps with the mech: {apart} m apart");
        assert!(long < legs * 1.03, "the legs hold: {long} m to {legs}");
    }
}
