// The RTK plant survey's sounds (src/missions/rtk.js), synthesised like the rest of
// sfx.js and played through audio.cue(name, ...args): the pole stood in the ground,
// the fix coming in (a blip for FLOAT, a bright little run for FIX), a wobble, the
// mosquito's whine (short grains, panned across the phone as it flies) and its landing
// (the whine drops out: that silence is the moment to swat), the swat, a bite, the
// curious ibis's hoarse honks, the plant logged and the stars on the end card. Levels
// sit with the routine field sounds (peaks round -25 to -18 dBFS), the swat a little
// above them.

import { tone, noiseHit, grains, bell, between, midiHz } from './synth.js';

const W = { gain: 0, pan: 0, d: 0 };
const claim = (E, t, dur) => E.claim('effects', t, dur);
const fxOut = (E) => E.bus.effects;

// The pole's steel foot pushed into the ground and the phone's clamp clicked.
export function rtkPlant(E, t) {
  if (!claim(E, t, 0.4)) return false;
  const out = fxOut(E);
  noiseHit(E, out, t, { kind: 'brown', filter: 'lowpass', f: 560, f1: 220, a: 0.003, d: 0.14, peak: 0.36 });
  tone(E, out, t, { f: 120, f1: 62, a: 0.003, d: 0.12, peak: 0.2 });
  noiseHit(E, out, t + 0.13, { kind: 'white', filter: 'highpass', f: 2600, a: 0.001, d: 0.014, peak: 0.12 });
  tone(E, out, t + 0.13, { type: 'triangle', f: 1500, a: 0.001, d: 0.02, peak: 0.05 });
  return true;
}

// The fix improving: 1 FLOAT (two rising blips), 2 FIX (a bright little run).
export function rtkStage(E, t, stage = 1) {
  if (!claim(E, t, 0.9)) return false;
  const out = fxOut(E);
  if (stage >= 2) {
    [84, 88, 91, 96].forEach((m, k) => bell(E, out, t + k * 0.07, { f: midiHz(m), peak: 0.05 + k * 0.004, d: 0.6 + k * 0.1, partials: 3 }));
    tone(E, out, t + 0.28, { f: midiHz(103), a: 0.004, hold: 0.04, d: 0.2, peak: 0.02 });
  } else {
    tone(E, out, t, { f: midiHz(84), a: 0.003, hold: 0.04, d: 0.05, peak: 0.05 });
    tone(E, out, t + 0.11, { f: midiHz(88), a: 0.003, hold: 0.05, d: 0.07, peak: 0.05 });
  }
  return true;
}

// The pole wobbled (a step, or a missed swat): a soft falling bwomp and a rattle;
// a bite's flinch is a little bigger.
export function rtkWobble(E, t, big = 0) {
  if (!claim(E, t, 0.5)) return false;
  const out = fxOut(E);
  const k = big ? 1.25 : 1;
  tone(E, out, t, { type: 'triangle', f: 560, f1: 240, glide: 0.22, a: 0.005, d: 0.24, peak: 0.07 * k });
  grains(E, out, t, { n: 6, span: 0.2, len: 0.012, fmin: 900, fmax: 2600, q: 2, peak: 0.08 * k, jitter: 0.5 });
  return true;
}

// A grain of the mosquito's whine: two detuned saws through a narrow band with a fast
// flutter, panned to where it flies over the phone (pan -1..1). Played every quarter
// second while it buzzes, so the grains overlap into a whine.
export function mozzie(E, t, pan = 0, k = 1) {
  if (!claim(E, t, 0.34)) return false;
  const ctx = E.ctx;
  const out = E.spot(fxOut(E), 1, Math.max(-0.8, Math.min(0.8, pan * 0.8)));
  const f0 = between(610, 690);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 1150; bp.Q.value = 2.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.03 * k, t + 0.06);
  g.gain.setValueAtTime(0.03 * k, t + 0.22);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.33);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = between(24, 30);
  const depth = ctx.createGain();
  depth.gain.value = f0 * 0.035;
  lfo.connect(depth);
  for (const det of [-7, 9]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f0 * between(0.96, 1.05), t + 0.33);
    o.detune.value = det;
    depth.connect(o.frequency);
    o.connect(bp);
    o.start(t); o.stop(t + 0.35);
  }
  bp.connect(g).connect(out);
  lfo.start(t); lfo.stop(t + 0.35);
  E.made += 7;
  return true;
}

// It lands: the whine sinks away and a tiny tick.
export function mozzieLand(E, t) {
  if (!claim(E, t, 0.3)) return false;
  const out = fxOut(E);
  tone(E, out, t, { type: 'sawtooth', f: 640, f1: 260, glide: 0.1, a: 0.005, d: 0.11, peak: 0.018 });
  tone(E, out, t + 0.1, { type: 'triangle', f: 2400, a: 0.001, d: 0.012, peak: 0.03 });
  return true;
}

// SWAT: a slap, a thump and a comic rising "fwip" as it spins off.
export function swat(E, t) {
  if (!claim(E, t, 0.6)) return false;
  const out = fxOut(E);
  noiseHit(E, out, t, { kind: 'white', filter: 'highpass', f: 1600, a: 0.001, d: 0.05, peak: 0.36, at: 0.5171 });
  noiseHit(E, out, t, { kind: 'brown', filter: 'lowpass', f: 700, a: 0.002, d: 0.08, peak: 0.3 });
  tone(E, out, t, { f: 230, f1: 95, a: 0.002, d: 0.08, peak: 0.16 });
  tone(E, out, t + 0.09, { type: 'triangle', f: 700, f1: 1900, glide: 0.2, a: 0.01, d: 0.18, peak: 0.045 });
  bell(E, out, t + 0.16, { f: midiHz(96), peak: 0.03, d: 0.4, partials: 2 });
  bell(E, out, t + 0.22, { f: midiHz(100), peak: 0.025, d: 0.4, partials: 2 });
  return true;
}

// A bite: a startled little "ow!" and a falling wah.
export function bite(E, t) {
  if (!claim(E, t, 0.5)) return false;
  const out = fxOut(E);
  tone(E, out, t, { type: 'triangle', f: 1300, f1: 1800, glide: 0.04, a: 0.004, d: 0.06, peak: 0.06 });
  tone(E, out, t + 0.07, { type: 'triangle', f: 760, f1: 360, glide: 0.2, a: 0.01, d: 0.22, peak: 0.07 });
  return true;
}

// The ibis nearby: two hoarse honks as it arrives (kind 0), three quick higher ones
// and a flurry of wings when it is startled (kind 1).
export function ibis(E, t, x, z, kind = 0) {
  E.where(x, z, 25, W);
  if (W.gain <= 0.02 || !claim(E, t, 0.9)) return false;
  const out = E.spot(fxOut(E), Math.max(0.4, W.gain), W.pan);
  const n = kind ? 3 : 2, gap = kind ? 0.13 : 0.22, f = kind ? 340 : 270;
  for (let k = 0; k < n; k++) {
    const s = t + k * gap;
    tone(E, out, s, { type: 'sawtooth', f: f * between(0.95, 1.05), f1: f * 0.8, a: 0.01, hold: 0.04, d: 0.08, peak: 0.022 });
    noiseHit(E, out, s, { kind: 'pink', filter: 'bandpass', f: 800, q: 2.6, a: 0.01, hold: 0.04, d: 0.08, peak: 0.12 });
  }
  if (kind) grains(E, out, t + 0.05, { n: 9, span: 0.45, len: 0.04, fmin: 300, fmax: 900, q: 0.8, kind: 'pink', peak: 0.3, jitter: 0.4 });
  return true;
}

// The plant logged: a pencil scratch, then a happy rise when the name was right, or
// a gentle "oh!" when it was not (never a sad one).
export function plantLog(E, t, right = true) {
  if (!claim(E, t, 0.9)) return false;
  const out = fxOut(E);
  grains(E, out, t, { n: 10, span: 0.25, len: 0.022, fmin: 3000, fmax: 5500, q: 1.6, peak: 0.14, jitter: 0.5 });
  if (right) {
    bell(E, out, t + 0.12, { f: midiHz(84), peak: 0.045, d: 0.6, partials: 3 });
    bell(E, out, t + 0.2, { f: midiHz(91), peak: 0.05, d: 0.8, partials: 3 });
  } else {
    tone(E, out, t + 0.12, { type: 'triangle', f: midiHz(76), a: 0.01, hold: 0.05, d: 0.18, peak: 0.05 });
    tone(E, out, t + 0.28, { type: 'triangle', f: midiHz(81), a: 0.01, hold: 0.05, d: 0.25, peak: 0.05 });
  }
  return true;
}

// The end card's stars popping in, one bell each (n of 3 lit).
export function starPop(E, t, n = 3) {
  if (!claim(E, t, 1.2)) return false;
  const out = fxOut(E);
  const notes = [88, 91, 96];
  for (let k = 0; k < 3; k++) {
    const s = t + 0.15 + (k + 1) * 0.18;
    if (k < n) bell(E, out, s, { f: midiHz(notes[k]), peak: 0.055, d: 0.8, partials: 3 });
    else tone(E, out, s, { type: 'triangle', f: 330, a: 0.004, d: 0.08, peak: 0.03 });
  }
  return true;
}
