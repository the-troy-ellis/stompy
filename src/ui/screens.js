import { $, esc } from '../util/dom.js';
import { store } from '../util/store.js';
import { clampN } from '../util/math.js';
import { CATS, CAT_OF } from '../data/weapons.js';
import { CHASSIS, MECH_ORDER, MECH_INFO } from '../data/chassis.js';
import { NAMES } from '../data/names.js';
import { PALS, palAt } from '../data/palettes.js';
import { missionDef, missionFoes, FP_MAPS, FP_MIXES, FP_WEATHER, FP_TIMES, fpWeather, pickFoes } from '../data/missions.js';
import { MP_COLORS } from '../data/colors.js';
import { makeTerrain } from '../world/terrain.js';
import { newMech, startMatch, foeType } from '../sim/state.js';
import { initFeet } from '../sim/gait.js';
import { endGuide } from '../sim/missiles.js';
import { DIFF, DIFF_ORDER } from '../data/ai.js';
import { SETTINGS, SETTING_KEYS, stepSetting } from '../data/settings.js';
import { fitOf, fitOk, kitLine } from './mechlab.js';
import { objectiveRows, debriefTitle, missionTitle, missionSpoken, verdict } from './debrief.js';
import { recordResult, saveCampaign, restartCampaign, stripSquares, canPlay } from './campaign.js';
import { VOICE } from '../data/voice.js';

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
    app.scene.uploadWorld();
  }
  // Free play: a one-off battle on the chosen map with the chosen number of hostiles.
  function startSkirmish() {
    const pk = FP_MAPS[prefs.fpMap] === 'random' ? ['dusk', 'ice', 'volcanic'][floor(random() * 3)] : FP_MAPS[prefs.fpMap];
    const foes = pickFoes(FP_MIXES[prefs.fpMix] || FP_MIXES[0], prefs.fpFoes, random, k => !locked(k));
    G.diff = prefs.diff;
    const weather = fpWeather(FP_WEATHER[prefs.fpWeather] || 'clear', pk, random), time = FP_TIMES[prefs.fpTime] || 'day';
    startMatch(G, { name: 'Free Play', pal: pk, foes, intel: '', weather, time }, 1 + floor(random() * 1e5), false, prefs.chassis, { loadout: fitOf(prefs.chassis) });
    G.kind = 'free';
    app.scene.uploadWorld();
  }

  const TOUCH_CONTROLS = `
    <table class="mech-keys">
      <tr><td>Upper left</td><td>drag: aim. Sideways turns the mech, up / down tilts. Double tap: torso back over the legs</td></tr>
      <tr><td>Lower left</td><td>drag: up / down sets the throttle (it stays set), sideways twists the torso</td></tr>
      <tr><td>Right side</td><td>the buttons</td></tr>
      <tr><td>ENERGY (hold)</td><td>laser beams: damage climbs the longer you hold them on one target -- watch your heat</td></tr>
      <tr><td>FUSION (hold)</td><td>keep the scan on a mech for 3 s (drag the button to aim; brief slips are forgiven): it dies outright -- and the feedback hurts your own torso and shuts your reactor down</td></tr>
      <tr><td>BALLISTIC (hold)</td><td>autocannon: big single hits, little heat, limited ammo</td></tr>
      <tr><td>MISSILE</td><td>tap: fire the LRMs (they home in on a locked target)<br>hold: fly them yourself in IR -- drag to steer, let go to detonate</td></tr>
      <tr><td>PUNCH</td><td>shove whoever is in front of you (it lights up when someone is in reach; drop onto a mech from a jump to stomp it)</td></tr>
      <tr><td>TGT</td><td>next target</td></tr>
      <tr><td>JUMP (hold)</td><td>jump jets</td></tr>
      <tr><td>ZOOM / STOP / II</td><td>zoom, full stop, pause</td></tr>
      <tr><td>LIGHTS</td><td>headlights at night: on, you see; off, you are harder to see</td></tr>
    </table>`;
  const controls = () => (G.touchUI ? TOUCH_CONTROLS : CONTROLS);
  const CONTROLS = `
    <table class="mech-keys">
      <tr><td>W / S</td><td>throttle up / down (it stays set)</td><td>X</td><td>full stop</td></tr>
      <tr><td>A / D</td><td>turn legs</td><td>Mouse</td><td>twist torso &amp; aim</td></tr>
      <tr><td>Left mouse / 1</td><td>laser beams (hold on target: damage climbs, so does heat)</td><td>Right mouse / 2</td><td>autocannon (big hits)</td></tr>
      <tr><td>G / 4 (hold)</td><td>fusion cannon: scan one mech for 3 s -- it dies; the feedback hurts your torso and shuts you down</td><td></td><td></td></tr>
      <tr><td>Space / 3</td><td>tap: fire missiles &middot; hold: fly them, release to detonate</td><td>F</td><td>fire everything</td></tr>
      <tr><td>E / Mouse 4</td><td>punch: a wind-up, a shove, a recovery -- the fist by the crosshair means someone is in reach; landing on a mech from a jump is a stomp</td><td>T</td><td>next target</td></tr>
      <tr><td>R</td><td>target under crosshair</td><td>J (hold)</td><td>jump jets</td></tr>
      <tr><td>C</td><td>centre torso on legs</td><td>Z</td><td>zoom</td></tr>
      <tr><td>Arrows</td><td>twist / aim without mouse</td><td>P / Esc</td><td>pause</td></tr>
      <tr><td>L</td><td>headlights at night: on, you see; off, you are harder to see</td><td></td><td></td></tr>
    </table>`;

  const OPTS = {
    sound: ['SOUND', () => prefs.sound, v => { prefs.sound = v; store.set('sound', v); }],
    voice: ['VOICE', () => prefs.voice, v => { prefs.voice = v; store.set('mech.voice', v); }],
    invert: ['INVERT AIM', () => prefs.invert, v => { prefs.invert = v; store.set('mech.invert', v); }],
    // Less camera: kick, shake, view wobble and squash at 30%, flashes shorter, no buzz. The mechs still move.
    motion: ['REDUCED MOTION', () => prefs.reducedMotion, v => { prefs.reducedMotion = v; G.reducedMotion = v; store.set('motion.reduced', v); }],
    haptics: ['HAPTICS', () => prefs.haptics, v => { prefs.haptics = v; store.set('haptics', v); }],
    frameTime: ['FRAME TIME', () => prefs.frameTime, v => { prefs.frameTime = v; store.set('debug.frametime', v); }],   // the in-game readout, for playtests on real phones
  };
  const optLabel = k => `${OPTS[k][0]}: ${OPTS[k][1]() ? 'ON' : 'OFF'}`;
  // Difficulty scales the enemies' skill, never their stats (docs/specs/05-ai.md § Difficulty).
  const diffLabel = () => `DIFFICULTY: ${DIFF[prefs.diff].label}`;
  const cycleDiff = d => { prefs.diff = DIFF_ORDER[(DIFF_ORDER.indexOf(prefs.diff) + d + DIFF_ORDER.length) % DIFF_ORDER.length]; store.set('diff', prefs.diff); };
  const options = () => `<div class="opts">${Object.keys(OPTS).map(k => `<button class="opt" data-opt="${k}">${optLabel(k)}</button>`).join('')}
    <button class="opt" data-a="diff">${diffLabel()}</button></div>
    <div class="opts dials">${SETTING_KEYS.map(k => `<div class="mm-pick"><span>${SETTINGS[k].label}</span><button data-set="${k}" data-d="-1">◀</button><b>${SETTINGS[k].fmt(prefs[k])}</b><button data-set="${k}" data-d="1">▶</button></div>`).join('')}
    <button class="opt" data-a="full">FULL SCREEN</button></div>`;

  function showOverlay(html, cls = '') { ov.innerHTML = html; ov.className = 'mech-overlay' + (cls ? ' ' + cls : ''); ov.hidden = false; }
  function hideOverlay() { ov.hidden = true; ov.className = 'mech-overlay'; }

  /* ----- the main menu: Campaign / Free Play / Multiplayer / Settings, and your mech ----- */

  const MENU = [['campaign', 'CAMPAIGN'], ['free', 'FREE PLAY'], ['mp', 'MULTIPLAYER'], ['settings', 'SETTINGS']];

  function mainMenu(sel = prefs.menuSel, status = '') {
    if (app.net.Net.ws) { const ws = app.net.Net.ws; app.net.Net.ws = null; ws.close(); }
    G.mode = 'sp'; G.state = 'menu'; G.paused = false; G.guide = null;
    prefs.menuSel = sel; store.set('menu.sel', sel);
    app.mechlab.fit.open = false;
    app.input.syncTouchUI(); app.input.exitLock();
    // The backdrop: a quiet patch of desert, with your mech standing in it.
    if (G.worldKind !== 'menu') {
      G.worldKind = 'menu';
      G.pal = palAt('dusk'); G.palRamp = null;
      G.ter = makeTerrain(3);
      app.scene.uploadWorld();
    }
    G.shots = []; G.beams = []; G.cbeams = []; G.parts.clear(); G.wrecks = []; G.msgs = [];
    showMech();
    renderMenu(status);
  }
  // The mech on show: multiplayer shows it in your arena colour.
  // Unlocked chassis live in the campaign save (ui/campaign.js); a restarted
  // campaign keeps them. ?unlock opens everything (for testing).
  const unlockAll = new URLSearchParams(location.search).has('unlock');
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
    if (prefs.menuSel === 'campaign') {
      const d = missionDef(prefs.mission), p = PALS[d.pal];
      const all = missionFoes(d);   // waves are hostiles too
      const counts = all.reduce((a, f) => ((a[foeType(f)] = (a[foeType(f)] || 0) + 1), a), {});
      // The strip: twelve squares, done (tap to replay), the next one, the rest locked.
      const strip = stripSquares(camp).map((st, i) => `<button class="sq ${st}${i === prefs.mission ? ' sel' : ''}" data-mis="${i}" ${st === 'locked' ? 'disabled' : ''}>${i + 1}</button>`).join('');
      const really = performance.now() < reallyUntil;
      return `<div class="strip">${strip}</div>
        <div class="k">${esc(missionTitle(prefs.mission + 1, d.name))}</div>
        <p>${esc(d.intel)}</p>
        <p class="dim">${esc(p.name.toUpperCase())} · ${Object.entries(counts).map(([k, n]) => `${n}x ${CHASSIS[k].name}`).join(', ')}</p>
        ${camp.mission > 0 ? `<button class="opt${really ? ' really' : ''}" data-a="restart">${really ? 'REALLY?' : 'RESTART CAMPAIGN'}</button>` : ''}`;
    }
    if (prefs.menuSel === 'free') {
      const mapName = FP_MAPS[prefs.fpMap] === 'random' ? 'RANDOM' : PALS[FP_MAPS[prefs.fpMap]].name.toUpperCase();
      return `<p>One fight. You pick.</p>
        <div class="fp-picks"><div class="mm-pick"><span>MAP</span><button data-fp="map" data-d="-1">◀</button><b>${mapName}</b><button data-fp="map" data-d="1">▶</button></div>
        <div class="mm-pick"><span>HOSTILES</span><button data-fp="foes" data-d="-1">◀</button><b>${prefs.fpFoes}</b><button data-fp="foes" data-d="1">▶</button></div>
        <div class="mm-pick"><span>MIX</span><button data-fp="mix" data-d="-1">◀</button><b>${(FP_MIXES[prefs.fpMix] || FP_MIXES[0]).label}</b><button data-fp="mix" data-d="1">▶</button></div>
        <div class="mm-pick"><span>DIFFICULTY</span><button data-fp="diff" data-d="-1">◀</button><b>${DIFF[prefs.diff].label}</b><button data-fp="diff" data-d="1">▶</button></div>
        <div class="mm-pick"><span>WEATHER</span><button data-fp="weather" data-d="-1">◀</button><b>${(FP_WEATHER[prefs.fpWeather] || 'clear').toUpperCase()}</b><button data-fp="weather" data-d="1">▶</button></div>
        <div class="mm-pick"><span>TIME</span><button data-fp="time" data-d="-1">◀</button><b>${{ day: 'NORMAL', dawn: 'DAWN', night: 'NIGHT' }[FP_TIMES[prefs.fpTime] || 'day']}</b><button data-fp="time" data-d="1">▶</button></div></div>`;
    }
    if (prefs.menuSel === 'mp') {
      return `<p>Free-for-all for up to 8 pilots on this network. First to ${app.net.Net.limit} kills wins the round.</p>
        <p class="lobby-row"><label for="callsign">CALLSIGN</label>
          <input id="callsign" class="callsign" maxlength="12" value="${esc(prefs.mpName)}" placeholder="PILOT"
            autocomplete="off" spellcheck="false" autocapitalize="characters" enterkeyhint="go"></p>
        <div class="swatches">${MP_COLORS.map((c, i) => `<button class="swatch${i === prefs.mpColor ? ' on' : ''}" data-col="${i}"
          style="background:${c.css}" aria-label="${c.name}" title="${c.name}"></button>`).join('')}</div>
        <p class="status k">${esc(status)}</p>`;
    }
    return `${options()}
      <div class="mm-controls">${controls()}</div>
      <p class="credits">Original game, raw WebGL. Sound effects by <a href="https://kenney.nl" target="_blank" rel="noopener">Kenney</a> (CC0).
        The cockpit voice is your browser's speech engine.</p>`;
  }

  function renderMenu(status = '') {
    const ch = CHASSIS[prefs.chassis], info = MECH_INFO[prefs.chassis];
    const hpSum = c => Object.values(CHASSIS[c].hp).reduce((a, v) => a + v, 0);
    const maxHp = max(...MECH_ORDER.map(hpSum)), maxSpeed = max(...MECH_ORDER.map(c => CHASSIS[c].speed));
    const bar = (label, f) => `<span>${label}</span><i><b style="width:${Math.round(f * 100)}%"></b></i>`;
    const shut = locked(prefs.chassis), heavy = !shut && !fitOk(prefs.chassis), lab = app.mechlab.fit.open && !shut;
    const launchLabel = shut ? 'LOCKED' : heavy ? 'OVERWEIGHT' : { campaign: 'LAUNCH', free: 'LAUNCH', mp: 'JOIN ARENA' }[prefs.menuSel];
    showOverlay(`
      <div class="mm">
        <div class="mm-left">
          <div class="mm-title">STOMPY</div>
          ${lab ? `<div class="mm-detail mm-lab">${app.mechlab.html()}</div>` : `<nav class="mm-items">${MENU.map(([k, label]) => `<button class="mm-item${k === prefs.menuSel ? ' on' : ''}" data-sel="${k}">${label}</button>`).join('')}</nav>
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
            ${lab || shut ? '' : '<button class="opt mm-fit" data-a="fit">FIT</button>'}
          </div>
        </div>
      </div>`, 'menu');
  }

  function go() {
    if (locked(prefs.chassis)) return;   // LOCKED: clear more missions
    if (!fitOk(prefs.chassis)) return;   // OVERWEIGHT: fix it in FIT first
    if (prefs.menuSel === 'campaign') { startMission(prefs.mission); launch(); }
    else if (prefs.menuSel === 'free') { startSkirmish(); launch(); }
    else if (prefs.menuSel === 'mp') app.net.join();
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
    app.audio.say(G.kind === 'campaign' ? `${missionSpoken(prefs.mission + 1, G.def.name)} Systems online.` : 'Free play. Systems online.', true);
  }

  function debrief() {
    app.input.syncTouchUI();
    app.input.exitLock();
    const s = G.stats, acc = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
    const tm = `${floor(G.time / 60)}:${String(floor(G.time % 60)).padStart(2, '0')}`;
    const isCamp = G.kind === 'campaign';
    // A campaign result goes in the save; a win may open a chassis, which the voice announces once.
    frontierWin = isCamp && G.won && prefs.mission + 1 >= app.campaign.mission;   // the furthest one: the menu moves on to the next
    const fresh = isCamp ? recordResult(app.campaign, prefs.mission, { won: G.won, time: G.time, objectives: objectiveRows(G).map(r => r.ok) }) : [];
    if (isCamp) saveCampaign(store.set, app.campaign);
    if (fresh.length) app.audio.say(VOICE[fresh.includes('puncher') ? 'unlockPurple' : 'unlock'][0], false, 900);
    const rows = objectiveRows(G).map(r => `<div class="obj ${r.ok ? 'ok' : 'no'}${r.secondary ? ' sec' : ''}"><b>${r.ok ? '&#10003;' : '&#10007;'}</b> ${esc(r.text)}${r.secondary ? ' <i>OPTIONAL</i>' : ''}</div>`).join('');
    showOverlay(`
      <h1 style="color:${G.won ? '#5f5' : '#f44'}">${debriefTitle(G)}</h1>
      <div class="panel">
        <div class="k">${isCamp ? esc(missionTitle(prefs.mission + 1, G.def.name)) : 'FREE PLAY'}</div>
        ${rows ? `<div class="objs">${rows}</div>` : ''}
        ${fresh.length ? `<div class="unlock">NEW MECH: ${fresh.map(k => esc(CHASSIS[k].name)).join(', ')}</div>` : ''}
        <div class="verdict ${G.won ? 'ok' : 'no'}">${esc(verdict(G))}</div>
        <p>TIME ${tm}<br>KILLS ${s.kills} / ${G.mechs.filter(m => m.team !== 0 && !m.remote).length}<br>
           ACCURACY ${acc}% (${Math.round(s.hits)} of ${Math.round(s.shots)})<br>
           DAMAGE DEALT ${Math.round(s.dealt)} &nbsp; TAKEN ${Math.round(s.taken)}</p>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
        ${isCamp && G.won ? '<button class="go" data-a="next">NEXT MISSION</button>' : ''}
        ${isCamp ? `<button class="go" data-a="retry">${G.won ? 'REPLAY' : 'RETRY'}</button>` : '<button class="go" data-a="again">PLAY AGAIN</button>'}
        <button class="go" data-a="menu">MAIN MENU</button>
      </div>`);
  }

  function pause(on) {
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
        <div class="panel">${controls()}</div>${options()}
        ${app.net.mp() ? '<button class="go" data-a="leave">LEAVE MATCH</button>' : '<button class="go" data-a="menu">MAIN MENU</button>'}`);
    } else { hideOverlay(); wrap.focus(); app.input.syncTouchUI(); app.input.lockPointer(); }
  }

  ov.addEventListener('click', e => {
    const opt = e.target.closest('[data-opt]');
    if (opt) { const [, get, set] = OPTS[opt.dataset.opt]; set(!get()); opt.textContent = optLabel(opt.dataset.opt); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'full') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); return; }
    if (a === 'diff') { cycleDiff(1); e.target.closest('[data-a]').textContent = diffLabel(); return; }
    if (G.state === 'menu' && app.mechlab.click(e)) return;
    if (a === 'fit') { if (!locked(prefs.chassis)) app.mechlab.open(true); return; }
    const dial = e.target.closest('[data-set]');
    if (dial) {
      const k = dial.dataset.set;
      prefs[k] = stepSetting(k, prefs[k], +dial.dataset.d); store.set(SETTINGS[k].key, prefs[k]);
      dial.parentElement.querySelector('b').textContent = SETTINGS[k].fmt(prefs[k]);
      return;
    }
    if (e.target.closest('a')) return;
    const sw = e.target.closest('[data-col]');
    if (sw) { prefs.mpColor = +sw.dataset.col; store.set('mp.color', prefs.mpColor); ov.querySelectorAll('.swatch').forEach(b => b.classList.toggle('on', b === sw)); if (G.state === 'menu') showMech(); return; }
    if (e.target.closest('input')) return;
    if (G.state === 'menu') {
      const sel = e.target.closest('[data-sel]')?.dataset.sel, md = e.target.closest('[data-mech]'), fp = e.target.closest('[data-fp]');
      if (sel) { const wasMp = prefs.menuSel === 'mp'; prefs.menuSel = sel; store.set('menu.sel', sel); if (wasMp !== (sel === 'mp')) showMech(); renderMenu(); return; }
      if (md) { cycleMech(+md.dataset.mech); return; }
      const mis = e.target.closest('[data-mis]');
      if (mis) { const n = +mis.dataset.mis; if (canPlay(camp, n)) { prefs.mission = n; renderMenu(); } return; }
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
    if (a === 'leave') { app.net.leaveArena(); return; }
    if (a === 'next') { prefs.mission++; startMission(prefs.mission); launch(); }
    else if (a === 'retry') { startMission(prefs.mission); launch(); }
    else if (a === 'again') { startSkirmish(); launch(); }
    else if (G.state === 'play' && G.paused) pause(false);
  });

  function cycleMech(d) {
    prefs.chassis = MECH_ORDER[(MECH_ORDER.indexOf(prefs.chassis) + d + MECH_ORDER.length) % MECH_ORDER.length];
    store.set('mech.chassis', prefs.chassis);
    app.mechlab.fit.row = 0;
    if (locked(prefs.chassis)) app.mechlab.fit.open = false;   // nothing to fit on a silhouette
    showMech(); renderMenu();
  }
  ov.addEventListener('input', e => { if (e.target.matches('.callsign')) { prefs.mpName = e.target.value.toUpperCase().slice(0, 12); store.set('mp.name', prefs.mpName); } });
  // Drag anywhere off the menu panel to turn the mech round.
  ov.addEventListener('pointerdown', e => {
    if (G.state !== 'menu' || e.target.closest('button, input, a, .mm-left, .mm-select')) return;
    G.menuDrag = { x: e.clientX }; ov.setPointerCapture?.(e.pointerId);
  });
  ov.addEventListener('pointermove', e => { if (G.menuDrag) { G.showYaw += (e.clientX - G.menuDrag.x) * 0.012; G.menuDrag.x = e.clientX; } });
  const endDrag = () => { G.menuDrag = null; };
  ov.addEventListener('pointerup', endDrag); ov.addEventListener('pointercancel', endDrag);
  const setStatus = t => { const el = $('.status', ov); if (el) el.textContent = t; };

  return { OPTS, MENU, controls, showOverlay, hideOverlay, setStatus, mainMenu, showMech, menuTick, renderMenu, go, launch, debrief, pause, cycleMech, startMission, startSkirmish };
}
