// Race-only sounds: menu/race looping beds, wing buzz, foot ticks; Yipee.wav on a win.
export function createRaceAudio(yipeeUrl, gongUrl) {
  let ctx, master, duckGain, musicGain, buzzGain, musicSrc, bedGain, musicBuf, menuBuf, yipeeBuf, gongBuf;
  let currentBed = null, lastStep = 0, muted = false, keepOsc = null;

  async function unlock() {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    // #region agent log
    fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'487c3c'},body:JSON.stringify({sessionId:'487c3c',runId:'ios-audio',hypothesisId:'D',location:'race-audio.js:unlock:enter',message:'unlock enter',data:{hadCtx:!!ctx,state:ctx?.state||null,hasCtor:!!Ctor,hasWebkit:!!window.webkitAudioContext,ios:/iPhone|iPad|iPod/i.test(navigator.userAgent)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (!ctx) {
      ctx = new Ctor();
      master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
      duckGain = ctx.createGain(); duckGain.gain.value = 1; duckGain.connect(master);
      musicGain = ctx.createGain(); musicGain.gain.value = 0.1; musicGain.connect(duckGain);
      buzzGain = ctx.createGain(); buzzGain.gain.value = 0; buzzGain.connect(master);
      musicBuf = makeMusicBuffer(ctx);
      menuBuf = makeMenuMusicBuffer(ctx);
      startBuzz();
    }
    const before = ctx.state;
    if (ctx.state === 'suspended' || ctx.state === 'interrupted') await ctx.resume();
    // #region agent log
    fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'487c3c'},body:JSON.stringify({sessionId:'487c3c',runId:'ios-audio',hypothesisId:'A',location:'race-audio.js:unlock:resume',message:'after resume',data:{before,after:ctx.state,muted,hidden:document.hidden},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (!yipeeBuf) {
      try {
        const raw = await (await fetch(yipeeUrl)).arrayBuffer();
        yipeeBuf = await ctx.decodeAudioData(raw.slice(0));
      } catch { yipeeBuf = null; }
    }
    if (gongUrl && !gongBuf) {
      try {
        const raw = await (await fetch(gongUrl)).arrayBuffer();
        gongBuf = await ctx.decodeAudioData(raw.slice(0));
      } catch { gongBuf = null; }
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
  function playBed(kind) {
    const buf = kind === 'menu' ? menuBuf : musicBuf;
    // #region agent log
    fetch('http://127.0.0.1:7630/ingest/33e5d0c9-099a-4d90-97f9-50e752800b07',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'487c3c'},body:JSON.stringify({sessionId:'487c3c',runId:'ios-audio',hypothesisId:'B',location:'race-audio.js:playBed',message:'playBed',data:{kind,state:ctx?.state||null,hasBuf:!!buf,same:(currentBed===kind&&!!musicSrc),muted,hidden:document.hidden},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (!ctx || ctx.state !== 'running') return;
    if (!buf || (currentBed === kind && musicSrc)) return;
    const now = ctx.currentTime, fade = 0.25;
    if (musicSrc && bedGain) {
      const oldSrc = musicSrc, oldGain = bedGain;
      const from = oldGain.gain.value;
      oldGain.gain.cancelScheduledValues(now);
      oldGain.gain.setValueAtTime(from, now);
      oldGain.gain.linearRampToValueAtTime(0, now + fade);
      try { oldSrc.stop(now + fade + 0.02); } catch {}
    }
    currentBed = kind;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(1, now + fade);
    src.connect(g); g.connect(musicGain); src.start();
    musicSrc = src;
    bedGain = g;
  }
  function stop() {
    try { musicSrc?.stop(); } catch {}
    musicSrc = null;
    bedGain = null;
    currentBed = null;
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
  function playGong() {
    duck(true);
    const done = () => duck(false);
    if (ctx && gongBuf) {
      const src = ctx.createBufferSource(), g = ctx.createGain();
      g.gain.value = 0.85; src.buffer = gongBuf; src.connect(g); g.connect(master);
      src.onended = done;
      src.start();
      setTimeout(done, (gongBuf.duration + 0.4) * 1000);
      return;
    }
    if (!gongUrl) { done(); return; }
    const el = new Audio(gongUrl); el.volume = 0.8;
    el.onended = done;
    el.play().catch(() => done());
    setTimeout(done, 4000);
  }
  function setMuted(v) {
    muted = v;
    if (master && ctx) master.gain.setTargetAtTime(v ? 0 : 1, ctx.currentTime, 0.04);
  }
  // Inaudible tone that bypasses mute so Chrome does not freeze a background host tab.
  function hold(on) {
    if (!ctx) return;
    if (!on) {
      try { keepOsc?.stop(); } catch {}
      keepOsc = null;
      return;
    }
    if (keepOsc) return;
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    osc.frequency.value = 18000;
    const g = ctx.createGain();
    g.gain.value = 0.0004;
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start();
    keepOsc = osc;
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
  function playOof() {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 780; lp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.018);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.32);
    lp.connect(g); g.connect(master);
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    o1.frequency.setValueAtTime(190, t0); o1.frequency.exponentialRampToValueAtTime(72, t0 + 0.24);
    const o2 = ctx.createOscillator(); o2.type = 'sine';
    o2.frequency.setValueAtTime(310, t0); o2.frequency.exponentialRampToValueAtTime(88, t0 + 0.2);
    o1.connect(lp); o2.connect(lp);
    const n = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.12), ctx.sampleRate);
    const d = n.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const ns = ctx.createBufferSource(); ns.buffer = n;
    const ng = ctx.createGain(); ng.gain.value = 0.14;
    ns.connect(ng); ng.connect(lp);
    o1.start(t0); o2.start(t0); ns.start(t0);
    o1.stop(t0 + 0.34); o2.stop(t0 + 0.34); ns.stop(t0 + 0.12);
  }
  function stepClick(t0) {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(700, t0); o.frequency.exponentialRampToValueAtTime(320, t0 + 0.08);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.07, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 0.13);
  }
  function playSelect(id = 0) {
    if (!ctx || ctx.state !== 'running' || muted) return;
    const t0 = ctx.currentTime;
    const f0 = 720 * Math.pow(2, ((id % 6) / 12));
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f0 * 1.7, t0 + 0.07);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.09, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.11);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 0.12);
  }
  function playTakeoff() {
    if (!ctx || ctx.state !== 'running' || muted) return;
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, t0); o.frequency.exponentialRampToValueAtTime(980, t0 + 0.22);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.08, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
    o.connect(bp); bp.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 0.3);
  }
  function playLobbyTick(left = 5) {
    if (!ctx || ctx.state !== 'running' || muted) return;
    const t0 = ctx.currentTime;
    const f0 = 520 + (6 - Math.min(5, Math.max(1, left))) * 90;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f0 * 0.7, t0 + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 0.1);
  }
  return { unlock, playBed, stop, playYipee, playGong, playOof, playSelect, playTakeoff, playLobbyTick, setMuted, setMotion, hold };
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

function makeMenuMusicBuffer(ctx) {
  const sr = ctx.sampleRate, dur = 10, n = Math.floor(sr * dur);
  const buf = ctx.createBuffer(2, n, sr);
  const notes = [392.00, 0, 493.88, 392.00, 0, 587.33, 493.88, 0, 329.63, 392.00, 0, 493.88, 587.33, 0, 659.25, 392.00];
  const beat = dur / notes.length, lag = 0.007;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      const wall = i / sr;
      const t = ch ? (wall - lag + dur) % dur : wall;
      const k = Math.floor(t / beat) % notes.length, f = notes[k], u = (t % beat) / beat;
      const fade = wall < 0.08 ? wall / 0.08 : wall > dur - 0.08 ? (dur - wall) / 0.08 : 1;
      if (!f) { d[i] = 0; continue; }
      const env = Math.exp(-u * 9);
      const bell = Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(2 * Math.PI * 2.01 * f * t)
        + 0.15 * Math.sin(2 * Math.PI * 3.02 * f * t) + 0.08 * Math.sin(2 * Math.PI * 5.04 * f * t);
      d[i] = bell * env * 0.2 * fade;
    }
  }
  return buf;
}
