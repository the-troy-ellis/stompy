//! Stompy for the Steam Deck.
//!   stompy               fullscreen (the setting), the title screen
//!   --window             in a window; --size W H its size
//!   --free               straight into Free Play; --seed N its seed
//!   --shot N file.ppm    save frame N and exit; --skip S runs the sim S seconds first;
//!   --demo               the mech flies itself; --debug the readout; --screen NAME and --mech N open a menu;
//!   --watch              a camera outside, following your own mech (clips of it walking);
//!   --watch-from A       the same from A radians round from its nose (0 in front, 3.1 behind)
//!   --battle A F         straight into a battle: A allies on your side, F foes on theirs;
//!   --spectate           with it, watch it with the free camera (Free Play's WATCH);
//!   --follow-fight       and keep the camera on the fighting (X every frame)
//!   --cockpit-pose N     force what the cockpit shows: 0 cool, 1 hot, 2 critical, 3 off, 4 hurt
//!   --record N K dir     save frames N to N+K-1 as dir/0000.ppm and on, then exit (clips)
//!   --dither N           the dither's cell for this run (0 off, 1, 2, 3); --detail N the models' (0 boxes, 1, 2)
//! The last five are for the tools (tools/shot.sh): screenshots on a box with no display.
// Indexed loops over parallel arrays and long drawing signatures read better here than the alternatives.
#![allow(
    clippy::needless_range_loop,
    clippy::too_many_arguments,
    clippy::neg_cmp_op_on_partial_ord
)]
mod anim;
mod app;
mod audio;
mod cockpit;
mod controls;
mod font;
mod freecam;
mod gl;
mod hud;
mod look;
mod mesh;
mod models;
mod platform;
mod scene;

use app::{App, Args, Screen};

fn main() {
    let mut a = Args {
        w: 1280,
        h: 800,
        fullscreen: None,
        free: false,
        seed: 0,
        shot: None,
        skip: 0.,
        demo: false,
        debug: false,
        screen: None,
        mech: None,
        dither: None,
        detail: None,
        record: None,
        watch: None,
        battle: None,
        spectate: false,
        follow: false,
        cockpit_pose: None,
    };
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut it = args.iter();
    let num = |s: Option<&String>| s.and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--window" => a.fullscreen = Some(false),
            "--fullscreen" => a.fullscreen = Some(true),
            "--free" => a.free = true,
            "--demo" => a.demo = true,
            "--watch" => a.watch = Some(1.1),
            "--spectate" => a.spectate = true,
            "--follow-fight" => a.follow = true,
            "--cockpit-pose" => a.cockpit_pose = Some(num(it.next()) as u8),
            "--battle" => {
                let (al, fo) = (num(it.next()) as usize, num(it.next()) as usize);
                a.battle = Some((al, fo));
            }
            "--watch-from" => a.watch = Some(num(it.next()) as f32),
            "--debug" => a.debug = true,
            "--dither" => a.dither = Some(num(it.next()) as u32),
            "--detail" => a.detail = Some(num(it.next()) as u8),
            "--seed" => a.seed = num(it.next()) as u32,
            "--skip" => a.skip = num(it.next()) as f32,
            "--mech" => a.mech = Some(num(it.next()) as usize),
            "--size" => {
                a.w = num(it.next()) as u32;
                a.h = num(it.next()) as u32;
            }
            "--shot" => {
                let n = num(it.next()) as u64;
                a.shot = it.next().map(|p| (n, p.clone()));
            }
            "--record" => {
                let (n, k) = (num(it.next()) as u64, num(it.next()) as u64);
                a.record = it.next().map(|p| (n, k, p.clone()));
            }
            "--screen" => {
                a.screen = match it.next().map(String::as_str) {
                    Some("main") => Some(Screen::Main),
                    Some("missions") => Some(Screen::Missions),
                    Some("free") => Some(Screen::Free),
                    Some("mech") => Some(Screen::Mech),
                    Some("settings") => Some(Screen::Settings),
                    _ => Some(Screen::Title),
                }
            }
            other => eprintln!("stompy: ignoring {other}"),
        }
    }
    match App::new(a) {
        Ok(mut app) => app.run(),
        Err(e) => {
            eprintln!("stompy: {e}");
            std::process::exit(1);
        }
    }
}
