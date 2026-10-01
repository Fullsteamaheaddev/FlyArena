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

export function createMatchLink({ role, onState, onStatus, onPool, secret }) {
  let ws, alive = true, timer = null, paused = false, prefs = null;
  const secretVal = () => (typeof secret === 'function' ? secret() : secret) || '';
  function sendHello() {
    if (ws?.readyState !== 1) return;
    const hello = { type: 'hello', role };
    if (role === 'host') hello.secret = secretVal();
    if (role !== 'host' && prefs) hello.prefs = prefs;
    ws.send(JSON.stringify(hello));
  }
  function sendPrefs() {
    if (role === 'host' || !prefs || ws?.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'prefs', ...prefs }));
  }
  function connect() {
    if (!alive || paused) return;
    const url = matchUrl();
    try { ws = new WebSocket(url); }
    catch {
      onStatus?.('offline'); timer = setTimeout(connect, 1500); return;
    }
    ws.onopen = () => {
      sendHello();
      if (role !== 'host') onStatus?.('live');
    };
    ws.onmessage = e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'hello-ok') {
        onStatus?.('live');
        return;
      }
      if (msg.type === 'state') {
        onState?.(msg);
      }
      if (msg.type === 'pool') onPool?.(msg);
      if (msg.type === 'error') {
        onStatus?.(msg.error);
        if (role === 'host' && msg.error === 'host-auth') {
          paused = true;
          clearTimeout(timer);
          return;
        }
        if (role === 'host' && msg.error === 'host-taken') {
          clearTimeout(timer);
          timer = setTimeout(() => { try { ws?.close(); } catch {} }, 1500);
        }
      }
    };
    ws.onclose = () => {
      onStatus?.('offline');
      if (alive && !paused) timer = setTimeout(connect, 1500);
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  connect();
  return {
    sendState(state) {
      if (ws?.readyState !== 1) return;
      ws.send(JSON.stringify(state));
    },
    close() {
      alive = false;
      paused = true;
      clearTimeout(timer);
      try { ws?.close(); } catch {}
    },
    retry() {
      paused = false;
      clearTimeout(timer);
      if (ws?.readyState === 1) { sendHello(); return; }
      try { ws?.close(); } catch {}
      connect();
    },
    setPrefs(p) {
      prefs = { act: !!p?.act, vision: !!p?.vision };
      sendPrefs();
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
function packBytes(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768));
  return btoa(s);
}
export function packEyes(eyes) {
  if (!eyes) return null;
  return eyes.map(lum => {
    const u8 = new Uint8Array(lum.length);
    for (let i = 0; i < lum.length; i++) u8[i] = Math.min(255, Math.round(Math.max(0, lum[i] || 0) * 255));
    return packBytes(u8);
  });
}
export function unpackEyes(packed) {
  if (!Array.isArray(packed) || typeof packed[0] !== 'string') return packed;
  return packed.map(b64 => {
    const bin = atob(b64);
    const out = new Float32Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) / 255;
    return out;
  });
}

const rN = (n, k) => Math.round(n * k) / k;
const rArr = (a, k) => {
  if (!a?.length) return a && a.length === 0 ? [] : (a ? Array.from(a) : a);
  const out = new Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = rN(a[i], k);
  return out;
};

export function buildMatchState({ matchId, phase, flies, clock, winner, bodyNames, wingPoses, resetIn, why, selected, eyes, groups, visions, act, betClosesAt, pools, tickerUrl, chaosCue, map }) {
  const vis = visions || null;
  return {
    type: 'state',
    matchId,
    map: map || 'dish',
    flyIds: flies.map(f => f.id),
    phase,
    clock,
    bodyNames: bodyNames || null,
    wingPoses: wingPoses || null,
    resetIn: resetIn ?? null,
    betClosesAt: betClosesAt ?? null,
    pools: pools || [],
    tickerUrl: tickerUrl || '',
    chaosCue: chaosCue || null,
    sentAt: performance.now(),
    winner: winner ? { id: winner.id, name: winner.name, color: winner.color, why: why || null } : null,
    selected: selected ?? null,
    eyes: vis?.length ? null : (eyes || null),
    groups: vis?.length ? null : (groups || null),
    visions: vis,
    act: act || null,
    flies: flies.filter(f => f.last).map(f => ({
      id: f.id,
      name: f.name,
      color: f.color,
      sex: f.sex,
      t: f.last.t,
      pos: f.last.pos ? rArr(f.last.pos, 1e4) : [0, 0, 0],
      yaw: f.last.yaw ? rN(f.last.yaw, 1e4) : 0,
      xpos: f.last.xpos ? rArr(f.last.xpos, 1e4) : [],
      xquat: f.last.xquat ? rArr(f.last.xquat, 1e4) : [],
      alive: f.last.alive,
      energy: f.last.energy != null ? rN(f.last.energy, 1e3) : f.last.energy,
      health: f.last.health != null ? rN(f.last.health, 1e3) : f.last.health,
      flying: !!f.last.flying,
      takeoffPending: !!f.last.takeoffPending,
      cmd: f.last.cmd || null,
      behavior: f.last.behavior || '',
    })),
  };
}
