import json, numpy as np, os, sys
sys.argv = ['x']; exec(open('scripts/gait_opt2.py').read().split("if __name__")[0]); setup()
xd = pad_x(np.array(json.load(open('body/gait/data_gait.json'))['x']))
def traj(x):  # joint angle trajectories over one cycle, per leg-pair & joint
    P, _, _ = unpack(x); ph = np.linspace(0, 2 * np.pi, 48, endpoint=False)
    return np.array([[cycle_q(ph, P[(leg, j)]) for j in J] for leg in LEGS])
Td = traj(xd)
files = [('FlySuite data', 'body/gait/data_gait.json'), ('synthetic (multi-condition)', 'body/gait/best_multi.json'),
         ('real-fly anchored 2h', 'body/gait/best_data.json'), ('3-harmonic CMA-ES', 'body/gait/best_3h.json')]
for name, f in files:
    if not os.path.exists(f): print(f'{name}: missing {f}'); continue
    b = json.load(open(f))
    x = pad_x(b['x']) if 'x' in b else load_x(f)
    rms = np.sqrt(np.mean((traj(x) - Td) ** 2))
    print(f'{name}: RMS joint-angle difference from FlySuite fit {np.degrees(rms):.1f} deg')
    for label, kw in [('forward', {}), ('turn left', {'turn': 0.35}), ('turn right', {'turn': -0.35}), ('slow', {'blend': 0.5, 'fscale': 0.5}), ('backward', {'direction': -1.0})]:
        r = run(x, T=1.5, **kw)
        print(f'   {label:11s}', 'FELL' if r is None else f"dx {r['x']:+.2f} dy {r['y']:+.2f} cm, yaw {np.degrees(r['dyaw']):+4.0f} deg, instability {r['stab']:.2f}")
