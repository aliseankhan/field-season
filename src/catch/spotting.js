// Spotting: hold the aim on a lizard in view within about 15 m for about a second and
// it goes in the notebook as seen ("Spotted: knight anole"), even one far above the
// pole's reach. The same works on the American crocodile, but only from a safe
// distance. Works with any tool (or empty hands) while aim is held; the ray is the
// pointer's, or the middle of the screen without one (with the loop pole's lock-on, the
// ray to the lizard the loop is on or the prompt points at, and the crocodile is
// still looked for along the pointer's or the middle one). A small ring over the lizard
// fills as you hold. The pick runs about 12 times a second (a hit costs the lizards'
// wood tests a few KB); the hold time runs every frame.

import * as THREE from 'three';
import { CATCH, SPECIES_NAMES } from './tuning.js';

const P = CATCH.spot;
const PICK_EVERY = 1 / 12;
const SVG_NS = 'http://www.w3.org/2000/svg';
const CIRC = 2 * Math.PI * 15;

export class Spotter {
  constructor(game, { onSpot, onCroc, dayKey }) {
    this.game = game;
    this.onSpot = onSpot;
    this.onCroc = onCroc;
    this.dayKey = dayKey; // () => a key for today (each lizard is spotted once a day)
    this.target = null; // a lizard or a croc
    this.kind = null; // 'lizard' | 'croc'
    this.held = 0;
    this.lost = 0;
    this.tooClose = false;
    this._ray = new THREE.Ray();
    this._v = new THREE.Vector3();
    this._q = new THREE.Vector3();
    this._crocSeen = new Map(); // croc -> the day it was spotted (once a day each)
    this._pickT = 0;
    this._hitLz = null; // the last pick's lizard, reused between picks

    const el = document.createElement('div');
    el.className = 'spot-ring';
    el.innerHTML = `<svg viewBox="-20 -20 40 40" width="46" height="46" aria-hidden="true"><circle class="spot-back" r="15"/><circle class="spot-fill" r="15" stroke-dasharray="${CIRC.toFixed(2)}" stroke-dashoffset="${CIRC.toFixed(2)}" transform="rotate(-90)"/><path class="spot-eye" d="M-8 0 Q0 -7 8 0 Q0 7 -8 0 Z"/><circle class="spot-pupil" r="2.6"/></svg><span></span>`;
    (document.getElementById('ui') || document.body).appendChild(el);
    this.el = el;
    this.fill = el.querySelector('.spot-fill');
    this.label = el.querySelector('span');
    this._shown = false;
    this._x = -1; this._y = -1; this._k = -1;
  }

  // ray: the aim ray (or null for the middle of the screen); aiming: aim is held;
  // crocRay: where to look for the crocodile when that differs (null: the middle).
  update(dt, ray, aiming, crocRay = undefined) {
    if (!aiming) { this._reset(); return; }
    const g = this.game;
    if (!ray || crocRay === null) {
      const cam = g.camera;
      this._ray.origin.setFromMatrixPosition(cam.matrixWorld);
      this._ray.direction.set(0, 0, 0.5).unproject(cam).sub(this._ray.origin).normalize();
      if (!ray) ray = this._ray;
    }
    const cray = crocRay === undefined ? ray : crocRay || this._ray;
    let target = null, kind = null;
    this._pickT -= dt;
    if (this._pickT <= 0) {
      this._pickT = PICK_EVERY;
      const hit = g.lizards ? g.lizards.pick(ray, P.range) : null;
      this._hitLz = hit && hit.lizard ? hit.lizard : null;
    }
    const lz = this._hitLz;
    if (lz && lz.visible && !this._seen(lz)) { target = lz; kind = 'lizard'; }
    if (!target) {
      const c = this._crocOnRay(cray);
      if (c) { target = c; kind = 'croc'; }
    }
    if (target && target === this.target) {
      this.lost = 0;
      if (!(kind === 'croc' && this.tooClose)) this.held += dt;
    } else if (this.target && this.lost < 0.25) {
      this.lost += dt; // a pick that flickers for a moment keeps its progress
    } else {
      this.target = target; this.kind = kind; this.held = 0; this.lost = 0;
    }
    if (this.target && this.held >= P.hold) {
      const t = this.target, k = this.kind;
      this._reset();
      if (k === 'lizard') {
        t.tag = t.tag && typeof t.tag === 'object' ? t.tag : {};
        t.tag.spottedDay = this.dayKey();
        this.onSpot && this.onSpot(t);
      } else {
        this._crocSeen.set(t, this.dayKey());
        this.onCroc && this.onCroc(t);
      }
      return;
    }
    this._draw();
  }

  _seen(lz) {
    return lz.tag && typeof lz.tag === 'object' && lz.tag.spottedDay === this.dayKey();
  }

  // The nearest croc whose head or body the ray passes close to, within range; notes
  // whether the player is too close for a safe sighting.
  _crocOnRay(ray) {
    const C = this.game.croc;
    if (!C || !C.crocs) return null;
    const p = this.game.player.position;
    let best = null, bt = Infinity;
    const day = this.dayKey();
    for (const c of C.crocs) {
      if (!c.visible || this._crocSeen.get(c) === day) continue;
      c.headPosition(this._v);
      const t = ray.closestPointToPoint(this._v, this._q).distanceTo(ray.origin);
      if (t > P.crocRange + 8) continue;
      const miss = this._q.distanceTo(this._v);
      if (miss > 1.1 + 0.03 * t) continue;
      if (t < bt) { bt = t; best = c; }
    }
    if (best) {
      best.headPosition(this._v);
      const d = Math.hypot(this._v.x - p.x, this._v.z - p.z);
      this.tooClose = d < P.crocSafe;
      if (d > P.crocRange) return null;
    }
    return best;
  }

  _draw() {
    const t = this.target;
    if (!t) { this._show(false); return; }
    const pos = this._v;
    t.headPosition(pos);
    pos.y += this.kind === 'croc' ? 0.5 : 0.06 + 0.15 * (t.length || 0.3);
    const q = this._q.copy(pos).project(this.game.camera);
    if (q.z > 1) { this._show(false); return; }
    const x = (q.x + 1) * 50, y = (1 - q.y) * 50; // percent of the page
    this._show(true);
    if (Math.abs(x - this._x) + Math.abs(y - this._y) > 0.02) {
      this._x = x; this._y = y;
      this.el.style.left = x.toFixed(3) + '%';
      this.el.style.top = y.toFixed(3) + '%';
    }
    const k = Math.min(1, this.held / P.hold);
    if (Math.abs(k - this._k) > 0.01) {
      this._k = k;
      this.fill.setAttribute('stroke-dashoffset', (CIRC * (1 - k)).toFixed(2));
    }
    const text = this.kind === 'croc' && this.tooClose ? 'Too close to watch safely!' : '';
    if (text !== this.label.textContent) this.label.textContent = text;
    this.el.classList.toggle('is-warn', !!text);
  }

  _show(on) {
    if (on === this._shown) return;
    this._shown = on;
    this.el.classList.toggle('is-on', on);
  }

  // Whether crocodile c has been spotted today.
  crocSpotted(c) { return this._crocSeen.get(c) === this.dayKey(); }

  // A new season: the crocodiles can be spotted again.
  forget() { this._crocSeen.clear(); this._hitLz = null; this._reset(); }

  _reset() {
    this._pickT = 0;
    this.target = null; this.kind = null; this.held = 0; this.lost = 0; this.tooClose = false;
    this._k = -1;
    this._show(false);
  }

  get name() {
    return this.target ? (this.kind === 'croc' ? SPECIES_NAMES.crocodile.common : SPECIES_NAMES[this.target.species].common) : null;
  }
}
