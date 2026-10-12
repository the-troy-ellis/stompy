// Gestures on a map (docs/specs/15-mission-editor.md § Shared parts): the
// mission editor's, and later the command view's. Raw pointer events go in;
// gestures come out, so whoever uses it never counts fingers.
//
//   one finger, or the left button:  tap · long press (and its end) · drag
//                                     (start, move, end, or cancel when a
//                                     second finger lands)
//   two fingers:                      pan, pinch and twist, all at once
//   the right or middle button:       pan
//   the wheel:                        pinch
//
// `createGestures(handlers)` is the pure part, fed { id, x, y, button, t }
// and tested headlessly (test/pointer.test.js); `bindPointer(el, handlers)`
// feeds it from the page. Positions are CSS pixels inside the element.
export const GESTURE = { slop: 8, long: 450 };   // px before a press is a drag; ms before it is a long press

export function createGestures(h = {}) {
  const call = (k, ...a) => h[k]?.(...a);
  const pts = new Map();
  let one = null, two = null, mousePan = null, done = false;   // done: the fingers did a two-finger gesture; wait for all of them to lift
  const pair = () => {
    const [a, b] = [...pts.values()];
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(b.x - a.x, b.y - a.y) || 1, ang: Math.atan2(b.y - a.y, b.x - a.x) };
  };
  function down(p) {
    if (p.button === 1 || p.button === 2) { mousePan = { x: p.x, y: p.y }; return; }
    pts.set(p.id, { x: p.x, y: p.y });
    if (pts.size === 1 && !done) { one = { x0: p.x, y0: p.y, x: p.x, y: p.y, t0: p.t, state: 'press' }; return; }
    if (pts.size === 2) {
      if (one?.state === 'drag') call('dragCancel');
      if (one?.state === 'long') call('longEnd', one.x, one.y);
      one = null; done = true; two = pair();
    }
  }
  function move(p) {
    if (mousePan && !pts.has(p.id)) { call('pan', p.x - mousePan.x, p.y - mousePan.y); mousePan = { x: p.x, y: p.y }; return; }
    const q = pts.get(p.id);
    if (!q) return;
    q.x = p.x; q.y = p.y;
    if (two && pts.size >= 2) {
      const n = pair();
      call('pan', n.cx - two.cx, n.cy - two.cy);
      if (n.d !== two.d) call('pinch', two.d / n.d, n.cx, n.cy);   // fingers apart: nearer (factor < 1)
      let da = n.ang - two.ang;
      if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
      if (da) call('twist', da, n.cx, n.cy);
      two = n;
      return;
    }
    if (!one) return;
    one.x = p.x; one.y = p.y;
    if (one.state === 'press' && Math.hypot(p.x - one.x0, p.y - one.y0) > GESTURE.slop) { one.state = 'drag'; call('dragStart', one.x0, one.y0); }
    if (one.state === 'drag') call('drag', p.x, p.y, one.x0, one.y0);
  }
  function up(p) {
    if (mousePan && (p.button === 1 || p.button === 2)) { mousePan = null; return; }
    if (!pts.delete(p.id)) return;
    if (one) {
      if (one.state === 'press') call('tap', one.x, one.y);
      else if (one.state === 'drag') call('dragEnd', one.x, one.y, one.x0, one.y0);
      else if (one.state === 'long') call('longEnd', one.x, one.y);
      one = null;
    }
    if (pts.size < 2) two = null;
    if (!pts.size) done = false;
  }
  function cancel(p) {
    if (!pts.delete(p.id)) { mousePan = null; return; }
    if (one?.state === 'drag') call('dragCancel');
    if (one?.state === 'long') call('longEnd', one.x, one.y);
    one = null;
    if (pts.size < 2) two = null;
    if (!pts.size) done = false;
  }
  // The clock: a press held still long enough becomes a long press.
  function tick(t) {
    if (one?.state === 'press' && t - one.t0 >= GESTURE.long) { one.state = 'long'; call('longPress', one.x, one.y); }
  }
  const wheel = (dy, x, y) => call('pinch', Math.exp(dy * 0.0015), x, y);
  const busy = () => pts.size > 0 || !!mousePan;
  return { down, move, up, cancel, tick, wheel, busy };
}

// The page's side: pointer events on `el` into the gestures. Returns a
// function that unbinds.
export function bindPointer(el, h) {
  const g = createGestures(h), at = e => { const r = el.getBoundingClientRect(); return { id: e.pointerId, x: e.clientX - r.left, y: e.clientY - r.top, button: e.button, t: e.timeStamp }; };
  let timer = 0;
  const onDown = e => {
    if (e.target !== el) return;   // the panel and its buttons are their own
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* an old browser */ }
    g.down(at(e));
    clearTimeout(timer);
    timer = setTimeout(() => g.tick(performance.now()), GESTURE.long + 10);
  };
  const onMove = e => g.move(at(e));
  const onUp = e => { g.up(at(e)); if (!g.busy()) clearTimeout(timer); };
  const onCancel = e => g.cancel(at(e));
  const onWheel = e => { e.preventDefault(); const p = at(e); g.wheel(e.deltaY * (e.deltaMode === 1 ? 33 : 1), p.x, p.y); };
  const noMenu = e => e.preventDefault();
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('contextmenu', noMenu);
  return () => {
    clearTimeout(timer);
    for (const [k, f] of [['pointerdown', onDown], ['pointermove', onMove], ['pointerup', onUp], ['pointercancel', onCancel], ['wheel', onWheel], ['contextmenu', noMenu]]) el.removeEventListener(k, f);
  };
}
