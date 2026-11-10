//! Everything that makes a noise, synthesised in SDL's audio callback:
//! oscillator and filtered-noise voices for the one-shots, one sub-bass thump
//! voice through a soft clipper, and the continuous loops (reactor hum, jets,
//! servo, beam, the melt sizzle, the fusion scan) on a bus that ducks under
//! impacts. Positioned sounds pan by bearing and fade with distance.
//! No samples yet: they layer under this synthesis later (docs/issues.md, item 19).
use sdl2::audio::{AudioCallback, AudioDevice, AudioSpecDesired};
use stompy_sim::beams::{beam_mult, melt_frac, MELT_MAX};
use stompy_sim::data::*;
use stompy_sim::math::*;
use stompy_sim::*;

const RATE: i32 = 48000;
#[derive(Clone, Copy, PartialEq)]
enum Wave {
    Sine,
    Saw,
    Square,
    Tri,
}
#[derive(Clone, Copy, PartialEq)]
enum Filt {
    Low,
    Band,
    High,
}
#[derive(Clone, Copy, Default)]
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}
impl Biquad {
    fn set(&mut self, f: Filt, freq: f32, q: f32) {
        let w = TAU * clamp(freq, 20., RATE as f32 * 0.45) / RATE as f32;
        let (s, c) = w.sin_cos();
        let al = s / (2. * q);
        let a0 = 1. + al;
        (self.b0, self.b1, self.b2) = match f {
            Filt::Low => ((1. - c) / 2. / a0, (1. - c) / a0, (1. - c) / 2. / a0),
            Filt::High => ((1. + c) / 2. / a0, -(1. + c) / a0, (1. + c) / 2. / a0),
            Filt::Band => (al / a0, 0., -al / a0),
        };
        self.a1 = -2. * c / a0;
        self.a2 = (1. - al) / a0;
    }
    fn run(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1
            - self.a2 * self.y2;
        (self.x2, self.x1, self.y2, self.y1) = (self.x1, x, self.y1, y);
        y
    }
}
fn wave(w: Wave, ph: f32) -> f32 {
    let ph = ph - ph.floor();
    match w {
        Wave::Saw => 2. * ph - 1.,
        Wave::Square => {
            if ph < 0.5 {
                1.
            } else {
                -1.
            }
        }
        Wave::Tri => 4. * (ph - 0.5).abs() - 1.,
        Wave::Sine => (ph * TAU).sin(),
    }
}
#[derive(Clone, Copy)]
struct Osc {
    w: Wave,
    f0: f32,
    f1: f32,
    dur: f32,
    t: f32,
    vol: f32,
    pan: f32,
    delay: f32,
    ph: f32,
}
#[derive(Clone, Copy)]
struct Noise {
    f: Filt,
    f0: f32,
    f1: f32,
    dur: f32,
    t: f32,
    vol: f32,
    pan: f32,
    delay: f32,
    q: Biquad,
}
/// The loops' levels and rates: what the game asks for, eased toward in the callback.
#[derive(Clone, Copy, Default)]
struct Loops {
    hum: f32,
    hum_rate: f32,
    jet: f32,
    jet_rate: f32,
    servo: f32,
    servo_rate: f32,
    beam: f32,
    beam_k: f32,
    sizzle: f32,
    sizzle_k: f32,
    fusion: f32,
    fusion_p: f32,
    bed: f32,
}
impl Loops {
    fn ease(&mut self, to: &Loops, k: f32) {
        macro_rules! e { ($($f:ident),*) => { $(self.$f += (to.$f - self.$f) * k;)* } }
        e!(
            hum, hum_rate, jet, jet_rate, servo, servo_rate, beam, beam_k, sizzle, sizzle_k,
            fusion, fusion_p, bed
        );
    }
}
pub struct Synth {
    vol: f32,
    oscs: Vec<Osc>,
    noises: Vec<Noise>,
    thump: (f32, f32, f32, f32, f32), // freq, level wanted, env, decay, phase
    duck: (f32, f32),                 // level, time since
    want: Loops,
    lp: Loops,
    ph: [f32; 7],
    jet: Biquad,
    siz: Biquad,
    beam: Biquad,
    bed: Biquad,
    seed: u32,
}
impl Synth {
    fn rnd(&mut self) -> f32 {
        self.seed = self
            .seed
            .wrapping_mul(1_664_525)
            .wrapping_add(1_013_904_223);
        (self.seed >> 8) as f32 / 8_388_608. - 1.
    }
    fn duck_gain(&self) -> f32 {
        let (lvl, t) = self.duck;
        if lvl >= 1. || t < 0.25 {
            return lvl.min(1.);
        }
        let u = (t - 0.25) / 0.4;
        if u >= 1. {
            1.
        } else {
            lerp(lvl, 1., u)
        }
    }
}
impl AudioCallback for Synth {
    type Channel = f32;
    fn callback(&mut self, out: &mut [f32]) {
        let dt = 1. / RATE as f32;
        let mut n = 0usize;
        while n + 1 < out.len() {
            let (mut l, mut r, mut loops) = (0f32, 0f32, 0f32);
            self.oscs.retain_mut(|o| {
                if o.delay > 0. {
                    o.delay -= dt;
                    return true;
                }
                let u = o.t / o.dur;
                let f = o.f0 * (o.f1 / o.f0).powf(u);
                o.ph += f * dt;
                let s = wave(o.w, o.ph) * 0.0001f32.powf(u) * o.vol;
                l += s * (1. - o.pan.max(0.));
                r += s * (1. + o.pan.min(0.));
                o.t += dt;
                o.t < o.dur
            });
            let mut seed = self.seed;
            let mut rnd = || {
                seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                (seed >> 8) as f32 / 8_388_608. - 1.
            };
            let tick = n.is_multiple_of(64);
            self.noises.retain_mut(|q| {
                if q.delay > 0. {
                    q.delay -= dt;
                    return true;
                }
                let u = q.t / q.dur;
                if tick {
                    q.q.set(
                        q.f,
                        q.f0 * (q.f1 / q.f0).powf(u),
                        if q.f == Filt::Band { 1.5 } else { 0.8 },
                    );
                }
                let s = q.q.run(rnd())
                    * 0.0001f32.powf(u)
                    * q.vol
                    * if q.f == Filt::Band { 2.5 } else { 1. };
                l += s * (1. - q.pan.max(0.));
                r += s * (1. + q.pan.min(0.));
                q.t += dt;
                q.t < q.dur
            });
            self.seed = seed;
            // The sub-bass thump: a sine with a 10 ms attack and its decay, through a soft clipper.
            let (freq, want, env, decay, ph) = &mut self.thump;
            if *env > 0.0002 || *want > 0. {
                if *want > 0. {
                    *env = (*env + dt / 0.01 * *want).min(*want);
                    if *env >= *want {
                        *want = 0.;
                    }
                } else {
                    *env *= 0.0001f32.powf(dt / *decay);
                }
                *ph += *freq * dt;
                let s = (2.2 * (*ph * TAU).sin() * *env).tanh() / 2.2f32.tanh();
                l += s;
                r += s;
            }
            // The loops, through the duckable bus.
            let lp = self.lp;
            self.ph[0] += 55. * lp.hum_rate * dt;
            self.ph[1] += 110.4 * lp.hum_rate * dt;
            loops +=
                (wave(Wave::Sine, self.ph[0]) * 0.7 + wave(Wave::Saw, self.ph[1]) * 0.12) * lp.hum;
            if lp.jet > 0.001 {
                if tick {
                    self.jet.set(Filt::Low, 500. + 900. * lp.jet_rate, 0.8);
                }
                let x = self.rnd();
                loops += self.jet.run(x) * lp.jet * 1.6;
            }
            if lp.servo > 0.001 {
                self.ph[2] += 70. * lp.servo_rate * dt;
                loops += wave(Wave::Tri, self.ph[2]) * lp.servo * 0.5;
            }
            if lp.beam > 0.001 {
                // The beam's bite: saw and square through a resonant lowpass, climbing with the melt.
                let base = 150. + 170. * lp.beam_k;
                self.ph[3] += base * dt;
                self.ph[4] += base * 1.505 * dt;
                if tick {
                    self.beam.set(Filt::Low, 700. + 2200. * lp.beam_k, 4.);
                }
                let x = wave(Wave::Saw, self.ph[3]) + wave(Wave::Square, self.ph[4]);
                loops += self.beam.run(x) * lp.beam * 0.5;
            }
            if lp.sizzle > 0.001 {
                // Being melted: gritty filtered noise over a low saw.
                if tick {
                    self.siz.set(Filt::Band, 420. + 1300. * lp.sizzle_k, 1.6);
                }
                self.ph[5] += (55. + 45. * lp.sizzle_k) * dt;
                let x = self.rnd();
                loops += (self.siz.run(x) * 2. + wave(Wave::Saw, self.ph[5]) * 0.3) * lp.sizzle;
            }
            if lp.fusion > 0.001 {
                // The scan: a triangle rising with it, chopped by a square that speeds up.
                self.ph[6] += (320. + 1100. * lp.fusion_p * lp.fusion_p) * dt;
                self.ph[2] += (6. + 22. * lp.fusion_p) * dt;
                loops += wave(Wave::Tri, self.ph[6])
                    * (1. + 0.75 * wave(Wave::Square, self.ph[2]))
                    * lp.fusion;
            }
            if lp.bed > 0.001 {
                if n.is_multiple_of(128) {
                    self.bed.set(Filt::Low, 320., 0.7);
                }
                let x = self.rnd();
                loops += self.bed.run(x) * lp.bed;
            }
            let dg = self.duck_gain();
            self.duck.1 += dt;
            out[n] = ((l + loops * dg) * self.vol).tanh();
            out[n + 1] = ((r + loops * dg) * self.vol).tanh();
            n += 2;
        }
        let want = self.want;
        self.lp.ease(&want, 0.02);
    }
}

pub struct Audio {
    dev: Option<AudioDevice<Synth>>,
    ear: V3,
    ear_yaw: f32,
}
impl Audio {
    pub fn new(sdl: &sdl2::Sdl, vol: f32) -> Audio {
        let synth = Synth {
            vol,
            oscs: vec![],
            noises: vec![],
            thump: (55., 0., 0., 0.2, 0.),
            duck: (1., 1.),
            want: Loops::default(),
            lp: Loops::default(),
            ph: [0.; 7],
            jet: Biquad::default(),
            siz: Biquad::default(),
            beam: Biquad::default(),
            bed: Biquad::default(),
            seed: 12345,
        };
        let dev = sdl.audio().and_then(|a| {
            a.open_playback(
                None,
                &AudioSpecDesired {
                    freq: Some(RATE),
                    channels: Some(2),
                    samples: Some(512),
                },
                |_| synth,
            )
        });
        match &dev {
            Ok(d) => d.resume(),
            Err(e) => eprintln!("audio: {e} (silent)"),
        }
        Audio {
            dev: dev.ok(),
            ear: V3::ZERO,
            ear_yaw: 0.,
        }
    }
    fn with(&mut self, f: impl FnOnce(&mut Synth)) {
        if let Some(d) = &mut self.dev {
            f(&mut d.lock());
        }
    }
    pub fn set_volume(&mut self, v: f32) {
        self.with(|s| s.vol = v);
    }
    pub fn listener(&mut self, ear: V3, yaw: f32) {
        self.ear = ear;
        self.ear_yaw = yaw;
    }
    /// Where a sound is, from the cockpit: `reach` is how far it carries at full volume. None: too faint.
    fn spatial(&self, at: Option<V3>, reach: f32) -> Option<(f32, f32)> {
        let Some(at) = at else { return Some((1., 0.)) };
        let d = at - self.ear;
        let dist = d.len();
        let g = if dist <= reach {
            1.
        } else {
            reach / (reach + 1.4 * (dist - reach))
        };
        if g < 0.02 {
            return None;
        }
        let rel = wrap(d.x.atan2(d.z) - self.ear_yaw);
        Some((g, clamp(-rel.sin() * (dist / 10.).min(1.), -1., 1.) * 0.85))
    }
    /// The recipes (the reference's synthesis halves; samples layer on top later).
    pub fn sfx(&mut self, sfx: Sfx, at: Option<V3>) {
        let reach = match sfx {
            Sfx::Boom { big: true } => 90.,
            Sfx::Boom { big: false } => 40.,
            Sfx::Step { .. } => 12.,
            Sfx::Fusion => 120.,
            Sfx::Bonker => 80.,
            _ => 35.,
        };
        let Some((g, pan)) = self.spatial(at, reach) else {
            return;
        };
        use Filt::*;
        use Wave::*;
        let mut os: Vec<(Wave, f32, f32, f32, f32, f32)> = vec![];
        let mut ns: Vec<(f32, f32, f32, f32, Filt, f32)> = vec![];
        match sfx {
            Sfx::Laser { small: true } => os.extend([
                (Saw, 2400., 260., 0.2, 0.035, 0.),
                (Sine, 1100., 160., 0.22, 0.035, 0.),
            ]),
            Sfx::Laser { small: false } => os.extend([
                (Saw, 1900., 180., 0.28, 0.05, 0.),
                (Sine, 900., 120., 0.3, 0.05, 0.),
            ]),
            Sfx::Cannon => {
                os.push((Sine, 110., 32., 0.32, 0.3, 0.)); // a thunk first and a bang second
                ns.push((0.35, 0.3, 900., 80., Low, 0.));
            }
            Sfx::Thunderclap => {
                os.extend([
                    (Saw, 1400., 90., 0.4, 0.22, 0.),
                    (Sine, 55., 30., 0.6, 0.35, 0.03),
                ]);
                ns.push((0.14, 0.4, 4200., 900., Band, 0.));
            }
            Sfx::Bonker => {
                os.extend([
                    (Sine, 70., 24., 0.5, 0.45, 0.),
                    (Tri, 920., 860., 0.35, 0.06, 0.),
                ]);
                ns.push((0.45, 0.35, 700., 60., Low, 0.));
            }
            Sfx::Peashooter => ns.push((0.05, 0.12, 2500., 900., Band, 0.)),
            Sfx::Toaster => {
                ns.push((0.5, 0.25, 900., 250., Low, 0.));
                os.push((Square, 180., 90., 0.06, 0.05, 0.));
            }
            Sfx::Missile => ns.push((0.7, 0.12, 3000., 400., Band, 0.)),
            Sfx::Boom { big } => {
                if big {
                    os.push((Sine, 70., 25., 1.2, 0.4, 0.));
                    ns.push((1.6, 0.6, 700., 40., Low, 0.));
                } else {
                    os.push((Sine, 120., 25., 0.4, 0.25, 0.));
                    ns.push((0.6, 0.25, 1200., 40., Low, 0.));
                }
            }
            Sfx::Clang(sec) => {
                // Arms ring high, legs thud, the torso is dull.
                let rate = if sec.is_arm() {
                    1.4
                } else if sec.is_leg() {
                    0.9
                } else {
                    0.75
                };
                os.push((Square, 240. * rate, 120. * rate, 0.12, 0.05, 0.));
                ns.push((0.15, 0.15, 4000., 800., High, 0.));
                if !sec.is_arm() {
                    os.push((
                        Sine,
                        if sec.is_leg() { 70. } else { 55. },
                        30.,
                        0.2,
                        0.12,
                        0.,
                    ));
                }
            }
            Sfx::Step { vol, scale } => {
                // Felt more than heard: a short sub-bass thump, deeper for a bigger mech.
                let v = vol * if at.is_some() { 0.55 } else { 1. };
                os.push((Sine, 72. / scale.max(0.5), 36., 0.16, 0.14 * v, 0.));
                ns.push((0.07, 0.035 * v, 170., 60., Low, 0.));
            }
            Sfx::Land(f) => {
                os.push((Sine, 62., 28., 0.32, 0.22 * f, 0.));
                ns.push((0.14, 0.08 * f, 200., 50., Low, 0.));
            }
            Sfx::Blastoff(c) => {
                os.push((Sine, 70., 20., 0.8, 0.4 * (0.5 + c), 0.));
                ns.push((0.7, 0.25 + 0.2 * c, 1400., 200., Low, 0.));
            }
            Sfx::Punch { hit: true } => {
                os.push((Sine, 90., 30., 0.3, 0.3, 0.));
                ns.push((0.2, 0.3, 600., 100., Low, 0.));
            }
            Sfx::Punch { hit: false } => ns.push((0.25, 0.08, 1200., 300., Band, 0.)),
            Sfx::Whine => os.extend([
                (Saw, 320., 1500., 0.26, 0.05, 0.),
                (Sine, 160., 900., 0.26, 0.06, 0.),
            ]),
            Sfx::Powerdown => os.push((Saw, 220., 30., 1.6, 0.05, 0.)),
            Sfx::Powerup => os.push((Sine, 60., 240., 0.8, 0.06, 0.)),
            Sfx::Beep => os.push((Square, 1200., 1190., 0.06, 0.03, 0.)),
            Sfx::Lock => os.extend([
                (Square, 1500., 1500., 0.04, 0.03, 0.),
                (Square, 2200., 2200., 0.05, 0.03, 0.05),
            ]),
            Sfx::FusionCrack => {
                os.extend([
                    (Saw, 2600., 180., 0.35, 0.12, 0.),
                    (Square, 1400., 90., 0.4, 0.05, 0.),
                ]);
                ns.push((0.25, 0.25, 6000., 900., High, 0.));
            }
            Sfx::Fusion => {
                os.extend([
                    (Saw, 2200., 50., 1.3, 0.12, 0.),
                    (Sine, 90., 20., 1.6, 0.5, 0.),
                ]);
                ns.push((1.6, 0.6, 700., 40., Low, 0.));
            }
        }
        self.with(|s| {
            for (w, f0, f1, dur, vol, delay) in os {
                if vol * g > 0.003 && s.oscs.len() < 40 {
                    s.oscs.push(Osc {
                        w,
                        f0,
                        f1,
                        dur,
                        t: 0.,
                        vol: vol * g,
                        pan,
                        delay,
                        ph: 0.,
                    });
                }
            }
            for (dur, vol, f0, f1, f, delay) in ns {
                if vol * g > 0.003 && s.noises.len() < 20 {
                    let mut q = Biquad::default();
                    q.set(f, f0, 1.);
                    s.noises.push(Noise {
                        f,
                        f0,
                        f1,
                        dur,
                        t: 0.,
                        vol: vol * g,
                        pan,
                        delay,
                        q,
                    });
                }
            }
        });
    }
    /// The feel table's bass and duck: heavier is lower, longer, louder; the loops dip under it.
    pub fn thump(&mut self, bass: f32, duck: f32, at: Option<V3>) {
        let sp = self.spatial(at, 40.);
        self.with(|s| {
            if let (true, Some((g, _))) = (bass > 0.03, sp) {
                let b = clamp(bass * g, 0., 1.5);
                s.thump.0 = 60. - 15. * b.min(1.);
                s.thump.3 = 0.15 + 0.25 * b.min(1.);
                s.thump.1 = s.thump.2.max((0.5 * b + 0.15 * b * b).min(1.));
            }
            if duck > 0.02 {
                let lvl = 1. - duck.min(0.95);
                if lvl < s.duck_gain() {
                    s.duck = (lvl, 0.);
                }
            }
        });
    }
    pub fn fusion(&mut self, on: bool, p: f32) {
        self.with(|s| {
            s.want.fusion = if on { 0.04 } else { 0. };
            s.want.fusion_p = p;
        });
    }
    /// The cockpit voice's two-note blip under a line of text (until recorded lines exist).
    pub fn chirp(&mut self) {
        self.with(|s| {
            s.oscs.push(Osc {
                w: Wave::Square,
                f0: 880.,
                f1: 880.,
                dur: 0.05,
                t: 0.,
                vol: 0.02,
                pan: 0.,
                delay: 0.,
                ph: 0.,
            });
            s.oscs.push(Osc {
                w: Wave::Square,
                f0: 660.,
                f1: 660.,
                dur: 0.07,
                t: 0.,
                vol: 0.02,
                pan: 0.,
                delay: 0.06,
                ph: 0.,
            });
        });
    }
    pub fn click(&mut self) {
        self.with(|s| {
            s.oscs.push(Osc {
                w: Wave::Sine,
                f0: 90.,
                f1: 40.,
                dur: 0.12,
                t: 0.,
                vol: 0.2,
                pan: 0.,
                delay: 0.,
                ph: 0.,
            });
            s.oscs.push(Osc {
                w: Wave::Square,
                f0: 700.,
                f1: 500.,
                dur: 0.04,
                t: 0.,
                vol: 0.02,
                pan: 0.,
                delay: 0.,
                ph: 0.,
            });
        });
    }
    /// The loops follow the state: the hum with speed and heat, the jets, the servo, your beam, being melted.
    pub fn tick(&mut self, g: Option<&Game>) {
        let mut w = Loops::default();
        if let Some(g) = g {
            let p = g.p();
            let live = p.alive && !p.shutdown;
            let pace = (p.speed.abs() / p.max_speed).min(1.);
            let hot = if p.shutdown { 0. } else { hot_frac(p.heat) };
            w.hum = if !p.alive {
                0.
            } else if p.shutdown {
                0.03
            } else {
                (0.07 + 0.13 * pace) * (1. + HEAT_HUM * hot)
            };
            w.hum_rate = if p.shutdown {
                0.5
            } else {
                (0.72 + 0.4 * pace) * (1. + HEAT_HUM_RATE * hot)
            };
            let charge = if live { p.jet.charge } else { 0. };
            let climb = live && p.jet.blasted && p.vy > 0.;
            (w.jet, w.jet_rate) = if charge > 0. {
                (0.08 + 0.2 * charge, 1.1 + 0.9 * charge)
            } else if climb {
                (0.34, 0.85)
            } else if g.guide.is_some() {
                (0.24, 1.7)
            } else {
                (0., 0.85)
            };
            w.servo = if live {
                (g.twist_rate * 0.07).min(0.13)
            } else {
                0.
            };
            w.servo_rate = 0.75 + (g.twist_rate * 0.25).min(0.6);
            let k = (beam_mult(g, p) - 1.) / (MELT_MAX - 1.);
            (w.beam, w.beam_k) = (if p.beaming { 0.03 + 0.025 * k } else { 0. }, k);
            let on_you = p.alive && g.beam_on_at.is_some_and(|t| g.time - t < 0.2);
            (w.sizzle, w.sizzle_k) = (
                if on_you {
                    0.05 + 0.07 * melt_frac(p)
                } else {
                    0.
                },
                melt_frac(p),
            );
            w.bed = 0.035;
        }
        self.with(|s| {
            (w.fusion, w.fusion_p) = (s.want.fusion, s.want.fusion_p);
            s.want = w;
        });
    }
}
