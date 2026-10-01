import * as THREE from 'three';
import { applyCelShading } from './cel-shade.js';

const RIM_CORE = 0xa8f4ff;
const RIM_HALO = 0x40d8ff;

let coreMat = null;
let haloMat = null;
let spriteMat = null;
let spriteTex = null;

function radialSpriteTexture() {
  if (spriteTex) return spriteTex;
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(200,250,255,1)');
  g.addColorStop(0.28, 'rgba(80,220,255,0.55)');
  g.addColorStop(0.55, 'rgba(40,190,250,0.18)');
  g.addColorStop(1, 'rgba(20,160,240,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  spriteTex = new THREE.CanvasTexture(c);
  spriteTex.colorSpace = THREE.SRGBColorSpace;
  return spriteTex;
}

function rimMaterials() {
  if (!coreMat) {
    coreMat = new THREE.MeshBasicMaterial({ color: RIM_CORE, toneMapped: false });
    haloMat = new THREE.MeshBasicMaterial({
      color: RIM_HALO,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    spriteMat = new THREE.SpriteMaterial({
      map: radialSpriteTexture(),
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
  }
  return { core: coreMat, halo: haloMat, sprite: spriteMat };
}

export function isRimLampMesh(o) {
  if (!o.isMesh) return false;
  if (/^RimLamp(_\d+)?$/.test(o.name || '')) return true;
  const r = Math.hypot(o.position.x, o.position.y);
  return r > 0.985 && r < 1.03 && o.geometry?.type === 'BoxGeometry';
}

const RIM_HALO_BASE_OPACITY = 0.42;
const RIM_SPRITE_BASE_OPACITY = 0.62;

/** Hull / structure only — rim glow layers stay additive/transparent. */
export function ensureUfoHullOpaque(root) {
  root?.traverse?.(o => {
    if (!o.isMesh) return;
    if (o.parent?.name === 'RimGlowHalos') return;
    if (isRimLampMesh(o)) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) {
      if (!m) continue;
      m.transparent = false;
      m.opacity = 1;
      m.depthWrite = true;
    }
  });
}

function setMeshOpacity(o, a, solid) {
  const list = Array.isArray(o.material) ? o.material : [o.material];
  for (const m of list) {
    if (!m) continue;
    if (solid) {
      m.transparent = false;
      m.opacity = 1;
      m.depthWrite = true;
    } else {
      m.transparent = true;
      m.opacity = a;
      m.depthWrite = false;
    }
  }
}

/** Saucer fade: hull goes fully opaque at a≈1; rim halos/sprites scale with a. */
export function setUfoSaucerFade(root, opacity) {
  const a = Math.max(0, Math.min(1, opacity));
  const hullSolid = a >= 0.995;
  root?.traverse?.(o => {
    if (o.isSprite) {
      if (o.parent?.name !== 'RimGlowHalos') return;
      o.material.opacity = RIM_SPRITE_BASE_OPACITY * a;
      return;
    }
    if (!o.isMesh) return;
    if (o.parent?.name === 'RimGlowHalos') {
      o.material.opacity = RIM_HALO_BASE_OPACITY * a;
      return;
    }
    if (isRimLampMesh(o)) {
      setMeshOpacity(o, a, hullSolid);
      return;
    }
    setMeshOpacity(o, a, hullSolid);
  });
}

/** Rim lamps: bright panels + soft camera-facing glow sprites (no scene spotlights).
 *  sceneLights: empty Object3D anchors named RimLampLights so race-chaos can borrow pooled PointLights. */
export function applyUfoRimGlow(root, { sceneLights = false } = {}) {
  root.getObjectByName('RimGlowHalos')?.removeFromParent();
  root.getObjectByName('RimLampLights')?.removeFromParent();

  const { core, halo, sprite } = rimMaterials();
  const halos = new THREE.Group();
  halos.name = 'RimGlowHalos';
  const lampPts = [];

  root.traverse(o => {
    if (!isRimLampMesh(o)) return;
    const px = o.position.x;
    const py = o.position.y;
    const pz = o.position.z;
    const rim = Math.hypot(px, py) || 1;
    const ox = px / rim;
    const oy = py / rim;

    lampPts.push({ px, py, pz });

    o.material = core;
    o.renderOrder = 4;

    const h = new THREE.Mesh(o.geometry, halo);
    h.position.copy(o.position);
    h.rotation.copy(o.rotation);
    h.scale.set(o.scale.x * 1.35, o.scale.y * 1.45, o.scale.z * 1.25);
    h.renderOrder = 3;
    halos.add(h);

    const spr = new THREE.Sprite(sprite);
    spr.position.set(px + ox * 0.006, py + oy * 0.006, pz);
    const tang = o.geometry?.parameters?.width ?? 0.05;
    spr.scale.set(tang * 2.05, tang * 2.05, 1);
    spr.renderOrder = 2;
    halos.add(spr);
  });

  if (halos.children.length) root.add(halos);
  applyCelShading(root, {
    skip: o => isRimLampMesh(o) || o.parent?.name === 'RimGlowHalos',
    outlineName: 'UfoCelOutline',
  });
  ensureUfoHullOpaque(root);

  if (sceneLights && lampPts.length) {
    const lights = new THREE.Group();
    lights.name = 'RimLampLights';
    const step = Math.max(1, Math.floor(lampPts.length / 6));
    for (let i = 0; i < lampPts.length; i += step) {
      if (lights.children.length >= 6) break;
      const L = lampPts[i];
      const a = new THREE.Object3D();
      a.position.set(L.px, L.py, L.pz);
      lights.add(a);
    }
    if (lights.children.length) root.add(lights);
  }
}
