import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyUfoRimGlow, ensureUfoHullOpaque } from '../ufo-rim-glow.js';

const mount = document.getElementById('view');
const partSelect = document.getElementById('part');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(mount.clientWidth, mount.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
mount.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#eceef2');

const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 80);
camera.up.set(0, 0, 1);
camera.position.set(0, -4.5, 0.1);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 0.1);

const ambient = new THREE.AmbientLight(0xf0f2f8, 0.48);
scene.add(ambient);
scene.add(new THREE.HemisphereLight(0xffffff, 0xb8bcc8, 0.35));
const key = new THREE.DirectionalLight(0xffffff, 1.35);
key.position.set(-4, -1.5, 6);
scene.add(key);
const fill = new THREE.DirectionalLight(0xe8eeff, 0.55);
fill.position.set(3.5, 2, 2.5);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 0.28);
rim.position.set(0, 4, 3);
scene.add(rim);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(8, 8),
  new THREE.MeshStandardMaterial({ color: 0xd8dce3, roughness: 0.95 }),
);
floor.position.z = -0.12;
scene.add(floor);

let propRoot = null;
let meshInventory = [];
let selectedMesh = null;
let highlightOverlay = null;
const HIGHLIGHT_MAT = new THREE.MeshBasicMaterial({
  color: 0xff2a3a,
  transparent: true,
  opacity: 0.52,
  depthWrite: false,
  side: THREE.DoubleSide,
  toneMapped: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});
const loader = new GLTFLoader();

function meshPathLabel(mesh, root) {
  const parts = [];
  let o = mesh;
  while (o && o !== root) {
    if (o.name) parts.unshift(o.name);
    o = o.parent;
  }
  if (parts.length) return parts.join(' / ');
  const geo = mesh.geometry?.type?.replace('Geometry', '') || 'Mesh';
  return geo;
}

function collectMeshes(root) {
  const rows = [];
  const tally = new Map();
  root.traverse(o => {
    if (!o.isMesh) return;
    if (o.parent?.name === 'RimGlowHalos') return;
    let label = meshPathLabel(o, root);
    const n = tally.get(label) || 0;
    tally.set(label, n + 1);
    if (n) label = `${label} #${n + 1}`;
    rows.push({ mesh: o, label });
  });
  return rows;
}

function clearMeshHighlight() {
  if (highlightOverlay) {
    highlightOverlay.parent?.remove(highlightOverlay);
    highlightOverlay = null;
  }
  selectedMesh = null;
}

function setMeshHighlight(mesh) {
  clearMeshHighlight();
  if (!mesh?.geometry) return;
  selectedMesh = mesh;
  highlightOverlay = new THREE.Mesh(mesh.geometry, HIGHLIGHT_MAT);
  highlightOverlay.scale.setScalar(1.004);
  highlightOverlay.renderOrder = 20;
  mesh.add(highlightOverlay);
}

function refreshMeshMenu() {
  meshInventory = propRoot ? collectMeshes(propRoot) : [];
  partSelect.innerHTML = '';
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = meshInventory.length ? '— select mesh —' : '(no meshes)';
  partSelect.appendChild(blank);
  meshInventory.forEach((row, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = row.label;
    partSelect.appendChild(opt);
  });
  partSelect.selectedIndex = 0;
  clearMeshHighlight();
}

function disposeProp(root) {
  clearMeshHighlight();
  root.traverse(o => {
    if (!o.isMesh) return;
    if (o.parent?.name === 'RimGlowHalos') return;
    o.geometry?.dispose?.();
    const m = o.material;
    if (Array.isArray(m)) m.forEach(x => x.dispose?.());
    else m?.dispose?.();
  });
}

async function loadProp(name) {
  if (propRoot) {
    scene.remove(propRoot);
    disposeProp(propRoot);
    propRoot = null;
  }
  const gltf = await loader.loadAsync(`/chaos/${name}.glb`);
  propRoot = gltf.scene;
  ambient.intensity = name === 'ufo' ? 0.22 : 0.48;
  if (name === 'ufo') {
    applyUfoRimGlow(propRoot, { sceneLights: false });
    ensureUfoHullOpaque(propRoot);
  }
  scene.add(propRoot);
  refreshMeshMenu();
}

function resize() {
  const w = Math.max(mount.clientWidth, 1);
  const h = Math.max(mount.clientHeight, 1);
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

document.getElementById('side').onclick = () => {
  camera.position.set(0, -3.2, 0.04);
  controls.target.set(0, 0, 0.04);
};
document.getElementById('low').onclick = () => {
  camera.position.set(1.35, 1.05, -2.15);
  controls.target.set(0, 0, -0.07);
};
document.getElementById('threeQ').onclick = () => {
  camera.position.set(2.8, -2.6, 1.4);
  controls.target.set(0, 0, 0.12);
};
document.getElementById('top').onclick = () => {
  camera.position.set(0, 0, 4.5);
  controls.target.set(0, 0, 0);
};
document.getElementById('reload').onclick = () => loadProp(document.getElementById('prop').value);
document.getElementById('prop').onchange = () => loadProp(document.getElementById('prop').value);
document.getElementById('spin').oninput = e => {
  if (propRoot) propRoot.rotation.z = (Number(e.target.value) / 180) * Math.PI;
};
partSelect.onchange = () => {
  const idx = partSelect.value;
  if (idx === '') {
    clearMeshHighlight();
    return;
  }
  const row = meshInventory[Number(idx)];
  if (row) setMeshHighlight(row.mesh);
};

try {
  await loadProp('ufo');
} catch (err) {
  console.error('[prop-studio] load failed', err);
  const note = document.querySelector('aside p');
  if (note) note.textContent = String(err);
}

function frame() {
  requestAnimationFrame(frame);
  controls.update();
  renderer.render(scene, camera);
}
frame();
