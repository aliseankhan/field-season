// The minimap (top right, north up, redrawn about 10 times a second) and the big
// map (M). Both draw one pre-rendered base (water, far banks, mangrove fringe, the
// island, thicket and tree cover from the grids, the causeway, paths and landmark
// crowns from data/water.json and data/placements.json) and then the live marks: the
// warm and cool patches of the loggers' downloads (soft blobs from src/tools/loggers.js,
// fading as their readings go stale), the grid flags with their labels (each with its
// logger's dot: hollow until downloaded, then warm or cool), a gold ring round a flag
// James's requests name, tagged lizards and their dotted trails, the last croc warning,
// James, any markers the game adds, and the player. The minimap carries a small warm
// and cool key while a patch is in view (ringing the colour the player stands in); the
// big map's key explains them in the words the notebook uses (THERMAL_KEY).
//
//   const map = buildMaps(game, state);
//   map.addMarker({ x, z, icon: 'flag' | 'logger' | 'star', label, pulse, colour,
//                   radius }) -> remove()
//       radius (metres): a soft search circle, a pale fill and a dashed rim, rather than
//       a pin (with pulse the rim breathes a little)
//   map.trails        Map of state.tracked entry -> { colour, pts: [x, z, ...] } (its GPS fixes)
//   map.setAerial(img, { x0, x1, z0, z1 })  the drone's aerial photo under the big map's marks

import { registerPanel, openPanel, closePanel, currentPanel } from './kit.js';
import { pathLines } from '../world/ground_decor.js';

const BASE_PX = 5; // pixels a metre in the base image
const COL = {
  water: '#8fd5cf', foam: '#e3f6ee', bank: '#b8d796', fringe: '#72b98a', land: '#c4ea9f',
  causeway: '#ead6a4', causewayEdge: '#cdb07a', path: '#f0dcae', pathEdge: '#d9bd86',
  crown: 'rgba(84, 166, 98, 0.26)', crownEdge: 'rgba(63, 138, 75, 0.5)', palm: 'rgba(122, 196, 104, 0.5)', trunk: '#8a5a3c',
};
// the rainbow eucalyptus' bark stripes, as little dashes round its trunk (never the jobs' pink)
const RAINBOW = ['#3fb0ad', '#ff9d4d', '#9b7be0'];
const CROWN_K = 0.3; // crown radius on the map, as a share of its width (small, so they do not pile up)
const LOOK_AHEAD = 8; // metres the minimap's centre leads the view by
const DASH = [2.5, 3.5]; // scaled into dash[] for each draw
const NO_DASH = [];
const dash = [0, 0];
const TRAIL_EVERY = 1.0; // seconds between looks at the GPS fixes
const WARN_FOR = 15; // seconds a croc warning stays on the map
const PATCH_ALPHA = 0.8; // the loggers' warm and cool patches at their freshest
// the warm and cool colours (loggers.js WARM_RGB, COOL_RGB), and the one wording of what
// they mean, for the big map's key and the notebook's logger page
export const WARM_HEX = '#ffa85c', COOL_HEX = '#66b0e6';
const WARM = WARM_HEX, COOL = COOL_HEX;
export const THERMAL_KEY = {
  warm: 'Warm: sunny, where lizards bask early and late',
  cool: 'Cool: shady, where they sit out the midday heat',
};
const REQUEST_R = 8; // metres: the ring round a flag James's request names (flags.js NEAR_FLAG)
const REQUEST_GOLD = '#f5b82e';

function ringPath(ctx, rings, holes, tx, tz) {
  ctx.beginPath();
  for (let i = 0; i < rings.length; i++) {
    const r = rings[i];
    for (let k = 0; k < r.length; k++) {
      const x = tx(r[k][0]), y = tz(r[k][1]);
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
}

// Short dashes in the eucalyptus' teal, orange and violet round a trunk.
function rainbowDashes(g, x, y, r, width) {
  g.lineWidth = width;
  g.lineCap = 'round';
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3;
    g.strokeStyle = RAINBOW[k % 3];
    g.beginPath(); g.arc(x, y, r, a, a + 0.62); g.stroke();
  }
}

// The static base: one canvas over the whole terrain grid.
function buildBase(data, paths, spots) {
  const T = data.terrain, W = data.water;
  const x0 = T.xmin, z0 = T.zmin;
  const w = Math.round((T.xmax - T.xmin) * BASE_PX), hgt = Math.round((T.zmax - T.zmin) * BASE_PX);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = hgt;
  const g = cv.getContext('2d');
  const tx = (x) => (x - x0) * BASE_PX, tz = (z) => (z - z0) * BASE_PX;

  g.fillStyle = COL.water;
  g.fillRect(0, 0, w, hgt);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const fillRings = (key, colour) => {
    const rings = W[key];
    if (!Array.isArray(rings) || !rings.length) return;
    ringPath(g, rings, null, tx, tz);
    g.fillStyle = colour;
    g.fill('evenodd');
  };
  fillRings('banks', COL.bank);
  // a soft pale edge where the far banks meet the water
  if (Array.isArray(W.banks) && W.banks.length) {
    ringPath(g, W.banks, null, tx, tz);
    g.strokeStyle = 'rgba(227, 246, 238, 0.7)';
    g.lineWidth = 1.1 * BASE_PX;
    g.stroke();
  }
  fillRings('outline', COL.fringe);
  fillRings('open_water', COL.water);
  // a pale foam band round the island, then the lawn
  if (W.land) {
    ringPath(g, W.land, null, tx, tz);
    g.strokeStyle = COL.foam;
    g.lineWidth = 1.6 * BASE_PX;
    g.stroke();
  }
  fillRings('land', COL.land);

  // thicket and tree cover from the grids, one pixel a cell, drawn smoothed
  const cols = T.cols, rows = T.rows, B = T.bits;
  const cells = document.createElement('canvas');
  cells.width = cols; cells.height = rows;
  const cg = cells.getContext('2d');
  const img = cg.createImageData(cols, rows);
  const px = img.data;
  for (let i = 0, n = cols * rows; i < n; i++) {
    const m = T.mask[i];
    if (!(m & (B.island | B.causeway))) continue;
    const c = T.canopy[i] * 0.1;
    const o = i * 4;
    if (m & B.thicket) { px[o] = 92; px[o + 1] = 168; px[o + 2] = 88; px[o + 3] = 120; }
    else if (c > 3) { px[o] = 96; px[o + 1] = 170; px[o + 2] = 100; px[o + 3] = 58; }
  }
  cg.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(cells, tx(T.x0 - T.cell / 2), tz(T.z0 - T.cell / 2), cols * T.cell * BASE_PX, rows * T.cell * BASE_PX);

  fillRings('causeway', COL.causeway);
  if (W.causeway) {
    ringPath(g, W.causeway, null, tx, tz);
    g.strokeStyle = COL.causewayEdge;
    g.lineWidth = 0.25 * BASE_PX;
    g.stroke();
  }

  // paths, as soft sandy lines
  for (const [colour, width] of [[COL.pathEdge, 1.7], [COL.path, 1.25]]) {
    g.strokeStyle = colour;
    g.lineWidth = width * BASE_PX;
    for (const line of paths) {
      if (!line || line.length < 2) continue;
      g.beginPath();
      for (let k = 0; k < line.length; k++) {
        const p = line[k];
        if (k === 0) g.moveTo(tx(p[0]), tz(p[1])); else g.lineTo(tx(p[0]), tz(p[1]));
      }
      g.stroke();
    }
  }

  // landmark crowns, the tallest first so small ones stay on top
  const lms = [...(data.placements.landmarks || [])].sort((a, b) => b.height - a.height);
  for (const l of lms) {
    const cx = tx(l.crown_x ?? l.x), cz = tz(l.crown_z ?? l.z);
    if (l.kind === 'osprey_pole') {
      g.fillStyle = COL.trunk;
      g.beginPath(); g.arc(tx(l.x), tz(l.z), 0.5 * BASE_PX, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#b08a55'; g.lineWidth = 0.35 * BASE_PX;
      g.beginPath(); g.arc(tx(l.x), tz(l.z), 1.1 * BASE_PX, 0, Math.PI * 2); g.stroke();
      continue;
    }
    const r = Math.max(1.0, CROWN_K * Math.max(l.crown_w_ew || 3, l.crown_w_ns || 3)) * BASE_PX;
    const palm = l.kind === 'palm' || l.kind === 'talipot';
    g.fillStyle = palm ? COL.palm : COL.crown;
    g.strokeStyle = COL.crownEdge;
    g.lineWidth = 0.22 * BASE_PX;
    if (palm) {
      // a star of fronds
      g.beginPath();
      const n = l.kind === 'talipot' ? 9 : 7;
      for (let k = 0; k <= n * 2; k++) {
        const a = (k / (n * 2)) * Math.PI * 2, rr = k % 2 ? r * 0.55 : r;
        const x = cx + Math.cos(a) * rr, y = cz + Math.sin(a) * rr;
        if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath();
      g.fill(); g.stroke();
    } else {
      g.beginPath(); g.arc(cx, cz, r, 0, Math.PI * 2); g.fill(); g.stroke();
      if (l.kind === 'rainbow_eucalyptus') rainbowDashes(g, tx(l.x), tz(l.z), Math.max(1.3 * BASE_PX, r * 0.5), 0.4 * BASE_PX);
    }
    g.fillStyle = COL.trunk;
    g.beginPath(); g.arc(tx(l.x), tz(l.z), Math.max(0.35, (l.dbh || 0.3) * 0.8) * BASE_PX, 0, Math.PI * 2); g.fill();
  }

  // the field station: a little table and a tent roof by the causeway
  if (spots && spots.table) {
    const x = tx(spots.table.x), y = tz(spots.table.z), s = BASE_PX;
    g.fillStyle = '#ff9d6e'; g.strokeStyle = '#b8552a'; g.lineWidth = 0.25 * s;
    g.beginPath(); g.moveTo(x - 1.6 * s, y + 0.9 * s); g.lineTo(x, y - 1.4 * s); g.lineTo(x + 1.6 * s, y + 0.9 * s); g.closePath();
    g.fill(); g.stroke();
  }
  return { canvas: cv, x0, z0, w, h: hgt };
}

export function buildMaps(game, state, { props } = {}) {
  const data = game.data;
  let paths = [];
  const base = { ready: null };
  const markers = new Set();
  const trails = new Map();
  const warn = { x: 0, z: 0, t: -1e9 };
  // the drone's aerial photo (src/missions/drone.js): the big map's photo layer
  const aerial = { img: null, x0: -62, x1: 82, z0: -50, z1: 52, on: true };
  let now = 0, trailT = 0;
  const spots = props && props.PROP_SPOTS;

  function ensureBase() {
    if (!base.ready) {
      try { paths = pathLines(); } catch (e) { paths = []; }
      base.ready = buildBase(data, paths || [], spots);
    }
    return base.ready;
  }
  game.events.on('croc:warn', (e) => {
    if (!e) return;
    warn.x = e.x ?? (e.croc && e.croc.position && e.croc.position.x) ?? 0;
    warn.z = e.z ?? (e.croc && e.croc.position && e.croc.position.z) ?? 0;
    warn.t = now;
  });

  // ------------------------------------------------ trails of tagged lizards
  // The GPS fixes each backpack logs through the survey day (state.tracked[].trail,
  // [x, z] pairs written by src/catch/catching.js), dotted in the backpack's colour.
  function sampleTrails() {
    const list = state.tracked || [];
    for (const e of trails.keys()) if (!list.includes(e)) trails.delete(e);
    for (let i = 0; i < list.length; i++) {
      const e = list[i], fixes = e.trail;
      if (!Array.isArray(fixes) || !fixes.length) { trails.delete(e); continue; }
      let tr = trails.get(e);
      if (!tr) { tr = { colour: e.colour || '#ff7a3d', pts: [], species: e.species, name: '', n: -1, last: null }; trails.set(e, tr); }
      tr.name = e.nickname || '';
      const last = fixes[fixes.length - 1];
      if (tr.n === fixes.length && tr.last === last) continue;
      tr.pts.length = 0;
      for (let k = 0; k < fixes.length; k++) tr.pts.push(fixes[k][0], fixes[k][1]);
      tr.n = fixes.length;
      tr.last = last;
    }
  }

  // ------------------------------------------------ the loggers' patches and flags
  // The loggers' warm and cool patches (loggers.js keeps them, one soft blob per logger
  // downloaded today), how fresh each is, and which flags James's open requests name.
  const LG = () => (game.tools && game.tools.loggers) || null;
  const patchOn = { any: false }; // a fresh patch was drawn on the minimap last time
  function drawPatches(ctx, v, X, Y) {
    const lg = LG();
    if (!lg || !lg.patches || state.phase !== 'survey' || v.patches === false) return false;
    let any = false;
    ctx.imageSmoothingEnabled = true;
    for (let i = 0; i < lg.patches.length; i++) {
      const p = lg.patches[i];
      const f = lg.freshness(p);
      if (f <= 0.01) continue;
      const x = X(p.x - p.r), y = Y(p.z - p.r), w = 2 * p.r * v.s;
      if (x > v.W || y > v.H || x + w < 0 || y + w < 0) continue;
      ctx.globalAlpha = PATCH_ALPHA * f;
      ctx.drawImage(p.canvas, x, y, w, w);
      any = true;
    }
    ctx.globalAlpha = 1;
    return any;
  }
  // a logger's dot colour: its patch's colour (the majority, as the patch shows and the
  // toast and the notebook say) while it is fresh, else null (hollow)
  function loggerTint(id) {
    const lg = LG();
    if (!lg || !lg.patches || state.phase !== 'survey') return null;
    for (let i = 0; i < lg.patches.length; i++) {
      const p = lg.patches[i];
      if (p.id !== id) continue;
      if (lg.freshness(p) <= 0.15) return null;
      return p.kind === 'warm' ? WARM : p.kind === 'cool' ? COOL : '#dcc99c';
    }
    return null;
  }
  const loggerAt = (id) => { const L = state.loggers || []; for (let i = 0; i < L.length; i++) if (L[i].id === id) return L[i]; return null; };
  const flagById = (id) => { const F = state.flags || []; for (let i = 0; i < F.length; i++) if (F[i].id === id) return F[i]; return null; };

  // ------------------------------------------------ drawing
  const view = { cx: 0, cz: 0, s: 3, W: 0, H: 0, big: false, dpr: 1 };

  function draw(ctx, v) {
    const b = ensureBase();
    const k = BASE_PX / v.s;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COL.water;
    ctx.fillRect(0, 0, v.W, v.H);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(b.canvas, (v.cx - b.x0) * BASE_PX - (v.W / 2) * k, (v.cz - b.z0) * BASE_PX - (v.H / 2) * k, v.W * k, v.H * k, 0, 0, v.W, v.H);
    const X = (x) => v.W / 2 + (x - v.cx) * v.s, Y = (z) => v.H / 2 + (z - v.cz) * v.s;
    if (v.aerial && aerial.img && aerial.on) {
      ctx.drawImage(aerial.img, X(aerial.x0), Y(aerial.z0), (aerial.x1 - aerial.x0) * v.s, (aerial.z1 - aerial.z0) * v.s);
    }
    const u = v.dpr * (v.big ? 1.25 : 1); // marker size unit
    nBoxes = 0;
    nLabels = 0;
    if (v.bare) return; // the island alone (a notebook page draws its own marks over it)
    const patched = drawPatches(ctx, v, X, Y);
    if (!v.big) patchOn.any = patched;

    // trails, dotted in the backpack colour over a soft white line so they read on the leaves
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    dash[0] = DASH[0] * u; dash[1] = DASH[1] * u;
    for (let pass = 0; pass < 2; pass++) {
      ctx.setLineDash(pass ? dash : NO_DASH);
      ctx.lineWidth = (pass ? 2 : 4.4) * u;
      for (const tr of trails.values()) {
        const p = tr.pts;
        if (p.length < 4) continue;
        ctx.strokeStyle = pass ? tr.colour : 'rgba(255, 252, 240, 0.8)';
        ctx.beginPath();
        for (let i = 0; i < p.length; i += 2) {
          if (i === 0) ctx.moveTo(X(p[0]), Y(p[1])); else ctx.lineTo(X(p[i]), Y(p[i + 1]));
        }
        ctx.stroke();
      }
    }
    ctx.setLineDash(NO_DASH);
    for (const tr of trails.values()) {
      const p = tr.pts;
      if (p.length < 2) continue;
      const x = X(p[p.length - 2]), y = Y(p[p.length - 1]);
      dot(ctx, x, y, 3.4 * u, tr.colour, '#fff', 1.4 * u);
      box(x, y, 4 * u, 4 * u);
      if (v.big && tr.name) wantLabel(x, y, 4 * u, 4 * u, tr.name, '#6b4a2f');
    }

    // a gold ring round each flag an open request of James's names ("near D05")
    const reqs = (state.phase === 'survey' && state.today && state.today.requests) || NONE;
    for (let i = 0; i < reqs.length; i++) {
      const r = reqs[i];
      if (!r.flag || r.done) continue;
      const f = flagById(r.flag);
      if (!f || !Number.isFinite(f.x)) continue;
      const x = X(f.x), y = Y(f.z), rr = (r.radius || REQUEST_R) * v.s;
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = REQUEST_GOLD;
      ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.9;
      dash[0] = 4 * u; dash[1] = 3 * u;
      ctx.setLineDash(dash);
      ctx.strokeStyle = REQUEST_GOLD;
      ctx.lineWidth = 2 * u;
      ctx.stroke();
      ctx.setLineDash(NO_DASH);
      ctx.globalAlpha = 1;
    }

    // the grid flags, each with its logger's dot at the pole's foot (a logger on a stake
    // with no flag gets the thermometer)
    const flags = state.flags || [];
    for (let i = 0; i < flags.length; i++) {
      const f = flags[i];
      if (!Number.isFinite(f.x)) continue;
      const x = X(f.x), y = Y(f.z);
      pennant(ctx, x, y, u, '#ff8fbd');
      box(x + 3.5 * u, y - 5.5 * u, 4.5 * u, 5.5 * u);
      const l = loggerAt(f.id);
      if (l) sensor(ctx, x, y, u, loggerTint(l.id));
      wantLabel(x + 3.5 * u, y - 7.5 * u, 4.5 * u, 3 * u, f.label || f.id || '', '#b03a6e');
    }
    const loggers = state.loggers || [];
    for (let i = 0; i < loggers.length; i++) {
      const l = loggers[i];
      if (!Number.isFinite(l.x) || flagAt(flags, l)) continue;
      thermo(ctx, X(l.x), Y(l.z), u, loggerTint(l.id));
      box(X(l.x), Y(l.z) + 0.5 * u, 4.5 * u, 8.5 * u);
      wantLabel(X(l.x), Y(l.z), 4.5 * u, 8.5 * u, l.label || l.stake || l.id || '', '#2f79a8');
    }

    // markers the game adds (a job, a sighting, a place to search)
    for (const m of markers) {
      const x = X(m.x), y = Y(m.z);
      if (m.radius > 0) {
        // a soft search circle, not a pin
        const rr = m.radius * v.s * (m.pulse ? 1 + 0.03 * Math.sin(now * 3) : 1);
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = m.colour || '#ffcf3f';
        ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.85;
        dash[0] = 4 * u; dash[1] = 3.5 * u;
        ctx.setLineDash(dash);
        ctx.strokeStyle = m.colour || '#ffcf3f';
        ctx.lineWidth = 2 * u;
        ctx.stroke();
        ctx.setLineDash(NO_DASH);
        ctx.globalAlpha = 1;
        if (v.big && m.label) wantLabel(x, y, 4 * u, 4 * u, m.label, '#8a4a1c');
        continue;
      }
      if (m.pulse) {
        const r = (6 + 4 * (0.5 + 0.5 * Math.sin(now * 5))) * u;
        ctx.strokeStyle = m.colour || '#ff8a5c';
        ctx.lineWidth = 2 * u;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      }
      if (m.icon === 'flag') pennant(ctx, x, y, u, m.colour || '#ffd0e4');
      else if (m.icon === 'logger') thermo(ctx, x, y, u, false);
      else dot(ctx, x, y, 3.5 * u, m.colour || '#ff8a5c', '#fff', 1.4 * u);
      box(x, y, 5 * u, 5 * u);
      if (v.big && m.label) wantLabel(x, y, 5 * u, 5 * u, m.label, '#8a4a1c');
    }

    // James at the field station
    const J = game.james && game.james.position;
    const jx = J ? J.x : spots && spots.table ? spots.table.x + 1.2 : null;
    const jz = J ? J.z : spots && spots.table ? spots.table.z - 1.0 : null;
    if (jx != null) { cap(ctx, X(jx), Y(jz), u); box(X(jx), Y(jz), 9 * u, 5 * u); }

    // the last croc warning
    const age = now - warn.t;
    if (age < WARN_FOR) {
      const a = 1 - age / WARN_FOR;
      const r = (7 + Math.sin(now * 8) * 1.2) * u;
      ctx.globalAlpha = Math.min(1, a * 1.6);
      dot(ctx, X(warn.x), Y(warn.z), r, '#ff5a4a', '#fff', 1.8 * u);
      box(X(warn.x), Y(warn.z), r, r);
      ctx.fillStyle = '#fff';
      ctx.font = `900 ${Math.round(10 * u)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', X(warn.x), Y(warn.z) + 0.5 * u);
      ctx.globalAlpha = 1;
    }

    // the player, with a soft wedge where the camera looks
    const P = game.player;
    const rig = game.rig;
    if (P && rig && !v.big) {
      const x = X(P.position.x), y = Y(P.position.z), a = Math.atan2(-Math.cos(rig.yaw), -Math.sin(rig.yaw));
      ctx.fillStyle = 'rgba(255, 250, 225, 0.5)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 1 * u;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, 30 * u, a - 0.5, a + 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    if (P) {
      const x = X(P.position.x), y = Y(P.position.z), hd = P.heading;
      const fx = -Math.sin(hd), fy = -Math.cos(hd); // forward on the map
      const sx = -fy, sy = fx;
      const L = 9 * u, Wd = 6 * u;
      ctx.beginPath();
      ctx.moveTo(x + fx * L, y + fy * L);
      ctx.lineTo(x - fx * L * 0.6 + sx * Wd, y - fy * L * 0.6 + sy * Wd);
      ctx.lineTo(x - fx * L * 0.25, y - fy * L * 0.25);
      ctx.lineTo(x - fx * L * 0.6 - sx * Wd, y - fy * L * 0.6 - sy * Wd);
      ctx.closePath();
      ctx.fillStyle = '#ff6f4f';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 * u;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.fill();
      box(x, y, L, L);
    }
    placeLabels(ctx, u, !v.big);
  }

  // ------------------------------------------------ labels that keep off the icons
  // Every icon drawn leaves a box; the big map's labels go last, each at the first of
  // six spots round its icon that is clear of the boxes and the labels already set.
  const boxes = new Float32Array(4 * 512);
  let nBoxes = 0;
  function box(x, y, hw, hh) {
    if (nBoxes >= 512) return;
    const o = nBoxes++ * 4;
    boxes[o] = x - hw; boxes[o + 1] = y - hh; boxes[o + 2] = x + hw; boxes[o + 3] = y + hh;
  }
  const clear = (x0, y0, x1, y1) => {
    for (let i = 0, o = 0; i < nBoxes; i++, o += 4) {
      if (x0 < boxes[o + 2] && x1 > boxes[o] && y0 < boxes[o + 3] && y1 > boxes[o + 1]) return false;
    }
    return true;
  };
  const labels = []; // reused { x, y, hw, hh, text, colour }
  let nLabels = 0;
  function wantLabel(x, y, hw, hh, text, colour) {
    if (!text) return;
    const q = labels[nLabels] || (labels[nLabels] = { x: 0, y: 0, hw: 0, hh: 0, text: '', colour: '' });
    nLabels++;
    q.x = x; q.y = y; q.hw = hw; q.hh = hh; q.text = text; q.colour = colour;
  }
  // the labels' fonts and widths, kept (the minimap redraws ten times a second)
  const fonts = new Map();
  const fontOf = (fs, u) => {
    const k = fs * 1000 + u;
    let f = fonts.get(k);
    if (!f) { f = `800 ${Math.round(fs * u)}px system-ui, -apple-system, sans-serif`; fonts.set(k, f); }
    return f;
  };
  const widthSmall = new Map(), widthBig = new Map();
  // small: the minimap's own (smaller, and a label with no clear spot is left out)
  function placeLabels(ctx, u, small = false) {
    const fs = small ? 8.5 : 10.5;
    ctx.font = fontOf(fs, u);
    const widths = small ? widthSmall : widthBig;
    if (widths.u !== u) { widths.clear(); widths.u = u; }
    const th = (small ? 5.2 : 6.5) * u, gap = 2 * u;
    for (let i = 0; i < nLabels; i++) {
      const q = labels[i];
      if (small && (q.x < -20 || q.y < -20 || q.x > view.W + 20 || q.y > view.H + 20)) continue;
      let w = widths.get(q.text);
      if (w === undefined) { w = ctx.measureText(q.text).width; widths.set(q.text, w); }
      let bx = q.x + q.hw + gap, by = q.y, found = false; // right of the icon, the fallback
      for (let k = 0; k < 6; k++) {
        const lx = k === 0 ? q.x + q.hw + gap : k === 1 ? q.x - q.hw - gap - w
          : k === 2 || k === 4 ? q.x + gap : q.x - gap - w;
        const ly = k < 2 ? q.y : k < 4 ? q.y - q.hh - th - gap : q.y + q.hh + th + gap;
        if (clear(lx - u, ly - th, lx + w + u, ly + th)) { bx = lx; by = ly; found = true; break; }
      }
      if (small && !found) continue;
      box(bx + w / 2, by, w / 2 + u, th);
      label(ctx, bx, by, q.text, u, q.colour, fs);
    }
  }

  // ------------------------------------------------ the minimap element
  ensureMapStyle();
  const wrap = document.createElement('div');
  wrap.className = 'hud-map';
  wrap.title = 'Map (M)';
  wrap.innerHTML = '<canvas></canvas><div class="hud-map-n">N</div>' +
    `<div class="hud-map-key" aria-hidden="true"><span class="is-warm"><i style="background:${WARM}"></i>Warm</span><span class="is-cool"><i style="background:${COOL}"></i>Cool</span></div>`;
  const mini = wrap.querySelector('canvas');
  const keyEl = wrap.querySelector('.hud-map-key');
  const keyWarm = keyEl.querySelector('.is-warm'), keyCool = keyEl.querySelector('.is-cool');
  let keyShown = false, keyHere = null; // the key, and the colour under the player it rings
  const mctx = mini.getContext('2d');
  wrap.addEventListener('click', () => openPanel('map'));

  let acc = 1;
  const look = { x: 0, z: 0 };
  function update(dt) {
    now += dt;
    trailT += dt;
    if (trailT >= TRAIL_EVERY) { trailT = 0; sampleTrails(); }
    acc += dt;
    if (acc < 0.1) return;
    acc = 0;
    if (!wrap.isConnected || wrap.offsetParent === null) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(mini.clientWidth * dpr), H = Math.round(mini.clientHeight * dpr);
    if (!W || !H) return;
    if (mini.width !== W || mini.height !== H) { mini.width = W; mini.height = H; }
    const P = game.player, rig = game.rig;
    // the centre leads a little the way the camera looks, eased so a turn slides it
    if (rig && Number.isFinite(rig.yaw)) {
      look.x += (-Math.sin(rig.yaw) * LOOK_AHEAD - look.x) * 0.25;
      look.z += (-Math.cos(rig.yaw) * LOOK_AHEAD - look.z) * 0.25;
    }
    view.cx = (P ? P.position.x : 0) + look.x;
    view.cz = (P ? P.position.z : 0) + look.z;
    view.W = W; view.H = H; view.dpr = dpr; view.big = false;
    view.s = W / 72; // about 72 m across
    draw(mctx, view);
    // the small warm and cool key, while a patch is in view, with the colour you are
    // standing in ringed
    if (patchOn.any !== keyShown) { keyShown = patchOn.any; keyEl.classList.toggle('is-on', keyShown); }
    const lg = keyShown && P ? LG() : null;
    const here = lg && lg.patchAt ? lg.patchAt(P.position.x, P.position.z, 0.15) : null;
    if (here !== keyHere) {
      keyHere = here;
      keyWarm.classList.toggle('is-here', here === 'warm');
      keyCool.classList.toggle('is-here', here === 'cool');
    }
  }

  // ------------------------------------------------ the big map panel
  const bigView = { cx: 8, cz: 4, s: 5, W: 0, H: 0, big: true, dpr: 1, aerial: true };
  let bigCanvas = null, bigAcc = 0;
  function drawBig() {
    if (!bigCanvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(bigCanvas.clientWidth * dpr), H = Math.round(bigCanvas.clientHeight * dpr);
    if (!W || !H) return;
    if (bigCanvas.width !== W || bigCanvas.height !== H) { bigCanvas.width = W; bigCanvas.height = H; }
    // fit the walkable island and the causeway
    const [xmin, zmin, xmax, zmax] = data.terrain.walk_bounds || [-46, -34, 63, 47];
    const pad = 4;
    bigView.cx = (xmin + xmax) / 2; bigView.cz = (zmin + zmax) / 2;
    bigView.s = Math.min(W / (xmax - xmin + pad * 2), H / (zmax - zmin + pad * 2));
    bigView.W = W; bigView.H = H; bigView.dpr = dpr;
    draw(bigCanvas.getContext('2d'), bigView);
  }
  // the opening (the kit hunt, the station, the practice catch) is phase 'setup'
  const opening = () => state && state.phase === 'setup' && !(state.setup && state.setup.done);
  registerPanel('map', {
    title: 'Lizard Island', icon: 'map', card: 'ui-bigmap', clear: true,
    render(card) {
      const body = document.createElement('div');
      body.className = 'ui-bigmap-body';
      // the opening's key has only what the kit hunt needs (its soft search circles and the
      // place to go next); the survey day's has the patches, requests, jobs and trails
      const op = opening();
      body.innerHTML = '<canvas></canvas>' +
        '<div class="ui-legend"><h4>Key</h4>' +
        `<div>${legendSvg('player')}You</div>` +
        `<div>${legendSvg('cap')}James and the field station</div>` +
        (op ? `<div>${legendSvg('search')}Somewhere in here: a piece of kit</div>` +
          `<div>${legendSvg('goto')}Where James wants you next</div>` : '') +
        `<div>${legendSvg('flag')}Grid flags and their loggers</div>` +
        (op ? '' : `<div>${legendSvg('warm')}${THERMAL_KEY.warm}</div>` +
          `<div>${legendSvg('cool')}${THERMAL_KEY.cool}</div>` +
          `<div>${legendSvg('request')}James asks: near this flag</div>` +
          `<div>${legendSvg('job')}Jobs to do</div>` +
          `<div>${legendSvg('trail')}Tagged lizards</div>` +
          `<div>${legendSvg('perch')}Perch loggers (pulsing: ready)</div>` +
          `<div>${legendSvg('warn')}Crocodile seen</div>`) +
        `<div>${legendSvg('path')}Paths</div>` +
        `<div>${legendSvg('tree')}Big trees</div>` +
        `<div>${legendSvg('rainbow')}Rainbow eucalyptus</div>` +
        (aerial.img ? `<div><button type="button" class="ui-btn is-soft ui-legend-aerial" aria-pressed="${aerial.on}" style="font-size:.8em;padding:.3em .85em .36em">${aerial.on ? 'Aerial photo: on' : 'Aerial photo: off'}</button></div>` : '') +
        '<div style="margin-top:auto;color:var(--ink-soft);font-size:.9em"><kbd>M</kbd> or <kbd>Esc</kbd> to close</div></div>';
      card.appendChild(body);
      bigCanvas = body.querySelector('canvas');
      const sw = body.querySelector('.ui-legend-aerial');
      if (sw) sw.addEventListener('click', (e) => {
        e.stopPropagation();
        aerial.on = !aerial.on;
        sw.setAttribute('aria-pressed', String(aerial.on));
        sw.textContent = aerial.on ? 'Aerial photo: on' : 'Aerial photo: off';
        drawBig();
      });
      requestAnimationFrame(drawBig);
      setTimeout(drawBig, 30);
      return () => { bigCanvas = null; };
    },
    update(dt) {
      bigAcc += dt;
      if (bigAcc < 0.1) return;
      bigAcc = 0;
      drawBig();
    },
  });

  return {
    el: wrap,
    update,
    trails,
    draw,
    drawBig,
    addMarker(m) { markers.add(m); return () => markers.delete(m); },
    // the drone's aerial photo as the big map's photo layer: an image or canvas over the
    // extent { x0, x1, z0, z1 } in metres (null takes it away)
    setAerial(img, extent) {
      aerial.img = img || null;
      if (extent) { aerial.x0 = extent.x0; aerial.x1 = extent.x1; aerial.z0 = extent.z0; aerial.z1 = extent.z1; }
      if (img) aerial.on = true;
      if (bigCanvas) drawBig();
    },
    get aerial() { return aerial.img ? { on: aerial.on, w: aerial.img.width, h: aerial.img.height } : null; },
    clearMarkers() { markers.clear(); },
    toggleBig() { if (currentPanel() === 'map') closePanel(); else openPanel('map'); },
    // draws the whole island into any canvas (the notebook's grid, logger and tracked
    // pages); opts: { bounds, after(ctx, v), bare: only the island, none of the live
    // marks, patches: false leaves out the loggers' warm and cool patches }
    drawIsland(canvas, opts = {}) {
      sampleTrails();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.round(canvas.clientWidth * dpr), H = Math.round(canvas.clientHeight * dpr);
      if (!W || !H) return;
      canvas.width = W; canvas.height = H;
      const [xmin, zmin, xmax, zmax] = opts.bounds || data.terrain.walk_bounds || [-46, -34, 63, 47];
      const v = { cx: (xmin + xmax) / 2, cz: (zmin + zmax) / 2, s: Math.min(W / (xmax - xmin + 6), H / (zmax - zmin + 6)), W, H, big: true, dpr, bare: !!opts.bare, patches: opts.patches !== false };
      const ctx = canvas.getContext('2d');
      draw(ctx, v);
      if (opts.after) opts.after(ctx, v);
    },
  };

  // ------------------------------------------------ glyphs
  function dot(ctx, x, y, r, fill, stroke, lw) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  }
  function pennant(ctx, x, y, u, colour) {
    ctx.strokeStyle = '#6e5238';
    ctx.lineWidth = 1.6 * u;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 10 * u); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - 10 * u); ctx.lineTo(x + 7 * u, y - 7.5 * u); ctx.lineTo(x, y - 5 * u); ctx.closePath();
    ctx.fillStyle = colour; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1 * u; ctx.stroke();
  }
  // a logger's dot at a flag's foot: hollow until downloaded, then warm or cool
  function sensor(ctx, x, y, u, tint) {
    ctx.beginPath();
    ctx.arc(x - 0.2 * u, y + 0.6 * u, 2.9 * u, 0, Math.PI * 2);
    ctx.fillStyle = tint || '#fffaf0';
    ctx.fill();
    ctx.strokeStyle = tint ? '#5a4632' : '#4aa3d8';
    ctx.lineWidth = (tint ? 1 : 1.3) * u;
    ctx.stroke();
  }
  function thermo(ctx, x, y, u, tint) {
    ctx.fillStyle = tint || '#4aa3d8';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5 * u;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x - 3.2 * u, y - 7 * u, 6.4 * u, 11 * u, 3 * u) : ctx.rect(x - 3.2 * u, y - 7 * u, 6.4 * u, 11 * u);
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y + 4 * u, 3.8 * u, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  function cap(ctx, x, y, u) {
    ctx.fillStyle = '#2e3542';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5 * u;
    ctx.beginPath(); ctx.arc(x, y, 5 * u, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 5 * u, y); ctx.lineTo(x - 9 * u, y + 1.5 * u); ctx.stroke();
  }
  function label(ctx, x, y, text, u, colour, fs = 10.5) {
    if (!text) return;
    ctx.font = fontOf(fs, u);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    // a soft cream halo, wide enough to read over the warm and cool patches
    ctx.lineWidth = 4.2 * u;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255, 252, 240, 0.95)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = colour;
    ctx.fillText(text, x, y);
  }
}

const NONE = [];

// the minimap's small warm and cool key
let mapStyled = false;
function ensureMapStyle() {
  if (mapStyled) return;
  mapStyled = true;
  const st = document.createElement('style');
  st.textContent = `
.hud-map-key { position: absolute; left: 0.8em; bottom: 0.75em; display: flex; gap: 0.55em; padding: 0.12em 0.55em 0.16em;
  border-radius: 999px; background: rgba(255, 250, 238, 0.88); color: var(--ink-soft, #6b5a44); font: 800 0.62em/1.3 var(--font-display, system-ui);
  opacity: 0; transform: translateY(0.3em); transition: opacity 0.4s, transform 0.4s; pointer-events: none; }
.hud-map-key.is-on { opacity: 1; transform: none; }
.hud-map-key span { display: inline-flex; align-items: center; gap: 0.3em; }
.hud-map-key i { width: 0.8em; height: 0.8em; border-radius: 50%; opacity: 0.9; transition: box-shadow 0.3s; }
.hud-map-key span { transition: color 0.3s; }
.hud-map-key span.is-here { color: var(--ink, #3d3326); }
.hud-map-key span.is-here i { box-shadow: 0 0 0 0.12em #fff, 0 0 0 0.26em currentColor; }`;
  document.head.appendChild(st);
}

// a flag on the same stake as this logger
function flagAt(flags, l) {
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    if ((f.id && f.id === l.id) || (Math.abs(f.x - l.x) < 0.8 && Math.abs(f.z - l.z) < 0.8)) return true;
  }
  return false;
}

function legendSvg(kind) {
  const s = (inner) => `<i><svg viewBox="0 0 20 20" width="100%" height="100%">${inner}</svg></i>`;
  switch (kind) {
    case 'player': return s('<path d="M10 2 L16 17 L10 13 L4 17z" fill="#ff6f4f" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>');
    case 'cap': return s('<path d="M4 13 A6 6 0 0 1 16 13z" fill="#2e3542"/><path d="M4 13 L1 14.5" stroke="#2e3542" stroke-width="1.8"/>');
    case 'flag': return s('<path d="M6 17V3" stroke="#6e5238" stroke-width="2"/><path d="M6 3l9 3-9 3z" fill="#ff8fbd"/><circle cx="6" cy="17" r="2.6" fill="#fffaf0" stroke="#4aa3d8" stroke-width="1.3"/>');
    case 'logger': return s('<rect x="7" y="2" width="6" height="11" rx="3" fill="#4aa3d8"/><circle cx="10" cy="14" r="4" fill="#4aa3d8"/>');
    case 'trail': return s('<path d="M2 16 C6 6 12 14 17 4" stroke="#ff7a3d" stroke-width="2.2" stroke-dasharray="2.5 3" fill="none" stroke-linecap="round"/><circle cx="17" cy="4" r="3" fill="#ff7a3d" stroke="#fff"/>');
    case 'perch': return s('<circle cx="10" cy="10" r="7.6" fill="none" stroke="#ff7b54" stroke-width="1.4" opacity="0.5"/><circle cx="10" cy="10" r="4.4" fill="#ff7b54" stroke="#fff" stroke-width="1.6"/>');
    case 'job': return s('<circle cx="10" cy="10" r="7" fill="none" stroke="#ff6fa8" stroke-width="2.2"/><circle cx="10" cy="10" r="2.6" fill="#ff6fa8" stroke="#fff"/>');
    case 'warm': return s(`<circle cx="10" cy="10" r="8.5" fill="${WARM}" opacity="0.75"/><circle cx="10" cy="10" r="3" fill="#fffaf0" stroke="${WARM}" stroke-width="1.5"/>`);
    case 'cool': return s(`<circle cx="10" cy="10" r="8.5" fill="${COOL}" opacity="0.75"/><circle cx="10" cy="10" r="3" fill="#fffaf0" stroke="${COOL}" stroke-width="1.5"/>`);
    case 'request': return s(`<circle cx="10" cy="10" r="8" fill="${REQUEST_GOLD}" fill-opacity="0.2" stroke="${REQUEST_GOLD}" stroke-width="2" stroke-dasharray="3.5 2.5"/><path d="M8 15V5" stroke="#6e5238" stroke-width="1.6"/><path d="M8 5l6 2-6 2z" fill="#ff8fbd"/>`);
    case 'search': return s(`<circle cx="10" cy="10" r="8" fill="${REQUEST_GOLD}" fill-opacity="0.2" stroke="${REQUEST_GOLD}" stroke-width="2" stroke-dasharray="3.5 2.5"/>`);
    case 'goto': return s(`<circle cx="10" cy="10" r="7.5" fill="none" stroke="${REQUEST_GOLD}" stroke-width="2"/><circle cx="10" cy="10" r="3.2" fill="${REQUEST_GOLD}" stroke="#fff" stroke-width="1.4"/>`);
    case 'warn': return s('<circle cx="10" cy="10" r="8" fill="#ff5a4a"/><text x="10" y="14.5" font-size="12" font-weight="900" text-anchor="middle" fill="#fff" font-family="system-ui">!</text>');
    case 'path': return s(`<path d="M1 14 C6 8 12 12 19 5" stroke="${COL.pathEdge}" stroke-width="5" fill="none"/><path d="M1 14 C6 8 12 12 19 5" stroke="${COL.path}" stroke-width="3" fill="none"/>`);
    case 'tree': return s(`<circle cx="10" cy="10" r="8" fill="${COL.crown}" stroke="${COL.crownEdge}"/><circle cx="10" cy="10" r="2" fill="${COL.trunk}"/>`);
    case 'rainbow': return s(`<circle cx="10" cy="10" r="8" fill="${COL.crown}" stroke="${COL.crownEdge}"/>` +
      [0, 1, 2, 3, 4, 5].map((k) => { const a = (k / 6) * Math.PI * 2 + 0.3, b = a + 0.62, r = 5; return `<path d="M${(10 + Math.cos(a) * r).toFixed(2)} ${(10 + Math.sin(a) * r).toFixed(2)} A${r} ${r} 0 0 1 ${(10 + Math.cos(b) * r).toFixed(2)} ${(10 + Math.sin(b) * r).toFixed(2)}" stroke="${RAINBOW[k % 3]}" stroke-width="2" fill="none" stroke-linecap="round"/>`; }).join('') +
      `<circle cx="10" cy="10" r="2" fill="${COL.trunk}"/>`);
    default: return '';
  }
}

