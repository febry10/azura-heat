// audio.js — a tiny WebAudio synth for AZURA HEAT: no audio files, everything is
// oscillators and filtered noise. Engine hum follows the player's speed, the
// siren follows the nearest police car, and short blips cover punches, cash and
// mission jingles. Browsers require a user gesture, so unlock() is called from
// the Start button; M toggles mute.
'use strict';

AH.audio = (function () {
  let ctx = null, master = null, muted = false;
  let engineOsc = null, engineFilter = null, engineGain = null;
  let sirenOsc = null, sirenGain = null, sirenFlip = 0, sirenTimer = 0;
  let noiseBuf = null;

  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);

    // Shared noise buffer for punches and impacts.
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Engine: a sawtooth through a lowpass, gain driven by speed in update().
    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 55;
    engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 320;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineOsc.connect(engineFilter).connect(engineGain).connect(master);
    engineOsc.start();

    // Siren: a square wave flipping between two tones in update().
    sirenOsc = ctx.createOscillator();
    sirenOsc.type = 'triangle';
    sirenOsc.frequency.value = 720;
    sirenGain = ctx.createGain();
    sirenGain.gain.value = 0;
    sirenOsc.connect(sirenGain).connect(master);
    sirenOsc.start();

    startPad();
  }

  // Warm ambient pad: two detuned triangles under a lowpass, very quiet.
  function startPad() {
    const g = ctx.createGain(); g.gain.value = 0.014;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
    [110, 164.81, 220].forEach(function (fr, i) {
      const o = ctx.createOscillator();
      o.type = 'triangle'; o.frequency.value = fr; o.detune.value = i * 4 - 4;
      o.connect(f); o.start();
    });
    f.connect(g).connect(master);
  }

  function tone(freq, dur, type, vol, when, slideTo) {
    if (!ctx) return;
    const t0 = ctx.currentTime + (when || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol || 0.12, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol, freq) {
    if (!ctx) return;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq || 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(f).connect(g).connect(master);
    src.start(); src.stop(ctx.currentTime + dur + 0.02);
  }

  return {
    unlock: unlock,
    toggleMute: function () {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    isMuted: function () { return muted; },
    // Called every frame: speedNorm 0..1 while driving, sirenLevel 0..1.
    update: function (dt, speedNorm, sirenLevel) {
      if (!ctx) return;
      const eg = speedNorm > 0.01 ? 0.05 + speedNorm * 0.05 : 0;
      engineGain.gain.setTargetAtTime(eg, ctx.currentTime, 0.08);
      engineOsc.frequency.setTargetAtTime(52 + speedNorm * 130, ctx.currentTime, 0.08);
      engineFilter.frequency.setTargetAtTime(300 + speedNorm * 1400, ctx.currentTime, 0.1);
      sirenTimer -= dt;
      if (sirenTimer <= 0) { sirenFlip = 1 - sirenFlip; sirenTimer = 0.34; }
      sirenOsc.frequency.setTargetAtTime(sirenFlip ? 950 : 700, ctx.currentTime, 0.03);
      sirenGain.gain.setTargetAtTime(sirenLevel * 0.045, ctx.currentTime, 0.1);
    },
    punch: function () { noise(0.09, 0.25, 700); },
    hit: function () { tone(85, 0.18, 'sine', 0.3); noise(0.12, 0.18, 500); },
    crash: function () { noise(0.3, 0.35, 1400); tone(60, 0.3, 'sine', 0.3); },
    cash: function () { tone(880, 0.09, 'sine', 0.14); tone(1318, 0.16, 'sine', 0.14, 0.08); },
    door: function () { tone(180, 0.07, 'square', 0.06); },
    hotwire: function () { tone(1200, 0.05, 'square', 0.05); tone(1200, 0.05, 'square', 0.05, 0.12); },
    jingle: function () {
      [523, 659, 784, 1046].forEach(function (f, i) { tone(f, 0.22, 'triangle', 0.14, i * 0.11); });
    },
    sting: function () {
      [392, 330, 262, 196].forEach(function (f, i) { tone(f, 0.3, 'sawtooth', 0.07, i * 0.16); });
    },
    blip: function () { tone(660, 0.06, 'sine', 0.08); },
  };
})();
