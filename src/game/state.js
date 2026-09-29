// The field season's state: the phase, the player's name and looks, the survey
// day's clock (it drives sky.setTimeOfDay), the score, what is in the field bag,
// and the notebook (species counts, tasks, flags, loggers and tracked lizards),
// saved to localStorage when it can be. One plain object that every module reads;
// the functions here change it where an event should follow.
//
//   state.phase           boot, title, intro, setup (the opening: the kit hunt, the
//                         station, the floss loop, a practice catch), survey, summary
//   addScore(points, reason)  -> 'score:add' { points, reason, total }
//   setPhase(p)           -> 'phase:change' { phase, previous }
//   save(), load()        localStorage, wrapped; the game runs without it (?nosave=1, and
//                         any debug or screenshot flag unless ?save=1 is given too)
//   saveSettings()        state.settings (Precise aiming, day length, text speed, camera
//                         shake, reduced motion; the sound's own are saved by src/audio)
//                         under a key of its own, so "Start
//                         over" keeps them; read back by attach(). setSetting(key, value)
//                         checks a value, saves and emits 'settings:change' { key, settings }
//   saveSummary()         what a save holds, for the title's Continue (null without one)
//   holdClock(key, on)    stop the day's clock while something is open (a talk, a panel)
//   dayKey()              a number for "today" (each set-up and survey day has its own,
//                         never reused in a session): what a lizard's tag is compared with
//   preciseAiming()       Precise aiming is on (the setting, or ?precise=1)
//   state.today.steady    a Steady hands day so far: Precise aiming was on as the survey day
//                         began (newDay, and again as its clock first runs, so a switch during
//                         James's morning talk counts) and has stayed on (setSetting clears it
//                         for the day, marks steadyOff and emits 'steady:off');
//                         state.today.diary is the day's own notes for the island board's
//                         notebook (src/game/daylog.js), state.today.key its dayKey()
//
// attach(game) (flow.js calls it) wires the events below into the counts: lizard:spotted,
// lizard:caught, lizard:measured, lizard:tagged, lizard:released, croc:spotted and
// croc:snap (which takes RULES.points.croc and RULES.crocSeconds off the day).

import { events } from '../core/events.js';
import { RULES } from './rules.js';

export { RULES };
export const SPECIES = ['crested', 'brown', 'green', 'bark', 'knight', 'croc'];
// The lizards carry their scientific epithet (lizard.species); the notebook uses short keys.
export const SPECIES_KEY = { cristatellus: 'crested', sagrei: 'brown', carolinensis: 'green', distichus: 'bark', equestris: 'knight' };
export const speciesKey = (sp) => SPECIES_KEY[sp] || sp;
export const PHASES = ['title', 'intro', 'setup', 'survey', 'summary'];
const SAVE_KEY = 'stroudlab.fieldseason.v1';
const SETTINGS_KEY = 'stroudlab.fieldseason.settings.v1';

// ---------------------------------------------------------------- URL flags

const params = new URLSearchParams(location.search);
function flag(name) {
  if (!params.has(name)) return false;
  const v = params.get(name);
  return v === '' || v === '1' || v === 'true' || v === 'yes';
}
// ?clock=13.45 is 13:45 (hh.mm); ?clock=9 is 09:00
function parseClock(raw) {
  if (raw == null || raw === '') return null;
  const m = /^(\d{1,2})(?:[.:](\d{1,2}))?$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2].length === 1 ? m[2] + '0' : m[2]) : 0;
  if (h > 23 || min > 59) return null;
  return h + min / 60;
}

// The debug and screenshot flags jump over parts of the game (?phase=setup wipes the
// notebook, ?phase=survey plants every flag), so a run with any of them leaves the
// player's real save alone unless ?save=1 asks for it.
const DEBUG_FLAGS = ['phase', 'skipsetup', 'huntstep', 'catch', 'catchstep', 'open', 'clock', 'fast', 'tool', 'name', 'mission', 'missionstep'];
// ?phase= also takes the opening's own starts: hunt (after the intro) and practice
const PHASE_FLAGS = [...PHASES, 'hunt', 'practice'];
const debugRun = DEBUG_FLAGS.some((k) => params.has(k));

// The loop pole had another id in older saves and links (setup.kit, its task, ?tool=, ?huntstep=):
// currentId() maps it to 'loop_pole'. This is the only place the old id is kept.
const OLD_IDS = { noose: 'loop_pole' };
export const currentId = (id) => (typeof id === 'string' && Object.prototype.hasOwnProperty.call(OLD_IDS, id) ? OLD_IDS[id] : id);

export const GAME_FLAGS = {
  // ?mission=drone|tls|rtk (src/missions) starts the survey day with that mission, so it implies ?phase=survey
  phase: PHASE_FLAGS.includes(params.get('phase')) ? params.get('phase') : ['drone', 'tls', 'rtk'].includes(params.get('mission')) ? 'survey' : null,
  huntStep: currentId(params.get('huntstep')) || null, // where in the opening a check starts (flow.js)
  name: params.has('name') ? String(params.get('name')).slice(0, 14) : null,
  skipSetup: flag('skipsetup'),
  clock: parseClock(params.get('clock')),
  fast: Math.max(0.05, Number(params.get('fast')) || 1),
  tool: currentId(params.get('tool')),
  open: params.get('open'),
  catch: params.get('catch'),
  precise: params.get('precise') === '1', // Precise aiming for this run, whatever the setting
  nosave: flag('nosave') || (debugRun && !flag('save')),
};

// ---------------------------------------------------------------- the settings

// The options on the pause card (and the title's settings), with what each may be.
export const DAY_LENGTHS = [8, 12, 16]; // real minutes for 07:30 to 18:30
export const TEXT_SPEEDS = { slow: 28, normal: 55, fast: 110 }; // characters a second
// (the volumes and mute are the sound system's: src/audio/index.js keeps them in
// state.settings.audio and saves them under a key of its own)
function defaultSettings() {
  let calm = false;
  try { calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { calm = false; }
  return {
    preciseAim: false, // the loop follows the pointer instead of locking on
    dayMinutes: RULES.day.dayMinutes,
    textSpeed: 'normal',
    cameraShake: true,
    reducedMotion: calm, // no particles, no wobbles (the system's own setting at first)
  };
}
// A setting as the game can use it: bad or missing values fall back to the default.
function cleanSetting(key, v, def) {
  if (key === 'dayMinutes') return DAY_LENGTHS.includes(Number(v)) ? Number(v) : def;
  if (key === 'textSpeed') return Object.prototype.hasOwnProperty.call(TEXT_SPEEDS, v) ? v : def;
  if (typeof def === 'boolean') return typeof v === 'boolean' ? v : def;
  return def;
}

// ---------------------------------------------------------------- the state

const blankSpecies = () => Object.fromEntries(SPECIES.map((sp) => [sp, { spotted: 0, caught: 0, tagged: 0, biggestSvl: 0 }]));
// The opening's progress: the pieces of kit found (src/story/kit_hunt.js
// ids), the station put right, the floss loop tied, the practice catch, all done. v 2
// marks the shape; a save without it is from the old set-up day (see load()).
export const OPENING_KIT = ['loop_pole', 'notebook', 'bags', 'scales', 'pens'];
export const blankSetup = () => ({ kit: [], station: 0, floss: false, practice: false, done: false, v: 2 });
const doneSetup = () => ({ kit: OPENING_KIT.slice(), station: 1, floss: true, practice: true, done: true, v: 2 });
// (steady starts false: a day whose start was not seen with Precise aiming on never counts)
export const blankDiary = () => ({ catches: [], stamps: [], points: {}, scans: [], plants: 0, named: 0 });
const blankToday = () => ({
  caught: Object.fromEntries(SPECIES.map((sp) => [sp, 0])),
  spotted: 0, tagged: 0, loggersRead: 0, tasksDone: 0, crocSnaps: 0, displayCatches: 0, creepCatches: 0,
  downloads: 0, taped: 0,
  perchClipped: 0, perchDownloads: 0, // perch loggers clipped and downloaded (src/tools/perch_loggers.js)
  requests: [], // James's requests for the day: { id, label, goal, n, done } (tasks.js draws them)
  steady: false, // Precise aiming from the day's start (newDay) and still on
  steadyOff: false, // Precise aiming was switched off during this day (it can't count again)
  key: 0, // this day's dayKey() (newDay), so its notes know what was tagged today
  diary: blankDiary(), // the day's catches, stamps, points and field kit, for the board's notebook
});

export const state = {
  phase: 'boot',
  playerName: '',
  looks: { hat: RULES.looks.hats[0].colour, shirt: RULES.looks.shirts[0].colour },
  clock: { hours: RULES.day.titleHours, running: false, speed: 0 }, // speed: game hours per real second
  score: 0, // this survey day
  best: 0,
  days: 0, // survey days finished
  inventory: { ...RULES.inventory },
  species: blankSpecies(), // the notebook, over every day
  tasks: {}, // id -> { n, done }; tasks.js fills it
  setup: blankSetup(), // the opening's progress
  flags: [], // placed grid flags: { id, x, y, z }
  loggers: [], // deployed loggers: { id, x, y, z, readings: [{ hours, celsius }] }
  tracked: [], // lizards with a GPS backpack: { id, species, sex, colour, perch, height, svl, day, trail, lizard }
  // followed lizards (perch loggers, src/tools/perch_loggers.js): one life story each, what
  // its logger held at its last download (no position: its trail as offsets from the perch)
  followed: [],
  perchIntro: false, // James has said what the perch loggers are (once on a save)
  missions: {}, // the field kit's missions (src/missions): id -> { runs, done, best, points, data }
  today: blankToday(),
  summary: null, // the end-of-day card's numbers (flow.js)
  hasSave: false,
  settings: defaultSettings(), // the pause card's options (saveSettings)
};

// Time between two game minutes, for 'clock:tick'.
let lastMinute = -1;
const holds = new Set();
let game = null;
// Today's key: bumped for every new day (and the set-up day), never reused.
let dayId = 1;
export const dayKey = () => dayId;

// ---------------------------------------------------------------- changes

export function addScore(points, reason = '') {
  if (!Number.isFinite(points) || points === 0) return;
  state.score = Math.max(0, state.score + Math.round(points));
  events.emit('score:add', { points: Math.round(points), reason, total: state.score });
}

export function setPhase(p) {
  if (p === state.phase) return;
  const previous = state.phase;
  state.phase = p;
  if (p === 'setup') dayId++; // the set-up day is a day of its own
  events.emit('phase:change', { phase: p, previous });
}

// The day's pace: the chosen day length (8, 12 or 16 real minutes, RULES.day.dayMinutes
// by default) from start to end, times ?fast.
export function clockSpeed() {
  const D = RULES.day;
  const mins = DAY_LENGTHS.includes(state.settings.dayMinutes) ? state.settings.dayMinutes : D.dayMinutes;
  return ((D.end - D.start) / (mins * 60)) * GAME_FLAGS.fast;
}

// The sky's time of day for a clock time (RULES.day.skyHours).
export function skyHours(hours) {
  const D = RULES.day, [a, b] = D.skyHours || [D.start, D.end];
  return a + (hours - D.start) * (b - a) / (D.end - D.start);
}

export function setClock(hours, running = state.clock.running) {
  state.clock.hours = hours;
  state.clock.running = running;
  state.clock.speed = clockSpeed();
  lastMinute = -1;
  if (game && game.sky) game.sky.setTimeOfDay(skyHours(hours));
}

// Something open (a talk, the notebook, the pause menu) holds the clock.
export function holdClock(key, on = true) {
  if (on) holds.add(key); else holds.delete(key);
}
export const clockHeld = () => holds.size > 0;

// Called every frame by flow.js; returns true when the day's end has been reached.
export function tickClock(dt) {
  const c = state.clock;
  if (!c.running || holds.size > 0) return false;
  c.hours += dt * c.speed;
  const end = RULES.day.end;
  if (c.hours > end) c.hours = end;
  if (game && game.sky) game.sky.setTimeOfDay(skyHours(c.hours));
  const minute = Math.floor(c.hours * 60);
  if (minute !== lastMinute) {
    lastMinute = minute;
    events.emit('clock:tick', c);
  }
  return c.hours >= end;
}

// "08:05"
export function clockText(hours = state.clock.hours) {
  const m = Math.floor(hours * 60 + 1e-6);
  const hh = Math.floor(m / 60) % 24, mm = m % 60;
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

// A fresh survey day: the bag refilled, today's counts and score cleared, the
// loggers' readings kept (they are the notebook's), tagged lizards kept.
export function newDay() {
  state.inventory = { ...RULES.inventory, flags: Math.max(0, RULES.inventory.flags - state.flags.length), loggers: Math.max(0, RULES.inventory.loggers - state.loggers.length) };
  state.score = 0;
  state.today = blankToday();
  state.today.steady = preciseAiming(); // a Steady hands day if Precise aiming is on as it starts
  state.summary = null;
  dayId++;
  state.today.key = dayId;
  setClock(GAME_FLAGS.clock ?? RULES.day.start, false);
  events.emit('day:new', state.today); // tasks.js draws James's requests
}

// Everything back to a new game (Start on the title screen).
export function resetAll() {
  state.playerName = '';
  state.looks = { hat: RULES.looks.hats[0].colour, shirt: RULES.looks.shirts[0].colour };
  state.species = blankSpecies();
  state.tasks = {};
  state.setup = blankSetup();
  state.flags.length = 0;
  state.loggers.length = 0;
  state.tracked.length = 0;
  state.followed.length = 0;
  state.perchIntro = false;
  state.missions = {};
  state.days = 0;
  crocSpotted.clear();
  newDay();
  events.emit('state:reset', state);
}

// ---------------------------------------------------------------- save and load

function storage() {
  if (GAME_FLAGS.nosave) return null;
  try {
    const s = window.localStorage;
    const k = '__fs_probe';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch (e) {
    return null;
  }
}

// The notebook, name, looks and best score. No lizard positions are kept: a tracked
// lizard is saved as its species, sex, colour and what was noted about it.
export function save() {
  const s = storage();
  if (!s) return false;
  const out = {
    v: 1,
    playerName: state.playerName,
    looks: state.looks,
    best: state.best,
    days: state.days,
    species: state.species,
    tasks: state.tasks,
    setup: state.setup,
    flags: state.flags.map((f) => f.id),
    loggers: state.loggers.map((l) => ({ id: l.id, readings: l.readings.slice(-24) })),
    tracked: state.tracked.map((t) => ({ id: t.id, species: t.species, sex: t.sex, colour: t.colour, perch: t.perch, height: t.height, svl: t.svl, day: t.day, nickname: t.nickname || null })),
    missions: cleanMissions(state.missions),
    followed: cleanFollowed(state.followed),
    perchIntro: state.perchIntro === true,
  };
  try {
    s.setItem(SAVE_KEY, JSON.stringify(out));
    state.hasSave = true;
    return true;
  } catch (e) {
    return false;
  }
}

// Reads the save into the state; returns the raw save (or null). Flag and logger
// ids come back as { id } only: flags.js and loggers.js put them back in the world.
export function load() {
  const s = storage();
  if (!s) return null;
  let raw = null;
  try {
    raw = JSON.parse(s.getItem(SAVE_KEY) || 'null');
  } catch (e) {
    raw = null;
  }
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return null;
  state.hasSave = true;
  // a save can be old or damaged: every field is checked, and a bad one falls back
  state.playerName = cleanName(raw.playerName);
  const L = RULES.looks, looks = raw.looks && typeof raw.looks === 'object' ? raw.looks : {};
  state.looks = { hat: isColour(looks.hat) ? looks.hat : L.hats[0].colour, shirt: isColour(looks.shirt) ? looks.shirt : L.shirts[0].colour };
  state.best = count(raw.best);
  state.days = Math.floor(count(raw.days));
  state.species = blankSpecies();
  if (raw.species && typeof raw.species === 'object') {
    for (const sp of SPECIES) {
      const r = raw.species[sp];
      if (!r || typeof r !== 'object') continue;
      const o = state.species[sp];
      for (const k of ['spotted', 'caught', 'tagged', 'biggestSvl']) o[k] = Math.round(count(r[k]));
    }
  }
  state.tasks = {};
  if (raw.tasks && typeof raw.tasks === 'object') {
    for (const [id, r] of Object.entries(raw.tasks)) {
      if (!r || typeof r !== 'object') continue;
      const t = { n: Math.round(count(r.n)), done: r.done === true };
      if (Array.isArray(r.ids)) t.ids = r.ids.filter((k) => typeof k === 'string').map(currentId).slice(-40);
      state.tasks[id] = t;
    }
  }
  const S = raw.setup && typeof raw.setup === 'object' ? raw.setup : {};
  // a save with survey days or catches behind it has done its set-up, whatever its
  // setup field says (missing or damaged)
  let veteran = count(raw.days) > 0;
  if (raw.species && typeof raw.species === 'object') for (const sp of SPECIES) if (raw.species[sp] && count(raw.species[sp].caught) > 0) veteran = true;
  if (S.done === true || (S.v !== 2 && veteran)) state.setup = doneSetup();
  else if (S.v === 2) {
    const kit = [];
    for (const id of (Array.isArray(S.kit) ? S.kit : []).map(currentId)) if (OPENING_KIT.includes(id) && !kit.includes(id)) kit.push(id);
    state.setup = { kit, station: count(S.station) > 0 ? 1 : 0, floss: S.floss === true, practice: S.practice === true, done: false, v: 2 };
  } else {
    // A save from the middle of the old set-up day (flags and loggers laid out by hand):
    // the opening starts afresh (the name, looks and notebook kept), with a word from
    // James; its old set-up stamps go, so the checklist starts clean.
    state.setup = { ...blankSetup(), migrated: true };
    for (const id of Object.keys(state.tasks)) if (id.startsWith('setup.')) delete state.tasks[id];
  }
  // the old set-up day's jobs that are gone (planting the flags, tying the loggers)
  for (const id of ['setup.flags', 'setup.loggers', 'setup.straight']) delete state.tasks[id];
  if (state.setup.done) for (const id of ['setup.kit', 'setup.station', 'setup.floss', 'setup.practice']) state.tasks[id] = { n: id === 'setup.kit' ? OPENING_KIT.length : 1, done: true };
  state.flags.length = 0;
  for (const id of Array.isArray(raw.flags) ? raw.flags : []) if (typeof id === 'string' && id.length < 8) state.flags.push({ id });
  state.loggers.length = 0;
  for (const l of Array.isArray(raw.loggers) ? raw.loggers : []) {
    if (!l || typeof l.id !== 'string') continue;
    const readings = (Array.isArray(l.readings) ? l.readings : []).filter((r) => r && typeof r === 'object' &&
      Number.isFinite(r.hours) && Number.isFinite(r.celsius) && Number.isInteger(r.day));
    state.loggers.push({ id: l.id, readings });
  }
  // in the same session the lizards still wear their packs: keep each one's link and trail
  const live = new Map(state.tracked.map((t) => [t.id, t]));
  state.tracked.length = 0;
  for (const t of Array.isArray(raw.tracked) ? raw.tracked : []) {
    if (!t || typeof t !== 'object' || !SPECIES.includes(t.species) || t.species === 'croc' || typeof t.id !== 'string') continue;
    const was = live.get(t.id);
    const same = was && was.species === t.species && was.colour === t.colour;
    state.tracked.push({
      id: t.id.slice(0, 12), species: t.species, sex: t.sex === 'm' || t.sex === 'f' ? t.sex : null,
      colour: isColour(t.colour) ? t.colour : RULES.backpackColours[0], perch: typeof t.perch === 'string' ? t.perch : null,
      height: count(t.height), svl: Number.isFinite(t.svl) && t.svl > 0 ? t.svl : null, day: Math.round(count(t.day)),
      nickname: typeof t.nickname === 'string' ? t.nickname.slice(0, 14) : null,
      trail: same && was.trail ? was.trail : [], fixes: same && was.fixes ? was.fixes : [], lizard: same ? was.lizard : null,
    });
  }
  state.missions = cleanMissions(raw.missions);
  state.followed.length = 0;
  // (a story from a day that never ended, downloaded before a reload, is marked cut)
  for (const f of cleanFollowed(raw.followed, state.days)) state.followed.push(f);
  state.perchIntro = raw.perchIntro === true;
  return raw;
}

// The followed lizards' life stories (src/tools/perch_loggers.js, drawn by src/ui/perch_day.js),
// as saved and as loaded: known species, colours as #rrggbb, clock hours inside the day,
// the day's spells as known letters, the trail as small offsets; anything else dropped.
// cut: from an attempt at a day that was left unfinished (the end-of-day card of the day
// played again leaves it out); on load, finished: the survey days done, so a story of a
// later day that was not picked up at its end is one of those.
const FOLLOW_KEYS = ['crested', 'brown', 'green', 'bark', 'knight'];
const FOLLOW_PERCH = ['trunk', 'branch', 'ground', 'leaf', 'palm_stem', 'palm_frond', 'log', 'root'];
const FOLLOW_CODES = 'busmhdxf';
function cleanFollowed(list, finished = null) {
  const out = [];
  if (!Array.isArray(list)) return out;
  const hour = (v) => Number.isFinite(v) && v >= 0 && v <= 24;
  const r2 = (v) => Math.round(v * 100) / 100;
  for (const f of list.slice(-30)) {
    if (!f || typeof f !== 'object' || !FOLLOW_KEYS.includes(f.sp) || !Number.isInteger(f.k) || f.k < 0 || !hour(f.clip)) continue;
    // one still out and never downloaded goes with its day (a reload starts the day again)
    if (!(Array.isArray(f.dl) && f.dl.length) && f.end !== true) continue;
    const str = (v, n) => (typeof v === 'string' ? v.replace(/[<>{}\[\]*]/g, '').slice(0, n) : null);
    const e = {
      k: f.k, nick: str(f.nick, 14) || 'Anole', sp: f.sp, sex: f.sex === 'm' || f.sex === 'f' ? f.sex : null,
      svl: Number.isFinite(f.svl) && f.svl > 0 && f.svl < 400 ? Math.round(f.svl) : null,
      mark: isColour(f.mark) ? f.mark : null,
      perch: FOLLOW_PERCH.includes(f.perch) ? f.perch : null, seen: FOLLOW_PERCH.includes(f.seen) ? f.seen : null,
      h: Math.min(30, Math.round(count(f.h) * 2) / 2), taped: f.taped === true,
      flag: typeof f.flag === 'string' && /^[A-Z]\d{2}$/.test(f.flag) ? f.flag : null,
      pack: isColour(f.pack) ? f.pack : null, gps: typeof f.gps === 'string' && /^GPS \d{1,3}$/.test(f.gps) ? f.gps : null,
      day: Math.max(1, Math.round(count(f.day))), col: isColour(f.col) ? f.col : '#ff7b54', cname: str(f.cname, 12) || '',
      clip: r2(f.clip), kind: ['sunny', 'shady', 'dappled'].includes(f.kind) ? f.kind : 'dappled',
      dl: (Array.isArray(f.dl) ? f.dl : []).filter(hour).slice(-12).map(r2),
      upto: hour(f.upto) ? r2(f.upto) : null, end: f.end === true,
      temps: (Array.isArray(f.temps) ? f.temps : []).filter((p) => Array.isArray(p) && hour(p[0]) && Number.isFinite(p[1]) && Math.abs(p[1]) < 60)
        .slice(-90).map((p) => [r2(p[0]), Math.round(p[1] * 10) / 10, Number.isFinite(p[2]) ? Math.max(0, Math.min(1, r2(p[2]))) : 0]),
      states: (Array.isArray(f.states) ? f.states : []).filter((p) => Array.isArray(p) && hour(p[0]) && typeof p[1] === 'string' && p[1].length === 1 && FOLLOW_CODES.includes(p[1]))
        .slice(-160).map((p) => [r2(p[0]), p[1]]),
      trail: (Array.isArray(f.trail) ? f.trail : []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 40 && Math.abs(p[1]) <= 40)
        .slice(-80).map((p) => [Math.round(p[0] * 2) / 2, Math.round(p[1] * 2) / 2]),
      dist: Math.min(999, Math.round(count(f.dist) * 10) / 10), flights: Math.min(99, Math.round(count(f.flights))),
      line: str(f.line, 240) || '', whole: f.whole === true,
    };
    if (f.cut === true || (finished != null && e.end !== true && e.day > finished)) e.cut = true;
    out.push(e);
  }
  return out;
}

// The field kit's records (src/missions): per mission { runs, done, best, points, data },
// where data is the mission's own plain JSON (numbers, short strings, true or false,
// lists and objects a few levels deep). Anything else is dropped, and a record that is
// too big to keep is cut back to its counts.
const MISSION_KEYS = ['drone', 'tls', 'rtk'];
function cleanJson(v, depth) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.length <= 400000 ? v : null;
  if (depth <= 0 || v == null || typeof v !== 'object') return null;
  if (Array.isArray(v)) return v.slice(0, 400).map((x) => cleanJson(x, depth - 1)).filter((x) => x !== null);
  const out = {};
  for (const [k, x] of Object.entries(v).slice(0, 60)) {
    if (!/^[\w.-]{1,40}$/.test(k)) continue;
    const c = cleanJson(x, depth - 1);
    if (c !== null) out[k] = c;
  }
  return out;
}
function cleanMissions(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const id of MISSION_KEYS) {
    const r = raw[id];
    if (!r || typeof r !== 'object') continue;
    const rec = { runs: Math.round(count(r.runs)), done: Math.round(count(r.done)), best: Math.min(3, Math.round(count(r.best))), points: Math.round(count(r.points)), data: {} };
    const data = cleanJson(r.data, 5);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      let size = 0;
      try { size = JSON.stringify(data).length; } catch (e) { size = Infinity; }
      if (size <= 600000) rec.data = data;
    }
    out[id] = rec;
  }
  return out;
}

const isColour = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
const count = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };

// A name as the name box takes it: no markup or template marks, 14 characters at most.
export function cleanName(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[<>{}\[\]*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
}

// The pause card's options, kept apart from the notebook.
export function saveSettings() {
  const s = storage();
  if (!s) return false;
  try {
    const out = { v: 1 };
    for (const k of Object.keys(defaultSettings())) out[k] = state.settings[k];
    s.setItem(SETTINGS_KEY, JSON.stringify(out));
    return true;
  } catch (e) {
    return false;
  }
}

function loadSettings() {
  const s = storage();
  if (!s) return;
  try {
    const raw = JSON.parse(s.getItem(SETTINGS_KEY) || 'null');
    if (!raw || raw.v !== 1) return;
    const def = defaultSettings();
    for (const k of Object.keys(def)) if (k in raw) state.settings[k] = cleanSetting(k, raw[k], def[k]);
  } catch (e) { /* defaults */ }
}

// Changes one setting, saves the lot and tells the game ('settings:change' { key,
// settings }). The clock's pace follows a new day length at once.
export function setSetting(key, value) {
  const def = defaultSettings();
  if (!(key in def)) return false;
  state.settings[key] = cleanSetting(key, value, state.settings[key]);
  if (key === 'dayMinutes') state.clock.speed = clockSpeed();
  saveSettings();
  // Precise aiming off during a survey day: that day is off the Steady hands board (on
  // again, it stays off: the day has to be played with it from the start)
  if (key === 'preciseAim' && !preciseAiming() && state.phase === 'survey') {
    state.today.steadyOff = true;
    if (state.today.steady) {
      state.today.steady = false;
      events.emit('steady:off', { hours: state.clock.hours });
    }
  }
  events.emit('settings:change', { key, settings: state.settings });
  return true;
}

// The loop follows the pointer (the pause card's switch, or ?precise=1 for checks).
export function preciseAiming() {
  return GAME_FLAGS.precise || !!(state.settings && state.settings.preciseAim);
}

// Only checks whether a save is there (for the title's Continue).
export function hasSave() {
  const s = storage();
  if (!s) return false;
  try {
    const raw = JSON.parse(s.getItem(SAVE_KEY) || 'null');
    return !!(raw && raw.v === 1);
  } catch (e) {
    return false;
  }
}

// What the save holds, for the title's Continue button, without loading it: the name,
// the days done, where the set-up day got to, lizards caught, species, stamps and the
// best day. Null without a save.
export function saveSummary() {
  const s = storage();
  if (!s) return null;
  let raw = null;
  try { raw = JSON.parse(s.getItem(SAVE_KEY) || 'null'); } catch (e) { raw = null; }
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return null;
  const S = raw.setup && typeof raw.setup === 'object' ? raw.setup : {};
  let caught = 0, species = 0;
  if (raw.species && typeof raw.species === 'object') {
    for (const sp of SPECIES) {
      if (sp === 'croc') continue;
      const n = Math.round(count(raw.species[sp] && raw.species[sp].caught));
      caught += n;
      if (n > 0) species++;
    }
  }
  let stamps = 0;
  if (raw.tasks && typeof raw.tasks === 'object') for (const [id, t] of Object.entries(raw.tasks)) if (t && t.done === true && !id.startsWith('setup.')) stamps++;
  return {
    // (an old save with days or catches behind it has done its set-up: load() says so too)
    name: cleanName(raw.playerName), days: Math.floor(count(raw.days)), setupDone: S.done === true || (S.v !== 2 && (count(raw.days) > 0 || caught > 0)),
    // the opening's progress: the pieces of kit found (none for an old set-up day's save)
    kit: S.v === 2 && Array.isArray(S.kit) ? Math.min(OPENING_KIT.length, S.kit.filter((id) => OPENING_KIT.includes(currentId(id))).length) : 0,
    station: S.v === 2 && count(S.station) > 0, floss: S.v === 2 && S.floss === true, practice: S.v === 2 && S.practice === true,
    caught, species, stamps, best: Math.round(count(raw.best)),
    tracked: Array.isArray(raw.tracked) ? raw.tracked.length : 0,
  };
}

export function clearSave() {
  const s = storage();
  if (!s) return;
  try { s.removeItem(SAVE_KEY); } catch (e) { /* nothing to clear */ }
  state.hasSave = false;
}

// ---------------------------------------------------------------- events into counts

const lizardOf = (e) => (e && e.lizard ? e.lizard : e);
const recOf = (lz) => (lz ? state.species[speciesKey(lz.species)] || null : null);
// the crocodiles seen (each counts once a day); a new season clears it
const crocSpotted = new Map();
let trackedN = 0;

// Rounded to the half metre the notebook shows.
export function perchHeight(lz) {
  if (!lz || !game) return 0;
  const p = lz.pos || (lz.home ? lz.home : null);
  if (!p) return 0;
  const g = game.data.terrain.heightAt(p.x, p.z);
  return Math.max(0, Math.round((p.y - Math.max(0, g)) * 2) / 2);
}

export function attach(g) {
  game = g;
  state.clock.speed = clockSpeed();
  state.hasSave = hasSave();
  loadSettings();
  const counting = () => state.phase === 'survey' || state.phase === 'setup';

  // each lizard counts once a day (its tag remembers the day), matching the toasts
  events.on('lizard:spotted', (e) => {
    const lz = lizardOf(e);
    if (!recOf(lz) || !counting()) return;
    if (lz.tag == null || typeof lz.tag !== 'object') lz.tag = {};
    if (lz.tag.countedDay === dayId) return;
    lz.tag.countedDay = dayId;
    recOf(lz).spotted++;
    state.today.spotted++;
  });
  events.on('croc:spotted', (e) => {
    const c = e && e.croc ? e.croc : e;
    if (c && typeof c === 'object') {
      if (crocSpotted.get(c) === dayId) return;
      crocSpotted.set(c, dayId);
    }
    state.species.croc.spotted++;
  });
  events.on('lizard:caught', (e) => {
    const lz = lizardOf(e);
    if (!recOf(lz)) return;
    recOf(lz).caught++;
    state.today.caught[speciesKey(lz.species)]++;
    const b = e && e.bonus;
    if (b && (b.display || b === 'display')) state.today.displayCatches++;
    if (b && (b.creep || b === 'creep')) state.today.creepCatches++;
  });
  events.on('lizard:measured', (e) => {
    const lz = lizardOf(e);
    if (!recOf(lz)) return;
    const svl = Number(e.svl ?? e.svlMm ?? e.mm ?? (lz.tag && lz.tag.svl));
    if (Number.isFinite(svl) && svl > recOf(lz).biggestSvl) recOf(lz).biggestSvl = Math.round(svl);
    if (lz.tag == null || typeof lz.tag !== 'object') lz.tag = {};
    if (Number.isFinite(svl)) lz.tag.svl = Math.round(svl);
  });
  events.on('lizard:tagged', (e) => {
    const lz = lizardOf(e);
    if (!recOf(lz)) return;
    if (state.tracked.some((t) => t.lizard === lz)) return;
    recOf(lz).tagged++;
    state.today.tagged++;
    state.inventory.backpacks = Math.max(0, state.inventory.backpacks - 1);
    trackedN++;
    const colour = (e && e.colour) || nextBackpackColour();
    const entry = {
      id: 'GPS ' + String(state.tracked.length + 1).padStart(2, '0'),
      species: speciesKey(lz.species), sex: lz.sex, colour, perch: lz.perch,
      height: e && Number.isFinite(e.height) ? e.height : perchHeight(lz), // at its perch, not in the hand
      svl: Number(e && e.svl) || (lz.tag && lz.tag.svl) || null, day: state.days + 1,
      dk: dayKey(), // (in memory only: which attempt at the day it was tagged on)
      trail: [], // the fixes downloaded so far (what the maps draw)
      fixes: [], // fixes logged on the pack, not downloaded yet
      lizard: lz,
    };
    state.tracked.push(entry);
    if (lz.tag == null || typeof lz.tag !== 'object') lz.tag = {};
    lz.tag.tracked = entry.id;
    events.emit('tracked:add', entry);
  });
  events.on('croc:snap', (e) => {
    if (state.phase !== 'survey') return;
    state.today.crocSnaps++;
    addScore(-Math.abs(Number(e && e.penalty && e.penalty.points) || RULES.points.croc), 'croc');
    const secs = (e && e.penalty && Number(e.penalty.seconds)) || RULES.crocSeconds;
    if (state.clock.running) state.clock.hours = Math.min(RULES.day.end, state.clock.hours + secs * state.clock.speed);
  });
  events.on('logger:read', () => { state.today.loggersRead++; });
  events.on('gps:download', () => { state.today.downloads++; });
  events.on('tape:measured', () => { state.today.taped++; });
  events.on('task:done', () => { if (state.phase === 'survey') state.today.tasksDone++; });

  // talks and panels hold the day's clock
  events.on('dialogue:open', () => holdClock('dialogue', true));
  events.on('dialogue:close', () => holdClock('dialogue', false));
  events.on('panel:open', (e) => holdClock('panel', true));
  events.on('panel:close', () => holdClock('panel', false));
  events.on('pause:open', () => holdClock('pause', true));
  events.on('pause:close', () => holdClock('pause', false));
}

// The next backpack colour, in turn.
export function nextBackpackColour() {
  const c = RULES.backpackColours;
  return c[state.tracked.length % c.length];
}
