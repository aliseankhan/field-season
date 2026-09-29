// The title screen: "Stroud Lab: Field Season" over the live island, the camera
// drifting slowly round the causeway and the field station while a crested anole does
// push-ups on the logo. Continue (when there is a save, saying whose notebook it is
// and what is in it), Start and Skip to survey day hand over to onChoice('continue' |
// 'start' | 'skip'); Settings calls onSettings(). With a save, Start is "Start again"
// and asks first, since it clears the notebook; "Sound on" shows beside Settings until
// the sound is running. With the island board's API (scoreboard.js) an "Island board"
// card stands on the right (on a narrow screen, a pill beside Settings opens it), its
// four boards on tabs (the left and right arrows move between them; a click on a tab
// leaves the focus, and so E and the arrows, with the title's buttons). Shown while
// state.phase is 'title'; the follow camera is handed back when it goes.

import { state, hasSave, saveSummary, RULES } from '../game/state.js';
import { icon, escapeHtml } from './icons.js';
import { anoleSVG } from './drawings.js';
import { currentPanel, registerPanel, openPanel } from './kit.js';
import { buildTitleBoard, onBoard } from './scoreboard.js';

// The drifting view: high over the south-west lake, the island ahead and the causeway
// and field station below right; it swings slowly round, breathes in and out and
// rises and falls a little (slower with reduced motion).
// ?titleview=tx,ty,tz,radius,height,az tries another framing.
const VIEW = { tx: -8, ty: 1, tz: 20, radius: 55, height: 26, az: -0.75, swing: 0.3, rate: 0.07 };
{
  const v = (new URLSearchParams(location.search).get('titleview') || '').split(',').map(Number);
  if (v.length === 6 && v.every(Number.isFinite)) [VIEW.tx, VIEW.ty, VIEW.tz, VIEW.radius, VIEW.height, VIEW.az] = v;
}

// Check-image flags hold their own camera (?cam=, ?lizard=, ?croc=, ?view=): the title
// then leaves the camera alone and shows no card, so those pictures stay clean.
const CHECK_VIEW = /[?&](cam|lizard|croc|view)=/.test(location.search);

export function buildTitle(game, { onChoice, onSettings }) {
  const el = document.createElement('div');
  el.className = 'ui-title ui-hidden';
  const word = 'Field Season';
  const letters = [...word].map((c, i) => c === ' ' ? ' ' : `<span style="animation-delay:${(i * 0.09).toFixed(2)}s">${c}</span>`).join('');
  el.innerHTML =
    '<div class="ui-logo">' +
      `<div class="ui-logo-lizard">${anoleSVG('cristatellus', { background: false, perch: false, rig: true })}</div>` +
      '<div class="ui-logo-lab">Stroud Lab</div>' +
      `<div class="ui-logo-main" aria-label="${word}">${letters}</div>` +
      '<div class="ui-logo-sub">Catch, measure and release the anoles of Lizard Island</div>' +
    '</div>' +
    '<div class="ui-title-buttons"></div>' +
    '<div class="ui-title-foot">' + [
      ['WASD', 'walk'], ['Shift', 'run'], ['Ctrl', 'creep'], ['F', 'aim'], ['E', 'catch'],
      ['Q', 'tools'], ['N', 'notebook'], ['M', 'map'], ['Esc', 'pause'],
    ].map(([k, w]) => `<span><kbd>${k}</kbd> ${w}</span>`).join(' · ') + '</div>';
  const buttons = el.querySelector('.ui-title-buttons');
  // the island board: hidden until its API answers the ping
  const board = buildTitleBoard({ registerPanel, openPanel });
  el.appendChild(board.el);
  // (the pill is only in the buttons once the board has answered, so a page with no board
  // has exactly the buttons it always had)
  const addBoardPill = () => {
    const pills = buttons.querySelector('.ui-title-pills');
    if (!board.up || !pills || pills.querySelector('[data-c="board"]')) return;
    pills.insertAdjacentHTML('beforeend', `<button type="button" class="ui-title-gear is-board" data-c="board" title="The island board">${icon('trophy')}<span>Island board</span></button>`);
  };
  onBoard(addBoardPill);

  const KEY = '<kbd class="ui-btn-key">E</kbd>';
  const button = ([id, label, ic, cls, sub]) => `<button type="button" class="ui-btn${cls}" data-c="${id}">${icon(ic)}` +
    (sub ? `<span class="ui-btn-text"><span>${label}</span>${sub.map((l) => `<small>${escapeHtml(l)}</small>`).join('')}</span>` : `<span>${label}</span>`) + `${KEY}</button>`;
  let asking = false;
  // What Continue picks up: which day is next, then what is in the notebook.
  function continueLines(S) {
    const day = !S.setupDone ? (S.practice ? 'Getting set up: the practice catch done' : S.floss ? 'Getting set up: a fresh floss loop tied'
      : S.station ? 'Getting set up: the station put right'
      : S.kit ? `Getting set up: ${S.kit} of 5 pieces of kit found` : 'The kit hunt next')
      : `Survey day ${S.days + 1} next` + (S.best ? ` · best day ${S.best.toLocaleString('en-GB')}` : '');
    const book = [];
    if (S.caught) book.push(`${S.caught} lizard${S.caught === 1 ? '' : 's'} caught`);
    if (S.species > 1) book.push(`${S.species} species`);
    if (S.stamps) book.push(`${S.stamps} stamp${S.stamps === 1 ? '' : 's'}`);
    return [day, book.join(' · ') || 'A fresh notebook'];
  }
  function fillButtons() {
    asking = false;
    const S = saveSummary();
    const save = !!S || hasSave();
    const b = [];
    if (save) b.push(['continue', S && S.name ? `Continue as ${escapeHtml(S.name)}` : 'Continue', 'book', ' is-continue', S ? continueLines(S) : null]);
    b.push(['start', save ? 'Start again' : 'Start', 'leaf', save ? ' is-soft' : '']);
    // (for returning players: a new one plays the opening)
    if (save) b.push(['skip', 'Skip to survey day', 'sun', ' is-soft']);
    buttons.classList.remove('is-asking');
    buttons.innerHTML = b.map(button).join('') + '<div class="ui-title-pills">' +
      `<button type="button" class="ui-title-gear" data-c="settings" title="Settings">${icon('gear')}<span>Settings</span></button>` +
      `<button type="button" class="ui-title-gear ui-hidden" data-c="sound" title="Turn the sound on">${icon('sound')}<span>Sound on</span></button>` +
      '</div>';
    soundPill = buttons.querySelector('[data-c="sound"]');
    addBoardPill();
    soundShown = false;
  }
  // "Sound on" beside Settings until the sound is running (any click or key wakes it too;
  // this says there is some). Hidden without the sound system.
  let soundPill = null, soundShown = false;
  function followSound() {
    const A = game.audio && game.audio.api;
    const want = !!(A && soundPill && !A.running);
    if (want === soundShown) return;
    soundShown = want;
    soundPill.classList.toggle('ui-hidden', !want);
    if (!want && document.activeElement === soundPill) buttons.querySelector('.ui-btn')?.focus({ preventScroll: true });
  }
  // Start again with a save: a confirm row in the buttons' place, keeping the notebook
  // the one already in focus
  function askStartAgain() {
    asking = true;
    buttons.classList.add('is-asking');
    buttons.innerHTML = '<div class="ui-title-ask">Start again? Your notebook and stamps will be cleared.</div>' +
      button(['keep', 'Keep my notebook', 'book', '']) + button(['over', 'Start again', 'leaf', ' is-coral']);
    setTimeout(() => buttons.querySelector('[data-c="keep"]')?.focus({ preventScroll: true }), 30);
  }
  buttons.addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (!b || !showing) return;
    choose(b.dataset.c);
  });
  // the pointer moves the focus too, so E and Enter pick what is under it
  buttons.addEventListener('mouseover', (e) => {
    const b = e.target.closest('[data-c]');
    if (b && showing && document.activeElement !== b) b.focus({ preventScroll: true });
  });
  let chosen = false;
  function choose(c) {
    if (chosen) return;
    if (c === 'settings') { if (onSettings) onSettings(); return; }
    if (c === 'sound') { if (game.audio && game.audio.unlock) game.audio.unlock(); return; }
    if (c === 'board') { board.open(); return; }
    if (c === 'start' && hasSave()) { askStartAgain(); return; }
    if (c === 'keep') {
      fillButtons();
      setTimeout(() => buttons.querySelector('[data-c="continue"], [data-c]')?.focus({ preventScroll: true }), 30);
      return;
    }
    if (c === 'over') c = 'start';
    chosen = true;
    el.classList.add('is-out');
    game.events.emit('title:choice', { choice: c });
    setTimeout(() => onChoice && onChoice(c), 350);
  }

  let showing = false, t = 0, rigWas = true;
  function show() {
    showing = true;
    chosen = false;
    fillButtons();
    el.classList.remove('ui-hidden', 'is-out');
    board.show();
    if (game.rig) { rigWas = game.rig.enabled; game.rig.enabled = false; }
    document.body.classList.add('ui-title-on');
    setTimeout(() => buttons.querySelector('.ui-btn')?.focus({ preventScroll: true }), 50);
  }
  function hide() {
    showing = false;
    board.hide();
    el.classList.add('is-out');
    setTimeout(() => { if (!showing) el.classList.add('ui-hidden'); }, 650);
    if (game.rig) { game.rig.enabled = rigWas !== false; if (game.player) game.rig.snap(); }
    document.body.classList.remove('ui-title-on');
  }

  // E, Enter or Space picks the button in focus (the first one when none is);
  // Esc backs out of the start-again question.
  window.addEventListener('keydown', (e) => {
    if (!showing || chosen || currentPanel()) return; // the Settings card has the keys
    // (the board's tabs never keep the focus; should one have it, Enter and Space are its own)
    const onTab = e.target && e.target.closest && e.target.closest('.sb-board');
    if (onTab && (e.code === 'Enter' || e.code === 'Space')) return;
    if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyE') {
      const f = document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-c]');
      e.preventDefault();
      choose(f ? f.dataset.c : buttons.querySelector('[data-c]').dataset.c);
    } else if (e.code === 'Escape' && asking) {
      e.preventDefault();
      choose('keep');
    } else if (!asking && (e.code === 'ArrowLeft' || e.code === 'ArrowRight') && board.drawn) {
      e.preventDefault();
      board.next(e.code === 'ArrowRight' ? 1 : -1);
    } else if (e.code === 'ArrowDown' || e.code === 'ArrowUp' || (asking && (e.code === 'ArrowLeft' || e.code === 'ArrowRight'))) {
      // (a pill a narrow or wide screen hides is skipped)
      const all = [...buttons.querySelectorAll('[data-c]:not(.ui-hidden)')].filter((b) => b.offsetParent !== null);
      const i = all.indexOf(document.activeElement);
      const fwd = e.code === 'ArrowDown' || e.code === 'ArrowRight';
      const n = all[(i + (fwd ? 1 : all.length - 1)) % all.length];
      if (n) { e.preventDefault(); n.focus(); }
    }
  });

  function update(dt) {
    const want = state.phase === 'title' && !CHECK_VIEW;
    if (want && !showing) show();
    else if (!want && showing) hide();
    if (!showing) return;
    followSound();
    // a gentler drift with reduced motion
    t += dt * (state.settings && state.settings.reducedMotion ? 0.4 : 1);
    const cam = game.camera;
    if (!cam || !cam.isPerspectiveCamera) return;
    const a = VIEW.az + Math.sin(t * VIEW.rate) * VIEW.swing;
    const r = VIEW.radius + Math.sin(t * 0.043 + 1.1) * 3.5;
    cam.position.set(VIEW.tx + Math.sin(a) * r, VIEW.ty + VIEW.height + Math.sin(t * 0.09) * 1.6, VIEW.tz + Math.cos(a) * r);
    cam.lookAt(VIEW.tx + Math.sin(t * 0.031) * 2, VIEW.ty, VIEW.tz);
  }

  // After the save changes under it (Reset save in the settings)
  function refresh() { if (showing && !chosen) fillButtons(); }

  return { el, update, show, hide, refresh, get showing() { return showing; }, choose };
}
