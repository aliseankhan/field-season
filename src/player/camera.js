// Third-person follow rig: behind and above the player, smooth, orbit with a
// mouse drag, limited pitch, wheel zoom, and a gentle swing back behind the
// player while walking. While the player creeps it eases into a closer, steeper
// framing over the right shoulder, so a lizard on the ground ahead is not hidden
// behind the hat, leaning towards rig.hint (a point, or null: the lizards set it to
// the nearest one ahead); rig.creepPitch (radians, or null) sets that framing's pitch. While aiming the loop pole (rig.aim, set by src/catch/loop_pole.js)
// it eases in over a shoulder with a narrower lens, turned part of the way to
// rig.aimPoint (rig.aimFov closes it further for the snug, from a little higher and
// nearer, the player thinning to a dithered ghost so the hat never hides the lizard).
// Each time aiming starts the rig picks the shoulder with the clearer view:
// rig.clearance(camX, camY, camZ, toX, toY, toZ) -> how blocked that view is (the catch
// sets it from the colliders, the canopy grid and whether the lizard can be seen); the
// right shoulder wins a tie. A VR rig can replace this module: the rest of the game
// only reads rig.yaw (the forward direction for the move stick) and rig.camera.

import * as THREE from 'three';
import { CONFIG } from '../config.js';

const C = CONFIG.camera;
// the creep framing: pitch (rad), distance (m), target shift to the right (m), the
// share of the way the target leans to the hint, and how fast it eases in and out
const CREEP = { pitch: 0.8, distance: 5.0, side: 0.5, lean: 0.3, rate: 2.5 };
// the aim framing (rig.aim, set by the loop pole): nearer, lower, over the right shoulder,
// leaning part of the way to rig.aimPoint and tilting up to it when it is high
const AIM = { pitch: 0.14, tilt: 0.16, distance: 4.4, side: 1.8, lean: 0.6, maxLean: 1.1, fov: 32, turn: 0.75, rate: 5.0 };
// the snug (rig.aimFov set): a little higher, further to the side and nearer the
// lizard, so the player's head passes out of the side of the frame
const SNUG = { pitch: 0.08, side: 0.3, distance: 3.2, fade: 0.72, rate: 4.0 };

function wrapAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

export class FollowCamera {
  constructor(camera, { terrain, input }) {
    this.camera = camera;
    this.terrain = terrain;
    this.input = input;
    this.yaw = 0; // same convention as heading: 0 looks towards -z
    // The first view is a little lower, up the causeway; once the player walks
    // it eases to the default pitch unless the player has tilted it by hand.
    this.pitch = C.startPitch ?? C.pitch;
    this._userPitch = false;
    this.distance = C.distance;
    this.target = new THREE.Vector3();
    this.player = null;
    this.enabled = true;
    this._focus = new THREE.Vector3();
    this.creep = 0; // 0..1, how far into the creep framing
    this.hint = null; // a point the creep framing leans towards (a lizard ahead)
    // the creep framing's pitch instead of CREEP.pitch, or null: the opening's practice
    // catch keeps it low, so a lizard on a trunk ahead stays in the picture
    this.creepPitch = null;
    this._hint = new THREE.Vector3();
    this.aim = 0; // 0 or 1: the aim framing wanted (the loop pole sets it)
    this.aimPoint = null; // a point the aim framing leans towards, or null
    this.aimK = 0; // 0..1, how far into the aim framing
    this._aimPitch = AIM.pitch;
    this._aimSide = 0;
    this._look = new THREE.Vector3();
    this.aimFov = null; // a closer lens while aiming (the loop pole's snug), or null
    this._aimFov = AIM.fov;
    this._snug = 0; // 0..1, how far into the snug framing
    this.aimSign = 1; // 1 over the right shoulder, -1 the left
    this._aimWas = 0;
    this.clearance = null; // (camX, camY, camZ, toX, toY, toZ) -> how blocked; set by the catch
    this._c = new THREE.Vector3();
  }

  // Which shoulder to aim over: the candidate camera spot with the clearer view to the
  // aim point (or ahead of the player), the right one unless the left is clearer.
  _pickShoulder() {
    this.aimSign = 1;
    if (!this.clearance || !this.player) return;
    const f = this._focusPoint(this._c);
    const to = this.aimPoint;
    const tx = to ? to.x : f.x - Math.sin(this.yaw) * 3, ty = to ? to.y : f.y, tz = to ? to.z : f.z - Math.cos(this.yaw) * 3;
    const cp = Math.cos(AIM.pitch) * AIM.distance, sp = Math.sin(AIM.pitch) * AIM.distance;
    let best = 1, bs = Infinity;
    for (const sign of [1, -1]) {
      const fx = f.x + Math.cos(this.yaw) * AIM.side * sign, fz = f.z - Math.sin(this.yaw) * AIM.side * sign;
      const cx = fx + Math.sin(this.yaw) * cp, cz = fz + Math.cos(this.yaw) * cp, cy = f.y + sp;
      const score = this.clearance(cx, cy, cz, tx, ty, tz) + (sign === 1 ? 0 : 0.35);
      if (score < bs) { bs = score; best = sign; }
    }
    this.aimSign = best;
  }

  follow(player) {
    this.player = player;
    this.yaw = player.heading;
    this.snap();
  }

  _focusPoint(out) {
    const p = this.player;
    return out.set(p.position.x, p.position.y + C.targetHeight - p.crouch * 0.28, p.position.z);
  }

  snap() {
    if (!this.player) return;
    this._focusPoint(this.target);
    this._place();
  }

  update(dt) {
    if (!this.enabled || !this.player) return;
    const inp = this.input;
    this.yaw = wrapAngle(this.yaw - inp.look.x * C.orbitSpeed);
    if (inp.look.y) this._userPitch = true;
    this.pitch = Math.min(C.maxPitch, Math.max(C.minPitch, this.pitch + inp.look.y * C.orbitSpeed * 0.8));
    // (while aiming the wheel picks the next lizard instead)
    if (inp.zoom && !this.aim) {
      this.distance = Math.min(C.maxDistance, Math.max(C.minDistance, this.distance * Math.exp(inp.zoom * C.zoomSpeed)));
    }

    // Swing back behind the player while walking away from the camera, unless
    // recently orbited. Weighted by how far forward the walk is, so strafing
    // circles the camera gently and walking towards it does not spin it.
    const p = this.player;
    const idle = (performance.now() - inp.lastLookTime) / 1000;
    if (idle > C.autoAlignDelay && p.speed > 0.3) {
      const diff = wrapAngle(p.heading - this.yaw);
      const ahead = Math.max(0, Math.cos(diff));
      const k = Math.min(1, C.autoAlignRate * (p.speed / CONFIG.player.walkSpeed) * ahead * dt);
      this.yaw = wrapAngle(this.yaw + diff * k);
    }
    if (!this._userPitch && p.speed > 0.3) this.pitch += (C.pitch - this.pitch) * Math.min(1, 0.6 * dt);

    // creeping: closer, steeper, over the right shoulder, leaning to the hint
    const want = p.mode === 'creep' || p.crouch > 0.5 ? 1 : 0;
    this.creep += (want - this.creep) * (1 - Math.exp(-CREEP.rate * dt));
    this._focusPoint(this._focus);
    const k = this.creep;
    if (this.aim && !this._aimWas && this.aimK < 0.5) this._pickShoulder();
    this._aimWas = this.aim;
    this.aimK += (this.aim - this.aimK) * (1 - Math.exp(-AIM.rate * dt));
    this._aimFov += ((this.aimFov || AIM.fov) - this._aimFov) * (1 - Math.exp(-4 * dt));
    this._snug += ((this.aimFov ? 1 : 0) - this._snug) * (1 - Math.exp(-SNUG.rate * dt));
    const av = this.player.avatar;
    if (av && av.setFade) av.setFade(this._snug > 0.02 ? SNUG.fade * this._snug : 0);
    const a = this.aimK;
    if (k > 1e-3 || a > 1e-3) {
      // creeping sits over the right shoulder; aiming over the shoulder picked for it
      const aimSide = (AIM.side + SNUG.side * this._snug) * this.aimSign * a;
      const s = aimSide + CREEP.side * k * (1 - a);
      this._focus.x += Math.cos(this.yaw) * s;
      this._focus.z -= Math.sin(this.yaw) * s;
      if (this.hint) {
        const h = this._hint.copy(this.hint).sub(this._focus);
        h.y = 0;
        if (h.lengthSq() < 64) this._focus.addScaledVector(h, CREEP.lean * k * (1 - a));
      }
      if (this.aimPoint && a > 1e-3) {
        const h = this._hint.copy(this.aimPoint).sub(this._focus);
        this._aimPitch = Math.min(0.45, Math.max(0.02, AIM.pitch - AIM.tilt * h.y)) + SNUG.pitch * this._snug;
        // lean forwards and up only, so the view stays over the shoulder
        const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw), side = h.x * rx + h.z * rz;
        h.x -= rx * side; h.z -= rz * side;
        this._aimSide = side; // and turns part of the way to it, below
        const hl = h.length();
        if (hl > 1e-3 && hl < 12) this._focus.addScaledVector(h, Math.min(AIM.lean, AIM.maxLean / hl) * a);
      }
    }
    this.target.lerp(this._focus, 1 - Math.exp(-C.followRate * dt));
    this._place();
  }

  _place() {
    const cam = this.camera;
    const k = this.creep;
    const creepPitch = this.creepPitch != null ? this.creepPitch : Math.max(this.pitch, CREEP.pitch);
    let pitch = this.pitch + (creepPitch - this.pitch) * k;
    let dist = this.distance + (Math.min(this.distance, CREEP.distance) - this.distance) * k;
    const a = this.aimK;
    if (a > 1e-3) {
      pitch += (this._aimPitch - pitch) * a;
      dist += (Math.min(dist, AIM.distance + (SNUG.distance - AIM.distance) * this._snug) - dist) * a;
    }
    const cp = Math.cos(pitch);
    cam.position.set(
      this.target.x + Math.sin(this.yaw) * cp * dist,
      this.target.y + Math.sin(pitch) * dist,
      this.target.z + Math.cos(this.yaw) * cp * dist,
    );
    // the aim zoom: a narrower lens while aiming
    const fov = C.fov + (this._aimFov - C.fov) * a;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    const ground = Math.max(0, this.terrain.heightAt(cam.position.x, cam.position.z)) + C.groundClearance;
    if (cam.position.y < ground) cam.position.y = ground;
    if (a > 1e-3 && this.aimPoint) {
      // aiming: look part of the way across to the target, the player off to one side
      const s = this._aimSide * AIM.turn * a;
      cam.lookAt(this._look.set(this.target.x + Math.cos(this.yaw) * s, this.target.y, this.target.z - Math.sin(this.yaw) * s));
    } else {
      cam.lookAt(this.target);
    }
  }
}
