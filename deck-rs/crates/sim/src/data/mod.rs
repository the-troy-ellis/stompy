//! Every tuned number in one place, ported from the reference repo's
//! `src/data/` (the result of a lot of tuning: port, don't reinvent). Code uses
//! these enum keys; display names live only in `names.rs`.
pub mod names;
use crate::math::PI;

#[macro_export]
macro_rules! keyed {
    ($(#[$m:meta])* $name:ident { $($v:ident),+ $(,)? }) => {
        $(#[$m])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
        pub enum $name { $($v),+ }
        impl $name {
            pub const ALL: &'static [$name] = &[$($name::$v),+];
            pub const N: usize = Self::ALL.len();
            #[inline] pub fn i(self) -> usize { self as usize }
        }
    };
}
keyed!(/// The five sections. Losing the torso kills.
    Sec { T, LA, RA, LL, RL });
keyed!(/// Fire controls, one per kind of weapon. There are no weapon groups by design.
    Cat { Energy, Ballistic, Missile, Fusion });
keyed!(WKind {
    Beam,
    Shell,
    Missile,
    Fusion
});
keyed!(/// Weapon keys. Display names in names.rs (laser is BIG ZAPPER).
    Wpn { Laser, Mlaser, Plaser, Flamer, Gauss, Mg, Ac, Ppc, Srm, Lrm, Fusion });
keyed!(/// Chassis keys. Display names in names.rs (kestrel is BARRY).
    Ch { Kestrel, Jackal, Warden, Light1, Sniper1, Puncher });
keyed!(Legs {
    Forward,
    Reverse,
    Quad
});
keyed!(/// Which torso and arms a chassis wears.
    Style { Forward, Reverse, Quad, Puncher, Light1, Sniper1 });
keyed!(/// How an AI fights (ai.rs).
    Profile { Baseline, Harass, Line, Skirmish, Sniper, Brawler });
keyed!(Diff { Easy, Normal, Hard });
keyed!(Biome {
    Dusk,
    Ice,
    Volcanic,
    Forest
});
keyed!(TimeOfDay {
    Day,
    Dusk,
    Night,
    Dawn
});
keyed!(Weather {
    Clear,
    Rain,
    Snow,
    Dust,
    Fog,
    Mist
});
keyed!(/// A weapon's own sound recipe.
    WSfx { Default, Toaster, Bonker, Peashooter, Thunderclap });
keyed!(Knee { Forward, Back, Out });
keyed!(Objective {
    Eliminate,
    Destroy,
    Escort,
    Survive,
    Extract
});

impl Sec {
    pub fn is_leg(self) -> bool {
        matches!(self, Sec::LL | Sec::RL)
    }
    pub fn is_arm(self) -> bool {
        matches!(self, Sec::LA | Sec::RA)
    }
}

// --- weapons -------------------------------------------------------------------------------------
#[derive(Clone, Copy, Debug)]
pub struct WeaponDef {
    pub key: Wpn,
    pub kind: WKind,
    pub cat: Cat,
    /// Beams: damage and heat per second.
    pub dps: f32,
    pub hps: f32,
    pub dmg: f32,
    pub heat: f32,
    pub cd: f32,
    pub range: f32,
    pub speed: f32,
    pub ammo: i32,
    pub count: i32,
    /// Shells: a shove on the target (m/s), a step back for the shooter.
    pub knock: f32,
    pub recoil: f32,
    pub burst_n: i32,
    pub burst_dt: f32,
    pub jitter: f32,
    pub homing: bool,
    pub spread: Option<f32>,
    pub lift: Option<f32>,
    pub melt_rate: f32,
    pub target_heat: f32,
    pub cone: bool,
    pub stutter: f32,
    pub scramble: f32,
    pub bolt: bool,
    pub col: [f32; 3],
    pub w: f32,
    pub tracer: Option<[f32; 3]>,
    pub tw: f32,
    pub tl: f32,
    pub tons: f32,
    pub fp: f32,
    pub sfx: WSfx,
    // The fusion cannon only: hold a scan on one mech, then the reactor discharges into it.
    pub scan: f32,
    pub overload: f32,
    pub scan_heat: f32,
    pub slack: f32,
    pub grace: f32,
    pub assist: f32,
    pub feedback: f32,
    pub pulse_speed: f32,
}
const W0: WeaponDef = WeaponDef {
    key: Wpn::Laser,
    kind: WKind::Beam,
    cat: Cat::Energy,
    dps: 0.,
    hps: 0.,
    dmg: 0.,
    heat: 0.,
    cd: 0.,
    range: 0.,
    speed: 0.,
    ammo: 0,
    count: 0,
    knock: 0.,
    recoil: 0.,
    burst_n: 0,
    burst_dt: 0.,
    jitter: 0.,
    homing: false,
    spread: None,
    lift: None,
    melt_rate: 0.,
    target_heat: 0.,
    cone: false,
    stutter: 0.,
    scramble: 0.,
    bolt: false,
    col: [1., 1., 1.],
    w: 0.,
    tracer: None,
    tw: 0.,
    tl: 0.,
    tons: 0.,
    fp: 0.,
    sfx: WSfx::Default,
    scan: 0.,
    overload: 0.,
    scan_heat: 0.,
    slack: 0.,
    grace: 0.,
    assist: 0.,
    feedback: 0.,
    pulse_speed: 0.,
};
/// Lasers are continuous beams whose damage climbs the longer they stay on one mech (its armour
/// melts, beams.rs); heat per second is the price. Shells are big hits, little heat, ammo.
/// Missiles home with a lock (FIRECRACKERS don't). The fusion cannon is a whole decision.
pub static WEAPONS: [WeaponDef; Wpn::N] = [
    WeaponDef {
        key: Wpn::Laser,
        kind: WKind::Beam,
        cat: Cat::Energy,
        dps: 3.5,
        hps: 12.,
        range: 520.,
        col: [1., 0.25, 0.2],
        w: 0.22,
        cd: 1.,
        tons: 5.,
        fp: 3.5,
        ..W0
    },
    WeaponDef {
        key: Wpn::Mlaser,
        kind: WKind::Beam,
        cat: Cat::Energy,
        dps: 2.0,
        hps: 6.,
        range: 360.,
        col: [0.3, 1., 0.35],
        w: 0.16,
        cd: 1.,
        tons: 2.,
        fp: 2.,
        ..W0
    },
    // Short-range melt specialist: armour under it melts 1.5 times as fast, and the beam stutters at 12 Hz.
    WeaponDef {
        key: Wpn::Plaser,
        kind: WKind::Beam,
        cat: Cat::Energy,
        dps: 2.6,
        hps: 8.,
        range: 300.,
        col: [1., 0.55, 0.15],
        w: 0.15,
        cd: 1.,
        tons: 3.,
        fp: 2.6,
        melt_rate: 1.5,
        stutter: 12.,
        ..W0
    },
    // Forces shutdowns at knife range: a cone of fire, and heat poured into whatever it is on.
    WeaponDef {
        key: Wpn::Flamer,
        kind: WKind::Beam,
        cat: Cat::Energy,
        dps: 0.8,
        hps: 3.,
        range: 90.,
        col: [1., 0.5, 0.12],
        w: 0.1,
        cd: 1.,
        tons: 1.5,
        fp: 0.8,
        target_heat: 6.,
        cone: true,
        sfx: WSfx::Toaster,
        ..W0
    },
    // The sniper's gun: a bright tracer, a heavy recoil, a knock worth a shove.
    WeaponDef {
        key: Wpn::Gauss,
        kind: WKind::Shell,
        cat: Cat::Ballistic,
        dmg: 20.,
        heat: 1.,
        cd: 3.2,
        range: 800.,
        speed: 700.,
        ammo: 12,
        knock: 6.,
        recoil: 1.6,
        tracer: Some([0.85, 0.95, 1.]),
        sfx: WSfx::Bonker,
        tons: 12.,
        fp: 6.3,
        ..W0
    },
    // Strips a melted section fast: each pull is a burst of 6 rounds.
    WeaponDef {
        key: Wpn::Mg,
        kind: WKind::Shell,
        cat: Cat::Ballistic,
        dmg: 0.8,
        heat: 0.2,
        cd: 0.5,
        range: 220.,
        speed: 520.,
        ammo: 60,
        burst_n: 6,
        burst_dt: 0.05,
        jitter: 0.012,
        tracer: Some([1., 0.85, 0.45]),
        tw: 0.18,
        tl: 3.5,
        sfx: WSfx::Peashooter,
        tons: 1.,
        fp: 9.6,
        ..W0
    },
    WeaponDef {
        key: Wpn::Ac,
        kind: WKind::Shell,
        cat: Cat::Ballistic,
        dmg: 11.,
        heat: 2.,
        cd: 1.1,
        range: 650.,
        speed: 340.,
        ammo: 30,
        tons: 8.,
        fp: 10.,
        ..W0
    },
    // A slow blue bolt, fired with the energy weapons: it scrambles the target's HUD.
    WeaponDef {
        key: Wpn::Ppc,
        kind: WKind::Shell,
        cat: Cat::Energy,
        bolt: true,
        dmg: 14.,
        heat: 11.,
        cd: 3.5,
        range: 600.,
        speed: 420.,
        scramble: 1.5,
        col: [0.45, 0.7, 1.],
        tons: 7.,
        fp: 4.,
        sfx: WSfx::Thunderclap,
        ..W0
    },
    // Dumb-fire spread that pops: no homing, no lock, each hit shoves.
    WeaponDef {
        key: Wpn::Srm,
        kind: WKind::Missile,
        cat: Cat::Missile,
        homing: false,
        dmg: 2.6,
        heat: 4.,
        cd: 3.,
        range: 260.,
        speed: 160.,
        ammo: 18,
        count: 6,
        knock: 1.2,
        spread: Some(0.035),
        lift: Some(0.02),
        tons: 3.,
        fp: 5.2,
        ..W0
    },
    WeaponDef {
        key: Wpn::Lrm,
        kind: WKind::Missile,
        cat: Cat::Missile,
        homing: true,
        dmg: 1.9,
        heat: 6.,
        cd: 4.5,
        range: 850.,
        speed: 120.,
        ammo: 14,
        count: 10,
        tons: 6.,
        fp: 4.2,
        ..W0
    },
    // Hold a targeting laser on one mech for `scan` s and the reactor discharges: an outright kill.
    // The price: heat jumps to `overload`, the cannon recharges for `cd` s, and `feedback` of your own torso.
    WeaponDef {
        key: Wpn::Fusion,
        kind: WKind::Fusion,
        cat: Cat::Fusion,
        scan: 3.,
        cd: 25.,
        overload: 140.,
        range: 600.,
        scan_heat: 2.,
        col: [0.78, 0.5, 1.],
        slack: 1.5,
        grace: 0.5,
        assist: 2.2,
        feedback: 0.35,
        pulse_speed: 350.,
        ..W0
    },
];
pub fn weapon(w: Wpn) -> &'static WeaponDef {
    &WEAPONS[w.i()]
}

// --- body plans ----------------------------------------------------------------------------------
#[derive(Clone, Copy, Debug, Default)]
pub struct LegPlan {
    pub hx: f32,
    pub hz: f32,
    pub fx: f32,
    pub fz: f32,
    pub ph: f32,
}
const fn leg(hx: f32, hz: f32, fx: f32, fz: f32, ph: f32) -> LegPlan {
    LegPlan { hx, hz, fx, fz, ph }
}
/// A body plan, in model units (times the chassis's scale). +x is the mech's left, +z its front.
#[derive(Clone, Copy, Debug)]
pub struct Geo {
    pub hip: f32,
    pub l1: f32,
    pub l2: f32,
    pub ankle: f32,
    pub knee: Knee,
    pub swing: f32,
    pub stride: [f32; 2],
    pub radius: f32,
    pub height: f32,
    pub leg_top: f32,
    pub torso_y: f32,
    pub eye: [f32; 3],
    pub arm_x: f32,
    pub arm_y: f32,
    pub rack_y: f32,
    pub ac_y: f32,
    pub girth: f32,
    pub n_legs: usize,
    pub legs_: [LegPlan; 4],
}
impl Geo {
    pub fn legs(&self) -> &[LegPlan] {
        &self.legs_[..self.n_legs]
    }
}
const L0: LegPlan = leg(0., 0., 0., 0., 0.);
pub static GEO: [Geo; Legs::N] = [
    Geo {
        hip: 4.6,
        l1: 2.6,
        l2: 2.5,
        ankle: 0.42,
        knee: Knee::Forward,
        swing: 0.36,
        stride: [3.5, 4.5],
        radius: 2.4,
        height: 7.9,
        leg_top: 4.4,
        torso_y: 5.,
        eye: [0., 2.35, 1.9],
        arm_x: 2.25,
        arm_y: 2.0,
        rack_y: 3.2,
        ac_y: 1.6,
        girth: 1.,
        n_legs: 2,
        legs_: [
            leg(0.95, 0., 1.1, 0., 0.),
            leg(-0.95, 0., -1.1, 0., 0.5),
            L0,
            L0,
        ],
    },
    // Bird-like: the joint points backward, feet are three-toed claws.
    Geo {
        hip: 4.9,
        l1: 2.7,
        l2: 2.9,
        ankle: 0.5,
        knee: Knee::Back,
        swing: 0.42,
        stride: [3.5, 4.5],
        radius: 2.4,
        height: 8.6,
        leg_top: 4.7,
        torso_y: 5.3,
        eye: [0., 2.6, 1.5],
        arm_x: 2.3,
        arm_y: 2.0,
        rack_y: 3.3,
        ac_y: 1.6,
        girth: 1.,
        n_legs: 2,
        legs_: [
            leg(1.0, 0.1, 1.15, 0.45, 0.),
            leg(-1.0, 0.1, -1.15, 0.45, 0.5),
            L0,
            L0,
        ],
    },
    // Four legs bowed out like a spider's, trotting: diagonal pairs together.
    Geo {
        hip: 3.4,
        l1: 2.4,
        l2: 2.9,
        ankle: 0.35,
        knee: Knee::Out,
        swing: 0.34,
        stride: [3.0, 3.6],
        radius: 3.1,
        height: 6.6,
        leg_top: 3.3,
        torso_y: 4.0,
        eye: [0., 1.6, 1.4],
        arm_x: 1.9,
        arm_y: 1.2,
        rack_y: 2.1,
        ac_y: 0.9,
        girth: 1.,
        n_legs: 4,
        legs_: [
            leg(1.4, 1.6, 2.9, 2.3, 0.),
            leg(-1.4, -1.6, -2.9, -2.2, 0.),
            leg(-1.4, 1.6, -2.9, 2.3, 0.5),
            leg(1.4, -1.6, 2.9, -2.2, 0.5),
        ],
    },
];
/// A chassis's changes to its leg type's plan. Raising the hip moves everything stacked on it
/// (leg_top, torso_y, height) with it, unless the override sets those too.
#[derive(Clone, Copy, Debug)]
pub struct GeoOver {
    pub hip: Option<f32>,
    pub l1: Option<f32>,
    pub l2: Option<f32>,
    pub swing: Option<f32>,
    pub stride: Option<[f32; 2]>,
    pub radius: Option<f32>,
    pub height: Option<f32>,
    pub arm_x: Option<f32>,
    pub arm_y: Option<f32>,
    pub eye: Option<[f32; 3]>,
    pub ac_y: Option<f32>,
    pub rack_y: Option<f32>,
    pub girth: Option<f32>,
    pub legs: Option<&'static [LegPlan]>,
}
pub const GO: GeoOver = GeoOver {
    hip: None,
    l1: None,
    l2: None,
    swing: None,
    stride: None,
    radius: None,
    height: None,
    arm_x: None,
    arm_y: None,
    eye: None,
    ac_y: None,
    rack_y: None,
    girth: None,
    legs: None,
};
/// The body plan of a chassis: its leg type's, with its own changes merged over it.
pub fn geo_for(ch: Ch) -> Geo {
    let c = chassis(ch);
    let (b, o) = (&GEO[c.legs.i()], &c.geo);
    let mut g = *b;
    let dh = o.hip.unwrap_or(b.hip) - b.hip;
    g.leg_top = b.leg_top + dh;
    g.torso_y = b.torso_y + dh;
    g.height = b.height + dh;
    macro_rules! ov { ($($f:ident),*) => { $(if let Some(v) = o.$f { g.$f = v; })* } }
    ov!(hip, l1, l2, swing, stride, radius, height, arm_x, arm_y, eye, ac_y, rack_y, girth);
    if let Some(l) = o.legs {
        g.n_legs = l.len();
        g.legs_[..l.len()].copy_from_slice(l);
    }
    g
}

// --- gaits ---------------------------------------------------------------------------------------
/// How a leg type's steps look, never how fast it goes (docs: spec 16 in the reference).
#[derive(Clone, Copy, Debug)]
pub struct Gait {
    pub cadence: f32,
    pub run_cadence: f32,
    pub run_min: f32,
    pub run_at: f32,
    pub run_swing: f32,
    pub crouch: f32,
    pub lift: [f32; 2],
    pub lift_early: f32,
    pub slam: f32,
    pub drop: f32,
    pub surge: f32,
    pub bounce: f32,
    pub sway: f32,
    pub hip_turn: f32,
    pub run_lean: f32,
    pub run_drop: f32,
    pub plant_back: [f32; 2],
    /// The pendulum body: the planted leg's knee, the hull's spring, the torso's lag.
    pub knee: f32,
    pub run_knee: f32,
    pub knee_fast: f32,
    pub vault: f32,
    pub sink: f32,
    pub body_k: f32,
    pub body_zeta: f32,
    pub speed_up: f32,
    pub lag: f32,
    pub nod: f32,
}
pub static GAIT: [Gait; Legs::N] = [
    Gait {
        cadence: 1.7,
        run_cadence: 2.6,
        run_min: 12.,
        run_at: 0.55,
        run_swing: 0.6,
        crouch: 0.8,
        lift: [0.6, 0.9],
        lift_early: 0.6,
        slam: 0.85,
        drop: 0.24,
        surge: 0.35,
        bounce: 0.04,
        sway: 0.2,
        hip_turn: 0.08,
        run_lean: 0.2,
        run_drop: 0.4,
        plant_back: [0.1, 0.35],
        knee: 145.,
        run_knee: 0.,
        knee_fast: 20.,
        vault: 0.3,
        sink: 1.1,
        body_k: 70.,
        body_zeta: 0.55,
        speed_up: 0.12,
        lag: 0.045,
        nod: 0.3,
    },
    Gait {
        cadence: 3.0,
        run_cadence: 3.0,
        run_min: 0.,
        run_at: 0.55,
        run_swing: 0.62,
        crouch: 0.45,
        lift: [0.5, 1.2],
        lift_early: 0.85,
        slam: 0.3,
        drop: 0.08,
        surge: 0.1,
        bounce: 0.4,
        sway: 0.06,
        hip_turn: 0.04,
        run_lean: 0.28,
        run_drop: 0.5,
        plant_back: [0.25, 0.5],
        knee: 100.,
        run_knee: 125.,
        knee_fast: 0.,
        vault: 0.5,
        sink: 0.5,
        body_k: 140.,
        body_zeta: 0.6,
        speed_up: 0.08,
        lag: 0.03,
        nod: 0.15,
    },
    Gait {
        cadence: 1.4,
        run_cadence: 0.,
        run_min: 0.,
        run_at: 2.,
        run_swing: 0.34,
        crouch: 0.4,
        lift: [0.4, 0.6],
        lift_early: 0.6,
        slam: 0.75,
        drop: 0.2,
        surge: 0.2,
        bounce: 0.03,
        sway: 0.1,
        hip_turn: 0.03,
        run_lean: 0.,
        run_drop: 0.,
        plant_back: [0., 0.],
        knee: 105.,
        run_knee: 0.,
        knee_fast: 0.,
        vault: 0.5,
        sink: 0.8,
        body_k: 90.,
        body_zeta: 0.6,
        speed_up: 0.06,
        lag: 0.05,
        nod: 0.15,
    },
];

// --- melee ---------------------------------------------------------------------------------------
#[derive(Clone, Copy, Debug)]
pub struct MeleeDef {
    pub dmg: f32,
    pub reach: f32,
    pub arc: f32,
    pub windup: f32,
    pub recover: f32,
    pub cd: f32,
    pub heat: f32,
    pub knock: f32,
    pub stomp_dmg: f32,
    pub stomp_knock: f32,
    pub stomp_air: f32,
    pub fists: bool,
}
/// Everyone can shove. Reach is metres times the chassis's scale.
pub static DEFAULT_MELEE: MeleeDef = MeleeDef {
    dmg: 8.,
    reach: 9.,
    arc: 30. * PI / 180.,
    windup: 0.3,
    recover: 0.7,
    cd: 1.5,
    heat: 2.,
    knock: 12.,
    stomp_dmg: 6.,
    stomp_knock: 6.,
    stomp_air: 0.6,
    fists: false,
};
/// PURPLE PUNCHER's fists: the real punch.
pub static FIST_MELEE: MeleeDef = MeleeDef {
    dmg: 30.,
    reach: 14.,
    arc: 25. * PI / 180.,
    windup: 0.45,
    recover: 0.9,
    cd: 2.,
    heat: 4.,
    knock: 22.,
    stomp_dmg: 18.,
    stomp_knock: 14.,
    stomp_air: 0.6,
    fists: true,
};
/// The AI's taste for punching: the chance per second of opportunity, by difficulty, and how far outside the player's reach it keeps.
pub const AI_PUNCH_CHANCE: [f32; Diff::N] = [0.3, 0.6, 0.9];
pub const AI_PUNCH_KEEP_OUT: f32 = 1.3;

// --- chassis -------------------------------------------------------------------------------------
#[derive(Clone, Copy, Debug)]
pub struct Hardpoint {
    pub id: &'static str,
    pub loc: Sec,
    pub cat: Cat,
    pub stock: Wpn,
}
const fn hp(id: &'static str, loc: Sec, cat: Cat, stock: Wpn) -> Hardpoint {
    Hardpoint {
        id,
        loc,
        cat,
        stock,
    }
}
#[derive(Clone, Copy, Debug)]
pub struct Chassis {
    pub key: Ch,
    pub legs: Legs,
    pub style: Style,
    pub speed: f32,
    pub turn: f32,
    pub sink: f32,
    pub scale: f32,
    /// The AI's preferred range and its aim error per metre.
    pub pref: f32,
    pub acc0: f32,
    pub profile: Profile,
    pub hp: [f32; Sec::N],
    pub col: [f32; 3],
    pub acc: [f32; 3],
    /// Mechlab: the tonnage budget, the fixed weight of everything but weapons and systems, the stock systems.
    pub tons: f32,
    pub frame: f32,
    pub sinks: u8,
    pub armour: u8,
    pub jets: u8,
    pub jets_max: u8,
    pub hard: &'static [Hardpoint],
    pub melee: Option<&'static MeleeDef>,
    pub geo: GeoOver,
    /// How many campaign missions must be cleared before it can launch.
    pub unlock: u32,
}
use Cat::*;
use Sec::*;
pub static CHASSIS: [Chassis; Ch::N] = [
    Chassis {
        key: Ch::Kestrel,
        legs: Legs::Forward,
        style: Style::Reverse,
        speed: 15.,
        turn: 1.05,
        sink: 10.,
        scale: 1.,
        pref: 300.,
        acc0: 0.03,
        profile: Profile::Baseline,
        hp: [72., 32., 32., 42., 42.],
        col: [0.55, 0.58, 0.62],
        acc: [0.85, 0.6, 0.15],
        tons: 45.,
        frame: 12.5,
        sinks: 0,
        armour: 0,
        jets: 1,
        jets_max: 2,
        hard: &[
            hp("la", LA, Energy, Wpn::Laser),
            hp("ra", RA, Energy, Wpn::Laser),
            hp("t1", T, Ballistic, Wpn::Ac),
            hp("t2", T, Missile, Wpn::Lrm),
        ],
        melee: None,
        geo: GO,
        unlock: 0,
    },
    Chassis {
        key: Ch::Jackal,
        legs: Legs::Reverse,
        style: Style::Forward,
        speed: 19.,
        turn: 1.6,
        sink: 9.,
        scale: 0.85,
        pref: 140.,
        acc0: 0.035,
        profile: Profile::Harass,
        hp: [30., 13., 13., 18., 18.],
        col: [0.62, 0.26, 0.2],
        acc: [0.2, 0.2, 0.22],
        tons: 25.,
        frame: 15.5,
        sinks: 0,
        armour: 0,
        jets: 1,
        jets_max: 2,
        hard: &[
            hp("la", LA, Energy, Wpn::Mlaser),
            hp("ra", RA, Energy, Wpn::Mlaser),
        ],
        melee: None,
        geo: GO,
        unlock: 0,
    },
    // The biggest: heavier, larger and slower than PURPLE PUNCHER.
    Chassis {
        key: Ch::Warden,
        legs: Legs::Quad,
        style: Style::Quad,
        speed: 8.,
        turn: 0.7,
        sink: 10.,
        scale: 1.4,
        pref: 330.,
        acc0: 0.025,
        profile: Profile::Line,
        hp: [58., 28., 28., 34., 34.],
        col: [0.36, 0.4, 0.3],
        acc: [0.75, 0.7, 0.2],
        tons: 90.,
        frame: 56.,
        sinks: 0,
        armour: 0,
        jets: 1,
        jets_max: 2,
        hard: &[
            hp("t1", T, Missile, Wpn::Lrm),
            hp("ra", RA, Ballistic, Wpn::Ac),
            hp("la", LA, Energy, Wpn::Laser),
        ],
        melee: None,
        geo: GO,
        unlock: 4,
    },
    // A light reverse-joint skirmisher: long shins, boosted jets stock, shoved a very long way.
    Chassis {
        key: Ch::Light1,
        legs: Legs::Reverse,
        style: Style::Light1,
        speed: 22.,
        turn: 1.9,
        sink: 8.,
        scale: 0.8,
        pref: 170.,
        acc0: 0.035,
        profile: Profile::Skirmish,
        hp: [28., 12., 12., 16., 16.],
        col: [0.26, 0.58, 0.56],
        acc: [0.95, 0.45, 0.18],
        tons: 25.,
        frame: 12.5,
        sinks: 0,
        armour: 0,
        jets: 2,
        jets_max: 2,
        hard: &[
            hp("la", LA, Missile, Wpn::Srm),
            hp("ra", RA, Energy, Wpn::Mlaser),
            hp("t1", T, Ballistic, Wpn::Mg),
        ],
        melee: None,
        geo: GeoOver {
            hip: Some(4.5),
            l1: Some(2.4),
            l2: Some(2.9),
            stride: Some([4.2, 5.2]),
            swing: Some(0.46),
            radius: Some(2.2),
            height: Some(7.6),
            arm_x: Some(1.45),
            arm_y: Some(1.6),
            eye: Some([0., 1.55, 1.1]),
            ac_y: Some(0.8),
            rack_y: Some(2.2),
            ..GO
        },
        unlock: 6,
    },
    // A medium sniper on stilts: tall legs, a narrow stance, a long gun arm.
    Chassis {
        key: Ch::Sniper1,
        legs: Legs::Forward,
        style: Style::Sniper1,
        speed: 13.,
        turn: 0.9,
        sink: 11.,
        scale: 1.,
        pref: 450.,
        acc0: 0.02,
        profile: Profile::Sniper,
        hp: [60., 26., 26., 36., 36.],
        col: [0.72, 0.7, 0.62],
        acc: [0.2, 0.45, 0.75],
        tons: 50.,
        frame: 21.5,
        sinks: 0,
        armour: 0,
        jets: 0,
        jets_max: 1,
        hard: &[
            hp("ra", RA, Ballistic, Wpn::Gauss),
            hp("la", LA, Energy, Wpn::Ppc),
            hp("t1", T, Energy, Wpn::Mlaser),
        ],
        melee: None,
        geo: GeoOver {
            hip: Some(5.4),
            l1: Some(3.0),
            l2: Some(2.8),
            radius: Some(2.2),
            arm_x: Some(1.9),
            arm_y: Some(1.9),
            eye: Some([0., 2.0, 1.4]),
            ac_y: Some(1.3),
            rack_y: Some(2.6),
            legs: Some(&[leg(0.7, 0., 0.8, 0., 0.), leg(-0.7, 0., -0.8, 0., 0.5)]),
            ..GO
        },
        unlock: 8,
    },
    // The one with fists. Slow enough to kite, ruinous if it reaches you.
    Chassis {
        key: Ch::Puncher,
        legs: Legs::Forward,
        style: Style::Puncher,
        speed: 9.,
        turn: 0.6,
        sink: 12.,
        scale: 1.3,
        pref: 20.,
        acc0: 0.03,
        profile: Profile::Brawler,
        hp: [110., 50., 50., 60., 60.],
        col: [0.45, 0.22, 0.6],
        acc: [0.95, 0.75, 0.2],
        tons: 80.,
        frame: 57.,
        sinks: 0,
        armour: 0,
        jets: 0,
        jets_max: 1,
        hard: &[
            hp("t1", T, Ballistic, Wpn::Ac),
            hp("t2", T, Missile, Wpn::Srm),
        ],
        melee: Some(&FIST_MELEE),
        geo: GeoOver {
            hip: Some(5.0),
            l1: Some(2.6),
            l2: Some(2.6),
            stride: Some([3.0, 3.4]),
            girth: Some(1.35),
            radius: Some(3.0),
            arm_x: Some(2.95),
            arm_y: Some(1.55),
            eye: Some([0., 1.8, 1.75]),
            ac_y: Some(0.9),
            rack_y: Some(2.55),
            ..GO
        },
        unlock: 11,
    },
];
pub fn chassis(c: Ch) -> &'static Chassis {
    &CHASSIS[c.i()]
}
/// The selectable mechs, in selector order.
pub const MECH_ORDER: [Ch; Ch::N] = [
    Ch::Kestrel,
    Ch::Jackal,
    Ch::Warden,
    Ch::Light1,
    Ch::Sniper1,
    Ch::Puncher,
];
/// Systems (mechlab-lite): per level.
pub const SINK_PER_LEVEL: f32 = 2.;
pub const ARMOUR_HP: f32 = 0.1;
pub const ARMOUR_SPEED: f32 = 0.04;
pub const KNUCKLES_MULT: f32 = 1.5;

// --- the feel table (docs/specs/01-thunk.md) ----------------------------------------------------
keyed!(/// Every event that is felt.
    Feel { Step, NearStep, Blastoff, Land, FireAc, FireGauss, FireMg, FireBolt, Bolt, FireLrm, Hit, Shutdown, Restart,
        SectionLost, Death, Explosion, Punch, Punched, Stomp, Whiff, Blast, FusionFire });
/// One row: each column multiplied by the event's intensity.
#[derive(Clone, Copy, Debug, Default)]
pub struct FeelRow {
    /// The eye drops at once.
    pub kick: f32,
    /// The same drop through two springs in series (footsteps: a sway, not a judder).
    pub bob: f32,
    pub shake: f32,
    /// The red damage sheet, the white-out.
    pub flash: f32,
    pub white: f32,
    pub squash: f32,
    pub wobble: f32,
    /// The sub-bass thump, the loops' duck, the pad's rumble in ms.
    pub bass: f32,
    pub duck: f32,
    pub dust: f32,
    pub haptic: f32,
    /// A horizontal impulse on the mech, m/s.
    pub push: f32,
    pub sag: f32,
    pub overshoot: f32,
}
const fn fr(
    kick: f32,
    bob: f32,
    shake: f32,
    flash: f32,
    white: f32,
    squash: f32,
    wobble: f32,
    bass: f32,
    duck: f32,
    dust: f32,
    haptic: f32,
    push: f32,
) -> FeelRow {
    FeelRow {
        kick,
        bob,
        shake,
        flash,
        white,
        squash,
        wobble,
        bass,
        duck,
        dust,
        haptic,
        push,
        sag: 0.,
        overshoot: 0.,
    }
}
pub static FEEL: [FeelRow; Feel::N] = [
    fr(0., 28., 0.03, 0., 0., 0.03, 0., 0.4, 0., 1., 10., 0.), // step: k = (0.35 + 0.65 pace) x scale^2
    fr(0.15, 0., 0.12, 0., 0., 0., 0.05, 0.3, 0., 0., 8., 0.), // nearStep: a heavy's footfall within 40 m
    fr(1.6, 0., 1.2, 0., 0.25, 0.45, 0.8, 1.6, 0.8, 6., 110., 0.), // blastoff: k = 0.4 + 0.6 charge
    fr(1.0, 0., 0.6, 0., 0., 0.25, 0.4, 1.0, 0.3, 3., 40., 0.), // land: k = landing force
    fr(0.5, 0., 0.2, 0., 0., 0., 0.3, 0.6, 0., 0., 20., 0.4),  // fireAc
    fr(1.0, 0., 0.6, 0., 0.1, 0.08, 0.5, 1.0, 0.3, 1., 50., 0.), // fireGauss
    fr(0.12, 0., 0.06, 0., 0., 0., 0.04, 0.15, 0., 0., 8., 0.03), // fireMg, per round
    fr(0.4, 0., 0.3, 0., 0.12, 0., 0.25, 0.7, 0.1, 0., 25., 0.25), // fireBolt
    fr(0.6, 0., 0.9, 0.2, 0.25, 0., 1.4, 0.9, 0.3, 0., 60., 0.), // bolt: on the mech it hits
    fr(0.3, 0., 0.3, 0., 0., 0., 0.15, 0.5, 0., 2., 20., 0.15), // fireLrm
    fr(0.3, 0., 0.5, 0.4, 0., 0., 0.6, 0.5, 0.2, 0., 30., 0.), // hit: k = damage / 10 by section
    FeelRow {
        bass: 0.6,
        duck: 0.8,
        sag: 0.4,
        ..fr(0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0.)
    }, // shutdown: the hips sag 0.4 m
    FeelRow {
        overshoot: 0.1,
        ..fr(0.3, 0., 0.1, 0., 0., 0.1, 0.3, 0.4, 0., 0., 20., 0.)
    }, // restart: snaps up past standing
    fr(0.5, 0., 0.8, 0., 0., 0., 0.9, 0.8, 0.3, 1., 50., 0.),  // sectionLost
    fr(1.0, 0., 1.5, 0., 0., 0., 0., 1.2, 1.0, 0., 100., 0.),  // death (your own)
    fr(0., 0., 1.0, 0., 0., 0., 0.3, 0.9, 0.3, 0., 30., 0.), // explosion: k = (big ? 1 : 0.35)(1 - d / 220)
    fr(1.0, 0., 0.8, 0., 0., 0.1, 0.5, 1.0, 0.5, 2., 60., 0.), // punch
    fr(0.4, 0., 1.2, 0.2, 0., 0.15, 1.2, 0.8, 0.4, 2., 60., 0.), // punched
    fr(1.2, 0., 1.0, 0., 0., 0.3, 0.8, 1.2, 0.6, 4., 80., 0.), // stomp
    fr(0.3, 0., 0., 0., 0., 0., 0.2, 0., 0., 0., 0., 0.),    // whiff
    fr(0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 0., 4.),      // blast: a missile blast's shove
    fr(0.6, 0., 1.2, 0.4, 0.7, 0.1, 0.8, 1.2, 1.0, 0., 80., 0.), // fusionFire
];
pub fn feel_row(e: Feel) -> &'static FeelRow {
    &FEEL[e.i()]
}
/// How the view reads the springs and caps; REDUCED MOTION's multiplier on the camera columns.
pub const VIEW_WOBBLE: f32 = 0.6;
pub const VIEW_SHAKE_MAX: f32 = 1.2;
pub const VIEW_FLASH_MAX: f32 = 0.6;
pub const REDUCED_SCALE: f32 = 0.3;
/// Knockback: how far a blow jolts the aim (radians at a 10 m/s impulse), and the skid's dust rate.
pub const KNOCK_TWIST: f32 = 0.3;
pub const KNOCK_PITCH: f32 = 0.1;
pub const KNOCK_SKID_DUST: f32 = 12.;
/// The body springs: stiffness and damping ratio.
pub const SQUASH_K: f32 = 160.;
pub const SQUASH_ZETA: f32 = 0.7;
pub const WOBBLE_K: f32 = 90.;
pub const WOBBLE_ZETA: f32 = 0.35;
pub const SAG_K: f32 = 45.;
pub const SAG_ZETA: f32 = 1.;
pub const BOB_K: f32 = 200.;
pub const BOB_ZETA: f32 = 1.;
/// Weight: the whole body tips about its feet against its own acceleration and out of turns.
pub const INERTIA_PITCH: f32 = 0.012;
pub const INERTIA_ROLL: f32 = 0.005;
pub const INERTIA_MAX: f32 = 0.1;
pub const INERTIA_K: f32 = 28.;
pub const INERTIA_ZETA: f32 = 0.4;
pub const INERTIA_VIEW: f32 = 0.6;
/// How hard a hit on each section lands, as a factor on the hit row.
pub const HIT_BY_SECTION: [f32; Sec::N] = [1., 0.7, 0.7, 1.2, 1.2];
/// Seconds the crosshair holds still after a hit lands.
pub const HIT_STOP: f32 = 0.08;
/// Heat feel: from 85 to shutdown the view swims, the hum rises, the HUD browns out.
pub const HEAT_FROM: f32 = 85.;
pub const HEAT_TO: f32 = 100.;
pub const HEAT_FOV: f32 = 0.035;
pub const HEAT_SWAY: f32 = 0.006;
pub const HEAT_HUM: f32 = 0.5;
pub const HEAT_HUM_RATE: f32 = 0.3;
pub fn hot_frac(heat: f32) -> f32 {
    crate::math::clamp((heat - HEAT_FROM) / (HEAT_TO - HEAT_FROM), 0., 1.)
}
/// Walking feel: the ground pushes back. Uphill slow, downhill a little quick, a landing digs the feet in.
pub const SLOPE_UP: f32 = 2.5;
pub const SLOPE_DOWN: f32 = 0.75;
pub const SLOPE_MIN: f32 = 0.5;
pub const SLOPE_MAX: f32 = 1.15;
pub const DIG_CUT: f32 = 0.6;
pub const DIG_HOLD: f32 = 0.35;
pub const DIG_SLOW: f32 = 0.3;

// --- jets ----------------------------------------------------------------------------------------
/// Blast-off jets by level (0 none, 1 STOCK, 2 BOOSTED): hold to charge, let go to blast off.
#[derive(Clone, Copy, Debug)]
pub struct JetsDef {
    pub charge: f32,
    pub vy: [f32; 2],
    pub fwd: f32,
    pub recharge: f32,
    pub heat: [f32; 2],
    pub tap: f32,
    pub steer: f32,
    pub tilt: f32,
    pub reach: f32,
    pub aim_fwd: f32,
    pub assist: f32,
    pub assist_max: f32,
    pub let_go: f32,
    pub stomp_fall: f32,
}
pub static JETS: [JetsDef; 2] = [
    JetsDef {
        charge: 0.9,
        vy: [14., 40.],
        fwd: 14.,
        recharge: 3.,
        heat: [4., 12.],
        tap: 0.2,
        steer: 6.,
        tilt: 0.3,
        reach: 80.,
        aim_fwd: 20.,
        assist: 4.,
        assist_max: 10.,
        let_go: 0.5,
        stomp_fall: 8.,
    },
    JetsDef {
        charge: 0.75,
        vy: [15., 44.],
        fwd: 16.,
        recharge: 2.,
        heat: [4., 12.],
        tap: 0.2,
        steer: 7.,
        tilt: 0.3,
        reach: 90.,
        aim_fwd: 22.,
        assist: 4.,
        assist_max: 10.,
        let_go: 0.5,
        stomp_fall: 8.,
    },
];
pub fn jets_def(level: u8) -> Option<&'static JetsDef> {
    match level {
        1 => Some(&JETS[0]),
        2 => Some(&JETS[1]),
        _ => None,
    }
}
pub const JETS_STEER_OVER: f32 = 6.;
pub const JETS_CONE: f32 = 0.3;
pub const JETS_ESCAPE: f32 = 35.;

// --- AI ------------------------------------------------------------------------------------------
/// Difficulty scales skill, never stats.
#[derive(Clone, Copy, Debug)]
pub struct DiffDef {
    pub sight: f32,
    pub heat_cap: f32,
    pub aim_err: f32,
    pub sections: bool,
    pub react: f32,
}
pub static DIFFS: [DiffDef; Diff::N] = [
    DiffDef {
        sight: 400.,
        heat_cap: 60.,
        aim_err: 1.4,
        sections: false,
        react: 1.5,
    },
    DiffDef {
        sight: 600.,
        heat_cap: 72.,
        aim_err: 1.0,
        sections: false,
        react: 0.8,
    },
    DiffDef {
        sight: 800.,
        heat_cap: 85.,
        aim_err: 0.7,
        sections: true,
        react: 0.3,
    },
];
/// Fire discipline.
pub const FIRE_COOL_BELOW: f32 = 15.;
pub const FIRE_ALPHA_TORSO: f32 = 0.25;
pub const FIRE_LOCK_FACE: f32 = 0.3;
pub const FIRE_LOCK_FOR: f32 = 1.;
pub const FIRE_LRM_MIN: f32 = 120.;
pub const FIRE_ARM_OFFSET: f32 = 1.9;
/// Behaviours.
pub const COVER_HEAT: f32 = 60.;
pub const COVER_TORSO: f32 = 0.4;
pub const COVER_LEAVE: f32 = 35.;
pub const COVER_DISTS: [f32; 3] = [40., 80., 120.];
pub const COVER_EVERY: f32 = 2.;
pub const COVER_ARRIVE: f32 = 8.;
pub const COVER_MAX_WAIT: f32 = 12.;
pub const COVER_RETRY: f32 = 20.;
pub const RIDGE_ABOVE: f32 = 15.;
pub const RIDGE_RADII: [f32; 6] = [80., 120., 160., 200., 240., 300.];
pub const RIDGE_EVERY: f32 = 4.;
pub const RIDGE_ARRIVE: f32 = 10.;
pub const HARASS_BAND: [f32; 2] = [140., 200.];
pub const JUMP_WITHIN: f32 = 60.;
pub const JUMP_FOR: f32 = 1.2;
pub const JUMP_COOLDOWN: f32 = 6.;
pub const HIT_FLIP_EVERY: f32 = 1.2;
pub const RELOCATE_AFTER: i32 = 3;
pub const RELOCATE_AWAY: f32 = 60.;
pub const STOMP_OVER: f32 = 3.;
pub const LINE_RANGE: f32 = 150.;
pub const ALLY_GAP: f32 = 6.;
/// Perception.
pub const LOOK_EVERY: f32 = 0.15;
pub const LOST_AFTER: f32 = 8.;
pub const SHOUT_RANGE: f32 = 200.;
pub const SHOUT_DELAY: f32 = 1.;
pub const EXTRAPOLATE: f32 = 2.;
pub const SEARCH_RADIUS: f32 = 80.;

// --- places --------------------------------------------------------------------------------------
#[derive(Clone, Copy, Debug)]
pub struct Light {
    pub zen: [f32; 3],
    pub hor: [f32; 3],
    pub fog: [f32; 2],
    pub light: [f32; 3],
    pub shade: [f32; 3],
}
#[derive(Clone, Copy, Debug)]
pub struct PalDef {
    pub low: [f32; 3],
    pub mid: [f32; 3],
    pub high: [f32; 3],
    pub rock: [f32; 3],
    pub day: Light,
    pub night: Light,
    pub dawn: Light,
}
const ONE: [f32; 3] = [1., 1., 1.];
/// Each biome's palette is its native light (the desert and the plain at dusk, the glacier by day);
/// night and dawn bring their own sky, fog, light and shade.
pub static PALS: [PalDef; Biome::N] = [
    PalDef {
        low: [0.56, 0.36, 0.23],
        mid: [0.74, 0.52, 0.31],
        high: [0.92, 0.8, 0.62],
        rock: [0.42, 0.3, 0.25],
        day: Light {
            zen: [0.16, 0.1, 0.3],
            hor: [0.9, 0.56, 0.38],
            fog: [180., 1150.],
            light: [0.4, 0.75, -0.5],
            shade: ONE,
        },
        night: Light {
            zen: [0.02, 0.02, 0.07],
            hor: [0.13, 0.11, 0.2],
            fog: [110., 720.],
            light: [-0.35, 0.8, 0.45],
            shade: [0.34, 0.36, 0.52],
        },
        dawn: Light {
            zen: [0.24, 0.28, 0.5],
            hor: [0.98, 0.72, 0.58],
            fog: [160., 1000.],
            light: [0.85, 0.3, 0.2],
            shade: [0.95, 0.86, 0.86],
        },
    },
    PalDef {
        low: [0.58, 0.66, 0.75],
        mid: [0.8, 0.86, 0.92],
        high: [0.98, 0.99, 1.],
        rock: [0.42, 0.47, 0.55],
        day: Light {
            zen: [0.08, 0.14, 0.32],
            hor: [0.66, 0.75, 0.86],
            fog: [120., 900.],
            light: [-0.5, 0.7, -0.3],
            shade: ONE,
        },
        night: Light {
            zen: [0.01, 0.02, 0.07],
            hor: [0.15, 0.2, 0.3],
            fog: [90., 620.],
            light: [0.4, 0.85, 0.3],
            shade: [0.3, 0.36, 0.52],
        },
        dawn: Light {
            zen: [0.2, 0.24, 0.46],
            hor: [0.95, 0.76, 0.76],
            fog: [110., 850.],
            light: [0.85, 0.3, -0.2],
            shade: [0.96, 0.88, 0.9],
        },
    },
    PalDef {
        low: [0.2, 0.14, 0.13],
        mid: [0.32, 0.22, 0.18],
        high: [0.5, 0.34, 0.25],
        rock: [0.13, 0.1, 0.1],
        day: Light {
            zen: [0.08, 0.02, 0.03],
            hor: [0.6, 0.22, 0.1],
            fog: [140., 1000.],
            light: [0.3, 0.6, 0.6],
            shade: ONE,
        },
        night: Light {
            zen: [0.02, 0.0, 0.01],
            hor: [0.3, 0.08, 0.03],
            fog: [100., 700.],
            light: [-0.3, 0.75, 0.5],
            shade: [0.5, 0.36, 0.34],
        },
        dawn: Light {
            zen: [0.16, 0.08, 0.12],
            hor: [0.82, 0.42, 0.22],
            fog: [130., 900.],
            light: [0.85, 0.35, 0.1],
            shade: [0.92, 0.8, 0.76],
        },
    },
    // The forest: a grey-green mist that closes in at 140 m, so every fight in it is close.
    PalDef {
        low: [0.2, 0.27, 0.15],
        mid: [0.28, 0.36, 0.2],
        high: [0.42, 0.48, 0.36],
        rock: [0.3, 0.3, 0.28],
        day: Light {
            zen: [0.32, 0.38, 0.4],
            hor: [0.58, 0.64, 0.6],
            fog: [30., 140.],
            light: [0.35, 0.8, -0.4],
            shade: ONE,
        },
        night: Light {
            zen: [0.02, 0.03, 0.04],
            hor: [0.1, 0.13, 0.12],
            fog: [20., 95.],
            light: [-0.3, 0.8, 0.45],
            shade: [0.32, 0.38, 0.46],
        },
        dawn: Light {
            zen: [0.24, 0.28, 0.36],
            hor: [0.8, 0.74, 0.62],
            fog: [30., 125.],
            light: [0.85, 0.3, 0.2],
            shade: [0.94, 0.88, 0.84],
        },
    },
];
/// Weather scales the fog and the radar (and so the AI's sight).
#[derive(Clone, Copy, Debug)]
pub struct WeatherDef {
    pub fog: f32,
    pub radar: f32,
    pub wind: f32,
}
pub static WEATHER: [WeatherDef; Weather::N] = [
    WeatherDef {
        fog: 1.,
        radar: 1.,
        wind: 0.,
    },
    WeatherDef {
        fog: 0.7,
        radar: 0.9,
        wind: 4.,
    },
    WeatherDef {
        fog: 0.5,
        radar: 0.8,
        wind: 2.5,
    },
    WeatherDef {
        fog: 0.35,
        radar: 0.5,
        wind: 9.,
    },
    WeatherDef {
        fog: 0.3,
        radar: 0.6,
        wind: 0.5,
    },
    WeatherDef {
        fog: 0.6,
        radar: 0.8,
        wind: 0.3,
    },
];
pub const RADAR_RANGE: f32 = 800.;

// --- missions ------------------------------------------------------------------------------------
/// A foe: a chassis placed by polar [bearing degrees, distance] from the map's centre (bearing 0 is
/// straight ahead at the start, 90 to the right), or on a ring when unplaced.
#[derive(Clone, Copy, Debug)]
pub struct Foe {
    pub ch: Ch,
    pub at: Option<[f32; 2]>,
    pub aware: Option<bool>,
    pub profile: Option<Profile>,
}
const fn foe(ch: Ch, b: f32, d: f32) -> Foe {
    Foe {
        ch,
        at: Some([b, d]),
        aware: None,
        profile: None,
    }
}
const fn asleep(ch: Ch, b: f32, d: f32) -> Foe {
    Foe {
        ch,
        at: Some([b, d]),
        aware: Some(false),
        profile: None,
    }
}
#[derive(Clone, Copy, Debug)]
pub struct Mission {
    pub key: &'static str,
    pub biome: Biome,
    pub seed: u32,
    pub time: TimeOfDay,
    pub weather: Weather,
    /// From one time of day into another over so many seconds.
    pub ramp: Option<(TimeOfDay, TimeOfDay, f32)>,
    pub foes: &'static [Foe],
    pub objective: Objective,
    /// The brief, in the board-book voice.
    pub intel: &'static str,
    /// TOWER TOPPLER and HELPLESS LIL BUDDIES need structures and trucks (M2).
    pub playable: bool,
}
/// Act I (the owner's names). Display names in names.rs.
pub static MISSIONS: [Mission; 4] = [
    Mission { key: "m01", biome: Biome::Dusk, seed: 7, time: TimeOfDay::Dusk, weather: Weather::Clear, ramp: None,
        foes: &[asleep(Ch::Jackal, 20., 600.), Foe { profile: Some(Profile::Brawler), ..foe(Ch::Jackal, 335., 460.) }], objective: Objective::Eliminate,
        intel: "Two scouts sleep by the road. Wake them up. Knock them down.", playable: true },
    Mission { key: "m02", biome: Biome::Dusk, seed: 20, time: TimeOfDay::Dusk, weather: Weather::Clear, ramp: None,
        foes: &[foe(Ch::Jackal, 345., 700.), asleep(Ch::Jackal, 30., 480.)], objective: Objective::Destroy,
        intel: "Three tall towers talk and talk. Knock them down. Someone will come.", playable: false },
    Mission { key: "m03", biome: Biome::Dusk, seed: 33, time: TimeOfDay::Dusk, weather: Weather::Clear, ramp: None, foes: &[], objective: Objective::Escort,
        intel: "Four little trucks drive down the valley. SKEDADDLEs come to catch them. Keep two trucks safe.", playable: false },
    Mission { key: "m04", biome: Biome::Dusk, seed: 46, time: TimeOfDay::Dusk, weather: Weather::Clear, ramp: Some((TimeOfDay::Dusk, TimeOfDay::Night, 240.)),
        foes: &[foe(Ch::Warden, 0., 720.), foe(Ch::Jackal, 330., 600.), foe(Ch::Jackal, 30., 640.)], objective: Objective::Eliminate,
        intel: "One big mech walks on four legs. Two little mechs walk with it. Stomp all three.", playable: true },
];
