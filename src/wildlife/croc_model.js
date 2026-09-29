// The crocodile: an American crocodile (Crocodylus acutus) made chunky and
// friendly. A long narrow tapered snout with a bulb at the nose, big eyes up on
// top of the head, a toothy grin, a pale grey-olive back with dark cross bands,
// a cream belly and a banded tail with a double crest of pale scutes.
//
// One merged geometry drawn as an InstancedMesh (both crocodiles in one draw
// call) plus an inverted-hull outline on the same instances. Everything moves
// in the vertex shader from three per-instance vec4s, so there are no bones:
//   aAnimA  swim phase, swim amplitude, body bend (1/m, + turns left), walk phase
//   aAnimB  walk amount, head pitch, jaw open, leg tuck (0 splayed, 1 folded back)
//   aAnimC  head yaw, blink, breath, tail curl
// Model frame: metres, y up, facing -z; s = -z runs from the tail tip (-1.6) to
// the snout tip (1.25); the belly rests on y = 0.

import * as THREE from 'three';

export const CROC = {
  length: 2.74,
  snout: 1.235, // s of the snout tip
  tail: -1.5,
  // Afloat the origin sits floatY below the surface, the body pitched nose up by
  // swimPitch and the head by swimHeadPitch, so only the eyes, the nose, a thin line
  // of snout between them and the scutes along the spine break the surface.
  floatY: -0.34,
  swimPitch: 0.05,
  swimHeadPitch: 0.2,
  bedY: -0.28, // lake bed height where the belly starts to take its weight
  neckS: 0.36,
  hingeS: 0.5,
  hingeY: 0.135,
};

export const PART = { BODY: 0, JAW: 1, FL: 2, FR: 3, BL: 4, BR: 5, EYE: 6 };

const COL = {
  back: '#8fa25e', // grey-olive
  side: '#b3be84',
  belly: '#f1e7bf',
  headTop: '#98a668',
  snout: '#b3ba86',
  jawSide: '#c9c898',
  mouth: '#f4969a',
  tongue: '#f7b3a3',
  gum: '#e9c9a8', // pale gums round the palate and the tongue
  scute: '#80925a',
  crest: '#dcc27f', // the pale tail crest in the clip
  leg: '#9eaa72',
  toe: '#7f8b58',
  claw: '#efe2c2',
  tooth: '#fffbef',
  eyeball: '#d7e46c', // yellow-green iris
  pupil: '#2b2320',
  shine: '#ffffff',
  nostril: '#3b3a2c',
  cheek: '#f4aaa2',
  outline: '#3a2f2a',
};
const OUTLINE = 0.013;

const smooth = (e0, e1, v) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const C = (hex) => new THREE.Color(hex);
const PAL = Object.fromEntries(Object.entries(COL).map(([k, v]) => [k, C(v)]));

// ---------------------------------------------------------------- profiles

// [s, half width, top, bottom] of the body and upper head. From s 0.48 forward
// the bottom is the mouth line, which curls up at the back into a grin.
const BODY_KEYS = [
  [-1.5, 0.012, 0.08, 0.05],
  [-1.36, 0.036, 0.11, 0.038],
  [-1.15, 0.064, 0.148, 0.028],
  [-0.92, 0.1, 0.19, 0.02],
  [-0.72, 0.15, 0.232, 0.01],
  [-0.55, 0.215, 0.276, 0.004],
  [-0.33, 0.285, 0.322, 0.0],
  [-0.1, 0.305, 0.338, 0.0],
  [0.12, 0.28, 0.328, 0.0],
  [0.28, 0.232, 0.31, 0.014],
  [0.4, 0.2, 0.296, 0.04],
  [0.48, 0.2, 0.3, 0.108],
  [0.56, 0.205, 0.302, 0.148],
  [0.64, 0.196, 0.294, 0.135],
  [0.72, 0.168, 0.26, 0.128],
  [0.82, 0.135, 0.222, 0.124],
  [0.94, 0.108, 0.196, 0.122],
  [1.04, 0.094, 0.186, 0.12],
  [1.12, 0.1, 0.194, 0.12],
  [1.18, 0.078, 0.186, 0.122],
  [1.215, 0.036, 0.17, 0.127],
  [1.235, 0.006, 0.156, 0.132],
];

// The lower jaw: top is the mouth line, a little narrower than the upper jaw and
// tapering to a point, so the open mouth is a V rather than a box.
const JAW_KEYS = [
  [0.34, 0.12, 0.07, 0.04],
  [0.44, 0.178, 0.1, 0.03],
  [0.56, 0.184, 0.143, 0.036],
  [0.64, 0.17, 0.13, 0.046],
  [0.75, 0.134, 0.124, 0.06],
  [0.88, 0.1, 0.12, 0.075],
  [1.0, 0.08, 0.118, 0.085],
  [1.1, 0.074, 0.116, 0.09],
  [1.18, 0.05, 0.118, 0.097],
  [1.22, 0.008, 0.122, 0.11],
];

// Catmull-Rom through the key rows, sampled at s.
function profile(keys, s) {
  let i = 0;
  while (i < keys.length - 2 && s > keys[i + 1][0]) i++;
  const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(keys.length - 1, i + 2)];
  const t = Math.min(1, Math.max(0, (s - k1[0]) / (k2[0] - k1[0])));
  const out = [s, 0, 0, 0];
  for (let c = 1; c < 4; c++) {
    const p0 = k0[c], p1 = k1[c], p2 = k2[c], p3 = k3[c];
    out[c] = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  }
  out[1] = Math.max(0.004, out[1]);
  return out;
}

// Superellipse exponents: squarish, chunky sections, rounding off towards the snout
// tip (and a softer lower jaw), so the open mouth reads as a V from the front.
const EXP = 2.7;
const EXP_BODY = (s) => EXP - 0.75 * smooth(0.98, 1.2, s);
const EXP_JAW = (s) => 2.45 - 0.45 * smooth(0.9, 1.18, s);
const sgnPow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);
// Share of each section's height below its widest line: the body is a little
// flat-bellied, the upper jaw flat underneath and the lower jaw flat on top, so
// the two meet along the sides in a mouth line.
const MID_BODY = (s) => 0.42 - 0.34 * smooth(0.42, 0.53, s);
const MID_JAW = () => 0.86;

// A point on a section at angle a (0 right side, pi/2 top).
function sectionPoint(pr, mid, a, out, e = EXP) {
  const [s, w, top, bot] = pr;
  const yc = bot + (top - bot) * mid;
  const c = Math.cos(a), sn = Math.sin(a);
  out[0] = w * sgnPow(c, 2 / e);
  out[1] = yc + (sn >= 0 ? top - yc : yc - bot) * sgnPow(sn, 2 / e);
  out[2] = -s;
  return out;
}

// Height of the top surface at lateral offset x (for seating scutes).
function surfaceY(keys, s, x, midFn = MID_BODY, expFn = EXP_BODY) {
  const [, w, top, bot] = profile(keys, s);
  const yc = bot + (top - bot) * midFn(s);
  const e = expFn(s);
  const t = Math.min(0.999, Math.abs(x) / w);
  const ca = Math.pow(t, e / 2);
  const sa = Math.sqrt(1 - ca * ca);
  return yc + (top - yc) * Math.pow(sa, 2 / e);
}

// Lofted tube with smooth normals and closed ends.
function loft(keys, midFn, expFn, s0, s1, step, nRing) {
  const rings = [];
  for (let s = s0; s < s1 - step * 0.5; s += step) rings.push(s);
  rings.push(s1);
  const pos = [];
  const p = [0, 0, 0];
  for (const s of rings) {
    const pr = profile(keys, s);
    for (let k = 0; k < nRing; k++) {
      sectionPoint(pr, midFn(s), (k / nRing) * Math.PI * 2, p, expFn(s));
      pos.push(p[0], p[1], p[2]);
    }
  }
  const idx = [];
  const nR = rings.length;
  for (let r = 0; r < nR - 1; r++) {
    for (let k = 0; k < nRing; k++) {
      const a = r * nRing + k, b = r * nRing + ((k + 1) % nRing), c = a + nRing, d = b + nRing;
      idx.push(a, c, b, b, c, d);
    }
  }
  // End caps: a fan round the centre of the first and last ring.
  for (const [r, flip] of [[0, true], [nR - 1, false]]) {
    const pr = profile(keys, rings[r]);
    const centre = pos.length / 3;
    pos.push(0, pr[3] + (pr[2] - pr[3]) * midFn(rings[r]), -rings[r]);
    for (let k = 0; k < nRing; k++) {
      const a = r * nRing + k, b = r * nRing + ((k + 1) % nRing);
      if (flip) idx.push(centre, a, b); else idx.push(centre, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- builder

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _s = new THREE.Vector3();

function place(geo, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
  geo.applyMatrix4(_m);
  return geo;
}
const ball = (r, x, y, z, sx = 1, sy = 1, sz = 1, detail = 1) => place(new THREE.IcosahedronGeometry(r, detail), x, y, z, sx, sy, sz);

// A capsule-ish limb segment from a to b ([x, y, s]), radii ra to rb.
function limb(a, b, ra, rb, seg = 8) {
  const A = new THREE.Vector3(a[0], a[1], -a[2]), B = new THREE.Vector3(b[0], b[1], -b[2]);
  const d = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(rb, ra, d.length(), seg, 1, true);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  g.applyQuaternion(q);
  const mid = A.clone().add(B).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

class Builder {
  constructor() {
    this.pos = []; this.nor = []; this.col = []; this.rig = []; this.band = []; this.oln = []; this.idx = [];
  }

  // colour: a THREE.Color or fn(p, n) -> [color, band]; outline 0 for no hull.
  add(geo, { part = PART.BODY, pivot = [0, 0, 0], colour, band = 0, outline = 1, smoothNormals = true } = {}) {
    let g = geo;
    if (!smoothNormals) {
      g = g.index ? g.toNonIndexed() : g;
      g.deleteAttribute('normal');
      g.computeVertexNormals();
    } else if (!g.attributes.normal) {
      g.computeVertexNormals();
    }
    const P = g.attributes.position, N = g.attributes.normal;
    const base = this.pos.length / 3;
    g.computeBoundingSphere();
    const c = g.boundingSphere.center;
    const p = new THREE.Vector3(), n = new THREE.Vector3(), rad = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      p.fromBufferAttribute(P, i);
      n.fromBufferAttribute(N, i);
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(n.x, n.y, n.z);
      let cc = colour, bb = band;
      if (typeof colour === 'function') [cc, bb] = colour(p, n);
      this.col.push(cc.r, cc.g, cc.b);
      this.band.push(bb);
      this.rig.push(part, pivot[0], pivot[1], pivot[2]);
      if (outline > 0) {
        rad.copy(p).sub(c).normalize();
        const o = n.clone().lerp(rad, 1 - outline).normalize();
        this.oln.push(o.x, o.y, o.z);
      } else {
        this.oln.push(0, 0, 0);
      }
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < P.count; i++) this.idx.push(base + i);
    g.dispose();
    if (g !== geo) geo.dispose();
  }

  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setAttribute('aRig', new THREE.Float32BufferAttribute(this.rig, 4));
    geo.setAttribute('aBand', new THREE.Float32BufferAttribute(this.band, 1));
    geo.setAttribute('aOutline', new THREE.Float32BufferAttribute(this.oln, 3));
    geo.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }
}

// ---------------------------------------------------------------- geometry

export function buildCrocGeometry() {
  const b = new Builder();
  const tmp = new THREE.Color();

  // Body and upper head in one loft.
  b.add(loft(BODY_KEYS, MID_BODY, EXP_BODY, CROC.tail, CROC.snout, 0.035, 22), {
    colour: (p, n) => {
      const s = -p.z;
      const t = n.y;
      const head = smooth(0.4, 0.5, s);
      const back = tmp.copy(PAL.back).lerp(PAL.headTop, head);
      const side = PAL.side.clone().lerp(PAL.snout, head);
      let c = side.clone().lerp(back, smooth(0.1, 0.65, t));
      c.lerp(PAL.belly, smooth(-0.1, -0.55, t) * (1 - head));
      // the underside of the upper jaw is the palate, pink when the mouth opens, inside
      // a pale gum margin that widens towards the tip, so the pink narrows to a V
      if (s > 0.47 && t < -0.45) {
        const w = profile(BODY_KEYS, s)[1];
        const inner = 0.8 - 0.45 * smooth(0.7, 1.15, s);
        c = PAL.gum.clone().lerp(PAL.mouth, 1 - smooth(inner - 0.12, inner + 0.04, Math.abs(p.x) / w));
      } else if (s > 0.47) c.lerp(PAL.jawSide, smooth(0.1, -0.4, t) * 0.6);
      // a soft rosy cheek at the back of the grin
      const ck = Math.hypot(Math.abs(p.x) - 0.19, p.y - 0.2, s - 0.6);
      c.lerp(PAL.cheek, (1 - smooth(0.015, 0.045, ck)) * 0.55);
      return [c, smooth(-0.15, 0.35, t) * (1 - head)];
    },
    outline: 1,
  });

  // Lower jaw with a pink tongue on top.
  b.add(loft(JAW_KEYS, MID_JAW, EXP_JAW, 0.34, 1.22, 0.035, 16), {
    part: PART.JAW,
    colour: (p, n) => {
      const t = n.y;
      const s = -p.z;
      let c = PAL.jawSide.clone().lerp(PAL.belly, smooth(-0.1, -0.6, t));
      if (t > 0.55) {
        // the tongue, a V pointing to the tip inside the gums
        const w = profile(JAW_KEYS, s)[1];
        const inner = 0.78 - 0.5 * smooth(0.62, 1.12, s);
        c = PAL.gum.clone().lerp(PAL.tongue, 1 - smooth(inner - 0.12, inner + 0.04, Math.abs(p.x) / w));
      }
      return [c, 0];
    },
    outline: 1,
  });

  // Teeth: a friendly interlocking row, a little outward so they show from the side.
  for (const side of [-1, 1]) {
    for (let k = 0; k < 8; k++) {
      const s = 0.6 + k * 0.078;
      const [, w, , bot] = profile(BODY_KEYS, s);
      const len = k === 5 ? 0.04 : 0.032;
      const g = new THREE.ConeGeometry(0.0125, len, 5);
      g.rotateX(Math.PI); // point down
      g.rotateZ(side * 0.3);
      g.translate(side * (w - 0.012), bot - len * 0.42, -s);
      b.add(g, { colour: PAL.tooth, outline: 0, smoothNormals: false });
    }
    for (let k = 0; k < 7; k++) {
      const s = 0.64 + k * 0.078;
      const [, wj, top] = profile(JAW_KEYS, s);
      const wu = Math.max(wj + 0.012, profile(BODY_KEYS, s)[1] - 0.018);
      const big = k === 5; // the fourth lower tooth of a crocodile shows with the mouth shut
      const len = big ? 0.048 : 0.03;
      const g = new THREE.ConeGeometry(big ? 0.015 : 0.012, len, 5);
      g.rotateZ(-side * 0.3);
      g.translate(side * (wu - 0.006 + (big ? 0.006 : 0)), top + len * 0.4, -s);
      b.add(g, { part: PART.JAW, colour: PAL.tooth, outline: 0, smoothNormals: false });
    }
  }

  // Nose bulb nostrils.
  for (const side of [-1, 1]) {
    b.add(ball(0.014, side * 0.027, 0.194, -1.125, 1, 0.6, 1.2, 1), { colour: PAL.nostril, outline: 0 });
  }

  // Eyes on top of the head: skin turrets, big yellow-green eyeballs with a round
  // pupil looking forward and out, and a shine.
  for (const side of [-1, 1]) {
    const ex = side * 0.092, ey = 0.29, es = 0.6;
    b.add(ball(0.08, ex, ey, -es, 1, 0.8, 1.05, 2), { colour: PAL.headTop, outline: 1 });
    const cx = side * 0.1, cy = 0.318, cs = 0.616;
    const piv = [cx, cy, cs];
    b.add(ball(0.069, cx, cy, -cs, 1, 1, 1, 2), { part: PART.EYE, pivot: piv, colour: PAL.eyeball, outline: 0 });
    const dir = new THREE.Vector3(side * 0.6, 0.42, -0.68).normalize();
    b.add(ball(0.045, cx + dir.x * 0.053, cy + dir.y * 0.053, -cs + dir.z * 0.053, 1, 1, 1, 2), { part: PART.EYE, pivot: piv, colour: PAL.pupil, outline: 0 });
    b.add(ball(0.015, cx + dir.x * 0.084 + 0.007, cy + dir.y * 0.084 + 0.019, -cs + dir.z * 0.084, 1, 1, 1, 1), { part: PART.EYE, pivot: piv, colour: PAL.shine, outline: 0 });
    // a soft brow behind each eye
    b.add(ball(0.046, side * 0.083, 0.33, -0.57, 1.3, 0.5, 1.1, 1), { colour: PAL.headTop, outline: 0.6 });
  }

  // Back scutes: rounded bumps in rows over the body and neck.
  const bump = (x, s, r, h, colour) => {
    const y = surfaceY(BODY_KEYS, s, x);
    b.add(place(new THREE.IcosahedronGeometry(1, 0), x, y + h * 0.25, -s, r, h, r * 1.3), { colour, outline: 0, smoothNormals: false });
  };
  for (let s = 0.2; s > -0.56; s -= 0.135) {
    const k = smooth(0.25, -0.05, s) * smooth(-0.6, -0.35, s);
    for (const x of [0.075, 0.17]) {
      const r = 0.026 + 0.006 * k - (x > 0.1 ? 0.005 : 0);
      bump(x, s, r, r * 0.75, PAL.scute);
      bump(-x, s, r, r * 0.75, PAL.scute);
    }
  }
  for (const x of [0.06, -0.06]) bump(x, 0.335, 0.034, 0.028, PAL.scute); // the nuchal pair
  // Tail crest: a double row of pale plates joining into one towards the tip.
  const plate = (x, s, h) => {
    const y = surfaceY(BODY_KEYS, s, x);
    const g = new THREE.ConeGeometry(0.03, h, 4);
    g.rotateY(Math.PI / 4);
    g.scale(0.55, 1, 1.25);
    g.translate(x, y + h * 0.38, -s);
    b.add(g, { colour: PAL.crest, outline: 0, smoothNormals: false });
  };
  for (let s = -0.56; s > -1.1; s -= 0.075) {
    const h = 0.045 + 0.025 * smooth(-0.56, -0.95, s);
    const x = 0.052 - 0.02 * smooth(-0.56, -1.08, s);
    plate(x, s, h);
    plate(-x, s, h);
  }
  for (let s = -1.13; s > -1.47; s -= 0.068) plate(0, s, 0.062 - 0.1 * (-1.13 - s));

  // Legs, sprawled with the feet flat on the ground. Each has its own pivot.
  const legs = [
    { part: PART.FR, side: 1, front: true }, { part: PART.FL, side: -1, front: true },
    { part: PART.BR, side: 1, front: false }, { part: PART.BL, side: -1, front: false },
  ];
  for (const L of legs) {
    const sd = L.side;
    const o = { part: L.part, colour: PAL.leg, outline: 0.9 };
    if (L.front) {
      const piv = [sd * 0.2, 0.13, 0.2];
      const el = [sd * 0.35, 0.09, 0.235], wr = [sd * 0.375, 0.034, 0.285];
      b.add(limb(piv, el, 0.058, 0.046), { ...o, pivot: piv });
      b.add(ball(0.047, el[0], el[1], -el[2], 1, 1, 1, 1), { ...o, pivot: piv });
      b.add(limb(el, wr, 0.046, 0.036), { ...o, pivot: piv });
      b.add(ball(0.052, sd * 0.39, 0.024, -0.312, 1.15, 0.5, 1.05, 1), { ...o, pivot: piv });
      for (let k = 0; k < 4; k++) {
        const a = -0.55 + k * 0.4;
        const tx = sd * (0.39 + Math.sin(a) * 0.06 * sd), ts = 0.312 + Math.cos(a) * 0.06;
        b.add(ball(0.017, tx, 0.018, -ts, 1, 0.8, 1.2, 1), { ...o, pivot: piv, colour: PAL.toe, outline: 0 });
        b.add(ball(0.007, tx + Math.sin(a) * 0.012 * sd, 0.016, -(ts + Math.cos(a) * 0.015), 1, 1, 1, 0), { ...o, pivot: piv, colour: PAL.claw, outline: 0 });
      }
    } else {
      const piv = [sd * 0.21, 0.14, -0.48];
      const kn = [sd * 0.39, 0.105, -0.44], an = [sd * 0.415, 0.034, -0.5];
      b.add(limb(piv, kn, 0.078, 0.058), { ...o, pivot: piv });
      b.add(ball(0.058, kn[0], kn[1], -kn[2], 1, 1, 1, 1), { ...o, pivot: piv });
      b.add(limb(kn, an, 0.052, 0.04), { ...o, pivot: piv });
      b.add(ball(0.058, sd * 0.44, 0.024, 0.455, 1.1, 0.48, 1.35, 1), { ...o, pivot: piv });
      for (let k = 0; k < 4; k++) {
        const a = -0.5 + k * 0.36;
        const tx = sd * (0.44 + Math.sin(a) * 0.07 * sd), ts = -0.455 + Math.cos(a) * 0.08;
        b.add(ball(0.018, tx, 0.018, -ts, 1, 0.8, 1.3, 1), { ...o, pivot: piv, colour: PAL.toe, outline: 0 });
        b.add(ball(0.007, tx + Math.sin(a) * 0.012 * sd, 0.016, -(ts + Math.cos(a) * 0.017), 1, 1, 1, 0), { ...o, pivot: piv, colour: PAL.claw, outline: 0 });
      }
    }
  }

  return b.build();
}

// ---------------------------------------------------------------- shaders

const VERT_HEAD = /* glsl */ `
attribute vec4 aRig;
attribute float aBand;
attribute vec4 aAnimA;
attribute vec4 aAnimB;
attribute vec4 aAnimC;
varying vec3 vRest;
varying float vBand;

// Lateral offset of the spine at s: a travelling swim wave that grows towards the
// tail, the whole body bent into a turn, and a curl of the tail.
float crocLat(float s) {
  float tail = smoothstep(0.15, -1.5, s);
  float wave = aAnimA.y * (0.015 + 0.26 * tail * tail) * sin(aAnimA.x - s * 3.4);
  float bend = -0.5 * aAnimA.z * s * s;
  float curl = aAnimC.w * pow(smoothstep(-0.45, -1.5, s), 1.6) * 0.9;
  return wave + bend + curl;
}

vec2 crocRot(vec2 v, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

// p and n in the model frame (z = -s); both are moved in place.
void crocDeform(inout vec3 p, inout vec3 n) {
  float part = aRig.x;
  vec3 piv = vec3(aRig.y, aRig.z, -aRig.w);
  float s = -p.z;
  float anchor = s;

  // Legs: swing about the shoulder or hip, lift the foot, fold back when swimming.
  if (part > 1.5 && part < 5.5) {
    float side = sign(piv.x);
    float off = (part < 2.5 || part > 4.5) ? 0.0 : 3.14159; // FL with BR, FR with BL
    float ph = aAnimA.w + off;
    float swing = aAnimB.x * 0.5 * sin(ph) - aAnimB.w * 1.25;
    float lift = aAnimB.x * 0.06 * max(0.0, cos(ph));
    vec3 d = p - piv;
    float out1 = clamp(abs(d.x) / 0.22, 0.0, 1.0);
    // (x, s) turned by side * swing: positive swings the foot forwards
    vec2 xs = crocRot(vec2(d.x, -d.z), side * swing);
    vec2 nxs = crocRot(vec2(n.x, -n.z), side * swing);
    d.x = xs.x * (1.0 - 0.3 * aAnimB.w); d.z = -xs.y;
    d.y += lift * out1 + aAnimB.w * 0.06 * out1;
    n.x = nxs.x; n.z = -nxs.y;
    p = piv + d;
    s = -p.z;
    anchor = aRig.w;
  }

  // Jaw: the lower jaw drops, the upper jaw lifts a little, about the hinge.
  float jaw = aAnimB.z;
  vec2 hinge = vec2(${CROC.hingeS.toFixed(3)}, ${CROC.hingeY.toFixed(3)});
  if (part > 0.5 && part < 1.5) {
    vec2 q = crocRot(vec2(s, p.y) - hinge, -jaw * 0.78) + hinge;
    s = q.x; p.y = q.y;
    vec2 nq = crocRot(vec2(-n.z, n.y), -jaw * 0.78);
    n.z = -nq.x; n.y = nq.y;
  } else if (part < 0.5 || part > 5.5) {
    float up = (part > 5.5 ? 1.0 : smoothstep(0.44, 0.56, s)) * jaw * 0.26;
    vec2 q = crocRot(vec2(s, p.y) - hinge, up) + hinge;
    s = q.x; p.y = q.y;
    vec2 nq = crocRot(vec2(-n.z, n.y), up);
    n.z = -nq.x; n.y = nq.y;
  }

  // Blink: the eyeballs squash down into their turrets.
  if (part > 5.5) p.y = piv.y - 0.02 + (p.y - piv.y + 0.02) * (1.0 - 0.8 * aAnimC.y);

  // Head pitch and yaw about the neck, blended in along the neck.
  float hw = (part > 1.5 && part < 5.5) ? 0.0 : smoothstep(0.24, 0.5, anchor);
  vec2 neck = vec2(${CROC.neckS.toFixed(3)}, 0.2);
  if (hw > 0.0) {
    vec2 q = crocRot(vec2(s, p.y) - neck, aAnimB.y * hw) + neck;
    s = q.x; p.y = q.y;
    vec2 nq = crocRot(vec2(-n.z, n.y), aAnimB.y * hw);
    n.z = -nq.x; n.y = nq.y;
    // yaw: positive turns the head left (towards -x)
    vec2 r = crocRot(vec2(s - neck.x, p.x), -aAnimC.x * hw);
    s = r.x + neck.x; p.x = r.y;
    vec2 nr = crocRot(vec2(-n.z, n.x), -aAnimC.x * hw);
    n.z = -nr.x; n.x = nr.y;
  }

  // Breathing swells the chest a little.
  float torso = smoothstep(-0.7, -0.3, anchor) * smoothstep(0.35, 0.05, anchor) * ((part < 0.5) ? 1.0 : 0.0);
  p.x *= 1.0 + aAnimC.z * 0.045 * torso;
  p.y *= 1.0 + aAnimC.z * 0.05 * torso;

  // Bend the spine sideways, turning each slice with it.
  float lat = crocLat(anchor);
  float slope = (crocLat(anchor + 0.02) - crocLat(anchor - 0.02)) / 0.04;
  float th = atan(slope);
  vec2 v = crocRot(vec2(p.x, s - anchor), -th);
  p.x = lat + v.x;
  s = anchor + v.y;
  vec2 nv = crocRot(vec2(n.x, -n.z), -th);
  n.x = nv.x; n.z = -nv.y;
  p.z = -s;
}
`;

// For materials whose shader has objectNormal (the toon body).
const BEGIN_NORMAL = /* glsl */ `
vec3 objectNormal = vec3( normal );
vec3 crocPos = vec3( position );
crocDeform( crocPos, objectNormal );
vRest = vec3( position.x, position.y, -position.z );
vBand = aBand;
#ifdef USE_TANGENT
  vec3 objectTangent = vec3( tangent.xyz );
#endif
`;
const BEGIN_VERTEX_BODY = /* glsl */ `
vec3 transformed = crocPos;
`;
// For the outline and the shadow depth pass.
const BEGIN_VERTEX_PLAIN = (push) => /* glsl */ `
vec3 transformed = vec3( position );
vec3 crocN = vec3( normal );
${push ? 'transformed += aOutline * ' + OUTLINE.toFixed(4) + ';' : ''}
crocDeform( transformed, crocN );
vRest = vec3( position.x, position.y, -position.z );
vBand = aBand;
`;

const FRAG_HEAD = /* glsl */ `
varying vec3 vRest;
varying float vBand;
`;
// Dark cross bands: regular rings on the tail, broken blotches on the back.
const FRAG_BANDS = /* glsl */ `
{
  float s = vRest.z;
  float tailBands = step(0.58, fract(s * 4.3 + 0.2));
  float bodyBands = step(0.64, fract(s * 3.4 + 0.12 * sin(vRest.x * 23.0) + 0.3)) * 0.85;
  float m = mix(bodyBands, tailBands, smoothstep(-0.5, -0.66, s)) * smoothstep(0.3, 0.2, s);
  diffuseColor.rgb *= 1.0 - 0.42 * m * vBand;
}
`;

export function crocToonGradient(steps = [120, 190, 238, 255]) {
  const tex = new THREE.DataTexture(new Uint8Array(steps), steps.length, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function patchBody(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_HEAD)
      .replace('#include <beginnormal_vertex>', BEGIN_NORMAL)
      .replace('#include <begin_vertex>', BEGIN_VERTEX_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_BANDS);
  };
  material.customProgramCacheKey = () => 'croc-body-1';
  return material;
}

function patchPlain(material, push, key) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aOutline;\n' + VERT_HEAD)
      .replace('#include <begin_vertex>', BEGIN_VERTEX_PLAIN(push));
  };
  material.customProgramCacheKey = () => key;
  return material;
}

// ---------------------------------------------------------------- the instanced mesh

const ANIM_DEFAULT = {
  swimPhase: 0, swimAmp: 0, bend: 0, walkPhase: 0,
  walk: 0, headPitch: 0, jaw: 0, tuck: 0,
  headYaw: 0, blink: 0, breath: 0, tailCurl: 0,
};

// count crocodiles in one draw call (and one more for the outline).
export function createCrocMeshes(count = 2, { outline = true, shadows = true } = {}) {
  const geometry = buildCrocGeometry();
  const A = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  const B = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  const Cc = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  for (const a of [A, B, Cc]) a.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aAnimA', A);
  geometry.setAttribute('aAnimB', B);
  geometry.setAttribute('aAnimC', Cc);

  const material = patchBody(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: crocToonGradient() }));
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = 'croc';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false; // culled by hand: the shader moves vertices
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  if (shadows) {
    mesh.customDepthMaterial = patchPlain(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), false, 'croc-depth-1');
  }

  let hull = null;
  if (outline) {
    const om = patchPlain(new THREE.MeshBasicMaterial({ color: COL.outline, side: THREE.BackSide }), true, 'croc-outline-1');
    hull = new THREE.InstancedMesh(geometry, om, count);
    hull.name = 'croc-outline';
    hull.instanceMatrix = mesh.instanceMatrix;
    hull.frustumCulled = false;
    hull.castShadow = false;
  }

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ');
  const pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  return {
    geometry, mesh, outline: hull, count,
    // pose: {x, y, z, heading, pitch (nose up +), roll}; anim: fields of ANIM_DEFAULT.
    set(i, pose, anim = ANIM_DEFAULT) {
      e.set(pose.pitch || 0, pose.heading || 0, pose.roll || 0, 'YXZ');
      q.setFromEuler(e);
      m4.compose(pos.set(pose.x, pose.y, pose.z), q, one);
      mesh.setMatrixAt(i, m4);
      const a = A.array, b = B.array, c = Cc.array, k = i * 4;
      a[k] = anim.swimPhase; a[k + 1] = anim.swimAmp; a[k + 2] = anim.bend; a[k + 3] = anim.walkPhase;
      b[k] = anim.walk; b[k + 1] = anim.headPitch; b[k + 2] = anim.jaw; b[k + 3] = anim.tuck;
      c[k] = anim.headYaw; c[k + 1] = anim.blink; c[k + 2] = anim.breath; c[k + 3] = anim.tailCurl;
    },
    commit() {
      mesh.instanceMatrix.needsUpdate = true;
      A.needsUpdate = true; B.needsUpdate = true; Cc.needsUpdate = true;
    },
    // Draw the first n instances (0 hides the meshes) and upload this frame's poses.
    show(n) {
      mesh.count = n;
      mesh.visible = n > 0;
      if (hull) { hull.count = n; hull.visible = n > 0; }
      if (n > 0) this.commit();
    },
    // triangles drawn this frame (bodies and outlines)
    triangles() { return (geometry.index.count / 3) * mesh.count * (hull ? 2 : 1); },
    trianglesPerCroc: () => geometry.index.count / 3,
  };
}

export function defaultAnim() { return { ...ANIM_DEFAULT }; }
