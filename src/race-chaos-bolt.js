// Jagged tube lightning — shared by Flies Armageddon chaos FX and /local/prop-studio.

const LAYER_CORE = 0;
const LAYER_SHEATH = 1;
const LAYER_BLOOM = 2;

const BOLT_VERT = `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const BOLT_FRAG = `
  uniform float uTime;
  uniform float uPulse;
  uniform float uLayer;
  uniform float uBaseOpacity;
  uniform vec3 uColorHot;
  uniform vec3 uColorCool;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDir;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    float radial = abs(vUv.y - 0.5) * 2.0;
    float core = exp(-radial * radial * 10.0);

    float flick = sin(vUv.x * 48.0 + uTime * 0.009) * 0.5 + 0.5;
    flick *= sin(vUv.x * 19.0 - uTime * 0.013) * 0.5 + 0.5;
    flick = mix(0.55, 1.0, flick);
    flick *= 0.82 + 0.18 * hash(vec2(floor(vUv.x * 96.0), uLayer + uTime * 0.001));

    vec3 n = normalize(vNormalW);
    vec3 v = normalize(vViewDir);
    float fresnel = pow(clamp(1.0 - abs(dot(n, v)), 0.0, 1.0), 2.2);

    vec3 col = mix(uColorCool, uColorHot, core);
    float layerGain = 1.0;
    if (uLayer < 0.5) {
      col = mix(col, vec3(1.0), core * 0.9);
    } else if (uLayer < 1.5) {
      layerGain = 0.58;
    } else {
      layerGain = 0.38;
      fresnel *= 1.35;
      col = mix(col, uColorCool, 0.25);
    }

    float bright = (core * 0.75 + fresnel * 0.5) * layerGain * uPulse * flick;
    float alpha = bright * uBaseOpacity;
    gl_FragColor = vec4(col * alpha, alpha);
  }
`;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = a + 0x6d2b79f5 | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const boltMatCache = new Map();

function createBoltMaterial(T, layer, baseOpacity) {
  const layerIdx = layer === 'core' ? LAYER_CORE : layer === 'sheath' ? LAYER_SHEATH : LAYER_BLOOM;
  const hot = layer === 'core' ? new T.Color('#ffffff') : layer === 'sheath' ? new T.Color('#a8e8ff') : new T.Color('#e8d4ff');
  const cool = layer === 'core' ? new T.Color('#c8f0ff') : layer === 'sheath' ? new T.Color('#3a9fd8') : new T.Color('#7a58c8');
  return new T.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPulse: { value: 1 },
      uLayer: { value: layerIdx },
      uBaseOpacity: { value: baseOpacity },
      uColorHot: { value: hot },
      uColorCool: { value: cool },
    },
    vertexShader: BOLT_VERT,
    fragmentShader: BOLT_FRAG,
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    toneMapped: false,
    side: T.DoubleSide,
  });
}

function boltMaterial(T, layer, baseOpacity) {
  let proto = boltMatCache.get(layer);
  if (!proto) {
    proto = createBoltMaterial(T, layer, 1);
    boltMatCache.set(layer, proto);
  }
  const mat = proto.clone();
  mat.uniforms.uBaseOpacity.value = baseOpacity;
  return mat;
}

/** Compile the three bolt programs once so the first live strike is not a shader hitch. */
export function warmBoltMaterials(T) {
  for (const layer of ['core', 'sheath', 'bloom']) {
    if (!boltMatCache.has(layer)) boltMatCache.set(layer, createBoltMaterial(T, layer, 1));
  }
}

function jagged(a, b, gens = 5, spread = 1.4, rng = Math.random) {
  let pts = [a, b];
  for (let g = 0; g < gens; g++) {
    const next = [], jag = spread * Math.pow(0.52, g);
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      next.push(p, {
        x: (p.x + q.x) / 2 + (rng() - 0.5) * jag,
        y: (p.y + q.y) / 2 + (rng() - 0.5) * jag,
        z: (p.z + q.z) / 2 + (rng() - 0.5) * jag * 0.15,
      });
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

function boltMesh(T, pts, radius, layer, baseOpacity, radialSegments) {
  if (!pts || pts.length < 2) return null;
  const v = pts.map(p => new T.Vector3(p.x, p.y, p.z));
  try {
    const curve = new T.CatmullRomCurve3(v, false, 'catmullrom', 0.35);
    const geo = new T.TubeGeometry(curve, Math.max(8, pts.length), radius, radialSegments, false);
    const mat = boltMaterial(T, layer, baseOpacity);
    const mesh = new T.Mesh(geo, mat);
    mesh.renderOrder = 6;
    mesh.userData.boltLayer = layer;
    mesh.userData.baseOp = baseOpacity;
    return mesh;
  } catch {
    return null;
  }
}

function addBoltForks(T, pts, floorZ, rCore, rSheath, add, depth, maxDepth, rng, thin) {
  const scale = Math.pow(0.58, depth);
  const n = depth === 0 ? (thin ? 2 : 3) + Math.floor(rng() * 2) : 1 + Math.floor(rng() * 2);
  const randRange = (a, b) => a + rng() * (b - a);
  for (let i = 0; i < n; i++) {
    const src = pts[Math.floor(pts.length * randRange(0.12 + depth * 0.1, 0.7))];
    const remain = src.z - floorZ;
    if (remain < 0.6) continue;
    const ang = randRange(0, Math.PI * 2);
    const out = remain * randRange(0.18, 0.48) * scale;
    const end = {
      x: src.x + Math.cos(ang) * out,
      y: src.y + Math.sin(ang) * out,
      z: Math.max(floorZ, src.z - remain * randRange(0.28, 0.72)),
    };
    const br = jagged(src, end, 4, Math.max(0.35, out * 0.45), rng);
    const k = 0.52 * scale;
    add(boltMesh(T, br, rCore * k, 'core', 0.9, thin ? 5 : 6), 'core');
    add(boltMesh(T, br, rSheath * k, 'sheath', 0.36, thin ? 6 : 8), 'sheath');
    if (depth + 1 < maxDepth && rng() < 0.7) {
      addBoltForks(T, br, floorZ, rCore, rSheath, add, depth + 1, maxDepth, rng, thin);
    }
  }
}

/**
 * @param {number} x strike x (group offset)
 * @param {number} y strike y
 * @param {{ fork?: boolean, height?: number, thin?: boolean, hit?: boolean, seed?: number }} opts
 */
export function makeBolt(T, x, y, { fork = true, height = 8, thin = false, hit = false, seed } = {}) {
  const rng = seed != null ? mulberry32(seed) : Math.random;
  const randRange = (a, b) => a + rng() * (b - a);
  const g = new T.Group();
  g.position.set(x, y, height);
  const floorZ = 0.04 - height;
  const wander = Math.min(3.4, height * 0.09);
  const top = { x: randRange(-wander, wander), y: randRange(-wander, wander), z: 0 };
  const bot = { x: 0, y: 0, z: floorZ };
  const main = jagged(top, bot, thin ? 4 : 5, thin ? wander * 0.5 : wander, rng);
  const rCore = thin ? 0.04 : 0.05;
  const rSheath = thin ? 0.16 : 0.22;
  const rBloom = thin ? 0.32 : (hit ? 0.64 : 0.48);
  const add = (mesh, kind) => { if (mesh) g.add(mesh); };
  add(boltMesh(T, main, rCore, 'core', 1, thin ? 5 : 6), 'core');
  add(boltMesh(T, main, rSheath, 'sheath', thin ? 0.42 : 0.52, thin ? 6 : 8), 'sheath');
  if (!thin) add(boltMesh(T, main, rBloom, 'bloom', hit ? 0.28 : 0.16, 8), 'bloom');
  if (fork) addBoltForks(T, main, floorZ, rCore, rSheath, add, 0, thin ? 1 : 2, rng, thin);
  return g;
}

export function boltPulse(u) {
  const t = u * 450;
  if (t < 70) {
    const k = t / 70;
    return { reveal: k, core: k, glow: k, flash: k };
  }
  if (t < 270) {
    const p = (t - 70) / 200;
    const flick = Math.abs(Math.sin(p * Math.PI * 3));
    const k = 0.12 + 0.88 * flick ** 0.35;
    return { reveal: 1, core: k > 0.35 ? 1 : 0.18, glow: k, flash: 0.55 + 0.45 * flick };
  }
  const d = (t - 270) / 180;
  return { reveal: 1, core: Math.max(0, 1 - d * 2.2), glow: 1 - d, flash: (1 - d) * 0.7 };
}

export function setBoltMaterialsTime(group, elapsedMs) {
  group.traverse(o => {
    if (o.material?.uniforms?.uTime) o.material.uniforms.uTime.value = elapsedMs;
  });
}

export function setBoltPulse(group, e, elapsedMs = 0) {
  group.traverse(o => {
    if (!o.material?.uniforms) return;
    const layer = o.userData.boltLayer;
    const base = o.userData.baseOp ?? 1;
    const pulse = layer === 'core' ? e.core : e.glow;
    o.material.uniforms.uPulse.value = pulse;
    o.material.uniforms.uBaseOpacity.value = base;
    o.material.uniforms.uTime.value = elapsedMs;
  });
}

let flashTexCache = null;

export function boltGroundFlashMaterial(T, hit = false) {
  if (!flashTexCache) {
    const s = 256, c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(220,245,255,0.95)');
    g.addColorStop(0.45, 'rgba(120,200,255,0.35)');
    g.addColorStop(0.72, 'rgba(160,120,255,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    flashTexCache = new T.CanvasTexture(c);
    flashTexCache.colorSpace = T.SRGBColorSpace;
  }
  return new T.MeshBasicMaterial({
    map: flashTexCache,
    color: hit ? '#ffffff' : '#e8f4ff',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: T.AdditiveBlending,
    toneMapped: false,
  });
}
