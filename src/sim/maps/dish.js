// Sugar Run dish map: render-only grass clumps on the circular plate (physics unchanged).

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

/** Render-only reed instances (tall grass); no colliders. */
export function dishGrassProps() {
  const props = [];
  const r = rng(90210);
  const clumps = 11;
  for (let c = 0; c < clumps; c++) {
    let a = r() * Math.PI * 2;
    for (let try_ = 0; try_ < 8 && nearSpawn(a); try_++) a = r() * Math.PI * 2;
    const rad = 4.8 + r() * 4.5;
    if (rad < 1.3) continue;
    const cx = rad * Math.cos(a), cy = rad * Math.sin(a);
    const n = 5 + Math.floor(r() * 5);
    for (let k = 0; k < n; k++) {
      const j = 0.35 + r() * 0.55;
      const ja = r() * Math.PI * 2;
      props.push({
        kind: 'reed',
        x: round(cx + j * Math.cos(ja)),
        y: round(cy + j * Math.sin(ja)),
        yaw: r() * Math.PI * 2,
        scale: 1.35 + r() * 0.95,
      });
    }
  }
  return props;
}

/** @param {object} raceEnv from PRESETS.race.env() */
export function dishEnv(raceEnv) {
  const env = raceEnv;
  env.map = 'dish';
  env.props = dishGrassProps();
  return env;
}
