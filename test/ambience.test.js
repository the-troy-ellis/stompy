import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BEDS, WEATHER_LAYERS, MUFFLE } from '../src/data/ambience.js';
import { WEATHER_KINDS } from '../src/data/weather.js';
import { PALS } from '../src/data/palettes.js';
import { createAmbience } from '../src/audio/ambience.js';

// Ambient beds (docs/specs/07-atmosphere.md § Ambient audio; #164).
test('every biome has a bed and every weather kind a layer (fog: a muffle instead), all quiet and slow', () => {
  for (const b of Object.keys(PALS)) assert.ok(BEDS[b]?.length, `a bed for ${b}`);
  for (const k of WEATHER_KINDS) assert.ok(Array.isArray(WEATHER_LAYERS[k]), `a layer for ${k}`);
  for (const k of ['rain', 'snow', 'dust']) assert.ok(WEATHER_LAYERS[k].length, `${k} is heard`);
  assert.ok(MUFFLE.fog < 1000, 'fog muffles the bed');
  for (const l of [...Object.values(BEDS), ...Object.values(WEATHER_LAYERS)].flat()) {
    assert.ok(['lowpass', 'bandpass', 'highpass'].includes(l.filter));
    assert.ok(l.gain > 0 && l.gain <= 0.1, 'under the reactor hum');
    assert.ok(l.lfo > 0 && l.lfo < 2, 'a slow wobble');
    assert.ok(l.sweep < l.freq, 'the sweep never takes the filter below 0 Hz');
    assert.ok(l.swell >= 0 && l.swell < 1);
  }
});

// A stand-in AudioContext: just enough to see what gets built, started and stopped.
function fakeContext() {
  const made = [];
  const param = v => ({ value: v, target: v, setTargetAtTime(x) { this.target = x; }, cancelScheduledValues() {} });
  const node = kind => {
    const n = { kind, connect: to => to, started: false, stopped: false, start() { n.started = true; }, stop() { n.stopped = true; },
      gain: param(1), frequency: param(0), Q: param(1) };
    made.push(n); return n;
  };
  return { made, currentTime: 0, createBufferSource: () => node('src'), createBiquadFilter: () => node('filter'), createGain: () => node('gain'), createOscillator: () => node('osc') };
}
const setup = (c = fakeContext()) => {
  let ctx = c;
  const amb = createAmbience({ ac: () => ctx, bus: () => ({}), noise: () => ({ duration: 1 }) });
  return { c, amb, off: () => { ctx = null; } };
};

test('a bed and its weather\'s layers play once there is a context; a change fades the old out and stops it', () => {
  const { c, amb } = setup(), G = { biome: 'dusk', weather: { kind: 'rain', intensity: 1 } };
  amb.tick(G);
  const srcs = () => c.made.filter(n => n.kind === 'src');
  assert.equal(srcs().length, BEDS.dusk.length + WEATHER_LAYERS.rain.length);
  assert.ok(srcs().every(s => s.started && !s.stopped));
  amb.tick(G);
  assert.equal(srcs().length, BEDS.dusk.length + WEATHER_LAYERS.rain.length, 'nothing new while nothing changes');
  const old = srcs();
  G.weather = { kind: 'clear', intensity: 0 };
  amb.tick(G);
  assert.ok(old.every(s => s.stopped), 'the old layers are stopped after their fade');
  assert.equal(srcs().filter(s => !s.stopped).length, BEDS.dusk.length, 'clear: the bed alone');
});

test('fog closes the muffle over the bed; paused or in the menu it all fades down', () => {
  const { c, amb } = setup(), G = { biome: 'ice', weather: { kind: 'fog', intensity: 1 } };
  amb.tick(G);
  const muffle = c.made.find(n => n.kind === 'filter' && n.frequency.value === 20000);
  assert.equal(muffle.frequency.target, MUFFLE.fog);
  const master = c.made.find(n => n.kind === 'gain');
  assert.equal(master.gain.target, 1);
  amb.tick(G, false);
  assert.equal(master.gain.target, 0);
});

test('no context (sound off, or no gesture yet): nothing is made', () => {
  const { c, amb, off } = setup();
  off();
  amb.tick({ biome: 'dusk', weather: { kind: 'dust', intensity: 1 } });
  assert.equal(c.made.length, 0);
});
