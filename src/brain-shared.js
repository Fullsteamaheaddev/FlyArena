// Shared-GPU brain: one brain worker (src/sim/brain.worker.js) owns the only GPUDevice and the only copy of
// the connectome on the GPU; each fly worker talks to its slot through a SharedArrayBuffer.
//
// Per-slot layout (bytes): ctrl Int32[64] | delta ring (idx, kind, f32 val) x RING_CAP | driven list Int32[N]
// | spikeCount Uint32[N] | trace Float32[N] | last fired Int32[fireCap].
// The fly side requests brain steps (REQ) and blocks once it is more than MAX_AHEAD steps past what the
// brain worker has read back (DONE). Deltas go through a single-producer / single-consumer ring; the driven
// list is published with a seqlock (DRV_GEN odd while writing). spikeCount / trace are written by the brain
// worker after each readback, so they lag the fly by up to MAX_AHEAD brain steps (as LIFGpu's shadows did).
import { DEFAULTS } from './lif.js';

export const C = { REQ: 0, DONE: 1, RING_W: 2, RING_R: 3, DRV_GEN: 4, DRV_N: 5, FIRED_N: 6, ACTIVE: 7 };
export const RING_CAP = 1 << 17;
export const BATCH = 16;        // brain steps per slot per submit
export const MAX_AHEAD = 24;    // fly may run this many brain steps past the readback
const WAIT_MS = 50, MAX_WAITS = 100;   // give up blocking after ~5 s (brain worker gone): the fly keeps running on stale shadows
const a16 = n => (n + 15) & ~15;

export function slotLayout(N) {
  const fireCap = Math.min(65536, N);
  const ctrl = 0, ring = 256, drv = a16(ring + RING_CAP * 12), spike = a16(drv + N * 4), trace = a16(spike + N * 4), fired = a16(trace + N * 4);
  return { N, fireCap, ctrl, ring, drv, spike, trace, fired, bytes: (fired + fireCap * 4 + 4095) & ~4095 };
}

/** main thread: one SAB for every slot plus a kick word the brain worker sleeps on */
export function allocSharedBrain(N, slots) {
  const L = slotLayout(N);
  return { sab: new SharedArrayBuffer(L.bytes * slots), kick: new SharedArrayBuffer(16), N, slots, slotBytes: L.bytes };
}

export function slotViews(shared, slot) {
  const L = slotLayout(shared.N), o = slot * shared.slotBytes, b = shared.sab, N = shared.N;
  return {
    ctrl: new Int32Array(b, o + L.ctrl, 64),
    ring: new Int32Array(b, o + L.ring, RING_CAP * 3), ringF: new Float32Array(b, o + L.ring, RING_CAP * 3),
    drv: new Int32Array(b, o + L.drv, N),
    spike: new Uint32Array(b, o + L.spike, N), trace: new Float32Array(b, o + L.trace, N),
    fired: new Int32Array(b, o + L.fired, L.fireCap), fireCap: L.fireCap,
  };
}

/** fly worker side: same API as LIFGpu / LIFWasm, backed by a brain-worker slot */
export class LIFGpuProxy {
  /** waits (blocking, worker only) until the brain worker has attached this slot for attachId */
  static create({ shared, slot, attachId, N, params = {}, port = null, timeoutMs = 20000 }) {
    const v = slotViews(shared, slot), t0 = performance.now();
    while (Atomics.load(v.ctrl, C.ACTIVE) !== attachId) {
      if (performance.now() - t0 > timeoutMs) throw new Error(`shared GPU brain slot ${slot} not attached`);
      Atomics.wait(v.ctrl, C.ACTIVE, Atomics.load(v.ctrl, C.ACTIVE), 100);
    }
    return new LIFGpuProxy(shared, v, N, params, port);
  }
  constructor(shared, v, N, params, port) {
    Object.assign(this, v);
    this.kick = new Int32Array(shared.kick); this.N = N; this.p = { ...DEFAULTS, ...params }; this.port = port;
    this.backend = 'WebGPU (shared)';
    this.spikeCount = v.spike;
    this.drive = new Float32Array(N); this.thr = new Float32Array(N); this.bias = new Float32Array(N);
    this._sent = new Float32Array(N); this._mark = new Uint8Array(N); this._touched = new Int32Array(N); this._nT = 0;
    this.drivenSet = new Set(); this._drivenDirty = false;
    this._w = Atomics.load(v.ctrl, C.RING_W); this._req = Atomics.load(v.ctrl, C.REQ);
    this.t = 0; this.stalled = false;
  }

  get nAwake() { return this.N; }
  get _lastFired() { const n = Math.max(0, Math.min(this.fireCap, Atomics.load(this.ctrl, C.FIRED_N))); return this.fired.slice(0, n); }

  _kick() { Atomics.add(this.kick, 0, 1); Atomics.notify(this.kick, 0); }
  _publishRing() { Atomics.store(this.ctrl, C.RING_W, this._w); }
  _push(idx, kind, val) {
    const next = (this._w + 1) % RING_CAP;
    if (next === Atomics.load(this.ctrl, C.RING_R)) {   // full: let the brain worker drain it
      this._publishRing(); this._kick();
      for (let n = 0; next === Atomics.load(this.ctrl, C.RING_R) && n < MAX_WAITS; n++) Atomics.wait(this.ctrl, C.RING_R, next, WAIT_MS);
      if (next === Atomics.load(this.ctrl, C.RING_R)) { this.stalled = true; return; }
    }
    const s = this._w * 3; this.ring[s] = idx; this.ring[s + 1] = kind; this.ringF[s + 2] = val;
    this._w = next;
  }
  // drive is a set, not an add: fly.js zeroes and re-sets its whole driven population every ms, so only the
  // net change per step goes to the ring
  _flushDrive() {
    const T = this._touched, n = this._nT;
    for (let k = 0; k < n; k++) {
      const i = T[k], r = this.drive[i]; this._mark[i] = 0;
      if (r !== this._sent[i]) { this._sent[i] = r; this._push(i, 0, r); }
      if (r > 0) { if (!this.drivenSet.has(i)) { this.drivenSet.add(i); this._drivenDirty = true; } }
      else if (this.drivenSet.delete(i)) this._drivenDirty = true;
    }
    this._nT = 0;
    if (!this._drivenDirty) return;
    const c = this.ctrl, g = Atomics.load(c, C.DRV_GEN);
    Atomics.store(c, C.DRV_GEN, g + 1);
    let k = 0; for (const i of this.drivenSet) this.drv[k++] = i;
    Atomics.store(c, C.DRV_N, k);
    Atomics.store(c, C.DRV_GEN, g + 2);
    this._drivenDirty = false;
  }

  step() {
    this._flushDrive(); this._publishRing();
    const c = this.ctrl, req = (this._req + 1) | 0; this._req = req;
    Atomics.store(c, C.REQ, req); this._kick();
    for (let n = 0; n < MAX_WAITS; n++) {
      const done = Atomics.load(c, C.DONE);
      if (((req - done) | 0) <= MAX_AHEAD) { this.stalled = false; break; }
      if (Atomics.wait(c, C.DONE, done, WAIT_MS) === 'timed-out' && n === MAX_WAITS - 1) this.stalled = true;
    }
    this.t += this.p.dt;
    return EMPTY;
  }

  setDriveOne(i, rate) { this.drive[i] = rate; if (!this._mark[i]) { this._mark[i] = 1; this._touched[this._nT++] = i; } }
  setDrive(ix, rate) { for (const i of ix) this.setDriveOne(i, rate); }
  setBias(ix, mv) { for (const i of ix) { this.bias[i] = mv; this._push(i, 1, mv); } }
  setThr(i, mv) { if (this.thr[i] !== mv) { this.thr[i] = mv; this._push(i, 2, mv); } }
  addG(i, e, ii) { if (e) this._push(i, 3, e); if (ii) this._push(i, 4, ii); }
  pulse(ix, mv) { for (const i of ix) this._push(i, 3, mv); }
  wake() {}
  flush() { this._flushDrive(); this._publishRing(); this._kick(); }
  setBackground(rateHz, ampMv) { this.p.bgRate = rateHz; this.p.bgAmp = ampMv; this.flush(); this.port?.postMessage({ type: 'params', q: { bgRate: rateHz, bgAmp: ampMv } }); }
  setParams(q) { Object.assign(this.p, q); this.flush(); this.port?.postMessage({ type: 'params', q }); }
  reset() { this.flush(); this.spikeCount.fill(0); this.trace.fill(0); this.t = 0; this.port?.postMessage({ type: 'reset' }); }
}
const EMPTY = new Int32Array(0);
