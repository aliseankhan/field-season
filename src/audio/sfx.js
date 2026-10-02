// The sound effects, all synthesised: each cue is cue(E, t, ...) and returns false
// when the effects bus is full (it is then simply skipped). Levels were set from
// offline renders of every cue and by loudness (K-weighted momentary):
// at the default volumes footsteps and UI clicks peak round -25 dBFS, the handling
// sounds round -16, and the snug's pop and a stamp round -7; the croc's SNAP is the
// loudest thing in a day (about -17 LUFS at 2 m, with a mid-range body a laptop
// speaker keeps); the limiter keeps everything under -3.

import { tone, noiseHit, grains, bell, between, rand, midiHz } from './synth.js';
// the field kit's missions keep their cues in files of their own
export * from './sfx_rtk.js';
// the opening's kit hunt and the field table
export * from './sfx_opening.js';

const W = { gain: 0, pan: 0, d: 0 }; // reused by the spatial cues

function claim(E, t, dur, bus = 'effects') { return E.claim(bus, t, dur); }
const fxOut = (E) => E.bus.effects;

// ---------------------------------------------------------------- the player

export const SURFACE = { grass: 0, path: 1, mud: 2, causeway: 3, litter: 4 };
export const SURFACE_NAMES = ['grass', 'path', 'mud', 'causeway', 'litter'];

// One footstep. k: 0.35 creeping to 1 running; foot 0 or 1 (a touch of pan).
export function step(E, t, surface, k, foot) {
  if (!claim(E, t, 0.2)) return false;
  const out = E.spot(fxOut(E), 1, foot ? 0.07 : -0.07);
  const v = k * between(0.85, 1.1); // no two steps quite alike
  const lift = (1 + (k - 0.6) * 0.25) * between(0.92, 1.08); // running is a little brighter
  switch (surface) {
    case 1: // the sandy dirt paths: a gritty crunch
      grains(E, out, t, { n: 7, span: 0.07, len: 0.012, fmin: 1800 * lift, fmax: 4600 * lift, q: 1.4, peak: 0.24 * v, shape: 0.6 });
      noiseHit(E, out, t, { kind: 'brown', filter: 'lowpass', f: 650, q: 0.7, a: 0.004, d: 0.07, peak: 0.42 * v });
      tone(E, out, t, { f: 115 * lift, f1: 70, a: 0.003, d: 0.05, peak: 0.1 * v });
      break;
    case 2: // mud at the waterline: a squelch
      noiseHit(E, out, t, { kind: 'brown', filter: 'bandpass', f: 950 * lift, f1: 260, q: 4, a: 0.02, d: 0.14, peak: 0.55 * v });
      tone(E, out, t + 0.035, { f: 250 * lift, f1: 140, a: 0.012, d: 0.08, peak: 0.06 * v });
      break;
    case 3: // the causeway's packed shell sand: crisp, with a firmer knock
      grains(E, out, t, { n: 9, span: 0.05, len: 0.009, fmin: 3000 * lift, fmax: 7200 * lift, q: 1.2, peak: 0.12 * v, shape: 0.4 });
      tone(E, out, t, { f: 150 * lift, f1: 85, a: 0.002, d: 0.05, peak: 0.16 * v });
      noiseHit(E, out, t, { kind: 'pink', filter: 'lowpass', f: 1300, a: 0.003, d: 0.05, peak: 0.1 * v });
      break;
    case 4: // leaf litter under the big trees: a crackle
      grains(E, out, t, { n: 10, span: 0.12, len: 0.014, fmin: 2400, fmax: 7400, q: 2.4, peak: 0.17 * v, jitter: 0.8 });
      tone(E, out, t, { f: 90, f1: 60, a: 0.004, d: 0.05, peak: 0.08 * v });
      break;
    default: // the lawn: a soft swish and a thud
      noiseHit(E, out, t, { kind: 'pink', filter: 'bandpass', f: between(850, 1250) * lift, f1: 480, q: 0.8, a: 0.012, d: 0.09, peak: 0.16 * v });
      tone(E, out, t, { f: 95, f1: 60, a: 0.004, d: 0.06, peak: 0.12 * v });
      grains(E, out, t + 0.006, { n: 4, span: 0.06, len: 0.02, fmin: 2600, fmax: 5200, q: 1.2, peak: 0.04 * v });
  }
  return true;
}

// ---------------------------------------------------------------- the loop pole

export function swish(E, t, up = true) {
  if (!claim(E, t, 0.35)) return false;
  const out = fxOut(E);
  if (up) {
    noiseHit(E, out, t, { kind: 'white', filter: 'bandpass', f: 500, f1: 2800, glide: 0.2, q: 1.5, a: 0.08, d: 0.16, peak: 0.2 });
    tone(E, out, t + 0.2, { f: 430, a: 0.002, d: 0.035, peak: 0.07 }); // the pole settles in both hands
    tone(E, out, t + 0.2, { f: 1020, a: 0.001, d: 0.02, peak: 0.025 });
  } else {
    noiseHit(E, out, t, { kind: 'white', filter: 'bandpass', f: 2200, f1: 600, glide: 0.18, q: 1.3, a: 0.05, d: 0.14, peak: 0.1 });
  }
  return true;
}

// The loop gliding over to a new lizard: a soft rising "fwee".
export function glide(E, t, pitch = 1) {
  if (!claim(E, t, 0.3)) return false;
  const out = fxOut(E);
  tone(E, out, t, { f: 640 * pitch, f1: 980 * pitch, glide: 0.18, lin: true, a: 0.04, d: 0.16, peak: 0.045 });
  noiseHit(E, out, t, { kind: 'pink', filter: 'bandpass', f: 1800, f1: 3400, q: 2, a: 0.05, d: 0.14, peak: 0.05 });
  return true;
}

// The loop settled over the head: a tiny tink.
export function settled(E, t) {
  if (!claim(E, t, 0.4)) return false;
  bell(E, fxOut(E), t, { f: 2093, peak: 0.035, d: 0.35, partials: 2 });
  return true;
}

// The snug ring closing in: p 0 at the start, 1 at the green band.
export function tick(E, t, p) {
  if (!claim(E, t, 0.05)) return false;
  const out = fxOut(E);
  tone(E, out, t, { type: 'triangle', f: 1100 + 900 * p, a: 0.001, d: 0.024, peak: 0.11 + 0.06 * p });
  return true;
}
export function inBand(E, t) {
  if (!claim(E, t, 0.4)) return false;
  bell(E, fxOut(E), t, { f: 1760, peak: 0.05, d: 0.35, partials: 2 });
  return true;
}

// The loop drawn snug: a bubbly pop, with sparkles for a perfect one.
export function pop(E, t, perfect = false) {
  if (!claim(E, t, 0.6)) return false;
  const out = fxOut(E);
  tone(E, out, t, { f: 320, f1: 900, glide: 0.05, a: 0.003, d: 0.11, peak: 0.42 });
  tone(E, out, t, { f: 640, f1: 1800, glide: 0.05, a: 0.002, d: 0.06, peak: 0.1 });
  noiseHit(E, out, t, { kind: 'white', filter: 'bandpass', f: 2200, q: 1.5, a: 0.001, d: 0.02, peak: 0.12 });
  if (perfect) sparkle(E, out, t + 0.06, 5, 0.05);
  return true;
}
function sparkle(E, out, t, n, peak) {
  const notes = [96, 98, 100, 103, 105, 108];
  for (let k = 0; k < n; k++) bell(E, out, t + k * 0.045 + rand() * 0.015, { f: midiHz(notes[Math.floor(rand() * notes.length)]), peak: peak * (1 - k * 0.1), d: 0.5, partials: 2 });
}

// A miss: a springy "boi-oi-oing".
export function boing(E, t, small = false) {
  if (!claim(E, t, 0.8)) return false;
  const ctx = E.ctx, out = fxOut(E);
  const base = small ? 260 : 170, dur = small ? 0.35 : 0.6;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(base * 0.85, t);
  osc.frequency.linearRampToValueAtTime(base * 1.9, t + 0.04);
  osc.frequency.exponentialRampToValueAtTime(base * 1.5, t + dur);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = small ? 16 : 12;
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(base * 0.5, t);
  depth.gain.exponentialRampToValueAtTime(1, t + dur);
  lfo.connect(depth).connect(osc.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(small ? 0.16 : 0.26, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(out);
  osc.start(t); lfo.start(t);
  osc.stop(t + dur + 0.02); lfo.stop(t + dur + 0.02);
  E.made += 4;
  tone(E, out, t, { f: 120, f1: 70, a: 0.003, d: 0.08, peak: small ? 0.08 : 0.16 });
  return true;
}

export function whiff(E, t) {
  if (!claim(E, t, 0.3)) return false;
  noiseHit(E, fxOut(E), t, { kind: 'white', filter: 'bandpass', f: 1300, f1: 380, q: 1, a: 0.03, d: 0.2, peak: 0.24 });
  return true;
}

// Loops and poles that give (src/catch/breaks.js): the floss straining, then going with a
// thin ping; the bamboo creaking, then cracking.
export function fray(E, t) {
  if (!claim(E, t, 0.5)) return false;
  const out = fxOut(E);
  grains(E, out, t, { n: 9, span: 0.45, len: 0.012, fmin: 2600, fmax: 4800, q: 4, peak: 0.12, jitter: 0.5 });
  tone(E, out, t, { type: 'triangle', f: 880, f1: 990, glide: 0.4, a: 0.05, d: 0.35, peak: 0.03 });
  return true;
}
export function flossSnap(E, t) {
  if (!claim(E, t, 0.5)) return false;
  const out = fxOut(E);
  // the crack of it going, a bright ping falling away, and the loose ends whipping off
  noiseHit(E, out, t, { kind: 'white', filter: 'highpass', f: 2600, a: 0.001, d: 0.035, peak: 0.32 });
  tone(E, out, t, { type: 'triangle', f: 2200, f1: 520, glide: 0.16, a: 0.001, d: 0.3, peak: 0.26 });
  tone(E, out, t + 0.01, { type: 'sine', f: 3300, f1: 1400, glide: 0.1, a: 0.001, d: 0.16, peak: 0.1 });
  noiseHit(E, out, t + 0.05, { kind: 'pink', filter: 'bandpass', f: 1800, f1: 4200, q: 1.4, a: 0.01, d: 0.14, peak: 0.16 });
  return true;
}
export function creak(E, t) {
  if (!claim(E, t, 0.7)) return false;
  const out = fxOut(E);
  noiseHit(E, out, t, { kind: 'pink', filter: 'bandpass', f: 900, f1: 600, q: 4, a: 0.08, hold: 0.25, d: 0.25, peak: 0.12 });
  tone(E, out, t, { type: 'sawtooth', f: 150, f1: 115, glide: 0.5, a: 0.06, hold: 0.2, d: 0.25, peak: 0.02 });
  return true;
}
export function crack(E, t) {
  if (!claim(E, t, 0.5)) return false;
  const out = fxOut(E);
  noiseHit(E, out, t, { kind: 'white', filter: 'bandpass', f: 2400, f1: 900, q: 0.9, a: 0.001, d: 0.08, peak: 0.45 });
  tone(E, out, t, { f: 420, f1: 160, a: 0.001, d: 0.09, peak: 0.25 });
  noiseHit(E, out, t + 0.05, { kind: 'brown', filter: 'lowpass', f: 600, a: 0.002, d: 0.12, peak: 0.25 });
  return true;
}

// ---------------------------------------------------------------- the catch cards

export function bagRustle(E, t) {
  if (!claim(E, t, 0.7)) return false;
  const out = fxOut(E);
  grains(E, out, t, { n: 18, span: 0.5, len: 0.02, fmin: 2500, fmax: 9000, q: 1.8, peak: 0.23, jitter: 0.7 });
  noiseHit(E, out, t, { kind: 'pink', filter: 'highpass', f: 3000, q: 0.5, a: 0.06, hold: 0.2, d: 0.2, peak: 0.05 });
  return true;
}

export function rulerClick(E, t, spotOn = false) {
  if (!claim(E, t, 0.5)) return false;
  const out = fxOut(E);
  tone(E, out, t, { type: 'triangle', f: 2600, a: 0.001, d: 0.02, peak: 0.2 });
  noiseHit(E, out, t, { kind: 'white', filter: 'highpass', f: 3000, a: 0.001, d: 0.012, peak: 0.16 });
  tone(E, out, t + 0.05, { type: 'triangle', f: 1900, a: 0.001, d: 0.022, peak: 0.13 });
  if (spotOn) bell(E, out, t + 0.12, { f: 1568, peak: 0.05, d: 0.5, partials: 2 });
  return true;
}

export function paintDab(E, t) {
  if (!claim(E, t, 0.3)) return false;
  const out = fxOut(E);
  tone(E, out, t, { f: 540, f1: 250, a: 0.004, d: 0.07, peak: 0.22 });
  noiseHit(E, out, t, { kind: 'brown', filter: 'lowpass', f: 900, a: 0.003, d: 0.05, peak: 0.25 });
  tone(E, out, t + 0.01, { f: 190, f1: 120, a: 0.004, d: 0.06, peak: 0.08 });
  return true;
}

// The GPS backpack clicked on, then two little beeps as it wakes.
export function packClick(E, t) {
  if (!claim(E, t, 0.5)) return false;
  const out = fxOut(E);
  noiseHit(E, out, t, { kind: 'white', filter: 'highpass', f: 2500, a: 0.001, d: 0.016, peak: 0.2 });
  tone(E, out, t, { f: 1400, a: 0.001, d: 0.03, peak: 0.09 });
  tone(E, out, t + 0.14, { f: 2637, a: 0.003, hold: 0.04, d: 0.025, peak: 0.028 });
  tone(E, out, t + 0.26, { f: 3520, a: 0.003, hold: 0.05, d: 0.035, peak: 0.024 });
  return true;
}

// A wriggle on the card: claws scrabbling.
export function wriggle(E, t) {
  if (!claim(E, t, 0.45)) return false;
  grains(E, fxOut(E), t, { n: 12, span: 0.4, len: 0.008, fmin: 3500, fmax: 8500, q: 1.6, peak: 0.22, jitter: 0.6 });
  return true;
}

// The perch noted: a pencil tick, or a thoughtful "hm" when it was elsewhere.
export function pencil(E, t, right = true) {
  if (!claim(E, t, 0.45)) return false;
  const out = fxOut(E);
  grains(E, out, t, { n: 12, span: 0.3, len: 0.025, fmin: 3000, fmax: 5500, q: 1.6, peak: 0.16, jitter: 0.5 });
  if (!right) tone(E, out, t + 0.05, { type: 'triangle', f: 330, f1: 294, a: 0.02, hold: 0.08, d: 0.12, peak: 0.03 });
  return true;
}

// Back to its perch: a happy two-note chirp and a scurry away.
export function releaseChirp(E, t) {
  if (!claim(E, t, 0.7)) return false;
  const out = fxOut(E);
  tone(E, out, t, { f: 1100, f1: 1700, glide: 0.07, a: 0.01, d: 0.09, peak: 0.1 });
  tone(E, out, t + 0.13, { f: 1300, f1: 2150, glide: 0.08, a: 0.01, d: 0.12, peak: 0.1 });
  grains(E, out, t + 0.22, { n: 11, span: 0.32, len: 0.006, fmin: 4000, fmax: 9000, q: 1.5, peak: 0.08, shape: 0.3, fade: true });
  return true;
}

// ---------------------------------------------------------------- field tools

// A grid flag in the ground: a soft fwump and the cloth shaking out.
export function flagFwump(E, t, perfect = false) {
  if (!claim(E, t, 0.6)) return false;
  const out = fxOut(E);
  noiseHit(E, out, t, { kind: 'brown', filter: 'lowpass', f: 650, f1: 200, q: 0.8, a: 0.003, d: 0.18, peak: 0.5 });
  tone(E, out, t, { f: 85, f1: 50, a: 0.003, d: 0.15, peak: 0.28 });
  grains(E, out, t + 0.07, { n: 5, span: 0.26, len: 0.045, fmin: 600, fmax: 1500, q: 0.8, kind: 'pink', peak: 0.2, fade: true });
  if (perfect) sparkle(E, out, t + 0.1, 3, 0.04);
  return true;
}

// A tap in a set-up mini-game (a flag pushed, a kit piece set down, a strap pulled).
export function tap(E, t, kind = 'wood') {
  if (!claim(E, t, 0.15)) return false;
  const out = fxOut(E);
  if (kind === 'wood') {
    tone(E, out, t, { f: 520, a: 0.001, d: 0.045, peak: 0.12 });
    noiseHit(E, out, t, { kind: 'brown', filter: 'lowpass', f: 700, a: 0.002, d: 0.05, peak: 0.2 });
  } else if (kind === 'ratchet') { // a strap's tooth: a narrow click from one fixed bit of noise
    noiseHit(E, out, t, { kind: 'white', filter: 'bandpass', f: 2500, q: 3.5, a: 0.001, d: 0.01, peak: 0.3, at: 0.4137 });
    tone(E, out, t, { f: 1175, a: 0.001, d: 0.012, peak: 0.05 });
  } else if (kind === 'button') {
    tone(E, out, t, { type: 'triangle', f: 1600, a: 0.001, d: 0.025, peak: 0.14 });
  } else {
    noiseHit(E, out, t, { kind: 'brown', filter: 'lowpass', f: 400, a: 0.002, d: 0.06, peak: 0.25 });
  }
  return true;
}

// A logger's beeps: soft sines (a routine sound, in the island's key).
export function loggerBeep(E, t, reading = false) {
  if (!claim(E, t, 0.5)) return false;
  const out = fxOut(E);
  tone(E, out, t, { f: 2093, a: 0.003, hold: 0.05, d: 0.03, peak: 0.026 });
  tone(E, out, t + 0.11, { f: 2093, a: 0.003, hold: 0.05, d: 0.03, peak: 0.026 });
  if (reading) tone(E, out, t + 0.22, { f: 2794, a: 0.003, hold: 0.09, d: 0.06, peak: 0.022 });
  return true;
}

// A logger tied on: the zip tie pulled through, then a beep.
export function zipTie(E, t) {
  if (!claim(E, t, 0.6)) return false;
  const out = fxOut(E);
  grains(E, out, t, { n: 14, span: 0.32, len: 0.006, fmin: 2500, fmax: 3600, q: 6, peak: 0.16, shape: -0.5 });
  tone(E, out, t + 0.42, { f: 2093, a: 0.003, hold: 0.045, d: 0.03, peak: 0.026 });
  return true;
}

// Data coming off a backpack: a run of little blips and a chime.
export function download(E, t) {
  if (!claim(E, t, 0.9)) return false;
  const out = fxOut(E);
  const notes = [84, 86, 88, 91, 93, 96];
  for (let k = 0; k < 6; k++) tone(E, out, t + k * 0.065, { f: midiHz(notes[Math.floor(rand() * 6)]), a: 0.003, hold: 0.022, d: 0.025, peak: 0.028 });
  bell(E, out, t + 0.44, { f: midiHz(96), peak: 0.034, d: 0.6, partials: 3 });
  return true;
}

// The tape measure run out and snapped back.
export function tape(E, t) {
  if (!claim(E, t, 0.6)) return false;
  const out = fxOut(E);
  grains(E, out, t, { n: 24, span: 0.34, len: 0.005, fmin: 3000, fmax: 4200, q: 5, peak: 0.09, shape: 0.3 });
  tone(E, out, t + 0.38, { f: 900, a: 0.001, d: 0.025, peak: 0.1 });
  noiseHit(E, out, t + 0.38, { kind: 'white', filter: 'highpass', f: 2500, a: 0.001, d: 0.015, peak: 0.1 });
  return true;
}

// The floss loop pulled tight on the pole: a small twang.
export function twang(E, t) {
  if (!claim(E, t, 0.5)) return false;
  const out = fxOut(E);
  tone(E, out, t, { type: 'triangle', f: 640, f1: 740, glide: 0.05, a: 0.002, d: 0.35, peak: 0.1 });
  tone(E, out, t, { f: 1480, a: 0.002, d: 0.15, peak: 0.03 });
  return true;
}

// Something set down on the station's table: a wooden thunk.
export function thunk(E, t) {
  if (!claim(E, t, 0.3)) return false;
  const out = fxOut(E);
  tone(E, out, t, { f: 190, f1: 150, a: 0.002, d: 0.12, peak: 0.25 });
  noiseHit(E, out, t, { kind: 'brown', filter: 'lowpass', f: 420, a: 0.002, d: 0.1, peak: 0.3 });
  tone(E, out, t, { f: 760, a: 0.001, d: 0.03, peak: 0.05 });
  return true;
}

// Taking a tool out or putting it away.
export function toolClack(E, t, id) {
  if (!claim(E, t, 0.3)) return false;
  const out = fxOut(E);
  if (id === 'loop_pole') { // bamboo knocks
    tone(E, out, t, { f: 520, a: 0.001, d: 0.05, peak: 0.12 });
    tone(E, out, t, { f: 1180, a: 0.001, d: 0.03, peak: 0.04 });
    tone(E, out, t + 0.07, { f: 610, a: 0.001, d: 0.04, peak: 0.07 });
  } else if (id === 'flags') {
    grains(E, out, t, { n: 3, span: 0.12, len: 0.05, fmin: 500, fmax: 1200, q: 0.8, kind: 'pink', peak: 0.5 });
  } else if (id === 'loggers' || id === 'backpacks') { // plastic case latches
    noiseHit(E, out, t, { kind: 'white', filter: 'highpass', f: 2200, a: 0.001, d: 0.014, peak: 0.19 });
    tone(E, out, t, { f: 1700, a: 0.001, d: 0.022, peak: 0.08 });
    noiseHit(E, out, t + 0.06, { kind: 'white', filter: 'highpass', f: 1800, a: 0.001, d: 0.014, peak: 0.14 });
  } else if (id === 'tape') {
    tone(E, out, t, { f: 900, a: 0.001, d: 0.025, peak: 0.11 });
    noiseHit(E, out, t, { kind: 'white', filter: 'highpass', f: 2500, a: 0.001, d: 0.012, peak: 0.11 });
  } else { // empty hands: a pat on the pocket
    noiseHit(E, out, t, { kind: 'brown', filter: 'lowpass', f: 320, a: 0.002, d: 0.06, peak: 0.25 });
  }
  return true;
}

// ---------------------------------------------------------------- the UI

export function uiClick(E, t) {
  if (!claim(E, t, 0.06)) return false;
  const out = fxOut(E);
  tone(E, out, t, { f: 1000, f1: 780, a: 0.001, d: 0.035, peak: 0.09 });
  tone(E, out, t, { type: 'triangle', f: 2000, a: 0.001, d: 0.012, peak: 0.025 });
  return true;
}
export function uiHover(E, t) {
  if (!claim(E, t, 0.04)) return false;
  tone(E, fxOut(E), t, { f: 1480, a: 0.001, d: 0.022, peak: 0.035 });
  return true;
}

// Toast chimes by tone: good, gold (a sparkly run), warn (a gentle fall), info.
export function chime(E, t, kind = 'good') {
  if (!claim(E, t, 0.8)) return false;
  const out = fxOut(E);
  if (kind === 'gold') {
    bell(E, out, t, { f: midiHz(88), peak: 0.05, d: 0.7, partials: 3 });
    bell(E, out, t + 0.07, { f: midiHz(91), peak: 0.05, d: 0.7, partials: 3 });
    bell(E, out, t + 0.14, { f: midiHz(96), peak: 0.055, d: 0.9, partials: 3 });
  } else if (kind === 'warn') {
    tone(E, out, t, { type: 'triangle', f: midiHz(76), a: 0.005, d: 0.25, peak: 0.07 });
    tone(E, out, t + 0.12, { type: 'triangle', f: midiHz(72), a: 0.005, d: 0.35, peak: 0.07 });
  } else if (kind === 'info') {
    bell(E, out, t, { f: midiHz(84), peak: 0.04, d: 0.6, partials: 2 });
  } else {
    bell(E, out, t, { f: midiHz(88), peak: 0.045, d: 0.6, partials: 3 });
    bell(E, out, t + 0.08, { f: midiHz(93), peak: 0.045, d: 0.8, partials: 3 });
  }
  return true;
}

// An ink stamp slammed down; soft for the second and later stamps of a burst.
export function stampThunk(E, t, soft = false) {
  if (!claim(E, t, 0.3)) return false;
  const out = fxOut(E);
  const k = soft ? 0.45 : 1;
  tone(E, out, t, { f: 140, f1: 55, a: 0.002, d: 0.16, peak: 0.42 * k });
  noiseHit(E, out, t, { kind: 'brown', filter: 'lowpass', f: 500, a: 0.002, d: 0.08, peak: 0.35 * k });
  if (!soft) noiseHit(E, out, t, { kind: 'white', filter: 'highpass', f: 2500, a: 0.001, d: 0.02, peak: 0.12 });
  return true;
}

export function pageTurn(E, t) {
  if (!claim(E, t, 0.3)) return false;
  const out = fxOut(E);
  noiseHit(E, out, t, { kind: 'pink', filter: 'bandpass', f: 1700, f1: 3800, q: 0.9, a: 0.05, d: 0.13, peak: 0.2 });
  grains(E, out, t + 0.02, { n: 4, span: 0.12, len: 0.02, fmin: 3000, fmax: 6000, q: 1.2, peak: 0.05 });
  tone(E, out, t + 0.15, { f: 110, a: 0.003, d: 0.05, peak: 0.05 });
  return true;
}
export function bookOpen(E, t, open = true) {
  if (!claim(E, t, 0.5)) return false;
  const out = fxOut(E);
  tone(E, out, t, { f: open ? 120 : 100, f1: 70, a: 0.003, d: 0.1, peak: 0.18 });
  noiseHit(E, out, t, { kind: 'brown', filter: 'lowpass', f: 500, a: 0.003, d: 0.08, peak: 0.2 });
  if (open) {
    noiseHit(E, out, t + 0.06, { kind: 'pink', filter: 'bandpass', f: 1500, f1: 3500, q: 0.9, a: 0.04, d: 0.1, peak: 0.12 });
    noiseHit(E, out, t + 0.13, { kind: 'pink', filter: 'bandpass', f: 1900, f1: 4200, q: 0.9, a: 0.03, d: 0.09, peak: 0.08 });
  }
  return true;
}
export function mapRustle(E, t) {
  if (!claim(E, t, 0.5)) return false;
  grains(E, fxOut(E), t, { n: 12, span: 0.38, len: 0.03, fmin: 1500, fmax: 5000, q: 1, kind: 'pink', peak: 0.32, jitter: 0.6 });
  return true;
}

// The pause card, the tool ring: soft up and down blooms.
export function bloop(E, t, up = true, soft = 1) {
  if (!claim(E, t, 0.25)) return false;
  const out = fxOut(E);
  tone(E, out, t, { f: up ? 440 : 660, f1: up ? 700 : 420, glide: 0.1, a: 0.01, d: 0.14, peak: 0.08 * soft });
  noiseHit(E, out, t, { kind: 'pink', filter: 'bandpass', f: up ? 900 : 2200, f1: up ? 2400 : 800, q: 1.2, a: 0.03, d: 0.1, peak: 0.05 * soft });
  return true;
}

// James's radio: a squelch as it opens, a shorter one as it closes.
export function radio(E, t, open = true) {
  if (!claim(E, t, 0.2)) return false;
  const out = fxOut(E);
  noiseHit(E, out, t, { kind: 'white', filter: 'bandpass', f: 2500, q: 0.7, a: 0.002, d: open ? 0.09 : 0.05, peak: 0.14 });
  if (open) tone(E, out, t + 0.01, { type: 'triangle', f: 1250, a: 0.002, d: 0.035, peak: 0.04 });
  return true;
}

// ---------------------------------------------------------------- the wild

// The crocodile's warning hiss, from where it lies.
export function hiss(E, t, x, z) {
  E.where(x, z, 40, W);
  if (W.gain <= 0 || !claim(E, t, 1.5)) return false;
  const out = E.spot(fxOut(E), Math.max(0.35, W.gain), W.pan);
  noiseHit(E, out, t, { kind: 'white', filter: 'bandpass', f: 4200, f1: 3200, q: 0.6, a: 0.22, hold: 0.45, d: 0.5, peak: 0.25 });
  noiseHit(E, out, t, { kind: 'pink', filter: 'lowpass', f: 480, q: 0.7, a: 0.2, hold: 0.35, d: 0.4, peak: 0.14 });
  return true;
}

// SNAP: the jaws clack shut and knock again as they settle, a woody knock and the
// body's heavy thrash through the middle (what a laptop speaker keeps), a short
// thump, then the splash. The loudest moment of a day: about -17 LUFS momentary at
// 2 m (-24 above 180 Hz), with the hiss a few dB under it.
export function snap(E, t, x, z) {
  E.where(x, z, 40, W);
  if (!claim(E, t, 1.2)) return false;
  const out = E.spot(fxOut(E), Math.max(0.7, W.gain), W.pan * 0.5); // it is on top of you
  noiseHit(E, out, t, { kind: 'white', filter: 'highpass', f: 1400, a: 0.001, d: 0.09, peak: 0.5, at: 0.3113 });
  tone(E, out, t, { f: 1150, f1: 480, a: 0.001, d: 0.11, peak: 0.42 });
  noiseHit(E, out, t, { kind: 'pink', filter: 'bandpass', f: 900, f1: 300, q: 1.1, a: 0.002, d: 0.17, peak: 0.9, at: 1.7021 });
  tone(E, out, t, { type: 'triangle', f: 520, f1: 300, a: 0.002, d: 0.15, peak: 0.3 });
  tone(E, out, t + 0.075, { f: 900, f1: 420, a: 0.001, d: 0.07, peak: 0.26 });
  noiseHit(E, out, t + 0.075, { kind: 'white', filter: 'bandpass', f: 2200, q: 0.9, a: 0.001, d: 0.05, peak: 0.3, at: 0.9007 });
  noiseHit(E, out, t + 0.04, { kind: 'white', filter: 'bandpass', f: 800, f1: 420, q: 1, a: 0.015, hold: 0.16, d: 0.32, peak: 0.8, at: 1.2203 });
  tone(E, out, t + 0.02, { type: 'triangle', f: 330, f1: 220, a: 0.01, hold: 0.1, d: 0.25, peak: 0.3 });
  tone(E, out, t, { f: 110, f1: 60, a: 0.003, d: 0.16, peak: 0.3 });
  splash(E, t + 0.12, x, z, 1);
  return true;
}

// A splash: size 0.3 (a croc sliding in far off) to 1 (a lunge). A heavy animal: a
// deep whump as the body meets the water, a low rushing wash (its brightest part kept
// under about 2.4 kHz), the water slapping back a moment later and big, slow drops.
export function splash(E, t, x, z, size = 1) {
  E.where(x, z, 50, W);
  if (W.gain <= 0.01 || !claim(E, t, 1.6)) return false;
  const out = E.spot(fxOut(E), W.gain, W.pan);
  tone(E, out, t, { f: 82, f1: 38, a: 0.006, d: 0.32 + 0.12 * size, peak: 0.3 * size });
  noiseHit(E, out, t, { kind: 'brown', filter: 'lowpass', f: 420, f1: 160, a: 0.015, hold: 0.06 * size, d: 0.55 + 0.35 * size, peak: 0.42 * size });
  noiseHit(E, out, t, { kind: 'white', filter: 'lowpass', f: 2400 * (0.65 + 0.35 * size), f1: 260, q: 0.7, a: 0.012, d: 0.6 + 0.45 * size, peak: 0.26 * size });
  noiseHit(E, out, t + 0.22 + 0.06 * size, { kind: 'pink', filter: 'bandpass', f: 520, f1: 240, q: 0.9, a: 0.02, d: 0.35 + 0.2 * size, peak: 0.16 * size });
  const drops = 4 + Math.round(5 * size);
  for (let k = 0; k < drops; k++) {
    const f = between(380, 950);
    tone(E, out, t + 0.14 + rand() * 1.0 * size, { f, f1: f * 1.6, glide: 0.05, a: 0.003, d: 0.07, peak: 0.05 * size });
  }
  return true;
}

// A lizard's tiny scurry as it flees, heard within a dozen metres.
export function scurry(E, t, x, z) {
  E.where(x, z, 14, W);
  if (W.gain <= 0.02 || !claim(E, t, 0.45)) return false;
  const out = E.spot(fxOut(E), W.gain, W.pan);
  grains(E, out, t, { n: 12, span: 0.35, len: 0.008, fmin: 3500, fmax: 8500, q: 1.2, peak: 0.36, shape: 0.3, fade: true });
  return true;
}

// Pushing past a bush or through a fern (fx.js puffs its leaves out): a leafy swish.
export function brush(E, t, x, z, k = 1) {
  E.where(x, z, 10, W);
  if (W.gain <= 0.02 || !claim(E, t, 0.4)) return false;
  const out = E.spot(fxOut(E), W.gain, W.pan);
  noiseHit(E, out, t, { kind: 'pink', filter: 'bandpass', f: between(1500, 2100), f1: 800, q: 0.9, a: 0.035, d: 0.2, peak: 0.17 * k });
  grains(E, out, t + 0.02, { n: 7, span: 0.24, len: 0.024, fmin: 1800, fmax: 5000, q: 1, kind: 'pink', peak: 0.4 * k, jitter: 0.6 });
  return true;
}

// A step in the shallows at the water's edge (fx.js throws the drops): a little plash.
export function paddle(E, t, x, z, k = 1) {
  E.where(x, z, 10, W);
  if (W.gain <= 0.02 || !claim(E, t, 0.35)) return false;
  const out = E.spot(fxOut(E), W.gain, W.pan);
  noiseHit(E, out, t, { kind: 'white', filter: 'lowpass', f: 2600, f1: 420, q: 0.8, a: 0.006, d: 0.16, peak: 0.13 * k });
  noiseHit(E, out, t, { kind: 'brown', filter: 'lowpass', f: 500, a: 0.008, d: 0.12, peak: 0.15 * k });
  for (let i = 0; i < 2; i++) {
    const f = between(900, 1500);
    tone(E, out, t + 0.05 + rand() * 0.18, { f, f1: f * 1.7, glide: 0.035, a: 0.002, d: 0.04, peak: 0.035 * k });
  }
  return true;
}

// A basilisk running across the water: a quick patter of four little slaps, each a wet
// tick on top and a soft plop under it (one burst every 0.16 s while it runs).
export function patter(E, t, x, z) {
  E.where(x, z, 18, W);
  if (W.gain <= 0.02 || !claim(E, t, 0.18)) return false;
  const out = E.spot(fxOut(E), W.gain, W.pan);
  for (let i = 0; i < 4; i++) {
    const at = t + i * 0.04 + rand() * 0.008, v = between(0.8, 1.1);
    noiseHit(E, out, at, { kind: 'white', filter: 'bandpass', f: between(2000, 3400), q: 1.6, a: 0.001, d: 0.025, peak: 0.11 * v });
    noiseHit(E, out, at, { kind: 'brown', filter: 'lowpass', f: 700, a: 0.002, d: 0.045, peak: 0.09 * v });
  }
  return true;
}

// Leaves shaken where a lizard slipped out of sight.
export function leafRustle(E, t, x, z) {
  E.where(x, z, 12, W);
  if (W.gain <= 0.02 || !claim(E, t, 0.4)) return false;
  const out = E.spot(fxOut(E), W.gain, W.pan);
  grains(E, out, t, { n: 10, span: 0.3, len: 0.03, fmin: 1500, fmax: 4500, q: 1, kind: 'pink', peak: 0.42, jitter: 0.6 });
  return true;
}

// A lizard has noticed you (the one the loop is on, or the nearest in front): a
// tiny questioning squeak, the cue to stand still.
export function notice(E, t, x, z) {
  E.where(x, z, 11, W);
  if (W.gain <= 0.005 || !claim(E, t, 0.25)) return false;
  const out = E.spot(fxOut(E), Math.max(0.55, W.gain), W.pan);
  tone(E, out, t, { f: 1500, f1: 2300, glide: 0.07, a: 0.008, hold: 0.015, d: 0.08, peak: 0.14 });
  return true;
}

// How far a display is heard (index.js checks it before it throttles or logs one).
export const DISPLAY_RANGE = 10;

// A display nearby: a soft "bwip" for a dewlap, two tonal pips for a head bob (down)
// or a push-up (up). The lizard the loop is on is heard clearly: its display is the
// moment to click.
export function display(E, t, kind, x, z, target = false) {
  E.where(x, z, DISPLAY_RANGE, W);
  if ((!target && W.gain <= 0.05) || !claim(E, t, 0.3)) return false;
  const out = E.spot(fxOut(E), target ? Math.max(0.8, W.gain) : W.gain, W.pan);
  if (kind === 'dewlap') tone(E, out, t, { f: 420, f1: 780, glide: 0.1, a: 0.02, hold: target ? 0.03 : 0, d: 0.1, peak: target ? 0.15 : 0.08 });
  else {
    const p = target ? 0.12 : 0.05;
    const up = kind === 'pushup';
    tone(E, out, t, { f: up ? 1047 : 1397, a: 0.004, hold: 0.018, d: 0.03, peak: p });
    tone(E, out, t + 0.12, { f: up ? 1397 : 1175, a: 0.004, hold: 0.018, d: 0.03, peak: p * 0.85 });
  }
  return true;
}

// ---------------------------------------------------------------- the drone survey
// src/missions/drone.js plays these through audio.cue(name, ...). They are heard
// where the chase camera is (beside the drone), so none is placed in the world.

// The props' hum, a loop for the whole flight: four rotors a hair apart (so they beat
// softly), a sub hum and a breath of air that rises with speed. Returns a handle:
//   set(spin, speed, climb)  spin 0 (still) .. 1 (flying), speed 0..1, climb -1..1
//   stop()                   spins down over about half a second, then stops
// A soft loop (about -40 dBFS RMS at cruise, -37 at its loudest 100 ms flat out), well
// under the rings' chimes, so a two-minute flight never tires the ear.
export function droneHum(E, t) {
  const ctx = E.ctx;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, t);
  master.connect(E.bus.effects);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 0.8;
  const buzz = ctx.createGain();
  buzz.gain.value = 0.0045;
  lp.connect(buzz).connect(master);
  const rotors = [1, 1.013, 0.991, 1.022].map((k) => {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(90 * k, t);
    o.connect(lp);
    o.start(t);
    return { o, k };
  });
  const sub = ctx.createOscillator();
  sub.type = 'triangle';
  sub.frequency.setValueAtTime(45, t);
  const subG = ctx.createGain();
  subG.gain.value = 0.008;
  sub.connect(subG).connect(master);
  sub.start(t);
  const air = ctx.createBufferSource();
  air.buffer = E.noise.pink; air.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 0.7;
  const airG = ctx.createGain();
  airG.gain.value = 0.0001;
  air.connect(bp).connect(airG).connect(master);
  air.start(t, rand() * 2);
  E.made += 12;
  let stopped = false;
  const ramp = (p, v, now, k = 0.08) => { p.cancelScheduledValues(now); p.setTargetAtTime(v, now, k); };
  return {
    set(spin, speed, climb) {
      if (stopped) return;
      const now = ctx.currentTime;
      const s = Math.max(0, Math.min(1, spin)), v = Math.max(0, Math.min(1, speed)), c = Math.max(-1, Math.min(1, climb));
      const f = 60 + s * (120 + 70 * v + 45 * c);
      for (const r of rotors) ramp(r.o.frequency, Math.max(20, f * r.k), now);
      ramp(sub.frequency, Math.max(20, f * 0.5), now);
      ramp(lp.frequency, 380 + s * (650 + 900 * v + 300 * Math.max(0, c)), now);
      ramp(airG.gain, 0.0001 + s * (0.003 + 0.016 * v * v + 0.004 * Math.abs(c)), now);
      ramp(bp.frequency, 900 + 1500 * v, now);
      ramp(master.gain, 0.0001 + s * (0.8 + 0.25 * v), now, 0.12);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      const now = ctx.currentTime;
      for (const r of rotors) { ramp(r.o.frequency, 30 * r.k, now, 0.25); r.o.stop(now + 1.2); }
      ramp(sub.frequency, 20, now, 0.25);
      ramp(master.gain, 0.0001, now, 0.18);
      sub.stop(now + 1.2);
      air.stop(now + 1.2);
    },
  };
}

// The props spinning up on the pad (a rising whirr and three ready pips), or winding
// down after a landing.
export function droneSpin(E, t, up = true) {
  if (!claim(E, t, 1.2)) return false;
  const out = fxOut(E);
  if (up) {
    tone(E, out, t, { type: 'sawtooth', f: 40, f1: 190, glide: 0.8, a: 0.2, hold: 0.4, d: 0.25, peak: 0.035 });
    noiseHit(E, out, t, { kind: 'pink', filter: 'bandpass', f: 500, f1: 1800, glide: 0.8, q: 0.9, a: 0.4, hold: 0.2, d: 0.3, peak: 0.06 });
    for (let k = 0; k < 3; k++) tone(E, out, t + 0.25 + k * 0.13, { type: 'triangle', f: midiHz(84 + k * 4), a: 0.003, d: 0.06, peak: 0.05 });
  } else {
    tone(E, out, t, { type: 'sawtooth', f: 180, f1: 35, glide: 0.9, a: 0.01, d: 0.9, peak: 0.03 });
    noiseHit(E, out, t, { kind: 'pink', filter: 'bandpass', f: 1500, f1: 300, q: 0.8, a: 0.01, d: 0.8, peak: 0.04 });
  }
  return true;
}

// Through a ring: a two-note bell that climbs the scale ring by ring (n 1..10), with
// a sparkle on the last one.
const RING_NOTES = [76, 79, 81, 83, 86, 88, 91, 93, 95, 98];
export function droneRing(E, t, n = 1, last = false) {
  if (!claim(E, t, 1.0)) return false;
  const out = fxOut(E);
  const m = RING_NOTES[Math.max(0, Math.min(RING_NOTES.length - 1, n - 1))];
  bell(E, out, t, { f: midiHz(m), peak: 0.07, d: 0.8, partials: 3 });
  bell(E, out, t + 0.07, { f: midiHz(m + 7), peak: 0.06, d: 1.0, partials: 3 });
  noiseHit(E, out, t, { kind: 'white', filter: 'highpass', f: 5000, a: 0.02, d: 0.25, peak: 0.03 });
  if (last) sparkle(E, out, t + 0.16, 6, 0.05);
  return true;
}

// A bump: into leaves (a thump and a rustle), the osprey (a thump and a ruffle of
// feathers) or the ground (a plastic clunk); each with the drone's wobbly "wheee-oo".
export function droneBump(E, t, kind = 'leaves') {
  if (!claim(E, t, 0.7)) return false;
  const out = fxOut(E);
  tone(E, out, t, { f: 210, f1: 90, a: 0.002, d: 0.12, peak: 0.14 });
  noiseHit(E, out, t, { kind: 'brown', filter: 'lowpass', f: 700, a: 0.002, d: 0.1, peak: 0.18 });
  if (kind === 'leaves') grains(E, out, t + 0.01, { n: 12, span: 0.35, len: 0.03, fmin: 1500, fmax: 5000, q: 1, kind: 'pink', peak: 0.4, jitter: 0.6 });
  else if (kind === 'bird') grains(E, out, t + 0.02, { n: 8, span: 0.22, len: 0.04, fmin: 900, fmax: 2600, q: 0.8, kind: 'pink', peak: 0.35, jitter: 0.5 });
  else noiseHit(E, out, t, { kind: 'white', filter: 'highpass', f: 2500, a: 0.001, d: 0.03, peak: 0.08 });
  // the wobble: a little siren that sags
  const ctx = E.ctx;
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(820, t + 0.05);
  o.frequency.exponentialRampToValueAtTime(420, t + 0.5);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 9;
  const dep = ctx.createGain();
  dep.gain.value = 45;
  lfo.connect(dep).connect(o.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.05, t + 0.08);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  o.connect(g).connect(out);
  o.start(t + 0.05); lfo.start(t + 0.05);
  o.stop(t + 0.6); lfo.stop(t + 0.6);
  E.made += 4;
  return true;
}

// Touch down on the pad: soft is two light taps of the skids and a happy "bip-bip";
// a hard landing clatters.
export function droneLand(E, t, soft = true) {
  if (!claim(E, t, 0.8)) return false;
  const out = fxOut(E);
  if (soft) {
    tone(E, out, t, { f: 300, f1: 180, a: 0.002, d: 0.06, peak: 0.12 });
    tone(E, out, t + 0.07, { f: 280, f1: 170, a: 0.002, d: 0.05, peak: 0.08 });
    tone(E, out, t + 0.22, { type: 'triangle', f: midiHz(84), a: 0.004, d: 0.08, peak: 0.07 });
    tone(E, out, t + 0.34, { type: 'triangle', f: midiHz(91), a: 0.004, d: 0.14, peak: 0.07 });
  } else {
    tone(E, out, t, { f: 240, f1: 80, a: 0.002, d: 0.14, peak: 0.2 });
    noiseHit(E, out, t, { kind: 'white', filter: 'bandpass', f: 1800, q: 0.8, a: 0.001, d: 0.08, peak: 0.15 });
    grains(E, out, t + 0.05, { n: 5, span: 0.25, len: 0.02, fmin: 1500, fmax: 3500, q: 2, peak: 0.25, shape: 0.5 });
    tone(E, out, t + 0.3, { type: 'triangle', f: midiHz(79), f1: midiHz(74), glide: 0.12, a: 0.004, d: 0.18, peak: 0.06 });
  }
  return true;
}

// Into the lake: a big splash, drips and a sad falling "bwoo-oo".
export function droneSplash(E, t) {
  if (!claim(E, t, 1.6)) return false;
  const out = fxOut(E);
  noiseHit(E, out, t, { kind: 'white', filter: 'lowpass', f: 4200, f1: 300, q: 0.8, a: 0.008, d: 0.8, peak: 0.3 });
  noiseHit(E, out, t, { kind: 'brown', filter: 'lowpass', f: 480, a: 0.01, d: 0.55, peak: 0.32 });
  for (let k = 0; k < 7; k++) {
    const f = between(700, 1700);
    tone(E, out, t + 0.12 + rand() * 0.9, { f, f1: f * 1.8, glide: 0.04, a: 0.002, d: 0.05, peak: 0.05 });
  }
  tone(E, out, t + 0.45, { type: 'triangle', f: midiHz(67), f1: midiHz(55), glide: 0.9, a: 0.02, hold: 0.2, d: 0.7, peak: 0.07 });
  return true;
}

// The controller's beeps: 'low' battery (two falling), 'home' (coming home, three
// level), 'ready' (two rising), 'edge' (out of range, one low buzz).
export function droneBeep(E, t, kind = 'ready') {
  if (!claim(E, t, 0.6)) return false;
  const out = fxOut(E);
  const pip = (dt, m, d = 0.07, p = 0.055) => tone(E, out, t + dt, { type: 'square', f: midiHz(m), a: 0.003, hold: d * 0.5, d: d * 0.5, peak: p * 0.5 });
  if (kind === 'low') { pip(0, 86); pip(0.16, 81); }
  else if (kind === 'home') { pip(0, 84); pip(0.14, 84); pip(0.28, 84, 0.12); }
  else if (kind === 'edge') tone(E, out, t, { type: 'square', f: 180, a: 0.005, hold: 0.12, d: 0.08, peak: 0.03 });
  else { pip(0, 84); pip(0.12, 91); }
  return true;
}

// The camera's shutter for the aerial photo: a click-clack and a tiny wind-on.
export function shutter(E, t) {
  if (!claim(E, t, 0.6)) return false;
  const out = fxOut(E);
  noiseHit(E, out, t, { kind: 'white', filter: 'highpass', f: 3000, a: 0.001, d: 0.02, peak: 0.22, at: 0.51 });
  tone(E, out, t, { f: 1600, a: 0.001, d: 0.02, peak: 0.08 });
  noiseHit(E, out, t + 0.07, { kind: 'white', filter: 'bandpass', f: 2200, q: 1.2, a: 0.001, d: 0.03, peak: 0.18, at: 0.93 });
  grains(E, out, t + 0.16, { n: 9, span: 0.28, len: 0.01, fmin: 2500, fmax: 4000, q: 3, peak: 0.1, jitter: 0.2 });
  return true;
}

// The lane photos: one soft camera tick every 12 m along a lane, about -23.5 dBFS at its
// peak (the shutter above is -11, the controller's beeps -26.5, a footstep -25), so 35 of
// them never nag but still tick over the drone's hum.
export function droneSnap(E, t) {
  if (!claim(E, t, 0.2)) return false;
  const out = fxOut(E);
  noiseHit(E, out, t, { kind: 'white', filter: 'highpass', f: 4200, a: 0.001, d: 0.012, peak: 0.085 });
  tone(E, out, t, { f: 2300, a: 0.001, d: 0.014, peak: 0.031 });
  noiseHit(E, out, t + 0.05, { kind: 'white', filter: 'bandpass', f: 2800, q: 1.4, a: 0.001, d: 0.016, peak: 0.063 });
  return true;
}

// The osprey telling the drone off: three quick whistled "kyew" notes.
export function osprey(E, t) {
  if (!claim(E, t, 0.9)) return false;
  const out = fxOut(E);
  for (let k = 0; k < 3; k++) {
    const t0 = t + k * 0.17 + rand() * 0.02;
    tone(E, out, t0, { f: 2500, f1: 3300, glide: 0.05, a: 0.006, d: 0.05, peak: 0.05 });
    tone(E, out, t0 + 0.05, { f: 3300, f1: 2200, glide: 0.06, a: 0.003, d: 0.07, peak: 0.045 });
  }
  return true;
}

// ---------------------------------------------------------------- the laser scanner (src/missions/tls.js)

// The head's motor while it turns: one segment of a soft whirr, a sawtooth hum through
// a lowpass with a flutter and a thin whine from the spinning mirror, placed at the
// scanner. tls.js plays one every 0.85 s, each a little longer, so a turn is a steady
// whirr that stops when the game pauses.
export function tlsMotor(E, t, dur = 1, k = 1, x = null, z = null) {
  if (!claim(E, t, dur + 0.2)) return false;
  let out = fxOut(E);
  if (x != null) { E.where(x, z, 30, W); out = E.spot(out, Math.max(0.12, W.gain), W.pan); }
  const ctx = E.ctx;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(92 * k, t);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 13;
  const depth = ctx.createGain();
  depth.gain.value = 5 * k;
  lfo.connect(depth).connect(osc.frequency);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 480;
  lp.Q.value = 2.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.038, t + 0.12);
  g.gain.setValueAtTime(0.038, t + dur - 0.08);
  g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.12);
  osc.connect(lp).connect(g).connect(out);
  osc.start(t); lfo.start(t);
  osc.stop(t + dur + 0.15); lfo.stop(t + dur + 0.15);
  E.made += 6;
  tone(E, out, t, { f: 1840 * k, a: 0.12, hold: dur - 0.1, d: 0.14, peak: 0.005 });
  noiseHit(E, out, t, { kind: 'pink', filter: 'bandpass', f: 1250 * k, q: 3, a: 0.12, hold: dur - 0.1, d: 0.14, peak: 0.013 });
  return true;
}

// The countdown's beeps: a short one each second, a higher double on the last.
export function tlsCount(E, t, go = false) {
  if (!claim(E, t, 0.4)) return false;
  const out = fxOut(E);
  if (go) {
    tone(E, out, t, { type: 'triangle', f: 1760, a: 0.003, hold: 0.05, d: 0.05, peak: 0.055 });
    tone(E, out, t + 0.12, { type: 'triangle', f: 2349, a: 0.003, hold: 0.09, d: 0.08, peak: 0.055 });
  } else {
    tone(E, out, t, { type: 'triangle', f: 1320, a: 0.003, hold: 0.06, d: 0.05, peak: 0.05 });
  }
  return true;
}

// Levelled: the instrument's happy two-note beep and a little click.
export function tlsLevelled(E, t) {
  if (!claim(E, t, 0.6)) return false;
  const out = fxOut(E);
  tone(E, out, t, { type: 'triangle', f: 1568, a: 0.003, hold: 0.07, d: 0.05, peak: 0.048 });
  tone(E, out, t + 0.13, { type: 'triangle', f: 2093, a: 0.003, hold: 0.12, d: 0.12, peak: 0.048 });
  noiseHit(E, out, t, { kind: 'white', filter: 'highpass', f: 3500, a: 0.001, d: 0.012, peak: 0.05, at: 0.3 });
  bell(E, out, t + 0.26, { f: 3136, peak: 0.018, d: 0.4, partials: 2 });
  return true;
}

// The bubble sliding into the middle ring: a soft blub.
export function tlsBubble(E, t, inRing = true) {
  if (!claim(E, t, 0.25)) return false;
  const out = fxOut(E);
  tone(E, out, t, { f: inRing ? 520 : 700, f1: inRing ? 880 : 460, glide: 0.07, a: 0.004, d: 0.09, peak: 0.07 });
  return true;
}

// The fan coming round at you out in the open: a blip that climbs as it nears (k 0..1).
export function tlsWarn(E, t, k = 0.5) {
  if (!claim(E, t, 0.12)) return false;
  tone(E, fxOut(E), t, { type: 'triangle', f: 880 + 720 * k, a: 0.002, hold: 0.02, d: 0.04, peak: 0.035 + 0.035 * k });
  return true;
}

// The scan starting: a rising shimmer as the laser fan opens, and a tiny chime.
export function tlsSweep(E, t) {
  if (!claim(E, t, 1.2)) return false;
  const out = fxOut(E);
  noiseHit(E, out, t, { kind: 'white', filter: 'bandpass', f: 700, f1: 5200, glide: 0.55, q: 3, a: 0.25, d: 0.4, peak: 0.065 });
  tone(E, out, t, { f: 420, f1: 1680, glide: 0.5, a: 0.05, hold: 0.25, d: 0.3, peak: 0.032 });
  tone(E, out, t + 0.02, { type: 'triangle', f: 840, f1: 3360, glide: 0.5, a: 0.05, hold: 0.2, d: 0.3, peak: 0.013 });
  bell(E, out, t + 0.55, { f: 2637, peak: 0.028, d: 0.6, partials: 2 });
  return true;
}

// Seen by the scanner: a sad trombone, "wah, wah, wah, wahhh", a sawtooth through a
// lowpass that opens on each note, the last one long with a wobble.
export function tlsGhost(E, t) {
  if (!claim(E, t, 1.9)) return false;
  const ctx = E.ctx, out = fxOut(E);
  const notes = [196, 185, 174.6, 164.8], len = [0.26, 0.26, 0.26, 0.85];
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 6;
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(0, t);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  let at = t;
  for (let k = 0; k < notes.length; k++) {
    const d = len[k];
    osc.frequency.setValueAtTime(notes[k], at);
    lp.frequency.setValueAtTime(380, at);
    lp.frequency.exponentialRampToValueAtTime(1500, at + 0.07);
    lp.frequency.exponentialRampToValueAtTime(520, at + d * 0.9);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.065, at + 0.03);
    g.gain.setValueAtTime(0.065, at + d * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, at + d * 0.98);
    at += d + 0.03;
  }
  depth.gain.setValueAtTime(0, at - len[3] - 0.03);
  depth.gain.linearRampToValueAtTime(5, at - 0.3);
  lfo.connect(depth).connect(osc.frequency);
  osc.connect(lp).connect(g).connect(out);
  osc.start(t); lfo.start(t);
  osc.stop(at + 0.05); lfo.stop(at + 0.05);
  E.made += 6;
  return true;
}

// The cloud landing: a bright rising arpeggio of bells and a soft glow under it; a
// three-star scan gets a sparkle on top.
export function tlsLanded(E, t, stars = 3) {
  if (!claim(E, t, 2.2)) return false;
  const out = fxOut(E);
  const notes = [84, 88, 91, 96];
  notes.forEach((m, k) => bell(E, out, t + k * 0.09, { f: midiHz(m), peak: 0.056 - k * 0.006, d: 1.1, partials: 3 }));
  tone(E, out, t, { f: midiHz(60), a: 0.25, hold: 0.3, d: 0.9, peak: 0.04 });
  tone(E, out, t, { f: midiHz(67), a: 0.3, hold: 0.25, d: 0.9, peak: 0.024 });
  if (stars >= 3) sparkle(E, out, t + 0.42, 5, 0.032);
  return true;
}

// A white ibis flapping through: a few wing beats and two nasal "hnk"s, placed.
export function tlsBird(E, t, x, z) {
  if (!claim(E, t, 1.4)) return false;
  E.where(x, z, 34, W);
  const out = E.spot(fxOut(E), Math.max(0.25, W.gain), W.pan);
  for (let k = 0; k < 5; k++) {
    noiseHit(E, out, t + k * 0.14 + rand() * 0.02, { kind: 'pink', filter: 'lowpass', f: 900, a: 0.01, d: 0.07, peak: 0.4 });
  }
  for (let k = 0; k < 2; k++) {
    const t0 = t + 0.25 + k * 0.2;
    tone(E, out, t0, { type: 'sawtooth', f: 330, f1: 290, glide: 0.08, a: 0.008, d: 0.08, peak: 0.07 });
    noiseHit(E, out, t0, { kind: 'white', filter: 'bandpass', f: 1150, q: 5, a: 0.008, d: 0.08, peak: 0.16 });
  }
  return true;
}

// The tripod set down (legs out, a clack and a thunk) or packed up (clicks and a zip).
export function tlsSetDown(E, t, down = true) {
  if (!claim(E, t, 0.7)) return false;
  const out = fxOut(E);
  if (down) {
    grains(E, out, t, { n: 3, span: 0.16, len: 0.02, fmin: 1800, fmax: 2600, q: 3, peak: 0.12, jitter: 0.2 });
    tone(E, out, t + 0.2, { f: 150, f1: 72, a: 0.003, d: 0.12, peak: 0.14 });
    noiseHit(E, out, t + 0.2, { kind: 'brown', filter: 'lowpass', f: 700, a: 0.003, d: 0.08, peak: 0.13 });
    tone(E, out, t + 0.32, { type: 'triangle', f: 2400, a: 0.001, d: 0.03, peak: 0.05 });
  } else {
    grains(E, out, t, { n: 4, span: 0.18, len: 0.015, fmin: 2600, fmax: 4200, q: 3, peak: 0.16, jitter: 0.3 });
    noiseHit(E, out, t + 0.2, { kind: 'white', filter: 'bandpass', f: 1500, f1: 5200, glide: 0.18, q: 2, a: 0.02, d: 0.16, peak: 0.12 });
    tone(E, out, t + 0.36, { f: 620, f1: 900, glide: 0.06, a: 0.003, d: 0.06, peak: 0.05 });
  }
  return true;
}
