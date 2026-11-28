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
    /// The pods: how far a jolt drops them, and their spring. Each pod also sways sideways,
    /// takes a knock when the foot on its side lands, and is tuned `pod_spread` apart from
    /// the other (stiffness, damping, gain), so the two never move in step.
    pub pod_gain: f32,
    pub pod_k: f32,
    pub pod_zeta: f32,
    pub pod_spread: f32,
    pub pod_sway: f32,
    pub pod_step: f32,
    /// How far a gun slides back when it fires (metres; double for a big gun).
    pub recoil: f32,
    /// Where the antenna stands on the torso.
    pub ant_base: [f32; 3],
    /// Where the left pod hinges on the torso (the right is its mirror).
    pub pod_hinge: [f32; 3],
    /// The body's walk, on top of the sim's: how far it dips at each footfall (metres), rocks
    /// over the planted foot (metres, and a lean in radians), and how far the torso thrusts
    /// forward each step and nods with it, a bird's head-bob (metres, radians). All at full
    /// pace; standing, none.
    pub bob: f32,
    pub sway: f32,
    pub roll: f32,
    pub peck: f32,
    pub nod: f32,
    /// The shoulders turning against the hips each stride, a heavyweight's swagger (radians).
    pub swagger: f32,
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
    pod_gain: 0.07,
    pod_k: 170.,
    pod_zeta: 0.22,
    pod_spread: 0.22,
    pod_sway: 0.08,
    pod_step: 0.9,
    recoil: 0.28,
    ant_base: [-0.6, 3.1, -0.4],
    pod_hinge: [1.75, 2.4, -0.1],
    bob: 0.,
    sway: 0.,
    roll: 0.,
    peck: 0.,
    nod: 0.,
    swagger: 0.,
};
/// SKEDADDLE: twitchy, and it walks like a bird (the owner, 2026-11-28: more bob and sway).
/// The body dips at each footfall and rocks over the planted foot, the torso thrusts forward
/// each step and eases back, the arms pump hard and trail a turn, the feet snap off the
/// ground and the long toes grab, the ears flick at every jolt. No pods.
pub const SKEDADDLE: Profile = Profile {
    arm_swing: 0.17,
    arm_lag: 0.2,
    foot_roll: 0.26,
    toe_curl: 0.75,
    toe_open: 0.45,
    toe_close: 0.6,
    toe_grip: 0.38,
    ant_gain: 0.11,
    ant_k: 150.,
    ant_zeta: 0.1,
    pod_gain: 0.,
    pod_k: 170.,
    pod_zeta: 0.22,
    pod_spread: 0.,
    pod_sway: 0.,
    pod_step: 0.,
    recoil: 0.16,
    ant_base: [0., 2.5, -0.3],
    pod_hinge: [0.; 3],
    bob: 0.24,
    sway: 0.3,
    roll: 0.07,
    peck: 0.4,
    nod: 0.08,
    swagger: 0.,
};
/// PURPLE PUNCHER: a heavyweight's lumber. It rolls side to side over each planted foot, the
/// shoulders turn against the hips with every stride, the big arms swing heavily and trail a
/// turn, the feet come down flat and the stubby toes hardly curl. No pods, no antenna.
pub const PURPLE_PUNCHER: Profile = Profile {
    arm_swing: 0.2,
    arm_lag: 0.15,
    foot_roll: 0.1,
    toe_curl: 0.25,
    toe_open: 0.15,
    toe_close: 0.15,
    toe_grip: 0.2,
    ant_gain: 0.,
    ant_k: 80.,
    ant_zeta: 0.2,
    pod_gain: 0.,
    pod_k: 170.,
    pod_zeta: 0.22,
    pod_spread: 0.,
    pod_sway: 0.,
    pod_step: 0.,
    recoil: 0.3,
    ant_base: [0.; 3],
    pod_hinge: [0.; 3],
    bob: 0.1,
    sway: 0.24,
    roll: 0.06,
    peck: 0.,
    nod: 0.,
    swagger: 0.13,
};
pub fn profile(ch: Ch) -> Option<&'static Profile> {
    match ch {
        Ch::Kestrel => Some(&BARRY),
        Ch::Jackal => Some(&SKEDADDLE),
        Ch::Puncher => Some(&PURPLE_PUNCHER),
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
    /// Each pod's drop and sideways sway, left (x > 0) then right.
    pub pod: [Spring; 2],
    pub sway: [Spring; 2],
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
            pod: [0, 1].map(|j| {
                let d = pod_detune(p, j);
                Spring::new(p.pod_k * (1. + d), p.pod_zeta * (1. - d * 0.8))
            }),
            sway: [0, 1].map(|j| {
                let d = pod_detune(p, j);
                Spring::new(p.pod_k * 0.55 * (1. - d), p.pod_zeta * (1. + d))
            }),
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
                // The pod over this foot takes the knock; the other only the body's share.
                let left = m.geo.legs()[i].hx > 0.;
                let (j, k) = (if left { 0 } else { 1 }, p.pod_step * pace(m).min(1.));
                self.pod[j].v -= k;
                // and rocks outward over the foot that landed.
                self.sway[j].v += k * 0.8;
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
        for j in 0..2 {
            let d = pod_detune(p, j);
            self.pod[j].v -= lim(acc.y) * p.pod_gain * (1. + d * 0.6) * dt;
            self.sway[j].v += lim(side) * p.pod_sway * (1. - d) * dt;
            self.pod[j].step(dt, 0.);
            self.sway[j].step(dt, 0.);
            self.pod[j].x = clamp(self.pod[j].x, -0.2, 0.12);
            self.sway[j].x = clamp(self.sway[j].x, -0.25, 0.25);
        }
        self.ant_x.step(dt, 0.);
        self.ant_z.step(dt, 0.);
        self.ant_x.x = clamp(self.ant_x.x, -0.6, 0.6);
        self.ant_z.x = clamp(self.ant_z.x, -0.6, 0.6);
    }
}
/// How far pod `j` is tuned from the middle: the left a little stiffer, the right a little
/// looser and not by the same amount, so their rhythms never line up.
fn pod_detune(p: &Profile, j: usize) -> f32 {
    if j == 0 {
        p.pod_spread
    } else {
        -p.pod_spread * 0.7
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
/// The body's walk now, on top of the sim's (drawn only).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Body {
    /// Up (metres); sideways, toward +x (metres), and the lean that goes with it (radians,
    /// about z); the torso's thrust forward (metres) and its nod (radians, forward).
    pub bob: f32,
    pub sway: f32,
    pub roll: f32,
    pub peck: f32,
    pub nod: f32,
    /// The shoulders' turn against the hips (radians, about y).
    pub yaw: f32,
}
/// The body's walk for where a mech is in its stride. It dips as each foot lands and rises
/// over the planted leg; it rocks over whichever foot is down; each step the torso thrusts
/// forward fast and eases back while the body catches up, as a bird's head does.
pub fn body(p: &Profile, m: &Mech) -> Body {
    let k = pace(m).min(1.2);
    let legs = m.geo.legs();
    if k < 0.02 || m.air || legs.len() != 2 {
        return Body::default();
    }
    let (ph, side) = (legs[0].ph, legs[0].hx.signum());
    let sw = swing_now(m, pace(m));
    // Steps since the first foot last landed: a footfall at every whole and half.
    let since = m.cyc - ph - sw;
    let bob = -p.bob * k * (TAU * 2. * since).cos();
    // Over the first foot halfway through its stance, over the other half a stride later.
    let over = (TAU * (since - (1. - sw) * 0.5)).cos();
    let f = (2. * since).rem_euclid(1.);
    let thrust = if f < 0.22 {
        f / 0.22
    } else {
        1. - (f - 0.22) / 0.78
    };
    Body {
        bob,
        sway: p.sway * k * side * over,
        roll: -p.roll * k * side * over,
        peck: p.peck * k * (smooth(thrust) - 0.5),
        nod: p.nod * k * (smooth(thrust) - 0.5),
        // The shoulder over the planted foot swings back, the other forward.
        yaw: p.swagger * k * side * over,
    }
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
    fn skedaddle_bobs_and_rocks_like_a_bird_and_barry_does_not() {
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
            Ch::Jackal,
            Diff::Normal,
            true,
        );
        let m = &mut g.mechs[0];
        assert_eq!(body(&SKEDADDLE, m), Body::default(), "standing, still");
        m.speed = m.max_speed;
        let (mut lo, mut hi, mut left, mut right, mut fwd, mut back) =
            (0f32, 0f32, 0f32, 0f32, 0f32, 0f32);
        for i in 0..100 {
            m.cyc = i as f32 / 100.;
            let b = body(&SKEDADDLE, m);
            (lo, hi) = (lo.min(b.bob), hi.max(b.bob));
            (left, right) = (left.max(b.sway), right.min(b.sway));
            (fwd, back) = (fwd.max(b.peck), back.min(b.peck));
            // It leans the way it rocks.
            assert!(b.sway * b.roll <= 0.);
        }
        assert!(hi - lo > 0.4, "a bob: {lo}..{hi}");
        assert!(
            left > 0.25 && right < -0.25,
            "a sway both ways: {right}..{left}"
        );
        assert!(fwd > 0.15 && back < -0.15, "a peck: {back}..{fwd}");
        assert_eq!(body(&BARRY, m), Body::default(), "BARRY walks as before");
    }
    #[test]
    fn purple_puncher_swaggers_and_rolls_without_pecking() {
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
            Ch::Puncher,
            Diff::Normal,
            true,
        );
        let m = &mut g.mechs[0];
        m.speed = m.max_speed;
        let (mut turn, mut rock) = (0f32, 0f32);
        for i in 0..100 {
            m.cyc = i as f32 / 100.;
            let b = body(&PURPLE_PUNCHER, m);
            assert_eq!(b.peck, 0., "no peck");
            assert!(b.yaw * b.sway >= 0., "the shoulders turn with the roll");
            (turn, rock) = (turn.max(b.yaw.abs()), rock.max(b.sway.abs()));
        }
        assert!(turn > 0.1 && rock > 0.2, "{turn} {rock}");
    }
    #[test]
    fn the_pods_take_the_same_jolt_out_of_step() {
        let mut a = Anim::new(&BARRY, 0.);
        a.pod[0].v = -1.;
        a.pod[1].v = -1.;
        let (mut apart, mut most) = (0f32, 0f32);
        for _ in 0..40 {
            a.pod[0].step(1. / 60., 0.);
            a.pod[1].step(1. / 60., 0.);
            apart = apart.max((a.pod[0].x - a.pod[1].x).abs());
            most = most.max(a.pod[0].x.abs());
        }
        assert!(apart > 0.3 * most, "apart {apart}, most {most}");
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
