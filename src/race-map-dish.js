// Sugar Run dish map: garden dirt plate, wooden fence rim, swaying grass (render-only).
import * as THREE from 'three';
import { groundAt } from './sim/senses.js';
import { mapPropMeshes } from './race-map-assets.js';
import { propScale } from './desert-prop-scale.js';
import { applySwayWind, SWAY_KINDS, swayForMaterial, swayMaterials } from './race-map-sway.js';
import { applyCelShading, celOutlineMat } from './cel-shade.js';
import { dishDoghouseProps, dishGrassProps } from './sim/maps/dish.js';

const HOUSE_INK = '#1c120c';
const HOUSE_OUTLINE = 1.04;

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

function hash2(ix, iy) {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0), b = hash2(x0 + 1, y0), c = hash2(x0, y0 + 1), d = hash2(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function paintDirtPatches(fx, fs, mid) {
  const img = fx.getImageData(0, 0, fs, fs);
  const d = img.data;
  const vals = new Float32Array(fs * fs);
  const inside = [];
  const s = 1 / 78;
  for (let y = 0; y < fs; y++) {
    for (let x = 0; x < fs; x++) {
      const dx = x + 0.5 - mid, dy = y + 0.5 - mid;
      if (dx * dx + dy * dy > mid * mid) continue;
      const i = y * fs + x;
      vals[i] = 0.54 * valueNoise(x * s, y * s)
        + 0.29 * valueNoise(x * s * 2.15 + 11, y * s * 2.15)
        + 0.17 * valueNoise(x * s * 4.4 + 23, y * s * 4.4);
      inside.push(i);
    }
  }
  const ranked = inside.map(i => vals[i]).sort((a, b) => a - b);
  const t = ranked[Math.floor(ranked.length * 0.62)];
  const tSoft = ranked[Math.floor(ranked.length * 0.54)];
  const span = Math.max(1e-6, t - tSoft);
  for (const i of inside) {
    const v = vals[i];
    const o = i * 4;
    if (v < tSoft) {
      const m = 0.28;
      d[o]     = d[o]     * (1 - m) + 62 * m;
      d[o + 1] = d[o + 1] * (1 - m) + 40 * m;
      d[o + 2] = d[o + 2] * (1 - m) + 24 * m;
      continue;
    }
    const a = v >= t ? 1 : (v - tSoft) / span;
    const mix = 0.72 * a;
    d[o]     = d[o]     + (186 - d[o]) * mix;
    d[o + 1] = d[o + 1] + (142 - d[o + 1]) * mix;
    d[o + 2] = d[o + 2] + (92 - d[o + 2]) * mix;
  }
  fx.putImageData(img, 0, 0);
}

export function paintDishSandBase(fx, fs, logo, ticker) {
  const mid = fs / 2;
  const r = rng(41);
  const rg = fx.createRadialGradient(mid, mid, 0, mid, mid, mid);
  rg.addColorStop(0, '#8a6240');
  rg.addColorStop(0.45, '#6e4c32');
  rg.addColorStop(0.78, '#5a3c26');
  rg.addColorStop(1, '#46301c');
  fx.fillStyle = rg;
  fx.fillRect(0, 0, fs, fs);
  for (let k = 0; k < 1100; k++) {
    fx.fillStyle = r() < 0.55
      ? `rgba(42,26,14,${0.04 + r() * 0.08})`
      : `rgba(150,110,70,${0.04 + r() * 0.07})`;
    fx.beginPath();
    fx.ellipse(r() * fs, r() * fs, (0.3 + r() * 2.8), (0.2 + r() * 1.4), r() * Math.PI, 0, 6.283);
    fx.fill();
  }
  paintDirtPatches(fx, fs, mid);
  fx.strokeStyle = 'rgba(40,24,12,0.14)';
  fx.lineWidth = Math.max(1, fs / 120);
  for (const ring of [0.18, 0.38, 0.58, 0.78, 0.94]) {
    fx.beginPath();
    fx.arc(mid, mid, ring * mid, 0, Math.PI * 2);
    fx.stroke();
  }
  if (logo) {
    const dw = fs * 0.53, dh = dw * (logo.height / logo.width);
    fx.save();
    fx.globalAlpha = 0.5;
    fx.translate(mid, mid);
    fx.rotate(-Math.PI / 2);
    fx.drawImage(logo, -dw / 2, -dh / 2, dw, dh);
    fx.restore();
  }
  if (!ticker) return;
  const angles = [0, 2 * Math.PI / 3, 4 * Math.PI / 3];
  const dw = fs * 0.18, dh = dw * (ticker.height / ticker.width), rr = 0.82 * mid;
  fx.imageSmoothingEnabled = true;
  fx.imageSmoothingQuality = 'high';
  fx.globalAlpha = 0.45;
  for (const a of angles) {
    fx.save();
    fx.translate(mid + rr * Math.cos(a), mid - rr * Math.sin(a));
    fx.rotate(-a + Math.PI / 2);
    fx.drawImage(ticker, -dw / 2, -dh / 2, dw, dh);
    fx.restore();
  }
  fx.globalAlpha = 1;
}

function paintDishFence(wx, ww, wh) {
  wx.imageSmoothingEnabled = true;
  wx.imageSmoothingQuality = 'high';
  const r = rng(17);
  const plankW = ww / 48;
  for (let k = 0; k < 48; k++) {
    const tone = 0.88 + r() * 0.18;
    wx.fillStyle = `rgb(${Math.round(0xb8 * tone)},${Math.round(0x82 * tone)},${Math.round(0x48 * tone)})`;
    wx.fillRect(k * plankW, 0, plankW + 1, wh);
    wx.fillStyle = 'rgba(255,230,190,0.15)';
    wx.fillRect(k * plankW + 2, 2, Math.max(2, plankW * 0.35), wh * 0.12);
    wx.fillStyle = 'rgba(50,30,12,0.12)';
    wx.fillRect(k * plankW + 2, wh * 0.75, plankW - 2, wh * 0.2);
    for (let q = 0; q < 3; q++) {
      wx.fillStyle = `rgba(60,35,15,${0.05 + r() * 0.08})`;
      wx.fillRect(k * plankW + r() * plankW, wh * (0.2 + r() * 0.5), 1 + r() * 3, 8 + r() * 20);
    }
  }
  wx.fillStyle = '#6b4420';
  wx.fillRect(0, 0, ww, wh * 0.14);
  wx.fillStyle = '#8a5a2e';
  wx.fillRect(0, wh * 0.86, ww, wh * 0.14);
  for (let k = 0; k < 12; k++) {
    const px = k * ww / 12;
    wx.fillStyle = '#5a3818';
    wx.fillRect(px, 0, ww / 48, wh);
  }
}

function propZ(p, env) {
  if (p.kind === 'lilypad') return 0.05;
  const g = groundAt([p.x, p.y], env);
  const sink = p.kind === 'reed' || p.kind === 'grass' ? 0 : 0.02;
  return g - sink;
}

const DISH_SKY_HORIZON = '#f4f9ff';

/** Equirect sky: deeper blue at zenith, lighter haze toward the horizon. */
function dishSkyTexture() {
  const w = 512, h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const lg = g.createLinearGradient(0, 0, 0, h);
  lg.addColorStop(0, '#6eb8ea');
  lg.addColorStop(0.38, '#9ed0f2');
  lg.addColorStop(0.72, '#c5e6f8');
  lg.addColorStop(1, DISH_SKY_HORIZON);
  g.fillStyle = lg;
  g.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

/**
 * @param {THREE.Group} envGroup
 * @param {object} env dish env
 * @param {{ renderer, scene, sun, hemi, rim, getLogos: () => { logo, ticker } }} ctx
 */
export function buildDishScene(envGroup, env, ctx) {
  const { renderer, scene, sun, hemi, rim, getLogos } = ctx;
  env.props = [...dishGrassProps(), ...dishDoghouseProps()];
  const R = env.arena.radius;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const own = [];
  const keep = o => { o.userData.keep = true; return o; };
  const root = new THREE.Group();
  root.name = 'dish';
  envGroup.add(root);

  const fs = 1024;
  const fc = document.createElement('canvas');
  fc.width = fc.height = fs;
  const fx = fc.getContext('2d');
  const { logo, ticker } = getLogos?.() || {};
  paintDishSandBase(fx, fs, logo, ticker);
  const base = document.createElement('canvas');
  base.width = base.height = fs;
  base.getContext('2d').drawImage(fc, 0, 0);
  let baseLogo = logo, baseTicker = ticker;
  const ft = new THREE.CanvasTexture(fc);
  ft.colorSpace = THREE.SRGBColorSpace;
  ft.generateMipmaps = false;
  ft.minFilter = THREE.LinearFilter;
  ft.magFilter = THREE.LinearFilter;
  ft.anisotropy = aniso;
  own.push(ft);
  const sandMat = new THREE.MeshStandardMaterial({ map: ft, roughness: 0.92 });
  own.push(sandMat);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(R + 0.1, 96), sandMat);
  floor.receiveShadow = true;
  floor.userData.laserSurface = 'floor';
  root.add(floor);

  const floorPaint = {
    fx, fs, ft,
    paintBase: () => {
      const { logo: lg, ticker: tk } = getLogos?.() || {};
      if (lg !== baseLogo || tk !== baseTicker) {
        baseLogo = lg;
        baseTicker = tk;
        paintDishSandBase(base.getContext('2d'), fs, lg, tk);
      }
      fx.drawImage(base, 0, 0);
    },
  };

  const maxTex = renderer.capabilities.maxTextureSize;
  const ww = Math.min(maxTex, 16384), wh = Math.min(maxTex, 1024);
  const wc = document.createElement('canvas');
  wc.width = ww;
  wc.height = wh;
  const wx = wc.getContext('2d');
  paintDishFence(wx, ww, wh);
  const wt = new THREE.CanvasTexture(wc);
  wt.colorSpace = THREE.SRGBColorSpace;
  wt.generateMipmaps = false;
  wt.minFilter = THREE.LinearFilter;
  wt.magFilter = THREE.LinearFilter;
  wt.anisotropy = aniso;
  own.push(wt);
  const wallMat = new THREE.MeshStandardMaterial({ map: wt, side: THREE.BackSide, roughness: 0.78 });
  own.push(wallMat);
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(R + 0.05, R + 0.05, env.arena.wallHeight, 96, 1, true),
    wallMat,
  );
  wall.rotation.x = Math.PI / 2;
  wall.position.z = env.arena.wallHeight / 2;
  wall.castShadow = wall.receiveShadow = true;
  root.add(wall);

  const byKind = new Map();
  for (const p of env.props || []) {
    if (!byKind.has(p.kind)) byKind.set(p.kind, []);
    byKind.get(p.kind).push(p);
  }
  const mtx = new THREE.Matrix4(), qq = new THREE.Quaternion(), zAxis = new THREE.Vector3(0, 0, 1);
  const sc = new THREE.Vector3(), ps = new THREE.Vector3();
  const houseInk = celOutlineMat(THREE, HOUSE_INK);
  houseInk.side = THREE.BackSide;
  own.push(houseInk);
  for (const [kind, list] of byKind) {
    for (const tm of mapPropMeshes(kind)) {
      const isGrass = kind === 'grass';
      const isHouse = kind === 'doghouse';
      if (isHouse) {
        applyCelShading(tm, { outline: false });
        const mats = Array.isArray(tm.material) ? tm.material : [tm.material];
        for (const m of mats) {
          if (!m) continue;
          m.polygonOffset = true;
          m.polygonOffsetFactor = 1;
          m.polygonOffsetUnits = 1;
        }
      }
      const grassMat = isGrass ? keep(new THREE.MeshBasicMaterial({
        color: new THREE.Color(1.15, 1.7, 1.2),
        vertexColors: true,
      })) : null;
      if (grassMat) {
        grassMat.polygonOffset = true;
        grassMat.polygonOffsetFactor = 1;
        grassMat.polygonOffsetUnits = 1;
        swayForMaterial(grassMat);
      }
      const place = (im, outline) => {
        list.forEach((p, i) => {
          qq.setFromAxisAngle(zAxis, p.yaw || 0);
          sc.set(...propScale(p));
          if (isGrass) { sc.x *= 2.55; sc.y *= 2.55; sc.z *= 1.68; }
          if (outline) sc.multiplyScalar(HOUSE_OUTLINE);
          ps.set(p.x, p.y, propZ(p, env));
          im.setMatrixAt(i, mtx.compose(ps, qq, sc));
        });
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
      };
      if (isHouse) {
        const imOl = keep(new THREE.InstancedMesh(tm.geometry, houseInk, list.length));
        imOl.name = `${kind}:${tm.name}:ink`;
        place(imOl, true);
        imOl.castShadow = imOl.receiveShadow = false;
        imOl.renderOrder = 0;
        root.add(imOl);
      }
      const im = keep(new THREE.InstancedMesh(tm.geometry, isGrass ? grassMat : tm.material, list.length));
      im.name = `${kind}:${tm.name}`;
      place(im, false);
      im.castShadow = !isGrass;
      im.receiveShadow = !isGrass;
      im.renderOrder = 1;
      if (SWAY_KINDS.has(kind) && !isGrass) im.customDepthMaterial = swayMaterials(tm);
      root.add(im);
    }
  }

  const saved = {
    bg: scene.background?.clone?.() ?? scene.background,
    fog: scene.fog,
    envI: scene.environmentIntensity,
    hemi: hemi && { sky: hemi.color.clone(), ground: hemi.groundColor.clone(), i: hemi.intensity },
    sun: sun && { c: sun.color.clone(), i: sun.intensity },
    rim: rim && { c: rim.color.clone(), i: rim.intensity },
  };
  const skyTex = dishSkyTexture();
  own.push(skyTex);
  scene.background = skyTex;
  scene.fog = new THREE.Fog(DISH_SKY_HORIZON, R * 4, R * 14);
  const fill = new THREE.AmbientLight('#fff6ea', 0.32);
  scene.add(fill);
  scene.environmentIntensity = 0.39;
  if (hemi) { hemi.color.set('#f4f8ff'); hemi.groundColor.set('#6b4a32'); hemi.intensity = 0.58; }
  if (sun) { sun.color.set('#fff6e8'); sun.intensity = 2.55; }
  if (rim) { rim.color.set('#ffe8c8'); rim.intensity = 0.71; }

  function update(_nowMs, wind, tSec) {
    applySwayWind(wind, tSec ?? _nowMs / 1000);
  }

  function dispose() {
    envGroup.remove(root);
    root.traverse(o => {
      if (o.isInstancedMesh) o.dispose();
      if ((o.isMesh) && !o.userData.keep) {
        o.geometry.dispose();
        if (!o.userData.shareMat) { o.material.map?.dispose(); o.material.dispose(); }
      }
    });
    for (const r of own) r.dispose();
    ft.dispose();
    scene.remove(fill);
    scene.background = saved.bg;
    scene.fog = saved.fog;
    scene.environmentIntensity = saved.envI;
    if (hemi && saved.hemi) { hemi.color.copy(saved.hemi.sky); hemi.groundColor.copy(saved.hemi.ground); hemi.intensity = saved.hemi.i; }
    if (sun && saved.sun) { sun.color.copy(saved.sun.c); sun.intensity = saved.sun.i; }
    if (rim && saved.rim) { rim.color.copy(saved.rim.c); rim.intensity = saved.rim.i; }
  }

  return { root, floor, wall, floorPaint, update, dispose };
}
