// One WebGPU device + one copy of the connectome for every fly. Each fly worker drives its slot through a
// LIFGpuProxy (src/brain-shared.js); here every attached slot's pending steps are encoded into a single
// command buffer and submitted once, then read back into the slot's SharedArrayBuffer shadows.
import { LIFGpu } from '../lifgpu.js';
import { C, RING_CAP, BATCH, slotViews } from '../brain-shared.js';

let device = null, graphBuf = null, shared = null, kick = null, N = 0, E = 0, opts = null, lost = false;
const slots = [];
const INFLIGHT = 2;   // submits per slot not yet read back

onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      shared = m.shared; kick = new Int32Array(shared.kick); N = m.N; E = m.E; opts = m.opts;
      device = await LIFGpu.requestDevice();
      device.lost.then(info => { lost = true; console.warn('shared GPU brain: device lost', info?.message || ''); });
      const buf = m.memory.buffer, G = m.graph;
      graphBuf = LIFGpu.uploadGraph(device, N, E, { indptr: new Uint32Array(buf, G.indptr, N + 1), indices: new Uint32Array(buf, G.indices, E), weights: new Float32Array(buf, G.weights, E), sign: new Float32Array(buf, G.sign, N) });
      await device.queue.onSubmittedWorkDone();
      postMessage({ type: 'ready', ok: true });
      loop();
    } catch (err) { postMessage({ type: 'ready', ok: false, error: String(err?.message || err) }); }
  } else if (m.type === 'attach') attach(m);
  else if (m.type === 'detach') detach(m.slot);
};

async function attach({ slot, seed, attachId, port }) {
  detach(slot);
  const v = slotViews(shared, slot), c = v.ctrl;
  for (const k of [C.REQ, C.DONE, C.RING_W, C.RING_R, C.DRV_GEN, C.DRV_N, C.FIRED_N]) Atomics.store(c, k, 0);
  v.spike.fill(0); v.trace.fill(0);
  const gb = await LIFGpu.create({ N, E, params: opts, seed, device, graphBuffer: graphBuf });
  gb._drivenDirty = false;
  const s = { slot, gb, v, attachId, enq: 0, inflight: 0, drvGen: 0, port };
  if (port) port.onmessage = (ev) => {
    const q = ev.data;
    if (q.type === 'params') gb.setParams(q.q);
    else if (q.type === 'reset') { drainRing(s); gb.reset(); s.v.spike.fill(0); s.v.trace.fill(0); }
  };
  slots[slot] = s;
  Atomics.store(c, C.ACTIVE, attachId); Atomics.notify(c, C.ACTIVE);
}

function detach(slot) {
  const s = slots[slot]; if (!s) return;
  slots[slot] = null; s.dead = true;
  Atomics.store(s.v.ctrl, C.ACTIVE, 0);
  s.port?.close();
  // staging buffers may still be mapping; let in-flight readbacks finish before freeing
  device.queue.onSubmittedWorkDone().then(() => setTimeout(() => s.gb.destroy(), 500));
}

function drainRing(s) {
  const c = s.v.ctrl, w = Atomics.load(c, C.RING_W); let r = Atomics.load(c, C.RING_R);
  if (r === w) return;
  const ring = s.v.ring, ringF = s.v.ringF, gb = s.gb;
  while (r !== w) { const o = r * 3; gb._pushDelta(ring[o], ring[o + 1], ringF[o + 2]); r = (r + 1) % RING_CAP; }
  Atomics.store(c, C.RING_R, r); Atomics.notify(c, C.RING_R);
}

function syncDriven(s) {
  const c = s.v.ctrl, g = Atomics.load(c, C.DRV_GEN);
  if (g === s.drvGen || (g & 1)) return;
  const n = Atomics.load(c, C.DRV_N), list = s.v.drv.slice(0, n);
  if (Atomics.load(c, C.DRV_GEN) !== g) return;   // torn: the fly republished mid-copy, pick it up next batch
  s.gb.setDrivenList(list); s.drvGen = g;
}

function finish(s, target) {
  s.inflight--;
  if (s.dead) return;
  Atomics.store(s.v.ctrl, C.DONE, target); Atomics.notify(s.v.ctrl, C.DONE);
  Atomics.add(kick, 0, 1); Atomics.notify(kick, 0);   // wake the loop: this slot can take another batch
}

const sink = (s) => (src, n, cap) => {
  const v = s.v; if (s.dead) return;
  v.spike.set(new Uint32Array(src, 0, n)); v.trace.set(new Float32Array(src, n * 4, n));
  const f = Math.max(0, Math.min(cap, new Int32Array(src, n * 8, 1)[0]));
  v.fired.set(new Int32Array(src, n * 8 + 16, f)); Atomics.store(v.ctrl, C.FIRED_N, f);
};

const ch = new MessageChannel(); let yieldResolve = null;
ch.port1.onmessage = () => { const r = yieldResolve; yieldResolve = null; r?.(); };
const yieldTask = () => new Promise(r => { yieldResolve = r; ch.port2.postMessage(0); });

async function loop() {
  for (;;) {
    if (lost) return;
    const kv = Atomics.load(kick, 0);
    let enc = null; const batch = [];
    for (const s of slots) {
      if (!s) continue;
      drainRing(s);
      const pending = (Atomics.load(s.v.ctrl, C.REQ) - s.enq) | 0;
      if (pending <= 0 || s.inflight >= INFLIGHT) continue;
      syncDriven(s);
      const n = Math.min(pending, BATCH);
      enc ||= device.createCommandEncoder();
      s.gb.encodeSteps(enc, n); s.enq = (s.enq + n) | 0;
      batch.push([s, s.gb.appendReadback(enc), s.enq]);
    }
    if (batch.length) {
      device.queue.submit([enc.finish()]);
      for (const [s, k, target] of batch) {
        s.inflight++;
        if (k >= 0) s.gb.readback(k, sink(s)).then(() => finish(s, target));
        else device.queue.onSubmittedWorkDone().then(() => finish(s, target));
      }
      await yieldTask();   // let mapAsync callbacks and attach/detach messages run
    } else {
      const w = Atomics.waitAsync ? Atomics.waitAsync(kick, 0, kv, 4) : null;
      if (w?.async) await w.value; else if (!w) await new Promise(r => setTimeout(r, 1));
      else await yieldTask();
    }
  }
}
