// The perch loggers' pages (src/tools/perch_loggers.js keeps the data; this file only
// draws it): the "day in temperature" card that opens when a perch logger downloads,
// the drawing the clip card and the notebook share (the lizard on its perch with its
// button logger), the day's chart with the lizard's own day under it, the tiny map of
// its trail, the one friendly sentence that sums the day up, and the notebook's
// "Followed lizards" spreads.
//
// No coordinates, ids or dates are ever shown: a trail is drawn on the island map round
// the perch while this session knows where the perch is (HOMES), else as a sketch on
// squared paper from the saved offsets.
//
//   registerDayCard(game)          the 'perchday' panel: kit.openPanel('perchday', { entry, points })
//   perchScene(o) -> { svg, tray, spot }   the lizard on its perch, the logger in a tray or clipped
//   dayChart(entry, opts)          SVG string: the perch's temperature and the lizard's day
//   daySentence(entry, upto)       "Mango basked here till 10:30, then slipped round to the shady side."
//   lineOf(entry)                  the sentence a card shows (worked out afresh from its spells)
//   notesLine(entry), perchPlace(entry)   the notebook's line of notes; "tree trunk, 2.5 m up"
//   todaysStories()                the day just finished's stories, for the end-of-day card
//   followPagesList(), followIndexPages(ctx), followLifePages(entry, ctx), drawFollowMaps(spread, id, game),
//   followSignature(id), followEntry(id)   the notebook's section (src/ui/notebook.js)
//   HOMES                          entry.k -> { x, z } of its perch, this session only (never saved)

import { state, clockText } from '../game/state.js';
import { registerPanel, openPanel, closePanel, stampEl } from './kit.js';
import { icon, escapeHtml } from './icons.js';
import { jamesPortrait } from './drawings.js';
import { anoleSide, anoleBadge } from '../catch/drawings.js';
import { SPECIES_NAMES, PERCH_WORDS } from '../catch/tuning.js';
import { WARM_RGB, COOL_RGB } from '../tools/loggers.js';
import { SCRIPT } from '../story/script.js';

const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
export const WARM = hex(WARM_RGB), COOL = hex(COOL_RGB); // the loggers' warm and cool, as the maps draw them
const OUT = '#3a2f2a';
const SCI = { crested: 'cristatellus', brown: 'sagrei', green: 'carolinensis', bark: 'distichus', knight: 'equestris' };
export const sciOf = (sp) => SCI[sp] || sp;
export const commonOf = (sp) => { const n = SPECIES_NAMES[sciOf(sp)]; return n ? n.common : String(sp || 'lizard'); };
const cap = (s) => String(s).replace(/^./, (m) => m.toUpperCase());
const SEX = { m: 'male', f: 'female' };
const T = (h) => clockText(h);

// entry.k -> { x, z } of its perch while this session knows it (perch_loggers.js fills it)
export const HOMES = new Map();

// ---------------------------------------------------------------- the lizard's day

// What a followed lizard was doing, one letter a spell (perch_loggers.js records them):
// b basking, u walked round into the sun, s in the sun, h too hot in full sun, d in the
// shade, m moved round to the shady side, x tucked away out of sight (sheltering from the
// heat), f hid from you (or dashed for cover)
export const CODES = {
  b: { cls: 'sun', word: 'Basking', fill: WARM },
  u: { cls: 'sun', word: 'Basking', fill: WARM, moved: true },
  s: { cls: 'sun', word: 'In the sun', fill: '#ffd29c' },
  h: { cls: 'sun', word: 'Too hot', fill: '#ff8f6b' },
  d: { cls: 'shade', word: 'In the shade', fill: COOL },
  m: { cls: 'shade', word: 'In the shade', fill: COOL, moved: true },
  x: { cls: 'hide', word: 'Tucked away', fill: '#c7bddf' },
  f: { cls: 'fled', word: 'Hid from you', fill: '#d6cdb8' },
};

// The spells between from and to (clock hours): [{ code, from, to }], each run of one
// letter merged.
export function segments(entry, upto = entry.upto) {
  const out = [];
  const S = entry.states || [];
  if (!S.length || !Number.isFinite(upto)) return out;
  for (let i = 0; i < S.length; i++) {
    // the first spell runs from the clip (it was let go onto its perch then)
    const a = i === 0 ? entry.clip : Math.max(entry.clip, S[i][0]);
    const b = Math.min(upto, i + 1 < S.length ? S[i + 1][0] : upto);
    if (b <= a + 1e-4) continue;
    const code = CODES[S[i][1]] ? S[i][1] : 'd';
    const last = out[out.length - 1];
    if (last && last.code === code && Math.abs(last.to - a) < 1e-3) last.to = b;
    else out.push({ code, from: a, to: b });
  }
  return out;
}

// Hours in each kind of spell, and how many times it hid from the player.
export function dayTotals(entry, upto = entry.upto) {
  const t = { bask: 0, sun: 0, shade: 0, hide: 0, fled: 0, flights: 0 };
  for (const s of segments(entry, upto)) {
    const d = s.to - s.from;
    if (s.code === 'b' || s.code === 'u') t.bask += d;
    else if (s.code === 's' || s.code === 'h') t.sun += d;
    else if (s.code === 'd' || s.code === 'm') t.shade += d;
    else if (s.code === 'x') t.hide += d;
    else if (s.code === 'f') { t.fled += d; t.flights++; }
  }
  return t;
}

// The day as runs of sun, shade and hiding: a moment's fright folded into what came
// before, and spells under `min` hours folded into the spell before them. The first
// spell is never folded into a later one of another kind (it began at the clip, as the
// clip card saw the perch): daySentence tells a short one as "After a quick bask,". Each
// run keeps the letter it began with (c0) and ended with (c1), so the sentence knows
// whether the lizard walked round into the sun or the sun came to it (hot: all of it too
// hot in full sun).
function dayRuns(entry, upto, min = 0.2) {
  let runs = [];
  let lead = null; // a fright right at the clip belongs to the spell after it
  for (const s of segments(entry, upto)) {
    const c = CODES[s.code];
    if (c.cls === 'fled') {
      if (runs.length) runs[runs.length - 1].to = s.to;
      else if (lead == null) lead = s.from;
      continue;
    }
    const last = runs[runs.length - 1];
    const bask = s.code === 'b' || s.code === 'u';
    const hot = s.code === 'h';
    if (last && last.cls === c.cls) { last.to = s.to; last.moved = last.moved || !!c.moved; last.bask = last.bask || bask; last.hot = last.hot && hot; last.c1 = s.code; continue; }
    runs.push({ cls: c.cls, from: !runs.length && lead != null ? lead : s.from, to: s.to, moved: !!c.moved, bask, hot, c0: s.code, c1: s.code });
  }
  for (let pass = 0; pass < 4; pass++) {
    const out = [];
    for (const r of runs) {
      const prev = out[out.length - 1];
      if (prev && prev.cls === r.cls) {
        prev.to = r.to; prev.moved = prev.moved || r.moved; prev.bask = prev.bask || r.bask; prev.hot = prev.hot && r.hot; prev.c1 = r.c1;
        continue;
      }
      // a flicker of sun or shade folds into the spell before it
      if (prev && r.to - r.from < min) { prev.to = r.to; continue; }
      out.push({ ...r });
    }
    runs = out;
  }
  return runs;
}

// the same story always gets the same wording
function pickOf(e, n) {
  let h = (Number.isFinite(e.k) ? e.k : 0) * 31;
  for (const ch of String(e.nick || '')) h = (h * 33 + ch.charCodeAt(0)) % 100003;
  return Math.abs(h) % n;
}

// How the perch's temperature went from the clip to `upto`, in words that follow "its
// perch": { kind: 'warm' | 'peak' | 'cool' | 'flat' | 'range', text }, or null. `past`
// for a day that is over, else "has warmed".
const deg = (v) => `${Math.round(v)}\u00a0°C`;
function tempWords(e, upto, past) {
  const pts = (e.temps || []).filter((p) => p[0] >= e.clip - 1e-6 && p[0] <= upto + 1e-6);
  if (pts.length < 4) return null;
  let hi = pts[0][1], lo = pts[0][1];
  for (const p of pts) { if (p[1] > hi) hi = p[1]; if (p[1] < lo) lo = p[1]; }
  const first = pts[0][1], last = pts[pts.length - 1][1];
  const has = past ? '' : 'has ';
  if (hi - lo < 1.5) return { kind: 'flat', text: `${has}stayed at about ${deg((hi + lo) / 2)}` };
  if (hi - first >= 1.2 && hi - last >= 1.2) return { kind: 'peak', text: `${has}warmed to ${deg(hi)} and cooled again` };
  if (hi - first >= 1 && last >= first) return { kind: 'warm', text: `${has}warmed from ${Math.round(first)} to ${deg(hi)}` };
  if (first - last >= 1) return { kind: 'cool', text: `${has}cooled from ${Math.round(first)} to ${deg(last)}` };
  return { kind: 'range', text: `${has}stayed between ${Math.round(lo)} and ${deg(hi)}` };
}

// A day spent in one kind of spell: a few wordings, with the perch's own temperature for
// colour. after: a short first spell was told already ("After a quick bask, ").
function flatDay(e, a, upto, name, after) {
  const whole = e.clip < 10 && upto >= 16 - 1e-6;
  const pp = (past, perfect) => (whole ? past : perfect);
  const span = whole ? (after ? 'for the rest of the day' : 'all day') : `since ${T(a.from)}`;
  const tw = tempWords(e, upto, whole);
  const warming = tw && (tw.kind === 'warm' || tw.kind === 'peak');
  if (a.cls === 'shade') {
    if (a.moved) return `${name} ${pp('dodged', 'has dodged')} the sun ${span}, slipping round to the shady side of its perch whenever the sun came round.`;
    const v = pickOf(e, 3);
    if (v === 1 && warming) return `${name} ${pp('stayed', 'has stayed')} cool in the shade ${span}, though its perch ${tw.text}.`;
    if (v === 2 && warming) return `${name} ${pp('never left', 'hasn\'t left')} the shade ${span}, even as its perch ${tw.text}. Very sensible!`;
    return `${name} ${pp('kept', 'has kept')} to the shade ${span}${tw ? `, while its perch ${tw.text}` : ''}. A cool customer!`;
  }
  if (a.cls === 'sun') {
    const with_ = tw && tw.kind !== 'flat' && tw.kind !== 'range' ? ` as its perch ${tw.text}` : '';
    if (a.c0 === 'u') {
      return whole ? `${name} walked round into the sun and ${a.bask ? 'basked' : 'sat'} there ${after ? 'for the rest of the day' : 'all day'}${with_}.`
        : `${name} has ${a.bask ? 'basked' : 'sat'} round on the sunny side since ${T(a.from)}${with_}.`;
    }
    if (a.bask) return `${name} ${pp('basked', 'has basked')} here ${span}, soaking up every bit of sun${with_}.`;
    return `${name} ${pp('sat', 'has sat')} in the sun here ${span}${tw ? `, while its perch ${tw.text}` : ''}.`;
  }
  return `${name} ${pp('stayed', 'has stayed')} tucked away out of the heat ${span}.`;
}

// One friendly sentence for the day so far: how it started, the turns in between (two at
// most, joined with commas and one "then") and where it was by the end. The lizard is
// the one doing everything in it, so every clause reads right after the name.
export function daySentence(entry, upto = entry.upto) {
  const name = entry.nick || 'It';
  // spells under half an hour fold into the one before them, so a short flicker of sun
  // or shade never turns the sentence into a list
  let min = 0.5, runs = dayRuns(entry, upto, min);
  // a changeable day: fold longer spells too, till it is four turns at most
  while (runs.length > 4 && min < 3) { min *= 1.5; runs = dayRuns(entry, upto, min); }
  if (!runs.length) return `${name}'s logger has only just started. Walk past again later!`;
  // a short first spell (it was let go onto its perch then) is told first, then the day
  const seen = new Set();
  let pre = '';
  if (runs.length > 1 && runs[0].to - runs[0].from < 0.5) {
    const b = runs.shift();
    seen.add(b.cls);
    pre = b.cls === 'sun' ? (b.bask ? 'After a quick bask, ' : 'After a few minutes in the sun, ')
      : b.cls === 'shade' ? 'After a few minutes in the shade, ' : 'After a moment tucked away, ';
  }
  const a = runs[0];
  if (runs.length === 1) return pre + flatDay(entry, a, upto, name, !!pre);
  seen.add(a.cls);
  const lead = a.cls === 'sun'
    ? (a.c0 === 'u' ? `${name} walked round into the sun and ${a.bask ? 'basked' : 'sat'} there` : a.bask ? `${name} basked here` : `${name} sat in the ${a.hot ? 'hot ' : ''}sun here`)
    : a.cls === 'shade' ? (a.c0 === 'm' ? `${name} slipped round to the shady side and stayed there` : `${name} kept to the shade`)
    : `${name} stayed tucked away`;
  // what it did next, always with the lizard as the one doing it
  const verb = (r, prev) => {
    const again = seen.has(r.cls);
    if (r.cls === 'shade') {
      if (prev.cls === 'hide') return 'came back out into the shade';
      if (prev.c1 === 'u' && r.c0 !== 'm') return 'went back round to its shady side';
      return r.c0 === 'm' ? 'slipped round to the shady side' : 'let the shade creep over its perch';
    }
    // (it only ever tucks itself away from the heat: the sun on its perch at midday)
    if (r.cls === 'hide') return `tucked itself away out of the heat${again ? ' again' : ''}`;
    if (prev.cls === 'hide') return r.bask ? 'came back out to bask' : 'came back out into the sun';
    if (r.c0 === 'u') return `walked round into the sun${r.bask ? ' to bask' : ''}${again ? ' again' : ''}`;
    if (r.hot) return 'sat on in the hot sun';
    return r.bask ? `got the sun on its perch for ${again ? 'another' : 'a good'} bask` : `had the sun on its perch${again ? ' again' : ''}`;
  };
  // the spells between the first and the last (all of them when there are only two)
  const rest = runs.slice(1);
  const last = rest.length >= 2 ? rest[rest.length - 1] : null;
  const mid = last ? rest.slice(0, -1) : rest;
  let s = `${pre}${lead} till ${T(a.to)}`;
  let prev = a;
  mid.forEach((r, i) => { s += `${i ? ', ' : ', then '}${verb(r, prev)}`; seen.add(r.cls); prev = r; });
  if (last) {
    const back = seen.has(last.cls);
    const was = last.cls === 'sun' ? `${back ? 'back' : 'out'} ${last.bask ? 'basking' : 'in the sun'}`
      : last.cls === 'shade' ? `${back ? 'back ' : ''}in the shade` : `tucked away${back ? ' again' : ''}`;
    s += `, and was ${was} by ${T(last.from)}`;
  }
  return s + '.';
}

// The sentence a card or page shows: worked out afresh from the story's spells (so an
// older story reads in today's words), else the one saved with it.
export function lineOf(e) {
  if (e && Array.isArray(e.states) && e.states.length && Number.isFinite(e.upto)) return daySentence(e, e.upto);
  return (e && e.line) || daySentence(e);
}

const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
// "2.5 m up" (the number and its unit never split over two lines), "just off the ground"
export function heightWords(h) {
  if (!(h > 0.1)) return 'on the ground';
  const r = Math.round(h * 2) / 2;
  if (r < 0.5) return 'just off the ground';
  return `${String(r).replace(/\.0$/, '')}\u00a0m up`;
}
export function perchWords(e) {
  return PERCH_WORDS[e.seen] || PERCH_WORDS[e.perch] || 'perch';
}
const onTheGround = (e) => (e.seen || e.perch) === 'ground';
// "tree trunk, 2.5 m up", "on the ground", "log, just off the ground"
export function perchPlace(e) {
  if (onTheGround(e)) return 'on the ground';
  return `${perchWords(e)}, ${heightWords(e.h)}`;
}
const KIND_WORD = { sunny: 'sunny', shady: 'shady', dappled: 'dappled' };
const NO_ARTICLE = new Set(['ground', 'roots', 'leaves']); // "on sunny ground", "on dappled leaves"

// The notebook's line of notes: when and where it was clipped, the downloads, a fright or
// two, and how far its backpack says it went.
export function notesLine(e) {
  const parts = [];
  const w = perchWords(e), kind = KIND_WORD[e.kind] || 'dappled';
  const where = `${NO_ARTICLE.has(w) ? '' : 'a '}${kind} ${w}`;
  parts.push(`Clipped at ${T(e.clip)} on ${where}${onTheGround(e) || !(e.h > 0.1) ? '' : `, ${heightWords(e.h)}`}.`);
  const n = (e.dl || []).length;
  if (n) parts.push(`Downloaded ${times(n)}, last at ${T(e.dl[n - 1])}${e.end ? ', then picked up at the end of the day' : ''}.`);
  else if (e.end) parts.push('Picked up at the end of the day without a download.');
  else parts.push('Not downloaded yet: walk past its perch.');
  if (e.flights) parts.push(`It hid from you ${times(e.flights)}.`);
  if (e.pack && e.dist > 0.4) parts.push(`Its backpack says it wandered ${Math.round(e.dist)}\u00a0m.`);
  if (e.whole) parts.push('Followed from morning to late afternoon!');
  return parts.join(' ');
}

// Today's followed lizards for the end-of-day card: downloaded or picked up at the day's
// end, on the day just finished, and not from an attempt at it that was left unfinished
// (cut: back to the title or a reload before the day ended).
export function todaysStories() {
  return (state.followed || []).filter((f) => f && !f.cut && f.day === state.days && ((f.dl && f.dl.length) || f.end));
}

// ---------------------------------------------------------------- the lizard on its perch

let uid = 0;
// The button logger: a coloured coin with a steel rim and a little paper tag.
function coinSVG(colour, r = 15) {
  return `<path d="M${r * 0.35} ${r * 0.8} Q ${r * 0.5} ${r * 1.4} ${r * 0.75} ${r * 1.75}" stroke="${OUT}" stroke-width="1.4" fill="none"/>` +
    `<g transform="translate(${r * 0.72} ${r * 1.7}) rotate(10)"><rect x="-${r * 0.45}" y="0" width="${r * 0.95}" height="${r * 1.35}" rx="${r * 0.14}" fill="#fff6dc" stroke="${OUT}" stroke-width="1.6"/>` +
    `<path d="M-${r * 0.25} ${r * 0.42} h${r * 0.55} M-${r * 0.25} ${r * 0.78} h${r * 0.4}" stroke="#b9a37a" stroke-width="1.4" stroke-linecap="round"/></g>` +
    `<circle r="${r}" fill="#c9ced3" stroke="${OUT}" stroke-width="2.2"/>` +
    `<circle r="${r * 0.78}" fill="${colour}" stroke="${OUT}" stroke-width="1.2" opacity="0.98"/>` +
    `<circle r="${r * 0.5}" fill="none" stroke="#fff" stroke-width="1.5" opacity="0.55"/>` +
    `<path d="M-${r * 0.5} -${r * 0.25} A ${r * 0.55} ${r * 0.55} 0 0 1 -${r * 0.05} -${r * 0.55}" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" opacity="0.8"/>`;
}
export const coinIcon = (colour, size = 1.2) =>
  `<svg class="pl-coin-ic" viewBox="-17 -17 34 34" style="width:${size}em;height:${size}em" aria-hidden="true"><circle r="15" fill="#c9ced3" stroke="${OUT}" stroke-width="2.4"/><circle r="11.7" fill="${colour}" stroke="${OUT}" stroke-width="1.2"/><circle r="7.5" fill="none" stroke="#fff" stroke-width="1.6" opacity="0.55"/></svg>`;

// perch groups for the drawing
const GROUP = { trunk: 'trunk', palm_stem: 'trunk', root: 'trunk', branch: 'branch', log: 'log', leaf: 'leaf', palm_frond: 'leaf', ground: 'ground' };

// o: { sp (short or sci), sex, mark, pack, perch, seen, kind ('sunny' | 'shady' | 'dappled'),
//      colour (the logger's), clipped (on the perch, else in the tray), left (pips by the
//      tray), h (height, m) }
// -> { svg, tray: { x, y }, spot: { x, y } } in the drawing's own units (520 x 220)
export function perchScene(o) {
  const id = 'pls' + (++uid);
  const sp = sciOf(o.sp);
  const group = GROUP[o.seen] || GROUP[o.perch] || 'trunk';
  const kind = o.kind || 'dappled';
  const W = 520, H = 220;
  const parts = [];
  // the light: warm sun, cool leaf shade, or dappled
  const bg = kind === 'sunny' ? ['#fff4d6', '#ffe6b0'] : kind === 'shady' ? ['#dcefe8', '#c4e0d6'] : ['#f1f3dc', '#e2ecc6'];
  parts.push(`<defs><linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></linearGradient></defs>`);
  parts.push(`<rect width="${W}" height="${H}" fill="url(#${id}b)"/>`);
  if (kind === 'sunny') {
    parts.push(`<g opacity="0.9"><circle cx="58" cy="44" r="22" fill="#ffd45a" stroke="#f3a93a" stroke-width="3"/>` +
      Array.from({ length: 8 }, (_, k) => { const a = k * Math.PI / 4; return `<path d="M${(58 + Math.cos(a) * 30).toFixed(1)} ${(44 + Math.sin(a) * 30).toFixed(1)} L${(58 + Math.cos(a) * 39).toFixed(1)} ${(44 + Math.sin(a) * 39).toFixed(1)}" stroke="#f3a93a" stroke-width="4" stroke-linecap="round"/>`; }).join('') + '</g>');
    parts.push('<path d="M90 0 L180 220 L250 220 L130 0 Z" fill="#fff" opacity="0.28"/>');
  } else if (kind === 'shady') {
    parts.push('<g fill="#5fae78" opacity="0.28"><ellipse cx="70" cy="-8" rx="120" ry="44"/><ellipse cx="300" cy="-14" rx="150" ry="46"/><ellipse cx="480" cy="-4" rx="90" ry="40"/></g>');
    parts.push('<g fill="#2f6b4a" opacity="0.08"><ellipse cx="120" cy="120" rx="60" ry="30"/><ellipse cx="380" cy="80" rx="70" ry="26"/></g>');
  } else {
    parts.push('<g fill="#5fae78" opacity="0.2"><ellipse cx="90" cy="-10" rx="110" ry="40"/><ellipse cx="420" cy="-12" rx="120" ry="42"/></g>');
    parts.push('<g fill="#fff" opacity="0.4"><ellipse cx="150" cy="110" rx="26" ry="12"/><ellipse cx="340" cy="60" rx="20" ry="9"/><ellipse cx="260" cy="170" rx="30" ry="12"/></g>');
  }
  const big = sp === 'equestris';
  const len = big ? 96 : 76; // px of snout-vent length
  const lz = (x, y, facing = 1) => anoleSide(sp, { x, y, len, facing, sex: o.sex || 'm', mark: o.mark || null, pack: o.pack || null });
  let spot;
  if (group === 'trunk') {
    // a trunk up the middle, the lizard head up on its left edge, the logger on its face
    const x0 = 196, x1 = 282;
    const palm = (o.seen || o.perch) === 'palm_stem';
    parts.push(`<rect x="${x0}" y="-10" width="${x1 - x0}" height="${H + 20}" fill="${palm ? '#b69a6e' : '#9b7b5c'}" stroke="#6e5238" stroke-width="4"/>`);
    if (palm) for (let y = 8; y < H; y += 26) parts.push(`<path d="M${x0 + 3} ${y} Q ${(x0 + x1) / 2} ${y + 9} ${x1 - 3} ${y}" stroke="#8a6f4a" stroke-width="3" fill="none"/>`);
    else {
      parts.push(`<path d="M${x0 + 18} 0 q -6 60 4 110 t -2 120 M${x0 + 46} 10 q 8 50 -2 100 t 4 110 M${x1 - 14} -4 q -5 70 3 120 t -3 110" stroke="#7d5f43" stroke-width="3" fill="none" stroke-linecap="round"/>`);
      parts.push(`<ellipse cx="${x0 + 62}" cy="176" rx="8" ry="4" fill="#bccb9b" opacity="0.8"/><ellipse cx="${x0 + 30}" cy="40" rx="6" ry="3" fill="#bccb9b" opacity="0.8"/>`);
    }
    const ly = big ? 22 : 30;
    parts.push(`<g transform="translate(${x0 - 13} ${ly}) rotate(-90)">${lz(0, 0, 1)}</g>`);
    spot = { x: x0 + 52, y: ly + len * 0.62 };
  } else if (group === 'branch' || group === 'log') {
    const log = group === 'log';
    const y = log ? 168 : 152, w = log ? 40 : 22;
    if (log) {
      parts.push(`<rect x="-10" y="${y - w / 2}" width="440" height="${w}" rx="${w / 2}" fill="#9b7b5c" stroke="#6e5238" stroke-width="4"/>`);
      parts.push(`<ellipse cx="430" cy="${y}" rx="${w * 0.32}" ry="${w / 2}" fill="#d9b98c" stroke="#6e5238" stroke-width="4"/><ellipse cx="430" cy="${y}" rx="${w * 0.14}" ry="${w * 0.24}" fill="none" stroke="#a57e55" stroke-width="2"/>`);
    } else {
      parts.push(`<path d="M-10 ${y} C 100 ${y - 6}, 250 ${y - 4}, 440 ${y + 8}" stroke="#6e5238" stroke-width="${w + 8}" fill="none" stroke-linecap="round"/>`);
      parts.push(`<path d="M-10 ${y} C 100 ${y - 6}, 250 ${y - 4}, 440 ${y + 8}" stroke="#9b7b5c" stroke-width="${w}" fill="none" stroke-linecap="round"/>`);
      parts.push(`<path d="M380 ${y + 4} q 22 -26 48 -30" stroke="#6e5238" stroke-width="8" fill="none" stroke-linecap="round"/><path d="M426 ${y - 28} c 10 -12 26 -9 28 3 c -10 9 -24 9 -28 -3z" fill="#7ccb6a" stroke="#3f8f3a" stroke-width="2"/>`);
    }
    const top = y - w / 2;
    parts.push(lz(300, top - 17, 1));
    spot = { x: 352, y: y + (log ? 2 : 1) };
  } else if (group === 'leaf') {
    const y = 160;
    parts.push(`<path d="M-20 ${y + 30} C 60 ${y - 40}, 300 ${y - 50}, 470 ${y - 6} C 330 ${y + 40}, 120 ${y + 50}, -20 ${y + 30} Z" fill="#7ccb6a" stroke="#3f8f3a" stroke-width="4"/>`);
    parts.push(`<path d="M-10 ${y + 26} C 120 ${y + 6}, 300 ${y - 8}, 460 ${y - 6}" stroke="#3f8f3a" stroke-width="3" fill="none"/>`);
    for (let k = 0; k < 6; k++) parts.push(`<path d="M${60 + k * 62} ${y + 18 - k * 3.5} q 16 -18 34 -26" stroke="#3f8f3a" stroke-width="2" fill="none" opacity="0.7"/>`);
    parts.push(lz(290, y - 30, 1));
    spot = { x: 360, y: y - 2 };
  } else {
    // the ground, with leaf litter
    const y = 180;
    parts.push(`<path d="M0 ${y} Q 130 ${y - 8} 260 ${y} T 520 ${y - 4} L520 ${H} L0 ${H} Z" fill="#cdb48a" stroke="#a78a5c" stroke-width="3"/>`);
    parts.push(`<g fill="#b39063" opacity="0.8"><ellipse cx="60" cy="${y + 16}" rx="16" ry="5"/><ellipse cx="190" cy="${y + 26}" rx="12" ry="4"/><ellipse cx="420" cy="${y + 18}" rx="18" ry="5"/></g>`);
    parts.push(`<g fill="#e8a45c" opacity="0.8"><path d="M120 ${y + 8} q 10 -8 22 0 q -10 8 -22 0z"/><path d="M460 ${y + 30} q 10 -8 22 0 q -10 8 -22 0z"/></g>`);
    parts.push(lz(290, y - 18, 1));
    spot = { x: 356, y: y + 6 };
  }
  // how high it sat, on a strip of tape
  const tag = heightWords(o.h), tagW = Math.max(74, Math.round(tag.length * 7.3 + 18));
  parts.push(`<g transform="translate(22 ${H - 40})"><rect x="0" y="0" width="${tagW}" height="24" rx="12" fill="#fff8e6" stroke="${OUT}" stroke-width="2"/>` +
    `<text x="${tagW / 2}" y="16.5" text-anchor="middle" class="pl-svg-small">${escapeHtml(tag)}</text></g>`);
  const tray = { x: 468, y: 118 };
  if (!o.clipped) {
    parts.push(`<g><ellipse cx="${tray.x}" cy="${tray.y + 30}" rx="40" ry="13" fill="#e8d3a8" stroke="${OUT}" stroke-width="2.4"/>`);
    const left = Math.max(0, o.left || 0);
    for (let k = 0; k < 3; k++) parts.push(`<circle cx="${tray.x - 16 + k * 16}" cy="${tray.y + 60}" r="5.5" fill="${k < left ? '#fff' : 'none'}" stroke="${OUT}" stroke-width="2" opacity="${k < left ? 1 : 0.35}"/>`);
    parts.push(`<text x="${tray.x}" y="${tray.y - 34}" text-anchor="middle" class="pl-svg-small">button logger</text></g>`);
    parts.push(`<circle class="pl-spot" cx="${spot.x}" cy="${spot.y}" r="19" fill="rgba(255,255,255,0.45)" stroke="#fff" stroke-width="2.5" stroke-dasharray="5 4"/>`);
    parts.push(`<circle class="pl-burst" cx="${spot.x}" cy="${spot.y}" r="16" fill="none" stroke="#fff" stroke-width="4" opacity="0"/>`);
  }
  const at = o.clipped ? spot : tray;
  parts.push(`<g class="pl-coin" transform="translate(${at.x} ${at.y})">${coinSVG(o.colour || '#ff7b54')}</g>`);
  const svg = `<svg class="pl-scene" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${parts.join('')}</svg>`;
  return { svg, tray, spot };
}

// ---------------------------------------------------------------- the chart

// The perch's temperature from the clip to the last download (a warm-to-cool wash under
// the line, the warmest reading marked), with the lizard's own day as a band of spells
// under it and a tick for each download. opts: { W, H, upto, compact }
export function dayChart(e, opts = {}) {
  const W = opts.W || 520, H = opts.H || 200;
  const upto = Number.isFinite(opts.upto) ? opts.upto : e.upto;
  const pts = (e.temps || []).filter((p) => p[0] <= upto + 1e-6 && p[0] >= e.clip - 1e-6);
  if (!Number.isFinite(upto) || pts.length < 1) {
    return `<div class="nb-empty pl-empty">${icon('thermometer')}<br>Walk past its perch to download the logger. Its day shows here.</div>`;
  }
  const id = 'plc' + (++uid);
  const L = 34, R = 12, Tp = 12, bandH = opts.compact ? 11 : 14;
  const plotB = H - (opts.compact ? 36 : 42);
  const x0 = e.clip, x1 = Math.max(upto, e.clip + 0.75);
  let lo = Infinity, hi = -Infinity, hiP = null, loP = null;
  for (const p of pts) { if (p[1] < lo) { lo = p[1]; loP = p; } if (p[1] > hi) { hi = p[1]; hiP = p; } }
  let y0 = Math.floor(lo - 0.4), y1 = Math.ceil(hi + 0.4);
  if (y1 - y0 < 3) { const m = (y0 + y1) / 2; y0 = Math.floor(m - 1.5); y1 = y0 + 3; }
  const X = (h) => L + ((h - x0) / (x1 - x0)) * (W - L - R);
  const Y = (c) => Tp + (1 - (c - y0) / (y1 - y0)) * (plotB - Tp);
  const f1 = (v) => v.toFixed(1);
  let g = `<defs><linearGradient id="${id}w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${WARM}" stop-opacity="0.55"/><stop offset="1" stop-color="${COOL}" stop-opacity="0.35"/></linearGradient>` +
    `<pattern id="${id}h" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#d9d0ea"/><rect width="3" height="6" fill="#b8acd4"/></pattern></defs>`;
  const step = y1 - y0 > 7 ? 2 : 1;
  for (let c = y0; c <= y1; c += step) {
    g += `<line x1="${L}" x2="${W - R}" y1="${f1(Y(c))}" y2="${f1(Y(c))}" stroke="#eadcbc" stroke-width="1"/>` +
      `<text x="${L - 5}" y="${f1(Y(c) + 3.5)}" text-anchor="end" class="pl-svg-axis">${c}°</text>`;
  }
  // hours along the bottom
  const span = x1 - x0, every = span > 6 ? 2 : span > 2.5 ? 1 : 0.5;
  for (let h = Math.ceil(x0 / every) * every; h <= x1 + 1e-6; h += every) {
    g += `<text x="${f1(X(h))}" y="${H - 4}" text-anchor="middle" class="pl-svg-axis">${T(h)}</text>` +
      `<line x1="${f1(X(h))}" x2="${f1(X(h))}" y1="${plotB}" y2="${plotB + 3}" stroke="#bda981" stroke-width="1"/>`;
  }
  // the line and the wash under it
  if (pts.length > 1) {
    const line = pts.map((p) => `${f1(X(p[0]))},${f1(Y(p[1]))}`).join(' ');
    g += `<polygon points="${f1(X(pts[0][0]))},${plotB} ${line} ${f1(X(pts[pts.length - 1][0]))},${plotB}" fill="url(#${id}w)"/>`;
    g += `<polyline points="${line}" fill="none" stroke="#b0613a" stroke-width="${opts.compact ? 2.2 : 2.6}" stroke-linejoin="round" stroke-linecap="round"/>`;
  } else {
    g += `<circle cx="${f1(X(pts[0][0]))}" cy="${f1(Y(pts[0][1]))}" r="4" fill="#b0613a"/>`;
  }
  // the warmest and coolest readings
  if (hiP && pts.length > 2) {
    const hx = X(hiP[0]), hy = Y(hiP[1]);
    const anchor = hx > W - 70 ? 'end' : hx < L + 40 ? 'start' : 'middle';
    g += `<circle cx="${f1(hx)}" cy="${f1(hy)}" r="4.2" fill="${WARM}" stroke="#fff" stroke-width="1.6"/>` +
      `<text x="${f1(hx)}" y="${f1(Math.max(Tp + 9, hy - 8))}" text-anchor="${anchor}" class="pl-svg-mark" fill="#b0613a">${hiP[1].toFixed(1)}°</text>`;
  }
  if (loP && pts.length > 2 && loP !== hiP && Math.abs(loP[0] - hiP[0]) > span * 0.12) {
    const lx = X(loP[0]), ly = Y(loP[1]);
    const anchor = lx > W - 70 ? 'end' : lx < L + 40 ? 'start' : 'middle';
    g += `<circle cx="${f1(lx)}" cy="${f1(ly)}" r="4.2" fill="${COOL}" stroke="#fff" stroke-width="1.6"/>` +
      `<text x="${f1(lx)}" y="${f1(Math.min(plotB - 4, ly + 16))}" text-anchor="${anchor}" class="pl-svg-mark" fill="#2f79a8">${loP[1].toFixed(1)}°</text>`;
  }
  // the lizard's own day, a band of spells under the chart
  const by = plotB + 6;
  g += `<rect x="${L}" y="${by}" width="${W - L - R}" height="${bandH}" rx="${bandH / 2}" fill="#f3ead6"/>`;
  g += `<clipPath id="${id}c"><rect x="${L}" y="${by}" width="${W - L - R}" height="${bandH}" rx="${bandH / 2}"/></clipPath><g clip-path="url(#${id}c)">`;
  for (const s of segments(e, upto)) {
    const c = CODES[s.code];
    const fill = s.code === 'x' ? `url(#${id}h)` : c.fill;
    g += `<rect x="${f1(X(s.from))}" y="${by}" width="${f1(Math.max(1, X(s.to) - X(s.from)))}" height="${bandH}" fill="${fill}"/>`;
  }
  g += '</g>';
  // the downloads: a small tick each
  for (const d of e.dl || []) {
    if (d > upto + 1e-6) continue;
    const dx = X(d);
    g += `<path d="M${f1(dx)} ${Tp - 2} v ${plotB - Tp + 2}" stroke="#7b9a58" stroke-width="1.2" stroke-dasharray="3 3" opacity="0.7"/>`;
  }
  // the clip: the coin at the start
  g += `<g transform="translate(${f1(X(e.clip))} ${by + bandH / 2}) scale(0.42)">${`<circle r="15" fill="#c9ced3" stroke="${OUT}" stroke-width="3"/><circle r="11" fill="${e.col || '#ff7b54'}"/>`}</g>`;
  return `<svg class="pl-chart" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="The perch's temperature through the day">${g}</svg>`;
}

// the band's key, only the kinds of spell that happened
export function dayKey(e, upto = e.upto) {
  const seen = new Set();
  for (const s of segments(e, upto)) seen.add(s.code === 'u' ? 'b' : s.code === 'm' ? 'd' : s.code);
  const order = ['b', 's', 'h', 'd', 'x', 'f'];
  const items = order.filter((c) => seen.has(c)).map((c) => `<span><i class="pl-key-${c}"></i>${escapeHtml(CODES[c].word)}</span>`);
  return items.length ? `<div class="pl-key">${items.join('')}</div>` : '';
}

const mins = (h) => {
  const m = Math.round(h * 60 / 5) * 5;
  if (m < 60) return `${m} min`;
  const hh = Math.floor(m / 60), mm = m % 60;
  return mm ? `${hh} h ${mm}` : `${hh} h`;
};

// the day in a few chips
function dayChips(e, upto = e.upto) {
  const pts = (e.temps || []).filter((p) => p[0] <= upto + 1e-6);
  const out = [];
  if (pts.length) {
    let hi = pts[0], lo = pts[0];
    for (const p of pts) { if (p[1] > hi[1]) hi = p; if (p[1] < lo[1]) lo = p; }
    out.push(`<span class="pl-chip is-warm">${icon('sun')}Warmest <b>${hi[1].toFixed(1)} °C</b> at ${T(hi[0])}</span>`);
    if (pts.length > 2) out.push(`<span class="pl-chip is-cool">${icon('thermometer')}Coolest <b>${lo[1].toFixed(1)} °C</b> at ${T(lo[0])}</span>`);
  }
  const t = dayTotals(e, upto);
  if (t.bask + t.sun > 0.08) out.push(`<span class="pl-chip">In the sun <b>${mins(t.bask + t.sun)}</b></span>`);
  if (t.shade > 0.08) out.push(`<span class="pl-chip">In the shade <b>${mins(t.shade)}</b></span>`);
  if (t.hide > 0.08) out.push(`<span class="pl-chip">Tucked away <b>${mins(t.hide)}</b></span>`);
  if (e.pack && e.dist > 0.4) out.push(`<span class="pl-chip is-pack"><i class="pl-swatch" style="background:${escapeHtml(e.pack)}"></i>Wandered <b>${Math.round(e.dist)}\u00a0m</b></span>`);
  return out.join('');
}

// ---------------------------------------------------------------- the tiny map

// The island round the perch (while this session knows where it is) with the trail
// dotted in its backpack's colour, the perch as the logger's coin and the nearest flag;
// or, from the save, the trail sketched on squared paper round the perch.
export function drawTinyMap(canvas, e, game) {
  if (!canvas) return;
  const home = HOMES.get(e.k);
  const maps = game && game.ui && game.ui.maps;
  if (home && maps && maps.drawIsland) {
    let R = 9;
    for (const p of e.trail || []) R = Math.max(R, Math.abs(p[0]) + 3, Math.abs(p[1]) + 3);
    R = Math.min(R, 22);
    maps.drawIsland(canvas, {
      bounds: [home.x - R, home.z - R, home.x + R, home.z + R], bare: true, patches: false,
      after: (ctx, v) => {
        const X = (x) => v.W / 2 + (x - v.cx) * v.s, Y = (z) => v.H / 2 + (z - v.cz) * v.s;
        const S = game.stakes && e.flag ? game.stakes.byId.get(e.flag) : null;
        if (S) flagMark(ctx, X(S.x), Y(S.z), v.dpr, e.flag);
        marks(ctx, e, (dx) => X(home.x + dx), (dz) => Y(home.z + dz), v.dpr, v.s, v.W, v.H);
      },
    });
    return;
  }
  // the sketch: squared paper, 1 m squares, the perch in the middle
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.round(canvas.clientWidth * dpr), H = Math.round(canvas.clientHeight * dpr);
  if (!W || !H) return;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  let R = 5;
  for (const p of e.trail || []) R = Math.max(R, Math.abs(p[0]) + 1.5, Math.abs(p[1]) + 1.5);
  const s = Math.min(W, H) / (2 * R + 1);
  ctx.fillStyle = '#fffaf0'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(120, 160, 200, 0.28)'; ctx.lineWidth = 1 * dpr;
  for (let k = -Math.ceil(W / s / 2); k <= Math.ceil(W / s / 2); k++) { const x = W / 2 + k * s; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let k = -Math.ceil(H / s / 2); k <= Math.ceil(H / s / 2); k++) { const y = H / 2 + k * s; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  if (e.flag) {
    ctx.font = `800 ${Math.round(10 * dpr)}px system-ui, sans-serif`;
    ctx.fillStyle = '#b03a6e'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(`by ${e.flag}`, 6 * dpr, 5 * dpr);
  }
  marks(ctx, e, (dx) => W / 2 + dx * s, (dz) => H / 2 + dz * s, dpr, s, W, H);
}

function flagMark(ctx, x, y, u, label) {
  ctx.strokeStyle = '#6e5238'; ctx.lineWidth = 1.6 * u;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 11 * u); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y - 11 * u); ctx.lineTo(x + 8 * u, y - 8 * u); ctx.lineTo(x, y - 5 * u); ctx.closePath();
  ctx.fillStyle = '#ff8fbd'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1 * u; ctx.stroke();
  ctx.font = `800 ${Math.round(9.5 * u)}px system-ui, sans-serif`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 3 * u; ctx.strokeStyle = 'rgba(255, 250, 236, 0.9)';
  ctx.strokeText(label, x + 9 * u, y - 12 * u);
  ctx.fillStyle = '#b03a6e'; ctx.fillText(label, x + 9 * u, y - 12 * u);
}

// the trail (dotted in the pack's colour over a soft white line), the perch as the
// logger's coin, the last fix, and a 5 m scale bar
function marks(ctx, e, X, Y, u, sPerM, W, H) {
  const tr = e.trail || [];
  if (e.pack && tr.length > 1) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx.setLineDash(pass ? [2.5 * u, 3.5 * u] : []);
      ctx.lineWidth = (pass ? 2.2 : 4.6) * u;
      ctx.strokeStyle = pass ? e.pack : 'rgba(255, 252, 240, 0.85)';
      ctx.beginPath();
      ctx.moveTo(X(0), Y(0));
      for (const p of tr) ctx.lineTo(X(p[0]), Y(p[1]));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const last = tr[tr.length - 1];
    ctx.beginPath(); ctx.arc(X(last[0]), Y(last[1]), 3.6 * u, 0, Math.PI * 2);
    ctx.fillStyle = e.pack; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4 * u; ctx.stroke();
  }
  // the perch: the logger's coin
  const px = X(0), py = Y(0);
  ctx.beginPath(); ctx.arc(px, py, 6.5 * u, 0, Math.PI * 2);
  ctx.fillStyle = '#c9ced3'; ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 1.6 * u; ctx.stroke();
  ctx.beginPath(); ctx.arc(px, py, 4.6 * u, 0, Math.PI * 2);
  ctx.fillStyle = e.col || '#ff7b54'; ctx.fill();
  // 5 m
  const bar = 5 * sPerM;
  if (bar < W * 0.6) {
    const x0 = 8 * u, y0 = H - 9 * u;
    ctx.strokeStyle = OUT; ctx.lineWidth = 2 * u; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(x0, y0 - 3 * u); ctx.lineTo(x0, y0); ctx.lineTo(x0 + bar, y0); ctx.lineTo(x0 + bar, y0 - 3 * u); ctx.stroke();
    ctx.font = `800 ${Math.round(9 * u)}px system-ui, sans-serif`;
    ctx.fillStyle = OUT; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('5 m', x0 + bar + 4 * u, y0 + 3 * u);
  }
}

// ---------------------------------------------------------------- the day card

const HEAD_SUB = (e) => `${cap(commonOf(e.sp))}${SEX[e.sex] ? ', ' + SEX[e.sex] : ''} · ${escapeHtml(perchPlace(e))}${e.flag ? ` · by ${escapeHtml(e.flag)}` : ''}`;

// The card as a download lands: { entry, points, first }
export function registerDayCard(game) {
  ensurePerchStyle();
  let cur = null, openedAt = 0;
  registerPanel('perchday', {
    card: 'pl-card', clear: false,
    render(card, arg) {
      const e = arg && arg.entry;
      cur = e;
      openedAt = performance.now();
      if (!e) { card.innerHTML = '<div class="nb-empty">Nothing downloaded.</div>'; return null; }
      const pts = arg.points ? `<span class="pl-plus">+${arg.points}</span>` : '';
      const side = `<div class="pl-side"><canvas class="pl-map"></canvas><small>${e.pack ? (e.dist > 0.4 ? `Its backpack: ${Math.round(e.dist)}\u00a0m of wandering` : 'Its backpack: it stayed put') : 'Its perch on the map'}</small></div>`;
      card.insertAdjacentHTML('beforeend',
        `<div class="pl-head"><div class="pl-badge">${anoleBadge(sciOf(e.sp), e.sex === 'f' ? 'f' : 'm')}</div>` +
          `<div class="pl-title"><h2>${icon('thermometer')}${escapeHtml(e.nick)}'s day</h2><div class="pl-sub">${HEAD_SUB(e)}</div></div>${pts}</div>` +
        `<div class="pl-body"><div class="pl-main">${dayChart(e)}${dayKey(e)}</div>${side}</div>` +
        `<p class="pl-line">${escapeHtml(lineOf(e))}</p>` +
        `<div class="pl-chips">${dayChips(e)}</div>` +
        '<div class="pl-foot"><button type="button" class="ui-btn pl-ok">Lovely! <kbd>E</kbd></button>' +
          `<button type="button" class="ui-btn is-soft pl-page">${icon('book')} Its notebook page</button></div>`);
      card.querySelector('.pl-ok').addEventListener('click', () => closePanel());
      card.querySelector('.pl-page').addEventListener('click', () => openPanel('notebook', 'follow:' + e.k));
      const cv = card.querySelector('canvas.pl-map');
      requestAnimationFrame(() => { if (cv.isConnected) drawTinyMap(cv, e, game); });
      return () => { cur = null; };
    },
    update() {
      if (!cur) return;
      const inp = game.input;
      // E (or Enter) closes it, read here so the press never reaches the world
      if (inp && inp.pressed('use') && performance.now() - openedAt > 350) { closePanel(); return; }
      const P = game.play && game.play.perch;
      if (P && P.auto === 'clip' && performance.now() - openedAt > 1500) closePanel();
    },
  });
}

// ---------------------------------------------------------------- the notebook's section

export const followEntry = (id) => {
  const k = Number(String(id).slice(7));
  return (state.followed || []).find((f) => f.k === k) || null;
};
// 'follow' (the index), then one page per followed lizard, the newest first
export function followPagesList() {
  const list = (state.followed || []).slice().sort((a, b) => b.k - a.k);
  return ['follow', ...list.map((f) => 'follow:' + f.k)];
}
export function followSignature(id) {
  if (id === 'follow') {
    const L = state.followed || [];
    return `${L.length}|${L.reduce((a, f) => a + ((f.dl && f.dl.length) || 0), 0)}`;
  }
  const e = followEntry(id);
  return e ? `${(e.dl || []).length}|${e.end ? 1 : 0}` : '';
}

// ctx: { game, tasks (the tasks module), stat(v, label), today: [{ entry, due, ready }] }
export function followIndexPages(ctx) {
  ensurePerchStyle();
  const L = (state.followed || []).slice().sort((a, b) => b.k - a.k);
  const left = (state.inventory && Number.isFinite(state.inventory.perch)) ? state.inventory.perch : 0;
  const today = (ctx.today || []).map((r) => {
    const e = r.entry;
    const status = r.ready ? '<em class="pl-ready">Ready: walk past it</em>' : (e.dl || []).length ? `downloaded ${T(e.dl[e.dl.length - 1])}` : `ready at ${T(r.next)}`;
    return `<div class="nb-row pl-row">${coinIcon(e.col, 1.6)}<div><b>${escapeHtml(e.nick)}</b> · ${escapeHtml(commonOf(e.sp))}<small>${escapeHtml(perchPlace(e))}${e.flag ? ' by ' + escapeHtml(e.flag) : ''} · ${status}</small></div></div>`;
  }).join('');
  const P = SCRIPT.perch || {};
  const surveying = state.phase === 'survey';
  const leftHtml = '<h2>Followed lizards</h2>' +
    `<div class="nb-sci" style="font-style:normal">${surveying ? `${left} of 3 button loggers left today` : 'Three button loggers a day'}</div>` +
    `<figure class="nb-photo pl-photo">${perchScene({ sp: 'crested', sex: 'm', perch: 'trunk', kind: 'sunny', colour: '#ff7b54', clipped: true, h: 1.5, mark: '#ff4fa3' }).svg}<figcaption>A button logger, clipped right where it sat</figcaption></figure>` +
    `<p class="nb-note">${escapeHtml(P.page || 'Clip a button logger on a lizard\'s perch as you let it go. Walk past later and it downloads by itself: the perch\'s temperature, and the lizard\'s own day.')}</p>` +
    (surveying ? `<h3 style="margin-top:0.5em">${icon('clock')} Today</h3><div class="nb-list pl-today">${today || '<div class="nb-empty" style="margin:0.4em">None clipped yet today.</div>'}</div>` : '');
  const rows = L.length ? L.map((e) => `<button type="button" class="pl-life-row" data-go="follow:${e.k}">` +
      `<span class="pl-life-badge">${anoleBadge(sciOf(e.sp), e.sex === 'f' ? 'f' : 'm')}</span>` +
      `<span><b>${escapeHtml(e.nick)}</b> <em>${escapeHtml(cap(commonOf(e.sp)))} · day ${e.day}</em><small>${escapeHtml(e.dl && e.dl.length ? lineOf(e) : e.end ? lineOf(e) : 'Not downloaded yet.')}</small></span>${coinIcon(e.col, 1.3)}</button>`).join('')
    : '<div class="nb-empty">No lizards followed yet.<br>Clip a perch logger as you let one go!</div>';
  const tasks = perchTasks(ctx);
  const right = `<h3>${icon('lizard')} Life stories <small class="nb-lg-count">${L.length}</small></h3><div class="nb-list pl-lives">${rows}</div>` +
    (tasks ? `<h3 style="margin-top:0.6em">${icon('check')} Research tasks</h3><div class="nb-tasks">${tasks}</div>` : '');
  return [leftHtml, right];
}

function perchTasks(ctx) {
  const mod = ctx.tasks;
  const all = mod && Array.isArray(mod.TASKS) ? mod.TASKS : null;
  if (!all) return '';
  return all.filter((t) => String(t.id).startsWith('perch.')).map((t) => {
    const r = (state.tasks && state.tasks[t.id]) || {};
    const goal = Number(t.goal) || 1;
    const n = Math.min(goal, Number(r.n) || 0);
    const done = !!r.done || n >= goal;
    const pips = Array.from({ length: goal }, (_, k) => `<i class="${k < n ? 'on' : ''}"></i>`).join('');
    const st = done ? stampEl(t.stamp || 'Done!', 'blue', t.icon || 'thermometer').outerHTML : '<div class="stamp is-empty"></div>';
    return `<div class="nb-task${done ? ' is-done' : ''}"><div><div class="nb-task-text">${escapeHtml(t.label)}</div>` +
      `<div class="nb-task-pips">${pips}<em>${n} / ${goal}</em></div></div>${st}</div>`;
  }).join('');
}

// One followed lizard's life story over two pages.
export function followLifePages(e, ctx) {
  ensurePerchStyle();
  if (!e) return ['<div class="nb-empty">This page has come loose.</div>', ''];
  const scene = perchScene({ sp: e.sp, sex: e.sex, mark: e.mark, pack: e.pack, perch: e.perch, seen: e.seen, kind: e.kind, colour: e.col, clipped: true, h: e.h });
  const fact = (label, html) => `<div><b>${label}</b><span>${html}</span></div>`;
  const left = `<h2>${escapeHtml(e.nick)}</h2>` +
    `<div class="nb-sci" style="font-style:normal">${escapeHtml(cap(commonOf(e.sp)))}${SEX[e.sex] ? ', ' + SEX[e.sex] : ''} · followed on day ${e.day}</div>` +
    `<figure class="nb-photo pl-photo">${scene.svg}<figcaption>${escapeHtml(onTheGround(e) ? 'On the ground' : perchWords(e) === 'leaves' ? 'Among its leaves' : `On its ${perchWords(e)}`)}, with the ${escapeHtml(e.cname || '')} logger</figcaption></figure>` +
    '<div class="pl-facts">' +
      fact('SVL', e.svl ? `${e.svl} mm` : 'not measured') +
      fact('Mark', e.mark ? `<i class="catch-dot" style="background:${escapeHtml(e.mark)}"></i>a paint dot` : 'none') +
      fact('Perch', `${escapeHtml(perchPlace(e))}${e.taped ? ' (taped)' : ''}`) +
      fact('Where', e.flag ? `by ${escapeHtml(e.flag)}` : 'on the island') +
      fact('Backpack', e.pack ? `<i class="pl-swatch" style="background:${escapeHtml(e.pack)}"></i>${escapeHtml(e.gps || 'fitted')}` : 'none') +
      fact('Logger', `${coinIcon(e.col, 1.05)}${escapeHtml(e.cname || '')}, clipped ${T(e.clip)}`) +
    '</div>' +
    `<p class="nb-note pl-notes"><b>Notes:</b> ${escapeHtml(notesLine(e))}</p>`;
  const has = Number.isFinite(e.upto);
  const right = `<h3>${icon('thermometer')} Its day in temperature</h3>` +
    (has ? `${dayChart(e, { W: 400, H: 168, compact: true })}${dayKey(e)}<p class="pl-line is-page">${escapeHtml(lineOf(e))}</p>`
      : '<div class="nb-empty" style="margin:0.8em 0.5em">Not downloaded yet. Walk past its perch and its day shows here.</div>') +
    `<h3 style="margin-top:0.35em">${icon('map')} ${e.pack ? 'Where it went' : 'Its perch'}</h3>` +
    `<div class="pl-life-map"><canvas class="pl-map is-page"></canvas><div class="pl-map-note">${
      e.pack ? (has ? (e.dist > 0.4 ? `Its ${escapeHtml(e.gps || 'backpack')} logged <b>${Math.round(e.dist)}\u00a0m</b> of wandering round its perch.` : 'Its backpack says it hardly moved.') : 'Its backpack logs where it goes.')
        : 'No backpack, so only its perch is marked.'}${HOMES.has(e.k) ? '' : '<br><em>Sketched from your notes.</em>'}</div></div>`;
  return [left, right];
}

// the canvases on a follow page, once it is in the DOM
export function drawFollowMaps(spread, id, game) {
  if (!spread || !String(id).startsWith('follow:')) return;
  const e = followEntry(id);
  const cv = spread.querySelector('canvas.pl-map');
  if (e && cv) requestAnimationFrame(() => { if (cv.isConnected) drawTinyMap(cv, e, game); });
}

// ---------------------------------------------------------------- styles

let styled = false;
export function ensurePerchStyle() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const st = document.createElement('style');
  st.id = 'perch-logger-css';
  st.textContent = `
.pl-svg-small { font: 800 12px var(--font, system-ui); fill: #6b5638; }
.pl-svg-axis { font: 700 10.5px var(--font, system-ui); fill: #85735a; }
.pl-svg-mark { font: 900 11px var(--font, system-ui); paint-order: stroke; stroke: #fffaf0; stroke-width: 3px; }
.pl-coin-ic { display: inline-block; vertical-align: -0.2em; flex: none; }
.pl-swatch { display: inline-block; width: 0.95em; height: 0.95em; border-radius: 0.28em; border: 0.12em solid rgba(60, 40, 20, 0.4); vertical-align: -0.12em; margin-right: 0.25em; }

/* the clip card on the release */
.pl-clip-stage { gap: 0.35em !important; padding: 0.3em 0.4em 0.45em; }
.pl-clip-art { flex: 1 1 auto; width: 100%; min-height: 0; display: flex; justify-content: center; }
.pl-clip-art svg { height: 100%; max-width: 100%; border-radius: 0.8em; cursor: pointer; }
.pl-clip-row { display: flex; align-items: center; justify-content: center; gap: 0.4em; flex-wrap: wrap; }
.pl-clip-btn { margin-left: 0.3em; }
.pl-clip-btn kbd { background: rgba(255, 255, 255, 0.85); }
.pl-clip-stage.is-clipped .pl-clip-btn { opacity: 0.5; pointer-events: none; }
.pl-spot { animation: pl-breathe 1.2s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
.pl-clip-stage.is-clipped .pl-spot { display: none; }
.reduce-motion .pl-spot { animation: none; }
@keyframes pl-breathe { 0%, 100% { transform: scale(0.92); opacity: 0.7; } 50% { transform: scale(1.08); opacity: 1; } }

/* the day card */
.pl-card { width: min(44em, calc(100vw - 3em)); max-height: calc(100vh - 2.5em); overflow: auto; padding: 1.1em 1.3em 1em !important; }
.pl-head { display: flex; align-items: center; gap: 0.75em; margin: 0 2.2em 0.35em 0; }
.pl-badge svg { width: 3.1em; height: 3.1em; display: block; }
.pl-title { flex: 1; min-width: 0; }
.pl-title h2 { margin: 0; display: flex; align-items: center; gap: 0.3em; font: 800 1.55em/1.1 var(--font-display); color: var(--ink); }
.pl-title h2 .ui-icon { width: 0.9em; height: 0.9em; color: #e0643c; }
.pl-sub { color: var(--ink-soft); font-weight: 700; font-size: 0.9em; margin-top: 0.15em; }
.pl-plus { flex: none; padding: 0.15em 0.7em 0.2em; border-radius: 999px; background: #fff0c2; border: 0.1em solid #f5c542; color: #8a5a10; font-weight: 900; }
.pl-body { display: grid; grid-template-columns: 1fr 12.5em; gap: 0.9em; align-items: start; }
.pl-main { min-width: 0; }
.pl-chart { display: block; width: 100%; height: auto; background: #fffaf0; border-radius: 0.8em; border: 0.1em solid var(--paper-edge, #e5cf9f); }
.pl-side { display: flex; flex-direction: column; gap: 0.3em; }
.pl-side small { color: var(--ink-soft); font-weight: 700; font-size: 0.8em; text-align: center; }
canvas.pl-map { display: block; width: 100%; aspect-ratio: 1; border-radius: 0.8em; border: 0.12em solid var(--paper-edge, #e5cf9f); background: #9fd7d0; }
.pl-key { display: flex; flex-wrap: wrap; gap: 0.25em 0.8em; margin: 0.35em 0.2em 0; color: var(--ink-soft); font-size: 0.8em; font-weight: 800; }
.pl-key span { display: inline-flex; align-items: center; gap: 0.35em; }
.pl-key i { width: 1.1em; height: 0.7em; border-radius: 0.35em; }
.pl-key-b { background: ${WARM}; } .pl-key-s { background: #ffd29c; } .pl-key-h { background: #ff8f6b; }
.pl-key-d { background: ${COOL}; } .pl-key-f { background: #d6cdb8; }
.pl-key-x { background: repeating-linear-gradient(45deg, #b8acd4 0 3px, #d9d0ea 3px 6px); }
.pl-line { position: relative; margin: 0.65em 0 0.5em; padding: 0.6em 0.9em 0.65em 2.4em; border-radius: 0.9em; background: #fffaf0;
  border: 0.12em dashed #e5cf9f; font: 750 1.08em/1.45 var(--font); color: var(--ink); }
.pl-line::before { content: "\\201C"; position: absolute; left: 0.35em; top: -0.05em; font: 900 2.3em/1 var(--font-display); color: #f5b86b; }
.pl-line.is-page { font-size: 0.95em; margin: 0.45em 0 0.2em; }
.pl-chips { display: flex; flex-wrap: wrap; gap: 0.35em; }
.pl-chip { display: inline-flex; align-items: center; gap: 0.3em; padding: 0.18em 0.65em 0.22em; border-radius: 999px; background: var(--paper-2, #f7ebcf);
  border: 0.1em solid var(--paper-edge, #e5cf9f); font-weight: 700; font-size: 0.85em; color: var(--ink); }
.pl-chip b { font-weight: 900; font-variant-numeric: tabular-nums; }
.pl-chip .ui-icon { width: 1em; height: 1em; }
.pl-chip.is-warm { background: #ffecd9; border-color: #ffc896; }
.pl-chip.is-cool { background: #e0f0fc; border-color: #a6d0ec; }
.pl-foot { display: flex; align-items: center; justify-content: flex-end; gap: 0.6em; margin-top: 0.75em; }
.pl-foot .is-soft { background: #fffaf0; color: var(--ink); border-color: var(--paper-edge, #e5cf9f); }
.pl-foot .ui-icon { width: 1em; height: 1em; vertical-align: -0.15em; }
.pl-empty { margin: 1em 0.5em; }
.pl-empty .ui-icon { width: 1.6em; height: 1.6em; }

/* the notebook */
.nb-page .pl-photo { width: 84%; margin: 0.55em auto 0.45em; padding-bottom: 1.45em; }
.nb-page .pl-photo svg { border-radius: 0.3em; }
.pl-facts { display: grid; grid-template-columns: 1fr; gap: 0.05em; font-size: 0.9em; margin-top: 0.1em; }
.pl-facts div { display: flex; align-items: center; gap: 0.6em; min-height: 1.6em; border-bottom: 1px solid var(--paper-line, rgba(120, 160, 200, 0.22)); }
.pl-facts b { flex: none; width: 6.6em; color: var(--ink-soft); font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.05em; }
.pl-facts span { font-weight: 750; display: inline-flex; align-items: center; gap: 0.3em; min-width: 0; }
.pl-facts .catch-dot { width: 0.85em; height: 0.85em; }
.pl-notes { font-size: 0.86em; line-height: 1.45; margin-top: 0.5em; }
.pl-life-map { display: grid; grid-template-columns: 12em 1fr; gap: 0.8em; align-items: center; }
.pl-map-note { color: var(--ink-soft); font-weight: 700; font-size: 0.85em; line-height: 1.4; }
.pl-map-note b { color: var(--ink); }
.pl-today .pl-row { padding: 0.35em 0.6em; }
.pl-ready { color: #3f8f4c; font-style: normal; font-weight: 900; }
.pl-lives { flex: 0 1 auto; max-height: 12.5em; }
.pl-life-row { display: flex; align-items: center; gap: 0.6em; width: 100%; padding: 0.35em 0.6em; border-radius: 0.8em; text-align: left;
  background: rgba(255, 255, 255, 0.6); border: 0.1em solid var(--paper-edge); font: inherit; color: var(--ink); cursor: pointer; }
.pl-life-row:hover { background: #fff; transform: translateY(-0.05em); }
.pl-life-row > span:nth-child(2) { flex: 1; min-width: 0; }
.pl-life-row b { font-weight: 900; }
.pl-life-row em { color: var(--ink-soft); font-style: normal; font-weight: 700; font-size: 0.85em; }
.pl-life-row small { display: block; color: var(--ink-soft); font-size: 0.8em; font-weight: 650; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pl-life-badge svg { width: 2.3em; height: 2.3em; display: block; }
@media (max-height: 760px) { .pl-body { grid-template-columns: 1fr 10em; } .pl-line { font-size: 1em; } }`;
  document.head.appendChild(st);
}
