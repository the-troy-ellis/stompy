//! Free Play's WATCH: a camera you fly over a battle with the same controls you walk with.
//! Left stick flies, right stick (or the gyro, or the mouse) looks, A rises, B sinks, RT holds
//! for speed, X jumps to where the fighting is. Outside the sim: it only reads the input.
use stompy_sim::math::*;
use stompy_sim::{Game, Input, PLAYER};

pub struct FreeCam {
    pub pos: V3,
    pub yaw: f32,
    pub pitch: f32,
}
const SPEED: f32 = 35.;
const FAST: f32 = 4.;
const LOOK: f32 = 1.8;
impl FreeCam {
    /// Off to the side of the two armies, up high, looking across the gap between them.
    pub fn new(g: &Game) -> FreeCam {
        let mut c = FreeCam {
            pos: V3::ZERO,
            yaw: 0.,
            pitch: 0.,
        };
        c.to_the_fight(g);
        c
    }
    /// Where the fighting is: behind your side, up high, looking past it at theirs, so both
    /// armies (or what is left of them) are in view.
    pub fn to_the_fight(&mut self, g: &Game) {
        let mid = |team: u8| {
            let (mut sum, mut n) = (V3::ZERO, 0.);
            for (i, m) in g.mechs.iter().enumerate() {
                if i != PLAYER && m.alive && m.team == team {
                    sum += v3(m.x, m.y, m.z);
                    n += 1.;
                }
            }
            (n > 0.).then(|| sum * (1. / n))
        };
        let (a, b) = match (mid(0), mid(1)) {
            (Some(a), Some(b)) => (a, b),
            (Some(a), None) | (None, Some(a)) => (a, a + v3(0., 0., 1.)),
            (None, None) => (V3::ZERO, v3(0., 0., 1.)),
        };
        let mut across = v3(b.x - a.x, 0., b.z - a.z);
        if across.len() < 40. {
            across = v3(0., 0., 1.); // the armies have met: any side will do
        }
        let along = across.norm();
        let look = (a + b) * 0.5;
        self.pos = a - along * 180. + v3(0., 85., 0.);
        let to = look - self.pos;
        self.yaw = to.x.atan2(to.z);
        self.pitch = (to.y / hypot2(to.x, to.z).max(1.)).atan();
    }
    pub fn dir(&self) -> V3 {
        dir_of(self.yaw, self.pitch)
    }
    /// One frame of flying, from the same input the mech takes.
    pub fn fly(&mut self, g: &Game, i: &Input, dt: f32) {
        if i.target {
            self.to_the_fight(g);
        }
        self.yaw += i.twist * LOOK * dt + i.twist_by;
        self.pitch = clamp(self.pitch + i.pitch * LOOK * dt + i.pitch_by, -1.45, 1.2);
        let fwd = dir_of(self.yaw, 0.);
        let left = v3(fwd.z, 0., -fwd.x);
        let up = if i.jets { 1. } else { 0. } - if i.centre { 1. } else { 0. };
        let v = (self.dir() * i.thr + left * i.turn + v3(0., up, 0.))
            * (SPEED * if i.energy { FAST } else { 1. });
        self.pos += v * dt;
        let (bx, bz) = (g.ter.bx + 300., g.ter.bz + 300.);
        self.pos.x = clamp(self.pos.x, -bx, bx);
        self.pos.z = clamp(self.pos.z, -bz, bz);
        self.pos.y = clamp(self.pos.y, g.ter.height(self.pos.x, self.pos.z) + 3., 900.);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use stompy_sim::data::*;
    use stompy_sim::state::{spectate, start_battle};
    #[test]
    fn it_starts_looking_at_the_armies_and_flies_where_it_is_pointed() {
        let mut g = Game::new(1);
        start_battle(
            &mut g,
            Biome::Dusk,
            TimeOfDay::Dusk,
            8,
            8,
            1,
            Ch::Kestrel,
            Diff::Normal,
            true,
        );
        spectate(&mut g);
        let mut c = FreeCam::new(&g);
        // Both armies are ahead of it.
        for (i, m) in g.mechs.iter().enumerate().skip(1) {
            let to = (v3(m.x, m.y, m.z) - c.pos).norm();
            assert!(to.dot(c.dir()) > 0.6, "mech {i} out of view");
        }
        let at = c.pos;
        let i = Input {
            thr: 1.,
            ..Input::default()
        };
        c.fly(&g, &i, 1.);
        assert!((c.pos - at).dot(c.dir()) > 30., "forward is where it looks");
        assert!(c.pos.y >= g.ter.height(c.pos.x, c.pos.z) + 3.);
    }
}
