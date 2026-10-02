// Race chrome (wood PNGs, logos, font, flags, SFX) so the loader covers UI as well as the fly.

const IMAGES = [
  { path: 'container.png', high: true },
  { path: 'container-headless.png', high: true },
  { path: 'button.png', high: true },
  { path: 'FruitFlyText.png' },
  { path: 'FLYticker.webp' },
  { path: 'deadfly.webp' },
  { path: 'favicon-512.webp' },
];

const FLAGS = ['en.svg', 'es.svg', 'ko.svg', 'pt-BR.svg', 'ru.svg', 'zh-CN.svg'];

const AUDIO = [
  'yipee.wav', 'gong.wav', 'boop.wav', 'Thundersound.wav', 'thumb.wav',
  'splatter1.wav', 'splatter2.wav', 'LaserToast.wav', 'LaserBeam.wav',
  'LaserKill.wav', 'xfiles.wav',
];

function joinBase(base, path) {
  const b = base.endsWith('/') ? base : `${base}/`;
  return `${b}${path.replace(/^\//, '')}`;
}

function loadImage(url, high = false) {
  return new Promise(res => {
    const img = new Image();
    if (high) img.fetchPriority = 'high';
    img.onload = () => {
      const d = img.decode?.();
      if (d && typeof d.then === 'function') d.then(() => res(img), () => res(img));
      else res(img);
    };
    img.onerror = () => res(null);
    img.src = url;
  });
}

function fetchCached(url) {
  return fetch(url).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
}

let once = null;

/** Decode UI bitmaps and warm the audio/font cache. Safe to call twice. */
export function preloadSiteAssets(base = '/') {
  if (once) return once;
  once = (async () => {
    const jobs = [
      ...IMAGES.map(({ path, high }) => loadImage(joinBase(base, path), !!high)),
      ...FLAGS.map(f => loadImage(joinBase(base, `flags/${f}`))),
      ...AUDIO.map(f => fetchCached(joinBase(base, f))),
    ];
    if (document.fonts?.load) jobs.push(document.fonts.load('16px "Luckiest Guy"').catch(() => null));
    await Promise.all(jobs);
  })();
  return once;
}
