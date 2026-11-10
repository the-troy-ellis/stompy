//! Starting a match: the ground, the palette, the player and the foes.
use crate::data::*;
use crate::game::*;
use crate::math::*;
use crate::rng::Rng;
use crate::spring::Spring;
use crate::terrain::Terrain;
use crate::{feel, gait};

impl Game {
    pub fn new(seed: u32) -> Game {
        Game {
            state: State::Brief,
            paused: false,
            won: false,
            end_t: 0.,
            mechs: Vec::with_capacity(MAX_MECHS),
            shots: Vec::with_capacity(MAX_SHOTS),
            parts: Vec::with_capacity(MAX_PARTS),
            debris: vec![],
            wrecks: vec![],
            pulses: vec![],
            cbeams: vec![],
            msgs: vec![],
            scorch: vec![],
            scorch_at: 0,
            eye: V3::ZERO,
            view: v3(0., 0., 1.),
            aim: V3::ZERO,
            aim_mech: None,
            target: None,
            lock: false,
            lock_on: false,
            flash: 0.,
            shake: 0.,
            kick: 0.,
            white_flash: 0.,
            hit_mark: 0.,
            hit_stop: 0.,
            twist_rate: 0.,
            last_twist: 0.,
            beam_on_at: None,
            bob: Spring::new(BOB_K, BOB_ZETA),
            bob_in: Spring::new(BOB_K, BOB_ZETA),
            zoom: false,
            reduced_motion: false,
            guide: None,
            m_down: false,
            m_at: 0.,
            m_vid: 0,
            volley_seq: 0,
            last_volley: 0,
            time: 0.,
            frame: 0,
            ter: Terrain::new(seed, true),
            biome: Biome::Dusk,
            time_of_day: TimeOfDay::Dusk,
            weather: Weather::Clear,
            pal: PALS[0].day,
            ramp: None,
            rng: Rng::new(seed),
            events: vec![],
            input: Input::default(),
            diff: Diff::Normal,
            mission: None,
            stats: Stats::default(),
            farthest_shove: 0.,
            punch_ready: false,
            death: DeathInfo::default(),
            last_kill: None,
            voice: VoiceBook::default(),
        }
    }
}
/// A biome's light at a time of day ('day' and 'dusk' are the biome's own).
pub fn pal_at(b: Biome, t: TimeOfDay) -> Light {
    let p = &PALS[b.i()];
    match t {
        TimeOfDay::Night => p.night,
        TimeOfDay::Dawn => p.dawn,
        _ => p.day,
    }
}
fn norm3(l: [f32; 3]) -> [f32; 3] {
    let v = v3(l[0], l[1], l[2]).norm();
    [v.x, v.y, v.z]
}
pub fn blend_pal(a: &Light, b: &Light, t: f32) -> Light {
    let m = |x: [f32; 3], y: [f32; 3]| {
        [
            lerp(x[0], y[0], t),
            lerp(x[1], y[1], t),
            lerp(x[2], y[2], t),
        ]
    };
    Light {
        zen: m(a.zen, b.zen),
        hor: m(a.hor, b.hor),
        fog: [lerp(a.fog[0], b.fog[0], t), lerp(a.fog[1], b.fog[1], t)],
        light: norm3(m(a.light, b.light)),
        shade: m(a.shade, b.shade),
    }
}
/// How dark it is: 0 (day, dusk, dawn) to 1 (night).
pub fn darkness(p: &Light) -> f32 {
    clamp(
        (0.8 - (p.shade[0] + p.shade[1] + p.shade[2]) / 3.) / 0.35,
        0.,
        1.,
    )
}
/// The fog's near and far after the weather.
pub fn fog_of(g: &Game) -> [f32; 2] {
    let f = WEATHER[g.weather.i()].fog;
    [g.pal.fog[0] * f, g.pal.fog[1] * f]
}

/// A new mech with its stock loadout, its AI, its feet and its springs. Returns its index.
pub fn new_mech(g: &mut Game, ch: Ch, team: u8, x: f32, z: f32, yaw: f32) -> Option<MechId> {
    if g.mechs.len() >= MAX_MECHS {
        return None;
    }
    let c = chassis(ch);
    let geo = geo_for(ch);
    let y = g.ter.height(x, z);
    // The stock loadout: every hardpoint's stock weapon, then the fusion cannon. Cooldowns staggered.
    let mut w = Vec::with_capacity(c.hard.len() + 1);
    let mut sides = [0; Cat::N];
    for h in c.hard {
        let def = weapon(h.stock);
        w.push(Weapon {
            key: h.stock,
            def,
            mount: h.loc,
            cd: g.rng.range(0., def.cd * 0.5),
            ammo: def.ammo,
            dead: false,
            side: sides[def.cat.i()],
            burst_left: 0,
            burst_t: 0.,
            burst_aim: V3::ZERO,
        });
        sides[def.cat.i()] += 1;
    }
    w.push(Weapon {
        key: Wpn::Fusion,
        def: weapon(Wpn::Fusion),
        mount: Sec::T,
        cd: 0.,
        ammo: 0,
        dead: false,
        side: 0,
        burst_left: 0,
        burst_t: 0.,
        burst_aim: V3::ZERO,
    });
    let armour = 1. + ARMOUR_HP * c.armour as f32;
    let hp = c.hp.map(|h| h * armour);
    let ai = Ai {
        aware: false,
        seen: false,
        state: AiState::Fight,
        profile: c.profile,
        still: false,
        strafe: g.rng.sign(),
        strafe_t: g.rng.range(2., 5.),
        jitter: g.rng.range(0.2, 0.8),
        cool_t: 0.,
        hit_at: None,
        lock_t: 0.,
        aim_phase: None,
        hot: false,
        wp: None,
        beam_aim: V3::ZERO,
        belief: None,
        last_seen: -1e9,
        look_t: 0.,
        react_at: None,
        shout_at: None,
        jump: None,
        jump_cd: 0.,
        cover: None,
        cover_look_t: 0.,
        cover_cd: 0.,
        ridge: None,
        ridge_look_t: 0.,
        move_off: None,
        flipped_at: None,
        flip_t: -1e9,
        shots: 0,
        shots_at: 0,
    };
    let mut m = Mech {
        ch: c,
        geo,
        team,
        alive: true,
        gone: false,
        x,
        y,
        z,
        vy: 0.,
        yaw,
        twist: 0.,
        pitch: 0.,
        speed: 0.,
        throttle: 0.,
        heat: 0.,
        fuel: 1.,
        jetting: false,
        air: false,
        shutdown: false,
        was_air: false,
        centring: false,
        air_t: 0.,
        hp,
        max: hp,
        sink_rate: c.sink + SINK_PER_LEVEL * c.sinks as f32,
        max_speed: c.speed * (1. - ARMOUR_SPEED * c.armour as f32),
        jets: c.jets,
        w,
        feet: [Foot::default(); 4],
        cyc: 0.,
        bob: 0.,
        lean: 0.,
        sway: 0.,
        hip_yaw: 0.,
        surge: 0.,
        last_yaw: yaw,
        run_k: 0.,
        run_lean: 0.,
        step_at: -9.,
        dig: 0.,
        slide: 0.,
        p_walk: 0.,
        p_drop: 0.,
        p_mean: 0.,
        p_vault: None,
        p_ahead: 0.,
        torso_drop: 0.,
        torso_nod: 0.,
        hull: None,
        torso: None,
        melt: 0.,
        melt_at: -1.,
        melt_rate: 0.,
        melt_frame: 0,
        beam_on: false,
        beaming: false,
        beam_mech: None,
        fusion: FusionScan::default(),
        melee: None,
        melee_cd: 0.,
        last_arm: Sec::RA,
        last_hit: None,
        jet: JetState::default(),
        push: [0., 0.],
        squash: Spring::default(),
        wob_p: Spring::default(),
        wob_r: Spring::default(),
        sag: Spring::default(),
        tilt_p: Spring::default(),
        tilt_r: Spring::default(),
        tilt_was: None,
        scramble: 0.,
        flash: Flash::default(),
        dying: None,
        fallen: None,
        ai,
    };
    feel::init_feel(&mut m);
    gait::init_feet(&g.ter, &mut m);
    g.mechs.push(m);
    Some(g.mechs.len() - 1)
}

fn reset(g: &mut Game, seed: u32, biome: Biome, time: TimeOfDay, weather: Weather, flat: bool) {
    let (reduced, diff) = (g.reduced_motion, g.diff);
    *g = Game::new(seed);
    g.reduced_motion = reduced;
    g.diff = diff;
    g.biome = biome;
    g.time_of_day = time;
    g.weather = weather;
    g.pal = pal_at(biome, time);
    g.ter = Terrain::new(seed, flat);
}
fn polar(bearing: f32, dist: f32) -> (f32, f32) {
    let a = -bearing * PI / 180.;
    (a.sin() * dist, a.cos() * dist)
}
fn place_foe(g: &mut Game, f: &Foe, i: usize, n: usize) {
    let (mut x, mut z) = match f.at {
        Some([b, d]) => polar(b, d),
        None => {
            let a = (i as f32 / n as f32) * TAU + g.rng.range(-0.4, 0.4) + PI * 0.6;
            let d = g.rng.range(520., 760.);
            (a.sin() * d, a.cos() * d)
        }
    };
    x = clamp(x, -g.ter.bx, g.ter.bx);
    z = clamp(z, -g.ter.bz, g.ter.bz);
    let yaw = (-x).atan2(-z) + g.rng.range(-1., 1.);
    let Some(e) = new_mech(g, f.ch, 1, x, z, yaw) else {
        return;
    };
    let aware = match f.aware {
        Some(a) => a,
        None => g.rng.chance(0.3),
    };
    g.mechs[e].ai.aware = aware;
    if let Some(p) = f.profile {
        g.mechs[e].ai.profile = p;
    }
}
fn begin(g: &mut Game, ch: Ch) {
    new_mech(g, ch, 0, 0., 0., 0.);
    g.eye = crate::geom::eye_of(g.p());
    g.view = dir_of(0., 0.);
    g.aim = g.eye + g.view * 100.;
    g.state = State::Play;
}
/// A campaign mission, in `ch`. `flat` gives level ground (tests).
pub fn start_mission(g: &mut Game, mission: usize, ch: Ch, diff: Diff, flat: bool) {
    let def = &MISSIONS[mission];
    g.diff = diff;
    reset(g, def.seed, def.biome, def.time, def.weather, flat);
    g.mission = Some(mission);
    if let Some((a, b, secs)) = def.ramp {
        g.ramp = Some((pal_at(def.biome, a), pal_at(def.biome, b), secs));
        g.pal = pal_at(def.biome, a);
    }
    begin(g, ch);
    for (i, f) in def.foes.iter().enumerate() {
        place_foe(g, f, i, def.foes.len());
    }
}
/// Free Play: a mix of foes on a ring, lighter ones more often.
pub fn start_free_play(
    g: &mut Game,
    biome: Biome,
    time: TimeOfDay,
    weather: Weather,
    n_foes: usize,
    seed: u32,
    ch: Ch,
    diff: Diff,
    flat: bool,
) {
    g.diff = diff;
    reset(g, seed, biome, time, weather, flat);
    begin(g, ch);
    const POOL: [Ch; 9] = [
        Ch::Jackal,
        Ch::Jackal,
        Ch::Kestrel,
        Ch::Light1,
        Ch::Jackal,
        Ch::Warden,
        Ch::Sniper1,
        Ch::Kestrel,
        Ch::Puncher,
    ];
    for i in 0..n_foes.min(MAX_MECHS - 1) {
        let ch = POOL[g.rng.int(POOL.len())];
        place_foe(
            g,
            &Foe {
                ch,
                at: None,
                aware: None,
                profile: None,
            },
            i,
            n_foes,
        );
    }
}
