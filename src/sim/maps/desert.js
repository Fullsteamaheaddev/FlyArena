// Sugar Run desert map: a 50 x 50 cm walled square with three identical lanes, at night.
// Everything a fly can touch, smell or see is written once in lane-local (d, s) coordinates
// (d out from the centre along the lane, s sideways) and rotated to the three lanes, so the
// race stays fair. Corner dressing is render-only (no MuJoCo geoms, invisible to the eyes).
// The floor is flat: no dunes, so groundAt() is 0 everywhere.
export const DESERT_HALF = 25;
export const LANE_ANGLES = [90, 210, 330].map(a => a * Math.PI / 180);
export const BETWEEN_ANGLES = [30, 150, 270].map(a => a * Math.PI / 180);
export const SPAWN_D = 19;

// --- per-lane features (identical on all three lanes) ---
const LANE = {
  // the outermost blob sits just inside the spawn (as on the dish: 9.2 vs 10.5) so flies start in odor
  trail: [[2.5, 0.9], [5, 0.82], [7.5, 0.75], [10, 0.68], [12.5, 0.61], [15, 0.54], [18, 0.47]],
  pools: [{ d: 13.5, s: 3.6, r: 1.7 }],
  palms: [{ d: 15, s: 5.6, h: 3.8, yaw: 0.4 }, { d: 12.5, s: 6, h: 2.9, yaw: 2.1 }, { d: 14.5, s: 1.9, h: 3.2, yaw: 4.0 }],
  cacti: [{ d: 17, s: -2.5, h: 1.15 }, { d: 11.5, s: -5, h: 0.9 }],
  rocks: [
    { d: 8.2, s: 2.5, r: 0.55, h: 0.6, collide: true }, { d: 4.4, s: 2.2, r: 0.42, h: 0.46, collide: true },
    { d: 16.3, s: -4.4, r: 0.34, h: 0.34, collide: true }, { d: 13.1, s: -1.9, r: 0.18, h: 0.14 },
    { d: 5.6, s: -2, r: 0.14, h: 0.1 }, { d: 18.1, s: 3.1, r: 0.2, h: 0.17 },
  ],
  arch: { d: 6.3, s: -3.1, w: 2.1, h: 1.7 },
  pillars: [{ d: 5, s: -4.1, h: 0.8 }, { d: 7.5, s: -3.8, h: 0.55 }],
  // warm night lamps; `light` ones also get a real point light in the renderer
  lamps: [{ d: 10.5, s: 3.2, h: 1.5, light: true }, { d: 17.2, s: -4.2, h: 1.3 }],
};

// --- between-lane features (identical at 30 / 150 / 270 deg) ---
const BETWEEN = {
  pyramid: { d: 19.6, base: 4.2, h: 2.7 },
  obelisks: [{ d: 16.3, s: 2.5, h: 3.2 }, { d: 16.3, s: -2.5, h: 3.2 }],
  lamps: [{ d: 4.6, h: 1.2, light: true }],
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

export function desertEnv(base) {
  const obstacles = [], waterPools = [], canopies = [], props = [], odors = [], lamps = [];
  odors.push({ x: 0, y: 0, odor: 'vinegar', strength: 1, sigma: 1.2 });
  for (const a of LANE_ANGLES) {
    const f = frame(a);
    for (const [d, strength] of LANE.trail) {
      const [x, y] = f.at(d, 0);
      odors.push({ x: round(x), y: round(y), odor: 'vinegar', strength, sigma: 0.9, sigmaAcross: 0.9, sigmaAlong: 3.0 });
    }
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
    for (const l of LANE.lamps) {
      const [x, y] = f.at(l.d, l.s);
      obstacles.push({ type: 'cyl', x: round(x), y: round(y), r: 0.22, sz: round(l.h * 0.8), collider: true });
      lamps.push({ x: round(x), y: round(y), h: l.h, light: !!l.light });
    }
  }
  for (const a of BETWEEN_ANGLES) {
    const f = frame(a);
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
    for (const l of BETWEEN.lamps) {
      const [x, y] = f.at(l.d, 0);
      obstacles.push({ type: 'cyl', x: round(x), y: round(y), r: 0.2, sz: round(l.h * 0.8), collider: true });
      lamps.push({ x: round(x), y: round(y), h: l.h, light: !!l.light });
    }
  }
  // corner dressing: render-only, mirrored on both axes
  for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    const cx = 21.5 * sx, cy = 21.5 * sy, yaw = Math.atan2(sy, sx);
    props.push({ kind: 'rock_a', x: cx, y: cy, yaw, r: 1.1, h: 1.1, deco: true });
    props.push({ kind: 'rock_b', x: cx - 1.5 * sx, y: cy + 0.3 * sy, yaw: yaw + 1, r: 0.7, h: 0.7, deco: true });
    props.push({ kind: 'palm', x: cx - 0.8 * sx, y: cy - 1.9 * sy, yaw: yaw + 2, h: 3.6, deco: true });
    props.push({ kind: 'palm', x: cx - 2.3 * sx, y: cy - 0.4 * sy, yaw: yaw + 3.4, h: 2.7, deco: true });
    props.push({ kind: 'block', x: cx + 0.6 * sx, y: cy - 2.4 * sy, yaw: yaw + 0.3, h: 0.55, deco: true });
    props.push({ kind: 'skull', x: cx - 2.1 * sx, y: cy - 2.1 * sy, yaw: yaw + 0.8, h: 0.35, deco: true });
    lamps.push({ x: cx - 1.1 * sx, y: cy - 1.1 * sy, h: 1.1, light: false });
  }
  return {
    ...structuredClone(base),
    map: 'desert',
    arena: { shape: 'square', half: DESERT_HALF, radius: DESERT_HALF, wallHeight: 2.4, clipHeight: 8, segments: 4, wallFriction: 1 },
    hazards: [],
    bitterPatches: [],
    food: [{ x: 0, y: 0, r: 0.62, winR: 0.5, sugar: 1, bitter: 0, water: 0.2, amount: 8, hiddenDisc: true }],
    windRadial: 6,
    hungryForage: true,
    showOdor: true,
    odors,
    obstacles,
    dunes: [],
    waterPools,
    canopies,
    props,
    lamps,
  };
}
