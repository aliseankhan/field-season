// Layout helpers for the vegetation, render side only (data/ stays as it is): merging
// filler into soft mounds, thinning, and keeping every lizard on a drawn surface.
// Plain data in and out, no three.js. Positions are game metres; grids are the
// terrain grid (0.25 m cells, column with +x, row with +z).

export const BIT = { water: 1, island: 2, causeway: 4, bank: 8, thicket: 16, walkable: 32, fringe: 64 };

// ---------------------------------------------------------------- grids

// Exact Euclidean distance transform (Felzenszwalb and Huttenlocher): for every inside
// cell, the distance in cells to the nearest outside cell centre; 0 outside.
export function distanceField(inside, w, h) {
  const INF = 1e20;
  const g = new Float64Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = inside[i] ? INF : 0;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const pass = (len) => {
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s;
      for (;;) {
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        if (s > z[k]) break;
        k--;
      }
      k++;
      v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    pass(h);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    pass(w);
    for (let x = 0; x < w; x++) g[y * w + x] = d[x];
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(g[i]);
  return out;
}

// Connected components (8-connected) of the cells where pred(i) holds, as lists of
// grid indices.
export function components(cols, rows, pred) {
  const lab = new Int32Array(cols * rows).fill(-1);
  const out = [];
  const stack = [];
  for (let i = 0; i < lab.length; i++) {
    if (lab[i] >= 0 || !pred(i)) continue;
    const id = out.length;
    const list = [];
    lab[i] = id;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop();
      list.push(j);
      const r = Math.floor(j / cols), c = j - r * cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          const k = rr * cols + cc;
          if (lab[k] >= 0 || !pred(k)) continue;
          lab[k] = id;
          stack.push(k);
        }
      }
    }
    out.push(list);
  }
  return { list: out, label: lab };
}

// ---------------------------------------------------------------- points

// A bucketed point set for "is anything near here" tests. Each entry carries an
// extra radius r (the test is distance < d + r) and an optional payload.
export class PointHash {
  constructor(size = 1) {
    this.size = size;
    this.map = new Map();
  }

  key(i, j) {
    return (i + 4096) * 8192 + (j + 4096);
  }

  add(x, z, r = 0, item = null) {
    const k = this.key(Math.floor(x / this.size), Math.floor(z / this.size));
    let a = this.map.get(k);
    if (!a) this.map.set(k, (a = []));
    a.push({ x, z, r, item });
  }

  // Calls fn(entry, distance) for every entry within d (+ its r); stops if fn returns true.
  each(x, z, d, fn, maxR = 3) {
    const s = this.size;
    const i0 = Math.floor((x - d - maxR) / s), i1 = Math.floor((x + d + maxR) / s);
    const j0 = Math.floor((z - d - maxR) / s), j1 = Math.floor((z + d + maxR) / s);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const a = this.map.get(this.key(i, j));
        if (!a) continue;
        for (const e of a) {
          const q = Math.hypot(e.x - x, e.z - z);
          if (q < d + e.r && fn(e, q)) return true;
        }
      }
    }
    return false;
  }

  near(x, z, d, maxR = 3) {
    return this.each(x, z, d, () => true, maxR);
  }
}

// Single-linkage clusters: items join when link(a, b) holds for any pair within maxD.
export function cluster(items, maxD, link) {
  const parent = items.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const hash = new PointHash(Math.max(0.5, maxD));
  items.forEach((it, i) => hash.add(it.x, it.z, 0, i));
  items.forEach((a, i) => {
    hash.each(a.x, a.z, maxD, (e) => {
      const j = e.item;
      if (j > i && link(a, items[j])) parent[find(i)] = find(j);
      return false;
    }, 0);
  });
  const groups = new Map();
  items.forEach((it, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(it);
  });
  return [...groups.values()];
}

// Greedy thinning: keep items in the given order unless a kept one is within
// spacing(a, b) of it.
export function thin(items, spacing, maxD) {
  const kept = [];
  const hash = new PointHash(Math.max(0.5, maxD));
  for (const it of items) {
    const clash = hash.each(it.x, it.z, maxD, (e) => Math.hypot(e.x - it.x, e.z - it.z) < spacing(it, e.item), 0);
    if (clash) continue;
    kept.push(it);
    hash.add(it.x, it.z, 0, it);
  }
  return kept;
}

// ---------------------------------------------------------------- mounds

// Cover a set of grid cells with round puffs. Big puffs go where the set is deepest
// (distance to its edge), smaller ones towards the edge; each puff reaches out past the
// edge by at most `out`. A second pass adds filler puffs, centred far enough inside,
// wherever a cell that must be covered (mustCover, default every cell) lies more than
// `slack` beyond every puff. Returns [{x, z, R, d}] in metres.
//   T: terrain (cols, rows, cell, x0, z0), cells: grid indices, Rmin, Rmax, out,
//   spacing: centre spacing as a fraction of the larger radius, fillMax: largest filler
export function packCells(T, cells, { Rmin = 0.45, Rmax = 2.5, out = 0.05, spacing = 1.0, mustCover = null, slack = 0, fillMax = 1.6 } = {}) {
  if (!cells.length) return [];
  const { cols, cell, x0, z0 } = T;
  let c0 = Infinity, c1 = -Infinity, r0 = Infinity, r1 = -Infinity;
  for (const i of cells) {
    const r = Math.floor(i / cols), c = i - r * cols;
    if (c < c0) c0 = c; if (c > c1) c1 = c; if (r < r0) r0 = r; if (r > r1) r1 = r;
  }
  c0 -= 2; r0 -= 2; c1 += 2; r1 += 2;
  const w = c1 - c0 + 1, h = r1 - r0 + 1;
  const inside = new Uint8Array(w * h);
  const glob = new Int32Array(w * h).fill(-1);
  const loc = (i) => { const r = Math.floor(i / cols), c = i - r * cols; return (r - r0) * w + (c - c0); };
  for (const i of cells) { const j = loc(i); inside[j] = 1; glob[j] = i; }
  const dist = distanceField(inside, w, h);
  // distance to the edge of the set, in metres (a cell centre is half a cell inside)
  const depth = (j) => Math.max(0, (dist[j] - 0.5) * cell);
  const xy = (j) => [x0 + (c0 + (j % w)) * cell, z0 + (r0 + Math.floor(j / w)) * cell];
  const order = [];
  for (let j = 0; j < inside.length; j++) if (inside[j]) order.push(j);
  order.sort((a, b) => dist[b] - dist[a] || a - b);
  const puffs = [];
  const hash = new PointHash(Rmax);
  for (const j of order) {
    const R = Math.min(Rmax, depth(j) + out);
    if (R < Rmin) break; // the rest are shallower still
    const [x, z] = xy(j);
    const clash = hash.each(x, z, 2 * Rmax, (e) => Math.hypot(e.x - x, e.z - z) < spacing * Math.max(R, e.item.R), 0);
    if (clash) continue;
    const p = { x, z, R, d: depth(j) };
    puffs.push(p);
    hash.add(x, z, 0, p);
  }
  // fillers: for a bare cell, the nearby centre whose puff covers it with most room
  const covered = (x, z) => hash.each(x, z, Rmax + slack, (e) => Math.hypot(e.x - x, e.z - z) < e.item.R * 0.96 + slack, 0);
  const reach = Math.ceil(fillMax / cell);
  for (const j of order) {
    if (mustCover && !mustCover(glob[j])) continue;
    const [x, z] = xy(j);
    if (covered(x, z)) continue;
    const jr = Math.floor(j / w), jc = j % w;
    let best = -1, bestScore = -Infinity, bestR = 0;
    for (let dr = -reach; dr <= reach; dr++) {
      for (let dc = -reach; dc <= reach; dc++) {
        const rr = jr + dr, cc = jc + dc;
        if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue;
        const k = rr * w + cc;
        if (!inside[k]) continue;
        const R = Math.min(fillMax, depth(k) + out);
        if (R < Rmin * 0.8) continue;
        const d = Math.hypot(dr, dc) * cell;
        const score = R * 0.96 - d;
        if (score > bestScore) { bestScore = score; best = k; bestR = R; }
      }
    }
    if (best < 0 || bestScore < -slack) continue; // too thin here for a puff
    const [px, pz] = xy(best);
    const p = { x: px, z: pz, R: bestR, d: depth(best), filler: true };
    puffs.push(p);
    hash.add(px, pz, 0, p);
  }
  return puffs;
}

// A puff is a ground dome: centre (x, y0 - sink, z), radii (R, H + sink, R).
export const puffSink = (H) => 0.08 * H;

// Normalised radius of point (x, y, z) in a puff's dome (below 1 is inside).
export function puffQ(p, x, y, z) {
  const s = puffSink(p.H);
  const dp = Math.hypot(x - p.x, z - p.z) / p.R;
  const dy = (y - (p.y0 - s)) / (p.H + s);
  return Math.hypot(dp, dy);
}

// Plan radius of a puff at height yAbove over its base (0 above the top).
export function puffRadiusAt(p, yAbove) {
  const s = puffSink(p.H);
  const t = (yAbove + s) / (p.H + s);
  return t >= 1 ? 0 : p.R * Math.sqrt(1 - Math.max(0, t) * t);
}

// Keep lizards visible: no puff may bury a lizard. A lizard inside a puff makes the
// puff lower or narrower (whichever loses less volume), or drops it; ground lizards
// are kept outside the puff's foot. Lizards: {x, y, z, ground, bark}. Puffs get their
// R and H changed in place; dropped ones get .dropped = true.
//   lumps: how far the drawn surface may stand proud of the dome (noise), as a
//   fraction of the puff's size
export function fitPuffsToLizards(puffs, lizards, { Rmin = 0.35, Hmin = 0.35, lumps = 0.05 } = {}) {
  const hash = new PointHash(1);
  for (const l of lizards) hash.add(l.x, l.z, 0, l);
  let changed = 0;
  for (let pass = 0; pass < 4; pass++) {
    let any = false;
    for (const p of puffs) {
      if (p.dropped) continue;
      hash.each(p.x, p.z, p.R + 0.3, (e) => {
        if (p.dropped) return true;
        const l = e.item;
        const dplan = Math.hypot(l.x - p.x, l.z - p.z);
        if (l.ground) {
          if (dplan >= p.R + 0.15) return false;
          p.R = dplan - 0.15;
          if (p.R < Rmin) p.dropped = true;
          any = true; changed++;
          return false;
        }
        const size = Math.min(p.R, p.H);
        const margin = (l.bark ? 0.1 : 0.0) + lumps * Math.max(p.R, p.H);
        const qt = 1 + margin / size;
        const s = puffSink(p.H);
        const rho = dplan / p.R;
        const eta = (l.y - p.y0 + s) / (p.H + s);
        if (Math.hypot(rho, eta) >= qt) return false;
        // option A: lower the puff
        let HA = -1;
        if (rho < qt) {
          const e2 = Math.sqrt(qt * qt - rho * rho);
          HA = (l.y - p.y0 + s) / e2 - s;
        }
        // option B: narrow the puff
        let RB = -1;
        if (eta < qt) {
          const r2 = Math.sqrt(Math.max(1e-6, qt * qt - Math.max(0, eta) * eta));
          RB = dplan / r2 - 1e-3;
        }
        const vA = HA >= Math.max(Hmin, 0.4 * p.H) ? p.R * p.R * HA : -1;
        const vB = RB >= Rmin ? RB * RB * p.H : -1;
        if (vA < 0 && vB < 0) {
          p.dropped = true;
        } else if (vA >= vB) {
          p.H = HA;
        } else {
          p.R = RB;
        }
        any = true; changed++;
        return false;
      }, 0.5);
    }
    if (!any) break;
  }
  return changed;
}
