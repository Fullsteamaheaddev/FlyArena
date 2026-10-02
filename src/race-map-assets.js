// Sugar Run map props: GLBs baked by scripts/export_desert_props.mjs into public/maps/<map>/.
// Clones share geometry and materials with the template, so one shader patch covers every copy.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { DESERT_MAP_PROP_NAMES } from './desert-prop-scale.js';

const MAP_PROPS = {
  desert: DESERT_MAP_PROP_NAMES,
  dish: ['grass'],
};

export { DESERT_MAP_PROP_NAMES };

const templates = {};
const loading = {};

export function preloadMapAssets(baseUrl = '/', map = 'desert') {
  const names = MAP_PROPS[map];
  if (!names) return Promise.resolve();
  if (loading[map]) return loading[map];
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const loader = new GLTFLoader();
  loading[map] = Promise.all(names.map(async name => {
    try {
      const folder = map === 'dish' ? 'desert' : map;
      const gltf = await loader.loadAsync(`${base}maps/${folder}/${name}.glb`);
      gltf.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      templates[name] = gltf.scene;
    } catch (e) {
      console.warn(`[map-assets] failed ${map}/${name}.glb`, e);
    }
  }));
  return loading[map];
}

export function hasMapProp(name) { return !!templates[name]; }

/** the template's meshes (shared geometry/material), for instancing and shader patches */
export function mapPropMeshes(name) {
  const out = [];
  templates[name]?.traverse(o => { if (o.isMesh) out.push(o); });
  return out;
}

export function cloneMapProp(name) {
  const t = templates[name];
  return t ? t.clone(true) : null;
}
