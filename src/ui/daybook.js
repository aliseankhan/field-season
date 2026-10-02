// Another player's field notebook for one day on the island board, read-only: opened
// from any board row that has one (the title's card and panel, the end-of-day card). It
// draws the snapshot the game sent with the day (src/game/daylog.js; the server checks
// it, and this checks it again) in the game's own notebook look: four spreads, turned
// with the arrows, A and D or the bookmarks, closed with Esc or a click outside.
//
//   the cover and the day's summary: the score and where it came from, the species
//     caught (how many and the biggest snout-vent length), the stamps earned, the
//     Steady hands badge for a day played with Precise aiming
//   the catches: each one's species, sex, SVL, perch and height, flag, time, nickname,
//     backpack and display
//   the followed lizards: each one's day in temperature (perch_day.js's chart) and sentence
//   the map (the catches as dots on the island map, and each backpack's GPS trail up
//     close on squared paper: a picture only) and the field kit done that day (the drone's stars and aerial photo, the scans and
//     their ghosts, the plants recorded)
//
// It sits over whatever is open (the title, the end card) in a layer of its own and
// keeps the keys while it is up, so nothing under it moves.
//
//   openDaybook({ key, name }, { fetchDay, game, tasks })
//   daybookOpen()  true while one is up

import { icon, escapeHtml } from './icons.js';
import { anoleSVG, playerBadge, ANOLE_LOOK } from './drawings.js';
import { anoleBadge } from '../catch/drawings.js';
import { stampEl } from './kit.js';
import { dayChart, dayKey as spellKey, lineOf, ensurePerchStyle, coinIcon, heightWords } from './perch_day.js';
import { PERCH_WORDS, NICKNAMES } from '../catch/tuning.js';
import { clockText } from '../game/state.js';

const SPECIES = [
  { key: 'crested', sci: 'cristatellus', common: 'Crested anole' },
  { key: 'brown', sci: 'sagrei', common: 'Brown anole' },
  { key: 'green', sci: 'carolinensis', common: 'Green anole' },
  { key: 'bark', sci: 'distichus', common: 'Bark anole' },
  { key: 'knight', sci: 'equestris', common: 'Knight anole' },
  { key: 'basilisk', sci: 'basilisk', common: 'Brown basilisk' },
];
const SP = Object.fromEntries(SPECIES.map((s) => [s.key, s]));
const PERCHES = Object.keys(PERCH_WORDS);
const DISPLAY_WORD = { headbob: 'mid head bob', pushup: 'mid push-up', dewlap: 'mid dewlap' };
const SEX_WORD = { m: 'male', f: 'female' };
const CODES = 'busmhdxf';
// where the points came from, in the summary's bar
const PARTS = [
  ['catch', 'Catches', '#ff9d6e'], ['pack', 'Backpacks and GPS', '#ff8fbd'], ['logger', 'Loggers', '#6fc3ef'],
  ['task', 'Stamps and requests', '#f2c14e'], ['kit', 'Field kit', '#7cc05a'], ['spot', 'Spotting', '#b59ce6'], ['other', 'Other', '#d9c29a'],
];
const TABS = [
  ['cover', 'book', '#f2c14e', 'Cover and summary'], ['catches', 'lizard', '#ff9d6e', 'Catches'],
  ['followed', 'thermometer', '#ffb35c', 'Followed lizards'], ['map', 'map', '#7cc05a', 'Map and field kit'],
];
const ISLAND = [-45.5, -33.5, 62.75, 46.5]; // the walkable island (data/terrain.json walk_bounds)

// ---------------------------------------------------------------- checking it again

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clampN = (v, a, b, d = a) => (isNum(v) ? Math.min(b, Math.max(a, v)) : d);
const colour = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : null);
const oneOf = (v, list) => (typeof v === 'string' && list.includes(v) ? v : null);
const arr = (v, cap) => (Array.isArray(v) ? v.slice(0, cap) : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const PHOTO = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;

// What the viewer draws, whatever came over the wire: only the game's own lists and
// bounded numbers (anything else is left out), never markup.
function clean(raw) {
  const n = obj(raw);
  const out = { day: Math.round(clampN(n.day, 1, 9999, 1)) };
  const lk = obj(n.looks);
  out.looks = { hat: colour(lk.hat), shirt: colour(lk.shirt) };
  const p = obj(n.parts);
  out.parts = {};
  for (const [k] of PARTS) out.parts[k] = Math.round(clampN(p[k], 0, 20000, 0));
  out.parts.croc = Math.round(clampN(p.croc, 0, 5000, 0));
  const w = obj(n.work);
  out.work = {};
  for (const k of ['spotted', 'loggers', 'gps', 'clipped', 'taped']) out.work[k] = Math.round(clampN(w[k], 0, 999, 0));
  out.catches = arr(n.catches, 60).map(obj).filter((c) => SP[c.sp] && isNum(c.x) && isNum(c.z)).map((c) => ({
    sp: c.sp, sex: oneOf(c.sex, ['m', 'f']), svl: isNum(c.svl) ? Math.round(clampN(c.svl, 10, 250)) : null,
    perch: oneOf(c.perch, PERCHES), h: clampN(c.h, 0, 30, 0), flag: typeof c.flag === 'string' && /^[A-Z][0-9]{2}$/.test(c.flag) ? c.flag : null,
    t: clampN(c.t, 0, 24, 0), nick: oneOf(c.nick, NICKNAMES), pack: colour(c.pack), disp: oneOf(c.disp, Object.keys(DISPLAY_WORD)),
    x: clampN(c.x, -62, 82), z: clampN(c.z, -50, 52),
  }));
  out.followed = arr(n.followed, 3).map(obj).filter((f) => SP[f.sp] && isNum(f.clip)).map((f, i) => {
    const clip = clampN(f.clip, 0, 24);
    return {
      k: i, nick: oneOf(f.nick, NICKNAMES) || 'Anole', sp: f.sp, sex: oneOf(f.sex, ['m', 'f']), col: colour(f.col) || '#ff7b54',
      kind: oneOf(f.kind, ['sunny', 'shady', 'dappled']) || 'dappled', perch: oneOf(f.perch, PERCHES), h: clampN(f.h, 0, 30, 0),
      clip, upto: clampN(f.upto, clip, 24, clip), whole: f.whole === true, dl: [],
      states: arr(f.runs, 40).filter((r) => Array.isArray(r) && isNum(r[0]) && typeof r[1] === 'string' && r[1].length === 1 && CODES.includes(r[1]))
        .map((r) => [clampN(r[0], 0, 24), r[1]]),
      temps: arr(f.temps, 40).filter((r) => Array.isArray(r) && isNum(r[0]) && isNum(r[1])).map((r) => [clampN(r[0], 0, 24), clampN(r[1], -10, 60), 0]),
    };
  });
  // (a trail of one fix is no trail: left out)
  out.trails = arr(n.trails, 5).map(obj).filter((t) => SP[t.sp] && colour(t.pack)).map((t) => ({
    nick: oneOf(t.nick, NICKNAMES), sp: t.sp, pack: colour(t.pack),
    pts: arr(t.pts, 60).filter((q) => Array.isArray(q) && isNum(q[0]) && isNum(q[1])).map((q) => [clampN(q[0], -62, 82), clampN(q[1], -50, 52)]),
  })).filter((t) => t.pts.length >= 2);
  out.stamps = arr(n.stamps, 30).filter((s) => typeof s === 'string' && /^[a-z]+\.[a-z]+$/.test(s));
  const k = obj(n.kit);
  out.kit = {};
  if (k.drone && typeof k.drone === 'object') {
    const photo = typeof k.drone.photo === 'string' && k.drone.photo.length < 60000 && PHOTO.test(k.drone.photo) ? k.drone.photo : null;
    out.kit.drone = { stars: Math.round(clampN(k.drone.stars, 0, 3, 0)), photo };
  }
  if (k.tls && typeof k.tls === 'object') out.kit.tls = { stars: Math.round(clampN(k.tls.stars, 0, 3, 0)), scans: Math.round(clampN(k.tls.scans, 0, 20, 0)), ghosts: Math.round(clampN(k.tls.ghosts, 0, 60, 0)) };
  if (k.rtk && typeof k.rtk === 'object') out.kit.rtk = { stars: Math.round(clampN(k.rtk.stars, 0, 3, 0)), plants: Math.round(clampN(k.rtk.plants, 0, 30, 0)), right: Math.round(clampN(k.rtk.right, 0, 30, 0)) };
  return out;
}

// ---------------------------------------------------------------- the pages

const num = (n) => Number(n || 0).toLocaleString('en-GB');
const possessive = (name) => `${name}${/s$/i.test(name) ? "'" : "'s"}`;
const stars = (n) => `<span class="db-stars" aria-label="${n} of 3 stars">${[1, 2, 3].map((k) => `<i class="${k <= n ? 'is-on' : ''}">${icon('star')}</i>`).join('')}</span>`;
const steadyBadge = () => `<div class="db-steady">${icon('hand')}<span>Steady hands day</span></div>`;
const where = (c) => (c.perch === 'ground' ? 'on the ground' : `${PERCH_WORDS[c.perch] || 'perch'}, ${heightWords(c.h)}`);

function coverPage(day, nb) {
  const species = new Set(nb.catches.map((c) => c.sp)).size;
  const stat = (v, label) => `<div class="nb-stat"><b>${escapeHtml(String(v))}</b><small>${escapeHtml(label)}</small></div>`;
  // the day's rarest catch on the cover, as a photo pinned in ("the day's catch" when
  // there was only the one species)
  const rare = ['basilisk', 'knight', 'bark', 'green', 'brown', 'crested'].find((k) => nb.catches.some((c) => c.sp === k));
  const photo = rare
    ? `<figure class="nb-photo db-cover-photo">${anoleSVG(SP[rare].sci, { perch: true, dewlap: true })}<figcaption>${species > 1 ? 'The rarest catch' : 'The day\'s catch'}: a ${escapeHtml(SP[rare].common.toLowerCase())}</figcaption></figure>`
    : `<figure class="nb-photo db-cover-photo">${anoleSVG('cristatellus', { silhouette: true })}<figcaption>No catches that day</figcaption></figure>`;
  return `<div class="nb-plate"><small>Lizard Island · Stroud Lab</small><b>${escapeHtml(possessive(day.name))} field notebook</b><span>Survey day ${nb.day}</span></div>` +
    '<div class="db-cover-row">' +
      `<div class="db-face">${playerBadge({ hat: nb.looks.hat || undefined, shirt: nb.looks.shirt || undefined })}</div>` +
      `<div class="nb-note">A day of catching, measuring and letting go, shared on the island board.${day.steady ? ' Played with Precise aiming from morning to sunset.' : ''}</div>` +
    '</div>' + photo +
    '<div class="nb-stats db-stats">' +
      stat(num(day.score), 'Points') + stat(nb.catches.length, nb.catches.length === 1 ? 'Catch' : 'Catches') +
      stat(species, 'Species') + stat(nb.stamps.length, nb.stamps.length === 1 ? 'Stamp' : 'Stamps') +
    '</div>';
}

function summaryPage(day, nb, tasks) {
  const P = nb.parts;
  const total = PARTS.reduce((a, [k]) => a + P[k], 0);
  const bar = total ? PARTS.filter(([k]) => P[k] > 0).map(([k, label, c]) =>
    `<i style="flex:${P[k]};background:${c}" title="${escapeHtml(label)}"></i>`).join('') : '';
  const legend = PARTS.filter(([k]) => P[k] > 0).map(([k, label, c]) =>
    `<span><i style="background:${c}"></i>${escapeHtml(label)} <b>${num(P[k])}</b></span>`).join('') +
    (P.croc ? `<span class="is-loss"><i></i>Losses <b>-${num(P.croc)}</b></span>` : ''); // (croc snaps and broken poles)
  // the species caught: how many and the biggest SVL
  const rows = SPECIES.map((s) => {
    const list = nb.catches.filter((c) => c.sp === s.key);
    if (!list.length) return '';
    const big = Math.max(0, ...list.map((c) => c.svl || 0));
    return `<div class="db-sp"><span class="db-sp-art">${anoleSVG(s.sci, { perch: false, dewlap: false })}</span><b>${escapeHtml(s.common)}</b>` +
      `<em>×${list.length}</em><small>${big ? `biggest ${big} mm` : ''}</small></div>`;
  }).join('');
  const T = tasks && Array.isArray(tasks.TASKS) ? tasks.TASKS : [];
  const stamps = nb.stamps.map((id) => {
    const t = T.find((x) => x.id === id);
    if (!t) return '';
    const sp = t.species;
    const tone = t.group === 'setup' ? 'green' : t.group === 'field' || t.group === 'kit' ? 'blue' : sp === 'bark' || sp === 'knight' ? 'gold' : 'red';
    const ic = t.icon || (sp === 'croc' ? 'eye' : t.group === 'setup' ? 'check' : t.group === 'field' ? 'star' : 'lizard');
    return `<div class="nb-album-cell" title="${escapeHtml(t.label || t.stamp || '')}">${stampEl(t.stamp || 'Done', tone, ic).outerHTML}</div>`;
  }).join('');
  return `<h2>The day's score</h2>` +
    `<div class="db-score"><b>${num(day.score)}</b><small>points</small>${day.steady ? steadyBadge() : ''}</div>` +
    (bar ? `<h3>${icon('star')} How it was made</h3><div class="db-bar">${bar}</div><div class="db-legend">${legend}</div>` : '') +
    `<h3>${icon('lizard')} Species caught</h3>` +
    (rows ? `<div class="db-species">${rows}</div>` : '<div class="nb-empty db-empty">No catches that day.</div>') +
    `<h3>${icon('check')} Stamps earned</h3>` +
    (stamps ? `<div class="nb-album db-album">${stamps}</div>` : '<div class="nb-empty db-empty">No new stamps that day.</div>');
}

function catchesSpread(nb) {
  const list = nb.catches.slice().sort((a, b) => a.t - b.t);
  const rows = list.map((c) => {
    const s = SP[c.sp];
    const bits = [c.svl ? `SVL ${c.svl} mm` : null, where(c), c.flag ? `by ${c.flag}` : null, clockText(c.t), c.disp ? DISPLAY_WORD[c.disp] : null].filter(Boolean);
    const tag = c.nick ? `<span class="db-nick">${c.pack ? `<i class="pl-swatch" style="background:${c.pack}"></i>` : ''}${escapeHtml(c.nick)}</span>`
      : c.pack ? '<span class="db-nick"><i class="pl-swatch" style="background:' + c.pack + '"></i>backpack</span>' : '';
    return `<div class="nb-row db-catch"><span class="db-badge">${anoleBadge(s.sci, c.sex === 'f' ? 'f' : 'm')}</span>` +
      `<div><b>${escapeHtml(s.common)}</b>${c.sex ? `, ${SEX_WORD[c.sex]}` : ''} ${tag}<small>${escapeHtml(bits.join(' · '))}</small></div>` +
      (c.disp ? `<span class="db-disp" title="Caught ${escapeHtml(DISPLAY_WORD[c.disp])}">${icon('star')}</span>` : '') + '</div>';
  }).join('');
  return `<div class="nb-wide-head"><h2>Catches</h2><div class="nb-sci" style="font-style:normal">${list.length} caught, measured, marked and let go</div></div>` +
    (rows ? `<div class="nb-list db-catches">${rows}</div>` : '<div class="nb-empty">No catches that day.</div>');
}

function followedSpread(nb) {
  const cards = nb.followed.map((e) => {
    const s = SP[e.sp];
    const has = e.temps.length > 0 && e.states.length > 0;
    return '<div class="db-follow">' +
      `<div class="db-follow-head"><span class="db-badge">${anoleBadge(s.sci, e.sex === 'f' ? 'f' : 'm')}</span><div><b>${escapeHtml(e.nick)}</b>${e.whole ? ' <em class="db-whole" title="Followed all day">★</em>' : ''}` +
        `<small>${escapeHtml(s.common)}${e.sex ? ', ' + SEX_WORD[e.sex] : ''} · ${escapeHtml(e.perch === 'ground' ? 'on the ground' : `${PERCH_WORDS[e.perch] || 'perch'}, ${heightWords(e.h)}`)}</small></div>${coinIcon(e.col, 1.5)}</div>` +
      (has ? `${dayChart(e, { W: 360, H: 150, compact: true })}${spellKey(e)}<p class="pl-line is-page">${escapeHtml(lineOf(e))}</p>`
        : '<div class="nb-empty db-empty">Its logger had only just started.</div>') +
      '</div>';
  }).join('');
  return `<div class="nb-wide-head"><h2>Followed lizards</h2><div class="nb-sci" style="font-style:normal">Button loggers clipped on their perches: each lizard's day in temperature</div></div>` +
    (cards ? `<div class="db-follows is-${nb.followed.length}">${cards}</div>` : '<div class="nb-empty">No lizards followed with a perch logger that day.</div>');
}

function mapPage(nb) {
  const present = SPECIES.filter((s) => nb.catches.some((c) => c.sp === s.key));
  const key = present.map((s) => `<span><i style="background:${ANOLE_LOOK[s.sci].body}"></i>${escapeHtml(s.common)}</span>`).join('') +
    (nb.catches.some((c) => c.pack) ? '<span><i class="is-pack"></i>With a backpack</span>' : '');
  // each backpack's trail up close (an anole wanders a metre or two: too small to see on
  // the island map)
  const trails = nb.trails.map((t, i) => `<figure class="db-trail"><canvas class="db-trail-map" data-i="${i}"></canvas>` +
    `<figcaption><i class="pl-swatch" style="background:${t.pack}"></i>${escapeHtml(t.nick || 'Backpack')}</figcaption></figure>`).join('');
  return `<h2>Where the day went</h2><div class="nb-sci" style="font-style:normal">Each catch where it sat${nb.trails.length ? ', and the GPS trails up close' : ''}</div>` +
    '<canvas class="nb-map db-map"></canvas>' +
    (key ? `<div class="db-key">${key}</div>` : '<div class="nb-empty db-empty">Nothing to put on the map that day.</div>') +
    (trails ? `<div class="db-trails is-${nb.trails.length}">${trails}</div>` : '');
}

function kitPage(nb) {
  const K = nb.kit;
  const parts = [];
  if (K.drone) {
    parts.push(`<div class="db-kit"><h3>${icon('drone')} Drone survey ${stars(K.drone.stars)}</h3>` +
      (K.drone.photo ? `<figure class="nb-photo db-photo"><img alt="The aerial photo from that day's flight" src="${K.drone.photo}"><figcaption>The island from 150 ft</figcaption></figure>`
        : '<div class="db-kit-line">Flown, but no photo came back with the day.</div>') + '</div>');
  }
  if (K.tls) {
    parts.push(`<div class="db-kit"><h3>${icon('tls')} Laser scans ${K.tls.stars ? stars(K.tls.stars) : ''}</h3>` +
      `<div class="db-kit-line"><b>${K.tls.scans}</b> scan${K.tls.scans === 1 ? '' : 's'} made · ` +
      (K.tls.ghosts ? `<b>${K.tls.ghosts}</b> ghost${K.tls.ghosts === 1 ? '' : 's'} in the cloud` : 'no ghosts, all clean!') + '</div></div>');
  }
  if (K.rtk) {
    parts.push(`<div class="db-kit"><h3>${icon('rtk')} Plant survey ${K.rtk.stars ? stars(K.rtk.stars) : ''}</h3>` +
      `<div class="db-kit-line"><b>${K.rtk.plants}</b> plant${K.rtk.plants === 1 ? '' : 's'} recorded · <b>${Math.min(K.rtk.right, K.rtk.plants)}</b> named right</div></div>`);
  }
  const W = nb.work;
  const stat = (v, label) => `<div class="nb-stat"><b>${v}</b><small>${escapeHtml(label)}</small></div>`;
  return `<h2>Field kit</h2>` +
    (parts.length ? parts.join('') : '<div class="nb-empty db-empty">No field kit out that day.</div>') +
    `<h3 style="margin-top:auto">${icon('check')} The day's work</h3>` +
    '<div class="nb-stats db-work">' + stat(W.spotted, 'Spotted') + stat(W.loggers, 'Loggers read') + stat(W.gps, 'GPS downloads') + stat(W.clipped, 'Perch loggers') + '</div>';
}

// the day on the island map: the backpacks' trails, then each catch as a dot in its
// species' colour (ringed in its backpack's colour when it got one), and a 10 m bar
function drawMap(cv, nb, game) {
  if (!cv || !cv.isConnected) return;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const take = (x, z) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); };
  for (const c of nb.catches) take(c.x, c.z);
  for (const t of nb.trails) for (const p of t.pts) take(p[0], p[1]);
  let bounds = ISLAND;
  if (Number.isFinite(x0)) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const w = Math.max(60, x1 - x0 + 16), h = Math.max(45, z1 - z0 + 16);
    bounds = [cx - w / 2, cz - h / 2, cx + w / 2, cz + h / 2];
  }
  const marks = (ctx, X, Y, u, s, W, H) => {
    for (const c of nb.catches) {
      const x = X(c.x), y = Y(c.z);
      if (c.pack) { ctx.beginPath(); ctx.arc(x, y, 8.8 * u, 0, Math.PI * 2); ctx.fillStyle = c.pack; ctx.fill(); ctx.strokeStyle = '#3a2f2a'; ctx.lineWidth = 1 * u; ctx.stroke(); }
      ctx.beginPath(); ctx.arc(x, y, 6 * u, 0, Math.PI * 2);
      ctx.fillStyle = ANOLE_LOOK[SP[c.sp].sci].body; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * u; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 7 * u, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(58, 47, 42, 0.55)'; ctx.lineWidth = 1 * u; ctx.stroke();
    }
    // the trails over the dots, to scale (the pictures under the map show them up close)
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const t of nb.trails) trailLine(ctx, t.pts, X, Y, u, t.pack, 0.8);
    const bar = 10 * s;
    if (bar < W * 0.5) {
      const bx = 10 * u, by = H - 10 * u;
      ctx.strokeStyle = '#3a2f2a'; ctx.lineWidth = 2 * u; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(bx, by - 3 * u); ctx.lineTo(bx, by); ctx.lineTo(bx + bar, by); ctx.lineTo(bx + bar, by - 3 * u); ctx.stroke();
      ctx.font = `800 ${Math.round(9.5 * u)}px system-ui, sans-serif`;
      ctx.fillStyle = '#3a2f2a'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText('10 m', bx + bar + 4 * u, by + 3 * u);
    }
  };
  const maps = game && game.ui && game.ui.maps;
  if (maps && maps.drawIsland) {
    maps.drawIsland(cv, {
      bounds, bare: true, patches: false,
      after: (ctx, v) => marks(ctx, (x) => v.W / 2 + (x - v.cx) * v.s, (z) => v.H / 2 + (z - v.cz) * v.s, v.dpr, v.s, v.W, v.H),
    });
    return;
  }
  // (no map to hand: the dots on squared paper)
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
  if (!W || !H) return;
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const [bx0, bz0, bx1, bz1] = bounds;
  const s = Math.min(W / (bx1 - bx0), H / (bz1 - bz0));
  ctx.fillStyle = '#fffaf0'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(120, 160, 200, 0.28)'; ctx.lineWidth = dpr;
  for (let x = 0; x < W; x += 5 * s) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 5 * s) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  marks(ctx, (x) => W / 2 + (x - (bx0 + bx1) / 2) * s, (z) => H / 2 + (z - (bz0 + bz1) / 2) * s, dpr, s, W, H);
}

// a trail: a soft white line with the pack's colour dotted along it (k: its thickness)
function trailLine(ctx, pts, X, Y, u, pack, k = 1) {
  if (pts.length < 2) return;
  for (let pass = 0; pass < 2; pass++) {
    ctx.setLineDash(pass ? [2.5 * u * k, 3 * u * k] : []);
    ctx.lineWidth = (pass ? 2.8 : 5.6) * u * k;
    ctx.strokeStyle = pass ? pack : 'rgba(255, 252, 240, 0.9)';
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

// One backpack's trail up close, sketched on squared paper (1 m squares) as the perch
// loggers' tiny maps are: where its lizard was caught (its species' dot in its backpack's
// ring), the trail through its fixes, the last fix, and a 1 m bar.
function drawTrail(cv, t, nb) {
  if (!cv || !cv.isConnected || !t) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
  if (!W || !H) return;
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const home = nb.catches.find((c) => c.pack === t.pack && (!t.nick || c.nick === t.nick)) || nb.catches.find((c) => c.pack === t.pack) || null;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const take = (x, z) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); };
  for (const p of t.pts) take(p[0], p[1]);
  const near = home && Math.hypot(home.x - (x0 + x1) / 2, home.z - (z0 + z1) / 2) < 12;
  if (near) take(home.x, home.z);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const s = Math.min(W / Math.max(4, x1 - x0 + 2), H / Math.max(3, z1 - z0 + 2));
  const X = (x) => W / 2 + (x - cx) * s, Y = (z) => H / 2 + (z - cz) * s;
  ctx.fillStyle = '#fffaf0'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(120, 160, 200, 0.3)'; ctx.lineWidth = dpr;
  for (let k = Math.floor(cx - W / s / 2); k <= Math.ceil(cx + W / s / 2); k++) { const x = Math.round(X(k)) + 0.5; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let k = Math.floor(cz - H / s / 2); k <= Math.ceil(cz + H / s / 2); k++) { const y = Math.round(Y(k)) + 0.5; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  const u = dpr;
  if (near) {
    const hx = X(home.x), hy = Y(home.z);
    ctx.beginPath(); ctx.arc(hx, hy, 6.4 * u, 0, Math.PI * 2); ctx.fillStyle = t.pack; ctx.fill();
    ctx.strokeStyle = '#3a2f2a'; ctx.lineWidth = 1 * u; ctx.stroke();
    ctx.beginPath(); ctx.arc(hx, hy, 4.2 * u, 0, Math.PI * 2); ctx.fillStyle = ANOLE_LOOK[SP[home.sp].sci].body; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4 * u; ctx.stroke();
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  trailLine(ctx, t.pts, X, Y, u, t.pack, 0.9);
  const last = t.pts[t.pts.length - 1];
  ctx.beginPath(); ctx.arc(X(last[0]), Y(last[1]), 3.4 * u, 0, Math.PI * 2);
  ctx.fillStyle = t.pack; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.3 * u; ctx.stroke();
  // 1 m
  const bx = 5 * u, by = H - 6 * u;
  ctx.strokeStyle = '#3a2f2a'; ctx.lineWidth = 1.6 * u; ctx.lineCap = 'butt';
  ctx.beginPath(); ctx.moveTo(bx, by - 2.5 * u); ctx.lineTo(bx, by); ctx.lineTo(bx + s, by); ctx.lineTo(bx + s, by - 2.5 * u); ctx.stroke();
  ctx.font = `800 ${Math.round(8.5 * u)}px system-ui, sans-serif`;
  ctx.fillStyle = '#3a2f2a'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText('1 m', bx + s + 3 * u, by + 2.5 * u);
}

// ---------------------------------------------------------------- the viewer

let open = null;
export const daybookOpen = () => !!open;

export function openDaybook({ key, name = '' }, { fetchDay, game = null, tasks = null } = {}) {
  if (open) return;
  ensurePerchStyle();
  const root = document.getElementById('ui') || document.body;
  const was = document.activeElement;
  if (was && was.blur) was.blur();
  const el = document.createElement('div');
  el.className = 'db-overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', name ? `${possessive(name)} field notebook` : 'A field notebook');
  el.innerHTML = '<div class="nb db-book">' +
    `<div class="nb-spread"><section class="nb-page nb-wide db-wait"><div class="nb-empty">${icon('book')}<br>Opening ${escapeHtml(name ? possessive(name) : 'the')} notebook...</div></section></div>` +
    `<div class="nb-tabs">${TABS.map(([id, ic, c, title], i) => `<button type="button" class="nb-tab" data-i="${i}" title="${escapeHtml(title)}" style="--tab:${c}">${icon(ic)}</button>`).join('')}</div>` +
    `<button type="button" class="ui-card-close nb-close" aria-label="Close">${icon('close')}</button>` +
    '<button type="button" class="nb-arrow is-prev" aria-label="Previous page">&lsaquo;</button>' +
    '<button type="button" class="nb-arrow is-next" aria-label="Next page">&rsaquo;</button>' +
    '<div class="nb-help"><kbd>&larr;</kbd><kbd>&rarr;</kbd> turn pages · <kbd>Esc</kbd> close</div>' +
    '<div class="db-ribbon">Read only</div>' +
    '</div>';
  root.appendChild(el);
  const book = el.querySelector('.db-book');
  const spread = el.querySelector('.nb-spread');
  const tabs = el.querySelector('.nb-tabs');
  let at = 0, day = null, nb = null;

  function show(i, turn = true) {
    if (!nb) return;
    at = Math.max(0, Math.min(TABS.length - 1, i));
    const id = TABS[at][0];
    const t = turn ? ' is-turn' : '';
    const folio = `<div class="nb-folio" style="left:1.7em">${at * 2 + 1}</div><div class="nb-folio" style="right:1.7em">${at * 2 + 2}</div>`;
    if (id === 'cover') {
      spread.innerHTML = `<section class="nb-page is-left${t}">${coverPage(day, nb)}<div class="nb-folio">1</div></section>` +
        `<section class="nb-page is-right db-summary${t}">${summaryPage(day, nb, tasks)}<div class="nb-folio">2</div></section>`;
    } else if (id === 'catches') {
      spread.innerHTML = `<section class="nb-page nb-wide${t}">${catchesSpread(nb)}${folio}</section>`;
    } else if (id === 'followed') {
      spread.innerHTML = `<section class="nb-page nb-wide${t}">${followedSpread(nb)}${folio}</section>`;
    } else {
      spread.innerHTML = `<section class="nb-page is-left db-mappage${t}">${mapPage(nb)}<div class="nb-folio">${at * 2 + 1}</div></section>` +
        `<section class="nb-page is-right db-kitpage${t}">${kitPage(nb)}<div class="nb-folio">${at * 2 + 2}</div></section>`;
      const cv = spread.querySelector('canvas.db-map');
      requestAnimationFrame(() => {
        drawMap(cv, nb, game);
        spread.querySelectorAll('canvas.db-trail-map').forEach((c) => drawTrail(c, nb.trails[Number(c.dataset.i)], nb));
      });
    }
    tabs.querySelectorAll('.nb-tab').forEach((b, k) => b.classList.toggle('is-on', k === at));
    el.querySelector('.nb-arrow.is-prev').disabled = at === 0;
    el.querySelector('.nb-arrow.is-next').disabled = at === TABS.length - 1;
    el.dataset.page = id;
  }
  function close() {
    if (open !== state) return;
    open = null;
    window.removeEventListener('keydown', onKey, true);
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 180);
    if (was && was.isConnected && was.focus) { try { was.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
  }
  // the keys are the notebook's while it is up (nothing under it hears them)
  function onKey(e) {
    if (open !== state) return;
    e.stopImmediatePropagation();
    if (e.code === 'Escape' || e.code === 'KeyN' || e.code === 'KeyP') { e.preventDefault(); close(); }
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); show(at + 1); }
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { e.preventDefault(); show(at - 1); }
    else if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
  }
  const state = { el, close };
  open = state;
  window.addEventListener('keydown', onKey, true);
  el.addEventListener('pointerdown', (e) => { if (e.target === el) close(); });
  el.addEventListener('click', (e) => {
    const tab = e.target.closest('.nb-tab');
    if (tab) { show(Number(tab.dataset.i)); return; }
    if (e.target.closest('.nb-arrow.is-prev')) show(at - 1);
    else if (e.target.closest('.nb-arrow.is-next')) show(at + 1);
    else if (e.target.closest('.nb-close')) close();
  });

  Promise.resolve(typeof fetchDay === 'function' ? fetchDay(key) : null).then((d) => {
    if (open !== state) return;
    if (!d) {
      spread.innerHTML = `<section class="nb-page nb-wide db-wait"><div class="nb-empty">${icon('book')}<br>No notebook for this day.<br><small>It may have been an older day, or the board is resting.</small></div></section>`;
      return;
    }
    day = { name: String(d.name || name || 'A field biologist').slice(0, 14), score: Math.max(0, Math.round(Number(d.score) || 0)), steady: d.steady === true };
    nb = clean(d.notebook);
    el.setAttribute('aria-label', `${possessive(day.name)} field notebook, survey day ${nb.day}`);
    book.classList.toggle('is-steady', day.steady);
    show(0, false);
  }).catch(() => {
    if (open === state) spread.innerHTML = `<section class="nb-page nb-wide db-wait"><div class="nb-empty">${icon('book')}<br>This notebook could not be opened just now.</div></section>`;
  });
  return state;
}
