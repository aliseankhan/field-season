// Where the crocodiles swim and haul out, worked out once from the terrain grids.
//
// - A 0.5 m swim grid: OPEN water to cruise across (clear sky, a metre or more
//   from land) and NEAR water (the shallows and the gaps between the mangroves)
//   that is only used to reach the shore. Mangrove trunks keep a wide berth for
//   their prop roots. No swimming within SAFE_SWIM of the start or CAUSEWAY_CLEAR
//   of the causeway, so no part of a croc comes within 15 m of the start and none
//   can reach a player crossing to the island.
// - A* routes over that grid, string-pulled into a few straight legs.
// - Haul-out spots on mud islets and on walkable shore: flat ground touching
//   water, a straight crawl in from the water, room to turn round (so the croc
//   lies facing the lake) where there is space, never cutting the walkable
//   ground in two.
// Plain JS with no three.js, so it runs anywhere.

const CELL = 0.5;
export const OPEN = 1;
export const NEAR = 2;

// No part of a croc within 15 m of the start: 15 m, plus the 1.35 m tail and half
// a cell's diagonal for the grid, or the body's reach for a haul-out.
export const START_CLEAR = 15;
const SAFE_START = START_CLEAR + 2.5; // metres round the start with no haul-out
const SAFE_SWIM = START_CLEAR + 2; // and no swimming
const CAUSEWAY_CLEAR = 5.5; // the warning's reach plus the tail, from the causeway
const WET_TRUNK = 1.5; // clearance round a trunk standing in water or mud (prop roots)
const DRY_TRUNK = 0.35; // extra clearance round a trunk on the lawn

// Small seeded generator (mulberry32).
export function makeRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Two-pass chamfer distance (metres) to the nearest cell where src is 1, capped.
function chamfer(w, h, cell, src, cap) {
  const d = new Float32Array(w * h);
  const a = cell, b = cell * Math.SQRT2;
  for (let i = 0; i < d.length; i++) d[i] = src[i] ? 0 : cap;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      let v = d[i];
      if (c > 0) v = Math.min(v, d[i - 1] + a);
      if (r > 0) {
        v = Math.min(v, d[i - w] + a);
        if (c > 0) v = Math.min(v, d[i - w - 1] + b);
        if (c < w - 1) v = Math.min(v, d[i - w + 1] + b);
      }
      d[i] = v;
    }
  }
  for (let r = h - 1; r >= 0; r--) {
    for (let c = w - 1; c >= 0; c--) {
      const i = r * w + c;
      let v = d[i];
      if (c < w - 1) v = Math.min(v, d[i + 1] + a);
      if (r < h - 1) {
        v = Math.min(v, d[i + w] + a);
        if (c < w - 1) v = Math.min(v, d[i + w + 1] + b);
        if (c > 0) v = Math.min(v, d[i + w - 1] + b);
      }
      d[i] = v;
    }
  }
  return d;
}

// Binary min-heap of cell indices, each pushed with its priority.
class Heap {
  constructor(n) { this.items = new Int32Array(n); this.keys = new Float32Array(n); this.size = 0; }
  push(i, key) {
    const a = this.items, kk = this.keys;
    if (this.size >= a.length) return; // full: drop (the search still ends)
    let k = this.size++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (kk[p] <= key) break;
      a[k] = a[p]; kk[k] = kk[p];
      k = p;
    }
    a[k] = i; kk[k] = key;
  }
  pop() {
    const a = this.items, kk = this.keys;
    const top = a[0];
    const last = a[--this.size], lk = kk[this.size];
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && kk[c + 1] < kk[c]) c++;
      if (kk[c] >= lk) break;
      a[k] = a[c]; kk[k] = kk[c];
      k = c;
    }
    a[k] = last; kk[k] = lk;
    return top;
  }
}

// trunks: [{x, z, r}], collision: the player's Collision (for its circles), start {x, z}.
export function buildCrocMap(T, { trunks = [], collision = null, start, spawns = [], pathDistance = null } = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const bits = T.bits;
  // Grid over the lake round the island (the far bank closes it to the south).
  const x0 = -70, z0 = -80, w = Math.round((100 - x0) / CELL), h = Math.round((62 - z0) / CELL);
  const n = w * h;
  const xOf = (c) => x0 + (c + 0.5) * CELL;
  const zOf = (r) => z0 + (r + 0.5) * CELL;
  const colOf = (x) => Math.floor((x - x0) / CELL);
  const rowOf = (z) => Math.floor((z - z0) / CELL);
  const idx = (x, z) => {
    const c = colOf(x), r = rowOf(z);
    return c < 0 || r < 0 || c >= w || r >= h ? -1 : r * w + c;
  };

  // Water where all four quarter cells are water and the bed is deep enough.
  const water = new Uint8Array(n), land = new Uint8Array(n), walk = new Uint8Array(n);
  const canopy = new Float32Array(n);
  const q = CELL / 4;
  const cScale = (T.header && T.header.canopy && T.header.canopy.scale) || 0.1;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const i = r * w + c, x = xOf(c), z = zOf(r);
      let nw = 0, can = 0, wk = 0;
      for (let k = 0; k < 4; k++) {
        const ti = T.cellIndex(x + (k & 1 ? q : -q), z + (k & 2 ? q : -q));
        const m = ti < 0 ? 0 : T.mask[ti];
        if ((m & bits.water) || m === 0) nw++;
        if (m & bits.walkable) wk++;
        if (ti >= 0) can = Math.max(can, T.canopy[ti] * cScale);
      }
      canopy[i] = can;
      if (nw === 4 && T.heightAt(x, z) <= -0.12) water[i] = 1;
      if (nw === 0) land[i] = 1;
      if (wk >= 3) walk[i] = 1;
    }
  }
  const toLand = chamfer(w, h, CELL, land, 30);
  const walkDist = chamfer(w, h, CELL, walk, 40);

  // Trunk clearance, and the causeway and start exclusions.
  const blocked = new Uint8Array(n);
  const stamp = (x, z, rad, arr) => {
    const c0 = Math.max(0, colOf(x - rad)), c1 = Math.min(w - 1, colOf(x + rad));
    const r0 = Math.max(0, rowOf(z - rad)), r1 = Math.min(h - 1, rowOf(z + rad));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const dx = xOf(c) - x, dz = zOf(r) - z;
        if (dx * dx + dz * dz <= rad * rad) arr[r * w + c] = 1;
      }
    }
  };
  const wetTrunks = [], dryTrunks = [];
  for (const t of trunks) {
    const wet = !T.isWalkable(t.x, t.z);
    (wet ? wetTrunks : dryTrunks).push(t);
    stamp(t.x, t.z, wet ? WET_TRUNK : (t.r || 0.1) + 0.6, blocked);
  }
  const causeway = new Uint8Array(n);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (T.maskAt(xOf(c), zOf(r)) & bits.causeway) causeway[r * w + c] = 1;
    }
  }
  const toCauseway = chamfer(w, h, CELL, causeway, 10);

  const cls = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!water[i] || blocked[i] || toCauseway[i] < CAUSEWAY_CLEAR) continue;
    const c = i % w, r = (i / w) | 0;
    if (Math.hypot(xOf(c) - start.x, zOf(r) - start.z) < SAFE_SWIM) continue;
    cls[i] = toLand[i] >= 1.25 && canopy[i] < 0.6 ? OPEN : NEAR;
  }

  // Keep only the lake: the connected piece holding the most open water.
  const comp = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  let best = -1, bestOpen = 0, nComp = 0;
  for (let i = 0; i < n; i++) {
    if (!cls[i] || comp[i] >= 0) continue;
    let sp = 0, open = 0;
    stack[sp++] = i;
    comp[i] = nComp;
    while (sp) {
      const j = stack[--sp];
      if (cls[j] === OPEN) open++;
      const c = j % w, r = (j / w) | 0;
      // 4-connected, as the router never cuts a corner
      for (let k4 = 0; k4 < 4; k4++) {
        const cc = c + (k4 === 0 ? 1 : k4 === 1 ? -1 : 0), rr = r + (k4 === 2 ? 1 : k4 === 3 ? -1 : 0);
        if (cc < 0 || rr < 0 || cc >= w || rr >= h) continue;
        const k = rr * w + cc;
        if (cls[k] && comp[k] < 0) { comp[k] = nComp; stack[sp++] = k; }
      }
    }
    if (open > bestOpen) { bestOpen = open; best = nComp; }
    nComp++;
  }
  let nOpen = 0, nNear = 0;
  for (let i = 0; i < n; i++) {
    if (cls[i] && comp[i] !== best) cls[i] = 0;
    if (cls[i] === OPEN) nOpen++; else if (cls[i] === NEAR) nNear++;
  }

  // Cruise destinations: open water in sight of the island (within 24 m of
  // walkable ground) and at least 2.5 m from any land.
  const cruise = [];
  for (let i = 0; i < n; i++) {
    if (cls[i] === OPEN && toLand[i] >= 2.5 && walkDist[i] <= 24 && (i % 3 === 0)) cruise.push(i);
  }

  const map = {
    cell: CELL, w, h, x0, z0, cls, toLand, walkDist, cruise, wetTrunks, dryTrunks,
    xOf, zOf, colOf, rowOf, idx,
    stats: { open: nOpen, near: nNear, cruise: cruise.length, openM2: nOpen * CELL * CELL, nearM2: nNear * CELL * CELL },
  };
  map.swimmable = (x, z) => { const i = idx(x, z); return i >= 0 && cls[i] !== 0; };
  map.isOpen = (x, z) => { const i = idx(x, z); return i >= 0 && cls[i] === OPEN; };
  map.toSwim = chamfer(w, h, CELL, cls, 6); // metres to swimmable water
  map.route = makeRouter(map);
  map.spots = findSpots(T, map, { collision, start, spawns, pathDistance, walk, causeway: toCauseway });
  map.stats.spots = map.spots.length;
  map.stats.ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
  return map;
}

// ---------------------------------------------------------------- routes

function makeRouter(map) {
  const { w, h, cls, toLand } = map;
  const n = w * h;
  const g = new Float32Array(n), f = new Float32Array(n);
  const from = new Int32Array(n), seen = new Uint32Array(n), closed = new Uint32Array(n);
  const heap = new Heap(n * 8);
  let stamp = 0;
  const DC = [1, -1, 0, 0, 1, 1, -1, -1], DR = [0, 0, 1, -1, 1, -1, 1, -1];

  // A straight corridor of swimmable cells between two points? The line and two
  // lines SIDE either side of it are tested, so a leg never grazes the corner of
  // a cell it may not swim through.
  // (The cell lookups are written out here: this runs every frame near a waypoint.)
  const SIDE = 0.2, x0 = map.x0, z0 = map.z0, inv = 1 / CELL;
  function clear(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const d = Math.sqrt(dx * dx + dz * dz);
    const steps = Math.max(1, Math.ceil(d / (CELL * 0.5)));
    const ox = d > 1e-6 ? (-dz / d) * SIDE : 0, oz = d > 1e-6 ? (dx / d) * SIDE : 0;
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      const x = ax + dx * t, z = az + dz * t;
      let c = Math.floor((x - x0) * inv), r = Math.floor((z - z0) * inv);
      if (c < 0 || r < 0 || c >= w || r >= h || cls[r * w + c] === 0) return false;
      c = Math.floor((x + ox - x0) * inv); r = Math.floor((z + oz - z0) * inv);
      if (c < 0 || r < 0 || c >= w || r >= h || cls[r * w + c] === 0) return false;
      c = Math.floor((x - ox - x0) * inv); r = Math.floor((z - oz - z0) * inv);
      if (c < 0 || r < 0 || c >= w || r >= h || cls[r * w + c] === 0) return false;
    }
    return true;
  }

  // The nearest swimmable cell to (x, z) within about 3 m, or -1.
  function nearestCell(x, z) {
    const i0 = map.idx(x, z);
    if (i0 >= 0 && cls[i0]) return i0;
    const c0 = map.colOf(x), r0 = map.rowOf(z);
    let best = -1, bd = Infinity;
    for (let dr = -6; dr <= 6; dr++) {
      for (let dc = -6; dc <= 6; dc++) {
        const c = c0 + dc, r = r0 + dr;
        if (c < 0 || r < 0 || c >= w || r >= h || !cls[r * w + c]) continue;
        const d = dc * dc + dr * dr;
        if (d < bd) { bd = d; best = r * w + c; }
      }
    }
    return best;
  }

  // Returns [x0, z0, x1, z1, ...] from (ax, az) to (bx, bz), or null.
  function route(ax, az, bx, bz, maxExpand = 60000) {
    // a croc nudged off the grid (beside a trunk, in the shallows) starts from the nearest cell
    const s = nearestCell(ax, az), e = map.idx(bx, bz);
    if (s < 0 || e < 0 || !cls[e]) return null;
    stamp++;
    heap.size = 0;
    const ec = e % w, er = (e / w) | 0;
    const hfun = (i) => {
      const dc = Math.abs(i % w - ec), dr = Math.abs(((i / w) | 0) - er);
      return (Math.max(dc, dr) + 0.4142 * Math.min(dc, dr)) * CELL;
    };
    g[s] = 0; f[s] = hfun(s); from[s] = -1; seen[s] = stamp;
    heap.push(s, f[s]);
    let found = false, expanded = 0;
    while (heap.size) {
      const i = heap.pop();
      if (closed[i] === stamp) continue; // a stale copy
      closed[i] = stamp;
      if (i === e) { found = true; break; }
      if (++expanded > maxExpand) break;
      const c = i % w, r = (i / w) | 0;
      for (let k = 0; k < 8; k++) {
        const cc = c + DC[k], rr = r + DR[k];
        if (cc < 0 || rr < 0 || cc >= w || rr >= h) continue;
        const j = rr * w + cc;
        if (!cls[j] || closed[j] === stamp) continue;
        if (k >= 4 && (!cls[r * w + cc] || !cls[rr * w + c])) continue; // no corner cutting
        // step cost and heuristic written out (this loop runs thousands of times a route)
        const ng = g[i] + (k >= 4 ? 1.4142 : 1) * CELL * (cls[j] === OPEN ? 1 : 2.2) * (toLand[j] < 0.9 ? 1.6 : 1);
        if (seen[j] === stamp && ng >= g[j]) continue;
        seen[j] = stamp;
        const dc = cc > ec ? cc - ec : ec - cc, dr = rr > er ? rr - er : er - rr;
        g[j] = ng; f[j] = ng + (dc > dr ? dc + 0.4142 * dr : dr + 0.4142 * dc) * CELL; from[j] = i;
        heap.push(j, f[j]);
      }
    }
    if (!found) return null;
    const cells = [];
    for (let i = e; i >= 0; i = from[i]) cells.push(i);
    cells.reverse();
    // String-pull: keep a point only where the straight line from the last kept one breaks.
    const pts = [ax, az];
    let lx = ax, lz = az;
    for (let k = 1; k < cells.length; k++) {
      const nx = map.xOf(cells[k] % w), nz = map.zOf((cells[k] / w) | 0);
      if (!clear(lx, lz, nx, nz)) {
        const px = map.xOf(cells[k - 1] % w), pz = map.zOf((cells[k - 1] / w) | 0);
        pts.push(px, pz);
        lx = px; lz = pz;
      }
    }
    pts.push(bx, bz);
    return pts;
  }
  route.clear = clear;
  route.nearestCell = nearestCell;
  return route;
}

// ---------------------------------------------------------------- haul-out spots

// Body sample points in the croc's frame: s forward along the body, l to the side.
const BODY = [[1.1, 0], [0.8, 0], [0.5, 0], [0.2, 0], [-0.1, 0], [-0.4, 0], [-0.7, 0], [0.2, 0.36], [0.2, -0.36], [-0.45, 0.4], [-0.45, -0.4], [-0.15, 0.3], [-0.15, -0.3]];
const TAIL = [[-1.0, 0], [-1.3, 0], [-1.55, 0]];
export const PIVOT_S = -0.15; // the croc turns on the spot about this point
const TURN_R = 1.6;

function findSpots(T, map, { collision, start, spawns, pathDistance, walk, causeway }) {
  const bits = T.bits;
  // Stamped on the terrain's own 0.25 m grid once: 1 where a croc may not lie,
  // within a trunk's clearance (wide for mangroves and their roots) or 0.3 m of
  // one of the player's collider circles.
  const { cols, rows, cell } = T;
  const noLie = new Uint8Array(cols * rows); // trunks and circles
  const noSwim = new Uint8Array(cols * rows); // trunks only
  const stamp = (x, z, rad, a, b2) => {
    const c0 = Math.max(0, T.colOf(x - rad)), c1 = Math.min(cols - 1, T.colOf(x + rad));
    const r0 = Math.max(0, T.rowOf(z - rad)), r1 = Math.min(rows - 1, T.rowOf(z + rad));
    for (let r = r0; r <= r1; r++) {
      const dz = T.zOf(r) - z;
      for (let c = c0; c <= c1; c++) {
        const dx = T.xOf(c) - x;
        if (dx * dx + dz * dz < rad * rad) { a[r * cols + c] = 1; if (b2) b2[r * cols + c] = 1; }
      }
    }
  };
  for (const t of map.wetTrunks) stamp(t.x, t.z, WET_TRUNK - 0.2, noLie, noSwim);
  for (const t of map.dryTrunks) stamp(t.x, t.z, (t.r || 0.1) + DRY_TRUNK, noLie, noSwim);
  if (collision) for (let i = 0; i < collision.n; i++) stamp(collision.cx[i], collision.cz[i], collision.cr[i] + 0.3, noLie, null);
  const key = (a, b) => a * 10007 + b;
  const BAD = bits.water | bits.thicket | bits.bank | bits.causeway;
  const LIE = bits.walkable | bits.fringe;
  // Land a croc can lie on: island ground or islet mud, not thicket, bank or causeway.
  function landOk(x, z) {
    const i = T.cellIndex(x, z);
    if (i < 0) return false;
    const m = T.mask[i];
    if (!m || (m & BAD) || !(m & LIE) || noLie[i]) return false;
    const j = map.idx(x, z);
    return j >= 0 && causeway[j] >= 3;
  }
  const waterOk = (x, z) => map.swimmable(x, z);
  const anyWaterOk = (x, z) => {
    const i = T.cellIndex(x, z);
    return i < 0 || ((T.mask[i] & bits.water) !== 0 && !noSwim[i]);
  };

  // Lizards within 5 m of a spot make it a good tree to be kept from.
  const lizHash = new Map();
  for (const sp of spawns) {
    const k = key(Math.floor(sp.x / 5), Math.floor(sp.z / 5));
    if (!lizHash.has(k)) lizHash.set(k, []);
    lizHash.get(k).push(sp);
  }
  // weight: fn(species) -> how much a lizard counts
  const lizNear = (x, z, r = 5, weight = null) => {
    let nL = 0;
    const a = Math.floor(x / 5), b = Math.floor(z / 5);
    for (let da = -2; da <= 2; da++) {
      for (let db = -2; db <= 2; db++) {
        for (const sp of lizHash.get(key(a + da, b + db)) || []) if (Math.hypot(sp.x - x, sp.z - z) < r) nL += weight ? weight(sp.sp) : 1;
      }
    }
    return nL;
  };
  // The rare ones make a tree worth guarding: knight and bark anoles, and green
  // anoles a little.
  const RARE = { equestris: 1, distichus: 1, carolinensis: 0.3 };
  const rareWeight = (sp) => RARE[sp] || 0;
  // Never lie on a lizard sitting on the ground, a root or a log.
  const onLizard = (x, z, fx, fz) => {
    const a = Math.floor(x / 5), b = Math.floor(z / 5);
    for (let da = -1; da <= 1; da++) {
      for (let db = -1; db <= 1; db++) {
        for (const sp of lizHash.get(key(a + da, b + db)) || []) {
          if (sp.y - T.heightAt(sp.x, sp.z) > 0.4) continue; // up a tree: no matter
          const dx = sp.x - x, dz = sp.z - z;
          const t = Math.max(-1.55, Math.min(1.2, dx * fx + dz * fz));
          if (Math.hypot(dx - fx * t, dz - fz * t) < 0.9) return true;
        }
      }
    }
    return false;
  };

  const cands = [];
  const STEP = 0.75, NH = 20;
  const SIN_H = new Float32Array(NH), COS_H = new Float32Array(NH);
  for (let k = 0; k < NH; k++) { SIN_H[k] = -Math.sin((k / NH) * Math.PI * 2); COS_H[k] = -Math.cos((k / NH) * Math.PI * 2); }
  for (let x = -60; x <= 80; x += STEP) {
    for (let z = -45; z <= 50; z += STEP) {
      if (Math.hypot(x - start.x, z - start.z) < SAFE_START) continue;
      const wi0 = map.idx(x, z);
      if (wi0 < 0 || map.toSwim[wi0] > 4.8) continue; // too far from water to crawl in
      if (!landOk(x, z)) continue;
      const m = T.maskAt(x, z);
      const islet = !(m & bits.walkable);
      let bestPose = null;
      for (let k = 0; k < NH; k++) {
        const hIn = (k / NH) * Math.PI * 2;
        const fx = SIN_H[k], fz = COS_H[k]; // forward
        const rx = -fz, rz = fx; // right
        // The rest footprint: body on land, the tail on land or in water.
        let ok = true, ymin = Infinity, ymax = -Infinity;
        for (const [s, l] of BODY) {
          const px = x + fx * s + rx * l, pz = z + fz * s + rz * l;
          if (!landOk(px, pz)) { ok = false; break; }
          const y = T.heightAt(px, pz);
          ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
        }
        if (!ok || ymax - ymin > 0.32 || ymax > 0.75) continue;
        for (const [s, l] of TAIL) {
          const px = x + fx * s + rx * l, pz = z + fz * s + rz * l;
          if (!landOk(px, pz) && !anyWaterOk(px, pz)) { ok = false; break; }
        }
        if (!ok) continue;
        if (onLizard(x, z, fx, fz)) continue;
        // A straight crawl in from open water behind the tail.
        let ax = 0, az = 0, found = false;
        for (const back of [2.8, 3.3, 3.8, 4.4]) {
          ax = x - fx * back; az = z - fz * back;
          if (waterOk(ax, az)) { found = true; break; }
        }
        if (!found) continue;
        const len = Math.hypot(ax - x, az - z);
        for (let d = 0.25; d < len && ok; d += 0.25) {
          const px = x - fx * d, pz = z - fz * d;
          for (const l of [0, 0.32, -0.32]) {
            const qx = px + rx * l, qz = pz + rz * l;
            if (!landOk(qx, qz) && !(l === 0 ? waterOk(qx, qz) || anyWaterOk(qx, qz) : anyWaterOk(qx, qz))) { ok = false; break; }
          }
        }
        if (!ok) continue;
        // Room to turn round on the spot (so it can lie facing the lake)?
        const cx = x + fx * PIVOT_S, cz = z + fz * PIVOT_S;
        let turn = true;
        for (let rr = 0.55; rr <= TURN_R + 1e-6 && turn; rr += 0.525) {
          for (let a = 0; a < 16; a++) {
            const px = cx + Math.cos((a / 16) * 6.2832) * rr, pz = cz + Math.sin((a / 16) * 6.2832) * rr;
            if (!landOk(px, pz) && !anyWaterOk(px, pz)) { turn = false; break; }
          }
        }
        // Prefer a short crawl straight up out of the water.
        const score = (turn ? 1.2 : 0) - len * 0.15 - (ymax - ymin);
        if (!bestPose || score > bestPose.score) bestPose = { hIn, ax, az, turn, score, ymin, ymax };
      }
      if (!bestPose) continue;
      const pd = pathDistance ? pathDistance(x, z) : Infinity;
      // the warning reaches 4 m: a croc lying this close to a path closes it for a while
      const blocksPath = !islet && pd < 2.9;
      const liz = lizNear(x, z);
      const rare = lizNear(x, z, 6, rareWeight);
      let score = bestPose.score + (islet ? 0.6 : 0) + (blocksPath ? 1.6 : 0) + Math.min(2.2, liz / 5);
      // In sight of where the player walks.
      const wi = map.idx(x, z);
      if (wi < 0 || map.walkDist[wi] > 14) continue;
      if (map.walkDist[wi] > 8) score -= 1.5;
      cands.push({ x, z, islet, blocksPath, pathDist: pd, lizards: liz, rare, ...bestPose, score });
    }
  }

  // Greedy pick, well spread out, a mix of islets and shore; a walkable spot must
  // never cut off part of the walkable ground.
  cands.sort((a, b) => b.score - a.score);
  map.stats.candidates = { islet: cands.filter((c) => c.islet).length, shore: cands.filter((c) => !c.islet).length };
  const guard = makeCutGuard(T, map, walk, start);
  const out = [];
  const want = { islet: 3, shore: 8 };
  const got = { islet: 0, shore: 0 };
  for (const c of cands) {
    const kind = c.islet ? 'islet' : 'shore';
    if (got[kind] >= want[kind]) continue;
    if (out.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < 11)) continue;
    if (!c.islet && !guard(c)) { map.stats.cut = (map.stats.cut || 0) + 1; continue; }
    out.push(c);
    got[kind]++;
    if (out.length >= want.islet + want.shore) break;
  }
  return out.map((c, i) => ({
    id: i, kind: c.islet ? 'islet' : 'shore', x: +c.x.toFixed(2), z: +c.z.toFixed(2), hIn: c.hIn,
    ax: +c.ax.toFixed(2), az: +c.az.toFixed(2), turn: c.turn, blocksPath: c.blocksPath, pathDist: +Math.min(99, c.pathDist).toFixed(2), lizards: c.lizards, rare: +c.rare.toFixed(1),
    score: +c.score.toFixed(2), taken: null,
  }));
}

// Flood fill of the walkable cells from the start with a croc lying on the spot:
// true when nothing more than a sliver is cut off.
function makeCutGuard(T, map, walk, start) {
  const { w, h } = map;
  const n = w * h;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  function fill(block) {
    seen.fill(0);
    let s = map.idx(start.x, start.z), sp = 0, count = 0;
    if (s < 0 || !walk[s]) {
      // nearest walkable cell to the start
      let bd = Infinity;
      for (let i = 0; i < n; i++) if (walk[i]) { const d = Math.hypot(map.xOf(i % w) - start.x, map.zOf((i / w) | 0) - start.z); if (d < bd) { bd = d; s = i; } }
    }
    stack[sp++] = s; seen[s] = 1;
    while (sp) {
      const j = stack[--sp];
      count++;
      const c = j % w, r = (j / w) | 0;
      for (let k = 0; k < 4; k++) {
        const cc = c + (k === 0 ? 1 : k === 1 ? -1 : 0), rr = r + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (cc < 0 || rr < 0 || cc >= w || rr >= h) continue;
        const q = rr * w + cc;
        if (!walk[q] || seen[q] || (block && block(q))) continue;
        seen[q] = 1;
        stack[sp++] = q;
      }
    }
    return count;
  }
  const base = fill(null);
  return (c) => {
    const fx = -Math.sin(c.hIn), fz = -Math.cos(c.hIn);
    // The body as a capsule from the snout to the tail tip, 0.3 m round, plus the player's size.
    const R = 0.36 + 0.28;
    const block = (q) => {
      const x = map.xOf(q % w), z = map.zOf((q / w) | 0);
      const dx = x - c.x, dz = z - c.z;
      const s = Math.max(-1.55, Math.min(1.1, dx * fx + dz * fz));
      return Math.hypot(dx - fx * s, dz - fz * s) < R;
    };
    let footprint = 0;
    for (let q = 0; q < n; q++) if (walk[q] && block(q)) footprint++;
    const got = fill(block);
    return base - got - footprint <= 6; // at most 1.5 m2 cut off
  };
}
