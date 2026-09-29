// Loads everything in data/ (see data/README.md for the formats) and wraps the
// terrain grids with samplers in game coordinates.

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

async function getBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.arrayBuffer();
}

export async function loadGameData(base = 'data/') {
  const names = ['terrain', 'water', 'placements', 'colliders', 'palette', 'spawns'];
  const json = await Promise.all(names.map((n) => getJSON(`${base}${n}.json`)));
  const [header, water, placements, colliders, palette, spawns] = json;
  const [hBuf, mBuf, cBuf] = await Promise.all([
    getBytes(base + header.height.file),
    getBytes(base + header.mask.file),
    getBytes(base + header.canopy.file),
  ]);
  const terrain = makeTerrain(header, hBuf, mBuf, cBuf);
  return { terrain, water, placements, colliders, palette, spawns };
}

export function makeTerrain(header, hBuf, mBuf, cBuf) {
  const { cols, rows, cell, x0, z0 } = header;
  const n = cols * rows;
  const dv = new DataView(hBuf);
  if (hBuf.byteLength !== n * 2 || mBuf.byteLength !== n || cBuf.byteLength !== n) {
    throw new Error('terrain grids do not match terrain.json');
  }
  const height = new Float32Array(n);
  const { offset, scale } = header.height;
  for (let i = 0; i < n; i++) height[i] = offset + dv.getUint16(i * 2, true) * scale;
  const mask = new Uint8Array(mBuf);
  const canopy = new Uint8Array(cBuf);
  const cscale = header.canopy.scale;
  const bits = header.mask.bits;
  const inv = 1 / cell;

  // Nearest cell index, or -1 outside the grid.
  function cellIndex(x, z) {
    const c = Math.floor((x - x0) * inv + 0.5);
    const r = Math.floor((z - z0) * inv + 0.5);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return -1;
    return r * cols + c;
  }

  // Bilinear on the cell-centre lattice, clamped at the edges.
  function bilinear(arr, x, z, k) {
    let fc = (x - x0) * inv, fr = (z - z0) * inv;
    if (fc < 0) fc = 0; else if (fc > cols - 1) fc = cols - 1;
    if (fr < 0) fr = 0; else if (fr > rows - 1) fr = rows - 1;
    let c = Math.floor(fc), r = Math.floor(fr);
    if (c > cols - 2) c = cols - 2;
    if (r > rows - 2) r = rows - 2;
    const tx = fc - c, tz = fr - r;
    const i = r * cols + c;
    const a = arr[i] + (arr[i + 1] - arr[i]) * tx;
    const b = arr[i + cols] + (arr[i + cols + 1] - arr[i + cols]) * tx;
    return (a + (b - a) * tz) * k;
  }

  return {
    ...header,
    header,
    bits,
    height,
    mask,
    canopy,
    xmin: x0 - cell / 2,
    zmin: z0 - cell / 2,
    xmax: x0 + (cols - 0.5) * cell,
    zmax: z0 + (rows - 0.5) * cell,
    cellIndex,
    colOf: (x) => Math.floor((x - x0) * inv + 0.5),
    rowOf: (z) => Math.floor((z - z0) * inv + 0.5),
    xOf: (c) => x0 + c * cell,
    zOf: (r) => z0 + r * cell,
    heightAt: (x, z) => bilinear(height, x, z, 1),
    canopyAt: (x, z) => bilinear(canopy, x, z, cscale),
    maskAt(x, z) {
      const i = cellIndex(x, z);
      return i < 0 ? 0 : mask[i];
    },
    isWalkable(x, z) {
      const i = cellIndex(x, z);
      return i >= 0 && (mask[i] & bits.walkable) !== 0;
    },
    isThicket(x, z) {
      const i = cellIndex(x, z);
      return i >= 0 && (mask[i] & bits.thicket) !== 0;
    },
    isWater(x, z) {
      const i = cellIndex(x, z);
      return i < 0 || (mask[i] & bits.water) !== 0;
    },
  };
}
