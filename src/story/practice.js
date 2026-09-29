// The opening's practice lizard: a crested anole on a trunk beside a path, out in the
// open, facing the way the player comes, with a clear straight creep up to it and a
// place to stand from which the loop reaches it. Picked by testing the real world
// (the collision circles, the drawn leaves and wood, the paths), not by distance
// alone, so it is never tucked behind a bush.
//
//   choosePractice(game, { from: { x, z }, hours, debug }) ->
//     { index, stand: { x, z }, start: { x, z }, dir: { x, z }, score, tried } | null
//   stand: where the player stands to loop it; start: where the straight creep begins
//   (on or by a path); dir: from the lizard out along the creep. debug: a list that
//   collects why each candidate was turned down (for checks).
//
// The lizard must be in view from the camera the player really looks through while
// creeping in (CREEP_VIEW: flow.js sets the follow camera's creep pitch to it for the
// practice), not only from their eyes: no leaves (the drawn crowns, fans and bushes) or
// wood between that camera and its head anywhere along the creep, so a perch under a
// palm's low fans is turned down.
//
// Deterministic: the spawns are fixed (data/spawns.json) and nothing here is random,
// so the same lizard is picked every time, whatever the day.

import { pathDistance } from '../world/ground_decor.js';

const SPECIES = 'cristatellus';
const BARK = new Set(['trunk', 'palm_stem']);
const UP = [0.65, 1.7]; // metres over the ground the pole reaches comfortably
const TURNS = [0, 0.3, -0.3, 0.55, -0.55, 0.8, -0.8]; // radians off the way it faces
const STANDS = [1.55, 1.8, 1.35, 2.05];
const STARTS = [7, 6, 5];
// the follow camera while creeping in on the practice anole (camera.js: behind the
// player by `distance` at `pitch`, looking at a point `height` over their feet, shifted
// `side` metres over the right shoulder)
export const CREEP_VIEW = { pitch: 0.5, distance: 5, height: 1.25, side: 0.5 };

// A leafy mound or crown round (x, y, z), puffed out by pad (hosts: those near by).
function leafy(hosts, x, y, z, pad) {
  for (const m of hosts.mounds || []) {
    if (y < m.y - 0.3) continue;
    const dx = (x - m.x) / (m.r + pad), dz = (z - m.z) / (m.r + pad), dy = Math.max(0, y - m.y) / (m.h + pad);
    if (dx * dx + dz * dz + dy * dy < 1) return true;
  }
  for (const c of hosts.crowns || []) {
    const dx = (x - c.cx) / (c.rx + pad), dy = (y - c.cy) / (c.ry + pad), dz = (z - c.cz) / (c.rz + pad);
    if (dx * dx + dy * dy + dz * dz < 1) return true;
  }
  return false;
}

export function choosePractice(game, { from = { x: -13.4, z: 43.8 }, hours = null, want = null, debug = null } = {}) {
  const no = (i, why) => { if (debug) debug.push([i, why]); };
  const L = game.lizards, col = game.collision, T = game.data.terrain;
  if (!L || !L.lizard || !col) return null;
  const all = (game.veg && game.veg.hosts) || { mounds: [], crowns: [] };
  // the leaves within 14 m of a candidate (the creep camera stands up to 12 m off),
  // gathered once for it (the tests below then look at a few dozen, not the island's
  // thousand)
  const hosts = { mounds: [], crowns: [] };
  const near = (x, z) => {
    hosts.mounds.length = 0; hosts.crowns.length = 0;
    for (const m of all.mounds || []) if (Math.abs(m.x - x) < 14 + m.r && Math.abs(m.z - z) < 14 + m.r) hosts.mounds.push(m);
    for (const c of all.crowns || []) if (Math.abs(c.cx - x) < 14 + c.rx && Math.abs(c.cz - z) < 14 + c.rz) hosts.crowns.push(c);
  };
  const P = L.perches && L.perches.index;
  const hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, kind: 0, tri: -1, w: 0 };
  const ground = (x, z) => Math.max(0, T.heightAt(x, z));
  const sunny = (hm) => {
    if (!L.sunExposure || hours == null) return 0;
    try { return L.sunExposure(hm.x, hm.y, hm.z, hm.nx || 0, hm.ny ?? 0, hm.nz || 0); } catch (e) { return 0; }
  };

  // One straight creep in along (ux, uz) from `start` metres out to `stand` (a place
  // already found free): null when it is blocked, else what it passes.
  function creep(hm, ux, uz, stand, start) {
    const sx = hm.x + ux * stand, sz = hm.z + uz * stand;
    let onPath = 9, brush = 0;
    for (let d = stand; d <= start + 1e-6; d += 0.25) {
      const x = hm.x + ux * d, z = hm.z + uz * d;
      if (!T.isWalkable(x, z) || !col.isFree(x, z, 0.36)) return null;
      if (T.maskAt(x, z) & 16) return null; // thicket
      for (const s of [-0.7, 0.7]) if (!col.isFree(x - uz * s, z + ux * s, 0.1)) brush++;
      const g = ground(x, z);
      for (const y of [0.35, 0.8, 1.3]) if (leafy(hosts, x, g + y, z, 0.15)) return null;
      onPath = Math.min(onPath, pathDistance(x, z));
    }
    if (!(onPath < 1.8)) return null; // the creep starts from a path, or right beside one
    // the lizard in plain view along the way: no leaves over the near nine tenths of the
    // line from a creeping player's eyes, no drawn wood across it
    const hx = hm.x + (hm.nx || 0) * 0.08, hy = hm.y + 0.06, hz = hm.z + (hm.nz || 0) * 0.08;
    for (const d of [start, (start + stand) / 2, stand]) {
      const ex = hm.x + ux * d, ez = hm.z + uz * d, ey = ground(ex, ez) + 1.2;
      const dx = hx - ex, dy = hy - ey, dz = hz - ez, len = Math.hypot(dx, dy, dz);
      for (let k = 1; k <= 14; k++) {
        const f = (k / 14) * 0.9;
        if (leafy(hosts, ex + dx * f, ey + dy * f, ez + dz * f, 0.05)) return null;
      }
      if (P && P.blocked(ex, ey, ez, dx / len, dy / len, dz / len, len - 0.15, hit)) return null;
    }
    // and from the creep camera behind the player, all the way in
    const V = CREEP_VIEW, back = Math.cos(V.pitch) * V.distance, lift = V.height + Math.sin(V.pitch) * V.distance;
    for (let d = start; d >= Math.min(3, stand) - 1e-6; d -= 1) {
      const px = hm.x + ux * d, pz = hm.z + uz * d;
      const cx = px + ux * back + uz * V.side, cz = pz + uz * back - ux * V.side, cy = ground(px, pz) + lift;
      const dx = hx - cx, dy = hy - cy, dz = hz - cz, len = Math.hypot(dx, dy, dz);
      for (let k = 1; k <= 16; k++) {
        const f = (k / 16) * 0.94;
        if (leafy(hosts, cx + dx * f, cy + dy * f, cz + dz * f, 0.1)) return null;
      }
      if (P && P.blocked(cx, cy, cz, dx / len, dy / len, dz / len, len - 0.15, hit)) return null;
    }
    return { sx, sz, onPath, brush };
  }

  let best = null;
  const tried = [];
  for (let i = 0; i < L.spawnCount; i++) {
    if (want != null && i !== want) continue;
    const lz = L.lizard(i);
    if (!lz || lz.species !== SPECIES || !BARK.has(lz.perch) || lz.captured) continue;
    const hm = lz.home;
    if (!hm || hm.skip || hm.snapped === false) continue;
    const up = hm.y - ground(hm.x, hm.z);
    if (up < UP[0] || up > UP[1]) { no(i, 'height'); continue; }
    const nh = Math.hypot(hm.nx || 0, hm.nz || 0);
    if (nh < 0.5) { no(i, 'flat'); continue; }
    const pdL = pathDistance(hm.x, hm.z);
    if (!(pdL < 4.5)) { no(i, 'far from path'); continue; }
    const a0 = Math.atan2(hm.nz, hm.nx);
    near(hm.x, hm.z);
    // the best straight creep in: facing the lizard's front, long, on a path, clear
    let pickC = null, pc = Infinity;
    for (const turn of TURNS) {
      const ux = Math.cos(a0 + turn), uz = Math.sin(a0 + turn);
      // where to stand to loop it: the first of STANDS with room
      let stand = 0;
      for (const sd of STANDS) {
        const sx = hm.x + ux * sd, sz = hm.z + uz * sd;
        if (col.isFree(sx, sz, 0.32) && col.roomy(sx, sz)) { stand = sd; break; }
      }
      if (!stand) continue;
      for (const start of STARTS) {
        const c = creep(hm, ux, uz, stand, start);
        if (!c) continue;
        const s = Math.abs(turn) * 2 + (7 - start) * 0.6 + Math.abs(stand - 1.55) * 1.5 + c.brush * 0.35 + c.onPath * 0.6;
        if (s < pc) { pc = s; pickC = { ...c, ux, uz, stand, start, turn }; }
        break; // the longest start that works for this turn
      }
    }
    if (!pickC) { no(i, 'no clear creep'); continue; }
    // no bush hugging its trunk (so the perch reads as open)
    let hug = 0;
    for (const m of hosts.mounds || []) if (Math.hypot(m.x - hm.x, m.z - hm.z) - m.r < 1.2) hug++;
    // near where the player comes from, and facing that way
    const fx = from.x - hm.x, fz = from.z - hm.z, far = Math.hypot(fx, fz) || 1;
    const facing = (pickC.ux * fx + pickC.uz * fz) / far;
    const exposure = sunny(hm);
    const score = pc + far * 0.06 + Math.max(0, 18 - far) * 0.3 + (1 - facing) * 1.5 + hug * 1.2 +
      Math.max(0, pdL - 2.5) * 0.8 + (exposure > 0.3 ? -0.6 : 0) + (lz.sex === 'm' ? 0 : 0.8) + Math.abs(up - 1.0) * 0.8;
    tried.push({ i, score: +score.toFixed(2), creep: +pc.toFixed(2), far: +far.toFixed(1), facing: +facing.toFixed(2), turn: pickC.turn, start: pickC.start, stand: pickC.stand, brush: pickC.brush, hug, onPath: +pickC.onPath.toFixed(2), pdL: +pdL.toFixed(2), up: +up.toFixed(2), exposure: +exposure.toFixed(2), sex: lz.sex, at: [+hm.x.toFixed(1), +hm.z.toFixed(1)] });
    if (!best || score < best.score) {
      best = {
        index: i, score, dir: { x: pickC.ux, z: pickC.uz },
        stand: { x: pickC.sx, z: pickC.sz }, start: { x: hm.x + pickC.ux * pickC.start, z: hm.z + pickC.uz * pickC.start },
      };
    }
  }
  if (best) best.tried = tried.sort((a, b) => a.score - b.score);
  return best;
}
