/** Sprite diameter ≈ meteor chunk width in arena units (deformed rock + chips). */
export const METEOR_SCALE = 3;
export const METEOR_TRAIL_WIDTH = 1.42 * METEOR_SCALE;

const MAX_PUFFS = 180;
const SOFT_OVERFLOW = 220;
const TRAIL_STEP = 0.12 * METEOR_SCALE;
const MAX_STEPS_PER_SEGMENT = 9;
const LINGER_AFTER_LAND_MS = 5200;
/** Whole-trail fade starts this long before dieAt (ease-in-out, no stepped opacity). */
const FADE_TAIL_MS = 4200;

let smokeGroup = null;
let smokeTex = null;
let puffMat = null;
let puffs = [];
let T = null;
let nextBatchId = 1;
const sealedBatches = new Set();
/** @type {Map<number, number>} unified expiry per landed batch */
const batchDieAt = new Map();
/** @type {Map<number, number>} when the whole trail starts fading */
const batchFadeFrom = new Map();

function easeInOutQuad(u) {
  return u < 0.5 ? 2 * u * u : 1 - ((-2 * u + 2) ** 2) / 2;
}

export function allocMeteorSmokeBatch() {
  return nextBatchId++;
}

export function initMeteorSmoke(THREE, parent, texture) {
  T = THREE;
  smokeTex = texture || smokeTex;
  if (!smokeGroup) {
    smokeGroup = new THREE.Group();
    smokeGroup.name = 'meteorSmoke';
    smokeGroup.renderOrder = 5;
  }
  if (parent && smokeGroup.parent !== parent) {
    smokeGroup.parent?.remove(smokeGroup);
    parent.add(smokeGroup);
  }
}

export function disposeMeteorSmoke() {
  for (const p of puffs) disposePuff(p);
  puffs = [];
  sealedBatches.clear();
  batchDieAt.clear();
  batchFadeFrom.clear();
  if (!smokeGroup) return;
  smokeGroup.parent?.remove(smokeGroup);
  smokeGroup = null;
}

function disposePuff(p) {
  p.mesh?.parent?.remove(p.mesh);
}

function makePuffMaterial() {
  if (puffMat) return puffMat;
  puffMat = new T.SpriteMaterial({
    map: smokeTex,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    depthTest: true,
    blending: T.NormalBlending,
    color: 0xe8e8f0,
    toneMapped: false,
  });
  return puffMat;
}

function pruneExpired() {
  const t = performance.now();
  puffs = puffs.filter(p => {
    if (t >= p.dieAt) {
      disposePuff(p);
      return false;
    }
    return true;
  });
  syncBatchSets();
}

function syncBatchSets() {
  const live = new Set(puffs.map(p => p.batchId));
  for (const id of sealedBatches) {
    if (!live.has(id)) {
      sealedBatches.delete(id);
      batchDieAt.delete(id);
      batchFadeFrom.delete(id);
    }
  }
}

function evictOneUnsealed() {
  let victim = -1;
  let victimDie = Infinity;
  for (let i = 0; i < puffs.length; i++) {
    const p = puffs[i];
    if (sealedBatches.has(p.batchId)) continue;
    if (p.dieAt < victimDie) {
      victimDie = p.dieAt;
      victim = i;
    }
  }
  if (victim < 0) return false;
  disposePuff(puffs[victim]);
  puffs.splice(victim, 1);
  return true;
}

function pruneForBudget() {
  pruneExpired();
  while (puffs.length >= MAX_PUFFS) {
    if (!evictOneUnsealed()) break;
  }
}

function applyBatchDieAt(batchId) {
  const end = batchDieAt.get(batchId);
  if (end == null) return;
  for (const p of puffs) {
    if (p.batchId === batchId) p.dieAt = end;
  }
}

function freezeBatchDrift(batchId) {
  for (const p of puffs) {
    if (p.batchId !== batchId) continue;
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
    p.driftZ = 0;
    p.frozen = true;
  }
}

function spawnMeteorSmokePuff(x, y, z, scale, batchId, driftVec) {
  if (!smokeGroup || !smokeTex || !T) return;
  pruneForBudget();
  while (puffs.length >= SOFT_OVERFLOW) {
    if (!evictOneUnsealed()) break;
  }
  const bornAt = performance.now();
  const end = batchDieAt.get(batchId);
  const mesh = new T.Sprite(makePuffMaterial());
  if (puffMat.opacity < 0.5) puffMat.opacity = 0.78;
  mesh.position.set(x, y, z);
  mesh.scale.setScalar(scale);
  mesh.renderOrder = 8;
  smokeGroup.add(mesh);
  puffs.push({
    mesh,
    bornAt,
    dieAt: end ?? bornAt + 14000,
    scale,
    batchId,
    driftZ: 0.06 + Math.random() * 0.04,
    vx: driftVec?.vx ?? 0,
    vy: driftVec?.vy ?? 0,
    vz: driftVec?.vz ?? 0,
    baseOpacity: 0.78,
  });
}

export function emitMeteorSmokeAlongSegment(x0, y0, z0, x1, y1, z1, batchId, opts = {}) {
  const step = opts.step ?? TRAIL_STEP;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const L = Math.hypot(dx, dy, dz);
  const w = METEOR_TRAIL_WIDTH * (0.92 + Math.random() * 0.08);
  if (L < 1e-5) {
    spawnMeteorSmokePuff(x1, y1, z1, w, batchId, null);
    return;
  }
  const n = Math.min(Math.max(1, Math.ceil(L / step)), MAX_STEPS_PER_SEGMENT);
  const invL = 1 / L;
  const driftVec = { vx: dx * invL * 0.025, vy: dy * invL * 0.025, vz: dz * invL * 0.012 };
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    spawnMeteorSmokePuff(
      x0 + dx * t + (Math.random() - 0.5) * 0.03 * METEOR_SCALE,
      y0 + dy * t + (Math.random() - 0.5) * 0.03 * METEOR_SCALE,
      z0 + dz * t,
      w,
      batchId,
      driftVec,
    );
  }
}

export function sealMeteorSmokeBatch(batchId, landTime) {
  sealedBatches.add(batchId);
  const end = landTime + LINGER_AFTER_LAND_MS;
  batchDieAt.set(batchId, end);
  batchFadeFrom.set(batchId, end - FADE_TAIL_MS);
  applyBatchDieAt(batchId);
  freezeBatchDrift(batchId);
}

export function burstMeteorSmoke(x, y, z, batchId) {
  const w = METEOR_TRAIL_WIDTH * 1.05;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const r = (0.12 + Math.random() * 0.1) * METEOR_SCALE;
    spawnMeteorSmokePuff(
      x + Math.cos(a) * r,
      y + Math.sin(a) * r,
      z + 0.03 * METEOR_SCALE,
      w,
      batchId,
      null,
    );
  }
  applyBatchDieAt(batchId);
  freezeBatchDrift(batchId);
}

export function tickMeteorSmoke(t) {
  if (!puffs.length) return;
  const fadeOf = new Map();
  for (const p of puffs) {
    if (fadeOf.has(p.batchId)) continue;
    const from = batchFadeFrom.get(p.batchId);
    const die = batchDieAt.get(p.batchId) ?? p.dieAt;
    let fade = 1;
    if (from != null) {
      if (t >= die) fade = 0;
      else if (t > from) fade = 1 - easeInOutQuad((t - from) / Math.max(1, die - from));
    }
    fadeOf.set(p.batchId, fade);
  }
  const next = [];
  for (const p of puffs) {
    if (t >= p.dieAt) {
      disposePuff(p);
      continue;
    }
    const age = (t - p.bornAt) / 1000;
    if (!p.frozen) {
      p.mesh.position.x += p.vx;
      p.mesh.position.y += p.vy;
      p.mesh.position.z += p.driftZ * 0.012 + p.vz * 0.012;
      p.mesh.scale.setScalar(p.scale * (1 + age * 0.12));
    }
    next.push(p);
  }
  puffs = next;
  if (puffMat) {
    let fade = 0;
    for (const v of fadeOf.values()) if (v > fade) fade = v;
    puffMat.opacity = 0.78 * fade;
  }
  syncBatchSets();
}

export function orientMeteorAlong(mesh, dx, dy, dz) {
  const len = Math.hypot(dx, dy, dz) || 1;
  const dir = new T.Vector3(dx / len, dy / len, dz / len);
  const up = new T.Vector3(0, 0, 1);
  const q = new T.Quaternion().setFromUnitVectors(up, dir);
  mesh.quaternion.copy(q);
}
