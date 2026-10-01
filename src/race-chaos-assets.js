import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinnedRoot } from 'three/addons/utils/SkeletonUtils.js';
import { createSmokePuffTexture } from './race-chaos-smoke-tex.js';
import { applyCelShading } from './cel-shade.js';
import { attachCakeSilhouette } from './race-chaos-props.js';
import { applyUfoRimGlow } from './ufo-rim-glow.js';

const PATHS = {
  ufo: 'chaos/ufo.glb',
  spike_trap: 'chaos/spike_trap.glb',
  meteor_chunk: 'chaos/meteor_chunk.glb',
  sugar_crumb: 'chaos/sugar_crumb.glb',
  cake_slice: 'chaos/cake_slice.glb',
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
  const root = cloneSkinnedRoot(t);
  if (name === 'ufo') applyUfoRimGlow(root, { sceneLights: true });
  else if (name === 'cake_slice') {
    applyCelShading(root, { outline: false });
    root.traverse(o => {
      if (!o.isMesh || o.name === 'CelOutline') return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m || m.isMeshBasicMaterial || m.isSpriteMaterial) continue;
        m.transparent = false;
        m.depthWrite = true;
        m.opacity = 1;
      }
    });
    attachCakeSilhouette(root, THREE);
  } else applyCelShading(root);
  root.traverse(o => {
    if (!o.isMesh) return;
    const isOutline = o.name === 'CelOutline' || o.name === 'UfoCelOutline';
    if (!isOutline) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
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

export function chaosPropKeys() { return Object.keys(PATHS); }
export function hasChaosProp(name) {
  return !!templates[name];
}
