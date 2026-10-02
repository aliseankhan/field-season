// The Lizard-dex: a warm paper field notebook with the player's name on the cover.
// Spreads: the cover and index, one per anole species, one for the brown basilisk (once
// one has been seen) and one for the crocodile
// (drawing, names, rarity from the lab's record counts, what was spotted, caught and
// tagged, the biggest snout-vent length, the research tasks and their stamps), then
// the tracked lizards, the followed lizards (the perch loggers: an index spread, then one
// life story per lizard, src/ui/perch_day.js), the loggers and the grid, then the Field kit: one
// spread per mission of src/missions (the drone survey, the laser scans, the plant
// survey) under one bookmark, each drawn by the mission's own notebook().render(el)
// under a header of its title, blurb and stamps. Open with N or Tab, turn pages with
// the arrow keys, A and D, the arrows or the bookmarks; ?open=notebook:kit:rtk opens
// a Field kit page.
//
// Species keys: state.species uses the short keys (crested, brown, green, bark,
// knight, croc); the lizards use the scientific ones (cristatellus ...). Both are read.

import { state, RULES, clockText } from '../game/state.js';
import { icon, escapeHtml } from './icons.js';
import { anoleSVG, crocSVG, playerBadge, jamesPortrait, ANOLE_LOOK } from './drawings.js';
import { registerPanel, stampEl } from './kit.js';
import { SCRIPT } from '../story/script.js';
import { THERMAL_KEY as KEY_WORD, WARM_HEX, COOL_HEX } from './minimap.js';
import { followPagesList, followIndexPages, followLifePages, followEntry, followSignature, drawFollowMaps } from './perch_day.js';

export const SPECIES_UI = [
  {
    key: 'crested', sci: 'cristatellus', common: 'Crested anole', tab: 'Cr', latin: 'Anolis cristatellus',
    note: 'The commonest anole on the island, native to Puerto Rico. Males raise a tall, scalloped crest along the tail. Look on the trunks round the lawn, often head down.',
  },
  {
    key: 'brown', sci: 'sagrei', common: 'Brown anole', tab: 'Br', latin: 'Anolis sagrei',
    note: 'Stocky and quick, native to Cuba and the Bahamas. Brown anoles perch low on the trunks and dash over the ground. Males flash a bright orange-red dewlap.',
  },
  {
    key: 'green', sci: 'carolinensis', common: 'Green anole', tab: 'Gr', latin: 'Anolis carolinensis',
    note: 'The only anole native to the US mainland. Bright green on trunks, branches and leaves, and it can turn brown when stressed. The male\'s dewlap is pink.',
  },
  {
    key: 'bark', sci: 'distichus', common: 'Bark anole', tab: 'Ba', latin: 'Anolis distichus',
    note: 'Small, flat and lichen-grey, it presses itself to the bark and is gone in a blink. Creep slowly and look closely at the trunks.',
  },
  {
    key: 'knight', sci: 'equestris', common: 'Knight anole', tab: 'Kn', latin: 'Anolis equestris',
    note: 'One of the biggest anoles of all, from Cuba, with a bony head and a pale stripe on each shoulder. It likes the big trees, often well above your head.',
  },
  {
    // secret: its page, index entry and stamps join the notebook once one has been seen
    key: 'basilisk', sci: 'vittatus', common: 'Brown basilisk', tab: 'Bs', latin: 'Basiliscus vittatus', secret: true,
    note: 'Introduced from Central America, and very rare here. They eat anoles, and they can run on water.',
    records: '11 on the island in the spring survey',
    sizes: 'Sizes (provisional): males 110 to 170 mm, females 90 to 130 mm snout to vent.',
    seenAs: 'Running on the water',
  },
  {
    key: 'croc', sci: 'acutus', common: 'American crocodile', latin: 'Crocodylus acutus', spotOnly: true,
    note: 'It cruises the lake and basks on the banks. Watch it from a safe distance and keep back from the water\'s edge.',
  },
];
const BY_KEY = Object.fromEntries(SPECIES_UI.flatMap((s) => [[s.key, s], [s.sci, s]]));

// The Field kit's pages (src/missions), in order, with what the page shows when a
// mission's module is not there.
const KIT_IDS = ['drone', 'tls', 'rtk'];
const KIT_INFO = {
  drone: { tab: 'Drone', title: 'Drone survey', icon: 'drone', blurb: 'Last October the lab flew a drone over the island at 150 ft and stitched its photos into one map.' },
  tls: { tab: 'Scans', title: 'Laser scans', icon: 'tls', blurb: 'Last October the lab scanned the island with a laser scanner on a tripod from 88 spots.' },
  rtk: { tab: 'Plants', title: 'Plant survey', icon: 'rtk', blurb: 'In June the lab recorded 317 island plants with an RTK rover on a 2 m pole.' },
};
export const speciesUI = (k) => BY_KEY[k] || null;
// a species the notebook shows: all of them, but a secret one only once it has been seen
export function revealed(u) {
  if (!u.secret) return true;
  const c = speciesCounts(u.key);
  return (c.spotted || 0) + (c.caught || 0) > 0;
}
export const shownSpecies = () => SPECIES_UI.filter(revealed);

// Today's loops snapped and poles broken, a phrase for each kind there was (the
// grid page's day notes and the end-of-day card).
export function breakWords(T) {
  const out = [];
  const n = (v) => Math.max(0, Math.floor(Number(v) || 0));
  if (n(T.loopSnaps)) out.push(`${n(T.loopSnaps)} loop${n(T.loopSnaps) === 1 ? '' : 's'} snapped`);
  if (n(T.canopyBreaks)) out.push(`${n(T.canopyBreaks)} pole${n(T.canopyBreaks) === 1 ? '' : 's'} broken in the canopy`);
  if (n(T.carelessBreaks)) out.push(`${n(T.carelessBreaks)} pole${n(T.carelessBreaks) === 1 ? '' : 's'} stubbed and broken`);
  return out;
}

const RARITY_CLASS = { common: 'r-common', uncommon: 'r-uncommon', rare: 'r-rare', 'very rare': 'r-very-rare' };
const PERCH_WORD = {
  trunk: 'trunk', branch: 'branch', ground: 'ground', palm_stem: 'palm stem', root: 'root', leaf: 'leaf',
  palm_frond: 'palm frond', log: 'log',
};
const SEX_WORD = { m: 'male', f: 'female', u: 'sex unknown' };

// the counts for a species, whichever key the state keeps them under
export function speciesCounts(sp) {
  const s = state.species || {};
  const u = BY_KEY[sp];
  return (u && (s[u.key] || s[u.sci])) || s[sp] || { spotted: 0, caught: 0, tagged: 0, biggestSvl: 0 };
}

// Rarity and the record count come from RULES (the lab's real counts).
function rarityOf(u) {
  const r = RULES.rarity && RULES.rarity[u.key];
  return { rarity: r ? r.rarity : 'common', records: r ? r.records : 0 };
}

// Where each species perches, as shares of the spawns (which follow the field's perch
// mix), in four plain groups. The counts come through game.lizards.speciesSummary(sci)
// -> { perchCounts: { perch: n } }, so the UI never holds the lab's records (no chart
// without the lizards).
const PERCH_GROUPS = [
  ['Trunks', ['trunk', 'palm_stem', 'root']], ['Branches', ['branch']], ['Leaves', ['leaf', 'palm_frond']], ['Ground', ['ground', 'log']],
];
const perchCache = new Map();
function perchCounts(game, sci) {
  const L = game.lizards;
  if (!L || typeof L.speciesSummary !== 'function') return null;
  try { return (L.speciesSummary(sci) || {}).perchCounts || null; } catch (e) { return null; }
}
function perchMix(game, sci) {
  if (perchCache.has(sci)) return perchCache.get(sci);
  const counts = perchCounts(game, sci);
  if (!counts) return null; // not known yet: no chart, and try again next time
  let n = 0;
  for (const k in counts) n += Number(counts[k]) || 0;
  const mix = n ? PERCH_GROUPS.map(([label, keys]) => [label, keys.reduce((a, k) => a + (Number(counts[k]) || 0), 0) / n]) : null;
  perchCache.set(sci, mix);
  return mix;
}

// ---------------------------------------------------------------- tasks

// Normalises whatever tasks.js offers into [{ id, species, text, target }], read
// through its exports TASKS / SPECIES_TASKS / listTasks() / tasksFor(species).
function taskList(mod, sp) {
  if (!mod) return [];
  const u = BY_KEY[sp];
  let list = null;
  try {
    if (typeof mod.tasksFor === 'function') list = mod.tasksFor(u.key) || mod.tasksFor(u.sci) || null;
    if (!list) {
      let all = typeof mod.listTasks === 'function' ? mod.listTasks() : mod.SPECIES_TASKS || mod.TASKS || null;
      if (all && !Array.isArray(all)) all = all[u.key] || all[u.sci] || null;
      else if (all) all = all.filter((t) => t && (t.species === u.key || t.species === u.sci));
      list = all;
    }
  } catch (e) {
    list = null;
  }
  if (!Array.isArray(list)) return [];
  return list.filter(Boolean).map((t) => ({
    id: t.id,
    text: t.text || t.label || t.title || t.name || t.id,
    target: Number(t.target ?? t.count ?? t.goal ?? 1) || 1,
    stamp: t.stamp || null,
  }));
}

function taskProgress(t) {
  const s = (state.tasks && state.tasks[t.id]) || {};
  const n = Math.min(t.target, Number(s.n ?? s.progress ?? s.count ?? 0) || 0);
  return { n, done: !!s.done || n >= t.target };
}

// ---------------------------------------------------------------- the notebook

export function buildNotebook(game, { tasksModule = null, maps = null, loadStakes = null } = {}) {
  const pages = [];
  // the followed lizards' pages come and go with the perch loggers: rebuilt as it opens
  function rebuildPages() {
    pages.length = 0;
    pages.push('cover', ...shownSpecies().map((s) => s.key), 'tracked', ...followPagesList(), 'loggers', 'grid', ...KIT_IDS.map((k) => 'kit:' + k));
  }
  rebuildPages();
  // one bookmark per page, but one for all the Field kit pages and one for the followed lizards
  const tabOf = (id) => (id.startsWith('kit:') ? 'kit' : id.startsWith('follow') ? 'follow' : id);
  let lastKit = 'kit:' + KIT_IDS[KIT_IDS.length - 1];
  let at = 0;
  let card = null, spread = null, tabs = null;
  // what each page showed when last opened, so a page with news gets a gold dot
  const seen = new Map();
  const signature = (id) => {
    const u = BY_KEY[id];
    if (u) {
      const c = speciesCounts(u.key);
      let done = 0;
      for (const t of taskList(getTasks(), u.key)) if (taskProgress(t).done) done++;
      return `${c.spotted ? 1 : 0}|${c.caught || 0}|${c.tagged || 0}|${done}`;
    }
    if (id === 'tracked') return String((state.tracked || []).length);
    if (id === 'loggers') return String((state.loggers || []).reduce((a, l) => a + ((l.readings && l.readings.length) || 0), 0));
    if (id === 'grid') return String(catchLog().length);
    if (id.startsWith('follow')) return followSignature(id);
    if (id.startsWith('kit:')) { const r = kitRecord(id.slice(4)); return `${r.done || 0}|${r.best || 0}`; }
    return '';
  };
  const blank = (id) => (BY_KEY[id] ? '0|0|0|0' : id === 'tracked' || id === 'loggers' || id === 'grid' ? '0' : id.startsWith('kit:') ? '0|0' : id === 'follow' ? '0|0' : '');
  // the grid flags (src/tools/flags.js: the catch log, the flag by a tracked lizard) and
  // the loggers (src/tools/loggers.js: the warm and cool patches)
  const flagsSys = () => (game.tools && game.tools.flags) || null;
  const loggersSys = () => (game.tools && game.tools.loggers) || null;
  const catchLog = () => { const F = flagsSys(); return (F && F.log) || []; };
  const isNew = (id) => signature(id) !== (seen.get(id) ?? blank(id));
  let getTasks = () => tasksModule;

  const TABS = {
    cover: { colour: '#f2c14e', icon: 'book', title: 'Cover' },
    tracked: { colour: '#ff8fbd', icon: 'backpack', title: 'Tracked lizards' },
    follow: { colour: '#ffb35c', icon: 'lizard', title: 'Followed lizards' },
    loggers: { colour: '#6fc3ef', icon: 'thermometer', title: 'Loggers' },
    grid: { colour: '#ff9d6e', icon: 'flag', title: 'The grid' },
    kit: { colour: '#7cc05a', icon: 'kit', title: 'Field kit' },
  };

  // a bookmark: key is a page id, or 'kit' for the Field kit pages
  function tabHtml(id) {
    const i = id === 'kit' ? pages.indexOf(lastKit) : pages.indexOf(id);
    const on = tabOf(pages[at]) === id;
    const news = !on && pages.some((p) => tabOf(p) === id && isNew(p));
    const t = TABS[id];
    const u = BY_KEY[id];
    // species tabs: a chip in the species' colour with two letters (green and knight
    // share a green), the crocodile's own icon
    const inner = t ? icon(t.icon) : u.key === 'croc' ? icon('croc')
      : `<span class="nb-tab-chip" style="--chip:${ANOLE_LOOK[u.sci].body}">${escapeHtml(u.tab || u.common.slice(0, 2))}</span>`;
    const colour = t ? t.colour : u.key === 'croc' ? '#8fa05e' : '#d9c29a';
    const title = t ? t.title : u.common;
    return `<button type="button" class="nb-tab${on ? ' is-on' : ''}${news ? ' has-news' : ''}" data-tab="${escapeHtml(id)}" data-i="${i}" title="${escapeHtml(title)}" style="--tab:${colour}">${inner}</button>`;
  }

  function show(i, turn = true) {
    if (turn && spread && Math.max(0, Math.min(pages.length - 1, i)) !== at) game.events.emit('notebook:page', i); // a page turn (src/audio)
    at = Math.max(0, Math.min(pages.length - 1, i));
    if (!spread) return;
    const id = pages[at];
    let left = '', right = '';
    if (id === 'cover') [left, right] = coverPages();
    else if (BY_KEY[id]) [left, right] = speciesPages(BY_KEY[id]);
    else if (id === 'tracked') [left, right] = trackedPages();
    else if (id === 'loggers') [left, right] = loggerPages();
    else if (id === 'follow') [left, right] = followIndexPages(followCtx());
    else if (id.startsWith('follow:')) [left, right] = followLifePages(followEntry(id), followCtx());
    if (id === 'grid') {
      spread.innerHTML = `<section class="nb-page nb-wide${turn ? ' is-turn' : ''}">${gridSpread()}<div class="nb-folio" style="left:1.7em">${at * 2 + 1}</div><div class="nb-folio" style="right:1.7em">${at * 2 + 2}</div></section>`;
    } else if (id.startsWith('kit:')) {
      lastKit = id;
      spread.innerHTML = `<section class="nb-page nb-wide nb-kit${turn ? ' is-turn' : ''}">${kitSpread(id.slice(4))}<div class="nb-folio" style="left:1.7em">${at * 2 + 1}</div><div class="nb-folio" style="right:1.7em">${at * 2 + 2}</div></section>`;
    } else {
      spread.innerHTML =
        `<section class="nb-page is-left${turn ? ' is-turn' : ''}">${left}<div class="nb-folio">${at * 2 + 1}</div></section>` +
        `<section class="nb-page is-right${turn ? ' is-turn' : ''}">${right}<div class="nb-folio">${at * 2 + 2}</div></section>`;
    }
    seen.set(id, signature(id));
    const curTab = tabOf(id);
    tabs.querySelectorAll('.nb-tab').forEach((b) => {
      const key = b.dataset.tab;
      const on = key === curTab;
      b.classList.toggle('is-on', on);
      b.classList.toggle('has-news', !on && pages.some((p) => tabOf(p) === key && isNew(p)));
      if (key === 'kit') b.dataset.i = String(pages.indexOf(lastKit));
    });
    card.querySelector('.nb-arrow.is-prev').disabled = at === 0;
    card.querySelector('.nb-arrow.is-next').disabled = at === pages.length - 1;
    afterShow(id);
  }

  // canvases that need drawing once the pages are in the DOM (a Field kit page draws
  // its own, through the mission's render)
  function afterShow(id) {
    if (id.startsWith('follow')) { drawFollowMaps(spread, id, game); return; }
    if (id.startsWith('kit:')) {
      const body = spread.querySelector('.nb-kit-body');
      const m = kitMission(id.slice(4));
      let nb = null;
      try { nb = m && typeof m.notebook === 'function' ? m.notebook() : null; } catch (e) { console.error(e); }
      if (body && nb && typeof nb.render === 'function') {
        try { nb.render(body); } catch (e) { console.error(e); body.innerHTML = '<div class="nb-empty">This page could not be drawn.</div>'; }
      }
      return;
    }
    if (id === 'tracked' || id === 'grid' || id === 'loggers') {
      const cv = spread.querySelector('canvas.nb-map');
      if (!cv || !maps) return;
      const opts = id === 'grid' ? { after: drawGrid, bounds: [-47, -36, 65, 45], patches: false }
        : id === 'loggers' ? { bounds: [-47, -34, 65, 45] } : { bounds: trackedBounds() };
      const draw = () => maps.drawIsland(cv, opts);
      if (id === 'grid' && !game.stakes && loadStakes) loadStakes(game).then(() => { if (cv.isConnected) draw(); }).catch(() => {});
      requestAnimationFrame(draw);
    }
  }

  // what the followed lizards' pages need: the tasks and today's perch loggers
  function followCtx() {
    const P = game.tools && game.tools.perch;
    let today = [];
    try { today = P && P.today ? P.today() : []; } catch (e) { today = []; }
    return { game, tasks: getTasks(), today };
  }

  // the tracked page's map: round the tagged lizards' GPS fixes with a margin (at
  // least 34 m across), so the trails read; the whole island before any fix
  function trackedBounds() {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const t of state.tracked || []) {
      for (const p of t.trail || []) {
        if (!Array.isArray(p) || !Number.isFinite(p[0])) continue;
        x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
        z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]);
      }
    }
    if (!Number.isFinite(x0)) return undefined;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const w = Math.max(34, x1 - x0 + 14), h = Math.max(24, z1 - z0 + 14);
    return [cx - w / 2, cz - h / 2, cx + w / 2, cz + h / 2];
  }

  // the stake lattice over the map: faint lines along each lettered column and
  // numbered row, a dot on every stake the player can reach, and the labels round
  // the edge
  function drawStakes(ctx, v) {
    const S = game.stakes;
    if (!S) return;
    const X = (x) => v.W / 2 + (x - v.cx) * v.s, Y = (z) => v.H / 2 + (z - v.cz) * v.s;
    const cols = new Map(), rows = new Map();
    for (const s of S.list) {
      const c = s.id.slice(0, 1), r = s.id.slice(1);
      if (!cols.has(c)) cols.set(c, [0, 0]);
      if (!rows.has(r)) rows.set(r, [0, 0]);
      cols.get(c)[0] += s.x; cols.get(c)[1]++;
      rows.get(r)[0] += s.z; rows.get(r)[1]++;
    }
    const u = v.dpr;
    ctx.strokeStyle = 'rgba(110, 82, 56, 0.16)';
    ctx.lineWidth = 1 * u;
    for (const [, [sum, n]] of cols) { const x = X(sum / n); ctx.beginPath(); ctx.moveTo(x, 14 * u); ctx.lineTo(x, v.H); ctx.stroke(); }
    for (const [, [sum, n]] of rows) { const y = Y(sum / n); ctx.beginPath(); ctx.moveTo(18 * u, y); ctx.lineTo(v.W, y); ctx.stroke(); }
    ctx.fillStyle = 'rgba(110, 82, 56, 0.6)';
    for (const s of S.list) {
      if (!s.reach && s.on !== 'walkable') continue;
      ctx.beginPath(); ctx.arc(X(s.x), Y(s.z), 1.7 * u, 0, Math.PI * 2); ctx.fill();
    }
    ctx.font = `800 ${Math.round(10 * u)}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255, 250, 236, 0.85)';
    ctx.fillRect(0, 0, v.W, 14 * u);
    ctx.fillRect(0, 0, 18 * u, v.H);
    ctx.fillStyle = '#7b5a3a';
    for (const [c, [sum, n]] of cols) ctx.fillText(c, X(sum / n), 7.5 * u);
    for (const [r, [sum, n]] of rows) ctx.fillText(r, 9 * u, Y(sum / n));
  }

  // the grid page's map: the lattice, and a gold count by each flag of today's catches
  function drawGrid(ctx, v) {
    drawStakes(ctx, v);
    const S = game.stakes;
    if (!S) return;
    const X = (x) => v.W / 2 + (x - v.cx) * v.s, Y = (z) => v.H / 2 + (z - v.cz) * v.s;
    const u = v.dpr, day = (state.days || 0) + 1;
    const n = new Map();
    for (const e of catchLog()) if (e.day === day) n.set(e.flag, (n.get(e.flag) || 0) + 1);
    ctx.font = `900 ${Math.round(9.5 * u)}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [id, k] of n) {
      const s = S.byId.get(id);
      if (!s) continue;
      const x = X(s.x) - 7 * u, y = Y(s.z) - 13 * u;
      ctx.beginPath(); ctx.arc(x, y, 7 * u, 0, Math.PI * 2);
      ctx.fillStyle = '#f5b82e'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * u; ctx.stroke();
      ctx.fillStyle = '#5a3c10';
      ctx.fillText(String(k), x, y + 0.5 * u);
    }
  }

  // ---------------------------------------------------------------- the spreads

  function coverPages() {
    const name = state.playerName || 'Field biologist';
    let stamps = 0;
    for (const id in state.tasks || {}) if (state.tasks[id] && state.tasks[id].done) stamps++;
    let spotted = 0, caught = 0;
    const shown = shownSpecies();
    for (const u of shown) { const c = speciesCounts(u.key); if (c.spotted || c.caught) spotted++; caught += c.caught || 0; }
    const fieldDays = (state.days || 0) + (state.phase === 'setup' || state.phase === 'survey' ? 1 : 0);
    const left =
      `<div class="nb-plate"><small>Field notebook of</small><b>${escapeHtml(name)}</b><span>Lizard Island · Stroud Lab</span></div>` +
      `<div style="display:flex;gap:1em;align-items:center;margin:0.2em 0.4em 0.6em">` +
        `<div style="width:6.5em;flex:none;border-radius:50%;overflow:hidden;background:#dff1d0;border:0.16em solid var(--leaf-deep)">${playerBadge(state.looks)}</div>` +
        `<div class="nb-note" style="margin:0">Every lizard on this island is caught, measured, marked and let go, year after year. Fill these pages as you go!</div>` +
      '</div>' +
      '<div class="nb-stats" style="grid-template-columns:repeat(4,1fr)">' +
        stat(fieldDays, fieldDays === 1 ? 'Field day' : 'Field days') +
        stat(`${spotted}/${shown.length}`, 'Species') +
        stat(caught, 'Caught') +
        stat(stamps, 'Stamps') +
      '</div>' +
      `<h3>${icon('star')} Stamp album</h3>${stampAlbum()}` +
      `<div class="nb-records">${icon('trophy')} ${bestLine()}</div>`;
    const right =
      '<h2>Lizard-dex</h2><div class="nb-sci" style="font-style:normal">Pick a species to open its page</div>' +
      // (four across once the basilisk has joined, so the index stays two rows)
      `<div class="nb-index" style="margin-top:0.8em${shown.length > 6 ? ';grid-template-columns:repeat(4,1fr);font-size:0.86em' : ''}">` +
      shown.map((u) => {
        const c = speciesCounts(u.key);
        const seen = (c.spotted || 0) + (c.caught || 0) > 0;
        const art = u.key === 'croc' ? crocSVG({ silhouette: !seen }) : anoleSVG(u.sci, { silhouette: !seen, perch: false, dewlap: false });
        const line = u.spotOnly ? (seen ? 'Spotted' : 'Not yet seen') : seen ? `${c.caught || 0} caught` : 'Not yet seen';
        return `<button type="button" data-go="${u.key}">${art}${escapeHtml(u.common)}<small>${line}</small></button>`;
      }).join('') +
      '</div>' +
      // (five across since the followed lizards joined, so the row stays one row)
      '<h3 style="margin-top:1em">More pages</h3><div class="nb-links" style="grid-template-columns:repeat(5,1fr);gap:0.4em">' +
      `<button type="button" data-go="tracked">${icon('backpack')}Tracked lizards<small>${(state.tracked || []).length}</small></button>` +
      `<button type="button" data-go="follow">${icon('lizard')}Followed lizards<small>${(state.followed || []).length}</small></button>` +
      `<button type="button" data-go="loggers">${icon('thermometer')}Loggers<small>${(state.loggers || []).length}</small></button>` +
      `<button type="button" data-go="grid">${icon('flag')}The grid<small>${(state.flags || []).length} flags</small></button>` +
      `<button type="button" data-go="${lastKit}">${icon('kit')}Field kit<small>${kitDoneCount()} of ${KIT_IDS.length} done</small></button>` +
      '</div>';
    return [left, right];
  }

  // every task as a stamp slot, stamped when done: set-up in green, species in red
  // (gold for the rarest), field work in blue
  function stampAlbum() {
    const mod = getTasks();
    let all = mod && (typeof mod.listTasks === 'function' ? mod.listTasks() : mod.TASKS);
    if (!Array.isArray(all)) all = SPECIES_UI.flatMap((u) => taskList(mod, u.key).map((t) => ({ ...t, species: u.key })));
    const cells = all.filter((raw) => !(raw.species && BY_KEY[raw.species] && !revealed(BY_KEY[raw.species]))).map((raw) => {
      const t = { id: raw.id, text: raw.text || raw.label || raw.id, target: Number(raw.target ?? raw.goal ?? 1) || 1 };
      const p = taskProgress(t);
      const u = raw.species && BY_KEY[raw.species];
      const title = escapeHtml((u ? u.common + ': ' : '') + t.text);
      if (!p.done) return `<div class="nb-album-cell" title="${title}"><div class="stamp is-empty"></div></div>`;
      const tone = raw.group === 'setup' ? 'green' : raw.group === 'field' || raw.group === 'kit' ? 'blue' : u && (u.key === 'bark' || u.key === 'knight' || u.key === 'basilisk') ? 'gold' : 'red';
      const ic = raw.icon || (u && u.key === 'croc' ? 'eye' : raw.group === 'setup' ? 'check' : raw.group === 'field' ? 'star' : 'lizard');
      return `<div class="nb-album-cell" title="${title}">${stampEl(raw.stamp || (u ? u.common.replace(/ anole$/, '') : 'Done'), tone, ic).outerHTML}</div>`;
    });
    if (!cells.length) return '<div class="nb-empty" style="margin:0.6em 0">Stamps for research tasks go here.</div>';
    return `<div class="nb-album">${cells.join('')}</div>`;
  }

  // the best day so far, counting today's score while a day is on
  function bestLine() {
    const today = state.phase === 'survey' || state.phase === 'summary' ? state.score || 0 : 0;
    const best = Math.max(state.best || 0, today);
    return best > 0 ? `Best day: <b>${best.toLocaleString('en-GB')}</b> points` : 'No best day yet';
  }

  function stat(v, label) {
    return `<div class="nb-stat"><b>${escapeHtml(String(v))}</b><small>${escapeHtml(label)}</small></div>`;
  }

  function speciesPages(u) {
    const c = speciesCounts(u.key);
    const seen = (c.spotted || 0) + (c.caught || 0) > 0;
    const { rarity, records } = rarityOf(u);
    const art = u.key === 'croc' ? crocSVG({ silhouette: !seen }) : anoleSVG(u.sci, { silhouette: !seen });
    const rClass = u.spotOnly ? 'r-special' : RARITY_CLASS[rarity] || 'r-common';
    const rWord = u.spotOnly ? 'Spot only' : rarity.replace(/^./, (m) => m.toUpperCase());
    const best = SCRIPT.survey && SCRIPT.survey.bestTime ? SCRIPT.survey.bestTime[u.key] : null; // when the sun brings them out
    const left =
      `<h2>${escapeHtml(u.common)}</h2>` +
      `<div><span class="nb-sci">${escapeHtml(u.latin)}</span> <span class="nb-rarity ${rClass}">${icon('star')}${escapeHtml(rWord)}</span></div>` +
      `<figure class="nb-photo">${art}<figcaption>${seen ? (u.spotOnly ? 'Seen from a safe distance' : u.seenAs || 'Male, dewlap out') : 'Not yet seen'}</figcaption></figure>` +
      `<p class="nb-note">${escapeHtml(u.note)}</p>` +
      (u.spotOnly ? '<div class="nb-records">Never try to catch it!</div>'
        : `<div class="nb-records">${icon('book')} ${escapeHtml(u.records || records.toLocaleString('en-GB') + ' records in the lab\'s survey')}</div>`) +
      (u.sizes ? `<div class="nb-records">${icon('ruler')} ${escapeHtml(u.sizes)}</div>` : '') +
      (best ? `<div class="nb-records nb-best">${icon('sun')} <b>Best time:</b> ${escapeHtml(best)}</div>` : '');

    const safe = !!(state.tasks && state.tasks['croc.spot'] && state.tasks['croc.spot'].done);
    const stats = u.spotOnly
      ? stat(c.spotted || 0, 'Spotted') + stat(safe ? 'Yes' : 'Not yet', 'Seen safely')
      : stat(c.spotted || 0, 'Spotted') + stat(c.caught || 0, 'Caught') + stat(c.tagged || 0, 'Tagged') +
        stat(c.biggestSvl ? c.biggestSvl + ' mm' : '-', 'Biggest SVL');
    const tasks = taskList(getTasks(), u.key);
    const taskHtml = tasks.length
      ? tasks.map((t) => {
        const p = taskProgress(t);
        const pips = t.target <= 10
          ? Array.from({ length: t.target }, (_, k) => `<i class="${k < p.n ? 'on' : ''}"></i>`).join('')
          : `<i class="${p.n > 0 ? 'on' : ''}"></i>`;
        const st = p.done ? stampEl(t.stamp || 'Done!', 'red', u.key === 'croc' ? 'eye' : 'lizard').outerHTML : '<div class="stamp is-empty"></div>';
        return `<div class="nb-task${p.done ? ' is-done' : ''}"><div><div class="nb-task-text">${escapeHtml(t.text)}</div>` +
          `<div class="nb-task-pips">${pips}<em>${p.n} / ${t.target}</em></div></div>${st}</div>`;
      }).join('')
      : '<div class="nb-empty">Research tasks arrive on survey day.</div>';
    const mix = u.spotOnly ? null : perchMix(game, u.sci);
    const mixHtml = mix
      ? `<h3>${icon('leaf')} Where they perch</h3><div class="nb-perch">` +
        mix.map(([label, f]) => `<div><span>${label}</span><i><b style="width:${(f * 100).toFixed(0)}%;background:${ANOLE_LOOK[u.sci].body}"></b></i><em>${Math.round(f * 100)}%</em></div>`).join('') +
        '</div>'
      : '';
    const tips = SCRIPT.survey && SCRIPT.survey.tips;
    const tip = tips && tips[u.key];
    const tipHtml = tip ? `<div class="nb-tip"><div class="ui-dialogue-portrait">${jamesPortrait()}</div><p><b>James's tip:</b> ${escapeHtml(tip)}</p></div>` : '';
    const right =
      `<h3>${icon('eye')} Field records</h3><div class="nb-stats${u.spotOnly ? ' is-two' : ''}">${stats}</div>` +
      `<h3>${icon('check')} Research tasks</h3><div class="nb-tasks">${taskHtml}</div>` +
      mixHtml + tipHtml;
    return [left, right];
  }

  const flagOf = (t) => { const F = flagsSys(); try { return F && F.flagOfTracked ? F.flagOfTracked(t) : null; } catch (e) { return null; } };
  function trackedPages() {
    const list = state.tracked || [];
    const rows = list.length
      ? list.map((t) => {
        const u = BY_KEY[t.species];
        const perch = PERCH_WORD[t.perch] || t.perch || 'perch';
        const height = Number.isFinite(t.height) ? (t.height < 0.25 ? 'on the ground' : `about ${t.height.toFixed(1)} m up`) : '';
        return `<div class="nb-row"><span class="nb-pack" style="background:${escapeHtml(t.colour || '#ff8a5c')}"></span>` +
          `<div><b>${escapeHtml(t.nickname || t.id || 'Backpack')}</b>${t.nickname ? ` <em class="nb-sci">${escapeHtml(t.id || '')}</em>` : ''} · ${escapeHtml(u ? u.common : t.species)}, ${escapeHtml(SEX_WORD[t.sex] || '')}` +
          `<small>${escapeHtml(perch)}${height ? ', ' + height : ''}${flagOf(t) ? ` by ${escapeHtml(flagOf(t))}` : ''}${t.svl ? ` · SVL ${t.svl} mm` : ''}${t.day ? ` · fitted on day ${t.day}` : ''}</small></div></div>`;
      }).join('')
      : '<div class="nb-empty">No backpacks fitted yet.<br>Big adults can carry one: it weighs just 0.06 g!</div>';
    const left = `<h2>Tracked lizards</h2><div class="nb-sci" style="font-style:normal">GPS backpacks: ${list.length} fitted, ${state.inventory ? state.inventory.backpacks : 0} left today</div>` +
      `<div class="nb-list" style="margin-top:0.8em">${rows}</div>`;
    const right = `<h3>${icon('map')} Where they went</h3><canvas class="nb-map"></canvas>` +
      '<div class="nb-records" style="margin-top:0.5em">Dotted trails show each tagged lizard\'s day.</div>';
    return [left, right];
  }

  // The loggers: one on every flag, downloaded by walking past. Left, each logger's
  // latest download today (warm or cool while it is fresh) and the day's readings;
  // right, the thermal map (the warm and cool patches, fading as they go stale) and
  // James's word on what it means for the lizards.
  function loggerPages() {
    ensureLoggerStyle();
    const list = state.loggers || [];
    const LG = loggersSys();
    const today = (r) => !!(LG && LG.isToday && LG.isToday(r));
    const surveying = state.phase === 'survey';
    const patchOf = (id) => (LG && LG.patches ? LG.patches.find((p) => p.id === id) : null);
    let fresh = 0;
    const chips = list.map((l) => {
      const r = (l.readings || []).filter(today);
      const last = surveying ? r[r.length - 1] : null;
      const p = surveying ? patchOf(l.id) : null;
      const f = p && LG.freshness ? LG.freshness(p) : 0;
      // fresh until the patch is half faded (CHIP_FRESH), then stale: time for a second pass
      if (f > CHIP_FRESH) fresh++;
      // the patch's colour as the maps draw it (its majority), the same word as the toast
      const kind = f > CHIP_FRESH ? (p.kind === 'warm' || p.kind === 'cool' ? p.kind : 'mixed') : last ? 'stale' : 'none';
      const note = kind === 'none' ? 'not yet' : kind === 'stale' ? `stale · ${clockText(last.hours)}`
        : `${clockText(last ? last.hours : p.hours)} · ${CHIP_WORD[kind]}`;
      return `<div class="nb-lg-chip is-${kind}" title="${escapeHtml(KIND_WORD[kind])}"><i></i><b>${escapeHtml(l.label || l.id)}</b>` +
        `<span>${last ? `${Number(last.celsius).toFixed(1)} °C` : ''}</span><small>${escapeHtml(note)}</small></div>`;
    }).join('');
    const sub = list.length ? `${list.length} out, one on every flag. Walk within 3 m and it downloads by itself.` : 'The loggers stand on the flags.';
    const left = `<h2>Temperature loggers</h2><div class="nb-sci" style="font-style:normal">${escapeHtml(sub)}</div>` +
      (list.length ? `<div class="nb-lg-grid">${chips}</div>` : '<div class="nb-empty">No loggers out yet.</div>') +
      `<h3 style="margin-top:0.7em">${icon('thermometer')} Today's readings</h3>${loggerChart(list, today)}`;
    const tip = SCRIPT.survey && SCRIPT.survey.loggers && SCRIPT.survey.loggers.page;
    const right = `<h3>${icon('map')} Thermal map${fresh ? ` <small class="nb-lg-count">${fresh} fresh</small>` : ''}</h3><canvas class="nb-map"></canvas>` +
      `<div class="nb-lg-key"><span><i class="is-warm"></i>${escapeHtml(KEY_WORD.warm)}</span><span><i class="is-cool"></i>${escapeHtml(KEY_WORD.cool)}</span></div>` +
      (tip ? `<div class="nb-tip"><div class="ui-dialogue-portrait">${jamesPortrait()}</div><p><b>James's tip:</b> ${escapeHtml(tip)}</p></div>` : '');
    return [left, right];
  }

  // ---------------------------------------------------------------- the Field kit

  function kitMission(id) {
    const reg = game.missions;
    return (reg && typeof reg.get === 'function' && reg.get(id)) || game['missions_' + id] || null;
  }
  function kitRecord(id) {
    const r = state.missions && state.missions[id];
    return r && typeof r === 'object' ? r : { runs: 0, done: 0, best: 0 };
  }
  function kitDoneCount() {
    let n = 0;
    for (const id of KIT_IDS) if (kitRecord(id).done > 0) n++;
    return n;
  }
  const starsHtml = (n) => `<span class="nb-kit-stars">${[1, 2, 3].map((k) => `<i class="${k <= n ? 'is-on' : ''}">${icon('star')}</i>`).join('')}</span>`;
  // The spread's header (the mission's title, its blurb, its stamps and a chip for
  // each mission) and an empty body the mission draws itself into (afterShow).
  function kitSpread(id) {
    const m = kitMission(id);
    const info = KIT_INFO[id] || { title: id, icon: 'kit', blurb: '' };
    let nb = null;
    try { nb = m && typeof m.notebook === 'function' ? m.notebook() : null; } catch (e) { console.error(e); nb = null; }
    const title = (nb && nb.title) || (m && m.title) || info.title;
    const blurb = (nb && nb.blurb) || info.blurb;
    const rec = kitRecord(id);
    const chips = KIT_IDS.map((k) => {
      const r = kitRecord(k), inf = KIT_INFO[k];
      // a short name on the tab (the full one on hover), so all three fit on the right page
      return `<button type="button" class="nb-kit-chip${k === id ? ' is-on' : ''}" data-go="kit:${k}" title="${escapeHtml(inf.title)}" aria-label="${escapeHtml(inf.title)}">${icon(inf.icon)}<span>${escapeHtml(inf.tab || inf.title)}</span>${r.best ? starsHtml(r.best) : ''}</button>`;
    }).join('');
    const stamps = Array.isArray(nb && nb.stamps) ? nb.stamps.map((s) => (typeof s === 'string' ? { label: s, done: true } : s)).filter((s) => s && s.label) : [];
    const stampHtml = stamps.length
      ? `<div class="nb-kit-stamps">${stamps.map((s, k) => `<div class="nb-album-cell" title="${escapeHtml(s.label)}">${s.done
        ? stampEl(s.label, s.tone || 'blue', s.icon || info.icon).outerHTML
        : `<div class="stamp is-empty"></div><small>${escapeHtml(s.label)}</small>`}</div>`).join('')}</div>`
      : '';
    const body = m ? '<div class="nb-kit-body"></div>'
      : `<div class="nb-kit-body"><div class="nb-empty">${icon(info.icon)}<br>This bit of kit is still in its box.<br>Ask James on survey day!</div></div>`;
    // laid out as two pages with the spine in the gap between them: the title and blurb on
    // the left, the missions' chips and the stamps on the right; the body spans both and
    // each mission keeps its own two pages (a grid of two columns, 3.4em apart)
    return '<div class="nb-kit-grid">' +
      `<div class="nb-wide-head nb-kit-head"><h2>${icon(info.icon)} ${escapeHtml(title)}</h2>${rec.best ? starsHtml(rec.best) : ''}</div>` +
      `<div class="nb-kit-chips">${chips}</div>` +
      `<p class="nb-note nb-kit-blurb">${escapeHtml(blurb)}</p>` +
      `${stampHtml || '<div></div>'}</div>` +
      body;
  }

  // the day's loops snapped and poles broken, under its catches (nothing on a day without)
  function breaksNote() {
    const words = breakWords(state.today || {});
    return words.length ? `<div class="nb-note" style="margin-top:0.6em">${icon('loop_pole')} Breaks today: ${escapeHtml(words.join(', '))}</div>` : '';
  }

  // The grid: the lattice map with the flags (and a gold count of today's catches by
  // each), each flag's catches this season, and today's catches, each by its nearest flag.
  function gridSpread() {
    ensureLoggerStyle();
    const flags = state.flags || [];
    const log = catchLog();
    const day = (state.days || 0) + 1;
    const season = new Map();
    for (const e of log) season.set(e.flag, (season.get(e.flag) || 0) + 1);
    const chips = flags.map((f) => {
      const n = season.get(f.id) || 0;
      return `<span class="is-logger" title="${n} catch${n === 1 ? '' : 'es'} by this flag">${icon('flag')}${escapeHtml(f.label || f.id)}${n ? `<em class="nb-lg-n">${n}</em>` : ''}</span>`;
    }).join('');
    const today = log.filter((e) => e.day === day).slice(-40).reverse();
    const patchWords = (flagsSys() && flagsSys().patchWords) || {}; // the loggers' patch each sat in
    const rows = today.length
      ? today.map((e) => {
        const u = BY_KEY[e.sp];
        const sex = SEX_WORD[e.sex] && e.sex !== 'u' ? `, ${SEX_WORD[e.sex]}` : '';
        const extra = [patchWords[e.patch] || '', e.display ? DISPLAY_WORD[e.display] || 'mid display' : '', e.tracked ? 'backpack' : ''].filter(Boolean).join(', ');
        return `<div class="nb-row nb-lg-row"><span class="nb-lg-flag">${escapeHtml(e.flag)}</span>` +
          `<div><b>${escapeHtml(u ? u.common : e.sp)}</b>${escapeHtml(sex)}<small>${clockText(e.hours)}${extra ? ' · ' + escapeHtml(extra) : ''}</small></div></div>`;
      }).join('')
      : '<div class="nb-empty">Catches go here, each noted by its nearest flag.</div>';
    return '<div class="nb-wide-head"><h2>The grid</h2><div class="nb-sci" style="font-style:normal">Stakes every 5 m, lettered west to east and numbered south to north: ' +
      '"C07" is column C, row 7. Twelve flags stand all season, each with a temperature logger, and every catch is noted by its nearest flag.</div></div>' +
      '<div class="nb-lg-gridbody">' +
        `<div class="nb-lg-col"><canvas class="nb-map"></canvas><div class="nb-flaglist">${chips || '<em class="nb-sci">No flags up yet.</em>'}</div></div>` +
        `<div class="nb-lg-col"><h3>${icon('lizard')} Today's catches <small class="nb-lg-count">${today.length}</small></h3><div class="nb-list">${rows}</div>${breaksNote()}</div>` +
      '</div>';
  }

  // ---------------------------------------------------------------- the panel

  registerPanel('notebook', {
    bare: true, card: 'nb', clear: true,
    render(el, arg, api) {
      card = el;
      const was = pages[at];
      rebuildPages();
      at = Math.max(0, pages.indexOf(was));
      el.innerHTML =
        '<div class="nb-spread"></div>' +
        `<div class="nb-tabs">${[...new Set(pages.map(tabOf))].map(tabHtml).join('')}</div>` +
        `<button type="button" class="ui-card-close nb-close" aria-label="Close">${icon('close')}</button>` +
        '<button type="button" class="nb-arrow is-prev" aria-label="Previous page">&lsaquo;</button>' +
        '<button type="button" class="nb-arrow is-next" aria-label="Next page">&rsaquo;</button>' +
        '<div class="nb-help"><kbd>&larr;</kbd><kbd>&rarr;</kbd> turn pages · <kbd>N</kbd> close</div>';
      spread = el.querySelector('.nb-spread');
      tabs = el.querySelector('.nb-tabs');
      el.addEventListener('click', (e) => {
        const tab = e.target.closest('.nb-tab');
        if (tab) { show(Number(tab.dataset.i)); return; }
        const go = e.target.closest('[data-go]');
        if (go) { show(pages.indexOf(go.dataset.go)); return; }
        if (e.target.closest('.nb-arrow.is-prev')) show(at - 1);
        else if (e.target.closest('.nb-arrow.is-next')) show(at + 1);
        else if (e.target.closest('.nb-close')) api.close();
      });
      const want = arg && (arg.page || arg);
      if (typeof want === 'string' && pages.includes(want)) at = pages.indexOf(want);
      else if (want === 'kit') at = pages.indexOf(lastKit);
      else if (typeof want === 'string' && pages.includes('kit:' + want)) at = pages.indexOf('kit:' + want);
      else if (typeof want === 'string' && BY_KEY[want]) at = pages.indexOf(BY_KEY[want].key);
      show(at, false);
      return () => { card = null; spread = null; tabs = null; };
    },
    onKey(e) {
      if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); show(at + 1); }
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { e.preventDefault(); show(at - 1); }
    },
  });
  return {
    pages,
    show: (page) => show(typeof page === 'number' ? page : pages.indexOf(page)),
    setTasksModule(m) { getTasks = () => m; },
    get page() { return pages[at]; },
    // true when a species, tracked or logger page has changed since it was last opened
    hasNews() { for (const id of pages) if (id !== 'cover' && id !== 'grid' && isNew(id)) return true; return false; },
  };
}

// the chart: every logger's line in one soft ink, each reading's dot in its patch's colour
const CHART_INK = '#bba888', CHART_LABEL = '#7b6446', MIXED_HEX = '#dcc99c';
const DOT_FILL = { warm: WARM_HEX, cool: COOL_HEX, mixed: MIXED_HEX };
const KIND_WORD = { warm: 'Warm and sunny just now', cool: 'Cool and shady just now', mixed: 'Dappled sun and shade just now', stale: 'Downloaded a while ago: pass by again', none: 'Not downloaded yet today' };
const CHIP_WORD = { warm: 'sunny', cool: 'shady', mixed: 'dappled' };
const CHIP_FRESH = 0.5; // a logger's chip counts as fresh while its patch is at least this fresh (loggers.freshness)
const DISPLAY_WORD = { headbob: 'mid head bob', pushup: 'mid push-up', dewlap: 'mid dewlap' };

// the logger and grid pages' own bits (warm and cool as the maps draw them)
let lgStyled = false;
function ensureLoggerStyle() {
  if (lgStyled) return;
  lgStyled = true;
  const st = document.createElement('style');
  st.textContent = `
.nb-lg-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.35em; margin-top: 0.7em; }
.nb-lg-chip { display: grid; grid-template-columns: auto 1fr auto; align-items: center; column-gap: 0.35em; padding: 0.28em 0.5em 0.3em;
  border-radius: 0.6em; background: rgba(255, 255, 255, 0.6); border: 0.1em solid var(--paper-edge); line-height: 1.15; }
.nb-lg-chip i { width: 0.75em; height: 0.75em; border-radius: 50%; background: #fffaf0; border: 0.14em solid #4aa3d8; }
.nb-lg-chip b { font-weight: 800; font-variant-numeric: tabular-nums; }
.nb-lg-chip span { font-weight: 800; font-variant-numeric: tabular-nums; }
.nb-lg-chip small { grid-column: 1 / -1; color: var(--ink-soft); font-size: 0.72em; font-weight: 700; }
.nb-lg-chip.is-warm { background: #ffecd9; border-color: #ffc896; }
.nb-lg-chip.is-warm i { background: ${WARM_HEX}; border-color: #fff; }
.nb-lg-chip.is-cool { background: #e0f0fc; border-color: #a6d0ec; }
.nb-lg-chip.is-cool i { background: ${COOL_HEX}; border-color: #fff; }
.nb-lg-chip.is-mixed { background: #f6efdd; border-color: #e3d3a8; }
.nb-lg-chip.is-mixed i { background: linear-gradient(90deg, ${WARM_HEX} 50%, ${COOL_HEX} 50%); border-color: #fff; }
.nb-lg-chip.is-stale, .nb-lg-chip.is-none { opacity: 0.75; }
.nb-lg-key { display: grid; gap: 0.15em; margin: 0.45em 0 0.2em; color: var(--ink-soft); font-size: 0.85em; font-weight: 800; }
.nb-lg-key span { display: inline-flex; align-items: center; gap: 0.4em; }
.nb-lg-key i { flex: none; width: 0.9em; height: 0.9em; border-radius: 50%; opacity: 0.9; }
.nb-lg-key i.is-warm { background: ${WARM_HEX}; }
.nb-lg-key i.is-cool { background: ${COOL_HEX}; }
.nb-lg-count { margin-left: 0.3em; padding: 0 0.45em 0.05em; border-radius: 999px; background: #fff3cf; color: #9a6a12; font-size: 0.72em; }
.nb-page .nb-tip { margin-top: 0.5em; }
.nb-lg-gridbody { flex: 1; min-height: 0; display: grid; grid-template-columns: 1.6fr 1fr; gap: 1.2em; }
.nb-lg-col { display: flex; flex-direction: column; min-height: 0; }
.nb-lg-col .nb-list { flex: 1; min-height: 0; }
.nb-lg-row { padding: 0.35em 0.6em; }
.nb-lg-flag { flex: none; padding: 0.1em 0.45em 0.14em; border-radius: 0.4em; background: #ffe0ec; border: 0.1em solid #f3a7c4; font-weight: 800; font-size: 0.85em; }
.nb-lg-n { margin-left: 0.3em; padding: 0 0.35em; border-radius: 999px; background: #f5b82e; color: #5a3c10; font-style: normal; font-size: 0.85em; }`;
  document.head.appendChild(st);
}

// A small line chart of every logger's readings over the survey day (keep(reading):
// only those, when given): each logger's line in one soft ink, each reading's dot in its
// patch's colour (warm, cool or dappled, as the chips and the map), and the flag's
// label at each line's end, nudged apart where the ends bunch up.
function loggerChart(list, keep = null) {
  const W = 300, H = 150, L = 34, R = 10, T = 10, B = 24;
  const D = RULES.day;
  const today = (r) => !keep || keep(r);
  let lo = Infinity, hi = -Infinity, any = false;
  for (const l of list) for (const r of l.readings || []) { if (!today(r)) continue; any = true; lo = Math.min(lo, r.celsius); hi = Math.max(hi, r.celsius); }
  if (!any) return '<div class="nb-empty" style="margin:0.8em 0.5em">Walk past the loggers on survey day and their readings show here.</div>';
  lo = Math.floor(lo - 0.5); hi = Math.ceil(hi + 0.5);
  if (hi - lo < 3) hi = lo + 3;
  const x = (h) => L + ((h - D.start) / (D.end - D.start)) * (W - L - R);
  const y = (c) => T + (1 - (c - lo) / (hi - lo)) * (H - T - B);
  let g = '';
  for (let c = lo; c <= hi; c++) {
    g += `<line x1="${L}" x2="${W - R}" y1="${y(c)}" y2="${y(c)}" stroke="#e5d6b4" stroke-width="1"/>` +
      `<text x="${L - 5}" y="${y(c) + 4}" text-anchor="end" font-size="10" fill="#85735a" font-weight="700">${c}°</text>`;
  }
  for (let hr = 8; hr <= 18; hr += 2) g += `<text x="${x(hr)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#85735a" font-weight="700">${String(hr).padStart(2, '0')}:00</text>`;
  const ends = [];
  let lines = '', dots = '';
  for (const l of list) {
    const r = (l.readings || []).filter((p) => today(p) && Number.isFinite(p.hours) && Number.isFinite(p.celsius)).sort((a, b) => a.hours - b.hours);
    if (!r.length) continue;
    if (r.length > 1) lines += `<polyline points="${r.map((p) => `${x(p.hours).toFixed(1)},${y(p.celsius).toFixed(1)}`).join(' ')}" fill="none" stroke="${CHART_INK}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`;
    for (const p of r) dots += `<circle cx="${x(p.hours).toFixed(1)}" cy="${y(p.celsius).toFixed(1)}" r="3.4" fill="${DOT_FILL[p.kind] || MIXED_HEX}" stroke="#fff" stroke-width="1.4"/>`;
    const e = r[r.length - 1];
    ends.push({ x: x(e.hours), y: y(e.celsius), ly: y(e.celsius), text: String(l.label || l.id || '') });
  }
  // the labels: ends within a label's width of each other share a column, spread 8.6 apart
  const GAP = 8.6, top = T + 3, bottom = H - B - 1;
  ends.sort((a, b) => a.x - b.x);
  for (let s = 0; s < ends.length;) {
    let e = s + 1;
    while (e < ends.length && ends[e].x - ends[s].x < 24) e++;
    const grp = ends.slice(s, e).sort((a, b) => a.y - b.y);
    for (let k = 1; k < grp.length; k++) grp[k].ly = Math.max(grp[k].ly, grp[k - 1].ly + GAP);
    const over = grp.length ? grp[grp.length - 1].ly - bottom : 0;
    if (over > 0) for (const q of grp) q.ly -= over;
    for (let k = grp.length - 2; k >= 0; k--) grp[k].ly = Math.min(grp[k].ly, grp[k + 1].ly - GAP);
    for (const q of grp) q.ly = Math.max(top, q.ly);
    s = e;
  }
  let labels = '';
  for (const q of ends) {
    const right = q.x + 34 < W;
    const lx = right ? q.x + 7 : q.x - 7;
    if (Math.abs(q.ly - q.y) > 2.5) labels += `<line x1="${(right ? q.x + 3.4 : q.x - 3.4).toFixed(1)}" y1="${q.y.toFixed(1)}" x2="${(right ? lx - 1 : lx + 1).toFixed(1)}" y2="${q.ly.toFixed(1)}" stroke="${CHART_INK}" stroke-width="0.8"/>`;
    labels += `<text x="${lx.toFixed(1)}" y="${(q.ly + 3).toFixed(1)}" text-anchor="${right ? 'start' : 'end'}" font-size="8.5" font-weight="800" fill="${CHART_LABEL}" stroke="#fffaf0" stroke-width="2.4" paint-order="stroke">${escapeHtml(q.text)}</text>`;
  }
  return `<svg class="nb-chart" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif">${g}${lines}${dots}${labels}</svg>`;
}
