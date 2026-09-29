// The scans' point cloud: one THREE.Points over one set of buffers that holds every
// scan (a slot each), drawn in the world (each point popping in bright behind the laser
// fan, a wave of light running out from the scanner as a scan lands, then lingering and
// fading away: the world keeps only the scan in progress or just landed, and draws only
// its points) and, with a second material, in the notebook's little 3D view (a small
// renderer of its own, made once, with orbit and zoom, and its own geometry: separate
// attribute objects over the same typed arrays, so the two renderers never share update
// ranges; each side uploads what changed since it last drew, as one range).
//
// Colours follow the lab's favourite display: the ground beige, everything else green by
// its height above the ground, a person or a bird that walked through the scan as a
// ghost (lilac here, with a face), and the scan spots as coral dots in the notebook.
//
//   const cloud = buildCloud(game, caster)
//   cloud.points                     the world's Points (one draw call)
//   cloud.begin(slot, { x, y, z, theta0, dir, seed, spot })  -> scan (reuses the slot)
//   cloud.now[0] = t; cloud.column(scan, col)   casts one column of rays and writes its
//                                    hits, born at now[0]; cloud.flush(scan) uploads them
//   cloud.finish(scan, time)         the scan is in: the wave, then linger and fade away
//   cloud.hide(slot), cloud.clear()
//   cloud.update(camera, renderer)   per frame (after now[0] = t): uniforms, the world's
//                                    draw range and its upload
//   cloud.setReveal(k)               0..1: the island dims to navy and the cloud shows through
//   cloud.bookView()                 -> the notebook's view, made on first use:
//                                    { canvas, attach(host, opts), render(dt), attached }
//   cloud.COLS, cloud.ROWS, cloud.stats

import * as THREE from 'three';
import { KIND } from './tls_cast.js';

export const MAX_SLOTS = 8;
export const CAP = 44000; // points a scan may keep (a scan keeps about 25,000 to 40,000)
const MARKS = 16; // the scan spots, for the notebook's view
export const RANGE = 38; // m
export const HEAD = 1.5; // m: the laser's height over the ground
export const COLS = 480; // columns round the full turn
const FADE = 4.2; // s a landed scan takes to fade away in the world (after its linger)

// The rows of the fan, by elevation (radians): 0.8 degrees apart below, 0.5 round the
// horizon where the far things are, 1.1 degrees up into the crowns. Steep rows skip columns: near the tripod the ground rings
// would otherwise pile up, and near the zenith the columns crowd together.
const ROW_EL = [];
for (let e = -52; e < -14; e += 0.8) ROW_EL.push(e);
for (let e = -14; e < 10; e += 0.5) ROW_EL.push(e);
for (let e = 10; e <= 78; e += 1.1) ROW_EL.push(e);
export const ROWS = ROW_EL.length;
const rowSin = new Float32Array(ROWS), rowCos = new Float32Array(ROWS), rowSkip = new Uint8Array(ROWS);
const dAz = (Math.PI * 2) / COLS;
for (let r = 0; r < ROWS; r++) {
  const el = (ROW_EL[r] * Math.PI) / 180;
  rowSin[r] = Math.sin(el);
  rowCos[r] = Math.cos(el);
  let k = 1;
  if (el < -0.05) {
    const reach = HEAD / Math.tan(-el); // where this row meets flat ground
    k = Math.max(1, Math.floor(0.1 / (reach * dAz)));
  } else if (el > 0.8) {
    k = Math.max(1, Math.round(0.9 / Math.cos(el)));
  }
  rowSkip[r] = Math.min(12, k);
}

// green by height above the ground (metres), sRGB 0..255
const RAMP = [
  [0.0, 212, 226, 128], [0.6, 180, 218, 96], [2.0, 130, 198, 82], [5.0, 78, 170, 84],
  [9.0, 48, 142, 88], [14.0, 34, 114, 86], [22.0, 26, 92, 82],
];
const GROUND = [222, 204, 164];
const SOLID = { 3: [238, 230, 255], 4: [72, 54, 104], 5: [255, 249, 236], 6: [255, 122, 107], 8: [255, 168, 200] };
// the same as flat typed tables for the hot path
const RAMP_N = RAMP.length;
const RAMP_F = Float32Array.from(RAMP.flat());
const GROUND_F = Float32Array.from(GROUND);
const SOLID_F = new Float32Array(9 * 3);
for (const [k, c] of Object.entries(SOLID)) SOLID_F.set(c, Number(k) * 3);

const VERT = /* glsl */`
  attribute vec3 aCol;
  attribute vec2 aInfo;
  attribute float aBirth;
  uniform float uTime, uSize, uScale, uBias, uFaint, uMin, uMax, uReveal;
  uniform vec4 uSlot[${MAX_SLOTS}];
  uniform vec3 uOrigin[${MAX_SLOTS}];
  varying vec3 vCol;
  varying float vAlpha;
  varying float vKind;
  void main() {
    int s = int(aInfo.x + 0.5);
    float kind = aInfo.y;
    vec4 S = uSlot[s];
    #ifdef BOOK
      bool mark = kind > 5.5 && kind < 6.5; // the scan spots
      bool gone = kind < 0.5 || (!mark && S.y > 0.5);
    #else
      bool gone = kind < 0.5 || (kind > 5.5 && kind < 6.5) || S.y > 0.5;
    #endif
    if (gone) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
    vec3 col = aCol;
    float size = uSize;
    float alpha = 1.0;
    float ghost = (kind > 2.5 && kind < 5.5) || kind > 7.5 ? 1.0 : 0.0;
    #ifdef BOOK
      if (kind > 5.5 && kind < 6.5) size *= 5.0;
      if (ghost > 0.5) size *= 1.6;
    #else
      // popping in behind the fan: big and bright, settling in half a second
      float age = uTime - aBirth;
      float pop = exp(-age * 5.0);
      size *= 1.0 + 1.6 * pop;
      col = mix(col, vec3(1.0, 0.96, 0.92), 0.75 * pop);
      // the scan landed: a wave of light runs out from the scanner, then it lingers
      // and fades to a faint layer
      float since = uTime - S.x;
      if (since > 0.0) {
        float d = distance(position, uOrigin[s]);
        float wave = exp(-pow((d - since * 16.0) / 2.2, 2.0));
        col = mix(col, vec3(1.0, 1.0, 0.94), 0.55 * wave);
        size *= 1.0 + 0.7 * wave;
        float fade = smoothstep(S.z, S.z + 4.0, since);
        alpha = mix(1.0, uFaint, fade);
        size *= mix(1.0, 0.72, fade);
      }
      if (ghost > 0.5) {
        size *= 1.55;
        alpha *= 0.8 + 0.2 * sin(uTime * 5.0 + aBirth * 13.0);
      }
      // the scanner view: leaves a little finer, so the crowns read as surfaces
      if (kind > 1.5 && kind < 2.5) size *= 1.0 - 0.3 * uReveal;
    #endif
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = max(0.05, -mv.z);
    gl_PointSize = clamp(size * uScale / dist, uMin, uMax);
    // drawn a little towards the camera, so the points on a surface paint over it
    mv.xyz += normalize(-mv.xyz) * min(uBias, dist * 0.35);
    gl_Position = projectionMatrix * mv;
    vCol = col;
    vAlpha = alpha;
    vKind = kind;
  }`;

const FRAG = /* glsl */`
  varying vec3 vCol;
  varying float vAlpha;
  varying float vKind;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    if (d > 0.5) discard;
    float edge = smoothstep(0.5, 0.32, d);
    // a soft round dot, a touch lighter in the middle
    vec3 col = vCol * (1.04 - 0.16 * d);
    gl_FragColor = vec4(col, vAlpha * edge);
  }`;

function material(book) {
  const uSlot = [], uOrigin = [];
  for (let i = 0; i < MAX_SLOTS; i++) { uSlot.push(new THREE.Vector4(1e9, 1, 7, 0)); uOrigin.push(new THREE.Vector3()); }
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uSize: { value: book ? 0.12 : 0.055 }, uScale: { value: 600 }, uReveal: { value: 0 },
      uBias: { value: book ? 0 : 0.32 }, uFaint: { value: 0 }, uMin: { value: book ? 1.5 : 1.4 }, uMax: { value: book ? 8 : 13 },
      uSlot: { value: uSlot }, uOrigin: { value: uOrigin },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: book,
    depthTest: true,
    defines: book ? { BOOK: 1 } : {},
  });
  return mat;
}

export function buildCloud(game, caster) {
  const N = MARKS + MAX_SLOTS * CAP;
  const pos = new Float32Array(N * 3);
  const col = new Uint8Array(N * 3);
  const info = new Uint8Array(N * 2);
  const birth = new Float32Array(N);
  const dyn = (a) => a.setUsage(THREE.DynamicDrawUsage);
  // the world's geometry
  const geometry = new THREE.BufferGeometry();
  const aPos = dyn(new THREE.BufferAttribute(pos, 3));
  const aCol = dyn(new THREE.BufferAttribute(col, 3, true));
  const aInfo = dyn(new THREE.BufferAttribute(info, 2, false));
  const aBirth = dyn(new THREE.BufferAttribute(birth, 1));
  geometry.setAttribute('position', aPos);
  geometry.setAttribute('aCol', aCol);
  geometry.setAttribute('aInfo', aInfo);
  geometry.setAttribute('aBirth', aBirth);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(10, 2, -5), 120);
  geometry.setDrawRange(0, 0);
  // the notebook's: its own attribute objects over the same arrays (no birth times), and
  // a group per scan kept, each drawn only up to its point count
  const bookGeo = new THREE.BufferGeometry();
  const bPos = dyn(new THREE.BufferAttribute(pos, 3));
  const bCol = dyn(new THREE.BufferAttribute(col, 3, true));
  const bInfo = dyn(new THREE.BufferAttribute(info, 2, false));
  bookGeo.setAttribute('position', bPos);
  bookGeo.setAttribute('aCol', bCol);
  bookGeo.setAttribute('aInfo', bInfo);
  bookGeo.boundingSphere = geometry.boundingSphere.clone();
  const bookGroups = Array.from({ length: MAX_SLOTS + 1 }, () => ({ start: 0, count: 0, materialIndex: 0 }));
  // What changed since each side last uploaded, in points: [from, to) (to <= from: nothing).
  // Each frame's writes only widen these; the upload is one range per attribute.
  const worldDirty = new Int32Array([N, 0]), bookDirty = new Int32Array([N, 0]);
  function dirty(from, to) {
    if (from < worldDirty[0]) worldDirty[0] = from;
    if (to > worldDirty[1]) worldDirty[1] = to;
    if (from < bookDirty[0]) bookDirty[0] = from;
    if (to > bookDirty[1]) bookDirty[1] = to;
  }
  function upload(D, list) {
    if (D[1] <= D[0]) return;
    for (let k = 0; k < list.length; k++) {
      const a = list[k];
      a.clearUpdateRanges();
      a.addUpdateRange(D[0] * a.itemSize, (D[1] - D[0]) * a.itemSize);
      a.needsUpdate = true;
    }
    D[0] = N; D[1] = 0;
  }
  const worldAttrs = [aPos, aCol, aInfo, aBirth], bookAttrs = [bPos, bCol, bInfo];

  const worldMat = material(false);
  const bookMat = material(true);
  const points = new THREE.Points(geometry, worldMat);
  points.name = 'tls-cloud';
  points.frustumCulled = false;
  points.renderOrder = 4.1;
  points.visible = false;

  // The reveal's "scanner view": the island dims to the notebook view's deep navy (a
  // little lighter in the middle, like the lab's point-cloud display) under the cloud,
  // and the cloud is drawn through everything (x-ray). One full-screen triangle pair,
  // drawn only while it is on.
  const dimMat = new THREE.ShaderMaterial({
    uniforms: { uDim: { value: 0 } },
    vertexShader: 'varying vec2 vP; void main() { vP = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */`
      uniform float uDim; varying vec2 vP;
      void main() {
        float r = length(vP * vec2(0.8, 1.0) - vec2(0.0, 0.25));
        vec3 col = mix(vec3(0.19, 0.23, 0.34), vec3(0.11, 0.14, 0.225), smoothstep(0.0, 1.1, r));
        gl_FragColor = vec4(col, uDim);
      }`,
    transparent: true, depthTest: false, depthWrite: false,
  });
  const dim = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), dimMat);
  dim.name = 'tls-dim';
  dim.frustumCulled = false;
  dim.renderOrder = 3.9;
  dim.visible = false;
  // k 0..1: how far into the scanner view
  function setReveal(k) {
    dimMat.uniforms.uDim.value = 0.9 * k;
    dim.visible = k > 0.01;
    const xray = k > 0.35;
    if (worldMat.depthTest === xray) { worldMat.depthTest = !xray; worldMat.needsUpdate = true; }
    worldMat.uniforms.uBias.value = 0.32 + 0.4 * k;
    worldMat.uniforms.uSize.value = 0.055 * (1 + 0.3 * k);
    worldMat.uniforms.uReveal.value = k;
  }

  // a slot: used (a scan is in it), hidden (gone for good), faded (landed and faded away
  // in the world: drawn only in the notebook), fin and linger (when it landed, how long
  // it stays bright)
  const slots = Array.from({ length: MAX_SLOTS }, (_, i) => ({ i, used: false, n: 0, spot: 0, order: 0, hidden: true, faded: false, landed: false, fin: 0, linger: 7 }));
  let order = 0;
  const stats = { points: 0, scans: 0, lastScanPoints: 0, lastScanMs: 0, drawCalls: 0 };

  const R = caster.R;
  const fanT = new Float32Array(ROWS).fill(RANGE); // the last column's reach per row, for the fan

  // The world draws only the scans still showing (in progress, or landed and not yet
  // faded; nearly always one), each only up to its point count; the slots in between
  // that have faded are culled by their uniform. The notebook draws a group per scan kept.
  function drawEnd() {
    let lo = -1, hi = -1;
    for (let k = 0; k < MAX_SLOTS; k++) {
      const s = slots[k];
      const live = s.used && !s.hidden && !s.faded;
      worldMat.uniforms.uSlot.value[k].y = live ? 0 : 1;
      bookMat.uniforms.uSlot.value[k].y = s.used && !s.hidden ? 0 : 1;
      if (!live) continue;
      if (lo < 0) lo = k;
      hi = k;
    }
    if (lo < 0) { geometry.setDrawRange(0, 0); points.visible = false; return; }
    const a = MARKS + lo * CAP;
    geometry.setDrawRange(a, MARKS + hi * CAP + slots[hi].n - a);
    points.visible = true;
  }
  // (the groups are set in place; the list is made again only when its length changes)
  function bookRanges() {
    let g = 1;
    bookGroups[0].start = 0; bookGroups[0].count = MARKS;
    for (let k = 0; k < MAX_SLOTS; k++) {
      const s = slots[k];
      if (!s.used || s.hidden || s.n <= 0) continue;
      const b = bookGroups[g++];
      b.start = MARKS + k * CAP; b.count = s.n;
    }
    if (bookGeo.groups.length !== g) bookGeo.groups = bookGroups.slice(0, g);
  }

  // A new scan in a slot: its old points (if any) go, its uniforms reset.
  function begin(slot, o) {
    const s = slots[slot];
    const base = MARKS + slot * CAP;
    if (s.used && s.n > 0) {
      info.fill(0, base * 2, (base + s.n) * 2);
      dirty(base, base + s.n);
    }
    // (o.quiet: cast for the notebook only, never shown in the world: a re-cast)
    s.used = true; s.hidden = false; s.faded = !!o.quiet; s.landed = false; s.n = 0; s.spot = o.spot || 0; s.order = ++order;
    worldMat.uniforms.uSlot.value[slot].set(1e9, 0, o.linger ?? 7, 0);
    bookMat.uniforms.uSlot.value[slot].set(1e9, 0, 7, 0);
    worldMat.uniforms.uOrigin.value[slot].set(o.x, o.y, o.z);
    // each scan carries its own random stream (the leaves' free paths), so anything else
    // cast meanwhile (another scan re-cast after a reload) never changes it
    caster.seed(o.seed || slot);
    const rng = new Uint32Array(1);
    rng[0] = caster.S[0];
    drawEnd();
    const scan = {
      slot, base, x: o.x, y: o.y, z: o.z, theta0: o.theta0 || 0, dir: o.dir || 1, spot: o.spot || 0,
      n: 0, col: 0, ghostHits: 0, ghostCol: 0, ghostRun: 0, birdHits: 0, full: false, ms: 0,
      start: base, // first index written this frame (for the upload range)
      kinds: new Int32Array(9), // points kept by kind
      rng,
    };
    return scan;
  }

  // One column of rays at the scan's azimuth for column c; each hit is written straight
  // into the buffers, born at now[0] (set by the caller, so no number is passed).
  // Returns the number of points written.
  const now = new Float64Array(2); // [the game's time, this frame's dt], set once a frame
  function column(scan, c) {
    const t0 = performance.now();
    const az = scan.theta0 + scan.dir * (c + 0.5) * dAz;
    const sx = -Math.sin(az), sz = -Math.cos(az);
    const s = slots[scan.slot];
    const S = caster.S;
    S[0] = scan.rng[0];
    let wrote = 0, ghostHere = 0;
    for (let r = 0; r < ROWS; r++) {
      if (c % rowSkip[r] !== 0) continue;
      const ce = rowCos[r];
      R[0] = scan.x; R[1] = scan.y; R[2] = scan.z;
      R[3] = sx * ce; R[4] = rowSin[r]; R[5] = sz * ce; R[6] = RANGE;
      const kind = caster.cast();
      if (kind === 0) fanT[r] = RANGE; else fanT[r] = R[7];
      if (kind === 0 || kind === KIND.WATER) continue;
      if (kind === KIND.GHOST || kind === KIND.EYE || kind === 8) { ghostHere++; scan.ghostHits++; }
      else if (kind === KIND.BIRD) scan.birdHits++;
      else if (kind === KIND.VEG && R[7] < 8) {
        // near leaves would pile up: keep about as many as a surface 8 m off gets
        const q = R[7] / 8;
        if (hash(scan.n * 7 + r * 131 + c * 17) * U24 > q * q) continue;
      }
      if (s.n >= CAP) { scan.full = true; continue; }
      scan.kinds[kind]++;
      const i = scan.base + s.n;
      pos[i * 3] = R[8]; pos[i * 3 + 1] = R[9]; pos[i * 3 + 2] = R[10];
      paint(i, kind, r + c * 3 + s.n);
      info[i * 2] = scan.slot; info[i * 2 + 1] = kind;
      birth[i] = now[0];
      s.n++; scan.n++; wrote++;
    }
    scan.rng[0] = S[0];
    if (ghostHere > 0) { scan.ghostRun += ghostHere; scan.ghostCol = c; }
    scan.col = c + 1;
    scan.ms += performance.now() - t0;
    return wrote;
  }

  // an integer hash, 0 to 2^24 - 1 (a small integer, so nothing is boxed)
  const h32 = new Uint32Array(1);
  function hash(n) {
    h32[0] = Math.imul(n ^ 0x9e3779b9, 2654435761);
    h32[0] ^= h32[0] >>> 15;
    h32[0] = Math.imul(h32[0], 2246822519);
    return h32[0] >>> 8;
  }
  const U24 = 1 / 16777216;

  // The colour of point i from its kind and R[11], its height over the ground. Flat
  // typed tables and no numbers passed or returned but small integers, so nothing is
  // boxed for a hit.
  function paint(i, kind, n) {
    const o = i * 3;
    if (kind === 1) {
      const k = 0.93 + 0.1 * hash(n * 3 + 1) * U24;
      const r = GROUND_F[0] * k, g = GROUND_F[1] * k, b = GROUND_F[2] * k;
      col[o] = r > 255 ? 255 : r; col[o + 1] = g > 255 ? 255 : g; col[o + 2] = b > 255 ? 255 : b;
      return;
    }
    if (kind !== 2) {
      const q = kind * 3;
      col[o] = SOLID_F[q]; col[o + 1] = SOLID_F[q + 1]; col[o + 2] = SOLID_F[q + 2];
      return;
    }
    let h = R[11];
    if (h < 0) h = 0;
    let q = RAMP_N - 1;
    for (let k = 1; k < RAMP_N; k++) { if (h <= RAMP_F[k * 4]) { q = k; break; } }
    const a = (q - 1) * 4, b = q * 4;
    let f = (h - RAMP_F[a]) / (RAMP_F[b] - RAMP_F[a]);
    if (f > 1) f = 1;
    const j = 0.94 + 0.12 * hash(n * 5 + 2) * U24; // a little leafy variety
    const cr = (RAMP_F[a + 1] + (RAMP_F[b + 1] - RAMP_F[a + 1]) * f) * j;
    const cg = (RAMP_F[a + 2] + (RAMP_F[b + 2] - RAMP_F[a + 2]) * f) * j;
    const cb = (RAMP_F[a + 3] + (RAMP_F[b + 3] - RAMP_F[a + 3]) * f) * j;
    col[o] = cr > 255 ? 255 : cr; col[o + 1] = cg > 255 ? 255 : cg; col[o + 2] = cb > 255 ? 255 : cb;
  }

  // Marks what a scan wrote since the last call for upload (a few columns a frame; the
  // world uploads in update(), the notebook's view when it next draws).
  function flush(scan) {
    const s = slots[scan.slot];
    const from = scan.start, to = scan.base + s.n;
    if (to <= from) return;
    dirty(from, to);
    scan.start = to;
    const live = s.used && !s.hidden && !s.faded;
    if (live) drawEnd(); // the world draws up to the new count
  }

  function finish(scan, time, linger = 7) {
    flush(scan);
    const s = slots[scan.slot];
    s.landed = true; s.fin = time; s.linger = linger;
    worldMat.uniforms.uSlot.value[scan.slot].set(time, 0, linger, 0);
    bookMat.uniforms.uSlot.value[scan.slot].set(time, 0, linger, 0);
    // (a scan cast again after a reload, or a quick one, landed long ago: the notebook only)
    if (now[0] - time > linger + FADE) s.faded = true;
    drawEnd();
    stats.scans++;
    stats.lastScanPoints = slots[scan.slot].n;
    stats.lastScanMs = Math.round(scan.ms);
    stats.lastKinds = { ground: scan.kinds[KIND.GROUND], veg: scan.kinds[KIND.VEG], ghost: scan.kinds[3] + scan.kinds[4] + scan.kinds[8], bird: scan.kinds[5], full: scan.full };
    countPoints();
  }

  function hide(slot) {
    const s = slots[slot];
    s.hidden = true;
    drawEnd();
    countPoints();
  }
  function clear() {
    for (const s of slots) { s.used = false; s.hidden = true; s.n = 0; }
    info.fill(0);
    dirty(0, N);
    drawEnd();
    countPoints();
  }
  function countPoints() {
    let n = 0;
    for (const s of slots) if (s.used && !s.hidden) n += s.n;
    stats.points = n;
  }
  // The slot a new scan takes: a free one, else the oldest.
  function freeSlot() {
    let best = null;
    for (const s of slots) {
      if (!s.used) return s.i;
      if (!best || s.order < best.order) best = s;
    }
    return best.i;
  }

  // The scan spots as coral dots in the notebook's view.
  function setMarks(list) {
    info.fill(0, 0, MARKS * 2);
    list.slice(0, MARKS).forEach((m, k) => {
      pos[k * 3] = m.x; pos[k * 3 + 1] = m.y + HEAD; pos[k * 3 + 2] = m.z;
      col[k * 3] = SOLID[6][0]; col[k * 3 + 1] = SOLID[6][1]; col[k * 3 + 2] = SOLID[6][2];
      info[k * 2] = 0; info[k * 2 + 1] = KIND.MARK;
    });
    dirty(0, MARKS);
  }

  // per frame: the clock and the pixel scale (the camera's lens changes while aiming)
  const _size = new THREE.Vector2();
  let prime = 1;
  const lens = new Float64Array(2); // the fov and drawing height the scale was worked out for
  function update(camera, renderer) {
    const u = worldMat.uniforms;
    u.uTime.value = now[0];
    // (the first frame draws one hidden point, so the world's buffers are made while the
    // game loads rather than at the first scan; the next frame puts it back)
    if (prime === 1) { prime = 2; if (!points.visible) { points.visible = true; geometry.setDrawRange(0, 1); } }
    else if (prime === 2) { prime = 0; drawEnd(); }
    // a landed scan that has faded away leaves the world (it stays in the notebook)
    for (let k = 0; k < MAX_SLOTS; k++) {
      const s = slots[k];
      if (s.landed && !s.faded && s.used && !s.hidden && now[0] - s.fin > s.linger + FADE) { s.faded = true; drawEnd(); }
    }
    if (points.visible) upload(worldDirty, worldAttrs);
    if (camera && renderer && points.visible) {
      const hgt = renderer.domElement.height;
      if (camera.fov !== lens[0] || hgt !== lens[1]) {
        lens[0] = camera.fov; lens[1] = hgt;
        renderer.getDrawingBufferSize(_size);
        u.uScale.value = _size.y / (2 * Math.tan((camera.fov * Math.PI) / 360));
      }
    }
    stats.drawCalls = (points.visible ? 1 : 0) + (dim.visible ? 1 : 0);
  }

  // ---------------------------------------------------------------- the notebook's view

  // Made once, the first time the page opens with points to show: a small renderer of its
  // own on a canvas that moves into the page each time it opens (attach), and draws only
  // while it is in the page. It uploads what changed since it last drew as one range.
  let view = null;
  function bookView() {
    if (view) return view;
    const canvas = document.createElement('canvas');
    canvas.className = 'tls-nb-canvas';
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(36, 1.6, 0.5, 1500);
    const pts = new THREE.Points(bookGeo, [bookMat]); // one group per scan kept (bookRanges)
    pts.frustumCulled = false;
    scene.add(pts);
    const c = new THREE.Vector3();
    let spread = 0;
    const orbit = { yaw: 0.7, pitch: 0.56, dist: 60, idle: 99, drag: false, px: 0, py: 0, fitted: false, still: false };
    const minD = 8, maxD = 170;
    const onDown = (e) => { orbit.drag = true; orbit.px = e.clientX; orbit.py = e.clientY; orbit.idle = 0; canvas.setPointerCapture?.(e.pointerId); e.preventDefault(); e.stopPropagation(); };
    const onMove = (e) => {
      if (!orbit.drag) return;
      orbit.yaw -= (e.clientX - orbit.px) * 0.008;
      orbit.pitch = Math.min(1.45, Math.max(0.08, orbit.pitch + (e.clientY - orbit.py) * 0.006));
      orbit.px = e.clientX; orbit.py = e.clientY; orbit.idle = 0;
    };
    const onUp = () => { orbit.drag = false; };
    const onWheel = (e) => { e.preventDefault(); e.stopPropagation(); orbit.dist = Math.min(maxD, Math.max(minD, orbit.dist * Math.exp(e.deltaY * 0.0012))); orbit.idle = 0; };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    const u = bookMat.uniforms;
    let w = 0, h = 0;
    view = {
      canvas,
      get attached() { return canvas.isConnected; },
      // into the page's view box; framed afresh on every scan kept
      attach(host, opts = {}) {
        host.insertBefore(canvas, host.firstChild); // (under the page's labels)
        orbit.still = !!opts.still;
        orbit.drag = false;
        orbit.idle = 99;
        if (opts.yaw != null) orbit.yaw = opts.yaw;
        if (opts.pitch != null) orbit.pitch = opts.pitch;
        c.set(0, 0, 0);
        let n = 0;
        for (const s of slots) { if (!s.used || s.hidden) continue; c.add(worldMat.uniforms.uOrigin.value[s.i]); n++; }
        if (n) c.multiplyScalar(1 / n); else c.set(8, 0, -4);
        spread = 0;
        for (const s of slots) { if (!s.used || s.hidden) continue; spread = Math.max(spread, c.distanceTo(worldMat.uniforms.uOrigin.value[s.i])); }
        c.y = Math.max(0, c.y - 1);
        orbit.fitted = false;
        w = h = 0;
      },
      render(dt) {
        if (!canvas.isConnected) return;
        const cw = canvas.clientWidth | 0, ch = canvas.clientHeight | 0;
        if (cw < 8 || ch < 8) return; // (in a page that is not showing)
        if (cw !== w || ch !== h) {
          w = cw; h = ch;
          renderer.setSize(w, h, false);
          cam.aspect = w / h;
          cam.updateProjectionMatrix();
          if (!orbit.fitted) {
            // far enough to take in every scan (a scan reaches about 20 m round its spot)
            orbit.fitted = true;
            const half = spread + 22, vt = Math.tan((cam.fov * Math.PI) / 360), ht = vt * cam.aspect;
            orbit.dist = Math.min(maxD, Math.max(minD * 2, half / Math.max(ht * 0.95, vt * 1.9)));
          }
        }
        orbit.idle += dt;
        if (!orbit.drag && orbit.idle > 2.5 && !orbit.still) orbit.yaw += dt * 0.12;
        const cp = Math.cos(orbit.pitch);
        cam.position.set(c.x + Math.sin(orbit.yaw) * cp * orbit.dist, c.y + Math.sin(orbit.pitch) * orbit.dist, c.z + Math.cos(orbit.yaw) * cp * orbit.dist);
        cam.lookAt(c);
        u.uScale.value = (h * renderer.getPixelRatio()) / (2 * Math.tan((cam.fov * Math.PI) / 360));
        upload(bookDirty, bookAttrs);
        bookRanges();
        renderer.render(scene, cam);
      },
    };
    return view;
  }

  return {
    points, dim, geometry, worldMat, bookMat, slots, stats, fanT,
    begin, column, flush, finish, hide, clear, freeSlot, setMarks, update, bookView, now, setReveal, bookGeo,
    get view() { return view; },
    COLS, ROWS, rowSin, rowCos,
    get count() { return stats.points; },
  };
}
