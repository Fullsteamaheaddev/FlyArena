/**
 * Bake Flies Armageddon desert map GLBs (+Z up, unit-normalised) into public/maps/desert/.
 * Run: node scripts/export_desert_props.mjs
 *
 * Normalisation (the renderer scales at placement):
 *   palm, obelisk, pillar_broken, cactus, reed, skull, block: height 1
 *   pyramid: base 1 (height 2/3); arch: width 1 (height 5/6)
 *   rock_*, pebble: footprint radius 1, height 1; lilypad: radius 1; tumbleweed: radius 1
 * Swaying props (palm, reed, lilypad) carry a `_sway` vec2 attribute:
 *   x = bend weight 0..1 (trunk base -> crown, frond root -> tip), y = 1 on flutter (frond / blade) vertices.
 */
if (!globalThis.FileReader) {
  globalThis.FileReader = class FileReader {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then(buf => {
        this.result = buf;
        this.onload?.({ target: this });
        this.onloadend?.({ target: this });
      });
    }
  };
}
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import fs from 'fs';
import path from 'path';

const outDir = path.join('public', 'maps', 'desert');
fs.mkdirSync(outDir, { recursive: true });

let seed = 7;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const rr = (a, b) => a + (b - a) * rand();

const mat = (color, rough = 0.85, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });
const SAND = '#d9b27a', SAND_DK = '#b88d55', SAND_LT = '#e8c992';

/** Y-up primitive -> Z-up */
const zUp = g => g.rotateX(Math.PI / 2);

/** every geometry gets the same attribute set so they can be merged */
function prep(g, color, sway = null) {
  g = g.index ? g.toNonIndexed() : g;
  const n = g.attributes.position.count, c = new THREE.Color(color), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const sw = new Float32Array(n * 2);
  if (sway) for (let i = 0; i < n; i++) { const [w, f] = sway(g.attributes.position, i); sw[i * 2] = w; sw[i * 2 + 1] = f; }
  g.setAttribute('_sway', new THREE.BufferAttribute(sw, 2));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', '_sway'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}
function jitter(g, amp, freq = 7) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = Math.sin(x * freq + y * 5.1) * Math.cos(z * freq * 0.9 + x * 2.3) + 0.5 * Math.sin(y * freq * 1.7 - z * 3.1);
    p.setXYZ(i, x * (1 + n * amp), y * (1 + n * amp), z * (1 + n * amp * 0.6));
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}
const meshOf = (geos, material, name) => { const m = new THREE.Mesh(mergeGeometries(geos), material); m.name = name; return m; };

/** a tapered cylinder spanning p0 -> p1, for chaining segments along a curve */
function limb(p0, p1, r0, r1, seg = 6) {
  const d = new THREE.Vector3().subVectors(p1, p0), len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.divideScalar(len)));
  g.translate(p0.x, p0.y, p0.z);
  return g;
}

const applyToAll = (root, m) => { root.traverse(o => { if (o.isMesh) o.geometry.applyMatrix4(m); }); return root; };

/**
 * Fold node transforms into the geometry. The desert renderer instances raw
 * `mesh.geometry` (src/race-map-assets.js -> race-map-desert.js), so anything left
 * on a node is invisible in game even though the prop studio shows it.
 */
function bake(root) {
  root.updateMatrixWorld(true);
  const jobs = [];
  root.traverse(o => { if (o.isMesh) jobs.push([o.geometry, o.matrixWorld.clone()]); });
  for (const [g, m] of jobs) g.applyMatrix4(m);
  root.traverse(o => { o.position.set(0, 0, 0); o.quaternion.identity(); o.scale.set(1, 1, 1); });
  root.updateMatrixWorld(true);
  return root;
}

/**
 * Enforce the normalisation contract in geometry space.
 *   h  target height            w  target X width          r  target footprint radius
 *   centerXY false keeps the authored origin (trunk / shaft axis)
 *   anchor 'center' keeps the origin at the middle (rolling tumbleweed), else foot at z 0
 * Giving both a footprint and a height scales XY and Z separately, which matches how
 * propScale() drives those kinds.
 */
function normalize(root, spec = {}) {
  bake(root);
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  let sxy = spec.w !== undefined ? spec.w / size.x
    : spec.r !== undefined ? 2 * spec.r / Math.max(size.x, size.y)
      : undefined;
  let sz = spec.h !== undefined ? spec.h / size.z : undefined;
  if (sxy === undefined) sxy = sz;
  if (sz === undefined) sz = sxy;
  applyToAll(root, new THREE.Matrix4().makeScale(sxy, sxy, sz));
  root.traverse(o => { if (o.isMesh) o.geometry.normalizeNormals(); });

  const box = new THREE.Box3().setFromObject(root);
  const ctr = box.getCenter(new THREE.Vector3());
  applyToAll(root, new THREE.Matrix4().makeTranslation(
    spec.centerXY === false ? 0 : -ctr.x,
    spec.centerXY === false ? 0 : -ctr.y,
    spec.anchor === 'center' ? -ctr.z : -box.min.z,
  ));
  return root;
}

// ---------- palm ----------
function buildPalm() {
  const root = new THREE.Group(); root.name = 'Palm';
  const lean = 0.12, top = new THREE.Vector3(lean, 0.02, 1);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, -0.02), new THREE.Vector3(0.01, 0, 0.3), new THREE.Vector3(0.05, 0.01, 0.65), top]);
  const segs = 24, radial = 8, pos = [], idx = [], rings = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, c = curve.getPointAt(t), tan = curve.getTangentAt(t);
    const nrm = new THREE.Vector3(1, 0, 0).cross(tan).normalize(), bin = tan.clone().cross(nrm).normalize();
    const r = 0.045 * (1 - 0.35 * t) * (1 + 0.12 * ((i % 3) === 0 ? 1 : 0));   // stepped ring bulges
    for (let k = 0; k < radial; k++) {
      const a = k / radial * Math.PI * 2;
      pos.push(c.x + r * (Math.cos(a) * nrm.x + Math.sin(a) * bin.x), c.y + r * (Math.cos(a) * nrm.y + Math.sin(a) * bin.y), c.z + r * (Math.cos(a) * nrm.z + Math.sin(a) * bin.z));
      rings.push(i);
    }
  }
  for (let i = 0; i < segs; i++) for (let k = 0; k < radial; k++) {
    const a = i * radial + k, b = i * radial + (k + 1) % radial, c = a + radial, d = b + radial;
    idx.push(a, b, c, b, d, c);
  }
  let trunk = new THREE.BufferGeometry();
  trunk.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); trunk.setIndex(idx); trunk.computeVertexNormals();
  trunk = trunk.toNonIndexed();
  const tp = trunk.attributes.position, tc = new Float32Array(tp.count * 3), ts = new Float32Array(tp.count * 2);
  const light = new THREE.Color('#9a7650'), dark = new THREE.Color('#6d5134');
  for (let i = 0; i < tp.count; i++) {
    const z = tp.getZ(i), band = (Math.floor(z * 26) & 1) ? light : dark;
    tc[i * 3] = band.r; tc[i * 3 + 1] = band.g; tc[i * 3 + 2] = band.b;
    ts[i * 2] = Math.max(0, Math.min(1, z)); ts[i * 2 + 1] = 0;
  }
  trunk.setAttribute('color', new THREE.BufferAttribute(tc, 3)); trunk.setAttribute('_sway', new THREE.BufferAttribute(ts, 2));
  root.add(meshOf([trunk], mat('#ffffff', 0.9, { vertexColors: true }), 'PalmTrunk'));

  // coconuts ride the crown
  const nuts = [];
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * Math.PI * 2 + 0.4, g = new THREE.SphereGeometry(0.03, 8, 6);
    g.translate(top.x + 0.035 * Math.cos(a), top.y + 0.035 * Math.sin(a), top.z - 0.035);
    nuts.push(prep(g, '#5a3f22', () => [1, 0]));
  }
  // crown knob
  const knob = new THREE.SphereGeometry(0.05, 10, 8); knob.scale(1, 1, 0.7); knob.translate(top.x, top.y, top.z);
  nuts.push(prep(knob, '#6b5a2e', () => [1, 0]));
  root.add(meshOf(nuts, mat('#ffffff', 0.8, { vertexColors: true }), 'PalmNuts'));

  // fronds: arched spines with V-folded leaflet ribbons, weight 0 at the crown -> 1 at the tip
  const fronds = [], NF = 9, SEG = 10;
  for (let f = 0; f < NF; f++) {
    const az = f / NF * Math.PI * 2 + rr(-0.15, 0.15), len = rr(0.42, 0.52), rise = rr(0.05, 0.12), droop = rr(0.28, 0.4);
    const ux = Math.cos(az), uy = Math.sin(az), sx = -uy, sy = ux;
    const P = [], I = [], S = [];
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG, d = len * t, z = top.z + rise * Math.sin(t * Math.PI * 0.6) - droop * t * t;
      const w = 0.075 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.05)) * (1 - 0.3 * t), fold = w * 0.35;
      const cx = top.x + ux * d, cy = top.y + uy * d;
      P.push(cx + sx * w, cy + sy * w, z - fold, cx, cy, z + 0.004, cx - sx * w, cy - sy * w, z - fold);
      S.push(t, 1, t, 1, t, 1);
    }
    for (let i = 0; i < SEG; i++) {
      const a = i * 3;
      I.push(a, a + 1, a + 3, a + 1, a + 4, a + 3, a + 1, a + 2, a + 4, a + 2, a + 5, a + 4);
    }
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('_sway', new THREE.Float32BufferAttribute(S, 2));
    g.setIndex(I); g.computeVertexNormals(); g = g.toNonIndexed();
    const col = new Float32Array(g.attributes.position.count * 3), cc = new THREE.Color(f % 2 ? '#4f8f34' : '#62a23c');
    for (let i = 0; i < g.attributes.position.count; i++) {
      const t = g.attributes._sway.getX(i), k = 1 - 0.25 * t;
      col[i * 3] = cc.r * k + 0.08 * t; col[i * 3 + 1] = cc.g * k + 0.05 * t; col[i * 3 + 2] = cc.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    fronds.push(g);
  }
  root.add(meshOf(fronds, mat('#ffffff', 0.7, { vertexColors: true, side: THREE.DoubleSide }), 'PalmFronds'));
  return normalize(root, { h: 1, centerXY: false });   // origin = trunk base
}

// ---------- stepped pyramid (base 1, height 2/3) ----------
function buildPyramid() {
  const tiers = 6, H = 2 / 3, geos = [];
  for (let i = 0; i < tiers; i++) {
    const s = 1 - i / tiers * 0.86, h = H / tiers, g = new THREE.BoxGeometry(s, s, h * 1.02, 2, 2, 1);
    jitter(g, 0.012, 11); g.translate(0, 0, h * (i + 0.5));
    geos.push(prep(g, i % 2 ? SAND : SAND_DK));
  }
  const cap = zUp(new THREE.ConeGeometry(0.1, 0.09, 4)); cap.rotateZ(Math.PI / 4); cap.translate(0, 0, H + 0.04);
  geos.push(prep(cap, '#e6c47f'));
  // stair: each step fills one tier's step corner, running from that tier's face back to the
  // next tier's face at that tier's height, so treads and risers line up into one flight and
  // every step rests on the tier below.
  const hw = i => (1 - i / tiers * 0.86) * 0.5;
  for (let i = 0; i < tiers; i++) {
    const h = H / tiers, yOut = -hw(i - 1), yIn = -hw(i);
    const step = new THREE.BoxGeometry(0.3, yIn - yOut, h);
    step.translate(0, (yOut + yIn) / 2, h * (i + 0.5));
    geos.push(prep(step, SAND_LT));
  }
  const root = new THREE.Group(); root.name = 'Pyramid';
  root.add(meshOf(geos, mat('#ffffff', 0.92, { vertexColors: true }), 'PyramidMesh'));
  return normalize(root, { w: 1, h: H });
}

// ---------- obelisk (height 1) ----------
function buildObelisk() {
  const geos = [];
  const shaft = new THREE.CylinderGeometry(0.045 * Math.SQRT2, 0.065 * Math.SQRT2, 0.9, 4, 6); zUp(shaft); shaft.rotateZ(Math.PI / 4); shaft.translate(0, 0, 0.45);
  geos.push(prep(shaft, '#cfa56b'));
  const tip = new THREE.ConeGeometry(0.045 * Math.SQRT2, 0.1, 4); zUp(tip); tip.rotateZ(Math.PI / 4); tip.translate(0, 0, 0.95);
  geos.push(prep(tip, '#e9c35a'));
  for (const z of [0.25, 0.5, 0.72]) {
    const s = 0.065 - 0.022 * z;
    const band = new THREE.BoxGeometry(s * 2.06, s * 2.06, 0.02); band.translate(0, 0, z);
    geos.push(prep(band, '#8a6a3c'));
  }
  const plinth = new THREE.BoxGeometry(0.17, 0.17, 0.05); plinth.translate(0, 0, 0.025);
  geos.push(prep(plinth, SAND_DK));
  const root = new THREE.Group(); root.name = 'Obelisk';
  root.add(meshOf(geos, mat('#ffffff', 0.8, { vertexColors: true }), 'ObeliskMesh'));
  return normalize(root, { h: 1 });
}

// ---------- arch (width 1, height 5/6) ----------
// Masonry gateway: the voussoir ring shares the piers' radial thickness, so the arch
// springs exactly off the pier tops (intrados = inner face, extrados = outer face).
function buildArch() {
  const H = 5 / 6;
  const pierW = 0.19;              // radial thickness, shared by piers and arch ring
  const depth = 0.24;              // Y thickness
  const R = 0.5 - pierW;           // intrados radius -> opening spans +/-R
  const springZ = H - 0.5;         // a full-width semicircle rises exactly half the width
  const geos = [];

  for (const side of [-1, 1]) {
    const pier = new THREE.BoxGeometry(pierW, depth, springZ, 1, 1, 3);
    jitter(pier, 0.01, 9);
    pier.translate(side * (0.5 - pierW / 2), 0, springZ * 0.5);
    geos.push(prep(pier, side > 0 ? SAND_DK : SAND));
    const plinth = new THREE.BoxGeometry(pierW * 1.28, depth * 1.15, 0.045);
    plinth.translate(side * (0.5 - pierW / 2), 0, 0.0225);
    geos.push(prep(plinth, SAND_DK));
  }

  const N = 9, Rm = R + pierW / 2, step = Math.PI / N;
  for (let k = 0; k < N; k++) {
    const th = (k + 0.5) * step;
    const keystone = k === (N - 1) / 2;
    const radial = pierW * (keystone ? 1.16 : 1);
    // size the tangential span to the extrados pitch, else the joints open into V gaps
    // on the outside; the surplus overlaps harmlessly towards the intrados
    const v = new THREE.BoxGeometry(radial, depth, (R + pierW) * step);
    jitter(v, 0.004, 9);
    v.rotateY(-th);
    v.translate(Math.cos(th) * Rm, 0, springZ + Math.sin(th) * Rm);
    geos.push(prep(v, keystone ? SAND_LT : (k % 2 ? SAND : SAND_DK)));
  }

  // runes on the keystone and pier faces, each half sunk into its face
  const glyph = (x, z) => {
    const g = new THREE.BoxGeometry(0.03, 0.016, 0.026);
    g.translate(x, depth / 2, z);
    geos.push(prep(g, '#8a6a3c'));
  };
  glyph(0, H - 0.07);
  for (const side of [-1, 1]) {
    const px = side * (0.5 - pierW / 2);
    glyph(px, springZ * 0.68);
    glyph(px, springZ * 0.4);
  }

  // rubble stays inside the footprint so it never drives the width contract
  const rubble = new THREE.IcosahedronGeometry(0.07, 0);
  jitter(rubble, 0.06);
  rubble.translate(0.3, 0.13, 0.03);
  geos.push(prep(rubble, SAND_DK));
  const rubble2 = new THREE.IcosahedronGeometry(0.05, 0);
  jitter(rubble2, 0.06);
  rubble2.translate(-0.24, -0.12, 0.024);
  geos.push(prep(rubble2, SAND));

  const root = new THREE.Group();
  root.name = 'Arch';
  root.add(meshOf(geos, mat('#ffffff', 0.92, { vertexColors: true }), 'ArchMesh'));
  return normalize(root, { w: 1, h: H, centerXY: false });   // origin = gateway centre
}

// ---------- broken pillar (height 1) ----------
function buildPillar() {
  const geos = [];
  // keep the shaft near r 0.3: sim/maps/desert.js gives pillars a r 0.35 collider and the
  // renderer scales XY by 1.17, so a slimmer shaft would leave an invisible wall
  const FL = 14;
  const shaft = new THREE.CylinderGeometry(0.28, 0.3, 1, FL * 2, 6); zUp(shaft);
  const p = shaft.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(y, x);
    const flute = 1 - 0.055 * (0.5 + 0.5 * Math.cos(a * FL));   // smooth flutes survive low poly
    // shear the top off along a wavy fracture instead of per-vertex noise
    const brk = 0.84 + 0.13 * (0.5 + 0.5 * Math.sin(a * 3 + 1.2)) + 0.025 * Math.sin(a * 7 - 0.4);
    p.setXYZ(i, x * flute, y * flute, Math.min(z + 0.5, brk));
  }
  shaft.computeVertexNormals();
  geos.push(prep(shaft, SAND_LT));
  const base = new THREE.BoxGeometry(0.78, 0.78, 0.07); base.translate(0, 0, 0.035);
  geos.push(prep(base, SAND_DK));
  const step = new THREE.BoxGeometry(0.66, 0.66, 0.06); step.translate(0, 0, 0.1);
  geos.push(prep(step, SAND));
  const chunk = new THREE.CylinderGeometry(0.17, 0.17, 0.24, 10); chunk.rotateZ(Math.PI / 2); chunk.translate(0.5, 0.25, 0.17); jitter(chunk, 0.03);
  geos.push(prep(chunk, SAND));
  const root = new THREE.Group(); root.name = 'PillarBroken';
  root.add(meshOf(geos, mat('#ffffff', 0.9, { vertexColors: true }), 'PillarMesh'));
  return normalize(root, { h: 1, centerXY: false });   // origin = shaft axis, chunk lies beside it
}

// ---------- sandstone block (height 1) ----------
// Two stacked courses rather than one crate, so the silhouette has a step and a shadow line.
function buildBlock() {
  const lowH = 0.3, topH = 0.24;
  const low = new THREE.BoxGeometry(0.92, 0.72, lowH, 3, 3, 1);
  jitter(low, 0.035, 5);
  low.translate(0, 0, lowH * 0.5);
  const geos = [prep(low, SAND_DK)];

  const top = new THREE.BoxGeometry(0.72, 0.54, topH, 3, 3, 1);
  jitter(top, 0.03, 7);
  top.rotateZ(0.08);
  top.translate(0.03, -0.02, lowH + topH * 0.5 - 0.01);
  geos.push(prep(top, SAND));

  // runes sit half sunk in the lower course's flat -Y face, the side the reference view shows
  for (let i = 0; i < 4; i++) {
    const rune = new THREE.BoxGeometry(0.07, 0.024, 0.05);
    rune.translate(-0.21 + i * 0.14, -0.36, lowH * 0.58);
    geos.push(prep(rune, '#8a6a3c'));
  }
  const root = new THREE.Group(); root.name = 'Block';
  root.add(meshOf(geos, mat('#ffffff', 0.95, { vertexColors: true }), 'BlockMesh'));
  return normalize(root, { h: 1 });
}

// ---------- rocks (radius 1, height 1) ----------
function buildRock(name, detail, amp, tint) {
  const g = new THREE.IcosahedronGeometry(1, detail); jitter(g, amp, rr(3, 6));
  g.scale(1, rr(0.8, 1), 0.62); g.translate(0, 0, 0.42);
  // shear the buried cap off so the rock has a flat base and reads as half sunk in the sand
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getZ(i) < 0) p.setZ(i, 0);
  g.computeVertexNormals();
  const root = new THREE.Group(); root.name = name;
  root.add(meshOf([prep(g, tint)], mat('#ffffff', 0.95, { vertexColors: true, flatShading: true }), `${name}Mesh`));
  return normalize(root, { r: 1, h: 1 });
}

// ---------- saguaro cactus (height 1) ----------
function buildCactus() {
  const geos = [], C = '#4d7a3a';
  const ribs = g => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), a = Math.atan2(y, x), k = 1 + 0.08 * Math.cos(a * 8); p.setXY(i, x * k, y * k); } g.computeVertexNormals(); return g; };
  const trunk = ribs(zUp(new THREE.CapsuleGeometry(0.09, 0.8, 4, 16))); trunk.translate(0, 0, 0.5);
  geos.push(prep(trunk, C));
  for (const [side, h, len] of [[1, 0.42, 0.28], [-1, 0.55, 0.22]]) {
    const out = zUp(new THREE.CapsuleGeometry(0.055, 0.12, 3, 12)); out.rotateY(side * Math.PI / 2); out.translate(side * 0.13, 0, h);
    geos.push(prep(ribs(out), C));
    const up = ribs(zUp(new THREE.CapsuleGeometry(0.06, len, 3, 12))); up.translate(side * 0.21, 0, h + len / 2 + 0.03);
    geos.push(prep(up, C));
  }
  const flower = new THREE.SphereGeometry(0.04, 8, 6); flower.translate(0, 0, 0.99);
  geos.push(prep(flower, '#f2d25a'));
  const root = new THREE.Group(); root.name = 'Cactus';
  root.add(meshOf(geos, mat('#ffffff', 0.75, { vertexColors: true }), 'CactusMesh'));
  return normalize(root, { h: 1, centerXY: false });   // origin = trunk axis
}

// ---------- reed clump / cattail (height 1) ----------
// A straight centre stem carries the spike so the two always read as joined; the leaf blades
// are tapered prisms rather than cones, because a cone tip goes sub-pixel and looks broken off.
function buildReed() {
  const geos = [];
  const sway = (pp, i) => [Math.max(0, Math.min(1, pp.getZ(i))), 1];

  const stemH = 0.86;
  const stem = zUp(new THREE.CylinderGeometry(0.011, 0.016, stemH, 5));
  stem.translate(0, 0, stemH / 2);
  geos.push(prep(stem, '#7d9440', sway));

  const head = zUp(new THREE.CapsuleGeometry(0.036, 0.15, 3, 9));
  head.translate(0, 0, stemH - 0.04);
  geos.push(prep(head, '#6b4a2a', () => [0.9, 1]));

  const bladeHs = [0.62, 0.74, 0.55, 0.69, 0.5, 0.66];
  for (let k = 0; k < bladeHs.length; k++) {
    const a = k / bladeHs.length * Math.PI * 2 + 0.3;
    const h = bladeHs[k];
    const lean = 0.1 + k * 0.012;
    const blade = zUp(new THREE.CylinderGeometry(0.006, 0.026, h, 4));
    blade.translate(0, 0, h / 2);
    const p = blade.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = p.getZ(i) / h;
      const d = lean * t * t + 0.016;
      p.setXY(i, p.getX(i) + Math.cos(a) * d, p.getY(i) + Math.sin(a) * d);
    }
    blade.computeVertexNormals();
    geos.push(prep(blade, k % 2 ? '#6f8f3a' : '#839c45', sway));
  }

  const root = new THREE.Group(); root.name = 'Reed';
  root.add(meshOf(geos, mat('#ffffff', 0.8, { vertexColors: true }), 'ReedMesh'));
  return normalize(root, { h: 1, centerXY: false });   // origin = clump centre
}

// ---------- grass tuft (height 1, blades only — dish map) ----------
function buildGrass() {
  const geos = [];
  const sway = (pp, i) => [Math.max(0, Math.min(1, pp.getZ(i))), 1];
  const bladeHs = [0.72, 0.88, 0.95, 0.82, 1.0, 0.9, 0.78, 0.93, 0.86, 0.98, 0.84, 0.91];
  for (let k = 0; k < bladeHs.length; k++) {
    const a = k / bladeHs.length * Math.PI * 2 + 0.15;
    const h = bladeHs[k];
    const lean = 0.08 + k * 0.01;
    // Open-ended, needle tip: closed square caps show as black tiles under the inverted-hull outline.
    const blade = zUp(new THREE.CylinderGeometry(0.0012, 0.026, h, 4, 1, true));
    blade.translate(0, 0, h / 2);
    const p = blade.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = p.getZ(i) / h;
      const d = lean * t * t + 0.012;
      p.setXY(i, p.getX(i) + Math.cos(a) * d, p.getY(i) + Math.sin(a) * d);
    }
    blade.computeVertexNormals();
    geos.push(prep(blade, k % 2 ? '#6f8f3a' : '#839c45', sway));
  }
  const root = new THREE.Group(); root.name = 'Grass';
  root.add(meshOf(geos, mat('#ffffff', 0.8, { vertexColors: true }), 'GrassMesh'));
  return normalize(root, { h: 1, centerXY: false });
}

// ---------- lily pad (radius 1) ----------
function buildLilypad() {
  const geos = [];
  // A shallow open cone with the apex downwards is a near flat pad that keeps the dished centre
  // and upturned rim of a real lily; the theta gap leaves the characteristic notch.
  const pad = new THREE.ConeGeometry(1, 0.075, 24, 1, true, 0.35, Math.PI * 2 - 0.35);
  pad.rotateX(-Math.PI / 2);
  geos.push(prep(pad, '#4f8a3b', (p, i) => [Math.hypot(p.getX(i), p.getY(i)) * 0.3, 1]));

  // bloom: a yellow core ringed by tapered petals, kept small so it reads as a flower
  const fx = -0.18, fy = 0.26, fz = 0.07;   // clear of the notch, which is on +X
  const core = zUp(new THREE.SphereGeometry(0.05, 8, 6)); core.scale(1, 1, 0.7);
  core.translate(fx, fy, fz + 0.01);
  geos.push(prep(core, '#f2d85c', () => [0.3, 1]));
  for (let k = 0; k < 7; k++) {
    const petal = zUp(new THREE.CylinderGeometry(0.05, 0.006, 0.15, 4));   // wide end is the tip
    petal.translate(0, 0, 0.075);
    petal.rotateY(1.1);
    petal.rotateZ(k / 7 * Math.PI * 2);
    petal.translate(fx, fy, fz);
    geos.push(prep(petal, k % 2 ? '#f4b8d0' : '#f7dcea', () => [0.3, 1]));
  }
  const root = new THREE.Group(); root.name = 'Lilypad';
  root.add(meshOf(geos, mat('#ffffff', 0.5, { vertexColors: true, side: THREE.DoubleSide }), 'LilypadMesh'));
  return normalize(root, { r: 1, centerXY: false });   // origin = pad centre
}

// ---------- bleached skull (height 1) ----------
function buildSkull() {
  const geos = [], B = '#efe6d2';
  const cran = new THREE.SphereGeometry(0.42, 12, 10); cran.scale(1, 0.85, 0.75); cran.translate(0, 0, 0.35);
  geos.push(prep(cran, B));

  // muzzle narrows towards the nose and droops; the other way round reads as a megaphone
  const snout = new THREE.CylinderGeometry(0.115, 0.21, 0.54, 9);
  snout.rotateZ(-Math.PI / 2);
  snout.scale(1, 1, 0.85);
  snout.rotateY(0.14);
  snout.translate(0.44, 0, 0.3);
  geos.push(prep(snout, B));
  const nose = new THREE.CylinderGeometry(0.06, 0.06, 0.04, 8);
  nose.rotateZ(-Math.PI / 2); nose.translate(0.685, 0, 0.262);
  geos.push(prep(nose, '#3a3026'));
  // cheek mass fills the corner where the muzzle meets the braincase, hiding the seam
  const cheek = new THREE.SphereGeometry(0.21, 10, 8);
  cheek.scale(1, 0.92, 0.88); cheek.translate(0.23, 0, 0.32);
  geos.push(prep(cheek, B));

  for (const s of [-1, 1]) {
    // horn: tapered segments along a curve whose root starts inside the braincase, so it grows
    // out of the skull instead of hovering beside it
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.04, s * 0.13, 0.45),
      new THREE.Vector3(-0.12, s * 0.34, 0.55),
      new THREE.Vector3(-0.11, s * 0.50, 0.72),
      new THREE.Vector3(0.00, s * 0.52, 0.90),
      new THREE.Vector3(0.13, s * 0.41, 0.98),
    ]);
    const N = 12, rad = t => 0.08 * (1 - t) + 0.011 * t;
    for (let k = 0; k < N; k++) {
      const t0 = k / N, t1 = (k + 1) / N;
      geos.push(prep(limb(curve.getPoint(t0), curve.getPoint(t1), rad(t0), rad(t1)), '#d8cbb0'));
    }
    // socket: a dark lens barely breaking the surface, not a protruding eyeball
    const eye = new THREE.SphereGeometry(0.1, 10, 8);
    eye.scale(1, 0.32, 1);
    eye.translate(0.16, s * 0.28, 0.47);
    geos.push(prep(eye, '#2b241c'));
  }
  const root = new THREE.Group(); root.name = 'Skull';
  root.add(meshOf(geos, mat('#ffffff', 0.7, { vertexColors: true }), 'SkullMesh'));
  return normalize(root, { h: 1 });
}

// ---------- tumbleweed (radius 1) ----------
function buildTumbleweed() {
  const geos = [];
  for (let k = 0; k < 16; k++) {
    const t = new THREE.TorusGeometry(rr(0.55, 0.95), 0.03, 3, 16);
    t.rotateX(rr(0, Math.PI)); t.rotateY(rr(0, Math.PI)); t.rotateZ(rr(0, Math.PI));
    geos.push(prep(t, k % 3 ? '#a58657' : '#8d6f45'));
  }
  const root = new THREE.Group(); root.name = 'Tumbleweed';
  root.add(meshOf(geos, mat('#ffffff', 0.95, { vertexColors: true }), 'TumbleweedMesh'));
  // race-map-desert.js places these at ground + r and rolls them, so the origin is the centre
  return normalize(root, { r: 1, anchor: 'center' });
}

function exportGlb(filename, object) {
  const scene = new THREE.Scene();
  scene.add(object);
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(scene, result => {
      fs.writeFileSync(path.join(outDir, filename), Buffer.from(result));
      resolve();
    }, reject, { binary: true });
  });
}

const jobs = {
  palm: () => exportGlb('palm.glb', buildPalm()),
  pyramid: () => exportGlb('pyramid.glb', buildPyramid()),
  obelisk: () => exportGlb('obelisk.glb', buildObelisk()),
  arch: () => exportGlb('arch.glb', buildArch()),
  pillar_broken: () => exportGlb('pillar_broken.glb', buildPillar()),
  block: () => exportGlb('block.glb', buildBlock()),
  rock_a: () => exportGlb('rock_a.glb', buildRock('RockA', 1, 0.18, '#a88458')),
  rock_b: () => exportGlb('rock_b.glb', buildRock('RockB', 1, 0.22, '#9a7a52')),
  rock_c: () => exportGlb('rock_c.glb', buildRock('RockC', 0, 0.2, '#b8956a')),
  pebble: () => exportGlb('pebble.glb', buildRock('Pebble', 0, 0.15, '#9c8866')),
  cactus: () => exportGlb('cactus.glb', buildCactus()),
  reed: () => exportGlb('reed.glb', buildReed()),
  grass: () => exportGlb('grass.glb', buildGrass()),
  lilypad: () => exportGlb('lilypad.glb', buildLilypad()),
  skull: () => exportGlb('skull.glb', buildSkull()),
  tumbleweed: () => exportGlb('tumbleweed.glb', buildTumbleweed()),
};
const pick = process.argv[2];
for (const [name, run] of Object.entries(jobs)) {
  if (pick && pick !== name) continue;
  await run();
}
console.log('Wrote desert GLBs to', outDir, pick ? `(${pick})` : '(all)');
