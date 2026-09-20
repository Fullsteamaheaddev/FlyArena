// One live match room: a host publishes snapshots, watchers only receive them.
// If DEPLOYER_KEY is set, this process is the RacePool operator (open/lock/settle).
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { WebSocketServer } from 'ws';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const name of ['.env', '.env.local']) {
  const p = join(root, name);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1].trim();
    if (process.env[k]) continue;
    process.env[k] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const PORT = Number(process.env.MATCH_PORT || 8787);
const deployed = require('../contracts/deployments/46630.json');
const poolAbi = require('../src/abi/RacePool.json');
const POOL = process.env.VITE_POOL || deployed.pool;
const RPC = process.env.VITE_RPC || process.env.ROBINHOOD_TESTNET_RPC || 'https://rpc.testnet.chain.robinhood.com';
const KEY = process.env.DEPLOYER_KEY || '';
const pool = KEY && POOL
  ? new Contract(POOL, poolAbi, new Wallet(KEY, new JsonRpcProvider(RPC)))
  : null;

const idle = () => ({
  type: 'state',
  matchId: null,
  phase: 'idle',
  clock: { wall: '0.0 s', fly: '0.0' },
  bodyNames: null,
  flies: [],
  flyIds: [],
  winner: null,
  resetIn: null,
});

const wss = new WebSocketServer({ host: '0.0.0.0', port: PORT });
let host = null, lastState = idle();
let poolBusy = false, poolWant = null, poolState = null;

function dbg(location, message, data, hypothesisId = 'C') {
  // #region agent log
  fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6b97f7' },
    body: JSON.stringify({ sessionId: '6b97f7', runId: 'post-fix', location, message, data, timestamp: Date.now(), hypothesisId }),
  }).catch(() => {});
  // #endregion
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
}
function broadcast(msg, skip) {
  const packed = typeof msg === 'string' ? msg : JSON.stringify(msg);
  for (const c of wss.clients) if (c !== skip && c.readyState === 1) c.send(packed);
}

function flyIdsOf(st) {
  if (st.flyIds?.length) return st.flyIds.map(Number);
  return (st.flies || []).map(f => Number(f.id)).filter(n => Number.isFinite(n));
}

// Every client (host included) learns the on-chain status, so the bet window can start
// when betting really opens and Claim can appear the moment a race settles.
function publishPool(matchId, status, winnerFly = null) {
  if (poolState && poolState.matchId === matchId && poolState.status === status) return;
  poolState = { type: 'pool', matchId, status, winnerFly };
  broadcast(poolState);
  dbg('match-relay:publishPool', 'pool status', { matchId, status, winnerFly }, 'H');
}

// Explicit gas limits skip an eth_estimateGas round trip on every operator call.
const GAS = { open: 500000, lock: 120000, settle: 200000 };

async function poolTx(label, matchId, call) {
  const t0 = Date.now();
  const tx = await call();
  const sent = Date.now();
  const rec = await tx.wait();
  dbg(`match-relay:${label}`, 'tx done', {
    matchId, sendMs: sent - t0, mineMs: Date.now() - sent, block: rec.blockNumber, hash: rec.hash.slice(0, 12),
  }, 'J');
  return rec;
}

async function syncPool(st) {
  if (!pool || !st?.matchId || st.phase === 'idle') return;
  const ids = flyIdsOf(st);
  // Our own published status is the cache: without it every host snapshot cost an RPC read.
  let status = poolState?.matchId === st.matchId ? poolState.status : null;
  if (status == null) {
    const t0 = Date.now();
    const info = await pool.raceInfo(st.matchId);
    status = Number(info.status);
    dbg('match-relay:read', 'raceInfo', { matchId: st.matchId, status, ms: Date.now() - t0 }, 'J');
    publishPool(st.matchId, status, Number(info.winnerFly));
  }
  if (st.phase === 'lobby') {
    if (status !== 0 || ids.length < 3) return;
    await poolTx('openRace', st.matchId, () => pool.openRace(st.matchId, ids, { gasLimit: GAS.open }));
    publishPool(st.matchId, 1);
    return;
  }
  if (st.phase === 'live') {
    if (status !== 1) return;
    await poolTx('lockRace', st.matchId, () => pool.lockRace(st.matchId, { gasLimit: GAS.lock }));
    publishPool(st.matchId, 2);
    return;
  }
  if (st.phase === 'results' && st.winner?.id != null) {
    if (status === 1) {
      await poolTx('lockRace', st.matchId, () => pool.lockRace(st.matchId, { gasLimit: GAS.lock }));
      publishPool(st.matchId, 2);
      status = 2;
    }
    if (status !== 2) return;
    await poolTx('settle', st.matchId, () => pool.settle(st.matchId, st.winner.id, { gasLimit: GAS.settle }));
    publishPool(st.matchId, 3, Number(st.winner.id));
  }
}

function queuePool(st) {
  poolWant = st;
  kickPool();
}
async function kickPool() {
  if (poolBusy || !poolWant) return;
  poolBusy = true;
  const st = poolWant;
  poolWant = null;
  try { await syncPool(st); }
  catch (e) {
    dbg('match-relay:syncPool', 'pool error', { phase: st?.phase, matchId: st?.matchId, err: e?.shortMessage || e?.reason || e?.message || String(e) });
    console.warn('pool', e?.shortMessage || e?.message || e);
  }
  finally {
    poolBusy = false;
    if (poolWant) kickPool();
  }
}

wss.on('connection', ws => {
  ws.role = null;
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'hello') {
      if (msg.role === 'host') {
        if (host && host !== ws && host.readyState === 1) {
          send(ws, { type: 'error', error: 'host-taken' });
          return;
        }
        host = ws;
        ws.role = 'host';
        send(ws, { type: 'hello-ok', role: 'host' });
        return;
      }
      ws.role = 'watch';
      send(ws, { type: 'hello-ok', role: 'watch' });
      send(ws, lastState);
      if (poolState && poolState.matchId === lastState.matchId) send(ws, poolState);
      return;
    }
    // #region agent log
    if (msg.type === 'log') {
      dbg(msg.location || 'client', msg.message || 'client log', { role: ws.role, ...msg.data }, msg.hypothesisId || 'C');
      return;
    }
    // #endregion
    if (ws.role !== 'host' || msg.type !== 'state') return;
    lastState = msg;
    broadcast(msg, ws);
    queuePool(msg);
  });
  ws.on('close', () => {
    if (ws !== host) return;
    host = null;
    lastState = idle();
    broadcast(lastState);
  });
});

console.log(`match relay ws://0.0.0.0:${PORT}` + (pool ? ' · pool operator on' : ' · pool operator off (no DEPLOYER_KEY)'));
dbg('match-relay:boot', 'relay start', { port: PORT, operator: !!pool, pool: POOL ? String(POOL).slice(0, 10) : null });
