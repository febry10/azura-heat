// util.js — small shared helpers for AZURA HEAT: a seeded RNG so the city is the
// same on every load (and in every screenshot), math helpers, and tiny canvas
// texture painters used by the world builder.
'use strict';

window.AH = window.AH || {};

// mulberry32: tiny deterministic PRNG.
AH.rng = function (seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

AH.clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
AH.lerp = function (a, b, t) { return a + (b - a) * t; };
AH.dist2 = function (ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };

// Wrap an angle to [-PI, PI].
AH.wrapAngle = function (a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

// Turn `current` toward `target` by at most `maxStep` radians.
AH.turnToward = function (current, target, maxStep) {
  const d = AH.wrapAngle(target - current);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
};

// Make a canvas of w x h, run painter(ctx, w, h) on it, return a THREE texture.
AH.canvasTexture = function (w, h, painter, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  painter(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  tex.anisotropy = 4;
  return tex;
};

// Merge several indexed BufferGeometries into one non-indexed geometry
// (position/normal/uv only) — enough for palms, lamps and other props.
AH.mergeGeoms = function (geoms) {
  let total = 0;
  const parts = geoms.map(function (g) {
    const n = g.index ? g.toNonIndexed() : g;
    total += n.attributes.position.count;
    return n;
  });
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let o3 = 0, o2 = 0;
  parts.forEach(function (g) {
    pos.set(g.attributes.position.array, o3);
    nor.set(g.attributes.normal.array, o3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o2);
    o3 += g.attributes.position.count * 3;
    o2 += g.attributes.position.count * 2;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
};

// Circle (x,z,r) vs axis-aligned box {minX,maxX,minZ,maxZ}: push the circle out.
// Returns true when a push happened.
AH.pushOutOfBox = function (p, r, box) {
  const nx = AH.clamp(p.x, box.minX, box.maxX);
  const nz = AH.clamp(p.z, box.minZ, box.maxZ);
  const dx = p.x - nx, dz = p.z - nz;
  const d2 = dx * dx + dz * dz;
  if (d2 > r * r) return false;
  if (d2 > 1e-6) {
    const d = Math.sqrt(d2);
    p.x = nx + (dx / d) * r;
    p.z = nz + (dz / d) * r;
  } else {
    // Centre inside the box: push out along the smallest penetration axis.
    const left = p.x - box.minX, right = box.maxX - p.x;
    const top = p.z - box.minZ, bot = box.maxZ - p.z;
    const m = Math.min(left, right, top, bot);
    if (m === left) p.x = box.minX - r;
    else if (m === right) p.x = box.maxX + r;
    else if (m === top) p.z = box.minZ - r;
    else p.z = box.maxZ + r;
  }
  return true;
};
