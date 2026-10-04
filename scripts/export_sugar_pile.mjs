/**
 * Bake a single poured-sugar mound GLB (+Z up) for map centres.
 * Run: node scripts/export_sugar_pile.mjs
 *
 * One origin-centred mesh + embedded granule albedo. Skirt sits above z=0 so ink does not fight the floor.
 * Gameplay food disc is env.food[0] (taste r ≈ 0.62, win r = 0.5).
 */
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const payload = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(payload));
  return Buffer.concat([len, payload, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  const src = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    src.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

if (!globalThis.ImageData) {
  globalThis.ImageData = class ImageData {
    constructor(data, w, h) {
      if (typeof data === 'number') {
        h = w;
        w = data;
        data = new Uint8ClampedArray(w * h * 4);
      }
      this.data = data;
      this.width = w;
      this.height = h;
      this.colorSpace = 'srgb';
    }
  };
}

class NodeCanvas {
  constructor() {
    this.width = 0;
    this.height = 0;
    this._data = null;
  }
  getContext() {
    const c = this;
    return {
      translate() {},
      scale() {},
      createImageData(w, h) { return new ImageData(w, h); },
      putImageData(img) {
        c.width = img.width;
        c.height = img.height;
        c._data = img.data;
      },
      getImageData() {
        return new ImageData(c._data ?? new Uint8ClampedArray(c.width * c.height * 4), c.width, c.height);
      },
      drawImage() {},
    };
  }
  toBlob(cb) {
    const png = encodePng(this.width, this.height, this._data);
    cb(new Blob([png], { type: 'image/png' }));
  }
}

if (!globalThis.FileReader) {
  globalThis.FileReader = class FileReader {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then(buf => {
        this.result = buf;
        this.onload?.({ target: this });
        this.onloadend?.({ target: this });
      });
    }
  };
}
if (!globalThis.document) {
  globalThis.document = {
    createElement() { return new NodeCanvas(); },
  };
}

const outPath = path.join('public', 'maps', 'sugar_pile.glb');
fs.mkdirSync(path.dirname(outPath), { recursive: true });

let seed = 77;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const fade = t => t * t * (3 - 2 * t);
function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const h = (i, j) => {
    const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
  const ux = fade(fx), uy = fade(fy);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x, y, oct = 5) {
  let v = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    v += a * noise2(x * f, y * f);
    a *= 0.5;
    f *= 2.05;
  }
  return v;
}

function sugarAlbedo(size = 512) {
  const data = new Uint8Array(size * size * 4);
  const stamp = (cx, cy, rx, ry, r, g, b) => {
    const x0 = Math.max(0, Math.floor(cx - rx - 1));
    const x1 = Math.min(size - 1, Math.ceil(cx + rx + 1));
    const y0 = Math.max(0, Math.floor(cy - ry - 1));
    const y1 = Math.min(size - 1, Math.ceil(cy + ry + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const u = (x - cx) / rx, v = (y - cy) / ry;
        const d = u * u + v * v;
        if (d > 1) continue;
        const w = (1 - d) * (1 - d);
        const i = (y * size + x) * 4;
        data[i] = data[i] * (1 - w) + r * w;
        data[i + 1] = data[i + 1] * (1 - w) + g * w;
        data[i + 2] = data[i + 2] * (1 - w) + b * w;
      }
    }
  };

  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0;
    const n = fbm(x / 28, y / 28, 4);
    data[i * 4] = 214 + n * 18;
    data[i * 4 + 1] = 202 + n * 16;
    data[i * 4 + 2] = 178 + n * 14;
    data[i * 4 + 3] = 255;
  }

  for (let k = 0; k < 3800; k++) {
    const cx = rand() * size, cy = rand() * size;
    const s = 2.2 + rand() * 4.8;
    const warm = rand();
    const r = 236 + rand() * 16;
    const g = 226 + rand() * 14 - warm * 10;
    const b = 204 + rand() * 16 - warm * 18;
    stamp(cx, cy, s, s * (0.7 + rand() * 0.5), r, g, b);
  }
  for (let k = 0; k < 420; k++) {
    const cx = rand() * size, cy = rand() * size;
    const s = 3.2 + rand() * 5.5;
    stamp(cx, cy, s * 0.6, s, 255, 250, 238);
  }
  return data;
}

function moundGeo() {
  const profile = [
    [0.00, 0.30],
    [0.04, 0.295],
    [0.10, 0.275],
    [0.18, 0.235],
    [0.26, 0.175],
    [0.34, 0.115],
    [0.42, 0.062],
    [0.49, 0.026],
    [0.54, 0.010],
    [0.58, 0.006],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(profile, 64);
  g.rotateX(Math.PI / 2);
  const idx = g.getIndex();
  if (idx) {
    const arr = idx.array;
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i + 1];
      arr[i + 1] = arr[i + 2];
      arr[i + 2] = t;
    }
    idx.needsUpdate = true;
  }
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ang = Math.atan2(y, x);
    const r = Math.hypot(x, y);
    const lump = (fbm(x * 6.2, y * 6.2, 4) - 0.5);
    const lobe = 0.055 * Math.sin(2 * ang + 0.6) + 0.03 * Math.sin(5 * ang - 0.4);
    const radial = 1 + lobe + lump * 0.045;
    x *= radial * 1.04;
    y *= radial * 0.96;
    if (z > 0.012) {
      const along = nrm ? [nrm.getX(i), nrm.getY(i), nrm.getZ(i)] : [0, 0, 1];
      const bump = (fbm(x * 9.5 + 2, y * 9.5, 3) - 0.45) * 0.028 * Math.min(1, z / 0.12);
      x += along[0] * bump;
      y += along[1] * bump;
      z = Math.max(0.006, z + along[2] * bump * 0.7 + lump * 0.012);
    }
    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
  const uv = g.attributes.uv;
  let maxR = 0.01;
  for (let i = 0; i < pos.count; i++) maxR = Math.max(maxR, Math.hypot(pos.getX(i), pos.getY(i)));
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, 0.5 + pos.getX(i) / (2 * maxR), 0.5 + pos.getY(i) / (2 * maxR));
  }
  uv.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

function sugarMap() {
  const size = 512;
  const tex = new THREE.DataTexture(sugarAlbedo(size), size, size);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  tex.flipY = false;
  return tex;
}

function buildSugarPile() {
  const root = new THREE.Group();
  root.name = 'SugarPile';
  const geo = moundGeo();
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    map: sugarMap(),
    roughness: 0.86,
    metalness: 0.0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'SugarMound';
  root.add(mesh);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  mesh.geometry.translate(0, 0, 0.006 - box.min.z);
  return root;
}

function exportGlb(filename, object) {
  const scene = new THREE.Scene();
  scene.add(object);
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      result => {
        const buf = result instanceof ArrayBuffer ? Buffer.from(result) : Buffer.from(result);
        fs.writeFileSync(filename, buf);
        resolve();
      },
      err => reject(err),
      { binary: true },
    );
  });
}

const root = buildSugarPile();
root.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(root);
const size = box.getSize(new THREE.Vector3());
await exportGlb(outPath, root);
console.log(`Wrote ${outPath}  footZ ${box.min.z.toFixed(3)}  H ${size.z.toFixed(3)}  XY ${size.x.toFixed(2)}×${size.y.toFixed(2)}`);
