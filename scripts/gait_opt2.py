"""Multi-condition refinement of the stepping pattern generator, matching src/sim/motor.js exactly:
q_joint = amp_f * (off + a1 cos(phi+p1) + a2 cos(2phi+p2) + a3 cos(3phi+p3)); coxa oscillation scaled by
steer = 1 + turn*(-1 left / +1 right) (turn > 0 = left descending neurons more active = turn left).
Amplitude is smoothed (150 ms); stance duty shortens slightly with speed.
Conditions: straight forward, left/right turns, slow walking (blend 0.5, 0.5x frequency) and backward
walking (phase reversed). Starts from public/body/gait.json; regularises toward FlySuite data_gait.json."""
import mujoco, numpy as np, json, sys, os, cma, multiprocessing as mp, time
XML = open('public/body/fly_physics.xml').read().replace('<worldbody>', '<worldbody>\n<geom name="floor" type="plane" size="30 30 .1" pos="0 0 -.132" friction="1" solref="0.0002 1"/>', 1)
J = ['coxa', 'coxa_abduct', 'coxa_twist', 'femur', 'femur_twist', 'tibia', 'tarsus']; LEGS = ['T1', 'T2', 'T3']; SIDES = ['left', 'right']
PH = {('T1', 'left'): 0, ('T2', 'right'): 0, ('T3', 'left'): 0, ('T1', 'right'): np.pi, ('T2', 'left'): np.pi, ('T3', 'right'): np.pi}
FREQ = 10.0; NPJ = 7; N_JOINT = len(LEGS) * len(J); AMP_TAU = 150.0; m = d = None
def setup():
    global m, d, act, rng, th, LB, floor
    m = mujoco.MjModel.from_xml_string(XML); d = mujoco.MjData(m); act = {}; rng = {}
    for leg in LEGS:
        for sd in SIDES:
            for j in J: a = m.actuator(f'{j}_{leg}_{sd}').id; act[(leg, sd, j)] = a; rng[(leg, sd, j)] = m.actuator_ctrlrange[a].copy()
            act[(leg, sd, 'adh')] = m.actuator(f'adhere_claw_{leg}_{sd}').id
    th = m.body('thorax').id; floor = m.geom('floor').id
    LB = set(i for i in range(m.nbody) if any(k in m.body(i).name for k in ('claw', 'tarsus')))
def pad_params(p):
    p = list(p)
    if len(p) >= NPJ: return p[:NPJ]
    return p[:5] + [0.0, 0.0]
def pad_x(x):
    x = np.asarray(x, dtype=float).ravel()
    n_per = (len(x) - 2) // N_JOINT
    if n_per == NPJ: return x
    if n_per == 5:
        out = []
        k = 0
        for _ in range(N_JOINT):
            out.extend(x[k:k + 5]); out.extend((0.0, 0.0)); k += 5
        return np.concatenate([np.array(out, dtype=float), x[-2:]])
    raise ValueError(f'gait x length {len(x)} is not 5- or 7-param')
def load_x(src):
    b = json.load(open(src))
    if 'x' in b: return pad_x(b['x'])
    x = []
    for leg in LEGS:
        for j in J: x.extend(pad_params(b['params'][leg][j]))
    x += [b['duty'], b['adhPhase']]
    return np.array(x, dtype=float)
def cycle_q(phi, p):
    off, a1, p1, a2, p2 = p[0], p[1], p[2], p[3], p[4]
    a3 = p[5] if len(p) > 5 else 0.0
    p3 = p[6] if len(p) > 6 else 0.0
    return off + a1 * np.cos(phi + p1) + a2 * np.cos(2 * phi + p2) + a3 * np.cos(3 * phi + p3)
def unpack(x):
    x = pad_x(x); P = {}; k = 0
    for leg in LEGS:
        for j in J: P[(leg, j)] = x[k:k + NPJ]; k += NPJ
    return P, float(np.clip(x[k], 0.3, 0.8)), x[k + 1]
def speed_from_blend(blend):
    return 1.0 if blend >= 1.0 else float(np.clip(blend / 1.5, 0.0, 1.0))
def duty_at(duty0, blend):
    return float(np.clip(duty0 * (1.08 - 0.16 * speed_from_blend(blend)), 0.3, 0.8))
def run(x, T=1.2, blend=1.0, turn=0.0, direction=1.0, fscale=1.0):
    if m is None: setup()
    mujoco.mj_resetData(m, d); P, duty0, adhph = unpack(x); phase = 0.0; amp_f = 0.0
    n = int(T / m.opt.timestep); zs = []; sup = 0; ns = 0; tilt = 0; bodyc = 0; yaws = []
    dt_ctrl = 10 * m.opt.timestep; duty = duty_at(duty0, blend)
    for s in range(n):
        if s % 10 == 0:
            amp_f += (dt_ctrl * 1000 / AMP_TAU) * (blend - amp_f)
            phase += direction * 2 * np.pi * FREQ * (0.5 + 0.5 * fscale) * dt_ctrl
            for leg in LEGS:
                for sd in SIDES:
                    phi = phase + PH[(leg, sd)]; steer = 1 + turn * (-1 if sd == 'left' else 1)
                    for j in J:
                        q = cycle_q(phi, P[(leg, j)])
                        if j == 'coxa': q = P[(leg, j)][0] + steer * (q - P[(leg, j)][0])
                        lo, hi = rng[(leg, sd, j)]; d.ctrl[act[(leg, sd, j)]] = np.clip(amp_f * q, lo, hi)
                    st = ((phi + adhph) % (2 * np.pi)) < 2 * np.pi * duty
                    d.ctrl[act[(leg, sd, 'adh')]] = 1.0 if (amp_f > 0.05 and st) else (0.8 if amp_f <= 0.05 else 0.0)
        mujoco.mj_step(m, d)
        if s % 50 == 0 and s > 1500:
            ns += 1; R = d.xmat[th].reshape(3, 3)
            if R[2, 2] < 0.5 or not np.isfinite(d.qpos).all(): return None
            tilt += max(0, 0.95 - R[2, 2]); zs.append(d.xpos[th][2]); yaws.append(np.arctan2(R[1, 0], R[0, 0]))
            feet = set()
            for c in range(d.ncon):
                con = d.contact[c]
                if con.geom1 == floor or con.geom2 == floor:
                    b = m.geom_bodyid[con.geom2 if con.geom1 == floor else con.geom1]
                    if b in LB: feet.add(m.body(b).name.split('_', 1)[1])
                    else: bodyc += 1
            sup += max(0, 3 - len(feet))
    yaw = np.unwrap(np.array(yaws)); R = d.xmat[th].reshape(3, 3)
    return dict(x=d.xpos[th][0], y=d.xpos[th][1], dyaw=float(yaw[-1] - yaw[0]), dur=(n - 1500) * m.opt.timestep,
                stab=2 * tilt / ns + 1.5 * sup / ns + 30 * float(np.std(zs)) + bodyc / ns)
def score(x):
    tot = 0
    f = run(x);  tot += -5 if f is None else min(f['x'], 3.0 * f['dur']) - 0.8 * abs(f['dyaw']) - f['stab']
    for sgn in (1, -1):
        t = run(x, turn=0.35 * sgn)
        tot += -3 if t is None else 0.5 * np.clip(sgn * t['dyaw'], -1, 1.2) - t['stab']        # ~ +70 deg/s yaw in commanded direction
    s = run(x, blend=0.5, fscale=0.5); tot += -3 if s is None else 0.5 * min(s['x'], 1.5 * s['dur']) - s['stab']
    b = run(x, direction=-1.0); tot += -3 if b is None else 0.5 * min(-b['x'], 1.5 * b['dur']) - b['stab']
    return float(tot)
XDATA = None; LAM = 0.0; LAM_A3 = 1.0
def score_reg(x):
    s = score(x)
    if XDATA is None: return s
    x = pad_x(x); d = pad_x(XDATA); pen = 0.0
    for i in range(N_JOINT):
        b = i * NPJ
        pen += LAM * float(np.sum((x[b:b + 5] - d[b:b + 5]) ** 2))
        pen += LAM_A3 * float((x[b + 5] - d[b + 5]) ** 2)
        # skip p3: third-harmonic phase is unidentified when |a3| is ~0.01 rad
    return s - pen
def init_worker(xdata=None, lam=0.0, lam_a3=1.0):
    global XDATA, LAM, LAM_A3
    setup()
    XDATA = xdata; LAM = lam; LAM_A3 = lam_a3
if __name__ == '__main__':
    mp.freeze_support()
    iters = int(sys.argv[1]) if len(sys.argv) > 1 else 80
    src = sys.argv[2] if len(sys.argv) > 2 else 'public/body/gait.json'
    x0 = load_x(src)
    data_path = 'body/gait/data_gait.json'
    if os.path.exists(data_path):
        XDATA = pad_x(json.load(open(data_path))['x'])
        LAM = float(sys.argv[3]) if len(sys.argv) > 3 else 2.0
    # cap workers: each spawn loads MuJoCo+NumPy; cpu_count() (24 here) exhausts the Windows page file
    n_workers = min(4, os.cpu_count() or 1)
    if len(sys.argv) > 4: n_workers = max(1, int(sys.argv[4]))
    pool = mp.Pool(n_workers, initializer=init_worker, initargs=(XDATA, LAM, LAM_A3))
    print('workers', n_workers, 'start score', pool.apply(score, (x0,)), 'regularised', pool.apply(score_reg, (x0,)), 'n', len(x0), flush=True)
    es = cma.CMAEvolutionStrategy(x0, 0.05, {'popsize': 24, 'seed': 5, 'verbose': -9}); best = (-1e9, None); t0 = time.time()
    out_path = 'body/gait/best_3h.json'
    for it in range(iters):
        X = es.ask(); F = pool.map(score_reg, X); es.tell(X, [-f for f in F]); i = int(np.argmax(F))
        if F[i] > best[0]: best = (F[i], X[i]); json.dump({'x': list(map(float, X[i])), 'score': float(F[i]), 'freq': FREQ, 'joints': J, 'legs': LEGS, 'harmonics': 3}, open(out_path, 'w'))
        print(f'iter {it} best {best[0]:.3f} gen-best {max(F):.3f} ({time.time()-t0:.0f}s)', flush=True)
