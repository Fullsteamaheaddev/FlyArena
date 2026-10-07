// Shared wind sway for Flies Armageddon map props (reeds, palms, lilypads).
import * as THREE from 'three';

export const swayUniforms = { uSwayT: { value: 0 }, uWind: { value: new THREE.Vector3(1, 0, 0.35) } };

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

function patchSwayMaterial(m, crown) {
  if (!m || m.userData.sway) return;
  m.userData.sway = true;
  m.onBeforeCompile = sh => swayPatch(sh, crown);
  m.customProgramCacheKey = () => `sway${crown ? 'C' : ''}:${m.type}`;
}

function swayDepthMaterial(crown) {
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

export function swayMaterials(mesh) {
  const crown = mesh.name === 'PalmFronds';
  patchSwayMaterial(mesh.material, crown);
  return swayDepthMaterial(crown);
}

/** Sway + depth material for a custom lit material (dish grass cel shading). */
export function swayForMaterial(mat, meshName = '') {
  const crown = meshName === 'PalmFronds';
  patchSwayMaterial(mat, crown);
  return swayDepthMaterial(crown);
}
export const SWAY_KINDS = new Set(['palm', 'reed', 'grass', 'lilypad']);

export function applySwayWind(wind, tSec) {
  const ts = tSec % 3600;
  swayUniforms.uSwayT.value = ts;
  swayUniforms.uWind.value.set(wind.dirX, wind.dirY, wind.strength);
  return ts;
}
