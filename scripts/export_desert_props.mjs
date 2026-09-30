/**
 * Bake Sugar Run desert map GLBs (+Z up, unit-normalised) into public/maps/desert/.
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
  return root;
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
  // stair ramp on the front face
  const stair = new THREE.BoxGeometry(0.16, 0.5, 0.02); stair.rotateX(-0.95); stair.translate(0, -0.34, 0.3);
  geos.push(prep(stair, SAND_LT));
  const root = new THREE.Group(); root.name = 'Pyramid';
  root.add(meshOf(geos, mat('#ffffff', 0.92, { vertexColors: true }), 'PyramidMesh'));
  return root;
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
  return root;
}

// ---------- arch (width 1, height 5/6) ----------
function buildArch() {
  const H = 5 / 6, geos = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.BoxGeometry(0.2, 0.23, H * 0.78, 1, 1, 3); jitter(leg, 0.02, 9); leg.translate(side * 0.4, 0, H * 0.39);
    geos.push(prep(leg, SAND_DK));
  }
  const ring = new THREE.TorusGeometry(0.3, 0.07, 6, 16, Math.PI); ring.rotateX(Math.PI / 2); ring.translate(0, 0, H * 0.62);
  geos.push(prep(ring, SAND));
  const lintel = new THREE.BoxGeometry(1.0, 0.25, 0.12); jitter(lintel, 0.02, 8); lintel.translate(0, 0, H * 0.95);
  geos.push(prep(lintel, SAND_LT));
  const rubble = new THREE.IcosahedronGeometry(0.09, 0); jitter(rubble, 0.12); rubble.translate(0.55, 0.18, 0.04);
  geos.push(prep(rubble, SAND_DK));
  const rubble2 = new THREE.IcosahedronGeometry(0.06, 0); jitter(rubble2, 0.12); rubble2.translate(-0.3, -0.2, 0.03);
  geos.push(prep(rubble2, SAND));
  const root = new THREE.Group(); root.name = 'Arch';
  root.add(meshOf(geos, mat('#ffffff', 0.92, { vertexColors: true }), 'ArchMesh'));
  return root;
}

// ---------- broken pillar (height 1) ----------
function buildPillar() {
  const geos = [];
  const shaft = new THREE.CylinderGeometry(0.28, 0.3, 1, 14, 4); zUp(shaft);
  const p = shaft.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(y, x), flute = 1 - 0.05 * (Math.cos(a * 14) > 0 ? 1 : 0);
    let zz = z + 0.5;
    if (zz > 0.9) zz = 0.85 + 0.15 * (0.5 + 0.5 * Math.sin(a * 3 + 1.2)) * rr(0.6, 1);   // jagged break
    p.setXYZ(i, x * flute, y * flute, zz);
  }
  shaft.computeVertexNormals();
  geos.push(prep(shaft, SAND_LT));
  const base = new THREE.BoxGeometry(0.72, 0.72, 0.1); base.translate(0, 0, 0.05);
  geos.push(prep(base, SAND_DK));
  const chunk = new THREE.CylinderGeometry(0.28, 0.28, 0.35, 12); chunk.rotateZ(Math.PI / 2); chunk.translate(0.55, 0.3, 0.28); jitter(chunk, 0.04);
  geos.push(prep(chunk, SAND));
  const root = new THREE.Group(); root.name = 'PillarBroken';
  root.add(meshOf(geos, mat('#ffffff', 0.9, { vertexColors: true }), 'PillarMesh'));
  return root;
}

// ---------- sandstone block (height 1) ----------
function buildBlock() {
  const g = new THREE.BoxGeometry(1.5, 1.1, 1, 3, 3, 2); jitter(g, 0.05, 5); g.translate(0, 0, 0.35);
  const root = new THREE.Group(); root.name = 'Block';
  root.add(meshOf([prep(g, SAND_DK)], mat('#ffffff', 0.95, { vertexColors: true }), 'BlockMesh'));
  return root;
}

// ---------- rocks (radius 1, height 1) ----------
function buildRock(name, detail, amp, tint) {
  const g = new THREE.IcosahedronGeometry(1, detail); jitter(g, amp, rr(3, 6));
  g.scale(1, rr(0.8, 1), 0.62); g.translate(0, 0, 0.42);
  const root = new THREE.Group(); root.name = name;
  root.add(meshOf([prep(g, tint)], mat('#ffffff', 0.95, { vertexColors: true, flatShading: true }), `${name}Mesh`));
  return root;
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
  return root;
}

// ---------- reed clump (height 1) ----------
function buildReed() {
  const geos = [];
  for (let k = 0; k < 5; k++) {
    const a = k / 5 * Math.PI * 2, h = rr(0.7, 1), lean = rr(0.05, 0.15);
    const blade = new THREE.ConeGeometry(0.018, h, 4, 4); zUp(blade); blade.translate(0, 0, h / 2);
    const p = blade.attributes.position;
    for (let i = 0; i < p.count; i++) { const z = p.getZ(i), t = z / h; p.setXY(i, p.getX(i) + Math.cos(a) * lean * t * t + Math.cos(a) * 0.03, p.getY(i) + Math.sin(a) * lean * t * t + Math.sin(a) * 0.03); }
    blade.computeVertexNormals();
    geos.push(prep(blade, k % 2 ? '#6f8f3a' : '#839c45', (pp, i) => [Math.max(0, pp.getZ(i)), 1]));
  }
  const head = zUp(new THREE.CapsuleGeometry(0.03, 0.12, 2, 6)); head.translate(0.04, 0, 0.9);
  geos.push(prep(head, '#6b4a2a', () => [0.9, 1]));
  const root = new THREE.Group(); root.name = 'Reed';
  root.add(meshOf(geos, mat('#ffffff', 0.8, { vertexColors: true }), 'ReedMesh'));
  return root;
}

// ---------- lily pad (radius 1) ----------
function buildLilypad() {
  const geos = [];
  const pad = new THREE.CircleGeometry(1, 20, 0.35, Math.PI * 2 - 0.35); pad.translate(0, 0, 0.01);
  geos.push(prep(pad, '#4f8a3b', (p, i) => [Math.hypot(p.getX(i), p.getY(i)) * 0.3, 1]));
  const flower = new THREE.ConeGeometry(0.28, 0.3, 6); zUp(flower); flower.translate(0.2, 0.15, 0.16);
  geos.push(prep(flower, '#f4b8d0', () => [0.3, 1]));
  const root = new THREE.Group(); root.name = 'Lilypad';
  root.add(meshOf(geos, mat('#ffffff', 0.5, { vertexColors: true, side: THREE.DoubleSide }), 'LilypadMesh'));
  return root;
}

// ---------- bleached skull (height 1) ----------
function buildSkull() {
  const geos = [], B = '#efe6d2';
  const cran = new THREE.SphereGeometry(0.42, 12, 10); cran.scale(1, 0.85, 0.75); cran.translate(0, 0, 0.35);
  geos.push(prep(cran, B));
  const snout = new THREE.CylinderGeometry(0.16, 0.26, 0.6, 10); snout.rotateZ(Math.PI / 2); snout.translate(0.5, 0, 0.25);
  geos.push(prep(snout, B));
  for (const s of [-1, 1]) {
    const horn = new THREE.TorusGeometry(0.35, 0.05, 6, 10, Math.PI * 0.6); horn.rotateX(Math.PI / 2); horn.rotateZ(s > 0 ? 0.2 : Math.PI - 0.2); horn.translate(-0.05, s * 0.28, 0.55);
    geos.push(prep(horn, '#d8cbb0'));
    const eye = new THREE.SphereGeometry(0.08, 8, 6); eye.translate(0.28, s * 0.2, 0.42);
    geos.push(prep(eye, '#2b241c'));
  }
  const root = new THREE.Group(); root.name = 'Skull';
  root.add(meshOf(geos, mat('#ffffff', 0.7, { vertexColors: true }), 'SkullMesh'));
  return root;
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
  return root;
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

await exportGlb('palm.glb', buildPalm());
await exportGlb('pyramid.glb', buildPyramid());
await exportGlb('obelisk.glb', buildObelisk());
await exportGlb('arch.glb', buildArch());
await exportGlb('pillar_broken.glb', buildPillar());
await exportGlb('block.glb', buildBlock());
await exportGlb('rock_a.glb', buildRock('RockA', 1, 0.18, '#a88458'));
await exportGlb('rock_b.glb', buildRock('RockB', 1, 0.22, '#9a7a52'));
await exportGlb('rock_c.glb', buildRock('RockC', 0, 0.2, '#b8956a'));
await exportGlb('pebble.glb', buildRock('Pebble', 0, 0.15, '#9c8866'));
await exportGlb('cactus.glb', buildCactus());
await exportGlb('reed.glb', buildReed());
await exportGlb('lilypad.glb', buildLilypad());
await exportGlb('skull.glb', buildSkull());
await exportGlb('tumbleweed.glb', buildTumbleweed());
console.log('Wrote desert GLBs to', outDir);
