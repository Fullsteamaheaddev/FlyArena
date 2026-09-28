import { makeThumb, makeHand, makeFinger, fadeGroup, prepareMeshFade, makeCakeSlice, makeLeaf } from './race-chaos-props.js';
import { makeBolt, boltPulse, setBoltPulse, boltGroundFlashMaterial } from './race-chaos-bolt.js';
import { createLaserPool, tickLaserBeams, hideLaserPool, disposeLaserPool, laserSessionDuration } from './race-chaos-laser.js';

export const CHAOS_KINDS = ['thumb', 'spin', 'quake', 'flip', 'tilt', 'lightning', 'double', 'crumb', 'firefly', 'boop', 'puff', 'laser'];
const KINDS = CHAOS_KINDS;

const COPY = {
  thumb: { title: 'Thumb of fate', line: name => `${name} is pinned, then flicked.` },
  spin: { title: 'Spin cycle', line: name => `${name} spins like a bottle cap.` },
  quake: { title: 'Earthquake', line: () => 'The dish rattles for five seconds.' },
  flip: { title: 'Dish flip', line: () => 'A hand boots the plate from below.' },
  tilt: { title: 'Dish tilt', line: () => 'The plate tips, then levels again.' },
  lightning: { title: 'Lightning', line: name => name ? `Lightning finds ${name}.` : 'Three bolts scorch the sugar plate.' },
  double: { title: 'Double lightning', line: name => name ? `Lightning finds ${name}.` : 'Six bolts. Smaller, meaner.' },
  crumb: { title: 'Cake slice', line: name => `A cake slice drops for ${name}.` },
  firefly: { title: 'Firefly moment', line: () => 'Little lights drift along the rim.' },
  boop: { title: 'Gentle boop', line: name => `A tiny boop for ${name}.` },
  puff: { title: 'Dandelion puff', line: () => 'A soft puff of wind rolls through.' },
  laser: { title: 'Laser eyes', line: name => (name ? `${name} gets laser eyes.` : 'A fly gets laser eyes.') },
};

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

export function createRaceChaos(api) {
  const T = api.THREE;
  let lastKind = null, nextAt = 0, busyUntil = 0, startedAt = 0;
  let cue = null, cueId = 0, lastWatchId = -1;
  let scorches = [];
  let tweens = [];
  let cakeDespawns = [];
  const CAKE_SLICE_COUNT = 12;
  const CAKE_STAGGER_MS = 400;
  let fxRoot = null;
  let previewMesh = null;
  let toastEl = null, toastTimer = 0;
  let savedWind = null, savedRadial = null;
  let lastScorchPaint = 0;
  let dishAnim = null, dishPhysics = false, lastDishKey = '';
  let camShot = null;
  let shakes = [];
  let sceneFlashes = [];
  let sceneFlashEl = null;
  let laserSession = null;
  let laserPool = null;
  let laserBurnLast = null;

  function radius() { return api.env()?.arena?.radius || 12.5; }
  function flies() { return api.flies() || []; }
  function now() { return performance.now(); }
  function fxGroup() {
    if (fxRoot && fxRoot.parent) return fxRoot;
    fxRoot = new T.Group();
    fxRoot.matrixAutoUpdate = true;
    api.scene()?.add(fxRoot);
    return fxRoot;
  }
  function dishCakeGroup() {
    const g = api.dishCakeGroup?.();
    if (g) return g;
    return api.envGroup?.() || fxGroup();
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
    clearTimeout(toastTimer);
  }
  function sceneFlashBox() {
    if (sceneFlashEl) return sceneFlashEl;
    const el = document.createElement('div');
    el.id = 'lightningSceneFlash';
    el.hidden = true;
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    sceneFlashEl = el;
    return el;
  }
  function clearSceneFlash() {
    sceneFlashes = [];
    if (sceneFlashEl) {
      sceneFlashEl.hidden = true;
      sceneFlashEl.style.opacity = '0';
    }
  }
  function pokeSceneFlash(opts = {}) {
    const peak = opts.hit ? 0.55 : opts.thin ? 0.28 : 0.42;
    const dur = opts.hit ? 240 : opts.thin ? 160 : 200;
    sceneFlashes.push({ t0: now(), peak, dur });
    updateSceneFlashEl(now());
  }
  function updateSceneFlashEl(t) {
    let op = 0;
    const next = [];
    for (const s of sceneFlashes) {
      const u = (t - s.t0) / s.dur;
      if (u >= 1) continue;
      let v = 0;
      if (u >= 0) {
        if (u < 0.05) v = s.peak * (u / 0.05);
        else v = s.peak * (1 - ((u - 0.05) / 0.95) ** 1.8);
      }
      op = Math.max(op, v);
      next.push(s);
    }
    sceneFlashes = next;
    const el = sceneFlashBox();
    if (op <= 0.001) {
      el.hidden = true;
      el.style.opacity = '0';
    } else {
      el.hidden = false;
      el.style.opacity = String(op);
    }
  }
  function post(f, msg) { if (f?.worker) f.worker.postMessage({ type: 'chaos', ...msg }); }
  function postAll(msg) { for (const f of liveFlies(flies())) post(f, msg); }
  function postEvery(msg) { for (const f of flies()) post(f, msg); }

  function setCue(partial) {
    cueId += 1;
    cue = { id: cueId, t: now(), ...partial };
    api.onCue?.(cue);
  }

  function later(ms, fn) {
    const t0 = now();
    tweens.push({ until: t0 + ms, tick: () => { if (now() >= t0 + ms) { fn(); return false; } return true; } });
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

  function beginCamHold() {
    const cam = api.camera(), ctl = api.controls();
    if (!cam || !ctl) return null;
    if (!camShot) {
      camShot = {
        pos: cam.position.clone(),
        target: ctl.target.clone(),
        polar: ctl.maxPolarAngle,
        enabled: ctl.enabled,
      };
      api.holdFollow?.(true);
      ctl.enabled = false;
      ctl.maxPolarAngle = Math.PI / 2;
    }
    return camShot;
  }
  function aimCam() {
    const cam = api.camera(), ctl = api.controls();
    if (cam && ctl) { cam.lookAt(ctl.target); cam.updateMatrixWorld(); }
  }
  function easeCamTo(pos, target, dur, done) {
    const cam = api.camera(), ctl = api.controls();
    if (!cam || !ctl || !pos || !target) { done?.(); return; }
    beginCamHold();
    const p0 = cam.position.clone(), t0 = ctl.target.clone();
    tween(dur, u => {
      const k = easeInOut(u);
      cam.position.lerpVectors(p0, pos, k);
      ctl.target.lerpVectors(t0, target, k);
      aimCam();
    }, () => { aimCam(); done?.(); });
  }
  function releaseCam(dur, done) {
    const snap = camShot, cam = api.camera(), ctl = api.controls();
    if (!snap || !cam || !ctl) { done?.(); return; }
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
    const shooterId = laserSession.shooterId;
    const beamFlies = shooterId == null ? [] : allLive.filter(f => f.id === shooterId);
    tickLaserBeams(pool, beamFlies, arena, t, laserBurnLast, {
      physics: laserSession.physics ?? physics,
      onFlyHit: victimId => {
        if (!laserSession?.physics || laserSession.killed.has(victimId)) return;
        const v = flies().find(x => x.id === victimId);
        if (!v?.worker || v.last?.alive === false) return;
        laserSession.killed.add(victimId);
        post(v, { op: 'kill' });
        api.audio()?.playLaserKill?.();
        hideToast();
      },
      onBurn: (x, y) => {
        scorches.push({ x, y, r: 0.1, until: t + 14000, kind: 'laser' });
        if (t - lastScorchPaint > 80) {
          lastScorchPaint = t;
          api.repaintFloor?.();
        }
      },
    }, allLive);
  }
  function camPullBack(scale, dur) {
    const cam = api.camera(), ctl = api.controls();
    if (!cam || !ctl) return;
    const to = ctl.target.clone().add(cam.position.clone().sub(ctl.target).multiplyScalar(scale));
    easeCamTo(to, ctl.target.clone(), dur);
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
    const g = api.envGroup();
    if (g) {
      g.position.set(pose.x, pose.y, pose.z);
      g.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw);
      g.scale.set(1, 1, 1);
    }
    const key = `${pose.x.toFixed(4)}|${pose.y.toFixed(4)}|${pose.z.toFixed(4)}|${pose.qw.toFixed(5)}|${pose.qx.toFixed(5)}|${pose.qy.toFixed(5)}|${pose.qz.toFixed(5)}`;
    if (physics && key !== lastDishKey) {
      lastDishKey = key;
      postEvery({ op: 'dish', ...pose });
    }
  }

  function resetEnvPose() {
    dishAnim = null;
    lastDishKey = '';
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
      fadeGroup(d.mesh, opacity);
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
    if (physics && opts.killFlyId != null) {
      const f = liveFlies(flies()).find(fl => fl.id === opts.killFlyId);
      if (f?.last) {
        sx = f.last.pos[0]; sy = f.last.pos[1];
        post(f, { op: 'kill' });
        killed = true;
      }
    } else if (physics && killR > 0) {
      for (const f of liveFlies(flies())) {
        const p = f.last.pos;
        if (Math.hypot(p[0] - x, p[1] - y) < killR) { post(f, { op: 'kill' }); killed = true; }
      }
    }
    if (killed) hideToast();
    scorches.push({ x: sx, y: sy, r: opts.r || (opts.hit ? 0.7 : 0.55), until: now() + 16000 });
    api.repaintFloor?.();
    flashBolt(sx, sy, opts);
    camShake(200, opts.thin ? 0.12 : opts.hit ? 0.28 : 0.2);
    return killed;
  }

  function flashBolt(x, y, opts = {}) {
    pokeSceneFlash(opts);
    const root = fxGroup();
    const height = opts.height ?? boltHeight();
    const bolt = makeBolt(T, x, y, { ...opts, height });
    bolt.scale.set(1, 1, 0.02);
    root.add(bolt);
    const t0 = now();
    const lightPeak = opts.thin ? 18 : opts.hit ? 48 : 34;
    const light = new T.PointLight(opts.hit ? '#e8f0ff' : '#d7eeff', 0, opts.thin ? 10 : 18);
    light.position.set(x, y, 3.2);
    light.matrixAutoUpdate = true;
    root.add(light);
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
      light.intensity = lightPeak * e.glow;
      flash.material.opacity = (opts.hit ? 1 : 0.85) * e.flash;
      flash.scale.setScalar(0.85 + 0.35 * e.flash);
      setBoltPulse(bolt, e, elapsed);
    }, () => { disposeObj(bolt); disposeObj(flash); light.parent?.remove(light); });
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
      const mat = new T.MeshStandardMaterial({ color: '#d6ff7a', emissive: '#b6ff4a', emissiveIntensity: 1.4, roughness: 0.3, transparent: true });
      const s = new T.Mesh(new T.SphereGeometry(0.09, 12, 10), mat);
      const light = new T.PointLight('#c8ff6a', 1.6, 2.4);
      s.add(light);
      root.add(s);
      dots.push({ s, a, wob: randRange(0.5, 1.3), z: randRange(0.35, 0.7) });
    }
    const speed = 7000 / 3000;
    tween(7000, u => {
      for (const d of dots) {
        const a = d.a + u * d.wob * speed;
        d.s.position.set((R - 0.55) * Math.cos(a), (R - 0.55) * Math.sin(a), d.z + 0.18 * Math.sin(u * 14 * speed + d.wob));
        d.s.material.opacity = u < 0.12 ? u / 0.12 : u > 0.82 ? (1 - u) / 0.18 : 1;
        const pl = d.s.children[0];
        if (pl) pl.intensity = 1.6 * d.s.material.opacity;
      }
    }, () => { for (const d of dots) disposeObj(d.s); });
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
    const mesh = makeCakeSlice(T);
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
      if (physics) {
        for (const f of liveFlies(flies())) {
          const p = f.last.pos;
          if (Math.hypot(p[0] - x, p[1] - y) < CAKE_R && (p[2] || 0) < 0.55) {
            post(f, { op: 'kill' });
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
    mesh.position.set(0, -2.2, -2.4);
    mesh.rotation.set(0, 0, 0);
    mesh.rotateX(0.18);
    root.add(mesh);
    tween(240, u => {
      const k = easeInOut(u);
      mesh.position.z = -2.4 + k * 2.55;
      mesh.position.y = -2.2 + k * 1.4;
    }, () => {
      later(160, () => tween(320, u => {
        mesh.position.z = 0.15 - u * 2.8;
        fadeGroup(mesh, 1 - u);
      }, () => disposeObj(mesh)));
    });
  }

  function dust() {
    const bits = [];
    const root = fxGroup();
    for (let i = 0; i < 16; i++) {
      const [x, y] = randomInDish(2);
      const s = new T.Mesh(
        new T.SphereGeometry(randRange(0.05, 0.12), 8, 8),
        new T.MeshStandardMaterial({ color: '#c4b8a0', transparent: true, opacity: 0.45, roughness: 1 }),
      );
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

  function playEvent(kind, payload, physics) {
    const name = payload.name || 'a fly';
    const copy = COPY[kind];
    const line = kind === 'lightning' || kind === 'double'
      ? copy.line(payload.hitBolt != null ? payload.name : '')
      : copy.line(name);
    showToast(copy.title, line);
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
        postAll({ op: 'bias', ax: -Math.cos(yaw) * 22, ay: -Math.sin(yaw) * 22 });
        later(3800, () => {
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
      const shooterId = payload.flyId ?? pick(liveFlies(flies()))?.id ?? null;
      laserSession = { until: now() + dur, killed: new Set(), physics, shooterId };
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
        const PUFF_RADIAL = 14;
        const PUFF_BIAS = 85;
        env.windRadial = (savedRadial || 0) - PUFF_RADIAL;
        for (const f of liveFlies(flies())) {
          const p = f.last?.pos;
          if (!p) continue;
          const rad = Math.hypot(p[0], p[1]);
          if (rad < 0.05) continue;
          post(f, { op: 'bias', ax: (p[0] / rad) * PUFF_BIAS, ay: (p[1] / rad) * PUFF_BIAS });
        }
        api.syncEnv?.();
        later(5000, () => {
          restoreWind();
          postEvery({ op: 'bias', ax: 0, ay: 0 });
        });
      }
    }
  }

  function buildPayload(kind) {
    const live = liveFlies(flies());
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
    return {
      kind,
      flyId,
      name,
      color,
      x, y,
      yaw: Math.random() * Math.PI * 2,
      deg: randRange(28, 40),
      points: extra,
      hitBolt,
      killed: hitBolt != null,
    };
  }

  function duration(kind) {
    return {
      thumb: 1800, spin: 1600, quake: 5200, flip: 2200, tilt: 4000, lightning: 1600, double: 2800,
      crumb: CAKE_STAGGER_MS * (CAKE_SLICE_COUNT - 1) + 2800,
      firefly: 7200, boop: 1300, puff: 5200, laser: 5200,
    }[kind] || 1200;
  }

  function fire(kind, payload, physics) {
    if (previewMesh) { disposeObj(previewMesh); previewMesh = null; }
    lastKind = kind;
    busyUntil = now() + duration(kind);
    playEvent(kind, payload, physics);
    if (physics) {
      const copy = COPY[kind];
      setCue({
        kind,
        flyId: payload.flyId,
        name: payload.name,
        color: payload.color,
        title: copy.title,
        line: kind === 'lightning' || kind === 'double'
          ? copy.line(payload.hitBolt != null ? payload.name : '')
          : copy.line(payload.name || 'a fly'),
        x: payload.x, y: payload.y,
        yaw: payload.yaw, deg: payload.deg,
        points: payload.points,
        hitBolt: payload.hitBolt,
        killed: payload.killed,
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
    const payload = { ...buildPayload(k), ...extra, kind: k };
    delete payload.physics;
    fire(k, payload, physics);
    return { kind: k, physics, flyId: payload.flyId, name: payload.name };
  }

  function holdRoulette() { nextAt = Infinity; }

  function pickKind() {
    const pool = KINDS.filter(k => k !== lastKind);
    return pick(pool.length ? pool : KINDS);
  }

  function arm() {
    startedAt = now();
    nextAt = startedAt + randRange(8000, 15000);
    lastKind = null;
    busyUntil = 0;
  }

  function disposeAllFx() {
    tweens = [];
    shakes = [];
    clearSceneFlash();
    endLaserSession();
    if (laserPool) {
      disposeLaserPool(laserPool);
      laserPool = null;
    }
    scorches = [];
    busyUntil = 0;
    dishAnim = null;
    hideToast();
    cancelCam();
    restoreWind();
    clearCakeDespawns();
    stripCake();
    resetEnvPose();
    if (previewMesh) { disposeObj(previewMesh); previewMesh = null; }
    if (fxRoot) {
      while (fxRoot.children.length) disposeObj(fxRoot.children[0]);
    }
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
    postEvery({ op: 'bias', ax: 0, ay: 0 });
    api.repaintFloor?.();
  }

  function stopLive() {
    disposeAllFx();
    postEvery({ op: 'pin', on: false });
    postEvery({ op: 'spin', on: false });
    postEvery({ op: 'loose', on: false });
    postEvery({ op: 'bias', ax: 0, ay: 0 });
    nextAt = Infinity;
  }

  function tick() {
    const t = now();
    const cur = tweens;
    tweens = [];
    for (const tw of cur) if (tw.tick()) tweens.push(tw);
    tickCakeDespawns(t);
    if (dishAnim) {
      if (t >= dishAnim.t0 + dishAnim.dur) {
        applyDish(identityDish(), dishPhysics);
        dishAnim = null;
      } else {
        applyDish(dishPoseAt(t), dishPhysics);
      }
    }
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
    updateSceneFlashEl(t);
    tickLaserSession(t, api.isHostLive?.());
    if (scorches.length && t - lastScorchPaint > 500) {
      scorches = scorches.filter(s => t < s.until + 4000);
      lastScorchPaint = t;
      api.repaintFloor?.();
    }
    if (!api.isHostLive?.()) return;
    if (t < busyUntil || t < nextAt) return;
    const kind = pickKind();
    fire(kind, buildPayload(kind), true);
    nextAt = t + randRange(10000, 20000);
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

  return { arm, reset, stopLive, holdRoulette, tick, playCue, getCue, getScorches, showToast, hideToast, debugFire, previewProp, kinds: KINDS, camBusy: () => !!camShot };
}
