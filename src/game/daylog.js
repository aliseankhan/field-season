// The survey day's own notes for the island board's notebook: each catch as it happens
// (species, sex, its SVL once measured, the perch and its height, the nearest flag, the
// time, a nickname and backpack colour if it got one, a display bonus, where it sat), the
// stamps earned, where the points came from, and the laser scans and plants recorded.
// They live in state.today.diary (state.js blankDiary), so a new day starts them afresh
// and nothing of them is saved.
//
// daySnapshot() turns the finished day (state.summary's day, just ended) into the small
// read-only notebook that goes up with a post (tools/scoreboard_server.py check_notebook
// takes exactly this shape; src/ui/daybook.js draws it): every value from the game's own
// lists or a bounded number, lists capped, positions to the half metre inside the island,
// the drone's aerial photo as a small JPEG. Nothing the player typed goes in it (their
// name travels with the day, not the notebook).
//
//   attachDayLog(game)        start listening (ui.js, once)
//   daySnapshot() -> Promise<object | null>

import { events } from '../core/events.js';
import { state, speciesKey, blankDiary, RULES } from './state.js';
import { NICKNAMES } from '../catch/tuning.js';

export const SNAPSHOT_VERSION = 1;
const SPECIES = ['crested', 'brown', 'green', 'bark', 'knight'];
const PERCHES = ['trunk', 'branch', 'ground', 'leaf', 'palm_stem', 'palm_frond', 'log', 'root'];
const DISPLAYS = ['headbob', 'pushup', 'dewlap'];
const KINDS = ['sunny', 'shady', 'dappled'];
const CODES = 'busmhdxf';
// the island's box (CONFIG.topView), as the server keeps it
const ISLAND = { x0: -62, x1: 82, z0: -50, z1: 52 };
const CAP = { catches: 60, followed: 3, runs: 40, temps: 40, trails: 5, pts: 60, stamps: 30 };
const STAMP_RE = /^(setup|crested|brown|green|bark|knight|croc|field|perch|kit)\.[a-z]{3,10}$/;
// where each kind of points goes on the notebook's summary page
const BUCKET = {
  catch: 'catch', recapture: 'catch', measured: 'catch', notes: 'catch',
  backpack: 'pack', gps: 'pack',
  logger: 'logger', loggerRead: 'logger', perch: 'logger',
  task: 'task', request: 'task',
  mission: 'kit', scan: 'kit', plant: 'kit', drone: 'kit',
  spot: 'spot', 'croc spotted': 'spot',
  croc: 'croc',
};
// the aerial photo's thumbnail: tried at these widths and qualities until it is small
// enough (the server takes 40 KB and 480 px at most)
const THUMB = [[400, 0.55], [360, 0.5], [320, 0.45], [280, 0.4]];
const THUMB_BYTES = 36000;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const half = (v) => Math.round(v * 2) / 2;
const hund = (v) => Math.round(v * 100) / 100;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const count = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };
const colour = (c) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : null);
const nick = (n) => (typeof n === 'string' && NICKNAMES.includes(n) ? n : null);
const surveying = () => state.phase === 'survey';
const diary = () => {
  const T = state.today;
  if (!T.diary || typeof T.diary !== 'object') T.diary = blankDiary();
  return T.diary;
};

// ---------------------------------------------------------------- listening

let attached = false;
let game = null;
const recOf = new WeakMap(); // lizard -> today's record of its catch

export function attachDayLog(g) {
  game = g;
  if (attached) return;
  attached = true;
  events.on('lizard:caught', (e) => {
    const lz = e && e.lizard;
    if (!surveying() || !lz) return;
    const D = diary();
    const p = lz.home || lz.pos || null;
    const rec = {
      sp: speciesKey(lz.species), sex: lz.sex === 'm' || lz.sex === 'f' ? lz.sex : null, svl: null,
      perch: e.seen || e.perch || lz.perch || null, h: num(e.height) ?? 0, flag: null,
      t: state.clock.hours, nick: null, pack: null, disp: (e.bonus && e.bonus.display) || null,
      x: p ? num(p.x) : null, z: p ? num(p.z) : null,
    };
    D.catches.push(rec);
    if (D.catches.length > 80) D.catches.shift();
    recOf.set(lz, rec);
  });
  events.on('lizard:measured', (e) => {
    const rec = e && e.lizard ? recOf.get(e.lizard) : null;
    const svl = Number(e && e.svl);
    if (rec && Number.isFinite(svl)) rec.svl = Math.round(svl);
  });
  events.on('lizard:tagged', (e) => {
    const rec = e && e.lizard ? recOf.get(e.lizard) : null;
    if (rec) rec.pack = colour(e.colour);
  });
  // a perch logger's lizard gets a nickname too (its card comes before the release)
  events.on('perch:clip', (e) => {
    const rec = e && e.lizard ? recOf.get(e.lizard) : null;
    if (rec && !rec.nick && e.entry) rec.nick = nick(e.entry.nick);
  });
  // by the release its flag, backpack and nickname are known
  events.on('lizard:released', (e) => {
    const lz = e && e.lizard;
    const rec = lz ? recOf.get(lz) : null;
    if (!rec) return;
    const tag = lz.tag && typeof lz.tag === 'object' ? lz.tag : {};
    if (typeof tag.flag === 'string') rec.flag = tag.flag;
    if (tag.nickname) rec.nick = nick(tag.nickname) || rec.nick;
    if (tag.packColour && !rec.pack && (state.tracked || []).some((t) => t.lizard === lz)) rec.pack = colour(tag.packColour);
    if (!rec.svl && Number.isFinite(tag.svl)) rec.svl = Math.round(tag.svl);
  });
  events.on('task:done', (e) => {
    if (!surveying() || !e || typeof e.id !== 'string') return;
    const S = diary().stamps;
    if (!S.includes(e.id)) S.push(e.id);
  });
  events.on('score:add', (e) => {
    if (!surveying() || !e || !Number.isFinite(e.points)) return;
    const k = BUCKET[e.reason] || 'other';
    const P = diary().points;
    P[k] = (P[k] || 0) + Math.abs(Math.round(e.points));
  });
  events.on('mission:step', (e) => {
    if (!surveying() || !e) return;
    const D = diary();
    if (e.id === 'tls' && e.step === 'scanned') D.scans.push({ stars: count(e.stars), ghosts: count(e.ghosts) });
    else if (e.id === 'rtk' && e.step === 'logged') { D.plants++; if (e.right) D.named++; }
  });
}

// ---------------------------------------------------------------- the snapshot

// n evenly spaced items of a list, the first and last kept
function spread(list, n) {
  if (list.length <= n) return list.slice();
  const out = [];
  for (let i = 0; i < n; i++) out.push(list[Math.round(i * (list.length - 1) / (n - 1))]);
  return out;
}
// a followed lizard's temperatures, thinned, with its warmest and coolest kept
function thinTemps(temps) {
  const pts = temps.filter((p) => Array.isArray(p) && num(p[0]) != null && num(p[1]) != null);
  if (pts.length <= CAP.temps) return pts;
  let hi = 0, lo = 0;
  pts.forEach((p, i) => { if (p[1] > pts[hi][1]) hi = i; if (p[1] < pts[lo][1]) lo = i; });
  const idx = new Set();
  for (let i = 0; i < CAP.temps; i++) idx.add(Math.round(i * (pts.length - 1) / (CAP.temps - 1)));
  for (const k of [hi, lo]) {
    if (idx.has(k)) continue;
    let near = null;
    for (const j of idx) if (j !== 0 && j !== pts.length - 1 && (near == null || Math.abs(j - k) < Math.abs(near - k))) near = j;
    if (near != null) { idx.delete(near); idx.add(k); }
  }
  return [...idx].sort((a, b) => a - b).map((i) => pts[i]);
}
// a followed lizard's spells as runs (one entry a change of letter)
function runsOf(states) {
  const out = [];
  for (const p of Array.isArray(states) ? states : []) {
    if (!Array.isArray(p) || num(p[0]) == null || typeof p[1] !== 'string' || !CODES.includes(p[1]) || p[1].length !== 1) continue;
    if (out.length && out[out.length - 1][1] === p[1]) continue;
    out.push([clamp(hund(p[0]), 0, 24), p[1]]);
  }
  return out.slice(0, CAP.runs);
}
const place = (v, a, b) => clamp(half(v), a, b);

// the drone's photo from this day, as a small JPEG data URL (null when there is none)
async function aerialThumb(day) {
  const rec = state.missions && state.missions.drone;
  const d = rec && rec.data;
  if (!d || typeof d.photo !== 'string' || !d.photo.startsWith('data:image/') || typeof d.stamp !== 'string') return null;
  if (!d.stamp.startsWith(`DAY ${day} `)) return null; // a photo from another day
  try {
    const img = new Image();
    img.src = d.photo;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight) return null;
    for (const [w0, q] of THUMB) {
      const w = Math.min(w0, img.naturalWidth);
      const h = Math.round(w * img.naturalHeight / img.naturalWidth);
      if (h > 480) continue;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      const url = c.toDataURL('image/jpeg', q);
      if (url.startsWith('data:image/jpeg;base64,') && (url.length - 23) * 0.75 <= THUMB_BYTES) return url;
    }
  } catch (e) { /* no photo then */ }
  return null;
}

// The day just finished as the notebook the board keeps. state.days is its number now.
export async function daySnapshot({ photo = true } = {}) {
  const T = state.today || {};
  const D = T.diary || blankDiary();
  const day = Math.max(1, state.days || 1);
  const caught = (state.summary && state.summary.caught) || T.caught || {};
  const tagged = Math.min(5, count((state.summary && state.summary.tagged) ?? T.tagged));
  const out = { v: SNAPSHOT_VERSION, day };
  const looks = {};
  if (colour(state.looks && state.looks.hat)) looks.hat = colour(state.looks.hat);
  if (colour(state.looks && state.looks.shirt)) looks.shirt = colour(state.looks.shirt);
  out.looks = looks;
  // where the score came from, adding up to the day's score (the server holds it to that):
  // the croc's snaps as what they really took (the score never goes below nothing), and
  // any points the notes missed as "other"
  const score = count((state.summary && state.summary.score) ?? state.score);
  const parts = {};
  for (const [k, v] of Object.entries(D.points || {})) if (k !== 'croc' && count(v)) parts[k] = Math.min(20000, count(v));
  const earned = Object.values(parts).reduce((a, v) => a + v, 0);
  let croc = Math.min(count(D.points && D.points.croc), earned);
  if (earned - croc > score) croc = earned - score;
  if (croc > 5000) { for (const k of Object.keys(parts)) delete parts[k]; croc = 0; } // (can't be told apart)
  if (croc) parts.croc = croc;
  const net = Object.entries(parts).reduce((a, [k, v]) => a + (k === 'croc' ? -v : v), 0);
  if (net < score) parts.other = Math.min(20000, (parts.other || 0) + score - net);
  out.parts = parts;
  out.work = {
    spotted: Math.min(999, count(T.spotted)), loggers: Math.min(999, count(T.loggersRead)), gps: Math.min(999, count(T.downloads)),
    clipped: Math.min(999, count(T.perchClipped)), taped: Math.min(999, count(T.taped)),
  };

  // the catches: never more of a species, or more backpacks, than the day counted
  const per = {};
  let packs = 0;
  out.catches = [];
  for (const c of D.catches || []) {
    if (out.catches.length >= CAP.catches) break;
    if (!SPECIES.includes(c.sp) || num(c.x) == null || num(c.z) == null || num(c.t) == null) continue;
    if ((per[c.sp] || 0) >= count(caught[c.sp])) continue;
    per[c.sp] = (per[c.sp] || 0) + 1;
    let pack = colour(c.pack);
    if (pack && packs >= tagged) pack = null;
    if (pack) packs++;
    out.catches.push({
      sp: c.sp, sex: c.sex === 'm' || c.sex === 'f' ? c.sex : null,
      svl: num(c.svl) != null ? clamp(Math.round(c.svl), 10, 250) : null,
      perch: PERCHES.includes(c.perch) ? c.perch : null, h: place(num(c.h) ?? 0, 0, 30),
      flag: typeof c.flag === 'string' && /^[A-Z][0-9]{2}$/.test(c.flag) ? c.flag : null,
      t: clamp(hund(c.t), 0, 24), nick: nick(c.nick), pack, disp: DISPLAYS.includes(c.disp) ? c.disp : null,
      x: place(c.x, ISLAND.x0, ISLAND.x1), z: place(c.z, ISLAND.z0, ISLAND.z1),
    });
  }

  // the lizards followed with a perch logger today (perch_day.js todaysStories)
  const stories = (state.followed || []).filter((f) => f && !f.cut && f.day === state.days && ((f.dl && f.dl.length) || f.end));
  out.followed = stories.slice(0, CAP.followed).filter((f) => SPECIES.includes(f.sp) && num(f.clip) != null).map((f) => {
    const clip = clamp(hund(f.clip), 0, 24);
    return {
      nick: nick(f.nick), sp: f.sp, sex: f.sex === 'm' || f.sex === 'f' ? f.sex : null, col: colour(f.col) || '#ff7b54',
      kind: KINDS.includes(f.kind) ? f.kind : 'dappled', perch: PERCHES.includes(f.seen) ? f.seen : PERCHES.includes(f.perch) ? f.perch : null,
      h: place(num(f.h) ?? 0, 0, 30), clip, upto: clamp(hund(num(f.upto) ?? clip), clip, 24), whole: f.whole === true,
      runs: runsOf(f.states),
      temps: thinTemps(Array.isArray(f.temps) ? f.temps : []).map((p) => [clamp(hund(p[0]), 0, 24), clamp(Math.round(p[1] * 10) / 10, -10, 60)]),
    };
  });

  // the GPS trails of the lizards backpacked on this very day (state.tracked entries carry
  // the dayKey() they were tagged on, in memory only: a day restarted after a reload or a
  // return to the title leaves out the tags of the attempt it replaced), two fixes or more
  const key = T.key || 0;
  out.trails = (state.tracked || []).filter((t) => t && key && t.dk === key && SPECIES.includes(t.species) && colour(t.colour))
    .map((t) => {
      const pts = [...(Array.isArray(t.trail) ? t.trail : []), ...(Array.isArray(t.fixes) ? t.fixes : [])]
        .filter((p) => Array.isArray(p) && num(p[0]) != null && num(p[1]) != null);
      return {
        nick: nick(t.nickname), sp: t.species, pack: colour(t.colour),
        pts: spread(pts, CAP.pts).map((p) => [place(p[0], ISLAND.x0, ISLAND.x1), place(p[1], ISLAND.z0, ISLAND.z1)]),
      };
    })
    .filter((t) => t.pts.length >= 2).slice(0, Math.min(CAP.trails, tagged));

  // the stamps, never more of the survey day's than its points for them (each scores
  // RULES.points.task; the set-up day's score nothing)
  let paid = Math.floor((parts.task || 0) / ((RULES.points && RULES.points.task) || 100));
  out.stamps = [...new Set((D.stamps || []).filter((id) => typeof id === 'string' && STAMP_RE.test(id)))]
    .filter((id) => id.startsWith('setup.') || paid-- > 0).slice(0, CAP.stamps);

  // the field kit done today: the drone's stars and photo, the scans and their ghosts,
  // the plants recorded
  const K = T.kit || {};
  const kit = {};
  const stars = (id) => clamp(count(K[id]), 0, 3);
  if (stars('drone')) kit.drone = { stars: stars('drone'), photo: photo ? await aerialThumb(day) : null };
  const scans = (D.scans || []).slice(0, 20);
  if (scans.length || stars('tls')) kit.tls = { stars: stars('tls'), scans: scans.length, ghosts: Math.min(60, scans.reduce((a, s) => a + count(s.ghosts), 0)) };
  if (D.plants || stars('rtk')) kit.rtk = { stars: stars('rtk'), plants: Math.min(30, count(D.plants)), right: Math.min(30, count(D.named), count(D.plants)) };
  out.kit = kit;
  return out;
}

// for scripted checks
export const dayLogState = () => ({ attached, diary: state.today && state.today.diary, game: !!game });
