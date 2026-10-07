import { $, esc } from '../util/dom.js';
import { store } from '../util/store.js';
import { add, dirOf, len, mul, norm, rnd, sub } from '../util/math.js';
import { WEAPONS } from '../data/weapons.js';
import { CHASSIS, HPK } from '../data/chassis.js';
import { MP_COLORS } from '../data/colors.js';
import { newMech, resetMatch, startMatch } from '../sim/state.js';
import { placeScenery } from '../sim/entities.js';
import { eyeOf } from '../sim/geom.js';
import { initFeet } from '../sim/gait.js';
import { msg, particle, explode } from '../sim/effects.js';
import { damage, destroy, scramble } from '../sim/combat.js';
import { knock } from '../sim/knock.js';
import { feel } from '../sim/feel.js';
import { voice } from '../sim/voice.js';
import { beamMult } from '../sim/beams.js';
import { launchPulse } from '../sim/fusion.js';
import { SEND_HZ } from '../sim/missiles.js';
import { hit, hello, ping as pingMsg, ready as readyMsg, team as teamMsg, vote as voteMsg, roundStats, stateMessage, PING_EVERY } from './protocol.js';
import { coopNote, lobbyHTML, lobbyHead, lobbyRows } from '../ui/lobby.js';
import { summaryHTML, summaryRows, voteCount, voteOf } from '../ui/summary.js';
import { fitOf } from '../ui/mechlab.js';
import { applyLoadout, stockLoadout } from '../sim/loadout.js';
import { startSpectate } from './spectate.js';
import { addKill } from './killfeed.js';
import { applyRemote } from './remote.js';
import { applyEHit, becomeHost, enemyByEid, flushEHits, guestApply, hostTick, startCoop } from './coop.js';
import { missionDef } from '../data/missions.js';
import { DIFF } from '../data/ai.js';
import { coopDef } from '../sim/coopRules.js';
import { sideOf, spawnPoint, teamName } from './teams.js';

const { atan2, min, max, random, hypot } = Math;
const clamp30 = v => max(-30, min(30, +v || 0));

// The arena client: join, the message handler, spawn and respawn, the 15 Hz
// state send, and relayed effects. The server relays; this client is the
// authority for its own mech. See docs/architecture.md for the protocol.
export function createNet(app) {
  const G = app.G, prefs = app.prefs;
  const ov = app.ov;
  void ov; void esc; void $;

  // A free-for-all or team deathmatch for up to eight pilots via server.py (net/relay.js finds it). Each
  // client is the authority for its own mech: it sends its state ~15 times a
  // second, reports hits it lands, applies hits it takes, and declares its
  // own death. Other pilots are drawn from their latest state, smoothed and
  // extrapolated, and walk with the same gait. Their shots arrive as effects
  // ("ghosts") that look real but never score -- their shooter scores them.
  const Net = { ws: null, id: 0, info: new Map(), sendT: 0, limit: 10, loSent: '', loN: 0, mode: 'ffa', pal: 'dusk', pingT: 0, pingN: 0, pingAt: new Map(), rtt: 0, feed: [], teams: [0, 0], votes: [0, 0, 0], myVote: -1, token: null, tries: 0, retryTimer: 0, seed: 0,
    kind: 'arena', room: '', host: 0, def: null, joinOpts: {}, readied: false };   // kind 'coop': a co-op room (net/coop.js), its code, host, mission
  const mp = () => G.mode === 'mp';   // the arena
  const online = () => G.mode === 'mp' || G.mode === 'coop';   // the arena or a co-op room
  const pilotName = id => Net.info.get(id)?.name || `PILOT ${id}`;
  const pilotCss = id => MP_COLORS[Net.info.get(id)?.color ?? 0]?.css || '#f44';
  const mechById = id => (id === Net.id ? G.player : G.mechs.find(m => m.netId === id));
  // Team deathmatch: your side (0 STEEL, 1 RED), and whether a pilot is on it.
  const tdm = () => Net.mode === 'tdm';
  const myTeam = () => Net.info.get(Net.id)?.team || 0;
  const mate = id => Net.kind === 'coop' || (tdm() && (Net.info.get(id)?.team || 0) === myTeam());   // co-op: everyone
  const colorOf = id => Net.info.get(id)?.color ?? (id === Net.id ? prefs.mpColor : 0);

  

  // `opts`: { room } to join a co-op room by its code, { create } to open one; the arena otherwise.
  function join(opts = {}) {
    if (Net.ws) return;
    Net.joinOpts = opts;   // the token stays: JOIN after a drop brings the pilot back (the relay checks it against the room)
    prefs.mpName = ($('.callsign', ov)?.value || '').trim().toUpperCase().slice(0, 12);
    store.set('mp.name', prefs.mpName); store.set('mp.color', prefs.mpColor);
    app.audio.Sound.unlock(); app.audio.loadSamples();
    app.ui.setStatus('CONNECTING...');
    connect(false);
  }
  // A socket to the relay. The hello carries the token from the last welcome
  // (memory only), so a pilot who dropped comes back to the same id and score
  // within the relay's 30 s. `retry`: one of the RECONNECTING tries.
  function connect(retry) {
    let ws, welcomed = false;
    try { ws = new WebSocket(app.relay().url); }   // net/relay.js: ?relay=, the RELAY field, or this page's host
    catch { if (retry) reconnect(); else app.ui.setStatus('COULD NOT CONNECT'); return; }
    Net.ws = ws;
    // Back after a drop: the room we were in, by its code; a first join: what the menu asked for.
    const where = retry && Net.room && Net.kind === 'coop' ? { room: Net.room } : Net.joinOpts;
    ws.onopen = () => ws.send(JSON.stringify(hello(prefs.mpName, prefs.mpColor, prefs.chassis, Net.token, where)));
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'welcome') welcomed = true;
      onNet(m);
    };
    ws.onclose = () => {
      if (Net.ws !== ws) return;   // we closed it on purpose
      Net.ws = null;
      if (G.reconnecting || (welcomed && online())) reconnect();   // dropped mid-match, or a try that didn't take
      else if (!welcomed && G.state === 'menu' && !/FULL|UPDATE|NO ROOM/.test($('.status', ov)?.textContent || '')) app.ui.setStatus('THE ARENA SERVER IS NOT ANSWERING');
    };
  }
  // Dropped mid-match: RECONNECTING, RETRIES tries RETRY_GAP ms apart, the
  // match going on meanwhile. Then the menu; JOIN within the relay's 30 s
  // still brings the score back.
  const RETRIES = 3, RETRY_GAP = 2000;
  function reconnect() {
    if (Net.tries >= RETRIES) { lostConnection(); return; }
    Net.tries++;
    G.reconnecting = true;
    Net.retryTimer = setTimeout(() => { Net.retryTimer = 0; if (G.reconnecting && online()) connect(true); }, RETRY_GAP);
  }
  function stopRetrying() { clearTimeout(Net.retryTimer); Net.retryTimer = 0; Net.tries = 0; G.reconnecting = false; }
  function netSend(obj) { if (Net.ws && Net.ws.readyState === 1) Net.ws.send(JSON.stringify(obj)); }
  function leaveArena() {
    const ws = Net.ws; Net.ws = null; ws?.close();
    stopRetrying(); Net.token = null;   // left on purpose: nothing to come back to
    G.mode = 'sp'; G.role = 'solo'; G.lobby = false; G.summary = false; Net.info.clear(); Net.pingAt.clear(); Net.kind = 'arena'; Net.room = '';
    app.ui.mainMenu('mp');
  }
  function lostConnection() {
    const ws = Net.ws; Net.ws = null; ws?.close();
    stopRetrying();
    Net.info.clear(); G.lobby = false; G.summary = false; G.role = 'solo'; Net.pingAt.clear();
    const coop = Net.kind === 'coop';
    if (coop) Net.joinOpts = { room: Net.room };   // JOIN goes back to the same room
    app.ui.mainMenu('mp', coop ? `CONNECTION LOST. JOIN ROOM ${Net.room} AGAIN WITHIN 30 S.` : 'CONNECTION LOST. JOIN WITHIN 30 S TO KEEP YOUR SCORE.');
  }

  function setScores(list) {
    if (!Array.isArray(list)) return;
    Net.info = new Map(list.map(p => [p.id, p]));
    syncTeams();
    showLobby(); showSummary();
  }
  // Sides and colours as the relay last said. A teammate is team 0, as you
  // are: never a hostile to target, lock or hit. Everyone else is their own id.
  function syncTeams() {
    for (const m of G.mechs) {
      if (!m.netId) continue;
      if (m.remote) { m.mate = mate(m.netId); m.team = m.mate ? 0 : m.netId; }
      const key = app.R.partsKeyFor(colorOf(m.netId), m.type);
      if (m.partsKey !== key) m.partsKey = key;   // a team's colour is forced
    }
  }
  // The lobby (ui/lobby.js): shown from `welcome` until READY, redrawn as
  // pilots come, ready up and report their pings.
  function showLobby() {
    if (!G.lobby) return;
    const coop = Net.kind === 'coop';
    const o = { pilots: [...Net.info.values()].sort((a, b) => a.id - b.id), me: Net.id, mode: coop ? 'coop' : Net.mode, pal: Net.pal, limit: Net.limit,
      coop: coop ? { room: Net.room, mission: Net.def?.mission | 0, diff: Net.def?.diff, host: Net.host, readied: Net.readied } : null };
    const table = app.ov.hidden ? null : app.ov.querySelector('table.lobby'), head = app.ov.querySelector('.lobby-head');
    const panel = app.ov.querySelector('.panel[data-mode]');
    if (table && head && panel?.dataset.mode === o.mode) {   // in place: READY stays put under a thumb
      table.innerHTML = lobbyRows(o); head.innerHTML = lobbyHead(o);
      for (const b of app.ov.querySelectorAll('[data-team]')) b.classList.toggle('on', +b.dataset.team === myTeam());
      const note = app.ov.querySelector('.lobby-note');
      if (note && o.coop) note.textContent = coopNote(o);
    } else app.ui.showOverlay(lobbyHTML(o));
  }
  // The round's end (ui/summary.js): the summary and the vote, over the arena
  // until `newround`. Opened by `roundover`, then updated in place as votes
  // and accuracies come in.
  function showSummary(title) {
    if (!G.summary) return;
    const o = { pilots: [...Net.info.values()], me: Net.id, mode: Net.mode, votes: Net.votes, mine: Net.myVote, title, next: Net.next };
    const table = app.ov.hidden ? null : app.ov.querySelector('table.summary');
    if (table && !title) {
      table.innerHTML = summaryRows(o);
      app.ov.querySelectorAll('[data-v]').forEach(b => {
        const i = +b.dataset.v;
        b.classList.toggle('on', i === Net.myVote);
        const n = b.querySelector('.n');
        if (n) n.textContent = voteCount(Net.votes[i]);
      });
    } else if (title) app.ui.showOverlay(summaryHTML(o));
  }
  function castVote(i) {
    if (!G.summary || !(i >= 0 && i <= 2)) return;
    Net.myVote = i;
    const v = voteOf(i, Net.mode);
    netSend(voteMsg(v.map, v.mode));
    showSummary();
  }
  // Team deathmatch: ask for a side from the lobby; the relay's answer moves you.
  function pickTeam(t) { if (G.lobby && tdm() && (t === 0 || t === 1)) netSend(teamMsg(t)); }
  function ready() {
    if (!G.lobby) return;
    if (Net.kind === 'coop') {
      // Co-op: READY says so; the host's starts the mission for everyone (`ready` with `started`).
      if (!Net.readied) { Net.readied = true; netSend(readyMsg()); showLobby(); }
      return;
    }
    G.lobby = false;
    netSend(readyMsg());
    respawn();
    app.ui.hideOverlay(); app.wrap.focus();
    app.input.syncTouchUI(); app.input.lockPointer();
  }

  function onNet(m) {
    switch (m.t) {
      case 'full': app.ui.setStatus(`THE ARENA IS FULL (${m.max} PILOTS) -- TRY AGAIN LATER`); break;
      case 'version': app.ui.setStatus(`UPDATE THE GAME TO PLAY (v${m.need})`); break;   // the server runs another version
      case 'noroom': app.ui.setStatus('NO ROOM WITH THAT CODE'); break;   // co-op: a code nobody has open
      case 'welcome': {
        if (m.kind === 'coop') { coopWelcome(m); break; }
        Net.kind = 'arena';
        // Back after a drop on the same map: carry on where we are. Back on
        // another (a new round began): that world, straight in. Otherwise the lobby.
        const back = !!m.resumed, inPlace = back && G.reconnecting && mp() && m.seed === Net.seed && m.pal === Net.pal;
        stopRetrying();
        Net.id = m.id; Net.limit = m.limit || 10; Net.mode = m.mode === 'tdm' ? 'tdm' : 'ffa'; Net.pal = m.pal; setTeams(m.teams);
        Net.token = typeof m.token === 'string' ? m.token : null;
        setScores(m.scores);
        if (inPlace) { G.player.netId = Net.id; sendState(); msg(G, 'RECONNECTED'); }
        else startArena(m.seed, m.pal, !(back && m.scores?.find(p => p.id === m.id)?.ready));   // into the lobby: READY spawns you
        G.roundOver = !!m.over;
        break;
      }
      case 'ready':
        setScores(m.scores);
        if (Net.kind === 'coop' && m.started && G.lobby) startCoopMission();   // the host is ready: go
        break;
      case 'team': setScores(m.scores); break;   // a pilot in the lobby changed sides
      case 'tally':   // between rounds: the votes so far and the accuracies reported
        if (Array.isArray(m.votes) && m.votes.length === 3) Net.votes = m.votes.map(n => +n || 0);
        setScores(m.scores);
        break;
      case 'ping': {
        // The round trip to the relay, and every pilot's last one for the lobby.
        const sent = Net.pingAt.get(m.n);
        if (sent != null) { Net.rtt = Math.round(performance.now() - sent); Net.pingAt.delete(m.n); }
        if (m.pings && typeof m.pings === 'object') for (const [id, ms] of Object.entries(m.pings)) { const p = Net.info.get(+id); if (p) p.ping = ms; }
        const me = Net.info.get(Net.id);
        if (me) me.ping = Net.rtt;
        showLobby();
        break;
      }
      case 'join': setScores(m.scores); msg(G, `${pilotName(m.id)} JOINED`); break;
      case 'leave': {
        msg(G, `${pilotName(m.id)} LEFT`);
        G.mechs = G.mechs.filter(x => x.netId !== m.id || x === G.player);
        if (G.target?.netId === m.id) G.target = null;
        setScores(m.scores);
        break;
      }
      case 's': netState(m); break;
      // Co-op (net/coop.js): the host's enemies reach a guest; a guest's hits on them reach the host.
      case 'es': case 'ent': case 'entx': case 'obj': case 'over': if (G.role === 'guest') guestApply(G, m, performance.now()); break;
      case 'host':   // the co-op host left: the relay picked the next one
        setScores(m.scores);
        Net.host = m.id;
        if (m.id === Net.id && G.role === 'guest') becomeHost(G);
        showLobby();
        msg(G, `${pilotName(m.id)} IS NOW HOST`);
        break;
      case 'ehit': if (G.role === 'host') applyEHit(G, m, mechById(m.from) || null); break;
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
        setTeams(m.teams); setScores(m.scores);
        addKill(Net.feed, { killer: m.killer || 0, victim: m.victim, me: !!m.me, at: performance.now() });   // top right, in their colours (net/killfeed.js)
        if (m.killer === Net.id) { G.stats.kills++; voice(G, m.me ? 'killPunch' : 'kill'); }
        break;
      }
      case 'roundover': {
        setTeams(m.teams); setScores(m.scores);
        G.roundOver = true;
        // Team deathmatch: the side wins; free-for-all: the pilot.
        const team = tdm() && (m.team === 0 || m.team === 1), won = team ? m.team === myTeam() : m.winner === Net.id;
        G.banner = { text: team ? (won ? 'YOUR TEAM WINS THE ROUND' : `${teamName(m.team)} WINS THE ROUND`) : won ? 'YOU WIN THE ROUND' : `${m.name} WINS THE ROUND`,
          until: performance.now() + (m.next || 10) * 1000 };
        app.audio.say(won ? 'Round won.' : 'Round over.', true);
        if (!G.lobby) {
          // The summary and the vote; our accuracy goes up for everyone's table.
          const s = G.stats;
          netSend(roundStats(s.shots ? (100 * s.hits) / s.shots : 0));
          Object.assign(Net, { votes: [0, 0, 0], myVote: -1, next: m.next || 10 });
          G.summary = true; G.paused = false;
          app.input.clearHeld(); app.input.exitLock(); app.input.syncTouchUI();
          showSummary(G.banner.text);
        }
        break;
      }
      case 'newround':
        G.summary = false;   // startArena closes it
        Net.pal = m.pal; Net.mode = m.mode === 'tdm' || m.mode === 'ffa' ? m.mode : Net.mode; Net.limit = m.limit || Net.limit; setTeams(m.teams);
        setScores(m.scores);
        startArena(m.seed, m.pal, G.lobby);   // still in the lobby: stay there
        app.audio.say('New round.', true);
        break;
    }
  }

  // Co-op (docs/specs/09-coop.md): the room's welcome. Back after a drop in
  // the middle of the mission: carry on in place. A mission already under
  // way: straight in, as a guest. Otherwise the lobby, until the host's READY.
  function coopWelcome(m) {
    const back = !!m.resumed && G.reconnecting && G.mode === 'coop' && G.role !== 'solo';
    stopRetrying();
    Object.assign(Net, { id: m.id, kind: 'coop', room: m.room, host: m.host, def: m.def || { mission: 0, diff: 'normal', seed: 7 }, mode: 'coop' });
    Net.token = typeof m.token === 'string' ? m.token : null;
    setScores(m.scores);
    if (back) { G.player.netId = Net.id; sendState(); msg(G, 'RECONNECTED'); return; }
    if (m.started) { startCoopMission(); return; }
    G.mode = 'coop'; G.lobby = true; Net.readied = false;
    app.input.exitLock();
    showLobby();
  }
  // The mission, on every screen at once: the same seed and mission for all;
  // the host builds it for the pilots in the room (more enemies, sim/coopRules.js)
  // and runs it, the guests draw it (net/coop.js).
  function startCoopMission() {
    const n = Net.def.mission | 0, def = missionDef(n), host = Net.host === Net.id, pilots = Math.max(1, Net.info.size);
    prefs.mission = n; G.diff = DIFF[Net.def.diff] ? Net.def.diff : 'normal';
    startMatch(G, host ? coopDef(def, pilots) : def, Net.def.seed ?? def.seed ?? 7 + n * 13, n === 0, prefs.chassis,
      { loadout: fitOf(prefs.chassis), partsKey: app.R.partsKeyFor(colorOf(Net.id), prefs.chassis) });
    Object.assign(G, { kind: 'campaign', mode: 'coop', lobby: false, coopKills: {} });
    G.player.netId = Net.id;
    startCoop(G, host ? 'host' : 'guest', pilots);
    app.scene.uploadWorld();
    app.ui.launch();
    sendState();
  }

  // Each side's kills this round (team deathmatch), as the relay counts them.
  function setTeams(t) { if (Array.isArray(t) && t.length === 2) Net.teams = [+t[0] || 0, +t[1] || 0]; }

  // A round's world. `lobby`: the pilot waits in the lobby (not spawned, not
  // sending state) until READY; otherwise straight in, as at a new round.
  function startArena(seed, palName, lobby = false) {
    G.mode = 'mp'; G.spectate = null; Net.feed.length = 0; Net.seed = seed;
    const def = { name: 'Arena', foes: [] };
    resetMatch(G, { def, seed, pal: palName });
    placeScenery(G, def);
    app.scene.uploadWorld();
    G.banner = null;
    G.player = newMech(G, prefs.chassis, 0, 0, 0, 0, { partsKey: app.R.partsKeyFor(colorOf(Net.id), prefs.chassis), loadout: fitOf(prefs.chassis) });
    G.player.netId = Net.id;
    G.mechs.push(G.player);
    respawn();
    G.lobby = lobby;
    if (lobby) { G.player.alive = false; showLobby(); } else { app.ui.hideOverlay(); app.wrap.focus(); }
    G.state = 'play'; G.paused = false;
    app.input.syncTouchUI();
    if (G.touchUI && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
    }
    if (!lobby) app.input.lockPointer();   // the lobby needs the cursor for READY
    app.input.syncWeaponButtons();
  }

  function respawn() {
    // Far from the hostiles; in team deathmatch, on your side's half (net/teams.js).
    const P = G.player, [x, z] = spawnPoint(G, sideOf(Net.mode, myTeam()));
    Object.assign(P, { x, z, y: G.ter.height(x, z), vy: 0, yaw: atan2(-x, -z), twist: 0, pitch: 0, speed: 0, throttle: 0,
      heat: 0, fuel: 1, shutdown: false, alive: true, air: false, hp: { ...P.max }, spawnT: 2 });
    P.weapons.forEach(w => { w.cd = 0; w.dead = false; w.ammo = w.def.ammo || null; });
    initFeet(G, P); P.lastYaw = P.yaw;
    G.respawnAt = 0; G.flash = 0; G.killer = 0; G.spectate = null;   // back in the cockpit
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
      r = newMech(G, ch, mate(s.id) ? 0 : s.id, s.x, s.z, s.yaw, { partsKey: app.R.partsKeyFor(colorOf(s.id), ch) });
      Object.assign(r, { netId: s.id, remote: true, net: null, mate: mate(s.id) });
      G.mechs.push(r);
    }
    applyRemote(G, r, s, performance.now());   // pose, fit, armour, life (net/remote.js)
    // Someone's resonance scan is on us: warn, with an alarm.
    if (s.sc === Net.id && s.sq > 0) {
      if (!G.scanWarn || performance.now() - G.scanWarn.at > 1000) app.audio.say('Warning. Resonance scan.', true);
      G.scanWarn = { by: s.id, p: s.sq, at: performance.now() };
      if (random() < 0.3) app.audio.sfx.beep();
    }
  }

  const centroid = list => mul(list.reduce((a, s) => add(a, s.p), [0, 0, 0]), 1 / list.length);
  function netFx(f) {
    const src = (f.eid ? enemyByEid(G, f.eid) : mechById(f.id)) || null;   // a co-op enemy's fire comes from the host with its eid
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
      const d = WEAPONS[f.w]?.kind === 'missile' ? WEAPONS[f.w] : WEAPONS.lrm, target = f.te ? enemyByEid(G, f.te) : f.tg ? mechById(f.tg) : null;
      for (let i = 0; i < d.count; i++) {
        const sp = d.spread ?? 0.08, spread = norm(add(f.d, [rnd(-sp, sp), rnd(0, d.lift ?? 0.12), rnd(-sp, sp)]));
        G.shots.push({ kind: 'missile', p: add(f.p, [rnd(-0.6, 0.6), rnd(-0.4, 0.4), rnd(-0.6, 0.6)]), v: mul(spread, d.speed * rnd(0.85, 1.1)),
          owner: src, dmg: 0, life: d.range / d.speed + 1, target, smoke: 0, age: 1, ghost: true, vid: f.v, from: f.id });
      }
      app.audio.sfx.missile(f.p);
    } else if (f.k === 'fu') {
      launchPulse(G, f.a, f.e2 ? enemyByEid(G, f.e2) : f.id2 ? mechById(f.id2) : null, src, true, f.b);
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
    for (const [to, q] of G.pendingHits) if (!mate(to)) netSend(hit(to, q.amt, q.p, false, q));   // friendly fire is off (the relay drops it too)
    G.pendingHits.clear();
  }

  // The arena's per-frame housekeeping: respawn timer, spawn shield, state cadence.
  function netTick(dt) {
    if (!online()) return;
    if (G.lobby && Net.kind === 'coop') {   // the co-op lobby: no mech out yet, only the ping
      if (G.clock - Net.pingT >= PING_EVERY) { Net.pingT = G.clock; Net.pingAt.set(++Net.pingN, performance.now()); netSend(pingMsg(Net.pingN, Net.rtt)); }
      return;
    }
    const P = G.player;
    if (P.spawnT > 0) P.spawnT -= dt;
    if (!P.alive && G.respawnAt && G.clock >= G.respawnAt) respawn();
    // Down and done toppling: watch another pilot until the respawn (net/spectate.js).
    else if (!P.alive && !P.dying && (G.respawnAt || G.coopRespawn) && !G.spectate) startSpectate(G, G.killer);
    else if (P.alive && G.spectate) G.spectate = null;   // co-op: back up (sim/coopRules.js)
    if ((Net.sendT += dt) >= 1 / SEND_HZ && !G.lobby) { Net.sendT = 0; sendState(); flushHits(); if (G.role === 'guest') flushEHits(G, netSend); }   // in the lobby, nobody sees you yet
    if (G.role === 'host' && !G.lobby) hostTick(G, dt, netSend);   // co-op: the enemies, ES_HZ times a second
    if (G.summary && G.banner) {   // the summary's countdown, written when the second changes
      const n = Math.max(0, Math.ceil((G.banner.until - performance.now()) / 1000));
      if (n !== Net.next) { Net.next = n; const el = app.ov.querySelector('.next-in'); if (el) el.textContent = n; }
    }
    if (G.clock - Net.pingT >= PING_EVERY) { Net.pingT = G.clock; Net.pingAt.set(++Net.pingN, performance.now()); netSend(pingMsg(Net.pingN, Net.rtt)); }
  }
  const arenaBoard = () => [...Net.info.values()].sort((a, b) => (tdm() ? (a.team || 0) - (b.team || 0) : 0) || b.kills - a.kills || a.deaths - b.deaths);
  const boardHTML = () => `<table class="mech-keys scoreboard">${arenaBoard().map((p, i) => `<tr${p.id === Net.id ? ' class="me"' : ''}>
    <td>${i + 1}.</td><td><span class="dot" style="background:${MP_COLORS[p.color]?.css}"></span>${esc(p.name)}</td><td>${p.kills} / ${p.deaths}</td></tr>`).join('')}</table>`;


  return { Net, mp, join, send: netSend, leaveArena, lostConnection, setScores, onNet, startArena, respawn, sendState, netState, netFx,
    flushHits, tick: netTick, ready, pickTeam, vote: castVote, tdm, myTeam, mate, pilotName, pilotCss, mechById, arenaBoard, boardHTML };
}
