/** Soft radial puff for meteor trails (avoid bitmap UI assets). */
export function createSmokePuffTexture(THREE, size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  g.addColorStop(0, 'rgba(228, 228, 234, 0.75)');
  g.addColorStop(0.2, 'rgba(210, 210, 218, 0.5)');
  g.addColorStop(0.5, 'rgba(195, 195, 205, 0.28)');
  g.addColorStop(0.78, 'rgba(180, 180, 190, 0.1)');
  g.addColorStop(1, 'rgba(160, 160, 170, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
