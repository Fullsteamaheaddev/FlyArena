// Sugar Run dish map: spawn-ring grass hedge + three cel-shaded doghouses.

export const DISH_RADIUS = 18.75;          // 12.5 × 1.5
export const DISH_SPAWN_R = 15.75;         // 10.5 × 1.5
const DISH_SCALE = DISH_RADIUS / 12.5;

const SPAWN_ANGLES = [0, 1, 2].map(i => i * 2 * Math.PI / 3);
const round = v => Math.round(v * 1e4) / 1e4;

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
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

function nearSpawnPad(x, y, clearR = 1.8) {
  for (const s of dishSpots()) {
    const dx = x - s.pos[0], dy = y - s.pos[1];
    if (dx * dx + dy * dy < clearR * clearR) return true;
  }
  return false;
}

export function dishSpots() {
  return SPAWN_ANGLES.map(a => ({
    pos: [round(DISH_SPAWN_R * Math.cos(a)), round(DISH_SPAWN_R * Math.sin(a))],
    yaw: a + Math.PI,
    sex: 'm',
  }));
}

/** Render-only hedge along the spawn ring; gaps at the three pads. One GLB per tuft. */
export function dishGrassProps() {
  const props = [];
  const r = rng(90210);
  const baseScale = DISH_GRASS_HEIGHT_CM * GRASS_SCALE_PER_CM;
  const ringIn = 15.1, ringOut = 16.5, perRow = 90, rows = 3;
  const rim = DISH_RADIUS - 0.55;
  for (let row = 0; row < rows; row++) {
    const rad0 = ringIn + (row + 0.5) / rows * (ringOut - ringIn);
    const stagger = row * Math.PI / perRow;
    for (let i = 0; i < perRow; i++) {
      const a = i * 2 * Math.PI / perRow + stagger + (r() - 0.5) * 0.01;
      const rad = Math.min(rim, rad0 + (r() - 0.5) * 0.22);
      const x = rad * Math.cos(a), y = rad * Math.sin(a);
      if (nearSpawnPad(x, y, 1.8) || nearDoghouse(x, y, 0.12)) continue;
      props.push({
        kind: 'grass',
        x: round(x),
        y: round(y),
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
