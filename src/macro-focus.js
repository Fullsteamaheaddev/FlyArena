import * as THREE from 'three';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Sample the defocused image at half resolution, then composite over the original full-resolution
// colour. In-focus eye facets and hairs never go through the downsampled image.
export class MacroFocusPass extends BokehPass {
  constructor(scene, camera, params) {
    super(scene, camera, params);
    this.blurTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    const prefix = this.materialBokeh.fragmentShader.split('void main()')[0];
    // Deterministic disk samples: no time-dependent noise or shimmering when orbiting/recording.
    const taps = Array.from({ length: 12 }, (_, i) => {
      const angle = i * 2.39996323, r = Math.sqrt((i + 0.5) / 12) * 0.4;
      return `col += texture2D(tColor, vUv + vec2(${(Math.cos(angle) * r).toFixed(7)}, ${(Math.sin(angle) * r).toFixed(7)}) * blur);`;
    }).join('\n');
    this.materialBokeh.fragmentShader = `${prefix}
      void main() {
        float factor = focus + getViewZ(getDepth(vUv));
        vec2 blur = vec2(1., aspect) * clamp(factor * aperture, -maxblur, maxblur);
        vec4 col = texture2D(tColor, vUv);
        ${taps}
        gl_FragColor = vec4(col.rgb / 13., 1.);
      }`;
    this.composite = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tBlur: { value: this.blurTarget.texture },
        tDepth: this.uniforms.tDepth, focus: this.uniforms.focus, aperture: this.uniforms.aperture,
        maxblur: this.uniforms.maxblur, nearClip: this.uniforms.nearClip, farClip: this.uniforms.farClip,
        width: { value: 1 },
      },
      vertexShader: this.materialBokeh.vertexShader,
      fragmentShader: `
        #include <packing>
        varying vec2 vUv;
        uniform sampler2D tColor, tBlur, tDepth;
        uniform float focus, aperture, maxblur, nearClip, farClip, width;
        void main() {
          float z = perspectiveDepthToViewZ(unpackRGBAToDepth(texture2D(tDepth, vUv)), nearClip, farClip);
          float radius = min(abs(focus + z) * aperture, maxblur) * .4 * width;
          vec3 sharp = texture2D(tColor, vUv).rgb;
          vec3 blurred = texture2D(tBlur, vUv).rgb;
          gl_FragColor = vec4(mix(sharp, blurred, smoothstep(.5, 1.5, radius)), 1.);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.compositeQuad = new FullScreenQuad(this.composite);
  }

  setSize(width, height) {
    const w = Math.ceil(width / 2), h = Math.ceil(height / 2);
    super.setSize(w, h); this.blurTarget.setSize(w, h);
    this.uniforms.aspect.value = width / height;
    this.composite.uniforms.width.value = width;
  }

  render(renderer, writeBuffer, readBuffer) {
    const toScreen = this.renderToScreen;
    this.renderToScreen = false;
    try { super.render(renderer, this.blurTarget, readBuffer); } finally { this.renderToScreen = toScreen; }
    this.composite.uniforms.tColor.value = readBuffer.texture;
    renderer.setRenderTarget(toScreen ? null : writeBuffer);
    this.compositeQuad.render(renderer);
  }

  dispose() {
    super.dispose(); this.blurTarget.dispose(); this.composite.dispose(); this.compositeQuad.dispose();
  }
}
