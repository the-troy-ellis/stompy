//! The game around the sim: the screens (title, campaign, free play, mech pick,
//! settings, pause, debrief), the locked-60 loop with a fixed sim step, the
//! effects the sim asks for (sound, the cockpit voice, rumble), and the settings.
use crate::audio::Audio;
use crate::controls::*;
use crate::gl::Gl;
use crate::hud::*;
use crate::platform::Platform;
use crate::scene::Scene;
use stompy_sim::data::names::*;
use stompy_sim::data::*;
use stompy_sim::geom::center_of;
use stompy_sim::math::*;
use stompy_sim::state::*;
use stompy_sim::update::update;
use stompy_sim::*;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Screen {
    Title,
    Main,
    Missions,
    Free,
    Mech,
    Settings,
    Play,
    Pause,
    Debrief,
}
/// The saved settings: a few key=value lines in ~/.config/stompy-deck/settings.txt.
#[derive(Clone)]
pub struct Prefs {
    pub pad_sens: f32,
    pub mouse_sens: f32,
    pub gyro_sens: f32,
    pub fov: f32,
    pub volume: f32,
    pub invert_y: bool,
    pub gyro: GyroMode,
    pub rumble: bool,
    pub reduced_motion: bool,
    pub hud_scale: f32,
    pub fullscreen: bool,
    pub diff: Diff,
    pub chassis: Ch,
    pub mission: Option<usize>,
    pub biome: Biome,
    pub time: TimeOfDay,
    pub foes: usize,
    pub cleared: u32,
}
impl Default for Prefs {
    fn default() -> Prefs {
        Prefs {
            pad_sens: 1.,
            mouse_sens: 1.,
            gyro_sens: 1.,
            fov: 62.,
            volume: 0.8,
            invert_y: false,
            gyro: GyroMode::RightPad,
            rumble: true,
            reduced_motion: false,
            hud_scale: 1.,
            fullscreen: true,
            diff: Diff::Normal,
            chassis: Ch::Kestrel,
            mission: Some(0),
            biome: Biome::Dusk,
            time: TimeOfDay::Dusk,
            foes: 3,
            cleared: 0,
        }
    }
}
fn prefs_path() -> std::path::PathBuf {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            std::path::PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".config")
        });
    base.join("stompy-deck").join("settings.txt")
}
fn pick<T: Copy>(all: &[T], i: f32) -> T {
    all[(i.max(0.) as usize).min(all.len() - 1)]
}
fn idx<T: PartialEq>(all: &[T], v: T) -> usize {
    all.iter().position(|x| *x == v).unwrap_or(0)
}
const GYROS: [GyroMode; 3] = [GyroMode::Off, GyroMode::RightPad, GyroMode::Always];
impl Prefs {
    pub fn load() -> Prefs {
        let mut p = Prefs::default();
        let Ok(s) = std::fs::read_to_string(prefs_path()) else {
            return p;
        };
        for line in s.lines() {
            let Some((k, v)) = line.split_once('=') else {
                continue;
            };
            let Ok(v) = v.trim().parse::<f32>() else {
                continue;
            };
            match k.trim() {
                "padSens" => p.pad_sens = v,
                "mouseSens" => p.mouse_sens = v,
                "gyroSens" => p.gyro_sens = v,
                "fov" => p.fov = v,
                "volume" => p.volume = v,
                "invertY" => p.invert_y = v != 0.,
                "gyro" => p.gyro = pick(&GYROS, v),
                "rumble" => p.rumble = v != 0.,
                "reducedMotion" => p.reduced_motion = v != 0.,
                "hudScale" => p.hud_scale = clamp(v, 0.75, 1.5),
                "fullscreen" => p.fullscreen = v != 0.,
                "diff" => p.diff = pick(Diff::ALL, v),
                "chassis" => p.chassis = pick(Ch::ALL, v),
                "mission" => {
                    p.mission = if v < 0. {
                        None
                    } else {
                        Some((v as usize).min(MISSIONS.len() - 1))
                    }
                }
                "biome" => p.biome = pick(Biome::ALL, v),
                "time" => p.time = pick(TimeOfDay::ALL, v),
                "foes" => p.foes = clamp(v, 1., 8.) as usize,
                "cleared" => p.cleared = v.max(0.) as u32,
                _ => {}
            }
        }
        p
    }
    pub fn save(&self) {
        let path = prefs_path();
        if let Some(d) = path.parent() {
            let _ = std::fs::create_dir_all(d);
        }
        let b = |v: bool| if v { 1 } else { 0 };
        let s = format!(
            "padSens={}\nmouseSens={}\ngyroSens={}\nfov={}\nvolume={}\ninvertY={}\ngyro={}\nrumble={}\nreducedMotion={}\nhudScale={}\nfullscreen={}\ndiff={}\nchassis={}\nmission={}\nbiome={}\ntime={}\nfoes={}\ncleared={}\n",
            self.pad_sens, self.mouse_sens, self.gyro_sens, self.fov, self.volume, b(self.invert_y), idx(&GYROS, self.gyro), b(self.rumble), b(self.reduced_motion),
            self.hud_scale, b(self.fullscreen), self.diff.i(), self.chassis.i(), self.mission.map_or(-1, |m| m as i32), self.biome.i(), self.time.i(), self.foes, self.cleared
        );
        let _ = std::fs::write(path, s);
    }
    fn controls(&self) -> ControlPrefs {
        ControlPrefs {
            pad_sens: self.pad_sens,
            mouse_sens: self.mouse_sens,
            gyro_sens: self.gyro_sens,
            invert_y: self.invert_y,
            gyro: self.gyro,
        }
    }
}

pub struct Args {
    pub w: u32,
    pub h: u32,
    pub fullscreen: Option<bool>,
    pub free: bool,
    pub seed: u32,
    pub shot: Option<(u64, String)>,
    pub skip: f32,
    pub demo: bool,
    pub debug: bool,
    pub screen: Option<Screen>,
    pub mech: Option<usize>,
}
/// A line the cockpit voice will say, and when.
struct Line {
    at: f64,
    text: String,
    force: bool,
}
pub struct App {
    plat: Platform,
    gl: Gl,
    audio: Audio,
    scene: Scene,
    hud: Hud,
    g: Game,
    menu: Game,
    menu_ch: Option<Ch>,
    prefs: Prefs,
    raw: Raw,
    raw_was: Raw,
    screen: Screen,
    sel: usize,
    t: f32,
    spin: f32,
    said: Vec<(String, f64)>,
    last_said: f64,
    queue: Vec<Line>,
    fps: f32,
    debug: bool,
    demo: bool,
    shot: Option<(u64, String)>,
    frame: u64,
    quit: bool,
    tool_run: bool,
}

// --- the sim's events, carried out -------------------------------------------------------------------
impl App {
    fn say(&mut self, text: String, force: bool) {
        let now = self.plat.now();
        let last = self.said.iter().find(|(t, _)| *t == text).map(|s| s.1);
        // Each line at most every 6 s, and never on top of another.
        if !force && (last.is_some_and(|t| now - t < 6.) || now - self.last_said < 1.2) {
            return;
        }
        self.said.retain(|(t, _)| *t != text);
        self.said.push((text.clone(), now));
        self.last_said = now;
        let warn = text.starts_with("Warning");
        effects_msg(&mut self.g, &text, warn);
        self.audio.chirp();
    }
    fn events(&mut self) {
        let now = self.plat.now();
        for e in std::mem::take(&mut self.g.events) {
            match e {
                Event::Say { line, force, delay } => {
                    if delay > 0. {
                        self.queue.push(Line {
                            at: now + delay as f64 / 1000.,
                            text: line,
                            force,
                        });
                    } else {
                        self.say(line, force);
                    }
                }
                Event::Sfx { sfx, at } => self.audio.sfx(sfx, at),
                Event::Thump {
                    bass,
                    duck,
                    haptic,
                    at,
                } => {
                    self.audio.thump(bass, duck, at);
                    if haptic > 2. && self.prefs.rumble {
                        // The low motor from the bass, the high from the haptic column, for its milliseconds.
                        self.plat.rumble(
                            clamp(bass, 0., 1.),
                            clamp(haptic / 100., 0., 1.) * 0.6,
                            haptic as u32,
                        );
                    }
                }
                Event::FusionSound { on, p } => self.audio.fusion(on, p),
            }
        }
        let due: Vec<Line> = {
            let (due, keep): (Vec<Line>, Vec<Line>) = std::mem::take(&mut self.queue)
                .into_iter()
                .partition(|l| l.at <= now);
            self.queue = keep;
            due
        };
        for l in due {
            self.say(l.text, l.force);
        }
    }
}
fn effects_msg(g: &mut Game, text: &str, warn: bool) {
    stompy_sim::effects::msg(g, text, warn);
}

// --- the screens --------------------------------------------------------------------------------------
fn unlocked(p: &Prefs, ch: Ch) -> bool {
    chassis(ch).unlock <= p.cleared
}
impl App {
    fn click(&mut self) {
        self.audio.click();
        if self.prefs.rumble {
            self.plat.rumble(0.3, 0., 30);
        }
    }
    fn start(&mut self) {
        let seed = (self.plat.now() * 7919.) as u32 + 13;
        self.g.reduced_motion = self.prefs.reduced_motion;
        match self.prefs.mission {
            Some(m) => start_mission(&mut self.g, m, self.prefs.chassis, self.prefs.diff, false),
            None => start_free_play(
                &mut self.g,
                self.prefs.biome,
                self.prefs.time,
                Weather::Clear,
                self.prefs.foes,
                seed,
                self.prefs.chassis,
                self.prefs.diff,
                false,
            ),
        }
        self.screen = Screen::Play;
        self.plat.relative_mouse(true);
    }
    fn rows(&mut self, rows: &[(&str, String)], x: f32, y: f32, s: f32) {
        for (i, (label, value)) in rows.iter().enumerate() {
            let c = if i == self.sel { WHITE } else { GREEN };
            let yy = y + i as f32 * 24. * s;
            if i == self.sel {
                self.hud.text(x - 20. * s, yy, 2.2 * s, ">", AMBER);
            }
            self.hud.text(x, yy, 2.2 * s, label, c);
            if !value.is_empty() {
                self.hud.text(x + 260. * s, yy, 2.2 * s, value, c);
            }
        }
    }
    fn nav(&mut self, m: &MenuPress, n: usize) {
        if m.up {
            self.sel = (self.sel + n - 1) % n;
            self.click();
        }
        if m.down {
            self.sel = (self.sel + 1) % n;
            self.click();
        }
    }
    fn screens(&mut self, m: &MenuPress, dt: f32) {
        let (w, h) = (self.hud.w, self.hud.h);
        let (s, cx) = (h / 800., w / 2.);
        self.t += dt;
        let d = (m.right as i32 - m.left as i32) as f32;
        match self.screen {
            Screen::Title => {
                self.hud.text_c(cx, 120. * s, 9. * s, "STOMPY", GREEN);
                self.hud
                    .text_c(cx, 200. * s, 2.5 * s, "BIG MECHS. THEY STOMP.", DIM);
                if self.t % 1. < 0.6 {
                    self.hud.text_c(
                        cx,
                        h - 90. * s,
                        2.5 * s,
                        if self.plat.has_pad() {
                            "PRESS A"
                        } else {
                            "PRESS ENTER"
                        },
                        AMBER,
                    );
                }
                if m.accept || m.any {
                    self.screen = Screen::Main;
                    self.sel = 0;
                    self.click();
                }
            }
            Screen::Main => {
                self.hud.text_c(cx, 70. * s, 6. * s, "STOMPY", GREEN);
                let rows = [
                    ("CAMPAIGN", String::new()),
                    ("FREE PLAY", String::new()),
                    ("SETTINGS", String::new()),
                    ("QUIT", String::new()),
                ];
                self.rows(&rows, 80. * s, 200. * s, s);
                self.nav(m, 4);
                let pad = self.plat.pad_name().to_uppercase();
                self.hud.text(80. * s, h - 60. * s, 1.8 * s, &pad, DIM);
                if m.accept {
                    self.click();
                    match self.sel {
                        0 => {
                            (self.screen, self.sel) =
                                (Screen::Missions, self.prefs.mission.unwrap_or(0))
                        }
                        1 => (self.screen, self.sel) = (Screen::Free, 0),
                        2 => (self.screen, self.sel) = (Screen::Settings, 0),
                        _ => self.quit = true,
                    }
                }
            }
            Screen::Missions => {
                self.hud.text(80. * s, 70. * s, 3. * s, "ACT I", DIM);
                for (i, mi) in MISSIONS.iter().enumerate() {
                    let yy = 120. * s + i as f32 * 26. * s;
                    let open = i as u32 <= self.prefs.cleared;
                    let c = if !mi.playable || !open {
                        DIM
                    } else if i == self.sel {
                        WHITE
                    } else {
                        GREEN
                    };
                    if i == self.sel {
                        self.hud.text(60. * s, yy, 2.2 * s, ">", AMBER);
                    }
                    let tag = if !mi.playable {
                        "  (SOON)"
                    } else if !open {
                        "  (LOCKED)"
                    } else if (i as u32) < self.prefs.cleared {
                        "  DONE"
                    } else {
                        ""
                    };
                    self.hud.text(
                        80. * s,
                        yy,
                        2.2 * s,
                        &format!("{}  {}{}", i + 1, MISSION_NAMES[i], tag),
                        c,
                    );
                }
                self.hud.text(
                    80. * s,
                    260. * s,
                    2. * s,
                    &MISSIONS[self.sel].intel.to_uppercase(),
                    GREEN,
                );
                self.nav(m, MISSIONS.len());
                if m.accept && MISSIONS[self.sel].playable && self.sel as u32 <= self.prefs.cleared
                {
                    self.click();
                    self.prefs.mission = Some(self.sel);
                    self.screen = Screen::Mech;
                    self.sel = idx(&MECH_ORDER, self.prefs.chassis);
                }
                if m.back {
                    (self.screen, self.sel) = (Screen::Main, 0);
                }
            }
            Screen::Free => {
                let p = &self.prefs;
                let rows = [
                    ("PLACE", biome_name(p.biome).into()),
                    ("TIME", time_name(p.time).into()),
                    ("ENEMIES", p.foes.to_string()),
                    ("DIFFICULTY", diff_label(p.diff).into()),
                    ("GO", String::new()),
                ];
                self.hud.text(80. * s, 70. * s, 3. * s, "FREE PLAY", DIM);
                self.rows(&rows, 80. * s, 140. * s, s);
                self.nav(m, 5);
                if d != 0. {
                    self.click();
                    let p = &mut self.prefs;
                    let step =
                        |i: usize, n: usize| ((i as i32 + d as i32).rem_euclid(n as i32)) as usize;
                    match self.sel {
                        0 => p.biome = Biome::ALL[step(p.biome.i(), Biome::N)],
                        1 => p.time = TimeOfDay::ALL[step(p.time.i(), TimeOfDay::N)],
                        2 => p.foes = clamp(p.foes as f32 + d, 1., 8.) as usize,
                        3 => p.diff = Diff::ALL[step(p.diff.i(), Diff::N)],
                        _ => {}
                    }
                }
                if m.accept && self.sel == 4 {
                    self.click();
                    self.prefs.mission = None;
                    self.screen = Screen::Mech;
                    self.sel = idx(&MECH_ORDER, self.prefs.chassis);
                }
                if m.back {
                    (self.screen, self.sel) = (Screen::Main, 1);
                }
            }
            Screen::Mech => {
                let ch = MECH_ORDER[self.sel];
                let c = chassis(ch);
                let open = unlocked(&self.prefs, ch);
                self.hud.text(80. * s, 70. * s, 3. * s, "PICK A MECH", DIM);
                self.hud.text(
                    80. * s,
                    120. * s,
                    4. * s,
                    if open { chassis_name(ch) } else { "LOCKED" },
                    if open { WHITE } else { RED },
                );
                self.hud
                    .text(80. * s, 170. * s, 2.2 * s, chassis_role(ch), GREEN);
                if open {
                    self.hud
                        .text(80. * s, 200. * s, 1.8 * s, chassis_kit(ch), DIM);
                } else {
                    self.hud.text(
                        80. * s,
                        200. * s,
                        1.8 * s,
                        &format!("CLEAR MISSION {}", c.unlock),
                        DIM,
                    );
                }
                let stats = format!(
                    "{} T   {} KPH   {}",
                    c.tons,
                    (c.speed * 3.6) as i32,
                    if c.jets > 0 { "JETS" } else { "NO JETS" }
                );
                self.hud.text(80. * s, 230. * s, 1.8 * s, &stats, DIM);
                self.hud.text_c(
                    cx,
                    h - 60. * s,
                    2. * s,
                    "LEFT / RIGHT PICK    A LAUNCH    B BACK",
                    DIM,
                );
                if d != 0. {
                    self.sel = ((self.sel as i32 + d as i32).rem_euclid(Ch::N as i32)) as usize;
                    self.click();
                }
                if m.accept && open {
                    self.click();
                    self.prefs.chassis = ch;
                    if !self.tool_run {
                        self.prefs.save();
                    }
                    self.start();
                }
                if m.back {
                    self.screen = if self.prefs.mission.is_some() {
                        Screen::Missions
                    } else {
                        Screen::Free
                    };
                    self.sel = 0;
                }
            }
            Screen::Settings => {
                let p = &self.prefs;
                let on = |b: bool| if b { "ON" } else { "OFF" }.to_string();
                let rows = [
                    ("PAD SENS", format!("{:.1}X", p.pad_sens)),
                    (
                        "GYRO",
                        ["OFF", "RIGHT PAD", "ALWAYS"][idx(&GYROS, p.gyro)].into(),
                    ),
                    ("GYRO SENS", format!("{:.1}X", p.gyro_sens)),
                    ("MOUSE SENS", format!("{:.1}X", p.mouse_sens)),
                    ("INVERT Y", on(p.invert_y)),
                    ("FOV", format!("{}", p.fov as i32)),
                    ("HUD SCALE", format!("{:.2}X", p.hud_scale)),
                    ("VOLUME", format!("{}%", (p.volume * 100.).round() as i32)),
                    ("RUMBLE", on(p.rumble)),
                    ("REDUCED MOTION", on(p.reduced_motion)),
                    ("FULLSCREEN", format!("{} (NEXT START)", on(p.fullscreen))),
                ];
                self.hud.text(80. * s, 70. * s, 3. * s, "SETTINGS", DIM);
                self.rows(&rows, 80. * s, 120. * s, s);
                self.nav(m, rows.len());
                if d != 0. {
                    self.click();
                    let p = &mut self.prefs;
                    match self.sel {
                        0 => p.pad_sens = clamp(p.pad_sens + d * 0.1, 0.3, 2.5),
                        1 => {
                            p.gyro = GYROS
                                [((idx(&GYROS, p.gyro) as i32 + d as i32).rem_euclid(3)) as usize]
                        }
                        2 => p.gyro_sens = clamp(p.gyro_sens + d * 0.1, 0.3, 2.5),
                        3 => p.mouse_sens = clamp(p.mouse_sens + d * 0.1, 0.3, 2.5),
                        4 => p.invert_y = !p.invert_y,
                        5 => p.fov = clamp(p.fov + d * 5., 50., 95.),
                        6 => p.hud_scale = clamp(p.hud_scale + d * 0.25, 0.75, 1.5),
                        7 => p.volume = clamp(p.volume + d * 0.1, 0., 1.),
                        8 => p.rumble = !p.rumble,
                        9 => p.reduced_motion = !p.reduced_motion,
                        _ => p.fullscreen = !p.fullscreen,
                    }
                    let v = self.prefs.volume;
                    self.audio.set_volume(v);
                }
                self.hud.text(
                    80. * s,
                    h - 60. * s,
                    1.8 * s,
                    if self.plat.has_gyro() {
                        "GYRO FOUND"
                    } else {
                        "NO GYRO ON THIS PAD"
                    },
                    DIM,
                );
                if m.back {
                    if !self.tool_run {
                        self.prefs.save();
                    }
                    (self.screen, self.sel) = (Screen::Main, 2);
                }
            }
            Screen::Pause => {
                self.hud.rect(0., 0., w, h, BLACK);
                self.hud.flush(&mut self.gl, 0.5);
                self.hud.text_c(cx, 160. * s, 4. * s, "PAUSED", GREEN);
                let rows = [
                    ("RESUME", String::new()),
                    ("RESTART", String::new()),
                    ("MAIN MENU", String::new()),
                ];
                self.rows(&rows, cx - 100. * s, 260. * s, s);
                self.nav(m, 3);
                if m.accept {
                    self.click();
                    match self.sel {
                        0 => self.resume(),
                        1 => self.start(),
                        _ => (self.screen, self.sel) = (Screen::Main, 0),
                    }
                } else if m.back || m.pause {
                    self.resume();
                }
            }
            Screen::Debrief => {
                self.hud.rect(0., 0., w, h, BLACK);
                self.hud.flush(&mut self.gl, 0.5);
                let g = &self.g;
                let next = g.won && self.prefs.mission.is_some_and(|mi| mi + 1 < MISSIONS.len());
                self.hud.text_c(
                    cx,
                    120. * s,
                    6. * s,
                    verdict(g.verdict()),
                    if g.won { GREEN } else { RED },
                );
                let line = format!(
                    "KILLS {}   HITS {} / {}   DEALT {}   TAKEN {}   TIME {}:{:02}",
                    g.stats.kills,
                    g.stats.hits as i32,
                    g.stats.shots as i32,
                    g.stats.dealt as i32,
                    g.stats.taken as i32,
                    g.time as i32 / 60,
                    g.time as i32 % 60
                );
                self.hud.text_c(cx, 210. * s, 2. * s, &line, GREEN);
                if g.farthest_shove > 0. {
                    let t = format!("FARTHEST SHOVE {} M", (g.farthest_shove / 2.5) as i32);
                    self.hud.text_c(cx, 240. * s, 2. * s, &t, DIM);
                }
                let rows = [
                    (if next { "NEXT MISSION" } else { "AGAIN" }, String::new()),
                    ("REPLAY", String::new()),
                    ("MAIN MENU", String::new()),
                ];
                self.rows(&rows, cx - 100. * s, 300. * s, s);
                self.nav(m, 3);
                if m.accept {
                    self.click();
                    match self.sel {
                        2 => (self.screen, self.sel) = (Screen::Main, 0),
                        1 => self.start(),
                        _ => {
                            if next {
                                let n = self.prefs.mission.unwrap() + 1;
                                self.prefs.mission = Some(n);
                                if !MISSIONS[n].playable {
                                    (self.screen, self.sel) = (Screen::Missions, n);
                                    return;
                                }
                            }
                            self.start();
                        }
                    }
                }
            }
            Screen::Play => {}
        }
    }
    fn resume(&mut self) {
        self.screen = Screen::Play;
        self.plat.relative_mouse(true);
    }
}

// --- the loop -------------------------------------------------------------------------------------------
/// A pilot for the tools' screenshots: walks at the nearest foe, aims the torso at it, fires what's in range.
fn demo_pilot(g: &mut Game, i: &mut Input) {
    let p = g.p();
    let Some((t, d)) = g
        .mechs
        .iter()
        .enumerate()
        .skip(1)
        .filter(|(_, m)| m.alive)
        .map(|(k, m)| (k, hypot2(m.x - p.x, m.z - p.z)))
        .min_by(|a, b| a.1.total_cmp(&b.1))
    else {
        return;
    };
    g.target = Some(t);
    let (c, e) = (center_of(&g.mechs[t]), g.eye);
    let (want, wp) = (
        (c.x - e.x).atan2(c.z - e.z),
        (c.y - e.y).atan2(hypot2(c.x - e.x, c.z - e.z)),
    );
    let p = g.p();
    i.turn = clamp(wrap(want - p.yaw) * 2., -1., 1.);
    i.thr = if d > 150. { 0.6 } else { 0. };
    i.twist_by = wrap(want - p.view_yaw()) * 0.2;
    i.pitch_by = (wp - p.pitch) * 0.2;
    i.energy = d < 400. && p.heat < 70.;
    i.ballistic = d < 500.;
    i.missile_tap = d < 700. && g.time % 5. < 0.02;
}
fn save_ppm(path: &str, w: i32, h: i32, rgb: &[u8]) {
    let mut out = format!("P6\n{w} {h}\n255\n").into_bytes();
    out.extend_from_slice(rgb);
    if let Err(e) = std::fs::write(path, out) {
        eprintln!("shot: {e}");
    }
}
impl App {
    pub fn new(a: Args) -> Result<App, String> {
        let mut prefs = Prefs::load();
        if let Some(f) = a.fullscreen {
            prefs.fullscreen = f;
        }
        let plat = Platform::new(a.w, a.h, prefs.fullscreen)?;
        let gl = Gl::new(plat.gl())?;
        let audio = Audio::new(&plat.sdl, prefs.volume);
        let scene = Scene::new(&gl);
        let mut app = App {
            plat,
            gl,
            audio,
            scene,
            hud: Hud::default(),
            g: Game::new(1),
            menu: Game::new(5),
            menu_ch: None,
            prefs,
            raw: Raw::default(),
            raw_was: Raw::default(),
            screen: a.screen.unwrap_or(Screen::Title),
            sel: 0,
            t: 0.,
            spin: 0.,
            said: vec![],
            last_said: -10.,
            queue: vec![],
            fps: 60.,
            debug: a.debug,
            demo: a.demo,
            tool_run: a.shot.is_some(),
            shot: a.shot,
            frame: 0,
            quit: false,
        };
        if let Some(k) = a.mech {
            app.sel = k % Ch::N;
            app.prefs.chassis = MECH_ORDER[app.sel];
        }
        if a.free {
            app.prefs.mission = None;
            let seed = if a.seed != 0 { a.seed } else { 7 };
            start_free_play(
                &mut app.g,
                app.prefs.biome,
                app.prefs.time,
                Weather::Clear,
                app.prefs.foes,
                seed,
                app.prefs.chassis,
                app.prefs.diff,
                false,
            );
            app.screen = Screen::Play;
            let mut t = 0.;
            while t < a.skip {
                let mut i = Input::default();
                if app.demo {
                    demo_pilot(&mut app.g, &mut i);
                }
                update(&mut app.g, &i, 1. / 60.);
                app.g.events.clear();
                t += 1. / 60.;
            }
        }
        Ok(app)
    }
    pub fn run(&mut self) {
        let mut last = self.plat.now();
        let mut acc = 0.;
        const STEP: f64 = 1. / 60.;
        while !self.quit {
            self.raw_was = self.raw.clone();
            if !self.plat.poll(&mut self.raw) {
                break;
            }
            let (w, h) = self.plat.size();
            let now = self.plat.now();
            let dt = (now - last).min(0.1); // a hitch never becomes a leap
            last = now;
            self.fps += ((1. / dt.max(1e-4)) as f32 - self.fps) * 0.05;
            let m = to_menu(&self.raw, &self.raw_was);
            if m.debug {
                self.debug = !self.debug;
            }
            if self.screen == Screen::Play {
                if m.pause {
                    (self.screen, self.sel) = (Screen::Pause, 0);
                    self.plat.relative_mouse(false);
                }
                let mut i = to_input(&self.raw, &self.prefs.controls(), dt as f32);
                if self.demo {
                    demo_pilot(&mut self.g, &mut i);
                }
                if zoom_pressed(&self.raw) {
                    self.g.zoom = !self.g.zoom;
                }
                acc += dt;
                let mut n = 0;
                // A fixed 1/60 step, up to four after a hitch; presses count on the first step only.
                while acc >= STEP && n < 4 {
                    update(&mut self.g, &i, STEP as f32);
                    acc -= STEP;
                    n += 1;
                    (
                        i.punch,
                        i.target,
                        i.stop,
                        i.missile_tap,
                        i.twist_by,
                        i.pitch_by,
                    ) = (false, false, false, false, 0., 0.);
                }
                let p = self.g.p();
                self.audio.listener(self.g.eye, p.view_yaw());
                if p.jet.charge > 0. && self.prefs.rumble {
                    let c = p.jet.charge;
                    self.plat.rumble(0.15 * c, 0.1, 40); // charging the jets hums in the hands
                }
                if self.g.state == State::Debrief {
                    (self.screen, self.sel) = (Screen::Debrief, 0);
                    self.plat.relative_mouse(false);
                    if self.g.won {
                        if let Some(mi) = self.prefs.mission {
                            if mi as u32 + 1 > self.prefs.cleared {
                                self.prefs.cleared = mi as u32 + 1;
                                if !self.tool_run {
                                    self.prefs.save();
                                }
                            }
                        }
                    }
                }
                self.events();
            } else {
                acc = 0.;
                self.g.events.clear();
            }
            let in_match = matches!(self.screen, Screen::Play | Screen::Pause | Screen::Debrief);
            self.audio.tick(if in_match { Some(&self.g) } else { None });
            self.hud.begin(w, h);
            if in_match {
                let vp = self
                    .scene
                    .render(&mut self.gl, &self.g, self.prefs.fov, w, h, None);
                let o = HudOpts {
                    scale: self.prefs.hud_scale,
                    debug: self.debug,
                    fps: self.fps,
                    draws: self.gl.draws,
                    pad: self.plat.has_pad(),
                };
                draw_hud(&mut self.hud, &mut self.gl, &self.g, &vp, &o);
            } else {
                // The menu's turntable: the chosen mech on the desert, turning.
                let ch = if self.screen == Screen::Mech {
                    MECH_ORDER[self.sel]
                } else {
                    self.prefs.chassis
                };
                if self.menu_ch != Some(ch) {
                    start_free_play(
                        &mut self.menu,
                        Biome::Dusk,
                        TimeOfDay::Dusk,
                        Weather::Clear,
                        0,
                        5,
                        ch,
                        Diff::Normal,
                        false,
                    );
                    self.menu_ch = Some(ch);
                }
                self.spin += dt as f32 * 0.35;
                update(&mut self.menu, &Input::default(), 1. / 60.);
                self.menu.events.clear();
                let spin = self.spin;
                let pm = self.menu.pm();
                pm.yaw = spin;
                pm.twist = (spin * 0.7).sin() * 0.3;
                self.scene.turntable(
                    &mut self.gl,
                    &self.menu,
                    w,
                    h,
                    if self.screen == Screen::Mech { 0. } else { -1. },
                );
            }
            if self.screen != Screen::Play {
                self.screens(&m, dt as f32);
            }
            self.hud.flush(&mut self.gl, 1.);
            self.plat.swap();
            self.frame += 1;
            if let Some((n, path)) = &self.shot {
                if self.frame >= *n {
                    let px = self.gl.read_pixels(w, h);
                    save_ppm(path, w, h, &px);
                    break;
                }
            }
        }
        if !self.tool_run {
            self.prefs.save();
        }
    }
}
