// James, the lab's lead scientist, as a cute low-poly field biologist (a stylised
// character, not a likeness): a backwards dark cap, a khaki-grey field shirt with
// rolled sleeves, light stubble, a big grin and a loop pole. One skinned mesh
// with a bone per part and a thin inverted-hull outline on the same skeleton: two
// draw calls. He idles at the field station, turns to face you, waves, talks with
// his hands, and now and then holds a lizard in a clear bag up to the light
// (pale blue film behind the lizard, a white highlight stripe, the neck twisted in
// his fist, so the lizard shows inside).
//
//   const james = buildJames(game);   scene.add(james.group);   james.update(dt, t)
//   james.place(x, z, heading), james.walkTo(x, z, speed) -> Promise, james.talking = true,
//   james.wave(), james.showBag(), james.showPole(on), james.position, james.heading, james.home

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { toonGradient } from '../player/avatar.js';

const COL = {
  skin: '#eab28c', stubble: '#d9a790', stubbleDot: '#b88d7d', cheek: '#ff9a8a', eye: '#2b2320', shine: '#ffffff', brow: '#4a3326',
  mouth: '#7a3431', teeth: '#fffaf0', tongue: '#ff8c8c', hair: '#4a3326',
  cap: '#2d3139', capStrap: '#434a55', capButton: '#3a4049',
  shirt: '#b9b49c', collar: '#cbc5ab', placket: '#a29d85', button: '#f1ecdc', pocket: '#aaa58c', cuff: '#d2ccb2',
  trousers: '#6c6852', belt: '#4d3a2c', buckle: '#d9c38a', boot: '#7a5236', sole: '#3f2c22', lace: '#efe3c6',
  pole: '#d9b56c', node: '#b08f4f', grip: '#4a3b35', cord: '#ff6f61',
  bag: '#cfe9f7', bagRim: '#a9d3ea', glint: '#ffffff', tie: '#ffffff', lizard: '#93a758', lizardDark: '#6d7f3c', lizardEye: '#2b2320',
  outline: '#3a2f2a',
};

const BONES = [
  ['root', -1, [0, 0, 0]],
  ['hips', 0, [0, 0.52, 0]],
  ['spine', 1, [0, 0.58, 0]],
  ['head', 2, [0, 1.02, 0]],
  ['armL', 2, [-0.225, 0.96, 0]],
  ['armR', 2, [0.225, 0.96, 0]],
  ['pole', 5, [0.25, 0.58, -0.02]],
  ['loop', 6, [0.25, 2.5, -0.02]],
  ['bag', 4, [-0.25, 0.58, -0.01]],
  ['thighL', 1, [-0.1, 0.51, 0]],
  ['shinL', 9, [-0.1, 0.3, 0]],
  ['footL', 10, [-0.1, 0.09, 0]],
  ['thighR', 1, [0.1, 0.51, 0]],
  ['shinR', 12, [0.1, 0.3, 0]],
  ['footR', 13, [0.1, 0.09, 0]],
];
const BI = Object.fromEntries(BONES.map((b, i) => [b[0], i]));
const L_THIGH = 0.21, L_SHIN = 0.21, ANKLE_Y = 0.09;
const OUTLINE = 0.013;
const HEAD = { c: [0, 1.3, 0], r: [0.28 * 1.03, 0.28 * 0.95, 0.28 * 0.97] };
const WALK_SPEED = 1.35;
const HIDE = 1e-4;

// ---------------------------------------------------------------- geometry helpers

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _s = new THREE.Vector3();
function place(geo, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
  geo.applyMatrix4(_m);
  return geo;
}
const cyl = (rt, rb, y0, y1, x = 0, z = 0, seg = 10) => place(new THREE.CylinderGeometry(rt, rb, y1 - y0, seg, 1), x, (y0 + y1) / 2, z);
const sph = (r, x, y, z, sx = 1, sy = 1, sz = 1, detail = 1) => place(new THREE.IcosahedronGeometry(r, detail), x, y, z, sx, sy, sz);
const rbox = (w, h, d, rad, x, y, z, rx = 0, ry = 0, rz = 0) => place(new RoundedBoxGeometry(w, h, d, 2, rad), x, y, z, 1, 1, 1, rx, ry, rz);
const shell = (r, phi0, phiLen, th0, thLen, x, y, z, sx, sy, sz, w = 18, h = 10) =>
  place(new THREE.SphereGeometry(r, w, h, phi0, phiLen, th0, thLen), x, y, z, sx, sy, sz);
const tube = (pts, r, seg = 20) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), seg, r, 5, false);

// Wraps a flat shape drawn facing -z onto the front of the head, lifted off it.
function onHead(geo, lift) {
  const a = geo.attributes.position, v = new THREE.Vector3();
  const [cx, cy, cz] = HEAD.c, [rx, ry, rz] = HEAD.r;
  for (let i = 0; i < a.count; i++) {
    v.fromBufferAttribute(a, i);
    v.set((v.x - cx) / rx, (v.y - cy) / ry, (v.z - cz) / rz).normalize();
    const n = new THREE.Vector3(v.x / rx, v.y / ry, v.z / rz).normalize();
    a.setXYZ(i, cx + v.x * rx + n.x * lift, cy + v.y * ry + n.y * lift, cz + v.z * rz + n.z * lift);
  }
  return geo;
}

function buildGeometry() {
  const parts = [];
  // speckle: [colour, share] paints that share of the part's triangles in a second colour
  const add = (bone, color, geo, { smooth = false, outline = 0.6, speckle = null } = {}) =>
    parts.push({ bone: BI[bone], color: new THREE.Color(color), geo, smooth, outline, speckle: speckle && [new THREE.Color(speckle[0]), speckle[1]] });

  // legs: field trousers, boots with laces
  for (const [side, sx] of [['L', -0.1], ['R', 0.1]]) {
    add('thigh' + side, COL.trousers, cyl(0.078, 0.07, 0.28, 0.53, sx, 0, 10));
    add('shin' + side, COL.trousers, cyl(0.07, 0.066, 0.16, 0.31, sx, 0, 10));
    add('shin' + side, COL.boot, cyl(0.077, 0.075, 0.07, 0.19, sx, 0, 10));
    add('foot' + side, COL.boot, rbox(0.14, 0.1, 0.22, 0.045, sx, 0.058, -0.04));
    add('foot' + side, COL.lace, rbox(0.06, 0.02, 0.08, 0.009, sx, 0.108, -0.07, 0.25, 0, 0), { outline: 0 });
    add('foot' + side, COL.sole, rbox(0.15, 0.03, 0.235, 0.012, sx, 0.013, -0.042));
  }
  add('hips', COL.trousers, sph(0.205, 0, 0.53, 0, 1, 0.55, 0.85, 2), { smooth: true, outline: 1 });
  add('hips', COL.belt, cyl(0.19, 0.196, 0.56, 0.6, 0, 0, 14));
  add('hips', COL.buckle, rbox(0.06, 0.042, 0.02, 0.008, 0, 0.58, -0.172), { outline: 0 });

  // torso: the field shirt, collar, placket and buttons, two flap pockets and a pen
  add('spine', COL.shirt, sph(0.22, 0, 0.8, 0, 1, 1.2, 0.84, 2), { smooth: true, outline: 1 });
  add('spine', COL.placket, rbox(0.035, 0.36, 0.02, 0.008, 0, 0.8, -0.181, -0.08, 0, 0), { outline: 0 });
  for (const y of [0.7, 0.8, 0.9]) add('spine', COL.button, sph(0.011, 0, y, -0.193 + (y - 0.8) * 0.06, 1, 1, 0.5, 0), { outline: 0 });
  for (const x of [-0.105, 0.105]) {
    const ry = x > 0 ? -0.5 : 0.5;
    add('spine', COL.pocket, rbox(0.085, 0.08, 0.02, 0.01, x, 0.86, -0.166, -0.1, ry, 0), { outline: 0 });
    add('spine', COL.placket, rbox(0.09, 0.028, 0.026, 0.008, x, 0.9, -0.17, -0.1, ry, 0), { outline: 0 });
  }
  add('spine', COL.cord, cyl(0.008, 0.008, 0.88, 0.95, 0.115, -0.172, 6), { outline: 0 });
  add('spine', COL.skin, sph(0.042, 0, 1.0, -0.172, 1, 1.25, 0.45, 1), { smooth: true, outline: 0 });
  for (const s of [-1, 1]) {
    add('spine', COL.collar, place(new THREE.ConeGeometry(0.036, 0.075, 3), s * 0.05, 0.985, -0.186, 1, 1, 0.35, Math.PI - 0.35, 0, s * 0.55), { outline: 0 });
  }

  // arms: puffy sleeves rolled up above the elbow, bare forearms, round hands
  for (const [side, sx] of [['L', -0.24], ['R', 0.24]]) {
    const o = sx > 0 ? 0.008 : -0.008;
    add('arm' + side, COL.shirt, sph(0.088, sx, 0.94, 0, 1, 1.1, 1, 2), { smooth: true, outline: 1 });
    add('arm' + side, COL.cuff, cyl(0.07, 0.074, 0.84, 0.89, sx + o, 0, 12), { outline: 0.6 });
    add('arm' + side, COL.skin, cyl(0.05, 0.046, 0.62, 0.85, sx + o * 2, 0, 10), { outline: 0.8 });
    add('arm' + side, COL.skin, sph(0.064, sx + o * 2, 0.585, -0.005, 1, 1.05, 1, 2), { smooth: true, outline: 1 });
  }

  // head: a big round face with light stubble on the jaw, a big grin, ears, hair
  add('head', COL.skin, sph(0.28, ...HEAD.c, 1.03, 0.95, 0.97, 3), { smooth: true, outline: 1 });
  // the stubble: a cooler, darker band round the jaw and chin, speckled so it reads at a
  // distance as a light beard shadow
  add('head', COL.stubble, shell(0.2814, 1.5 * Math.PI - 0.85, 1.7, 0.69 * Math.PI, 0.23 * Math.PI, ...HEAD.c, 1.03, 0.95, 0.97, 30, 7), { smooth: true, outline: 0, speckle: [COL.stubbleDot, 0.22] });
  add('head', COL.hair, sph(0.29, 0, 1.33, 0.045, 1.03, 0.94, 0.97, 3), { smooth: true, outline: 1 });
  for (const s of [-1, 1]) {
    add('head', COL.hair, rbox(0.035, 0.1, 0.07, 0.015, s * 0.272, 1.27, -0.03, 0, 0, 0), { outline: 0 });
    add('head', COL.skin, sph(0.052, s * 0.288, 1.285, 0.015, 0.55, 1, 0.9, 1), { smooth: true, outline: 0.8 });
  }
  for (const x of [-0.1, 0.1]) {
    add('head', COL.eye, sph(0.041, x, 1.325, -0.255, 0.85, 1.05, 0.5, 2), { smooth: true, outline: 0 });
    add('head', COL.shine, sph(0.013, x + 0.013, 1.342, -0.273, 1, 1, 0.5, 1), { smooth: true, outline: 0 });
    add('head', COL.cheek, sph(0.036, x * 1.72, 1.245, -0.22, 1, 0.6, 0.45, 2), { smooth: true, outline: 0 });
    add('head', COL.brow, rbox(0.075, 0.018, 0.02, 0.008, x, 1.41, -0.252, -0.2, 0, x > 0 ? 0.12 : -0.12), { outline: 0 });
  }
  add('head', COL.skin, sph(0.024, 0, 1.275, -0.284, 1.1, 0.9, 0.9, 1), { smooth: true, outline: 0 });
  // the grin: a wide open smile with a row of teeth and a pink tongue, wrapped onto the face
  add('head', COL.mouth, onHead(place(new THREE.CircleGeometry(0.088, 20, Math.PI, Math.PI), 0, 1.222, -0.3, 1, 0.8, 1), 0.005), { outline: 0 });
  add('head', COL.teeth, onHead(place(new THREE.PlaneGeometry(0.152, 0.026, 10, 1), 0, 1.208, -0.3), 0.0065), { outline: 0 });
  add('head', COL.tongue, onHead(place(new THREE.CircleGeometry(0.04, 12, Math.PI, Math.PI), 0, 1.172, -0.3, 1.25, 0.6, 1), 0.006), { outline: 0 });

  // the cap, on backwards: a dark crown, band and button, the peak over the nape, and
  // the strap gap over the forehead with hair showing through it
  add('head', COL.cap, shell(0.302, 0, 2 * Math.PI, 0, 0.5 * Math.PI, 0, 1.4, 0.01, 1.02, 0.72, 1.0, 20, 6), { smooth: true, outline: 0.8 });
  add('head', COL.cap, cyl(0.302, 0.305, 1.36, 1.41, 0, 0.01, 20), { outline: 0.5 });
  add('head', COL.capButton, sph(0.026, 0, 1.617, 0.01, 1, 0.6, 1, 1), { smooth: true, outline: 0 });
  add('head', COL.cap, place(new THREE.CylinderGeometry(0.21, 0.21, 0.024, 20, 1, false, -Math.PI / 2, Math.PI), 0, 1.4, 0.3, 1.05, 1, 1.35, 0.3, 0, 0), { outline: 0.4 });
  add('head', COL.hair, sph(0.048, 0, 1.43, -0.283, 1.35, 0.75, 0.4, 1), { smooth: true, outline: 0 });
  add('head', COL.capStrap, rbox(0.13, 0.02, 0.012, 0.006, 0, 1.392, -0.3), { outline: 0 });

  // the loop pole, planted by his right foot, the coral loop hanging from the tip
  const px = 0.25, pz = -0.02;
  add('pole', COL.pole, cyl(0.015, 0.017, 0.02, 2.5, px, pz, 8), { outline: 0 });
  for (let y = 0.8; y < 2.45; y += 0.36) add('pole', COL.node, cyl(0.019, 0.019, y, y + 0.022, px, pz, 8), { outline: 0 });
  add('pole', COL.grip, cyl(0.022, 0.022, 0.48, 0.68, px, pz, 8), { outline: 0 });
  add('pole', COL.cord, cyl(0.0035, 0.0035, 1.1, 2.5, px + 0.018, pz, 4), { outline: 0 });
  add('loop', COL.cord, cyl(0.004, 0.004, 2.4, 2.51, px, pz, 4), { outline: 0 });
  add('loop', COL.cord, sph(0.02, px, 2.41, pz, 1, 1, 1, 1), { smooth: true, outline: 0 });
  add('loop', COL.cord, place(new THREE.TorusGeometry(0.1, 0.012, 6, 20), px, 2.3, pz), { smooth: true, outline: 0 });

  // the clear bag in his left hand: a pale blue film behind the lizard (both faces of
  // the back half, so it shows from either side), a rim round the open front, one white
  // highlight stripe, and the neck twisted up into his fist; a lizard inside
  const bx = -0.25, bz = -0.01, top = 0.53, bot = 0.29, w = 0.085, d = 0.05;
  const profile = [[0.001, bot - 0.012], [w * 0.55, bot - 0.006], [w * 0.9, bot + 0.03], [w, bot + 0.09], [w * 0.95, bot + 0.15], [w * 0.78, top - 0.05], [w * 0.45, top - 0.015], [0.016, top]];
  // the inside a touch smaller, so the outline pass (the back faces, no offset here)
  // never shows through it
  const film = (flip) => {
    const k = flip ? 0.96 : 1;
    const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r * k, y)), 12, -Math.PI / 2, Math.PI);
    g.scale(1, 1, d / w);
    g.translate(bx, 0, bz);
    if (flip) { // the inside, seen through the open front
      const idx = g.index.array;
      for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    }
    return g;
  };
  add('bag', COL.bag, film(false), { outline: 0 });
  add('bag', COL.bag, film(true), { outline: 0 });
  // the rim where the film's two halves meet, down each side and under the bottom
  add('bag', COL.bagRim, tube(profile.map(([r, y]) => [bx - r, y, bz]), 0.0045, 16), { smooth: true, outline: 0 });
  add('bag', COL.bagRim, tube(profile.map(([r, y]) => [bx + r, y, bz]), 0.0045, 16), { smooth: true, outline: 0 });
  // one white highlight stripe down the front, off to one side of the lizard
  add('bag', COL.glint, tube([[bx + w * 0.62, top - 0.06, bz - d * 0.55], [bx + w * 0.78, bot + 0.14, bz - d * 0.62], [bx + w * 0.7, bot + 0.05, bz - d * 0.5]], 0.0055, 10), { smooth: true, outline: 0 });
  // the neck twisted into a little spiral above the bag, a white tie round it
  for (let k = 0; k < 4; k++) {
    add('bag', COL.bag, place(new THREE.ConeGeometry(0.02 - k * 0.002, 0.022, 5, 1), bx, top + 0.008 + k * 0.016, bz, 1, 1, 0.8, 0, k * 0.9, 0), { outline: 0 });
  }
  add('bag', COL.tie, cyl(0.013, 0.013, top + 0.03, top + 0.042, bx, bz, 8), { outline: 0 });
  // the lizard: curled up in the bottom of the bag, head up to the light
  const lz = [bx, bot + 0.035, bz];
  add('bag', COL.lizard, sph(0.03, lz[0], lz[1], lz[2], 0.75, 1.5, 0.75, 1), { smooth: true, outline: 0 });
  add('bag', COL.lizard, sph(0.022, lz[0] + 0.005, lz[1] + 0.058, lz[2] - 0.01, 0.9, 1.3, 1.1, 1), { smooth: true, outline: 0 });
  for (const s of [-1, 1]) add('bag', COL.lizardEye, sph(0.006, lz[0] + 0.005 + s * 0.017, lz[1] + 0.066, lz[2] - 0.012, 1, 1, 1, 0), { outline: 0 });
  add('bag', COL.lizardDark, tube([[lz[0], lz[1] - 0.04, lz[2]], [lz[0] + 0.04, lz[1] - 0.05, lz[2] + 0.02], [lz[0] + 0.055, lz[1] - 0.01, lz[2] - 0.02], [lz[0] + 0.03, lz[1] + 0.02, lz[2] - 0.035]], 0.008, 12), { smooth: true, outline: 0 });
  for (const [ox, oy] of [[-0.028, 0.02], [0.028, 0.02], [-0.026, -0.03], [0.026, -0.03]]) {
    add('bag', COL.lizardDark, sph(0.009, lz[0] + ox, lz[1] + oy, lz[2] - 0.005, 1.4, 0.8, 1, 0), { outline: 0 });
  }

  // merge into one non-indexed geometry with skin weights and an outline direction
  let n = 0;
  const flat = parts.map((p) => {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    if (g.attributes.uv) g.deleteAttribute('uv');
    if (!p.smooth) {
      g.deleteAttribute('normal');
      g.computeVertexNormals();
    } else if (!g.attributes.normal) g.computeVertexNormals();
    g.computeBoundingSphere();
    n += g.attributes.position.count;
    return { ...p, geo: g };
  });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), oln = new Float32Array(n * 3);
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const v = new THREE.Vector3(), rad = new THREE.Vector3();
  let o = 0;
  for (const p of flat) {
    const a = p.geo.attributes;
    pos.set(a.position.array, o * 3);
    nor.set(a.normal.array, o * 3);
    const c = p.geo.boundingSphere.center;
    for (let k = 0; k < a.position.count; k++) {
      const j = o + k;
      // a speckled part: some whole triangles in the second colour (a fixed hash)
      const tri = (k / 3) | 0;
      const cc = p.speckle && ((Math.imul(tri + 7, 2654435761) >>> 0) % 1000) / 1000 < p.speckle[1] ? p.speckle[0] : p.color;
      col[j * 3] = cc.r; col[j * 3 + 1] = cc.g; col[j * 3 + 2] = cc.b;
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
  return geo;
}

function outlineMaterial() {
  const m = new THREE.MeshBasicMaterial({ color: COL.outline, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aOutline;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed += aOutline * ${OUTLINE.toFixed(4)};`);
  };
  m.customProgramCacheKey = () => 'james-outline-1';
  return m;
}

// ---------------------------------------------------------------- animation helpers

const smooth = (e0, e1, v) => { const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const wrap = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
function legIK(f, D, out) {
  const d = Math.min(L_THIGH + L_SHIN - 1e-4, Math.max(0.05, Math.hypot(f, D)));
  const alpha = Math.atan2(f, D);
  const cb = (L_THIGH * L_THIGH + d * d - L_SHIN * L_SHIN) / (2 * L_THIGH * d);
  const cg = (L_THIGH * L_THIGH + L_SHIN * L_SHIN - d * d) / (2 * L_THIGH * L_SHIN);
  out.thigh = alpha + Math.acos(Math.min(1, Math.max(-1, cb)));
  out.shin = -(Math.PI - Math.acos(Math.min(1, Math.max(-1, cg))));
  return out;
}

// ---------------------------------------------------------------- James

export function buildJames(game) {
  const { data, collision, player } = game;
  const T = data.terrain;
  const geo = buildGeometry();
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });
  mat.shadowSide = THREE.BackSide;
  const bones = BONES.map(([name, parent, p]) => {
    const b = new THREE.Bone();
    b.name = name;
    const pp = parent >= 0 ? BONES[parent][2] : [0, 0, 0];
    b.position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
    return b;
  });
  BONES.forEach(([, parent], i) => { if (parent >= 0) bones[parent].add(bones[i]); });
  const skeleton = new THREE.Skeleton(bones);
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.name = 'james';
  mesh.add(bones[0]);
  mesh.bind(skeleton);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const outline = new THREE.SkinnedMesh(geo, outlineMaterial());
  outline.name = 'james-outline';
  outline.bind(skeleton, mesh.bindMatrix);
  outline.frustumCulled = false;
  const group = new THREE.Group();
  group.name = 'james';
  group.add(mesh, outline);

  const B = Object.fromEntries(bones.map((b) => [b.name, b]));
  const base = Object.fromEntries(bones.map((b) => [b.name, b.position.clone()]));
  const ik = { thigh: 0, shin: 0 };

  const position = new THREE.Vector3();
  const home = { x: 0, z: 0, heading: 0 };
  // the numbers that change every frame, in one object (closure lets holding numbers
  // that change each frame would be boxed anew every frame)
  const st = { heading: 0, phase: 0, move: 0, bagT: 0, bagK: 0, nextBag: 9 + Math.random() * 8, waveT: 0, waveK: 0, talkK: 0, talkT: 0, pole: 1 };
  let walk = null; // { x, z, resolve }
  let faceYaw = null;
  let collider = null; // a moving solid circle (collision.addDynamic)
  const head = new THREE.Vector3();
  const _v = new THREE.Vector3();
  const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _yAxis = new THREE.Vector3(0, 1, 0);

  function sync() {
    position.y = Math.max(0, T.heightAt(position.x, position.z));
    group.position.copy(position);
    group.rotation.y = st.heading;
    if (collision && collision.addDynamic) {
      if (!collider) collider = collision.addDynamic(position.x, position.z, 0.3);
      else collision.setDynamic(collider, position.x, position.z, james.solid ? 0.3 : 0);
    }
  }

  function leg(side, f, lift, hipY) {
    const D = hipY + base['thigh' + side].y - (ANKLE_Y + lift);
    legIK(f, D, ik);
    B['thigh' + side].rotation.x = ik.thigh;
    B['shin' + side].rotation.x = ik.shin;
    B['foot' + side].rotation.x = -(ik.thigh + ik.shin) + lift * 1.2;
  }

  const james = {
    group, mesh, outline, bones: B, position, home,
    get heading() { return st.heading; },
    talking: false,
    solid: true,
    lookAtPlayer: true,
    headPosition(out) { return out.set(position.x, position.y + 1.4, position.z); },

    place(x, z, h = st.heading) {
      position.set(x, 0, z);
      st.heading = h;
      if (walk) walk.resolve(false);
      walk = null;
      sync();
    },
    setHome(x, z, h) { home.x = x; home.z = z; home.heading = h; },
    // speed: m/s (a brisk 1.7 for the opening's walk up the causeway)
    walkTo(x, z, speed = WALK_SPEED) {
      if (walk) walk.resolve(false);
      return new Promise((resolve) => { walk = { x, z, resolve, speed }; });
    },
    goHome() { return james.walkTo(home.x, home.z); },
    wave() { st.waveT = 1.8; },
    showBag() { if (st.bagT <= 0) st.bagT = 4.2; },
    // his loop pole in his hand, or not (the opening: it was on the table the ibises
    // knocked over, so it is back in his hand once the station is set right)
    showPole(on) { st.pole = on ? 1 : 0; },
    face(yaw) { faceYaw = yaw; },

    update(dt, t) {
      // walking towards a target
      let speed = 0;
      if (walk) {
        const dx = walk.x - position.x, dz = walk.z - position.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.06) {
          const w = walk;
          walk = null;
          w.resolve(true);
        } else {
          const step = Math.min(d, walk.speed * dt);
          position.x += (dx / d) * step;
          position.z += (dz / d) * step;
          speed = walk.speed;
          const want = Math.atan2(-dx, -dz);
          st.heading = wrap(st.heading + wrap(want - st.heading) * Math.min(1, dt * 8));
        }
      }
      // turning to the player when near or talking, else to his home heading
      const px = player.position.x - position.x, pz = player.position.z - position.z;
      const pd = Math.hypot(px, pz);
      if (!walk) {
        let want = faceYaw != null ? faceYaw : home.heading;
        if (james.lookAtPlayer && (james.talking || pd < 6)) want = Math.atan2(-px, -pz);
        st.heading = wrap(st.heading + wrap(want - st.heading) * Math.min(1, dt * 3.2));
      }
      // a wave when you come close after being away
      if (pd > 12) james._away = true;
      if (james._away && pd < 7 && !james.talking) { james._away = false; james.wave(); }
      // now and then, a lizard in a bag up to the light
      if (!walk && !james.talking && st.waveT <= 0) {
        st.nextBag -= dt;
        if (st.nextBag <= 0) { james.showBag(); st.nextBag = 14 + Math.random() * 12; }
      }
      if (st.bagT > 0) st.bagT = Math.max(0, st.bagT - dt);
      if (st.waveT > 0) st.waveT = Math.max(0, st.waveT - dt);
      if (james.talking) st.talkT += dt;
      const bagW = st.bagT > 0 ? smooth(0, 0.7, 4.2 - st.bagT) * smooth(0, 0.7, st.bagT) : 0;
      st.bagK += (bagW - st.bagK) * Math.min(1, dt * 10);
      st.waveK += ((st.waveT > 0 ? smooth(0, 0.3, st.waveT) : 0) - st.waveK) * Math.min(1, dt * 8);
      st.talkK += ((james.talking ? 1 : 0) - st.talkK) * Math.min(1, dt * 5);
      animate(dt, t, speed, pd);
      sync();
    },
  };

  function animate(dt, t, speed, pd) {
    st.move += (smooth(0.05, 0.5, speed) - st.move) * Math.min(1, dt * 8);
    const stride = 0.11 + 0.04 * speed;
    st.phase += (speed / stride) * 0.5 * dt;
    const A = 0.2 * st.move;
    const liftH = 0.045 * st.move;
    const bob = st.move * 0.014 * Math.abs(Math.cos(st.phase));
    const breathe = Math.sin(t * 1.9) * 0.007 * (1 - st.move);
    const sway = Math.sin(t * 0.6) * 0.012 * (1 - st.move); // a gentle weight shift
    const hipY = base.hips.y - 0.012 - bob + breathe * 0.5;
    B.hips.position.y = hipY;
    B.hips.position.x = sway;
    B.hips.rotation.y = Math.sin(st.phase) * 0.1 * st.move;
    B.hips.rotation.z = -sway * 1.5;
    const sL = Math.sin(st.phase), sR = Math.sin(st.phase + Math.PI);
    leg('L', A * sL, liftH * Math.max(0, Math.cos(st.phase)), hipY);
    leg('R', A * sR, liftH * Math.max(0, Math.cos(st.phase + Math.PI)), hipY);

    B.spine.rotation.x = -0.04 * st.move + breathe - 0.05 * st.bagK;
    B.spine.rotation.y = -B.hips.rotation.y * 0.8;
    B.spine.rotation.z = sway * 1.2 + Math.sin(st.phase) * 0.03 * st.move;
    B.spine.scale.y = 1 + breathe;

    // head: look at the player's face when near, else a slow look round; up at the bag
    let hy = Math.sin(t * 0.33) * 0.3 + Math.sin(t * 0.11) * 0.15;
    let hx = -0.02;
    if (pd < 8 && james.lookAtPlayer) {
      player.headPosition(_v);
      head.set(position.x, position.y + 1.3, position.z);
      const lx = _v.x - head.x, ly = _v.y - head.y, lz = _v.z - head.z;
      const yaw = wrap(Math.atan2(-lx, -lz) - st.heading);
      hy = Math.max(-1.0, Math.min(1.0, yaw));
      hx = Math.max(-0.35, Math.min(0.35, Math.atan2(ly, Math.hypot(lx, lz))));
    }
    const nod = st.talkK * (Math.sin(t * 5.3) * 0.05 + Math.sin(t * 2.1) * 0.03);
    B.head.rotation.x = hx * (1 - st.bagK) + 0.5 * st.bagK + nod;
    B.head.rotation.y = hy * (1 - st.bagK) + 0.45 * st.bagK;
    B.head.rotation.z = Math.sin(t * 0.8) * 0.04 - 0.18 * st.bagK + st.talkK * Math.sin(t * 1.7) * 0.05;

    // right arm holds the pole upright; the pole leans a touch with each step
    const swing = 0.35 * st.move;
    B.armR.rotation.x = 0.22 + swing * 0.2 * sR;
    B.armR.rotation.z = 0.08;
    B.pole.rotation.x = -B.armR.rotation.x - B.spine.rotation.x + 0.04 * Math.sin(st.phase * 2) * st.move;
    B.pole.rotation.z = -B.armR.rotation.z - B.spine.rotation.z;
    B.loop.rotation.x = -B.pole.rotation.x - B.armR.rotation.x - B.spine.rotation.x + 0.05 * Math.sin(t * 1.3) + 0.15 * Math.sin(st.phase * 2 + 0.6) * st.move;
    B.loop.rotation.z = 0.04 * Math.sin(t * 0.9 + 1);
    B.pole.scale.setScalar(st.pole ? 1 : HIDE);

    // left arm: swinging, waving, talking with the hand, or the bag up to the light
    let ax = -swing * sL + 0.06, az = -0.12;
    const gest = st.talkK * (0.55 + 0.3 * Math.sin(t * 3.1) + 0.15 * Math.sin(t * 7.3));
    ax += (gest - ax) * st.talkK * 0.8;
    az += (-0.3 - az) * st.talkK * 0.6;
    ax += (2.75 - ax) * st.waveK;
    az += (-0.35 + Math.sin(t * 11) * 0.32 - az) * st.waveK;
    ax += (2.75 - ax) * st.bagK;
    az += (-0.42 - az) * st.bagK;
    B.armL.rotation.x = ax;
    B.armL.rotation.z = az;
    // the bag hangs straight down from the hand, turning gently in the light
    _qa.setFromEuler(B.hips.rotation).multiply(_qb.setFromEuler(B.spine.rotation)).multiply(_qb.setFromEuler(B.armL.rotation)).invert();
    B.bag.quaternion.copy(_qa).multiply(_qb.setFromAxisAngle(_yAxis, Math.sin(t * 1.4) * 0.5 * st.bagK));
    B.bag.scale.setScalar(st.bagK > 0.02 ? Math.min(1.35, st.bagK * 2.2) : HIDE);
  }

  animate(0, 0, 0, 99);
  return james;
}
