// Fly-on-fly weapons: tuning table, aiming, hit resolution, tracer pool, held-prop placement.
// Damage spends `health` in the worker (`op: 'damage'`), so weapons wound; only a direct
// rocket hit kills outright. Aim error is the lethality knob — widen it, do not nerf damage.

import { castBeam, hitSolids } from './race-chaos-laser.js';

/**
 * Units are cm / g / s. A fly is a 0.14 cm hit sphere and flies usually duel 10-20 cm
 * apart, so aim error is a lateral offset in **cm at the target**
 * (`jitterBase + jitterPerCm * distance`), never an angle — a few degrees across 15 cm of
 * dish misses every time. Hit chance is about `(0.14 / jitter)^2`, which falls off as the
 * square, so `jitterPerCm` stays small: a cone that widens realistically makes a weapon
 * do nothing at all at normal range, and a weapon that does nothing reads as a bug.
 * Widen the jitter to make a weapon less lethal; leave `damage` alone.
 */
export const WEAPONS = {
  minigun: {
    prop: 'minigun', damage: 0.08, rounds: 14, intervalMs: 148, windupMs: 560,
    jitterBase: 0.2, jitterPerCm: 0.003, knock: 2.2, cause: 'minigun',
  },
  shotgun: {
    prop: 'shotgun', damage: 0.05, pellets: 9,
    jitterBase: 0.1, jitterPerCm: 0.006, knock: 13, cause: 'shotgun',
  },
  taser: {
    prop: 'taser', damage: 0.45, zapMs: 1200, chainR: 1.7, chainChance: 0.1, cause: 'taser',
  },
  bazooka: {
    prop: 'bazooka', killR: 0.4, splashR: 1.55, splashMax: 0.35, splashMin: 0.15,
    knock: 15, speed: 9, cause: 'bazooka',
  },
  missile: {
    prop: 'missile', killR: 0.4, splashR: 1.55, splashMax: 0.35, splashMin: 0.15,
    knock: 15, speed: 7.5, cause: 'missile',
  },
  chicken: {
    prop: 'rubber_chicken', damage: 0, knockR: 2.8, knock: 21, cause: 'chicken',
  },
};

/** Aim error in cm at the aim point: tight up close, sloppy across the dish. */
export function jitterFor(spec, dist) {
  return (spec.jitterBase || 0) + (spec.jitterPerCm || 0) * Math.max(0, dist);
}

function liveWithPos(flies) {
  return flies.filter(f => f.last?.alive !== false && f.last?.pos);
}

/**
 * Shooter plus a victim, preferring someone the shooter is already facing (same rule the
 * holy grenade uses) so the shot reads as aimed rather than random.
 */
export function pickDuel(flies, rand = Math.random) {
  const live = liveWithPos(flies);
  if (!live.length) return { shooter: null, target: null };
  const shooter = live[Math.floor(rand() * live.length)];
  const others = live.filter(f => f !== shooter);
  if (!others.length) return { shooter, target: null };
  const yaw = shooter.last.yaw ?? 0;
  const sp = shooter.last.pos;
  const ahead = others.filter(o =>
    (o.last.pos[0] - sp[0]) * Math.cos(yaw) + (o.last.pos[1] - sp[1]) * Math.sin(yaw) > 0);
  const pool = ahead.length ? ahead : others;
  return { shooter, target: pool[Math.floor(rand() * pool.length)] };
}

/** Nearest live fly to the shooter, used by the short-range weapons. */
export function nearestTarget(flies, shooter) {
  let best = null, bestD = Infinity;
  if (!shooter?.last?.pos) return null;
  const sp = shooter.last.pos;
  for (const f of liveWithPos(flies)) {
    if (f.id === shooter.id) continue;
    const d = Math.hypot(f.last.pos[0] - sp[0], f.last.pos[1] - sp[1]);
    if (d < bestD) { bestD = d; best = f; }
  }
  return best;
}

/** Muzzle point a little ahead of and above the thorax, from sim state (not the render graph). */
export function muzzleOf(f, ahead = 0.17, up = 0.05) {
  const p = f?.last?.pos;
  if (!p) return null;
  const yaw = f.last.yaw ?? 0;
  return {
    x: p[0] + Math.cos(yaw) * ahead,
    y: p[1] + Math.sin(yaw) * ahead,
    z: (p[2] ?? 0.13) + up,
    yaw,
  };
}

/**
 * Unit direction from the muzzle toward `aim`, with the aim point scattered over a disc
 * of radius `jitter` cm perpendicular to the shot. Uniform over the disc, so the chance a
 * round connects is roughly (0.14 / jitter)^2.
 */
export function shotDir(origin, aim, jitter = 0, rand = Math.random) {
  let dx = aim.x - origin.x;
  let dy = aim.y - origin.y;
  let dz = (aim.z ?? origin.z) - origin.z;
  let len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) { dx = 1; dy = 0; dz = 0; len = 1; }
  dx /= len; dy /= len; dz /= len;
  if (jitter > 0) {
    const hr = Math.hypot(dx, dy) || 1;
    const rx = dy / hr, ry = -dx / hr;                     // right, horizontal
    const ux = -ry * dz, uy = rx * dz, uz = rx * dy - ry * dx;   // up = right x dir
    const a = rand() * Math.PI * 2;
    const r = jitter * Math.sqrt(rand());
    const ox = Math.cos(a) * r, oy = Math.sin(a) * r;
    dx = dx * len + rx * ox + ux * oy;
    dy = dy * len + ry * ox + uy * oy;
    dz = dz * len + uz * oy;
    const n = Math.hypot(dx, dy, dz) || 1;
    dx /= n; dy /= n; dz /= n;
  }
  return { x: dx, y: dy, z: dz };
}

/** Ray against flies, floor, wall and desert solids. Returns the laser module's hit shape. */
export function castShot(origin, dir, shooterId, flies, arena, solids) {
  const square = arena?.shape === 'square';
  const extent = square ? (arena.half ?? 25) : (arena?.radius ?? 12.5);
  let hit = castBeam(origin, dir, shooterId, liveWithPos(flies), extent, arena?.wallHeight ?? 8, square);
  return hitSolids(origin, dir, hit, solids);
}

/** Linear falloff from `max` at the centre to `min` at `r`; nothing outside. */
export function splashAmount(dist, r, max, min) {
  if (dist >= r) return 0;
  const k = 1 - dist / r;
  return min + (max - min) * k;
}

/** Point the weapon prop at the fly holding it. Props live in world space, not on the body. */
export function placeHeldProp(mesh, f, { ahead = 0.14, up = 0.03, roll = 0 } = {}) {
  const p = f?.last?.pos;
  if (!mesh || !p) return;
  const yaw = f.last.yaw ?? 0;
  mesh.position.set(p[0] + Math.cos(yaw) * ahead, p[1] + Math.sin(yaw) * ahead, (p[2] ?? 0.13) + up);
  mesh.rotation.set(roll, 0, yaw);
}

/** Pooled tracer segments. Same trick as the laser pool: one geometry, cloned basic materials. */
export function createTracerPool(T, max = 26) {
  const group = new T.Group();
  group.name = 'chaosTracers';
  const geom = new T.CylinderGeometry(1, 1, 1, 6, 1, true);
  geom.rotateX(Math.PI / 2);
  geom.translate(0, 0, 0.5);
  const base = new T.MeshBasicMaterial({
    color: '#ffd978', transparent: true, opacity: 0.9, depthWrite: false,
    blending: T.AdditiveBlending, toneMapped: false,
  });
  const slots = [];
  for (let i = 0; i < max; i++) {
    const mesh = new T.Mesh(geom, base.clone());
    mesh.renderOrder = 7;
    mesh.visible = false;
    group.add(mesh);
    slots.push({ mesh, until: 0, life: 1 });
  }
  base.dispose();
  return { group, slots, geom, next: 0, zAxis: new T.Vector3(0, 0, 1), q: new T.Quaternion(), dir: new T.Vector3(), alt: new T.Vector3(1, 0, 0) };
}

export function fireTracer(pool, T, from, to, { ms = 90, radius = 0.012, color = '#ffd978' } = {}) {
  if (!pool) return;
  const slot = pool.slots[pool.next++ % pool.slots.length];
  const { mesh } = slot;
  const dx = to.x - from.x, dy = to.y - from.y, dz = (to.z ?? 0) - from.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.01) { mesh.visible = false; return; }
  pool.dir.set(dx / len, dy / len, dz / len);
  const dot = pool.zAxis.dot(pool.dir);
  if (dot > 0.9999) mesh.quaternion.identity();
  else if (dot < -0.9999) mesh.quaternion.copy(pool.q.setFromAxisAngle(pool.alt, Math.PI));
  else mesh.quaternion.copy(pool.q.setFromUnitVectors(pool.zAxis, pool.dir));
  mesh.position.set(from.x, from.y, from.z);
  mesh.scale.set(radius, radius, len);
  mesh.material.color.set(color);
  mesh.material.opacity = 0.9;
  mesh.visible = true;
  slot.life = ms;
  slot.until = performance.now() + ms;
}

export function tickTracers(pool, nowMs) {
  if (!pool) return;
  for (const s of pool.slots) {
    if (!s.mesh.visible) continue;
    const left = s.until - nowMs;
    if (left <= 0) { s.mesh.visible = false; continue; }
    s.mesh.material.opacity = 0.9 * Math.max(0, left / s.life);
  }
}

export function hideTracerPool(pool) {
  if (!pool) return;
  for (const s of pool.slots) { s.mesh.visible = false; s.until = 0; }
}

export function disposeTracerPool(pool) {
  if (!pool) return;
  pool.group.parent?.remove(pool.group);
  pool.geom.dispose();
  for (const s of pool.slots) s.mesh.material.dispose();
}
