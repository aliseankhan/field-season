// The settings: the sound volumes and mute, Precise aiming, the day's length, how
// fast James talks, camera shake, reduced motion and "Reset save" (which asks first).
// The same block sits in the pause card's right-hand column and in the title's
// Settings card. Every change is saved at once: the sound's through the sound system
// (src/audio/index.js, its audio API, which keeps them; the block copes without it),
// the rest through state.setSetting, which emits 'settings:change'. applySettings(game)
// passes them on: the kit's text speed and wobbles, a reduce-motion class on the body
// (the stylesheet stills the UI's bobbing) and the croc's camera shake. The clock reads
// the day length and the effects state.settings.reducedMotion themselves.

import { state, setSetting, DAY_LENGTHS, TEXT_SPEEDS } from '../game/state.js';
import * as kit from './kit.js';
import { icon } from './icons.js';
import { onBoard, boardUp } from './scoreboard.js';

const BUSES = ['master', 'music', 'ambience', 'effects', 'voice'];
const BUS_NAMES = { master: 'All sound', music: 'Music', ambience: 'Island sounds', effects: 'Effects', voice: "James's voice" };
const SPEED_NAMES = { slow: 'Slow', normal: 'Normal', fast: 'Fast' };

// ---------------------------------------------------------------- applying

// The sound system's audio API ({ getVolume, setVolume, isMuted, setMuted, preview }),
// once its module has loaded; null without one.
let audio = null;
const audioReady = import('../audio/index.js')
  .then((m) => { audio = (m && (m.audio || m.default)) || null; return audio; })
  .catch(() => null);

export function applySettings(game) {
  const S = state.settings;
  kit.options.typeRate = TEXT_SPEEDS[S.textSpeed] || TEXT_SPEEDS.normal;
  kit.options.reducedMotion = !!S.reducedMotion;
  document.body.classList.toggle('reduce-motion', !!S.reducedMotion);
  if (game && game.croc && 'shake' in game.croc) game.croc.shake = S.cameraShake !== false;
}

// ---------------------------------------------------------------- the block

const sw = (key, title, sub) =>
  `<button type="button" class="ui-switch" data-s="${key}" role="switch" aria-checked="false">` +
    `<span class="ui-switch-text"><b>${title}</b><small>${sub}</small></span>` +
    '<span class="ui-switch-track" aria-hidden="true"><i></i></span></button>';
const seg = (key, title, options) =>
  `<div class="ui-choice" data-s="${key}"><span>${title}</span><div class="ui-seg" role="radiogroup" aria-label="${title}">` +
    options.map(([v, label]) => `<button type="button" role="radio" data-v="${v}" aria-checked="false">${label}</button>`).join('') +
  '</div></div>';

export function settingsHtml() {
  const sliders = BUSES.map((b) =>
    `<label class="ui-slider${b === 'master' ? ' is-master' : ''}"><span>${BUS_NAMES[b]}</span>` +
      `<input type="range" min="0" max="100" step="5" data-vol="${b}" aria-label="${BUS_NAMES[b]} volume">` +
      '<output></output></label>').join('');
  return '<div class="ui-settings">' +
    `<section class="ui-set-sound"><h4>${icon('sound')}Sound</h4>${sliders}` +
      sw('muted', 'Mute', 'Silence everything for now') +
      '<small class="ui-set-note ui-hidden">No sound in this version of the island.</small></section>' +
    `<section class="ui-set-play"><h4>${icon('loop_pole')}Play</h4>` +
      sw('preciseAim', 'Precise aiming', 'Steer the loop with the mouse') +
      // (only with the island board's API, which has the Steady hands board)
      `<small class="ui-set-steady ui-hidden">${icon('hand')}<span>Days played start to finish with Precise aiming go on the Steady hands board.</span></small>` +
      seg('dayMinutes', 'Day length', DAY_LENGTHS.map((m) => [m, `${m} min`])) +
      seg('textSpeed', 'Text speed', Object.keys(TEXT_SPEEDS).map((k) => [k, SPEED_NAMES[k] || k])) +
    `<h4>${icon('eye')}Comfort</h4>` +
      sw('cameraShake', 'Camera shake', 'A jolt when the crocodile snaps') +
      sw('reducedMotion', 'Reduced motion', 'No particles, no wobbles') +
    '</section>' +
    `<div class="ui-set-foot"><button type="button" class="ui-btn is-soft ui-set-reset" data-a="reset">${icon('reset')}<span>Reset save</span></button></div>` +
  '</div>';
}

// Wires a settings block. onReset() runs after the second press of "Reset save".
export function bindSettings(root, game, { onReset } = {}) {
  const S = () => state.settings;
  const sound = root.querySelector('.ui-set-sound');
  const show = () => {
    const A = audio;
    for (const inp of root.querySelectorAll('[data-vol]')) {
      const v = Math.round((A ? A.getVolume(inp.dataset.vol) : 0) * 100);
      if (Number(inp.value) !== v) inp.value = String(v);
      inp.disabled = !A;
      inp.style.setProperty('--fill', v + '%');
      inp.nextElementSibling.textContent = A ? String(v) : '';
      inp.closest('.ui-slider').classList.toggle('is-muted', !A || A.isMuted());
    }
    for (const b of root.querySelectorAll('.ui-switch[data-s]')) {
      const k = b.dataset.s;
      const on = k === 'muted' ? !!(A && A.isMuted()) : !!S()[k];
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      if (k === 'muted') b.disabled = !A;
    }
    for (const c of root.querySelectorAll('.ui-choice[data-s]')) {
      const cur = String(S()[c.dataset.s]);
      for (const b of c.querySelectorAll('[data-v]')) b.setAttribute('aria-checked', b.dataset.v === cur ? 'true' : 'false');
    }
    sound.querySelector('.ui-set-note').classList.toggle('ui-hidden', !!A);
  };
  const change = (key, value) => {
    setSetting(key, value);
    applySettings(game);
    show();
  };
  // the volumes go straight to the sound system; a short sound on that bus when let go
  root.addEventListener('input', (e) => {
    const inp = e.target.closest('[data-vol]');
    if (!inp || !audio) return;
    audio.setVolume(inp.dataset.vol, Number(inp.value) / 100);
    show();
  });
  root.addEventListener('change', (e) => {
    const inp = e.target.closest('[data-vol]');
    if (inp && audio && audio.preview) audio.preview(inp.dataset.vol);
  });
  let asking = false;
  const reset = root.querySelector('[data-a="reset"]');
  const unask = () => {
    asking = false;
    reset.classList.remove('is-coral');
    reset.classList.add('is-soft');
    reset.querySelector('span').textContent = 'Reset save';
  };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !root.contains(b)) return;
    if (b.dataset.a === 'reset') {
      if (!asking) {
        asking = true;
        b.classList.remove('is-soft');
        b.classList.add('is-coral');
        b.querySelector('span').textContent = 'Sure? This clears your notebook';
        return;
      }
      unask();
      if (onReset) onReset();
      return;
    }
    if (asking) unask();
    if (b.classList.contains('ui-switch')) {
      const key = b.dataset.s;
      if (key === 'muted') { if (audio) audio.setMuted(!audio.isMuted()); show(); return; }
      const wasSteady = !!(state.today && state.today.steady);
      change(key, !S()[key]);
      if (key === 'preciseAim') {
        // (turned off mid-day, a Steady hands day is lost: a light word, only with the board)
        const lost = wasSteady && !state.today.steady && boardUp();
        kit.toast(S().preciseAim ? 'Precise aiming on: steer the loop with the mouse.'
          : `Precise aiming off: the loop finds the lizard for you.${lost ? ' Today is off the Steady hands board now.' : ''}`, { icon: 'loop_pole', tone: 'info' });
      }
      return;
    }
    const choice = b.closest('.ui-choice');
    if (choice && b.dataset.v != null) {
      const key = choice.dataset.s;
      change(key, key === 'dayMinutes' ? Number(b.dataset.v) : b.dataset.v);
    }
  });
  // Esc on a slider (which keeps its keys from the game) still closes the card
  root.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && e.target.matches && e.target.matches('input')) { e.preventDefault(); e.target.blur(); kit.escape(); }
  });
  show();
  audioReady.then(() => { if (root.isConnected) show(); });
  const steadyLine = root.querySelector('.ui-set-steady');
  if (steadyLine) onBoard((up) => { if (up && root.isConnected) steadyLine.classList.remove('ui-hidden'); });
  return { show };
}

// The title's Settings card (the pause card shows the same block in its own column).
export function registerSettingsPanel(game, { onReset }) {
  kit.registerPanel('settings', {
    title: 'Settings', icon: 'gear', card: 'ui-settings-card',
    render(card) {
      const body = document.createElement('div');
      body.innerHTML = '<div class="ui-card-sub">Kept on this device, even if you start again.</div>' + settingsHtml();
      card.appendChild(body);
      bindSettings(body, game, { onReset: () => { kit.closePanel(); if (onReset) onReset(); } });
      setTimeout(() => body.querySelector('input, button')?.focus({ preventScroll: true }), 40);
    },
  });
}

