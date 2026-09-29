// James's voice: a cute babble, one soft syllable for a letter or
// two, following the typewriter. It is sung on one small voice that is always
// there (a buzzy oscillator through two formant filters, a breath of noise for the
// consonants), so talking makes no new nodes. Each letter has its own pitch and
// vowel, so a word sounds the same each time; lines fall at a full stop and rise at
// a question; the player's name is sung, a little higher and bouncier. Over the
// radio the voice is band-limited with a faint hiss, which is only there while he
// talks (like a radio's button held down) and goes with the talk: it never stays on
// as a bed under the island.

const VOWEL = { a: 'a', b: 'e', c: 'e', d: 'e', e: 'e', f: 'e', g: 'e', h: 'a', i: 'i', j: 'a', k: 'a', l: 'e', m: 'o', n: 'e', o: 'o', p: 'i', q: 'u', r: 'a', s: 'e', t: 'i', u: 'u', v: 'i', w: 'u', x: 'e', y: 'a', z: 'e' };
const FORMANT = { a: [780, 1250], e: [520, 1850], i: [340, 2250], o: [540, 920], u: [370, 830] };
const HISS = new Set(['s', 'z', 'f']);
const CLICK = new Set(['t', 'k', 'p', 'd', 'b', 'g', 'q', 'j', 'c', 'x']);

const BASE = 176; // Hz: warm and friendly
const GAP = 0.068; // at least this between syllables, seconds
const SYL = 0.075; // a syllable's length
const VOL = 0.1; // a syllable's loudness into the formants
const CRACKLE = 0.04; // the radio's hiss while he talks (band-limited, under his voice)
const CARRY = 0.22; // it stays this long past a syllable, so a line holds it open

const isLetter = (c) => (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c > 191;

export function createVoice(E) {
  const ctx = E.ctx;
  // a buzzy source with a gentle roll-off, like a small reed
  const n = 24, re = new Float32Array(n), im = new Float32Array(n);
  for (let k = 1; k < n; k++) im[k] = Math.pow(k, -1.15) * (k % 2 ? 1 : 0.75);
  const osc = ctx.createOscillator();
  osc.setPeriodicWave(ctx.createPeriodicWave(re, im));
  osc.frequency.value = BASE;
  const amp = ctx.createGain();
  amp.gain.value = 0;
  const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 5; f1.frequency.value = 600;
  const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 7; f2.frequency.value = 1600;
  const m1 = ctx.createGain(); m1.gain.value = 1.6;
  const m2 = ctx.createGain(); m2.gain.value = 1.0;
  const body = ctx.createBiquadFilter(); body.type = 'lowpass'; body.frequency.value = 900;
  const mb = ctx.createGain(); mb.gain.value = 0.18;
  const sum = ctx.createGain();
  osc.connect(amp);
  amp.connect(f1).connect(m1).connect(sum);
  amp.connect(f2).connect(m2).connect(sum);
  amp.connect(body).connect(mb).connect(sum);

  const noise = ctx.createBufferSource();
  noise.buffer = E.noise.white;
  noise.loop = true;
  const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 5000; nf.Q.value = 1.2;
  const ng = ctx.createGain(); ng.gain.value = 0;
  noise.connect(nf).connect(ng).connect(sum);

  // dry, or over the radio (band-limited, a little gritty, with a hiss while he talks)
  const dry = ctx.createGain(); dry.gain.value = 1;
  const radioBand = ctx.createBiquadFilter(); radioBand.type = 'bandpass'; radioBand.frequency.value = 1700; radioBand.Q.value = 0.8;
  const grit = ctx.createWaveShaper();
  const curve = new Float32Array(257);
  for (let i = 0; i < 257; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2); }
  grit.curve = curve;
  grit.oversample = '2x'; // no aliasing off the grit
  const radioG = ctx.createGain(); radioG.gain.value = 0;
  const crackle = ctx.createBufferSource();
  crackle.buffer = E.noise.pink;
  crackle.loop = true;
  // the hiss sits in the radio's band (2.2 to 6 kHz), not across the whole top end
  const crackleF = ctx.createBiquadFilter(); crackleF.type = 'highpass'; crackleF.frequency.value = 2200;
  const crackleL = ctx.createBiquadFilter(); crackleL.type = 'lowpass'; crackleL.frequency.value = 6000;
  const crackleG = ctx.createGain(); crackleG.gain.value = 0;
  sum.connect(dry).connect(E.bus.voice);
  sum.connect(radioBand).connect(grit).connect(radioG).connect(E.bus.voice);
  crackle.connect(crackleF).connect(crackleL).connect(crackleG).connect(radioG);
  const t0 = ctx.currentTime;
  osc.start(t0); noise.start(t0); crackle.start(t0);
  E.made += 21;

  // The radio's hiss, held open from t to until (each syllable over the radio moves
  // until on, so a line keeps it open and it closes a moment after the last word).
  function carry(t, until) {
    const g = crackleG.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(CRACKLE, t, 0.015);
    g.setTargetAtTime(0, until, 0.05);
  }
  function closeCarry(t) {
    crackleG.gain.cancelScheduledValues(t);
    crackleG.gain.setTargetAtTime(0, t, 0.03);
  }

  // ---------------------------------------------------------------- syllables

  let count = 0, skips = 0;

  function syllable(t, code, semis, len, peak) {
    const ch = String.fromCharCode(code);
    const v = VOWEL[ch] || 'e';
    const [F1, F2] = FORMANT[v];
    const f = BASE * Math.pow(2, semis / 12);
    osc.frequency.setTargetAtTime(f, t, 0.01);
    osc.frequency.setTargetAtTime(f * 0.96, t + len * 0.45, 0.05);
    f1.frequency.setTargetAtTime(F1, t, 0.012);
    f2.frequency.setTargetAtTime(F2, t, 0.012);
    amp.gain.setTargetAtTime(peak, t, 0.008);
    amp.gain.setTargetAtTime(0, t + len * 0.72, 0.016);
    if (HISS.has(ch)) {
      nf.frequency.setValueAtTime(ch === 'f' ? 3500 : 6000, t);
      ng.gain.setTargetAtTime(peak * 0.22, t - 0.004, 0.004);
      ng.gain.setTargetAtTime(0, t + 0.02, 0.006);
    } else if (CLICK.has(ch)) {
      nf.frequency.setValueAtTime(2800, t);
      ng.gain.setTargetAtTime(peak * 0.4, t - 0.002, 0.001);
      ng.gain.setTargetAtTime(0, t + 0.005, 0.003);
    }
    if (cur.radio) carry(t, t + len + CARRY);
    count++;
  }

  // A letter's own pitch (semitones), steady from word to word.
  const letterPitch = (code) => ((code * 7) % 5) - 2;

  // The pitch at character i of text: the letter's own, a gentle fall along the
  // line, and the end of the sentence (a rise for a question, a lift for "!").
  function pitchAt(text, i, code) {
    let s = letterPitch(code) * 0.8 - 1.6 * (i / Math.max(8, text.length));
    for (let j = i + 1; j < text.length && j < i + 5; j++) {
      const c = text.charCodeAt(j);
      if (c === 63) { s += 3.5 * (1 - (j - i) / 6); break; } // ?
      if (c === 33) { s += 2 * (1 - (j - i) / 6); break; } // !
      if (c === 46) { s -= 2 * (1 - (j - i) / 6); break; } // .
      if (c === 32) break;
    }
    return s;
  }

  // The name sung: each letter a bouncy note, a third higher than speech.
  const NAME_STEPS = [4, 7, 5, 9, 7, 11, 9, 12];
  function singName(t, name) {
    let k = 0, tt = t;
    for (let i = 0; i < name.length && k < 8; i++) {
      const code = name.toLowerCase().charCodeAt(i);
      if (!isLetter(code)) continue;
      if (name.length > 6 && i % 2 === 1) continue; // long names: every other letter
      syllable(tt, code, NAME_STEPS[k % NAME_STEPS.length] - 2, 0.085, VOL * 1.15);
      tt += 0.082;
      k++;
    }
    return tt;
  }

  // ---------------------------------------------------------------- the typewriter

  const WORD = 99; // "since" at the start of a word
  // The name as a whole word in the line (so "Al" is not found in "Shall"), or -1.
  function findName(text, name) {
    if (!name) return -1;
    const low = text.toLowerCase(), n = name.toLowerCase();
    for (let i = low.indexOf(n); i >= 0; i = low.indexOf(n, i + 1)) {
      const a = i > 0 ? low.charCodeAt(i - 1) : 32, b = i + n.length < low.length ? low.charCodeAt(i + n.length) : 32;
      if (!isLetter(a) && !isLetter(b)) return i;
    }
    return -1;
  }
  // One character of a line, shown at time t: now and then a syllable.
  // s: { since, last, busy, name, nameLen }
  function letter(text, i, t, s) {
    const raw = text.charCodeAt(i), code = raw | 32;
    if (s.name >= 0 && i === s.name) {
      s.busy = singName(Math.max(t, s.last + GAP), text.substr(i, s.nameLen));
      s.last = s.busy - GAP;
      s.since = 0;
      return;
    }
    if (s.name >= 0 && i > s.name && i < s.name + s.nameLen) return;
    if (!isLetter(raw < 128 ? code : 200)) { s.since = WORD; return; }
    const start = s.since === WORD;
    s.since = start ? 1 : s.since + 1;
    if (!start && s.since < 2) return; // a letter or two a syllable
    if (t < s.busy || t - s.last < GAP) return;
    syllable(t, code, pitchAt(text, i, code), SYL, VOL);
    s.last = t;
    s.since = 0;
  }

  const cur = { text: '', i: 0, since: WORD, last: 0, busy: 0, name: -1, nameLen: 0, radio: false, skipped: false, at: 0 };
  // The typewriter never shows more than this many characters a millisecond (fast
  // text is 0.11) plus a couple for rounding, however late its tick runs.
  const MAX_RATE = 0.13;

  // Called as the typewriter shows chars of text (kit.js 'dialogue:type').
  function type(speaker, text, chars, playerName) {
    const now = performance.now();
    if (text !== cur.text) {
      cur.text = text; cur.i = 0; cur.since = WORD;
      cur.name = findName(text, playerName);
      cur.nameLen = playerName ? playerName.length : 0;
      cur.skipped = false; cur.at = now;
    }
    if (chars < cur.i) { cur.i = 0; cur.skipped = false; cur.at = now; }
    // skipped (kit.js says so with 'dialogue:skip'; or, without it, far more of the
    // line at once than a late tick could carry): stop talking
    const jump = chars - cur.i > 2 + (now - cur.at) * MAX_RATE;
    cur.at = now;
    if (cur.skipped || (chars >= text.length && jump)) { if (!cur.skipped) { hush(); skips++; } cur.skipped = true; cur.i = chars; return; }
    const t = ctx.currentTime + 0.01;
    for (let i = cur.i; i < chars; i++) letter(text, i, t, cur);
    cur.i = chars;
  }
  // A key pressed mid-line: hush now; the rest of this line is shown silently.
  function skip() {
    hush();
    if (!cur.skipped) skips++;
    cur.skipped = true;
  }

  function hush() {
    const t = ctx.currentTime;
    amp.gain.cancelScheduledValues(t);
    amp.gain.setTargetAtTime(0, t, 0.02);
    ng.gain.cancelScheduledValues(t);
    ng.gain.setTargetAtTime(0, t, 0.01);
    closeCarry(t);
    cur.busy = 0;
  }

  // Over the radio or face to face, after delay seconds (the close of a radio talk
  // waits for the last syllable's tail; a talk opening before then takes over). The
  // radio's hiss is not switched on here: the syllables open it.
  function setRadio(on, delay = 0) {
    const now = ctx.currentTime, t = now + Math.max(0, delay);
    dry.gain.cancelScheduledValues(now);
    radioG.gain.cancelScheduledValues(now);
    dry.gain.setTargetAtTime(on ? 0 : 1, t, 0.02);
    radioG.gain.setTargetAtTime(on ? 1.1 : 0, t, 0.02);
    if (!on) closeCarry(now);
    cur.radio = !!on;
  }

  // A whole line babbled on its own at the typewriter's pace (offline checks).
  function say(text, t, playerName = '', rate = 55) {
    const st = { since: WORD, last: -1, busy: 0, name: findName(text, playerName), nameLen: playerName.length };
    for (let i = 0; i < text.length; i++) letter(text, i, t + i / rate, st);
    return t + text.length / rate + 0.2;
  }

  return { type, hush, skip, setRadio, say, get syllables() { return count; }, get skips() { return skips; }, get radio() { return cur.radio; } };
}
