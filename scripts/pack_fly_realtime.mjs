// Compact the Cycles vertex bake without reducing the subdivided mesh or its lens facets.
// node scripts/pack_fly_realtime.mjs /tmp/fly-blender/baked public/body/blender
import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { DataUtils } from 'three';

const input = process.argv[2] || '/tmp/fly-blender/baked', output = process.argv[3] || 'public/body/blender';
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const meta = JSON.parse(await fs.readFile(path.join(input, 'fly.json'), 'utf8'));
const look = await fs.readFile(path.join(input, 'agx-look.png'));
const raw = gunzipSync(await fs.readFile(path.join(input, 'fly.bin.gz')));
const binary = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
const chunks = []; let offset = 0, maxPositionError = 0, maxLightError = 0;
function append(data) { const stream = { offset, bytes: data.length }; chunks.push(data); offset += data.length; return stream; }
const range = (data, stride = 3) => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < data.length; i += stride) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], data[i+k]); max[k] = Math.max(max[k], data[i+k]); }
  return { min, max };
};
meta.version = 2; meta.encoding = 'meshopt-gzip';
for (const p of meta.parts) {
  const pos = new Float32Array(binary, p.vOff, p.vCount * 3), normals = new Int16Array(binary, p.nOff, p.vCount * 3);
  const light = new Uint16Array(binary, p.lightOff, p.vCount * 3), indices = new Uint32Array(binary, p.iOff, p.iCount).slice();
  const [remap, count] = MeshoptEncoder.reorderMesh(indices, true, true);
  const bounds = range(pos), quantized = new Uint16Array(count * 4), normal = new Float32Array(count * 4), irradiance = new Uint16Array(count * 4);
  const lightMax = [0, 0, 0];
  for (let i = 0; i < light.length; i++) lightMax[i % 3] = Math.max(lightMax[i % 3], DataUtils.fromHalfFloat(light[i]));
  for (let i = 0; i < p.vCount; i++) {
    const j = remap[i]; if (j === 0xffffffff) continue;
    for (let k = 0; k < 3; k++) {
      const span = bounds.max[k] - bounds.min[k];
      const q = span ? Math.round((pos[3*i+k] - bounds.min[k]) / span * 65535) : 0;
      quantized[4*j+k] = q;
      maxPositionError = Math.max(maxPositionError, Math.abs(pos[3*i+k] - (bounds.min[k] + q / 65535 * span)));
      normal[4*j+k] = normals[3*i+k] / 32767;
      const value = DataUtils.fromHalfFloat(light[3*i+k]);
      const qLight = Math.round(Math.sqrt(value / (lightMax[k] || 1)) * 4095);
      irradiance[4*j+k] = qLight;
      maxLightError = Math.max(maxLightError, Math.abs(value - (qLight / 4095) ** 2 * lightMax[k]));
    }
  }
  const normalOct = MeshoptEncoder.encodeFilterOct(normal, count, 8, 12);
  const encode = array => MeshoptEncoder.encodeVertexBuffer(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), count, 8);
  const streams = { position: append(encode(quantized)), normal: append(encode(normalOct)), light: append(encode(irradiance)),
    index: append(MeshoptEncoder.encodeIndexBuffer(new Uint8Array(indices.buffer), indices.length, 4)) };
  // Prove the encoded index stream preserves the reordered triangles before shipping it.
  const check = new Uint32Array(indices.length);
  const encodedIndex = chunks[chunks.length - 1]; MeshoptDecoder.decodeIndexBuffer(new Uint8Array(check.buffer), indices.length, 4, encodedIndex);
  for (let i = 0; i < indices.length; i += 3) {
    const a = [...indices.subarray(i, i+3)], b = [...check.subarray(i, i+3)];
    if (![0, 1, 2].some(s => a.every((v, k) => v === b[(k+s)%3]))) throw new Error(`Triangle round-trip failed: ${p.geom}`);
  }
  delete p.vOff; delete p.iOff; delete p.nOff; delete p.lightOff;
  p.vCount = count; p.streams = streams; p.bounds = bounds; p.lightMax = lightMax;
}
for (const hair of meta.hairs || []) {
  const light = new Uint16Array(binary, hair.lightOff, hair.count * 3), packed = new Uint16Array(hair.count * 4);
  for (let i = 0; i < hair.count; i++) packed.set(light.subarray(i*3, i*3+3), i*4);
  hair.stream = append(MeshoptEncoder.encodeVertexBuffer(new Uint8Array(packed.buffer), hair.count, 8));
  delete hair.lightOff;
}
// Include the original surface sampler in the same compressed request. It preserves the
// exact procedural hair roots used in the .blend, without a second uncompressed scan download.
const originalScan = JSON.parse(await fs.readFile('public/body/fly_hd.json', 'utf8'));
meta.sourceParts = originalScan.parts;
meta.sourceScan = append(await fs.readFile('public/body/fly_hd.bin'));
await fs.mkdir(output, { recursive: true });
const packed = gzipSync(Buffer.concat(chunks), { level: 9 });
await fs.writeFile(path.join(output, 'fly.mesh'), packed);
await fs.writeFile(path.join(output, 'fly.json'), JSON.stringify(meta) + '\n');
const report = { ...JSON.parse(await fs.readFile(path.join(input, 'bake.json'), 'utf8')), packedBytes: packed.length, maxPositionError, maxLightError };
await fs.writeFile(path.join(output, 'bake.json'), JSON.stringify(report, null, 2) + '\n');
await fs.writeFile(path.join(output, 'agx-look.png'), look);
console.log(report);
