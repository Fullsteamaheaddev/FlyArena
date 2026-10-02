/** In-game instance scale for desert map props (shared by race-map-desert + prop studio). */
export function propScale(p) {
  const s = p.scale ?? 1;
  switch (p.kind) {
    case 'pyramid': return [p.base, p.base, p.h * 1.5];
    case 'arch': return [p.w, p.w, p.h * 1.2];
    case 'pillar_broken': return [1.17, 1.17, p.h];
    case 'rock_a': case 'rock_b': case 'rock_c': case 'pebble': return [p.r, p.r, p.h];
    case 'reed': case 'grass': return [1.2 * s, 1.2 * s, 1.2 * s];
    case 'doghouse': { const k = (p.h ?? 1.8) / 0.545; return [k, k, k]; }
    case 'lilypad': return [0.45 * s, 0.45 * s, 0.45 * s];
    default: return [p.h * s, p.h * s, p.h * s];
  }
}

/** Representative placement fields for prop-studio in-game scale preview. */
export const DESERT_PREVIEW_PROPS = {
  palm: { kind: 'palm', h: 3.8 },
  pyramid: { kind: 'pyramid', base: 4.2, h: 2.7 },
  obelisk: { kind: 'obelisk', h: 3.2 },
  arch: { kind: 'arch', w: 2.1, h: 1.7 },
  pillar_broken: { kind: 'pillar_broken', h: 0.8 },
  block: { kind: 'block', h: 0.55 },
  rock_a: { kind: 'rock_a', r: 0.55, h: 0.6 },
  rock_b: { kind: 'rock_b', r: 0.42, h: 0.46 },
  rock_c: { kind: 'rock_c', r: 0.34, h: 0.34 },
  pebble: { kind: 'pebble', r: 0.14, h: 0.1 },
  cactus: { kind: 'cactus', h: 1.15 },
  reed: { kind: 'reed', scale: 1 },
  lilypad: { kind: 'lilypad', scale: 1 },
  skull: { kind: 'skull', h: 0.9 },
  tumbleweed: { kind: 'tumbleweed', h: 1.1 },
};

export const DESERT_MAP_PROP_NAMES = Object.keys(DESERT_PREVIEW_PROPS);
