// The RTK plant survey: the lab recorded 317 island plants in June 2026
// with an RTK GNSS rover, an antenna on a 2 m pole with a phone clipped to it, good to
// about 2 cm once it has a fix. James asks for five plants a day, all in one patch of the
// island: each has a gold ring on the ground round its foot with motes circling it (a
// green job marker where to stand and a pulsing dot on the maps). Stand the pole at the
// base of one and the camera eases round to show you and the plant side by side while
// the phone goes SINGLE -> FLOAT -> FIX; any movement puts it back to SINGLE. A mosquito
// buzzes round the phone: press when it lands and it is swatted, or it bites and you
// flinch (back to SINGLE too). A curious ibis may wander up while you wait. Then log the
// plant: its leaf, growth form, family and a hint on the card, and three names to pick
// from, each with its leaf and family (one near miss shares the family or the leaf, so
// both clues decide it); a wrong pick is told what it really was, and the plant is
// recorded either way. The fix, log and end cards hold the day's clock (the walks do
// not). Five logged: stars for names right and a steady pole, and the notebook's plant
// survey page lists every plant recorded with its family and growth form on a little map.
//
// A mission (src/missions/index.js): build(game) -> { id: 'rtk', title, tool: 'rtk',
// available(), start(opts), active, busy, update(dt, t), progress(), notebook(), stats },
// and the tool 'rtk' in the ring (no quick key). Events: mission:start, mission:step
// { step: 'walk' | 'fix' | 'fixed' | 'logged' }, mission:done { stars, points, why:
// 'named' | 'steady' | 'done' (what earned the second star, for James's line) },
// mission:fail { why: 'stopped' } (the day ended mid-survey).
//
// Flags: ?mission=rtk (implies ?phase=survey) starts the survey as the day begins, with
// the player by the first plant; &missionstep=fix holds the fix mid-FLOAT with the
// mosquito landed and the ibis by (for check images), =log opens the log card, =logwrong
// with a wrong name picked, =done the end card, =notebook fills a few records and opens
// the notebook's page; &missiontarget=k picks the plant, &missionback=m how far back.
// window.__game.play.rtk has helpers for scripted runs (targets, goto, plant, auto, frame).

import * as THREE from 'three';
import { events } from '../core/events.js';
import { state, RULES, addScore, dayKey, save, holdClock } from '../game/state.js';
import { missionPoints } from '../game/rules.js';
import * as kit from '../ui/kit.js';
import { registerTool, registerInteraction, equip, current as currentTool } from '../tools/ring.js';
import { getMarkers } from '../tools/markers.js';
import { audio } from '../audio/index.js';
import { icon, escapeHtml, richText } from '../ui/icons.js';
import { SCRIPT, say } from '../story/script.js';
import { registerMission, missionRecord } from './index.js';
import { plantInfo, allNames, leafSketch, FORM_WORD, FAMILY, cap } from './rtk_plants.js';
import { makeToonGradient, TOON_WOOD, vegUniforms } from '../world/wind.js';
import { PIECES } from '../world/props.js';
import { FLAGS } from '../config.js';

// How the survey feels (its points and the fix's pace are in RULES).
const RTK = {
  reach: 1.7, // metres from the stand spot where [E] stands the pole
  standMin: 0.45, standMax: 2.6, // the stand spot's distance out from the plant's collider
  // the day's five are one patch of the island: within `area` metres of the first, at
  // least `sep` apart, and a walk round them from where the job starts of about `tour` or less
  area: 30, sep: 5, tour: 120,
  arm: 0.35, // seconds before a key still held from walking counts as a wobble
  // with the pole up the camera eases round to show you and the plant side by side,
  // to the left of the phone and log cards: from the ground to `top` metres up the plant
  // (a palm's crown is what tells it apart; a tree's trunk and lowest boughs), from
  // `dist` metres off, the pair at `screenX` of the way across
  frame: { top: { palm: 6.5, tree: 4.6, other: 3.2 }, dist: [4.2, 10.5], screenX: 0.36, eye: [1.5, 2.4], rateIn: 3.2, rateOut: 2.6 },
  moz: {
    firstIn: [0.5, 1.0], // seconds before it first flies in
    buzz: [1.2, 2.2], // seconds it buzzes round before landing
    approach: 0.4, // its last dash to the landing spot
    land: 0.95, // seconds it sits before it bites
    backIn: [2.3, 3.2], // after a bite, seconds before it comes back
    early: 0.45, // a press this far into the approach counts as a swat
  },
  ibis: { chance: 0.45, speed: 0.95, delay: [0.6, 1.4] },
  glow: { colour: '#ffd95a', core: '#fffbe6' },
  mark: '#8fe06a',
};
const R = RULES.missions.rtk;
const FIX_TOTAL = R.fix.single + R.fix.float;
const STEP = new URLSearchParams(location.search).get('missionstep');
const FLAG_ON = new URLSearchParams(location.search).get('mission') === 'rtk';
const TAU = Math.PI * 2;

let cssAdded = false;
function ensureStyle() {
  if (cssAdded || typeof document === 'undefined') return;
  cssAdded = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./rtk.css', import.meta.url).href;
  document.head.appendChild(link);
}

// a small seeded random (the day's plants repeat for the same day)
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const between = (rng, a, b) => a + (b - a) * rng();

// ---------------------------------------------------------------- the rover

// A 2 m pole (sunny yellow with red bands, a steel foot), the antenna's white dome
// with a teal band and a red light on top, and a phone in a mint case on a clamp at
// chest height facing back at whoever holds it. One merged vertex-colour mesh; the
// pole's foot is at the origin, y up, the phone on +z.
function roverGeometry() {
  const parts = [];
  const add = (geo, colour) => { parts.push([geo.index ? geo.toNonIndexed() : geo, new THREE.Color(colour)]); };
  add(new THREE.CylinderGeometry(0.019, 0.019, 1.9, 8).translate(0, 0.08 + 0.95, 0), '#ffd23f');
  for (let y = 0.35; y < 1.95; y += 0.4) add(new THREE.CylinderGeometry(0.021, 0.021, 0.07, 8).translate(0, y, 0), '#ff6f61');
  add(new THREE.ConeGeometry(0.021, 0.09, 8).rotateX(Math.PI).translate(0, 0.045, 0), '#9aa6ad');
  add(new THREE.CylinderGeometry(0.03, 0.036, 0.05, 10).translate(0, 1.995, 0), '#9aa6ad');
  add(new THREE.SphereGeometry(0.115, 16, 8, 0, TAU, 0, Math.PI / 2).scale(1, 0.55, 1).translate(0, 2.045, 0), '#f6f4ee');
  add(new THREE.CylinderGeometry(0.117, 0.117, 0.032, 18).translate(0, 2.04, 0), '#3fb8c4');
  add(new THREE.SphereGeometry(0.016, 8, 6).translate(0, 2.11, 0), '#ff5a4a');
  add(new THREE.BoxGeometry(0.036, 0.05, 0.05).translate(0, 1.13, 0.03), '#6b7780');
  add(new THREE.BoxGeometry(0.105, 0.175, 0.018).translate(0, 1.15, 0.064), '#8fe0bf');
  add(new THREE.BoxGeometry(0.084, 0.148, 0.004).translate(0, 1.152, 0.074), '#e3f7ff');
  add(new THREE.BoxGeometry(0.064, 0.02, 0.004).translate(0, 1.2, 0.0765), '#62d26f');
  add(new THREE.BoxGeometry(0.05, 0.05, 0.004).translate(0, 1.14, 0.0765), '#9fd8ff');
  let n = 0;
  for (const [g] of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const [g, c] of parts) {
    const k = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    for (let i = 0; i < k; i++) { col[(o + i) * 3] = c.r; col[(o + i) * 3 + 1] = c.g; col[(o + i) * 3 + 2] = c.b; }
    o += k;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}

// ---------------------------------------------------------------- the glow

// The day's plants glow softly at their feet: a gold ring of motes circling the trunk just
// above the ground, and a few more drifting up round it to about head height, each fading
// in and out as it rises (all worked out in the vertex shader from the time and each
// mote's seed), so the glow marks the plant and never reads as fireflies in the canopy.
// One Points draw call for every plant; a plant that is done switches its motes off.
const GLOW_MAX = 8, MOTES = 28, RING_MOTES = 18;
function buildGlow() {
  const n = GLOW_MAX * MOTES;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), seed = new Float32Array(n), ring = new Float32Array(n), high = new Float32Array(n), on = new Float32Array(n), kind = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = i % MOTES;
    // ring motes: evenly round the circle (their seed is their place on it); the rest drift
    kind[i] = k < RING_MOTES ? 1 : 0;
    seed[i] = k < RING_MOTES ? k / RING_MOTES : ((i * 0.6180339887) % 1) + k * 0.013;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setAttribute('aRing', new THREE.BufferAttribute(ring, 1));
  geo.setAttribute('aHigh', new THREE.BufferAttribute(high, 1));
  geo.setAttribute('aOn', new THREE.BufferAttribute(on, 1));
  geo.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const uniforms = {
    uTime: { value: 0 },
    uScale: { value: 600 },
    uColor: { value: new THREE.Color(RTK.glow.colour) },
    uCore: { value: new THREE.Color(RTK.glow.core) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      attribute float aSeed; attribute float aRing; attribute float aHigh; attribute float aOn; attribute float aKind;
      uniform float uTime; uniform float uScale;
      varying float vA;
      void main() {
        vec3 p; float fade; float size;
        if (aKind > 0.5) {
          // the ring: evenly round the trunk, turning slowly, bobbing a little, twinkling
          float ang = aSeed * 6.2832 + uTime * 0.55;
          float r = aRing * (1.0 + 0.04 * sin(uTime * 1.7 + aSeed * 19.0));
          p = position + vec3(cos(ang) * r, 0.22 + 0.07 * sin(uTime * 2.1 + aSeed * 12.566), sin(ang) * r);
          fade = 0.72 + 0.28 * sin(uTime * 3.3 + aSeed * 31.0);
          size = 0.27;
        } else {
          // the drifters: up from the foot to about head height, fading in and out
          float f = fract(uTime * (0.2 + 0.1 * fract(aSeed * 7.3)) + aSeed * 5.17);
          float ang = aSeed * 40.0 + uTime * (0.35 + 0.35 * fract(aSeed * 3.1)) * (fract(aSeed * 11.0) > 0.5 ? 1.0 : -1.0);
          float r = aRing * (0.55 + 0.3 * sin(f * 6.2832 + aSeed * 9.0));
          p = position + vec3(cos(ang) * r, 0.2 + f * aHigh, sin(ang) * r);
          fade = sin(f * 3.14159);
          size = 0.17 + 0.1 * fract(aSeed * 17.0);
        }
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        gl_PointSize = clamp(uScale * size / max(d, 0.5) * (0.6 + 0.4 * fade), 0.0, 48.0);
        vA = aOn * fade * (1.0 - smoothstep(55.0, 85.0, d));
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform vec3 uCore;
      varying float vA;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = clamp(1.0 - r, 0.0, 1.0);
        float core = a * a * a;
        gl_FragColor = vec4(mix(uColor, uCore, core), (a * a * 0.7 + core * 0.7) * vA);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const mesh = new THREE.Points(geo, mat);
  mesh.name = 'rtk-glow';
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.visible = false;
  return { mesh, uniforms, pos, ring, high, on, geo };
}

// A soft gold ring on the ground round the foot of each plant still to record, hugging the
// ground, with a spark of light running round it: with the motes above it, it says "this
// one" from across the island and in the fix's picture. One mesh for every plant, its
// rings laid out only when the list changes (showTargets); the time is its one uniform.
const HALO_SEG = 40, HALO_BAND = 0.26;
function buildHalo() {
  const per = (HALO_SEG + 1) * 2, nv = GLOW_MAX * per;
  const pos = new Float32Array(nv * 3), across = new Float32Array(nv), along = new Float32Array(nv), on = new Float32Array(nv);
  const idx = [];
  for (let r = 0; r < GLOW_MAX; r++) {
    for (let s = 0; s <= HALO_SEG; s++) {
      const a = r * per + s * 2;
      across[a] = 0; across[a + 1] = 1;
      along[a] = along[a + 1] = s / HALO_SEG;
      if (s < HALO_SEG) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aAcross', new THREE.BufferAttribute(across, 1));
  geo.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
  geo.setAttribute('aOn', new THREE.BufferAttribute(on, 1));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const uniforms = { uTime: { value: 0 }, uColor: { value: new THREE.Color(RTK.glow.colour) }, uCore: { value: new THREE.Color(RTK.glow.core) } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      attribute float aAcross; attribute float aAlong; attribute float aOn;
      varying float vAcross; varying float vAlong; varying float vOn;
      void main() {
        vAcross = aAcross; vAlong = aAlong; vOn = aOn;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uColor; uniform vec3 uCore;
      varying float vAcross; varying float vAlong; varying float vOn;
      void main() {
        if (vOn < 0.5) discard;
        float band = smoothstep(0.0, 0.45, vAcross) * (1.0 - smoothstep(0.55, 1.0, vAcross));
        float spark = pow(0.5 + 0.5 * cos((vAlong - uTime * 0.3) * 6.2832), 10.0);
        float a = band * (0.55 + 0.15 * sin(uTime * 2.6) + 0.45 * spark);
        gl_FragColor = vec4(mix(uColor, uCore, spark * 0.8 + band * 0.2), a);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'rtk-halo';
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.visible = false;
  return { mesh, uniforms, pos, on, geo, per };
}

// ---------------------------------------------------------------- the mission

export async function build(game) {
  ensureStyle();
  const { scene, player, collision, data } = game;
  const T = data.terrain;
  const group = new THREE.Group();
  group.name = 'mission-rtk';
  const topView = FLAGS.view === 'top';

  // the rover in hand
  const toon = makeToonGradient(TOON_WOOD);
  const rover = new THREE.Mesh(roverGeometry(), new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toon }));
  rover.name = 'rtk-rover';
  rover.castShadow = true;
  rover.visible = false;
  group.add(rover);

  // the glow over the day's plants
  const glow = buildGlow();
  group.add(glow.mesh);
  const halo = buildHalo();
  group.add(halo.mesh);

  // the curious ibis (the props' own model): a body and a head that pecks
  const ibis = (() => {
    const { body, head } = PIECES.ibisParts();
    const bird = new THREE.Group();
    bird.name = 'rtk-ibis';
    const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: makeToonGradient([150, 210, 255]) });
    const b = new THREE.Mesh(body.toGeometry(), mat);
    const neck = new THREE.Group();
    const h = new THREE.Mesh(head.toGeometry(), mat);
    neck.position.set(0.19, 0.56, 0);
    neck.add(h);
    bird.add(b, neck);
    b.castShadow = true; h.castShadow = true;
    bird.scale.setScalar(1.25);
    bird.visible = false;
    group.add(bird);
    return { bird, neck, st: 'off', t: 0, x: 0, z: 0, tx: 0, tz: 0, ox: 0, oz: 0, h: 0, speed: 0, hop: 0, peckT: 0, stay: 0, pal: false, called: false };
  })();

  const markers = getMarkers(scene);
  const plants = (data.placements && data.placements.plants) || [];
  const colliders = data.colliders || { circles: [], owners: [] };

  // ---------------------------------------------------------------- the plants

  // Every plant the survey named, with where to stand beside it: the first free,
  // walkable spot out from its collider (facing the open side), and where the glow sits.
  let cands = null, candMs = 0;
  function colliderRadius(i) {
    const own = 'P' + i;
    const k = colliders.owners ? colliders.owners.indexOf(own) : -1;
    return k >= 0 && colliders.circles[k] ? colliders.circles[k][2] : 0.2;
  }
  const walkOk = (x, z) => T.isWalkable(x, z) && !T.isThicket(x, z) && !T.isWater(x, z) && collision.isFree(x, z);
  function candidates() {
    if (cands) return cands;
    cands = [];
    const [bx0, bz0, bx1, bz1] = T.walk_bounds || [-46, -34, 63, 47];
    const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2;
    plants.forEach((p, i) => {
      const info = plantInfo(p);
      if (!info || !Number.isFinite(p.x)) return;
      const r0 = colliderRadius(i);
      const face = Math.atan2(cz - p.z, cx - p.x); // look first on the island's inner side
      let stand = null;
      for (let d = r0 + RTK.standMin; d <= r0 + RTK.standMax && !stand; d += 0.35) {
        for (let k = 0; k < 20; k++) {
          const a = face + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (TAU / 20);
          const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
          if (!walkOk(x, z) || !collision.roomy(x, z)) continue;
          stand = { x, z, d };
          break;
        }
      }
      if (!stand) return;
      // a plant standing in the shallows is only surveyed from right beside it
      const wet = T.isWater(p.x, p.z);
      if (wet && stand.d > r0 + 1.4) return;
      const h = Number(p.height) || 1.5, w = Number(p.crown_w) || 1.5;
      const gy = Math.max(0, T.heightAt(p.x, p.z));
      // the gold ring hugs a trunk; round a shrub or a herb it takes in the bush
      const trunk = p.form === 'tree' || p.form === 'palm';
      const ringR = Math.max(0.4, Math.min(1.5, trunk ? r0 + 0.3 : Math.max(r0 + 0.3, Math.min(1.3, w * 0.35))));
      cands.push({
        i, p, info, form: p.form, stand, wet, base: { x: p.x, z: p.z, y: gy }, h,
        glowY: gy + 0.9, // where a sparkle bursts now and then: low down, by the ring
        glowRing: ringR, // the ring of motes round its foot
        glowHigh: Math.max(0.9, Math.min(1.7, h * 0.6)), // and how high the drifters rise
      });
    });
    return cands;
  }

  // The day's five: one patch of the island, so the survey is about the plants and not
  // the walk (within RTK.area of the first, RTK.sep apart, a walk round them from here of
  // about RTK.tour or less), of mixed growth forms, one of each name, ones not yet in the
  // notebook first. Seeded by the day and the notebook, so it changes as plants are
  // recorded.
  const dist2 = (a, b) => Math.hypot(a.base.x - b.base.x, a.base.z - b.base.z);
  // the walk round a set, nearest first, from (x, z); the first leg counts half (you
  // choose where to start the job)
  function tourOf(set, x, z) {
    const left = set.slice();
    let len = 0, first = true;
    while (left.length) {
      let bi = 0, bd = Infinity;
      for (let k = 0; k < left.length; k++) { const d = Math.hypot(left[k].base.x - x, left[k].base.z - z); if (d < bd) { bd = d; bi = k; } }
      len += first ? bd * 0.5 : bd;
      first = false;
      x = left[bi].base.x; z = left[bi].base.z;
      left.splice(bi, 1);
    }
    return len;
  }
  function pickTargets() {
    const list = candidates();
    const rec = missionRecord('rtk');
    const seen = new Set((rec.data && rec.data.plants) || []);
    const rng = makeRng(dayKey() * 7919 + (state.days || 0) * 104729 + seen.size * 31 + 17);
    const want = Math.min(R.plants, list.length);
    const px = player.position.x, pz = player.position.z;
    // the plants to build a patch round: new ones, dry-footed, with a little luck
    const anchors = list.map((c) => [(seen.has(c.i) ? 0 : 6) + (c.wet ? 0 : 2.5) + rng() * 4, c])
      .sort((a, b) => b[0] - a[0]).slice(0, 16).map((x) => x[1]);
    let best = null, bestScore = Infinity;
    for (const a of anchors) {
      for (const area of [RTK.area, RTK.area * 1.5]) {
        const out = [a], names = new Set([a.info.common]), forms = new Map([[a.form, 1]]);
        while (out.length < want) {
          let pick = null, ps = -Infinity;
          for (const c of list) {
            if (names.has(c.info.common) || out.includes(c) || dist2(c, a) > area) continue;
            let near = Infinity;
            for (const o of out) near = Math.min(near, dist2(c, o));
            if (near < RTK.sep) continue;
            // a growth form the set lacks counts most, then a plant not yet recorded,
            // dry feet and being close by
            const s = (forms.has(c.form) ? -1.5 * forms.get(c.form) : 5) + (seen.has(c.i) ? 0 : 3) + (c.wet ? 0 : 1) - near * 0.06 + rng() * 2;
            if (s > ps) { ps = s; pick = c; }
          }
          if (!pick) break;
          out.push(pick); names.add(pick.info.common); forms.set(pick.form, (forms.get(pick.form) || 0) + 1);
        }
        if (out.length < want) continue; // too few names round here: a wider patch
        const tour = tourOf(out, px, pz);
        // (a little luck too, so the patch moves about from day to day)
        const score = tour + (tour > RTK.tour ? 100 + tour : 0) - forms.size * 12 + out.filter((c) => seen.has(c.i)).length * 10 + rng() * 30;
        if (score < bestScore) { bestScore = score; best = out; }
        break;
      }
    }
    if (!best) { // (no patch has five names: any five, one of each name)
      best = [];
      const names = new Set();
      for (const c of anchors.concat(list)) { if (best.length >= want) break; if (!best.includes(c) && !names.has(c.info.common)) { best.push(c); names.add(c.info.common); } }
    }
    return best.map((c) => ({ c, done: false, named: false }));
  }

  // ---------------------------------------------------------------- state

  const M = {
    active: false,
    stage: 'idle', // idle, walk, fix, log, done
    targets: [],
    cur: null, // the target being surveyed
    named: 0, wobbles: 0, bites: 0, swats: 0, misses: 0, ibis: 0,
    doneToday: -1, // dayKey() of the day it was finished
    shake: 0, // the rover's flinch
    auto: false, // scripted runs: the fix swats and never wobbles, the log picks right
  };
  const mapMarks = [];
  let toldSetup = false;
  // the fix, the log and the end cards are a mini-game: the day's clock waits for them
  // (the walks between plants still take time), as it does for the catch's cards
  let clockHeld = false;
  const doneCount = () => { let n = 0; for (const t of M.targets) if (t.done) n++; return n; };

  // ---------------------------------------------------------------- the camera

  // With the pole up the camera eases round to your side to show you and the plant side
  // by side, low enough to see up the trunk towards the crown, left of the phone and log
  // cards (docked on the right). It is laid over the follow rig's own camera after
  // the rig has placed it (k blends in and out), so the rig is never touched and the
  // hand back is smooth; the vegetation's cut-out is moved to the new camera.
  const FR = RTK.frame;
  const frame = { want: 0, k: 0, turn: 0, pos: new THREE.Vector3(), look: new THREE.Vector3(), quat: new THREE.Quaternion() };
  const _m4 = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0);
  const FRAME_TURNS = [-1.1, -0.85, -1.35, 1.1, 0.85, 1.35, -0.55, 0.55];
  // a trunk, bush or prop in the way at (x, z) (collision's circles only: the camera may
  // stand over water or thicket, which isFree would count as blocked)
  const hitQ = { x: 0, z: 0, r: 0, hit: false };
  const hitFn = (i) => {
    if (hitQ.hit) return;
    const dx = hitQ.x - collision.cx[i], dz = hitQ.z - collision.cz[i], R = collision.cr[i] + hitQ.r;
    if (dx * dx + dz * dz < R * R) hitQ.hit = true;
  };
  const circleAt = (x, z, r) => { hitQ.x = x; hitQ.z = z; hitQ.r = r; hitQ.hit = false; collision.forEachCircleNear(x, z, hitFn); return hitQ.hit; };
  function frameOn(t) {
    const cam = game.camera;
    if (topView || !cam || !game.rig || !t) return;
    const p = player.position, b = t.c.base;
    let ux = p.x - b.x, uz = p.z - b.z, ul = Math.hypot(ux, uz);
    if (ul < 0.05) { ux = Math.sin(player.heading); uz = Math.cos(player.heading); ul = 0.05; } // (behind the player)
    else { ux /= ul; uz /= ul; }
    const top = Math.min(FR.top[t.c.form] || FR.top.other, Math.max(1.9, t.c.h)); // at least the player's height
    const gy = Math.max(0, b.y);
    const mx = (p.x + b.x) / 2, mz = (p.z + b.z) / 2, yc = gy + top * 0.5;
    const tanV = Math.tan(((cam.fov || 42) * Math.PI) / 360), tanH = tanV * (cam.aspect || 1.6);
    const span = ul + 1.8; // the pair side by side, and a little room (an ibis)
    const dist = Math.min(FR.dist[1], Math.max(FR.dist[0], (top + 0.6) / (2 * tanV * 0.82), span / (2 * tanH * 0.42)));
    // from behind you and well round to one side, so you stand beside the plant rather
    // than in front of its foot: your right side first (an ibis walks up on your left, so
    // it stands beside you in the picture), the way with the fewest trunks and bushes on
    // the two lines of sight
    let bs = Infinity, bx = 0, bz = 0, bdx = ux, bdz = uz;
    for (const a of FRAME_TURNS) {
      const ca = Math.cos(a), sa = Math.sin(a);
      const dx = ux * ca - uz * sa, dz = ux * sa + uz * ca;
      const cx = mx + dx * dist, cz = mz + dz * dist;
      let s = Math.abs(Math.abs(a) - 1.1) * 3 + (a > 0 ? 1 : 0);
      if (circleAt(cx, cz, 0.35)) s += 4;
      // (the cut-out thins what stands on the line to your head, so those count less)
      for (let k = 1; k <= 8; k++) {
        const f = k / 9;
        if (circleAt(cx + (p.x - cx) * f, cz + (p.z - cz) * f, 0.12)) s += 0.2;
        if (circleAt(cx + (b.x - cx) * f * 0.9, cz + (b.z - cz) * f * 0.9, 0.12)) s += 0.8;
      }
      if (s < bs) { bs = s; bx = cx; bz = cz; bdx = dx; bdz = dz; frame.turn = a; }
    }
    const eye = Math.min(FR.eye[1], Math.max(FR.eye[0], 1.2 + dist * 0.12));
    frame.pos.set(bx, Math.max(Math.max(0, T.heightAt(bx, bz)) + eye, gy + eye * 0.8), bz);
    // look at the pair's middle, turned to the right so they sit left of the cards
    const shift = (1 - 2 * FR.screenX) * tanH * dist;
    frame.look.set(mx + bdz * shift, yc, mz - bdx * shift);
    _m4.lookAt(frame.pos, frame.look, _up);
    frame.quat.setFromRotationMatrix(_m4);
    frame.want = 1;
  }
  function frameOff() { frame.want = 0; }
  function applyFrame(dt) {
    if (frame.k === 0 && !frame.want) return;
    const rig = game.rig, cam = game.camera;
    // (a talk's camera, the drone's, or the top view: stand aside)
    if (!rig || !rig.enabled || topView) { frame.k = 0; return; }
    frame.k += (frame.want - frame.k) * (1 - Math.exp(-(frame.want ? FR.rateIn : FR.rateOut) * dt));
    if (!frame.want && frame.k < 0.003) { frame.k = 0; return; }
    const e = frame.k * frame.k * (3 - 2 * frame.k);
    cam.position.lerp(frame.pos, e);
    cam.quaternion.slerp(frame.quat, e);
    // the cut-out ran from where the rig put the camera: from here instead
    if (vegUniforms.uVegCut.value > 0) vegUniforms.uVegCam.value.copy(cam.position);
  }

  function progress() {
    const goal = M.targets.length || R.plants;
    let n = 0;
    for (const t of M.targets) if (t.done) n++;
    return { done: n, goal, label: 'Plants recorded' };
  }
  const available = () => state.phase === 'survey' && !M.active && M.doneToday !== dayKey() && candidates().length >= 3;

  function showTargets() {
    const list = [];
    for (const m of mapMarks) m();
    mapMarks.length = 0;
    let gi = 0;
    for (const t of M.targets) {
      if (t.done) continue;
      const s = t.c.stand;
      list.push({ x: s.x, y: Math.max(0, T.heightAt(s.x, s.z)), z: s.z, colour: RTK.mark });
      const maps = game.ui && game.ui.maps;
      if (maps && maps.addMarker) mapMarks.push(maps.addMarker({ x: t.c.base.x, z: t.c.base.z, colour: '#5fbf4a', pulse: true, label: 'Plant' }));
    }
    markers.set('rtk', M.active && M.stage !== 'done' ? list : null);
    // the glow: MOTES motes round each plant still to record
    for (let i = 0; i < GLOW_MAX; i++) {
      const t = M.targets[i];
      const onV = M.active && t && !t.done ? 1 : 0;
      for (let k = 0; k < MOTES; k++) {
        const v = i * MOTES + k;
        glow.on[v] = onV;
        if (t) {
          glow.pos[v * 3] = t.c.base.x; glow.pos[v * 3 + 1] = t.c.base.y; glow.pos[v * 3 + 2] = t.c.base.z;
          glow.ring[v] = t.c.glowRing;
          glow.high[v] = t.c.glowHigh;
        }
      }
      if (onV) gi++;
    }
    glow.geo.attributes.position.needsUpdate = true;
    glow.geo.attributes.aRing.needsUpdate = true;
    glow.geo.attributes.aHigh.needsUpdate = true;
    glow.geo.attributes.aOn.needsUpdate = true;
    glow.mesh.visible = gi > 0 && !topView;
    // the gold rings on the ground, each vertex set on the ground (or the water) under it
    for (let i = 0; i < GLOW_MAX; i++) {
      const t = M.targets[i];
      const onV = M.active && t && !t.done ? 1 : 0;
      const o = i * halo.per;
      halo.on.fill(onV, o, o + halo.per);
      if (!onV) continue;
      const b = t.c.base, R = t.c.glowRing + 0.05;
      for (let s = 0; s <= HALO_SEG; s++) {
        const a = (s / HALO_SEG) * TAU, ca = Math.cos(a), sa = Math.sin(a);
        for (let e = 0; e < 2; e++) {
          const r = R + (e ? 0.5 : -0.5) * HALO_BAND;
          const x = b.x + ca * r, z = b.z + sa * r, v = o + s * 2 + e;
          halo.pos[v * 3] = x; halo.pos[v * 3 + 1] = Math.max(0, T.heightAt(x, z)) + 0.05; halo.pos[v * 3 + 2] = z;
        }
      }
    }
    halo.geo.attributes.position.needsUpdate = true;
    halo.geo.attributes.aOn.needsUpdate = true;
    halo.mesh.visible = gi > 0 && !topView;
  }
  function clearTargets() {
    markers.set('rtk', null);
    for (const m of mapMarks) m();
    mapMarks.length = 0;
    glow.mesh.visible = false;
    halo.mesh.visible = false;
  }

  function start(opts = {}) {
    if (M.active || state.phase !== 'survey') return false;
    M.targets = pickTargets();
    if (!M.targets.length) return false;
    M.active = true;
    M.stage = 'walk';
    M.cur = null;
    M.named = M.wobbles = M.bites = M.swats = M.misses = M.ibis = 0;
    showTargets();
    equip('rtk');
    events.emit('mission:start', { id: 'rtk' });
    events.emit('mission:step', { id: 'rtk', step: 'walk' });
    if (opts.from === 'ring' && SCRIPT.missions) {
      kit.toast(`James: ${say(SCRIPT.missions.selfStart, { title: 'plant survey', name: state.playerName })}`, { icon: 'rtk', tone: 'good', ms: 3600 });
    }
    return true;
  }
  function stop(why = 'stopped') {
    if (!M.active) return;
    M.active = false;
    M.stage = 'idle';
    clearTargets();
    ibisOff();
    frameOff();
    if (why) events.emit('mission:fail', { id: 'rtk', why });
  }
  // a new day, the title or the summary: the survey is put away
  events.on('day:new', () => { if (M.active) stop(null); M.targets = []; M.stage = 'idle'; });
  events.on('phase:change', (e) => { if (e && e.phase !== 'survey' && M.active) stop(null); });

  // ---------------------------------------------------------------- the tool

  registerTool({
    id: 'rtk', name: 'RTK rover', icon: 'rtk', key: null, order: 63, pose: 'hold', phrase: 'RTK rover',
    onEquip() {
      if (state.phase === 'survey' && !M.active && available()) start({ from: 'ring' });
      else if (state.phase === 'survey' && !M.active && M.doneToday === dayKey()) {
        kit.toast('Today\'s plant survey is done. More plants tomorrow!', { icon: 'rtk', tone: 'info' });
      } else if (state.phase === 'setup' && !toldSetup) {
        toldSetup = true;
        kit.toast('The field kit is for survey day. James will hand out the jobs!', { icon: 'rtk', tone: 'info' });
      }
    },
  });

  // [E] by one of the day's plants: stand the pole (or take the rover out first)
  const offer = { score: 0, prompt: '', run: null };
  let near = null;
  const runFix = () => beginFix(near);
  const runEquip = () => equip('rtk');
  function nearestTarget() {
    let best = null, bd = Infinity;
    const p = player.position;
    for (const t of M.targets) {
      if (t.done) continue;
      const d = Math.hypot(p.x - t.c.stand.x, p.z - t.c.stand.z);
      const db = Math.hypot(p.x - t.c.base.x, p.z - t.c.base.z);
      const ok = d <= RTK.reach || db <= t.c.stand.d + 0.5;
      if (ok && d < bd) { bd = d; best = t; }
    }
    return best;
  }
  registerInteraction({
    id: 'rtk-plant',
    check() {
      if (!M.active || M.stage !== 'walk' || state.phase !== 'survey') return null;
      near = nearestTarget();
      if (!near) return null;
      const inHand = currentTool() === 'rtk';
      offer.score = 8;
      offer.prompt = inHand ? '[E] Stand the rover pole here' : '[E] Take out the RTK rover';
      offer.run = inHand ? runFix : runEquip;
      return offer;
    },
  });

  // ---------------------------------------------------------------- the fix

  async function beginFix(t, opts = {}) {
    if (!t || M.stage !== 'walk') return;
    M.stage = 'fix';
    M.cur = t;
    // face the plant, the pole at its base
    const p = player.position;
    player.heading = Math.atan2(-(t.c.base.x - p.x), -(t.c.base.z - p.z));
    player.object.rotation.y = player.heading;
    audio.cue('rtkPlant');
    markers.set('rtk', null); // the job markers step aside while the pole is up
    frameOn(t);
    events.emit('mission:step', { id: 'rtk', step: 'fix' });
    if (opts.pose) maybeIbis(true); else maybeIbis();
    const r = await kit.minigame(fixGame(t, opts));
    if (!M.active) return;
    if (!r || !r.success) { // lifted the pole (Esc)
      M.stage = 'walk';
      M.cur = null;
      ibisLeave();
      frameOff();
      showTargets();
      return;
    }
    missionRecord('rtk').data.fixes = (missionRecord('rtk').data.fixes || 0) + 1;
    if (ibis.st === 'peck' || ibis.st === 'look') { M.ibis++; ibis.pal = true; }
    events.emit('mission:step', { id: 'rtk', step: 'fixed' });
    await logPlant(t);
  }

  function fixGame(t, opts) {
    return {
      name: 'rtk-fix', title: 'Getting a fix', icon: 'rtk', card: 'rtk-dock',
      instructions: 'Hold still till the phone says *FIX*. When the mosquito *lands*, swat it with [E]!',
      foot: 'Any step: back to SINGLE · [Esc] lifts the pole',
      mount(stage, api) { return mountFix(stage, api, t, opts); },
    };
  }

  // The phone on the pole: the sky plot filling with satellites, the fix chip, the three
  // stages and the accuracy, and a mosquito buzzing round it.
  function mountFix(stage, api, t, opts) {
    stage.classList.add('rtk-stage');
    const sats = [];
    const rng = makeRng(t.c.i * 131 + dayKey());
    for (let k = 0; k < 14; k++) {
      const a = rng() * TAU, r = 8 + rng() * 36;
      sats.push(`<circle class="rtk-sat" cx="${(50 + Math.cos(a) * r).toFixed(1)}" cy="${(50 + Math.sin(a) * r).toFixed(1)}" r="3.4"/>`);
    }
    stage.innerHTML =
      '<div class="rtk-phone"><div class="rtk-screen">' +
        '<div class="rtk-app"><b>Plant survey</b><span class="rtk-nsat">0 sats</span></div>' +
        `<svg class="rtk-sky" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" class="rtk-ring"/><circle cx="50" cy="50" r="30" class="rtk-ring"/><circle cx="50" cy="50" r="14" class="rtk-ring"/><path d="M50 4v92M4 50h92" class="rtk-ring"/>${sats.join('')}<circle class="rtk-you" cx="50" cy="50" r="4"/></svg>` +
        '<div class="rtk-chip is-single">SINGLE</div>' +
        '<div class="rtk-steps"><div><i></i><span>SINGLE</span></div><div><i></i><span>FLOAT</span></div><div><i></i><span>FIX</span></div></div>' +
        '<div class="rtk-acc">&plusmn; <b>1.8</b> m</div>' +
        `<div class="rtk-plant">${icon('plant')} Plant ${doneCount() + 1} of ${M.targets.length}</div>` +
      '</div></div>' +
      '<div class="rtk-say"></div>' +
      '<div class="rtk-moz is-away">' + MOZZIE_SVG + '</div>' +
      '<div class="rtk-swat"><span>SWAT!</span></div>';
    const q = (s) => stage.querySelector(s);
    const chip = q('.rtk-chip'), nsat = q('.rtk-nsat'), acc = q('.rtk-acc b'), you = q('.rtk-you');
    const bars = [...stage.querySelectorAll('.rtk-steps i')];
    const satEls = [...stage.querySelectorAll('.rtk-sat')];
    const sayEl = q('.rtk-say'), moz = q('.rtk-moz'), swatEl = q('.rtk-swat'), phone = q('.rtk-phone');
    // the stage's size, measured once and again on a resize (reading it each frame after
    // the writes below would force a layout every frame)
    const size = { w: 280, h: 330 };
    const measure = () => { size.w = stage.clientWidth || 280; size.h = stage.clientHeight || 330; };
    measure();
    window.addEventListener('resize', measure);
    const pr = makeRng(t.c.i * 7 + 3);

    const S = {
      p: 0, st: 0, t: 0, fixT: -1, armed: false, sayT: 0, accT: 0, accV: 1.8, shown: -1, satsOn: -1,
      bar0: -1, bar1: -1, bar2: -1, youT: 0, // what the screen shows (written only when it changes)
      moz: { st: 'away', t: between(pr, RTK.moz.firstIn[0], RTK.moz.firstIn[1]), x: -40, y: 60, sx: 0, sy: 0, ex: 0, ey: 0, lx: 0, ly: 0, ph: pr() * TAU, buzzT: 0, gone: false, px: 1e9, py: 1e9, pf: 0 },
    };
    const stageAt = (p) => (p >= FIX_TOTAL ? 2 : p >= R.fix.single ? 1 : 0);
    if (opts.pose) { // a still picture mid-FLOAT, the mosquito landed on the phone
      S.p = R.fix.single + R.fix.float * 0.55;
      S.armed = true;
      S.moz.st = 'pose';
    }

    function speak(text, cls) {
      sayEl.className = 'rtk-say is-on ' + (cls || '');
      sayEl.innerHTML = `<span>${escapeHtml(text)}</span>`;
      S.sayT = 1.3;
    }
    // a wobble: back to SINGLE (a miss only back to the start of the stage it was in)
    function wobble(kind) {
      const was = S.st;
      if (kind === 'miss') S.p = was === 1 ? R.fix.single : 0;
      else S.p = 0;
      M.shake = 0.45;
      phone.classList.remove('is-shake'); void phone.offsetWidth; phone.classList.add('is-shake');
      audio.cue('rtkWobble', kind === 'bite' ? 1 : 0);
      if (kind !== 'miss') ibisStartle();
    }
    // where the mosquito lands: on the phone's screen or its clamp
    function landingSpot() {
      const r = phone.getBoundingClientRect(), s = stage.getBoundingClientRect();
      const spots = [[0.3, 0.3], [0.72, 0.42], [0.5, 0.7], [0.24, 0.62], [0.78, 0.18]];
      const k = spots[Math.floor(pr() * spots.length)];
      S.moz.lx = r.left - s.left + r.width * k[0];
      S.moz.ly = r.top - s.top + r.height * k[1];
    }
    function placeMoz(x, y, flip) {
      const m = S.moz, rx = Math.round(x), ry = Math.round(y), f = flip ? -1 : 1;
      if (rx === m.px && ry === m.py && f === m.pf) return;
      m.px = rx; m.py = ry; m.pf = f;
      moz.style.transform = `translate(${rx}px, ${ry}px) scaleX(${f})`;
    }
    function swat() {
      const m = S.moz;
      const ok = m.st === 'land' || m.st === 'pose' || (m.st === 'approach' && m.t < RTK.moz.approach * (1 - RTK.moz.early));
      swatEl.style.left = m.x.toFixed(0) + 'px';
      swatEl.style.top = m.y.toFixed(0) + 'px';
      swatEl.classList.remove('is-on', 'is-miss'); void swatEl.offsetWidth;
      if (ok) {
        swatEl.classList.add('is-on');
        m.st = 'swatted'; m.t = 0.9; m.gone = true;
        moz.className = 'rtk-moz is-swatted';
        M.swats++;
        const d = missionRecord('rtk').data;
        d.swats = (d.swats || 0) + 1;
        speak('Swat!', 'is-good');
        audio.cue('swat');
      } else if (m.st === 'buzz' || m.st === 'approach' || m.st === 'enter') {
        swatEl.classList.add('is-on', 'is-miss');
        M.misses++;
        speak('Missed! Steady...', 'is-miss');
        audio.cue('rtkWobble', 0);
        wobble('miss');
      }
    }

    function update(dt) {
      S.t += dt;
      const inp = api.input;
      const mv = inp ? Math.hypot(inp.move.x, inp.move.y) : 0;
      if (!S.armed) { if (mv < 0.2 && S.t > RTK.arm) S.armed = true; }
      else if (mv > 0.35 && S.fixT < 0 && !opts.pose && !M.auto) {
        M.wobbles++;
        speak('Wobble! Hold still', 'is-miss');
        wobble('move');
        S.armed = false; // one step is one wobble: the next counts once the key is let go
      }
      // the fix comes in while the pole is still
      if (!opts.pose && S.fixT < 0) S.p = Math.min(FIX_TOTAL, S.p + dt);
      const st = stageAt(S.p);
      if (st !== S.st) {
        if (st > S.st) audio.cue('rtkStage', st);
        S.st = st;
      }
      // the screen, only where it changed
      if (S.shown !== st) {
        S.shown = st;
        chip.textContent = ['SINGLE', 'FLOAT', 'FIX'][st];
        chip.className = 'rtk-chip ' + ['is-single', 'is-float', 'is-fix'][st];
      }
      // the bars in 1/100 steps, each written only when its step changes
      const b0 = Math.round(Math.min(1, S.p / R.fix.single) * 100);
      const b1 = Math.round(Math.max(0, Math.min(1, (S.p - R.fix.single) / R.fix.float)) * 100);
      const b2 = st === 2 ? 100 : 0;
      if (b0 !== S.bar0) { S.bar0 = b0; bars[0].style.transform = `scaleX(${b0 / 100})`; }
      if (b1 !== S.bar1) { S.bar1 = b1; bars[1].style.transform = `scaleX(${b1 / 100})`; }
      if (b2 !== S.bar2) { S.bar2 = b2; bars[2].style.transform = `scaleX(${b2 / 100})`; }
      const nOn = Math.min(satEls.length, Math.round(4 + (S.p / FIX_TOTAL) * (satEls.length - 4)));
      if (nOn !== S.satsOn) {
        S.satsOn = nOn;
        for (let k = 0; k < satEls.length; k++) satEls[k].classList.toggle('is-on', k < nOn);
        nsat.textContent = nOn + ' sats';
      }
      S.accT -= dt;
      if (S.accT <= 0) {
        S.accT = 0.22;
        const f = S.p / FIX_TOTAL;
        S.accV = st === 2 ? 0.02 : st === 1 ? 0.45 - 0.33 * ((S.p - R.fix.single) / R.fix.float) + pr() * 0.05 : 1.9 - 0.6 * f + pr() * 0.3;
        acc.textContent = S.accV < 0.1 ? S.accV.toFixed(2) : S.accV.toFixed(1);
        acc.parentNode.classList.toggle('is-fix', st === 2);
      }
      // your dot on the sky plot wanders less as the fix firms up (moved 15 times a second)
      if ((S.youT -= dt) <= 0 && S.shown !== 2) {
        S.youT = 1 / 15;
        const wob = 1 - Math.min(1, S.p / FIX_TOTAL);
        you.setAttribute('cx', (50 + Math.sin(S.t * 5.3) * 5 * wob).toFixed(1));
        you.setAttribute('cy', (50 + Math.cos(S.t * 4.1) * 5 * wob).toFixed(1));
      } else if (S.shown === 2 && S.youT > -1) { S.youT = -2; you.setAttribute('cx', '50'); you.setAttribute('cy', '50'); }
      if (S.sayT > 0 && (S.sayT -= dt) <= 0) sayEl.classList.remove('is-on');

      updateMoz(dt);

      // FIX: a moment to enjoy it, then the log card
      if (st === 2 && S.fixT < 0 && !opts.pose) {
        S.fixT = 0;
        speak('FIX! 2 cm', 'is-good');
        moz.classList.add('is-leaving');
      }
      if (S.fixT >= 0 && (S.fixT += dt) > 0.7) api.done({ success: true, quality: 1, label: 'FIX!', hold: 650 });
    }

    function updateMoz(dt) {
      const m = S.moz, w = size.w, h = size.h;
      if (m.st === 'pose') {
        if (!m.lx) { landingSpot(); moz.className = 'rtk-moz is-landed'; }
        m.x = m.lx; m.y = m.ly;
        placeMoz(m.x, m.y, false);
        return;
      }
      if (S.fixT >= 0 && m.st !== 'swatted') { // it gives up once the fix is in
        if (m.st !== 'gone') { m.st = 'gone'; moz.className = 'rtk-moz is-away'; }
        return;
      }
      m.t -= dt;
      if (m.st === 'away') {
        if (m.gone || m.t > 0) return;
        m.st = 'enter';
        m.t = 0.5;
        const left = pr() < 0.5;
        m.sx = left ? -30 : w + 30; m.sy = 30 + pr() * (h * 0.5);
        m.x = m.sx; m.y = m.sy;
        moz.className = 'rtk-moz is-flying';
      }
      if (m.st === 'enter' || m.st === 'buzz') {
        // loops round the phone, a little wobbly
        m.ph += dt;
        const tx = w * 0.5 + Math.sin(m.ph * 2.3) * w * 0.34 + Math.sin(m.ph * 5.1) * 10;
        const ty = h * 0.42 + Math.sin(m.ph * 3.1 + 1) * h * 0.26 + Math.cos(m.ph * 6.7) * 8;
        const k = m.st === 'enter' ? Math.min(1, dt * 6) : Math.min(1, dt * 9);
        const ox = m.x;
        m.x += (tx - m.x) * k; m.y += (ty - m.y) * k;
        placeMoz(m.x, m.y, m.x < ox);
        m.buzzT -= dt;
        if (m.buzzT <= 0) { m.buzzT = 0.26; audio.cue('mozzie', (m.x / w) * 2 - 1, 1); }
        if (m.st === 'enter' && m.t <= 0) { m.st = 'buzz'; m.t = between(pr, RTK.moz.buzz[0], RTK.moz.buzz[1]); }
        else if (m.st === 'buzz' && m.t <= 0) {
          m.st = 'approach'; m.t = RTK.moz.approach;
          landingSpot();
          m.ex = m.x; m.ey = m.y;
        }
        return;
      }
      if (m.st === 'approach') {
        const f = 1 - Math.max(0, m.t) / RTK.moz.approach, e = f * f * (3 - 2 * f);
        m.x = m.ex + (m.lx - m.ex) * e; m.y = m.ey + (m.ly - m.ey) * e - Math.sin(f * Math.PI) * 18;
        placeMoz(m.x, m.y, m.lx < m.ex);
        if (m.t <= 0) {
          m.st = 'land'; m.t = RTK.moz.land;
          moz.className = 'rtk-moz is-landed';
          audio.cue('mozzieLand');
          if (M.auto) swat();
        }
        return;
      }
      if (m.st === 'land') {
        if (m.t <= 0) { // a bite: the flinch, and off it goes
          M.bites++;
          speak('Ouch! Flinched...', 'is-miss');
          audio.cue('bite');
          wobble('bite');
          m.st = 'leave'; m.t = 0.5;
          m.ex = m.x; m.ey = m.y;
          moz.className = 'rtk-moz is-flying';
        }
        return;
      }
      if (m.st === 'leave') {
        const f = 1 - Math.max(0, m.t) / 0.5;
        m.x = m.ex + f * (m.ex < w / 2 ? -w * 0.7 : w * 0.7); m.y = m.ey - f * 90;
        placeMoz(m.x, m.y, m.ex < w / 2);
        if (m.t <= 0) { m.st = 'away'; m.t = between(pr, RTK.moz.backIn[0], RTK.moz.backIn[1]); moz.className = 'rtk-moz is-away'; }
        return;
      }
      if (m.st === 'swatted') {
        m.x += 60 * dt; m.y -= 110 * dt;
        if (m.t <= 0) { m.st = 'away'; moz.className = 'rtk-moz is-away'; }
      }
    }

    const onPointer = (e) => { if (e.button === 0) { e.preventDefault(); swat(); } };
    stage.addEventListener('pointerdown', onPointer);
    return {
      update,
      onUse: swat,
      destroy() { stage.removeEventListener('pointerdown', onPointer); window.removeEventListener('resize', measure); },
    };
  }

  // ---------------------------------------------------------------- logging the plant

  // Three names, each shown with its leaf and its family in plain words: the right one,
  // a near miss that shares its family or its leaf (so one clue alone does not decide it)
  // and one that shares neither. Only the right one matches both the family and the leaf
  // on the card, so a careful look always finds it.
  function choicesFor(t) {
    const info = t.c.info;
    const rng = makeRng(t.c.i * 977 + dayKey());
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const others = allNames().filter((n) => n.common !== info.common && n.sci !== info.sci);
    const sameFam = shuffle(others.filter((n) => n.family === info.family && n.leaf !== info.leaf));
    const sameLeaf = shuffle(others.filter((n) => n.leaf === info.leaf && n.family !== info.family));
    const near = (rng() < 0.6 ? sameFam[0] || sameLeaf[0] : sameLeaf[0] || sameFam[0]) || null;
    const picks = near ? [near] : [];
    for (const n of shuffle(others.filter((x) => x.family !== info.family && x.leaf !== info.leaf))) {
      if (picks.length >= 2) break;
      if (!picks.some((x) => x.common === n.common || (x !== near && (x.family === n.family || x.leaf === n.leaf)))) picks.push(n);
    }
    const opt = (n, right) => ({ common: n.common, sci: n.sci, family: n.family, familyCommon: FAMILY[n.family] || n.family, leaf: n.leaf, right });
    return shuffle([opt(info, true), ...picks.map((n) => opt(n, false))]);
  }

  async function logPlant(t, opts = {}) {
    M.stage = 'log';
    const r = await kit.minigame(logGame(t, opts));
    if (!M.active) return;
    const right = !!(r && r.right);
    t.done = true;
    t.named = right;
    if (right) M.named++;
    const d = missionRecord('rtk').data;
    d.plants = Array.isArray(d.plants) ? d.plants : [];
    d.named = Array.isArray(d.named) ? d.named : [];
    if (!d.plants.includes(t.c.i)) d.plants.push(t.c.i);
    if (right && !d.named.includes(t.c.i)) d.named.push(t.c.i);
    addScore(RULES.points.plant + (right ? RULES.points.plantName : 0), 'plant');
    events.emit('mission:step', { id: 'rtk', step: 'logged', plant: t.c.info.common, right });
    M.cur = null;
    ibisLeave();
    frameOff();
    showTargets();
    if (M.targets.every((x) => x.done)) await finish();
    else {
      M.stage = 'walk';
      const left = M.targets.filter((x) => !x.done).length;
      kit.toast(`${cap(t.c.info.common)} recorded! ${left} to go.`, { icon: 'plant', tone: 'good' });
      save();
    }
  }

  function logGame(t, opts = {}) {
    const info = t.c.info, form = FORM_WORD[t.c.form] || cap(t.c.form);
    const choices = choicesFor(t);
    return {
      name: 'rtk-log', title: 'Log the plant', icon: 'plant', card: 'rtk-log-card', cancellable: false,
      instructions: 'Which plant is this? Find the name with the *same leaf* and the *same family*.',
      foot: 'Click a name, or press [1] [2] [3]',
      mount(stage, api) {
        stage.classList.add('rtk-log-stage');
        stage.innerHTML =
          '<div class="rtk-log-clues">' +
            `<figure class="rtk-log-leaf">${leafSketch(info.leaf)}<figcaption>${escapeHtml(form)}</figcaption></figure>` +
            '<div class="rtk-log-hint">' +
              `<div class="rtk-fam"><small>Family</small><b>${escapeHtml(info.family)}</b><span>the ${escapeHtml(info.familyCommon)}</span></div>` +
              `<p>${escapeHtml(info.hint)}</p>` +
            '</div>' +
          '</div>' +
          '<div class="rtk-log-picks">' +
            choices.map((c, k) => `<button type="button" class="ui-btn is-soft rtk-pick" data-k="${k}"><em class="ui-choice-num">${k + 1}</em>` +
              `${leafSketch(c.leaf, { size: '2.3em', cls: 'rtk-pick-leaf' })}<span><b>${escapeHtml(cap(c.common))}</b><small>${escapeHtml(c.familyCommon)}</small></span></button>`).join('') +
          '</div>' +
          '<div class="rtk-log-after"></div>';
        const btns = [...stage.querySelectorAll('.rtk-pick')];
        const after = stage.querySelector('.rtk-log-after');
        let picked = -1, openedAt = performance.now();
        const pick = (k) => {
          if (picked >= 0 || !choices[k] || performance.now() - openedAt < 250) return;
          picked = k;
          const c = choices[k], right = c.right;
          btns.forEach((b, i) => {
            b.disabled = true;
            b.classList.toggle('is-right', choices[i].right);
            b.classList.toggle('is-wrong', i === k && !right);
            b.classList.toggle('is-dim', i !== k && !choices[i].right);
          });
          audio.cue('plantLog', right);
          // a wrong pick that shared a clue was close; one that shared neither was not
          const fact = info.fact ? ' ' + escapeHtml(info.fact) : '';
          const what = `<b>${escapeHtml(info.common)}</b> (<i>${escapeHtml(info.sci)}</i>)`;
          const lead = c.family === info.family ? 'Close! Same family, but this one is a'
            : c.leaf === info.leaf ? 'Close! Same leaf, but this one is a' : 'Not quite! This one is a';
          after.innerHTML = (right
            ? `<p class="rtk-verdict is-right">${icon('check')} Spot on! <b>${escapeHtml(cap(info.common))}</b> (<i>${escapeHtml(info.sci)}</i>), from the ${escapeHtml(info.familyCommon)}.${fact}</p>`
            : `<p class="rtk-verdict is-kind">${icon('leaf')} ${lead} ${what}.${fact} Recorded all the same!</p>`) +
            `<button type="button" class="ui-btn rtk-next">${icon('plant')}Log it <kbd>E</kbd></button>`;
          after.querySelector('.rtk-next').addEventListener('click', (e) => { e.stopPropagation(); finishLog(); });
          doneAt = performance.now();
        };
        let doneAt = 0;
        const finishLog = () => {
          if (picked < 0 || performance.now() - doneAt < 300) return;
          api.done({ success: true, quality: choices[picked].right ? 1 : 0.5, right: choices[picked].right, quiet: true });
        };
        btns.forEach((b, k) => b.addEventListener('click', (e) => { e.stopPropagation(); pick(k); }));
        const onKey = (e) => {
          if (/^Digit[1-3]$/.test(e.code) || /^Numpad[1-3]$/.test(e.code)) { e.preventDefault(); e.stopPropagation(); pick(Number(e.code.slice(-1)) - 1); }
        };
        window.addEventListener('keydown', onKey, true);
        if (M.auto || opts.autoPick != null) {
          const k = opts.autoPick != null ? opts.autoPick : choices.findIndex((c) => c.right);
          setTimeout(() => { openedAt = 0; pick(k); if (!opts.hold) setTimeout(() => { doneAt = 0; finishLog(); }, 500); }, 300);
        }
        return {
          onUse() { if (picked >= 0) finishLog(); },
          destroy() { window.removeEventListener('keydown', onKey, true); },
        };
      },
    };
  }

  // ---------------------------------------------------------------- the end

  function starsNow() {
    return 1 + (M.named >= R.stars.named ? 1 : 0) + (M.wobbles + M.bites <= R.stars.steady ? 1 : 0);
  }
  async function finish(opts = {}) {
    M.stage = 'done';
    const stars = starsNow();
    const points = missionPoints(stars);
    const d = missionRecord('rtk').data;
    if (M.named >= M.targets.length) d.perfect = (d.perfect || 0) + 1;
    if (M.ibis) d.ibis = (d.ibis || 0) + M.ibis;
    clearTargets();
    frameOff();
    M.doneToday = dayKey();
    // what earned the stars, for James's line: the names, or a steady pole
    const why = M.named >= R.stars.named ? 'named' : M.wobbles + M.bites <= R.stars.steady ? 'steady' : 'done';
    const card = kit.minigame(doneGame(stars, points, opts));
    // scored and stamped while the card is up (the stamps land on its corner)
    setTimeout(() => {
      M.active = false;
      events.emit('mission:done', { id: 'rtk', stars, points, why });
    }, 450);
    await card;
    M.stage = 'idle';
  }

  function doneGame(stars, points, opts = {}) {
    return {
      name: 'rtk-done', title: 'Plant survey done!', icon: 'plant', card: 'rtk-done-card', cancellable: false,
      instructions: 'Five plants on the map, good to a couple of centimetres.',
      foot: '[E] or click to carry on',
      mount(stage, api) {
        stage.classList.add('rtk-done-stage');
        const rows = M.targets.map((t) =>
          `<div class="rtk-done-row">${leafSketch(t.c.info.leaf, { size: '2.4em', cls: 'rtk-mini' })}<span><b>${escapeHtml(cap(t.c.info.common))}</b><i>${escapeHtml(t.c.info.sci)}</i></span>` +
          `<em class="${t.named ? 'is-right' : ''}">${t.named ? icon('check') + 'named' : 'recorded'}</em></div>`).join('');
        // the steady star counts wobbles and bites together; the chip names them apart
        const steady = M.wobbles + M.bites;
        const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
        const shook = [M.wobbles ? plural(M.wobbles, 'wobble') : '', M.bites ? plural(M.bites, 'bite') : ''].filter(Boolean).join(', ');
        stage.innerHTML =
          `<div class="rtk-stars">${[1, 2, 3].map((k) => `<span class="${k <= stars ? 'is-on' : ''}" style="animation-delay:${0.15 + k * 0.18}s">${icon('star')}</span>`).join('')}</div>` +
          '<div class="rtk-done-why">' +
            `<span class="${M.named >= R.stars.named ? 'is-on' : ''}">${icon('leaf')}${M.named} of ${M.targets.length} named</span>` +
            `<span class="${steady <= R.stars.steady ? 'is-on' : ''}">${icon('rtk')}${steady === 0 ? 'Rock steady' : shook}</span>` +
            (M.swats ? `<span class="is-on">${icon('hand')}${M.swats} swatted</span>` : '') +
          '</div>' +
          `<div class="rtk-done-list">${rows}</div>` +
          `<div class="rtk-done-pts">+${points} points</div>`;
        const close = () => { if (performance.now() - opened > 700 && !opts.hold) api.done({ success: true, quiet: true }); };
        const opened = performance.now();
        audio.cue('starPop', stars);
        stage.addEventListener('click', close);
        if (M.auto && !opts.hold) setTimeout(() => api.done({ success: true, quiet: true }), 1400);
        return { onUse: close };
      },
    };
  }

  // ---------------------------------------------------------------- the ibis

  // where an ibis can go: open ground, or the shallows (it wades), never thicket
  const ibisOk = (x, z) => {
    if (T.isThicket(x, z)) return false;
    if (T.isWalkable(x, z)) return collision.isFree(x, z, 0.18);
    return T.isWater(x, z) && T.heightAt(x, z) > -0.4;
  };
  const lineClear = (x0, z0, x1, z1) => {
    const d = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.ceil(d / 0.35));
    for (let k = 0; k <= n; k++) {
      if (!ibisOk(x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n)) return false;
    }
    return true;
  };
  // Now and then (and always on the third plant of a day that has not had one) an
  // ibis walks up beside you while you wait, on the side the camera sees best, pecks
  // about and looks at the phone. Move and it startles off.
  const IBIS_DEST = [[0.8, 1.3], [0.3, 1.45], [1.3, 1.1], [-0.2, 1.5], [1.6, 0.6]];
  function maybeIbis(force = false) {
    if (ibis.st !== 'off' || topView) return false;
    const idx = M.targets.indexOf(M.cur);
    const rng = makeRng(dayKey() * 53 + idx * 11 + (M.cur ? M.cur.c.i : 0));
    if (!force && !(rng() < RTK.ibis.chance || (doneCount() === 2 && !M.ibis))) return false;
    const p = player.position;
    const hx = -Math.sin(player.heading), hz = -Math.cos(player.heading); // the way the player faces
    const lx = hz, lz = -hx; // the player's left
    // with the fix's camera on, first where it shows beside you (not behind you, not under
    // the cards); then anywhere it can stand
    for (let pass = frame.want ? 0 : 1; pass < 2; pass++) for (const side of [1, -1]) { // left first: the fix card sits on the right
      for (const [fa, sa] of IBIS_DEST) {
        const tx = p.x + hx * fa + lx * sa * side, tz = p.z + hz * fa + lz * sa * side;
        if (!ibisOk(tx, tz) || (pass === 0 && !ibisInFrame(tx, tz))) continue;
        for (const r of [4.2, 3.2, 2.4]) {
          for (let k = 0; k < 12; k++) {
            const a = (k / 12) * TAU + 0.3;
            const ox = tx + Math.cos(a) * r, oz = tz + Math.sin(a) * r;
            if (Math.hypot(ox - p.x, oz - p.z) < r) continue; // it comes from further off, not past you
            if (!lineClear(ox, oz, tx, tz)) continue;
            ibis.ox = ox; ibis.oz = oz; ibis.tx = tx; ibis.tz = tz;
            ibis.x = force ? tx : ox; ibis.z = force ? tz : oz;
            ibis.st = force ? 'peck' : 'wait';
            ibis.t = force ? 0 : between(rng, RTK.ibis.delay[0], RTK.ibis.delay[1]);
            ibis.h = force ? Math.atan2(-(p.z - tz), p.x - tx) : Math.atan2(-(tz - oz), tx - ox);
            ibis.pal = false; ibis.called = false; ibis.stay = 0;
            ibis.bird.visible = force;
            return true;
          }
        }
      }
    }
    return false;
  }
  // Where (x, z) shows in the fix's picture: clear of you (a body's width either side)
  // and between the left edge and the cards. Worked out in the flat from the frame's camera.
  function ibisInFrame(x, z) {
    const cam = game.camera, cp = frame.pos, p = player.position;
    let vx = frame.look.x - cp.x, vz = frame.look.z - cp.z;
    const vl = Math.hypot(vx, vz) || 1;
    vx /= vl; vz /= vl;
    const tanH = Math.tan((((cam && cam.fov) || 42) * Math.PI) / 360) * ((cam && cam.aspect) || 1.6);
    const dI = (x - cp.x) * vx + (z - cp.z) * vz, dP = (p.x - cp.x) * vx + (p.z - cp.z) * vz;
    if (dI < 1 || dP < 1) return false;
    // (screen right is (-vz, vx) in the flat)
    const sI = ((x - cp.x) * -vz + (z - cp.z) * vx) / dI, sP = ((p.x - cp.x) * -vz + (p.z - cp.z) * vx) / dP;
    return Math.abs(sI - sP) > 0.6 / Math.min(dI, dP) && sI / tanH > -0.9 && sI / tanH < 0.2;
  }
  function ibisStartle() {
    if (ibis.st === 'off' || ibis.st === 'flee' || ibis.st === 'wait') { if (ibis.st === 'wait') ibisOff(); return; }
    ibis.st = 'flee';
    ibis.t = 2.2;
    const p = player.position;
    const dx = ibis.x - p.x, dz = ibis.z - p.z, d = Math.hypot(dx, dz) || 1;
    ibis.tx = ibis.x + (dx / d) * 6; ibis.tz = ibis.z + (dz / d) * 6;
    ibis.h = Math.atan2(-(ibis.tz - ibis.z), ibis.tx - ibis.x);
    audio.cue('ibis', ibis.x, ibis.z, 1);
  }
  function ibisLeave() {
    if (ibis.st === 'off' || ibis.st === 'flee' || ibis.st === 'out') return;
    if (ibis.st === 'wait') { ibisOff(); return; }
    ibis.st = 'out';
    ibis.t = 7;
    ibis.tx = ibis.ox; ibis.tz = ibis.oz;
    ibis.h = Math.atan2(-(ibis.tz - ibis.z), ibis.tx - ibis.x);
  }
  function ibisOff() { ibis.st = 'off'; ibis.bird.visible = false; }
  function updateIbis(dt, t) {
    if (ibis.st === 'off') return;
    ibis.t -= dt;
    const b = ibis.bird;
    let walking = false, speed = RTK.ibis.speed;
    if (ibis.st === 'wait') {
      if (ibis.t > 0) return;
      ibis.st = 'in';
      b.visible = true;
    }
    if (ibis.st === 'in' || ibis.st === 'out' || ibis.st === 'flee') {
      if (ibis.st === 'flee') speed = 2.6;
      const dx = ibis.tx - ibis.x, dz = ibis.tz - ibis.z, d = Math.hypot(dx, dz);
      const step = Math.min(d, speed * dt);
      if (d > 0.02) {
        ibis.x += (dx / d) * step; ibis.z += (dz / d) * step;
        const want = Math.atan2(-dz, dx);
        let dh = want - ibis.h;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        ibis.h += dh * Math.min(1, dt * 6);
        walking = true;
      }
      if (ibis.st === 'in' && d < 0.05) {
        ibis.st = 'peck'; ibis.t = 1.6; ibis.peckT = 0;
        if (!ibis.called) { ibis.called = true; audio.cue('ibis', ibis.x, ibis.z, 0); }
      }
      if ((ibis.st === 'out' || ibis.st === 'flee') && (d < 0.05 || ibis.t <= 0)) { ibisOff(); return; }
    }
    // pecking about, then a long look at the phone (turned towards the player)
    let dip = 0, turn = 0;
    if (ibis.st === 'peck' || ibis.st === 'look') {
      ibis.peckT += dt;
      if (ibis.st === 'peck') {
        const c = ibis.peckT % 1.3;
        dip = c < 0.7 ? Math.sin((c / 0.7) * Math.PI) : 0;
        if (ibis.t <= 0) { ibis.st = 'look'; ibis.t = 2.4; }
      } else {
        const p = player.position;
        const want = Math.atan2(-(p.z - ibis.z), p.x - ibis.x);
        let dh = want - ibis.h;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        ibis.h += dh * Math.min(1, dt * 3);
        turn = 0.35 * Math.sin(ibis.peckT * 1.7);
        if (ibis.t <= 0) { ibis.st = 'peck'; ibis.t = 1.8; }
      }
    }
    const gy = Math.max(-0.04, T.heightAt(ibis.x, ibis.z));
    const bob = walking ? Math.abs(Math.sin(t * (ibis.st === 'flee' ? 16 : 8))) * 0.03 : 0;
    const hop = ibis.st === 'flee' ? Math.max(0, Math.sin(Math.min(1, (2.2 - ibis.t) * 1.6) * Math.PI)) * 0.35 : 0;
    b.position.set(ibis.x, gy + bob + hop, ibis.z);
    b.rotation.y = ibis.h;
    ibis.neck.rotation.z = -1.2 * dip + (walking ? 0.18 * Math.sin(t * 8) : 0.04 * Math.sin(t * 2.3));
    ibis.neck.rotation.y = turn;
  }

  // ---------------------------------------------------------------- per frame

  const hand = new THREE.Vector3();
  const HAND = new THREE.Vector3(0.025, -0.28, -0.01); // the right hand, from the arm's pivot
  const clocks = { spark: 0 }; // (timers on an object: no boxed number a frame)
  function update(dt, t) {
    // the clock waits while a card of the survey is up
    const cards = M.stage === 'fix' || M.stage === 'log' || M.stage === 'done';
    if (cards !== clockHeld) { clockHeld = cards; holdClock('rtk', cards); }
    // the camera on you and the plant while the pole is up (laid over the rig's)
    applyFrame(dt);
    // with reduced motion the motes hold still (they still mark the plants)
    glow.uniforms.uTime.value = state.settings && state.settings.reducedMotion ? 0 : t;
    halo.uniforms.uTime.value = glow.uniforms.uTime.value;
    if (glow.mesh.visible) {
      const cam = game.camera;
      glow.uniforms.uScale.value = (game.renderer.domElement.height / 2) / Math.tan(((cam.fov || 42) * Math.PI) / 360);
    }
    // the rover in the right hand, upright, its foot on the ground while a fix is taken
    const av = player.avatar;
    const shown = !topView && !!av && av.tool && av.tool.shown === 'rtk' && player.object.visible;
    rover.visible = shown;
    if (shown) {
      const arm = av.bones.armR;
      arm.updateWorldMatrix(true, false);
      hand.copy(HAND);
      arm.localToWorld(hand);
      const gy = Math.max(-0.05, T.heightAt(hand.x, hand.z));
      let y = hand.y - 0.52;
      if (M.stage === 'fix') y = gy;
      else y = Math.max(gy + 0.02, y);
      let jx = 0, jz = 0;
      if (M.shake > 0) {
        M.shake = Math.max(0, M.shake - dt);
        jx = Math.sin(t * 60) * 0.03 * M.shake * 2;
        jz = Math.cos(t * 47) * 0.02 * M.shake * 2;
      }
      rover.position.set(hand.x + jx, y, hand.z + jz);
      rover.rotation.set(jz * 3, player.heading, -jx * 3);
    }
    updateIbis(dt, t);
    // now and then a few sparkles over a plant still to record, when it is near
    if (M.active && M.stage === 'walk' && game.fx && game.fx.burst && !(state.settings && state.settings.reducedMotion)) {
      clocks.spark -= dt;
      if (clocks.spark <= 0) {
        clocks.spark = 1.6;
        const p = player.position;
        for (const tg of M.targets) {
          if (tg.done) continue;
          const d = Math.hypot(p.x - tg.c.base.x, p.z - tg.c.base.z);
          if (d < 26) game.fx.burst('sparkle', tg.c.base.x, tg.c.glowY, tg.c.base.z, 3);
        }
      }
    }
    if (flagPending) runFlag(dt);
  }

  // ---------------------------------------------------------------- ?mission=rtk

  let flagPending = FLAG_ON, flagT = 0;
  function runFlag(dt) {
    if (state.phase !== 'survey' || !state.clock.running || (game.story && game.story.cutscene)) return;
    flagT += dt;
    if (flagT < 0.4) return;
    flagPending = false;
    if (!M.active) {
      if (game.missions && game.missions.accept) game.missions.accept('rtk', { from: 'flag' });
      else start({ from: 'flag' });
    }
    if (!M.active || !M.targets.length) return;
    const tg = M.targets[Math.max(0, Math.min(M.targets.length - 1, Number(new URLSearchParams(location.search).get('missiontarget')) || 0))];
    gotoTarget(tg, STEP === 'walk' || !STEP ? Number(new URLSearchParams(location.search).get('missionback')) || 3.2 : 0);
    if (STEP === 'fix') setTimeout(() => beginFix(tg, { pose: true }), 700);
    else if (STEP === 'log') {
      setTimeout(() => { M.stage = 'fix'; M.cur = tg; markers.set('rtk', null); frameOn(tg); maybeIbis(true); logPlant(tg, { autoPick: null }); }, 700);
    } else if (STEP === 'logwrong') {
      setTimeout(() => {
        M.stage = 'fix'; M.cur = tg; markers.set('rtk', null); frameOn(tg);
        const ch = choicesFor(tg);
        logPlant(tg, { autoPick: ch.findIndex((c) => !c.right), hold: true });
      }, 700);
    } else if (STEP === 'done') {
      setTimeout(() => {
        M.targets.forEach((x, k) => { x.done = true; x.named = k !== 2; });
        M.named = 4; M.wobbles = 1; M.bites = 0; M.swats = 3;
        const d = missionRecord('rtk').data;
        d.plants = M.targets.map((x) => x.c.i);
        d.named = M.targets.filter((x) => x.named).map((x) => x.c.i);
        finish({ hold: true });
      }, 700);
    } else if (STEP === 'notebook') {
      const d = missionRecord('rtk').data;
      const list = candidates();
      d.plants = []; d.named = [];
      const names = new Set();
      for (const c of list) {
        if (names.has(c.info.common) || d.plants.length >= 9) continue;
        names.add(c.info.common);
        d.plants.push(c.i);
        if (d.plants.length % 3) d.named.push(c.i);
      }
      d.fixes = 9; d.swats = 4; d.ibis = 1;
      const rec = missionRecord('rtk');
      rec.done = Math.max(1, rec.done); rec.best = Math.max(2, rec.best);
      setTimeout(() => kit.openPanel('notebook', 'kit:rtk'), 600);
    }
  }
  // stand by a target: its stand spot (back a little along the line from the plant)
  function gotoTarget(tg, back = 0) {
    const s = tg.c.stand, b = tg.c.base;
    const dx = s.x - b.x, dz = s.z - b.z, d = Math.hypot(dx, dz) || 1;
    let x = s.x + (dx / d) * back, z = s.z + (dz / d) * back;
    if (back > 0 && !walkOk(x, z)) { x = s.x; z = s.z; }
    player.teleport(x, z, Math.atan2(-(b.x - x), -(b.z - z)));
    if (game.rig) { game.rig.yaw = player.heading; game.rig.snap(); }
  }

  // ---------------------------------------------------------------- the notebook page

  function notebook() {
    const rec = missionRecord('rtk');
    const d = rec.data || {};
    const n = Array.isArray(d.plants) ? d.plants.length : 0;
    return {
      title: 'Plant survey',
      blurb: 'The RTK rover corrects its GPS with a base station\'s signal: once it has a FIX it is good to about 2 cm. The lab recorded 317 plants on the island this way in June.',
      stamps: [
        { label: 'First fix', done: (d.fixes || 0) > 0, icon: 'rtk', tone: 'green' },
        { label: 'Botanist', done: rec.done > 0, icon: 'plant', tone: 'green' },
        { label: 'Know-it-all', done: (d.perfect || 0) > 0, icon: 'leaf', tone: 'gold' },
        { label: 'Swat!', done: (d.swats || 0) >= 3, icon: 'hand', tone: 'blue' },
        { label: 'Ibis pal', done: (d.ibis || 0) > 0, icon: 'heart', tone: 'blue' },
      ],
      count: n,
      render: (el) => renderPage(el),
    };
  }

  function renderPage(el) {
    const rec = missionRecord('rtk');
    const d = rec.data || {};
    const idx = (Array.isArray(d.plants) ? d.plants : []).filter((i) => plants[i] && plantInfo(plants[i]));
    const named = new Set(Array.isArray(d.named) ? d.named : []);
    const nNamed = idx.filter((i) => named.has(i)).length;
    const rows = idx.length
      ? idx.map((i) => {
        const p = plants[i], info = plantInfo(p);
        return `<div class="rtk-nb-row">${leafSketch(info.leaf, { size: '2.3em', cls: 'rtk-mini' })}` +
          `<div><b>${escapeHtml(cap(info.common))}</b> <i>${escapeHtml(info.sci)}</i>` +
          `<small>${escapeHtml(cap(info.familyCommon))} (${escapeHtml(info.family)})</small></div>` +
          `<span class="rtk-form is-${escapeHtml(p.form)}">${escapeHtml(FORM_WORD[p.form] || p.form)}</span>` +
          `${named.has(i) ? `<span class="rtk-tick" title="Named right">${icon('check')}</span>` : '<span class="rtk-tick is-off"></span>'}</div>`;
      }).join('')
      : `<div class="nb-empty">No plants recorded yet.<br>Ask James about the plant survey!</div>`;
    const today = M.active ? M.targets.filter((t) => !t.done).length : 0;
    el.innerHTML =
      '<div class="rtk-nb">' +
        '<div class="rtk-nb-col">' +
          '<div class="nb-stats" style="grid-template-columns:repeat(3,1fr)">' +
            `<div class="nb-stat"><b>${idx.length}</b><small>Plants recorded</small></div>` +
            `<div class="nb-stat"><b>${idx.length ? Math.round((nNamed / idx.length) * 100) + '%' : '-'}</b><small>Named right</small></div>` +
            `<div class="nb-stat"><b>${rec.best ? '★'.repeat(rec.best) : '-'}</b><small>Best survey</small></div>` +
          '</div>' +
          `<div class="rtk-nb-list">${rows}</div>` +
        '</div>' +
        '<div class="rtk-nb-col">' +
          `<h3>${icon('map')} Where they grow</h3>` +
          '<canvas class="nb-map rtk-nb-map"></canvas>' +
          `<div class="rtk-nb-key"><span><i class="is-rec"></i>Recorded</span>${today ? `<span><i class="is-today"></i>Still to do today (${today})</span>` : ''}</div>` +
        '</div>' +
      '</div>';
    const cv = el.querySelector('canvas');
    const maps = game.ui && game.ui.maps;
    if (!cv || !maps || !maps.drawIsland) return;
    const draw = () => {
      if (!cv.isConnected) return;
      maps.drawIsland(cv, {
        bare: true,
        after(ctx, v) {
          const X = (x) => v.W / 2 + (x - v.cx) * v.s, Y = (z) => v.H / 2 + (z - v.cz) * v.s;
          const u = v.dpr;
          for (const i of idx) {
            const p = plants[i], x = X(p.x), y = Y(p.z);
            ctx.beginPath(); ctx.arc(x, y + 1.2 * u, 6 * u, 0, TAU);
            ctx.fillStyle = 'rgba(40, 60, 30, 0.25)'; ctx.fill(); // a soft shadow
            ctx.beginPath(); ctx.arc(x, y, 5.6 * u, 0, TAU);
            ctx.fillStyle = named.has(i) ? '#2f8f3a' : '#6cbf4f'; ctx.fill();
            ctx.lineWidth = 2 * u; ctx.strokeStyle = '#fffdf2'; ctx.stroke();
          }
          if (M.active) {
            for (const t of M.targets) {
              if (t.done) continue;
              ctx.beginPath(); ctx.arc(X(t.c.base.x), Y(t.c.base.z), 7 * u, 0, TAU);
              ctx.lineWidth = 2.6 * u; ctx.strokeStyle = '#f2b829'; ctx.stroke();
            }
          }
        },
      });
    };
    requestAnimationFrame(draw);
    setTimeout(draw, 60);
  }

  // ---------------------------------------------------------------- scripted runs

  game.play = Object.assign(game.play || {}, {
    rtk: {
      get auto() { return M.auto; },
      set auto(v) { M.auto = !!v; },
      state: () => ({ active: M.active, stage: M.stage, named: M.named, wobbles: M.wobbles, bites: M.bites, swats: M.swats, ibis: M.ibis, targets: M.targets.map((t) => ({ name: t.c.info.common, form: t.c.form, done: t.done, named: t.named })) }),
      targets: () => M.targets.map((t) => ({ name: t.c.info.common, sci: t.c.info.sci, form: t.c.form, done: t.done, stand: t.c.stand, base: t.c.base })),
      candidates: () => candidates().length,
      goto: (k = 0, back = 0) => { const tg = M.targets[k] || M.targets.find((x) => !x.done); if (tg) gotoTarget(tg, back); return !!tg; },
      plant: () => { const tg = nearestTarget(); if (tg) beginFix(tg); return !!tg; },
      // can an ibis walk up by target k? (stands there, tries, puts the bird away)
      ibisTest: (k = 0) => {
        const tg = M.targets[k];
        if (!tg) return null;
        gotoTarget(tg, 0);
        const was = M.cur;
        M.cur = tg;
        const ok = maybeIbis(true);
        const at = ok ? { x: ibis.x, z: ibis.z } : null;
        ibisOff();
        M.cur = was;
        return at;
      },
      start: () => start({ from: 'play' }),
      // the day's five as they would be picked now, and the walk round them from here
      pickTest: () => {
        const ts = pickTargets(), p = player.position;
        let far = 0;
        for (const a of ts) for (const b of ts) far = Math.max(far, dist2(a.c, b.c));
        return { names: ts.map((t) => t.c.info.common), forms: ts.map((t) => t.c.form), tour: Math.round(tourOf(ts.map((t) => t.c), p.x, p.z) * 10) / 10, span: Math.round(far) };
      },
      // the fix's camera: how far in, where it stands and looks
      frame: () => ({ k: frame.k, want: frame.want, pos: frame.pos.toArray(), look: frame.look.toArray(), turn: frame.turn }),
    },
  });

  // ---------------------------------------------------------------- the mission

  const mission = {
    id: 'rtk', title: 'Plant survey', tool: 'rtk',
    group,
    get active() { return M.active; },
    available,
    start,
    stop,
    update,
    progress,
    notebook,
    // mid-job (the pole up, the log or end card): another mission waits (the registry's busyOther)
    get busy() { return M.stage === 'fix' || M.stage === 'log' || M.stage === 'done'; },
    get stats() {
      return {
        active: M.active, stage: M.stage, targets: M.targets.length, done: progress().done, candidates: cands ? cands.length : null, candMs, frame: Math.round(frame.k * 100) / 100,
        drawCalls: topView ? 0 : (rover.visible ? 1 : 0) + (glow.mesh.visible ? 1 : 0) + (halo.mesh.visible ? 1 : 0) + (ibis.bird.visible ? 2 : 0),
      };
    },
  };
  registerMission(mission);
  // the plants with a spot to stand, worked out now while the game loads (about 25 ms)
  // rather than in whichever frame first asks (James's offer or the tool ring)
  const tc = performance.now();
  try { candidates(); } catch (e) { console.error(e); cands = null; }
  candMs = Math.round((performance.now() - tc) * 10) / 10;
  return mission;
}

// A cute mosquito: striped body, big eye, long legs, fluttery wings (the CSS flaps
// them in flight and folds them when it lands).
const MOZZIE_SVG = '<svg viewBox="-20 -20 40 40" width="50" height="50" aria-hidden="true">' +
  '<g class="rtk-legs" stroke="#4a3e44" stroke-width="1.2" fill="none" stroke-linecap="round">' +
    '<path d="M-2 3 L-8 12 L-11 16"/><path d="M1 3 L-1 12 L-3 17"/><path d="M4 3 L8 11 L12 15"/></g>' +
  '<g class="rtk-wings"><ellipse class="rtk-wing" cx="-3" cy="-7" rx="4.5" ry="9" transform="rotate(-28 -3 -7)"/>' +
    '<ellipse class="rtk-wing" cx="3" cy="-7" rx="4.5" ry="9" transform="rotate(22 3 -7)"/></g>' +
  '<ellipse cx="4" cy="1" rx="9" ry="3.6" fill="#6b5a62"/>' +
  '<path d="M1 -2.4v6.8M4.5 -2.8v7.6M8 -2.4v6.8" stroke="#f3e9d8" stroke-width="1.3"/>' +
  '<circle cx="-7" cy="-0.5" r="4.4" fill="#5d4d55"/><circle cx="-8.2" cy="-1.4" r="2.2" fill="#fff"/><circle cx="-8.6" cy="-1.2" r="1.2" fill="#2b2320"/>' +
  '<path d="M-11 0.5 L-18 3" stroke="#4a3e44" stroke-width="1.2" stroke-linecap="round"/>' +
  '</svg>';
