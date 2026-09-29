// Ground decoration: worn desire-line paths, wildflowers and clover.
//
// Paths are found with A* over the walkable cells, with a cost that rises near
// blocked ground and trunks so the lines run down the middle of openings, then
// smoothed (Chaikin) and rasterised onto the terrain grid. terrain.js paints
// them into its vertex colours; pathMask(x, z) gives 0..1 to anyone else (the
// props keep off the paths with it). Flowers and clover are two instanced
// meshes with a gentle sway, kept off the paths, the thicket and the shade.

import * as THREE from 'three';

// Desire lines, as waypoints through open ground (all on walkable cells).
const ROUTES = [
  // Causeway trunk: garden landing, up the causeway, to the fork on the SW lawn.
  [[-11.4, 44], [-12.3, 30], [-13, 20], [-13, 9]],
  // West branch, past the rainbow eucalyptus to the west lawn.
  [[-13, 9], [-20, 5], [-22, -3], [-34, -5]],
  // East branch: past the talipot T019, between the two shrub masses, north of
  // the east mass and on to the osprey pole.
  [[-13, 9], [-4, 12.5], [5, 8], [10, 6], [20, -12], [35, -15], [47, -15], [53, -17]],
  // North spur up the lawn corridor between T022 and T025.
  [[20, -12], [15, -25]],
];

// The garden path leading to the causeway from the south, drawn on the bank
// (which cannot be walked) so the landing's gate has a path through it.
const GARDEN_LEAD = [[-10.6, 62], [-11.0, 55], [-11.3, 48.5]];

const HALF_WIDTH = 0.7; // m, 1.4 m paths
const HALF_WIDTH_CAUSEWAY = 0.9;
const EDGE = 0.2; // soft edge either side of the half width (0.4 m in all)
const REACH = 3.0; // how far from a centreline the distance raster is kept

let PATH = null; // { mask: Float32Array, dist: Float32Array, lines } on the terrain grid

const smooth = (e0, e1, v) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function hash2(ix, iz) {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  let fx = x - ix, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- public API

// 0 off the paths, 1 on them, with soft edges. 0 everywhere until the terrain is built.
export function pathMask(x, z) {
  if (!PATH) return 0;
  return sample(PATH.mask, PATH.T, x, z);
}
export const pathAt = pathMask;

// Distance in metres to the nearest path centreline (capped at a few metres).
export function pathDistance(x, z) {
  if (!PATH) return Infinity;
  return sample(PATH.dist, PATH.T, x, z);
}

// The smoothed centrelines, as lists of [x, z].
export function pathLines() {
  return PATH ? PATH.lines : [];
}

function sample(arr, T, x, z) {
  const { cols, rows, cell, x0, z0 } = T;
  let fc = (x - x0) / cell, fr = (z - z0) / cell;
  if (fc < 0 || fr < 0 || fc > cols - 1 || fr > rows - 1) return arr === PATH.mask ? 0 : REACH;
  const c = Math.min(cols - 2, Math.floor(fc)), r = Math.min(rows - 2, Math.floor(fr));
  const tx = fc - c, tz = fr - r, i = r * cols + c;
  const a = arr[i] + (arr[i + 1] - arr[i]) * tx;
  const b = arr[i + cols] + (arr[i + cols + 1] - arr[i + cols]) * tx;
  return a + (b - a) * tz;
}

// ---------------------------------------------------------------- paths

// blockedDist: metres from each cell to the nearest blocked cell or trunk (see terrain.js).
export function buildPaths(data, blockedDist) {
  const T = data.terrain;
  const { cols, rows, cell, mask, bits } = T;
  const n = cols * rows;
  const cost = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const d = blockedDist[i];
    cost[i] = (mask[i] & bits.walkable) && d > 0 ? 1 + 6 / (1 + d * d) : 0; // 0: impassable
  }
  const search = makeSearch(cols, rows, cell, cost);

  const lines = [];
  for (const route of ROUTES) {
    const cells = [];
    for (let k = 0; k + 1 < route.length; k++) {
      const a = route[k], b = route[k + 1];
      const seg = search(T.colOf(a[0]), T.rowOf(a[1]), T.colOf(b[0]), T.rowOf(b[1]));
      if (!seg) continue;
      if (cells.length) seg.shift();
      cells.push(...seg);
    }
    if (cells.length < 2) continue;
    // Every third cell (0.75 m), then Chaikin three times for soft curves.
    // The causeway trunk starts in the garden, beyond the landing's gate.
    let pts = route === ROUTES[0] ? GARDEN_LEAD.map((p) => p.slice()) : [];
    for (let k = 0; k < cells.length; k += 3) pts.push([T.xOf(cells[k] % cols), T.zOf(Math.floor(cells[k] / cols))]);
    const last = cells[cells.length - 1];
    pts.push([T.xOf(last % cols), T.zOf(Math.floor(last / cols))]);
    for (let it = 0; it < 3; it++) pts = chaikin(pts);
    lines.push(pts);
  }

  // Rasterise: distance to the nearest centreline, then the soft-edged mask.
  const dist = new Float32Array(n).fill(REACH);
  for (const pts of lines) {
    for (let k = 0; k + 1 < pts.length; k++) stampSegment(T, dist, pts[k], pts[k + 1]);
  }
  const pm = new Float32Array(n);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const d = dist[i];
      if (d >= REACH) continue;
      const x = T.xOf(c), z = T.zOf(r);
      const hw = ((mask[i] & bits.causeway) ? HALF_WIDTH_CAUSEWAY : HALF_WIDTH) + 0.24 * (noise(x * 0.45, z * 0.45) - 0.5);
      pm[i] = 1 - smooth(hw - EDGE, hw + EDGE, d);
    }
  }
  PATH = { T, mask: pm, dist, lines };
  let len = 0;
  for (const pts of lines) for (let k = 0; k + 1 < pts.length; k++) len += Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
  return { mask: pm, dist, lines, length: len };
}

function chaikin(pts) {
  const out = [pts[0]];
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k], b = pts[k + 1];
    out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function stampSegment(T, dist, a, b) {
  const { cols, rows } = T;
  const c0 = Math.max(0, T.colOf(Math.min(a[0], b[0]) - REACH)), c1 = Math.min(cols - 1, T.colOf(Math.max(a[0], b[0]) + REACH));
  const r0 = Math.max(0, T.rowOf(Math.min(a[1], b[1]) - REACH)), r1 = Math.min(rows - 1, T.rowOf(Math.max(a[1], b[1]) + REACH));
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l2 = Math.max(1e-9, dx * dx + dz * dz);
  for (let r = r0; r <= r1; r++) {
    const z = T.zOf(r);
    for (let c = c0; c <= c1; c++) {
      const x = T.xOf(c);
      const t = Math.min(1, Math.max(0, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
      const d = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
      const i = r * cols + c;
      if (d < dist[i]) dist[i] = d;
    }
  }
}

// A* over the grid, 8-connected; cost 0 marks an impassable cell. Returns the
// list of cell indices from start to goal, or null.
function makeSearch(cols, rows, cell, cost) {
  const n = cols * rows;
  const g = new Float32Array(n);
  const came = new Int32Array(n);
  const stamp = new Int32Array(n);
  const closed = new Int32Array(n);
  let run = 0;
  const heapI = new Int32Array(n);
  const heapF = new Float32Array(n);
  const DC = [1, -1, 0, 0, 1, 1, -1, -1];
  const DR = [0, 0, 1, -1, 1, -1, 1, -1];
  const DL = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

  return function search(sc, sr, gc, gr) {
    const s = sr * cols + sc, goal = gr * cols + gc;
    if (!cost[s] || !cost[goal]) return null;
    run++;
    let size = 0;
    const push = (i, f) => {
      let k = size++;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (heapF[p] <= f) break;
        heapI[k] = heapI[p]; heapF[k] = heapF[p]; k = p;
      }
      heapI[k] = i; heapF[k] = f;
    };
    const pop = () => {
      const top = heapI[0];
      const li = heapI[--size], lf = heapF[size];
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= size) break;
        if (c + 1 < size && heapF[c + 1] < heapF[c]) c++;
        if (heapF[c] >= lf) break;
        heapI[k] = heapI[c]; heapF[k] = heapF[c]; k = c;
      }
      heapI[k] = li; heapF[k] = lf;
      return top;
    };
    const h = (i) => Math.hypot((i % cols) - gc, Math.floor(i / cols) - gr) * cell;
    stamp[s] = run; g[s] = 0; came[s] = -1;
    push(s, h(s));
    while (size > 0) {
      const i = pop();
      if (closed[i] === run) continue;
      closed[i] = run;
      if (i === goal) break;
      const c = i % cols, r = (i - c) / cols;
      for (let k = 0; k < 8; k++) {
        const nc = c + DC[k], nr = r + DR[k];
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const j = nr * cols + nc;
        if (!cost[j] || closed[j] === run) continue;
        const ng = g[i] + DL[k] * cell * 0.5 * (cost[i] + cost[j]);
        if (stamp[j] !== run || ng < g[j]) {
          stamp[j] = run; g[j] = ng; came[j] = i;
          push(j, ng + h(j));
        }
      }
    }
    if (closed[goal] !== run) return null;
    const out = [];
    for (let i = goal; i >= 0; i = came[i]) out.push(i);
    return out.reverse();
  };
}

// ---------------------------------------------------------------- flowers and clover

const FLOWER_COLOURS = ['#fffaf0', '#ffd84a', '#ff9ec4', '#c7a6ff'];

// Unit flower: a stem 1 tall (scaled by the stem height) and a five-petal head
// about 1 across (scaled by the head size). aTint 1 marks the petals, which
// take the instance colour; the stem and the centre keep their own.
function flowerGeometry() {
  const pos = [], col = [], nor = [], tint = [];
  const stem = new THREE.Color('#5da443'), centre = new THREE.Color('#ffb52e'), white = new THREE.Color(1, 1, 1);
  const tri = (a, b, c, colour, t, n = [0, 1, 0]) => {
    pos.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) { col.push(colour.r, colour.g, colour.b); nor.push(...n); tint.push(t); }
  };
  // Stem: a thin three-sided prism leaning a touch, and one leaf.
  const sr = 0.035, top = [0.04, 1.0, 0];
  for (let k = 0; k < 3; k++) {
    const a0 = (k / 3) * Math.PI * 2, a1 = ((k + 1) / 3) * Math.PI * 2;
    const p0 = [Math.cos(a0) * sr, 0, Math.sin(a0) * sr], p1 = [Math.cos(a1) * sr, 0, Math.sin(a1) * sr];
    const q0 = [top[0] + p0[0] * 0.6, top[1], p0[2] * 0.6], q1 = [top[0] + p1[0] * 0.6, top[1], p1[2] * 0.6];
    const nm = [Math.cos((a0 + a1) / 2), 0.2, Math.sin((a0 + a1) / 2)];
    tri(p0, q0, p1, stem, 0, nm);
    tri(p1, q0, q1, stem, 0, nm);
  }
  tri([0.01, 0.35, 0], [0.32, 0.62, 0.1], [0.02, 0.5, 0.02], stem, 0, [0, 0.6, -0.8]);
  tri([0.01, 0.35, 0], [0.02, 0.5, 0.02], [0.32, 0.62, 0.1], stem, 0, [0, 0.6, 0.8]);
  // Head: five rounded petals (fans of three triangles), cupped a little.
  const y = 1.0, cx = top[0];
  for (let p = 0; p < 5; p++) {
    const a = (p / 5) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const base = [cx + ca * 0.08, y + 0.01, sa * 0.08];
    const ring = [];
    for (let k = 0; k <= 3; k++) {
      const b = a + (k / 3 - 0.5) * 1.05;
      const rr = k === 0 || k === 3 ? 0.3 : 0.5;
      ring.push([cx + Math.cos(b) * rr, y + 0.06 + rr * 0.12, Math.sin(b) * rr]);
    }
    for (let k = 0; k < 3; k++) tri(base, ring[k + 1], ring[k], white, 1);
  }
  // Centre: a little raised disc.
  for (let k = 0; k < 6; k++) {
    const a0 = (k / 6) * Math.PI * 2, a1 = ((k + 1) / 6) * Math.PI * 2;
    tri([cx, y + 0.07, 0], [cx + Math.cos(a1) * 0.13, y + 0.04, Math.sin(a1) * 0.13], [cx + Math.cos(a0) * 0.13, y + 0.04, Math.sin(a0) * 0.13], centre, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aTint', new THREE.Float32BufferAttribute(tint, 1));
  return g;
}

// Unit clover: three heart-shaped leaflets on a short stalk, about 1 across.
function cloverGeometry() {
  const pos = [], col = [], nor = [];
  const leaf = new THREE.Color('#4fae45'), pale = new THREE.Color('#8fd46e'), stalk = new THREE.Color('#5da443');
  const tri = (a, b, c, colour) => {
    pos.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) { col.push(colour.r, colour.g, colour.b); nor.push(0, 1, 0); }
  };
  const y = 0.55;
  tri([-0.03, 0, 0], [0.03, 0, 0], [0, y, 0], stalk);
  for (let l = 0; l < 3; l++) {
    const a = (l / 3) * Math.PI * 2 + 0.3;
    const ca = Math.cos(a), sa = Math.sin(a);
    // Two lobes make the heart; the pale chevron is the inner fan.
    for (const side of [-1, 1]) {
      const lc = [ca * 0.27 - sa * side * 0.1, y + 0.03, sa * 0.27 + ca * side * 0.1];
      const pts = [];
      for (let k = 0; k <= 5; k++) {
        const b = a + side * (k / 5) * Math.PI * 0.95 - side * 0.5;
        pts.push([lc[0] + Math.cos(b) * 0.2, y + 0.05, lc[2] + Math.sin(b) * 0.2]);
      }
      for (let k = 0; k < 5; k++) tri([0, y, 0], side > 0 ? pts[k + 1] : pts[k], side > 0 ? pts[k] : pts[k + 1], k === 2 ? pale : leaf);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

const swayUniforms = { uDecorTime: { value: 0 } };

// Lambert with the petal tint and a small sway that grows with height.
function decorMaterial(tinted) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, swayUniforms);
    let vs = shader.vertexShader.replace('#include <common>', `#include <common>
uniform float uDecorTime;
${tinted ? 'attribute float aTint;' : ''}`);
    if (tinted) {
      vs = vs.replace('#include <color_vertex>', `
vColor = color;
#ifdef USE_INSTANCING_COLOR
  vColor *= mix( vec3( 1.0 ), instanceColor, aTint );
#endif`);
    }
    vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec2 ip = instanceMatrix[3].xz;
  float ph = uDecorTime * 1.6 + ip.x * 0.9 + ip.y * 0.7;
  float k = position.y * position.y * 0.07;
  transformed.x += ( sin( ph ) + 0.4 * sin( ph * 2.3 ) ) * k;
  transformed.z += cos( ph * 0.8 ) * k * 0.7;
}`);
    shader.vertexShader = vs;
  };
  m.customProgramCacheKey = () => (tinted ? 'decor-flower-1' : 'decor-clover-1');
  return m;
}

// Picks drift centres and scatters members round them. ok(x, z) says whether a spot qualifies.
function scatter(rand, cands, { drifts, per, spread, spacing, ok }) {
  const centres = [];
  const out = [];
  let tries = 0;
  while (centres.length < drifts && tries++ < drifts * 60 && cands.length) {
    const [x, z] = cands[Math.floor(rand() * cands.length)];
    if (centres.some((c) => Math.hypot(c[0] - x, c[1] - z) < spacing)) continue;
    centres.push([x, z]);
  }
  for (const [cx, cz] of centres) {
    const count = per[0] + Math.floor(rand() * (per[1] - per[0] + 1));
    const ang = rand() * Math.PI, sx = spread * (0.8 + 0.6 * rand()), sz = spread * (0.5 + 0.4 * rand());
    const members = [];
    for (let k = 0, guard = 0; k < count && guard < count * 8; guard++) {
      // Gaussian-ish offsets in a tilted ellipse.
      const u = (rand() + rand() + rand() - 1.5) * 1.3, v = (rand() + rand() + rand() - 1.5) * 1.3;
      const x = cx + Math.cos(ang) * u * sx - Math.sin(ang) * v * sz;
      const z = cz + Math.sin(ang) * u * sx + Math.cos(ang) * v * sz;
      if (!ok(x, z) || members.some((m) => Math.hypot(m[0] - x, m[1] - z) < 0.12)) continue;
      members.push([x, z]);
      k++;
    }
    out.push({ centre: [cx, cz], members });
  }
  return out;
}

// fields: { thicketDist, blockedDist } (metres, on the terrain grid).
export function buildGroundDecor(data, fields) {
  const T = data.terrain;
  const { cols, rows, mask, bits } = T;
  const rand = rng(20250917);
  const group = new THREE.Group();
  group.name = 'ground-decor';

  // Keep clear of lizards on the ground and the start landing (the field station).
  const ground = (data.spawns.spawns || []).filter((s) => s.perch === 'ground' || s.perch === 'log');
  const circles = data.colliders.circles;
  const nearCircle = (x, z, pad) => {
    for (const [cx, cz, r] of circles) {
      const dx = x - cx, dz = z - cz, R = r + pad;
      if (dx * dx + dz * dz < R * R) return true;
    }
    return false;
  };
  const clearOf = (x, z, pathPad) => {
    const i = T.cellIndex(x, z);
    if (i < 0 || !(mask[i] & bits.walkable)) return false;
    if (T.canopy[i] * T.header.canopy.scale > 1.5) return false;
    if (fields.thicketDist[i] < 1.0 || fields.blockedDist[i] < 0.6) return false;
    if (PATH && PATH.dist[i] < HALF_WIDTH + pathPad) return false;
    if (z > 38 && x > -18 && x < -4) return false;
    if (nearCircle(x, z, 0.35)) return false;
    for (const s of ground) if (Math.abs(s.x - x) < 0.5 && Math.abs(s.z - z) < 0.5) return false;
    return true;
  };

  // Candidate centres on open lawn, sampled every metre.
  const cands = [];
  for (let r = 0; r < rows; r += 4) {
    for (let c = 0; c < cols; c += 4) {
      const x = T.xOf(c), z = T.zOf(r);
      if (clearOf(x, z, 1.4)) cands.push([x, z]);
    }
  }

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const e = new THREE.Euler(), colour = new THREE.Color();
  const flowerCols = FLOWER_COLOURS.map((h) => new THREE.Color(h));

  // Wildflowers: about 40 drifts of 12 to 18.
  const fDrifts = scatter(rand, cands, { drifts: 40, per: [12, 18], spread: 0.9, spacing: 4.5, ok: (x, z) => clearOf(x, z, 1.0) });
  // Clover: 12 patches of about 20 trefoils, each with a few small white clover heads.
  const cDrifts = scatter(rand, cands, { drifts: 12, per: [18, 24], spread: 0.7, spacing: 7, ok: (x, z) => clearOf(x, z, 0.6) });

  const flowers = [];
  fDrifts.forEach(({ members }, d) => {
    const main = d % flowerCols.length;
    for (const [x, z] of members) {
      const pick = rand() < 0.72 ? main : Math.floor(rand() * flowerCols.length);
      flowers.push({ x, z, stem: 0.16 + rand() * 0.14, head: 0.13 + rand() * 0.07, col: flowerCols[pick], v: rand() });
    }
  });
  const clover = [];
  for (const { members } of cDrifts) {
    for (const [x, z] of members) {
      clover.push({ x, z, size: 0.13 + rand() * 0.07 });
      if (rand() < 0.22) flowers.push({ x: x + 0.05, z: z - 0.04, stem: 0.08 + rand() * 0.05, head: 0.08, col: flowerCols[0], v: rand() });
    }
  }

  const fMesh = new THREE.InstancedMesh(flowerGeometry(), decorMaterial(true), Math.max(1, flowers.length));
  flowers.forEach((f, i) => {
    const y = T.heightAt(f.x, f.z) - 0.01;
    q.setFromEuler(e.set((f.v - 0.5) * 0.25, f.v * 6.283, (rand() - 0.5) * 0.25));
    fMesh.setMatrixAt(i, m4.compose(p.set(f.x, y, f.z), q, s.set(f.head, f.stem, f.head)));
    colour.copy(f.col).multiplyScalar(0.94 + 0.12 * f.v);
    fMesh.setColorAt(i, colour);
  });
  fMesh.count = flowers.length;
  const cMesh = new THREE.InstancedMesh(cloverGeometry(), decorMaterial(false), Math.max(1, clover.length));
  clover.forEach((c, i) => {
    const y = T.heightAt(c.x, c.z) - 0.01;
    q.setFromEuler(e.set(0, rand() * 6.283, 0));
    cMesh.setMatrixAt(i, m4.compose(p.set(c.x, y, c.z), q, s.set(c.size, c.size * 0.6, c.size)));
  });
  cMesh.count = clover.length;

  for (const [mesh, name] of [[fMesh, 'decor-flowers'], [cMesh, 'decor-clover']]) {
    mesh.name = name;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const tris = (m) => (m.geometry.attributes.position.count / 3) * m.count;
  return {
    group,
    update(dt, t) { swayUniforms.uDecorTime.value = t; },
    stats: {
      flowers: flowers.length, flowerDrifts: fDrifts.length, clover: clover.length, cloverPatches: cDrifts.length,
      drawCalls: 2, triangles: tris(fMesh) + tris(cMesh),
    },
  };
}
