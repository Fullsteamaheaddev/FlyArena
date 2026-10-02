// Sugar Run dish map: render-only grass clumps on the circular plate (physics unchanged).

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
  env.props = dishGrassProps();
  return env;
}
