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
    /// Toe-off and heel-strike in the air, radians.
    pub foot_roll: f32,
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
    foot_roll: 0.38,
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
/// A foot's roll now: toes down as it leaves the ground, toes up as it comes in, flat planted.
pub fn foot_roll(p: &Profile, m: &Mech, i: usize) -> f32 {
    if !m.feet[i].lifted {
        return 0.;
    }
    let sw = swing_now(m, pace(m)).max(0.05);
    let u = (m.cyc - m.geo.legs()[i].ph).rem_euclid(1.) / sw;
    if u >= 1. {
        return 0.;
    }
    p.foot_roll * (pace(m) * 2.).min(1.) * (TAU * u).sin()
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
}
