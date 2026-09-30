// Site-wide Sugar Run map choice: /api/map (Netlify Blobs), localStorage fallback for local dev.
export const RACE_MAP_KEY = 'sugarRunMap';
const KNOWN = ['dish', 'desert'];

export function normalizeMapId(id) {
  const s = String(id || '').trim().toLowerCase();
  return KNOWN.includes(s) ? s : null;
}

export async function fetchSiteMap() {
  try {
    const r = await fetch('/api/map', { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      const id = normalizeMapId(j?.map);
      if (id) return id;
    }
  } catch { /* offline or no functions in dev */ }
  try { return normalizeMapId(localStorage.getItem(RACE_MAP_KEY)) || 'dish'; } catch { return 'dish'; }
}

export async function saveSiteMap(id) {
  const map = normalizeMapId(id);
  if (!map) throw new Error(`Unknown map "${id}"`);
  try { localStorage.setItem(RACE_MAP_KEY, map); } catch { /* private mode */ }
  const r = await fetch('/api/map', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ map }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(t || `Map save failed (${r.status})`);
  }
  const j = await r.json().catch(() => ({}));
  return normalizeMapId(j?.map) || map;
}
