/**
 * Audit the baked desert prop GLBs against the normalisation contract in
 * scripts/export_desert_props.mjs, and report disconnected geometry islands.
 * Run: node scripts/audit_desert_props.mjs [name]
 *
 * "islands" = vertex clusters no closer than EPS to each other. A prop whose
 * silhouette should read as one object but reports islands with a large gap is
 * the numeric version of "the lintel is floating".
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import fs from 'fs';
import path from 'path';

const dir = path.join('public', 'maps', 'desert');
const EPS = 0.02; // unit-space weld tolerance

/**
 * Target bbox per kind (see the export script header). `offCentre` raises the
 * centring tolerance for props whose origin is deliberately not the bbox centre,
 * and `centreOrigin` expects the origin in the middle rather than at the foot.
 */
const CONTRACT = {
  palm: { h: 1, offCentre: 0.2 },            // trunk leans; origin is the trunk base
  pyramid: { w: 1, h: 2 / 3 },
  obelisk: { h: 1 },
  arch: { w: 1, h: 5 / 6 },
  pillar_broken: { h: 1, offCentre: 0.25 },  // fallen chunk lies beside the shaft
  block: { h: 1 },
  rock_a: { w: 2, h: 1 },
  rock_b: { w: 2, h: 1 },
  rock_c: { w: 2, h: 1 },
  pebble: { w: 2, h: 1 },
  cactus: { h: 1 },
  reed: { h: 1 },
  lilypad: { w: 2 },
  skull: { h: 1, offCentre: 0.2 },           // snout reaches forward
  tumbleweed: { w: 2, centreOrigin: true },  // rolled about its middle in race-map-desert.js
};

class DSU {
  constructor(n) { this.p = new Int32Array(n).map((_, i) => i); }
  find(a) { while (this.p[a] !== a) { this.p[a] = this.p[this.p[a]]; a = this.p[a]; } return a; }
  union(a, b) { a = this.find(a); b = this.find(b); if (a !== b) this.p[b] = a; }
}

/** weld vertices within EPS (spatial hash, 27-cell neighbourhood) then join per-triangle */
function islandsOf(positions) {
  const n = positions.length / 3;
  const dsu = new DSU(n);
  const cell = new Map();
  const key = (i, j, k) => `${i},${j},${k}`;
  const ci = v => Math.floor(v / EPS);
  for (let v = 0; v < n; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    const k = key(ci(x), ci(y), ci(z));
    if (!cell.has(k)) cell.set(k, []);
    cell.get(k).push(v);
  }
  for (let v = 0; v < n; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    const bx = ci(x), by = ci(y), bz = ci(z);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const bucket = cell.get(key(bx + dx, by + dy, bz + dz));
      if (!bucket) continue;
      for (const w of bucket) {
        if (w <= v) continue;
        const ddx = positions[w * 3] - x, ddy = positions[w * 3 + 1] - y, ddz = positions[w * 3 + 2] - z;
        if (ddx * ddx + ddy * ddy + ddz * ddz <= EPS * EPS) dsu.union(v, w);
      }
    }
  }
  for (let t = 0; t < n; t += 3) { dsu.union(t, t + 1); dsu.union(t, t + 2); }

  const groups = new Map();
  for (let v = 0; v < n; v++) {
    const r = dsu.find(v);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(v);
  }
  return [...groups.values()].map(verts => {
    const box = new THREE.Box3();
    const pt = new THREE.Vector3();
    for (const v of verts) box.expandByPoint(pt.set(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]));
    return { verts, box, tris: verts.length / 3 };
  }).sort((a, b) => b.verts.length - a.verts.length);
}

/** min vertex distance between two islands (downsampled for speed) */
function gapBetween(a, b, positions) {
  const step = (list) => Math.max(1, Math.floor(list.length / 400));
  const sa = a.verts.filter((_, i) => i % step(a.verts) === 0);
  const sb = b.verts.filter((_, i) => i % step(b.verts) === 0);
  let best = Infinity;
  for (const v of sa) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    for (const w of sb) {
      const dx = positions[w * 3] - x, dy = positions[w * 3 + 1] - y, dz = positions[w * 3 + 2] - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

const loader = new GLTFLoader();
async function load(file) {
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await loader.parseAsync(ab, '');
  return gltf.scene;
}

const pick = process.argv[2];
const names = Object.keys(CONTRACT).filter(n => !pick || n === pick);
let fails = 0;

for (const name of names) {
  const file = path.join(dir, `${name}.glb`);
  if (!fs.existsSync(file)) { console.log(`${name.padEnd(14)} MISSING`); fails++; continue; }
  const root = await load(file);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  // world-space vertex soup
  const all = [];
  let tris = 0;
  root.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    const p = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      all.push(v.x, v.y, v.z);
    }
    tris += p.count / 3;
  });
  const positions = Float64Array.from(all);
  const islands = islandsOf(positions);

  const c = CONTRACT[name];
  const notes = [];
  const wantFoot = c.centreOrigin ? -size.z / 2 : 0;
  if (Math.abs(box.min.z - wantFoot) > 0.02) notes.push(`footZ ${box.min.z.toFixed(3)} want ${wantFoot.toFixed(3)}`);
  if (c.h !== undefined && Math.abs(size.z - c.h) / c.h > 0.05) notes.push(`H ${size.z.toFixed(3)} want ${c.h.toFixed(3)}`);
  if (c.w !== undefined && Math.abs(size.x - c.w) / c.w > 0.05) notes.push(`W ${size.x.toFixed(3)} want ${c.w.toFixed(3)}`);
  const offTol = c.offCentre ?? 0.12;
  if (Math.abs(center.x) > offTol) notes.push(`offCentreX ${center.x.toFixed(3)}`);
  if (Math.abs(center.y) > offTol) notes.push(`offCentreY ${center.y.toFixed(3)}`);

  // islands whose bounding volumes overlap read as one solid; cluster those out
  // so only genuinely detached pieces are reported.
  const big = islands.filter(i => i.tris >= 4);
  const cl = new DSU(big.length);
  for (let i = 0; i < big.length; i++) for (let j = i + 1; j < big.length; j++) {
    const a = big[i].box.clone().expandByScalar(EPS);
    if (a.intersectsBox(big[j].box)) cl.union(i, j);
  }
  const clusters = new Map();
  big.forEach((isl, i) => {
    const r = cl.find(i);
    if (!clusters.has(r)) clusters.set(r, { verts: [], box: new THREE.Box3(), tris: 0 });
    const c2 = clusters.get(r);
    c2.verts.push(...isl.verts);
    c2.box.union(isl.box);
    c2.tris += isl.tris;
  });
  const pieces = [...clusters.values()].sort((a, b) => b.tris - a.tris);
  const gaps = [];
  for (let i = 1; i < Math.min(pieces.length, 8); i++) gaps.push(gapBetween(pieces[0], pieces[i], positions));
  const worstGap = gaps.length ? Math.max(...gaps) : 0;
  if (pieces.length > 1) notes.push(`${pieces.length} detached pieces, worst gap ${worstGap.toFixed(3)}`);

  const status = notes.length ? 'CHECK' : 'ok';
  if (notes.length) fails++;
  console.log(
    `${name.padEnd(14)} ${status.padEnd(6)} ` +
    `bbox ${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)} ` +
    `footZ ${box.min.z.toFixed(3)} tris ${String(tris).padStart(5)} ` +
    (notes.length ? `-> ${notes.join('; ')}` : '')
  );
  if (pieces.length > 1) {
    pieces.slice(0, 6).forEach((p, i) => {
      const s = p.box.getSize(new THREE.Vector3());
      const ctr = p.box.getCenter(new THREE.Vector3());
      console.log(`    piece ${i}: tris ${String(p.tris).padStart(4)} size ${s.x.toFixed(2)}x${s.y.toFixed(2)}x${s.z.toFixed(2)} at ${ctr.x.toFixed(2)},${ctr.y.toFixed(2)},${ctr.z.toFixed(2)} footZ ${p.box.min.z.toFixed(3)}`);
    });
  }
}
console.log(`\n${names.length - fails}/${names.length} clean`);
