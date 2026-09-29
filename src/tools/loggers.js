// Temperature loggers: one on every grid flag, out on the island from the start (the
// lab's real reason for them: mapping the thermal landscape that decides where the
// anoles perch). Each is a little white radiation shield on a clip with a blinking
// green light, all in one instanced mesh.
//
// On the survey day, walking within DOWNLOAD_R of one downloads it by itself: two
// beeps, a sparkle and a small toast, no mini-game. Each download reads the simulated
// microclimate round the logger at that hour and colours a patch of the island on the
// minimap and the big map (src/ui/minimap.js draws `patches`): warm where the sun gets
// in at perch height, cool in the shade. The sun test is the lizards' own
// (game.lizards.sunExposure: the drawn crowns, fans, bushes and trunks), so the warm
// patches are where lizards bask in the morning and late afternoon (and display more),
// and at midday the lizards still out on their perches sit in the cool ones. A patch
// fades as its reading goes stale (FRESH to STALE game hours), and a logger can be
// downloaded again RULES.loggerReadEvery hours after its last download, so a second
// pass later in the day is worthwhile.
//
// One word for a patch everywhere: its kind is the majority of its cells (what the map
// shows), and the chip, the logger's dot, the toast and James all use it. The number
// is the patch's too (its mean sun, plus the stake's shade and water), held inside its
// kind's band for the hour, so at one moment a warm patch always reads warmer than a
// dappled one and that warmer than a cool one.
//
//   build(game) -> { group, update, deploy(id), deployAll(), restore(), targets,
//                    celsius(stake, hours), celsiusAt(x, z, hours), due(logger),
//                    download(logger), patches, freshness(patch), patchAt(x, z),
//                    stats, showTargets(), targetsLeft() }
//     patches: the downloads of this session, one per logger: { id, x, z, r, hours,
//       celsius, kind ('warm' | 'cool' | 'mixed'), warm, cool (cells), meanE (its mean
//       sun), own (the stake's own spot, for checks), canvas (the soft blob to draw over
//       2r x 2r metres centred on x, z) }
//     freshness(p): 1 while the reading is fresh, falling to 0 as it goes stale
//     patchAt(x, z, minFresh = 0.05): 'warm', 'cool' or 'mild' from the freshest patch
//       there, or null
//     isToday(reading): downloaded on today's survey day in this session (a save's
//       readings from an unfinished day never count: the day starts again at 07:30)
//   ?loggers=all downloads every logger as the survey day starts (check images).
//   events: logger:read { id, celsius, hours, kind, auto: true } (a download; the name
//     is kept for the tasks, the requests, the sound and the day's counts)
//
// readMinigame() is the GPS case's download card (src/tools/backpacks.js); the loggers
// no longer use a card.

import * as THREE from 'three';
import { events } from '../core/events.js';
import { state, RULES, addScore, dayKey } from '../game/state.js';
import * as kit from '../ui/kit.js';
import { loadStakes } from './stakes.js';
import { toonGradient } from '../player/avatar.js';
import { THERMAL } from '../lizards/species.js';
import { SCRIPT, say } from '../story/script.js';
import { el, ensureStoryStyle } from '../story/style.js';

const MAX = 16;
// a logger on every grid flag (false: only the five logger stakes of data/stakes.json)
const ON_EVERY_FLAG = true;
export const DOWNLOAD_R = 3.0; // metres: walking this close downloads a logger
export const PATCH_R = 9; // metres: the patch of island a download colours
const CELL = 1; // metres a sample
const CELL_PX = 6; // pixels a sample in the blob's canvas
export const FRESH = 1.5; // game hours a reading stays fresh (about 1.6 real minutes on a 12-minute day)
export const STALE = 4.0; // game hours after which its patch has faded away
const PERCH_HEIGHTS = [1.0, 2.2]; // metres over the ground the sun is tested at (typical perches)
const ALL_AT_START = new URLSearchParams(location.search).get('loggers') === 'all';
// the patches' colours, softened to sit with the pastel map (minimap.js and notebook.js
// use the same two)
export const WARM_RGB = [255, 168, 92];
export const COOL_RGB = [102, 176, 230];
const SMOOTH_R = 2; // cells: each cell's sun is the soft mean of its neighbours this far out
// a patch is warm or cool when that side has this many times the other's cells and at
// least MAJOR_SHARE of its land; otherwise sun and shade are mixed (dappled)
const MAJOR = 1.3, MAJOR_SHARE = 0.3;
const PATCH_WORD_GAP = 9; // seconds after a download before the patch word may show

// ---------------------------------------------------------------- the microclimate

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function hash(str, n) {
  let h = 2166136261 ^ n;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

// The day's air temperature (degrees C) at a clock hour, in the shade and away from
// the water: a gentle curve from the dawn low to an early-afternoon high.
export function baseCelsius(hours) {
  const C = RULES.climate;
  let f;
  if (hours >= C.lowHour && hours <= C.highHour) f = (1 - Math.cos(Math.PI * (hours - C.lowHour) / (C.highHour - C.lowHour))) / 2;
  else {
    const since = (hours - C.highHour + 24) % 24;
    f = (1 + Math.cos(Math.PI * Math.min(1, since / (24 - (C.highHour - C.lowHour))))) / 2;
  }
  return C.low + (C.high - C.low) * f;
}

let G = null; // the game, once built
const _sun = new THREE.Vector3(0, 1, 0);
function sunNow() {
  const s = G && G.sky && G.sky.state && G.sky.state.sunDir;
  if (s) _sun.copy(s); else _sun.set(0.3, 0.8, 0.2).normalize();
  return _sun;
}

// Sunlight at perch height over (x, z), 0..1: the lizards' own test (the drawn crowns,
// fans, bushes and trunks), or without the lizards the canopy grid.
function exposureAt(x, z, g) {
  const L = G && G.lizards;
  if (L && typeof L.sunExposure === 'function') {
    let e = 0;
    for (let k = 0; k < PERCH_HEIGHTS.length; k++) e += L.sunExposure(x, g + PERCH_HEIGHTS[k], z, 0, 1, 0);
    return e / PERCH_HEIGHTS.length;
  }
  const T = G && G.data && G.data.terrain;
  const s = sunNow();
  const open = T ? 1 - smooth(0.5, 8, T.canopyAt(x, z)) : 0.5;
  return open * smooth(0.02, 0.2, s.y);
}

// Metres to the lake from (x, z), to the nearest 1.5 m, up to 6 m.
function waterDistance(T, x, z) {
  if (T.isWater(x, z)) return 0;
  for (let r = 1.5; r <= 6; r += 1.5) {
    for (let a = 0; a < 8; a++) {
      const ang = a * 0.7854 + r;
      if (T.isWater(x + Math.cos(ang) * r, z + Math.sin(ang) * r)) return r;
    }
  }
  return 6;
}

// Degrees C at (x, z) at a clock hour (the sun as the sky has it now), to 0.1; out
// (optional, reused) gets { exposure, celsius }.
export function celsiusAt(x, z, hours, out = null, key = '') {
  const C = RULES.climate;
  const T = G && G.data && G.data.terrain;
  const g = T ? Math.max(0, T.heightAt(x, z)) : 0;
  const e = exposureAt(x, z, g);
  const sunUp = Math.max(0, sunNow().y);
  const sun = C.sun * e * Math.pow(sunUp, 0.8);
  const canopy = T ? T.canopyAt(x, z) : 4;
  const shade = C.shade * smooth(2, 12, canopy);
  const water = T ? C.water * (1 - smooth(0, 6, waterDistance(T, x, z))) : 0;
  const wobble = key ? (hash(key, Math.floor(hours * 4)) - 0.5) * 2 * C.wobble : 0;
  const c = Math.round((baseCelsius(hours) + sun + shade + water + wobble) * 10) / 10;
  if (out) { out.exposure = e; out.celsius = c; }
  return c;
}

// Degrees C at a stake (its own spot), for the reading.
export function celsius(stake, hours) { return celsiusAt(stake.x, stake.z, hours, null, stake.id); }

// 'warm' (in the sun at perch height), 'cool' (in the shade) or 'mild', by the lizards' own
// thresholds (THERMAL.sunny and .shady)
export const kindOf = (e) => (e > THERMAL.sunny ? 'warm' : e < THERMAL.shady ? 'cool' : 'mild');

// ---------------------------------------------------------------- geometry

function loggerGeometry() {
  const parts = [];
  const white = new THREE.Color('#f7f5ee'), grey = new THREE.Color('#9aa6ad'), green = new THREE.Color('#62d26f'), strap = new THREE.Color('#3f8fd8');
  const add = (g, c, led = 0) => parts.push([g.index ? g.toNonIndexed() : g, c, led]);
  // it hangs beside the stake, a little off it
  const ox = -0.09, oy = 0.36;
  add(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 5).translate(ox, oy + 0.02, 0), grey);
  for (let k = 0; k < 4; k++) {
    add(new THREE.CylinderGeometry(0.045, 0.062, 0.016, 12).translate(ox, oy - 0.06 + k * 0.03, 0), white);
  }
  add(new THREE.SphereGeometry(0.047, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1).translate(ox, oy + 0.058, 0), white);
  add(new THREE.BoxGeometry(0.1, 0.02, 0.02).translate(ox / 2, oy + 0.085, 0), grey);
  add(new THREE.TorusGeometry(0.034, 0.008, 5, 12).rotateX(Math.PI / 2).translate(0, oy + 0.085, 0), strap);
  add(new THREE.IcosahedronGeometry(0.011, 0).translate(ox, oy - 0.02, -0.058), green, 1);
  let n = 0;
  for (const [g] of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), led = new Float32Array(n);
  let o = 0;
  for (const [g, c, l] of parts) {
    g.computeVertexNormals();
    const cnt = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    for (let k = 0; k < cnt; k++) { col[(o + k) * 3] = c.r; col[(o + k) * 3 + 1] = c.g; col[(o + k) * 3 + 2] = c.b; }
    led.fill(l, o, o + cnt);
    o += cnt;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aLed', new THREE.BufferAttribute(led, 1));
  geo.computeBoundingSphere();
  return geo;
}

// aFlash (per instance): 1 just after a download, the light blinking fast, fading out
function loggerMaterial(uTime) {
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLed;\nattribute float aFlash;\nuniform float uTime;\nvarying float vLed;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float seed = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.3;
        float slow = step(0.82, fract(uTime * 0.5 + seed));
        float fast = step(0.5, fract(uTime * 6.0));
        vLed = aLed * max(slow, fast * aFlash);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLed;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.45, 1.0, 0.5) * vLed * 1.4;');
  };
  mat.customProgramCacheKey = () => 'loggers-2';
  return mat;
}

// ---------------------------------------------------------------- the GPS case's card

// Tap to wake it, then tap again while the reading shows, before it dozes off. Only the
// GPS backpacks' download uses it now (its own title, unit and text).
export function readMinigame({ label = 'GPS 01', value = 0, text: shownText = null, unit = '', title = null, icon = 'backpack', instructions = null, name = 'gps' } = {}) {
  return {
    name,
    title: title || `Download ${label}`,
    icon,
    instructions: instructions || 'Press [E] to wake it, then press again while the reading shows!',
    mount(stage, api) {
      ensureStoryStyle();
      const root = el('div', 'st-read');
      root.innerHTML = `
        <div class="st-read-box">
          <div class="st-read-lcd"><span class="st-read-digits">&nbsp;</span><small>${unit}</small></div>
          <div class="st-read-led"></div>
          <div class="st-read-name"></div>
        </div>
        <div class="st-flag-tries"></div>`;
      root.querySelector('.st-read-name').textContent = label;
      stage.appendChild(root);
      const lcd = root.querySelector('.st-read-lcd');
      const digits = root.querySelector('.st-read-digits');
      const tries = root.querySelector('.st-flag-tries');
      // asleep -> waking (scrolling digits) -> showing (the value, catch it) -> asleep
      let mode = 'asleep', t = 0, miss = 0, over = false;
      const WAKE = 0.9, SHOW = 1.25;
      const text = shownText != null ? String(shownText) : value.toFixed(1);
      const onUse = () => {
        if (over) return;
        if (mode === 'asleep') { mode = 'waking'; t = 0; lcd.classList.add('is-on'); tries.textContent = ''; return; }
        if (mode === 'showing') {
          over = true;
          lcd.classList.add('is-caught');
          setTimeout(() => api.done({ success: true, quality: Math.max(0.4, 1 - t / SHOW * 0.6), label: 'Got it!' }), 650);
        }
      };
      root.addEventListener('pointerdown', (e) => { e.preventDefault(); onUse(); });
      return {
        update(dt) {
          if (over) return;
          t += dt;
          const auto = window.__game && window.__game.play && window.__game.play.auto;
          if (mode === 'asleep') {
            digits.innerHTML = '&nbsp;';
            if (auto && t > 0.3) onUse();
          } else if (mode === 'waking') {
            digits.textContent = shownText != null ? String(Math.floor(Math.random() * 99)) : (20 + Math.random() * 12).toFixed(1);
            if (t > WAKE) { mode = 'showing'; t = 0; digits.textContent = text; lcd.classList.add('is-value'); }
          } else if (mode === 'showing') {
            lcd.classList.toggle('is-blink', t > SHOW * 0.6 && Math.floor(t * 10) % 2 === 0);
            if (auto && t > 0.25) onUse();
            if (t > SHOW) {
              mode = 'asleep'; t = 0; miss++;
              lcd.classList.remove('is-on', 'is-value', 'is-blink');
              tries.textContent = miss >= 3 ? '' : 'It dozed off! Press again to wake it';
              if (miss >= 3) { over = true; setTimeout(() => api.done({ success: false, quality: 0, label: 'Zzz...' }), 300); }
            }
          }
        },
        onUse,
      };
    },
  };
}

// ---------------------------------------------------------------- the system

export async function build(game) {
  G = game;
  const { player } = game;
  const stakes = await loadStakes(game);
  const group = new THREE.Group();
  group.name = 'loggers';
  const uTime = { value: 0 };
  const geo = loggerGeometry();
  const flash = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
  flash.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aFlash', flash);
  const mesh = new THREE.InstancedMesh(geo, loggerMaterial(uTime), MAX);
  mesh.name = 'loggers';
  mesh.count = 0;
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  group.add(mesh);
  // every flag, the five logger stakes first so an old save keeps its order
  const five = stakes.targets.loggers;
  const targets = ON_EVERY_FLAG
    ? [...five, ...stakes.targets.flags.filter((s) => !five.includes(s))].slice(0, MAX)
    : five.slice(0, MAX);
  const slotOf = new Map(); // logger id -> instance index
  const flashT = new Float32Array(MAX); // seconds of flashing left, per instance
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(1, 1, 1), p3 = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  function draw() {
    let i = 0;
    slotOf.clear();
    for (const l of state.loggers) {
      const s = stakes.byId.get(l.id);
      if (!s || i >= MAX) continue;
      q.setFromAxisAngle(up, (s.x * 1.3 + s.z * 0.7) % 6.28);
      m.compose(p3.set(s.x, s.y, s.z), q, s3);
      slotOf.set(l.id, i);
      mesh.setMatrixAt(i++, m);
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
  }

  const byId = (id) => { for (let i = 0; i < state.loggers.length; i++) if (state.loggers[i].id === id) return state.loggers[i]; return null; };

  // Puts a logger on stake id (quietly: they are out from the start). Returns true when added.
  function add(id) {
    const s = stakes.byId.get(id);
    if (!s || byId(id)) return false;
    state.loggers.push({ id, x: s.x, y: s.y, z: s.z, readings: [] });
    return true;
  }
  // Every logger out on its stake, the order of `targets`, positions filled in, readings
  // kept (an old save's loggers stay; a stake no longer used keeps its readings too).
  function ensureAll() {
    for (const s of targets) add(s.id);
    for (const l of state.loggers) {
      const s = stakes.byId.get(l.id);
      if (s) { l.x = s.x; l.y = s.y; l.z = s.z; }
      if (!Array.isArray(l.readings)) l.readings = [];
    }
    state.inventory.loggers = 0;
    draw();
    updateStowed();
  }
  const deploy = (id) => { const ok = add(id); ensureAll(); return ok; };
  const deployAll = () => ensureAll();
  const restore = () => ensureAll();

  function updateStowed() {
    const av = player.avatar;
    if (av && av.setStowed) av.setStowed({ loggers: false });
  }

  // ---- downloads and the patches they colour
  // lastDl: logger id -> { dk, hours } this session (a save's readings from an earlier
  // session never count as today's: the survey day starts again at 07:30)
  const lastDl = new Map();
  const patches = [];
  const patchOf = new Map();
  const nSide = Math.round((PATCH_R * 2) / CELL) + 1, half = (nSide - 1) / 2;
  const scratch = { exposure: 0, celsius: 0 };

  // due for a download: none yet today, or RULES.loggerReadEvery game hours since the last
  function due(l) {
    const d = lastDl.get(l.id);
    if (!d || d.dk !== dayKey()) return true;
    const age = state.clock.hours - d.hours;
    return age < 0 || age >= RULES.loggerReadEvery;
  }

  function freshness(p) {
    if (!p || p.dk !== dayKey()) return 0;
    const age = state.clock.hours - p.hours;
    if (age < -0.01) return 0;
    if (age <= FRESH) return 1;
    return Math.max(0, 1 - (age - FRESH) / (STALE - FRESH));
  }

  // scratch for a patch's samples (one patch is worked out at a time): the sun at each
  // cell, its softened value, and which cells are land inside the circle
  const eRaw = new Float32Array(nSide * nSide), onLand = new Uint8Array(nSide * nSide);
  // the softening kernel: cell offsets within SMOOTH_R and tent weights
  const KO = [], KW = [];
  for (let b = -SMOOTH_R; b <= SMOOTH_R; b++) {
    for (let a = -SMOOTH_R; a <= SMOOTH_R; a++) {
      const d = Math.hypot(a, b);
      if (d > SMOOTH_R + 0.01) continue;
      KO.push(a, b); KW.push(1 - d / (SMOOTH_R + 1));
    }
  }

  // The sun and shade round a logger now: a grid of samples within PATCH_R at perch
  // height, each softened over its neighbours (so a trunk's or a frond's thin shadow does
  // not speckle the patch) and classed warm, cool or mild, drawn once into a soft blob.
  // The classes the map draws are the ones patchAt() answers with.
  function computePatch(l, hours) {
    const T = game.data.terrain;
    let p = patchOf.get(l.id);
    if (!p) {
      const small = document.createElement('canvas');
      small.width = small.height = nSide;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = nSide * CELL_PX;
      p = { id: l.id, x: l.x, z: l.z, r: PATCH_R + CELL / 2, n: nSide, cell: CELL, cls: new Int8Array(nSide * nSide), small, canvas, hours: 0, dk: 0, celsius: 0, kind: 'mixed', own: 'mild', warm: 0, cool: 0, land: 0, meanE: 0 };
      patchOf.set(l.id, p);
      patches.push(p);
    }
    p.x = l.x; p.z = l.z; p.hours = hours; p.dk = dayKey();
    // 1. the sun over each land cell inside the circle
    let land = 0;
    for (let j = 0; j < nSide; j++) {
      for (let i = 0; i < nSide; i++) {
        const k = j * nSide + i;
        onLand[k] = 0; eRaw[k] = 0;
        const dx = (i - half) * CELL, dz = (j - half) * CELL;
        if (Math.hypot(dx, dz) > PATCH_R + 0.01) continue;
        const x = p.x + dx, z = p.z + dz;
        if (T.isWater(x, z)) continue;
        eRaw[k] = exposureAt(x, z, Math.max(0, T.heightAt(x, z)));
        onLand[k] = 1;
        land++;
      }
    }
    // 2. softened, classed and coloured
    const sctx = p.small.getContext('2d');
    const img = sctx.createImageData(nSide, nSide);
    const px = img.data;
    let warm = 0, cool = 0, sumE = 0;
    for (let j = 0; j < nSide; j++) {
      for (let i = 0; i < nSide; i++) {
        const k = j * nSide + i, o = k * 4;
        p.cls[k] = 0;
        if (!onLand[k]) continue;
        let s = 0, w = 0;
        for (let q = 0; q < KW.length; q++) {
          const a = i + KO[2 * q], b = j + KO[2 * q + 1];
          if (a < 0 || b < 0 || a >= nSide || b >= nSide) continue;
          const kk = b * nSide + a;
          if (!onLand[kk]) continue;
          s += eRaw[kk] * KW[q]; w += KW[q];
        }
        const e = w > 0 ? s / w : eRaw[k];
        sumE += e;
        const kind = kindOf(e);
        // strength: how far into the sun or the shade, and a soft edge at the rim
        const d = Math.hypot((i - half) * CELL, (j - half) * CELL);
        const edge = 1 - smooth(PATCH_R * 0.55, PATCH_R + 0.5, d);
        const kw = smooth(THERMAL.shady + 0.04, THERMAL.sunny + 0.25, e);
        const kc = 1 - smooth(THERMAL.shady * 0.4, THERMAL.sunny - 0.02, e);
        const rgb = kw >= kc ? WARM_RGB : COOL_RGB;
        const a = Math.max(kw, kc) * edge;
        px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = Math.round(255 * a);
        if (kind === 'warm') { p.cls[k] = 1; warm++; } else if (kind === 'cool') { p.cls[k] = -1; cool++; }
      }
    }
    sctx.putImageData(img, 0, 0);
    const ctx = p.canvas.getContext('2d');
    ctx.clearRect(0, 0, p.canvas.width, p.canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.filter = `blur(${Math.round(CELL_PX * 0.8)}px)`;
    ctx.drawImage(p.small, 0, 0, p.canvas.width, p.canvas.height);
    ctx.filter = 'none';
    p.warm = warm; p.cool = cool; p.land = land;
    p.meanE = land ? sumE / land : 0;
    // the patch as a whole: the majority of its cells, as the map shows it
    const need = land * MAJOR_SHARE;
    p.kind = warm >= cool * MAJOR && warm >= need && warm > 0 ? 'warm'
      : cool >= warm * MAJOR && cool >= need && cool > 0 ? 'cool' : 'mixed';
    // the stake's own spot (for checks only), then the patch's reading
    celsiusAt(l.x, l.z, hours, scratch, l.id);
    p.own = kindOf(scratch.exposure);
    p.celsius = patchCelsius(p, l, hours);
    return p;
  }

  // A patch's reading (degrees C, to 0.1) at a clock hour: the day's air, the patch's mean
  // sun at the sun's height now, some of the stake's own canopy and water cooling, a
  // nudge by its kind and a small wobble, then held inside its kind's band round the
  // middle for the hour (warm over it, cool under it, mixed close to it), so the number
  // never contradicts the colour. A reading the band holds is set a little way inside
  // its edge (steady for a quarter hour), so the shady loggers never all read the same.
  const KIND_NUDGE = { warm: 0.2, mixed: 0, cool: -0.2 };
  function patchCelsius(p, l, hours) {
    const C = RULES.climate, T = game.data && game.data.terrain;
    const base = baseCelsius(hours);
    const S = C.sun * Math.pow(Math.max(0, sunNow().y), 0.8);
    const local = T ? C.shade * smooth(2, 12, T.canopyAt(l.x, l.z)) + C.water * (1 - smooth(0, 6, waterDistance(T, l.x, l.z))) : 0;
    const quarter = Math.floor(hours * 4);
    const wob = (hash(l.id, quarter) - 0.5) * 2 * C.wobble;
    const jit = hash(l.id, quarter + 97); // 0..1
    const raw = base + S * p.meanE + 0.4 * local + wob + (KIND_NUDGE[p.kind] || 0);
    const mid = base + S * (THERMAL.sunny + THERMAL.shady) / 2 + 0.2 * (C.shade + C.water);
    const band = Math.max(0.35, S * 0.13), inner = band * 0.6;
    let c = raw;
    if (p.kind === 'warm') c = Math.max(raw, mid + band + 0.4 * jit);
    else if (p.kind === 'cool') c = Math.min(raw, mid - band - 0.4 * jit);
    else if (raw > mid + inner) c = mid + inner * (1 - 0.5 * jit);
    else if (raw < mid - inner) c = mid - inner * (1 - 0.5 * jit);
    return Math.round(c * 10) / 10;
  }

  // 'warm', 'cool' or 'mild' at (x, z) from the freshest patch covering it (fresher
  // than minFresh), or null
  function patchAt(x, z, minFresh = 0.05) {
    let best = null, bf = minFresh;
    for (let i = 0; i < patches.length; i++) {
      const p = patches[i];
      const f = freshness(p);
      if (f <= bf) continue;
      const ci = Math.round((x - p.x) / p.cell + (p.n - 1) / 2), cj = Math.round((z - p.z) / p.cell + (p.n - 1) / 2);
      if (ci < 0 || cj < 0 || ci >= p.n || cj >= p.n) continue;
      if (Math.hypot(x - p.x, z - p.z) > PATCH_R) continue;
      const c = p.cls[cj * p.n + ci];
      bf = f;
      best = c > 0 ? 'warm' : c < 0 ? 'cool' : 'mild';
    }
    return best;
  }

  // the sun rule's phase for the words: the story's (held steady), else the lizards'
  const phaseNow = () => (game.story && game.story.sunPhase) || (game.lizards && game.lizards.thermalPhase ? game.lizards.thermalPhase() : 'morning');
  let saidDay = -1; // James's word on the map, once a day
  const L_SCRIPT = () => (SCRIPT.survey && SCRIPT.survey.loggers) || {};
  // the colour that matters in each phase of the sun rule: warm while it is cool (the
  // lizards bask and show off there), cool in the heat (where they sit it out)
  const wantOf = (ph) => (ph === 'midday' ? 'cool' : 'warm');
  // a line for the phase and the patch's kind: SCRIPT's entry may be one line or one per kind
  const lineFor = (pool, kind) => (typeof pool === 'string' ? pool : pool ? pool[kind] || pool.mixed || null : null);
  // the patch word (walking into a fresh patch of the colour that matters now), once a
  // day for each phase: the day key it was last said on
  const saidWord = { morning: -1, midday: -1, afternoon: -1 };
  let nowS = 0, lastDlS = -1e9; // seconds (update's clock), and at the last download

  function download(l) {
    if (!l || !Number.isFinite(l.x)) return null;
    const hours = state.clock.hours;
    const first = !lastDl.has(l.id) || lastDl.get(l.id).dk !== dayKey();
    lastDl.set(l.id, { dk: dayKey(), hours });
    const p = computePatch(l, hours);
    const value = p.celsius;
    const reading = { hours: Math.round(hours * 100) / 100, celsius: value, day: state.days + 1, kind: p.kind };
    Object.defineProperty(reading, 'dk', { value: dayKey(), enumerable: false }); // not saved
    l.readings.push(reading);
    if (l.readings.length > 48) l.readings.splice(0, l.readings.length - 48);
    // the first download of each logger today is worth the full points, a fresh one later a little
    addScore(first ? RULES.points.loggerRead : Math.round(RULES.points.loggerRead / 3), 'logger');
    events.emit('logger:read', { id: l.id, celsius: value, hours, kind: p.kind, auto: true });
    const slot = slotOf.get(l.id);
    if (slot != null) flashT[slot] = 2.4;
    if (game.fx && game.fx.burst) game.fx.burst('sparkle', l.x - 0.09, l.y + 0.5, l.z, 5);
    const S = L_SCRIPT();
    const words = (S.kind && S.kind[p.kind]) || '';
    kit.toast(say(S.toast || 'Logger *{id}* downloaded: {celsius} °C. {words}', { id: l.id, celsius: value.toFixed(1), words }).trim(), { icon: 'thermometer', tone: 'info', ms: 3000 });
    lastDlS = nowS;
    // James's word on what the colours mean, with the first download of the day, by the
    // sun's phase and this patch's colour (a cool patch first thing points at the warm ones)
    if (saidDay !== dayKey() && S.first) {
      saidDay = dayKey();
      const ph = phaseNow();
      const line = lineFor(S.first[ph] || S.first.morning, p.kind);
      // he has just said what this colour means now: no patch word for it later
      if (p.kind === wantOf(ph) && ph in saidWord) saidWord[ph] = dayKey();
      if (line) setTimeout(() => { if (state.phase === 'survey') kit.toast(`James: ${say(line, { name: state.playerName || '' })}`, { icon: 'thermometer', tone: 'gold', ms: 5200 }); }, 1400);
    }
    return p;
  }

  // Walking into a fresh patch of the colour that matters now (warm in the cool hours,
  // cool in the heat): a short word on what it means for the lizards, where the player
  // is looking for them, once a day for each phase.
  function checkPatchWord() {
    if (!patches.length || nowS - lastDlS < PATCH_WORD_GAP) return;
    const ph = phaseNow();
    if (!(ph in saidWord) || saidWord[ph] === dayKey()) return;
    const P = player.position;
    if (patchAt(P.x, P.z, 0.5) !== wantOf(ph)) return;
    saidWord[ph] = dayKey();
    const S = L_SCRIPT();
    const line = S.enter && S.enter[ph];
    if (line) kit.toast(say(line, { name: state.playerName || '' }), { icon: 'thermometer', tone: 'info', ms: 4600 });
  }

  const isToday = (r) => !!r && r.dk === dayKey();

  // walking by: the nearest due logger within DOWNLOAD_R, ten times a second
  let checkT = 0, allDone = !ALL_AT_START;
  const canDownload = () => state.phase === 'survey' && !(game.story && game.story.cutscene) && !kit.busy() &&
    !(game.catching && game.catching.busy) && !(player.held);
  function checkNearby() {
    if (!canDownload()) return;
    const P = player.position;
    let best = null, bd = DOWNLOAD_R;
    for (let i = 0; i < state.loggers.length; i++) {
      const l = state.loggers[i];
      if (!Number.isFinite(l.x)) continue;
      const d = Math.hypot(l.x - P.x, l.z - P.z);
      if (d < bd && due(l)) { bd = d; best = l; }
    }
    if (best) download(best);
    else checkPatchWord();
  }

  // a new day: yesterday's patches go (their readings stay in the notebook)
  events.on('day:new', () => { saidDay = -1; });
  events.on('state:reset', () => { lastDl.clear(); for (const p of patches) p.dk = 0; ensureAll(); });

  ensureAll();

  return {
    group,
    update(dt, t) {
      uTime.value = t;
      nowS += dt;
      let dirty = false;
      for (let i = 0; i < mesh.count; i++) {
        if (flashT[i] <= 0 && flash.array[i] === 0) continue;
        flashT[i] = Math.max(0, flashT[i] - dt);
        flash.array[i] = flashT[i] > 0 ? Math.min(1, flashT[i]) : 0;
        dirty = true;
      }
      if (dirty) flash.needsUpdate = true;
      checkT -= dt;
      if (checkT <= 0) {
        checkT = 0.1;
        if (!allDone && state.phase === 'survey' && state.clock.running) { allDone = true; for (const l of state.loggers) download(l); }
        checkNearby();
      }
    },
    deploy, deployAll, restore, due, celsius, celsiusAt, download,
    read: download, // the old name
    targets,
    patches, freshness, patchAt, isToday,
    // nothing to lay out any more: kept for callers from the old set-up day
    showTargets() {},
    targetsLeft: () => [],
    get stats() { return { loggers: mesh.count, patches: patches.length, drawCalls: mesh.count ? 1 : 0 }; },
  };
}
