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
if (!globalThis.document) {
  globalThis.document = {
    createElement() {
      return {
        width: 4,
        height: 1,
        getContext() {
          return {
            createImageData(w, h) {
              return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
            },
            putImageData() {},
          };
        },
      };
    },
  };
}
import * as THREE from 'three';
import { makeCakeSlice } from '../src/race-chaos-props.js';
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
function buildCakeSlice() {
  const root = makeCakeSlice(THREE);
  root.name = 'CakeSlice';
  root.traverse(o => {
    if (o.name === 'CelOutline') o.removeFromParent();
  });
  return root;
}

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

// ---------------------------------------------------------------------------
// Fly-on-fly weapons. Built ~1 unit long and pointing along +X (the arena scales
// them down and maps local +X onto the holder's yaw). +Z stays up.
// ---------------------------------------------------------------------------

const GUNMETAL = '#4b515b';
const GUNMETAL_DARK = '#2e3238';
const WOOD = '#8a5633';
const HAZARD = '#ffd23f';

/** Cylinder running along +X from `x0` to `x0 + len`. */
function barrel(len, r, color, x0 = 0, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), toonMat(color));
  m.rotation.z = -Math.PI / 2;
  m.position.x = x0 + len * 0.5;
  return m;
}

function slab(sx, sy, sz, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), toonMat(color));
  m.position.set(x, y, z);
  return m;
}

function buildMinigun() {
  const root = new THREE.Group();
  root.name = 'Minigun';

  const housing = slab(0.34, 0.26, 0.26, GUNMETAL, 0.17);
  housing.name = 'Housing';
  root.add(housing);
  root.add(slab(0.1, 0.3, 0.3, GUNMETAL_DARK, 0.36));

  // Six-barrel rotor around the +X axis.
  const rotor = new THREE.Group();
  rotor.name = 'Rotor';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const b = barrel(0.62, 0.035, i % 2 ? GUNMETAL_DARK : GUNMETAL, 0.4);
    b.position.y = Math.cos(a) * 0.075;
    b.position.z = Math.sin(a) * 0.075;
    rotor.add(b);
  }
  rotor.add(barrel(0.6, 0.028, GUNMETAL_DARK, 0.4));
  root.add(rotor);
  const shroud = barrel(0.08, 0.125, GUNMETAL_DARK, 0.4, 12);
  shroud.name = 'Shroud';
  root.add(shroud);

  root.add(slab(0.14, 0.1, 0.22, GUNMETAL_DARK, 0.06, 0, -0.2));   // grip
  root.add(slab(0.26, 0.12, 0.1, '#6c7480', 0.1, 0, 0.17));        // feed tray
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.2, 10), toonMat('#5a6472'));
  can.name = 'AmmoDrum';
  can.position.set(0.02, 0.2, -0.02);
  root.add(can);
  return root;
}

function buildShotgun() {
  const root = new THREE.Group();
  root.name = 'Shotgun';

  for (const dy of [-0.045, 0.045]) {
    const b = barrel(0.68, 0.042, GUNMETAL_DARK, 0.3);
    b.position.y = dy;
    root.add(b);
  }
  const muzzle = barrel(0.05, 0.062, GUNMETAL, 0.94, 12);
  muzzle.name = 'Muzzle';
  muzzle.scale.y = 1.9;
  root.add(muzzle);

  root.add(slab(0.3, 0.13, 0.17, WOOD, 0.16));                     // receiver
  const stock = slab(0.36, 0.1, 0.2, WOOD, -0.16, 0, -0.05);
  stock.name = 'Stock';
  stock.rotation.y = 0.16;
  root.add(stock);
  root.add(slab(0.1, 0.08, 0.14, GUNMETAL_DARK, 0.05, 0, -0.14));  // trigger guard
  root.add(slab(0.2, 0.09, 0.08, WOOD, 0.44, 0, -0.07));           // pump
  return root;
}

function buildBazooka() {
  const root = new THREE.Group();
  root.name = 'Bazooka';

  const tube = barrel(0.9, 0.11, '#3f6b42', -0.05, 14);
  tube.name = 'Tube';
  root.add(tube);
  const flare = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.11, 0.16, 14, 1, true), toonMat('#335636'));
  flare.rotation.z = Math.PI / 2;
  flare.position.x = -0.13;
  flare.name = 'Blast';
  root.add(flare);
  const ring = barrel(0.05, 0.125, GUNMETAL_DARK, 0.8, 14);
  ring.name = 'MuzzleRing';
  root.add(ring);

  root.add(slab(0.12, 0.09, 0.2, GUNMETAL_DARK, 0.2, 0, -0.16));   // grip
  root.add(slab(0.1, 0.08, 0.16, GUNMETAL_DARK, 0.52, 0, -0.14));  // fore grip
  const sight = slab(0.16, 0.05, 0.1, HAZARD, 0.3, 0, 0.14);
  sight.name = 'Sight';
  root.add(sight);
  // Loaded warhead peeking out the front.
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.2, 12), toonMat('#d8453b'));
  nose.rotation.z = -Math.PI / 2;
  nose.position.x = 0.92;
  nose.name = 'Warhead';
  root.add(nose);
  return root;
}

/** Projectile for both bazooka and missile: nose on +X, fins at the tail. */
function buildMissile() {
  const root = new THREE.Group();
  root.name = 'Missile';

  const body = barrel(0.7, 0.1, '#d8453b', -0.35, 14);
  body.name = 'Body';
  root.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.26, 14), toonMat('#f2f2ee'));
  nose.rotation.z = -Math.PI / 2;
  nose.position.x = 0.48;
  nose.name = 'Nose';
  root.add(nose);
  const band = barrel(0.07, 0.108, '#f2f2ee', 0.05, 14);
  band.name = 'Band';
  root.add(band);

  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const fin = slab(0.2, 0.012, 0.16, GUNMETAL_DARK, -0.27, 0, 0);
    fin.position.y = Math.cos(a) * 0.12;
    fin.position.z = Math.sin(a) * 0.12;
    fin.rotation.x = a;
    fin.name = i === 0 ? 'Fin' : `Fin_${i}`;
    root.add(fin);
  }
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.07, 0.08, 12), toonMat(GUNMETAL_DARK));
  bell.rotation.z = Math.PI / 2;
  bell.position.x = -0.39;
  bell.name = 'Nozzle';
  root.add(bell);
  return root;
}

function buildTaser() {
  const root = new THREE.Group();
  root.name = 'Taser';

  const body = slab(0.42, 0.2, 0.26, HAZARD, 0.21);
  body.name = 'Body';
  root.add(body);
  root.add(slab(0.1, 0.21, 0.27, GUNMETAL_DARK, 0.1));             // trim band
  root.add(slab(0.16, 0.13, 0.24, GUNMETAL_DARK, 0.04, 0, -0.2));  // grip

  for (const dz of [-0.07, 0.07]) {
    const prong = barrel(0.3, 0.022, '#cfd6de', 0.4);
    prong.position.z = dz;
    root.add(prong);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 8), toonMat('#8fd8ff'));
    tip.rotation.z = -Math.PI / 2;
    tip.position.set(0.74, 0, dz);
    root.add(tip);
  }
  const arc = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 6, 10), toonMat('#8fd8ff'));
  arc.name = 'Arc';
  arc.position.x = 0.72;
  arc.rotation.y = Math.PI / 2;
  root.add(arc);
  return root;
}

function buildRubberChicken() {
  const root = new THREE.Group();
  root.name = 'RubberChicken';
  const skin = toonMat('#f2d64b');

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10), skin);
  body.name = 'Body';
  body.scale.set(1.5, 0.85, 0.95);
  root.add(body);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.24, 10), skin);
  neck.position.set(0.3, 0, 0.1);
  neck.rotation.z = -0.5;
  root.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 9), skin);
  head.name = 'Head';
  head.position.set(0.44, 0, 0.17);
  root.add(head);

  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 8), toonMat('#ff8a1f'));
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(0.56, 0, 0.15);
  beak.name = 'Beak';
  root.add(beak);

  const comb = slab(0.1, 0.03, 0.08, '#e0453a', 0.44, 0, 0.27);
  comb.name = 'Comb';
  root.add(comb);
  for (const dy of [-0.045, 0.045]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), toonMat('#20242c'));
    eye.position.set(0.5, dy, 0.2);
    root.add(eye);
  }

  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.22, 8), skin);
  tail.rotation.z = Math.PI / 2.4;
  tail.position.set(-0.36, 0, 0.1);
  tail.name = 'Tail';
  root.add(tail);

  // Dangling legs sell the lob.
  for (const dy of [-0.08, 0.08]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.22, 8), toonMat('#ff8a1f'));
    leg.position.set(-0.04, dy, -0.22);
    leg.rotation.x = dy > 0 ? 0.25 : -0.25;
    root.add(leg);
    const foot = slab(0.12, 0.07, 0.022, '#ff8a1f', 0.02, dy, -0.32);
    root.add(foot);
  }
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
  cake_slice: buildCakeSlice,
  minigun: buildMinigun,
  shotgun: buildShotgun,
  bazooka: buildBazooka,
  missile: buildMissile,
  taser: buildTaser,
  rubber_chicken: buildRubberChicken,
};
const pick = process.argv[2];
for (const [name, build] of Object.entries(jobs)) {
  if (pick && pick !== name) continue;
  await exportGlb(`${name}.glb`, build());
}
console.log('Wrote GLBs to', outDir, pick ? `(${pick})` : '(all)');
