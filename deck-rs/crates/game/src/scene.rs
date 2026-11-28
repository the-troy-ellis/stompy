//! The 3D view: the sky, the ground, every mech posed from its planted feet,
//! the shots, beams, debris, wrecks and effects, and the cockpit camera with
//! its kick, bob, shake, wobble and heat sway.
use crate::anim::{self, Anim};
use crate::gl::{Gl, Mesh, Mode};
use crate::mesh::*;
use stompy_sim::data::*;
use stompy_sim::gait::solve_knee;
use stompy_sim::geom::{center_of, eye_of};
use stompy_sim::math::*;
use stompy_sim::melee::melee_pose;
use stompy_sim::state::fog_of;
use stompy_sim::*;

pub struct Scene {
    parts: Vec<Option<MechParts>>,
    fx: Vec<Mesh>,
    sky: Mesh,
    ground: Vec<(Mesh, V3)>,
    world: Option<(u32, Biome)>,
    inst: Vec<f32>,
    right: V3,
    up: V3,
    jitter: f32,
    /// The dither's cell in pixels (0: smooth), from SETTINGS.
    pub cell: u32,
    /// Model detail: 0 the boxes, 1 or 2 the detailed models where there are some.
    pub detail: u8,
    /// Each mech's drawn-only motion (`anim.rs`), by index.
    anims: Vec<Option<Anim>>,
}
/// A fixed camera instead of the cockpit (the menu's turntable).
pub struct Cam {
    pub eye: V3,
    pub at: V3,
    pub fov: f32,
}
fn fx_mesh(s: &Scene, k: Fx) -> &Mesh {
    &s.fx[FX_ALL.iter().position(|&f| f == k).unwrap()]
}
/// A box from `a` to `b`, `w` across: the beams and the tracers.
fn beam_mat(a: V3, b: V3, w: f32) -> M4 {
    let d = b - a;
    let up = if d.y.abs() < 0.9 * d.len() {
        v3(0., 1., 0.)
    } else {
        v3(1., 0., 0.)
    };
    let x = d.cross(up).norm();
    let z = x.cross(d).norm();
    M4([
        x.x * w,
        x.y * w,
        x.z * w,
        0.,
        d.x,
        d.y,
        d.z,
        0.,
        z.x * w,
        z.y * w,
        z.z * w,
        0.,
        a.x,
        a.y,
        a.z,
        1.,
    ])
}
/// An instance's last number: its glow (0..1), plus how much of it is still drawn, in
/// sixteenths, for the dither to dissolve it (`gl.rs` unpacks it; solid packs as 0).
fn dissolve(glow: f32, solid: f32) -> f32 {
    let k = (solid.clamp(0., 1.) * 16.).round();
    glow.min(0.999) + if k >= 16. { 0. } else { 2. * k.max(1.) }
}
/// A unit rod (`Fx::Rod`) laid from `a` to `b`, `d` across.
fn rod_mat(a: V3, b: V3, d: f32) -> M4 {
    let ax = b - a;
    let y = ax.norm();
    let up = if y.y.abs() < 0.9 {
        v3(0., 1., 0.)
    } else {
        v3(1., 0., 0.)
    };
    let x = y.cross(up).norm();
    let z = x.cross(y).norm();
    let m = (a + b) * 0.5;
    M4([
        x.x * d,
        x.y * d,
        x.z * d,
        0.,
        ax.x,
        ax.y,
        ax.z,
        0.,
        z.x * d,
        z.y * d,
        z.z * d,
        0.,
        m.x,
        m.y,
        m.z,
        1.,
    ])
}
/// What a shot kicked back: a gun on one side, or the pods.
#[derive(Clone, Copy, PartialEq)]
enum Kicked {
    Arm(f32),
    Pod(usize),
}
fn inst_mat(p: V3, yaw: f32, tumble: f32, size: f32) -> M4 {
    M4::t(p.x, p.y, p.z) * M4::ry(yaw) * M4::rx(tumble) * M4::s1(size)
}
impl Scene {
    pub fn new(gl: &Gl) -> Scene {
        Scene {
            parts: (0..Ch::N).map(|_| None).collect(),
            fx: FX_ALL.iter().map(|&k| build_effect(gl, k)).collect(),
            sky: build_sky(gl),
            ground: vec![],
            world: None,
            inst: Vec::with_capacity(20 * MAX_PARTS),
            right: v3(1., 0., 0.),
            up: v3(0., 1., 0.),
            jitter: 0.,
            cell: 2,
            detail: 2,
            anims: vec![],
        }
    }
    fn parts(&mut self, gl: &Gl, ch: Ch) -> &MechParts {
        let d = self.detail;
        self.parts[ch.i()].get_or_insert_with(|| build_mech_parts(gl, ch, d))
    }
    fn load_world(&mut self, gl: &Gl, g: &Game) {
        let key = (g.ter.seed, g.biome);
        if self.world == Some(key) {
            return;
        }
        for (m, _) in self.ground.drain(..) {
            gl.free(m);
        }
        let w = g.ter.hx * 2. / TER_CHUNKS as f32;
        for cz in 0..TER_CHUNKS {
            for cx in 0..TER_CHUNKS {
                let c = v3(
                    -g.ter.hx + (cx as f32 + 0.5) * w,
                    60.,
                    -g.ter.hz + (cz as f32 + 0.5) * w,
                );
                self.ground.push((
                    build_terrain_chunk(gl, &g.ter, cx, cz, &PALS[g.biome.i()]),
                    c,
                ));
            }
        }
        self.world = Some(key);
    }

    /// One mech: the hull on its springs, the torso on top, the arms, the legs by IK from the feet.
    fn draw_mech(&mut self, gl: &mut Gl, g: &Game, id: MechId, arms_only: bool) {
        let m = &g.mechs[id];
        self.parts(gl, m.key());
        let (geo, sc) = (m.geo, m.ch.scale);
        let base = if let Some(d) = m.dying {
            // The legs buckle and the body topples about the ground under it.
            M4::t(m.x, m.y, m.z)
                * M4::ry(d.fall_yaw)
                * M4::rx(d.angle)
                * M4::ry(-d.fall_yaw)
                * M4::t(0., -d.drop + m.bob, 0.)
                * M4::ry(m.yaw)
                * M4::s1(sc)
        } else {
            M4::t(m.x, m.y + m.bob - m.sag.x, m.z)
                * M4::ry(m.yaw)
                * M4::s1(sc)
                * M4::rx(m.tilt_p.x)
                * M4::rz(m.lean + m.tilt_r.x)
                * M4::t(m.sway, 0., m.surge)
        };
        let sq = m.squash.x + m.jet.charge * 0.14;
        let (lean, arm_swing, lunge) = melee_pose(m);
        let tb = base
            * M4::t(0., geo.torso_y + m.torso_drop, 0.)
            * M4::s(1. + sq * 0.5, 1. - sq, 1. + sq * 0.5)
            * M4::ry(m.twist)
            * M4::t(0., 0., lunge)
            * M4::rx(m.wob_p.x - lean + m.torso_nod + m.run_lean)
            * M4::rz(m.wob_r.x);
        // The drawn-only motion: springs moved on, then read below.
        let prof = if self.detail > 0 && m.dying.is_none() {
            anim::profile(m.key())
        } else {
            None
        };
        if let Some(pr) = prof {
            if self.anims.len() < g.mechs.len() {
                self.anims.resize_with(g.mechs.len(), || None);
            }
            self.anims[id]
                .get_or_insert_with(|| Anim::new(pr, g.time))
                .tick(pr, m, g.time, &tb);
        }
        let an = prof.zip(self.anims.get(id).and_then(|a| a.as_ref()));
        // Which gun the last shot kicked, and how far back it sits now.
        let age = g.frame.saturating_sub(m.flash.frame);
        let kicked = match an {
            Some((pr, _)) if m.flash.frame > 0 && age < 20 => {
                let k = anim::kick(pr, age, m.flash.big);
                let at = |v: V3| (tb.apply(v) - m.flash.p).len();
                let (ax, ay) = (geo.arm_x, geo.arm_y - 1.2);
                let (pl, pr) = (
                    at(v3(1.25, geo.rack_y, 0.6)),
                    at(v3(-1.25, geo.rack_y, 0.6)),
                );
                let (l, r) = (at(v3(ax, ay, 2.4)), at(v3(-ax, ay, 2.4)));
                let which = if pl.min(pr) < l.min(r) {
                    Kicked::Pod(if pl < pr { 0 } else { 1 })
                } else if l < r {
                    Kicked::Arm(1.)
                } else {
                    Kicked::Arm(-1.)
                };
                Some((which, k))
            }
            _ => None,
        };
        let kick_of = |w: Kicked| kicked.filter(|k| k.0 == w).map_or(0., |k| k.1);
        let p = self.parts[m.key().i()].as_ref().unwrap();
        if !arms_only {
            gl.draw_plain(&p.hip, &(base * M4::t(0., geo.hip, 0.) * M4::ry(m.hip_yaw)));
            gl.draw_plain(&p.torso, &tb);
            if let Some(pods) = &p.pods {
                for (j, pod) in pods.iter().enumerate() {
                    let sx = if j == 0 { 1. } else { -1. };
                    let (drop, sway, h) = match an {
                        Some((pr, a)) => (a.pod[j].x, a.sway[j].x, pr.pod_hinge),
                        None => (0., 0., [0.; 3]),
                    };
                    let h = [h[0] * sx, h[1], h[2]];
                    let back = kick_of(Kicked::Pod(j));
                    gl.draw_plain(
                        pod,
                        &(tb * M4::t(h[0], h[1] + drop, h[2] - back * 0.5)
                            * M4::rx(-drop * 1.2 - back * 0.5)
                            * M4::rz(sway * sx)
                            * M4::t(-h[0], -h[1], -h[2])),
                    );
                }
            }
            if let (Some(ant), Some((pr, a))) = (&p.antenna, an) {
                let b = pr.ant_base;
                gl.draw_plain(
                    ant,
                    &(tb * M4::t(b[0], b[1], b[2]) * M4::rx(a.ant_x.x) * M4::rz(a.ant_z.x)),
                );
            }
        }
        for (side, sec) in [(1., Sec::LA), (-1., Sec::RA)] {
            if m.hp[sec.i()] <= 0. && m.dying.is_none() {
                continue;
            }
            let swinging = m.melee.is_some_and(|s| s.arm.is_none_or(|a| a == sec));
            let sw = if swinging { arm_swing } else { 0. };
            let back = kick_of(Kicked::Arm(side));
            let a = if arms_only {
                // The cockpit's own arms: drawn in and forward of the eye.
                tb * M4::t(side * 2.4, geo.eye[1] - 0.9, geo.eye[2] + 1.9)
                    * M4::rx(-1.25 - m.pitch * 0.5 + sw)
                    * M4::s1(0.55)
            } else {
                let (swing, lag) = match an {
                    Some((pr, a)) => (anim::arm_swing(pr, m, side), a.lag.x),
                    None => (0., 0.),
                };
                tb * M4::t(side * geo.arm_x, geo.arm_y, 0.)
                    * M4::ry(lag)
                    * M4::rx(-m.pitch + sw + swing + back * 0.25)
            };
            gl.draw_plain(&p.arm, &a);
            if let Some(f) = &p.fist {
                gl.draw_plain(f, &a);
            }
            if let (Some(b), true) = (&p.barrel, m.w.iter().any(|w| w.mount == sec && !w.dead)) {
                gl.draw_plain(b, &(a * M4::t(0., 0., -back)));
            }
        }
        if arms_only {
            return;
        }
        let steel = [0.3, 0.31, 0.34];
        let dark = [m.ch.col[0] * 0.55, m.ch.col[1] * 0.55, m.ch.col[2] * 0.55];
        let rod = fx_mesh(self, Fx::Rod);
        // A live piston: the fat cylinder from its upper end, the rod the rest of the way.
        let piston = |gl: &mut Gl, a: V3, b: V3, pi: &crate::models::Piston| {
            let len = (b - a).len().max(1e-3);
            let f = (pi.fat * sc).min(len * 0.92);
            let mid = a + (b - a) * (f / len);
            gl.draw(rod, &rod_mat(a, mid, pi.d * sc), dark, 0.);
            gl.draw(rod, &rod_mat(mid, b, pi.d * sc * 0.5), steel, 0.);
        };
        let (c, sn) = (m.yaw.cos(), m.yaw.sin());
        for (i, l) in geo.legs().iter().enumerate() {
            let sec = if l.hx > 0. { Sec::LL } else { Sec::RL };
            if m.hp[sec.i()] <= 0. && m.dying.is_none() {
                continue;
            }
            let hp = base.apply(v3(l.hx, geo.hip, l.hz));
            let ankle = if m.dying.is_some() {
                base.apply(v3(l.fx, 0.2, l.fz))
            } else {
                m.feet[i].pos + v3(0., geo.ankle * sc, 0.)
            };
            let pole = match geo.knee {
                Knee::Back => v3(-sn, 0., -c),
                Knee::Out => v3(c * l.hx + sn * l.hz, 0., -sn * l.hx + c * l.hz).norm(),
                Knee::Forward => v3(sn, 0., c),
            };
            let k = solve_knee(hp, ankle, pole, geo.l1 * sc, geo.l2 * sc);
            let (mt, ms) = (M4::limb(hp, k, pole, sc), M4::limb(k, ankle, pole, sc));
            let roll = an.map_or(0., |(pr, _)| anim::foot_roll(pr, m, i));
            let mf = M4::t(ankle.x, ankle.y - geo.ankle * sc + 0.2 * sc, ankle.z)
                * M4::ry(m.feet[i].yaw)
                * M4::rx(roll)
                * M4::s1(sc);
            gl.draw_plain(&p.uleg, &mt);
            gl.draw_plain(&p.lleg, &ms);
            gl.draw_plain(&p.foot, &mf);
            if let (Some(t1), Some(t2)) = (&p.toe1, &p.toe2) {
                use crate::models::{TOES, TOE_1};
                let (curl, spread) =
                    an.map_or((0., 1.), |(pr, a)| anim::toe_pose(pr, m, a, i, g.time));
                for h in TOES {
                    let near =
                        mf * M4::t(h[0], h[1], h[2]) * M4::ry(h[3] * spread) * M4::rx(curl * 0.55);
                    gl.draw_plain(t1, &near);
                    gl.draw_plain(t2, &(near * M4::t(0., 0., TOE_1) * M4::rx(curl * 0.75)));
                }
            }
            if p.pistons {
                use crate::models::{ANKLE, KNEE};
                let v = |a: [f32; 3]| v3(a[0], a[1], a[2]);
                piston(gl, mt.apply(v(KNEE.from)), ms.apply(v(KNEE.to)), &KNEE);
                piston(gl, ms.apply(v(ANKLE.from)), mf.apply(v(ANKLE.to)), &ANKLE);
            }
        }
        if m.flash.frame + 1 >= g.frame {
            // The muzzle flash, two frames, facing the camera's plane.
            let (k, f) = (if m.flash.big { 2.2 } else { 1.1 }, m.flash.p);
            let (r, u) = (self.right * k, self.up * k);
            let mm = M4([
                r.x, r.y, r.z, 0., u.x, u.y, u.z, 0., 0., 0., 1., 0., f.x, f.y, f.z, 1.,
            ]);
            gl.mode(Mode::Emissive);
            gl.draw(fx_mesh(self, Fx::Star), &mm, [1., 0.9, 0.5], 1.);
            gl.mode(Mode::Lit);
        }
    }
    fn draw_particles(&mut self, gl: &mut Gl, g: &Game, fog: [f32; 3]) {
        let shape = |k: PKind| match k {
            PKind::Smoke => Fx::Puff,
            PKind::Fire | PKind::Flame => Fx::Shard,
            PKind::Spark => Fx::Spark,
            PKind::Debris => Fx::Rock,
            PKind::Dust => Fx::DustPuff,
            PKind::Shock => Fx::Ring,
        };
        for f in [Fx::Puff, Fx::Shard, Fx::Spark, Fx::Rock, Fx::DustPuff] {
            self.inst.clear();
            for (i, p) in g.parts.iter().enumerate() {
                if shape(p.kind) != f || p.kind == PKind::Shock {
                    continue;
                }
                let age = 1. - p.life / p.life0;
                let (m, col, glow) = match p.kind {
                    PKind::Smoke | PKind::Dust => {
                        // A puff swells as it ages, greys toward the fog, and dissolves pixel
                        // by pixel through the dither. Never blending.
                        let t = clamp((age - 0.5) / 0.5, 0., 1.) * 0.8;
                        let size = p.size * (0.7 + 0.6 * age);
                        let solid = 1. - smooth((age - 0.55) / 0.45);
                        (
                            inst_mat(p.p, age * 1.5 + i as f32, age * 0.8 + i as f32 * 0.9, size),
                            [
                                lerp(p.col[0], fog[0], t),
                                lerp(p.col[1], fog[1], t),
                                lerp(p.col[2], fog[2], t),
                            ],
                            dissolve(0.45, solid),
                        )
                    }
                    PKind::Fire | PKind::Flame => {
                        let fl = 0.7 + 0.3 * (g.time * 40. + i as f32).sin();
                        (
                            inst_mat(p.p, i as f32 * 0.7, age * 3., p.size * (1. - age * 0.8)),
                            [p.col[0], p.col[1] * fl, p.col[2]],
                            1.,
                        )
                    }
                    PKind::Spark => (beam_mat(p.p, p.p + p.v * 0.04, p.size * 0.6), p.col, 1.),
                    _ => (
                        inst_mat(
                            p.p,
                            age * 6. + i as f32,
                            age * 9.,
                            p.size * if age > 0.9 { (1. - age) * 10. } else { 1. },
                        ),
                        p.col,
                        0.,
                    ),
                };
                self.inst.extend_from_slice(&m.0);
                self.inst.extend_from_slice(&[col[0], col[1], col[2], glow]);
            }
            let inst = std::mem::take(&mut self.inst);
            gl.draw_inst(fx_mesh(self, f), &inst);
            self.inst = inst;
        }
        // Shockwaves: flat rings that race out and dither away.
        gl.mode(Mode::Emissive);
        for p in g.parts.iter().filter(|p| p.kind == PKind::Shock) {
            let age = 1. - p.life / p.life0;
            let r = p.size * (0.15 + 0.85 * age);
            gl.dither(1. - age);
            gl.draw(
                fx_mesh(self, Fx::Ring),
                &(M4::t(p.p.x, p.p.y, p.p.z) * M4::s(r, 1., r)),
                p.col,
                1.,
            );
        }
        gl.dither(1.);
        gl.mode(Mode::Lit);
    }
    fn draw_debris(&mut self, gl: &mut Gl, g: &Game) {
        for d in &g.debris {
            self.parts(gl, d.ch);
            let p = self.parts[d.ch.i()].as_ref().unwrap();
            let mesh = match d.part {
                Part::Arm => &p.arm,
                Part::ULeg => &p.uleg,
                Part::LLeg => &p.lleg,
                Part::Foot => &p.foot,
                Part::Plate => &p.plate,
            };
            gl.draw_plain(
                mesh,
                &(M4::t(d.p.x, d.p.y, d.p.z)
                    * M4::ry(d.rot.y)
                    * M4::rx(d.rot.x)
                    * M4::rz(d.rot.z)
                    * M4::s1(d.scale)),
            );
        }
    }
    fn draw_shots(&self, gl: &mut Gl, g: &Game) {
        for s in &g.shots {
            let (d, dir) = (weapon(s.wpn), s.v.norm());
            if s.kind == WKind::Missile {
                let m = M4::limb(s.p + dir * 0.7, s.p - dir * 0.7, v3(0., 1., 0.), 1.)
                    * M4::rx(PI / 2.)
                    * M4::s(0.5, 1., 0.5);
                gl.draw(fx_mesh(self, Fx::Missile), &m, [0.75, 0.75, 0.72], 0.);
            } else if d.bolt {
                gl.mode(Mode::Emissive);
                gl.draw(
                    fx_mesh(self, Fx::Bolt),
                    &(M4::t(s.p.x, s.p.y, s.p.z) * M4::s1(1.1)),
                    d.col,
                    1.,
                );
                gl.mode(Mode::Lit);
            } else {
                let (tl, tw) = (
                    if d.tl > 0. { d.tl } else { 2.5 },
                    if d.tw > 0. { d.tw } else { 0.3 },
                );
                gl.mode(Mode::Emissive);
                gl.draw(
                    fx_mesh(self, Fx::Beam),
                    &beam_mat(s.p - dir * tl, s.p, tw),
                    d.tracer.unwrap_or([1., 0.75, 0.35]),
                    1.,
                );
                gl.mode(Mode::Lit);
            }
        }
        gl.mode(Mode::Emissive);
        for b in &g.cbeams {
            // Your own beams leave from just past the cockpit's arms, thinner: a wedge at the eye would fill the screen.
            let (mut a, mut w) = (b.a, b.w);
            if (a - g.eye).len() < 6. {
                let d = b.b - b.a;
                let l = d.len();
                if l > 6. {
                    a += d * (2.5 / l);
                    w *= 0.6;
                }
            }
            gl.draw(fx_mesh(self, Fx::Beam), &beam_mat(a, b.b, w), b.col, 1.);
        }
        for p in &g.pulses {
            // The fusion pulse: a bright knot travelling the beam.
            let at = p.a.mix(p.b, clamp(p.t / p.dur, 0., 1.));
            gl.draw(
                fx_mesh(self, Fx::Bolt),
                &(M4::t(at.x, at.y, at.z) * M4::s1(2.5)),
                [0.9, 0.7, 1.],
                1.,
            );
            gl.draw(
                fx_mesh(self, Fx::Beam),
                &beam_mat(p.a, p.b, 0.12 + 0.1 * (p.seed + g.time * 50.).sin()),
                weapon(Wpn::Fusion).col,
                1.,
            );
        }
        gl.mode(Mode::Lit);
    }
    fn draw_world(&mut self, gl: &mut Gl, g: &Game, eye: V3, fog_far: f32) {
        let half = g.ter.hx / TER_CHUNKS as f32;
        gl.world(true);
        for (m, c) in &self.ground {
            let (dx, dz) = (
                ((c.x - eye.x).abs() - half).max(0.),
                ((c.z - eye.z).abs() - half).max(0.),
            );
            if hypot2(dx, dz) <= fog_far + 50. {
                gl.draw_plain(m, &M4::ID); // chunks past the fog are skipped
            }
        }
        let low = PALS[g.biome.i()].low;
        let burn = [low[0] * 0.45, low[1] * 0.42, low[2] * 0.4]; // the ground, darkened: a burn, not a hole
        for s in &g.scorch {
            gl.draw(
                fx_mesh(self, Fx::Disc),
                &(M4::t(s.x, s.y + 0.12, s.z) * M4::s(s.r, 1., s.r)),
                burn,
                0.,
            );
        }
        gl.world(false);
        for w in &g.wrecks {
            self.parts(gl, w.ch);
            let sink = (1. - w.settle) * 0.8;
            let m = M4::t(w.x, w.y - sink * 0.3 + 0.2, w.z)
                * M4::ry(w.yaw)
                * M4::rz(w.roll * 0.5 + (w.t * 9.).sin() * (1. - w.settle) * 0.1)
                * M4::s1(w.scale);
            gl.draw_plain(&self.parts[w.ch.i()].as_ref().unwrap().wreck, &m);
        }
    }
    /// The cockpit camera: the eye in the torso, dropped by the kick and the bob, jittered by the shake,
    /// turned by the wobble, swimming when hot, zoomed, or riding a volley's nose.
    fn cockpit(&mut self, g: &Game, fov_deg: f32) -> (V3, V3, V3, f32) {
        let p = g.p();
        if let Some(gd) = &g.guide {
            return (
                gd.nose + gd.dir * 1.5 + v3(0., 0.3, 0.),
                gd.dir,
                v3(0., 1., 0.),
                0.95,
            );
        }
        let mut fov = if g.zoom { 0.42 } else { fov_deg * PI / 180. };
        let (sh, wv) = (
            g.shake * 0.012,
            VIEW_WOBBLE * if g.reduced_motion { REDUCED_SCALE } else { 1. },
        );
        self.jitter += 1.;
        let (jx, jy) = (
            (self.jitter * 12.9898).sin() * sh,
            (self.jitter * 78.233).cos() * sh,
        );
        let mut yaw = p.view_yaw() + p.wob_r.x * wv * 0.5 + jx;
        let mut pitch = p.pitch + p.wob_p.x * wv + jy + p.tilt_p.x * INERTIA_VIEW;
        let hot = if p.shutdown { 0. } else { hot_frac(p.heat) };
        if hot > 0. {
            fov *= 1. + HEAT_FOV * hot * (g.time * 2.6).sin();
            yaw += HEAT_SWAY * hot * (g.time * 1.9).sin();
            pitch += HEAT_SWAY * 0.6 * hot * (g.time * 1.3).cos();
        }
        let drop = g.kick + g.bob.x;
        let lurch = p.surge * p.ch.scale;
        let mut e = eye_of(p)
            + v3(
                p.yaw.sin() * lurch,
                -drop * 0.35 - p.squash.x * 2. - p.jet.charge * 1.1 * p.ch.scale - p.sag.x,
                p.yaw.cos() * lurch,
            );
        let mut roll = p.wob_r.x * wv * 0.6 + p.tilt_r.x * 0.5;
        if let Some(f) = p.fallen.or(p.dying) {
            pitch -= f.angle * 0.9;
            roll += f.roll * 0.8 * f.buckle.max(if p.fallen.is_some() { 1. } else { 0. });
            e.y -= f.drop + if p.fallen.is_some() { f.angle * 2. } else { 0. };
        }
        e.y = e.y.max(g.ter.height(e.x, e.z) + 0.6);
        let up = v3(roll.sin() * yaw.cos(), roll.cos(), -roll.sin() * yaw.sin());
        (e, dir_of(yaw, pitch - drop * 0.016), up, fov)
    }
    fn setup(
        &mut self,
        gl: &mut Gl,
        g: &Game,
        eye: V3,
        dir: V3,
        up: V3,
        fov: f32,
        w: i32,
        h: i32,
    ) -> M4 {
        let vp = M4::persp(fov, w as f32 / h as f32, 0.5, 2000.) * M4::look_at(eye, eye + dir, up);
        self.right = dir.cross(up).norm();
        self.up = self.right.cross(dir).norm();
        let fog = fog_of(g);
        gl.begin(w, h, g.pal.hor);
        gl.camera(&vp, eye);
        gl.light(g.pal.light, g.pal.shade, g.pal.hor, fog[0], fog[1]);
        gl.sky(g.pal.zen, g.pal.hor);
        let (ramp, tone) = crate::look::look_for(g);
        gl.look(self.cell, &ramp, tone);
        gl.world(false);
        gl.mode(Mode::Sky);
        gl.depth(false, false);
        gl.draw_plain(&self.sky, &M4::ID);
        gl.depth(true, true);
        gl.mode(Mode::Lit);
        vp
    }
    /// The match, from the cockpit (or a fixed camera). Returns the view-projection, for the HUD.
    pub fn render(
        &mut self,
        gl: &mut Gl,
        g: &Game,
        fov_deg: f32,
        w: i32,
        h: i32,
        cam: Option<&Cam>,
    ) -> M4 {
        let (eye, dir, up, fov) = match cam {
            Some(c) => (c.eye, (c.at - c.eye).norm(), v3(0., 1., 0.), c.fov),
            None => self.cockpit(g, fov_deg),
        };
        self.load_world(gl, g);
        let vp = self.setup(gl, g, eye, dir, up, fov, w, h);
        let fog = fog_of(g);
        self.draw_world(gl, g, eye, fog[1]);
        for id in 0..g.mechs.len() {
            let m = &g.mechs[id];
            if m.gone {
                continue;
            }
            if id == PLAYER && cam.is_none() {
                if g.guide.is_none() && m.alive {
                    self.draw_mech(gl, g, id, true);
                }
                continue;
            }
            if hypot2(m.x - eye.x, m.z - eye.z) <= fog[1] + 30. {
                self.draw_mech(gl, g, id, false);
            }
        }
        self.draw_debris(gl, g);
        self.draw_shots(gl, g);
        let p = g.p();
        if let (Some(at), true) = (p.jet.at, p.jet.charge > 0. || p.jet.blasted) {
            // Where this blast comes down: a ring on the ground, white on a stomp.
            let r = p.radius() * 1.2;
            gl.mode(Mode::Emissive);
            gl.draw(
                fx_mesh(self, Fx::Ring),
                &(M4::t(at.x, at.y + 0.3, at.z) * M4::s(r, 1., r)),
                if p.jet.on {
                    [1., 1., 1.]
                } else {
                    [0.5, 1., 0.5]
                },
                1.,
            );
            gl.mode(Mode::Lit);
        }
        self.draw_particles(gl, g, g.pal.hor);
        vp
    }
    /// The menu's turntable: the player's mech on a patch of desert, a camera looking at it.
    pub fn turntable(&mut self, gl: &mut Gl, g: &Game, w: i32, h: i32, lift: f32) -> M4 {
        let p = g.p();
        let r = 26. * p.ch.scale;
        let c = v3(p.x, p.y + 4.5 * p.ch.scale + lift, p.z);
        let eye = v3(c.x + 0.6f32.sin() * r, c.y + 2.5, c.z + 0.6f32.cos() * r);
        let _ = center_of(p);
        self.render(
            gl,
            g,
            62.,
            w,
            h,
            Some(&Cam {
                eye,
                at: c,
                fov: 0.75,
            }),
        )
    }
}
