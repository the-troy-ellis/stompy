import { M, add, chain, clampN, dirOf, mix3, mul, norm, rnd, sub, len, cross, TAU } from '../util/math.js';
import { geoOf } from '../data/geo.js';
import { buildTerrainMesh } from '../world/terrainMesh.js';
import { frame, viewYaw } from '../sim/geom.js';
import { solveKnee, limb } from '../sim/gait.js';
import { meltFrac } from '../sim/beams.js';

const { sin, cos, atan2, min, max, abs, PI, floor } = Math;

// Everything drawn in 3D: the camera per state, sky, terrain, mechs with
// their IK legs, wrecks, shots, pulses, beams and particles.
export function createScene(app) {
  const G = app.G, R = app.R, wrap = app.wrap, cv = app.cv, hud = app.hud;
  let world = null;
  // The terrain mesh on the GPU, rebuilt whenever the sim builds a new world.
  function uploadWorld() {
    if (world) R.gl.deleteBuffer(world.buf);
    world = R.upload(buildTerrainMesh(G.ter, G.pal, G.ter.seed));
  }

  // Scan tone: a pulsing whine that climbs as the scan converges.


  let W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = min(devicePixelRatio || 1, 1.5);
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (w === W && h === H) return;
    W = w; H = h;
    cv.width = hud.width = max(1, floor(w * dpr));
    cv.height = hud.height = max(1, floor(h * dpr));
  }

  function drawMech(m, VPtint) {
    const parts = R.mechParts[m.partsKey], B = frame(m), sc = m.ch.scale;
    const fwd = [sin(m.yaw), 0, cos(m.yaw)];
    // Armour under a beam glows orange as it melts, and runs hotter in IR.
    const mf = meltFrac(m), heatWas = R.drawHeat;
    const tint = mf ? mix3(VPtint || [1, 1, 1], [2.2, 0.8, 0.25], mf * 0.6) : VPtint || [1, 1, 1];
    if (mf) R.drawHeat = min(1, R.drawHeat + mf * 0.3);
    const g = geoOf(m), back = mul(fwd, -1);
    R.draw(parts.hip, chain(B, M.T(0, g.hip, 0)), tint);
    const hull = M.apply(B, [0, g.hip, 0]);
    // Legs reach for wherever the feet actually are; the knee bends forward,
    // backward (bird legs) or out and up (the quadruped's spider legs).
    m.feet.forEach((f, i) => {
      const leg = g.legs[i];
      const legTint = m.hp[leg.hx > 0 ? 'LL' : 'RL'] > 0 ? tint : mul(tint, 0.35);
      const H = M.apply(B, [leg.hx, g.hip, leg.hz]);
      const pole = g.knee === 'forward' ? fwd : g.knee === 'back' ? back
        : norm(add(norm([H[0] - hull[0], 0, H[2] - hull[2]]), [0, 0.9, 0]));
      const A = add(f.pos, [0, g.ankle * sc, 0]);
      const K = solveKnee(H, A, pole, g.l1 * sc, g.l2 * sc);
      const ankle = add(K, mul(norm(sub(A, K)), g.l2 * sc));   // stays attached even if out of reach
      R.draw(parts.uleg, limb(H, K, pole, sc), legTint);
      R.draw(parts.lleg, limb(K, ankle, pole, sc), legTint);
      R.draw(parts.foot, chain(M.T(...ankle), M.RY(f.yaw), M.S(sc)), legTint);
    });
    const TB = chain(B, M.T(0, g.torsoY, 0), M.RY(m.twist));
    R.draw(parts.torso, TB, tint);
    for (const [s, k] of [[1, 'LA'], [-1, 'RA']]) {
      if (m.hp[k] <= 0) continue;
      R.draw(parts.arm, chain(TB, M.T(s * g.armX, g.armY, 0), M.RX(-m.pitch)), tint);
    }
    R.drawHeat = heatWas;
  }

  function render() {
    resize();
    if (!G.ter) return;
    R.gl.viewport(0, 0, cv.width, cv.height);
    const P = G.player, gd = G.guide, ir = !!gd;
    const IR_ZEN = [0.03, 0.03, 0.03], IR_HOR = [0.1, 0.1, 0.1];
    const hor = ir ? IR_HOR : G.pal.hor;
    R.gl.clearColor(hor[0], hor[1], hor[2], 1);
    R.gl.clear(R.gl.COLOR_BUFFER_BIT | R.gl.DEPTH_BUFFER_BIT);
    let fov, yaw, pitch, eye, dir;
    if (G.state === 'menu') {
      // The main menu's mech: camera in front, aimed left of it so the mech
      // stands in the right-hand part of the screen beside the menu panel.
      // Pulled back a touch more on short screens, and framed so the mech
      // stands above the mech selector in the bottom-right corner.
      const sc = P.ch.scale, R = (15 * sc + 4) * (H < 500 ? 1.45 : 1.2), aspect = W / max(1, H);
      fov = 0.75;
      const c = [P.x, P.y + 4 * sc, P.z];
      eye = [c[0], c[1] + 1.6, c[2] + R];
      const off = aspect > 1 ? 0.4 * R * Math.tan(fov / 2) * aspect : 0;
      dir = norm(sub([c[0] - off, c[1] - (H < 500 ? 2.6 : 1.6), c[2]], eye));
      yaw = atan2(dir[0], dir[2]); pitch = Math.asin(clampN(dir[1], -1, 1));
    } else if (gd) {
      // Riding just behind the volley, looking where it's going.
      fov = 0.95; yaw = gd.yaw; pitch = gd.pitch; dir = gd.dir;
      eye = add(gd.nose || gd.pos, add(mul(dir, 1.5), [0, 0.3, 0]));
    } else {
      fov = G.zoom ? 0.42 : 1.08;
      const sh = G.shake * 0.012;
      yaw = viewYaw(P) + rnd(-sh, sh); pitch = P.pitch + rnd(-sh, sh) - (P.alive ? 0 : 0.15);
      eye = add(G.eye, [0, -G.kick * 0.35, 0]); dir = dirOf(yaw, pitch - G.kick * 0.016);
    }
    G.ear = eye; G.earYaw = yaw;   // sounds are heard from the camera
    const proj = M.persp(fov, W / max(1, H), 0.5, 1800);
    const VP = M.mul(proj, M.lookAt(eye, add(eye, dir)));
    G.VP = VP;

    // Sky.
    R.gl.disable(R.gl.DEPTH_TEST);
    R.gl.useProgram(R.skyProg);
    R.gl.bindBuffer(R.gl.ARRAY_BUFFER, R.skyBuf);
    const ap = R.gl.getAttribLocation(R.skyProg, 'aP');
    R.gl.enableVertexAttribArray(ap);
    R.gl.vertexAttribPointer(ap, 2, R.gl.FLOAT, false, 0, 0);
    R.gl.uniform3fv(R.SU.zen, ir ? IR_ZEN : G.pal.zen); R.gl.uniform3fv(R.SU.hor, hor);
    R.gl.uniform1f(R.SU.h, 0.5 - 0.5 * Math.tan(pitch) / Math.tan(fov / 2)); R.gl.uniform1f(R.SU.res, cv.height);
    R.gl.drawArrays(R.gl.TRIANGLES, 0, 3);
    R.gl.disableVertexAttribArray(ap);

    R.gl.enable(R.gl.DEPTH_TEST);
    R.gl.useProgram(R.prog);
    R.curMesh = null;
    [R.A.pos, R.A.nrm, R.A.col].forEach(a => R.gl.enableVertexAttribArray(a));
    R.gl.uniformMatrix4fv(R.U.VP, false, VP);
    R.gl.uniform3fv(R.U.light, G.pal.light);
    R.gl.uniform3fv(R.U.cam, eye);
    R.gl.uniform2f(R.U.fog, G.pal.fog[0], G.pal.fog[1]);
    R.gl.uniform3fv(R.U.fogCol, hor);
    R.gl.uniform1f(R.U.ir, ir ? 1 : 0);

    R.drawHeat = 0;
    R.draw(world, M.id());
    // In the missile camera your own mech is out there too.
    R.drawHeat = 1;
    for (const m of G.mechs) if (m.alive && (m !== P || gd || G.state === 'menu')) drawMech(m);
    R.drawHeat = 0.45;
    for (const w of G.wrecks) {
      const parts = R.mechParts[w.type], B = chain(M.T(w.x, w.y, w.z), M.RY(w.yaw), M.S(w.scale));
      const dark = [0.3, 0.28, 0.27];
      R.draw(parts.torso, chain(B, M.T(0, 1.3, -1), M.RX(-1.2), M.RZ(w.roll)), dark);
      R.draw(parts.hip, chain(B, M.T(0.5, 0.6, 1.5), M.RY(0.6)), dark);
      R.draw(parts.uleg, chain(B, M.T(2.5, 0.6, 1), M.RZ(1.5)), dark);
      R.draw(parts.lleg, chain(B, M.T(-2.6, 0.5, -0.5), M.RZ(-1.5), M.RY(1)), dark);
    }
    R.drawHeat = 1;
    for (const s of G.shots) {
      // The nose camera can't see its own volley flying alongside it.
      if (gd && s.guided && len(sub(s.p, eye)) < 8) continue;
      const d = norm(s.v), yw = atan2(d[0], d[2]), pt = Math.asin(clampN(d[1], -1, 1));
      if (s.kind === 'shell') R.draw(R.meshes.beam, chain(M.T(...s.p), M.RY(yw), M.RX(-pt), M.S(0.25, 0.25, 2.2)), [1, 0.85, 0.4], 1);
      else R.draw(R.meshes.beam, chain(M.T(...s.p), M.RY(yw), M.RX(-pt), M.S(0.35, 0.35, 1.2)), [1, 0.55, 0.25], 1);
    }
    // Fusion pulses: six sine waves, each in its own plane with its own
    // frequency and phase, writhing inside a packet that races down the
    // beam; the straight targeting beam stays lit underneath while it flies.
    for (const pu of G.pulses) {
      const v = sub(pu.b, pu.a), L = len(v), d = mul(v, 1 / (L || 1));
      const u = norm(cross(d, abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), w2 = cross(u, d);
      const yw = atan2(d[0], d[2]), pt = Math.asin(clampN(d[1], -1, 1));
      if (!pu.hit) R.draw(R.meshes.beam, chain(M.T(...pu.a), M.RY(yw), M.RX(-pt), M.S(0.05, 0.05, L)), [0.85, 0.6, 1], 1);
      const head = min(1, pu.t / pu.dur) * L, pack = min(L, 34), fade = pu.hit ? max(0, 1 - (pu.t - pu.dur) / 0.25) : 1;
      if (fade <= 0) continue;
      const N = 28, tt = performance.now() / 1000;
      for (let k = 0; k < 6; k++) {
        const th = k * PI / 3 + pu.seed, amp = (0.9 + 0.3 * k) * fade, f = 0.22 + 0.09 * k, ph = pu.seed * (k + 1) + tt * (18 + 3 * k);
        const dirk = add(mul(u, cos(th)), mul(w2, sin(th)));
        let prev = null;
        for (let i = 0; i <= N; i++) {
          const sAlong = head - pack + (pack * i) / N;
          if (sAlong < 0) { prev = null; continue; }
          const env = sin(PI * i / N);   // the packet swells in the middle and tapers at both ends
          const q = add(add(pu.a, mul(d, sAlong)), mul(dirk, amp * env * sin(TAU * f * sAlong + ph)));
          if (prev) {
            const sv = sub(q, prev), sl = len(sv), sd = mul(sv, 1 / (sl || 1));
            R.draw(R.meshes.beam, chain(M.T(...prev), M.RY(atan2(sd[0], sd[2])), M.RX(-Math.asin(clampN(sd[1], -1, 1))), M.S(0.22, 0.22, sl)),
              mix3([1, 1, 1], [0.8, 0.55, 1], k / 8), 1);
          }
          prev = q;
        }
      }
    }
    for (const b of G.cbeams) {
      const v = sub(b.b, b.a), l = len(v), d = mul(v, 1 / (l || 1));
      R.draw(R.meshes.beam, chain(M.T(...b.a), M.RY(atan2(d[0], d[2])), M.RX(-Math.asin(clampN(d[1], -1, 1))), M.S(b.w, b.w, l)), b.col, 1);
    }
    for (const b of G.beams) {
      const v = sub(b.b, b.a), l = len(v), d = mul(v, 1 / (l || 1));
      const f = b.life / b.max;
      R.draw(R.meshes.beam, chain(M.T(...b.a), M.RY(atan2(d[0], d[2])), M.RX(-Math.asin(clampN(d[1], -1, 1))), M.S(b.w * (0.6 + f), b.w * (0.6 + f), l)),
        mix3([1, 1, 1], b.col, 0.4 + 0.6 * (1 - f)), 1);
    }
    for (const p of G.parts) {
      const f = p.life / p.max;
      let size = p.size, tint = p.col, emis = 1;
      if (p.kind === 'fire') { size *= 0.4 + f * 0.8; tint = mix3([0.4, 0.1, 0.05], p.col, f); }
      else if (p.kind === 'smoke') { size *= 1.6 - f * 0.8; tint = mix3(G.pal.hor, p.col, f); emis = 0.6; }
      else emis = 0;
      R.draw(R.meshes.cube, chain(M.T(...p.p), M.RY(p.spin), M.RX(p.spin * 0.7), M.S(size)), tint, emis, p.kind === 'fire' ? f : p.kind === 'smoke' ? 0.15 : 0.3);
    }
    [R.A.pos, R.A.nrm, R.A.col].forEach(a => R.gl.disableVertexAttribArray(a));

  }


  const view = { get W() { return W; }, get H() { return H; }, get dpr() { return dpr; } };
  return { resize, render, uploadWorld, view };
}
