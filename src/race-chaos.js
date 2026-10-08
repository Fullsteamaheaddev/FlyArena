import { chaosCopy } from './i18n.js';
import {
  makeThumb, makeHand, makeFinger, fadeGroup, prepareMeshFade, makeCakeSlice, makeLeaf,
} from './race-chaos-props.js';
import { cloneChaosProp, getChaosSmokeTexture, chaosPropKeys } from './race-chaos-assets.js';
import { celMat } from './cel-shade.js';
import { createUfoBeam, tickUfoBeam, setUfoBeamOpacity } from './race-chaos-ufo-beam.js';
import { setUfoSaucerFade } from './ufo-rim-glow.js';
import {
  initMeteorSmoke, allocMeteorSmokeBatch, emitMeteorSmokeAlongSegment, sealMeteorSmokeBatch,
  disposeMeteorSmoke, burstMeteorSmoke, orientMeteorAlong, tickMeteorSmoke, METEOR_SCALE,
} from './race-chaos-meteor.js';
import { makeBolt, boltPulse, setBoltPulse, boltGroundFlashMaterial, warmBoltMaterials } from './race-chaos-bolt.js';
import { createLaserPool, tickLaserBeams, hideLaserPool, disposeLaserPool, laserSessionDuration, collectLaserSolids } from './race-chaos-laser.js';
import {
  WEAPONS, pickDuel, nearestTarget, muzzleOf, shotDir, castShot, splashAmount, placeHeldProp, jitterFor,
  createTracerPool, fireTracer, tickTracers, hideTracerPool, disposeTracerPool,
} from './race-chaos-weapons.js';

export const CHAOS_KINDS = [
  'thumb', 'spin', 'quake', 'flip', 'tilt', 'lightning', 'double', 'crumb', 'firefly', 'boop', 'puff', 'laser',
  'meteor', 'sugarrain', 'ufo', 'spikes', 'holy',
  'minigun', 'shotgun', 'taser', 'bazooka', 'missile', 'chicken',
];
/** Fly-on-fly weapons: one fly shoots another and spends the victim's health. */
export const WEAPON_KINDS = ['minigun', 'shotgun', 'taser', 'bazooka', 'missile', 'chicken'];
const KINDS = CHAOS_KINDS;


function liveFlies(flies) {
  return flies.filter(f => f.last?.alive !== false && f.last?.pos);
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randRange(a, b) { return a + Math.random() * (b - a); }
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function worldToFloor(x, y, R, fs) {
  const mid = fs / 2;
  return [mid + (x / R) * mid, mid - (y / R) * mid];
}
function axisAngleQuat(ax, ay, az, ang) {
  const n = Math.hypot(ax, ay, az) || 1;
  const s = Math.sin(ang / 2), c = Math.cos(ang / 2);
  return { qw: c, qx: (ax / n) * s, qy: (ay / n) * s, qz: (az / n) * s };
}
function easeInOut(u) { return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; }

export function paintChaosScorches(fx, fs, radius, scorches, now) {
  if (!scorches?.length) return;
  for (const s of scorches) {
    const k = s.until > now ? 1 : Math.max(0, 1 - (now - s.until) / 4000);
    if (k <= 0) continue;
    const [cx, cy] = worldToFloor(s.x, s.y, radius, fs);
    const r = (s.r / radius) * (fs / 2);
    fx.save();
    fx.globalAlpha = 0.55 * k;
    const g = fx.createRadialGradient(cx, cy, 0, cx, cy, r);
    if (s.kind === 'laser') {
      fx.globalAlpha = 0.7 * k;
      g.addColorStop(0, '#0c0c0c');
      g.addColorStop(0.35, '#141414');
      g.addColorStop(0.7, 'rgba(26,26,26,0.4)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
    } else {
      g.addColorStop(0, '#1a0a08');
      g.addColorStop(0.45, '#3a1a10');
      g.addColorStop(1, 'rgba(40,10,8,0)');
    }
    fx.fillStyle = g;
    fx.beginPath(); fx.arc(cx, cy, r, 0, Math.PI * 2); fx.fill();
    fx.restore();
  }
}

/** Random idle gap between chaos roulette fires (ms). */
const CHAOS_ROULETTE_GAP_MS = [5000, 15000];

export function createRaceChaos(api) {
  const T = api.THREE;
  warmBoltMaterials(T);
  let lastKind = null, nextAt = 0, busyUntil = 0, startedAt = 0;
  let cue = null, cueId = 0, lastWatchId = -1;
  let scorches = [];
  let tweens = [];
  let cakeDespawns = [];
  const CAKE_SLICE_COUNT = 12;
  const CAKE_STAGGER_MS = 400;
  let fxRoot = null;
  let previewMesh = null;
  let toastEl = null, toastTimer = 0, lastToast = null;
  let savedWind = null, savedRadial = null;
  let lastScorchPaint = 0, scorchDirty = false;
  let dishAnim = null, dishPhysics = false, lastDishKey = '';
  const DISH_FLAT = { x: 0, y: 0, z: 0, qw: 1, qx: 0, qy: 0, qz: 0 };
  const DISH_HISTORY = 240, DISH_MAX_LAG = 180;   // floor follows the slowest fly, but never off the end of the history
  let dishSeq = 0, dishHistory = [{ seq: 0, pose: DISH_FLAT }], dishLatest = DISH_FLAT, dishDrawn = null;
  let camShot = null;
  let shakes = [];
  let laserSession = null;
  let laserPool = null;
  let laserBurnLast = null;
  let laserDecals = [];
  let laserDecalGeo = null;
  let sugarRainSession = null;
  let ufoSession = null;
  let spikesSession = null;
  let holySession = null;
  let weaponSession = null;
  let tracerPool = null;
  const LIGHT_POOL_N = 8;
  let lightPool = null, lightFree = [];
  const rimWorld = new T.Vector3();

  function radius() { return api.env()?.arena?.radius || 12.5; }
  /** Linear size vs the 12.5 cm dish. Desert inscribed radius is 25 → 2×. */
  function arenaScale() { return radius() / 12.5; }
  // scorch decals read larger on the big square map; kill radii stay fly-sized
  function scorchScale() { return api.env()?.arena?.shape === 'square' ? 1.5 : 1; }
  /** keep the rim rise of a tilt the same as on the 12.5 cm dish, whatever the arena size */
  function tiltDeg(deg) {
    const R = api.env()?.arena?.radius || 12.5;
    if (R <= 12.5) return deg;
    return Math.asin(Math.min(1, 12.5 * Math.sin(deg * Math.PI / 180) / R)) * 180 / Math.PI;
  }
  function flies() { return api.flies() || []; }
  function now() { return performance.now(); }
  function fxGroup() {
    if (fxRoot && fxRoot.parent) return fxRoot;
    fxRoot = new T.Group();
    fxRoot.matrixAutoUpdate = true;
    api.scene()?.add(fxRoot);
    return fxRoot;
  }
  function lightGroup() {
    if (lightPool && lightPool.parent) return lightPool;
    if (!lightPool) {
      lightPool = new T.Group();
      lightPool.name = 'ChaosLightPool';
      lightFree = [];
      for (let i = 0; i < LIGHT_POOL_N; i++) {
        const l = new T.PointLight('#ffffff', 0, 8, 2);
        l.visible = false;
        lightPool.add(l);
        lightFree.push(l);
      }
    }
    api.scene()?.add(lightPool);
    return lightPool;
  }
  function borrowLight({ color = '#ffffff', distance = 8, decay = 2 } = {}) {
    lightGroup();
    const l = lightFree.pop();
    if (!l) return null;
    l.color.set(color);
    l.distance = distance;
    l.decay = decay;
    l.intensity = 0;
    l.visible = true;
    return l;
  }
  function releaseLight(l) {
    if (!l) return;
    l.intensity = 0;
    l.visible = false;
    if (!lightFree.includes(l)) lightFree.push(l);
  }
  function releaseAllLights() {
    if (!lightPool) return;
    lightFree = [];
    for (const l of lightPool.children) {
      l.intensity = 0;
      l.visible = false;
      lightFree.push(l);
    }
  }
  function dishCakeGroup() {
    const g = api.dishCakeGroup?.();
    if (g) return g;
    return api.envGroup?.() || fxGroup();
  }
  function meteorBakeGroup() {
    const g = api.meteorBakeGroup?.();
    if (g) return g;
    return api.envGroup?.() || fxGroup();
  }
  function bakeMeteorToFloor(mesh, x, y, z) {
    if (!mesh) return;
    const g = meteorBakeGroup();
    g.updateWorldMatrix(true, false);
    const local = g.worldToLocal(new T.Vector3(x, y, z));
    g.add(mesh);
    mesh.position.copy(local);
    mesh.quaternion.identity();
    mesh.rotation.z = 0;
  }
  function clearBakedMeteors() {
    const g = meteorBakeGroup();
    if (!g || g === fxRoot || g.name !== 'meteorBake') return;
    while (g.children.length) disposeObj(g.children[0]);
  }
  function toastBox() {
    if (toastEl) return toastEl;
    const el = document.createElement('div');
    el.id = 'chaosToast';
    el.hidden = true;
    el.innerHTML = '<h2></h2><p></p>';
    document.body.appendChild(el);
    toastEl = el;
    return el;
  }
  function showToast(title, line) {
    const el = toastBox();
    el.querySelector('h2').textContent = title;
    el.querySelector('p').textContent = line;
    el.hidden = false;
    el.classList.remove('in');
    void el.offsetWidth;
    el.classList.add('in');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.classList.remove('in'); el.hidden = true; }, 2400);
  }
  function hideToast() {
    if (!toastEl) return;
    toastEl.classList.remove('in');
    toastEl.hidden = true;
    lastToast = null;
    clearTimeout(toastTimer);
  }
  function relocalizeToast() {
    if (!toastEl || toastEl.hidden || !lastToast) return;
    const copy = chaosCopy(lastToast.kind, lastToast.name);
    toastEl.querySelector('h2').textContent = copy.title;
    toastEl.querySelector('p').textContent = copy.line;
  }
  function post(f, msg) { if (f?.worker) f.worker.postMessage({ type: 'chaos', ...msg }); }
  function postAll(msg) { for (const f of liveFlies(flies())) post(f, msg); }
  function postEvery(msg) { for (const f of flies()) post(f, msg); }
  /** Delayed chaos still runs after a winner so SFX can finish; kills must not. */
  function hostPhysics(physics) { return !!physics && api.isHostLive?.() !== false; }

  function setCue(partial) {
    cueId += 1;
    cue = { id: cueId, t: now(), ...partial };
    api.onCue?.(cue);
  }

  function later(ms, fn) {
    const t0 = now();
    tweens.push({ later: true, until: t0 + ms, tick: () => { if (now() >= t0 + ms) { fn(); return false; } return true; } });
  }
  function tween(dur, fn, done) {
    const t0 = now();
    tweens.push({
      until: t0 + dur,
      tick: () => {
        const u = Math.min(1, (now() - t0) / dur);
        fn(u);
        if (u >= 1) { done?.(); return false; }
        return true;
      },
    });
  }

  function beginCamHold(opts = {}) {
    const cam = api.camera(), ctl = api.controls();
    if (!cam || !ctl) return null;
    if (!camShot) {
      camShot = {
        pos: cam.position.clone(),
        target: ctl.target.clone(),
        polar: ctl.maxPolarAngle,
        enabled: ctl.enabled,
        allowOrbit: !!opts.orbit,
      };
      api.holdFollow?.(true);
      ctl.enabled = false;
      ctl.maxPolarAngle = Math.PI / 2;
    } else if (opts.orbit) {
      camShot.allowOrbit = true;
    }
    return camShot;
  }
  function finishCamTween() {
    const ctl = api.controls();
    aimCam();
    if (camShot?.allowOrbit && ctl) ctl.enabled = true;
  }
  function aimCam() {
    const cam = api.camera(), ctl = api.controls();
    if (cam && ctl) { cam.lookAt(ctl.target); cam.updateMatrixWorld(); }
  }
  function easeCamTo(pos, target, dur, done, opts) {
    const cam = api.camera(), ctl = api.controls();
    if (!cam || !ctl || !pos || !target) { done?.(); return; }
    beginCamHold(opts);
    ctl.enabled = false;
    const p0 = cam.position.clone(), t0 = ctl.target.clone();
    tween(dur, u => {
      const k = easeInOut(u);
      cam.position.lerpVectors(p0, pos, k);
      ctl.target.lerpVectors(t0, target, k);
      aimCam();
    }, () => { finishCamTween(); done?.(); });
  }
  function releaseCam(dur, done) {
    const snap = camShot, cam = api.camera(), ctl = api.controls();
    if (!snap || !cam || !ctl) { done?.(); return; }
    ctl.enabled = false;
    const p0 = cam.position.clone(), t0 = ctl.target.clone();
    tween(dur, u => {
      const k = easeInOut(u);
      cam.position.lerpVectors(p0, snap.pos, k);
      ctl.target.lerpVectors(t0, snap.target, k);
      aimCam();
    }, () => {
      cam.position.copy(snap.pos);
      ctl.target.copy(snap.target);
      ctl.maxPolarAngle = snap.polar;
      ctl.enabled = snap.enabled;
      camShot = null;
      api.holdFollow?.(false);
      aimCam();
      done?.();
    });
  }
  function cancelCam() {
    const snap = camShot, cam = api.camera(), ctl = api.controls();
    camShot = null;
    shakes = [];
    if (snap && cam && ctl) {
      cam.position.copy(snap.pos);
      ctl.target.copy(snap.target);
      ctl.maxPolarAngle = snap.polar;
      ctl.enabled = snap.enabled;
      aimCam();
    }
    api.holdFollow?.(false);
  }
  function camShake(dur = 200, amp = 0.18) {
    shakes.push({ t0: now(), dur, amp });
  }

  function ensureLaserPool() {
    if (laserPool) return laserPool;
    laserPool = createLaserPool(T);
    fxGroup().add(laserPool.group);
    return laserPool;
  }

  function addLaserDecal(hit) {
    if (!hit) return;
    if (!laserDecalGeo) laserDecalGeo = new T.CircleGeometry(1, 16);
    const mesh = new T.Mesh(laserDecalGeo, new T.MeshBasicMaterial({
      color: '#14110e', transparent: true, opacity: 0.88, depthWrite: false, side: T.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false,
    }));
    const n = new T.Vector3(hit.nx || 0, hit.ny || 0, hit.nz == null ? 1 : hit.nz);
    if (n.lengthSq() < 1e-8) n.set(0, 0, 1);
    n.normalize();
    mesh.position.set(hit.x, hit.y, hit.z || 0);
    mesh.position.addScaledVector(n, 0.018);
    mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), n);
    mesh.scale.setScalar(0.14);
    mesh.renderOrder = 4;
    if (laserDecals.length >= 48) {
      const old = laserDecals.shift();
      old.mesh.parent?.remove(old.mesh);
      old.mesh.material.dispose();
    }
    (api.envGroup?.() || fxGroup()).add(mesh);
    laserDecals.push({ mesh, until: now() + 14000 });
  }

  function tickLaserDecals(t) {
    laserDecals = laserDecals.filter(d => {
      const k = d.until > t ? 1 : Math.max(0, 1 - (t - d.until) / 4000);
      if (k <= 0) {
        d.mesh.parent?.remove(d.mesh);
        d.mesh.material.dispose();
        return false;
      }
      d.mesh.material.opacity = 0.88 * k;
      return true;
    });
  }

  function clearLaserDecals() {
    for (const d of laserDecals) {
      d.mesh.parent?.remove(d.mesh);
      d.mesh.material.dispose();
    }
    laserDecals = [];
    laserDecalGeo?.dispose();
    laserDecalGeo = null;
  }

  function endLaserSession() {
    api.audio()?.stopLaserBeam?.();
    laserSession = null;
    laserBurnLast = null;
    hideLaserPool(laserPool);
  }

  function tickLaserSession(t, physics) {
    if (!laserSession || t >= laserSession.until) {
      if (laserSession) endLaserSession();
      return;
    }
    const env = api.env();
    const arena = env?.arena || { radius: radius(), wallHeight: 8 };
    const pool = ensureLaserPool();
    if (!laserBurnLast) laserBurnLast = new Map();
    const allLive = liveFlies(flies());
    const sid = laserSession.shooterId;
    const beamFlies = sid != null ? allLive.filter(f => f.id === sid) : allLive;
    tickLaserBeams(pool, beamFlies, arena, t, laserBurnLast, {
      physics: laserSession.physics ?? physics,
      solids: collectLaserSolids(env),
      onFlyHit: (victimId, shooterId) => {
        if (!laserSession?.physics || laserSession.killed.has(victimId)) return;
        const v = flies().find(x => x.id === victimId);
        if (!v?.worker || v.last?.alive === false) return;
        laserSession.killed.add(victimId);
        const shooter = flies().find(x => x.id === shooterId);
        post(v, { op: 'kill', cause: 'laser', by: shooter?.name || '' });
        api.audio()?.playLaserKill?.();
        hideToast();
      },
      onBurn: (x, y, type, hit) => {
        if (type === 'wall' || type === 'solid') {
          addLaserDecal(hit);
          return;
        }
        scorches.push({ x, y, r: 0.1, until: t + 14000, kind: 'laser' });
        if (t - lastScorchPaint > 80) {
          lastScorchPaint = t;
          api.repaintFloor?.();
        }
      },
    }, allLive);
  }
  function camPullBack(scale, dur, opts) {
    const cam = api.camera(), ctl = api.controls();
    if (!cam || !ctl) return;
    const to = ctl.target.clone().add(cam.position.clone().sub(ctl.target).multiplyScalar(scale));
    easeCamTo(to, ctl.target.clone(), dur, undefined, opts);
  }
  function camPunchIn(frac, dur, done) {
    const cam = api.camera(), ctl = api.controls();
    if (!cam || !ctl) { done?.(); return; }
    const to = cam.position.clone().lerp(ctl.target, frac);
    easeCamTo(to, ctl.target.clone(), dur, done);
  }

  function disposeObj(obj) {
    if (!obj) return;
    const geos = new Set(), mats = new Set();
    obj.traverse?.(o => {
      if (o.geometry && !geos.has(o.geometry)) { geos.add(o.geometry); o.geometry.dispose(); }
      const list = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of list) if (m && !mats.has(m)) { mats.add(m); m.dispose?.(); }
    });
    obj.parent?.remove(obj);
  }

  function boltHeight() {
    const cam = api.camera();
    const ctl = api.controls();
    const md = ctl?.maxDistance || radius() * 5;
    const fov = ((cam?.fov || 40) * Math.PI) / 180;
    return md * Math.tan(fov / 2) * 1.6;
  }

  function identityDish() { return { x: 0, y: 0, z: 0, qw: 1, qx: 0, qy: 0, qz: 0 }; }

  function applyDish(pose, physics) {
    const key = `${pose.x.toFixed(4)}|${pose.y.toFixed(4)}|${pose.z.toFixed(4)}|${pose.qw.toFixed(5)}|${pose.qx.toFixed(5)}|${pose.qy.toFixed(5)}|${pose.qz.toFixed(5)}`;
    if (physics && key !== lastDishKey) {
      lastDishKey = key;
      dishSeq += 1;
      dishHistory.push({ seq: dishSeq, pose });
      if (dishHistory.length > DISH_HISTORY) dishHistory.shift();
      postEvery({ op: 'dish', seq: dishSeq, ...pose });
    }
    dishLatest = pose;
    syncDishVisual();
  }

  /** Draw the dish where the flies on screen are standing, not where physics has already moved it:
   *  poses arrive a frame or two late, so a floor drawn at the newest pose sweeps up over them. */
  function syncDishVisual() {
    const g = api.envGroup();
    if (!g) return;
    let pose = dishLatest;
    const seq = api.drawnDishSeq?.();
    if (seq != null && dishHistory.length) {
      const want = Math.max(seq, dishHistory[dishHistory.length - 1].seq - DISH_MAX_LAG);
      for (const e of dishHistory) if (e.seq <= want) pose = e.pose;
    }
    if (pose === dishDrawn) return;
    dishDrawn = pose;
    g.position.set(pose.x, pose.y, pose.z);
    g.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw);
    g.scale.set(1, 1, 1);
  }

  function resetEnvPose() {
    dishAnim = null;
    lastDishKey = '';
    dishHistory = [{ seq: dishSeq, pose: DISH_FLAT }];
    applyDish(identityDish(), true);
  }

  function restoreWind() {
    const env = api.env();
    if (!env || savedWind == null) return;
    env.wind = savedWind;
    env.windRadial = savedRadial;
    savedWind = null;
    savedRadial = null;
    api.syncEnv?.();
  }

  function randomInDish(margin = 1.2) {
    const R = radius() - margin;
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R;
    return [r * Math.cos(a), r * Math.sin(a)];
  }

  function clampIntoArena(x, y, margin = 1.2) {
    const arena = api.env()?.arena || {};
    const lim = (arena.half || arena.radius || 12.5) - margin;
    if (arena.shape === 'square') {
      return [Math.max(-lim, Math.min(lim, x)), Math.max(-lim, Math.min(lim, y))];
    }
    const r = Math.hypot(x, y);
    if (r <= lim || r < 1e-6) return [x, y];
    const k = lim / r;
    return [x * k, y * k];
  }

  function sugarDisc() {
    const f = api.env()?.food?.[0];
    return { x: f?.x ?? 0, y: f?.y ?? 0, r: f?.r ?? 0.5 };
  }

  /** Evenly spaced around the dish with jittered angle and radius. */
  function cakeDropPoints(n = CAKE_SLICE_COUNT) {
    const R = radius();
    const base = Math.random() * Math.PI * 2;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = base + (i / n) * Math.PI * 2 + randRange(-0.14, 0.14);
      const rad = randRange(R * 0.32, R * 0.84);
      pts.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad });
    }
    return pts;
  }

  const CAKE_FADE_MS = 2400;

  function scheduleCakeDespawn(mesh, cakeId) {
    cakeDespawns.push({ mesh, cakeId, at: now() + 20000, fadeStart: null });
  }

  function tickCakeDespawns(t) {
    for (let i = cakeDespawns.length - 1; i >= 0; i--) {
      const d = cakeDespawns[i];
      if (!d.mesh?.parent) {
        cakeDespawns.splice(i, 1);
        continue;
      }
      if (t < d.at) continue;
      if (d.fadeStart == null) {
        d.fadeStart = t;
        prepareMeshFade(d.mesh);
      }
      const u = Math.min(1, (t - d.fadeStart) / CAKE_FADE_MS);
      const opacity = 1 - easeInOut(u);
      const ink = 1 - easeInOut(Math.min(1, u / 0.08));
      fadeGroup(d.mesh, opacity, ink);
      if (u >= 1) {
        fadeGroup(d.mesh, 0);
        disposeObj(d.mesh);
        stripCake(d.cakeId);
        cakeDespawns.splice(i, 1);
      }
    }
  }

  function clearCakeDespawns() {
    for (const d of cakeDespawns) disposeObj(d.mesh);
    cakeDespawns = [];
  }

  function dishPoseAt(t) {
    if (!dishAnim) return identityDish();
    const u = Math.min(1, Math.max(0, (t - dishAnim.t0) / dishAnim.dur));
    if (dishAnim.kind === 'tilt') {
      const yaw = dishAnim.yaw, rad = dishAnim.deg * Math.PI / 180;
      let k;
      if (u < 0.12) k = easeInOut(u / 0.12);
      else if (u < 0.78) k = 1;
      else k = 1 - easeInOut((u - 0.78) / 0.22);
      const q = axisAngleQuat(-Math.sin(yaw), Math.cos(yaw), 0, rad * k);
      return { x: 0, y: 0, z: 0, ...q };
    }
    if (dishAnim.kind === 'flip') {
      const punch = u < 0.22 ? Math.sin((u / 0.22) * Math.PI) : u < 0.55 ? Math.sin(((u - 0.22) / 0.33) * Math.PI) * 0.35 : 0;
      return { x: 0, y: 0, z: punch * 2.4, qw: 1, qx: 0, qy: 0, qz: 0 };
    }
    if (dishAnim.kind === 'quake') {
      const k = 1 - u;
      const w = t * 0.001;
      return {
        x: Math.sin(w * 31) * 0.55 * k + Math.sin(w * 17) * 0.2 * k,
        y: Math.cos(w * 27) * 0.48 * k,
        z: Math.abs(Math.sin(w * 42)) * 0.22 * k,
        qw: 1, qx: Math.sin(w * 19) * 0.03 * k, qy: Math.cos(w * 23) * 0.03 * k, qz: 0,
      };
    }
    return identityDish();
  }

  function startDish(kind, extra, physics) {
    const dur = { tilt: 3800, flip: 900, quake: 5000 }[kind];
    dishAnim = { kind, t0: now(), dur, ...extra };
    dishPhysics = !!physics;
    applyDish(dishPoseAt(now()), dishPhysics);
  }

  function strike(x, y, killR, physics, opts = {}) {
    let killed = false;
    let sx = x, sy = y;
    if (hostPhysics(physics) && opts.killFlyId != null) {
      const f = liveFlies(flies()).find(fl => fl.id === opts.killFlyId);
      if (f?.last) {
        sx = f.last.pos[0]; sy = f.last.pos[1];
        post(f, { op: 'kill', cause: 'lightning' });
        killed = true;
      }
    } else if (hostPhysics(physics) && killR > 0) {
      for (const f of liveFlies(flies())) {
        const p = f.last.pos;
        if (Math.hypot(p[0] - x, p[1] - y) < killR) { post(f, { op: 'kill', cause: 'lightning' }); killed = true; }
      }
    }
    if (killed) hideToast();
    scorches.push({ x: sx, y: sy, r: (opts.r || (opts.hit ? 0.7 : 0.55)) * scorchScale(), until: now() + 16000 });
    scorchDirty = true;
    flashBolt(sx, sy, opts);
    camShake(200, opts.thin ? 0.12 : opts.hit ? 0.28 : 0.2);
    return killed;
  }

  function flashBolt(x, y, opts = {}) {
    const root = fxGroup();
    const height = opts.height ?? boltHeight();
    const bolt = makeBolt(T, x, y, { ...opts, height });
    bolt.scale.set(1, 1, 0.02);
    root.add(bolt);
    const t0 = now();
    const lightPeak = opts.thin ? 18 : opts.hit ? 48 : 34;
    const light = borrowLight({ color: opts.hit ? '#e8f0ff' : '#d7eeff', distance: opts.thin ? 10 : 18 });
    if (light) light.position.set(x, y, 3.2);
    const flashR = opts.thin ? 0.7 : opts.hit ? 1.45 : 1.15;
    const flash = new T.Mesh(
      new T.CircleGeometry(flashR, 28),
      boltGroundFlashMaterial(T, !!opts.hit),
    );
    flash.position.set(x, y, 0.03);
    root.add(flash);
    tween(450, u => {
      const e = boltPulse(u);
      const elapsed = now() - t0;
      bolt.scale.z = Math.max(0.02, e.reveal);
      if (light) light.intensity = lightPeak * e.glow;
      flash.material.opacity = (opts.hit ? 1 : 0.85) * e.flash;
      flash.scale.setScalar(0.85 + 0.35 * e.flash);
      setBoltPulse(bolt, e, elapsed);
    }, () => { disposeObj(bolt); disposeObj(flash); releaseLight(light); });
  }

  function thumbAt(f, physics) {
    const root = fxGroup();
    const mesh = makeThumb(T);
    const p0 = f.last.pos;
    mesh.position.set(p0[0], p0[1], 7.2);
    mesh.rotation.z += randRange(-0.12, 0.12);
    root.add(mesh);
    if (physics) post(f, { op: 'pin', on: true });
    tween(320, u => {
      const p = f.last?.pos || p0;
      const k = easeInOut(u);
      mesh.position.set(p[0], p[1], 7.2 + (0.52 - 7.2) * k);
      mesh.scale.setScalar(1 + 0.08 * Math.sin(k * Math.PI));
    }, () => {
      tween(820, u => {
        const p = f.last?.pos || p0;
        mesh.position.set(p[0], p[1], 0.52 + Math.sin(u * 18) * 0.03);
        const press = 0.94 + 0.06 * Math.sin(u * Math.PI);
        mesh.scale.set(1.04, press, 1);
      }, () => {
        const p = f.last?.pos || p0;
        const yaw = (f.last?.yaw || 0) + 1.15;
        if (physics) {
          post(f, { op: 'pin', on: false });
          post(f, { op: 'loose', on: true });
          post(f, { op: 'impulse', vx: 28 * Math.cos(yaw), vy: 28 * Math.sin(yaw), vz: 10 });
          later(500, () => post(f, { op: 'loose', on: false }));
        }
        tween(280, u => {
          mesh.position.x = p[0] + Math.cos(yaw) * u * 3.4;
          mesh.position.y = p[1] + Math.sin(yaw) * u * 3.4;
          mesh.position.z = 0.52 + u * 2.4;
          mesh.rotation.z += 0.12;
          fadeGroup(mesh, 1 - u);
        }, () => disposeObj(mesh));
      });
    });
  }

  function spinRing(f) {
    const root = fxGroup();
    const p0 = f.last.pos;
    const sparks = [];
    const dur = 2800;
    const spinRate = 22 / 1.8;
    const bobRate = 20 / 1.8;
    for (let i = 0; i < 10; i++) {
      const s = new T.Mesh(
        new T.SphereGeometry(0.05, 8, 8),
        new T.MeshBasicMaterial({ color: '#fff6c8', transparent: true, opacity: 0.9, toneMapped: false }),
      );
      sparks.push(s); root.add(s);
    }
    tween(dur, u => {
      const p = f.last?.pos || p0;
      const tSec = u * (dur / 1000);
      const fade = u < 0.85 ? 1 : (1 - u) / 0.15;
      for (let i = 0; i < sparks.length; i++) {
        const a = i * Math.PI / 5 + tSec * spinRate;
        sparks[i].position.set(p[0] + 0.58 * Math.cos(a), p[1] + 0.58 * Math.sin(a), 0.22 + 0.08 * Math.sin(tSec * bobRate + i));
        sparks[i].material.opacity = 0.9 * fade;
      }
    }, () => { for (const s of sparks) disposeObj(s); });
  }

  function boopImpact(x, y, z) {
    const root = fxGroup();
    const flash = new T.Mesh(
      new T.CircleGeometry(0.62, 28),
      new T.MeshBasicMaterial({ color: '#fff4e0', transparent: true, opacity: 0.9, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false }),
    );
    flash.position.set(x, y, z);
    root.add(flash);
    const rings = [0.35, 0.55].map((r, i) => {
      const m = new T.Mesh(
        new T.RingGeometry(r, r + 0.04, 28),
        new T.MeshBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.85, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, toneMapped: false }),
      );
      m.position.set(x, y, z + 0.02);
      root.add(m);
      return m;
    });
    const bits = [];
    for (let i = 0; i < 10; i++) {
      const s = new T.Mesh(
        new T.SphereGeometry(0.045, 6, 6),
        new T.MeshBasicMaterial({ color: '#fff6c8', transparent: true, opacity: 0.95, toneMapped: false }),
      );
      s.position.set(x, y, z);
      root.add(s);
      bits.push({ s, a: i * Math.PI / 5, sp: randRange(0.9, 1.6) });
    }
    tween(380, u => {
      const k = easeInOut(u);
      flash.material.opacity = 0.9 * (1 - u);
      flash.scale.setScalar(1 + k * 0.8);
      for (let i = 0; i < rings.length; i++) {
        rings[i].scale.setScalar(1 + k * (1.6 + i));
        rings[i].material.opacity = 0.85 * (1 - u);
      }
      for (const b of bits) {
        b.s.position.set(x + Math.cos(b.a) * b.sp * k * 0.7, y + Math.sin(b.a) * b.sp * k * 0.7, z + 0.15 * k);
        b.s.material.opacity = 0.95 * (1 - u);
      }
    }, () => {
      disposeObj(flash);
      for (const r of rings) disposeObj(r);
      for (const b of bits) disposeObj(b.s);
    });
  }

  function boopPad(f, az) {
    const root = fxGroup();
    const mesh = makeFinger(T);
    const p0 = f.last.pos;
    const a = az ?? Math.random() * Math.PI * 2;
    const ax = Math.cos(a), ay = Math.sin(a);
    const z = (p0[2] || 0.13) + 0.28;
    mesh.scale.setScalar(2.8);
    mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), new T.Vector3(ax, ay, 0));
    mesh.position.set(p0[0] + ax * 3.2, p0[1] + ay * 3.2, z);
    root.add(mesh);
    tween(200, u => {
      const p = f.last?.pos || p0;
      const k = easeInOut(u);
      const r = 3.2 + (0.32 - 3.2) * k;
      mesh.position.set(p[0] + ax * r, p[1] + ay * r, z);
    }, () => {
      const p = f.last?.pos || p0;
      boopImpact(p[0], p[1], z);
      camPunchIn(0.14, 80);
      tween(180, u => {
        const q = f.last?.pos || p0;
        mesh.position.set(q[0] + ax * (0.32 + Math.sin(u * 14) * 0.03), q[1] + ay * (0.32 + Math.sin(u * 14) * 0.03), z);
      }, () => {
        tween(280, u => {
          const q = f.last?.pos || p0;
          mesh.position.set(q[0] + ax * (0.32 + u * 3.0), q[1] + ay * (0.32 + u * 3.0), z + u * 0.4);
          fadeGroup(mesh, 1 - u);
        }, () => disposeObj(mesh));
      });
    });
  }

  function fireflies() {
    const R = radius();
    const n = 4 + Math.floor(Math.random() * 3);
    const dots = [];
    const root = fxGroup();
    for (let i = 0; i < n; i++) {
      const a = randRange(0, Math.PI * 2);
      const mat = celMat('#d6ff7a', 1.4);
      const s = new T.Mesh(new T.SphereGeometry(0.09, 12, 10), mat);
      const light = borrowLight({ color: '#c8ff6a', distance: 2.4 });
      root.add(s);
      dots.push({ s, light, a, wob: randRange(0.5, 1.3), z: randRange(0.35, 0.7) });
    }
    const speed = 7000 / 3000;
    tween(7000, u => {
      for (const d of dots) {
        const a = d.a + u * d.wob * speed;
        d.s.position.set((R - 0.55) * Math.cos(a), (R - 0.55) * Math.sin(a), d.z + 0.18 * Math.sin(u * 14 * speed + d.wob));
        d.s.material.opacity = u < 0.12 ? u / 0.12 : u > 0.82 ? (1 - u) / 0.18 : 1;
        if (d.light) {
          d.light.position.copy(d.s.position);
          d.light.intensity = 1.6 * d.s.material.opacity;
        }
      }
    }, () => { for (const d of dots) { disposeObj(d.s); releaseLight(d.light); } });
  }

  function seeds() {
    const R = radius();
    const n = 14;
    const bits = [];
    const root = fxGroup();
    const LEAF_COLORS = ['#8fd14f', '#6fbf3a', '#b6e06a'];
    const protos = LEAF_COLORS.map(c => makeLeaf(T, c));
    for (let i = 0; i < n; i++) {
      const a = randRange(0, Math.PI * 2);
      const r0 = R * randRange(0.06, 0.18);
      const s = protos[i % protos.length].clone();
      s.traverse(o => { if (o.material) o.material = o.material.clone(); });
      s.scale.setScalar(0.45);
      s.position.set(r0 * Math.cos(a), r0 * Math.sin(a), 0.52);
      root.add(s);
      bits.push({ s, a, r0, speed: randRange(1.3, 2.6), spin: randRange(-8, 8), tumble: randRange(-6, 6) });
    }
    tween(5000, u => {
      for (const b of bits) {
        const r = b.r0 + u * (R * 0.88 - b.r0);
        b.s.position.set(r * Math.cos(b.a + u * b.speed), r * Math.sin(b.a + u * b.speed), 0.4 + 0.3 * Math.sin(u * 9 + b.speed));
        b.s.rotation.set(u * b.tumble, u * b.spin * 0.5, u * b.spin);
        fadeGroup(b.s, 0.95 * (1 - u));
      }
    }, () => { for (const b of bits) disposeObj(b.s); });
  }

  const CAKE_R = 0.95;
  let cakeSeq = 0;

  function stripCake(id = null) {
    const env = api.env();
    if (!env) return;
    const before = env.food.length + (env.odors?.length || 0);
    if (id == null) {
      env.food = env.food.filter(f => !f.chaosCake);
      if (env.odors) env.odors = env.odors.filter(o => !o.chaosCake);
    } else {
      env.food = env.food.filter(f => !(f.chaosCake && f.chaosCakeId === id));
      if (env.odors) env.odors = env.odors.filter(o => !(o.chaosCake && o.chaosCakeId === id));
    }
    if (env.food.length + (env.odors?.length || 0) !== before) api.syncEnv?.();
  }

  function crumbDrop(x, y, physics) {
    const root = dishCakeGroup();
    const mesh = chaosMesh('cake_slice') || makeCakeSlice(T);
    mesh.userData.chaosCake = true;
    mesh.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(mesh);
    const restZ = -box.min.z + 0.001;
    const dropFrom = boltHeight() * randRange(0.92, 1.02);
    const fallMs = Math.min(2600, 1150 + Math.sqrt(dropFrom) * 105);
    const cakeId = ++cakeSeq;
    const yaw = randRange(0, Math.PI * 2);
    const tilt0 = randRange(0.28, 0.48);
    const spin = randRange(0.65, 1.05);
    mesh.position.set(x, y, dropFrom);
    mesh.rotation.set(tilt0, 0, yaw);
    root.add(mesh);
    tween(fallMs, u => {
      const t = u * u;
      mesh.position.z = dropFrom + (restZ - dropFrom) * t;
      mesh.rotation.x = tilt0 * (1 - Math.min(1, u / 0.92) ** 1.4);
      mesh.rotation.z = yaw + (1 - u) * spin;
    }, () => {
      mesh.position.z = restZ;
      mesh.rotation.x = 0;
      mesh.rotation.z = yaw;
      api.audio()?.playCakeLand?.();
      if (hostPhysics(physics)) {
        for (const f of liveFlies(flies())) {
          const p = f.last.pos;
          if (Math.hypot(p[0] - x, p[1] - y) < CAKE_R && (p[2] || 0) < 0.55) {
            post(f, { op: 'kill', cause: 'cake' });
            hideToast();
          }
        }
        const env = api.env();
        if (env) {
          env.food.push({
            x, y, r: CAKE_R, sugar: 1, bitter: 0, water: 0.15, amount: 5,
            hiddenDisc: true, chaosCake: true, chaosCakeId: cakeId,
          });
          env.odors.push({
            x, y, odor: 'vinegar', strength: 0.95, sigma: 0.85, chaosCake: true, chaosCakeId: cakeId,
          });
          api.syncEnv?.();
        }
      }
      scheduleCakeDespawn(mesh, cakeId);
    });
  }

  function handUnder() {
    const root = fxGroup();
    const mesh = makeHand(T);
    const s = arenaScale() * 1.17;
    mesh.scale.setScalar(s);
    mesh.position.set(0, -2.2 * s, -2.4 * s);
    mesh.rotation.set(0, 0, 0);
    mesh.rotateX(0.18);
    root.add(mesh);
    tween(240, u => {
      const k = easeInOut(u);
      mesh.position.z = -2.4 * s + k * 2.55 * s;
      mesh.position.y = -2.2 * s + k * 1.4 * s;
    }, () => {
      later(160, () => tween(320, u => {
        mesh.position.z = 0.15 * s - u * 2.8 * s;
        fadeGroup(mesh, 1 - u);
      }, () => disposeObj(mesh)));
    });
  }

  function dust() {
    const bits = [];
    const root = fxGroup();
    for (let i = 0; i < 16; i++) {
      const [x, y] = randomInDish(2);
      const mat = new T.MeshBasicMaterial({ color: '#c4b8a0', transparent: true, opacity: 0.45, toneMapped: false });
      mat.opacity = 0.45;
      const s = new T.Mesh(new T.SphereGeometry(randRange(0.05, 0.12), 8, 8), mat);
      s.position.set(x, y, randRange(0.08, 0.35));
      root.add(s);
      bits.push(s);
    }
    tween(5000, u => {
      for (const s of bits) {
        s.position.z += 0.0008;
        s.material.opacity = 0.45 * (1 - u) * (0.4 + 0.6 * Math.abs(Math.sin(u * 50 + s.position.x)));
      }
    }, () => { for (const s of bits) disposeObj(s); });
  }

  function endSugarRain() {
    sugarRainSession = null;
  }
  function endUfo() {
    if (!ufoSession) return;
    const f = flies().find(x => x.id === ufoSession.flyId);
    if (ufoSession.physics && f?.worker) {
      post(f, { op: 'pin', on: false });
      post(f, { op: 'loose', on: false });
      post(f, { op: 'bias', ax: 0, ay: 0 });
      post(f, { op: 'pull', on: false });
    }
    if (ufoSession.saucer) disposeObj(ufoSession.saucer);
    if (ufoSession.beam) disposeObj(ufoSession.beam);
    releaseLight(ufoSession.glow);
    if (ufoSession.rimLights) for (const l of ufoSession.rimLights) releaseLight(l);
    api.audio()?.stopUfoSting?.(3);
    ufoSession = null;
  }
  function endSpikes() {
    if (!spikesSession) return;
    if (spikesSession.mesh) disposeObj(spikesSession.mesh);
    spikesSession = null;
  }
  function endWildcardSessions() {
    endSugarRain();
    endUfo();
    endSpikes();
    endHoly();
    endWeapons();
    disposeMeteorSmoke();
  }

  function ensureMeteorSmoke() {
    initMeteorSmoke(T, fxGroup(), getChaosSmokeTexture());
  }

  function chaosMesh(name) {
    const m = cloneChaosProp(name);
    if (m) return m;
    console.warn(`[chaos] missing GLB: ${name}`);
    return null;
  }

  // Elevation from the horizon: 50° floor so they never skim, up to ~82° so some still
  // drop steep. slantR follows from that and the spawn height.
  const METEOR_ELEV_MIN = Math.PI * 50 / 180;
  const METEOR_ELEV_MAX = Math.PI * 82 / 180;
  const METEOR_Z_GROUND = 0.18 * METEOR_SCALE;
  const METEOR_BLAST_R = 0.55;
  function meteorSlant(strike = {}) {
    const h = strike.h ?? boltHeight() * randRange(0.82, 1.02);
    const elev = strike.elev ?? randRange(METEOR_ELEV_MIN, METEOR_ELEV_MAX);
    const drop = Math.max(0.5, h - METEOR_Z_GROUND);
    const slantR = strike.slantR ?? drop / Math.tan(elev);
    const slantAz = strike.slantAz ?? Math.random() * Math.PI * 2;
    return { slantAz, slantR, h, elev };
  }

  function randomMeteorStrike() {
    const sugar = sugarDisc();
    const minR = sugar.r + METEOR_BLAST_R;
    for (let i = 0; i < 40; i++) {
      const [x, y] = randomInDish(1);
      if (Math.hypot(x - sugar.x, y - sugar.y) >= minR) return { x, y, ...meteorSlant() };
    }
    const a = Math.random() * Math.PI * 2;
    return { x: sugar.x + Math.cos(a) * minR, y: sugar.y + Math.sin(a) * minR, ...meteorSlant() };
  }

  function meteorImpact(strike, physics) {
    ensureMeteorSmoke();
    const { x, y } = strike;
    const { slantAz, slantR, h } = meteorSlant(strike);
    const root = fxGroup();
    const zGround = METEOR_Z_GROUND;
    const sx = x + Math.cos(slantAz) * slantR;
    const sy = y + Math.sin(slantAz) * slantR;
    const sz = h;
    const mesh = chaosMesh('meteor_chunk');
    if (mesh) {
      prepareMeshFade(mesh);
      mesh.userData.meteorChunk = true;
      mesh.scale.setScalar(METEOR_SCALE);
      mesh.position.set(sx, sy, sz);
      orientMeteorAlong(mesh, x - sx, y - sy, zGround - sz);
      root.add(mesh);
    }
    const smokeBatch = allocMeteorSmokeBatch();
    const fallMs = 320 + Math.sqrt(Math.hypot(slantR, h)) * 38;
    let prevPx = sx;
    let prevPy = sy;
    let prevPz = sz;
    tween(fallMs, u => {
      const t = u * u;
      const px = sx + (x - sx) * t;
      const py = sy + (y - sy) * t;
      const pz = sz + (zGround - sz) * t;
      if (mesh) {
        mesh.position.set(px, py, pz);
        mesh.rotation.z += 0.14;
      }
      emitMeteorSmokeAlongSegment(prevPx, prevPy, prevPz, px, py, pz, smokeBatch);
      prevPx = px;
      prevPy = py;
      prevPz = pz;
    }, () => {
      const landT = now();
      if (mesh) {
        mesh.rotation.z = 0;
        bakeMeteorToFloor(mesh, x, y, zGround);
      }
      burstMeteorSmoke(x, y, zGround, smokeBatch);
      sealMeteorSmokeBatch(smokeBatch, landT);
      camShake(200, 0.22);
      scorches.push({ x, y, r: 0.5 * scorchScale(), until: now() + 15000 });
      api.repaintFloor?.();
      if (hostPhysics(physics)) {
        const impulseR = 1.65;
        for (const f of liveFlies(flies())) {
          const p = f.last.pos;
          const d = Math.hypot(p[0] - x, p[1] - y);
          if (d < METEOR_BLAST_R && (p[2] || 0) < 0.58) {
            post(f, { op: 'kill', cause: 'meteor' });
            hideToast();
          } else if (d < impulseR && d > 0.02) {
            const k = (1 - d / impulseR) * 14;
            post(f, { op: 'impulse', vx: ((p[0] - x) / d) * k, vy: ((p[1] - y) / d) * k, vz: 3 + k * 0.35 });
          }
        }
      }
    });
  }

  function meteorShower(payload, physics) {
    let strikes = payload.strikes?.length
      ? payload.strikes.slice()
      : [{ x: payload.x, y: payload.y, slantAz: payload.slantAz, slantR: payload.slantR }, ...(payload.points || [])];
    if (strikes.length > 3) strikes = strikes.slice(0, 3);
    strikes.forEach((st, i) => {
      const go = () => meteorImpact(st, physics);
      if (i === 0) go();
      else later(160 * i + randRange(0, 80), go);
    });
    camPullBack(1.1, 600, { orbit: true });
    later(5600, () => releaseCam(500));
  }

  function startSugarRain(physics) {
    endSugarRain();
    const dur = 5200;
    const t0 = now();
    sugarRainSession = { until: t0 + dur, nextCrumb: t0, nextBump: t0 + 180, physics: !!physics };
    busyUntil = Math.max(busyUntil, t0 + dur);
    camPullBack(1.06, 700, { orbit: true });
    later(dur, () => {
      endSugarRain();
      releaseCam(500);
    });
  }

  function spawnSugarCrumb(x, y) {
    const root = fxGroup();
    const mesh = chaosMesh('sugar_crumb');
    if (!mesh) return;
    mesh.scale.setScalar(randRange(0.85, 1.15));
    const z0 = boltHeight() * randRange(0.55, 0.95);
    mesh.position.set(x, y, z0);
    root.add(mesh);
    const spin = randRange(4, 9);
    tween(900 + randRange(0, 400), u => {
      mesh.position.z = z0 + (0.12 - z0) * (u * u);
      mesh.rotation.z += spin * 0.02;
    }, () => {
      later(10000, () => {
        if (!mesh.parent) return;
        tween(800, u => fadeGroup(mesh, 0.85 * (1 - u)), () => disposeObj(mesh));
      });
    });
  }

  function tickSugarRain(t) {
    if (!sugarRainSession || t >= sugarRainSession.until) {
      if (sugarRainSession) endSugarRain();
      return;
    }
    while (t >= sugarRainSession.nextCrumb) {
      const [x, y] = randomInDish(0.4);
      spawnSugarCrumb(x, y);
      sugarRainSession.nextCrumb += randRange(55, 95);
    }
    if (sugarRainSession.physics && t >= sugarRainSession.nextBump) {
      for (const f of liveFlies(flies())) {
        post(f, { op: 'impulse', vx: randRange(-4, 4), vy: randRange(-4, 4), vz: randRange(-2.5, -0.5) });
      }
      sugarRainSession.nextBump += 220;
    }
  }

  const UFO_BEAM_XY = 1.25;
  const UFO_SPIN_RAD_PER_SEC = 1.15;
  const UFO_SAUCER_TOP0 = 7.0;
  const UFO_SAUCER_HOVER_Z = 3.2;
  /** Fraction of approach tween (2200 ms) used for saucer fade-in. */
  const UFO_FADE_IN_FRAC = 0.08;
  /** Fraction of exit tween (1800 ms) at the end used for saucer fade-out. */
  const UFO_FADE_OUT_FRAC = 0.18;
  /** Fly thorax z = saucer.z − this (inside the belly mesh). */
  const UFO_FLY_INSIDE_Z = 0.3;

  function tickUfoAbductFly() {
    if (!ufoSession?.abducting || !ufoSession.physics) return;
    const f = flies().find(x => x.id === ufoSession.flyId);
    const saucer = ufoSession.saucer;
    if (!f?.worker || !saucer) return;
    const { x: sx, y: sy, z: sz } = saucer.position;
    post(f, {
      op: 'pull',
      x: sx,
      y: sy,
      z: sz - UFO_FLY_INSIDE_Z,
      k: 0.72,
    });
  }

  function placeUfoBeam(beam, x, y, floorZ, topZ, opacity = 0.5) {
    const len = Math.max(0.5, topZ - floorZ);
    beam.position.set(x, y, floorZ);
    beam.scale.set(UFO_BEAM_XY, UFO_BEAM_XY, len);
    setUfoBeamOpacity(beam, opacity);
  }

  function ufoAbduct(payload, physics) {
    endUfo();
    const f = flies().find(x => x.id === payload.flyId);
    const p0 = f?.last?.pos || [payload.x, payload.y, 0.13];
    const root = fxGroup();
    const saucer = chaosMesh('ufo');
    if (!saucer) return;
    setUfoSaucerFade(saucer, 0);
    const beam = createUfoBeam(T, 1);
    const glow = borrowLight({ color: '#88ffdd', distance: 16 });
    if (glow) glow.position.set(p0[0], p0[1], 2.5);
    root.add(saucer, beam);
    const rimLights = [];
    const rimAnchors = saucer.getObjectByName('RimLampLights');
    if (rimAnchors) {
      for (const a of rimAnchors.children) {
        const l = borrowLight({ color: 0x99eeff, distance: 0.55, decay: 2 });
        if (!l) break;
        l.intensity = 0.35;
        rimLights.push(l);
      }
    }
    const top0 = UFO_SAUCER_TOP0;
    saucer.position.set(p0[0], p0[1], top0);
    placeUfoBeam(beam, p0[0], p0[1], 0.05, top0 - 0.35, 0);
    const dur = 6800;
    const t0 = now();
    ufoSession = {
      until: t0 + dur,
      flyId: payload.flyId,
      saucer,
      beam,
      glow,
      rimLights,
      rimAnchors,
      physics: !!physics,
      lastSpinT: t0,
      abducting: false,
    };
    busyUntil = Math.max(busyUntil, t0 + dur);
    const ufoCamPull = 1.95;
    easeCamTo(
      new T.Vector3(p0[0] + 4.2 * ufoCamPull, p0[1] - 3.6 * ufoCamPull, 5.8 * ufoCamPull),
      new T.Vector3(p0[0], p0[1], 0.2),
      420,
      undefined,
      { orbit: true },
    );
    if (physics && f?.worker) {
      post(f, { op: 'ground' });
      post(f, { op: 'loose', on: true });
      post(f, { op: 'spin', on: true, wz: 10, turns: 0.45 });
      later(350, () => {
        if (ufoSession) ufoSession.abducting = true;
      });
    }
    tween(2200, u => {
      const p = f?.last?.pos || p0;
      const k = easeInOut(u);
      const top = top0 + (UFO_SAUCER_HOVER_Z - top0) * k;
      saucer.position.set(p[0], p[1], top);
      const fadeIn = Math.min(1, u / UFO_FADE_IN_FRAC);
      setUfoSaucerFade(saucer, fadeIn);
      if (ufoSession) ufoSession.fade = fadeIn;
      const beamCore = 0.5 + k * 0.32;
      placeUfoBeam(beam, p[0], p[1], 0.05, top - 0.35, beamCore * fadeIn);
      if (ufoSession?.glow) {
        ufoSession.glow.position.set(p[0], p[1], 0.35 + k * 1.05);
        ufoSession.glow.intensity = (12 + k * 33) * fadeIn;
      }
      tickUfoBeam(beam, now());
    }, () => {
      later(1400, () => {
        if (ufoSession) ufoSession.abducting = false;
        if (physics && f?.worker) {
          post(f, { op: 'pull', on: false });
          post(f, { op: 'spin', on: false });
          post(f, { op: 'bias', ax: 0, ay: 0 });
          post(f, { op: 'impulse', vx: randRange(-5, 5), vy: randRange(-5, 5), vz: -8 });
          later(400, () => post(f, { op: 'loose', on: false }));
        }
        tween(1800, u => {
          const p = f?.last?.pos || p0;
          const top = UFO_SAUCER_HOVER_Z + u * 6;
          saucer.position.set(p[0], p[1], top);
          const fadeStart = 1 - UFO_FADE_OUT_FRAC;
          const fadeOut = u < fadeStart ? 1 : 1 - easeInOut((u - fadeStart) / UFO_FADE_OUT_FRAC);
          setUfoSaucerFade(saucer, fadeOut);
          if (ufoSession) ufoSession.fade = fadeOut;
          placeUfoBeam(beam, p[0], p[1], 0.05, top - 0.2, 0.55 * fadeOut);
          if (ufoSession?.glow) ufoSession.glow.intensity = 18 * fadeOut;
        }, () => endUfo());
        later(1600, () => releaseCam(500));
      });
    });
  }

  function spikeTrap(payload, physics) {
    endSpikes();
    const { x, y } = payload;
    const half = payload.half || 1.08;
    const mesh = chaosMesh('spike_trap');
    if (!mesh) return;
    mesh.position.set(x, y, -0.55);
    mesh.rotation.z = payload.yaw || 0;
    fxGroup().add(mesh);
    const riseMs = 520;
    const holdMs = 2200;
    const t0 = now();
    spikesSession = {
      mesh, x, y, half, physics: !!physics, stabbing: true, hitIds: new Set(),
      until: t0 + riseMs + holdMs + 600,
    };
    busyUntil = Math.max(busyUntil, spikesSession.until);
    tween(riseMs, u => {
      mesh.position.z = -0.55 + (0.02 - -0.55) * easeInOut(u);
      // Lethal only while the points are punching up through a fly already on the pad.
      if (hostPhysics(physics) && u > 0.42) spikeTrapHits();
    }, () => {
      if (spikesSession) spikesSession.stabbing = false;
      later(holdMs, () => {
        tween(480, u => {
          mesh.position.z = 0.02 + (-0.55 - 0.02) * easeInOut(u);
        }, () => endSpikes());
      });
    });
    easeCamTo(new T.Vector3(x + 4.37, y - 2.99, 2.76), new T.Vector3(x, y, 0.15), 380, undefined, { orbit: true });
    later(2800, () => releaseCam(450));
  }

  function spikeTrapHits() {
    if (!spikesSession?.stabbing || !hostPhysics(spikesSession.physics)) return;
    const { x, y, half } = spikesSession;
    for (const f of liveFlies(flies())) {
      if (spikesSession.hitIds.has(f.id)) continue;
      const p = f.last?.pos;
      if (!p) continue;
      if (Math.abs(p[0] - x) > half || Math.abs(p[1] - y) > half) continue;
      if (f.last.flying) continue;
      const z = p[2] || 0;
      if (z > 0.28) continue;
      spikesSession.hitIds.add(f.id);
      post(f, { op: 'kill', cause: 'spikes' });
      hideToast();
    }
  }

  // Holy Hand Grenade: the named target is only an aim point. All rolls happen here on the
  // host and ride the cue, so watchers replay the same miss.
  const HOLY_SCALE = 1.8 / 5;
  const HOLY_GROUND_Z = 0.276 * HOLY_SCALE;
  // GLB is +Z-up, ~0.769 tall; blast disc is 5× that final height and kills inside it
  const HOLY_KILL_R = 0.769 * HOLY_SCALE * 5;
  const HOLY_IMPULSE_R = HOLY_KILL_R * 2.75;
  const HOLY_PIN_MS = 280;
  const HOLY_BEAT_MS = 650;
  const HOLY_OUTCOMES = [['miss', 0.4], ['close', 0.25], ['wild', 0.2], ['oops', 0.1], ['dud', 0.05]];

  function rollHolyOutcome() {
    let r = Math.random();
    for (const [k, w] of HOLY_OUTCOMES) if ((r -= w) < 0) return k;
    return 'miss';
  }

  function buildHolyPayload(live, opts = {}) {
    const thrower = live.length ? pick(live) : null;
    const sp = thrower?.last?.pos;
    const [sx, sy] = sp ? [sp[0], sp[1]] : randomInDish(2);
    const others = live.filter(f => f !== thrower);
    let target = null;
    if (others.length) {
      const yaw = thrower?.last?.yaw ?? 0;
      const ahead = others.filter(o => (o.last.pos[0] - sx) * Math.cos(yaw) + (o.last.pos[1] - sy) * Math.sin(yaw) > 0);
      target = pick(ahead.length ? ahead : others);
    }
    const sugar = sugarDisc();
    let ax, ay;
    if (target) [ax, ay] = target.last.pos;
    else {
      const a = Math.random() * Math.PI * 2, d = randRange(1.5, 3);
      ax = sugar.x + Math.cos(a) * d;
      ay = sugar.y + Math.sin(a) * d;
    }
    const outcome = HOLY_OUTCOMES.some(([k]) => k === opts.outcome) ? opts.outcome : rollHolyOutcome();
    const throwAz = Math.atan2(ay - sy, ax - sx);
    // long or short along the throw line, with up to 35° of aim error
    const offsetAround = (lo, hi) => {
      const az = throwAz + (Math.random() < 0.5 ? 0 : Math.PI) + randRange(-1, 1) * Math.PI * 35 / 180;
      const d = randRange(lo, hi);
      return [ax + Math.cos(az) * d, ay + Math.sin(az) * d];
    };
    let land;
    if (outcome === 'close') land = offsetAround(0.4, 1.1);
    else if (outcome === 'dud') land = offsetAround(0.3, 1.2);
    else if (outcome === 'oops') {
      const a = Math.random() * Math.PI * 2, d = randRange(0.15, 0.5);
      land = [sx + Math.cos(a) * d, sy + Math.sin(a) * d];
    } else if (outcome === 'wild') {
      land = randomInDish(1.4);
      for (let i = 0; i < 40 && Math.hypot(land[0] - sugar.x, land[1] - sugar.y) < sugar.r + HOLY_KILL_R; i++) land = randomInDish(1.4);
    } else land = offsetAround(1.4, 2.6);
    let wind = [0, 0];
    const env = api.env();
    const w = env?.wind;
    const wMag = w ? Math.hypot(w[0], w[1]) : 0;
    if (outcome !== 'oops' && env?.arena?.shape === 'square' && wMag > 1e-6) {
      const k = randRange(0.4, 1.0) / wMag;
      wind = [w[0] * k, w[1] * k];
      land = [land[0] + wind[0], land[1] + wind[1]];
    }
    land = clampIntoArena(land[0], land[1], 1.4);
    const dist = Math.hypot(land[0] - sx, land[1] - sy);
    const gag = opts.gag ?? Math.random() < 0.12;
    return {
      kind: 'holy',
      flyId: thrower?.id ?? null,
      name: thrower?.name || '',
      color: thrower?.color || '#fff',
      x: land[0], y: land[1], yaw: 0, deg: 0, points: [], hitBolt: null, killed: false,
      holy: {
        throwerId: thrower?.id ?? null,
        throwerName: thrower?.name || '',
        targetId: target?.id ?? null,
        targetName: target?.name || '',
        start: { x: sx, y: sy, z: (sp?.[2] ?? 0.13) + 0.25 },
        land: { x: land[0], y: land[1] },
        apexZ: 1.2 + Math.min(2.8, dist * 0.22),
        flightMs: Math.round(700 + Math.min(400, dist * 45)),
        count: gag ? [1, 2, 5, 3] : [1, 2, 3],
        dud: outcome === 'dud',
        outcome,
        wind,
        killR: HOLY_KILL_R,
        impulseR: HOLY_IMPULSE_R,
      },
    };
  }

  function holyUnpin() {
    const s = holySession;
    if (!s?.pinned) return;
    s.pinned = false;
    if (s.physics) post(flies().find(x => x.id === s.throwerId), { op: 'pin', on: false });
  }

  function disposeHolyLabel(s) {
    if (!s.label) return;
    s.label.material.map?.dispose();
    s.label.material.dispose();
    s.label.parent?.remove(s.label);
    s.label = null;
  }

  function setHolyLabel(text) {
    const s = holySession;
    if (!s) return;
    if (!s.label) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const tex = new T.CanvasTexture(canvas);
      tex.colorSpace = T.SRGBColorSpace;
      s.label = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }));
      s.label.renderOrder = 20;
      s.labelCanvas = canvas;
      fxGroup().add(s.label);
    }
    const g = s.labelCanvas.getContext('2d');
    g.clearRect(0, 0, 256, 256);
    g.font = '200px "Luckiest Guy", Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 18;
    g.strokeStyle = '#2a1812';
    g.strokeText(text, 128, 140);
    g.fillStyle = text === '5' ? '#ff5a3c' : '#ffffff';
    g.fillText(text, 128, 140);
    s.label.material.map.needsUpdate = true;
    s.label.position.set(s.land.x, s.land.y, HOLY_GROUND_Z * 2 + 1.0);
    const label = s.label;
    tween(180, u => label.scale.setScalar(1.3 * (1.6 - 0.6 * easeInOut(u))));
  }

  function endHoly() {
    const s = holySession;
    if (!s) return;
    holyUnpin();
    disposeHolyLabel(s);
    if (s.grenade) disposeObj(s.grenade);
    if (s.fireball) disposeObj(s.fireball);
    releaseLight(s.light);
    holySession = null;
  }

  function holyThrow(payload, physics) {
    endHoly();
    const h = payload.holy;
    if (!h) return;
    const { start, land } = h;
    const beats = h.count?.length ? h.count : [1, 2, 3];
    const landAt = HOLY_PIN_MS + h.flightMs;
    const t0 = now();
    const grenade = chaosMesh('grenade');
    holySession = {
      h, grenade, physics: !!physics, throwerId: h.throwerId, land, pinned: false,
      label: null, labelCanvas: null, fireball: null, light: null,
    };
    busyUntil = Math.max(busyUntil, t0 + landAt + 300 + beats.length * HOLY_BEAT_MS + 1800);
    if (grenade) {
      grenade.scale.setScalar(HOLY_SCALE * 0.35);
      grenade.position.set(start.x, start.y, start.z);
      fxGroup().add(grenade);
    }
    const CAM_OFF = new T.Vector3(3.4, -3.1, 2.6);
    easeCamTo(
      new T.Vector3(start.x, start.y, 0.3).add(CAM_OFF),
      new T.Vector3(start.x, start.y, 0.3),
      HOLY_PIN_MS + 80,
      undefined,
      { orbit: true },
    );
    if (physics) {
      const f = flies().find(x => x.id === h.throwerId);
      if (f?.worker) {
        post(f, { op: 'pin', on: true });
        holySession.pinned = true;
      }
    }
    const z0 = start.z + 0.3;
    tween(HOLY_PIN_MS, u => {
      if (!grenade) return;
      grenade.scale.setScalar(HOLY_SCALE * (0.35 + 0.65 * easeInOut(u)));
      grenade.position.z = start.z + 0.3 * u;
    }, () => {
      // oops: the thrower freezes in shock until the boom
      if (h.outcome !== 'oops') holyUnpin();
      api.audio()?.playHolyWhoosh?.();
      // Worms-style chase cam: rides along with the grenade, settles over the landing spot
      const cam = api.camera(), ctl = api.controls();
      if (ctl) ctl.enabled = false;
      const aim = new T.Vector3();
      tween(h.flightMs, u => {
        // straight line from hand to floor plus a parabolic hump of height apexZ
        const x = start.x + (land.x - start.x) * u, y = start.y + (land.y - start.y) * u;
        const z = z0 + (HOLY_GROUND_Z - z0) * u + 4 * h.apexZ * u * (1 - u);
        if (grenade) {
          grenade.position.set(x, y, z);
          grenade.rotation.set(u * 7.5, u * 3.1, 0);
        }
        if (cam && ctl && holySession?.h === h) {
          aim.set(x, y, 0.3 + (z - 0.3) * 0.5);
          ctl.target.lerp(aim, 0.25);
          cam.position.lerp(aim.clone().add(CAM_OFF).addScaledVector(CAM_OFF, 0.25 * Math.sin(u * Math.PI)), 0.25);
          aimCam();
        }
      }, () => {
        if (cam && ctl && holySession?.h === h) {
          easeCamTo(new T.Vector3(land.x, land.y, 0.3).add(CAM_OFF), new T.Vector3(land.x, land.y, 0.3), 220);
        }
        holyLanded(h, physics);
      });
    });
  }

  function holyLanded(h, physics) {
    const s = holySession;
    if (s?.h !== h) return;
    const g = s.grenade;
    if (g) {
      g.position.set(h.land.x, h.land.y, HOLY_GROUND_Z);
      tween(700, u => {
        const k = (1 - u) * (1 - u);
        g.rotation.set(Math.sin(u * 18) * 0.35 * k, Math.cos(u * 14) * 0.22 * k, 0);
      });
    }
    camShake(120, 0.08);
    api.audio()?.playHolyThud?.();
    const beats = h.count?.length ? h.count : [1, 2, 3];
    beats.forEach((n, i) => later(300 + i * HOLY_BEAT_MS, () => {
      if (holySession?.h !== h) return;
      setHolyLabel(String(n));
      api.audio()?.playHolyCount?.(n, i === beats.length - 1);
      if (g) tween(140, u => g.scale.setScalar(HOLY_SCALE * (1 + 0.12 * Math.sin(u * Math.PI))));
    }));
    later(300 + beats.length * HOLY_BEAT_MS + 150, () => holyBoom(h, physics));
  }

  function holyBoom(h, physics) {
    const s = holySession;
    if (s?.h !== h) return;
    const { x, y } = h.land;
    holyUnpin();
    disposeHolyLabel(s);
    ensureMeteorSmoke();
    const smoke = allocMeteorSmokeBatch();
    const smokeR = h.dud ? h.killR * 0.45 : h.killR * 2;
    burstMeteorSmoke(x, y, 0.1, smoke, smokeR);
    api.audio()?.playHolyBoom?.(!!h.dud);
    if (h.dud) {
      sealMeteorSmokeBatch(smoke, now());
      lastToast = { kind: 'holy', name: { dud: true } };
      const copy = chaosCopy('holy', { dud: true });
      showToast(copy.title, copy.line);
      const g = s.grenade;
      if (g) tween(700, u => { g.rotation.set(0, easeInOut(u) * 1.45, 0); });
      if (hostPhysics(physics)) {
        const r = h.impulseR * 0.6;
        for (const f of liveFlies(flies())) {
          const p = f.last.pos, d = Math.hypot(p[0] - x, p[1] - y);
          if (d >= r || d < 0.02) continue;
          const k = (1 - d / r) * 3;
          post(f, { op: 'impulse', vx: ((p[0] - x) / d) * k, vy: ((p[1] - y) / d) * k, vz: 1 });
        }
      }
      later(1500, () => { if (holySession?.h === h) { endHoly(); releaseCam(500); } });
      return;
    }
    if (s.grenade) { disposeObj(s.grenade); s.grenade = null; }
    const fb = new T.Group();
    const fireMat = c => new T.MeshBasicMaterial({ color: c, transparent: true, depthWrite: false, toneMapped: false });
    const outer = new T.Mesh(new T.SphereGeometry(1, 20, 14), fireMat('#ff9a2e'));
    const core = new T.Mesh(new T.SphereGeometry(1, 16, 12), fireMat('#fff3c4'));
    fb.add(outer, core);
    fb.position.set(x, y, 0.3);
    fxGroup().add(fb);
    s.fireball = fb;
    tween(520, u => {
      const e = 1 - (1 - u) ** 3;
      outer.scale.setScalar(0.3 + e * h.killR * 1.9);
      core.scale.setScalar(0.2 + e * h.killR * 1.1);
      outer.material.opacity = 1 - u;
      core.material.opacity = Math.max(0, 1 - u * 1.6);
    }, () => {
      disposeObj(fb);
      if (holySession) holySession.fireball = null;
    });
    const light = borrowLight({ color: '#ffb050', distance: Math.max(6, h.killR * 7) });
    s.light = light;
    if (light) {
      light.position.set(x, y, 0.8);
      tween(600, u => { light.intensity = 30 * (1 - u); });
    }
    burstMeteorSmoke(x, y, 0.25, smoke, smokeR);
    sealMeteorSmokeBatch(smoke, now());
    camShake(380, 0.4);
    scorches.push({ x, y, r: h.killR * scorchScale(), until: now() + 15000 });
    api.repaintFloor?.();
    if (hostPhysics(physics)) {
      for (const f of liveFlies(flies())) {
        const p = f.last.pos, d = Math.hypot(p[0] - x, p[1] - y);
        if (d < h.killR && (p[2] || 0) < 0.6) {
          post(f, f.id === h.throwerId
            ? { op: 'kill', cause: 'holySelf' }
            : { op: 'kill', cause: 'holy', by: h.throwerName || '' });
          hideToast();
        } else if (d < h.impulseR && d > 0.02) {
          const k = (1 - d / h.impulseR) * 16;
          post(f, { op: 'impulse', vx: ((p[0] - x) / d) * k, vy: ((p[1] - y) / d) * k, vz: 4 + k * 0.4 });
        }
      }
    }
    later(1300, () => { if (holySession?.h === h) { endHoly(); releaseCam(500); } });
  }

  // ---------------------------------------------------------------------------
  // Fly-on-fly weapons. Hits spend the victim's health (`op: 'damage'`) instead of
  // killing, so only a rocket landing inside killR finishes anyone outright. Aim
  // error is the lethality knob. Every delayed hit is behind hostPhysics().
  // ---------------------------------------------------------------------------
  // GLBs are built ~1 unit long pointing +X. From the race camera (~30 cm back) a fly is
  // only ~9 px long, so a to-scale gun is a smudge; at this scale it reads ~30 px, about
  // 3x the fly — Worms-sized rather than absurd. Hold point and barrel tip derive from the
  // scale so resizing moves them together.
  const WEAPON_SCALE = 0.9;
  const HOLD = { ahead: WEAPON_SCALE * 0.26, up: WEAPON_SCALE * 0.15 };
  const MUZZLE_AHEAD = WEAPON_SCALE * 0.88;
  function weaponMuzzle(f, ahead = MUZZLE_AHEAD) { return muzzleOf(f, ahead, HOLD.up); }

  function ensureTracerPool() {
    if (!tracerPool) {
      tracerPool = createTracerPool(T);
      fxGroup().add(tracerPool.group);
    }
    return tracerPool;
  }

  function weaponArena() { return api.env()?.arena || { radius: radius(), wallHeight: 8 }; }
  function weaponSolids() { return collectLaserSolids(api.env()); }

  /** Props sit in world space and are re-placed every frame, so they track the holder. */
  function heldWeapon(f, prop, pose) {
    const mesh = chaosMesh(prop);
    if (!mesh) return null;
    mesh.scale.setScalar(WEAPON_SCALE);
    placeHeldProp(mesh, f, pose);
    fxGroup().add(mesh);
    return mesh;
  }

  function endWeapons() {
    const s = weaponSession;
    weaponSession = null;
    if (!s) return;
    api.audio()?.stopMinigunLoop?.();
    for (const m of s.props || []) disposeObj(m);
    for (const id of s.pinned || []) post(flies().find(x => x.id === id), { op: 'pin', on: false });
    hideTracerPool(tracerPool);
  }

  function beginWeapons(kind, physics, props) {
    endWeapons();
    weaponSession = { kind, physics: !!physics, props: props.filter(Boolean), pinned: [] };
    return weaponSession;
  }

  function weaponShooter(payload) {
    const id = payload.weapon?.shooterId;
    return id == null ? null : flies().find(f => f.id === id) || null;
  }

  function aimPointOf(f, fallback) {
    const p = f?.last?.pos;
    if (!p) return fallback;
    return { x: p[0], y: p[1], z: (p[2] ?? 0.13) + 0.02 };
  }

  /** One wound. Returns false when the victim is already gone. */
  function woundFly(victimId, amount, cause, byName, knock) {
    const v = flies().find(x => x.id === victimId);
    if (!v?.worker || v.last?.alive === false) return false;
    post(v, { op: 'damage', amount, cause, by: byName || '', ...(knock || {}) });
    return true;
  }

  /** Radial wound + shove. Direct kills are the caller's job (pass them in `skip`). */
  function splashFlies(x, y, spec, byName, skip) {
    for (const f of liveFlies(flies())) {
      if (skip?.has(f.id)) continue;
      const p = f.last.pos;
      const d = Math.hypot(p[0] - x, p[1] - y);
      const amount = splashAmount(d, spec.splashR, spec.splashMax, spec.splashMin);
      if (amount <= 0) continue;
      const k = (1 - d / spec.splashR) * spec.knock;
      const ux = d > 0.02 ? (p[0] - x) / d : 0;
      const uy = d > 0.02 ? (p[1] - y) / d : 0;
      woundFly(f.id, amount, spec.cause, byName, { vx: ux * k, vy: uy * k, vz: 3 + k * 0.3 });
    }
  }

  function muzzleFlash(origin, size = 0.22, ms = 110) {
    const mat = new T.MeshBasicMaterial({ color: '#ffd66b', transparent: true, depthWrite: false, toneMapped: false });
    const m = new T.Mesh(new T.SphereGeometry(1, 10, 8), mat);
    m.position.set(origin.x, origin.y, origin.z);
    m.scale.setScalar(size);
    fxGroup().add(m);
    tween(ms, u => { m.scale.setScalar(size * (1 + u * 0.8)); mat.opacity = 1 - u; }, () => disposeObj(m));
  }

  function minigunRound(shooter, w, spec, physics, pool) {
    const origin = weaponMuzzle(shooter);
    if (!origin) return;
    const straight = { x: origin.x + Math.cos(origin.yaw) * 6, y: origin.y + Math.sin(origin.yaw) * 6, z: origin.z };
    const aim = aimPointOf(flies().find(f => f.id === w.targetId), straight);
    const dir = shotDir(origin, aim, jitterFor(spec, Math.hypot(aim.x - origin.x, aim.y - origin.y)));
    const hit = castShot(origin, dir, shooter.id, flies(), weaponArena(), weaponSolids());
    fireTracer(pool, T, origin, hit, { ms: 110, radius: 0.055, color: '#ffe9a0' });
    if (Math.random() < 0.5) muzzleFlash(origin, 0.3, 90);
    api.audio()?.playMinigunRound?.();
    if (hit.type === 'fly' && hit.victimId != null && hostPhysics(physics)) {
      woundFly(hit.victimId, spec.damage, spec.cause, shooter.name, { vx: dir.x * spec.knock, vy: dir.y * spec.knock, vz: 1 });
    }
  }

  function minigunBurst(payload, physics) {
    const spec = WEAPONS.minigun;
    const w = payload.weapon;
    const shooter = weaponShooter(payload);
    if (!w || !shooter?.last) return;
    const pose = { ...HOLD };
    const gun = heldWeapon(shooter, spec.prop, pose);
    const pool = ensureTracerPool();
    const s = beginWeapons('minigun', physics, [gun]);
    if (hostPhysics(physics) && shooter.worker) {
      post(shooter, { op: 'pin', on: true });
      s.pinned.push(shooter.id);
    }
    const total = spec.windupMs + spec.rounds * spec.intervalMs + 300;
    busyUntil = Math.max(busyUntil, now() + total + 400);
    api.audio()?.startMinigunSpin?.();
    tween(total, u => {
      if (weaponSession !== s || !gun) return;
      placeHeldProp(gun, shooter, { ...pose, roll: u * total * 0.028 });
    }, () => { if (weaponSession === s) endWeapons(); });
    for (let i = 0; i < spec.rounds; i++) {
      later(spec.windupMs + i * spec.intervalMs, () => {
        if (weaponSession !== s) return;
        minigunRound(shooter, w, spec, physics, pool);
      });
    }
    camPullBack(1.05, 420, { orbit: true });
    later(total, () => releaseCam(420));
  }

  function shotgunBlast(payload, physics) {
    const spec = WEAPONS.shotgun;
    const w = payload.weapon;
    const shooter = weaponShooter(payload);
    if (!w || !shooter?.last) return;
    const pose = { ...HOLD };
    const gun = heldWeapon(shooter, spec.prop, pose);
    const pool = ensureTracerPool();
    const s = beginWeapons('shotgun', physics, [gun]);
    busyUntil = Math.max(busyUntil, now() + 2000);
    const victim = flies().find(f => f.id === w.targetId);
    if (victim?.last) {
      const p = victim.last.pos;
      easeCamTo(new T.Vector3(p[0] - 2.8, p[1] - 2.4, (p[2] || 0.13) + 2), new T.Vector3(p[0], p[1], p[2]), 280, undefined, { orbit: true });
    }
    // Recoil: the gun kicks back on the shot, then settles.
    tween(1500, u => {
      if (weaponSession !== s || !gun) return;
      const kick = u < 0.28 ? Math.sin((u / 0.28) * Math.PI) : 0;
      placeHeldProp(gun, shooter, { ...pose, ahead: pose.ahead - kick * 0.2, roll: -kick * 0.5 });
    }, () => { if (weaponSession === s) { endWeapons(); releaseCam(420); } });
    later(420, () => {
      if (weaponSession !== s) return;
      const origin = weaponMuzzle(shooter);
      if (!origin) return;
      const straight = { x: origin.x + Math.cos(origin.yaw) * 4, y: origin.y + Math.sin(origin.yaw) * 4, z: origin.z };
      const aim = aimPointOf(flies().find(f => f.id === w.targetId), straight);
      // The cone widens with range, so distance falloff is the spread, not a multiplier.
      const jitter = jitterFor(spec, Math.hypot(aim.x - origin.x, aim.y - origin.y));
      const pellets = new Map();
      for (let i = 0; i < spec.pellets; i++) {
        const dir = shotDir(origin, aim, jitter);
        const hit = castShot(origin, dir, shooter.id, flies(), weaponArena(), weaponSolids());
        fireTracer(pool, T, origin, hit, { ms: 170, radius: 0.042, color: '#fff0c0' });
        if (hit.type === 'fly' && hit.victimId != null) pellets.set(hit.victimId, (pellets.get(hit.victimId) || 0) + 1);
      }
      muzzleFlash(origin, 0.5, 170);
      camShake(170, 0.13);
      if (!hostPhysics(physics)) return;
      for (const [victimId, n] of pellets) {
        const v = flies().find(x => x.id === victimId);
        const p = v?.last?.pos;
        if (!p) continue;
        const d = Math.hypot(p[0] - origin.x, p[1] - origin.y);
        const ux = d > 0.02 ? (p[0] - origin.x) / d : Math.cos(origin.yaw);
        const uy = d > 0.02 ? (p[1] - origin.y) / d : Math.sin(origin.yaw);
        woundFly(victimId, spec.damage * n, spec.cause, shooter.name,
          { vx: ux * spec.knock, vy: uy * spec.knock, vz: 3 });
      }
    });
  }

  function taserZap(payload, physics) {
    const spec = WEAPONS.taser;
    const w = payload.weapon;
    const shooter = weaponShooter(payload);
    if (!w || !shooter?.last) return;
    const pose = { ...HOLD };
    const gun = heldWeapon(shooter, spec.prop, pose);
    const pool = ensureTracerPool();
    const s = beginWeapons('taser', physics, [gun]);
    busyUntil = Math.max(busyUntil, now() + 2800);
    const victim = flies().find(f => f.id === w.targetId);
    if (victim?.last) {
      const p = victim.last.pos;
      easeCamTo(new T.Vector3(p[0] - 2.2, p[1] - 1.9, (p[2] || 0.13) + 1.6), new T.Vector3(p[0], p[1], p[2]), 260, undefined, { orbit: true });
    }
    const arcLight = borrowLight({ color: '#8fd8ff', distance: 4 });
    tween(2300, u => {
      if (weaponSession !== s) return;
      if (gun) placeHeldProp(gun, shooter, pose);
      const live = u < 0.62;
      const o = weaponMuzzle(shooter, WEAPON_SCALE * 0.52);   // stubby prongs, not a barrel
      if (arcLight) arcLight.intensity = live ? (6 + Math.random() * 10) : 0;
      if (arcLight && o) arcLight.position.set(o.x, o.y, o.z);
      if (!live || !o || !victim?.last || Math.random() > 0.65) return;
      const p = victim.last.pos;
      fireTracer(pool, T, o, {
        x: p[0] + (Math.random() - 0.5) * 0.12,
        y: p[1] + (Math.random() - 0.5) * 0.12,
        z: (p[2] ?? 0.13) + 0.05,
      }, { ms: 70, radius: 0.04, color: '#9fe4ff' });
    }, () => {
      if (arcLight) releaseLight(arcLight);
      if (weaponSession === s) { endWeapons(); releaseCam(420); }
    });
    if (!hostPhysics(physics) || !victim) return;
    post(victim, { op: 'zap', ms: spec.zapMs, amount: spec.damage, cause: spec.cause, by: shooter.name || '' });
    if (w.chainId == null) return;
    later(280, () => {
      if (!hostPhysics(physics)) return;
      const chain = flies().find(f => f.id === w.chainId);
      if (!chain || chain.last?.alive === false) return;
      const o = muzzleOf(victim, 0.1, 0.05);
      const p = chain.last.pos;
      if (o) fireTracer(pool, T, o, { x: p[0], y: p[1], z: (p[2] ?? 0.13) + 0.05 }, { ms: 140, radius: 0.045, color: '#9fe4ff' });
      post(chain, { op: 'zap', ms: spec.zapMs * 0.6, amount: spec.damage * 0.5, cause: spec.cause, by: shooter.name || '' });
    });
  }

  function rocketImpact(kind, w, physics, impact = w.land) {
    const spec = WEAPONS[kind];
    const { x, y } = impact;
    ensureMeteorSmoke();
    const smoke = allocMeteorSmokeBatch();
    burstMeteorSmoke(x, y, 0.15, smoke, spec.splashR * 1.4);
    sealMeteorSmokeBatch(smoke, now());
    api.audio()?.playRocketBoom?.();
    const fb = new T.Group();
    const fireMat = c => new T.MeshBasicMaterial({ color: c, transparent: true, depthWrite: false, toneMapped: false });
    const outer = new T.Mesh(new T.SphereGeometry(1, 18, 12), fireMat('#ff9a2e'));
    const core = new T.Mesh(new T.SphereGeometry(1, 14, 10), fireMat('#fff3c4'));
    fb.add(outer, core);
    fb.position.set(x, y, 0.25);
    fxGroup().add(fb);
    tween(460, u => {
      const e = 1 - (1 - u) ** 3;
      outer.scale.setScalar(0.2 + e * spec.splashR * 1.2);
      core.scale.setScalar(0.12 + e * spec.splashR * 0.7);
      outer.material.opacity = 1 - u;
      core.material.opacity = Math.max(0, 1 - u * 1.6);
    }, () => disposeObj(fb));
    const light = borrowLight({ color: '#ffb050', distance: Math.max(5, spec.splashR * 6) });
    if (light) {
      light.position.set(x, y, 0.7);
      tween(520, u => { light.intensity = 26 * (1 - u); }, () => releaseLight(light));
    }
    camShake(320, 0.32);
    scorches.push({ x, y, r: spec.splashR * 0.55 * scorchScale(), until: now() + 15000 });
    api.repaintFloor?.();
    later(900, () => releaseCam(480));
    if (!hostPhysics(physics)) return;
    const killed = new Set();
    // A locked shot kills by identity: the rocket tracked the fly all the way in, so it
    // connects even though the fly has walked well past `killR` of the original aim point.
    for (const f of liveFlies(flies())) {
      const p = f.last.pos;
      const locked = w.lockId != null && f.id === w.lockId;
      if (!locked && (Math.hypot(p[0] - x, p[1] - y) >= spec.killR || (p[2] || 0) >= 0.6)) continue;
      post(f, f.id === w.shooterId
        ? { op: 'kill', cause: `${spec.cause}Self` }
        : { op: 'kill', cause: spec.cause, by: w.shooterName || '' });
      killed.add(f.id);
      hideToast();
    }
    splashFlies(x, y, spec, w.shooterName, killed);
  }

  /** Bazooka and missile share one flight: a fixed land point so watchers replay it exactly. */
  function rocketFlight(kind, payload, physics) {
    const spec = WEAPONS[kind];
    const w = payload.weapon;
    const shooter = weaponShooter(payload);
    if (!w?.land || !w.start) return;
    const pose = { ...HOLD };
    const launcher = kind === 'bazooka' && shooter?.last ? heldWeapon(shooter, spec.prop, pose) : null;
    const rocket = chaosMesh('missile');
    const s = beginWeapons(kind, physics, [launcher, rocket]);
    const flightMs = w.flightMs || 900;
    busyUntil = Math.max(busyUntil, now() + flightMs + 1900);
    if (rocket) {
      rocket.scale.setScalar(WEAPON_SCALE * 0.45);
      rocket.position.set(w.start.x, w.start.y, w.start.z);
      fxGroup().add(rocket);
    }
    if (hostPhysics(physics) && shooter?.worker) {
      post(shooter, { op: 'pin', on: true });
      s.pinned.push(shooter.id);
    }
    api.audio()?.playRocketLaunch?.(kind === 'missile');
    const o = weaponMuzzle(shooter);
    if (o) muzzleFlash(o, 0.34, 150);
    ensureMeteorSmoke();
    const trail = allocMeteorSmokeBatch();
    const cam = api.camera(), ctl = api.controls();
    const camOff = new T.Vector3(3, -2.8, 2.2);
    easeCamTo(
      new T.Vector3(w.start.x, w.start.y, 0.3).add(camOff),
      new T.Vector3(w.start.x, w.start.y, 0.3),
      220, undefined, { orbit: true },
    );
    const aim = new T.Vector3();
    let px = w.start.x, py = w.start.y, pz = w.start.z;
    // The missile weaves before it converges; the bazooka flies a flat arc.
    const weave = kind === 'missile' ? (w.weave ?? 0.9) : 0;
    // A locked shot chases the fly's live pose, so host and watcher both draw it arriving
    // on the victim. `w.land` stays the fallback for an unlocked shot or a dead lock.
    const lockPoint = () => {
      if (w.lockId == null) return w.land;
      const f = flies().find(x => x.id === w.lockId);
      const p = f?.last?.pos;
      return p && f.last.alive !== false ? { x: p[0], y: p[1] } : w.land;
    };
    let impact = lockPoint();
    tween(flightMs, u => {
      if (weaponSession !== s) return;
      impact = lockPoint();
      const e = kind === 'missile' ? u * u * (3 - 2 * u) : u;
      const bend = Math.sin(u * Math.PI * 1.5) * weave * (1 - u);
      const nx = -(impact.y - w.start.y), ny = impact.x - w.start.x;
      const nlen = Math.hypot(nx, ny) || 1;
      const x = w.start.x + (impact.x - w.start.x) * e + (nx / nlen) * bend;
      const y = w.start.y + (impact.y - w.start.y) * e + (ny / nlen) * bend;
      const z = w.start.z + (0.1 - w.start.z) * e + 4 * (w.apexZ ?? 0.5) * u * (1 - u);
      if (rocket) {
        rocket.position.set(x, y, z);
        const dx = x - px, dy = y - py, dz = z - pz;
        if (Math.hypot(dx, dy, dz) > 1e-4) {
          rocket.rotation.set(0, -Math.atan2(dz, Math.hypot(dx, dy)), Math.atan2(dy, dx));
        }
      }
      emitMeteorSmokeAlongSegment(px, py, pz, x, y, z, trail);
      px = x; py = y; pz = z;
      if (cam && ctl && weaponSession === s) {
        aim.set(x, y, 0.3 + (z - 0.3) * 0.5);
        ctl.target.lerp(aim, 0.22);
        cam.position.lerp(aim.clone().add(camOff), 0.22);
        aimCam();
      }
    }, () => {
      sealMeteorSmokeBatch(trail, now());
      if (rocket) { disposeObj(rocket); s.props = s.props.filter(m => m !== rocket); }
      for (const id of s.pinned) post(flies().find(x => x.id === id), { op: 'pin', on: false });
      s.pinned = [];
      rocketImpact(kind, w, physics, impact);
      later(1400, () => { if (weaponSession === s) endWeapons(); });
    });
  }

  function chickenToss(payload, physics) {
    const spec = WEAPONS.chicken;
    const w = payload.weapon;
    const shooter = weaponShooter(payload);
    if (!w?.land || !w.start) return;
    const bird = chaosMesh(spec.prop);
    const s = beginWeapons('chicken', physics, [bird]);
    const flightMs = w.flightMs || 850;
    busyUntil = Math.max(busyUntil, now() + flightMs + 1800);
    if (bird) {
      bird.scale.setScalar(WEAPON_SCALE * 0.85);
      bird.position.set(w.start.x, w.start.y, w.start.z);
      fxGroup().add(bird);
    }
    api.audio()?.playChickenThrow?.();
    const camOff = new T.Vector3(2.8, -2.6, 2);
    easeCamTo(
      new T.Vector3(w.start.x, w.start.y, 0.3).add(camOff),
      new T.Vector3(w.start.x, w.start.y, 0.3),
      200, undefined, { orbit: true },
    );
    tween(flightMs, u => {
      if (weaponSession !== s || !bird) return;
      bird.position.set(
        w.start.x + (w.land.x - w.start.x) * u,
        w.start.y + (w.land.y - w.start.y) * u,
        w.start.z + (0.1 - w.start.z) * u + 4 * (w.apexZ ?? 1.1) * u * (1 - u),
      );
      bird.rotation.set(u * 9, 0, u * 5.5);
    }, () => {
      if (weaponSession !== s) return;
      const { x, y } = w.land;
      if (bird) {
        bird.position.set(x, y, 0.12);
        bird.rotation.set(Math.PI / 2, 0, Math.random() * Math.PI * 2);
        tween(900, u => { bird.scale.setScalar(WEAPON_SCALE * 0.85 * (1 + 0.25 * Math.sin(u * Math.PI * 3) * (1 - u))); });
      }
      api.audio()?.playChickenSquawk?.();
      camShake(240, 0.2);
      const flash = new T.Mesh(
        new T.RingGeometry(0.1, spec.knockR, 36),
        new T.MeshBasicMaterial({ color: '#ffe066', transparent: true, depthWrite: false, side: T.DoubleSide, toneMapped: false }),
      );
      flash.position.set(x, y, 0.03);
      fxGroup().add(flash);
      tween(420, u => {
        flash.scale.setScalar(0.3 + u * 0.9);
        flash.material.opacity = 0.75 * (1 - u);
      }, () => disposeObj(flash));
      later(1300, () => { if (weaponSession === s) endWeapons(); });
      later(900, () => releaseCam(460));
      if (!hostPhysics(physics)) return;
      // No damage at all — the chicken is pure knockback.
      postAll({ op: 'loose', on: true });
      for (const f of liveFlies(flies())) {
        const p = f.last.pos;
        const d = Math.hypot(p[0] - x, p[1] - y);
        if (d >= spec.knockR) continue;
        const k = (1 - d / spec.knockR) * spec.knock;
        const ux = d > 0.02 ? (p[0] - x) / d : Math.cos(Math.random() * 6.28);
        const uy = d > 0.02 ? (p[1] - y) / d : Math.sin(Math.random() * 6.28);
        post(f, { op: 'impulse', vx: ux * k, vy: uy * k, vz: 4 + k * 0.3, wz: (Math.random() - 0.5) * 30 });
      }
      later(800, () => postAll({ op: 'loose', on: false }));
    });
  }

  function playWeapon(kind, payload, physics) {
    if (kind === 'minigun') minigunBurst(payload, physics);
    else if (kind === 'shotgun') shotgunBlast(payload, physics);
    else if (kind === 'taser') taserZap(payload, physics);
    else if (kind === 'chicken') chickenToss(payload, physics);
    else rocketFlight(kind, payload, physics);
  }

  /**
   * Weapon payloads are frozen on the host: shooter, victim and (for the lobbed kinds) the
   * exact landing spot, so a watcher replays the same shot without live fly positions.
   */
  function buildWeaponPayload(kind, live, opts = {}) {
    const spec = WEAPONS[kind];
    let shooter = opts.flyId != null ? live.find(f => f.id === opts.flyId) : null;
    let target = null;
    if (shooter) target = nearestTarget(live, shooter);
    else {
      const duel = pickDuel(live);
      shooter = duel.shooter;
      target = duel.target;
    }
    // Short-range weapons go for whoever is closest, not whoever is in front.
    if (shooter && (kind === 'taser' || kind === 'shotgun')) target = nearestTarget(live, shooter) || target;
    const sp = shooter?.last?.pos;
    const [sx, sy] = sp ? [sp[0], sp[1]] : randomInDish(2);
    const sz = (sp?.[2] ?? 0.13) + 0.2;
    const weapon = {
      shooterId: shooter?.id ?? null,
      shooterName: shooter?.name || '',
      targetId: target?.id ?? null,
      targetName: target?.name || '',
    };
    if (kind === 'taser') {
      const chain = live.find(f => f !== shooter && f !== target
        && target?.last?.pos
        && Math.hypot(f.last.pos[0] - target.last.pos[0], f.last.pos[1] - target.last.pos[1]) < spec.chainR);
      weapon.chainId = (chain && Math.random() < spec.chainChance) ? chain.id : null;
    }
    if (kind === 'bazooka' || kind === 'missile' || kind === 'chicken') {
      const tp = target?.last?.pos;
      const directChance = kind === 'missile' ? 0.42 : kind === 'bazooka' ? 0.3 : 0.5;
      const direct = opts.direct ?? Math.random() < directChance;
      let land;
      if (tp && direct) land = [tp[0], tp[1]];
      else if (tp) {
        const az = Math.atan2(tp[1] - sy, tp[0] - sx) + (Math.random() < 0.5 ? 0 : Math.PI) + randRange(-1, 1) * 0.5;
        const off = kind === 'missile' ? randRange(0.5, 1.5) : randRange(0.7, 2.3);
        land = [tp[0] + Math.cos(az) * off, tp[1] + Math.sin(az) * off];
      } else land = randomInDish(1.2);
      land = clampIntoArena(land[0], land[1], 1);
      const dist = Math.hypot(land[0] - sx, land[1] - sy);
      weapon.start = { x: sx, y: sy, z: sz };
      weapon.land = { x: land[0], y: land[1] };
      weapon.direct = direct;
      // Rockets that roll a direct hit lock on, so the flight tracks the fly instead of a
      // stale spot it has walked 2 cm away from by impact. The chicken only ever lobs.
      if (direct && target && kind !== 'chicken') weapon.lockId = target.id;
      weapon.flightMs = Math.round(Math.max(420, (dist / (spec.speed || 8)) * 1000));
      weapon.apexZ = kind === 'chicken' ? 1.1 + Math.min(1.8, dist * 0.18) : 0.35 + Math.min(1.2, dist * 0.08);
      if (kind === 'missile') weapon.weave = randRange(0.6, 1.6);
    }
    return {
      kind,
      flyId: shooter?.id ?? null,
      name: shooter?.name || '',
      color: shooter?.color || '#fff',
      x: weapon.land?.x ?? sx,
      y: weapon.land?.y ?? sy,
      yaw: 0, deg: 0, points: [], hitBolt: null, killed: false,
      weapon,
    };
  }

  function chaosName(kind, payload) {
    if (kind === 'holy') return payload.holy ? { thrower: payload.holy.throwerName, target: payload.holy.targetName } : null;
    if (WEAPON_KINDS.includes(kind)) {
      return payload.weapon ? { shooter: payload.weapon.shooterName, target: payload.weapon.targetName } : null;
    }
    if (kind === 'double') return payload.hitBolt != null ? (payload.name || '') : '';
    if (kind === 'laser') return payload.solo ? (payload.name || '') : '';
    return payload.name || '';
  }

  function playEvent(kind, payload, physics) {
    const name = chaosName(kind, payload);
    const copy = chaosCopy(kind, name);
    lastToast = { kind, name };
    showToast(copy.title, copy.line);
    api.audio()?.playChaos?.(kind, { killed: !!(payload.killed || payload.hitBolt != null) });

    if (kind === 'thumb') {
      const f = flies().find(x => x.id === payload.flyId);
      if (f?.last) {
        const p = f.last.pos;
        easeCamTo(new T.Vector3(p[0] - 3.2, p[1] - 2.4, p[2] + 2.6), new T.Vector3(p[0], p[1], p[2]), 280);
        later(320, () => camPunchIn(0.1, 80));
        later(1400, () => releaseCam(400));
        thumbAt(f, physics);
      }
    } else if (kind === 'spin') {
      const f = flies().find(x => x.id === payload.flyId);
      if (f?.last) {
        if (physics) {
          post(f, { op: 'spin', on: true, wz: 55, turns: 5, vz: 8 });
        }
        spinRing(f);
      }
    } else if (kind === 'quake') {
      startDish('quake', {}, physics);
      dust();
      camPunchIn(0.12, 200, () => releaseCam(200));
      if (physics) {
        postAll({ op: 'ground' });
        postAll({ op: 'loose', on: true });
        const t0 = now();
        const bump = () => {
          if (now() > t0 + 5000) { postAll({ op: 'loose', on: false }); return; }
          postAll({ op: 'impulse', vx: randRange(-10, 10), vy: randRange(-10, 10), vz: randRange(3, 6) });
          later(160, bump);
        };
        bump();
      }
    } else if (kind === 'flip') {
      const R = radius();
      const cam = api.camera();
      const yaw = cam ? Math.atan2(cam.position.y, cam.position.x) : 0;
      const dist = R * 2.2;
      const side = new T.Vector3(Math.cos(yaw) * dist, Math.sin(yaw) * dist, 3.6);
      const look = new T.Vector3(0, 0, 0.1);
      const startPunch = () => {
        startDish('flip', {}, physics);
        handUnder();
        if (physics) {
          postAll({ op: 'ground' });
          postAll({ op: 'loose', on: true });
          postAll({ op: 'flip', vz: 90, wx: randRange(-40, 40), wy: randRange(-40, 40) });
          later(700, () => postAll({ op: 'loose', on: false }));
        }
        later(900, () => releaseCam(500));
      };
      if (cam) easeCamTo(side, look, 600, startPunch);
      else startPunch();
    } else if (kind === 'tilt') {
      const yaw = payload.yaw || 0;
      const R = radius();
      const ax = -Math.sin(yaw), ay = Math.cos(yaw);
      const side = new T.Vector3(ax * R * 1.85, ay * R * 1.85, R * 0.55);
      const look = new T.Vector3(-Math.cos(yaw) * 2.2, -Math.sin(yaw) * 2.2, 0.15);
      easeCamTo(side, look, 500);
      later(3200, () => releaseCam(500));
      startDish('tilt', { yaw, deg: payload.deg }, physics);
      if (physics) {
        postAll({ op: 'ground' });
        postAll({ op: 'loose', on: true });
        postAll({ op: 'slip', on: true });
        later(3800, () => {
          postAll({ op: 'slip', on: false });
          postAll({ op: 'loose', on: false });
          postAll({ op: 'bias', ax: 0, ay: 0 });
        });
      }
    } else if (kind === 'lightning') {
      const bolts = [{ x: payload.x, y: payload.y }, ...(payload.points || []).slice(0, 2)];
      bolts.forEach((p, i) => {
        if (!p) return;
        const hit = payload.hitBolt === i;
        const go = () => strike(p.x, p.y, 0, physics, {
          hit,
          killFlyId: hit && physics ? payload.flyId : null,
        });
        if (i === 0) go();
        else later(350 * i, go);
      });
    } else if (kind === 'double') {
      const bolts = [{ x: payload.x, y: payload.y }, ...(payload.points || [])].slice(0, 6);
      while (bolts.length < 6) {
        const [px, py] = randomInDish();
        bolts.push({ x: px, y: py });
      }
      bolts.forEach((p, i) => {
        const hit = payload.hitBolt === i;
        const go = () => strike(p.x, p.y, hit ? 0 : 0.3, physics, {
          thin: true, r: 0.4, hit,
          killFlyId: hit && physics ? payload.flyId : null,
        });
        if (i === 0) go();
        else later(400 * i, go);
      });
    } else if (kind === 'crumb') {
      const pts = [{ x: payload.x, y: payload.y }, ...(payload.points || [])].slice(0, CAKE_SLICE_COUNT);
      while (pts.length < CAKE_SLICE_COUNT) {
        const p = cakeDropPoints(1)[0];
        pts.push(p);
      }
      pts.forEach((p, i) => {
        const go = () => crumbDrop(p.x, p.y, physics);
        if (i === 0) go();
        else later(CAKE_STAGGER_MS * i, go);
      });
      camPullBack(1.06, 700, { orbit: true });
      later(CAKE_STAGGER_MS * (CAKE_SLICE_COUNT - 1) + 2800, () => releaseCam(500));
    } else if (kind === 'firefly') {
      fireflies();
    } else if (kind === 'boop') {
      const f = flies().find(x => x.id === payload.flyId);
      if (f?.last) {
        const a = Math.random() * Math.PI * 2;
        const ax = Math.cos(a), ay = Math.sin(a);
        const p = f.last.pos;
        if (physics) later(200, () => post(f, { op: 'impulse', vx: -ax * 20, vy: -ay * 20, vz: 6 }));
        easeCamTo(new T.Vector3(p[0] - ax * 7.4, p[1] - ay * 7.4, (p[2] || 0.13) + 2.7), new T.Vector3(p[0], p[1], p[2]), 220);
        later(700, () => releaseCam(400));
        boopPad(f, a);
      }
    } else if (kind === 'laser') {
      const dur = laserSessionDuration();
      laserSession = {
        until: now() + dur,
        killed: new Set(),
        physics,
        shooterId: payload.solo ? payload.flyId : null,
      };
      laserBurnLast = new Map();
      ensureLaserPool();
      api.audio()?.startLaserBeam?.();
      busyUntil = Math.max(busyUntil, now() + dur);
    } else if (kind === 'puff') {
      seeds();
      camPullBack(1.15, 800);
      later(3500, () => releaseCam(700));
      if (physics) {
        const env = api.env();
        savedWind = env.wind ? [...env.wind] : [0, 0];
        savedRadial = env.windRadial ?? 0;
        const PUFF_RADIAL_OUT = 58;
        const PUFF_BIAS = 320;
        const gust = Math.random() * Math.PI * 2;
        env.wind = [savedWind[0] + Math.cos(gust) * 42, savedWind[1] + Math.sin(gust) * 42];
        env.windRadial = (savedRadial || 0) - PUFF_RADIAL_OUT;
        postEvery({ op: 'loose', on: true });
        for (const f of liveFlies(flies())) {
          const p = f.last?.pos;
          if (!p) continue;
          const rad = Math.hypot(p[0], p[1]) || 1;
          const ux = p[0] / rad;
          const uy = p[1] / rad;
          post(f, { op: 'bias', ax: ux * PUFF_BIAS, ay: uy * PUFF_BIAS });
          post(f, { op: 'impulse', vx: ux * randRange(14, 22), vy: uy * randRange(14, 22), vz: randRange(2, 6) });
        }
        api.syncEnv?.();
        const t0 = now();
        const gustBump = () => {
          if (now() > t0 + 4800) return;
          for (const f of liveFlies(flies())) {
            const p = f.last?.pos;
            if (!p) continue;
            const rad = Math.hypot(p[0], p[1]) || 1;
            const ux = p[0] / rad;
            const uy = p[1] / rad;
            post(f, { op: 'impulse', vx: ux * randRange(10, 18), vy: uy * randRange(10, 18), vz: randRange(0, 4) });
          }
          later(260, gustBump);
        };
        later(320, gustBump);
        later(5000, () => {
          restoreWind();
          postEvery({ op: 'bias', ax: 0, ay: 0 });
          postEvery({ op: 'loose', on: false });
        });
      }
    } else if (kind === 'meteor') {
      meteorShower(payload, physics);
    } else if (kind === 'sugarrain') {
      startSugarRain(physics);
    } else if (kind === 'ufo') {
      ufoAbduct(payload, physics);
    } else if (kind === 'spikes') {
      spikeTrap(payload, physics);
    } else if (kind === 'holy') {
      holyThrow(payload, physics);
    } else if (WEAPON_KINDS.includes(kind)) {
      playWeapon(kind, payload, physics);
    }
  }

  function buildPayload(kind, opts = {}) {
    const live = liveFlies(flies());
    if (kind === 'holy') return buildHolyPayload(live, opts);
    if (WEAPON_KINDS.includes(kind)) return buildWeaponPayload(kind, live, opts);
    const f = live.length ? pick(live) : null;
    const farthest = live.slice().sort((a, b) => Math.hypot(b.last.pos[0], b.last.pos[1]) - Math.hypot(a.last.pos[0], a.last.pos[1]))[0];
    const target = (kind === 'crumb' ? farthest : f);
    let [x, y] = randomInDish();
    let extra = [];
    if (kind === 'crumb') {
      const pts = shuffle(cakeDropPoints(CAKE_SLICE_COUNT));
      x = pts[0].x;
      y = pts[0].y;
      extra = pts.slice(1);
    } else if (kind === 'meteor') {
      const n = 3;
      const strikes = [];
      for (let i = 0; i < n; i++) strikes.push(randomMeteorStrike());
      x = strikes[0].x;
      y = strikes[0].y;
      return {
        kind, flyId: null, name: '', color: '#fff', x, y, yaw: Math.random() * Math.PI * 2, deg: 0,
        points: strikes.slice(1), strikes, hitIndex: null, hitBolt: null, killed: false,
      };
    } else if (kind === 'spikes') {
      const half = randRange(0.98, 1.23);
      const victim = live.length ? pick(live) : null;
      const hit = !!(victim?.last && Math.random() < 0.2);
      if (victim?.last) {
        x = victim.last.pos[0];
        y = victim.last.pos[1];
        if (!hit) {
          const a = Math.random() * Math.PI * 2;
          const d = randRange(1.6, 2.4);
          x += Math.cos(a) * d;
          y += Math.sin(a) * d;
          [x, y] = clampIntoArena(x, y, 1.4);
        }
      } else {
        [x, y] = randomInDish(1.4);
      }
      return {
        kind, flyId: null, name: '', color: '#fff', x, y,
        yaw: Math.random() * Math.PI * 2, half, deg: 0,
        points: [], hitBolt: null, killed: false,
      };
    } else if (kind === 'ufo') {
      const victim = live.length ? pick(live) : null;
      let ufoId = null;
      let ufoName = '';
      let ufoColor = '#fff';
      if (victim?.last) {
        x = victim.last.pos[0];
        y = victim.last.pos[1];
        ufoId = victim.id;
        ufoName = victim.name || '';
        ufoColor = victim.color || '#fff';
      }
      return {
        kind, flyId: ufoId, name: ufoName, color: ufoColor, x, y, yaw: 0, deg: 0, points: [], hitBolt: null, killed: false,
      };
    } else if (kind === 'sugarrain') {
      return {
        kind, flyId: null, name: '', color: '#fff', x: 0, y: 0, yaw: 0, deg: 0,
        points: [], hitBolt: null, killed: false,
      };
    } else {
      const extraNeed = kind === 'double' ? 5 : 2;
      const minFromFirst = kind === 'double' ? 2.4 : 4;
      const minSep = kind === 'double' ? 2.2 : 3.5;
      for (let i = 0; i < 80 && extra.length < extraNeed; i++) {
        const [px, py] = randomInDish();
        if (Math.hypot(px - x, py - y) < minFromFirst) continue;
        if (extra.some(p => Math.hypot(p.x - px, p.y - py) < minSep)) continue;
        extra.push({ x: px, y: py });
      }
      while (extra.length < extraNeed) {
        const [px, py] = randomInDish();
        extra.push({ x: px, y: py });
      }
    }
    let flyId = target?.id ?? null;
    let name = target?.name || '';
    let color = target?.color || '#fff';
    let hitBolt = null;
    if (kind === 'lightning' || kind === 'double') {
      flyId = null;
      name = '';
      const nBolts = kind === 'double' ? 6 : 3;
      if (live.length && Math.random() < 0.25) {
        const victim = pick(live);
        hitBolt = Math.floor(Math.random() * nBolts);
        const pos = { x: victim.last.pos[0], y: victim.last.pos[1] };
        if (hitBolt === 0) { x = pos.x; y = pos.y; }
        else extra[hitBolt - 1] = pos;
        flyId = victim.id;
        name = victim.name || '';
        color = victim.color || '#fff';
      }
    }
    let solo = false;
    if (kind === 'laser') {
      solo = opts.solo === true || (opts.solo !== false && Math.random() < 0.5);
      const shooter = opts.flyId != null ? live.find(x => x.id === opts.flyId) : target;
      if (solo && shooter) {
        flyId = shooter.id;
        name = shooter.name || '';
        color = shooter.color || '#fff';
      } else {
        solo = false;
        flyId = null;
        name = '';
      }
    }
    return {
      kind,
      flyId,
      name,
      color,
      x, y,
      yaw: Math.random() * Math.PI * 2,
      deg: tiltDeg(randRange(28, 40)),
      points: extra,
      hitBolt,
      killed: hitBolt != null,
      solo,
    };
  }

  function duration(kind) {
    return {
      thumb: 1800, spin: 1600, quake: 5200, flip: 2200, tilt: 4000, lightning: 1600, double: 2800,
      crumb: CAKE_STAGGER_MS * (CAKE_SLICE_COUNT - 1) + 2800,
      firefly: 7200, boop: 1300, puff: 5200, laser: 3200,
      meteor: 5600, sugarrain: 5400, ufo: 7000, spikes: 3600, holy: 6400,
      minigun: 3600, shotgun: 2000, taser: 2800, bazooka: 3200, missile: 3400, chicken: 3000,
    }[kind] || 1200;
  }

  function fire(kind, payload, physics) {
    if (previewMesh) { disposeObj(previewMesh); previewMesh = null; }
    lastKind = kind;
    busyUntil = now() + duration(kind);
    playEvent(kind, payload, physics);
    if (physics) {
      const copy = chaosCopy(kind, chaosName(kind, payload));
      setCue({
        kind,
        flyId: payload.flyId,
        name: payload.name,
        color: payload.color,
        title: copy.title,
        line: copy.line,
        x: payload.x, y: payload.y,
        yaw: payload.yaw, deg: payload.deg,
        points: payload.points,
        hitBolt: payload.hitBolt,
        hitIndex: payload.hitIndex,
        half: payload.half,
        strikes: payload.strikes,
        killed: payload.killed,
        holy: payload.holy,
        weapon: payload.weapon,
        solo: payload.solo,
      });
    }
  }

  function debugFire(kind, extra = {}) {
    const k = String(kind || '').trim().toLowerCase();
    if (!KINDS.includes(k)) {
      console.warn(`[chaos] unknown kind "${kind}". try: ${KINDS.join(', ')}`);
      return null;
    }
    const physics = extra.physics !== false;
    const payload = { ...buildPayload(k, extra), ...extra, kind: k };
    delete payload.physics;
    fire(k, payload, physics);
    return { kind: k, physics, flyId: payload.flyId, name: payload.name };
  }

  function holdRoulette() { nextAt = Infinity; }

  function pickKind() {
    const weighted = kinds => {
      const pool = [];
      for (const k of kinds) {
        pool.push(k);
        if (k === 'laser') pool.push(k);
      }
      return pool;
    };
    const pool = weighted(KINDS.filter(k => k !== lastKind));
    return pick(pool.length ? pool : weighted(KINDS));
  }

  function arm() {
    startedAt = now();
    nextAt = startedAt + randRange(...CHAOS_ROULETTE_GAP_MS);
    lastKind = null;
    busyUntil = 0;
  }

  function disposeAllFx() {
    tweens = [];
    shakes = [];
    endLaserSession();
    endWildcardSessions();
    clearLaserDecals();
    if (laserPool) {
      disposeLaserPool(laserPool);
      laserPool = null;
    }
    if (tracerPool) {
      disposeTracerPool(tracerPool);
      tracerPool = null;
    }
    scorches = [];
    scorchDirty = false;
    busyUntil = 0;
    dishAnim = null;
    hideToast();
    cancelCam();
    restoreWind();
    clearCakeDespawns();
    stripCake();
    const cakes = dishCakeGroup();
    if (cakes && cakes !== fxRoot) {
      while (cakes.children.length) disposeObj(cakes.children[0]);
    }
    clearBakedMeteors();
    resetEnvPose();
    if (previewMesh) { disposeObj(previewMesh); previewMesh = null; }
    if (fxRoot) {
      while (fxRoot.children.length) disposeObj(fxRoot.children[0]);
    }
    releaseAllLights();
  }

  function reset() {
    disposeAllFx();
    lastKind = null;
    nextAt = 0;
    startedAt = 0;
    cue = null;
    postEvery({ op: 'pin', on: false });
    postEvery({ op: 'spin', on: false });
    postEvery({ op: 'loose', on: false });
    postEvery({ op: 'slip', on: false });
    postEvery({ op: 'bias', ax: 0, ay: 0 });
    api.repaintFloor?.();
  }

  function stopLive() {
    // Keep in-flight FX/tweens so delayed SFX (holy boom, meteor hits, cake land) still play.
    nextAt = Infinity;
    endLaserSession();
    api.audio()?.stopUfoSting?.(0.4);
    api.audio()?.stopMinigunLoop?.();
    postEvery({ op: 'pin', on: false });
    postEvery({ op: 'spin', on: false });
    postEvery({ op: 'loose', on: false });
    postEvery({ op: 'slip', on: false });
    postEvery({ op: 'bias', ax: 0, ay: 0 });
  }

  function tick() {
    const t = now();
    const cur = tweens;
    tweens = [];
    let laterBudget = 8;
    for (const tw of cur) {
      if (tw.later && t >= tw.until) {
        if (laterBudget <= 0) { tweens.push(tw); continue; }
        laterBudget -= 1;
      }
      if (tw.tick()) tweens.push(tw);
    }
    tickCakeDespawns(t);
    if (dishAnim) {
      if (t >= dishAnim.t0 + dishAnim.dur) {
        applyDish(identityDish(), dishPhysics);
        dishAnim = null;
      } else {
        applyDish(dishPoseAt(t), dishPhysics);
      }
    } else syncDishVisual();   // poses still catching up after the animation ends
    if (dishAnim?.kind === 'quake') {
      const cam = api.camera();
      const k = Math.max(0, 1 - (t - dishAnim.t0) / dishAnim.dur);
      if (cam) {
        cam.position.x += (Math.random() - 0.5) * 0.12 * k;
        cam.position.y += (Math.random() - 0.5) * 0.12 * k;
      }
    }
    if (shakes.length) {
      const cam = api.camera();
      shakes = shakes.filter(s => {
        const u = (t - s.t0) / s.dur;
        if (u >= 1) return false;
        if (cam) {
          const k = 1 - u;
          cam.position.x += (Math.random() - 0.5) * s.amp * k;
          cam.position.y += (Math.random() - 0.5) * s.amp * k;
        }
        return true;
      });
    }
    tickLaserSession(t, api.isHostLive?.());
    tickLaserDecals(t);
    tickTracers(tracerPool, t);
    tickMeteorSmoke(t);
    if (ufoSession?.saucer && ufoSession.spinRadPerSec) {
      const dt = (t - (ufoSession.lastSpinT ?? t)) / 1000;
      ufoSession.saucer.rotation.z += ufoSession.spinRadPerSec * dt;
      ufoSession.lastSpinT = t;
    }
    if (ufoSession?.beam) tickUfoBeam(ufoSession.beam, t);
    if (ufoSession?.rimLights?.length) {
      const anchors = ufoSession.rimAnchors?.children || [];
      const fade = ufoSession.fade ?? 1;
      for (let i = 0; i < ufoSession.rimLights.length; i++) {
        const a = anchors[i], l = ufoSession.rimLights[i];
        if (!a || !l) continue;
        a.getWorldPosition(rimWorld);
        l.position.copy(rimWorld);
        l.intensity = 0.35 * fade;
      }
    }
    tickUfoAbductFly();
    tickSugarRain(t);
    if (scorches.length && (scorchDirty || t - lastScorchPaint > 500)) {
      scorches = scorches.filter(s => t < s.until + 4000);
      lastScorchPaint = t;
      scorchDirty = false;
      api.repaintFloor?.();
    }
    if (!api.isHostLive?.()) return;
    if (t < busyUntil || t < nextAt) return;
    const kind = pickKind();
    fire(kind, buildPayload(kind), true);
    nextAt = t + randRange(...CHAOS_ROULETTE_GAP_MS);
  }

  function playCue(c) {
    if (!c || c.id === lastWatchId) return;
    lastWatchId = c.id;
    fire(c.kind, c, false);
  }

  function getCue() { return cue; }
  function getScorches() { return scorches; }

  function previewProp(kind) {
    const root = fxGroup();
    if (previewMesh) { disposeObj(previewMesh); previewMesh = null; }
    const key = kind === 'boop' ? 'finger' : kind === 'double' ? 'lightning' : kind;
    if (key === 'lightning') {
      previewMesh = makeBolt(T, 0, 0, { height: boltHeight() * 0.85, hit: true, fork: true });
      previewMesh.userData.chaosPreview = true;
      previewMesh.scale.set(1, 1, 1);
      setBoltPulse(previewMesh, { reveal: 1, core: 1, glow: 1, flash: 1 }, 0);
      root.add(previewMesh);
      return key;
    }
    const make = key === 'thumb' ? makeThumb : key === 'hand' ? makeHand : key === 'finger' ? makeFinger : null;
    if (!make) return null;
    previewMesh = make(T);
    previewMesh.userData.chaosPreview = true;
    previewMesh.position.set(7.2, 0, 2.1);
    if (key === 'hand') {
      previewMesh.rotation.set(0, 0, 0);
      previewMesh.rotateX(0.18);
      previewMesh.scale.setScalar(0.7);
    } else if (key === 'finger') {
      previewMesh.scale.setScalar(2.4);
    } else {
      previewMesh.scale.setScalar(1.25);
    }
    root.add(previewMesh);
    return key;
  }

  async function warmup(renderer, camera) {
    const sc = api.scene();
    if (!renderer?.compileAsync || !sc || !camera) return;
    lightGroup();
    const root = new T.Group();
    root.name = 'ChaosWarmup';
    sc.add(root);
    for (const name of chaosPropKeys()) {
      const m = cloneChaosProp(name);
      if (!m) continue;
      m.position.set(0, 0, -80);
      root.add(m);
    }
    for (const make of [makeThumb, makeHand, makeFinger]) {
      const m = make(T);
      m.position.set(0, 0, -80);
      root.add(m);
    }
    root.add(makeBolt(T, 0, 0, { height: 4, hit: true, fork: true }));
    root.add(new T.Mesh(new T.CircleGeometry(1.2, 28), boltGroundFlashMaterial(T, true)));
    root.add(createUfoBeam(T, 1));
    const borrowed = [];
    for (let i = 0; i < LIGHT_POOL_N; i++) {
      const l = borrowLight({ color: i % 2 ? '#e8f0ff' : '#88ffdd', distance: 10 });
      if (l) { l.intensity = 1; borrowed.push(l); }
    }
    try { await renderer.compileAsync(sc, camera); }
    catch (e) { console.warn('chaos warmup', e); }
    for (const l of borrowed) releaseLight(l);
    while (root.children.length) disposeObj(root.children[0]);
    root.parent?.remove(root);
  }

  return { arm, reset, stopLive, holdRoulette, tick, playCue, getCue, getScorches, showToast, hideToast, relocalizeToast, debugFire, previewProp, warmup, kinds: KINDS, camBusy: () => !!camShot };
}
