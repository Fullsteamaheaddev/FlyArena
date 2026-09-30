import { getStore } from '@netlify/blobs';

const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const MAPS = ['dish', 'desert'];

function store() {
  return getStore({ name: 'sugar-run', consistency: 'strong' });
}

export default async (req) => {
  if (req.method === 'GET') {
    const map = (await store().get('raceMap')) || 'dish';
    return new Response(JSON.stringify({ map: MAPS.includes(map) ? map : 'dish' }), { headers });
  }
  if (req.method === 'PUT' || req.method === 'POST') {
    let body = {};
    try { body = await req.json(); } catch { body = {}; }
    const map = String(body?.map || '').trim();
    if (!MAPS.includes(map)) return new Response(JSON.stringify({ error: 'unknown map' }), { status: 400, headers });
    await store().set('raceMap', map);
    return new Response(JSON.stringify({ map }), { headers });
  }
  return new Response('Method not allowed', { status: 405, headers });
};

export const config = { path: '/api/map' };
