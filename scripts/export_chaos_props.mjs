/**
 * Bake chaos wildcard GLBs (+Z up) for public/chaos/. Run: node scripts/export_chaos_props.mjs
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
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import fs from 'fs';
import path from 'path';

const outDir = path.join('public', 'chaos');
fs.mkdirSync(outDir, { recursive: true });

function mat(color, metal = 0.1, rough = 0.65, emissive = 0x000000, emInt = 0) {
  return new THREE.MeshStandardMaterial({
    color, metalness: metal, roughness: rough, emissive, emissiveIntensity: emInt,
  });
}

let celGradientMap = null;
function celGradient() {
  if (!celGradientMap) {
    const data = new Uint8Array([28, 150, 255]);
    celGradientMap = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
    celGradientMap.minFilter = THREE.NearestFilter;
    celGradientMap.magFilter = THREE.NearestFilter;
    celGradientMap.needsUpdate = true;
  }
  return celGradientMap;
}

function toonMat(color) {
  return new THREE.MeshToonMaterial({ color, gradientMap: celGradient() });
}

/** Matte silver-grey saucer (+Z up). Side + low-angle reference silhouettes. */
function hullSilver(rough = 0.48) {
  return mat('#aeb4be', 0.5, rough);
}

function hullSilverDark(rough = 0.56) {
  return mat('#6f7680', 0.48, rough);
}

function blueGlow(emInt = 1.15) {
  return mat('#7ec8ff', 0.1, 0.38, 0x3aa8ff, emInt);
}

/** Rim running lights — unlit so GLB + studio always show a bright panel. */
function blueLampMat() {
  const m = new THREE.MeshBasicMaterial({ color: 0x66e8ff });
  m.toneMapped = false;
  return m;
}

function whiteGlow(emInt = 2.1) {
  return mat('#ffffff', 0, 0.12, 0xffffff, emInt);
}

function saucerProfilePoints() {
  // Thick flying saucer; beefy filleted outer rim (vertical band at max radius).
  return [
    new THREE.Vector2(0, -0.116),
    new THREE.Vector2(0.12, -0.128),
    new THREE.Vector2(0.32, -0.122),
    new THREE.Vector2(0.58, -0.094),
    new THREE.Vector2(0.82, -0.056),
    new THREE.Vector2(0.9, -0.038),
    new THREE.Vector2(0.96, -0.026),
    new THREE.Vector2(0.988, -0.017),
    new THREE.Vector2(1.0, -0.006),
    new THREE.Vector2(1.0, 0.018),
    new THREE.Vector2(0.988, 0.028),
    new THREE.Vector2(0.96, 0.038),
    new THREE.Vector2(0.9, 0.048),
    new THREE.Vector2(0.72, 0.068),
    new THREE.Vector2(0.58, 0.094),
    new THREE.Vector2(0.32, 0.122),
    new THREE.Vector2(0.26, 0.128),
    new THREE.Vector2(0.2, 0.138),
    new THREE.Vector2(0.176, 0.208),
    new THREE.Vector2(0.168, 0.258),
    new THREE.Vector2(0, 0.258),
  ];
}

function zUp(mesh) {
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function buildUfo() {
  const root = new THREE.Group();
  root.name = 'UfoRoot';

  const hull = zUp(new THREE.Mesh(new THREE.LatheGeometry(saucerProfilePoints(), 96), hullSilver(0.48)));
  root.add(hull);

  const rimZ = 0.006;
  const rLight = 1.004;

  const rimPocket = new THREE.Mesh(
    new THREE.RingGeometry(0.948, 0.992, 96),
    hullSilverDark(0.72),
  );
  rimPocket.position.z = rimZ - 0.003;
  root.add(rimPocket);

  const rimLipInner = new THREE.Mesh(
    new THREE.RingGeometry(0.936, 0.948, 96),
    hullSilver(0.5),
  );
  rimLipInner.position.z = rimZ + 0.002;
  root.add(rimLipInner);

  const nRim = 40;
  const seg = (Math.PI * 2) / nRim;
  const litFrac = 0.62;
  const lampZ = 0.022;
  const tang = seg * litFrac * rLight;
  const lampGeo = new THREE.BoxGeometry(tang, 0.011, lampZ);
  const lampMat = blueLampMat();
  for (let i = 0; i < nRim; i++) {
    const a = i * seg + seg * 0.5;
    const cx = Math.cos(a) * rLight;
    const cy = Math.sin(a) * rLight;
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.name = i === 0 ? 'RimLamp' : `RimLamp_${i}`;
    lamp.position.set(cx, cy, rimZ);
    lamp.rotation.z = a + Math.PI / 2;
    lamp.renderOrder = 3;
    root.add(lamp);
  }

  const steps = [
    [0.24, 0.04, -0.118],
    [0.16, 0.036, -0.154],
    [0.105, 0.034, -0.186],
    [0.072, 0.026, -0.212],
  ];
  for (let si = 0; si < steps.length; si++) {
    const [r, h, z] = steps[si];
    const m = si === steps.length - 1 ? hullSilverDark(0.58) : hullSilver(0.5);
    const tier = zUp(new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.92, r, h, 48),
      m,
    ));
    tier.position.z = z;
    root.add(tier);
    if (si > 0) {
      const lip = new THREE.Mesh(
        new THREE.RingGeometry(r * 0.9, r * 1.05, 48),
        hullSilverDark(0.62),
      );
      lip.position.z = z + h * 0.48;
      root.add(lip);
    }
  }

  // Low ref: white emitter on bottom center (beam port).
  const beamPort = new THREE.Mesh(
    new THREE.CircleGeometry(0.062, 40),
    whiteGlow(3),
  );
  beamPort.position.z = -0.226;
  root.add(beamPort);

  return root;
}

function buildSpikeTrap() {
  const root = new THREE.Group();
  root.name = 'SpikeTrapRoot';
  const half = 1.125;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(half * 2, half * 2, 0.09), mat('#2e2e38', 0.4, 0.8));
  plate.position.z = 0.045;
  root.add(plate);
  const n = 5;
  const step = (half * 2) / (n + 1);
  const spikeR = 0.105;
  const spikeH = 0.63;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(spikeR, spikeH, 6), mat('#a8a8b8', 0.55, 0.45));
      cone.rotation.x = Math.PI / 2;
      cone.position.set(-half + step * (i + 1), -half + step * (j + 1), spikeH * 0.5 + 0.06);
      root.add(cone);
    }
  }
  return root;
}

function deformRock(geo, amp = 0.08) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = Math.sin(x * 7.3 + y * 5.1) * Math.cos(z * 6.2);
    const s = 1 + n * amp;
    pos.setXYZ(i, x * s, y * s, z * s);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function buildMeteorChunk() {
  const root = new THREE.Group();
  root.name = 'MeteorChunk';
  const rockGeo = deformRock(new THREE.IcosahedronGeometry(0.48, 2), 0.1);
  const rock = new THREE.Mesh(rockGeo, toonMat('#3d3028'));
  rock.name = 'MeteorRock';
  rock.scale.set(1.15, 0.9, 1.3);
  root.add(rock);
  const chipOffsets = [
    [0.35, 0.2, 0.15, 0.18],
    [-0.28, 0.32, -0.1, 0.14],
    [0.1, -0.38, 0.2, 0.12],
    [-0.22, -0.18, -0.25, 0.16],
  ];
  for (const [cx, cy, cz, sc] of chipOffsets) {
    const chip = new THREE.Mesh(
      deformRock(new THREE.IcosahedronGeometry(sc, 0), 0.15),
      toonMat('#524038'),
    );
    chip.position.set(cx, cy, cz);
    chip.rotation.set(Math.random(), Math.random(), Math.random());
    root.add(chip);
  }
  return root;
}

function chippedCubeGeo(s = 0.072) {
  const u = 0.48;
  const pts = [];
  for (const x of [-s, s]) {
    for (const y of [-s, s]) {
      for (const z of [-s, s]) {
        if (x > 0 && y < 0 && z > 0) continue;
        pts.push(new THREE.Vector3(x, y, z));
      }
    }
  }
  pts.push(new THREE.Vector3(s - u * 2 * s, -s, s));
  pts.push(new THREE.Vector3(s, -s + u * 2 * s, s));
  pts.push(new THREE.Vector3(s, -s, s - u * 2 * s));
  const geo = new ConvexGeometry(pts);
  geo.computeVertexNormals();
  return geo;
}

/** Bitten sugar cube. One mesh, big flat faces, one diagonal cut. */
function buildSugarCrumb() {
  const root = new THREE.Group();
  root.name = 'SugarCrumb';

  const cube = new THREE.Mesh(chippedCubeGeo(0.074), toonMat('#fff3d6'));
  cube.name = 'Cube';
  cube.scale.set(1, 0.94, 0.9);
  cube.rotation.set(0.12, 0.5, -0.08);
  root.add(cube);

  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const c = box.getCenter(new THREE.Vector3());
  cube.position.sub(c);
  return root;
}

function exportGlb(filename, object) {
  const scene = new THREE.Scene();
  scene.add(object);
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      result => {
        const buf = result instanceof ArrayBuffer ? Buffer.from(result) : Buffer.from(result);
        fs.writeFileSync(path.join(outDir, filename), buf);
        resolve();
      },
      err => reject(err),
      { binary: true },
    );
  });
}

const jobs = {
  ufo: buildUfo,
  spike_trap: buildSpikeTrap,
  meteor_chunk: buildMeteorChunk,
  sugar_crumb: buildSugarCrumb,
};
const pick = process.argv[2];
for (const [name, build] of Object.entries(jobs)) {
  if (pick && pick !== name) continue;
  await exportGlb(`${name}.glb`, build());
}
console.log('Wrote GLBs to', outDir, pick ? `(${pick})` : '(all)');
