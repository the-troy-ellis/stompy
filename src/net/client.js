import { $, esc } from '../util/dom.js';
import { store } from '../util/store.js';
import { add, dirOf, len, mul, norm, rnd, sub, TAU } from '../util/math.js';
import { WEAPONS } from '../data/weapons.js';
import { CHASSIS, HPK } from '../data/chassis.js';
import { MP_COLORS } from '../data/colors.js';
import { BOUND } from '../world/terrain.js';
import { newMech, resetMatch } from '../sim/state.js';
import { center, eyeOf } from '../sim/geom.js';
import { initFeet } from '../sim/gait.js';
import { msg, particle, explode } from '../sim/effects.js';
import { damage, destroy } from '../sim/combat.js';
import { beamMult } from '../sim/beams.js';
import { launchPulse } from '../sim/fusion.js';
import { SEND_HZ } from '../sim/missiles.js';
import { r2 } from './protocol.js';

const { sin, cos, atan2, min, max, random, hypot } = Math;

// The arena client: join, the message handler, spawn and respawn, the 15 Hz
// state send, and relayed effects. The server relays; this client is the
// authority for its own mech. See docs/architecture.md for the protocol.
export function createNet(app) {
  const G = app.G, prefs = app.prefs;
  const ov = app.ov;
  void ov; void esc; void $;

  // A free-for-all for up to eight pilots via server.py (port 8096). Each
  // client is the authority for its own mech: it sends its state ~15 times a
  // second, reports hits it lands, applies hits it takes, and declares its
  // own death. Other pilots are drawn from their latest state, smoothed and
  // extrapolated, and walk with the same gait. Their shots arrive as effects
  // ("ghosts") that look real but never score -- their shooter scores them.
  const NET_PORT = 8096;
  const Net = { ws: null, id: 0, info: new Map(), sendT: 0, limit: 10 };
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
    try { ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:${NET_PORT}/ws`); }
    catch { app.ui.setStatus('COULD NOT CONNECT'); return; }
    Net.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name: prefs.mpName, color: prefs.mpColor }));
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
      case 'fx': netFx(m); break;
      case 'hit':
        if (!G.player.alive) break;
        // A fusion discharge isn't damage: it's the frame shaking apart.
        if (m.fu && G.player.spawnT <= 0 && !G.roundOver) { G.whiteFlash = 1; destroy(G, G.player, mechById(m.from) || null); }
        else damage(G, G.player, m.p, m.amt, mechById(m.from) || null);
        break;
      case 'kill': {
        setScores(m.scores);
        const mine = m.killer === Net.id || m.victim === Net.id;
        msg(G, m.killer ? `${pilotName(m.killer)} DESTROYED ${pilotName(m.victim)}` : `${pilotName(m.victim)} WENT DOWN`, mine ? '#fc3' : '#7f7');
        if (m.killer === Net.id) { G.stats.kills++; app.audio.say('Target destroyed.', true); }
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
    resetMatch(G, { def: { name: 'Arena', foes: [] }, seed, pal: palName });
    app.scene.uploadWorld();
    G.banner = null;
    G.player = newMech(G, prefs.chassis, 0, 0, 0, 0, { partsKey: app.R.partsKeyFor(prefs.mpColor, prefs.chassis) });
    G.player.netId = Net.id;
    G.mechs.push(G.player);
    respawn();
    app.ui.app.ui.hideOverlay(); app.wrap.focus();
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

  function sendState() {
    const P = G.player;
    netSend({ t: 's', ch: P.type, x: r2(P.x), y: r2(P.y), z: r2(P.z), yaw: r2(P.yaw), tw: r2(P.twist), p: r2(P.pitch), sp: r2(P.speed),
      air: P.air ? 1 : 0, al: P.alive ? 1 : 0, sd: P.shutdown ? 1 : 0, hp: HPK.map(k => r2(P.hp[k])),
      bm: P.beaming ? 1 : 0, be: P.beaming && P.beamEnd ? P.beamEnd.map(r2) : 0, bf: r2(beamMult(P)),
      fl: P.fusion?.on && P.fusion.end ? P.fusion.end.map(r2) : 0, sc: P.fusion?.mech?.netId || 0,
      // eslint-disable-next-line no-dupe-keys -- the duplicate `sp` is the known wire bug fixed with the protocol move (M0 stage 5)
      sp: P.fusion?.mech ? r2(min(1, P.fusion.t / WEAPONS.fusion.scan)) : 0 });
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
    // Someone's resonance scan is on us: warn, with an alarm.
    if (s.sc === Net.id && s.sp > 0) {
      if (!G.scanWarn || performance.now() - G.scanWarn.at > 1000) app.audio.say('Warning. Resonance scan.', true);
      G.scanWarn = { by: s.id, p: s.sp, at: performance.now() };
      if (random() < 0.3) app.audio.sfx.beep();
    }
    if (Array.isArray(s.hp)) HPK.forEach((k, i) => { r.hp[k] = +s.hp[i] || 0; });
    if (first || (s.al && !r.alive)) {
      // Appeared or respawned: jump straight there.
      Object.assign(r, { x: s.x, y: s.y, z: s.z, yaw: s.yaw, twist: s.tw, pitch: s.p, alive: !!s.al });
      initFeet(G, r); r.lastYaw = r.yaw;
    } else if (!s.al && r.alive) {
      // Its own client says it's dead: show the kill.
      r.alive = false;
      explode(G, center(r), true);
      explode(G, add(center(r), [rnd(-3, 3), 2, rnd(-3, 3)]), false);
      G.wrecks.push({ x: r.x, y: r.y, z: r.z, yaw: r.yaw, type: r.partsKey, scale: r.ch.scale, t: 0, roll: rnd(-0.6, 0.6) });
      if (G.target === r) G.target = null;
    }
  }

  const centroid = list => mul(list.reduce((a, s) => add(a, s.p), [0, 0, 0]), 1 / list.length);
  function netFx(f) {
    const src = mechById(f.id) || null;
    if (f.k === 'b') {
      const d = WEAPONS[f.w] || WEAPONS.laser;
      G.beams.push({ a: f.a, b: f.b, col: d.col, w: d.w, life: 0.14, max: 0.14 });
      for (let i = 0; i < 4; i++) particle(G, f.b, [rnd(-4, 4), rnd(1, 6), rnd(-4, 4)], 0.25, 0.35, d.col, 'fire');
      app.audio.sfx.laser(f.a, d === WEAPONS.mlaser);
    } else if (f.k === 's') {
      G.shots.push({ kind: 'shell', p: f.p, v: f.v, owner: src, dmg: 0, life: WEAPONS.ac.range / WEAPONS.ac.speed, ghost: true });
      app.audio.sfx.cannon(f.p);
    } else if (f.k === 'm') {
      const d = WEAPONS.lrm, target = f.tg ? mechById(f.tg) : null;
      for (let i = 0; i < d.count; i++) {
        const spread = norm(add(f.d, [rnd(-0.08, 0.08), rnd(0, 0.12), rnd(-0.08, 0.08)]));
        G.shots.push({ kind: 'missile', p: add(f.p, [rnd(-0.6, 0.6), rnd(-0.4, 0.4), rnd(-0.6, 0.6)]), v: mul(spread, d.speed * rnd(0.85, 1.1)),
          owner: src, dmg: 0, life: d.range / d.speed + 1, target, smoke: 0, age: 1, ghost: true, vid: f.v, from: f.id });
      }
      app.audio.sfx.missile(f.p);
    } else if (f.k === 'fu') {
      launchPulse(G, f.a, f.id2 ? mechById(f.id2) : null, src, true, f.b);
      app.audio.sfx.fusionCrack();
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
    for (const [to, q] of G.pendingHits) netSend({ t: 'hit', to, amt: r2(q.amt), p: q.p.map(r2) });
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
  const arenaBoard = () => [...app.net.Net.info.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  const boardHTML = () => `<table class="mech-keys scoreboard">${arenaBoard().map((p, i) => `<tr${p.id === app.net.Net.id ? ' class="me"' : ''}>
    <td>${i + 1}.</td><td><span class="dot" style="background:${MP_COLORS[p.color]?.css}"></span>${esc(p.name)}</td><td>${p.kills} / ${p.deaths}</td></tr>`).join('')}</table>`;


  return { Net, mp, join, send: netSend, leaveArena, lostConnection, setScores, onNet, startArena, spawnPoint, respawn, sendState, netState, netFx,
    flushHits, tick: netTick, pilotName, pilotCss, mechById, arenaBoard, boardHTML };
}
