// The loop pole. Hold aim and the pole rises in both hands and the camera eases in
// over the shoulder. The loop reaches a sphere round the shoulder (arm, pole and a
// little slide through the hands), about 2.5 m out and up to about 3.5 m above the
// feet (CATCH.reach). The loop hangs from the tip and swings when the pole moves.
// With the loop over a lizard's head, use calls onSnug(lizard, info).
//
// Lock-on (the default): holding aim picks the best lizard in reach (in front, nearest
// the middle of the view and the player, not round the back of its trunk, and never one
// mostly hidden by wood: two of its head, middle and hips must be in clear view from the
// player's eyes or the camera) and the loop glides over its head by itself, gently
// enough never to startle it, so the skill is the sneaking and the snug. Tab (the 'next'
// action), the wheel or a quick sideways flick of the mouse moves to the next one in
// reach, across the screen and round to the first again; holding Tab moves to one out
// of reach instead. A click made while the loop is still gliding waits for it. With none
// in reach (or after a held Tab) the ring points at a lizard in view the player should
// creep up to ("Get closer"), or one that is too high ("hold to spot it"; spotRay()
// aims the spotter at it). CATCH.lock holds the numbers.
//
// Precise aiming (the pause card's option, precise() true, or an aimRay): the loop
// follows the pointer, its depth from the lizard nearest the ray, and moving it fast
// near a lizard startles it (a bump to its threat; a hit makes it bolt). The pointer
// is a source like any other: setPointer(ndcX, ndcY) or aimRay (a THREE.Ray a VR
// controller can drive) replace the mouse.

import * as THREE from 'three';
import { CATCH, SPECIES_NAMES } from './tuning.js';

const R = CATCH.reach, M = CATCH.magnet, S = CATCH.startle, LK = CATCH.lock;
const GRAVITY = 9.8;
const SVG_NS = 'http://www.w3.org/2000/svg';
const SHOW_WORDS = { headbob: 'Head bob! Now!', pushup: 'Push-up! Now!', dewlap: 'Dewlap! Now!' };
const LOCK_WORDS = {
  lock: 'Click to loop', ready: 'Click to loop', far: 'Get closer', high: 'Too high to catch: hold to spot it',
  spotted: 'Too high to catch', behind: 'Round the back', spot: 'Hold to spot it', turn: 'Turn to face it',
  croc: 'Crocodile! Hold to spot it', crocClose: 'Too close! Back away', hidden: 'Out of sight',
};
const SHOW_LOCK = { headbob: 'Head bob! Click now!', pushup: 'Push-up! Click now!', dewlap: 'Dewlap! Click now!' };
const ALTS = 3; // other lizards in reach marked with a small ring
const common = (lz) => (SPECIES_NAMES[lz.species] ? SPECIES_NAMES[lz.species].common : 'lizard');
const SP_INDEX = Object.fromEntries(Object.keys(SPECIES_NAMES).map((k, i) => [k, i]));
const WHY_INDEX = { far: 0, high: 1, behind: 2, spot: 3, turn: 4, croc: 5, crocClose: 6, hidden: 7 };

// three.js heading: forward is (-sin h, 0, -cos h)
const headingTo = (dx, dz) => Math.atan2(-dx, -dz);
function wrapAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

// A critically damped follow (per component), stable at any frame time.
function damp(cur, vel, target, smoothTime, dt, axis) {
  const omega = 2 / smoothTime, x = omega * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur[axis] - target[axis];
  const temp = (vel[axis] + omega * change) * dt;
  vel[axis] = (vel[axis] - omega * temp) * e;
  cur[axis] = target[axis] + (change + temp) * e;
}

export class LoopPole {
  constructor(game, { onSnug = null, hint = null, canCatch = null, precise = null, spotted = null, crocSpotted = null, quiet = null } = {}) {
    this.game = game;
    this.quiet = quiet || (() => false); // true: the lock-on hint leaves out held Tab (the opening)
    this.onSnug = onSnug;
    this.canCatch = canCatch || (() => true); // false: spot it only (the set-up day)
    this.precise = precise || (() => false); // true: the loop follows the pointer
    this.spotted = spotted || (() => false); // spotted today already (the prompt's words)
    this.crocSpotted = crocSpotted || (() => false); // a crocodile spotted today already
    this.hint = hint || (() => {});
    this.avatar = game.player.avatar;
    this.aimRay = null; // an external ray (VR) instead of the pointer

    this.weight = 0; // 0 carrying, 1 raised
    this.aiming = false;
    this.pointer = { x: 0, y: 0, seen: false, t: -1e9 };
    this._aimFromPointer = false;
    this.ray = new THREE.Ray();
    this.depth = R.defaultDepth;
    this.goal = new THREE.Vector3(); // where the loop is wanted (clamped to reach)
    this.tip = new THREE.Vector3(); // the tip, following the goal
    this.tipVel = new THREE.Vector3();
    this._tipVelPrev = new THREE.Vector3();
    this.loop = new THREE.Vector3(); // the loop's centre in the world
    this._loopPrev = new THREE.Vector3();
    this.loopSpeed = 0;
    this.swing = { ux: 0, uz: 0, vx: 0, vz: 0 }; // the loop's offset from under the tip (world, m)
    this.snug = 1;
    this.lock = null; // the lizard the loop is on
    this.lockHead = new THREE.Vector3();
    this.lockScore = 0;
    this.reachable = false;
    this.why = null; // null, 'far' or 'high' for a lizard out of reach
    this.ready = false;
    this.hold = null; // a lizard the loop stays round (the timing, the snap)
    this.yank = 0; // the pole's lift after a catch, 0..1
    this.kick = 0;
    this._bopT = 0;
    this._started = false;
    this._wantHint = null;
    this.forceAim = false; // held up without the aim button (flags, scripted play)
    this._camLock = null; // the lizard the camera leans to while aiming
    this._camT = 0;
    this._aimT = 0; // seconds since the pole went up
    this.forceLock = null; // a lizard the loop goes to whatever the pointer does
    // lock-on
    this._precise = false;
    this.lead = null; // with none in reach: the lizard in view the prompt points at
    this.leadWhy = null; // 'far', 'high', 'behind', 'spot' (not today) or 'turn'
    this._leadHead = new THREE.Vector3();
    this._cands = []; // lizards the loop could go to now, best first
    this._candS = [];
    this._leads = []; // with none in reach: lizards in view the prompt can point at, best first
    this._leadS = [];
    this._leadW = [];
    this._leadPin = null; // a lead the player moved to with Tab (kept while it is in view)
    this._prefer = null; // that lead once it comes into reach: the loop goes to it
    this._candX = [];
    this._order = [];
    this._selT = 0;
    this._glide = new THREE.Vector3();
    this._glideOn = false;
    this._queued = null; // a click made while the loop glides
    this._queueT = 0;
    this._flick = 0; // quick sideways pointer movement, px
    this._lastX = null;
    this._wheel = 0;
    this._switchT = 0;
    this._tabT = 0; // how long Tab (or a d-pad side) has been held
    this._tabDir = 0;
    this._tabHeld = false; // held long enough: moved out of reach already
    this._view = new Map(); // lizard -> { t, ok }: its clear view, looked at now and then
    this._near = []; // the leafy mounds round the lizard being looked at
    this._pt = new THREE.Vector3();
    this._co2 = new THREE.Vector3();
    this._wood = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, kind: 0, tri: -1, w: 0 };
    this._hintKey = -1;
    this._co = new THREE.Vector3();
    this._cf = new THREE.Vector3();
    this._eye = new THREE.Vector3();
    this._h2 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._spotRay = new THREE.Ray();

    // scratch
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
    this._h = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._q = new THREE.Vector3();
    this._c = new THREE.Vector3();
    this._camPoint = new THREE.Vector3();
    this._ray2 = new THREE.Ray();
    // the last pick, reused while the pointer and camera hold still (a pick that hits a
    // lizard costs the lizards' wood tests a few KB)
    this._pick = { n: 0, pull: 0, o: new THREE.Vector3(), d: new THREE.Vector3(), fresh: false };

    this._buildRing();
    this._buildOverlay();
    this._bindPointer();
  }

  // ---------------------------------------------------------------- pointer

  _bindPointer() {
    const el = this.game.renderer.domElement;
    const move = (e) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      // lock-on: a quick sideways flick (not an orbit drag) moves to the next lizard
      if (this.aiming && !this._precise && !(e.buttons & 1) && this._lastX !== null) {
        const dx = e.clientX - this._lastX;
        if (Math.abs(dx) < 240) this._flick += dx;
      }
      this._lastX = e.clientX;
      this.setPointer(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerdown', move);
  }

  // The pointer in normalised device coordinates (-1..1, y up).
  setPointer(x, y) {
    const p = this.pointer;
    if (p.seen && Math.abs(p.x - x) + Math.abs(p.y - y) < 1e-4) return;
    p.x = x; p.y = y; p.seen = true; p.t = performance.now();
    if (this.aiming) this._aimFromPointer = true;
  }

  // ---------------------------------------------------------------- per frame

  // equipped: the loop pole is in hand; busy: a menu or card is open.
  update(dt, t, { equipped, busy }) {
    const g = this.game, inp = g.input, player = g.player;
    const precise = !!this.aimRay || !!this.precise();
    if (precise !== this._precise) { this._precise = precise; this._glideOn = false; this._queued = null; this.lead = null; }
    const want = !!this.hold || (equipped && !busy && !player.pushed && (inp.down('aim') || this.forceAim));
    if (want && !this.aiming) this._begin();
    else if (!want && this.aiming) this._end();
    this.aiming = want;
    const rate = want ? 7 : 5;
    this.weight += ((want ? 1 : 0) - this.weight) * (1 - Math.exp(-rate * dt));
    if (!want && this.weight < 0.01) this.weight = 0;

    const aim = this.avatar.aim;
    if (this.weight <= 0 || !equipped) {
      if (aim) aim.weight = 0;
      this._showOverlay(false);
      this.ring.visible = false;
      this.lock = null; this.ready = false; this.lead = null; this._queued = null;
      return;
    }

    // the tip where the avatar put it last frame (what is drawn), in the world
    this._tipFromAvatar();
    this._pendulum(dt, t);

    if (this.hold) this._holdGoal(dt);
    else if (this._precise) this._aimGoal(dt);
    else this._lockGoal(dt);
    // the camera leans to the lizard the loop has settled on
    if (this.lock && this.lock !== this._camLock) {
      this._camT += dt;
      if (this._camT > 0.6) { this._camLock = this.lock; this._camT = 0; }
    } else this._camT = 0;
    if (this._camLock && this._camLock.visible) this._camLock.headPosition(this._camPoint);

    // the pole follows the goal, the tip above the loop
    this._c.copy(this.goal);
    this._c.y += R.drop * this.snug + this.yank * 0.55;
    this._tipVelPrev.copy(this.tipVel);
    if (!this._started) { this.tip.copy(this._c); this.tipVel.set(0, 0, 0); this._started = true; }
    const st = R.tipSmooth * (this.hold ? 1.6 : 1);
    damp(this.tip, this.tipVel, this._c, st, dt, 'x');
    damp(this.tip, this.tipVel, this._c, st, dt, 'y');
    damp(this.tip, this.tipVel, this._c, st, dt, 'z');

    this._faceGoal(dt);
    this._writeAvatar();
    this._startle(dt);

    // ready: the loop sits over the head of a lizard within reach
    const lz = this.lock;
    this.ready = false;
    if (!this.hold && lz && this.reachable && this.weight > 0.85 && lz.visible) {
      const tol = CATCH.over.base + CATCH.over.perLength * lz.length;
      this.ready = this.loop.distanceTo(this.lockHead) < tol;
    }
    if (!this.hold && want && inp.pressed('use')) this._use();
    else if (this._queued) this._waitQueued(dt);
    this._placeRing();
    this._drawOverlay();
    if (want) this._hints();
  }

  _begin() {
    const g = this.game;
    this._pick.fresh = false;
    this._started = this.weight > 0.05;
    this._aimFromPointer = false;
    this.depth = R.defaultDepth;
    this.lock = null;
    // the camera leans towards the lizard ahead, or a point in front at chest height
    const p = g.player.position;
    let ahead = this.forceLock;
    this.lead = null;
    this._queued = null;
    this._flick = 0; this._wheel = 0; this._switchT = 0;
    this._tabT = 0; this._tabDir = 0; this._tabHeld = !!(g.input.down('next') || g.input.down('prev'));
    if (!ahead && this._precise) { const r = this._currentRay(); this._pickLock(r); ahead = this.lock || this._bestAhead(R.out + 2); }
    else if (!this._precise) {
      this._select();
      this._selT = LK.every;
      ahead = ahead || this.lock || this.lead || this._bestAhead(R.out + 2);
      // the loop starts from in front of the chest, part of the way to the lizard
      const h = g.player.heading;
      this._glide.set(p.x - Math.sin(h) * R.defaultDepth, p.y + 1.45, p.z - Math.cos(h) * R.defaultDepth);
      if (this.lock) { this.lock.headPosition(this.lockHead); this._glide.lerp(this.lockHead, LK.start); }
      this._glideOn = true;
    }
    if (ahead) ahead.headPosition(this._camPoint);
    else this._camPoint.set(p.x - Math.sin(g.player.heading) * 2, p.y + 1.5, p.z - Math.cos(g.player.heading) * 2);
    this._camLock = ahead;
    this._camT = 0;
    this._aimT = 0;
    if (g.rig) { g.rig.aim = 1; g.rig.aimPoint = this._camPoint; }
    this.game.events.emit('pole:aim', { on: true });
  }

  _end() {
    const g = this.game;
    if (g.rig) { g.rig.aim = 0; g.rig.aimPoint = null; }
    this.hint(null);
    this._wantHint = null;
    this._hintKey = -1;
    this._queued = null;
    this.lead = null;
    this._leadPin = null;
    this._prefer = null;
    this._glideOn = false;
    this.game.events.emit('pole:aim', { on: false });
  }

  // ---------------------------------------------------------------- the loop's goal

  _aimGoal(dt) {
    const g = this.game, cam = g.camera, p = g.player.position;
    const ray = this._currentRay();
    // the camera's horizontal forward: the depth plane faces it
    const n = this._n.set(0, 0, -1).applyQuaternion(cam.quaternion);
    n.y = 0;
    if (n.lengthSq() < 1e-6) n.set(-Math.sin(g.player.heading), 0, -Math.cos(g.player.heading));
    n.normalize();

    // which lizard the pointer is on
    const pick = this._pickLock(ray);
    let depthGoal = R.defaultDepth;
    if (this.lock) {
      this.lock.headPosition(this.lockHead);
      depthGoal = Math.min(9, Math.max(0.6, (this.lockHead.x - p.x) * n.x + (this.lockHead.z - p.z) * n.z));
    }
    this.depth += (depthGoal - this.depth) * (1 - Math.exp(-10 * dt));

    const goal = this._v;
    if (ray) {
      // the point under the pointer on the plane `depth` in front of the player
      const q = this._q.copy(p).addScaledVector(n, this.depth);
      const dn = ray.direction.dot(n);
      const tt = dn > 0.05 ? ((q.x - ray.origin.x) * n.x + (q.z - ray.origin.z) * n.z) / dn : ray.origin.distanceTo(q);
      goal.copy(ray.direction).multiplyScalar(Math.max(0.3, tt)).add(ray.origin);
      if (this.lock && pick > 0) goal.lerp(this.lockHead, M.pull * pick);
    } else if (this.lock) {
      goal.copy(this.lockHead);
    } else {
      const h = g.player.heading;
      goal.set(p.x - Math.sin(h) * R.defaultDepth, p.y + 1.45, p.z - Math.cos(h) * R.defaultDepth);
    }

    this._clampReach(goal, this.goal);
    // a lizard out of reach: too high, or just too far
    this.reachable = false;
    this.why = null;
    if (this.lock) {
      this._clampReach(this._w.copy(this.lockHead), this._h);
      this.reachable = this._h.distanceToSquared(this.lockHead) < 0.07 * 0.07;
      if (!this.reachable) {
        const up = this.lockHead.y - p.y;
        this.why = up + R.drop > R.shoulder + R.radius * 0.97 || up > R.top ? 'high' : 'far';
      } else if (this.lock.surface === 'bark') {
        // on the far side of its trunk the pole would have to go through the wood
        const nv = this.lock.nrm, nh = Math.hypot(nv.x, nv.z);
        const dx = p.x - this.lockHead.x, dz = p.z - this.lockHead.z, d = Math.hypot(dx, dz);
        if (nh > 0.3 && d > 0.1 && (nv.x * dx + nv.z * dz) / (nh * d) < -0.25) { this.reachable = false; this.why = 'behind'; }
      }
    }
  }

  _holdGoal(dt) {
    const lz = this.hold;
    lz.headPosition(this.lockHead);
    this.goal.copy(this.lockHead);
    this.lock = lz;
    this.reachable = true;
    this.why = null;
  }

  // ---------------------------------------------------------------- lock-on

  _lockGoal(dt) {
    const g = this.game, p = g.player.position;
    const cur = this.lock;
    this._selT -= dt;
    if (this._selT <= 0 || (cur && !this._alive(cur)) || (this.forceLock && cur !== this.forceLock)) {
      this._selT = LK.every;
      this._select();
    }
    this._switching(dt);
    const want = this._v;
    this.reachable = false;
    this.why = null;
    if (this.lock) {
      this.lock.headPosition(this.lockHead);
      want.copy(this.lockHead);
      this.reachable = true;
    } else if (this.lead) {
      // reach out towards it: the loop points the way
      this.lead.headPosition(this._leadHead);
      want.copy(this._leadHead);
      this.why = this.leadWhy;
    } else {
      const h = g.player.heading;
      want.set(p.x - Math.sin(h) * R.defaultDepth, p.y + 1.45, p.z - Math.cos(h) * R.defaultDepth);
    }
    this._clampReach(want, want);
    // the loop glides there by itself, never faster than LK.glide
    const gl = this._glide;
    if (!this._glideOn) { gl.copy(this.loop); this._glideOn = true; }
    const dx = want.x - gl.x, dy = want.y - gl.y, dz = want.z - gl.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 1e-5) {
      const step = Math.min(d * (1 - Math.exp(-LK.ease * dt)), LK.glide * dt);
      const k = step / d;
      gl.x += dx * k; gl.y += dy * k; gl.z += dz * k;
    }
    this._clampReach(gl, this.goal);
  }

  _alive(lz) {
    return lz.visible && lz.state !== 'flee' && lz.state !== 'hidden' && lz.state !== 'captured' && lz.state !== 'inactive';
  }

  // Keeps the lizard the loop is on while it can still be looped (a new one only when
  // asked); else the best in reach (every one in reach is in clear view: _gather).
  _select() {
    this._gather();
    if (this.forceLock) { this.lock = this.forceLock.visible ? this.forceLock : null; return; }
    // the player moved on to a lizard out of reach (to spot it, or to creep up on it)
    if (this._leadPin) { if (this.lock) { this.lock = null; this._queued = null; } return; }
    const cur = this.lock, c = this._cands;
    if (this._prefer && c.indexOf(this._prefer) >= 0) { this.lock = this._prefer; this._prefer = null; if (this.lock !== cur) this._queued = null; return; }
    this._prefer = null;
    if (cur && c.indexOf(cur) >= 0) return;
    this.lock = c.length ? c[0] : null;
    if (this.lock !== cur) this._queued = null;
  }

  // Every lizard the loop could go to from here, best first (this._cands): shown,
  // catchable today, in the reach envelope, not round the back of its trunk, in clear
  // view and in front. Also the leads: the ones in view that cannot be looped (too far,
  // too high, round the back, hidden by wood, not today, behind the player), best first,
  // catchable ones before high ones; the prompt points at the best (or the one the
  // player moved to).
  _gather() {
    const L = this.game.lizards, c = this._cands, cs = this._candS;
    const ld = this._leads, lsc = this._leadS, lw = this._leadW;
    c.length = 0; cs.length = 0; ld.length = 0; lsc.length = 0; lw.length = 0;
    this.lead = null; this.leadWhy = null;
    if (!L) return;
    const g = this.game, p = g.player.position, cam = g.camera;
    const co = this._co.setFromMatrixPosition(cam.matrixWorld);
    const cf = this._cf.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const yaw = g.rig ? g.rig.yaw : g.player.heading;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const h = this._h;
    for (const lz of L.all) {
      if (!this._alive(lz)) continue;
      lz.headPosition(h);
      const dx = h.x - p.x, dz = h.z - p.z, d = Math.sqrt(dx * dx + dz * dz);
      if (d > LK.lead) continue;
      const vx = h.x - co.x, vy = h.y - co.y, vz = h.z - co.z, vl = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
      const off = Math.acos(Math.max(-1, Math.min(1, (vx * cf.x + vy * cf.y + vz * cf.z) / vl)));
      const score = off * LK.angle + d * LK.distance;
      let why = this._whyNot(lz, h);
      // mostly hidden by wood: never looped, and the prompt says to step round
      if (!why && !this._clearView(lz)) why = 'hidden';
      const q = this._q.copy(h).project(cam);
      const onScreen = q.z < 1 && q.x > -0.95 && q.x < 0.95 && q.y > -0.95 && q.y < 0.95;
      if (!why) {
        // in front of the player, or anywhere the player can see it (the player turns to it)
        const a = d > 0.25 ? Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d))) : 0;
        if (a <= LK.front || onScreen) {
          // insert in score order (a handful at most)
          let i = c.length;
          c.push(lz); cs.push(score);
          while (i > 0 && cs[i - 1] > score) { c[i] = c[i - 1]; cs[i] = cs[i - 1]; i--; }
          c[i] = lz; cs[i] = score;
          continue;
        }
        why = 'turn';
      }
      // the prompt's lizard: on screen, catchable ones first
      if (!onScreen) continue;
      const s = score + (why === 'high' ? 1.2 : why === 'hidden' ? 1.6 : why === 'spot' ? 2.5 : 0);
      let i = ld.length;
      ld.push(lz); lsc.push(s); lw.push(why);
      while (i > 0 && lsc[i - 1] > s) { ld[i] = ld[i - 1]; lsc[i] = lsc[i - 1]; lw[i] = lw[i - 1]; i--; }
      ld[i] = lz; lsc[i] = s; lw[i] = why;
    }
    // the lizard the player moved to: into reach now (the loop goes to it), or gone
    const pin = this._leadPin;
    if (pin && c.indexOf(pin) >= 0) { this._prefer = pin; this._leadPin = null; }
    else if (pin && ld.indexOf(pin) < 0) this._leadPin = null;
    // a crocodile in view that has not been spotted today comes first: the prompt says
    // to spot it (from a safe distance), and the spotter holds on it
    const cr = !c.length && !this._leadPin ? this._crocInView(p, cam) : null;
    if (cr) {
      cr.headPosition(h);
      this.lead = cr;
      this.leadWhy = Math.hypot(h.x - p.x, h.z - p.z) < CATCH.spot.crocSafe ? 'crocClose' : 'croc';
      return;
    }
    if (!ld.length) return;
    const k = this._leadPin ? ld.indexOf(this._leadPin) : 0;
    this.lead = ld[k]; this.leadWhy = lw[k];
  }

  // The nearest crocodile on screen within the spotting range, not spotted today.
  _crocInView(p, cam) {
    const C = this.game.croc;
    if (!C || !C.crocs) return null;
    let best = null, bd = CATCH.spot.crocRange;
    for (const c of C.crocs) {
      if (!c.visible || this.crocSpotted(c)) continue;
      c.headPosition(this._h2);
      const d = Math.hypot(this._h2.x - p.x, this._h2.z - p.z);
      if (d > bd) continue;
      const q = this._q.copy(this._h2).project(cam);
      if (q.z > 1 || Math.abs(q.x) > 0.95 || Math.abs(q.y) > 0.95) continue;
      bd = d; best = c;
    }
    return best;
  }

  // null when the loop can go over lz's head (h) from here, else why not.
  _whyNot(lz, h) {
    if (!this.canCatch(lz)) return 'spot';
    const p = this.game.player.position;
    this._clampReach(h, this._h2);
    if (this._h2.distanceToSquared(h) >= 0.07 * 0.07) {
      const up = h.y - p.y;
      return up + R.drop > R.shoulder + R.radius * 0.97 || up > R.top ? 'high' : 'far';
    }
    if (lz.surface === 'bark' && lz.nrm) {
      const nv = lz.nrm, nh = Math.hypot(nv.x, nv.z);
      const dx = p.x - h.x, dz = p.z - h.z, d = Math.hypot(dx, dz);
      if (nh > 0.3 && d > 0.1 && (nv.x * dx + nv.z * dz) / (nh * d) < -0.25) return 'behind';
    }
    return null;
  }

  // Whether lz is in clear view: of its head, middle and hips, LK.seen (two) can be seen
  // from the player's eyes or from the camera with no wood or trunk between (the
  // lizards' pick, then the drawn wood right up to the point, since the pick stops at
  // the body's sphere), and not buried in a leafy mound (the aim's cut-out leaves the
  // last 1.4 m before a lizard whole). Remembered for LK.seenFor s; a few picks when it
  // is looked at.
  _clearView(lz) {
    // the one the loop is on stays while any of it can be seen (no flicking back and
    // forth as the camera eases in); a new one needs LK.seen of its three points
    const need = lz === this.lock ? 1 : LK.seen;
    const now = this.game.time;
    let e = this._view.get(lz);
    if (!e) { e = { t: -1e9, n: 0 }; this._view.set(lz, e); }
    if (now - e.t < LK.seenFor && now >= e.t) return e.n >= need;
    e.t = now;
    const L = this.game.lizards;
    if (!L || !L.pick) { e.n = 3; return true; }
    const near = this._nearMounds(lz);
    this.game.player.headPosition(this._eye);
    this._co2.setFromMatrixPosition(this.game.camera.matrixWorld);
    // wood from the eyes or the camera; leaves (when there are any round it) from the
    // camera only, which is what is on screen
    const cam = this._pointsClear(L, lz, this._co2, true);
    e.n = near.length ? cam : Math.max(cam, this._pointsClear(L, lz, this._eye, false));
    return e.n >= need;
  }

  // How many of lz's head, middle and hips can be seen from `from` (0 to 3).
  _pointsClear(L, lz, from, leaves) {
    const u = lz.upS || lz.nrm, f = lz.fwdS || lz.fwd, n = lz.length || 0.35, p = lz.pos, t = this._pt;
    let clear = 0;
    for (let k = 0; k < 3; k++) {
      if (k === 0) lz.headPosition(t);
      else if (k === 1) t.set(p.x + u.x * 0.1 * n, p.y + u.y * 0.1 * n, p.z + u.z * 0.1 * n);
      else t.set(p.x - f.x * 0.28 * n + u.x * 0.08 * n, p.y - f.y * 0.28 * n + u.y * 0.08 * n, p.z - f.z * 0.28 * n + u.z * 0.08 * n);
      if (this._clearTo(L, lz, from, t, leaves)) clear++;
    }
    return clear;
  }

  // the leafy mounds round lz (into this._near, reused)
  _nearMounds(lz) {
    const all = (this.game.veg && this.game.veg.hosts && this.game.veg.hosts.mounds) || [], near = this._near;
    near.length = 0;
    for (let i = 0; i < all.length; i++) {
      const m = all[i], dx = m.x - lz.pos.x, dz = m.z - lz.pos.z, r = m.r + 1.8;
      if (dx * dx + dz * dz < r * r) near.push(m);
    }
    return near;
  }

  // Whether a leafy mound hides lz's head from (x, y, z) (for the aim camera's choice of
  // shoulder: the cut-out leaves the last 1.4 m before a lizard whole).
  leavesBetween(lz, x, y, z) {
    if (!this._nearMounds(lz).length) return false;
    lz.headPosition(this._pt);
    const t = this._pt, dx = x - t.x, dy = y - t.y, dz = z - t.z, l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    for (let s = 0.2; s <= 1.6 && s < l; s += 0.2) if (this._inMound(t.x + dx / l * s, t.y + dy / l * s, t.z + dz / l * s)) return true;
    return false;
  }

  // inside one of the nearby mounds' domes (a little in from the leaves, so a lizard
  // lying on a mound is not inside it)
  _inMound(x, y, z) {
    const near = this._near;
    for (let i = 0; i < near.length; i++) {
      const m = near[i], dx = (x - m.x) / (m.r * 0.9), dz = (z - m.z) / (m.r * 0.9), dy = (y - m.y) / (m.h * 0.9);
      if (dy > -0.15 && dx * dx + dz * dz + (dy > 0 ? dy * dy : 0) < 1) return true;
    }
    return false;
  }

  _clearTo(L, lz, from, to, leaves) {
    // the last 1.6 m of the way (and the point itself) not inside leaves
    if (leaves && this._near.length) {
      const dx = from.x - to.x, dy = from.y - to.y, dz = from.z - to.z, l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      for (let s = 0; s <= 1.6 && s < l; s += 0.2) if (this._inMound(to.x + dx / l * s, to.y + dy / l * s, to.z + dz / l * s)) return false;
    }
    const r = this._ray2;
    r.origin.copy(from);
    r.direction.copy(to).sub(from);
    const d = r.direction.length();
    if (d < 1e-3) return true;
    r.direction.multiplyScalar(1 / d);
    const hit = L.pick(r, d + 0.5);
    if (!hit || hit.lizard !== lz) return false;
    const P = L.perches && L.perches.index;
    if (!P || d < 0.12) return true;
    const back = Math.min(d, 12) - 0.04, o = from, dd = r.direction;
    return !P.blocked(o.x + dd.x * (d - back - 0.04), o.y + dd.y * (d - back - 0.04), o.z + dd.z * (d - back - 0.04), dd.x, dd.y, dd.z, back, this._wood);
  }

  // Tab ('next', 'prev' on a gamepad's d-pad), the wheel or a quick sideways flick of the
  // mouse: a tap moves to the next lizard in reach (when Tab is let go, so a hold can
  // mean something else); a hold of LK.hold s moves to one out of reach.
  _switching(dt) {
    const inp = this.game.input;
    this._switchT = Math.max(0, this._switchT - dt);
    if (inp.zoom) this._wheel += inp.zoom;
    let dir = 0;
    const held = inp.down('next') ? 1 : inp.down('prev') ? -1 : 0;
    if (held) {
      if (!this._tabDir) { this._tabDir = held; this._tabT = 0; }
      this._tabT += dt;
      if (!this._tabHeld && this._tabT >= LK.hold) {
        this._tabHeld = true;
        if (!this.forceLock) this.cycleOut(this._tabDir);
      }
    } else if (this._tabDir) {
      if (!this._tabHeld) dir = this._tabDir; // a tap
      this._tabDir = 0; this._tabT = 0; this._tabHeld = false;
    }
    if (!dir && this._switchT <= 0 && Math.abs(this._wheel) >= LK.wheel) dir = Math.sign(this._wheel);
    else if (!dir && this._switchT <= 0 && Math.abs(this._flick) >= LK.flick) dir = Math.sign(this._flick);
    // a slow drift is forgotten (after the test, so a slow frame cannot eat a flick)
    this._flick *= Math.exp(-dt / LK.flickDecay);
    if (this._switchT > 0) this._wheel = 0;
    if (!dir || this.forceLock) return;
    this._wheel = 0; this._flick = 0;
    this._switchT = LK.cooldown;
    this.cycle(dir);
  }

  // The next lizard in reach across the screen (dir 1 to the right, -1 to the left),
  // and round to the first again; from one out of reach, back to the one lock-on would
  // pick. Lizards out of reach are only reached with a held Tab (cycleOut).
  cycle(dir = 1) {
    this._gather();
    const c = this._cands, n = c.length;
    if (!n) return false;
    let next;
    if (this._leadPin || !this.lock || c.indexOf(this.lock) < 0) next = c[0];
    else {
      const xs = this._candX, order = this._order, cam = this.game.camera, h = this._h;
      xs.length = n; order.length = n;
      for (let i = 0; i < n; i++) {
        c[i].headPosition(h);
        h.project(cam);
        xs[i] = h.z > 1 ? -h.x : h.x;
        order[i] = i;
      }
      order.sort((a, b) => xs[a] - xs[b]);
      let at = 0;
      for (let i = 0; i < n; i++) if (c[order[i]] === this.lock) at = i;
      next = c[order[(((at + dir) % n) + n) % n]];
    }
    if (next === this.lock && !this._leadPin) return false;
    this._queued = null;
    this.lock = next;
    this._leadPin = null;
    this._prefer = null;
    this._selT = LK.every;
    this.game.events.emit('pole:target', { lizard: next, inReach: true });
    return true;
  }

  // A held Tab: the next lizard in view out of reach (one high up to spot, one to creep
  // up on, one round the back or behind wood), across the screen and round again. The
  // loop points the way and the spotter holds on it.
  cycleOut(dir = 1) {
    this._gather();
    const ld = this._leads, n = ld.length;
    if (!n) return false;
    const xs = this._candX, order = this._order, cam = this.game.camera, h = this._h;
    xs.length = n; order.length = n;
    for (let i = 0; i < n; i++) {
      ld[i].headPosition(h);
      h.project(cam);
      xs[i] = h.z > 1 ? -h.x : h.x;
      order[i] = i;
    }
    order.sort((a, b) => xs[a] - xs[b]);
    const was = this._leadPin;
    let at = -1;
    for (let i = 0; i < n; i++) if (ld[order[i]] === was) at = i;
    if (at < 0) at = dir > 0 ? -1 : n;
    const k = order[(((at + dir) % n) + n) % n], next = ld[k];
    if (next === was) return false;
    this._queued = null;
    this.lock = null;
    this._prefer = null;
    this._leadPin = next;
    this.lead = next;
    this.leadWhy = this._leadW[k];
    this._selT = LK.every;
    this.game.events.emit('pole:target', { lizard: next, inReach: false });
    return true;
  }

  // The ray the spotter should hold: on the lizard the loop is on (or the one the
  // prompt points at) in lock-on, else the pointer's.
  spotRay() {
    if (!this._precise && this.aiming && !this.hold) {
      const t = this.lock || this.lead;
      if (t && t.visible) {
        const r = this._spotRay, cam = this.game.camera;
        r.origin.setFromMatrixPosition(cam.matrixWorld);
        t.headPosition(this._v2);
        r.direction.copy(this._v2).sub(r.origin).normalize();
        return r;
      }
    }
    return this.pointerRay();
  }

  // The pointer's ray when the pointer has moved in the last few seconds (for spotting
  // with any tool), else null.
  pointerRay() {
    if (this.aimRay) return this.aimRay;
    const p = this.pointer;
    if (!p.seen || performance.now() - p.t > 6000) return null;
    const cam = this.game.camera;
    const r = this.ray;
    r.origin.setFromMatrixPosition(cam.matrixWorld);
    r.direction.set(p.x, p.y, 0.5).unproject(cam).sub(r.origin).normalize();
    return r;
  }

  _currentRay() {
    if (this.forceLock) return null;
    if (this.aimRay) return this.aimRay;
    const p = this.pointer;
    if (!p.seen || !this._aimFromPointer) {
      // a pointer that moved in the last few seconds before the aim still counts
      if (!p.seen || performance.now() - p.t > 4000) return null;
      this._aimFromPointer = true;
    }
    const cam = this.game.camera;
    const r = this.ray;
    r.origin.setFromMatrixPosition(cam.matrixWorld);
    r.direction.set(p.x, p.y, 0.5).unproject(cam).sub(r.origin).normalize();
    return r;
  }

  // Picks the lizard for the loop: a direct hit, else the one nearest the ray within
  // the magnet's reach and not behind wood. Returns the pull (0..1) towards its head.
  _pickLock(ray) {
    const L = this.game.lizards;
    if (!L) { this.lock = null; return 0; }
    if (this.forceLock) { this.lock = this.forceLock.visible ? this.forceLock : null; return this.lock ? 1 : 0; }
    if (!ray) {
      const best = this._bestAhead(R.out + 1.5);
      if (best !== this.lock) this.lock = best;
      return best ? 1 : 0;
    }
    // every fourth frame while the ray holds nearly still (3 cm, a degree), else now
    const pk = this._pick;
    const still = pk.fresh && ray.origin.distanceToSquared(pk.o) < 9e-4 && ray.direction.dot(pk.d) > 0.99985;
    if (still && (pk.n++ % 4) !== 0 && (!this.lock || this.lock.visible)) return this.lock ? pk.pull : 0;
    pk.n = 1;
    pk.o.copy(ray.origin); pk.d.copy(ray.direction); pk.fresh = true;
    pk.pull = this._pickNow(ray, L);
    return pk.pull;
  }

  _pickNow(ray, L) {
    const hit = L.pick(ray, 20);
    if (hit && hit.lizard) { this.lock = hit.lizard; return 1; }
    let best = null, bestS = 1;
    const o = ray.origin, d = ray.direction, h = this._h;
    for (const lz of L.all) {
      if (!lz.visible) continue;
      lz.headPosition(h);
      const tx = h.x - o.x, ty = h.y - o.y, tz = h.z - o.z;
      const t = tx * d.x + ty * d.y + tz * d.z;
      if (t < 0.5 || t > 20) continue;
      const px = tx - d.x * t, py = ty - d.y * t, pz = tz - d.z * t;
      const s = Math.sqrt(px * px + py * py + pz * pz) / (M.base + M.perMetre * t);
      const keep = lz === this.lock ? 0.75 : 1; // a little stickiness against flicker
      if (s * keep < bestS) { bestS = s * keep; best = lz; }
    }
    if (best) {
      // not through a trunk: a ray straight at its head must meet it
      best.headPosition(h);
      this._ray2.origin.copy(o);
      this._ray2.direction.copy(h).sub(o).normalize();
      const check = L.pick(this._ray2, o.distanceTo(h) + 0.5);
      if (!check || check.lizard !== best) best = null;
    }
    this.lock = best;
    return best ? Math.max(0, 1 - bestS) : 0;
  }

  // The best shown lizard in front of the player within maxDist (no pointer).
  _bestAhead(maxDist) {
    const L = this.game.lizards;
    if (!L) return null;
    const p = this.game.player.position, h = this.game.player.heading;
    const fx = -Math.sin(h), fz = -Math.cos(h);
    let best = null, bs = Infinity;
    for (const lz of L.all) {
      if (!lz.visible) continue;
      const dx = lz.pos.x - p.x, dz = lz.pos.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > maxDist || d < 0.3) continue;
      const c = (dx * fx + dz * fz) / d;
      if (c < 0.2) continue;
      const s = d * (1.6 - c);
      if (s < bs) { bs = s; best = lz; }
    }
    return best;
  }

  // Clamps a wanted loop centre (src) to what the pole can reach, into out.
  _clampReach(src, out) {
    const g = this.game, p = g.player.position;
    out.copy(src);
    let dx = out.x - p.x, dz = out.z - p.z;
    let h = Math.hypot(dx, dz);
    if (h > R.out) { dx *= R.out / h; dz *= R.out / h; h = R.out; }
    if (h < R.near) {
      if (h < 1e-3) { dx = -Math.sin(g.player.heading); dz = -Math.cos(g.player.heading); h = 1; }
      dx *= R.near / h; dz *= R.near / h; h = R.near;
    }
    let y = Math.min(out.y, p.y + R.top);
    // the sphere round the shoulder that the tip can reach
    const sy = p.y + R.shoulder;
    let ty = y + R.drop - sy;
    const d = Math.sqrt(h * h + ty * ty);
    if (d > R.radius) {
      const k = R.radius / d;
      dx *= k; dz *= k; ty *= k;
      y = sy + ty - R.drop;
    }
    out.x = p.x + dx; out.z = p.z + dz;
    const floor = Math.max(g.data.terrain.heightAt(out.x, out.z), 0) + R.floor;
    out.y = Math.max(y, floor);
    return out;
  }

  // ---------------------------------------------------------------- the pole and loop

  _tipFromAvatar() {
    const aim = this.avatar.aim, pl = this.game.player;
    if (!aim || !this._started) return;
    // tipOut is in the model frame of the heading it was drawn with
    const h = pl.object.rotation.y, c = Math.cos(h), s = Math.sin(h);
    const m = aim.tipOut;
    this._w.set(pl.position.x + m.x * c + m.z * s, pl.position.y + m.y, pl.position.z - m.x * s + m.z * c);
  }

  // The loop swings under the tip like a pendulum pushed by the tip's acceleration,
  // with a little hand tremor and breeze so it is never quite still.
  _pendulum(dt, t) {
    const sw = this.swing;
    const L = R.drop;
    const inv = dt > 1e-5 ? 1 / dt : 0;
    let ax = (this.tipVel.x - this._tipVelPrev.x) * inv, az = (this.tipVel.z - this._tipVelPrev.z) * inv;
    const cap = 30;
    ax = Math.max(-cap, Math.min(cap, ax)); az = Math.max(-cap, Math.min(cap, az));
    const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
    const k = GRAVITY / L, c = R.sway;
    const wob = this.hold ? 0.15 : 1;
    for (let i = 0; i < n; i++) {
      const tt = t + i * h;
      const fx = -ax + wob * (0.35 * Math.sin(tt * 1.7) + 0.2 * Math.sin(tt * 4.3 + 1));
      const fz = -az + wob * (0.28 * Math.sin(tt * 1.3 + 2) + 0.18 * Math.sin(tt * 3.7));
      sw.vx += (-k * sw.ux - c * sw.vx + fx) * h;
      sw.vz += (-k * sw.uz - c * sw.vz + fz) * h;
      sw.ux += sw.vx * h;
      sw.uz += sw.vz * h;
    }
    if (this.kick > 0) { // a comic wobble after a miss
      sw.vx += Math.sin(t * 23) * this.kick * 2.2 * dt * 60;
      sw.vz += Math.cos(t * 19) * this.kick * 2.2 * dt * 60;
      this.kick = Math.max(0, this.kick - dt * 1.4);
    }
    const r = Math.hypot(sw.ux, sw.uz), lim = L * 0.8;
    if (r > lim) { sw.ux *= lim / r; sw.uz *= lim / r; }
    // the loop's centre, for the game (what is drawn, within a frame)
    const tip = this._started ? this._w : this.tip;
    const s = this.snug;
    this._loopPrev.copy(this.loop);
    this.loop.set(tip.x + sw.ux * s, tip.y - Math.sqrt(Math.max(0, L * L - sw.ux * sw.ux - sw.uz * sw.uz)) * s, tip.z + sw.uz * s);
    const sp = inv * this.loop.distanceTo(this._loopPrev);
    this.loopSpeed += ((sp < 50 ? sp : 0) - this.loopSpeed) * Math.min(1, dt * 12);
  }

  _faceGoal(dt) {
    const pl = this.game.player;
    const dx = this.goal.x - pl.position.x, dz = this.goal.z - pl.position.z;
    if (dx * dx + dz * dz < 0.09) return;
    const want = headingTo(dx, dz);
    pl.heading = wrapAngle(pl.heading + wrapAngle(want - pl.heading) * Math.min(1, dt * 9 * this.weight));
    pl.object.rotation.y = pl.heading;
  }

  _writeAvatar() {
    const aim = this.avatar.aim, pl = this.game.player;
    if (!aim) return;
    const h = pl.heading, c = Math.cos(h), s = Math.sin(h);
    const x = this.tip.x - pl.position.x, z = this.tip.z - pl.position.z;
    // world to the model frame: rotate by -heading
    aim.tip.set(x * c - z * s, this.tip.y - pl.position.y, x * s + z * c);
    const L = R.drop;
    const ux = this.swing.ux * c - this.swing.uz * s, uz = this.swing.ux * s + this.swing.uz * c;
    aim.swingZ = Math.asin(Math.max(-0.95, Math.min(0.95, ux / L)));
    aim.swingX = -Math.asin(Math.max(-0.95, Math.min(0.95, uz / L)));
    aim.snug = this.snug;
    aim.weight = this.weight;
  }

  // Fast loop moves near a lizard's face startle it; a hit sends it running.
  _startle(dt) {
    const L = this.game.lizards;
    this._aimT += dt;
    this._bopT = Math.max(0, this._bopT - dt);
    // not while the pole is going up and the camera easing in: only the player's own
    // sweeps of the loop count
    const rig = this.game.rig;
    if (!L || this.hold || !this._precise || this.weight < 0.95 || this._aimT < 0.7 || (rig && rig.aimK < 0.9)) return;
    const v = this.loopSpeed;
    if (v <= S.safe) return;
    const h = this._h;
    for (const lz of L.all) {
      if (!lz.visible || lz.state === 'frozen' || lz.state === 'flee') continue;
      lz.headPosition(h);
      const d = h.distanceTo(this.loop);
      if (d > S.radius) continue;
      if (v > S.bop && d < S.bopRadius && this._bopT <= 0) {
        if (lz.bolt(this.loop.x, this.loop.z)) {
          this._bopT = 0.6;
          this.game.events.emit('pole:bop', { lizard: lz });
        }
        continue;
      }
      const f = 1 - d / S.radius;
      lz.threat += S.gain * (v - S.safe) * f * f * dt;
    }
  }

  _use() {
    const lz = this.lock;
    if (this.ready && lz && this.onSnug) {
      this.onSnug(lz, { display: lz.display, state: lz.state });
      return;
    }
    // lock-on: a click while the loop is still gliding over waits for it
    if (!this._precise && lz && this.reachable) { this._queued = lz; this._queueT = LK.queue; return; }
    this.kick = Math.max(this.kick, 0.35);
    const why = lz ? (this.reachable ? 'aim' : this.why) : !this._precise && this.lead ? this.leadWhy : 'empty';
    this.game.events.emit('pole:whiff', { lizard: lz || (!this._precise && this.lead) || null, why });
  }

  _waitQueued(dt) {
    const lz = this._queued;
    this._queueT -= dt;
    if (lz !== this.lock || this.hold || this._queueT <= 0) { this._queued = null; return; }
    if (this.ready && this.onSnug) {
      this._queued = null;
      this.onSnug(lz, { display: lz.display, state: lz.state });
    }
  }

  // The catch in hand: the loop settles round lz's head; then snap(success).
  holdOn(lz) {
    this.hold = lz;
    this.snug = 1;
    this.yank = 0;
    if (this.game.rig) this.game.rig.aimFov = 22; // lean in for the snug
  }

  // Success: the loop snugs and the pole lifts; a miss: the loop wobbles comically.
  async snap(success) {
    const lz = this.hold;
    if (success) {
      await this._tween(0.14, (k) => { this.snug = 1 - 0.55 * k; });
      // the pole lifts it off its perch, dangling in the loop
      const y0 = lz && lz.pos ? lz.pos.y : 0;
      await this._tween(0.3, (k) => {
        this.yank = k * k;
        if (lz && lz.pos) lz.pos.y = y0 + this.yank * 0.55;
      });
    } else {
      this.kick = 1;
      await this._tween(0.3, (k) => { this.snug = 1 + 0.25 * Math.sin(k * Math.PI); });
    }
    return lz;
  }

  letGo() {
    this.hold = null;
    this.snug = 1;
    this.yank = 0;
    if (this.game.rig) this.game.rig.aimFov = null;
  }

  _tween(sec, fn) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / (sec * 1000));
        fn(k);
        if (k >= 1) resolve(); else setTimeout(step, 16);
      };
      step();
    });
  }

  // ---------------------------------------------------------------- the reach ring

  _buildRing() {
    const geo = new THREE.RingGeometry(R.out - 0.08, R.out + 0.06, 96, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uColour: { value: new THREE.Color('#fff6dc') }, uAlpha: { value: 0 } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uTime; uniform vec3 uColour; uniform float uAlpha; varying vec3 vP;
        void main(){
          float a = atan(vP.z, vP.x) / 6.2831853 * 40.0 + uTime * 0.6;
          float dash = smoothstep(0.18, 0.28, fract(a)) * (1.0 - smoothstep(0.62, 0.72, fract(a)));
          gl_FragColor = vec4(uColour, dash * uAlpha);
        }`,
    });
    this.ring = new THREE.Mesh(geo, mat);
    this.ring.name = 'loop-pole-reach';
    this.ring.renderOrder = 3;
    this.ring.frustumCulled = false;
    this.ring.visible = false;
    this.group = new THREE.Group();
    this.group.name = 'loop-pole';
    this.group.add(this.ring);
  }

  _placeRing() {
    const p = this.game.player.position;
    this.ring.visible = !this.hold && this.weight > 0.05;
    this.ring.position.set(p.x, p.y + 0.08, p.z);
    const u = this.ring.material.uniforms;
    u.uTime.value = this.game.time;
    u.uAlpha.value = 0.75 * this.weight;
  }

  // ---------------------------------------------------------------- the overlay

  _buildOverlay() {
    const root = document.getElementById('ui') || document.body;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'loop-pole-overlay');
    // drawn in the canvas's pixels and stretched with it (preserveAspectRatio none),
    // so it stays on the lizards if the page is resized under it
    svg.setAttribute('preserveAspectRatio', 'none');
    let alts = '';
    for (let i = 0; i < ALTS; i++) alts += '<circle class="loop-pole-alt" r="11" cx="0" cy="0"/>';
    svg.innerHTML = '<line class="loop-pole-tether" x1="0" y1="0" x2="0" y2="0"/>' +
      '<circle class="loop-pole-pointer" r="6" cx="0" cy="0"/>' + alts +
      '<g class="loop-pole-target"><circle class="loop-pole-target-ring" r="26" cx="0" cy="0"/><circle class="loop-pole-target-core" r="26" cx="0" cy="0"/></g>';
    root.appendChild(svg);
    const label = document.createElement('div');
    label.className = 'loop-pole-label';
    label.innerHTML = '<span></span>';
    root.appendChild(label);
    this.ov = {
      svg, label, labelText: label.firstChild, w: 0, h: 0,
      tether: svg.querySelector('.loop-pole-tether'),
      pointer: svg.querySelector('.loop-pole-pointer'),
      target: svg.querySelector('.loop-pole-target'),
      ring: svg.querySelector('.loop-pole-target-ring'),
      alts: [...svg.querySelectorAll('.loop-pole-alt')].map((el) => ({ el, x: -1, y: -1, on: false })),
      on: false, state: '', text: '', tx: -1, ty: -1, px: -1, py: -1, lx: -1, ly: -1, r: 0,
    };
    this._showOverlay(false);
  }

  _showOverlay(on) {
    const o = this.ov;
    if (o.on === on) return;
    o.on = on;
    o.svg.classList.toggle('is-on', on);
    if (!on) { o.label.classList.remove('is-on'); o.state = null; o.text = ''; }
  }

  // world point -> canvas pixels in out {x, y}; false when behind the camera
  _screen(v, out) {
    const q = this._q.copy(v).project(this.game.camera);
    out.x = (q.x + 1) * 0.5 * this.ov.w;
    out.y = (1 - q.y) * 0.5 * this.ov.h;
    return q.z < 1;
  }

  _drawOverlay() {
    const o = this.ov;
    const show = this.weight > 0.4 && !this.hold;
    this._showOverlay(show);
    if (!show) return;
    const el = this.game.renderer.domElement;
    if (el.clientWidth !== o.w || el.clientHeight !== o.h) {
      o.w = el.clientWidth; o.h = el.clientHeight;
      o.svg.setAttribute('viewBox', `0 0 ${o.w} ${o.h}`);
      o.tx = o.px = o.lx = -1;
    }
    const s = this._scr || (this._scr = { x: 0, y: 0 });
    // the target ring round the locked lizard's head (or, in lock-on with none in
    // reach, round the one the prompt points at)
    let state = '';
    const lockOn = !this._precise;
    let tg = this.lock, head = this.lockHead;
    if (!tg && lockOn && this.lead) { tg = this.lead; head = this._leadHead; tg.headPosition(head); }
    if (tg && tg.visible && this._screen(head, s)) {
      if (!lockOn) state = this.ready ? (tg.display ? 'show' : 'ready') : this.reachable ? 'near' : this.why || 'far';
      else if (tg === this.lock) state = this.ready ? (tg.display ? 'show' : 'ready') : 'lock';
      else state = this.leadWhy === 'high' && this.spotted(tg) ? 'spotted' : this.leadWhy || 'far';
      const dist = this.game.camera.position.distanceTo(head);
      const r = Math.max(24, Math.min(54, 80 / Math.max(0.5, dist) + 14));
      if (Math.abs(s.x - o.tx) + Math.abs(s.y - o.ty) > 0.4 || Math.abs(r - o.r) > 0.4) {
        o.tx = s.x; o.ty = s.y; o.r = r;
        o.target.setAttribute('transform', `translate(${s.x.toFixed(1)} ${s.y.toFixed(1)})`);
        o.ring.setAttribute('r', r.toFixed(1));
        o.label.style.left = (s.x / o.w * 100).toFixed(3) + '%';
        o.label.style.top = ((s.y + r + 8) / o.h * 100).toFixed(3) + '%';
      }
    }
    if (state === 'show' && tg.display !== o.shown) { o.state = null; o.shown = tg.display; }
    if (state !== o.state || lockOn !== o.lockOn) {
      o.state = state;
      o.lockOn = lockOn;
      const cls = state === 'spotted' ? 'high' : state;
      o.target.setAttribute('class', 'loop-pole-target' + (cls ? ' is-' + cls : ''));
      const text = lockOn ? (state === 'show' ? SHOW_LOCK[tg.display] || LOCK_WORDS.ready : LOCK_WORDS[state] || '')
        : state === 'high' ? 'Too high to reach' : state === 'far' ? 'Step closer' : state === 'behind' ? 'Round the back'
          : state === 'ready' ? 'Now!' : state === 'show' ? SHOW_WORDS[tg.display] || 'Now!' : '';
      if (text !== o.text) { o.text = text; o.labelText.textContent = text; }
      o.label.className = 'loop-pole-label' + (text ? ' is-on is-' + cls : '');
    }
    this._drawAlts(lockOn && this.lock ? this.lock : null);
    // the pointer and a dotted tether to the loop when the loop cannot follow it
    const ray = !lockOn && this.pointer.seen && this._aimFromPointer && !this.aimRay;
    const l = this._scr2 || (this._scr2 = { x: 0, y: 0 });
    let tether = false;
    if (ray && this._screen(this.loop, l)) {
      const px = (this.pointer.x + 1) * 0.5 * o.w, py = (1 - this.pointer.y) * 0.5 * o.h;
      tether = Math.hypot(px - l.x, py - l.y) > 26;
      if (Math.abs(px - o.px) + Math.abs(py - o.py) > 0.4) {
        o.px = px; o.py = py;
        o.pointer.setAttribute('cx', px.toFixed(1)); o.pointer.setAttribute('cy', py.toFixed(1));
        o.tether.setAttribute('x2', px.toFixed(1)); o.tether.setAttribute('y2', py.toFixed(1));
      }
      if (Math.abs(l.x - o.lx) + Math.abs(l.y - o.ly) > 0.4) {
        o.lx = l.x; o.ly = l.y;
        o.tether.setAttribute('x1', l.x.toFixed(1)); o.tether.setAttribute('y1', l.y.toFixed(1));
      }
    }
    o.svg.classList.toggle('has-tether', tether);
    o.svg.classList.toggle('has-pointer', ray);
  }

  // small rings on the other lizards in reach (Tab, the wheel or a flick moves to them)
  _drawAlts(lock) {
    const alts = this.ov.alts, c = this._cands, s = this._scr3 || (this._scr3 = { x: 0, y: 0 }), h = this._h2;
    let k = 0;
    if (lock) {
      for (let i = 0; i < c.length && k < alts.length; i++) {
        if (c[i] === lock || !c[i].visible) continue;
        c[i].headPosition(h);
        if (!this._screen(h, s)) continue;
        const a = alts[k++];
        if (!a.on) { a.on = true; a.el.classList.add('is-on'); }
        if (Math.abs(s.x - a.x) + Math.abs(s.y - a.y) > 0.4) {
          a.x = s.x; a.y = s.y;
          a.el.setAttribute('cx', s.x.toFixed(1)); a.el.setAttribute('cy', s.y.toFixed(1));
        }
      }
    }
    for (; k < alts.length; k++) if (alts[k].on) { alts[k].on = false; alts[k].el.classList.remove('is-on'); }
  }

  // lock-on's hint line, rebuilt only when what it says changes
  _lockHints() {
    const lz = this.lock, lead = this.lead;
    const more = this._cands.length > 1 ? 1 : 0; // others in reach: a tap on Tab
    const out = this._leads.length > (lz ? 0 : 1) && !this.quiet() ? 1 : 0; // others out of reach: a held Tab
    const t = lz || lead;
    const sp = t ? SP_INDEX[t.species] ?? 8 : 9;
    const why = lz ? (this.ready ? 1 : 2) : lead ? 3 + (WHY_INDEX[this.leadWhy] ?? 5) : 0;
    const back = this._leadPin && this._cands.length ? 1 : 0; // moved out of reach with some in reach
    const flags = more + out * 2 + (lead && this.leadWhy === 'high' && this.spotted(lead) ? 4 : 0) + back * 8;
    const key = why * 10000 + sp * 100 + flags;
    if (key === this._hintKey) return;
    this._hintKey = key;
    let h;
    if (lz) {
      h = `[Click] or [E] to loop the *${common(lz)}*`;
      if (more) h += '. [Tab]: the next one';
      if (out) h += more ? ', hold [Tab]: one out of reach' : '. Hold [Tab]: one out of reach';
    } else if (!lead) h = 'No lizard in reach. Look round, then creep up on one';
    else {
      if (this.leadWhy === 'far') h = `*Get closer* to the ${common(lead)}. Hold [Ctrl] to creep`;
      else if (this.leadWhy === 'high') h = this.spotted(lead) ? 'Too high to catch. Spotted, though!' : 'Too high to catch: hold the aim to *spot* it';
      else if (this.leadWhy === 'behind') h = 'It\'s round the back of the trunk. Circle round, slowly';
      else if (this.leadWhy === 'hidden') h = `The *${common(lead)}* is out of sight. Step round for a clear view`;
      else if (this.leadWhy === 'spot') h = 'No catching till survey day. Hold the aim on it to *spot* it';
      else if (this.leadWhy === 'croc') h = 'An American *crocodile*! Hold the aim to spot it from here';
      else if (this.leadWhy === 'crocClose') h = 'Too close to the *crocodile*! Back away, then spot it';
      else h = `Turn to face the ${common(lead)}`;
      if (back) h += '. [Tab]: back to one in reach';
      else if (out && this.leadWhy !== 'croc' && this.leadWhy !== 'crocClose') h += '. Hold [Tab]: another';
    }
    if (h !== this._wantHint) { this._wantHint = h; this.hint(h); }
  }

  _hints() {
    if (!this._precise && !this.hold) { this._lockHints(); return; }
    let h;
    if (this.hold) h = null;
    else if (this.ready && !this.canCatch(this.lock)) h = 'No catching till survey day. Hold the aim on it to *spot* it';
    else if (this.ready) h = '[Click] or [E] to slip the loop over its head';
    else if (this.lock && this.why === 'high') h = 'Too high for the pole. Keep aiming at it to *spot* it';
    else if (this.lock && this.why === 'far') h = 'Out of reach: step a little closer';
    else if (this.lock && this.why === 'behind') h = 'It\'s round the back of the trunk. Circle round, slowly';
    else if (this.lock) h = 'Ease the loop over its head. Slowly does it!';
    else h = 'Move the loop onto a lizard\'s head';
    if (h !== this._wantHint) { this._wantHint = h; this.hint(h); }
  }

  // the point the aim camera leans to (the lizard the loop settled on), and that lizard
  get framePoint() { return this._camPoint; }
  get framed() { return this._camLock; }

  get stats() {
    return {
      aiming: this.aiming, mode: this._precise ? 'precise' : 'lock', weight: +this.weight.toFixed(2), lock: this.lock ? this.lock.species : null,
      ready: this.ready, reachable: this.reachable, why: this.why, lead: this.lead ? this.lead.species || 'crocodile' : null, leadWhy: this.leadWhy,
      inReach: this._cands.length, loopSpeed: +this.loopSpeed.toFixed(2),
    };
  }
}
