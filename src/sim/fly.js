// FlyAgent: one connectome brain in one physically simulated body, living in an arena.
// Closed loop every 1 ms of simulated time:
//   physics state -> Senses (+ CompoundEye every 10 ms) -> sensory neuron drive -> brain (2 x 0.5 ms LIF steps)
//   -> Motor (descending commands / motor neurons) -> actuators -> physics (10 x 0.1 ms MuJoCo steps)
import { buildWorldXML } from './world.js';
import { Senses, CompoundEye, clearance, heatAt, windAt, upwindAt, onObstacleTop, obstacleDist, groundAt } from './senses.js';
import { Intrinsic } from './intrinsic.js';
import { Neuromod } from './neuromod.js';
import { Flight } from './flight.js';
import { FlyVisionFV } from './vision.js';
import { Motor } from './motor.js';
import { createBrain } from '../brainmodel.js';

const Rt9 = (xm, b) => [xm[b * 9], xm[b * 9 + 3], xm[b * 9 + 6]];   // body x axis (heading) in world frame

/** Horizontal unit vector from a collider obstacle toward p (box: nearest face; cyl: radial). */
function colliderOutward(p, o) {
  if (o.type === 'box' || o.sx != null) {
    const yaw = o.yaw || 0, c = Math.cos(yaw), s = Math.sin(yaw);
    const dx = p[0] - o.x, dy = p[1] - o.y;
    const lx = dx * c + dy * s, ly = -dx * s + dy * c;
    const px = Math.abs(lx) - o.sx, py = Math.abs(ly) - o.sy;
    const ox = px >= py ? (Math.sign(lx) || 1) : 0, oy = px >= py ? 0 : (Math.sign(ly) || 1);
    return [ox * c - oy * s, ox * s + oy * c];
  }
  const dx = p[0] - o.x, dy = p[1] - o.y, len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}

function quatMul(a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}
function quatRotate(qw, qx, qy, qz, v) {
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  return [
    v[0] + qw * tx + qy * tz - qz * ty,
    v[1] + qw * ty + qz * tx - qx * tz,
    v[2] + qw * tz + qx * ty - qy * tx,
  ];
}
function dishNormal(qw, qx, qy, qz) {
  return [
    2 * (qx * qz + qw * qy),
    2 * (qy * qz - qw * qx),
    1 - 2 * (qx * qx + qy * qy),
  ];
}

export class FlyAgent {
  constructor({ mj, flyXML, env, data, size, sign, bodymap, gait, id = 0, pos = [0, 0], yaw = 0, nProxies = 0, mode = 'descending', brainOpts = {}, vision = true, brain = null, flyvis = null, intrinsic = true, seed = 0, neuromod = null, sex = 'm' }) {
    this.id = id; this.mj = mj; this.env = env; this.data = data; this.vision = vision; this.sex = sex;
    this.model = mj.MjModel.from_xml_string(buildWorldXML(flyXML, env, { flyPos: [pos[0], pos[1], 0.132], flyYaw: yaw, nProxies }));
    this.mjd = new mj.MjData(this.model);
    this.physPerMs = Math.round(0.001 / this.model.opt.timestep);
    mj.mj_forward(this.model, this.mjd);
    const M = this.model, name2body = n => M.body(n).id;
    this.bid = { thorax: name2body('thorax'), head: name2body('head'), labrum: name2body('labrum_left'), antL: name2body('antenna_left'), antR: name2body('antenna_right') };
    this.claw = {}; for (const l of ['T1', 'T2', 'T3']) for (const s of ['left', 'right']) this.claw[`${l}_${s}`] = name2body(`claw_${l}_${s}`);
    this.sensorAdr = {}; for (let i = 0; i < M.nsensor; i++) this.sensorAdr[M.sensor(i).name] = M.sensor_adr[i];
    this.jointAdr = {}; for (let j = 0; j < M.njnt; j++) this.jointAdr[M.jnt(j).name] = M.jnt_qposadr[j];
    // geoms: albedo for vision; which bodies count as "self body" for bristle contact
    this.geomKind = []; for (let g = 0; g < M.ngeom; g++) { const n = M.geom(g).name; this.geomKind.push(n === 'floor' || n.startsWith('dune') ? 'floor' : n.startsWith('wall') ? 'wall' : n.startsWith('food') ? 'food' : n.startsWith('bitter') ? 'bitter' : n.startsWith('hazard') ? 'hazard' : n.startsWith('obst') ? 'obst' : n.startsWith('proxy') ? 'fly' : n.startsWith('threat') ? 'threat' : n.startsWith('canopy') ? 'canopy' : n.startsWith('water') ? 'water' : 'self'); }
    this.floorGeom = M.geom('floor').id;
    this.groundGeoms = this.geomKind.map((k, g) => k === 'floor' ? g : -1).filter(g => g >= 0);
    const fr = M.geom_friction;
    this.floorFriction0 = this.groundGeoms.map(g => [fr[g * 3], fr[g * 3 + 1], fr[g * 3 + 2]]);
    this.threatMocap = M.body_mocapid[M.body('threat').id];
    // brain
    this.brain = brain || createBrain(data, size, brainOpts, sign);   // wasm brain can be injected (shared connectome memory)
    // hunger as hormones and octopamine (neuromod: { calib: neuromod.json, block }); needs brainOpts.neuromod, which
    // also removes the OA neurons' fast synapses from the graph
    this.neuromod = brainOpts.neuromod ? new Neuromod(data, this.brain, { calib: neuromod?.calib, block: neuromod?.block, params: neuromod?.params, minSyn: brainOpts.minSyn ?? 5 }) : null;
    const typeOf = data.meta.types, sideOf = data.side;
    this.senses = new Senses(bodymap, mj, M); this.senses.bindTypes(typeOf, sideOf);
    // LC10 small-object visual projection neurons: the eye-to-courtship channel. A nearby fly is detected
    // visually (LC10 responds to small moving objects; LC10a -> pC1/pIP10, Ribeiro et al. 2018), which is
    // how a male starts courting before the cVA pheromone plume reaches him
    this.lc10 = { left: [], right: [] };
    for (let i = 0; i < typeOf.length; i++) if (/^LC10[ad]$/.test(typeOf[i])) this.lc10[sideOf[i] === 2 ? 'right' : 'left'].push(i);
    // vision: flyvis optic-lobe model driving the male-CNS optic lobe (if provided), else the simple photoreceptor eye
    this.fv = vision && flyvis ? new FlyVisionFV(mj, M, this.mjd, bodymap, flyvis.map, flyvis.eyes, this.bid.head, this.bid.thorax, flyvis.gain ?? 150) : null;
    this.eye = vision && !this.fv ? new CompoundEye(mj, M, this.mjd, bodymap, this.bid.head, this.bid.thorax) : null;
    const forage = !!env.hungryForage;
    this.motor = new Motor(mj, M, this.mjd, bodymap, typeOf, sideOf, gait, mode, { forage });
    this.intrinsic = intrinsic ? new Intrinsic(typeOf, sideOf, id + 1 + (seed || 0), bodymap.feeding, { forage }) : null;
    this.flight = new Flight({ mj, model: M, data: this.mjd, thorax: this.bid.thorax, jointAdr: this.jointAdr, act: this.motor.act, range: this.motor.range, rand: this.intrinsic?.rand, forage });
    this.flights = 0;
    this.driven = new Int32Array(0);
    // physiology
    this.energy = env.hungryForage ? 0.25 : 0.6; this.health = 1; this.alive = true; this.eaten = 0; this.t = 0; this.foodEaten = env.food.map(() => 0); this.dist = 0; this.jumps = 0; this._lastPos = null; this._wasJumping = false;
    this.others = [];   // [{x,y,yaw}] of other flies (set by the host)
    this.log = [];
    this.takeoffPending = false;
    this.tDrop = -1e9;
    this.tTopNudge = -1e9;
    this.tPropBump = -1e9;
    this._propBump = null;
    this.chaosPin = false;
    this.chaosSpin = false;
    this.chaosSpinWz = 0;
    this.chaosSpinLeft = 0;
    this.chaosLoose = false;
    this.chaosSlip = false;
    this.chaosBias = [0, 0];
    this.chaosPull = false;
    this.pullTarget = null;
    this.pullK = 0.5;
    this.dishMocap = -1;
    this.dishPose = { x: 0, y: 0, z: 0, qw: 1, qx: 0, qy: 0, qz: 0 };
    try { this.dishMocap = M.body_mocapid[M.body('arena').id]; } catch { this.dishMocap = -1; }
    this.qposHome = this.mjd.qpos.slice();
  }
  /** Put the same MjModel back at a start pose. Does not rebuild XML. */
  respawn(pos, yaw) {
    const mj = this.mj, M = this.model, d = this.mjd;
    this.energy = this.env.hungryForage ? 0.25 : 0.6;
    this.health = 1; this.alive = true; this.eaten = 0; this.t = 0;
    this.foodEaten = this.env.food.map(() => 0); this.dist = 0; this.jumps = 0; this.flights = 0;
    this._lastPos = null; this._wasJumping = false; this._eyeRates = null; this._propBump = null;
    this.takeoffPending = false; this.ragdollMs = 0;
    this.tDrop = -1e9; this.tTopNudge = -1e9; this.tPropBump = -1e9;
    this.lastTouch = undefined; this.lastPivot = undefined;
    this.chaosPin = false; this.chaosSpin = false; this.chaosSpinWz = 0; this.chaosSpinLeft = 0;
    this.chaosLoose = false; this.chaosSlip = false; this.chaosBias = [0, 0];
    this.chaosPull = false; this.pullTarget = null; this.pullK = 0.5;
    this.dishPose = { x: 0, y: 0, z: 0, qw: 1, qx: 0, qy: 0, qz: 0 }; this.dishSeq = 0;
    this.setSlipFriction(false);
    if (this.flight.active) this.flight.end();
    this.flight.tLand = 0; this.flight.tRimBounce = -1e9; this.flight.wingPhase = 0; this.flight.liftUnit = null;
    this.brain.reset();
    this.neuromod?.reset();
    this.motor.reset();
    this.intrinsic?.reset();
    this.driven = new Int32Array(0);
    this.cmd = { v: 0, turn: 0, drive: 0, back: 0, escape: 0 };
    if (this.fv) {
      for (const e of this.fv.eyes) e.reset();
      this.fv.adapt.fill(NaN);
      this.fv.settled = false;
    }
    if (this.qposHome) d.qpos.set(this.qposHome);
    d.qpos[0] = pos[0];
    d.qpos[1] = pos[1];
    d.qpos[2] = 0.132 + groundAt([pos[0], pos[1]], this.env);
    const hw = Math.cos(yaw / 2), hz = Math.sin(yaw / 2);
    d.qpos[3] = hw; d.qpos[4] = 0; d.qpos[5] = 0; d.qpos[6] = hz;
    d.qvel.fill(0);
    d.ctrl.fill(0);
    d.qacc?.fill?.(0);
    d.act?.fill?.(0);
    d.xfrc_applied?.fill?.(0);
    const id = this.dishMocap;
    if (id >= 0) {
      d.mocap_pos[id * 3] = 0; d.mocap_pos[id * 3 + 1] = 0; d.mocap_pos[id * 3 + 2] = 0;
      d.mocap_quat[id * 4] = 1; d.mocap_quat[id * 4 + 1] = 0; d.mocap_quat[id * 4 + 2] = 0; d.mocap_quat[id * 4 + 3] = 0;
    }
    mj.mj_forward(M, d);
  }
  releaseClaws() {
    const act = this.motor.act, d = this.mjd;
    for (const name of Object.keys(act)) if (name.startsWith('adhere_claw_')) d.ctrl[act[name]] = 0;
  }
  setSlipFriction(on) {
    const fr = this.model.geom_friction;
    this.groundGeoms.forEach((g, k) => {
      const i = g * 3, b = this.floorFriction0[k];
      if (on) {
        fr[i] = 0.06;
        fr[i + 1] = 0.005;
        fr[i + 2] = 0.0001;
      } else {
        fr[i] = b[0];
        fr[i + 1] = b[1];
        fr[i + 2] = b[2];
      }
    });
  }
  dieKnockover() {
    if (!this.alive) return;
    const d = this.mjd;
    this.releaseClaws();
    if (this.flight.active) this.flight.end();
    this.chaosPin = false;
    this.chaosSpin = false;
    this.chaosSpinLeft = 0;
    this.chaosBias = [0, 0];
    this.chaosSlip = false;
    this.setSlipFriction(false);
    d.qvel[2] += 6;
    d.qvel[4] += (Math.random() > 0.5 ? 1 : -1) * (26 + Math.random() * 8);
    this.health = 0;
    this.alive = false;
    this.ragdollMs = 380;
  }
  applyChaos(m) {
    const d = this.mjd;
    const op = m.op;
    if (op === 'pin') { this.chaosPin = m.on !== false; if (this.chaosPin && this.flight.active) this.flight.end(); return; }
    if (op === 'spin') {
      this.chaosSpin = m.on !== false;
      this.chaosSpinWz = m.wz || 28;
      this.chaosSpinLeft = (m.turns || 3.5) * Math.PI * 2;
      if (this.chaosSpin) {
        this.releaseClaws();
        if (this.flight.active) this.flight.end();
        d.qvel[2] += m.vz || 6;
        d.qvel[5] = this.chaosSpinWz;
      } else {
        this.chaosSpinLeft = 0;
      }
      return;
    }
    if (op === 'loose') { this.chaosLoose = m.on !== false; if (this.chaosLoose) this.releaseClaws(); return; }
    if (op === 'slip') {
      this.chaosSlip = m.on !== false;
      if (this.chaosSlip) this.releaseClaws();
      this.setSlipFriction(this.chaosSlip);
      return;
    }
    if (op === 'ground') { if (this.flight.active) this.flight.end(); return; }
    if (op === 'dish') {
      const id = this.dishMocap;
      if (id == null || id < 0) return;
      const nx = m.x || 0, ny = m.y || 0, nz = m.z || 0;
      const nqw = m.qw ?? 1, nqx = m.qx || 0, nqy = m.qy || 0, nqz = m.qz || 0;
      const o = this.dishPose;
      const local = quatRotate(o.qw, -o.qx, -o.qy, -o.qz, [d.qpos[0] - o.x, d.qpos[1] - o.y, d.qpos[2] - o.z]);
      const world = quatRotate(nqw, nqx, nqy, nqz, local);
      d.qpos[0] = nx + world[0];
      d.qpos[1] = ny + world[1];
      d.qpos[2] = nz + world[2];
      const delta = quatMul([nqw, nqx, nqy, nqz], [o.qw, -o.qx, -o.qy, -o.qz]);
      const fq = quatMul(delta, [d.qpos[3], d.qpos[4], d.qpos[5], d.qpos[6]]);
      d.qpos[3] = fq[0]; d.qpos[4] = fq[1]; d.qpos[5] = fq[2]; d.qpos[6] = fq[3];
      const v = quatRotate(nqw, nqx, nqy, nqz, quatRotate(o.qw, -o.qx, -o.qy, -o.qz, [d.qvel[0], d.qvel[1], d.qvel[2]]));
      d.qvel[0] = v[0]; d.qvel[1] = v[1]; d.qvel[2] = v[2];
      const N = dishNormal(nqw, nqx, nqy, nqz);
      const vn = d.qvel[0] * N[0] + d.qvel[1] * N[1] + d.qvel[2] * N[2];
      if (vn < 0) { d.qvel[0] -= vn * N[0]; d.qvel[1] -= vn * N[1]; d.qvel[2] -= vn * N[2]; }
      d.mocap_pos[id * 3] = nx;
      d.mocap_pos[id * 3 + 1] = ny;
      d.mocap_pos[id * 3 + 2] = nz;
      d.mocap_quat[id * 4] = nqw;
      d.mocap_quat[id * 4 + 1] = nqx;
      d.mocap_quat[id * 4 + 2] = nqy;
      d.mocap_quat[id * 4 + 3] = nqz;
      this.dishPose = { x: nx, y: ny, z: nz, qw: nqw, qx: nqx, qy: nqy, qz: nqz };
      if (m.seq != null) this.dishSeq = m.seq;   // the renderer draws the floor at the seq the flies carry
      return;
    }
    if (op === 'bias') {
      this.chaosBias = [m.ax || 0, m.ay || 0];
      return;
    }
    if (op === 'pull') {
      if (m.on === false) {
        this.chaosPull = false;
        this.pullTarget = null;
        return;
      }
      this.chaosPull = true;
      this.pullTarget = [m.x ?? 0, m.y ?? 0, m.z ?? 0];
      this.pullK = m.k ?? 0.5;
      this.releaseClaws();
      if (this.flight.active) this.flight.end();
      return;
    }
    if (op === 'kill') {
      this.dieKnockover();
      return;
    }
    if (op === 'impulse' || op === 'flip') {
      this.releaseClaws();
      if (this.flight.active) this.flight.end();
      d.qvel[0] += m.vx || 0;
      d.qvel[1] += m.vy || 0;
      d.qvel[2] += m.vz || 0;
      d.qvel[3] += m.wx || 0;
      d.qvel[4] += m.wy || 0;
      d.qvel[5] += m.wz || 0;
    }
  }
  /** Integrate qvel/qpos into xpos without a brain step (chaos poses). */
  kickPhysics() {
    const mj = this.mj, M = this.model, d = this.mjd;
    mj.mj_forward(M, d);
    for (let s = 0; s < this.physPerMs; s++) mj.mj_step(M, d);
    this.guardDish();
  }
  /** Refresh xpos after a direct qpos write, with no integration: the dish stream arrives at frame
   *  rate, and stepping physics for each one drives the fly through the plate. */
  syncPose() {
    this.guardDish();
    this.mj.mj_forward(this.model, this.mjd);
  }
  requestTakeoff() { if (this.alive && !this.flight.active) this.takeoffPending = true; }
  state() {
    const d = this.mjd, xp = d.xpos, B = this.bid;
    const P = b => [xp[3 * b], xp[3 * b + 1], xp[3 * b + 2]];
    const sd = this.mjd.sensordata, sa = this.sensorAdr;
    const st = { pos: P(B.thorax), labellum: P(B.labrum), antenna: { left: P(B.antL), right: P(B.antR) }, claw: {}, touch: {}, load: {}, joint: {},
      gyro: [sd[sa.gyro], sd[sa.gyro + 1], sd[sa.gyro + 2]], vel: [sd[sa.velocimeter], sd[sa.velocimeter + 1], sd[sa.velocimeter + 2]],
      bodyContact: { left: false, right: false }, otherFlies: this.others, sugarGain: 0.6 + 0.9 * (1 - this.energy), bitterGain: 0.6 + 0.8 * this.energy };
    st.labellumZ = st.labellum[2] - groundAt(st.labellum, this.env);
    st.pitchUp = d.xmat[B.thorax * 9 + 6];   // sine of nose-up pitch (body x axis z component)
    st.proboscisOut = this.motor.proboscisOut(); st.stepping = this.motor.stepAmp || 0;
    for (const [k, b] of Object.entries(this.claw)) { st.claw[k] = P(b); st.touch[k] = sd[sa[`touch_claw_${k}`]]; const f = sa[`force_tarsus_${k}`]; st.load[k] = Math.hypot(sd[f], sd[f + 1], sd[f + 2]); }
    for (const [n, a] of Object.entries(this.jointAdr)) if (/^(tibia|coxa)_T/.test(n)) st.joint[n] = d.qpos[a];
    // body contacts with anything other than the floor (walls, obstacles, other flies) -> bristles by side.
    // While flying, scan every ms so a dish-wall scrape can bounce the same step.
    if (this.t % 10 === 0 || this.flight.active) {
      const Rt = d.xmat.slice(B.thorax * 9, B.thorax * 9 + 9); const bc = { left: false, right: false };
      let rimHit = false;
      this._propBump = null;
      const cv = d.contact; const n = Math.min(d.ncon, cv.size());
      for (let c = 0; c < n; c++) { const con = cv.get(c); const k1 = this.geomKind[con.geom1], k2 = this.geomKind[con.geom2];
        if ((k1 === 'self') !== (k2 === 'self') && k1 !== 'floor' && k2 !== 'floor') {
          const p = con.pos; const rel = [p[0] - st.pos[0], p[1] - st.pos[1], p[2] - st.pos[2]]; const lat = Rt[1] * rel[0] + Rt[4] * rel[1] + Rt[7] * rel[2];
          bc[lat > 0 ? 'left' : 'right'] = true;
          if (k1 === 'wall' || k2 === 'wall') rimHit = true;
          if ((k1 === 'obst') !== (k2 === 'obst')) {
            const obstG = k1 === 'obst' ? con.geom1 : con.geom2;
            const idx = +(this.model.geom(obstG).name.slice(4));
            const o = this.env.obstacles?.[idx];
            if (o?.collider) {
              const fr = con.frame;
              let nx = fr?.[0], ny = fr?.[1], nz = fr?.[2];
              if (nx == null) { nx = st.pos[0] - o.x; ny = st.pos[1] - o.y; nz = 0; }
              else if (k1 === 'self') { nx = -nx; ny = -ny; nz = -nz; }
              const h = Math.hypot(nx, ny), mag = Math.hypot(nx, ny, nz) || 1;
              if (h > 0.35 * mag) this._propBump = { nx: nx / h, ny: ny / h };
            }
          }
        }
        con.delete(); }
      cv.delete(); this._bodyContact = bc; this._rimHit = rimHit;
    }
    st.bodyContact = this._bodyContact || st.bodyContact;
    st.rimHit = !!this._rimHit;
    // obstacle ahead: antenna tips (~0.2 mm in front of the antenna bases) or a front claw reach a wall, block
    // or fly. Both reach the brain as touch; antennal contact is what makes the fly turn away (st.antTouch)
    const fx = Rt9(d.xmat, B.thorax);
    st.frontTouch = {}; st.antTouch = {};
    for (const sd of ['left', 'right']) { const a = st.antenna[sd], tip = [a[0] + 0.02 * fx[0], a[1] + 0.02 * fx[1]];
      st.antTouch[sd] = clearance(tip, this.env, this.others, a[2]) < 0.003;
      st.frontTouch[sd] = st.antTouch[sd] || clearance(st.claw[`T1_${sd}`], this.env, this.others) < 0; }
    // a static surface just ahead (~1.7 mm): its looming matches the fly's own translation
    const hp = P(B.head); st.nearAhead = clearance([hp[0] + 0.12 * fx[0], hp[1] + 0.12 * fx[1]], this.env, this.others, hp[2]) < 0.05;
    if (this.flight.active) {   // flight: clearance at the lookahead point ahead and 40 degrees to each side
      const L = 0.9, yaw = Math.atan2(fx[1], fx[0]), at = a => clearance([st.pos[0] + L * Math.cos(yaw + a), st.pos[1] + L * Math.sin(yaw + a)], this.env, this.others, st.pos[2]);
      st.ahead = { center: at(0), left: at(0.7), right: at(-0.7) };
    }
    return st;
  }
  albedo = (g, x, y) => {
    const k = this.geomKind[g];
    if (k === 'threat') return 0.03;
    if (k === 'floor') return 0.35 + 0.25 * (((Math.floor(x / 0.4) + Math.floor(y / 0.4)) & 1) ? 1 : 0);   // checker floor
    if (k === 'wall') { const a = Math.atan2(y, x); return 0.15 + 0.6 * ((Math.floor(a / (Math.PI / 12)) & 1) ? 1 : 0); }  // striped wall
    if (k === 'food') return 0.9; if (k === 'bitter') return 0.5; if (k === 'hazard') return 0.6; if (k === 'obst') return 0.12; if (k === 'fly') return 0.08;
    if (k === 'canopy') return 0.1; if (k === 'water') return 0.22;
    return 0.3;
  };
  /** advance 1 ms of simulated time */
  step() {
    const mj = this.mj, M = this.model, d = this.mjd;
    if (!this.alive) {
      if (this.ragdollMs > 0) {
        this.ragdollMs -= 1;
        const act = this.motor.act;
        for (const name of Object.keys(act)) d.ctrl[act[name]] = 0;
        for (let s = 0; s < this.physPerMs; s++) mj.mj_step(M, d);
        this.t += 1;
      }
      return;
    }
    const th = this.env.threat, tm = this.threatMocap * 3;
    if (th) { d.mocap_pos[tm] = th.x; d.mocap_pos[tm + 1] = th.y; d.mocap_pos[tm + 2] = th.z; } else if (d.mocap_pos[tm + 2] > -10) d.mocap_pos[tm + 2] = -20;
    const st = this.state();
    const rates = this.senses.update(st, this.env, 1); this._sugar = st.sugar;
    if (this.eye && (this.t % 10 === 0)) { this._eyeRates = new Map(); const er = this._eyeRates; this.eye.update({ set: (ix, hz) => { for (const i of ix) er.set(i, hz); } }, this.env, 10, this.albedo); }
    if (this.fv && (this.t % 20 === 0)) { this._eyeRates = new Map(); const er = this._eyeRates; this.fv.update((ix, hz) => { for (const i of ix) er.set(i, hz); }, this.env, this.albedo, 20); }
    if (this._eyeRates) for (const [i, hz] of this._eyeRates) rates.set(i, hz);
    // apply sensory drive (clear neurons no longer driven)
    const B = this.brain; for (const i of this.driven) B.setDriveOne(i, 0);
    if (this.neuromod) this.neuromod.update(1, this.energy, this.flight.active ? 1 : this.motor.stepAmp || 0);
    // courtship context for a male: the nearest other fly's range and bearing in his head frame, plus the
    // connectome's own courtship-circuit readout (pIP10, DNp13) from the previous step
    let court = null;
    if (this.sex !== 'f' && st.otherFlies.length) {
      const fx = Rt9(d.xmat, this.bid.thorax), yaw = Math.atan2(fx[1], fx[0]);
      for (const o of st.otherFlies) {
        if (o.sex !== 'f') continue;   // a male courts only a female target
        const dd = Math.hypot(o.x - st.pos[0], o.y - st.pos[1]);
        if (!court || dd < court.dist) { const a = Math.atan2(o.y - st.pos[1], o.x - st.pos[0]) - yaw; court = { dist: dd, bearing: Math.atan2(Math.sin(a), Math.cos(a)) }; }
      }
      if (court) court.level = this.motor.cmd.court || 0;
      // LC10 drive: a nearby fly subtends a small moving object on the eye. Salience ~ angular size,
      // gated to the frontal-lateral field; the ipsilateral LC10 population carries it to pIP10
      for (const o of st.otherFlies) {
        const a = Math.atan2(o.y - st.pos[1], o.x - st.pos[0]) - Math.atan2(fx[1], fx[0]);
        const bearing = Math.atan2(Math.sin(a), Math.cos(a));
        const dd = Math.hypot(o.x - st.pos[0], o.y - st.pos[1]);
        const angular = Math.atan2(0.13, dd);              // fly ~1.3 mm radius
        if (Math.abs(bearing) < 2.2 && dd < 3 && angular > 0.04) {
          const hz = Math.min(140, 200 * angular);         // saturating small-object response
          const pool = this.lc10[bearing > 0 ? 'left' : 'right'];
          for (let k = 0; k < pool.length; k += 4) if ((rates.get(pool[k]) || 0) < hz) rates.set(pool[k], hz);   // ~1/4 of the column: the object covers part of the visual field
        }
      }
    }
    // Hold an explicit request until the startup/contact gates actually permit a launch.
    // The former 80 ms pulse silently expired if the user clicked just after loading.
    if (this.takeoffPending && this.intrinsic) this.intrinsic.takeoffUntil = this.intrinsic.t + 80;
    if (this.intrinsic) {
      const hx = Rt9(this.mjd.xmat, this.bid.thorax);
      this.intrinsic.update(1, B, { energy: this.energy, arousal: this.neuromod?.arousal, touch: st.antTouch, rearing: st.pitchUp > 0.45 && this.motor.jumpT < 0 && !this.motor.righting,
        heat: { left: heatAt(st.antenna.left, this.env), right: heatAt(st.antenna.right, this.env) }, sugar: this._sugar || 0, flying: this.flight.active, ahead: st.ahead, court,
        mouthOnFood: this.env.food.some(f => f.amount > 0 && Math.hypot(st.labellum[0] - f.x, st.labellum[1] - f.y) < f.r - 0.02),
        odor: st.odor, wind: windAt(st.pos, this.env), upwind: upwindAt(st.pos, this.env), heading: hx, forage: !!this.env.hungryForage });
    }
    const nd = new Int32Array(rates.size); let k = 0; for (const [i, hz] of rates) { B.setDriveOne(i, hz); nd[k++] = i; } this.driven = nd;
    // GF -> TTMn electrical synapse (not in the chemical connectome): GF spikes depolarise TTMn directly
    const before = this.brain.spikeCount[this.motor.dn.escape[0]] + this.brain.spikeCount[this.motor.dn.escape[1]];
    const a = this.brain.step();
    const b = a?.then ? a.then(() => this.brain.step()) : this.brain.step();
    if (b?.then) return b.then(() => this._afterBrain(before, st));
    this._afterBrain(before, st);
  }
  _afterBrain(before, st) {
    const mj = this.mj, M = this.model, d = this.mjd;
    const after = this.brain.spikeCount[this.motor.dn.escape[0]] + this.brain.spikeCount[this.motor.dn.escape[1]];
    if (after > before) this.brain.pulse(this.motor.ttmn, 20);
    this.motor.readBrain(this.brain.spikeCount, 1);
    // escape gating: a static surface the fly is walking up to, touching, or backing away from looms on the eye,
    // its own pivots sweep the scene across the eye, and grooming legs pass over it. Touch, optic flow that matches
    // its own translation, and efference copies of its movements (Kim et al. 2015) tell the brain none is a predator.
    if (st.frontTouch.left || st.frontTouch.right || st.nearAhead || st.bodyContact.left || st.bodyContact.right || this.intrinsic?.avoid || this.cmd?.grooming) this.lastTouch = this.t;
    if (this.motor.pivot) this.lastPivot = this.t;
    const gated = this.t - (this.lastTouch ?? -1e9) < 500 || this.t - (this.lastPivot ?? -1e9) < 300;
    this.motor.flying = this.flight.active;
    const pinned = this.chaosPin;
    const spinning = this.chaosSpin;
    this.cmd = this.motor.apply(this.t, 1, { up: this.mjd.xmat[this.bid.thorax * 9 + 8], touching: gated, voluntary: this.takeoffPending || (this.intrinsic && this.t < this.intrinsic.takeoffUntil),
      court: this.intrinsic?.state === 'court' ? { sing: !!this.intrinsic.courtSing, side: this.intrinsic.courtSide } : null,
      contact: st.bodyContact.left || st.bodyContact.right || st.antTouch.left || st.antTouch.right,
      pin: pinned || spinning,
      loose: this.chaosLoose || spinning,
      slip: this.chaosSlip });
    if (pinned) {
      this.cmd.v = 0; this.cmd.turn = 0;
      d.qvel[0] = 0; d.qvel[1] = 0;
      if (d.qvel[2] > 0) d.qvel[2] = 0;
    }
    if (spinning) {
      d.qvel[5] = this.chaosSpinWz;
      this.chaosSpinLeft -= Math.abs(this.chaosSpinWz) * 0.001;
      if (this.chaosSpinLeft <= 0) { this.chaosSpin = false; this.chaosSpinLeft = 0; }
    }
    if (this.motor.launchT === this.t && !this.flight.active) {
      const th = this.env.threat; this.flight.start(this.t, { cause: this.motor.jumpCause, awayFrom: th ? [th.x, th.y] : null }); this.flights++; this.takeoffPending = false;
    }
    if (this.flight.active) {
      const legTouch = Object.values(st.touch).some(x => x > 0);
      if (this.flight.update(this.t, 1, { turn: this.cmd.turn, env: this.env, others: this.others, legTouch, rimHit: st.rimHit }) === 'landed') this.motor.recoverUntil = this.t + 300;
      this.cmd.flying = this.flight.active; this.cmd.flight = this.flight.label();
    }
    if (!this.flight.active && st.pos[2] - groundAt(st.pos, this.env) >= 0.22) {
      this.releaseClaws();
    }
    this.dropUprightIfNeeded();
    this.nudgeOffMazeTop();
    this.bumpOffProp();
    if (this.chaosPull && this.pullTarget) {
      const [tx, ty, tz] = this.pullTarget;
      const dx = tx - d.qpos[0];
      const dy = ty - d.qpos[1];
      const dz = tz - d.qpos[2];
      const k = this.pullK ?? 0.5;
      d.qvel[0] += dx * k * 0.1;
      d.qvel[1] += dy * k * 0.1;
      d.qvel[2] += dz * k * 0.15;
      const cap = 7;
      for (let i = 0; i < 3; i++) {
        if (Math.abs(d.qvel[i]) > cap) d.qvel[i] = cap * Math.sign(d.qvel[i]);
      }
      if (Math.hypot(dx, dy, dz) < 0.07) {
        d.qpos[0] += dx * 0.45;
        d.qpos[1] += dy * 0.45;
        d.qpos[2] += dz * 0.45;
        d.qvel[0] *= 0.45;
        d.qvel[1] *= 0.45;
        d.qvel[2] *= 0.3;
      }
    }
    const dtSub = 1000 * M.opt.timestep;
    const [bx, by] = this.chaosBias;
    const slipSlide = this.chaosSlip && !this.flight.active;
    let slipAx = 0;
    let slipAy = 0;
    let slipAz = 0;
    if (slipSlide) {
      const o = this.dishPose;
      const N = dishNormal(o.qw, o.qx, o.qy, o.qz);
      const g = M.opt.gravity;
      const dot = g[0] * N[0] + g[1] * N[1] + g[2] * N[2];
      const k = 0.92;
      slipAx = (g[0] - dot * N[0]) * k;
      slipAy = (g[1] - dot * N[1]) * k;
      slipAz = (g[2] - dot * N[2]) * k;
    }
    for (let s = 0; s < this.physPerMs; s++) {
      if (bx || by) { d.qvel[0] += bx * M.opt.timestep; d.qvel[1] += by * M.opt.timestep; }
      if (slipSlide) {
        const dt = M.opt.timestep;
        d.qvel[0] += slipAx * dt;
        d.qvel[1] += slipAy * dt;
        d.qvel[2] += slipAz * dt;
        const hs = Math.hypot(d.qvel[0], d.qvel[1]);
        const cap = 40;
        if (hs > cap) {
          const sc = cap / hs;
          d.qvel[0] *= sc;
          d.qvel[1] *= sc;
        }
      }
      if (spinning && this.chaosSpin) d.qvel[5] = this.chaosSpinWz;
      if (this.flight.active) this.flight.substep(dtSub);
      mj.mj_step(M, d);
    }
    this.guardDish();
    this.t += 1;
    this.physiology(st);
  }
  guardDish() {
    const id = this.dishMocap;
    if (id == null || id < 0) return;
    const d = this.mjd;
    const o = id * 3, q = id * 4;
    const px = d.mocap_pos[o], py = d.mocap_pos[o + 1], pz = d.mocap_pos[o + 2];
    const qw = d.mocap_quat[q], qx = d.mocap_quat[q + 1], qy = d.mocap_quat[q + 2], qz = d.mocap_quat[q + 3];
    const nx = 2 * (qx * qz + qw * qy);
    const ny = 2 * (qy * qz - qw * qx);
    const nz = 1 - 2 * (qx * qx + qy * qy);
    const dist = (d.qpos[0] - px) * nx + (d.qpos[1] - py) * ny + (d.qpos[2] - pz) * nz;
    if (dist >= 0) return;
    const push = -dist;
    d.qpos[0] += nx * push;
    d.qpos[1] += ny * push;
    d.qpos[2] += nz * push;
    const vn = d.qvel[0] * nx + d.qvel[1] * ny + d.qvel[2] * nz;
    if (vn < 0) { d.qvel[0] -= vn * nx; d.qvel[1] -= vn * ny; d.qvel[2] -= vn * nz; }
  }
  dropUprightIfNeeded() {
    if (this.flight.active || this.motor.jumping || this.chaosSpin || this.chaosPin) return;
    const dq = this.dishPose;
    if (dq && dq.qx * dq.qx + dq.qy * dq.qy > 0.01) return;
    if (this.t - this.tDrop < 400) return;
    if ((this.motor.invertedMs || 0) <= 150) return;
    const d = this.mjd, th = this.bid.thorax;
    const fx = Rt9(d.xmat, th), yaw = Math.atan2(fx[1], fx[0]);
    let x = d.qpos[0], y = d.qpos[1];
    const p = [x, y, d.qpos[2]];
    let near = null, nearD = Infinity;
    for (const o of this.env.obstacles || []) {
      const dist = obstacleDist(p, o);
      if (dist < nearD) { nearD = dist; near = o; }
    }
    if (near && (nearD < 0.2 || onObstacleTop(p, this.env))) {
      if (near.type === 'box' || near.sx != null) {
        const yawW = near.yaw || 0, c = Math.cos(yawW), s = Math.sin(yawW);
        const ly = -(x - near.x) * s + (y - near.y) * c;
        const sign = ly >= 0 ? 1 : -1;
        x += -s * sign; y += c * sign;
      } else {
        const dx = x - near.x, dy = y - near.y, len = Math.hypot(dx, dy) || 1;
        x += dx / len; y += dy / len;
      }
    }
    const hw = Math.cos(yaw / 2), hz = Math.sin(yaw / 2);
    d.qpos[0] = x; d.qpos[1] = y; d.qpos[2] = 1.5 + groundAt([x, y], this.env);
    d.qpos[3] = hw; d.qpos[4] = 0; d.qpos[5] = 0; d.qpos[6] = hz;
    for (let i = 0; i < d.qvel.length; i++) d.qvel[i] = 0;
    const act = this.motor.act;
    for (const name of Object.keys(act)) if (name.startsWith('adhere_claw_')) d.ctrl[act[name]] = 0;
    this.mj.mj_forward(this.model, d);
    this.motor.recoverUntil = this.t + 300;
    this.motor.invertedMs = 0;
    this.tDrop = this.t;
  }
  onMazeTop() {
    const d = this.mjd, p = [d.qpos[0], d.qpos[1], d.qpos[2]];
    return (this.env.obstacles || []).some(o =>
      obstacleDist(p, o) < 0.08 && p[2] > o.sz - 0.08 && p[2] < o.sz + 0.4);
  }
  nudgeOffMazeTop() {
    if (this.flight.active || this.motor.jumping) return;
    if (!this.onMazeTop()) return;
    if (this.t - this.tTopNudge < 80) return;
    const d = this.mjd, a = Math.random() * Math.PI * 2;
    d.qvel[0] += 10 * Math.cos(a);
    d.qvel[1] += 10 * Math.sin(a);
    d.qvel[2] += 4;
    this.releaseClaws();
    this.tTopNudge = this.t;
  }
  /** Kick away from a desert prop collider so the gait cannot pin the thorax against it. */
  bumpOffProp() {
    if (this.chaosPin || this.motor.jumping) return;
    if (this.t - this.tPropBump < 120) return;
    const d = this.mjd;
    let nx, ny;
    if (this._propBump) { nx = this._propBump.nx; ny = this._propBump.ny; }
    else {
      const p = [d.qpos[0], d.qpos[1], d.qpos[2]];
      let best = null, bestD = 0.02;
      for (const o of this.env.obstacles || []) {
        if (!o.collider) continue;
        if (p[2] > o.sz + 0.1) continue;
        const dist = obstacleDist(p, o);
        if (dist < bestD) { bestD = dist; best = o; }
      }
      if (!best) return;
      const n = colliderOutward(p, best); nx = n[0]; ny = n[1];
    }
    const h = Math.hypot(nx, ny) || 1;
    nx /= h; ny /= h;
    this.releaseClaws();
    d.qvel[0] += 14 * nx;
    d.qvel[1] += 14 * ny;
    d.qvel[2] += 3;
    const fx = Rt9(d.xmat, this.bid.thorax);
    if (fx[0] * nx + fx[1] * ny < 0) { d.qvel[0] -= fx[0] * 6; d.qvel[1] -= fx[1] * 6; }
    this._propBump = null;
    this.tPropBump = this.t;
  }
  physiology(st) {
    const dt = 0.001;
    if (this._lastPos) this.dist += Math.hypot(st.pos[0] - this._lastPos[0], st.pos[1] - this._lastPos[1]); this._lastPos = st.pos;
    const jumping = this.motor.jumping; if (jumping && !this._wasJumping) this.jumps++; this._wasJumping = jumping;
    const walking = Math.abs(this.cmd.v);
    this.energy -= dt * (1 / 240 + walking / 180 + (this.flight.active ? 1 / 40 : 0));   // compressed timescale: ~4 min to starve at rest; flight is costly
    // ingestion: labellum on food + proboscis extended + pharyngeal pump motor neurons active
    if (st.labellumZ < 0.065 && st.proboscisOut) for (const f of this.env.food) {
      if (f.amount > 0 && Math.hypot(st.labellum[0] - f.x, st.labellum[1] - f.y) < f.r) {
        const intake = dt * 0.15 * f.sugar * (0.3 + 0.7 * this.motor.feeding());
        f.amount -= intake; this.energy += intake; this.eaten += intake; this.foodEaten[this.env.food.indexOf(f)] += intake; }
    }
    if (st.heat > 0.5) this.health -= dt * 0.5 * st.heat;
    if (this.energy <= 0) { this.energy = 0; this.health -= dt * 0.2; }
    this.energy = Math.min(1, this.energy);
    if (this.health <= 0 && this.alive) this.dieKnockover();
  }
  behavior(st) {
    const c = this.cmd || {}; const m = this.motor;
    if (!this.alive) return 'dead';
    if (c.righting) return 'righting';
    if (this.flight.active) return this.flight.label();
    if (m.jumping) return m.jumpCause === 'voluntary' ? 'taking off' : 'escape jump';
    if (this.intrinsic?.state === 'court') return c.singing ? 'singing (courtship)' : 'courting';
    if (c.grooming) return 'grooming';
    if (st && st.proboscisOut && st.labellumZ < 0.065 && this.env.food.some(f => f.amount > 0 && Math.hypot(st.labellum[0] - f.x, st.labellum[1] - f.y) < f.r)) return 'feeding';
    const pe = st && st.proboscisOut ? ' (proboscis out)' : '';
    if (c.v < -0.05) return 'walking backward' + pe;
    if (c.v > 0.05) return (Math.abs(c.turn) > 0.3 ? (c.turn > 0 ? 'turning left' : 'turning right') : 'walking') + pe;
    return pe ? 'proboscis extended' : 'standing';
  }
  pose() { const d = this.mjd; return { xpos: d.xpos.slice(0), xquat: d.xquat.slice(0) }; }
}
