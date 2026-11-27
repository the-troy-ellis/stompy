//! The HUD and every menu: monospace green text and line work drawn as
//! polygons (a 5x7 pixel font, each pixel a quad), on top of the 3D view.
//! Readable at a glance at arm's length: heat, damage, target and ammo.
use crate::font::FONT;
use crate::gl::{Gl, Mesh, Mode};
use stompy_sim::beams::melt_frac;
use stompy_sim::data::names::*;
use stompy_sim::data::*;
use stompy_sim::geom::{center_of, lead_point};
use stompy_sim::math::*;
use stompy_sim::*;

pub type Col = [f32; 3];
pub const GREEN: Col = [0.36, 1., 0.36];
pub const AMBER: Col = [1., 0.8, 0.2];
pub const RED: Col = [1., 0.27, 0.27];
pub const DIM: Col = [0.14, 0.42, 0.14];
pub const WHITE: Col = [0.95, 1., 0.95];
pub const BLACK: Col = [0.02, 0.03, 0.02];

#[derive(Default)]
pub struct Hud {
    b: Vec<f32>,
    mesh: Option<Mesh>,
    pub w: f32,
    pub h: f32,
}
fn glyph(c: char) -> Option<&'static [u8]> {
    let c = c.to_ascii_uppercase() as usize;
    if !(32..96).contains(&c) {
        return None;
    }
    let g = FONT[c - 32].as_bytes();
    if g.is_empty() {
        None
    } else {
        Some(g)
    }
}
impl Hud {
    pub fn begin(&mut self, w: i32, h: i32) {
        self.w = w as f32;
        self.h = h as f32;
        self.b.clear();
    }
    fn tri(&mut self, p: [f32; 6], c: Col) {
        for k in 0..3 {
            self.b
                .extend_from_slice(&[p[k * 2], p[k * 2 + 1], 0., 0., 0., 1., c[0], c[1], c[2]]);
        }
    }
    pub fn rect(&mut self, x: f32, y: f32, w: f32, h: f32, c: Col) {
        self.tri([x, y, x + w, y, x + w, y + h], c);
        self.tri([x, y, x + w, y + h, x, y + h], c);
    }
    pub fn line(&mut self, x0: f32, y0: f32, x1: f32, y1: f32, t: f32, c: Col) {
        let (dx, dy) = (x1 - x0, y1 - y0);
        let l = (dx * dx + dy * dy).sqrt();
        if l < 1e-4 {
            return;
        }
        let (nx, ny) = (-dy / l * t / 2., dx / l * t / 2.);
        self.tri([x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny], c);
        self.tri([x0 + nx, y0 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny], c);
    }
    /// An arc: angles are 0 at the top, clockwise.
    pub fn arc(&mut self, cx: f32, cy: f32, r: f32, a0: f32, a1: f32, t: f32, c: Col) {
        let n = (((a1 - a0).abs() * r / 6.) as usize + 2).min(96);
        for i in 0..n {
            let (u0, u1) = (
                a0 + (a1 - a0) * i as f32 / n as f32,
                a0 + (a1 - a0) * (i + 1) as f32 / n as f32,
            );
            self.line(
                cx + u0.sin() * r,
                cy - u0.cos() * r,
                cx + u1.sin() * r,
                cy - u1.cos() * r,
                t,
                c,
            );
        }
    }
    pub fn poly(&mut self, xy: &[f32], c: Col) {
        for i in 1..xy.len() / 2 - 1 {
            self.tri(
                [
                    xy[0],
                    xy[1],
                    xy[i * 2],
                    xy[i * 2 + 1],
                    xy[i * 2 + 2],
                    xy[i * 2 + 3],
                ],
                c,
            );
        }
    }
    pub fn text_w(px: f32, s: &str) -> f32 {
        s.chars().count() as f32 * 6. * px - px
    }
    pub fn text(&mut self, x: f32, y: f32, px: f32, s: &str, c: Col) {
        for (k, ch) in s.chars().enumerate() {
            let Some(g) = glyph(ch) else { continue };
            let x0 = x + k as f32 * 6. * px;
            for r in 0..7 {
                for q in 0..5 {
                    if g.get(r * 5 + q) == Some(&b'#') {
                        self.rect(x0 + q as f32 * px, y + r as f32 * px, px, px, c);
                    }
                }
            }
        }
    }
    pub fn text_c(&mut self, cx: f32, y: f32, px: f32, s: &str, c: Col) {
        self.text(cx - Hud::text_w(px, s) / 2., y, px, s, c);
    }
    /// Draw what is batched so far, dithered (1: solid).
    pub fn flush(&mut self, gl: &mut Gl, dither: f32) {
        if self.b.is_empty() {
            return;
        }
        let o = M4::ortho(0., self.w, self.h, 0., -1., 1.);
        gl.mode(Mode::Hud);
        gl.camera(&o, V3::ZERO);
        gl.dither(dither);
        gl.update(&mut self.mesh, &self.b);
        if let Some(m) = &self.mesh {
            gl.draw_plain(m, &M4::ID);
        }
        gl.dither(1.);
        self.b.clear();
    }
}
/// Where a world point lands on screen, or None behind the camera.
pub fn project(vp: &M4, p: V3, w: f32, h: f32) -> Option<(f32, f32)> {
    let m = &vp.0;
    let (cx, cy, cw) = (
        m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12],
        m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13],
        m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15],
    );
    if cw <= 0.01 {
        return None;
    }
    Some(((cx / cw * 0.5 + 0.5) * w, (1. - (cy / cw * 0.5 + 0.5)) * h))
}
fn hp_col(frac: f32, t: f32) -> Col {
    if frac <= 0. {
        [0.12, 0.12, 0.12]
    } else if frac < 0.15 && t % 0.3 < 0.15 {
        WHITE
    } else if frac > 0.6 {
        GREEN
    } else if frac > 0.3 {
        AMBER
    } else {
        RED
    }
}
/// The ring: your own damage in the middle, heat up the left, jets up the right, speed along the bottom.
fn ring(h: &mut Hud, g: &Game, cx: f32, cy: f32, r: f32, s: f32) {
    let p = g.p();
    let t = 2.5 * s;
    h.arc(cx, cy, r, -0.75 * PI, -0.25 * PI, t, DIM);
    h.arc(cx, cy, r, 0.25 * PI, 0.75 * PI, t, DIM);
    h.arc(cx, cy, r, 0.7 * PI, 1.3 * PI, t, DIM);
    // Heat: amber over 55, red over 80, flashing over 85; the reactor down, it goes dark and blinks.
    let heat = clamp(p.heat / 100., 0., 1.);
    let mut hc = if p.heat > 80. {
        RED
    } else if p.heat > 55. {
        AMBER
    } else {
        GREEN
    };
    if p.heat > 85. && g.time % 0.25 < 0.12 {
        hc = WHITE;
    }
    if p.shutdown && g.time % 0.6 < 0.3 {
        hc = DIM;
    }
    h.arc(
        cx,
        cy,
        r,
        -0.75 * PI,
        -0.75 * PI + 0.5 * PI * heat,
        t * 2.2,
        hc,
    );
    if p.jets > 0 {
        h.arc(
            cx,
            cy,
            r,
            0.75 * PI,
            0.75 * PI - 0.5 * PI * p.fuel,
            t * 2.2,
            if p.fuel >= 1. { GREEN } else { DIM },
        );
        if p.jet.charge > 0. {
            h.arc(
                cx,
                cy,
                r - 6. * s,
                0.75 * PI,
                0.75 * PI - 0.5 * PI * p.jet.charge,
                t * 1.6,
                WHITE,
            );
        }
    }
    // Speed: reverse to full from left to right along the bottom, a tick at zero, the throttle's notch outside.
    let spa = |u: f32| 1.3 * PI - 0.6 * PI * u;
    let (sp, zero) = (
        (clamp(p.speed / p.max_speed, -0.35, 1.) + 0.35) / 1.35,
        0.35 / 1.35,
    );
    if sp > zero {
        h.arc(cx, cy, r, spa(zero), spa(sp), t * 2.2, GREEN);
    } else {
        h.arc(cx, cy, r, spa(sp), spa(zero), t * 2.2, AMBER);
    }
    let tick = |h: &mut Hud, a: f32, r0: f32, r1: f32, w: f32, c: Col| {
        h.line(
            cx + a.sin() * r0,
            cy - a.cos() * r0,
            cx + a.sin() * r1,
            cy - a.cos() * r1,
            w,
            c,
        )
    };
    tick(h, spa(zero), r - 7. * s, r + 7. * s, t, GREEN);
    tick(
        h,
        spa((clamp(p.throttle, -0.35, 1.) + 0.35) / 1.35),
        r + 5. * s,
        r + 12. * s,
        t * 1.6,
        AMBER,
    );
    h.text_c(
        cx,
        cy + r + 16. * s,
        2. * s,
        &format!("{} KPH", (p.speed.abs() * 3.6) as i32),
        GREEN,
    );
    // The damage diagram: torso, arms, legs, each by its armour.
    let u = r * 0.012;
    let f = |sec: Sec| p.hp[sec.i()] / p.max[sec.i()];
    h.rect(
        cx - 14. * u,
        cy - 30. * u,
        28. * u,
        32. * u,
        hp_col(f(Sec::T), g.time),
    );
    h.rect(
        cx - 30. * u,
        cy - 26. * u,
        12. * u,
        30. * u,
        hp_col(f(Sec::LA), g.time),
    );
    h.rect(
        cx + 18. * u,
        cy - 26. * u,
        12. * u,
        30. * u,
        hp_col(f(Sec::RA), g.time),
    );
    h.rect(
        cx - 14. * u,
        cy + 6. * u,
        12. * u,
        34. * u,
        hp_col(f(Sec::LL), g.time),
    );
    h.rect(
        cx + 2. * u,
        cy + 6. * u,
        12. * u,
        34. * u,
        hp_col(f(Sec::RL), g.time),
    );
    if p.heat > 85. && !p.shutdown {
        h.text_c(cx, cy - r - 18. * s, 2. * s, "HEAT", RED);
    }
    if p.shutdown {
        h.text_c(
            cx,
            cy - r - 18. * s,
            2. * s,
            "SHUTDOWN",
            if g.time % 0.6 < 0.3 { RED } else { AMBER },
        );
    }
    if melt_frac(p) > 0.05 {
        h.text_c(
            cx,
            cy - r - 36. * s,
            2. * s,
            "MELTING",
            if melt_frac(p) > 0.6 { RED } else { AMBER },
        );
    }
}
fn weapons(h: &mut Hud, g: &Game, x: f32, mut y: f32, s: f32) {
    let p = g.p();
    let (px, row) = (2. * s, 17. * s);
    let label = ["ENERGY  RT", "BALLISTIC  RB", "MISSILE  LT", "FUSION  LB"];
    for &cat in Cat::ALL {
        let mut first = true;
        for w in p.w.iter().filter(|w| w.def.cat == cat) {
            if first {
                h.text(x, y, px, label[cat.i()], DIM);
                y += row;
                first = false;
            }
            let out = w.def.ammo > 0 && w.ammo <= 0;
            let c = if w.dead {
                DIM
            } else if out {
                RED
            } else {
                GREEN
            };
            if w.def.kind == WKind::Fusion {
                let scan = if p.fusion.on && p.fusion.mech.is_some() {
                    (p.fusion.t / w.def.scan).min(1.)
                } else {
                    0.
                };
                h.text(
                    x,
                    y,
                    px,
                    weapon_name(w.key),
                    if w.cd > 0. {
                        DIM
                    } else if p.fusion.mech.is_some() {
                        WHITE
                    } else {
                        c
                    },
                );
                if w.cd > 0. {
                    h.text(
                        x + 150. * s,
                        y,
                        px,
                        &format!("{}S", w.cd.ceil() as i32),
                        DIM,
                    );
                } else if scan > 0. {
                    h.rect(x, y + 12. * s, 180. * s * scan, 3. * s, WHITE);
                }
            } else {
                h.text(x, y, px, weapon_name(w.key), c);
                if w.def.ammo > 0 {
                    h.text(x + 150. * s, y, px, &w.ammo.to_string(), c);
                }
                if w.def.kind != WKind::Beam && w.def.cd > 0. && w.cd > 0. {
                    h.rect(
                        x,
                        y + 12. * s,
                        180. * s * (1. - clamp(w.cd / w.def.cd, 0., 1.)),
                        2. * s,
                        DIM,
                    );
                }
            }
            y += row;
        }
    }
}
fn radar(h: &mut Hud, g: &Game, cx: f32, cy: f32, r: f32, s: f32) {
    let p = g.p();
    let (yaw, range) = (p.view_yaw(), RADAR_RANGE * WEATHER[g.weather.i()].radar);
    h.arc(cx, cy, r, 0., TAU, 1.5 * s, DIM);
    let wedge = [
        cx,
        cy,
        cx + (-0.5f32).sin() * r,
        cy - (-0.5f32).cos() * r,
        cx + 0.5f32.sin() * r,
        cy - 0.5f32.cos() * r,
    ];
    h.poly(&wedge, BLACK);
    h.line(cx, cy, wedge[2], wedge[3], s, DIM);
    h.line(cx, cy, wedge[4], wedge[5], s, DIM);
    h.rect(cx - 2. * s, cy - 2. * s, 4. * s, 4. * s, GREEN);
    for (i, m) in g.mechs.iter().enumerate() {
        if i == PLAYER || !m.alive {
            continue;
        }
        let (dx, dz) = (m.x - p.x, m.z - p.z);
        let d = hypot2(dx, dz);
        if d > range {
            continue;
        }
        let (a, rr) = (dx.atan2(dz) - yaw, d / range * r);
        let jx = if p.scramble > 0. {
            ((g.time * 91. + i as f32 * 7.).sin()) * 10. * s
        } else {
            0.
        };
        let c = if Some(i) == g.target {
            WHITE
        } else if m.team == 0 {
            GREEN
        } else {
            RED
        };
        h.rect(
            cx + a.sin() * rr - 2.5 * s + jx,
            cy - a.cos() * rr - 2.5 * s,
            5. * s,
            5. * s,
            c,
        );
    }
}
/// The target: brackets coloured by its torso, a diamond on a lock, the distance, the shell's lead.
fn target(h: &mut Hud, g: &Game, vp: &M4, s: f32) {
    let Some(t) = g.target else { return };
    let (tm, p) = (&g.mechs[t], g.p());
    if !tm.alive || p.scramble > 0. {
        return;
    }
    let c = center_of(tm);
    let (Some((sx, sy)), Some((_, ry))) = (
        project(vp, c, h.w, h.h),
        project(vp, v3(tm.x, tm.top(), tm.z), h.w, h.h),
    ) else {
        return;
    };
    let r = (14. * s).max((sy - ry).abs() * 0.75);
    let col = hp_col(tm.hp[Sec::T.i()] / tm.max[Sec::T.i()], g.time);
    let tk = 2. * s;
    if g.lock_on {
        let d = [(0., -r), (r, 0.), (0., r), (-r, 0.), (0., -r)];
        for k in 0..4 {
            h.line(
                sx + d[k].0,
                sy + d[k].1,
                sx + d[k + 1].0,
                sy + d[k + 1].1,
                tk,
                col,
            );
        }
    } else {
        let k = r * 0.4;
        for (ox, oy) in [(-r, -r), (r, -r), (-r, r), (r, r)] {
            h.line(sx + ox, sy + oy, sx + ox - k * sign(ox), sy + oy, tk, col);
            h.line(sx + ox, sy + oy, sx + ox, sy + oy - k * sign(oy), tk, col);
        }
    }
    h.text_c(
        sx,
        sy + r + 6. * s,
        2. * s,
        &format!("{} M", (c - g.eye).len() as i32),
        col,
    );
    if g.lock {
        if let Some((lx, ly)) = project(vp, lead_point(g.eye, tm, weapon(Wpn::Ac).speed), h.w, h.h)
        {
            let d = 5. * s;
            let pts = [(0., -d), (d, 0.), (0., d), (-d, 0.), (0., -d)];
            for k in 0..4 {
                h.line(
                    lx + pts[k].0,
                    ly + pts[k].1,
                    lx + pts[k + 1].0,
                    ly + pts[k + 1].1,
                    s,
                    col,
                );
            }
        }
    }
}
pub struct HudOpts {
    pub scale: f32,
    pub debug: bool,
    pub fps: f32,
    pub draws: usize,
    pub pad: bool,
}
/// The instruments for a match in play.
pub fn draw_hud(h: &mut Hud, gl: &mut Gl, g: &Game, vp: &M4, o: &HudOpts) {
    let p = g.p();
    let s = (o.scale * h.h / 800.).max(0.5);
    let drop = (g.kick + g.bob.x) * 2.5 * s; // the HUD floats behind the camera's drop
    let (cx, cy) = (h.w / 2., h.h / 2. + drop);
    if let Some(gd) = &g.guide {
        // Riding a volley: the nose camera.
        h.text_c(
            cx,
            40. * s,
            3. * s,
            if gd.n > 0 {
                "MISSILE CAM"
            } else {
                "SIGNAL LOST"
            },
            if gd.n > 0 { GREEN } else { RED },
        );
        h.arc(cx, cy, 20. * s, 0., TAU, 2. * s, GREEN);
        let (w, hh) = (h.w, h.h);
        for (x, y, ww, hhh) in [
            (0., 0., w, 6. * s),
            (0., hh - 6. * s, w, 6. * s),
            (0., 0., 6. * s, hh),
            (w - 6. * s, 0., 6. * s, hh),
        ] {
            h.rect(x, y, ww, hhh, DIM);
        }
        h.flush(gl, 1.);
        return;
    }
    // The crosshair: four ticks and a dot; an X when a hit lands.
    let (r, gap) = (14. * s, 6. * s);
    h.line(cx - r, cy, cx - gap, cy, 2. * s, GREEN);
    h.line(cx + gap, cy, cx + r, cy, 2. * s, GREEN);
    h.line(cx, cy - r, cx, cy - gap, 2. * s, GREEN);
    h.line(cx, cy + gap, cx, cy + r, 2. * s, GREEN);
    h.rect(cx - s, cy - s, 2. * s, 2. * s, GREEN);
    if g.hit_mark > 0. {
        let k = 5. * s;
        h.line(cx - k, cy - k, cx + k, cy + k, 2. * s, WHITE);
        h.line(cx - k, cy + k, cx + k, cy - k, 2. * s, WHITE);
    }
    if g.punch_ready {
        h.text_c(
            cx,
            cy + 22. * s,
            2. * s,
            "PUNCH",
            if p.melee.is_some() { WHITE } else { AMBER },
        );
    }
    if p.jet.charge > 0. && p.jet.on {
        h.text_c(cx, cy - 32. * s, 2. * s, "STOMP", WHITE);
    }
    target(h, g, vp, s);
    ring(h, g, 110. * s, h.h - 125. * s + drop * 0.5, 72. * s, s);
    weapons(h, g, h.w - 215. * s, h.h - 185. * s + drop * 0.5, s);
    radar(h, g, h.w - 75. * s, 80. * s, 55. * s, s);
    let name = g.mission.map_or("FREE PLAY", |m| MISSION_NAMES[m]);
    h.text(16. * s, 14. * s, 2. * s, name, DIM);
    h.text(
        16. * s,
        32. * s,
        2. * s,
        &format!("ENEMIES {}", g.enemies_left()),
        GREEN,
    );
    h.text(
        16. * s,
        50. * s,
        2. * s,
        &format!("{}:{:02}", g.time as i32 / 60, g.time as i32 % 60),
        DIM,
    );
    let hd = ((-p.view_yaw() * 180. / PI) as i32).rem_euclid(360);
    h.text_c(cx, 14. * s, 2. * s, &format!("{hd:03}"), GREEN);
    for k in -3..=3 {
        let a = hd + k * 15 - hd % 15;
        let dx = (a - hd) as f32 * 4. * s;
        h.rect(
            cx + dx - s,
            30. * s,
            2. * s,
            if a % 90 == 0 { 8. } else { 4. } * s,
            DIM,
        );
    }
    if let Some(t) = g.target.filter(|&t| g.mechs[t].alive) {
        let a = wrap((g.mechs[t].x - p.x).atan2(g.mechs[t].z - p.z) - p.view_yaw()) * 180. / PI;
        if a.abs() < 50. {
            h.rect(cx - a * 4. * s - 2. * s, 36. * s, 4. * s, 4. * s, RED);
        }
    }
    // Messages: the cockpit voice and the rest, under the crosshair.
    for (i, m) in g.msgs.iter().enumerate() {
        if m.t < 0.3 && m.t % 0.1 < 0.05 {
            continue;
        }
        h.text_c(
            cx,
            cy + 60. * s + i as f32 * 16. * s,
            2. * s,
            &m.text.to_uppercase(),
            if m.warn { AMBER } else { GREEN },
        );
    }
    if o.debug {
        let t = format!(
            "{:4.1} FPS  {} DRAWS  {} PARTS  {} SHOTS  {}",
            o.fps,
            o.draws,
            g.parts.len(),
            g.shots.len(),
            if o.pad { "PAD" } else { "KEYS" }
        );
        h.text(16. * s, 70. * s, 1.5 * s, &t, DIM);
    }
    h.flush(gl, 1.);
    // The flashes: a dithered sheet of red or white, never a blend; dark under a shutdown.
    let (w, hh) = (h.w, h.h);
    if g.flash > 0.01 {
        h.rect(0., 0., w, hh, RED);
        h.flush(gl, clamp(g.flash * 0.5, 0., 0.45));
    }
    if g.white_flash > 0.01 {
        h.rect(0., 0., w, hh, WHITE);
        h.flush(gl, clamp(g.white_flash * 0.8, 0., 0.7));
    }
    if p.shutdown {
        h.rect(0., 0., w, hh, BLACK);
        h.flush(gl, 0.3);
    }
}
