// The island's ambience, following the place and the hour: a breeze and leaves
// (more leaves under the canopy, swelling with the gusts and all but gone between
// them, never a steady hiss), water lapping near the shore, cicadas in the
// heat of the day, crickets at dusk, birds (a morning chorus, a quiet midday, calls
// in the evening; herons and ducks by the water) and now and then a sound from the
// garden beyond (the tram's bell, wind chimes, a woodpecker, a sprinkler).
//
// The beds are built once and only their gains move; the calls are scheduled a
// little ahead from update(dt, env), env = { hours, water (m to the lake), canopy
// (0..1 cover round the listener), level (0..1, the whole bed) }.

import { tone, noiseHit, grains, bell, rand, between, midiHz } from './synth.js';

const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Time-of-day curves (clock hours).
export function dayCurves(h, out) {
  // birds: a chorus at first light, quiet over midday, calls again towards evening
  out.birds = Math.max(0.2, 1 - 0.85 * smooth(8.6, 11.2, h)) * (1 - 0.3 * smooth(11.5, 13, h)) + 0.45 * smooth(15.2, 17.4, h);
  // cicadas in the heat, crickets from late afternoon (and a few left from the night)
  out.heat = smooth(10.2, 12.6, h) * (1 - smooth(15.4, 17.6, h));
  out.dusk = smooth(16.4, 18.3, h) + 0.3 * (1 - smooth(7.4, 8.6, h));
  // the afternoon sea breeze
  out.breeze = 0.7 + 0.35 * smooth(11, 15, h);
  return out;
}

const MIX = { breeze: 0.07, leaves: 0.028, water: 0.16, slosh: 0.1, cicada: 0.04, cricket: 0.03 };
const AHEAD = 0.5; // seconds the calls are scheduled ahead (a stall in the page never makes one late)
// The leaves' level moves on a log scale: mid at the middle of the gusts, range dB for a
// full-scale swing, the swells rounded off at top dB (a rare big excursion of the slow
// noise is not a roar); the gusts wander about 5 dB (1 sd) over a few seconds and the
// flutter about 2.5 dB, so the rustle swells with a gust and all but drops away between
// them (4 to 5 dB quieter on average than the old steady bed, a few dB over it at a gust).
const LEAF = { mid: 0.25, range: 30, top: 10, gust: 0.93, flutter: 0.46 };
const CICADA_REST = 0.05; // a resting cicada's hum (26 dB under its song)

// A gain curve for a WaveShaper driven by a control signal: x in -1..1 to mid x 10^(dB / 20),
// dB = range x below the middle and rounded off towards +top above it.
function logCurve(mid, range, top, n = 1025) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = 2 * i / (n - 1) - 1;
    const dB = x > 0 ? top * Math.tanh(range * x / top) : range * x;
    c[i] = mid * Math.pow(10, dB / 20);
  }
  return c;
}

// The crickets' pulse: a square's odd harmonics up to the 9th, softened (Lanczos), so
// each pulse starts and stops in a couple of milliseconds instead of stepping.
function pulseWave(ctx) {
  const n = 10, re = new Float32Array(n), im = new Float32Array(n);
  for (let k = 1; k < n; k += 2) { const a = Math.PI * k / 11; im[k] = (Math.sin(a) / a) / k; }
  return ctx.createPeriodicWave(re, im);
}

export function createAmbience(E) {
  const ctx = E.ctx, out = E.bus.ambience;
  const t0 = ctx.currentTime;

  const loop = (buf, rate = 1) => {
    const s = ctx.createBufferSource();
    s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
    s.start(t0, rand() * (buf.duration - 0.1));
    return s;
  };
  const filter = (type, f, q = 0.7) => {
    const b = ctx.createBiquadFilter();
    b.type = type; b.frequency.value = f; b.Q.value = q;
    return b;
  };
  const gain = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  // a very slow random wobble into a param: brown noise played at a crawl
  const wobble = (param, rate, depth) => { loop(E.noise.brown, rate).connect(gain(depth)).connect(param); };
  const panner = (p) => {
    if (!ctx.createStereoPanner) return gain(1);
    const n = ctx.createStereoPanner(); n.pan.value = p; return n;
  };

  // ---------------------------------------------------------------- the beds

  const breezeG = gain(0);
  const gust = gain(0.7);
  loop(E.noise.pink).connect(filter('lowpass', 480, 0.5)).connect(breezeG).connect(gust).connect(out);
  wobble(gust.gain, 0.006, 0.35);

  // the leaves: two unrelated streams of noise, one to each side, so the rustle is
  // round the listener rather than a band of hiss in the middle of the head; its level
  // follows the gusts and the flutter (LEAF) through a log curve
  const leavesG = gain(0);
  const leafAm = gain(0);
  const leafIn = gain(1);
  for (const p of [-0.8, 0.8]) loop(E.noise.bed).connect(panner(p)).connect(leafIn);
  leafIn.connect(filter('highpass', 1100)).connect(filter('lowpass', 4200)).connect(leafAm).connect(leavesG).connect(out);
  const leafMod = gain(1);
  loop(E.noise.brown, 0.0025).connect(gain(LEAF.gust)).connect(leafMod); // gusts, a few seconds each
  loop(E.noise.brown, 0.09).connect(gain(LEAF.flutter)).connect(leafMod); // and the flutter of leaves
  const leafCurve = ctx.createWaveShaper();
  leafCurve.curve = logCurve(LEAF.mid, LEAF.range, LEAF.top);
  leafMod.connect(leafCurve).connect(leafAm.gain);

  const waterG = gain(0);
  const waterAm = gain(0.6);
  loop(E.noise.brown).connect(filter('lowpass', 420)).connect(waterAm).connect(waterG).connect(out);
  wobble(waterAm.gain, 0.02, 0.35);
  const sloshF = filter('bandpass', 650, 1.4);
  const sloshG = gain(0);
  loop(E.noise.pink).connect(sloshF).connect(sloshG).connect(waterG);

  // two cicadas: a noise band pulsed by a rounded gate (a sine, not a square, so the
  // buzz is soft rather than rasping), swelling slowly, each singing in waves
  const cicG = gain(0);
  cicG.connect(out);
  const cicadas = [];
  for (const [f, rate, p, sw] of [[4700, 92, -0.55, 0.008], [5900, 118, 0.5, 0.011]]) {
    const am = gain(0.55);
    const lfo = ctx.createOscillator();
    lfo.type = 'sine'; lfo.frequency.value = rate;
    lfo.connect(gain(0.45)).connect(am.gain);
    lfo.start(t0);
    const swell = gain(0.5);
    wobble(swell.gain, sw, 0.6);
    const wave = gain(0);
    loop(E.noise.bed).connect(filter('bandpass', f, 6)).connect(gain(7)).connect(am).connect(swell).connect(wave).connect(panner(p)).connect(cicG);
    cicadas.push({ wave, on: false, next: t0 + between(2, 12) });
  }

  // two crickets: a high sine pulsed fast (a rounded pulse, so no tick at each edge),
  // gated into chirps by update()
  const pulse = pulseWave(ctx);
  const crickets = [[4300, 29, 0.62, -0.4], [3950, 24, 0.8, 0.45]].map(([f, rate, period, p]) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = f;
    const am = gain(0.5);
    const lfo = ctx.createOscillator();
    lfo.setPeriodicWave(pulse); lfo.frequency.value = rate;
    lfo.connect(gain(0.5)).connect(am.gain);
    const g = gain(0);
    osc.connect(am).connect(g).connect(panner(p)).connect(out);
    osc.start(t0); lfo.start(t0);
    return { g, period, next: t0 + rand() };
  });
  E.made += 70;

  // ---------------------------------------------------------------- update

  const C = { birds: 0, heat: 0, dusk: 0, breeze: 0 };
  const cur = { breeze: -1, leaves: -1, water: -1, cicada: -1 };
  // the next of each call, in an object so a frame's update boxes no numbers
  const at = { lap: t0 + 0.5, bird: t0 + 1.5, garden: t0 + between(25, 60), drop: t0 + 3, acc: 1 };
  const stats = { birds: 0, laps: 0, garden: 0, chirps: 0, cicadaWaves: 0 };

  function setBed(key, param, v) {
    if (Math.abs(v - cur[key]) < 0.0015 && cur[key] >= 0) return;
    cur[key] = v;
    param.setTargetAtTime(v, ctx.currentTime, 0.9);
  }

  // now: the context's time, read once a frame by the caller
  function update(dt, env, now = ctx.currentTime) {
    const ahead = now + AHEAD;
    const L = env.level;
    const near = 1 - smooth(0.6, 16, env.water);
    const open = 1 - env.canopy;

    // the hour's curves and the beds, ten times a second
    at.acc += dt;
    if (at.acc >= 0.1) {
      at.acc = 0;
      dayCurves(env.hours, C);
      setBed('breeze', breezeG.gain, L * MIX.breeze * C.breeze * (0.55 + 0.6 * open));
      setBed('leaves', leavesG.gain, L * MIX.leaves * (0.3 + 1.1 * env.canopy) * (0.8 + 0.3 * C.breeze));
      setBed('water', waterG.gain, L * MIX.water * near);
      // under the trees they are close, but 4 dB softer than they were (0.35 + 0.65)
      setBed('cicada', cicG.gain, L * MIX.cicada * C.heat * (0.35 + 0.28 * env.canopy));
    }

    // each cicada sings for 20 to 40 s, then rests 20 to 60 s (a far one hums on, low)
    for (let i = 0; i < cicadas.length; i++) {
      const c = cicadas[i];
      if (c.next >= ahead) continue;
      const t = Math.max(now, c.next);
      c.on = !c.on;
      c.wave.gain.setTargetAtTime(c.on ? 1 : CICADA_REST, t, c.on ? 2.5 : 4);
      c.next = t + (c.on ? between(20, 40) : between(20, 60));
      if (c.on && C.heat > 0.05) stats.cicadaWaves++;
    }

    // laps at the shore
    if (at.lap < ahead) {
      const t = Math.max(now, at.lap);
      if (near > 0.02) {
        const k = 0.6 + 0.4 * rand();
        sloshF.frequency.setTargetAtTime(between(620, 900), t, 0.05);
        sloshF.frequency.setTargetAtTime(330, t + 0.2, 0.35);
        sloshG.gain.setTargetAtTime(MIX.slosh / MIX.water * k, t, 0.12);
        sloshG.gain.setTargetAtTime(0, t + 0.32, 0.32);
        stats.laps++;
      }
      at.lap = t + between(1.4, 3.6);
    }
    // a drip or plip near the water
    if (at.drop < ahead) {
      const t = Math.max(now, at.drop);
      if (near > 0.3 && L > 0 && E.claim('ambience', t, 0.2)) {
        const f = between(900, 1700);
        tone(E, E.spot(out, 0.5 * near * L, between(-0.7, 0.7)), t, { f, f1: f * 1.7, glide: 0.035, a: 0.002, d: 0.05, peak: 0.05 });
      }
      at.drop = t + between(2.5, 7);
    }

    // crickets, chirp by chirp
    for (let i = 0; i < crickets.length; i++) {
      const c = crickets[i];
      if (c.next >= ahead) continue;
      const t = Math.max(now, c.next);
      const lv = L * MIX.cricket * Math.min(1, C.dusk) * (0.45 + 0.55 * open);
      if (lv > 0.0005) {
        c.g.gain.setTargetAtTime(lv, t, 0.005);
        c.g.gain.setTargetAtTime(0, t + 0.085, 0.008);
        stats.chirps++;
      }
      c.next = t + c.period * (0.9 + 0.2 * rand()) + (rand() < 0.08 ? between(0.8, 2.5) : 0);
    }

    // birds
    if (at.bird < ahead) {
      const t = Math.max(now, at.bird);
      const density = C.birds * (0.55 + 0.7 * env.canopy);
      if (L > 0 && rand() < 0.35 + 0.65 * density) {
        const kind = pickBird(env.hours, near);
        const far = rand() < 0.45;
        if (bird(E, t, kind, between(-0.8, 0.8), L * (far ? 0.45 : 1) * (0.6 + 0.4 * env.canopy), far)) stats.birds++;
      }
      // a chorus overlaps; midday is sparse
      at.bird = t + between(0.6, 2.2) / Math.max(0.12, density);
    }

    // the garden beyond the lake
    if (at.garden < ahead) {
      const t = Math.max(now, at.garden);
      if (L > 0 && garden(E, t, L)) stats.garden++;
      at.garden = t + between(45, 130);
    }
  }

  return { update, stats, curves: C };
}

// ---------------------------------------------------------------- birds

const BIRDS = {
  morning: [['warbler', 3], ['cardinal', 2.5], ['titmouse', 1.5], ['mocking', 1.5], ['dove', 1], ['parakeet', 0.5]],
  midday: [['dove', 3], ['parakeet', 1.5], ['grackle', 1.5], ['cardinal', 1], ['warbler', 0.5]],
  evening: [['cardinal', 3], ['mocking', 2], ['titmouse', 1.5], ['dove', 1.5], ['warbler', 1], ['parakeet', 1]],
};
function pickBird(h, near) {
  if (near > 0.35 && rand() < 0.22 * near) return rand() < 0.5 ? 'heron' : 'duck';
  const list = h < 11 ? BIRDS.morning : h < 15.3 ? BIRDS.midday : BIRDS.evening;
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i][1];
  let r = rand() * sum;
  for (let i = 0; i < list.length; i++) { r -= list[i][1]; if (r <= 0) return list[i][0]; }
  return list[0][0];
}

// One bird's call: a single oscillator whose pitch and loudness are drawn note by
// note, through a panner (and a lowpass when it is far off).
export function bird(E, t, kind, pan, level, far) {
  const ctx = E.ctx;
  const dur = { warbler: 1.1, cardinal: 2.2, titmouse: 1.6, mocking: 2.6, dove: 3.2, parakeet: 1.6, grackle: 0.8, heron: 0.8, duck: 0.9 }[kind] || 1;
  if (!E.claim('ambience', t, dur)) return false;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  osc.connect(g);
  let node = g;
  const F = osc.frequency, G = g.gain;
  // one note: a slur from f0 to f1 over d seconds at amplitude a
  const note = (s, f0, f1, d, a, att = 0.008) => {
    F.setValueAtTime(f0, t + s);
    F.exponentialRampToValueAtTime(f1, t + s + d);
    G.setValueAtTime(0, t + s);
    G.linearRampToValueAtTime(a, t + s + att);
    G.setValueAtTime(a, t + s + d * 0.7);
    G.linearRampToValueAtTime(0, t + s + d);
  };
  const v = 0.036 * level;
  let s = 0;
  if (kind === 'warbler') { // a quick falling trill
    const n = 6 + Math.floor(rand() * 7), top = between(4600, 5600);
    for (let k = 0; k < n; k++) { const f = top * (1 - 0.25 * k / n); note(s, f * 0.9, f * 1.08, 0.045, v * 0.7); s += 0.062; }
  } else if (kind === 'cardinal') { // "cheer cheer cheer", then sometimes "birdy birdy"
    const n = 3 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) { note(s, 3400, 1900, 0.2, v, 0.02); s += 0.3; }
    if (rand() < 0.5) for (let k = 0; k < 4; k++) { note(s, k % 2 ? 2900 : 2200, k % 2 ? 2300 : 2800, 0.09, v * 0.8); s += 0.12; }
  } else if (kind === 'titmouse') { // "peter peter peter"
    for (let k = 0; k < 3 + Math.floor(rand() * 2); k++) { note(s, 3100, 2900, 0.12, v); note(s + 0.15, 2400, 2350, 0.14, v * 0.85); s += 0.38; }
  } else if (kind === 'mocking') { // a borrowed little phrase, said three times
    const a = between(1600, 3400), b = a * between(0.7, 1.4), c = between(1800, 3800);
    for (let r = 0; r < 3; r++) { note(s, a, b, 0.09, v); note(s + 0.12, c, c * 1.2, 0.07, v * 0.8); note(s + 0.22, b, a, 0.1, v * 0.9); s += 0.55 + rand() * 0.2; }
  } else if (kind === 'dove') { // the mourning dove's soft "coo-OO-oo, oo, oo"
    osc.type = 'sine';
    note(0, 430, 560, 0.4, v * 1.6, 0.1); note(0.5, 560, 500, 0.6, v * 1.8, 0.08);
    for (let k = 0; k < 3; k++) note(1.25 + k * 0.55, 490, 455, 0.4, v * 1.5, 0.08);
    s = 3;
  } else if (kind === 'parakeet') { // monk parakeets going over, squabbling
    osc.type = 'sawtooth';
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 2.5;
    g.connect(bp); node = bp;
    const n = 4 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) { const f = between(1800, 2800); note(s, f, f * between(0.8, 1.25), 0.07, v * 1.2, 0.004); s += between(0.1, 0.24); }
  } else if (kind === 'grackle') { // a squeaky rising whistle and a click
    note(0, 1800, 6200, 0.32, v * 0.7, 0.03); note(0.42, 2600, 2400, 0.03, v * 0.8, 0.002);
    s = 0.5;
  } else if (kind === 'heron') { // a low croak from the reeds
    osc.type = 'sawtooth';
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 650; bp.Q.value = 1.5;
    g.connect(bp); node = bp;
    note(0, 190, 150, 0.36, v * 2.2, 0.02);
    s = 0.4;
  } else { // a duck: two or three quacks
    osc.type = 'sawtooth';
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 3;
    g.connect(bp); node = bp;
    const n = 2 + Math.floor(rand() * 2);
    for (let k = 0; k < n; k++) { note(s, 400, 300, 0.15, v * 1.6, 0.01); s += 0.22; }
  }
  if (far) {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    node.connect(lp); node = lp;
  }
  node.connect(E.spot(E.bus.ambience, 1, pan));
  osc.start(t);
  osc.stop(t + s + 0.1);
  E.made += 4;
  return true;
}

// ---------------------------------------------------------------- the garden beyond

function garden(E, t, level) {
  const ctx = E.ctx;
  if (!E.claim('ambience', t, 3.5)) return false;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 2400;
  lp.connect(E.spot(E.bus.ambience, 0.55 * level, between(-0.85, 0.85)));
  const r = rand();
  if (r < 0.28) { // the tram's bell, twice
    bell(E, lp, t, { f: 1180, peak: 0.05, d: 1.4, partials: 3 });
    bell(E, lp, t + 0.32, { f: 1180, peak: 0.045, d: 1.6, partials: 3 });
  } else if (r < 0.55) { // wind chimes
    const scale = [72, 74, 76, 79, 81, 84, 86];
    for (let k = 0; k < 7; k++) bell(E, lp, t + k * between(0.12, 0.4), { f: midiHz(scale[Math.floor(rand() * scale.length)]), peak: 0.03, d: 2, partials: 3 });
  } else if (r < 0.78) { // a woodpecker drumming
    grains(E, lp, t, { n: 16, span: 0.9, len: 0.02, fmin: 700, fmax: 1100, q: 3, peak: 0.12, fade: true, kind: 'pink' });
  } else { // a sprinkler ticking round, then whirring back
    grains(E, lp, t, { n: 12, span: 2.2, len: 0.03, fmin: 2500, fmax: 3500, q: 1.5, peak: 0.06, jitter: 0.3 });
    noiseHit(E, lp, t + 2.4, { kind: 'white', filter: 'bandpass', f: 3000, q: 2, a: 0.05, hold: 0.5, d: 0.2, peak: 0.02 });
  }
  return true;
}
