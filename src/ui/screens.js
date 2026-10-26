import { $, esc } from '../util/dom.js';
import { store } from '../util/store.js';
import { clampN } from '../util/math.js';
import { normalRelay } from '../net/relay.js';
import { CATS, CAT_OF } from '../data/weapons.js';
import { CHASSIS, MECH_ORDER, MECH_INFO, PILOTABLE } from '../data/chassis.js';
import { NAMES } from '../data/names.js';
import { PALS, palAt } from '../data/palettes.js';
import { missionDef, missionFoes, BASE_MISSION, FP_MAPS, FP_MIXES, FP_WEATHER, FP_TIMES, fpWeather, pickFoes } from '../data/missions.js';
import { MP_COLORS } from '../data/colors.js';
import { MODE_NAMES } from './lobby.js';
import { makeGround } from '../world/voxels.js';
import { newMech, startMatch, foeType } from '../sim/state.js';
import { initFeet } from '../sim/gait.js';
import { endGuide } from '../sim/missiles.js';
import { DIFF, DIFF_ORDER } from '../data/ai.js';
import { SETTINGS, SETTING_KEYS, SETTING_GROUPS, stepSetting } from '../data/settings.js';
import { fitOf, fitOk as fitUnder, kitLine } from './mechlab.js';
import { cheat } from '../sim/cheats.js';
import { objectiveRows, debriefTitle, missionTitle, missionSpoken, verdict } from './debrief.js';
import { createDebugMenu } from './debugMenu.js';
import { VERSION } from '../util/version.js';
import { recordResult, saveCampaign, restartCampaign, stripSquares, canPlay } from './campaign.js';
import { VOICE } from '../data/voice.js';
import { newTutorial } from '../sim/tutorial.js';

const { sin, max, random, floor } = Math;

// The overlay screens: the main menu with its live mech, the briefing
// detail, settings, pause, debrief, and the click routing for all of them.
export function createUi(app) {
  const G = app.G, prefs = app.prefs, ov = app.ov, wrap = app.wrap;
  void CATS; void CAT_OF; void clampN;
  function startMission(n) {
    prefs.mission = n;
    G.diff = prefs.diff;
    const def = missionDef(n);
    startMatch(G, def, def.seed ?? 7 + n * 13, n === 0, prefs.chassis, { loadout: fitOf(prefs.chassis) });
    G.kind = 'campaign';
    if (n === 0 && G.mode !== 'coop' && !store.get('tut.done', false)) G.tut = newTutorial(G);   // the first mission 1 teaches the controls, once
    app.scene.uploadWorld();
  }
  // Free play: a one-off battle on the chosen map with the chosen number of hostiles.
  function startSkirmish() {
    if (FP_MAPS[prefs.fpMap] === 'base') { startBase(); return; }
    const pk = FP_MAPS[prefs.fpMap] === 'random' ? ['dusk', 'ice', 'volcanic'][floor(random() * 3)] : FP_MAPS[prefs.fpMap];
    const foes = pickFoes(FP_MIXES[prefs.fpMix] || FP_MIXES[0], prefs.fpFoes, random, k => !locked(k));
    G.diff = prefs.diff;
    const weather = fpWeather(FP_WEATHER[prefs.fpWeather] || 'clear', pk, random), time = FP_TIMES[prefs.fpTime] || 'day';
    startMatch(G, { name: 'Free Play', pal: pk, foes, intel: '', weather, time }, 1 + floor(random() * 1e5), false, prefs.chassis, { loadout: fitOf(prefs.chassis) });
    G.kind = 'free';
    app.scene.uploadWorld();
  }

  // Build and fight's mission (spec 20): you start in its digger, whatever is in the selector.
  function startBase() {
    G.diff = prefs.diff;
    startMatch(G, BASE_MISSION, BASE_MISSION.seed, false, BASE_MISSION.pilot);
    G.kind = 'base';
    app.scene.uploadWorld();
  }

  const TOUCH_CONTROLS = `
    <table class="mech-keys">
      <tr><td>Lower left</td><td>stick: sideways turns the mech (hold it to keep turning), up / down tilts. Double tap: punch</td></tr>
      <tr><td>Above it</td><td>stick: up / down sets the throttle (it stays set), sideways twists the torso. Tap, then tap and hold: jump jets</td></tr>
      <tr><td>Compass</td><td>tap: torso back over the legs</td></tr>
      <tr><td>Right side</td><td>the buttons</td></tr>
      <tr><td>ENERGY (hold)</td><td>beams: damage climbs the longer you hold them on one target -- watch your heat</td></tr>
      <tr><td>FUSION (hold)</td><td>${NAMES.weapons.fusion}: keep the scan on a mech for 3 s (drag the button to aim; brief slips are forgiven): it dies outright -- and the feedback hurts your own torso and shuts your reactor down</td></tr>
      <tr><td>BALLISTIC (hold)</td><td>big single hits, little heat, limited ammo</td></tr>
      <tr><td>MISSILE</td><td>tap: fire the missiles (they home in on a locked target)<br>hold: fly them yourself in IR -- drag to steer, let go to detonate</td></tr>
      <tr><td>Punch</td><td>double tap the lower stick: shove whoever is in front of you (the fist by the crosshair means someone is in reach; drop onto a mech from a jump to stomp it)</td></tr>
      <tr><td>TGT</td><td>tap: next target · hold: swap to your next mech (when you have more than one)</td></tr>
      <tr><td>ZOOM / STOP / II</td><td>zoom, full stop, pause</td></tr>
      <tr><td>LIGHTS</td><td>headlights at night: on, you see; off, you are harder to see</td></tr>
    </table>`;
  const controls = () => (G.touchUI ? TOUCH_CONTROLS : CONTROLS);
  // The address MULTIPLAYER will use, for a LAN host to read out; a RELAY entry that isn't one says so.
  const relayLine = () => (prefs.relay && !normalRelay(prefs.relay) ? `NOT A RELAY ADDRESS -- USING ${app.relay().url}` : `CONNECTS TO ${app.relay().url}`);
  const CONTROLS = `
    <table class="mech-keys">
      <tr><td>W / S</td><td>throttle up / down (it stays set)</td><td>X</td><td>full stop</td></tr>
      <tr><td>A / D</td><td>turn legs</td><td>Mouse</td><td>twist torso &amp; aim</td></tr>
      <tr><td>Left mouse / 1</td><td>beams (hold on target: damage climbs, so does heat)</td><td>Right mouse / 2</td><td>big single hits</td></tr>
      <tr><td>G / 4 (hold)</td><td>${NAMES.weapons.fusion}: scan one mech for 3 s -- it dies; the feedback hurts your torso and shuts you down</td><td></td><td></td></tr>
      <tr><td>Space / 3</td><td>tap: fire missiles &middot; hold: fly them, release to detonate</td><td>F</td><td>fire everything</td></tr>
      <tr><td>E / Mouse 4</td><td>punch: a wind-up, a shove, a recovery -- the fist by the crosshair means someone is in reach; landing on a mech from a jump is a stomp</td><td>T</td><td>next target</td></tr>
      <tr><td>R</td><td>target under crosshair</td><td>J (hold)</td><td>jump jets</td></tr>
      <tr><td>C</td><td>centre torso on legs</td><td>Z</td><td>zoom</td></tr>
      <tr><td>Arrows</td><td>twist / aim without mouse</td><td>P / Esc</td><td>pause</td></tr>
      <tr><td>L</td><td>headlights at night: on, you see; off, you are harder to see</td><td>Q</td><td>swap to your next mech (when you have more than one)</td></tr>
    </table>`;

  // The toggles: [label, get, set, SETTINGS section].
  const OPTS = {
    sound: ['SOUND', () => prefs.sound, v => { prefs.sound = v; store.set('sound', v); }, 'sound'],
    voice: ['VOICE', () => prefs.voice, v => { prefs.voice = v; store.set('mech.voice', v); }, 'sound'],
    invert: ['INVERT AIM', () => prefs.invert, v => { prefs.invert = v; store.set('mech.invert', v); }, 'controls'],
    haptics: ['HAPTICS', () => prefs.haptics, v => { prefs.haptics = v; store.set('haptics', v); }, 'controls'],
    // Less camera: kick, shake, view wobble and squash at 30%, flashes shorter, no buzz, a step fewer particles. The mechs still move.
    motion: ['REDUCED MOTION', () => prefs.reducedMotion, v => { prefs.reducedMotion = v; G.reducedMotion = v; store.set('motion.reduced', v); app.applyParticles(); }, 'display'],   // and a step fewer particles
    frameTime: ['FRAME TIME', () => prefs.frameTime, v => { prefs.frameTime = v; store.set('debug.frametime', v); }, 'display'],   // the in-game readout, for playtests on real phones
  };
  const optLabel = k => `${OPTS[k][0]}: ${OPTS[k][1]() ? 'ON' : 'OFF'}`;
  // Difficulty scales the enemies' skill, never their stats (docs/specs/05-ai.md § Difficulty).
  const diffLabel = () => `DIFFICULTY: ${DIFF[prefs.diff].label}`;
  const cycleDiff = d => { prefs.diff = DIFF_ORDER[(DIFF_ORDER.indexOf(prefs.diff) + d + DIFF_ORDER.length) % DIFF_ORDER.length]; store.set('diff', prefs.diff); };
  // The settings in sections (SOUND, CONTROLS, DISPLAY, GAME), each its
  // toggles then its dials. A phone scrolls the column.
  const dialText = k => SETTINGS[k].fmt(prefs[k], window.innerWidth / Math.max(1, window.innerHeight));   // FOV: the horizontal angle on this screen
  const extra = g => (g === 'display' ? '<button class="opt" data-a="full">FULL SCREEN</button>' : g === 'game' ? `<button class="opt" data-a="diff">${diffLabel()}</button>` : '');
  const options = () => SETTING_GROUPS.map(([g, title]) => {
    const opts = Object.keys(OPTS).filter(k => OPTS[k][3] === g), dials = SETTING_KEYS.filter(k => SETTINGS[k].group === g);
    return `<div class="set-group"><div class="set-head">${title}</div>
      <div class="opts">${opts.map(k => `<button class="opt" data-opt="${k}">${optLabel(k)}</button>`).join('')}${extra(g)}</div>
      ${dials.length ? `<div class="opts dials">${dials.map(k => `<div class="mm-pick"><span>${SETTINGS[k].label}</span><button data-set="${k}" data-d="-1">◀</button><b>${dialText(k)}</b><button data-set="${k}" data-d="1">▶</button></div>`).join('')}</div>` : ''}</div>`;
  }).join('');

  function showOverlay(html, cls = '') { ov.innerHTML = html; ov.className = 'mech-overlay' + (cls ? ' ' + cls : ''); ov.hidden = false; }
  function hideOverlay() { ov.hidden = true; ov.className = 'mech-overlay'; }

  /* ----- the main menu: Campaign / Free Play / Multiplayer / Settings (and DEBUG), and your mech ----- */

  // ?debug=1 adds the DEBUG tab (ui/debugMenu.js, docs/specs/19-debug-menu.md).
  const dbg = createDebugMenu(app, { startMission, startBase, launch, renderMenu });
  // Under the tonnage budget, or NO WEIGHT LIMIT on (single player; never for the arena or co-op, which check it).
  const fitOk = k => fitUnder(k) || (cheat(G, 'weight') && prefs.menuSel !== 'mp');
  const MENU = [['campaign', 'CAMPAIGN'], ['free', 'FREE PLAY'], ['mp', 'MULTIPLAYER'], ['settings', 'SETTINGS'], ...(dbg.on ? [['debug', 'DEBUG']] : [])];

  function mainMenu(sel = prefs.menuSel, status = '') {
    if (app.editor) { app.editor.back(); return; }   // opened with ?edit=1: the menu is the editor (ui/editor.js)
    if (app.net.Net.ws) { const ws = app.net.Net.ws; app.net.Net.ws = null; ws.close(); }
    G.mode = 'sp'; G.state = 'menu'; G.paused = false; G.guide = null;
    prefs.menuSel = sel; store.set('menu.sel', sel);
    app.mechlab.fit.open = false;
    app.input.syncTouchUI(); app.input.exitLock();
    // The backdrop: a quiet patch of desert, with your mech standing in it.
    if (G.worldKind !== 'menu') {
      G.worldKind = 'menu';
      G.pal = palAt('dusk'); G.palRamp = null;
      G.ter = makeGround(3);
      app.scene.uploadWorld();
    }
    G.shots = []; G.beams = []; G.cbeams = []; G.parts.clear(); G.wrecks = []; G.msgs = [];
    showMech();
    renderMenu(status);
  }
  // The mech on show: multiplayer shows it in your arena colour.
  // Unlocked chassis live in the campaign save (ui/campaign.js); a restarted
  // campaign keeps them. ?unlock (or ?debug=1) opens every chassis and
  // mission, for testing; winning one still counts in the save. &lock keeps
  // a debug run's locks, as a new player has them (the smoke test).
  const unlockAll = (app.params.has('unlock') || app.params.has('debug')) && !app.params.has('lock');
  const REALLY_MS = 3000;
  let reallyUntil = 0, frontierWin = false;
  const camp = app.campaign;
  const locked = k => !unlockAll && !camp.unlocked.includes(k);
  function showMech() {
    const key = locked(prefs.chassis) ? app.R.partsKeyLocked(prefs.chassis) : prefs.menuSel === 'mp' ? app.R.partsKeyFor(prefs.mpColor, prefs.chassis) : prefs.chassis;
    G.player = newMech(G, prefs.chassis, 0, 0, 0, 0, { partsKey: key, loadout: fitOf(prefs.chassis) });
    G.mechs = [G.player];
    menuTick(0);
  }
  function menuTick(dt) {
    const m = G.player, t = performance.now() / 1000;
    if (!m) return;
    if (!G.menuDrag) G.showYaw = (G.showYaw ?? 2.6) + dt * 0.35;
    m.yaw = G.showYaw; m.twist = sin(t * 0.6) * 0.3; m.pitch = sin(t * 0.4) * 0.08;
    initFeet(G, m);
    m.bob = sin(t * 1.7) * 0.06;   // idling: a slow breath
  }

  function menuDetail(status) {
    if (prefs.menuSel === 'debug') return dbg.detail();
    if (prefs.menuSel === 'campaign') {
      const d = missionDef(prefs.mission), p = PALS[d.pal];
      const all = missionFoes(d);   // waves are hostiles too
      const counts = all.reduce((a, f) => ((a[foeType(f)] = (a[foeType(f)] || 0) + 1), a), {});
      // The strip: twelve squares, done (tap to replay), the next one, the rest locked.
      const strip = stripSquares(camp, unlockAll).map((st, i) => `<button class="sq ${st}${i === prefs.mission ? ' sel' : ''}" data-mis="${i}" ${st === 'locked' ? 'disabled' : ''}>${i + 1}</button>`).join('');
      const really = performance.now() < reallyUntil;
      return `<div class="strip">${strip}</div>
        <div class="k">${esc(missionTitle(prefs.mission + 1, d.name))}</div>
        <p>${esc(d.intel)}</p>
        <p class="dim">${esc(p.name.toUpperCase())} · ${Object.entries(counts).map(([k, n]) => `${n}x ${CHASSIS[k].name}`).join(', ')}</p>
        ${camp.mission > 0 ? `<button class="opt${really ? ' really' : ''}" data-a="restart">${really ? 'REALLY?' : 'RESTART CAMPAIGN'}</button>` : ''}`;
    }
    if (prefs.menuSel === 'free') {
      const map = FP_MAPS[prefs.fpMap], mapName = map === 'random' ? 'RANDOM' : map === 'base' ? 'BASE' : PALS[map].name.toUpperCase();
      const mapPick = `<div class="mm-pick"><span>MAP</span><button data-fp="map" data-d="-1">◀</button><b>${mapName}</b><button data-fp="map" data-d="1">▶</button></div>`;
      const diffPick = `<div class="mm-pick"><span>DIFFICULTY</span><button data-fp="diff" data-d="-1">◀</button><b>${DIFF[prefs.diff].label}</b><button data-fp="diff" data-d="1">▶</button></div>`;
      if (map === 'base') return `<p>${esc(BASE_MISSION.name)}. ${esc(BASE_MISSION.intel)}</p><div class="fp-picks">${mapPick}${diffPick}</div>`;   // spec 20: its own mission, its own mechs
      return `<p>One fight. You pick.</p>
        <div class="fp-picks">${mapPick}
        <div class="mm-pick"><span>HOSTILES</span><button data-fp="foes" data-d="-1">◀</button><b>${prefs.fpFoes}</b><button data-fp="foes" data-d="1">▶</button></div>
        <div class="mm-pick"><span>MIX</span><button data-fp="mix" data-d="-1">◀</button><b>${(FP_MIXES[prefs.fpMix] || FP_MIXES[0]).label}</b><button data-fp="mix" data-d="1">▶</button></div>
        ${diffPick}
        <div class="mm-pick"><span>WEATHER</span><button data-fp="weather" data-d="-1">◀</button><b>${(FP_WEATHER[prefs.fpWeather] || 'clear').toUpperCase()}</b><button data-fp="weather" data-d="1">▶</button></div>
        <div class="mm-pick"><span>TIME</span><button data-fp="time" data-d="-1">◀</button><b>${{ day: 'NORMAL', dawn: 'DAWN', night: 'NIGHT' }[FP_TIMES[prefs.fpTime] || 'day']}</b><button data-fp="time" data-d="1">▶</button></div></div>`;
    }
    if (prefs.menuSel === 'mp') {
      const coop = prefs.mpKind === 'coop', pick = prefs.arenaPick;
      // One row: the arena or co-op; in the arena, the public one, a private
      // one or one by its code; in co-op, host or join. Then the private
      // arena's mode, the host's mission or the room code.
      const opt = (on, attr, label) => `<button class="opt${on ? ' on' : ''}" ${attr}>${label}</button>`;
      const kinds = `<div class="mm-pick mp-kind">${opt(!coop, 'data-mpk="arena"', 'ARENA')}${opt(coop, 'data-mpk="coop"', 'CO-OP')}<i></i>${coop
        ? `${opt(!prefs.coopJoin, 'data-cj="0"', 'HOST')}${opt(prefs.coopJoin, 'data-cj="1"', 'JOIN')}`
        : `${opt(pick === 0, 'data-ap="0"', 'PUBLIC')}${opt(pick === 1, 'data-ap="1"', 'PRIVATE')}${opt(pick === 2, 'data-ap="2"', 'JOIN')}`}</div>`;
      const joining = coop ? prefs.coopJoin : pick === 2;
      const codeRow = joining ? `<p class="lobby-row"><label for="room">ROOM CODE</label>
          <input id="room" class="room" maxlength="4" value="${esc(prefs.roomCode)}" placeholder="BCDF"
            autocomplete="off" spellcheck="false" autocapitalize="characters" enterkeyhint="go"></p>` : '';
      const picks = joining ? ''
        : coop ? `<div class="fp-picks coop-picks"><div class="mm-pick"><span>MISSION</span><button data-cp="mission" data-d="-1">◀</button><b>${esc(missionTitle(prefs.mission + 1, missionDef(prefs.mission).name))}</b><button data-cp="mission" data-d="1">▶</button></div>
          <div class="mm-pick"><span>DIFFICULTY</span><button data-fp="diff" data-d="-1">◀</button><b>${DIFF[prefs.diff].label}</b><button data-fp="diff" data-d="1">▶</button></div></div>`
        : pick === 1 ? `<div class="mm-pick arena-mode"><span>MODE</span><button data-am="-1">◀</button><b>${MODE_NAMES[prefs.arenaMode]}</b><button data-am="1">▶</button></div>` : '';
      const blurb = coop ? 'Fly a mission together, up to 4 pilots. The host picks it. The others join with the room code.'
        : pick === 1 ? 'Your own arena, up to 8 pilots. You pick the mode. Friends join with the room code.'
        : pick === 2 ? 'Type the code a friend read out.'
        : 'Free-for-all or team deathmatch for up to 8 pilots. Anyone can drop in. First to the limit wins the round.';
      return `${kinds}
        <p class="mp-blurb${coop ? ' coop' : ''}">${blurb}</p>
        ${picks}
        <div class="mp-ids${joining ? ' two' : ''}">${codeRow}<p class="lobby-row"><label for="callsign">CALLSIGN</label>
          <input id="callsign" class="callsign" maxlength="12" value="${esc(prefs.mpName)}" placeholder="PILOT"
            autocomplete="off" spellcheck="false" autocapitalize="characters" enterkeyhint="go"></p></div>
        <p class="lobby-row"><label for="relay">RELAY</label>
          <input id="relay" class="relay" maxlength="120" value="${esc(prefs.relay)}" placeholder="THIS PAGE'S HOST"
            autocomplete="off" spellcheck="false" autocapitalize="off" inputmode="url" enterkeyhint="go"></p>
        <p class="dim relay-at${!coop && pick === 0 ? '' : ' tight'}">${esc(relayLine())}</p>
        <div class="swatches">${MP_COLORS.map((c, i) => `<button class="swatch${i === prefs.mpColor ? ' on' : ''}" data-col="${i}"
          style="background:${c.css}" aria-label="${c.name}" title="${c.name}"></button>`).join('')}</div>
        <p class="status k">${esc(status)}</p>`;
    }
    return `${options()}
      <div class="mm-controls">${controls()}</div>
      <p class="credits">Original game, raw WebGL. Sound effects by <a href="https://kenney.nl" target="_blank" rel="noopener">Kenney</a> (CC0).
        The cockpit voice is your browser's speech engine. <span class="dim version">v${VERSION}</span></p>`;
  }

  function renderMenu(status = '') {
    const ch = CHASSIS[prefs.chassis], info = MECH_INFO[prefs.chassis];
    const hpSum = c => Object.values(CHASSIS[c].hp).reduce((a, v) => a + v, 0);
    const maxHp = max(...MECH_ORDER.map(hpSum)), maxSpeed = max(...MECH_ORDER.map(c => CHASSIS[c].speed));
    const bar = (label, f) => `<span>${label}</span><i><b style="width:${Math.round(f * 100)}%"></b></i>`;
    const shut = locked(prefs.chassis), heavy = !shut && !fitOk(prefs.chassis), lab = app.mechlab.fit.open && !shut;
    const mpLabel = prefs.mpKind !== 'coop' ? ['JOIN ARENA', 'CREATE', 'JOIN'][prefs.arenaPick] : prefs.coopJoin ? 'JOIN' : 'HOST';
    const launchLabel = shut ? 'LOCKED' : heavy ? 'OVERWEIGHT' : { campaign: 'LAUNCH', free: 'LAUNCH', mp: mpLabel, debug: dbg.goLabel() }[prefs.menuSel];
    showOverlay(`
      <div class="mm">${app.update ? '<button class="mm-update" data-a="update">UPDATED · RELOAD</button>' : ''}
        <div class="mm-left">
          <div class="mm-title">STOMPY</div>
          ${lab ? `<div class="mm-detail mm-lab">${app.mechlab.html()}</div>` : `<nav class="mm-items${MENU.length > 4 ? ' five' : ''}">${MENU.map(([k, label]) => `<button class="mm-item${k === prefs.menuSel ? ' on' : ''}" data-sel="${k}">${label}</button>`).join('')}</nav>
          <div class="mm-detail">${menuDetail(status)}</div>`}
          ${launchLabel ? `<button class="mm-launch" data-a="go"${heavy || shut ? ' disabled' : ''}>${launchLabel}</button>` : ''}
        </div>
        <div class="mm-right">
          <div class="mm-select">
            <div class="mm-label">SELECT MECH</div>
            <div class="mm-mech"><button data-mech="-1" aria-label="Previous mech">◀</button><span>${ch.name}</span><button data-mech="1" aria-label="Next mech">▶</button></div>
            <div class="mm-role${shut ? ' locked' : ''}">${shut ? NAMES.locked(ch.unlock) : info.role}</div>
            <div class="mm-kit">${kitLine(prefs.chassis)}</div>
            <div class="mm-stats">${bar('SPEED', ch.speed / maxSpeed)}${bar('ARMOR', hpSum(prefs.chassis) / maxHp)}${bar('FIREPOWER', info.fire)}</div>
            ${lab || shut || ch.hopper ? '' : '<button class="opt mm-fit" data-a="fit">FIT</button>'}
          </div>
        </div>
      </div>`, 'menu');
  }

  function go() {
    if (locked(prefs.chassis)) return;   // LOCKED: clear more missions
    if (!fitOk(prefs.chassis)) return;   // OVERWEIGHT: fix it in FIT first
    if (prefs.menuSel === 'campaign') { startMission(prefs.mission); launch(); }
    else if (prefs.menuSel === 'free') { startSkirmish(); launch(); }
    else if (prefs.menuSel === 'debug') dbg.go();
    else if (prefs.menuSel === 'mp') {
      // The public arena, a private one (its mode), co-op (open a room for the
      // picked mission), or any room by its code.
      const coop = prefs.mpKind === 'coop';
      if (CHASSIS[prefs.chassis].hopper) { setStatus(`THE ${CHASSIS[prefs.chassis].name} STAYS HOME. PICK ANOTHER MECH.`); return; }   // single player only (spec 20)
      if (coop ? prefs.coopJoin : prefs.arenaPick === 2) {
        prefs.roomCode = ($('.room', ov)?.value || prefs.roomCode).trim().toUpperCase().slice(0, 4);
        if (prefs.roomCode.length !== 4) { setStatus('TYPE THE ROOM CODE: FOUR LETTERS'); return; }
        app.net.join({ room: prefs.roomCode });
      } else if (!coop) app.net.join(prefs.arenaPick === 1 ? { create: { kind: 'arena', mode: prefs.arenaMode } } : {});
      else app.net.join({ create: { mission: prefs.mission, diff: prefs.diff, seed: missionDef(prefs.mission).seed ?? 7 + prefs.mission * 13 } });
    }
  }

  function launch() {
    hideOverlay();
    wrap.focus();
    G.state = 'play'; G.paused = false;
    app.input.syncTouchUI();
    // On a phone, go full screen and sideways where the browser allows it.
    if (G.touchUI && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen({ navigationUI: 'hide' })
        .then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
    }
    app.audio.Sound.unlock();
    app.audio.loadSamples();
    app.input.lockPointer();
    app.input.syncWeaponButtons();
    app.audio.say(G.kind === 'campaign' ? `${missionSpoken(prefs.mission + 1, G.def.name)} Systems online.` : G.kind === 'edit' || G.kind === 'bench' ? 'Systems online.' : G.kind === 'range' ? 'Range open. Systems online.' : G.kind === 'base' ? `${G.def.name}. Systems online.` : 'Free play. Systems online.', true);
  }

  function debrief() {
    if (G.tut) { G.tut = null; store.set('tut.done', true); }   // mission 1 played through once: no prompts next time
    app.input.syncTouchUI();
    app.input.exitLock();
    const s = G.stats, acc = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
    const tm = `${floor(G.time / 60)}:${String(floor(G.time % 60)).padStart(2, '0')}`;
    const isCamp = G.kind === 'campaign', coop = G.mode === 'coop';
    // A campaign result goes in the save; a win may open a chassis, which the voice announces once.
    // Co-op: every pilot saves a win as their own (and nothing for a loss).
    frontierWin = isCamp && G.won && prefs.mission + 1 >= app.campaign.mission;   // the furthest one: the menu moves on to the next
    const fresh = isCamp && (!coop || G.won) ? recordResult(app.campaign, prefs.mission, { won: G.won, time: G.time, objectives: objectiveRows(G).map(r => r.ok) }) : [];
    if (isCamp && (!coop || G.won)) saveCampaign(store.set, app.campaign);
    // Co-op: everyone's kills (the host counted them) and deaths (the relay did), shared.
    const pilots = coop ? [...app.net.Net.info.values()].sort((a, b) => a.id - b.id) : [];
    const crew = pilots.length ? `<table class="mech-keys scoreboard coop-crew"><tr class="dim"><td>PILOT</td><td>KILLS</td><td>DEATHS</td></tr>${pilots.map(p => `<tr${p.id === app.net.Net.id ? ' class="me"' : ''}>
      <td><span class="dot" style="background:${MP_COLORS[p.color]?.css || '#9f9'}"></span>${esc(p.name)}</td><td>${G.coopKills?.[p.id] || 0}</td><td>${p.deaths || 0}</td></tr>`).join('')}</table>` : '';
    if (fresh.length) app.audio.say(VOICE[fresh.includes('puncher') ? 'unlockPurple' : 'unlock'][0], false, 900);
    const rows = objectiveRows(G).map(r => `<div class="obj ${r.ok ? 'ok' : 'no'}${r.secondary ? ' sec' : ''}"><b>${r.ok ? '&#10003;' : '&#10007;'}</b> ${esc(r.text)}${r.secondary ? ' <i>OPTIONAL</i>' : ''}</div>`).join('');
    showOverlay(`
      <h1 style="color:${G.won ? '#5f5' : '#f44'}">${debriefTitle(G)}</h1>
      <div class="panel">
        <div class="k">${isCamp ? esc(missionTitle(prefs.mission + 1, G.def.name)) : G.kind === 'edit' ? `EDITOR · ${esc(G.def.name)}` : G.kind === 'base' ? esc(G.def.name) : 'FREE PLAY'}</div>
        ${rows ? `<div class="objs">${rows}</div>` : ''}
        ${fresh.length ? `<div class="unlock">NEW MECH: ${fresh.map(k => esc(CHASSIS[k].name)).join(', ')}</div>` : ''}
        <div class="verdict ${G.won ? 'ok' : 'no'}">${esc(verdict(G))}</div>
        <p>TIME ${tm}<br>KILLS ${coop ? G.coopKills?.[app.net.Net.id] || 0 : s.kills} / ${G.mechs.filter(m => m.team !== 0 && (!m.remote || m.eid)).length}<br>
           ACCURACY ${acc}% (${Math.round(s.hits)} of ${Math.round(s.shots)})<br>
           DAMAGE DEALT ${Math.round(s.dealt)} &nbsp; TAKEN ${Math.round(s.taken)}</p>
        ${crew}
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
        ${coop ? '<button class="go" data-a="leave">LEAVE</button>' : `
        ${isCamp && G.won ? '<button class="go" data-a="next">NEXT MISSION</button>' : ''}
        ${isCamp ? `<button class="go" data-a="retry">${G.won ? 'REPLAY' : 'RETRY'}</button>` : '<button class="go" data-a="again">PLAY AGAIN</button>'}
        <button class="go" data-a="menu">${app.editor ? 'EDITOR' : 'MAIN MENU'}</button>`}
      </div>`);
  }

  function pause(on) {
    if (G.lobby || G.summary) return;   // the arena lobby and the round's summary are their own overlays
    if (G.state !== 'play') return;
    G.paused = on;
    app.input.clearHeld();
    if (on) {
      for (const k in app.input.keys) app.input.keys[k] = false;
      endGuide(G, true); G.mDown = false;
      app.input.exitLock();   // give the cursor back, or nothing outside the game can be clicked
      app.input.syncTouchUI();
      showOverlay(`<h1>${app.net.mp() ? 'MENU' : 'PAUSED'}</h1>
        <div class="panel" style="text-align:center">${app.net.mp() ? 'The match keeps going while you are in here. Tap or click to get back in.' : 'Click to resume.'}</div>
        ${app.net.mp() ? `<div class="panel"><div class="k">SCORES &mdash; FIRST TO ${app.net.Net.limit}</div>${app.net.boardHTML()}</div>` : ''}
        ${app.net.mp() ? '' : dbg.pauseHTML()}<div class="panel">${controls()}</div>${options()}
        ${G.tut ? '<button class="go" data-a="skiptut">SKIP TUTORIAL</button>' : ''}
        ${app.net.mp() ? '<button class="go" data-a="leave">LEAVE MATCH</button>' : `<button class="go" data-a="menu">${app.editor ? 'EDITOR' : 'MAIN MENU'}</button>`}`);
    } else { hideOverlay(); wrap.focus(); app.input.syncTouchUI(); app.input.lockPointer(); }
  }

  ov.addEventListener('click', e => {
    const opt = e.target.closest('[data-opt]');
    if (opt) { const [, get, set] = OPTS[opt.dataset.opt]; set(!get()); opt.textContent = optLabel(opt.dataset.opt); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'update') { app.update?.(); return; }
    if (a === 'skiptut') { G.tut = null; store.set('tut.done', true); e.target.closest('[data-a]').remove(); return; }   // no more prompts, now or later   // a new version is waiting (ui/pwa.js)
    if (a === 'full') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); return; }
    if (dbg.cheatClick(e)) return;   // a cheat switch, on the DEBUG tab or in the pause menu
    if (dbg.tune?.click(e)) return;   // TUNING's pages and overlays, there too (ui/tuning.js)
    if (a === 'diff') { cycleDiff(1); e.target.closest('[data-a]').textContent = diffLabel(); return; }
    if (G.state === 'menu' && app.mechlab.click(e)) return;
    if (a === 'fit') { if (!locked(prefs.chassis)) app.mechlab.open(true); return; }
    const dial = e.target.closest('[data-set]');
    if (dial) {
      const k = dial.dataset.set;
      prefs[k] = stepSetting(k, prefs[k], +dial.dataset.d); store.set(SETTINGS[k].key, prefs[k]);
      if (k === 'particles') app.applyParticles();
      dial.parentElement.querySelector('b').textContent = dialText(k);
      return;
    }
    if (e.target.closest('a')) return;
    const sw = e.target.closest('[data-col]');
    if (sw) { prefs.mpColor = +sw.dataset.col; store.set('mp.color', prefs.mpColor); ov.querySelectorAll('.swatch').forEach(b => b.classList.toggle('on', b === sw)); if (G.state === 'menu') showMech(); return; }
    if (e.target.closest('input')) return;
    // The co-op lobby sits over the menu: its buttons first.
    if (G.lobby && a === 'ready') { app.net.ready(); return; }
    if (G.lobby && a === 'leave') { app.net.leaveArena(); return; }
    if (G.state === 'menu') {
      const sel = e.target.closest('[data-sel]')?.dataset.sel, md = e.target.closest('[data-mech]'), fp = e.target.closest('[data-fp]');
      if (sel) { const wasMp = prefs.menuSel === 'mp'; prefs.menuSel = sel; store.set('menu.sel', sel); if (wasMp !== (sel === 'mp')) showMech(); renderMenu(); return; }
      if (md) { cycleMech(+md.dataset.mech); return; }
      if (prefs.menuSel === 'debug' && dbg.click(e)) return;
      const mis = e.target.closest('[data-mis]');
      if (mis) { const n = +mis.dataset.mis; if (canPlay(camp, n, unlockAll)) { prefs.mission = n; renderMenu(); } return; }
      // MULTIPLAYER: the arena or co-op, host or join, and the host's mission (from the campaign strip).
      const mpk = e.target.closest('[data-mpk]'), cj = e.target.closest('[data-cj]'), cp = e.target.closest('[data-cp]');
      const ap = e.target.closest('[data-ap]'), am = e.target.closest('[data-am]');
      if (mpk || cj || cp || ap || am) {
        prefs.mpName = ($('.callsign', ov)?.value ?? prefs.mpName).trim().toUpperCase().slice(0, 12);   // keep what was typed
        prefs.roomCode = ($('.room', ov)?.value ?? prefs.roomCode).trim().toUpperCase().slice(0, 4);
        if (mpk) { prefs.mpKind = mpk.dataset.mpk; store.set('mp.kind', prefs.mpKind); }
        if (cj) { prefs.coopJoin = cj.dataset.cj === '1'; store.set('coop.join', prefs.coopJoin); }
        if (ap) { prefs.arenaPick = +ap.dataset.ap; store.set('arena.pick', prefs.arenaPick); }
        if (am) { prefs.arenaMode = prefs.arenaMode === 'tdm' ? 'ffa' : 'tdm'; store.set('arena.mode', prefs.arenaMode); }   // two modes: either arrow flips it
        if (cp) { const n = prefs.mission + +cp.dataset.d; if (n >= 0 && canPlay(camp, n, unlockAll)) prefs.mission = n; }
        renderMenu(); return;
      }
      if (fp) {
        const d = +fp.dataset.d;
        if (fp.dataset.fp === 'map') prefs.fpMap = (prefs.fpMap + d + FP_MAPS.length) % FP_MAPS.length;
        else if (fp.dataset.fp === 'diff') cycleDiff(d);
        else if (fp.dataset.fp === 'mix') { prefs.fpMix = (prefs.fpMix + d + FP_MIXES.length) % FP_MIXES.length; store.set('fp.mix', prefs.fpMix); }
        else if (fp.dataset.fp === 'weather') { prefs.fpWeather = (prefs.fpWeather + d + FP_WEATHER.length) % FP_WEATHER.length; store.set('fp.weather', prefs.fpWeather); }
        else if (fp.dataset.fp === 'time') { prefs.fpTime = (prefs.fpTime + d + FP_TIMES.length) % FP_TIMES.length; store.set('fp.time', prefs.fpTime); }
        else prefs.fpFoes = clampN(prefs.fpFoes + d, 1, 8);
        store.set('fp.map', prefs.fpMap); store.set('fp.foes', prefs.fpFoes);
        renderMenu(); return;
      }
      if (a === 'go') go();
      else if (a === 'restart') {
        // Two taps: the first turns the button into REALLY? for 3 s, the second restarts.
        if (performance.now() < reallyUntil) { reallyUntil = 0; restartCampaign(camp); saveCampaign(store.set, camp); prefs.mission = 0; }
        else { reallyUntil = performance.now() + REALLY_MS; setTimeout(() => { if (G.state === 'menu' && prefs.menuSel === 'campaign') renderMenu(); }, REALLY_MS + 30); }
        renderMenu();
      }
      return;
    }
    if (a === 'menu') { if (frontierWin) { prefs.mission = camp.mission; frontierWin = false; } mainMenu(); return; }
    if (a === 'mp') { mainMenu('mp'); return; }
    if (a === 'bench') { app.bench?.start(); return; }   // the bench's AGAIN (?debug=1, ui/bench.js)
    if (a === 'leave') { app.net.leaveArena(); return; }
    if (a === 'ready') { app.net.ready(); return; }   // the arena lobby
    if (a === 'vote') { app.net.vote(+e.target.closest('[data-v]').dataset.v); return; }   // between arena rounds
    if (a === 'team') { app.net.pickTeam(+e.target.closest('[data-team]').dataset.team); return; }   // team deathmatch: a side
    if (a === 'next') { prefs.mission++; startMission(prefs.mission); launch(); }
    else if (a === 'retry') { startMission(prefs.mission); launch(); }
    else if (a === 'again' && G.kind === 'edit') app.editor.play();   // the editor's mission again, as it is now
    else if (a === 'again' && G.kind === 'range') dbg.again();   // the DEBUG tab's range (ui/debugMenu.js)
    else if (a === 'again' && G.kind === 'base') { startBase(); launch(); }   // the base mission again (spec 20)
    else if (a === 'again') { startSkirmish(); launch(); }
    else if (G.state === 'play' && G.paused) pause(false);
  });

  function cycleMech(d) {
    const order = dbg.on ? PILOTABLE : MECH_ORDER;   // ?debug=1 also offers the digger (data/chassis.js)
    prefs.chassis = order[(order.indexOf(prefs.chassis) + d + order.length) % order.length];
    store.set('mech.chassis', prefs.chassis);
    app.mechlab.fit.row = 0;
    if (locked(prefs.chassis)) app.mechlab.fit.open = false;   // nothing to fit on a silhouette
    showMech(); renderMenu();
  }
  ov.addEventListener('input', e => {
    if (dbg.tune?.input(e)) return;
    if (e.target.matches('.callsign')) { prefs.mpName = e.target.value.toUpperCase().slice(0, 12); store.set('mp.name', prefs.mpName); }
    if (e.target.matches('.relay')) { prefs.relay = e.target.value.trim(); store.set('net.relay', prefs.relay); const at = $('.relay-at', ov); if (at) at.textContent = relayLine(); }
  });
  ov.addEventListener('change', e => { dbg.tune?.change(e); });
  // Numbers typed into TUNING must not drive the mech or pause the game.
  ov.addEventListener('keydown', e => { if (e.target.closest?.('.dbg-tune')) e.stopPropagation(); });
  // Drag anywhere off the menu panel to turn the mech round.
  ov.addEventListener('pointerdown', e => {
    if (G.state !== 'menu' || e.target.closest('button, input, a, .mm-left, .mm-select')) return;
    G.menuDrag = { x: e.clientX }; ov.setPointerCapture?.(e.pointerId);
  });
  ov.addEventListener('pointermove', e => { if (G.menuDrag) { G.showYaw += (e.clientX - G.menuDrag.x) * 0.012; G.menuDrag.x = e.clientX; } });
  const endDrag = () => { G.menuDrag = null; };
  ov.addEventListener('pointerup', endDrag); ov.addEventListener('pointercancel', endDrag);
  const setStatus = t => { const el = $('.status', ov); if (el) el.textContent = t; };

  return { OPTS, MENU, fitOk, controls, showOverlay, hideOverlay, setStatus, mainMenu, showMech, menuTick, renderMenu, go, launch, debrief, pause, cycleMech, startMission, startSkirmish, startBase };
}
