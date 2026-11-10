//! The headless sim tests: the invariants and the acceptance criteria of
//! docs/specs/00-core.md and 01-thunk.md.
#![allow(clippy::needless_range_loop)]
mod common;
use common::*;
use stompy_sim::beams::MELT_T;
use stompy_sim::combat::damage;
use stompy_sim::geom::{center_of, torso_frame};
use stompy_sim::melee::{knock, melee_of, melee_press, punch_arm};
use stompy_sim::spring::Spring;

#[test]
fn data_merges_body_plans() {
    let p = geo_for(Ch::Puncher);
    assert_eq!((p.hip, p.l1, p.girth, p.n_legs), (5.0, 2.6, 1.35, 2));
    assert!(
        (p.leg_top - 4.8).abs() < 1e-4 && (p.torso_y - 5.4).abs() < 1e-4,
        "a hip of 5.0 lifts leg_top and torso_y by 0.4"
    );
    let s = geo_for(Ch::Sniper1);
    assert!(s.n_legs == 2 && s.legs()[0].hx == 0.7 && (s.height - 8.7).abs() < 1e-4);
    assert_eq!(geo_for(Ch::Warden).n_legs, 4);
    assert_eq!(geo_for(Ch::Jackal).knee, Knee::Back);
    assert_eq!(
        geo_for(Ch::Light1).height,
        7.6,
        "an explicit height is not shifted by the hip"
    );
    assert!(weapon(Wpn::Fusion).overload == 140. && weapon(Wpn::Laser).hps == 12.);
    assert_eq!(chassis_name(Ch::Kestrel), "BARRY");
    assert_eq!(weapon_name(Wpn::Fusion), "OOPS BUTTON");
}
#[test]
fn every_stock_loadout_fits_its_tonnage() {
    for c in &CHASSIS {
        let t = c.frame
            + c.sinks as f32
            + c.armour as f32 * 2.
            + c.jets as f32 * 1.5
            + c.hard.iter().map(|h| weapon(h.stock).tons).sum::<f32>();
        assert!(t <= c.tons, "{:?}: {} > {}", c.key, t, c.tons);
        for h in c.hard {
            assert_eq!(
                weapon(h.stock).cat,
                h.cat,
                "{:?}'s {} is locked to its category",
                c.key,
                h.id
            );
        }
    }
}

/// Feet never slide: a planted foot's world position is fixed until it lifts.
#[test]
fn feet_never_slide_on_any_chassis() {
    for &ch in Ch::ALL {
        let mut g = flat_game(ch, 3);
        let mut i = input();
        i.thr = 1.;
        let n = g.p().geo.n_legs;
        let mut was: Vec<(V3, bool)> = (0..n)
            .map(|k| (g.p().feet[k].pos, g.p().feet[k].lifted))
            .collect();
        let (mut slide, mut lift, mut downs) = (0f32, 0f32, 0);
        for _ in 0..60 * 12 {
            update(&mut g, &i, DT);
            let p = g.p();
            for k in 0..n {
                let f = p.feet[k];
                if !f.lifted && !was[k].1 {
                    slide = slide.max(hypot2(f.pos.x - was[k].0.x, f.pos.z - was[k].0.z));
                }
                if f.lifted {
                    lift = lift.max(f.pos.y - g.ter.height(f.pos.x, f.pos.z));
                }
                if !f.lifted && was[k].1 {
                    downs += 1;
                }
                was[k] = (f.pos, f.lifted);
            }
        }
        let p = g.p();
        assert!(slide < 1e-3, "{ch:?}: a planted foot slid {slide} m");
        assert!(p.z > p.ch.speed * 12. * 0.7, "{ch:?} walked only {} m", p.z);
        assert!(downs > 10, "{ch:?} took {downs} steps");
        assert!(lift > 0.2, "{ch:?}'s feet never lifted");
        assert_eq!(
            sfx_count(&g, "step"),
            downs,
            "{ch:?}: a step sound per footfall"
        );
        for k in 0..n {
            let d = (p.feet[k].pos - v3(p.x, p.y + p.geo.hip * p.ch.scale, p.z)).len();
            assert!(
                d < (p.geo.l1 + p.geo.l2) * p.ch.scale * 1.2,
                "{ch:?} leg {k} overstretched"
            );
        }
    }
}
#[test]
fn the_gait_clock_is_distance_not_time() {
    let mut g = flat_game(Ch::Kestrel, 3);
    let mut i = input();
    steps(&mut g, &i, 120);
    assert_eq!(sfx_count(&g, "step"), 0);
    assert_eq!(g.p().z, 0.);
    i.thr = 1.;
    steps(&mut g, &i, 240);
    let (n, bass, _) = thumps(&g);
    assert!(n > 5 && bass > 0., "a step is felt: the bass");
    assert!(g.bob.x != 0. || g.bob_in.x != 0., "and the camera's bob");
}

/// Heat 100 shuts the reactor down; 45 restarts it. Shutdown halts movement and firing.
#[test]
fn heat_shuts_down_at_100_and_restarts_at_45() {
    let mut g = flat_game(Ch::Kestrel, 5);
    let mut i = input();
    i.energy = true;
    i.thr = 1.;
    let (mut shut_at, mut back_at, mut peak) = (None, None, 0f32);
    for f in 0..60 * 40 {
        update(&mut g, &i, DT);
        let p = g.p();
        peak = peak.max(p.heat);
        if p.shutdown && shut_at.is_none() {
            shut_at = Some(f);
        }
        if p.shutdown {
            assert!(!p.beaming);
        }
        if shut_at.is_some() && !p.shutdown && back_at.is_none() {
            back_at = Some(f);
            assert!(p.heat < 45.5, "restarted at {}", p.heat);
            assert!(p.speed < 0.5, "it stopped while shut down");
            break;
        }
    }
    assert!(shut_at.is_some() && back_at > shut_at, "peak {peak}");
    assert!((100. ..101.).contains(&peak), "peak {peak}");
    assert!(
        said(&g, "Reactor shutdown") && said(&g, "Reactor online") && said(&g, "Heat critical")
    );
    assert_eq!(
        (sfx_count(&g, "powerdown"), sfx_count(&g, "powerup")),
        (1, 1)
    );
}

/// Melt belongs to the target: shared by every beam on it; the shooter does not melt.
#[test]
fn beams_melt_the_target_not_the_shooter() {
    let mut g = flat_game(Ch::Kestrel, 7);
    let e = foe(&mut g, Ch::Warden, 0., 60., PI);
    let mut i = input();
    i.energy = true;
    let hp0 = total_hp(&g.mechs[e]);
    steps(&mut g, &i, 60 * 3 + 5);
    assert!(g.mechs[e].melt >= MELT_T - 0.01, "melt {}", g.mechs[e].melt);
    assert_eq!(g.p().melt, 0.);
    assert_eq!(g.p().beam_mech, Some(e));
    let dealt = hp0 - total_hp(&g.mechs[e]);
    assert!(
        dealt > 2. * 3.5 * 3. * 1.3 && dealt < 2. * 3.5 * 3. * 3.5,
        "dealt {dealt} over 3 s: between cold and full melt"
    );
    i.energy = false;
    steps(&mut g, &i, 60 * 3);
    assert_eq!(g.mechs[e].melt, 0., "full to cold in 2 s");
}
#[test]
fn sections_come_off_and_both_legs_sit_it_down() {
    let mut g = flat_game(Ch::Kestrel, 7);
    let e = foe(&mut g, Ch::Kestrel, 0., 40., PI);
    let d0 = g.debris.len();
    let arm = torso_frame(&g.mechs[e]).apply(v3(g.mechs[e].geo.arm_x, g.mechs[e].geo.arm_y, 0.5));
    damage(&mut g, e, arm, 40., Some(PLAYER), false, false);
    let m = &g.mechs[e];
    assert!(m.hp[Sec::LA.i()] == 0. && m.alive);
    assert!(
        m.w[0].mount == Sec::LA && m.w[0].dead,
        "the arm's weapon dies with it"
    );
    assert!(g.debris.len() > d0, "the arm comes off");
    assert!(
        m.hp[Sec::T.i()] < m.max[Sec::T.i()],
        "the overflow goes to the torso"
    );
    g.mechs[e].hp[Sec::T.i()] = g.mechs[e].max[Sec::T.i()];
    let ey = g.mechs[e].y;
    damage(
        &mut g,
        e,
        v3(-1., ey + 1., 40.),
        50.,
        Some(PLAYER),
        false,
        false,
    );
    damage(
        &mut g,
        e,
        v3(1., ey + 1., 40.),
        50.,
        Some(PLAYER),
        false,
        false,
    );
    assert!(
        g.mechs[e].hp[Sec::LL.i()] == 0. && g.mechs[e].hp[Sec::RL.i()] == 0. && g.mechs[e].alive
    );
    g.mechs[e].throttle = 1.;
    steps(&mut g, &input(), 60);
    assert!(g.mechs[e].speed.abs() < 0.01, "sat down: a turret");
}
#[test]
fn death_has_its_beat_then_a_wreck_and_the_win() {
    let mut g = flat_game(Ch::Kestrel, 7);
    let e = foe(&mut g, Ch::Kestrel, 0., 40., PI);
    let c = center_of(&g.mechs[e]);
    damage(&mut g, e, c, 500., Some(PLAYER), false, false);
    assert!(!g.mechs[e].alive && g.mechs[e].dying.is_some() && g.stats.kills == 1);
    let boom0 = sfx_count(&g, "boom");
    steps(&mut g, &input(), 10);
    assert_eq!(
        sfx_count(&g, "boom"),
        boom0,
        "a quarter second of silence first"
    );
    steps(&mut g, &input(), 10);
    assert!(sfx_count(&g, "boom") > boom0, "then the torso blows");
    steps(&mut g, &input(), 120);
    assert!(g.mechs[e].gone && g.wrecks.len() == 1);
    assert!(g.state == State::Over && g.won);
    assert!(said(&g, "Mission complete"));
}
#[test]
fn the_players_death_ends_the_match() {
    let mut g = flat_game(Ch::Jackal, 7);
    let c = center_of(g.p());
    damage(&mut g, PLAYER, c, 1000., None, false, false);
    assert!(!g.p().alive && g.state == State::Over && !g.won);
    steps(&mut g, &input(), 60 * 4);
    assert_eq!(g.state, State::Debrief);
    assert_eq!(g.verdict(), Verdict::Lost);
}
#[test]
fn the_autocannon_hits_for_its_damage_uses_ammo_and_kicks() {
    let mut g = flat_game(Ch::Kestrel, 7);
    let e = foe(&mut g, Ch::Warden, 0., 80., PI);
    ready(&mut g, PLAYER);
    let mut i = input();
    i.ballistic = true;
    let hp0 = total_hp(&g.mechs[e]);
    update(&mut g, &i, DT);
    assert!(g.p().w[2].key == Wpn::Ac && g.p().w[2].ammo == 29 && g.kick > 0.);
    steps(&mut g, &input(), 60);
    let dealt = hp0 - total_hp(&g.mechs[e]);
    assert!((dealt - 11.).abs() < 0.01, "dealt {dealt}");
    assert_eq!((sfx_count(&g, "cannon"), sfx_count(&g, "clang")), (1, 0));
}

#[test]
fn a_shove_moves_light_mechs_far_and_heavy_ones_little() {
    let mut g = flat_game(Ch::Kestrel, 9);
    let j = foe(&mut g, Ch::Jackal, 0., 8., PI);
    let mut i = input();
    i.punch = true;
    update(&mut g, &i, DT);
    assert!(g.p().melee.is_some());
    let jz = g.mechs[j].z;
    steps(&mut g, &input(), 60);
    assert!(
        g.mechs[j].z - jz >= 6.,
        "a SKEDADDLE moved {} m",
        g.mechs[j].z - jz
    );
    assert!(g.p().z < 0., "the shover recoils");
    assert!(g.farthest_shove > 0. && sfx_count(&g, "punch") == 1);
    let mut g = flat_game(Ch::Kestrel, 9);
    let w = foe(&mut g, Ch::Warden, 0., 10., PI);
    update(&mut g, &i, DT);
    let wz = g.mechs[w].z;
    steps(&mut g, &input(), 60);
    assert!(
        g.mechs[w].z - wz < 3.,
        "a SLOWPOKE moved {} m",
        g.mechs[w].z - wz
    );
}
#[test]
fn no_punch_while_shut_down_or_mid_swing() {
    let mut g = flat_game(Ch::Kestrel, 9);
    g.pm().shutdown = true;
    assert!(!melee_press(&mut g, PLAYER));
    g.pm().shutdown = false;
    assert!(melee_press(&mut g, PLAYER));
    assert!(!melee_press(&mut g, PLAYER), "not during the wind-up");
    steps(&mut g, &input(), 30);
    assert!(
        g.p().melee.is_some() && !melee_press(&mut g, PLAYER),
        "not during the recovery"
    );
    steps(&mut g, &input(), 60);
    assert!(
        g.p().melee.is_none() && sfx_count(&g, "punch") == 1,
        "a whiff"
    );
}
#[test]
fn purple_puncher_punches_with_whichever_fist_it_has() {
    let mut g = flat_game(Ch::Puncher, 9);
    assert!(std::ptr::eq(melee_of(g.p()), &FIST_MELEE));
    g.pm().hp[Sec::LA.i()] = 0.;
    assert!(std::ptr::eq(melee_of(g.p()), &FIST_MELEE) && punch_arm(g.p()) == Some(Sec::RA));
    g.pm().hp[Sec::RA.i()] = 0.;
    assert!(
        std::ptr::eq(melee_of(g.p()), &DEFAULT_MELEE),
        "no fists: it shoves"
    );
}
#[test]
fn a_fall_onto_a_mech_stomps_it_and_a_hop_does_not() {
    let mut g = flat_game(Ch::Kestrel, 9);
    let j = foe(&mut g, Ch::Jackal, 0., 0.5, 0.);
    let top = g.mechs[j].top();
    let p = g.pm();
    (p.y, p.air, p.vy) = (top + 12., true, 0.);
    let t0 = g.mechs[j].hp[Sec::T.i()];
    steps(&mut g, &input(), 120);
    assert!(
        t0 - g.mechs[j].hp[Sec::T.i()] >= DEFAULT_MELEE.stomp_dmg - 0.01,
        "stomp dealt {}",
        t0 - g.mechs[j].hp[Sec::T.i()]
    );
    let mut g = flat_game(Ch::Kestrel, 9);
    let j = foe(&mut g, Ch::Jackal, 0., 0.5, 0.);
    let top = g.mechs[j].top();
    let p = g.pm();
    (p.y, p.air, p.vy, p.air_t) = (top + 1., true, 0., 0.);
    let t0 = g.mechs[j].hp[Sec::T.i()];
    steps(&mut g, &input(), 60);
    assert_eq!(g.mechs[j].hp[Sec::T.i()], t0);
}

#[test]
fn the_oops_button_kills_and_the_reactor_pays() {
    let mut g = flat_game(Ch::Kestrel, 11);
    let e = foe(&mut g, Ch::Warden, 0., 120., PI);
    let mut i = input();
    i.fusion = true;
    steps(&mut g, &i, 60 * 3 + 40);
    let p = g.p();
    assert!(!g.mechs[e].alive);
    assert!(p.heat >= 120. && p.shutdown, "heat {}", p.heat);
    assert!(
        (p.hp[Sec::T.i()] - p.max[Sec::T.i()] * 0.65).abs() < 1.,
        "torso {}",
        p.hp[Sec::T.i()]
    );
    assert_eq!(sfx_count(&g, "fusioncrack"), 1);
    let f = p.w.last().unwrap();
    assert!(f.def.kind == WKind::Fusion && f.cd > 20.);
}
#[test]
fn a_short_slip_pauses_the_scan() {
    let mut g = flat_game(Ch::Kestrel, 11);
    let e = foe(&mut g, Ch::Warden, 0., 120., PI);
    let mut i = input();
    i.fusion = true;
    steps(&mut g, &i, 60);
    assert!(g.p().fusion.mech == Some(e) && g.p().fusion.t > 0.8);
    let t = g.p().fusion.t;
    g.pm().twist = 1.5;
    steps(&mut g, &i, 12);
    let f = g.p().fusion;
    assert!(f.mech == Some(e) && f.slipping && (f.t - t).abs() < 0.01);
    steps(&mut g, &i, 30);
    let f = g.p().fusion;
    assert!(f.mech.is_none() || f.t < t);
}

#[test]
fn jets_charge_blast_off_and_land_hard() {
    let mut g = flat_game(Ch::Kestrel, 13);
    let mut i = input();
    i.jets = true;
    steps(&mut g, &i, 30);
    assert!(g.p().jet.charge > 0.4 && !g.p().air);
    i.jets = false;
    update(&mut g, &i, DT);
    let p = g.p();
    assert!(p.air && p.vy > 10. && p.fuel < 0.1 && p.heat > 3. && sfx_count(&g, "blastoff") == 1);
    let (mut top, mut landed) = (0f32, false);
    for _ in 0..60 * 8 {
        update(&mut g, &i, DT);
        top = top.max(g.p().y);
        if !g.p().air {
            landed = true;
            break;
        }
    }
    assert!(landed && top > 8., "top {top}");
    assert!(sfx_count(&g, "land") == 1 && g.kick > 0.);
    let p = g.pm();
    (p.shutdown, p.heat) = (true, 100.);
    i.jets = true;
    steps(&mut g, &i, 60);
    assert!(
        g.p().jet.charge == 0. && !g.p().air,
        "no jets with the reactor down"
    );
}

#[test]
fn missiles_need_a_lock_to_home() {
    let mut g = flat_game(Ch::Kestrel, 15);
    let e = foe(&mut g, Ch::Warden, 0., 300., PI);
    g.target = Some(e);
    ready(&mut g, PLAYER);
    let mut i = input();
    update(&mut g, &i, DT);
    assert!(g.lock && g.lock_on && sfx_count(&g, "lock") == 1);
    i.missile_tap = true;
    update(&mut g, &i, DT);
    assert!(g.shots.len() == 10 && g.shots[0].target == Some(e));
    let hp0 = total_hp(&g.mechs[e]);
    steps(&mut g, &input(), 60 * 6);
    assert!(hp0 - total_hp(&g.mechs[e]) > 5., "missiles dealt little");
    assert!(sfx_count(&g, "missile") == 1 && sfx_count(&g, "boom") >= 5);
}
#[test]
fn hold_to_guide_and_let_go_to_detonate() {
    let mut g = flat_game(Ch::Kestrel, 15);
    ready(&mut g, PLAYER);
    let mut i = input();
    i.missile = true;
    steps(&mut g, &i, 20);
    assert!(g.guide.is_some_and(|gd| gd.n == 10));
    i.missile = false;
    update(&mut g, &i, DT);
    assert!(g.guide.is_none() && g.shots.is_empty());
}
#[test]
fn firecrackers_fly_without_a_lock() {
    let mut g = flat_game(Ch::Puncher, 15);
    ready(&mut g, PLAYER);
    let mut i = input();
    i.missile_tap = true;
    update(&mut g, &i, DT);
    assert!(g.shots.len() == 6 && g.shots[0].target.is_none());
}

#[test]
fn springs_converge() {
    let mut s = Spring::new(WOBBLE_K, WOBBLE_ZETA);
    s.kick(3.);
    let mut peak = 0f32;
    for _ in 0..120 {
        s.step(DT, 0.);
        peak = peak.max(s.x.abs());
    }
    assert!(s.x.is_finite() && s.x.abs() < 0.01 && peak > 0.05);
}
#[test]
fn every_feel_row_is_wired() {
    let mut g = flat_game(Ch::Kestrel, 17);
    let chest = v3(g.p().x, g.p().y + 5.5, g.p().z + 1.);
    damage(&mut g, PLAYER, chest, 10., None, false, false);
    let r = feel_row(Feel::Hit);
    assert!(
        (g.kick - r.kick).abs() < 1e-5
            && (g.shake - r.shake).abs() < 1e-5
            && (g.flash - r.flash).abs() < 1e-5
            && g.p().wob_p.v > 0.
    );
    assert_eq!(sfx_count(&g, "clang"), 1);
    assert_eq!(thumps(&g).2, r.haptic);
}
#[test]
fn reduced_motion_cuts_the_camera_and_the_rumble() {
    let mut g = flat_game(Ch::Kestrel, 17);
    g.reduced_motion = true;
    let chest = v3(g.p().x, g.p().y + 5.5, g.p().z + 1.);
    damage(&mut g, PLAYER, chest, 10., None, false, false);
    assert!((g.kick - feel_row(Feel::Hit).kick * 0.3).abs() < 1e-5);
    assert_eq!(thumps(&g).2, 0.);
    assert!(g.p().wob_p.v > 0., "the mech still wobbles");
}
#[test]
fn knockback_jolts_the_aim() {
    let mut g = flat_game(Ch::Kestrel, 17);
    knock(&mut g, PLAYER, None, 10., [0., 1.], false);
    assert!(g.p().twist.abs() > 0.2 && g.p().pitch > 0.05 && g.p().push[1] == 10.);
}
#[test]
fn shutdown_sags_and_the_restart_overshoots() {
    let mut g = flat_game(Ch::Kestrel, 17);
    g.pm().heat = 101.;
    steps(&mut g, &input(), 60);
    assert!(g.p().shutdown && g.p().sag.x > 0.3);
    g.pm().heat = 44.;
    update(&mut g, &input(), DT);
    assert!(!g.p().shutdown && g.p().sag.v < 0.);
}

#[test]
fn the_ai_keeps_under_its_heat_cap_and_hits_back() {
    for &d in Diff::ALL {
        let mut g = Game::new(21);
        start_free_play(
            &mut g,
            Biome::Dusk,
            TimeOfDay::Dusk,
            Weather::Clear,
            4,
            21,
            Ch::Kestrel,
            d,
            true,
        );
        for m in g.mechs.iter_mut().skip(1) {
            m.ai.aware = true;
            m.x *= 0.4;
            m.z *= 0.4;
        }
        g.pm().hp[Sec::T.i()] = 1e6;
        g.pm().max[Sec::T.i()] = 1e6;
        let mut worst = 0f32;
        for _ in 0..60 * 60 {
            update(&mut g, &input(), DT);
            for m in g.mechs.iter().skip(1) {
                if m.alive && !m.fusion.on {
                    worst = worst.max(m.heat - DIFFS[d.i()].heat_cap);
                }
            }
        }
        assert!(worst < 5., "{d:?}: over the cap by {worst}");
        assert!(
            g.stats.taken > 0.,
            "{d:?}: the enemies never hit the player"
        );
    }
}
#[test]
fn the_ai_cannot_see_through_a_hill() {
    let mut g = flat_game(Ch::Kestrel, 23);
    let e = new_mech(&mut g, Ch::Jackal, 1, 0., 200., PI).unwrap();
    g.mechs[e].ai.aware = true;
    // A ridge between them: raise a band of cells at z 80 to 130.
    for j in 0..=g.ter.nz {
        let z = -g.ter.hz + j as f32 * stompy_sim::terrain::CELL;
        if z > 80. && z < 130. {
            for i in 0..=g.ter.nx {
                g.ter.set(i, j, 60.);
            }
        }
    }
    steps(&mut g, &input(), 30);
    assert!(!g.mechs[e].ai.seen);
    g.pm().x = 150.;
    steps(&mut g, &input(), 60);
    let b = g.mechs[e].ai.belief.map_or(0., |b| b.0.x);
    assert!(
        b.abs() < 1.,
        "belief x {b}: it stays where it last saw them"
    );
}
#[test]
fn heavies_hold_the_line_and_harassers_flip_when_hit() {
    let mut g = flat_game(Ch::Kestrel, 25);
    let w = new_mech(&mut g, Ch::Warden, 1, 0., 400., PI).unwrap();
    let k = new_mech(&mut g, Ch::Kestrel, 1, 30., 400., PI).unwrap();
    g.mechs[k].ai.profile = Profile::Line;
    g.mechs[w].ai.aware = true;
    g.mechs[k].ai.aware = true;
    steps(&mut g, &input(), 120);
    assert!(
        g.mechs[k].speed <= g.mechs[w].max_speed + 0.5,
        "a BARRY in the line walks at a SLOWPOKE's pace"
    );
    let mut g = flat_game(Ch::Kestrel, 27);
    let j = new_mech(&mut g, Ch::Jackal, 1, 0., 170., PI).unwrap();
    g.mechs[j].ai.aware = true;
    steps(&mut g, &input(), 60);
    let s0 = g.mechs[j].ai.strafe;
    let c = center_of(&g.mechs[j]);
    damage(&mut g, j, c, 1., Some(PLAYER), false, false);
    steps(&mut g, &input(), 2);
    assert_eq!(g.mechs[j].ai.strafe, -s0);
}
#[test]
fn an_adjacent_enemy_punches_on_hard() {
    let mut g = Game::new(29);
    start_free_play(
        &mut g,
        Biome::Dusk,
        TimeOfDay::Dusk,
        Weather::Clear,
        0,
        29,
        Ch::Kestrel,
        Diff::Hard,
        true,
    );
    let j = new_mech(&mut g, Ch::Jackal, 1, 0., 7., PI).unwrap();
    g.mechs[j].ai.aware = true;
    let mut punched = false;
    for _ in 0..180 {
        update(&mut g, &input(), DT);
        punched |= g.mechs[j].melee.is_some();
    }
    assert!(punched);
}
#[test]
fn missions_start_with_their_foes() {
    for (k, m) in MISSIONS.iter().enumerate().filter(|(_, m)| m.playable) {
        let mut g = Game::new(1);
        start_mission(&mut g, k, Ch::Kestrel, Diff::Normal, false);
        assert_eq!(g.enemies_left(), m.foes.len());
        assert_eq!(g.state, State::Play);
    }
}
