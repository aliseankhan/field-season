// Places the island's vegetation from placements.json, colliders.json, spawns.json
// and palette.json, drawn as a cosy storybook island rather than a survey map.
//
//   const veg = buildVegetation({ data, renderer });
//   scene.add(veg.group);
//   veg.update(dt, t, { cameraPosition, focus });   // focus: the player's head, or null
//
// The survey is the skeleton: every landmark, survey plant and lizard host stands where
// the data puts it. The small filler is thinned and merged on the render side:
// - bushes, ground shrubs and survey shrubs on open ground are clustered into a few
//   big soft mounds (or single plump domes); thicket masses become big mounds that
//   follow the thicket outline;
// - the mangrove fringe keeps a crown every few metres along open water and the paths,
//   with the interior merged into wide flat crowns;
// - canopy puffs inside a landmark crown or over open ground are folded into the
//   landmark or dropped;
// - no mound buries a lizard: puffs are lowered or narrowed round them.
// Landmarks, palms, mounds and perches are merged into one wood and one leaf mesh; every
// repeated model is one InstancedMesh per model and material. Anything solid-looking
// that reaches ground the player can stand on comes back as veg.colliders, and bare
// blocked edges get a low hedge, so there are no invisible walls.

import * as THREE from 'three';
import {
  MeshBuilder, makeUnitGeometry, makeRng, hashSeed, lin, tint, mix3, clamp, blob, tube,
  buildBroadleaf, buildEucalyptus, buildPalm, buildTalipot, buildOspreyPole, buildBamboo,
  buildPerchFrond, buildPerchFan, buildStub, buildLimb, moundPuff,
} from './models.js';
import { applyVegShader, makeToonGradient, setVegFrame, TOON_LEAF, TOON_WOOD } from './wind.js';
import {
  BIT, PointHash, distanceField, components, cluster, thin, packCells, fitPuffsToLizards, puffQ, puffRadiusAt, puffSink,
} from './veg_layout.js';
import { CONFIG } from '../config.js';

export const VEG = {
  crownScale: 0.87, // landmark crown widths are about 25 % too big in plan (not palms)
  cutRadius: 1.5, // camera cut-out capsule radius, m
  headroom: 1.9, // low foliage over walkable ground stays above this
  bodyRadius: 0.2, // the biologist's body in plan, m
  bodyReach: 0.1, // how far the body may reach into a solid-looking bush, m
  bodyLo: 0.25, // the body slab above the ground, m
  bodyHi: 1.45,
};

// Lizard bumps on mounds: horizontal and vertical radius factors.
const BUMP = { a: 1.3, b: 0.85 };

// The garden gate at the south end of the causeway landing (drawn by props.js); the
// edge hedge leaves this span open.
export const GATE = { x0: -12.35, x1: -10.15, z0: 46.3, z1: 47.3 };

// Per-landmark overrides from the data update: T016's height was the broadleaf canopy
// over it.
const LANDMARK_OVERRIDES = { T016: { height: 6.5, frondLo: 5.0 } };

export function createVegMaterials() {
  const leafRamp = makeToonGradient(TOON_LEAF);
  const woodRamp = makeToonGradient(TOON_WOOD);
  const wood = applyVegShader(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: woodRamp }), { flutter: 0 });
  const leaf = applyVegShader(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: leafRamp }), { flutter: 1 });
  wood.name = 'veg-wood';
  leaf.name = 'veg-leaf';
  return { wood, leaf, gradientMap: leafRamp, woodRamp };
}

// ---------------------------------------------------------------- colours

const _c = new THREE.Color();
const _h = { h: 0, s: 0, l: 0 };
function hexHSL(hex) {
  _c.set(hex).getHSL(_h, THREE.SRGBColorSpace);
  return { ..._h };
}
function fromHSL(h, s, l) {
  _c.setHSL(((h % 1) + 1) % 1, clamp(s, 0, 1), clamp(l, 0, 1), THREE.SRGBColorSpace);
  return [_c.r, _c.g, _c.b];
}

// Friendly storybook greens. palette.json sets the relationships (which variant is
// lighter or darker, lawn lighter than canopy); the group's mean moves to a brighter,
// warmer target and each variant keeps most of its offset from that mean.
const TARGET = {
  crown_broadleaf: '#6fc653', crown_palm: '#9ccf4f', crown_mangrove: '#44b267', shrub: '#48b454',
  canopy_puff: '#69c554', understorey: '#62c55c', crown_talipot: '#86c96a', eucalyptus: '#a3d36a',
};

function friendlyGroup(hexes, target, weights) {
  const hs = hexes.map(hexHSL);
  const w = weights ?? hs.map(() => 1 / hs.length);
  const sw = w.reduce((a, b) => a + b, 0);
  const mean = { h: 0, s: 0, l: 0 };
  hs.forEach((c, i) => { mean.h += c.h * w[i] / sw; mean.s += c.s * w[i] / sw; mean.l += c.l * w[i] / sw; });
  const t = hexHSL(target);
  return hs.map((c) => fromHSL(t.h + (c.h - mean.h) * 0.5, t.s + (c.s - mean.s) * 0.5, t.l + (c.l - mean.l) * 0.45));
}

function makePalette(palette, placements) {
  const S = palette.swatches;
  const W = palette.variant_weights ?? {};
  const sets = {};
  for (const key of ['crown_broadleaf', 'crown_palm', 'crown_mangrove', 'shrub', 'canopy_puff', 'understorey']) {
    const v = Array.isArray(S[key]) ? S[key] : [S[key]];
    const w = W[key] ?? v.map(() => 1 / v.length);
    sets[key] = { cols: friendlyGroup(v, TARGET[key], w), cum: w.map((_, i) => w.slice(0, i + 1).reduce((a, b) => a + b, 0)) };
  }
  // landmark tints, moved as a group per kind so their relationships survive
  const tints = palette.landmark_tints ?? {};
  const byKind = {};
  for (const lm of placements.landmarks) {
    const k = lm.kind === 'rainbow_eucalyptus' ? 'eucalyptus' : lm.kind === 'talipot' ? 'crown_talipot' : lm.kind === 'palm' ? 'crown_palm' : 'crown_broadleaf';
    (byKind[k] ??= []).push(lm.id);
  }
  const lmCol = {};
  for (const [k, ids] of Object.entries(byKind)) {
    const hexes = ids.map((id) => tints[id] ?? S.crown_broadleaf[2]);
    friendlyGroup(hexes, TARGET[k]).forEach((c, i) => { lmCol[ids[i]] = c; });
  }
  const field = (x, z) => 0.5 + 0.5 * Math.sin(x * 0.21 + 1.3 * Math.sin(z * 0.17 + 0.5)) * Math.cos(z * 0.19 - 0.6 * Math.sin(x * 0.13));
  const choose = (key, u) => {
    const s = sets[key];
    const v = u * s.cum[s.cum.length - 1];
    let i = 0;
    while (i < s.cum.length - 1 && v > s.cum[i]) i++;
    return s.cols[i];
  };
  return {
    pick: (key, rng, jitter = 0.05) => tint(choose(key, rng()), 1 - jitter + 2 * jitter * rng()),
    pickAt: (key, x, z, rng, jitter = 0.04) => tint(choose(key, rng() < 0.2 ? rng() : field(x, z)), 1 - jitter + 2 * jitter * rng()),
    landmark: (id) => lmCol[id] ?? sets.crown_broadleaf.cols[2],
    bark: lin('#8a6b50'),
    palmBark: lin('#b8a58c'),
    palmRing: lin('#98836a'),
    mangroveBark: lin('#8a5a3c'),
    talipotBark: lin('#b59a78'),
    talipotRing: lin('#8e7457'),
    rainbow: ['#a6e05a', '#34c4b4', '#9b6fd8', '#ff9f45', '#b2475e'].map(lin),
    cream: lin('#f4ead0'),
    pole: lin('#b49a7a'),
    nest: lin(S.nest ?? '#8f6f47'),
    palmLeaf: lin('#9ccf4f'),
    palmRim: lin('#c4e58a'),
    talipotLeaf: lin('#86c96a'),
    talipotRim: lin('#b9e48c'),
    dead: lin('#c9a46a'),
    nipa: lin('#8fcf5a'),
    euc: lin('#a3d36a'),
    hedge: lin('#63bd5e'),
    fern: lin('#6cbf5a'),
  };
}

// ---------------------------------------------------------------- instancing

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _q2 = new THREE.Quaternion();
const _ax = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

class InstanceSets {
  constructor() {
    this.sets = new Map();
  }

  place(key, x, y, z, rotY, sx, sy, sz, col) {
    let s = this.sets.get(key);
    if (!s) this.sets.set(key, (s = { m: [], c: [] }));
    _p.set(x, y, z);
    _q.setFromEuler(_e.set(0, rotY, 0));
    _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
    for (let i = 0; i < 16; i++) s.m.push(_m.elements[i]);
    s.c.push(col[0], col[1], col[2]);
  }

  // A trunk leaning by tilt (radians) towards the heading lean, with its crown carried to
  // the leaning top. Returns the top offset [dx, dz] at height len.
  placeLeaning(key, x, y, z, rotY, lean, tilt, sx, sy, sz, col) {
    let s = this.sets.get(key);
    if (!s) this.sets.set(key, (s = { m: [], c: [] }));
    _p.set(x, y, z);
    _ax.set(Math.cos(lean), 0, -Math.sin(lean)).cross(_up).normalize();
    _q.setFromAxisAngle(_ax, -tilt);
    _q2.setFromEuler(_e.set(0, rotY, 0));
    _q.multiply(_q2);
    _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
    for (let i = 0; i < 16; i++) s.m.push(_m.elements[i]);
    s.c.push(col[0], col[1], col[2]);
    return [Math.cos(lean) * Math.sin(tilt) * sy, -Math.sin(lean) * Math.sin(tilt) * sy];
  }

  meshes(mats) {
    const out = [];
    for (const [key, s] of this.sets) {
      const { geometry, mat } = makeUnitGeometry(key);
      const n = s.c.length / 3;
      const mesh = new THREE.InstancedMesh(geometry, mats[mat], n);
      mesh.instanceMatrix.array.set(s.m);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(s.c), 3);
      mesh.computeBoundingSphere();
      mesh.name = `veg-${key}`;
      out.push(mesh);
    }
    return out;
  }
}

// ---------------------------------------------------------------- ground

// Grid helpers: distances to open water and to walkable ground, standable ground (the
// player's centre, clear of the data circles), a coverage raster of what is drawn at
// body height, and connectivity from the start.
function makeGround(T, circles) {
  const { cols, rows, cell, x0, z0, mask } = T;
  const n = cols * rows;
  const openWater = new Uint8Array(n), notOpen = new Uint8Array(n), notWalk = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const m = mask[i];
    const open = (m & BIT.water) && !(m & BIT.fringe);
    openWater[i] = open ? 1 : 0;
    notOpen[i] = open ? 0 : 1;
    notWalk[i] = m & BIT.walkable ? 0 : 1;
  }
  const dOpen = distanceField(notOpen, cols, rows);
  const dWalk = distanceField(notWalk, cols, rows);
  const idx = (x, z) => T.cellIndex(x, z);
  const at = (arr, x, z) => { const i = idx(x, z); return i < 0 ? 1e9 : arr[i] * cell; };
  const P = CONFIG.player;
  const stand = standRaster(T, circles, false);
  const margin = P.gridRadius - cell / 2;
  // distance from (x, z) to the nearest spot the player's centre can reach, or null
  const near = (x, z, maxR, ok = stand) => {
    const c0 = Math.round((x - x0) / cell), r0 = Math.round((z - z0) / cell);
    const R = Math.ceil(maxR / cell) + 1;
    let best = Infinity;
    for (let dr = -R; dr <= R; dr++) {
      for (let dc = -R; dc <= R; dc++) {
        const rr = r0 + dr, cc = c0 + dc;
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols || !ok[rr * cols + cc]) continue;
        const d = Math.hypot(x0 + cc * cell - x, z0 + rr * cell - z);
        if (d < best) best = d;
      }
    }
    return best > maxR ? null : Math.max(0, best + margin);
  };
  const cov = new Uint8Array(n);
  const markDisc = (x, z, r) => {
    if (!(r > 0)) return;
    const c0 = Math.max(0, Math.floor((x - r - x0) / cell)), c1 = Math.min(cols - 1, Math.ceil((x + r - x0) / cell));
    const r0 = Math.max(0, Math.floor((z - r - z0) / cell)), r1 = Math.min(rows - 1, Math.ceil((z + r - z0) / cell));
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        if (Math.hypot(x0 + cc * cell - x, z0 + rr * cell - z) <= r) cov[rr * cols + cc] = 1;
      }
    }
  };
  return {
    dOpen: (x, z) => at(dOpen, x, z),
    dWalk: (x, z) => at(dWalk, x, z),
    walkable: (x, z) => T.isWalkable(x, z),
    maskAt: (x, z) => T.maskAt(x, z),
    stand, near, cov, markDisc,
  };
}

// Cells where the player's centre can stand: walkable cells clear of every circle by
// the player's radius. strict also asks for all eight neighbours to be walkable, as the
// controller keeps a margin from blocked cells; the connectivity check uses that.
function standRaster(terrain, circles, strict = false) {
  const { cols, rows, cell, x0, z0, mask } = terrain;
  const P = CONFIG.player;
  const ok = new Uint8Array(cols * rows);
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const i = r * cols + c;
      if (!(mask[i] & BIT.walkable)) continue;
      if (strict) {
        let all = BIT.walkable;
        for (const j of [i - cols - 1, i - cols, i - cols + 1, i - 1, i + 1, i + cols - 1, i + cols, i + cols + 1]) all &= mask[j];
        if (!all) continue;
      }
      ok[i] = 1;
    }
  }
  for (const [x, z, r] of circles) {
    const R = r + P.radius;
    const c0 = Math.max(0, Math.floor((x - R - x0) / cell)), c1 = Math.min(cols - 1, Math.ceil((x + R - x0) / cell));
    const r0 = Math.max(0, Math.floor((z - R - z0) / cell)), r1 = Math.min(rows - 1, Math.ceil((z + R - z0) / cell));
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        if (Math.hypot(x0 + cc * cell - x, z0 + rr * cell - z) < R) ok[rr * cols + cc] = 0;
      }
    }
  }
  return ok;
}

// Standing cells joined to the player's start (4-connected flood fill).
function joinedToStart(terrain, ok) {
  const { cols, cell, x0, z0, start } = terrain;
  const seen = new Uint8Array(ok.length);
  const c = Math.round((start.x - x0) / cell), r = Math.round((start.z - z0) / cell);
  let s = -1, best = Infinity;
  for (let dr = -4; dr <= 4; dr++) {
    for (let dc = -4; dc <= 4; dc++) {
      const i = (r + dr) * cols + c + dc;
      if (ok[i] && dr * dr + dc * dc < best) { best = dr * dr + dc * dc; s = i; }
    }
  }
  if (s < 0) return seen;
  const stack = [s];
  seen[s] = 1;
  while (stack.length) {
    const i = stack.pop();
    for (const j of [i - 1, i + 1, i - cols, i + cols]) {
      if (j < 0 || j >= ok.length || seen[j] || !ok[j]) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return seen;
}

const pickKey = (rng, keys) => keys[Math.floor(rng() * keys.length) % keys.length];

// ---------------------------------------------------------------- build

export function buildVegetation({ data, renderer } = {}) {
  const t0 = performance.now();
  const { terrain: T, placements, colliders, palette, spawns } = data;
  const pal = makePalette(palette, placements);
  const mats = createVegMaterials();
  const wood = new MeshBuilder();
  const leaf = new MeshBuilder();
  // ?vegsplit=1 keeps each kind of merged leaf in its own mesh, for checking
  const split = typeof location !== 'undefined' && /[?&]vegsplit=1/.test(location.search);
  const leafOf = { landmark: leaf, plant: split ? new MeshBuilder() : leaf, perch: split ? new MeshBuilder() : leaf, mound: split ? new MeshBuilder() : leaf };
  const inst = new InstanceSets();
  const hosts = { trunks: [], crowns: [], branches: [], palms: [], logs: [], mounds: [] };
  const G = makeGround(T, colliders.circles);
  const ground = (x, z) => T.heightAt(x, z);
  const walkable = (x, z) => T.isWalkable(x, z);
  const jit = (c, rng, k = 0.06) => tint(c, 1 - k + 2 * k * rng());
  const types = placements.clumps.types;
  const rows = placements.clumps.rows;
  const st = {
    puffsThicket: 0, puffsLawn: 0, puffsHedge: 0, singles: 0, masses: 0, dropped: {}, fitChanges: 0,
    perchStubs: 0, perchLimbs: 0, perchFronds: 0, perchLeaf: 0, perchSkipped: 0, perchFar: 0, floating: 0, perchTwigs: 0, perchStalks: 0,
    mangroveKept: 0, mangroveMerged: 0, roots: 0, canopyTrees: 0, canopyFolded: 0, ferns: 0,
  };
  const drop = (k) => { st.dropped[k] = (st.dropped[k] ?? 0) + 1; };
  const merge = (owner, h) => {
    for (const k of ['trunks', 'crowns', 'branches', 'palms']) {
      for (const e of h[k]) hosts[k].push({ ...e, owner });
    }
  };

  // ---- lizards
  const lizards = spawns.spawns.map((s, k) => ({
    k, s, x: s.x, y: s.y, z: s.z, ground: s.hag <= 0.01, bark: s.pose === 'bark', hostKey: `${s.host.t}:${s.host.i}`,
  }));
  const onHost = new Map();
  for (const l of lizards) {
    if (!onHost.has(l.hostKey)) onHost.set(l.hostKey, []);
    onHost.get(l.hostKey).push(l);
  }
  const lizHash = new PointHash(1);
  for (const l of lizards) lizHash.add(l.x, l.z, 0, l);
  // the highest lizard a crown must stay above, per host
  const topLizard = (key) => Math.max(-Infinity, ...(onHost.get(key) ?? []).map((l) => l.y));

  const stemsOf = new Map();
  colliders.circles.forEach((c, i) => {
    const o = colliders.owners[i];
    if (!stemsOf.has(o)) stemsOf.set(o, []);
    stemsOf.get(o).push(c);
  });
  // A stem kept straight past its bark lizards, with a root flare below the lowest.
  const stemSpec = (x, z, r, key) => {
    const on = (onHost.get(key) ?? []).filter((l) => Math.hypot(l.x - x, l.z - z) < r + 0.35);
    const ys = on.map((l) => l.y);
    return {
      x, z, r,
      straightTo: ys.length ? Math.max(...ys) + 0.4 : 0,
      flareTop: ys.length ? Math.min(...ys) - 0.1 : undefined,
    };
  };

  const hostOf = new Map(); // "t:i" -> { stems, bark, leaf, palm } for perch props
  const trunkCircles = []; // drawn trunks that may need a collider: [x, z, r]
  const crownBoxes = []; // drawn tree crowns, for the perch test: {cx, cy, cz, rx, ry, rz}

  // ---- landmark crowns in plan, for folding canopy puffs
  const lmInfo = placements.landmarks.map((lm, i) => {
    const o = LANDMARK_OVERRIDES[lm.id] ?? {};
    const k = lm.kind === 'palm' ? 1 : VEG.crownScale;
    return {
      i, lm, o, cx: lm.crown_x, cz: lm.crown_z, rx: (k * lm.crown_w_ew) / 2, rz: (k * lm.crown_w_ns) / 2,
      top: lm.y + (o.height ?? lm.height), extra: [],
      folds: lm.kind === 'broadleaf',
    };
  });

  // ---- canopy puffs: fold, thin or drop (none carries a lizard)
  const bankPuffs = [], otherPuffs = [];
  rows.forEach((row, i) => {
    if (types[row[5]] !== 'canopy_puff') return;
    const [x, y, z, h, w] = row;
    const q = (L) => Math.hypot((x - L.cx) / L.rx, (z - L.cz) / L.rz);
    if (lmInfo.some((L) => q(L) < 1)) { drop('puffInCrown'); return; }
    const m = G.maskAt(x, z);
    if (m & BIT.walkable) {
      let best = null, bq = 1.2;
      for (const L of lmInfo) if (L.folds && q(L) < bq && L.extra.length < 2) { bq = q(L); best = L; }
      if (best) { best.extra.push({ x, z, top: y + h, w: Math.min(w, 4.5) }); st.canopyFolded++; } else drop('puffOverLawn');
      return;
    }
    (m & BIT.bank ? bankPuffs : otherPuffs).push({ i, x, y, z, h, w });
  });

  // ---- landmarks: bespoke, merged
  lmInfo.forEach((L) => {
    const { lm, i, o } = L;
    const owner = `L${i}`;
    const key = `landmark:${i}`;
    const seed = hashSeed(lm.id);
    const stems = (stemsOf.get(owner) ?? [[lm.x, lm.z, lm.dbh / 2 + 0.15]])
      .map(([x, z, r]) => stemSpec(x, z, Math.max(0.03, r - 0.15), key));
    const yBottom = Math.min(lm.y, ...stems.map((s) => ground(s.x, s.z))) - 0.35;
    const height = o.height ?? lm.height;
    const base = {
      owner, x: lm.x, y: lm.y, z: lm.z, yBottom, stems, height, crownBase: lm.crown_base,
      cx: lm.crown_x, cz: lm.crown_z, rx: L.rx, rz: L.rz, seed, walkable, headroom: VEG.headroom,
    };
    let h;
    let rec = { stems, bark: pal.bark, leaf: pal.landmark(lm.id) };
    const lc = pal.landmark(lm.id);
    if (lm.kind === 'rainbow_eucalyptus') {
      h = buildEucalyptus(wood, leaf, { ...base, leaf: mix3(pal.euc, lc, 0.3), bands: pal.rainbow, cream: pal.cream });
      rec.bark = pal.rainbow[0];
    } else if (lm.kind === 'talipot') {
      const leafC = mix3(pal.talipotLeaf, lc, 0.3);
      h = buildTalipot(wood, leaf, {
        ...base, r: stems[0].r, bark: pal.talipotBark, ring: pal.talipotRing, leaf: leafC, rim: pal.talipotRim,
      });
      rec = { stems, bark: pal.talipotBark, palm: { T: h.attach, fan: true, fanR: h.fanR * 0.8, leaf: leafC, rim: pal.talipotRim } };
    } else if (lm.kind === 'palm') {
      // the survey names the palm: Attalea is a feather palm, Sabal and unnamed ones fan palms
      const style = /attalea/i.test(lm.sci ?? '') ? 'feather' : 'fan';
      const leafC = mix3(pal.palmLeaf, lc, 0.3);
      const rng = makeRng(seed + 1);
      const a = rng() * Math.PI * 2, b = 0.3 + 0.3 * rng();
      h = buildPalm(wood, leaf, {
        ...base, r: stems[0].r, crownR: (lm.crown_w_ew + lm.crown_w_ns) / 4, frondLo: o.frondLo ?? lm.crown_base, style,
        sBend: [Math.cos(a) * b, Math.sin(a) * b], bend: [Math.cos(a) * b * 0.3, Math.sin(a) * b * 0.3],
        straightTo: stems[0].straightTo, bark: pal.palmBark, ringColor: pal.palmRing, leaf: leafC, rim: pal.palmRim, dead: pal.dead,
      });
      rec = { stems, bark: pal.palmBark, palm: { T: h.attach, fan: style === 'fan', fanR: h.fanR * 0.8, leaf: leafC, rim: pal.palmRim } };
    } else if (lm.kind === 'osprey_pole') {
      h = buildOspreyPole(wood, leaf, {
        ...base, r: stems[0].r, platformY: lm.crown_base, nestR: 1.2 * (VEG.crownScale * (lm.crown_w_ew + lm.crown_w_ns)) / 4,
        pole: pal.pole, nest: pal.nest, birdScale: 1.4,
      });
      rec.bark = pal.pole;
    } else {
      // keep the crown's underside above every lizard under it
      const inCrown = [];
      lizHash.each(L.cx, L.cz, Math.max(L.rx, L.rz) * 1.05, (e) => {
        const l = e.item;
        if (!l.ground && Math.hypot((l.x - L.cx) / L.rx, (l.z - L.cz) / L.rz) < 1.05 && l.y < lm.y + (o.height ?? lm.height) - 2.2) inCrown.push(l);
        return false;
      }, 0);
      const minBottom = inCrown.length ? Math.max(...inCrown.map((l) => l.y)) + 0.2 - lm.y : 0;
      h = buildBroadleaf(wood, leaf, {
        ...base, crownBase: Math.max(lm.crown_base, minBottom - 1.0), leaf: lc, bark: pal.bark, extra: L.extra,
      });
    }
    merge(owner, h);
    if (h.crowns[0] && !rec.palm) rec.fork = h.crowns[0].cy - 0.85 * h.crowns[0].ry;
    hostOf.set(key, rec);
  });

  // ---- survey plants
  const bushMembers = []; // bush-like things that may join mounds
  placements.plants.forEach((p, i) => {
    const owner = `P${i}`;
    const key = `plant:${i}`;
    const seed = hashSeed('P', i);
    const rng = makeRng(seed);
    const gy = ground(p.x, p.z);
    const yb = Math.min(p.y, gy) - 0.3;
    const r = Math.max(0.03, p.dbh / 2);
    if (p.form === 'tree' || p.form === 'mangrove') {
      const mangrove = p.form === 'mangrove';
      const cw = p.crown_w * (mangrove ? 1.15 : 1.05);
      let lo = mangrove ? Math.max(p.height - 0.85 * cw, 0.28 * p.height) : Math.max(0.3 * p.height, p.height - 1.05 * cw);
      lo = Math.max(lo, topLizard(key) + 0.15 - p.y);
      if (G.dWalk(p.x, p.z) < cw / 2 + 0.3 && p.height > 3.2) lo = Math.max(lo, gy + VEG.headroom - p.y);
      lo = Math.min(lo, p.height - 0.9);
      const bark = mangrove ? pal.mangroveBark : pal.bark;
      const yTop = p.y + lo + 0.3 * (p.height - lo);
      inst.place('trunk', p.x, yb, p.z, p.rot, r, yTop - yb, r, jit(bark, rng));
      const ckey = mangrove ? pickKey(rng, ['crownF1', 'crownF2']) : pickKey(rng, ['crownR', 'crownT']);
      const col = pal.pick(mangrove ? 'crown_mangrove' : 'crown_broadleaf', rng);
      inst.place(ckey, p.x, p.y + lo, p.z, p.rot, cw, p.height - lo, cw, col);
      crownBoxes.push({ cx: p.x, cy: p.y + (lo + p.height) / 2, cz: p.z, rx: cw / 2, ry: (p.height - lo) / 2, rz: cw / 2 });
      if (mangrove) placeRoots(p.x, p.z, p.y, Math.min(1.5, 0.28 * p.height + 0.4), Math.min(1.4, Math.max(0.9, 0.35 * cw)), bark, rng);
      hosts.trunks.push({ owner, x: p.x, z: p.z, y0: yb, y1: yb + 0.6 * (yTop - yb), r0: r, r1: r });
      hosts.crowns.push({ owner, cx: p.x, cy: p.y + (lo + p.height) / 2, cz: p.z, rx: cw / 2, ry: (p.height - lo) / 2, rz: cw / 2 });
      hostOf.set(key, { stems: [{ x: p.x, z: p.z, r }], bark, leaf: col, fork: p.y + lo + 0.2 });
      G.markDisc(p.x, p.z, r + 0.05);
    } else if (p.form === 'palm') {
      const style = palmStyle(p);
      const lc = style === 'nipa' ? pal.nipa : mix3(pal.palmLeaf, pal.pick('crown_palm', rng, 0.05), 0.45);
      const flo = Math.max(0.15, p.height - 0.6 * p.crown_w);
      const stem = stemSpec(p.x, p.z, r, key);
      let h;
      if (style === 'talipot') {
        h = buildTalipot(wood, leafOf.plant, {
          owner, x: p.x, y: p.y, z: p.z, yBottom: yb, r, height: p.height, crownBase: flo,
          cx: p.x, cz: p.z, rx: (VEG.crownScale * p.crown_w) / 2, rz: (VEG.crownScale * p.crown_w) / 2,
          bark: pal.talipotBark, ring: pal.talipotRing, leaf: pal.talipotLeaf, rim: pal.talipotRim, seed, walkable,
        });
      } else {
        const lean = style === 'feather' ? ((p.name || '').includes('coconut') ? 0.12 : 0.04) : 0.0;
        const a = rng() * Math.PI * 2;
        const b = style === 'fan' ? 0.15 + 0.2 * rng() : 0;
        h = buildPalm(wood, leafOf.plant, {
          owner, x: p.x, y: p.y, z: p.z, yBottom: yb, r, height: p.height, crownR: p.crown_w / 2, frondLo: flo, style,
          bend: [Math.cos(a) * lean * p.height, Math.sin(a) * lean * p.height], sBend: [Math.cos(a) * b, Math.sin(a) * b],
          nuts: (p.name || '').includes('coconut'), straightTo: stem.straightTo, walkable,
          bark: pal.palmBark, ringColor: pal.palmRing, leaf: lc, rim: style === 'fan' ? pal.palmRim : null, dead: pal.dead, seed,
        });
      }
      merge(owner, h);
      hostOf.set(key, {
        stems: [{ x: p.x, z: p.z, r }], bark: pal.palmBark,
        palm: { T: h.attach, fan: style === 'fan' || style === 'talipot', fanR: Math.max(0.8, (h.fanR || 1) * 0.8), leaf: lc },
      });
      G.markDisc(p.x, p.z, r + 0.05);
    } else if (p.form === 'shrub' && /bamboo|bambusa/i.test(`${p.name} ${p.sci}`)) {
      const on = onHost.get(key) ?? [];
      const lc = pal.pick('understorey', rng);
      const culm = lin('#b3bb4d');
      const h = buildBamboo(wood, leafOf.plant, {
        owner, x: p.x, y: p.y, z: p.z, yBottom: yb, height: p.height, width: p.crown_w,
        extra: on.filter((q) => q.s.hag > 0.05).map((q) => [q.x, q.z]),
        culm, leaf: lc, seed,
      });
      merge(owner, h);
      hostOf.set(key, { stems: h.stems, bark: culm, leaf: lc });
      // one solid circle round the culms
      let rr = 0;
      for (const s of h.stems) rr = Math.max(rr, Math.hypot(s.x - p.x, s.z - p.z) + s.r);
      trunkCircles.push([p.x, p.z, rr + 0.05, owner]);
      G.markDisc(p.x, p.z, rr);
    } else if (p.form === 'shrub') {
      bushMembers.push({ owner, key, x: p.x, y: p.y, z: p.z, h: p.height, w: p.crown_w, kind: 'shrub' });
      hostOf.set(key, { stems: null, leaf: null, member: bushMembers[bushMembers.length - 1] });
    } else {
      inst.place('herb', p.x, p.y, p.z, p.rot, p.crown_w, p.height, p.crown_w, jit([1, 1, 1], rng, 0.06));
      hostOf.set(key, { stems: null, leaf: lin('#74b848') });
    }
  });

  // Prop roots: neat arches, only where they land in water or on mud, never on a path.
  function placeRoots(x, z, y, attach, spread, bark, rng) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (walkable(x + Math.cos(a) * spread, z + Math.sin(a) * spread)) return;
    }
    const bed = Math.min(y, ground(x, z));
    inst.place(pickKey(rng, ['arches0', 'arches1']), x, bed, z, rng() * 6.283, spread, Math.max(0.5, y + attach - bed), spread, jit(bark, rng, 0.05));
    st.roots++;
  }

  // ---- canopy trees from the kept canopy puffs: trunk plus a plump crown
  const canopyTree = (c, scale, key2) => {
    const rng = makeRng(hashSeed('C', c.i));
    const w = c.w * scale;
    let lo = Math.max(c.h - 1.1 * w, 0.3 * c.h);
    if (G.dWalk(c.x, c.z) < w / 2 + 0.3) lo = Math.max(lo, Math.max(ground(c.x, c.z), c.y) + VEG.headroom - c.y);
    lo = Math.min(lo, c.h - 1.0);
    const col = pal.pickAt('canopy_puff', c.x, c.z, rng);
    const r = 0.08 + 0.012 * c.h;
    const gy = ground(c.x, c.z);
    const yb = Math.min(gy, c.y) - 0.25;
    const yTop = c.y + lo + 0.3 * (c.h - lo);
    const tilt = 0.03 + 0.06 * rng();
    const [ox, oz] = inst.placeLeaning('trunk', c.x, yb, c.z, rng() * 6.28, rng() * 6.283, tilt, r, yTop - yb, r, jit(pal.bark, rng));
    const k = (c.y + lo - yb) / (yTop - yb);
    inst.place(key2 ?? pickKey(rng, ['crownR', 'crownT']), c.x + ox * k, c.y + lo, c.z + oz * k, rng() * 6.28, w, c.h - lo, w, col);
    hosts.trunks.push({ owner: `C${c.i}`, x: c.x, z: c.z, y0: yb, y1: yTop, r0: r, r1: r });
    hosts.crowns.push({ owner: `C${c.i}`, cx: c.x, cy: c.y + (lo + c.h) / 2, cz: c.z, rx: w / 2, ry: (c.h - lo) / 2, rz: w / 2 });
    crownBoxes.push({ cx: c.x, cy: c.y + (lo + c.h) / 2, cz: c.z, rx: w / 2, ry: (c.h - lo) / 2, rz: w / 2 });
    trunkCircles.push([c.x, c.z, r + 0.05, `C${c.i}`]);
    G.markDisc(c.x, c.z, r + 0.05);
    st.canopyTrees++;
  };
  // bank: fewer, bigger garden trees
  for (const c of bankPuffs) c.w = Math.min(c.w, 5.5);
  thin([...bankPuffs].sort((a, b) => b.w - a.w || a.i - b.i), () => 8, 8).forEach((c) => canopyTree(c, 1.35));
  st.dropped.bankPuff = bankPuffs.length - st.canopyTrees;
  const nBank = st.canopyTrees;
  thin([...otherPuffs].sort((a, b) => b.h - a.h || a.i - b.i), (a, b) => 1.25 * Math.max(a.w, b.w), 12).forEach((c) => canopyTree(c, 1.15));
  st.dropped.otherPuff = otherPuffs.length - (st.canopyTrees - nBank);

  // ---- mangrove fringe: hosts stay, a crown every few metres along open water and the
  // paths, the interior merged into wide flat crowns
  {
    const mang = [];
    rows.forEach((row, i) => {
      if (types[row[5]] !== 'mangrove_canopy') return;
      const [x, y, z, h, w] = row;
      mang.push({ i, x, y, z, h, w, host: onHost.has(`clump:${i}`), dOpen: G.dOpen(x, z), dWalk: G.dWalk(x, z) });
    });
    const hostsM = mang.filter((m) => m.host);
    const edge = mang.filter((m) => !m.host && m.dOpen < m.w / 2 + 1.2);
    const path = mang.filter((m) => !m.host && m.dOpen >= m.w / 2 + 1.2 && m.dWalk < m.w / 2 + 1.5);
    const inner = mang.filter((m) => !m.host && m.dOpen >= m.w / 2 + 1.2 && m.dWalk >= m.w / 2 + 1.5);
    const keptEdge = thin([...hostsM, ...edge.sort((a, b) => a.dOpen - b.dOpen || a.i - b.i)], () => 2.9, 3).filter((m) => !m.host);
    const keptPath = thin([...hostsM, ...keptEdge, ...path.sort((a, b) => b.h - a.h || a.i - b.i)], () => 2.6, 3).filter((m) => !m.host && !keptEdge.includes(m));
    // interior: keep the tallest crown every 4.5 m; each takes in its neighbours and
    // becomes one wide flat crown
    const centres = thin([...inner].sort((a, b) => b.h - a.h || a.i - b.i), () => 4.5, 5);
    const ch = new PointHash(5);
    centres.forEach((c) => { c.g = [c]; ch.add(c.x, c.z, 0, c); });
    for (const m of inner) {
      if (centres.includes(m)) continue;
      let best = null, bd = 4.5;
      ch.each(m.x, m.z, 4.5, (e, d) => { if (d < bd) { bd = d; best = e.item; } return false; }, 0);
      if (best) best.g.push(m);
    }
    const merged = centres.map((c) => {
      let ext = 0;
      for (const q of c.g) ext = Math.max(ext, Math.hypot(q.x - c.x, q.z - c.z) + q.w / 2);
      return { i: c.i, x: c.x, z: c.z, y: c.y, h: c.h, w: clamp(2 * ext, 4, 6) / 1.2, merged: c.g.length };
    });
    // near the open water or a path, crowns keep far from each other's roots
    const drawMangrove = (m, roots) => {
      const rng = makeRng(hashSeed('M', m.i));
      const cw = 1.2 * m.w;
      const gy = ground(m.x, m.z);
      // a squat tree: the top brought down a little, a deep round crown over the roots
      const top = m.h > 4 ? 0.86 * m.h : m.h;
      let lo = Math.max(Math.min(1.3, 0.45 * top), 0.25 * top, top - 1.0 * cw);
      lo = Math.max(lo, topLizard(`clump:${m.i}`) + 0.15 - m.y);
      if (G.dWalk(m.x, m.z) < cw / 2 + 0.3) lo = Math.max(lo, Math.max(gy, m.y) + VEG.headroom - m.y);
      const hTop = Math.max(top, lo + 1.2);
      const r = 0.06 + 0.012 * m.h;
      const yb = Math.min(m.y, gy) - 0.25;
      const yTop = m.y + lo + 0.3 * (hTop - lo);
      const bark = pal.mangroveBark;
      // no lizard on this stem: a gentle lean for character
      const tilt = m.host ? 0 : 0.04 + 0.07 * rng();
      const lean = rng() * 6.283;
      const [ox, oz] = inst.placeLeaning('trunk', m.x, yb, m.z, rng() * 6.28, lean, tilt, r, yTop - yb, r, jit(bark, rng));
      const k = (m.y + lo - yb) / (yTop - yb);
      const col = pal.pickAt('crown_mangrove', m.x, m.z, rng);
      inst.place(pickKey(rng, ['crownF1', 'crownF2']), m.x + ox * k, m.y + lo, m.z + oz * k, rng() * 6.28, cw, hTop - lo, cw, col);
      if (roots) placeRoots(m.x, m.z, m.y, Math.min(1.3, 0.2 * m.h + 0.5), clamp(0.3 * cw, 0.95, 1.35), bark, rng);
      const owner = `C${m.i}`;
      hosts.trunks.push({ owner, x: m.x, z: m.z, y0: yb, y1: yb + 0.6 * (yTop - yb), r0: r, r1: r });
      hosts.crowns.push({ owner, cx: m.x, cy: m.y + (lo + hTop) / 2, cz: m.z, rx: cw / 2, ry: (hTop - lo) / 2, rz: cw / 2 });
      crownBoxes.push({ cx: m.x, cy: m.y + (lo + hTop) / 2, cz: m.z, rx: cw / 2, ry: (hTop - lo) / 2, rz: cw / 2 });
      if (m.host) hostOf.set(`clump:${m.i}`, { stems: [{ x: m.x, z: m.z, r }], bark, leaf: col, fork: m.y + lo + 0.2 });
      trunkCircles.push([m.x, m.z, r + 0.05, owner]);
      G.markDisc(m.x, m.z, r + 0.05);
    };
    for (const m of hostsM) drawMangrove(m, m.dOpen < m.w / 2 + 2);
    for (const m of keptEdge) drawMangrove(m, true);
    for (const m of keptPath) drawMangrove(m, true);
    for (const m of merged) drawMangrove(m, true); // roots only where no walkable ground is in reach
    st.mangroveKept = hostsM.length + keptEdge.length + keptPath.length;
    st.mangroveMerged = merged.length;
    st.dropped.mangrove = mang.length - st.mangroveKept - inner.length;
  }

  // ---- understorey trees: trees on open ground keep a ring of ferns at their feet so
  // their solid core shows; in the thicket only lizard hosts stay
  const ferns = [];
  rows.forEach((row, i) => {
    if (types[row[5]] !== 'understorey_tree') return;
    const [x, y, z, h, w, , rot] = row;
    const key = `clump:${i}`;
    const m = G.maskAt(x, z);
    const onWalk = !!(m & BIT.walkable);
    if (!onWalk && !onHost.has(key) && !(m & BIT.bank)) { drop('understorey'); return; }
    const rng = makeRng(hashSeed('C', i));
    const r = 0.06 + 0.01 * h;
    const gy = ground(x, z);
    let lo = Math.max(0.35 * h, onWalk || G.dWalk(x, z) < w / 2 + 0.3 ? 1.55 : 1.05, topLizard(key) + 0.15 - y);
    lo = Math.min(lo, h - 1.0);
    const yb = Math.min(y, gy) - 0.25;
    const yTop = y + lo + 0.35 * (h - lo);
    inst.place('trunk', x, yb, z, rot, r, yTop - yb, r, jit(pal.bark, rng));
    const col = pal.pickAt('understorey', x, z, rng);
    inst.place(pickKey(rng, ['crownR', 'crownT']), x, y + lo, z, rot, w * 1.12, h - lo, w * 1.12, col);
    const owner = `C${i}`;
    hosts.trunks.push({ owner, x, z, y0: yb, y1: yb + 0.6 * (yTop - yb), r0: r, r1: r });
    hosts.crowns.push({ owner, cx: x, cy: y + (lo + h) / 2, cz: z, rx: w / 2, ry: (h - lo) / 2, rz: w / 2 });
    crownBoxes.push({ cx: x, cy: y + (lo + h) / 2, cz: z, rx: w / 2, ry: (h - lo) / 2, rz: w / 2 });
    hostOf.set(key, { stems: [{ x, z, r }], bark: pal.bark, leaf: col, fork: y + lo + 0.2 });
    trunkCircles.push([x, z, r + 0.05, owner]);
    G.markDisc(x, z, r + 0.05);
    if (onWalk) {
      const n = 4;
      const a0 = rng() * 6.283;
      for (let k = 0; k < n; k++) {
        const a = a0 + (k / n) * Math.PI * 2 + (rng() - 0.5) * 0.4;
        const d = 0.5 + 0.1 * rng();
        ferns.push({ x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, s: 0.48 + 0.1 * rng(), rot: a, ring: true });
      }
      G.markDisc(x, z, 0.35 * w + 0.1);
    }
  });

  // ---- bush-like clumps: into the thicket mounds, lawn mounds or single domes
  rows.forEach((row, i) => {
    const type = types[row[5]];
    if (type !== 'bush' && type !== 'ground_shrub') return;
    const [x, y, z, h, w] = row;
    bushMembers.push({ owner: `C${i}`, key: `clump:${i}`, x, y, z, h, w, kind: type });
  });
  const lawn = [];
  for (const b of bushMembers) {
    const m = G.maskAt(b.x, b.z);
    const host = onHost.has(b.key);
    const owns = stemsOf.has(b.owner);
    if (m & BIT.thicket) { b.absorbed = true; continue; }
    if (b.kind === 'ground_shrub' && !host && !owns) { drop('groundShrub'); continue; }
    if (!(m & (BIT.walkable | BIT.island | BIT.causeway | BIT.bank)) && G.dWalk(b.x, b.z) > 3 && !host) { drop('fringeBush'); continue; }
    lawn.push(b);
  }

  // Puffs: {x, z, y0, R, H, mass, kind}; masses: {id, col, puffs, kind}
  const puffs = [];
  const masses = [];
  const newMass = (kind, col) => { const m = { id: masses.length, kind, col, puffs: [] }; masses.push(m); return m; };
  const addPuff = (mass, p) => { p.mass = mass; mass.puffs.push(p); puffs.push(p); return p; };
  const baseY = (x, z, R) => {
    let y = ground(x, z);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      y = Math.min(y, ground(x + Math.cos(a) * R * 0.7, z + Math.sin(a) * R * 0.7));
    }
    return y;
  };

  // lawn: clusters of three or more become one mound, the rest single domes
  {
    const groups = cluster(lawn, 3.5, (a, b) => Math.hypot(a.x - b.x, a.z - b.z) <= 1.3 * (a.w + b.w) / 2);
    const { cols, cell, x0, z0 } = T;
    for (const g of groups) {
      const rng = makeRng(hashSeed('lawn', g[0].owner));
      if (g.length < 3) {
        for (const b of g) {
          const mass = newMass('single', pal.pickAt('shrub', b.x, b.z, rng));
          const low = b.kind === 'ground_shrub';
          let R = 0.5 * b.w;
          let H = low ? Math.min(b.h, 0.7) : clamp(Math.min(b.h, 0.8 * b.w), 0.7, 2.2);
          const y0 = baseY(b.x, b.z, R);
          for (const l of onHost.get(b.key) ?? []) {
            if (l.ground) continue;
            const d = Math.hypot(l.x - b.x, l.z - b.z);
            if (d > 0.92 * R) R = d / 0.92;
            const s2 = puffSink(H), rho = d / R;
            const need = (l.y - y0 + s2) / Math.sqrt(Math.max(0.05, 1 - rho * rho)) - s2 + 0.02;
            if (need > H) H = Math.min(need, Math.max(b.h, 0.8) * 1.1);
          }
          addPuff(mass, { x: b.x, z: b.z, y0, R, H, members: [b] });
          st.singles++;
        }
        continue;
      }
      // the union of the members' footprints, closed so the mound has no gaps
      const cells = new Set();
      for (const b of g) {
        const R = 0.48 * b.w + 0.45;
        const c0 = Math.floor((b.x - R - x0) / cell), c1 = Math.ceil((b.x + R - x0) / cell);
        const r0 = Math.floor((b.z - R - z0) / cell), r1 = Math.ceil((b.z + R - z0) / cell);
        for (let rr = r0; rr <= r1; rr++) {
          for (let cc = c0; cc <= c1; cc++) {
            const px = x0 + cc * cell, pz = z0 + rr * cell;
            if (Math.hypot(px - b.x, pz - b.z) > R) continue;
            cells.add(rr * cols + cc);
          }
        }
      }
      // erode the closing margin back off, keeping cells within the footprint of some member
      const kept = [...cells].filter((j) => {
        const px = x0 + (j % cols) * cell, pz = z0 + Math.floor(j / cols) * cell;
        let inside = false;
        for (const b of g) if (Math.hypot(px - b.x, pz - b.z) <= 0.48 * b.w + 0.05) { inside = true; break; }
        if (inside) return true;
        // a cell between two members close together stays, so the mound is continuous
        let n = 0;
        for (const b of g) if (Math.hypot(px - b.x, pz - b.z) <= 0.48 * b.w + 0.45) n++;
        return n >= 2;
      });
      const mass = newMass('lawn', pal.pickAt('shrub', g[0].x, g[0].z, rng));
      const hMax = Math.max(...g.map((b) => b.h));
      for (const q of packCells(T, kept, { Rmin: 0.55, Rmax: 2.2, out: 0.02, spacing: 1.05, slack: 0.15 })) {
        let hNear = 0;
        for (const b of g) if (Math.hypot(q.x - b.x, q.z - b.z) < q.R + 0.5 * b.w) hNear = Math.max(hNear, b.h);
        const H = clamp(Math.min(hNear || hMax, 0.95 * hMax), 0.7, 1.1 * q.R + 0.3);
        addPuff(mass, { x: q.x, z: q.z, y0: baseY(q.x, q.z, q.R), R: q.R, H, members: g, filler: q.filler });
        st.puffsLawn++;
      }
      st.masses++;
    }
  }

  // thicket: each mass near the paths becomes a few big soft mounds following its outline
  {
    const { cols, rows: nr, mask, cell, x0, z0 } = T;
    const hostCells = new Set();
    for (const b of bushMembers) if (b.absorbed && onHost.has(b.key)) hostCells.add(T.cellIndex(b.x, b.z));
    const comps = components(cols, nr, (i) => (mask[i] & BIT.thicket) !== 0);
    for (const list of comps.list) {
      const area = list.length * cell * cell;
      let keep = false, near = false;
      for (const i of list) {
        const m = mask[i];
        if (m & (BIT.island | BIT.causeway | BIT.bank)) keep = true;
        if (hostCells.has(i)) keep = true;
        if (!near) {
          const x = x0 + (i % cols) * cell, z = z0 + Math.floor(i / cols) * cell;
          if (G.dWalk(x, z) < 3) near = true;
        }
        if (keep && near) break;
      }
      if (!keep && !near) { drop('thicketFar'); continue; }
      const big = area > 120;
      const rng = makeRng(hashSeed('thicket', list[0]));
      const i0 = list[Math.floor(list.length / 2)];
      const mass = newMass('thicket', pal.pickAt('shrub', x0 + (i0 % cols) * cell, z0 + Math.floor(i0 / cols) * cell, rng));
      const edge = (i) => {
        for (const j of [i - 1, i + 1, i - cols, i + cols, i - 2, i + 2, i - 2 * cols, i + 2 * cols]) if (mask[j] & BIT.walkable) return true;
        return false;
      };
      for (const q of packCells(T, list, { Rmin: 0.45, Rmax: big ? 2.9 : 2.4, out: 0.05, spacing: 1.0, mustCover: edge, slack: 0.3 })) {
        const can = T.canopyAt(q.x, q.z);
        const Hc = can > 0.6 && can < 4.5 ? can : 2.4 + 0.8 * rng();
        const H = clamp(0.95 * Hc, 0.75, Math.min(big ? 3.5 : 3.0, 1.05 * q.R + 0.25));
        addPuff(mass, { x: q.x, z: q.z, y0: baseY(q.x, q.z, q.R), R: q.R, H, thicket: true, filler: q.filler });
        st.puffsThicket++;
      }
      st.masses++;
    }
  }

  // no puff buries a lizard
  st.fitChanges = fitPuffsToLizards(puffs, lizards, { Rmin: 0.35, Hmin: 0.35, lumps: 0.02 });

  // ---- coverage: what is drawn at body height so far
  const markPuff = (p) => { if (!p.dropped) G.markDisc(p.x, p.z, puffRadiusAt(p, VEG.bodyLo)); };
  puffs.forEach(markPuff);
  for (const L of lmInfo) {
    for (const [x, z, r] of stemsOf.get(`L${L.i}`) ?? []) G.markDisc(x, z, r - 0.1);
  }

  // ---- edge hedge: blocked land next to walkable ground with nothing drawn at body
  // height gets a low hedge of round puffs just inside the edge, joined to the mound
  // beside it where there is one. Thin shore slivers with water behind are left open.
  {
    const { cols, rows: nr, mask, cell, x0, z0 } = T;
    const cov = G.cov;
    const hedgeLand = BIT.island | BIT.causeway | BIT.bank | BIT.thicket;
    const hedge = newMass('hedge', pal.hedge);
    const live = new PointHash(3);
    for (const p of puffs) if (!p.dropped) live.add(p.x, p.z, 0, p);
    const reach = Math.round(0.35 / cell);
    const bare = (i) => {
      const r = Math.floor(i / cols), c = i - r * cols;
      for (let dr = -reach; dr <= reach; dr++) {
        for (let dc = -reach; dc <= reach; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= nr || cc >= cols) continue;
          if (cov[rr * cols + cc]) return false;
        }
      }
      return true;
    };
    for (let r = 3; r < nr - 3; r++) {
      for (let c = 3; c < cols - 3; c++) {
        const i = r * cols + c;
        const m = mask[i];
        if ((m & BIT.walkable) || (m & BIT.water) || !(m & hedgeLand)) continue;
        let nx = 0, nz = 0;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (mask[i + dr * cols + dc] & BIT.walkable) { nx += dc; nz += dr; }
        }
        if (!nx && !nz) continue;
        if (!bare(i)) continue;
        const l = Math.hypot(nx, nz) || 1;
        const ux = nx / l, uz = nz / l;
        let sliver = false;
        for (let k = 1; k <= 3; k++) {
          const j = T.cellIndex(x0 + c * cell - ux * k * cell, z0 + r * cell - uz * k * cell);
          if (j < 0 || (mask[j] & BIT.water)) sliver = true;
        }
        const hx = x0 + c * cell, hz = z0 + r * cell;
        if (sliver) {
          // a lone blocked cell poking into the path by the water gets a small tuft
          let nw = 0;
          for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (mask[i + dr * cols + dc] & BIT.walkable) nw++;
          if (nw >= 2) {
            const p = addPuff(hedge, { x: hx, z: hz, y0: baseY(hx, hz, 0.2), R: 0.2, H: 0.42, hedge: true });
            fitPuffsToLizards([p], lizards, { Rmin: 0.12, Hmin: 0.2, lumps: 0.02 });
            if (!p.dropped) { markPuff(p); st.tufts = (st.tufts ?? 0) + 1; }
          }
          continue;
        }
        if (hx > GATE.x0 && hx < GATE.x1 && hz > GATE.z0 && hz < GATE.z1) continue; // the props' garden gate
        const rng = makeRng(hashSeed('hedge', i));
        const R = 0.62 + 0.08 * rng();
        const x = x0 + c * cell - ux * (R - cell / 2 - 0.05), z = z0 + r * cell - uz * (R - cell / 2 - 0.05);
        let host = null, hd = R + 1.0;
        live.each(x, z, R + 1.0, (e, d) => { if (e.item.mass.kind !== 'single' && d < hd) { hd = d; host = e.item.mass; } return false; }, 0);
        const p = addPuff(host ?? hedge, { x, z, y0: baseY(x, z, R), R, H: 0.8 + 0.18 * rng(), hedge: true });
        fitPuffsToLizards([p], lizards, { Rmin: 0.3, Hmin: 0.3, lumps: 0.02 });
        if (!p.dropped) { markPuff(p); live.add(p.x, p.z, 0, p); st.puffsHedge++; }
      }
    }
  }

  // ---- lizards on foliage that was merged away: a leafy bump on the mound under them,
  // or failing that a small leaf cluster
  const puffHash = new PointHash(3);
  for (const p of puffs) if (!p.dropped) puffHash.add(p.x, p.z, 0, p);
  // signed distance from a lizard to the nearest drawn mound surface (negative inside);
  // the low-poly facets sit inside the true dome by about 5 % (detail 1) or 1.5 %
  const foliageDist = (l) => {
    let best = Infinity, bp = null;
    puffHash.each(l.x, l.z, 3.2, (e) => {
      const p = e.item;
      const q = puffQ(p, l.x, l.y, l.z);
      const sag = (p.R > 1.4 ? 0.015 : 0.05) * Math.max(p.R, p.H);
      const d = (q - 1) * Math.min(p.R, p.H + puffSink(p.H)) + sag;
      if (d < best) { best = d; bp = p; }
      return false;
    }, 0);
    return { d: best, p: bp };
  };
  const onFoliage = (l, tol = 0.12) => foliageDist(l).d <= tol;
  const stalkLines = []; // [line, owner]: colliders for twigs and stalks, added with the limbs'
  const ownerKey = (s) => (s.host.t === 'landmark' ? `L${s.host.i}` : s.host.t === 'plant' ? `P${s.host.i}` : `C${s.host.i}`);
  const leafPerch = (l, col) => {
    inst.place('leaf3', l.x, l.y - 0.1, l.z, l.s.ang, 0.32, 0.3, 0.32, col);
    if (walkable(l.x, l.z) && l.y - ground(l.x, l.z) < VEG.bodyHi + 0.3) trunkCircles.push([l.x, l.z, 0.28, `C${l.s.host.i}`]);
    st.perchLeaf++;
    // over water, a thin stalk down into the lake, so the cluster does not float
    if (!walkable(l.x, l.z) && ground(l.x, l.z) < 0.02) {
      const rng = makeRng(hashSeed('stalk', l.k));
      const top = [l.x, l.y - 0.14, l.z];
      const lean = [(rng() - 0.5) * 0.3, (rng() - 0.5) * 0.3];
      const foot = [l.x + lean[0], Math.min(-0.1, ground(l.x, l.z)), l.z + lean[1]];
      const mid = [(top[0] + foot[0]) / 2 + (rng() - 0.5) * 0.08, (top[1] + foot[1]) / 2, (top[2] + foot[2]) / 2 + (rng() - 0.5) * 0.08];
      tube(wood, [foot, mid, top], [0.028, 0.022, 0.016], { sides: 5, smooth: true, capEnd: true, color: pal.mangroveBark ?? pal.bark });
      st.perchStalks++;
    }
  };
  // A lizard recorded on a trunk, branch or palm stem whose host was merged into a
  // mound: a short bare twig out of the foliage under it, so it sits on wood and not
  // on the leaves. The twig runs out from the mound's centre, level under the lizard.
  const WOOD_REC = new Set(['trunk', 'branch', 'palm_stem', 'root']);
  const twigPerch = (l, p, d, bark) => {
    if (!WOOD_REC.has(l.s.perch) || !p || d > 0.9) return false;
    let ux = l.x - p.x, uz = l.z - p.z;
    const ul = Math.hypot(ux, uz);
    if (ul < 0.05) { ux = -Math.sin(l.s.ang); uz = -Math.cos(l.s.ang); } else { ux /= ul; uz /= ul; }
    const reach = clamp(Math.max(d, 0) + 0.34, 0.42, 1.25);
    const stem = { x: l.x - ux * reach, z: l.z - uz * reach, r: 0.02 };
    const e = buildStub(wood, { stem, p: [l.x, l.y, l.z], rb: 0.042, bark: bark ?? pal.bark, seed: hashSeed('twig', l.k) });
    const owner = ownerKey(l.s);
    hosts.branches.push({ owner, a: e.a, b: e.b, r: 0.042, twig: true });
    stalkLines.push([e.line, owner]);
    st.perchTwigs++;
    return true;
  };
  const bumps = [];
  for (const l of lizards) {
    if (l.ground || l.bark || l.s.hag < 0.08) continue;
    const rec = hostOf.get(l.hostKey);
    if (rec && rec.stems) continue; // stem hosts get perches below
    const { d, p } = foliageDist(l);
    if (twigPerch(l, p, d, rec?.bark)) continue;
    if (d <= 0.08) { st.perchSkipped++; continue; }
    if (p && d <= 0.9) {
      const s2 = puffSink(p.H);
      const cy = p.y0 - s2;
      const n = [(l.x - p.x) / p.R, (l.y - cy) / (p.H + s2), (l.z - p.z) / p.R];
      const nl = Math.hypot(n[0], n[1], n[2]) || 1;
      const u = [n[0] / nl, n[1] / nl, n[2] / nl];
      // a flattened lump (radii BUMP.a r, BUMP.b r) with the lizard on its outer surface
      const along = (r) => 1 / Math.sqrt((u[0] * u[0] + u[2] * u[2]) / (BUMP.a * r) ** 2 + (u[1] * u[1]) / (BUMP.b * r) ** 2);
      let rb = clamp((d + 0.05) / 1.25, 0.32, 0.75);
      let c = null, bad = true;
      for (let iter = 0; iter < 4 && bad; iter++) {
        const sAlong = along(rb) - 0.03;
        c = [l.x - u[0] * sAlong, l.y - u[1] * sAlong, l.z - u[2] * sAlong];
        bad = false;
        lizHash.each(c[0], c[2], BUMP.a * rb + 0.1, (e) => {
          const o = e.item;
          if (o === l) return false;
          const q = Math.hypot((o.x - c[0]) / (BUMP.a * rb), (o.y - c[1]) / (BUMP.b * rb), (o.z - c[2]) / (BUMP.a * rb));
          if (q < 1.08) bad = true;
          return bad;
        }, 0);
        if (bad) rb *= 0.75;
      }
      if (!bad && rb >= 0.22) {
        bumps.push({ c, r: rb, mass: p.mass });
        // a bump at body height over open ground is solid
        const gy = ground(c[0], c[2]);
        const ra = BUMP.a * rb;
        if (c[1] - BUMP.b * rb < gy + VEG.bodyHi && c[1] + BUMP.b * rb > gy + VEG.bodyLo && G.near(c[0], c[2], ra + 0.3) != null) {
          trunkCircles.push([c[0], c[2], Math.max(0.12, ra - 0.15), p.members?.[0]?.owner ?? `M${p.mass.id}`]);
        }
        st.bumps = (st.bumps ?? 0) + 1;
        continue;
      }
    }
    st.floating++;
    leafPerch(l, rec?.leaf ?? pal.pickAt('shrub', l.x, l.z, makeRng(hashSeed('perch', l.k))));
  }

  // ---- perch props: a surface under every lizard that is off the ground
  const hostReach = (t, i) => {
    if (t === 'landmark') {
      const l = placements.landmarks[i];
      return l ? Math.hypot(l.crown_x - l.x, l.crown_z - l.z) + Math.max(l.crown_w_ew, l.crown_w_ns) / 2 + 1 : 0;
    }
    if (t === 'plant') return placements.plants[i] ? placements.plants[i].crown_w / 2 + 1 : 0;
    if (t === 'clump') return rows[i] ? 0.65 * rows[i][4] + 1 : 0;
    return Infinity;
  };
  const limbColliders = [];
  // circles under any part of a perch that hangs at body height over open ground
  const lowLine = (line, owner) => {
    if (!line) return;
    let last = null;
    for (const [x, y, z, r, soft] of line) {
      if (!walkable(x, z)) continue;
      const gy = ground(x, z);
      if (y > gy + VEG.bodyHi + 0.05 || y < gy + VEG.bodyLo - 0.1) continue;
      if (last && Math.hypot(last[0] - x, last[1] - z) < 0.15) continue;
      last = [x, z];
      // wood: the branch plus a little; leaves: the leaf mass less the body's reach
      const cr = soft ? Math.max(0.12, r - 0.08) : r + 0.06;
      limbColliders.push([+x.toFixed(2), +z.toFixed(2), +Math.min(0.5, cr).toFixed(2), owner]);
    }
  };
  for (const [line, owner] of stalkLines) lowLine(line, owner);
  for (const l of lizards) {
    const s = l.s;
    if (s.pose !== 'flat' || s.hag < 0.08) continue;
    const rec = hostOf.get(l.hostKey);
    const seed = hashSeed('perch', l.k);
    if (!rec || !rec.stems) continue; // foliage hosts are done above
    if (onFoliage(l, 0.05)) {
      const f = foliageDist(l);
      if (!twigPerch(l, f.p, f.d, rec.bark)) st.perchSkipped++;
      continue;
    }
    const owner = s.host.t === 'landmark' ? `L${s.host.i}` : s.host.t === 'plant' ? `P${s.host.i}` : `C${s.host.i}`;
    let stem = rec.stems[0], best = Infinity;
    for (const c of rec.stems) {
      const d = Math.hypot(s.x - c.x, s.z - c.z) - c.r;
      if (d < best) { best = d; stem = c; }
    }
    const dAxis = Math.max(Math.hypot(s.x - stem.x, s.z - stem.z), 1e-3);
    const p = [s.x, s.y, s.z];
    if (dAxis > hostReach(s.host.t, s.host.i)) {
      st.perchFar++;
      leafPerch(l, rec.leaf ?? pal.pickAt('shrub', s.x, s.z, makeRng(seed)));
      continue;
    }
    if (rec.palm && dAxis > stem.r + 0.3) {
      // a fan hanging low over open ground stays small
      const lowFan = s.y - ground(s.x, s.z) < 2.2 && G.dWalk(s.x, s.z) < rec.palm.fanR + 0.5;
      const e = rec.palm.fan
        ? buildPerchFan(leafOf.perch, { T: rec.palm.T, p, radius: lowFan ? Math.min(rec.palm.fanR, 1.0) : rec.palm.fanR, color: rec.palm.leaf, rim: rec.palm.rim, seed })
        : buildPerchFrond(leafOf.perch, { T: rec.palm.T, p, color: rec.palm.leaf, seed });
      hosts.branches.push({ owner, a: e.a, b: e.b, r: 0.06, frond: true });
      lowLine(e.line, owner);
      st.perchFronds++;
      continue;
    }
    const rb = Math.min(0.075, Math.max(0.035, 0.3 * stem.r + 0.02));
    const bark = rec.bark ?? pal.bark;
    const out = dAxis - stem.r;
    let e;
    if (out <= 0.55) {
      e = buildStub(wood, { stem, p, rb, bark, seed });
      st.perchStubs++;
    } else {
      const lc = rec.leaf ?? pal.pick('crown_broadleaf', makeRng(seed));
      e = buildLimb(wood, leafOf.perch, { stem, p, rb: Math.max(rb, 0.05), bark, leafCol: lc, seed, yMax: rec.fork ?? s.y + 1.6 });
      st.perchLimbs++;
    }
    hosts.branches.push({ owner, a: e.a, b: e.b, r: rb });
    lowLine(e.line, owner);
  }

  // ---- ferns: the rings under trees on open ground, and a few under the big crowns
  // along the thicket edges
  {
    const rng = makeRng(777);
    const { cols, rows: nr, mask, cell, x0, z0 } = T;
    const cand = [];
    for (let r = 2; r < nr - 2; r += 3) {
      for (let c = 2; c < cols - 2; c += 3) {
        const i = r * cols + c;
        if (!(mask[i] & BIT.walkable)) continue;
        const x = x0 + c * cell, z = z0 + r * cell;
        if (T.canopyAt(x, z) < 3 || G.dWalk(x, z) > 0.55) continue;
        let th = false;
        for (const [dc, dr] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) if (mask[i + dr * cols + dc] & BIT.thicket) th = true;
        if (th) cand.push({ x, z, s: 0.5 + 0.25 * rng(), rot: rng() * 6.283 });
      }
    }
    for (const f of thin(cand.sort(() => rng() - 0.5), () => 2.6, 3).slice(0, 44)) ferns.push(f);
    for (const f of ferns) {
      if (lizHash.near(f.x, f.z, 0.25)) continue;
      inst.place('fern', f.x, ground(f.x, f.z), f.z, f.rot, f.s, f.s * 1.05, f.s, jit(pal.fern, rng, 0.08));
      st.ferns++;
    }
  }

  // ---- fallen logs (props for lizards and for looking at)
  for (const l of spawns.logs ?? []) {
    inst.place('log', l.x, l.y + l.r, l.z, l.rot, l.len, l.r, l.r, [1, 1, 1]);
    hosts.logs.push({ x: l.x, y: l.y, z: l.z, len: l.len, r: l.r, rot: l.rot });
  }

  // ---- colliders for what is drawn: mound puffs, trunks and low limbs that reach ground
  // the player can stand on. Circles never cover a lizard on the ground; a circle that
  // would seal off ground reachable before is shrunk together with its puff.
  const colliderOut = { circles: [], owners: [] };
  let sealed = 0;
  {
    const P = CONFIG.player;
    const onGround = lizards.filter((q) => q.ground);
    const dataHash = new PointHash(2);
    for (const [x, z, r] of colliders.circles) dataHash.add(x, z, r);
    let extra = [];
    const reachStand = (x, z, r) => G.near(x, z, r + VEG.bodyRadius + 0.3);
    for (const p of puffs) {
      if (p.dropped) continue;
      const rb = puffRadiusAt(p, VEG.bodyLo);
      const n = reachStand(p.x, p.z, rb);
      if (n == null || rb + VEG.bodyRadius - n <= VEG.bodyReach) continue;
      let r = rb - 0.15;
      for (const q of onGround) {
        const dq = Math.hypot(q.x - p.x, q.z - p.z);
        if (dq < r + 0.05) r = dq - 0.05;
      }
      if (r >= 0.12) extra.push({ c: [+p.x.toFixed(2), +p.z.toFixed(2), +r.toFixed(2)], owner: p.members?.[0]?.owner ?? `M${p.mass.id}`, puff: p });
    }
    for (const [x, z, r, owner] of [...trunkCircles, ...limbColliders]) {
      if (dataHash.near(x, z, r * 0.5)) continue;
      if (G.near(x, z, r + P.radius + 0.2) == null) continue;
      extra.push({ c: [+x.toFixed(2), +z.toFixed(2), +r.toFixed(2)], owner });
    }
    const before = joinedToStart(T, standRaster(T, colliders.circles, true));
    const { cols, cell, x0, z0 } = T;
    for (let pass = 0; pass < 8 && extra.length; pass++) {
      const ok = standRaster(T, colliders.circles.concat(extra.map((e) => e.c)), true);
      const now = joinedToStart(T, ok);
      // ground cut off from the start; nooks under 1.5 m2 (behind a limb, between a
      // trunk and a bush) do not count
      const isCut = new Uint8Array(ok.length);
      for (let i = 0; i < ok.length; i++) if (before[i] && ok[i] && !now[i]) isCut[i] = 1;
      const cut = [];
      const seen = new Uint8Array(ok.length);
      for (let i = 0; i < ok.length; i++) {
        if (!isCut[i] || seen[i]) continue;
        const comp = [i];
        seen[i] = 1;
        for (let k = 0; k < comp.length; k++) {
          const j = comp[k];
          for (const q of [j - 1, j + 1, j - cols, j + cols]) if (isCut[q] && !seen[q]) { seen[q] = 1; comp.push(q); }
        }
        if (comp.length * cell * cell >= 1.5) cut.push(...comp);
        else st.nooks = (st.nooks ?? 0) + 1;
      }
      if (!cut.length) break;
      const pocket = new PointHash(1);
      for (const i of cut) pocket.add(x0 + (i % cols) * cell, z0 + Math.floor(i / cols) * cell);
      // only circles that sit between the pocket and the ground still joined to the start
      const joinedNear = (x, z, d) => {
        const c0 = Math.round((x - x0) / cell), r0 = Math.round((z - z0) / cell), R = Math.ceil(d / cell);
        for (let dr = -R; dr <= R; dr++) {
          for (let dc = -R; dc <= R; dc++) {
            if (Math.hypot(dr, dc) * cell > d) continue;
            const q = (r0 + dr) * cols + c0 + dc;
            if (q >= 0 && q < now.length && now[q]) return true;
          }
        }
        return false;
      };
      let hit = 0;
      for (const e of extra) {
        const d = e.c[2] + P.radius + 1.0;
        if (!pocket.near(e.c[0], e.c[1], d) || !joinedNear(e.c[0], e.c[1], d)) continue;
        e.c[2] = +(e.c[2] * 0.7).toFixed(2);
        e.shrunk = true;
        if (e.puff) { e.puff.R *= 0.85; e.puff.shrunk = true; }
        hit++;
      }
      if (!hit) break;
      const n0 = extra.length;
      extra = extra.filter((e) => {
        if (!e.shrunk || e.c[2] >= 0.1) return true;
        if (e.puff) e.puff.dropped = true;
        return false;
      });
      sealed += n0 - extra.length;
    }
    for (const e of extra) {
      colliderOut.circles.push(e.c);
      colliderOut.owners.push(e.owner);
    }
  }

  // ---- mounds into the leaf mesh: one colour per mass, normals leaning to the mass's
  // envelope so its puffs shade as one soft mound
  for (const mass of masses) {
    const live = mass.puffs.filter((p) => !p.dropped);
    if (!live.length) continue;
    const env = live.length > 1 ? massEnvelope(live) : null;
    let top = 0;
    for (const p of live) top = Math.max(top, p.H);
    mass.env = env;
    mass.aoY = [live[0].y0 - 0.1, live[0].y0 + top];
    live.forEach((p, k) => {
      const rng = makeRng(hashSeed('puff', mass.id, k));
      moundPuff(leafOf.mound, {
        x: p.x, y0: p.y0, z: p.z, R: p.R, H: p.H, seed: hashSeed('mp', mass.id, k), yaw: rng() * 6.283,
        color: tint(mass.col, 0.97 + 0.06 * rng()), env, massTop: mass.kind === 'single' ? p.H : top, jit: 0.02,
        detail: p.R > 1.4 ? 2 : 1,
      });
      hosts.mounds.push({ owner: p.members?.[0]?.owner ?? `M${mass.id}`, x: p.x, y: p.y0, z: p.z, r: p.R, h: p.H, kind: p.filler ? `${mass.kind}-filler` : mass.kind });
    });
  }

  // bumps: leafy lumps on a mound under a lizard, in the mound's colour and shading
  for (const [k, b] of bumps.entries()) {
    const m = b.mass;
    blob(leafOf.mound, {
      c: b.c, r: [b.r * BUMP.a, b.r * BUMP.b, b.r * BUMP.a], seed: hashSeed('bump', k), detail: 1, jit: 0.03, flat: -0.4, squash: 0.5,
      color: m.col, shade: [0.64, 1.14], smooth: 0.9, bend: m.env, bendK: 0.4,
      aoY: m.aoY ?? [b.c[1] - 1.5, b.c[1] + 0.4],
    });
  }

  // ---- meshes
  const group = new THREE.Group();
  group.name = 'vegetation';
  const mergedList = [['veg-merged-wood', wood, mats.wood], ['veg-merged-leaf', leaf, mats.leaf]];
  if (split) for (const k of ['plant', 'perch', 'mound']) mergedList.push([`veg-merged-leaf-${k}`, leafOf[k], mats.leaf]);
  for (const [name, b, mat] of mergedList) {
    if (!b.triangles) continue;
    const mesh = new THREE.Mesh(b.toGeometry(), mat);
    mesh.name = name;
    group.add(mesh);
  }
  for (const mesh of inst.meshes(mats)) group.add(mesh);
  const noShadow = new Set(['veg-leaf3', 'veg-herb', 'veg-log', 'veg-arches0', 'veg-arches1', 'veg-fern']);
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = !noShadow.has(o.name);
      o.receiveShadow = true;
    }
  });

  // hosts in centimetres, which is all the data carries
  const r2 = (v) => (Array.isArray(v) ? v.map(r2) : typeof v === 'number' ? Math.round(v * 100) / 100 : v);
  for (const list of Object.values(hosts)) {
    for (const e of list) for (const k of Object.keys(e)) e[k] = r2(e[k]);
  }

  const stats = { drawCalls: 0, instances: 0, triangles: 0, buildMs: 0, parts: {} };
  group.traverse((o) => {
    if (!o.isMesh) return;
    const tris = o.geometry.attributes.position.count / 3;
    const n = o.isInstancedMesh ? o.count : 1;
    stats.drawCalls++;
    if (o.isInstancedMesh) stats.instances += n;
    stats.triangles += tris * n;
    stats.parts[o.name] = { n, tris: tris * n };
  });
  Object.assign(stats, st, {
    colliders: colliderOut.circles.length, collidersDropped: sealed,
    puffs: puffs.filter((p) => !p.dropped).length, puffsDropped: puffs.filter((p) => p.dropped).length,
  });
  stats.buildMs = Math.round(performance.now() - t0);

  if (st.perchFar) console.warn(`vegetation: ${st.perchFar} lizards are far from their host in placements.json`);
  if (renderer?.capabilities && !renderer.capabilities.isWebGL2) {
    console.warn('vegetation: the cut-out dither needs WebGL2');
  }

  return {
    group,
    hosts,
    stats,
    colliders: colliderOut, // extra circles for Collision, in the colliders.json shape
    materials: mats,
    update(dt, t, o = {}) {
      setVegFrame(t, o.cameraPosition, o.focus, VEG.cutRadius);
    },
    dispose() {
      group.traverse((o) => {
        if (o.isMesh && o.name.startsWith('veg-merged')) o.geometry.dispose();
        if (o.isInstancedMesh) o.dispose();
      });
      mats.wood.dispose();
      mats.leaf.dispose();
      mats.gradientMap.dispose();
      mats.woodRamp.dispose();
    },
  };
}

function palmStyle(p) {
  const n = (p.name || '').toLowerCase();
  if (p.height <= 2.0) return 'small';
  if (n.includes('nipa')) return 'nipa';
  if (n.includes('talipot')) return 'talipot';
  if (n.includes('royal')) return 'royal';
  if (n.includes('hat palm') || n.includes('sabal') || n.includes('thatch')) return 'fan';
  return 'feather';
}

// The envelope of a mound's puffs as a small height grid; returns a normal lookup.
function massEnvelope(list) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of list) {
    x0 = Math.min(x0, p.x - p.R); x1 = Math.max(x1, p.x + p.R);
    z0 = Math.min(z0, p.z - p.R); z1 = Math.max(z1, p.z + p.R);
  }
  const s = 0.5;
  x0 -= s; z0 -= s;
  const w = Math.ceil((x1 - x0) / s) + 3, h = Math.ceil((z1 - z0) / s) + 3;
  const H = new Float32Array(w * h);
  const hash = new PointHash(3);
  for (const p of list) hash.add(p.x, p.z, 0, p);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = x0 + i * s, z = z0 + j * s;
      let top = 0;
      hash.each(x, z, 3.2, (e) => {
        const p = e.item;
        const d = Math.hypot(x - p.x, z - p.z) / p.R;
        if (d < 1) {
          const sk = puffSink(p.H);
          top = Math.max(top, p.y0 - sk + (p.H + sk) * Math.sqrt(1 - d * d) - list[0].y0);
        }
        return false;
      }, 0);
      H[j * w + i] = top;
    }
  }
  // one blur pass keeps the envelope soft
  const B = new Float32Array(w * h);
  for (let j = 1; j < h - 1; j++) {
    for (let i = 1; i < w - 1; i++) {
      const k = j * w + i;
      B[k] = (4 * H[k] + H[k - 1] + H[k + 1] + H[k - w] + H[k + w]) / 8;
    }
  }
  const at = (x, z) => {
    const fi = clamp((x - x0) / s, 1, w - 2.001), fj = clamp((z - z0) / s, 1, h - 2.001);
    const i = Math.floor(fi), j = Math.floor(fj), tx = fi - i, tz = fj - j;
    const k = j * w + i;
    return (B[k] * (1 - tx) + B[k + 1] * tx) * (1 - tz) + (B[k + w] * (1 - tx) + B[k + w + 1] * tx) * tz;
  };
  return (p) => {
    const gx = (at(p[0] + s, p[2]) - at(p[0] - s, p[2])) / (2 * s);
    const gz = (at(p[0], p[2] + s) - at(p[0], p[2] - s)) / (2 * s);
    const l = Math.hypot(gx, 1, gz);
    return [-gx / l, 1 / l, -gz / l];
  };
}

// Small spheres at every lizard spawn, coloured by species, for ?debug=spawns.
export function buildSpawnMarkers(data) {
  const list = data.spawns.spawns;
  const colours = {
    cristatellus: '#ff6a2e', sagrei: '#2f6dff', carolinensis: '#8cff3a', distichus: '#ffffff', equestris: '#1d1f66',
  };
  const mesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.07, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }),
    list.length,
  );
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  list.forEach((s, i) => {
    mesh.setMatrixAt(i, m.makeTranslation(s.x, s.y, s.z));
    mesh.setColorAt(i, c.set(colours[s.sp] ?? '#ff00ff'));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = 'spawn-markers';
  return mesh;
}
