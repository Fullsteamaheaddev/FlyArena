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
import { PRESETS, raceMap, RACE_MAP_IDS } from './sim/world.js';
import { groundAt } from './sim/senses.js';
import { buildDesertScene } from './race-map-desert.js';
import { buildDishScene } from './race-map-dish.js';
import { preloadMapAssets } from './race-map-assets.js';
import { windField, hawkAt } from './race-wind.js';
import { fetchSiteMap, saveSiteMap, normalizeMapId } from './race-map.js';
import { allocBrainMemory, MAX_FLIES } from './brainsetup.js';
import { allocSharedBrain } from './brain-shared.js';
import { parseFlyVis } from './flyvis.js';
import { buildGroups } from './sim/groups.js';
import { createRaceAudio } from './race-audio.js';
import { createRaceChaos, paintChaosScorches, CHAOS_KINDS } from './race-chaos.js';
import { preloadChaosAssets } from './race-chaos-assets.js';
import { preloadSiteAssets } from './preload-site.js';
import { matchRole, isWatchPath, isRaceHostPath, matchUrl, createMatchLink, buildMatchState, packAct, unpackAct, packEyes, unpackEyes } from './match.js';
import { fetchSiteTickerUrl, normalizeTickerHref } from './ticker-url.js';
import {
  DEFAULT_WINDOW, chainConfigured, connectWallet, disconnectWallet, ensureWallet, restoreWallet, switchAccount, onWalletChange, getAccount, readWindow, readPools,
  openRace, lockRace, settleRace, voidRace, placeBet, claimRace, refundRace,
  readBalance, loadHistory, userTotal, userStake, isClaimed, readRace, chipFmt,
  resolveChip, chipSymbol, getChipMeta,
} from './chain.js';
import { t, applyDom, onLocaleChange, getLocale, formatLoadStatus, behaviorLabel, groupLabel, groupInfo } from './i18n.js';
import { mountLangSelect } from './i18n-ui.js';
const BASE = import.meta.env.BASE_URL; // "/" in dev, "/fly-brain/" on GitHub Pages

const $ = s => document.querySelector(s);
function raceLoadProgress(s) {
  if (!isRace) return 0;
  if (s == null) return 0;
  const str = String(s);
  if (str.startsWith('error:')) return 0;
  const mb = str.match(/^(neurons|connectome|skeletons) ([\d.]+) \/ ([\d.]+) MB$/);
  if (mb) {
    const frac = Number(mb[3]) > 0 ? Number(mb[2]) / Number(mb[3]) : 0;
    if (mb[1] === 'neurons') return 4 + 22 * frac;
    if (mb[1] === 'connectome') return 28 + 32 * frac;
    return 60 + 4 * frac;
  }
  if (str === 'decoding neurons') return 26;
  if (str === 'decoding connectome') return 60;
  if (str === 'decoding skeletons') return 64;
  if (str === 'joining…' || str === 'loading…') return 2;
  if (str === 'loading arena') return 18;
  if (str.startsWith('loading Blender body ')) {
    const pct = str.match(/([\d.]+)%/);
    if (pct) return 64 + 16 * (Number(pct[1]) / 100);
    return 72;
  }
  if (str === 'loading body model' || str === 'decoding Blender detail') return 64;
  if (str === 'applying Cycles lighting' || str === 'preparing lighting') return 80;
  if (str.includes('shared memory')) return 84;
  if (str === 'starting shared GPU brain') return 90;
  if (str === 'loading interface') return 96;
  return 8;
}
const status = s => {
  const el = $('#status');
  if (el) {
    el.textContent = formatLoadStatus(s);
    const err = typeof s === 'string' && s.startsWith('error:');
    el.classList.toggle('is-error', err);
  }
  if (!isRace) return;
  const bar = $('#loadBar');
  if (!bar) return;
  const prev = Number(bar.dataset.p || 0);
  const next = Math.max(prev, raceLoadProgress(s));
  bar.dataset.p = String(next);
  bar.style.width = `${next}%`;
};
applyDom();
onLocaleChange(() => relocalizeUi());
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
if (isRace) {
  document.documentElement.classList.add('race');
  document.body.classList.add('race');
}
const chaosTestMode = import.meta.env.DEV && new URLSearchParams(location.search).has('chaosTest');
const env = PRESET.env();
const flies = [];          // {id, worker, group, bodies[], last, color, ready}
let flyvisMap, shared, meta, bodymap, flyXML, gait, visual, batches, outputPass, running = false, selected = 0, tool = 'none', speed = 2, brainMem, wasmModule, brainParams, neuromodCalib;
let raceWinner = null, raceWinnerWhy = null, raceResetTimer = null, raceResetting = false, raceStartWall = null, labelRenderer = null, raceAudio = null, raceSpotRot = 0, raceChaos = null, raceFloorPaintCtx = null;
let matchLink = null, matchId = 0, matchPhase = 'lobby', matchResetIn = null, lastMatchSend = 0, lastActSend = 0, watchBodyNames = null, watchWingPoses = null, lastSentWingPoses = null;
const WATCH_POSE_DELAY = 100, WATCH_POSE_DELAY_MOBILE = 160, WATCH_POSE_EXTRAP = 80, WATCH_POSE_RING = 24;
const WATCH_OFFSET_WINDOW = 2000, WATCH_CUE_STALE_MS = 3000, WATCH_JITTER_CAP = 120;
let hostOffset = 0, hostJitter = 0, hostOffsetSamples = [], pendingCues = [], lastWatchCueId = -1, watchYipeeMatch = null;
let betClosesAt = null, poolSnap = [], lobbyTimer = null, lastPoolRead = 0, chainSettled = false, betFlyId = null, lastLobbyKind = '', lastPoolKey = '', lastLobbyTickSec = null;
let poolStatus = null, poolOpError = null, betWindowSec = DEFAULT_WINDOW, betWindowArmed = false, lobbyStartedAt = 0, resultsAt = 0, settledAt = 0;
let resultActions = { key: '', claim: false, refund: false, note: '' }, profileSeq = 0, profileAcct = null;
const OPEN_GRACE_MS = 25000;     // if the pool never opens (operator offline) the lobby still runs
const SETTLE_GRACE_MS = 45000;   // nor does a stuck settle strand the results card forever
const CLAIM_WINDOW_MS = 6000;    // time to see the payout / Claim once the match is settled
let raceFollow = null, raceCamHome = null, raceCamTween = null, raceAnnounce = null, raceBrainTimer = null, raceBrainTouched = false;
let chaosCamHold = false;
const RACE_PLUME_TOP = 0.20, RACE_CHASE_BACK = 2.6, RACE_CHASE_Z = 1.15;
const ARENA_FLOOR_DECAL_Z = 0.01;
const FLOOR_DECAL_POLYGON_OFFSET = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
const RACE_LABEL_Z = 1.05, RACE_LABEL_Z_CHASE = 0.28;
const RACE_LABEL_Z_MAX = 2.4, RACE_LABEL_CLEAR_PX = 52;
const DEAD_FLY_SCALE_START = 0.1, DEAD_FLY_SCALE_END = 0.3, DEAD_FLY_OVERVIEW_MUL = 1.875, DEAD_FLY_CHASE_SCREEN_MUL = 2, DEAD_FLY_BELOW_LABEL = 0.62, DEAD_FLY_BELOW_LABEL_CHASE = 0.11, DEAD_FLY_CENTER_Y = 0.08, DEAD_FLY_OVERVIEW_Z_LIFT = 0.07, DEAD_FLY_Z_LIFT_PER_SCALE = 0.22, DEAD_FLY_RISE_DUR = 550;
const DEAD_FLY_BLINK_MS = 1250, DEAD_FLY_BLINK_OP_MIN = 0.35, DEAD_FLY_BLINK_SCALE_MIN = 0.92;
const RACE_HISTORY_KEY = 'odorRaceResults';
const RACE_FLIES_KEY = 'odorRaceFlies';
const ENTER_GATE_KEY = 'fruitFlyEntered';
const HOST_SECRET_KEY = 'sugarRunHostSecret';
const TICKER_KEY = 'sugarRunTickerUrl';
let hostSecret = '';
let hostGateResolve = null;
const X_HREF = 'https://x.com/Farmageddon';
const X_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
let lastRaceFliesKey = '';
let watchTickerUrl = null;
let siteTickerUrl = '';
let raceMapId = env.map || 'dish', desertScene = null, dishScene = null, mapSwap = null;
let hostMapChoice = null;

/** Host: lobby pick wins, else dev ?map=, else the site-wide admin choice. */
async function wantedRaceMap() {
  if (chaosTestMode) return 'dish';
  if (hostMapChoice) return hostMapChoice;
  const q = import.meta.env.DEV ? normalizeMapId(new URLSearchParams(location.search).get('map')) : null;
  return q || fetchSiteMap();
}
/** Swap the shared env object in place (workers get it at init; chaos and senses hold the reference). */
async function setRaceEnv(id) {
  id = normalizeMapId(id) || 'dish';
  if (!isRace) return false;
  await preloadMapAssets(BASE, id);
  // PRESETS.race.env() sets map=dish but not render props; do not skip until props are applied.
  if (id === raceMapId && Array.isArray(env.props)) return false;
  const next = raceMap(id).env();
  for (const k of Object.keys(env)) delete env[k];
  Object.assign(env, next);
  raceMapId = id;
  return true;
}
/** Camera range, home view, shadow depth and ambience for the current map. */
function raceOverviewMaxDist() {
  const R = env.arena.radius;
  // desert overview sits at ~1.95 R; R*5 lets people pull back past the walls
  return env.map === 'desert' ? R * 2.3 : R * 5;
}
function applyRaceZoomLimit() {
  if (!controls) return;
  const R = env.arena.radius;
  const max = (isRace && raceFollow == null) ? raceOverviewMaxDist() : R * 5;
  controls.maxDistance = max;
  const dist = camera.position.distanceTo(controls.target);
  if (dist > max && dist > 1e-6) {
    camera.position.lerpVectors(controls.target, camera.position, max / dist);
  }
}
function fitRaceView() {
  const R = env.arena.radius;
  camera.far = Math.max(100, R * 8); camera.updateProjectionMatrix();
  applyRaceZoomLimit();
  sun.shadow.camera.far = Math.max(20, R * 3); sun.shadow.camera.updateProjectionMatrix();
  shadowExtent = 0; shadowDirty = true;
  raceCamHome = { pos: new THREE.Vector3(R * 1.3, 0, R * 1.45), target: new THREE.Vector3(0, 0, 0.1) };
  if (env.map === 'desert') raceAudio?.startAmbience(); else raceAudio?.stopAmbience();
}
/** Watchers follow the host's map: rebuild the scene and let the next snapshot re-add the flies. */
function watchRaceMap(id) {
  if (mapSwap || normalizeMapId(id) === raceMapId) return;
  mapSwap = (async () => {
    if (!(await setRaceEnv(id))) return;
    for (const f of flies) removeFly(f);
    flies.length = 0;
    raceChaos?.reset();
    fitRaceView();
    rebuildEnv();
    snapRaceOverview();
  })().finally(() => { mapSwap = null; });
}

function lobbyMapHtml() {
  const picks = RACE_MAP_IDS.map(id => {
    const on = id === raceMapId ? ' on' : '';
    const busy = mapSwap ? ' disabled' : '';
    return `<button type="button" class="lobby-map-pick${on}" data-map="${id}"${busy}>${t(`map.${id}`)}</button>`;
  }).join('');
  return `<div class="lobby-map" role="group" aria-label="${t('lobby.map')}">
      <span>${t('lobby.map')}</span>
      <div class="lobby-map-picks">${picks}</div>
    </div>`;
}

/** Host lobby: apply the map now (scene + fly spots) and persist for later resets. */
function hostPickRaceMap(id) {
  id = normalizeMapId(id);
  if (!isHost || matchPhase !== 'lobby' || !id || id === raceMapId || mapSwap) return;
  mapSwap = (async () => {
    lastLobbyKind = '';
    paintLobbyOverlay(true);
    hostMapChoice = id;
    try { await saveSiteMap(id); } catch (e) { console.warn('saveSiteMap', e); }
    const kept = flies.slice().sort((a, b) => a.id - b.id).map(f => ({ name: f.name, color: f.color, sex: f.sex }));
    const keepSelected = selected;
    const keepBet = betFlyId;
    for (const f of flies) { f.worker?.postMessage({ type: 'pause' }); removeFly(f); }
    flies.length = 0;
    nextId = 0;
    selected = 0;
    await setRaceEnv(id);
    raceChaos?.reset();
    fitRaceView();
    rebuildEnv();
    snapRaceOverview();
    const spots = raceMap(id).flySpots || [];
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i], ident = kept[i];
      await addFly(s.pos, s.yaw, ident?.sex || s.sex, ident);
    }
    if (keepSelected != null && flies.some(f => f.id === keepSelected)) selected = keepSelected;
    if (keepBet != null) betFlyId = keepBet;
    await waitRacePoses();
    lastLobbyKind = '';
    paintLobbyOverlay(true);
    publishMatchState(true);
  })().catch(e => console.warn('hostPickRaceMap', e)).finally(() => { mapSwap = null; paintLobbyOverlay(true); });
}

function toShared(ta) { const sab = new SharedArrayBuffer(ta.byteLength); const out = new ta.constructor(sab); out.set(ta); return out; }

function fireChaos(kind, extra) {
  if (!raceChaos) { console.warn('[chaos] not ready'); return null; }
  if (isHost && matchPhase === 'lobby') startRace();
  if (chaosTestMode) raceChaos.holdRoulette?.();
  return raceChaos.debugFire(kind, { physics: extra?.physics ?? isHost, ...extra });
}

/** Dev / ?chaosTest: chaos-kill one fly (oof, skull, ragdoll). id = fly id; default selected, else first live. */
function killFly(id) {
  if (!isRace) { console.warn('[killFly] race only'); return null; }
  const live = flies.filter(f => f.worker && f.last?.alive !== false);
  let f = id != null ? flies.find(x => x.id === id) : flies.find(x => x.id === selected);
  if (!f || f.last?.alive === false) f = live[0];
  if (!f?.worker) { console.warn('[killFly] no live fly'); return null; }
  if (isHost && matchPhase === 'lobby') startRace();
  if (chaosTestMode) raceChaos?.holdRoulette?.();
  f.worker.postMessage({ type: 'chaos', op: 'kill' });
  return { id: f.id, name: f.name, color: f.color };
}

function skipChaosLobby() {
  if (!chaosTestMode || !isHost) return false;
  startRace();
  raceChaos?.holdRoulette?.();
  return true;
}

async function loadLocalChaosHarness() {
  if (!chaosTestMode) return;
  window.fireChaos = fireChaos;
  window.killFly = killFly;
  window.previewChaosProp = (kind) => raceChaos?.previewProp?.(kind);
  window.CHAOS_KINDS = CHAOS_KINDS;
  const { mountChaosTestPanel } = await import('./dev/chaos-test-panel.js');
  mountChaosTestPanel();
}

function startRaceAssetLoads() {
  if (!isRace) return { site: Promise.resolve(), chaos: Promise.resolve(), maps: Promise.resolve() };
  return {
    site: preloadSiteAssets(BASE),
    chaos: preloadChaosAssets(THREE, BASE),
    maps: Promise.all(['dish', 'desert'].map(id => preloadMapAssets(BASE, id))),
  };
}

async function waitRaceAssets(loads) {
  if (!isRace) return;
  status('loading interface');
  await Promise.all([loads.site, loads.chaos, loads.maps]);
}

async function main() {
  if (isWatch) return mainWatch();
  if (isRace) document.body.classList.add('race');
  const raceAssets = startRaceAssetLoads();
  if (isHost) await gateHost();
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
  await startSharedBrain();
  flyvisMap = fvm;
  window.__data = data;
  buildBrainPanel(data);
  if (isRace) await setRaceEnv(await wantedRaceMap());
  buildScene(data);
  buildUI();
  await waitRaceAssets(raceAssets);
  if (isRace) {
    setupRaceChrome();
    await raceChaos?.warmup?.(renderer, camera);
  }
  $('#loading').remove();
  await spawnPresetFlies();
  if (isRace) {
    await waitRacePoses();
    if (!skipChaosLobby()) await showRaceStart();
  }
  if (PRESET.autoThreat) setInterval(() => { if (!running || !flies.length) return; const live = flies.filter(f => f.last?.alive !== false); if (!live.length) return; selected = live[Math.floor(Math.random() * live.length)].id; launchThreat(); }, PRESET.autoThreat * 1000);
  window.__arena = { camera, controls, flies, env, THREE, renderer, scene, gtao, composer, metrics, resolution, batches, visual, addFly, rebuildEnv, checkRaceFinish, resetRace, startRaceFollow, stopRaceFollow, announceRace, fireChaos, killFly, startRace, previewChaosProp: (kind) => raceChaos?.previewProp?.(kind), get raceFollow() { return raceFollow; }, get raceAudio() { return raceAudio; }, get raceChaos() { return raceChaos; }, chaosKinds: CHAOS_KINDS };
  await loadLocalChaosHarness();
  animate();
}

async function mainWatch() {
  const raceAssets = startRaceAssetLoads();
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
  await setRaceEnv(await fetchSiteMap());
  buildScene(data);
  buildBrainPanel(data);
  await waitRaceAssets(raceAssets);
  setupRaceChrome();
  await raceChaos?.warmup?.(renderer, camera);
  setupFolds();
  setRaceBrainFolded(true, { instant: true });
  setupWatchBrainPanel();
  $('#loading').remove();
  const profile = $('#profile');
  if (profile) {
    profile.hidden = false;
    setProfileFolded(true, { instant: true });
    syncProfileScrim();
    refreshProfile();
    syncBpHint();
  }
  window.__arena = { camera, controls, flies, env, THREE, renderer, scene, gtao, composer, metrics, resolution, batches, visual, rebuildEnv, startRaceFollow, stopRaceFollow, announceRace, fireChaos, startRace, get raceFollow() { return raceFollow; }, get raceAudio() { return raceAudio; }, get raceChaos() { return raceChaos; }, chaosKinds: CHAOS_KINDS };
  await loadLocalChaosHarness();
  animate();
}

// ---------------- scene ----------------
function raceSpotPlan() {
  const spots = (raceMap(raceMapId).flySpots || []).slice();
  const n = spots.length;
  if (!n) return [];
  const rot = raceSpotRot % n;
  raceSpotRot++;
  const ids = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return Array.from({ length: n }, (_, i) => {
    const s = spots[(i + rot) % n], k = ids[i];
    return { pos: s.pos, yaw: s.yaw, sex: s.sex, name: RACE_NAMES[k], color: FLY_COLORS[k] };
  });
}
async function spawnPresetFlies() {
  const st0 = PRESET.start || [0, 0, 0];
  const flySpots = isRace ? raceMap(raceMapId).flySpots : PRESET.flySpots;
  if (flySpots) {
    if (isRace) {
      for (const s of raceSpotPlan()) await addFly(s.pos, s.yaw, s.sex, { name: s.name, color: s.color });
    } else for (const s of flySpots) await addFly(s.pos, s.yaw, s.sex);
  } else { await addFly([st0[0], st0[1]], st0[2]);
    for (let k = 1; k < (PRESET.flies || 1); k++) { const ang = k * 2.4; await addFly([1.2 * Math.cos(ang), 1.2 * Math.sin(ang)], ang + Math.PI); } }
}
function waitRacePoses() {
  return Promise.all(flies.map(f => f.last ? Promise.resolve() : new Promise(res => { f.onPose = res; })));
}

let renderer, scene, camera, controls, envGroup, chaosCakeGroup, meteorBakeGroup, raycaster, floorMesh, wallMesh, sun, hemiLight, rimLight, composer, gtao, resolution;
let shadowDirty = true, lastShadow = -Infinity, shadowExtent = 0, lastBrainDraw = 0, brainDirty = true;
let brainColorFly = -1, brainColorHover = -2;
const shadowCenter = new THREE.Vector3(Infinity, Infinity, Infinity), viewPoint = new THREE.Vector3();
const viewFrustum = new THREE.Frustum(), viewProjection = new THREE.Matrix4(), flyBounds = new THREE.Sphere(new THREE.Vector3(), 0.24);
const metrics = { calls: 0, triangles: 0, renderMs: 0, shadowUpdates: 0, brainUploads: 0, brainDraws: 0 };
let brainRenderer, brainScene, brainCam, brainPts, brainAct;
let raceFloorLogo = null, raceFloorLogoWait = null, raceFloorPaint = 0;
let raceWallLogo = null, raceWallLogoWait = null;
function raceFloorLogoImg() {
  if (raceFloorLogo) return Promise.resolve(raceFloorLogo);
  if (!raceFloorLogoWait) {
    raceFloorLogoWait = new Promise(res => {
      const img = new Image();
      img.onload = () => { raceFloorLogo = img; res(img); };
      img.onerror = () => res(null);
      img.src = `${BASE}Farmageddoncom.png`;
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
function paintRaceFloor(fx, fs, logo, ticker) {
  const mid = fs / 2;
  const rg = fx.createRadialGradient(mid, mid, 0, mid, mid, mid);
  rg.addColorStop(0, '#8a2fb8'); rg.addColorStop(0.35, '#6b2494'); rg.addColorStop(0.7, '#4a1870'); rg.addColorStop(1, '#2c0d48');
  fx.fillStyle = rg; fx.fillRect(0, 0, fs, fs);
  fx.strokeStyle = 'rgba(210,150,255,0.28)'; fx.lineWidth = fs / 51;
  for (const r of [0.22, 0.42, 0.62, 0.82]) { fx.beginPath(); fx.arc(mid, mid, r * mid, 0, Math.PI * 2); fx.stroke(); }
  if (logo) {
    const dw = fs * 0.3445, dh = dw * (logo.height / logo.width);
    fx.save();
    fx.globalAlpha = 0.5;
    fx.translate(mid, mid);
    fx.rotate(-Math.PI / 2);
    fx.drawImage(logo, -dw / 2, -dh / 2, dw, dh);
    fx.restore();
  }
  if (!ticker) return;
  // Visible vinegar trails at 60°/180°/300°. Decals sit between them on the outer apron (0°/120°/240°).
  const angles = [0, 2 * Math.PI / 3, 4 * Math.PI / 3];
  const dw = fs * 0.18, dh = dw * (ticker.height / ticker.width), rr = 0.82 * mid;
  fx.imageSmoothingEnabled = true;
  fx.imageSmoothingQuality = 'high';
  fx.globalAlpha = 0.5;
  for (const a of angles) {
    fx.save();
    fx.translate(mid + rr * Math.cos(a), mid - rr * Math.sin(a));
    // Tangent to the rim, letter tops outward (readable in a top-down view).
    fx.rotate(-a + Math.PI / 2);
    fx.drawImage(ticker, -dw / 2, -dh / 2, dw, dh);
    fx.restore();
  }
  fx.globalAlpha = 1;
}
function paintRaceFloorFull(fx, fs, logo, ticker) {
  paintRaceFloor(fx, fs, logo, ticker);
  if (isRace && raceChaos) paintChaosScorches(fx, fs, env.arena.radius, raceChaos.getScorches(), performance.now());
}
function repaintRaceFloor() {
  const c = raceFloorPaintCtx;
  if (!c) return;
  if (c.paintBase) {
    c.paintBase();
    if (raceChaos) paintChaosScorches(c.fx, c.fs, env.arena.radius, raceChaos.getScorches(), performance.now());
  } else paintRaceFloorFull(c.fx, c.fs, raceFloorLogo, raceWallLogo);
  c.ft.needsUpdate = true;
}
function paintRaceWall(wx, ww, wh) {
  wx.imageSmoothingEnabled = true;
  wx.imageSmoothingQuality = 'high';
  const vg = wx.createLinearGradient(0, 0, 0, wh);
  vg.addColorStop(0, '#e0b8f0'); vg.addColorStop(1, '#7a3aa8');
  wx.fillStyle = vg; wx.fillRect(0, 0, ww, wh);
  const pastels = ['#f0c8ff', '#d080e8', '#a050c8']; wx.globalAlpha = 0.32;
  for (let k = 0; k < 12; k++) { wx.fillStyle = pastels[k % pastels.length]; wx.fillRect(k * ww / 12, 0, ww / 12 + 1, wh); }
  wx.globalAlpha = 1;
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
  // Race: sit on +X so a rim start points at the camera (0°/120°/240° stays left-right symmetric).
  if (isRace) camera.position.set(R * 1.3, 0, R * 1.45);
  else camera.position.set(-1.2, -1.6, 1.3);
  controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.target.set(0, 0, 0.1);
  controls.minDistance = 0.16; controls.maxDistance = env.arena.radius * 5;
  applyRaceZoomLimit();
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  if (isRace) raceCamHome = { pos: camera.position.clone(), target: controls.target.clone() };
  hemiLight = new THREE.HemisphereLight(isRace ? '#f0d4ff' : '#f4f2ed', isRace ? '#4a2060' : '#514432', 0.22); scene.add(hemiLight);
  sun = new THREE.DirectionalLight(isRace ? '#f0c8ff' : '#fff1da', 2.7); sun.position.set(3, 2, 8); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.00002; sun.shadow.normalBias = 0.0003; sun.shadow.radius = 2;
  const shadowSpan = Math.max(4, R + 0.5);
  Object.assign(sun.shadow.camera, { left: -shadowSpan, right: shadowSpan, top: shadowSpan, bottom: -shadowSpan, near: 0.1, far: Math.max(20, R * 3) }); scene.add(sun, sun.target);
  rimLight = new THREE.DirectionalLight(isRace ? '#e0a8f0' : '#f9e5c4', 0.65); rimLight.position.set(-3, -2, 3); scene.add(rimLight);
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
  envGroup = new THREE.Group(); envGroup.matrixAutoUpdate = true;
  chaosCakeGroup = new THREE.Group(); chaosCakeGroup.name = 'chaosCakes'; chaosCakeGroup.matrixAutoUpdate = true;
  meteorBakeGroup = new THREE.Group(); meteorBakeGroup.name = 'meteorBake'; meteorBakeGroup.matrixAutoUpdate = true;
  envGroup.add(chaosCakeGroup);
  envGroup.add(meteorBakeGroup);
  scene.add(envGroup); rebuildEnv();
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
  syncBrainClear();
  const brainInset = document.querySelector('.brain-inset');
  if (brainInset && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => syncBrainInset()).observe(brainInset);
  }
}
function syncBrainClear() {
  if (!brainRenderer) return;
  const race = document.body.classList.contains('race');
  brainRenderer.setClearColor(race ? 0xfff8ee : 0x000000, race ? 1 : 0);
}
let pd = null;
function discMesh(r, color, opacity = 1, z = ARENA_FLOOR_DECAL_Z) {
  const transparent = opacity < 1;
  const mat = new THREE.MeshStandardMaterial({
    color, transparent, opacity, roughness: 0.8,
    ...(transparent ? { depthWrite: false, ...FLOOR_DECAL_POLYGON_OFFSET } : {}),
  });
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 48), mat);
  m.position.z = z;
  m.receiveShadow = !transparent;
  if (transparent) m.renderOrder = 1;
  return m;
}
function rebuildEnv() {
  // Placement rebuilds own their resources; release old GPU buffers/textures before replacing them.
  if (chaosCakeGroup?.parent === envGroup) envGroup.remove(chaosCakeGroup);
  if (meteorBakeGroup?.parent === envGroup) envGroup.remove(meteorBakeGroup);
  desertScene?.dispose(); desertScene = null;
  dishScene?.dispose(); dishScene = null;
  envGroup.traverse(o => { if (o.isMesh && !o.userData.keep) { o.geometry.dispose(); o.material.map?.dispose(); o.material.dispose(); } });
  envGroup.clear(); shadowDirty = true;
  const R = env.arena.radius, aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  let floorMat, wallMat;
  if (isRace && env.map === 'desert') {
    ++raceFloorPaint;
    desertScene = buildDesertScene(envGroup, env, {
      renderer, scene, sun, hemi: hemiLight, rim: rimLight,
      getLogos: () => ({ logo: raceFloorLogo, ticker: raceWallLogo }),
    });
    floorMesh = desertScene.floor; wallMesh = null;
    raceFloorPaintCtx = desertScene.floorPaint;
    if (!raceFloorLogo) raceFloorLogoImg().then(img => { if (img) repaintRaceFloor(); });
  } else if (isRace && env.map === 'dish') {
    ++raceFloorPaint;
    dishScene = buildDishScene(envGroup, env, {
      renderer, scene, sun, hemi: hemiLight, rim: rimLight,
      getLogos: () => ({ logo: raceFloorLogo, ticker: raceWallLogo }),
    });
    floorMesh = dishScene.floor;
    wallMesh = dishScene.wall;
    raceFloorPaintCtx = dishScene.floorPaint;
    if (!raceFloorLogo) raceFloorLogoImg().then(img => { if (img) repaintRaceFloor(); });
    if (!raceWallLogo) raceWallLogoImg().then(img => { if (img) repaintRaceFloor(); });
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
  if (!desertScene && !dishScene) {
    floorMesh = new THREE.Mesh(new THREE.CircleGeometry(R + 0.1, 96), floorMat);
    floorMesh.receiveShadow = true; floorMesh.userData.laserSurface = 'floor'; envGroup.add(floorMesh);
    wallMesh = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.05, R + 0.05, env.arena.wallHeight, 96, 1, true), wallMat);
    wallMesh.rotation.x = Math.PI / 2; wallMesh.position.z = env.arena.wallHeight / 2; envGroup.add(wallMesh);
  }
  for (const o of env.obstacles) { if (o.collider) continue; const m = new THREE.Mesh(o.type === 'box' ? new THREE.BoxGeometry(o.sx * 2, o.sy * 2, o.sz) : new THREE.CylinderGeometry(o.r, o.r, o.sz, 32), new THREE.MeshStandardMaterial({ color: isRace ? '#6a3d86' : '#3d4a3d', roughness: 0.7 }));
    if (o.type !== 'box') m.rotation.x = Math.PI / 2; else m.rotation.z = o.yaw || 0; m.position.set(o.x, o.y, o.sz / 2); m.castShadow = m.receiveShadow = true; envGroup.add(m); }
  for (const f of env.food) {
    if (f.hiddenDisc) continue;
    const m = discMesh(f.r, '#f2c14e', 0.35 + 0.65 * Math.min(1, f.amount / 5)); m.position.set(f.x, f.y); m.userData.food = f; envGroup.add(m);
  }
  for (const b of env.bitterPatches) { const m = discMesh(b.r, '#4f8fd6', 0.9); m.position.set(b.x, b.y); envGroup.add(m); }
  for (const h of env.hazards) { const m = discMesh(h.r, '#d9502f', 0.9); m.position.set(h.x, h.y); envGroup.add(m); const glow = discMesh(h.r + 0.4, '#d9502f', 0.12, ARENA_FLOOR_DECAL_Z * 0.5); glow.position.set(h.x, h.y); envGroup.add(glow); }
  for (const o of env.odors) {
    if (o.hidden || isRace) continue;
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
  if (chaosCakeGroup) envGroup.add(chaosCakeGroup);
  if (meteorBakeGroup) envGroup.add(meteorBakeGroup);
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
const FLY_BEACON_PERIOD = 2.2, FLY_BEACON_START_SCALE = 0.2, FLY_BEACON_MAX_SCALE = 3.2, FLY_BEACON_PEAK_OPACITY = 0.75;
function createFlyBeacon(color) {
  const group = new THREE.Group();
  group.visible = false;
  const geom = new THREE.RingGeometry(0.42, 0.48, 48);
  const rings = [0, 0.5].map(phaseOffset => {
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: FLY_BEACON_PEAK_OPACITY, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.FrontSide, ...FLOOR_DECAL_POLYGON_OFFSET,
    }));
    mesh.renderOrder = 2;
    mesh.userData.phaseOffset = phaseOffset;
    group.add(mesh);
    return mesh;
  });
  return { group, rings, geom, t: 0 };
}
function tickFlyBeacon(beacon, dt) {
  beacon.t += dt;
  for (const mesh of beacon.rings) {
    const u = ((beacon.t / FLY_BEACON_PERIOD) + mesh.userData.phaseOffset) % 1;
    const fade = u * u;
    const scale = FLY_BEACON_START_SCALE + (FLY_BEACON_MAX_SCALE - FLY_BEACON_START_SCALE) * u;
    mesh.scale.set(scale, scale, 1);
    mesh.material.opacity = (1 - fade) * FLY_BEACON_PEAK_OPACITY;
  }
}
function setFlyBeaconColor(beacon, color) {
  if (!beacon) return;
  for (const mesh of beacon.rings) mesh.material.color.set(color);
}
function disposeFlyBeacon(beacon) {
  if (!beacon) return;
  beacon.group.parent?.remove(beacon.group);
  beacon.geom.dispose();
  for (const mesh of beacon.rings) mesh.material.dispose();
}
function buildFlyMesh(color, sex) {
  const appearance = visual.instantiate(sex);
  if (isRace) {
    const beacon = createFlyBeacon(color);
    envGroup.add(beacon.group);
    return { ...appearance, ring: beacon.group, beacon, glow: null };
  }
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.175, 0.177, 64),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false, ...FLOOR_DECAL_POLYGON_OFFSET }),
  );
  ring.renderOrder = 2;
  envGroup.add(ring);
  return { ...appearance, ring, beacon: null, glow: null };
}

// One instanced draw per wing film across the sampled beat cycle. Poses are thorax-local and immutable.
const blurMaterial = new THREE.MeshStandardMaterial({ color: '#c0c7ce', transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide, roughness: 0.35 });
blurMaterial.forceSinglePass = true;
function buildWingBlur(f, poses) {
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
  if (!f.wingBlur) return;
  for (const w of f.wingBlur) if (w) { w.src.visible = !s.flying; w.blur.visible = !!s.flying; }
}

// ---------------- shared GPU brain ----------------
// One brain worker owns the only WebGPU device and the connectome on the GPU; every fly worker runs its brain
// through a slot there. ?sharedgpu=0 (or any failure) keeps one device per fly worker; ?gpu=0 stays WASM.
let brainWorker = null, sharedBrain = null, attachSeq = 0;
async function startSharedBrain() {
  if (brainParams.gpu === false || !navigator.gpu || new URLSearchParams(location.search).get('sharedgpu') === '0') return;
  status('starting shared GPU brain');
  try {
    sharedBrain = allocSharedBrain(shared.N, MAX_FLIES);
    brainWorker = new Worker(new URL('./sim/brain.worker.js', import.meta.url), { type: 'module' });
    const r = await new Promise(res => {
      brainWorker.onmessage = e => { if (e.data.type === 'ready') res(e.data); };
      brainWorker.onerror = e => res({ ok: false, error: e.message || 'worker error' });
      brainWorker.postMessage({ type: 'init', shared: sharedBrain, memory: brainMem.memory, graph: brainMem.graph, N: shared.N, E: shared.E, opts: brainMem.opts });
    });
    if (!r.ok) throw new Error(r.error);
    console.info('shared GPU brain ready');
  } catch (e) {
    console.warn('shared GPU brain unavailable, one device per fly worker:', e);
    brainWorker?.terminate(); brainWorker = null; sharedBrain = null;
  }
}

// ---------------- flies ----------------
let nextId = 0;
async function addFly(pos, yaw, sex = 'm', ident = null) {
  const cap = PRESET.maxFlies || MAX_FLIES;
  if (flies.length >= cap) { alert(`At most ${cap} flies`); return; }
  const id = nextId++; const color = ident?.color || FLY_COLORS[id % FLY_COLORS.length];
  const worker = new Worker(new URL('./sim/fly.worker.js', import.meta.url), { type: 'module' });
  const seed = isRace ? Math.floor(Math.random() * 1e9) : 0;
  let sharedGpu = null, brainPort = null;
  if (brainWorker && id < MAX_FLIES) {
    const ch = new MessageChannel(), attachId = ++attachSeq;
    brainWorker.postMessage({ type: 'attach', slot: id, seed: 101 + id + seed, attachId, port: ch.port1 }, [ch.port1]);
    sharedGpu = { shared: sharedBrain, attachId }; brainPort = ch.port2;
  }
  const f = { id, worker, color, sex, name: ident?.name || (isRace ? RACE_NAMES[id] || `fly ${id}` : `fly ${id}`), ready: false, last: null, prev: null, stats: {}, ...buildFlyMesh(color, sex) };
  scene.add(f.group); flies.push(f); batches.add(f);
  if (isRace) {
    const el = document.createElement('div'); el.className = 'fly-label'; el.tabIndex = 0; el.style.color = f.color; el.style.setProperty('--fly', f.color);
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
    brainMem: { memory: brainMem.memory, graph: brainMem.graph, bases: brainMem.bases, opts: brainMem.opts, fv: brainMem.fv }, wasmModule, slot: id, flyvisMap, sharedGpu, brainPort,
    ...(isRace ? { burstSteps: 24, burstMs: 24, fenceEvery: 4, seed } : {}) }, brainPort ? [brainPort] : []);
  await new Promise(res => { f.onReady = res; });
  if (running) worker.postMessage({ type: 'run' });
  worker.postMessage({ type: 'speed', speed });
  renderFlyList();
  return f;
}
function removeFly(f) {
  f.worker?.terminate();
  brainWorker?.postMessage({ type: 'detach', slot: f.id });
  batches.remove(f);
  scene.remove(f.group);
  if (f.beacon) disposeFlyBeacon(f.beacon);
  else if (f.ring) {
    f.ring.parent?.remove(f.ring);
    f.ring.geometry.dispose();
    f.ring.material.dispose();
  }
  if (f.label) { scene.remove(f.label); f.label.element.remove(); }
  clearDeadFlyFx(f);
}
function onWorker(f, m) {
  if (m.type === 'ready') {
    f.ready = true; f.backend = m.backend; f.bodyNames = m.bodyNames; f.bodyGroups = m.bodyNames.map(n => f.bodies[n] || null);
    if (m.wingPoses) { f.wingPoses = m.wingPoses; watchWingPoses = m.wingPoses; }
    buildWingBlur(f, m.wingPoses); f.onReady?.();
  }
  else if (m.type === 'pose') {
    // A chaos kick is already the post-impulse pose: easing into it from the pre-impulse one
    // would show the hit a whole pose interval after the FX.
    f.prev = m.chaos ? m : f.last; f.last = m; shadowDirty = true;
    f.onPose?.(); f.onPose = null;
    const received = performance.now(); f.poseInterval = f.recvAt ? Math.max(16, Math.min(100, received-f.recvAt)) : 1000/30; f.recvAt = received;
    m.foodEaten?.forEach((d, k) => { if (d > 0 && env.food[k]) { env.food[k].amount = Math.max(0, env.food[k].amount - d); foodDirty = true; } });
    if (isRace) { checkRaceFinish(f); syncFlyDeathVisual(f); paintFlyLabel(f); paintRaceVitals(); publishMatchState(matchPhase === 'lobby'); cueSelectedTakeoff(f); }
    if (f.id === selected && (f.prev?.takeoffPending !== m.takeoffPending || f.prev?.flying !== m.flying)) renderFlyList();
    broadcastOthers();
  } else if (m.type === 'activity') {
    const accept = f.id === selected && !m.eyesOnly && (f.activityTime !== m.t || histFly !== f.id);
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
  applyDom();
  $('#play').onclick = () => { running = !running; for (const f of flies) f.worker.postMessage({ type: running ? 'run' : 'pause' }); $('#play').textContent = running ? t('panel.pause') : t('panel.run'); };
  $('#addFly').onclick = () => { const a = Math.random() * Math.PI * 2, r = Math.random() * env.arena.radius * 0.6; addFly([r * Math.cos(a), r * Math.sin(a)], Math.random() * Math.PI * 2); };
  $('#addFemale').onclick = () => { const a = Math.random() * Math.PI * 2, r = Math.random() * env.arena.radius * 0.6; addFly([r * Math.cos(a), r * Math.sin(a)], Math.random() * Math.PI * 2, 'f'); };
  $('#speed').oninput = e => { speed = +e.target.value; $('#speedv').textContent = speed.toFixed(2) + '×'; for (const f of flies) f.worker.postMessage({ type: 'speed', speed }); };
  paintPresetSelect();
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
function paintPresetSelect() {
  const el = $('#preset');
  if (!el) return;
  el.innerHTML = Object.entries(PRESETS).map(([k]) => `<option value="${k}" ${k === presetKey ? 'selected' : ''}>${t('preset.' + k)}</option>`).join('');
}
function winWhy(why) {
  return why === 'last' ? t('race.lastRemaining') : why === 'died' ? t('race.lastToDie') : '';
}
function relocalizeUi() {
  applyDom();
  paintPresetSelect();
  const play = $('#play');
  if (play) play.textContent = running ? t('panel.pause') : t('panel.run');
  if (isRace) {
    const capL = $('#eyeL')?.closest('figure')?.querySelector('figcaption');
    const capR = $('#eyeR')?.closest('figure')?.querySelector('figcaption');
    if (capL) capL.textContent = t('brain.left');
    if (capR) capR.textContent = t('brain.right');
    const note = $('#bpBody .note');
    if (note) note.textContent = t('brain.eyesNoteRace');
    paintEnterGateCopy();
    paintEnterToken();
    if (matchPhase === 'lobby') paintLobbyOverlay(true);
    else if (matchPhase === 'results') relocalizeResultsCard();
    else if (isWatch && watchOverlayPhase === 'wait') showWatchWaiting(t('race.wait'));
    refreshProfile();
    raceChaos?.relocalizeToast?.();
    if ($('#hostGate')) paintHostGate();
  }
  if (groups.length) paintGroupRows();
  const sf = flies.find(x => x.id === selected);
  if (sf && (isRace || histFly === sf.id)) setBrainPanelTitle(sf);
  renderFlyList();
  if (isRace) paintRaceVitals(true);
  setupFoldsTitles();
}
function relocalizeResultsCard() {
  const card = $('#raceCard');
  if (!card || card.dataset.kind !== 'results') return;
  const name = card.dataset.winnerName || raceWinner?.name || '';
  const why = card.dataset.why || raceWinnerWhy || '';
  const wall = card.dataset.wall || '';
  const fly = card.dataset.fly || '';
  const color = card.dataset.winnerColor || raceWinner?.color || '';
  const note = winWhy(why);
  card.innerHTML = `<h1>${t('race.wins', { name })}</h1>${note ? `<p class="flyt">${note}</p>` : ''}<p class="win-time">${wall}</p><p class="flyt">${flyTimeLine(fly)}</p>
        ${raceHistoryHtml(loadRaceHistory())}
        <div class="bet-actions"></div>
        <p id="betNote" class="flyt"></p>
        <p id="raceReset">${settleNote()}</p>`;
  card.dataset.kind = 'results';
  card.dataset.winnerName = name;
  card.dataset.why = why;
  card.dataset.wall = wall;
  card.dataset.fly = fly;
  if (color) card.dataset.winnerColor = color;
  paintResultActions(matchId);
}
function paintEnterGateCopy() {
  const el = $('#enterGate');
  if (!el) return;
  const title = el.querySelector('#enterTitle');
  if (title) title.textContent = t('enter.title');
  const p = el.querySelector('.enter-fill p');
  if (p) p.textContent = t('enter.body');
  const btn = el.querySelector('#enterBtn');
  if (btn) btn.setAttribute('aria-label', t('enter.press'));
}
function setupFoldsTitles() {
  if (isRace) {
    brainFoldChrome($('#brainpanel')?.classList.contains('folded'));
    profileFoldChrome($('#profile')?.classList.contains('folded'));
    return;
  }
  for (const [panel, btn, key, open, shut, what] of [
    ['#panel', '#panelFold', '[', '‹', '›', t('brain.controls')],
    ['#brainpanel', '#bpFold', ']', '›', '‹', t('brain.panel')],
  ]) {
    const folded = $(panel)?.classList.contains('folded');
    const b = $(btn); if (!b) continue;
    b.textContent = folded ? shut : open;
    b.title = `${folded ? t('panel.showControls').split(' (')[0] : t('panel.hideControls').split(' (')[0]} ${what} (${key})`;
  }
}
function loadRaceHistory() {
  try { const a = JSON.parse(localStorage.getItem(RACE_HISTORY_KEY) || '[]'); return Array.isArray(a) ? a.slice(0, 1) : []; }
  catch { return []; }
}
function saveRaceResult(row) {
  const rows = [row];
  try { localStorage.setItem(RACE_HISTORY_KEY, JSON.stringify(rows)); } catch {}
  return rows;
}
function raceHistoryHtml(rows) {
  const r = rows?.[0];
  if (!r) return '';
  return `<h2 class="hist">${t('hist.last')}</h2><ol class="race-hist"><li><i style="background:${r.color}"></i><b>${r.name}</b><span>${r.wall}</span></li></ol>`;
}
function setupRaceChrome() {
  document.body.classList.add('race');
  if (isWatch) document.body.classList.add('watch');
  $('#panel').hidden = true;
  $('#raceHud').hidden = false;
  document.title = 'Flies Armageddon';
  $('#follow').checked = false;
  const capL = $('#eyeL')?.closest('figure')?.querySelector('figcaption');
  const capR = $('#eyeR')?.closest('figure')?.querySelector('figcaption');
  if (capL) capL.textContent = t('brain.left');
  if (capR) capR.textContent = t('brain.right');
  const note = $('#bpBody .note');
  if (note) note.textContent = t('brain.eyesNoteRace');
  syncBrainClear();
  requestAnimationFrame(syncBrainInset);
  raceAudio = createRaceAudio(`${BASE}yipee.wav`, `${BASE}gong.wav`, {
    boop: `${BASE}boop.wav`,
    thunder: `${BASE}Thundersound.wav`,
    thumb: `${BASE}thumb.wav`,
    splatter1: `${BASE}splatter1.wav`,
    splatter2: `${BASE}splatter2.wav`,
    laserToast: `${BASE}LaserToast.wav`,
    laserBeam: `${BASE}LaserBeam.wav`,
    laserKill: `${BASE}LaserKill.wav`,
    xfiles: `${BASE}xfiles.wav`,
    haleluja: `${BASE}haleluja.wav`,
    grenadeThrow: `${BASE}Grenade%20throw.wav`,
  });
  if (env.map === 'desert') raceAudio.startAmbience();
  raceChaos = createRaceChaos({
    THREE,
    scene: () => scene,
    envGroup: () => envGroup,
    dishCakeGroup: () => chaosCakeGroup,
    meteorBakeGroup: () => meteorBakeGroup,
    drawnDishSeq,
    camera: () => camera,
    controls: () => controls,
    flies: () => flies,
    env: () => env,
    audio: () => raceAudio,
    syncEnv,
    rebuildEnv,
    repaintFloor: repaintRaceFloor,
    isHostLive: () => isHost && isRace && matchPhase === 'live' && running && !raceWinner,
    onCue: () => publishMatchState(true),
    holdFollow: on => { chaosCamHold = !!on; },
  });
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
        else connectFromUi(connectWallet, e.currentTarget);
      };
      $('#profileDisconnect').onclick = () => clearWalletUi();
      setProfileFolded(true, { instant: true });
      $('#profileFold')?.addEventListener('click', () => setProfileFolded(!profile.classList.contains('folded')));
      $('#profileScrim')?.addEventListener('click', () => setProfileFolded(true));
      mountLangSelect($('#langSelect'));
      restoreWallet().then(a => {
        if (!a) return;
        refreshProfile();
        if (matchPhase === 'lobby' && watchOverlayPhase === 'lobby') paintLobbyOverlay(true);
      });
    }
    showWatchWaiting(t('race.wait'));
    onWalletChange(() => { refreshProfile(); if (matchPhase === 'lobby') paintLobbyOverlay(true); if (matchPhase === 'results') paintResultActions(matchId); });
  }
  if (isWatch || !matchLink) setupMatchLink();
  $('#raceVitals').addEventListener('pointerdown', e => {
    const row = e.target.closest('.fly');
    if (!row) return;
    e.stopPropagation();
    const vitals = $('#raceVitals');
    const beh = e.target.closest('.fly-behavior');
    const dead = row.classList.contains('dead');
    for (const open of vitals.querySelectorAll('.fly-behavior.tip-on, .fly.tip-on')) {
      if (open !== (dead ? row : beh)) open.classList.remove('tip-on');
    }
    if (dead) row.classList.toggle('tip-on');
    else if (beh) beh.classList.toggle('tip-on');
    startRaceFollow(+row.dataset.id);
  });
  $('#raceVitals').addEventListener('pointerleave', () => {
    $('#raceVitals').querySelectorAll('.fly-behavior.tip-on, .fly.tip-on').forEach(n => n.classList.remove('tip-on'));
  });
  setupRaceAnnounce();
  $('#bpHint').onclick = () => setRaceBrainFolded(false, { user: true });
  addEventListener('resize', () => {
    positionBpHint(null, { instant: true });
    syncProfileScrim();
    syncVitalBarWidth($('#raceVitals'));
    brainFoldChrome($('#brainpanel')?.classList.contains('folded'));
  });
  setProfileFolded(true, { instant: true });
  setupWalletPick();
  setupEnterGate();
  resolveChip().then(() => {
    paintEnterToken();
    if (matchPhase === 'lobby' && (!isWatch || watchOverlayPhase === 'lobby')) paintLobbyOverlay(true);
    refreshProfile();
  }).catch(() => {});
}
function shortToken(addr) {
  if (!addr) return '';
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}
function paintEnterToken() {
  const btn = $('#enterToken');
  if (!btn) return;
  const addr = getChipMeta()?.address;
  if (!addr) { btn.hidden = true; return; }
  btn.hidden = false;
  btn.dataset.addr = addr;
  const shown = btn.dataset.copied === '1' ? t('profile.copied') : shortToken(addr);
  btn.textContent = shown;
  btn.title = t('enter.copyToken');
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
  return raceAudio?.unlock().then(() => {
    if (isHost) raceAudio.hold(true);
    else playWatchBed();
  });
}
function flyTimeLine(fly) {
  const n = String(fly ?? '0');
  return t(n === '1' ? 'race.flyTimeOne' : 'race.flyTime', { n });
}
function tickerUrl() {
  const env = String(import.meta.env.VITE_TICKER_URL || '').trim();
  if (env) return normalizeTickerHref(env);
  if (siteTickerUrl) return siteTickerUrl;
  try { return normalizeTickerHref(localStorage.getItem(TICKER_KEY) || ''); } catch { return ''; }
}
function resolvedTickerUrl() {
  const local = tickerUrl();
  if (local) return local;
  if (isWatch && watchTickerUrl) return normalizeTickerHref(watchTickerUrl);
  return '';
}
async function loadSiteTicker() {
  const u = await fetchSiteTickerUrl();
  siteTickerUrl = u;
  if (u) {
    try { localStorage.setItem(TICKER_KEY, u); } catch {}
  }
  paintRaceTicker();
  if (isHost) publishMatchState(true);
}
function paintRaceTicker(href) {
  const a = $('#raceTicker');
  if (!a) return;
  const url = href != null ? normalizeTickerHref(href) : resolvedTickerUrl();
  const live = !!url;
  a.classList.toggle('is-off', !live);
  a.classList.toggle('is-live', live);
  if (live) {
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = 'FLYticker';
  } else {
    a.href = '#';
    a.removeAttribute('target');
    a.removeAttribute('rel');
    a.title = 'Set FLYticker URL in /admin';
  }
}
function onRaceTickerClick(e) {
  const url = resolvedTickerUrl();
  if (!url) {
    e.preventDefault();
    return;
  }
  const a = e.currentTarget;
  if (!a?.href || a.getAttribute('href') === '#') {
    e.preventDefault();
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
function setupRaceSocials() {
  if ($('#raceSocials')) { paintRaceTicker(); return; }
  const nav = document.createElement('nav');
  nav.id = 'raceSocials';
  nav.hidden = true;
  nav.setAttribute('aria-label', 'Flies Armageddon links');
  nav.innerHTML = `<a class="race-social race-social-x" href="${X_HREF}" target="_blank" rel="noopener noreferrer" aria-label="X">${X_SVG}</a>
    <a class="race-social race-social-ticker" id="raceTicker" href="#" aria-label="FLYticker"><img src="${BASE}FLYticker.webp" alt="FLYticker" draggable="false" /></a>`;
  document.body.appendChild(nav);
  if (isWatch) $('#scoreboard header')?.appendChild(nav);
  $('#raceTicker')?.addEventListener('click', onRaceTickerClick);
  paintRaceTicker();
  loadSiteTicker();
  if (!isWatch) {
    addEventListener('storage', e => {
      if (e.key !== TICKER_KEY) return;
      paintRaceTicker();
      publishMatchState(true);
    });
  }
  const refreshTickerOnFocus = () => { loadSiteTicker(); };
  addEventListener('focus', refreshTickerOnFocus);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshTickerOnFocus();
  });
}
function showRaceSocials() {
  if ($('#enterGate')) return;
  const el = $('#raceSocials');
  if (!el) return;
  paintRaceTicker();
  loadSiteTicker();
  if (!el.hidden) return;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('in'));
}
function setupEnterGate() {
  setupRaceSocials();
  let entered = false;
  try { entered = sessionStorage.getItem(ENTER_GATE_KEY) === '1'; } catch {}
  if (entered) { showRaceSocials(); return; }
  const el = document.createElement('div');
  el.id = 'enterGate';
  el.innerHTML = `<div class="enter-card" role="dialog" aria-labelledby="enterTitle" aria-modal="true">
    ${lobbyBrandHtml()}
    <div class="enter-fill">
      <div class="enter-copy">
        <h1 id="enterTitle">${t('enter.title')}</h1>
        <p>${t('enter.body')}</p>
      </div>
      <a class="enter-social enter-social-x" href="${X_HREF}" target="_blank" rel="noopener noreferrer" aria-label="X">${X_SVG}</a>
      <div class="enter-cta">
        <div class="enter-token-slot">
          <button type="button" class="enter-token" id="enterToken" hidden></button>
        </div>
        <div class="enter-actions">
          <button type="button" class="enter-go enter-btn-img" id="enterBtn" aria-label="${t('enter.press')}"></button>
        </div>
      </div>
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
    showRaceSocials();
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
  if (!chainConfigured()) return t('race.next');
  if (poolStatus === 3 || poolStatus === 4) return t('race.settled');
  if (poolOpError) return t('race.opOffline');
  return t('race.settling');
}
function readyForNextRace() {
  if (chaosTestMode) return Date.now() - resultsAt > CLAIM_WINDOW_MS;
  const configured = chainConfigured();
  // A settle that cannot happen is not worth SETTLE_GRACE_MS of staring at the results card.
  if (!configured || (poolOpError && !settledAt)) return Date.now() - resultsAt > CLAIM_WINDOW_MS;
  if (settledAt) return Date.now() - settledAt > CLAIM_WINDOW_MS;
  return Date.now() - resultsAt > SETTLE_GRACE_MS;
}
// The relay is the pool operator; it tells everyone when the race opens, locks or settles.
function applyPoolStatus(p) {
  if (p?.matchId == null || Number(p.matchId) !== Number(matchId)) return;
  const was = poolStatus, wasErr = poolOpError;
  poolStatus = p.status;
  poolOpError = p.opError || null;
  if ((poolStatus === 3 || poolStatus === 4) && !settledAt) settledAt = Date.now();
  if (isHost && (poolStatus === 1 || poolOpError) && matchPhase === 'lobby') armBetWindow();
  if (was === poolStatus && wasErr === poolOpError) return;
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
function readHostSecret() {
  try { return sessionStorage.getItem(HOST_SECRET_KEY) || ''; }
  catch { return ''; }
}
function writeHostSecret(s) {
  hostSecret = s || '';
  try {
    if (hostSecret) sessionStorage.setItem(HOST_SECRET_KEY, hostSecret);
    else sessionStorage.removeItem(HOST_SECRET_KEY);
  } catch { /* private mode */ }
}
function hideHostGate() {
  const el = $('#hostGate');
  if (el) el.remove();
  hostGateResolve = null;
}
function paintHostGate() {
  const el = $('#hostGate');
  if (!el) return;
  const errKey = el.dataset.err || '';
  const taken = errKey === 'host.taken';
  el.innerHTML = `<form class="enter-card" id="hostGateForm" autocomplete="off">
    <h1 id="hostGateTitle">${t('host.title')}</h1>
    <p>${t('host.body')}</p>
    ${taken ? '' : `<input id="hostSecret" type="password" name="password" autocomplete="off" spellcheck="false" required placeholder="${t('host.password')}" aria-label="${t('host.password')}">
    <button type="submit" class="primary" id="hostGateBtn">${t('host.submit')}</button>`}
    <p class="host-error" ${errKey ? '' : 'hidden'}>${errKey ? t(errKey) : ''}</p>
  </form>`;
  const form = $('#hostGateForm');
  const input = $('#hostSecret');
  if (form && !taken) {
    form.onsubmit = e => {
      e.preventDefault();
      const v = input?.value || '';
      if (!v) return;
      writeHostSecret(v);
      const done = hostGateResolve;
      hostGateResolve = null;
      hideHostGate();
      done?.();
    };
  }
  input?.focus();
}
function showHostGate(errKey) {
  if (isRace) document.body.classList.add('race');
  let el = $('#hostGate');
  if (!el) {
    el = document.createElement('div');
    el.id = 'hostGate';
    document.body.appendChild(el);
  }
  el.dataset.err = errKey || '';
  paintHostGate();
  if (errKey === 'host.taken') return Promise.resolve();
  return new Promise(resolve => { hostGateResolve = resolve; });
}
function ensureHostSecret(errKey) {
  if (!isHost) return Promise.resolve();
  if (!errKey) {
    const s = readHostSecret();
    if (s) { hostSecret = s; return Promise.resolve(); }
  }
  return showHostGate(errKey);
}
function onHostLinkStatus(s) {
  if (s === 'live') hideHostGate();
  else if (s === 'host-taken') showHostGate('host.taken');
  else if (s === 'host-auth') {
    writeHostSecret('');
    matchLink?.close();
    matchLink = null;
    ensureHostSecret('host.badSecret').then(() => {
      if (!matchLink) setupMatchLink();
      else matchLink.retry();
    });
  }
}
function waitHostHello() {
  return new Promise(resolve => {
    let finished = false;
    const done = s => { if (finished) return; finished = true; resolve(s); };
    matchLink?.close();
    matchLink = createMatchLink({
      role: 'host',
      secret: () => hostSecret,
      onPool: applyPoolStatus,
      onStatus: s => {
        if (s === 'live') hideHostGate();
        else if (s === 'host-taken') showHostGate('host.taken');
        else if (s === 'host-auth') {
          if (finished) onHostLinkStatus(s);
          done('auth');
          return;
        }
        if (s === 'live') done('ok');
        else if (s === 'host-taken') done('taken');
      },
    });
    setTimeout(() => done('offline'), 8000);
  });
}
async function gateHost() {
  if (!isHost) return;
  if (isRace) document.body.classList.add('race');
  for (;;) {
    await ensureHostSecret();
    const st = await waitHostHello();
    if (st === 'auth') {
      writeHostSecret('');
      matchLink?.close();
      matchLink = null;
      await ensureHostSecret('host.badSecret');
      continue;
    }
    if (st === 'taken') {
      await showHostGate('host.taken');
      return;
    }
    hideHostGate();
    return;
  }
}
function setupMatchLink() {
  if (!isHost && !isWatch) return;
  if (matchLink) return;
  matchLink = createMatchLink({
    role: isHost ? 'host' : 'watch',
    secret: isHost ? () => hostSecret : undefined,
    onState: isWatch ? applyWatchState : undefined,
    onPool: applyPoolStatus,
    onStatus: s => {
      if (isWatch && (s === 'offline' || s === 'host-taken')) showWatchWaiting(t('race.wait'));
      if (isHost) onHostLinkStatus(s);
    },
  });
  pushWatchPrefs();
}
let simRateRef = null, simRate = null;
function sampleSimRate(now) {
  const f = flies.find(x => x.last);
  if (matchPhase !== 'live' || !running || !f) { simRateRef = null; simRate = null; paintSimRate(null); return; }
  if (!simRateRef) { simRateRef = { now, t: f.last.t }; return; }
  if (now - simRateRef.now < 1000) return;
  simRate = { rate: (f.last.t - simRateRef.t) / (now - simRateRef.now), target: speed, backend: f.backend || '' };
  simRateRef = { now, t: f.last.t };
  paintSimRate(simRate);
}
function paintSimRate(r) {
  const el = $('#simRate'); if (!el) return;
  if (isWatch) { el.hidden = true; return; }
  el.hidden = !r;
  if (!r) return;
  el.textContent = r.backend ? t('race.simRateBe', { rate: r.rate.toFixed(2), target: r.target, be: r.backend }) : t('race.simRate', { rate: r.rate.toFixed(2), target: r.target });
  el.classList.toggle('slow', r.rate < 0.5 * r.target);
}
function publishMatchState(force = false) {
  if (!isHost || !matchLink) return;
  paintRaceTicker();
  const now = performance.now();
  sampleSimRate(now);
  if (!force && now - lastMatchSend < 1000 / 30) return;
  lastMatchSend = now;
  const wall = raceStartWall != null ? formatWall(now - raceStartWall) : t('clock.s', { n: 0 });
  const sel = flies.find(f => f.id === selected) || flies[0];
  let act = null;
  if (now - lastActSend > 400 && brainAct) { lastActSend = now; act = packAct(brainAct); }
  const eyes = sel?.lastEyes ? [Array.from(sel.lastEyes[0] || []), Array.from(sel.lastEyes[1] || [])] : null;
  const groups = sel?.lastGroups ? Array.from(sel.lastGroups) : null;
  const visions = flies.filter(f => f.lastEyes || f.lastGroups).map(f => ({
    id: f.id,
    eyes: packEyes(f.lastEyes),
    groups: f.lastGroups ? Array.from(f.lastGroups) : null,
  }));
  matchLink.sendState(buildMatchState({
    matchId, phase: matchPhase, flies,
    clock: { wall, fly: flySecs(), elapsed: raceStartWall != null ? now - raceStartWall : null, sim: simRate },
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
    eyes,
    groups,
    visions,
    act,
    betClosesAt,
    pools: poolSnap,
    tickerUrl: tickerUrl(),
    chaosCue: raceChaos?.getCue?.() || null,
    map: raceMapId,
  }));
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
function lobbyBrandHtml() {
  return `<h1 class="lobby-brand"><img class="lobby-logo" src="${BASE}Flieslogo.png" alt="Flies Armageddon" width="954" height="725" decoding="async"></h1>`;
}
function showWatchWaiting(msg) {
  const card = $('#raceCard');
  lastLobbyKind = '';
  lastPoolKey = '';
  if (card) card.dataset.kind = 'wait';
  card.innerHTML = `${lobbyBrandHtml()}<p class="wait-msg">${msg}</p>`;
  if (watchOverlayPhase !== 'wait') showRaceOverlayCard(card);
  else { const overlay = $('#raceOverlay'); overlay.hidden = false; }
  watchOverlayPhase = 'wait';
  raceAudio?.setMotion({ flying: false, walk: 0 });
  playWatchBed();
}
function applyWatchOverlay(st) {
  setRaceHudLive(st.phase === 'live');
  if (st.phase === 'live') {
    if (watchOverlayPhase !== 'live') setProfileFolded(true, { instant: true });
    const overlay = $('#raceOverlay');
    overlay.classList.remove('show');
    overlay.hidden = true;
    setLobbyBlur(false);
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
      const note = winWhy(w.why);
      card.dataset.kind = 'results';
      card.dataset.winnerName = w.name;
      card.dataset.why = w.why || '';
      card.dataset.wall = st.clock?.wall || '';
      card.dataset.fly = st.clock?.fly || '';
      card.dataset.winnerColor = w.color || '';
      card.innerHTML = `<h1>${t('race.wins', { name: w.name })}</h1>${note ? `<p class="flyt">${note}</p>` : ''}<p class="win-time">${st.clock?.wall || ''}</p><p class="flyt">${flyTimeLine(st.clock?.fly)}</p>
        ${raceHistoryHtml(loadRaceHistory())}
        <div class="bet-actions"></div>
        <p id="betNote" class="flyt"></p>
        <p id="raceReset">${reset}</p>`;
      showRaceOverlayCard(card, { flyColor: w.color });
      paintResultActions(st.matchId);
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
  if (watchOverlayPhase !== 'wait') showWatchWaiting(t('race.wait'));
  watchOverlayPhase = 'wait';
  lastLobbyKind = '';
}
function watchPoseDelay() {
  return raceMobile() ? WATCH_POSE_DELAY_MOBILE : WATCH_POSE_DELAY;
}
function watchRenderAt(now) {
  return now - hostOffset - hostJitter - watchPoseDelay();
}
function pushWatchPose(f, row, recvAt, hostAt) {
  const buf = f.poseBuf || (f.poseBuf = []);
  buf.push({ t: row.t, recvAt, hostAt, xpos: row.xpos, xquat: row.xquat, pos: row.pos, flying: !!row.flying });
  if (buf.length > WATCH_POSE_RING) buf.shift();
}
function sampleWatchPose(f, now) {
  const buf = f.poseBuf;
  if (!buf?.length) return null;
  const renderAt = watchRenderAt(now);
  let i = 0;
  while (i + 1 < buf.length && buf[i + 1].hostAt <= renderAt) i++;
  const a = buf[i], b = buf[i + 1];
  if (b) {
    const span = Math.max(1, b.hostAt - a.hostAt);
    return { a, b, blend: Math.min(1, Math.max(0, (renderAt - a.hostAt) / span)), extra: 0 };
  }
  if (renderAt < a.hostAt) return { a, b: a, blend: 1, extra: 0 };
  const prev = i > 0 ? buf[i - 1] : null;
  return { a: prev || a, b: a, blend: 1, extra: prev ? Math.min(WATCH_POSE_EXTRAP, renderAt - a.hostAt) : 0 };
}
function flyDrawPos(f) { return f.drawPos || f.last?.pos; }
function lerpPosePos(a, b, u) {
  if (!b) return a || null;
  if (!a || u >= 1) return b;
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}
function pinFlyLabel(f, p) {
  if (!f.label || !p) return;
  syncFlySceneLabel(f);
  if (f.label.visible) f.label.position.set(p[0], p[1], p[2] + flyLabelZ(f));
}
function followCamTo(p) {
  followDelta.set(p[0], p[1], p[2]).sub(controls.target);
  controls.target.add(followDelta);
  camera.position.add(followDelta);
}
/** Dish pose the flies currently on screen were standing on. Watchers replay the cue on their own
 *  delayed timeline, so they keep drawing the newest pose (null). */
function drawnDishSeq() {
  if (isWatch) return null;
  const now = performance.now();
  let seq = null;
  for (const f of flies) {
    if (!f.worker || !f.last) continue;
    if (now - (f.recvAt || 0) > 400) continue;   // stalled worker: it must not hold the floor back
    const s = (f.prev ?? f.last).dishSeq || 0;
    if (seq == null || s < seq) seq = s;
  }
  return seq;
}
function applyWatchBodies(f, a, b, blend, extra) {
  const ax = a.xpos, bx = b.xpos, aq = a.xquat, bq = b.xquat;
  if (!bx?.length) return;
  let ex = 0, ey = 0, ez = 0;
  if (extra > 0 && a !== b && a.pos && b.pos) {
    const k = extra / Math.max(1, b.hostAt - a.hostAt);
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
  f.ring.position.set(pos[0], pos[1], ARENA_FLOOR_DECAL_Z);
  pinFlyLabel(f, pos);
  updateWingBlur(f, { flying: u < 0.5 ? a.flying : b.flying });
}
function addVisualFly(row, bodyNames) {
  const f = { id: +row.id, worker: null, color: row.color, sex: row.sex || 'm', name: row.name, ready: true, last: null, prev: null, stats: {}, ...buildFlyMesh(row.color, row.sex || 'm') };
  f.bodyNames = bodyNames;
  f.bodyGroups = bodyNames.map(n => f.bodies[n] || null);
  ensureWingBlur(f);
  scene.add(f.group); flies.push(f); batches.add(f);
  const el = document.createElement('div'); el.className = 'fly-label'; el.tabIndex = 0; el.style.color = f.color; el.style.setProperty('--fly', f.color);
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
  return f;
}
function applyWatchFlyIdent(f, row) {
  if (!row || (f.name === row.name && f.color === row.color)) return;
  f.name = row.name;
  f.color = row.color;
  const el = f.label?.element;
  if (el) {
    el.style.color = f.color;
    el.style.setProperty('--fly', f.color);
    const chip = el.querySelector('.fly-label-chip');
    if (chip) chip.textContent = f.name;
  }
  if (f.beacon) setFlyBeaconColor(f.beacon, f.color);
  else if (f.ring?.material?.color) f.ring.material.color.set(f.color);
}
function noteHostClock(sentAt, recvAt) {
  if (sentAt == null || !Number.isFinite(sentAt)) { hostOffset = 0; hostJitter = 0; return false; }
  const off = recvAt - sentAt;
  hostOffsetSamples.push({ recvAt, off });
  while (hostOffsetSamples.length && recvAt - hostOffsetSamples[0].recvAt > WATCH_OFFSET_WINDOW) hostOffsetSamples.shift();
  const n = hostOffsetSamples.length;
  const v = hostOffsetSamples.map(s => s.off).sort((a, b) => a - b);
  hostOffset = v[0];
  const p90 = v[Math.min(n - 1, Math.max(0, Math.ceil(n * 0.9) - 1))];
  hostJitter = Math.min(WATCH_JITTER_CAP, Math.max(0, p90 - hostOffset));
  return true;
}
function queueWatchCue(c, recvAt, hasHost) {
  if (!c || c.id === lastWatchCueId) return;
  lastWatchCueId = c.id;
  const renderAt = watchRenderAt(recvAt);
  if (c.t != null && hasHost && renderAt - c.t > WATCH_CUE_STALE_MS) return;
  pendingCues.push({ cue: c, hasHost, recvAt });
}
function drainWatchCues(now) {
  if (!pendingCues.length) return;
  const keep = [];
  const renderAt = watchRenderAt(now);
  for (const item of pendingCues) {
    const c = item.cue;
    if (c.t != null && item.hasHost) {
      if (renderAt < c.t) { keep.push(item); continue; }
      if (renderAt - c.t > WATCH_CUE_STALE_MS) continue;
      raceChaos?.playCue(c);
      continue;
    }
    raceChaos?.playCue(c);
  }
  pendingCues = keep;
}
function applyWatchState(st) {
  if (st.map && normalizeMapId(st.map) !== raceMapId) { watchRaceMap(st.map); return; }
  if (mapSwap) return;
  const received = performance.now();
  const hasHost = noteHostClock(st.sentAt, received);
  const wasLive = watchOverlayPhase === 'live';
  const wasLobby = watchOverlayPhase === 'lobby';
  const matchChanged = st.matchId != null && st.matchId !== matchId;
  matchPhase = st.phase || matchPhase;
  if (st.bodyNames) watchBodyNames = st.bodyNames;
  if (st.wingPoses) watchWingPoses = st.wingPoses;
  if (st.matchId != null && st.matchId !== matchId) {
    for (const f of flies) {
      clearDeadFlyFx(f);
      delete f.diedAt;
      syncFlySceneLabel(f);
    }
    matchId = st.matchId;
    poolStatus = null;
    poolOpError = null;
    hostOffsetSamples = [];
    hostOffset = 0;
    hostJitter = 0;
    pendingCues = [];
  }
  betClosesAt = st.betClosesAt ?? null;
  if (st.pools) poolSnap = st.pools;
  if ('tickerUrl' in st) {
    watchTickerUrl = st.tickerUrl || '';
    paintRaceTicker(watchTickerUrl);
  }
  if (st.chaosCue) queueWatchCue(st.chaosCue, received, hasHost);
  if (st.clock) {
    if (!isWatch) paintSimRate(st.phase === 'live' ? st.clock.sim : null);
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
  const hostAt = hasHost ? st.sentAt : received;
  for (const row of st.flies || []) {
    seen.add(row.id);
    let f = flies.find(x => x.id === row.id);
    if (!f && names) f = addVisualFly(row, names);
    else if (f && (f.name !== row.name || f.color !== row.color)) applyWatchFlyIdent(f, row);
    if (f) ensureWingBlur(f);
    if (!f) continue;
    if (f.last && f.last.alive !== false && row.alive === false) onFlyDeath(f, { winnerKnown: !!st.winner });
    f.prev = f.last; f.last = row;
    syncFlyDeathVisual(f);
    cueSelectedTakeoff(f);
    f.poseInterval = f.recvAt ? Math.max(16, Math.min(100, received - f.recvAt)) : 1000 / 30;
    f.recvAt = received;
    if (isWatch) pushWatchPose(f, row, received, hostAt);
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
    if (watchSawRest) announceRace(t('race.go'), null, { gong: true });
    scheduleRaceBrainFold();
    playWatchBed();
  }
  if (wasLive && st.phase !== 'live') raceChaos?.stopLive();
  if (isWatch && isRace && st.phase === 'lobby') {
    pendingCues = [];
    lastWatchCueId = -1;
    for (const f of flies) syncFlyDeathVisual(f);
    if (!wasLobby || matchChanged) {
      raceChaos?.reset();
      snapRaceOverview();
    }
  }
  if (st.phase === 'results' && st.winner && watchOverlayPhase === 'results' && st.matchId !== watchYipeeMatch) {
    watchYipeeMatch = st.matchId;
    announceRace(t('race.wins', { name: st.winner.name }), st.winner.color);
    raceAudio?.setMotion({ flying: false, walk: 0 });
    raceAudio?.playBed('menu');
    raceAudio?.playYipee();
    refreshProfile();
    followRaceWinner(flies.find(x => x.id === st.winner.id));
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
function announceRace(text, color, { gong = false, died = false } = {}) {
  if (!isRace) return;
  if (!raceAnnounce) setupRaceAnnounce();
  if (!raceAnnounce) return;
  const span = raceAnnounce.element.querySelector('.race-announce-text');
  span.textContent = text;
  span.style.color = color || '#fff';
  span.classList.remove('pop');
  void span.offsetWidth;
  span.classList.add('pop');
  if (died) raceChaos?.hideToast?.();
  if (gong) raceAudio?.playGong();
}
const announceNdc = new THREE.Vector3();
function pinRaceAnnounce() {
  if (!raceAnnounce || !camera) return;
  announceNdc.set(0, 0.5, 0.5);
  announceNdc.unproject(camera);
  raceAnnounce.position.copy(announceNdc);
}
function setBrainPanelTitle(fly) {
  if (!fly) return;
  const el = $('#bpTitle');
  if (!el) return;
  let label = el.querySelector('.bp-title-label');
  let dot = el.querySelector('.bp-fly-dot');
  if (!label) {
    el.textContent = '';
    label = document.createElement('span');
    label.className = 'bp-title-label';
    dot = document.createElement('span');
    dot.className = 'bp-fly-dot';
    dot.setAttribute('aria-hidden', 'true');
    el.append(label, dot);
  }
  label.textContent = t('brain.inside', { name: fly.name });
  dot.style.background = fly.color;
}
function brainFoldChrome(folded) {
  const b = $('#bpFold'); if (!b) return;
  b.textContent = folded ? '<' : '>';
  b.title = folded ? t('brain.show') : t('brain.hide');
  b.setAttribute('aria-expanded', String(!folded));
}
function profileFoldChrome(folded) {
  const b = $('#profileFold'); if (!b) return;
  b.textContent = folded ? '<' : '>';
  b.title = folded ? t('profile.show') : t('profile.hide');
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
    && document.body.classList.contains('hud-live')
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
  if (!profile) return;
  profileFoldChrome(folded);
  if (profile.classList.contains('folded') === folded) {
    syncProfileScrim();
    return;
  }
  const dest = peekProfileRect(folded);
  const snap = instant || matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (snap || raceMobile()) {
    profile.classList.remove('profile-anim', 'profile-anim-expand', 'profile-anim-fold');
    profile.style.width = '';
    profile.style.minWidth = '';
    profile.style.transition = '';
    profile.classList.toggle('folded', folded);
    syncProfileScrim();
    followBpHint(dest, { instant: snap });
    return;
  }
  profile.classList.add('profile-anim', folded ? 'profile-anim-fold' : 'profile-anim-expand');
  profile.classList.remove(folded ? 'profile-anim-expand' : 'profile-anim-fold');
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
    profile.classList.remove('profile-anim', 'profile-anim-expand', 'profile-anim-fold');
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
  pushWatchPrefs();
}
function raceMobile() {
  return matchMedia('(max-width: 700px), (max-height: 500px)').matches;
}
function watchBrainPrefs() {
  const folded = !!$('#brainpanel')?.classList.contains('folded');
  return { act: !folded, vision: !(raceMobile() && folded) };
}
function pushWatchPrefs() {
  if (!isWatch || !matchLink?.setPrefs) return;
  matchLink.setPrefs(watchBrainPrefs());
}
function scheduleRaceBrainFold() {
  clearTimeout(raceBrainTimer);
  raceBrainTimer = null;
  if (raceBrainTouched) return;
  setRaceBrainFolded(true, { instant: true });
}
function setLobbyBlur(on) {
  document.body.classList.toggle('lobby-blur', !!(isRace && on && !$('#enterGate') && !$('#loading')));
}
function setRaceHudLive(on) {
  document.body.classList.toggle('hud-live', !!(isRace && on));
  syncBpHint();
}
function hideRaceOverlay() {
  const overlay = $('#raceOverlay');
  if (!overlay) return;
  overlay.classList.remove('show', 'results-panel');
  overlay.hidden = true;
  setLobbyBlur(false);
}
function showRaceOverlayCard(card, { flyColor, enter = true } = {}) {
  const overlay = $('#raceOverlay');
  card.style.removeProperty('--fly');
  if (flyColor) card.style.setProperty('--fly', flyColor);
  overlay.classList.toggle('results-panel', card.dataset.kind === 'results');
  overlay.hidden = false;
  setLobbyBlur(card.dataset.kind === 'lobby');
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
  if (betClosesAt == null) return t('lobby.waitingBets');
  const left = Math.max(0, Math.ceil((betClosesAt - Date.now()) / 1000));
  return t('lobby.betsClose', { m: Math.floor(left / 60), s: String(left % 60).padStart(2, '0') });
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
function shortAddr(a) {
  return a ? a.slice(0, 4) + '...' + a.slice(-4) : t('profile.connect');
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
async function withBusy(btn, fn) {
  if (!btn) return fn();
  if (btn.dataset.busy === '1') return;
  const label = btn.textContent;
  const wasDisabled = btn.disabled;
  btn.dataset.busy = '1';
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.textContent = t('tx.pending');
  try {
    return await fn();
  } finally {
    if (btn.isConnected) {
      delete btn.dataset.busy;
      btn.disabled = wasDisabled;
      btn.removeAttribute('aria-busy');
      if (btn.textContent === t('tx.pending')) btn.textContent = label;
    }
  }
}
async function connectFromUi(fn = connectWallet, btn) {
  if (!window.ethereum && needsMobileWalletPick()) {
    showWalletPick();
    return;
  }
  return withBusy(btn, async () => {
    const note = $('#betNote') || $('#profileNote');
    try {
      if (note) note.textContent = t('profile.checkWallet');
      await fn();
      if (note) note.textContent = '';
      if (matchPhase === 'lobby') paintLobbyOverlay(true);
      if (matchPhase === 'results') paintResultActions(matchId);
      await refreshProfile();
    } catch (e) {
      if (note) note.textContent = e.shortMessage || e.message || String(e);
    }
  });
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
  refreshProfile();
  if (matchPhase === 'lobby') paintLobbyOverlay(true);
  if (matchPhase === 'results') paintResultActions(matchId);
}
function injectResultActions(id) {
  const host = $('#raceCard .bet-actions');
  if (!host) return;
  if (resultActions.key.split(':')[0] !== String(id)) { host.innerHTML = ''; return; }
  host.innerHTML = (resultActions.claim ? `<button id="betClaim" class="primary" type="button">${t('ticket.claim')}</button>` : '')
    + (resultActions.refund ? `<button id="betRefund" type="button">${t('ticket.refund')}</button>` : '');
  const claim = host.querySelector('#betClaim');
  if (claim) claim.onclick = () => runBetTx(() => claimRace(id), claim);
  const refund = host.querySelector('#betRefund');
  if (refund) refund.onclick = () => runBetTx(() => refundRace(id), refund);
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
    const note = claim ? t('race.claimNote') : (refund ? t('race.refundNote') : '');
    resultActions = { key, claim, refund, note };
  }
  injectResultActions(id);
}
function selectBetFly(id, card = $('#raceCard')) {
  id = +id;
  if (betFlyId !== id) raceAudio?.playSelect(id);
  betFlyId = id;
  card?.querySelectorAll('.bet-fly').forEach(b => b.classList.toggle('on', +b.dataset.fly === id));
}
function wireLobbyCard(card) {
  card.querySelectorAll('.bet-fly').forEach(b => {
    b.onclick = () => selectBetFly(+b.dataset.fly, card);
  });
  card.querySelectorAll('.lobby-map-pick').forEach(b => {
    b.onclick = () => hostPickRaceMap(b.dataset.map);
  });
  const connect = card.querySelector('#betConnect');
  if (connect) connect.onclick = () => connectFromUi(switchAccount, connect);
  const disc = card.querySelector('#betDisconnect');
  if (disc) disc.onclick = () => clearWalletUi();
  const bet = card.querySelector('#betPlace');
  if (bet) {
    if (!getAccount()) bet.onclick = () => connectFromUi(connectWallet, bet);
    else bet.onclick = () => runBetTx(async () => {
      const amt = +card.querySelector('#betAmt')?.value || 10;
      const fly = betFlyId ?? flies[0]?.id;
      if (fly == null) throw new Error(t('lobby.pickError'));
      await placeBet(matchId, fly, amt);
      lastPoolRead = 0; await refreshPoolSnap(); paintLobbyOverlay(); await refreshProfile();
    }, bet);
  }
}
async function runBetTx(fn, btn) {
  return withBusy(btn, async () => {
    const note = $('#betNote') || $('#profileNote');
    try {
      await ensureWallet();
      if (note) note.textContent = t('lobby.confirm');
      await fn();
      if (note) note.textContent = t('lobby.done');
      await refreshProfile();
    } catch (e) {
      if (note) note.textContent = e.shortMessage || e.message || String(e);
    }
  });
}
function ticketStatus(r) {
  if (r.outcome === 'unclaimed') return { label: t('ticket.won'), kind: 'won' };
  if (r.outcome === 'won') return { label: t('ticket.claimed'), kind: 'claimed' };
  if (r.outcome === 'void') return { label: t('ticket.void'), kind: 'void' };
  if (r.outcome === 'refunded') return { label: t('ticket.refunded'), kind: 'refunded' };
  if (r.outcome === 'open') return { label: t('ticket.open'), kind: 'open' };
  if (r.outcome === 'lost') return { label: t('ticket.lost'), kind: 'lost' };
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
  if (connect && !(connect.getAttribute('aria-busy') === 'true' && !acct)) {
    connect.textContent = connect.dataset.copied === '1' ? t('profile.copied') : shortAddr(acct);
    connect.title = acct ? t('profile.copyAddr') : t('profile.connectWallet');
    connect.classList.toggle('connect-btn', !acct);
  }
  if (disc) disc.hidden = !acct;
  syncBpHint();
  const bal = $('#profileBal'), list = $('#profileTickets');
  if (!chainConfigured()) {
    if (bal) bal.textContent = t('profile.poolMissing');
    if (list) list.innerHTML = '';
    return;
  }
  if (!acct) {
    profileAcct = null;
    if (bal) bal.textContent = t('profile.connectHint');
    if (list) list.innerHTML = '';
    return;
  }
  if (acct !== profileAcct) {          // a switch must not leave the old wallet's tickets on screen
    profileAcct = acct;
    if (bal) bal.textContent = t('profile.loading');
    if (list) list.innerHTML = `<li>${t('profile.loading')}</li>`;
  }
  try {
    const [chips, hist, stake] = await Promise.all([
      readBalance(acct),
      loadHistory(acct),
      matchId ? userTotal(matchId, acct) : 0n,
    ]);
    if (seq !== profileSeq) return;    // a newer refresh already owns the panel
    if (bal) bal.textContent = `${Number(chips).toFixed(1)} ${chipSymbol()}` + (stake && stake > 0n ? t('profile.thisRace', { n: Number(chipFmt(stake)).toFixed(1) }) : '');
    if (list) {
      list.innerHTML = hist.slice(0, 8).map(r => {
        const st = ticketStatus(r);
        const act = r.outcome === 'unclaimed' ? `<button type="button" class="tk-claim" data-claim="${r.matchId}">${t('ticket.claim')}</button>`
          : (r.outcome === 'void' ? `<button type="button" class="tk-refund" data-refund="${r.matchId}">${t('ticket.refund')}</button>` : '');
        const win = r.payout != null && Number(r.payout) > 0 && r.outcome !== 'lost' ? ` +${Number(r.payout).toFixed(1)}` : '';
        return `<li><b>${matchWhen(r.matchId)}</b>${flyTag(r.flyId, r.matchId)}<span class="tk-amt">${Number(r.amount).toFixed(1)}</span><i class="tk-status tk-${st.kind}">${st.label}${win}</i><span class="tk-act">${act}</span></li>`;
      }).join('') || `<li>${t('profile.noTickets')}</li>`;
      list.querySelectorAll('[data-claim]').forEach(b => { b.onclick = () => runBetTx(() => claimRace(+b.dataset.claim), b); });
      list.querySelectorAll('[data-refund]').forEach(b => { b.onclick = () => runBetTx(() => refundRace(+b.dataset.refund), b); });
    }
  } catch (e) {
    if (seq !== profileSeq) return;
    if (bal) bal.textContent = e.shortMessage || e.message || String(e);
  }
}
function paintLobbyOverlay(force = false) {
  if (chaosTestMode || matchPhase !== 'lobby') return;
  const card = $('#raceCard');
  if (!card) return;
  const clock = lobbyClockLabel();
  const acct = getAccount();
  const kind = `${isWatch ? 'w' : 'h'}:${matchId}:${acct || '0'}:${poolStatus}:${raceMapId}:${flies.map(f => f.id).join(',')}`;
  const skip = !force && card.dataset.kind === 'lobby' && lastLobbyKind === kind && card.querySelector('#lobbyClock');
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
    setLobbyBlur(true);
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
    const open = !chainConfigured() || poolStatus === 1 || (poolStatus == null && betClosesAt != null && !poolOpError);
    const note = !chainConfigured() ? t('lobby.poolMissing')
      : poolOpError && poolStatus !== 1 ? t('lobby.opOffline')
      : !acct ? t('lobby.connectWallet')
      : (open ? t('lobby.pickFly') : t('lobby.opening'));
    card.innerHTML = `${lobbyBrandHtml()}<p>${t('lobby.blurb')}</p>
      <p class="sub" id="lobbyClock">${clock}</p>
      ${poolRowsHtml()}
      <div class="bet-stake">
        <div class="bet-stake-row"><input id="betAmt" type="number" min="1" value="10"><span>${chipSymbol()}</span>
          <button id="betPlace" class="${acct ? 'primary' : 'connect-btn'}" type="button"${acct && !open ? ' disabled' : ''}>${acct ? t('lobby.bet') : t('profile.connect')}</button></div>
      </div>
      ${acct ? `<div class="bet-wallet">
        <button id="betConnect" type="button">${shortAddr(acct)}</button>
        <button id="betDisconnect" class="danger" type="button">${t('profile.disconnect')}</button>
      </div>` : ''}
      <p id="betNote" class="flyt">${note}</p>`;
  } else {
    card.innerHTML = `${lobbyBrandHtml()}<p>${t('lobby.blurb')}</p>
      <p class="sub" id="lobbyClock">${clock}</p>
      <p class="flyt">${t('lobby.autoStart')}</p>
      ${lobbyMapHtml()}
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
  paintLobbyOverlay(true);
  publishMatchState(true);
}
async function tickLobby() {
  if (matchPhase !== 'lobby' || mapSwap) return;
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
  snapRaceOverview();
  matchPhase = 'lobby';
  matchResetIn = null;
  raceWinner = null;
  chainSettled = false;
  matchId = Date.now();
  lastLobbyKind = '';
  betFlyId = null;
  poolStatus = null;
  poolOpError = null;
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
  setRaceHudLive(false);
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
  raceChaos?.reset();
  if (chaosTestMode) {
    hideRaceOverlay();
    if (isHost) {
      startRace();
      raceChaos?.holdRoulette?.();
    }
  }
}
function formatWall(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s >= 60) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return t('clock.s', { n: s });
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
  hideRaceOverlay();
  setProfileFolded(true, { instant: true });
  setRaceHudLive(true);
  raceStartWall = performance.now();
  paintRaceClock(t('clock.s', { n: 0 }));
  running = true;
  matchPhase = 'live';
  matchResetIn = null;
  clearInterval(lobbyTimer); lobbyTimer = null;
  raceAudio?.unlock().then(() => raceAudio?.playBed('race'));
  for (const f of flies) f.worker?.postMessage({ type: 'run' });
  announceRace(t('race.go'), null, { gong: true });
  scheduleRaceBrainFold();
  raceChaos?.arm();
  publishMatchState(true);
}
function announceRaceWinner(f, why) {
  if (!running || raceWinner || raceResetting) return;
  raceWinner = f;
  raceWinnerWhy = why || null;
  matchPhase = 'results';
  setRaceHudLive(false);
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
  announceRace(t('race.wins', { name: f.name }), f.color);
  raceChaos?.stopLive();
  followRaceWinner(f);
  clearTimeout(raceBrainTimer); raceBrainTimer = null;
  const card = $('#raceCard');
  card.dataset.kind = 'results';
  const note = winWhy(why);
  card.dataset.kind = 'results';
  card.dataset.winnerName = f.name;
  card.dataset.why = why || '';
  card.dataset.wall = wall;
  card.dataset.fly = fly;
  card.dataset.winnerColor = f.color || '';
  card.innerHTML = `<h1>${t('race.wins', { name: f.name })}</h1>${note ? `<p class="flyt">${note}</p>` : ''}<p class="win-time">${wall}</p><p class="flyt">${flyTimeLine(fly)}</p>${raceHistoryHtml(hist)}<p id="raceReset">${settleNote()}</p>`;
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
    resetRace();
  }, 1000);
}
let deadFlyMap = null;
function ensureDeadFlyMap() {
  if (deadFlyMap) return deadFlyMap;
  deadFlyMap = new THREE.TextureLoader().load(`${BASE}deadfly.png`, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    const aniso = renderer?.capabilities?.getMaxAnisotropy?.() ?? 1;
    if (aniso > 1) tex.anisotropy = aniso;
  });
  deadFlyMap.colorSpace = THREE.SRGBColorSpace;
  return deadFlyMap;
}
function easeOutCubic(t) { return 1 - (1 - t) ** 3; }
function deadFlyBlinkWave(now) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return { op: 1, scale: 1 };
  const u = (now % DEAD_FLY_BLINK_MS) / DEAD_FLY_BLINK_MS;
  const wave = 0.5 + 0.5 * Math.cos(u * Math.PI * 2);
  return {
    op: DEAD_FLY_BLINK_OP_MIN + (1 - DEAD_FLY_BLINK_OP_MIN) * wave,
    scale: DEAD_FLY_BLINK_SCALE_MIN + (1 - DEAD_FLY_BLINK_SCALE_MIN) * wave,
  };
}
function deadFlySpriteScale(s) {
  const tex = ensureDeadFlyMap();
  const img = tex.image;
  const aspect = img?.width && img?.height ? img.width / img.height : 1;
  return aspect >= 1 ? new THREE.Vector2(s * aspect, s) : new THREE.Vector2(s, s / aspect);
}
function raceLabelFollowK(f) {
  let k = 0;
  if (raceFollow != null && f.id == raceFollow) {
    k = raceCamTween?.mode === 'in' ? Math.min(1, raceCamTween.t) : raceCamTween?.mode === 'out' ? 0 : 1;
  } else if (raceCamTween?.mode === 'out' && raceCamTween.wasFollow == f.id) {
    k = 1 - Math.min(1, raceCamTween.t);
  }
  return k;
}
function deadFlyLayoutK(f) {
  return raceLabelFollowK(f);
}
const deadFlyScalePos = new THREE.Vector3();
/** Chase cam is nearer — scale by d/d₀ so DEAD_FLY_CHASE_SCREEN_MUL changes on-screen size. */
function deadFlyTargetEndScale(f, anchor, z) {
  const k = deadFlyLayoutK(f);
  const overviewEnd = DEAD_FLY_SCALE_END * DEAD_FLY_OVERVIEW_MUL;
  if (k <= 0) return overviewEnd;
  let dRatio = 1;
  if (raceCamHome) {
    deadFlyScalePos.set(anchor[0], anchor[1], z);
    const d = camera.position.distanceTo(deadFlyScalePos);
    const d0 = raceCamHome.pos.distanceTo(deadFlyScalePos);
    if (d0 > 1e-5) dRatio = d / d0;
  }
  const chaseWorld = DEAD_FLY_SCALE_END * DEAD_FLY_CHASE_SCREEN_MUL * dRatio;
  return overviewEnd + (chaseWorld - overviewEnd) * k;
}
function deadFlyRestZ(anchor, f, scale) {
  const k = deadFlyLayoutK(f);
  const riseAboveAnchor = scale * (0.5 - DEAD_FLY_CENTER_Y);
  const z0 = env.map === 'desert' ? RACE_LABEL_Z * 1.15 : RACE_LABEL_Z;
  const labelZ = anchor[2] + (z0 + (RACE_LABEL_Z_CHASE - z0) * k);
  const below = DEAD_FLY_BELOW_LABEL + (DEAD_FLY_BELOW_LABEL_CHASE - DEAD_FLY_BELOW_LABEL) * k;
  const overview = 1 - k;
  const scaleExcess = Math.max(0, scale - DEAD_FLY_SCALE_END);
  const lift = overview * DEAD_FLY_OVERVIEW_Z_LIFT + overview * scaleExcess * DEAD_FLY_Z_LIFT_PER_SCALE;
  return labelZ - below - riseAboveAnchor + lift;
}
function clearDeadFlyFx(f) {
  if (!f?.deathFx) return;
  scene.remove(f.deathFx.sprite);
  f.deathFx.sprite.material.dispose();
  f.deathFx = null;
}
function spawnDeadFlySprite(f) {
  if (!isRace || f.deathFx) return;
  const mat = new THREE.SpriteMaterial({ map: ensureDeadFlyMap(), transparent: true, depthWrite: false, opacity: 0 });
  const sprite = new THREE.Sprite(mat);
  sprite.center.set(0.5, DEAD_FLY_CENTER_Y);
  sprite.scale.copy(deadFlySpriteScale(DEAD_FLY_SCALE_START));
  scene.add(sprite);
  const p = f.last?.pos || [0, 0, 0.13];
  const zStart = p[2] - 0.12;
  sprite.position.set(p[0], p[1], zStart);
  f.deathFx = { sprite, t0: performance.now(), riseDur: DEAD_FLY_RISE_DUR, zStart };
}
function updateDeadFlySprites(now) {
  for (const f of flies) {
    if (!isRaceFlyDead(f)) {
      syncFlyDeathVisual(f);
      continue;
    }
    const fx = f.deathFx;
    if (!fx) continue;
    const anchor = flyDrawPos(f) || f.last?.pos;
    if (!anchor) continue;
    const u = Math.min(1, (now - fx.t0) / fx.riseDur);
    const ease = easeOutCubic(u);
    let zEnd = deadFlyRestZ(anchor, f, DEAD_FLY_SCALE_END);
    let z = fx.zStart + (zEnd - fx.zStart) * ease;
    const endScale = deadFlyTargetEndScale(f, anchor, z);
    const scale = DEAD_FLY_SCALE_START + (endScale - DEAD_FLY_SCALE_START) * ease;
    zEnd = deadFlyRestZ(anchor, f, scale);
    z = fx.zStart + (zEnd - fx.zStart) * ease;
    const blink = deadFlyBlinkWave(now);
    fx.sprite.position.set(anchor[0], anchor[1], z);
    fx.sprite.scale.copy(deadFlySpriteScale(scale * blink.scale));
    fx.sprite.material.opacity = 0.95 * ease * blink.op;
    fx.sprite.quaternion.copy(camera.quaternion);
  }
}
function isRaceFlyDead(f) {
  return isRace && f.last?.alive === false;
}
function syncFlySceneLabel(f) {
  if (!f.label) return;
  f.label.visible = !isRaceFlyDead(f);
}
function syncFlyDeathVisual(f) {
  if (isRaceFlyDead(f)) return;
  if (f.deathFx || f.diedAt) {
    clearDeadFlyFx(f);
    delete f.diedAt;
  }
  syncFlySceneLabel(f);
}
function onFlyDeath(f, { winnerKnown = false } = {}) {
  if (!isRace || !f || f.diedAt) return;
  f.diedAt = performance.now();
  if (!winnerKnown) raceAudio?.playOof();
  if (!isWatch && !raceWinner) announceRace(t('race.died', { name: f.name }), f.color, { died: true });
  spawnDeadFlySprite(f);
  syncFlySceneLabel(f);
  paintRaceVitals(true);
}
function checkRaceFinish(f) {
  if (f?.last?.alive === false && !f.diedAt && isRace && running && !raceResetting) {
    onFlyDeath(f, { winnerKnown: !!raceWinner });
  }
  if (!running || raceWinner || raceResetting) return;
  const food = env.food[0], p = f?.last?.pos;
  const winR = food?.winR ?? food?.r;
  if (food && p && f.last.alive !== false && !f.last.flying && p[2] < 0.22
      && Math.hypot(p[0] - food.x, p[1] - food.y) < winR) {
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
function restoreRaceFood() {
  if (env.food[0]) env.food[0].amount = 8;
  if (env.food.length > 1) env.food.length = 1;
  if (env.odors) env.odors = env.odors.filter(o => !o.chaosCake);
  env.threat = null;
  envGroup?.children.forEach(m => { if (m.userData.food) m.material.opacity = 0.35 + 0.65 * Math.min(1, m.userData.food.amount / 5); });
}
function recycleRaceFlies() {
  const plan = raceSpotPlan();
  const ordered = flies.slice().sort((a, b) => a.id - b.id);
  if (plan.length !== ordered.length || ordered.some(f => !f.worker)) return false;
  for (let i = 0; i < ordered.length; i++) {
    const f = ordered[i], s = plan[i];
    applyWatchFlyIdent(f, s);
    clearDeadFlyFx(f);
    delete f.diedAt;
    f.last = null; f.prev = null;
    syncFlySceneLabel(f);
    f.worker.postMessage({ type: 'pause' });
    f.worker.postMessage({ type: 'respawn', pos: s.pos, yaw: s.yaw });
  }
  return true;
}
async function resetRace() {
  if (raceResetting) return;
  raceResetting = true;
  if (chaosTestMode) hideRaceOverlay();
  clearInterval(raceResetTimer); raceResetTimer = null;
  clearTimeout(raceBrainTimer); raceBrainTimer = null;
  running = false; raceWinner = null; raceWinnerWhy = null; raceStartWall = null;
  raceChaos?.reset();
  const clock = $('#raceClock'); if (clock) clock.hidden = true;
  if (raceAnnounce) { raceAnnounce.element.querySelector('.race-announce-text')?.classList.remove('pop'); }
  if (!raceBrainTouched) setRaceBrainFolded(true, { instant: true });
  snapRaceOverview();
  restoreRaceFood();
  const mapChanged = isHost && await setRaceEnv(await wantedRaceMap());
  const spots = isRace ? raceMap(raceMapId).flySpots : null;
  const canRecycle = !mapChanged && spots && flies.length === spots.length && flies.every(f => f.worker);
  if (!canRecycle) {
    for (const f of flies) { f.worker?.postMessage({ type: 'pause' }); removeFly(f); }
    flies.length = 0; nextId = 0; selected = 0;
    if (mapChanged) fitRaceView();
    rebuildEnv();
    await spawnPresetFlies();
  } else {
    selected = 0;
    syncEnv();
    recycleRaceFlies();
    renderFlyList();
  }
  await waitRacePoses();
  if (!skipChaosLobby()) await showRaceStart();
  raceResetting = false;
}
function easeOutBack(t, s = 1.7) { const u = t - 1; return u * u * ((s + 1) * u + s) + 1; }
function easeInBack(t, s = 1.7) { return t * t * ((s + 1) * t - s); }
function flyLabelZ(f) {
  const k = raceLabelFollowK(f);
  const z0 = env.map === 'desert' ? RACE_LABEL_Z * 1.15 : RACE_LABEL_Z;
  let z = z0 + (RACE_LABEL_Z_CHASE - z0) * k;
  if (raceMobile() && raceFollow == null) z *= 1.1;
  // CSS2D chips stay a fixed pixel size, so a constant world offset covers the fly when zoomed out.
  // Lift with distance, then cap so overview tags don't float up to the top of the frame.
  if (camera && k < 0.999) {
    const p = flyDrawPos(f) || f.last?.pos;
    if (p) {
      deadFlyScalePos.set(p[0], p[1], p[2]);
      const dist = camera.position.distanceTo(deadFlyScalePos);
      const worldPerPx = dist * 2 * Math.tan((camera.fov * Math.PI) / 360) / Math.max(1, innerHeight);
      const lift = RACE_LABEL_CLEAR_PX * worldPerPx;
      const zMax = env.map === 'desert' ? RACE_LABEL_Z_MAX * 1.15 : RACE_LABEL_Z_MAX;
      const zoomZ = Math.min(zMax, Math.max(z, lift));
      z += (zoomZ - z) * (1 - k);
    }
  }
  return z;
}
function chaseCam(f, outPos, outTarget) {
  const p = flyDrawPos(f) || f.last.pos, yaw = f.last.yaw || 0;
  outTarget.set(p[0], p[1], p[2]);
  outPos.set(p[0] - Math.cos(yaw) * RACE_CHASE_BACK, p[1] - Math.sin(yaw) * RACE_CHASE_BACK, p[2] + RACE_CHASE_Z);
}
const chasePos = new THREE.Vector3(), chaseTarget = new THREE.Vector3();
function followRaceWinner(f) {
  if (!isRace || !f?.last) return;
  if (raceFollow === f.id && !raceCamTween) return;
  startRaceFollow(f.id, { silent: true });
}
function startRaceFollow(id, { silent = false } = {}) {
  id = +id;
  const same = isRace && raceFollow === id;
  selected = id;
  if (!isRace) { renderFlyList(); return; }
  if (!same && !silent) raceAudio?.playSelect(id);
  raceFollow = id;
  raceCamTween = { mode: 'in', t: 0, dur: 0.55, fromPos: camera.position.clone(), fromTarget: controls.target.clone() };
  renderFlyList();
  const f = flies.find(x => x.id === id);
  if (isRace && f) setBrainPanelTitle(f);
  if (f?.ready && shouldPollBrainActivity()) f.worker.postMessage({ type: 'activity' });
  applyRaceZoomLimit();
  if (isWatch && f && (f.lastGroups || f.lastEyes) && groups.length) onActivity(f, { groups: f.lastGroups || [], eyes: f.lastEyes, t: f.last?.t || 0 });
}
function stopRaceFollow() {
  if (!isRace || (raceFollow == null && raceCamTween?.mode !== 'in')) return;
  const wasFollow = raceFollow;
  raceFollow = null;
  applyRaceZoomLimit();
  if (!raceCamHome) return;
  raceCamTween = { mode: 'out', t: 0, dur: 0.5, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), wasFollow };
}
function snapRaceOverview() {
  raceFollow = null;
  raceCamTween = null;
  chaosCamHold = false;
  applyRaceZoomLimit();
  if (!controls || !raceCamHome) return;
  camera.position.copy(raceCamHome.pos);
  controls.target.copy(raceCamHome.target);
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.enabled = true;
}
function tickRaceCamera(dt) {
  if (!isRace || chaosCamHold) return;
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
      followCamTo(p);
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
  if (tool === 'obstacle') { alert(t('panel.obstacleAlert')); env.obstacles.push({ type: 'box', x: p.x, y: p.y, sx: 0.2, sy: 0.2, sz: 0.3 }); }
  rebuildEnv(); syncEnv();
}
function deathCauseLabel(s) {
  const c = s?.deathCause;
  if (!c?.kind) return '';
  if (c.kind === 'laser') return c.by ? t('death.laser', { name: c.by }) : t('death.laserAnon');
  if (c.kind === 'holy' && c.by) return t('death.holyBy', { name: c.by });
  const key = `death.${c.kind}`;
  const label = t(key);
  return label === key ? '' : label;
}
function flyDeadHtml() {
  return `<img class="fly-dead-icon" src="${BASE}deadfly.png" alt="">`;
}
function flyBehaviorMarkup(s, dead = false) {
  const full = dead ? '' : behaviorLabel(s.behavior);
  const text = dead ? flyDeadHtml() : full;
  return `<span class="fly-behavior-text">${text}</span><span class="fly-behavior-tip">${full}</span>`;
}
function paintFlyBehavior(beh, s, dead) {
  if (!beh) return;
  beh.classList.toggle('fly-dead', dead);
  let text = beh.querySelector('.fly-behavior-text');
  let tip = beh.querySelector('.fly-behavior-tip');
  if (!text || !tip) {
    beh.innerHTML = flyBehaviorMarkup(s, dead);
    text = beh.querySelector('.fly-behavior-text');
    tip = beh.querySelector('.fly-behavior-tip');
  }
  const row = beh.closest('.fly');
  let cardTip = row?.querySelector(':scope > .fly-card-tip');
  if (dead) {
    if (text) text.innerHTML = flyDeadHtml();
    if (tip) tip.textContent = '';
    const cause = deathCauseLabel(s);
    if (row) {
      if (!cardTip) {
        cardTip = document.createElement('span');
        cardTip.className = 'fly-card-tip';
        row.appendChild(cardTip);
      }
      cardTip.textContent = cause;
    }
  } else {
    const full = behaviorLabel(s.behavior);
    if (text) text.textContent = full;
    if (tip) tip.textContent = full;
    cardTip?.remove();
  }
}
function flyRowHtml(f, selectedId = selected, raceVitals = false) {
  const s = f.last || {}; const e = s.energy ?? 0, h = s.health ?? 1;
  const gender = raceVitals ? '' : `${f.sex === 'f' ? '♀' : '♂'} `;
  const timer = raceVitals ? '' : `<span class="fly-t" style="color:var(--dim)">${s.t ? (s.t / 1000).toFixed(1) + 's' : '…'}</span>`;
  const dead = raceVitals && s.alive === false;
  if (raceVitals) {
    const cause = dead ? deathCauseLabel(s) : '';
    return `<div class="fly ${f.id === selectedId ? 'sel' : ''}${dead ? ' dead' : ''}" data-id="${f.id}" style="--fly:${f.color}"><i class="dot" style="background:${f.color}"></i>
      <div class="fly-body"><div class="fly-head"><span class="fly-name">${f.name}</span> <span class="fly-behavior${dead ? ' fly-dead' : ''}">${flyBehaviorMarkup(s, dead)}</span></div><div class="bar bar-energy"><i style="width:${e * 100}%;background:#f2c14e"></i></div><div class="bar bar-health"><i style="width:${h * 100}%;background:#4ade80"></i></div></div>${cause ? `<span class="fly-card-tip">${cause}</span>` : ''}</div>`;
  }
  const beh = behaviorLabel(s.behavior);
  return `<div class="fly ${f.id === selectedId ? 'sel' : ''}" data-id="${f.id}" style="--fly:${f.color}"><i class="dot" style="background:${f.color}"></i>
      <div>${gender}<span class="fly-name">${f.name}</span> <span class="fly-behavior" style="color:var(--acc)">${beh}</span><div class="bar bar-energy"><i style="width:${e * 100}%;background:#f2c14e"></i></div><div class="bar bar-health"><i style="width:${h * 100}%;background:#4ade80"></i></div></div>
      ${timer}</div>`;
}
function flyKvHtml(f) {
  const s = f.last; if (!s) return '';
  const c = s.cmd || {};
  return `<div class="kv"><span>${t('kv.behaviour')}</span><span>${behaviorLabel(s.behavior)}</span><span>${t('kv.energy')}</span><span>${(s.energy * 100).toFixed(0)}%</span><span>${t('kv.health')}</span><span>${(s.health * 100).toFixed(0)}%</span>
      <span>${t('kv.foodEaten')}</span><span>${(s.eaten * 1000).toFixed(1)} mg·eq</span><span>${t('kv.distance')}</span><span>${(s.dist || 0).toFixed(1)} cm</span><span>${t('kv.takeoffs')}</span><span>${s.jumps || 0} / ${s.flights || 0}</span><span>${t('kv.drive')}</span><span>${s.drive || '–'}</span>${s.nm ? `<span>${t('kv.hormones')}</span><span>${s.nm.akh.toFixed(2)} / ${s.nm.dilp.toFixed(2)}</span><span>${t('kv.oa')}</span><span>${t('kv.arousal', { hz: s.nm.oa.toFixed(1), pct: (s.nm.arousal * 100).toFixed(0) })}</span>` : ''}<span>${t('kv.walkDrive')}</span><span>${(c.drive || 0).toFixed(0)} Hz</span>
      <span>${t('kv.back')}</span><span>${(c.back || 0).toFixed(0)} Hz</span><span>${t('kv.steer')}</span><span>${(c.turn || 0).toFixed(2)}</span>
      <span>${t('kv.gf')}</span><span>${(c.escape || 0).toFixed(0)} Hz</span><span>${t('kv.mn9')}</span><span>${(s.mn9 || 0).toFixed(0)} Hz</span>
      <span>${t('kv.pump')}</span><span>${((s.feeding || 0) * 100).toFixed(0)}%</span><span>${t('kv.sensory')}</span><span>${s.nSensory}</span></div>`;
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
    el.dataset.ids = key;
    el.innerHTML = flies.map(f => flyRowHtml(f, selected, true)).join('');
  }
  for (const f of flies) {
    const row = el.querySelector(`.fly[data-id="${f.id}"]`);
    if (!row) continue;
    row.classList.toggle('sel', f.id === selected);
    const s = f.last || {};
    row.classList.toggle('dead', s.alive === false);
    paintFlyBehavior(row.querySelector('.fly-behavior'), s, s.alive === false);
    const eBar = row.querySelector('.bar-energy > i');
    if (eBar) eBar.style.width = `${(s.energy ?? 0) * 100}%`;
    const hBar = row.querySelector('.bar-health > i');
    if (hBar) hBar.style.width = `${(s.health ?? 1) * 100}%`;
  }
  syncVitalBarWidth(el);
}
const VITAL_BEHAVIOR_SAMPLES = [
  'dead', 'righting', 'taking off', 'escape jump', 'singing (courtship)', 'courting',
  'grooming', 'feeding', 'standing', 'proboscis extended', 'flying', 'landing',
  'walking', 'turning left', 'turning right', 'walking backward',
  'walking (proboscis out)', 'turning left (proboscis out)', 'turning right (proboscis out)',
  'walking backward (proboscis out)',
];
let vitalStatusCache = { locale: '', w: 0 };

function measureVitalStatusWidth(el) {
  const loc = getLocale();
  if (vitalStatusCache.locale === loc && vitalStatusCache.w) return vitalStatusCache.w;
  const sample = el.querySelector('.fly-behavior-text');
  const cs = getComputedStyle(sample || el);
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;pointer-events:none';
  probe.style.fontFamily = cs.fontFamily;
  probe.style.fontSize = cs.fontSize;
  probe.style.fontWeight = cs.fontWeight;
  probe.style.letterSpacing = cs.letterSpacing;
  el.appendChild(probe);
  let max = 0;
  for (const raw of VITAL_BEHAVIOR_SAMPLES) {
    probe.textContent = behaviorLabel(raw);
    if (probe.offsetWidth > max) max = probe.offsetWidth;
  }
  probe.remove();
  vitalStatusCache = { locale: loc, w: max };
  return max;
}

function syncVitalBarWidth(el) {
  if (!el) return;
  if (raceMobile()) {
    el.style.removeProperty('--vital-bar-w');
    return;
  }
  const statusW = measureVitalStatusWidth(el) * 0.5;
  let nameW = 0, gap = 0;
  for (const head of el.querySelectorAll('.fly-head')) {
    if (!gap) gap = parseFloat(getComputedStyle(head).gap) || 0;
    const name = head.querySelector('.fly-name');
    if (name?.offsetWidth > nameW) nameW = name.offsetWidth;
  }
  const max = nameW + gap + statusW;
  if (max) el.style.setProperty('--vital-bar-w', `${Math.ceil(max) + 2}px`);
  else el.style.removeProperty('--vital-bar-w');
}
function renderFlyList() {
  $('#nfly').textContent = flies.length;
  $('#flies').innerHTML = flies.map(f => flyRowHtml(f)).join('');
  $('#flies').querySelectorAll('.fly').forEach(el => el.onclick = () => {
    const id = +el.dataset.id;
    if (isRace) startRaceFollow(id);
    else { selected = id; renderFlyList(); }
  });
  const f = flies.find(x => x.id === selected); $('#selsec').hidden = !f;
  $('#takeoff').textContent = f?.last?.takeoffPending ? (running ? t('panel.takeoffQueued') : t('panel.takeoffQueuedRun')) : t('panel.takeoff');
  $('#takeoff').disabled = !f?.ready || f.last?.flying || f.last?.alive === false;
  if (f?.last) $('#sel').innerHTML = flyKvHtml(f);
  for (const x of flies) paintFlyLabel(x);
  if (isRace) paintRaceVitals(true);
}

// ---------------- brain panel: what the selected fly sees, and its named neuron groups ----------------
const HIST = 150;                    // samples kept per trace (~18 s at the 120 ms poll)
let groups = [], hist = [], histFly = -1, hover = -1, hlShown = -1, hlPts = null, eyeDots = null;
// selected group's neurons as large points over the inset (small groups vanish among 165k somas otherwise)
function showGroupInInset(j) {
  hlShown = j; hlPts.visible = j >= 0; if (j < 0) return;
  const g = groups[j], src = brainPts.geometry.attributes.position.array, pos = [];
  for (const ix of [g.L, g.R]) for (const i of ix) if (src[i * 3] < 1e5) pos.push(src[i * 3], src[i * 3 + 1], src[i * 3 + 2]);
  hlPts.geometry.dispose(); hlPts.geometry = new THREE.BufferGeometry(); hlPts.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hlPts.material.color.set(g.color);
}
function paintGroupRows() {
  const host = $('#groups');
  if (!host || !groups.length) return;
  const open = [...host.querySelectorAll('.info')].map(i => !i.hidden);
  host.innerHTML = groups.map((g, j) => `<div class="g${hover === j ? ' sel' : ''}" data-j="${j}">
      <span class="name"><i style="background:${g.color}"></i>${groupLabel(g)} <small>${g.L.length + g.R.length}</small><button class="q" title="${t('brain.what')}">?</button></span>
      <canvas width="236" height="48"></canvas><span class="v"><b class="l">–</b><b class="r">–</b></span>
      <div class="info" hidden>${groupInfo(g)}</div></div>`).join('');
  host.querySelectorAll('.g').forEach(el => {
    const j = +el.dataset.j;
    el.onclick = (e) => {
      if (e.target.closest('.q')) return;
      hover = hover === j ? -1 : j;
      host.querySelectorAll('.g').forEach(row => row.classList.toggle('sel', +row.dataset.j === hover));
    };
    el.querySelector('.q').onclick = (e) => { e.stopPropagation(); const i = el.querySelector('.info'); i.hidden = !i.hidden; };
    if (open[j]) el.querySelector('.info').hidden = false;
  });
}
function buildBrainPanel(data) {
  groups = buildGroups(bodymap, meta.types, data.side);
  paintGroupRows();
  // eye columns: azimuth/elevation of each column's viewing direction; the front of each eye faces the middle
  const W = 168, H = 116;
  eyeDots = ['L', 'R'].map(sd => flyvisMap.eyes[sd].dirs.map(([x, y, z]) => {
    const az = Math.atan2(y, x) * 180 / Math.PI, el = Math.asin(Math.max(-1, Math.min(1, z))) * 180 / Math.PI;
    return [(sd === 'L' ? 165 - az : 10 - az) / 175 * (W - 8) + 4, (69 - el) / 129 * (H - 8) + 4];
  }));
  $('#brainpanel').hidden = false;
}
function onActivity(f, m) {
  if (histFly !== f.id) { histFly = f.id; hist = groups.map(() => [[], []]); setBrainPanelTitle(f); }
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
  if (isRace && matchPhase === 'lobby') {
    if (sun.castShadow) {
      sun.castShadow = false;
      renderer.shadowMap.needsUpdate = true;
    }
    return;
  }
  if (sun && !sun.castShadow) {
    sun.castShadow = true;
    shadowDirty = true;
  }
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
/** Wall-clock wind so host and watchers sway, dust and hear the same gusts. */
function tickDesert(now) {
  const t = Date.now() / 1000, wind = windField(t);
  desertScene.update(now, wind, t);
  shadowDirty = true;
  if (!raceAudio) return;
  const p = controls.target;
  let water = 0;
  for (const w of env.waterPools || []) water = Math.max(water, 1 - Math.max(0, Math.hypot(p.x - w.x, p.y - w.y) - w.r) / 9);
  const zoom = Math.min(1, 12 / Math.max(1, camera.position.distanceTo(p)));
  raceAudio.setAmbience({ wind, water: water * zoom, hawk: hawkAt(t), t });
}
function tickDish(now) {
  const t = Date.now() / 1000, wind = windField(t);
  dishScene.update(now, wind, t);
}
function animate() {
  requestAnimationFrame(animate);
  if (document.hidden) return;
  const now = performance.now(); const dt = Math.min(0.1, (now - lastFrame) / 1000); fpsT += now - lastFrame; lastFrame = now;
  if (++fpsN === 30) { $('#fps').textContent = (30000 / fpsT).toFixed(0); fpsN = 0; fpsT = 0; }
  if (isWatch) drainWatchCues(now);
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
      updateWingBlur(f, s); f.drawnPose = s; f.drawnBlend = blend;
    }
    const th = f.bodies?.thorax;
    const pos = th ? [th.position.x, th.position.y, th.position.z] : (lerpPosePos(previous?.pos, s.pos, blend) || s.pos);
    f.drawPos = pos;
    f.ring.position.set(pos[0], pos[1], (env.dunes ? groundAt(pos, env) : 0) + ARENA_FLOOR_DECAL_Z);
    pinFlyLabel(f, pos);
    }
    const mark = f.id === selected && raceFollow == null;
    f.ring.visible = mark;
    if (f.beacon) {
      if (mark) tickFlyBeacon(f.beacon, dt);
      else f.beacon.t = 0;
    }
  }
  const sf = flies.find(x => x.id === selected);
  if (!isRace && sf?.last && $('#follow').checked) followCamTo(flyDrawPos(sf) || sf.last.pos);
  tickRaceCamera(dt);
  if (isRace) raceChaos?.tick(dt);
  if (desertScene) tickDesert(now);
  if (dishScene) tickDish(now);
  if (isRace) {
    for (const f of flies) pinFlyLabel(f, flyDrawPos(f));
  }
  if (isRace && raceStartWall != null && !raceWinner) paintRaceClock(formatWall(now - raceStartWall));
  if (isRace && raceAudio && running && !raceWinner) {
    const s = sf?.last;
    raceAudio.setMotion({ flying: !!s?.flying, walk: s?.flying ? 0 : Math.abs(s?.cmd?.v || 0) });
  }
  if (sf?.last) { const t = sf.last.t / 1000; $('#simt').textContent = t.toFixed(2); if (now - lastSimReal > 1000) { $('#rt').textContent = ((t - lastSim) / ((now - lastSimReal) / 1000)).toFixed(2); lastSim = t; lastSimReal = now; } }
  updateThreat(); if (!chaosCamHold || controls.enabled) controls.update();
  camera.position.z = Math.max(camera.position.z, 0.02);
  camera.updateMatrixWorld();
  if (isRace) updateDeadFlySprites(now);
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
  resolution.update(now, largest > 290 || (isRace && matchPhase === 'lobby'));
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
    ? [['#brainpanel', '#bpFold', ']', '>', '<', t('brain.panel')]]
    : [['#panel', '#panelFold', '[', '‹', '›', t('brain.controls')], ['#brainpanel', '#bpFold', ']', '›', '‹', t('brain.panel')]];
  const apply = ([panel, btn, key, open, shut, what], folded) => {
    $(panel).classList.toggle('folded', folded); const b = $(btn);
    b.textContent = folded ? shut : open; b.title = folded ? (what === t('brain.panel') ? t('brain.show') : t('panel.showControls')) : (what === t('brain.panel') ? t('brain.hide') : t('panel.hideControls')); b.setAttribute('aria-expanded', String(!folded));
    try { localStorage.setItem(`fold${panel}`, folded ? '1' : ''); } catch {}
  };
  if (isRace) {
    const f = folds[0];
    setRaceBrainFolded(true, { instant: true });
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
