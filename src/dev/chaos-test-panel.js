/** Dev chaos UI (?chaosTest). Local overlay: `local/chaos-harness.js` can replace via Vite alias if present. */

function kinds() {
  return window.CHAOS_KINDS || window.__arena?.chaosKinds || [];
}

function fire(kind, extra) {
  window.__arena?.raceAudio?.unlock?.();
  const r = (window.fireChaos || window.__arena?.fireChaos)?.(kind, extra);
  console.info('[chaos test]', r || kind);
}

export function mountChaosTestPanel() {
  if (document.getElementById('chaosTest')) return;
  const css = document.createElement('style');
  css.textContent = `
    #chaosTest { position:fixed; right:12px; bottom:72px; z-index:50; width:min(260px,calc(100vw - 24px));
      font:13px/1.3 ui-sans-serif,system-ui,sans-serif; color:#f4e8ff; background:rgba(18,10,28,.88);
      border:1px solid rgba(232,180,255,.35); border-radius:12px; padding:10px 10px 8px; backdrop-filter:blur(8px); }
    #chaosTest h3 { margin:0 0 6px; font:700 15px/1.1 "Luckiest Guy",ui-sans-serif,system-ui,sans-serif;
      letter-spacing:.04em; color:#fff; text-shadow:0 2px 0 #3a1848; }
    #chaosTest .hint { margin:0 0 8px; opacity:.75; font-size:11px; }
    #chaosTest .grid { display:grid; grid-template-columns:1fr 1fr; gap:6px; max-height:42vh; overflow:auto; }
    #chaosTest button { appearance:none; border:0; border-radius:8px; padding:7px 8px; cursor:pointer;
      font:600 12px/1.1 ui-sans-serif,system-ui,sans-serif; color:#2a1038; background:#e8b4ff; }
    #chaosTest button:hover { filter:brightness(1.08); }
    #chaosTest button.wide { grid-column:1 / -1; background:#fff1a8; }
    #chaosTest label { display:flex; align-items:center; gap:6px; margin-top:8px; font-size:11px; opacity:.85; }
  `;
  document.head.appendChild(css);
  const box = document.createElement('aside');
  box.id = 'chaosTest';
  box.innerHTML = `<h3>Chaos test</h3>
    <p class="hint">Console: <code>fireChaos('lightning')</code> · <code>killFly()</code></p>
    <div class="grid" id="chaosKindGrid"></div>
    <label><input type="checkbox" id="chaosRoulette"> auto roulette</label>
    <p class="hint" style="margin-top:8px">Freeze model</p>
    <div class="grid" id="chaosPreview"></div>`;
  const grid = box.querySelector('#chaosKindGrid');
  const rand = document.createElement('button');
  rand.className = 'wide';
  rand.textContent = 'random';
  rand.onclick = () => {
    const k = kinds();
    if (!k.length) return console.warn('[chaos test] no kinds yet');
    fire(k[Math.floor(Math.random() * k.length)]);
  };
  grid.appendChild(rand);
  const kill = document.createElement('button');
  kill.className = 'wide';
  kill.textContent = 'kill selected fly';
  kill.style.background = '#ff9a8a';
  kill.onclick = () => {
    window.__arena?.raceAudio?.unlock?.();
    const r = (window.killFly || window.__arena?.killFly)?.();
    console.info('[chaos test] killFly', r);
  };
  grid.appendChild(kill);
  const laserOne = document.createElement('button');
  laserOne.className = 'wide';
  laserOne.textContent = 'laser one';
  laserOne.onclick = () => fire('laser', { solo: true });
  grid.appendChild(laserOne);
  for (const kind of kinds()) {
    const b = document.createElement('button');
    b.textContent = kind;
    b.onclick = () => fire(kind);
    grid.appendChild(b);
  }
  box.querySelector('#chaosRoulette').onchange = e => {
    const api = window.__arena?.raceChaos;
    if (!api) return;
    if (e.target.checked) api.arm();
    else api.holdRoulette();
  };
  const prev = box.querySelector('#chaosPreview');
  for (const kind of ['thumb', 'finger', 'hand']) {
    const b = document.createElement('button');
    b.textContent = 'hold ' + (kind === 'finger' ? 'boop' : kind);
    b.onclick = () => {
      const r = (window.previewChaosProp || window.__arena?.previewChaosProp)?.(kind);
      console.info('[chaos preview]', r || kind);
    };
    prev.appendChild(b);
  }
  document.body.appendChild(box);
  console.info('[chaos test] panel ready — kinds:', kinds().join(', '));
}
