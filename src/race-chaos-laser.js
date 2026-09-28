// Twin eye lasers — visuals + host-side hit tests (no sim / navigation changes).

const EYE_L = { x: 0.048, y: 0.034, z: 0.018 };
const EYE_R = { x: 0.048, y: -0.034, z: 0.018 };
const FWD_LOCAL = { x: 1, y: 0, z: -0.06 };
const FLY_HIT_R = 0.14;
const MAX_RANGE = 28;
const BURN_INTERVAL_MS = 34;

const _o = { x: 0, y: 0, z: 0 };
const _d = { x: 0, y: 0, z: 0 };
const _end = { x: 0, y: 0, z: 0 };

function norm3(v) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  v.x /= l; v.y /= l; v.z /= l;
}

function eyeBeamFromFly(f, side) {
  const head = f.bodies?.head;
  if (!head?.matrixWorld) return null;
  head.updateWorldMatrix(true, false);
  const m = head.matrixWorld.elements;
  const ex = side === 'L' ? EYE_L.x : EYE_R.x;
  const ey = side === 'L' ? EYE_L.y : EYE_R.y;
  const ez = side === 'L' ? EYE_L.z : EYE_R.z;
  _o.x = m[12] + m[0] * ex + m[4] * ey + m[8] * ez;
  _o.y = m[13] + m[1] * ex + m[5] * ey + m[9] * ez;
  _o.z = m[14] + m[2] * ex + m[6] * ey + m[10] * ez;
  _d.x = m[0] * FWD_LOCAL.x + m[4] * FWD_LOCAL.y + m[8] * FWD_LOCAL.z;
  _d.y = m[1] * FWD_LOCAL.x + m[5] * FWD_LOCAL.y + m[9] * FWD_LOCAL.z;
  _d.z = m[2] * FWD_LOCAL.x + m[6] * FWD_LOCAL.y + m[10] * FWD_LOCAL.z;
  norm3(_d);
  return {
    origin: { x: _o.x, y: _o.y, z: _o.z },
    dir: { x: _d.x, y: _d.y, z: _d.z },
    flyId: f.id,
    color: f.color || '#ff4466',
    key: `${f.id}:${side}`,
  };
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

function rayWallT(ox, oy, dx, dy, R) {
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

function castBeam(beam, liveFlies, arenaR, wallZ) {
  const { origin: o, dir: d, flyId } = beam;
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
    hit = { type: 'floor', t: tf, victimId: null, x: o.x + d.x * tf, y: o.y + d.y * tf, z: 0 };
  }

  const tw = rayWallT(o.x, o.y, d.x, d.y, arenaR);
  if (tw != null && tw < bestT) {
    const x = o.x + d.x * tw, y = o.y + d.y * tw;
    const z = Math.max(0, Math.min(wallZ, o.z + d.z * tw));
    bestT = tw;
    hit = { type: 'wall', t: tw, victimId: null, x, y, z };
  }

  _end.x = o.x + d.x * bestT;
  _end.y = o.y + d.y * bestT;
  _end.z = o.z + d.z * bestT;
  return hit;
}

export function createLaserPool(T, maxBeams = 28) {
  const group = new T.Group();
  group.name = 'chaosLasers';
  const beams = [];
  const geom = new T.CylinderGeometry(1, 1, 1, 6, 1, true);
  geom.translate(0, 0.5, 0);
  geom.rotateX(Math.PI / 2);
  const axis = new T.Vector3(0, 0, 1);
  const mid = new T.Vector3();
  const dir = new T.Vector3();
  const q = new T.Quaternion();
  for (let i = 0; i < maxBeams; i++) {
    const sheath = new T.Mesh(geom, new T.MeshBasicMaterial({
      color: '#ff6688', transparent: true, opacity: 0.38, depthWrite: false,
      blending: T.AdditiveBlending, toneMapped: false,
    }));
    sheath.renderOrder = 7;
    const core = new T.Mesh(geom, new T.MeshBasicMaterial({
      color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false,
      blending: T.AdditiveBlending, toneMapped: false,
    }));
    core.renderOrder = 8;
    sheath.scale.set(0.028, 0.028, 1);
    core.scale.set(0.012, 0.012, 1);
    sheath.visible = core.visible = false;
    group.add(sheath, core);
    beams.push({ sheath, core });
  }
  return { group, beams, geom, axis, mid, dir, q };
}

function placeBeam(pool, slot, ax, ay, az, bx, by, bz) {
  const { axis, mid, dir, q } = pool;
  const { sheath, core } = slot;
  dir.set(bx - ax, by - ay, bz - az);
  const len = dir.length();
  if (len < 0.02) {
    sheath.visible = core.visible = false;
    return;
  }
  mid.set((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
  dir.normalize();
  q.setFromUnitVectors(axis, dir);
  sheath.position.copy(mid);
  sheath.quaternion.copy(q);
  sheath.scale.set(0.028, 0.028, len);
  sheath.visible = true;
  core.position.copy(mid);
  core.quaternion.copy(q);
  core.scale.set(0.012, 0.012, len);
  core.visible = true;
}

export function hideLaserPool(pool) {
  if (!pool) return;
  for (const b of pool.beams) {
    b.sheath.visible = false;
    b.core.visible = false;
  }
}

export function tickLaserBeams(pool, liveFlies, arena, nowMs, lastBurn, callbacks) {
  let i = 0;
  for (const f of liveFlies) {
    if (!f.bodies?.head) continue;
    for (const side of ['L', 'R']) {
      const beam = eyeBeamFromFly(f, side);
      if (!beam || i >= pool.beams.length) continue;
      const hit = castBeam(beam, liveFlies, arena.radius, arena.wallHeight ?? 8);
      const slot = pool.beams[i++];
      slot.sheath.material.color.set(beam.color);
      const o = beam.origin;
      placeBeam(pool, slot, o.x, o.y, o.z, _end.x, _end.y, _end.z);

      if (hit.type === 'fly' && callbacks.physics && hit.victimId != null) {
        callbacks.onFlyHit?.(hit.victimId);
      }
      const burnable = hit.type === 'floor' || hit.type === 'wall' || hit.type === 'fly';
      if (burnable) {
        const prev = lastBurn.get(beam.key) || 0;
        if (nowMs - prev >= BURN_INTERVAL_MS) {
          lastBurn.set(beam.key, nowMs);
          callbacks.onBurn?.(hit.x, hit.y, hit.type);
        }
      }
    }
  }
  for (; i < pool.beams.length; i++) {
    pool.beams[i].sheath.visible = false;
    pool.beams[i].core.visible = false;
  }
}

export function disposeLaserPool(pool) {
  if (!pool) return;
  pool.group.parent?.remove(pool.group);
  pool.geom.dispose();
  for (const b of pool.beams) {
    b.sheath.material.dispose();
    b.core.material.dispose();
  }
}

export function laserSessionDuration() {
  return 5000 + Math.random() * 5000;
}
