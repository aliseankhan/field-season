// The music bed: a light, sparse tune in F major, made up as it goes. Each phrase
// is eight bars (a two-bar motif, the motif moved, something new, the motif coming
// home to the root) on plucked tines or marimba over soft pads and a round bass.
// A set is two to four phrases, then the music rests and lets the island talk.
// Three moods follow the clock: a calm morning, a sleepy midday (slower, lower,
// sparser, long pads) and a warm evening (a breathy flute answers the tines); the
// title and the summary have their own. Stings mark a catch, a new species, a
// stamp, a request, a new survey day and the end of the day.

import { pluck, pad, tone, bell, rand, between, midiHz } from './synth.js';

const ROOT = 53; // F3
const PENTA = [0, 2, 4, 7, 9]; // F G A C D
const CHORDS = {
  I: [0, 4, 7, 11], ii: [2, 5, 9, 12], iii: [4, 7, 11, 14], IV: [5, 9, 12, 16],
  Vsus: [7, 12, 14, 17], vi: [9, 12, 16, 19], I6: [0, 4, 7, 9],
};
const RHYTHMS = [
  [1, 0, 0, 1, 0, 0, 1, 0], [1, 0, 1, 0, 1, 0, 0, 0], [1, 0, 0, 0, 1, 0, 1, 0], [0, 0, 1, 0, 1, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 1, 1], [1, 1, 0, 0, 1, 0, 0, 0], [1, 0, 0, 1, 0, 1, 0, 0], [0, 0, 1, 1, 0, 0, 1, 0],
];
const SPARSE = [[1, 0, 0, 0, 0, 0, 0, 0], [1, 0, 0, 0, 1, 0, 0, 0], [0, 0, 1, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0, 1, 0]];

export const MOODS = {
  morning: { bpm: 84, prog: ['I', 'vi', 'IV', 'Vsus'], bars: 2, lead: 'kalimba', lo: 72, hi: 88, density: 0.62, pad: 0.45, cutoff: 1300, bass: 2, arp: 0.5, rest: [14, 30], set: [2, 3] },
  midday: { bpm: 66, prog: ['I', 'IV'], bars: 4, lead: 'marimba', lo: 64, hi: 79, density: 0.34, pad: 0.75, cutoff: 780, bass: 1, arp: 0, sparse: true, rest: [22, 45], set: [2, 2] },
  evening: { bpm: 74, prog: ['IV', 'iii', 'ii', 'Vsus'], bars: 2, lead: 'kalimba', answer: 'flute', lo: 69, hi: 84, density: 0.48, pad: 0.6, cutoff: 1000, bass: 2, arp: 0.25, rest: [16, 34], set: [2, 3] },
  title: { bpm: 80, prog: ['I', 'vi', 'IV', 'Vsus'], bars: 2, lead: 'kalimba', lo: 72, hi: 86, density: 0.5, pad: 0.5, cutoff: 1200, bass: 2, arp: 0.4, rest: [6, 12], set: [3, 4] },
  summary: { bpm: 70, prog: ['IV', 'I', 'ii', 'Vsus'], bars: 2, lead: 'kalimba', answer: 'flute', lo: 69, hi: 84, density: 0.42, pad: 0.7, cutoff: 950, bass: 1, arp: 0.3, rest: [8, 16], set: [3, 4] },
};

const pitchOf = (deg) => ROOT + 12 * Math.floor(deg / 5) + PENTA[((deg % 5) + 5) % 5];
function degOf(midi) { // the nearest pentatonic degree
  let best = 0, bd = 99;
  for (let d = 0; d < 30; d++) { const e = Math.abs(pitchOf(d) - midi); if (e < bd) { bd = e; best = d; } }
  return best;
}
function snapToChord(midi, chord) {
  let best = midi, bd = 99;
  for (let o = -12; o <= 24; o += 12) for (const c of chord) {
    const m = ROOT + c + o + 12;
    const e = Math.abs(m - midi);
    if (e < bd) { bd = e; best = m; }
  }
  return best;
}

// A two-bar motif: [{ step (0..15), deg }]
function motif(M, startDeg) {
  const cells = M.sparse ? SPARSE : RHYTHMS;
  const out = [];
  let deg = startDeg;
  for (let bar = 0; bar < 2; bar++) {
    const cell = cells[Math.floor(rand() * cells.length)];
    for (let s = 0; s < 8; s++) {
      if (!cell[s]) continue;
      if (out.length && rand() > 0.35 + M.density) continue;
      out.push({ step: bar * 8 + s, deg });
      const r = rand();
      deg += r < 0.15 ? -2 : r < 0.42 ? -1 : r < 0.52 ? 0 : r < 0.85 ? 1 : 2;
      const lo = degOf(M.lo), hi = degOf(M.hi);
      if (deg < lo) deg = lo + 1; else if (deg > hi) deg = hi - 1;
    }
  }
  return out;
}

// Eight bars of notes: [{ step (0..63), midi, v, len (steps), kind }]
function phrase(M) {
  const lo = degOf(M.lo), hi = degOf(M.hi);
  const mid = Math.round((lo + hi) / 2);
  const a = motif(M, mid + Math.floor(rand() * 3) - 1);
  const b = motif(M, mid + Math.floor(rand() * 5) - 2);
  const shift = rand() < 0.5 ? 1 : -1;
  const notes = [];
  const chordAt = (step) => CHORDS[M.prog[Math.floor(step / 8 / M.bars) % M.prog.length]];
  const put = (list, offset, dShift, home) => {
    list.forEach((n, i) => {
      const step = n.step + offset;
      let midi = pitchOf(Math.max(lo, Math.min(hi, n.deg + dShift)));
      if (step % 4 === 0) midi = snapToChord(midi, chordAt(step));
      if (home && i === list.length - 1) midi = snapToChord(midi, CHORDS.I);
      notes.push({ step, midi, v: (step % 4 === 0 ? 0.62 : 0.5) + 0.12 * rand(), kind: M.lead });
    });
  };
  put(a, 0, 0, false);
  put(a, 16, shift, false);
  put(b, 32, 0, false);
  put(a, 48, 0, true);
  notes.sort((x, y) => x.step - y.step);
  for (let i = 0; i < notes.length; i++) {
    const next = i + 1 < notes.length ? notes[i + 1].step : 64;
    notes[i].len = Math.min(8, Math.max(1, next - notes[i].step));
  }
  // the evening's flute answers in the gaps of the motif's return
  if (M.answer) {
    for (const bar of [3, 7]) {
      if (rand() < 0.55) {
        const chord = chordAt(bar * 8);
        notes.push({ step: bar * 8 + 2, midi: ROOT + 12 + chord[1 + Math.floor(rand() * 2)], v: 0.5, len: 6, kind: M.answer });
      }
    }
  }
  return notes;
}

const AHEAD = 1; // seconds of music scheduled ahead

export function createMusic(E) {
  const ctx = E.ctx, out = E.bus.music;
  const S = {
    mood: 'title', want: 'title', playing: false, restUntil: ctx.currentTime + 1.5,
    phrase: null, step: 0, next: 0, stepDur: 0.3, M: MOODS.title, setLeft: 0, notesAt: 0,
    phrases: 0, notes: 0,
  };

  function startSet() {
    S.mood = S.want;
    S.M = MOODS[S.mood] || MOODS.morning;
    S.stepDur = 60 / S.M.bpm / 2;
    E.setEcho(S.stepDur * 3);
    S.setLeft = S.M.set[0] + Math.floor(rand() * (S.M.set[1] - S.M.set[0] + 1));
    S.playing = true;
    S.next = Math.max(ctx.currentTime + 0.1, S.next);
    newPhrase();
  }
  function newPhrase() {
    S.phrase = phrase(S.M);
    S.step = 0;
    S.notesAt = 0;
    S.phrases++;
  }

  // Schedules one eighth-note step at time t.
  function playStep(t) {
    const M = S.M, st = S.step;
    const barDur = S.stepDur * 8;
    // pads and bass on the chord changes
    if (st % (8 * M.bars) === 0) {
      const chord = CHORDS[M.prog[Math.floor(st / 8 / M.bars) % M.prog.length]];
      const dur = barDur * M.bars + 0.4;
      if (E.claim('music', t, dur)) {
        pad(E, out, t, { notes: chord.map((c) => midiHz(ROOT + c)), dur, v: M.pad, cutoff: M.cutoff, a: Math.min(1.4, dur * 0.3), r: Math.min(1.8, dur * 0.35) });
      }
      if (M.arp > 0 && rand() < M.arp && E.claim('music', t, barDur)) {
        for (let k = 0; k < 4; k++) pluck(E, out, t + k * S.stepDur, { f: midiHz(ROOT + 12 + chord[k % chord.length]), v: 0.22, kind: 'marimba', d: 0.7 });
      }
    }
    if (st % 8 === 0 && M.bass) {
      const chord = CHORDS[M.prog[Math.floor(st / 8 / M.bars) % M.prog.length]];
      const f = midiHz(ROOT - 12 + chord[0]);
      if (E.claim('music', t, barDur)) {
        tone(E, out, t, { f, a: 0.02, hold: barDur * (M.bass > 1 ? 0.3 : 0.6), d: barDur * 0.35, peak: 0.11 });
        tone(E, out, t, { type: 'triangle', f: f * 2, a: 0.01, d: 0.25, peak: 0.02 });
      }
      if (M.bass > 1 && E.claim('music', t + barDur / 2, barDur / 2)) {
        tone(E, out, t + barDur / 2, { f: midiHz(ROOT - 12 + chord[2] - 12), a: 0.02, hold: barDur * 0.1, d: barDur * 0.3, peak: 0.08 });
      }
    }
    // the tune
    const P = S.phrase;
    while (S.notesAt < P.length && P[S.notesAt].step < st) S.notesAt++;
    for (let i = S.notesAt; i < P.length && P[i].step === st; i++) {
      const n = P[i];
      const len = n.len * S.stepDur;
      if (!E.claim('music', t, Math.min(1.6, len + 0.8))) continue;
      const swing = st % 2 ? S.stepDur * 0.08 : 0;
      pluck(E, out, t + swing, { f: midiHz(n.midi), v: n.v, kind: n.kind, d: Math.min(1.6, 0.6 + len * 0.6) });
      S.notes++;
    }
  }

  // Keeps the music scheduled about a second ahead (it need not react at once, and a
  // stall in the page then never makes a note late). want: the mood wanted now.
  function update(want, now = ctx.currentTime) {
    S.want = want;
    if (S.next < now - 0.2) S.next = now + 0.05; // back from a hidden tab: no pile-up
    if (!S.playing) {
      if (now >= S.restUntil) { S.next = now + 0.05; startSet(); }
      return;
    }
    while (S.playing && S.next < now + AHEAD) {
      playStep(S.next);
      S.next += S.stepDur;
      S.step++;
      // Start pressed: the title's tune carries straight on into the morning's at the
      // next bar line, over the title's last chord still ringing
      if (S.mood === 'title' && S.want !== 'title' && S.step % 8 === 0) { startSet(); continue; }
      if (S.step >= 64) {
        S.setLeft--;
        // a mood change waits for the end of a phrase, then rests a moment first
        if (S.setLeft <= 0 || S.want !== S.mood) {
          S.playing = false;
          const [a, b] = S.M.rest;
          S.restUntil = S.next + (S.want !== S.mood ? 3 : between(a, b));
        } else {
          newPhrase();
        }
      }
    }
  }

  // Stop and rest (the end of the day's sting takes over; what is already scheduled,
  // under a second, plays out under the sting's duck).
  function interrupt(seconds) {
    S.playing = false;
    S.restUntil = ctx.currentTime + seconds;
  }

  // ---------------------------------------------------------------- stings

  const st = E.bus.stings;
  function sting(kind, t = ctx.currentTime + 0.02) {
    if (!E.claim('stings', t, 2)) return 0;
    const K = (m, v, dt, kind2 = 'kalimba', d = 1.1) => pluck(E, st, t + dt, { f: midiHz(m), v, kind: kind2, d });
    if (kind === 'catch') {
      [77, 81, 84, 89].forEach((m, i) => K(m, 0.6, i * 0.075));
      bell(E, st, t + 0.3, { f: midiHz(101), peak: 0.03, d: 0.8, partials: 2 });
      return 1.2;
    }
    if (kind === 'species') {
      [77, 81, 84, 86, 89, 93].forEach((m, i) => K(m, 0.62, i * 0.085));
      pad(E, st, t, { notes: [65, 69, 72, 76].map(midiHz), dur: 1.8, v: 0.6, cutoff: 1400, a: 0.3, r: 1.0 });
      bell(E, st, t + 0.5, { f: midiHz(96), peak: 0.05, d: 1.4, partials: 3 });
      bell(E, st, t + 0.62, { f: midiHz(101), peak: 0.04, d: 1.4, partials: 3 });
      return 2;
    }
    if (kind === 'stamp') {
      K(84, 0.55, 0, 'marimba', 0.6);
      K(89, 0.65, 0.13, 'marimba', 0.9);
      return 1;
    }
    if (kind === 'request') {
      [81, 84, 89].forEach((m, i) => bell(E, st, t + i * 0.1, { f: midiHz(m), peak: 0.085, d: 1, partials: 3 }));
      return 1.2;
    }
    if (kind === 'morning') { // a new survey day: a bright little wake-up
      [72, 77, 81, 84].forEach((m, i) => bell(E, st, t + i * 0.12, { f: midiHz(m + 12), peak: 0.04, d: 1.2, partials: 3 }));
      pad(E, st, t, { notes: [53, 60, 65, 69].map(midiHz), dur: 2.2, v: 0.5, cutoff: 1200, a: 0.4, r: 1.2 });
      return 2.2;
    }
    if (kind === 'day') { // a warm cadence: IV then home
      pad(E, st, t, { notes: [58, 62, 65, 69].map(midiHz), dur: 1.5, v: 0.8, cutoff: 1100, a: 0.25, r: 0.8 });
      [70, 74, 77, 81].forEach((m, i) => K(m, 0.5, i * 0.14));
      pad(E, st, t + 1.3, { notes: [53, 60, 65, 69, 72].map(midiHz), dur: 2.6, v: 0.8, cutoff: 1100, a: 0.3, r: 1.8 });
      [65, 69, 72, 77, 81].forEach((m, i) => K(m, 0.52, 1.3 + i * 0.15, 'kalimba', 1.6));
      bell(E, st, t + 2.2, { f: midiHz(89), peak: 0.05, d: 2, partials: 3 });
      return 4;
    }
    return 0;
  }

  return { update, sting, interrupt, state: S };
}
