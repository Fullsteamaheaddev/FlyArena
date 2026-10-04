/**
 * Recolor public/chaos/grenade.glb (+Z up): gold wrap bands, silver ball + cross.
 * The Sketchfab mesh is three radial shells around the origin: ball (rho ≈ 0.27),
 * raised band (rho ≈ 0.29, flattened to ≈ 0.283 here) and the cross (rho > 0.38). Faces on the band shell or
 * bridging ball→band (band side walls) are gold; ball and anything touching the
 * cross is silver. Ball and band top get radial normals so cel bands stay clean.
 * Idempotent: re-splits whatever meshes are in the file.
 * Run: node scripts/recolor_grenade.mjs
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
if (!globalThis.document) {
  globalThis.document = {
    createElement() {
      return {
        width: 4, height: 1,
        getContext() {
          return {
            createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
            putImageData() {},
          };
        },
      };
    },
  };
}

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import fs from 'fs';
import path from 'path';

const SRC = path.join('public', 'chaos', 'grenade.glb');
const OUTS = [SRC, path.join('public', 'grenade.glb')];

const BALL_R = 0.2765;
const BALL_MAX = 0.2775;
const BAND_MAX = 0.33;
// Source band stands ~0.018 proud of the ball (twice the cel ink width), which
// reads as a double outline at the silhouette; halve the relief once.
const TALL_BAND_MIN = 0.285;
const BAND_RELIEF = 0.5;
const shell = v => {
  const r = v.length();
  return r < BALL_MAX ? 'S' : r < BAND_MAX ? 'B' : 'C';
};

function loadGlb(file) {
  const buf = fs.readFileSync(file);
  return new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
}

function collectFaces(scene) {
  scene.updateMatrixWorld(true);
  const faces = [];
  scene.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    const p = (g.index ? g.toNonIndexed() : g).attributes.position;
    for (let i = 0; i < p.count; i += 3) {
      faces.push([0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(p, i + k)));
    }
  });
  return faces;
}

/** Y-up source (first bake) -> +Z up. */
function toZUp(faces) {
  const box = new THREE.Box3();
  for (const f of faces) for (const v of f) box.expandByPoint(v);
  const size = box.getSize(new THREE.Vector3());
  if (size.z >= size.y - 1e-6) return;
  const m = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  for (const f of faces) for (const v of f) v.applyMatrix4(m);
}

function flattenBand(faces) {
  const band = [];
  for (const f of faces) for (const v of f) {
    const r = v.length();
    if (r >= BALL_MAX && r < BAND_MAX) band.push(v);
  }
  const minR = Math.min(...band.map(v => v.length()));
  if (minR < TALL_BAND_MIN) return;
  const seen = new Set();
  for (const v of band) {
    if (seen.has(v)) continue;
    seen.add(v);
    const r = v.length();
    v.setLength(BALL_R + (r - BALL_R) * BAND_RELIEF);
  }
  console.log('band relief', (minR - BALL_R).toFixed(4), '->', ((minR - BALL_R) * BAND_RELIEF).toFixed(4));
}

function classify(face) {
  const s = face.map(shell);
  if (s.includes('C')) return 'cross';
  if (s.every(x => x === 'S')) return 'ball';
  if (s.every(x => x === 'B')) return 'band';
  return 'wall';
}

function buildGeo(faces, radialNormals) {
  const pos = [];
  const nrm = [];
  for (const f of faces) {
    const [a, b, c] = f;
    const fn = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    for (const v of f) {
      pos.push(v.x, v.y, v.z);
      const n = radialNormals ? v.clone().normalize() : fn;
      nrm.push(n.x, n.y, n.z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return mergeVertices(g, 1e-5);
}

function mat(name, color, metalness, roughness) {
  return new THREE.MeshStandardMaterial({ name, color, metalness, roughness });
}

const gltf = await loadGlb(SRC);
const faces = collectFaces(gltf.scene);
toZUp(faces);
const groups0 = faces.map(classify);
flattenBand(faces);

const groups = { ball: [], band: [], wall: [], cross: [] };
faces.forEach((f, i) => groups[groups0[i]].push(f));
console.log(Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])));

const silver = mat('GrenadeSilver', 0x9fa5ad, 0.55, 0.42);
const parts = [
  ['Hull', buildGeo(groups.ball, true), silver],
  ['WrapBand', buildGeo(groups.band, true), mat('GrenadeWrapGold', 0xf5a623, 0.75, 0.28)],
  ['WrapEdge', buildGeo(groups.wall, false), mat('GrenadeWrapGoldDeep', 0xd98516, 0.75, 0.32)],
  ['Cross', buildGeo(groups.cross, false), mat('GrenadeCrossSilver', 0xb0b6be, 0.55, 0.4)],
];

const root = new THREE.Group();
root.name = 'Grenade';
for (const [name, geo, m] of parts) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.name = name;
  root.add(mesh);
}
const scene = new THREE.Scene();
scene.add(root);
const result = await new Promise((resolve, reject) => {
  new GLTFExporter().parse(scene, resolve, reject, { binary: true });
});
const out = Buffer.from(result);
for (const dest of OUTS) {
  fs.writeFileSync(dest, out);
  console.log('wrote', dest, out.length);
}
