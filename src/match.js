export function isWatchPath() {
  const p = location.pathname.replace(/\/+$/, '');
  return /(?:^|\/)watch(?:\.html)?$/.test(p);
}

export function matchRole() {
  const q = new URLSearchParams(location.search);
  if (q.get('watch') === '1' || isWatchPath()) return 'watch';
  if (q.get('host') === '1') return 'host';
  return null;
}

export function matchUrl() {
  if (import.meta.env.VITE_MATCH_URL) return import.meta.env.VITE_MATCH_URL;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.hostname}:8787`;
}

function dbg(hypothesisId, location, message, data) {
  // #region agent log
  fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '6b97f7' }, body: JSON.stringify({ sessionId: '6b97f7', hypothesisId, location, message, data, timestamp: Date.now() }) }).catch(() => {});
  // #endregion
}

export function createMatchLink({ role, onState, onStatus }) {
  let ws, alive = true, timer = null, lastMsgLog = 0, skipLogged = false;
  function connect() {
    if (!alive) return;
    const url = matchUrl();
    // #region agent log
    dbg('B', 'match.js:connect', 'ws connecting', { role, url, href: location.href });
    // #endregion
    try { ws = new WebSocket(url); }
    catch (err) {
      // #region agent log
      dbg('B', 'match.js:connect', 'ws construct failed', { role, url, err: String(err) });
      // #endregion
      onStatus?.('offline'); timer = setTimeout(connect, 1500); return;
    }
    ws.onopen = () => {
      // #region agent log
      dbg('B', 'match.js:onopen', 'ws open, sending hello', { role, url });
      // #endregion
      ws.send(JSON.stringify({ type: 'hello', role }));
      onStatus?.('live');
    };
    ws.onmessage = e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      const now = Date.now();
      if (msg.type !== 'state' || now - lastMsgLog > 2000) {
        lastMsgLog = now;
        // #region agent log
        dbg('D', 'match.js:onmessage', 'ws message', { role, type: msg.type, phase: msg.phase, flies: msg.flies?.length, bodyNames: msg.bodyNames?.length, error: msg.error, hasOnState: !!onState });
        // #endregion
      }
      if (msg.type === 'state') onState?.(msg);
      if (msg.type === 'error') onStatus?.(msg.error);
    };
    ws.onclose = ev => {
      // #region agent log
      dbg('B', 'match.js:onclose', 'ws closed', { role, code: ev.code, reason: ev.reason });
      // #endregion
      onStatus?.('offline');
      if (alive) timer = setTimeout(connect, 1500);
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  connect();
  return {
    sendState(state) {
      const ready = ws?.readyState;
      if (ready !== 1) {
        if (!skipLogged) {
          skipLogged = true;
          // #region agent log
          dbg('C', 'match.js:sendState', 'skip send, socket not open', { ready, phase: state?.phase, flies: state?.flies?.length });
          // #endregion
        }
        return;
      }
      skipLogged = false;
      ws.send(JSON.stringify(state));
      const nowSend = Date.now();
      if (nowSend - lastMsgLog > 2000) {
        lastMsgLog = nowSend;
        // #region agent log
        dbg('C', 'match.js:sendState', 'sent state', { role, phase: state?.phase, flies: state?.flies?.length, matchId: state?.matchId });
        // #endregion
      }
    },
    close() {
      alive = false;
      clearTimeout(timer);
      try { ws?.close(); } catch {}
    },
  };
}

export function packAct(f32) {
  if (!f32 || !f32.length) return null;
  const u8 = new Uint8Array(f32.length);
  for (let i = 0; i < f32.length; i++) u8[i] = Math.min(255, f32[i] * 160);
  let s = '';
  for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768));
  return btoa(s);
}
export function unpackAct(b64, dest) {
  if (!b64 || !dest) return false;
  const bin = atob(b64);
  if (bin.length !== dest.length) return false;
  for (let i = 0; i < dest.length; i++) dest[i] = bin.charCodeAt(i) / 160;
  return true;
}

export function buildMatchState({ matchId, phase, flies, clock, winner, bodyNames, resetIn, why, selected, eyes, groups, act }) {
  return {
    type: 'state',
    matchId,
    phase,
    clock,
    bodyNames: bodyNames || null,
    resetIn: resetIn ?? null,
    winner: winner ? { id: winner.id, name: winner.name, color: winner.color, why: why || null } : null,
    selected: selected ?? null,
    eyes: eyes || null,
    groups: groups || null,
    act: act || null,
    flies: flies.filter(f => f.last).map(f => ({
      id: f.id,
      name: f.name,
      color: f.color,
      sex: f.sex,
      t: f.last.t,
      pos: f.last.pos ? Array.from(f.last.pos) : [0, 0, 0],
      yaw: f.last.yaw || 0,
      xpos: f.last.xpos ? Array.from(f.last.xpos) : [],
      xquat: f.last.xquat ? Array.from(f.last.xquat) : [],
      alive: f.last.alive,
      energy: f.last.energy,
      health: f.last.health,
      flying: !!f.last.flying,
      cmd: f.last.cmd || null,
      behavior: f.last.behavior || '',
    })),
  };
}
