// Where the lizards can be: the drawn vegetation near every spawn as a triangle index,
// each spawn snapped onto what is actually drawn (the drawn trunks and crowns sit
// a little off the data), and the paths a lizard takes when it runs: round a trunk,
// along a branch to the stem, across leaves, over the ground to cover, along a log.
//
// Everything is in world space and sways with the vegetation: a point keeps the sway
// weight of the triangle under it, and swayOffset() repeats wind.js's vertex sway so a
// lizard moves with its bark or leaf.

import { vegUniforms } from '../world/wind.js';

export const SURF = { BARK: 1, BRANCH: 2, LEAF: 3, GROUND: 4, LOG: 5 };
export const SURF_NAME = ['', 'bark', 'branch', 'leaf', 'ground', 'log'];
const WOOD = 1, LEAF = 2, ANY = 3;
const CELL = 0.5;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const TS = 8, _e = new Float32Array(TS), _g = new Float32Array(TS); // tail samples when fitting

// ---------------------------------------------------------------- growable arrays

class FloatList {
  constructor(n = 1 << 16) { this.a = new Float32Array(n); this.n = 0; }
  push3(x, y, z) {
    if (this.n + 3 > this.a.length) { const b = new Float32Array(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = x; this.a[this.n++] = y; this.a[this.n++] = z;
  }
  done() { return this.a.slice(0, this.n); }
}

// ---------------------------------------------------------------- triangle index

export class SurfaceIndex {
  // meshes: the vegetation's meshes; keep: a byte per 0.5 m plan cell over bounds, with
  // the bits WOOD and LEAF set where that kind of triangle is wanted
  constructor(meshes, bounds, keep) {
    this.x0 = bounds.xmin; this.z0 = bounds.zmin;
    this.nx = Math.ceil((bounds.xmax - bounds.xmin) / CELL) + 1;
    this.nz = Math.ceil((bounds.zmax - bounds.zmin) / CELL) + 1;
    const P = new FloatList(), W = [];
    const kinds = [];
    const m = new Float32Array(16);
    const tmp = new Float32Array(9);
    const keepBox = (x0, z0, x1, z1, bits) => {
      const c0 = Math.max(0, Math.floor((x0 - this.x0) / CELL)), c1 = Math.min(this.nx - 1, Math.floor((x1 - this.x0) / CELL));
      const r0 = Math.max(0, Math.floor((z0 - this.z0) / CELL)), r1 = Math.min(this.nz - 1, Math.floor((z1 - this.z0) / CELL));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (keep[r * this.nx + c] & bits) return true;
      return false;
    };
    let tested = 0;
    for (const mesh of meshes) {
      const name = mesh.material && mesh.material.name;
      const kind = name === 'veg-leaf' ? LEAF : name === 'veg-wood' ? WOOD : 0;
      if (!kind) continue;
      const g = mesh.geometry;
      const pos = g.attributes.position, sw = g.attributes.aSway, idx = g.index;
      const pa = pos.array, ps = pos.itemSize === 3 && !pos.isInterleavedBufferAttribute;
      if (!ps) continue;
      const nTri = (idx ? idx.count : pos.count) / 3;
      const nInst = mesh.isInstancedMesh ? mesh.count : 1;
      if (!g.boundingSphere) g.computeBoundingSphere();
      const bs = g.boundingSphere;
      const mw = mesh.matrixWorld.elements;
      for (let k = 0; k < nInst; k++) {
        // world matrix of this instance
        if (mesh.isInstancedMesh) mul4(mw, mesh.instanceMatrix.array, k * 16, m);
        else m.set(mw);
        const sc = Math.max(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10]));
        const cx = m[0] * bs.center.x + m[4] * bs.center.y + m[8] * bs.center.z + m[12];
        const cz = m[2] * bs.center.x + m[6] * bs.center.y + m[10] * bs.center.z + m[14];
        const R = bs.radius * sc;
        if (!keepBox(cx - R, cz - R, cx + R, cz + R, kind)) continue;
        const ident = isIdentity(m);
        for (let t = 0; t < nTri; t++) {
          let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
          for (let v = 0; v < 3; v++) {
            const vi = idx ? idx.array[t * 3 + v] : t * 3 + v;
            const px = pa[vi * 3], py = pa[vi * 3 + 1], pz = pa[vi * 3 + 2];
            const wx = ident ? px : m[0] * px + m[4] * py + m[8] * pz + m[12];
            const wy = ident ? py : m[1] * px + m[5] * py + m[9] * pz + m[13];
            const wz = ident ? pz : m[2] * px + m[6] * py + m[10] * pz + m[14];
            tmp[v * 3] = wx; tmp[v * 3 + 1] = wy; tmp[v * 3 + 2] = wz;
            if (wx < x0) x0 = wx; if (wx > x1) x1 = wx;
            if (wz < z0) z0 = wz; if (wz > z1) z1 = wz;
          }
          tested++;
          if (!keepBox(x0, z0, x1, z1, kind)) continue;
          if (kind === LEAF) { // lizards only ever stand on the upper side of foliage
            const ux = tmp[3] - tmp[0], uy = tmp[4] - tmp[1], uz = tmp[5] - tmp[2];
            const vx = tmp[6] - tmp[0], vy = tmp[7] - tmp[1], vz = tmp[8] - tmp[2];
            const ny = uz * vx - ux * vz;
            if (ny <= 0.1 * Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx)) continue;
          }
          P.push3(tmp[0], tmp[1], tmp[2]); P.push3(tmp[3], tmp[4], tmp[5]); P.push3(tmp[6], tmp[7], tmp[8]);
          const i0 = idx ? idx.array[t * 3] : t * 3, i1 = idx ? idx.array[t * 3 + 1] : t * 3 + 1, i2 = idx ? idx.array[t * 3 + 2] : t * 3 + 2;
          W.push(q8(sw ? sw.array[i0] : 1), q8(sw ? sw.array[i1] : 1), q8(sw ? sw.array[i2] : 1));
          kinds.push(kind);
        }
      }
    }
    this.P = P.done();
    this.W = Uint8Array.from(W); // sway weight x 200
    this.K = Uint8Array.from(kinds);
    this.count = this.K.length;
    this.tested = tested;
    // plan grid of triangle lists (CSR)
    const nCell = this.nx * this.nz;
    const counts = new Int32Array(nCell + 1);
    const each = (i, fn) => {
      const p = this.P, o = i * 9;
      const x0 = Math.min(p[o], p[o + 3], p[o + 6]), x1 = Math.max(p[o], p[o + 3], p[o + 6]);
      const z0 = Math.min(p[o + 2], p[o + 5], p[o + 8]), z1 = Math.max(p[o + 2], p[o + 5], p[o + 8]);
      const c0 = this._col(x0), c1 = this._col(x1), r0 = this._row(z0), r1 = this._row(z1);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) fn(r * this.nx + c);
    };
    for (let i = 0; i < this.count; i++) each(i, (j) => { counts[j + 1]++; });
    for (let j = 0; j < nCell; j++) counts[j + 1] += counts[j];
    const items = new Int32Array(counts[nCell]);
    const fill = counts.slice(0, nCell);
    for (let i = 0; i < this.count; i++) each(i, (j) => { items[fill[j]++] = i; });
    this.start = counts;
    this.items = items;
    this.stamp = new Uint32Array(this.count);
    this.qid = 0;
  }

  _normal(i, out) {
    const P = this.P, o = i * 9;
    const ux = P[o + 3] - P[o], uy = P[o + 4] - P[o + 1], uz = P[o + 5] - P[o + 2];
    const vx = P[o + 6] - P[o], vy = P[o + 7] - P[o + 1], vz = P[o + 8] - P[o + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    out.nx = nx / l; out.ny = ny / l; out.nz = nz / l;
  }

  _col(x) { return Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.x0) / CELL))); }
  _row(z) { return Math.min(this.nz - 1, Math.max(0, Math.floor((z - this.z0) / CELL))); }

  // Casts a ray (d unit) up to tmax against triangles of the given kinds (WOOD 1, LEAF 2)
  // facing the ray. Of the hits, keeps the one whose t is closest to tRef (or the
  // nearest when tRef < 0) and within [tMin, tmax]. Fills hit and returns true when
  // there is one.
  cast(ox, oy, oz, dx, dy, dz, tmax, mask, tRef, hit, tMin = 0) {
    const q = ++this.qid;
    const ex = ox + dx * tmax, ez = oz + dz * tmax;
    const c0 = this._col(Math.min(ox, ex)), c1 = this._col(Math.max(ox, ex));
    const r0 = this._row(Math.min(oz, ez)), r1 = this._row(Math.max(oz, ez));
    let best = Infinity, bi = -1, bt = 0, bu = 0, bv = 0;
    const P = this.P;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const j = r * this.nx + c;
        for (let k = this.start[j]; k < this.start[j + 1]; k++) {
          const i = this.items[k];
          if (this.stamp[i] === q) continue;
          this.stamp[i] = q;
          if (!(this.K[i] & mask)) continue;
          const o = i * 9;
          const e1x = P[o + 3] - P[o], e1y = P[o + 4] - P[o + 1], e1z = P[o + 5] - P[o + 2];
          const e2x = P[o + 6] - P[o], e2y = P[o + 7] - P[o + 1], e2z = P[o + 8] - P[o + 2];
          const fnx = e1y * e2z - e1z * e2y, fny = e1z * e2x - e1x * e2z, fnz = e1x * e2y - e1y * e2x;
          const fl = Math.hypot(fnx, fny, fnz);
          if (fl < 1e-12 || (fnx * dx + fny * dy + fnz * dz) / fl > -0.08) continue; // back faces and grazing hits
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          if (det > -1e-12 && det < 1e-12) continue;
          const inv = 1 / det;
          const sx = ox - P[o], sy = oy - P[o + 1], sz = oz - P[o + 2];
          const u = (sx * px + sy * py + sz * pz) * inv;
          if (u < 0 || u > 1) continue;
          const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
          const v = (dx * qx + dy * qy + dz * qz) * inv;
          if (v < 0 || u + v > 1) continue;
          const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
          if (t < tMin || t > tmax) continue;
          const score = tRef < 0 ? t : Math.abs(t - tRef);
          if (score >= best) continue;
          best = score; bi = i; bt = t; bu = u; bv = v;
        }
      }
    }
    if (bi < 0) return false;
    hit.t = bt;
    hit.x = ox + dx * bt; hit.y = oy + dy * bt; hit.z = oz + dz * bt;
    this._normal(bi, hit);
    hit.kind = this.K[bi];
    hit.tri = bi;
    const W = this.W;
    hit.w = (W[bi * 3] * (1 - bu - bv) + W[bi * 3 + 1] * bu + W[bi * 3 + 2] * bv) / 200;
    return true;
  }

  // True when a segment is blocked by wood (for picking through a trunk).
  blocked(ox, oy, oz, dx, dy, dz, len, hit) {
    return this.cast(ox, oy, oz, dx, dy, dz, len, WOOD, -1, hit, 0.02);
  }

  // Closest point on the kept triangles within maxR of (x, y, z).
  closest(x, y, z, maxR, mask, hit) {
    const q = ++this.qid;
    const c0 = this._col(x - maxR), c1 = this._col(x + maxR), r0 = this._row(z - maxR), r1 = this._row(z + maxR);
    let best = maxR * maxR, bi = -1;
    const out = _cp;
    let bx = 0, by = 0, bz = 0;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const j = r * this.nx + c;
        for (let k = this.start[j]; k < this.start[j + 1]; k++) {
          const i = this.items[k];
          if (this.stamp[i] === q) continue;
          this.stamp[i] = q;
          if (!(this.K[i] & mask)) continue;
          closestOnTri(this.P, i * 9, x, y, z, out);
          const d2 = (out[0] - x) ** 2 + (out[1] - y) ** 2 + (out[2] - z) ** 2;
          if (d2 < best) { best = d2; bi = i; bx = out[0]; by = out[1]; bz = out[2]; }
        }
      }
    }
    if (bi < 0) return false;
    hit.t = Math.sqrt(best);
    hit.x = bx; hit.y = by; hit.z = bz;
    this._normal(bi, hit);
    hit.kind = this.K[bi];
    hit.tri = bi;
    hit.w = (this.W[bi * 3] + this.W[bi * 3 + 1] + this.W[bi * 3 + 2]) / 600;
    return true;
  }
}

function isIdentity(m) {
  for (let i = 0; i < 16; i++) if (m[i] !== (i % 5 === 0 ? 1 : 0)) return false;
  return true;
}

const q8 = (w) => Math.max(0, Math.min(255, Math.round(w * 200)));

// a (column-major 4x4) times b[off..off+16] into out
function mul4(a, b, off, out) {
  for (let c = 0; c < 4; c++) {
    const b0 = b[off + c * 4], b1 = b[off + c * 4 + 1], b2 = b[off + c * 4 + 2], b3 = b[off + c * 4 + 3];
    out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
}

const _cp = new Float32Array(3);
// Closest point on triangle P[o..o+9] to p (Ericson, Real-Time Collision Detection 5.1.5).
function closestOnTri(P, o, px, py, pz, out) {
  const ax = P[o], ay = P[o + 1], az = P[o + 2], bx = P[o + 3], by = P[o + 4], bz = P[o + 5], cx = P[o + 6], cy = P[o + 7], cz = P[o + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return; }
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out[0] = bx; out[1] = by; out[2] = bz; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    out[0] = ax + abx * v; out[1] = ay + aby * v; out[2] = az + abz * v; return;
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out[0] = cx; out[1] = cy; out[2] = cz; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    out[0] = ax + acx * w; out[1] = ay + acy * w; out[2] = az + acz * w; return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    out[0] = bx + (cx - bx) * w; out[1] = by + (cy - by) * w; out[2] = bz + (cz - bz) * w; return;
  }
  const den = 1 / (va + vb + vc);
  const v = vb * den, w = vc * den;
  out[0] = ax + abx * v + acx * w; out[1] = ay + aby * v + acy * w; out[2] = az + abz * v + acz * w;
}

// ---------------------------------------------------------------- sway

// The vegetation's vertex sway (wind.js) at a point with the given weight; leaves
// add their flutter. Writes the offset into out (an {x, y, z}).
export function swayOffset(x, y, z, weight, flutter, out) {
  out.x = 0; out.y = 0; out.z = 0;
  if (!(weight > 0)) return out;
  const T = vegUniforms.uVegTime.value, Wd = vegUniforms.uVegWind.value;
  const h = Math.max(y - 0.3, 0);
  const amp = Wd * weight * 0.0042 * h * Math.sqrt(h);
  const ph = T * 0.85 + x * 0.11 + z * 0.07;
  out.x = (Math.sin(ph) + 0.35 * Math.sin(ph * 2.3 + 1.7)) * amp;
  out.z = 0.6 * Math.cos(ph * 0.8 + 0.4) * amp;
  if (flutter) {
    const fl = weight * Math.min(h, 3) * 0.011;
    const q = T * 3.1 + x * 1.7 + y * 1.3 + z * 2.1;
    out.x += Math.sin(q) * fl;
    out.y += 0.6 * Math.sin(q * 1.3 + 2.0) * fl;
    out.z += Math.cos(q * 0.9) * fl;
  }
  return out;
}

// ---------------------------------------------------------------- routes

// A path over surfaces: points, normals, sway weight, flutter and surface kind per
// point, and the distance along it. Filled when a lizard runs; no allocation after.
export class Route {
  constructor(cap = 200) {
    this.cap = cap;
    this.p = new Float32Array(cap * 3);
    this.n = new Float32Array(cap * 3);
    this.w = new Float32Array(cap);
    this.fl = new Uint8Array(cap);
    this.surf = new Uint8Array(cap);
    this.s = new Float32Array(cap);
    this.count = 0;
    this.length = 0;
    this.vanish = false;
    this._k = 0;
  }

  reset() { this.count = 0; this.length = 0; this.vanish = false; this._k = 0; return this; }

  push(x, y, z, nx, ny, nz, w, fl, surf) {
    const i = this.count;
    if (i >= this.cap) return false;
    if (i > 0) {
      const o = (i - 1) * 3;
      const ex = x - this.p[o], ey = y - this.p[o + 1], ez = z - this.p[o + 2];
      const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (d < 1e-4) { // same place: keep the newer surface
        this.n[o] = nx; this.n[o + 1] = ny; this.n[o + 2] = nz; this.surf[i - 1] = surf;
        return true;
      }
      this.s[i] = this.s[i - 1] + d;
    } else {
      this.s[0] = 0;
    }
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    this.n[i * 3] = nx / l; this.n[i * 3 + 1] = ny / l; this.n[i * 3 + 2] = nz / l;
    this.w[i] = w; this.fl[i] = fl; this.surf[i] = surf;
    this.count = i + 1;
    this.length = this.s[i];
    return true;
  }

  pushHit(h, surf) { return this.push(h.x, h.y, h.z, h.nx, h.ny, h.nz, h.w, h.kind === LEAF ? 1 : 0, surf); }

  last(out) {
    const o = (this.count - 1) * 3;
    out.x = this.p[o]; out.y = this.p[o + 1]; out.z = this.p[o + 2];
    return out;
  }

  // Appends another route backwards (from its end to its start).
  appendReversed(r) {
    for (let i = r.count - 1; i >= 0; i--) {
      const o = i * 3;
      this.push(r.p[o], r.p[o + 1], r.p[o + 2], r.n[o], r.n[o + 1], r.n[o + 2], r.w[i], r.fl[i], r.surf[i]);
    }
  }

  // Samples the route d metres along: position, normal and travel direction into the
  // given {x, y, z} objects; returns the index of the segment's start point.
  sample(d, pos, nrm, tan, info) {
    const n = this.count;
    if (n === 0) return -1;
    if (n === 1 || d <= 0) { this._at(0, 0, pos, nrm, tan, info); return 0; }
    if (d >= this.length) { this._at(n - 2, 1, pos, nrm, tan, info); return n - 2; }
    let k = Math.min(this._k, n - 2);
    while (k > 0 && this.s[k] > d) k--;
    while (k < n - 2 && this.s[k + 1] < d) k++;
    this._k = k;
    const seg = this.s[k + 1] - this.s[k];
    this._at(k, seg > 1e-6 ? (d - this.s[k]) / seg : 0, pos, nrm, tan, info);
    return k;
  }

  _at(k, f, pos, nrm, tan, info) {
    const a = k * 3, b = Math.min(k + 1, this.count - 1) * 3;
    const p = this.p, n = this.n;
    pos.x = p[a] + (p[b] - p[a]) * f; pos.y = p[a + 1] + (p[b + 1] - p[a + 1]) * f; pos.z = p[a + 2] + (p[b + 2] - p[a + 2]) * f;
    let nx = n[a] + (n[b] - n[a]) * f, ny = n[a + 1] + (n[b + 1] - n[a + 1]) * f, nz = n[a + 2] + (n[b + 2] - n[a + 2]) * f;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nrm.x = nx / nl; nrm.y = ny / nl; nrm.z = nz / nl;
    const tx = p[b] - p[a], ty = p[b + 1] - p[a + 1], tz = p[b + 2] - p[a + 2];
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (tl > 1e-6) { tan.x = tx / tl; tan.y = ty / tl; tan.z = tz / tl; }
    if (info) {
      const i = f < 0.5 ? k : Math.min(k + 1, this.count - 1);
      info.w = this.w[k] + (this.w[Math.min(k + 1, this.count - 1)] - this.w[k]) * f;
      info.fl = this.fl[i];
      info.surf = this.surf[i];
    }
  }
}

// ---------------------------------------------------------------- perches

// Builds the index round the spawns and snaps every spawn onto what is drawn.
// body(species, sex) gives the lizard's extent along its length ({ front, back } in
// metres from the belly centre, back negative), for fitting it to its branch and
// keeping its tail out of the lake. Returns { index, perches, stats, ...path builders }.
// A perch carries headDown (1 must rest head down, -1 head up, 0 either), droop (the
// tail's droop at rest, -1..1, and droopAt, the share of the tail on the perch
// before it bends) and skip (never shown).
export function buildPerches({ data, veg, collision, body = null }) {
  const t0 = performance.now();
  const T = data.terrain;
  const spawns = data.spawns.spawns;
  const circles = data.colliders.circles, owners = data.colliders.owners;
  const stemsByOwner = new Map();
  circles.forEach((c, i) => {
    const o = owners[i];
    if (!stemsByOwner.has(o)) stemsByOwner.set(o, []);
    stemsByOwner.get(o).push(c);
  });
  const hosts = veg ? veg.hosts : { trunks: [], crowns: [], branches: [], palms: [], logs: [] };
  const trunksByOwner = new Map(), crownsByOwner = new Map();
  for (const t of hosts.trunks) { if (!trunksByOwner.has(t.owner)) trunksByOwner.set(t.owner, []); trunksByOwner.get(t.owner).push(t); }
  for (const c of hosts.crowns) { if (!crownsByOwner.has(c.owner)) crownsByOwner.set(c.owner, []); crownsByOwner.get(c.owner).push(c); }
  const pl = data.placements;

  const ownerOf = (h) => (h.t === 'landmark' ? 'L' : h.t === 'plant' ? 'P' : h.t === 'clump' ? 'C' : '?') + h.i;

  // the stem a lizard belongs to: {x, z, r (data radius)} or null
  function stemOf(s) {
    const h = s.host;
    if (h.t === 'ground' || h.t === 'log') return null;
    if (h.c != null && circles[h.c]) {
      const c = circles[h.c];
      return { x: c[0], z: c[1] };
    }
    if (h.t === 'landmark') {
      const list = stemsByOwner.get('L' + h.i);
      if (!list) { const lm = pl.landmarks[h.i]; return lm ? { x: lm.x, z: lm.z } : null; }
      let best = null, bd = Infinity;
      for (const c of list) {
        const d = Math.hypot(s.x - c[0], s.z - c[1]) - (c[2] - 0.15);
        if (d < bd) { bd = d; best = c; }
      }
      return { x: best[0], z: best[1] };
    }
    if (h.t === 'plant') { const p = pl.plants[h.i]; return p ? { x: p.x, z: p.z } : null; }
    if (h.t === 'clump') { const r = pl.clumps.rows[h.i]; return r ? { x: r[0], z: r[2] } : null; }
    return null;
  }

  // ---- keep mask: round every spawn, and the corridor to its stem
  const bounds = { xmin: T.xmin, zmin: T.zmin, xmax: T.xmax, zmax: T.zmax };
  const nx = Math.ceil((bounds.xmax - bounds.xmin) / CELL) + 1, nz = Math.ceil((bounds.zmax - bounds.zmin) / CELL) + 1;
  const keep = new Uint8Array(nx * nz);
  const markDisc = (x, z, r, bits) => {
    const c0 = Math.max(0, Math.floor((x - r - bounds.xmin) / CELL)), c1 = Math.min(nx - 1, Math.floor((x + r - bounds.xmin) / CELL));
    const r0 = Math.max(0, Math.floor((z - r - bounds.zmin) / CELL)), r1 = Math.min(nz - 1, Math.floor((z + r - bounds.zmin) / CELL));
    for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) keep[rr * nx + cc] |= bits;
  };
  // wood round every perch and along the way to its stem; leaves only round the lizards
  // that lie on something (they scamper and hop over foliage)
  const stems = spawns.map(stemOf);
  spawns.forEach((s, i) => {
    if (s.hag <= 0.01 && s.host.t === 'ground') return; // the ground needs no triangles
    markDisc(s.x, s.z, 1.0, WOOD);
    if (s.pose !== 'bark') markDisc(s.x, s.z, 0.8, LEAF);
    const st = stems[i];
    if (st) {
      const L = Math.hypot(s.x - st.x, s.z - st.z);
      const n = Math.ceil(L / 0.4);
      for (let k = 0; k <= n; k++) markDisc(st.x + (s.x - st.x) * k / Math.max(1, n), st.z + (s.z - st.z) * k / Math.max(1, n), 0.9, WOOD);
    }
  });
  const meshes = [];
  if (veg) {
    veg.group.updateMatrixWorld(true);
    veg.group.traverse((o) => { if (o.isMesh && o.name !== 'veg-fern') meshes.push(o); });
  }
  const index = new SurfaceIndex(meshes, bounds, keep);

  // ---- snap every spawn
  const hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, kind: 0, tri: -1, w: 0 };
  const hit2 = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, kind: 0, tri: -1, w: 0 };
  const stats = {
    bark: 0, branch: 0, leaf: 0, ground: 0, log: 0, fallback: 0, unsnapped: 0, moveMean: 0, moveMax: 0, tris: index.count, trisTested: index.tested,
    woodNear: 0, woodToBark: 0, woodOnLeaf: 0, skipped: 0, fitted: 0, headSet: 0, raised: 0,
  };

  function trunkOf(owner, x, z) {
    const list = trunksByOwner.get(owner);
    if (!list) return null;
    let best = null, bd = 0.35;
    for (const t of list) {
      const d = Math.hypot(t.x - x, t.z - z);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
  function crownBottom(owner, x, z) {
    const list = crownsByOwner.get(owner);
    if (!list) return NaN;
    let lo = NaN, bd = Infinity;
    for (const c of list) {
      const d = Math.hypot(c.cx - x, c.cz - z);
      if (d < bd) { bd = d; lo = c.cy - c.ry; }
    }
    return lo;
  }

  // A point on the drawn trunk surface at angle th and height y round axis (ax, az),
  // expecting radius rRef. Fills hit; returns false when nothing near rRef is drawn.
  function trunkPoint(ax, az, th, y, rRef, out) {
    const cx = Math.cos(th), cz = Math.sin(th);
    const R = rRef + 0.45;
    const lo = Math.max(0.01, 0.45 * rRef - 0.02), hi = 1.7 * rRef + 0.12;
    const ok = index.cast(ax + cx * R, y, az + cz * R, -cx, 0, -cz, R, WOOD, R - rRef, out);
    if (!ok) return false;
    const rho = Math.hypot(out.x - ax, out.z - az);
    if (rho < lo || rho > hi) return false;
    // lean the facet normal towards the radial direction, so going round is smooth
    const nx = out.nx + cx, ny = out.ny, nz = out.nz + cz;
    const l = Math.hypot(nx, ny, nz) || 1;
    out.nx = nx / l; out.ny = ny / l; out.nz = nz / l;
    return true;
  }

  // The drawn surface under (x, y, z): a downward ray, the hit nearest y.
  function surfaceBelow(x, y, z, up, down, mask, out, minNy = 0.25) {
    const ok = index.cast(x, y + up, z, 0, -1, 0, up + down, mask, up, out);
    return ok && out.ny >= minNy;
  }

  // wood records: a lizard recorded on a trunk, branch, palm stem or root belongs on wood
  const WOOD_REC = new Set(['trunk', 'branch', 'palm_stem', 'root']);
  const bodyOf = (sp, sex) => (body ? body(sp, sex) : { front: 0.13, back: -0.24 });

  // Bark set-up round the stem axis (ax, az): the hit is already in P.
  function barkSetup(P, s, ax, az, owner, rData) {
    P.mode = SURF.BARK;
    P.ax = ax; P.az = az;
    const tr = trunkOf(owner, ax, az);
    P.r = Math.max(0.02, Math.hypot(P.x - ax, P.z - az));
    P.th = Math.atan2(P.z - az, P.x - ax);
    // how far up and down the trunk it may run: the straight part of a bespoke trunk,
    // up to the crown on a plain one
    const cb = crownBottom(owner, ax, az);
    P.crownLo = cb;
    const bespoke = s.host.t === 'landmark' || (s.host.t === 'plant' && pl.plants[s.host.i] && pl.plants[s.host.i].form !== 'tree' && pl.plants[s.host.i].form !== 'mangrove');
    const gy = Math.max(T.heightAt(ax, az), 0);
    P.yLo = gy + 0.12;
    P.yHi = tr ? (bespoke ? tr.y1 - 0.05 : Math.max(tr.y1, Number.isFinite(cb) ? cb + 0.1 : tr.y1)) : s.y + 0.4;
    P.yHi = Math.max(P.yHi, P.y);
    P.yLo = Math.min(P.yLo, P.y);
    restForwardBark(P);
    // head up or head down: never with the tail or the snout in the lake or the soil
    const B = bodyOf(s.sp, s.sex);
    const floor = Math.max(T.heightAt(P.x, P.z), 0) + 0.03;
    const wetUp = P.y + B.back * 1.08 < floor, wetDown = P.y - B.front * 1.08 < floor;
    if (wetUp && !wetDown) P.headDown = 1;
    else if (wetDown && !wetUp) P.headDown = -1;
    else if (wetUp && wetDown) { P.headDown = 1; P.y = floor + B.front * 1.08; stats.raised++; }
    if (P.headDown) stats.headSet++;
  }

  const perches = spawns.map((s, i) => {
    const owner = ownerOf(s.host);
    const st = stems[i];
    const ang = s.ang;
    const hx = -Math.sin(ang), hz = -Math.cos(ang); // heading from ang
    const P = {
      i, mode: 0, x: s.x, y: s.y, z: s.z, nx: 0, ny: 1, nz: 0, fx: hx, fy: 0, fz: hz, w: 0, fl: 0,
      ax: NaN, az: NaN, r: 0, th: 0, trunkR: NaN, yLo: NaN, yHi: NaN, crownLo: NaN, owner, snapped: true, moved: 0,
      headDown: 0, droop: 0, droopAt: 0, skip: false, log: null, // every field here, so all perches share one shape
    };
    if (st) { P.ax = st.x; P.az = st.z; }
    const ground = T.heightAt(s.x, s.z);
    if (s.host.t === 'log') {
      if (surfaceBelow(s.x, s.y, s.z, 0.35, 0.4, WOOD, hit, 0.2)) setHit(P, hit); else P.snapped = false;
      P.mode = SURF.LOG;
      const lg = nearestLog(data.spawns.logs, s.x, s.z);
      if (lg) {
        const lx = Math.cos(lg.rot), lz = -Math.sin(lg.rot);
        const sg = lx * hx + lz * hz >= 0 ? 1 : -1;
        P.fx = lx * sg; P.fz = lz * sg; P.fy = 0;
        P.log = lg;
      }
      stats.log++;
    } else if (s.hag <= 0.01 || s.host.t === 'ground') {
      P.mode = SURF.GROUND;
      P.y = ground;
      groundNormal(T, s.x, s.z, P);
      stats.ground++;
    } else if (s.pose === 'bark' && st) {
      let dx = s.x - st.x, dz = s.z - st.z;
      const rData = Math.hypot(dx, dz);
      if (rData > 1e-3) { dx /= rData; dz /= rData; } else { dx = hx; dz = hz; }
      const tr = trunkOf(owner, st.x, st.z);
      const rExp = tr && s.host.t !== 'landmark' ? tr.r0 : Math.max(0.02, rData);
      const th = Math.atan2(dz, dx);
      if (trunkPoint(st.x, st.z, th, s.y, rExp, hit)) {
        setHit(P, hit);
      } else if (index.closest(s.x, s.y, s.z, 0.4, WOOD, hit) || index.closest(s.x, s.y, s.z, 0.25, ANY, hit)) {
        setHit(P, hit); stats.fallback++; // a stem drawn in leaf colours (a nipa stalk, a herb)
      } else {
        P.nx = dx; P.ny = 0; P.nz = dz; P.snapped = false;
      }
      barkSetup(P, s, st.x, st.z, owner, rData);
      stats.bark++;
    } else {
      // flat: on a branch, stub, frond, leaf or bump. A wood record looks for wood first
      // (straight below, then anything wooden near, then the side of its trunk) and only
      // then lies on leaves.
      const woodRec = WOOD_REC.has(s.perch);
      let done = false, onBark = false;
      if (woodRec) {
        if (surfaceBelow(s.x, s.y, s.z, 0.25, 0.4, WOOD, hit)) { setHit(P, hit); done = true; }
        else if (index.closest(s.x, s.y, s.z, 0.5, WOOD, hit) && hit.ny > 0.25) { setHit(P, hit); done = true; stats.woodNear++; }
        else {
          const tr = trunkNear(owner, s.x, s.z, 0.6);
          if (tr && trunkPoint(tr.x, tr.z, Math.atan2(s.z - tr.z, s.x - tr.x), clamp(s.y, tr.y0 + 0.15, tr.y1), tr.r0, hit)) {
            setHit(P, hit);
            barkSetup(P, s, tr.x, tr.z, owner, Math.hypot(s.x - tr.x, s.z - tr.z));
            stats.bark++; stats.woodToBark++;
            done = onBark = true;
          }
        }
      }
      if (!onBark) {
        if (!done) {
          if (surfaceBelow(s.x, s.y, s.z, 0.25, 0.4, ANY, hit)) {
            setHit(P, hit);
          } else if (index.closest(s.x, s.y, s.z, 0.35, ANY, hit)) {
            setHit(P, hit); stats.fallback++;
            if (P.ny < 0) { P.nx = -P.nx; P.ny = -P.ny; P.nz = -P.nz; }
          } else {
            P.snapped = false;
          }
        }
        P.mode = P.fl ? SURF.LEAF : SURF.BRANCH;
        if (!P.snapped) P.mode = SURF.LEAF;
        if (woodRec && P.mode === SURF.LEAF) {
          stats.woodOnLeaf++;
          // a knight belongs up in the canopy, not on a low bush
          if (s.sp === 'equestris' && s.hag < 1.5) { P.skip = true; stats.skipped++; }
        }
        if (P.mode === SURF.BRANCH && st) {
          // lie along the branch: stubs and perch limbs run out from the stem
          let bx = P.x - st.x, bz = P.z - st.z;
          const bl = Math.hypot(bx, bz);
          if (bl > 0.05) { bx /= bl; bz /= bl; const sg = bx * hx + bz * hz >= 0 ? 1 : -1; P.fx = bx * sg; P.fz = bz * sg; }
        }
        if (st) {
          const tr = trunkOf(owner, st.x, st.z);
          P.crownLo = crownBottom(owner, st.x, st.z);
          P.trunkR = tr ? tr.r0 : NaN;
          P.yHi = tr ? tr.y1 : NaN;
        }
        projectForward(P);
        if (P.mode === SURF.BRANCH) { fitBranch(P, s, owner); stats.branch++; } else { tailGap(P, s, ANY); stats.leaf++; }
      }
    }
    if (!P.snapped) stats.unsnapped++;
    P.moved = Math.hypot(P.x - s.x, P.y - s.y, P.z - s.z);
    stats.moveMean += P.moved;
    stats.moveMax = Math.max(stats.moveMax, P.moved);
    // never under the lake or the ground
    const gy = T.heightAt(P.x, P.z);
    if (P.y < gy - 0.02 && P.mode !== SURF.BARK) { P.y = gy; stats.lifted = (stats.lifted || 0) + 1; }
    return P;
  });
  stats.moveMean = +(stats.moveMean / Math.max(1, perches.length)).toFixed(3);
  stats.moveMax = +stats.moveMax.toFixed(3);

  // ---- lying along a branch

  // Height of the drawn surface under (x, z) nearest height y, looking from up above
  // it to 0.2 m below (NaN when there is none).
  function probe(x, y, z, mask, up = 0.14) {
    return index.cast(x, y + up, z, 0, -1, 0, up + 0.2, mask, up, hit2) && hit2.ny > 0.2 ? hit2.y : NaN;
  }

  // A branch lizard lies along the limb under it, not along stem to perch: the limb's
  // direction comes from probing the wood round the hit (along the limb the surface
  // runs on; across it, it drops away). Then it slides along the limb to where its body
  // lies on one straight stretch with the tail clear of the trunk (on a stub shorter
  // than the lizard it faces outwards, its hips near the tip), and the tail droops
  // over whatever is left.
  function fitBranch(P, s, owner) {
    const B = bodyOf(s.sp, s.sex);
    // onto the top of the limb first (a hit on a tube's facet can be well round its side)
    const fl0 = Math.hypot(P.fx, P.fz) || 1;
    ridge(P, -P.fz / fl0, P.fx / fl0);
    const x0 = P.x, y0 = P.y, z0 = P.z;
    // the limb's direction in plan, and its slope
    let bestA = -1, bestS = -Infinity, bestSlope = 0;
    for (let k = 0; k < 12; k++) {
      const th = (k / 12) * Math.PI, cx = Math.cos(th), cz = Math.sin(th);
      let n = 0, curv = 0, slope = 0;
      const ym = probe(x0 - cx * 0.06, y0, z0 - cz * 0.06, WOOD), yp = probe(x0 + cx * 0.06, y0, z0 + cz * 0.06, WOOD);
      const ym2 = probe(x0 - cx * 0.12, y0, z0 - cz * 0.12, WOOD), yp2 = probe(x0 + cx * 0.12, y0, z0 + cz * 0.12, WOOD);
      for (const [v, d] of [[ym, 0.06], [yp, 0.06], [ym2, 0.12], [yp2, 0.12]]) if (Number.isFinite(v) && Math.abs(v - y0) < 0.03 + 0.7 * d) n++;
      if (Number.isFinite(ym) && Number.isFinite(yp)) { curv = Math.abs(ym + yp - 2 * y0); slope = (yp - ym) / 0.12; } else if (Number.isFinite(yp)) slope = (yp - y0) / 0.06; else if (Number.isFinite(ym)) slope = (y0 - ym) / 0.06;
      const along = Math.abs(cx * P.fx + cz * P.fz) / (Math.hypot(P.fx, P.fz) || 1);
      const sc = n - 25 * curv + 0.3 * along;
      if (sc > bestS) { bestS = sc; bestA = th; bestSlope = clamp(slope, -1.2, 1.2); }
    }
    if (bestA < 0 || bestS < 1) { tailGap(P, s, ANY); return; }
    const cx = Math.cos(bestA), cz = Math.sin(bestA);
    // which way it faces: the record's heading, unless facing out along a stub fits better
    const hs = cx * P.fx + cz * P.fz >= 0 ? 1 : -1;
    const trunks = trunksByOwner.get(owner) || [];
    const inTrunk = (x, y, z) => {
      for (const t of trunks) if (y > t.y0 - 0.1 && y < t.y1 + 0.5 && Math.hypot(x - t.x, z - t.z) < t.r0 + 0.03) return true;
      if (Number.isFinite(P.ax) && Number.isFinite(P.trunkR) && Math.hypot(x - P.ax, z - P.az) < P.trunkR + 0.03) return true;
      return false;
    };
    const US = [0.9, 0.45, 0, -0.35, -0.6, -0.8, -1.0]; // along the body: snout .. tail tip (share of front or back)
    let best = null, bestPen = Infinity;
    for (const sg of [hs, -hs]) {
      const dx = cx * sg, dz = cz * sg, sl = bestSlope * sg;
      for (let o = -0.24; o <= 0.2401; o += 0.03) {
        const px = x0 + cx * o, pz = z0 + cz * o;
        const py = probe(px, y0 + bestSlope * o, pz, WOOD);
        if (!Number.isFinite(py)) continue;
        let pen = Math.abs(o) * 1.5 + (sg === hs ? 0 : 0.35);
        for (let q = 0; q < US.length; q++) {
          const u = US[q] * (US[q] > 0 ? B.front : -B.back);
          const qx = px + dx * u, qz = pz + dz * u, ly = py + sl * u;
          const sy = probe(qx, ly, qz, ANY);
          const g = ly - sy; // gap under the body line (positive: the surface is below)
          const tail = US[q] <= -0.6, front = US[q] >= 0.9;
          if (!Number.isFinite(sy)) pen += tail ? 0.12 : front ? 0.3 : 1;
          else if (g < -0.02) pen += 2 + 20 * (-g);
          else if (!tail && !front && g > 0.025) pen += 0.6;
          if (inTrunk(qx, ly, qz)) pen += 3;
        }
        if (pen < bestPen) { bestPen = pen; best = { px, py, pz, dx, dz, sl }; }
      }
    }
    if (!best) { tailGap(P, s, ANY); return; }
    // settle on the chosen spot, on the top of the limb, upright across it
    if (index.cast(best.px, best.py + 0.14, best.pz, 0, -1, 0, 0.34, WOOD, 0.14, hit)) setHit(P, hit);
    ridge(P, -best.dz, best.dx);
    const fl = Math.hypot(best.dx, best.sl, best.dz);
    const fx = best.dx / fl, fy = best.sl / fl, fz = best.dz / fl;
    // the normal: straight up, made square to the limb
    P.nx = -fy * fx; P.ny = 1 - fy * fy; P.nz = -fy * fz;
    const nl = Math.hypot(P.nx, P.ny, P.nz) || 1;
    P.nx /= nl; P.ny /= nl; P.nz /= nl;
    P.fx = fx; P.fy = fy; P.fz = fz;
    projectForward(P);
    tailGap(P, s, ANY);
    stats.fitted++;
  }

  // Moves P sideways, along (sx, sz), onto the highest point of the wood under it
  // within 7 cm: the ridge of a limb.
  function ridge(P, sx, sz) {
    let by = -Infinity, bo = 0;
    for (let o = -0.07; o <= 0.0701; o += 0.0175) {
      const y = probe(P.x + sx * o, P.y, P.z + sz * o, WOOD);
      if (Number.isFinite(y) && y > by + 0.002) { by = y; bo = o; }
    }
    if (by === -Infinity) return;
    const x = P.x + sx * bo, z = P.z + sz * bo;
    if (index.cast(x, by + 0.1, z, 0, -1, 0, 0.2, WOOD, 0.1, hit)) { P.x = hit.x; P.y = hit.y; P.z = hit.z; P.w = hit.w; }
  }

  // The tail at rest: it lies on the perch as far as the perch goes (droopAt, a share
  // of the tail's length), then bends down over the end (droop), or up where the
  // perch rises under it (a negative droop), never more than a centimetre into wood.
  function tailGap(P, s, mask) {
    const B = bodyOf(s.sp, s.sex);
    const z0 = B.tail0 ?? 0.2 * B.back, TL = z0 - B.back;
    if (!(TL > 0.02) || Math.hypot(P.fx, P.fz) < 0.3) return;
    let k1 = -1;
    for (let k = 1; k <= TS; k++) {
      const u = z0 - (TL * k) / TS;
      const ly = P.y + P.fy * u;
      const sy = probe(P.x + P.fx * u, ly, P.z + P.fz * u, mask, 0.3);
      _g[k - 1] = Number.isFinite(sy) ? ly - sy : 9;
      if (k1 < 0 && !(_g[k - 1] < 0.025 && _g[k - 1] > -0.02)) k1 = k;
    }
    P.droop = 0; P.droopAt = 0;
    if (k1 < 0) return;
    const at = clamp((k1 - 1) / TS, 0, 0.85), d0 = at * TL, Ld = TL - d0;
    for (let k = 0; k < TS; k++) _e[k] = (TL * (k + 1)) / TS - d0;
    const gt = _g[TS - 1];
    const target = gt < 0.35 * Ld ? gt : 0.62 * Ld; // rest the tip on what is there, or hang
    let best = 0, bestCost = Infinity;
    for (let v = -1; v <= 1.0001; v += 0.02) {
      const kd = (v * 1.5) / Ld;
      let over = 0, tip = 0;
      for (let k = 0; k < TS; k++) {
        const e = _e[k];
        if (e <= 0) continue;
        const hv = 0.5 * kd * e, drop = Math.abs(hv) > 1e-5 ? e * (Math.sin(hv) / hv) * Math.sin(hv) : 0;
        over = Math.max(over, drop - (_g[k] + 0.01)); // how far into the surface
        if (k === TS - 1) tip = drop;
      }
      const cost = 20 * Math.max(0, over) + Math.abs(tip - target);
      if (cost < bestCost) { bestCost = cost; best = v; }
    }
    P.droopAt = +at.toFixed(3);
    P.droop = +best.toFixed(2);
  }

  function trunkNear(owner, x, z, maxD) {
    const list = trunksByOwner.get(owner);
    if (!list) return null;
    let best = null, bd = maxD;
    for (const t of list) {
      const d = Math.hypot(t.x - x, t.z - z) - t.r0;
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  function setHit(P, h) {
    P.x = h.x; P.y = h.y; P.z = h.z; P.nx = h.nx; P.ny = h.ny; P.nz = h.nz; P.w = h.w; P.fl = h.kind === LEAF ? 1 : 0;
  }

  // ---------------------------------------------------------------- path builders

  // Round a trunk from (th0, y0) to (th1, y1), point by point on the drawn bark.
  // The current point is expected to be in the route already. Returns the last radius.
  function barkPath(route, P, th0, y0, th1, y1, r0) {
    let rRef = r0;
    const dth = th1 - th0;
    const arc = Math.abs(dth) * rRef + Math.abs(y1 - y0);
    const n = Math.max(2, Math.min(70, Math.ceil(arc / 0.05)));
    for (let k = 1; k <= n; k++) {
      const s = k / n;
      const th = th0 + dth * s;
      const y = y0 + (y1 - y0) * s;
      if (trunkPoint(P.ax, P.az, th, y, rRef, hit)) {
        rRef = Math.hypot(hit.x - P.ax, hit.z - P.az);
        route.push(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, hit.w, 0, SURF.BARK);
      } else {
        const c = Math.cos(th), sn = Math.sin(th);
        route.push(P.ax + c * rRef, y, P.az + sn * rRef, c, 0, sn, route.count ? route.w[route.count - 1] : 1, 0, SURF.BARK);
      }
    }
    return rRef;
  }

  // Along a branch towards its stem (towards = 1) or out towards the tip (-1), by
  // downward rays stepping in plan. Stops at the trunk (returns 'trunk'), in leaves
  // ('leaf') or where the branch ends ('end'). The current point is in the route.
  function branchPath(route, P, x, y, z, towards, maxLen) {
    let dx = P.ax - x, dz = P.az - z;
    const l = Math.hypot(dx, dz) || 1;
    dx = (dx / l) * towards; dz = (dz / l) * towards;
    const rT = Number.isFinite(P.trunkR) ? P.trunkR : 0.08;
    let cx = x, cy = y, cz = z, went = 0;
    const step = 0.04;
    while (went < maxLen) {
      const qx = cx + dx * step, qz = cz + dz * step;
      if (towards > 0 && Math.hypot(qx - P.ax, qz - P.az) <= rT + 0.03) return 'trunk';
      const mask = towards > 0 ? WOOD : ANY;
      if (!index.cast(qx, cy + 0.22, qz, 0, -1, 0, 0.5, mask, 0.22, hit)) return 'end';
      if (Math.abs(hit.y - cy) > 0.2) return 'end';
      route.pushHit(hit, hit.kind === LEAF ? SURF.LEAF : SURF.BRANCH);
      went += Math.hypot(qx - cx, hit.y - cy, qz - cz);
      cx = qx; cy = hit.y; cz = qz;
      if (hit.kind === LEAF) return 'leaf';
    }
    return 'end';
  }

  // A few steps over any surface (leaves, branches) in a plan direction.
  function scamperPath(route, x, y, z, dx, dz, len) {
    let cx = x, cy = y, cz = z, went = 0;
    while (went < len) {
      const qx = cx + dx * 0.04, qz = cz + dz * 0.04;
      if (!index.cast(qx, cy + 0.15, qz, 0, -1, 0, 0.35, ANY, 0.15, hit) || hit.ny < 0.2) break;
      route.pushHit(hit, hit.kind === LEAF ? SURF.LEAF : SURF.BRANCH);
      went += Math.hypot(qx - cx, hit.y - cy, qz - cz);
      cx = qx; cy = hit.y; cz = qz;
    }
    return went;
  }

  // A hop through the air to foliage 0.3 to 0.6 m away, roughly away from (dx, dz).
  function hopPath(route, x, y, z, dx, dz) {
    const base = Math.atan2(dz, dx);
    for (const da of [0, 0.5, -0.5, 1.0, -1.0]) {
      const a = base + da;
      for (const dist of [0.55, 0.42, 0.3]) {
        const qx = x + Math.cos(a) * dist, qz = z + Math.sin(a) * dist;
        if (!index.cast(qx, y + 0.45, qz, 0, -1, 0, 0.9, ANY, 0.45, hit) || hit.ny < 0.35) continue;
        if (Math.abs(hit.y - y) > 0.4) continue;
        // the arc
        const hx = hit.x, hy = hit.y, hz = hit.z, nx = hit.nx, ny = hit.ny, nz = hit.nz, w = hit.w, fl = hit.kind === LEAF ? 1 : 0;
        const lift = 0.1 + 0.15 * dist;
        for (let k = 1; k <= 8; k++) {
          const s = k / 8;
          const ax = x + (hx - x) * s, az = z + (hz - z) * s, ay = y + (hy - y) * s + lift * 4 * s * (1 - s);
          if (k < 8) route.push(ax, ay, az, 0, 1, 0, 0, 0, SURF.LEAF);
          else route.push(hx, hy, hz, nx, ny, nz, w, fl, fl ? SURF.LEAF : SURF.BRANCH);
        }
        return true;
      }
    }
    return false;
  }

  // Over the ground in a straight line to (tx, tz), stopping short of water.
  const gn = { nx: 0, ny: 1, nz: 0 };
  function groundPath(route, x, z, tx, tz) {
    const L = Math.hypot(tx - x, tz - z);
    const n = Math.max(1, Math.ceil(L / 0.12));
    for (let k = 1; k <= n; k++) {
      const s = k / n;
      const px = x + (tx - x) * s, pz = z + (tz - z) * s;
      const m = T.maskAt(px, pz);
      if (!(m & T.bits.walkable) && !(m & T.bits.thicket)) break;
      if (T.isWater(px, pz)) break;
      groundNormal(T, px, pz, gn);
      route.push(px, T.heightAt(px, pz), pz, gn.nx, gn.ny, gn.nz, 0, 0, SURF.GROUND);
      if (m & T.bits.thicket) break; // into the thicket
    }
  }

  // Cover near (x, z) for a lizard on the ground, preferring the side away from
  // (ax, az): the edge of a bush, trunk or prop circle, a log, or the thicket edge.
  // For a circle the lizard makes for the near edge and then goes round to the far
  // side (cover.ci >= 0; coverPath draws that), so it never slips out of sight on the
  // player's side of a trunk.
  const cover = { x: 0, z: 0, d: 0, ci: -1 };
  function findCover(x, z, ax, az, maxR = 6) {
    let best = Infinity, ci = -1;
    const consider = (tx, tz, i) => {
      const dx = tx - x, dz = tz - z;
      const d = Math.hypot(dx, dz);
      const cosA = d > 1e-3 ? (dx * ax + dz * az) / d : 1;
      if (cosA < -0.35 && d > 0.7) return;
      const score = d - 1.1 * cosA * Math.min(d, 2.5) + (cosA < 0 ? 1.5 : 0);
      if (score < best) { best = score; cover.x = tx; cover.z = tz; cover.d = d; ci = i; }
    };
    if (collision) {
      for (let i = 0; i < collision.n; i++) {
        const cx = collision.cx[i], cz = collision.cz[i], r = collision.cr[i];
        const dx = x - cx, dz = z - cz;
        const d = Math.hypot(dx, dz);
        if (d - r > maxR || d < 1e-3) continue;
        consider(cx + (dx / d) * Math.max(0.05, r - 0.05), cz + (dz / d) * Math.max(0.05, r - 0.05), i);
      }
    }
    for (const lg of data.spawns.logs || []) {
      const lx = Math.cos(lg.rot), lz = -Math.sin(lg.rot);
      let t = (x - lg.x) * lx + (z - lg.z) * lz;
      t = Math.max(-lg.len / 2, Math.min(lg.len / 2, t));
      const px = lg.x + lx * t, pz = lg.z + lz * t;
      if (Math.hypot(px - x, pz - z) < maxR) consider(px, pz);
    }
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const cx = Math.cos(a), cz = Math.sin(a);
      for (let d = 0.25; d <= maxR; d += 0.25) {
        const m = T.maskAt(x + cx * d, z + cz * d);
        if (m & T.bits.walkable) continue;
        if (m & T.bits.thicket) consider(x + cx * d, z + cz * d, -1);
        break;
      }
    }
    cover.ci = ci;
    return best < Infinity ? cover : null;
  }

  // Over the ground to cover from findCover: to its edge, and for a trunk, bush or prop
  // circle on round the rim to the side away from (ax, az).
  function coverPath(route, x, z, cov, ax, az) {
    groundPath(route, x, z, cov.x, cov.z);
    if (cov.ci < 0 || !collision) return;
    const cx = collision.cx[cov.ci], cz = collision.cz[cov.ci], r = collision.cr[cov.ci];
    const last = route.last(_lp);
    if (Math.hypot(last.x - cov.x, last.z - cov.z) > 0.1) return; // stopped short (water)
    const rr = Math.max(0.06, r - 0.02);
    const th0 = Math.atan2(cov.z - cz, cov.x - cx);
    let d = Math.atan2(az, ax) - th0;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const n = Math.min(24, Math.ceil(Math.abs(d) * rr / 0.1));
    for (let k = 1; k <= n; k++) {
      const th = th0 + d * (k / n);
      const px = cx + Math.cos(th) * rr, pz = cz + Math.sin(th) * rr;
      const m = T.maskAt(px, pz);
      if (!(m & T.bits.walkable) && !(m & T.bits.thicket)) break;
      if (T.isWater(px, pz)) break;
      groundNormal(T, px, pz, gn);
      route.push(px, T.heightAt(px, pz), pz, gn.nx, gn.ny, gn.nz, 0, 0, SURF.GROUND);
    }
  }
  const _lp = { x: 0, y: 0, z: 0 };

  // Along a log's top to the end away from (ax, az).
  function logPath(route, P, x, y, z, ax, az) {
    const lg = P.log;
    if (!lg) return;
    const lx = Math.cos(lg.rot), lz = -Math.sin(lg.rot);
    const t0 = (x - lg.x) * lx + (z - lg.z) * lz;
    const sg = lx * ax + lz * az >= 0 ? 1 : -1;
    const t1 = sg * (lg.len / 2 - 0.08);
    const n = Math.max(1, Math.ceil(Math.abs(t1 - t0) / 0.06));
    const ox = x - (lg.x + lx * t0), oz = z - (lg.z + lz * t0); // keep the lizard's offset across the log
    let cy = y;
    for (let k = 1; k <= n; k++) {
      const t = t0 + (t1 - t0) * (k / n);
      const px = lg.x + lx * t + ox, pz = lg.z + lz * t + oz;
      if (index.cast(px, cy + 0.2, pz, 0, -1, 0, 0.45, WOOD, 0.2, hit) && hit.ny > 0.2) {
        route.pushHit(hit, SURF.LOG);
        cy = hit.y;
      } else break;
    }
  }

  const groundNormalAt = (x, z) => groundNormal(T, x, z, gn);

  stats.buildMs = Math.round(performance.now() - t0);
  return {
    index, perches, stats, trunkPoint, surfaceBelow, barkPath, branchPath, scamperPath, hopPath, groundPath, findCover, coverPath, logPath, groundNormalAt,
    hit, WOOD, LEAF, ANY,
  };
}

function nearestLog(logs, x, z) {
  let best = null, bd = 1.5;
  for (const l of logs || []) {
    const d = Math.hypot(l.x - x, l.z - z) - l.len / 2;
    if (d < bd) { bd = d; best = l; }
  }
  return best;
}

export function groundNormal(T, x, z, out) {
  const e = 0.2;
  const hx = T.heightAt(x + e, z) - T.heightAt(x - e, z);
  const hz = T.heightAt(x, z + e) - T.heightAt(x, z - e);
  const l = Math.hypot(hx, 2 * e, hz);
  out.nx = -hx / l; out.ny = (2 * e) / l; out.nz = -hz / l;
  return out;
}

// Forward in the surface plane, from the heading in P.fx, fy, fz.
function projectForward(P) {
  const d = P.fx * P.nx + P.fy * P.ny + P.fz * P.nz;
  let fx = P.fx - P.nx * d, fy = P.fy - P.ny * d, fz = P.fz - P.nz * d;
  let l = Math.hypot(fx, fy, fz);
  if (l < 1e-3) { // heading along the normal: any tangent will do
    fx = P.ny; fy = -P.nx; fz = 0; l = Math.hypot(fx, fy, fz) || 1;
  }
  P.fx = fx / l; P.fy = fy / l; P.fz = fz / l;
}

// Bark lizards rest head up or head down along the trunk.
function restForwardBark(P) {
  P.fx = 0; P.fy = 1; P.fz = 0;
  projectForward(P);
}
