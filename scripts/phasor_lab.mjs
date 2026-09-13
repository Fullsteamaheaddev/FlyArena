// Phasor lab: does the PFN -> hDeltaB wiring dynamically realize a shifted copy?
//
// Second circuit through the same ensemble machinery as hypothesis_lab.mjs, to
// test whether the framework is generic or silently ring-specific. Structure
// measures peak columnar offsets of PFNd->hDelta -3 and PFNv->hDelta +2
// columns (fb_columnar_offsets). The competing mechanisms for what produces a
// shifted hDeltaB population response:
//   wired_shift  — offset compiled into PFN->hDeltaB projection geometry
//   passthrough  — hDeltaB reports the driven column (~0 offset)
//   recurrent    — hDeltaB internal recurrence, not the projection, makes it
//   silent       — circuit carries no population signal at this gain
//
// Run: node scripts/phasor_lab.mjs [seed]   (writes public/data/phasor_lab.json)
import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { seedRng, makeBuilder, run, silence, centroid, rankExperiments } from './lif_ensemble.mjs';

const SEED = +process.argv[2] || 20260704;
seedRng(SEED);
const D = loadAll(), { meta, N } = D;
const f2 = (v) => +(v).toFixed(3);

const colOf = (i) => { const m = meta.instances[i].match(/_C(\d+)/); return m ? +m[1] : 0; };
const pfnd = D.byType('PFNd'), pfnv = D.byType('PFNv'), hdb = D.byType('hDeltaB');
const hcol = [...new Set(hdb.map(colOf))].sort((a, b) => a - b);
const pfndCols = {};
for (const i of pfnd) (pfndCols[colOf(i)] ||= []).push(i);
const pfnvCols = {};
for (const i of pfnv) (pfnvCols[colOf(i)] ||= []).push(i);
console.log(`populations: PFNd ${pfnd.length} (cols ${Object.keys(pfndCols).sort().join(',')}), PFNv ${pfnv.length} (cols ${Object.keys(pfnvCols).sort().join(',')}), hDeltaB ${hdb.length} (cols ${hcol.join(',')})`);

const STRUCT = { PFNd: -3, PFNv: +2 };   // measured fb_columnar_offsets peaks
const build = makeBuilder(D, [
  { pre: 'PFNd', post: 'hDeltaB', param: 'pfndGain' },
  { pre: 'PFNv', post: 'hDeltaB', param: 'pfnvGain' },
  { pre: 'hDeltaB', post: 'hDeltaB', param: 'hdRecur' },
], [{ pop: 'hDeltaB', param: 'hdTonic' }]);

// drive one column of a PFN population; return hDeltaB activity centroid - driven column
function probe(net, colMap, driveCol, ms = 250) {
  net.drive.fill(0); net.reset();
  const ix = colMap[driveCol]; if (!ix) return null;
  net.setDrive(ix, 100); run(net, ms); net.setDrive(ix, 0);
  const prof = hcol.map(c => hdb.filter(i => colOf(i) === c).reduce((a, i) => a + net.spikeCount[i], 0));
  const cen = centroid(prof);
  if (cen == null || prof.reduce((a, b) => a + b, 0) < 10) return { offset: null, rate: 0 };
  return { offset: f2(hcol[Math.round(cen)] - driveCol), cen_offset: f2(cen - driveCol), rate: prof.reduce((a, b) => a + b, 0) };
}

const grid = [];
for (const pfndGain of [0.5, 1, 2]) for (const pfnvGain of [0.5, 1, 2]) for (const hdRecur of [0, 1]) for (const hdTonic of [0, 4])
  grid.push({ pfndGain, pfnvGain, hdRecur, hdTonic });

// drive a mid column (C6) so both -3 and +2 offsets stay in range
const members = [];
console.log(`ensemble: ${grid.length} members over {pfndGain, pfnvGain, hdRecur, hdTonic}`);
for (const p of grid) {
  const net = build(p);
  if (p.hdTonic) net.setBias(hdb, p.hdTonic);
  const offD = probe(net, pfndCols, 6), offV = probe(net, pfnvCols, 6);
  const classify = (o, expect) => o.offset == null ? 'silent'
    : Math.abs(o.offset - expect) <= 1 ? 'wired_shift'
    : Math.abs(o.offset) <= 1 ? 'passthrough' : 'other';
  const armD = classify(offD, STRUCT.PFNd), armV = classify(offV, STRUCT.PFNv);
  const hyp = armD === 'silent' && armV === 'silent' ? 'silent'
    : armD === 'wired_shift' || armV === 'wired_shift' ? 'wired_shift'
    : armD === 'passthrough' || armV === 'passthrough' ? 'passthrough' : 'distorted';
  // perturbation: kill hDeltaB recurrence, re-probe both arms
  const n2 = build({ ...p, hdRecur: 0 });
  if (p.hdTonic) n2.setBias(hdb, p.hdTonic);
  const recD = probe(n2, pfndCols, 6), recV = probe(n2, pfnvCols, 6);
  // perturbation: silence the opposite PFN arm
  const n3 = build(p); silence(n3, pfnv); if (p.hdTonic) n3.setBias(hdb, p.hdTonic);
  const isoD = probe(n3, pfndCols, 6);
  members.push({ params: p, hypothesis: hyp, arms: { PFNd: armD, PFNv: armV },
    offsets: { PFNd: offD, PFNv: offV },
    perturbations: { hd_recur_off: { PFNd: recD, PFNv: recV }, pfnv_silenced: { PFNd: isoD } } });
  console.log(`  d×${p.pfndGain} v×${p.pfnvGain} recur${p.hdRecur} tonic${p.hdTonic}: ${hyp} | PFNd off ${offD?.offset} (${armD}) PFNv off ${offV?.offset} (${armV}) | noRecur d ${recD?.offset} v ${recV?.offset} | isoD ${isoD?.offset}`);
}

const offCls = (o, expect) => o == null || o.offset == null ? 'silent' : Math.abs(o.offset - expect) <= 1 ? 'shift' : Math.abs(o.offset) <= 1 ? 'pass' : 'other';
const ranked = rankExperiments({
  measure_pfnd_offset: { outcome: members.map(m => offCls(m.offsets.PFNd, STRUCT.PFNd)) },
  measure_pfnv_offset: { outcome: members.map(m => offCls(m.offsets.PFNv, STRUCT.PFNv)) },
  hd_recur_off: { outcome: members.map(m => offCls(m.perturbations.hd_recur_off.PFNd, STRUCT.PFNd)) },
  pfnv_silenced: { outcome: members.map(m => offCls(m.perturbations.pfnv_silenced.PFNd, STRUCT.PFNd)) },
});

const byHyp = {};
for (const m of members) (byHyp[m.hypothesis] ||= []).push(m.params);
console.log('\nhypotheses:', Object.fromEntries(Object.entries(byHyp).map(([k, v]) => [k, v.length])));
console.log('ranked:', ranked.map(([n, e]) => `${n}=${e.score}`).join(', '));

fs.writeFileSync('public/data/phasor_lab.json', JSON.stringify({
  seed: SEED,
  summary: {
    ensemble_size: members.length,
    hypotheses: Object.fromEntries(Object.entries(byHyp).map(([k, v]) => [k, v.length])),
    best_experiment: ranked[0][0], best_experiment_separation: ranked[0][1].score,
    structural_prediction: STRUCT,
    claim: 'PFN->hDeltaB transform: does the realised population response reproduce the wired -3/+2 column offsets?',
  },
  members, ranked_experiments: ranked.map(([name, e]) => ({ experiment: name, separation: e.score, outcomes: e.outcome })),
}, null, 1));
console.log('wrote public/data/phasor_lab.json');
