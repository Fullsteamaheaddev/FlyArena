// Cycles diffuse transport on real subdivided geometry; camera-dependent gloss stays live.
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export async function loadBlenderFly(base, progress = () => {}) {
  const [meta, response] = await Promise.all([
    fetch(`${base}body/blender/fly.json`).then(r => { if (!r.ok) throw new Error('Blender mesh metadata unavailable'); return r.json(); }),
    fetch(`${base}body/blender/fly.mesh`),
  ]);
  if (!response.ok) throw new Error('Blender mesh unavailable');
  let loaded = 0; const size = +response.headers.get('content-length');
  const stream = response.body.pipeThrough(new TransformStream({ transform(chunk, controller) {
    loaded += chunk.byteLength; progress(size ? `loading Blender body ${Math.min(100, loaded / size * 100).toFixed(0)}%` : `loading Blender body ${(loaded / 1e6).toFixed(1)} MB`); controller.enqueue(chunk);
  } })).pipeThrough(new DecompressionStream('gzip'));
  const binary = await new Response(stream).arrayBuffer();
  await MeshoptDecoder.ready;
  return { meta, binary, source: binary.slice(meta.sourceScan.offset, meta.sourceScan.offset + meta.sourceScan.bytes) };
}

export function applyBlenderFly(appearance, { meta, binary }) {
  const materialParts = new Map();
  const materialVariants = new Map();
  for (const part of meta.parts) {
    const mesh = appearance.meshes.find(m => m.name === part.geom);
    const geometry = new THREE.BufferGeometry();
    const decode = (key, filter) => {
      const stream = part.streams[key], data = new Uint8Array(part.vCount * 8);
      MeshoptDecoder.decodeVertexBuffer(data, part.vCount, 8, new Uint8Array(binary, stream.offset, stream.bytes), filter);
      return data;
    };
    const positionQ = new Uint16Array(decode('position').buffer), normals = new Int16Array(decode('normal', 'OCTAHEDRAL').buffer), lightQ = new Uint16Array(decode('light').buffer);
    const positions = new Float32Array(part.vCount * 3), normal = new Int16Array(part.vCount * 3), light = new Float32Array(part.vCount * 3);
    for (let i = 0; i < part.vCount; i++) for (let k = 0; k < 3; k++) {
      positions[3*i+k] = part.bounds.min[k] + positionQ[4*i+k] / 65535 * (part.bounds.max[k] - part.bounds.min[k]);
      normal[3*i+k] = normals[4*i+k];
      light[3*i+k] = (lightQ[4*i+k] / 4095) ** 2 * part.lightMax[k];
    }
    const indices = new Uint32Array(part.iCount), indexStream = part.streams.index;
    MeshoptDecoder.decodeIndexBuffer(new Uint8Array(indices.buffer), part.iCount, 4, new Uint8Array(binary, indexStream.offset, indexStream.bytes));
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3, true));
    geometry.setAttribute('aCyclesLight', new THREE.BufferAttribute(light, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    if (/membrane/.test(part.geom)) {
      const uv = new Float32Array(part.vCount * 2), { min, max } = part.bounds;
      for (let i = 0; i < part.vCount; i++) { uv[2*i] = (positions[3*i]-min[0])/(max[0]-min[0]); uv[2*i+1] = (positions[3*i+1]-min[1])/(max[1]-min[1]); }
      geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    if (part.geom === 'head_red') {
      // Overall eye curvature for the pseudopupil, separate from the new rounded lens normals.
      const positions = geometry.attributes.position, smooth = new Float32Array(part.vCount * 3);
      const center = [new THREE.Vector3(), new THREE.Vector3()], count = [0, 0];
      for (let i = 0; i < positions.count; i++) { const side = positions.getX(i) > 0 ? 1 : 0; center[side].add(new THREE.Vector3().fromBufferAttribute(positions, i)); count[side]++; }
      center.forEach((c, i) => c.divideScalar(count[i]));
      const n = new THREE.Vector3();
      for (let i = 0; i < positions.count; i++) n.fromBufferAttribute(positions, i).sub(center[positions.getX(i) > 0 ? 1 : 0]).normalize().toArray(smooth, i * 3);
      geometry.setAttribute('aSmooth', new THREE.BufferAttribute(smooth, 3));
    }
    geometry.computeBoundingSphere(); geometry.computeBoundingBox();
    mesh.geometry.dispose(); mesh.geometry = geometry;
    if (!/membrane/.test(part.geom)) {
      if (!/^abdomen/.test(part.geom)) {
        const original = mesh.material, key = `${original.uuid}:${part.surface.name}`;
        if (!materialVariants.has(key)) {
          const material = original.clone();
          material.userData = original.userData;
          material.onBeforeCompile = original.onBeforeCompile;
          material.customProgramCacheKey = original.customProgramCacheKey;
          materialVariants.set(key, material);
        }
        mesh.material = materialVariants.get(key);
      }
      materialParts.set(mesh.material, part);
    }
  }
  for (const [material, part] of materialParts) {
    const surface = part.surface;
    material.color.setRGB(...surface.color, THREE.LinearSRGBColorSpace);
    material.roughness = surface.roughness;
    material.ior = surface.ior;
    material.specularIntensity = 1;
    material.clearcoat = surface.coat;
    material.clearcoatRoughness = surface.coatRoughness;
    material.sheen = 0;
    if (material.userData.u) {
      material.userData.u.uBump.value = .8;
      material.userData.u.uDark.value.setRGB(.017, .006, .002, THREE.LinearSRGBColorSpace);
    }
    const compile = material.onBeforeCompile, cacheKey = material.customProgramCacheKey();
    material.customProgramCacheKey = () => `${cacheKey}-cycles-vertex-v1`;
    material.onBeforeCompile = shader => {
      compile.call(material, shader);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aCyclesLight; varying vec3 vCyclesLight;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCyclesLight = aCyclesLight;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vCyclesLight;')
        .replace('diffuseColor.rgb *= .68 + .6 * mott;', 'diffuseColor.rgb *= .55 + .75 * clamp((mott - .18) / .64, 0., 1.);')
        .replace(/vec3 bumpNormal\([\s\S]*?return normalize\(abs\(fDet\) \* surf_norm - vGrad\); }/, `vec3 bumpNormal(vec3 surf_pos, vec3 surf_norm, float h, float faceDirection) {
          vec3 dx = dFdx(surf_pos), dy = dFdy(surf_pos);
          vec3 r1 = cross(dy, surf_norm), r2 = cross(surf_norm, dx);
          float determinant = dot(dx, r1) * faceDirection;
          vec3 gradient = sign(determinant) * (dFdx(h) * r1 + dFdy(h) * r2);
          return normalize(abs(determinant) * surf_norm - gradient);
        }`)
        .replace('vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;', 'vec3 totalDiffuse = diffuseColor.rgb * vCyclesLight;');
    };
    material.needsUpdate = true;
  }
  const hairVariants = new Map();
  for (const [index, hair] of [...appearance.hairGroups, ...appearance.sexComb].entries()) {
    const pale = /labrum|antenna|haltere/.test(hair.name), comb = /sexcomb/.test(hair.name);
    const variant = `${hair.material.uuid}:${comb ? 'comb' : pale ? 'pale' : 'amber'}`;
    if (!hairVariants.has(variant)) hairVariants.set(variant, hair.material.clone());
    hair.material = hairVariants.get(variant);
    hair.material.color.setRGB(...(comb ? [.021, .008, .002] : pale ? [.45, .29, .11] : [.135, .067, .021]), THREE.LinearSRGBColorSpace);
    hair.material.roughness = .36;
    hair.material.sheen = .15;
    const baked = meta.hairs?.[index];
    if (baked) {
      if (baked.count !== hair.count) throw new Error(`Hair bake count mismatch: ${hair.name}`);
      const data = new Uint8Array(baked.count * 8);
      MeshoptDecoder.decodeVertexBuffer(data, baked.count, 8, new Uint8Array(binary, baked.stream.offset, baked.stream.bytes));
      const packed = new Uint16Array(data.buffer), light = new Float32Array(baked.count * 3);
      for (let i = 0; i < baked.count; i++) for (let k = 0; k < 3; k++) light[i*3+k] = THREE.DataUtils.fromHalfFloat(packed[i*4+k]);
      hair.geometry = hair.geometry.clone();
      hair.geometry.setAttribute('aHairLight', new THREE.InstancedBufferAttribute(light, 3));
      if (!hair.material.userData.cyclesHair) {
        hair.material.userData.cyclesHair = true;
        hair.material.customProgramCacheKey = () => 'cycles-hair-v1';
        hair.material.onBeforeCompile = shader => {
          shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aHairLight; varying vec3 vHairLight;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHairLight = aHairLight;');
          shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vHairLight;')
            .replace('vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;', 'vec3 totalDiffuse = diffuseColor.rgb * vHairLight;');
        };
        hair.material.needsUpdate = true;
      }
    }
  }
  appearance.blender = meta;
}

export function blenderLights(scene, meta, offset) {
  RectAreaLightUniformsLib.init();
  const lights = meta.lights.map(source => {
    // Equal-area square for the Cycles disk diffuser. Both engines use radiance here.
    const width = source.size * Math.sqrt(Math.PI) / 2;
    const light = new THREE.RectAreaLight(new THREE.Color().setRGB(...source.color, THREE.LinearSRGBColorSpace), source.power / (Math.PI * width * width), width, width);
    const matrix = new THREE.Matrix4().fromArray(source.matrix);
    matrix.decompose(light.position, light.quaternion, light.scale);
    light.position.add(offset); light.name = source.name; scene.add(light); return light;
  });
  return lights;
}

// The same AgX / Medium High Contrast transform used by the .blend, sampled by Blender.
// Input is scene-linear HDR; the table stores display sRGB. No second tone/gamma transform.
export async function blenderOutput(base) {
  const lookup = await new THREE.TextureLoader().loadAsync(`${base}body/blender/agx-look.png`);
  lookup.colorSpace = THREE.NoColorSpace; lookup.minFilter = lookup.magFilter = THREE.LinearFilter; lookup.generateMipmaps = false;
  return new ShaderPass({
    uniforms: { tDiffuse: { value: null }, lookup: { value: lookup } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `uniform sampler2D tDiffuse, lookup; varying vec2 vUv;
      vec3 displayColor(vec3 linearColor) {
        vec3 p = clamp((log2(max(linearColor, vec3(exp2(-12.)))) + 12.) / 20., 0., 1.) * 47.;
        float b = floor(p.b);
        vec2 uv = vec2((b * 48. + p.r + .5) / (48. * 48.), (p.g + .5) / 48.);
        return mix(texture2D(lookup, uv).rgb, texture2D(lookup, uv + vec2(min(1., 47.-b)/48., 0.)).rgb, fract(p.b));
      }
      void main(){ gl_FragColor=vec4(displayColor(texture2D(tDiffuse,vUv).rgb),1.); }`,
  });
}
