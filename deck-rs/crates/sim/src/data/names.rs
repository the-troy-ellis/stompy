//! Every display name and line of text, in one place. Code, saves and data use
//! keys; the owner names things after seeing them, so renaming is a change here
//! and nowhere else.
use super::*;
use crate::keyed;

/// Every one the owner's, confirmed.
pub fn chassis_name(c: Ch) -> &'static str {
    match c {
        Ch::Kestrel => "BARRY",
        Ch::Jackal => "SKEDADDLE",
        Ch::Warden => "SLOWPOKE",
        Ch::Puncher => "PURPLE PUNCHER",
        Ch::Light1 => "BIG TROUBLE",
        Ch::Sniper1 => "LONG LARRY",
    }
}
/// Every one the owner's, confirmed.
pub fn weapon_name(w: Wpn) -> &'static str {
    match w {
        Wpn::Laser => "BIG ZAPPER",
        Wpn::Mlaser => "LIL ZAPPER",
        Wpn::Ac => "BIG BOOMER",
        Wpn::Lrm => "ANGRY BEES",
        Wpn::Fusion => "OOPS BUTTON",
        Wpn::Ppc => "ANGRY ZAPPER",
        Wpn::Plaser => "BLINKY",
        Wpn::Srm => "FIRECRACKERS",
        Wpn::Gauss => "BIG BONKER",
        Wpn::Mg => "RATATAT",
        Wpn::Flamer => "TOASTER",
    }
}
/// What the menu says about each mech, in the board-book voice.
pub fn chassis_role(c: Ch) -> &'static str {
    match c {
        Ch::Kestrel => "IT DOES A LITTLE OF EVERYTHING.",
        Ch::Jackal => "IT RUNS FAST. IT BREAKS FAST.",
        Ch::Warden => "FOUR LEGS. SLOW. DOES NOT STOP.",
        Ch::Puncher => "IT PUNCHES.",
        Ch::Light1 => "IT IS SMALL. IT IS RUDE.",
        Ch::Sniper1 => "LONG LEGS. LONG GUN.",
    }
}
pub fn chassis_kit(c: Ch) -> &'static str {
    match c {
        Ch::Kestrel => "2X BIG ZAPPER - BIG BOOMER - ANGRY BEES - OOPS BUTTON",
        Ch::Jackal => "2X LIL ZAPPER - OOPS BUTTON",
        Ch::Warden => "BIG ZAPPER - BIG BOOMER - ANGRY BEES - OOPS BUTTON",
        Ch::Puncher => "BIG BOOMER - FIRECRACKERS - OOPS BUTTON - FISTS",
        Ch::Light1 => "FIRECRACKERS - LIL ZAPPER - RATATAT - OOPS BUTTON",
        Ch::Sniper1 => "BIG BONKER - ANGRY ZAPPER - LIL ZAPPER - OOPS BUTTON",
    }
}
/// Act I's, the owner's.
pub const MISSION_NAMES: [&str; 4] = [
    "LIL SNOOZERS",
    "TOWER TOPPLER",
    "HELPLESS LIL BUDDIES",
    "FOUR LEGS BAD",
];
pub fn cat_label(c: Cat) -> &'static str {
    ["ENERGY", "BALLISTIC", "MISSILE", "FUSION"][c.i()]
}
pub fn section_name(s: Sec) -> &'static str {
    ["Torso", "Left arm", "Right arm", "Left leg", "Right leg"][s.i()]
}
pub fn diff_label(d: Diff) -> &'static str {
    ["EASY", "NORMAL", "HARD"][d.i()]
}
pub fn biome_name(b: Biome) -> &'static str {
    ["DUSK DESERT", "GLACIER", "VOLCANIC PLAIN", "FOREST"][b.i()]
}
pub fn time_name(t: TimeOfDay) -> &'static str {
    ["DAY", "DUSK", "NIGHT", "DAWN"][t.i()]
}
keyed!(/// The debrief's one word: drafts until the owner picks.
    Verdict { Won, Untouched, Punched, Lost, Awkward, Flattened });
pub fn verdict(v: Verdict) -> &'static str {
    [
        "STOMPED.",
        "UNTOUCHED.",
        "PUNCHED.",
        "SQUASHED.",
        "AWKWARD.",
        "FLATTENED.",
    ][v.i()]
}
keyed!(/// The cockpit voice's pools: the first line is flat, the rest are dry.
    Vo { Kill, KillPunch, KillStomp, LegLost, ArmLost, LegsLost, Shutdown, Online, Complete, Failed, Inbound });
pub fn voice_pool(v: Vo) -> &'static [&'static str] {
    match v {
        Vo::Kill => &["Target destroyed.", "Target stomped.", "That one is done."],
        Vo::KillPunch => &["Target punched.", "Fist contact confirmed."],
        Vo::KillStomp => &["Target stomped.", "Target stomped. Literally."],
        Vo::LegLost => &[
            "Leg destroyed.",
            "Leg destroyed. Recommend hopping.",
            "Leg destroyed. Speed is now optional.",
        ],
        Vo::ArmLost => &["Arm destroyed.", "Arm destroyed. We have another."],
        Vo::LegsLost => &["Legs destroyed.", "Legs destroyed. We are now a turret."],
        Vo::Shutdown => &["Reactor shutdown.", "Reactor shutdown. Please hold."],
        Vo::Online => &["Reactor online.", "Reactor online. Carry on."],
        Vo::Complete => &["Mission complete.", "Mission complete. Good stomping."],
        Vo::Failed => &["Mission failed."],
        Vo::Inbound => &["Reinforcements inbound."],
    }
}
/// Seconds between dry lines: at most one a minute.
pub const DRY_GAP: f32 = 60.;
/// Warnings stay flat, always.
pub const WARN_HEAT: &str = "Warning. Heat critical.";
pub const WARN_DAMAGE: &str = "Warning. Critical damage.";
pub const FUSION_LINE: &str = "Resonance discharge. Reactor overload. Torso damage.";
