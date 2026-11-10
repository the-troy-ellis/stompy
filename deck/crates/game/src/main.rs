//! Stompy for the Steam Deck.
//!   stompy               fullscreen (the setting), the title screen
//!   --window             in a window; --size W H its size
//!   --free               straight into Free Play; --seed N its seed
//!   --shot N file.ppm    save frame N and exit; --skip S runs the sim S seconds first;
//!   --demo               the mech flies itself; --debug the readout; --screen NAME and --mech N open a menu
//! The last five are for the tools (tools/shot.sh): screenshots on a box with no display.
// Indexed loops over parallel arrays and long drawing signatures read better here than the alternatives.
#![allow(
    clippy::needless_range_loop,
    clippy::too_many_arguments,
    clippy::neg_cmp_op_on_partial_ord
)]
mod app;
mod audio;
mod controls;
mod font;
mod gl;
mod hud;
mod mesh;
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
            "--debug" => a.debug = true,
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
