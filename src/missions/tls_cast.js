// The laser scanner's ray caster: a fast analytic caster against what the island is
// drawn from, not three.js's Raycaster over the meshes. The ground is the terrain's
// height grid (marched, then bisected); the lake returns nothing (a laser on water
// comes back to nobody); the vegetation is veg.hosts: crowns, palm fans and bushes as
// ellipsoids that a ray enters and stops inside after a random free path (so a crown
// fills like foliage rather than a shell), trunks as upright cylinders, limbs and logs as
// capsules; the props' circles as short posts. All of it is filed in a 2 m grid over
// x, z and walked with a 2D DDA, nearest hit first. Two moving things are tested on their
// own: the player (drawn into the cloud as a sheet ghost, eyes and all) and a bird.
//
//   const C = buildCaster(game)
//   C.R            Float64Array ray: [ox, oy, oz, dx, dy, dz, maxT] in, then
//                  [7] t, [8..10] the hit, [11] metres above the ground under it, [12] kind
//   C.cast()       -> kind (KIND.*), reads and writes C.R; allocates nothing
//   C.probe(depth) the same, for a question rather than a point: foliage stops the ray
//                  once it is depth metres in (no random free path), and the random
//                  stream is left alone, so asking never changes a scan
//   C.seed(n)      the free paths' random numbers, so a scan repeats exactly;
//                  C.S[0] is the stream's state (a scan keeps its own, tls_cloud.js)
//   C.ghost        Float64Array [on, x, z, y0, height, r, fx, fz, t]: the player's sheet
//                  (fx, fz: unit vector from the player to the scanner, for the face)
//   C.bird         Float64Array [on, x, y, z, r]
//   C.groundAt(x, z), C.near(x, y, z, pad) (inside or near a crown, bush or trunk), C.stats
//
// A scan's worth of rays (57,312 at every spot: 480 columns, steep rows skipping some)
// takes 60 to 80 ms warm, so the mission casts it a column at a time behind the
// sweeping fan.

export const KIND = { NONE: 0, GROUND: 1, VEG: 2, GHOST: 3, EYE: 4, BIRD: 5, MARK: 6, WATER: 7, CHEEK: 8 };

const CELL = 2; // m, the primitive grid
const STRIDE = 8;
// the free path inside foliage (1/m): the mean depth a ray goes in before a leaf stops it
const DENSITY = { crown: 2.4, palm: 1.6, mound: 3.2 };

export function buildCaster(game) {
  const T = game.data.terrain;
  const H = T.height, cols = T.cols, rows = T.rows, x0 = T.x0, z0 = T.z0, inv = 1 / T.cell;
  const mask = T.mask, WATER = T.bits.water;
  let hmax = 0;
  for (let i = 0; i < H.length; i++) if (!(mask[i] & WATER) && H[i] > hmax) hmax = H[i];

  // The ground under G[0], G[1] into G[2] (bilinear on the cell centres, as data.js):
  // the hot loop passes no numbers to calls, so none is boxed.
  const G = new Float64Array(3);
  function gnd() {
    let fc = (G[0] - x0) * inv, fr = (G[1] - z0) * inv;
    if (fc < 0) fc = 0; else if (fc > cols - 1) fc = cols - 1;
    if (fr < 0) fr = 0; else if (fr > rows - 1) fr = rows - 1;
    let c = Math.floor(fc), r = Math.floor(fr);
    if (c > cols - 2) c = cols - 2;
    if (r > rows - 2) r = rows - 2;
    const tx = fc - c, tz = fr - r, i = r * cols + c;
    const a = H[i] + (H[i + 1] - H[i]) * tx;
    const b = H[i + cols] + (H[i + cols + 1] - H[i + cols]) * tx;
    G[2] = a + (b - a) * tz;
  }
  function groundAt(x, z) { G[0] = x; G[1] = z; gnd(); return G[2]; }

  // ---------------------------------------------------------------- the primitives
  // [type, ...] type 0 ellipsoid: cx, cy, cz, 1/rx, 1/ry, 1/rz, density (0 solid)
  //             type 1 upright cylinder: x, z, r^2, y0, y1
  //             type 2 capsule: ax, ay, az, bx, by, bz, r
  const list = [];
  const box = []; // [x0, z0, x1, z1] per primitive
  const hosts = (game.veg && game.veg.hosts) || {};
  const addE = (cx, cy, cz, rx, ry, rz, dens) => {
    if (!(rx > 0.05 && ry > 0.05 && rz > 0.05)) return;
    list.push([0, cx, cy, cz, 1 / rx, 1 / ry, 1 / rz, dens]);
    box.push([cx - rx, cz - rz, cx + rx, cz + rz]);
  };
  const addC = (x, z, r, y0, y1) => {
    if (!(r > 0.01 && y1 > y0)) return;
    list.push([1, x, z, r * r, y0, y1, 0, 0]);
    box.push([x - r, z - r, x + r, z + r]);
  };
  const addK = (a, b, r) => {
    if (!(r > 0.01)) return;
    list.push([2, a[0], a[1], a[2], b[0], b[1], b[2], r]);
    box.push([Math.min(a[0], b[0]) - r, Math.min(a[2], b[2]) - r, Math.max(a[0], b[0]) + r, Math.max(a[2], b[2]) + r]);
  };
  for (const c of hosts.crowns || []) addE(c.cx, c.cy, c.cz, c.rx, c.ry, c.rz, DENSITY.crown);
  for (const c of hosts.palms || []) addE(c.cx, c.cy, c.cz, c.r, c.r * 0.42, c.r, DENSITY.palm);
  for (const m of hosts.mounds || []) addE(m.x, m.y, m.z, m.r, m.h, m.r, DENSITY.mound);
  for (const t of hosts.trunks || []) addC(t.x, t.z, (t.r0 + t.r1) / 2, t.y0 - 0.3, t.y1);
  for (const b of hosts.branches || []) {
    if (b.twig || !Array.isArray(b.a) || !Array.isArray(b.b)) continue;
    addK(b.a, b.b, Math.max(0.035, b.r));
  }
  for (const l of hosts.logs || []) {
    const ax = Math.cos(l.rot) * l.len / 2, az = -Math.sin(l.rot) * l.len / 2, y = l.y + l.r;
    addK([l.x - ax, y, l.z - az], [l.x + ax, y, l.z + az], l.r);
  }
  const pc = game.props && game.props.colliders;
  if (Array.isArray(pc)) {
    for (const c of pc) {
      if (!Array.isArray(c) || c.length < 3) continue;
      const g = groundAt(c[0], c[1]);
      addC(c[0], c[1], c[2] * 0.8, g - 0.1, g + 0.95);
    }
  }
  const N = list.length;
  const B = new Float32Array(Math.max(1, N) * STRIDE);
  list.forEach((e, k) => B.set(e, k * STRIDE));
  let top = hmax + 1;
  for (let k = 0; k < N; k++) {
    const o = k * STRIDE;
    const t = B[o] === 0 ? B[o + 2] + 1 / B[o + 5] : B[o] === 1 ? B[o + 5] : Math.max(B[o + 2], B[o + 5]) + B[o + 7];
    if (t > top) top = t;
  }

  // the grid: cells of CELL metres over the primitives' extent, a CSR list per cell
  let gx0 = Infinity, gz0 = Infinity, gx1 = -Infinity, gz1 = -Infinity;
  for (const b of box) { gx0 = Math.min(gx0, b[0]); gz0 = Math.min(gz0, b[1]); gx1 = Math.max(gx1, b[2]); gz1 = Math.max(gz1, b[3]); }
  if (!N) { gx0 = -1; gz0 = -1; gx1 = 1; gz1 = 1; }
  const nx = Math.ceil((gx1 - gx0) / CELL) + 1, nz = Math.ceil((gz1 - gz0) / CELL) + 1;
  const counts = new Int32Array(nx * nz + 1);
  const cellsOf = (b, fn) => {
    const i0 = Math.floor((b[0] - gx0) / CELL), i1 = Math.floor((b[2] - gx0) / CELL);
    const j0 = Math.floor((b[1] - gz0) / CELL), j1 = Math.floor((b[3] - gz0) / CELL);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * nx + i);
  };
  box.forEach((b) => cellsOf(b, (c) => { counts[c + 1]++; }));
  for (let c = 0; c < nx * nz; c++) counts[c + 1] += counts[c];
  const start = counts;
  const fillAt = new Int32Array(nx * nz);
  const items = new Int32Array(start[nx * nz]);
  box.forEach((b, k) => cellsOf(b, (c) => { items[start[c] + fillAt[c]++] = k; }));
  const stamp = new Int32Array(Math.max(1, N)); // mailbox: the ray that last tested each primitive
  const S = new Uint32Array(2); // [random state, ray counter]
  S[0] = 1;
  // probe(): how far into foliage a ray goes before it counts as stopped (-1: a real ray)
  const PD = new Float64Array(1);
  PD[0] = -1;


  const R = new Float64Array(13);
  const ghost = new Float64Array(9); // on, x, z, y0, height, r, fx, fz, t
  const bird = new Float64Array(5); // on, x, y, z, r
  const stats = { primitives: N, cells: nx * nz, rays: 0, hits: 0, ms: 0 };

  // The nearest hit along R. Every number lives in R or a local, so nothing is boxed.
  function cast() {
    const ox = R[0], oy = R[1], oz = R[2], dx = R[3], dy = R[4], dz = R[5];
    let tMax = R[6];
    let kind = 0, tBest = tMax;
    let rs = S[0];
    const ray = (S[1] = (S[1] + 1) | 0);
    stats.rays++;

    // -- the ground and the lake: march, then bisect
    if (!(dy >= 0 && oy > hmax)) {
      let t = 0.15, prevT = 0;
      let tEnd = tMax;
      if (dy > 0) { const up = (hmax + 0.05 - oy) / dy; if (up < tEnd) tEnd = up; }
      while (t < tEnd) {
        const y = oy + dy * t;
        G[0] = ox + dx * t; G[1] = oz + dz * t; gnd();
        const g = G[2];
        const d = y - (g > 0 ? g : 0);
        if (d <= 0) {
          let a = prevT, b = t;
          for (let k = 0; k < 7; k++) {
            const m = (a + b) * 0.5;
            G[0] = ox + dx * m; G[1] = oz + dz * m; gnd();
            const gm = G[2];
            if (oy + dy * m - (gm > 0 ? gm : 0) > 0) a = m; else b = m;
          }
          tBest = (a + b) * 0.5;
          kind = 1; // water or ground, told apart below
          break;
        }
        prevT = t;
        // (well above the ground on the way down, the step can grow: the ground here
        // never climbs anything like that steeply)
        t += 0.12 + 0.018 * t + (dy < 0 && d > 1.5 ? 0.25 * (d - 1.5) : 0);
      }
    }
    // (above every crown and still climbing: nothing more to hit)
    if (dy > 0) { const up = (top - oy) / dy; if (up < tBest && kind === 0) tBest = Math.max(0, up); }

    // -- the primitives: a 2D DDA over the grid's cells along the ray
    if (N > 0) {
      const hl = Math.sqrt(dx * dx + dz * dz);
      let i = Math.floor((ox - gx0) / CELL), j = Math.floor((oz - gz0) / CELL);
      const stepI = dx > 0 ? 1 : -1, stepJ = dz > 0 ? 1 : -1;
      const tdx = hl > 1e-9 && Math.abs(dx) > 1e-9 ? CELL / Math.abs(dx) : Infinity;
      const tdz = hl > 1e-9 && Math.abs(dz) > 1e-9 ? CELL / Math.abs(dz) : Infinity;
      let tnx = Math.abs(dx) > 1e-9 ? ((dx > 0 ? (i + 1) * CELL + gx0 : i * CELL + gx0) - ox) / dx : Infinity;
      let tnz = Math.abs(dz) > 1e-9 ? ((dz > 0 ? (j + 1) * CELL + gz0 : j * CELL + gz0) - oz) / dz : Infinity;
      let tCell = 0;
      for (let guard = 0; guard < 400; guard++) {
        if (tCell > tBest) break;
        if (i >= 0 && j >= 0 && i < nx && j < nz) {
          const c = j * nx + i;
          for (let q = start[c], qe = start[c + 1]; q < qe; q++) {
            const k = items[q];
            if (stamp[k] === ray) continue;
            stamp[k] = ray;
            const o = k * STRIDE;
            const type = B[o];
            if (type === 0) {
              // ellipsoid, in its unit-sphere frame
              const ex = B[o + 4], ey = B[o + 5], ez = B[o + 6];
              const px = (ox - B[o + 1]) * ex, py = (oy - B[o + 2]) * ey, pz = (oz - B[o + 3]) * ez;
              const vx = dx * ex, vy = dy * ey, vz = dz * ez;
              const qa = vx * vx + vy * vy + vz * vz, qb = px * vx + py * vy + pz * vz, qc = px * px + py * py + pz * pz - 1;
              const disc = qb * qb - qa * qc;
              if (disc <= 0) continue;
              const sq = Math.sqrt(disc);
              let t0 = (-qb - sq) / qa;
              const t1 = (-qb + sq) / qa;
              if (t1 <= 0) continue;
              if (t0 < 0) t0 = 0;
              if (t0 >= tBest) continue;
              let th = t0;
              const dens = B[o + 7];
              if (dens > 0) {
                if (PD[0] >= 0) {
                  // a probe: stopped once it is PD[0] metres into the leaves
                  th = t0 + PD[0];
                  if (th >= t1) continue;
                } else {
                  rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5;
                  const u = ((rs >>> 0) + 0.5) / 4294967296;
                  th = t0 - Math.log(u) / dens;
                  if (th >= t1) continue; // straight through a gap in the leaves
                }
              }
              if (th < tBest) { tBest = th; kind = 2; }
            } else if (type === 1) {
              const px = ox - B[o + 1], pz = oz - B[o + 2];
              const qa = dx * dx + dz * dz;
              if (qa < 1e-12) continue;
              const qb = px * dx + pz * dz, qc = px * px + pz * pz - B[o + 3];
              const disc = qb * qb - qa * qc;
              if (disc <= 0) continue;
              const th = (-qb - Math.sqrt(disc)) / qa;
              if (th <= 0 || th >= tBest) continue;
              const y = oy + dy * th;
              if (y < B[o + 4] || y > B[o + 5]) continue;
              tBest = th; kind = 2;
            } else {
              // capsule (iq's): segment a..b, radius r
              const ax = B[o + 1], ay = B[o + 2], az = B[o + 3], r = B[o + 7];
              const bax = B[o + 4] - ax, bay = B[o + 5] - ay, baz = B[o + 6] - az;
              const oax = ox - ax, oay = oy - ay, oaz = oz - az;
              const baba = bax * bax + bay * bay + baz * baz;
              const bard = bax * dx + bay * dy + baz * dz;
              const baoa = bax * oax + bay * oay + baz * oaz;
              const rdoa = dx * oax + dy * oay + dz * oaz;
              const oaoa = oax * oax + oay * oay + oaz * oaz;
              const a = baba - bard * bard;
              let b = baba * rdoa - baoa * bard;
              let c = baba * oaoa - baoa * baoa - r * r * baba;
              let h = b * b - a * c;
              let th = -1;
              if (h >= 0 && a > 1e-12) {
                const t = (-b - Math.sqrt(h)) / a;
                const y = baoa + t * bard;
                if (y > 0 && y < baba) th = t;
                else {
                  const ocx = y <= 0 ? oax : ox - B[o + 4], ocy = y <= 0 ? oay : oy - B[o + 5], ocz = y <= 0 ? oaz : oz - B[o + 6];
                  b = dx * ocx + dy * ocy + dz * ocz;
                  c = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
                  h = b * b - c;
                  if (h > 0) th = -b - Math.sqrt(h);
                }
              }
              if (th > 0 && th < tBest) { tBest = th; kind = 2; }
            }
          }
        }
        // the next cell
        if (tnx < tnz) { tCell = tnx; tnx += tdx; i += stepI; } else { tCell = tnz; tnz += tdz; j += stepJ; }
        if (tCell >= tMax || (tdx === Infinity && tdz === Infinity)) break;
      }
    }

    // -- the player's sheet ghost: an upright cylinder round them with a dome on top, a
    // wavy hem that flutters, and a face (eyes, an "ooo" mouth, pink cheeks) on the side
    // that looks at the scanner
    if (ghost[0] > 0) {
      const gx = ghost[1], gz = ghost[2], y0 = ghost[3], hgt = ghost[4], r = ghost[5];
      const yc = y0 + hgt - r; // the dome's centre
      let th = -1;
      // the dome
      {
        const px = ox - gx, py = oy - yc, pz = oz - gz;
        const qb = px * dx + py * dy + pz * dz, qc = px * px + py * py + pz * pz - r * r;
        const disc = qb * qb - qc;
        if (disc > 0) {
          const t = -qb - Math.sqrt(disc);
          if (t > 0 && t < tBest && oy + dy * t >= yc) th = t;
        }
      }
      // the sides, front then back
      const px = ox - gx, pz = oz - gz;
      const qa = dx * dx + dz * dz;
      if (qa > 1e-12) {
        const qb = px * dx + pz * dz, qc = px * px + pz * pz - r * r;
        const disc = qb * qb - qa * qc;
        if (disc > 0) {
          const sq = Math.sqrt(disc);
          for (let side = 0; side < 2; side++) {
            const t = (-qb + (side ? sq : -sq)) / qa;
            if (t <= 0 || t >= tBest || (th > 0 && t >= th)) continue;
            const hx = ox + dx * t - gx, hy = oy + dy * t, hz = oz + dz * t - gz;
            const hl = Math.sqrt(hx * hx + hz * hz) || 1;
            const ang = Math.atan2((hx * ghost[7] - hz * ghost[6]) / hl, (hx * ghost[6] + hz * ghost[7]) / hl);
            const hem = y0 + 0.09 + 0.06 * Math.sin(ang * 5 + ghost[8] * 4);
            if (hy < hem || hy > yc) continue;
            th = t;
            break;
          }
        }
      }
      if (th > 0) {
        tBest = th;
        kind = 3;
        const hx = ox + dx * th - gx, hy = oy + dy * th, hz = oz + dz * th - gz;
        const hl = Math.sqrt(hx * hx + hz * hz) || 1;
        const cf = (hx * ghost[6] + hz * ghost[7]) / hl; // 1 facing the scanner
        const sf = (hx * ghost[7] - hz * ghost[6]) / hl; // across the face
        if (cf > 0.5) {
          const v = (hy - y0) / hgt, k = hgt / r;
          const ev = (v - 0.72) * k, e1 = sf - 0.3, e2 = sf + 0.3;
          const d1 = e1 * e1 + ev * ev * 0.7, d2 = e2 * e2 + ev * ev * 0.7;
          if (d1 < 0.03 || d2 < 0.03) {
            kind = 4;
            // a glint in each eye, up and to one side
            const g1 = (e1 + 0.07) * (e1 + 0.07) + (ev - 0.1) * (ev - 0.1), g2 = (e2 + 0.07) * (e2 + 0.07) + (ev - 0.1) * (ev - 0.1);
            if (g1 < 0.004 || g2 < 0.004) kind = 3;
          }
          const mv = (v - 0.55) * k, m2 = sf * sf + mv * mv * 1.3;
          if (m2 < 0.04 && m2 > 0.013) kind = 4; // an "ooo" mouth
          const cv = (v - 0.62) * k, c1 = sf - 0.52, c2 = sf + 0.52;
          if (c1 * c1 + cv * cv < 0.02 || c2 * c2 + cv * cv < 0.02) kind = 8;
        }
      }
    }

    // -- a bird flapping through
    if (bird[0] > 0) {
      const r = bird[4];
      const px = ox - bird[1], py = oy - bird[2], pz = oz - bird[3];
      const qb = px * dx + py * dy + pz * dz, qc = px * px + py * py + pz * pz - r * r;
      const disc = qb * qb - qc;
      if (disc > 0) {
        const th = -qb - Math.sqrt(disc);
        if (th > 0 && th < tBest) { tBest = th; kind = 5; }
      }
    }

    S[0] = rs === 0 ? 1 : rs;
    R[7] = tBest;
    if (kind === 0) { R[12] = 0; return 0; }
    const hx = ox + dx * tBest, hy = oy + dy * tBest, hz = oz + dz * tBest;
    R[8] = hx; R[9] = hy; R[10] = hz;
    G[0] = hx; G[1] = hz; gnd();
    const g = G[2];
    R[11] = hy - g;
    if (kind === 1) {
      const c = Math.floor((hx - x0) * inv + 0.5), rr = Math.floor((hz - z0) * inv + 0.5);
      const cellI = rr * cols + c;
      if (g < 0.004 || (c >= 0 && rr >= 0 && c < cols && rr < rows && (mask[cellI] & WATER) && g < 0.02)) kind = 7;
    }
    R[12] = kind;
    stats.hits++;
    return kind;
  }

  // Is (x, y, z) inside (or within pad metres of) a crown, bush or trunk? For placing
  // cameras clear of the leaves.
  function near(x, y, z, pad) {
    const i = Math.floor((x - gx0) / CELL), j = Math.floor((z - gz0) / CELL);
    if (i < 0 || j < 0 || i >= nx || j >= nz) return false;
    const c = j * nx + i;
    for (let q = start[c], qe = start[c + 1]; q < qe; q++) {
      const o = items[q] * STRIDE;
      if (B[o] === 0) {
        const ax = (x - B[o + 1]) / (1 / B[o + 4] + pad), ay = (y - B[o + 2]) / (1 / B[o + 5] + pad), az = (z - B[o + 3]) / (1 / B[o + 6] + pad);
        if (ax * ax + ay * ay + az * az < 1) return true;
      } else if (B[o] === 1) {
        const dx = x - B[o + 1], dz = z - B[o + 2], r = Math.sqrt(B[o + 3]) + pad;
        if (dx * dx + dz * dz < r * r && y > B[o + 4] - pad && y < B[o + 5] + pad) return true;
      }
    }
    return false;
  }

  // A question, not a point for the cloud (is the view from here to there blocked?): a
  // leafy crown or bush stops the ray once it is depth metres in, and the random stream
  // is not touched, so the scan in progress repeats exactly from its seed.
  function probe(depth) {
    PD[0] = depth > 0 ? depth : 0;
    const k = cast();
    PD[0] = -1;
    return k;
  }

  return {
    R, S, ghost, bird, cast, probe, groundAt, near, stats, KIND,
    get top() { return top; },
    seed(n) { S[0] = (Math.imul((n | 0) + 1, 2654435761) >>> 0) || 1; },
  };
}
