// Where the listener is, for the ambience and the footsteps: metres to the lake (up
// to 24 m), how much canopy is overhead round about (0..1), and the ground under
// foot (grass, path, mud, causeway or leaf litter) with how much long grass there is.
// Two coarse 1 m fields are made once from the terrain grids; sampling allocates
// nothing.

import { chamfer } from '../world/terrain.js';
import { SURFACE } from './sfx.js';

export function createPlace(game) {
  const T = game.data.terrain;
  const F = game.terrain && game.terrain.fields;
  const bits = T.bits;
  const C = 1;
  const cols = Math.ceil((T.xmax - T.xmin) / C), rows = Math.ceil((T.zmax - T.zmin) / C);
  const x0 = T.xmin + C / 2, z0 = T.zmin + C / 2;

  // water: a coarse cell is water when its centre is
  const src = new Uint8Array(cols * rows);
  const cover = new Float32Array(cols * rows);
  const k = T.header.canopy.scale;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = x0 + c * C, z = z0 + r * C;
      src[r * cols + c] = T.isWater(x, z) ? 1 : 0;
      // share of the fine cells under trees taller than 2.5 m
      let n = 0, hit = 0;
      for (let dz = -0.375; dz <= 0.38; dz += 0.25) {
        for (let dx = -0.375; dx <= 0.38; dx += 0.25) {
          const i = T.cellIndex(x + dx, z + dz);
          if (i < 0) continue;
          n++;
          if (T.canopy[i] * k > 2.5) hit++;
        }
      }
      cover[r * cols + c] = n ? hit / n : 0;
    }
  }
  const water = chamfer(cols, rows, C, src, 24);
  const canopy = blur(cover, cols, rows, 6);

  function bilinear(arr, x, z) {
    let fc = (x - x0) / C, fr = (z - z0) / C;
    if (fc < 0) fc = 0; else if (fc > cols - 1.001) fc = cols - 1.001;
    if (fr < 0) fr = 0; else if (fr > rows - 1.001) fr = rows - 1.001;
    const c = Math.floor(fc), r = Math.floor(fr), tx = fc - c, tz = fr - r;
    const i = r * cols + c;
    const a = arr[i] + (arr[i + 1] - arr[i]) * tx;
    const b = arr[i + cols] + (arr[i + cols + 1] - arr[i + cols]) * tx;
    return a + (b - a) * tz;
  }

  // out: { water, canopy, surface, grass }
  function sample(x, z, out) {
    out.water = bilinear(water, x, z);
    out.canopy = Math.min(1, bilinear(canopy, x, z) * 1.3);
    const i = T.cellIndex(x, z);
    if (i < 0 || !F) { out.surface = SURFACE.grass; out.grass = 0.5; return out; }
    const m = T.mask[i];
    const pm = F.path ? F.path[i] : 0;
    const dW = F.toWater ? F.toWater[i] : 8;
    const lit = F.litter ? F.litter[i] : 0;
    const can = F.canopy ? F.canopy[i] : 0;
    let s = SURFACE.grass;
    if (dW < 0.8 && pm < 0.5) s = SURFACE.mud;
    else if (m & bits.causeway) s = SURFACE.causeway;
    else if (pm > 0.45) s = SURFACE.path;
    else if (m & bits.fringe) s = SURFACE.mud;
    else if (lit > 0.35) s = SURFACE.litter;
    out.surface = s;
    // long grass to rustle through: open lawn, off the paths, away from the shore
    out.grass = s === SURFACE.grass ? Math.max(0, 1 - pm * 2) * (1 - Math.min(1, Math.max(0, (can - 2) / 5))) * Math.min(1, Math.max(0, (dW - 1) / 1.5)) : 0;
    return out;
  }

  return { sample };
}

function blur(a, cols, rows, radius) {
  const b = new Float32Array(a.length), o = new Float32Array(a.length);
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
      o[r * cols + c] = s / w;
      s += b[Math.min(rows - 1, r + radius + 1) * cols + c] - b[Math.max(0, r - radius) * cols + c];
    }
  }
  return o;
}
