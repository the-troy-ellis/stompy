//! The crowd: what the sim costs a frame as mechs are added, every one of them fighting.
//! Not a pass/fail test; run it to measure: `cargo test --release -p stompy-sim --test crowd
//! -- --ignored --nocapture`.
use stompy_sim::data::*;
use stompy_sim::state::start_free_play;
use stompy_sim::update::update;
use stompy_sim::*;

#[test]
#[ignore]
fn crowd() {
    println!("mechs   ms/frame (avg)   ms/frame (worst)");
    for n in [8, 16, 32, 64, 128, 255] {
        let mut g = Game::new(1);
        start_free_play(
            &mut g,
            Biome::Dusk,
            TimeOfDay::Dusk,
            Weather::Clear,
            n,
            7,
            Ch::Kestrel,
            Diff::Hard,
            true,
        );
        // Everyone knows where everyone is, so everyone fights from the first frame.
        for m in g.mechs.iter_mut().skip(1) {
            m.ai.aware = true;
        }
        let i = Input::default();
        for _ in 0..60 {
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
        println!(
            "{:>5}   {:>8.3}         {:>8.3}",
            g.mechs.len(),
            total / frames as f64,
            worst
        );
    }
}
