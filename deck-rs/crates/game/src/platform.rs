//! The platform: an SDL2 window with a GL 3.3 context, the Deck's pad (sticks,
//! triggers, bumpers, paddles, trackpad touch, gyro over hidapi), the keyboard
//! and mouse, and rumble. Everything SDL except audio lives here.
use crate::controls::*;
use sdl2::controller::{Axis, Button, GameController};
use sdl2::event::Event;
use sdl2::keyboard::Scancode;
use sdl2::sensor::SensorType;
use sdl2::video::{GLContext, GLProfile, Window};

pub struct Platform {
    pub sdl: sdl2::Sdl,
    pub video: sdl2::VideoSubsystem,
    pub window: Window,
    _gl: GLContext,
    ctrl: sdl2::GameControllerSubsystem,
    pad: Option<GameController>,
    gyro: bool,
    pump: sdl2::EventPump,
    last_gyro: [f32; 3],
    touch: [bool; 2],
    rumble: (u32, f32, f32),
    pub timer: sdl2::TimerSubsystem,
}
const BUTTONS: [(Pb, Button); 18] = [
    (Pb::A, Button::A),
    (Pb::B, Button::B),
    (Pb::X, Button::X),
    (Pb::Y, Button::Y),
    (Pb::Lb, Button::LeftShoulder),
    (Pb::Rb, Button::RightShoulder),
    (Pb::Back, Button::Back),
    (Pb::Start, Button::Start),
    (Pb::Ls, Button::LeftStick),
    (Pb::Rs, Button::RightStick),
    (Pb::Up, Button::DPadUp),
    (Pb::Down, Button::DPadDown),
    (Pb::Left, Button::DPadLeft),
    (Pb::Right, Button::DPadRight),
    (Pb::P1, Button::Paddle1),
    (Pb::P2, Button::Paddle2),
    (Pb::P3, Button::Paddle3),
    (Pb::P4, Button::Paddle4),
];
const KEYS: [(Key, Scancode); KEY_N] = [
    (Key::W, Scancode::W),
    (Key::S, Scancode::S),
    (Key::A, Scancode::A),
    (Key::D, Scancode::D),
    (Key::Q, Scancode::Q),
    (Key::E, Scancode::E),
    (Key::C, Scancode::C),
    (Key::R, Scancode::R),
    (Key::Z, Scancode::Z),
    (Key::X, Scancode::X),
    (Key::G, Scancode::G),
    (Key::F, Scancode::F),
    (Key::Space, Scancode::Space),
    (Key::Esc, Scancode::Escape),
    (Key::Ret, Scancode::Return),
    (Key::Up, Scancode::Up),
    (Key::Down, Scancode::Down),
    (Key::Left, Scancode::Left),
    (Key::Right, Scancode::Right),
    (Key::Tab, Scancode::Tab),
    (Key::F3, Scancode::F3),
];
impl Platform {
    pub fn new(w: u32, h: u32, fullscreen: bool) -> Result<Platform, String> {
        sdl2::hint::set("SDL_JOYSTICK_HIDAPI_STEAMDECK", "1"); // the Deck's own pad: paddles, trackpads, gyro
        let sdl = sdl2::init()?;
        let video = sdl.video()?;
        let attr = video.gl_attr();
        attr.set_context_profile(GLProfile::Core);
        attr.set_context_version(3, 3);
        attr.set_depth_size(24);
        attr.set_double_buffer(true);
        let mut wb = video.window("Stompy", w, h);
        wb.opengl().resizable().position_centered();
        if fullscreen {
            wb.fullscreen_desktop();
        }
        let window = wb.build().map_err(|e| e.to_string())?;
        let gl = window.gl_create_context()?;
        window.gl_make_current(&gl)?;
        let _ = video.gl_set_swap_interval(sdl2::video::SwapInterval::VSync); // the locked 60
        let ctrl = sdl.game_controller()?;
        let pump = sdl.event_pump()?;
        let timer = sdl.timer()?;
        let mut p = Platform {
            sdl,
            video,
            window,
            _gl: gl,
            ctrl,
            pad: None,
            gyro: false,
            pump,
            last_gyro: [0.; 3],
            touch: [false; 2],
            rumble: (0, 0., 0.),
            timer,
        };
        p.open_pad();
        Ok(p)
    }
    pub fn gl(&self) -> glow::Context {
        // SAFETY: the context is current on this thread and outlives the glow context (both live in App).
        unsafe {
            glow::Context::from_loader_function(|s| self.video.gl_get_proc_address(s) as *const _)
        }
    }
    fn open_pad(&mut self) {
        if self.pad.is_some() {
            return;
        }
        let n = self.ctrl.num_joysticks().unwrap_or(0);
        for i in 0..n {
            if !self.ctrl.is_game_controller(i) {
                continue;
            }
            let Ok(c) = self.ctrl.open(i) else { continue };
            self.gyro = c.has_sensor(SensorType::Gyroscope)
                && c.sensor_set_enabled(SensorType::Gyroscope, true).is_ok();
            println!(
                "pad: {} (gyro {}, rumble {})",
                c.name(),
                self.gyro,
                c.has_rumble()
            );
            self.pad = Some(c);
            return;
        }
    }
    pub fn has_pad(&self) -> bool {
        self.pad.is_some()
    }
    pub fn has_gyro(&self) -> bool {
        self.pad.is_some() && self.gyro
    }
    pub fn pad_name(&self) -> String {
        self.pad.as_ref().map_or("NO PAD".into(), |p| p.name())
    }
    /// The events of one frame into `raw`. Returns false to quit.
    pub fn poll(&mut self, raw: &mut Raw) -> bool {
        let (held_was, key_was, mb_was) = (raw.held, raw.key, raw.mb);
        raw.press = [false; PB_N];
        raw.key_press = [false; KEY_N];
        raw.mb_press = [false; MB_N];
        (raw.mdx, raw.mdy, raw.any_key) = (0., 0., false);
        let mut reopen = false;
        for e in self.pump.poll_iter() {
            match e {
                Event::Quit { .. } => return false,
                Event::ControllerDeviceAdded { .. } => reopen = true,
                Event::ControllerDeviceRemoved { which, .. } => {
                    if self.pad.as_ref().is_some_and(|p| p.instance_id() == which) {
                        self.pad = None;
                        reopen = true;
                    }
                }
                Event::MouseMotion { xrel, yrel, .. } => {
                    raw.mdx += xrel as f32;
                    raw.mdy += yrel as f32;
                }
                Event::KeyDown { repeat: false, .. } => raw.any_key = true,
                Event::ControllerSensorUpdated {
                    sensor: SensorType::Gyroscope,
                    data,
                    ..
                } => self.last_gyro = data,
                Event::ControllerTouchpadDown { touchpad, .. }
                | Event::ControllerTouchpadMotion { touchpad, .. } => {
                    if let Some(t) = self.touch.get_mut(touchpad as usize) {
                        *t = true;
                    }
                }
                Event::ControllerTouchpadUp { touchpad, .. } => {
                    if let Some(t) = self.touch.get_mut(touchpad as usize) {
                        *t = false;
                    }
                }
                _ => {}
            }
        }
        if reopen {
            self.open_pad();
        }
        let ks = self.pump.keyboard_state();
        for (k, sc) in KEYS {
            raw.key[k as usize] = ks.is_scancode_pressed(sc);
        }
        let ms = self.pump.mouse_state();
        raw.mb = [ms.left(), ms.right(), ms.middle(), ms.x1(), ms.x2()];
        raw.pad = self.pad.is_some();
        if let Some(c) = &self.pad {
            for (pb, b) in BUTTONS {
                raw.held[pb as usize] = c.button(b);
            }
            let ax = |a: Axis| c.axis(a) as f32 / 32767.;
            (raw.lt, raw.rt) = (ax(Axis::TriggerLeft), ax(Axis::TriggerRight));
            raw.held[Pb::Lt as usize] = raw.lt > 0.35;
            raw.held[Pb::Rt as usize] = raw.rt > 0.35;
            (raw.lx, raw.ly) = stick(ax(Axis::LeftX), ax(Axis::LeftY));
            (raw.rx, raw.ry) = stick(ax(Axis::RightX), ax(Axis::RightY));
            raw.gyro = if self.gyro {
                Some(self.last_gyro)
            } else {
                None
            };
            raw.touch = self.touch;
        } else {
            raw.held = [false; PB_N];
            (raw.lx, raw.ly, raw.rx, raw.ry, raw.lt, raw.rt) = (0., 0., 0., 0., 0., 0.);
            raw.gyro = None;
        }
        for i in 0..PB_N {
            raw.press[i] = raw.held[i] && !held_was[i];
        }
        for i in 0..KEY_N {
            raw.key_press[i] = raw.key[i] && !key_was[i];
        }
        for i in 0..MB_N {
            raw.mb_press[i] = raw.mb[i] && !mb_was[i];
        }
        // Rumble: the strongest buzz asked for wins until it runs out.
        let now = self.timer.ticks();
        if self.rumble.0 != 0 && now > self.rumble.0 {
            self.rumble = (0, 0., 0.);
            if let Some(c) = self.pad.as_mut() {
                let _ = c.set_rumble(0, 0, 0);
            }
        }
        true
    }
    pub fn rumble(&mut self, low: f32, high: f32, ms: u32) {
        let Some(c) = self.pad.as_mut() else { return };
        if ms == 0 {
            return;
        }
        let now = self.timer.ticks();
        let live = self.rumble.0 > now;
        if live && low < self.rumble.1 && high < self.rumble.2 {
            return;
        }
        let until = (now + ms).max(self.rumble.0);
        self.rumble = (
            until,
            if live { low.max(self.rumble.1) } else { low },
            if live { high.max(self.rumble.2) } else { high },
        );
        let _ = c.set_rumble(
            (self.rumble.1.clamp(0., 1.) * 65535.) as u16,
            (self.rumble.2.clamp(0., 1.) * 65535.) as u16,
            until - now,
        );
    }
    pub fn swap(&self) {
        self.window.gl_swap_window();
    }
    pub fn size(&self) -> (i32, i32) {
        let (w, h) = self.window.drawable_size();
        (w as i32, h as i32)
    }
    pub fn relative_mouse(&self, on: bool) {
        self.sdl.mouse().set_relative_mouse_mode(on);
    }
    pub fn now(&self) -> f64 {
        self.timer.performance_counter() as f64 / self.timer.performance_frequency() as f64
    }
}
