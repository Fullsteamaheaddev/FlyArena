// Volumetric-style abduction cone (Z-up arena).

const BEAM_VERT = `
  varying vec3 vPos;
  void main() {
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BEAM_FRAG = `
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uColorInner;
  uniform vec3 uColorOuter;
  varying vec2 vUv;
  varying vec3 vPos;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    float along = clamp(vPos.z, 0.0, 1.0);
    float maxR = mix(1.35, 0.22, along);
    float radial = length(vPos.xy) / max(maxR, 0.001);
    float core = pow(max(0.0, 1.0 - radial), 2.2);
    float fall = mix(0.35, 1.0, along);
    float n = hash(vec2(along * 24.0 + uTime * 0.002, radial * 8.0));
    float shimmer = 0.85 + 0.15 * sin(along * 40.0 - uTime * 0.004);
    float a = uOpacity * core * fall * shimmer * (0.55 + 0.45 * n);
    vec3 col = mix(uColorOuter, uColorInner, core);
    gl_FragColor = vec4(col, a);
  }
`;

export function createUfoBeam(T, height = 5) {
  // Cylinder is Y-up (narrow +Y, wide −Y). Arena is Z-up, so bake Rx so local +Z is up:
  // z=0 is the wide floor ring, z=1 is the narrow saucer ring. Then scale.z is beam length.
  const geo = new T.CylinderGeometry(0.22, 1.35, 1, 32, 12, true);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0, 0.5);
  const mat = new T.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0.55 },
      uColorInner: { value: new T.Color('#d8fff8') },
      uColorOuter: { value: new T.Color('#48c8a0') },
    },
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    transparent: true,
    depthWrite: false,
    side: T.DoubleSide,
    blending: T.AdditiveBlending,
    toneMapped: false,
  });
  const mesh = new T.Mesh(geo, mat);
  mesh.scale.set(1, 1, height);
  mesh.userData.ufoBeam = true;
  return mesh;
}

export function tickUfoBeam(mesh, t) {
  if (mesh?.material?.uniforms?.uTime) mesh.material.uniforms.uTime.value = t;
}

export function setUfoBeamOpacity(mesh, op) {
  if (mesh?.material?.uniforms?.uOpacity) mesh.material.uniforms.uOpacity.value = op;
}
