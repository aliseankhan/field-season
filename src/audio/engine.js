// The sound engine: buses with volumes, gentle compression and a safety limiter, a
// shared reverb, noise buffers, a voice cap and a small place for the listener. It
// takes any BaseAudioContext, so an OfflineAudioContext can render every cue
// through the same chain to check levels.
//
//   music > duck > echo                > musicVol  \
//   ambience                           > ambVol     \
//   effects                            > fxVol       > master > mute > glue > drive > limiter > out
//   stings (the jingles)               > jingleVol  /   (jingleVol follows the Effects slider)
//   James's voice (dry or radio)       > voiceVol  /
//   each bus volume also sends to the reverb, which returns to the master

export const BUS_KEYS = ['master', 'music', 'ambience', 'effects', 'voice'];
export const DEFAULTS = { master: 0.8, music: 0.65, ambience: 0.75, effects: 0.85, voice: 0.85, muted: false };

// A slider (0..1) to a gain: square law, so half way is about -12 dB.
export const sliderGain = (v) => (v <= 0 ? 0 : v * v);

// Voices at once per bus: a cue past the cap is dropped rather than piled up.
const CAPS = { effects: 26, ambience: 12, music: 24, stings: 8 };
// How much of each bus goes to the reverb.
const SENDS = { music: 0.32, ambience: 0.22, effects: 0.1, jingles: 0.32, voice: 0.1 };
// The master's glue (gentle) and the limiter that keeps peaks under -3 dBFS, with
// the drive between them that sets the overall loudness.
const COMP = { threshold: -18, knee: 10, ratio: 2, attack: 0.015, release: 0.3 };
const LIMIT = { threshold: -5, knee: 0, ratio: 20, attack: 0.002, release: 0.1 };
const DRIVE = 3.0;
// the bus trims: the music sits under the ambience and effects (the stings' trim keeps
// them where they were when they followed the Music slider: 0.8 x 0.65^2 / 0.85^2)
const TRIM = { music: 0.4, stings: 0.47, effects: 1.4, out: 0.88 };

export function createEngine(ctx) {
  const E = {
    ctx, sr: ctx.sampleRate,
    dropped: 0, made: 0,
    // the listener: position and the camera's right vector on the ground (spatial cues)
    ear: { x: 0, z: 0, rx: 1, rz: 0 },
  };
  E.now = () => ctx.currentTime;

  // ---------------------------------------------------------------- the master chain
  const master = ctx.createGain();
  const mute = ctx.createGain();
  const comp = compressor(ctx, COMP);
  const drive = ctx.createGain();
  drive.gain.value = DRIVE;
  const limit = compressor(ctx, LIMIT);
  master.connect(mute).connect(comp.input);
  comp.output.connect(drive).connect(limit.input);
  const ceiling = ctx.createGain();
  ceiling.gain.value = TRIM.out; // a little under the limiter, for the worst pile-up
  limit.output.connect(ceiling).connect(ctx.destination);

  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx, 2.1, 2.6);
  const verbOut = ctx.createGain();
  verbOut.gain.value = 0.9;
  reverb.connect(verbOut).connect(master);

  const vols = {};
  function busVol(key) {
    const g = ctx.createGain();
    g.connect(master);
    if (SENDS[key]) {
      const s = ctx.createGain();
      s.gain.value = SENDS[key];
      g.connect(s).connect(reverb);
    }
    vols[key] = g;
    return g;
  }
  const musicVol = busVol('music');
  const ambVol = busVol('ambience');
  const fxVol = busVol('effects');
  const jingleVol = busVol('jingles');
  const voiceVol = busVol('voice');

  // music: a duck for talks and mini-games, then a soft echo, like a room with a porch
  const musicIn = ctx.createGain();
  const duck = ctx.createGain();
  musicIn.connect(duck);
  duck.connect(musicVol);
  const echo = ctx.createDelay(1.5);
  echo.delayTime.value = 0.36;
  const echoFb = ctx.createGain();
  echoFb.gain.value = 0.3;
  const echoTone = ctx.createBiquadFilter();
  echoTone.type = 'lowpass'; echoTone.frequency.value = 2400;
  const echoWet = ctx.createGain();
  echoWet.gain.value = 0.2;
  duck.connect(echo);
  echo.connect(echoTone).connect(echoFb).connect(echo);
  echoTone.connect(echoWet).connect(musicVol);
  const stings = ctx.createGain();
  stings.gain.value = TRIM.stings;
  stings.connect(jingleVol);
  musicIn.gain.value = TRIM.music;
  // past the duck: the Music slider's preview, heard at its true level in the pause card
  const musicDry = ctx.createGain();
  musicDry.gain.value = TRIM.music;
  musicDry.connect(musicVol);

  const ambIn = ctx.createGain();
  ambIn.connect(ambVol);
  const fxIn = ctx.createGain();
  fxIn.gain.value = TRIM.effects;
  fxIn.connect(fxVol);
  const voiceIn = ctx.createGain();
  voiceIn.gain.value = 1;
  voiceIn.connect(voiceVol);

  E.bus = { music: musicIn, musicDry, stings, ambience: ambIn, effects: fxIn, voice: voiceIn };
  E.nodes = { master, mute, comp: comp.node, limit: limit.node, drive, reverb, duck, echo, vols };

  // ---------------------------------------------------------------- volumes

  E.apply = (settings, ramp = 0.08) => {
    const t = ctx.currentTime;
    const set = (param, v) => { param.cancelScheduledValues(t); param.setTargetAtTime(v, t, ramp); };
    set(master.gain, sliderGain(settings.master));
    set(musicVol.gain, sliderGain(settings.music));
    set(ambVol.gain, sliderGain(settings.ambience));
    set(fxVol.gain, sliderGain(settings.effects));
    set(jingleVol.gain, sliderGain(settings.effects));
    set(voiceVol.gain, sliderGain(settings.voice ?? DEFAULTS.voice));
    set(mute.gain, settings.muted ? 0 : 1);
  };
  E.setVolumesNow = (settings) => {
    master.gain.value = sliderGain(settings.master);
    musicVol.gain.value = sliderGain(settings.music);
    ambVol.gain.value = sliderGain(settings.ambience);
    fxVol.gain.value = sliderGain(settings.effects);
    jingleVol.gain.value = sliderGain(settings.effects);
    voiceVol.gain.value = sliderGain(settings.voice ?? DEFAULTS.voice);
    mute.gain.value = settings.muted ? 0 : 1;
  };

  // The music's duck: the lowest level any open reason asks for ('aim' while the loop
  // is locked on a lizard, so its little cues come through).
  const ducks = { dialogue: 1, minigame: 1, panel: 1, sting: 1, snug: 1, aim: 1 };
  let duckNow = 1;
  E.duck = (reason, level) => {
    ducks[reason] = level;
    let v = 1;
    for (const k in ducks) if (ducks[k] < v) v = ducks[k];
    if (Math.abs(v - duckNow) < 1e-3) return;
    const t = ctx.currentTime;
    duck.gain.cancelScheduledValues(t);
    duck.gain.setTargetAtTime(v, t, v < duckNow ? 0.12 : 0.6);
    duckNow = v;
  };
  E.setEcho = (seconds) => { echo.delayTime.setTargetAtTime(Math.min(1.2, Math.max(0.1, seconds)), ctx.currentTime, 0.05); };

  // ---------------------------------------------------------------- voices

  const slots = {};
  for (const k in CAPS) slots[k] = new Float64Array(CAPS[k]);
  // Claims a voice on a bus for dur seconds from t; false when the bus is full.
  E.claim = (bus, t, dur) => {
    const arr = slots[bus] || slots.effects;
    const now = ctx.currentTime;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] <= now) { arr[i] = t + dur; return true; }
    }
    E.dropped++;
    return false;
  };
  E.voices = (bus) => {
    const arr = slots[bus];
    if (!arr) return 0;
    const now = ctx.currentTime;
    let n = 0;
    for (let i = 0; i < arr.length; i++) if (arr[i] > now) n++;
    return n;
  };

  // ---------------------------------------------------------------- noise

  E.noise = {
    white: noiseBuffer(ctx, 2, 'white'),
    pink: noiseBuffer(ctx, 4, 'pink'),
    brown: noiseBuffer(ctx, 4, 'brown'),
    // a long white noise of its own for the steady beds (the leaves, the cicadas), so
    // their grain does not come round again every 2 s
    bed: noiseBuffer(ctx, 7.3, 'white', 8675309),
  };

  // ---------------------------------------------------------------- place

  // Gain and pan for a sound at (x, z) heard from the listener, in `out`
  // ({ gain, pan }); gain 0 beyond range. Near sounds are centred a little.
  E.where = (x, z, range, out) => {
    const dx = x - E.ear.x, dz = z - E.ear.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d >= range) { out.gain = 0; out.pan = 0; out.d = d; return out; }
    const k = 1 - d / range;
    out.gain = k * k * (3 - 2 * k) * (1 / (1 + d * 0.12));
    const side = d > 1e-3 ? (dx * E.ear.rx + dz * E.ear.rz) / d : 0;
    out.pan = Math.max(-0.85, Math.min(0.85, side * Math.min(1, d / 2.5)));
    out.d = d;
    return out;
  };
  // A gain and stereo panner into a bus, for one spatial cue. The panner shares a mono
  // cue between the ears at equal power; a centred cue skips it and the bus copies it
  // to both ears at full level, so that path is 3 dB down to match (a cue straight
  // ahead is no louder than the same cue a step to one side).
  E.spot = (bus, gain, pan) => {
    const g = ctx.createGain();
    if (Math.abs(pan) > 0.02 && ctx.createStereoPanner) {
      g.gain.value = gain;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(bus);
    } else {
      g.gain.value = gain * Math.SQRT1_2;
      g.connect(bus);
    }
    return g;
  };

  E.graph = () => ({
    sampleRate: ctx.sampleRate,
    state: ctx.state,
    chain: `buses > master > mute > compressor(${COMP.threshold} dB, ${COMP.ratio}:1) > drive x${DRIVE} > limiter(${LIMIT.threshold} dB, ${LIMIT.ratio}:1) > out`,
    buses: ['music (duck, echo)', 'stings (jingles, on the Effects slider)', 'ambience', 'effects', 'voice'],
    sends: SENDS,
    caps: CAPS,
    reverb: '2.1 s procedural impulse',
  });

  return E;
}

// A DynamicsCompressor with its automatic make-up gain taken back out (browsers add
// about 0.6 of the gain it would take off a full-scale signal), so it only turns
// loud things down: { node, input, output }.
function compressor(ctx, o) {
  const node = ctx.createDynamicsCompressor();
  node.threshold.value = o.threshold; node.knee.value = o.knee; node.ratio.value = o.ratio;
  node.attack.value = o.attack; node.release.value = o.release;
  const yKnee = o.threshold + o.knee * (1 + 1 / o.ratio) / 2; // the curve at the knee's top
  const full = yKnee + (0 - o.threshold - o.knee) / o.ratio; // and at 0 dBFS
  const trim = ctx.createGain();
  trim.gain.value = Math.pow(10, (0.6 * full) / 20);
  node.connect(trim);
  return { node, input: node, output: trim };
}

// ---------------------------------------------------------------- buffers

function noiseBuffer(ctx, seconds, kind, seed0) {
  const n = Math.floor(ctx.sampleRate * seconds);
  // f samples more than the loop are made, to be folded into its head (below)
  const f = Math.min(2048, n >> 3);
  const x = new Float32Array(n + f);
  let seed = seed0 ?? (kind === 'white' ? 12345 : kind === 'pink' ? 777 : 4242);
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296 * 2 - 1;
  };
  if (kind === 'white') {
    for (let i = 0; i < n + f; i++) x[i] = rnd() * 0.7;
  } else if (kind === 'pink') {
    // Paul Kellet's filter
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n + f; i++) {
      const w = rnd();
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      x[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else {
    let last = 0;
    for (let i = 0; i < n + f; i++) {
      last = (last + 0.02 * rnd()) / 1.02;
      x[i] = last * 3.2;
    }
  }
  // Loop without a click or a dip: the noise that would follow the last sample is
  // crossfaded into the head at equal power (the two stretches are unrelated, so their
  // powers add), so the end runs straight on into the start at the same level.
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  d.set(x.subarray(0, n));
  for (let i = 0; i < f; i++) {
    const k = i / f;
    d[i] = x[i] * Math.sqrt(k) + x[n + i] * Math.sqrt(1 - k);
  }
  return buf;
}

// A soft stereo room: decaying noise that darkens as it fades.
function impulse(ctx, seconds, decay) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  const pre = Math.floor(ctx.sampleRate * 0.012);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let seed = c ? 99991 : 31337, lp = 0;
    for (let i = pre; i < n; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const w = seed / 4294967296 * 2 - 1;
      const t = (i - pre) / (n - pre);
      const k = 0.55 - 0.45 * t; // the tail loses its top
      lp += (w - lp) * k;
      d[i] = lp * Math.pow(1 - t, decay) * 0.5;
    }
  }
  return buf;
}
