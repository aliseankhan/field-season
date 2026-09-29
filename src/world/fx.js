// Particles and small effects, cheap and cosy: leaf puffs where the player brushes a
// bush or a fern (and where a lizard slips into the leaves), dust from running feet on
// the paths, splashes at the water's edge, sparkles for a new species (and round each
// ink stamp, in the page), fireflies over the lawn at dusk, dragonflies darting over
// the shallows by day, butterflies over the flower drifts, a leaf falling now and then,
// morning mist lying on the lake and a heat shimmer over the far ground at noon.
//
// Draw calls: one for the soft sprites (leaves, dust, drops, rings, butterflies,
// dragonflies), one for the glowing ones (sparkles, fireflies), each only while it has
// something to show; the mist (mornings) and the shimmer (the heat of the survey day)
// one each while they are on. Everything is preallocated, and the per-frame work keeps
// its numbers in typed arrays (the sprite in SP, the timers in TM) rather than passing
// them as arguments or keeping them in closure variables, so once warm update() leaves
// about 0.1 to 0.2 KB a frame, most of it Math.random's own. Off in
// ?view=top. Reduced motion (state.settings.reducedMotion) drops the particles, the
// small animals, the mist, the shimmer and the page sparkles, keeping only the one-off
// gold sparkle for a new species. Loaded by main.js as an optional system (game.fx,
// ?nofx=1): build(game) returns { group, update(dt, t), stats, burst }.
// A brush past a bush or a fern and a step at the water's edge emit 'fx:brush' or
// 'fx:splash' (x, z, k) so the sound system plays its swish or plash at the same moment
// (with reduced motion too, though nothing is drawn); both are paced (FX.brush,
// FX.splash) so walking along a hedge or the causeway's edge never becomes a constant
// rustle or paddle.

import * as THREE from 'three';
import { FLAGS } from '../config.js';
import { state } from '../game/state.js';
import { pathMask } from './ground_decor.js';

// sprite shapes (the fragment shader draws each)
const S = { PUFF: 0, LEAF: 1, DROP: 2, SPARK: 3, GLOW: 4, FLY: 5, DRAGON: 6, RING: 7 };

export const FX = {
  soft: 640, glow: 256, // sprite capacity of each draw call
  butterflies: 6, dragonflies: 4, fireflies: 26, // at most, round the player
  nearFlies: 2, // of the butterflies, how many keep 2 to 5 m from the player, in view
  flySize: 0.24, // m, a butterfly's wingspan on screen
  leafEvery: [1.4, 3.6], // seconds between falling leaves (under the canopy)
  // brushing a bush or a fern: a puff on first touch (at most every `fresh` s), then
  // every `every` s while still brushing at walking pace (sooner running, by sqrt of speed)
  brush: { fresh: 0.4, every: 1.3 },
  // a step at the water's edge: a plash on the first step into the fringe (at most every
  // `fresh` s), then every `every` s while still walking along it
  splash: { fresh: 0.6, every: 1.3 },
  mist: 26, // mist wisps over the lake
  shimmer: { distance: 24, width: 70, height: 5.5, amp: 2.0 }, // the noon heat shimmer (amp in pixels)
};

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const rnd = (a, b) => a + (b - a) * Math.random();

// The sprite being put: the caller fills SP and then calls put() with no arguments, so
// the eleven numbers of a sprite are never boxed on their way in. In order: x, y, z,
// r, g, b, alpha, size (m), shape, rotation, extra.
const SP = new Float64Array(11);

// ---------------------------------------------------------------- the sprite shader

const SPRITE_VERT = /* glsl */ `
attribute vec4 aCol;
attribute vec4 aPar; // size (m), shape, rotation, extra
uniform float uScale; // pixels per metre at 1 m
varying vec4 vCol;
varying vec3 vPar;
varying float vFlat;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = clamp(aPar.x * uScale / max(-mvPosition.z, 0.05), 0.0, 160.0);
  vCol = aCol;
  vPar = aPar.yzw;
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vFlat = clamp(abs(normalize(cameraPosition - wp).y), 0.1, 1.0); // a ring on the water, seen from here
  #include <fog_vertex>
}
`;

const SPRITE_FRAG = /* glsl */ `
uniform float uLight;
uniform float uGlow;
varying vec4 vCol;
varying vec3 vPar;
varying float vFlat;
#include <fog_pars_fragment>
float ell(vec2 p, vec2 c, vec2 r) { return length((p - c) / r); }
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  p.y = -p.y;
  float shape = vPar.x, ex = vPar.z;
  float c = cos(vPar.y), s = sin(vPar.y);
  vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  float r = length(p);
  vec3 col = vCol.rgb;
  float a = 0.0;
  if (shape < 0.5) { // a soft puff of dust
    a = (1.0 - smoothstep(0.15, 1.0, r)) * 0.9;
  } else if (shape < 1.5) { // a leaf with a midrib
    float y = q.y / 0.95;
    float w = 0.42 * pow(max(0.0, 1.0 - y * y), 0.8);
    a = (1.0 - smoothstep(w - 0.06, w + 0.02, abs(q.x))) * step(abs(y), 1.0);
    col *= 1.0 - 0.25 * (1.0 - smoothstep(0.02, 0.06, abs(q.x)));
    col *= 0.9 + 0.2 * smoothstep(-0.4, 0.4, q.x);
  } else if (shape < 2.5) { // a drop
    a = 1.0 - smoothstep(0.5, 0.85, r);
    col += 0.25 * (1.0 - smoothstep(0.0, 0.35, length(p - vec2(-0.2, 0.25))));
  } else if (shape < 3.5) { // a sparkle: a four-point star
    float rays = max((1.0 - smoothstep(0.0, 0.1, abs(q.x))) * (1.0 - abs(q.y)), (1.0 - smoothstep(0.0, 0.1, abs(q.y))) * (1.0 - abs(q.x)));
    a = clamp(rays * 1.3 + exp(-r * r * 16.0), 0.0, 1.0);
    col = mix(col, vec3(1.0), exp(-r * r * 30.0));
  } else if (shape < 4.5) { // a firefly: a bright core in a soft halo
    float core = 1.0 - smoothstep(0.07, 0.19, r);
    a = clamp(core + exp(-r * r * 5.0) * 0.75, 0.0, 1.0);
    col = mix(col, vec3(1.0, 1.0, 0.85), core);
  } else if (shape < 5.5) { // a butterfly, ex = how open its wings are
    vec2 w = vec2(abs(q.x) / max(ex, 0.12), q.y);
    float up = ell(w, vec2(0.45, 0.22), vec2(0.42, 0.36));
    float lo = ell(w, vec2(0.33, -0.28), vec2(0.28, 0.26));
    float wing = 1.0 - smoothstep(0.9, 1.0, min(up, lo));
    col *= 0.75 + 0.35 * smoothstep(1.0, 0.45, min(up, lo)); // darker rims
    col = mix(col, vec3(0.25, 0.18, 0.12), (1.0 - smoothstep(0.08, 0.14, length(w - vec2(0.55, 0.3)))) * 0.7); // eye spots
    float body = (1.0 - smoothstep(0.045, 0.07, abs(q.x))) * step(abs(q.y), 0.45);
    col = mix(col, vec3(0.18, 0.13, 0.1), body);
    a = max(wing * step(0.0, ex), body);
  } else if (shape < 6.5) { // a dragonfly along its x
    float body = (1.0 - smoothstep(0.035, 0.06, abs(q.y))) * step(-0.95, q.x) * step(q.x, 0.38);
    float head = 1.0 - smoothstep(0.08, 0.11, length(q - vec2(0.44, 0.0)));
    float w1 = ell(vec2(q.x, abs(q.y)), vec2(0.16, 0.42), vec2(0.11, 0.42));
    float w2 = ell(vec2(q.x, abs(q.y)), vec2(-0.08, 0.4), vec2(0.1, 0.38));
    float wing = (1.0 - smoothstep(0.85, 1.0, min(w1, w2))) * (0.35 + 0.15 * ex);
    float solid = max(body, head);
    col = mix(vec3(0.85, 0.95, 1.0), col, solid);
    a = max(solid, wing);
  } else { // a ring spreading on the water
    float d = length(vec2(p.x, p.y / vFlat));
    a = (1.0 - smoothstep(0.0, 0.1, abs(d - ex))) * step(d, 1.0);
  }
  a *= vCol.a;
  if (a < 0.01) discard;
  col *= mix(uLight, 1.0, uGlow);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

// One draw call of camera-facing sprites. Each frame: begin(), put() each sprite, end().
class Sprites {
  constructor(cap, glow) {
    this.cap = cap;
    this.n = 0;
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.par = new Float32Array(cap * 4);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aPar = new THREE.BufferAttribute(this.par, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aCol', this.aCol);
    g.setAttribute('aPar', this.aPar);
    g.setDrawRange(0, 0);
    this.uniforms = {
      uScale: { value: 800 }, uLight: { value: 1 }, uGlow: { value: glow ? 1 : 0 },
      fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 }, fogDensity: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SPRITE_VERT,
      fragmentShader: SPRITE_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = glow ? 6 : 5; // after the water
    this.points.name = glow ? 'fx-glow' : 'fx-soft';
    this.points.visible = false;
  }
  begin() { this.n = 0; }
  // one sprite from SP
  put() {
    if (this.n >= this.cap || SP[6] <= 0.004) return;
    const i = this.n++, i3 = i * 3, i4 = i * 4, pos = this.pos, col = this.col, par = this.par;
    pos[i3] = SP[0]; pos[i3 + 1] = SP[1]; pos[i3 + 2] = SP[2];
    col[i4] = SP[3]; col[i4 + 1] = SP[4]; col[i4 + 2] = SP[5]; col[i4 + 3] = SP[6];
    par[i4] = SP[7]; par[i4 + 1] = SP[8]; par[i4 + 2] = SP[9]; par[i4 + 3] = SP[10];
  }
  // Uploads the whole buffers (10 KB at most each): an update range would be a new
  // object per attribute every frame.
  end() {
    const g = this.points.geometry;
    g.setDrawRange(0, this.n);
    this.points.visible = this.n > 0;
    if (!this.n) return;
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aPar.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- short-lived particles

// behaviour of a particle (not its shape)
const B = { DUST: 0, BIT: 1, FALL: 2, DROP: 3, RING: 4, SPARK: 5 };

class Particles {
  constructor(cap) {
    this.cap = cap; this.n = 0;
    this.p = new Float32Array(cap * 3); this.v = new Float32Array(cap * 3);
    this.c = new Float32Array(cap * 4);
    this.life = new Float32Array(cap); this.max = new Float32Array(cap);
    this.size0 = new Float32Array(cap); this.size1 = new Float32Array(cap);
    this.rot = new Float32Array(cap); this.spin = new Float32Array(cap);
    this.seed = new Float32Array(cap); this.rest = new Float32Array(cap); // ground contact time
    this.beh = new Uint8Array(cap); this.shape = new Uint8Array(cap);
  }
  add(beh, shape, x, y, z, vx, vy, vz, life, s0, s1, col, a) {
    if (this.n >= this.cap) return -1;
    const i = this.n++, i3 = i * 3, i4 = i * 4;
    this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z;
    this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
    this.c[i4] = col.r; this.c[i4 + 1] = col.g; this.c[i4 + 2] = col.b; this.c[i4 + 3] = a;
    this.life[i] = 0; this.max[i] = life; this.size0[i] = s0; this.size1[i] = s1;
    this.rot[i] = Math.random() * 6.283; this.spin[i] = rnd(-4, 4); this.seed[i] = Math.random() * 100;
    this.rest[i] = -1; this.beh[i] = beh; this.shape[i] = shape;
    return i;
  }
  kill(i) {
    const j = --this.n;
    if (i === j) return;
    const i3 = i * 3, j3 = j * 3, i4 = i * 4, j4 = j * 4;
    for (let k = 0; k < 3; k++) { this.p[i3 + k] = this.p[j3 + k]; this.v[i3 + k] = this.v[j3 + k]; }
    for (let k = 0; k < 4; k++) this.c[i4 + k] = this.c[j4 + k];
    this.life[i] = this.life[j]; this.max[i] = this.max[j]; this.size0[i] = this.size0[j]; this.size1[i] = this.size1[j];
    this.rot[i] = this.rot[j]; this.spin[i] = this.spin[j]; this.seed[i] = this.seed[j]; this.rest[i] = this.rest[j];
    this.beh[i] = this.beh[j]; this.shape[i] = this.shape[j];
  }
  // moves every particle and writes it into out (a Sprites)
  step(dt, T, out) {
    for (let i = this.n - 1; i >= 0; i--) {
      this.life[i] += dt;
      const u = this.life[i] / this.max[i];
      if (u >= 1) { this.kill(i); continue; }
      const i3 = i * 3, i4 = i * 4, b = this.beh[i];
      const p = this.p, v = this.v;
      let alpha = this.c[i4 + 3], size = this.size0[i] + (this.size1[i] - this.size0[i]) * u, extra = 0;
      if (b === B.DUST) {
        const k = Math.exp(-2.2 * dt);
        v[i3] *= k; v[i3 + 2] *= k; v[i3 + 1] = v[i3 + 1] * k + 0.05 * dt;
        alpha *= (1 - u) * smooth(0, 0.12, u);
      } else if (b === B.BIT || b === B.FALL) {
        if (this.rest[i] < 0) {
          if (b === B.BIT) {
            const k = Math.exp(-1.6 * dt);
            v[i3] *= k; v[i3 + 2] *= k;
            v[i3 + 1] = Math.max(-0.9, v[i3 + 1] - 5.5 * dt);
          } else { // a falling leaf: slow, swaying and turning
            const t = this.life[i] + this.seed[i];
            v[i3] = Math.sin(t * 1.9) * 0.55; v[i3 + 2] = Math.cos(t * 1.3) * 0.35;
            v[i3 + 1] = -0.55 - 0.25 * Math.sin(t * 3.8);
          }
          this.rot[i] += this.spin[i] * dt;
          const g = T.heightAt(p[i3], p[i3 + 2]);
          if (p[i3 + 1] + v[i3 + 1] * dt <= Math.max(g, 0) + 0.02) {
            p[i3 + 1] = Math.max(g, 0) + 0.02; this.rest[i] = this.life[i];
            v[i3] = v[i3 + 1] = v[i3 + 2] = 0;
            // lies a moment, then fades
            this.max[i] = Math.min(this.max[i], this.life[i] + (b === B.FALL ? 3 : 1.2));
          }
        }
        alpha *= 1 - smooth(0.75, 1, u);
      } else if (b === B.DROP) {
        v[i3 + 1] -= 9.8 * dt;
        if (p[i3 + 1] < 0 && v[i3 + 1] < 0) { this.kill(i); continue; }
      } else if (b === B.RING) {
        extra = 0.15 + 0.8 * Math.sqrt(u);
        alpha *= 1 - u;
      } else if (b === B.SPARK) {
        const k = Math.exp(-2.8 * dt);
        v[i3] *= k; v[i3 + 1] = v[i3 + 1] * k + 0.3 * dt; v[i3 + 2] *= k;
        alpha *= (1 - u) * (0.65 + 0.35 * Math.sin(this.life[i] * 22 + this.seed[i]));
        this.rot[i] += this.spin[i] * 0.3 * dt;
      }
      p[i3] += v[i3] * dt; p[i3 + 1] += v[i3 + 1] * dt; p[i3 + 2] += v[i3 + 2] * dt;
      SP[0] = p[i3]; SP[1] = p[i3 + 1]; SP[2] = p[i3 + 2];
      SP[3] = this.c[i4]; SP[4] = this.c[i4 + 1]; SP[5] = this.c[i4 + 2]; SP[6] = alpha;
      SP[7] = size; SP[8] = this.shape[i]; SP[9] = this.rot[i]; SP[10] = extra;
      out.put();
    }
  }
}

// ---------------------------------------------------------------- mist over the lake

// Soft wisps standing on the open water, turned to the camera round the vertical, so
// they read as a veil from the path; from a high camera they fade out (see vNear).

const MIST_VERT = /* glsl */ `
attribute vec4 aWisp; // x, z, width, height
varying vec2 vUv;
varying float vSeed;
varying float vNear;
#include <fog_pars_vertex>
uniform float uTime;
void main() {
  vSeed = fract(aWisp.x * 0.137 + aWisp.y * 0.071);
  vec3 c = vec3(aWisp.x + sin(uTime * 0.05 + vSeed * 6.3) * 3.0, 0.0, aWisp.y + cos(uTime * 0.04 + vSeed * 4.1) * 2.0);
  vec3 toCam = cameraPosition - c;
  vec2 h = normalize(toCam.xz + vec2(1e-4, 0.0));
  vec3 right = vec3(-h.y, 0.0, h.x);
  vec3 p = c + right * position.x * aWisp.z + vec3(0.0, (position.y + 0.5) * aWisp.w, 0.0);
  vUv = position.xy + 0.5;
  // near the camera it thins out, and seen from high above (a steep look down at a
  // camera-facing wisp would lay a hard white streak across the water) it fades away
  float steep = abs(toCam.y) / max(length(toCam), 1e-3);
  vNear = smoothstep(4.0, 14.0, length(toCam)) * (1.0 - smoothstep(0.35, 0.7, steep));
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const MIST_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAmount;
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
varying float vNear;
#include <fog_pars_fragment>
float mh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float mn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mh(i), mh(i + vec2(1.0, 0.0)), f.x), mix(mh(i + vec2(0.0, 1.0)), mh(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float side = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
  float up = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y));
  float n = mn(vec2(vUv.x * 3.0 + uTime * 0.03 + vSeed * 9.0, vUv.y * 1.6 - uTime * 0.02)) * 0.65
          + mn(vec2(vUv.x * 7.0 - uTime * 0.05 + vSeed * 3.0, vUv.y * 3.5)) * 0.35;
  float a = uAmount * side * up * smoothstep(0.25, 0.75, n) * vNear;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

function makeMist(T, count) {
  // open water with no land within 4 m, round the island (static spots)
  const spots = [];
  const b = { x0: -62, x1: 82, z0: -60, z1: 60 };
  const open = (x, z) => {
    if (!T.isWater(x, z) || T.heightAt(x, z) > -0.3) return false;
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      if (!T.isWater(x + Math.cos(a) * 4, z + Math.sin(a) * 4)) return false;
    }
    return true;
  };
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let tries = 0; tries < 4000 && spots.length < count; tries++) {
    const x = b.x0 + (b.x1 - b.x0) * rand(), z = b.z0 + (b.z1 - b.z0) * rand();
    if (!open(x, z)) continue;
    if (spots.some((s) => Math.hypot(s[0] - x, s[1] - z) < 9)) continue;
    spots.push([x, z, 9 + 10 * rand(), 1.3 + 1.4 * rand()]);
  }
  const g = new THREE.InstancedBufferGeometry();
  const plane = new THREE.PlaneGeometry(1, 1);
  g.index = plane.index;
  g.setAttribute('position', plane.getAttribute('position'));
  g.setAttribute('aWisp', new THREE.InstancedBufferAttribute(new Float32Array(spots.flat()), 4));
  g.instanceCount = spots.length;
  const uniforms = {
    uColor: { value: new THREE.Color() }, uAmount: { value: 0 }, uTime: { value: 0 },
    fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 }, fogDensity: { value: 0 },
  };
  const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms, vertexShader: MIST_VERT, fragmentShader: MIST_FRAG,
    transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
  }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.name = 'fx-mist';
  mesh.visible = false;
  return { mesh, uniforms, count: spots.length };
}

// ---------------------------------------------------------------- noon heat shimmer

// A curtain standing across the view some way ahead: behind it (depth-tested) the
// picture drawn so far is copied and drawn again with a small rising ripple, so the far
// lawn and tree line wobble in the heat. Only the band of rows the curtain covers is
// copied (its height rounded up to 128 pixels, so the copy's texture is rarely remade).
// Only on while the sky says it is hazy.
const SHIMMER_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const SHIMMER_FRAG = /* glsl */ `
uniform sampler2D uFrame;
uniform vec2 uRes;
uniform vec2 uBand; // first row and height of the copied band
uniform float uTime;
uniform float uAmp;
varying vec2 vUv;
void main() {
  float edge = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x) * smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.3, 0.95, vUv.y));
  vec2 f = gl_FragCoord.xy;
  float w = sin(f.y * 0.19 - uTime * 6.5 + 3.0 * sin(f.x * 0.011 + uTime * 0.6)) * 0.65
          + sin(f.y * 0.43 - uTime * 10.0 + f.x * 0.017) * 0.35;
  vec2 uv = vec2(f.x / uRes.x, (f.y - uBand.x) / uBand.y);
  vec2 off = vec2(w / uRes.x, 0.3 * w / uBand.y) * uAmp * edge;
  gl_FragColor = texture2D(uFrame, uv + off);
}
`;

function makeShimmer() {
  const uniforms = { uFrame: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uBand: { value: new THREE.Vector2(0, 1) }, uTime: { value: 0 }, uAmp: { value: 0 } };
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    uniforms, vertexShader: SHIMMER_VERT, fragmentShader: SHIMMER_FRAG,
    transparent: true, depthWrite: false, depthTest: true, fog: false,
  }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 30; // after everything else in the world
  mesh.name = 'fx-shimmer';
  mesh.visible = false;
  const size = new THREE.Vector2(), at = new THREE.Vector2();
  const band = { lo: 0, hi: 1 }; // rows (0..1 of the height, from the bottom) the curtain covers, set by update
  let tex = null, failed = false;
  mesh.onBeforeRender = (renderer) => {
    if (failed) return;
    try {
      renderer.getDrawingBufferSize(size);
      const H = size.y;
      const want = Math.min(H, Math.ceil(((band.hi - band.lo) * H + 16) / 128) * 128);
      if (!tex || tex.image.width !== size.x || tex.image.height !== want) {
        if (tex) tex.dispose();
        tex = new THREE.FramebufferTexture(size.x, want);
        tex.minFilter = tex.magFilter = THREE.LinearFilter;
        uniforms.uFrame.value = tex;
      }
      const y0 = Math.max(0, Math.min(H - want, Math.floor(band.lo * H) - 8));
      uniforms.uRes.value.copy(size);
      uniforms.uBand.value.set(y0, want);
      renderer.copyFramebufferToTexture(at.set(0, y0), tex);
    } catch (e) {
      failed = true; // no copy on this device: no shimmer
      mesh.visible = false;
      console.warn('fx.js: no heat shimmer here:', e);
    }
  };
  return { mesh, uniforms, band, get failed() { return failed; } };
}

// ---------------------------------------------------------------- build

export function build(game) {
  const { data, player, sky, events } = game;
  const T = data.terrain;
  const top = FLAGS.view === 'top';
  const group = new THREE.Group();
  group.name = 'fx';
  const stats = { drawCalls: 0, sprites: 0, particles: 0, butterflies: 0, dragonflies: 0, fireflies: 0, mist: 0, shimmer: false };
  if (top) {
    group.visible = false;
    return { group, stats, update() {}, burst() {} };
  }

  const soft = new Sprites(FX.soft, false), glow = new Sprites(FX.glow, true);
  const softP = new Particles(FX.soft - 40), glowP = new Particles(FX.glow - 40);
  group.add(soft.points, glow.points);
  const mist = makeMist(T, FX.mist);
  const shimmer = makeShimmer();
  const fogged = [soft.uniforms, glow.uniforms, mist.uniforms];
  group.add(mist.mesh, shimmer.mesh);
  stats.mist = mist.count;

  const fields = game.terrain && game.terrain.fields;
  const toWater = fields ? fields.toWater : null;
  const waterDist = (x, z) => {
    if (!toWater) return 9;
    const i = T.cellIndex(x, z);
    return i < 0 ? 9 : toWater[i];
  };

  // what the effects gather round: mounds (bushes), ferns and flowers
  const mounds = ((game.veg && game.veg.hosts && game.veg.hosts.mounds) || []).filter((m) => m.h > 0.35 && m.r > 0.3);
  const instancePositions = (obj) => {
    const out = [];
    if (!obj || !obj.isInstancedMesh) return out;
    obj.updateMatrixWorld(true);
    const a = obj.instanceMatrix.array, w = obj.matrixWorld.elements;
    for (let k = 0; k < obj.count; k++) {
      const x = a[k * 16 + 12], y = a[k * 16 + 13], z = a[k * 16 + 14];
      out.push(w[0] * x + w[4] * y + w[8] * z + w[12], w[1] * x + w[5] * y + w[9] * z + w[13], w[2] * x + w[6] * y + w[10] * z + w[14]);
    }
    return Float32Array.from(out);
  };
  const ferns = instancePositions(game.veg && game.veg.group ? game.veg.group.getObjectByName('veg-fern') : null);
  const flowers = instancePositions(game.terrain && game.terrain.mesh ? game.terrain.mesh.getObjectByName('decor-flowers') : null);

  // colours (linear)
  const C = (h) => new THREE.Color(h);
  const DUST = C('#f7ecd2'), SPLASH = C('#dff6f2'), RING = C('#f4fffb');
  const LEAVES = ['#5fae45', '#7cc452', '#4e9a3e', '#a7c957', '#c9b458', '#b5854b'].map(C);
  const SPARKS = ['#fff2a8', '#ffd35c', '#ffffff', '#ffe7f0'].map(C);
  const WINGS = ['#ffcf3f', '#ff9a3c', '#fff6e0', '#9fd3ff', '#ffb3d9'].map(C);
  const DRAGONS = ['#2fb6c9', '#3d7fe0', '#d9453b'].map(C);
  const FIREFLY = C('#e8ff7a');
  const pickOf = (list) => list[(Math.random() * list.length) | 0];

  // ---- emitters

  function leafPuff(x, y, z, n, dx = 0, dz = 0, speed = 1.3) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * 6.283;
      const vx = Math.cos(a) * speed * rnd(0.3, 1) + dx * speed, vz = Math.sin(a) * speed * rnd(0.3, 1) + dz * speed;
      softP.add(B.BIT, S.LEAF, x + rnd(-0.1, 0.1), y + rnd(-0.1, 0.15), z + rnd(-0.1, 0.1), vx, rnd(1.0, 2.2), vz, rnd(1.6, 2.6), rnd(0.13, 0.19), rnd(0.13, 0.19), pickOf(LEAVES), 1);
    }
  }
  function dust(x, y, z, n) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * 6.283, s = rnd(0.2, 0.55);
      // a little off the ground, so the sprite's lower half is not lost in it
      softP.add(B.DUST, S.PUFF, x + rnd(-0.1, 0.1), y + 0.16, z + rnd(-0.1, 0.1), Math.cos(a) * s, rnd(0.2, 0.45), Math.sin(a) * s, rnd(0.9, 1.3), rnd(0.32, 0.45), rnd(0.9, 1.2), DUST, 0.72);
    }
  }
  function splash(x, z, n) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * 6.283, s = rnd(0.3, 0.9);
      softP.add(B.DROP, S.DROP, x, 0.03, z, Math.cos(a) * s, rnd(1.4, 2.5), Math.sin(a) * s, 1.2, 0.085, 0.06, SPLASH, 0.9);
    }
    softP.add(B.RING, S.RING, x, 0.015, z, 0, 0, 0, 0.9, 1.3, 1.6, RING, 0.7);
  }
  function sparkle(x, y, z, n, spread = 0.25) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * 6.283, e = rnd(-0.3, 1), s = rnd(0.6, 1.5);
      glowP.add(B.SPARK, S.SPARK, x + rnd(-spread, spread), y + rnd(-spread, spread), z + rnd(-spread, spread),
        Math.cos(a) * s * Math.sqrt(1 - e * e), e * s + 0.3, Math.sin(a) * s * Math.sqrt(1 - e * e), rnd(0.9, 1.4), rnd(0.26, 0.36), 0.08, pickOf(SPARKS), 1);
    }
  }

  // ---- the world's small animals

  const flies = []; // butterflies; the first FX.nearFlies keep near the player, in view
  for (let k = 0; k < FX.butterflies; k++) flies.push({ on: false, near: k < FX.nearFlies, x: 0.5, y: 0.5, z: 0.5, gy: 0.5, gT: 0, hx: 0.5, hz: 0.5, a: 0.5, phase: Math.random() * 9, rate: rnd(11, 16), col: pickOf(WINGS), seed: Math.random() * 50, show: 0.5 });
  const dragons = [];
  for (let k = 0; k < FX.dragonflies; k++) dragons.push({ on: false, x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, hold: 0, rot: 0, col: pickOf(DRAGONS), show: 0, seed: Math.random() * 50 });
  const bugs = []; // fireflies
  for (let k = 0; k < FX.fireflies; k++) bugs.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vz: 0, gy: 0, phase: Math.random() * 5, period: rnd(1.8, 4.2), show: 0 });

  // Is (x, z) within about 60 degrees of where the camera looks, seen from the player?
  const inView = (x, z, px, pz) => {
    const dx = x - px, dz = z - pz, l = Math.sqrt(dx * dx + dz * dz) || 1;
    const fl = Math.sqrt(camFwd.x * camFwd.x + camFwd.z * camFwd.z) || 1;
    return (dx * camFwd.x + dz * camFwd.z) / (l * fl) > 0.5;
  };
  // A butterfly's home flowers: far ones 5 to 26 m off; a near one a flower 2 to 6 m from
  // the player in view (one picked at random from a scan of the drifts), or failing that
  // open lawn 2 to 5 m ahead, so there is usually one fluttering in the picture.
  function placeFly(f, px, pz) {
    if (f.near) {
      let pick = -1, seen = 0;
      for (let k = 0; k < flowers.length; k += 3) {
        const dx = flowers[k] - px, dz = flowers[k + 2] - pz, d2 = dx * dx + dz * dz;
        if (d2 < 4 || d2 > 36 || !inView(flowers[k], flowers[k + 2], px, pz)) continue;
        if (Math.random() * ++seen < 1) pick = k; // an even pick without a list
      }
      let hx, hy, hz;
      if (pick >= 0) { hx = flowers[pick]; hy = flowers[pick + 1]; hz = flowers[pick + 2]; } else {
        const yaw = Math.atan2(camFwd.z, camFwd.x);
        let ok = false;
        for (let t = 0; t < 8 && !ok; t++) {
          const a = yaw + rnd(-0.9, 0.9), d = rnd(2, 5);
          hx = px + Math.cos(a) * d; hz = pz + Math.sin(a) * d;
          ok = T.isWalkable(hx, hz) && T.canopyAt(hx, hz) < 3 && pathMask(hx, hz) < 0.5;
        }
        if (!ok) return false;
        hy = T.heightAt(hx, hz);
      }
      f.hx = hx; f.hz = hz; f.x = hx + rnd(-0.8, 0.8); f.z = hz + rnd(-0.8, 0.8); f.y = hy + 0.6; f.a = Math.random() * 6.283;
      f.on = true; f.show = 0; f.gT = 0;
      return true;
    }
    if (!flowers.length) return false;
    for (let t = 0; t < 12; t++) {
      const k = ((Math.random() * flowers.length / 3) | 0) * 3;
      const x = flowers[k], z = flowers[k + 2];
      const dx = x - px, dz = z - pz, d = Math.sqrt(dx * dx + dz * dz);
      if (d < 5 || d > 26) continue;
      f.hx = x; f.hz = z; f.x = x + rnd(-1, 1); f.z = z + rnd(-1, 1); f.y = flowers[k + 1] + 0.6; f.a = Math.random() * 6.283;
      f.on = true; f.show = 0; f.gT = 0;
      return true;
    }
    return false;
  }
  // water near a shore (land within 4 m) and 5 to 22 m from the player
  function shoreWater(px, pz, out) {
    for (let t = 0; t < 10; t++) {
      const a = Math.random() * 6.283, d = rnd(5, 22);
      const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
      if (!T.isWater(x, z)) continue;
      let land = false;
      for (let k = 0; k < 6 && !land; k++) { const b = k * 1.047; land = !T.isWater(x + Math.cos(b) * 3.5, z + Math.sin(b) * 3.5); }
      if (!land) continue;
      out.x = x; out.z = z;
      return true;
    }
    return false;
  }
  const spot = { x: 0, z: 0 };
  function placeDragon(f, px, pz) {
    if (!shoreWater(px, pz, spot)) return false;
    f.x = f.tx = spot.x; f.z = f.tz = spot.z; f.y = f.ty = rnd(0.35, 1.1); f.hold = rnd(0.5, 2); f.on = true; f.show = 0;
    return true;
  }
  function placeBug(f, px, pz) {
    const yaw = Math.atan2(camFwd.z, camFwd.x); // most of them where the player is looking
    for (let t = 0; t < 8; t++) {
      const a = Math.random() < 0.75 ? yaw + rnd(-1.1, 1.1) : Math.random() * 6.283, d = rnd(3, 20);
      const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
      if (!T.isWalkable(x, z) || T.canopyAt(x, z) > 6) continue;
      f.x = x; f.z = z; f.gy = T.heightAt(x, z); f.y = f.gy + rnd(0.3, 1.6);
      const b = Math.random() * 6.283; f.vx = Math.cos(b) * 0.25; f.vz = Math.sin(b) * 0.25;
      f.on = true; f.show = 0;
      return true;
    }
    return false;
  }

  // ---- triggers

  // The running timers live in a typed array: a number kept in a closure's own variable
  // would be boxed afresh every time it changes. T_STEP: metres since the last footfall,
  // T_LEAF: seconds to the next falling leaf, T_PLACE: to the next placing of animals;
  // T_BRUSH, T_SPLASH: seconds since the last swish and plash, T_OFF: out of touch with
  // any bush, T_SCAN: to the next look for one.
  const TM = new Float64Array(7), T_STEP = 0, T_LEAF = 1, T_PLACE = 2, T_BRUSH = 3, T_SPLASH = 4, T_OFF = 5, T_SCAN = 6;
  TM[T_LEAF] = rnd(FX.leafEvery[0], FX.leafEvery[1]); TM[T_BRUSH] = TM[T_SPLASH] = TM[T_OFF] = 9;
  let foot = 1;
  let fringe = false; // the last footfall was in the water's fringe (the first one into it may plash sooner)
  const camRight = new THREE.Vector3(), camUp = new THREE.Vector3(), camFwd = new THREE.Vector3(0, 0, -1), proj = new THREE.Vector3();
  const pxSize = new THREE.Vector2();
  const reduced = () => !!(state.settings && state.settings.reducedMotion);

  // a step: dust when running on a path, a plash at the water's edge (paced)
  function onStep(x, z, mode) {
    const wd = waterDist(x, z);
    if (wd < 0.7) {
      const fresh = !fringe;
      fringe = true;
      if (TM[T_SPLASH] < (fresh ? FX.splash.fresh : FX.splash.every)) return;
      // towards the water, down the distance field
      const ex = waterDist(x + 0.3, z) - waterDist(x - 0.3, z), ez = waterDist(x, z + 0.3) - waterDist(x, z - 0.3);
      const l = Math.sqrt(ex * ex + ez * ez) || 1;
      const reach = wd + 0.15;
      const sx = x - (ex / l) * reach, sz = z - (ez / l) * reach;
      if (T.isWater(sx, sz)) {
        TM[T_SPLASH] = 0;
        if (!reduced()) splash(sx, sz, mode === 'jog' ? 7 : 4);
        events.emit('fx:splash', sx, sz, mode === 'jog' ? 1 : mode === 'creep' ? 0.45 : 0.75); // its plash (src/audio)
      }
      return;
    }
    fringe = false;
    if (mode === 'jog' && !reduced() && pathMask(x, z) > 0.3) dust(x, T.heightAt(x, z), z, 3);
  }

  // Brushing past a bush or through a fern: finds the one touched (into hit) or false.
  const hit = { x: 0, y: 0, z: 0, dx: 0, dz: 0, fern: false };
  function brushFind(px, pz) {
    let best = null, bd = 1e9;
    for (let k = 0; k < mounds.length; k++) {
      const m = mounds[k];
      const dx = px - m.x, dz = pz - m.z, d = Math.sqrt(dx * dx + dz * dz) - m.r;
      if (d < 0.5 && d < bd) { bd = d; best = m; }
    }
    if (best) {
      const dx = px - best.x, dz = pz - best.z, l = Math.sqrt(dx * dx + dz * dz) || 1;
      hit.x = best.x + (dx / l) * best.r; hit.z = best.z + (dz / l) * best.r;
      hit.y = T.heightAt(hit.x, hit.z) + Math.min(0.9, best.h * 0.55);
      hit.dx = dx / l; hit.dz = dz / l; hit.fern = false;
      return true;
    }
    for (let k = 0; k < ferns.length; k += 3) {
      const dx = px - ferns[k], dz = pz - ferns[k + 2];
      if (dx * dx + dz * dz < 0.45) {
        hit.x = ferns[k]; hit.y = ferns[k + 1] + 0.3; hit.z = ferns[k + 2]; hit.dx = hit.dz = 0; hit.fern = true;
        return true;
      }
    }
    return false;
  }
  // a puff and its swish: on first touch, then every FX.brush.every s while it lasts
  // (sooner at a run, by the square root of the speed)
  function brushTick(dt, p) {
    TM[T_BRUSH] += dt; TM[T_SCAN] -= dt;
    if (TM[T_SCAN] > 0) return;
    TM[T_SCAN] = 0.1;
    if (!(player.speed > 0.6 && !player.frozen && brushFind(p.x, p.z))) { TM[T_OFF] += 0.1; return; }
    const fresh = TM[T_OFF] > 0.3;
    TM[T_OFF] = 0;
    const every = FX.brush.every * Math.sqrt(2 / Math.max(2, player.speed));
    if (TM[T_BRUSH] < (fresh ? FX.brush.fresh : every)) return;
    TM[T_BRUSH] = 0;
    const run = player.mode === 'jog';
    if (!reduced()) {
      if (hit.fern) leafPuff(hit.x, hit.y, hit.z, run ? 4 : 3, 0, 0, 0.8);
      else leafPuff(hit.x, hit.y, hit.z, run ? 5 : 3, hit.dx * 0.4, hit.dz * 0.4, 1.0);
    }
    events.emit('fx:brush', hit.x, hit.z, hit.fern ? (run ? 0.75 : 0.55) : run ? 1 : 0.7); // its swish (src/audio)
  }

  // a lizard slipping out of sight into the leaves rustles them
  events.on('lizard:hidden', (lz, where) => {
    if (!where || !where.away) return;
    const p = player.position;
    const dx = where.x - p.x, dz = where.z - p.z;
    if (reduced() || dx * dx + dz * dz > 22 * 22) return;
    leafPuff(where.x, where.y + 0.05, where.z, 3, 0, 0, 0.7);
  });

  // a new species: sparkles round it (spotted) or round the player (caught)
  const head = new THREE.Vector3();
  const rec = (e) => {
    const s = state.species || {};
    return (e && ((e.key && s[e.key]) || (e.species && s[e.species]))) || null;
  };
  events.on('lizard:spotted', (e) => {
    if (!e || e.quiet || !e.lizard) return;
    const r = rec(e);
    if (!r || (r.spotted || 0) + (r.caught || 0) > 1) return;
    e.lizard.headPosition(head);
    sparkle(head.x, head.y + 0.1, head.z, reduced() ? 8 : 18, 0.15);
  });
  events.on('lizard:caught', (e) => {
    if (!e || !e.bonus || !e.bonus.first) return;
    player.headPosition(head);
    sparkle(head.x, head.y + 0.2, head.z, reduced() ? 10 : 24, 0.35);
  });

  // ---- sparkles round an ink stamp, in the page
  const STAR = '<svg viewBox="-10 -10 20 20" width="100%" height="100%" aria-hidden="true"><path d="M0-10C1 -2 2 -1 10 0C2 1 1 2 0 10C-1 2 -2 1 -10 0C-2 -1 -1 -2 0-10Z" fill="currentColor"/></svg>';
  const pagePool = [];
  function pageSparkles(el) {
    if (reduced() || !el || typeof el.getBoundingClientRect !== 'function' || typeof el.animate !== 'function') return;
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = Math.max(40, r.width * 0.5);
    const px = Math.round(Math.min(34, Math.max(14, r.width * 0.075)));
    let box = pagePool.find((b) => !b.busy);
    if (!box) {
      if (pagePool.length >= 3) return;
      const div = document.createElement('div');
      div.className = 'fx-sparkles';
      div.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:60';
      const stars = [];
      for (let k = 0; k < 10; k++) {
        const s = document.createElement('span');
        s.style.cssText = 'position:absolute;left:-8px;top:-8px;width:16px;height:16px;opacity:0;color:#ffd35c;filter:drop-shadow(0 0 3px rgba(255,236,160,.9))';
        s.innerHTML = STAR;
        div.appendChild(s);
        stars.push(s);
      }
      box = { div, stars, busy: false };
      pagePool.push(box);
    }
    box.busy = true;
    const host = el.parentNode || document.getElementById('ui') || document.body;
    host.appendChild(box.div);
    box.div.style.left = cx + 'px';
    box.div.style.top = cy + 'px';
    let left = box.stars.length;
    box.stars.forEach((s, k) => {
      const a = (k / box.stars.length) * Math.PI * 2 + Math.random() * 0.5;
      const d = R * rnd(0.8, 1.35), sc = rnd(0.6, 1.2);
      s.style.color = k % 3 === 0 ? '#ffffff' : k % 3 === 1 ? '#ffd35c' : '#ff9fc4';
      s.style.width = s.style.height = px + 'px';
      s.style.left = s.style.top = -px / 2 + 'px';
      const anim = s.animate([
        { transform: 'translate(0px, 0px) scale(0.2) rotate(0deg)', opacity: 0 },
        { transform: `translate(${(Math.cos(a) * d * 0.55).toFixed(1)}px, ${(Math.sin(a) * d * 0.55).toFixed(1)}px) scale(${sc.toFixed(2)}) rotate(45deg)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${(Math.cos(a) * d).toFixed(1)}px, ${(Math.sin(a) * d).toFixed(1)}px) scale(0.1) rotate(90deg)`, opacity: 0 },
      ], { duration: 900 + 200 * Math.random(), delay: 180 + 60 * Math.random(), easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' });
      anim.onfinish = () => { if (--left === 0) { box.busy = false; box.div.remove(); } };
    });
  }
  events.on('ui:stamp', () => {
    const list = document.querySelectorAll('.ui-stamps .stamp');
    pageSparkles(list.length ? list[list.length - 1] : null);
  });

  // ---- per frame

  function update(dt, t) {
    if (dt <= 0) return;
    const cam = game.camera;
    const st = sky && sky.state;
    const lessen = reduced();
    const p = player.position;
    const sunUp = st ? smooth(-0.02, 0.2, st.sunDir.y) : 1;
    const dusk = st ? st.dusk || 0 : 0;
    // camera basis: where the animals gather and the dragonflies' heading on screen
    if (cam) {
      const e = cam.matrixWorld.elements;
      camRight.set(e[0], e[1], e[2]); camUp.set(e[4], e[5], e[6]); camFwd.set(-e[8], -e[9], -e[10]);
    }

    // triggers from the player's feet (the sounds go with reduced motion too)
    TM[T_SPLASH] += dt;
    const moving = player.speed > 0.35 && !player.frozen;
    if (moving) {
      TM[T_STEP] += player.speed * dt;
      const stride = player.mode === 'jog' ? 0.85 : player.mode === 'creep' ? 0.4 : 0.6;
      if (TM[T_STEP] > stride) {
        TM[T_STEP] = 0; foot = -foot;
        const h = player.heading, sx = Math.cos(h) * 0.12 * foot, sz = -Math.sin(h) * 0.12 * foot;
        onStep(p.x + sx, p.z + sz, player.mode);
      }
    }
    brushTick(dt, p);

    // a leaf falling from the canopy near the player now and then
    TM[T_LEAF] -= dt;
    if (TM[T_LEAF] <= 0) {
      TM[T_LEAF] = rnd(FX.leafEvery[0], FX.leafEvery[1]);
      for (let k = 0; k < 4 && !lessen; k++) {
        const a = Math.random() * 6.283, d = rnd(2, 13);
        const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
        const c = T.canopyAt(x, z);
        if (c < 4) continue;
        const i = softP.add(B.FALL, S.LEAF, x, T.heightAt(x, z) + c * rnd(0.6, 0.85), z, 0, -0.6, 0, 60, 0.17, 0.17, pickOf(LEAVES), 1);
        if (i >= 0) softP.spin[i] = rnd(-2.5, 2.5);
        break;
      }
    }

    // butterflies by day, dragonflies over the shallows by day, fireflies at dusk (none
    // with reduced motion: those on show fade away)
    TM[T_PLACE] -= dt;
    const place = TM[T_PLACE] <= 0;
    if (place) TM[T_PLACE] = 0.5;
    const many = lessen ? 0 : 1;
    const nFly = Math.round(many * FX.butterflies * sunUp * (1 - smooth(0.4, 0.9, dusk)));
    const nDragon = Math.round(many * FX.dragonflies * sunUp * (1 - smooth(0.2, 0.7, dusk)));
    const nBug = Math.round(many * FX.fireflies * smooth(0.25, 0.7, dusk));
    stats.butterflies = stats.dragonflies = stats.fireflies = 0;

    soft.begin(); glow.begin();
    const light = 0.5 + 0.5 * sunUp;

    for (let k = 0; k < flies.length; k++) {
      const f = flies[k];
      const want = k < nFly;
      if (!f.on) { if (want && place) placeFly(f, p.x, p.z); if (!f.on) continue; }
      const ox = f.x - p.x, oz = f.z - p.z;
      // a near one left behind flies off (fades) and comes back near the player
      if (ox * ox + oz * oz > (f.near ? 14 * 14 : 32 * 32)) { if (!f.near || f.show <= 0) { f.on = false; continue; } f.show = Math.max(0, f.show - dt * 1.5); }
      f.show = Math.min(1, Math.max(0, f.show + (want ? dt : -dt) * 0.8));
      if (f.show <= 0 && !want) { f.on = false; continue; }
      // a fluttering random walk that keeps near its flowers
      f.a += (Math.sin(t * 1.3 + f.seed) * 2.2 + (Math.random() - 0.5) * 3) * dt;
      const hx = f.hx - f.x, hz = f.hz - f.z;
      if (hx * hx + hz * hz > 2.2 * 2.2) {
        let d = Math.atan2(hz, hx) - f.a;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        f.a += d * Math.min(1, 2.5 * dt);
      }
      const sp = 0.8 + 0.3 * Math.sin(t * 2 + f.seed);
      f.x += Math.cos(f.a) * sp * dt; f.z += Math.sin(f.a) * sp * dt;
      if ((f.gT -= dt) <= 0) { f.gT = 0.2; f.gy = T.heightAt(f.x, f.z); } // the ground under it, a few times a second
      const gy = f.gy;
      f.y += (gy + 0.55 + 0.35 * Math.sin(t * 0.9 + f.seed) - f.y) * Math.min(1, 1.5 * dt) + Math.sin(t * 9 + f.seed) * 0.25 * dt;
      f.phase += f.rate * dt;
      SP[0] = f.x; SP[1] = f.y; SP[2] = f.z; SP[3] = f.col.r; SP[4] = f.col.g; SP[5] = f.col.b; SP[6] = f.show;
      SP[7] = FX.flySize; SP[8] = S.FLY; SP[9] = 0.25 * Math.sin(t * 3 + f.seed); SP[10] = 0.2 + 0.8 * Math.abs(Math.sin(f.phase)); // how open
      soft.put();
      stats.butterflies++;
    }

    for (let k = 0; k < dragons.length; k++) {
      const f = dragons[k];
      const want = k < nDragon;
      if (!f.on) { if (want && place) placeDragon(f, p.x, p.z); if (!f.on) continue; }
      const ox = f.x - p.x, oz = f.z - p.z;
      if (ox * ox + oz * oz > 30 * 30) { f.on = false; continue; }
      f.show = Math.min(1, Math.max(0, f.show + (want ? dt : -dt)));
      if (f.show <= 0 && !want) { f.on = false; continue; }
      // hover, then dart to a new spot over the water nearby
      f.hold -= dt;
      if (f.hold <= 0) {
        f.hold = rnd(0.6, 2.4);
        for (let tt = 0; tt < 5; tt++) {
          const a = Math.random() * 6.283, d = rnd(1.2, 3.5);
          const x = f.x + Math.cos(a) * d, z = f.z + Math.sin(a) * d;
          if (T.isWater(x, z)) { f.tx = x; f.tz = z; f.ty = rnd(0.3, 1.1); break; }
        }
      }
      const dx = f.tx - f.x, dy = f.ty - f.y, dz = f.tz - f.z;
      const k2 = Math.min(1, 7 * dt);
      const vx = dx * k2, vy = dy * k2, vz = dz * k2;
      f.x += vx; f.y += vy; f.z += vz;
      f.y += Math.sin(t * 13 + f.seed) * 0.02;
      if (cam && vx * vx + vz * vz > 1e-6) {
        const sxp = vx * camRight.x + vy * camRight.y + vz * camRight.z, syp = vx * camUp.x + vy * camUp.y + vz * camUp.z;
        if (sxp * sxp + syp * syp > 1e-7) f.rot = Math.atan2(syp, sxp);
      }
      SP[0] = f.x; SP[1] = f.y; SP[2] = f.z; SP[3] = f.col.r; SP[4] = f.col.g; SP[5] = f.col.b; SP[6] = f.show;
      SP[7] = 0.2; SP[8] = S.DRAGON; SP[9] = -f.rot; SP[10] = 0.5 + 0.5 * Math.sin(t * 40 + f.seed);
      soft.put();
      stats.dragonflies++;
    }

    for (let k = 0; k < bugs.length; k++) {
      const f = bugs[k];
      const want = k < nBug;
      if (!f.on) { if (want && place) placeBug(f, p.x, p.z); if (!f.on) continue; }
      const ox = f.x - p.x, oz = f.z - p.z;
      if (ox * ox + oz * oz > 26 * 26) { f.on = false; continue; }
      f.show = Math.min(1, Math.max(0, f.show + (want ? dt : -dt) * 0.5));
      if (f.show <= 0 && !want) { f.on = false; continue; }
      const b = Math.sin(t * 0.7 + k) * 0.8 * dt;
      const c = Math.cos(b), s = Math.sin(b);
      const vx = f.vx * c - f.vz * s, vz = f.vx * s + f.vz * c;
      f.vx = vx; f.vz = vz;
      f.x += vx * dt; f.z += vz * dt;
      f.y += Math.sin(t * 1.1 + k * 1.7) * 0.12 * dt;
      f.y = Math.min(Math.max(f.y, f.gy + 0.25), f.gy + 2);
      f.phase += dt;
      // a quick blink early in each period (two smoothsteps, written out so no number
      // comes back boxed from a call in this hot loop)
      const ph = (f.phase % f.period) / f.period;
      const b0 = Math.min(1, ph / 0.08), b1 = Math.min(1, Math.max(0, (ph - 0.12) / 0.18));
      const blink = b0 * b0 * (3 - 2 * b0) * (1 - b1 * b1 * (3 - 2 * b1));
      SP[0] = f.x; SP[1] = f.y; SP[2] = f.z; SP[3] = FIREFLY.r; SP[4] = FIREFLY.g; SP[5] = FIREFLY.b; SP[6] = f.show * (0.35 + 0.65 * blink);
      SP[7] = 0.36 + 0.16 * blink; SP[8] = S.GLOW; SP[9] = 0; SP[10] = 0;
      glow.put();
      stats.fireflies++;
    }

    softP.step(dt, T, soft);
    glowP.step(dt, T, glow);
    soft.end(); glow.end();
    stats.particles = softP.n + glowP.n;
    stats.sprites = soft.n + glow.n;

    // shader uniforms: pixel scale, light and fog
    // (numbers written only when they change: most frames none do)
    if (cam && cam.isPerspectiveCamera) {
      game.renderer.getDrawingBufferSize(pxSize);
      const sc = pxSize.y * cam.projectionMatrix.elements[5] * 0.5;
      if (soft.uniforms.uScale.value !== sc) soft.uniforms.uScale.value = glow.uniforms.uScale.value = sc;
    }
    if (soft.uniforms.uLight.value !== light) soft.uniforms.uLight.value = light;
    const fog = game.scene.fog;
    if (fog) {
      for (let k = 0; k < fogged.length; k++) {
        const u = fogged[k];
        u.fogColor.value.copy(fog.color);
        if (u.fogNear.value !== fog.near) u.fogNear.value = fog.near;
        if (u.fogFar.value !== fog.far) u.fogFar.value = fog.far;
      }
    }

    // morning mist (none with reduced motion: it drifts)
    const m = st ? st.mist || 0 : 0;
    mist.mesh.visible = !lessen && m > 0.02 && mist.count > 0;
    if (mist.mesh.visible) {
      mist.uniforms.uAmount.value = m * 0.55;
      mist.uniforms.uTime.value = t;
      if (fog) mist.uniforms.uColor.value.copy(fog.color).lerp(WHITE, 0.45);
    }

    // The heat shimmer over the far ground: only in the survey day's heat (the set-up
    // day and the intro hold a late-morning sky with some haze, but no shimmer; plain
    // check views with no story phase keep it), and only while its band is on screen,
    // since each frame it is on copies a strip of the picture.
    const haze = st ? st.haze || 0 : 0;
    const heatPhase = state.phase === 'survey' || state.phase === 'boot' || state.phase == null;
    let shimmerOn = !lessen && heatPhase && !shimmer.failed && haze > 0.25 && cam && cam.isPerspectiveCamera && !(game.renderer.xr && game.renderer.xr.isPresenting);
    if (shimmerOn) {
      const S2 = FX.shimmer;
      camFwd.y = 0;
      if (camFwd.lengthSq() < 1e-6) camFwd.set(0, 0, -1);
      camFwd.normalize();
      const cx = cam.position.x + camFwd.x * S2.distance, cz = cam.position.z + camFwd.z * S2.distance;
      const gy = Math.max(0, T.heightAt(cx, cz));
      // the rows it covers on screen: its foot and its top, straight ahead
      proj.set(cx, gy - 0.6, cz).project(cam);
      let lo = proj.y, hi = proj.y, zOk = proj.z < 1;
      proj.set(cx, gy - 0.6 + S2.height, cz).project(cam);
      lo = Math.min(lo, proj.y); hi = Math.max(hi, proj.y); zOk = zOk && proj.z < 1;
      shimmer.band.lo = Math.max(0, (lo + 1) / 2); shimmer.band.hi = Math.min(1, (hi + 1) / 2);
      if (!zOk || shimmer.band.hi - shimmer.band.lo < 0.01) shimmerOn = false; // behind the camera or off the top or bottom
      else {
        shimmer.mesh.position.set(cx, gy - 0.6 + S2.height / 2, cz);
        shimmer.mesh.rotation.set(0, Math.atan2(-camFwd.x, -camFwd.z), 0);
        shimmer.mesh.scale.set(S2.width, S2.height, 1);
        shimmer.uniforms.uTime.value = t;
        shimmer.uniforms.uAmp.value = S2.amp * smooth(0.25, 0.9, haze) * Math.min(2, game.renderer.getPixelRatio());
      }
    }
    shimmer.mesh.visible = !!shimmerOn;
    stats.shimmer = !!shimmerOn;
    stats.drawCalls = (soft.points.visible ? 1 : 0) + (glow.points.visible ? 1 : 0) + (mist.mesh.visible ? 1 : 0) + (shimmerOn ? 1 : 0);
  }

  // A burst on request (for other modules and checks): 'leaves', 'dust', 'splash', 'sparkle'.
  function burst(kind, x, y, z, n = 6) {
    if (kind === 'leaves') leafPuff(x, y, z, n);
    else if (kind === 'dust') dust(x, y, z, n);
    else if (kind === 'splash') splash(x, z, n);
    else if (kind === 'sparkle') sparkle(x, y, z, n);
  }

  return { group, update, stats, burst, FX };
}

const WHITE = new THREE.Color(1, 1, 1);
