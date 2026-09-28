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

const PORT = Number(process.env.PORT || process.env.MATCH_PORT || 8787);
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
let poolBusy = false, poolWant = null, poolState = null, poolErr = null;

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
  poolErr = null;
  broadcast(poolState);
}
// An operator that cannot transact (no gas, bad key, RPC down) would otherwise leave every client
// waiting out the open/settle grace timers, so say so instead of going quiet.
function publishPoolError(matchId, reason) {
  if (poolErr?.matchId === matchId && poolErr.reason === reason) return;
  poolErr = { matchId, reason };
  broadcast({ type: 'pool', matchId, status: poolState?.matchId === matchId ? poolState.status : null, winnerFly: poolState?.winnerFly ?? null, opError: reason });
}

// Explicit gas limits skip an eth_estimateGas round trip on every operator call.
const GAS = { open: 500000, lock: 120000, settle: 200000 };

async function poolTx(label, matchId, call) {
  const tx = await call();
  return await tx.wait();
}

async function syncPool(st) {
  if (!pool || !st?.matchId || st.phase === 'idle') return;
  const ids = flyIdsOf(st);
  // Our own published status is the cache: without it every host snapshot cost an RPC read.
  let status = poolState?.matchId === st.matchId ? poolState.status : null;
  if (status == null) {
    const info = await pool.raceInfo(st.matchId);
    status = Number(info.status);
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
    const reason = String(e?.shortMessage || e?.message || e);
    console.warn('pool', reason);
    if (st.matchId) publishPoolError(st.matchId, reason);
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
      if (poolErr && poolErr.matchId === lastState.matchId) send(ws, { type: 'pool', matchId: poolErr.matchId, status: poolState?.matchId === poolErr.matchId ? poolState.status : null, winnerFly: null, opError: poolErr.reason });
      return;
    }
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
