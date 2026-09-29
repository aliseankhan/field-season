// The five anoles as chunky low-poly lizards with big eyes. Each species is one
// instanced mesh (one draw call in the main pass, one in the shadow pass) holding
// the body, head, jaw, eyes, legs, dewlap, crests, a tiny backpack and a dark
// outline shell (inverted hull) in the same geometry. Every motion runs in the
// vertex shader from per-instance numbers the behaviour code sets on a handle each
// frame; update() copies them into one buffer per species and adds the idle life
// (blinks, breathing, tail flicks, a little looking about).
//
// Model frame of every handle: metres at game size, the surface under the belly
// centre at the origin, y along `up` (the surface normal), z along `forward` (the
// head) and x along up x forward, the lizard's left. So:
//   headYaw > 0 turns the head towards up x forward, headPitch > 0 lifts the snout,
//   tailCurl > 0 curls the tail towards up x forward.
// forward need not be exactly perpendicular to up (the shader straightens it).
//
//   const anoles = createAnoleRenderer({ maxPerSpecies: 64 });
//   scene.add(anoles.group);
//   const h = anoles.add('cristatellus', 'm');   // null when the species is full
//   h.position.copy(p); h.up.copy(n); h.forward.copy(f);
//   h.step(metresMoved, dt);                     // advances gaitPhase at a readable rate
//   anoles.update(dt, t);                        // once a frame, after setting handles
//
// scale 1 is the species' male at game size; females and unsexed lizards are
// drawn smaller (ANOLE_INFO[sp].female), with smaller dewlaps and no male crests.
// Extra handle fields beyond the shared interface: idle (0..1, default 1: the
// renderer's own tail flicks and glances; 0 holds the lizard still, as when frozen
// or held, though it still blinks), opacity (0..1, default 1: dithered away as it
// slips out of sight), sleep (0..1: eyes shut), tailDroop (-1..1: the tail bends
// down in the up-forward plane, over the end of a perch; negative bends it up) and
// tailDroopAt (0..0.9: the share of the tail that lies on the perch before it bends),
// headPosition(v), backpackPosition(v), step(distance, dt) and lookAt(target,
// maxYaw). backpack takes a number (0xrrggbb) or a CSS string (parsed once). Handles
// are pooled: after remove(h) the handle may be handed out again by add(). Lizards
// also fade with the vegetation's camera cut-out (wind.js), to 70 %. display() and displayLength()
// give species timings for head bobs, push-ups and dewlap flashes; ANOLE_INFO the
// sizes (filled when the first renderer is made).

import * as THREE from 'three';
import { vegUniforms, CUT_GLSL } from '../world/wind.js';

export const SPECIES = ['cristatellus', 'sagrei', 'carolinensis', 'distichus', 'equestris'];

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (e0, e1, v) => { const t = clamp01((v - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const C = (hex) => new THREE.Color(hex); // hex is sRGB, the Color holds linear
const mixC = (a, b, t) => a.clone().lerp(b, clamp01(t));
function hash(a, b) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
// Smooth value noise on a coarse lattice, for lichen mottling.
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), u), lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v);
}

// Rig parts (aRig.x) and flags (aRig.z, bit values).
const P_BODY = 0, P_HEAD = 1, P_JAW = 2, P_EYE = 3, P_DEW = 4, P_LEG = 5, P_PACK = 9;
const F_HULL = 1, F_MALE = 2, F_NOTINT = 4, F_PACK = 8, F_NOSCALE = 16;

// ---------------------------------------------------------------- species

// Proportions are in units of snout-vent length (SVL) about a template; the model
// is then scaled so the male is `length` long, snout to tail tip, at scale 1.
// head [length, width, height], body [width, height], tail [length / SVL, base
// radius, width / height], legs [length, radius].
const SPEC = {
  cristatellus: {
    common: 'crested anole', length: 0.38, female: 0.82,
    head: [1.1, 1.0, 1.0], body: [1.0, 1.0], tail: [1.16, 1.0, 0.8], legs: [1.0, 1.0], eye: 1.0,
    dewlap: { size: [1.0, 1.0], female: 0.42, base: '#d6d64a', mid: '#f4b83c', edge: '#ff8a2e' },
    crest: { tail: 0.19, nuchal: 0.045, nuchalTo: 0.12 },
    stress: { mul: [0.6, 0.57, 0.52], hue: null },
    mouth: '#f28c8c',
  },
  sagrei: {
    common: 'brown anole', length: 0.34, female: 0.8,
    head: [0.9, 1.04, 1.0], body: [1.08, 1.02], tail: [1.06, 1.02, 0.95], legs: [1.02, 1.05], eye: 1.04,
    dewlap: { size: [0.98, 1.02], female: 0.3, base: '#ff4a26', mid: '#ff6a2c', edge: '#ffd23e' },
    crest: { dorsal: 0.05, dorsalTo: -0.3, male: true },
    stress: { mul: [0.55, 0.5, 0.47], hue: null },
    mouth: '#f28c8c',
  },
  carolinensis: {
    common: 'green anole', length: 0.36, female: 0.84,
    head: [1.4, 0.88, 0.9], body: [0.84, 0.92], tail: [1.36, 0.86, 1.0], legs: [0.95, 0.9], eye: 0.96,
    dewlap: { size: [1.05, 1.0], female: 0.34, base: '#ff7fae', mid: '#ff8fb8', edge: '#ffb0cc' },
    crest: {},
    stress: { mul: [0.6, 0.55, 0.5], hue: ['#6f4e2c', 1.0] }, // green anoles go brown
    mouth: '#f59a9a',
  },
  distichus: {
    common: 'bark anole', length: 0.26, female: 0.88,
    head: [0.86, 1.06, 0.9], body: [1.16, 0.76], tail: [0.98, 0.95, 1.25], legs: [1.05, 1.0], eye: 1.06,
    dewlap: { size: [0.9, 0.95], female: 0.45, base: '#f2b24c', mid: '#f6d766', edge: '#fbf0a2' },
    crest: {},
    stress: { mul: [0.56, 0.55, 0.53], hue: null },
    mouth: '#f0a0a0',
  },
  equestris: {
    common: 'knight anole', length: 0.8, female: 0.9,
    head: [1.35, 1.12, 1.12], body: [1.02, 1.06], tail: [1.06, 1.05, 0.8], legs: [1.0, 1.15], eye: 0.74,
    dewlap: { size: [1.25, 1.25], female: 0.8, base: '#ffadc6', mid: '#ff9fc0', edge: '#ffe0ea' },
    crest: { dorsal: 0.05, dorsalTo: -0.9, male: false },
    casque: true,
    stress: { mul: [0.55, 0.5, 0.42], hue: ['#5c6a2e', 0.5] },
    mouth: '#f28c8c',
  },
};

// Colour schemes. body(z, a, sec) and head(z, a, which) return [male, female];
// a is the angle round the body (pi/2 on the back, 3pi/2 under the belly).
const Z0 = -0.32; // tail base in template units
function schemes() {
  const s = {};
  {
    const m = C('#a38c4c'), f = C('#a2906a'), dark = C('#6c5a2d'), darkF = C('#7e6e4e');
    const belly = C('#ebdfae'), stripe = C('#dccd9f'), lip = C('#d9cc9a');
    s.cristatellus = {
      body(z, a) {
        const up = Math.sin(a);
        let cm = m.clone(), cf = f.clone();
        // soft chevrons over the back, rings on the tail
        const band = z > Z0 ? smooth(0.55, 0.9, Math.cos((z - 0.28) / 0.15 * TAU) * 0.5 + 0.5) * smooth(0.0, 0.5, up)
          : smooth(0.5, 0.85, Math.cos((z - Z0) / 0.19 * TAU) * 0.5 + 0.5) * 0.85;
        cm.lerp(dark, band * 0.8); cf.lerp(darkF, band * 0.6);
        if (up > 0.93 && z > Z0 - 0.3) cf.lerp(stripe, 0.85); // pale middorsal stripe on females
        if (up < -0.3) { const b = smooth(-0.3, -0.75, up); cm.lerp(belly, b); cf.lerp(belly, b); }
        return [cm, cf];
      },
      head(z, a, which) {
        const up = Math.sin(a);
        let c = m.clone();
        if (which === 'jaw') c.lerp(lip, 0.55);
        else if (up < 0.25) c.lerp(lip, 0.35);
        if (up > 0.9 && z < 0.4) c.lerp(dark, 0.25);
        return [c, mixC(c, f, 0.6)];
      },
      crest(t) { const c = mixC(C('#8e7c46'), C('#c2b07a'), t); return [c, c]; },
      pad: C('#c9b98a'), leg: [C('#9a8347'), C('#9c8a64')],
    };
  }
  {
    const m = C('#7c5231'), f = C('#9c6c43'), spot = C('#f1cf7e'), diamond = C('#efc896'), edge = C('#5b3920');
    const belly = C('#eed9b3'), lip = C('#c9a57a');
    s.sagrei = {
      body(z, a) {
        const up = Math.sin(a);
        let cm = m.clone(), cf = f.clone();
        // males: small pale yellow spots down the flanks
        if (up > -0.2 && up < 0.75 && z > Z0 - 0.5 && hash(Math.round(z * 40), Math.round(a * 3)) > 0.74) cm.lerp(spot, 0.55);
        if (up > 0.6) cm.lerp(C('#6a4428'), 0.3);
        // females: a scalloped pale band of diamonds along the back, edged dark
        if (z > Z0 - 0.6) {
          const d = 1 - Math.abs(((z / 0.16) % 1 + 1) % 1 - 0.5) * 2; // 1 at a diamond's widest
          if (up > 0.95) cf.lerp(diamond, 0.95);
          else if (up > 0.6) cf.lerp(d > 0.4 ? diamond : edge, d > 0.4 ? 0.85 : 0.8);
          else if (up > 0.2 && d > 0.55) cf.lerp(edge, 0.7);
        }
        if (up < -0.3) { const b = smooth(-0.3, -0.75, up); cm.lerp(belly, b); cf.lerp(belly, b); }
        return [cm, cf];
      },
      head(z, a, which) {
        const up = Math.sin(a);
        let c = m.clone().lerp(C('#8e6441'), 0.5);
        if (which === 'jaw') c.lerp(lip, 0.6);
        else if (up < 0.25) c.lerp(lip, 0.35);
        const cf = f.clone();
        if (which === 'jaw') cf.lerp(lip, 0.6);
        return [c, cf];
      },
      crest(t) { const c = mixC(C('#5f3d24'), C('#8a603c'), t); return [c, c]; },
      pad: C('#b0885e'), leg: [C('#744c2e'), C('#93653f')],
    };
  }
  {
    // a bright yellow-lime, so it still shows against the leaves, with a pale flank line
    const g = C('#82de3c'), back = C('#6cca34'), belly = C('#f2fbdc'), lip = C('#d8f5b0'), stripe = C('#f6fae4'), flank = C('#c5ef8a');
    s.carolinensis = {
      body(z, a) {
        const up = Math.sin(a);
        const cm = g.clone().lerp(back, smooth(0.3, 0.95, up) * 0.6);
        if (up > -0.25 && up < 0.05 && z > Z0 - 0.2) cm.lerp(flank, 0.55);
        const cf = cm.clone();
        if (up > 0.93 && z > Z0 - 0.35) cf.lerp(stripe, 0.9);
        if (up < -0.3) { const b = smooth(-0.3, -0.75, up); cm.lerp(belly, b); cf.lerp(belly, b); }
        return [cm, cf];
      },
      head(z, a, which) {
        const up = Math.sin(a);
        const c = g.clone();
        if (which === 'jaw') c.lerp(lip, 0.75);
        else if (up < 0.25) c.lerp(lip, 0.5);
        return [c, c.clone()];
      },
      crest(t) { const c = mixC(g, back, 1 - t); return [c, c]; },
      pad: C('#b4ea86'), leg: [C('#78d53a'), C('#78d53a')],
    };
  }
  {
    const grey = C('#a09d8f'), lichen = C('#bccb9b'), dark = C('#67645b'), belly = C('#e4e1d0'), bar = C('#5a564d');
    s.distichus = {
      body(z, a) {
        const up = Math.sin(a);
        const n = vnoise(z * 13 + 3, a * 2.3), n2 = vnoise(z * 21 - 5, a * 3.1 + 7);
        const c = grey.clone();
        c.lerp(lichen, smooth(0.55, 0.75, n) * 0.85);
        c.lerp(dark, smooth(0.6, 0.78, n2) * 0.8);
        // faint dark chevrons across the back
        if (z > Z0) c.lerp(dark, smooth(0.8, 0.95, Math.cos((z - 0.2) / 0.17 * TAU) * 0.5 + 0.5) * smooth(0.2, 0.7, up) * 0.6);
        if (up < -0.3) c.lerp(belly, smooth(-0.3, -0.75, up));
        return [c, mixC(c, C('#b3b0a2'), 0.25)];
      },
      head(z, a, which) {
        const up = Math.sin(a);
        const c = grey.clone();
        if (which === 'top' && up > 0.55 && z > 0.43 && z < 0.5) c.lerp(bar, 0.85); // dark bar between the eyes
        else if (which === 'jaw') c.lerp(belly, 0.35);
        else c.lerp(lichen, vnoise(z * 15, a * 2) * 0.5);
        return [c, mixC(c, C('#b3b0a2'), 0.25)];
      },
      crest(t) { const c = mixC(grey, lichen, t); return [c, c]; },
      pad: C('#c4c1b2'), leg: [C('#9a978a'), C('#a3a093')],
    };
  }
  {
    const g = C('#6ed63e'), back = C('#52bd35'), belly = C('#e4f7c4'), stripe = C('#fff6c8'), lip = C('#caf0a2');
    s.equestris = {
      body(z, a) {
        const up = Math.sin(a);
        const c = g.clone().lerp(back, smooth(0.35, 0.95, up) * 0.7);
        if (up < -0.3) c.lerp(belly, smooth(-0.3, -0.75, up));
        return [c, c.clone()];
      },
      head(z, a, which) {
        const up = Math.sin(a);
        const c = g.clone();
        if (which === 'jaw') c.lerp(lip, 0.6);
        else if (up > 0.8) c.lerp(back, 0.5);
        return [c, c.clone()];
      },
      crest(t) { const c = mixC(C('#3e9e2e'), C('#6ccd48'), t); return [c, c]; },
      // the yellow-white shoulder stripe rising from above the front leg, and the
      // jaw stripe from under the eye back past the ear
      stripes: [
        { pts: [[0.25, -0.35], [0.21, 0.2], [0.16, 0.7], [0.12, 1.05]], width: 0.034, colour: [stripe, stripe] },
        { head: true, pts: [[0.5, 0.18], [0.42, 0.2], [0.35, 0.26], [0.3, 0.35]], width: 0.03, colour: [stripe, stripe], lift: 0.002 },
      ],
      casque(t) { const c = mixC(C('#46a837'), C('#74d24a'), t); return [c, c]; },
      pad: C('#a6e27c'), leg: [C('#62cc3a'), C('#62cc3a')],
    };
  }
  return s;
}

// ---------------------------------------------------------------- geometry kit

// A loft along z: sections { z, y, x, rx, up, dn, pz } joined by rings of `sides`,
// closed with a pole at each end. arc 'top' or 'bottom' makes a half shell (the
// head and jaw) with an optional flat face across the open side (the mouth).
// paint(sec, a) returns [male, female] colours; w(sec) the per-vertex rig value.
function loft(secs, { sides = 10, front, back, arc = 'full', mouth = null, paint, w = null }) {
  secs = secs.slice().sort((p, q) => q.z - p.z);
  const full = arc === 'full';
  const a0 = arc === 'bottom' ? Math.PI : 0;
  const span = full ? TAU : Math.PI;
  const nr = full ? sides : sides + 1;
  const P = [], CM = [], CF = [], W = [], I = [];
  const put = (x, y, z, cc, wv) => { P.push(x, y, z); CM.push(cc[0].r, cc[0].g, cc[0].b); CF.push(cc[1].r, cc[1].g, cc[1].b); W.push(wv); };
  const wOf = (sec) => (w ? w(sec) : sec.y);
  const mid = full ? Math.PI / 2 : a0 + Math.PI / 2;
  put(0, front.y, front.z, paint({ ...secs[0], ...front, pz: front.pz ?? front.z }, mid), wOf({ ...secs[0], ...front }));
  for (const s of secs) {
    for (let j = 0; j < nr; j++) {
      const a = a0 + (span * j) / sides;
      const sn = Math.sin(a);
      put((s.x || 0) + s.rx * Math.cos(a), s.y + (sn >= 0 ? s.up : s.dn) * sn, s.z, paint(s, a), wOf(s));
    }
  }
  const last = secs[secs.length - 1];
  put(0, back.y, back.z, paint({ ...last, ...back, pz: back.pz ?? back.z }, mid), wOf({ ...last, ...back }));
  const bp = 1 + secs.length * nr;
  const ring = (i, j) => 1 + i * nr + (full ? j % sides : j);
  for (let j = 0; j < sides; j++) I.push(0, ring(0, j), ring(0, j + 1));
  for (let i = 0; i < secs.length - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const a = ring(i, j), b = ring(i, j + 1), c = ring(i + 1, j + 1), d = ring(i + 1, j);
      I.push(a, c, b, a, d, c);
    }
  }
  for (let j = 0; j < sides; j++) I.push(bp, ring(secs.length - 1, j + 1), ring(secs.length - 1, j));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(CM, 3));
  g.setAttribute('colF', new THREE.Float32BufferAttribute(CF, 3));
  g.setAttribute('aw', new THREE.Float32BufferAttribute(W, 1));
  g.setIndex(I);
  g.computeVertexNormals();
  if (!mouth) return { shell: g };

  // The flat face across a half shell: the roof of the mouth or the tongue side. mouth
  // is a colour, or [throat, lips] shaded from the back of the mouth to the front.
  const fy = arc === 'top' ? -1 : 1;
  const MP = [], MN = [], MC = [], MI = [];
  const zb = back.z, zf = front.z;
  const mput = (x, y, z) => {
    const col = Array.isArray(mouth) ? mixC(mouth[0], mouth[1], smooth(0, 1, (z - zb) / (zf - zb))) : mouth;
    MP.push(x, y, z); MN.push(0, fy, 0); MC.push(col.r, col.g, col.b);
  };
  mput(0, front.y, front.z);
  for (const s of secs) { mput(-s.rx, s.y, s.z); mput(s.rx, s.y, s.z); }
  mput(0, back.y, back.z);
  const n = secs.length;
  const tri = (a, b, c) => {
    // wind each triangle so its face normal points along fy
    const ay = MP[a * 3 + 2], bx = MP[b * 3], bz = MP[b * 3 + 2], cx = MP[c * 3], cz = MP[c * 3 + 2], ax = MP[a * 3];
    const ny = (cz - ay) * (bx - ax) - (bz - ay) * (cx - ax);
    if (ny * fy >= 0) MI.push(a, b, c); else MI.push(a, c, b);
  };
  tri(0, 1, 2);
  for (let i = 0; i < n - 1; i++) {
    const l0 = 1 + i * 2, r0 = l0 + 1, l1 = l0 + 2, r1 = l0 + 3;
    tri(l0, r0, r1); tri(l0, r1, l1);
  }
  tri(1 + (n - 1) * 2, 2 + (n - 1) * 2, 1 + n * 2);
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.Float32BufferAttribute(MP, 3));
  m.setAttribute('normal', new THREE.Float32BufferAttribute(MN, 3));
  m.setAttribute('color', new THREE.Float32BufferAttribute(MC, 3));
  m.setAttribute('colF', new THREE.Float32BufferAttribute(MC, 3));
  m.setIndex(MI);
  return { shell: g, mouth: m };
}

// An ellipsoid with true normals (so the outline shell has no cracks).
function ellipsoid(cx, cy, cz, rx, ry, rz, ws = 10, hs = 7) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  g.deleteAttribute('uv');
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const nx = x / rx, ny = y / ry, nz = z / rz;
    const l = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(i, nx / l, ny / l, nz / l);
    p.setXYZ(i, cx + x * rx, cy + y * ry, cz + z * rz);
  }
  return g;
}

const _m4 = new THREE.Matrix4(), _va = new THREE.Vector3(), _vb = new THREE.Vector3(), _vup = new THREE.Vector3();
// Orients geometry built along +z from the origin so it runs from a to b, its
// local y towards upHint where given.
function orient(g, a, b, upHint = null) {
  _va.set(a[0], a[1], a[2]); _vb.set(b[0], b[1], b[2]);
  if (upHint) _vup.copy(upHint);
  else _vup.set(0, 1, 0);
  if (Math.abs(_vb.clone().sub(_va).normalize().dot(_vup)) > 0.95) _vup.set(1, 0, 0);
  _m4.lookAt(_vb, _va, _vup); // +z from a towards b
  _m4.setPosition(_va);
  g.applyMatrix4(_m4);
  return g;
}

// A tapered capsule from a to b (radii ra, rb), plain colour pair.
function limb(a, b, ra, rb, colour, sides = 6) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const secs = [0, 0.5, 1].map((u) => ({ z: u * len, y: 0, rx: lerp(ra, rb, u), up: lerp(ra, rb, u), dn: lerp(ra, rb, u) }));
  const { shell } = loft(secs, { sides, front: { z: len + rb * 0.85, y: 0 }, back: { z: -ra * 0.85, y: 0 }, paint: () => colour });
  shell.deleteAttribute('aw');
  return orient(shell, a, b);
}

// A flat band from a to b, width w either side and thickness t, lying on a
// surface whose normal is n (a painted stripe with a little relief).
function band(a, b, w, t, colour, n) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const secs = [0, 1].map((u) => ({ z: u * len, y: 0, rx: w, up: t, dn: t }));
  const { shell } = loft(secs, { sides: 4, front: { z: len + w * 0.7, y: 0 }, back: { z: -w * 0.7, y: 0 }, paint: () => colour });
  shell.deleteAttribute('aw');
  return orient(shell, a, b, n);
}

// A small ellipsoid pointing from a along dir (the toes).
function pointed(a, dir, len, r, colour) {
  const g = ellipsoid(0, 0, len * 0.5, r, r * 0.8, len * 0.5 + r * 0.3, 4, 3);
  paintGeo(g, colour);
  return orient(g, a, [a[0] + dir[0], a[1] + dir[1], a[2] + dir[2]]);
}

function paintGeo(g, pair) {
  const n = g.attributes.position.count;
  const cm = new Float32Array(n * 3), cf = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    cm[i * 3] = pair[0].r; cm[i * 3 + 1] = pair[0].g; cm[i * 3 + 2] = pair[0].b;
    cf[i * 3] = pair[1].r; cf[i * 3 + 1] = pair[1].g; cf[i * 3 + 2] = pair[1].b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cm, 3));
  g.setAttribute('colF', new THREE.BufferAttribute(cf, 3));
  return g;
}

// Collects parts into one indexed geometry with the rig attributes. A part with
// hull gets a second copy flagged as the outline shell.
class Kit {
  constructor() { this.P = []; this.N = []; this.CM = []; this.CF = []; this.R = []; this.I = []; this.n = 0; }
  add(g, { part, flags = 0, hull = false, s = null, w = null, colour = null }) {
    if (colour) paintGeo(g, colour);
    if (!g.attributes.normal) g.computeVertexNormals();
    const pos = g.attributes.position, nor = g.attributes.normal, cm = g.attributes.color, cf = g.attributes.colF || cm;
    const aw = g.attributes.aw;
    const idx = g.index ? g.index.array : null;
    for (let copy = 0; copy < (hull ? 2 : 1); copy++) {
      const base = this.n;
      const fl = flags | (copy ? F_HULL : 0);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        this.P.push(x, y, z);
        this.N.push(nor.getX(i), nor.getY(i), nor.getZ(i));
        this.CM.push(cm.getX(i), cm.getY(i), cm.getZ(i));
        this.CF.push(cf.getX(i), cf.getY(i), cf.getZ(i));
        const wv = aw ? aw.getX(i) : typeof w === 'function' ? w(x, y, z) : (w ?? 0);
        this.R.push(part, s ? s(x, y, z) : 0, fl, wv);
      }
      if (idx) for (let k = 0; k < idx.length; k++) this.I.push(base + idx[k]);
      else for (let k = 0; k < pos.count; k++) this.I.push(base + k);
      this.n += pos.count;
    }
    g.dispose();
  }
  // scale: template units to metres; positions and the rig w values (heights) scale.
  build(scale) {
    const g = new THREE.BufferGeometry();
    const P = new Float32Array(this.P), R = new Float32Array(this.R);
    for (let i = 0; i < P.length; i++) P[i] *= scale;
    for (let i = 3; i < R.length; i += 4) R[i] *= scale;
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.N), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.CM), 3));
    g.setAttribute('aColF', new THREE.BufferAttribute(new Float32Array(this.CF), 3));
    g.setAttribute('aRig', new THREE.BufferAttribute(R, 4));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.I, 1) : new THREE.Uint16BufferAttribute(this.I, 1));
    return g;
  }
}

// ---------------------------------------------------------------- one species

// Builds a species in template units (SVL = 1, trunk centre at z = 0, surface at
// y = 0), then scales it to game size. Returns the geometry and the rig numbers.
function buildSpecies(sp, paints) {
  const S = SPEC[sp], K = paints[sp];
  const kit = new Kit();
  const [hl, hw, hh] = S.head, [bw, bh] = S.body, [T, tr, tw] = S.tail, [ll, lr] = S.legs;
  const HB = 0.3; // back of the head
  const hz = (z) => HB + (z - HB) * hl;
  const DROP = 0.035; // how much lower than a first draft the body sits: sprawled, not on posts
  const Y0 = 0.16 - DROP; // the mouth line
  const belly = 0.05 - DROP;

  // Body and tail: one loft, so the tail bends smoothly out of the hips.
  const trunk = [
    [0.44, 0.2, 0.1, 0.09, 0.075], [0.37, 0.198, 0.135, 0.115, 0.1], [0.3, 0.19, 0.17, 0.14, 0.115],
    [0.22, 0.183, 0.195, 0.155, 0.122], [0.13, 0.178, 0.208, 0.162, 0.125], [0.04, 0.175, 0.212, 0.163, 0.125],
    [-0.05, 0.174, 0.208, 0.16, 0.124], [-0.14, 0.172, 0.193, 0.15, 0.118], [-0.22, 0.168, 0.165, 0.135, 0.108],
    [-0.29, 0.162, 0.13, 0.115, 0.095],
  ].map(([z, y, rx, up, dn]) => {
    const d = dn * bh * 1.1; // chunkier than a real anole
    return { z, pz: z, y: Math.max(belly + d, y - DROP - dn + d), rx: rx * bw * 1.2, up: up * bh * 1.15, dn: d };
  });
  const tailU = [0.03, 0.11, 0.21, 0.32, 0.44, 0.56, 0.68, 0.79, 0.89, 0.96];
  const tail = tailU.map((u) => {
    const r = 0.112 * tr * Math.pow(1 - u, 1.2) + 0.017 * u;
    const y = lerp(0.17 * Math.min(1, bh + 0.12) - DROP, 0.05 - 0.4 * DROP, Math.pow(u, 0.6));
    return { z: Z0 - u * T, pz: Z0 - u * T, y: Math.max(y, r * 0.95 + 0.024), rx: r * tw, up: r * 1.05, dn: r * 0.95 };
  });
  const bodySecs = trunk.concat(tail);
  const tailTip = Z0 - T - 0.014;
  const body = loft(bodySecs, {
    sides: 10, front: { z: 0.48, y: 0.2 }, back: { z: tailTip, y: 0.05 },
    paint: (sec, a) => K.body(sec.pz, a, sec),
  });
  kit.add(body.shell, { part: P_BODY, hull: true });
  const topAt = (z) => { // back line of the body and tail at z (template units)
    for (let i = 0; i < bodySecs.length - 1; i++) {
      const p = bodySecs[i], q = bodySecs[i + 1];
      if (z <= p.z && z >= q.z) { const t = (p.z - z) / (p.z - q.z); return lerp(p.y + p.up, q.y + q.up, t); }
    }
    return bodySecs[0].y + bodySecs[0].up;
  };
  const secAt = (z) => trunk.reduce((b, s) => (Math.abs(s.z - z) < Math.abs(b.z - z) ? s : b));

  // Head (upper half) and jaw (lower half); the flat faces between are the mouth, a
  // pale palate above and a dark rose floor with a pink tongue below. An anole's head
  // is a long wedge, narrower than it is long, the green anole's longest of all.
  const palate = [C('#5a1524'), mixC(C(S.mouth), C('#fff1ee'), 0.3)], floor = [C('#3c0a16'), C('#8e2a40')], tongue = C('#ff9ab4');
  const lipLine = (c, a, which) => (which === 'top' ? (a < 0.3 || a > Math.PI - 0.3) : (a > TAU - 0.3 || a < Math.PI + 0.3)) ? mixC(c, C('#3a2c22'), 0.5) : c;
  const headTop = [
    [0.31, 0.092, 0.1], [0.35, 0.13, 0.145], [0.4, 0.147, 0.168], [0.455, 0.142, 0.166],
    [0.52, 0.126, 0.142], [0.58, 0.104, 0.112], [0.64, 0.072, 0.08], [0.69, 0.038, 0.048],
  ].map(([z, rx, up]) => ({ z: hz(z), pz: z, y: Y0, rx: rx * hw * 1.1, up: up * hh * 1.1, dn: 0 }));
  const snout = hz(0.72);
  const head = loft(headTop, {
    sides: 8, arc: 'top', front: { z: snout, y: Y0, pz: 0.72 }, back: { z: hz(0.295), y: Y0, pz: 0.295 }, mouth: palate,
    paint: (sec, a) => K.head(sec.pz, a, 'top').map((c) => lipLine(c, a, 'top')),
  });
  kit.add(head.shell, { part: P_HEAD, hull: true });
  kit.add(head.mouth, { part: P_HEAD, flags: F_NOTINT });
  const deep = S.casque ? 1.3 : 1; // the knight's heavy jaw
  const jawSecs = [
    [0.325, 0.092, 0.06], [0.37, 0.126, 0.095], [0.43, 0.133, 0.1], [0.5, 0.12, 0.086],
    [0.57, 0.097, 0.066], [0.63, 0.067, 0.045], [0.675, 0.036, 0.028],
  ].map(([z, rx, dn]) => ({ z: hz(z), pz: z, y: Y0, rx: rx * hw * 1.07, up: 0, dn: dn * hh * 1.1 * deep }));
  const jaw = loft(jawSecs, {
    sides: 6, arc: 'bottom', front: { z: hz(0.705), y: Y0, pz: 0.705 }, back: { z: hz(0.31), y: Y0, pz: 0.31 }, mouth: floor,
    paint: (sec, a) => K.head(sec.pz, a, 'jaw').map((c) => lipLine(c, a, 'jaw')),
  });
  kit.add(jaw.shell, { part: P_JAW, hull: true });
  kit.add(jaw.mouth, { part: P_JAW, flags: F_NOTINT });
  // the tongue lies on the floor of the mouth, just under the palate when it is shut
  kit.add(ellipsoid(0, Y0 - 0.012, hz(0.49), 0.058 * hw, 0.012, 0.12 * hl, 6, 4), { part: P_JAW, flags: F_NOTINT, colour: [tongue, tongue] });
  const headAt = (z) => { // half width and height of the head at z
    const hs = headTop;
    if (z <= hs[0].z) return [hs[0].rx, hs[0].up];
    for (let i = 0; i < hs.length - 1; i++) {
      const p = hs[i], q = hs[i + 1];
      if (z >= p.z && z <= q.z) { const t = (z - p.z) / (q.z - p.z); return [lerp(p.rx, q.rx, t), lerp(p.up, q.up, t)]; }
    }
    return [hs[hs.length - 1].rx, hs[hs.length - 1].up];
  };

  // Big round eyes bulging from the sides of the head, with a white shine; they
  // squash shut to blink.
  const er = 0.09 * S.eye;
  const ez = hz(0.41);
  const [erx, eup] = headAt(ez);
  const ea = 0.3; // angle up from the mouth line: on the sides of the head, below the brow
  const ex = erx * Math.cos(ea) - Math.cos(ea) * er * 0.42, ey = Y0 + eup * Math.sin(ea) - Math.sin(ea) * er * 0.42;
  const eyeC = C('#241c17'), white = C('#ffffff');
  for (const sx of [1, -1]) {
    kit.add(ellipsoid(sx * ex, ey, ez, er * 0.8, er, er * 0.96, 8, 6), { part: P_EYE, flags: F_NOTINT, colour: [eyeC, eyeC], hull: true, w: ey });
    const d = new THREE.Vector3(sx * 0.62, 0.58, 0.52).normalize();
    kit.add(ellipsoid(sx * ex + d.x * er * 0.66, ey + d.y * er * 0.8, ez + d.z * er * 0.78, er * 0.3, er * 0.3, er * 0.3, 6, 4), { part: P_EYE, flags: F_NOTINT, colour: [white, white], w: ey });
    kit.add(ellipsoid(sx * ex + sx * er * 0.62, ey - er * 0.28, ez + er * 0.55, er * 0.12, er * 0.12, er * 0.12, 4, 3), { part: P_EYE, flags: F_NOTINT, colour: [white, white], w: ey });
  }
  // Nostrils: two dark dots on the snout.
  const nos = C('#3a2c22');
  for (const sx of [1, -1]) kit.add(ellipsoid(sx * 0.024 * hw, Y0 + 0.036 * hh, hz(0.69), 0.011, 0.009, 0.011, 4, 3), { part: P_HEAD, flags: F_NOTINT, colour: [nos, nos] });

  // Casque (knight): a raised bony plate on the back of the head, and ridges
  // running from the eyes towards the snout.
  if (S.casque) {
    const cs = [[0.28, 0.1, 0.05], [0.31, 0.15, 0.09], [0.35, 0.17, 0.11], [0.39, 0.16, 0.115], [0.43, 0.13, 0.1], [0.47, 0.09, 0.07]]
      .map(([z, rx, up], i) => ({ z: hz(z), pz: z, y: Y0 + headAt(hz(z))[1] - 0.05, rx: rx * hw * 0.8, up: up * (i % 2 ? 1.1 : 0.92), dn: 0.012 }));
    const cq = loft(cs, {
      sides: 6, arc: 'top', front: { z: hz(0.5), y: cs[5].y }, back: { z: hz(0.26), y: cs[0].y },
      paint: (sec, a) => K.casque(Math.abs(Math.cos(a)) > 0.7 ? 1 : 0.15),
    });
    kit.add(cq.shell, { part: P_HEAD, hull: true });
    // a raised triangle of bony ridges from above the eyes to the snout
    for (const sx of [1, -1]) {
      const za = hz(0.42), zm = hz(0.56), zb = hz(0.68);
      const at = (z, k, lift) => [sx * headAt(z)[0] * k, Y0 + headAt(z)[1] + lift, z];
      kit.add(limb(at(za, 0.7, 0.004), at(zm, 0.42, 0.006), 0.026, 0.02, K.casque(0.85), 5), { part: P_HEAD, hull: true });
      kit.add(limb(at(zm, 0.42, 0.006), at(zb, 0.1, -0.004), 0.02, 0.013, K.casque(0.85), 5), { part: P_HEAD, hull: true });
    }
  }

  // Stripes with a little relief where vertex colours would blur them: the
  // knight's shoulder stripe and jaw stripe.
  const surf = (z, a, lift) => { // body surface point and normal, a from +x round over the back
    let p = trunk[0], q = trunk[0], t = 0;
    for (let i = 0; i < trunk.length - 1; i++) {
      if (z <= trunk[i].z && z >= trunk[i + 1].z) { p = trunk[i]; q = trunk[i + 1]; t = (p.z - z) / (p.z - q.z); break; }
    }
    const rx = lerp(p.rx, q.rx, t), y = lerp(p.y, q.y, t), sn = Math.sin(a), cs = Math.cos(a);
    const ry = sn >= 0 ? lerp(p.up, q.up, t) : lerp(p.dn, q.dn, t);
    const n = new THREE.Vector3(cs / rx, sn / ry, 0).normalize();
    return { p: [rx * cs + n.x * lift, y + ry * sn + n.y * lift, z], n };
  };
  const headSurf = (z, a, lift) => {
    const [rx, up] = headAt(z), sn = Math.sin(a), cs = Math.cos(a);
    const n = new THREE.Vector3(cs / rx, sn / up, 0).normalize();
    return { p: [rx * cs + n.x * lift, Y0 + up * sn + n.y * lift, z], n };
  };
  const stripe = (pts, width, colour, part) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const A = pts[i], B = pts[i + 1];
      kit.add(band(A.p, B.p, width, 0.012, colour, A.n.clone().add(B.n).normalize()), { part });
    }
  };
  if (K.stripes) {
    for (const sx of [1, -1]) {
      const side = (a) => (sx > 0 ? a : Math.PI - a);
      for (const st of K.stripes) {
        const f = st.head ? headSurf : surf;
        stripe(st.pts.map(([z, a]) => f(st.head ? hz(z) : z, side(a), st.lift ?? 0.004)), st.width, st.colour, st.head ? P_HEAD : P_BODY);
      }
    }
  }

  // Dewlap: a flat fan under the throat, as an ellipsoid whose rings are concentric
  // in the side view, so the colour runs from the throat to a bright rim.
  const [dsz, dsy] = S.dewlap.size;
  const dpy = 0.13 - DROP, dpz = hz(0.42);
  const drz = 0.27 * dsz, dry = 0.27 * dsy;
  const dcy = dpy - 0.075, dcz = hz(0.41) - 0.01;
  const dew = ellipsoid(0, 0, 0, 1, 1, 1, 12, 7);
  dew.rotateZ(Math.PI / 2); // the pole axis along x, so the latitude rings lie in the y-z plane
  {
    const p = dew.attributes.position, n = dew.attributes.normal;
    const cm = new Float32Array(p.count * 3);
    const base = C(S.dewlap.base), midc = C(S.dewlap.mid), edge = C(S.dewlap.edge);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const r = Math.hypot(y, z);
      const c = r < 0.6 ? mixC(base, midc, r / 0.6) : mixC(midc, edge, smooth(0.6, 0.93, r));
      cm[i * 3] = c.r; cm[i * 3 + 1] = c.g; cm[i * 3 + 2] = c.b;
      const th = 0.024;
      const nx = x / th, ny = y / dry, nz = z / drz; // normals of the flattened shape
      const l = Math.hypot(nx, ny, nz) || 1;
      n.setXYZ(i, nx / l, ny / l, nz / l);
      p.setXYZ(i, x * th, dcy + y * dry, dcz + z * drz);
    }
    dew.setAttribute('color', new THREE.BufferAttribute(cm, 3));
    dew.setAttribute('colF', new THREE.BufferAttribute(cm.slice(), 3));
  }
  kit.add(dew, { part: P_DEW, flags: F_NOTINT, hull: true });

  // Legs: sprawled and chunky, upper and lower limb, a round foot and three toes.
  const legs = [
    { part: P_LEG + 0, side: 1, front: true }, { part: P_LEG + 1, side: -1, front: true },
    { part: P_LEG + 2, side: 1, front: false }, { part: P_LEG + 3, side: -1, front: false },
  ];
  const legRig = {};
  for (const L of legs) {
    const sx = L.side, xw = bw;
    const lr0 = (L.front ? 0.068 : 0.082) * lr, lr1 = (L.front ? 0.056 : 0.064) * lr;
    // sprawled: the upper arm splays out sideways to a bent elbow, the forearm angles
    // forward and down to the hand; the hind knee rises beside the hip
    const piv = L.front ? [0.16 * xw, 0.17 - DROP, 0.22] : [0.16 * xw, 0.165 - DROP, -0.2];
    const knee = L.front ? [0.31 * xw * ll, 0.1, 0.2] : [0.33 * xw * ll, 0.2 - 0.6 * DROP, -0.13];
    const foot = L.front ? [0.38 * xw * ll + 0.01, 0.034, 0.3] : [0.375 * xw * ll + 0.01, 0.034, -0.25];
    const P = (v) => [sx * v[0], v[1], v[2]];
    const colour = K.leg;
    const pad = [K.pad, K.pad];
    const toesDir = L.front ? [[0.1, 1], [0.65, 0.76], [1, 0.2]] : [[0.4, 0.92], [1, 0.25], [0.8, -0.6]];
    const toeLen = (L.front ? 0.08 : 0.1) * ll;
    const reach = Math.hypot(foot[0] - piv[0], foot[1] - piv[1], foot[2] - piv[2]) + toeLen;
    const sFn = (x, y, z) => clamp01(Math.hypot(Math.abs(x) - piv[0], y - piv[1], z - piv[2]) / reach);
    const opts = { part: L.part, s: sFn };
    kit.add(limb(P(piv), P(knee), lr0, lr0 * 0.92, colour, 5), { ...opts, hull: true });
    kit.add(limb(P(knee), P(foot), lr1 * 1.05, lr1 * 0.9, colour, 5), { ...opts, hull: true });
    kit.add(ellipsoid(sx * foot[0], 0.026, foot[2], 0.05 * lr, 0.024, 0.046 * lr, 5, 3), { ...opts, colour: pad });
    for (const d of toesDir) {
      const dir = [sx * d[0] * toeLen, 0, d[1] * toeLen];
      const at = [sx * foot[0] + dir[0] * 0.3, 0.02, foot[2] + dir[2] * 0.3];
      kit.add(pointed(at, dir, toeLen, 0.021 * lr, pad), opts);
    }
    legRig[L.front ? 'front' : 'hind'] = { x: piv[0], y: piv[1], z: piv[2], reach };
  }

  // Crests: the crested anole's tall scalloped tail fin and a low nuchal crest
  // (males only), the brown anole's serrated back crest (males), the knight's
  // serrated back crest (both sexes). Thin blades with a diamond section.
  const crestLoft = (z1, z2, height, { male, step = 0.012 }) => {
    const secs = [];
    for (let z = z1; z >= z2 - 1e-6; z -= step) {
      const u = (z1 - z) / (z1 - z2);
      secs.push({ z, pz: z, y: topAt(z) - 0.014, rx: 0.013, up: height(u, z) + 0.014, dn: 0.01 });
    }
    const f = secs[0], l = secs[secs.length - 1];
    const g = loft(secs, {
      sides: 4, front: { z: f.z + 0.01, y: f.y }, back: { z: l.z - 0.01, y: l.y },
      paint: (sec, a) => K.crest(clamp01(Math.sin(a))), w: (sec) => sec.y,
    });
    kit.add(g.shell, { part: P_BODY, flags: F_NOSCALE | (male ? F_MALE : 0), hull: true });
  };
  const saw = (z, period) => 1 - Math.abs((((z / period) % 1) + 1) % 1 - 0.5) * 2;
  const cr = S.crest;
  if (cr.tail) {
    const z1 = Z0 + 0.03, z2 = Z0 - 0.6 * T;
    crestLoft(z1, z2, (u) => cr.tail * Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(Math.min(1, u), 0.7))), 0.7) * (0.6 + 0.4 * Math.abs(Math.cos(Math.PI * 4.5 * u))), { male: true, step: 0.022 });
  }
  if (cr.nuchal) {
    crestLoft(0.4, cr.nuchalTo, (u, z) => cr.nuchal * (0.3 + 0.7 * saw(z, 0.05)) * Math.max(0, Math.sin(Math.PI * Math.min(1, u * 1.05))), { male: true, step: 0.0125 });
  }
  if (cr.dorsal) {
    const z2 = cr.dorsalTo < Z0 ? Z0 + (cr.dorsalTo - Z0) * T * 0.4 : cr.dorsalTo;
    crestLoft(0.38, z2, (u, z) => cr.dorsal * (0.25 + 0.75 * saw(z, 0.056)) * Math.min(1, u * 8) * (1 - Math.pow(u, 3)), { male: cr.male, step: 0.014 });
  }

  // The backpack: an attachment point between the shoulders, drawn in the colour
  // set per lizard (vertex colours here are only shading), hidden when off.
  const packZ = 0.1, packY = topAt(packZ) + 0.022;
  const grey = (v) => { const c = new THREE.Color(v, v, v); return [c, c]; };
  kit.add(ellipsoid(0, packY, packZ, 0.15, 0.062, 0.12, 8, 5), { part: P_PACK, flags: F_PACK, colour: grey(1), hull: true });
  kit.add(ellipsoid(0, packY + 0.034, packZ + 0.035, 0.14, 0.036, 0.085, 8, 4), { part: P_PACK, flags: F_PACK, colour: grey(0.72) });
  kit.add(ellipsoid(0, packY - 0.004, packZ - 0.108, 0.075, 0.042, 0.032, 6, 3), { part: P_PACK, flags: F_PACK, colour: grey(0.84) });
  for (const sx of [1, -1]) {
    const a = (v) => (sx > 0 ? v : Math.PI - v);
    const pts = [surf(packZ + 0.06, a(1.05), 0.008), surf(packZ + 0.105, a(0.6), 0.008), surf(packZ + 0.13, a(0.15), 0.008)];
    for (let i = 0; i < 2; i++) {
      kit.add(band(pts[i].p, pts[i + 1].p, 0.028, 0.01, grey(0.66), pts[i].n.clone().add(pts[i + 1].n).normalize()), { part: P_PACK, flags: F_PACK });
    }
  }

  // Scale to game size: the male is S.length long, snout to tail tip.
  const svl = S.length / (snout - tailTip);
  const geometry = kit.build(svl);
  geometry.computeBoundingSphere();
  const rig = {
    svl,
    length: S.length,
    shoulderZ: 0.22 * svl, hipZ: -0.2 * svl, tailZ0: Z0 * svl, tailLen: T * svl,
    neckY: (0.2 - DROP) * svl, neckZ: 0.33 * svl, hingeY: Y0 * svl, hingeZ: hz(0.31) * svl,
    front: legRig.front, hind: legRig.hind,
    dewY: dpy * svl, dewZ: dpz * svl, packY: packY * svl, packZ: packZ * svl,
    head: [0, ey * svl, ez * svl], // between the eyes
    snoutZ: snout * svl, tailTipZ: tailTip * svl,
    radius: 0.25 * bw * svl,
  };
  for (const k of ['front', 'hind']) rig[k] = { x: rig[k].x * svl, y: rig[k].y * svl, z: rig[k].z * svl, reach: rig[k].reach * svl };
  return { geometry, rig, vertices: geometry.attributes.position.count, triangles: geometry.index.count / 3 };
}

// ---------------------------------------------------------------- shaders

const RIG_HEAD = /* glsl */ `
attribute vec4 aRig;
attribute vec3 aColF;
attribute vec4 iA; // position, scale
attribute vec4 iB; // up, gait
attribute vec4 iC; // forward, gait phase
attribute vec4 iD; // head yaw, head pitch, bob, push-up
attribute vec4 iE; // dewlap, tail curl, flatten, gape
attribute vec4 iF; // tint, visible, male, blink
attribute vec4 iG; // backpack rgb, backpack on
attribute vec4 iH; // seed, tail flick, glance yaw, glance pitch
attribute vec4 iI; // tail droop, where along the tail it starts (0..1), spare
uniform float uAnTime;
uniform float uAnPx;
uniform vec4 uAnSize; // svl, female scale, female dewlap, outline max (m)
uniform vec4 uAnBody; // shoulder z, hip z, tail base z, tail length
uniform vec4 uAnHead; // neck y, neck z, hinge y, hinge z
uniform vec4 uAnLegF; // pivot x, y, z, reach
uniform vec4 uAnLegH;
uniform vec4 uAnDew;  // dewlap pivot y, z, backpack y, z
uniform vec3 uAnStressMul;
uniform vec4 uAnStressHue;
varying float vAnHull;
varying vec3 vAnWorld;
varying float vAnOp;
vec3 anP;
vec3 anN;
vec3 anC;
float anHull;
mat3 anRotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 anRotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
float anBit(float f, float b) { return mod(floor(f / b + 0.5 / b), 2.0); }

void anoleRig() {
  float part = aRig.x, sv = aRig.y, fl = aRig.z, w = aRig.w;
  float svl = uAnSize.x;
  float male = iF.z, gait = iB.w, ph = iC.w, bob = iD.z, dew = iE.x, flt = iE.z, gape = iE.w;
  float push = max(iD.w, dew * 0.9);
  float zS = uAnBody.x, zH = uAnBody.y, z0 = uAnBody.z, TL = uAnBody.w;
  anHull = anBit(fl, 1.0);
  vec3 p = position;
  vec3 n = normal;

  if (anBit(fl, 2.0) > 0.5) { // male crests rise from their base; on females they sink out of sight
    p.y = w + (p.y - w) * male - (1.0 - male) * 0.04 * svl;
    p.x *= mix(0.2, 1.0, male);
  }

  // lateral C-bend of the spine while running
  float zc = 0.5 * (zS + zH), hl = 0.5 * (zS - zH);
  float waveA = gait * 0.05 * svl * sin(ph);
  float zRef = p.z;
  float footW = 0.0;
  bool bodyPart = part < 0.5;

  if (part > 8.5) {
    vec3 c = vec3(0.0, uAnDew.z, uAnDew.w);
    p = c + (p - c) * iG.w;
  } else if (part > 4.5) {
    // legs 5 front +x, 6 front -x, 7 hind +x, 8 hind -x; diagonal pairs step together
    bool front = part < 6.5;
    float side = mod(part, 2.0) > 0.5 ? 1.0 : -1.0;
    vec4 L = front ? uAnLegF : uAnLegH;
    float off = (part < 5.5 || part > 7.5) ? 0.0 : 3.14159;
    float c = sin(ph + off);
    p.z += gait * c * L.w * 0.42 * sv;
    p.y += gait * L.w * 0.32 * max(0.0, cos(ph + off)) * sv * sv;
    p.x += side * flt * L.w * 0.14 * sv;
    p.y *= 1.0 - 0.3 * flt; // knees and elbows drop when pressed flat
    zRef = L.z;
    footW = sv;
  } else if (part > 0.5) {
    if (part > 3.5) {
      vec3 d = vec3(0.0, uAnDew.x, uAnDew.y);
      float e = mix(0.07, 1.0, dew) * mix(uAnSize.z, 1.0, male);
      p = d + (p - d) * vec3(mix(0.6, 1.0, dew), e, e);
    } else if (part > 2.5) {
      p.y = w + (p.y - w) * (1.0 - 0.92 * iF.w);
    } else if (part > 1.5) {
      vec3 h = vec3(0.0, uAnHead.z, uAnHead.w);
      mat3 R = anRotX(gape * 0.62); // about 35 degrees, hinged at the back of the head
      p = h + R * (p - h);
      n = R * n;
    }
    vec3 nk = vec3(0.0, uAnHead.x, uAnHead.y);
    float slopeN = waveA * 2.0 * ((uAnHead.y - zc) / hl) / hl;
    float hp = iD.y + iH.w + bob * 0.55 + gape * 0.42 + dew * 0.22 - flt * 0.12;
    mat3 R = anRotY(iD.x + iH.z + atan(slopeN)) * anRotX(-hp);
    p = nk + R * (p - nk);
    n = R * n;
    p.y += bob * 0.05 * svl;
    zRef = uAnHead.y;
  }

  // body cross-section: breathing on the ribs, flattening against the bark
  if (bodyPart && p.z > z0 && anBit(fl, 16.0) < 0.5) {
    float rib = smoothstep(z0, zH, p.z) * (1.0 - smoothstep(zS, zS + 0.15 * svl, p.z));
    float br = rib * 0.035 * sin(uAnTime * 4.4 + iH.x * 6.2832) * (1.0 - gait);
    p.x *= 1.0 + flt * 0.22 + br;
    p.y = w + (p.y - w) * (1.0 - flt * 0.32 + br);
  }

  // push-up raises the chest most, a head bob the neck, flattening lowers the belly
  float front = smoothstep(zH, zS + 0.1 * svl, zRef);
  float neck = smoothstep(zS - 0.1 * svl, uAnHead.y, zRef);
  float lift = svl * (push * (0.05 + 0.2 * front) + bob * 0.1 * neck - flt * 0.02);

  if (bodyPart && p.z < z0) {
    // the tail: an arc from the base, its curvature from the curl, a flick and the run
    float d = z0 - p.z;
    float u0 = (z0 - zc) / hl;
    float th0 = -atan(waveA * 2.0 * u0 / hl);
    float k = (iE.y * 2.8 + iH.y * 1.2 + gait * 1.1 * sin(ph - 1.4)) / TL;
    float th = th0 + k * d;
    float x2 = 0.5 * k * d;
    float chord = d * (abs(x2) > 1e-4 ? sin(x2) / x2 : 1.0);
    float thm = th0 + x2;
    float lx = p.x;
    p.x = waveA * (u0 * u0 - 0.4) + chord * sin(thm) + lx * cos(th);
    p.z = z0 - chord * cos(thm) + lx * sin(th);
    n.xz = vec2(n.x * cos(th) - n.z * sin(th), n.x * sin(th) + n.z * cos(th));
    // droop: past the share iI.y of its length (where its perch ends) the tail bends
    // down (up, when negative) in its own vertical plane, through 1.5 rad at the tip at
    // droop 1
    float d0 = iI.y * TL;
    float kd = iI.x * 1.5 / max(TL - d0, 0.1 * TL);
    float back = z0 - p.z, e = back - d0;
    if (abs(kd) > 1e-3 && e > 0.0) {
      float ph = kd * e, hv = 0.5 * ph, cv = sin(hv) / hv;
      float ly = p.y - w;
      float cph = cos(ph), sph = sin(ph);
      p.y = w - e * cv * sin(hv) + ly * cph;
      p.z = z0 - d0 - e * cv * cos(hv) - ly * sph;
      n.yz = vec2(n.y * cph + n.z * sph, -n.y * sph + n.z * cph);
    }
    float dt = d / TL;
    p.y += lift * max(0.0, 1.0 - dt * 2.5) + abs(iH.y) * 0.22 * svl * dt * dt;
  } else {
    float u = (zRef - zc) / hl;
    p.x += waveA * (u * u - 0.4);
    p.y += lift * (1.0 - footW);
    if (anBit(fl, 16.0) > 0.5 || part > 8.5) p.y -= flt * 0.058 * svl; // crests and the pack ride down with the squashed back
  }

  float sc = iA.w * mix(uAnSize.y, 1.0, male) * step(0.001, iF.y);
  vec3 U = normalize(iB.xyz);
  vec3 Fw = iC.xyz - U * dot(iC.xyz, U);
  Fw = normalize(Fw + vec3(1e-5, 0.0, 0.0));
  vec3 X = cross(U, Fw);
  anP = iA.xyz + (X * p.x + U * p.y + Fw * p.z) * sc;
  anN = normalize(X * n.x + U * n.y + Fw * n.z);
#ifdef ANOLE_DEPTH
  if (anHull > 0.5) anP = iA.xyz;
#else
  if (anHull > 0.5) {
    float dist = length(anP - cameraPosition);
    anP += anN * clamp(dist * uAnPx, 0.012 * svl * sc, uAnSize.w * sc) * (part > 8.5 ? iG.w : 1.0);
  }
  vec3 c = mix(aColF, color, male);
  if (anBit(fl, 8.0) > 0.5) {
    c = iG.rgb * c.r;
  } else if (anBit(fl, 4.0) < 0.5) {
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 st = mix(c * uAnStressMul, uAnStressHue.rgb * (0.3 + 1.7 * lum), uAnStressHue.a);
    c = mix(c, st, iF.x);
  }
  if (anHull > 0.5) c = c * 0.22 + vec3(0.018, 0.012, 0.02);
  anC = c;
  vAnHull = anHull;
  vAnWorld = anP;
  vAnOp = iF.y;
#endif
}
`;

// Fragment additions: the outline shell's front faces go; a lizard fading out of sight
// (opacity) or sitting on wood the camera cut-out removes is dithered away with it (to
// 70 %, so it dims with its perch rather than vanishing); a faint warm rim light.
const FRAG_HEAD = /* glsl */ `
varying float vAnHull;
varying vec3 vAnWorld;
varying float vAnOp;
uniform vec3 uAnRim;
`;
const FRAG_CLIP = /* glsl */ `
if ( vAnHull > 0.5 && gl_FrontFacing ) discard;
{
  float keep = vAnOp * ( 1.0 - 0.7 * vegCutFade( vAnWorld ) );
  if ( keep < 0.999 && vegBayer( gl_FragCoord.xy ) >= keep ) discard;
}
`;
const FRAG_RIM = /* glsl */ `
totalEmissiveRadiance += diffuseColor.rgb * 0.1;
{
  float rim = 1.0 - clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
  totalEmissiveRadiance += uAnRim * rim * rim * rim;
}
`;

// Normal offset for the shadow lookup, so the rounded body does not stripe itself.
const SHADOW_OFFSET = /* glsl */ `
#if defined( USE_SHADOWMAP )
  worldPosition.xyz += normalize( inverseTransformDirection( transformedNormal, viewMatrix ) ) * 0.03;
#endif
`;

function makeMaterials(uniforms, gradient) {
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradient, side: THREE.DoubleSide });
  mat.shadowSide = THREE.BackSide;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + RIG_HEAD)
      .replace('#include <color_vertex>', 'anoleRig();\nvColor = anC;')
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = anN;')
      .replace('#include <begin_vertex>', 'vec3 transformed = anP;')
      .replace('#include <shadowmap_vertex>', SHADOW_OFFSET + '#include <shadowmap_vertex>');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + CUT_GLSL + FRAG_HEAD)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + FRAG_CLIP)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FRAG_RIM)
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\nif ( vAnHull > 0.5 ) gl_FragColor.rgb = vColor;');
  };
  mat.customProgramCacheKey = () => 'anole-2';

  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n#define ANOLE_DEPTH\n' + RIG_HEAD)
      .replace('#include <begin_vertex>', 'anoleRig();\nvec3 transformed = anP;');
  };
  depth.customProgramCacheKey = () => 'anole-depth-1';
  return { mat, depth };
}

function toonRamp() {
  const tex = new THREE.DataTexture(new Uint8Array([130, 200, 242, 255]), 4, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------- displays

// Species display timings. display(species, kind, tau, out) writes out.bob,
// out.pushup and out.dewlap (0..1) for a display that started tau seconds ago and
// returns false once it is over. Kinds: 'headbob', 'pushup', 'dewlap'.
const DISPLAY_STYLE = {
  cristatellus: { bobHz: 3.2, bobs: 4, pushes: 2, pushT: 0.8, flashes: 2, hold: 0.55 },
  sagrei: { bobHz: 4.2, bobs: 5, pushes: 3, pushT: 0.55, flashes: 3, hold: 0.35 },
  carolinensis: { bobHz: 2.4, bobs: 3, pushes: 2, pushT: 0.9, flashes: 2, hold: 0.8 },
  distichus: { bobHz: 3.6, bobs: 3, pushes: 1, pushT: 0.6, flashes: 1, hold: 0.45 },
  equestris: { bobHz: 1.3, bobs: 2, pushes: 1, pushT: 1.4, flashes: 1, hold: 1.8 },
};
export function displayLength(species, kind) {
  const D = DISPLAY_STYLE[species] || DISPLAY_STYLE.cristatellus;
  if (kind === 'headbob') return D.bobs / D.bobHz + 0.2;
  if (kind === 'pushup') return D.pushes * D.pushT + 0.2;
  return D.flashes * (D.hold + 0.45) + 0.1;
}
export function display(species, kind, tau, out) {
  const D = DISPLAY_STYLE[species] || DISPLAY_STYLE.cristatellus;
  out.bob = 0; out.pushup = 0; out.dewlap = 0;
  if (tau < 0) return true;
  if (kind === 'headbob') {
    const n = tau * D.bobHz;
    if (n > D.bobs) return tau < displayLength(species, kind);
    out.bob = Math.pow(Math.sin(Math.PI * (n % 1)), 1.5) * (1 - 0.25 * Math.floor(n) / D.bobs);
    out.pushup = 0.25 * Math.sin(Math.PI * n / D.bobs);
  } else if (kind === 'pushup') {
    const n = tau / D.pushT;
    if (n > D.pushes) return tau < displayLength(species, kind);
    out.pushup = Math.pow(Math.sin(Math.PI * (n % 1)), 0.8);
    out.bob = 0.3 * out.pushup;
  } else {
    const cyc = D.hold + 0.45, n = tau / cyc;
    if (n > D.flashes) return tau < displayLength(species, kind);
    const u = (n % 1) * cyc;
    out.dewlap = u < 0.15 ? smooth(0, 0.15, u) : u < 0.15 + D.hold ? 1 : 1 - smooth(0.15 + D.hold, cyc, u);
    out.bob = 0.2 * out.dewlap;
  }
  return true;
}

// ---------------------------------------------------------------- the renderer

export const ANOLE_INFO = {}; // filled on first build: length, svl, radius, head, stride, female

const STRIDE = 36; // floats per instance
const INST = ['iA', 'iB', 'iC', 'iD', 'iE', 'iF', 'iG', 'iH', 'iI'];
const OUTLINE_PX = 1.35; // outline width in pixels
const _col = new THREE.Color();
const _v = new THREE.Vector3(), _x = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3();
const _buf = new THREE.Vector2();

// One per drawn lizard; the renderer keeps them in a pool and reuses them.
class AnoleHandle {
  constructor(kind) {
    this.kind = kind;
    this.position = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.forward = new THREE.Vector3(0, 0, 1);
    this.slot = -1;
  }
  reset(species, sex) {
    this.species = species;
    this.sex = sex;
    this.position.set(0, 0, 0); this.up.set(0, 1, 0); this.forward.set(0, 0, 1);
    this.scale = 1;
    this.gait = 0; this.gaitPhase = 0;
    this.headYaw = 0; this.headPitch = 0;
    this.bob = 0; this.pushup = 0; this.dewlap = 0; this.tailCurl = 0; this.flatten = 0; this.gape = 0;
    this.tint = 0;
    this.visible = true;
    this.opacity = 1; // 0..1: dithered out while it slips out of sight
    this.sleep = 0; // 0..1: eyes shut
    this.tailDroop = 0; // -1..1: the tail bends down (up when negative)
    this.tailDroopAt = 0; // 0..0.9: how far along the tail (share of its length) the bend starts
    this.backpack = null;
    this.idle = 1;
    this.male = sex === 'm' ? 1 : sex === 'f' ? 0 : 0.35;
    this.seed = Math.random();
    this._blink = 0; this._blinkT = 1 + Math.random() * 4; this._blinkDouble = false;
    this._flick = 0; this._flickT = 2 + Math.random() * 8; this._flickAmp = 0; this._flickAge = 9;
    this._packKey = null; this._packHex = 0;
    return this;
  }
  // world size factor: the species' male size times sex and scale
  get size() { return this.scale * lerp(this.kind.info.female, 1, this.male); }
  // Advance the leg cycle by the distance moved, at most about 11 strides a second
  // so the legs stay readable.
  step(distance, dt) {
    const d = Math.min(Math.abs(distance) / (this.kind.info.stride * this.size), dt * 11);
    this.gaitPhase = (this.gaitPhase + d * TAU) % (TAU * 64);
  }
  _frame(xAxis, zAxis) {
    _u.copy(this.up).normalize();
    zAxis.copy(this.forward).addScaledVector(_u, -this.forward.dot(_u));
    if (zAxis.lengthSq() < 1e-8) zAxis.set(1, 0, 0).addScaledVector(_u, -_u.x);
    zAxis.normalize();
    xAxis.crossVectors(_u, zAxis);
  }
  // Point between the eyes in world space (head turn ignored, lifts included).
  headPosition(out) {
    const r = this.kind.rig, s = this.size;
    this._frame(_x, _f);
    const lift = r.svl * (Math.max(this.pushup, this.dewlap * 0.9) * 0.25 + this.bob * 0.15 - this.flatten * 0.02);
    return out.copy(this.position).addScaledVector(_u, (r.head[1] + lift) * s).addScaledVector(_f, r.head[2] * s);
  }
  backpackPosition(out) {
    const r = this.kind.rig, s = this.size;
    this._frame(_x, _f);
    return out.copy(this.position).addScaledVector(_u, r.packY * s).addScaledVector(_f, r.packZ * s);
  }
  // Turn the head towards a world point, within maxYaw either way.
  lookAt(target, maxYaw = 1.1) {
    this._frame(_x, _f);
    this.headPosition(_v);
    _v.subVectors(target, _v);
    const fz = _v.dot(_f), fx = _v.dot(_x), fy = _v.dot(_u);
    this.headYaw = Math.max(-maxYaw, Math.min(maxYaw, Math.atan2(fx, Math.max(1e-4, fz))));
    this.headPitch = Math.max(-0.5, Math.min(0.6, Math.atan2(fy, Math.hypot(fx, fz))));
  }
}

// A backpack colour as a number: numbers pass straight through; a string is parsed
// once and remembered on the handle.
function packHex(h) {
  const b = h.backpack;
  if (typeof b === 'number') return b;
  if (b !== h._packKey) { h._packKey = b; h._packHex = _col.set(b).getHex(); }
  return h._packHex;
}

export function createAnoleRenderer({ maxPerSpecies = 64, castShadow = true } = {}) {
  const group = new THREE.Group();
  group.name = 'anoles';
  const paints = schemes();
  const gradient = toonRamp();
  const shared = {
    uAnTime: { value: 0 }, uAnPx: { value: 0.001 },
    uVegCam: vegUniforms.uVegCam, uVegFocus: vegUniforms.uVegFocus, uVegCut: vegUniforms.uVegCut,
  };
  const kinds = {};
  const stats = { drawCalls: 0, active: 0, triangles: 0, species: {} };

  for (const sp of SPECIES) {
    const built = buildSpecies(sp, paints);
    const S = SPEC[sp], r = built.rig;
    const info = {
      common: S.common, length: S.length, svl: r.svl, female: S.female, radius: r.radius,
      stride: r.svl * 0.62, head: r.head.slice(), snoutZ: r.snoutZ, tailTipZ: r.tailTipZ, tailZ0: r.tailZ0,
    };
    ANOLE_INFO[sp] = info;
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = built.geometry.index;
    for (const k of Object.keys(built.geometry.attributes)) geo.setAttribute(k, built.geometry.attributes[k]);
    const data = new Float32Array(maxPerSpecies * STRIDE);
    const ib = new THREE.InstancedInterleavedBuffer(data, STRIDE, 1);
    ib.setUsage(THREE.DynamicDrawUsage);
    INST.forEach((name, k) => geo.setAttribute(name, new THREE.InterleavedBufferAttribute(ib, 4, k * 4)));
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    const hue = S.stress.hue ? C(S.stress.hue[0]) : new THREE.Color(0, 0, 0);
    const uniforms = {
      ...shared,
      uAnSize: { value: new THREE.Vector4(r.svl, S.female, S.dewlap.female, 0.055 * r.svl) },
      uAnBody: { value: new THREE.Vector4(r.shoulderZ, r.hipZ, r.tailZ0, r.tailLen) },
      uAnHead: { value: new THREE.Vector4(r.neckY, r.neckZ, r.hingeY, r.hingeZ) },
      uAnLegF: { value: new THREE.Vector4(r.front.x, r.front.y, r.front.z, r.front.reach) },
      uAnLegH: { value: new THREE.Vector4(r.hind.x, r.hind.y, r.hind.z, r.hind.reach) },
      uAnDew: { value: new THREE.Vector4(r.dewY, r.dewZ, r.packY, r.packZ) },
      uAnStressMul: { value: new THREE.Vector3(...S.stress.mul) },
      uAnStressHue: { value: new THREE.Vector4(hue.r, hue.g, hue.b, S.stress.hue ? S.stress.hue[1] : 0) },
      // a warm rim; stronger on the green species, so they lift off the leaves
      uAnRim: { value: S.stress.hue && sp !== 'distichus' ? new THREE.Vector3(0.26, 0.22, 0.06) : new THREE.Vector3(0.1, 0.085, 0.05) },
    };
    const { mat, depth } = makeMaterials(uniforms, gradient);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'anoles-' + sp;
    mesh.customDepthMaterial = depth;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.visible = false;
    mesh.onBeforeRender = (renderer, scene, camera) => {
      renderer.getDrawingBufferSize(_buf);
      const e = camera.projectionMatrix.elements;
      shared.uAnPx.value = camera.isPerspectiveCamera ? (OUTLINE_PX * 2) / (e[5] * Math.max(1, _buf.y)) : 0;
    };
    group.add(mesh);
    // handles[0 .. used - 1] are the live ones, packed, so the instance count is the
    // live count; pool holds handles to reuse
    kinds[sp] = {
      sp, mesh, geo, ib, data, info, rig: r, max: maxPerSpecies, handles: new Array(maxPerSpecies).fill(null), pool: [],
      used: 0, perLizard: { vertices: built.vertices, triangles: built.triangles },
    };
    stats.species[sp] = { active: 0, slots: maxPerSpecies, vertices: built.vertices, triangles: built.triangles };
  }

  function add(species, sex = 'f') {
    const k = kinds[species];
    if (!k || k.used >= k.max) return null;
    const h = (k.pool.pop() || new AnoleHandle(k)).reset(species, sex);
    h.slot = k.used++;
    k.handles[h.slot] = h;
    return h;
  }

  // Frees a handle; the last live one moves into its slot, so there are no holes.
  function remove(h) {
    if (!h) return;
    const k = h.kind;
    if (h.slot < 0 || k.handles[h.slot] !== h) return;
    const last = --k.used;
    if (h.slot !== last) {
      const m = k.handles[last];
      k.handles[h.slot] = m;
      m.slot = h.slot;
    }
    k.handles[last] = null;
    h.slot = -1;
    k.pool.push(h);
  }

  // Idle life the renderer owns: blinks, tail flicks and small glances.
  function life(h, dt) {
    h._blinkT -= dt;
    if (h._blinkT <= 0) {
      h._blink = 0.001;
      h._blinkT = h._blinkDouble ? 0.28 : 2.2 + Math.random() * 4.5;
      h._blinkDouble = !h._blinkDouble && Math.random() < 0.25;
    }
    let blink = 0;
    if (h._blink > 0) {
      h._blink += dt;
      const u = h._blink / 0.17;
      blink = u < 1 ? Math.sin(Math.PI * u) : 0;
      if (u >= 1) h._blink = 0;
    }
    h._flickT -= dt * h.idle * (1 - h.gait);
    if (h._flickT <= 0) {
      h._flickAge = 0;
      h._flickAmp = (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5);
      h._flickT = 3.5 + Math.random() * 7;
    }
    h._flickAge += dt;
    const fa = h._flickAge;
    h._flick = fa < 1.2 ? h._flickAmp * Math.sin(fa * 17) * Math.exp(-fa * 3.2) * h.idle : 0;
    return blink;
  }

  const _c = new THREE.Vector3();
  function update(dt, t) {
    shared.uAnTime.value = t;
    let calls = 0, active = 0, tris = 0;
    for (const sp of SPECIES) {
      const k = kinds[sp], d = k.data;
      let n = 0, rMax = 0;
      _c.set(0, 0, 0);
      for (let i = 0; i < k.used; i++) {
        const h = k.handles[i];
        const o = i * STRIDE;
        const blink = life(h, dt);
        d[o] = h.position.x; d[o + 1] = h.position.y; d[o + 2] = h.position.z; d[o + 3] = h.scale;
        d[o + 4] = h.up.x; d[o + 5] = h.up.y; d[o + 6] = h.up.z; d[o + 7] = clamp01(h.gait);
        d[o + 8] = h.forward.x; d[o + 9] = h.forward.y; d[o + 10] = h.forward.z; d[o + 11] = h.gaitPhase;
        d[o + 12] = h.headYaw; d[o + 13] = h.headPitch; d[o + 14] = h.bob; d[o + 15] = h.pushup;
        d[o + 16] = h.dewlap; d[o + 17] = h.tailCurl; d[o + 18] = h.flatten; d[o + 19] = h.gape;
        d[o + 20] = h.tint; d[o + 21] = h.visible ? clamp01(h.opacity ?? 1) : 0; d[o + 22] = h.male;
        d[o + 23] = Math.max(blink, h.sleep || 0);
        if (h.backpack == null) {
          d[o + 27] = 0;
        } else {
          _col.setHex(packHex(h));
          d[o + 24] = _col.r; d[o + 25] = _col.g; d[o + 26] = _col.b; d[o + 27] = 1;
        }
        const idle = h.idle * (1 - h.gait);
        d[o + 28] = h.seed; d[o + 29] = h._flick;
        d[o + 30] = idle * (0.14 * Math.sin(t * 0.43 + h.seed * 40) + 0.06 * Math.sin(t * 1.1 + h.seed * 17));
        d[o + 31] = idle * 0.07 * Math.sin(t * 0.31 + h.seed * 23);
        d[o + 32] = h.tailDroop || 0; d[o + 33] = h.tailDroopAt || 0;
        if (h.visible) { _c.add(h.position); n++; }
      }
      const count = k.used;
      k.geo.instanceCount = count;
      k.mesh.visible = n > 0;
      if (count > 0) k.ib.needsUpdate = true;
      if (n > 0) {
        _c.multiplyScalar(1 / n);
        for (let i = 0; i < count; i++) {
          const h = k.handles[i];
          if (h && h.visible) rMax = Math.max(rMax, h.position.distanceTo(_c) + k.info.length * h.scale);
        }
        k.geo.boundingSphere.center.copy(_c);
        k.geo.boundingSphere.radius = rMax;
        calls++;
        tris += count * k.perLizard.triangles;
      }
      stats.species[sp].active = n;
      active += n;
    }
    stats.drawCalls = calls;
    stats.active = active;
    stats.triangles = tris;
  }

  return { group, add, remove, update, stats, kinds, info: ANOLE_INFO };
}
