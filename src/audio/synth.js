// Small building blocks every cue is made of: a tone with a glide, a filtered noise
// hit, a spray of noise grains (rustles, crunches, scurries), a bell and the music's
// plucks. Each takes the engine, a destination node and a start time, schedules
// its own envelope and stops itself; each returns when it ends.

const FLOOR = 0.0001;

export const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// A cheap seeded random, so offline renders repeat.
let seed = 20260926;
export function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
export const between = (a, b) => a + (b - a) * rand();
export const pickOne = (list) => list[Math.floor(rand() * list.length)];

// Attack, hold and an exponential tail on a gain param.
export function envelope(param, t, a, hold, d, peak) {
  param.setValueAtTime(FLOOR, t);
  param.exponentialRampToValueAtTime(Math.max(FLOOR * 2, peak), t + Math.max(0.001, a));
  if (hold > 0) param.setValueAtTime(Math.max(FLOOR * 2, peak), t + a + hold);
  param.exponentialRampToValueAtTime(FLOOR, t + a + hold + Math.max(0.005, d));
}

// o: { type, wave (PeriodicWave), f, f1, glide (s), a, hold, d, peak, detune }
export function tone(E, dest, t, o) {
  const ctx = E.ctx;
  const osc = ctx.createOscillator();
  if (o.wave) osc.setPeriodicWave(o.wave); else osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(o.f, t);
  if (o.f1 && o.f1 !== o.f) {
    const g = o.glide ?? (o.a || 0.005) + (o.hold || 0) + (o.d || 0.1);
    if (o.lin) osc.frequency.linearRampToValueAtTime(o.f1, t + g);
    else osc.frequency.exponentialRampToValueAtTime(o.f1, t + g);
  }
  if (o.detune) osc.detune.value = o.detune;
  const g = ctx.createGain();
  const a = o.a ?? 0.005, hold = o.hold || 0, d = o.d ?? 0.1;
  envelope(g.gain, t, a, hold, d, o.peak ?? 0.2);
  osc.connect(g).connect(dest);
  const end = t + a + hold + d + 0.02;
  osc.start(t);
  osc.stop(end);
  E.made += 2;
  return end;
}

// o: { kind: white|pink|brown, filter: lowpass|highpass|bandpass, f, f1, q, a, hold, d,
//      peak, rate (playback rate), at (a fixed start in the noise, so a short
//      transient comes out the same every time; random when left out) }
export function noiseHit(E, dest, t, o) {
  const ctx = E.ctx;
  const src = ctx.createBufferSource();
  src.buffer = E.noise[o.kind || 'white'];
  src.loop = true;
  if (o.rate) src.playbackRate.value = o.rate;
  const flt = ctx.createBiquadFilter();
  flt.type = o.filter || 'bandpass';
  flt.frequency.setValueAtTime(o.f || 1000, t);
  const a = o.a ?? 0.005, hold = o.hold || 0, d = o.d ?? 0.1;
  if (o.f1) flt.frequency.exponentialRampToValueAtTime(o.f1, t + (o.glide ?? a + hold + d));
  flt.Q.value = o.q ?? 1;
  const g = ctx.createGain();
  envelope(g.gain, t, a, hold, d, o.peak ?? 0.2);
  src.connect(flt).connect(g).connect(dest);
  const end = t + a + hold + d + 0.02;
  src.start(t, o.at ?? rand() * (src.buffer.duration - 0.5));
  src.stop(end);
  E.made += 3;
  return end;
}

// n short noise grains over span seconds, each len long at a random pitch in
// [fmin, fmax]: one source, one filter and one gain for the whole spray.
// o: { n, span, len, fmin, fmax, q, peak, kind, filter, shape (0 even, >0 bunched
// early, <0 bunched late), jitter (0..1 random loudness) }
export function grains(E, dest, t, o) {
  const ctx = E.ctx;
  const src = ctx.createBufferSource();
  src.buffer = E.noise[o.kind || 'white'];
  src.loop = true;
  const flt = ctx.createBiquadFilter();
  flt.type = o.filter || 'bandpass';
  flt.Q.value = o.q ?? 2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  const n = o.n || 8, span = o.span || 0.3, len = o.len || 0.012, peak = o.peak ?? 0.2;
  const shape = o.shape || 0, jitter = o.jitter ?? 0.5;
  let last = t;
  for (let k = 0; k < n; k++) {
    let u = n > 1 ? k / (n - 1) : 0;
    if (shape > 0) u = Math.pow(u, 1 + shape); else if (shape < 0) u = 1 - Math.pow(1 - u, 1 - shape);
    let tk = t + u * span + (rand() - 0.5) * (span / n) * 0.8;
    if (tk < last + 0.003) tk = last + 0.003;
    const amp = peak * (1 - jitter * rand()) * (o.fade ? 1 - 0.7 * u : 1);
    flt.frequency.setValueAtTime(between(o.fmin || 2000, o.fmax || 6000), tk);
    g.gain.setValueAtTime(0, tk);
    g.gain.linearRampToValueAtTime(amp, tk + 0.0015);
    g.gain.exponentialRampToValueAtTime(FLOOR, tk + len);
    g.gain.setValueAtTime(0, tk + len + 0.001);
    last = tk + len + 0.002;
  }
  src.connect(flt).connect(g).connect(dest);
  const end = last + 0.02;
  src.start(t, rand() * (src.buffer.duration - 0.5));
  src.stop(end);
  E.made += 3;
  return end;
}

// A small bell: a few inharmonic sine partials, the high ones dying first.
const BELL = [[1, 1, 1], [2.76, 0.45, 0.55], [5.4, 0.22, 0.3], [8.93, 0.1, 0.18]];
export function bell(E, dest, t, { f, peak = 0.12, d = 1.6, partials = 4, bright = 1 }) {
  let end = t;
  for (let i = 0; i < partials && i < BELL.length; i++) {
    const [m, amp, dk] = BELL[i];
    if (f * m > 16000) break;
    end = Math.max(end, tone(E, dest, t, { f: f * m, a: 0.002, d: d * dk, peak: peak * amp * (i ? bright : 1) }));
  }
  return end;
}

// The music's plucked tines and bars.
//   kalimba: a sine with its bright tine partial and a little bend into the note
//   marimba: a sine with the 4th and 10th partials, softer and woodier
//   flute: a breathy soft sine-triangle with a slow start
export function pluck(E, dest, t, { f, v = 0.5, kind = 'kalimba', d = 1.2 }) {
  if (kind === 'marimba') {
    tone(E, dest, t, { f, a: 0.003, d: d * 0.8, peak: 0.34 * v });
    tone(E, dest, t, { f: f * 4, a: 0.002, d: 0.12, peak: 0.1 * v });
    return tone(E, dest, t, { f: f * 9.9, a: 0.001, d: 0.03, peak: 0.03 * v });
  }
  if (kind === 'flute') {
    const end = tone(E, dest, t, { type: 'triangle', f, a: 0.09, hold: d * 0.35, d: d * 0.6, peak: 0.12 * v });
    noiseHit(E, dest, t, { kind: 'pink', filter: 'bandpass', f: f * 2, q: 3, a: 0.05, d: 0.2, peak: 0.02 * v });
    return end;
  }
  tone(E, dest, t, { f: f * 1.012, f1: f, glide: 0.03, a: 0.002, d, peak: 0.3 * v });
  tone(E, dest, t, { f: f * 5.9, a: 0.001, d: 0.09, peak: 0.07 * v });
  return tone(E, dest, t, { f: f * 2, a: 0.002, d: d * 0.35, peak: 0.06 * v });
}

// A soft pad chord: a detuned saw and triangle a note through one lowpass, slow in
// and out.
export function pad(E, dest, t, { notes, dur, v = 0.5, cutoff = 900, a = 1.2, r = 1.6 }) {
  const ctx = E.ctx;
  const flt = ctx.createBiquadFilter();
  flt.type = 'lowpass';
  flt.frequency.value = cutoff;
  flt.Q.value = 0.4;
  const g = ctx.createGain();
  const peak = 0.05 * v / Math.sqrt(notes.length);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.setValueAtTime(peak, t + Math.max(a, dur - r));
  g.gain.linearRampToValueAtTime(0, t + dur);
  flt.connect(g).connect(dest);
  for (let i = 0; i < notes.length; i++) {
    for (let k = 0; k < 2; k++) {
      const det = k ? 6 : -7;
      const o = ctx.createOscillator();
      o.type = k ? 'triangle' : 'sawtooth';
      o.frequency.value = notes[i];
      o.detune.value = det + (rand() - 0.5) * 3;
      o.connect(flt);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }
  E.made += 2 + notes.length * 2;
  return t + dur;
}
