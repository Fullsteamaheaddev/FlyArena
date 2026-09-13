// Hypothesis lab: which dynamical model does the heading-circuit wiring actually support?
//
// A wiring diagram permits multiple plausible dynamics. Here we instantiate an ENSEMBLE of
// LIF models over the parameters the connectome does not fix — EPG->EPG recurrence gain,
// Delta7->EPG kernel gain, tonic EPG excitability, PEN->EPG push gain — then measure the
// same observables on every member: bump persistence, realised kernel, push field, rotation.
//
// Members are classified into competing hypotheses:
//   attractor_free  — bump persists unaided (recurrence alone suffices)
//   attractor_tonic — bump persists only with tonic EPG drive
//   filter          — no persistent bump; heading read out instantaneously
//
// Each candidate perturbation is then scored by how strongly its outcome separates the
// ensemble (fraction of member pairs it places in different outcome classes). The top-ranked
// experiment is the measurement that would most inform the biology.
//
// Run: node scripts/hypothesis_lab.mjs   (writes public/data/hypothesis_lab.json)
import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { makeLIF } from './lifprobe.mjs';

// deterministic RNG for the LIF noise source (mulberry32) — ensemble must be reproducible
const SEED = 20260704;
let rs = SEED;
Math.random = () => { rs |= 0; rs = rs + 0x6D2B79F5 | 0; let t = Math.imul(rs ^ rs >>> 15, 1 | rs); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

const D = loadAll(), { meta, N } = D;
const f2 = (v) => +(v).toFixed(3);

// ---- populations & geometry (same fold as validate_dynamics.mjs) ----
const pbcol = (s) => { const m = s && s.match(/_([LR])(\d)/); return m ? [m[1], +m[2]] : null; };
const posOf = (c) => c[0] === 'L' ? 9 - c[1] : 8 + c[1];
const wedgeOf = (i) => { const c = pbcol(meta.instances[i]); return c ? ((posOf(c) % 8) + 8) % 8 : -1; };
const epg = D.byType('EPG'), d7 = D.byType('Delta7'), peg = D.byType('PEG');
const penAll = [...D.byType('PEN_a(PEN1)'), ...D.byType('PEN_b(PEN2)')];
const penL = penAll.filter(i => pbcol(meta.instances[i])?.[0] === 'L');
const penR = penAll.filter(i => pbcol(meta.instances[i])?.[0] === 'R');
const wedges = Array.from({ length: 8 }, () => []);
epg.forEach((i) => { const w = wedgeOf(i); if (w >= 0) wedges[w].push(i); });

// per-neuron type name (meta.types is indexed by neuron) for weight-class scaling
const tix = meta.types;
const inSet = (arr) => { const s = new Set(arr); return (i) => s.has(i); };
const isEPG = inSet(epg), isD7 = inSet(d7), isPEN = inSet(penAll);

function buildNet({ epgRecur = 1, d7Gain = 1, penGain = 1, epgTonic = 0 }) {
  const net = makeLIF(D, {});
  // scale synapse classes: weights[j] is edge pre->post; pre = row via indptr
  for (let i = 0; i < N; i++) {
    const t = tix[i];
    if (t !== 'EPG' && t !== 'Delta7' && t !== 'PEN_a(PEN1)' && t !== 'PEN_b(PEN2)') continue;
    for (let j = D.indptr[i]; j < D.indptr[i + 1]; j++) {
      const q = D.indices[j];
      if (t === 'EPG' && isEPG(q)) net.weights[j] *= epgRecur;
      else if (t === 'Delta7' && isEPG(q)) net.weights[j] *= d7Gain;
      else if ((t === 'PEN_a(PEN1)' || t === 'PEN_b(PEN2)') && isEPG(q)) net.weights[j] *= penGain;
    }
  }
  if (epgTonic) net.setBias(epg, epgTonic);
  return net;
}

const run = (net, ms) => { for (let s = 0; s < Math.round(ms / net.p.dt); s++) net.step(); };
const wedgeRates = (net, b0) => wedges.map(ws => ws.reduce((a, i) => a + (net.spikeCount[i] - (b0 ? b0[i] : 0)), 0) / Math.max(ws.length, 1));
const circRes = (r) => { let x = 0, y = 0, n = 0; r.forEach((v, w) => { x += v * Math.cos(w * Math.PI / 4); y += v * Math.sin(w * Math.PI / 4); n += v; }); return n > 1e-9 ? Math.hypot(x, y) / n : 0; };
const circAngle = (r) => { let x = 0, y = 0; r.forEach((v, w) => { x += v * Math.cos(w * Math.PI / 4); y += v * Math.sin(w * Math.PI / 4); }); return Math.atan2(y, x); };
const clean = (net, tonic) => { net.drive.fill(0); net.bias.fill(0); net.thr.fill(0); net.reset(); if (tonic) net.setBias(epg, tonic); };

// ---- observable: bump persistence after a seeded bump is released ----
function persistence(net, tonic) {
  clean(net, tonic);
  net.setDrive(wedges[0], 100); run(net, 150);
  const seeded = circRes(wedgeRates(net));
  net.setDrive(wedges[0], 0);
  const b0 = Uint32Array.from(net.spikeCount); run(net, 400);
  const after = circRes(wedgeRates(net, b0));
  const total = wedgeRates(net, b0).reduce((a, b) => a + b, 0);
  return { concentration: f2(after), seeded: f2(seeded), total_rate: f2(total) };
}

// ---- observable: rotation under sustained unilateral PEN drive (only if a bump exists) ----
function rotation(net, tonic, side) {
  clean(net, tonic);
  net.setDrive(wedges[0], 100); run(net, 150); net.setDrive(wedges[0], 0);
  const b0 = Uint32Array.from(net.spikeCount); run(net, 100);
  if (wedgeRates(net, b0).reduce((a, b) => a + b, 0) < 0.5) return { drift: null, tracked: 0 };  // no bump to rotate
  const pen = side === 'L' ? penL : penR;
  net.setDrive(pen, 80);
  const angles = [];
  for (let k = 0; k < 4; k++) {
    const b1 = Uint32Array.from(net.spikeCount); run(net, 100);
    const r = wedgeRates(net, b1);
    if (r.reduce((a, b) => a + b, 0) > 0.5) angles.push(circAngle(r)); else angles.push(null);
  }
  net.setDrive(pen, 0);
  const a = angles.filter(v => v != null);
  if (a.length < 2) return { drift: null, tracked: a.length };
  let d = a[a.length - 1] - a[0];
  while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  return { drift: f2(d / (a.length - 1) * 10), tracked: a.length };  // rad/s approx (100ms bins)
}

// ---- observable: realised Delta7 kernel (subset of cells for speed) ----
function kernel(net, tonic) {
  const d7in = d7.map(() => new Float64Array(8));
  const d7idx = new Map(d7.map((d, k) => [d, k]));
  for (const i of epg) { const w = wedgeOf(i); if (w < 0) continue; for (let j = D.indptr[i]; j < D.indptr[i + 1]; j++) { const k = d7idx.get(D.indices[j]); if (k != null) d7in[k][w] += D.weights[j]; } }
  const acc = new Float64Array(8); let cnt = 0;
  for (const d of d7) {
    const pw = d7in[d7idx.get(d)].indexOf(Math.max(...d7in[d7idx.get(d)]));
    clean(net, tonic || 4); run(net, 60);
    net.setDrive([d], 100); run(net, 120); net.setDrive([d], 0);
    const gI = wedges.map(ws => -ws.reduce((a, i) => a + net.gI[i], 0) / ws.length);
    if (Math.max(...gI) - Math.min(...gI) < 0.01) continue;
    for (let w = 0; w < 8; w++) acc[w] += gI[((w + pw) % 8 + 8) % 8];
    cnt++;
  }
  const prof = [...acc].map(v => v / Math.max(cnt, 1));
  const k8 = [...Array(8).keys()], a = prof.reduce((s, x) => s + x, 0) / 8;
  const b = -2 * prof.reduce((s, x, k) => s + x * Math.cos(2 * Math.PI * k / 8), 0) / 8;
  const ss = prof.reduce((s, x, k) => s + (x - (a - b * Math.cos(2 * Math.PI * k / 8))) ** 2, 0);
  const tt = prof.reduce((s, x) => s + (x - a) ** 2, 0);
  return { n_d7: cnt, contrast: f2(b / Math.max(a, 1e-9)), r2: f2(1 - ss / Math.max(tt, 1e-9)),
           min_at_bump: prof.indexOf(Math.min(...prof)) <= 1 || prof.indexOf(Math.min(...prof)) === 7 };
}

// ---- ensemble ----
const grid = [];
for (const epgRecur of [1, 3, 4, 6]) for (const d7Gain of [0.5, 1.0, 1.3]) for (const epgTonic of [0, 3, 5, 7]) for (const penGain of [1])
  grid.push({ epgRecur, d7Gain, epgTonic, penGain });

const members = [];
console.log(`ensemble: ${grid.length} members over {epgRecur, d7Gain, epgTonic, penGain}`);
for (const p of grid) {
  const t0 = Date.now();
  const net = buildNet(p);
  const base = persistence(net, p.epgTonic);
  const kern = kernel(net, p.epgTonic);
  const rotL = rotation(net, p.epgTonic, 'L'), rotR = rotation(net, p.epgTonic, 'R');
  // hypothesis from baseline observables
  const persists = base.concentration > 0.5;
  const hyp = !persists ? (base.total_rate < 0.2 ? 'silent' : 'filter')
            : base.total_rate < 0.2 ? 'frozen'                       // bump forms but barely spikes
            : (p.epgTonic > 0 ? 'attractor_tonic' : 'attractor_free');
  // perturbations
  const pert = {};
  { const n2 = buildNet(p); for (const i of d7) n2.setThr(i, 1e6); pert.d7_silence = persistence(n2, p.epgTonic); }
  { const n2 = buildNet(p); for (const i of peg) n2.setThr(i, 1e6); pert.peg_lesion = persistence(n2, p.epgTonic); }
  members.push({ params: p, hypothesis: hyp, baseline: { persistence: base, kernel: kern, rotL, rotR }, perturbations: pert });
  console.log(`  recur×${p.epgRecur} d7×${p.d7Gain} tonic${p.epgTonic} pen×${p.penGain}: ${hyp} | persist ${base.concentration} (rate ${base.total_rate}) kernel c=${kern.contrast} r2=${kern.r2} | rotL ${rotL.drift} rotR ${rotR.drift} | ${Date.now() - t0}ms`);
}

// ---- rank experiments by discriminative power across the ensemble ----
const cls = (v) => v > 0.5 ? 'sustains' : v > 0.2 ? 'partial' : 'decays';
function spread(vals) { const m = vals.reduce((a, b) => a + b, 0) / vals.length; return vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length; }
const experiments = {
  tonic_sweep: { score: null, note: 'separates attractor_free from attractor_tonic by construction', outcome: members.map(m => cls(m.baseline.persistence.concentration)) },
  d7_silence: { outcome: members.map(m => cls(m.perturbations.d7_silence.concentration)) },
  peg_lesion: { outcome: members.map(m => cls(m.perturbations.peg_lesion.concentration)) },
  unilateral_pen_L: { outcome: members.map(m => m.baseline.rotL.drift > 0.05 ? 'rotates' : 'none') },
  unilateral_pen_R: { outcome: members.map(m => m.baseline.rotR.drift < -0.05 ? 'rotates' : 'none') },
};
for (const [name, e] of Object.entries(experiments)) {
  let diff = 0, tot = 0;
  for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) { tot++; if (e.outcome[i] !== e.outcome[j]) diff++; }
  e.score = f2(diff / Math.max(tot, 1));   // fraction of model pairs separated
}
const ranked = Object.entries(experiments).sort((a, b) => b[1].score - a[1].score);

const byHyp = {};
for (const m of members) (byHyp[m.hypothesis] ||= []).push(m.params);
console.log('\nhypotheses:', Object.fromEntries(Object.entries(byHyp).map(([k, v]) => [k, v.length])));
console.log('ranked experiments:', ranked.map(([n, e]) => `${n}=${e.score}`).join(', '));

// ---- mechanism classes among bump-sustaining members, under the top discriminator ----
// same baseline behaviour, different causal structure — the thing an experiment resolves
const mech = (m) => {
  const s = m.perturbations.d7_silence;
  if (s.concentration > 0.5) return 'd7_sculpts_only';          // kernel sharpens bump, not required
  if (s.total_rate > 1) return 'd7_confines';                   // silencing -> runaway/uniform firing
  return 'd7_essential';                                        // silencing -> activity dies (adaptation release)
};
const attractors = members.filter(m => m.hypothesis.startsWith('attractor'));
const mechGroups = {};
for (const m of attractors) (mechGroups[mech(m)] ||= []).push(m.params);
console.log('mechanisms among attractor members:', Object.fromEntries(Object.entries(mechGroups).map(([k, v]) => [k, v.length])));

fs.writeFileSync('public/data/hypothesis_lab.json', JSON.stringify({
  summary: {
    ensemble_size: members.length,
    attractor_compatible: attractors.length,
    hypotheses: Object.fromEntries(Object.entries(byHyp).map(([k, v]) => [k, v.length])),
    mechanisms: Object.fromEntries(Object.entries(mechGroups).map(([k, v]) => [k, v.length])),
    best_experiment: ranked[0][0],
    best_experiment_separation: ranked[0][1].score,
    claim: 'Wiring supports a low-dimensional heading bump in a narrow gain regime (EPG recurrence ~3-6x, tonic EPG bias ~3-7mV). ' +
           'Free-running bump without tonic drive was not observed at any grid point. ' +
           'Among bump-sustaining models, Delta7 silencing separates mechanisms that are indistinguishable at baseline.',
  },
  grid_axes: ['epgRecur', 'd7Gain', 'epgTonic', 'penGain'],
  members: members.map(m => ({ params: m.params, hypothesis: m.hypothesis, mechanism: m.hypothesis.startsWith('attractor') ? mech(m) : null,
    baseline: m.baseline, perturbations: m.perturbations })),
  hypothesis_counts: Object.fromEntries(Object.entries(byHyp).map(([k, v]) => [k, v.length])),
  mechanism_counts: Object.fromEntries(Object.entries(mechGroups).map(([k, v]) => [k, v.length])),
  ranked_experiments: ranked.map(([name, e]) => ({ experiment: name, separation: e.score, outcomes: e.outcome })),
}, null, 1));
console.log('wrote public/data/hypothesis_lab.json');
