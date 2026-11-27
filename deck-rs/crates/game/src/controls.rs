//! The raw state of the pad, keys and mouse into the sim's input and the menus'
//! presses. Pure: no SDL here, so the mapping is tested.
//!
//! Steam Deck layout (docs/controls.md):
//!   Left stick    legs: sideways turns, up and down nudges the throttle
//!   Right stick   torso twist and pitch (and steers a guided volley)
//!   Gyro          fine aim, while a finger rests on the right trackpad
//!   RT energy, RB ballistic, LT missiles (tap fires, hold flies them), LB the OOPS BUTTON
//!   A jump (hold to charge, let go to blast off), B centre the torso, X next target, Y zoom
//!   R4 and L4 punch, R5 centre the torso, L5 full stop; the right stick's click punches too
//!   D-pad down full stop, Start or View pause
use stompy_sim::math::*;
use stompy_sim::Input;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Pb {
    A,
    B,
    X,
    Y,
    Lb,
    Rb,
    Back,
    Start,
    Ls,
    Rs,
    Up,
    Down,
    Left,
    Right,
    P1,
    P2,
    P3,
    P4,
    Lt,
    Rt,
}
pub const PB_N: usize = 20;
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Key {
    W,
    S,
    A,
    D,
    Q,
    E,
    C,
    R,
    Z,
    X,
    G,
    F,
    Space,
    Esc,
    Ret,
    Up,
    Down,
    Left,
    Right,
    Tab,
    F3,
}
pub const KEY_N: usize = 21;
/// Mouse buttons, in `Raw::mb`'s order (X2 is read but not yet bound).
#[allow(dead_code)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mb {
    L,
    R,
    M,
    X1,
    X2,
}
pub const MB_N: usize = 5;
/// One frame of raw input: what is held, what went down this frame, the analog parts.
#[derive(Clone, Debug, Default)]
pub struct Raw {
    pub pad: bool,
    pub held: [bool; PB_N],
    pub press: [bool; PB_N],
    /// Sticks after the dead zone (-1..1, +y down), triggers 0..1.
    pub lx: f32,
    pub ly: f32,
    pub rx: f32,
    pub ry: f32,
    pub lt: f32,
    pub rt: f32,
    pub gyro: Option<[f32; 3]>,
    /// A finger on the left and right trackpads.
    pub touch: [bool; 2],
    pub key: [bool; KEY_N],
    pub key_press: [bool; KEY_N],
    pub mb: [bool; MB_N],
    pub mb_press: [bool; MB_N],
    pub mdx: f32,
    pub mdy: f32,
    pub any_key: bool,
}
impl Raw {
    pub fn h(&self, b: Pb) -> bool {
        self.held[b as usize]
    }
    pub fn p(&self, b: Pb) -> bool {
        self.press[b as usize]
    }
    pub fn k(&self, k: Key) -> bool {
        self.key[k as usize]
    }
    pub fn kp(&self, k: Key) -> bool {
        self.key_press[k as usize]
    }
    /// Anything at all moved or was pressed on the pad.
    pub fn pad_active(&self) -> bool {
        self.held.iter().any(|&b| b)
            || self.lx != 0.
            || self.ly != 0.
            || self.rx != 0.
            || self.ry != 0.
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GyroMode {
    Off,
    /// On while a finger rests on the right trackpad: the Deck can be set down without the aim wandering.
    RightPad,
    Always,
}
#[derive(Clone, Copy, Debug)]
pub struct ControlPrefs {
    pub pad_sens: f32,
    pub mouse_sens: f32,
    pub gyro_sens: f32,
    pub invert_y: bool,
    pub gyro: GyroMode,
}
/// A stick with a round dead zone (worn sticks rest off centre), rescaled so just past it is just above zero.
pub fn stick(x: f32, y: f32) -> (f32, f32) {
    const DEAD: f32 = 0.2;
    let m = hypot2(x, y);
    if !(m > DEAD) {
        return (0., 0.);
    }
    let k = ((m - DEAD) / (1. - DEAD)).min(1.) / m;
    (x * k, y * k)
}
/// Aim wants fine control near the centre and speed at the edge.
fn curve(v: f32) -> f32 {
    sign(v) * v * v
}
fn b(v: bool) -> f32 {
    if v {
        1.
    } else {
        0.
    }
}
pub fn to_input(r: &Raw, p: &ControlPrefs, dt: f32) -> Input {
    let inv = if p.invert_y { -1. } else { 1. };
    let mut i = Input {
        turn: -r.lx + b(r.k(Key::A)) - b(r.k(Key::D)),
        thr: -r.ly + b(r.k(Key::W)) - b(r.k(Key::S)),
        twist: -curve(r.rx) * p.pad_sens + b(r.k(Key::Left)) - b(r.k(Key::Right)),
        pitch: -curve(r.ry) * p.pad_sens * inv + b(r.k(Key::Up)) - b(r.k(Key::Down)),
        twist_by: -r.mdx * 0.0022 * p.mouse_sens,
        pitch_by: -r.mdy * 0.0022 * p.mouse_sens * inv,
        energy: r.h(Pb::Rt) || r.mb[Mb::L as usize],
        ballistic: r.h(Pb::Rb) || r.mb[Mb::R as usize],
        missile: r.h(Pb::Lt) || r.mb[Mb::M as usize] || r.k(Key::F),
        fusion: r.h(Pb::Lb) || r.k(Key::G),
        jets: r.h(Pb::A) || r.k(Key::Space),
        centre: r.h(Pb::B) || r.h(Pb::P3) || r.k(Key::C),
        target: r.p(Pb::X) || r.kp(Key::R),
        stop: r.p(Pb::Down) || r.p(Pb::P4) || r.kp(Key::X),
        punch: r.p(Pb::Rs)
            || r.p(Pb::P1)
            || r.p(Pb::P2)
            || r.kp(Key::E)
            || r.mb_press[Mb::X1 as usize],
        missile_tap: false,
    };
    // The gyro: rad/s about the pad's axes. Held flat, the vertical axis (y) turns, the sideways one (x) pitches.
    if let Some(gy) = r.gyro {
        if p.gyro == GyroMode::Always || (p.gyro == GyroMode::RightPad && r.touch[1]) {
            i.twist_by += gy[1] * dt * p.gyro_sens;
            i.pitch_by += gy[0] * dt * p.gyro_sens * inv;
        }
    }
    (i.turn, i.thr, i.twist, i.pitch) = (
        clamp(i.turn, -1., 1.),
        clamp(i.thr, -1., 1.),
        clamp(i.twist, -1., 1.),
        clamp(i.pitch, -1., 1.),
    );
    i
}
/// Zoom is a toggle, outside the sim.
pub fn zoom_pressed(r: &Raw) -> bool {
    r.p(Pb::Y) || r.kp(Key::Z)
}
#[derive(Clone, Copy, Debug, Default)]
pub struct MenuPress {
    pub up: bool,
    pub down: bool,
    pub left: bool,
    pub right: bool,
    pub accept: bool,
    pub back: bool,
    pub pause: bool,
    pub debug: bool,
    pub any: bool,
}
/// The menus: the D-pad, the left stick (flicked past 0.6) or the keys move; A, Enter or a click picks; B or Escape backs.
pub fn to_menu(r: &Raw, was: &Raw) -> MenuPress {
    let flick = |now: f32, before: f32, dir: f32| now * dir > 0.6 && before * dir <= 0.6;
    MenuPress {
        up: r.p(Pb::Up) || r.kp(Key::Up) || r.kp(Key::W) || flick(r.ly, was.ly, -1.),
        down: r.p(Pb::Down) || r.kp(Key::Down) || r.kp(Key::S) || flick(r.ly, was.ly, 1.),
        left: r.p(Pb::Left) || r.kp(Key::Left) || r.kp(Key::A) || flick(r.lx, was.lx, -1.),
        right: r.p(Pb::Right) || r.kp(Key::Right) || r.kp(Key::D) || flick(r.lx, was.lx, 1.),
        accept: r.p(Pb::A) || r.kp(Key::Ret) || r.kp(Key::Space) || r.mb_press[Mb::L as usize],
        back: r.p(Pb::B) || r.kp(Key::Esc),
        pause: r.p(Pb::Start) || r.p(Pb::Back) || r.kp(Key::Esc),
        debug: r.kp(Key::F3) || (r.h(Pb::Back) && r.p(Pb::Y)),
        any: r.any_key || r.pad_active() || r.mb_press[Mb::L as usize],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const P: ControlPrefs = ControlPrefs {
        pad_sens: 1.,
        mouse_sens: 1.,
        gyro_sens: 1.,
        invert_y: false,
        gyro: GyroMode::RightPad,
    };
    fn raw() -> Raw {
        Raw::default()
    }
    #[test]
    fn sticks_have_a_round_dead_zone() {
        assert_eq!(stick(0.15, 0.1), (0., 0.));
        let (x, _) = stick(0.21, 0.);
        assert!(x > 0. && x < 0.02);
        let (x, y) = stick(1., 1.);
        assert!((hypot2(x, y) - 1.).abs() < 1e-5, "full tilt is full speed");
    }
    #[test]
    fn the_deck_layout() {
        let mut r = raw();
        (r.lx, r.ly, r.rx) = (-1., -1., 0.5);
        for b in [Pb::Rt, Pb::Rb, Pb::Lt, Pb::Lb, Pb::A, Pb::P3] {
            r.held[b as usize] = true;
        }
        for b in [Pb::P1, Pb::X, Pb::P4] {
            r.press[b as usize] = true;
        }
        let i = to_input(&r, &P, 1. / 60.);
        assert!(i.turn == 1. && i.thr == 1., "left stick: legs and throttle");
        assert!(i.twist < 0. && i.twist > -0.5, "right stick, curved");
        assert!(i.energy && i.ballistic && i.missile && i.fusion && i.jets && i.centre);
        assert!(
            i.punch && i.target && i.stop,
            "R4 punches, X targets, L5 stops"
        );
    }
    #[test]
    fn the_gyro_aims_only_with_a_finger_on_the_right_pad() {
        let mut r = raw();
        r.gyro = Some([1., 2., 0.]);
        assert_eq!(to_input(&r, &P, 0.5).twist_by, 0.);
        r.touch[1] = true;
        let i = to_input(&r, &P, 0.5);
        assert!((i.twist_by - 1.).abs() < 1e-6 && (i.pitch_by - 0.5).abs() < 1e-6);
        let always = ControlPrefs {
            gyro: GyroMode::Always,
            ..P
        };
        r.touch[1] = false;
        assert!(to_input(&r, &always, 0.5).twist_by > 0.);
    }
    #[test]
    fn keyboard_and_mouse_second() {
        let mut r = raw();
        r.key[Key::W as usize] = true;
        r.key[Key::A as usize] = true;
        r.key_press[Key::E as usize] = true;
        r.mb[Mb::L as usize] = true;
        r.mdx = 100.;
        let i = to_input(&r, &P, 1. / 60.);
        assert!(i.thr == 1. && i.turn == 1. && i.punch && i.energy && i.twist_by < 0.);
    }
    #[test]
    fn menus_flick_the_stick_once() {
        let mut r = raw();
        r.ly = -0.9;
        assert!(to_menu(&r, &raw()).up);
        assert!(!to_menu(&r, &r.clone()).up, "held: no repeat");
    }
}
