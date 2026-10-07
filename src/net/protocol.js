// The arena's wire format: every message the client sends, built in one
// place. Bump PROTOCOL when a message changes shape, and server/server.py's
// PROTOCOL with it: the server turns any other version away. Numbers are rounded to centimetres / hundredths.
import { HPK } from '../data/chassis.js';
import { WEAPONS } from '../data/weapons.js';

export const PROTOCOL = 12;   // 2: melee (pu in s and fx; kb/me/st on hit; me on died). 3: lo (mechlab loadout) in s, note from the server. 4: w on fx s and fx m; zap on hit. 5: hh (heat) on hit. 6: knuckles in lo.sys. 7: lt (headlights) in s. 8: the server enforces the version (version message) and rebuilds s clean. 9: the lobby (ch in hello; ready; ping; ch, ready, ping in scores). 10: team deathmatch (team; team in scores; teams, mode and limit in newround; teams in welcome, kill and roundover). 11: the round-end vote (vote, stats; tally; best and acc in scores; vote in newround). 12: reconnect (token in hello; token and resumed in welcome)
export const r2 = v => Math.round(v * 100) / 100;
const v3 = p => p.map(r2);

// token: from the last welcome, so a pilot who dropped comes back to their id and score.
export const hello = (name, color, ch, token) => (token ? { t: 'hello', v: PROTOCOL, name, color, ch, token } : { t: 'hello', v: PROTOCOL, name, color, ch });
// The lobby: READY spawns you in; a ping every PING_EVERY ms carries the last round trip (ms) to the server.
export const ready = () => ({ t: 'ready' });
export const ping = (n, rtt) => ({ t: 'ping', n, rtt: Math.round(rtt || 0) });
export const PING_EVERY = 2000;
// Team deathmatch: a side picked in the lobby (0 STEEL, 1 RED).
export const team = t => ({ t: 'team', team: t ? 1 : 0 });
// Between rounds: your vote for the next one (map: 'next' | 'same', mode:
// 'ffa' | 'tdm'), and your accuracy for the summary, in %.
export const vote = (map, mode) => ({ t: 'vote', map, mode });
export const roundStats = acc => ({ t: 'stats', acc: Math.round(acc) });

// Your mech, 15 times a second: chassis, pose, speed, flags, armour, your
// laser beam (bm/be/bf), and the fusion scan (fl: where the targeting laser
// ends, sc: who it's on, sq: how far along, 0..1), and the punch phase (pu:
// 0 none, 1 wind-up, 2 recovery) so the swing animates on every screen, and
// whether its headlights are on (lt).
// `lo`: the mechlab loadout, included when asked (see sendState).
export function stateMessage(P, bf, withLoadout = false) {
  const fu = P.fusion;
  return { t: 's', ch: P.type, x: r2(P.x), y: r2(P.y), z: r2(P.z), yaw: r2(P.yaw), tw: r2(P.twist), p: r2(P.pitch), sp: r2(P.speed),
    air: P.air ? 1 : 0, al: P.alive ? 1 : 0, sd: P.shutdown ? 1 : 0, hp: HPK.map(k => r2(P.hp[k])),
    bm: P.beaming ? 1 : 0, be: P.beaming && P.beamEnd ? v3(P.beamEnd) : 0, bf: r2(bf),
    fl: fu?.on && fu.end ? v3(fu.end) : 0, sc: fu?.mech?.netId || 0,
    sq: fu?.mech ? r2(Math.min(1, fu.t / WEAPONS.fusion.scan)) : 0,
    pu: P.melee ? (P.melee.phase === 'windup' ? 1 : 2) : 0, lt: P.lights ? 1 : 0,
    ...(withLoadout && P.loadout ? { lo: P.loadout } : {}) };
}

// Weapon effects: drawn by everyone, scored by the shooter.
export const fxBeam = (type, a, b) => ({ t: 'fx', k: 'b', w: type, a: v3(a), b: v3(b) });
export const fxShell = (p, v, w = 'ac') => ({ t: 'fx', k: 's', p: v3(p), v: v3(v), w });
export const fxMissiles = (p, d, targetId, vid, w = 'lrm') => ({ t: 'fx', k: 'm', p: v3(p), d: v3(d), tg: targetId || 0, v: vid, w });
export const fxGuide = (vid, p, d) => ({ t: 'fx', k: 'mg', v: vid, p: v3(p), d: v3(d) });
export const fxDetonate = vid => ({ t: 'fx', k: 'md', v: vid });
export const fxFusion = (a, targetId, b) => ({ t: 'fx', k: 'fu', a: v3(a), id2: targetId || 0, b: v3(b) });
export const fxPunch = () => ({ t: 'fx', k: 'pu' });   // the swing starts: others see the wind-up at once

// Damage to another pilot (the victim applies it); fu: a fusion kill.
// kb: a knockback impulse [vx, vz] the victim adds to its push (the server
// clamps each part to +-30); me: it was a punch; st: it was a stomp.
export function hit(to, amt, p, fu = false, { kb, me, st, zap, hh } = {}) {
  const m = fu ? { t: 'hit', to, amt: 40, p: v3(p), fu: 1 } : { t: 'hit', to, amt: r2(amt), p: v3(p) };
  if (kb && (kb[0] || kb[1])) m.kb = [r2(kb[0]), r2(kb[1])];
  if (me) m.me = 1;
  if (st) m.st = 1;
  if (zap) m.zap = 1;   // a bolt: the victim's HUD scrambles
  if (hh > 0) m.hh = r2(hh);   // heat poured in (TOASTER): the victim adds it
  return m;
}
export const died = (by, me = false) => (me ? { t: 'died', by: by || 0, me: 1 } : { t: 'died', by: by || 0 });

// Parse what the server sends. Unknown or malformed messages come back null.
export function parse(text) {
  let m;
  try { m = JSON.parse(text); } catch { return null; }
  return m && typeof m === 'object' && typeof m.t === 'string' ? m : null;
}
