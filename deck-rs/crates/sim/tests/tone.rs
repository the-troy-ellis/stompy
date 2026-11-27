//! The tone guide, as tests: briefs in the board-book voice, the voice flat and short.
mod common;
use common::*;
use stompy_sim::voice::voice_line;

fn words(s: &str) -> usize {
    s.split([' ', '.']).filter(|w| !w.is_empty()).count()
}
#[test]
fn briefs_are_board_book() {
    for m in &MISSIONS {
        let b = m.intel;
        assert!(
            !b.contains('!') && !b.contains('?'),
            "{}: no exclamation or question marks",
            m.key
        );
        assert!(
            !b.chars().any(|c| c.is_ascii_digit()),
            "{}: numbers as words",
            m.key
        );
        assert!(b.ends_with('.'));
        let sentences: Vec<&str> = b
            .split('.')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect();
        assert!(
            (1..=4).contains(&sentences.len()),
            "{}: {} sentences",
            m.key,
            sentences.len()
        );
        for s in sentences {
            assert!(words(s) <= 8, "{}: \"{s}\" is over eight words", m.key);
        }
    }
}
#[test]
fn the_voice_is_flat_and_short() {
    for &v in Vo::ALL {
        for l in voice_pool(v) {
            assert!(
                words(l) <= 7 && !l.contains('!') && l.ends_with('.'),
                "voice line: {l}"
            );
        }
    }
    for l in [WARN_HEAT, WARN_DAMAGE] {
        assert!(
            l.starts_with("Warning. ") && words(l) <= 4,
            "warnings stay flat: {l}"
        );
    }
}
#[test]
fn role_lines_and_verdicts() {
    for &c in Ch::ALL {
        assert!(!chassis_role(c).contains('!') && words(chassis_role(c)) <= 12);
    }
    for &v in Verdict::ALL {
        assert!(words(verdict(v)) == 1 && verdict(v).ends_with('.'));
    }
}
#[test]
fn never_a_dry_line_twice_and_one_a_minute() {
    let mut g = flat_game(Ch::Kestrel, 31);
    let dry = (0..20)
        .filter(|_| voice_line(&mut g, Vo::Kill, None) != voice_pool(Vo::Kill)[0])
        .count();
    assert!(dry <= 1);
}
