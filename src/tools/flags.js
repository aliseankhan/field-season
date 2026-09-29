// Grid flags: the survey's stakes drawn in the world, and the labelled flags standing
// on a dozen of them from the start of the game. They are landmarks: the minimap and
// the big map show them, every catch is noted in the notebook by its nearest flag
// ("by C07"), and James's requests may name one ("a brown anole near D05"). Two
// instanced meshes: stakes, and flags (the label printed on the cloth from one atlas
// texture, the cloth waving in the vertex shader).
//
//   build(game) -> { group, update, placeAll(), restore(), clearAll(), targets,
//                    nearestFlag(x, z) -> stake | null, nearFlag(stake, x, z),
//                    log (the catch log), whereOf(lizard), requestPick(rng),
//                    patchWords, place(id), showTargets(), targetsLeft(), nearestTarget() }
//   The catch log: { sp, sex, flag, hours, day, display, perch, tracked, patch } per
//   catch (newest last, at most LOG_MAX), saved under a key of its own (never a
//   position: the flag's label is all it keeps of where), cleared for a new season.
//   patch is the loggers' fresh patch round its perch ('bask', 'warm', 'cool' or null),
//   shown on the perch card's Where line and the grid page (PATCH_WORDS).
//   events: flag:placed { id, x, y, z, quality } only from place() (a scripted test);
//   the flags standing from the start are put up quietly.

import * as THREE from 'three';
import { events } from '../core/events.js';
import { state, GAME_FLAGS, speciesKey } from '../game/state.js';
import { loadStakes } from './stakes.js';
import { getMarkers } from './markers.js';
import { toonGradient } from '../player/avatar.js';
import { setCatchPlace } from '../catch/release.js';

const ATLAS_COLS = 4, ATLAS_ROWS = 4; // 16 labels
const FLAG_COLOUR = '#ff9ec4';
const POP_TIME = 0.7;
export const NEAR_FLAG = 8; // metres: "near D05" in James's requests
const LOG_KEY = 'stroudlab.fieldseason.catchlog.v1';
const LOG_MAX = 80;

// ---------------------------------------------------------------- geometry

function stakeGeometry() {
  const wood = new THREE.Color('#d9b27a'), cap = new THREE.Color('#ff8a3d');
  const post = new THREE.BoxGeometry(0.05, 0.34, 0.05).toNonIndexed();
  post.translate(0, 0.15, 0);
  const tip = new THREE.ConeGeometry(0.036, 0.06, 4, 1).toNonIndexed();
  tip.rotateY(Math.PI / 4);
  tip.translate(0, 0.35, 0);
  const band = new THREE.BoxGeometry(0.056, 0.05, 0.056).toNonIndexed();
  band.translate(0, 0.29, 0);
  const parts = [[post, wood], [band, cap], [tip, cap]];
  return merge(parts);
}

function flagGeometry() {
  const pole = new THREE.CylinderGeometry(0.011, 0.011, 1.1, 6, 1).toNonIndexed();
  pole.translate(0.07, 0.45, 0);
  const knob = new THREE.IcosahedronGeometry(0.024, 0); // already non-indexed
  knob.translate(0.07, 1.01, 0);
  const cloth = new THREE.PlaneGeometry(0.4, 0.26, 8, 2).toNonIndexed();
  cloth.translate(0.07 + 0.2 + 0.006, 0.86, 0);
  const g = merge([
    [pole, new THREE.Color('#f4efe2')],
    [knob, new THREE.Color(FLAG_COLOUR)],
    [cloth, new THREE.Color(FLAG_COLOUR), true],
  ]);
  return g;
}

// Merges non-indexed parts: [geometry, colour, isCloth]; keeps uv only for the cloth.
function merge(parts) {
  let n = 0;
  for (const [g] of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2), cloth = new Float32Array(n);
  let o = 0;
  for (const [g, c, isCloth] of parts) {
    g.computeVertexNormals();
    const cnt = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    for (let k = 0; k < cnt; k++) { col[(o + k) * 3] = c.r; col[(o + k) * 3 + 1] = c.g; col[(o + k) * 3 + 2] = c.b; }
    if (isCloth && g.attributes.uv) {
      uv.set(g.attributes.uv.array, o * 2);
      cloth.fill(1, o, o + cnt);
    }
    o += cnt;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('aCloth', new THREE.BufferAttribute(cloth, 1));
  geo.computeBoundingSphere();
  return geo;
}

// One canvas of labels: pink cloth, a white tag, the stake's name.
function labelAtlas(labels) {
  const cw = 256, ch = 160;
  const cv = document.createElement('canvas');
  cv.width = cw * ATLAS_COLS;
  cv.height = ch * ATLAS_ROWS;
  const g = cv.getContext('2d');
  g.fillStyle = FLAG_COLOUR;
  g.fillRect(0, 0, cv.width, cv.height);
  labels.forEach((text, i) => {
    const x = (i % ATLAS_COLS) * cw, y = Math.floor(i / ATLAS_COLS) * ch;
    // a darker hem at the pole side and the bottom
    g.fillStyle = '#f07fae';
    g.fillRect(x, y, 16, ch);
    g.fillRect(x, y + ch - 10, cw, 10);
    const r = 26, bx = x + 34, by = y + 22, bw = cw - 58, bh = ch - 52;
    g.fillStyle = '#fffaf2';
    g.beginPath();
    g.moveTo(bx + r, by); g.lineTo(bx + bw - r, by); g.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
    g.lineTo(bx + bw, by + bh - r); g.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
    g.lineTo(bx + r, by + bh); g.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
    g.lineTo(bx, by + r); g.quadraticCurveTo(bx, by, bx + r, by);
    g.fill();
    g.fillStyle = '#4a3e2c';
    g.font = '800 70px ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, bx + bw / 2, by + bh / 2 + 3);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function flagMaterial(atlas, uTime) {
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient(), side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uAtlas = { value: atlas };
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aCloth;
        attribute float aCell;
        uniform float uTime;
        varying float vCloth;
        varying vec2 vLocal;
        varying vec2 vCellOrigin;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vCloth = aCloth;
        vLocal = uv;
        vCellOrigin = vec2(mod(aCell, ${ATLAS_COLS}.0), floor(aCell / ${ATLAS_COLS}.0));
        if (aCloth > 0.5) {
          float seed = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 0.9;
          float along = uv.x;
          transformed.z += sin(uTime * 4.2 + along * 7.0 + seed) * 0.035 * along;
          transformed.y += sin(uTime * 3.1 + along * 5.0 + seed) * 0.01 * along;
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uAtlas;
        varying float vCloth;
        varying vec2 vLocal;
        varying vec2 vCellOrigin;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vCloth > 0.5) {
          vec2 lu = vec2(gl_FrontFacing ? vLocal.x : 1.0 - vLocal.x, vLocal.y);
          vec2 auv = vec2((vCellOrigin.x + lu.x) / ${ATLAS_COLS}.0, 1.0 - (vCellOrigin.y + 1.0 - lu.y) / ${ATLAS_ROWS}.0);
          diffuseColor.rgb = texture2D(uAtlas, auv).rgb;
        }`);
  };
  mat.customProgramCacheKey = () => 'grid-flags-1';
  return mat;
}

// ---------------------------------------------------------------- the catch log's storage

function logStore() {
  if (GAME_FLAGS.nosave) return null;
  try { return window.localStorage; } catch (e) { return null; }
}
const SEXES = ['m', 'f'];
const PATCHES = ['warm', 'cool', 'bask']; // the loggers' patch a catch sat in (bask: basking in a warm one)
function cleanEntry(e) {
  if (!e || typeof e !== 'object' || typeof e.sp !== 'string' || typeof e.flag !== 'string' || e.flag.length > 4) return null;
  return {
    sp: e.sp.slice(0, 12), sex: SEXES.includes(e.sex) ? e.sex : null, flag: e.flag,
    hours: Number.isFinite(e.hours) ? e.hours : 0, day: Number.isInteger(e.day) && e.day > 0 ? e.day : 1,
    display: typeof e.display === 'string' ? e.display.slice(0, 10) : null,
    perch: typeof e.perch === 'string' ? e.perch.slice(0, 12) : null,
    tracked: typeof e.tracked === 'string' ? e.tracked.slice(0, 12) : null,
    patch: PATCHES.includes(e.patch) ? e.patch : null,
  };
}

// the patch a catch sat in, in words (the perch card's Where and the grid page's rows)
export const PATCH_WORDS = { bask: 'basking in a warm patch', warm: 'in a warm patch', cool: 'in a cool patch' };

// ---------------------------------------------------------------- the system

export async function build(game) {
  const { scene, player } = game;
  const stakes = await loadStakes(game);
  const group = new THREE.Group();
  group.name = 'grid-flags';
  // the game's pulsing job markers (src/tools/markers.js) keep their time here
  const markers = getMarkers(scene);

  // every stake on dry land
  const shown = stakes.list.filter((s) => s.on !== 'water' && s.y > 0.02);
  const stakeMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });
  const stakeMesh = new THREE.InstancedMesh(stakeGeometry(), stakeMat, shown.length);
  stakeMesh.name = 'stakes';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), xAxis = new THREE.Vector3(1, 0, 0), qt = new THREE.Quaternion();
  shown.forEach((s, i) => {
    q.setFromAxisAngle(up, (s.x * 12.9898 + s.z * 78.233) % 1.2);
    m.compose(p3.set(s.x, s.y - 0.02, s.z), q, s3.set(1, 1, 1));
    stakeMesh.setMatrixAt(i, m);
  });
  stakeMesh.instanceMatrix.needsUpdate = true;
  stakeMesh.computeBoundingSphere();
  group.add(stakeMesh);

  // the flags: one on each target stake
  const targets = stakes.targets.flags;
  const cellOf = new Map(targets.map((s, i) => [s.id, i]));
  const uTime = { value: 0 };
  const flagGeo = flagGeometry();
  const MAXF = ATLAS_COLS * ATLAS_ROWS;
  const aCell = new THREE.InstancedBufferAttribute(new Float32Array(MAXF), 1);
  flagGeo.setAttribute('aCell', aCell);
  const flagMesh = new THREE.InstancedMesh(flagGeo, flagMaterial(labelAtlas(targets.map((s) => s.id)), uTime), MAXF);
  flagMesh.name = 'flags';
  flagMesh.count = 0;
  flagMesh.castShadow = true;
  flagMesh.frustumCulled = false;
  group.add(flagMesh);

  const placed = []; // { id, stake, born, heading }
  const isPlaced = (id) => { for (let i = 0; i < state.flags.length; i++) if (state.flags[i].id === id) return true; return false; };

  function writeFlag(i, f, k) {
    // k: 0..1 through the pop (1 = settled)
    let sy = 1, sx = 1, tilt = 0;
    if (k < 1) {
      const e = k * POP_TIME;
      sy = e < 0.25 ? (e / 0.25) * 1.18 : 1 + 0.18 * Math.exp(-(e - 0.25) * 9) * Math.cos((e - 0.25) * 22);
      sx = 1 / Math.sqrt(Math.max(0.3, sy));
      tilt = 0.25 * Math.exp(-e * 6) * Math.sin(e * 30);
    }
    q.setFromAxisAngle(up, f.heading);
    q.multiply(qt.setFromAxisAngle(xAxis, tilt));
    m.compose(p3.set(f.stake.x, f.stake.y - 0.05, f.stake.z), q, s3.set(sx, Math.max(0.01, sy), sx));
    flagMesh.setMatrixAt(i, m);
  }

  // Draws a flag on stake id (animate pops it up); state.flags gets it too. Returns false
  // when it is already there. Only place() tells anyone (flag:placed): the flags that
  // stand from the start go up quietly.
  function show(id, { animate = false, quality = 1, tell = false } = {}) {
    const stake = stakes.byId.get(id);
    if (!stake || !cellOf.has(id) || placed.some((f) => f.id === id) || placed.length >= MAXF) return false;
    const f = { id, stake, born: animate ? 0 : POP_TIME, heading: -0.9 + ((stake.x * 3.1 + stake.z * 1.7) % 0.6) };
    const i = placed.length;
    placed.push(f);
    aCell.setX(i, cellOf.get(id));
    aCell.needsUpdate = true;
    flagMesh.count = placed.length;
    writeFlag(i, f, animate ? 0 : 1);
    flagMesh.instanceMatrix.needsUpdate = true;
    if (!isPlaced(id)) {
      state.flags.push({ id, x: stake.x, y: stake.y, z: stake.z });
      if (tell) events.emit('flag:placed', { id, x: stake.x, y: stake.y, z: stake.z, quality });
    }
    return true;
  }
  const place = (id, { animate = true, quality = 1 } = {}) => show(id, { animate, quality, tell: true });

  // Every flag up, and state.flags holding them all with their positions (a save's ids,
  // or a new season's empty list, alike).
  function ensureAll() {
    for (const f of state.flags) {
      const s = stakes.byId.get(f.id);
      if (s) { f.x = s.x; f.y = s.y; f.z = s.z; }
    }
    for (const s of targets) {
      if (!placed.some((p) => p.id === s.id)) show(s.id);
      else if (!isPlaced(s.id)) state.flags.push({ id: s.id, x: s.x, y: s.y, z: s.z });
    }
    state.inventory.flags = 0;
    const av = player.avatar;
    if (av && av.setStowed) av.setStowed({ flags: false });
  }
  const restore = () => ensureAll();
  const placeAll = () => ensureAll();

  // ---- landmarks: the nearest flag, and "near D05"
  function nearestFlag(x, z) {
    let best = null, bd = Infinity;
    for (let i = 0; i < targets.length; i++) {
      const s = targets[i];
      const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
  const nearFlag = (stake, x, z, r = NEAR_FLAG) => !!stake && Math.hypot(stake.x - x, stake.z - z) <= r;
  const homeOf = (lz) => (lz ? lz.home || lz.pos || null : null);
  // the loggers' patch round a lizard's perch while it is fresh: 'bask' (basking in a
  // warm patch), 'warm', 'cool' or null (a mild spot, no fresh patch, or not the survey)
  function patchOf(lz) {
    const lg = game.tools && game.tools.loggers, h = homeOf(lz);
    const k = state.phase === 'survey' && lg && lg.patchAt && h ? lg.patchAt(h.x, h.z, 0.15) : null;
    if (k === 'warm') return lz.mood && lz.mood.bask ? 'bask' : 'warm';
    return k === 'cool' ? 'cool' : null;
  }
  // "C07" for a lizard: the flag nearest its perch
  function whereOf(lz) {
    const h = homeOf(lz);
    const s = h ? nearestFlag(h.x, h.z) : null;
    return s ? s.id : null;
  }

  // ---- the catch log
  const log = [];
  const store = logStore();
  try {
    const raw = store ? JSON.parse(store.getItem(LOG_KEY) || 'null') : null;
    if (raw && raw.v === 1 && Array.isArray(raw.log)) for (const e of raw.log.slice(-LOG_MAX)) { const c = cleanEntry(e); if (c) log.push(c); }
  } catch (e) { /* a fresh log */ }
  function saveLog() {
    if (!store) return;
    try { store.setItem(LOG_KEY, JSON.stringify({ v: 1, log })); } catch (e) { /* full or blocked */ }
  }
  const entryOf = new WeakMap(); // lizard -> its log entry from today's catch (this session)
  let inHand = null; // the lizard whose release cards are open (for the perch card's "Where")
  events.on('lizard:recaptured', (e) => { inHand = (e && e.lizard) || null; });
  events.on('lizard:released', () => { inHand = null; });
  events.on('practice:done', () => { inHand = null; });
  events.on('lizard:caught', (e) => {
    const lz = e && e.lizard;
    inHand = lz || null;
    const flag = whereOf(lz);
    if (!lz || !flag) return;
    const entry = {
      sp: speciesKey(lz.species), sex: SEXES.includes(lz.sex) ? lz.sex : null, flag,
      hours: Math.round(state.clock.hours * 100) / 100, day: (state.days || 0) + 1,
      display: (e.bonus && e.bonus.display) || null, perch: e.perch || lz.perch || null, tracked: null,
      patch: patchOf(lz),
    };
    log.push(entry);
    if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
    entryOf.set(lz, entry);
    if (lz.tag && typeof lz.tag === 'object') lz.tag.flag = flag;
    saveLog();
  });
  // a backpack fitted: the tracked lizard is noted by its flag too
  events.on('tracked:add', (t) => {
    if (!t || !t.lizard) return;
    t.flag = whereOf(t.lizard);
    const entry = entryOf.get(t.lizard);
    if (entry) { entry.tracked = t.id; saveLog(); }
  });
  // the flag a tracked lizard was caught by (the log keeps it across sessions)
  function flagOfTracked(t) {
    if (!t) return null;
    if (t.flag) return t.flag;
    for (let i = log.length - 1; i >= 0; i--) if (log[i].tracked === t.id && log[i].sp === t.species) return log[i].flag;
    return null;
  }
  function clearLog() {
    log.length = 0;
    if (store) { try { store.removeItem(LOG_KEY); } catch (e) { /* blocked */ } }
  }
  events.on('state:reset', () => { clearLog(); ensureAll(); });
  // a blank island for a new season: the flags stay up, the log starts again
  function clearAll() { clearLog(); ensureAll(); }

  // The perch card's "Where": the flag nearest the lizard in hand (a practice catch's too),
  // and the loggers' patch its perch was in while that patch is fresh ("by B09, basking
  // in a warm patch"), so the map's colours show up where the player acts.
  setCatchPlace(() => {
    const C = game.catching;
    const lz = inHand || (C && C.practice && C.practice.lizard) || (C && C.loopPole ? C.loopPole.hold : null);
    const flag = whereOf(lz);
    if (!flag) return null;
    const e = inHand && entryOf.get(inHand);
    const patch = e ? e.patch : patchOf(lz);
    return patch ? `by ${flag}, ${PATCH_WORDS[patch]}` : `by ${flag}`;
  });

  // ---- James's requests: a species with a few perches near a flag ("a brown anole
  // near D05"), picked for the day from the spawns round each flag (only counts leave
  // here, never a position)
  const SP_WORD = { cristatellus: 'crested anole', sagrei: 'brown anole', carolinensis: 'green anole' };
  const MIN_NEAR = { cristatellus: 6, sagrei: 3, carolinensis: 3 };
  let pairs = null;
  function requestPairs() {
    if (pairs) return pairs;
    pairs = [];
    const list = (game.data && game.data.spawns && game.data.spawns.spawns) || [];
    for (const s of targets) {
      const n = {};
      for (const sp of list) {
        if (!SP_WORD[sp.sp]) continue;
        if (Math.hypot(sp.x - s.x, sp.z - s.z) <= NEAR_FLAG - 1) n[sp.sp] = (n[sp.sp] || 0) + 1;
      }
      for (const sp in SP_WORD) if ((n[sp] || 0) >= MIN_NEAR[sp]) pairs.push({ flag: s.id, sp, key: speciesKey(sp), word: SP_WORD[sp], n: n[sp] });
    }
    return pairs;
  }
  // -> { flag, key, word } or null
  function requestPick(rng = Math.random) {
    const P = requestPairs();
    if (!P.length) return null;
    // brown and green anoles a little more often than the everywhere crested ones
    let sum = 0;
    for (const p of P) sum += p.sp === 'cristatellus' ? 1 : 1.6;
    let r = rng() * sum;
    for (const p of P) { r -= p.sp === 'cristatellus' ? 1 : 1.6; if (r <= 0) return p; }
    return P[P.length - 1];
  }

  ensureAll();

  return {
    group,
    update(dt, t) {
      uTime.value = t;
      markers.update(t);
      let dirty = false;
      for (let i = 0; i < placed.length; i++) {
        const f = placed[i];
        if (f.born >= POP_TIME) continue;
        f.born = Math.min(POP_TIME, f.born + dt);
        writeFlag(i, f, f.born / POP_TIME);
        dirty = true;
      }
      if (dirty) flagMesh.instanceMatrix.needsUpdate = true;
    },
    place, placeAll, restore, clearAll,
    targets,
    nearestFlag, nearFlag, whereOf, flagOfTracked, requestPick,
    log, patchWords: PATCH_WORDS,
    // nothing to lay out any more: kept for callers from the old set-up day
    showTargets() {},
    targetsLeft: () => [],
    nearestTarget: () => null,
    get stats() { return { stakes: shown.length, flags: placed.length, log: log.length, drawCalls: 2 + (markers.count ? 1 : 0) }; },
  };
}
