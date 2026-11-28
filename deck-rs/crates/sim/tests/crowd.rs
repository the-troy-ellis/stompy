//! The crowd: what the sim costs a frame as mechs are added, two armies fighting each other.
//! Not a pass/fail test; run it to measure: `cargo test --release -p stompy-sim --test crowd
//! -- --ignored --nocapture`.
use stompy_sim::data::*;
use stompy_sim::state::start_battle;
use stompy_sim::update::update;
use stompy_sim::*;

#[test]
#[ignore]
fn crowd() {
    println!("mechs  alive  ms/frame (avg)  ms/frame (worst)  (two armies: 20 s in, 5 s timed)");
    for n in [8, 16, 32, 64, 128, 256] {
        let mut g = Game::new(1);
        let side = n / 2;
        start_battle(
            &mut g,
            Biome::Dusk,
            TimeOfDay::Dusk,
            side - 1,
            n - side,
            7,
            Ch::Kestrel,
            Diff::Hard,
            true,
        );
        let i = Input::default();
        // Twenty seconds in, the blocks have closed and everyone is fighting.
        for _ in 0..60 * 20 {
            update(&mut g, &i, 1. / 60.);
            g.events.clear();
        }
        let (mut total, mut worst, frames) = (0f64, 0f64, 300);
        for _ in 0..frames {
            let t = std::time::Instant::now();
            update(&mut g, &i, 1. / 60.);
            let ms = t.elapsed().as_secs_f64() * 1e3;
            g.events.clear();
            total += ms;
            worst = worst.max(ms);
        }
        let alive = g.mechs.iter().filter(|m| m.alive).count();
        println!(
            "{:>5}  {:>5}  {:>14.3}  {:>16.3}",
            g.mechs.len(),
            alive,
            total / frames as f64,
            worst
        );
    }
}
