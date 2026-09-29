// The lizards: spawning near the player from data/spawns.json, the behaviour of each
// (brain.js), and the hooks the catching code uses. Loaded by main.js as an
// optional system: build(game) returns { group, update(dt, t), stats, ... }.
//
//   game.lizards.all                      the active lizards (near the player)
//   game.lizards.nearest(pos, maxDist, filter)   hidden ones too; filter lz => lz.visible
//   game.lizards.pick(ray, maxDist)       -> { lizard, point } or null (reused object);
//                                            not through trunks and branches (drawn
//                                            wood near the spawns, and every trunk)
//   game.lizards.forEachVisible(camera, fn)
//   game.lizards.pin(i) / unpin()         keep spawn i's lizard active (a tutorial)
//   game.lizards.sunExposure(x, y, z, nx, ny, nz), hours(), warmth(), thermalPhase()   the time-of-day hooks
//   lizard.species, sex, perch, state (idle, alert, flee, hidden, return, frozen,
//   captured), display, visible, tag, exposure, mood (bask, hot, shade 0..1, ...),
//   shelter (out of sight in the shade until the day cools), headPosition(v), freeze(),
//   unfreeze(), capture() and release(x, y, z) (both return true when done),
//   setBackpack(colour | null)
//   events: lizard:alert, lizard:flee, lizard:display (lizard, kind), lizard:hidden
//   (lizard, { x, y, z, away }: where it went out of sight, reused object)
//
// URL flags: ?debug=lizards (a state marker over each), ?lizards=many (more of them),
// ?lizard=<species> (the nearest one of that species, in view, for a screenshot). With
// ?lizard=, for check images: &perch=bark|branch|leaf|ground|log picks the perch,
// &nth=k skips the first k that fit, &lizardcam=m and &lizardfrom=m set the camera's
// and the player's distance from it, &lizardlift=m the camera's height over it,
// &scare=s[,creep|walk|jog] walks the player at it from s seconds in (the camera
// stays), &fleehold=f stops its escape at fraction f of the way, and &lizardi=i takes
// spawn i (of that species) whatever the distance, &lizardsun=1 (or 0) one in the sun (or
// the shade) at the sky's hour. With &lizardcam=side, &lizardback=m
// and &lizardaside=m place the camera behind and beside the player (2.6 and 1.3) and
// &lizardmid=f aims it f of the way from the lizard to the player (a flank view at 0.5).

import * as THREE from 'three';
import { FLAGS } from '../config.js';
import { recordError } from '../debug.js';
import { SPECIES_ORDER, SPECIES_INFO, AWARENESS, THERMAL, noiseFactor, warmth, thermalPhase } from './species.js';
import { buildPerches, Route, SURF } from './perches.js';
import { vegUniforms } from '../world/wind.js';
import { Lizard } from './brain.js';

const SURF_MODE = { bark: SURF.BARK, branch: SURF.BRANCH, leaf: SURF.LEAF, ground: SURF.GROUND, log: SURF.LOG };

const params = new URLSearchParams(location.search);
const MANY = params.get('lizards') === 'many';
const FOCUS = params.get('lizard');
const FOCUS_OPTS = {
  perch: params.get('perch'),
  nth: Math.max(0, Number(params.get('nth')) || 0),
  cam: Number(params.get('lizardcam')) || 1.5,
  side: params.get('lizardcam') === 'side', // over the player's shoulder, the player and the lizard both in view
  from: Number(params.get('lizardfrom')) || 2.0,
  lift: params.has('lizardlift') ? Number(params.get('lizardlift')) : null, // camera height over the lizard
  index: params.has('lizardi') ? Number(params.get('lizardi')) : -1, // one spawn by its index (checks only)
  // the side camera: metres behind the player and to one side, and how far from the
  // lizard towards the player it looks (0 at the lizard, 0.5 halfway: a view from the flank)
  back: params.has('lizardback') ? Number(params.get('lizardback')) || 0 : 2.6,
  aside: params.has('lizardaside') ? Number(params.get('lizardaside')) || 0 : 1.3,
  mid: Math.min(1, Math.max(0, Number(params.get('lizardmid')) || 0)),
  sun: params.has('lizardsun') ? params.get('lizardsun') === '1' : null, // one in the sun (1) or the shade (0)
};
const SCARE = params.has('scare') ? params.get('scare').split(',') : null; // [seconds, mode]
const FLEE_HOLD = params.has('fleehold') ? Number(params.get('fleehold')) : -1;
const ACTIVE = MANY ? 120 : 36; // lizards alive near the player
const RADIUS = MANY ? 60 : 35; // metres
const KEEP_BONUS = 0.85; // an active lizard's score is multiplied by this, against churn
const KEEP_IN_VIEW = 0.6; // and by this when it is on screen and near
const RECYCLE = 0.4; // seconds between slot updates
const HOST_CAP = 2, HOST_CAP_BIG = 3; // active lizards on one host (big: a landmark trunk over 0.3 m thick)
const HOST_GAP = 0.6; // metres between active lizards on one host
const GRID = 10; // metres, the spawn grid the slot updates search
// A lizard keeps its slot while the player is dealing with it: frozen, or alert,
// running or peeking from behind its trunk nearby, or wary within 15 m (just released,
// or just back from hiding). One hidden away in the leaves can go.
const busy = (lz) => lz.state === 'frozen' || (lz.dist < RADIUS + 5 && (lz.state === 'alert' || lz.state === 'flee' || lz.state === 'return' || (lz.state === 'hidden' && !lz.away) || (lz.wary > 0 && lz.state === 'idle' && lz.dist < 15)));
const STATE_COLOURS = {
  idle: 0x4cd964, alert: 0xffcc00, flee: 0xff3b30, hidden: 0x3aa0ff, away: 0x9aa0a6, return: 0xc070ff, frozen: 0xffffff,
};

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export async function build(game) {
  const t0 = performance.now();
  const { data, veg, collision, player, sky, events } = game;
  const T = data.terrain;
  const spawns = data.spawns.spawns;
  const n = spawns.length;

  // the models (anole.js); without it the lizards live unseen
  let renderer = null, anole = null;
  try {
    anole = await import('./anole.js');
    renderer = anole.createAnoleRenderer({ maxPerSpecies: MANY ? 128 : 64 });
  } catch (e) {
    anole = null;
    if (/dynamically imported module|Importing a module script failed|error loading dynamically/i.test(String(e && e.message))) {
      console.info('No anole models yet; the lizards run unseen.');
    } else {
      recordError(e, 'anole');
    }
  }
  if (!renderer) renderer = nullRenderer();

  // the drawn body's extent, for fitting lizards to their perches
  const info = anole && anole.ANOLE_INFO;
  const body = (sp, sex) => {
    const a = info && info[sp], L = SPECIES_INFO[sp] ? SPECIES_INFO[sp].length : 0.38;
    const fem = a ? a.female : 0.85;
    const f = sex === 'm' ? 1 : sex === 'f' ? fem : fem + (1 - fem) * 0.35;
    return a ? { front: a.snoutZ * f, back: a.tailTipZ * f, tail0: a.tailZ0 * f } : { front: 0.34 * L * f, back: -0.66 * L * f, tail0: -0.15 * L * f };
  };
  const perches = buildPerches({ data, veg, collision, body });

  const group = new THREE.Group();
  group.name = 'lizards';
  if (renderer.group) group.add(renderer.group);
  if (FLAGS.view === 'top') group.visible = false; // the layout view shows no animals, like the player and the crocs

  // ---- the shared context each lizard reads (the player, the time of day)
  const head = new THREE.Vector3();
  const C = { px: 0, py: 0, pz: 0, vx: 0, vz: 0, speed: 0, noise: 0, noiseF: 1, fx: 0, fz: -1, hx: 0, hy: 0, hz: 0, hours: 10.5, sunUp: 1, warmth: 0.5, sx: 0, sy: 1, sz: 0 };
  const warmAt = new Float64Array([-99, -2]); // the sky hour and sun height C.warmth was worked out for
  function updateContext() {
    const p = player.position;
    C.px = p.x; C.py = p.y; C.pz = p.z;
    C.vx = player.velocity ? player.velocity.x : 0;
    C.vz = player.velocity ? player.velocity.z : 0;
    C.speed = player.speed;
    C.noise = player.noise;
    C.noiseF = noiseFactor(player.noise);
    C.fx = -Math.sin(player.heading); C.fz = -Math.cos(player.heading);
    player.headPosition(head);
    C.hx = head.x; C.hy = head.y; C.hz = head.z;
    C.hours = sky ? sky.hours ?? 10.5 : 10.5;
    C.sunUp = sky && sky.state ? smooth(0.0, 0.2, sky.sunHeight ?? sky.state.sunDir.y) : 1;
    if (sky && sky.state) { const s = sky.state.sunDir; C.sx = s.x; C.sy = s.y; C.sz = s.z; }
    // the warmth the lizards feel (the day's curve times the sun's height), worked out
    // again only once the sky has moved on, not every frame
    if (Math.abs(C.hours - warmAt[0]) > 0.001 || C.sy !== warmAt[1]) {
      warmAt[0] = C.hours; warmAt[1] = C.sy;
      C.warmth = warmth(C.hours, C.sy);
    }
  }

  // Sunlight on a point, 0..1: the sun's height; what lies along the ray to the sun
  // (the drawn crowns, palm fans, bushes and trunks, so a basking lizard sits where the
  // shadow map draws sun; without the vegetation, the canopy grid with foliage filling
  // each column from THERMAL.crownBase of its height up, each metre of it taking
  // THERMAL.foliage of the light); and for a trunk lizard whether the sun is on its side
  // of the trunk (the far side lies in the trunk's own shade).
  const shade = buildShadeGrid(veg && veg.hosts, THERMAL.drawn);
  // exposureOf(p) reads p.x, y, z, nx, ny, nz (a perch, or the scratch below) and leaves
  // the answer in OUT[0]: the hot callers pass an object and read a typed array, so no
  // number is boxed on the way in or out.
  const OUT = new Float64Array(1);
  const ask = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 };
  function sunExposure(x, y, z, nx = 0, ny = 1, nz = 0) {
    ask.x = x; ask.y = y; ask.z = z; ask.nx = nx; ask.ny = ny; ask.nz = nz;
    exposureOf(ask);
    return OUT[0];
  }
  function exposureOf(p) {
    OUT[0] = 0;
    if (!sky || !sky.state) { OUT[0] = 0.5; return; }
    const s = sky.state.sunDir;
    if (s.y <= 0.01) return;
    const x = p.x, y = p.y, z = p.z, nx = p.nx, ny = p.ny, nz = p.nz;
    let side = 1;
    if (ny < 0.5) {
      const hl = Math.sqrt((nx * nx + nz * nz) * (s.x * s.x + s.z * s.z));
      if (hl > 1e-4) side = smooth(-0.15, 0.45, (nx * s.x + nz * s.z) / hl);
      if (side <= 0) return;
    }
    if (shade) {
      const o = 0.07, R = shade.ray; // off the perch's own surface
      R[0] = x + nx * o; R[1] = y + ny * o; R[2] = z + nz * o; R[3] = s.x; R[4] = s.y; R[5] = s.z;
      shade.along();
      OUT[0] = smooth(0.02, 0.2, s.y) * side * Math.exp(-THERMAL.drawn.loss * R[6]);
      return;
    }
    const TH = THERMAL, lose = 4 / TH.foliage; // past this much crown the sun is gone
    let crown = 0, t = 0.25;
    while (t < 32) {
      const qx = x + s.x * t, qy = y + s.y * t, qz = z + s.z * t;
      const g = T.heightAt(qx, qz);
      if (qy > g + 26) break; // above the tallest crowns
      const step = t < 6 ? 0.5 : 1;
      const c = T.canopyAt(qx, qz);
      if (c > TH.crownMin && qy < g + c && qy > g + TH.crownBase * c && (crown += step) > lose) break;
      t += step;
    }
    OUT[0] = smooth(0.02, 0.2, s.y) * side * Math.exp(-TH.foliage * crown);
  }

  // Each spawn's sunlight at home, refreshed a slice a frame while the sun moves, for
  // the slot weights: sunny homes are about more in the cool of the day, shady ones in
  // the heat.
  const homeExp = new Float32Array(n).fill(0.3);
  let expNext = 0, expDone = true;
  const expSun = new THREE.Vector3(0, -2, 0);
  function refreshHomeExposure(budget) {
    if (!sky || !sky.state) return;
    if (expDone) {
      if (expSun.distanceToSquared(sky.state.sunDir) < 1e-4) return;
      expSun.copy(sky.state.sunDir); expNext = 0; expDone = false;
    }
    const end = Math.min(n, expNext + budget);
    for (let i = expNext; i < end; i++) {
      const h = perches.perches[i];
      if (h.skip) { homeExp[i] = 0; continue; }
      exposureOf(h);
      homeExp[i] = OUT[0];
    }
    expNext = end;
    if (end >= n) expDone = true;
  }
  function thermalWeight(i) {
    const e = homeExp[i], S = THERMAL.slot;
    const cool = 1 - smooth(0.3, 0.6, C.warmth), heat = smooth(0.45, 0.75, C.warmth);
    if (e > THERMAL.sunny) return 1 + cool * (S.sunnyCool - 1) + heat * (S.sunnyHot - 1);
    if (e < THERMAL.shady) return 1 + cool * (S.shadyCool - 1) + heat * (S.shadyHot - 1);
    return 1;
  }

  // ---- lizards, slots and recycling
  const lizards = new Array(n).fill(null);
  const captured = new Uint8Array(n);
  let capturedCount = 0;
  const score = new Float32Array(n);
  const chosen = new Uint32Array(n); // == pass when chosen in this slot update
  let pass = 0;
  const cand = new Int32Array(n); // spawns in reach this pass, sorted by score
  const weight = spawns.map((s) => (SPECIES_INFO[s.sp] ? SPECIES_INFO[s.sp].weight : 1));
  const all = [];
  const slots = [];
  for (let k = 0; k < ACTIVE + 4; k++) slots.push({ routes: [new Route(), new Route()] });
  let pinned = -1;
  let recycleT = 0;
  let focusCam = false; // the ?lizard= close view holds the camera until the player moves

  // A coarse grid of the spawns, so a slot update only looks at the ones in reach.
  let gx0 = Infinity, gz0 = Infinity, gx1 = -Infinity, gz1 = -Infinity;
  for (const s of spawns) { gx0 = Math.min(gx0, s.x); gz0 = Math.min(gz0, s.z); gx1 = Math.max(gx1, s.x); gz1 = Math.max(gz1, s.z); }
  const gnx = Math.max(1, Math.ceil((gx1 - gx0) / GRID) + 1), gnz = Math.max(1, Math.ceil((gz1 - gz0) / GRID) + 1);
  const gStart = new Int32Array(gnx * gnz + 1), gItems = new Int32Array(n);
  {
    const cell = (s) => Math.floor((s.z - gz0) / GRID) * gnx + Math.floor((s.x - gx0) / GRID);
    for (const s of spawns) gStart[cell(s) + 1]++;
    for (let j = 0; j < gnx * gnz; j++) gStart[j + 1] += gStart[j];
    const fill = gStart.slice(0, gnx * gnz);
    spawns.forEach((s, i) => { gItems[fill[cell(s)]++] = i; });
  }

  // Hosts: at most HOST_CAP active lizards on one (HOST_CAP_BIG on a thick landmark
  // trunk), none closer than HOST_GAP to another on the same host. Spawns on the ground
  // or a log have no host. conflicts lists, per spawn, the others too close to it.
  const hostOf = new Int32Array(n).fill(-1), hostCap = [], hostKeys = new Map();
  const bigTrunk = new Set();
  for (const t of (veg && veg.hosts.trunks) || []) if (t.r0 > 0.15 && /^L/.test(t.owner)) bigTrunk.add(t.owner);
  spawns.forEach((s, i) => {
    const h = s.host;
    if (!h || h.t === 'ground' || h.t === 'log') return;
    const key = perches.perches[i].owner;
    if (!hostKeys.has(key)) { hostKeys.set(key, hostCap.length); hostCap.push(bigTrunk.has(key) ? HOST_CAP_BIG : HOST_CAP); }
    hostOf[i] = hostKeys.get(key);
  });
  const hostCount = new Uint8Array(hostCap.length);
  const hostTouched = new Int32Array(ACTIVE * 2 + 8);
  let nTouched = 0;
  const confStart = new Int32Array(n + 1);
  let conf;
  {
    const byHost = new Map();
    spawns.forEach((s, i) => { if (hostOf[i] >= 0) { if (!byHost.has(hostOf[i])) byHost.set(hostOf[i], []); byHost.get(hostOf[i]).push(i); } });
    const lists = Array.from({ length: n }, () => []);
    for (const list of byHost.values()) {
      for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
        const P = perches.perches[list[a]], Q = perches.perches[list[b]];
        if (Math.hypot(P.x - Q.x, P.y - Q.y, P.z - Q.z) < HOST_GAP) { lists[list[a]].push(list[b]); lists[list[b]].push(list[a]); }
      }
    }
    for (let i = 0; i < n; i++) confStart[i + 1] = confStart[i] + lists[i].length;
    conf = new Int32Array(confStart[n]);
    for (let i = 0; i < n; i++) conf.set(lists[i], confStart[i]);
  }
  // Takes spawn i for this pass when its host has room; true when taken.
  function choose(i, force) {
    const h = hostOf[i];
    if (!force && h >= 0) {
      if (hostCount[h] >= hostCap[h]) return false;
      for (let k = confStart[i]; k < confStart[i + 1]; k++) if (chosen[conf[k]] === pass) return false;
    }
    chosen[i] = pass;
    if (h >= 0) {
      if (hostCount[h] === 0 && nTouched < hostTouched.length) hostTouched[nTouched++] = h;
      hostCount[h]++;
    }
    return true;
  }

  const frustum = new THREE.Frustum(), projView = new THREE.Matrix4(), sphere = new THREE.Sphere();
  function inView(x, y, z, r) {
    const cam = game.camera;
    if (!cam || !cam.isPerspectiveCamera) return false;
    cam.updateMatrixWorld();
    projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView);
    sphere.center.set(x, y, z); sphere.radius = r;
    return frustum.intersectsSphere(sphere);
  }

  function lizardOf(i) {
    if (!lizards[i]) lizards[i] = new Lizard(sys, i, spawns[i], perches.perches[i]);
    return lizards[i];
  }

  function activate(i, sneak) {
    if (captured[i] || !slots.length || perches.perches[i].skip) return null;
    const lz = lizardOf(i);
    if (lz.handle) return lz;
    const handle = renderer.add(lz.species, lz.sex);
    if (!handle) return null;
    const slot = slots.pop();
    lz.slot = slot;
    const h = lz.home;
    exposureOf(h);
    lz.setMood(C.hours, C.sunUp, OUT[0], C.warmth);
    const dx = h.x - C.px, dz = h.z - C.pz;
    const seen = dx * dx + dz * dz < 400 && inView(h.x, h.y, h.z, 0.3);
    // one arriving in view slips in from out of sight; the pinned one is never moved for the sun
    lz.activate(handle, slot.routes, C, sneak && seen, i !== pinned);
    all.push(lz);
    return lz;
  }

  function deactivate(lz) {
    if (lz.handle) renderer.remove(lz.handle);
    if (lz.slot) slots.push(lz.slot);
    lz.slot = null;
    lz.deactivate();
    const k = all.indexOf(lz);
    if (k >= 0) { all[k] = all[all.length - 1]; all.pop(); }
  }

  // Re-picks the active lizards: the nearest by distance over encounter weight, the
  // ones already active (above all those in view) kept in preference, busy ones never
  // dropped, and no more than a host's share on any one tree. Allocates nothing.
  function recycle(sneak = true) {
    const px = C.px, pz = C.pz;
    pass++;
    for (let k = 0; k < nTouched; k++) hostCount[hostTouched[k]] = 0;
    nTouched = 0;
    // the spawns in reach, scored
    let m = 0;
    // in the cool of the day a sunny home reaches a little further (THERMAL.slot.reach)
    const far = C.warmth < 0.3 ? RADIUS + (THERMAL.slot.reach || 0) : RADIUS;
    const c0 = Math.max(0, Math.floor((px - far - gx0) / GRID)), c1 = Math.min(gnx - 1, Math.floor((px + far - gx0) / GRID));
    const r0 = Math.max(0, Math.floor((pz - far - gz0) / GRID)), r1 = Math.min(gnz - 1, Math.floor((pz + far - gz0) / GRID));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const j = r * gnx + c;
        for (let k = gStart[j]; k < gStart[j + 1]; k++) {
          const i = gItems[k];
          if (captured[i] || perches.perches[i].skip) continue;
          const s = spawns[i], dx = s.x - px, dz = s.z - pz;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d > RADIUS && (d > far || !(homeExp[i] > THERMAL.sunny))) continue;
          // a lizard wearing a backpack (tagged by the player) is kept in preference,
          // and the sun and the time of day weigh in (thermalWeight)
          score[i] = (lizards[i] && lizards[i].backpack != null ? 0.5 : 1) * thermalWeight(i) * d / weight[i];
          cand[m++] = i;
        }
      }
    }
    // active lizards stay put, most of all the ones in view (no vanishing in sight)
    const cam = game.camera;
    const persp = cam && cam.isPerspectiveCamera;
    if (persp) {
      cam.updateMatrixWorld();
      projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projView);
    }
    for (const lz of all) {
      sphere.center.set(lz.pos.x, lz.pos.y, lz.pos.z); sphere.radius = 0.3;
      const seen = persp && lz.dist < 18 && frustum.intersectsSphere(sphere);
      score[lz.index] *= seen ? KEEP_IN_VIEW : KEEP_BONUS;
    }
    // insertion sort by score (a hundred or two, every 0.4 s)
    for (let a = 1; a < m; a++) {
      const v = cand[a], sv = score[v];
      let b = a - 1;
      while (b >= 0 && score[cand[b]] > sv) { cand[b + 1] = cand[b]; b--; }
      cand[b + 1] = v;
    }
    // the pinned one and busy ones first, then the rest in order, a host's share each
    let taken = 0;
    if (pinned >= 0 && !captured[pinned]) { choose(pinned, true); taken++; }
    for (const lz of all) if (busy(lz) && chosen[lz.index] !== pass) { choose(lz.index, true); taken++; }
    for (let k = 0; k < m && taken < ACTIVE; k++) {
      const i = cand[k];
      if (chosen[i] === pass) continue;
      if (choose(i, false)) taken++;
    }
    for (let k = all.length - 1; k >= 0; k--) {
      const lz = all[k];
      if (chosen[lz.index] !== pass) deactivate(lz);
    }
    if (pinned >= 0 && chosen[pinned] === pass && !(lizards[pinned] && lizards[pinned].handle)) activate(pinned, false);
    for (let k = 0; k < m && all.length < ACTIVE; k++) {
      const i = cand[k];
      if (chosen[i] !== pass || (lizards[i] && lizards[i].handle)) continue;
      activate(i, sneak);
    }
    countStats();
  }

  // ---- stats (updated with the slots, so reading them allocates nothing)
  const stats = {
    active: 0, visible: 0, capacity: ACTIVE, radius: RADIUS,
    states: { idle: 0, alert: 0, flee: 0, hidden: 0, return: 0, frozen: 0 },
    // the sun: basking, too hot, in the shade, moving for sun or shade, sheltering out of sight
    thermal: { warmth: 0, bask: 0, hot: 0, shade: 0, moving: 0, shelter: 0 },
    species: Object.fromEntries(SPECIES_ORDER.map((s) => [s, 0])),
    captured: 0,
    perches: perches.stats,
    buildMs: 0,
    renderer: renderer.stats || null,
    models: renderer.isNull ? 'none' : 'anole.js',
  };
  function countStats() {
    stats.active = all.length;
    stats.visible = 0;
    for (const k in stats.states) stats.states[k] = 0;
    for (const k in stats.species) stats.species[k] = 0;
    const th = stats.thermal;
    th.warmth = Math.round(C.warmth * 100) / 100;
    th.bask = th.hot = th.shade = th.moving = th.shelter = 0;
    for (const lz of all) {
      if (lz.visible) stats.visible++;
      if (lz.state in stats.states) stats.states[lz.state]++;
      stats.species[lz.species]++;
      const m = lz.mood;
      if (lz.shelter) th.shelter++;
      else if (lz.visible) {
        if (m.bask) th.bask++;
        if (m.hot) th.hot++;
        if (m.shade > 0.5) th.shade++;
        if (lz.thermal) th.moving++;
      }
    }
    stats.captured = capturedCount;
  }

  // ---- hooks
  const pickResult = { lizard: null, point: new THREE.Vector3() };
  const scratchHit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, kind: 0, tri: -1, w: 0 };
  const trunkList = (veg && veg.hosts.trunks) || [];
  const colour = new THREE.Color();

  // True when a trunk (as a vertical cylinder) stands on the ray between t0 and t1.
  // The triangle index only holds wood near the spawns, so a pick from the camera
  // needs this for the trees in between.
  function trunkOnRay(o, d, t0, t1) {
    const a = d.x * d.x + d.z * d.z;
    if (a < 1e-8) return false;
    for (let k = 0; k < trunkList.length; k++) {
      const tr = trunkList[k];
      const ox = o.x - tr.x, oz = o.z - tr.z, r = tr.r0 * 0.9;
      const b = ox * d.x + oz * d.z, c = ox * ox + oz * oz - r * r;
      const disc = b * b - a * c;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      const ta = (-b - sq) / a, tb = (-b + sq) / a;
      if (tb < t0 || ta > t1) continue;
      const tm = Math.max(ta, t0), ym = o.y + d.y * tm, tn = Math.min(tb, t1), yn = o.y + d.y * tn;
      if (Math.max(ym, yn) >= tr.y0 && Math.min(ym, yn) <= tr.y1) return true;
    }
    return false;
  }

  // Per species, what the notebook may show: the record count, the rarity and how the
  // spawns (which follow the field's perch mix) spread over the perch classes. Counted
  // once; no positions leave here.
  const perchBySp = new Map();
  for (const s of spawns) {
    let m = perchBySp.get(s.sp);
    if (!m) perchBySp.set(s.sp, (m = {}));
    m[s.perch] = (m[s.perch] || 0) + 1;
  }

  const sys = {
    group,
    stats,
    all,
    speciesSummary: (sci) => {
      const sp = data.spawns.species && data.spawns.species[sci];
      return { records: sp ? sp.obs : 0, rarity: sp ? sp.rarity : null, perchCounts: { ...(perchBySp.get(sci) || {}) } };
    },
    perches,
    renderer,
    terrain: T,
    C,
    emit: (name, ...args) => events.emit(name, ...args),
    // from anole.js when it is there: the species' display timings and female size
    displayCurve: anole && typeof anole.display === 'function' ? anole.display : null,
    displayLength: anole && typeof anole.displayLength === 'function' ? anole.displayLength : null,
    sizeOf: (sp) => (anole && anole.ANOLE_INFO && anole.ANOLE_INFO[sp] ? anole.ANOLE_INFO[sp].female : 0.85),
    sunExposure,
    hours: () => C.hours,
    warmth: () => C.warmth,
    // 'morning', 'midday' or 'afternoon', for James: by the warmth, but never 'afternoon'
    // (coming back out to bask) while more of the lizards about are still too hot or
    // sheltering than basking
    thermalPhase: () => {
      const ph = thermalPhase(C.hours, C.warmth), th = stats.thermal;
      return ph === 'afternoon' && th.hot + th.shelter > th.bask ? 'midday' : ph;
    },
    spawnCount: n,
    lizard: (i) => lizardOf(i), // the lizard of spawn i (active or not)

    // Keeps one spawn's lizard active whatever the distance (a tutorial, a test).
    pin(i) {
      pinned = i;
      updateContext();
      if (!lizards[i] || !lizards[i].handle) {
        if (!slots.length) {
          let far = null;
          for (const o of all) if (!busy(o) && (!far || o.dist > far.dist)) far = o;
          if (far) deactivate(far);
        }
        activate(i, false);
      }
      countStats();
      return lizards[i];
    },
    unpin() { pinned = -1; },

    // The nearest active lizard to pos within maxDist, optionally filtered.
    nearest(pos, maxDist = Infinity, filter = null) {
      let best = maxDist, out = null;
      for (const lz of all) {
        if (lz.state === 'captured') continue;
        if (filter && !filter(lz)) continue;
        const dx = lz.pos.x - pos.x, dy = lz.pos.y - pos.y, dz = lz.pos.z - pos.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < best) { best = d; out = lz; }
      }
      return out;
    },

    // The first lizard a ray meets within maxDist, not through wood. The result object
    // is reused between calls.
    pick(ray, maxDist = 30, throughWood = false) {
      const o = ray.origin, d = ray.direction;
      let best = maxDist, bl = null;
      for (const lz of all) {
        if (!lz.visible) continue;
        const L = lz.length, u = lz.upS;
        const cx = lz.pos.x + u.x * 0.05 * L, cy = lz.pos.y + u.y * 0.05 * L, cz = lz.pos.z + u.z * 0.05 * L;
        // one in the shade is a smaller target (harder to spot)
        const R = (0.3 * L + 0.04) * (1 - (1 - THERMAL.shade.pick) * lz.mood.shade);
        const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
        const b = ox * d.x + oy * d.y + oz * d.z;
        const c = ox * ox + oy * oy + oz * oz - R * R;
        const disc = b * b - c;
        if (disc < 0) continue;
        let t = -b - Math.sqrt(disc);
        if (t < 0) t = -b + Math.sqrt(disc);
        if (t < 0 || t >= best) continue;
        if (!throughWood) {
          // the whole way from the eye (or the last 12 m of it) against drawn wood, and
          // against every trunk short of the lizard's own perch
          const back = Math.min(t, 12);
          const sx = o.x + d.x * (t - back), sy = o.y + d.y * (t - back), sz = o.z + d.z * (t - back);
          if (back > 0.08 && perches.index.blocked(sx, sy, sz, d.x, d.y, d.z, back - 0.06, scratchHit)) continue;
          if (t > 0.3 && trunkOnRay(o, d, 0, t - 0.12 - 0.3 * L)) continue;
        }
        best = t; bl = lz;
      }
      if (!bl) return null;
      pickResult.lizard = bl;
      pickResult.point.copy(d).multiplyScalar(best).add(o);
      return pickResult;
    },

    // Calls fn(lizard) for each shown lizard inside the camera's view.
    forEachVisible(camera, fn) {
      camera.updateMatrixWorld();
      projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projView);
      for (const lz of all) {
        if (!lz.visible) continue;
        sphere.center.set(lz.pos.x, lz.pos.y, lz.pos.z);
        sphere.radius = 0.5 * lz.length;
        if (frustum.intersectsSphere(sphere)) fn(lz);
      }
    },

    capture(lz) {
      if (lz.state === 'captured') return false;
      if (lz.handle) deactivate(lz);
      lz.state = 'captured';
      lz.captured = true;
      lz.display = null;
      if (!captured[lz.index]) capturedCount++;
      captured[lz.index] = 1;
      countStats();
      return true;
    },

    // A CSS colour string as a number, for setBackpack (converted once, not per frame).
    colourNumber(css) { return colour.set(css).getHex(); },

    // Back into the world: from (x, y, z) it runs for its home tree and turns up on
    // its perch shortly after; without a point it is simply back on its perch. Wary
    // for a while either way.
    release(lz, x, y, z) {
      if (captured[lz.index]) capturedCount--;
      captured[lz.index] = 0;
      lz.captured = false;
      if (lz.state === 'captured') lz.state = 'inactive';
      updateContext();
      if (!lz.handle) {
        if (!slots.length) {
          // make room: the farthest lizard that is not busy
          let far = null;
          for (const o of all) if (!busy(o) && (!far || o.dist > far.dist)) far = o;
          if (far) deactivate(far);
        }
        if (!activate(lz.index, false)) return false;
      }
      lz.goHome();
      lz.state = 'idle';
      lz.wary = AWARENESS.waryTime;
      if (Number.isFinite(x) && Number.isFinite(z)) lz.runHomeFrom(x, z);
      countStats();
      return true;
    },

    update(dt, t) {
      updateContext();
      if (pinned >= 0 && lizards[pinned] && lizards[pinned].tame && player.speed > 0.3 && game.time > 2) {
        lizards[pinned].tame = false;
        if (focusCam && !SCARE) { focusCam = false; game.rig.enabled = true; game.rig.snap(); }
      }
      refreshHomeExposure(24);
      recycleT -= dt;
      if (recycleT <= 0) { recycle(true); recycleT = RECYCLE; }
      for (let k = 0; k < all.length; k++) {
        const lz = all[k];
        lz.expT -= dt;
        if (lz.expT <= 0) {
          lz.expT = 5;
          ask.x = lz.pos.x; ask.y = lz.pos.y; ask.z = lz.pos.z; ask.nx = lz.nrm.x; ask.ny = lz.nrm.y; ask.nz = lz.nrm.z;
          exposureOf(ask);
          lz.setMood(C.hours, C.sunUp, OUT[0], C.warmth);
          if (lz.index !== pinned) lz.thermalMove(C); // into the sun or the shade
        }
        lz.update(dt, t, C);
        // ?fleehold: the check image of a lizard mid-escape
        if (FLEE_HOLD >= 0 && lz.index === pinned && lz.state === 'flee' && lz.route && lz.along >= FLEE_HOLD * lz.route.length) lz.speed = 0;
      }
      if (renderer.update) renderer.update(dt, t);
      aimHint();
      // nothing is drawn in the top view, so the budget figures say so
      if (!group.visible && renderer.stats) { renderer.stats.drawCalls = 0; renderer.stats.triangles = 0; }
      // the ?lizard= close view: no cut-out, so the perch in front of the player stays whole
      if (focusCam && !FOCUS_OPTS.side) vegUniforms.uVegCut.value = 0;
      if (markers) markers.update();
    },
  };

  // The creep camera leans towards the nearest shown lizard ahead of a creeping player
  // (within 6 m and in front), through rig.hint.
  const hintPoint = new THREE.Vector3();
  function aimHint() {
    const rig = game.rig;
    if (!rig || !('hint' in rig)) return;
    if (player.mode !== 'creep' && player.crouch < 0.5) { rig.hint = null; return; }
    let best = null, bd = 36;
    for (const lz of all) {
      if (!lz.visible) continue;
      const dx = lz.pos.x - C.px, dz = lz.pos.z - C.pz, d2 = dx * dx + dz * dz;
      if (d2 >= bd || d2 < 0.04) continue;
      if ((dx * C.fx + dz * C.fz) / Math.sqrt(d2) < 0.3) continue;
      bd = d2; best = lz;
    }
    if (best) { hintPoint.set(best.pos.x, best.pos.y, best.pos.z); rig.hint = hintPoint; } else rig.hint = null;
  }

  // ---- first population, the ?lizard= view and the debug markers
  updateContext();
  if (FOCUS && SPECIES_INFO[FOCUS]) {
    try { focusOn(FOCUS, FOCUS_OPTS); } catch (e) { recordError(e, 'lizards focus'); }
  }
  recycle(false);
  events.on('player:teleport', () => { updateContext(); recycle(false); });

  // A croc's snap sends every lizard near it running for cover.
  events.on('croc:snap', (e) => {
    const r = (e && e.radius) || 10;
    for (const lz of all) {
      if (Math.hypot(lz.pos.x - e.x, lz.pos.z - e.z) < r) lz.bolt(e.x, e.z);
    }
  });

  // ?lizard=<species>: the player stands about 2 m from the nearest one of that species
  // that can be seen, facing it, and the camera looks at it from 1.5 m, beside the
  // player, until the player moves. opts: perch (bark, branch, leaf, ground, log), nth
  // (skip the first ones that fit), cam and from (the camera's and the player's distance),
  // side (the camera over the player's shoulder instead), lift (the camera's height).
  function focusOn(sp, opts) {
    const px = player.position.x, pz = player.position.z;
    const want = opts.perch ? SURF_MODE[opts.perch] : 0;
    const cand = [];
    spawns.forEach((s, i) => {
      const h = perches.perches[i];
      if (s.sp === sp && h.snapped && !h.skip && (!want || h.mode === want) && (opts.index < 0 || opts.index === i)) {
        if (opts.sun !== null) {
          const e = sunExposure(h.x, h.y, h.z, h.nx, h.ny, h.nz);
          if (opts.sun ? e < THERMAL.sunny + 0.1 : e > THERMAL.shady) return;
        }
        cand.push([Math.hypot(s.x - px, s.z - pz), i]);
      }
    });
    cand.sort((a, b) => a[0] - b[0]);
    const hit = perches.hit;
    const mounds = (veg && veg.hosts.mounds) || [];
    const clear = (ax, ay, az, bx, by, bz) => {
      const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
      if (perches.index.cast(ax, ay, az, dx / L, dy / L, dz / L, L, perches.ANY, -1, hit, 0.06)) return false;
      for (const m of mounds) { // the round bushes, as spheroids
        for (let k = 1; k < 10; k++) {
          const s = k / 10, x = ax + dx * s, y = ay + dy * s, z = az + dz * s;
          if (((x - m.x) / m.r) ** 2 + ((z - m.z) / m.r) ** 2 + ((y - m.y) / Math.max(0.2, m.h)) ** 2 < 1) return false;
        }
      }
      return true;
    };
    const camD = opts.cam, from = opts.from;
    const view = { cx: 0, cy: 0, cz: 0, tx: 0, ty: 0, tz: 0 };
    // Where the camera goes for a lizard at h with the player at (sx, sz); false when
    // leaves or wood are in the way.
    const place = (h, sx, sz, out, da) => {
      const eye = (cx, cz, lift) => {
        const gy = T.heightAt(cx, cz);
        if (T.isWater(cx, cz) && !T.isWalkable(cx, cz) && gy > h.y) return false;
        view.cx = cx; view.cz = cz;
        view.cy = Math.max(Math.max(gy, 0) + 0.5, h.y + lift);
        return clear(h.x + h.nx * 0.08, h.y + h.ny * 0.08, h.z + h.nz * 0.08, view.cx, view.cy, view.cz);
      };
      if (opts.side) {
        // over the player's shoulder (back metres behind, aside to one side), looking at
        // the lizard, or at a point mid of the way from it to the player's chest
        const ux = (sx - h.x) / from, uz = (sz - h.z) / from;
        const gy = Math.max(T.heightAt(sx, sz), 0), m = opts.mid;
        view.tx = h.x + (sx - h.x) * m; view.ty = h.y + (gy + 1.0 - h.y) * m; view.tz = h.z + (sz - h.z) * m;
        const b = opts.back, a = opts.aside;
        for (const sg of [1, -1]) {
          if (eye(sx + ux * b - uz * a * sg, sz + uz * b + ux * a * sg, opts.lift ?? gy + 2.0 - h.y)) return true;
        }
        return false;
      }
      // camD from the lizard, off to the side of the player, a little above it
      const ca = out + (da >= 0 ? 1 : -1) * Math.min(0.55, Math.abs(da) + 0.3);
      const lift = opts.lift ?? (h.mode === SURF.LEAF || h.mode === SURF.GROUND ? 0.3 * camD : 0.17 + 0.12 * camD); // look down onto leaves and the ground
      view.tx = h.x; view.ty = h.y + 0.05; view.tz = h.z;
      return eye(h.x + Math.cos(ca) * camD, h.z + Math.sin(ca) * camD, lift);
    };
    let skip = opts.nth;
    for (const [, i] of cand.slice(0, 120)) {
      const h = perches.perches[i];
      const above = h.y - T.heightAt(h.x, h.z);
      if (!want && (above > 2.4 || h.mode === SURF.LEAF)) continue;
      if (opts.side && (above < 0.5 || above > 1.6)) continue; // about chest height, so the player shows too
      const out = h.mode === SURF.BARK ? Math.atan2(h.nz, h.nx) : Math.atan2(h.fz, h.fx) + Math.PI / 2;
      let found = false;
      for (const d of opts.side ? [from] : [from, from + 0.4, from - 0.3]) {
        for (const da of opts.side ? [0, 0.3, -0.3] : [0, 0.4, -0.4, 0.8, -0.8, 1.3, -1.3, 1.9, -1.9, Math.PI]) {
          const sx = h.x + Math.cos(out + da) * d, sz = h.z + Math.sin(out + da) * d;
          if (!collision.isFree(sx, sz)) continue;
          if (d > 2.5 && !walkableLine(sx, sz, h.x, h.z, d - 1.2)) continue; // room to walk up to it
          if (!place(h, sx, sz, out, da)) continue;
          found = true;
          if (skip > 0) break;
          const heading = Math.atan2(-(h.x - sx), -(h.z - sz));
          player.teleport(sx, sz, heading);
          if (Math.hypot(player.position.x - sx, player.position.z - sz) > 0.3) { found = false; continue; }
          pinned = i;
          updateContext();
          const lz = activate(i, false);
          if (lz) lz.tame = true;
          if (!FLAGS.cam && game.rig && game.camera.isPerspectiveCamera) {
            game.rig.enabled = false;
            game.camera.position.set(view.cx, view.cy, view.cz);
            game.camera.lookAt(view.tx, view.ty, view.tz);
            focusCam = true;
          }
          if (SCARE) scareFrom(lz, Number(SCARE[0]) || 2, SCARE[1] || 'walk');
          return i;
        }
        if (found) break;
      }
      if (found) skip--;
    }
    return -1;
  }

  // True when the player can walk len metres from (x0, z0) towards (x1, z1).
  function walkableLine(x0, z0, x1, z1, len) {
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1;
    for (let s = 0.25; s <= len; s += 0.25) {
      if (!collision.isFree(x0 + (dx / l) * s, z0 + (dz / l) * s)) return false;
    }
    return true;
  }

  // ?scare: from s seconds in, the player walks (creeps, jogs) straight at the focused
  // lizard until it runs, through the ordinary input, so the avatar walks too.
  function scareFrom(lz, s, mode) {
    if (!lz) return;
    let done = false;
    game.input.addSource((f) => {
      if (done || game.time < s) return;
      if (lz.tame) lz.tame = false;
      if (lz.state === 'flee' || lz.state === 'hidden' || lz.dist < 1.0) { done = true; return; }
      const p = player.position;
      let dx = lz.pos.x - p.x, dz = lz.pos.z - p.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      const sy = Math.sin(player.moveYaw), cy = Math.cos(player.moveYaw);
      f.move.x += cy * dx - sy * dz; // the stick that walks the player along (dx, dz)
      f.move.y += -(sy * dx + cy * dz);
      if (mode === 'creep') f.held.creep = true;
      if (mode === 'jog') f.held.jog = true;
    });
  }

  // ?debug=lizards: a marker per state; ?debug=sun: coloured by sunlight instead (blue
  // shade to yellow sun, orange when too hot, white while sheltering)
  const SUN_MARKERS = !!(FLAGS.debug && FLAGS.debug.has('sun'));
  const markers = FLAGS.debug && (FLAGS.debug.has('lizards') || SUN_MARKERS) ? makeMarkers() : null;
  function makeMarkers() {
    const geo = new THREE.OctahedronGeometry(0.07, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, fog: false, transparent: true, opacity: 0.95 });
    const mesh = new THREE.InstancedMesh(geo, mat, ACTIVE + 8);
    const cap = ACTIVE + 8;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = 12;
    mesh.name = 'lizard-state-markers';
    const col = new THREE.Color(), m = new THREE.Matrix4();
    for (let k = 0; k < mesh.count; k++) mesh.setColorAt(k, col.set(0xffffff));
    group.add(mesh);
    const el = document.createElement('div');
    el.className = 'debug-readout';
    el.style.cssText = 'top:auto;bottom:12px;right:12px;left:auto';
    document.getElementById('ui')?.appendChild(el);
    let acc = 0;
    return {
      update() {
        let k = 0;
        const cp = game.camera.position;
        for (const lz of all) {
          if (k >= cap) break;
          // about the same size on screen near and far
          const sc = Math.max(1, 0.09 * Math.hypot(lz.pos.x - cp.x, lz.pos.y - cp.y, lz.pos.z - cp.z));
          const lift = 0.12 + 0.3 * lz.length + 0.05 * sc;
          m.makeScale(sc, sc, sc).setPosition(lz.pos.x, lz.pos.y + lift, lz.pos.z);
          mesh.setMatrixAt(k, m);
          const key = lz.state === 'hidden' && lz.away ? 'away' : lz.state;
          if (SUN_MARKERS) {
            if (lz.shelter) col.set(0xffffff);
            else if (lz.mood.hot) col.set(0xff6a00);
            else col.setRGB(0.15 + 0.85 * lz.exposure, 0.3 + 0.6 * lz.exposure, 1 - 0.9 * lz.exposure);
            mesh.setColorAt(k, col);
          } else mesh.setColorAt(k, col.set(STATE_COLOURS[key] ?? 0xff00ff));
          k++;
        }
        mesh.count = k;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        if (++acc % 15 === 0) {
          countStats();
          const s = stats.states;
          el.textContent = `lizards ${stats.active} (${stats.visible} shown)  idle ${s.idle}  alert ${s.alert}  flee ${s.flee}  hidden ${s.hidden}  return ${s.return}`;
        }
      },
    };
  }

  stats.buildMs = Math.round(performance.now() - t0);
  return sys;
}

// Handles with nothing drawn, while anole.js is not there.
function nullRenderer() {
  const free = [];
  return {
    isNull: true,
    group: null,
    stats: { drawCalls: 0 },
    add() {
      return free.pop() || {
        position: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), forward: new THREE.Vector3(0, 0, 1),
        scale: 1, gait: 0, gaitPhase: 0, headYaw: 0, headPitch: 0, bob: 0, pushup: 0, dewlap: 0,
        tailCurl: 0, flatten: 0, gape: 0, tint: 0, visible: true, backpack: null,
      };
    },
    remove(h) { if (h) free.push(h); },
    update() {},
  };
}


// What casts the drawn shade, for sunExposure: the crowns, palm fans and bushes of
// veg.hosts as ellipsoids (a little inside their outlines, D from THERMAL.drawn) and the
// trunks as upright cylinders, filed in a 3 m grid. along() walks the ray in ray[0..5]
// (the point, then the direction to the sun) and leaves in ray[6] the metres of it inside
// any of them. Typed arrays and no numbers passed to calls, so nothing is allocated; null
// without the vegetation.
function buildShadeGrid(hosts, D) {
  if (!hosts || !D) return null;
  const list = []; // [type, cx, cy, cz, a, b, c]: 0 ellipsoid (1/rx, 1/ry, 1/rz), 1 cylinder (r^2, y0, y1)
  for (const c of hosts.crowns || []) list.push([0, c.cx, c.cy, c.cz, c.rx * D.crown, c.ry * D.crown, c.rz * D.crown]);
  for (const c of hosts.palms || []) list.push([0, c.cx, c.cy, c.cz, c.r * D.palm, c.r * D.palm * D.palmFlat, c.r * D.palm]);
  for (const m of hosts.mounds || []) list.push([0, m.x, m.y, m.z, m.r * D.mound, m.h * D.mound, m.r * D.mound]);
  for (const t of hosts.trunks || []) list.push([1, t.x, t.y0, t.z, Math.max(t.r0, t.r1), t.y0, t.y1]);
  if (!list.length) return null;
  const CELL = 3;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, top = -Infinity;
  const reach = (e) => e[0] === 0 ? Math.max(e[4], e[6]) : e[4];
  for (const e of list) {
    const r = reach(e);
    x0 = Math.min(x0, e[1] - r); x1 = Math.max(x1, e[1] + r);
    z0 = Math.min(z0, e[3] - r); z1 = Math.max(z1, e[3] + r);
    top = Math.max(top, e[0] === 0 ? e[2] + e[5] : e[6]);
  }
  const nx = Math.ceil((x1 - x0) / CELL) + 1, nz = Math.ceil((z1 - z0) / CELL) + 1;
  const cells = Array.from({ length: nx * nz }, () => []);
  list.forEach((e, k) => {
    const r = reach(e);
    const i0 = Math.floor((e[1] - r - x0) / CELL), i1 = Math.floor((e[1] + r - x0) / CELL);
    const j0 = Math.floor((e[3] - r - z0) / CELL), j1 = Math.floor((e[3] + r - z0) / CELL);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cells[j * nx + i].push(k);
  });
  const start = new Int32Array(nx * nz + 1);
  let total = 0;
  cells.forEach((c, i) => { start[i] = total; total += c.length; });
  start[nx * nz] = total;
  const items = new Int32Array(total);
  cells.forEach((c, i) => items.set(c, start[i]));
  const B = new Float32Array(list.length * 7);
  list.forEach((e, k) => {
    const o = k * 7;
    B[o] = e[0]; B[o + 1] = e[1]; B[o + 2] = e[2]; B[o + 3] = e[3];
    if (e[0] === 0) { B[o + 4] = 1 / e[4]; B[o + 5] = 1 / e[5]; B[o + 6] = 1 / e[6]; } else { B[o + 4] = e[4] * e[4]; B[o + 5] = e[5]; B[o + 6] = e[6]; }
  });
  const ray = new Float64Array(7);
  return {
    count: list.length,
    ray,
    along() {
      const x = ray[0], y = ray[1], z = ray[2], sx = ray[3], sy = ray[4], sz = ray[5];
      let m = 0, t = 0.3;
      while (t < 45) {
        const step = t < 4 ? 0.25 : 0.4;
        const qx = x + sx * t, qy = y + sy * t, qz = z + sz * t;
        if (qy > top) break; // above every crown
        t += step;
        const i = Math.floor((qx - x0) / CELL), j = Math.floor((qz - z0) / CELL);
        if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
        const c = j * nx + i;
        let hit = false;
        for (let k = start[c], end = start[c + 1]; k < end && !hit; k++) {
          const o = items[k] * 7;
          if (B[o] === 0) {
            const dx = (qx - B[o + 1]) * B[o + 4], dy = (qy - B[o + 2]) * B[o + 5], dz = (qz - B[o + 3]) * B[o + 6];
            hit = dx * dx + dy * dy + dz * dz < 1;
          } else if (qy >= B[o + 5] && qy <= B[o + 6]) {
            const dx = qx - B[o + 1], dz = qz - B[o + 3];
            hit = dx * dx + dz * dz < B[o + 4];
          }
        }
        if (hit && (m += step) > 3) break; // the sun is gone
      }
      ray[6] = m;
    },
  };
}
