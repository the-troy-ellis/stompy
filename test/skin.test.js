import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMechParts, skinMech, BONE, BONE_COUNT, SKIN_FLOATS } from '../src/mesh/mechParts.js';
import { CHASSIS, lockedLook } from '../src/data/chassis.js';
import { geoFor } from '../src/data/geo.js';

// One draw per mech (spec 14 P4): the skinned mesh is every part of the
// chassis, each vertex tagged with the bone drawMech fills for that part.
const verts = b => b.d.length / 9;
const bonesOf = sk => { const n = {}; for (let i = SKIN_FLOATS - 1; i < sk.d.length; i += SKIN_FLOATS) n[sk.d[i]] = (n[sk.d[i]] || 0) + 1; return n; };

test('every chassis skins into one mesh: all its parts, each on its bone', () => {
  for (const [k, ch] of Object.entries(CHASSIS)) {
    const p = buildMechParts(ch), legs = geoFor(ch).legs.length, sk = skinMech(p, legs), n = bonesOf(sk);
    const want = verts(p.hip) + verts(p.torso) + 2 * (verts(p.arm) + (p.fist ? verts(p.fist) : 0) + (p.barrel ? verts(p.barrel) : 0)) + legs * (verts(p.uleg) + verts(p.lleg) + verts(p.foot));
    assert.equal(sk.d.length / SKIN_FLOATS, want, `${k}: every part, nothing else (no shed-armour plates)`);
    assert.equal(n[BONE.hip], verts(p.hip)); assert.equal(n[BONE.torso], verts(p.torso));
    for (const s of [0, 1]) {
      assert.equal(n[BONE.arm[s]], verts(p.arm) + (p.fist ? verts(p.fist) : 0), `${k}: the fist rides on its arm`);
      if (p.barrel) assert.equal(n[BONE.barrel[s]], verts(p.barrel));
    }
    for (let i = 0; i < legs; i++) {
      assert.equal(n[BONE.leg(i)], verts(p.uleg)); assert.equal(n[BONE.leg(i) + 1], verts(p.lleg)); assert.equal(n[BONE.leg(i) + 2], verts(p.foot));
    }
    for (const b of Object.keys(n)) assert.ok(Number(b) >= 0 && Number(b) < BONE_COUNT && Number.isInteger(Number(b)), `${k}: bone ${b}`);
    // Positions, normals and colours are the parts' own, unchanged.
    assert.deepEqual(sk.d.slice(0, 9), p.hip.d.slice(0, 9));
  }
});

test('the four-legged WARDEN uses every leg bone; a locked silhouette skins the same way', () => {
  assert.equal(geoFor(CHASSIS.warden).legs.length, 4);
  assert.equal(BONE.leg(3) + 2, BONE_COUNT - 1, 'four legs fill the bone table exactly');
  const n = bonesOf(skinMech(buildMechParts(CHASSIS.warden), 4));
  for (let b = 0; b < BONE_COUNT; b++) assert.ok(n[b] > 0, `bone ${b} used`);
  const locked = { ...CHASSIS.puncher, ...lockedLook(CHASSIS.puncher) };
  assert.ok(skinMech(buildMechParts(locked), geoFor(locked).legs.length).d.length > 0);
});

test('the shader holds BONE_COUNT matrices and falls back where the GPU has no room', () => {
  const gl = readFileSync('src/render/gl.js', 'utf8');
  assert.match(gl, /uBones\[\$\{BONE_COUNT\}\]/);
  assert.match(gl, /MAX_VERTEX_UNIFORM_VECTORS\) >= BONE_COUNT \* 4/);
  const scene = readFileSync('src/render/scene.js', 'utf8');
  assert.match(scene, /if \(R\.skinned\) R\.drawSkinned\(parts\.skin, BONES, tint\)/);
});
