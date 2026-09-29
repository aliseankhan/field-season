// The island board: a shared scoreboard when the game is hosted with its small API
// (tools/scoreboard_server.py behind the web server's api/ folder). On load it pings the
// API relative to the page (CONFIG.scoreboard.api); with no API (plain static hosting,
// local play, ?noboard=1) every board UI stays hidden and nothing is logged.
//
//   boardReady()           -> Promise<boolean>, the one ping (memoised)
//   boardUp()              true once the ping has answered well
//   fetchBoard(kind)       { rows, total, names } for 'best', 'species', 'rarest' or 'steady'
//   postDay(numbers)       { ok, rank, tie, total, best, day, ranks, ties, board, you, today, steady }
//                          or { ok: false, error, message, wait }
//   fetchDay(key)          one posted day's notebook (a row's nb): { name, score, steady, notebook }
//   dayNumbers()           the finished day as the board takes it (the name, the numbers, the mode)
//   boardName(name)        the player's name as the board allows it ('' when nothing is left)
//   buildBoardView(opts)   the tabbed list (the title's card and the narrow screen's panel)
//   rowsHtml(rows, kind, { me, you, today })  the rows of one board
//   attachBoard(game, { tasks })  what the notebook viewer draws with (ui.js)
//
// Steady hands is the board of days played with Precise aiming from start to end
// (state.today.steady, frozen into state.summary.steady at the day's end): a precise day
// goes up with mode 'precise' and the server files it on every board and on Steady hands.
// Only when the player presses "Share my day" on the end-of-day card does anything go up:
// the name, the day's numbers and a read-only snapshot of the day's notebook
// (src/game/daylog.js). Any row with a notebook opens it (src/ui/daybook.js), on the
// title's board and on the end card. A practice run (the debug and check flags, ?nosave)
// never offers it; ?boardtest=1 lets a scripted check post to a scratch board.

import { CONFIG } from '../config.js';
import { state, RULES, SPECIES_KEY, GAME_FLAGS } from '../game/state.js';
import { SCRIPT } from '../story/script.js';
import { icon, escapeHtml } from './icons.js';
import { ANOLE_LOOK } from './drawings.js';
import { currentPanel } from './kit.js';
import { daySnapshot } from '../game/daylog.js';
import { openDaybook, daybookOpen } from './daybook.js';

const EPITHETS = ['cristatellus', 'sagrei', 'carolinensis', 'distichus', 'equestris'];
const SHORT = { cristatellus: 'Crested', sagrei: 'Brown', carolinensis: 'Green', distichus: 'Bark', equestris: 'Knight' };
// (the server still answers board=backpacks for older copies of the game; this one shows
// Steady hands in its place)
export const BOARDS = [
  { id: 'best', label: 'Best day', icon: 'star', cap: 'Each player\'s best day · dots: species caught' },
  { id: 'species', label: 'Most species', icon: 'lizard', cap: 'Species caught in a day · dots: which ones' },
  { id: 'rarest', label: 'Rarest catch', icon: 'eye', cap: 'The rarest anole caught in a day' },
  { id: 'steady', label: 'Steady hands', icon: 'hand', cap: 'Days played with Precise aiming' },
];
const BOARD_IDS = BOARDS.map((b) => b.id);
// the footer on a board that leaves some names out
const WHO = { species: 'with a catch', rarest: 'with a catch', steady: 'with a Steady hands day' };

// what the notebook viewer draws with (ui.js attaches the game)
const viewer = { game: null, tasks: null };
export function attachBoard(game, { tasks = null } = {}) { viewer.game = game; viewer.tasks = tasks; }

// ---------------------------------------------------------------- the style sheet

let styled = false;
function ensureStyle() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./scoreboard.css', import.meta.url).href;
  document.head.appendChild(link);
}

// ---------------------------------------------------------------- talking to the API

const S = CONFIG.scoreboard || {};
const params = new URLSearchParams(location.search);
const on = (k) => params.has(k) && ['', '1', 'true', 'yes'].includes(params.get(k));
const off = S.enabled === false || on('noboard') || location.protocol === 'file:';
// A run with the flags that jump over parts of the game or change its pace (state.js's
// debug flags and a few check flags) is practice: the game does not save it, and it stays
// off the board.
const PRACTICE_FLAGS = ['phase', 'skipsetup', 'huntstep', 'catch', 'catchstep', 'open', 'clock', 'fast', 'tool', 'name',
  'mission', 'missionstep', 'loggers', 'lizards', 'perchdemo', 'crocfast'];
const practiceRun = !on('boardtest') && (!!GAME_FLAGS.nosave || PRACTICE_FLAGS.some((k) => params.has(k)));
let status = off ? 'down' : 'unknown';
let ready = null;
const waiting = new Set();

function apiUrl(path) {
  return new URL(String(S.api || 'api/') + path, document.baseURI).href;
}

async function call(path, opts = {}) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), S.timeoutMs || 4000) : 0;
  try {
    const res = await fetch(apiUrl(path), { cache: 'no-store', credentials: 'same-origin', ...opts, signal: ctl ? ctl.signal : undefined });
    const type = res.headers.get('content-type') || '';
    const body = type.includes('application/json') ? await res.json().catch(() => null) : null;
    return { status: res.status, body, retry: Number(res.headers.get('retry-after')) || 0 };
  } catch (e) {
    return { status: 0, body: null, retry: 0 };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function boardReady() {
  if (ready) return ready;
  if (off) return (ready = Promise.resolve(false));
  status = 'checking';
  ready = call('ping').then(({ status: code, body }) => {
    const up = code === 200 && !!body && body.ok === true && body.app === 'field-season-board' && body.board !== false;
    status = up ? 'up' : 'down';
    for (const fn of waiting) { try { fn(up); } catch (e) { /* a listener's own problem */ } }
    waiting.clear();
    return up;
  });
  return ready;
}
export const boardUp = () => status === 'up';
// fn(up) once the ping has answered (at once when it already has)
export function onBoard(fn) {
  if (status === 'up' || status === 'down') fn(status === 'up');
  else { waiting.add(fn); boardReady(); }
}

// Each board for a little while, so flicking between the title's tabs stays quick.
const cache = new Map();
export async function fetchBoard(kind, limit = 10) {
  if (!BOARD_IDS.includes(kind)) kind = 'best';
  const key = kind + ':' + limit;
  const hit = cache.get(key);
  if (hit && performance.now() - hit.t < 20000) return hit.data;
  const { status: code, body } = await call(`scores?board=${encodeURIComponent(kind)}&limit=${Math.max(1, Math.min(50, limit | 0))}`);
  if (code !== 200 || !body || body.ok !== true || !Array.isArray(body.rows)) throw new Error('board ' + code);
  const total = Number(body.total) || 0;
  const data = { rows: body.rows.filter(okRow), total, names: Math.max(total, Number(body.names) || 0) };
  cache.set(key, { t: performance.now(), data });
  return data;
}
const okRow = (r) => r && typeof r === 'object' && typeof r.name === 'string' && Number.isFinite(r.rank);
// a notebook's key as the server makes them (anything else is not opened)
const NB_KEY = /^[A-Za-z0-9_-]{16}$/;
const nbOf = (r) => (r && typeof r.nb === 'string' && NB_KEY.test(r.nb) ? r.nb : null);

// One posted day's notebook, read-only: { name, score, steady, notebook } or null.
export async function fetchDay(key) {
  if (!NB_KEY.test(String(key || ''))) return null;
  const { status: code, body } = await call(`day/${key}`);
  if (code !== 200 || !body || body.ok !== true || typeof body.name !== 'string' || !body.notebook || typeof body.notebook !== 'object') return null;
  return { name: body.name, score: Number(body.score) || 0, steady: body.steady === true, notebook: body.notebook };
}

export async function postDay(numbers) {
  const send = (n) => call('scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(n),
  });
  let { status: code, body, retry } = await send(numbers);
  // a notebook the board will not take never keeps the day off it: the day goes up on its
  // own (a web server set up for the old small posts refuses the size, and a board from
  // before the notebooks and Steady hands refuses both fields: then the mode goes too)
  const { notebook, ...plain } = numbers;
  const said = (...errors) => code === 400 && !!body && errors.includes(body.error);
  if (notebook && (code === 413 || said('notebook', 'body'))) ({ status: code, body, retry } = await send(plain));
  if (plain.mode && said('body', 'mode')) {
    const { mode, ...older } = plain;
    ({ status: code, body, retry } = await send(older));
  }
  if (code === 201 && body && body.ok === true) {
    cache.clear();
    const row = (r) => (okRow(r) ? r : null);
    const place = (d) => (d && Number.isFinite(d.rank) ? { rank: d.rank, tie: !!d.tie } : null);
    const S = body.steady && typeof body.steady === 'object' ? body.steady : null;
    return {
      ok: true, rank: body.rank, tie: !!body.tie, total: body.total, best: body.best !== false,
      day: place(body.day),
      ranks: body.ranks || {}, ties: body.ties || {}, board: (body.board || []).filter(okRow), you: row(body.you), today: row(body.today),
      steady: S && Number.isFinite(S.rank) ? {
        rank: S.rank, tie: !!S.tie, total: Number(S.total) || 0, best: S.best !== false, day: place(S.day),
        board: (Array.isArray(S.board) ? S.board : []).filter(okRow), you: row(S.you), today: row(S.today),
      } : null,
    };
  }
  const error = (body && body.error) || (code === 0 ? 'offline' : 'resting');
  const message = (body && typeof body.message === 'string' && body.message.slice(0, 120)) ||
    (code === 0 ? 'The island board could not be reached. Try again in a moment.' : 'The island board is resting. Try again soon.');
  return { ok: false, status: code, error, message, wait: retry };
}

// ---------------------------------------------------------------- the day's numbers

// The server's rule, so the name the button promises is the name that goes up: letters
// (plain and accented Latin), digits, spaces and - . ' _, starting with a letter or digit,
// 14 characters at most, at least one letter.
const L = 'A-Za-z0-9À-ÖØ-öø-ſ';
const NOT_SAFE = new RegExp(`[^${L} '’._-]`, 'g');
const LEAD = new RegExp(`^[^${L}]+`);
const LETTER = /[A-Za-zÀ-ÖØ-öø-ſ]/;
export function boardName(name) {
  let s = String(name || '').normalize('NFC').replace(/\s+/g, ' ').replace(NOT_SAFE, '').replace(LEAD, '');
  s = s.slice(0, 14).trim();
  return LETTER.test(s) ? s : '';
}

const count = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };

// The finished day: state.summary (flow.js fills it at the day's end) over state.today.
export function dayNumbers(name = state.playerName) {
  const Sm = state.summary || {};
  const T = state.today || {};
  const caught = Sm.caught || T.caught || {};
  const species = {};
  let rarest = null;
  for (const ep of EPITHETS) {
    const key = SPECIES_KEY[ep];
    species[ep] = count(caught[key] ?? caught[ep]);
    const rec = (RULES.rarity[key] || {}).records ?? Infinity;
    if (species[ep] > 0 && (!rarest || rec < rarest.rec)) rarest = { ep, rec };
  }
  let stars = 0;
  for (const v of Object.values(T.kit || {})) stars += Math.max(0, Math.min(3, count(v)));
  return {
    name: boardName(name),
    score: count(Sm.score ?? state.score),
    species,
    backpacks: Math.min(RULES.inventory.backpacks, count(Sm.tagged ?? T.tagged)),
    rarest: rarest ? rarest.ep : null,
    stars: Math.min(9, stars),
    version: String(S.version || '1'),
    // Precise aiming from the day's start to its end: the Steady hands board too
    mode: Sm.steady === true ? 'precise' : 'assist',
  };
}

// ---------------------------------------------------------------- the name on the board

const sameName = (a, b) => !!a && !!b && a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase();

// The name this browser last put a day up under, for the notebook's player (so a shared lab
// machine does not hand one player's board name to the next). A convenience only: kept in
// memory too, and the game works the same without storage.
const STORE = 'fieldseason.boardName';
let remembered = null;
function rememberedName() {
  const who = state.playerName || '';
  if (remembered && remembered.player === who) return remembered.name;
  try {
    const v = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (v && v.player === who && typeof v.name === 'string') return boardName(v.name);
  } catch (e) { /* no storage: nothing remembered */ }
  return '';
}
function rememberName(name) {
  remembered = { player: state.playerName || '', name };
  try { localStorage.setItem(STORE, JSON.stringify(remembered)); } catch (e) { /* no storage */ }
}
// The name the share line starts with: the one used before, else the player's own, but
// never the name the story gives a player who skipped naming (everyone who skipped would
// share one row); then the line asks for one.
function startName() {
  const was = rememberedName();
  if (was) return was;
  const n = boardName(state.playerName);
  return n && !sameName(n, SCRIPT.nameFallback || 'Sam') ? n : '';
}

// ---------------------------------------------------------------- drawing the rows

export function ordinal(n) {
  const k = n % 100;
  const suf = k >= 11 && k <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return n + suf;
}
const spColour = (ep) => (ANOLE_LOOK[ep] || ANOLE_LOOK.cristatellus).body;
const num = (n) => Number(n || 0).toLocaleString('en-GB');

function dots(kinds) {
  const have = new Set(Array.isArray(kinds) ? kinds : []);
  return '<span class="sb-dots" aria-hidden="true">' + EPITHETS.map((ep) =>
    `<i class="${have.has(ep) ? 'is-on' : ''}" style="--c:${spColour(ep)}" title="${SHORT[ep]} anole"></i>`).join('') + '</span>';
}

function value(r, kind) {
  if (kind === 'species') {
    return `${dots(r.kinds)}<b>${count(r.species)}</b>`;
  }
  if (kind === 'rarest') {
    const ep = EPITHETS.includes(r.rarest) ? r.rarest : null;
    if (!ep) return '<small>none</small>';
    return `<span class="sb-sp" style="--c:${spColour(ep)}">${icon('lizard')}${SHORT[ep]}</span>` +
      (count(r.rarestN) > 1 ? `<b class="sb-times">×${count(r.rarestN)}</b>` : '');
  }
  // (best and steady: the day's score, its species as dots)
  return `${dots(r.kinds)}<b>${num(r.score)}</b>`;
}

// the rank's circle: "=2" when the number is shared
function rankCell(r, fallback) {
  const rank = count(r.rank) || fallback;
  return r.tie ? `<span class="sb-rank is-tie" title="Joint ${ordinal(rank)}"><i>=</i>${rank}</span>` : `<span class="sb-rank">${rank}</span>`;
}
// A row with a notebook opens it (a click, or Enter on it) and shows a small book at its
// end; one without keeps the book's place empty (so the numbers line up) and says so on hover.
function rowLi(r, kind, cls, i, extra = '') {
  const nb = nbOf(r);
  const open = nb ? ` data-nb="${nb}" data-name="${escapeHtml(r.name)}" role="button" tabindex="-1" title="Open ${escapeHtml(r.name)}'s notebook for this day"`
    : ' title="No notebook for this day"';
  return `<li class="${cls}${nb ? ' has-nb' : ''}"${open} style="animation-delay:${(0.04 * i).toFixed(2)}s">${rankCell(r, i + 1)}` +
    `<span class="sb-name">${escapeHtml(r.name)}${extra}</span><span class="sb-val">${value(r, kind)}` +
    (nb ? `<i class="sb-nb">${icon('book')}</i>` : '<i class="sb-nb is-none" aria-hidden="true"></i>') + '</span></li>';
}

// the viewer, from any list of rows (the title's card and panel, the end card)
function openRow(li) {
  const key = li && li.dataset ? li.dataset.nb : null;
  if (!key || !NB_KEY.test(key) || daybookOpen()) return;
  openDaybook({ key, name: li.dataset.name || '' }, { fetchDay, game: viewer.game, tasks: viewer.tasks });
}
function bindRows(list) {
  // (a press on a row never takes the focus from the title's buttons)
  list.addEventListener('mousedown', (e) => { if (e.target.closest('[data-nb]')) e.preventDefault(); });
  list.addEventListener('click', (e) => { const li = e.target.closest('[data-nb]'); if (li) openRow(li); });
}

// rows: from the API; kind: the board; me: a name to pick out (the title). After a post:
// you, the name's own row (picked out by its rank and score, and added under a gap when it
// is below the list), and today, this day's row when the name's best is another day: in
// its place among the others when that is within the list (its number is where the day
// alone would stand), else under the list, after a gap when names come between.
export function rowsHtml(rows, kind = 'best', { me = null, you = null, today = null } = {}) {
  const mine = (r) => (you
    ? count(r.rank) === count(you.rank) && count(r.score) === count(you.score) && sameName(r.name, you.name)
    : sameName(r.name, me));
  const list = rows.map((r, i) => {
    const rank = count(r.rank) || i + 1;
    const cls = ['sb-row', rank <= 3 ? `is-top${rank}` : '', mine(r) ? 'is-me' : ''].filter(Boolean).join(' ');
    return rowLi(r, kind, cls, i);
  });
  const gap = '<li class="sb-gap" aria-hidden="true">• • •</li>';
  if (you && count(you.rank) > rows.length && !rows.some(mine)) {
    list.push(gap);
    list.push(rowLi(you, kind, 'sb-row is-me', rows.length));
  }
  if (today) {
    const row = rowLi(today, kind, 'sb-row is-today', rows.length + 1, ' <small class="sb-tag">today</small>');
    // (the best day and Steady hands are ranked by the score: today goes above the first
    // other name that scored less)
    const at = kind === 'best' || kind === 'steady' ? rows.findIndex((r) => !mine(r) && count(r.score) < count(today.score)) : -1;
    if (at >= 0) list.splice(at, 0, row);
    else {
      // (no gap when every other name above it is in the list)
      if (count(today.rank) > rows.filter((r) => !mine(r)).length + 1) list.push(gap);
      list.push(row);
    }
  }
  return list.join('');
}

// ---------------------------------------------------------------- the tabbed view

// A card with the four boards on tabs. opts: { tab, me }. Returns { el, show(tab),
// refresh(), next(step) }; it fetches when a tab is shown. The tabs never take the focus
// (a click switches them and leaves the keys with the page; the arrows switch them too).
export function buildBoardView(opts = {}) {
  ensureStyle();
  const el = document.createElement('div');
  el.className = 'sb-view';
  el.innerHTML =
    '<div class="sb-tabs" role="tablist">' + BOARDS.map((b) =>
      `<button type="button" role="tab" tabindex="-1" class="sb-tab" data-tab="${b.id}" aria-selected="false">${icon(b.icon)}<span>${b.label}</span></button>`).join('') + '</div>' +
    '<div class="sb-cap"></div><ol class="sb-list" aria-live="polite"></ol><div class="sb-count"></div>';
  const list = el.querySelector('.sb-list');
  const foot = el.querySelector('.sb-count');
  const cap = el.querySelector('.sb-cap');
  bindRows(list);
  let tab = BOARD_IDS.includes(opts.tab) ? opts.tab : 'best';
  let token = 0;

  async function show(t = tab, { fresh = false } = {}) {
    tab = BOARD_IDS.includes(t) ? t : 'best';
    for (const b of el.querySelectorAll('.sb-tab')) {
      const sel = b.dataset.tab === tab;
      b.classList.toggle('is-on', sel);
      b.setAttribute('aria-selected', sel ? 'true' : 'false');
    }
    cap.textContent = BOARDS.find((b) => b.id === tab).cap;
    const my = ++token;
    if (fresh) cache.clear();
    const had = list.children.length > 0;
    if (!had) list.innerHTML = '<li class="sb-note">Fetching the board...</li>';
    el.classList.add('is-loading');
    try {
      const data = await fetchBoard(tab, 10);
      if (my !== token) return;
      el.classList.remove('is-loading');
      if (!data.rows.length) {
        list.innerHTML = `<li class="sb-note">${tab === 'best' ? 'No days on the board yet. Finish a survey day and pin yours up!'
          : tab === 'steady' ? 'No Steady hands days yet. Play a whole day with Precise aiming!' : 'Nobody on this board yet.'}</li>`;
        foot.textContent = '';
        return;
      }
      list.innerHTML = rowsHtml(data.rows, tab, { me: opts.me !== undefined ? opts.me : rememberedName() });
      const all = data.names || data.total;
      foot.textContent = tab === 'best' || !WHO[tab] || data.total >= all
        ? `${num(all)} field biologist${all === 1 ? '' : 's'} on the board`
        : `${num(data.total)} of the ${num(all)} ${WHO[tab]}`;
    } catch (e) {
      if (my !== token) return;
      el.classList.remove('is-loading');
      list.innerHTML = '<li class="sb-note">The island board is resting. Try again later.</li>';
      foot.textContent = '';
    }
  }
  const tabs = el.querySelector('.sb-tabs');
  // (a press on a tab would move the focus there, and the title's keys with it)
  tabs.addEventListener('mousedown', (e) => { if (e.target.closest('[data-tab]')) e.preventDefault(); });
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    if (document.activeElement === b) b.blur();
    show(b.dataset.tab);
  });
  function next(step = 1) {
    const i = BOARD_IDS.indexOf(tab);
    show(BOARD_IDS[(i + step + BOARD_IDS.length) % BOARD_IDS.length]);
  }
  return { el, show, next, refresh: () => show(tab, { fresh: true }), get tab() { return tab; } };
}

// ---------------------------------------------------------------- the end-of-day card

const BOARD_WORDS = { species: 'for most species', rarest: 'for the rarest catch' };
const PENCIL = '<svg class="sb-pencil" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M15.5 4.5l4 4L9 19H5v-4z"/><path d="M13.5 6.5l4 4"/></svg>';

// Where the day landed, in words that agree with the list under them: the name's standing
// (its best day), and when today is not that best, where today alone would stand.
function headline(res) {
  const rank = count(res.rank), total = count(res.total);
  const joint = (tie, cap) => (tie ? (cap ? 'Joint ' : 'joint ') : '');
  if (res.best === false && rank) {
    const head = rank === 1 ? `Your best day is still ${joint(res.tie)}top of the board!` : `Your best day is still ${joint(res.tie)}${ordinal(rank)} of ${num(total)}.`;
    const d = res.day && count(res.day.rank);
    const score = res.today ? res.today.score : dayNumbers().score;
    return { head, small: d ? `Today's ${num(score)} would be ${joint(res.day.tie)}${ordinal(d)}.` : '' };
  }
  let also = '';
  for (const k of ['species', 'rarest']) {
    const r = res.ranks && count(res.ranks[k]);
    if (r && r <= 3 && (!rank || r < rank)) { also = `And ${joint(res.ties && res.ties[k])}${ordinal(r)} ${BOARD_WORDS[k]}!`; break; }
  }
  const head = rank === 1 ? `${joint(res.tie, true)}${res.tie ? 'top' : 'Top'} of the island board!`
    : rank ? `${joint(res.tie, true)}${ordinal(rank)} of ${num(total)} on the island board!` : 'On the island board!';
  return { head, small: also || 'Each player\'s best day' };
}

// Steady hands, for a precise day: the name's standing there, in the same words.
function steadyLine(S) {
  const rank = count(S.rank), total = count(S.total);
  const joint = (tie) => (tie ? 'joint ' : '');
  if (!rank) return 'On Steady hands!';
  if (S.best === false) {
    const d = S.day && count(S.day.rank);
    return `Steady hands: still ${joint(S.tie)}${ordinal(rank)} of ${num(total)}` + (d ? `, today ${joint(S.day.tie)}${ordinal(d)}.` : '.');
  }
  return rank === 1 ? `Steady hands: ${S.tie ? 'joint top' : 'top'} of ${num(total)}!` : `Steady hands: ${joint(S.tie)}${ordinal(rank)} of ${num(total)}!`;
}

// Adds the board to the end-of-day card's body (summary.js): a "Share my day" button (or
// [B]) beside "Back to the title" with the name it goes up under (a button that opens a
// box to change it) and a light word that the notebook goes too; once the day is up, the
// rank and the top ten in the catches column (its heading turns into two tabs), and for a
// precise day its Steady hands rank and that board's top ten as well. A "Steady hands
// day!" badge by the score for a precise day. One post a day: the result is kept on
// state.summary.board. A practice run gets a line saying it stays off the board instead.
export function summaryBoard(body) {
  ensureStyle();
  const foot = body.querySelector('.ui-summary-foot');
  const catches = body.querySelector('.ui-catches');
  const col = catches && catches.parentElement;
  const h3 = col && col.querySelector('h3');
  if (!foot || !col || !h3) return;
  const Sm = state.summary;
  const numbers = dayNumbers();
  if (!Sm) return;
  // the badge by the score (only with the board: it is the board's word)
  const big = body.querySelector('.ui-bigscore');
  if (Sm.steady === true && big) {
    onBoard((up) => {
      if (!up || !document.body.contains(big) || big.querySelector('.sb-steady-day')) return;
      big.classList.add('has-steady');
      big.insertAdjacentHTML('beforeend', `<div class="sb-steady-day" title="Precise aiming from morning to sunset">${icon('hand')}<span>Steady hands day!</span></div>`);
    });
  }
  if (numbers.score <= 0 && !Sm.board) return;

  // (added once the board answers; after "Back to the title" in the markup, so that stays
  // the foot's first button, and drawn before it by the style sheet)
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ui-btn is-soft sb-put-btn';
  btn.innerHTML = `${icon('trophy')}<span>Share my day</span><kbd class="sb-key" aria-hidden="true">B</kbd>`;
  btn.setAttribute('aria-keyshortcuts', 'B');
  const note = document.createElement('div');
  note.className = 'sb-put-note';
  let input = null;
  let name = startName();

  function shareLine() {
    note.className = 'sb-put-note';
    input = null;
    // (no name yet: the box waits for the button, B or a click, so E and Enter still go home)
    if (!name) { askName('Pick a name for the island board (letters and numbers).', '', false); return; }
    note.innerHTML = '<span>As ' +
      `<button type="button" class="sb-name-edit" title="Change the name for the board" aria-label="${escapeHtml(name)}, change the name for the board"><b>${escapeHtml(name)}</b>${PENCIL}</button>` +
      '. Your notebook goes up with it.</span>';
    note.querySelector('.sb-name-edit').addEventListener('click', () => askName('Your name on the island board (letters and numbers).', name));
  }
  function askName(text, value = '', focus = true) {
    note.className = 'sb-put-note is-ask';
    note.innerHTML = `<span>${escapeHtml(text)}</span>`;
    input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 14;
    input.placeholder = 'Your name';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Name for the island board');
    input.value = value;
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // (the letters are the name's, not the game's keys)
      if (e.key === 'Enter') { e.preventDefault(); put(); }
      else if (e.key === 'Escape' && name) { e.preventDefault(); shareLine(); btn.focus({ preventScroll: true }); }
    });
    note.appendChild(input);
    if (focus) setTimeout(() => { if (input) { input.focus({ preventScroll: true }); input.select(); } }, 30);
  }
  function warn(text) {
    note.className = 'sb-put-note is-warn';
    note.innerHTML = `<span>${escapeHtml(text)}</span>`;
    input = null;
  }

  // the catches column: Catches | Island board (and, for a precise day, the list can show
  // Best day or Steady hands)
  let pane = null;
  function showResult(res, as) {
    btn.remove();
    if (!note.parentNode) foot.after(note);
    note.className = 'sb-put-note is-done';
    note.innerHTML = res.best === false
      ? `${icon('check')}<span>Shared as <b>${escapeHtml(as)}</b>. The board shows each name's best day.</span>`
      : `${icon('check')}<span>Your day is on the island board as <b>${escapeHtml(as)}</b>.</span>`;
    const { head, small } = headline(res);
    const S = res.steady;
    const lists = {
      best: rowsHtml(res.board || [], 'best', { me: as, you: res.you, today: res.best === false ? res.today : null }),
      steady: S ? rowsHtml(S.board || [], 'steady', { me: as, you: S.you, today: S.best === false ? S.today : null }) : '',
    };
    pane = document.createElement('div');
    pane.className = 'sb-sum';
    pane.innerHTML = `<div class="sb-rankline">${icon('trophy')}<div>${escapeHtml(head)}${small ? `<small>${escapeHtml(small)}</small>` : ''}</div></div>` +
      (S ? `<div class="sb-steadyline">${icon('hand')}<span>${escapeHtml(steadyLine(S))}</span></div>` +
        '<div class="sb-tabs sb-sum-tabs" role="tablist">' +
          `<button type="button" role="tab" tabindex="-1" class="sb-tab is-on" data-list="best" aria-selected="true">${icon('star')}<span>Best day</span></button>` +
          `<button type="button" role="tab" tabindex="-1" class="sb-tab" data-list="steady" aria-selected="false">${icon('hand')}<span>Steady hands</span></button>` +
        '</div>' : '') +
      `<ol class="sb-list">${lists.best}</ol>`;
    col.appendChild(pane);
    const ol = pane.querySelector('.sb-list');
    bindRows(ol);
    if (S) {
      const tabs = pane.querySelector('.sb-sum-tabs');
      tabs.addEventListener('mousedown', (e) => { if (e.target.closest('[data-list]')) e.preventDefault(); });
      tabs.addEventListener('click', (e) => {
        const b = e.target.closest('[data-list]');
        if (!b) return;
        for (const t of tabs.querySelectorAll('[data-list]')) { const on = t === b; t.classList.toggle('is-on', on); t.setAttribute('aria-selected', on ? 'true' : 'false'); }
        ol.innerHTML = lists[b.dataset.list];
      });
    }
    const label = h3.innerHTML;
    h3.classList.add('sb-coltabs');
    h3.innerHTML = `<button type="button" class="sb-coltab" data-pane="catches">${label}</button>` +
      `<button type="button" class="sb-coltab" data-pane="board">${icon('trophy')}Island board</button>`;
    const flip = (which) => {
      catches.classList.toggle('ui-hidden', which !== 'catches');
      pane.classList.toggle('ui-hidden', which !== 'board');
      for (const b of h3.querySelectorAll('.sb-coltab')) b.classList.toggle('is-on', b.dataset.pane === which);
    };
    h3.addEventListener('click', (e) => { const b = e.target.closest('[data-pane]'); if (b) flip(b.dataset.pane); });
    flip('board');
  }

  let busy = false;
  async function put() {
    if (busy || Sm.board || btn.disabled) return;
    const as = boardName(input ? input.value : name);
    if (!as) {
      if (input) { input.classList.remove('is-shake'); void input.offsetWidth; input.classList.add('is-shake'); input.focus(); } else askName('Pick a name for the island board (letters and numbers).');
      return;
    }
    busy = true;
    btn.disabled = true;
    btn.querySelector('span').textContent = 'Pinning it up...';
    const day = { ...dayNumbers(), name: as };
    // the day's notebook goes with it (built afresh from the day's own notes, and small;
    // left off if it cannot be made or would not fit)
    try {
      const notebook = await daySnapshot();
      if (notebook) {
        day.notebook = notebook;
        if (JSON.stringify(day).length > NB_ROOM && notebook.kit && notebook.kit.drone) notebook.kit.drone.photo = null;
        if (JSON.stringify(day).length > NB_ROOM) delete day.notebook;
      }
    } catch (e) { delete day.notebook; }
    const res = await postDay(day);
    busy = false;
    if (!document.body.contains(btn) && !res.ok) return; // the card closed meanwhile
    if (res.ok) {
      name = as;
      rememberName(as);
      Sm.board = { ...res, name: as };
      showResult(Sm.board, as);
      return;
    }
    btn.querySelector('span').textContent = 'Share my day';
    if (res.error === 'name') {
      askName(res.message || 'The board can\'t take that name. Try another?', input ? input.value : as);
      btn.disabled = false;
      return;
    }
    warn(res.message);
    const wait = Math.max(0, Math.min(60, Number(res.wait) || 0));
    setTimeout(() => {
      btn.disabled = false;
      if (document.body.contains(btn) && !Sm.board && note.classList.contains('is-warn')) shareLine();
    }, wait ? wait * 1000 : 1500);
  }
  btn.addEventListener('click', put);
  // Tab belongs to the game, so the arrows move between the two buttons, and B presses
  // this one from anywhere on the card
  foot.addEventListener('keydown', (e) => {
    if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
    const all = [...foot.querySelectorAll('.ui-btn:not(.ui-hidden)')].sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    const i = all.indexOf(document.activeElement);
    if (i < 0 || all.length < 2) return;
    e.preventDefault();
    all[(i + (e.code === 'ArrowRight' ? 1 : all.length - 1)) % all.length].focus();
  });
  function onKey(e) {
    if (!document.body.contains(btn)) { window.removeEventListener('keydown', onKey); return; }
    if (e.code !== 'KeyB' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || currentPanel() !== 'summary' || daybookOpen()) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    btn.classList.add('is-focus');
    setTimeout(() => btn.classList.remove('is-focus'), 180);
    put();
  }

  if (Sm.board) { showResult(Sm.board, Sm.board.name); return; }
  onBoard((up) => {
    if (!up || Sm.board || !document.body.contains(foot)) return;
    if (practiceRun) {
      note.className = 'sb-put-note is-practice';
      note.innerHTML = `${icon('trophy')}<span>Practice runs stay off the island board.</span>`;
      foot.after(note);
      return;
    }
    foot.appendChild(btn);
    foot.after(note);
    shareLine();
    window.addEventListener('keydown', onKey);
  });
}
// the room a day and its notebook may take (the server's cap is 64 KB)
const NB_ROOM = 63 * 1024;

// ---------------------------------------------------------------- the title's card

// The title's "Island board": a card on the right on a wide screen, or (narrow screens)
// a pill beside Settings that opens the same view as a panel. Hidden with no API.
export function buildTitleBoard({ registerPanel, openPanel }) {
  ensureStyle();
  const card = document.createElement('aside');
  card.className = 'sb-board ui-panel ui-hidden';
  card.setAttribute('aria-label', 'Island board');
  card.innerHTML = `<div class="sb-head">${icon('trophy')}<span>Island board</span></div>`;
  const view = buildBoardView();
  card.appendChild(view.el);

  let panelView = null;
  registerPanel('board', {
    title: 'Island board', icon: 'trophy', card: 'sb-panel', clear: true,
    render(el) {
      panelView = buildBoardView({ tab: view.tab });
      el.appendChild(panelView.el);
      panelView.show();
      return () => { panelView = null; };
    },
    onKey(e) {
      if (!panelView || (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight')) return;
      e.preventDefault();
      panelView.next(e.code === 'ArrowRight' ? 1 : -1);
    },
  });

  let up = false, showing = false;
  onBoard((ok) => {
    up = ok;
    if (up && showing) { card.classList.remove('ui-hidden'); view.refresh(); }
  });
  // the card is drawn (a narrow screen hides it with its style sheet)
  const drawn = () => up && !card.classList.contains('ui-hidden') && card.offsetParent !== null;
  return {
    el: card,
    get up() { return up; },
    get drawn() { return drawn(); },
    // the title is up: show the card and fetch afresh
    show() {
      showing = true;
      if (!up) return;
      card.classList.remove('ui-hidden');
      view.refresh();
    },
    hide() { showing = false; },
    next: (step) => { if (drawn()) view.next(step); },
    open: () => { if (up) openPanel('board'); },
  };
}
