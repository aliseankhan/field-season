// Kinematic player controller. Moves on the height grid relative to the
// camera's yaw, collides with circles and blocked cells, and exposes what the
// lizards will need later: position, heading, speed and a noise level
// (0 creeping or standing, 1 jogging).

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { events } from '../core/events.js';

const P = CONFIG.player;

function wrapAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

export class Player {
  constructor({ data, collision, avatar, input }) {
    this.terrain = data.terrain;
    this.collision = collision;
    this.avatar = avatar;
    this.input = input;
    this.object = avatar.group;

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.heading = 0;
    this.speed = 0;
    this.noise = 0;
    this.crouch = 0;
    this.jog = 0;
    this.mode = 'idle'; // idle, creep, walk, jog
    this.moveYaw = 0; // camera yaw: forward for the move stick
    // Holding the player still: every reason is a key (hold('ring', true), the story's
    // cutscenes, a catch), and the player is held while any key is on. `frozen` is the
    // menus' own key, kept as a plain boolean for kit.js, which saves and restores it.
    this._holds = new Set();
    this.pushed = false; // set by a croc's knockback while it moves the player; input waits
    this.tow = null; // { x, z } m/s: pulled along while held (a basilisk on the loop), set each frame
    this._anim = { speed: 0, crouch: 0, jog: 0, t: 0 }; // reused each frame for the avatar

    const s = data.terrain.start;
    this.teleport(s.x, s.z, s.heading);
  }

  hold(key, on = true) {
    if (on) this._holds.add(key); else this._holds.delete(key);
  }
  // held for any reason (what steering, the ring and [E] check)
  get held() { return this._holds.size > 0; }
  get frozen() { return this._holds.has('menu'); }
  set frozen(v) { this.hold('menu', !!v); }
  get holds() { return [...this._holds]; } // for tests

  // Moves the player to the nearest free spot to (x, z). A request in the lake or
  // on a far bank searches wider, and failing that falls back to the start, so
  // the player is never left where it cannot move.
  teleport(x, z, heading = this.heading) {
    const col = this.collision;
    let free = col.nearestFree(x, z, 6) || col.nearestFree(x, z, 80);
    if (free) {
      // Nudge off the edges of blocked cells, when the nudged spot is still free.
      const p = { x: free.x, z: free.z };
      col.resolve(p);
      if (col.isFree(p.x, p.z)) free = p;
    } else {
      const s = this.terrain.start;
      free = col.nearestFree(s.x, s.z, 6) || { x: s.x, z: s.z };
    }
    this.position.set(free.x, col.supportHeight(free.x, free.z), free.z);
    this.heading = heading;
    this.velocity.set(0, 0, 0);
    this.speed = 0;
    this._sync();
    events.emit('player:teleport', this);
  }

  // Head position (what the vegetation cut-out and the lizards look at).
  headPosition(out) {
    return out.set(this.position.x, this.position.y + P.eyeHeight - this.crouch * 0.3, this.position.z);
  }

  update(dt, t) {
    const inp = this.input;
    const held = this._holds.size > 0 || this.pushed;
    let mx = 0, my = 0;
    if (!held) { mx = inp.move.x; my = inp.move.y; }
    const mag = Math.min(1, Math.hypot(mx, my));
    const creep = !held && inp.down('creep');
    const jog = !held && !creep && inp.down('jog');
    const top = creep ? P.creepSpeed : jog ? P.jogSpeed : P.walkSpeed;

    // Desired velocity in the world from the camera-relative stick.
    const sy = Math.sin(this.moveYaw), cy = Math.cos(this.moveYaw);
    let dx = -sy * my + cy * mx;
    let dz = -cy * my - sy * mx;
    const dl = Math.hypot(dx, dz);
    if (dl > 1e-6) { dx = (dx / dl) * mag * top; dz = (dz / dl) * mag * top; } else { dx = 0; dz = 0; }
    if (held && this.tow) { dx = this.tow.x; dz = this.tow.z; }

    // Accelerate towards it.
    const vx = this.velocity.x, vz = this.velocity.z;
    const ex = dx - vx, ez = dz - vz;
    const el = Math.hypot(ex, ez);
    const rate = (dx * dx + dz * dz > vx * vx + vz * vz ? P.accel : P.decel) * dt;
    const k = el > rate ? rate / el : 1;
    let nvx = vx + ex * k, nvz = vz + ez * k;

    // Move with collision; the achieved displacement becomes the velocity,
    // never faster than intended (a push out of a wall adds no speed).
    const ox = this.position.x, oz = this.position.z;
    const want = Math.hypot(nvx, nvz);
    if (want > 0) this.collision.move(this.position, nvx * dt, nvz * dt);
    if (dt > 0) {
      nvx = (this.position.x - ox) / dt;
      nvz = (this.position.z - oz) / dt;
      const got = Math.hypot(nvx, nvz);
      if (got > want) { nvx *= want / got; nvz *= want / got; }
    }
    this.velocity.set(nvx, 0, nvz);
    this.speed = Math.hypot(nvx, nvz);
    this.position.y = this.collision.supportHeight(this.position.x, this.position.z);

    // Turn to face the direction of travel (or of the stick when pushing a wall).
    if (mag > 0.05 && dl > 1e-6) {
      const target = Math.atan2(-dx, -dz);
      this.heading = wrapAngle(this.heading + wrapAngle(target - this.heading) * Math.min(1, P.turnRate * dt));
    }

    const mode = this.speed < 0.08 ? (creep ? 'creep' : 'idle') : creep ? 'creep' : jog ? 'jog' : 'walk';
    if (mode !== this.mode) {
      const prev = this.mode;
      this.mode = mode;
      events.emit('player:mode', mode, prev);
    }
    const a = Math.min(1, dt * 8);
    this.crouch += ((creep ? 1 : 0) - this.crouch) * a;
    this.jog += ((jog && this.speed > 2.2 ? 1 : 0) - this.jog) * a;
    const noiseTarget = creep ? 0.05 * Math.min(1, this.speed / P.creepSpeed)
      : Math.min(1, this.speed / P.jogSpeed);
    this.noise += (noiseTarget - this.noise) * Math.min(1, dt * 6);

    const an = this._anim;
    an.speed = this.speed; an.crouch = this.crouch; an.jog = this.jog; an.t = t;
    this.avatar.update(dt, an);
    this._sync();
  }

  _sync() {
    this.object.position.copy(this.position);
    this.object.rotation.y = this.heading;
  }
}
