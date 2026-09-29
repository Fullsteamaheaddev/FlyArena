import { getStore } from '@netlify/blobs';

const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };

function store() {
  return getStore({ name: 'sugar-run', consistency: 'strong' });
}

export default async (req) => {
  if (req.method === 'GET') {
    const url = (await store().get('tickerUrl')) || '';
    return new Response(JSON.stringify({ url }), { headers });
  }
  if (req.method === 'PUT' || req.method === 'POST') {
    let body = {};
    try { body = await req.json(); } catch { body = {}; }
    const url = String(body?.url || '').trim();
    await store().set('tickerUrl', url);
    return new Response(JSON.stringify({ url }), { headers });
  }
  return new Response('Method not allowed', { status: 405, headers });
};

export const config = { path: '/api/ticker' };
