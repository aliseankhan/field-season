// The little field biologist: about 1.5 m tall with chunky proportions (the head
// is over a third of the height), rosy cheeks, a bucket hat with a daisy, a
// field vest, a bright backpack, boots and a bamboo loop pole with a coral loop
// hanging from the tip. Built from primitives merged into one skinned mesh (one
// draw call) with a bone per body part, plus a thin inverted-hull outline (a
// second draw call on the same skeleton) and a soft contact shadow. Animated
// procedurally: idle, walk, jog and a crouch for creeping.
//
// Tools (the tool ring, src/tools/ring.js): the field tools live in the same mesh on
// bones of their own, held in the right hand or stowed on the backpack, shown and
// hidden by scaling their bone. setTool(id) picks what is in hand (loop_pole, flags,
// loggers, backpacks, tape or null for empty hands) with a quick reach to the pack;
// setStowed({ flags, loggers, pole }) says which spares ride on the pack (pole: false
// leaves the loop pole off altogether, as before the opening's kit hunt finds it). setLooks({ hat,
// shirt }) recolours the hat and the shirt.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const COL = {
  skin: '#f3c29c', cheek: '#ff8f8f', eye: '#2b2320', shine: '#ffffff', mouth: '#9a4b3c', hair: '#6b4128',
  hat: '#f2dca0', band: '#e8744f', daisy: '#fffaf0', daisyEye: '#ffc93a',
  shirt: '#7cc7f0', vest: '#d9a55a', pocket: '#c08a45', pencil: '#ffd84a',
  trousers: '#5e8058', belt: '#7a5236', boot: '#8a5a3c', sole: '#4a3326', lace: '#f1e4c8',
  pack: '#ff7a3d', packDark: '#e0602a', packPocket: '#ffa25e', mat: '#4fa3b8', strap: '#b8552a',
  pole: '#d9b56c', node: '#b08f4f', grip: '#4a3b35', cord: '#ff6f61',
  flagCloth: '#ff9ec4', flagStick: '#e8d3a8', logger: '#f6f4ee', loggerRod: '#9aa6ad', loggerLed: '#62d26f',
  gpsCase: '#ff8a3d', gpsLid: '#3fb8c4', tape: '#ffcf3f', tapeDark: '#4a3b35', tapeTongue: '#fff3c4',
  outline: '#3a2f2a', shadow: '#3b3363',
};

// Bone names, parents and pivots in the model frame (y up, facing -z, right hand at +x).
const BONES = [
  ['root', -1, [0, 0, 0]],
  ['hips', 0, [0, 0.44, 0]],
  ['spine', 1, [0, 0.5, 0]],
  ['head', 2, [0, 0.84, 0]],
  ['armL', 2, [-0.2, 0.78, 0]],
  ['armR', 2, [0.2, 0.78, 0]],
  ['pole', 5, [0.225, 0.5, -0.01]],
  ['loop', 6, [0.225, 2.8, -0.01]],
  ['thighL', 1, [-0.09, 0.43, 0]],
  ['shinL', 8, [-0.09, 0.26, 0]],
  ['footL', 9, [-0.09, 0.085, 0]],
  ['thighR', 1, [0.09, 0.43, 0]],
  ['shinR', 11, [0.09, 0.26, 0]],
  ['footR', 12, [0.09, 0.085, 0]],
  // tools in the right hand (pivot at the hand) and stowed on the pack
  ['holdFlags', 5, [0.225, 0.5, -0.01]],
  ['holdLogger', 5, [0.225, 0.5, -0.01]],
  ['holdGps', 5, [0.225, 0.5, -0.01]],
  ['holdTape', 5, [0.225, 0.5, -0.01]],
  ['stowPole', 2, [0, 0.66, 0.3]],
  ['stowFlags', 2, [0.17, 0.62, 0.22]],
  ['stowLogger', 2, [-0.17, 0.62, 0.2]],
  ['stowTape', 1, [-0.17, 0.5, 0.02]],
];
const HOLD_BONES = ['holdFlags', 'holdLogger', 'holdGps', 'holdTape'];
// which bone shows each tool in hand, and the arm's pose for it
const TOOL_HOLD = { flags: 'holdFlags', loggers: 'holdLogger', backpacks: 'holdGps', tape: 'holdTape' };
const BI = Object.fromEntries(BONES.map((b, i) => [b[0], i]));
const L_THIGH = 0.17, L_SHIN = 0.175, ANKLE_Y = 0.085;
const OUTLINE = 0.012; // metres

// ---------------------------------------------------------------- geometry

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _s = new THREE.Vector3();

function place(geo, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
  geo.applyMatrix4(_m);
  return geo;
}
const cyl = (rt, rb, y0, y1, x = 0, z = 0, seg = 10, sx = 1, sz = 1) =>
  place(new THREE.CylinderGeometry(rt, rb, y1 - y0, seg, 1), x, (y0 + y1) / 2, z, sx, 1, sz);
const sph = (r, x, y, z, sx = 1, sy = 1, sz = 1, detail = 1) =>
  place(new THREE.IcosahedronGeometry(r, detail), x, y, z, sx, sy, sz);
const rbox = (w, h, d, rad, x, y, z, rx = 0, ry = 0, rz = 0) =>
  place(new RoundedBoxGeometry(w, h, d, 2, rad), x, y, z, 1, 1, 1, rx, ry, rz);
// A part of a sphere: phi round the y axis (front is 1.5 pi), theta down from the top.
const shell = (r, phi0, phiLen, th0, thLen, x, y, z, sx, sy, sz, w = 18, h = 10) =>
  place(new THREE.SphereGeometry(r, w, h, phi0, phiLen, th0, thLen), x, y, z, sx, sy, sz);

// colour value -> COL name, so setLooks can find the hat and shirt vertices
const COL_KEY = new Map(Object.entries(COL).map(([k, v]) => [v, k]));

// The field tools: held versions at the hand pivot, stowed versions on the pack.
function addTools(add) {
  const hx = 0.225, hz = -0.01; // the hand pivot (as the pole's)
  // a bundle of grid flags: four sticks with pink cloths
  const bundle = (bone, x, y0, z, len, lean) => {
    for (let k = 0; k < 4; k++) {
      const ox = (k % 2 ? 0.014 : -0.014), oz = (k < 2 ? -0.012 : 0.012);
      const top = y0 + len - k * 0.02;
      add(bone, COL.flagStick, place(new THREE.CylinderGeometry(0.006, 0.006, len, 5), x + ox, y0 + len / 2, z + oz, 1, 1, 1, 0, 0, lean), { outline: 0 });
      add(bone, COL.flagCloth, rbox(0.004, 0.06, 0.085, 0.002, x + ox - Math.sin(lean) * len * 0.45, top - 0.04, z + oz - 0.045), { outline: 0 });
    }
  };
  bundle('holdFlags', hx, 0.43, hz - 0.03, 0.62, 0);
  bundle('stowFlags', 0.19, 0.6, 0.22, 0.5, -0.18);

  // a temperature logger: a white radiation shield of stacked plates on a grey rod
  const logger = (bone, x, y, z, s) => {
    add(bone, COL.loggerRod, cyl(0.007 * s, 0.007 * s, y - 0.05 * s, y + 0.1 * s, x, z, 6), { outline: 0 });
    for (let k = 0; k < 4; k++) {
      const yy = y + k * 0.022 * s;
      add(bone, COL.logger, cyl(0.03 * s, 0.045 * s, yy, yy + 0.012 * s, x, z, 12), { outline: 0.5 });
    }
    add(bone, COL.logger, sph(0.032 * s, x, y + 0.095 * s, z, 1, 0.55, 1, 1), { smooth: true, outline: 0.5 });
    add(bone, COL.loggerLed, sph(0.007 * s, x, y + 0.012 * s, z - 0.03 * s, 1, 1, 1, 0), { outline: 0 });
  };
  logger('holdLogger', hx, 0.56, hz - 0.04, 1.4);
  logger('stowLogger', -0.19, 0.55, 0.2, 1);

  // the GPS backpacks travel in a little orange case with a teal lid
  add('holdGps', COL.gpsCase, rbox(0.11, 0.07, 0.06, 0.015, hx, 0.53, hz - 0.045), { outline: 0.5 });
  add('holdGps', COL.gpsLid, rbox(0.114, 0.02, 0.064, 0.008, hx, 0.57, hz - 0.045), { outline: 0 });
  add('holdGps', COL.tapeDark, cyl(0.002, 0.002, 0.57, 0.66, hx + 0.035, hz - 0.03, 4), { outline: 0 });

  // a yellow tape measure (held on its side), and one on the belt
  const tape = (bone, x, y, z, s) => {
    add(bone, COL.tape, place(new THREE.CylinderGeometry(0.052 * s, 0.052 * s, 0.034 * s, 14), x, y, z, 1, 1, 1, 0, 0, Math.PI / 2), { outline: 0.6 });
    add(bone, COL.tapeDark, place(new THREE.CylinderGeometry(0.02 * s, 0.02 * s, 0.038 * s, 10), x, y, z, 1, 1, 1, 0, 0, Math.PI / 2), { outline: 0 });
    add(bone, COL.tapeTongue, rbox(0.03 * s, 0.012 * s, 0.05 * s, 0.003, x, y - 0.045 * s, z - 0.04 * s), { outline: 0 });
  };
  tape('holdTape', hx + 0.01, 0.53, hz - 0.03, 1.2);
  tape('stowTape', -0.19, 0.5, 0.02, 0.8);

  // the loop pole collapsed and slung across the pack, loop at the top
  const a = [-0.15, 0.36, 0.31], b = [0.18, 1.2, 0.31];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const tilt = -Math.atan2(b[0] - a[0], b[1] - a[1]);
  const mid = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2]];
  let m = mid(0.5);
  add('stowPole', COL.pole, place(new THREE.CylinderGeometry(0.016, 0.018, len, 8), m[0], m[1], m[2], 1, 1, 1, 0, 0, tilt), { outline: 0 });
  for (const t of [0.3, 0.55, 0.8]) {
    m = mid(t);
    add('stowPole', COL.node, place(new THREE.CylinderGeometry(0.02, 0.02, 0.022, 8), m[0], m[1], m[2], 1, 1, 1, 0, 0, tilt), { outline: 0 });
  }
  m = mid(0.12);
  add('stowPole', COL.grip, place(new THREE.CylinderGeometry(0.022, 0.022, 0.14, 8), m[0], m[1], m[2], 1, 1, 1, 0, 0, tilt), { outline: 0 });
  add('stowPole', COL.cord, place(new THREE.TorusGeometry(0.07, 0.011, 6, 16), b[0] + 0.03, b[1] - 0.04, b[2] + 0.01, 1, 1, 1, 0, 0.4, 0), { smooth: true, outline: 0 });
}

function buildGeometry() {
  const parts = [];
  // smooth: keep the primitive's own normals; outline: 0 for no hull, else how far
  // the vertex normal leans towards the part's centre direction (1 = round).
  const add = (bone, color, geo, { smooth = false, outline = 0.6 } = {}) =>
    parts.push({ bone: BI[bone], color: new THREE.Color(color), key: COL_KEY.get(color), geo, smooth, outline });

  // Legs: trousers, boot shafts, rounded boots with a lace stripe.
  for (const [side, sx] of [['L', -0.09], ['R', 0.09]]) {
    add('thigh' + side, COL.trousers, cyl(0.072, 0.064, 0.26, 0.45, sx, 0, 10));
    add('shin' + side, COL.trousers, cyl(0.064, 0.06, 0.15, 0.28, sx, 0, 10));
    add('shin' + side, COL.boot, cyl(0.072, 0.07, 0.07, 0.18, sx, 0, 10));
    add('foot' + side, COL.boot, rbox(0.13, 0.1, 0.2, 0.045, sx, 0.055, -0.035));
    add('foot' + side, COL.lace, rbox(0.06, 0.02, 0.07, 0.009, sx, 0.104, -0.06, 0.25, 0, 0), { outline: 0 });
    add('foot' + side, COL.sole, rbox(0.14, 0.03, 0.215, 0.012, sx, 0.013, -0.038));
  }

  // Hips and belt.
  add('hips', COL.trousers, sph(0.19, 0, 0.46, 0, 1, 0.55, 0.85, 2), { smooth: true, outline: 1 });
  add('hips', COL.belt, cyl(0.176, 0.182, 0.49, 0.525, 0, 0, 14, 1, 0.86));

  // Torso: a round shirt barrel, the open vest over it, pockets, straps and a pencil.
  add('spine', COL.shirt, sph(0.2, 0, 0.66, 0, 1, 1.15, 0.82, 2), { smooth: true, outline: 1 });
  add('spine', COL.vest, shell(0.212, 1.5 * Math.PI + 0.42, 2 * Math.PI - 0.84, 0.3 * Math.PI, 0.46 * Math.PI, 0, 0.66, 0, 1, 1.15, 0.84), { smooth: true, outline: 1 });
  for (const x of [-0.105, 0.105]) {
    const ry = x > 0 ? -0.55 : 0.55;
    add('spine', COL.pocket, rbox(0.075, 0.07, 0.02, 0.008, x, 0.6, -0.158, 0, ry, 0), { outline: 0 });
    add('spine', COL.pocket, rbox(0.08, 0.018, 0.024, 0.006, x, 0.638, -0.16, 0, ry, 0), { outline: 0 });
    add('spine', COL.strap, rbox(0.04, 0.2, 0.02, 0.008, x * 0.82, 0.74, -0.15, -0.35, ry * 0.6, 0), { outline: 0 });
  }
  add('spine', COL.pencil, cyl(0.009, 0.009, 0.62, 0.7, -0.115, -0.158, 6), { outline: 0 });

  // Backpack: rounded body, flap, front pocket and a rolled sleeping mat on top.
  add('spine', COL.pack, rbox(0.3, 0.32, 0.17, 0.06, 0, 0.66, 0.2), { outline: 0.4 });
  add('spine', COL.packDark, rbox(0.31, 0.11, 0.18, 0.045, 0, 0.8, 0.205), { outline: 0.4 });
  add('spine', COL.packPocket, rbox(0.2, 0.12, 0.06, 0.03, 0, 0.6, 0.29), { outline: 0.4 });
  add('spine', COL.mat, place(new THREE.CylinderGeometry(0.058, 0.058, 0.36, 12), 0, 0.9, 0.2, 1, 1, 1, 0, 0, Math.PI / 2), { outline: 0.5 });
  add('spine', COL.strap, cyl(0.06, 0.06, 0.885, 0.915, 0, 0.2, 10), { outline: 0 });

  // Head: a big round face, hair at the back, bangs, ears.
  add('head', COL.skin, sph(0.27, 0, 1.08, 0, 1.03, 0.95, 0.97, 3), { smooth: true, outline: 1 });
  // Hair: a slightly bigger ball set up and back, so it meets the face along a
  // slanted hairline and covers the back of the head down to the nape.
  add('head', COL.hair, sph(0.285, 0, 1.11, 0.035, 1.03, 0.95, 0.97, 3), { smooth: true, outline: 1 });
  for (const [x, y, s] of [[-0.125, 1.18, 0.9], [0.0, 1.19, 1.05], [0.125, 1.18, 0.9]]) {
    add('head', COL.hair, sph(0.068 * s, x, y, -0.195, 1.25, 0.62, 0.75, 1), { smooth: true, outline: 0 });
  }
  for (const x of [-0.272, 0.272]) add('head', COL.skin, sph(0.05, x, 1.06, 0.01, 0.55, 1, 0.9, 1), { smooth: true, outline: 0.8 });
  // Face: big shiny eyes, rosy cheeks, a button nose and a small smile.
  for (const x of [-0.1, 0.1]) {
    add('head', COL.eye, sph(0.042, x, 1.075, -0.243, 0.85, 1.15, 0.5, 2), { smooth: true, outline: 0 });
    add('head', COL.shine, sph(0.013, x + 0.013, 1.093, -0.262, 1, 1, 0.5, 1), { smooth: true, outline: 0 });
    add('head', COL.cheek, sph(0.038, x * 1.68, 1.0, -0.205, 1, 0.62, 0.45, 2), { smooth: true, outline: 0 });
  }
  add('head', COL.skin, sph(0.021, 0, 1.03, -0.264, 1.1, 0.9, 0.9, 1), { smooth: true, outline: 0 });
  add('head', COL.mouth, place(new THREE.TorusGeometry(0.026, 0.0065, 4, 10, Math.PI), 0, 0.99, -0.252, 1, 1, 1, 0.15, 0, Math.PI), { outline: 0 });

  // Bucket hat: crown with a soft domed top, a coloured band, a drooping brim and a daisy.
  add('head', COL.hat, cyl(0.205, 0.25, 1.245, 1.405, 0, 0.005, 16), { outline: 0.7 });
  add('head', COL.hat, shell(0.205, 0, 2 * Math.PI, 0, 0.5 * Math.PI, 0, 1.4, 0.005, 1, 0.38, 1, 16, 5), { smooth: true, outline: 0.7 });
  add('head', COL.band, cyl(0.244, 0.254, 1.245, 1.29, 0, 0.005, 16), { outline: 0 });
  add('head', COL.hat, cyl(0.262, 0.37, 1.2, 1.25, 0, 0.005, 20), { outline: 0.3 });
  // The daisy sits at the back of the band, where the follow camera sees it.
  const da = 0.62; // radians from straight back, towards the right
  const dx = Math.sin(da) * 0.258, dy = 1.268, dz = Math.cos(da) * 0.258;
  const tx = Math.cos(da), tz = -Math.sin(da); // along the band
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.3;
    const u = Math.cos(a) * 0.03, v = Math.sin(a) * 0.03;
    add('head', COL.daisy, sph(0.019, dx + tx * u, dy + v, dz + tz * u, 1, 1, 1, 1), { smooth: true, outline: 0 });
  }
  add('head', COL.daisyEye, sph(0.016, dx + Math.sin(da) * 0.012, dy, dz + Math.cos(da) * 0.012, 1, 1, 1, 1), { smooth: true, outline: 0 });

  // Arms: puffy short sleeves, forearms and round mitten hands.
  for (const [side, sx] of [['L', -0.215], ['R', 0.215]]) {
    add('arm' + side, COL.shirt, sph(0.078, sx, 0.755, 0, 1, 1.05, 1, 2), { smooth: true, outline: 1 });
    add('arm' + side, COL.skin, cyl(0.046, 0.042, 0.55, 0.72, sx + (sx > 0 ? 0.008 : -0.008), 0, 10), { outline: 0.8 });
    add('arm' + side, COL.skin, sph(0.06, sx + (sx > 0 ? 0.01 : -0.01), 0.505, -0.005, 1, 1.05, 1, 2), { smooth: true, outline: 1 });
  }

  // Bamboo loop pole, held upright in the right hand in the bind pose: 2.5 m with
  // darker nodes, a dark grip and the coral cord running up to the tip.
  const px = 0.225, pz = -0.01;
  add('pole', COL.pole, cyl(0.014, 0.016, 0.3, 2.8, px, pz, 8), { outline: 0 });
  for (let y = 0.75; y < 2.75; y += 0.36) add('pole', COL.node, cyl(0.018, 0.018, y, y + 0.022, px, pz, 8), { outline: 0 });
  add('pole', COL.grip, cyl(0.021, 0.021, 0.42, 0.6, px, pz, 8), { outline: 0 });
  add('pole', COL.cord, cyl(0.0035, 0.0035, 1.2, 2.8, px + 0.017, pz, 4), { outline: 0 });
  // The loop hangs from the tip on its own bone, so it stays upright as the pole leans.
  add('loop', COL.cord, cyl(0.004, 0.004, 2.7, 2.81, px, pz, 4), { outline: 0 });
  add('loop', COL.cord, sph(0.02, px, 2.71, pz, 1, 1, 1, 1), { smooth: true, outline: 0 });
  add('loop', COL.cord, place(new THREE.TorusGeometry(0.11, 0.013, 6, 20), px, 2.585, pz), { smooth: true, outline: 0 });

  addTools(add);

  // Merge into one non-indexed geometry with skin weights and an outline direction.
  let n = 0;
  const flat = parts.map((p) => {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    g.deleteAttribute('uv');
    if (!p.smooth) {
      g.deleteAttribute('normal');
      g.computeVertexNormals();
    }
    g.computeBoundingSphere();
    n += g.attributes.position.count;
    return { ...p, geo: g };
  });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const oln = new Float32Array(n * 3);
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const v = new THREE.Vector3(), rad = new THREE.Vector3();
  let o = 0;
  const ranges = {}; // COL name -> [[first vertex, count], ...], for setLooks
  for (const p of flat) {
    const a = p.geo.attributes;
    if (p.key) (ranges[p.key] || (ranges[p.key] = [])).push([o, a.position.count]);
    pos.set(a.position.array, o * 3);
    nor.set(a.normal.array, o * 3);
    const c = p.geo.boundingSphere.center;
    for (let k = 0; k < a.position.count; k++) {
      const j = o + k;
      col[j * 3] = p.color.r; col[j * 3 + 1] = p.color.g; col[j * 3 + 2] = p.color.b;
      si[j * 4] = p.bone;
      sw[j * 4] = 1;
      if (p.outline > 0) {
        rad.fromBufferAttribute(a.position, k).sub(c).normalize();
        v.fromBufferAttribute(a.normal, k).lerp(rad, p.outline).normalize();
        oln[j * 3] = v.x; oln[j * 3 + 1] = v.y; oln[j * 3 + 2] = v.z;
      }
    }
    o += a.position.count;
    p.geo.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aOutline', new THREE.BufferAttribute(oln, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  geo.computeBoundingSphere();
  geo.userData.ranges = ranges;
  return geo;
}

export function toonGradient(steps = [120, 190, 238, 255]) {
  const tex = new THREE.DataTexture(new Uint8Array(steps), steps.length, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// The fade: a 4x4 ordered dither that drops that share of the pixels (the same kind of
// see-through as the vegetation's cut-out), so the avatar can thin to a ghost near the
// lens without transparency sorting. One uniform shared by the body and its outline.
const uFade = { value: 0 };
const FADE_GLSL = `uniform float uFade;
float avatarBayer(vec2 p) {
  int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0));
  int i = x + y * 4;
  const float B[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (B[i] + 0.5) / 16.0;
}`;
function addFade(shader) {
  shader.uniforms.uFade = uFade;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${FADE_GLSL}`)
    .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n  if (uFade > 0.0 && avatarBayer(gl_FragCoord.xy) < uFade) discard;');
}

// The hull: back faces pushed out along aOutline, in one flat colour.
function outlineMaterial() {
  const m = new THREE.MeshBasicMaterial({ color: COL.outline, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aOutline;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed += aOutline * ${OUTLINE.toFixed(4)};`);
    addFade(shader);
  };
  m.customProgramCacheKey = () => 'avatar-outline-2';
  return m;
}

// A soft round shadow under the feet, so the player always sits on the ground.
function contactShadow() {
  const size = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  // alphaMap reads the green channel, so the falloff is drawn in grey on black.
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(0.45, '#c8c8c8');
  grad.addColorStop(1, '#000');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.MeshBasicMaterial({
    color: COL.shadow, alphaMap: tex, transparent: true, opacity: 0.32, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.45, 20).rotateX(-Math.PI / 2), mat);
  mesh.position.y = 0.015;
  mesh.name = 'player-contact-shadow';
  mesh.renderOrder = 2;
  return mesh;
}

// ---------------------------------------------------------------- animation

const smooth = (e0, e1, v) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// Two-bone leg IK in the sagittal plane: target forward f and drop D below the hip.
function legIK(f, D, out) {
  const d = Math.min(L_THIGH + L_SHIN - 1e-4, Math.max(0.05, Math.hypot(f, D)));
  const alpha = Math.atan2(f, D);
  const cb = (L_THIGH * L_THIGH + d * d - L_SHIN * L_SHIN) / (2 * L_THIGH * d);
  const cg = (L_THIGH * L_THIGH + L_SHIN * L_SHIN - d * d) / (2 * L_THIGH * L_SHIN);
  out.thigh = alpha + Math.acos(Math.min(1, Math.max(-1, cb)));
  out.shin = -(Math.PI - Math.acos(Math.min(1, Math.max(-1, cg))));
  return out;
}

export function buildAvatar() {
  const geo = buildGeometry();
  const material = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });
  material.shadowSide = THREE.BackSide; // back faces cast, so the round parts do not self-shadow in stripes
  material.onBeforeCompile = addFade;
  material.customProgramCacheKey = () => 'avatar-body-1';
  const bones = BONES.map(([name, parent, p]) => {
    const b = new THREE.Bone();
    b.name = name;
    const pp = parent >= 0 ? BONES[parent][2] : [0, 0, 0];
    b.position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
    return b;
  });
  BONES.forEach(([, parent], i) => { if (parent >= 0) bones[parent].add(bones[i]); });
  const skeleton = new THREE.Skeleton(bones);
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.name = 'biologist';
  mesh.add(bones[0]);
  mesh.bind(skeleton);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  const outline = new THREE.SkinnedMesh(geo, outlineMaterial());
  outline.name = 'biologist-outline';
  outline.bind(skeleton, mesh.bindMatrix);
  outline.frustumCulled = false;
  outline.castShadow = false;

  const group = new THREE.Group();
  group.name = 'player';
  const shadow = contactShadow();
  group.add(mesh, outline, shadow);

  const B = Object.fromEntries(bones.map((b) => [b.name, b]));
  const base = Object.fromEntries(bones.map((b) => [b.name, b.position.clone()]));
  const ik = { thigh: 0, shin: 0 };
  let phase = 0;
  let move = 0; // 0 standing, 1 moving (smoothed)

  function leg(side, f, lift, hipY) {
    const D = hipY + base['thigh' + side].y - (ANKLE_Y + lift);
    legIK(f, D, ik);
    B['thigh' + side].rotation.x = ik.thigh;
    B['shin' + side].rotation.x = ik.shin;
    B['foot' + side].rotation.x = -(ik.thigh + ik.shin) + lift * 1.2;
  }

  // s: { speed, crouch (0..1), jog (0..1), t }
  function update(dt, s) {
    const speed = s.speed;
    move += (smooth(0.05, 0.5, speed) - move) * Math.min(1, dt * 8);
    const stride = 0.1 + 0.04 * speed;
    phase += (speed / Math.max(0.05, stride)) * 0.5 * dt;
    const c = s.crouch;
    const jog = s.jog || 0;
    const t = s.t;

    const A = Math.min(0.22, stride) * move * (1 - 0.35 * c);
    const liftH = (0.04 + 0.04 * jog) * move * (1 - 0.4 * c);
    const bob = move * (0.012 + 0.025 * jog) * Math.abs(Math.cos(phase));
    const breathe = Math.sin(t * 2.1) * 0.006 * (1 - move);
    const hipY = base.hips.y - 0.012 - c * 0.13 - bob + breathe * 0.5;
    B.hips.position.y = hipY;
    B.hips.position.z = c * 0.04;
    B.hips.rotation.y = Math.sin(phase) * 0.12 * move;

    const sL = Math.sin(phase), sR = Math.sin(phase + Math.PI);
    leg('L', A * sL + c * 0.05, liftH * Math.max(0, Math.cos(phase)), hipY);
    leg('R', A * sR + c * 0.05, liftH * Math.max(0, Math.cos(phase + Math.PI)), hipY);

    const lean = 0.05 * move + 0.13 * jog * move + 0.38 * c;
    B.spine.rotation.x = -lean + breathe;
    B.spine.rotation.y = -B.hips.rotation.y * 0.8;
    B.spine.rotation.z = Math.sin(phase) * 0.04 * move;
    B.spine.scale.y = 1 + breathe;
    B.head.rotation.x = lean * 0.7 - 0.03;
    B.head.rotation.y = Math.sin(t * 0.37) * 0.22 * (1 - move) + Math.sin(t * 0.13) * 0.1 * (1 - move);
    B.head.rotation.z = Math.sin(phase * 2) * 0.03 * move + Math.sin(t * 0.7) * 0.03 * (1 - move);

    const swing = (0.4 + 0.35 * jog) * move * (1 - 0.5 * c);
    B.armL.rotation.x = -swing * sL + c * 0.35;
    B.armL.rotation.z = -0.14 - 0.05 * jog;
    B.armR.rotation.x = 0.32 + swing * 0.25 * sR + c * 0.5;
    B.armR.rotation.z = 0.1;
    const poleLean = 0.5 + 0.3 * c + 0.03 * Math.sin(phase * 2) * move;
    B.pole.rotation.x = -B.armR.rotation.x - poleLean;
    B.pole.rotation.y = 0; // (aimPose turns the pole and the loop about y as well; carried, they have none)
    B.pole.rotation.z = -0.1;
    // Keep the loop hanging upright below the tip, swinging a little.
    B.loop.rotation.x = poleLean - B.spine.rotation.x + 0.18 * Math.sin(phase * 2 + 0.6) * move + 0.05 * Math.sin(t * 1.3);
    B.loop.rotation.y = 0;
    B.loop.rotation.z = 0.1 - B.armR.rotation.z + 0.06 * Math.sin(t * 0.9 + 1);
    toolPose(dt, swing, sR, c);
    if (aim.weight > 1e-3) aimPose();
    else if (aimSet) { B.pole.position.copy(base.pole); B.loop.scale.setScalar(loopOn); aimSet = false; }
    // a creaking pole shakes in the hands (src/catch/breaks.js sets aim.wobble)
    if (aim.wobble > 0) B.pole.rotation.z += aim.wobble * 0.07 * Math.sin(t * 34);
    // and kicks back as a snapped floss loop lets go (breaks.js sets aim.recoil to 1)
    if (aim.recoil > 0) {
      aim.recoil = Math.max(0, aim.recoil - dt * 2.2);
      const k = aim.recoil;
      B.pole.rotation.x += 0.3 * k * k * Math.cos((1 - k) * 13);
    }
  }

  // The floss loop on the pole: off until it is tied on the set-up day.
  let loopOn = 1;
  function setLoop(on) {
    loopOn = on ? 1 : HIDE;
    B.loop.scale.setScalar(loopOn);
  }

  // The loop pole's aim (src/catch/loop_pole.js sets it): both hands raise the pole so its tip
  // meets aim.tip (model frame, metres, facing -z), sliding it through the hands for a
  // near target, and the loop hangs from the tip, swinging by aim.swingX and swingZ
  // (radians about the model's x and z) and drawn aim.snug times its size.
  // aim.tipOut is where the tip went; aim.wobble (0..1) shakes the pole, held up or not, and
  // aim.recoil (1, easing to 0) kicks it back.
  const aim = { weight: 0, tip: new THREE.Vector3(0.3, 2.2, -1.9), swingX: 0, swingZ: 0, snug: 1, tipOut: new THREE.Vector3(), wobble: 0, recoil: 0 };
  const ARM_CHAIN = ['root', 'hips', 'spine', 'armR'];
  const POLE_TIP = 2.3; // hand to tip
  const _mArm = new THREE.Matrix4(), _qArm = new THREE.Quaternion(), _qWant = new THREE.Quaternion(), _qPM = new THREE.Quaternion();
  const _hand = new THREE.Vector3(), _dir = new THREE.Vector3(), _ax = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  const _eLoop = new THREE.Euler();
  let aimSet = false;
  let mixW = 0;
  const mix = (a, b) => a + (b - a) * mixW;
  function aimPose() {
    const w = aim.weight, tp = aim.tip;
    mixW = w;
    const elev = Math.atan2(tp.y - 0.8, Math.max(0.1, Math.hypot(tp.x - 0.2, tp.z)));
    const armX = Math.min(2.75, Math.max(0.95, Math.PI / 2 + 0.8 * elev + 0.1));
    B.armR.rotation.x = mix(B.armR.rotation.x, armX);
    B.armR.rotation.z = mix(B.armR.rotation.z, 0.16);
    B.armL.rotation.x = mix(B.armL.rotation.x, armX * 0.82);
    B.armL.rotation.z = mix(B.armL.rotation.z, 0.5);
    B.spine.rotation.x += w * 0.12 * elev;
    B.head.rotation.x = mix(B.head.rotation.x, 0.5 * elev);
    B.head.rotation.y = mix(B.head.rotation.y, 0.4 * Math.atan2(-tp.x, -tp.z));
    // the hand in the model frame, and the pole's turn to point the tip at the target
    _mArm.identity();
    for (const n of ARM_CHAIN) { B[n].updateMatrix(); _mArm.multiply(B[n].matrix); }
    _qArm.setFromRotationMatrix(_mArm);
    _hand.copy(base.pole).applyMatrix4(_mArm);
    _dir.subVectors(tp, _hand);
    const len = _dir.length();
    _dir.multiplyScalar(1 / Math.max(1e-4, len));
    _qWant.setFromUnitVectors(_up, _dir);
    _qPM.copy(_qArm).invert().multiply(_qWant);
    B.pole.quaternion.slerp(_qPM, w);
    const slide = Math.min(0.18, Math.max(-1.3, len - POLE_TIP)) * w;
    _ax.set(0, 1, 0).applyQuaternion(B.pole.quaternion);
    B.pole.position.copy(base.pole).addScaledVector(_ax, slide);
    // the loop hangs from the tip in the model frame, whatever the pole does
    _qPM.copy(_qArm).multiply(B.pole.quaternion);
    _qWant.setFromEuler(_eLoop.set(aim.swingX, 0, aim.swingZ));
    _qWant.premultiply(_qArm.copy(_qPM).invert());
    B.loop.quaternion.slerp(_qWant, w);
    B.loop.scale.setScalar((1 + (aim.snug - 1) * w) * loopOn);
    B.pole.updateMatrix();
    aim.tipOut.copy(B.pole.position).applyMatrix4(_mArm).add(_ax.set(0, POLE_TIP, 0).applyQuaternion(_qPM));
    aimSet = true;
  }

  // ---- tools in hand and on the pack (the tool ring calls setTool), and the looks
  const tool = { id: 'loop_pole', shown: 'loop_pole', pose: 'pole', swap: 0, hold: 0, free: 0, reach: 0, stowed: { flags: false, loggers: false, pole: true } };
  const SWAP = 0.36; // seconds: a reach back to the pack and out again
  const HIDE = 1e-4; // a bone scaled to this hides its part
  function applyVisibility() {
    const s = tool.shown;
    B.pole.scale.setScalar(s === 'loop_pole' ? 1 : HIDE);
    for (const n of HOLD_BONES) B[n].scale.setScalar(TOOL_HOLD[s] === n ? 1 : HIDE);
    B.stowPole.scale.setScalar(s === 'loop_pole' || !tool.stowed.pole ? HIDE : 1); // (no pole at all before the opening finds it)
    B.stowFlags.scale.setScalar(s !== 'flags' && tool.stowed.flags ? 1 : HIDE);
    B.stowLogger.scale.setScalar(s !== 'loggers' && tool.stowed.loggers ? 1 : HIDE);
    B.stowTape.scale.setScalar(s !== 'tape' ? 1 : HIDE);
  }
  // id: loop_pole, flags, loggers, backpacks, tape, or null for empty hands; opts: { instant,
  // pose } where pose is 'pole', 'hold' or 'free' (a tool with no model here is held
  // in an open hand)
  function setTool(id, opts = {}) {
    const instant = opts === true || !!(opts && opts.instant);
    id = id || null;
    tool.pose = (opts && opts.pose) || (id === 'loop_pole' ? 'pole' : id ? 'hold' : 'free');
    if (id === tool.id && !instant) return;
    tool.id = id;
    if (instant) { tool.shown = id; tool.swap = 0; applyVisibility(); } else tool.swap = SWAP;
  }
  function setStowed(o) {
    Object.assign(tool.stowed, o);
    applyVisibility();
  }
  // Right arm: holding a tool in front, swinging free, or reaching back to the pack.
  function toolPose(dt, swing, sR, c) {
    if (tool.swap > 0) {
      tool.swap = Math.max(0, tool.swap - dt);
      if (tool.swap <= SWAP / 2 && tool.shown !== tool.id) { tool.shown = tool.id; applyVisibility(); }
    }
    const k = Math.min(1, dt * 12);
    const s = tool.shown;
    const pose = s === tool.id ? tool.pose : s === 'loop_pole' ? 'pole' : s ? 'hold' : 'free';
    tool.hold += ((s !== 'loop_pole' && pose === 'hold' ? 1 : 0) - tool.hold) * k;
    tool.free += ((s !== 'loop_pole' && pose === 'free' ? 1 : 0) - tool.free) * k;
    tool.reach = tool.swap > 0 ? Math.sin((1 - tool.swap / SWAP) * Math.PI) : 0;
    const h = tool.hold, f = tool.free, r = tool.reach;
    if (h + f + r < 1e-3) return;
    let ax = B.armR.rotation.x, az = B.armR.rotation.z;
    ax += (0.78 + swing * 0.12 * sR + c * 0.3 - ax) * h;
    az += (0.06 - az) * h;
    ax += (-swing * sR + c * 0.35 - ax) * f;
    az += (0.14 - az) * f;
    ax += (-0.55 - ax) * r;
    az += (0.42 - az) * r;
    B.armR.rotation.x = ax;
    B.armR.rotation.z = az;
    // held tools stay upright in the hand
    for (const n of HOLD_BONES) { B[n].rotation.x = -ax * 0.85 - B.spine.rotation.x; B[n].rotation.z = -az; }
  }
  applyVisibility();
  update(0, { speed: 0, crouch: 0, jog: 0, t: 0 });

  const colAttr = geo.attributes.color;
  const _col = new THREE.Color();
  function paint(key, colour) {
    const list = geo.userData.ranges[key];
    if (!list) return;
    _col.set(colour);
    for (const [o, n] of list) for (let j = o; j < o + n; j++) colAttr.setXYZ(j, _col.r, _col.g, _col.b);
    colAttr.needsUpdate = true;
  }
  // { hat, shirt }: CSS colours for the bucket hat and the shirt (and its sleeves)
  function setLooks({ hat, shirt } = {}) {
    if (hat) paint('hat', hat);
    if (shirt) paint('shirt', shirt);
  }

  // 0 drawn in full .. 1 gone (the camera fades the player during the snug close-up)
  function setFade(k) {
    uFade.value = k > 0.01 ? Math.min(0.95, k) : 0;
  }

  return { group, mesh, outline, shadow, bones: B, update, aim, tool, setTool, setStowed, setLooks, setLoop, setFade };
}
