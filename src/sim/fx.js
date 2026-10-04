// The effects sink: everything the simulation wants the outside world to do
// that isn't state. The real app passes audio, voice and network; tests pass
// nullFx or a recorder. The sim never touches audio, GL or the DOM directly.
//
// @typedef {object} Fx
// @property {(text: string, force?: boolean) => void} say        cockpit voice
// @property {object} sfx                                           one-shot sounds: laser(at, small), flame(at), cannon(at, size), missile(at), boom(at, big), clang(), step(m, vol), land(force), fusionCrack(), fusion(at), beep(), powerdown(), powerup()
// @property {(on: boolean, p: number) => void} fusionSound        scan whine
// @property {(obj: object) => void} netSend                        arena message (ignored outside the arena)
// @property {(bass: number, duck: number, haptic: number, at?: number[]) => void} thump   the feel table's sound and haptic columns

const SFX = ['laser', 'cannon', 'missile', 'boom', 'clang', 'step', 'land', 'fusionCrack', 'fusion', 'beep', 'powerdown', 'powerup', 'whine', 'punch', 'flame'];

export const nullFx = Object.freeze({
  say() {}, fusionSound() {}, netSend() {}, thump() {},
  sfx: Object.freeze(Object.fromEntries(SFX.map(k => [k, () => {}]))),
});

// A sink that records every call as { kind, args, t } for tests.
export function recordFx() {
  const log = [];
  const rec = kind => (...args) => { log.push({ kind, args, t: rec.time }); };
  rec.time = 0;
  const fx = { log, say: rec('say'), fusionSound: rec('fusionSound'), netSend: rec('netSend'), thump: rec('thump'),
    sfx: Object.fromEntries(SFX.map(k => [k, rec('sfx.' + k)])), setTime(t) { rec.time = t; } };
  fx.calls = kind => log.filter(e => e.kind === kind);
  return fx;
}
