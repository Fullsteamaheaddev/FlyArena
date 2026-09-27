// Race-only sounds: menu/race looping beds, wing buzz, foot ticks; Yipee.wav on a win.
export function createRaceAudio(yipeeUrl, gongUrl, extraUrls = {}) {
  const boopUrl = extraUrls.boop;
  const thunderUrl = extraUrls.thunder;
  const thumbUrl = extraUrls.thumb;
  let ctx, master, duckGain, musicGain, buzzGain, musicSrc, bedGain, musicBuf, menuBuf, yipeeBuf, gongBuf, boopBuf, thunderBuf, thumbBuf;
  let currentBed = null, lastStep = 0, muted = false, keepOsc = null;

  async function unlock() {
    const Ctor = window.AudioContext || window.webkitAudioContext;
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
    if (ctx.state === 'suspended' || ctx.state === 'interrupted') await ctx.resume();
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
    if (boopUrl && !boopBuf) {
      try {
        const raw = await (await fetch(boopUrl)).arrayBuffer();
        boopBuf = await ctx.decodeAudioData(raw.slice(0));
      } catch { boopBuf = null; }
    }
    if (thunderUrl && !thunderBuf) {
      try {
        const raw = await (await fetch(thunderUrl)).arrayBuffer();
        thunderBuf = await ctx.decodeAudioData(raw.slice(0));
      } catch { thunderBuf = null; }
    }
    if (thumbUrl && !thumbBuf) {
      try {
        const raw = await (await fetch(thumbUrl)).arrayBuffer();
        thumbBuf = await ctx.decodeAudioData(raw.slice(0));
      } catch { thumbBuf = null; }
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
  function playChaos(kind, extra = {}) {
    if (!ctx || ctx.state !== 'running' || muted) return;
    const t0 = ctx.currentTime;
    const hold = { thumb: 1.5, spin: 0.9, quake: 5.2, flip: 2.2, tilt: 3.4, lightning: 1.6, double: 2.8, crumb: 0.7, firefly: 7.1, boop: 1.1, puff: 5.1 }[kind] || 0.8;
    duck(true);
    setTimeout(() => duck(false), hold * 1000);
    if (kind === 'thumb') { sfxThumb(t0); playBuf(thumbBuf, t0, 0.85); }
    else if (kind === 'spin') sfxSpin(t0);
    else if (kind === 'quake') sfxQuake(t0);
    else if (kind === 'flip') sfxFlip(t0);
    else if (kind === 'tilt') sfxTilt(t0);
    else if (kind === 'lightning') {
      sfxBolt(t0, extra.killed ? 1.15 : 0.95); sfxBolt(t0 + 0.35, 0.9); sfxBolt(t0 + 0.7, 0.85);
      playBuf(thunderBuf, t0, 0.85); playBuf(thunderBuf, t0 + 0.35, 0.8); playBuf(thunderBuf, t0 + 0.7, 0.75);
    }
    else if (kind === 'double') {
      for (let i = 0; i < 6; i++) {
        const t = t0 + i * 0.4;
        sfxBolt(t, 0.7);
        playBuf(thunderBuf, t, 0.55);
      }
    }
    else if (kind === 'crumb') sfxCrumb(t0);
    else if (kind === 'firefly') sfxFirefly(t0);
    else if (kind === 'boop') { sfxBoop(t0); playBuf(boopBuf, t0, 0.85); }
    else if (kind === 'puff') sfxPuff(t0);
  }
  function playBuf(buf, when, gain = 0.8) {
    if (!ctx || !buf) return;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    g.gain.value = gain;
    src.buffer = buf;
    src.connect(g); g.connect(master);
    src.start(when);
  }
  function noiseSrc(dur) {
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = b; return src;
  }
  function sfxThumb(t0) {
    const thud = ctx.createOscillator(); thud.type = 'sine';
    thud.frequency.setValueAtTime(90, t0); thud.frequency.exponentialRampToValueAtTime(42, t0 + 0.16);
    const tg = ctx.createGain(); tg.gain.setValueAtTime(0.0001, t0); tg.gain.exponentialRampToValueAtTime(0.45, t0 + 0.012); tg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
    thud.connect(tg); tg.connect(master); thud.start(t0); thud.stop(t0 + 0.24);
    const ns = noiseSrc(0.18); const bp = ctx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 420;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.22, t0); ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
    ns.connect(bp); bp.connect(ng); ng.connect(master); ns.start(t0);
    const t1 = t0 + 1.05;
    const who = noiseSrc(0.28); const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 1400; hp.Q.value = 0.7;
    const wg = ctx.createGain(); wg.gain.setValueAtTime(0.0001, t1); wg.gain.exponentialRampToValueAtTime(0.22, t1 + 0.02); wg.gain.exponentialRampToValueAtTime(0.001, t1 + 0.28);
    who.connect(hp); hp.connect(wg); wg.connect(master); who.start(t1);
  }
  function sfxSpin(t0) {
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(160, t0); o.frequency.exponentialRampToValueAtTime(1200, t0 + 0.48);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(320, t0); bp.frequency.exponentialRampToValueAtTime(1900, t0 + 0.48); bp.Q.value = 4;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.14, t0 + 0.04); g.gain.setValueAtTime(0.14, t0 + 0.5); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.62);
    const ns = noiseSrc(0.62); const ng = ctx.createGain(); ng.gain.value = 0.08;
    o.connect(bp); ns.connect(bp); bp.connect(g); g.connect(master); ns.connect(ng); ng.connect(master);
    o.start(t0); o.stop(t0 + 0.62); ns.start(t0);
  }
  function sfxQuake(t0) {
    const ns = noiseSrc(5.1); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 90; lp.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.28, t0 + 0.18); g.gain.setValueAtTime(0.22, t0 + 4.6); g.gain.exponentialRampToValueAtTime(0.001, t0 + 5.15);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 38;
    const og = ctx.createGain(); og.gain.value = 0.12;
    ns.connect(lp); lp.connect(g); g.connect(master); o.connect(og); og.connect(g);
    ns.start(t0); o.start(t0); o.stop(t0 + 5.15);
  }
  function sfxFlip(t0) {
    const knock = ctx.createOscillator(); knock.type = 'triangle';
    knock.frequency.setValueAtTime(180, t0); knock.frequency.exponentialRampToValueAtTime(70, t0 + 0.12);
    const kg = ctx.createGain(); kg.gain.setValueAtTime(0.35, t0); kg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
    knock.connect(kg); kg.connect(master); knock.start(t0); knock.stop(t0 + 0.2);
    const who = noiseSrc(0.45); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(400, t0); bp.frequency.exponentialRampToValueAtTime(1800, t0 + 0.35);
    const wg = ctx.createGain(); wg.gain.setValueAtTime(0.0001, t0 + 0.05); wg.gain.exponentialRampToValueAtTime(0.2, t0 + 0.08); wg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
    who.connect(bp); bp.connect(wg); wg.connect(master); who.start(t0 + 0.05);
    const t1 = t0 + 0.7;
    const cl = noiseSrc(0.2); const lp = ctx.createBiquadFilter(); lp.type = 'highpass'; lp.frequency.value = 900;
    const cg = ctx.createGain(); cg.gain.setValueAtTime(0.16, t1); cg.gain.exponentialRampToValueAtTime(0.001, t1 + 0.2);
    cl.connect(lp); lp.connect(cg); cg.connect(master); cl.start(t1);
  }
  function sfxTilt(t0) {
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(260, t0); o.frequency.linearRampToValueAtTime(110, t0 + 0.85);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.26, t0 + 0.06);
    g.gain.setValueAtTime(0.2, t0 + 0.5); g.gain.exponentialRampToValueAtTime(0.001, t0 + 1.05);
    o.connect(bp); bp.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 1.08);
    const rumble = noiseSrc(1.1);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.0001, t0); rg.gain.exponentialRampToValueAtTime(0.14, t0 + 0.08);
    rg.gain.exponentialRampToValueAtTime(0.001, t0 + 1.0);
    rumble.connect(lp); lp.connect(rg); rg.connect(master); rumble.start(t0);
    const t1 = t0 + 3.0;
    const clunk = ctx.createOscillator(); clunk.type = 'sine';
    clunk.frequency.setValueAtTime(105, t1); clunk.frequency.exponentialRampToValueAtTime(42, t1 + 0.2);
    const cg = ctx.createGain(); cg.gain.setValueAtTime(0.55, t1); cg.gain.exponentialRampToValueAtTime(0.001, t1 + 0.28);
    clunk.connect(cg); cg.connect(master); clunk.start(t1); clunk.stop(t1 + 0.3);
    const slam = noiseSrc(0.25);
    const hp = ctx.createBiquadFilter(); hp.type = 'lowpass'; hp.frequency.value = 480;
    const sg = ctx.createGain(); sg.gain.setValueAtTime(0.22, t1); sg.gain.exponentialRampToValueAtTime(0.001, t1 + 0.22);
    slam.connect(hp); hp.connect(sg); sg.connect(master); slam.start(t1);
  }
  function sfxBolt(t0, amp = 1) {
    const ns = noiseSrc(0.18); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.0001, t0); ng.gain.exponentialRampToValueAtTime(0.55 * amp, t0 + 0.004); ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
    ns.connect(hp); hp.connect(ng); ng.connect(master); ns.start(t0);
    const th = noiseSrc(0.7); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
    const tg = ctx.createGain(); tg.gain.setValueAtTime(0.0001, t0); tg.gain.exponentialRampToValueAtTime(0.28 * amp, t0 + 0.03); tg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.75);
    th.connect(lp); lp.connect(tg); tg.connect(master); th.start(t0);
  }
  function sfxCakeSmoosh(t0) {
    const sponge = ctx.createOscillator(); sponge.type = 'triangle';
    sponge.frequency.setValueAtTime(88, t0); sponge.frequency.exponentialRampToValueAtTime(54, t0 + 0.2);
    const sponge2 = ctx.createOscillator(); sponge2.type = 'sine';
    sponge2.frequency.setValueAtTime(132, t0); sponge2.frequency.exponentialRampToValueAtTime(72, t0 + 0.18);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t0); sg.gain.exponentialRampToValueAtTime(0.28, t0 + 0.014);
    sg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.24);
    sponge.connect(sg); sponge2.connect(sg); sg.connect(master);
    sponge.start(t0); sponge.stop(t0 + 0.26); sponge2.start(t0); sponge2.stop(t0 + 0.24);
    const goo = noiseSrc(0.34);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.setValueAtTime(380, t0); bp.frequency.exponentialRampToValueAtTime(140, t0 + 0.26);
    bp.Q.setValueAtTime(1.4, t0); bp.Q.linearRampToValueAtTime(0.55, t0 + 0.22);
    const gg = ctx.createGain();
    gg.gain.setValueAtTime(0.0001, t0); gg.gain.exponentialRampToValueAtTime(0.36, t0 + 0.007);
    gg.gain.setValueAtTime(0.24, t0 + 0.09); gg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.36);
    goo.connect(bp); bp.connect(gg); gg.connect(master); goo.start(t0);
    const smear = ctx.createOscillator(); smear.type = 'sine';
    smear.frequency.setValueAtTime(260, t0 + 0.025); smear.frequency.exponentialRampToValueAtTime(105, t0 + 0.22);
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(0.0001, t0 + 0.025); mg.gain.exponentialRampToValueAtTime(0.14, t0 + 0.045);
    mg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
    smear.connect(mg); mg.connect(master); smear.start(t0 + 0.025); smear.stop(t0 + 0.3);
    const cream = noiseSrc(0.24);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(220, t0); lp.frequency.exponentialRampToValueAtTime(95, t0 + 0.3);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.2, t0 + 0.008); cg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.32);
    cream.connect(lp); lp.connect(cg); cg.connect(master); cream.start(t0 + 0.008);
  }
  function playCakeLand() {
    if (!ctx || ctx.state !== 'running' || muted) return;
    sfxCakeSmoosh(ctx.currentTime);
  }
  function sfxCrumb(t0) {
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator(); o.type = 'sine';
      const f = 980 + i * 420;
      o.frequency.setValueAtTime(f, t0 + i * 0.04); o.frequency.exponentialRampToValueAtTime(f * 1.4, t0 + i * 0.04 + 0.08);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.07, t0 + i * 0.04); g.gain.exponentialRampToValueAtTime(0.001, t0 + i * 0.04 + 0.12);
      o.connect(g); g.connect(master); o.start(t0 + i * 0.04); o.stop(t0 + i * 0.04 + 0.13);
    }
    const t1 = t0 + 0.22;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(240, t1); o.frequency.exponentialRampToValueAtTime(90, t1 + 0.1);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.12, t1); g.gain.exponentialRampToValueAtTime(0.001, t1 + 0.12);
    o.connect(g); g.connect(master); o.start(t1); o.stop(t1 + 0.13);
  }
  function sfxFirefly(t0) {
    for (let i = 0; i < 16; i++) {
      const t = t0 + 0.16 + i * 0.4 + Math.random() * 0.1;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 1200 + Math.random() * 700;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.045, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.18);
    }
  }
  function sfxBoop(t0) {
    const thud = ctx.createOscillator(); thud.type = 'sine';
    thud.frequency.setValueAtTime(140, t0); thud.frequency.exponentialRampToValueAtTime(64, t0 + 0.12);
    const tg = ctx.createGain(); tg.gain.setValueAtTime(0.28, t0); tg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
    thud.connect(tg); tg.connect(master); thud.start(t0); thud.stop(t0 + 0.18);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(880, t0 + 0.02); o.frequency.exponentialRampToValueAtTime(420, t0 + 0.14);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.12, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
    o.connect(g); g.connect(master); o.start(t0 + 0.02); o.stop(t0 + 0.18);
  }
  function sfxPuff(t0) {
    const rumble = noiseSrc(5.1);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140; lp.Q.value = 0.7;
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.0001, t0); rg.gain.linearRampToValueAtTime(0.18, t0 + 0.25);
    rg.gain.setValueAtTime(0.14, t0 + 4.2); rg.gain.exponentialRampToValueAtTime(0.001, t0 + 5.1);
    rumble.connect(lp); lp.connect(rg); rg.connect(master); rumble.start(t0);
    const whoosh = noiseSrc(5.1);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.8;
    const wg = ctx.createGain();
    wg.gain.setValueAtTime(0.0001, t0); wg.gain.linearRampToValueAtTime(0.12, t0 + 0.18);
    wg.gain.setValueAtTime(0.08, t0 + 4.3); wg.gain.exponentialRampToValueAtTime(0.001, t0 + 5.1);
    whoosh.connect(bp); bp.connect(wg); wg.connect(master); whoosh.start(t0);
  }
  return { unlock, playBed, stop, playYipee, playGong, playOof, playSelect, playTakeoff, playLobbyTick, playChaos, playCakeLand, setMuted, setMotion, hold };
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
