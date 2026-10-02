// The brown basilisks (Basiliscus vittatus), as one optional system (game.basilisks): the
// 11 sites of data/basilisks.json, a few of them about on each survey day. One rests on
// open ground by the water near its site; startled, it rears up and sprints on its hind
// legs for the nearest water, runs across it with little splashes and a patter of feet,
// and stops on the far bank or a mud islet; a minute or so later, once nobody is looking,
// it is back home. While one runs, the anoles on the ground near it run for their trunks.
//
// To the catch a basilisk is a lizard like any other (game.lizards.guests: the loop pole
// locks on to it, the spotter spots it): species 'basilisk', sex, perch 'ground', state,
// visible, display, tag, headPosition(v), freeze(), unfreeze(), capture(), release(x, y,
// z), bolt(), setBackpack(colour) (the GPS backpack on its back) and trailAt(hours) (where
// a backpacked one is by the clock: catching.js logs its fixes from it). After the snug it
// bolts for the water on the loop (sprint(), from catching.js): the player is pulled
// along behind it and steers it away with [A] and [D]
// (or the stick); it tires once it has been kept off the water long enough, and a clear
// tell comes before it can reach the water, where it runs off across it and is gone.
//
// Each basilisk is its own skinned mesh and outline (basilisk_model.js), drawn only within
// BASILISK.show metres; they are built at load with a random source of their own, as is
// every draw here, so the island's own random draws run on exactly as without them.
//
// Events: lizard:alert, lizard:flee, lizard:display (as the anoles), basilisk:patter
// (x, z) for each patter of feet on the water, basilisk:waterrun { basilisk, first } once a
// run across the water has been watched for 0.6 s (first: the season's first),
// basilisk:landed { basilisk, x, z }.
//
// URL flags: ?basilisks=all (every site about, not a day's few), ?basiliskseed=n (fix
// the day's draws; by default they follow the clock).

import * as THREE from 'three';
import { FLAGS, CONFIG } from '../config.js';
import { recordError } from '../debug.js';
import { state } from '../game/state.js';
import * as kit from '../ui/kit.js';
import { makeRng } from '../world/models.js';
import { noiseFactor } from '../lizards/species.js';
import { trueSvl } from '../catch/tuning.js';
import { SURF } from '../lizards/perches.js';
import { basiliskGeometry, makeBasilisk } from './basilisk_model.js';

export const BASILISK = {
  roster: 4, // about on a survey day, of the sites
  show: 45, // drawn within this many metres of the player
  fid: 3.6, // runs from a player walking at it this close (m); creeping 0.58 of it, running 2.2 times
  alertRatio: 1.6, // watches the player from this many times that
  sensitise: 1.3, // and is this much jumpier while it watches
  settle: 2.2, // seconds of a still player before it settles (each time a little bolder)
  rear: 0.3, // seconds on four legs before it rears up
  land: 4.0, water: 3.3, // m/s on two legs
  away: [35, 70], // seconds on the far side before it may slip home, out of sight
  scatter: 5, // ground anoles this near a running basilisk run for their trunks
  display: { m: 0.6, f: 0.2 }, // head bobs a minute
  // on the loop: its pull (m/s), how fast it turns for the water and the player turns it
  // (rad/s), how much it shies from the player (a player between it and the water turns it
  // inland), the tether, how long it must be kept off the water (s, at full credit), the
  // longest a fight runs, the tell (s) before it can reach the water, how near the water
  // ahead the tell starts (m, about 1.1 s at its pace) and how much harder the player turns
  // it while the water is that near
  fight: { speed: 1.6, pull: 1.7, steer: 3.4, shy: 1.3, tether: 2.2, tire: 2.2, most: 9, tell: 0.6, warn: 1.8, grip: 1.6 },
};

const WORDS = {
  bolt: 'It\'s off! Keep it away from the water: [A] and [D].',
  tell: 'Nearly at the water! Pull it round!',
  tired: 'It\'s tired itself out. Lift!',
  escape: 'Splash! It reached the water and ran clean across the lake.',
};

const TAU = Math.PI * 2;
const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const params = new URLSearchParams(location.search);
const ALL = params.get('basilisks') === 'all';

// three.js takes every object's id from Math.random: the meshes are built with a local
// source instead, so the rest of the island draws exactly the same numbers as before
function quietly(rng, fn) {
  const keep = Math.random;
  Math.random = rng;
  try { return fn(); } finally { Math.random = keep; }
}

export async function build(game) {
  const { data, player, events } = game;
  const T = data.terrain, bits = T.bits;
  let doc;
  try {
    const r = await fetch(CONFIG.dataBase + 'basilisks.json');
    if (!r.ok) throw new Error('basilisks.json: HTTP ' + r.status);
    doc = await r.json();
  } catch (e) {
    recordError(e, 'basilisks');
    return null;
  }
  const seed = params.has('basiliskseed') ? Number(params.get('basiliskseed')) : (Date.now() & 0xffff);

  // ---- where each one lives: open ground near its home, the water it runs for, and
  // the far bank or mud islet a run across that water ends on
  const M = (x, z) => T.maskAt(x, z);
  const wet = (x, z) => (M(x, z) & bits.water) !== 0 && !T.isWalkable(x, z);
  const walk = (x, z) => T.isWalkable(x, z);
  const ring = (x, z, r, test) => test(x + r, z) && test(x - r, z) && test(x, z + r) && test(x, z - r);
  const toW = game.terrain && game.terrain.fields && game.terrain.fields.toWater;
  const toWater = (x, z) => { const i = T.cellIndex(x, z); return i < 0 || !toW ? 9 : toW[i]; };
  // clear of the trunks and bushes (the fixed collider circles), with r to spare
  const C = game.collision;
  const clear = (x, z, r) => {
    if (!C) return true;
    let ok = true;
    C.forEachCircleNear(x, z, (k) => { const dx = x - C.cx[k], dz = z - C.cz[k], R = C.cr[k] + r; if (dx * dx + dz * dz < R * R) ok = false; });
    return ok;
  };
  const open = (x, z) => walk(x, z) && ring(x, z, 0.5, walk) && clear(x, z, 0.4);
  function nearest(x, z, R, test) {
    let best = null, bd = Infinity;
    const n = Math.ceil(R / T.cell);
    for (let j = -n; j <= n; j++) {
      for (let i = -n; i <= n; i++) {
        const px = x + i * T.cell, pz = z + j * T.cell, d = Math.hypot(px - x, pz - z);
        if (d > R || d >= bd || !test(px, pz)) continue;
        bd = d; best = { x: px, z: pz, d };
      }
    }
    return best;
  }
  // the first land a run from (x, z) along a reaches after at least minWet metres of
  // water: a far bank or a mud islet (land that is not the island's own open ground)
  function across(x, z, a, minWet = 3, far = 40) {
    let w = 0;
    for (let t = 0.25; t < far; t += 0.25) {
      const px = x + Math.cos(a) * t, pz = z + Math.sin(a) * t;
      if (wet(px, pz)) { w += 0.25; continue; }
      const m = M(px, pz);
      if (w >= minWet && !walk(px, pz) && (m & (bits.bank | bits.fringe)) && !(m & bits.water)) return { x: px, z: pz, t };
      return null;
    }
    return null;
  }
  // a landing for a run from the water's edge at (x, z) heading along a: the best of a
  // fan of headings round it, as near straight on as it can be and a good run (about 7 m)
  function landingFrom(x, z, a) {
    let best = null, bs = Infinity;
    for (let k = 0; k < 25; k++) {
      const da = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.122;
      const hit = across(x, z, a + da);
      if (!hit) continue;
      const s = Math.abs(hit.t - 7) + Math.abs(da) * 5;
      if (s < bs) { bs = s; best = hit; }
    }
    return best;
  }

  const modelRng = makeRng(0x6a5117);
  const group = quietly(modelRng, () => new THREE.Group());
  group.name = 'basilisks';
  if (FLAGS.view === 'top') group.visible = false;
  const all = [];
  // the loop pole and the spotter find them through the lizards' guests
  const guests = (game.lizards && game.lizards.guests) || [];

  // open ground a few metres up from the water, so there is room to come between it and
  // the water
  const byWater = (x, z) => open(x, z) && toWater(x, z) >= 2.4 && toWater(x, z) <= 4.5;
  doc.sites.forEach((site, i) => {
    try {
      const [hx, hz] = site.home;
      // (two sites are well inland, with no such ground near: those rest on the nearest
      // open ground and have a long dash until caught, and then settle by the water they
      // ran for, on `shore`)
      const rest = nearest(hx, hz, 7, byWater)
        || nearest(hx, hz, 6, open)
        || nearest(hx, hz, 6, (x, z) => !wet(x, z) && !T.isThicket(x, z)) || { x: hx, z: hz };
      const entry = nearest(rest.x, rest.z, 26, (x, z) => wet(x, z) && ring(x, z, 0.4, wet)) || { x: site.water[0], z: site.water[1] };
      const a0 = Math.atan2(entry.z - rest.z, entry.x - rest.x);
      const landing = landingFrom(entry.x, entry.z, a0);
      const shore = toWater(rest.x, rest.z) > 5 ? nearest(entry.x, entry.z, 8, byWater)
        || nearest(entry.x, entry.z, 8, (x, z) => open(x, z) && toWater(x, z) >= 1.5 && toWater(x, z) <= 3.5) : null;
      all.push(makeOne(i, site, rest, entry, landing, shore));
    } catch (e) { recordError(e, 'basilisk site ' + i); }
  });

  // its rest spot, facing along the shore with its back to the water more or less
  function restAt(b, p) {
    const H = b.home;
    H.x = p.x; H.z = p.z; H.y = Math.max(0, T.heightAt(p.x, p.z));
    b.restHeading = wrap(Math.atan2(-(b.entry.x - p.x), -(b.entry.z - p.z)) + Math.PI + b.turn);
  }

  // ---- one basilisk
  function makeOne(i, site, rest, entry, landing, shore) {
    const own = makeRng(0xba5 + i * 7919);
    const sex = own() < 0.5 ? 'm' : 'f';
    const b = {
      species: 'basilisk', sex, perch: 'ground', index: 2000 + i, site: i,
      state: 'off', display: null, tag: null, backpack: null, captured: false, tame: false, threat: 0,
      mood: { shade: 0 }, rng: own,
      home: { x: rest.x, y: Math.max(0, T.heightAt(rest.x, rest.z)), z: rest.z, nx: 0, ny: 1, nz: 0, fx: 0, fy: 0, fz: -1, mode: SURF.GROUND },
      entry, landing, shore, rest: { x: rest.x, z: rest.z }, turn: 0,
      pos: { x: rest.x, y: 0, z: rest.z }, nrm: { x: 0, y: 1, z: 0 }, upS: { x: 0, y: 1, z: 0 },
      fwd: { x: 0, y: 0, z: -1 }, fwdS: { x: 0, y: 0, z: -1 },
      heading: 0, restHeading: 0, dist: 99, drawn: false, habit: 1,
      // the run: 'land' to the water, 'water' across it; the target and where it began
      run: null, runT: 0, watchT: 0, watched: false, stepT: 0, patT: 0, scatterT: 0,
      stateT: 0, calmT: 0, awayT: 0, bobT: 0, nextBob: 10,
      fight: null,
      P: { pitch: 0.05, hipY: 0.055, splay: 1, gait: 0, phase: 0, stride: 0, headPitch: 0.12, headYaw: 0, tailLift: 0, tailSway: 0, bob: 0 },
    };
    b.svl = trueSvl(b);
    b.scale = b.svl / 170;
    b.length = 0.6 * b.scale; // the body the loop and the pick go by (the whip tail aside)
    b.turn = (own() - 0.5) * 1.6;
    restAt(b, rest);
    b.heading = b.restHeading;
    b.model = quietly(modelRng, () => makeBasilisk(basiliskGeometry(sex), 'basilisk-' + i));
    b.model.group.visible = false;
    b.model.group.scale.setScalar(b.scale);
    group.add(b.model.group);
    Object.defineProperty(b, 'visible', { get: () => b.drawn && b.state !== 'off' && b.state !== 'captured' });
    Object.defineProperty(b, 'surface', { get: () => 'ground' });
    b.headPosition = (v) => headOf(b, v);
    b.freeze = () => { if (b.state === 'off' || b.state === 'captured') return; b.state = 'frozen'; b.display = null; b.run = null; };
    b.unfreeze = () => { if (b.state === 'frozen') { b.state = 'alert'; b.stateT = 0; b.calmT = 0; } };
    b.capture = () => {
      if (b.state === 'captured') return false;
      b.state = 'captured'; b.captured = true; b.fight = null;
      // one from inland settles by the water once let go, where its GPS day goes
      if (b.shore) restAt(b, b.shore);
      return true;
    };
    b.release = (x, y, z) => {
      b.captured = false;
      b.state = 'idle';
      if (Number.isFinite(x) && Number.isFinite(z)) { b.pos.x = x; b.pos.z = z; b.pos.y = Math.max(0, T.heightAt(x, z)); }
      flee(b);
      return true;
    };
    b.bolt = () => {
      if (b.tame || (b.state !== 'idle' && b.state !== 'alert')) return false;
      flee(b);
      return true;
    };
    b.setBackpack = (colour) => { b.backpack = colour == null ? null : colour; b.model.setPack(b.backpack); };
    b.trailAt = (hours, out) => trailAt(b, hours, out);
    b.sprint = (opts) => sprint(b, opts || {});
    return b;
  }

  // the head, from the pose (the loop pole, the camera and the snug ring look here)
  function headOf(b, v) {
    const s = b.scale, p = b.P.pitch, hy = b.P.hipY;
    const up = hy + 0.04 * Math.cos(p) + 0.27 * Math.sin(p) + 0.012;
    const ahead = 0.27 * Math.cos(p) - 0.04 * Math.sin(p) - 0.1;
    return v.set(b.pos.x + b.fwd.x * ahead * s, b.pos.y + up * s, b.pos.z + b.fwd.z * ahead * s);
  }

  // ---- the day's few
  const live = []; // on today's roster
  function roster() {
    live.length = 0;
    const r = makeRng(seed ^ Math.imul((state.days | 0) + 1, 0x9e3779b1));
    const order = all.map((b) => [r(), b]).sort((a, c) => a[0] - c[0]).map((x) => x[1]);
    for (const b of all) { dropFight(b); b.state = 'off'; b.run = null; b.drawn = false; b.model.group.visible = false; }
    for (const b of ALL ? all : order.slice(0, BASILISK.roster)) {
      live.push(b);
      home(b);
    }
  }
  function home(b) {
    b.state = 'idle';
    b.run = null;
    b.captured = false;
    b.pos.x = b.home.x; b.pos.z = b.home.z; b.pos.y = b.home.y;
    b.heading = b.restHeading;
    b.habit = 1;
    b.stateT = 0; b.calmT = 0; b.display = null;
    b.nextBob = 4 + 20 * b.rng();
  }
  events.on('day:new', roster);
  events.on('state:reset', () => { for (const b of all) { b.tag = null; restAt(b, b.rest); } });
  const on = () => state.phase === 'survey' || ALL;
  if (ALL) roster();

  // ---- running for the water, across it, and the far side
  function flee(b) {
    const entry = nearestEntry(b);
    b.state = 'flee';
    b.display = null;
    b.run = { leg: 'land', tx: entry.x, tz: entry.z, landing: null, t: 0 };
    b.runT = 0; b.watchT = 0; b.watched = false; b.scatterT = 0;
    b.habit = 1;
    events.emit('lizard:flee', b);
  }
  // the water it runs for: the site's own, unless it is somewhere else just now
  const _e = { x: 0, z: 0 };
  function nearestEntry(b) {
    const e = b.entry, d = Math.hypot(e.x - b.pos.x, e.z - b.pos.z);
    if (d < 6 || Math.hypot(b.pos.x - b.home.x, b.pos.z - b.home.z) < 2) return e;
    const n = nearest(b.pos.x, b.pos.z, 12, (x, z) => wet(x, z) && ring(x, z, 0.4, wet));
    if (!n) return e;
    _e.x = n.x; _e.z = n.z;
    return _e;
  }

  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), sph = new THREE.Sphere();
  function inView(x, y, z, r) {
    const cam = game.camera;
    if (!cam || !cam.isPerspectiveCamera) return false;
    sph.center.set(x, y, z); sph.radius = r;
    return frustum.intersectsSphere(sph);
  }

  function runStep(b, dt) {
    const R = b.run;
    R.t += dt;
    b.runT += dt;
    const dx = R.tx - b.pos.x, dz = R.tz - b.pos.z, d = Math.hypot(dx, dz);
    const water = R.leg === 'water';
    const sp = water ? BASILISK.water : b.runT < BASILISK.rear ? 2.2 : BASILISK.land;
    if (d > 1e-3) {
      const want = Math.atan2(-dx, -dz);
      b.heading = wrap(b.heading + wrap(want - b.heading) * Math.min(1, dt * 12));
    }
    const step = Math.min(d, sp * dt);
    if (d > 1e-3) {
      b.pos.x += (dx / d) * step; b.pos.z += (dz / d) * step;
      if (!water) round(b.pos, dx / d, dz / d, step);
    }
    b.pos.y = wet(b.pos.x, b.pos.z) ? 0 : Math.max(0, T.heightAt(b.pos.x, b.pos.z));
    if (d - step > 0.05) return;
    if (!water) {
      // at the water's edge: on across it, to a far bank or a mud islet (the site's own
      // landing from its own water, else the best one ahead)
      const own = Math.hypot(R.tx - b.entry.x, R.tz - b.entry.z) < 0.5 && b.landing;
      const land = own || landingFrom(b.pos.x, b.pos.z, Math.atan2(-Math.cos(b.heading), -Math.sin(b.heading)));
      if (!land) { arrive(b); return; }
      R.leg = 'water'; R.tx = land.x; R.tz = land.z; R.t = 0;
      return;
    }
    arrive(b);
  }
  // round a trunk or bush in the way rather than through it: out to its edge, and along
  // it when running straight at it
  function round(p, ux, uz, step) {
    if (!C) return;
    C.forEachCircleNear(p.x, p.z, (k) => {
      const cx = C.cx[k], cz = C.cz[k], R = C.cr[k] + 0.12;
      let nx = p.x - cx, nz = p.z - cz;
      const d = Math.hypot(nx, nz);
      if (d >= R) return;
      if (d < 1e-6) { nx = -uz; nz = ux; } else { nx /= d; nz /= d; }
      p.x = cx + nx * R; p.z = cz + nz * R;
      const side = ux * nz - uz * nx; // along the edge, the way it was heading
      if (ux * nx + uz * nz < -0.8) { const sg = side > 0 ? -1 : 1; p.x += -nz * sg * step; p.z += nx * sg * step; }
    });
  }
  function arrive(b) {
    b.state = 'across';
    b.run = null;
    b.awayT = BASILISK.away[0] + (BASILISK.away[1] - BASILISK.away[0]) * b.rng();
    events.emit('basilisk:landed', { basilisk: b, x: b.pos.x, z: b.pos.z });
  }

  // ---- its day on a GPS backpack (catching.js logs a fix from trailAt every few seconds).
  // Made up, not tracked: mostly along the shore and the lawn's edge near its rest spot,
  // in the shade through the middle of the day, and a dash across the water to a far bank
  // or islet and back in the morning and the afternoon (where there is one out of the
  // thicket). Every spot is open ground 0.8 to 4 m from the water (the shade up to 6 m),
  // never in the thicket. One from well inland walks the shore by the water it runs for,
  // where it settles once caught.
  const TRAIL = { reach: 9, near: [0.8, 4], shadeR: 8, shadeWater: 6, mid: [11.6, 14.0], dash: 0.5, land: [0.25, 0.75], landR: 6, wet: 3, grid: 0.5 };
  function trailOf(b) {
    if (b.gpsDay) return b.gpsDay;
    const R = TRAIL;
    const a0 = b.shore || b.home;
    // on the fixes' own grid, so a spot is exactly where its fix goes
    const g = TRAIL.grid, a = { x: Math.round(a0.x / g) * g, z: Math.round(a0.z / g) * g };
    // along the shore: across the line from it to its water
    const ux = b.entry.x - a.x, uz = b.entry.z - a.z;
    const ul = Math.hypot(ux, uz) || 1;
    const tx = -uz / ul, tz = ux / ul;
    const bins = new Map();
    let shade = null, sb = -Infinity;
    const n = Math.ceil(R.reach / g);
    for (let j = -n; j <= n; j++) {
      for (let i = -n; i <= n; i++) {
        const x = a.x + i * g, z = a.z + j * g, d = Math.hypot(x - a.x, z - a.z);
        if (d > R.reach || !walk(x, z) || T.isThicket(x, z) || !clear(x, z, 0.25)) continue;
        const w = toWater(x, z);
        if (d <= R.shadeR && w >= R.near[0] && w <= R.shadeWater) {
          const s = T.canopyAt(x, z) - 0.3 * d;
          if (s > sb) { sb = s; shade = { x, z }; }
        }
        if (w < R.near[0] || w > R.near[1]) continue;
        // a spot a metre along the shore, the one nearest 2 m from the water
        const k = Math.round((x - a.x) * tx + (z - a.z) * tz), e = Math.abs(w - 2);
        const was = bins.get(k);
        if (!was || e < was.e) bins.set(k, { x, z, e });
      }
    }
    // the stretch of shore joined to its own spot (gaps of 2 m at most)
    const ks = [...bins.keys()].sort((p, q) => p - q);
    let lo = 0, hi = 0;
    if (ks.length) {
      lo = hi = ks.reduce((m, k) => (Math.abs(k) < Math.abs(m) ? k : m), ks[0]);
      for (const k of ks) if (k > hi && k - hi <= 2) hi = k;
      for (let q = ks.length - 1; q >= 0; q--) if (ks[q] < lo && lo - ks[q] <= 2) lo = ks[q];
    }
    const path = ks.filter((k) => k >= lo && k <= hi).map((k) => bins.get(k));
    if (!path.length) path.push({ x: a.x, z: a.z });
    // where it leaves the shore for the water: the spot nearest its water
    let edge = path[0], ed = Infinity;
    for (const p of path) { const d = Math.hypot(p.x - b.entry.x, p.z - b.entry.z); if (d < ed) { ed = d; edge = p; } }
    // the far bank or islet: the nearest spot on the grid to where a run lands that is dry
    // land off the island's open ground and out of the thicket, on the same side (no water
    // between), with at least TRAIL.wet m of water between it and the edge (so its line on
    // the map crosses the water): its own run's, else one of a fan of runs from its water
    // (none: no dashes)
    const wetOn = (ax, az, x, z, most) => {
      const d = Math.hypot(x - ax, z - az);
      let w = 0;
      for (let t = 0; t <= d && w <= most; t += 0.25) if (wet(ax + (x - ax) * t / d, az + (z - az) * t / d)) w += 0.25;
      return w;
    };
    const farSide = (L) => {
      const m = Math.ceil(TRAIL.landR / g), x0 = Math.round(L.x / g) * g, z0 = Math.round(L.z / g) * g;
      let best = null, ld = Infinity;
      for (let j = -m; j <= m; j++) {
        for (let i = -m; i <= m; i++) {
          const x = x0 + i * g, z = z0 + j * g, d = Math.hypot(x - L.x, z - L.z);
          if (d >= ld || d > TRAIL.landR || wet(x, z) || walk(x, z) || T.isThicket(x, z)) continue;
          if ((d > 0 && wetOn(L.x, L.z, x, z, 0) > 0) || wetOn(edge.x, edge.z, x, z, TRAIL.wet) < TRAIL.wet) continue;
          ld = d; best = { x, z };
        }
      }
      return best;
    };
    let land = b.landing ? farSide(b.landing) : null;
    const a1 = Math.atan2(b.entry.z - a.z, b.entry.x - a.x);
    for (let k = 1; !land && k < 12; k++) {
      const hit = landingFrom(b.entry.x, b.entry.z, a1 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5);
      if (hit && hit.t <= 12) land = farSide(hit);
    }
    b.gpsDay = { path, shade: shade && T.canopyAt(shade.x, shade.z) > 1 ? shade : null, edge, land, day: -1, dashes: [], mid: TRAIL.mid, k: b.site * 1.37 };
    return b.gpsDay;
  }
  function trailAt(b, h, out = { x: 0, z: 0 }) {
    const R = trailOf(b), k = R.k;
    // the day's dashes (one in the morning, one in the afternoon) and its shady spell
    if (R.day !== state.days) {
      R.day = state.days;
      const r = makeRng(0x7a11 + b.site * 977 + (state.days | 0) * 131);
      R.dashes.length = 0;
      if (R.land) R.dashes.push(9.4 + 1.8 * r(), 14.6 + 2.4 * r());
      R.mid = [TRAIL.mid[0] + 0.4 * r(), TRAIL.mid[1] + 0.4 * r()];
    }
    const set = (p) => { out.x = p.x; out.z = p.z; return out; };
    if (R.shade && h >= R.mid[0] && h < R.mid[1]) return set(R.shade);
    for (const t0 of R.dashes) {
      if (h < t0 || h >= t0 + TRAIL.dash) continue;
      const u = (h - t0) / TRAIL.dash;
      return set(u >= TRAIL.land[0] && u < TRAIL.land[1] ? R.land : R.edge);
    }
    // up and down its stretch of shore
    const u = 0.5 + 0.5 * (0.6 * Math.sin(h * 0.9 + k) + 0.4 * Math.sin(h * 2.3 + k * 1.7));
    return set(R.path[Math.round(u * (R.path.length - 1))]);
  }

  // ---- watching the player
  function sense(b, dt) {
    if (b.tame) return;
    const noise = noiseFactor(player.noise);
    let fid = BASILISK.fid * noise * b.habit;
    if (b.state === 'alert') fid *= BASILISK.sensitise;
    const d = b.dist;
    // (calm while the player visits its perch logger: it watches, and only a run bolts it)
    const bolt = b.calm > 0 ? player.mode === 'jog' && d < fid : d < fid || (player.mode === 'jog' && d < 7);
    if (bolt) { flee(b); return; }
    if (d < fid * BASILISK.alertRatio && player.speed > 0.1) {
      if (b.state !== 'alert') { b.state = 'alert'; b.stateT = 0; b.display = null; events.emit('lizard:alert', b); }
      b.calmT = 0;
    } else if (b.state === 'alert') {
      b.calmT += dt;
      if (b.calmT > BASILISK.settle) { b.state = 'idle'; b.habit = Math.max(0.6, b.habit * 0.85); }
    }
  }

  // head bobs now and then (a male more often), for the loop's "Head bob!" moment
  function displays(b, dt) {
    if (b.display) {
      b.bobT -= dt;
      if (b.bobT <= 0) b.display = null;
      return;
    }
    b.nextBob -= dt;
    if (b.nextBob > 0 || b.state !== 'idle') return;
    b.display = 'headbob';
    b.bobT = 0.9;
    b.nextBob = -Math.log(1 - b.rng() * 0.999) * 60 / BASILISK.display[b.sex === 'm' ? 'm' : 'f'];
    events.emit('lizard:display', b, 'headbob');
  }

  // ---- the anoles on the ground near a runner make for their trunks
  function scatter(b) {
    const L = game.lizards;
    if (!L || !L.all) return;
    const r2 = BASILISK.scatter * BASILISK.scatter;
    for (const lz of L.all) {
      if (!lz.visible || (lz.surface !== 'ground' && lz.surface !== 'log')) continue;
      const dx = lz.pos.x - b.pos.x, dz = lz.pos.z - b.pos.z;
      if (dx * dx + dz * dz < r2) lz.bolt(b.pos.x, b.pos.z);
    }
  }

  // ---- on the loop: the bolt for the water (catching.js waits on it)
  const input = game.input;
  // where it wants to go: the water, but away from the player too, so one stood between it
  // and the water turns it inland; also leaves the unit way to the water in WD
  const WD = { x: 0, z: 0 };
  function wantOf(b) {
    const e = b.entry, p = player.position;
    let wx = e.x - b.pos.x, wz = e.z - b.pos.z;
    const wl = Math.hypot(wx, wz) || 1;
    WD.x = wx / wl; WD.z = wz / wl;
    let qx = p.x - b.pos.x, qz = p.z - b.pos.z;
    const ql = Math.hypot(qx, qz) || 1;
    qx /= ql; qz /= ql;
    const ax = WD.x - BASILISK.fight.shy * qx, az = WD.z - BASILISK.fight.shy * qz;
    return Math.atan2(-ax, -az);
  }
  function sprint(b, opts) {
    return new Promise((resolve) => {
      b.fight = { t: 0, tire: 0, tell: 0, told: false, h: wantOf(b), steer: opts.steer || null, resolve };
      b.heading = b.fight.h;
      events.emit('lizard:flee', b);
      say(WORDS.bolt, 'warn');
    });
  }
  const say = (text, tone = 'info') => kit.toast(text, { icon: 'lizard', tone, ms: 3200 });

  function waterAhead(x, z, fx, fz, far) {
    for (let t = 0.2; t <= far; t += 0.2) if (wet(x + fx * t, z + fz * t)) return t;
    return Infinity;
  }
  const tow = { x: 0, z: 0 };
  function fightStep(b, dt) {
    const F = b.fight, FG = BASILISK.fight, p = player.position;
    F.t += dt;
    const want = wantOf(b), wx = WD.x, wz = WD.z;
    // steering: [A] and [D] (or the stick) push it across the view; scripted runs steer
    // straight away from the water, or not at all
    let s = 0;
    const yaw = game.rig ? game.rig.yaw : player.heading;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw); // the view's right on the ground
    if (F.steer === 'away') s = Math.sign(-(wx * rx + wz * rz)) || 1;
    else if (F.steer !== 'none' && input && input.move) s = Math.max(-1, Math.min(1, input.move.x));
    let fx = -Math.sin(F.h), fz = -Math.cos(F.h);
    // with the water close ahead the push turns it about its own side, the way the push
    // across the view first turned it, so a firm pull can bring it right round
    let px = rx, pz = rz, k = FG.steer;
    if (F.near && s) {
      if (!F.side) F.side = -fz * rx + fx * rz >= 0 ? 1 : -1;
      px = -fz * F.side; pz = fx * F.side; k *= FG.grip;
    } else F.side = 0;
    fx += px * s * k * dt; fz += pz * s * k * dt;
    // it turns for the water by itself
    let h = Math.atan2(-fx, -fz);
    const dh = wrap(want - h), turn = FG.pull * dt;
    h += Math.abs(dh) < turn ? dh : Math.sign(dh) * turn;
    F.h = h;
    fx = -Math.sin(h); fz = -Math.cos(h);
    b.heading = h;
    const sp = FG.speed * smooth(0, 0.35, F.t);
    let nx = b.pos.x + fx * sp * dt, nz = b.pos.z + fz * sp * dt;
    // the tell: the water close ahead
    const ahead = waterAhead(b.pos.x, b.pos.z, fx, fz, FG.warn);
    F.near = ahead < FG.warn;
    if (F.near) {
      F.tell += dt;
      if (!F.told) { F.told = true; say(WORDS.tell, 'warn'); events.emit('lizard:alert', b); }
    } else if (F.tell > 0) F.tell = Math.max(0, Math.min(F.tell, FG.tell) - dt * 0.5);
    if (wet(nx, nz)) {
      // at the edge: across it goes, once the tell has shown long enough
      if (F.tell >= FG.tell) { endFight(b, false); return; }
      nx = b.pos.x; nz = b.pos.z;
    }
    // on the tether: the player is pulled along behind; held back where they cannot go
    const tx = nx - p.x, tz = nz - p.z, td = Math.hypot(tx, tz);
    if (td > FG.tether) {
      const over = td - FG.tether;
      tow.x = (tx / td) * over / Math.max(dt, 1e-3);
      tow.z = (tz / td) * over / Math.max(dt, 1e-3);
      const tl = Math.hypot(tow.x, tow.z);
      if (tl > 3.5) { tow.x *= 3.5 / tl; tow.z *= 3.5 / tl; }
      player.tow = tow;
      // as far as the player is from it, at most a little over the tether
      const lim = FG.tether + 0.25;
      if (td > lim) { nx = p.x + (tx / td) * lim; nz = p.z + (tz / td) * lim; }
    } else player.tow = null;
    b.pos.x = nx; b.pos.z = nz;
    b.pos.y = Math.max(0, T.heightAt(nx, nz));
    // kept off the water: heading away from it tires it
    const away = -(fx * wx + fz * wz);
    F.tire += dt * Math.min(1, Math.max(0, away + 0.25));
    kit.hint(F.tell > 0 ? WORDS.tell : WORDS.bolt);
    if (F.tire >= FG.tire || F.t >= FG.most) endFight(b, true);
  }
  // a fight cut short (the day over, back to the title): it slips the loop
  function dropFight(b) {
    const F = b.fight;
    if (!F) return;
    b.fight = null;
    player.tow = null;
    kit.hint(null);
    F.resolve(false);
  }
  function endFight(b, held) {
    const F = b.fight;
    b.fight = null;
    player.tow = null;
    kit.hint(null);
    if (held) {
      say(WORDS.tired, 'good');
    } else {
      say(WORDS.escape, 'warn');
      flee(b);
      b.run.tx = b.pos.x; b.run.tz = b.pos.z; // already at the water: straight across
    }
    F.resolve(held);
  }

  // ---- per frame
  function update(dt, t) {
    if (!on()) {
      if (guests.length) guests.length = 0;
      for (const b of live) {
        dropFight(b);
        if (b.model.group.visible) { b.model.group.visible = false; b.drawn = false; }
      }
      return;
    }
    // (the view as last drawn: updating the camera's matrices here would change what the
    // systems after this one see this frame)
    const cam = game.camera;
    if (cam && cam.isPerspectiveCamera) {
      pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      frustum.setFromProjectionMatrix(pv);
    }
    const p = player.position;
    guests.length = 0;
    for (const b of live) {
      b.dist = Math.hypot(b.pos.x - p.x, b.pos.z - p.z);
      b.stateT += dt;
      if (b.fight) fightStep(b, dt);
      else if (b.state === 'idle' || b.state === 'alert') {
        if (b.dist < 16) sense(b, dt);
        displays(b, dt);
      } else if (b.state === 'flee') {
        runStep(b, dt);
        if (b.state === 'flee' || b.state === 'across') {
          if ((b.scatterT -= dt) <= 0) { b.scatterT = 0.2; scatter(b); }
          // watched running across the water
          if (b.run && b.run.leg === 'water') {
            if (inView(b.pos.x, 0.2, b.pos.z, 0.5) && b.dist < 40) b.watchT += dt;
            if (!b.watched && b.watchT >= 0.6) {
              b.watched = true;
              const T2 = state.tasks && state.tasks['basilisk.water'];
              events.emit('basilisk:waterrun', { basilisk: b, first: !(T2 && T2.done) });
              // seen is seen: a quiet sighting for the notebook (no toast, no points)
              if (!b.tag || typeof b.tag !== 'object') b.tag = {};
              events.emit('lizard:spotted', { lizard: b, species: 'basilisk', key: 'basilisk', perch: 'ground', surface: 'ground', height: 0, onLeaves: false, canopy: false, quiet: true });
            }
          }
        }
      } else if (b.state === 'across') {
        b.awayT -= dt;
        if (b.awayT <= 0 && b.dist > 12 && !inView(b.pos.x, b.pos.y + 0.2, b.pos.z, 0.6) && !inView(b.home.x, b.home.y + 0.2, b.home.z, 0.6)) home(b);
      }
      // drawn near the player
      b.drawn = b.state !== 'off' && b.state !== 'captured' && b.dist < BASILISK.show;
      b.model.group.visible = b.drawn;
      b.fwd.x = b.fwdS.x = -Math.sin(b.heading);
      b.fwd.z = b.fwdS.z = -Math.cos(b.heading);
      if (!b.drawn) continue;
      pose(b, dt, t);
      if (b.state !== 'captured') guests.push(b);
    }
  }

  // ---- the pose for what it is doing, eased
  const goal = { pitch: 0, hipY: 0, splay: 0, stride: 0, headPitch: 0, headYaw: 0, tailLift: 0, tailSway: 0 };
  function pose(b, dt, t) {
    const P = b.P, p = player.position;
    let gait = 0, rate = 0;
    const running = b.fight || b.state === 'flee';
    const water = b.run && b.run.leg === 'water';
    if (running) {
      const quad = !b.fight && b.runT < BASILISK.rear;
      gait = quad ? 1 : 2;
      rate = water ? 24 : quad ? 15 : 19;
      goal.pitch = quad ? 0.12 : water ? 0.62 : 0.55;
      goal.hipY = quad ? 0.07 : 0.112;
      goal.splay = quad ? 0.3 : 0;
      goal.stride = 1;
      goal.headPitch = 0.05; goal.headYaw = 0; goal.tailLift = quad ? 0 : 0.15; goal.tailSway = 0;
    } else if (b.state === 'alert' || b.state === 'frozen') {
      goal.pitch = 0.36; goal.hipY = 0.06; goal.splay = 0.85; goal.stride = 0;
      goal.headPitch = -0.05; goal.tailLift = 0.02; goal.tailSway = 0;
      const want = Math.atan2(-(p.x - b.pos.x), -(p.z - b.pos.z));
      goal.headYaw = Math.max(-0.7, Math.min(0.7, wrap(want - b.heading)));
    } else {
      goal.pitch = 0.05; goal.hipY = 0.043; goal.splay = 1; goal.stride = 0;
      goal.headPitch = 0.12 + 0.05 * Math.sin(t * 0.4 + b.site); goal.headYaw = 0.25 * Math.sin(t * 0.23 + b.site * 1.7);
      goal.tailLift = 0; goal.tailSway = 0.12 * Math.sin(t * 0.3 + b.site);
    }
    const k = Math.min(1, dt * (running ? 14 : 6));
    for (const key in goal) P[key] += (goal[key] - P[key]) * k;
    P.gait = gait;
    P.phase = (P.phase + rate * dt) % (TAU * 100);
    P.bob = b.display === 'headbob' ? 0.22 * Math.max(0, Math.sin((0.9 - b.bobT) * 14)) : 0;
    b.model.pose(P, t);
    const g = b.model.group, s = b.scale;
    g.position.set(b.pos.x - b.fwd.x * 0.1 * s, b.pos.y, b.pos.z - b.fwd.z * 0.1 * s);
    g.rotation.y = b.heading;
    // the patter: splashes at each footfall on the water, and its sound
    if (water) {
      b.stepT -= dt;
      if (b.stepT <= 0) {
        b.stepT = Math.PI / rate;
        const side = Math.sin(P.phase) > 0 ? 1 : -1;
        const lx = Math.cos(b.heading) * 0.05 * side * s, lz = -Math.sin(b.heading) * 0.05 * side * s;
        if (game.fx && game.fx.burst && !(state.settings && state.settings.reducedMotion)) game.fx.burst('splash', b.pos.x + lx, 0, b.pos.z + lz, 2);
      }
      b.patT -= dt;
      if (b.patT <= 0) { b.patT = 0.16; events.emit('basilisk:patter', b.pos.x, b.pos.z); }
    }
  }

  const stats = { sites: all.length, about: 0, drawn: 0, running: 0, drawCalls: 0 };
  const sys = {
    group, all, live, guests, rules: BASILISK,
    update(dt, t) {
      update(dt, t);
      let d = 0, r = 0;
      for (const b of live) { if (b.drawn) d++; if (b.state === 'flee' || b.fight) r++; }
      stats.about = on() ? live.length : 0; stats.drawn = d; stats.running = r; stats.drawCalls = d * 2;
    },
    stats,
    // for checks: a site's basilisk about whatever the roster, at home and calm
    about(i) {
      const b = all[i];
      if (!b) return null;
      if (!live.includes(b)) live.push(b);
      home(b);
      return b;
    },
    startle(b) { if (b && (b.state === 'idle' || b.state === 'alert')) flee(b); return b; },
    roster,
    headOf,
    trail: (b) => trailOf(b),
  };
  return sys;
}
