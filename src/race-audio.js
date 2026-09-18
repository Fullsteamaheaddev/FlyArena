// Race-only sounds: Start-unlocked Web Audio bed, wing buzz, foot ticks; Yipee.wav on a win.
export function createRaceAudio(yipeeUrl) {
  let ctx, master, duckGain, musicGain, buzzGain, musicSrc, musicBuf, yipeeBuf, lastStep = 0, muted = false;

  async function unlock() {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
      duckGain = ctx.createGain(); duckGain.gain.value = 1; duckGain.connect(master);
      musicGain = ctx.createGain(); musicGain.gain.value = 0.055; musicGain.connect(duckGain);
      buzzGain = ctx.createGain(); buzzGain.gain.value = 0; buzzGain.connect(master);
      musicBuf = makeMusicBuffer(ctx);
      startBuzz();
    }
    if (ctx.state === 'suspended') await ctx.resume();
    startMusic();
    if (!yipeeBuf) {
      try {
        const raw = await (await fetch(yipeeUrl)).arrayBuffer();
        yipeeBuf = await ctx.decodeAudioData(raw.slice(0));
      } catch { yipeeBuf = null; }
    }
  }
  function startBuzz() {
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 218;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 436; bp.Q.value = 5;
    osc.connect(bp); bp.connect(buzzGain); osc.start();
    const n = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
    const d = n.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = n; noise.loop = true;
    const nbp = ctx.createBiquadFilter(); nbp.type = 'bandpass'; nbp.frequency.value = 900; nbp.Q.value = 1.2;
    const ng = ctx.createGain(); ng.gain.value = 0.35;
    noise.connect(nbp); nbp.connect(ng); ng.connect(buzzGain); noise.start();
  }
  function startMusic() {
    if (!ctx || musicSrc) return;
    musicSrc = ctx.createBufferSource(); musicSrc.buffer = musicBuf; musicSrc.loop = true;
    musicSrc.connect(musicGain); musicSrc.start();
  }
  function stop() {
    try { musicSrc?.stop(); } catch {}
    musicSrc = null;
    lastStep = 0;
    if (ctx && buzzGain) buzzGain.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
    duck(false);
  }
  function duck(on) {
    if (!ctx || !duckGain) return;
    duckGain.gain.setTargetAtTime(on ? 0.12 : 1, ctx.currentTime, 0.08);
  }
  function playYipee() {
    duck(true);
    const done = () => duck(false);
    if (ctx && yipeeBuf) {
      const src = ctx.createBufferSource(), g = ctx.createGain();
      g.gain.value = 0.75; src.buffer = yipeeBuf; src.connect(g); g.connect(master);
      src.onended = done;
      src.start();
      setTimeout(done, (yipeeBuf.duration + 0.4) * 1000);
      return;
    }
    const el = new Audio(yipeeUrl); el.volume = 0.7;
    el.onended = done;
    el.play().catch(() => done());
    setTimeout(done, 4000);
  }
  function setMuted(v) {
    muted = v;
    if (master && ctx) master.gain.setTargetAtTime(v ? 0 : 1, ctx.currentTime, 0.04);
  }
  function setMotion({ flying, walk }) {
    if (!ctx || ctx.state !== 'running' || muted) return;
    const now = ctx.currentTime;
    buzzGain.gain.setTargetAtTime(flying ? 0.07 : 0, now, 0.08);
    if (flying || walk < 0.08) return;
    const hz = 1.8 + 1.2 * Math.min(1, walk);
    if (now - lastStep < 1 / hz) return;
    lastStep = now;
    stepClick(now);
  }
  function stepClick(t0) {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(700, t0); o.frequency.exponentialRampToValueAtTime(320, t0 + 0.08);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.07, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 0.13);
  }
  return { unlock, stop, playYipee, setMuted, setMotion };
}

function makeMusicBuffer(ctx) {
  const sr = ctx.sampleRate, dur = 8, n = Math.floor(sr * dur);
  const buf = ctx.createBuffer(2, n, sr);
  const notes = [261.63, 329.63, 392.00, 440.00, 392.00, 329.63, 293.66, 261.63];
  const beat = dur / notes.length;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch), pan = ch ? 1.02 : 0.98;
    for (let i = 0; i < n; i++) {
      const t = i / sr, k = Math.floor(t / beat) % notes.length, u = (t % beat) / beat;
      const env = Math.sin(Math.PI * Math.min(1, 0.08 + u * 0.88)) ** 1.3;
      const f = notes[k] * pan;
      const tri = Math.sin(2 * Math.PI * f * t) - 0.11 * Math.sin(2 * Math.PI * 3 * f * t);
      const pad = 0.2 * Math.sin(2 * Math.PI * 130.81 * t) + 0.14 * Math.sin(2 * Math.PI * 196 * t * pan) + 0.08 * Math.sin(2 * Math.PI * 261.63 * t);
      const fade = t < 0.06 ? t / 0.06 : t > dur - 0.06 ? (dur - t) / 0.06 : 1;
      d[i] = (pad + 0.13 * env * tri) * 0.2 * fade;
    }
  }
  return buf;
}
