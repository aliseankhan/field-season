// The field HUD: the clock (a little sun arc from 07:30 to 18:30) and the score top
// left with a card under it (the set-up day's checklist, or on the survey day
// "Today": backpacks left, loggers due, James's requests and the research task
// nearest done), the tool in hand bottom left, the minimap and the notebook, map and
// pause keys top right. Shown on the set-up and survey days only. Text is only
// touched when what it shows changes. With the island board's API, a small "Steady hands"
// badge beside the score while the survey day can still go on that board (Precise aiming
// on since the day began: state.today.steady).

import { state, clockText, RULES } from '../game/state.js';
import { icon, escapeHtml } from './icons.js';
import { openPanel, toast } from './kit.js';
import { jamesPortrait } from './drawings.js';
import { settingsHtml, bindSettings } from './settings.js';
import { boardUp } from './scoreboard.js';
import { SCRIPT } from '../story/script.js';

// How the HUD names and draws each tool; the ring's own name wins when it has one.
export const TOOL_UI = {
  loop_pole: { name: 'Loop pole', icon: 'loop_pole' },
  flags: { name: 'Grid flags', icon: 'flag', count: 'flags' },
  loggers: { name: 'Temperature loggers', icon: 'logger', count: 'loggers' },
  backpacks: { name: 'GPS backpacks', icon: 'backpack', count: 'backpacks' },
  tape: { name: 'Tape measure', icon: 'tape' },
  none: { name: 'Empty hands', icon: 'hand' },
  // the field kit (src/missions)
  drone: { name: 'Drone controller', icon: 'drone' },
  tls: { name: 'Laser scanner', icon: 'tls' },
  rtk: { name: 'RTK rover', icon: 'rtk' },
};

const REASONS = {
  creep: 'Creep bonus', display: 'Display bonus', first: 'First of its kind', backpack: 'Backpack fitted',
  croc: 'Snap!', pole: 'Broken pole', 'croc spotted': 'Croc spotted', task: 'Task stamped', logger: 'Logger downloaded', loggerRead: 'Logger downloaded',
  spot: 'Spotted', catch: 'Caught!', recapture: 'Caught again', measured: 'Spot-on measuring', notes: 'Field notes',
  common: 'Common', uncommon: 'Uncommon', rare: 'Rare', 'very rare': 'Very rare',
  request: 'Request done', mission: 'Field kit', plant: 'Plant logged', scan: 'Laser scan', drone: 'Aerial photo',
};

function dialSvg() {
  return '<svg class="hud-dial" viewBox="0 0 62 34" aria-hidden="true">' +
    '<path d="M7 30 A24 24 0 0 1 55 30" fill="none" stroke="#efe2c2" stroke-width="5" stroke-linecap="round"/>' +
    '<path class="dial-done" d="M7 30 A24 24 0 0 1 55 30" fill="none" stroke="#ffd36b" stroke-width="5" stroke-linecap="round" pathLength="100" stroke-dasharray="0 100"/>' +
    '<path d="M3 31 H59" stroke="#b7d99a" stroke-width="3" stroke-linecap="round"/>' +
    '<circle class="dial-sun" cx="7" cy="30" r="5.4" fill="#ffc93a" stroke="#fff" stroke-width="2"/>' +
    '</svg>';
}

// The opening's jobs come from tasks.js (group 'setup', not the optional ones), in its
// order; the HUD's short labels and icons, by the part after 'setup.' (the state.setup
// key; the kit row is on while the story's step is the hunt or the ibis). The kit row
// shows a small icon for each piece, lit once it is found.
const SETUP_UI = {
  kit: ['bag', 'Find the kit'],
  station: ['station', 'Set the table upright'],
  floss: ['loop_pole', 'Tie a floss loop'],
  practice: ['lizard', 'A practice catch'],
};
const SETUP_STEP = { kit: ['hunt', 'ibis'], station: ['station'], floss: ['floss'], practice: ['practice'] };
const KIT_ICONS = [['loop_pole', 'loop_pole'], ['notebook', 'book'], ['bags', 'bag'], ['scales', 'ruler'], ['pens', 'paint']];
const SETUP_FALLBACK = [
  { id: 'setup.kit', goal: 5 }, { id: 'setup.station', goal: 1 }, { id: 'setup.floss', goal: 1 }, { id: 'setup.practice', goal: 1 },
];

// Short names for the research tasks on the Today card (the notebook has the full ones).
const TASK_SHORT = {
  'crested.catch': 'Catch 5 crested anoles', 'crested.dewlap': 'A crested mid dewlap', 'crested.tag': 'Backpacks on 3 crested',
  'brown.ground': '3 brown on the ground', 'brown.tag': 'A backpack on a brown',
  'green.leaves': 'A green on the leaves', 'green.catch': 'Catch a green anole',
  'bark.spot': 'Spot a bark anole', 'bark.catch': 'Catch 3 bark anoles',
  'knight.canopy': 'A knight up in the canopy', 'knight.tag': 'A backpack on a knight',
  'basilisk.catch': 'Catch a basilisk', 'basilisk.water': 'A basilisk on the water',
  'croc.spot': 'Spot the crocodile', 'field.display': 'A catch mid display', 'field.creep': '3 catches unnoticed',
  'field.tape': 'Tape 3 perch heights', 'field.gps': 'Download a GPS track',
};

// Short names for the field kit's jobs on the Today card (src/missions; the request's
// own label is the long one).
const KIT_SHORT = { drone: 'Drone survey', tls: 'Laser scans', rtk: 'Plant survey' };

// The sun's word on the Today card, by the lizards' thermal phase: where to look now.
// Once a fresh logger patch of the colour that matters shows on the map, the row points at
// the map's colours instead (the fourth word).
const SUN_UI = {
  morning: ['is-cool', 'Cool morning:', 'look in the sun', 'orange patches'],
  midday: ['is-hot', 'Midday heat:', 'look in the shade', 'blue patches'],
  afternoon: ['is-cool', 'Cooling off:', 'look in the sun', 'orange patches'],
};

// is a fresh patch of the colour that matters in this phase on the map? (no allocation)
function freshPatchFor(L, ph) {
  if (!L || !L.patches || !L.freshness || !ph) return false;
  const want = ph === 'midday' ? 'cool' : 'warm';
  for (let i = 0; i < L.patches.length; i++) {
    const p = L.patches[i];
    if (p.kind === want && L.freshness(p) >= 0.5) return true;
  }
  return false;
}

// n / goal as little pips (a count for big goals)
function pips(n, goal) {
  if (goal > 6) return `<em>${n}/${goal}</em>`;
  let s = '<i class="hud-pips">';
  for (let k = 0; k < goal; k++) s += `<b class="${k < n ? 'on' : ''}"></b>`;
  return s + '</i>';
}

export function buildHud(game, { ring, maps, notebook, tasks }) {
  const el = document.createElement('div');
  el.className = 'hud ui-hidden';
  el.innerHTML =
    '<div class="hud-status">' +
      `<div class="hud-clock ui-panel">${dialSvg()}<div class="hud-time"><b>07:30</b><small>Survey day</small></div></div>` +
      `<div class="hud-score ui-panel">${icon('leaf')}<b>0</b></div>` +
      `<div class="hud-steady ui-panel ui-hidden" title="Precise aiming since the day began: this day can go on the Steady hands board">${icon('hand')}<span>Steady hands</span></div>` +
    '</div>' +
    '<div class="hud-jobs ui-panel ui-hidden"></div>' +
    '<div class="hud-tool ui-panel"><div class="hud-tool-badge"></div><div class="hud-tool-text"><b></b><small></small></div><span class="hud-tool-count ui-hidden"></span></div>' +
    '<div class="hud-keys">' +
      `<button type="button" class="hud-key" data-k="notebook" title="Field notebook (N)">${icon('book')}<kbd>N</kbd></button>` +
      `<button type="button" class="hud-key" data-k="map" title="Map (M)">${icon('map')}<kbd>M</kbd></button>` +
      `<button type="button" class="hud-key" data-k="pause" title="Pause (Esc)">${icon('pause')}<kbd>Esc</kbd></button>` +
    '</div>';
  if (maps) el.appendChild(maps.el);

  const q = (s) => el.querySelector(s);
  const clock = q('.hud-clock'), timeB = q('.hud-time b'), timeS = q('.hud-time small');
  const sun = q('.dial-sun'), done = q('.dial-done');
  const score = q('.hud-score'), scoreB = q('.hud-score b');
  const steady = q('.hud-steady');
  const tool = q('.hud-tool'), toolBadge = q('.hud-tool-badge'), toolName = q('.hud-tool-text b'), toolSub = q('.hud-tool-text small'), toolCount = q('.hud-tool-count');
  const keys = q('.hud-keys');
  const jobs = q('.hud-jobs');

  keys.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    const k = b.dataset.k;
    if (k === 'notebook') openPanel('notebook');
    else if (k === 'map') openPanel('map');
    else if (k === 'pause') openPanel('pause');
  });

  const shown = { minute: -1, phase: '', score: -1, tool: '', count: -1, late: false, fresh: false, steady: false };
  const bookKey = keys.querySelector('[data-k="notebook"]');
  let freshT = 0;
  let toolId = null;

  function setTool(id) {
    toolId = id || 'none';
    const t = (ring && ring.getTool && toolId !== 'none' && ring.getTool(toolId)) || null;
    const ui = TOOL_UI[toolId] || { name: toolId, icon: 'hand' };
    toolBadge.innerHTML = icon(ui.icon || (t && t.icon) || 'hand');
    toolName.textContent = (t && t.name) || ui.name;
    // (in the opening, until the loop pole is found, there is nothing to hold)
    const S = state.setup;
    const noPole = !!(S && !S.done && !(Array.isArray(S.kit) && S.kit.includes('loop_pole')) && (state.phase === 'setup' || state.phase === 'intro'));
    // (on the survey day, a broken pole until James hands over another: src/catch/breaks.js)
    const B = game.catching && game.catching.breaks, broken = !!(B && B.noPole && !B.onTheWay);
    // (a snapped floss loop, until it is re-tied)
    const snapped = !!(B && B.snapped && !B.noPole && state.phase === 'survey');
    tool.classList.toggle('is-snapped', snapped);
    toolSub.innerHTML = snapped ? escapeHtml(SCRIPT.breaks.toolSnapped) : toolId !== 'none' ? 'Hold <kbd>Q</kbd> tools · <kbd>X</kbd> put away' : noPole ? 'Find your loop pole'
      : broken ? escapeHtml(SCRIPT.breaks.toolLine) : 'Hold <kbd>Q</kbd> for tools';
    tool.classList.remove('is-new');
    void tool.offsetWidth;
    tool.classList.add('is-new');
    shown.count = -1;
  }
  game.events.on('tool:equip', (e) => setTool(e && typeof e === 'object' ? e.id : e));
  game.events.on('hud:tool', () => setTool(toolId));
  game.events.on('phase:change', () => { if (toolId === 'none') setTool(null); });
  const cur = ring && ring.current ? ring.current() : null;
  setTool(cur && typeof cur === 'object' ? cur.id : cur);

  // score pills: "+25 Creep bonus", staggered when several land at once
  let lastPill = 0;
  game.events.on('score:add', (e) => {
    if (!e || !e.points) return;
    const pill = document.createElement('div');
    pill.className = 'hud-plus';
    const why = REASONS[e.reason] || (e.reason ? String(e.reason) : '');
    pill.innerHTML = `${e.points > 0 ? '+' : ''}${e.points}${why ? ' <span style="font-weight:700">' + escapeHtml(why) + '</span>' : ''}`;
    // a loss (the croc's -50) stays up long enough to read (3.4 s against 1.6 s)
    const loss = e.points < 0;
    if (loss) pill.classList.add('is-loss');
    const nowMs = performance.now();
    const delay = Math.max(0, lastPill + 380 - nowMs);
    lastPill = nowMs + delay;
    pill.style.animationDelay = delay + 'ms';
    pill.style.opacity = '0';
    score.appendChild(pill);
    setTimeout(() => {
      score.classList.remove('is-bump');
      void score.offsetWidth;
      score.classList.add('is-bump');
    }, delay);
    setTimeout(() => pill.remove(), delay + (loss ? 3500 : 1700));
  });

  // the croc's snap: a comic toast and the time it cost under the clock
  game.events.on('croc:snap', (e) => {
    if (state.phase !== 'survey') return;
    const pen = (e && e.penalty) || {};
    const secs = Math.round(Number(pen.seconds) || 20), pts = Math.abs(Math.round(Number(pen.points) || 50));
    toast(`*SNAP!* Too close to the croc! -${pts} points, ${secs} s lost`, { icon: 'croc', tone: 'snap', ms: 3600 });
    const pill = document.createElement('div');
    pill.className = 'hud-plus is-loss';
    pill.textContent = `-${secs} s`;
    clock.appendChild(pill);
    setTimeout(() => pill.remove(), 3500);
  });

  // The card under the clock. The opening: the checklist (ticks, counts and the job
  // James is on now). Survey day: "Today". Rebuilt only when what it shows changes;
  // it tucks away to its title while the loop pole is up or a catch is on.
  const TASKS = (tasks && tasks.TASKS) || [];
  let cardKey = '', cardT = 0, todayPage = null, sunWas = '';
  const refreshCard = () => { cardT = 0; };
  for (const ev of ['task:progress', 'task:done', 'request:progress', 'request:done', 'logger:read', 'lizard:tagged', 'day:new']) game.events.on(ev, refreshCard);
  game.events.on('day:new', () => { sunWas = ''; }); // a new morning is not a turn

  function setupRows() {
    const S = state.setup || {};
    const list = TASKS.length ? TASKS.filter((t) => t.group === 'setup' && !t.optional) : SETUP_FALLBACK;
    const step = game.story && game.story.step;
    return list.map((t) => {
      const key = t.id.slice(6);
      const [ic, label] = SETUP_UI[key] || ['check', t.label || key];
      const total = t.goal || 1;
      const rec = state.tasks && state.tasks[t.id];
      const v = S[key];
      let n = Array.isArray(v) ? v.length : rec ? Number(rec.n) || 0 : typeof v === 'boolean' ? (v ? total : 0) : Number(v) || 0;
      if (rec && rec.done) n = total;
      n = Math.min(total, total === 1 && n > 0 ? 1 : n);
      return { key, ic, label, n, total, done: n >= total, now: (SETUP_STEP[key] || [key]).includes(step), have: Array.isArray(v) ? v : null };
    });
  }

  // the open research tasks nearest done: the best, then the best of another species
  function nearTasks(max) {
    const open = [];
    for (const t of TASKS) {
      if ((t.group !== 'species' && t.group !== 'field') || t.optional || t.id === 'field.loggers') continue;
      const r = state.tasks && state.tasks[t.id];
      if (r && r.done) continue;
      open.push({ t, n: Math.min(t.goal, (r && Number(r.n)) || 0) });
    }
    open.sort((a, b) => b.n / b.t.goal - a.n / a.t.goal); // stable: ties keep the tasks' order
    const out = [];
    for (const o of open) {
      if (out.length >= max) break;
      if (out.length && out.some((p) => p.t.species && p.t.species === o.t.species)) continue;
      out.push(o);
    }
    return out;
  }

  function updateCard(dt) {
    cardT -= dt;
    if (cardT > 0) return;
    cardT = 0.25;
    const phase = state.phase;
    const S = state.setup || {};
    let key = 'off', html = '';
    todayPage = null;
    if (phase === 'setup' && !S.done) {
      const rows = setupRows();
      key = 's' + rows.map((r) => `${r.n}${r.now ? '*' : ''}${r.have ? r.have.join('') : ''}`).join(',');
      if (key !== cardKey) {
        html = '<div class="hud-jobs-title">Getting set up</div>' + rows.map((r) =>
          `<div class="hud-job${r.done ? ' is-done' : ''}${r.now ? ' is-now' : ''}"><span class="hud-job-tick">${r.done ? icon('check') : icon(r.ic)}</span>` +
          `<span>${escapeHtml(r.label)}</span>${r.total > 1 ? `<em>${r.n}/${r.total}</em>` : ''}</div>` +
          (r.have && !r.done ? `<div class="hud-kit-row">${KIT_ICONS.map(([id, ic]) => `<i class="${r.have.includes(id) ? 'is-on' : ''}">${icon(ic)}</i>`).join('')}</div>` : '')).join('');
      }
    } else if (phase === 'survey') {
      const C = game.catching;
      const tucked = !!(C && ((C.loopPole && C.loopPole.aiming) || C.busy));
      const packs = state.inventory ? state.inventory.backpacks : 0;
      const L = game.tools && game.tools.loggers;
      let due = 0;
      if (L && L.due) for (const l of state.loggers || []) { try { if (L.due(l)) due++; } catch (e) { /* not ready */ } }
      const reqs = (state.today && state.today.requests) || [];
      const near = nearTasks(reqs.length ? 1 : 2);
      todayPage = near.length && near[0].t.species ? near[0].t.species : null;
      // the sun's phase as the story tells it (held steady at the turn), else the lizards'
      const Lz = game.lizards;
      const sunPh = (game.story && game.story.sunPhase) || (Lz && Lz.thermalPhase ? Lz.thermalPhase() : '');
      const onMap = freshPatchFor(L, sunPh);
      key = `t${tucked ? 1 : 0}|${packs}|${due}|${sunPh}${onMap ? '+' : ''}|${reqs.map((r) => `${r.id}${r.n}${r.done ? '!' : ''}`).join(',')}|${near.map((o) => o.t.id + o.n).join(',')}`;
      if (key !== cardKey) {
        const reqDone = reqs.filter((r) => r.done).length;
        const sunUi = SUN_UI[sunPh];
        // the row glows once when the heat comes or goes
        const turned = sunUi && sunWas && sunWas !== sunPh;
        if (sunPh) sunWas = sunPh;
        html = `<div class="hud-jobs-title">Today${tucked && reqs.length ? ` <small>${reqDone}/${reqs.length} for James</small>` : ''}<kbd>N</kbd></div>` +
          '<div class="hud-today-kit">' +
            `<span class="${packs ? '' : 'is-done'}" title="GPS backpacks left">${icon('backpack')}${packs ? `${packs} left` : 'all out'}</span>` +
            `<span class="${due ? 'is-due' : 'is-done'}" title="Loggers due a download: walk up to one">${icon('logger')}${due ? `${due} to download` : 'all downloaded'}</span>` +
          '</div>' +
          (sunUi ? `<div class="hud-today-sun ${sunUi[0]}${turned ? ' is-new' : ''}" title="Lizards bask in the sun while it is cool and sit out the heat in the shade">` +
            `${icon('sun')}<b>${sunUi[1]}</b> ${onMap ? sunUi[3] : sunUi[2]}</div>` : '') +
          (reqs.length ? '<div class="hud-today-sub">James asks</div>' : '') +
          // a field-kit job (src/missions) shows its tool rather than James's face, and opens its notebook page
          reqs.map((r) =>
            `<div class="hud-job is-req${r.done ? ' is-done' : ''}${r.mission ? ' is-kit' : ''}"${r.mission ? ` data-go="kit:${escapeHtml(r.mission)}"` : ''}><span class="hud-job-tick${r.done ? '' : r.mission ? ' is-kit' : ' is-james'}">${r.done ? icon('check') : r.mission ? icon(r.icon || r.mission) : jamesPortrait()}</span>` +
            `<span>${escapeHtml(r.mission ? KIT_SHORT[r.mission] || r.label : r.label)}</span>${pips(Math.min(r.n || 0, r.goal), r.goal)}</div>`).join('') +
          (near.length ? '<div class="hud-today-sub">Research</div>' : '') +
          near.map((o) =>
            `<div class="hud-job is-task" data-go="${escapeHtml(o.t.species || '')}"><span class="hud-job-tick">${icon(o.t.species === 'croc' ? 'eye' : o.t.group === 'field' ? 'star' : 'lizard')}</span>` +
            `<span>${escapeHtml(TASK_SHORT[o.t.id] || o.t.label)}</span>${pips(o.n, o.t.goal)}</div>`).join('');
        jobs.classList.toggle('is-tucked', tucked);
        jobs.classList.add('is-today');
      }
    }
    if (key === cardKey) return;
    cardKey = key;
    if (key === 'off') { jobs.classList.add('ui-hidden'); return; }
    if (!key.startsWith('t')) jobs.classList.remove('is-today', 'is-tucked');
    jobs.innerHTML = html;
    jobs.classList.remove('ui-hidden');
  }
  // a task on the Today card opens its species page
  jobs.addEventListener('click', (e) => {
    const row = e.target.closest('[data-go]');
    if (row && row.dataset.go) openPanel('notebook', row.dataset.go);
    else if (jobs.classList.contains('is-today')) openPanel('notebook');
  });

  function update(dt) {
    const phase = state.phase;
    if (phase !== shown.phase) {
      shown.phase = phase;
      const on = phase === 'setup' || phase === 'survey';
      el.classList.toggle('ui-hidden', !on);
      timeS.textContent = phase === 'setup' ? 'Getting ready' : 'Survey day';
      shown.minute = -1;
    }
    if (el.classList.contains('ui-hidden')) return;
    updateCard(dt);
    const hrs = state.clock.hours;
    const minute = Math.floor(hrs * 60);
    if (minute !== shown.minute) {
      shown.minute = minute;
      timeB.textContent = clockText(hrs);
      const D = RULES.day;
      const f = Math.min(1, Math.max(0, (hrs - D.start) / (D.end - D.start)));
      const a = Math.PI - f * Math.PI;
      sun.setAttribute('cx', (31 + Math.cos(a) * 24).toFixed(1));
      sun.setAttribute('cy', (30 - Math.sin(a) * 24).toFixed(1));
      done.setAttribute('stroke-dasharray', `${(f * 100).toFixed(1)} 100`);
      const late = phase === 'survey' && D.end - hrs <= 1;
      if (late !== shown.late) {
        shown.late = late;
        clock.classList.toggle('is-late', late);
        sun.setAttribute('fill', late ? '#ff8a5c' : '#ffc93a');
      }
    }
    if (state.score !== shown.score) {
      shown.score = state.score;
      scoreB.textContent = state.score.toLocaleString('en-GB');
    }
    // the Steady hands badge: a survey day still played with Precise aiming from its start
    const st = phase === 'survey' && !!(state.today && state.today.steady) && boardUp();
    if (st !== shown.steady) {
      shown.steady = st;
      steady.classList.toggle('ui-hidden', !st);
    }
    // a gold dot on the notebook key when a page has news
    freshT -= dt;
    if (notebook && freshT <= 0) {
      freshT = 0.5;
      const f = notebook.hasNews();
      if (f !== shown.fresh) { shown.fresh = f; bookKey.classList.toggle('has-news', f); }
    }
    const ui = TOOL_UI[toolId];
    const n = ui && ui.count ? state.inventory[ui.count] ?? 0 : -2;
    if (n !== shown.count) {
      shown.count = n;
      toolCount.classList.toggle('ui-hidden', n < 0);
      if (n >= 0) toolCount.textContent = n + ' left';
    }
  }

  // the species page of the task on the Today card, for N (null when none)
  return { el, update, setTool, tool: () => toolId, todayPage: () => (state.phase === 'survey' ? todayPage : null) };
}

// The pause card: resume, the notebook, the map, the settings, the controls and back
// to the title. The settings and the controls open in a column on the right.
export function registerPause(game, { onTitle, onReset }) {
  let confirm = false;
  return {
    title: 'Paused', icon: 'pause', card: 'ui-pause',
    render(card, arg, api) {
      confirm = false;
      game.events.emit('pause:open');
      const body = document.createElement('div');
      body.className = 'ui-pause-body';
      body.innerHTML =
        '<div class="ui-card-sub">The island waits for you.</div>' +
        '<div class="ui-pause-cols"><div class="ui-pause-list">' +
          `<button type="button" class="ui-btn" data-a="resume">${icon('leaf')}Back to the field</button>` +
          `<button type="button" class="ui-btn is-soft" data-a="notebook">${icon('book')}Field notebook</button>` +
          `<button type="button" class="ui-btn is-soft" data-a="map">${icon('map')}Map of the island</button>` +
          `<button type="button" class="ui-btn is-soft" data-a="settings" aria-expanded="false">${icon('gear')}Settings</button>` +
          `<button type="button" class="ui-btn is-soft" data-a="help" aria-expanded="false">${icon('help')}How to play</button>` +
          `<button type="button" class="ui-btn is-soft" data-a="title">${icon('home')}Back to the title</button>` +
        '</div>' +
        `<div class="ui-help ui-pause-side ui-hidden">${controlsHtml()}</div>` +
        `<div class="ui-pause-set ui-pause-side ui-hidden">${settingsHtml()}</div></div>`;
      card.appendChild(body);
      const help = body.querySelector('.ui-help'), set = body.querySelector('.ui-pause-set');
      const titleBtn = body.querySelector('[data-a="title"]');
      bindSettings(set, game, { onReset: () => { api.close(); onReset && onReset(); } });
      // one side column at a time: the settings or the controls
      const side = (which) => {
        const showHelp = which === 'help' && help.classList.contains('ui-hidden');
        const showSet = which === 'settings' && set.classList.contains('ui-hidden');
        help.classList.toggle('ui-hidden', !showHelp);
        set.classList.toggle('ui-hidden', !showSet);
        body.querySelector('[data-a="help"]').setAttribute('aria-expanded', String(showHelp));
        body.querySelector('[data-a="settings"]').setAttribute('aria-expanded', String(showSet));
        card.classList.toggle('is-help', showHelp || showSet);
        card.classList.toggle('is-settings', showSet);
      };
      body.querySelector('.ui-pause-list').addEventListener('click', (e) => {
        const b = e.target.closest('[data-a]');
        if (!b) return;
        const a = b.dataset.a;
        if (a === 'resume') api.close();
        else if (a === 'notebook') { api.close(); openPanel('notebook'); }
        else if (a === 'map') { api.close(); openPanel('map'); }
        else if (a === 'help' || a === 'settings') side(a);
        else if (a === 'title') {
          if (!confirm) {
            confirm = true;
            titleBtn.classList.remove('is-soft');
            titleBtn.classList.add('is-coral');
            titleBtn.innerHTML = icon('home') + 'Sure? Your notebook is saved';
            return;
          }
          api.close();
          onTitle && onTitle();
        }
      });
      if (arg === 'settings') side('settings');
      setTimeout(() => body.querySelector('.ui-btn')?.focus(), 30);
      return () => game.events.emit('pause:close');
    },
  };
}

export function controlsHtml() {
  const row = (keys, what) => `<dt>${keys}</dt><dd>${what}</dd>`;
  return '<dl class="ui-controls">' +
    row('<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>', 'Walk (or the arrow keys)') +
    row('hold <kbd>Shift</kbd>', 'Run') +
    row('hold <kbd>Ctrl</kbd>', 'Creep up quietly') +
    row('drag, scroll', 'Look round, zoom') +
    row('right mouse or <kbd>F</kbd>', 'Aim: the loop finds the lizard in reach') +
    row('<kbd>Tab</kbd>, scroll or flick', 'While aiming: the next lizard') +
    row('<kbd>E</kbd> or click', 'Use, talk, loop it') +
    row('hold <kbd>Q</kbd>', 'Tool ring (<kbd>1</kbd> to <kbd>6</kbd> pick, <kbd>X</kbd> put away)') +
    row('<kbd>N</kbd> or <kbd>Tab</kbd>', 'Field notebook') +
    row('<kbd>M</kbd>', 'Map') +
    row('<kbd>Esc</kbd> or <kbd>P</kbd>', 'Pause') +
    '</dl>';
}
