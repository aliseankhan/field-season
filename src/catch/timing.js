// Snug the loop: with the loop over a lizard's head, a coral ring shrinks round the
// head towards a green band (the sweet spot, with a gold centre); press use while it
// is in the band to draw the loop tight. Too soon bumps its nose, too late and it
// ducks out. Knight anoles take two snugs. A small overlay in #ui that follows the
// head on screen; the catching system calls update(dt) every frame while it runs.
//
//   start(lizard, { time, band, rounds, second, auto, word }) -> Promise<{ success,
//     quality (0..1), perfect, early, late, rounds }>   (word: the first round's line)
//   auto ('perfect' | 'good' | 'early' | 'late') presses by itself, for checks.

import * as THREE from 'three';
import { CATCH } from './tuning.js';

const T = CATCH.timing;
const SVG_NS = 'http://www.w3.org/2000/svg';

// A ring of little rays and stars that pops out on a good snug.
function burst() {
  let h = '';
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 + 0.2, c = Math.cos(a), s = Math.sin(a);
    const r0 = k % 2 ? 58 : 64, r1 = k % 2 ? 74 : 88;
    h += `<line x1="${(c * r0).toFixed(1)}" y1="${(s * r0).toFixed(1)}" x2="${(c * r1).toFixed(1)}" y2="${(s * r1).toFixed(1)}"/>`;
  }
  return h;
}

export class SnugTiming {
  constructor(game) {
    this.game = game;
    this.active = false;
    this._head = new THREE.Vector3();
    this._q = new THREE.Vector3();
    const el = document.createElement('div');
    el.className = 'snug';
    el.innerHTML = `<svg viewBox="-150 -150 300 300" width="300" height="300" aria-hidden="true">
      <defs><radialGradient id="snugGlow"><stop offset="0.3" stop-color="#1c2a22" stop-opacity="0"/><stop offset="0.72" stop-color="#1c2a22" stop-opacity="0.2"/><stop offset="1" stop-color="#1c2a22" stop-opacity="0"/></radialGradient></defs>
      <circle class="snug-glow" r="150"/>
      <circle class="snug-guide" r="${T.r0}"/>
      <circle class="snug-band" r="${T.at}"/>
      <circle class="snug-sweet" r="${T.at}"/>
      <g class="snug-ring-g"><circle class="snug-ring" r="${T.r0}"/><circle class="snug-knot" r="7" cx="0" cy="${-T.r0}"/></g>
      <g class="snug-burst">${burst()}</g>
    </svg>
    <div class="snug-word"></div>
    <div class="snug-pips"></div>`;
    (document.getElementById('ui') || document.body).appendChild(el);
    this.el = el;
    this.band = el.querySelector('.snug-band');
    this.sweet = el.querySelector('.snug-sweet');
    this.ring = el.querySelector('.snug-ring');
    this.knot = el.querySelector('.snug-knot');
    this.word = el.querySelector('.snug-word');
    this.pips = el.querySelector('.snug-pips');
  }

  start(lizard, opts) {
    this._run = (this._run || 0) + 1; // a close still pending from the last snug leaves this one alone
    this.lizard = lizard;
    this.opts = opts;
    this.round = 0;
    this.results = [];
    this.active = true;
    this.el.classList.remove('is-out', 'is-good', 'is-miss');
    this.el.classList.add('is-on');
    this.pips.innerHTML = opts.rounds > 1 ? '<i></i>'.repeat(opts.rounds) : '';
    this._startRound();
    this.game.events.emit('minigame:start', { name: 'snug' });
    return new Promise((resolve) => { this._resolve = resolve; });
  }

  _startRound() {
    const o = this.opts;
    this.t = 0;
    this.time = o.time * (this.round > 0 ? o.second || 1 : 1);
    this.w = Math.max(5, o.band * T.r0);
    this.r = T.r0;
    this.pressed = false;
    this.band.setAttribute('stroke-width', (this.w * 2).toFixed(1));
    this.sweet.setAttribute('stroke-width', '3');
    const again = this.round > 0 || !!o.word;
    this.word.textContent = this.round > 0 ? 'Again! It\'s strong!' : o.word || 'Press when the loop hits the green!';
    this.word.className = 'snug-word' + (again ? ' is-pop' : ' is-tip');
    this.el.classList.remove('is-good', 'is-miss');
    this._draw();
  }

  update(dt) {
    if (!this.active) return;
    this._follow();
    if (this.pressed) return;
    this.t += dt;
    const lead = T.lead;
    if (this.t > lead) {
      const k = Math.min(1, (this.t - lead) / this.time);
      this.r = T.r0 + (T.rMin - T.r0) * k;
      // held in the band for a screenshot (?catch=...&catchstep=timing)
      if (this.opts.holdAt && this.r <= T.at + this.w * 0.45) { this.r = T.at + this.w * 0.45; this.t -= dt; this._draw(); return; }
    }
    this._draw();
    const inp = this.game.input;
    const auto = this.opts.auto;
    let press = this.t > lead * 0.5 && inp.pressed('use');
    if (auto && this.t > lead) {
      const at = T.at;
      if (auto === 'perfect') press = this.r <= at;
      else if (auto === 'good') press = this.r <= at + this.w * 0.6;
      else if (auto === 'early') press = this.r <= at + this.w + 12;
      else if (auto === 'late') press = false;
    }
    if (press) this._press();
    else if (this.r <= T.at - this.w - 4 || this.r <= T.rMin + 0.5) this._finishRound(false, 0, 'late');
  }

  _press() {
    const d = this.r - T.at;
    if (Math.abs(d) <= this.w) this._finishRound(true, 1 - Math.abs(d) / this.w, null);
    else this._finishRound(false, 0, d > 0 ? 'early' : 'late');
  }

  _finishRound(ok, quality, why) {
    this.pressed = true;
    this.results.push({ ok, quality, why });
    const pip = this.pips.children[this.round];
    if (pip) pip.className = ok ? 'is-good' : 'is-miss';
    if (ok && this.round + 1 < this.opts.rounds) {
      this.el.classList.add('is-good');
      this.word.textContent = quality >= 1 - T.perfect ? 'Perfect!' : 'Snug!';
      this.word.className = 'snug-word is-pop';
      this.round++;
      const run = this._run;
      setTimeout(() => { if (this.active && this._run === run) this._startRound(); }, 520);
      return;
    }
    const all = this.results;
    const success = all.every((r) => r.ok);
    const q = success ? all.reduce((s, r) => s + r.quality, 0) / all.length : 0;
    const perfect = success && all.every((r) => r.quality >= 1 - T.perfect);
    this.el.classList.add(success ? 'is-good' : 'is-miss');
    this.word.textContent = success ? (perfect ? 'Perfect!' : 'Snug!') : why === 'early' ? 'Too soon!' : 'Too slow!';
    this.word.className = 'snug-word is-pop';
    const res = { success, quality: q, perfect, early: why === 'early', late: why === 'late', rounds: all.length };
    this.game.events.emit('minigame:end', { name: 'snug', success, quality: q });
    const run = this._run;
    setTimeout(() => { if (this._run === run) this._close(); }, success ? 520 : 700);
    const r = this._resolve;
    this._resolve = null;
    if (r) r(res);
  }

  _close() {
    this.active = false;
    this.el.classList.add('is-out');
    const run = this._run;
    setTimeout(() => { if (!this.active && this._run === run) this.el.classList.remove('is-on', 'is-out'); }, 260);
  }

  cancel() {
    if (!this.active) return;
    if (this._resolve) {
      const r = this._resolve;
      this._resolve = null;
      r({ success: false, quality: 0, cancelled: true });
    }
    this._close();
  }

  _follow() {
    const lz = this.lizard;
    if (!lz) return;
    lz.headPosition(this._head);
    const q = this._q.copy(this._head).project(this.game.camera);
    // in percent of the page, so it stays on the head if the page is resized under it
    const x = (q.x + 1) * 50, y = (1 - q.y) * 50;
    if (this._x === undefined || Math.abs(x - this._x) + Math.abs(y - this._y) > 0.02) {
      this._x = x; this._y = y;
      this.el.style.left = x.toFixed(3) + '%';
      this.el.style.top = y.toFixed(3) + '%';
    }
  }

  _draw() {
    const r = this.r;
    this.ring.setAttribute('r', r.toFixed(1));
    this.knot.setAttribute('cy', (-r).toFixed(1));
    const inBand = Math.abs(r - T.at) <= this.w && this.t > T.lead;
    this.el.classList.toggle('is-in', inBand);
  }
}
