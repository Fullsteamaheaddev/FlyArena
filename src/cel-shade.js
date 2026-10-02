// Shared 4-step cell shading used by thumb/finger/cake and chaos GLBs.
import * as THREE from 'three';

let rampTex = null;
let rampCakeTex = null;

function makeRampTex(levels) {
  const c = document.createElement('canvas');
  c.width = levels.length;
  c.height = 1;
  const x = c.getContext('2d'), img = x.createImageData(levels.length, 1);
  for (let i = 0; i < levels.length; i++) {
    const v = levels[i];
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export function celRamp() {
  if (rampTex) return rampTex;
  rampTex = makeRampTex([48, 118, 190, 255]);
  return rampTex;
}

/** Steeper bands for pastel props (cake) so toon steps read under race lighting. */
export function celRampCake() {
  if (rampCakeTex) return rampCakeTex;
  rampCakeTex = makeRampTex([22, 72, 138, 205, 255]);
  return rampCakeTex;
}

export function celMat(color, glow = 0) {
  const c = new THREE.Color(color);
  return new THREE.MeshToonMaterial({
    color: c,
    gradientMap: celRamp(),
    emissive: glow ? c : new THREE.Color(0x000000),
    emissiveIntensity: glow,
    transparent: true,
    opacity: 1,
  });
}

/** Vertex-colored props (e.g. dish grass GLB) with banded lighting. */
export function celMatVertexColors() {
  return new THREE.MeshToonMaterial({
    color: 0xffffff,
    vertexColors: true,
    gradientMap: celRamp(),
  });
}

function toonFrom(old) {
  const color = old?.color?.clone?.() ?? new THREE.Color(0x888888);
  const glow = old?.emissiveIntensity > 0.01 ? old.emissiveIntensity : 0;
  const emissive = glow
    ? (old.emissive?.clone?.() ?? color.clone())
    : new THREE.Color(0x000000);
  const mat = new THREE.MeshToonMaterial({
    color,
    map: old?.map ?? null,
    gradientMap: celRamp(),
    emissive,
    emissiveIntensity: glow,
    transparent: !!old?.transparent,
    opacity: old?.opacity ?? 1,
    side: old?.side ?? THREE.FrontSide,
  });
  if (glow) mat.userData._emissiveBase = glow;
  return mat;
}

function meshHeight(o) {
  const g = o.geometry;
  if (!g) return 0;
  if (!g.boundingBox) g.computeBoundingBox();
  const b = g.boundingBox;
  return b ? b.max.z - b.min.z : 0;
}

/** The ink used by every inverted-hull outline. */
export function celOutlineMat(T = THREE, color = '#2a1812') {
  return new T.MeshBasicMaterial({ color, side: T.BackSide });
}

/**
 * Attach an inverted-hull outline to `mesh`. The hull is the same geometry scaled
 * about the mesh origin, so it only works on origin-centred geometry.
 */
export function celOutline(mesh, { scale = 1.035, name = 'CelOutline', T = THREE, color } = {}) {
  mesh.getObjectByName(name)?.removeFromParent();
  const ol = new T.Mesh(mesh.geometry, celOutlineMat(T, color));
  ol.name = name;
  if (typeof scale === 'number') ol.scale.setScalar(scale); else ol.scale.set(...scale);
  ol.renderOrder = -1;
  mesh.add(ol);
  return ol;
}

function addOutline(o, name) {
  if (meshHeight(o) < 0.04) { o.getObjectByName(name)?.removeFromParent(); return; }
  celOutline(o, { name });
}

/**
 * Convert lit meshes on `root` to MeshToon + optional inverted-hull outline.
 * Skips unlit MeshBasic (lamps, decals) and existing toon mats.
 */
export function applyCelShading(root, { skip, outline = true, outlineName = 'CelOutline' } = {}) {
  root?.traverse?.(o => {
    if (!o.isMesh) return;
    if (o.name === outlineName || o.name === 'UfoCelOutline') return;
    if (skip?.(o)) return;
    const oldMats = Array.isArray(o.material) ? o.material : [o.material];
    const next = oldMats.map(old => {
      if (!old || old.isMeshToonMaterial) return old;
      if (old.isMeshBasicMaterial || old.isSpriteMaterial) return old;
      return toonFrom(old);
    });
    oldMats.forEach((m, i) => {
      if (m && m !== next[i] && !m.isMeshToonMaterial && !m.isMeshBasicMaterial) m.dispose?.();
    });
    o.material = next.length === 1 ? next[0] : next;
    if (outline) addOutline(o, outlineName);
  });
}
