// Weather particles (docs/specs/07-atmosphere.md § Weather): a box of drops
// round the camera, 60 m across and 30 m tall, each one recycled when it
// leaves the box, so a storm costs the same wherever you walk. They are
// purely for looks, so they live in the renderer, not the sim, and use
// Math.random. The scene copies them into an effect shape's instances.
export const BOX = { half: 30, up: 18, down: 12 };

export function makeWeatherBox(cap = 2500) {
  return { cap, n: 0, pos: new Float32Array(cap * 3) };
}

// Keep `n` drops moving at `vel` (m/s) around `eye` for `dt` seconds.
export function stepWeatherBox(B, eye, n, vel, dt) {
  n = Math.min(n, B.cap);
  const p = B.pos, H = BOX.half, span = BOX.up + BOX.down;
  for (let i = B.n; i < n; i++) {   // new drops anywhere in the box
    p[i * 3] = eye[0] + (Math.random() * 2 - 1) * H;
    p[i * 3 + 1] = eye[1] - BOX.down + Math.random() * span;
    p[i * 3 + 2] = eye[2] + (Math.random() * 2 - 1) * H;
  }
  B.n = n;
  for (let i = 0; i < n; i++) {
    const i3 = i * 3;
    let x = p[i3] + vel[0] * dt, y = p[i3 + 1] + vel[1] * dt, z = p[i3 + 2] + vel[2] * dt;
    if (y < eye[1] - BOX.down) { y += span; x = eye[0] + (Math.random() * 2 - 1) * H; z = eye[2] + (Math.random() * 2 - 1) * H; }
    else if (y > eye[1] + BOX.up) y -= span;
    // Walk out of the box and the drops behind you reappear ahead.
    if (x < eye[0] - H) x += 2 * H; else if (x > eye[0] + H) x -= 2 * H;
    if (z < eye[2] - H) z += 2 * H; else if (z > eye[2] + H) z -= 2 * H;
    p[i3] = x; p[i3 + 1] = y; p[i3 + 2] = z;
  }
}
