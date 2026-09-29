export function normalizeTickerHref(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^(https?:|mailto:)/i.test(s)) return s;
  return `https://${s}`;
}

export async function fetchSiteTickerUrl() {
  try {
    const r = await fetch('/api/ticker', { cache: 'no-store' });
    if (!r.ok) return '';
    const j = await r.json();
    return normalizeTickerHref(j?.url);
  } catch {
    return '';
  }
}

export async function saveSiteTickerUrl(url) {
  const r = await fetch('/api/ticker', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: String(url || '').trim() }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(t || `Ticker save failed (${r.status})`);
  }
  const j = await r.json().catch(() => ({}));
  return normalizeTickerHref(j?.url);
}
