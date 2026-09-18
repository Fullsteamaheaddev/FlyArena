import json, numpy as np, sys
sys.argv = ['x']; exec(open('scripts/gait_opt2.py').read().split("if __name__")[0]); setup()
src = sys.argv[1] if len(sys.argv) > 1 else 'body/gait/best_3h.json'
x = load_x(src)
for label, kw in [('forward', {}), ('turn +0.4', {'turn': 0.4}), ('turn -0.4', {'turn': -0.4}), ('backward', {'direction': -1.0}), ('slow', {'blend': 0.5, 'fscale': 0.5})]:
    r = run(x, T=2.0, **kw)
    if r is None: print(label, 'FELL'); continue
    dist = np.hypot(r['x'], r['y']); dur = r['dur']
    print(f'{label:10s} dx {r["x"]:+.2f} dy {r["y"]:+.2f} | speed {dist/dur:.2f} cm/s | yaw {np.degrees(r["dyaw"]):+.0f} deg | instability {r["stab"]:.2f}')
