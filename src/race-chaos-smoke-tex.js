/** Cel-stepped radial puff for meteor trails (hard bands, no soft gradient). */
export function createSmokePuffTexture(THREE, size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const R = cx;
  /** Draw large → small so inner disks sit on top (toon-style rings). */
  const bands = [
    { r: 1.0, rgb: [150, 150, 162], a: 0.55 },
    { r: 0.74, rgb: [178, 178, 190], a: 0.78 },
    { r: 0.5, rgb: [210, 210, 220], a: 0.92 },
    { r: 0.28, rgb: [232, 232, 240], a: 1 },
    { r: 0.12, rgb: [248, 248, 252], a: 1 },
  ];
  for (const b of bands) {
    ctx.fillStyle = `rgba(${b.rgb[0]}, ${b.rgb[1]}, ${b.rgb[2]}, ${b.a})`;
    ctx.beginPath();
    ctx.arc(cx, cx, R * b.r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
