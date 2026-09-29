// Procedural low-poly vegetation models. Nothing here reads game data.
//
// Conventions
// - Positions are [x, y, z] arrays in metres, +y up. Colours are linear RGB arrays.
// - MeshBuilder collects triangles (non-indexed) with a vertex colour, a per-vertex sway
//   weight (aSway, read by wind.js) and either face normals or given vertex normals.
//   Foliage puffs use soft vertex normals, so they shade as round balls under the toon
//   ramp while their outline stays low-poly; vertex colours carry a fake ambient
//   occlusion (darker at the base, lighter and warmer on top).
// - Unit models (makeUnitGeometry) are built once for instancing, origin at the
//   base on the ground, +y up:
//     trunk      radius 1, height 1, a root flare at the foot, tapering near the top
//     crownR, crownT   tree crowns filling the ellipsoid centred (0, 0.5, 0), radii 0.5
//     crownF*    flat mangrove canopy in the same box
//     puff       one soft puff in the same box, flat underneath
//     dome       a plump bush dome from y 0 to 1, radius 0.5
//     arches*    mangrove prop roots: neat half-arches from the stem out to radius 1,
//                landing at y -0.25 (place the origin on the water surface)
//     leaf3      a little cluster of three leaf puffs about the origin, radius 1
//     log        along +x from -0.5 to 0.5, radius 1, axis at y 0
//     herb       crinum lily, absolute colours
//   Foliage and bark unit models carry neutral vertex shading and take their hue
//   from the instance colour. Models marked absolute carry their own colours.
// - Bespoke builders (landmark trees, palms, the osprey pole, mounds, perches) write
//   world-space triangles into a wood builder and a leaf builder and return host
//   geometry.

import * as THREE from 'three';

// ---------------------------------------------------------------- small maths

export function makeRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  const f = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (lo, hi) => lo + (hi - lo) * f();
  f.sign = () => (f() < 0.5 ? -1 : 1);
  return f;
}

export function hashSeed(...parts) {
  let h = 2166136261;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    h = Math.imul(h ^ 0x5bd1e995, 16777619);
  }
  return h >>> 0;
}

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const madd = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smooth01 = (t) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };
const UP = [0, 1, 0];
const TAU = Math.PI * 2;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

// Quadratic Bezier sampled into n + 1 points.
export function bezier(p0, p1, p2, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
      u * u * p0[2] + 2 * u * t * p1[2] + t * t * p2[2],
    ]);
  }
  return out;
}

// Cubic Bezier sampled into n + 1 points.
export function bezier3(p0, p1, p2, p3, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push([
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
      a * p0[2] + b * p1[2] + c * p2[2] + d * p3[2],
    ]);
  }
  return out;
}

// ---------------------------------------------------------------- colours

const _c = new THREE.Color();
const _hsl = { h: 0, s: 0, l: 0 };

export function lin(hex) {
  _c.set(hex);
  return [_c.r, _c.g, _c.b];
}

export const tint = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
export const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Adjust a linear colour in sRGB HSL: hue shift (turns), saturation and lightness
// factors, and an optional pull of the lightness towards the middle (0..1).
export function hsl(c, dh = 0, sk = 1, lk = 1, mid = 0) {
  _c.setRGB(c[0], c[1], c[2]);
  _c.getHSL(_hsl);
  const l = _hsl.l * lk;
  _c.setHSL((_hsl.h + dh + 1) % 1, clamp(_hsl.s * sk, 0, 1), clamp(l + (0.5 - l) * mid, 0, 1));
  return [_c.r, _c.g, _c.b];
}

// Warm light on top, cool shade underneath, as multipliers.
const WARM = [1.05, 1.03, 0.9];
const COOL = [0.9, 0.97, 1.08];
const WHITE = [1, 1, 1];

// Fake ambient occlusion and warmth for foliage: t is 0 at the base, 1 at the top.
function aoTone(col, t, lo, hi) {
  const k = lo + (hi - lo) * Math.pow(clamp(t, 0, 1), 0.85);
  const w = smooth01((t - 0.55) / 0.45), c = smooth01((0.4 - t) / 0.4);
  return [
    col[0] * k * (1 + (WARM[0] - 1) * w + (COOL[0] - 1) * c),
    col[1] * k * (1 + (WARM[1] - 1) * w + (COOL[1] - 1) * c),
    col[2] * k * (1 + (WARM[2] - 1) * w + (COOL[2] - 1) * c),
  ];
}

// ---------------------------------------------------------------- builder

export class MeshBuilder {
  constructor() {
    this.p = [];
    this.n = []; // NaN in the first slot of a triangle means "use the face normal"
    this.c = [];
    this.s = [];
    this.sway = 1; // weight written with every vertex
  }

  get triangles() {
    return this.p.length / 9;
  }

  tri(a, b, c, ca, cb = ca, cc = ca) {
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.n.push(NaN, 0, 0, 0, 0, 0, 0, 0, 0);
    this.c.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
    const w = this.sway;
    this.s.push(w, w, w);
  }

  // A triangle with vertex normals.
  triN(a, b, c, na, nb, nc, ca, cb = ca, cc = ca) {
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.n.push(na[0], na[1], na[2], nb[0], nb[1], nb[2], nc[0], nc[1], nc[2]);
    this.c.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
    const w = this.sway;
    this.s.push(w, w, w);
  }

  // Both windings, for thin leaves seen from either side.
  tri2(a, b, c, col, cb = col, cc = col) {
    this.tri(a, b, c, col, cb, cc);
    this.tri(a, c, b, tint(col, 0.86), tint(cc, 0.86), tint(cb, 0.86));
  }

  quad(a, b, c, d, col) {
    this.tri(a, b, c, col);
    this.tri(a, c, d, col);
  }

  quad2(a, b, c, d, col, cb = col, cc = col, cd = col) {
    this.tri2(a, b, c, col, cb, cc);
    this.tri2(a, c, d, col, cc, cd);
  }

  toGeometry() {
    const pos = new Float32Array(this.p);
    const nor = new Float32Array(this.n);
    for (let i = 0; i < pos.length; i += 9) {
      if (!Number.isNaN(nor[i])) continue;
      const ux = pos[i + 3] - pos[i], uy = pos[i + 4] - pos[i + 1], uz = pos[i + 5] - pos[i + 2];
      const vx = pos[i + 6] - pos[i], vy = pos[i + 7] - pos[i + 1], vz = pos[i + 8] - pos[i + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      if (l > 1e-12) { nx /= l; ny /= l; nz /= l; } else { nx = 0; ny = 1; nz = 0; }
      for (let k = 0; k < 9; k += 3) {
        nor[i + k] = nx; nor[i + k + 1] = ny; nor[i + k + 2] = nz;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3));
    g.setAttribute('aSway', new THREE.BufferAttribute(new Float32Array(this.s), 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

// ---------------------------------------------------------------- primitives

const ICO_V = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  return [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
})();
const ICO_F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2],
  [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11],
  [6, 2, 10], [8, 6, 7], [9, 8, 1]];
const _ico = [];

// Unit-sphere triangles of an icosphere (detail 0: 20, 1: 80, 2: 320).
function icoTris(detail) {
  if (_ico[detail]) return _ico[detail];
  let F = ICO_F.map((f) => [ICO_V[f[0]], ICO_V[f[1]], ICO_V[f[2]]]);
  const mid = (a, b) => norm([(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5]);
  for (let d = 0; d < detail; d++) {
    const out = [];
    for (const [a, b, c] of F) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      out.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
    F = out;
  }
  _ico[detail] = F;
  return F;
}

// Lat-long sphere with 7 segments and 4 bands: 42 triangles, for tiny puffs.
let _lo = null;
function loTris() {
  if (_lo) return _lo;
  const seg = 7, bands = 4;
  const ring = (j) => {
    const ph = (j / bands) * Math.PI;
    return Array.from({ length: seg }, (_, k) => {
      const th = ((k + (j % 2) * 0.5) / seg) * TAU;
      return [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
    });
  };
  const out = [];
  const top = [0, 1, 0], bot = [0, -1, 0];
  const rings = [];
  for (let j = 1; j < bands; j++) rings.push(ring(j));
  for (let k = 0; k < seg; k++) out.push([top, rings[0][(k + 1) % seg], rings[0][k]]);
  for (let j = 0; j < rings.length - 1; j++) {
    const a = rings[j], b = rings[j + 1];
    const odd = (j + 1) % 2;
    for (let k = 0; k < seg; k++) {
      const k1 = (k + 1) % seg;
      if (odd) {
        out.push([b[k1], a[k], a[k1]]);
        out.push([a[k], b[k1], b[k]]);
      } else {
        out.push([b[k], a[k], a[k1]]);
        out.push([a[k1], b[k1], b[k]]);
      }
    }
  }
  const last = rings[rings.length - 1];
  for (let k = 0; k < seg; k++) out.push([bot, last[k], last[(k + 1) % seg]]);
  _lo = out;
  return out;
}

function sphereNoise(rng) {
  const k = [0, 1, 2].map(() => norm([rng() - 0.5, rng() - 0.5, rng() - 0.5]));
  const ph = [rng() * TAU, rng() * TAU, rng() * TAU];
  return (d) => 0.5 * Math.sin(dot(d, k[0]) * 2.3 + ph[0]) + 0.32 * Math.sin(dot(d, k[1]) * 4.1 + ph[1])
    + 0.18 * Math.sin(dot(d, k[2]) * 6.3 + ph[2]);
}

// A soft, gently lumpy ellipsoid: the basic leaf mass.
//   c centre, r radii, detail (0, 1, 2 or 'lo'), jit lump size, flat (unit y below which
//   the underside is squashed) and squash, cut (unit y below which faces are dropped),
//   rot and yaw, color, shade [bottom, top] multipliers (the fake occlusion), smooth
//   (0 faceted .. 1 fully soft normals), tone (warm top, cool bottom), faceJit,
//   bend(p) -> [nx, ny, nz] or null: a normal to lean towards (a mass's envelope),
//   bendK, aoY [y0, y1]: take the occlusion from world height instead of the puff.
export function blob(b, o) {
  const rng = makeRng(o.seed ?? 1);
  const noise = sphereNoise(rng);
  const jit = o.jit ?? 0.1;
  const flat = o.flat ?? -0.6;
  const squash = o.squash ?? 0.4;
  const cut = o.cut ?? -2;
  const [cx, cy, cz] = o.c;
  const [rx, ry, rz] = o.r;
  const rot = o.rot ?? rng() * TAU;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const col = o.color ?? WHITE;
  const [lo, hi] = o.shade ?? [0.66, 1.12];
  const sm = o.smooth ?? 0.8;
  const tone = o.tone !== false;
  const fj = o.faceJit ?? 0.025;
  const cy2 = Math.cos(o.yaw ?? 0), sy2 = Math.sin(o.yaw ?? 0);
  const bend = o.bend, bendK = o.bendK ?? 0.45;
  const aoY = o.aoY;
  const cache = new Map();
  const V = (d) => {
    let v = cache.get(d);
    if (v) return v;
    const f = 1 + jit * noise(d);
    const x = d[0] * f, z = d[2] * f;
    let y = d[1] * f;
    if (y < flat) y = flat + (y - flat) * squash;
    const ux = x * cs + z * sn, uz = -x * sn + z * cs;
    const X = ux * rx, Z = uz * rz;
    const p = [cx + X * cy2 + Z * sy2, cy + y * ry, cz - X * sy2 + Z * cy2];
    // soft normal: the ellipsoid's own normal through this point
    const dx = d[0] * cs + d[2] * sn, dz = -d[0] * sn + d[2] * cs;
    const nx = dx / rx, nz = dz / rz;
    const ny = (d[1] < flat ? d[1] * 1.6 : d[1]) / ry;
    let n = norm([nx * cy2 + nz * sy2, ny, -nx * sy2 + nz * cy2]);
    if (bend) {
      const e = bend(p);
      if (e) n = norm(madd(mul(n, 1 - bendK), e, bendK));
    }
    const t = aoY ? (p[1] - aoY[0]) / (aoY[1] - aoY[0]) : (d[1] + 1) / 2;
    v = { p, n, t, below: d[1] < cut };
    cache.set(d, v);
    return v;
  };
  const tris = o.detail === 'lo' ? loTris() : icoTris(o.detail ?? 1);
  for (const [a, bb, c] of tris) {
    const A = V(a), B = V(bb), C = V(c);
    if (A.below && B.below && C.below) continue;
    const k = 1 + fj * (rng() * 2 - 1);
    const ca = tone ? aoTone(col, A.t, lo * k, hi * k) : tint(col, (lo + (hi - lo) * clamp(A.t, 0, 1)) * k);
    const cb = tone ? aoTone(col, B.t, lo * k, hi * k) : tint(col, (lo + (hi - lo) * clamp(B.t, 0, 1)) * k);
    const cc = tone ? aoTone(col, C.t, lo * k, hi * k) : tint(col, (lo + (hi - lo) * clamp(C.t, 0, 1)) * k);
    if (sm <= 0) {
      b.tri(A.p, B.p, C.p, ca, cb, cc);
      continue;
    }
    const f = norm(cross(sub(B.p, A.p), sub(C.p, A.p)));
    const mixN = (n) => norm(madd(mul(f, 1 - sm), n, sm));
    b.triN(A.p, B.p, C.p, mixN(A.n), mixN(B.n), mixN(C.n), ca, cb, cc);
  }
}

// Generalised cylinder through pts with radii; faces coloured by color or colorFn(seg, side).
// smooth gives round (radial) normals.
export function tube(b, pts, radii, o = {}) {
  const n = o.sides ?? 6;
  const m = pts.length;
  const rs = o.radiusScale ?? 1 / Math.cos(Math.PI / (2 * n)); // keep the mean radius right
  const T = pts.map((p, i) => norm(sub(pts[Math.min(i + 1, m - 1)], pts[Math.max(i - 1, 0)])));
  let N = Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  N = norm(sub(N, mul(T[0], dot(N, T[0]))));
  const rings = [];
  const norms = [];
  const tw = o.twist ?? 0;
  for (let i = 0; i < m; i++) {
    if (i > 0) {
      const q = sub(N, mul(T[i], dot(N, T[i])));
      if (len(q) > 1e-6) N = norm(q);
    }
    const B = cross(T[i], N);
    const ring = [], nr = [];
    const twi = tw + (o.twistFn ? o.twistFn(i) : 0);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + twi;
      const r = radii[i] * rs * (o.wobble ? 1 + o.wobble(i, k) : 1);
      const dir = add(mul(N, Math.cos(a)), mul(B, Math.sin(a)));
      ring.push(add(pts[i], mul(dir, r)));
      nr.push(dir);
    }
    rings.push(ring);
    norms.push(nr);
  }
  for (let i = 0; i < m - 1; i++) {
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      const col = o.colorFn ? o.colorFn(i, k) : o.color;
      if (o.smooth) {
        const c0 = o.vcolorFn ? o.vcolorFn(i, k) : col, c1 = o.vcolorFn ? o.vcolorFn(i, k1) : col;
        const c2 = o.vcolorFn ? o.vcolorFn(i + 1, k1) : col, c3 = o.vcolorFn ? o.vcolorFn(i + 1, k) : col;
        b.triN(rings[i][k], rings[i][k1], rings[i + 1][k1], norms[i][k], norms[i][k1], norms[i + 1][k1], c0, c1, c2);
        b.triN(rings[i][k], rings[i + 1][k1], rings[i + 1][k], norms[i][k], norms[i + 1][k1], norms[i + 1][k], c0, c2, c3);
      } else {
        b.quad(rings[i][k], rings[i][k1], rings[i + 1][k1], rings[i + 1][k], col);
      }
    }
  }
  if (o.capEnd) {
    const c = pts[m - 1], r = rings[m - 1];
    const col = o.capColor ?? o.color ?? (o.colorFn && o.colorFn(m - 2, 0)) ?? (o.vcolorFn && o.vcolorFn(m - 1, 0));
    for (let k = 0; k < n; k++) b.tri(c, r[k], r[(k + 1) % n], col);
  }
  if (o.capStart) {
    const c = pts[0], r = rings[0];
    const col = o.capColor ?? o.color ?? (o.colorFn && o.colorFn(0, 0)) ?? (o.vcolorFn && o.vcolorFn(0, 0));
    for (let k = 0; k < n; k++) b.tri(c, r[(k + 1) % n], r[k], col);
  }
  return rings;
}

// Resample a polyline so no segment is longer than step (radii follow along).
function densify(pts, radii, step) {
  const P = [], R = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const n = Math.max(1, Math.round(len(sub(pts[i + 1], pts[i])) / step));
    for (let q = 0; q < n; q++) {
      P.push(lerp3(pts[i], pts[i + 1], q / n));
      R.push(radii[i] + (radii[i + 1] - radii[i]) * (q / n));
    }
  }
  P.push(pts[pts.length - 1]);
  R.push(radii[radii.length - 1]);
  return { pts: P, radii: R };
}

// Pleated fan leaf (talipot, sabal). c is the hastula, u the in-plane direction the
// blade points along, n its upper normal. span is the angle the blade covers; rim, when
// given, lightens the tips of alternate pleats.
export function fanLeaf(b, o) {
  const rng = o.rng ?? makeRng(7);
  const u = norm(o.u);
  const n = norm(sub(o.n, mul(u, dot(o.n, u))));
  const v = cross(n, u);
  const R = o.radius;
  const P = o.pleats ?? 16;
  const span = o.span ?? 5.0;
  const fold = o.fold ?? 0.06;
  const droop = o.droop ?? 0.18;
  const cup = o.cup ?? 0.12;
  const col = o.color;
  const rim = o.rim ?? null;
  const pt = (th, rr, h) => {
    const d = add(mul(u, Math.cos(th)), mul(v, Math.sin(th)));
    const z = h - droop * rr * rr + cup * Math.abs(Math.sin(th)) * rr;
    return add(add(o.c, mul(d, rr * R)), mul(n, z * R));
  };
  const rin = 0.36;
  const C = pt(0, 0, 0.015);
  for (let j = 0; j < P; j++) {
    const a0 = -span / 2 + (span * j) / P;
    const a1 = -span / 2 + (span * (j + 1)) / P;
    const am = (a0 + a1) / 2;
    const k = 1 + (j % 2 ? 0.06 : -0.05) + (rng() - 0.5) * 0.05;
    const ca = tint(col, k), cb = tint(col, k * 0.92);
    const tipA = rim && j % 2 ? rim : tint(col, k * 1.04);
    const tipB = rim && j % 2 ? tint(rim, 0.95) : tint(col, k * 0.97);
    const v0i = pt(a0, rin, -fold * rin), mi = pt(am, rin, fold * rin), v1i = pt(a1, rin, -fold * rin);
    const v0o = pt(a0, 1, -fold), mo = pt(am, 1.03, fold), v1o = pt(a1, 1, -fold);
    b.tri2(C, v0i, mi, tint(ca, 0.9), ca, ca);
    b.tri2(C, mi, v1i, tint(cb, 0.9), cb, cb);
    b.quad2(v0i, v0o, mo, mi, ca, tipA, tipA, ca);
    b.quad2(mi, mo, v1o, v1i, cb, tipB, tipB, cb);
    if (o.tips !== false) {
      const ta = pt((a0 + am) / 2, 1.13 + 0.08 * rng(), -fold * 0.3);
      const tb = pt((am + a1) / 2, 1.13 + 0.08 * rng(), -fold * 0.3);
      b.tri2(v0o, ta, mo, tipA);
      b.tri2(mo, tb, v1o, tipB);
    }
  }
}

// Points round the rim of a fan leaf (same shape as fanLeaf), for clearance tests.
export function fanRim(o, n = 9) {
  const u = norm(o.u);
  const nn = norm(sub(o.n, mul(u, dot(o.n, u))));
  const v = cross(nn, u);
  const span = o.span ?? 5.0, droop = o.droop ?? 0.18, cup = o.cup ?? 0.12, fold = o.fold ?? 0.06;
  const out = [];
  for (let k = 0; k <= n; k++) {
    const th = -span / 2 + (span * k) / n;
    const d = add(mul(u, Math.cos(th)), mul(v, Math.sin(th)));
    const z = -fold - droop + cup * Math.abs(Math.sin(th));
    out.push(add(add(o.c, mul(d, 1.13 * o.radius)), mul(nn, z * o.radius)));
  }
  return out;
}

// Feather (pinnate) frond: a drooping rachis with a comb of leaflets.
//   base, dir (horizontal unit), elev (radians), length, droop, width (longest
//   leaflet), hang (leaflet droop, 0..1), segs, color, rachisColor
export function pinnateFrond(b, o) {
  const L = o.length;
  const E = o.elev;
  const segs = o.segs ?? 7;
  const dir = norm([o.dir[0], 0, o.dir[2]]);
  const side = [dir[2], 0, -dir[0]];
  const droop = o.droop ?? 0.35;
  const hang = o.hang ?? 0.45;
  const rngf = o.rng ?? makeRng(3);
  const R = o.path
    ? (s) => o.path(s)
    : (s) => add(o.base, add(mul(dir, L * s * Math.cos(E)), mul(UP, L * (s * Math.sin(E) - droop * s * s))));
  const pts = [];
  for (let i = 0; i <= segs; i++) pts.push(R(i / segs));
  if (o.rachis !== false) {
    const r0 = o.rachisRadius ?? L * 0.018;
    const rp = pts.slice(0, Math.max(2, Math.ceil(segs * 0.75)));
    tube(b, rp, rp.map((_, i) => r0 * (1 - (0.7 * i) / rp.length)), { sides: 3, color: o.rachisColor ?? tint(o.color, 0.8) });
  }
  const per = o.leaflets ?? 2;
  for (let i = 0; i < segs; i++) {
    for (let q = 0; q < per; q++) {
      const s0 = (i + q / per) / segs, s1 = (i + (q + 1) / per) / segs, sm = (s0 + s1) / 2;
      const a = R(s0), c = R(s1), m = R(sm);
      const t = norm(sub(c, a));
      const w = o.width * Math.pow(Math.sin(Math.PI * clamp(sm * 0.92 + 0.06, 0, 1)), 0.75);
      const k = 1 + (rngf() - 0.5) * 0.12 - sm * 0.08;
      for (const sd of [-1, 1]) {
        const out = norm(add(mul(side, sd), mul(t, 0.5)));
        const tip = add(add(m, mul(out, w)), mul(UP, -w * hang * (0.6 + sm)));
        const lc = tint(o.color, sd > 0 ? k : k * 0.94);
        b.tri2(a, c, tip, tint(lc, 0.92), tint(lc, 0.96), tint(lc, 1.08));
      }
    }
  }
  return pts;
}

// A flat pointed leaf plate from base along dir, tilted by lift, width w, both sides.
export function leafPlate(b, base, dir, lengthM, w, col, lift = 0.25, bend = 0.15) {
  const d = norm(dir);
  let s = cross(UP, d);
  if (len(s) < 1e-4) s = [1, 0, 0];
  s = norm(s);
  const mid = add(add(base, mul(d, lengthM * 0.5)), mul(UP, lengthM * lift));
  const tip = add(add(base, mul(d, lengthM)), mul(UP, lengthM * (lift - bend)));
  const l = add(mid, mul(s, w * 0.5)), r = add(mid, mul(s, -w * 0.5));
  b.tri2(base, l, mid, tint(col, 0.9), col, col);
  b.tri2(base, mid, r, tint(col, 0.86), tint(col, 0.94), tint(col, 0.94));
  b.tri2(mid, l, tip, tint(col, 1.0), tint(col, 1.0), tint(col, 1.08));
  b.tri2(mid, tip, r, tint(col, 0.97), tint(col, 1.05), tint(col, 0.97));
}

// ---------------------------------------------------------------- mounds

// One soft dome of a bush mound, sitting on the ground at (x, y0, z) with plan radius
// R and height H. The occlusion runs from the ground (dark) to massTop (light), and
// the normals lean towards env(p), the envelope of the whole mound, so neighbouring
// puffs shade as one mass.
//   o: x, y0, z, R, H, color, seed, detail, env, massTop, sink (how far the centre
//   sits below y0), yaw, jit
export function moundPuff(b, o) {
  const H = o.H, R = o.R;
  const sink = o.sink ?? 0.08 * H;
  blob(b, {
    c: [o.x, o.y0 - sink, o.z], r: [R, H + sink, R], seed: o.seed, detail: o.detail ?? (R > 1.1 ? 2 : 1),
    jit: o.jit ?? 0.07, flat: -0.2, squash: 0.3, cut: -0.32, color: o.color, shade: o.shade ?? [0.64, 1.14],
    smooth: 0.9, bend: o.env, bendK: o.bendK ?? 0.4, aoY: [o.y0 - 0.1, o.y0 + (o.massTop ?? H)],
    yaw: o.yaw ?? 0,
  });
}

// ---------------------------------------------------------------- unit models

// Puff layouts in unit crown space (ellipsoid centre (0, 0.5, 0), radii 0.5).
const CROWN_LAYOUTS = {
  crownR: [ // round and plump: a big top puff over two side puffs
    [[0.0, 0.6, 0.0], [0.4, 0.36, 0.4]],
    [[0.2, 0.4, 0.1], [0.3, 0.27, 0.3]],
    [[-0.17, 0.42, -0.14], [0.31, 0.27, 0.31]],
  ],
  crownT: [ // a little lopsided and taller
    [[0.05, 0.64, 0.02], [0.35, 0.34, 0.35]],
    [[-0.16, 0.42, 0.12], [0.32, 0.3, 0.32]],
    [[0.19, 0.36, -0.12], [0.29, 0.25, 0.29]],
  ],
  // mangrove canopy: a wide, low dome with soft lumps, reaching down round the rim
  crownF1: [
    [[0.0, 0.42, 0.0], [0.5, 0.42, 0.5]],
    [[0.15, 0.68, 0.08], [0.3, 0.3, 0.3]],
    [[-0.17, 0.62, -0.12], [0.29, 0.28, 0.29]],
    [[0.02, 0.3, -0.26], [0.26, 0.24, 0.26]],
  ],
  crownF2: [
    [[0.0, 0.44, 0.0], [0.49, 0.42, 0.49]],
    [[-0.06, 0.7, 0.13], [0.31, 0.29, 0.31]],
    [[0.2, 0.58, -0.16], [0.26, 0.26, 0.26]],
    [[-0.25, 0.32, -0.05], [0.24, 0.22, 0.24]],
  ],
  puff: [
    [[0.0, 0.52, 0.0], [0.5, 0.46, 0.5]],
  ],
};

function unitCrown(key) {
  const b = new MeshBuilder();
  const seed = hashSeed(key);
  const detail = key === 'puff' ? 2 : 1;
  CROWN_LAYOUTS[key].forEach(([c, r], i) => {
    blob(b, {
      c, r, seed: seed + i * 17, jit: 0.07, flat: -0.45, squash: 0.35, detail: i === 0 ? detail : 'lo',
      shade: [0.64, 1.12], aoY: [0.05, 1.0], smooth: 0.85,
      bend: (p) => norm([p[0] * 0.8, (p[1] - 0.3) * 1.2, p[2] * 0.8]), bendK: 0.35,
    });
  });
  return b;
}

// A single plump bush dome from the ground, widest at the foot.
function unitDome() {
  const b = new MeshBuilder();
  blob(b, {
    c: [0, 0.0, 0], r: [0.5, 1.0, 0.5], seed: 91, detail: 2, jit: 0.06, flat: -0.2, squash: 0.3, cut: -0.45,
    shade: [0.64, 1.14], aoY: [-0.05, 1.0], smooth: 0.9,
  });
  return b;
}

// Three small leaf puffs about the origin, for perches on bushes and branch tips.
function unitLeaf3() {
  const b = new MeshBuilder();
  const P = [[[0.0, 0.0, 0.0], [0.62, 0.42, 0.62]], [[0.55, 0.1, 0.25], [0.45, 0.34, 0.45]], [[-0.35, 0.12, -0.5], [0.42, 0.32, 0.42]]];
  P.forEach(([c, r], i) => blob(b, {
    c, r, seed: 300 + i, detail: 1, jit: 0.06, flat: -0.5, squash: 0.5, shade: [0.72, 1.1], aoY: [-0.4, 0.5], smooth: 0.85,
  }));
  return b;
}

function unitHerb() {
  // Crinum lily: strap leaves in a fountain, a flower stalk with pink trumpets
  const b = new MeshBuilder();
  const rng = makeRng(hashSeed('herb'));
  const green = lin('#74b848');
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = i * GOLDEN;
    const d = [Math.cos(a), 0, Math.sin(a)];
    const s = [-d[2], 0, d[0]];
    const reach = 0.3 + rng() * 0.2, rise = 0.55 + rng() * 0.4;
    const pts = [];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      pts.push([d[0] * reach * t, rise * (t * 1.6 - t * t * 0.9), d[2] * reach * t]);
    }
    const col = tint(green, 0.85 + rng() * 0.3);
    for (let k = 0; k < 4; k++) {
      const w0 = 0.055 * (1 - k / 5), w1 = 0.055 * (1 - (k + 1) / 5);
      const a0 = madd(pts[k], s, w0), b0 = madd(pts[k], s, -w0);
      const a1 = madd(pts[k + 1], s, w1), b1 = madd(pts[k + 1], s, -w1);
      b.quad2(a0, b0, b1, a1, tint(col, 0.8 + k * 0.08));
    }
  }
  const stalkTop = [0.04, 0.95, 0.02];
  tube(b, [[0, 0, 0], [0.02, 0.5, 0.01], stalkTop], [0.018, 0.015, 0.012], { sides: 3, color: lin('#7faa4a') });
  const pink = lin('#ff9ec4'), white = lin('#fff4f2');
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.3;
    const d = norm([Math.cos(a), -0.35, Math.sin(a)]);
    const base = madd(stalkTop, d, 0.03);
    const tip = madd(base, d, 0.14);
    const s = norm(cross(d, UP));
    const t2 = norm(cross(d, s));
    for (let k = 0; k < 4; k++) {
      const q0 = (k / 4) * TAU, q1 = ((k + 1) / 4) * TAU;
      const e0 = madd(madd(tip, s, Math.cos(q0) * 0.045), t2, Math.sin(q0) * 0.045);
      const e1 = madd(madd(tip, s, Math.cos(q1) * 0.045), t2, Math.sin(q1) * 0.045);
      b.tri2(base, e0, e1, k % 2 ? pink : white);
    }
  }
  return b;
}

// A fern: seven arching fronds from a tight crown, radius about 1, height about 0.8.
function unitFern() {
  const b = new MeshBuilder();
  const rng = makeRng(hashSeed('fern'));
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = i * GOLDEN + rng() * 0.3;
    pinnateFrond(b, {
      base: [0, 0.02, 0], dir: [Math.cos(a), 0, Math.sin(a)], elev: 0.95 + rng() * 0.35, length: 0.95 + rng() * 0.15,
      droop: 0.75, width: 0.2, segs: 5, leaflets: 1, hang: 0.3, rachis: false, rng,
      color: tint(WHITE, 0.86 + rng() * 0.22),
    });
  }
  return b;
}

// Unit trunk: a root flare at the foot, straight, tapering near the top; darker at
// the foot (occlusion) and round-shaded.
function unitTrunk() {
  const b = new MeshBuilder();
  const ys = [-0.02, 0.0, 0.04, 0.12, 0.6, 1.0];
  const rs = [1.45, 1.38, 1.14, 1.0, 1.0, 0.62];
  const shade = [0.66, 0.7, 0.82, 0.95, 1.02, 1.05];
  const rng = makeRng(11);
  const sides = 7;
  const sh = Array.from({ length: sides }, () => 0.94 + rng() * 0.1);
  tube(b, ys.map((y) => [0, y, 0]), rs, {
    sides, capEnd: true, smooth: true,
    vcolorFn: (i, k) => tint(WHITE, shade[i] * sh[k % sides]),
  });
  return b;
}

// Mangrove prop roots: neat half-arches from the stem, each leaving it outwards and a
// little upwards, curving over and landing straight down on a ring at radius ~1.
function unitArches(variant) {
  const b = new MeshBuilder();
  const rng = makeRng(hashSeed('arches', variant));
  const n = variant === 0 ? 5 : 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng() * 0.35;
    const d = [Math.cos(a), 0, Math.sin(a)];
    const top = 0.62 + rng() * 0.3;
    const reach = 0.85 + rng() * 0.2;
    const A = [d[0] * 0.04, top, d[2] * 0.04];
    const B = [d[0] * reach, -0.25, d[2] * reach];
    const pts = bezier3(A, madd(A, norm([d[0], 0.55, d[2]]), 0.42 * reach), madd(B, UP, 0.7 * top), B, 6);
    tube(b, pts, pts.map((_, k) => 0.07 - 0.028 * (k / 6)), {
      sides: 4, smooth: true,
      vcolorFn: (s2) => tint(WHITE, 1.06 - Math.max(0, 0.4 - pts[Math.min(s2, 6)][1]) * 0.5),
    });
  }
  return b;
}

function unitLog() {
  const b = new MeshBuilder();
  const rng = makeRng(31);
  const bark = lin('#8a6a4c'), moss = lin('#8cc152'), cut = lin('#f0d9a8'), ring = lin('#c89e6a');
  const pts = [[-0.5, 0, 0], [-0.2, 0.03, 0.02], [0.15, -0.02, -0.02], [0.5, 0.01, 0]];
  const rings = tube(b, pts, [1, 1.04, 0.97, 0.94], {
    sides: 7,
    colorFn: (i, k) => (k === 1 || (k === 2 && i === 1) ? tint(moss, 0.9 + rng() * 0.2) : tint(bark, 0.86 + rng() * 0.2)),
  });
  for (const [end, sgn] of [[0, -1], [3, 1]]) {
    const c = pts[end];
    const r = rings[end];
    const inner = r.map((p) => lerp3(c, p, 0.55));
    for (let k = 0; k < 7; k++) {
      const k1 = (k + 1) % 7;
      if (sgn > 0) {
        b.tri(c, inner[k], inner[k1], cut);
        b.quad(inner[k], r[k], r[k1], inner[k1], ring);
      } else {
        b.tri(c, inner[k1], inner[k], cut);
        b.quad(inner[k1], r[k1], r[k], inner[k], ring);
      }
    }
  }
  return b;
}

const UNIT_MAKERS = {
  trunk: { make: unitTrunk, mat: 'wood', sway: 1 },
  arches0: { make: () => unitArches(0), mat: 'wood', sway: 0.2 },
  arches1: { make: () => unitArches(1), mat: 'wood', sway: 0.2 },
  log: { make: unitLog, mat: 'wood', sway: 0, absolute: true },
  crownR: { make: () => unitCrown('crownR'), mat: 'leaf' },
  crownT: { make: () => unitCrown('crownT'), mat: 'leaf' },
  crownF1: { make: () => unitCrown('crownF1'), mat: 'leaf' },
  crownF2: { make: () => unitCrown('crownF2'), mat: 'leaf' },
  puff: { make: () => unitCrown('puff'), mat: 'leaf' },
  dome: { make: unitDome, mat: 'leaf' },
  leaf3: { make: unitLeaf3, mat: 'leaf' },
  fern: { make: unitFern, mat: 'leaf' },
  herb: { make: unitHerb, mat: 'leaf', absolute: true },
};

export const UNIT_KEYS = Object.keys(UNIT_MAKERS);
const _unitCache = new Map();

// Shared unit geometry and its material slot ('wood' or 'leaf').
export function makeUnitGeometry(key) {
  if (!_unitCache.has(key)) {
    const spec = UNIT_MAKERS[key];
    if (!spec) throw new Error(`unknown model ${key}`);
    const b = spec.make();
    if (spec.sway != null) b.s.fill(spec.sway);
    const g = b.toGeometry();
    g.name = key;
    _unitCache.set(key, { geometry: g, mat: spec.mat, absolute: !!spec.absolute });
  }
  return _unitCache.get(key);
}

// Plan radius of a unit model's widest part between two unit heights.
export function unitRadius(key, y0 = 0, y1 = 1) {
  const pos = makeUnitGeometry(key).geometry.attributes.position;
  let r = 0;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y >= y0 && y <= y1) r = Math.max(r, Math.hypot(pos.getX(i), pos.getZ(i)));
  }
  return r;
}

// ---------------------------------------------------------------- bespoke models

// Host geometry a builder reports, in the shape vegetation.js passes on as veg.hosts.
function hostsOut() {
  return { trunks: [], crowns: [], branches: [], palms: [] };
}

// Shared trunk path: straight and vertical from yBottom to yStraight at (x, z), then a
// quadratic bend to top. A root flare widens the foot up to flareTop. Returns points
// and radii.
function trunkPath(x, z, yBottom, yStraight, top, r, rTop, o = {}) {
  const flare = o.flare ?? 1.3;
  const fTop = Math.max(yBottom + 0.12, Math.min(o.flareTop ?? yBottom + 0.5, yStraight - 0.1));
  const pts = [[x, yBottom, z], [x, yBottom + 0.12, z], [x, lerp(yBottom + 0.12, fTop, 0.45), z], [x, fTop, z]];
  const radii = [r * flare, r * (1 + (flare - 1) * 0.8), r * (1 + (flare - 1) * 0.25), r];
  const nS = Math.max(1, Math.round((yStraight - fTop) / 1.2));
  for (let i = 1; i <= nS; i++) {
    pts.push([x, fTop + ((yStraight - fTop) * i) / nS, z]);
    radii.push(r);
  }
  const s = [x, yStraight, z];
  const rise = top[1] - yStraight;
  if (rise > 0.05) {
    const ctrl = [x, yStraight + rise * 0.55, z];
    const n = Math.max(2, Math.round(Math.hypot(rise, top[0] - x, top[2] - z) / (o.step ?? 0.8)));
    const bz = bezier(s, ctrl, top, n);
    for (let i = 1; i < bz.length; i++) {
      pts.push(bz[i]);
      radii.push(r + (rTop - r) * (i / (bz.length - 1)));
    }
  }
  return { pts, radii };
}
const lerp = (a, b, t) => a + (b - a) * t;

// Bark colour along a trunk: darker at the foot (occlusion), gentle streaks round it.
function barkVColor(bark, rng, sides, pts, y0) {
  const sh = Array.from({ length: sides }, () => 0.92 + rng() * 0.14);
  return (i, k) => {
    const h = pts[Math.min(i, pts.length - 1)][1] - y0;
    const ao = 0.66 + 0.34 * smooth01(h / 1.2);
    return tint(bark, ao * sh[k % sides]);
  };
}

// Broadleaf landmark: trunk(s) with a root flare, two or three curved limbs and a
// crown of a few plump soft puffs, open underneath so the trunk and limbs show.
//   spec: owner, x, y, z, yBottom (below ground), stems [{x, z, r, straightTo, flareTop}],
//   height, crownBase, cx, cz, rx, rz, leaf, bark, seed, walkable(x, z) optional,
//   headroom (default 1.9), extra: [{x, z, top, w}] puffs folded in from nearby canopy
export function buildBroadleaf(wood, leaf, spec) {
  const out = hostsOut();
  const rng = makeRng(spec.seed);
  const { x, y, z, height, cx, cz, rx, rz } = spec;
  const yTop = y + height;
  const R = (rx + rz) / 2;
  const walk = spec.walkable ?? (() => false);
  const headroom = spec.headroom ?? 1.9;
  const lowest = y + Math.max(spec.crownBase, 0.25) + 1.0;
  const depth = clamp(1.2 * R, 2.4, Math.max(2.4, yTop - lowest));
  const domeBot = Math.max(yTop - depth, lowest);
  const D = yTop - domeBot;
  const dCy = (yTop + domeBot) / 2, dRy = D / 2;
  const leafCol = spec.leaf;
  const bark = spec.bark;
  const stems = spec.stems;
  const mx = stems.reduce((s, t) => s + t.x, 0) / stems.length;
  const mz = stems.reduce((s, t) => s + t.z, 0) / stems.length;
  const forkY = Math.max(domeBot + 0.15 * dRy, y + 2.4);
  const forks = [];

  stems.forEach((st) => {
    const yS = Math.max(st.straightTo ?? 0, y + clamp(0.4 * height, 1.5, 3.4));
    const spread = stems.length > 1 ? 2.2 : 0;
    const top = [cx + (st.x - mx) * spread * 2.5, Math.max(forkY + (rng() - 0.5) * 0.5, yS + 0.8), cz + (st.z - mz) * spread * 2.5];
    const { pts, radii } = trunkPath(st.x, st.z, spec.yBottom, Math.min(yS, top[1] - 0.6), top, st.r, st.r * 0.62, {
      flare: 1.4, flareTop: st.flareTop ?? y + 0.55,
    });
    tube(wood, pts, radii, { sides: 8, capEnd: true, smooth: true, vcolorFn: barkVColor(bark, rng, 8, pts, y) });
    out.trunks.push({ owner: spec.owner, x: st.x, z: st.z, y0: spec.yBottom, y1: Math.min(yS, top[1] - 0.6), r0: st.r, r1: st.r });
    forks.push({ p: top, r: st.r * 0.62 });
  });

  // Crown: a big top puff and a ring of three to five plump puffs round it
  const puffs = [];
  puffs.push({ c: [cx + (rng() - 0.5) * 0.1 * rx, dCy + 0.28 * dRy, cz + (rng() - 0.5) * 0.1 * rz], r: [0.64 * rx, 0.72 * dRy, 0.64 * rz], k: 1.04 });
  const k = R < 3.2 ? 3 : R < 5.5 ? 4 : 5;
  const a0 = rng() * TAU;
  for (let i = 0; i < k; i++) {
    const a = a0 + (i / k) * TAU + (rng() - 0.5) * 0.5;
    const s = 0.5 + rng() * 0.07;
    const c = [cx + Math.cos(a) * 0.5 * rx, dCy - 0.1 * dRy + (rng() - 0.5) * 0.12 * dRy, cz + Math.sin(a) * 0.5 * rz];
    puffs.push({ c, r: [s * rx, 0.62 * dRy, s * rz], k: 0.95 + rng() * 0.06 });
  }
  for (const e of spec.extra ?? []) {
    const pr = 0.55 * e.w, ph = 0.42 * e.w;
    puffs.push({ c: [e.x, Math.max(e.top - ph, domeBot), e.z], r: [pr, ph, pr], k: 0.97, extra: true });
  }
  // keep low puffs above the player's head wherever they overhang open ground
  for (const p of puffs) {
    const bottom = p.c[1] - 0.8 * p.r[1];
    if (bottom >= y + headroom) continue;
    let over = walk(p.c[0], p.c[2]);
    for (let k = 0; k < 10 && !over; k++) {
      const a = (k / 10) * TAU;
      over = walk(p.c[0] + Math.cos(a) * p.r[0] * 0.85, p.c[2] + Math.sin(a) * p.r[2] * 0.85);
    }
    if (over) p.c[1] += y + headroom - bottom;
  }

  // Limbs from the fork(s) to the ring puffs: two or three show below the crown
  const limbTo = puffs.slice(1).filter((p, i) => p.extra || i % 2 === 0 || puffs.length <= 4);
  limbTo.forEach((p, i) => {
    const f = forks[i % forks.length];
    const start = f.p;
    const end = lerp3(start, [p.c[0], p.c[1] - 0.2 * p.r[1], p.c[2]], 0.8);
    const ctrl = add(lerp3(start, end, 0.45), [0, 0.3 * len(sub(end, start)), 0]);
    const lp = bezier(start, ctrl, end, 4);
    const r0 = Math.max(0.04, f.r * 0.75);
    tube(wood, lp, lp.map((_, j) => r0 * (1 - j * 0.14)), { sides: 6, smooth: true, color: tint(bark, 0.96) });
    out.branches.push({ owner: spec.owner, a: start, b: end, r: r0 * 0.7 });
  });

  puffs.forEach((p, i) => {
    blob(leaf, {
      c: p.c, r: p.r, seed: spec.seed + i * 131, detail: 2, jit: 0.07, flat: -0.5, squash: 0.35,
      color: tint(leafCol, p.k), shade: [0.62, 1.12], aoY: [domeBot - 0.3, yTop], smooth: 0.88,
      bend: (q) => norm([(q[0] - cx) / rx, (q[1] - domeBot) / D * 1.2, (q[2] - cz) / rz]), bendK: 0.35,
    });
  });

  out.crowns.push({ owner: spec.owner, cx, cy: dCy, cz, rx, ry: dRy, rz });
  return out;
}

// Rainbow eucalyptus: a tall straight trunk wound with bright candy stripes, a few
// splayed limbs high up and an umbrella of flat-bottomed puffs.
//   spec as buildBroadleaf, plus bands (colours in order), cream (streak colour),
//   flareTop, straightTo
export function buildEucalyptus(wood, leaf, spec) {
  const out = hostsOut();
  const rng = makeRng(spec.seed);
  const { y, height, cx, cz, rx, rz } = spec;
  const st = spec.stems[0];
  const B = spec.bands;
  const cream = spec.cream ?? lin('#f4ead0');
  const yTop = y + height;
  const forkY = y + height * 0.62;
  const mid = lerp3([st.x, 0, st.z], [cx, 0, cz], 0.35);
  const top = [mid[0], forkY, mid[2]];
  const yS = Math.max(y + 4.2, st.straightTo ?? 0);
  const path = trunkPath(st.x, st.z, spec.yBottom, yS, top, st.r, st.r * 0.8, { flare: 1.6, flareTop: st.flareTop ?? y + 0.8, step: 0.9 });
  const { pts, radii } = densify(path.pts, path.radii, 0.12);
  // Helical candy stripes, one turn per 3 m and seven bands a turn (0.43 m tall): the
  // face columns twist with the helix, so every column keeps one colour and the band
  // edges run cleanly along the stripes. A thin cream streak edges every other band.
  const sides = 28, perBand = 4, pitch = 3.0;
  const twistFn = (i) => -TAU * (pts[i][1] - y) / pitch;
  const band = (i, k) => {
    const b = Math.floor(k / perBand), c = k % perBand;
    if (c === perBand - 1 && b % 2 === 0) return tint(cream, 0.97);
    const foot = 0.7 + 0.3 * smooth01((pts[i][1] - y) / 1.0);
    return tint(B[b % B.length], foot * (c === 0 ? 1.04 : 1));
  };
  tube(wood, pts, radii, { sides, capEnd: true, smooth: true, colorFn: band, twistFn });
  out.trunks.push({ owner: spec.owner, x: st.x, z: st.z, y0: spec.yBottom, y1: yS, r0: st.r, r1: st.r });

  const R = (rx + rz) / 2;
  const nLimb = 4;
  const ends = [];
  for (let i = 0; i < nLimb; i++) {
    const a = (i / nLimb) * TAU + rng() * 0.6;
    const pr = 0.34 + rng() * 0.14;
    const end = [cx + Math.cos(a) * rx * pr, yTop - 2.8 - rng() * 1.2, cz + Math.sin(a) * rz * pr];
    const ctrl = [lerp3(top, end, 0.3)[0], lerp3(top, end, 0.7)[1], lerp3(top, end, 0.3)[2]];
    const lp = bezier(top, ctrl, end, 6);
    const r0 = st.r * 0.6;
    tube(wood, lp, lp.map((_, k) => r0 * (1 - k * 0.09)), { sides: 14, smooth: true, colorFn: (s2, k) => band(Math.min(pts.length - 1, 20 + s2 * 3 + i * 5), (k * 2 + i * 5) % sides) });
    out.branches.push({ owner: spec.owner, a: top, b: end, r: r0 * 0.7 });
    ends.push(end);
  }
  // umbrella: a ring of flat-bottomed puffs round a raised centre puff
  const nPuff = clamp(Math.round(R * 0.9), 6, 8);
  const depth = Math.min(yTop - (forkY + 0.5), 4.2);
  const cyBase = yTop - depth;
  const puffs = [{ c: [cx, cyBase + depth * 0.55, cz], r: [rx * 0.5, depth * 0.45, rz * 0.5] }];
  const a0 = rng() * TAU;
  for (let i = 0; i < nPuff; i++) {
    const a = a0 + (i / nPuff) * TAU + (rng() - 0.5) * 0.3;
    const s = clamp(R * (0.3 + rng() * 0.05), 1.4, 2.6);
    const c = [cx + Math.cos(a) * (rx - s * 0.8), cyBase + depth * 0.32 + (rng() - 0.5) * 0.4, cz + Math.sin(a) * (rz - s * 0.8)];
    puffs.push({ c, r: [s, s * 0.52, s] });
  }
  puffs.forEach((p, i) => {
    blob(leaf, {
      c: p.c, r: p.r, seed: spec.seed + i * 13, detail: 2, jit: 0.08, flat: -0.25, squash: 0.15,
      color: tint(spec.leaf, 0.95 + rng() * 0.1), shade: [0.66, 1.12], aoY: [cyBase - 0.3, yTop], smooth: 0.88,
      bend: (q) => norm([(q[0] - cx) / rx, (q[1] - cyBase) / depth, (q[2] - cz) / rz]), bendK: 0.3,
    });
    if (i === 0) return;
    let e = ends[0], bd = Infinity;
    for (const q of ends) { const d = len(sub(q, p.c)); if (d < bd) { bd = d; e = q; } }
    if (bd > p.r[0] * 0.7) tube(wood, [e, lerp3(e, p.c, 0.75)], [st.r * 0.25, st.r * 0.16], { sides: 5, color: tint(B[2 % B.length], 0.9) });
  });
  out.crowns.push({ owner: spec.owner, cx, cy: cyBase + depth / 2, cz, rx, ry: depth / 2, rz });
  return out;
}

// Palm trunk with rings: straight to yStraight, then an S-curve (bend) to top.
function palmTrunk(wood, spec, rng, top, rTop, ringed = true) {
  const { x, z, r } = spec;
  const yS = Math.min(spec.yStraight, top[1] - 0.3);
  const s0 = [x, yS, z];
  const dx = top[0] - x, dz = top[2] - z;
  const bend = spec.sBend ?? [0, 0];
  const H = top[1] - yS;
  const p1 = [x + bend[0], yS + H * 0.35, z + bend[1]];
  const p2 = [top[0] - bend[0] * 0.6 - dx * 0.1, yS + H * 0.72, top[2] - bend[1] * 0.6 - dz * 0.1];
  const base = [[x, spec.yBottom, z], [x, spec.yBottom + 0.12, z], [x, Math.max(spec.yBottom + 0.2, spec.y + 0.35), z], s0];
  const radiiB = [r * 1.25, r * 1.15, r * 1.02, r];
  const curve = bezier3(s0, p1, p2, top, Math.max(3, Math.round(Math.hypot(H, dx, dz) / 0.5))).slice(1);
  const pts = base.concat(curve);
  const radii = radiiB.concat(curve.map((_, i) => r + (rTop - r) * ((i + 1) / curve.length)));
  const d = densify(pts, radii, 0.3);
  const bark = spec.bark;
  const ring = spec.ringColor ?? tint(bark, 0.78);
  tube(wood, d.pts, d.radii, {
    sides: 8, capEnd: true, smooth: true,
    wobble: ringed ? (i) => (i % 2 ? -0.05 : 0.03) : null,
    vcolorFn: (i, k) => {
      const h = d.pts[Math.min(i, d.pts.length - 1)][1] - spec.y;
      const ao = 0.7 + 0.3 * smooth01(h / 1.0);
      return tint(ringed && i % 2 ? ring : bark, ao * (0.96 + 0.05 * ((k * 7) % 3) / 2));
    },
  });
  return yS;
}

// Palms: 'fan' (sabal, hat palm, thatch), 'feather' (coconut, Attalea and most palms),
// 'royal', 'nipa' (short stout stem, arching fronds) and 'small' (a juvenile tuft).
//   spec: owner, x, y, z, yBottom, r, height, crownR (reach of the outermost tips),
//   frondLo (lowest tip above y), style, bend [dx, dz] (lean of the crown), sBend
//   [dx, dz] (the jaunty S of a fan palm's trunk), straightTo (keep the trunk straight
//   below this y), bark, leaf, rim, dead, seed
export function buildPalm(wood, leaf, spec) {
  const out = hostsOut();
  const rng = makeRng(spec.seed);
  const { x, y, z, height, crownR, style } = spec;
  const leafCol = spec.leaf;
  const bend = spec.bend ?? [0, 0];
  const dead = spec.dead ?? lin('#c9a46a');

  if (style === 'small') {
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = i * GOLDEN + rng();
      pinnateFrond(leaf, {
        base: [x, y + 0.05, z], dir: [Math.cos(a), 0, Math.sin(a)], elev: 0.9 + rng() * 0.4,
        length: height * 0.95, droop: 0.55, width: height * 0.22, segs: 5, color: tint(leafCol, 0.9 + rng() * 0.2), rng, rachis: false,
      });
    }
    out.palms.push({ owner: spec.owner, cx: x, cy: y + height * 0.6, cz: z, r: crownR });
    out.attach = [x, y + 0.1, z];
    return out;
  }

  let T;
  if (style === 'nipa') {
    // no woody trunk: a bundle of stout leaf stalks from the ground, each running on
    // into a frond that arches outwards. Their outer faces sit on the stem radius r.
    const yT = y + Math.max(0.5, 0.8 * spec.frondLo);
    T = [x, yT, z];
    const n = 7 + Math.floor(rng() * 3);
    const pr = Math.min(0.07, spec.r * 0.5);
    const ring = Math.max(0.02, spec.r - pr);
    const L = 0.8 * Math.hypot(y + height - yT, crownR) * 1.05;
    const stalk = hsl(leafCol, -0.03, 0.75, 0.8);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rng() * 0.3;
      const d = [Math.cos(a), 0, Math.sin(a)];
      const b0 = [x + d[0] * ring * 0.7, spec.yBottom, z + d[2] * ring * 0.7];
      const b1 = [x + d[0] * ring, y + 0.15, z + d[2] * ring];
      const top = [x + d[0] * (ring + 0.14), yT, z + d[2] * (ring + 0.14)];
      tube(wood, [b0, b1, lerp3(b1, top, 0.5), top], [pr * 1.2, pr, pr * 0.95, pr * 0.8], {
        sides: 4, colorFn: (q) => tint(q === 0 ? spec.bark : stalk, (i % 2 ? 0.92 : 1.04) * (q === 0 ? 0.8 : 1)),
      });
      const fa = a + (rng() - 0.5) * 0.3;
      let fl = L * (0.88 + rng() * 0.18), fe = 0.72 + rng() * 0.2;
      // over open ground the frond stays short and steep, clear of the player
      const walk = spec.walkable ?? (() => false);
      if (walk(top[0] + Math.cos(fa) * fl * 0.7, top[2] + Math.sin(fa) * fl * 0.7)) { fl *= 0.55; fe = 1.15; }
      pinnateFrond(leaf, {
        base: top, dir: [Math.cos(fa), 0, Math.sin(fa)], elev: fe,
        length: fl, droop: 0.55, width: L * 0.17, segs: 7, hang: 0.4,
        color: tint(leafCol, 0.92 + rng() * 0.16), rachisColor: stalk, rng,
      });
    }
    out.trunks.push({ owner: spec.owner, x, z, y0: spec.yBottom, y1: yT, r0: spec.r, r1: spec.r });
    out.palms.push({ owner: spec.owner, cx: x, cy: (yT + y + height) / 2, cz: z, r: crownR });
    out.attach = T;
    return out;
  }

  if (style === 'fan') {
    // Tiers of big fans on arching petioles: the petiole and blade are scaled so a
    // level fan's tip reaches crownR.
    const pl = 0.44 * crownR, fr = 0.5 * crownR;
    const yT = Math.max(y + height - 0.62 * crownR, y + 1.4);
    T = [x + bend[0], yT, z + bend[1]];
    const yS = palmTrunk(wood, { ...spec, yStraight: Math.max(spec.straightTo ?? 0, y + Math.min(3.2, 0.4 * (yT - y))) }, rng, T, spec.r * 0.85);
    out.trunks.push({ owner: spec.owner, x, z, y0: spec.yBottom, y1: yS, r0: spec.r, r1: spec.r });
    // a tidy collar of old leaf bases under the crown
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + rng() * 0.3;
      blob(wood, {
        c: [T[0] + Math.cos(a) * spec.r * 0.9, T[1] - 0.18 - (i % 2) * 0.12, T[2] + Math.sin(a) * spec.r * 0.9],
        r: [spec.r * 0.55, 0.16, spec.r * 0.55], detail: 0, seed: spec.seed + 60 + i, jit: 0.05, smooth: 0.5, color: tint(spec.bark, 0.82), shade: [0.8, 1.05],
      });
    }
    const tiers = [
      { n: 4, e: 1.05, droop: 0.12, k: 1.08 },
      { n: 6, e: 0.45, droop: 0.2, k: 1.0 },
      { n: 5, e: 0.02, droop: 0.28, k: 0.94 },
    ];
    let a = rng() * TAU;
    for (const tr of tiers) {
      for (let i = 0; i < tr.n; i++) {
        a += TAU / tr.n + (rng() - 0.5) * 0.25;
        const e = tr.e + (rng() - 0.5) * 0.15;
        const dH = [Math.cos(a), 0, Math.sin(a)];
        const hast = [T[0] + dH[0] * pl * Math.cos(e), T[1] + pl * Math.sin(e), T[2] + dH[2] * pl * Math.cos(e)];
        const ctrl = madd(lerp3(T, hast, 0.5), UP, pl * 0.18);
        tube(leaf, bezier(T, ctrl, hast, 3), [0.045, 0.04, 0.033, 0.028], { sides: 4, color: tint(leafCol, 0.72) });
        const u = norm(add(sub(hast, ctrl), mul(UP, 0.25)));
        const nUp = norm(sub(UP, mul(u, dot(UP, u) * 0.9)));
        fanLeaf(leaf, {
          c: hast, u, n: nUp, radius: fr * (0.92 + rng() * 0.12), pleats: 13, span: 4.3, fold: 0.07, droop: tr.droop, cup: 0.16,
          color: tint(leafCol, tr.k * (0.95 + rng() * 0.1)), rim: spec.rim, rng,
        });
      }
    }
    // a short skirt of old fans hanging down
    const nd = 3 + Math.floor(rng() * 2);
    for (let i = 0; i < nd; i++) {
      const b2 = (i / nd) * TAU + rng();
      const d = norm([Math.cos(b2) * 0.35, -1, Math.sin(b2) * 0.35]);
      const hast = madd(T, d, 0.3 * crownR);
      fanLeaf(leaf, {
        c: hast, u: d, n: norm([Math.cos(b2), 0.15, Math.sin(b2)]), radius: 0.3 * crownR, pleats: 9, span: 2.4, fold: 0.05, droop: 0.02, cup: 0.35,
        color: tint(dead, 0.92 + rng() * 0.14), rng,
      });
    }
    out.palms.push({ owner: spec.owner, cx: T[0], cy: T[1], cz: T[2], r: crownR });
    out.attach = T;
    out.fanR = fr;
    return out;
  }

  const L = crownR * (style === 'royal' ? 1.05 : 1.0);
  const riseAbove = style === 'royal' ? 0.35 * L : 0.42 * L;
  const yT = Math.max(y + height - riseAbove, y + 1.2);
  T = [x + bend[0], yT, z + bend[1]];
  const yS = palmTrunk(wood, { ...spec, yStraight: Math.max(spec.straightTo ?? 0, y + Math.min(4.0, 0.5 * (yT - y))) }, rng, T, spec.r * 0.82, style !== 'royal');
  out.trunks.push({ owner: spec.owner, x, z, y0: spec.yBottom, y1: yS, r0: spec.r, r1: spec.r });

  if (style === 'royal') {
    const shaft = lin('#9cc45e');
    tube(wood, [madd(T, UP, -1.6), madd(T, UP, -0.8), madd(T, UP, 0.25)], [spec.r * 0.85, spec.r * 0.9, spec.r * 0.7], { sides: 7, capEnd: true, smooth: true, color: shaft });
  } else {
    blob(wood, { c: madd(T, UP, -0.15), r: [spec.r * 1.5, 0.35, spec.r * 1.5], detail: 0, seed: spec.seed + 3, smooth: 0.4, color: tint(spec.bark, 0.8), shade: [0.8, 1.05] });
  }
  const n = style === 'royal' ? 13 : 12;
  for (let i = 0; i < n; i++) {
    const a = i * GOLDEN + rng() * 0.25;
    const age = i / (n - 1);
    const elev = style === 'royal' ? 0.75 - age * 1.0 : 1.0 - age * 1.2;
    const droop = style === 'royal' ? 0.45 + age * 0.2 : 0.3 + age * 0.3;
    pinnateFrond(leaf, {
      base: T, dir: [Math.cos(a), 0, Math.sin(a)], elev: elev + (rng() - 0.5) * 0.15,
      length: L * (0.9 + rng() * 0.15), droop, width: L * 0.2, segs: 7, hang: 0.5,
      color: tint(leafCol, 1.04 - age * 0.12 + (rng() - 0.5) * 0.1), rng,
    });
  }
  if (style === 'feather') {
    for (let i = 0; i < 2; i++) {
      const a = rng() * TAU;
      pinnateFrond(leaf, {
        base: madd(T, UP, -0.2), dir: [Math.cos(a), 0, Math.sin(a)], elev: -0.9 - rng() * 0.3,
        length: L * 0.7, droop: 0.1, width: L * 0.13, segs: 5, hang: 0.7, color: tint(dead, 0.9 + rng() * 0.2), rng,
      });
    }
    if (spec.nuts) {
      const nut = lin('#9c8a3a');
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + rng() * 0.4;
        blob(wood, { c: [T[0] + Math.cos(a) * spec.r * 1.3, T[1] - 0.25 - rng() * 0.2, T[2] + Math.sin(a) * spec.r * 1.3], r: [0.13, 0.15, 0.13], detail: 1, seed: spec.seed + 50 + i, jit: 0.05, color: tint(nut, 0.9 + rng() * 0.2), shade: [0.75, 1.1] });
      }
    }
  }
  out.palms.push({ owner: spec.owner, cx: T[0], cy: T[1], cz: T[2], r: crownR });
  out.attach = T;
  out.fanR = 0;
  return out;
}

// Talipot (Corypha umbraculifera): a stout straight ringed trunk, a knobbly collar of
// old leaf bases, and huge pleated fans on long petioles tilted up to face the path.
//   spec: owner, x, y, z, yBottom, r, height, crownBase, cx, cz, rx, rz, bark, ring,
//   leaf, rim, seed, walkable(x, z) optional, fanScale (default 1.15)
export function buildTalipot(wood, leaf, spec) {
  const out = hostsOut();
  const rng = makeRng(spec.seed);
  const { x, y, z, height, cx, cz, rx, rz } = spec;
  const walk = spec.walkable ?? (() => false);
  const yT = y + Math.max(2.8, 0.34 * height);
  const T = [x, yT, z];
  // trunk: a dark ring every 0.35 m
  const pts = [[x, spec.yBottom, z], [x, y + 0.05, z]];
  const radii = [spec.r * 1.22, spec.r * 1.12];
  for (let h = y + 0.3; h < yT - 0.1; h += 0.35) {
    pts.push([x, h, z], [x, h + 0.07, z]);
    radii.push(spec.r, spec.r * 1.03);
  }
  pts.push([x, yT, z], [x, yT + 0.35, z]);
  radii.push(spec.r * 0.98, spec.r * 0.8);
  const ringCol = spec.ring ?? tint(spec.bark, 0.78);
  tube(wood, pts, radii, {
    sides: 10, capEnd: true, smooth: true,
    colorFn: (i, k) => {
      const ao = 0.72 + 0.28 * smooth01((pts[i][1] - y) / 1.0);
      return tint(i >= 2 && i % 2 === 0 && i < pts.length - 2 ? ringCol : spec.bark, ao * (0.97 + 0.04 * ((k * 3) % 2)));
    },
  });
  out.trunks.push({ owner: spec.owner, x, z, y0: spec.yBottom, y1: yT - 0.3, r0: spec.r, r1: spec.r });
  // knobbly collar of old leaf bases
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * TAU + rng() * 0.2;
    blob(wood, {
      c: [x + Math.cos(a) * spec.r * 1.02, yT - 0.12 + (i % 3) * 0.12, z + Math.sin(a) * spec.r * 1.02],
      r: [0.2, 0.16, 0.2], detail: 0, seed: spec.seed + 70 + i, jit: 0.1, smooth: 0.5, color: tint(ringCol, 0.95 + rng() * 0.1), shade: [0.78, 1.06],
    });
  }

  const R = (rx + rz) / 2;
  const up = height - (yT - y);
  const fr = clamp(R * 0.36, 1.4, 2.4) * (spec.fanScale ?? 1.15);
  const n = clamp(Math.round(10 + R * 1.3), 14, 22);
  const petiole = hsl(spec.leaf, -0.02, 0.8, 0.82);
  const yellow = hsl(spec.leaf, -0.04, 1.1, 1.22);
  const tilt = 0.44; // about 25 degrees up
  for (let i = 0; i < n; i++) {
    const a = i * GOLDEN + rng() * 0.2;
    const t = (i + 0.5) / n;
    const e = 1.35 - t * 1.55 + (rng() - 0.5) * 0.1;
    const dirH = [Math.cos(a) * rx / R, 0, Math.sin(a) * rz / R];
    let d = norm([dirH[0] * Math.cos(e), Math.sin(e), dirH[2] * Math.cos(e)]);
    let reach = Math.max(1.2, Math.hypot(R * 0.92 * Math.cos(e), up * Math.max(Math.sin(e), 0)) - fr * 0.9);
    let hast = madd(T, d, reach);
    const outH = norm([hast[0] - T[0], 0, hast[2] - T[2]]);
    const u = norm(add(outH, [0, Math.max(tilt, d[1] * 0.6 + 0.15), 0]));
    const nUp = norm(sub(UP, mul(u, dot(UP, u))));
    const radius = fr * (0.92 + rng() * 0.16);
    // keep every part of a fan above the player's head over open ground
    let lift = 0;
    for (const q of fanRim({ c: hast, u, n: nUp, radius, span: 5.3, droop: 0.16, cup: 0.14, fold: 0.07 })) {
      if (walk(q[0], q[2])) lift = Math.max(lift, y + (spec.headroom ?? 1.9) + 0.1 - q[1]);
    }
    if (walk(hast[0], hast[2])) lift = Math.max(lift, y + (spec.headroom ?? 1.9) + 0.1 - hast[1]);
    if (lift > 0) hast = [hast[0], hast[1] + lift, hast[2]];
    reach = len(sub(hast, T));
    const mid = madd(add(T, mul(sub(hast, T), 0.5)), UP, reach * 0.1);
    tube(leaf, [T, mid, hast], [0.1, 0.075, 0.055], { sides: 5, color: tint(petiole, 0.95 + rng() * 0.1) });
    const old = t > 0.86 && rng() < 0.5;
    fanLeaf(leaf, {
      c: hast, u, n: nUp, radius, pleats: 22, span: 5.3, fold: 0.07, droop: 0.16, cup: 0.14,
      color: old ? tint(yellow, 0.95) : tint(spec.leaf, 0.94 + rng() * 0.12), rim: old ? null : spec.rim, rng,
    });
  }
  out.palms.push({ owner: spec.owner, cx, cy: y + (spec.crownBase + height) / 2, cz, r: R });
  out.attach = T;
  out.fanR = fr;
  out.crowns.push({ owner: spec.owner, cx, cy: y + (spec.crownBase + height) / 2, cz, rx, ry: (height - spec.crownBase) / 2, rz });
  return out;
}

// Osprey nest pole: a weathered pole, a board platform, a big stick nest and its osprey.
//   spec: owner, x, y, z, yBottom, r, height, platformY (above y), cx, cz, nestR, pole,
//   nest, seed, facing, birdScale
export function buildOspreyPole(wood, leaf, spec) {
  const out = hostsOut();
  const rng = makeRng(spec.seed);
  const { x, y, z } = spec;
  const yP = y + spec.platformY;
  const pole = spec.pole;
  wood.sway = 0.15;
  tube(wood, [[x, spec.yBottom, z], [x, y + 0.2, z], [x, y + 3, z], [x, yP, z]], [spec.r * 1.05, spec.r, spec.r, spec.r * 0.85], {
    sides: 8, capEnd: true, smooth: true, vcolorFn: (i, k) => tint(pole, (k % 2 ? 0.94 : 1.03) * (i === 0 ? 0.75 : 1)),
  });
  out.trunks.push({ owner: spec.owner, x, z, y0: spec.yBottom, y1: yP, r0: spec.r, r1: spec.r * 0.9 });
  const cx = spec.cx, cz = spec.cz;
  const nr = spec.nestR;
  const h = Math.max(0.6, nr * 0.75);
  const plank = tint(pole, 0.95);
  for (let i = -2; i <= 2; i++) {
    const oz = i * 0.25 * (h / 0.6);
    const y0 = yP, y1 = yP + 0.07;
    const a = [cx - h, y0, cz + oz - 0.11], b2 = [cx + h, y0, cz + oz - 0.11], c = [cx + h, y0, cz + oz + 0.11], d = [cx - h, y0, cz + oz + 0.11];
    const a1 = [a[0], y1, a[2]], b1 = [b2[0], y1, b2[2]], c1 = [c[0], y1, c[2]], d1 = [d[0], y1, d[2]];
    const col = tint(plank, 0.92 + rng() * 0.14);
    wood.quad(a1, d1, c1, b1, col);
    wood.quad(a, b2, b1, a1, tint(col, 0.85));
    wood.quad(c, d, d1, c1, tint(col, 0.85));
    wood.quad(b2, c, c1, b1, tint(col, 0.8));
    wood.quad(d, a, a1, d1, tint(col, 0.8));
  }
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    tube(wood, [[x, yP - 1.1, z], [cx + dx * h * 0.9, yP - 0.02, cz + dz * h * 0.9]], [0.045, 0.04], { sides: 4, color: tint(pole, 0.85) });
  }
  // nest: a bowl of sticks
  const nest = spec.nest;
  const ny = yP + 0.07;
  blob(wood, { c: [cx, ny + 0.2, cz], r: [nr * 0.82, 0.24, nr * 0.82], detail: 1, seed: spec.seed + 5, jit: 0.12, flat: -0.3, squash: 0.2, color: tint(nest, 0.9), shade: [0.7, 1.05], smooth: 0.5 });
  for (let i = 0; i < 56; i++) {
    const a = rng() * TAU;
    const rr = nr * (0.55 + rng() * 0.45);
    const yy = ny + 0.05 + rng() * 0.42;
    const t = a + Math.PI / 2 + (rng() - 0.5) * 0.9;
    const L = 0.55 + rng() * 0.7;
    const p = [cx + Math.cos(a) * rr, yy, cz + Math.sin(a) * rr];
    const q0 = [p[0] - Math.cos(t) * L / 2, yy + (rng() - 0.5) * 0.12, p[2] - Math.sin(t) * L / 2];
    const q1 = [p[0] + Math.cos(t) * L / 2, yy + (rng() - 0.5) * 0.12, p[2] + Math.sin(t) * L / 2];
    tube(wood, [q0, q1], [0.03, 0.022], { sides: 3, color: tint(nest, 0.85 + rng() * 0.4), radiusScale: 1 });
  }
  // the osprey, sitting in the nest looking out over the lake
  const S = spec.birdScale ?? 1.4;
  const face = spec.facing ?? 2.2;
  const f = [Math.cos(face), 0, Math.sin(face)];
  const sd = [-f[2], 0, f[0]];
  const bx = cx - 0.12, bz = cz + 0.05, by = ny + 0.3;
  const at = (fw, up2, side) => [bx + (f[0] * fw + sd[0] * side) * S, by + up2 * S, bz + (f[2] * fw + sd[2] * side) * S];
  const yaw = -face;
  const white = lin('#fbf8ef'), brown = lin('#6b4a32'), dark = lin('#33261c'), beak = lin('#34343a'), eye = lin('#ffd21f');
  const part = (c, r, col, seed, detail = 1) => blob(wood, { c, r: mul(r, S), detail, seed, jit: 0.03, yaw, rot: 0, color: col, shade: [0.84, 1.06], smooth: 0.8, tone: false });
  part(at(0.02, 0.1, 0), [0.24, 0.2, 0.17], white, 71);
  part(at(-0.1, 0.16, 0), [0.25, 0.15, 0.18], brown, 72);
  for (const k of [-1, 1]) part(at(-0.06, 0.12, k * 0.12), [0.25, 0.13, 0.075], brown, 73 + k);
  part(at(-0.33, 0.06, 0), [0.15, 0.035, 0.09], dark, 75, 0);
  part(at(0.15, 0.33, 0), [0.12, 0.115, 0.105], white, 76);
  for (const k of [-1, 1]) {
    part(at(0.08, 0.34, k * 0.07), [0.1, 0.028, 0.035], brown, 77, 0);
    part(at(0.19, 0.355, k * 0.078), [0.024, 0.024, 0.014], eye, 78, 0);
  }
  const bt = at(0.34, 0.29, 0), bu = at(0.25, 0.37, 0);
  const bl = at(0.25, 0.32, 0.03), br2 = at(0.25, 0.32, -0.03);
  wood.tri(bu, bl, bt, beak);
  wood.tri(bu, bt, br2, beak);
  wood.tri(bl, br2, bt, tint(beak, 0.8));
  wood.tri(bu, br2, bl, beak);
  wood.sway = 1;
  out.crowns.push({ owner: spec.owner, cx, cy: ny + 0.25, cz, rx: nr, ry: 0.3, rz: nr });
  return out;
}

// Clumping bamboo: culms fanning out from a tight base with leaf sprays up top.
// extra: [x, z] points that must each have a culm beside them (lizard perches).
//   spec: owner, x, y, z, yBottom, height, width, extra, culm, leaf, seed
export function buildBamboo(wood, leaf, spec) {
  const out = hostsOut();
  const rng = makeRng(spec.seed);
  const { x, y, z, height, width } = spec;
  const R = width / 2;
  const cr = 0.035;
  const stems = [];
  const culm = (bx, bz, lean, hTop) => {
    const d = Math.hypot(bx - x, bz - z) || 1;
    const ux = (bx - x) / d, uz = (bz - z) / d;
    const yS = y + Math.min(2.2, hTop * 0.35);
    const top = [bx + ux * lean, y + hTop, bz + uz * lean];
    const ctrl = [bx, y + hTop * 0.7, bz];
    const pts = [[bx, spec.yBottom, bz], [bx, yS, bz], ...bezier([bx, yS, bz], ctrl, top, 4).slice(1)];
    tube(wood, pts, pts.map((_, i) => cr * (1 - i * 0.07)), {
      sides: 4, capEnd: true, colorFn: (i, k) => tint(spec.culm, (i % 2 ? 0.9 : 1.04) * (k % 2 ? 0.95 : 1)),
    });
    const path = bezier([bx, yS, bz], ctrl, top, 10);
    for (let q = 0; q < 4; q++) {
      const p = path[5 + q + (q > 2 ? 1 : 0)];
      const col = tint(spec.leaf, 0.88 + rng() * 0.22);
      const nL = 6;
      for (let k = 0; k < nL; k++) {
        const a = Math.atan2(uz, ux) + (k / (nL - 1) - 0.5) * 2.4 + (rng() - 0.5) * 0.3;
        leafPlate(leaf, p, [Math.cos(a), -0.35 - rng() * 0.3, Math.sin(a)], 0.55 + rng() * 0.2, 0.09, tint(col, 0.92 + rng() * 0.16), 0.05, 0.3);
      }
    }
    stems.push({ x: bx, z: bz, r: cr });
    out.trunks.push({ owner: spec.owner, x: bx, z: bz, y0: spec.yBottom, y1: yS, r0: cr, r1: cr });
  };
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = i * GOLDEN;
    const rb = 0.12 + Math.sqrt((i + 0.5) / n) * R * 0.28;
    culm(x + Math.cos(a) * rb, z + Math.sin(a) * rb, R * (0.5 + rng() * 0.35), height * (0.72 + rng() * 0.28));
  }
  for (const [px, pz] of spec.extra ?? []) {
    const d = Math.hypot(px - x, pz - z) || 1;
    culm(px - ((px - x) / d) * (cr + 0.012), pz - ((pz - z) / d) * (cr + 0.012), R * 0.3, height * (0.6 + rng() * 0.25));
  }
  out.stems = stems;
  out.crowns.push({ owner: spec.owner, cx: x, cy: y + height * 0.65, cz: z, rx: R, ry: height * 0.35, rz: R });
  return out;
}

// ---------------------------------------------------------------- perches

// A natural stub branch under a lizard: it leaves the stem rising steeply and levels
// off under the lizard, then turns up a little at the tip. p is where the lizard lies,
// stem {x, z, r}, rb the stub radius at the stem.
export function buildStub(wood, { stem, p, rb, bark, seed }) {
  const rng = makeRng(seed);
  const ux = p[0] - stem.x, uz = p[2] - stem.z;
  const dA = Math.max(Math.hypot(ux, uz), 1e-3);
  const d = [ux / dA, 0, uz / dA];
  const under = p[1] - rb * 0.75;
  const out = Math.max(0.12, dA - stem.r);
  const rise = (0.7 + 0.5 * rng()) * out; // 35 to 50 degrees on average
  const a = [stem.x + d[0] * stem.r * 0.3, under - rise, stem.z + d[2] * stem.r * 0.3];
  const q = [p[0], under, p[2]];
  const tip = [p[0] + d[0] * 0.13, under + 0.06, p[2] + d[2] * 0.13];
  const ctrl = [stem.x + d[0] * (stem.r + out * 0.45), under - rise * 0.05, stem.z + d[2] * (stem.r + out * 0.45)];
  const pts = bezier(a, ctrl, q, 3).concat([tip]);
  const radii = pts.map((_, i) => rb * (1 - 0.6 * (i / (pts.length - 1))));
  tube(wood, pts, radii, { sides: 5, capEnd: true, smooth: true, vcolorFn: (i) => tint(bark, 0.92 + 0.04 * i) });
  return { a, b: tip, line: pts.map((q, i) => [...q, radii[i]]) };
}

// A longer perch branch, drawn as a sweeping limb: it leaves the stem higher up, sweeps
// down to run level under the lizard, then rises to a leafy tip, with a short side twig.
// yMax caps where it leaves the stem (the fork or crown underside). Returns the ends.
export function buildLimb(wood, leaf, { stem, p, rb, bark, leafCol, seed, yMax = Infinity, tipPuff = true }) {
  const rng = makeRng(seed);
  const ux = p[0] - stem.x, uz = p[2] - stem.z;
  const dA = Math.max(Math.hypot(ux, uz), 1e-3);
  const d = [ux / dA, 0, uz / dA];
  const side = [-d[2], 0, d[0]];
  const under = p[1] - rb * 0.8;
  const out = dA - stem.r;
  const yA = Math.max(under + 0.15, Math.min(under + clamp(0.4 * out, 0.3, 1.8), yMax));
  const A = [stem.x + d[0] * stem.r * 0.3, yA, stem.z + d[2] * stem.r * 0.3];
  const Q = [p[0], under, p[2]];
  const bow = (rng() - 0.5) * 0.25 * out; // a little sideways curve
  const c1 = [stem.x + d[0] * (stem.r + out * 0.35) + side[0] * bow, yA - 0.05, stem.z + d[2] * (stem.r + out * 0.35) + side[2] * bow];
  const c2 = [stem.x + d[0] * (stem.r + out * 0.75) + side[0] * bow * 0.6, under, stem.z + d[2] * (stem.r + out * 0.75) + side[2] * bow * 0.6];
  const tipD = 0.45 + 0.3 * rng();
  const T = [p[0] + d[0] * tipD, under + 0.3 + 0.15 * rng(), p[2] + d[2] * tipD];
  const n1 = Math.max(4, Math.round(out / 0.35));
  const pts = bezier3(A, c1, c2, Q, n1).concat(bezier(Q, [Q[0] + d[0] * tipD * 0.6, under + 0.02, Q[2] + d[2] * tipD * 0.6], T, 3).slice(1));
  const radii = pts.map((_, i) => rb * (1 - 0.6 * (i / (pts.length - 1))));
  tube(wood, pts, radii, { sides: 6, smooth: true, capEnd: true, vcolorFn: (i) => tint(bark, 0.9 + 0.1 * (i / pts.length)) });
  const leafy = (c, w, k) => blob(leaf, {
    c, r: [w * 0.55, w * 0.42, w * 0.55], detail: 1, seed: seed + k, jit: 0.06, flat: -0.5, squash: 0.4,
    color: tint(leafCol, 0.96 + 0.08 * rng()), shade: [0.7, 1.1], smooth: 0.85,
  });
  const line = pts.map((q, i) => [...q, radii[i]]);
  if (tipPuff) {
    const w = 0.6 + 0.25 * rng();
    const c1 = [T[0] + d[0] * w * 0.2, T[1] + w * 0.15, T[2] + d[2] * w * 0.2];
    const c2 = [T[0] - d[0] * w * 0.25 + side[0] * w * 0.35, T[1] + w * 0.05, T[2] - d[2] * w * 0.25 + side[2] * w * 0.35];
    leafy(c1, w, 3);
    leafy(c2, w * 0.7, 4);
    line.push([...c1, w * 0.55, 1], [...c2, w * 0.4, 1]);
  }
  // a short side twig with a leaf puff, part way along
  if (out > 1.4) {
    const k = Math.floor(n1 * 0.55);
    const s0 = pts[k];
    const sd = rng() < 0.5 ? 1 : -1;
    const s1 = [s0[0] + side[0] * sd * 0.45 + d[0] * 0.2, s0[1] + 0.35, s0[2] + side[2] * sd * 0.45 + d[2] * 0.2];
    tube(wood, [s0, lerp3(s0, s1, 0.5), s1], [radii[k] * 0.6, radii[k] * 0.45, radii[k] * 0.3], { sides: 5, smooth: true, color: bark });
    const w2 = 0.5 + 0.2 * rng();
    leafy([s1[0], s1[1] + 0.12, s1[2]], w2, 5);
    line.push([s1[0], s1[1] + 0.12, s1[2], w2 * 0.55, 1]);
  }
  return { a: A, b: T, line };
}

// A frond through a perch point: from the crown attach point T, passing just under p.
export function buildPerchFrond(leaf, spec) {
  const { T, p, color } = spec;
  const dH = norm([p[0] - T[0], 0, p[2] - T[2]]);
  const q = [p[0], p[1] - 0.04, p[2]];
  const e = [p[0] + dH[0] * 0.8, p[1] - 0.45, p[2] + dH[2] * 0.8];
  const s = 0.6;
  const c = mul(sub(sub(q, mul(T, (1 - s) * (1 - s))), mul(e, s * s)), 1 / (2 * s * (1 - s)));
  const Lp = len(sub(e, T));
  pinnateFrond(leaf, {
    path: (t) => [
      (1 - t) * (1 - t) * T[0] + 2 * t * (1 - t) * c[0] + t * t * e[0],
      (1 - t) * (1 - t) * T[1] + 2 * t * (1 - t) * c[1] + t * t * e[1],
      (1 - t) * (1 - t) * T[2] + 2 * t * (1 - t) * c[2] + t * t * e[2],
    ],
    dir: dH, length: Lp, width: clamp(Lp * 0.2, 0.35, 0.9), segs: 7, hang: 0.25, color, rng: makeRng(spec.seed),
  });
  const w = clamp(Lp * 0.2, 0.35, 0.9);
  const line = [];
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    line.push([
      (1 - t) * (1 - t) * T[0] + 2 * t * (1 - t) * c[0] + t * t * e[0],
      (1 - t) * (1 - t) * T[1] + 2 * t * (1 - t) * c[1] + t * t * e[1] - w * 0.3,
      (1 - t) * (1 - t) * T[2] + 2 * t * (1 - t) * c[2] + t * t * e[2], w * 0.6, 1,
    ]);
  }
  return { a: T, b: e, line };
}

// A fan leaf with p lying on it near the hastula, its petiole from T.
export function buildPerchFan(leaf, spec) {
  const { T, p, color, radius } = spec;
  const dH = norm([p[0] - T[0], 0, p[2] - T[2]]);
  const hast = [p[0] - dH[0] * 0.25, p[1] - 0.05, p[2] - dH[2] * 0.25];
  const mid = madd(lerp3(T, hast, 0.5), UP, 0.3);
  tube(leaf, [T, mid, hast], [0.08, 0.065, 0.05], { sides: 4, color: tint(color, 0.72) });
  const u = norm(add(dH, [0, 0.12, 0]));
  const nUp = norm(sub(UP, mul(u, dot(UP, u))));
  fanLeaf(leaf, { c: hast, u, n: nUp, radius, pleats: 16, span: 5.0, fold: 0.04, droop: 0.12, cup: 0.08, color, rim: spec.rim, rng: makeRng(spec.seed) });
  const line = [[...mid, 0.12], [...hast, 0.12]];
  for (const q of fanRim({ c: hast, u, n: nUp, radius, span: 5.0, droop: 0.12, cup: 0.08, fold: 0.04 }, 8)) {
    for (const t of [0.3, 0.55, 0.8, 1.0]) line.push([...lerp3(hast, q, t), 0.2, 1]);
  }
  return { a: T, b: hast, line };
}
