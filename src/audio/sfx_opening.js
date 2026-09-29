// The opening's sounds (src/story/kit_hunt.js and flow.js), synthesised like the rest of
// sfx.js and played through audio.cue(name, ...args): a piece of the scattered kit
// found (a bright little jingle, rising a step with each piece, a fuller run for the
// last), and the field table set back on its legs (a creak and a wooden knock). The
// ibis's honks and its flurry of wings are sfx_rtk.js's ibis(). Levels sit with the
// toasts' chimes and the routine field sounds (peaks round -24 to -18 dBFS).

import { tone, noiseHit, bell, midiHz } from './synth.js';

const claim = (E, t, dur) => E.claim('effects', t, dur);
const fxOut = (E) => E.bus.effects;

// n: how many pieces are found now (1 to 5); last: the whole kit is back.
export function kitFound(E, t, n = 1, last = false) {
  if (!claim(E, t, 1.2)) return false;
  const out = fxOut(E);
  const base = 81 + Math.min(4, Math.max(0, n - 1)) * 2; // a step up with each piece
  const run = last ? [0, 4, 7, 12, 16] : [0, 4, 7, 12];
  run.forEach((s, k) => bell(E, out, t + k * 0.075, { f: midiHz(base + s), peak: 0.05 + k * 0.004, d: 0.55 + k * 0.12, partials: 3 }));
  tone(E, out, t, { type: 'triangle', f: midiHz(base - 12), a: 0.004, d: 0.18, peak: 0.05 });
  noiseHit(E, out, t, { kind: 'white', filter: 'highpass', f: 5200, a: 0.001, d: 0.05, peak: 0.05 });
  if (last) bell(E, out, t + 0.42, { f: midiHz(base + 19), peak: 0.045, d: 1.1, partials: 3 });
  return true;
}

// The table swung back up onto its legs: a short creak of the hinges, then a knock.
export function tableUp(E, t) {
  if (!claim(E, t, 0.8)) return false;
  const out = fxOut(E);
  noiseHit(E, out, t, { kind: 'pink', filter: 'bandpass', f: 1300, f1: 700, q: 3, a: 0.04, d: 0.22, peak: 0.1 });
  tone(E, out, t + 0.02, { type: 'sawtooth', f: 180, f1: 140, a: 0.03, d: 0.2, peak: 0.018 });
  tone(E, out, t + 0.5, { f: 190, f1: 140, a: 0.002, d: 0.13, peak: 0.26 });
  noiseHit(E, out, t + 0.5, { kind: 'brown', filter: 'lowpass', f: 420, a: 0.002, d: 0.12, peak: 0.32 });
  tone(E, out, t + 0.5, { f: 760, a: 0.001, d: 0.03, peak: 0.05 });
  return true;
}
