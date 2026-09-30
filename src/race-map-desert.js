// Sugar Run desert map: render-only scene dressing. Physics, senses and fairness live in
// src/sim/maps/desert.js; this draws the sand, walls, water, props, odor trails, the night sky
// and ambient motion (palm sway, dust, tumbleweeds, lamp flicker) on top of the same env.
import * as THREE from 'three';
import { groundAt } from './sim/senses.js';
import { LANE_ANGLES, SPAWN_D } from './sim/maps/desert.js';
import { mapPropMeshes } from './race-map-assets.js';
import { hawkAt } from './race-wind.js';

// Night palette: the sand is lit by the moon, so the painted base stays dark and the warm
// lamp pools below are what the eye reads as light.
const SAND = '#4a3b28';
const LAMP_WARM = '#ffb257';
let baseCache = null;

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// ---------------- sway shader (shared uniforms, patched once per template material) ----------------
const swayUniforms = { uSwayT: { value: 0 }, uWind: { value: new THREE.Vector3(1, 0, 0.35) } };
const SWAY_HEAD = /* glsl */`
attribute vec2 _sway;
uniform float uSwayT;
uniform vec3 uWind;
`;
const SWAY_BODY = /* glsl */`
{
  mat4 swM = modelMatrix;
  #ifdef USE_INSTANCING
  swM = swM * instanceMatrix;
  #endif
  float ph = dot(swM[3].xy, vec2(0.37, 0.61));
  vec3 od = normalize(transpose(mat3(swM)) * vec3(uWind.xy, 0.0));
  float w = _sway.x, fl = _sway.y, s = uWind.z;
  #ifdef SWAY_CROWN
  float bw = 1.0 + 0.6 * w;
  #else
  float bw = w;
  #endif
  float b = bw * bw * (s * 0.10 + 0.03 * sin(uSwayT * 1.3 + ph));
  transformed.xy += od.xy * b;
  transformed.z -= b * b * 0.8;
  float flut = fl * w * (0.004 + 0.012 * s) * sin(uSwayT * 11.0 + ph * 3.0 + dot(position.xy, vec2(23.0, 19.0)));
  transformed += normal * flut;
}
`;
function swayPatch(shader, crown) {
  shader.uniforms.uSwayT = swayUniforms.uSwayT;
  shader.uniforms.uWind = swayUniforms.uWind;
  shader.vertexShader = (crown ? '#define SWAY_CROWN\n' : '') + SWAY_HEAD + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${SWAY_BODY}`);
}
const swayDepth = new Map();
function swayMaterials(mesh) {
  const crown = mesh.name === 'PalmFronds';
  const m = mesh.material;
  if (!m.userData.sway) {
    m.userData.sway = true;
    m.onBeforeCompile = sh => swayPatch(sh, crown);
    m.customProgramCacheKey = () => `sway${crown ? 'C' : ''}`;
  }
  const key = crown ? 'crown' : 'plain';
  if (!swayDepth.has(key)) {
    const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    d.onBeforeCompile = sh => swayPatch(sh, crown);
    d.customProgramCacheKey = () => `swayDepth${crown ? 'C' : ''}`;
    d.userData.keep = true;
    swayDepth.set(key, d);
  }
  return swayDepth.get(key);
}
const SWAY_KINDS = new Set(['palm', 'reed', 'lilypad']);

// ---------------- textures ----------------
function sandNormalTexture() {
  const s = 256, c = document.createElement('canvas'); c.width = c.height = s;
  const x = c.getContext('2d'), img = x.createImageData(s, s), d = img.data;
  const h = (i, j) => {
    const u = i / s * Math.PI * 2, v = j / s * Math.PI * 2;
    return Math.sin(3 * u + 0.8 * Math.sin(v) + 0.35 * Math.sin(2 * v + u)) + 0.35 * Math.sin(7 * u - 2 * v) + 0.2 * Math.sin(11 * u + 5 * v);
  };
  for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
    const dx = h(i + 1, j) - h(i - 1, j), dy = h(i, j + 1) - h(i, j - 1);
    const nx = -dx * 2.2, ny = -dy * 2.2, nz = 1, n = Math.hypot(nx, ny, nz), p = (j * s + i) * 4;
    d[p] = (nx / n * 0.5 + 0.5) * 255; d[p + 1] = (ny / n * 0.5 + 0.5) * 255; d[p + 2] = (nz / n * 0.5 + 0.5) * 255; d[p + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace;
  return t;
}
function waterNormalTexture() {
  const s = 128, c = document.createElement('canvas'); c.width = c.height = s;
  const x = c.getContext('2d'), img = x.createImageData(s, s), d = img.data;
  const h = (i, j) => { const u = i / s * Math.PI * 2, v = j / s * Math.PI * 2; return Math.sin(2 * u + v) + Math.sin(3 * v - u) * 0.7 + Math.sin(5 * u + 4 * v) * 0.3; };
  for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
    const dx = h(i + 1, j) - h(i - 1, j), dy = h(i, j + 1) - h(i, j - 1), n = Math.hypot(dx, dy, 1), p = (j * s + i) * 4;
    d[p] = (-dx / n * 0.5 + 0.5) * 255; d[p + 1] = (-dy / n * 0.5 + 0.5) * 255; d[p + 2] = (1 / n * 0.5 + 0.5) * 255; d[p + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace;
  return t;
}
function sandstoneTexture() {
  const w = 1024, h = 512, c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'), r = rng(31);
  x.fillStyle = '#b98f5a'; x.fillRect(0, 0, w, h);
  const rows = 6, rh = h / rows;
  for (let j = 0; j < rows; j++) {
    const off = (j & 1) ? 0.5 : 0, n = 4;
    for (let k = -1; k < n; k++) {
      const bx = (k + off) * w / n, tone = 0.86 + r() * 0.22;
      x.fillStyle = `rgb(${Math.round(0xd0 * tone)},${Math.round(0xa4 * tone)},${Math.round(0x6c * tone)})`;
      x.fillRect(bx + 3, j * rh + 3, w / n - 6, rh - 6);
      x.fillStyle = 'rgba(255,240,210,0.18)'; x.fillRect(bx + 3, j * rh + 3, w / n - 6, 5);
      x.fillStyle = 'rgba(60,35,15,0.14)'; x.fillRect(bx + 3, j * rh + rh - 9, w / n - 6, 6);
      for (let q = 0; q < 18; q++) { x.fillStyle = `rgba(${r() < 0.5 ? '90,60,30' : '240,215,170'},${0.06 + r() * 0.08})`; x.beginPath(); x.arc(bx + r() * w / n, j * rh + r() * rh, 2 + r() * 9, 0, 6.283); x.fill(); }
    }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function wispTexture() {
  const w = 256, h = 64, c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'), img = x.createImageData(w, h), d = img.data;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const u = i / w * Math.PI * 2, v = j / h;
    const n = 0.22 + 0.12 * Math.sin(3 * u + 6 * v) + 0.08 * Math.sin(7 * u - 4 * v + 1.3) + 0.05 * Math.sin(13 * u + 2);
    const p = (j * w + i) * 4, a = Math.max(0, Math.min(1, n));
    d[p] = 255; d[p + 1] = 255; d[p + 2] = 255; d[p + 3] = a * 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function radialTexture(stops) {
  const s = 128, c = document.createElement('canvas'); c.width = c.height = s;
  const x = c.getContext('2d'), g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  x.fillStyle = g; x.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function hawkTexture() {
  const s = 128, c = document.createElement('canvas'); c.width = c.height = s;
  const x = c.getContext('2d');
  x.filter = 'blur(3px)'; x.fillStyle = 'rgba(40,25,10,1)';
  x.beginPath();
  x.moveTo(64, 30); x.quadraticCurveTo(86, 50, 124, 56); x.quadraticCurveTo(92, 64, 70, 70);
  x.lineTo(76, 98); x.lineTo(64, 92); x.lineTo(52, 98); x.lineTo(58, 70);
  x.quadraticCurveTo(36, 64, 4, 56); x.quadraticCurveTo(42, 50, 64, 30); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------- floor paint ----------------
function paintDesertBase(fx, fs, env) {
  const H = env.arena.half, px = fs / (2 * H), X = x => fs / 2 + x * px, Y = y => fs / 2 - y * px, r = rng(7);
  const g = fx.createRadialGradient(fs / 2, fs / 2, 0, fs / 2, fs / 2, fs * 0.72);
  g.addColorStop(0, '#59462e'); g.addColorStop(0.5, SAND); g.addColorStop(1, '#312619');
  fx.fillStyle = g; fx.fillRect(0, 0, fs, fs);
  for (let k = 0; k < 1400; k++) {
    fx.fillStyle = r() < 0.5 ? `rgba(30,24,16,${0.06 + r() * 0.08})` : `rgba(150,128,96,${0.04 + r() * 0.06})`;
    fx.beginPath(); fx.ellipse(r() * fs, r() * fs, (0.4 + r() * 3.5) * px, (0.2 + r() * 1.5) * px, r() * Math.PI, 0, 6.283); fx.fill();
  }
  // wind ripples
  fx.lineWidth = Math.max(1, px * 0.06);
  for (let y = -H; y < H; y += 0.42) {
    const ph = r() * 6.283, amp = 0.12 + r() * 0.1;
    fx.strokeStyle = `rgba(22,18,12,${0.08 + r() * 0.06})`;
    fx.beginPath();
    for (let x = -H; x <= H; x += 0.5) { const yy = y + amp * Math.sin(x * 0.9 + ph) + 0.25 * Math.sin(x * 0.13 + y * 0.2); x === -H ? fx.moveTo(X(x), Y(yy)) : fx.lineTo(X(x), Y(yy)); }
    fx.stroke();
  }
  // packed-sand lanes from the spawns to the plaza
  fx.lineCap = 'round';
  for (const a of LANE_ANGLES) {
    fx.strokeStyle = 'rgba(150,126,92,0.18)'; fx.lineWidth = 3.2 * px;
    fx.beginPath(); fx.moveTo(X(3 * Math.cos(a)), Y(3 * Math.sin(a))); fx.lineTo(X((SPAWN_D + 1) * Math.cos(a)), Y((SPAWN_D + 1) * Math.sin(a))); fx.stroke();
    const sx = SPAWN_D * Math.cos(a), sy = SPAWN_D * Math.sin(a);
    fx.fillStyle = 'rgba(112,94,70,0.9)'; fx.beginPath(); fx.arc(X(sx), Y(sy), 1.3 * px, 0, 6.283); fx.fill();
    fx.strokeStyle = 'rgba(214,180,128,0.45)'; fx.lineWidth = 0.12 * px; fx.beginPath(); fx.arc(X(sx), Y(sy), 1.3 * px, 0, 6.283); fx.stroke();
    fx.beginPath(); fx.arc(X(sx), Y(sy), 0.8 * px, 0, 6.283); fx.stroke();
  }
  // stone plaza round the sugar
  fx.fillStyle = '#4c3d2a'; fx.beginPath(); fx.arc(X(0), Y(0), 3.2 * px, 0, 6.283); fx.fill();
  fx.strokeStyle = 'rgba(16,12,8,0.5)'; fx.lineWidth = 0.1 * px;
  for (const rr of [1.1, 2.1, 3.2]) { fx.beginPath(); fx.arc(X(0), Y(0), rr * px, 0, 6.283); fx.stroke(); }
  for (let k = 0; k < 24; k++) {
    const a = k / 24 * Math.PI * 2, r0 = (k & 1) ? 1.1 : 2.1;
    fx.beginPath(); fx.moveTo(X(r0 * Math.cos(a)), Y(r0 * Math.sin(a))); fx.lineTo(X(3.2 * Math.cos(a)), Y(3.2 * Math.sin(a))); fx.stroke();
  }
  // wet sand round the pools, grass tufts
  for (const w of env.waterPools || []) {
    const wg = fx.createRadialGradient(X(w.x), Y(w.y), w.r * 0.8 * px, X(w.x), Y(w.y), (w.r + 1.4) * px);
    wg.addColorStop(0, 'rgba(24,18,10,0.8)'); wg.addColorStop(1, 'rgba(24,18,10,0)');
    fx.fillStyle = wg; fx.beginPath(); fx.arc(X(w.x), Y(w.y), (w.r + 1.4) * px, 0, 6.283); fx.fill();
    for (let k = 0; k < 60; k++) {
      const a = r() * 6.283, d = w.r + 0.2 + r() * 1.2;
      fx.fillStyle = `rgba(${40 + r() * 24},${62 + r() * 28},38,${0.4 + r() * 0.3})`;
      fx.beginPath(); fx.arc(X(w.x + d * Math.cos(a)), Y(w.y + d * Math.sin(a)), (0.08 + r() * 0.14) * px, 0, 6.283); fx.fill();
    }
  }
  // soft contact shadows under structures
  for (const p of env.props || []) {
    const sz = p.kind === 'pyramid' ? p.base * 0.75 : p.kind === 'palm' ? 0.9 : p.kind === 'arch' ? p.w * 0.6 : (p.r || p.h * 0.4 || 0.5) * 1.3;
    const sg = fx.createRadialGradient(X(p.x), Y(p.y), 0, X(p.x), Y(p.y), sz * px);
    sg.addColorStop(0, 'rgba(8,6,4,0.4)'); sg.addColorStop(1, 'rgba(8,6,4,0)');
    fx.fillStyle = sg; fx.beginPath(); fx.arc(X(p.x), Y(p.y), sz * px, 0, 6.283); fx.fill();
  }
  // wall footing shade
  const edge = 1.2 * px;
  for (const [x0, y0, x1, y1] of [[0, 0, 0, edge], [0, fs, 0, fs - edge], [0, 0, edge, 0], [fs, 0, fs - edge, 0]]) {
    const lg = fx.createLinearGradient(x0, y0, x1, y1);
    lg.addColorStop(0, 'rgba(6,5,3,0.5)'); lg.addColorStop(1, 'rgba(6,5,3,0)');
    fx.fillStyle = lg; fx.fillRect(0, 0, fs, fs);
  }
  // warm pools of lamp light: the painted half of the night lighting, so every lamp reads
  // as lit even where no real point light reaches
  fx.globalCompositeOperation = 'lighter';
  for (const l of env.lamps || []) {
    const rad = (l.light ? 5.2 : 3.4) * px;
    const lg = fx.createRadialGradient(X(l.x), Y(l.y), 0, X(l.x), Y(l.y), rad);
    lg.addColorStop(0, 'rgba(255,164,72,0.62)');
    lg.addColorStop(0.35, 'rgba(226,126,48,0.3)');
    lg.addColorStop(1, 'rgba(180,90,30,0)');
    fx.fillStyle = lg; fx.beginPath(); fx.arc(X(l.x), Y(l.y), rad, 0, 6.283); fx.fill();
  }
  fx.globalCompositeOperation = 'source-over';
}

// ---------------- placement ----------------
function propScale(p) {
  const s = p.scale ?? 1;
  switch (p.kind) {
    case 'pyramid': return [p.base, p.base, p.h * 1.5];
    case 'arch': return [p.w, p.w, p.h * 1.2];
    case 'pillar_broken': return [1.17, 1.17, p.h];
    case 'rock_a': case 'rock_b': case 'rock_c': case 'pebble': return [p.r, p.r, p.h];
    case 'reed': return [1.2 * s, 1.2 * s, 1.2 * s];
    case 'lilypad': return [0.45 * s, 0.45 * s, 0.45 * s];
    default: return [p.h * s, p.h * s, p.h * s];
  }
}
function propZ(p, env) {
  if (p.kind === 'lilypad') return 0.05;
  const g = groundAt([p.x, p.y], env);
  const sink = p.kind.startsWith('rock') || p.kind === 'pebble' ? 0.12 * p.h : p.kind === 'reed' ? 0 : 0.02;
  return g - sink;
}

function trailRibbon(a, env, len = SPAWN_D - 1, width = 2.4) {
  const nA = 90, nS = 8, ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux, d0 = 1.2;
  const pos = [], col = [], uv = [], idx = [];
  for (let i = 0; i <= nA; i++) {
    const t = i / nA, d = d0 + (len - d0) * t;
    const along = (0.35 + 0.65 * (1 - t)) * Math.min(1, t * 8) * Math.min(1, (1 - t) * 6);
    for (let j = 0; j <= nS; j++) {
      const s = (j / nS - 0.5) * width, x = d * ux + s * nx, y = d * uy + s * ny;
      pos.push(x, y, groundAt([x, y], env) + 0.035);
      const across = Math.exp(-((s / (width * 0.32)) ** 2));
      col.push(0.55, 0.9, 0.32, 0.14 * along * across);
      uv.push(d / 5, j / nS);
    }
  }
  for (let i = 0; i < nA; i++) for (let j = 0; j < nS; j++) {
    const k = i * (nS + 1) + j;
    idx.push(k, k + nS + 1, k + 1, k + 1, k + nS + 1, k + nS + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * @param {THREE.Group} envGroup tilting env group (floor, walls, props)
 * @param {object} env desert env from desertEnv()
 * @param {{ renderer, scene, sun, hemi, rim }} ctx
 */
export function buildDesertScene(envGroup, env, ctx) {
  const { renderer, scene, sun, hemi, rim } = ctx;
  const H = env.arena.half, aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const own = [];   // textures / materials / geometries this scene created
  const keep = o => { o.userData.keep = true; return o; };
  const root = new THREE.Group(); root.name = 'desert'; envGroup.add(root);
  const skyRoot = new THREE.Group(); skyRoot.name = 'desertSky'; scene.add(skyRoot);

  // --- floor: one canvas spanning exactly +-H so chaos scorches line up ---
  // 2048 keeps chaos scorch repaints (laser: every 80 ms) cheap; the tiled normal map carries close-up grain
  const fs = Math.min(2048, renderer.capabilities.maxTextureSize);
  if (!baseCache || baseCache.width !== fs) {
    baseCache = document.createElement('canvas'); baseCache.width = baseCache.height = fs;
    paintDesertBase(baseCache.getContext('2d'), fs, env);
  }
  const base = baseCache;
  const fc = document.createElement('canvas'); fc.width = fc.height = fs; const fx = fc.getContext('2d');
  fx.drawImage(base, 0, 0);
  const ft = new THREE.CanvasTexture(fc); ft.colorSpace = THREE.SRGBColorSpace; ft.anisotropy = aniso;
  const sandN = sandNormalTexture(); sandN.repeat.set(2 * H / 1.6, 2 * H / 1.6); sandN.anisotropy = aniso;
  own.push(sandN);
  const sandMat = new THREE.MeshStandardMaterial({ map: ft, normalMap: sandN, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.96 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2 * H, 2 * H), sandMat);
  floor.receiveShadow = true; floor.userData.laserSurface = 'floor'; root.add(floor);
  const floorPaint = { fx, fs, ft, paintBase: () => fx.drawImage(base, 0, 0) };

  // --- sandstone walls, coping and corner towers (inner face exactly at +-H) ---
  const stone = sandstoneTexture(); stone.anisotropy = aniso; own.push(stone);
  const wallH = env.arena.wallHeight, T = 0.6, L = 2 * H + 2 * T;
  const wallMat = new THREE.MeshStandardMaterial({ map: stone, roughness: 0.9 });
  const copeMat = new THREE.MeshStandardMaterial({ color: '#e0c08e', roughness: 0.85 });
  for (const [x, y, rz] of [[H + T / 2, 0, Math.PI / 2], [-(H + T / 2), 0, Math.PI / 2], [0, H + T / 2, 0], [0, -(H + T / 2), 0]]) {
    const g = new THREE.BoxGeometry(L, T, wallH);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * L / 6, uv.getY(i));
    const w = new THREE.Mesh(g, wallMat); w.position.set(x, y, wallH / 2); w.rotation.z = rz; w.castShadow = w.receiveShadow = true; w.userData.shareMat = true; root.add(w);
    const c = new THREE.Mesh(new THREE.BoxGeometry(L + 0.2, T + 0.3, 0.25), copeMat); c.position.set(x, y, wallH + 0.12); c.rotation.z = rz; c.castShadow = c.receiveShadow = true; c.userData.shareMat = true; root.add(c);
    for (let k = -6; k <= 6; k++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.7, T + 0.24, 0.32), copeMat); m.userData.shareMat = true;
      const along = k * (2 * H / 13);
      m.position.set(rz ? x : along, rz ? along : y, wallH + 0.38); m.rotation.z = rz; m.castShadow = true; root.add(m);
    }
  }
  const towerMat = new THREE.MeshStandardMaterial({ color: '#c89b62', roughness: 0.9 });
  const towerH = wallH + 1.2;
  for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    const cx = sx * (H + T / 2), cy = sy * (H + T / 2);
    const t = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.8, towerH), towerMat); t.position.set(cx, cy, towerH / 2); t.castShadow = t.receiveShadow = true; t.userData.shareMat = true; root.add(t);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.45, 1.1, 4), copeMat); cap.rotation.x = Math.PI / 2; cap.rotation.y = Math.PI / 4; cap.position.set(cx, cy, towerH + 0.55); cap.castShadow = true; cap.userData.shareMat = true; root.add(cap);
  }
  own.push(wallMat, copeMat, towerMat);

  // --- water pools: glassy, scrolling normals, faint ripple rings ---
  const waterN = waterNormalTexture(); waterN.repeat.set(1.5, 1.5); own.push(waterN);
  // near plane is 0.005 cm with far ~320 cm, so stacked discs need real height gaps plus polygon offset;
  // the water is opaque so the sand under it can never show through
  const lift = f => ({ polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: f });
  const waterMat = new THREE.MeshStandardMaterial({ color: '#2a7580', roughness: 0.06, metalness: 0.15, normalMap: waterN, normalScale: new THREE.Vector2(0.45, 0.45), envMapIntensity: 1.6, ...lift(-4) });
  const rimMat = new THREE.MeshStandardMaterial({ color: '#5b4a2c', roughness: 1, ...lift(-2) });
  const rippleMats = [];
  for (const w of env.waterPools || []) {
    const rim = new THREE.Mesh(new THREE.RingGeometry(w.r - 0.05, w.r + 0.18, 64), rimMat);
    rim.position.set(w.x, w.y, 0.02); rim.receiveShadow = true; rim.userData.shareMat = true; root.add(rim);
    const m = new THREE.Mesh(new THREE.CircleGeometry(w.r, 64), waterMat); m.position.set(w.x, w.y, 0.03); m.receiveShadow = true; m.userData.shareMat = true; m.userData.laserIgnore = true; root.add(m);
    for (let k = 0; k < 2; k++) {
      const rm = new THREE.MeshBasicMaterial({ color: '#dff6f2', transparent: true, opacity: 0, depthWrite: false, ...lift(-6) });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.988, 1, 48), rm); ring.position.set(w.x, w.y, 0.04); ring.renderOrder = 2; ring.userData.laserIgnore = true; root.add(ring);
      rippleMats.push({ ring, rm, r: w.r, phase: k * 0.5 + (w.x * 0.13 + w.y * 0.07) % 1 });
    }
  }
  own.push(waterMat, rimMat);

  // --- visible odor: a flowing ribbon per lane and a glow over the sugar ---
  const wisp = wispTexture(); own.push(wisp);
  const trailMat = new THREE.MeshBasicMaterial({ map: wisp, vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  for (const a of LANE_ANGLES) { const m = new THREE.Mesh(trailRibbon(a, env), trailMat); m.renderOrder = 2; m.userData.shareMat = true; m.userData.laserIgnore = true; root.add(m); }
  own.push(trailMat);
  const glowTex = radialTexture([[0, 'rgba(180,255,110,0.12)'], [0.5, 'rgba(180,255,110,0.04)'], [1, 'rgba(180,255,110,0)']]); own.push(glowTex);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(3.4, 48), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  glow.position.z = 0.03; glow.renderOrder = 2; glow.userData.laserIgnore = true; root.add(glow);

  // --- props: one InstancedMesh per template mesh ---
  const byKind = new Map();
  for (const p of env.props || []) { if (!byKind.has(p.kind)) byKind.set(p.kind, []); byKind.get(p.kind).push(p); }
  const mtx = new THREE.Matrix4(), qq = new THREE.Quaternion(), zAxis = new THREE.Vector3(0, 0, 1), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  for (const [kind, list] of byKind) {
    for (const tm of mapPropMeshes(kind)) {
      const im = keep(new THREE.InstancedMesh(tm.geometry, tm.material, list.length));
      im.name = `${kind}:${tm.name}`;
      list.forEach((p, i) => {
        qq.setFromAxisAngle(zAxis, p.yaw || 0); sc.set(...propScale(p)); ps.set(p.x, p.y, propZ(p, env));
        im.setMatrixAt(i, mtx.compose(ps, qq, sc));
      });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
      im.castShadow = kind !== 'lilypad' && kind !== 'pebble'; im.receiveShadow = true;
      if (SWAY_KINDS.has(kind)) im.customDepthMaterial = swayMaterials(tm);
      root.add(im);
    }
  }

  // --- warm lamps: stone post, iron bowl, unlit flame + glow sprite; a few carry a real light ---
  const lampStoneMat = new THREE.MeshStandardMaterial({ color: '#6b5335', roughness: 0.92 });
  const lampIronMat = new THREE.MeshStandardMaterial({ color: '#2b2118', roughness: 0.7, metalness: 0.4 });
  // the ember is additive over the flame, so the flame itself stays orange or the core blows to white
  const flameMat = new THREE.MeshBasicMaterial({ color: '#ffa63c', toneMapped: false });
  const emberMat = new THREE.MeshBasicMaterial({ color: '#e0620f', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const haloTex = radialTexture([[0, 'rgba(255,152,70,0.6)'], [0.3, 'rgba(255,120,44,0.3)'], [1, 'rgba(255,100,28,0)']]);
  const haloMat = new THREE.SpriteMaterial({ map: haloTex, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const postGeo = new THREE.CylinderGeometry(0.1, 0.15, 1, 8); postGeo.rotateX(Math.PI / 2);
  const bowlGeo = new THREE.CylinderGeometry(0.3, 0.16, 0.22, 10); bowlGeo.rotateX(Math.PI / 2);
  const flameGeo = new THREE.ConeGeometry(0.19, 0.42, 7); flameGeo.rotateX(-Math.PI / 2);
  const emberGeo = new THREE.SphereGeometry(0.26, 10, 8);
  own.push(haloTex, lampStoneMat, lampIronMat, flameMat, emberMat, haloMat, postGeo, bowlGeo, flameGeo, emberGeo);
  const lampFx = [];
  for (const l of env.lamps || []) {
    const z0 = groundAt([l.x, l.y], env), fz = z0 + l.h + 0.3;
    const add = (geo, mat, z, cast) => {
      const m = keep(new THREE.Mesh(geo, mat));   // geometry and material are shared, disposed via `own`
      m.position.set(l.x, l.y, z); m.castShadow = !!cast; root.add(m);
      return m;
    };
    const post = add(postGeo, lampStoneMat, z0 + l.h / 2, true); post.scale.z = l.h;
    add(bowlGeo, lampIronMat, z0 + l.h + 0.08, true);
    const flame = add(flameGeo, flameMat, fz); flame.renderOrder = 3; flame.userData.laserIgnore = true;
    const ember = add(emberGeo, emberMat, fz - 0.06); ember.renderOrder = 3; ember.userData.laserIgnore = true;
    const halo = new THREE.Sprite(haloMat.clone());   // per-lamp so each flickers on its own
    own.push(halo.material);
    halo.position.set(l.x, l.y, fz + 0.05); halo.scale.setScalar(l.light ? 2.4 : 1.6); halo.renderOrder = 3; root.add(halo);
    const light = l.light ? new THREE.PointLight(LAMP_WARM, 0, 18, 2) : null;
    if (light) { light.position.set(l.x, l.y, fz + 0.1); root.add(light); }
    lampFx.push({ flame, ember, halo, light, phase: (l.x * 0.7 + l.y * 1.3) % 6.283, peak: 13 });
  }

  // --- tumbleweeds roll along the wall bands (render only, clear of every structure) ---
  const tumble = [];
  for (const tm of mapPropMeshes('tumbleweed')) {
    for (let k = 0; k < 4; k++) {
      const m = keep(new THREE.Mesh(tm.geometry, tm.material)); m.castShadow = true; m.scale.setScalar(0.38); root.add(m);
      tumble.push({ m, band: k, phase: k * 0.37 });
    }
  }

  // --- dust motes drifting with the wind ---
  const DUST = 700, dr = rng(99), dustPos = new Float32Array(DUST * 3), dustSeed = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) { dustPos[i * 3] = (dr() * 2 - 1) * H; dustPos[i * 3 + 1] = (dr() * 2 - 1) * H; dustPos[i * 3 + 2] = 0.05 + dr() * dr() * 2.5; dustSeed[i] = dr(); }
  const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3).setUsage(THREE.DynamicDrawUsage));
  const dustTex = radialTexture([[0, 'rgba(255,236,200,1)'], [1, 'rgba(255,236,200,0)']]); own.push(dustTex);
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: dustTex, size: 0.09, sizeAttenuation: true, transparent: true, opacity: 0.5, depthWrite: false, color: '#9a8560' }));
  dust.frustumCulled = false; dust.renderOrder = 3; root.add(dust);

  // --- hawk shadow ---
  const hawkTex = hawkTexture(); own.push(hawkTex);
  const hawk = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ map: hawkTex, transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  hawk.visible = false; hawk.renderOrder = 2; root.add(hawk);

  // --- night sky dome, stars and a low moon: no sand outside the 50 cm walls ---
  const SKY_R = 180;
  const sky = new THREE.SphereGeometry(SKY_R, 32, 16); sky.rotateX(Math.PI / 2);
  const skyCol = new Float32Array(sky.attributes.position.count * 3), top = new THREE.Color('#05070f'), mid = new THREE.Color('#0d1730'), hor = new THREE.Color('#2e2237'), cc = new THREE.Color();
  for (let i = 0; i < sky.attributes.position.count; i++) {
    const z = Math.max(0, sky.attributes.position.getZ(i) / SKY_R);
    if (z < 0.12) cc.copy(hor).lerp(mid, z / 0.12); else cc.copy(mid).lerp(top, Math.pow((z - 0.12) / 0.88, 0.6)); skyCol[i * 3] = cc.r; skyCol[i * 3 + 1] = cc.g; skyCol[i * 3 + 2] = cc.b;
  }
  sky.setAttribute('color', new THREE.BufferAttribute(skyCol, 3));
  const skyMesh = new THREE.Mesh(sky, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false }));
  skyMesh.renderOrder = -1; skyRoot.add(skyMesh);

  const STARS = 900, sr = rng(4242), starPos = new Float32Array(STARS * 3), starCol = new Float32Array(STARS * 3);
  for (let i = 0; i < STARS; i++) {
    const a = sr() * 6.283, el = Math.pow(sr(), 0.65) * 1.45, R = SKY_R * 0.94;
    starPos[i * 3] = R * Math.cos(el) * Math.cos(a); starPos[i * 3 + 1] = R * Math.cos(el) * Math.sin(a); starPos[i * 3 + 2] = R * Math.sin(el) + 4;
    const b = 0.45 + sr() * 0.55, warm = sr() < 0.25;
    starCol[i * 3] = b; starCol[i * 3 + 1] = b * (warm ? 0.9 : 0.97); starCol[i * 3 + 2] = b * (warm ? 0.76 : 1);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 1.5, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, fog: false, toneMapped: false }));
  stars.renderOrder = -1; skyRoot.add(stars);

  const moonTex = radialTexture([[0, 'rgba(255,255,248,1)'], [0.44, 'rgba(236,240,255,0.95)'], [0.5, 'rgba(150,180,235,0.35)'], [1, 'rgba(110,150,220,0)']]);
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  moon.position.set(-SKY_R * 0.62, SKY_R * 0.55, SKY_R * 0.4); moon.scale.setScalar(34); moon.renderOrder = -1; skyRoot.add(moon);
  own.push(starGeo, stars.material, moonTex, moon.material);

  // --- lighting: dim moonlight from the sky, warmth from the lamps ---
  const saved = {
    bg: scene.background, fog: scene.fog, envI: scene.environmentIntensity,
    hemi: hemi && { sky: hemi.color.clone(), ground: hemi.groundColor.clone(), i: hemi.intensity },
    sun: sun && { c: sun.color.clone(), i: sun.intensity },
    rim: rim && { c: rim.color.clone(), i: rim.intensity },
  };
  scene.background = new THREE.Color('#070a14');
  scene.fog = new THREE.Fog('#0b1020', 46, 150);
  scene.environmentIntensity = 0.05;
  if (hemi) { hemi.color.set('#3f5f92'); hemi.groundColor.set('#231a11'); hemi.intensity = 0.3; }
  if (sun) { sun.color.set('#a6bdea'); sun.intensity = 0.55; }
  if (rim) { rim.color.set('#ff9c46'); rim.intensity = 0.35; }

  let lastT = null;
  function update(nowMs, wind, tSec) {
    const t = tSec ?? nowMs / 1000, dt = lastT == null ? 0 : Math.min(0.1, Math.max(0, t - lastT)); lastT = t;
    // t is wall-clock seconds (~1.8e9): wrap it before it reaches float32 shader math or phase terms
    const ts = t % 3600;
    swayUniforms.uSwayT.value = ts;
    swayUniforms.uWind.value.set(wind.dirX, wind.dirY, wind.strength);
    waterN.offset.set((ts * 0.02) % 1, (ts * 0.013) % 1);
    wisp.offset.x = (wisp.offset.x - 0.12 * (0.7 + wind.strength * 0.3) * dt) % 1;
    glow.material.opacity = 0.16 + 0.05 * Math.sin(ts * 1.6);
    for (const rp of rippleMats) {
      const u = (t / 8.5 + rp.phase) % 1, s = 0.2 + u * rp.r * 0.9;
      rp.ring.scale.set(s, s, 1); rp.rm.opacity = 0.14 * (1 - u) * Math.min(1, u * 6);
    }
    // lamp flicker: one wobble drives the flame, the ember, the halo and the point light together
    for (const lf of lampFx) {
      const f = 0.82 + 0.18 * Math.sin(ts * 9.3 + lf.phase) + 0.1 * Math.sin(ts * 21.7 + lf.phase * 2.3);
      lf.flame.scale.set(0.92 + 0.12 * f, 0.92 + 0.12 * f, 0.82 + 0.3 * f);
      lf.flame.rotation.z = 0.12 * Math.sin(ts * 3.1 + lf.phase) + wind.dirX * wind.strength * 0.25;
      lf.ember.scale.setScalar(0.85 + 0.2 * f);
      lf.halo.material.opacity = 0.55 + 0.2 * f;
      if (lf.light) lf.light.intensity = lf.peak * (0.78 + 0.22 * f);
    }
    // tumbleweeds: move with the wind component along their band, wrap with a fade
    for (const tw of tumble) {
      const horiz = tw.band < 2, along = horiz ? wind.dirX : wind.dirY;
      const v = (0.12 + wind.strength * 0.35) * (along >= 0 ? 1 : -1);
      const span = 2 * H + 14;
      tw.dist = (tw.dist ?? tw.phase * span) + v * dt;
      const u = ((tw.dist / span) % 1 + 1) % 1, s = (u - 0.5) * span;
      const side = (tw.band & 1) ? 1 : -1, off = side * (H - 1.7);
      const x = horiz ? s : off, y = horiz ? off : s, r = 0.38;
      const hop = Math.abs(Math.sin(ts * 1.2 + tw.phase * 9)) * 0.08 * Math.min(1, wind.strength);
      tw.m.position.set(x, y, groundAt([x, y], env) + r + hop);
      const roll = tw.dist / r;
      tw.m.rotation.set(horiz ? 0 : -roll, horiz ? roll : 0, tw.phase * 4);
      tw.m.scale.setScalar(r * Math.min(1, Math.min(u, 1 - u) * 12));
    }
    // dust
    const dv = 0.06 + wind.strength * 0.18, vx = wind.dirX * dv, vy = wind.dirY * dv;
    for (let i = 0; i < DUST; i++) {
      const k = i * 3, sd = dustSeed[i];
      dustPos[k] += (vx * (0.6 + sd) + 0.02 * Math.sin(ts * 0.3 + sd * 40)) * dt;
      dustPos[k + 1] += (vy * (0.6 + sd) + 0.02 * Math.cos(ts * 0.25 + sd * 30)) * dt;
      dustPos[k + 2] = 0.05 + (sd * sd) * 2.5 + 0.08 * Math.sin(ts * 0.2 + sd * 17);
      if (dustPos[k] > H) dustPos[k] -= 2 * H; else if (dustPos[k] < -H) dustPos[k] += 2 * H;
      if (dustPos[k + 1] > H) dustPos[k + 1] -= 2 * H; else if (dustPos[k + 1] < -H) dustPos[k + 1] += 2 * H;
    }
    dustGeo.attributes.position.needsUpdate = true;
    dust.material.opacity = 0.3 + 0.35 * Math.min(1, wind.strength);
    // hawk
    const hk = hawkAt(t);
    hawk.visible = hk.active && Math.abs(hk.x) < H + 2 && Math.abs(hk.y) < H + 2;
    if (hawk.visible) {
      const bank = Math.sin(hk.u * Math.PI * 2) * 0.25;
      hawk.position.set(hk.x, hk.y, groundAt([hk.x, hk.y], env) + 0.06);
      hawk.rotation.set(0, 0, hk.yaw - Math.PI / 2 + bank);
      hawk.material.opacity = 0.32 * Math.min(1, Math.min(hk.u, 1 - hk.u) * 8);
    }
  }

  function dispose() {
    skyRoot.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    scene.remove(skyRoot);
    envGroup.remove(root);
    root.traverse(o => { if (o.isInstancedMesh) o.dispose(); if ((o.isMesh || o.isPoints) && !o.userData.keep) { o.geometry.dispose(); if (!o.userData.shareMat) { o.material.map?.dispose(); o.material.dispose(); } } });
    for (const r of own) r.dispose();
    ft.dispose();
    scene.background = saved.bg; scene.fog = saved.fog; scene.environmentIntensity = saved.envI;
    if (hemi && saved.hemi) { hemi.color.copy(saved.hemi.sky); hemi.groundColor.copy(saved.hemi.ground); hemi.intensity = saved.hemi.i; }
    if (sun && saved.sun) { sun.color.copy(saved.sun.c); sun.intensity = saved.sun.i; }
    if (rim && saved.rim) { rim.color.copy(saved.rim.c); rim.intensity = saved.rim.i; }
  }

  return { root, floor, floorPaint, update, dispose };
}
