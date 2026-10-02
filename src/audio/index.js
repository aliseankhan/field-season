// The sound system (main.js OPTIONAL_SYSTEMS, stored as game.audio). One
// AudioContext, made on the first click or key press (browsers wait for one) and
// suspended while the page is hidden; everything is synthesised live (engine.js,
// synth.js): the ambience (ambience.js), the music bed and its stings (music.js),
// the effects (sfx.js) and James's babble (voice.js). Cues come from game.events,
// and a few things are followed each frame (footsteps, the snug ring, the loop
// settling, a croc sliding into the water); see wire() below for the list.
//
// Settings: master, music, ambience, effects (with the jingles) and James's voice
// volumes (0..1) and mute, kept in state.settings.audio and saved under a key of
// their own (with try/catch; not in a run with the debug flags that leave the save
// alone). The UI can import this file:
//
//   import { audio } from '../audio/index.js'
//   audio.controls            [{ key, label }] for the five sliders
//   audio.getVolume(key), audio.setVolume(key, v), audio.isMuted(), audio.setMuted(on)
//   audio.preview(key)        a short sound on that bus (while a slider moves)
//   audio.cue(name, ...args)  play an effect from sfx.js by name; returns what the cue
//                             returns (a looping cue's handle, false when dropped, null
//                             without a running context)
//   audio.unlock()            make or resume the context (call from a gesture)
//
// ?audiolog=1 records every cue with its time into the diag JSON (modules.audio)
// and into <pre id="audio-log">, and makes the context at once, so a headless run
// can check the wiring. ?noaudio=1 skips the system.

import { events } from '../core/events.js';
import { FLAGS } from '../config.js';
import { writeDiag } from '../debug.js';
import { state, GAME_FLAGS } from '../game/state.js';
import { CATCH } from '../catch/tuning.js';
import { createEngine, DEFAULTS, BUS_KEYS } from './engine.js';
import * as sfx from './sfx.js';
import { createVoice } from './voice.js';
import { createMusic } from './music.js';
import { createAmbience, bird } from './ambience.js';
import { createPlace } from './place.js';
import { rand, pluck, midiHz } from './synth.js';

const KEY = 'stroudlab.fieldseason.audio.v1';
const LOG = /[?&]audiolog(=(1|true|yes))?(&|$)/.test(location.search);
const LABELS = { master: 'Master volume', music: 'Music', ambience: 'Ambience', effects: 'Sound effects', voice: "James's voice" };

// ---------------------------------------------------------------- settings

const settings = { ...DEFAULTS };
function readSaved() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) || 'null');
    if (raw && raw.v === 1) adopt(raw);
  } catch (e) { /* defaults */ }
}
// Takes the good values of a saved or passed-on set; anything missing or damaged
// (not a number from 0 to 1, a mute that is not true or false) keeps its default.
function adopt(raw) {
  for (const k of BUS_KEYS) {
    const v = raw[k];
    settings[k] = typeof v === 'number' && v >= 0 && v <= 1 ? v : DEFAULTS[k];
  }
  settings.muted = typeof raw.muted === 'boolean' ? raw.muted : DEFAULTS.muted;
}
function save() {
  if (GAME_FLAGS.nosave) return;
  try { window.localStorage.setItem(KEY, JSON.stringify({ v: 1, ...settings })); } catch (e) { /* not saved */ }
}
readSaved();

let engine = null; // the engine once the context exists
let sys = null; // the running system, for the API

function changed() {
  if (engine) engine.apply(settings);
  if (state.settings) state.settings.audio = settings;
  save();
  events.emit('audio:settings', settings);
}

export const audio = {
  controls: BUS_KEYS.map((key) => ({ key, label: LABELS[key] })),
  get settings() { return settings; },
  getVolume: (key) => settings[key] ?? 0,
  setVolume(key, v) {
    if (!BUS_KEYS.includes(key)) return;
    const n = Math.min(1, Math.max(0, Number(v) || 0));
    if (n === settings[key]) return;
    settings[key] = n;
    changed();
  },
  isMuted: () => settings.muted,
  setMuted(on) { settings.muted = !!on; changed(); },
  toggleMute() { settings.muted = !settings.muted; changed(); return settings.muted; },
  reset() { Object.assign(settings, DEFAULTS); changed(); },
  preview(key) { if (sys) sys.preview(key); },
  cue(name, ...args) { return sys ? sys.cue(name, ...args) : null; }, // what the cue returns (a loop's handle)
  unlock() { if (sys) sys.unlock(); },
  get running() { return !!(engine && engine.ctx.state === 'running'); },
};
export default audio;
export const getAudio = () => audio;

// ---------------------------------------------------------------- the system

// the phases whose hour is the day's clock (the intro sets the set-up day's); the
// title's is its sky's
const CLOCK_PHASES = new Set(['intro', 'setup', 'survey', 'summary']);
const CARDS = new Set(['bag', 'ruler', 'paint', 'backpack', 'perch']);
const TAPS = { flag: 'wood', station: 'soft', read: 'button', gps: 'button' };
const TOAST_KIND = { gold: 'gold', warn: 'warn', info: 'info', snap: 'warn' };
const SNUG = CATCH.timing;

export function build(game) {
  // the notebook of settings: state.js may have loaded an older copy
  if (state.settings) {
    if (state.settings.audio && state.settings.audio !== settings && !hasOwnSave()) adopt(state.settings.audio);
    state.settings.audio = settings;
  }

  let ctx = null, E = null, voice = null, amb = null, music = null, rustle = null;
  let place = null;
  try { place = createPlace(game); } catch (e) { console.warn('audio: no place fields', e); }
  const P = { water: 30, canopy: 0, surface: 0, grass: 0 };
  const env = { hours: 9.5, water: 30, canopy: 0, level: 1 };

  // ---------------------------------------------------------------- the log

  const log = LOG ? { list: [], counts: {}, t0: performance.now() } : null;
  function note(name, detail) {
    if (!log) return;
    log.counts[name] = (log.counts[name] || 0) + 1;
    if (log.list.length < 800 && name.slice(0, 4) !== 'step' && name !== 'tick' && name !== 'voice') {
      log.list.push([+(game.time || 0).toFixed(2), name, detail == null ? '' : detail]);
    }
  }
  // Logs a cue and gives its start time, or -1 when there is no running context.
  function play(name, detail) {
    note(name, detail);
    return E && ctx.state === 'running' ? ctx.currentTime + 0.012 : -1;
  }
  // Is a spatial cue at (x, z) loud enough to hear (sfx.js's own test)? A cue that is
  // not is neither throttled nor logged, so a far one never uses up a near one's turn.
  const WH = { gain: 0, pan: 0, d: 0 };
  const heard = (x, z, range, min) => !!E && E.where(x, z, range, WH).gain > min;

  // ---------------------------------------------------------------- the context

  function init() {
    E = createEngine(ctx);
    engine = E;
    E.setVolumesNow(settings);
    voice = createVoice(E);
    amb = createAmbience(E);
    music = createMusic(E);
    // woken on the title: its tune starts at once (Start then carries it into the morning)
    if (moodNow() === 'title') music.state.restUntil = ctx.currentTime + 0.25;
    // the grass rustle round the feet: one noise band, swelled at each step
    const src = ctx.createBufferSource();
    src.buffer = E.noise.white; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 0.9;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(bp).connect(g).connect(E.bus.effects);
    src.start();
    rustle = { g, bp };
    note('context', ctx.state + ' ' + ctx.sampleRate + ' Hz');
  }
  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { console.warn('audio: no context', e); return; }
      try { init(); } catch (e) { console.error(e); ctx = null; E = null; return; }
    }
    if (ctx.state === 'suspended' && document.visibilityState === 'visible') ctx.resume().catch(() => {});
  }
  const gesture = () => unlock();
  window.addEventListener('pointerdown', gesture, true);
  window.addEventListener('keydown', gesture, true);
  window.addEventListener('touchend', gesture, true);
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.visibilityState === 'hidden') ctx.suspend().catch(() => {});
    else ctx.resume().catch(() => {});
  });
  if (LOG) unlock();

  // ---------------------------------------------------------------- the events

  const on = (name, fn) => events.on(name, fn);
  let mg = null; // the mini-game open now
  let toastT = -1, fleeT = -1, hideT = -1, showT = -1, hoverT = -1;

  on('phase:change', (e) => {
    note('phase', e.phase);
    // a new survey day's first light
    if (e.phase === 'survey' && e.previous !== 'boot') {
      const t = play('sting', 'morning');
      if (t >= 0) { music.sting('morning', t + 0.4); duckFor(2.2, 0.4); }
    }
  });
  on('day:end', () => {
    const t = play('sting', 'day');
    if (t < 0) return;
    music.interrupt(6);
    E.duck('sting', 0.2);
    stingUntil = t + music.sting('day', t);
  });

  let talkOpen = false; // a dialogue is up (kit.js shows one at a time)
  on('dialogue:open', (e) => {
    const speaker = e && e.speaker ? String(e.speaker) : '';
    const radio = /radio/i.test(speaker);
    talkOpen = true;
    const t = play('dialogue', speaker || 'narration');
    if (t < 0) return;
    E.duck('dialogue', 0.45);
    voice.setRadio(radio);
    if (radio) sfx.radio(E, t, true);
  });
  on('dialogue:close', (e) => {
    talkOpen = false;
    if (!E) return;
    E.duck('dialogue', 1);
    voice.hush();
    // the radio goes off with its closing squelch (a radio talk queued straight after
    // turns it back on when it opens, 60 ms later): it must not outlive the talk
    if (voice.radio) {
      const t = play('radio', 'close');
      if (t >= 0) sfx.radio(E, t, false);
      voice.setRadio(false, 0.12);
    }
  });
  // a key pressed mid-line shows the rest at once: James stops there
  on('dialogue:skip', () => { note('skip'); if (voice) voice.skip(); });
  // the typewriter, from kit.js: (speaker, text, chars shown)
  on('dialogue:type', (speaker, text, chars) => {
    if (!speaker || typeof text !== 'string') return;
    if (log && chars <= 2) note('voice', speaker);
    if (E && ctx.state === 'running') voice.type(speaker, text, chars, state.playerName || '');
  });

  on('minigame:start', (e) => {
    const name = e && e.name;
    mg = name;
    if (name === 'snug') {
      if (E) E.duck('snug', 0.3);
      snug.on = false;
      return;
    }
    if (E) E.duck('minigame', 0.4);
    if (name === 'bag') { const t = play('bag'); if (t >= 0) sfx.bagRustle(E, t); }
    else if (!CARDS.has(name)) { const t = play('card', name); if (t >= 0) sfx.bloop(E, t, true, 0.6); }
  });
  on('minigame:end', (e) => {
    const name = e && e.name;
    if (mg === name) mg = null;
    if (name === 'snug') {
      if (E) E.duck('snug', 1);
      const q = Number(e && e.quality) || 0;
      const t = play(e.success ? 'pop' : 'boing', e.success ? +q.toFixed(2) : 'miss');
      if (t < 0) return;
      if (e.success) sfx.pop(E, t, q >= 1 - SNUG.perfect);
      else sfx.boing(E, t);
      return;
    }
    if (E) E.duck('minigame', 1);
    // a success is heard in what follows (the flag, the zip tie, the beep, a toast);
    // a miss or running out of time gets a gentle fall
    if (CARDS.has(name) || !e || e.success) return;
    const t = play('result', name + ' miss');
    if (t >= 0) sfx.chime(E, t, 'warn');
  });

  on('panel:open', (e) => {
    const id = e && e.id;
    if (E) E.duck('panel', id === 'summary' ? 0.8 : 0.6);
    const t = play('panel', id);
    if (t < 0) return;
    if (id === 'notebook') sfx.bookOpen(E, t, true);
    else if (id === 'map') sfx.mapRustle(E, t);
    else if (id !== 'summary') sfx.bloop(E, t, false, 0.8);
  });
  on('panel:close', (e) => {
    const id = e && e.id;
    if (E) E.duck('panel', 1);
    const t = play('panel close', id);
    if (t < 0) return;
    if (id === 'notebook') sfx.bookOpen(E, t, false);
    else if (id === 'map') sfx.mapRustle(E, t);
    else if (id === 'pause') sfx.bloop(E, t, true, 0.8);
  });
  on('notebook:page', (id) => { const t = play('page', id); if (t >= 0) sfx.pageTurn(E, t); });

  // kit.js toasts: (tone, icon). A toast's chime waits a frame or so (TOAST_HOLD):
  // a toast that comes with its own sound (a stamp, a sting, the release, a flag) is
  // often raised a moment before that sound, which then quiets it; a burst from one
  // moment chimes once.
  const TOAST_HOLD = 60; // ms
  let quietUntil = 0;
  const toast = { tone: null, at: 0 };
  const quietToasts = () => { quietUntil = performance.now() + 500; toast.tone = null; };
  on('ui:toast', (tone, ic) => {
    const now = performance.now();
    if (now - toastT < 180 || now < quietUntil || ic === 'star') return; // a task's star comes with its stamp
    toastT = now;
    toast.tone = tone || 'good'; toast.at = now;
  });
  function toastChime() { // from update(), once the hold is over
    if (!toast.tone || performance.now() - toast.at < TOAST_HOLD) return;
    const tone = toast.tone;
    toast.tone = null;
    if (performance.now() < quietUntil) return;
    const t = play('toast', tone);
    if (t >= 0) sfx.chime(E, t, TOAST_KIND[tone] || 'good');
  }
  // Stamps: the first of a burst thunks with its little sting and the rest of the
  // burst only thunk, softly; a stamp that lands on a catch's or a request's own sting
  // thunks without a sting of its own.
  let stampT = -1e9, rewardT = -1e9;
  on('ui:stamp', (e) => {
    quietToasts();
    const now = performance.now();
    const burst = now - stampT < 2300, afterSting = now - rewardT < 1600;
    stampT = now;
    const t = play('stamp', (e && e.label) + (burst ? ' soft' : afterSting ? ' plain' : ''));
    if (t < 0) return;
    sfx.stampThunk(E, t, burst);
    if (burst || afterSting) return;
    rewardT = now;
    music.sting('stamp', t + 0.08);
    duckFor(1.2, 0.5);
  });
  // Reward stings from one moment play one after the other, never on top: the catch's
  // first, then the request's, which waits for update() so the frame's catch (emitted
  // just after it) goes ahead.
  let stingFree = 0, requestDue = false;
  function rewardAt(t, lead, gap) {
    const s = Math.max(t + lead, stingFree);
    stingFree = s + gap;
    return s;
  }
  on('request:done', () => {
    quietToasts();
    rewardT = performance.now();
    requestDue = true;
  });
  function requestSting() { // from update(), after the frame's events
    if (!requestDue) return;
    requestDue = false;
    const t = play('sting', 'request');
    if (t < 0) return;
    const s = rewardAt(t, 0.3, 1);
    music.sting('request', s);
    duckFor(s - t + 1.2, 0.5);
  }

  on('lizard:caught', (e) => {
    quietToasts();
    rewardT = performance.now();
    const first = !!(e && e.bonus && e.bonus.first);
    const t = play('sting', first ? 'species' : 'catch');
    if (t < 0) return;
    const s = rewardAt(t, 0.15, first ? 1.3 : 1);
    duckFor(s - t + (first ? 2.25 : 1.25), 0.35);
    music.sting(first ? 'species' : 'catch', s);
  });
  on('practice:done', () => {
    quietToasts();
    rewardT = performance.now();
    const t = play('release', 'practice');
    if (t < 0) return;
    sfx.releaseChirp(E, t);
    music.sting('catch', t + 0.3);
    duckFor(1.4, 0.35);
  });
  on('lizard:released', () => { quietToasts(); const t = play('release'); if (t >= 0) sfx.releaseChirp(E, t); });
  on('lizard:escaped', (e) => {
    const lz = e && e.lizard;
    const t = play('scurry', 'escaped');
    if (t >= 0 && lz && lz.pos) sfx.scurry(E, t + 0.2, lz.pos.x, lz.pos.z);
  });
  // the catch cards, from release.js: (card, value)
  on('card:act', (card, value) => {
    const t = play(card, value);
    if (t < 0) return;
    if (card === 'ruler') sfx.rulerClick(E, t, value >= 0.75);
    else if (card === 'paint') sfx.paintDab(E, t);
    else if (card === 'pack') { sfx.packClick(E, t); quietToasts(); }
    else if (card === 'wriggle') sfx.wriggle(E, t);
    else if (card === 'perch') sfx.pencil(E, t, value !== false);
  });

  const posOf = (lz) => lz && (lz.pos || lz.home || null);
  on('lizard:flee', (lz) => {
    const now = game.time;
    const p = posOf(lz);
    if (!p || now - fleeT < 0.15 || !heard(p.x, p.z, 14, 0.02)) return;
    fleeT = now;
    const t = play('scurry', lz.species);
    if (t >= 0) sfx.scurry(E, t, p.x, p.z);
  });
  on('lizard:hidden', (lz, where) => {
    const now = game.time;
    if (!where || now - hideT < 0.3 || !heard(where.x, where.z, 12, 0.02)) return;
    hideT = now;
    const t = play('leaves', lz && lz.species);
    if (t >= 0) sfx.leafRustle(E, t, where.x, where.z);
  });
  // a display: a soft cue for a dewlap close by, or any display by the lizard the
  // loop is on (the moment to click), never a patter from every lizard round about;
  // one too far off to hear neither plays nor uses up the next one's turn
  const aimedAt = (lz) => { const N = game.catching && game.catching.loopPole; return !!(N && N.aiming && N.lock === lz); };
  on('lizard:display', (lz, kind) => {
    const target = aimedAt(lz);
    const p = posOf(lz);
    if (!p || (!target && kind !== 'dewlap')) return;
    if (!target && (!heard(p.x, p.z, sfx.DISPLAY_RANGE, 0.05) || game.time - showT < 2.5)) return;
    if (!target) showT = game.time;
    const t = play('display', target ? kind + ' target' : kind);
    if (t >= 0) sfx.display(E, t, kind, p.x, p.z, target);
  });

  // A lizard has noticed the player: the nearest one in front within about 8 m (9 when
  // creeping) squeaks, the cue to freeze; one a second and a half at most (a second
  // when creeping). The lizard the loop is on always may. Picked in update(), so a
  // few alerts in one frame give the nearest.
  const notice = { lz: null, d: 0, x: 0, z: 0, target: false, t: -9 };
  on('lizard:alert', (lz) => {
    const p = posOf(lz), pl = game.player;
    if (!E || !p || !pl) return;
    const dx = p.x - pl.position.x, dz = p.z - pl.position.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const target = aimedAt(lz);
    if (!target) {
      if (d > (pl.mode === 'creep' ? 9 : 8)) return;
      // in front: of the view (the camera's forward on the ground) or of the player
      const inv = 1 / Math.max(0.05, d);
      const view = (dx * E.ear.rz - dz * E.ear.rx) * inv;
      const face = -(Math.sin(pl.heading) * dx + Math.cos(pl.heading) * dz) * inv;
      if (Math.max(view, face) < 0.35) return;
    }
    if (notice.lz && !target && (notice.target || d >= notice.d)) return;
    notice.lz = lz; notice.d = d; notice.x = p.x; notice.z = p.z; notice.target = target;
  });
  function noticeNow(pl) { // from update()
    if (!notice.lz) return;
    const lz = notice.lz;
    notice.lz = null;
    const gap = notice.target ? 0.6 : pl.mode === 'creep' ? 1 : 1.5;
    if (game.time - notice.t < gap) return;
    notice.t = game.time;
    const t = play('notice', lz.species);
    if (t >= 0) sfx.notice(E, t, notice.x, notice.z);
  }
  // the player's feet in the leaves or the shallows, as fx.js puffs them out
  let brushT = -1;
  on('fx:brush', (x, z, k) => {
    const now = game.time;
    if (now - brushT < 0.2) return;
    brushT = now;
    const t = play('brush');
    if (t >= 0) sfx.brush(E, t, x, z, k);
  });
  on('fx:splash', (x, z, k) => { const t = play('paddle'); if (t >= 0) sfx.paddle(E, t, x, z, k); });
  // a basilisk's feet on the water (src/wildlife/basilisk.js), one burst every 0.16 s
  on('basilisk:patter', (x, z) => { if (!heard(x, z, 18, 0.02)) return; const t = play('patter'); if (t >= 0) sfx.patter(E, t, x, z); });
  on('pole:aim', (e) => { const up = !!(e && e.on); const t = play('swish', up ? 'up' : 'down'); if (t >= 0) sfx.swish(E, t, up); });
  on('pole:whiff', () => { const t = play('whiff'); if (t >= 0) sfx.whiff(E, t); });
  on('pole:bop', () => { const t = play('boing', 'bop'); if (t >= 0) sfx.boing(E, t, true); });
  on('pole:target', (e) => { if (e && !e.inReach) { const t = play('glide', 'far'); if (t >= 0) sfx.glide(E, t, 0.8); } });
  on('loop:fray', () => { const t = play('fray'); if (t >= 0) sfx.fray(E, t); });
  // (the snap heard clearly: its toast keeps quiet and the music dips under it)
  on('loop:snap', () => { quietToasts(); const t = play('flossSnap'); if (t >= 0) { sfx.flossSnap(E, t); duckFor(0.7, 0.5); } });
  on('loop:tied', () => { const t = play('twang', 'retie'); if (t >= 0) sfx.twang(E, t); });
  on('pole:creak', (e) => { const t = play('creak', e && e.kind); if (t >= 0) sfx.creak(E, t); });
  on('pole:break', (e) => { const t = play('crack', e && e.kind); if (t >= 0) sfx.crack(E, t); });

  on('croc:warn', (e) => { const t = play('hiss', e && e.croc ? e.croc.id : null); if (t >= 0) sfx.hiss(E, t, e.x, e.z); });
  on('croc:snap', (e) => {
    quietToasts(); // the SNAP stands alone: its toast does not chime
    const t = play('snap', e && e.croc ? e.croc.id : null);
    if (t < 0) return;
    sfx.snap(E, t, e.x, e.z);
    duckFor(1.5, 0.3);
  });

  // a flag or logger put out by the player (not the whole grid at once, as ?skipsetup does)
  let placedT = -1;
  const placed = (e) => {
    const now = game.time;
    if (!e || now - placedT < 0.25 || Math.hypot(e.x - game.player.position.x, e.z - game.player.position.z) > 8) return false;
    placedT = now;
    return true;
  };
  on('flag:placed', (e) => { if (!placed(e)) return; quietToasts(); const t = play('flag', e.id); if (t >= 0) sfx.flagFwump(E, t, e.quality >= 0.85); });
  on('logger:placed', (e) => { if (!placed(e)) return; quietToasts(); const t = play('zip', e.id); if (t >= 0) sfx.zipTie(E, t); });
  on('logger:read', () => { quietToasts(); const t = play('beep', 'reading'); if (t >= 0) sfx.loggerBeep(E, t, true); });
  on('gps:download', () => { quietToasts(); const t = play('download'); if (t >= 0) sfx.download(E, t); });
  on('tape:measured', () => { quietToasts(); const t = play('tape'); if (t >= 0) sfx.tape(E, t); });
  on('setup:floss', () => { const t = play('twang'); if (t >= 0) sfx.twang(E, t); });
  on('setup:station', () => { const t = play('thunk', 'station'); if (t >= 0) sfx.thunk(E, t); });
  on('tool:equip', (e) => {
    if (!e || e.silent) return;
    const t = play('tool', e.id || 'hands');
    if (t >= 0) sfx.toolClack(E, t, e.id);
  });
  on('ring:open', () => { const t = play('ring', 'open'); if (t >= 0) sfx.bloop(E, t, true, 0.7); });
  on('ring:close', () => { const t = play('ring', 'close'); if (t >= 0) sfx.bloop(E, t, false, 0.5); });

  // the other settings changed (or were reset): keep the volumes linked in
  on('settings:change', () => {
    const S = state.settings;
    if (!S || S.audio === settings) return;
    const other = S.audio;
    S.audio = settings;
    if (other && typeof other === 'object') { adopt(other); changed(); }
  });

  // UI clicks and hovers, anywhere in the page's own buttons
  const BTN = 'button, .ui-btn, [role="button"], [role="switch"], .nb-tab';
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest(BTN) : null;
    if (!b || b.disabled || b.closest('.nb-tabs') || b.classList.contains('nb-arrow')) return; // the page turn speaks
    const t = play('click');
    if (t >= 0) sfx.uiClick(E, t);
  }, true);
  let hovered = null;
  document.addEventListener('pointerover', (e) => {
    const b = e.target && e.target.closest ? e.target.closest(BTN) : null;
    if (b === hovered) return;
    hovered = b;
    const now = performance.now();
    if (!b || b.disabled || now - hoverT < 45) return;
    hoverT = now;
    if (E && ctx.state === 'running') sfx.uiHover(E, ctx.currentTime + 0.005);
  }, true);
  // typing a name: soft key ticks
  window.addEventListener('keydown', (e) => {
    const a = document.activeElement;
    if (!a || a.tagName !== 'INPUT' || !E || ctx.state !== 'running' || e.repeat) return;
    if (e.key.length === 1 || e.key === 'Backspace') sfx.tap(E, ctx.currentTime + 0.005, 'button');
  }, true);
  let pointerPress = false;
  window.addEventListener('pointerdown', (e) => {
    if (mg && e.target && e.target.closest && e.target.closest('.ui-minigame')) pointerPress = true;
  }, true);

  // ---------------------------------------------------------------- stings and ducks

  let stingUntil = 0;
  function duckFor(seconds, level) {
    if (!E) return;
    E.duck('sting', level);
    stingUntil = Math.max(stingUntil, ctx.currentTime + seconds);
  }

  // ---------------------------------------------------------------- each frame

  const snug = { on: false, k: -1, r: 0, inBand: false, results: 0 };
  const poleAim = { lock: null, ready: false, duck: false };
  // per-frame numbers live in objects, so an update boxes none
  const walk = { phase: 0, plant: Math.PI / 2, foot: 0, envT: 0, ratchetT: 0 };
  const crocWet = [0, 0, 0, 0];

  function moodNow() {
    const ph = state.phase;
    if (ph === 'title' || ph === 'boot') return 'title';
    if (ph === 'summary') return 'summary';
    const h = env.hours;
    return h < 11.25 ? 'morning' : h < 15.25 ? 'midday' : 'evening';
  }

  function update(dt) {
    const pl = game.player;
    if (!pl) return;
    const live = !!E && ctx.state === 'running';

    // the listener: the player, heard along the camera's right hand
    if (E) {
      E.ear.x = pl.position.x; E.ear.z = pl.position.z;
      const m = game.camera.matrixWorld.elements;
      const l = Math.sqrt(m[0] * m[0] + m[2] * m[2]) || 1;
      E.ear.rx = m[0] / l; E.ear.rz = m[2] / l;
    }

    // footsteps, on the avatar's own stride (avatar.js: a foot lands at phase pi/2 + k pi)
    const sp = pl.speed;
    walk.phase += (sp / Math.max(0.05, 0.1 + 0.04 * sp)) * 0.5 * dt;
    if (walk.phase >= walk.plant) {
      while (walk.plant <= walk.phase) walk.plant += Math.PI;
      if (sp > 0.25 && !pl.pushed) footstep(pl, live);
    }

    // where we are and what hour it is, ten times a second
    walk.envT -= dt;
    if (walk.envT <= 0) {
      walk.envT = 0.1;
      if (place) place.sample(pl.position.x, pl.position.z, P);
      const ph = state.phase;
      env.hours = CLOCK_PHASES.has(ph) ? state.clock.hours : game.sky ? game.sky.hours : 9.5;
      env.water = P.water; env.canopy = P.canopy;
      env.level = ph === 'summary' ? 0.7 : 1;
      if (live && stingUntil > 0 && ctx.currentTime > stingUntil) { stingUntil = 0; E.duck('sting', 1); } // ten times a second
    }
    toastChime();
    requestSting();
    noticeNow(pl);
    // and whatever else happens, no radio without a talk up
    if (voice && !talkOpen && voice.radio) voice.setRadio(false);
    if (!live) return;

    const now = ctx.currentTime;
    amb.update(dt, env, now);
    music.update(moodNow(), now);

    // the loop pole: a glide when the loop picks a new lizard, a tink when it settles
    const N = game.catching && game.catching.loopPole;
    if (N) {
      const lock = N.aiming ? N.lock : null;
      if (lock && lock !== poleAim.lock) { const t = play('glide', lock.species); sfx.glide(E, t, 1 + 0.08 * (rand() - 0.5)); }
      const ready = !!(lock && N.ready);
      if (ready && !poleAim.ready) { const t = play('settled'); sfx.settled(E, t + 0.02); }
      poleAim.lock = lock; poleAim.ready = ready;
      // the music steps back while the loop is on a lizard, so its little cues come through
      if (!!lock !== poleAim.duck) { poleAim.duck = !!lock; E.duck('aim', lock ? 0.7 : 1); }
    }

    // the snug ring: ticks as it closes, a chime on reaching the green
    const Tm = game.catching && game.catching.timing;
    if (Tm && Tm.active) {
      // a new snug, or a knight's second round: the ring starts wide again
      if (!snug.on || Tm.r > snug.r + 2) { snug.on = true; snug.k = -1; snug.inBand = false; }
      if (Tm.results.length < snug.results) snug.results = 0;
      snug.r = Tm.r;
      if (!Tm.pressed && Tm.t > SNUG.lead) {
        const k = Math.floor((SNUG.r0 - Tm.r) / 11);
        if (k > snug.k) {
          snug.k = k;
          const p = Math.min(1, Math.max(0, (SNUG.r0 - Tm.r) / (SNUG.r0 - SNUG.at)));
          const t = play('tick');
          sfx.tick(E, t, p);
        }
        const inB = Math.abs(Tm.r - SNUG.at) <= Tm.w;
        if (inB && !snug.inBand) { const t = play('band'); sfx.inBand(E, t); }
        snug.inBand = inB;
      }
      // a knight's first round snugged: a small pop before the second
      if (Tm.results.length > snug.results) {
        const r = Tm.results[Tm.results.length - 1];
        snug.results = Tm.results.length;
        if (r.ok && Tm.opts && Tm.results.length < Tm.opts.rounds) { const t = play('pop', 'round'); sfx.pop(E, t, false); }
      }
    } else {
      snug.on = false; snug.results = 0;
    }

    // taps in the set-up and field mini-games (the catch cards speak for themselves)
    const inp = game.input;
    if (mg && TAPS[mg] && (inp.pressed('use') || pointerPress)) {
      const t = play('tap', mg);
      if (mg === 'station') sfx.thunk(E, t); else sfx.tap(E, t, TAPS[mg]);
    }
    if (mg === 'logger' && (inp.down('use') || pointerHeld)) {
      walk.ratchetT -= dt;
      if (walk.ratchetT <= 0) { walk.ratchetT = 0.075; const t = play('tap', 'strap'); sfx.tap(E, t, 'ratchet'); }
    } else walk.ratchetT = 0;
    pointerPress = false;

    // a crocodile sliding into the water (or hauling out) nearby
    const cr = game.croc && game.croc.crocs;
    if (cr) {
      for (let i = 0; i < cr.length && i < crocWet.length; i++) {
        const c = cr[i], w = c.wet || 0;
        if (crocWet[i] > 0.5 && w <= 0.5) { const t = play('splash', 'croc in'); sfx.splash(E, t, c.x, c.z, 0.7); }
        else if (crocWet[i] <= 0.5 && w > 0.5 && crocWet[i] > 0) { const t = play('splash', 'croc out'); sfx.splash(E, t, c.x, c.z, 0.3); }
        crocWet[i] = w;
      }
    }
  }
  let pointerHeld = false;
  window.addEventListener('pointerdown', () => { pointerHeld = true; }, true);
  window.addEventListener('pointerup', () => { pointerHeld = false; }, true);

  function footstep(pl, live) {
    walk.foot ^= 1;
    if (place) place.sample(pl.position.x, pl.position.z, P);
    const k = pl.mode === 'creep' ? 0.35 : pl.mode === 'jog' ? 1 : 0.7;
    note('step', null);
    if (log) note('step ' + sfx.SURFACE_NAMES[P.surface], null);
    if (!live) return;
    const t = ctx.currentTime + 0.01;
    sfx.step(E, t, P.surface, k, walk.foot);
    // blades brushing the legs on the lawn
    if (P.grass > 0.15 && rustle) {
      const lv = 0.045 * P.grass * k;
      rustle.bp.frequency.setValueAtTime(2600 + 1400 * rand(), t);
      rustle.g.gain.setTargetAtTime(lv, t, 0.025);
      rustle.g.gain.setTargetAtTime(0, t + 0.09 + 0.05 * k, 0.07);
    }
  }

  // ---------------------------------------------------------------- the API's helpers

  function preview(key) {
    const t = play('preview', key);
    if (t < 0) return;
    if (key === 'music') { // three notes of the tune, past the duck
      if (E.claim('music', t, 1.4)) [77, 81, 84].forEach((m, i) => pluck(E, E.bus.musicDry, t + i * 0.16, { f: midiHz(m), v: 0.6, d: 1 }));
    } else if (key === 'ambience') bird(E, t, 'cardinal', 0, 1, false);
    else if (key === 'effects') sfx.pop(E, t, false);
    else if (key === 'voice') voice.say('Hello there!', t);
    else sfx.chime(E, t, 'good');
  }
  function cue(name, ...args) {
    const t = play(name, 'cue');
    if (t < 0 || typeof sfx[name] !== 'function') return null;
    return sfx[name](E, t, ...args);
  }

  // ?audiolog=1: the log in the page as well, every second
  // (with ?diag=1 too, the diag JSON is written again every 5 s, so a headless dump
  // taken at any time carries the cues so far under modules.audio)
  let logEl = null;
  const logAt = { t: 0, n: 0 };
  function writeLog(dt) {
    logAt.t -= dt;
    if (logAt.t > 0) return;
    logAt.t = 1;
    if (!logEl) {
      logEl = document.createElement('pre');
      logEl.id = 'audio-log';
      logEl.hidden = true;
      document.body.appendChild(logEl);
    }
    logEl.textContent = JSON.stringify(statsNow());
    if (FLAGS.diag && ++logAt.n % 5 === 0 && game.frame > 60) {
      try { writeDiag(game); } catch (e) { /* the diag's own */ }
    }
  }
  function statsNow() {
    const out = {
      context: ctx ? ctx.state : 'none', sampleRate: ctx ? ctx.sampleRate : 0,
      settings: { ...settings },
      voices: E ? { effects: E.voices('effects'), ambience: E.voices('ambience'), music: E.voices('music'), stings: E.voices('stings') } : null,
      dropped: E ? E.dropped : 0, nodesMade: E ? E.made : 0,
      music: music ? { mood: music.state.mood, playing: music.state.playing, phrases: music.state.phrases, notes: music.state.notes } : null,
      ambience: amb ? { ...amb.stats, curves: { ...amb.curves } } : null,
      voice: voice ? voice.syllables : 0, voiceSkips: voice ? voice.skips : 0,
      place: { water: +P.water.toFixed(1), canopy: +P.canopy.toFixed(2), surface: sfx.SURFACE_NAMES[P.surface], hours: +env.hours.toFixed(2) },
    };
    if (log) { out.counts = log.counts; out.log = log.list; out.graph = E ? E.graph() : null; }
    return out;
  }

  sys = {
    update(dt) {
      update(dt);
      if (log) writeLog(dt);
    },
    unlock, preview, cue,
    get ctx() { return ctx; },
    get engine() { return E; },
    get stats() { return statsNow(); },
    api: audio,
  };
  return sys;
}

function hasOwnSave() {
  try { return !!window.localStorage.getItem(KEY); } catch (e) { return false; }
}
