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

/**
 * One outline for every mesh under `root`: merged geometry pushed out along
 * smoothed normals, so ink width is constant and stacked parts share a silhouette.
 * `thickness` is in root-local units; the offset is applied across the view ray
 * only, so ink never rises in front of the surface. `depthPush` slides it away
 * from the camera so only the true silhouette survives the depth test.
 * Vertices within `radialWithin` of the root origin extrude straight out from it
 * (round bodies whose low-poly face normals would make the ink wobble).
 * `skip(mesh)` leaves meshes out of the hull (e.g. thin steps that would grow fins).
 */
export function celOutlineExtruded(root, { thickness = 0.01, depthPush = 0, radialWithin = 0, skip, name = 'CelOutline', T = THREE, color } = {}) {
  root.getObjectByName(name)?.removeFromParent();
  root.updateMatrixWorld(true);
  const inv = new T.Matrix4().copy(root.matrixWorld).invert();
  const pos = [];
  root.traverse(o => {
    if (!o.isMesh || o.name === name || skip?.(o)) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    const m = new T.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const p = g.attributes.position;
    const v = new T.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
    }
  });
  if (!pos.length) return null;
  const quant = 1e4;
  const keyOf = i => `${Math.round(pos[i] * quant)},${Math.round(pos[i + 1] * quant)},${Math.round(pos[i + 2] * quant)}`;
  const faceNormals = new Map();
  const centroids = new Map();
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
  for (let i = 0; i < pos.length; i += 9) {
    a.fromArray(pos, i); b.fromArray(pos, i + 3); c.fromArray(pos, i + 6);
    const fn = new T.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
    if (fn.lengthSq() < 1e-20) continue;
    fn.normalize();
    const cen = a.clone().add(b).add(c).divideScalar(3);
    for (let k = 0; k < 3; k++) {
      const key = keyOf(i + k * 3);
      const list = faceNormals.get(key) || [];
      if (!list.some(n => n.dot(fn) > 0.999)) list.push(fn);
      faceNormals.set(key, list);
      const cl = centroids.get(key) || { v: new T.Vector3().fromArray(pos, i + k * 3), c: [] };
      cl.c.push(cen);
      centroids.set(key, cl);
    }
  }
  // Corner scaling keeps convex edges at full width; on concave creases it would
  // push ink through the surface, so those keep a unit offset.
  const offsets = new Map();
  for (const [key, list] of faceNormals) {
    const { v, c: cens } = centroids.get(key);
    if (v.length() < radialWithin) { offsets.set(key, v.clone().normalize()); continue; }
    const n = list.reduce((s, f) => s.add(f), new T.Vector3()).normalize();
    if (cens.some(cen => cen.clone().sub(v).dot(n) > thickness * 0.25)) { offsets.set(key, n); continue; }
    const minDot = Math.min(...list.map(f => f.dot(n)));
    offsets.set(key, n.multiplyScalar(1 / Math.max(minDot, 0.5)));
  }
  const nrm = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const n = offsets.get(keyOf(i)) ?? new T.Vector3();
    nrm[i] = n.x; nrm[i + 1] = n.y; nrm[i + 2] = n.z;
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new T.BufferAttribute(nrm, 3));
  const mat = celOutlineMat(T, color);
  mat.onBeforeCompile = shader => {
    shader.uniforms.outlineThickness = { value: thickness };
    shader.uniforms.outlineDepthPush = { value: depthPush };
    shader.vertexShader = 'uniform float outlineThickness;\nuniform float outlineDepthPush;\n' + shader.vertexShader
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
vec3 viewRay = normalize( mvPosition.xyz );
vec3 offsetView = ( modelViewMatrix * vec4( normal, 0.0 ) ).xyz;
mvPosition.xyz += ( offsetView - viewRay * dot( offsetView, viewRay ) ) * outlineThickness;
mvPosition.xyz += viewRay * outlineDepthPush;
gl_Position = projectionMatrix * mvPosition;`,
      );
  };
  mat.customProgramCacheKey = () => 'celOutlineExtruded';
  const ol = new T.Mesh(geo, mat);
  ol.name = name;
  ol.renderOrder = -1;
  root.add(ol);
  return ol;
}

function addOutline(o, name) {
  if (meshHeight(o) < 0.04) { o.getObjectByName(name)?.removeFromParent(); return; }
  celOutline(o, { name });
}

/**
 * Convert lit meshes on `root` to MeshToon + optional inverted-hull outline.
 * Skips unlit MeshBasic (lamps, decals) and existing toon mats unless `toonBasic`.
 */
export function applyCelShading(root, { skip, outline = true, outlineName = 'CelOutline', toonBasic = false } = {}) {
  root?.traverse?.(o => {
    if (!o.isMesh) return;
    if (o.name === outlineName || o.name === 'UfoCelOutline') return;
    if (skip?.(o)) return;
    const oldMats = Array.isArray(o.material) ? o.material : [o.material];
    const next = oldMats.map(old => {
      if (!old || old.isMeshToonMaterial) return old;
      if (old.isSpriteMaterial) return old;
      if (old.isMeshBasicMaterial && !toonBasic) return old;
      return toonFrom(old);
    });
    oldMats.forEach((m, i) => {
      if (m && m !== next[i] && !m.isMeshToonMaterial && (!m.isMeshBasicMaterial || toonBasic)) m.dispose?.();
    });
    o.material = next.length === 1 ? next[0] : next;
    if (outline) addOutline(o, outlineName);
  });
}

/**
 * Authored Rubberchicken.glb is tiny (~0.09 on the long axis). A fixed extruded
 * thickness (grenade's 0.009) swallows the mesh in black ink. Scale the hull to
 * a fraction of the longest axis so the silhouette reads as a line, not a blob.
 */
export function applyChickenCelShading(root) {
  applyCelShading(root, { outline: false, toonBasic: true });
  if (!root) return;
  root.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z, 1e-4);
  celOutlineExtruded(root, { thickness: longest * 0.006, depthPush: longest * 0.003 });
}
