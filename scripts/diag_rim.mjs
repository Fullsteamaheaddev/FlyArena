// Rim unstick: race walls must not hold a thorax parked on/inside the fence.
// Usage: node scripts/diag_rim.mjs
import fs from 'node:fs';
import loadMujoco from '@mujoco/mujoco';
import { loadAll } from './lib_node.mjs';
import { FlyAgent } from '../src/sim/fly.js';
import { buildWorldXML, raceMap, DEFAULT_ENV } from '../src/sim/world.js';
import { wallGap } from '../src/sim/senses.js';
import { allocBrainMemory, attachBrain } from '../src/brainsetup.js';

function fail(msg) { console.error('FAIL', msg); process.exit(1); }
function ok(msg) { console.log('ok', msg); }

const flyXML = fs.readFileSync('public/body/fly_physics.xml', 'utf8');

function checkXml(label, env, wantFric, wantCondim, expectClip) {
  const xml = buildWorldXML(flyXML, env, { flyPos: [0, 0, 0.13] });
  const wall = xml.match(/<geom name="wall0"[^/]*\/>/);
  const clip = xml.match(/<geom name="wallclip0"[^/]*\/>/);
  if (!wall) fail(`${label}: no wall0`);
  if (expectClip && !clip) fail(`${label}: no wallclip0`);
  const tags = expectClip ? [wall[0], clip[0]] : [wall[0]];
  for (const tag of tags) {
    if (!tag.includes(`friction="${wantFric}"`)) fail(`${label}: expected friction ${wantFric} in ${tag}`);
    if (!tag.includes(`condim="${wantCondim}"`)) fail(`${label}: expected condim ${wantCondim} in ${tag}`);
  }
  ok(`${label} wall${expectClip ? '+clip' : ''} friction=${wantFric} condim=${wantCondim}`);
}

checkXml('lab', structuredClone(DEFAULT_ENV), 1, 3, false);
checkXml('dish', raceMap('dish').env(), 0.02, 1, true);
checkXml('desert', raceMap('desert').env(), 0.02, 1, true);

const D = loadAll();
const data = { ...D, superclass: D.sc };
const size = new Float32Array(fs.readFileSync('public/data/neuron_size.bin').buffer.slice(0));
const sign = new Float32Array(fs.readFileSync('public/data/ntsign.bin').buffer.slice(0));
const gait = JSON.parse(fs.readFileSync('public/body/gait.json'));
const calib = fs.existsSync('public/data/brain_params.json') ? JSON.parse(fs.readFileSync('public/data/brain_params.json')) : { wSyn: 0.4 };
const mj = await loadMujoco();
const mem = allocBrainMemory(data, size, sign, calib, 1, null);
const brain = await attachBrain(fs.readFileSync('public/lif.wasm'), mem, 0, data, 7);

function mapLimit(env) {
  return env.arena.shape === 'square' ? env.arena.half : env.arena.radius;
}

async function probe(id) {
  const env = raceMap(id).env();
  const R = mapLimit(env);
  const fly = new FlyAgent({
    mj, flyXML, env, data, size, sign, bodymap: D.bodymap, gait, brain, brainOpts: calib,
    neuromod: null, vision: false, flyvis: null, intrinsic: false, pos: [0, 0], yaw: 0,
  });
  const d = fly.mjd;
  const cases = [
    { name: 'overlap', x: R - 0.01, vx: 12 },
    { name: 'embedded', x: R + 0.08, vx: 8 },
  ];
  for (const c of cases) {
    d.qpos[0] = c.x; d.qpos[1] = 0; d.qpos[2] = 0.25;
    d.qvel.fill(0); d.qvel[0] = c.vx;
    fly.guardDish();
    let g = wallGap([d.qpos[0], d.qpos[1]], env);
    if (g.gap < 0.049) fail(`${id} ${c.name} after guardDish gap=${g.gap.toFixed(4)} r=${Math.hypot(d.qpos[0], d.qpos[1]).toFixed(4)}`);
    if (d.qvel[0] > 1e-6) fail(`${id} ${c.name} still has outward vx=${d.qvel[0]}`);
    for (let i = 0; i < 250; i++) fly.kickPhysics();
    g = wallGap([d.qpos[0], d.qpos[1]], env);
    if (g.gap < 0.03) fail(`${id} ${c.name} restuck after 250 ms gap=${g.gap.toFixed(4)}`);
    ok(`${id} ${c.name} gap=${g.gap.toFixed(3)} xy=${d.qpos[0].toFixed(3)},${d.qpos[1].toFixed(3)}`);
  }
}

await probe('dish');
await probe('desert');
console.log('rim unstick ok');
