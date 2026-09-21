export function isWatchPath() {
  const p = location.pathname.replace(/\/+$/, '') || '/';
  if (p === '/' || p.endsWith('/index.html')) return true;
  return /(?:^|\/)watch(?:\.html)?$/.test(p);
}

export function isRaceHostPath() {
  const p = location.pathname.replace(/\/+$/, '') || '/';
  return /(?:^|\/)racehost(?:\.html)?$/.test(p);
}

export function matchRole() {
  const q = new URLSearchParams(location.search);
  if (q.get('watch') === '1' || isWatchPath()) return 'watch';
  if (q.get('host') === '1' || isRaceHostPath()) return 'host';
  return null;
}

export function matchUrl() {
  if (import.meta.env.VITE_MATCH_URL) return import.meta.env.VITE_MATCH_URL;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.hostname}:8787`;
}

export function createMatchLink({ role, onState, onStatus, onPool }) {
  let ws, alive = true, timer = null;
  function connect() {
    if (!alive) return;
    const url = matchUrl();
    try { ws = new WebSocket(url); }
    catch {
      onStatus?.('offline'); timer = setTimeout(connect, 1500); return;
    }
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'hello', role }));
      onStatus?.('live');
    };
    ws.onmessage = e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'state') onState?.(msg);
      if (msg.type === 'pool') onPool?.(msg);
      if (msg.type === 'error') onStatus?.(msg.error);
    };
    ws.onclose = () => {
      onStatus?.('offline');
      if (alive) timer = setTimeout(connect, 1500);
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  connect();
  return {
    sendState(state) {
      if (ws?.readyState !== 1) return;
      ws.send(JSON.stringify(state));
    },
    // #region agent log
    sendLog(payload) {
      if (ws?.readyState !== 1) return false;
      ws.send(JSON.stringify({ type: 'log', ...payload }));
      return true;
    },
    // #endregion
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

export function buildMatchState({ matchId, phase, flies, clock, winner, bodyNames, resetIn, why, selected, eyes, groups, act, betClosesAt, pools }) {
  return {
    type: 'state',
    matchId,
    flyIds: flies.map(f => f.id),
    phase,
    clock,
    bodyNames: bodyNames || null,
    resetIn: resetIn ?? null,
    betClosesAt: betClosesAt ?? null,
    pools: pools || [],
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
      takeoffPending: !!f.last.takeoffPending,
      cmd: f.last.cmd || null,
      behavior: f.last.behavior || '',
    })),
  };
}
