// One embodied fly per worker: its own connectome brain + MuJoCo physics world.
// Fruit Fly may pack several flies here so they share one WebGPU device and connectome buffer.
import loadMujoco from '@mujoco/mujoco';
import { FlyAgent } from './fly.js';
import { attachBrain, attachEyes } from '../brainsetup.js';
import { buildGroups, GroupMeter } from './groups.js';

const agents = new Map(), meters = new Map(), proxyIdsBy = new Map();
let pack = [], running = false, speed = 1, env = null, lastReal = 0, simAhead = 0, timer = null, loopEpoch = 0;
let burstSteps = 8, burstMs = 8, fenceEvery = 1, fenceN = 0;
let lastPose = -Infinity, loopActive = false;
const POSE_EVERY = 1000 / 30; // wall ms: twelve workers must not flood the render thread

function agentOf(m) { return m.id != null ? agents.get(m.id) : pack[0]; }

onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    const mj = await loadMujoco();
    const g = m.graph;
    const data = { N: g.N, E: g.E, meta: m.meta, indptr: g.indptr, indices: g.indices, weights: g.weights, nt: g.nt, side: g.side, superclass: g.superclass, cls: g.cls };
    env = m.env;
    if (m.burstSteps) burstSteps = m.burstSteps;
    if (m.burstMs) burstMs = m.burstMs;
    if (m.fenceEvery) fenceEvery = m.fenceEvery;
    const specs = m.flies || [{ id: m.id, pos: m.pos, yaw: m.yaw, sex: m.sex, slot: m.slot, seed: m.seed || 0 }];
    let gpu = null;
    for (const spec of specs) {
      const seed = spec.seed || 0;
      const brain = await attachBrain(m.wasmModule, m.brainMem, spec.slot, data, 101 + spec.id + seed, gpu);
      if (brain.device && !gpu) gpu = { device: brain.device, graphBuffer: brain.buf.graph };
      const flyvis = m.brainMem.fv ? { eyes: attachEyes(brain.instance, m.brainMem, spec.slot), map: m.flyvisMap, gain: 150 } : null;
      const fly = new FlyAgent({ brain, flyvis, mj, flyXML: m.flyXML, env, data, size: g.size, sign: g.sign, bodymap: m.bodymap, gait: m.gait, id: spec.id,
        pos: spec.pos, yaw: spec.yaw, nProxies: m.nProxies, mode: m.mode, brainOpts: m.brainOpts, vision: m.vision, neuromod: { calib: m.neuromod }, sex: spec.sex, seed });
      agents.set(spec.id, fly);
      meters.set(spec.id, new GroupMeter(buildGroups(m.bodymap, data.meta.types, data.side), g.N));
      proxyIdsBy.set(spec.id, Array.from({ length: m.nProxies }, (_, k) => fly.model.body_mocapid[fly.model.body(`proxy${k}`).id]));
      pack.push(fly);
      postMessage({ type: 'ready', id: spec.id, nbody: fly.model.nbody, bodyNames: [...Array(fly.model.nbody).keys()].map(i => fly.model.body(i).name), wingPoses: fly.flight.wingPoses(mj), backend: fly.brain.device ? 'WebGPU' : 'WASM' });
      postPose(fly);
    }
    if (running) { lastReal = performance.now(); loop(loopEpoch); }
  } else if (m.type === 'run') {
    loopEpoch++;
    running = true;
    lastReal = performance.now();
    clearTimeout(timer);
    loopActive = false;
    if (pack.length) loop(loopEpoch);
  }
  else if (m.type === 'pause') { running = false; clearTimeout(timer); }
  else if (m.type === 'speed') speed = m.speed;
  else if (m.type === 'env') {
    Object.assign(env, m.env);
    for (const fly of pack) { fly.env = env; if (fly.foodEaten.length !== env.food.length) fly.foodEaten = env.food.map(() => 0); }
  }
  else if (m.type === 'others') {
    const fly = agentOf(m);
    if (fly) { fly.others = m.others; setProxies(fly); }
  }
  else if (m.type === 'mode') {
    const fly = agentOf(m);
    if (fly) fly.motor.mode = m.mode;
    else for (const f of pack) f.motor.mode = m.mode;
  }
  else if (m.type === 'stimulate') { const fly = agentOf(m); if (fly) fly.brain.setDrive(m.indices, m.rate); }
  else if (m.type === 'takeoff') { const fly = agentOf(m); if (fly) { fly.requestTakeoff(); postPose(fly); } }
  else if (m.type === 'activity') {
    const fly = agentOf(m); if (!fly) return;
    const meter = meters.get(fly.id);
    const eyes = fly.fv ? fly.fv.lumEye.map(e => e.slice(0)) : null;
    const groups = meter.read(fly.brain.spikeCount, fly.t);
    if (m.eyesOnly) postMessage({ type: 'activity', id: fly.id, t: fly.t, groups, eyes, eyesOnly: true });
    else postMessage({ type: 'activity', id: fly.id, trace: fly.brain.trace.slice(0), t: fly.t, groups, eyes });
  }
};
function setProxies(fly) {
  const d = fly.mjd, others = fly.others, proxyIds = proxyIdsBy.get(fly.id);
  proxyIds.forEach((mid, k) => {
    const o = others[k];
    if (!o) { d.mocap_pos[mid * 3] = 50 + k; d.mocap_pos[mid * 3 + 1] = 50; d.mocap_pos[mid * 3 + 2] = -5; return; }
    d.mocap_pos[mid * 3] = o.x; d.mocap_pos[mid * 3 + 1] = o.y; d.mocap_pos[mid * 3 + 2] = o.z ?? 0.13;
    d.mocap_quat[mid * 4] = Math.cos(o.yaw / 2); d.mocap_quat[mid * 4 + 1] = 0; d.mocap_quat[mid * 4 + 2] = 0; d.mocap_quat[mid * 4 + 3] = Math.sin(o.yaw / 2); });
}
function postPose(fly) {
  lastPose = performance.now();
  const p = fly.pose(); const st = fly.state();
  postMessage({ type: 'pose', id: fly.id, t: fly.t, xpos: p.xpos, xquat: p.xquat, cmd: fly.cmd, energy: fly.energy, health: fly.health, alive: fly.alive, eaten: fly.eaten, takeoffPending:fly.takeoffPending,
    mn9: fly.motor.mean(fly.motor.muscles.find(x => x.name.startsWith('MN9'))?.idx || []), feeding: fly.motor.feeding(), heat: st.heat || 0, nSensory: fly.driven.length,
    foodEaten: fly.foodEaten.splice(0, fly.foodEaten.length, ...fly.foodEaten.map(() => 0)), behavior: fly.behavior(st), drive: fly.intrinsic?.label(), nm: fly.neuromod?.readout(), flying: fly.flight.active, flights: fly.flights, dist: fly.dist, jumps: fly.jumps, pos: st.pos, yaw: Math.atan2(fly.mjd.xmat[fly.bid.thorax * 9 + 3], fly.mjd.xmat[fly.bid.thorax * 9]) }, [p.xpos.buffer, p.xquat.buffer]);
}
async function loop(epoch = loopEpoch) {
  if (!running || epoch !== loopEpoch || loopActive) return;
  loopActive = true;
  const now = performance.now(); simAhead += Math.min(100, now - lastReal) * speed; lastReal = now;
  const t0 = performance.now(); let steps = 0;
  // Bound both CPU bursts and GPU work in flight. An unbounded compute queue stalls WebGL
  // and leaves the motor reading increasingly old brain state when many flies share the GPU.
  while (running && epoch === loopEpoch && simAhead >= 1 && steps < burstSteps && performance.now() - t0 < burstMs) {
    for (const fly of pack) fly.step();
    simAhead -= 1; steps++;
  }
  for (const fly of pack) fly.brain.flush?.();
  const dev = pack.find(f => f.brain.device)?.brain.device;
  if (steps && dev && (++fenceN % Math.max(1, fenceEvery) === 0)) await dev.queue.onSubmittedWorkDone();
  if (epoch !== loopEpoch) { loopActive = false; return; }
  if (simAhead > 50) simAhead = 50;   // can't keep up: run as fast as possible
  if (steps && (!running || performance.now() - lastPose >= POSE_EVERY)) for (const fly of pack) postPose(fly);
  loopActive = false;
  if (running && epoch === loopEpoch) timer = setTimeout(() => loop(epoch), 0);
}
// Chrome freezes nested setTimeout(0) in a background host tab; a 1s timer still fires.
setInterval(() => { if (running && pack.length && !loopActive) loop(loopEpoch); }, 1000);
