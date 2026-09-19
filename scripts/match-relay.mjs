// One live match room: a host publishes snapshots, watchers only receive them.
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
const DEBUG_LOG = path.join(process.cwd(), 'debug-6b97f7.log');
function dbg(hypothesisId, location, message, data) {
  try { fs.appendFileSync(DEBUG_LOG, JSON.stringify({ sessionId: '6b97f7', hypothesisId, location, message, data, timestamp: Date.now() }) + '\n'); } catch {}
}

const PORT = Number(process.env.MATCH_PORT || 8787);
const idle = () => ({
  type: 'state',
  matchId: null,
  phase: 'idle',
  clock: { wall: '0.0 s', fly: '0.0' },
  bodyNames: null,
  flies: [],
  winner: null,
  resetIn: null,
});

const wss = new WebSocketServer({ host: '0.0.0.0', port: PORT });
let host = null, lastState = idle(), lastStateLog = 0;

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
}
function broadcast(msg, skip) {
  const packed = typeof msg === 'string' ? msg : JSON.stringify(msg);
  for (const c of wss.clients) if (c !== skip && c.readyState === 1) c.send(packed);
}

wss.on('connection', ws => {
  ws.role = null;
  dbg('B', 'match-relay:connection', 'client connected', { clients: wss.clients.size });
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'hello') {
      dbg('A', 'match-relay:hello', 'hello', { role: msg.role, hasHost: !!(host && host.readyState === 1), lastPhase: lastState.phase });
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
      return;
    }
    if (ws.role !== 'host' || msg.type !== 'state') return;
    lastState = msg;
    const now = Date.now();
    if (now - lastStateLog > 2000) {
      lastStateLog = now;
      dbg('D', 'match-relay:state', 'host state', { phase: msg.phase, flies: msg.flies?.length, bodyNames: msg.bodyNames?.length, watchers: [...wss.clients].filter(c => c.role === 'watch').length, hasEyes: !!msg.eyes, hasGroups: !!msg.groups, hasAct: !!msg.act, selected: msg.selected });
    }
    broadcast(msg, ws);
  });
  ws.on('close', () => {
    if (ws !== host) return;
    host = null;
    lastState = idle();
    broadcast(lastState);
  });
});

console.log(`match relay ws://0.0.0.0:${PORT}`);
