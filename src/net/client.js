import { $, esc } from '../util/dom.js';
import { store } from '../util/store.js';
import { add, dirOf, len, mul, norm, rnd, sub, TAU } from '../util/math.js';
import { WEAPONS } from '../data/weapons.js';
import { CHASSIS, HPK } from '../data/chassis.js';
import { MP_COLORS } from '../data/colors.js';
import { BOUND } from '../world/terrain.js';
import { newMech, resetMatch } from '../sim/state.js';
import { placeScenery } from '../sim/entities.js';
import { eyeOf } from '../sim/geom.js';
import { initFeet } from '../sim/gait.js';
import { msg, particle, explode } from '../sim/effects.js';
import { beginDeath, damage, destroy, scramble, shedSection } from '../sim/combat.js';
import { knock } from '../sim/knock.js';
import { feel } from '../sim/feel.js';
import { voice } from '../sim/voice.js';
import { beamMult } from '../sim/beams.js';
import { launchPulse } from '../sim/fusion.js';
import { SEND_HZ } from '../sim/missiles.js';
import { PROTOCOL, hit, stateMessage } from './protocol.js';
import { fitOf } from '../ui/mechlab.js';
import { applyLoadout, stockLoadout, validate } from '../sim/loadout.js';

const { sin, cos, atan2, min, max, random, hypot } = Math;
const clamp30 = v => max(-30, min(30, +v || 0));

// The arena client: join, the message handler, spawn and respawn, the 15 Hz
// state send, and relayed effects. The server relays; this client is the
// authority for its own mech. See docs/architecture.md for the protocol.
export function createNet(app) {
  const G = app.G, prefs = app.prefs;
  const ov = app.ov;
  void ov; void esc; void $;

  // A free-for-all for up to eight pilots via server.py (net/relay.js finds it). Each
  // client is the authority for its own mech: it sends its state ~15 times a
  // second, reports hits it lands, applies hits it takes, and declares its
  // own death. Other pilots are drawn from their latest state, smoothed and
  // extrapolated, and walk with the same gait. Their shots arrive as effects
  // ("ghosts") that look real but never score -- their shooter scores them.
  const Net = { ws: null, id: 0, info: new Map(), sendT: 0, limit: 10, loSent: '', loN: 0 };
  const mp = () => G.mode === 'mp';
  const pilotName = id => Net.info.get(id)?.name || `PILOT ${id}`;
  const pilotCss = id => MP_COLORS[Net.info.get(id)?.color ?? 0]?.css || '#f44';
  const mechById = id => (id === Net.id ? G.player : G.mechs.find(m => m.netId === id));

  

  function join() {
    if (Net.ws) return;
    prefs.mpName = ($('.callsign', ov)?.value || '').trim().toUpperCase().slice(0, 12);
    store.set('mp.name', prefs.mpName); store.set('mp.color', prefs.mpColor);
    app.audio.Sound.unlock(); app.audio.loadSamples();
    app.ui.setStatus('CONNECTING...');
    let ws, welcomed = false;
    try { ws = new WebSocket(app.relay().url); }   // net/relay.js: ?relay=, the RELAY field, or this page's host
    catch { app.ui.setStatus('COULD NOT CONNECT'); return; }
    Net.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, name: prefs.mpName, color: prefs.mpColor }));
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'welcome') welcomed = true;
      onNet(m);
    };
    ws.onclose = () => {
      if (Net.ws !== ws) return;   // we closed it on purpose
      Net.ws = null;
      if (!welcomed) { if (G.state === 'menu' && !/FULL/.test($('.status', ov)?.textContent || '')) app.ui.setStatus('THE ARENA SERVER IS NOT ANSWERING'); }
      else if (mp()) lostConnection();
    };
  }
  function netSend(obj) { if (Net.ws && Net.ws.readyState === 1) Net.ws.send(JSON.stringify(obj)); }
  function leaveArena() {
    const ws = Net.ws; Net.ws = null; ws?.close();
    G.mode = 'sp'; Net.info.clear();
    app.ui.mainMenu('mp');
  }
  function lostConnection() {
    Net.info.clear();
    app.ui.mainMenu('mp', 'CONNECTION LOST -- A PHONE THAT SLEEPS DROPS OUT. JOIN AGAIN?');
  }

  function setScores(list) {
    if (!Array.isArray(list)) return;
    Net.info = new Map(list.map(p => [p.id, p]));
  }

  function onNet(m) {
    switch (m.t) {
      case 'full': app.ui.setStatus(`THE ARENA IS FULL (${m.max} PILOTS) -- TRY AGAIN LATER`); break;
      case 'welcome':
        Net.id = m.id; Net.limit = m.limit || 10;
        setScores(m.scores);
        startArena(m.seed, m.pal);
        G.roundOver = !!m.over;
        break;
      case 'join': setScores(m.scores); msg(G, `${pilotName(m.id)} JOINED`); break;
      case 'leave': {
        msg(G, `${pilotName(m.id)} LEFT`);
        G.mechs = G.mechs.filter(x => x.netId !== m.id || x === G.player);
        if (G.target?.netId === m.id) G.target = null;
        setScores(m.scores);
        break;
      }
      case 's': netState(m); break;
      case 'note':
        // The server would not take our loadout (a version mismatch, or a fit
        // over its tonnage): fight in stock, as everyone else now sees us.
        if (m.k === 'lo') {
          const P = G.player, hp = { ...P.hp };
          applyLoadout(G, P, stockLoadout(P.type));
          for (const k of HPK) P.hp[k] = Math.min(hp[k], P.max[k]);
          Net.loSent = JSON.stringify(P.loadout);
          msg(G, 'LOADOUT REJECTED', '#f44');
        }
        break;
      case 'fx': netFx(m); break;
      case 'hit':
        if (!G.player.alive) break;
        // A fusion discharge isn't damage: it's the frame shaking apart.
        if (m.fu && G.player.spawnT <= 0 && !G.roundOver) { G.whiteFlash = 1; destroy(G, G.player, mechById(m.from) || null); }
        else {
          const melee = !!(m.me || m.st);
          if (melee) G.player.lastHitMelee = m.st ? 'stomp' : 'punch';
          damage(G, G.player, m.p, m.amt, mechById(m.from) || null, false, melee);
          if (m.zap && G.player.alive) scramble(G, G.player, WEAPONS.ppc.scramble, m.p);
          if (m.hh > 0 && G.player.alive) G.player.heat += Math.min(m.hh, 20);
          // A shove or a stomp: the push, the aim jolt and the lurch happen here, on the victim's screen.
          if (Array.isArray(m.kb) && G.player.alive && G.player.spawnT <= 0 && !G.roundOver) {
            const kb = [clamp30(m.kb[0]), clamp30(m.kb[1])], v = hypot(kb[0], kb[1]);
            if (v > 0.01) knock(G, { target: G.player, base: v, dir: [kb[0] / v, kb[1] / v], recoil: false });
            if (melee) { feel(G, 'punched', { mech: G.player, k: m.st ? 1.2 : 1 }); app.audio.sfx.punch(null, true); }
          }
        }
        break;
      case 'kill': {
        setScores(m.scores);
        const mine = m.killer === Net.id || m.victim === Net.id;
        msg(G, m.killer ? `${pilotName(m.killer)} ${m.me ? 'PUNCHED OUT' : 'DESTROYED'} ${pilotName(m.victim)}` : `${pilotName(m.victim)} WENT DOWN`, mine ? '#fc3' : '#7f7');
        if (m.killer === Net.id) { G.stats.kills++; voice(G, m.me ? 'killPunch' : 'kill'); }
        break;
      }
      case 'roundover':
        setScores(m.scores);
        G.roundOver = true;
        G.banner = { text: m.winner === Net.id ? 'YOU WIN THE ROUND' : `${m.name} WINS THE ROUND`, until: performance.now() + (m.next || 10) * 1000 };
        app.audio.say(m.winner === Net.id ? 'Round won.' : 'Round over.', true);
        break;
      case 'newround':
        setScores(m.scores);
        startArena(m.seed, m.pal);
        app.audio.say('New round.', true);
        break;
    }
  }

  function startArena(seed, palName) {
    G.mode = 'mp';
    const def = { name: 'Arena', foes: [] };
    resetMatch(G, { def, seed, pal: palName });
    placeScenery(G, def);
    app.scene.uploadWorld();
    G.banner = null;
    G.player = newMech(G, prefs.chassis, 0, 0, 0, 0, { partsKey: app.R.partsKeyFor(prefs.mpColor, prefs.chassis), loadout: fitOf(prefs.chassis) });
    G.player.netId = Net.id;
    G.mechs.push(G.player);
    respawn();
    app.ui.hideOverlay(); app.wrap.focus();
    G.state = 'play'; G.paused = false;
    app.input.syncTouchUI();
    if (G.touchUI && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
    }
    app.input.lockPointer();
    app.input.syncWeaponButtons();
  }

  // Somewhere on the map, as far as possible from everyone else.
  function spawnPoint() {
    let best = [0, 0], bestD = -1;
    for (let k = 0; k < 20; k++) {
      const a = random() * TAU, d = rnd(80, BOUND - 80), x = sin(a) * d, z = cos(a) * d;
      const near = min(1e9, ...G.mechs.filter(m => m.alive && m !== G.player).map(m => hypot(m.x - x, m.z - z)));
      if (near > bestD) { bestD = near; best = [x, z]; }
    }
    return best;
  }
  function respawn() {
    const P = G.player, [x, z] = spawnPoint();
    Object.assign(P, { x, z, y: G.ter.height(x, z), vy: 0, yaw: atan2(-x, -z), twist: 0, pitch: 0, speed: 0, throttle: 0,
      heat: 0, fuel: 1, shutdown: false, alive: true, air: false, hp: { ...P.max }, spawnT: 2 });
    P.weapons.forEach(w => { w.cd = 0; w.dead = false; w.ammo = w.def.ammo || null; });
    initFeet(G, P); P.lastYaw = P.yaw;
    G.respawnAt = 0; G.flash = 0; G.killer = 0;
    G.eye = eyeOf(P); G.view = dirOf(P.yaw, 0); G.aim = add(G.eye, mul(G.view, 100));
    sendState();
  }

  // The loadout rides the state message when it changes, and every LOADOUT_EVERY
  // messages (2 s) so a pilot who joins late learns it too.
  const LOADOUT_EVERY = 30;
  function sendState() {
    const lo = JSON.stringify(G.player.loadout || null), withLo = lo !== Net.loSent || ++Net.loN >= LOADOUT_EVERY;
    if (withLo) { Net.loSent = lo; Net.loN = 0; }
    netSend(stateMessage(G.player, beamMult(G.player), withLo));
  }

  function netState(s) {
    let r = G.mechs.find(m => m.netId === s.id);
    if (!r) {
      const ch = CHASSIS[s.ch] ? s.ch : 'kestrel';
      r = newMech(G, ch, s.id, s.x, s.z, s.yaw, { partsKey: app.R.partsKeyFor(Net.info.get(s.id)?.color ?? 0, ch) });
      Object.assign(r, { netId: s.id, remote: true, net: null });
      G.mechs.push(r);
    }
    const first = !r.net;
    r.net = { ...s, at: performance.now() };
    // Their mechlab fit: weapons drawn and fired as they carry them, armour to scale.
    if (s.lo) {
      const key = JSON.stringify(s.lo);
      if (key !== r.loKey) { r.loKey = key; applyLoadout(G, r, validate(r.type, s.lo).loadout); }
    }
    // Someone's resonance scan is on us: warn, with an alarm.
    if (s.sc === Net.id && s.sq > 0) {
      if (!G.scanWarn || performance.now() - G.scanWarn.at > 1000) app.audio.say('Warning. Resonance scan.', true);
      G.scanWarn = { by: s.id, p: s.sq, at: performance.now() };
      if (random() < 0.3) app.audio.sfx.beep();
    }
    if (Array.isArray(s.hp)) HPK.forEach((k, i) => {
      const v = +s.hp[i] || 0;
      if (r.alive && !first && r.hp[k] > 0 && v <= 0 && k !== 'T') { r.hp[k] = 0; shedSection(G, r, k, [r.x, r.y + 4, r.z]); }
      r.hp[k] = v;
    });
    if (first || (s.al && !r.alive)) {
      // Appeared or respawned: jump straight there.
      Object.assign(r, { x: s.x, y: s.y, z: s.z, yaw: s.yaw, twist: s.tw, pitch: s.p, alive: !!s.al });
      initFeet(G, r); r.lastYaw = r.yaw;
    } else if (!s.al && r.alive) {
      // Its own client says it's dead: the same beat, blast and topple as a local kill.
      beginDeath(G, r);
    }
  }

  const centroid = list => mul(list.reduce((a, s) => add(a, s.p), [0, 0, 0]), 1 / list.length);
  function netFx(f) {
    const src = mechById(f.id) || null;
    if (f.k === 'b') {
      const d = WEAPONS[f.w] || WEAPONS.laser;
      G.beams.push({ a: f.a, b: f.b, col: d.col, w: d.w, life: 0.14, max: 0.14 });
      for (let i = 0; i < 4; i++) particle(G, f.b, [rnd(-4, 4), rnd(1, 6), rnd(-4, 4)], 0.25, 0.35, d.col, 'fire');
      if (d.sfx) app.audio.sfx[d.sfx](f.a); else app.audio.sfx.laser(f.a, d.tons < 5);
    } else if (f.k === 's') {
      const d = WEAPONS[f.w]?.kind === 'shell' ? WEAPONS[f.w] : WEAPONS.ac;
      G.shots.push({ kind: 'shell', type: WEAPONS[f.w] ? f.w : 'ac', p: f.p, v: f.v, owner: src, dmg: 0, life: d.range / d.speed, ghost: true });
      app.audio.sfx[d.sfx || 'cannon'](f.p);
    } else if (f.k === 'm') {
      const d = WEAPONS[f.w]?.kind === 'missile' ? WEAPONS[f.w] : WEAPONS.lrm, target = f.tg ? mechById(f.tg) : null;
      for (let i = 0; i < d.count; i++) {
        const sp = d.spread ?? 0.08, spread = norm(add(f.d, [rnd(-sp, sp), rnd(0, d.lift ?? 0.12), rnd(-sp, sp)]));
        G.shots.push({ kind: 'missile', p: add(f.p, [rnd(-0.6, 0.6), rnd(-0.4, 0.4), rnd(-0.6, 0.6)]), v: mul(spread, d.speed * rnd(0.85, 1.1)),
          owner: src, dmg: 0, life: d.range / d.speed + 1, target, smoke: 0, age: 1, ghost: true, vid: f.v, from: f.id });
      }
      app.audio.sfx.missile(f.p);
    } else if (f.k === 'fu') {
      launchPulse(G, f.a, f.id2 ? mechById(f.id2) : null, src, true, f.b);
      app.audio.sfx.fusionCrack();
    } else if (f.k === 'pu') {
      // A swing starts: the wind-up shows now rather than at the next state report.
      if (src && src.alive && !src.melee) src.melee = { t: 0, phase: 'windup', hit: null };
    } else if (f.k === 'mg' || f.k === 'md') {
      // Another pilot is flying a volley (mg: where it is and where it's
      // heading) or has detonated it (md). Their client scores the damage.
      const ghosts = G.shots.filter(s => s.ghost && s.from === f.id && s.vid === f.v && s.life > 0);
      if (!ghosts.length) return;
      if (f.k === 'md') { for (const s of ghosts) { s.life = -1; explode(G, s.p, false); } return; }
      const shift = mul(sub(f.p, centroid(ghosts)), 0.5);
      for (const s of ghosts) { s.p = add(s.p, shift); s.v = mul(norm(f.d), len(s.v)); s.target = null; s.life = max(s.life, 2); }
    }
  }

  // Beam damage lands every frame; in the arena it's sent a few times a second.
  function flushHits() {
    for (const [to, q] of G.pendingHits) netSend(hit(to, q.amt, q.p, false, q));
    G.pendingHits.clear();
  }

  // The arena's per-frame housekeeping: respawn timer, spawn shield, state cadence.
  function netTick(dt) {
    if (!mp()) return;
    const P = G.player;
    if (P.spawnT > 0) P.spawnT -= dt;
    if (!P.alive && G.respawnAt && G.clock >= G.respawnAt) respawn();
    if ((Net.sendT += dt) >= 1 / SEND_HZ) { Net.sendT = 0; sendState(); flushHits(); }
  }
  const arenaBoard = () => [...Net.info.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  const boardHTML = () => `<table class="mech-keys scoreboard">${arenaBoard().map((p, i) => `<tr${p.id === Net.id ? ' class="me"' : ''}>
    <td>${i + 1}.</td><td><span class="dot" style="background:${MP_COLORS[p.color]?.css}"></span>${esc(p.name)}</td><td>${p.kills} / ${p.deaths}</td></tr>`).join('')}</table>`;


  return { Net, mp, join, send: netSend, leaveArena, lostConnection, setScores, onNet, startArena, spawnPoint, respawn, sendState, netState, netFx,
    flushHits, tick: netTick, pilotName, pilotCss, mechById, arenaBoard, boardHTML };
}
