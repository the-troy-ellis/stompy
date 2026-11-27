//! The whole game state in one struct, the input snapshot it takes, and the
//! events it emits. Mechs are referred to by index into `Game::mechs`; the
//! player is always index 0, and a mech stays in the list for the whole match
//! (the dead become wrecks), so an index is good for the match.
use crate::data::names::Verdict;
use crate::data::*;
use crate::math::*;
use crate::rng::Rng;
use crate::spring::Spring;
use crate::terrain::Terrain;

pub type MechId = usize;
pub const PLAYER: MechId = 0;
pub const MAX_MECHS: usize = 24;
pub const MAX_SHOTS: usize = 256;
pub const MAX_PARTS: usize = 4000;
pub const MAX_DEBRIS: usize = 40;
pub const MAX_WRECKS: usize = 24;
pub const MAX_SCORCH: usize = 64;
pub const MAX_MSGS: usize = 4;

/// One frame of controls. Rates are -1..1; the `*_by` fields are radians this frame (gyro, mouse).
#[derive(Clone, Copy, Debug, Default)]
pub struct Input {
    pub thr: f32,
    pub turn: f32,
    pub twist: f32,
    pub pitch: f32,
    pub twist_by: f32,
    pub pitch_by: f32,
    pub stop: bool,
    pub centre: bool,
    pub jets: bool,
    pub punch: bool,
    pub target: bool,
    pub energy: bool,
    pub ballistic: bool,
    pub missile: bool,
    pub fusion: bool,
    pub missile_tap: bool,
}

/// A sound the sim asks for.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Sfx {
    Laser {
        small: bool,
    },
    Cannon,
    Thunderclap,
    Bonker,
    Peashooter,
    Toaster,
    Missile,
    Boom {
        big: bool,
    },
    /// Taking a hit: arms ring, legs thud, the torso is dull.
    Clang(Sec),
    Step {
        vol: f32,
        scale: f32,
    },
    Land(f32),
    Blastoff(f32),
    Punch {
        hit: bool,
    },
    Whine,
    Powerdown,
    Powerup,
    Beep,
    Lock,
    FusionCrack,
    Fusion,
}
impl Sfx {
    pub fn kind(&self) -> &'static str {
        match self {
            Sfx::Laser { .. } => "laser",
            Sfx::Cannon => "cannon",
            Sfx::Thunderclap => "thunderclap",
            Sfx::Bonker => "bonker",
            Sfx::Peashooter => "peashooter",
            Sfx::Toaster => "toaster",
            Sfx::Missile => "missile",
            Sfx::Boom { .. } => "boom",
            Sfx::Clang(_) => "clang",
            Sfx::Step { .. } => "step",
            Sfx::Land(_) => "land",
            Sfx::Blastoff(_) => "blastoff",
            Sfx::Punch { .. } => "punch",
            Sfx::Whine => "whine",
            Sfx::Powerdown => "powerdown",
            Sfx::Powerup => "powerup",
            Sfx::Beep => "beep",
            Sfx::Lock => "lock",
            Sfx::FusionCrack => "fusioncrack",
            Sfx::Fusion => "fusion",
        }
    }
}
/// What the sim asks the outside world to do. The app drains `Game::events` every frame.
/// `at: None` means your own mech: full and centred.
#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    Say {
        line: String,
        force: bool,
        delay: f32,
    },
    Sfx {
        sfx: Sfx,
        at: Option<V3>,
    },
    /// The feel table's sound columns: the sub-bass, the loops' duck, the pad's rumble (ms).
    Thump {
        bass: f32,
        duck: f32,
        haptic: f32,
        at: Option<V3>,
    },
    FusionSound {
        on: bool,
        p: f32,
    },
}

#[derive(Clone, Copy, Debug)]
pub struct Weapon {
    pub key: Wpn,
    pub def: &'static WeaponDef,
    pub mount: Sec,
    pub cd: f32,
    pub ammo: i32,
    pub dead: bool,
    /// Which of its category this one is (missile racks alternate sides).
    pub side: i32,
    pub burst_left: i32,
    pub burst_t: f32,
    pub burst_aim: V3,
}
#[derive(Clone, Copy, Debug, Default)]
pub struct Foot {
    pub pos: V3,
    pub from: V3,
    pub lifted: bool,
    pub yaw: f32,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HitBy {
    Punch,
    Stomp,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SwingPhase {
    Windup,
    Recover,
}
#[derive(Clone, Copy, Debug)]
pub struct Swing {
    pub t: f32,
    pub phase: SwingPhase,
    pub arm: Option<Sec>,
}
#[derive(Clone, Copy, Debug, Default)]
pub struct FusionScan {
    pub mech: Option<MechId>,
    pub t: f32,
    pub off: f32,
    pub on: bool,
    pub slipping: bool,
    pub end: V3,
}
#[derive(Clone, Copy, Debug, Default)]
pub struct JetState {
    pub charge: f32,
    pub blasted: bool,
    pub top: f32,
    pub fly: [f32; 2],
    pub lock: Option<MechId>,
    /// The lock is real: this charge lands on it.
    pub on: bool,
    /// Where this flight (or this charge) comes down, when, and on whom.
    pub at: Option<V3>,
    pub at_t: f32,
    pub at_mech: Option<MechId>,
    pub base: Option<f32>,
    pub used: f32,
    pub away: f32,
}
#[derive(Clone, Copy, Debug, Default)]
pub struct Dying {
    pub t: f32,
    pub exploded: bool,
    pub angle: f32,
    pub drop: f32,
    pub buckle: f32,
    pub fall_yaw: f32,
    pub roll: f32,
}
#[derive(Clone, Copy, Debug, Default)]
pub struct Flash {
    pub frame: u64,
    pub p: V3,
    pub dir: V3,
    pub big: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AiState {
    Fight,
    Search,
}
#[derive(Clone, Copy, Debug)]
pub struct Ai {
    pub aware: bool,
    pub seen: bool,
    pub state: AiState,
    pub profile: Profile,
    /// A target on the range that never wakes or moves.
    pub still: bool,
    pub strafe: f32,
    pub strafe_t: f32,
    pub jitter: f32,
    pub cool_t: f32,
    pub hit_at: Option<f32>,
    pub lock_t: f32,
    pub aim_phase: Option<f32>,
    pub hot: bool,
    pub wp: Option<[f32; 2]>,
    pub beam_aim: V3,
    /// Where it believes the player is, and how fast they were going.
    pub belief: Option<(V3, [f32; 2], f32)>,
    pub last_seen: f32,
    pub look_t: f32,
    pub react_at: Option<f32>,
    pub shout_at: Option<f32>,
    pub jump: Option<(f32, f32)>,
    pub jump_cd: f32,
    pub cover: Option<([f32; 2], f32)>,
    pub cover_look_t: f32,
    pub cover_cd: f32,
    pub ridge: Option<[f32; 2]>,
    pub ridge_look_t: f32,
    pub move_off: Option<[f32; 2]>,
    pub flipped_at: Option<f32>,
    pub flip_t: f32,
    pub shots: i32,
    pub shots_at: i32,
}

#[derive(Clone, Debug)]
pub struct Mech {
    pub ch: &'static Chassis,
    pub geo: Geo,
    pub team: u8,
    pub alive: bool,
    /// Its death is over: it is a wreck now.
    pub gone: bool,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub vy: f32,
    /// The legs' heading; the torso's twist and pitch on top.
    pub yaw: f32,
    pub twist: f32,
    pub pitch: f32,
    pub speed: f32,
    pub throttle: f32,
    pub heat: f32,
    pub fuel: f32,
    pub jetting: bool,
    pub air: bool,
    pub shutdown: bool,
    pub was_air: bool,
    pub centring: bool,
    pub air_t: f32,
    pub hp: [f32; Sec::N],
    pub max: [f32; Sec::N],
    pub sink_rate: f32,
    pub max_speed: f32,
    pub jets: u8,
    pub w: Vec<Weapon>,
    // The gait (gait.rs): planted feet, the distance clock, the drawn body.
    pub feet: [Foot; 4],
    pub cyc: f32,
    pub bob: f32,
    pub lean: f32,
    pub sway: f32,
    pub hip_yaw: f32,
    pub surge: f32,
    pub last_yaw: f32,
    pub run_k: f32,
    pub run_lean: f32,
    pub step_at: f32,
    pub dig: f32,
    pub slide: f32,
    pub p_walk: f32,
    pub p_drop: f32,
    pub p_mean: f32,
    pub p_vault: Option<f32>,
    pub p_ahead: f32,
    pub torso_drop: f32,
    pub torso_nod: f32,
    pub hull: Option<Spring>,
    pub torso: Option<Spring>,
    // Beams and the melt, which is the target's.
    pub melt: f32,
    pub melt_at: f32,
    pub melt_rate: f32,
    pub melt_frame: u64,
    pub beam_on: bool,
    pub beaming: bool,
    pub beam_mech: Option<MechId>,
    pub fusion: FusionScan,
    pub melee: Option<Swing>,
    pub melee_cd: f32,
    pub last_arm: Sec,
    pub last_hit: Option<HitBy>,
    pub jet: JetState,
    pub push: [f32; 2],
    pub squash: Spring,
    pub wob_p: Spring,
    pub wob_r: Spring,
    pub sag: Spring,
    pub tilt_p: Spring,
    pub tilt_r: Spring,
    pub tilt_was: Option<(f32, f32)>,
    pub scramble: f32,
    pub flash: Flash,
    pub dying: Option<Dying>,
    /// Your own view stays where the fall left it until the debrief.
    pub fallen: Option<Dying>,
    pub ai: Ai,
}
impl Mech {
    pub fn key(&self) -> Ch {
        self.ch.key
    }
    pub fn scale(&self) -> f32 {
        self.ch.scale
    }
    pub fn view_yaw(&self) -> f32 {
        self.yaw + self.twist
    }
    pub fn pos(&self) -> V3 {
        v3(self.x, self.y, self.z)
    }
    pub fn radius(&self) -> f32 {
        self.geo.radius * self.ch.scale
    }
    pub fn top(&self) -> f32 {
        self.y + self.geo.height * self.ch.scale
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Shot {
    pub kind: WKind,
    pub wpn: Wpn,
    pub p: V3,
    pub v: V3,
    pub owner: MechId,
    pub target: Option<MechId>,
    pub dmg: f32,
    pub life: f32,
    pub smoke: f32,
    pub age: f32,
    pub vid: u32,
    pub guided: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PKind {
    Smoke,
    Fire,
    Spark,
    Debris,
    Shock,
    Dust,
    Flame,
}
#[derive(Clone, Copy, Debug)]
pub struct Particle {
    pub p: V3,
    pub v: V3,
    pub life: f32,
    pub life0: f32,
    pub size: f32,
    pub grav: f32,
    pub col: [f32; 3],
    pub kind: PKind,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Part {
    Arm,
    ULeg,
    LLeg,
    Foot,
    Plate,
}
#[derive(Clone, Copy, Debug)]
pub struct Debris {
    pub part: Part,
    pub ch: Ch,
    pub scale: f32,
    pub p: V3,
    pub v: V3,
    pub rot: V3,
    pub spin: V3,
    pub landed: bool,
    pub bounced: bool,
    pub t: f32,
    pub life: f32,
}
#[derive(Clone, Debug)]
pub struct Wreck {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub yaw: f32,
    pub ch: Ch,
    pub scale: f32,
    pub t: f32,
    pub roll: f32,
    pub pops: Vec<f32>,
    pub big_pop: Option<f32>,
    pub settle: f32,
}
#[derive(Clone, Copy, Debug)]
pub struct Pulse {
    pub a: V3,
    pub b: V3,
    pub target: MechId,
    pub shooter: MechId,
    pub t: f32,
    pub dur: f32,
    pub hit: bool,
    pub seed: f32,
}
#[derive(Clone, Copy, Debug)]
pub struct CBeam {
    pub a: V3,
    pub b: V3,
    pub col: [f32; 3],
    pub w: f32,
}
#[derive(Clone, Debug)]
pub struct Msg {
    pub text: String,
    pub t: f32,
    pub warn: bool,
}
#[derive(Clone, Copy, Debug)]
pub struct Scorch {
    pub x: f32,
    pub z: f32,
    pub r: f32,
    pub y: f32,
}
#[derive(Clone, Copy, Debug, Default)]
pub struct Stats {
    pub shots: f32,
    pub hits: f32,
    pub dealt: f32,
    pub taken: f32,
    pub kills: i32,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    Brief,
    Play,
    Over,
    Debrief,
}
/// A guided volley, flown from its nose camera.
#[derive(Clone, Copy, Debug)]
pub struct Guide {
    pub vid: u32,
    pub yaw: f32,
    pub pitch: f32,
    pub dir: V3,
    pub pos: V3,
    pub nose: V3,
    pub lost: f32,
    pub fuel: f32,
    pub n: usize,
}
#[derive(Clone, Copy, Debug, Default)]
pub struct DeathInfo {
    pub melee: Option<HitBy>,
    pub shutdown: bool,
    pub foe_shutdown: bool,
}
#[derive(Clone, Debug, Default)]
pub struct VoiceBook {
    pub last_dry: Option<f32>,
    pub used: Vec<&'static str>,
}

pub struct Game {
    pub state: State,
    pub paused: bool,
    pub won: bool,
    pub end_t: f32,
    pub mechs: Vec<Mech>,
    pub shots: Vec<Shot>,
    pub parts: Vec<Particle>,
    pub debris: Vec<Debris>,
    pub wrecks: Vec<Wreck>,
    pub pulses: Vec<Pulse>,
    /// Continuous beams, redrawn every frame they're on.
    pub cbeams: Vec<CBeam>,
    pub msgs: Vec<Msg>,
    pub scorch: Vec<Scorch>,
    pub scorch_at: usize,
    pub eye: V3,
    pub view: V3,
    pub aim: V3,
    pub aim_mech: Option<MechId>,
    pub target: Option<MechId>,
    pub lock: bool,
    pub lock_on: bool,
    pub flash: f32,
    pub shake: f32,
    pub kick: f32,
    pub white_flash: f32,
    pub hit_mark: f32,
    pub hit_stop: f32,
    pub twist_rate: f32,
    pub last_twist: f32,
    pub beam_on_at: Option<f32>,
    pub bob: Spring,
    pub bob_in: Spring,
    pub zoom: bool,
    pub reduced_motion: bool,
    pub guide: Option<Guide>,
    pub m_down: bool,
    pub m_at: f32,
    pub m_vid: u32,
    pub volley_seq: u32,
    pub last_volley: u32,
    pub time: f32,
    pub frame: u64,
    pub ter: Terrain,
    pub biome: Biome,
    pub time_of_day: TimeOfDay,
    pub weather: Weather,
    pub pal: Light,
    pub ramp: Option<(Light, Light, f32)>,
    pub rng: Rng,
    pub events: Vec<Event>,
    pub input: Input,
    pub diff: Diff,
    /// The mission (an index into MISSIONS), or Free Play.
    pub mission: Option<usize>,
    pub stats: Stats,
    pub farthest_shove: f32,
    pub punch_ready: bool,
    pub death: DeathInfo,
    pub last_kill: Option<Option<HitBy>>,
    pub voice: VoiceBook,
}
impl Game {
    pub fn p(&self) -> &Mech {
        &self.mechs[PLAYER]
    }
    pub fn pm(&mut self) -> &mut Mech {
        &mut self.mechs[PLAYER]
    }
    pub fn sfx(&mut self, sfx: Sfx, at: Option<V3>) {
        self.events.push(Event::Sfx { sfx, at });
    }
    /// A sound placed at a mech: your own is centred, anyone else's is where it is.
    pub fn sfx_by(&mut self, who: MechId, sfx: Sfx, at: V3) {
        self.sfx(sfx, if who == PLAYER { None } else { Some(at) });
    }
    pub fn say(&mut self, line: impl Into<String>, force: bool, delay: f32) {
        self.events.push(Event::Say {
            line: line.into(),
            force,
            delay,
        });
    }
    pub fn verdict(&self) -> Verdict {
        if self.won {
            if self.stats.taken <= 0. {
                Verdict::Untouched
            } else if matches!(self.last_kill, Some(Some(_))) {
                Verdict::Punched
            } else {
                Verdict::Won
            }
        } else if self.death.shutdown && self.death.foe_shutdown {
            Verdict::Awkward
        } else if self.death.melee == Some(HitBy::Stomp) {
            Verdict::Flattened
        } else {
            Verdict::Lost
        }
    }
    pub fn enemies_left(&self) -> usize {
        self.mechs.iter().filter(|m| m.team != 0 && m.alive).count()
    }
}
