// Small cosy props, all procedural:
//   const props = buildProps({ data, renderer });
//   scene.add(props.group);  props.update(dt, t);  props.colliders -> [[x, z, r], ...]
//
// - a wooden "Lizard Island" signpost where the causeway meets the garden;
// - a little field station on the landing (a folding table, a mesh of its own that the
//   story can knock over, a crate, a bucket and a pastel flag; what sits on the table
//   is the story's, src/story/station.js) and a picket gate out to the garden path;
// - lily pads in the open shallows, reeds by the causeway, mushrooms under the big trees;
// - a white ibis wading beside the causeway.
// Everything static is one merged vertex-colour mesh; the sign's face is one textured
// quad, the table one mesh and the ibis two small meshes, so the props cost five draw
// calls. props.table.setTip(k) lays the table on its side (k 1) or stands it up (k 0).

import * as THREE from 'three';
import {
  MeshBuilder, blob, tube, makeRng, hashSeed, lin, tint, bezier, bezier3, norm, cross, sub, add, mul, madd, clamp,
} from './models.js';
import { applyVegShader, makeToonGradient, TOON_WOOD, TOON_LEAF } from './wind.js';
import { GATE } from './vegetation.js';

// Worn paths from the ground decoration, when it is there.
let pathMask = () => 0;
try {
  const m = await import('./ground_decor.js');
  if (typeof m.pathMask === 'function') pathMask = m.pathMask;
} catch (e) {
  // no ground decoration yet: props only keep off the lizards
}

const TAU = Math.PI * 2;
const UP = [0, 1, 0];
const BIT = { water: 1, island: 2, causeway: 4, bank: 8, thicket: 16, walkable: 32, fringe: 64 };

// Where things go. The landing is the walkable pocket at the causeway's garden end
// (x -14 to -8.75, z 41.5 to 46.3); the start is at (-11.4, 39) facing north.
export const PROP_SPOTS = {
  sign: { x: -14.25, z: 41.05, face: 0.25 }, // faces south-ish, towards the start camera
  table: { x: -13.42, z: 43.75, rot: 0 },
  crate: { x: -13.35, z: 45.05 },
  bucket: { x: -9.45, z: 43.35 },
  flag: { x: -8.35, z: 45.2 },
  ibis: { x: -16.35, z: 35.2, heading: 2.75 }, // in the shallows at the left of the start view
  lilies: [[-25, 25], [-30, 20], [-40, 15], [-45, -5], [-24, 35], [2, 36]],
  reeds: [[-20, -17.5, 41, 43], [-3, 0, 40.5, 41.5]],
  mushrooms: ['T022', 'T023', 'T025', 'T013', 'T024'],
};

const C = {
  wood: lin('#b98a5a'), woodDark: lin('#8a5a3c'), woodLight: lin('#dcb784'), cream: lin('#f6efdd'),
  metal: lin('#a7b0b8'), paper: lin('#fffdf6'), ink: lin('#7b8aa0'), clip: lin('#c9ced4'),
  jar: lin('#bfe6ef'), lid: lin('#ff8a5c'), lid2: lin('#6fc3d9'), notebook: lin('#5fb86a'),
  crate: lin('#c9955e'), bucket: lin('#ffcc4d'), bucketIn: lin('#6fd0cf'), pole: lin('#d9c7a0'),
  flag: lin('#ff9ec4'), flag2: lin('#9fd8ff'), pad: lin('#7ccb6a'), padLight: lin('#a4dd8a'),
  petal: lin('#ff9ec4'), petalTip: lin('#fff0f6'), stamen: lin('#ffd84a'), reed: lin('#86b84c'),
  reedLight: lin('#aad060'), cattail: lin('#8a5a3c'), cap: lin('#f36b58'), dot: lin('#fff4e0'), stem: lin('#fff4e0'),
  thermos: lin('#4fa3b8'),
};

// ---------------------------------------------------------------- shapes

// A box centred at c with half-sizes h, turned by rot about +y; faces shaded by
// direction so it reads without textures.
function box(b, c, h, rot, col, shade = [1.0, 0.86, 0.78, 0.9, 0.7]) {
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const P = (x, y, z) => [c[0] + x * cs + z * sn, c[1] + y, c[2] - x * sn + z * cs];
  const [hx, hy, hz] = h;
  const v = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz), P(-hx, hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), P(-hx, hy, hz)];
  const [top, sideA, sideB, sideC, bottom] = shade;
  b.quad(v[4], v[7], v[6], v[5], tint(col, top));
  b.quad(v[3], v[2], v[6], v[7], tint(col, sideA));
  b.quad(v[1], v[0], v[4], v[5], tint(col, sideB));
  b.quad(v[2], v[1], v[5], v[6], tint(col, sideC));
  b.quad(v[0], v[3], v[7], v[4], tint(col, sideC * 0.95));
  b.quad(v[0], v[1], v[2], v[3], tint(col, bottom));
}

// A vertical cylinder (or cone when r1 differs), optionally capped.
function cyl(b, base, r0, r1, h, col, o = {}) {
  const n = o.sides ?? 10;
  const top = [base[0], base[1] + h, base[2]];
  tube(b, [base, top], [r0, r1], { sides: n, smooth: true, color: col, capEnd: o.cap !== false, capColor: o.capColor ?? tint(col, 1.06), radiusScale: 1 });
}

// ---------------------------------------------------------------- pieces

function signpost(b, s, ground) {
  const y = ground(s.x, s.z);
  const d = [Math.sin(s.face), 0, Math.cos(s.face)]; // board normal (towards the viewer)
  const side = [d[2], 0, -d[0]];
  const post = (o) => {
    const p = [s.x + side[0] * o - d[0] * 0.09, y - 0.3, s.z + side[2] * o - d[2] * 0.09];
    box(b, [p[0], y + 0.6, p[2]], [0.055, 0.9, 0.055], s.face, C.woodDark);
    blob(b, { c: [p[0], y + 1.53, p[2]], r: [0.075, 0.06, 0.075], detail: 1, seed: 5, jit: 0, color: C.woodDark, shade: [0.8, 1.1], tone: false });
  };
  post(-0.52);
  post(0.52);
  // the board: the textured face sits just in front of it
  box(b, [s.x - d[0] * 0.02, y + 1.12, s.z - d[2] * 0.02], [0.64, 0.23, 0.03], s.face, C.woodDark);
  // a little roof of two planks
  const ry = y + 1.42;
  for (const k of [-1, 1]) {
    const c = [s.x + d[0] * (k * 0.07 - 0.05), ry, s.z + d[2] * (k * 0.07 - 0.05)];
    box(b, c, [0.72, 0.025, 0.1], s.face, tint(C.wood, 1.05));
  }
  return {
    board: { x: s.x + d[0] * 0.013, y: y + 1.12, z: s.z + d[2] * 0.013, face: s.face, w: 1.18, h: 0.4 },
    back: { x: s.x - d[0] * 0.053, y: y + 1.12, z: s.z - d[2] * 0.053, face: s.face + Math.PI, w: 0.9, h: 0.4 },
  };
}

// front: the lettering with an arrow and a lizard; the back face is narrower (it sits
// between the posts), so its lettering is drawn wider to come out right.
function signTexture(text = 'Lizard Island', lizard = true, stretch = 1) {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = 768;
  cv.height = 260;
  const g = cv.getContext('2d');
  const r = 36;
  g.fillStyle = '#8a5a3c';
  g.beginPath();
  g.moveTo(r, 0); g.lineTo(cv.width - r, 0); g.quadraticCurveTo(cv.width, 0, cv.width, r);
  g.lineTo(cv.width, cv.height - r); g.quadraticCurveTo(cv.width, cv.height, cv.width - r, cv.height);
  g.lineTo(r, cv.height); g.quadraticCurveTo(0, cv.height, 0, cv.height - r);
  g.lineTo(0, r); g.quadraticCurveTo(0, 0, r, 0);
  g.fill();
  // soft grain
  g.strokeStyle = 'rgba(60, 30, 15, 0.18)';
  g.lineWidth = 4;
  for (let k = 0; k < 7; k++) {
    const yy = 30 + k * 34;
    g.beginPath();
    g.moveTo(20, yy);
    g.bezierCurveTo(250, yy + 10, 500, yy - 10, 748, yy + 4);
    g.stroke();
  }
  g.strokeStyle = 'rgba(255, 240, 210, 0.5)';
  g.lineWidth = 6;
  g.strokeRect(14, 14, cv.width - 28, cv.height - 28);
  g.fillStyle = '#fbf1dc';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 96px ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Varela Round", "Nunito", system-ui, sans-serif';
  g.font = `bold ${stretch > 1 ? 74 : 96}px ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Varela Round", "Nunito", system-ui, sans-serif`;
  if (stretch > 1) {
    g.save();
    g.setTransform(stretch, 0, 0, 1, cv.width / 2 * (1 - stretch), 0);
    g.fillText(text, cv.width / 2, 136);
    g.restore();
    const t0 = new THREE.CanvasTexture(cv);
    t0.colorSpace = THREE.SRGBColorSpace;
    return t0;
  }
  g.fillText(text, 330, 136);
  // an arrow pointing on, up the causeway
  g.beginPath();
  g.moveTo(690, 70); g.lineTo(735, 125); g.lineTo(708, 125); g.lineTo(708, 196);
  g.lineTo(672, 196); g.lineTo(672, 125); g.lineTo(645, 125); g.closePath();
  g.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (!lizard) return tex;
  // a tiny lizard under the words
  g.fillStyle = '#9be36a';
  g.beginPath(); g.ellipse(560, 214, 34, 11, 0, 0, TAU); g.fill();
  g.beginPath(); g.ellipse(600, 210, 14, 10, 0.2, 0, TAU); g.fill();
  g.strokeStyle = '#9be36a'; g.lineWidth = 7; g.lineCap = 'round';
  g.beginPath(); g.moveTo(528, 216); g.quadraticCurveTo(490, 230, 470, 206); g.stroke();
  for (const [x0, s] of [[545, -1], [545, 1], [578, -1], [578, 1]]) { g.beginPath(); g.moveTo(x0, 214); g.lineTo(x0 + 6, 214 + s * 18); g.stroke(); }
  g.fillStyle = '#3b2a1e';
  g.beginPath(); g.arc(606, 206, 3, 0, TAU); g.fill();
  return tex;
}

// frameOnly: just the table (the story keeps the things on it, and tips it over)
function fieldTable(b, s, ground, { frameOnly = false } = {}) {
  const y = ground(s.x, s.z);
  const rot = s.rot;
  const at = (x, yy, z) => [s.x + x * Math.cos(rot) + z * Math.sin(rot), y + yy, s.z - x * Math.sin(rot) + z * Math.cos(rot)];
  const H = 0.72, hx = 0.28, hz = 0.52;
  box(b, at(0, H, 0), [hx, 0.024, hz], rot, C.woodLight);
  // a darker apron round the top's edge and a darker underside, so the table reads as a
  // table from below too (the ibises knock it on its side in the opening)
  box(b, at(0, H - 0.028, 0), [hx - 0.02, 0.006, hz - 0.02], rot, tint(C.woodDark, 0.8));
  for (const k of [-1, 1]) {
    box(b, at(k * (hx - 0.018), H - 0.055, 0), [0.018, 0.035, hz - 0.01], rot, C.woodDark);
    box(b, at(0, H - 0.055, k * (hz - 0.018)), [hx - 0.01, 0.035, 0.018], rot, C.woodDark);
  }
  // folding legs: an X at each end, with a bar across the bottom
  for (const z of [-hz + 0.08, hz - 0.08]) {
    for (const k of [-1, 1]) {
      tube(b, [at(-hx * 0.85 * k, 0, z), at(hx * 0.85 * k, H - 0.07, z)], [0.024, 0.024], { sides: 6, color: C.metal, radiusScale: 1 });
    }
  }
  tube(b, [at(-hx * 0.85, 0.03, -hz + 0.08), at(-hx * 0.85, 0.03, hz - 0.08)], [0.018, 0.018], { sides: 5, color: C.metal, radiusScale: 1 });
  if (frameOnly) return [[...at(0, 0, -0.26).filter((_, i) => i !== 1), 0.34], [...at(0, 0, 0.26).filter((_, i) => i !== 1), 0.34]];
  // clipboard with a field sheet
  box(b, at(-0.02, H + 0.028, -0.2), [0.12, 0.007, 0.16], rot + 0.12, C.woodDark);
  box(b, at(-0.02, H + 0.037, -0.19), [0.1, 0.004, 0.135], rot + 0.12, C.paper);
  for (let k = 0; k < 5; k++) box(b, at(-0.02 - 0.08 + k * 0.035, H + 0.042, -0.19), [0.004, 0.002, 0.1], rot + 0.12, C.ink, [1, 1, 1, 1, 1]);
  box(b, at(-0.02, H + 0.045, -0.335), [0.035, 0.008, 0.02], rot + 0.12, C.clip);
  // specimen jars
  cyl(b, at(0.1, H + 0.02, 0.18), 0.05, 0.05, 0.13, C.jar, { capColor: C.jar });
  cyl(b, at(0.1, H + 0.15, 0.18), 0.054, 0.054, 0.03, C.lid);
  cyl(b, at(-0.05, H + 0.02, 0.31), 0.043, 0.043, 0.11, C.jar, { capColor: C.jar });
  cyl(b, at(-0.05, H + 0.13, 0.31), 0.047, 0.047, 0.03, C.lid2);
  // a field notebook and a pencil
  box(b, at(0.12, H + 0.03, -0.02), [0.07, 0.01, 0.1], rot - 0.3, C.notebook);
  tube(b, [at(0.02, H + 0.03, 0.05), at(0.1, H + 0.03, 0.12)], [0.007, 0.007], { sides: 4, color: C.bucket, radiusScale: 1 });
  return [[...at(0, 0, -0.26).filter((_, i) => i !== 1), 0.34], [...at(0, 0, 0.26).filter((_, i) => i !== 1), 0.34]];
}

function crate(b, s, ground) {
  const y = ground(s.x, s.z);
  const rot = 0.35;
  box(b, [s.x, y + 0.22, s.z], [0.26, 0.22, 0.22], rot, C.crate);
  // slats and corner posts
  for (const k of [-1, 1]) {
    box(b, [s.x, y + 0.22 + k * 0.12, s.z], [0.27, 0.035, 0.225], rot, tint(C.crate, 0.88));
  }
  for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x = s.x + (cx * 0.25) * Math.cos(rot) + (cz * 0.21) * Math.sin(rot);
    const z = s.z - (cx * 0.25) * Math.sin(rot) + (cz * 0.21) * Math.cos(rot);
    box(b, [x, y + 0.22, z], [0.022, 0.225, 0.022], rot, tint(C.woodDark, 1.1));
  }
  // a thermos on top
  cyl(b, [s.x + 0.08, y + 0.44, s.z - 0.05], 0.045, 0.045, 0.22, C.thermos);
  cyl(b, [s.x + 0.08, y + 0.66, s.z - 0.05], 0.035, 0.035, 0.04, C.cream);
  return [[s.x, s.z, 0.33]];
}

function bucket(b, s, ground) {
  const y = ground(s.x, s.z);
  cyl(b, [s.x, y, s.z], 0.14, 0.18, 0.3, C.bucket, { cap: false });
  cyl(b, [s.x, y, s.z], 0.14, 0.14, 0.01, C.bucket);
  cyl(b, [s.x, y + 0.2, s.z], 0.165, 0.165, 0.005, C.bucketIn);
  const arc = [];
  for (let k = 0; k <= 8; k++) {
    const a = Math.PI * (k / 8);
    arc.push([s.x + Math.cos(a) * 0.18, y + 0.3 + Math.sin(a) * 0.13, s.z]);
  }
  tube(b, arc, arc.map(() => 0.008), { sides: 4, color: C.metal, radiusScale: 1 });
  return [[s.x, s.z, 0.2]];
}

function flag(b, s, ground) {
  const y = ground(s.x, s.z);
  const was = b.sway;
  b.sway = 0.2;
  cyl(b, [s.x, y - 0.2, s.z], 0.03, 0.022, 2.2, C.pole);
  blob(b, { c: [s.x, y + 2.03, s.z], r: [0.04, 0.04, 0.04], detail: 1, seed: 2, jit: 0, color: C.bucket, tone: false, shade: [0.9, 1.1] });
  b.sway = 1.4;
  // a two-tone pennant, gently rippled
  const n = 6;
  const L = 0.62, Hh = 0.36;
  const P = (u, v) => [s.x - u * L, y + 1.95 - Hh * v * (1 - 0.55 * u) - 0.02, s.z + 0.06 * Math.sin(u * 5.0)];
  for (let i = 0; i < n; i++) {
    const u0 = i / n, u1 = (i + 1) / n;
    const col = i % 2 ? C.flag2 : C.flag;
    b.quad2(P(u0, 0), P(u1, 0), P(u1, 1), P(u0, 1), col);
  }
  b.sway = was;
}

function gate(b, ground) {
  const z = (GATE.z0 + GATE.z1) / 2 - 0.2;
  const x0 = GATE.x0 + 0.12, x1 = GATE.x1 - 0.12;
  const y0 = ground((x0 + x1) / 2, z);
  for (const x of [x0, x1]) {
    box(b, [x, y0 + 0.4, z], [0.06, 0.72, 0.06], 0, C.cream);
    blob(b, { c: [x, y0 + 1.15, z], r: [0.08, 0.07, 0.08], detail: 1, seed: 9, jit: 0, color: C.cream, tone: false, shade: [0.85, 1.08] });
  }
  // two leaves of pickets, closed
  const w = (x1 - x0) / 2;
  for (const [a, dir] of [[x0 + 0.07, 1], [x1 - 0.07, -1]]) {
    const len = w - 0.09;
    for (const yy of [0.28, 0.66]) box(b, [a + dir * len / 2, y0 + yy, z], [len / 2, 0.035, 0.018], 0, tint(C.cream, 0.96));
    const nP = 4;
    for (let k = 0; k < nP; k++) {
      const px = a + dir * (0.07 + (k + 0.5) * (len - 0.1) / nP);
      const top = y0 + 0.86 + (dir > 0 ? k : nP - 1 - k) * 0.03;
      box(b, [px, (y0 + 0.12 + top) / 2, z + 0.025], [0.035, (top - y0 - 0.12) / 2, 0.012], 0, C.cream);
      b.tri([px - 0.035, top, z + 0.038], [px + 0.035, top, z + 0.038], [px, top + 0.06, z + 0.038], C.cream);
      b.tri([px + 0.035, top, z + 0.012], [px - 0.035, top, z + 0.012], [px, top + 0.06, z + 0.012], tint(C.cream, 0.9));
    }
  }
  // a little arch over the gate
  const arch = [];
  for (let k = 0; k <= 10; k++) {
    const t = k / 10;
    arch.push([x0 + (x1 - x0) * t, y0 + 1.12 + Math.sin(Math.PI * t) * 0.35, z]);
  }
  tube(b, arch, arch.map(() => 0.035), { sides: 5, smooth: true, color: C.cream });
  return null;
}

function lilyPad(b, x, z, r, rng, flower) {
  const n = 12;
  const notch = rng() * TAU;
  const y = 0.012;
  const c = [x, y, z];
  const col = tint(C.pad, 0.92 + 0.14 * rng());
  for (let k = 0; k < n; k++) {
    const a0 = notch + 0.35 + (k / n) * (TAU - 0.5), a1 = notch + 0.35 + ((k + 1) / n) * (TAU - 0.5);
    const p0 = [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], p1 = [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r];
    b.tri(c, p1, p0, tint(C.padLight, 0.98), col, col);
  }
  if (!flower) return;
  const fx = x + (rng() - 0.5) * r * 0.4, fz = z + (rng() - 0.5) * r * 0.4;
  const base = [fx, y + 0.02, fz];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * TAU + rng() * 0.2;
    const d = [Math.cos(a), 0, Math.sin(a)];
    const tip = [fx + d[0] * 0.11, y + 0.11, fz + d[2] * 0.11];
    const s = [-d[2] * 0.04, 0, d[0] * 0.04];
    b.tri2(base, add(lerpP(base, tip, 0.5), s), tip, C.petal, C.petal, C.petalTip);
    b.tri2(base, tip, sub(lerpP(base, tip, 0.5), s), C.petal, C.petalTip, C.petal);
  }
  blob(b, { c: [fx, y + 0.05, fz], r: [0.03, 0.025, 0.03], detail: 0, seed: 3, jit: 0, color: C.stamen, tone: false, shade: [0.9, 1.1] });
}
const lerpP = (a, b2, t) => [a[0] + (b2[0] - a[0]) * t, a[1] + (b2[1] - a[1]) * t, a[2] + (b2[2] - a[2]) * t];

function reedClump(b, x, y, z, rng, land = null) {
  const n = 7 + Math.floor(rng() * 3);
  const was = b.sway;
  b.sway = 1.2;
  for (let k = 0; k < n; k++) {
    let a = rng() * TAU;
    // lean out over the water, away from the path
    if (land && Math.cos(a - land) > 0) a += Math.PI;
    const lean = 0.08 + rng() * 0.18;
    const h = 0.8 + rng() * 0.6;
    const bx = x + Math.cos(a) * rng() * 0.18, bz = z + Math.sin(a) * rng() * 0.18;
    const top = [bx + Math.cos(a) * lean * h, y + h, bz + Math.sin(a) * lean * h];
    const mid = [bx + Math.cos(a) * lean * h * 0.3, y + h * 0.55, bz + Math.sin(a) * lean * h * 0.3];
    const side = norm(cross([top[0] - bx, h, top[2] - bz], UP));
    const w = 0.035;
    const col = rng() < 0.5 ? C.reed : C.reedLight;
    const b0 = [bx, y - 0.05, bz];
    b.quad2(madd(b0, side, w), madd(b0, side, -w), madd(mid, side, -w * 0.7), madd(mid, side, w * 0.7), tint(col, 0.8), tint(col, 0.8), col, col);
    b.tri2(madd(mid, side, w * 0.7), madd(mid, side, -w * 0.7), top, col, col, tint(col, 1.15));
    if (k % 3 === 0) {
      const c0 = lerpP(mid, top, 0.35), c1 = lerpP(mid, top, 0.62);
      tube(b, [c0, c1], [0.028, 0.028], { sides: 5, smooth: true, color: C.cattail, capEnd: true, capStart: true, radiusScale: 1 });
    }
  }
  b.sway = was;
}

function mushroomCluster(b, x, z, ground, rng) {
  const n = 3 + Math.floor(rng() * 3);
  for (let k = 0; k < n; k++) {
    const a = rng() * TAU, d = rng() * 0.22;
    const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    const y = ground(px, pz);
    const s = 0.6 + rng() * 0.6;
    const h = 0.1 * s, r = 0.075 * s;
    const tilt = [Math.cos(a) * 0.02 * s, 0, Math.sin(a) * 0.02 * s];
    cyl(b, [px, y - 0.01, pz], 0.022 * s, 0.018 * s, h, C.stem, { sides: 7 });
    const top = [px + tilt[0], y + h, pz + tilt[2]];
    // cap: a dome with cream dots on some faces
    const cap = new MeshBuilder();
    blob(cap, { c: top, r: [r, r * 0.75, r], detail: 1, seed: hashSeed('cap', k, x), jit: 0.03, flat: 0, squash: 0.15, color: C.cap, shade: [0.85, 1.1], tone: false, smooth: 0.8 });
    const dotRng = makeRng(hashSeed('dots', k, z));
    for (let i = 0; i < cap.p.length; i += 9) {
      const cy2 = (cap.p[i + 1] + cap.p[i + 4] + cap.p[i + 7]) / 3;
      const dot = cy2 > top[1] + r * 0.12 && dotRng() < 0.18;
      for (let j = 0; j < 3; j++) {
        b.p.push(cap.p[i + j * 3], cap.p[i + j * 3 + 1], cap.p[i + j * 3 + 2]);
        b.n.push(cap.n[i + j * 3], cap.n[i + j * 3 + 1], cap.n[i + j * 3 + 2]);
        const c = dot ? C.dot : [cap.c[i + j * 3], cap.c[i + j * 3 + 1], cap.c[i + j * 3 + 2]];
        b.c.push(c[0], c[1], c[2]);
        b.s.push(0);
      }
    }
  }
}

// A white ibis in two parts: the body and legs, and the neck, head and bill, which
// pivots at the base of the neck to dip for food.
function ibisParts() {
  const body = new MeshBuilder(), head = new MeshBuilder();
  const white = lin('#f5f3ea'), shade = lin('#e3ded2'), tip = lin('#2e2f3a'), bill = lin('#ff8a5c'), face = lin('#ff7b6b'), leg = lin('#ff9f84'), eye = lin('#2b2b33');
  const part = (b, c, r, col, seed, detail = 1) => blob(b, { c, r, detail, seed, jit: 0.02, rot: 0, color: col, shade: [0.8, 1.06], tone: false, smooth: 0.85 });
  body.sway = 0; head.sway = 0;
  // body along +x (forward), standing on legs about 0.34 m long
  part(body, [0, 0.52, 0], [0.24, 0.13, 0.12], white, 1);
  part(body, [-0.2, 0.5, 0], [0.12, 0.07, 0.08], shade, 2);
  part(body, [-0.27, 0.5, 0], [0.07, 0.04, 0.07], tip, 3, 0);
  for (const s of [-1, 1]) part(body, [-0.05, 0.55, s * 0.09], [0.2, 0.08, 0.04], shade, 4 + s);
  for (const s of [-1, 1]) {
    tube(body, [[0.02, 0.44, s * 0.05], [0.0, 0.25, s * 0.055], [0.02, 0.02, s * 0.06]], [0.013, 0.011, 0.01], { sides: 4, color: leg, radiusScale: 1 });
    for (const a of [-0.5, 0, 0.5]) tube(body, [[0.02, 0.02, s * 0.06], [0.02 + Math.cos(a) * 0.07, 0.01, s * 0.06 + Math.sin(a) * 0.07]], [0.008, 0.006], { sides: 3, color: leg, radiusScale: 1 });
  }
  // neck, head and the long curved bill, with the pivot at the origin
  const neck = bezier([0, 0, 0], [0.1, 0.12, 0], [0.12, 0.26, 0], 5);
  tube(head, neck, neck.map((_, k) => 0.045 - k * 0.004), { sides: 6, smooth: true, color: white });
  part(head, [0.14, 0.28, 0], [0.06, 0.05, 0.045], white, 7);
  part(head, [0.18, 0.27, 0], [0.035, 0.03, 0.033], face, 8);
  for (const s of [-1, 1]) part(head, [0.16, 0.295, s * 0.036], [0.008, 0.008, 0.005], eye, 9, 0);
  const bp = bezier([0.2, 0.27, 0], [0.3, 0.26, 0], [0.37, 0.15, 0], 6);
  tube(head, bp, bp.map((_, k) => 0.016 - k * 0.0022), { sides: 5, smooth: true, color: bill, capEnd: true, radiusScale: 1 });
  return { body, head };
}

// The pieces, for the model gallery.
export const PIECES = { signpost, signTexture, fieldTable, crate, bucket, flag, gate, lilyPad, reedClump, mushroomCluster, ibisParts };

// ---------------------------------------------------------------- placing

function findSpot(T, x, z, maxR, ok) {
  for (let r = 0; r <= maxR; r += 0.5) {
    const n = Math.max(1, Math.round((TAU * r) / 0.5));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (ok(px, pz)) return [px, pz];
    }
  }
  return null;
}

export function buildProps({ data } = {}) {
  const T = data.terrain;
  const ground = (x, z) => T.heightAt(x, z);
  const spawns = data.spawns?.spawns ?? [];
  const nearLizard = (x, z, d) => spawns.some((s) => Math.abs(s.x - x) < d && Math.abs(s.z - z) < d && Math.hypot(s.x - x, s.z - z) < d);
  const onPath = (x, z) => { try { return pathMask(x, z) > 0.1; } catch (e) { return false; } };
  const mask = (x, z) => T.maskAt(x, z);
  const b = new MeshBuilder();
  b.sway = 0; // static props stay put; reeds and the flag set their own sway
  const colliders = [];
  const stats = { lilies: 0, flowers: 0, reeds: 0, mushrooms: 0 };
  const S = PROP_SPOTS;

  // the landing: signpost, field station, gate
  const sign = signpost(b, S.sign, ground);
  {
    // three circles along the board, so neither end can be walked through
    const side = [Math.cos(S.sign.face), -Math.sin(S.sign.face)];
    for (const o of [-0.45, 0, 0.45]) {
      const x = S.sign.x + side[0] * o, z = S.sign.z + side[1] * o;
      if (T.isWalkable(x, z)) colliders.push([+x.toFixed(2), +z.toFixed(2), 0.2]);
    }
  }
  // the field table is a mesh of its own (the story tips it over and rights it); what
  // sits on it is the story's station kit (src/story/station.js)
  const tableB = new MeshBuilder();
  tableB.sway = 0;
  for (const c of fieldTable(tableB, { x: 0, z: 0, rot: S.table.rot }, () => 0, { frameOnly: true })) {
    colliders.push([+(S.table.x + c[0]).toFixed(3), +(S.table.z + c[1]).toFixed(3), c[2]]);
  }
  colliders.push(...crate(b, S.crate, ground));
  colliders.push(...bucket(b, S.bucket, ground));
  flag(b, S.flag, ground);
  if (T.isWalkable(S.flag.x, S.flag.z)) colliders.push([S.flag.x, S.flag.z, 0.1]);
  gate(b, ground);

  // lily pads in open, canopy-free shallows
  const openWater = (x, z) => {
    const m = mask(x, z);
    return (m & BIT.water) && T.canopyAt(x, z) < 0.2 && ground(x, z) < -0.12;
  };
  S.lilies.forEach(([cx, cz], ci) => {
    const rng = makeRng(hashSeed('lily', ci));
    const c = findSpot(T, cx, cz, 6, (x, z) => openWater(x, z) && openWater(x + 1, z) && openWater(x - 1, z) && openWater(x, z + 1) && openWater(x, z - 1));
    if (!c) return;
    const n = 8 + Math.floor(rng() * 3);
    const placed = [];
    for (let k = 0; k < n * 3 && placed.length < n; k++) {
      const a = rng() * TAU, d = Math.sqrt(rng()) * 1.5;
      const x = c[0] + Math.cos(a) * d, z = c[1] + Math.sin(a) * d;
      const r = 0.15 + rng() * 0.15;
      if (!openWater(x, z) || placed.some((p) => Math.hypot(p[0] - x, p[1] - z) < p[2] + r + 0.02)) continue;
      placed.push([x, z, r]);
      const fl = placed.length % 6 === 3;
      lilyPad(b, x, z, r, rng, fl);
      stats.lilies++;
      if (fl) stats.flowers++;
    }
  });

  // reeds along the water's edge by the causeway, where the start can see them
  S.reeds.forEach(([xa, xb, za, zb], ri) => {
    const rng = makeRng(hashSeed('reeds', ri));
    let placed = 0;
    for (let k = 0; k < 80 && placed < 5; k++) {
      const x = xa + (xb - xa) * rng(), z = za + (zb - za) * rng();
      const m = mask(x, z);
      if (!(m & BIT.water)) continue;
      const shore = [[0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]].some(([dx, dz]) => !(mask(x + dx, z + dz) & BIT.water));
      if (!shore) continue;
      let lx = 0, lz = 0;
      for (const [dx, dz] of [[0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]]) if (!(mask(x + dx, z + dz) & BIT.water)) { lx += dx; lz += dz; }
      reedClump(b, x, Math.min(0, ground(x, z)), z, rng, Math.atan2(lz, lx));
      placed++;
      stats.reeds++;
    }
  });

  // mushrooms under the big trees, off the paths and away from the lizards
  const lms = data.placements.landmarks;
  S.mushrooms.forEach((id, mi) => {
    const lm = lms.find((l) => l.id === id);
    if (!lm) return;
    const rng = makeRng(hashSeed('mush', id));
    for (let k = 0; k < 24; k++) {
      const a = rng() * TAU, d = 1.5 + rng();
      const x = lm.x + Math.cos(a) * d, z = lm.z + Math.sin(a) * d;
      if (!T.isWalkable(x, z) || onPath(x, z) || nearLizard(x, z, 0.5)) continue;
      mushroomCluster(b, x, z, ground, rng);
      stats.mushrooms++;
      break;
    }
  });

  // ---- meshes
  const group = new THREE.Group();
  group.name = 'props';
  const ramp = makeToonGradient(TOON_WOOD);
  const mat = applyVegShader(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: ramp }), { flutter: 0.4 });
  mat.name = 'props';
  const mesh = new THREE.Mesh(b.toGeometry(), mat);
  mesh.name = 'props-static';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  // the field table, standing or knocked over on its side (the ibises' raid in the
  // story's opening): turned about the long edge of its feet, a little askew
  const tablePivot = new THREE.Group();
  tablePivot.name = 'props-table';
  tablePivot.position.set(S.table.x, ground(S.table.x, S.table.z), S.table.z);
  tablePivot.rotation.y = S.table.rot;
  const tableTip = new THREE.Group();
  const tableMesh = new THREE.Mesh(tableB.toGeometry(), mat);
  tableMesh.name = 'props-table-mesh';
  tableMesh.castShadow = true;
  tableMesh.receiveShadow = true;
  tableTip.add(tableMesh);
  tablePivot.add(tableTip);
  group.add(tablePivot);
  // knocked over it turns a little and falls north, onto the open grass of the landing
  const TIP = { side: 1, angle: 1.6, yaw: 1.35, edge: 0.3 };
  const table = {
    group: tablePivot,
    tip: 0,
    TIP,
    // where the fallen top lies (x, z), for a collider while it is down
    fallen() {
      const a = S.table.rot + TIP.yaw, d = TIP.edge + 0.72;
      return { x: S.table.x + Math.cos(a) * d * TIP.side, z: S.table.z - Math.sin(a) * d * TIP.side };
    },
    // k: 0 standing, 1 on its side
    setTip(k) {
      k = Math.max(0, Math.min(1.2, k));
      table.tip = k;
      tableTip.position.set(TIP.side * TIP.edge, 0, 0);
      tableMesh.position.set(-TIP.side * TIP.edge, 0, 0);
      tableTip.rotation.z = -TIP.side * TIP.angle * k;
      tablePivot.rotation.y = S.table.rot + TIP.yaw * Math.min(1, k);
    },
  };
  table.setTip(0);

  // the sign's two faces share one texture, one half each, so they cost one draw call
  if (typeof document !== 'undefined') {
    const front = signTexture('Lizard Island', true), back = signTexture('Field station', false, 1.18 / 0.9);
    const cv = document.createElement('canvas');
    cv.width = front.image.width;
    cv.height = front.image.height * 2;
    const g = cv.getContext('2d');
    g.drawImage(front.image, 0, 0);
    g.drawImage(back.image, 0, front.image.height);
    front.dispose();
    back.dispose();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const geo = new THREE.BufferGeometry();
    const pos = [], uv = [], idx = [];
    for (const [k, bd] of [[0, sign.board], [1, sign.back]]) {
      const cs = Math.cos(bd.face), sn = Math.sin(bd.face);
      const hw = bd.w / 2, hh = bd.h / 2;
      const base = pos.length / 3;
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        pos.push(bd.x + u * hw * cs, bd.y + v * hh, bd.z - u * hw * sn);
        uv.push((u + 1) / 2, k === 0 ? 0.5 + (v + 1) / 4 : (v + 1) / 4);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const face = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ map: tex, gradientMap: ramp }));
    face.name = 'props-sign';
    face.receiveShadow = true;
    group.add(face);
  }

  // the ibis
  const { body, head } = ibisParts();
  const bird = new THREE.Group();
  bird.name = 'props-ibis';
  const birdMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: makeToonGradient(TOON_LEAF) });
  const bodyMesh = new THREE.Mesh(body.toGeometry(), birdMat);
  const neck = new THREE.Group();
  const headMesh = new THREE.Mesh(head.toGeometry(), birdMat);
  neck.position.set(0.19, 0.56, 0);
  neck.add(headMesh);
  bird.add(bodyMesh, neck);
  bird.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const bed = Math.min(-0.05, ground(S.ibis.x, S.ibis.z));
  const home = new THREE.Vector3(S.ibis.x, bed, S.ibis.z);
  bird.position.copy(home);
  bird.rotation.y = S.ibis.heading;
  bird.scale.setScalar(1.25);
  group.add(bird);

  const fwd = new THREE.Vector3();
  return {
    group,
    colliders,
    sign: sign.board,
    table, // table.setTip(k): 0 standing, 1 knocked over
    stats,
    update(dt, t) {
      // wade a slow step or two along a short line, then stop to probe the mud
      const cycle = t % 9;
      const walk = Math.sin((t / 9) * TAU) * 0.6;
      fwd.set(Math.cos(S.ibis.heading), 0, -Math.sin(S.ibis.heading));
      bird.position.set(home.x + fwd.x * walk, home.y + (cycle < 4 ? 0.012 * Math.sin(t * 7) : 0), home.z + fwd.z * walk);
      const dip = cycle > 5 && cycle < 8 ? Math.min(1, (cycle - 5) * 3, (8 - cycle) * 3) : 0;
      neck.rotation.z = -1.25 * dip + 0.05 * Math.sin(t * 2.3);
    },
  };
}
