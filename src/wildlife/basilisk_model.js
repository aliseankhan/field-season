// The brown basilisk (Basiliscus vittatus) in the game's chibi toon style: a big round
// head with big eyes, an olive-brown body with two pale stripes down each side (eye to
// hip, lip to shoulder), a long banded whip tail and long hind legs with long toes. A male
// has a tall crest on the back of the head and low crests along the back and tail; a
// female has a small head crest. One skinned mesh and its inverted-hull outline on the same
// skeleton (two draw calls), on the rig and merge of james.js.
//
// Model frame: metres, y up, facing -z, the vent at the origin's z; the male drawn here is
// a 170 mm snout-vent length at the game's size (about twice real, like the anoles), and
// each basilisk is scaled from it by its own length.
//
//   const geo = basiliskGeometry('m' | 'f')   (made once per sex and shared)
//   const b = makeBasilisk(geo)  ->  { group, mesh, outline, bones, pose(P, t), setPack(colour | null) }
//   P: { pitch (nose up, rad), hipY, splay (0 tucked, 1 sprawled), gait (0 still, 1 four
//   legs, 2 two legs), phase, stride (0..1), headPitch, headYaw, tailLift, tailSway, bob }

import * as THREE from 'three';
import { mergeParts, place, sph } from '../story/james.js';
import { toonGradient } from '../player/avatar.js';

export const SVL = 0.32; // the drawn snout-vent length of the model (a 170 mm male)

const COL = {
  body: '#8a7444', back: '#76623a', band: '#5f4d2b', stripe: '#f6e6a4', belly: '#cdb985', lip: '#f3e5b4',
  leg: '#7c6739', toe: '#6a5731', crest: '#7d6234', crestEdge: '#94753f', eye: '#2b2320', iris: '#e2c35e',
  shine: '#ffffff', mouth: '#4a3426', outline: '#3a2f2a',
};
const OUTLINE = 0.0055;

// name, parent, bind position (model frame)
const BONES = [
  ['root', -1, [0, 0, 0]],
  ['hips', 0, [0, 0.096, 0]],
  ['spine', 1, [0, 0.1, -0.1]],
  ['chest', 2, [0, 0.106, -0.188]],
  ['head', 3, [0, 0.122, -0.232]],
  ['tail1', 1, [0, 0.096, 0.03]],
  ['tail2', 5, [0, 0.092, 0.21]],
  ['tail3', 6, [0, 0.086, 0.41]],
  ['tail4', 7, [0, 0.08, 0.61]],
  ['thighL', 1, [0.042, 0.092, 0.004]],
  ['shinL', 9, [0.052, 0.045, 0.004]],
  ['footL', 10, [0.052, -0.008, 0.004]],
  ['thighR', 1, [-0.042, 0.092, 0.004]],
  ['shinR', 12, [-0.052, 0.045, 0.004]],
  ['footR', 13, [-0.052, -0.008, 0.004]],
  ['armL', 3, [0.04, 0.094, -0.19]],
  ['foreL', 15, [0.046, 0.055, -0.19]],
  ['armR', 3, [-0.04, 0.094, -0.19]],
  ['foreR', 17, [-0.046, 0.055, -0.19]],
];
const BI = Object.fromEntries(BONES.map((b, i) => [b[0], i]));

// an ellipsoid on latitude rings (the stripes follow them cleanly)
const ell = (c, r, w = 18, h = 14) => place(new THREE.SphereGeometry(1, w, h), c[0], c[1], c[2], r[0], r[1], r[2]);

// a stripe painter for an ellipsoid part: the upper stripe at height `up` of the part
// (in its radii) and, where `low` is given, a lower one; cream on the sides only
function striped(c, r, { up = 0.5, low = null, belly = true } = {}) {
  const body = new THREE.Color(COL.body), back = new THREE.Color(COL.back), stripe = new THREE.Color(COL.stripe), bel = new THREE.Color(COL.belly);
  return (x, y, z) => {
    const nx = (x - c[0]) / r[0], ny = (y - c[1]) / r[1];
    const side = Math.abs(nx);
    if (belly && ny < -0.45) return bel;
    if (side > 0.45 && Math.abs(ny - up) < 0.14) return stripe;
    if (low != null && side > 0.55 && Math.abs(ny - low) < 0.12) return stripe;
    return ny > 0.75 ? back : body;
  };
}

// a flat fin in the yz plane (a crest), from an outline of [z, y] points, extruded thin
function fin(points, thick = 0.006) {
  const s = new THREE.Shape();
  points.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false, curveSegments: 4 });
  // shape x -> model z, shape y -> model y, extrusion -> model -x (a turn, not a mirror)
  g.applyMatrix4(new THREE.Matrix4().set(0, 0, -1, thick / 2, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1));
  return g;
}

// a cone along +z from (y0, z0) radius r0 to z1 radius r1
function along(r0, r1, y0, z0, y1, z1, seg = 9) {
  const len = Math.hypot(z1 - z0, y1 - y0);
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 3, false);
  g.rotateX(Math.PI / 2); // y axis -> +z (the top, r1, ends up at +z)
  g.rotateX(-Math.atan2(y1 - y0, z1 - z0));
  g.translate(0, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

const cache = {};
export function basiliskGeometry(sex = 'm') {
  if (cache[sex]) return cache[sex];
  const male = sex !== 'f';
  const parts = [];
  const add = (bone, colour, geo, { outline = 0.6, paint = null, smooth = false } = {}) =>
    parts.push({ bone: BI[bone], color: new THREE.Color(colour), geo, smooth, outline, speckle: null, paint });

  // the body: hips, belly and shoulders as three soft ellipsoids, striped on the sides
  const hipsC = [0, 0.098, -0.018], hipsR = [0.04, 0.038, 0.058];
  add('hips', COL.body, ell(hipsC, hipsR), { paint: striped(hipsC, hipsR, { up: 0.42 }) });
  const midC = [0, 0.102, -0.098], midR = [0.047, 0.044, 0.078];
  add('spine', COL.body, ell(midC, midR, 20, 16), { paint: striped(midC, midR, { up: 0.45 }) });
  const chC = [0, 0.106, -0.172], chR = [0.042, 0.042, 0.05];
  add('chest', COL.body, ell(chC, chR), { paint: striped(chC, chR, { up: 0.5, low: -0.25 }) });
  // the head: big and round, a short neck, a blunt snout
  const nkC = [0, 0.118, -0.222], nkR = [0.034, 0.036, 0.038];
  add('head', COL.body, ell(nkC, nkR, 16, 12), { paint: striped(nkC, nkR, { up: 0.5, low: -0.3 }) });
  const hdC = [0, 0.136, -0.27], hdR = [0.046, 0.046, 0.058];
  add('head', COL.body, ell(hdC, hdR, 20, 16), { paint: striped(hdC, hdR, { up: 0.12, low: -0.42, belly: false }) });
  const snC = [0, 0.124, -0.314], snR = [0.03, 0.029, 0.03];
  add('head', COL.body, ell(snC, snR, 14, 10), { paint: striped(snC, snR, { up: 9, low: -0.38, belly: false }) });
  // big eyes on the sides: a gold ring, a dark eye and a shine
  for (const s of [1, -1]) {
    add('head', COL.iris, sph(0.019, s * 0.035, 0.148, -0.282, 0.7, 1, 1, 2), { outline: 0 });
    add('head', COL.eye, sph(0.0155, s * 0.0405, 0.149, -0.284, 0.6, 1, 1, 2), { outline: 0 });
    add('head', COL.shine, sph(0.0052, s * 0.047, 0.155, -0.289, 0.6, 1, 1, 1), { outline: 0 });
  }
  // a small smile along the jaw
  for (const s of [1, -1]) {
    const g = new THREE.TorusGeometry(0.03, 0.0022, 4, 10, 1.0);
    g.rotateY(s * Math.PI / 2);
    g.rotateX(-0.25);
    g.translate(s * 0.0255, 0.138, -0.305);
    add('head', COL.mouth, g, { outline: 0, smooth: true });
  }

  // crests: the male's tall head crest, low crests along the back and the tail; a
  // female's small head crest
  if (male) {
    // a tall flap swept back from over the eyes to a point behind the head
    add('head', COL.crest, fin([[-0.3, 0.168], [-0.266, 0.196], [-0.236, 0.228], [-0.212, 0.252], [-0.199, 0.258], [-0.196, 0.244], [-0.203, 0.208], [-0.216, 0.163]], 0.007));
    add('head', COL.crestEdge, fin([[-0.221, 0.24], [-0.208, 0.254], [-0.199, 0.258], [-0.197, 0.246]], 0.009), { outline: 0 });
    const ridge = (z0, z1, y0, y1, h, n) => {
      const pts = [[z0, y0 - 0.01]];
      for (let k = 0; k <= n; k++) {
        const f = k / n, z = z0 + (z1 - z0) * f, y = y0 + (y1 - y0) * f;
        pts.push([z, y + (k % 2 ? h : h * 0.35)]);
      }
      pts.push([z1, y1 - 0.01]);
      return fin(pts, 0.006);
    };
    add('chest', COL.crest, ridge(-0.2, -0.13, 0.145, 0.142, 0.022, 6));
    add('spine', COL.crest, ridge(-0.13, -0.05, 0.142, 0.14, 0.02, 6));
    add('hips', COL.crest, ridge(-0.05, 0.03, 0.135, 0.13, 0.018, 6));
    add('tail1', COL.crest, fin([[0.03, 0.118], [0.05, 0.16], [0.1, 0.152], [0.16, 0.138], [0.21, 0.118]], 0.006));
  } else {
    add('head', COL.crest, fin([[-0.29, 0.172], [-0.26, 0.186], [-0.232, 0.2], [-0.215, 0.19], [-0.222, 0.165]], 0.006));
  }

  // the whip tail: four tapering lengths with dark bands
  const banded = (z0) => {
    const body = new THREE.Color(COL.body), band = new THREE.Color(COL.band);
    return (x, y, z) => (Math.floor((z - z0) / 0.045) % 2 === 1 ? band : body);
  };
  add('tail1', COL.body, along(0.03, 0.021, 0.098, 0.02, 0.092, 0.215), { paint: banded(0.02) });
  add('tail2', COL.body, along(0.021, 0.014, 0.092, 0.21, 0.086, 0.415), { paint: banded(0.02) });
  add('tail3', COL.body, along(0.014, 0.008, 0.086, 0.41, 0.08, 0.615), { paint: banded(0.02) });
  add('tail4', COL.body, along(0.008, 0.0025, 0.08, 0.61, 0.072, 0.87, 7), { paint: banded(0.02), outline: 0.3 });

  // long hind legs: a chunky thigh, a long shin, a long foot with long toes
  for (const [s, side] of [[1, 'L'], [-1, 'R']]) {
    add('thigh' + side, COL.leg, sph(1, s * 0.047, 0.068, 0.004, 0.02, 0.034, 0.021, 2));
    add('shin' + side, COL.leg, place(new THREE.CylinderGeometry(0.0085, 0.011, 0.054, 7, 1), s * 0.052, 0.018, 0.004), { outline: 0.5 });
    add('foot' + side, COL.toe, place(new THREE.SphereGeometry(1, 8, 6), s * 0.052, -0.009, -0.012, 0.012, 0.007, 0.024));
    for (const a of [-0.35, 0, 0.35]) {
      const g = along(0.0042, 0.0022, -0.011, 0, -0.013, -0.056, 5);
      g.rotateY(a);
      g.translate(s * 0.052, 0, -0.016);
      add('foot' + side, COL.toe, g, { outline: 0.4 });
    }
    // short front legs
    add('arm' + side, COL.leg, place(new THREE.CylinderGeometry(0.008, 0.01, 0.04, 7, 1), s * 0.043, 0.075, -0.19));
    add('fore' + side, COL.leg, place(new THREE.CylinderGeometry(0.0065, 0.008, 0.042, 7, 1), s * 0.046, 0.034, -0.19));
    add('fore' + side, COL.toe, place(new THREE.SphereGeometry(1, 7, 5), s * 0.047, 0.012, -0.2, 0.01, 0.006, 0.016));
  }
  cache[sex] = mergeParts(parts);
  return cache[sex];
}

let sharedMat = null, sharedOutline = null;
function materials() {
  if (!sharedMat) {
    sharedMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });
    sharedMat.shadowSide = THREE.BackSide;
    sharedOutline = new THREE.MeshBasicMaterial({ color: COL.outline, side: THREE.BackSide });
    sharedOutline.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aOutline;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed += aOutline * ${OUTLINE.toFixed(4)};`);
    };
    sharedOutline.customProgramCacheKey = () => 'basilisk-outline-1';
  }
  return [sharedMat, sharedOutline];
}

export function makeBasilisk(geo, name = 'basilisk') {
  const [mat, outMat] = materials();
  const bones = BONES.map(([n, parent, p]) => {
    const b = new THREE.Bone();
    b.name = n;
    const pp = parent >= 0 ? BONES[parent][2] : [0, 0, 0];
    b.position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
    return b;
  });
  BONES.forEach(([, parent], i) => { if (parent >= 0) bones[parent].add(bones[i]); });
  const skeleton = new THREE.Skeleton(bones);
  // made now rather than at its first draw (a texture takes an id from Math.random)
  skeleton.computeBoneTexture();
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.name = name;
  mesh.add(bones[0]);
  mesh.bind(skeleton);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // one sphere round every pose (the whip tail and the crest included), so the frustum
  // test never has to skin the vertices
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.12, 0.25), 0.72);
  const outline = new THREE.SkinnedMesh(geo, outMat);
  outline.name = name + '-outline';
  outline.bind(skeleton, mesh.bindMatrix);
  outline.boundingSphere = mesh.boundingSphere;
  const group = new THREE.Group();
  group.name = name;
  group.add(mesh, outline);
  const B = Object.fromEntries(bones.map((b) => [b.name, b]));
  const base = Object.fromEntries(bones.map((b) => [b.name, b.position.clone()]));

  // One frame of pose (see the header for P). The hind legs follow the gait; on two legs
  // the body is pitched up from the hips and the head and tail are brought back level.
  function pose(P, t) {
    const p = P.pitch, g = P.gait, ph = P.phase, st = P.stride;
    const two = g === 2 ? 1 : 0, four = g === 1 ? 1 : 0;
    const breath = Math.sin(t * 2.3) * 0.004 * (g ? 0 : 1);
    B.hips.position.y = P.hipY + breath + (two ? 0.012 * st * Math.abs(Math.sin(ph)) : four ? 0.006 * st * Math.abs(Math.sin(ph * 2)) : 0);
    B.hips.rotation.x = p;
    B.hips.rotation.y = four ? 0.12 * st * Math.sin(ph) : two ? 0.06 * st * Math.sin(ph) : 0;
    B.hips.rotation.z = two ? 0.05 * st * Math.sin(ph) : 0;
    B.spine.rotation.x = -0.05 * p;
    B.spine.rotation.y = four ? -0.16 * st * Math.sin(ph) : 0;
    B.chest.rotation.x = -0.08 * p;
    B.chest.rotation.y = four ? -0.1 * st * Math.sin(ph) : 0;
    // the head looks ahead, a little up
    B.head.rotation.x = -p * 0.82 + P.headPitch + P.bob;
    B.head.rotation.y = P.headYaw;
    // the tail: on two legs it streams out behind, raised; at rest it lies on the ground
    // (a positive rotation.x lowers the tail; tailLift raises it)
    const lift = P.tailLift;
    B.tail1.rotation.x = -p * 0.92 - lift;
    B.tail2.rotation.x = -p * 0.08 + lift * 0.3;
    B.tail3.rotation.x = lift * 0.35 + (g ? 0 : 0.02);
    B.tail4.rotation.x = g ? 0.08 : 0.03;
    const sw = P.tailSway;
    B.tail1.rotation.y = sw * 0.4 + (g ? 0.08 * st * Math.sin(ph + 1.2) : 0);
    B.tail2.rotation.y = sw * 0.5 + (g ? 0.12 * st * Math.sin(ph + 2.0) : 0);
    B.tail3.rotation.y = sw * 0.7 + (g ? 0.16 * st * Math.sin(ph + 2.8) : 0);
    B.tail4.rotation.y = sw + (g ? 0.2 * st * Math.sin(ph + 3.6) : 0);
    // hind legs: sprawled out at rest; under the body and pumping on the run
    const splay = P.splay;
    for (const [s, side, off] of [[1, 'L', 0], [-1, 'R', Math.PI]]) {
      const c = Math.sin(ph + off), up = Math.max(0, Math.cos(ph + off));
      const A = two ? 0.95 : four ? 0.6 : 0;
      const swing = A * st * c;
      B['thigh' + side].rotation.set(-p + swing + splay * 0.3, 0, s * (0.15 + 1.35 * splay));
      B['shin' + side].rotation.set(-(0.35 + (two ? 0.9 : 0.5) * st * up) - splay * 0.4, 0, -s * 1.12 * splay);
      B['foot' + side].rotation.set(p * (1 - splay) - swing * 0.6 + (two ? 0.6 * st * up : 0), 0, 0);
      // front legs: walking on four, folded back on two, splayed at rest
      const fc = Math.sin(ph + off + Math.PI);
      B['arm' + side].rotation.set(two ? -p * 0.4 + 0.9 : -0.08 * p + (four ? 0.55 * st * fc : 0) + splay * 0.25, 0, s * (two ? 0.25 : 0.2 + 1.15 * splay));
      B['fore' + side].rotation.set(two ? -1.4 : -0.25 - splay * 0.45 - (four ? 0.4 * st * Math.max(0, -fc) : 0), 0, -s * 1.0 * splay);
    }
  }

  // the GPS backpack, on the spine bone in the middle of the back (hidden until fitted)
  const pack = makePack(mat.gradientMap);
  B.spine.add(pack.group);
  const setPack = (colour) => {
    pack.group.visible = colour != null;
    if (colour != null) pack.mat.color.set(colour);
  };

  return { group, mesh, outline, bones: B, base, pose, setPack };
}

// The GPS backpack in the anoles' shape (anole.js: a rounded pack, a lid and a small block
// at the front), sized for the basilisk's back, on two straps round its middle. Vertex
// colours are only shading: the material's colour is the pack's. Spine-bone frame (the bone
// sits at model 0, 0.1, -0.1; the middle of the body is at 0, 0.002, 0.002 and its top
// about 0.046 above that).
let packGeo = null, packHull = null, packOutline = null;
function makePack(gradientMap) {
  if (!packGeo) {
    const parts = [
      [ell([0, 0.06, 0], [0.034, 0.02, 0.042], 14, 9), 1],
      [ell([0, 0.073, 0.006], [0.027, 0.009, 0.029], 12, 6), 0.72],
      [ell([0, 0.057, -0.041], [0.017, 0.012, 0.012], 8, 5), 0.84],
    ];
    for (const z of [-0.02, 0.024]) parts.push([place(new THREE.TorusGeometry(1, 0.13, 4, 28), 0, 0.002, z, 0.0478, 0.0448, 0.045), 0.66]);
    packGeo = joinShaded(parts);
    packHull = ell([0, 0.061, 0], [0.038, 0.024, 0.046], 14, 9);
    packOutline = new THREE.MeshBasicMaterial({ color: COL.outline, side: THREE.BackSide });
  }
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
  const body = new THREE.Mesh(packGeo, mat);
  body.name = 'basilisk-pack';
  body.castShadow = true;
  const hull = new THREE.Mesh(packHull, packOutline);
  const group = new THREE.Group();
  group.add(body, hull);
  group.visible = false;
  return { group, mat };
}

// geometries as one, each part a flat grey (its shade of the pack's colour)
function joinShaded(parts) {
  const flat = parts.map(([g, v]) => [g.index ? g.toNonIndexed() : g, v]);
  let n = 0;
  for (const [g] of flat) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const [g, v] of flat) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3); // (smooth, as placed)
    col.fill(v, o * 3, (o + c) * 3);
    o += c;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}
