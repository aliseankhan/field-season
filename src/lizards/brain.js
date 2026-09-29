// One lizard's life: idle (basking, looking round, head bobs, push-ups, dewlap flashes,
// bug snaps; the renderer adds blinks and tail flicks), noticing the player, alert
// (freeze, turn to watch, maybe a dewlap at the player), fleeing in its species' style,
// hiding (a trunk lizard peeks round now and then) and coming back. Displays are shown
// side on to a nearby player, and each alert that ends without a flight makes the
// lizard a little bolder (habit), so stopping while it watches is how to get close.
//
// A Lizard belongs to one spawn and keeps its tag and backpack for the whole session;
// while it is near the player it holds a render handle and two route buffers from the
// pool in lizards.js. Every frame it writes plain numbers into the handle.

import { SPECIES_INFO, AWARENESS as A, THERMAL, makeRng } from './species.js';
import { SURF, SURF_NAME, Route, swayOffset } from './perches.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const len2 = (x, z) => Math.sqrt(x * x + z * z);
const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;
const expRate = (rate, dt) => 1 - Math.exp(-rate * dt);
const nextIn = (rng, perMinute) => (perMinute > 0 ? -Math.log(1 - rng() * 0.999) * 60 / perMinute : 1e9);

// scratch
const _d = { bob: 0, pushup: 0, dewlap: 0 };
const _tw = { x: 0, y: 0, z: 0, a: 0 }; // turnTowards' direction and step
const _p = { x: 0, y: 0, z: 0 }, _n = { x: 0, y: 1, z: 0 }, _t = { x: 1, y: 0, z: 0 }, _i = { w: 0, fl: 0, surf: 0 }, _o = { x: 0, y: 0, z: 0 };
const _away = { px: 0, pz: 0 }; // a fright's origin, in the shape of the shared context
const _hid = { x: 0, y: 0, z: 0, away: false }; // where a lizard went out of sight (lizard:hidden)
const REST_TILT = 0.44; // bark lizards rest up to about 25 degrees off the vertical

export class Lizard {
  constructor(sys, index, spawn, perch) {
    this._sys = sys;
    this.index = index;
    this.species = spawn.sp;
    this.sex = spawn.sex;
    this.perch = spawn.perch; // the recorded perch class
    this.info = SPECIES_INFO[spawn.sp];
    this.home = perch;
    this.state = 'inactive';
    this.display = null; // null, 'headbob', 'pushup', 'dewlap'
    this.tag = null; // free for the notebook
    this.backpack = null;
    this.captured = false;
    this.handle = null;
    this.slot = null; this.esc = null; this.ret = null; // from the pool while active
    this.homeOnReturn = false;
    this.tame = false; // ignores the player (?lizard= screenshots)
    this.calm = 0; // over 0: the threat is capped there unless the player runs (the opening's practice lizard)
    const rng = makeRng(0x9e3779b1 ^ (index * 2654435761));
    this.rng = rng;
    this.scale = 0.92 + 0.16 * rng();
    this.headDown = rng() < this.info.headDown;
    this.male = spawn.sex === 'm';
    // the drawn size: females are smaller (the renderer's factor when it gives one)
    const fem = sys.sizeOf ? sys.sizeOf(spawn.sp) : 0.85;
    this.length = this.info.length * this.scale * (spawn.sex === 'm' ? 1 : spawn.sex === 'f' ? fem : fem + (1 - fem) * 0.35);
    // pose on the surface (without sway), and the smoothed frame the model is drawn in
    this.pos = { x: perch.x, y: perch.y, z: perch.z };
    this.nrm = { x: perch.nx, y: perch.ny, z: perch.nz };
    this.fwd = { x: perch.fx, y: perch.fy, z: perch.fz };
    this.upS = { x: perch.nx, y: perch.ny, z: perch.nz };
    this.fwdS = { x: perch.fx, y: perch.fy, z: perch.fz };
    this.surf = perch.mode;
    this.w = perch.w; this.fl = perch.fl;
    this.away = false; // hidden out of sight (in foliage, under a bush)
    this.exposure = 0.5;
    this.expT = rng() * 5;
    // the sun and the time of day (setMood): basking, too hot, looking for sun, how
    // shaded (0..1) and the day's warmth, and what they do to displays, flight and pose
    this.mood = { bask: false, hot: false, cold: false, night: false, shade: 0, warmth: 0, display: 1, fid: 1, flatten: 0 };
    this.threat = 0; this.dist = 99; this.fid = 0;
    this.wary = 0;
    this.habit = 1; // bolder (down to AWARENESS.habit.floor) after each alert that settles
    this.restTilt = (rng() * 2 - 1) * REST_TILT;
    if (perch.headDown === 1) this.headDown = true; // head up would dip its tail in the lake
    else if (perch.headDown === -1) this.headDown = false;
    this.homePose = true;
    this.homeDroop = perch.droop || 0; this.homeDroopAt = perch.droopAt || 0; // read every frame
    this.show = 1; // drawn opacity: fades out over 0.15 s as it slips out of sight
    this.sleep = 0;
    this.tailDroop = 0;
    this._resetAnim();
  }

  _resetAnim() {
    this.gait = 0; this.gaitPhase = 0;
    this.headYaw = 0; this.headPitch = 0; this.hyT = 0; this.hpT = 0;
    this.bob = 0; this.pushup = 0; this.dewlap = 0; this.tailCurl = 0; this.flatten = 0; this.gape = 0;
    this.tint = 0;
    this.act = null; this.actT = 0; this.actD = 0; this.shuffleA = 0;
    const r = this.rng, I = this.info;
    this.tDisplay = nextIn(r, I.display[this.male ? 'm' : 'f']) * 0.5;
    this.tSnap = nextIn(r, I.snap); this.tShuffle = nextIn(r, I.shuffle);
    this.tLook = r() * 2;
    this.stateT = 0; this.calmT = 0; this.cornerT = 0; this.gaped = false;
    this.route = null; this.along = 0; this.speed = 0;
    this.hideT = 0; this.hideFor = 0; this.adjustCd = 0;
    this.peek = 0; this.peekT = 0; this.nextPeek = 1e9; this.holdFlat = false;
    this.side = false; // turning side on to the player for a display
    // moving for the sun or the shade: null, 'sun', 'shade' (round the trunk) or
    // 'shelter' (off into cover until the heat passes); shelter is true while it waits
    this.thermal = null; this.shelter = false; this.calmReturn = false;
    this.thermalCd = 2 + 4 * r();
  }

  // ---------------------------------------------------------------- hooks

  // Head position in the world (for the loop pole, the camera and look-at).
  headPosition(v) {
    if (this.handle && this.handle.headPosition) return this.handle.headPosition(v);
    const L = this.length, u = this.upS, f = this.fwdS;
    swayOffset(this.pos.x, this.pos.y, this.pos.z, this.w, this.fl, _o);
    return v.set(
      this.pos.x + _o.x + u.x * 0.07 * L + f.x * 0.24 * L,
      this.pos.y + _o.y + u.y * 0.07 * L + f.y * 0.24 * L,
      this.pos.z + _o.z + u.z * 0.07 * L + f.z * 0.24 * L,
    );
  }

  // Holds the lizard still (the loop snug round its neck); unfreeze() lets it go on.
  freeze() {
    if (this.state === 'captured' || this.state === 'inactive') return;
    this.state = 'frozen';
    this.gait = 0;
    this.display = null; this.act = null;
    this.route = null; this.thermal = null; // held where it is, not walking for the sun
  }

  unfreeze() {
    if (this.state !== 'frozen') return;
    this.state = 'alert';
    this.stateT = 0; this.calmT = 0;
  }

  // Out of the world; true when it was taken (false when already captured).
  capture() { return this._sys.capture(this); }

  // Back on its perch, wary for a while; from (x, y, z) when given (it runs home).
  // False when there was no free slot to put it in.
  release(x, y, z) { return this._sys.release(this, x, y, z); }

  // Bolts for cover from a sudden fright at (x, z), such as a croc's snap nearby.
  bolt(x, z) {
    const st = this.state;
    if (!this.handle || this.tame || (st !== 'idle' && st !== 'alert' && st !== 'return')) return false;
    _away.px = x; _away.pz = z;
    this.wary = A.waryTime;
    this._flee(_away);
    return true;
  }

  // A number (0xrrggbb) or any CSS colour string, converted once here.
  setBackpack(colour) {
    this.backpack = colour == null ? null : typeof colour === 'number' ? colour : this._sys.colourNumber(colour);
    if (this.handle) this.handle.backpack = this.backpack;
  }

  get visible() { return !!this.handle && !this.away && this.state !== 'captured'; }

  // What it is on now: bark, branch, leaf, ground or log.
  get surface() { return SURF_NAME[this.surf]; }

  // ---------------------------------------------------------------- activation

  // Takes a render handle and routes; starts at home, or out of sight when the player
  // is looking straight at the spot (it then walks out into view). With thermal (not
  // for a pinned lizard) one out of view starts where the sun would have sent it: round
  // its trunk into the sun or the shade, or sheltering from the heat out of sight.
  activate(handle, routes, C, sneakIn, thermal = true) {
    this.handle = handle;
    this.esc = routes[0]; this.ret = routes[1];
    this._resetAnim();
    this.goHome();
    this.state = 'idle';
    this.tint = this.species === 'carolinensis' && this.mood.night ? 0.4 : 0;
    this.sleep = this.mood.night ? 1 : 0;
    if (sneakIn && C) {
      this._planEscape(C);
      if (this.esc.count > 1) {
        this.esc.sample(this.esc.length, _p, _n, _t, _i);
        this._setPose(_p, _n, _t, _i, true);
        this.away = this.esc.vanish;
        this.state = 'hidden';
        this.hideFor = 0.6 + 2.5 * this.rng();
        this.hideT = 0;
        if (thermal && this.mood.hot && this.away) this.shelter = true; // it waits for the heat to pass
      }
    } else if (thermal && C && (this.mood.hot || this.mood.cold) && this._thermalPlan(C)) {
      // already there: the end of the move, at once
      const r = this.route;
      r.sample(r.length, _p, _n, _t, _i);
      this._setPose(_p, _n, _t, _i, true);
      this._thermalArrived(false);
    }
    this.show = this.away ? 0 : 1;
    this._write(0);
  }

  deactivate() {
    this.handle = null;
    this.esc = this.ret = null;
    this.route = null;
    if (this.state !== 'captured') this.state = 'inactive';
    this.display = null;
  }

  goHome() {
    const h = this.home;
    this.pos.x = h.x; this.pos.y = h.y; this.pos.z = h.z;
    this.nrm.x = h.nx; this.nrm.y = h.ny; this.nrm.z = h.nz;
    this.fwd.x = h.fx; this.fwd.y = h.fy; this.fwd.z = h.fz;
    if (h.mode === SURF.BARK) {
      if (this.headDown) { this.fwd.x = -h.fx; this.fwd.y = -h.fy; this.fwd.z = -h.fz; }
      rotateAbout(this.fwd, this.nrm, this.restTilt);
    }
    this.upS.x = h.nx; this.upS.y = h.ny; this.upS.z = h.nz;
    this.fwdS.x = this.fwd.x; this.fwdS.y = this.fwd.y; this.fwdS.z = this.fwd.z;
    this.surf = h.mode; this.w = h.w; this.fl = h.fl;
    this.away = false;
    this.route = null;
    this.homePose = true;
    this.thermal = null; this.shelter = false;
  }

  // ---------------------------------------------------------------- per frame

  update(dt, t, C) {
    if (!this.handle) return;
    this.stateT += dt;
    if (this.wary > 0) this.wary -= dt;
    if (this.adjustCd > 0) this.adjustCd -= dt;
    if (this.habit < 1) this.habit = Math.min(1, this.habit + (1 - this.habit) * dt / A.habit.recover + 1e-4 * dt);
    this._aware(dt, C);
    const I = this.info;
    if (this.thermalCd > 0) this.thermalCd -= dt;
    switch (this.state) {
      case 'idle':
        if (this.threat >= 1) this._startFlee(C);
        else if (this.threat >= 1 / I.alertRatio) this._startAlert(C);
        else if (this.route && this._follow(dt, this.speed)) this._thermalArrived(true); // a move for sun or shade
        break;
      case 'alert':
        if (this.cornerT > 0) {
          this.cornerT -= dt;
          if (this.cornerT <= 0) this._flee(C);
        } else if (this.threat >= 1) {
          this._startFlee(C);
        } else if (this.threat < A.calmAt) {
          this.calmT += dt;
          if (this.calmT > A.calmTime) this._settle();
        } else {
          this.calmT = 0;
        }
        break;
      case 'flee':
        if (this._follow(dt, this.speed)) this._arrivedHidden(C);
        break;
      case 'hidden': {
        this.hideT += dt;
        if (this.route) { // shuffling round the trunk, or peeking
          if (this._follow(dt, this.speed)) {
            this.route = null; this.adjustCd = 0.5;
            if (this.peek === 1) { this.peek = 2; this.peekT = 1.2 + 0.8 * this.rng(); } else if (this.peek === 3) this.peek = 0;
          }
        } else if (!this.away && this.surf === SURF.BARK) {
          if (this.peek === 2) {
            this.peekT -= dt;
            if (this.peekT <= 0) this._peekRoute(C, 3);
          } else if (this.hideT > this.nextPeek && this.dist < 7 && this.threat < 0.8 && Number.isFinite(this.home.ax)) {
            this._peekRoute(C, 1);
          } else {
            this._keepBehind(C);
          }
        }
        const clear = C.speed < 0.1 ? A.returnClearStill : A.returnClear;
        // one sheltering from the heat comes out once the day cools
        const due = this.shelter ? C.warmth < THERMAL.comeOut && this.hideT > 4 : this.hideT > this.hideFor;
        if (!this.route && this.peek === 0 && due && this.dist > clear && this.threat < 0.4) this._startReturn();
        break;
      }
      case 'return':
        if (this.threat >= 1) { this._startFlee(C); break; }
        if (this._follow(dt, this.speed)) {
          this.route = null;
          this.state = 'idle'; this.stateT = 0;
          this.wary = this.calmReturn ? 0 : A.waryTime; // back from the shade it was never scared
          this.calmReturn = false;
          if (this._atHome()) this.goHome();
          else this._restPose();
        }
        break;
      default:
        break;
    }
    this._animate(dt, t, C);
    this._write(dt);
  }

  // An alert lizard that was not pushed into running settles, a little bolder than
  // before, and often gives a head bob as it does.
  _settle() {
    this.state = 'idle'; this.stateT = 0; this.gaped = false;
    this.habit = Math.max(A.habit.floor, this.habit * A.habit.step);
    if (!this.mood.night && !this.act && this.rng() < A.settleBob) {
      this._startDisplay('headbob', this._sys.displayLength ? this._sys.displayLength(this.species, 'headbob') : 1.5);
    }
  }

  _aware(dt, C) {
    const dx = this.pos.x - C.px, dz = this.pos.z - C.pz;
    const dh = len2(dx, dz);
    this.dist = dh;
    let threat = 0;
    if (!this.tame && this.state !== 'frozen' && this.state !== 'captured') {
      const I = this.info;
      const above = this.pos.y - C.py;
      const ay = 0.5 * Math.max(0, above - 1.2);
      const d = Math.sqrt(dh * dh + ay * ay);
      const ux = dh > 1e-4 ? dx / dh : 0, uz = dh > 1e-4 ? dz / dh : 0;
      const approach = C.speed < 0.1 ? A.still : A.approach[0] + A.approach[1] * clamp((C.vx * ux + C.vz * uz) / C.speed, -1, 1);
      const facing = A.facing[0] + A.facing[1] * (C.fx * ux + C.fz * uz);
      let sight = 1;
      const surf = this.surf;
      if (surf === SURF.BARK) {
        const nh = len2(this.nrm.x, this.nrm.z);
        if (nh > 0.3 && (this.nrm.x * -ux + this.nrm.z * -uz) / nh < -0.2) sight = A.unseen;
      } else {
        // on an open perch, coming up behind it is worth something
        const f = this.fwdS, fh = len2(f.x, f.z);
        if (fh > 0.3) sight = A.behind[0] + A.behind[1] * Math.max(0, -(f.x * ux + f.z * uz) / fh);
      }
      if (this.away) sight = A.unseen;
      const height = 1 / (1 + A.heightK * Math.max(0, above - A.heightFree));
      // the mood with the sight: a basking or hot lizard is a little warier, but never
      // jumpier than a calm one watching the player come straight at it
      const mood = Math.min(1, sight * this.mood.fid);
      let fid = (surf === SURF.GROUND ? I.fid.ground : I.fid.perch) * C.noiseF * approach * facing * mood * height * this.habit;
      if (this.wary > 0) fid *= A.wary;
      if (this.state === 'alert') fid *= I.sensitise;
      this.fid = fid;
      threat = fid / Math.max(d, 0.05);
      // a calm lizard (the opening's practice catch) may stop and watch, but only a run bolts it
      if (this.calm > 0 && C.noise < 0.75) threat = Math.min(threat, this.calm);
    }
    this.threat += (threat - this.threat) * expRate(threat > this.threat ? A.rise : A.fall, dt);
  }

  _startAlert(C) {
    this.state = 'alert';
    this.stateT = 0; this.calmT = 0;
    this.act = null; this.display = null;
    this.route = null; this.thermal = null; // a move for sun or shade stops where it is
    this._sys.emit('lizard:alert', this);
    // sometimes a dewlap at the player, mostly males
    if (this.rng() < this.info.alertDisplay[this.male ? 'm' : 'f'] * (this.mood.night ? 0 : 1)) this._startDisplay('dewlap', 1.8 + this.rng());
  }

  _startFlee(C) {
    const I = this.info;
    if (I.cornered && !this.gaped && this.dist < I.cornered) {
      // a knight anole stands its ground first: gape and the big pink dewlap
      if (this.state !== 'alert') { this.state = 'alert'; this._sys.emit('lizard:alert', this); }
      this.route = null; this.thermal = null;
      this.gaped = true;
      this.cornerT = 1.8 + 0.8 * this.rng();
      this.stateT = 0;
      this._startDisplay('dewlap', this.cornerT);
      return;
    }
    this._flee(C);
  }

  _flee(C) {
    this.act = null; this.display = null; this.cornerT = 0; this.side = false;
    this.habit = 1;
    this.peek = 0; this.holdFlat = false;
    this.thermal = null; this.shelter = false; this.calmReturn = false;
    this._planEscape(C);
    this.state = 'flee';
    this.stateT = 0;
    this._sys.emit('lizard:flee', this);
    if (this.esc.count < 2) { this.route = null; this._arrivedHidden(C); return; }
    this.route = this.esc; this.along = 0;
    // quick, but never over in a blink: a short dash takes at least 0.7 s
    const sp = this.info.speed * (0.9 + 0.2 * this.rng());
    this.speed = Math.min(sp, Math.max(0.15, this.esc.length / 0.7));
  }

  _arrivedHidden(C) {
    this.route = null;
    this.away = this.esc.vanish;
    this.state = 'hidden';
    this.stateT = 0; this.hideT = 0;
    const h = this.info.hide;
    // it lies low longer in the heat of the day
    this.hideFor = this.homeOnReturn ? 2 + this.rng() : (h[0] + (h[1] - h[0]) * this.rng()) * (1 + THERMAL.hideLonger * this.mood.warmth);
    this.nextPeek = this.homeOnReturn ? 1e9 : A.peekAt * this.hideFor;
    this.peek = 0;
    this.gait = 0;
    if (!this.away) this._restPose();
    _hid.x = this.pos.x; _hid.y = this.pos.y; _hid.z = this.pos.z; _hid.away = this.away;
    this._sys.emit('lizard:hidden', this, _hid);
  }

  // Peeking round the trunk from hiding: phase 1 edges round until its head shows past
  // the side of the trunk, phase 3 slips back behind it (phase 2, the look, is the wait
  // between, with the head turned to the player).
  _peekRoute(C, phase) {
    const H = this.home;
    const rx = this.pos.x - H.ax, rz = this.pos.z - H.az;
    const rl = len2(rx, rz) || 1;
    const th0 = Math.atan2(rz, rx);
    const behind = Math.atan2(C.pz - H.az, C.px - H.ax) + Math.PI;
    let off = th0 - behind;
    off = Math.atan2(Math.sin(off), Math.cos(off));
    const sg = off >= 0 ? 1 : -1;
    const want = behind + sg * (phase === 1 ? 1.15 : 0.2);
    let d = want - th0;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.peek = phase;
    if (phase === 3) this.nextPeek = this.hideT + 3 + 3 * this.rng();
    if (Math.abs(d) < 0.05) { if (phase === 1) { this.peek = 2; this.peekT = 1.2 + 0.8 * this.rng(); } else this.peek = 0; return; }
    const r = this.ret.reset();
    r.push(this.pos.x, this.pos.y, this.pos.z, this.nrm.x, this.nrm.y, this.nrm.z, this.w, 0, SURF.BARK);
    this._sys.perches.barkPath(r, H, th0, this.pos.y, th0 + d, this.pos.y, rl);
    this.route = r; this.along = 0;
    this.speed = this.info.walk * (phase === 1 ? 0.8 : 1.6);
  }

  // A trunk lizard keeps the trunk between itself and the player (squirrelling).
  _keepBehind(C) {
    if (this.adjustCd > 0 || this.dist > 7 || !Number.isFinite(this.home.ax)) return;
    const H = this.home;
    const px = C.px - H.ax, pz = C.pz - H.az;
    const pl = len2(px, pz) || 1;
    const rx = this.pos.x - H.ax, rz = this.pos.z - H.az;
    const rl = len2(rx, rz) || 1;
    if ((px * rx + pz * rz) / (pl * rl) < -0.2) return; // still out of sight
    const th0 = Math.atan2(rz, rx);
    const want = Math.atan2(pz, px) + Math.PI + (this.rng() - 0.5) * 0.5;
    let d = want - th0;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const r = this.ret.reset();
    r.push(this.pos.x, this.pos.y, this.pos.z, this.nrm.x, this.nrm.y, this.nrm.z, this.w, 0, SURF.BARK);
    const y1 = clamp(this.pos.y + 0.08, H.yLo, H.yHi);
    this._sys.perches.barkPath(r, H, th0, this.pos.y, th0 + d, y1, rl);
    this.route = r; this.along = 0;
    this.speed = this.info.speed * 0.6;
  }

  // Released away from its perch: it dashes over the ground towards its home tree,
  // slips out of sight, and turns up on its perch a little later.
  runHomeFrom(x, z) {
    const P = this._sys.perches, H = this.home;
    const T = this._sys.terrain;
    const r = this.esc.reset();
    const y = T.heightAt(x, z);
    r.push(x, y, z, 0, 1, 0, 0, 0, SURF.GROUND);
    const tx = Number.isFinite(H.ax) ? H.ax : H.x, tz = Number.isFinite(H.az) ? H.az : H.z;
    const L = len2(tx - x, tz - z);
    const k = L > 3 ? 3 / L : 1;
    P.groundPath(r, x, z, x + (tx - x) * k, z + (tz - z) * k);
    r.vanish = true;
    this.pos.x = x; this.pos.y = y; this.pos.z = z;
    this.nrm.x = 0; this.nrm.y = 1; this.nrm.z = 0;
    this.surf = SURF.GROUND; this.w = 0; this.fl = 0; this.away = false;
    const tl = len2(tx - x, tz - z) || 1;
    this.fwd.x = (tx - x) / tl; this.fwd.y = 0; this.fwd.z = (tz - z) / tl;
    this.upS.x = 0; this.upS.y = 1; this.upS.z = 0;
    this.fwdS.x = this.fwd.x; this.fwdS.y = 0; this.fwdS.z = this.fwd.z;
    this.homeOnReturn = true;
    this.homePose = false;
    this.state = 'flee';
    this.stateT = 0;
    this.route = r; this.along = 0;
    this.speed = this.info.speed;
  }

  _startReturn() {
    if (this.shelter) { this.shelter = false; this.calmReturn = true; } // out of the shade to bask again
    if (this.homeOnReturn) {
      // back from a release: out of sight near its perch first, then into view
      this.homeOnReturn = false;
      this.goHome();
      this._planEscape(this._sys.C);
      if (this.esc.count > 1) {
        this.esc.sample(this.esc.length, _p, _n, _t, _i);
        this._setPose(_p, _n, _t, _i, true);
        this.away = this.esc.vanish;
      }
    }
    const r = this.ret.reset();
    const e = this.esc;
    if (e.count > 1) {
      // back round the trunk to where the escape ended, then the escape backwards
      if (!this.away && this.surf === SURF.BARK && Number.isFinite(this.home.ax)) {
        const H = this.home;
        const o = (e.count - 1) * 3;
        const ex = e.p[o], ey = e.p[o + 1], ez = e.p[o + 2];
        if (len3(ex - this.pos.x, ey - this.pos.y, ez - this.pos.z) > 0.03) {
          r.push(this.pos.x, this.pos.y, this.pos.z, this.nrm.x, this.nrm.y, this.nrm.z, this.w, 0, SURF.BARK);
          const th0 = Math.atan2(this.pos.z - H.az, this.pos.x - H.ax), th1 = Math.atan2(ez - H.az, ex - H.ax);
          let d = th1 - th0;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          this._sys.perches.barkPath(r, H, th0, this.pos.y, th0 + d, ey, len2(this.pos.x - H.ax, this.pos.z - H.az));
        }
      }
      r.appendReversed(e);
    }
    this.away = false;
    this.state = 'return';
    this.stateT = 0;
    if (r.count < 2) { this.goHome(); this.state = 'idle'; this.wary = A.waryTime; return; }
    this.route = r; this.along = 0;
    this.speed = this.info.walk * (0.85 + 0.3 * this.rng());
  }

  _atHome() {
    const h = this.home;
    return len3(this.pos.x - h.x, this.pos.y - h.y, this.pos.z - h.z) < 0.05;
  }

  // ---------------------------------------------------------------- sun and shade

  // Called with each new mood (every few seconds): a calm lizard in full sun in the
  // heat of the day moves into shade, and one in the shade on a cool morning moves
  // into the sun. True when it set off.
  thermalMove(C) {
    if (this.thermalCd > 0 || this.state !== 'idle' || this.route || this.act || this.tame) return false;
    if (this.threat > 0.3 || this.wary > 0 || this.stateT < 3 || this.mood.night) return false;
    if (!this.mood.hot && !this.mood.cold) return false;
    const T = THERMAL.moveEvery;
    this.thermalCd = T[0] + (T[1] - T[0]) * this.rng();
    if (!this._thermalPlan(C)) return false;
    this.speed = this.info.walk * (this.thermal === 'shelter' ? 0.8 : 0.65);
    return true;
  }

  // Plans the move into this.route: round the trunk to its sunny or shady side, or
  // (too hot, and no shade on the trunk) a way into cover away from the sun.
  _thermalPlan(C) {
    const H = this.home, m = this.mood;
    const onTrunk = this.surf === SURF.BARK && Number.isFinite(H.ax) && Number.isFinite(H.r) && H.r > 0;
    if (onTrunk && this._roundTrunk(C, m.hot ? -1 : 1)) return true;
    if (!m.hot) return false;
    // As if the sun were the threat: the lizard's own way out, away from it; and for a
    // branch lizard that leads nowhere, in along its branch and round the trunk. A way
    // that ends out of sight is a shelter; one that ends in view must end in shade.
    for (let k = 0; k < 2; k++) {
      if (k === 0) { _away.px = this.pos.x + C.sx * 4; _away.pz = this.pos.z + C.sz * 4; } else if (this.surf === SURF.BRANCH && Number.isFinite(H.ax)) {
        _away.px = 2 * this.pos.x - H.ax; _away.pz = 2 * this.pos.z - H.az;
      } else break;
      const hold = this.holdFlat;
      this._planEscape(_away);
      this.holdFlat = hold;
      const e = this.esc;
      if (e.count < 2) continue;
      if (!e.vanish) {
        e.sample(e.length, _p, _n, _t, _i);
        const ex = this._sys.sunExposure(_p.x, _p.y, _p.z, _n.x, _n.y, _n.z);
        if (ex > THERMAL.shady + 0.5 * (this.exposure - THERMAL.shady)) continue;
      }
      this.route = e; this.along = 0;
      this.thermal = e.vanish ? 'shelter' : 'shade';
      return true;
    }
    return false;
  }

  // Round the trunk towards the sun (dir 1) or away from it (-1), about level, when
  // that side is really sunnier or shadier than here.
  _roundTrunk(C, dir) {
    const H = this.home;
    const sh = len2(C.sx, C.sz);
    if (sh < 0.05) return false; // the sun straight overhead: every side alike
    const rx = this.pos.x - H.ax, rz = this.pos.z - H.az;
    const rl = len2(rx, rz) || 1;
    const th0 = Math.atan2(rz, rx);
    const want = Math.atan2(C.sz, C.sx) + (dir > 0 ? 0 : Math.PI) + (this.rng() - 0.5) * 0.9;
    let d = want - th0;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) < 0.6) return false; // already on that side
    const c = Math.cos(th0 + d), s = Math.sin(th0 + d);
    const e = this._sys.sunExposure(H.ax + c * rl, this.pos.y, H.az + s * rl, c, 0, s);
    if (dir < 0 ? e > THERMAL.shady + 0.5 * (this.exposure - THERMAL.shady) : e < this.exposure + 0.15) return false;
    let y1 = this.pos.y + (this.rng() - 0.4) * 0.2;
    if (Number.isFinite(H.yLo) && Number.isFinite(H.yHi)) y1 = clamp(y1, H.yLo, Math.max(H.yLo, H.yHi));
    const r = this.ret.reset();
    r.push(this.pos.x, this.pos.y, this.pos.z, this.nrm.x, this.nrm.y, this.nrm.z, this.w, 0, SURF.BARK);
    this._sys.perches.barkPath(r, H, th0, this.pos.y, th0 + d, y1, rl);
    if (r.count < 2) return false;
    this.route = r; this.along = 0;
    this.thermal = dir > 0 ? 'sun' : 'shade';
    return true;
  }

  // The end of a move for sun or shade: settled on the other side of the trunk, or
  // out of sight in cover until the day cools (tell: emit lizard:hidden).
  _thermalArrived(tell) {
    const kind = this.thermal;
    this.route = null; this.thermal = null;
    if (kind !== 'shelter') { this._restPose(); return; }
    this.away = this.esc.vanish;
    this.state = 'hidden';
    this.stateT = 0; this.hideT = 0; this.hideFor = 1e9;
    this.shelter = true;
    this.peek = 0; this.nextPeek = 1e9;
    if (!this.away) this._restPose();
    if (tell) {
      _hid.x = this.pos.x; _hid.y = this.pos.y; _hid.z = this.pos.z; _hid.away = this.away;
      this._sys.emit('lizard:hidden', this, _hid);
    }
  }

  // Resting where it is: bark lizards head up or down (a little off the vertical),
  // others as they arrived.
  _restPose() {
    if (this.surf !== SURF.BARK) return;
    const n = this.nrm;
    const s = this.headDown ? -1 : 1;
    let fx = -n.x * n.y * s, fy = (1 - n.y * n.y) * s, fz = -n.z * n.y * s;
    const l = len3(fx, fy, fz);
    if (l > 1e-3) { this.fwd.x = fx / l; this.fwd.y = fy / l; this.fwd.z = fz / l; rotateAbout(this.fwd, n, this.restTilt); }
  }

  // Follows the current route; returns true at its end.
  _follow(dt, speed) {
    const r = this.route;
    if (!r || r.count < 2) return true;
    const step = speed * dt;
    this.along = Math.min(r.length, this.along + step);
    r.sample(this.along, _p, _n, _t, _i);
    this._setPose(_p, _n, _t, _i, false);
    this._step(step, dt);
    return this.along >= r.length - 1e-4;
  }

  // Leg cycle from the distance moved (the renderer's own stride when it has one).
  _step(dist, dt) {
    const h = this.handle;
    if (h && h.step) {
      h.gaitPhase = this.gaitPhase;
      h.step(dist, dt);
      this.gaitPhase = h.gaitPhase;
    } else {
      this.gaitPhase = (this.gaitPhase + (dist / Math.max(0.05, 0.3 * this.length)) * TAU) % (TAU * 64);
    }
  }

  _setPose(p, n, t, info, snap) {
    this.homePose = false;
    this.pos.x = p.x; this.pos.y = p.y; this.pos.z = p.z;
    this.nrm.x = n.x; this.nrm.y = n.y; this.nrm.z = n.z;
    // head along the travel direction, in the surface plane
    const d = t.x * n.x + t.y * n.y + t.z * n.z;
    let fx = t.x - n.x * d, fy = t.y - n.y * d, fz = t.z - n.z * d;
    const l = len3(fx, fy, fz);
    if (l > 1e-3) { this.fwd.x = fx / l; this.fwd.y = fy / l; this.fwd.z = fz / l; }
    this.w = info.w; this.fl = info.fl; this.surf = info.surf || this.surf;
    if (snap) {
      this.upS.x = n.x; this.upS.y = n.y; this.upS.z = n.z;
      this.fwdS.x = this.fwd.x; this.fwdS.y = this.fwd.y; this.fwdS.z = this.fwd.z;
    }
  }

  // ---------------------------------------------------------------- escapes

  // Fills this.esc with the way out from where the lizard is, away from the player.
  _planEscape(C) {
    const self = this;
    const P = this._sys.perches, H = this.home, I = this.info;
    const r = this.esc.reset();
    const x = this.pos.x, y = this.pos.y, z = this.pos.z;
    r.push(x, y, z, this.nrm.x, this.nrm.y, this.nrm.z, this.w, this.fl, this.surf);
    let ax = x - C.px, az = z - C.pz; // away from the player
    const al = len2(ax, az) || 1;
    ax /= al; az /= al;
    const climber = I.style === 'climb';
    const rng = this.rng;
    const hasStem = Number.isFinite(H.ax);

    const roundTrunk = (fromX, fromY, fromZ, extraClimb) => {
      const th0 = Math.atan2(fromZ - H.az, fromX - H.ax);
      const thP = Math.atan2(C.pz - H.az, C.px - H.ax);
      let d = thP + Math.PI + (rng() - 0.5) * 0.6 - th0;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const c = I.climb;
      let y1 = fromY + c[0] + (c[1] - c[0]) * rng() + extraClimb;
      const yHi = Number.isFinite(H.yHi) ? H.yHi : fromY + 0.4;
      const yLo = Number.isFinite(H.yLo) ? H.yLo : fromY - 0.2;
      y1 = clamp(y1, yLo, Math.max(yLo, yHi));
      const rr = len2(fromX - H.ax, fromZ - H.az);
      P.barkPath(r, H, th0, fromY, th0 + d, y1, rr);
      // climbers slip into the crown when it is just above
      if (climber && Number.isFinite(H.crownLo) && H.crownLo - y1 < 0.7) r.vanish = true;
    };

    switch (this.surf) {
      case SURF.BARK:
        if (hasStem && I.style === 'dash' && y - H.yLo < 0.7 && downAndAway(x, y, z)) break;
        if (hasStem && Number.isFinite(H.r) && H.r > 0) roundTrunk(x, y, z, 0);
        else r.vanish = true;
        break;
      case SURF.BRANCH: {
        if (!hasStem) { P.scamperPath(r, x, y, z, ax, az, 0.3); r.vanish = true; break; }
        // out along the branch when the trunk lies towards the player: climbers into
        // the leafy tip, the others as far as the branch goes; where it goes nowhere,
        // it presses flat and holds rather than running past the player to the trunk
        const out = (x - H.ax) * ax + (z - H.az) * az > 0;
        if (out) {
          const tip = P.branchPath(r, H, x, y, z, -1, climber ? 1.6 : 1.0);
          if (tip === 'leaf') { r.vanish = true; break; }
          if (r.count <= 3) { r.reset(); r.push(x, y, z, this.nrm.x, this.nrm.y, this.nrm.z, this.w, this.fl, this.surf); }
          this.holdFlat = true;
          break;
        }
        const end = P.branchPath(r, H, x, y, z, 1, 2.2);
        if (end === 'trunk') {
          const o = (r.count - 1) * 3;
          roundTrunkFromBranch(r, H, r.p[o], r.p[o + 1], r.p[o + 2]);
        } else if (end === 'leaf' || r.length > 0.6) {
          r.vanish = true; // into the leaves, or a long way along into the crown
        } else {
          this.holdFlat = true; // the branch goes nowhere: flat and still
        }
        break;
      }
      case SURF.LEAF: {
        if (this.species === 'carolinensis' || this.species === 'equestris') {
          if (P.hopPath(r, x, y, z, ax, az)) {
            const o = (r.count - 1) * 3;
            P.hopPath(r, r.p[o], r.p[o + 1], r.p[o + 2], ax, az);
          } else {
            P.scamperPath(r, x, y, z, ax, az, 0.3);
          }
        } else {
          P.scamperPath(r, x, y, z, ax, az, 0.25 + 0.15 * rng());
        }
        r.vanish = true;
        break;
      }
      case SURF.LOG:
        P.logPath(r, H, x, y, z, ax, az);
        r.vanish = true;
        break;
      case SURF.GROUND:
      default: {
        const cov = P.findCover(x, z, ax, az, 6) || P.findCover(x, z, ax, az, 10);
        if (cov) P.coverPath(r, x, z, cov, ax, az);
        else P.groundPath(r, x, z, x + ax * 3.5, z + az * 3.5);
        r.vanish = true;
        break;
      }
    }

    // A brown anole low on a trunk: down the far side, off at the foot and over the
    // ground to cover. False when the foot of the trunk is not open ground.
    function downAndAway(fromX, fromY, fromZ) {
      const T = self._sys.terrain;
      const thA = Math.atan2(H.az - C.pz, H.ax - C.px);
      const rr = len2(fromX - H.ax, fromZ - H.az);
      const gx = H.ax + Math.cos(thA) * (rr + 0.12), gz = H.az + Math.sin(thA) * (rr + 0.12);
      if (!T.isWalkable(gx, gz)) return false;
      const th0 = Math.atan2(fromZ - H.az, fromX - H.ax);
      let d = thA - th0;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      P.barkPath(r, H, th0, fromY, th0 + d, H.yLo, rr);
      const gn = P.groundNormalAt(gx, gz);
      r.push(gx, T.heightAt(gx, gz), gz, gn.nx, gn.ny, gn.nz, 0, 0, SURF.GROUND);
      const cov = P.findCover(gx, gz, Math.cos(thA), Math.sin(thA), 6);
      if (cov) P.coverPath(r, gx, gz, cov, Math.cos(thA), Math.sin(thA));
      else P.groundPath(r, gx, gz, gx + Math.cos(thA) * 3, gz + Math.sin(thA) * 3);
      r.vanish = true;
      return true;
    }

    // from the end of a branch onto the trunk and round it
    function roundTrunkFromBranch(route, Hh, bx, by, bz) {
      const th = Math.atan2(bz - Hh.az, bx - Hh.ax);
      const rr = Number.isFinite(Hh.trunkR) ? Hh.trunkR : 0.1;
      const hit = P.hit;
      if (!P.trunkPoint(Hh.ax, Hh.az, th, by + 0.04, rr, hit)) { route.vanish = true; return; }
      route.pushHit(hit, SURF.BARK);
      const r0 = len2(hit.x - Hh.ax, hit.z - Hh.az);
      const thP = Math.atan2(C.pz - Hh.az, C.px - Hh.ax);
      let d = thP + Math.PI + (rng() - 0.5) * 0.6 - th;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const c = I.climb;
      const yTop = Number.isFinite(Hh.yHi) ? Hh.yHi : hit.y + 0.4;
      const y1 = Math.min(hit.y + c[0] + (c[1] - c[0]) * rng(), Math.max(hit.y, yTop));
      P.barkPath(route, Hh, th, hit.y, th + d, y1, r0);
      if (climber && Number.isFinite(Hh.crownLo) && Hh.crownLo - y1 < 0.7) route.vanish = true;
    }
  }

  // ---------------------------------------------------------------- animation

  _startDisplay(kind, dur) {
    this.act = 'display';
    this.display = kind;
    this.actT = 0;
    this.actD = dur;
    this._sideOn(this._sys.C);
    this._sys.emit('lizard:display', this, kind);
  }

  // Anoles display side on, so the dewlap shows as a fan and not edge on. On bark the
  // lizard turns head up or down across the player's line of sight; on the ground,
  // leaves and logs it turns while the display runs (_animate); on a branch it stays
  // along the branch.
  _sideOn(C) {
    this.side = false;
    if (!C || this.dist > 8) return;
    const s = this.surf;
    if (s === SURF.BARK) {
      const n = this.nrm, tx = C.px - this.pos.x, ty = C.hy - this.pos.y, tz = C.pz - this.pos.z;
      let fx = n.y * tz - n.z * ty, fy = n.z * tx - n.x * tz, fz = n.x * ty - n.y * tx;
      const l = len3(fx, fy, fz), lt = len3(tx, ty, tz) || 1;
      if (l < 0.35 * lt) return; // straight out from the bark: nothing better to show
      const sg = fx * this.fwd.x + fy * this.fwd.y + fz * this.fwd.z >= 0 ? 1 / l : -1 / l;
      this.fwd.x = fx * sg; this.fwd.y = fy * sg; this.fwd.z = fz * sg;
    } else if (s === SURF.GROUND || s === SURF.LEAF || s === SURF.LOG) {
      this.side = true;
    }
  }

  _animate(dt, t, C) {
    const ex = Math.exp(-dt); // 1 - ex ** k is expRate(k, dt), with no call to box a number
    const I = this.info, r = this.rng, st = this.state;
    const calm = st === 'idle' || st === 'alert';
    // idle programme: pick the next little thing to do (not while it walks for the sun)
    if (st === 'idle' && !this.act && !this.route) {
      // a player standing still and close is shown more of it
      const W = A.watched;
      const watched = C && C.speed < 0.1 && this.dist < W.range ? (this.male ? W.m : W.f) : 1;
      const k = this.mood.display * (this.tame ? 4 : 1) * watched;
      this.tDisplay -= dt * k;
      this.tSnap -= dt; this.tShuffle -= dt;
      if (this.tDisplay <= 0) {
        const mix = I.mix, u = r() * (mix.headbob + mix.pushup + mix.dewlap);
        const kind = u < mix.headbob ? 'headbob' : u < mix.headbob + mix.pushup ? 'pushup' : 'dewlap';
        this._startDisplay(kind, this._sys.displayLength ? this._sys.displayLength(this.species, kind) : kind === 'headbob' ? 1.5 + r() : kind === 'pushup' ? 1.8 + r() : 2.0 + r());
        this.tDisplay = nextIn(r, I.display[this.male ? 'm' : 'f']);
      } else if (this.tSnap <= 0 && !this.mood.night) {
        this.act = 'snap'; this.actT = 0; this.actD = 0.45;
        this.tSnap = nextIn(r, I.snap);
      } else if (this.tShuffle <= 0 && (this.surf === SURF.GROUND || this.surf === SURF.LEAF || this.surf === SURF.LOG)) {
        this.act = 'shuffle'; this.actT = 0; this.actD = 0.5; this.shuffleA = (r() - 0.5) * 1.4;
        this.tShuffle = nextIn(r, I.shuffle);
      }
    }
    let bob = 0, push = 0, dew = 0, curl = 0, gape = 0, gait = 0, pitchAdd = 0;
    if (this.act && calm) {
      this.actT += dt;
      const tt = this.actT, D = this.actD;
      const env = smooth(0, 0.2, tt) * (1 - smooth(D - 0.25, D, tt));
      if (this.act === 'display') {
        if (this.cornerT > 0) { // the knight's threat: gape and the whole dewlap
          dew = env; gape = env;
        } else if (this._sys.displayCurve) { // the species' own timing from anole.js
          this._sys.displayCurve(this.species, this.display, tt, _d);
          bob = _d.bob; push = _d.pushup; dew = _d.dewlap;
        } else if (this.display === 'headbob') {
          bob = env * (0.5 - 0.5 * Math.cos(TAU * 2.6 * tt));
        } else if (this.display === 'pushup') {
          push = env * (0.5 - 0.5 * Math.cos(TAU * 1.3 * tt)); bob = 0.25 * push;
        } else {
          const p = (tt % 0.9) / 0.9;
          dew = env * smooth(0, 0.25, p) * (1 - smooth(0.6, 0.9, p));
          bob = 0.35 * env * (0.5 - 0.5 * Math.cos(TAU * 2.6 * tt));
        }
        if (this.male && this.species === 'cristatellus') curl = 0.35 * env;
      } else if (this.act === 'snap') {
        pitchAdd = -0.5 * smooth(0, 0.12, tt) * (1 - smooth(0.3, D, tt));
        gape = smooth(0.1, 0.16, tt) * (1 - smooth(0.2, 0.3, tt)) * 0.8;
      } else if (this.act === 'shuffle') {
        const a = this.shuffleA * dt / D;
        rotateAbout(this.fwd, this.nrm, a);
        gait = 0.3;
        this._step(Math.abs(a) * 0.3 * this.length, dt);
      }
      if (tt >= D) { this.act = null; if (this.display) this.display = null; }
    } else if (!calm && this.act) {
      this.act = null; this.display = null;
    }
    // look: round about when idle, at the player when alert or peeking from hiding
    this.tLook -= dt;
    const watching = st === 'alert' || (st === 'hidden' && !this.away) || st === 'frozen' || (st === 'idle' && this.threat > 0.3);
    if (watching && C) {
      this._lookAt(C);
    } else if (this.tLook <= 0) {
      this.hyT = (r() - 0.5) * 1.6;
      this.hpT = (r() - 0.5) * 0.6;
      this.tLook = 1.2 + 2.5 * r();
    }
    // alert lizards on open surfaces turn their body to watch, or side on for a display
    const open = this.surf === SURF.GROUND || this.surf === SURF.LEAF || this.surf === SURF.LOG;
    if (this.side && this.act === 'display' && C && open) {
      const n = this.nrm, tx = C.px - this.pos.x, ty = C.hy - this.pos.y, tz = C.pz - this.pos.z;
      const fx = n.y * tz - n.z * ty, fy = n.z * tx - n.x * tz, fz = n.x * ty - n.y * tx;
      const sg = fx * this.fwd.x + fy * this.fwd.y + fz * this.fwd.z >= 0 ? 1 : -1;
      _tw.x = fx * sg; _tw.y = fy * sg; _tw.z = fz * sg; _tw.a = 3.0 * dt;
      turnTowards(this.fwd, this.nrm, _tw);
    } else if (st === 'alert' && C && open) {
      _tw.x = C.px - this.pos.x; _tw.y = C.hy - this.pos.y; _tw.z = C.pz - this.pos.z; _tw.a = 2.5 * dt;
      turnTowards(this.fwd, this.nrm, _tw);
    } else if (st === 'idle' && open && C && this.mood.bask && !this.act && !this.route && this.threat < 0.3) {
      // basking broadside to the sun, to soak up the most of it
      const n = this.nrm;
      const fx = n.y * C.sz - n.z * C.sy, fy = n.z * C.sx - n.x * C.sz, fz = n.x * C.sy - n.y * C.sx;
      const sg = fx * this.fwd.x + fy * this.fwd.y + fz * this.fwd.z >= 0 ? 1 : -1;
      _tw.x = fx * sg; _tw.y = fy * sg; _tw.z = fz * sg; _tw.a = 0.5 * dt;
      turnTowards(this.fwd, this.nrm, _tw);
    }
    const kh = (1 - ex ** 8);
    this.headYaw += (this.hyT - this.headYaw) * kh;
    this.headPitch += (Math.max(-0.9, Math.min(0.9, this.hpT + pitchAdd)) - this.headPitch) * kh;

    // posture and colour
    const walking = st === 'flee' || st === 'return' || ((st === 'hidden' || st === 'idle') && this.route);
    if (walking) gait = st === 'flee' ? 1 : st === 'hidden' ? 0.7 : 0.45;
    this.gait += (gait - this.gait) * (1 - ex ** 12);
    let flat = this.mood.flatten;
    if (I.restFlatten && (this.surf === SURF.BARK || this.surf === SURF.BRANCH || this.surf === SURF.LOG)) flat = Math.max(flat, I.restFlatten);
    if (st === 'alert') flat = Math.max(flat, I.flattenAlert);
    if ((st === 'flee' || st === 'hidden') && this.species === 'distichus') flat = 1;
    else if (st === 'hidden' && !this.away) flat = Math.max(flat, this.holdFlat ? 1 : 0.3);
    this.flatten += (flat - this.flatten) * (1 - ex ** 6);
    this.bob = bob; this.pushup = push; this.tailCurl += (curl - this.tailCurl) * (1 - ex ** 14);
    this.dewlap += (dew - this.dewlap) * (1 - ex ** 14);
    this.gape += (gape - this.gape) * (1 - ex ** 16);
    const stress = st === 'flee' || st === 'hidden' ? 1 : st === 'alert' || st === 'frozen' ? I.tintAlert : this.species === 'carolinensis' && this.mood.night ? 0.4 : 0;
    this.tint += (stress - this.tint) * (stress > this.tint ? (1 - ex ** 1.5) : (1 - ex ** 0.06));
    // asleep at night with the eyes shut; the tail drapes over the end of its perch at rest
    const sl = this.mood.night && st === 'idle' && this.threat < 0.3 ? 1 : 0;
    this.sleep += (sl - this.sleep) * (1 - ex ** (sl > this.sleep ? 0.6 : 5));
    const droop = this.homePose && this.gait < 0.3 ? this.homeDroop : 0;
    this.tailDroop += (droop - this.tailDroop) * (1 - ex ** 4);
  }

  // p: a point with hx, hy, hz (the shared context: the player's head)
  _lookAt(p) {
    const tx = p.hx, ty = p.hy, tz = p.hz;
    const L = this.length, u = this.upS, f = this.fwdS;
    const hx = this.pos.x + u.x * 0.07 * L + f.x * 0.24 * L, hy = this.pos.y + u.y * 0.07 * L + f.y * 0.24 * L, hz = this.pos.z + u.z * 0.07 * L + f.z * 0.24 * L;
    const dx = tx - hx, dy = ty - hy, dz = tz - hz;
    // right = forward x up
    const rx = f.y * u.z - f.z * u.y, ry = f.z * u.x - f.x * u.z, rz = f.x * u.y - f.y * u.x;
    const df = dx * f.x + dy * f.y + dz * f.z, du = dx * u.x + dy * u.y + dz * u.z, dr = dx * rx + dy * ry + dz * rz;
    this.hyT = Math.max(-1.3, Math.min(1.3, Math.atan2(-dr, df)));
    this.hpT = Math.max(-0.8, Math.min(0.8, Math.atan2(du, Math.sqrt(df * df + dr * dr))));
  }

  // Smooths the drawn frame and writes the handle.
  _write(dt) {
    const h = this.handle;
    if (!h) return;
    const k = dt > 0 ? expRate(this.gait > 0.1 ? 22 : 10, dt) : 1;
    const u = this.upS, f = this.fwdS;
    u.x += (this.nrm.x - u.x) * k; u.y += (this.nrm.y - u.y) * k; u.z += (this.nrm.z - u.z) * k;
    let l = len3(u.x, u.y, u.z) || 1;
    u.x /= l; u.y /= l; u.z /= l;
    f.x += (this.fwd.x - f.x) * k; f.y += (this.fwd.y - f.y) * k; f.z += (this.fwd.z - f.z) * k;
    const d = f.x * u.x + f.y * u.y + f.z * u.z;
    f.x -= u.x * d; f.y -= u.y * d; f.z -= u.z * d;
    l = len3(f.x, f.y, f.z);
    if (l < 1e-4) { f.x = this.fwd.x; f.y = this.fwd.y; f.z = this.fwd.z; l = len3(f.x, f.y, f.z) || 1; }
    f.x /= l; f.y /= l; f.z /= l;
    swayOffset(this.pos.x, this.pos.y, this.pos.z, this.w, this.fl, _o);
    h.position.set(this.pos.x + _o.x, this.pos.y + _o.y, this.pos.z + _o.z);
    h.up.set(u.x, u.y, u.z);
    h.forward.set(f.x, f.y, f.z);
    h.scale = this.scale;
    h.gait = this.gait;
    h.gaitPhase = this.gaitPhase;
    h.headYaw = this.headYaw;
    h.headPitch = this.headPitch;
    h.bob = this.bob;
    h.pushup = this.pushup;
    h.dewlap = this.dewlap;
    h.tailCurl = this.tailCurl;
    h.flatten = this.flatten;
    h.gape = this.gape;
    h.tint = this.tint;
    // slipping out of sight fades over 0.15 s rather than blinking out
    if (this.away) this.show = dt > 0 ? Math.max(0, this.show - dt / 0.15) : 0;
    else this.show = dt > 0 ? Math.min(1, this.show + dt / 0.15) : 1;
    h.visible = this.show > 0;
    h.opacity = this.show;
    h.sleep = this.sleep;
    h.tailDroop = this.tailDroop;
    h.tailDroopAt = this.homeDroopAt;
    h.backpack = this.backpack;
    // how much of the renderer's own idle life (blinks stay, glances and flicks go)
    const st = this.state;
    h.idle = st === 'idle' ? (this.act === 'display' ? 0.3 : 1) : st === 'alert' || st === 'hidden' ? 0.3 : st === 'frozen' ? 0 : 0.5;
  }

  // Sun and time (THERMAL in species.js): basking in the sun while the day is cool
  // (flatter, showier, warier), too hot in full sun at the height of the day (fewer
  // displays; it moves into shade), calmer and quieter in the shade, asleep at night.
  // warm is the day's warmth, 0..1 (species.js warmth()).
  setMood(hours, sunUp, exposure, warm = 0) {
    this.exposure = exposure;
    const m = this.mood, T = THERMAL;
    m.night = sunUp < 0.05;
    m.warmth = warm;
    m.shade = m.night ? 0 : 1 - smooth(T.shady, T.sunny, exposure);
    m.bask = !m.night && exposure > T.sunny && warm < T.bask.below;
    m.hot = !m.night && warm > T.hot.above && exposure > T.sunny * (this.info.heat || 1);
    m.cold = !m.night && warm < T.cold && exposure < T.shady;
    m.flatten = m.bask ? T.bask.flatten : 0;
    if (m.night) { m.display = T.night.display; m.fid = T.night.fid; return; }
    let d = T.display[0] + (T.display[1] - T.display[0]) * warm, f = 1;
    if (m.bask) { d *= T.bask.display; f = T.bask.fid; } else if (m.hot) { d *= T.hot.display; f = T.hot.fid; } else {
      d *= 1 + (T.shade.display - 1) * m.shade;
      f = 1 + (T.shade.fid - 1) * m.shade;
    }
    m.display = d; m.fid = f;
  }
}

// Rotates v about unit axis n by angle a (in place).
function rotateAbout(v, n, a) {
  const c = Math.cos(a), s = Math.sin(a);
  const d = v.x * n.x + v.y * n.y + v.z * n.z;
  const cx = n.y * v.z - n.z * v.y, cy = n.z * v.x - n.x * v.z, cz = n.x * v.y - n.y * v.x;
  v.x = v.x * c + cx * s + n.x * d * (1 - c);
  v.y = v.y * c + cy * s + n.y * d * (1 - c);
  v.z = v.z * c + cz * s + n.z * d * (1 - c);
}

// Turns v (in the plane normal to n) towards direction w (x, y, z) by at most w.a
// (a scratch object, so no numbers are boxed to pass).
function turnTowards(v, n, w) {
  const dx = w.x, dy = w.y, dz = w.z, maxA = w.a;
  const d = dx * n.x + dy * n.y + dz * n.z;
  let tx = dx - n.x * d, ty = dy - n.y * d, tz = dz - n.z * d;
  const l = len3(tx, ty, tz);
  if (l < 1e-4) return;
  tx /= l; ty /= l; tz /= l;
  const ang = Math.acos(Math.max(-1, Math.min(1, v.x * tx + v.y * ty + v.z * tz)));
  if (ang < 0.35) return; // near enough: the head does the rest
  const sgn = (n.x * (v.y * tz - v.z * ty) + n.y * (v.z * tx - v.x * tz) + n.z * (v.x * ty - v.y * tx)) >= 0 ? 1 : -1;
  rotateAbout(v, n, sgn * Math.min(maxA, ang - 0.3));
}

