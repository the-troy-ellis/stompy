//! The body's own motion, on top of what the sim moves: arms that swing against the legs and
//! trail a turn, feet that roll off and onto the ground, pistons that slide as the joints
//! bend, an antenna that whips and pods that bounce, guns that kick. All of it is drawn only:
//! where a mech is, where its feet are and what it hits never change (`docs/specs/03-anim.md`).
//! Each chassis has a profile; one without draws as before.
use stompy_sim::data::Ch;
use stompy_sim::gait::swing_now;
use stompy_sim::math::*;
use stompy_sim::spring::Spring;
use stompy_sim::Mech;

/// How a chassis carries itself. Layer 3 (personality) grows this table.
pub struct Profile {
    /// Arm swing against the stride at full pace, radians.
    pub arm_swing: f32,
    /// How far the arms trail a turn, radians per radian a second of turn.
    pub arm_lag: f32,
    /// Toe-off and heel-strike in the air, radians (the whole foot; small, the toes do the rest).
    pub foot_roll: f32,
    /// The toes: how far they curl under in the air, how far they open before landing, how
    /// much they close together in the air, how hard they spread when they grip.
    pub toe_curl: f32,
    pub toe_open: f32,
    pub toe_close: f32,
    pub toe_grip: f32,
    /// The antenna: how hard the torso's jolts throw it, and its spring.
    pub ant_gain: f32,
    pub ant_k: f32,
    pub ant_zeta: f32,
    /// The pods: how far a jolt drops them, and their spring.
    pub pod_gain: f32,
    pub pod_k: f32,
    pub pod_zeta: f32,
    /// How far a gun slides back when it fires (metres; double for a big gun).
    pub recoil: f32,
    /// Where the antenna stands on the torso.
    pub ant_base: [f32; 3],
    /// Where the pods hinge on the torso.
    pub pod_hinge: [f32; 3],
}
/// BARRY: steady and workmanlike. The swing is small and even, the antenna whips, the pods
/// thump down on each footfall and settle.
pub const BARRY: Profile = Profile {
    arm_swing: 0.09,
    arm_lag: 0.11,
    foot_roll: 0.18,
    toe_curl: 0.6,
    toe_open: 0.35,
    toe_close: 0.5,
    toe_grip: 0.3,
    ant_gain: 0.06,
    ant_k: 80.,
    ant_zeta: 0.12,
    pod_gain: 0.12,
    pod_k: 170.,
    pod_zeta: 0.22,
    recoil: 0.28,
    ant_base: [-0.6, 3.1, -0.4],
    pod_hinge: [0., 2.4, -0.1],
};
pub fn profile(ch: Ch) -> Option<&'static Profile> {
    match ch {
        Ch::Kestrel => Some(&BARRY),
        _ => None,
    }
}

/// One mech's drawn-only state, carried frame to frame.
pub struct Anim {
    t: f32,
    look: f32,
    base: V3,
    vel: V3,
    pub lag: Spring,
    pub ant_x: Spring,
    pub ant_z: Spring,
    pub pod: Spring,
    /// When each foot last came down, and whether it was up last frame.
    planted: [f32; 4],
    was_up: [bool; 4],
}
impl Anim {
    pub fn new(p: &Profile, t: f32) -> Anim {
        Anim {
            t,
            look: 0.,
            base: V3::ZERO,
            vel: V3::ZERO,
            lag: Spring::new(60., 0.5),
            ant_x: Spring::new(p.ant_k, p.ant_zeta),
            ant_z: Spring::new(p.ant_k, p.ant_zeta),
            pod: Spring::new(p.pod_k, p.pod_zeta),
            planted: [-9.; 4],
            was_up: [false; 4],
        }
    }
    /// Moves the springs on by the sim's time since last frame (none while paused). `tb` is the
    /// torso's frame as drawn.
    pub fn tick(&mut self, p: &Profile, m: &Mech, time: f32, tb: &M4) {
        let dt = time - self.t;
        let look = m.view_yaw();
        let base = tb.apply(v3(p.ant_base[0], p.ant_base[1], p.ant_base[2]));
        if !(0.0..0.1).contains(&dt) || dt == 0. {
            // A new match, a pause or a hitch: start from rest here.
            if !(0.0..0.1).contains(&dt) {
                *self = Anim::new(p, time);
                self.look = look;
                self.base = base;
            }
            return;
        }
        self.t = time;
        for (i, f) in m.feet.iter().enumerate().take(m.geo.n_legs) {
            if self.was_up[i] && !f.lifted {
                self.planted[i] = time;
            }
            self.was_up[i] = f.lifted;
        }
        // The arms trail a turn.
        let turn = wrap_angle(look - self.look) / dt;
        self.look = look;
        self.lag.step(dt, clamp(-turn * p.arm_lag, -0.35, 0.35));
        // The torso's jolt, in its own frame: sideways and fore-aft throw the antenna,
        // up and down throws the pods.
        let vel = (base - self.base) * (1. / dt);
        let acc = (vel - self.vel) * (1. / dt);
        self.base = base;
        self.vel = vel;
        let (s, c) = (look.sin(), look.cos());
        let (side, fore) = (acc.x * c - acc.z * s, acc.x * s + acc.z * c);
        let lim = |a: f32| clamp(a, -60., 60.);
        self.ant_x.v -= lim(fore) * p.ant_gain * dt;
        self.ant_z.v += lim(side) * p.ant_gain * dt;
        self.pod.v -= lim(acc.y) * p.pod_gain * dt;
        self.ant_x.step(dt, 0.);
        self.ant_z.step(dt, 0.);
        self.pod.step(dt, 0.);
        self.ant_x.x = clamp(self.ant_x.x, -0.6, 0.6);
        self.ant_z.x = clamp(self.ant_z.x, -0.6, 0.6);
        self.pod.x = clamp(self.pod.x, -0.2, 0.12);
    }
}
fn wrap_angle(a: f32) -> f32 {
    (a + PI).rem_euclid(TAU) - PI
}
/// How far along its pace a mech is walking, 0 standing to 1 flat out.
pub fn pace(m: &Mech) -> f32 {
    clamp(m.speed.abs() / m.max_speed.max(0.1), 0., 1.2)
}
/// An arm's swing now: against the leg on its own side.
pub fn arm_swing(p: &Profile, m: &Mech, side: f32) -> f32 {
    let legs = m.geo.legs();
    let Some(l) = legs.iter().find(|l| l.hx * side > 0.) else {
        return 0.;
    };
    -p.arm_swing * pace(m).min(1.) * (TAU * (m.cyc - l.ph)).sin()
}
/// How far through its swing a foot is (0 lifting, 1 landing), or None planted.
fn swing_u(m: &Mech, i: usize) -> Option<f32> {
    if !m.feet[i].lifted {
        return None;
    }
    let sw = swing_now(m, pace(m)).max(0.05);
    let u = (m.cyc - m.geo.legs()[i].ph).rem_euclid(1.) / sw;
    (u < 1.).then_some(u)
}
/// How big the step's gestures are: full at a walk, still there for a shuffle or a turn.
fn step_k(m: &Mech) -> f32 {
    (pace(m) * 2.).clamp(0.5, 1.)
}
/// A foot's roll now: toes down as it leaves the ground, toes up as it comes in, flat planted.
pub fn foot_roll(p: &Profile, m: &Mech, i: usize) -> f32 {
    swing_u(m, i).map_or(0., |u| p.foot_roll * step_k(m) * (TAU * u).sin())
}
/// The toes now, as (curl, spread): curl in radians, under is positive; spread a multiple of
/// their resting splay. Lifting, the heel comes up and the toes stay on the ground; in the air
/// they curl under and close like a claw; before landing they open and reach; down, they
/// grip: spread wide and flat, then settle.
pub fn toe_pose(p: &Profile, m: &Mech, a: &Anim, i: usize, time: f32) -> (f32, f32) {
    let k = step_k(m);
    match swing_u(m, i) {
        Some(u) => {
            let close = smooth(u / 0.35);
            let open = smooth((u - 0.6) / 0.3);
            let curled = close * (1. - open);
            let peel = foot_roll(p, m, i) * (1. - smooth(u / 0.25));
            (
                k * (p.toe_curl * curled - p.toe_open * open) - peel,
                1. - p.toe_close * curled * k + 0.25 * open,
            )
        }
        None => {
            let t = time - a.planted[i];
            if !(0.0..1.).contains(&t) {
                return (0., 1.);
            }
            (
                -p.toe_open * k * (-t * 16.).exp(),
                1. + p.toe_grip * k * (-t * 7.).exp() * (t * 18.).cos().max(0.),
            )
        }
    }
}
/// How far back a gun sits now after a shot `frames` ago: a hard kick, then a slower return.
pub fn kick(p: &Profile, frames: u64, big: bool) -> f32 {
    let t = frames as f32 / 60.;
    let k = if t < 0.04 {
        t / 0.04
    } else if t < 0.3 {
        1. - smooth((t - 0.04) / 0.26)
    } else {
        0.
    };
    k * p.recoil * if big { 2. } else { 1. }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_kick_is_quick_out_and_home_by_a_third_of_a_second() {
        assert_eq!(kick(&BARRY, 0, false), 0.);
        // Out in under three frames (it peaks at 0.04 s), most of the way already at two.
        assert!(kick(&BARRY, 2, false) > 0.75 * BARRY.recoil);
        assert!(kick(&BARRY, 3, false) <= BARRY.recoil);
        assert!(kick(&BARRY, 10, false) < kick(&BARRY, 3, false));
        assert!(kick(&BARRY, 2, true) > kick(&BARRY, 2, false));
        assert_eq!(kick(&BARRY, 20, true), 0.);
    }
    #[test]
    fn toes_curl_in_the_air_reach_before_landing_and_lie_flat_down() {
        use stompy_sim::data::{Biome, Diff, TimeOfDay, Weather};
        use stompy_sim::state::start_free_play;
        let mut g = stompy_sim::Game::new(1);
        start_free_play(
            &mut g,
            Biome::Dusk,
            TimeOfDay::Dusk,
            Weather::Clear,
            1,
            1,
            Ch::Kestrel,
            Diff::Normal,
            true,
        );
        let a = Anim::new(&BARRY, 0.);
        let m = &mut g.mechs[0];
        m.speed = m.max_speed;
        let (ph, sw) = (m.geo.legs()[0].ph, swing_now(m, 1.));
        m.feet[0].lifted = true;
        m.cyc = ph + sw * 0.45; // mid-swing
        let (curl, spread) = toe_pose(&BARRY, m, &a, 0, 5.);
        assert!(curl > 0.3 && spread < 0.9, "mid-air: {curl} {spread}");
        m.cyc = ph + sw * 0.95; // about to land
        let (curl, spread) = toe_pose(&BARRY, m, &a, 0, 5.);
        assert!(curl < 0. && spread > 1., "reaching: {curl} {spread}");
        m.feet[0].lifted = false; // down long since
        assert_eq!(toe_pose(&BARRY, m, &a, 0, 5.), (0., 1.));
    }
}
