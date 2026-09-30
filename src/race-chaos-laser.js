// Twin eye lasers — visuals + host-side hit tests (no sim / navigation changes).

const LASER_COLOR = '#ff2222';
const FLY_HIT_R = 0.14;
const MAX_RANGE = 55;
const BURN_INTERVAL_MS = 34;
const BEAM_RADIUS = 0.022;
const WALK_EYE_Z_TAU_MS = 180;
const WALK_DIR_TAU_MS = 180;
const HORIZ_EPS = 1e-4;

const _end = { x: 0, y: 0, z: 0 };
const MUJOCO_EYE_L = { x: -0.022, y: 0.013, z: 0 };
const MUJOCO_EYE_R = { x: 0.022, y: 0.013, z: 0 };

function castBeam(origin, dir, flyId, liveFlies, arenaR, wallZ, square = false) {
  const o = origin, d = dir;
  let bestT = MAX_RANGE;
  let hit = {
    type: 'miss', t: bestT, victimId: null,
    x: o.x + d.x * bestT, y: o.y + d.y * bestT, z: o.z + d.z * bestT,
  };

  for (const v of liveFlies) {
    if (v.id === flyId || v.last?.alive === false || !v.last?.pos) continue;
    const p = v.last.pos;
    const t = raySphereT(o.x, o.y, o.z, d.x, d.y, d.z, p[0], p[1], p[2] || 0.13, FLY_HIT_R);
    if (t != null && t < bestT) {
      bestT = t;
      hit = {
        type: 'fly', t, victimId: v.id,
        x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t,
      };
    }
  }

  const tf = rayFloorT(o.z, d.z);
  if (tf != null && tf < bestT) {
    bestT = tf;
    hit = { type: 'floor', t: tf, victimId: null, x: o.x + d.x * tf, y: o.y + d.y * tf, z: 0, nx: 0, ny: 0, nz: 1 };
  }

  const tw = rayWallT(o.x, o.y, d.x, d.y, arenaR, square);
  if (tw != null && tw < bestT) {
    const x = o.x + d.x * tw, y = o.y + d.y * tw;
    const z = Math.max(0, Math.min(wallZ, o.z + d.z * tw));
    bestT = tw;
    let nx = 0, ny = 0, nz = 0;
    if (square) {
      if (Math.abs(Math.abs(x) - arenaR) <= Math.abs(Math.abs(y) - arenaR)) nx = x >= 0 ? -1 : 1;
      else ny = y >= 0 ? -1 : 1;
    } else {
      const r = Math.hypot(x, y) || 1;
      nx = -x / r; ny = -y / r;
    }
    hit = { type: 'wall', t: tw, victimId: null, x, y, z, nx, ny, nz };
  }

  _end.x = o.x + d.x * bestT;
  _end.y = o.y + d.y * bestT;
  _end.z = o.z + d.z * bestT;
  return hit;
}

function raySphereT(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const fx = ox - cx, fy = oy - cy, fz = oz - cz;
  const b = 2 * (fx * dx + fy * dy + fz * dz);
  const c = fx * fx + fy * fy + fz * fz - r * r;
  let disc = b * b - 4 * c;
  if (disc < 0) return null;
  disc = Math.sqrt(disc);
  const t0 = (-b - disc) * 0.5;
  const t1 = (-b + disc) * 0.5;
  if (t0 > 0.02) return t0;
  if (t1 > 0.02) return t1;
  return null;
}

function rayFloorT(oz, dz) {
  if (dz >= -1e-5) return null;
  const t = -oz / dz;
  return t > 0.02 ? t : null;
}

function raySquareWallT(ox, oy, dx, dy, H) {
  let best = null;
  for (const [o, dd] of [[ox, dx], [oy, dy]]) {
    if (Math.abs(dd) < 1e-8) continue;
    const t = ((dd > 0 ? H : -H) - o) / dd;
    if (t > 0.02 && (best == null || t < best)) best = t;
  }
  return best;
}

function rayWallT(ox, oy, dx, dy, R, square = false) {
  if (square) return raySquareWallT(ox, oy, dx, dy, R);
  const a = dx * dx + dy * dy;
  if (a < 1e-8) return null;
  const b = 2 * (ox * dx + oy * dy);
  const c = ox * ox + oy * oy - R * R;
  let disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  disc = Math.sqrt(disc);
  const t0 = (-b - disc) / (2 * a);
  const t1 = (-b + disc) / (2 * a);
  if (t0 > 0.02) return t0;
  if (t1 > 0.02) return t1;
  return null;
}

/** Compound-eye centroid in head body space (matches head_red mesh vertices). */
function ensureEyeLocals(f, pool) {
  if (pool.eyeLocalsReady) return;
  pool.eyeLocalsReady = true;
  const mesh = f.meshes?.find(m => m.name === 'head_red');
  const pos = mesh?.geometry?.attributes?.position;
  if (!pos) return;
  for (const [side, target, fallback] of [
    ['L', pool.eyeLocalL, MUJOCO_EYE_L],
    ['R', pool.eyeLocalR, MUJOCO_EYE_R],
  ]) {
    const sign = side === 'L' ? -1 : 1;
    let n = 0, x = 0, y = 0, z = 0;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      if (Math.sign(px) !== sign) continue;
      x += px; y += pos.getY(i); z += pos.getZ(i);
      n++;
    }
    if (n > 0) target.set(x / n, y / n, z / n);
    else target.set(fallback.x, fallback.y, fallback.z);
  }
}

function horizontalizeDir(f, pool, dir) {
  const hx = dir.x, hy = dir.y;
  const h2 = hx * hx + hy * hy;
  if (h2 >= HORIZ_EPS * HORIZ_EPS) {
    const inv = 1 / Math.sqrt(h2);
    dir.set(hx * inv, hy * inv, 0);
    return;
  }
  const yaw = f.last?.yaw;
  if (yaw != null && Number.isFinite(yaw)) {
    dir.set(Math.cos(yaw), Math.sin(yaw), 0);
    return;
  }
  const thorax = f.bodies?.thorax;
  if (!thorax) return;
  thorax.updateWorldMatrix(true, false);
  pool.forward.set(1, 0, 0).transformDirection(thorax.matrixWorld);
  pool.forward.z = 0;
  if (pool.forward.lengthSq() < HORIZ_EPS * HORIZ_EPS) return;
  pool.forward.normalize();
  dir.copy(pool.forward);
}

function smoothWalkEyeZ(f, pool, eyeOrigin) {
  if (!pool.walkEyeZ) pool.walkEyeZ = new Map();
  const id = f.id;
  if (!pool._walkStabUpdatedIds) pool._walkStabUpdatedIds = new Set();
  if (!pool._walkStabUpdatedIds.has(id)) {
    const dtMs = pool._beamDtMs ?? 16;
    const alpha = 1 - Math.exp(-dtMs / WALK_EYE_Z_TAU_MS);
    const rawZ = eyeOrigin.z;
    let smooth = pool.walkEyeZ.get(id);
    if (smooth == null) smooth = rawZ;
    else smooth += alpha * (rawZ - smooth);
    pool.walkEyeZ.set(id, smooth);
    pool._walkStabUpdatedIds.add(id);
  }
  eyeOrigin.z = pool.walkEyeZ.get(id) ?? eyeOrigin.z;
}

function smoothWalkDir(f, pool, dir) {
  if (!pool.walkDir) pool.walkDir = new Map();
  const id = f.id;
  if (!pool._walkDirEmaIds) pool._walkDirEmaIds = new Set();
  if (!pool._walkDirEmaIds.has(id)) {
    const dtMs = pool._beamDtMs ?? 16;
    const alpha = 1 - Math.exp(-dtMs / WALK_DIR_TAU_MS);
    const rawX = dir.x, rawY = dir.y;
    let sm = pool.walkDir.get(id);
    if (!sm) {
      sm = { x: rawX, y: rawY };
    } else {
      sm.x += alpha * (rawX - sm.x);
      sm.y += alpha * (rawY - sm.y);
    }
    pool.walkDir.set(id, sm);
    pool._walkDirEmaIds.add(id);
  }
  const sm = pool.walkDir.get(id);
  if (!sm) return;
  const len = Math.hypot(sm.x, sm.y);
  if (len >= HORIZ_EPS) dir.set(sm.x / len, sm.y / len, 0);
  else horizontalizeDir(f, pool, dir);
}

function stabilizeWalkBeam(f, pool, eyeOrigin, dir) {
  smoothWalkEyeZ(f, pool, eyeOrigin);
  horizontalizeDir(f, pool, dir);
  smoothWalkDir(f, pool, dir);
}

function eyeBeamFromFly(f, side, pool) {
  const head = f.bodies?.head;
  if (!head) return null;
  f.group?.updateWorldMatrix(false, true);
  head.updateWorldMatrix(true, false);

  ensureEyeLocals(f, pool);
  const { eyeLocalL, eyeLocalR, eyeOrigin, forward, dir } = pool;
  if (side === 'L') eyeOrigin.copy(eyeLocalL);
  else eyeOrigin.copy(eyeLocalR);
  head.localToWorld(eyeOrigin);

  forward.set(0, 1, 0);
  forward.transformDirection(head.matrixWorld);
  if (forward.lengthSq() < 1e-8) return null;
  forward.normalize();
  dir.copy(forward);

  if (f.last?.flying) {
    pool.walkEyeZ?.delete(f.id);
    pool.walkDir?.delete(f.id);
  } else {
    stabilizeWalkBeam(f, pool, eyeOrigin, dir);
  }

  return {
    origin: { x: eyeOrigin.x, y: eyeOrigin.y, z: eyeOrigin.z },
    dir: { x: dir.x, y: dir.y, z: dir.z },
    flyId: f.id,
    key: `${f.id}:${side}`,
  };
}

export function createLaserPool(T, maxBeams = 28) {
  const group = new T.Group();
  group.name = 'chaosLasers';
  const beams = [];
  const geom = new T.CylinderGeometry(1, 1, 1, 8, 1, true);
  geom.rotateX(Math.PI / 2);
  geom.translate(0, 0, 0.5);
  const mat = new T.MeshBasicMaterial({
    color: LASER_COLOR, transparent: true, opacity: 0.72, depthWrite: false,
    blending: T.AdditiveBlending, toneMapped: false,
  });
  const zAxis = new T.Vector3(0, 0, 1);
  const eyeLocalL = new T.Vector3(MUJOCO_EYE_L.x, MUJOCO_EYE_L.y, MUJOCO_EYE_L.z);
  const eyeLocalR = new T.Vector3(MUJOCO_EYE_R.x, MUJOCO_EYE_R.y, MUJOCO_EYE_R.z);
  const eyeOrigin = new T.Vector3();
  const forward = new T.Vector3();
  const dir = new T.Vector3();
  const q = new T.Quaternion();
  const alt = new T.Vector3(1, 0, 0);
  for (let i = 0; i < maxBeams; i++) {
    const mesh = new T.Mesh(geom, mat.clone());
    mesh.renderOrder = 7;
    mesh.visible = false;
    group.add(mesh);
    beams.push({ mesh });
  }
  return {
    group, beams, geom, zAxis, eyeLocalL, eyeLocalR, eyeOrigin, forward, dir, q, alt,
    eyeLocalsReady: false,
    walkEyeZ: null,
    walkDir: null,
    lastBeamMs: null,
  };
}

function facing(nx, ny, nz, d) {
  if (nx * d.x + ny * d.y + nz * d.z > 0) return { nx: -nx, ny: -ny, nz: -nz };
  return { nx, ny, nz };
}

/** Upright cylinder on Z, from z=0 to z=sz. */
function rayCylHit(o, d, cx, cy, r, sz) {
  let best = null;
  const fx = o.x - cx, fy = o.y - cy;
  const a = d.x * d.x + d.y * d.y;
  if (a > 1e-12) {
    const b = 2 * (fx * d.x + fy * d.y);
    const c = fx * fx + fy * fy - r * r;
    let disc = b * b - 4 * a * c;
    if (disc >= 0) {
      disc = Math.sqrt(disc);
      const inv = 0.5 / a;
      for (const t of [(-b - disc) * inv, (-b + disc) * inv]) {
        if (t <= 0.02 || (best && t >= best.t)) continue;
        const z = o.z + d.z * t;
        if (z < 0 || z > sz) continue;
        const x = o.x + d.x * t, y = o.y + d.y * t;
        const n = facing(x - cx, y - cy, 0, d);
        const nlen = Math.hypot(n.nx, n.ny) || 1;
        best = { t, x, y, z, nx: n.nx / nlen, ny: n.ny / nlen, nz: 0 };
      }
    }
  }
  if (Math.abs(d.z) > 1e-8) {
    for (const [zcap, nz] of [[0, -1], [sz, 1]]) {
      const t = (zcap - o.z) / d.z;
      if (t <= 0.02 || (best && t >= best.t)) continue;
      const x = o.x + d.x * t, y = o.y + d.y * t;
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const n = facing(0, 0, nz, d);
      best = { t, x, y, z: zcap, ...n };
    }
  }
  return best;
}

/** Yawed box, MuJoCo-style: centre (x, y, sz/2), half-extents (sx, sy, sz/2). */
function rayBoxHit(o, d, cx, cy, sx, sy, sz, yaw) {
  const hz = sz * 0.5;
  const c = Math.cos(-yaw), s = Math.sin(-yaw);
  const px = o.x - cx, py = o.y - cy;
  const lx = px * c - py * s, ly = px * s + py * c, lz = o.z - hz;
  const dx = d.x * c - d.y * s, dy = d.x * s + d.y * c, dz = d.z;
  let tmin = 0.02, tmax = Infinity, nx = 0, ny = 0, nz = 0;
  const axes = [[lx, dx, sx, 1, 0, 0], [ly, dy, sy, 0, 1, 0], [lz, dz, hz, 0, 0, 1]];
  for (const [p, dd, h, ax, ay, az] of axes) {
    if (Math.abs(dd) < 1e-12) {
      if (Math.abs(p) > h) return null;
      continue;
    }
    let t1 = (-h - p) / dd, t2 = (h - p) / dd;
    let n1x = -ax, n1y = -ay, n1z = -az, n2x = ax, n2y = ay, n2z = az;
    if (t1 > t2) { const sw = t1; t1 = t2; t2 = sw; n1x = n2x; n1y = n2y; n1z = n2z; }
    if (t1 > tmin) { tmin = t1; nx = n1x; ny = n1y; nz = n1z; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (!(tmin > 0.02) || tmin > tmax) return null;
  const cr = Math.cos(yaw), sr = Math.sin(yaw);
  const n = facing(nx * cr - ny * sr, nx * sr + ny * cr, nz, d);
  return { t: tmin, x: o.x + d.x * tmin, y: o.y + d.y * tmin, z: o.z + d.z * tmin, ...n };
}

function raySolid(o, d, s) {
  if (s.type === 'box') return rayBoxHit(o, d, s.x, s.y, s.sx, s.sy, s.sz, s.yaw || 0);
  if (s.type === 'sphere') {
    const t = raySphereT(o.x, o.y, o.z, d.x, d.y, d.z, s.x, s.y, s.z, s.r);
    if (t == null) return null;
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    const n = facing(x - s.x, y - s.y, z - s.z, d);
    const nlen = Math.hypot(n.nx, n.ny, n.nz) || 1;
    return { t, x, y, z, nx: n.nx / nlen, ny: n.ny / nlen, nz: n.nz / nlen };
  }
  return rayCylHit(o, d, s.x, s.y, s.r, s.sz);
}

/** Cheap colliders from the env — not a mesh raycast (desert GLBs freeze the tab). */
export function collectLaserSolids(env) {
  const out = [];
  if (!env) return out;
  for (const o of env.obstacles || []) {
    if (o.collider === false) continue;
    out.push(o);
  }
  for (const l of env.lamps || []) out.push({ type: 'cyl', x: l.x, y: l.y, r: 0.22, sz: (l.h || 1) * 0.9 });
  for (const c of env.canopies || []) out.push({ type: 'sphere', x: c.x, y: c.y, z: c.z, r: c.r });
  for (const p of env.props || []) {
    if (!p.deco) continue;
    if (p.kind === 'palm') out.push({ type: 'cyl', x: p.x, y: p.y, r: 0.3, sz: (p.h || 3) * 0.7 });
    else if (p.r && p.h) out.push({ type: 'cyl', x: p.x, y: p.y, r: p.r, sz: p.h });
    else if (p.h) out.push({ type: 'cyl', x: p.x, y: p.y, r: 0.25, sz: p.h });
  }
  return out;
}

function hitSolids(origin, dir, hit, solids) {
  if (!solids?.length) return hit;
  for (const s of solids) {
    const h = raySolid(origin, dir, s);
    if (h && h.t < hit.t) hit = { type: 'solid', victimId: null, ...h };
  }
  return hit;
}

export function clearLaserWalkState(pool) {
  if (!pool) return;
  pool.walkEyeZ?.clear();
  pool.walkDir?.clear();
  pool.lastBeamMs = null;
  pool._beamDtMs = null;
  pool._walkStabUpdatedIds = null;
  pool._walkDirEmaIds = null;
}

function aimBeam(pool, mesh, len) {
  const { dir, zAxis, q, alt } = pool;
  if (len < 0.02) {
    mesh.visible = false;
    return;
  }
  mesh.position.copy(pool.eyeOrigin);
  const dot = zAxis.dot(dir);
  if (dot > 0.9999) {
    mesh.quaternion.identity();
  } else if (dot < -0.9999) {
    q.setFromAxisAngle(alt, Math.PI);
    mesh.quaternion.copy(q);
  } else {
    q.setFromUnitVectors(zAxis, dir);
    mesh.quaternion.copy(q);
  }
  mesh.scale.set(BEAM_RADIUS, BEAM_RADIUS, len);
  mesh.visible = true;
}

export function hideLaserPool(pool) {
  if (!pool) return;
  for (const b of pool.beams) b.mesh.visible = false;
  clearLaserWalkState(pool);
}

export function tickLaserBeams(pool, beamFlies, arena, nowMs, lastBurn, callbacks, hitFlies = beamFlies) {
  let dtMs = 16;
  if (pool.lastBeamMs != null) {
    dtMs = nowMs - pool.lastBeamMs;
    if (dtMs < 8) dtMs = 8;
    else if (dtMs > 50) dtMs = 50;
  }
  pool._beamDtMs = dtMs;
  pool.lastBeamMs = nowMs;
  pool._walkStabUpdatedIds = new Set();
  pool._walkDirEmaIds = new Set();

  let i = 0;
  for (const f of beamFlies) {
    if (!f.bodies?.head) continue;
    for (const side of ['L', 'R']) {
      const beam = eyeBeamFromFly(f, side, pool);
      if (!beam || i >= pool.beams.length) continue;
      const square = arena.shape === 'square';
      let hit = castBeam(beam.origin, beam.dir, beam.flyId, hitFlies, square ? arena.half : arena.radius, arena.wallHeight ?? 8, square);
      hit = hitSolids(beam.origin, beam.dir, hit, callbacks.solids);
      _end.x = hit.x; _end.y = hit.y; _end.z = hit.z ?? 0;
      const slot = pool.beams[i++];
      const len = Math.hypot(
        _end.x - beam.origin.x,
        _end.y - beam.origin.y,
        _end.z - beam.origin.z,
      );
      aimBeam(pool, slot.mesh, len);

      if (hit.type === 'fly' && callbacks.physics && hit.victimId != null) {
        callbacks.onFlyHit?.(hit.victimId);
      }
      const burnable = hit.type === 'floor' || hit.type === 'wall' || hit.type === 'solid' || hit.type === 'fly';
      if (burnable) {
        const prev = lastBurn.get(beam.key) || 0;
        if (nowMs - prev >= BURN_INTERVAL_MS) {
          lastBurn.set(beam.key, nowMs);
          callbacks.onBurn?.(hit.x, hit.y, hit.type, hit);
        }
      }
    }
  }
  for (; i < pool.beams.length; i++) pool.beams[i].mesh.visible = false;
}

export function disposeLaserPool(pool) {
  if (!pool) return;
  pool.group.parent?.remove(pool.group);
  pool.geom.dispose();
  for (const b of pool.beams) b.mesh.material.dispose();
}

export function laserSessionDuration() {
  return 4000 + Math.random() * 1000;
}
