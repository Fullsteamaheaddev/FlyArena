// Visual/audio wind for Sugar Run maps: a deterministic function of the match clock, so the host
// and every watcher sway the same palms and hear the same gusts without extra network traffic.
// It never touches physics (windRadial / the GUST chaos push are separate).

const GUST_WINDOW = 12, GUST_RISE = 0.8, GUST_FALL = 2.5, GUST_AMP = 0.6;

function hash(n) {
  let x = (n | 0) * 374761393 + 668265263;
  x = (x ^ (x >>> 13)) * 1274126177;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function gustsIn(w) {
  const n = Math.floor(hash(w * 3 + 1) * 3);   // 0..2 gusts in this window
  const out = [];
  for (let k = 0; k < n; k++) out.push(w * GUST_WINDOW + hash(w * 7 + k * 13 + 5) * GUST_WINDOW);
  return out;
}

function gustShape(dt) {
  if (dt < 0) return 0;
  if (dt < GUST_RISE) return dt / GUST_RISE;
  return Math.max(0, 1 - (dt - GUST_RISE) / GUST_FALL);
}

const HAWK_PERIOD = 55, HAWK_DUR = 11;

/** A hawk crosses the sky once per period: straight line through the map, shadow only. */
export function hawkAt(t) {
  const n = Math.floor(t / HAWK_PERIOD), u = (t - n * HAWK_PERIOD) / HAWK_DUR;
  if (u < 0 || u > 1) return { active: false, n };
  const a = hash(n * 11 + 3) * Math.PI * 2, off = (hash(n * 5 + 9) - 0.5) * 30;
  const dx = Math.cos(a), dy = Math.sin(a), s = (u - 0.5) * 110;
  return { active: true, n, u, x: dx * s - dy * off, y: dy * s + dx * off, yaw: a };
}

/**
 * @param {number} t seconds on the shared clock
 * @param {{ boost?: number, dirX?: number, dirY?: number }} [chaos] active GUST chaos
 * @returns {{ strength: number, gust: number, dirX: number, dirY: number }}
 */
export function windField(t, chaos = null) {
  const base = 0.35 + 0.15 * Math.sin(2 * Math.PI * t / 7) + 0.10 * Math.sin(2 * Math.PI * t / 2.9 + 1.3);
  const w = Math.floor(t / GUST_WINDOW);
  let gust = 0;
  for (const ww of [w - 1, w]) for (const t0 of gustsIn(ww)) gust = Math.max(gust, gustShape(t - t0));
  gust *= GUST_AMP;
  const boost = chaos?.boost || 0;
  let a = 0.35 + 0.25 * Math.sin(2 * Math.PI * t / 23);
  let dx = Math.cos(a), dy = Math.sin(a);
  if (boost > 0 && (chaos.dirX || chaos.dirY)) {
    const k = Math.min(1, boost), cl = Math.hypot(chaos.dirX, chaos.dirY) || 1;
    dx = dx * (1 - k) + chaos.dirX / cl * k; dy = dy * (1 - k) + chaos.dirY / cl * k;
    const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n;
  }
  return { strength: Math.min(2, Math.max(0, base + gust + boost)), gust, dirX: dx, dirY: dy };
}
