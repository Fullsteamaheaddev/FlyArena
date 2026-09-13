// Preserve scan/hair geometry while adapting the expensive full-screen passes on dense displays.
// Slow simulation workers in wide views must not cause needless resolution loss.
export class RenderResolution {
  constructor(onChange) {
    this.onChange = onChange;
    this.reset();
  }

  reset() {
    this.maximum = Math.min(devicePixelRatio, 2, Math.sqrt(2400000 / (innerWidth * innerHeight)));
    this.minimum = Math.min(0.9, this.maximum);
    this.ratio = this.maximum;
    this.last = 0; this.total = 0; this.frames = 0; this.stable = 0;
  }

  update(now, expensive = true) {
    const dt = now - this.last; this.last = now;
    // Ignore initialisation, tab suspension and single long compilation/interaction stalls.
    if (dt <= 0 || dt > 100) { this.total = 0; this.frames = 0; return; }
    this.total += dt; this.frames++;
    if (this.total < 1000) return;
    const mean = this.total / this.frames;
    this.stable = mean < 17.5 ? this.stable + this.total : 0;
    let next = this.ratio;
    if (expensive && mean > 19) next = Math.max(this.minimum, this.ratio * 0.85);
    else if (this.stable > 8000) { next = Math.min(this.maximum, this.ratio * 1.05); this.stable = 0; }
    this.total = 0; this.frames = 0;
    if (Math.abs(next - this.ratio) < 0.001) return;
    this.ratio = next; this.onChange();
  }
}
