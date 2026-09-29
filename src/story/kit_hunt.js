// The opening's kit hunt: the ibises raided the field station overnight. The table is
// knocked over (the props' own table mesh, props.table.setTip), muddy three-toed
// prints run round it, a feather or two and the spilled jars and clipboard lie on the
// grass, and five pieces of kit are scattered round the island: the loop pole, the
// field notebook, the bags, the ruler and scales (each out in the open by a landmark,
// sparkling gently) and the paint pens, which an ibis has in its bill.
//
//   const hunt = buildKitHunt(game);  scene.add(hunt.group);  hunt.update(dt, t)
//   hunt.reset()             the raided station and every piece of kit back out
//   hunt.restore(ids)        from a save: those already found are put away
//   hunt.live(on)            pickups, sparkles and the maps' search circles on or off
//   hunt.found(id), hunt.count, hunt.left()
//   hunt.ibisSpot(from)      where the ibis comes down: on the way back to the station, 10 to 25 m off
//   hunt.callIbis(from, { spot, via })  the ibis flies in with the pens (from behind via, a lens)
//   hunt.tidy(k)             the table stood up (0) or on its side (1); hunt.messShown(on, spilled)
//   events: kit:found { id, n, total, x, z }, ibis:arrive, ibis:flutter { n }, ibis:drop { gaveUp }
//
// Draw calls: the scattered kit one (only while some is still out), the mess one (the
// opening only) and the ibis one (while it is about). All three share one small toon
// shader in which each part (an item, its shadow, the ibis's head or a wing) has its
// own matrix, so they move and hide without new geometry; none casts a shadow (each
// item and the ibis carry a soft disc of their own).

import * as THREE from 'three';
import { MeshBuilder, blob, tube, lin, tint, bezier } from '../world/models.js';
import { toonGradient } from '../player/avatar.js';
import { events } from '../core/events.js';
import { state, GAME_FLAGS } from '../game/state.js';
import * as kit from '../ui/kit.js';
import { registerInteraction } from '../tools/ring.js';
import { SCRIPT, say } from './script.js';
import { el } from './style.js';
import { richText, escapeHtml } from '../ui/icons.js';
import { TABLE, NOTEBOOK_COVER } from './station.js';

// Where each piece lies: in the open by a landmark, a few metres off a path (checked
// against the collision circles, the drawn leaves, thicket and water by a scripted test).
export const KIT = [
  // the lawn at the top of the causeway, out from under the talipots' fans (seen straight
  // up the causeway, the follow camera clear of them)
  { id: 'loop_pole', x: -14.7, z: 17.6, yaw: 0.95, where: 'lawn' },
  { id: 'notebook', x: -25.8, z: -0.2, yaw: -0.5, where: 'rainbow' }, // under a rainbow eucalyptus
  { id: 'bags', x: -20.7, z: -7.2, yaw: 2.2, where: 'talipots' }, // by the talipots
  { id: 'scales', x: 54.15, z: -19.5, yaw: 0.35, where: 'osprey' }, // under the osprey pole
  { id: 'pens', x: 0, z: 0, yaw: 0, where: 'ibis', ibis: true }, // in the ibis's bill
];
export const KIT_IDS = KIT.map((k) => k.id);
// Where the ibis may come down with the pens (open lawn with room to flutter): one on the
// way from the player back to the station, 10 to 25 m off, is used. (Each checked by a
// scripted test for open, free ground round it; the last two are the causeway's lawn and
// its garden end, for a hunt that ends at the top of the causeway.)
const IBIS_SPOTS = [[-17.8, 12.2], [-24, 6], [10, 0], [45, -8], [5, -22], [-28, -6.2], [14, -11], [-12.8, 20.2], [-12, 38.2]];
export const HUNT = {
  pick: 1.25, // metres: walking this close picks a piece up
  reach: 2.4, // and [E] from this far
  sparkEvery: 0.6, sparkRange: 48,
  circle: 7.5, circleOff: 2.8, // the maps' search circle: its radius and how far its centre sits off the piece
  // sneak: no faster than this (m/s; the creep is 0.9) counts as creeping, so letting go of
  // Ctrl while still slowing to a stop beside it is not a walk at it
  ibis: { spook: 4.3, spookJog: 6.5, drop: 2.0, flutters: 3, hop: [3.4, 4.6], roam: 9, scale: 1.3, sneak: 1.1 },
};
const NP = 10; // parts per mesh in the shared shader (one program for all three)
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

// ---------------------------------------------------------------- the shared shader

function partMaterial() {
  const mats = [];
  for (let i = 0; i < NP; i++) mats.push(new THREE.Matrix4());
  const glow = new Float32Array(NP);
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uPart = { value: mats };
    sh.uniforms.uGlow = { value: glow };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aPart;\nuniform mat4 uPart[${NP}];\nuniform float uGlow[${NP}];\nvarying float vGlow;`)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nint pi = int(aPart + 0.5);\nmat4 pm = uPart[pi];\nobjectNormal = mat3(pm) * objectNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = (pm * vec4(transformed, 1.0)).xyz;\nvGlow = uGlow[pi];');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb += vGlow * vec3(1.0, 0.82, 0.42);');
  };
  mat.customProgramCacheKey = () => 'story-parts-' + NP;
  return { mat, mats, glow };
}

// A builder that remembers which part each vertex belongs to.
class Parts extends MeshBuilder {
  constructor() { super(); this.sway = 0; this.part = []; this.cur = 0; }
  set(i) { this.flush(); this.cur = i; return this; }
  flush() { const n = this.p.length / 3; while (this.part.length < n) this.part.push(this.cur); }
  geometry() {
    this.flush();
    const g = this.toGeometry();
    g.deleteAttribute('aSway');
    g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(this.part), 1));
    return g;
  }
}

// A box centred at c with half sizes h, turned by yaw (about y) then roll (about its
// own x); faces shaded so it reads without textures.
function box(b, c, h, col, yaw = 0, roll = 0) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll);
  const P = (x, y, z) => {
    const y1 = y * cr - z * sr, z1 = y * sr + z * cr;
    return [c[0] + x * cy + z1 * sy, c[1] + y1, c[2] - x * sy + z1 * cy];
  };
  const [hx, hy, hz] = h;
  const v = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz), P(-hx, hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), P(-hx, hy, hz)];
  b.quad(v[4], v[7], v[6], v[5], col);
  b.quad(v[3], v[2], v[6], v[7], tint(col, 0.88));
  b.quad(v[1], v[0], v[4], v[5], tint(col, 0.84));
  b.quad(v[2], v[1], v[5], v[6], tint(col, 0.8));
  b.quad(v[0], v[3], v[7], v[4], tint(col, 0.8));
  b.quad(v[0], v[1], v[2], v[3], tint(col, 0.7));
}
// A flat disc on the ground (a soft shadow or a mud smear), as a fan of triangles.
function disc(b, x, y, z, rx, rz, col, yaw = 0, n = 14) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
    const p = (a) => { const u = Math.cos(a) * rx, v = Math.sin(a) * rz; return [x + u * cy + v * sy, y, z - u * sy + v * cy]; };
    b.tri([x, y, z], p(a1), p(a0), col);
  }
}
const C = {
  bamboo: lin('#e3bf73'), node: lin('#b8914e'), grip: lin('#4a3b35'), floss: lin('#ff6f61'),
  cover: lin(NOTEBOOK_COVER), pages: lin('#fff6de'), band: lin('#5a4a3c'), sticker: lin('#7fd35a'), pencil: lin('#ffd84a'), rubber: lin('#ff9ab0'),
  pouch: lin('#ead3a2'), string: lin('#ff6f61'), bag: lin('#d4f0ff'), bag2: lin('#bfe6fb'), tie: lin('#ff6f61'),
  ruler: lin('#ffd24a'), tick: lin('#5a4a38'), scale: lin('#62d26f'), scaleDark: lin('#3f8f4c'), metal: lin('#b9c2c8'),
  penA: lin('#ff4fa3'), penB: lin('#3ec7ff'), penC: lin('#ffb52e'), cap: lin('#fff8ec'), rband: lin('#8a5a3c'),
  shadow: lin('#3f6b36'), glowDisc: lin('#e9e27a'), glowCore: lin('#fff6c2'), mud: lin('#6e4a31'), mudWet: lin('#7a573c'), feather: lin('#fbfaf4'), featherTip: lin('#2e2f3a'),
  jar: lin('#bfe6ef'), lid: lin('#ff8a5c'), lid2: lin('#6fc3d9'), clip: lin('#8a5a3c'), paper: lin('#fffaf0'), ink: lin('#7b8aa0'),
  white: lin('#fcfbf6'), shade: lin('#efebe0'), ibisShadow: lin('#4f7c45'), tipSoft: lin('#5b5d68'), tip: lin('#2e2f3a'), bill: lin('#ff8a5c'), face: lin('#ff7b6b'), leg: lin('#ff9f84'), eye: lin('#2b2b33'),
};

// ---------------------------------------------------------------- the pieces

// Each is built round the origin, lying on the ground (y 0), about twice its real size
// so it reads from the path.
function loopPoleModel(b) {
  const L = 2.5, pts = [];
  for (let k = 0; k <= 10; k++) { const u = k / 10; pts.push([-L / 2 + L * u, 0.045 + 0.09 * u * u, 0]); }
  tube(b, pts, pts.map(() => 0.028), { sides: 6, smooth: true, color: C.bamboo, capEnd: true, capStart: true, radiusScale: 1 });
  for (let k = 1; k < 7; k++) {
    const u = k / 7, x = -L / 2 + L * u, y = 0.045 + 0.09 * u * u;
    tube(b, [[x - 0.018, y, 0], [x + 0.018, y, 0]], [0.034, 0.034], { sides: 6, color: C.node, radiusScale: 1 });
  }
  tube(b, [[-L / 2, 0.045, 0], [-L / 2 + 0.34, 0.047, 0]], [0.036, 0.036], { sides: 6, color: C.grip, capStart: true, radiusScale: 1 });
  // the old floss loop at the tip, lying open on the grass
  const ring = [];
  for (let k = 0; k <= 16; k++) { const a = (k / 16) * Math.PI * 2; ring.push([L / 2 + 0.1 + Math.cos(a) * 0.1, 0.03 + 0.03 * Math.sin(a * 0.5), Math.sin(a) * 0.1]); }
  tube(b, ring, ring.map(() => 0.012), { sides: 4, color: C.floss, radiusScale: 1 });
  tube(b, [[L / 2, 0.135, 0], [L / 2 + 0.02, 0.05, 0.01]], [0.01, 0.01], { sides: 4, color: C.floss, radiusScale: 1 });
}
function notebookModel(b) {
  box(b, [0, 0.036, 0], [0.19, 0.036, 0.25], C.cover);
  box(b, [0.012, 0.037, 0], [0.18, 0.03, 0.238], C.pages);
  box(b, [0, 0.073, 0], [0.19, 0.004, 0.25], C.cover); // the top cover over the pages
  box(b, [0.12, 0.04, 0], [0.012, 0.041, 0.252], C.band); // the elastic band
  blob(b, { c: [-0.05, 0.08, -0.06], r: [0.07, 0.008, 0.045], detail: 1, seed: 3, jit: 0, color: C.sticker, tone: false, shade: [1, 1] });
  blob(b, { c: [-0.02, 0.08, -0.03], r: [0.028, 0.008, 0.026], detail: 0, seed: 4, jit: 0, color: C.sticker, tone: false, shade: [1, 1] });
  // a pencil beside it
  tube(b, [[0.26, 0.018, -0.2], [0.3, 0.018, 0.18]], [0.016, 0.016], { sides: 6, color: C.pencil, capStart: true, radiusScale: 1 });
  tube(b, [[0.3, 0.018, 0.18], [0.305, 0.018, 0.22]], [0.016, 0.017], { sides: 6, color: C.rubber, capEnd: true, radiusScale: 1 });
}
function bagsModel(b) {
  blob(b, { c: [0, 0.12, 0], r: [0.17, 0.13, 0.15], detail: 1, seed: 11, jit: 0.06, color: C.pouch, shade: [0.8, 1.08], smooth: 0.8, flat: -0.5 });
  blob(b, { c: [0, 0.25, 0], r: [0.08, 0.05, 0.07], detail: 1, seed: 12, jit: 0.05, color: tint(C.pouch, 0.94), shade: [0.85, 1.05], smooth: 0.7 });
  const s = bezier([0.02, 0.25, 0.06], [0.12, 0.2, 0.2], [0.18, 0.02, 0.28], 6);
  tube(b, s, s.map(() => 0.012), { sides: 4, color: C.string, radiusScale: 1 });
  // the clear bags spilled out, fanned on the grass, each with its twist tie
  [[0.34, 0.1, 0.3, C.bag], [0.36, -0.14, -0.25, C.bag2], [0.12, -0.3, 0.9, C.bag]].forEach(([x, z, yaw, col], k) => {
    box(b, [x, 0.012 + k * 0.006, z], [0.15, 0.008, 0.2], col, yaw);
    const tx = x + Math.sin(yaw) * 0.19, tz = z + Math.cos(yaw) * 0.19;
    box(b, [tx, 0.024 + k * 0.006, tz], [0.05, 0.012, 0.02], C.tie, yaw);
  });
}
function scalesModel(b) {
  box(b, [0, 0.016, 0], [0.34, 0.016, 0.055], C.ruler, 0.2);
  for (let k = 0; k <= 12; k++) {
    const u = -0.3 + k * 0.05, big = k % 2 === 0;
    box(b, [u * Math.cos(0.2) + 0.03 * Math.sin(0.2), 0.034, -u * Math.sin(0.2) + 0.03 * Math.cos(0.2)], [0.005, 0.003, big ? 0.028 : 0.016], C.tick, 0.2);
  }
  // the spring scale lying across it: green barrel, dark cap, metal hook and ring
  tube(b, [[-0.08, 0.06, -0.22], [0.02, 0.06, 0.12]], [0.052, 0.052], { sides: 8, smooth: true, color: C.scale, capStart: true, capEnd: true, radiusScale: 1 });
  tube(b, [[-0.1, 0.06, -0.29], [-0.08, 0.06, -0.22]], [0.056, 0.056], { sides: 8, color: C.scaleDark, capStart: true, radiusScale: 1 });
  for (let k = 0; k < 4; k++) box(b, [-0.05 + k * 0.022, 0.108, -0.1 + k * 0.07], [0.02, 0.003, 0.004], lin('#ffffff'), -0.28);
  const hook = bezier([0.02, 0.06, 0.12], [0.05, 0.06, 0.22], [0.0, 0.05, 0.25], 5);
  tube(b, hook, hook.map(() => 0.009), { sides: 4, color: C.metal, radiusScale: 1 });
  const ring = [];
  for (let k = 0; k <= 12; k++) { const a = (k / 12) * Math.PI * 2; ring.push([-0.12 + Math.cos(a) * 0.035, 0.03, -0.32 + Math.sin(a) * 0.035]); }
  tube(b, ring, ring.map(() => 0.007), { sides: 4, color: C.metal, radiusScale: 1 });
}
// The paint pens, a bundle of three with a rubber band, along z (so the ibis holds it
// crosswise in its bill).
function pensModel(b, lift = 0.03) {
  [[C.penA, 0, 0], [C.penB, 0.052, 0.006], [C.penC, 0.026, 0.045]].forEach(([col, dx, dy]) => {
    tube(b, [[dx - 0.026, lift + dy, -0.13], [dx - 0.026, lift + dy, 0.09]], [0.027, 0.027], { sides: 7, smooth: true, color: col, capStart: true, radiusScale: 1 });
    tube(b, [[dx - 0.026, lift + dy, 0.09], [dx - 0.026, lift + dy, 0.15]], [0.029, 0.026], { sides: 7, smooth: true, color: C.cap, capEnd: true, radiusScale: 1 });
  });
  box(b, [0, lift + 0.022, -0.02], [0.06, 0.05, 0.012], C.rband);
}
const SHADOWS = { loop_pole: [1.35, 0.17], notebook: [0.26, 0.31], bags: [0.42, 0.36], scales: [0.4, 0.2], pens: [0.14, 0.2] };
const MODELS = { loop_pole: loopPoleModel, notebook: notebookModel, bags: bagsModel, scales: scalesModel, pens: (b) => pensModel(b) };

// ---------------------------------------------------------------- the ibis

// A white ibis (after the props' wading one, src/world/props.js) with its head and
// wings as parts of their own, so it can peck, look round and flutter, and the paint
// pens in its bill. Bird space: forward +x, up +y; about 0.7 m tall at 1x.
const IB = { neck: [0.19, 0.56, 0], shoulder: [0.06, 0.6, 0.085], hold: [0.47, 0.772] };
function ibisModel(b) {
  const part = (c, r, col, seed, detail = 1) => blob(b, { c, r, detail, seed, jit: 0.02, rot: 0, color: col, shade: [0.8, 1.06], tone: false, smooth: 0.85 });
  b.set(0);
  part([0, 0.52, 0], [0.24, 0.13, 0.12], C.white, 1);
  part([-0.2, 0.5, 0], [0.12, 0.07, 0.08], C.shade, 2);
  part([-0.28, 0.505, 0], [0.05, 0.022, 0.045], C.tipSoft, 3, 1);
  for (const s of [-1, 1]) {
    tube(b, [[0.02, 0.44, s * 0.05], [0.0, 0.25, s * 0.055], [0.02, 0.02, s * 0.06]], [0.013, 0.011, 0.01], { sides: 4, color: C.leg, radiusScale: 1 });
    for (const a of [-0.5, 0, 0.5]) tube(b, [[0.02, 0.02, s * 0.06], [0.02 + Math.cos(a) * 0.07, 0.01, s * 0.06 + Math.sin(a) * 0.07]], [0.008, 0.006], { sides: 3, color: C.leg, radiusScale: 1 });
  }
  // neck, head and the long curved bill (part 1, turning about the base of the neck)
  b.set(1);
  const [nx, ny] = IB.neck;
  const neck = bezier([nx, ny, 0], [nx + 0.1, ny + 0.12, 0], [nx + 0.12, ny + 0.26, 0], 5);
  tube(b, neck, neck.map((_, k) => 0.045 - k * 0.004), { sides: 6, smooth: true, color: C.white });
  part([nx + 0.14, ny + 0.28, 0], [0.06, 0.05, 0.045], C.white, 7);
  part([nx + 0.18, ny + 0.27, 0], [0.035, 0.03, 0.033], C.face, 8);
  for (const s of [-1, 1]) part([nx + 0.16, ny + 0.295, s * 0.036], [0.008, 0.008, 0.005], C.eye, 9, 0);
  const bp = bezier([nx + 0.2, ny + 0.27, 0], [nx + 0.3, ny + 0.26, 0], [nx + 0.37, ny + 0.15, 0], 6);
  tube(b, bp, bp.map((_, k) => 0.016 - k * 0.0022), { sides: 5, smooth: true, color: C.bill, capEnd: true, radiusScale: 1 });
  // the wings (parts 2 and 3), folded along the body, black at the tips
  for (const [pi, s] of [[2, -1], [3, 1]]) {
    b.set(pi);
    blob(b, { c: [-0.07, 0.565, s * 0.098], r: [0.2, 0.075, 0.035], detail: 1, seed: 4 + pi, jit: 0.02, rot: 0, color: C.shade, shade: [0.82, 1.06], tone: false, smooth: 0.85 });
  }
  // the pens in its bill (part 4), crosswise, and its soft shadow (part 5)
  b.set(4);
  const pb = new Parts();
  pensModel(pb, 0);
  const [bx, by] = IB.hold;
  for (let i = 0; i < pb.p.length; i += 3) { b.p.push(pb.p[i] * 0.5 + bx, pb.p[i + 1] * 0.5 + by, pb.p[i + 2] * 0.5); }
  for (let i = 0; i < pb.n.length; i++) b.n.push(pb.n[i]);
  for (let i = 0; i < pb.c.length; i++) b.c.push(pb.c[i]);
  for (let i = 0; i < pb.s.length; i++) b.s.push(0);
  b.set(5);
  disc(b, 0.02, 0.012, 0, 0.21, 0.12, C.ibisShadow, 0, 16);
}

// ---------------------------------------------------------------- the mess

// Muddy prints round the table and off towards the causeway, a feather or two, and
// (part 1) the jars and clipboard knocked off the table.
function messModel(b, ground) {
  b.set(0);
  const print = (x, z, h, k = 1) => {
    const y = ground(x, z) + 0.014, fx = -Math.sin(h), fz = -Math.cos(h), rx = -fz, rz = fx;
    const s = 0.14 * k;
    for (const a of [-0.6, 0, 0.6]) {
      const dx = fx * Math.cos(a) + rx * Math.sin(a), dz = fz * Math.cos(a) + rz * Math.sin(a);
      const w = 0.022 * k;
      b.tri2([x - rx * w, y, z - rz * w], [x + dx * s, y, z + dz * s], [x + rx * w, y, z + rz * w], C.mud);
    }
    b.tri2([x - rx * 0.022, y, z - rz * 0.022], [x + rx * 0.022, y, z + rz * 0.022], [x - fx * 0.07 * k, y, z - fz * 0.07 * k], C.mud);
  };
  // two birds' wandering tracks from the table out along the sandy path to the
  // causeway (on the path they show; the grass would hide them)
  const tracks = [
    [[-13.0, 44.4], [-12.6, 43.6], [-11.9, 43.1], [-11.3, 42.7], [-11.2, 41.8], [-11.25, 40.8], [-11.5, 39.6], [-11.9, 38.4]],
    [[-13.9, 43.2], [-13.2, 42.4], [-12.3, 41.9], [-11.7, 41.3], [-11.6, 40.3], [-11.95, 39.2], [-12.2, 37.9]],
  ];
  for (const tr of tracks) {
    for (let i = 0; i < tr.length - 1; i++) {
      const [x0, z0] = tr[i], [x1, z1] = tr[i + 1];
      const h = Math.atan2(-(x1 - x0), -(z1 - z0)), d = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(d / 0.3));
      for (let k = 0; k < n; k++) {
        const u = k / n, side = (i * 7 + k) % 2 ? 0.06 : -0.06;
        const x = x0 + (x1 - x0) * u + Math.cos(h) * side, z = z0 + (z1 - z0) * u - Math.sin(h) * side;
        print(x, z, h, 1);
      }
    }
  }
  // mud smears by the table
  for (const [dx, dz, rx, rz, yaw] of [[0.6, -0.45, 0.14, 0.07, 0.6], [0.78, -0.3, 0.07, 0.05, 0.1], [0.25, 0.8, 0.1, 0.06, -0.4], [-0.5, -1.2, 0.09, 0.05, 1.1]]) {
    disc(b, TABLE.x + dx, ground(TABLE.x + dx, TABLE.z + dz) + 0.011, TABLE.z + dz, rx, rz, C.mudWet, yaw, 9);
  }
  // feathers
  const feather = (x, z, yaw, len, tipped) => {
    const y = ground(x, z) + 0.02, c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (u, v) => [x + u * c + v * s, y + 0.01 * Math.sin(u * 3), z - u * s + v * c];
    const w = len * 0.2;
    b.quad2(P(-len / 2, 0), P(0, -w), P(len / 2, 0), P(0, w), C.feather);
    if (tipped) b.quad2(P(len * 0.2, -w * 0.55), P(len / 2, 0), P(len / 2, 0), P(len * 0.2, w * 0.55), C.featherTip);
    tube(b, [P(-len * 0.6, 0), P(len * 0.5, 0)], [0.004, 0.003], { sides: 3, color: C.shade, radiusScale: 1 });
  };
  feather(-12.35, 43.55, 0.8, 0.26, true);
  feather(-12.55, 42.35, -0.6, 0.22, false);
  feather(-13.95, 44.95, 2.1, 0.24, true);
  // the spilled things (part 1): two jars on their sides, a lid, the clipboard and papers
  b.set(1);
  const g = (x, z) => ground(x, z);
  const jar = (x, z, yaw, r, len, lid) => {
    const y = g(x, z) + r, c = Math.cos(yaw), s = Math.sin(yaw);
    tube(b, [[x - c * len / 2, y, z + s * len / 2], [x + c * len / 2, y, z - s * len / 2]], [r, r], { sides: 10, smooth: true, color: C.jar, capStart: true, capEnd: true, radiusScale: 1 });
    if (lid) tube(b, [[x + c * len / 2, y, z - s * len / 2], [x + c * (len / 2 + 0.03), y, z - s * (len / 2 + 0.03)]], [r * 1.08, r * 1.08], { sides: 10, color: lid, capEnd: true, radiusScale: 1 });
  };
  // (the table fell north, so what was on it slid off that way)
  const X = TABLE.x, Z = TABLE.z;
  jar(X - 0.4, Z - 1.4, 0.4, 0.05, 0.13, C.lid);
  jar(X + 0.6, Z - 1.6, -1.1, 0.043, 0.11, null);
  disc(b, X + 0.98, g(X + 0.98, Z - 1.3) + 0.03, Z - 1.3, 0.05, 0.05, C.lid2, 0, 10);
  box(b, [X + 0.8, g(X + 0.8, Z - 0.8) + 0.008, Z - 0.8], [0.12, 0.007, 0.16], C.clip, 0.5);
  box(b, [X + 0.8, g(X + 0.8, Z - 0.8) + 0.017, Z - 0.8], [0.1, 0.003, 0.135], C.paper, 0.5);
  box(b, [X + 1.25, g(X + 1.25, Z - 1.15) + 0.006, Z - 1.15], [0.1, 0.003, 0.135], C.paper, -0.3);
  box(b, [X - 0.85, g(X - 0.85, Z - 1.7) + 0.006, Z - 1.7], [0.1, 0.003, 0.135], C.paper, 1.2);
  for (let k = 0; k < 4; k++) box(b, [X + 1.25 - 0.06 + k * 0.035, g(X + 1.25, Z - 1.15) + 0.009, Z - 1.15], [0.004, 0.001, 0.09], C.ink, -0.3);
}

// ---------------------------------------------------------------- the system

let styled = false;
function ensureOpeningStyle() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./opening.css', import.meta.url).href;
  document.head.appendChild(link);
}

export function buildKitHunt(game) {
  ensureOpeningStyle();
  const { player, collision: col } = game;
  const T = game.data.terrain;
  const ground = (x, z) => Math.max(0, T.heightAt(x, z));
  const group = new THREE.Group();
  group.name = 'kit-hunt';

  // where the pieces lie, nudged onto free ground if the colliders ever moved
  const items = KIT.map((k, i) => {
    let x = k.x, z = k.z;
    if (!k.ibis && col && !col.isFree(x, z, 0.5) && col.nearestFree) { const f = col.nearestFree(x, z, 3); if (f) { x = f.x; z = f.z; } }
    // the search circle's centre sits off the piece in a fixed direction of its own
    const a = (i * 2.399 + 0.7) % (Math.PI * 2);
    return {
      ...k, i, x, z, y: ground(x, z), found: false, out: !k.ibis, pop: -1, spark: 0.2 * i, marker: null,
      cx: x + Math.cos(a) * HUNT.circleOff, cz: z + Math.sin(a) * HUNT.circleOff,
    };
  });
  const byId = new Map(items.map((it) => [it.id, it]));

  // the scattered kit: parts 0..4 the pieces, 5..9 their shadows
  const kb = new Parts();
  items.forEach((it) => { kb.set(it.i); MODELS[it.id](kb); });
  // under each a soft glowing patch (brighter as it pulses), so it shows through the grass
  items.forEach((it) => { kb.set(5 + it.i); const [rx, rz] = SHADOWS[it.id]; disc(kb, 0, 0.02, 0, rx * 1.25, rz * 1.35 + 0.08, C.glowDisc, 0, 18); disc(kb, 0, 0.024, 0, rx * 0.8, rz * 0.9 + 0.04, C.glowCore, 0, 18); });
  const kitM = partMaterial();
  const kitMesh = new THREE.Mesh(kb.geometry(), kitM.mat);
  kitMesh.name = 'kit-hunt-items';
  kitMesh.frustumCulled = false;
  kitMesh.receiveShadow = true;
  group.add(kitMesh);

  // the mess round the station
  const mb = new Parts();
  messModel(mb, ground);
  const messM = partMaterial();
  const messMesh = new THREE.Mesh(mb.geometry(), messM.mat);
  messMesh.name = 'kit-hunt-mess';
  messMesh.frustumCulled = false;
  messMesh.receiveShadow = true;
  group.add(messMesh);

  // the ibis
  const ib = new Parts();
  ibisModel(ib);
  const ibisM = partMaterial();
  const ibisMesh = new THREE.Mesh(ib.geometry(), ibisM.mat);
  ibisMesh.name = 'kit-hunt-ibis';
  ibisMesh.frustumCulled = false;
  ibisMesh.receiveShadow = true;
  ibisMesh.scale.setScalar(HUNT.ibis.scale);
  ibisMesh.visible = false;
  group.add(ibisMesh);

  const props = game.props || (game.veg && game.veg.props) || null;
  const table = props && props.table ? props.table : null;

  // ---- the state
  const H = {
    live: false, // pickups, sparkles and circles
    tip: 1, tipTo: 1, // the table: 1 on its side, 0 standing
    spilled: true,
  };
  const ibis = {
    state: 'away', x: 0, z: 0, y: 0, h: 0, t: 0, spot: null, flutters: 0, gaveUp: false,
    fromX: 0, fromZ: 0, fromY: 0, toX: 0, toZ: 0, dur: 0, hop: 0, flap: 0, spread: 0, neck: 0, look: 0, peckT: 2, cool: 0, holding: true, marker: null, told: false,
  };

  function reset() {
    for (const it of items) {
      it.found = false;
      it.out = !it.ibis;
      it.pop = -1;
      if (it.ibis) { it.x = 0; it.z = 0; }
    }
    ibisAway();
    H.tip = H.tipTo = 1;
    messShown(true, true);
    applyTable();
  }
  function restore(ids = []) {
    for (const it of items) {
      if (!ids.includes(it.id)) continue;
      it.found = true; it.out = false; it.pop = -1;
    }
  }
  function messShown(on, spilled = H.spilled) {
    messMesh.visible = !!on;
    H.spilled = !!spilled;
  }
  function tidy(k, animate = false) {
    H.tipTo = k;
    if (!animate) H.tip = k;
    applyTable();
  }
  // the fallen table top is solid while it lies on the grass
  let tableCol = null;
  function applyTable() {
    if (!table) return;
    table.setTip(H.tip);
    const down = H.tip > 0.5 && table.fallen && col && col.addDynamic;
    if (down && tableCol == null) { const f = table.fallen(); tableCol = col.addDynamic(f.x, f.z, 0.36); } else if (!down && tableCol != null) { col.removeDynamic(tableCol); tableCol = null; }
  }

  // ---- the maps' search circles
  const maps = () => (game.ui && game.ui.maps) || null;
  function markersOn(on) {
    const M = maps();
    for (const it of items) {
      const want = on && it.out && !it.found && !it.ibis;
      if (want && !it.marker && M && M.addMarker) {
        it.mark = { x: it.cx, z: it.cz, radius: HUNT.circle, colour: '#f5b82e', label: SCRIPT.hunt.items[it.id].name };
        it.marker = M.addMarker(it.mark);
      } else if (!want && it.marker) { it.marker(); it.marker = null; }
    }
    const wantIbis = on && ibis.state !== 'away' && ibis.state !== 'leave' && ibis.holding;
    if (wantIbis && !ibis.marker && M && M.addMarker) {
      ibis.mark = { x: ibis.x, z: ibis.z, radius: 4.5, pulse: true, colour: '#ff8a5c', label: SCRIPT.hunt.ibisLabel };
      ibis.marker = M.addMarker(ibis.mark);
    } else if (!wantIbis && ibis.marker) { ibis.marker(); ibis.marker = null; }
  }
  function live(on) {
    H.live = !!on;
    markersOn(H.live);
  }

  // ---- picking up
  const count = () => items.reduce((n, it) => n + (it.found ? 1 : 0), 0);
  const left = () => items.filter((it) => !it.found).map((it) => it.id);
  let pickBusy = 0;
  function pickUp(it) {
    if (!it || it.found || !it.out) return;
    if (it.ibis && ibis.state === 'drop') return; // (not out of its bill until it has turned away)
    it.found = true;
    it.out = false;
    it.pop = 0;
    pickBusy = 0.4;
    const n = count();
    if (game.fx && game.fx.burst) game.fx.burst('sparkle', it.x, it.y + 0.35, it.z, 14);
    const A = game.audio;
    if (A && A.cue) A.cue('kitFound', n, n >= items.length);
    card(it, n);
    markersOn(H.live);
    events.emit('kit:found', { id: it.id, n, total: items.length, x: it.x, z: it.z });
  }
  const pickOffer = { score: 7, prompt: '', run: null };
  let offerIt = null;
  registerInteraction({
    id: 'kit-pickup',
    check() {
      if (!H.live || state.phase !== 'setup') return null;
      const p = player.position;
      let best = null, bd = HUNT.reach;
      for (const it of items) {
        if (!it.out || it.found || (it.ibis && ibis.state === 'drop')) continue;
        const d = Math.hypot(it.x - p.x, it.z - p.z);
        if (d < bd) { bd = d; best = it; }
      }
      if (!best) return null;
      offerIt = best;
      pickOffer.prompt = say(SCRIPT.hunt.pickPrompt, { item: SCRIPT.hunt.items[best.id].phrase });
      pickOffer.run = () => pickUp(offerIt);
      return pickOffer;
    },
  });

  // ---- the pop-up card: what the piece is for, in one line
  let cardEl = null, cardT = null;
  function card(it, n) {
    const I = SCRIPT.hunt.items[it.id];
    if (!I) return;
    if (!cardEl) {
      cardEl = el('div', 'kh-card');
      (document.getElementById('ui') || document.body).appendChild(cardEl);
    }
    const pips = items.map((x, k) => `<i class="${k < n ? 'is-on' : ''}"></i>`).join('');
    cardEl.innerHTML = `<div class="kh-card-art">${ART[it.id] || ''}</div><div class="kh-card-text"><small>${say(SCRIPT.hunt.foundTitle, { n, total: items.length })}</small>` +
      `<b>${escapeHtml(I.name)}</b><span>${richText(I.line)}</span><div class="kh-card-pips">${pips}</div></div>`;
    cardEl.classList.remove('is-on');
    void cardEl.offsetWidth;
    cardEl.classList.add('is-on');
    clearTimeout(cardT);
    if (!cardHeld) cardT = setTimeout(() => { if (cardEl) cardEl.classList.remove('is-on'); }, 3600);
  }
  let cardHeld = false; // (check images: the card stays up)
  function hideCard() { clearTimeout(cardT); if (cardEl) cardEl.classList.remove('is-on'); }
  // a talk or a panel (the notebook's cover) takes the card's place
  events.on('dialogue:open', hideCard);
  events.on('panel:open', hideCard);

  // ---- the ibis
  function ibisAway() {
    ibis.state = 'away';
    ibis.holding = true;
    ibis.flutters = 0;
    ibis.gaveUp = false;
    ibisMesh.visible = false;
    markersOn(H.live);
  }
  // The landing spot: on the way from `from` back to the station (nearer home than the
  // player by a few metres), 10 m off or more and best about 17 m, so the player sees it
  // land and it is a stop on the way home, not a detour. With none on the way (the hunt
  // ended by the station), the nearest one 10 m off, the nearer home the better.
  function ibisSpot(from = player.position) {
    const st = { x: TABLE.x, z: TABLE.z + -2 };
    const dsP = Math.hypot(from.x - st.x, from.z - st.z);
    let best = null, bs = Infinity;
    for (const [x0, z0] of IBIS_SPOTS) {
      let x = x0, z = z0;
      if (col && !col.isFree(x, z, 0.5) && col.nearestFree) { const f = col.nearestFree(x, z, 3); if (!f) continue; x = f.x; z = f.z; }
      const dp = Math.hypot(x - from.x, z - from.z), ds = Math.hypot(x - st.x, z - st.z);
      if (dp < 10) continue;
      const onWay = ds < dsP - 3;
      const s = (onWay ? 0 : 200 + Math.max(0, ds - dsP) * 4) + Math.abs(dp - 17) + 0.25 * ds;
      if (s < bs) { bs = s; best = { x, z }; }
    }
    return best || { x: IBIS_SPOTS[1][0], z: IBIS_SPOTS[1][1] };
  }
  // Flies it in to `spot` (ibisSpot(from) by default) from high up behind `via` (a
  // camera watching it land), or else from behind the player, over their head.
  function callIbis(from = player.position, { spot = null, via = null } = {}) {
    const best = spot || ibisSpot(from);
    ibis.spot = best;
    const o = via || from;
    const ax = best.x - o.x, az = best.z - o.z, al = Math.hypot(ax, az) || 1;
    const back = via ? 7 : 5; // metres behind the lens (or the player) it starts from
    ibis.fromX = o.x - (ax / al) * back; ibis.fromZ = o.z - (az / al) * back; ibis.fromY = ground(best.x, best.z) + 8.5;
    ibis.toX = best.x; ibis.toZ = best.z;
    ibis.x = ibis.fromX; ibis.z = ibis.fromZ; ibis.y = ibis.fromY;
    ibis.h = Math.atan2(-(best.z - ibis.fromZ), best.x - ibis.fromX);
    // about 9 m/s, gliding in
    ibis.state = 'arrive'; ibis.t = 0; ibis.dur = Math.max(2.6, Math.min(4.6, (al + back) / 9));
    ibis.holding = true; ibis.flutters = 0; ibis.gaveUp = false; ibis.told = false;
    ibisMesh.visible = true;
    const pens = byId.get('pens');
    pens.out = false;
    markersOn(H.live);
    events.emit('ibis:arrive', { x: best.x, z: best.z });
    return best;
  }
  const faceTo = (x, z) => Math.atan2(-(z - ibis.z), x - ibis.x); // bird space forward +x under rotation.y
  function flutterFrom(px, pz) {
    const I = HUNT.ibis, away = Math.atan2(ibis.z - pz, ibis.x - px);
    const home = ibis.spot || { x: ibis.x, z: ibis.z };
    for (const da of [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.8, -1.8]) {
      for (const d of [I.hop[1], (I.hop[0] + I.hop[1]) / 2, I.hop[0]]) {
        const x = ibis.x + Math.cos(away + da) * d, z = ibis.z + Math.sin(away + da) * d;
        if (Math.hypot(x - home.x, z - home.z) > I.roam) continue;
        if (!T.isWalkable(x, z) || (col && !col.isFree(x, z, 0.35))) continue;
        if (Math.hypot(x - px, z - pz) < I.spook + 0.8) continue;
        ibis.fromX = ibis.x; ibis.fromZ = ibis.z; ibis.fromY = ibis.y;
        ibis.toX = x; ibis.toZ = z;
        ibis.state = 'flutter'; ibis.t = 0; ibis.dur = 0.85 + d * 0.06;
        ibis.h = faceTo(x, z);
        ibis.flutters++;
        const A = game.audio;
        if (A && A.cue) A.cue('ibis', ibis.x, ibis.z, 1);
        events.emit('ibis:flutter', { n: ibis.flutters });
        return true;
      }
    }
    return false;
  }
  function dropPens(gaveUp) {
    ibis.state = 'drop'; ibis.t = 0; ibis.gaveUp = gaveUp;
    const A = game.audio;
    if (A && A.cue) A.cue('ibis', ibis.x, ibis.z, 0);
    events.emit('ibis:drop', { gaveUp });
  }
  function letGo() {
    // the pens fall from its bill onto the grass in front of it
    ibis.holding = false;
    const pens = byId.get('pens');
    const fx = Math.cos(ibis.h), fz = -Math.sin(ibis.h);
    pens.x = ibis.x + fx * 0.5; pens.z = ibis.z + fz * 0.5;
    if (col && !col.isFree(pens.x, pens.z, 0.2)) { pens.x = ibis.x; pens.z = ibis.z; }
    pens.y = ground(pens.x, pens.z);
    pens.yaw = ibis.h;
    pens.out = true;
    pens.fall = 0;
    markersOn(H.live);
  }

  function updateIbis(dt, t) {
    if (ibis.state === 'away') return;
    const I = HUNT.ibis, p = player.position;
    ibis.t += dt;
    const k = Math.min(1, ibis.t / Math.max(0.01, ibis.dur));
    let flapK = 0;
    ibis.look = 0;
    if (ibis.state === 'arrive') {
      const e = 1 - (1 - k) * (1 - k);
      ibis.x = ibis.fromX + (ibis.toX - ibis.fromX) * e;
      ibis.z = ibis.fromZ + (ibis.toZ - ibis.fromZ) * e;
      ibis.y = ibis.fromY + (ground(ibis.toX, ibis.toZ) - ibis.fromY) * (1 - (1 - k) * (1 - k) * (1 - k));
      flapK = k < 0.85 ? 0.55 + 0.45 * Math.abs(Math.sin(t * 9)) : 1 - (k - 0.85) / 0.15;
      if (k >= 1) { ibis.state = 'idle'; ibis.t = 0; ibis.peckT = 1.2; const A = game.audio; if (A && A.cue) A.cue('ibis', ibis.x, ibis.z, 0); }
    } else if (ibis.state === 'flutter') {
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      ibis.x = ibis.fromX + (ibis.toX - ibis.fromX) * e;
      ibis.z = ibis.fromZ + (ibis.toZ - ibis.fromZ) * e;
      const g = ground(ibis.x, ibis.z);
      ibis.y = g + Math.sin(Math.PI * k) * (0.7 + 0.08 * Math.hypot(ibis.toX - ibis.fromX, ibis.toZ - ibis.fromZ));
      flapK = Math.abs(Math.sin(t * 13));
      if (k >= 1) {
        ibis.state = 'idle'; ibis.t = 0; ibis.peckT = 0.9; ibis.cool = 0.8;
        ibis.h = faceTo(p.x, p.z); // turns to glare at you
        if (ibis.flutters >= I.flutters) dropPens(true); // it gives up
      }
    } else if (ibis.state === 'idle') {
      ibis.y = ground(ibis.x, ibis.z);
      const d = Math.hypot(p.x - ibis.x, p.z - ibis.z);
      const mode = player.mode, sneaky = mode === 'creep' || mode === 'idle' || player.speed <= I.sneak;
      const wary = d < 8;
      if (wary) {
        // head up, watching you
        const want = faceTo(p.x, p.z);
        let dh = want - ibis.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        ibis.h += dh * Math.min(1, dt * 3);
        ibis.look = 1;
      } else {
        ibis.peckT -= dt;
        if (ibis.peckT < -1.4) ibis.peckT = 1.5 + Math.random() * 2.5;
      }
      if (ibis.cool > 0) ibis.cool -= dt;
      if (ibis.holding && H.live && !player.held && ibis.cool <= 0) {
        if (!sneaky && d < (mode === 'jog' ? I.spookJog : I.spook)) {
          if (!flutterFrom(p.x, p.z)) dropPens(true);
        } else if (sneaky && d < I.drop) dropPens(false);
      }
    } else if (ibis.state === 'drop') {
      ibis.y = ground(ibis.x, ibis.z);
      if (ibis.holding && ibis.t > 0.35) letGo();
      if (ibis.t > 1.3) {
        // off it stalks, head high, away from you, then flies off
        const away = Math.atan2(ibis.z - p.z, ibis.x - p.x);
        ibis.state = 'leave'; ibis.t = 0; ibis.dur = 4.2;
        ibis.fromX = ibis.x; ibis.fromZ = ibis.z;
        ibis.toX = ibis.x + Math.cos(away) * 4; ibis.toZ = ibis.z + Math.sin(away) * 4;
        ibis.h = faceTo(ibis.toX, ibis.toZ);
        markersOn(H.live);
      }
    } else if (ibis.state === 'leave') {
      if (ibis.t < 2.2) {
        const e = ibis.t / 2.2;
        ibis.x = ibis.fromX + (ibis.toX - ibis.fromX) * e;
        ibis.z = ibis.fromZ + (ibis.toZ - ibis.fromZ) * e;
        ibis.y = ground(ibis.x, ibis.z) + Math.abs(Math.sin(ibis.t * 9)) * 0.02;
      } else {
        const e = (ibis.t - 2.2) / 2.0;
        const fx = Math.cos(ibis.h), fz = -Math.sin(ibis.h);
        ibis.x += fx * dt * (3 + e * 5);
        ibis.z += fz * dt * (3 + e * 5);
        ibis.y += dt * (1.5 + e * 5);
        flapK = Math.abs(Math.sin(t * 11));
        if (e >= 1) { ibis.state = 'away'; ibisMesh.visible = false; }
      }
    }
    // pose
    ibisMesh.position.set(ibis.x, ibis.y, ibis.z);
    ibisMesh.rotation.y = ibis.h;
    const M = ibisM.mats;
    const air = ibis.state === 'arrive' || ibis.state === 'flutter' || (ibis.state === 'leave' && ibis.t > 2.2);
    // the head: a peck (neck down), head up while watching, a haughty lift as it leaves
    let neck = 0;
    if (ibis.state === 'idle' && !ibis.look && ibis.peckT < 0) neck = -1.15 * Math.min(1, -ibis.peckT * 4, (1.4 + ibis.peckT) * 4);
    if (ibis.state === 'drop') neck = ibis.t < 0.35 ? -0.5 * (ibis.t / 0.35) : 0.35 * Math.min(1, (ibis.t - 0.35) * 3);
    if (ibis.state === 'leave') neck = 0.35;
    ibis.neck += (neck - ibis.neck) * Math.min(1, dt * 10);
    about(M[1], IB.neck, 0, 0, ibis.neck + 0.05 * Math.sin(t * 2.3), 1);
    // wings: folded along the body, or spread out sideways and beating
    ibis.spread += ((air ? 1 : 0) - ibis.spread) * Math.min(1, dt * 12);
    const beat = air ? -0.9 + 1.5 * flapK : 0;
    ibis.flap += (beat - ibis.flap) * Math.min(1, dt * 20);
    for (let sd = -1; sd <= 1; sd += 2) {
      _sh[0] = IB.shoulder[0]; _sh[1] = IB.shoulder[1]; _sh[2] = sd * IB.shoulder[2];
      about(M[sd < 0 ? 2 : 3], _sh, sd * ibis.flap * ibis.spread, sd * 1.45 * ibis.spread, 0, 1 + 0.9 * ibis.spread);
    }
    if (ibis.holding) M[4].copy(M[1]); else M[4].copy(HIDE);
    // the shadow stays on the ground under it
    const lift = ibis.y - ground(ibis.x, ibis.z);
    const s = Math.max(0.2, 1 - lift * 0.18);
    M[5].makeScale(s, 1, s).setPosition(0, -lift / HUNT.ibis.scale, 0);
  }
  // m = about the point p: turn rx about x, then ry about y, then rz about z, the
  // part stretched sx along x first
  const _q = new THREE.Matrix4(), _r = new THREE.Matrix4(), _sh = [0, 0, 0];
  function about(m, p, rx, ry, rz, sx) {
    m.makeTranslation(p[0], p[1], p[2]);
    if (rx) m.multiply(_r.makeRotationX(rx));
    if (ry) m.multiply(_r.makeRotationY(ry));
    if (rz) m.multiply(_r.makeRotationZ(rz));
    if (sx !== 1) m.multiply(_r.makeScale(sx, 1, 1));
    m.multiply(_q.makeTranslation(-p[0], -p[1], -p[2]));
  }

  // ---- per frame
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _qu = new THREE.Quaternion(), _e = new THREE.Euler();
  const UP = new THREE.Vector3(0, 1, 0);
  function update(dt, t) {
    // the table standing up (or tipping over) with a little bounce
    if (Math.abs(H.tip - H.tipTo) > 1e-4) {
      const dir = Math.sign(H.tipTo - H.tip);
      H.tip += dir * dt / 0.55;
      if ((dir > 0 && H.tip >= H.tipTo) || (dir < 0 && H.tip <= H.tipTo)) { H.tip = H.tipTo; H.settle = 0; }
      applyTable();
    } else if (H.settle != null && H.settle < 0.5 && table) {
      H.settle += dt;
      table.setTip(H.tipTo - 0.06 * Math.exp(-H.settle * 9) * Math.sin(H.settle * 26));
    }
    messM.mats[1].copy(H.spilled ? messM.mats[0] : HIDE);

    // the pieces: bobbing gently and glowing, popping up and away when picked up
    const p = player.position;
    let shown = 0;
    if (pickBusy > 0) pickBusy -= dt;
    for (const it of items) {
      const m = kitM.mats[it.i], sh = kitM.mats[5 + it.i];
      if (it.found && it.pop >= 0 && it.pop < 1) {
        it.pop = Math.min(1, it.pop + dt / 0.45);
        const e = it.pop;
        const sc = e < 0.35 ? 1 + e : (1.35) * (1 - (e - 0.35) / 0.65);
        _p.set(it.x + (p.x - it.x) * e * e, it.y + 0.1 + Math.sin(Math.PI * e) * 0.9 + (p.y + 1 - it.y) * e * e, it.z + (p.z - it.z) * e * e);
        _qu.setFromAxisAngle(UP, (it.yaw || 0) + e * 3);
        m.compose(_p, _qu, _s.setScalar(Math.max(0.001, sc)));
        sh.copy(HIDE);
        kitM.glow[it.i] = 0.35 * (1 - e);
        shown++;
        continue;
      }
      if (!it.out || it.found) { m.copy(HIDE); sh.copy(HIDE); kitM.glow[it.i] = 0; continue; }
      shown++;
      let fall = 0;
      if (it.fall != null && it.fall < 1) { it.fall = Math.min(1, it.fall + dt / 0.5); fall = (1 - it.fall) * (1 - it.fall) * 0.55; }
      const bob = 0.03 + 0.03 * Math.sin(t * 2.1 + it.i * 1.7);
      _p.set(it.x, it.y + bob + fall, it.z);
      _qu.setFromAxisAngle(UP, it.yaw || 0);
      m.compose(_p, _qu, _s.setScalar(it.ibis ? 0.9 : 1));
      _p.set(it.x, it.y, it.z);
      sh.compose(_p, _qu, _s.setScalar(1 - bob * 2));
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.6 + it.i * 1.3);
      kitM.glow[it.i] = H.live ? 0.08 + 0.16 * pulse : 0;
      kitM.glow[5 + it.i] = H.live ? 0.05 + 0.22 * pulse : 0;
      // a few sparkles now and then while it waits
      if (H.live && game.fx && game.fx.burst) {
        it.spark -= dt;
        if (it.spark <= 0) {
          it.spark = HUNT.sparkEvery * (0.8 + 0.4 * Math.random());
          const d = Math.hypot(it.x - p.x, it.z - p.z);
          if (d < HUNT.sparkRange) game.fx.burst('sparkle', it.x + (Math.random() - 0.5) * (it.id === 'loop_pole' ? 1.8 : 0.3), it.y + 0.3, it.z + (Math.random() - 0.5) * 0.3, 3);
        }
      }
      // walking into it picks it up
      if (H.live && state.phase === 'setup' && !player.held && pickBusy <= 0 && !kit.busy()) {
        const d = it.id === 'loop_pole' ? segDist(it, p) : Math.hypot(it.x - p.x, it.z - p.z);
        if (d < HUNT.pick) pickUp(it);
      }
    }
    kitMesh.visible = shown > 0;
    updateIbis(dt, t);
    if (ibis.mark) { ibis.mark.x = ibis.x; ibis.mark.z = ibis.z; }
  }
  // the loop pole is long: the distance to its line, not its middle
  function segDist(it, p) {
    const c = Math.cos(it.yaw || 0), s = Math.sin(it.yaw || 0);
    const ax = c, az = -s; // its length runs along local x
    const dx = p.x - it.x, dz = p.z - it.z;
    const u = Math.max(-1.25, Math.min(1.35, dx * ax + dz * az));
    return Math.hypot(dx - ax * u, dz - az * u);
  }

  reset();
  // straight to the survey, or a fixed check view (?cam=, ?lizard=, ?view=...,
  // with no story phase): the station tidy, nothing scattered
  const plainView = !GAME_FLAGS.phase && !GAME_FLAGS.huntStep && /[?&](cam|lizard|croc|view|at)=/.test(location.search);
  if (GAME_FLAGS.phase === 'survey' || GAME_FLAGS.phase === 'summary' || GAME_FLAGS.skipSetup || plainView) {
    messShown(false);
    tidy(0);
    restore(KIT_IDS);
  }

  return {
    group, items, byId,
    update, reset, restore, live, tidy, messShown, callIbis, ibisSpot, hideCard,
    holdCard(on) { cardHeld = !!on; },
    get count() { return count(); },
    left,
    found: (id) => !!(byId.get(id) && byId.get(id).found),
    get ibis() { return ibis; },
    get tip() { return H.tip; },
    // for scripted runs: stand by a piece (or the ibis)
    spot(id) { const it = byId.get(id); return it ? { x: it.x, z: it.z, out: it.out, found: it.found } : null; },
    pickUp: (id) => pickUp(byId.get(id)),
    // (scripted runs) a piece picked up where the player stands, the ibis's too
    give(id) {
      const it = byId.get(id);
      if (!it || it.found) return;
      if (it.ibis) { ibis.holding = false; if (ibis.state !== 'away') { ibis.state = 'leave'; ibis.t = 2.2; } }
      it.x = player.position.x; it.z = player.position.z; it.y = ground(it.x, it.z); it.out = true;
      pickUp(it);
    },
    get stats() {
      return {
        found: count(), drawCalls: (kitMesh.visible ? 1 : 0) + (messMesh.visible ? 1 : 0) + (ibisMesh.visible ? 1 : 0),
        ibis: ibis.state, flutters: ibis.flutters,
      };
    },
  };
}

// The pop-up card's drawings, one per piece (64 x 64).
const ART = {
  loop_pole: '<svg viewBox="0 0 64 64"><path d="M8 58 46 16" stroke="#c99a4c" stroke-width="7" stroke-linecap="round"/><path d="M8 58 14 51" stroke="#4a3b35" stroke-width="8" stroke-linecap="round"/><path d="M20 45l3-3M30 34l3-3M39 24l3-3" stroke="#a5813e" stroke-width="7"/><circle cx="52" cy="11" r="8" fill="none" stroke="#ff6f61" stroke-width="3.2"/></svg>',
  notebook: `<svg viewBox="0 0 64 64"><rect x="12" y="8" width="40" height="50" rx="5" fill="${NOTEBOOK_COVER}" stroke="#c75a32" stroke-width="3"/><rect x="18" y="8" width="3" height="50" fill="#c75a32"/><rect x="40" y="6" width="5" height="54" rx="2" fill="#5a4a3c"/><path d="M26 30c4-6 12-6 12 0s-8 6-6 11" fill="none" stroke="#7fd35a" stroke-width="4" stroke-linecap="round"/></svg>`,
  bags: '<svg viewBox="0 0 64 64"><rect x="8" y="20" width="28" height="36" rx="5" fill="#d4f0ff" stroke="#8ccaf2" stroke-width="3"/><rect x="20" y="12" width="28" height="36" rx="5" fill="#eef9ff" stroke="#8ccaf2" stroke-width="3"/><path d="M28 12c0-5 12-5 12 0" fill="none" stroke="#ff6f61" stroke-width="3.2"/><ellipse cx="48" cy="50" rx="11" ry="9" fill="#ead3a2" stroke="#c9a86a" stroke-width="3"/></svg>',
  scales: '<svg viewBox="0 0 64 64"><rect x="4" y="38" width="56" height="12" rx="2" fill="#ffd24a" stroke="#d9a520" stroke-width="2.5" transform="rotate(-12 32 44)"/><path d="M12 45v-4M20 43v-6M28 42v-4M36 40v-6M44 38v-4M52 36v-6" stroke="#5a4a38" stroke-width="2" transform="rotate(-12 32 44)"/><rect x="26" y="4" width="13" height="30" rx="5" fill="#62d26f" stroke="#3f8f4c" stroke-width="3"/><path d="M29 12h7M29 18h7M29 24h7" stroke="#fff" stroke-width="2"/></svg>',
  pens: '<svg viewBox="0 0 64 64"><g stroke-linecap="round"><path d="M14 52 44 12" stroke="#ff4fa3" stroke-width="8"/><path d="M24 56 52 18" stroke="#3ec7ff" stroke-width="8"/><path d="M8 44 36 8" stroke="#ffb52e" stroke-width="8"/><path d="M44 12l4-5M52 18l4-5M36 8l4-5" stroke="#fff8ec" stroke-width="8"/></g><rect x="20" y="30" width="18" height="6" rx="2" fill="#8a5a3c" transform="rotate(-53 29 33)"/></svg>',
};
