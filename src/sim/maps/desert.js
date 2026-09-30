// Sugar Run desert map: an 80 x 80 cm walled square with three identical lanes.
// Everything a fly can touch, smell or see is written once in lane-local (d, s) coordinates
// (d out from the centre along the lane, s sideways) and rotated to the three lanes, so the
// race stays fair. Corner dressing is render-only (no MuJoCo geoms, invisible to the eyes).
export const DESERT_HALF = 40;
export const LANE_ANGLES = [90, 210, 330].map(a => a * Math.PI / 180);
export const BETWEEN_ANGLES = [30, 150, 270].map(a => a * Math.PI / 180);
export const SPAWN_D = 30;

const dune = (d, s, r, h) => ({ d, s, r, h });

// --- per-lane features (identical on all three lanes) ---
const LANE = {
  // the outermost blob sits just inside the spawn (as on the dish: 9.2 vs 10.5) so flies start in odor
  trail: [[4, 0.9], [8, 0.82], [12, 0.75], [16, 0.68], [20, 0.61], [24, 0.54], [28.5, 0.47]],
  dunes: [dune(16, 0, 7, 0.9)],
  pools: [{ d: 22, s: 6, r: 2.5 }],
  palms: [{ d: 24, s: 9, h: 6, yaw: 0.4 }, { d: 20, s: 9.5, h: 4.5, yaw: 2.1 }, { d: 23.5, s: 3, h: 5, yaw: 4.0 }],
  cacti: [{ d: 27, s: -4, h: 1.8 }, { d: 18, s: -8, h: 1.4 }],
  rocks: [
    { d: 13, s: 4, r: 0.8, h: 0.9, collide: true }, { d: 7, s: 3.5, r: 0.6, h: 0.7, collide: true },
    { d: 26, s: -7, r: 0.5, h: 0.5, collide: true }, { d: 21, s: -3, r: 0.25, h: 0.2 },
    { d: 9, s: -3.2, r: 0.2, h: 0.15 }, { d: 29, s: 5, r: 0.3, h: 0.25 },
  ],
  arch: { d: 10, s: -5, w: 3, h: 2.5 },
  pillars: [{ d: 8, s: -6.5, h: 1.2 }, { d: 12, s: -6, h: 0.8 }],
};

// --- between-lane features (identical at 30 / 150 / 270 deg) ---
const BETWEEN = {
  dunes: [dune(20, 0, 9, 1.5)],
  pyramid: { d: 31, base: 6, h: 4 },
  obelisks: [{ d: 26, s: 4, h: 5 }, { d: 26, s: -4, h: 5 }],
};

function frame(a) {
  const ux = Math.cos(a), uy = Math.sin(a);
  return { a, ux, uy, nx: -uy, ny: ux, at: (d, s) => [d * ux + s * -uy, d * uy + s * ux] };
}
const round = v => Math.round(v * 1e4) / 1e4;

export function desertSpots() {
  return LANE_ANGLES.map(a => {
    const f = frame(a), [x, y] = f.at(SPAWN_D, 0);
    return { pos: [round(x), round(y)], yaw: a + Math.PI, sex: 'm' };
  });
}

function duneGeom(x, y, r, h) {
  const Rs = (r * r + h * h) / (2 * h);
  return { x: round(x), y: round(y), r, h, Rs: round(Rs), zc: round(h - Rs) };
}

export function desertEnv(base) {
  const obstacles = [], dunes = [], waterPools = [], canopies = [], props = [], odors = [];
  odors.push({ x: 0, y: 0, odor: 'vinegar', strength: 1, sigma: 1.2 });
  for (const a of LANE_ANGLES) {
    const f = frame(a);
    for (const [d, strength] of LANE.trail) {
      const [x, y] = f.at(d, 0);
      odors.push({ x: round(x), y: round(y), odor: 'vinegar', strength, sigma: 0.9, sigmaAcross: 0.9, sigmaAlong: 3.0 });
    }
    for (const u of LANE.dunes) { const [x, y] = f.at(u.d, u.s); dunes.push(duneGeom(x, y, u.r, u.h)); }
    for (const p of LANE.pools) {
      const [x, y] = f.at(p.d, p.s);
      waterPools.push({ x: round(x), y: round(y), r: p.r, water: 1 });
      for (let k = 0; k < 10; k++) {
        const t = k / 10 * Math.PI * 2 + 0.3, rr = p.r + 0.25 + 0.2 * Math.sin(k * 2.7);
        props.push({ kind: 'reed', x: round(x + rr * Math.cos(t)), y: round(y + rr * Math.sin(t)), yaw: t, scale: 0.8 + 0.3 * Math.abs(Math.sin(k * 1.9)) });
      }
      props.push({ kind: 'lilypad', x: round(x + 0.7), y: round(y - 0.4), yaw: 0.6, scale: 1 });
      props.push({ kind: 'lilypad', x: round(x - 0.9), y: round(y + 0.6), yaw: 2.2, scale: 0.8 });
    }
    for (const p of LANE.palms) {
      const [x, y] = f.at(p.d, p.s);
      obstacles.push({ type: 'cyl', x: round(x), y: round(y), r: 0.3, sz: round(p.h * 0.7), collider: true });
      canopies.push({ x: round(x), y: round(y), z: round(p.h * 0.95), r: round(p.h * 0.28) });
      props.push({ kind: 'palm', x: round(x), y: round(y), yaw: a + p.yaw, h: p.h });
    }
    for (const c of LANE.cacti) {
      const [x, y] = f.at(c.d, c.s);
      obstacles.push({ type: 'cyl', x: round(x), y: round(y), r: 0.25, sz: c.h, collider: true });
      props.push({ kind: 'cactus', x: round(x), y: round(y), yaw: a, h: c.h });
    }
    LANE.rocks.forEach((r, i) => {
      const [x, y] = f.at(r.d, r.s);
      if (r.collide) obstacles.push({ type: 'cyl', x: round(x), y: round(y), r: r.r, sz: r.h, collider: true });
      props.push({ kind: r.collide ? `rock_${'abc'[i % 3]}` : 'pebble', x: round(x), y: round(y), yaw: a + i * 1.3, r: r.r, h: r.h });
    });
    {
      const ar = LANE.arch;
      for (const side of [-1, 1]) {
        const [x, y] = f.at(ar.d + side * (ar.w / 2 - 0.3), ar.s);
        obstacles.push({ type: 'box', x: round(x), y: round(y), sx: 0.3, sy: 0.35, sz: ar.h, yaw: round(a), collider: true });
      }
      const [x, y] = f.at(ar.d, ar.s);
      props.push({ kind: 'arch', x: round(x), y: round(y), yaw: a, w: ar.w, h: ar.h });
    }
    for (const p of LANE.pillars) {
      const [x, y] = f.at(p.d, p.s);
      obstacles.push({ type: 'cyl', x: round(x), y: round(y), r: 0.35, sz: p.h, collider: true });
      props.push({ kind: 'pillar_broken', x: round(x), y: round(y), yaw: a + p.d, h: p.h });
    }
  }
  for (const a of BETWEEN_ANGLES) {
    const f = frame(a);
    for (const u of BETWEEN.dunes) { const [x, y] = f.at(u.d, u.s); dunes.push(duneGeom(x, y, u.r, u.h)); }
    {
      const p = BETWEEN.pyramid, [x, y] = f.at(p.d, 0);
      [[1, 1 / 3], [2 / 3, 2 / 3], [1 / 3, 1]].forEach(([w, hz]) => {
        obstacles.push({ type: 'box', x: round(x), y: round(y), sx: round(p.base / 2 * w), sy: round(p.base / 2 * w), sz: round(p.h * hz), yaw: round(a), collider: true });
      });
      props.push({ kind: 'pyramid', x: round(x), y: round(y), yaw: a, base: p.base, h: p.h });
    }
    for (const o of BETWEEN.obelisks) {
      const [x, y] = f.at(o.d, o.s);
      obstacles.push({ type: 'box', x: round(x), y: round(y), sx: 0.3, sy: 0.3, sz: o.h, yaw: round(a), collider: true });
      props.push({ kind: 'obelisk', x: round(x), y: round(y), yaw: a, h: o.h });
    }
  }
  // corner dressing: render-only, mirrored on both axes
  for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    const cx = 35 * sx, cy = 35 * sy, yaw = Math.atan2(sy, sx);
    props.push({ kind: 'rock_a', x: cx, y: cy, yaw, r: 1.6, h: 1.6, deco: true });
    props.push({ kind: 'rock_b', x: cx - 2.2 * sx, y: cy + 0.4 * sy, yaw: yaw + 1, r: 1, h: 1, deco: true });
    props.push({ kind: 'palm', x: cx - 1.2 * sx, y: cy - 2.8 * sy, yaw: yaw + 2, h: 5.5, deco: true });
    props.push({ kind: 'palm', x: cx - 3.4 * sx, y: cy - 0.6 * sy, yaw: yaw + 3.4, h: 4, deco: true });
    props.push({ kind: 'block', x: cx + 0.8 * sx, y: cy - 3.6 * sy, yaw: yaw + 0.3, h: 0.8, deco: true });
    props.push({ kind: 'skull', x: cx - 3.2 * sx, y: cy - 3.2 * sy, yaw: yaw + 0.8, h: 0.5, deco: true });
  }
  return {
    ...structuredClone(base),
    map: 'desert',
    arena: { shape: 'square', half: DESERT_HALF, radius: DESERT_HALF, wallHeight: 3, clipHeight: 8, segments: 4, wallFriction: 1 },
    hazards: [],
    bitterPatches: [],
    food: [{ x: 0, y: 0, r: 0.5, sugar: 1, bitter: 0, water: 0.2, amount: 8 }],
    windRadial: 6,
    hungryForage: true,
    showOdor: true,
    odors,
    obstacles,
    dunes,
    waterPools,
    canopies,
    props,
  };
}
