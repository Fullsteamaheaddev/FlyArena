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
    { r: 1.0, rgb: [168, 168, 178], a: 0.12 },
    { r: 0.78, rgb: [188, 188, 198], a: 0.28 },
    { r: 0.56, rgb: [208, 208, 218], a: 0.48 },
    { r: 0.34, rgb: [225, 225, 234], a: 0.68 },
    { r: 0.14, rgb: [242, 242, 248], a: 0.88 },
  ];
  for (const b of bands) {
    ctx.fillStyle = `rgba(${b.rgb[0]}, ${b.rgb[1]}, ${b.rgb[2]}, ${b.a})`;
    ctx.beginPath();
    ctx.arc(cx, cx, R * b.r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
