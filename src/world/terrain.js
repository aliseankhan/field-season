// Terrain mesh from the 0.25 m height grid.
//
// One indexed mesh, one draw call. The grid is cut into 1 m blocks, each drawn
// at 0.25 m where the player can walk (so the surface matches the grid the
// player samples), 0.5 m over the rest of the island and fringe land, and 1 m
// elsewhere. Edge vertices of a finer block are snapped onto its coarser
// neighbour's edge so there are no cracks. A skirt of widening quads carries
// the edge of the grid out to the fog, closing the lake and rising gently.
//
// The look is a storybook lawn rather than the orthomosaic: palette.json only
// sets the order (lawn lighter than shade, then litter, then mud); the hues are
// brighter and warmer. Worn paths come from ground_decor.js.

import * as THREE from 'three';
import { buildPaths, buildGroundDecor } from './ground_decor.js';

const B = 4; // cells per block side (1 m)
const SKIRT = [8, 20, 40, 70, 110, 170, 260, 400, 620]; // metres beyond the grid

// Storybook ground colours (sRGB).
const GROUND = {
  lawnWarm: '#a8d860',
  lawnCool: '#74c04f',
  underCanopy: '#6fae4e',
  litter: '#c39460',
  thicket: '#5a8c46',
  bank: '#9cd062',
  mud: '#a27b52',
  wetSand: '#e2cb98',
  bedShallow: '#d6c38e',
  bedDeep: '#5aa59a',
  islet: '#86653f',
  moss: '#72a448',
  pathCentre: '#e6c890',
  pathEdge: '#d4b27c',
  pebble: '#b89a70',
};

// ---------------------------------------------------------------- helpers

export function hash2(ix, iz) {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function valueNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  let fx = x - ix, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

const smooth = (e0, e1, v) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// Chamfer distance (metres) from every cell to the nearest source cell, capped.
export function chamfer(cols, rows, cell, src, cap = 8) {
  const d = new Float32Array(cols * rows);
  for (let i = 0; i < d.length; i++) d[i] = src[i] ? 0 : cap;
  const o = cell, g = cell * Math.SQRT2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      let v = d[i];
      if (v === 0) continue;
      if (c > 0) v = Math.min(v, d[i - 1] + o);
      if (r > 0) {
        v = Math.min(v, d[i - cols] + o);
        if (c > 0) v = Math.min(v, d[i - cols - 1] + g);
        if (c < cols - 1) v = Math.min(v, d[i - cols + 1] + g);
      }
      d[i] = v;
    }
  }
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      const i = r * cols + c;
      let v = d[i];
      if (v === 0) continue;
      if (c < cols - 1) v = Math.min(v, d[i + 1] + o);
      if (r < rows - 1) {
        v = Math.min(v, d[i + cols] + o);
        if (c < cols - 1) v = Math.min(v, d[i + cols + 1] + g);
        if (c > 0) v = Math.min(v, d[i + cols - 1] + g);
      }
      d[i] = v;
    }
  }
  return d;
}

// Distance (metres) to the nearest cell where isSource(mask) is true, capped.
export function distanceField(T, isSource, cap = 8) {
  const src = new Uint8Array(T.cols * T.rows);
  for (let i = 0; i < src.length; i++) src[i] = isSource(T.mask[i]) ? 1 : 0;
  return chamfer(T.cols, T.rows, T.cell, src, cap);
}

// Separable box blur of the canopy height, in metres.
function blurredCanopy(T, radius) {
  const { cols, rows, canopy } = T;
  const k = T.header.canopy.scale;
  const a = new Float32Array(cols * rows);
  const b = new Float32Array(cols * rows);
  for (let i = 0; i < a.length; i++) a[i] = canopy[i] * k;
  const w = 2 * radius + 1;
  for (let r = 0; r < rows; r++) {
    let s = 0;
    const row = r * cols;
    for (let c = -radius; c <= radius; c++) s += a[row + Math.min(cols - 1, Math.max(0, c))];
    for (let c = 0; c < cols; c++) {
      b[row + c] = s / w;
      s += a[row + Math.min(cols - 1, c + radius + 1)] - a[row + Math.max(0, c - radius)];
    }
  }
  for (let c = 0; c < cols; c++) {
    let s = 0;
    for (let r = -radius; r <= radius; r++) s += b[Math.min(rows - 1, Math.max(0, r)) * cols + c];
    for (let r = 0; r < rows; r++) {
      a[r * cols + c] = s / w;
      s += b[Math.min(rows - 1, r + radius + 1) * cols + c] - b[Math.max(0, r - radius) * cols + c];
    }
  }
  return a;
}

// Is collider circle i a trunk (r = dbh / 2 + 0.15) rather than a bush core?
export function isTrunkCircle(data, i) {
  const owner = data.colliders.owners[i] || '';
  const r = data.colliders.circles[i][2];
  const k = +owner.slice(1);
  if (owner[0] === 'L') return true;
  if (owner[0] === 'P') {
    const pl = data.placements.plants[k];
    return !!pl && Math.abs(r - (pl.dbh / 2 + 0.15)) < 0.03;
  }
  return false;
}

// Per-cell ground shading from the trunks and bush cores: a soft dark ring at
// each base (fake ambient occlusion) and leaf-litter patches round big trees.
function baseFields(data, fields) {
  const T = data.terrain;
  const { cols, rows, cell } = T;
  const ao = new Float32Array(cols * rows);
  const litter = new Float32Array(cols * rows);
  const { circles } = data.colliders;
  const dbhOf = (i) => {
    const o = data.colliders.owners[i] || '';
    const k = +o.slice(1);
    if (o[0] === 'L') return data.placements.landmarks[k] ? data.placements.landmarks[k].dbh : 0;
    if (o[0] === 'P') return data.placements.plants[k] ? data.placements.plants[k].dbh : 0;
    return 0;
  };
  const kCan = T.header.canopy.scale;
  circles.forEach(([x, z, r], i) => {
    const trunk = isTrunkCircle(data, i);
    const edge = trunk ? r - 0.15 : r / 0.7; // bark, or the drawn edge of the bush
    const reach = edge + (trunk ? 0.8 : 0.6);
    const lit = trunk && dbhOf(i) >= 0.25 ? 2.5 : 0;
    const R = Math.max(reach, lit);
    const c0 = Math.max(0, T.colOf(x - R)), c1 = Math.min(cols - 1, T.colOf(x + R));
    const r0 = Math.max(0, T.rowOf(z - R)), r1 = Math.min(rows - 1, T.rowOf(z + R));
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        const j = rr * cols + cc;
        const d = Math.hypot(T.xOf(cc) - x, T.zOf(rr) - z);
        const a = (trunk ? 0.22 : 0.16) * (1 - smooth(edge * 0.6, reach, d));
        if (a > ao[j]) ao[j] = a;
        if (lit && T.canopy[j] * kCan >= 6) {
          const l = 1 - smooth(1.0, lit, d);
          if (l > litter[j]) litter[j] = l;
        }
      }
    }
  });
  fields.ao = ao;
  fields.litter = litter;
  void cell;
}

// ---------------------------------------------------------------- colours

function makePainter(data, fields) {
  const col = (hex) => new THREE.Color(hex);
  const G = Object.fromEntries(Object.entries(GROUND).map(([k, v]) => [k, col(v)]));
  const bits = data.terrain.bits;
  const base = new THREE.Color();
  const tmp = new THREE.Color();
  const path = fields.path;

  // out: THREE.Color (linear). i: cell index or -1 for the skirt.
  return function paint(out, x, z, y, i) {
    const n1 = valueNoise(x * 0.12 + 17.3, z * 0.12 - 4.1); // about 8 m
    const n2 = valueNoise(x * 0.55 - 3.3, z * 0.55 + 9.2); // about 2 m
    const speck = hash2(Math.round(x * 4), Math.round(z * 4));
    let m, can, dW, ao = 0, lit = 0, pm = 0;
    if (i >= 0) {
      m = data.terrain.mask[i];
      can = fields.canopy[i];
      dW = fields.toWater[i];
      ao = fields.ao[i];
      lit = fields.litter[i];
      pm = path ? path[i] : 0;
    } else {
      m = y > 0.02 ? bits.bank : bits.water;
      can = 0;
      dW = 8;
    }
    const depth = -y;

    if (m & bits.water) {
      // Lake bed: pale sand under the shallows, fading to teal by 0.6 m.
      out.copy(G.bedShallow).lerp(G.bedDeep, smooth(0.04, 0.6, depth));
      out.multiplyScalar(0.94 + 0.12 * n2);
      return out;
    }

    if (m & (bits.island | bits.causeway)) {
      base.copy(G.lawnCool).lerp(G.lawnWarm, smooth(0.3, 0.72, n1));
      base.lerp(G.lawnWarm, 0.25 * (n2 - 0.5));
      base.lerp(G.underCanopy, 0.38 * smooth(1.2, 3.0, can)); // the shadows darken it too
      if (lit > 0) base.lerp(G.litter, 0.55 * lit * smooth(0.25, 0.6, n2 + 0.2 * speck));
      if (m & bits.thicket) base.lerp(G.thicket, 0.85);
    } else if (m & bits.bank) {
      base.copy(G.bank).lerp(G.lawnCool, 0.45 * n1);
      base.lerp(G.underCanopy, 0.45 * smooth(2.0, 5.0, can));
      if (i < 0) base.lerp(G.bank, smooth(0.2, 2.0, y) * 0.3);
    } else {
      // Fringe islets under the mangroves: mossy tops with patches of dark mud,
      // so they read as little islands rather than rafts.
      base.copy(G.moss).lerp(G.islet, 0.6 * smooth(0.55, 0.85, n2 * 0.7 + n1 * 0.3)).lerp(G.mud, 0.12 * n2);
    }

    // Shore: mud at the waterline, then a pale wet-sand band, then the ground.
    // Mangrove islets keep a dark mud rim instead of sand.
    if (dW < 1.7) {
      if (m & (bits.island | bits.causeway | bits.bank)) {
        // narrower on the causeway, so its sandy edges do not read as a second path
        const k = m & bits.causeway ? 0.6 : 1;
        tmp.copy(G.mud).lerp(G.wetSand, smooth(0.18 * k, 0.45 * k, dW));
        base.lerp(tmp, 1 - smooth(1.0 * k, 1.6 * k, dW));
      } else {
        base.lerp(G.islet, 0.6 * (1 - smooth(0.2, 0.9, dW)));
      }
    }

    // Worn path: warm sandy dirt, paler in the middle, with a few pebbles.
    if (pm > 0.001) {
      tmp.copy(G.pathEdge).lerp(G.pathCentre, smooth(0.5, 1.0, pm));
      if (speck > 0.94) tmp.lerp(G.pebble, 0.7);
      else if (speck < 0.04) tmp.multiplyScalar(1.06);
      base.lerp(tmp, pm);
    }

    out.copy(base).multiplyScalar((1 - ao) * (0.96 + 0.06 * n1 + 0.03 * (speck - 0.5)));
    return out;
  };
}

// ---------------------------------------------------------------- mesh

export function buildTerrain(data) {
  const T = data.terrain;
  const { cols, rows, cell, height, mask, bits } = T;
  const nbx = Math.floor((cols - 1) / B);
  const nbz = Math.floor((rows - 1) / B);

  // Distance to blocked ground, counting trunk and bush circles as blocked too.
  const blockedSrc = new Uint8Array(cols * rows);
  for (let i = 0; i < blockedSrc.length; i++) blockedSrc[i] = mask[i] & bits.walkable ? 0 : 1;
  for (const [x, z, r] of data.colliders.circles) {
    const R = r + 0.1;
    for (let rr = Math.max(0, T.rowOf(z - R)); rr <= Math.min(rows - 1, T.rowOf(z + R)); rr++) {
      for (let cc = Math.max(0, T.colOf(x - R)); cc <= Math.min(cols - 1, T.colOf(x + R)); cc++) {
        if (Math.hypot(T.xOf(cc) - x, T.zOf(rr) - z) < R) blockedSrc[rr * cols + cc] = 1;
      }
    }
  }
  const fields = {
    toWater: distanceField(T, (m) => (m & bits.water) !== 0),
    canopy: blurredCanopy(T, 4),
    blockedDist: chamfer(cols, rows, cell, blockedSrc, 8),
    thicketDist: distanceField(T, (m) => (m & bits.thicket) !== 0, 4),
  };
  baseFields(data, fields);
  const paths = buildPaths(data, fields.blockedDist);
  fields.path = paths.mask;
  const paint = makePainter(data, fields);

  // Block levels: 4 (0.25 m), 2 (0.5 m) or 1 (1 m).
  const need = new Uint8Array(nbx * nbz);
  const landBits = bits.island | bits.causeway;
  for (let bz = 0; bz < nbz; bz++) {
    for (let bx = 0; bx < nbx; bx++) {
      let lv = 1;
      for (let r = bz * B; r <= bz * B + B && lv < 4; r++) {
        for (let c = bx * B; c <= bx * B + B; c++) {
          const m = mask[r * cols + c];
          if ((m & bits.walkable) || fields.path[r * cols + c] > 0.01) { lv = 4; break; }
          if ((m & landBits) || ((m & bits.fringe) && !(m & bits.water))) lv = 2;
        }
      }
      need[bz * nbx + bx] = lv;
    }
  }
  const level = new Uint8Array(nbx * nbz);
  for (let bz = 0; bz < nbz; bz++) {
    for (let bx = 0; bx < nbx; bx++) {
      let lv = 1;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = bx + dx, z = bz + dz;
          if (x >= 0 && z >= 0 && x < nbx && z < nbz) lv = Math.max(lv, need[z * nbx + x]);
        }
      }
      level[bz * nbx + bx] = lv;
    }
  }
  const levelAt = (bx, bz) => (bx < 0 || bz < 0 || bx >= nbx || bz >= nbz ? 1 : level[bz * nbx + bx]);

  // Vertices, created on demand.
  const pos = [];
  const colr = [];
  const vmap = new Int32Array(cols * rows).fill(-1);
  const c3 = new THREE.Color();
  function vtx(c, r) {
    const i = r * cols + c;
    let v = vmap[i];
    if (v >= 0) return v;
    v = pos.length / 3;
    vmap[i] = v;
    const x = T.xOf(c), z = T.zOf(r), y = height[i];
    pos.push(x, y, z);
    paint(c3, x, z, y, i);
    colr.push(c3.r, c3.g, c3.b);
    return v;
  }

  const idx = [];
  function quad(a, b, d, e) {
    // a (c, r), b (c+1, r), d (c, r+1), e (c+1, r+1); normals up.
    const ha = pos[a * 3 + 1], hb = pos[b * 3 + 1], hd = pos[d * 3 + 1], he = pos[e * 3 + 1];
    if (Math.abs(ha - he) < Math.abs(hb - hd)) idx.push(a, d, e, a, e, b);
    else idx.push(a, d, b, b, d, e);
  }

  for (let bz = 0; bz < nbz; bz++) {
    for (let bx = 0; bx < nbx; bx++) {
      const L = level[bz * nbx + bx];
      const s = B / L;
      const c0 = bx * B, r0 = bz * B;
      for (let j = 0; j < L; j++) {
        for (let i = 0; i < L; i++) {
          const c = c0 + i * s, r = r0 + j * s;
          quad(vtx(c, r), vtx(c + s, r), vtx(c, r + s), vtx(c + s, r + s));
        }
      }
    }
  }

  // Snap the extra edge vertices of finer blocks onto coarser neighbours.
  function snapSide(cA, rA, dc, dr, L, Ln) {
    const ratio = L / Ln, s = B / L;
    for (let k = 1; k < L; k++) {
      if (k % ratio === 0) continue;
      const k0 = Math.floor(k / ratio) * ratio, k1 = k0 + ratio;
      const v = vmap[(rA + dr * k * s) * cols + cA + dc * k * s];
      const v0 = vmap[(rA + dr * k0 * s) * cols + cA + dc * k0 * s];
      const v1 = vmap[(rA + dr * k1 * s) * cols + cA + dc * k1 * s];
      const t = (k - k0) / ratio;
      pos[v * 3 + 1] = pos[v0 * 3 + 1] * (1 - t) + pos[v1 * 3 + 1] * t;
    }
  }
  for (let bz = 0; bz < nbz; bz++) {
    for (let bx = 0; bx < nbx; bx++) {
      const L = level[bz * nbx + bx];
      if (L === 1) continue;
      const c0 = bx * B, r0 = bz * B;
      let n;
      if ((n = levelAt(bx, bz - 1)) < L) snapSide(c0, r0, 1, 0, L, n);
      if ((n = levelAt(bx, bz + 1)) < L) snapSide(c0, r0 + B, 1, 0, L, n);
      if ((n = levelAt(bx - 1, bz)) < L) snapSide(c0, r0, 0, 1, L, n);
      if ((n = levelAt(bx + 1, bz)) < L) snapSide(c0 + B, r0, 0, 1, L, n);
    }
  }
  const innerTris = idx.length / 3;

  // Skirt: an extended coarse lattice around the grid.
  const nS = SKIRT.length;
  const xin = T.xOf(0), xax = T.xOf(nbx * B), zin = T.zOf(0), zax = T.zOf(nbz * B);
  const xs = [], zs = [];
  for (let k = nS - 1; k >= 0; k--) xs.push(xin - SKIRT[k]);
  for (let k = 0; k <= nbx; k++) xs.push(T.xOf(k * B));
  for (let k = 0; k < nS; k++) xs.push(xax + SKIRT[k]);
  for (let k = nS - 1; k >= 0; k--) zs.push(zin - SKIRT[k]);
  for (let k = 0; k <= nbz; k++) zs.push(T.zOf(k * B));
  for (let k = 0; k < nS; k++) zs.push(zax + SKIRT[k]);
  const nx = xs.length, nz = zs.length;
  // Beyond the grid: the edge height carried outwards, the lake closing
  // 30 to 75 m out, then a gentle rise into the fog.
  function outerHeight(x, z) {
    const xc = Math.min(xax, Math.max(xin, x)), zc = Math.min(zax, Math.max(zin, z));
    const D = Math.max(Math.abs(x - xc), Math.abs(z - zc));
    // Edge height averaged over about 12 m, so small islets and inlets at the
    // edge of the grid do not stretch out as thin streaks.
    let he = 0;
    for (let j = -4; j <= 4; j++) {
      for (let i = -4; i <= 4; i++) {
        he += T.heightAt(Math.min(xax, Math.max(xin, xc + i * 1.5)), Math.min(zax, Math.max(zin, zc + j * 1.5)));
      }
    }
    he /= 81;
    const far = 0.45 + Math.max(0, D - 90) * 0.011 * (0.55 + 0.9 * valueNoise(x * 0.012, z * 0.012));
    return he + (far - he) * smooth(18, 90, D);
  }
  const omap = new Int32Array(nx * nz).fill(-1);
  function ovtx(i, j) {
    const ci = i - nS, rj = j - nS;
    if (ci >= 0 && ci <= nbx && rj >= 0 && rj <= nbz) return vtx(ci * B, rj * B);
    const o = j * nx + i;
    if (omap[o] >= 0) return omap[o];
    const x = xs[i], z = zs[j];
    const y = outerHeight(x, z);
    const v = pos.length / 3;
    omap[o] = v;
    pos.push(x, y, z);
    paint(c3, x, z, y, -1);
    colr.push(c3.r, c3.g, c3.b);
    return v;
  }
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const ci = i - nS, rj = j - nS;
      if (ci >= 0 && ci < nbx && rj >= 0 && rj < nbz) continue;
      quad(ovtx(i, j), ovtx(i + 1, j), ovtx(i, j + 1), ovtx(i + 1, j + 1));
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.matrixAutoUpdate = false;

  // Flowers and clover ride on the terrain mesh (identity transform).
  const decor = buildGroundDecor(data, fields);
  mesh.add(decor.group);

  const counts = { 1: 0, 2: 0, 4: 0 };
  for (const l of level) counts[l]++;
  const backdrop = buildBackdrop({ xin, xax, zin, zax }, outerHeight);
  return {
    mesh,
    backdrop,
    fields,
    paint, // paint(outColor, x, z, y, cellIndex): the ground colour (grass.js tints its tufts with it)
    decor,
    paths: paths.lines,
    update(dt, t) { decor.update(dt, t); },
    stats: {
      vertices: pos.length / 3, triangles: idx.length / 3, innerTriangles: innerTris, blocks: counts,
      backdrop: backdrop.userData.stats, pathMetres: Math.round(paths.length), decor: decor.stats,
    },
  };
}

// ---------------------------------------------------------------- backdrop

// The garden beyond the survey: three bands of rounded tree clumps and
// hedgerows, paler towards the horizon, so the lake sits in a soft green bowl.
// Only the nearest band has trunks. Two instanced meshes; nothing here is inside
// the surveyed area.
const BANDS = [
  { out: [7, 55], step: 8.5, size: [2.8, 4.6], squash: 0.82, trunks: true, cols: ['#6fbb5c', '#86c56a', '#9ccb8e', '#7fc07a'], thresh: 0.5 },
  { out: [55, 150], step: 14, size: [6, 10], squash: 0.7, trunks: false, cols: ['#a4d09a', '#b3d6b2', '#a9d3a4'], thresh: 0.55 },
  { out: [150, 300], step: 24, size: [12, 20], squash: 0.6, trunks: false, cols: ['#c0ddc4', '#c9e2cf', '#d2e7d5'], thresh: 0.56 },
];

function buildBackdrop(box, heightAt) {
  const blobGeo = new THREE.IcosahedronGeometry(1, 1); // smooth normals at detail 1
  blobGeo.deleteAttribute('uv');
  // Normals lean upwards, so the shaded sides of the far trees stay soft and light.
  const nrm = blobGeo.attributes.normal, nv = new THREE.Vector3();
  for (let k = 0; k < nrm.count; k++) {
    nv.fromBufferAttribute(nrm, k);
    nv.y += 0.7;
    nv.normalize();
    nrm.setXYZ(k, nv.x, nv.y, nv.z);
  }
  const trunkGeo = new THREE.CylinderGeometry(0.7, 1, 1, 6, 1, true).translate(0, 0.5, 0);
  trunkGeo.deleteAttribute('uv');

  const blobs = [], trunks = [];
  const insideBox = (x, z) => x > box.xin && x < box.xax && z > box.zin && z < box.zax;
  BANDS.forEach((band, bi) => {
    const R = band.out[1];
    for (let z = box.zin - R; z <= box.zax + R; z += band.step) {
      for (let x = box.xin - R; x <= box.xax + R; x += band.step) {
        const jx = x + (hash2(x * 7 + bi, z * 3) - 0.5) * band.step * 0.9;
        const jz = z + (hash2(x * 5, z * 11 + bi) - 0.5) * band.step * 0.9;
        if (insideBox(jx, jz)) continue;
        const out = Math.max(box.xin - jx, jx - box.xax, box.zin - jz, jz - box.zax);
        if (out < band.out[0] || out > band.out[1]) continue;
        const y = heightAt(jx, jz);
        if (y < 0.3) continue;
        // Groves where the noise is high, and hedgerow lines along its ridges.
        const n = valueNoise(jx * 0.02 + 3.1 + bi, jz * 0.02 - 7.7);
        const ridge = 1 - Math.abs(valueNoise(jx * 0.011 - 5.3, jz * 0.011 + 1.9) - 0.5) * 2;
        if (n < band.thresh && ridge < 0.9) continue;
        const a = hash2(jx * 13, jz * 17), b = hash2(jx * 19, jz * 23);
        const r = band.size[0] + (band.size[1] - band.size[0]) * a;
        const col = band.cols[Math.floor(b * band.cols.length) % band.cols.length];
        if (band.trunks && a > 0.3) {
          // A round tree: a short trunk and two or three crown puffs.
          const th = r * (0.7 + 0.5 * b);
          trunks.push([jx, y - 0.2, jz, r * 0.11, th + r * 0.3]);
          const top = y + th + r * 0.55;
          blobs.push([jx, top, jz, r, r * band.squash, col]);
          blobs.push([jx + r * 0.55, top - r * 0.25, jz + r * 0.2 * (b - 0.5), r * 0.66, r * 0.66 * band.squash, col]);
          if (b > 0.5) blobs.push([jx - r * 0.5, top - r * 0.3, jz - r * 0.3, r * 0.6, r * 0.6 * band.squash, col]);
        } else {
          // A hedgerow lump sitting on the ground.
          blobs.push([jx, y + r * 0.3, jz, r * 1.2, r * band.squash, col]);
        }
      }
    }
  });

  const mat = new THREE.MeshLambertMaterial({ vertexColors: false });
  // In a warm haze (the morning's and evening's peach fog, told by the fog colour
  // itself: its red well over its blue) the far clumps lose a little of their olive and
  // take a rosier gold as they sink into it, and sink a touch further, so the far
  // hills read warm rather than khaki. The midday fog is cool and leaves them alone.
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', `
      #ifdef USE_FOG
        #ifdef FOG_EXP2
          float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
        #else
          float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
        #endif
        float warmFog = smoothstep( 0.05, 0.14, fogColor.r - fogColor.b ); // (fogColor is in the output's sRGB here)
        float lumW = dot( gl_FragColor.rgb, vec3( 0.3, 0.59, 0.11 ) );
        gl_FragColor.rgb = mix( gl_FragColor.rgb, lumW * vec3( 1.13, 0.96, 0.92 ), 0.55 * warmFog * smoothstep( 0.05, 0.4, fogFactor ) );
        gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, min( 1.0, fogFactor * ( 1.0 + 0.22 * warmFog ) ) );
      #endif`);
  };
  mat.customProgramCacheKey = () => 'backdrop-warm-haze-1';
  const blobMesh = new THREE.InstancedMesh(blobGeo, mat, Math.max(1, blobs.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  blobs.forEach(([x, y, z, rw, rh, col], i) => {
    blobMesh.setMatrixAt(i, m.compose(p.set(x, y, z), q.setFromAxisAngle(up, hash2(x * 3, z * 5) * 6.28), sc.set(rw, rh, rw * 0.92)));
    blobMesh.setColorAt(i, c.set(col).multiplyScalar(0.94 + 0.12 * hash2(x * 29, z * 31)));
  });
  blobMesh.count = blobs.length;

  const trunkMat = new THREE.MeshLambertMaterial({ color: '#8a6a4e', flatShading: true });
  const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, Math.max(1, trunks.length));
  trunks.forEach(([x, y, z, r, h], i) => {
    trunkMesh.setMatrixAt(i, m.compose(p.set(x, y, z), q.identity(), sc.set(r, h, r)));
  });
  trunkMesh.count = trunks.length;

  const group = new THREE.Group();
  group.name = 'backdrop';
  for (const [mesh, name] of [[blobMesh, 'backdrop-blobs'], [trunkMesh, 'backdrop-trunks']]) {
    mesh.name = name;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
  }
  group.userData.stats = { blobs: blobs.length, trunks: trunks.length };
  return group;
}
