import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { loadCuticleDetail } from './fly-appearance.js';
import { loadBlenderFly, createBlenderFly, loadArenaDetail, blenderOutput } from './fly-blender.js';
import { ArenaBatches } from './arena-batches.js';
import { RenderResolution } from './render-resolution.js';
import { loadConnectome, loadNeurons } from './data.js';
import { PRESETS } from './sim/world.js';
import { allocBrainMemory, MAX_FLIES } from './brainsetup.js';
import { parseFlyVis } from './flyvis.js';
import { buildGroups } from './sim/groups.js';
import { createRaceAudio } from './race-audio.js';
import { matchRole, isWatchPath, isRaceHostPath, matchUrl, createMatchLink, buildMatchState, packAct, unpackAct, packEyes, unpackEyes } from './match.js';
import {
  DEFAULT_WINDOW, chainConfigured, connectWallet, disconnectWallet, ensureWallet, restoreWallet, switchAccount, onWalletChange, getAccount, readWindow, readPools,
  openRace, lockRace, settleRace, voidRace, placeBet, claimRace, refundRace,
  readBalance, loadHistory, userTotal, userStake, isClaimed, readRace, chipFmt, setDebugSink,
  resolveChip, chipSymbol, getChipMeta,
} from './chain.js';
const BASE = import.meta.env.BASE_URL; // "/" in dev, "/fly-brain/" on GitHub Pages

const $ = s => document.querySelector(s);
const status = s => { $('#status').textContent = s; };
const FLY_COLORS = ['#ffb347', '#5ac8fa', '#a3e635', '#f472b6', '#c084fc', '#facc15', '#fb7185', '#2dd4bf'];
const RACE_NAMES = ['Amber', 'Blue', 'Lime'];
const presetKey = isWatchPath() || isRaceHostPath() || new URLSearchParams(location.search).get('watch') === '1'
  ? 'race'
  : (new URLSearchParams(location.search).get('env') || 'foraging');
const PRESET = PRESETS[presetKey] || PRESETS.foraging;
const isRace = presetKey === 'race' && PRESET === PRESETS.race;
const raceRole = isRace ? (matchRole() || 'host') : null;
const isWatch = raceRole === 'watch';
const isHost = raceRole === 'host';
// #region agent log
fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'487c3c'},body:JSON.stringify({sessionId:'487c3c',runId:'pre-fix',hypothesisId:'A',location:'arena.js:boot',message:'race role',data:{path:location.pathname,search:location.search,isWatch,isHost,isRace,presetKey,role:raceRole},timestamp:Date.now()})}).catch(()=>{});
// #endregion
const env = PRESET.env();
const flies = [];          // {id, worker, group, bodies[], last, color, ready}
let flyvisMap, shared, meta, bodymap, flyXML, gait, visual, batches, outputPass, running = false, selected = 0, tool = 'none', speed = 2, brainMem, wasmModule, brainParams, neuromodCalib;
let raceWinner = null, raceWinnerWhy = null, raceResetTimer = null, raceResetting = false, raceStartWall = null, labelRenderer = null, raceAudio = null, raceSpotRot = 0;
let matchLink = null, matchId = 0, matchPhase = 'lobby', matchResetIn = null, lastMatchSend = 0, lastActSend = 0, watchBodyNames = null, watchWingPoses = null, lastSentWingPoses = null;
const WATCH_POSE_DELAY = 100, WATCH_POSE_EXTRAP = 40, WATCH_POSE_RING = 4;
let betClosesAt = null, poolSnap = [], lobbyTimer = null, lastPoolRead = 0, chainSettled = false, betFlyId = null, lastLobbyKind = '', lastPoolKey = '', lastLobbyTickSec = null;
let poolStatus = null, betWindowSec = DEFAULT_WINDOW, betWindowArmed = false, lobbyStartedAt = 0, resultsAt = 0, settledAt = 0;
let resultActions = { key: '', claim: false, refund: false, note: '' }, profileSeq = 0, profileAcct = null;
const OPEN_GRACE_MS = 25000;     // if the pool never opens (operator offline) the lobby still runs
const SETTLE_GRACE_MS = 45000;   // nor does a stuck settle strand the results card forever
const CLAIM_WINDOW_MS = 6000;    // time to see the payout / Claim once the match is settled
let raceFollow = null, raceCamHome = null, raceCamTween = null, raceAnnounce = null, raceBrainTimer = null, raceBrainTouched = false;
const RACE_PLUME_TOP = 0.20, RACE_CHASE_BACK = 2.6, RACE_CHASE_Z = 1.15;
const RACE_LABEL_Z = 1.05, RACE_LABEL_Z_CHASE = 0.28;
const RACE_HISTORY_KEY = 'odorRaceResults';
const RACE_FLIES_KEY = 'odorRaceFlies';
const ENTER_GATE_KEY = 'fruitFlyEntered';
let lastRaceFliesKey = '';

function toShared(ta) { const sab = new SharedArrayBuffer(ta.byteLength); const out = new ta.constructor(sab); out.set(ta); return out; }

async function main() {
  if (isWatch) return mainWatch();
  if (!crossOriginIsolated) console.warn('not cross-origin isolated: SharedArrayBuffer unavailable');
  const data = await loadConnectome(status);
  meta = data.meta;
  status('loading body model');
  const [bm, xml, g, blender, levels, output, sz, sg, bp, wasmBytes, fvb, fvj, fvi, fvm, nmc, detail] = await Promise.all([
    fetch(`${BASE}data/bodymap.json`).then(r => r.json()), fetch(`${BASE}body/fly_physics.xml`).then(r => r.text()), fetch(`${BASE}body/gait.json`).then(r => r.json()),
    loadBlenderFly(BASE, status), loadArenaDetail(BASE), blenderOutput(BASE),
    fetch(`${BASE}data/neuron_size.bin`).then(r => r.arrayBuffer()), fetch(`${BASE}data/ntsign.bin`).then(r => r.arrayBuffer()),
    fetch(`${BASE}data/brain_params.json`).then(r => r.ok ? r.json() : {}).catch(() => ({})), fetch(`${BASE}lif.wasm`).then(r => r.arrayBuffer()),
    fetch(`${BASE}vision/flyvis.bin`).then(r => r.arrayBuffer()), fetch(`${BASE}vision/flyvis.json`).then(r => r.json()), fetch(`${BASE}vision/flyvis_inputs.json`).then(r => r.json()), fetch(`${BASE}vision/flyvis_map.json`).then(r => r.json()),
    fetch(`${BASE}data/neuromod.json`).then(r => r.ok ? r.json() : null).catch(() => null), loadCuticleDetail(`${BASE}body/cuticle_detail.png`)]);
  const vision = { model: parseFlyVis(fvb, fvj, fvi), map: fvm };
  bodymap = bm; flyXML = xml; gait = g; visual = createBlenderFly(blender, detail, levels); outputPass = output;
  shared = { N: data.N, E: data.E, indptr: toShared(data.indptr), indices: toShared(data.indices), weights: toShared(data.weights), nt: toShared(data.nt),
    side: toShared(data.side), superclass: toShared(data.superclass), cls: toShared(data.cls), size: toShared(new Float32Array(sz)), sign: toShared(new Float32Array(sg)) };
  brainParams = { ...bp, neuromod: !!(bp.neuromod && nmc) };
  if (new URLSearchParams(location.search).get('gpu') === '0') brainParams.gpu = false;   // ?gpu=0 forces the WASM kernel
  neuromodCalib = nmc; wasmModule = await WebAssembly.compile(wasmBytes);
  status('writing connectome into shared memory');
  status('writing connectome and optic-lobe model into shared memory');
  brainMem = allocBrainMemory({ ...data, superclass: data.superclass }, shared.size, shared.sign, brainParams, MAX_FLIES, vision);
  flyvisMap = fvm;
  window.__data = data;
  buildBrainPanel(data);
  buildScene(data);
  buildUI();
  $('#loading').remove();
  if (isRace) setupRaceChrome();
  await spawnPresetFlies();
  if (isRace) { await waitRacePoses(); await showRaceStart(); }
  if (PRESET.autoThreat) setInterval(() => { if (!running || !flies.length) return; const live = flies.filter(f => f.last?.alive !== false); if (!live.length) return; selected = live[Math.floor(Math.random() * live.length)].id; launchThreat(); }, PRESET.autoThreat * 1000);
  window.__arena = { camera, controls, flies, env, THREE, renderer, scene, gtao, composer, metrics, resolution, batches, visual, addFly, rebuildEnv, checkRaceFinish, resetRace, startRaceFollow, stopRaceFollow, announceRace, get raceFollow() { return raceFollow; }, get raceAudio() { return raceAudio; } };
  animate();
}

async function mainWatch() {
  status('loading arena');
  const [blender, levels, output, detail, fvm, data, bm, wingPoses] = await Promise.all([
    loadBlenderFly(BASE, status), loadArenaDetail(BASE), blenderOutput(BASE), loadCuticleDetail(`${BASE}body/cuticle_detail.png`),
    fetch(`${BASE}vision/flyvis_map.json`).then(r => r.json()),
    loadNeurons(status),
    fetch(`${BASE}data/bodymap.json`).then(r => r.json()),
    fetch(`${BASE}body/wing_poses.json`).then(r => r.ok ? r.json() : null).catch(() => null)]);
  visual = createBlenderFly(blender, detail, levels); outputPass = output;
  if (wingPoses) watchWingPoses = wingPoses;
  flyvisMap = fvm; meta = data.meta; bodymap = bm;
  buildScene(data);
  buildBrainPanel(data);
  setupRaceChrome();
  setupFolds();
  setRaceBrainFolded(raceMobile(), { instant: true });
  setupWatchBrainPanel();
  $('#loading').remove();
  const profile = $('#profile');
  if (profile) {
    profile.hidden = false;
    if (raceMobile()) setProfileFolded(true, { instant: true });
    syncProfileScrim();
    refreshProfile();
    syncBpHint();
  }
  window.__arena = { camera, controls, flies, env, THREE, renderer, scene, gtao, composer, metrics, resolution, batches, visual, rebuildEnv, startRaceFollow, stopRaceFollow, announceRace, get raceFollow() { return raceFollow; }, get raceAudio() { return raceAudio; } };
  animate();
}

// ---------------- scene ----------------
async function spawnPresetFlies() {
  const st0 = PRESET.start || [0, 0, 0];
  if (PRESET.flySpots) {
    const spots = PRESET.flySpots.slice();
    if (isRace) {
      const n = spots.length, rot = raceSpotRot % n;
      raceSpotRot++;
      const ids = [...Array(n).keys()];
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
      for (let i = 0; i < n; i++) {
        const s = spots[(i + rot) % n], k = ids[i];
        await addFly(s.pos, s.yaw, s.sex, { name: RACE_NAMES[k], color: FLY_COLORS[k] });
      }
    } else for (const s of spots) await addFly(s.pos, s.yaw, s.sex);
  } else { await addFly([st0[0], st0[1]], st0[2]);
    for (let k = 1; k < (PRESET.flies || 1); k++) { const ang = k * 2.4; await addFly([1.2 * Math.cos(ang), 1.2 * Math.sin(ang)], ang + Math.PI); } }
}
function waitRacePoses() {
  return Promise.all(flies.map(f => f.last ? Promise.resolve() : new Promise(res => { f.onPose = res; })));
}

let renderer, scene, camera, controls, envGroup, raycaster, floorMesh, wallMesh, sun, composer, gtao, resolution;
let shadowDirty = true, lastShadow = -Infinity, shadowExtent = 0, lastBrainDraw = 0, brainDirty = true;
let brainColorFly = -1, brainColorHover = -2;
const shadowCenter = new THREE.Vector3(Infinity, Infinity, Infinity), viewPoint = new THREE.Vector3();
const viewFrustum = new THREE.Frustum(), viewProjection = new THREE.Matrix4(), flyBounds = new THREE.Sphere(new THREE.Vector3(), 0.24);
const metrics = { calls: 0, triangles: 0, renderMs: 0, shadowUpdates: 0, brainUploads: 0, brainDraws: 0 };
let brainRenderer, brainScene, brainCam, brainPts, brainAct;
let raceFloorLogo = null, raceFloorLogoWait = null, raceFloorPaint = 0;
let raceWallLogo = null, raceWallLogoWait = null, raceWallPaint = 0;
function raceFloorLogoImg() {
  if (raceFloorLogo) return Promise.resolve(raceFloorLogo);
  if (!raceFloorLogoWait) {
    raceFloorLogoWait = new Promise(res => {
      const img = new Image();
      img.onload = () => { raceFloorLogo = img; res(img); };
      img.onerror = () => res(null);
      img.src = `${BASE}FruitFlyText.png`;
    });
  }
  return raceFloorLogoWait;
}
function raceWallLogoImg() {
  if (raceWallLogo) return Promise.resolve(raceWallLogo);
  if (!raceWallLogoWait) {
    raceWallLogoWait = new Promise(res => {
      const img = new Image();
      img.onload = () => { raceWallLogo = img; res(img); };
      img.onerror = () => res(null);
      img.src = `${BASE}FLYticker.webp`;
    });
  }
  return raceWallLogoWait;
}
function paintRaceFloor(fx, fs, logo) {
  const mid = fs / 2;
  const rg = fx.createRadialGradient(mid, mid, 0, mid, mid, mid);
  rg.addColorStop(0, '#8a2fb8'); rg.addColorStop(0.35, '#6b2494'); rg.addColorStop(0.7, '#4a1870'); rg.addColorStop(1, '#2c0d48');
  fx.fillStyle = rg; fx.fillRect(0, 0, fs, fs);
  fx.strokeStyle = 'rgba(210,150,255,0.28)'; fx.lineWidth = fs / 51;
  for (const r of [0.22, 0.42, 0.62, 0.82]) { fx.beginPath(); fx.arc(mid, mid, r * mid, 0, Math.PI * 2); fx.stroke(); }
  if (!logo) return;
  const dw = fs * 0.53, dh = dw * (logo.height / logo.width);
  fx.save();
  fx.translate(mid, mid);
  fx.rotate(-Math.PI / 2);
  fx.drawImage(logo, -dw / 2, -dh / 2, dw, dh);
  fx.restore();
}
function paintRaceWall(wx, ww, wh, logo) {
  wx.imageSmoothingEnabled = true;
  wx.imageSmoothingQuality = 'high';
  const vg = wx.createLinearGradient(0, 0, 0, wh);
  vg.addColorStop(0, '#e0b8f0'); vg.addColorStop(1, '#7a3aa8');
  wx.fillStyle = vg; wx.fillRect(0, 0, ww, wh);
  const pastels = ['#f0c8ff', '#d080e8', '#a050c8']; wx.globalAlpha = 0.32;
  for (let k = 0; k < 12; k++) { wx.fillStyle = pastels[k % pastels.length]; wx.fillRect(k * ww / 12, 0, ww / 12 + 1, wh); }
  wx.globalAlpha = 1;
  if (!logo) return;
  const n = 10, slot = ww / n;
  const s = Math.min(1, slot / logo.width, wh / logo.height);
  wx.imageSmoothingEnabled = s < 1;
  const bandW = logo.width * s, bandH = logo.height * s;
  for (let i = 0; i < n; i++) {
    const cx = i * slot + slot / 2, cy = wh / 2;
    wx.save();
    wx.translate(cx, cy);
    wx.scale(-1, 1);
    wx.drawImage(logo, -bandW / 2, -bandH / 2, bandW, bandH);
    wx.restore();
  }
}
function buildScene(data) {
  renderer = new THREE.WebGLRenderer({ canvas: $('#c'), antialias: false, powerPreference: 'high-performance' });
  resolution = new RenderResolution(() => resize(), { targetFps: 120 });
  renderer.setPixelRatio(resolution.ratio); renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
  renderer.info.autoReset = false;
  scene = new THREE.Scene(); scene.background = new THREE.Color(isRace ? '#22262D' : '#0b0e14');
  scene.matrixAutoUpdate = false;
  const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture; scene.environmentIntensity = 0.24;
  room.dispose(); pmrem.dispose();
  camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.005, Math.max(100, env.arena.radius * 8)); camera.up.set(0, 0, 1);
  const R = env.arena.radius;
  // Race: sit on +X so a maze lane points at the camera (0°/120°/240° stays left-right symmetric).
  if (isRace) camera.position.set(R * 1.3, 0, R * 1.45);
  else camera.position.set(-1.2, -1.6, 1.3);
  controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.target.set(0, 0, 0.1);
  controls.minDistance = 0.16; controls.maxDistance = env.arena.radius * 5;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  if (isRace) raceCamHome = { pos: camera.position.clone(), target: controls.target.clone() };
  scene.add(new THREE.HemisphereLight(isRace ? '#f0d4ff' : '#f4f2ed', isRace ? '#4a2060' : '#514432', 0.22));
  sun = new THREE.DirectionalLight(isRace ? '#f0c8ff' : '#fff1da', 2.7); sun.position.set(3, 2, 8); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.00002; sun.shadow.normalBias = 0.0003; sun.shadow.radius = 2;
  const shadowSpan = Math.max(4, R + 0.5);
  Object.assign(sun.shadow.camera, { left: -shadowSpan, right: shadowSpan, top: shadowSpan, bottom: -shadowSpan, near: 0.1, far: Math.max(20, R * 3) }); scene.add(sun, sun.target);
  const rim = new THREE.DirectionalLight(isRace ? '#e0a8f0' : '#f9e5c4', 0.65); rim.position.set(-3, -2, 3); scene.add(rim);
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, rt); composer.addPass(new RenderPass(scene, camera));
  gtao = new GTAOPass(scene, camera, 1, 1);
  gtao.updateGtaoMaterial({ radius: 0.012, distanceExponent: 1.5, thickness: 0.6, scale: 1, samples: 8 });
  // Cycles already baked body/hair occlusion. Keep the ground contact shadow; skip redundant AO.
  gtao.enabled = false; composer.addPass(gtao); composer.addPass(outputPass);
  // Only solid cuticle/environment surfaces belong in AO. Films, plume overlays and subpixel hairs do not.
  const override = gtao._renderOverride, hidden = [];
  gtao._renderOverride = function (...args) {
    scene.traverseVisible(o => { if (o.isMesh && (o.isInstancedMesh || o.material.transparent)) { hidden.push(o); o.visible = false; } });
    try { return override.apply(this, args); } finally { for (const o of hidden) o.visible = true; hidden.length = 0; }
  };
  function resize() {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setPixelRatio(resolution.ratio); renderer.setSize(innerWidth, innerHeight);
    composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight);
    gtao.setSize(Math.ceil(innerWidth * renderer.getPixelRatio() / 2), Math.ceil(innerHeight * renderer.getPixelRatio() / 2));
    labelRenderer?.setSize(innerWidth, innerHeight);
    shadowDirty = true;
    syncBrainInset();
  }
  addEventListener('resize', () => { resolution.reset(); resize(); }); resize();
  if (isRace) {
    labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(innerWidth, innerHeight);
    Object.assign(labelRenderer.domElement.style, { position: 'fixed', inset: '0', pointerEvents: 'auto', zIndex: '1' });
    document.body.appendChild(labelRenderer.domElement);
    controls.connect(labelRenderer.domElement);
  }
  envGroup = new THREE.Group(); scene.add(envGroup); rebuildEnv();
  batches = new ArenaBatches(scene, visual, MAX_FLIES);
  raycaster = new THREE.Raycaster();
  const clickEl = isRace ? labelRenderer.domElement : renderer.domElement;
  clickEl.addEventListener('pointerdown', e => { pd = [e.clientX, e.clientY]; });
  clickEl.addEventListener('pointerup', e => { if (pd && Math.hypot(e.clientX - pd[0], e.clientY - pd[1]) < 4) onClick(e); });
  if (!data) return;
  // brain inset: soma point cloud colored by activity of the selected fly
  const bw = $('#brain').clientWidth || 358, bh = $('#brain').clientHeight || 220;
  brainRenderer = new THREE.WebGLRenderer({ canvas: $('#brain'), antialias: false, alpha: true }); brainRenderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  brainRenderer.setSize(bw, bh, false);
  brainScene = new THREE.Scene(); brainCam = new THREE.PerspectiveCamera(40, bw / bh, 1, 20000);
  const pos = new Float32Array(data.N * 3), col = new Float32Array(data.N * 3); const c = new THREE.Vector3(); let n = 0;
  for (let i = 0; i < data.N; i++) { const x = data.soma[i * 3]; if (!Number.isFinite(x)) { pos[i * 3] = 1e6; continue; } pos[i * 3] = x * 8e-3; pos[i * 3 + 1] = data.soma[i * 3 + 1] * 8e-3; pos[i * 3 + 2] = data.soma[i * 3 + 2] * 8e-3; c.x += pos[i * 3]; c.y += pos[i * 3 + 1]; c.z += pos[i * 3 + 2]; n++; }
  c.divideScalar(n); for (let i = 0; i < data.N; i++) { pos[i * 3] -= c.x; pos[i * 3 + 1] -= c.y; pos[i * 3 + 2] -= c.z; col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0.12; }
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); bg.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  brainPts = new THREE.Points(bg, new THREE.PointsMaterial({ size: 1.3, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }));
  brainPts.rotation.x = Math.PI; brainScene.add(brainPts);
  hlPts = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, transparent: true, opacity: 1, depthWrite: false, depthTest: false }));
  hlPts.visible = false; brainScene.add(hlPts);
  brainCam.position.set(0, 0, 1050); brainCam.lookAt(0, 0, 0); brainAct = new Float32Array(data.N);
}
let pd = null;
function discMesh(r, color, opacity = 1, z = 0.0015) { const m = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshStandardMaterial({ color, transparent: opacity < 1, opacity, roughness: 0.8 })); m.position.z = z; m.receiveShadow = true; return m; }
function rebuildEnv() {
  // Placement rebuilds own their resources; release old GPU buffers/textures before replacing them.
  envGroup.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.map?.dispose(); o.material.dispose(); } });
  envGroup.clear(); shadowDirty = true;
  const R = env.arena.radius, aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  let floorMat, wallMat;
  if (isRace) {
    const fs = 1024, fc = document.createElement('canvas'); fc.width = fc.height = fs; const fx = fc.getContext('2d');
    const paintId = ++raceFloorPaint;
    paintRaceFloor(fx, fs, raceFloorLogo);
    const ft = new THREE.CanvasTexture(fc); ft.colorSpace = THREE.SRGBColorSpace; ft.generateMipmaps = false; ft.minFilter = THREE.LinearFilter; ft.magFilter = THREE.LinearFilter; ft.anisotropy = aniso;
    floorMat = new THREE.MeshStandardMaterial({ map: ft, roughness: 0.82 });
    if (!raceFloorLogo) raceFloorLogoImg().then(img => {
      if (!img || paintId !== raceFloorPaint || floorMesh?.material?.map !== ft) return;
      paintRaceFloor(fx, fs, img);
      ft.needsUpdate = true;
    });
    const maxTex = renderer.capabilities.maxTextureSize;
    const ww = Math.min(maxTex, 16384), wh = Math.min(maxTex, 1024);
    const wc = document.createElement('canvas'); wc.width = ww; wc.height = wh; const wx = wc.getContext('2d');
    const wallPaintId = ++raceWallPaint;
    paintRaceWall(wx, ww, wh, raceWallLogo);
    const wt = new THREE.CanvasTexture(wc); wt.colorSpace = THREE.SRGBColorSpace;
    wt.generateMipmaps = false; wt.minFilter = THREE.LinearFilter; wt.magFilter = THREE.LinearFilter; wt.anisotropy = aniso;
    wallMat = new THREE.MeshStandardMaterial({ map: wt, side: THREE.BackSide, roughness: 0.62 });
    if (!raceWallLogo) raceWallLogoImg().then(img => {
      if (!img || wallPaintId !== raceWallPaint || wallMesh?.material?.map !== wt) return;
      paintRaceWall(wx, ww, wh, img);
      wt.needsUpdate = true;
    });
  } else {
    // floor: same 0.4 cm checker the flies' eyes see
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const cx = cv.getContext('2d');
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { cx.fillStyle = ((i + j) & 1) ? '#9c907a' : '#6f6554'; cx.fillRect(i * 32, j * 32, 32, 32); }
    const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set((R + 0.2) * 2 / 0.8, (R + 0.2) * 2 / 0.8); tex.magFilter = THREE.LinearFilter; tex.anisotropy = aniso; tex.colorSpace = THREE.SRGBColorSpace;
    floorMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
    const wc = document.createElement('canvas'); wc.width = 1024; wc.height = 8; const wx = wc.getContext('2d');
    for (let k = 0; k < 24; k++) { wx.fillStyle = (k & 1) ? '#c9c9cf' : '#2a2a2e'; wx.fillRect(k * 1024 / 24, 0, 1024 / 24 + 1, 8); }
    const wt = new THREE.CanvasTexture(wc); wt.colorSpace = THREE.SRGBColorSpace;
    wallMat = new THREE.MeshStandardMaterial({ map: wt, side: THREE.BackSide, roughness: 0.9 });
  }
  floorMesh = new THREE.Mesh(new THREE.CircleGeometry(R + 0.1, 96), floorMat);
  floorMesh.receiveShadow = true; envGroup.add(floorMesh);
  wallMesh = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.05, R + 0.05, env.arena.wallHeight, 96, 1, true), wallMat);
  wallMesh.rotation.x = Math.PI / 2; wallMesh.position.z = env.arena.wallHeight / 2; envGroup.add(wallMesh);
  for (const o of env.obstacles) { const m = new THREE.Mesh(o.type === 'box' ? new THREE.BoxGeometry(o.sx * 2, o.sy * 2, o.sz) : new THREE.CylinderGeometry(o.r, o.r, o.sz, 32), new THREE.MeshStandardMaterial({ color: isRace ? '#6a3d86' : '#3d4a3d', roughness: 0.7 }));
    if (o.type !== 'box') m.rotation.x = Math.PI / 2; else m.rotation.z = o.yaw || 0; m.position.set(o.x, o.y, o.sz / 2); m.castShadow = m.receiveShadow = true; envGroup.add(m); }
  for (const f of env.food) { const m = discMesh(f.r, '#f2c14e', 0.35 + 0.65 * Math.min(1, f.amount / 5)); m.position.set(f.x, f.y, 0.002); m.userData.food = f; envGroup.add(m); }
  for (const b of env.bitterPatches) { const m = discMesh(b.r, '#4f8fd6', 0.9); m.position.set(b.x, b.y, 0.002); envGroup.add(m); }
  for (const h of env.hazards) { const m = discMesh(h.r, '#d9502f', 0.9); m.position.set(h.x, h.y, 0.002); envGroup.add(m); const glow = discMesh(h.r + 0.4, '#d9502f', 0.12, 0.001); glow.position.set(h.x, h.y, 0.001); envGroup.add(glow); }
  for (const o of env.odors) {
    if (o.hidden) continue;
    const across = o.sigmaAcross || o.sigma, along = o.sigmaAlong;
    const spanX = (along || across) * 4.4, spanY = across * 4.4;
    const yaw = along ? Math.atan2(o.y, o.x) : 0;
    const rgb = o.odor === 'co2' ? [120, 200, 255] : [190, 255, 120];
    const z0 = 0.004, z1 = isRace ? RACE_PLUME_TOP : z0;
    const addPlane = z => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(spanX, spanY), new THREE.MeshBasicMaterial({ map: plumeTexture(spanX, spanY, !!along, rgb), transparent: true, depthWrite: false, depthTest: false }));
      m.position.set(o.x, o.y, z); m.rotation.z = yaw; envGroup.add(m);
    };
    addPlane(z1);
    if (isRace && z1 > z0) addPlane(z0);
  }
}
function plumeTexture(spanX, spanY, capsule, rgb) {
  const s = 256, g = document.createElement('canvas'); g.width = g.height = s;
  const gx = g.getContext('2d'), img = gx.createImageData(s, s), d = img.data;
  const rCap = spanY * 0.5, x0 = -spanX * 0.5 + rCap, x1 = spanX * 0.5 - rCap;
  for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
    const x = (i / (s - 1) - 0.5) * spanX, y = (j / (s - 1) - 0.5) * spanY;
    let dist;
    if (capsule && x1 > x0) { const cx = Math.max(x0, Math.min(x1, x)); dist = Math.hypot(x - cx, y); }
    else dist = Math.hypot(x, y);
    const u = Math.max(0, 1 - dist / Math.max(1e-4, rCap));
    const a = 0.48 * u * u;
    const p = (j * s + i) * 4;
    d[p] = rgb[0]; d[p + 1] = rgb[1]; d[p + 2] = rgb[2]; d[p + 3] = Math.round(a * 255);
  }
  gx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(g); tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  return tex;
}
function makeFlyGlow(color) {
  const s = 64, c = document.createElement('canvas'); c.width = c.height = s;
  const x = c.getContext('2d'), g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  const rgb = new THREE.Color(color);
  const col = `${Math.round(rgb.r * 255)},${Math.round(rgb.g * 255)},${Math.round(rgb.b * 255)}`;
  g.addColorStop(0, `rgba(${col},0.9)`); g.addColorStop(0.4, `rgba(${col},0.35)`); g.addColorStop(1, `rgba(${col},0)`);
  x.fillStyle = g; x.fillRect(0, 0, s, s);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  spr.scale.set(0.9, 0.9, 1); spr.position.set(0, 0, 0.06); spr.visible = false;
  return spr;
}
function buildFlyMesh(color, sex) {
  const appearance = visual.instantiate(sex);
  // Fine ground marker leaves the legs and contact shadow readable at macro scale.
  const ring = new THREE.Mesh(new THREE.RingGeometry(isRace ? 0.14 : 0.175, isRace ? 0.22 : 0.177, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: isRace ? 0.9 : 0.6, depthWrite: false }));
  scene.add(ring);
  let glow = null;
  if (isRace && appearance.bodies?.thorax) { glow = makeFlyGlow(color); appearance.bodies.thorax.add(glow); }
  return { ...appearance, ring, glow };
}

// One instanced draw per wing film across the sampled beat cycle. Poses are thorax-local and immutable.
const blurMaterial = new THREE.MeshStandardMaterial({ color: '#c0c7ce', transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide, roughness: 0.35 });
blurMaterial.forceSinglePass = true;
function buildWingBlur(f, poses) {
  // #region agent log
  fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'487c3c'},body:JSON.stringify({sessionId:'487c3c',runId:'pre-fix',hypothesisId:'A',location:'arena.js:buildWingBlur',message:'build wing blur',data:{flyId:f.id,isWatch,hasPoses:!!poses,leftN:poses?.left?.length??0,rightN:poses?.right?.length??0,filmLow:!!f.meshes.find(m=>m.name==='wing_left_membrane')?.userData?.low},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  if (!poses) return;
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3(1, 1, 1);
  f.wingBlur = ['left', 'right'].map(sd => {
    const src = f.bodies[`wing_${sd}`]; if (!src) return null;
    const film = f.meshes.find(m => m.name === `wing_${sd}_membrane`);
    const blur = new THREE.InstancedMesh(film.userData.low, blurMaterial, poses[sd].length);
    poses[sd].forEach((p, k) => { position.set(p[0], p[1], p[2]); rotation.set(p[4], p[5], p[6], p[3]); blur.setMatrixAt(k, matrix.compose(position, rotation, scale)); });
    blur.computeBoundingSphere(); blur.visible = false; blur.renderOrder = 2; f.bodies.thorax.add(blur);
    return { src, blur };
  });
}
function ensureWingBlur(f) {
  if (f.wingBlur || !watchWingPoses) return;
  buildWingBlur(f, watchWingPoses);
}
function updateWingBlur(f, s) {
  // #region agent log
  if (s?.flying || !f.wingBlur) {
    const now = performance.now();
    if (now - (updateWingBlur._at || 0) > 1500) {
      updateWingBlur._at = now;
      const w = f.wingBlur?.[0];
      fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'487c3c'},body:JSON.stringify({sessionId:'487c3c',runId:'pre-fix',hypothesisId:'D',location:'arena.js:updateWingBlur',message:'wing blur tick',data:{flyId:f.id,isWatch,flying:!!s?.flying,hasBlur:!!f.wingBlur,srcVis:w?w.src.visible:null,blurVis:w?w.blur.visible:null},timestamp:Date.now()})}).catch(()=>{});
    }
  }
  // #endregion
  if (!f.wingBlur) return;
  for (const w of f.wingBlur) if (w) { w.src.visible = !s.flying; w.blur.visible = !!s.flying; }
}

// ---------------- flies ----------------
let nextId = 0;
async function addFly(pos, yaw, sex = 'm', ident = null) {
  const cap = PRESET.maxFlies || MAX_FLIES;
  if (flies.length >= cap) { alert(`At most ${cap} flies`); return; }
  const id = nextId++; const color = ident?.color || FLY_COLORS[id % FLY_COLORS.length];
  const worker = new Worker(new URL('./sim/fly.worker.js', import.meta.url), { type: 'module' });
  const f = { id, worker, color, sex, name: ident?.name || (isRace ? RACE_NAMES[id] || `fly ${id}` : `fly ${id}`), ready: false, last: null, prev: null, stats: {}, ...buildFlyMesh(color, sex) };
  scene.add(f.group); flies.push(f); batches.add(f);
  if (isRace) {
    const el = document.createElement('div'); el.className = 'fly-label'; el.tabIndex = 0; el.style.color = f.color;
    el.innerHTML = `<span class="fly-label-chip">${f.name}</span><div class="fly-label-info"></div>`;
    const selectFly = () => {
      selected = f.id;
      renderFlyList();
      if (f.ready && f.worker && shouldPollBrainActivity()) f.worker.postMessage({ type: 'activity' });
    };
    el.addEventListener('pointerdown', e => { e.stopPropagation(); startRaceFollow(f.id); });
    const setOpen = open => {
      const info = el.querySelector('.fly-label-info');
      info.classList.toggle('open', open);
      if (open) { paintFlyLabel(f); selectFly(); }
    };
    el.addEventListener('pointerenter', () => setOpen(true));
    el.addEventListener('pointerleave', () => setOpen(false));
    el.addEventListener('focus', () => setOpen(true));
    el.addEventListener('blur', () => setOpen(false));
    f.label = new CSS2DObject(el); f.label.position.set(pos[0], pos[1], 1.1); scene.add(f.label);
  }
  worker.onmessage = e => onWorker(f, e.data);
  worker.postMessage({ type: 'init', id, graph: shared, meta, bodymap, flyXML, gait, env, pos, yaw, nProxies: MAX_FLIES - 1, mode: $('#mode').value, brainOpts: brainParams, neuromod: neuromodCalib, vision: true, sex,
    brainMem: { memory: brainMem.memory, graph: brainMem.graph, bases: brainMem.bases, opts: brainMem.opts, fv: brainMem.fv }, wasmModule, slot: id, flyvisMap,
    ...(isRace ? { burstSteps: 16, burstMs: 16, seed: Math.floor(Math.random() * 1e9) } : {}) });
  await new Promise(res => { f.onReady = res; });
  if (running) worker.postMessage({ type: 'run' });
  worker.postMessage({ type: 'speed', speed });
  renderFlyList();
  return f;
}
function removeFly(f) {
  f.worker?.terminate();
  batches.remove(f);
  scene.remove(f.group);
  scene.remove(f.ring);
  f.ring.geometry.dispose(); f.ring.material.dispose();
  if (f.glow) { f.glow.removeFromParent(); f.glow.material.map?.dispose(); f.glow.material.dispose(); }
  if (f.label) { scene.remove(f.label); f.label.element.remove(); }
}
function onWorker(f, m) {
  if (m.type === 'ready') {
    // #region agent log
    fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'487c3c'},body:JSON.stringify({sessionId:'487c3c',runId:'pre-fix',hypothesisId:'C',location:'arena.js:onWorker.ready',message:'worker ready wing poses',data:{flyId:f.id,isWatch,hasWingPoses:!!m.wingPoses,leftN:m.wingPoses?.left?.length??0},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    f.ready = true; f.bodyNames = m.bodyNames; f.bodyGroups = m.bodyNames.map(n => f.bodies[n] || null);
    if (m.wingPoses) { f.wingPoses = m.wingPoses; watchWingPoses = m.wingPoses; }
    buildWingBlur(f, m.wingPoses); f.onReady?.();
  }
  else if (m.type === 'pose') {
    f.prev = f.last; f.last = m; shadowDirty = true;
    f.onPose?.(); f.onPose = null;
    const received = performance.now(); f.poseInterval = f.recvAt ? Math.max(16, Math.min(100, received-f.recvAt)) : 1000/30; f.recvAt = received;
    m.foodEaten?.forEach((d, k) => { if (d > 0 && env.food[k]) { env.food[k].amount = Math.max(0, env.food[k].amount - d); foodDirty = true; } });
    if (isRace) { checkRaceFinish(f); paintFlyLabel(f); paintRaceVitals(); publishMatchState(matchPhase === 'lobby'); cueSelectedTakeoff(f); }
    if (f.id === selected && (f.prev?.takeoffPending !== m.takeoffPending || f.prev?.flying !== m.flying)) renderFlyList();
    broadcastOthers();
  } else if (m.type === 'activity') {
    const accept = f.id === selected && !m.eyesOnly && (f.activityTime !== m.t || histFly !== f.id);
    // #region agent log
    fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'487c3c'},body:JSON.stringify({sessionId:'487c3c',runId:'post-fix',hypothesisId:'B',location:'arena.js:onWorker.activity',message:'activity msg',data:{flyId:f.id,selected,accept,eyesOnly:!!m.eyesOnly,t:m.t,prevT:f.activityTime??null,running,phase:matchPhase,hidden:document.hidden,eyesN:m.eyes?.[0]?.length??null,groupsN:m.groups?.length??null,panelFolded:!!$('#brainpanel')?.classList.contains('folded')},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (m.eyes || m.groups) { f.lastEyes = m.eyes || f.lastEyes; f.lastGroups = m.groups || f.lastGroups; }
    if (!accept) return;
    f.activityTime = m.t;
    brainAct.set(m.trace); brainDirty = true; onActivity(f, m);
  }
}
let foodDirty = false, lastOthers = 0;
function broadcastOthers() {
  const now = performance.now(); if (now - lastOthers < 1000 / 30) return; lastOthers = now;
  const poses = flies.filter(o => o.last && o.last.alive !== false).map(o => ({ id:o.id, x:o.last.pos[0], y:o.last.pos[1], z:o.last.pos[2], yaw:o.last.yaw, sex:o.sex }));
  for (const f of flies) if (f.ready) f.worker.postMessage({ type:'others', others:poses.filter(o => o.id !== f.id) });
}
function syncEnv() { for (const f of flies) if (f.ready) f.worker.postMessage({ type: 'env', env }); }

// ---------------- UI ----------------
function buildUI() {
  $('#play').onclick = () => { running = !running; for (const f of flies) f.worker.postMessage({ type: running ? 'run' : 'pause' }); $('#play').textContent = running ? '❚❚ Pause' : '▶ Run'; };
  $('#addFly').onclick = () => { const a = Math.random() * Math.PI * 2, r = Math.random() * env.arena.radius * 0.6; addFly([r * Math.cos(a), r * Math.sin(a)], Math.random() * Math.PI * 2); };
  $('#addFemale').onclick = () => { const a = Math.random() * Math.PI * 2, r = Math.random() * env.arena.radius * 0.6; addFly([r * Math.cos(a), r * Math.sin(a)], Math.random() * Math.PI * 2, 'f'); };
  $('#speed').oninput = e => { speed = +e.target.value; $('#speedv').textContent = speed.toFixed(2) + '×'; for (const f of flies) f.worker.postMessage({ type: 'speed', speed }); };
  $('#preset').innerHTML = Object.entries(PRESETS).map(([k, p]) => `<option value="${k}" ${k === presetKey ? 'selected' : ''}>${p.label}</option>`).join('');
  $('#preset').onchange = e => { location.search = '?env=' + e.target.value; };
  $('#mode').onchange = e => { for (const f of flies) f.worker.postMessage({ type: 'mode', mode: e.target.value }); };
  document.querySelectorAll('.tools button').forEach(b => b.onclick = () => { tool = b.dataset.tool; document.querySelectorAll('.tools button').forEach(x => x.classList.toggle('on', x === b)); });
  setupFolds();
  setInterval(() => {
    if (document.hidden && !isHost) return;
    if (isHost && isRace) {
      for (const f of flies) if (f.ready && f.worker) f.worker.postMessage({ type: 'activity', eyesOnly: f.id !== selected });
      return;
    }
    const f = flies.find(x => x.id === selected);
    if (f?.ready && f.worker && shouldPollBrainActivity()) f.worker.postMessage({ type: 'activity' });
  }, 120);
  $('#wind').oninput = e => { const v = +e.target.value; $('#windv').textContent = v; env.wind = [v, 0]; syncEnv(); };
  $('#light').oninput = e => { env.light.sky = +e.target.value; scene.background = new THREE.Color().setHSL(0.6, 0.3, 0.02 + 0.05 * env.light.sky); syncEnv(); };
  $('#threat').onclick = () => launchThreat();
  $('#takeoff').onclick = () => flies.find(x => x.id === selected)?.worker.postMessage({ type: 'takeoff' });
  setInterval(() => { if (foodDirty) { foodDirty = false; syncEnv(); envGroup.children.forEach(m => { if (m.userData.food) m.material.opacity = 0.35 + 0.65 * Math.min(1, m.userData.food.amount / 5); }); } renderFlyList(); }, 500);
}
function loadRaceHistory() {
  try { const a = JSON.parse(localStorage.getItem(RACE_HISTORY_KEY) || '[]'); return Array.isArray(a) ? a.slice(0, 3) : []; }
  catch { return []; }
}
function saveRaceResult(row) {
  const rows = [row, ...loadRaceHistory()].slice(0, 3);
  try { localStorage.setItem(RACE_HISTORY_KEY, JSON.stringify(rows)); } catch {}
  return rows;
}
function raceHistoryHtml(rows) {
  if (!rows.length) return '';
  return `<h2 class="hist">Last races</h2><ol class="race-hist">${rows.map(r =>
    `<li><i style="background:${r.color}"></i><b>${r.name}</b><span>${r.wall}</span></li>`).join('')}</ol>`;
}
function setupRaceChrome() {
  document.body.classList.add('race');
  $('#panel').hidden = true;
  $('#raceHud').hidden = false;
  document.title = 'Fruit Fly';
  $('#follow').checked = false;
  const capL = $('#eyeL')?.closest('figure')?.querySelector('figcaption');
  const capR = $('#eyeR')?.closest('figure')?.querySelector('figcaption');
  if (capL) capL.textContent = 'Left';
  if (capR) capR.textContent = 'Right';
  const note = $('#bpBody .note');
  if (note) note.textContent = 'What this fly sees.';
  raceAudio = createRaceAudio(`${BASE}yipee.wav`, `${BASE}gong.wav`);
  armWatchAudio();
  document.addEventListener('visibilitychange', () => {
    raceAudio.setMuted(document.hidden);
    if (isHost && document.hidden) raceAudio.unlock().then(() => raceAudio.hold(true));
    if (document.hidden) return;
    kickHostSim();
  });
  if (isHost) {
    setInterval(() => {
      if (matchPhase === 'lobby') tickLobby();
      else if (matchPhase === 'live' && running) {
        const now = performance.now();
        if (flies.some(f => f.ready && (!f.recvAt || now - f.recvAt > 1500))) {
          for (const f of flies) f.worker?.postMessage({ type: 'run' });
        }
        publishMatchState(true);
      }
    }, 1000);
  }
  if (isWatch) {
    const profile = $('#profile');
    if (profile) {
      profile.classList.toggle('guest', !getAccount());
      $('#profileConnect').onclick = e => {
        if (getAccount()) copyProfileAddress(e);
        else connectFromUi(connectWallet);
      };
      $('#profileDisconnect').onclick = () => clearWalletUi();
      profileFoldChrome(profile.classList.contains('folded'));
      $('#profileFold')?.addEventListener('click', () => setProfileFolded(!profile.classList.contains('folded')));
      $('#profileScrim')?.addEventListener('click', () => setProfileFolded(true));
      restoreWallet().then(a => {
        // #region agent log
        dbg('arena.js:restoreWallet', 'silent restore', { acct: a ? a.slice(0, 10) : null }, 'I');
        // #endregion
        if (!a) return;
        refreshProfile();
        if (matchPhase === 'lobby') paintLobbyOverlay(true);
      });
    }
    showWatchWaiting('Waiting for the next race');
    onWalletChange(() => { refreshProfile(); if (matchPhase === 'lobby') paintLobbyOverlay(true); if (matchPhase === 'results') paintResultActions(matchId); });
    window.ethereum?.on?.('accountsChanged', accs => {
      // #region agent log
      fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6b97f7'},body:JSON.stringify({sessionId:'6b97f7',location:'arena.js:accountsChanged',message:'mm accountsChanged',data:{accs:(accs||[]).map(a=>String(a).slice(0,10)),cached:getAccount()?.slice(0,10)},timestamp:Date.now(),hypothesisId:'B'})}).catch(()=>{});
      // #endregion
    });
  }
  setupMatchLink();
  $('#raceVitals').addEventListener('pointerdown', e => {
    const row = e.target.closest('.fly');
    if (!row) return;
    e.stopPropagation();
    startRaceFollow(+row.dataset.id);
  });
  setupRaceAnnounce();
  $('#bpHint').onclick = () => setRaceBrainFolded(false, { user: true });
  addEventListener('resize', () => { positionBpHint(null, { instant: true }); syncProfileScrim(); });
  setupWalletPick();
  setupEnterGate();
  resolveChip().then(() => {
    paintEnterToken();
    if (matchPhase === 'lobby') paintLobbyOverlay(true);
    refreshProfile();
  }).catch(() => {});
}
function shortToken(addr) {
  if (!addr) return '';
  return addr.slice(0, 10) + '…' + addr.slice(-6);
}
function paintEnterToken() {
  const btn = $('#enterToken');
  if (!btn) return;
  const addr = getChipMeta()?.address;
  if (!addr) { btn.hidden = true; return; }
  btn.hidden = false;
  btn.dataset.addr = addr;
  const shown = btn.dataset.copied === '1' ? 'Copied' : shortToken(addr);
  btn.textContent = shown;
  btn.title = 'Copy token address';
}
function popCopied(btn, after) {
  btn.classList.remove('copied');
  void btn.offsetWidth;
  btn.dataset.copied = '1';
  btn.classList.add('copied');
  after?.();
  setTimeout(() => {
    if (!btn.dataset) return;
    btn.dataset.copied = '';
    btn.classList.remove('copied');
    after?.();
  }, 1200);
}
function copyEnterToken(e) {
  e.preventDefault();
  e.stopPropagation();
  const btn = $('#enterToken');
  const addr = btn?.dataset.addr;
  if (!addr) return;
  const done = () => popCopied(btn, paintEnterToken);
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(addr).then(done).catch(() => fallbackCopy(addr, done));
  else fallbackCopy(addr, done);
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.left = '-9999px';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch {}
  ta.remove();
}
function copyProfileAddress(e) {
  e.preventDefault();
  e.stopPropagation();
  const btn = $('#profileConnect');
  const acct = getAccount();
  if (!btn || !acct) return;
  const done = () => popCopied(btn, refreshProfile);
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(acct).then(done).catch(() => fallbackCopy(acct, done));
  else fallbackCopy(acct, done);
}
function unlockRaceAudio(ev) {
  const src = ev?.type || 'direct';
  // #region agent log
  fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'487c3c'},body:JSON.stringify({sessionId:'487c3c',runId:'ios-audio',hypothesisId:'C',location:'arena.js:unlockRaceAudio',message:'unlock call',data:{src,trusted:!!ev?.isTrusted,ios:/iPhone|iPad|iPod/i.test(navigator.userAgent),gate:!!$('#enterGate'),hidden:document.hidden,phase:watchOverlayPhase||matchPhase},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  return raceAudio?.unlock().then(() => {
    if (isHost) raceAudio.hold(true);
    else playWatchBed();
  });
}
function setupEnterGate() {
  let entered = false;
  try { entered = sessionStorage.getItem(ENTER_GATE_KEY) === '1'; } catch {}
  if (entered) return;
  const el = document.createElement('div');
  el.id = 'enterGate';
  el.innerHTML = `<div class="enter-card" role="dialog" aria-labelledby="enterTitle" aria-modal="true">
    <img class="enter-logo" src="${BASE}FruitFlyText.png" alt="Fruit Fly" />
    <h1 id="enterTitle">Welcome to Fruit Fly</h1>
    <p>Three of us, three brains — 165,122 neurons each — racing for a drop of vinegar. Pick a fly. Cheer. Bet. Don't get eaten by a fruit bowl.</p>
    <button type="button" class="enter-token" id="enterToken" hidden></button>
    <button type="button" class="primary" id="enterBtn">Press to enter</button>
    <div class="enter-socials">
      <a class="enter-social enter-social-x" href="https://x.com/SugarRunFun" target="_blank" rel="noopener noreferrer" aria-label="X">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
      </a>
    </div>
  </div>`;
  document.body.appendChild(el);
  paintEnterToken();
  const dismiss = () => {
    if (!el.isConnected) return;
    try { sessionStorage.setItem(ENTER_GATE_KEY, '1'); } catch {}
    el.remove();
    removeEventListener('keydown', onKey);
    unlockRaceAudio();
    syncBpHint();
  };
  const onKey = e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dismiss(); }
  };
  $('#enterBtn')?.addEventListener('pointerdown', e => { e.stopPropagation(); unlockRaceAudio(e); });
  $('#enterBtn')?.addEventListener('click', e => { e.stopPropagation(); dismiss(); });
  $('#enterToken')?.addEventListener('click', copyEnterToken);
  addEventListener('keydown', onKey);
}
function settleNote() {
  if (!chainConfigured()) return 'Next race starting…';
  if (poolStatus === 3 || poolStatus === 4) return 'Settled — next race starting…';
  return 'Settling match on-chain…';
}
function readyForNextRace() {
  if (!chainConfigured()) return Date.now() - resultsAt > CLAIM_WINDOW_MS;
  if (settledAt) return Date.now() - settledAt > CLAIM_WINDOW_MS;
  return Date.now() - resultsAt > SETTLE_GRACE_MS;
}
// The relay is the pool operator; it tells everyone when the race opens, locks or settles.
function applyPoolStatus(p) {
  if (p?.matchId == null || Number(p.matchId) !== Number(matchId)) return;
  const was = poolStatus;
  poolStatus = p.status;
  if ((poolStatus === 3 || poolStatus === 4) && !settledAt) settledAt = Date.now();
  // #region agent log
  dbg('arena.js:applyPoolStatus', 'pool status', { matchId, status: poolStatus, was, phase: matchPhase, sinceResults: resultsAt ? Date.now() - resultsAt : null }, 'H');
  // #endregion
  if (isHost && poolStatus === 1 && matchPhase === 'lobby') armBetWindow();
  if (was === poolStatus) return;
  if (matchPhase === 'lobby') paintLobbyOverlay(true);
  else if (matchPhase === 'results') {
    paintResultActions(matchId);
    const el = $('#raceReset'); if (el) el.textContent = settleNote();
  }
}
function kickHostSim() {
  if (!isHost) return;
  if (matchPhase === 'live' && running) {
    for (const f of flies) f.worker?.postMessage({ type: 'run' });
    publishMatchState(true);
  }
  if (matchPhase === 'lobby' && betClosesAt && Date.now() >= betClosesAt) goLiveFromLobby();
}
function setupMatchLink() {
  if (!isHost && !isWatch) return;
  matchLink = createMatchLink({
    role: isHost ? 'host' : 'watch',
    onState: isWatch ? applyWatchState : undefined,
    onPool: applyPoolStatus,
    onStatus: s => {
      // #region agent log
      fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'487c3c'},body:JSON.stringify({sessionId:'487c3c',runId:'pre-fix',hypothesisId:'A',location:'arena.js:setupMatchLink',message:'match status',data:{s,isWatch,isHost,href:location.href},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      if (isWatch && (s === 'offline' || s === 'host-taken')) showWatchWaiting('Waiting for the next race');
    },
  });
}
function publishMatchState(force = false) {
  if (!isHost || !matchLink) return;
  const now = performance.now();
  if (!force && now - lastMatchSend < 1000 / 15) return;
  lastMatchSend = now;
  const wall = raceStartWall != null ? formatWall(now - raceStartWall) : '0 s';
  const sel = flies.find(f => f.id === selected) || flies[0];
  let act = null;
  if (now - lastActSend > 400 && brainAct) { lastActSend = now; act = packAct(brainAct); }
  matchLink.sendState(buildMatchState({
    matchId, phase: matchPhase, flies,
    clock: { wall, fly: flySecs(), elapsed: raceStartWall != null ? now - raceStartWall : null },
    winner: raceWinner, why: raceWinnerWhy,
    bodyNames: flies.find(f => f.bodyNames)?.bodyNames || null,
    wingPoses: (() => {
      const wp = flies.find(f => f.wingPoses)?.wingPoses || watchWingPoses;
      if (!wp || wp === lastSentWingPoses) return null;
      lastSentWingPoses = wp;
      return wp;
    })(),
    resetIn: matchResetIn,
    selected,
    eyes: sel?.lastEyes ? [Array.from(sel.lastEyes[0] || []), Array.from(sel.lastEyes[1] || [])] : null,
    groups: sel?.lastGroups ? Array.from(sel.lastGroups) : null,
    visions: flies.filter(f => f.lastEyes || f.lastGroups).map(f => ({
      id: f.id,
      eyes: packEyes(f.lastEyes),
      groups: f.lastGroups ? Array.from(f.lastGroups) : null,
    })),
    act,
    betClosesAt,
    pools: poolSnap,
  }));
  // #region agent log
  fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'487c3c'},body:JSON.stringify({sessionId:'487c3c',runId:'post-fix',hypothesisId:'A',location:'arena.js:publishMatchState',message:'host snapshot',data:{phase:matchPhase,selected,hidden:document.hidden,hasEyes:!!sel?.lastEyes,eye0Len:sel?.lastEyes?.[0]?.length??null,hasGroups:!!sel?.lastGroups,groupN:sel?.lastGroups?.length??null,running},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  // #region agent log
  if (Date.now() - (publishMatchState._eyeLog || 0) > 2000) { publishMatchState._eyeLog = Date.now(); const withEyes = flies.filter(f => f.lastEyes).map(f => f.id); fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'487c3c'},body:JSON.stringify({sessionId:'487c3c',runId:'eyes-all',hypothesisId:'E',location:'arena.js:publishMatchState',message:'vision ids',data:{selected,flyIds:flies.map(f=>f.id),withEyes},timestamp:Date.now()})}).catch(()=>{}); }
  // #endregion
}
let watchOverlayPhase = null, watchSawRest = false;
function playWatchBed() {
  raceAudio?.playBed(watchOverlayPhase === 'live' ? 'race' : 'menu');
}
function armWatchAudio() {
  const unlock = (e) => unlockRaceAudio(e);
  addEventListener('pointerdown', unlock);
  addEventListener('touchstart', unlock, { passive: true });
  addEventListener('keydown', unlock);
}
function showWatchWaiting(msg) {
  const card = $('#raceCard');
  lastLobbyKind = '';
  lastPoolKey = '';
  if (card) card.dataset.kind = '';
  card.innerHTML = `<h1>Fruit Fly</h1><p>${msg}</p>`;
  if (watchOverlayPhase !== 'wait') showRaceOverlayCard(card);
  else { const overlay = $('#raceOverlay'); overlay.hidden = false; }
  watchOverlayPhase = 'wait';
  raceAudio?.setMotion({ flying: false, walk: 0 });
  playWatchBed();
}
function applyWatchOverlay(st) {
  if (st.phase === 'live') {
    const overlay = $('#raceOverlay');
    overlay.classList.remove('show');
    overlay.hidden = true;
    watchOverlayPhase = 'live';
    lastLobbyKind = '';
    return;
  }
  const card = $('#raceCard');
  if (st.phase === 'lobby') {
    watchOverlayPhase = 'lobby';
    return;
  }
  if (st.phase === 'results' && st.winner) {
    const w = st.winner;
    const reset = settleNote();
    if (watchOverlayPhase !== 'results') {
      const note = w.why === 'last' ? 'last remaining' : w.why === 'died' ? 'last to die' : '';
      card.innerHTML = `<h1>${w.name} wins!</h1>${note ? `<p class="flyt">${note}</p>` : ''}<p class="sub">${st.clock?.wall || ''}</p><p class="flyt">${st.clock?.fly || '0'} s fly</p>
        <div class="bet-actions"></div>
        <p id="betNote" class="flyt"></p>
        <p id="raceReset">${reset}</p>`;
      showRaceOverlayCard(card, { flyColor: w.color });
      paintResultActions(st.matchId);
      // #region agent log
      dbg('arena.js:applyWatchOverlay', 'results card built', { matchId: st.matchId, acct: getAccount()?.slice(0, 10), poolStatus }, 'D');
      // #endregion
    } else {
      card.style.setProperty('--fly', w.color);
      const el = card.querySelector('#raceReset');
      if (el) el.textContent = reset;
      if (!card.querySelector('.bet-actions')?.childElementCount) injectResultActions(st.matchId);
    }
    watchOverlayPhase = 'results';
    lastLobbyKind = '';
    return;
  }
  if (watchOverlayPhase !== 'wait') showWatchWaiting('Waiting for the next race');
  watchOverlayPhase = 'wait';
  lastLobbyKind = '';
  // #region agent log
  fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'487c3c'},body:JSON.stringify({sessionId:'487c3c',runId:'pre-fix',hypothesisId:'C',location:'arena.js:applyWatchOverlay',message:'overlay wait',data:{phase:st.phase,flyN:st.flies?.length??0,matchId:st.matchId??null},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
}
function pushWatchPose(f, row, recvAt) {
  const buf = f.poseBuf || (f.poseBuf = []);
  buf.push({ t: row.t, recvAt, xpos: row.xpos, xquat: row.xquat, pos: row.pos, flying: !!row.flying });
  if (buf.length > WATCH_POSE_RING) buf.shift();
}
function sampleWatchPose(f, now) {
  const buf = f.poseBuf;
  if (!buf?.length) return null;
  const renderAt = now - WATCH_POSE_DELAY;
  let i = 0;
  while (i + 1 < buf.length && buf[i + 1].recvAt <= renderAt) i++;
  const a = buf[i], b = buf[i + 1];
  if (b) {
    const span = Math.max(1, b.recvAt - a.recvAt);
    return { a, b, blend: Math.min(1, Math.max(0, (renderAt - a.recvAt) / span)), extra: 0 };
  }
  if (renderAt < a.recvAt) return { a, b: a, blend: 1, extra: 0 };
  const prev = i > 0 ? buf[i - 1] : null;
  return { a: prev || a, b: a, blend: 1, extra: prev ? Math.min(WATCH_POSE_EXTRAP, renderAt - a.recvAt) : 0 };
}
function flyDrawPos(f) { return f.drawPos || f.last?.pos; }
function applyWatchBodies(f, a, b, blend, extra) {
  const ax = a.xpos, bx = b.xpos, aq = a.xquat, bq = b.xquat;
  if (!bx?.length) return;
  let ex = 0, ey = 0, ez = 0;
  if (extra > 0 && a !== b && a.pos && b.pos) {
    const k = extra / Math.max(1, b.recvAt - a.recvAt);
    ex = (b.pos[0] - a.pos[0]) * k; ey = (b.pos[1] - a.pos[1]) * k; ez = (b.pos[2] - a.pos[2]) * k;
  }
  const u = blend;
  for (let bi = 1; bi < f.bodyGroups.length; bi++) {
    const g = f.bodyGroups[bi]; if (!g) continue;
    const i3 = bi * 3, i4 = bi * 4;
    if (!ax || u >= 1 || a === b) {
      g.position.set((bx[i3] || 0) + ex, (bx[i3 + 1] || 0) + ey, (bx[i3 + 2] || 0) + ez);
      q.set(bq[i4 + 1], bq[i4 + 2], bq[i4 + 3], bq[i4]);
    } else {
      g.position.set(ax[i3] + (bx[i3] - ax[i3]) * u + ex, ax[i3 + 1] + (bx[i3 + 1] - ax[i3 + 1]) * u + ey, ax[i3 + 2] + (bx[i3 + 2] - ax[i3 + 2]) * u + ez);
      previousQ.set(aq[i4 + 1], aq[i4 + 2], aq[i4 + 3], aq[i4]);
      q.set(bq[i4 + 1], bq[i4 + 2], bq[i4 + 3], bq[i4]);
      q.slerpQuaternions(previousQ, q, u);
    }
    g.quaternion.copy(q); g.updateMatrix();
  }
  const ap = a.pos || b.pos, bp = b.pos || ap;
  const pos = [ap[0] + (bp[0] - ap[0]) * u + ex, ap[1] + (bp[1] - ap[1]) * u + ey, ap[2] + (bp[2] - ap[2]) * u + ez];
  f.drawPos = pos;
  f.ring.position.set(pos[0], pos[1], 0.003);
  if (f.label) f.label.position.set(pos[0], pos[1], pos[2] + flyLabelZ(f));
  updateWingBlur(f, { flying: u < 0.5 ? a.flying : b.flying });
}
function addVisualFly(row, bodyNames) {
  const f = { id: row.id, worker: null, color: row.color, sex: row.sex || 'm', name: row.name, ready: true, last: null, prev: null, stats: {}, ...buildFlyMesh(row.color, row.sex || 'm') };
  f.bodyNames = bodyNames;
  f.bodyGroups = bodyNames.map(n => f.bodies[n] || null);
  ensureWingBlur(f);
  scene.add(f.group); flies.push(f); batches.add(f);
  const el = document.createElement('div'); el.className = 'fly-label'; el.tabIndex = 0; el.style.color = f.color;
  el.innerHTML = `<span class="fly-label-chip">${f.name}</span><div class="fly-label-info"></div>`;
  el.addEventListener('pointerdown', e => { e.stopPropagation(); startRaceFollow(f.id); });
  const setOpen = open => {
    const info = el.querySelector('.fly-label-info');
    info.classList.toggle('open', open);
    if (open) { paintFlyLabel(f); selected = f.id; renderFlyList(); }
  };
  el.addEventListener('pointerenter', () => setOpen(true));
  el.addEventListener('pointerleave', () => setOpen(false));
  el.addEventListener('focus', () => setOpen(true));
  el.addEventListener('blur', () => setOpen(false));
  f.label = new CSS2DObject(el);
  f.label.position.set(row.pos?.[0] || 0, row.pos?.[1] || 0, 1.1);
  scene.add(f.label);
  // #region agent log
  fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'487c3c'},body:JSON.stringify({sessionId:'487c3c',runId:'pre-fix',hypothesisId:'A',location:'arena.js:addVisualFly',message:'watcher fly spawned',data:{flyId:f.id,isWatch,hasWingBlur:!!f.wingBlur,hasWorker:!!f.worker,bodyN:bodyNames?.length??0},timestamp:Date.now()})}).catch(()=>{});
  fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'487c3c'},body:JSON.stringify({sessionId:'487c3c',runId:'post-fix',hypothesisId:'A',location:'arena.js:addVisualFly',message:'watcher fly blur',data:{flyId:f.id,isWatch,hasWingBlur:!!f.wingBlur,hasPoses:!!watchWingPoses,leftN:watchWingPoses?.left?.length??0},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  return f;
}
function applyWatchFlyIdent(f, row) {
  if (!row || (f.name === row.name && f.color === row.color)) return;
  f.name = row.name;
  f.color = row.color;
  const el = f.label?.element;
  if (el) {
    el.style.color = f.color;
    const chip = el.querySelector('.fly-label-chip');
    if (chip) chip.textContent = f.name;
  }
  if (f.ring?.material?.color) f.ring.material.color.set(f.color);
}
function applyWatchState(st) {
  const wasLive = watchOverlayPhase === 'live';
  matchPhase = st.phase || matchPhase;
  if (st.bodyNames) watchBodyNames = st.bodyNames;
  if (st.wingPoses) watchWingPoses = st.wingPoses;
  if (st.matchId != null && st.matchId !== matchId) { matchId = st.matchId; poolStatus = null; }
  betClosesAt = st.betClosesAt ?? null;
  if (st.pools) poolSnap = st.pools;
  if (st.clock) {
    if (st.phase === 'live') {
      const elapsed = st.clock.elapsed ?? parseWallMs(st.clock.wall);
      if (elapsed != null && raceStartWall == null) raceStartWall = performance.now() - elapsed;
    } else {
      raceStartWall = null;
      paintRaceClock(st.clock.wall);
    }
  }
  const names = watchBodyNames;
  const seen = new Set();
  for (const row of st.flies || []) {
    seen.add(row.id);
    let f = flies.find(x => x.id === row.id);
    if (!f && names) f = addVisualFly(row, names);
    else if (f && (f.name !== row.name || f.color !== row.color)) applyWatchFlyIdent(f, row);
    if (f) ensureWingBlur(f);
    if (!f) continue;
    if (f.last && f.last.alive !== false && row.alive === false && !st.winner) raceAudio?.playOof();
    f.prev = f.last; f.last = row;
    // #region agent log
    if (row.flying && performance.now() - (applyWatchState._flyLog || 0) > 1500) {
      applyWatchState._flyLog = performance.now();
      fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'487c3c'},body:JSON.stringify({sessionId:'487c3c',runId:'pre-fix',hypothesisId:'B',location:'arena.js:applyWatchState',message:'watch flying pose',data:{flyId:row.id,flying:!!row.flying,hasWingBlur:!!f.wingBlur,phase:st.phase,xposN:row.xpos?.length??0},timestamp:Date.now()})}).catch(()=>{});
    }
    // #endregion
    cueSelectedTakeoff(f);
    const received = performance.now();
    f.poseInterval = f.recvAt ? Math.max(16, Math.min(100, received - f.recvAt)) : 1000 / 30;
    f.recvAt = received;
    if (isWatch) pushWatchPose(f, row, received);
    paintFlyLabel(f);
  }
  for (let i = flies.length - 1; i >= 0; i--) if (!seen.has(flies[i].id)) { removeFly(flies[i]); flies.splice(i, 1); }
  applyWatchOverlay(st);
  if (st.phase === 'lobby') {
    if (!lobbyTimer) lobbyTimer = setInterval(() => { if (matchPhase === 'lobby') paintLobbyOverlay(); }, 250);
    paintLobbyOverlay();
  } else {
    clearInterval(lobbyTimer); lobbyTimer = null;
  }
  if (st.phase !== 'live') watchSawRest = true;
  if (st.phase === 'live' && !wasLive) {
    if (watchSawRest) announceRace('GO!');
    scheduleRaceBrainFold();
    playWatchBed();
  }
  if (st.phase === 'results' && st.winner && watchOverlayPhase === 'results' && !raceWinner) {
    announceRace(`${st.winner.name} wins!`, st.winner.color);
    raceAudio?.setMotion({ flying: false, walk: 0 });
    raceAudio?.playBed('menu');
    raceAudio?.playYipee();
    refreshProfile();
  }
  paintRaceVitals(true);
  running = st.phase === 'live';
  raceWinner = st.winner ? flies.find(x => x.id === st.winner.id) || null : null;
  raceWinnerWhy = st.winner?.why || null;
  const prevSelected = selected;
  const rows = Array.isArray(st.visions) ? st.visions : [];
  for (const row of rows) {
    const fly = flies.find(x => x.id === row.id);
    if (!fly) continue;
    if (row.eyes) fly.lastEyes = unpackEyes(row.eyes);
    if (row.groups) fly.lastGroups = row.groups;
  }
  const payloadFly = !rows.length && st.selected != null ? flies.find(x => x.id === st.selected) : null;
  if (payloadFly && (st.groups || st.eyes)) {
    payloadFly.lastEyes = st.eyes;
    payloadFly.lastGroups = st.groups;
  }
  const f = flies.find(x => x.id === selected) || flies[0];
  const mine = f && (rows.some(r => r.id === f.id) || (!rows.length && payloadFly?.id === f.id));
  // #region agent log
  if (isWatch && st.selected != null && selected !== prevSelected) fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'487c3c'},body:JSON.stringify({sessionId:'487c3c',runId:'watch-sel',hypothesisId:'A',location:'arena.js:applyWatchState',message:'selected overwrite',data:{prevSelected,stSelected:st.selected,selected,isWatch,phase:st.phase},timestamp:Date.now()})}).catch(()=>{});
  if (isWatch && st.selected != null && st.selected !== selected && Date.now() - (applyWatchState._keptAt || 0) > 1500) { applyWatchState._keptAt = Date.now(); fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'487c3c'},body:JSON.stringify({sessionId:'487c3c',runId:'post-fix-watch-sel',hypothesisId:'A',location:'arena.js:applyWatchState',message:'selected kept local',data:{localSelected:selected,stSelected:st.selected,phase:st.phase},timestamp:Date.now()})}).catch(()=>{}); }
  if (isWatch && Date.now() - (applyWatchState._eyeLog || 0) > 2000) { applyWatchState._eyeLog = Date.now(); fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'487c3c'},body:JSON.stringify({sessionId:'487c3c',runId:'eyes-all',hypothesisId:'E',location:'arena.js:applyWatchState',message:'watcher eyes',data:{selected,stSelected:st.selected??null,visionIds:rows.map(r=>r.id),mine:!!mine,eyeLen:f?.lastEyes?.[0]?.length??null},timestamp:Date.now()})}).catch(()=>{}); }
  // #endregion
  // #region agent log
  fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'487c3c'},body:JSON.stringify({sessionId:'487c3c',runId:'post-fix',hypothesisId:'C',location:'arena.js:applyWatchState',message:'watch snapshot',data:{phase:st.phase,isWatch,selected,stSelected:st.selected??null,hasEyes:!!st.eyes,eye0Len:st.eyes?.[0]?.length??(st.eyes?.[0]?Object.keys(st.eyes[0]).length:null),hasGroups:!!st.groups,groupN:st.groups?.length??null,groupsBuilt:groups.length,willPaint:!!(f&&(st.groups||st.eyes)&&groups.length)},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  if (mine && f && (f.lastGroups || f.lastEyes) && groups.length && performance.now() - (f.watchActAt || 0) > 110) {
    f.watchActAt = performance.now();
    onActivity(f, { groups: f.lastGroups || [], eyes: f.lastEyes, t: f.last?.t || 0 });
  }
  if (st.act && brainAct && f && f.id === st.selected && unpackAct(st.act, brainAct)) brainDirty = true;
}
function setupWatchBrainPanel() {
  $('#brainpanel').hidden = false;
}
function shouldPollBrainActivity() {
  const p = $('#brainpanel');
  return p && !p.hidden && (!p.classList.contains('folded') || isRace);
}
function syncBrainInset() {
  const el = $('#brain');
  if (!el || !brainRenderer || !brainCam) return;
  const bw = el.clientWidth, bh = el.clientHeight;
  if (bw < 8 || bh < 8) return;
  brainRenderer.setSize(bw, bh, false);
  brainCam.aspect = bw / bh;
  brainCam.updateProjectionMatrix();
}
function setupRaceAnnounce() {
  if (raceAnnounce || !scene) return;
  const el = document.createElement('div');
  el.className = 'race-announce';
  el.innerHTML = '<span class="race-announce-text"></span>';
  raceAnnounce = new CSS2DObject(el);
  scene.add(raceAnnounce);
}
function announceRace(text, color) {
  if (!isRace) return;
  if (!raceAnnounce) setupRaceAnnounce();
  if (!raceAnnounce) return;
  const span = raceAnnounce.element.querySelector('.race-announce-text');
  span.textContent = text;
  span.style.color = color || '#fff';
  span.classList.remove('pop');
  void span.offsetWidth;
  span.classList.add('pop');
  if (text === 'GO!') raceAudio?.playGong();
}
const announceNdc = new THREE.Vector3();
function pinRaceAnnounce() {
  if (!raceAnnounce || !camera) return;
  announceNdc.set(0, 0.5, 0.5);
  announceNdc.unproject(camera);
  raceAnnounce.position.copy(announceNdc);
}
function brainFoldChrome(folded) {
  const b = $('#bpFold'); if (!b) return;
  const mobile = raceMobile();
  b.textContent = mobile ? (folded ? '∧' : '∨') : (folded ? '<' : '>');
  b.title = `${folded ? 'Show' : 'Hide'} brain panel (])`;
  b.setAttribute('aria-expanded', String(!folded));
}
function profileFoldChrome(folded) {
  const b = $('#profileFold'); if (!b) return;
  b.textContent = folded ? '<' : '>';
  b.title = `${folded ? 'Show' : 'Hide'} profile`;
  b.setAttribute('aria-expanded', String(!folded));
}
function syncProfileScrim() {
  const scrim = $('#profileScrim');
  const profile = $('#profile');
  if (!scrim || !profile) return;
  scrim.hidden = !(raceMobile() && !profile.hidden && !profile.classList.contains('folded'));
}
function peekProfileRect(folded) {
  const profile = $('#profile');
  const was = profile.classList.contains('folded');
  const prev = { width: profile.style.width, minWidth: profile.style.minWidth, transition: profile.style.transition };
  profile.style.transition = 'none';
  profile.style.width = '';
  profile.style.minWidth = '';
  profile.classList.toggle('folded', folded);
  const r = profile.getBoundingClientRect();
  profile.classList.toggle('folded', was);
  profile.style.width = prev.width;
  profile.style.minWidth = prev.minWidth;
  profile.style.transition = prev.transition;
  return r;
}
function positionBpHint(rect = null, { instant = false } = {}) {
  const hint = $('#bpHint');
  const profile = $('#profile');
  if (!hint || hint.hidden || !profile || profile.hidden) return;
  const r = rect || profile.getBoundingClientRect();
  const top = raceMobile()
    ? `${r.bottom + 8}px`
    : `${Math.max(8, r.top - hint.offsetHeight - 8)}px`;
  const left = raceMobile()
    ? `${Math.max(8, r.right - hint.offsetWidth)}px`
    : `${r.left + (r.width - hint.offsetWidth) / 2}px`;
  const skip = instant || !hint.dataset.placed || matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (skip) {
    hint.style.transition = 'none';
    hint.style.top = top;
    hint.style.left = left;
    hint.style.right = 'auto';
    hint.style.bottom = 'auto';
    void hint.offsetWidth;
    hint.style.transition = '';
    hint.dataset.placed = '1';
    return;
  }
  hint.style.top = top;
  hint.style.left = left;
  hint.style.right = 'auto';
  hint.style.bottom = 'auto';
}
function syncBpHint() {
  const hint = $('#bpHint');
  if (!hint) return;
  const show = isWatch && isRace && !getAccount() && !$('#loading') && !$('#enterGate')
    && $('#profile') && !$('#profile').hidden;
  if (!show) {
    hint.hidden = true;
    delete hint.dataset.placed;
    return;
  }
  hint.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => positionBpHint(null, { instant: !hint.dataset.placed })));
}
function followBpHint(rect, { instant = false } = {}) {
  const hint = $('#bpHint');
  if (!hint || hint.hidden) {
    syncBpHint();
    return;
  }
  positionBpHint(rect, { instant: instant || !hint.dataset.placed });
}
function setProfileFolded(folded, { instant = false } = {}) {
  const profile = $('#profile');
  if (!profile || profile.classList.contains('folded') === folded) return;
  profileFoldChrome(folded);
  const dest = peekProfileRect(folded);
  const snap = instant || matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (snap || raceMobile()) {
    profile.style.width = '';
    profile.style.minWidth = '';
    profile.style.transition = '';
    profile.classList.toggle('folded', folded);
    syncProfileScrim();
    followBpHint(dest, { instant: snap });
    return;
  }
  const fromW = profile.getBoundingClientRect().width;
  const ease = 'cubic-bezier(0.34, 1.2, 0.64, 1)';
  profile.style.transition = `width .35s ${ease}`;
  profile.style.minWidth = '0';
  profile.style.width = `${fromW}px`;
  profile.classList.toggle('folded', folded);
  syncProfileScrim();
  followBpHint(dest);
  requestAnimationFrame(() => { profile.style.width = `${dest.width}px`; });
  profile.addEventListener('transitionend', (e) => {
    if (e.propertyName !== 'width') return;
    profile.style.width = '';
    profile.style.minWidth = '';
    profile.style.transition = '';
    syncProfileScrim();
  }, { once: true });
}
function setRaceBrainFolded(folded, { user = false, instant = false } = {}) {
  if (!isRace) return;
  if (user) { raceBrainTouched = true; clearTimeout(raceBrainTimer); raceBrainTimer = null; }
  const panel = $('#brainpanel');
  if (!panel) return;
  panel.classList.toggle('folded', folded);
  brainFoldChrome(folded);
  syncBpHint();
  if (!folded) requestAnimationFrame(() => requestAnimationFrame(syncBrainInset));
  if (folded) {
    const f = flies.find(x => x.id === selected);
    if (f?.ready && f.worker) f.worker.postMessage({ type: 'activity' });
  } else if (!instant) {
    const f = flies.find(x => x.id === selected);
    if (f?.ready && f.worker && shouldPollBrainActivity()) f.worker.postMessage({ type: 'activity' });
  }
}
function raceMobile() {
  return matchMedia('(max-width: 700px), (max-height: 500px)').matches;
}
function scheduleRaceBrainFold() {
  clearTimeout(raceBrainTimer);
  raceBrainTouched = false;
  if (raceMobile()) {
    setRaceBrainFolded(true, { instant: true });
    return;
  }
  setRaceBrainFolded(false, { instant: true });
  raceBrainTimer = setTimeout(() => {
    if (raceBrainTouched || raceWinner) return;
    setRaceBrainFolded(true);
  }, 3000);
}
function showRaceOverlayCard(card, { flyColor, enter = true } = {}) {
  const overlay = $('#raceOverlay');
  card.style.removeProperty('--fly');
  if (flyColor) card.style.setProperty('--fly', flyColor);
  overlay.hidden = false;
  if (!enter && overlay.classList.contains('show')) return;
  overlay.classList.remove('show');
  void overlay.offsetWidth;
  overlay.classList.add('show');
}
function maybeLobbyTick() {
  if (matchPhase !== 'lobby' || !betClosesAt) return;
  const left = Math.max(0, Math.ceil((betClosesAt - Date.now()) / 1000));
  if (left < 1 || left > 5) { lastLobbyTickSec = null; return; }
  if (lastLobbyTickSec === left) return;
  lastLobbyTickSec = left;
  raceAudio?.playLobbyTick(left);
}
function cueSelectedTakeoff(f) {
  if (!isRace || !f || f.id !== selected) return;
  const prev = f.prev, cur = f.last;
  if (!cur) return;
  if ((!prev?.flying && cur.flying) || (!prev?.takeoffPending && cur.takeoffPending)) raceAudio?.playTakeoff();
}
function lobbyClockLabel() {
  if (betClosesAt == null) return 'Waiting for betting to open…';
  const left = Math.max(0, Math.ceil((betClosesAt - Date.now()) / 1000));
  return `Bets close in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}
function poolRowsHtml(list = flies) {
  const total = poolSnap.reduce((s, p) => s + Number(p.display || 0), 0);
  return `<div id="betRows" class="bet-rows">${list.map(f => {
    const p = poolSnap.find(x => x.id === f.id);
    const amt = p ? Number(p.display || 0) : 0;
    const odds = amt > 0 && total > 0 ? (total / amt).toFixed(2) + '×' : '—';
    const on = betFlyId === f.id ? ' on' : '';
    return `<button type="button" class="bet-fly${on}" data-fly="${f.id}" style="--fly:${f.color}"><b>${f.name}</b><span>${amt} ${chipSymbol()}</span><i>${odds}</i></button>`;
  }).join('')}</div>`;
}
async function refreshPoolSnap() {
  if (!chainConfigured() || !matchId || Date.now() - lastPoolRead < 2000) return;
  lastPoolRead = Date.now();
  try {
    const prev = getChipMeta()?.address;
    await resolveChip();
    poolSnap = await readPools(matchId, flies.map(f => f.id));
    if (getChipMeta()?.address !== prev) {
      paintEnterToken();
      if (matchPhase === 'lobby') paintLobbyOverlay(true);
      refreshProfile();
    }
  } catch { /* offline pool */ }
}
// #region agent log
function dbg(location, message, data, hypothesisId = 'C') {
  if (matchLink?.sendLog({ location, message, data, hypothesisId })) return true;
  fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6b97f7'},body:JSON.stringify({sessionId:'6b97f7',runId:'post-fix',location,message,data,hypothesisId,timestamp:Date.now()})}).catch(()=>{});
  return true;
}
setDebugSink(dbg);
// #endregion
function shortAddr(a) {
  return a ? a.slice(0, 4) + '...' + a.slice(-4) : 'Connect';
}
function matchWhen(id) {
  const n = Number(id);
  if (!Number.isFinite(n) || n < 1e12) return '—';
  return new Date(n).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
// Fly ids are reshuffled onto names each race, so a ticket must keep the identity it was bet on.
function readRaceFlies() {
  try { return JSON.parse(localStorage.getItem(RACE_FLIES_KEY) || '{}'); } catch { return {}; }
}
function rememberRaceFlies() {
  if (!matchId || !flies.length) return;
  const key = `${matchId}:${flies.map(f => f.id + f.name).join(',')}`;
  if (key === lastRaceFliesKey) return;
  lastRaceFliesKey = key;
  const all = readRaceFlies();
  all[matchId] = flies.map(f => [f.id, f.name, f.color]);
  for (const k of Object.keys(all).sort((a, b) => Number(a) - Number(b)).slice(0, -24)) delete all[k];
  try { localStorage.setItem(RACE_FLIES_KEY, JSON.stringify(all)); } catch { /* storage full */ }
}
function flyTag(flyId, id = matchId) {
  const saved = readRaceFlies()[id]?.find(r => r[0] === flyId);
  const f = saved ? null : flies.find(x => x.id === flyId);
  const name = saved?.[1] || f?.name || RACE_NAMES[flyId] || `Fly ${flyId}`;
  const color = saved?.[2] || f?.color || FLY_COLORS[flyId] || 'currentColor';
  return `<span class="tk-fly" style="--fly:${color}">${name}</span>`;
}
async function connectFromUi(fn = connectWallet) {
  if (!window.ethereum && needsMobileWalletPick()) {
    showWalletPick();
    return;
  }
  const note = $('#betNote') || $('#profileNote');
  try {
    if (note) note.textContent = 'Check your wallet…';
    await fn();
    if (note) note.textContent = '';
    if (matchPhase === 'lobby') paintLobbyOverlay(true);
    if (matchPhase === 'results') paintResultActions(matchId);
    await refreshProfile();
  } catch (e) {
    // #region agent log
    dbg('arena.js:connectFromUi', 'connect failed', { err: e?.shortMessage || e?.message || String(e) }, 'A');
    // #endregion
    if (note) note.textContent = e.shortMessage || e.message || String(e);
  }
}
function needsMobileWalletPick() {
  return raceMobile() || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}
function walletDappUrl() {
  return `${location.host}${location.pathname}${location.search}${location.hash}`;
}
function metamaskDappLink() {
  return `https://metamask.app.link/dapp/${walletDappUrl()}`;
}
function rabbyDappLink() {
  const dapp = encodeURIComponent(location.href);
  return `https://go.rabby.io/mobile/?_cmd=open-dapp&dapp=${dapp}`;
}
function showWalletPick() {
  const el = $('#walletPick');
  if (!el) return;
  el.hidden = false;
}
function hideWalletPick() {
  const el = $('#walletPick');
  if (el) el.hidden = true;
}
function setupWalletPick() {
  const el = $('#walletPick');
  if (!el) return;
  $('#walletMetaMask')?.addEventListener('click', e => {
    e.preventDefault();
    location.href = metamaskDappLink();
  });
  $('#walletRabby')?.addEventListener('click', e => {
    e.preventDefault();
    location.href = rabbyDappLink();
  });
  el.addEventListener('click', e => { if (e.target === el) hideWalletPick(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !el.hidden) hideWalletPick(); });
}
function clearWalletUi() {
  disconnectWallet();
  // #region agent log
  fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6b97f7'},body:JSON.stringify({sessionId:'6b97f7',runId:'post-fix',location:'arena.js:clearWalletUi',message:'disconnect',data:{phase:matchPhase,acct:getAccount()},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  refreshProfile();
  if (matchPhase === 'lobby') paintLobbyOverlay(true);
  if (matchPhase === 'results') paintResultActions(matchId);
}
function injectResultActions(id) {
  const host = $('#raceCard .bet-actions');
  if (!host) return;
  if (resultActions.key.split(':')[0] !== String(id)) { host.innerHTML = ''; return; }
  host.innerHTML = (resultActions.claim ? '<button id="betClaim" class="primary" type="button">Claim</button>' : '')
    + (resultActions.refund ? '<button id="betRefund" type="button">Refund</button>' : '');
  const claim = host.querySelector('#betClaim');
  if (claim) claim.onclick = () => runBetTx(() => claimRace(id));
  const refund = host.querySelector('#betRefund');
  if (refund) refund.onclick = () => runBetTx(() => refundRace(id));
  const note = $('#raceCard #betNote');
  if (note && resultActions.note != null) note.textContent = resultActions.note;
}
async function paintResultActions(id) {
  const acct = getAccount();
  const key = `${id}:${acct || '0'}:${poolStatus}`;
  if (resultActions.key !== key) {
    let claim = false, refund = false, status = null, stakeAll = 0n;
    if (acct && id && chainConfigured()) {
      try {
        const info = await readRace(id);
        status = info.status;
        if (status === 3 || status === 4) {
          const [mine, done] = await Promise.all([userTotal(id, acct), isClaimed(id, acct)]);
          stakeAll = mine;
          // winnerFly 0 is a real fly, so never test it for truthiness.
          const winStake = status === 3 ? await userStake(id, acct, info.winnerFly) : 0n;
          claim = status === 3 && !done && winStake > 0n && info.winningPool > 0n;
          refund = !done && mine > 0n && (status === 4 || info.winningPool === 0n);
        }
      } catch { /* pool offline */ }
    }
    // The #raceReset line already says we are settling, so only speak up when there is money to take.
    const note = claim ? 'You won — claim your payout.' : (refund ? 'Race voided — take your refund.' : '');
    resultActions = { key, claim, refund, note };
    // #region agent log
    dbg('arena.js:paintResultActions', 'claim/refund visibility', { id, acct: acct ? acct.slice(0, 10) : null, status, claim, refund, stake: String(stakeAll) }, 'D');
    // #endregion
  }
  injectResultActions(id);
}
function selectBetFly(id, card = $('#raceCard')) {
  betFlyId = id;
  card?.querySelectorAll('.bet-fly').forEach(b => b.classList.toggle('on', +b.dataset.fly === id));
}
function wireLobbyCard(card) {
  card.querySelectorAll('.bet-fly').forEach(b => {
    b.onclick = () => selectBetFly(+b.dataset.fly, card);
  });
  const connect = card.querySelector('#betConnect');
  if (connect) {
    connect.classList.toggle('connect-btn', !getAccount());
    connect.onclick = () => connectFromUi(getAccount() ? switchAccount : connectWallet);
  }
  const disc = card.querySelector('#betDisconnect');
  if (disc) disc.onclick = () => clearWalletUi();
  const bet = card.querySelector('#betPlace');
  if (bet) bet.onclick = () => runBetTx(async () => {
    const amt = +card.querySelector('#betAmt')?.value || 10;
    const fly = betFlyId ?? flies[0]?.id;
    if (fly == null) throw new Error('Pick a fly');
    await placeBet(matchId, fly, amt);
    lastPoolRead = 0; await refreshPoolSnap(); paintLobbyOverlay(); await refreshProfile();
  });
}
async function runBetTx(fn) {
  const note = $('#betNote') || $('#profileNote');
  try {
    await ensureWallet();
    if (note) note.textContent = 'Confirm in wallet…';
    // #region agent log
    dbg('arena.js:runBetTx', 'tx start', { acct: getAccount()?.slice(0, 10), phase: matchPhase, matchId }, 'E');
    // #endregion
    await fn();
    if (note) note.textContent = 'Done.';
    await refreshProfile();
  } catch (e) {
    // #region agent log
    dbg('arena.js:runBetTx', 'tx failed', { acct: getAccount()?.slice(0, 10), phase: matchPhase, matchId, err: e?.shortMessage || e?.reason || e?.message || String(e) }, 'G');
    // #endregion
    if (note) note.textContent = e.shortMessage || e.message || String(e);
  }
}
function ticketStatus(r) {
  if (r.outcome === 'unclaimed') return { label: 'Won', kind: 'won' };
  if (r.outcome === 'won') return { label: 'Claimed', kind: 'claimed' };
  if (r.outcome === 'void') return { label: 'Void', kind: 'void' };
  if (r.outcome === 'refunded') return { label: 'Refunded', kind: 'refunded' };
  if (r.outcome === 'open') return { label: 'Open', kind: 'open' };
  if (r.outcome === 'lost') return { label: 'Lost', kind: 'lost' };
  return { label: r.outcome, kind: r.outcome };
}
async function refreshProfile() {
  const el = $('#profile');
  if (!el || el.hidden) return;
  const seq = ++profileSeq;
  const connect = $('#profileConnect');
  const disc = $('#profileDisconnect');
  const acct = getAccount();
  el.classList.toggle('guest', !acct);
  if (acct) hideWalletPick();
  if (connect) {
    connect.textContent = connect.dataset.copied === '1' ? 'Copied' : shortAddr(acct);
    connect.title = acct ? 'Copy address' : 'Connect wallet';
    connect.classList.toggle('connect-btn', !acct);
  }
  if (disc) disc.hidden = !acct;
  syncBpHint();
  const bal = $('#profileBal'), list = $('#profileTickets');
  if (!chainConfigured()) {
    if (bal) bal.textContent = 'Pool not configured';
    if (list) list.innerHTML = '';
    return;
  }
  if (!acct) {
    profileAcct = null;
    if (bal) bal.textContent = 'Connect a wallet';
    if (list) list.innerHTML = '';
    return;
  }
  if (acct !== profileAcct) {          // a switch must not leave the old wallet's tickets on screen
    profileAcct = acct;
    if (bal) bal.textContent = 'Loading…';
    if (list) list.innerHTML = '<li>Loading…</li>';
  }
  try {
    const [chips, hist, stake] = await Promise.all([
      readBalance(acct),
      loadHistory(acct),
      matchId ? userTotal(matchId, acct) : 0n,
    ]);
    if (seq !== profileSeq) return;    // a newer refresh already owns the panel
    if (bal) bal.textContent = `${Number(chips).toFixed(1)} ${chipSymbol()}` + (stake && stake > 0n ? ` · this race ${Number(chipFmt(stake)).toFixed(1)}` : '');
    if (list) {
      list.innerHTML = hist.slice(0, 8).map(r => {
        const st = ticketStatus(r);
        const act = r.outcome === 'unclaimed' ? `<button type="button" class="tk-claim" data-claim="${r.matchId}">Claim</button>`
          : (r.outcome === 'void' ? `<button type="button" class="tk-refund" data-refund="${r.matchId}">Refund</button>` : '');
        const win = r.payout != null && Number(r.payout) > 0 && r.outcome !== 'lost' ? ` +${Number(r.payout).toFixed(1)}` : '';
        return `<li><b>${matchWhen(r.matchId)}</b>${flyTag(r.flyId, r.matchId)}<span class="tk-amt">${Number(r.amount).toFixed(1)}</span><i class="tk-status tk-${st.kind}">${st.label}${win}</i><span class="tk-act">${act}</span></li>`;
      }).join('') || '<li>No tickets yet</li>';
      list.querySelectorAll('[data-claim]').forEach(b => { b.onclick = () => runBetTx(() => claimRace(+b.dataset.claim)); });
      list.querySelectorAll('[data-refund]').forEach(b => { b.onclick = () => runBetTx(() => refundRace(+b.dataset.refund)); });
    }
  } catch (e) {
    if (seq !== profileSeq) return;
    if (bal) bal.textContent = e.shortMessage || e.message || String(e);
  }
}
function paintLobbyOverlay(force = false) {
  const card = $('#raceCard');
  if (!card) return;
  const clock = lobbyClockLabel();
  const acct = getAccount();
  const kind = `${isWatch ? 'w' : 'h'}:${matchId}:${acct || '0'}:${poolStatus}:${flies.map(f => f.id).join(',')}`;
  const skip = !force && card.dataset.kind === 'lobby' && lastLobbyKind === kind && card.querySelector('#lobbyClock');
  // #region agent log
  if (force || !skip) fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6b97f7'},body:JSON.stringify({sessionId:'6b97f7',location:'arena.js:paintLobbyOverlay',message:'lobby paint',data:{force,skip,acct:acct?acct.slice(0,10):null,kind,btn:$('#betConnect')?.textContent},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  if (skip) {
    const el = card.querySelector('#lobbyClock'); if (el) el.textContent = clock;
    const key = poolSnap.map(p => p.id + ':' + (p.display || '0')).join('|');
    const rows = card.querySelector('#betRows');
    if (rows && key !== lastPoolKey) {
      lastPoolKey = key;
      rows.outerHTML = poolRowsHtml();
      wireLobbyCard(card);
    }
    maybeLobbyTick();
    return;
  }
  lastLobbyKind = kind;
  lastPoolKey = poolSnap.map(p => p.id + ':' + (p.display || '0')).join('|');
  card.dataset.kind = 'lobby';
  rememberRaceFlies();
  const overlay = $('#raceOverlay');
  const overlayWasHidden = !overlay || overlay.hidden || !overlay.classList.contains('show');
  const prevAmt = card.querySelector('#betAmt')?.value;
  if (isWatch) {
    // Unknown status with a running clock means no operator is reporting: let them try anyway.
    const open = !chainConfigured() || poolStatus === 1 || (poolStatus == null && betClosesAt != null);
    const note = !chainConfigured() ? 'Pool not configured (set VITE_POOL).'
      : (open ? 'Pick a fly, then Bet.' : 'Opening the race on-chain…');
    card.innerHTML = `<h1>Fruit Fly</h1><p>Winner pool — first to the vinegar</p>
      <p class="sub" id="lobbyClock">${clock}</p>
      ${poolRowsHtml()}
      <div class="bet-stake">
        <div class="bet-stake-row"><input id="betAmt" type="number" min="1" value="10"><span>${chipSymbol()}</span>
          <button id="betPlace" class="primary" type="button"${open ? '' : ' disabled'}>Bet</button></div>
      </div>
      <div class="bet-wallet">
        <button id="betConnect" type="button">${shortAddr(acct)}</button>
        ${acct ? '<button id="betDisconnect" class="danger" type="button">Disconnect</button>' : ''}
      </div>
      <p id="betNote" class="flyt">${note}</p>`;
  } else {
    card.innerHTML = `<h1>Fruit Fly</h1><p>First to the vinegar wins!</p>
      <p class="sub" id="lobbyClock">${clock}</p>
      <p class="flyt">Race starts itself — no GO</p>
      ${poolRowsHtml()}${raceHistoryHtml(loadRaceHistory())}`;
  }
  showRaceOverlayCard(card, { enter: overlayWasHidden });
  wireLobbyCard(card);
  if (prevAmt) { const inp = card.querySelector('#betAmt'); if (inp) inp.value = prevAmt; }
  maybeLobbyTick();
  if (isWatch) refreshProfile();
  card.onpointerdown = e => {
    if (e.target.closest('button, input')) return;
    raceAudio?.unlock().then(() => raceAudio?.playBed('menu'));
  };
}
// The countdown starts only once bets can actually be placed, so nobody loses window time.
function armBetWindow() {
  if (betWindowArmed || matchPhase !== 'lobby') return;
  betWindowArmed = true;
  betClosesAt = Date.now() + betWindowSec * 1000;
  // #region agent log
  dbg('arena.js:armBetWindow', 'bet window armed', { matchId, poolStatus, waited: Date.now() - lobbyStartedAt }, 'H');
  // #endregion
  paintLobbyOverlay(true);
  publishMatchState(true);
}
async function tickLobby() {
  if (matchPhase !== 'lobby') return;
  if (isHost && !betWindowArmed && Date.now() - lobbyStartedAt > OPEN_GRACE_MS) armBetWindow();
  await refreshPoolSnap();
  paintLobbyOverlay();
  maybeLobbyTick();
  publishMatchState();
  if (isHost && betClosesAt && Date.now() >= betClosesAt) {
    clearInterval(lobbyTimer); lobbyTimer = null;
    await goLiveFromLobby();
  }
}
async function goLiveFromLobby() {
  if (matchPhase !== 'lobby') return;
  if (isHost && chainConfigured() && getAccount()) {
    try { await lockRace(matchId); } catch (e) { console.warn('lockRace', e); }
  }
  startRace();
}
async function openHostRace() {
  if (!isHost || !chainConfigured() || !getAccount()) return;
  // #region agent log
  fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6b97f7'},body:JSON.stringify({sessionId:'6b97f7',runId:'post-fix',location:'arena.js:openHostRace',message:'openRace',data:{matchId,flies:flies.map(f=>f.id),acct:getAccount()?.slice(0,10)},timestamp:Date.now(),hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  await openRace(matchId, flies.map(f => f.id));
}
async function settleHostRace(winnerId) {
  if (chainSettled || !isHost || !chainConfigured() || !getAccount()) return;
  chainSettled = true;
  try { await settleRace(matchId, winnerId); }
  catch (e) {
    console.warn('settleRace', e);
    try { await voidRace(matchId); }
    catch (e2) { chainSettled = false; console.warn('voidRace', e2); }
  }
}
async function showRaceStart() {
  matchPhase = 'lobby';
  matchResetIn = null;
  raceWinner = null;
  chainSettled = false;
  matchId = Date.now();
  lastLobbyKind = '';
  betFlyId = null;
  poolStatus = null;
  betWindowArmed = false;
  lobbyStartedAt = Date.now();
  resultsAt = 0;
  settledAt = 0;
  resultActions = { key: '', claim: false, refund: false, note: '' };
  clearInterval(lobbyTimer); lobbyTimer = null;
  // Clear the old clock before any await, or the previous race's countdown shows for a frame.
  betClosesAt = null;
  betWindowArmed = false;
  lastPoolRead = 0;
  poolSnap = flies.map(f => ({ id: f.id, amount: '0', display: '0' }));
  paintLobbyOverlay(true);
  publishMatchState(true);
  let windowSec = DEFAULT_WINDOW;
  try { windowSec = await readWindow(); } catch { /* local default */ }
  betWindowSec = windowSec;
  if (!chainConfigured()) { betWindowArmed = true; betClosesAt = Date.now() + windowSec * 1000; }
  paintLobbyOverlay(true);
  raceAudio?.unlock().then(() => raceAudio?.playBed('menu'));
  lobbyTimer = setInterval(() => { tickLobby(); }, 250);
  publishMatchState(true);
  if (isHost && chainConfigured()) openHostRace().catch(e => console.warn('openRace', e));
  refreshPoolSnap().then(() => paintLobbyOverlay());
}
function formatWall(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s >= 60) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return s + ' s';
}
function parseWallMs(wall) {
  if (wall == null) return null;
  if (typeof wall === 'number' && Number.isFinite(wall)) return Math.max(0, wall);
  const m = String(wall).match(/^(\d+):(\d{2})/);
  if (m) return ((+m[1]) * 60 + (+m[2])) * 1000;
  const s = parseFloat(wall);
  return Number.isFinite(s) ? Math.max(0, s * 1000) : null;
}
function flySecs(f = flies.find(x => x.last)) {
  return String(Math.floor((f?.last?.t || 0) / 1000));
}
function paintRaceClock(wall) {
  const el = $('#raceClock'); if (!el) return;
  el.hidden = false;
  $('#raceWall').textContent = wall;
}
function startRace() {
  const overlay = $('#raceOverlay');
  overlay.classList.remove('show');
  overlay.hidden = true;
  raceStartWall = performance.now();
  paintRaceClock('0 s');
  running = true;
  matchPhase = 'live';
  matchResetIn = null;
  clearInterval(lobbyTimer); lobbyTimer = null;
  raceAudio?.unlock().then(() => raceAudio?.playBed('race'));
  for (const f of flies) f.worker?.postMessage({ type: 'run' });
  announceRace('GO!');
  scheduleRaceBrainFold();
  publishMatchState(true);
}
function announceRaceWinner(f, why) {
  if (!running || raceWinner || raceResetting) return;
  raceWinner = f;
  raceWinnerWhy = why || null;
  matchPhase = 'results';
  matchResetIn = null;
  resultsAt = Date.now();
  settledAt = 0;
  const wall = formatWall(performance.now() - (raceStartWall || performance.now()));
  const fly = flySecs(f);
  paintRaceClock(wall);
  const hist = saveRaceResult({ name: f.name, color: f.color, wall, fly });
  raceAudio?.setMotion({ flying: false, walk: 0 });
  raceAudio?.playBed('menu');
  raceAudio?.playYipee();
  announceRace(`${f.name} wins!`, f.color);
  clearTimeout(raceBrainTimer); raceBrainTimer = null;
  const card = $('#raceCard');
  const note = why === 'last' ? 'last remaining' : why === 'died' ? 'last to die' : '';
  card.innerHTML = `<h1>${f.name} wins!</h1>${note ? `<p class="flyt">${note}</p>` : ''}<p class="sub">${wall}</p><p class="flyt">${fly} s fly</p>${raceHistoryHtml(hist)}<p id="raceReset">${settleNote()}</p>`;
  publishMatchState(true);
  showRaceOverlayCard(card, { flyColor: f.color });
  settleHostRace(f.id);
  clearInterval(raceResetTimer);
  // The next lobby waits for the match to settle on-chain, not for a countdown.
  raceResetTimer = setInterval(() => {
    const el = $('#raceReset'); if (el) el.textContent = settleNote();
    publishMatchState();
    if (!readyForNextRace()) return;
    clearInterval(raceResetTimer); raceResetTimer = null;
    // #region agent log
    dbg('arena.js:announceRaceWinner', 'results -> next lobby', { poolStatus, settleMs: settledAt ? settledAt - resultsAt : null, heldMs: Date.now() - resultsAt }, 'I');
    // #endregion
    resetRace();
  }, 1000);
}
function checkRaceFinish(f) {
  if (!running || raceWinner || raceResetting) return;
  if (f?.last?.alive === false && !f.diedAt) {
    f.diedAt = performance.now();
    if (!raceWinner) { raceAudio?.playOof(); announceRace(`${f.name} died!`, f.color); }
  }
  const food = env.food[0];
  if (food && f?.last?.pos && f.last.alive !== false && Math.hypot(f.last.pos[0] - food.x, f.last.pos[1] - food.y) < food.r) {
    announceRaceWinner(f);
    return;
  }
  if (flies.some(x => !x.last)) return;
  const live = flies.filter(x => x.last.alive !== false);
  if (live.length === 1) announceRaceWinner(live[0], 'last');
  else if (!live.length) {
    const last = flies.reduce((a, b) => (a.diedAt || 0) >= (b.diedAt || 0) ? a : b);
    announceRaceWinner(last, 'died');
  }
}
async function resetRace() {
  if (raceResetting) return;
  raceResetting = true;
  clearInterval(raceResetTimer); raceResetTimer = null;
  clearTimeout(raceBrainTimer); raceBrainTimer = null;
  running = false; raceWinner = null; raceWinnerWhy = null; raceStartWall = null;
  const clock = $('#raceClock'); if (clock) clock.hidden = true;
  if (raceAnnounce) { raceAnnounce.element.querySelector('.race-announce-text')?.classList.remove('pop'); }
  setRaceBrainFolded(raceMobile(), { instant: true });
  for (const f of flies) { f.worker?.postMessage({ type: 'pause' }); removeFly(f); }
  flies.length = 0; nextId = 0; selected = 0;
  snapRaceOverview();
  if (env.food[0]) env.food[0].amount = 8;
  env.threat = null;
  rebuildEnv();
  await spawnPresetFlies();
  await waitRacePoses();
  await showRaceStart();
  raceResetting = false;
}
function easeOutBack(t, s = 1.7) { const u = t - 1; return u * u * ((s + 1) * u + s) + 1; }
function easeInBack(t, s = 1.7) { return t * t * ((s + 1) * t - s); }
function flyLabelZ(f) {
  let k = 0;
  if (raceFollow === f.id) k = raceCamTween?.mode === 'in' ? Math.min(1, raceCamTween.t) : 1;
  else if (raceCamTween?.mode === 'out' && raceCamTween.wasFollow === f.id) k = 1 - Math.min(1, raceCamTween.t);
  return RACE_LABEL_Z + (RACE_LABEL_Z_CHASE - RACE_LABEL_Z) * k;
}
function chaseCam(f, outPos, outTarget) {
  const p = flyDrawPos(f) || f.last.pos, yaw = f.last.yaw || 0;
  outTarget.set(p[0], p[1], p[2]);
  outPos.set(p[0] - Math.cos(yaw) * RACE_CHASE_BACK, p[1] - Math.sin(yaw) * RACE_CHASE_BACK, p[2] + RACE_CHASE_Z);
}
const chasePos = new THREE.Vector3(), chaseTarget = new THREE.Vector3();
function startRaceFollow(id) {
  const same = isRace && raceFollow === id;
  // #region agent log
  fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'487c3c'},body:JSON.stringify({sessionId:'487c3c',runId:'watch-sel',hypothesisId:'A',location:'arena.js:startRaceFollow',message:'local pick',data:{id,prevSelected:selected,isWatch,isHost,raceFollow,same},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  selected = id;
  if (!isRace) { renderFlyList(); return; }
  if (!same) raceAudio?.playSelect(id);
  raceFollow = id;
  raceCamTween = { mode: 'in', t: 0, dur: 0.55, fromPos: camera.position.clone(), fromTarget: controls.target.clone() };
  renderFlyList();
  const f = flies.find(x => x.id === id);
  if (f?.ready && shouldPollBrainActivity()) f.worker.postMessage({ type: 'activity' });
  if (isWatch && f && (f.lastGroups || f.lastEyes) && groups.length) onActivity(f, { groups: f.lastGroups || [], eyes: f.lastEyes, t: f.last?.t || 0 });
}
function stopRaceFollow() {
  if (!isRace || (raceFollow == null && raceCamTween?.mode !== 'in')) return;
  const wasFollow = raceFollow;
  raceFollow = null;
  if (!raceCamHome) return;
  raceCamTween = { mode: 'out', t: 0, dur: 0.5, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), wasFollow };
}
function snapRaceOverview() {
  raceFollow = null;
  raceCamTween = null;
  if (!raceCamHome) return;
  camera.position.copy(raceCamHome.pos);
  controls.target.copy(raceCamHome.target);
}
function tickRaceCamera(dt) {
  if (!isRace) return;
  if (raceCamTween) {
    raceCamTween.t = Math.min(1, raceCamTween.t + dt / raceCamTween.dur);
    const k = raceCamTween.mode === 'in' ? easeOutBack(raceCamTween.t) : easeInBack(raceCamTween.t);
    if (raceCamTween.mode === 'in') {
      const f = flies.find(x => x.id === raceFollow);
      if (f?.last) chaseCam(f, chasePos, chaseTarget);
      else { chasePos.copy(raceCamHome.pos); chaseTarget.copy(raceCamHome.target); }
      camera.position.lerpVectors(raceCamTween.fromPos, chasePos, k);
      controls.target.lerpVectors(raceCamTween.fromTarget, chaseTarget, k);
    } else if (raceCamHome) {
      camera.position.lerpVectors(raceCamTween.fromPos, raceCamHome.pos, k);
      controls.target.lerpVectors(raceCamTween.fromTarget, raceCamHome.target, k);
    }
    if (raceCamTween.t >= 1) raceCamTween = null;
    return;
  }
  if (raceFollow != null) {
    const f = flies.find(x => x.id === raceFollow);
    if (f?.last) {
      const p = flyDrawPos(f) || f.last.pos;
      followDelta.set(p[0], p[1], p[2]).sub(controls.target).multiplyScalar(0.1);
      controls.target.add(followDelta); camera.position.add(followDelta);
    }
  }
}
function onClick(e) {
  if (isRace && e.target.closest?.('.fly-label')) return;
  const m = new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); raycaster.setFromCamera(m, camera);
  for (const f of flies) { const hit = raycaster.intersectObjects(f.meshes.filter(m => m.parent.visible), false); if (hit.length) { startRaceFollow(f.id); return; } }
  if (isRace) { if (raceFollow != null || raceCamTween) stopRaceFollow(); return; }
  if (tool === 'none') return;
  const hit = raycaster.intersectObject(floorMesh); if (!hit.length) return; const p = hit[0].point;
  if (tool === 'food') { env.food.push({ x: p.x, y: p.y, r: 0.25, sugar: 1, bitter: 0, water: 0.2, amount: 5 }); env.odors.push({ x: p.x, y: p.y, odor: 'vinegar', strength: 0.8, sigma: 0.7 }); }
  if (tool === 'odor') env.odors.push({ x: p.x, y: p.y, odor: 'vinegar', strength: 1, sigma: 0.9 });
  if (tool === 'co2') env.odors.push({ x: p.x, y: p.y, odor: 'co2', strength: 1, sigma: 0.8 });
  if (tool === 'bitter') env.bitterPatches.push({ x: p.x, y: p.y, r: 0.25, bitter: 1 });
  if (tool === 'hazard') env.hazards.push({ x: p.x, y: p.y, r: 0.3, heat: 1 });
  if (tool === 'obstacle') { alert('Obstacles change the physics world; they apply to flies added after this point.'); env.obstacles.push({ type: 'box', x: p.x, y: p.y, sx: 0.2, sy: 0.2, sz: 0.3 }); }
  rebuildEnv(); syncEnv();
}
const VITALS_SHORT = {
  'turning left': 'turn left',
  'turning right': 'turn right',
  'walking backward': 'walk back',
  walking: 'walk',
  standing: 'stand',
  'taking off': 'takeoff',
  'escape jump': 'escape',
  'singing (courtship)': 'singing',
  courting: 'court',
  grooming: 'groom',
  feeding: 'feed',
  flying: 'fly',
  landing: 'land',
  righting: 'right',
  dead: 'dead',
  'proboscis extended': 'proboscis',
};
function vitalsBehaviorLabel(behavior) {
  if (!behavior) return '';
  const base = behavior.replace(/ \(proboscis out\)$/, '');
  return VITALS_SHORT[base] || base;
}
function flyRowHtml(f, selectedId = selected, raceVitals = false) {
  const s = f.last || {}; const e = s.energy ?? 0, h = s.health ?? 1;
  const gender = raceVitals ? '' : `${f.sex === 'f' ? '♀' : '♂'} `;
  const timer = raceVitals ? '' : `<span class="fly-t" style="color:var(--dim)">${s.t ? (s.t / 1000).toFixed(1) + 's' : '…'}</span>`;
  return `<div class="fly ${f.id === selectedId ? 'sel' : ''}" data-id="${f.id}" style="--fly:${f.color}"><i class="dot" style="background:${f.color}"></i>
      <div>${gender}<span class="fly-name">${f.name}</span> <span class="fly-behavior" style="color:var(--acc)">${s.behavior || ''}</span><div class="bar bar-energy"><i style="width:${e * 100}%;background:#f2c14e"></i></div><div class="bar bar-health"><i style="width:${h * 100}%;background:#4ade80"></i></div></div>
      ${timer}</div>`;
}
function flyKvHtml(f) {
  const s = f.last; if (!s) return '';
  const c = s.cmd || {};
  return `<div class="kv"><span>behaviour</span><span style="color:var(--acc)">${s.behavior || ''}</span><span>energy</span><span>${(s.energy * 100).toFixed(0)}%</span><span>health</span><span>${(s.health * 100).toFixed(0)}%</span>
      <span>food eaten</span><span>${(s.eaten * 1000).toFixed(1)} mg·eq</span><span>distance travelled</span><span>${(s.dist || 0).toFixed(1)} cm</span><span>takeoffs / flights</span><span>${s.jumps || 0} / ${s.flights || 0}</span><span>endogenous state</span><span>${s.drive || '–'}</span>${s.nm ? `<span>AKH / insulin</span><span>${s.nm.akh.toFixed(2)} / ${s.nm.dilp.toFixed(2)}</span><span>octopamine (AKHR neurons)</span><span>${s.nm.oa.toFixed(1)} Hz, arousal ${(s.nm.arousal * 100).toFixed(0)}%</span>` : ''}<span>walk drive (BDN2/oDN1/P9)</span><span>${(c.drive || 0).toFixed(0)} Hz</span>
      <span>backward (MDN)</span><span>${(c.back || 0).toFixed(0)} Hz</span><span>steering (DNa01/02)</span><span>${(c.turn || 0).toFixed(2)}</span>
      <span>giant fibre</span><span>${(c.escape || 0).toFixed(0)} Hz</span><span>MN9 (proboscis)</span><span>${(s.mn9 || 0).toFixed(0)} Hz</span>
      <span>pharyngeal pump</span><span>${((s.feeding || 0) * 100).toFixed(0)}%</span><span>sensory neurons driven</span><span>${s.nSensory}</span></div>`;
}
function paintFlyLabel(f) {
  const info = f.label?.element.querySelector('.fly-label-info');
  if (!info || !info.classList.contains('open')) return;
  info.innerHTML = flyKvHtml(f);
}
function paintRaceVitals(force = false) {
  const el = $('#raceVitals'); if (!el) return;
  const now = performance.now();
  if (!force && now - (paintRaceVitals.at || 0) < 150) return;
  paintRaceVitals.at = now;
  const key = flies.map(f => `${f.id}:${f.name}:${f.color}`).join('|');
  if (el.dataset.ids !== key) {
    // #region agent log
    if (isWatch) fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'487c3c'},body:JSON.stringify({sessionId:'487c3c',runId:'watch-sel',hypothesisId:'B',location:'arena.js:paintRaceVitals',message:'vitals rebuild',data:{key,prev:el.dataset.ids||null,selected},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    el.dataset.ids = key;
    el.innerHTML = flies.map(f => flyRowHtml(f, selected, true)).join('');
  }
  for (const f of flies) {
    const row = el.querySelector(`.fly[data-id="${f.id}"]`);
    if (!row) continue;
    row.classList.toggle('sel', f.id === selected);
    const s = f.last || {};
    const beh = row.querySelector('.fly-behavior');
    if (beh) beh.textContent = raceMobile() ? vitalsBehaviorLabel(s.behavior) : (s.behavior || '');
    const eBar = row.querySelector('.bar-energy > i');
    if (eBar) eBar.style.width = `${(s.energy ?? 0) * 100}%`;
    const hBar = row.querySelector('.bar-health > i');
    if (hBar) hBar.style.width = `${(s.health ?? 1) * 100}%`;
  }
}
function renderFlyList() {
  $('#nfly').textContent = flies.length;
  $('#flies').innerHTML = flies.map(f => flyRowHtml(f)).join('');
  $('#flies').querySelectorAll('.fly').forEach(el => el.onclick = () => { selected = +el.dataset.id; renderFlyList(); });
  const f = flies.find(x => x.id === selected); $('#selsec').hidden = !f;
  $('#takeoff').textContent = f?.last?.takeoffPending ? (running ? 'Takeoff queued' : 'Takeoff queued · press Run') : 'Activate takeoff DNs';
  $('#takeoff').disabled = !f?.ready || f.last?.flying || f.last?.alive === false;
  if (f?.last) $('#sel').innerHTML = flyKvHtml(f);
  for (const x of flies) paintFlyLabel(x);
  if (isRace) paintRaceVitals(true);
}

// ---------------- brain panel: what the selected fly sees, and its named neuron groups ----------------
const HIST = 150;                    // samples kept per trace (~18 s at the 120 ms poll)
let groups = [], hist = [], histFly = -1, hover = -1, hlShown = -1, hlPts = null, eyeDots = null;
// hovered group's neurons as large points over the inset (small groups vanish among 165k somas otherwise)
function showGroupInInset(j) {
  hlShown = j; hlPts.visible = j >= 0; if (j < 0) return;
  const g = groups[j], src = brainPts.geometry.attributes.position.array, pos = [];
  for (const ix of [g.L, g.R]) for (const i of ix) if (src[i * 3] < 1e5) pos.push(src[i * 3], src[i * 3 + 1], src[i * 3 + 2]);
  hlPts.geometry.dispose(); hlPts.geometry = new THREE.BufferGeometry(); hlPts.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hlPts.material.color.set(g.color);
}
function buildBrainPanel(data) {
  groups = buildGroups(bodymap, meta.types, data.side);
  $('#groups').innerHTML = groups.map((g, j) => `<div class="g" data-j="${j}">
      <span class="name"><i style="background:${g.color}"></i>${g.label} <small>${g.L.length + g.R.length}</small><button class="q" title="what is this?">?</button></span>
      <canvas width="236" height="48"></canvas><span class="v"><b class="l">–</b><b class="r">–</b></span>
      <div class="info" hidden>${g.info}</div></div>`).join('');
  $('#groups').querySelectorAll('.g').forEach(el => {
    const j = +el.dataset.j;
    el.onmouseenter = () => { hover = j; }; el.onmouseleave = () => { hover = -1; };
    el.querySelector('.q').onclick = () => { const i = el.querySelector('.info'); i.hidden = !i.hidden; };
  });
  // eye columns: azimuth/elevation of each column's viewing direction; the front of each eye faces the middle
  const W = 168, H = 116;
  eyeDots = ['L', 'R'].map(sd => flyvisMap.eyes[sd].dirs.map(([x, y, z]) => {
    const az = Math.atan2(y, x) * 180 / Math.PI, el = Math.asin(Math.max(-1, Math.min(1, z))) * 180 / Math.PI;
    return [(sd === 'L' ? 165 - az : 10 - az) / 175 * (W - 8) + 4, (69 - el) / 129 * (H - 8) + 4];
  }));
  $('#brainpanel').hidden = false;
}
function onActivity(f, m) {
  // #region agent log
  fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'487c3c'},body:JSON.stringify({sessionId:'487c3c',runId:'pre-fix',hypothesisId:'D',location:'arena.js:onActivity',message:'paint panel',data:{flyId:f.id,g0:m.groups?.[0],g1:m.groups?.[1],hist0:hist[0]?.[0]?.length??0,eye0:m.eyes?.[0]?.[10]??m.eyes?.[0]?.['10']??null,nGroups:groups.length,cssHide:getComputedStyle(document.querySelector('#groups canvas')||document.body).display},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  if (histFly !== f.id) { histFly = f.id; hist = groups.map(() => [[], []]); $('#bpTitle').innerHTML = `Inside ${f.name} <i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${f.color}"></i>`; }
  const rows = $('#groups').children;
  groups.forEach((g, j) => {
    const h = hist[j]; h[0].push(m.groups[j * 2]); h[1].push(m.groups[j * 2 + 1]); if (h[0].length > HIST) { h[0].shift(); h[1].shift(); }
    const row = rows[j], cv = row.querySelector('canvas'), cx = cv.getContext('2d'), w = cv.width, hh = cv.height;
    const peak = Math.max(5, ...h[0], ...h[1]);
    cx.clearRect(0, 0, w, hh);
    [[h[0], '#6cb6ff'], [h[1], '#ff9f5a']].forEach(([ys, c]) => { cx.strokeStyle = c; cx.lineWidth = 2; cx.beginPath();
      ys.forEach((y, i) => { const px = w - (ys.length - 1 - i) * w / (HIST - 1), py = hh - 3 - y / peak * (hh - 6); i ? cx.lineTo(px, py) : cx.moveTo(px, py); }); cx.stroke(); });
    const fmt = (x) => x >= 100 ? x.toFixed(0) : x.toFixed(1);
    const v = row.querySelector('.v'); v.children[0].textContent = g.L.length ? fmt(m.groups[j * 2]) + ' Hz' : '–'; v.children[1].textContent = g.R.length ? fmt(m.groups[j * 2 + 1]) + ' Hz' : '–';
  });
  if (m.eyes) ['#eyeL', '#eyeR'].forEach((id, s) => {
    const cx = $(id).getContext('2d'), lum = m.eyes[s], dots = eyeDots[s];
    cx.fillStyle = '#05070c'; cx.fillRect(0, 0, 168, 116);
    for (let c = 0; c < dots.length; c++) { const v = Math.round(255 * Math.min(1, lum[c])); cx.fillStyle = `rgb(${v},${v},${v})`; cx.beginPath(); cx.arc(dots[c][0], dots[c][1], 3, 0, 6.2832); cx.fill(); }
  });
}

// ---------------- looming threat: a dark sphere swoops toward the selected fly's head from the front-side ----------------
let threatMesh = null, threatAnim = null;
function launchThreat() {
  const f = flies.find(x => x.id === selected); if (!f?.last) return;
  const p = f.last.pos, yaw = f.last.yaw, a = yaw + 0.6;
  const start = [p[0] + 3.0 * Math.cos(a), p[1] + 3.0 * Math.sin(a), 1.6], end = [p[0] + 0.25 * Math.cos(a), p[1] + 0.25 * Math.sin(a), 0.45];
  if (!threatMesh) { threatMesh = new THREE.Mesh(new THREE.SphereGeometry(0.35, 32, 16), new THREE.MeshStandardMaterial({ color: '#0d0d10', roughness: 0.6 })); threatMesh.castShadow = true; scene.add(threatMesh); }
  threatAnim = { t0: performance.now(), start, end, dur: 700 / speed };
}
function updateThreat() {
  if (!threatAnim) return;
  const u = Math.min(1, (performance.now() - threatAnim.t0) / threatAnim.dur), k = u * u;   // accelerating approach
  const pos = threatAnim.start.map((s, i) => s + (threatAnim.end[i] - s) * k);
  if (u >= 1 && performance.now() - threatAnim.t0 > threatAnim.dur + 600) { threatAnim = null; env.threat = null; threatMesh.visible = false; shadowDirty = true; syncEnv(); return; }
  threatMesh.visible = true; threatMesh.position.set(...pos); env.threat = { x: pos[0], y: pos[1], z: pos[2] };
  for (const fl of flies) if (fl.ready) fl.worker.postMessage({ type: 'env', env: { threat: env.threat } });
}
// ---------------- render loop ----------------
let lastFrame = performance.now(), fpsN = 0, fpsT = 0, lastSim = 0, lastSimReal = performance.now();
const q = new THREE.Quaternion(), previousQ = new THREE.Quaternion(), followDelta = new THREE.Vector3(), brainBase = new THREE.Color();
function updateShadows(now) {
  const extent = Math.min(env.arena.radius + 0.5, Math.max(0.35, camera.position.distanceTo(controls.target) * 0.75));
  const center = controls.target;
  // Quantise camera following to avoid constantly shifting the shadow texels.
  if (Math.abs(extent - shadowExtent) > Math.max(0.04, extent * 0.1) || center.distanceToSquared(shadowCenter) > (extent * 0.06) ** 2) {
    shadowExtent = extent; shadowCenter.copy(center);
    sun.target.position.copy(center); sun.position.copy(center).add(shadowOffset);
    Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent });
    sun.shadow.camera.updateProjectionMatrix(); shadowDirty = true;
  }
  if (shadowDirty && now - lastShadow >= 1000 / 30) {
    renderer.shadowMap.needsUpdate = true; shadowDirty = false; lastShadow = now; metrics.shadowUpdates++;
  }
}
const shadowOffset = new THREE.Vector3(3, 2, 8);
function animate() {
  requestAnimationFrame(animate);
  if (document.hidden) return;
  const now = performance.now(); const dt = Math.min(0.1, (now - lastFrame) / 1000); fpsT += now - lastFrame; lastFrame = now; if (++fpsN === 30) { $('#fps').textContent = (30000 / fpsT).toFixed(0); fpsN = 0; fpsT = 0; }
  for (const f of flies) {
    const s = f.last; if (!s || !f.bodyGroups) continue;
    if (isWatch && f.poseBuf?.length) {
      const sampled = sampleWatchPose(f, now);
      f.poseUpdated = true; shadowDirty = true;
      if (sampled) applyWatchBodies(f, sampled.a, sampled.b, sampled.blend, sampled.extra);
    } else {
    const previous = f.prev, blend = running && previous && s.t>previous.t ? Math.min(1,(now-f.recvAt)/f.poseInterval) : 1;
    f.poseUpdated = f.drawnPose !== s || f.drawnBlend !== blend;
    if (f.poseUpdated) {
      shadowDirty = true;
      for (let b = 1; b < f.bodyGroups.length; b++) { const g = f.bodyGroups[b]; if (!g) continue;
        g.position.set(s.xpos[b * 3], s.xpos[b * 3 + 1], s.xpos[b * 3 + 2]);
        q.set(s.xquat[b * 4 + 1], s.xquat[b * 4 + 2], s.xquat[b * 4 + 3], s.xquat[b * 4]);
        if (blend<1) {
          g.position.x=previous.xpos[b*3]+(g.position.x-previous.xpos[b*3])*blend;
          g.position.y=previous.xpos[b*3+1]+(g.position.y-previous.xpos[b*3+1])*blend;
          g.position.z=previous.xpos[b*3+2]+(g.position.z-previous.xpos[b*3+2])*blend;
          previousQ.set(previous.xquat[b*4+1],previous.xquat[b*4+2],previous.xquat[b*4+3],previous.xquat[b*4]);
          q.slerpQuaternions(previousQ,q,blend);
        }
        g.quaternion.copy(q); g.updateMatrix();
      }
      f.ring.position.set(s.pos[0], s.pos[1], 0.003);
      if (f.label) f.label.position.set(s.pos[0], s.pos[1], s.pos[2] + flyLabelZ(f));
      updateWingBlur(f, s); f.drawnPose = s; f.drawnBlend = blend;
    } else if (f.label && s) {
      f.label.position.set(s.pos[0], s.pos[1], s.pos[2] + flyLabelZ(f));
    }
    }
    const mark = f.id === selected && raceFollow == null;
    f.ring.visible = mark;
    if (f.glow) f.glow.visible = mark;
  }
  const sf = flies.find(x => x.id === selected);
  if (!isRace && sf?.last && $('#follow').checked) { const p = sf.last.pos; followDelta.set(p[0], p[1], p[2]).sub(controls.target).multiplyScalar(0.1); controls.target.add(followDelta); camera.position.add(followDelta); }
  tickRaceCamera(dt);
  if (isRace) {
    for (const f of flies) {
      const p = flyDrawPos(f);
      if (f.label && p) f.label.position.set(p[0], p[1], p[2] + flyLabelZ(f));
    }
  }
  if (isRace && raceStartWall != null && !raceWinner) paintRaceClock(formatWall(now - raceStartWall));
  if (isRace && raceAudio && running && !raceWinner) {
    const s = sf?.last;
    raceAudio.setMotion({ flying: !!s?.flying, walk: s?.flying ? 0 : Math.abs(s?.cmd?.v || 0) });
  }
  if (sf?.last) { const t = sf.last.t / 1000; $('#simt').textContent = t.toFixed(2); if (now - lastSimReal > 1000) { $('#rt').textContent = ((t - lastSim) / ((now - lastSimReal) / 1000)).toFixed(2); lastSim = t; lastSimReal = now; } }
  updateThreat(); controls.update();
  camera.position.z = Math.max(camera.position.z, 0.02);
  camera.updateMatrixWorld();
  pinRaceAnnounce();
  viewFrustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  let largest = 0;
  const projection = innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  for (const f of flies) {
    if (!f.last) continue;
    const p = flyDrawPos(f) || f.last.pos;
    flyBounds.center.fromArray(p);
    viewPoint.fromArray(p).applyMatrix4(camera.matrixWorldInverse);
    const pixels = viewPoint.z < 0 && viewFrustum.intersectsSphere(flyBounds) ? 0.3 * projection / Math.max(0.05, -viewPoint.z) : 0;
    largest = Math.max(largest, pixels);
    const changed = f.setDetail(pixels);
    if (changed) shadowDirty = true;
    batches.update(f, f.poseUpdated, changed);
  }
  batches.finish();
  resolution.update(now, largest > 290);
  if (threatAnim) shadowDirty = true;
  updateShadows(now);
  renderer.info.reset(); const renderStart = performance.now(); composer.render();
  labelRenderer?.render(scene, camera);
  metrics.renderMs = performance.now() - renderStart; metrics.calls = renderer.info.render.calls; metrics.triangles = renderer.info.render.triangles;
  // The trace arrives at ~8 Hz. Upload colours only when the trace, selection or highlight changes.
  // Rotate/draw the inset at 30 Hz independently from the main camera.
  if ($('#brainpanel').hidden || $('#brainpanel').classList.contains('folded') || !brainPts || now - lastBrainDraw < 1000 / 30) return;
  const elapsed = Math.min(0.1, (now - lastBrainDraw) / 1000); lastBrainDraw = now;
  if (brainDirty || brainColorFly !== selected || brainColorHover !== hover) {
    const col = brainPts.geometry.attributes.color, a = col.array;
    brainBase.set(sf?.color || '#888'); const dim = hover >= 0 ? 0.08 : 1;
    for (let i = 0; i < brainAct.length; i++) {
      const v = Math.min(1, brainAct[i] * 1.6);
      a[i * 3] = dim * (0.1 + v * (brainBase.r - 0.1)); a[i * 3 + 1] = dim * (0.11 + v * (brainBase.g - 0.11)); a[i * 3 + 2] = dim * (0.14 + v * (brainBase.b - 0.14));
    }
    col.needsUpdate = true; brainDirty = false; brainColorFly = selected; brainColorHover = hover; metrics.brainUploads++;
  }
  if (hover !== hlShown) showGroupInInset(hover);
  brainPts.rotation.y += elapsed * 0.12; hlPts.rotation.copy(brainPts.rotation); brainRenderer.render(brainScene, brainCam); metrics.brainDraws++;

}
main().catch(e => { if ($('#status')) status('error: ' + e.message); console.error(e); });

// side panels fold to their title bar (chevron button, or the [ and ] keys); the choice persists
function setupFolds() {
  const folds = isRace
    ? [['#brainpanel', '#bpFold', ']', '>', '<', 'brain panel']]
    : [['#panel', '#panelFold', '[', '‹', '›', 'controls'], ['#brainpanel', '#bpFold', ']', '›', '‹', 'brain panel']];
  const apply = ([panel, btn, key, open, shut, what], folded) => {
    $(panel).classList.toggle('folded', folded); const b = $(btn);
    b.textContent = folded ? shut : open; b.title = `${folded ? 'Show' : 'Hide'} ${what} (${key})`; b.setAttribute('aria-expanded', String(!folded));
    try { localStorage.setItem(`fold${panel}`, folded ? '1' : ''); } catch {}
  };
  if (isRace) {
    const f = folds[0];
    setRaceBrainFolded(raceMobile(), { instant: true });
    $(f[1]).onclick = () => setRaceBrainFolded(!$('#brainpanel').classList.contains('folded'), { user: true });
    addEventListener('keydown', e => {
      if (e.target.closest?.('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ']') setRaceBrainFolded(!$('#brainpanel').classList.contains('folded'), { user: true });
    });
    return;
  }
  for (const f of folds) {
    let saved = false; try { saved = localStorage.getItem(`fold${f[0]}`) === '1'; } catch {}
    apply(f, saved);
    $(f[1]).onclick = () => apply(f, !$(f[0]).classList.contains('folded'));
  }
  addEventListener('keydown', e => {
    if (e.target.closest?.('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const f = folds.find(x => x[2] === e.key); if (f) apply(f, !$(f[0]).classList.contains('folded'));
  });
}
