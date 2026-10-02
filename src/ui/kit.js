// The UI kit: dialogue, toasts, hints, stamps, panels and mini-game cards, drawn as
// a DOM overlay in #ui. Game code only calls these functions, so a VR build can
// replace this file with in-world panels that keep the same calls.
//
//   dialogue({ speaker, lines, choices, input, portrait }) -> Promise
//       typewriter text, advanced with a click, E, Enter or Space. "{name}" in a line
//       becomes the player's name (vars.name). choices: strings or { label, value,
//       swatch, icon }; resolves with the value (or the string), and onFocus(value) is
//       called as the choice under the pointer or the arrow keys changes (a live preview).
//       defaultChoice: the index focused at first, which a key press may confirm without
//       choosing (a safe default, like James's "Just a chat"); otherwise a key confirms only
//       a choice the player has moved to. plainChoices: every choice drawn alike (soft,
//       the focus ring showing which one a key takes), not one solid main button.
//       Choices that all carry a swatch show as a palette; preview: 'hat' | 'shirt' adds
//       the player's badge beside them, recoloured as the choice changes.
//       input: { placeholder, maxLength, value } resolves with the typed text.
//       onLine(i) is called as each line starts (the story moves its camera with it).
//       Otherwise resolves true.
//   toast(text, { icon, tone, portrait })  tone good | gold | warn | info | snap; [Key] marks
//                                   become key caps; portrait ('james', 'jon') in place of the icon
//   hint(text | null)               the pill at the bottom of the screen (cheap to call every frame)
//   stamp(label, { tone, icon })    an ink stamp slammed onto the screen
//   registerPanel(id, spec), openPanel(id, arg) -> Promise, closePanel(value), currentPanel()
//   minigame({ name, title, instructions, icon, mount, timeLimit, cancellable }) -> Promise<{ success, quality }>
//       mount(stageEl, api) returns a controller { update(dt, t), onUse(), destroy(), timeout() }
//       (all optional) and calls api.done({ success, quality }) when it is over; a mount
//       that returns a Promise finishes with its result instead.
//   registerMinigame(name, (arg) => spec), openMinigame(name, arg)
//   busy()                          true while a dialogue, panel or mini-game is open
//   attach(game), pump(dt, t)       ui.js wires the game in and pumps the kit every frame
//
// While anything modal is open the player is held (player.frozen) and the croc hazard
// is off; both go back to what they were when the last one closes. Events on
// game.events: dialogue:open, dialogue:close, minigame:start, minigame:end { name,
// success, quality }, panel:open { id }, panel:close { id }.

import { events } from '../core/events.js';
import { icon, iconBody, escapeHtml, richText } from './icons.js';
import { jamesPortrait, jonPortrait, playerBadge } from './drawings.js';

export const vars = { name: '', looks: null };
// The settings the kit follows (ui/settings.js sets them): how fast James's lines type
// out, in characters a second, and reduced motion (no wobbling toasts).
export const options = { typeRate: 55, reducedMotion: false };

let game = null;
export function attach(g) { game = g; }

const layers = {};
function layer(name, cls) {
  if (layers[name] && layers[name].isConnected) return layers[name];
  const el = document.createElement('div');
  el.className = cls;
  (document.getElementById('ui') || document.body).appendChild(el);
  layers[name] = el;
  return el;
}

// Makes every layer now, in stacking order (hint, dialogue, panels and mini-games,
// toasts, stamps), after anything already in #ui such as the HUD and the title.
export function initLayers() {
  layer('hint', 'hud-hint is-off');
  layer('dialogue', 'ui-dialogue-layer');
  layer('modal', 'ui-modal-layer');
  layer('toasts', 'ui-toasts');
  layer('stamps', 'ui-stamps');
}

function h(tag, cls, html) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html != null) el.innerHTML = html;
  return el;
}

const fill = (s) => String(s ?? '').replace(/\{name\}/g, vars.name || 'friend');

// ---------------------------------------------------------------- holding the world

const hold = { depth: 0, frozen: false, croc: true };
function holdOn() {
  if (hold.depth++ > 0) return;
  const p = game && game.player;
  if (p) { hold.frozen = p.frozen; p.frozen = true; }
  const c = game && game.croc;
  if (c && 'enabled' in c) { hold.croc = c.enabled; c.enabled = false; }
  document.body.classList.add('ui-modal-open');
}
function holdOff() {
  if (hold.depth === 0 || --hold.depth > 0) return;
  const p = game && game.player;
  if (p) p.frozen = hold.frozen;
  const c = game && game.croc;
  if (c && 'enabled' in c) c.enabled = hold.croc;
  document.body.classList.remove('ui-modal-open');
  game?.renderer?.domElement?.focus?.();
}

const open = { dialogue: null, panel: null, minigame: null };
// a card in the middle (a panel or a mini-game, not a talk): the HUD's Today card steps aside
const cardClass = () => document.body.classList.toggle('ui-card-open', !!(open.panel || open.minigame));
export function busy() { return !!(open.dialogue || open.panel || open.minigame); }
export function modalKind() { return open.minigame ? 'minigame' : open.panel ? 'panel' : open.dialogue ? 'dialogue' : null; }

// ---------------------------------------------------------------- dialogue

const CHOICE_GUARD = 600; // ms after the choices appear when a key cannot pick one
const dialogueQueue = [];

export function dialogue(opts = {}) {
  return new Promise((resolve) => {
    dialogueQueue.push({ opts, resolve });
    if (!open.dialogue) nextDialogue();
  });
}

function portraitFor(opts) {
  const p = opts.portrait !== undefined ? opts.portrait : /^(james|jon)$/i.test(opts.speaker || '') ? opts.speaker.toLowerCase() : null;
  if (!p) return '';
  if (p === 'james') return jamesPortrait();
  if (p === 'jon') return jonPortrait();
  if (p === 'player') return playerBadge(vars.looks || {});
  return String(p); // markup
}

let lastWrap = null, lastClosed = 0;
function nextDialogue() {
  if (open.dialogue) return; // one at a time; the open one starts the next when it closes
  const item = dialogueQueue.shift();
  if (!item) return;
  const { opts, resolve } = item;
  const lines = (Array.isArray(opts.lines) ? opts.lines : [opts.lines ?? opts.text ?? '']).map(fill);
  const portrait = portraitFor(opts);

  // straight on from the last talk: swap the box in place rather than pop a new one
  const quick = performance.now() - lastClosed < 300;
  if (lastWrap && lastWrap.isConnected) lastWrap.remove();
  const wrap = h('div', 'ui-dialogue' + (portrait ? '' : ' no-portrait') + (quick ? ' is-quick' : ''));
  lastWrap = wrap;
  const box = h('div', 'ui-dialogue-box ui-panel');
  if (portrait) box.appendChild(h('div', 'ui-dialogue-portrait', portrait));
  if (opts.speaker) box.appendChild(h('div', 'ui-dialogue-name', escapeHtml(fill(opts.speaker))));
  const text = h('div', 'ui-dialogue-text');
  const shown = document.createElement('span');
  const ghost = h('span', 'is-ghost');
  text.append(shown, ghost);
  const next = h('div', 'ui-dialogue-next', '<kbd>E</kbd>');
  const extra = h('div', '');
  box.append(text, extra, next);
  wrap.appendChild(box);
  layer('dialogue', 'ui-dialogue-layer').appendChild(wrap);

  const d = { line: 0, chars: 0, full: '', timer: 0, openedAt: performance.now(), waiting: false, finished: false };
  open.dialogue = d;
  holdOn();
  events.emit('dialogue:open', { speaker: opts.speaker || null });

  const showLine = (i) => {
    d.line = i;
    d.full = lines[i] || '';
    d.chars = 0;
    if (typeof opts.onLine === 'function') { try { opts.onLine(i); } catch (e) { console.error(e); } }
    wrap.classList.remove('is-ready');
    clearInterval(d.timer);
    render();
    d.lineAt = performance.now();
    d.timer = setInterval(() => {
      // at the text speed setting's rate, however late the timer runs
      const want = Math.min(d.full.length, Math.floor((performance.now() - d.lineAt) * options.typeRate / 1000));
      if (want <= d.chars) return;
      d.chars = want;
      render();
      if (d.chars >= d.full.length) finishTyping();
    }, 30);
  };
  const render = () => {
    shown.textContent = d.full.slice(0, d.chars);
    ghost.textContent = d.full.slice(d.chars);
    events.emit('dialogue:type', opts.speaker || null, d.full, d.chars); // James's babble (src/audio)
  };
  const finishTyping = () => {
    clearInterval(d.timer);
    d.chars = d.full.length;
    render();
    const last = d.line >= lines.length - 1;
    if (last && (opts.choices || opts.input)) showExtra();
    else wrap.classList.add('is-ready');
  };
  const typing = () => d.chars < d.full.length;

  const finish = (value) => {
    if (d.finished) return;
    d.finished = true;
    clearInterval(d.timer);
    window.removeEventListener('keydown', onKey, true);
    lastClosed = performance.now();
    // fade out unless another talk follows at once (then it takes this box's place)
    setTimeout(() => { if (wrap === lastWrap && wrap.isConnected) wrap.classList.add('is-out'); }, 60);
    setTimeout(() => { if (wrap.isConnected && wrap.classList.contains('is-out')) wrap.remove(); }, 300);
    open.dialogue = null;
    holdOff();
    events.emit('dialogue:close', { speaker: opts.speaker || null, value });
    resolve(value);
    if (dialogueQueue.length) setTimeout(nextDialogue, 60);
  };

  let buttons = [];
  let focus = 0;
  let field = null;
  let badge = null;
  let row = null, pickTag = null;
  const showExtra = () => {
    d.waiting = true;
    d.choiceAt = performance.now();
    d.touched = false;
    next.style.display = 'none';
    if (opts.choices) {
      const palette = opts.choices.every((c) => c && typeof c === 'object' && c.swatch);
      row = h('div', 'ui-dialogue-choices' + (palette ? ' is-swatches' : '') + (opts.plainChoices ? ' is-plain' : ''));
      if (palette && opts.preview) {
        badge = h('div', 'ui-dialogue-badge');
        box.appendChild(badge);
      }
      const numbered = opts.choices.length > 1 && opts.choices.length < 10;
      // the solid button is the one a plain key press would take (the default), else the first
      const primary = opts.plainChoices ? -1 : Number.isInteger(opts.defaultChoice) ? opts.defaultChoice : 0;
      buttons = opts.choices.map((c, i) => {
        const item = typeof c === 'object' && c ? c : { label: String(c), value: c };
        const b = h('button', 'ui-btn' + (i === primary ? '' : ' is-soft'));
        b.type = 'button';
        b.style.animationDelay = (i * 0.06) + 's';
        b.innerHTML = (numbered ? `<em class="ui-choice-num">${i + 1}</em>` : '') +
          (item.swatch ? `<i class="ui-swatch" style="background:${escapeHtml(item.swatch)}"></i>` : '') +
          (item.icon ? icon(item.icon) : '') + escapeHtml(fill(item.label ?? item.value));
        b.addEventListener('click', (e) => { e.stopPropagation(); finish(item.value !== undefined ? item.value : item.label); });
        b.addEventListener('mouseenter', () => setFocus(i, true));
        row.appendChild(b);
        return b;
      });
      extra.appendChild(row);
      setFocus(Number.isInteger(opts.defaultChoice) ? opts.defaultChoice : 0);
    } else if (opts.input) {
      const inp = opts.input === true ? {} : opts.input;
      const row = h('div', 'ui-dialogue-input');
      field = document.createElement('input');
      field.type = 'text';
      field.maxLength = inp.maxLength || 16;
      field.placeholder = inp.placeholder || '';
      field.value = inp.value || '';
      field.autocomplete = 'off';
      field.spellcheck = false;
      const ok = h('button', 'ui-btn', 'OK');
      ok.type = 'button';
      const submit = () => {
        const v = field.value.replace(/\s+/g, ' ').trim();
        if (!v && !inp.allowEmpty) {
          row.classList.remove('is-shake');
          void row.offsetWidth;
          row.classList.add('is-shake');
          field.focus();
          return;
        }
        finish(v);
      };
      ok.addEventListener('click', (e) => { e.stopPropagation(); submit(); });
      field.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
        e.stopPropagation();
      });
      field.addEventListener('click', (e) => e.stopPropagation());
      row.append(field, ok);
      extra.appendChild(row);
      d.submit = submit;
      setTimeout(() => field && field.focus(), 30);
    }
  };
  // user: an arrow key, the pointer or a number chose it (the first highlight does not)
  const setFocus = (i, user = false) => {
    if (!buttons.length) return;
    if (user) {
      d.touched = true;
      if (pickTag) pickTag.classList.add('is-off');
    }
    const was = focus;
    focus = (i + buttons.length) % buttons.length;
    buttons.forEach((b, k) => b.classList.toggle('is-focus', k === focus));
    if (badge) {
      const c = opts.choices[focus];
      badge.innerHTML = playerBadge({ ...(vars.looks || {}), [opts.preview]: c.swatch });
    }
    if (opts.onFocus && (was !== focus || i === 0)) {
      const c = opts.choices[focus];
      try { opts.onFocus(typeof c === 'object' && c ? (c.value !== undefined ? c.value : c.label) : c); } catch (e) { console.error(e); }
    }
  };

  // A press that would confirm a choice nobody has looked at (E mashed through the
  // talk) shows "Pick one" instead: a choice needs the arrows, the pointer or a number
  // first, and a key press is ignored for CHOICE_GUARD ms after the choices appear.
  // A click on a button always counts at once.
  const nudge = () => {
    if (!row) return;
    if (!pickTag) {
      pickTag = h('div', 'ui-dialogue-pick', richText(buttons.length > 1
        ? `Pick one first: [←] [→], the mouse or [1] to [${Math.min(9, buttons.length)}]`
        : 'Pick one first'));
      extra.insertBefore(pickTag, row);
    }
    pickTag.classList.remove('is-off');
    row.classList.remove('is-nudge');
    void row.offsetWidth;
    row.classList.add('is-nudge');
  };
  d.advance = () => {
    if (d.finished) return;
    if (performance.now() - d.openedAt < 180) return; // the press that opened it
    if (typing()) { events.emit('dialogue:skip'); finishTyping(); return; } // James hushes (src/audio)
    if (d.waiting) {
      if (buttons.length) {
        const early = performance.now() - d.choiceAt < CHOICE_GUARD;
        // (a talk with a safe default, defaultChoice, takes it on a key press: "Just a chat")
        if (early || (buttons.length > 1 && !d.touched && !Number.isInteger(opts.defaultChoice))) { nudge(); return; }
        buttons[focus].click();
      }
      return;
    }
    if (d.line < lines.length - 1) showLine(d.line + 1);
    else finish(true);
  };

  const onKey = (e) => {
    if (d.finished || document.activeElement === field) return;
    if (e.code === 'Space') { e.preventDefault(); d.advance(); }
    else if (d.waiting && buttons.length) {
      if (e.code === 'ArrowRight' || e.code === 'ArrowDown') { e.preventDefault(); setFocus(focus + 1, true); }
      else if (e.code === 'ArrowLeft' || e.code === 'ArrowUp') { e.preventDefault(); setFocus(focus - 1, true); }
      else if (/^Digit[1-9]$/.test(e.code)) {
        const i = Number(e.code.slice(5)) - 1;
        if (buttons[i]) buttons[i].click();
      }
    }
  };
  window.addEventListener('keydown', onKey, true);
  box.addEventListener('click', () => d.advance());
  showLine(0);
}

// ---------------------------------------------------------------- toasts and hints

// Toasts made in the same moment keep a sensible order: the news first, then a gold
// reward, then a task stamped (a star), so "Task done" never lands before the flag
// that earned it. The same words twice at once show once. Empty text shows nothing.
const TOAST_MAX = 4;
let toastBatch = null;
const toastRank = (tone, ic) => (tone === 'gold' ? (ic === 'star' ? 2 : 1) : 0);
export function toast(text, { icon: ic = 'leaf', tone = 'good', ms = 2800, portrait = null } = {}) {
  const words = fill(text).trim();
  if (!words) return null;
  const host = layer('toasts', 'ui-toasts');
  for (const other of host.children) {
    if (other.dataset.text === words && !other.classList.contains('is-out')) {
      other.classList.remove('is-again');
      void other.offsetWidth;
      if (!options.reducedMotion) other.classList.add('is-again');
      clearTimeout(other._outTimer);
      other._outTimer = setTimeout(() => toastOut(other), ms);
      return other;
    }
  }
  while (host.children.length >= TOAST_MAX) host.firstElementChild.remove();
  const el = h('div', `ui-toast tone-${tone}`);
  el.dataset.text = words;
  el.innerHTML = portrait ? `<span class="ui-toast-icon is-portrait">${portraitFor({ portrait })}</span><span>${richText(words)}</span>`
    : `<span class="ui-toast-icon">${icon(ic)}</span><span>${richText(words)}</span>`;
  if (!toastBatch) {
    toastBatch = [];
    queueMicrotask(() => { toastBatch = null; });
  }
  const rank = toastRank(tone, ic);
  let before = null;
  for (const b of toastBatch) if (b.rank > rank && b.el.parentNode === host) { before = b.el; break; }
  host.insertBefore(el, before);
  toastBatch.push({ el, rank });
  el._outTimer = setTimeout(() => toastOut(el), ms);
  events.emit('ui:toast', tone, ic); // a chime (src/audio)
  return el;
}
function toastOut(el) {
  el.classList.add('is-out');
  setTimeout(() => el.remove(), 420);
}

let hintText = null;
export function hint(text) {
  const t = text == null || text === '' ? null : String(text);
  if (t === hintText) return;
  hintText = t;
  const el = layer('hint', 'hud-hint is-off');
  if (t) {
    el.innerHTML = richText(fill(t));
    el.classList.remove('is-off');
  } else {
    el.classList.add('is-off');
  }
}
export function currentHint() { return hintText; }

// ---------------------------------------------------------------- stamps

// A burst of stamps from one moment (a catch that finishes two tasks) is queued
// together: the same word twice shows once, and each holds a shorter time while
// others wait. With a card open the stamp lands small on the card's top-right
// corner rather than over it.
const STAMP_MS = 1900, STAMP_QUICK_MS = 1100;
const stampQueue = [];
let stamping = false, stampNow = null;
const stampKey = (label) => String(label).toLowerCase().replace(/[^a-z0-9]/g, '');
export function stamp(label, { tone = 'red', icon: ic = 'lizard' } = {}) {
  const text = fill(label);
  const key = stampKey(text);
  const same = (stampNow && stampNow.key === key) ? stampNow : stampQueue.find((s) => s.key === key);
  if (same) return same.done;
  const s = { label: text, key, tone, ic, resolve: null, done: null };
  s.done = new Promise((resolve) => { s.resolve = resolve; });
  stampQueue.push(s);
  if (!stamping) {
    stamping = true;
    queueMicrotask(nextStamp); // the rest of this moment's stamps join the queue first
  }
  return s.done;
}
function nextStamp() {
  const s = stampQueue.shift();
  stampNow = s || null;
  if (!s) { stamping = false; return; }
  const host = layer('stamps', 'ui-stamps');
  const el = stampEl(s.label, s.tone, s.ic);
  const ms = stampQueue.length ? STAMP_QUICK_MS : STAMP_MS;
  el.style.animationDuration = ms + 'ms';
  placeStamp(el);
  host.appendChild(el);
  events.emit('ui:stamp', { label: s.label });
  setTimeout(() => {
    el.remove();
    s.resolve();
    nextStamp();
  }, ms);
}
// on the corner of an open card, else up and to the right of the player
function placeStamp(el) {
  const m = open.minigame || open.panel;
  const card = m && m.card && m.card.isConnected ? m.card : null;
  if (!card) return;
  const r = card.getBoundingClientRect();
  if (!r.width) return;
  el.classList.add('is-corner');
  el.style.left = Math.round(Math.min(window.innerWidth - 60, r.right - 18)) + 'px';
  el.style.top = Math.round(Math.max(60, r.top + 18)) + 'px';
}

// A stamp element (also used small in the notebook): a round rubber stamp with the
// icon in the middle and the word set round the lower rim (a two-word label that
// is long puts its first words round the top). The rings are the element's CSS.
let stampSeq = 0;
export function stampEl(label, tone = 'red', ic = 'lizard') {
  const cls = tone === 'green' ? ' is-green' : tone === 'gold' ? ' is-gold' : tone === 'blue' ? ' is-blue' : '';
  const el = h('div', 'stamp' + cls, stampArt(label, ic));
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', String(label));
  return el;
}
const ARC_LOW = 'M12.6 56.7 A38 38 0 0 0 87.4 56.7'; // left to right under the icon, letters upright
const ARC_HIGH = 'M24.4 45.5 A26 26 0 0 1 75.6 45.5'; // left to right over the top
function arcText(id, path, text, room, size) {
  // letters are about 0.7 of the size wide in the display font, plus the spacing
  const natural = text.length * size * 0.7 + (text.length - 1) * 1.2;
  const fit = natural > room ? ` textLength="${room}" lengthAdjust="spacingAndGlyphs"` : '';
  return `<path id="${id}" d="${path}" fill="none"/>` +
    `<text font-size="${size}" letter-spacing="1.2" text-anchor="middle"><textPath href="#${id}" startOffset="50%"${fit}>${escapeHtml(text)}</textPath></text>`;
}
function stampArt(label, ic) {
  const words = String(label).toUpperCase().trim().split(/\s+/).filter(Boolean);
  let low = words.join(' '), high = '';
  if (words.length > 1 && low.length > 9) { low = words.pop(); high = words.join(' '); }
  const id = 'stp' + (++stampSeq);
  const body = ic ? iconBody(ic) : '';
  const s = high ? 30 : 36, cy = high ? 52 : 43;
  const art = body
    ? `<svg x="${50 - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
    : '';
  const size = low.length <= 4 ? 23 : low.length <= 7 ? 21 : 19;
  return `<svg class="stamp-art" viewBox="0 0 100 100" aria-hidden="true">${art}` +
    arcText(id + 'l', ARC_LOW, low, 100, size) +
    (high ? arcText(id + 'h', ARC_HIGH, high, 66, 15) : '') +
    '</svg>';
}

// ---------------------------------------------------------------- panels

const panels = new Map();
export function registerPanel(id, spec) { panels.set(id, spec); }
export function currentPanel() { return open.panel ? open.panel.id : null; }

// spec: { card: 'className' (extra classes on the card), title, icon, clear (lighter
// backdrop), render(cardEl, arg, api) -> optional cleanup, update(dt, t), onKey(e) }.
export function openPanel(id, arg) {
  const spec = panels.get(id);
  if (!spec) return Promise.resolve(null);
  if (open.panel) closePanel();
  return new Promise((resolve) => {
    const modal = h('div', 'ui-modal' + (spec.clear ? ' is-clear' : ''));
    const card = h('div', (spec.bare ? '' : 'ui-card ui-panel ') + (spec.card || ''));
    if (spec.title) card.appendChild(h('div', 'ui-card-title', (spec.icon ? icon(spec.icon) : '') + escapeHtml(spec.title)));
    if (spec.closeButton !== false && !spec.bare) {
      const x = h('button', 'ui-card-close', icon('close'));
      x.type = 'button';
      x.setAttribute('aria-label', 'Close');
      x.addEventListener('click', () => closePanel());
      card.appendChild(x);
    }
    modal.appendChild(card);
    modal.addEventListener('pointerdown', (e) => { if (e.target === modal && spec.dismiss !== false) closePanel(); });
    layer('modal', 'ui-modal-layer').appendChild(modal);
    const p = { id, spec, modal, card, resolve, cleanup: null };
    open.panel = p;
    holdOn();
    cardClass();
    const api = { close: (v) => closePanel(v) };
    try { p.cleanup = spec.render ? spec.render(card, arg, api) : null; } catch (e) { console.error(e); }
    p.onKey = (e) => spec.onKey && spec.onKey(e);
    window.addEventListener('keydown', p.onKey);
    events.emit('panel:open', { id });
  });
}

export function closePanel(value) {
  const p = open.panel;
  if (!p) return;
  open.panel = null;
  cardClass();
  window.removeEventListener('keydown', p.onKey);
  try { if (typeof p.cleanup === 'function') p.cleanup(); } catch (e) { console.error(e); }
  p.modal.classList.add('is-out');
  setTimeout(() => p.modal.remove(), 200);
  holdOff();
  events.emit('panel:close', { id: p.id });
  p.resolve(value ?? null);
}

// ---------------------------------------------------------------- mini-games

const minigames = new Map();
const gameQueue = [];
export function registerMinigame(name, factory) { minigames.set(name, factory); }
export function hasMinigame(name) { return minigames.has(name); }
export function minigameNames() { return [...minigames.keys()]; }
export function openMinigame(name, arg) {
  const f = minigames.get(name);
  if (!f) return Promise.resolve({ success: false, quality: 0, missing: true });
  const spec = typeof f === 'function' ? f(arg) : f;
  return minigame({ name, ...spec });
}

export function minigame(spec = {}) {
  return new Promise((resolve) => {
    gameQueue.push({ spec, resolve });
    if (!open.minigame) nextMinigame();
  });
}

function nextMinigame() {
  if (open.minigame) return;
  const item = gameQueue.shift();
  if (!item) return;
  const { spec, resolve } = item;
  if (open.panel) closePanel();
  const name = spec.name || spec.title || 'minigame';
  const modal = h('div', 'ui-modal is-clear');
  const card = h('div', 'ui-card ui-panel ui-minigame' + (spec.card ? ' ' + spec.card : ''));
  card.appendChild(h('div', 'ui-card-title', (spec.icon ? icon(spec.icon) : '') + escapeHtml(fill(spec.title || 'Field task'))));
  const sub = h('div', 'ui-card-sub', richText(fill(spec.instructions || '')));
  const stage = h('div', 'ui-minigame-stage');
  if (spec.width) stage.style.width = spec.width;
  if (spec.height) stage.style.height = spec.height;
  card.append(sub, stage);
  let bar = null;
  if (spec.timeLimit > 0) {
    const t = h('div', 'ui-minigame-timer', '<i></i>');
    bar = t.firstChild;
    card.appendChild(t);
  }
  const cancellable = spec.cancellable !== false;
  if (spec.foot !== false) card.appendChild(h('div', 'ui-minigame-foot', richText(spec.foot || (cancellable ? '[Esc] to give up' : ''))));
  modal.appendChild(card);
  layer('modal', 'ui-modal-layer').appendChild(modal);

  const m = { name, spec, modal, card, stage, ctrl: null, t: 0, over: false, openedAt: performance.now() };
  open.minigame = m;
  holdOn();
  cardClass();
  events.emit('minigame:start', { name });

  const done = (res = {}) => {
    if (m.over) return;
    m.over = true;
    const result = { success: !!res.success, quality: Math.max(0, Math.min(1, Number(res.quality ?? (res.success ? 1 : 0)) || 0)), ...res };
    try { m.ctrl && m.ctrl.destroy && m.ctrl.destroy(); } catch (e) { console.error(e); }
    window.removeEventListener('keydown', onKey, true);
    const close = () => {
      modal.classList.add('is-out');
      setTimeout(() => modal.remove(), 200);
      open.minigame = null;
      cardClass();
      holdOff();
      events.emit('minigame:end', { name, success: result.success, quality: result.quality });
      resolve(result);
      if (gameQueue.length) setTimeout(nextMinigame, 60);
    };
    if (result.quiet || result.cancelled) { close(); return; }
    const word = result.label || (result.success ? (result.quality >= 0.9 ? 'Perfect!' : result.quality >= 0.6 ? 'Lovely!' : 'Got it!') : (result.timeout ? 'Out of time!' : 'Oops!'));
    const flash = h('div', 'ui-minigame-result' + (result.success ? '' : ' is-miss'), `<span>${escapeHtml(word)}</span>`);
    stage.appendChild(flash);
    setTimeout(close, result.hold ?? 850);
  };
  m.done = done;
  m.cancel = () => { if (cancellable) done({ success: false, quality: 0, cancelled: true }); };

  const onKey = (e) => {
    if (m.over) return;
    if (e.code === 'Space') { e.preventDefault(); if (m.ctrl && m.ctrl.onUse) m.ctrl.onUse(); }
  };
  window.addEventListener('keydown', onKey, true);

  const api = {
    done,
    input: game ? game.input : null,
    game,
    elapsed: () => m.t,
    setInstructions: (text) => { sub.innerHTML = richText(fill(text)); },
  };
  try {
    const ctrl = spec.mount ? spec.mount(stage, api) : null;
    if (ctrl && typeof ctrl.then === 'function') ctrl.then((r) => done(r || {}), (e) => { console.error(e); done({ success: false }); });
    else m.ctrl = ctrl || null;
  } catch (e) {
    console.error(e);
    done({ success: false, quality: 0 });
  }
  if (bar) m.bar = bar;
}

// ---------------------------------------------------------------- the per-frame pump

// Called by ui.js once a frame after the input update: advances the dialogue on the
// use action, runs the mini-game's update and forwards use presses to it.
export function pump(dt, t) {
  const inp = game && game.input;
  const d = open.dialogue;
  if (d && inp && inp.pressed('use')) d.advance();
  const m = open.minigame;
  // a card opened over a mini-game (the pause card) holds it: no timer, no presses
  if (m && !m.over && !open.panel) {
    m.t += dt;
    if (m.bar) {
      const left = Math.max(0, 1 - m.t / m.spec.timeLimit);
      m.bar.style.transform = `scaleX(${left.toFixed(3)})`;
      if (left <= 0) {
        if (m.ctrl && m.ctrl.timeout) m.ctrl.timeout();
        else m.done({ success: false, quality: 0, timeout: true });
      }
    }
    if (!m.over && m.ctrl) {
      try {
        if (m.ctrl.update) m.ctrl.update(dt, t);
        if (inp && inp.pressed('use') && performance.now() - m.openedAt > 180 && m.ctrl.onUse) m.ctrl.onUse();
      } catch (e) {
        console.error(e);
        m.done({ success: false, quality: 0 });
      }
    }
  }
  const p = open.panel;
  if (p && p.spec.update) p.spec.update(dt, t);
}

// Esc: close a panel, else give up a mini-game. Returns true when it did something.
export function escape() {
  if (open.panel) { closePanel(); return true; }
  if (open.minigame) { open.minigame.cancel(); return true; }
  return false;
}
