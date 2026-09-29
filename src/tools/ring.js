// The tool ring (hold Q, let go on a tool), and the one place that decides what [E]
// does next to a job.
//
//   registerTool({ id, name, icon, key, pose, onEquip, onStow, update(dt, t), suggestFor(ctx), use(ctx), phrase })
//       phrase: how the hint names it mid-sentence ("Take out the GPS case"), else the
//       name in lower case; key: the quick-select number (1 to 6); pose: 'pole', 'hold' or 'free' (the
//       avatar's right arm); suggestFor(ctx) -> null or { score, prompt, run }: a job
//       this tool can do here. prompt shows as the hint when the tool is in hand and
//       run() is what [E] does; otherwise the hint suggests the tool's key.
//   registerInteraction({ id, check(ctx) -> null | { score, prompt, run } })
//       a job that needs no tool (talking to James, reading a logger)
//   equip(id | null), current(), getTool(id), listTools()
//   setToolFilter(fn | null)  only the tools fn(id) keeps are in the ring and can be
//       taken out (the opening: nothing until the loop pole is found); null for all
//
// Hold [Q] for the ring (point at a tool, or steer with WASD, and let go), [1] to
// [6] pick a tool at once, [X] puts it away. Empty hands are slot 6. ctx is one
// reused object: { game, player, state, tool, dt, t }. Later tools (the drone
// controller, the TLS scanner, the GNSS pole) only need a registerTool call; a tool
// the avatar has no model for is held in an open hand.

import * as THREE from 'three';
import { events } from '../core/events.js';
import { recordError } from '../debug.js';
import { state } from '../game/state.js';
import * as kit from '../ui/kit.js';
import { icon, escapeHtml } from '../ui/icons.js';
import { ensureStoryStyle } from '../story/style.js';
import { FLAGS } from '../config.js';

// The field tools this ring builds (each exports build(game) -> { group?, update?, stats? }
// and calls registerTool). The loop pole registers itself from src/catch/catching.js. A new
// tool is a new file here plus one line in this list.
const TOOL_MODULES = [
  ['flags', './flags.js'],
  ['loggers', './loggers.js'],
  ['backpacks', './backpacks.js'],
  ['tape', './tape.js'],
  ['perch', './perch_loggers.js'], // the perch loggers clipped at release (no tool of its own)
];

const tools = new Map();
const interactions = new Map();
let keep = null; // setToolFilter's test, or null for every tool
const allowed = (t) => !keep || keep(t.id);
const HANDS = { id: null, name: 'Empty hands', icon: 'hand', key: 6, pose: 'free' };
let game = null;
let cur = 'loop_pole';
let ring = null; // the open ring, or null
let listEl = null;
const ctx = { game: null, player: null, state, tool: null, dt: 0, t: 0 };
const PLAY_PHASES = new Set(['setup', 'survey']);
const SLOT_ACTIONS = ['tool1', 'tool2', 'tool3', 'tool4', 'tool5', 'tool6'];

export function registerTool(spec) {
  if (!spec || !spec.id) throw new Error('registerTool needs an id');
  const tool = {
    name: spec.id, icon: spec.id, key: null, pose: 'hold', order: 50,
    ...spec,
  };
  tools.set(tool.id, tool);
  if (ring) buildRing();
  if (game && tool.id === cur) { applyAvatar(true); if (tool.onEquip) tool.onEquip(game); }
  return tool;
}

export function registerInteraction(spec) {
  if (!spec || !spec.id || typeof spec.check !== 'function') throw new Error('registerInteraction needs id and check');
  interactions.set(spec.id, spec);
  return () => interactions.delete(spec.id);
}

export const current = () => cur;
export const getTool = (id) => (id == null ? HANDS : tools.get(id) || null);
export function listTools() {
  return [...tools.values(), HANDS].filter((t) => t === HANDS || allowed(t)).sort((a, b) => (a.key ?? a.order) - (b.key ?? b.order));
}
// Only the tools keep(id) likes are in the ring (null: all of them). A tool in hand that
// is left out is put away.
export function setToolFilter(fn) {
  keep = typeof fn === 'function' ? fn : null;
  if (cur != null && tools.has(cur) && !allowed(tools.get(cur))) equip(null, { silent: true, instant: true });
  if (ring) buildRing();
}

function applyAvatar(instant = false) {
  const av = game && game.player && game.player.avatar;
  if (!av || !av.setTool) return;
  const t = getTool(cur);
  av.setTool(cur, { instant, pose: t ? t.pose : 'free' });
}

// Equip a tool by id, or null for empty hands. Returns true when it changed.
export function equip(id, { silent = false, instant = false } = {}) {
  if (id === 'none' || id === 'hands' || id === '') id = null;
  if (id != null && (!tools.has(id) || !allowed(tools.get(id)))) return false;
  if (id === cur) return false;
  const prev = getTool(cur);
  if (game && prev && prev.onStow) prev.onStow(game);
  cur = id;
  const next = getTool(cur);
  applyAvatar(instant);
  if (game && next && next.onEquip) next.onEquip(game);
  events.emit('tool:equip', { id: cur, tool: next, previous: prev ? prev.id : null, silent });
  return true;
}

// ---------------------------------------------------------------- the ring overlay

function buildRing() {
  if (!listEl) return;
  const list = listTools();
  listEl.innerHTML = '';
  const n = list.length;
  list.forEach((t, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tr-slot' + (t.id === cur ? ' is-current' : '');
    b.style.setProperty('--x', (Math.cos(a) * 7.2).toFixed(2) + 'em');
    b.style.setProperty('--y', (Math.sin(a) * 7.2).toFixed(2) + 'em');
    b.style.animationDelay = (i * 0.03) + 's';
    b.innerHTML = `${icon(t.icon)}<kbd>${t.key ?? ''}</kbd>`;
    b.addEventListener('pointerenter', () => select(i));
    b.addEventListener('click', (e) => { e.stopPropagation(); select(i); closeRing(true); });
    listEl.appendChild(b);
  });
  ring.list = list;
  ring.angles = list.map((_, i) => -Math.PI / 2 + (i / n) * Math.PI * 2);
  select(Math.max(0, list.findIndex((t) => t.id === cur)));
}

function select(i) {
  if (!ring) return;
  ring.sel = i;
  const slots = listEl.children;
  for (let k = 0; k < slots.length; k++) slots[k].classList.toggle('is-on', k === i);
  const t = ring.list[i];
  ring.name.innerHTML = t ? `<b>${escapeHtml(t.name)}</b>${countText(t)}` : '';
}

function countText(t) {
  const inv = state.inventory;
  const n = t.id === 'flags' ? inv.flags : t.id === 'loggers' ? inv.loggers : t.id === 'backpacks' ? inv.backpacks : null;
  return n == null ? '' : `<small>${n} in the bag</small>`;
}

function openRing() {
  ensureStoryStyle();
  const root = document.createElement('div');
  root.className = 'tr-ring';
  root.innerHTML = '<div class="tr-disc"><div class="tr-list"></div><div class="tr-centre"><div class="tr-name"></div><div class="tr-help">Let go of <kbd>Q</kbd></div></div></div>';
  (document.getElementById('ui') || document.body).appendChild(root);
  listEl = root.querySelector('.tr-list');
  ring = { root, name: root.querySelector('.tr-name'), sel: 0, list: [], angles: [] };
  game.player.hold('ring', true);
  root.addEventListener('pointermove', (e) => {
    const r = root.querySelector('.tr-disc').getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) > r.width * 0.16) select(nearestSlot(Math.atan2(dy, dx)));
  });
  buildRing();
  events.emit('ring:open');
}

function nearestSlot(a) {
  let best = 0, bd = Infinity;
  ring.angles.forEach((b, i) => {
    let d = Math.abs(a - b) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

function closeRing(apply) {
  if (!ring) return;
  const t = ring.list[ring.sel];
  game.player.hold('ring', false); // only the ring's own hold: a day ending meanwhile keeps its
  ring.root.classList.add('is-out');
  const el = ring.root;
  setTimeout(() => el.remove(), 180);
  ring = null;
  listEl = null;
  if (apply && t) equip(t.id);
  events.emit('ring:close');
}

// ---------------------------------------------------------------- the system

// not during a talk, a card, a cutscene or a catch (the snug is in-world, not a kit card)
const canPlay = () => PLAY_PHASES.has(state.phase) && !kit.busy() && !(game && game.story && game.story.cutscene) &&
  !(game && game.catching && game.catching.busy);

export async function build(g) {
  game = g;
  ctx.game = g;
  ctx.player = g.player;
  ensureStoryStyle();
  applyAvatar(true);

  // the tools' own systems: world objects, mini-games, registrations
  const group = new THREE.Group();
  group.name = 'field-tools';
  const topView = FLAGS.view === 'top'; // the layout figure shows no stakes, flags or loggers
  if (topView) group.visible = false;
  const systems = {};
  for (const [name, path] of TOOL_MODULES) {
    try {
      const mod = await import(path);
      const sys = await mod.build(g);
      if (!sys) continue;
      systems[name] = sys;
      if (sys.group) group.add(sys.group);
    } catch (e) {
      recordError(e, 'tool ' + name);
    }
  }
  const sysList = Object.values(systems).filter((s) => typeof s.update === 'function');
  let hintMine = null;
  let best = null;
  let checkT = 0;

  // Ten times a second: the best job nearby, and its hint (built here, not every frame).
  let bestText = null, bs = -Infinity;
  const offer = (o, tool) => {
    if (!o || !(o.score > bs)) return;
    bs = o.score;
    best = o;
    best.tool = tool;
  };
  const pickBest = () => {
    best = null;
    bs = -Infinity;
    for (const t of tools.values()) {
      if (!t.suggestFor || !allowed(t)) continue;
      try { offer(t.suggestFor(ctx), t); } catch (e) { console.error(e); }
    }
    for (const it of interactions.values()) {
      try { offer(it.check(ctx), null); } catch (e) { console.error(e); }
    }
    if (!best) { bestText = null; return; }
    const own = !best.tool || best.tool.id === cur;
    bestText = own ? best.prompt || null
      : `[${best.tool.key}] Take out the ${best.tool.phrase || best.tool.name.toLowerCase()}` + (best.why ? ` ${best.why}` : '');
  };

  const setHint = (text) => {
    if (text === hintMine) return;
    if (text == null && kit.currentHint() !== hintMine) { hintMine = null; return; } // someone else's hint now
    hintMine = text;
    kit.hint(text);
  };

  function update(dt, t) {
    ctx.dt = dt; ctx.t = t; ctx.tool = cur;
    for (let i = 0; i < sysList.length; i++) sysList[i].update(dt, t);
    const inp = g.input;
    const tool = getTool(cur);
    if (tool && tool.update) tool.update(dt, t, ctx);

    if (!canPlay()) {
      if (ring) closeRing(false);
      setHint(null);
      best = null;
      return;
    }

    // the ring: hold Q
    if (ring) {
      const mx = inp.move.x, my = inp.move.y;
      if (mx * mx + my * my > 0.25) select(nearestSlot(Math.atan2(-my, mx)));
      for (let k = 1; k <= 6; k++) {
        if (inp.pressed(SLOT_ACTIONS[k - 1])) {
          const i = ring.list.findIndex((x) => x.key === k);
          if (i >= 0) { select(i); closeRing(true); return; }
        }
      }
      if (!inp.down('tool')) closeRing(true);
      return;
    }
    if (inp.pressed('tool') && !g.player.held && !inp.down('aim')) { openRing(); setHint(null); return; }
    for (let k = 1; k <= 6; k++) {
      if (!inp.pressed(SLOT_ACTIONS[k - 1])) continue;
      const pick = listTools().find((x) => x.key === k);
      if (pick) equip(pick.id);
    }
    if (inp.pressed('stow')) equip(null);

    // what [E] does here: the best job nearby
    checkT -= dt;
    if (checkT <= 0) { checkT = 0.1; pickBest(); }
    if (!best || g.player.held) { setHint(null); return; }
    const own = !best.tool || best.tool.id === cur;
    setHint(bestText);
    if (inp.pressed('use') && !inp.down('aim')) {
      if (own) {
        const run = best.run;
        best = null;
        checkT = 0.25;
        setHint(null);
        if (run) run();
      } else {
        equip(best.tool.id);
        checkT = 0;
      }
    }
  }

  return {
    group,
    update,
    systems,
    flags: systems.flags || null,
    loggers: systems.loggers || null,
    perch: systems.perch || null,
    equip, current, registerTool, registerInteraction, listTools, setToolFilter,
    get open() { return !!ring; },
    get stats() {
      const out = { tools: tools.size, current: cur, drawCalls: 0 };
      for (const [k, s] of Object.entries(systems)) {
        if (!s.stats) continue;
        out[k] = s.stats;
        if (!topView) out.drawCalls += s.stats.drawCalls || 0;
      }
      return out;
    },
  };
}
