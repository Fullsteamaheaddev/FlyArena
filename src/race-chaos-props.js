// Cell-shaded gag props. Each digit is one swept tube (no seams), with a nail
// patch that follows the tube surface and knuckle creases.
// Thumb/finger local axes: contact at origin, shaft toward +Z, nail (dorsal) +X.
// Hand local axes: palm in XY, fingers toward +Y, back of hand -Z.
let rampTex = null;

function toonRamp(T) {
  if (rampTex) return rampTex;
  const c = document.createElement('canvas');
  c.width = 4; c.height = 1;
  const x = c.getContext('2d'), img = x.createImageData(4, 1);
  const g = [48, 118, 190, 255];
  for (let i = 0; i < 4; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = g[i];
    img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  rampTex = new T.CanvasTexture(c);
  rampTex.minFilter = T.NearestFilter;
  rampTex.magFilter = T.NearestFilter;
  rampTex.colorSpace = T.NoColorSpace;
  return rampTex;
}

function toonMat(T, color, glow = 0.16) {
  return new T.MeshToonMaterial({ color, gradientMap: toonRamp(T), transparent: true, opacity: 1, emissive: color, emissiveIntensity: glow });
}

function cakeToonMat(T, color, glow = 0.16) {
  const m = new T.MeshToonMaterial({
    color, gradientMap: toonRamp(T), emissive: color, emissiveIntensity: glow,
    transparent: true, opacity: 1, depthWrite: true,
  });
  m.polygonOffset = true;
  m.polygonOffsetFactor = 1;
  m.polygonOffsetUnits = 1;
  return m;
}

function decal(mat, T, bias) {
  mat.side = T.DoubleSide;
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = bias;
  mat.polygonOffsetUnits = bias;
  return mat;
}

function materials(T) {
  return {
    skin: toonMat(T, '#e8b496'),
    nail: decal(toonMat(T, '#fbefe4', 0.62), T, -4),
    rim: decal(new T.MeshBasicMaterial({ color: '#5a2e20', transparent: true, opacity: 1 }), T, -2),
    crease: decal(new T.MeshBasicMaterial({ color: '#9a5a42', transparent: true, opacity: 1 }), T, -2),
    ol: new T.MeshBasicMaterial({ color: '#2a1812', side: T.BackSide, transparent: true, opacity: 1 }),
  };
}

// Swept elliptical tube along a Catmull-Rom path, tip first. u in [0,1] is the
// shaft; u in [-1,0) is the rounded tip cap and (1,2] the base cap.
// `depth` (optional, per point) sets the dorsal-ventral half-thickness directly;
// `sq` > 2 squares off the cross-section (superellipse).
function digitSpec(T, pts, radii, { dorsal = [1, 0, 0], flat = [0.85, 1], tip = 0.9, base = 1, depth, sq = 2 } = {}) {
  const curve = new T.CatmullRomCurve3(pts.map(p => new T.Vector3(p[0], p[1], p[2])), false, 'centripetal');
  const rad = new T.SplineCurve(radii.map((r, i) => new T.Vector2(i, r)));
  const dep = depth && new T.SplineCurve(depth.map((d, i) => new T.Vector2(i, d)));
  const D = new T.Vector3(dorsal[0], dorsal[1], dorsal[2]).normalize();
  const e = 2 / sq;
  const shape = v => Math.sign(v) * Math.abs(v) ** e;
  const frame = u => {
    const c = curve.getPointAt(u), t = curve.getTangentAt(u);
    const n = D.clone().addScaledVector(t, -D.dot(t)).normalize();
    const b = new T.Vector3().crossVectors(t, n);
    const r = rad.getPoint(u).y;
    return { c, t, n, b, r, d: dep ? dep.getPoint(u).y : r * flat[0] };
  };
  const f0 = frame(0), f1 = frame(1);
  function ring(u) {
    if (u < 0) { const p = Math.min(1, -u) * Math.PI / 2; return { f: f0, ax: -Math.sin(p) * tip, cs: Math.cos(p) }; }
    if (u > 1) { const p = Math.min(1, u - 1) * Math.PI / 2; return { f: f1, ax: Math.sin(p) * base, cs: Math.cos(p) }; }
    return { f: frame(u), ax: 0, cs: 1 };
  }
  function place(rg, a, lift = 0) {
    const { f, ax, cs } = rg;
    return f.c.clone()
      .addScaledVector(f.t, ax * (f.r + lift))
      .addScaledVector(f.n, shape(Math.cos(a)) * cs * (f.d + lift))
      .addScaledVector(f.b, shape(Math.sin(a)) * cs * (f.r * flat[1] + lift));
  }
  return { ring, place };
}

function tubeGeo(T, S, lift = 0, { rings = 72, cap = 10, segs = 40 } = {}) {
  const us = [];
  for (let k = cap - 1; k >= 1; k--) us.push(-k / cap);
  for (let i = 0; i <= rings; i++) us.push(i / rings);
  for (let k = 1; k < cap; k++) us.push(1 + k / cap);
  const pos = [];
  const push = p => pos.push(p.x, p.y, p.z);
  push(S.place(S.ring(-1), 0, lift));
  for (const u of us) {
    const rg = S.ring(u);
    for (let s = 0; s < segs; s++) push(S.place(rg, (s / segs) * Math.PI * 2, lift));
  }
  push(S.place(S.ring(2), 0, lift));
  const L = us.length, last = 1 + L * segs, idx = [];
  const v = (j, s) => 1 + j * segs + (s % segs);
  for (let s = 0; s < segs; s++) idx.push(0, v(0, s + 1), v(0, s));
  for (let j = 0; j < L - 1; j++) {
    for (let s = 0; s < segs; s++) {
      const A = v(j, s), B = v(j, s + 1), C = v(j + 1, s + 1), E = v(j + 1, s);
      idx.push(A, B, E, B, C, E);
    }
  }
  for (let s = 0; s < segs; s++) idx.push(v(L - 1, s), v(L - 1, s + 1), last);
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// Rounded-rectangle patch lying on the tube surface around the dorsal line.
function patchGeo(T, S, u0, u1, w0, lift, dome = 0, nu = 36, na = 16) {
  const pos = [], idx = [];
  for (let i = 0; i <= nu; i++) {
    const v = i / nu, e = 2 * v - 1;
    const rg = S.ring(u0 + (u1 - u0) * v);
    const w = w0 * (e > 0 ? Math.cbrt(Math.max(0, 1 - e ** 3)) : Math.pow(Math.max(0, 1 - e ** 4), 0.25));
    for (let j = 0; j <= na; j++) {
      const q = (2 * j) / na - 1;
      const p = S.place(rg, w * q, lift + dome * (1 - e * e) * (1 - q * q));
      pos.push(p.x, p.y, p.z);
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < na; j++) {
      const a = i * (na + 1) + j;
      idx.push(a, a + na + 1, a + 1, a + 1, a + na + 1, a + na + 2);
    }
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function digit(T, S, M, { outline = 0.03, lift = 0.015, nail, creases = [] } = {}) {
  const g = new T.Group();
  const body = new T.Mesh(tubeGeo(T, S), M.skin);
  body.castShadow = true;
  g.add(body);
  if (outline) g.add(new T.Mesh(tubeGeo(T, S, outline, { rings: 56, cap: 8, segs: 32 }), M.ol));
  if (nail) {
    const [u0, u1, w] = nail;
    g.add(new T.Mesh(patchGeo(T, S, u0 - 0.035, u1 + 0.018, w + 0.055, lift * 0.55), M.rim));
    g.add(new T.Mesh(patchGeo(T, S, u0, u1, w, lift, lift * 0.9), M.nail));
  }
  for (const [u, w = 0.85] of creases) {
    g.add(new T.Mesh(patchGeo(T, S, u - 0.006, u + 0.006, w, lift * 0.4, 0, 2, 18), M.crease));
  }
  return g;
}

export function makeThumb(T) {
  const M = materials(T);
  const S = digitSpec(T, [
    [0.06, 0, 0.46],
    [0.05, 0, 0.82],
    [-0.04, 0, 1.16],
    [-0.24, 0, 1.58],
    [-0.50, 0, 2.04],
    [-0.78, 0, 2.50],
  ], [0.56, 0.58, 0.45, 0.52, 0.58, 0.66], { flat: [0.74, 1.1], tip: 0.8 });
  return digit(T, S, M, {
    outline: 0.035,
    lift: 0.02,
    nail: [-0.22, 0.2, 0.56],
    creases: [[0.365, 0.75], [0.39, 0.6]],
  });
}

export function makeFinger(T) {
  const M = materials(T);
  const S = digitSpec(T, [
    [0.03, 0, 0.26],
    [0.02, 0, 0.52],
    [-0.01, 0, 0.80],
    [-0.06, 0, 1.12],
    [-0.12, 0, 1.44],
    [-0.20, 0, 1.78],
    [-0.30, 0, 2.20],
  ], [0.26, 0.27, 0.25, 0.28, 0.27, 0.29, 0.31], { flat: [0.84, 1.04], tip: 0.9 });
  return digit(T, S, M, {
    outline: 0.024,
    lift: 0.012,
    nail: [-0.42, 0.1, 0.78],
    creases: [[0.30, 0.8], [0.32, 0.6], [0.60, 0.8], [0.62, 0.6]],
  });
}

export function makeHand(T) {
  const M = materials(T);
  const g = new T.Group();
  // Palm + wrist as one flattened superellipse tube: knuckle arch first, wrist last.
  const palm = digitSpec(T, [
    [-0.28, 1.02, 0.02],
    [-0.26, 0.10, 0.06],
    [-0.16, -1.05, 0.08],
    [-0.04, -2.15, 0.02],
    [0.0, -3.00, 0],
    [0.0, -3.80, 0],
  ], [1.66, 1.74, 1.56, 1.06, 0.80, 0.78], {
    dorsal: [0, 0, -1], depth: [0.36, 0.42, 0.46, 0.40, 0.36, 0.36], flat: [1, 1], sq: 3.2, tip: 0.26, base: 0.2,
  });
  g.add(digit(T, palm, M, { outline: 0.035 }));
  const back = { dorsal: [0, 0, -1], flat: [0.8, 1.08], tip: 0.9 };
  // Relaxed hand: fingers fan out and curl slightly toward the palm (+Z).
  const fingers = [
    { base: [1.0, 1.05], len: 2.1, splay: 0.08, r: 0.31 },
    { base: [0.0, 1.15], len: 2.4, splay: 0.0, r: 0.32 },
    { base: [-1.0, 1.08], len: 2.15, splay: -0.07, r: 0.31 },
    { base: [-1.74, 0.85], len: 1.7, splay: -0.16, r: 0.27 },
  ];
  for (const f of fingers) {
    const dx = Math.sin(f.splay), dy = Math.cos(f.splay);
    const pts = [1, 0.74, 0.46, 0.2, 0].map(s => {
      const d = f.len * s;
      return [f.base[0] + dx * d, f.base[1] + dy * d, 0.34 * s * s];
    });
    const radii = [0.92, 0.96, 0.94, 1.0, 1.08].map(k => k * f.r);
    g.add(digit(T, digitSpec(T, pts, radii, back), M, {
      outline: 0.03,
      lift: 0.012,
      nail: [-0.5, 0.14, 0.72],
      creases: [[0.28, 0.7], [0.54, 0.7]],
    }));
  }
  const thumb = digitSpec(T, [
    [2.28, 1.12, 0.34],
    [2.00, 0.70, 0.2],
    [1.64, 0.24, 0.1],
    [1.18, -0.32, 0.04],
    [0.70, -0.80, 0],
  ], [0.31, 0.34, 0.33, 0.42, 0.56], { dorsal: [0.3, 0, -1], flat: [0.8, 1.05], tip: 0.9 });
  g.add(digit(T, thumb, M, {
    outline: 0.03,
    lift: 0.012,
    nail: [-0.5, 0.16, 0.74],
    creases: [[0.28, 0.7]],
  }));
  return g;
}

function eachMat(o, fn) {
  if (!o.material) return;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  for (const m of mats) fn(m);
}

export function prepareMeshFade(obj) {
  obj?.traverse?.(o => {
    if (!o.isMesh) return;
    eachMat(o, m => {
      m.transparent = true;
      m.depthWrite = false;
      m.opacity = 1;
    });
    o.castShadow = false;
    o.receiveShadow = false;
    o.renderOrder = 12;
  });
}

export function fadeGroup(obj, opacity) {
  const a = Math.max(0, Math.min(1, opacity));
  obj?.traverse?.(o => {
    eachMat(o, m => {
      m.transparent = true;
      m.depthWrite = a > 0.98;
      m.opacity = a;
    });
  });
}

export function makeCakeSlice(T) {
  const g = new T.Group();
  const R = 1.35, theta = 1.02, a0 = -theta / 2, a1 = theta / 2;

  function sector(r) {
    const s = new T.Shape();
    s.moveTo(0, 0);
    s.lineTo(r * Math.cos(a0), r * Math.sin(a0));
    s.absarc(0, 0, r, a0, a1, false);
    s.lineTo(0, 0);
    return s;
  }

  const LAYER_EPS = 0.0025;

  function layer(r, depth, color, glow, z, order = 0) {
    const geo = new T.ExtrudeGeometry(sector(r), { depth, bevelEnabled: false, curveSegments: 30 });
    const mesh = new T.Mesh(geo, cakeToonMat(T, color, glow));
    mesh.position.z = z;
    mesh.renderOrder = order;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  }

  // Victoria slice: two sponge layers around jam, a thin icing lid on top.
  const hSponge = 0.2, hJam = 0.05, hIcing = 0.038;
  let z = 0;
  layer(R, hSponge, '#e0b269', 0.1, z, 0);
  z += hSponge + LAYER_EPS;
  layer(R * 0.995, hJam, '#dc3f74', 0.2, z, 1);
  z += hJam + LAYER_EPS;
  layer(R, hSponge, '#f0cd97', 0.1, z, 2);
  z += hSponge + LAYER_EPS;
  const icingZ = z;
  layer(R * 1.008, hIcing, '#ff9ec8', 0.28, icingZ, 3);
  const icingTop = icingZ + hIcing;

  // Icing skirt on the curved crust only (below the lid plane — avoids z-fighting on top).
  const dripMat = cakeToonMat(T, '#ff9ec8', 0.28);
  dripMat.polygonOffsetFactor = -2;
  dripMat.polygonOffsetUnits = -2;
  const dripGeo = new T.SphereGeometry(0.048, 12, 8);
  for (let i = 0; i <= 9; i++) {
    const t = i / 9;
    const a = a0 + (a1 - a0) * t;
    const drop = 0.028 + 0.05 * Math.sin(t * Math.PI) * (i % 2 ? 1 : 0.55);
    const drip = new T.Mesh(dripGeo, dripMat);
    const rim = R * 1.004;
    drip.position.set(Math.cos(a) * rim, Math.sin(a) * rim, icingZ + hIcing * 0.22 - drop * 0.45);
    drip.scale.set(0.82, 0.82, 0.55 + drop * 9);
    drip.renderOrder = 4;
    drip.castShadow = true;
    g.add(drip);
  }

  // Glacé cherry near the wide crust end, stem rooted in its crown.
  const cherryR = 0.11, cherryZ = icingTop + cherryR * 0.78, cherryX = R * 0.66;

  // Sprinkles resting on the icing: laid flat, scattered over the whole lid, clear of the cherry.
  const spr = ['#ffffff', '#ff5ea8', '#7ad7ff', '#ffe566'];
  const sprGeo = new T.CylinderGeometry(0.015, 0.015, 0.075, 6);
  for (let i = 0, placed = 0; i < 40 && placed < 15; i++) {
    const u = 0.24 + 0.66 * Math.sqrt((i * 0.6180339887) % 1);
    const v = 0.1 + 0.8 * ((i * 0.3819660113) % 1);
    const a = a0 + (a1 - a0) * v;
    const x = Math.cos(a) * R * u, y = Math.sin(a) * R * u;
    if (Math.hypot(x - cherryX, y) < cherryR + 0.11) continue;
    const sm = cakeToonMat(T, spr[placed % spr.length], 0.35);
    sm.polygonOffsetFactor = -4;
    sm.polygonOffsetUnits = -4;
    const s = new T.Mesh(sprGeo, sm);
    s.position.set(x, y, icingTop + 0.022);
    s.rotation.set(0, 0, i * 1.1);
    s.renderOrder = 5;
    s.castShadow = true;
    g.add(s);
    placed++;
  }

  const cherry = new T.Mesh(new T.SphereGeometry(cherryR, 14, 12), cakeToonMat(T, '#d8304f', 0.32));
  cherry.position.set(cherryX, 0, cherryZ);
  cherry.scale.set(1, 1, 0.88);
  cherry.renderOrder = 6;
  cherry.castShadow = true;
  g.add(cherry);
  const stemLen = 0.15;
  const stem = new T.Mesh(new T.CylinderGeometry(0.012, 0.018, stemLen, 6), cakeToonMat(T, '#4e8f2a', 0.18));
  stem.renderOrder = 6;
  stem.position.set(cherry.position.x + 0.02, 0, cherryZ + cherryR * 0.72 + stemLen * 0.38);
  stem.rotation.set(Math.PI / 2, 0.42, 0);
  g.add(stem);

  g.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(g);
  const c = box.getCenter(new T.Vector3());
  for (const ch of g.children) { ch.position.x -= c.x; ch.position.y -= c.y; }
  return g;
}

// Single leaf, ~1 unit long, lying in XY with thickness on Z. Scale at the call site.
export function makeLeaf(T, color = '#8fd14f') {
  const g = new T.Group();
  const blade = new T.Shape();
  blade.moveTo(0, -0.46);
  blade.bezierCurveTo(0.33, -0.22, 0.29, 0.24, 0, 0.54);
  blade.bezierCurveTo(-0.29, 0.24, -0.33, -0.22, 0, -0.46);
  const geo = new T.ExtrudeGeometry(blade, {
    depth: 0.05, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 1, curveSegments: 16,
  });
  const mesh = new T.Mesh(geo, toonMat(T, color, 0.16));
  mesh.castShadow = true;
  g.add(mesh);

  // Midrib, tapering to the tip, half-sunk into the blade's top face.
  const veinMat = toonMat(T, '#4e8f2a', 0.12);
  const vein = new T.Mesh(new T.CylinderGeometry(0.006, 0.016, 0.86, 5), veinMat);
  vein.position.set(0, 0.02, 0.062);
  g.add(vein);
  // Side ribs angled toward the tip; length falls off so they stay inside the blade.
  const RIB_ANG = 0.95;
  const dx = Math.sin(RIB_ANG), dy = Math.cos(RIB_ANG);
  for (let i = 0; i < 3; i++) {
    const base = -0.2 + i * 0.22;
    const len = 0.2 - i * 0.035;
    for (const side of [-1, 1]) {
      const rib = new T.Mesh(new T.CylinderGeometry(0.004, 0.009, len, 4), veinMat);
      rib.position.set(side * dx * len * 0.5, base + dy * len * 0.5, 0.06);
      rib.rotation.z = -side * RIB_ANG;
      g.add(rib);
    }
  }

  const stalk = new T.Mesh(new T.CylinderGeometry(0.02, 0.026, 0.22, 6), toonMat(T, '#5d9c33', 0.12));
  stalk.position.set(0, -0.55, 0.025);
  g.add(stalk);
  return g;
}
