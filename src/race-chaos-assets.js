import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { createSmokePuffTexture } from './race-chaos-smoke-tex.js';
import { applyUfoRimGlow } from './ufo-rim-glow.js';

let meteorGradientMap = null;

function meteorCelGradient() {
  if (!meteorGradientMap) {
    const data = new Uint8Array([28, 150, 255]);
    meteorGradientMap = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
    meteorGradientMap.minFilter = THREE.NearestFilter;
    meteorGradientMap.magFilter = THREE.NearestFilter;
    meteorGradientMap.needsUpdate = true;
  }
  return meteorGradientMap;
}

function applyMeteorCelShading(root) {
  const gradientMap = meteorCelGradient();
  root.traverse(o => {
    if (!o.isMesh) return;
    const oldMats = Array.isArray(o.material) ? o.material : [o.material];
    const newMats = oldMats.map(old => {
      const color = old?.color?.getHex?.() ?? 0x3d3028;
      return new THREE.MeshToonMaterial({ color, gradientMap });
    });
    for (const m of oldMats) m?.dispose?.();
    o.material = newMats.length === 1 ? newMats[0] : newMats;
  });
}

const PATHS = {
  ufo: 'chaos/ufo.glb',
  spike_trap: 'chaos/spike_trap.glb',
  meteor_chunk: 'chaos/meteor_chunk.glb',
  sugar_crumb: 'chaos/sugar_crumb.glb',
};

const templates = {};
let assetBase = '';
let smokeTexture = null;

export async function preloadChaosAssets(THREE, baseUrl = '/') {
  assetBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const loader = new GLTFLoader();
  const jobs = Object.entries(PATHS).map(async ([key, path]) => {
    try {
      const gltf = await loader.loadAsync(`${assetBase}${path}`);
      if (key === 'ufo') applyUfoRimGlow(gltf.scene, { sceneLights: true });
      templates[key] = gltf.scene;
    } catch (e) {
      console.warn(`[chaos-assets] failed ${path}`, e);
    }
  });
  await Promise.all(jobs);
  smokeTexture = createSmokePuffTexture(THREE);
}

export function getChaosSmokeTexture() {
  if (!smokeTexture) smokeTexture = createSmokePuffTexture(THREE);
  return smokeTexture;
}

export function cloneChaosProp(name) {
  const t = templates[name];
  if (!t) return null;
  const root = SkeletonUtils.clone(t);
  if (name === 'meteor_chunk') applyMeteorCelShading(root);
  if (name === 'ufo') applyUfoRimGlow(root, { sceneLights: true });
  root.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    if (name !== 'meteor_chunk') return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      m.transparent = true;
      m.depthWrite = false;
      m.opacity = 1;
    }
    o.renderOrder = 10;
  });
  return root;
}

export function hasChaosProp(name) {
  return !!templates[name];
}
