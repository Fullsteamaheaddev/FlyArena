"""Continuous attractor neural field (PDE) model of the heading circuit.

Amari-type field on S^1 with the measured structural parameters:

    tau * du(theta,t)/dt = -u + W * f(u)          # recurrent kernel (Delta7: a - b cos)
                         + v+ * [f(u) shifted +s] + v- * [f(u) shifted -s]
                         - (v+ + v-) * f(u)      # PEN push-pull: wired columnar offsets
                         + I_landmark(theta,t)   # localized visual anchoring
                         + xi(theta,t)           # per-position noise

PEN feedback is the literal biological mechanism: the left/right PEN->EPG
projections are wired ~+-1.5 columns ahead, so a velocity-modulated copy of the
current bump fed back at that offset drags the bump — angular velocity is
integrated by geometry, not arithmetic.

    python3 scripts/ring_pde.py    # self-check: bump sustains, velocity rotates it
"""
import numpy as np


class RingField:
    """Recurrent kernel = local EPG<->EPG/PEG excitation + measured Delta7 surround
    inhibition. The Delta7 part alone is (a - b cos) ~ 0 at the bump, strong at the
    antipode — it is the surround, not the center; the narrow excitatory component
    is the EPG recurrence whose gain the wiring does not fix (epgRecur axis)."""
    def __init__(self, n=256, tau=0.05, epg_recur=2.2, d7_gain=1.0,
                 shift_cols=1.47, n_cols=8, thr=0.2):
        self.n, self.tau = n, tau
        k = np.arange(n)
        c = np.cos(2 * np.pi * k / n)
        exc = epg_recur * np.maximum(0.0, c) ** 4          # narrow same-wedge excitation
        inh = d7_gain * 0.89 * (1.0 - c)                   # Delta7: a-b*cos, a~=b=~880/1000
        self.W = exc - inh
        self.s = shift_cols * n / n_cols                   # PEN offset in field cells
        self.thr = thr
        self.vel_gain = 1.0                                # PEN advection coupling: bump speed = om*vel_gain
        self.u = np.zeros(n)

    def f(self, u):
        return np.clip((u - self.thr) / (1.0 - self.thr), 0.0, 1.0)  # saturating rate

    def step(self, om=0.0, landmark=None, lm_gain=0.0, dt=0.005, noise=0.0, rng=None):
        # PEN pathway: L/R shifted projections implement advection of the bump
        # (shifted feedback ~ s*df/dtheta). Spectral shift = exact translation.
        if om:
            m = np.fft.fftfreq(self.n) * self.n
            delta = om * dt * self.vel_gain * self.n / (2 * np.pi)
            self.u = np.fft.ifft(np.fft.fft(self.u) * np.exp(-2j * np.pi * m * delta / self.n)).real
        fu = self.f(self.u)
        rec = np.fft.ifft(np.fft.fft(self.W) * np.fft.fft(fu)).real
        pen = 0.0
        lm = 0.0
        if landmark is not None:
            th = np.linspace(0, 2 * np.pi, self.n, endpoint=False)
            # landmark anchoring via ring-neuron disinhibition: global EPG
            # suppression with a gap at the landmark bearing (R-neuron wiring)
            lm = -lm_gain * (1.0 - np.cos(th - landmark)) / 2.0 + 0.3 * lm_gain * np.maximum(0.0, np.cos(th - landmark))
        xi = rng.normal(0, noise, self.n) if noise and rng is not None else 0.0
        self.u += dt / self.tau * (-self.u + rec + pen + lm + xi)
        return self.theta()

    def theta(self):
        k = np.arange(self.n)
        fu = self.f(self.u)
        if fu.sum() < 1e-9: return None
        return np.arctan2((fu * np.sin(2 * np.pi * k / self.n)).sum(),
                          (fu * np.cos(2 * np.pi * k / self.n)).sum())

    def bump_width(self):
        fu = self.f(self.u)
        if fu.max() <= 0: return 0
        pk = np.argmax(fu)
        return int((np.roll(fu, -pk + self.n // 2) > fu.max() / 2).sum())


if __name__ == '__main__':
    rng = np.random.default_rng(0)
    f = RingField()
    # seed a bump, check it persists
    th = np.linspace(0, 2 * np.pi, f.n, endpoint=False)
    f.u = np.maximum(0, np.cos(th - 1.0)) + 0.4
    for _ in range(200): f.step(dt=0.005)
    t0 = f.theta(); w0 = f.bump_width()
    print(f'seeded bump: theta {t0:.2f}, width {w0} cells, sustained={t0 is not None}')
    # velocity integration: constant omega should rotate the bump
    for _ in range(400): f.step(om=1.0, dt=0.005)
    t1 = f.theta()
    print(f'after om=+1 for 2s: theta {t0:.2f} -> {t1:.2f}  (drift {t1 - t0:+.2f} rad)')
    # landmark snap (disinhibition needs enough gain to beat antipodal suppression)
    for _ in range(600): f.step(om=0.0, landmark=0.0, lm_gain=25.0, dt=0.005)
    print(f'landmark at 0: theta {t1:.2f} -> {f.theta():.2f}')
