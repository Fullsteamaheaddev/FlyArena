// Sugar Run dish map: render-only grass clumps + three cel-shaded doghouses.

export const DISH_RADIUS = 18.75;          // 12.5 × 1.5
export const DISH_SPAWN_R = 15.75;         // 10.5 × 1.5
const DISH_SCALE = DISH_RADIUS / 12.5;

const SPAWN_ANGLES = [0, 1, 2].map(i => i * 2 * Math.PI / 3);
const round = v => Math.round(v * 1e4) / 1e4;

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

function nearSpawn(a, margin = 0.35) {
  for (const sa of SPAWN_ANGLES) {
    let d = Math.abs(a - sa);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d < margin) return true;
  }
  return false;
}

// grass.glb height is 1 cm after propScale's 1.2×; target ~2× standing fly, read tall from race cam.
const DISH_GRASS_HEIGHT_CM = 0.58;
const GRASS_SCALE_PER_CM = 1 / 1.2;
// doghouse.glb native bbox (Z-up): 0.435 × 0.518 footprint, 0.545 tall.
const DOGHOUSE_NATIVE_H = 0.545;
const DOGHOUSE_NATIVE_HX = 0.2174;
const DOGHOUSE_NATIVE_HY = 0.259;

/** Three huts on open sand — uneven angles/radii, roughly a third of the plate each. */
export function dishDoghouseProps() {
  return [
    { kind: 'doghouse', x: 5.15, y: 8.62, yaw: 0.72, h: 1.74 },
    { kind: 'doghouse', x: -12.05, y: 3.88, yaw: 2.91, h: 1.98 },
    { kind: 'doghouse', x: 1.42, y: -11.35, yaw: 5.08, h: 1.82 },
  ].map(p => ({ ...p, x: round(p.x), y: round(p.y), yaw: round(p.yaw), h: round(p.h) }));
}

function doghouseClearR(p) {
  const s = (p.h ?? 1.8) / DOGHOUSE_NATIVE_H;
  return Math.hypot(DOGHOUSE_NATIVE_HX * s, DOGHOUSE_NATIVE_HY * s) + 0.18;
}

function nearDoghouse(x, y, extra = 0) {
  for (const h of dishDoghouseProps()) {
    const c = doghouseClearR(h) + extra;
    const dx = x - h.x, dy = y - h.y;
    if (dx * dx + dy * dy < c * c) return true;
  }
  return false;
}

function dishDoghouseObstacles() {
  return dishDoghouseProps().map(p => {
    const s = (p.h ?? 1.8) / DOGHOUSE_NATIVE_H;
    return {
      type: 'box',
      x: p.x,
      y: p.y,
      sx: round(DOGHOUSE_NATIVE_HX * s * 0.82),
      sy: round(DOGHOUSE_NATIVE_HY * s * 0.82),
      sz: round(DOGHOUSE_NATIVE_H * s * 0.88),
      yaw: p.yaw,
      collider: true,
    };
  });
}

export function dishSpots() {
  return SPAWN_ANGLES.map(a => ({
    pos: [round(DISH_SPAWN_R * Math.cos(a)), round(DISH_SPAWN_R * Math.sin(a))],
    yaw: a + Math.PI,
    sex: 'm',
  }));
}

/** Render-only grass tufts (blades only); no colliders. */
export function dishGrassProps() {
  const props = [];
  const r = rng(90210);
  const baseScale = DISH_GRASS_HEIGHT_CM * GRASS_SCALE_PER_CM;
  const clumps = 144;
  for (let c = 0; c < clumps; c++) {
    let a = r() * Math.PI * 2;
    for (let try_ = 0; try_ < 8 && nearSpawn(a); try_++) a = r() * Math.PI * 2;
    const rad = 2.4 + r() * 15.3;
    if (rad < 1.4) continue;
    const cx = rad * Math.cos(a), cy = rad * Math.sin(a);
    const n = 26 + Math.floor(r() * 16);
    const patchR = 0.22 + r() * 0.28;
    if (nearDoghouse(cx, cy, patchR)) continue;
    for (let k = 0; k < n; k++) {
      const j = patchR * Math.sqrt(r());
      const ja = r() * Math.PI * 2;
      props.push({
        kind: 'grass',
        x: round(cx + j * Math.cos(ja)),
        y: round(cy + j * Math.sin(ja)),
        yaw: r() * Math.PI * 2,
        scale: round(baseScale * (0.88 + r() * 0.32)),
      });
    }
  }
  return props;
}

/** @param {object} raceEnv from PRESETS.race.env() */
export function dishEnv(raceEnv) {
  const env = raceEnv;
  env.map = 'dish';
  env.arena = { ...env.arena, radius: DISH_RADIUS };
  env.odors = (env.odors || []).map(o => ({
    ...o,
    x: round((o.x || 0) * DISH_SCALE),
    y: round((o.y || 0) * DISH_SCALE),
    ...(o.sigmaAlong ? { sigmaAlong: round(o.sigmaAlong * DISH_SCALE) } : {}),
  }));
  env.props = [...dishGrassProps(), ...dishDoghouseProps()];
  env.obstacles = dishDoghouseObstacles();
  return env;
}
