import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyCelShading } from '../cel-shade.js';
import { applyUfoRimGlow, ensureUfoHullOpaque } from '../ufo-rim-glow.js';
import { DESERT_MAP_PROP_NAMES, DESERT_PREVIEW_PROPS, propScale } from '../desert-prop-scale.js';

const params = new URLSearchParams(location.search);
const setName = params.get('set') === 'desert' ? 'desert' : 'chaos';

const CHAOS_PROPS = ['ufo', 'meteor_chunk', 'spike_trap', 'sugar_crumb', 'cake_slice'];

const mount = document.getElementById('view');
const partSelect = document.getElementById('part');
const propSelect = document.getElementById('prop');
const statsEl = document.getElementById('stats');
const scaleToggle = document.getElementById('gameScale');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(mount.clientWidth, mount.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
mount.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(setName === 'desert' ? '#4a3b28' : '#eceef2');

const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 80);
camera.up.set(0, 0, 1);
camera.position.set(2.8, -2.6, 1.4);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 0.12);

const fitCenter = new THREE.Vector3();
let fitRadius = 1.2;

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

const floorMat = new THREE.MeshStandardMaterial({
  color: setName === 'desert' ? 0x4a3b28 : 0xd8dce3,
  roughness: 0.95,
});
const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), floorMat);
floor.position.z = -0.12;
scene.add(floor);

let propRoot = null;
let currentPropName = '';
let meshInventory = [];
let selectedMesh = null;
let highlightOverlay = null;
const baseScale = new THREE.Vector3(1, 1, 1);
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
    if (o.name === 'UfoCelOutline' || o.name === 'CelOutline') return;
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
    if (o.name !== 'CelOutline' && o.name !== 'UfoCelOutline') return;
    if (Array.isArray(o.material)) o.material.forEach(m => m?.dispose?.());
    else o.material?.dispose?.();
  });
}

function updateStats(root) {
  if (!statsEl) return;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) {
    statsEl.textContent = '—';
    return;
  }
  const size = box.getSize(new THREE.Vector3());
  statsEl.textContent = `foot Z ${box.min.z.toFixed(3)} · H ${size.z.toFixed(3)} · XY ${size.x.toFixed(2)}×${size.y.toFixed(2)}`;
}

function applyGameScale() {
  if (!propRoot) return;
  const useGame = setName === 'desert' && scaleToggle?.checked;
  if (useGame && DESERT_PREVIEW_PROPS[currentPropName]) {
    const p = DESERT_PREVIEW_PROPS[currentPropName];
    const [sx, sy, sz] = propScale(p);
    propRoot.scale.set(baseScale.x * sx, baseScale.y * sy, baseScale.z * sz);
  } else {
    propRoot.scale.copy(baseScale);
  }
}

function frameProp(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;
  box.getCenter(fitCenter);
  const size = box.getSize(new THREE.Vector3());
  fitRadius = Math.max(size.x, size.y, size.z, 0.08) * 0.5;
  updateStats(root);
  viewThreeQ();
}

function viewSide() {
  const d = Math.max(fitRadius * 3.2, 0.4);
  camera.position.set(fitCenter.x, fitCenter.y - d, fitCenter.z);
  controls.target.copy(fitCenter);
}
function viewLow() {
  const d = Math.max(fitRadius * 3.4, 0.4);
  camera.position.set(fitCenter.x + d * 0.45, fitCenter.y + d * 0.35, fitCenter.z - d * 0.72);
  controls.target.copy(fitCenter);
}
function viewThreeQ() {
  const d = Math.max(fitRadius * 3.6, 0.4);
  camera.position.set(fitCenter.x + d * 0.85, fitCenter.y - d * 0.78, fitCenter.z + d * 0.42);
  controls.target.copy(fitCenter);
}
function viewTop() {
  const d = Math.max(fitRadius * 4.2, 0.5);
  camera.position.set(fitCenter.x, fitCenter.y, fitCenter.z + d);
  controls.target.copy(fitCenter);
}

function glbUrl(name) {
  const base = setName === 'desert' ? `/maps/desert/${name}.glb` : `/chaos/${name}.glb`;
  return `${base}?t=${Date.now()}`;
}

async function loadProp(name) {
  currentPropName = name;
  if (propRoot) {
    scene.remove(propRoot);
    disposeProp(propRoot);
    propRoot = null;
  }
  const gltf = await loader.loadAsync(glbUrl(name));
  propRoot = gltf.scene;
  baseScale.set(1, 1, 1);
  ambient.intensity = setName === 'desert' ? 0.55 : 0.48;
  if (setName === 'chaos') {
    if (name === 'ufo') {
      applyUfoRimGlow(propRoot, { sceneLights: false });
      ensureUfoHullOpaque(propRoot);
    } else {
      applyCelShading(propRoot);
    }
  }
  applyGameScale();
  scene.add(propRoot);
  frameProp(propRoot);
  refreshMeshMenu();
}

function populatePropSelect() {
  const names = setName === 'desert' ? DESERT_MAP_PROP_NAMES : CHAOS_PROPS;
  propSelect.innerHTML = '';
  for (const name of names) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = `${name}.glb`;
    propSelect.appendChild(opt);
  }
  const q = params.get('prop');
  if (q && names.includes(q)) propSelect.value = q;
}

function resize() {
  const w = Math.max(mount.clientWidth, 1);
  const h = Math.max(mount.clientHeight, 1);
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(mount);
resize();

document.getElementById('side').onclick = viewSide;
document.getElementById('low').onclick = viewLow;
document.getElementById('threeQ').onclick = viewThreeQ;
document.getElementById('top').onclick = viewTop;
document.getElementById('reload').onclick = () => loadProp(propSelect.value);
propSelect.onchange = () => loadProp(propSelect.value);
scaleToggle?.addEventListener('change', () => {
  applyGameScale();
  if (propRoot) frameProp(propRoot);
});
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

const titleEl = document.querySelector('aside h1');
if (titleEl) titleEl.textContent = setName === 'desert' ? 'Desert prop studio' : 'Chaos prop studio';
if (scaleToggle) {
  scaleToggle.checked = setName === 'desert' && params.get('scale') !== '0';
  const scaleLabel = scaleToggle.closest('label');
  if (scaleLabel) scaleLabel.style.display = setName === 'desert' ? '' : 'none';
}

populatePropSelect();
try {
  await loadProp(propSelect.value || (setName === 'desert' ? 'arch' : 'ufo'));
} catch (err) {
  console.error('[prop-studio] load failed', err);
  const note = document.querySelector('aside p.hint');
  if (note) note.textContent = String(err);
}

function frame() {
  requestAnimationFrame(frame);
  controls.update();
  renderer.render(scene, camera);
}
frame();
