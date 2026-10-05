import { M } from '../util/math.js';
import { buildProps } from '../mesh/props.js';
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
    uniform mat4 uVP, uM; uniform vec3 uLight, uTint, uCam; uniform float uEmis; uniform vec2 uFog;
    varying vec3 vCol; varying float vFog;
    void main() {
      vec4 wp = uM * vec4(aPos, 1.0);
      gl_Position = uVP * wp;
      vec3 n = normalize((uM * vec4(aNrm, 0.0)).xyz);
      float d = max(dot(n, uLight), 0.0);
      vec3 base = aCol * uTint;
      vCol = mix(base * (0.36 + 0.78 * d), base, uEmis);
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
  const skyProg = compile(`
    attribute vec2 aP; void main() { gl_Position = vec4(aP, 0.999, 1.0); }`, `
    precision mediump float;
    uniform vec3 uZen, uHor; uniform float uH, uRes;
    void main() {
      float y = gl_FragCoord.y / uRes - uH;
      gl_FragColor = vec4(mix(uHor, uZen, smoothstep(0.0, 0.55, y)), 1.0);
    }`);
  const L = n => gl.getUniformLocation(prog, n);
  const U = { VP: L('uVP'), M: L('uM'), light: L('uLight'), tint: L('uTint'), cam: L('uCam'), emis: L('uEmis'), fog: L('uFog'), fogCol: L('uFogCol'), ir: L('uIR'), heat: L('uHeat') };
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
  const draw = (mesh, m, tint = [1, 1, 1], emis = 0, heat) => {
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


  return Object.assign(R, { gl, prog, skyProg, U, A, SU, skyBuf, upload, meshes, mechParts, partsKeyFor, partsKeyLocked, draw });
}
