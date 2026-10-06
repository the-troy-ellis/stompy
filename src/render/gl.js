import { M } from '../util/math.js';
import { buildProps } from '../mesh/props.js';
import { buildEffectShapes, EFFECT_SHAPES, DITHER_SHAPES } from '../mesh/effects.js';
import { Builder } from '../mesh/builder.js';
import { buildMechParts } from '../mesh/mechParts.js';
import { CHASSIS, lockedLook } from '../data/chassis.js';
import { MP_COLORS } from '../data/colors.js';

// The WebGL side: context, the two shaders, mesh upload, the per-draw call,
// and the mesh sets (one per chassis, plus one per arena colour on demand).
export function createRenderer(cv, { antialias = true } = {}) {
  const gl = cv.getContext('webgl', { antialias, alpha: false, powerPreference: 'high-performance' });
  if (!gl) return null;
  /* ---------- GL setup ---------- */

  const compile = (vs, fs) => {
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  };
  const prog = compile(`
    attribute vec3 aPos, aNrm, aCol;
    uniform mat4 uVP, uM; uniform vec3 uLight, uTint, uCam, uShade; uniform float uEmis; uniform vec2 uFog;
    varying vec3 vCol; varying float vFog;
    void main() {
      vec4 wp = uM * vec4(aPos, 1.0);
      gl_Position = uVP * wp;
      vec3 n = normalize((uM * vec4(aNrm, 0.0)).xyz);
      float d = max(dot(n, uLight), 0.0);
      vec3 base = aCol * uTint;
      vCol = mix(base * (0.36 + 0.78 * d) * uShade, base, uEmis);   // uShade: the time of day (palettes.js); glowing things keep their glow
      vFog = clamp((length(wp.xyz - uCam) - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
    }`, `
    precision mediump float;
    uniform vec3 uFogCol; uniform float uIR, uHeat; varying vec3 vCol; varying float vFog;
    void main() {
      vec3 c = mix(vCol, uFogCol, vFog);
      if (uIR > 0.5) {
        // White-hot infrared (the missile camera): cold things are dim greys
        // by brightness; hot things -- mechs, fire, weapons -- glow white.
        float l = dot(vCol, vec3(0.3, 0.59, 0.11));
        float g = mix(0.1 + l * 0.3, 0.97, uHeat);
        c = vec3(mix(g, 0.06, vFog * 0.9));
      }
      gl_FragColor = vec4(c, 1.0);
    }`);
  // Effects, instanced (spec 14 P1): one draw per shape. Per vertex the shape's
  // position and normal; per instance its position and size (iPS), spin and
  // tumble (iRot, the same RY-then-RX order the matrices used), colour, glow and
  // IR heat and dither (iFx). Lit, fogged and IR-shaded exactly like the main shader.
  // Smoke and dust dither out (§ The look 3): the DITHER build skips pixels by
  // an ordered 4x4 threshold (Bayer) on the screen's pixel grid, which at the
  // chunky resolution is a coarse checkerboard. Drawn last; never blended.
  const ext = gl.getExtension('ANGLE_instanced_arrays');
  const instVS = `
    attribute vec3 aPos, aNrm; attribute vec4 iPS; attribute vec2 iRot; attribute vec3 iCol; attribute vec3 iFx;
    uniform mat4 uVP; uniform vec3 uLight, uCam, uShade; uniform vec2 uFog;
    varying vec3 vCol; varying float vFog, vHeat, vDither;
    vec3 turn(vec3 v) {
      float c = cos(iRot.y), s = sin(iRot.y);
      v = vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z);
      c = cos(iRot.x); s = sin(iRot.x);
      return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
    }
    void main() {
      vec3 wp = iPS.xyz + turn(aPos * iPS.w);
      gl_Position = uVP * vec4(wp, 1.0);
      float d = max(dot(normalize(turn(aNrm)), uLight), 0.0);
      vCol = mix(iCol * (0.36 + 0.78 * d) * uShade, iCol, iFx.x);
      vHeat = iFx.y; vDither = iFx.z;
      vFog = clamp((length(wp - uCam) - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
    }`;
  const instFS = `
    precision mediump float;
    uniform vec3 uFogCol; uniform float uIR; varying vec3 vCol; varying float vFog, vHeat, vDither;
    float bayer2(vec2 a) { return mod(2.0 * a.x + 3.0 * a.y, 4.0); }
    float bayer4(vec2 p) { vec2 q = mod(floor(p), 4.0); return (4.0 * bayer2(mod(q, 2.0)) + bayer2(floor(q / 2.0)) + 0.5) / 16.0; }
    void main() {
    #ifdef DITHER
      if (vDither >= bayer4(gl_FragCoord.xy)) discard;
    #endif
      vec3 c = mix(vCol, uFogCol, vFog);
      if (uIR > 0.5) {
        float l = dot(vCol, vec3(0.3, 0.59, 0.11));
        c = vec3(mix(mix(0.1 + l * 0.3, 0.97, vHeat), 0.06, vFog * 0.9));
      }
      gl_FragColor = vec4(c, 1.0);
    }`;
  const instProg = ext && compile(instVS, instFS), ditherProg = ext && compile(instVS, '#define DITHER\n' + instFS);
  const skyProg = compile(`
    attribute vec2 aP; void main() { gl_Position = vec4(aP, 0.999, 1.0); }`, `
    precision mediump float;
    uniform vec3 uZen, uHor; uniform float uH, uRes;
    void main() {
      float y = gl_FragCoord.y / uRes - uH;
      gl_FragColor = vec4(mix(uHor, uZen, smoothstep(0.0, 0.55, y)), 1.0);
    }`);
  const L = n => gl.getUniformLocation(prog, n);
  const U = { VP: L('uVP'), M: L('uM'), light: L('uLight'), shade: L('uShade'), tint: L('uTint'), cam: L('uCam'), emis: L('uEmis'), fog: L('uFog'), fogCol: L('uFogCol'), ir: L('uIR'), heat: L('uHeat') };
  const A = { pos: gl.getAttribLocation(prog, 'aPos'), nrm: gl.getAttribLocation(prog, 'aNrm'), col: gl.getAttribLocation(prog, 'aCol') };
  const SU = { zen: gl.getUniformLocation(skyProg, 'uZen'), hor: gl.getUniformLocation(skyProg, 'uHor'), h: gl.getUniformLocation(skyProg, 'uH'), res: gl.getUniformLocation(skyProg, 'uRes') };
  const skyBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  const upload = b => {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(b.d), gl.STATIC_DRAW);
    return { buf, count: b.d.length / 9 };
  };
  const meshes = {};
  const unit = new Builder(); unit.cube(M.id(), [1, 1, 1]);
  meshes.cube = upload(unit);
  const beam = new Builder(); beam.cube(M.T(0, 0, 0.5), [1, 1, 1]);
  meshes.beam = upload(beam);
  meshes.props = Object.fromEntries(Object.entries(buildProps()).map(([k, b]) => [k, upload(b)]));
  meshes.fx = Object.fromEntries(Object.entries(buildEffectShapes()).map(([k, b]) => [k, upload(b)]));
  const mechParts = {};
  for (const k of Object.keys(CHASSIS)) {
    const p = buildMechParts(CHASSIS[k]);
    mechParts[k] = Object.fromEntries(Object.entries(p).map(([n, b]) => [n, upload(b)]));
  }

  // A mesh set per chassis + multiplayer colour, built the first time it's needed.
  // A locked chassis's silhouette (lockedLook), built the first time it's shown.
  function partsKeyLocked(type) {
    const key = `${type}:locked`;
    if (!mechParts[key]) mechParts[key] = Object.fromEntries(Object.entries(buildMechParts({ ...CHASSIS[type], ...lockedLook(CHASSIS[type]) })).map(([n, b]) => [n, upload(b)]));
    return key;
  }
  function partsKeyFor(color, type = 'kestrel') {
    if (!CHASSIS[type]) type = 'kestrel';
    const key = `${type}:${color}`;
    if (!mechParts[key]) {
      const c = MP_COLORS[color] || MP_COLORS[0];
      const p = buildMechParts({ ...CHASSIS[type], col: c.col, acc: c.acc });
      mechParts[key] = Object.fromEntries(Object.entries(p).map(([n, b]) => [n, upload(b)]));
    }
    return key;
  }

  // `heat` is for the IR view; unset, it uses drawHeat (set around groups of draws).
  const R = { drawHeat: 0, curMesh: null, draws: 0 };   // drawHeat: for the IR view, set around groups of draws; draws: per-frame count
  const WHITE = [1, 1, 1];
  const draw = (mesh, m, tint = WHITE, emis = 0, heat) => {
    if (R.curMesh !== mesh) {
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buf);
      gl.vertexAttribPointer(A.pos, 3, gl.FLOAT, false, 36, 0);
      gl.vertexAttribPointer(A.nrm, 3, gl.FLOAT, false, 36, 12);
      gl.vertexAttribPointer(A.col, 3, gl.FLOAT, false, 36, 24);
      R.curMesh = mesh;
    }
    gl.uniformMatrix4fv(U.M, false, m);
    gl.uniform3fv(U.tint, tint);
    gl.uniform1f(U.emis, emis);
    gl.uniform1f(U.heat, heat === undefined ? R.drawHeat : heat);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    R.draws++;
  };


  // Instanced effects: FX_FLOATS per instance (x y z size, spin tumble, r g b,
  // glow heat dither). The scene fills R.fx[shape].data and .n each frame and
  // calls drawEffects once; R.frame holds that frame's shared uniforms.
  const FX_FLOATS = 12, FX_CAP = 4096, fx = {};
  let instBuf = null;
  const instLocs = p => {
    const L2 = n => gl.getUniformLocation(p, n), A2 = n => gl.getAttribLocation(p, n);
    return { p, U: { VP: L2('uVP'), light: L2('uLight'), cam: L2('uCam'), shade: L2('uShade'), fog: L2('uFog'), fogCol: L2('uFogCol'), ir: L2('uIR') },
      A: { pos: A2('aPos'), nrm: A2('aNrm'), ps: A2('iPS'), rot: A2('iRot'), col: A2('iCol'), fx: A2('iFx') } };
  };
  // Two passes: the solid shapes, then the dithering ones (mesh/effects.js).
  const passes = [];
  if (instProg) {
    for (const k of EFFECT_SHAPES) fx[k] = { data: new Float32Array(FX_CAP * FX_FLOATS), n: 0 };
    instBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, FX_CAP * FX_FLOATS * 4, gl.DYNAMIC_DRAW);
    passes.push({ ...instLocs(instProg), shapes: EFFECT_SHAPES.filter(k => !DITHER_SHAPES.includes(k)) },
      { ...instLocs(ditherProg), shapes: DITHER_SHAPES });
  }
  const drawPass = ({ p, U: IU, A: IA, shapes }) => {
    if (!shapes.some(k => fx[k].n)) return;
    const f = R.frame, inst = [IA.ps, IA.rot, IA.col, IA.fx];
    gl.useProgram(p);
    gl.uniformMatrix4fv(IU.VP, false, f.VP); gl.uniform3fv(IU.light, f.light); gl.uniform3fv(IU.cam, f.cam); gl.uniform3fv(IU.shade, f.shade);
    gl.uniform2f(IU.fog, f.fog[0], f.fog[1]); gl.uniform3fv(IU.fogCol, f.fogCol); gl.uniform1f(IU.ir, f.ir);
    for (const a of [IA.pos, IA.nrm, ...inst]) gl.enableVertexAttribArray(a);
    for (const a of inst) ext.vertexAttribDivisorANGLE(a, 1);
    for (const k of shapes) {
      const g = fx[k], mesh = meshes.fx[k];
      if (!g.n) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buf);
      gl.vertexAttribPointer(IA.pos, 3, gl.FLOAT, false, 36, 0);
      gl.vertexAttribPointer(IA.nrm, 3, gl.FLOAT, false, 36, 12);
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, g.data.subarray(0, g.n * FX_FLOATS));
      gl.vertexAttribPointer(IA.ps, 4, gl.FLOAT, false, FX_FLOATS * 4, 0);
      gl.vertexAttribPointer(IA.rot, 2, gl.FLOAT, false, FX_FLOATS * 4, 16);
      gl.vertexAttribPointer(IA.col, 3, gl.FLOAT, false, FX_FLOATS * 4, 24);
      gl.vertexAttribPointer(IA.fx, 3, gl.FLOAT, false, FX_FLOATS * 4, 36);
      ext.drawArraysInstancedANGLE(gl.TRIANGLES, 0, mesh.count, g.n);
      R.draws++;
      g.n = 0;
    }
    for (const a of inst) ext.vertexAttribDivisorANGLE(a, 0);
    for (const a of [IA.pos, IA.nrm, ...inst]) gl.disableVertexAttribArray(a);
  };
  const drawEffects = () => {
    for (const pass of passes) drawPass(pass);
    gl.useProgram(prog);
    R.curMesh = null;
  };

  return Object.assign(R, { gl, prog, skyProg, U, A, SU, skyBuf, upload, meshes, mechParts, partsKeyFor, partsKeyLocked, draw,
    instanced: !!instProg, fx, FX_FLOATS, FX_CAP, drawEffects, frame: null });
}
