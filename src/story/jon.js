// Jon, from the lab, on James's rig (james.js): the same bones, idle, turn, wave and talk.
// Big fluffy wavy dark hair to the shoulders (rounded tufts), thin dark rectangular glasses,
// a moustache and a short chin beard, a big toothy grin, a head torch on a green band over
// the hair, a fine blue gingham shirt, a plain green lanyard and one of the little orange
// GPS backpacks. One skinned mesh and its outline.
//
// He just appears. A visit picks a spot RULES.jon.near metres from the player that is out
// of the camera's view (his shadow too), on free walkable ground, with a clear walk up to
// the player and a clear talk camera. He walks up and talks (the story's camera), then
// walks off behind the nearest tree or bush and is gone the first frame he is out of view:
// outside the view, or behind trunks and bushes that the vegetation cut-out is not opening.
// When he cannot get out of the view he heads well away from the player (the follow camera
// keeps whatever is near them in frame) and goes once the camera has turned from him.
// He never fades and never pops in or out on screen.
//
// Survey day only; never during a catch, a mission, a talk, a card or a cutscene. At most
// RULES.jon.most visits a day, RULES.jon.gap game hours apart (the re-tie may come sooner,
// but counts). When he cannot come, a hint, the spares and the backpack word come as a note
// with his portrait instead, and the word on sun and shade is dropped. His visits:
//   - a snapped loop, until he has done one (state.jon.retied, saved): he claims the re-tie
//     (loop:snap) and comes RETIE_AFTER seconds after the snap; a claim that lapses leaves
//     it for the next snap;
//   - the player's first lock-on to each species not caught yet: one short hint
//     (state.jon.hints, saved); as a note, at most one every RULES.jon.noteGap game hours
//     (one that cannot go yet waits for the next lock-on);
//   - RULES.jon.nudge game hours with no catch: a word on sun and shade, once a day;
//   - all five GPS backpacks fitted: RULES.jon.spares more, once that day;
//   - a GPS backpack about to go on (steer(lizard), from catching.js) while today's are
//     piling up on that species or in that part of the island: a word, then the choice of
//     letting it go without one (the default) or fitting it anyway; once per species and
//     once per area a day.
// His lines are SCRIPT.jon.
//
//   const jon = buildJon(game, { story, shot, endShot, parent })   flow.js, which calls
//   jon.update(dt, t) after its own camera has moved for the frame
//   jon.model (the rig) and jon.group (in parent) are built the first time he comes, or
//   by jon.ensure(): three.js draws on Math.random for every object's id, and a game he
//   has not come to draws exactly as one without him
//   jon.state ('away' | 'visit' | 'leaving'), jon.kind,
//   jon.visit(kind, species) (scripted tests: the next visit, whatever the odds and gap),
//   jon.steer(lizard) -> Promise<bool> (true: fit the backpack; false: let it go without),
//   jon.hidden() (out of view right now), jon.cover (the tree or bush he is heading for),
//   jon.frames { appear, gone } (their game.frame), jon.visits (today's), jon.notes (today's
//   notes, by kind)
// Events: jon:appear { kind, x, z }, jon:gone { x, z, behind: 'tree' | 'bush' | null },
// jon:note { kind, species }.

import * as THREE from 'three';
import { events } from '../core/events.js';
import * as kit from '../ui/kit.js';
import { state, RULES, dayKey, speciesKey, save } from '../game/state.js';
import { SCRIPT, JON, say } from './script.js';
import { buildJames, partList, mergeParts, place, cyl, sph, rbox, tube, scalp, onScalp, HEAD } from './james.js';
import { vegUniforms } from '../world/wind.js';

const COL = {
  skin: '#eebb96', cheek: '#ff9a8a', eye: '#2b2320', shine: '#ffffff',
  hair: '#35251c', sheen: '#443022', curl: '#3c291e', hairEdge: '#4d3527', glasses: '#1d1918',
  mouth: '#7a3431', teeth: '#fffaf0', gap: '#d9cfbd', tongue: '#ff8c8c',
  band: '#3fae4a', torch: '#363a40', rim: '#a3aab2', lamp: '#fff3b0',
  check: ['#eef3fb', '#93b6ee', '#3f6fc4'], collar: '#cfe0fa', placket: '#7ea6e6', button: '#f6f6f6', cuff: '#7ea6e6',
  lanyard: '#3fae4a', clip: '#9aa0a8',
  pack: '#ff8a3d', packLid: '#e8692a', strap: '#ef7a33', label: '#fff4e4', led: '#6dea5a', antenna: '#2e3136',
  trousers: '#4f5a6e', belt: '#3a2a22', buckle: '#c9c2b0', boot: '#6c4a34', sole: '#2e221c', lace: '#e9dcc4',
};

// ---------------------------------------------------------------- the model

// A sphere painted as a fine gingham check by its own grid (W x H segments, one to a check).
function checked(r, x, y, z, sx, sy, sz, W, H) {
  const geo = place(new THREE.SphereGeometry(r, W, H), x, y, z, sx, sy, sz);
  const [c0, c1, c2] = COL.check.map((c) => new THREE.Color(c));
  const paint = (px, py, pz) => {
    const dx = (px - x) / sx, dy = (py - y) / sy, dz = (pz - z) / sz;
    let phi = Math.atan2(dz, -dx);
    if (phi < 0) phi += Math.PI * 2;
    const th = Math.acos(Math.max(-1, Math.min(1, dy / (Math.hypot(dx, dy, dz) || 1))));
    const i = Math.floor(phi / ((Math.PI * 2) / W)) & 1, j = Math.floor(th / (Math.PI / H)) & 1;
    return i && j ? c2 : i || j ? c1 : c0;
  };
  return [geo, paint];
}

// Splits every edge longer than L at its middle until none is. An edge is split the same
// way in both its triangles, so nothing cracks. A flat shape's triangles span the whole
// shape, and wrapped onto the head their middles would sink under the skin.
function fine(geo, L) {
  const src = geo.index ? geo.toNonIndexed() : geo, a = src.attributes.position;
  let tris = [];
  for (let i = 0; i < a.count; i += 3) tris.push([0, 1, 2].map((k) => [a.getX(i + k), a.getY(i + k), a.getZ(i + k)]));
  const long = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > L;
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
  for (let pass = 0, more = true; more && pass < 12; pass++) {
    more = false;
    const out = [];
    for (let [p, q, r] of tris) {
      let s = [long(p, q), long(q, r), long(r, p)];
      const n = s[0] + s[1] + s[2];
      if (!n) { out.push([p, q, r]); continue; }
      more = true;
      if (n === 3) {
        const m0 = mid(p, q), m1 = mid(q, r), m2 = mid(r, p);
        out.push([p, m0, m2], [m0, q, m1], [m2, m1, r], [m0, m1, m2]);
        continue;
      }
      // turned so that p-q is split, and with two, r-p is not
      while (n === 1 ? !s[0] : s[2]) { [p, q, r] = [q, r, p]; s = [s[1], s[2], s[0]]; }
      const m0 = mid(p, q);
      if (n === 1) out.push([p, m0, r], [m0, q, r]);
      else { const m1 = mid(q, r); out.push([m0, q, m1], [p, m0, m1], [p, m1, r]); }
    }
    tris = out;
  }
  if (src !== geo) src.dispose();
  geo.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(2), 3));
  return g;
}

// A flat shape drawn facing -z round the face (x, y), given some thickness and wrapped
// onto the front of the head, standing lift off it: glasses, moustache and the grin that
// still read from the side. L: the longest edge left after fine().
function onFace(shape, depth, lift, L = 0.02) {
  const g = fine(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6 }), L);
  const a = g.attributes.position, [cx, cy, cz] = HEAD.c, [rx, ry, rz] = HEAD.r, n = new THREE.Vector3();
  for (let i = 0; i < a.count; i++) {
    const x = a.getX(i), y = a.getY(i), off = lift + depth - a.getZ(i);
    const u = (x - cx) / rx, w = (y - cy) / ry;
    const z = cz - rz * Math.sqrt(Math.max(0.02, 1 - u * u - w * w));
    n.set((x - cx) / (rx * rx), (y - cy) / (ry * ry), (z - cz) / (rz * rz)).normalize();
    a.setXYZ(i, x + n.x * off, y + n.y * off, z + n.z * off);
  }
  return g;
}
function roundRect(s, x, y, w, h, r) {
  const x0 = x - w / 2, y0 = y - h / 2, x1 = x + w / 2, y1 = y + h / 2;
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0); s.quadraticCurveTo(x1, y0, x1, y0 + r);
  s.lineTo(x1, y1 - r); s.quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1); s.quadraticCurveTo(x0, y1, x0, y1 - r);
  s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}

// His hairline under the tufts: [azimuth from the front, polar angle from the crown] in
// degrees, under the band in front, down past the eyes at the sides and low at the back.
const HAIRLINE = [[0, 50], [22, 54], [42, 66], [60, 92], [90, 110], [130, 118], [180, 122]];

// one tuft of hair: a soft lump at azimuth a (degrees from the front), height y and radius R
// from the head's axis, r across, squashed by (sx, sy, sz), sz outwards
function tuft(a, y, R, r, sx, sy, sz) {
  const A = (a * Math.PI) / 180;
  return place(new THREE.IcosahedronGeometry(r, 2), Math.sin(A) * R, y, -Math.cos(A) * R, sx, sy, sz, 0, -A, 0);
}

// The head band: an ellipse round the hair (rx across, rz front to back about z0), tipped
// up at the front by TILT; y at azimuth a (degrees), and its distance from the head's axis.
const BAND = { y: 1.44, z0: 0.045, rx: 0.33, rz: 0.27, tilt: 0.18, h: 0.05 };
const bandY = (a) => BAND.y + Math.sin(BAND.tilt) * BAND.rz * Math.cos((a * Math.PI) / 180);
const bandR = (a) => {
  const A = (a * Math.PI) / 180, x = BAND.rx * Math.sin(A), z = BAND.z0 - BAND.rz * Math.cos(A);
  return Math.hypot(x, z);
};

// A short chin beard on the head ellipsoid, k times its size: from under the lip in the
// middle to a strip a little way along the jaw. [azimuth, polar angle of the top edge, of
// the bottom edge] in degrees for one side, mirrored.
const BEARD = [[0, 130, 166], [18, 132, 163], [32, 137, 157], [43, 142, 151], [50, 146, 147.5]];
function chinBeard(k, w = 28, h = 6) {
  const [cx, cy, cz] = HEAD.c, [rx, ry, rz] = HEAD.r;
  const edge = (a, i) => {
    a = Math.abs(a);
    for (let j = 1; j < BEARD.length; j++) {
      const [a0] = BEARD[j - 1], [a1] = BEARD[j];
      if (a <= a1) return BEARD[j - 1][i] + ((BEARD[j][i] - BEARD[j - 1][i]) * (a - a0)) / (a1 - a0);
    }
    return BEARD[BEARD.length - 1][i];
  };
  const amax = BEARD[BEARD.length - 1][0], cols = [];
  for (let i = 0; i <= w; i++) {
    const a = -amax + (2 * amax * i) / w, t0 = edge(a, 1), t1 = edge(a, 2), col = [];
    for (let j = 0; j <= h; j++) {
      const p = onScalp(a, t0 + ((t1 - t0) * j) / h, k);
      const n = new THREE.Vector3((p[0] - cx) / (rx * rx), (p[1] - cy) / (ry * ry), (p[2] - cz) / (rz * rz)).normalize();
      col.push([p, [n.x, n.y, n.z]]);
    }
    cols.push(col);
  }
  const pos = [], nor = [];
  const tri = (...vs) => { for (const [p, n] of vs) { pos.push(...p); nor.push(...n); } };
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) {
      const a0 = cols[i][j], a1 = cols[i][j + 1], b0 = cols[i + 1][j], b1 = cols[i + 1][j + 1];
      tri(a0, b0, a1);
      tri(b0, b1, a1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

function jonGeometry() {
  const { parts, add } = partList();

  // legs: slate trousers, brown boots with laces
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

  // the blue gingham shirt: placket, buttons, a breast pocket, collar
  const [torso, torsoPaint] = checked(0.22, 0, 0.8, 0, 1, 1.2, 0.84, 56, 32);
  add('spine', COL.check[0], torso, { smooth: true, outline: 1, paint: torsoPaint });
  add('spine', COL.placket, rbox(0.03, 0.34, 0.02, 0.008, 0, 0.8, -0.181, -0.08, 0, 0), { outline: 0 });
  for (const y of [0.66, 0.9]) add('spine', COL.button, sph(0.011, 0, y, -0.193 + (y - 0.8) * 0.06, 1, 1, 0.5, 0), { outline: 0 });
  add('spine', COL.placket, rbox(0.08, 0.075, 0.02, 0.01, 0.105, 0.86, -0.166, -0.1, -0.5, 0), { outline: 0 });
  add('spine', COL.skin, sph(0.042, 0, 1.0, -0.172, 1, 1.25, 0.45, 1), { smooth: true, outline: 0 });
  for (const s of [-1, 1]) {
    add('spine', COL.collar, place(new THREE.ConeGeometry(0.036, 0.075, 3), s * 0.05, 0.985, -0.186, 1, 1, 0.35, Math.PI - 0.35, 0, s * 0.55), { outline: 0 });
  }
  // the plain green lanyard round his neck, down to its clip
  for (const s of [-1, 1]) {
    add('spine', COL.lanyard, tube([[s * 0.055, 1.035, 0.03], [s * 0.075, 1.0, -0.11], [s * 0.045, 0.88, -0.183], [s * 0.008, 0.79, -0.19]], 0.008, 16), { smooth: true, outline: 0 });
  }
  add('spine', COL.clip, sph(0.011, 0, 0.784, -0.196, 1, 1.3, 0.6, 1), { outline: 0 });

  // the little orange GPS backpack: straps over the shoulders, a lid, a label, a green
  // light and the antenna trailing down, like the lizards' own
  for (const s of [-1, 1]) {
    add('spine', COL.strap, tube([[s * 0.125, 0.86, 0.15], [s * 0.125, 0.96, 0.1], [s * 0.125, 1.03, 0.0], [s * 0.125, 0.96, -0.1], [s * 0.122, 0.86, -0.147], [s * 0.118, 0.74, -0.158]], 0.011, 24), { smooth: true, outline: 0 });
  }
  add('spine', COL.pack, rbox(0.22, 0.23, 0.1, 0.035, 0, 0.795, 0.205), { outline: 1 });
  add('spine', COL.packLid, rbox(0.224, 0.045, 0.104, 0.018, 0, 0.9, 0.205), { outline: 0.6 });
  add('spine', COL.label, rbox(0.11, 0.06, 0.006, 0.006, 0, 0.79, 0.256), { outline: 0 });
  add('spine', COL.led, sph(0.011, -0.06, 0.86, 0.256, 1, 1, 0.6, 1), { outline: 0 });
  add('spine', COL.antenna, tube([[0.07, 0.7, 0.22], [0.09, 0.6, 0.25], [0.1, 0.5, 0.27]], 0.005, 8), { outline: 0 });
  add('spine', COL.antenna, sph(0.012, 0.1, 0.495, 0.272, 1, 1, 1, 1), { smooth: true, outline: 0 });

  // arms: checked sleeves rolled above the elbow, bare forearms, round hands
  for (const [side, sx] of [['L', -0.24], ['R', 0.24]]) {
    const o = sx > 0 ? 0.008 : -0.008;
    const [sleeve, sleevePaint] = checked(0.088, sx, 0.94, 0, 1, 1.1, 1, 24, 12);
    add('arm' + side, COL.check[0], sleeve, { smooth: true, outline: 1, paint: sleevePaint });
    add('arm' + side, COL.cuff, cyl(0.07, 0.074, 0.84, 0.89, sx + o, 0, 12), { outline: 0.6 });
    add('arm' + side, COL.skin, cyl(0.05, 0.046, 0.62, 0.85, sx + o * 2, 0, 10), { outline: 0.8 });
    add('arm' + side, COL.skin, sph(0.064, sx + o * 2, 0.585, -0.005, 1, 1.05, 1, 2), { smooth: true, outline: 1 });
  }

  // head: the round face, eyes, cheeks, brows and nose
  add('head', COL.skin, sph(0.28, ...HEAD.c, 1.03, 0.95, 0.97, 3), { smooth: true, outline: 1 });
  for (const x of [-0.1, 0.1]) {
    add('head', COL.eye, sph(0.038, x, 1.325, -0.255, 0.85, 1.05, 0.5, 2), { smooth: true, outline: 0 });
    add('head', COL.shine, sph(0.012, x + 0.012, 1.341, -0.272, 1, 1, 0.5, 1), { smooth: true, outline: 0 });
    add('head', COL.cheek, sph(0.034, x * 1.72, 1.24, -0.22, 1, 0.6, 0.45, 2), { smooth: true, outline: 0 });
    const b = new THREE.Shape();
    b.moveTo(x - 0.046, 1.398);
    b.quadraticCurveTo(x, 1.436, x + 0.046, 1.398);
    b.quadraticCurveTo(x, 1.408, x - 0.046, 1.398);
    add('head', COL.hair, onFace(b, 0.008, 0.005), { outline: 0 });
  }
  add('head', COL.skin, sph(0.024, 0, 1.275, -0.284, 1.1, 0.9, 0.9, 1), { smooth: true, outline: 0 });

  // thin dark rectangular glasses: two frames, the bridge and the arms back to the hair
  for (const x of [-0.1, 0.1]) {
    const f = roundRect(new THREE.Shape(), x, 1.33, 0.118, 0.086, 0.014);
    f.holes.push(roundRect(new THREE.Path(), x, 1.33, 0.102, 0.07, 0.008));
    add('head', COL.glasses, onFace(f, 0.008, 0.024, 0.04), { outline: 0 });
    const s = Math.sign(x);
    add('head', COL.glasses, tube([[s * 0.17, 1.342, -0.245], [s * 0.26, 1.338, -0.138], [s * 0.296, 1.334, -0.02]], 0.0042, 8), { outline: 0 });
  }
  add('head', COL.glasses, onFace(roundRect(new THREE.Shape(), 0, 1.338, 0.088, 0.008, 0.003), 0.008, 0.024, 0.04), { outline: 0 });

  // the big toothy grin under the moustache: dark inside, a row of top teeth with little
  // gaps, a few bottom teeth and the tongue behind them
  const MY = 1.214, MW = 0.084, MH = 0.072; // the mouth's top edge, half width and depth
  const mouth = new THREE.Shape();
  mouth.moveTo(-MW, MY);
  mouth.lineTo(MW, MY);
  mouth.absellipse(0, MY, MW, MH, 0, Math.PI, true);
  add('head', COL.mouth, onFace(mouth, 0.001, 0.003), { outline: 0 });
  const xw = (y, k = 0.004) => MW * Math.sqrt(Math.max(0, 1 - ((MY - y) / MH) ** 2)) - k;
  const ty = MY - 0.002, tb = MY - 0.03;
  const teeth = new THREE.Shape();
  teeth.moveTo(-xw(ty), ty);
  teeth.lineTo(xw(ty), ty);
  teeth.lineTo(xw(tb), tb);
  teeth.quadraticCurveTo(0, tb - 0.01, -xw(tb), tb);
  teeth.lineTo(-xw(ty), ty);
  add('head', COL.teeth, onFace(teeth, 0.001, 0.0045), { outline: 0 });
  for (const x of [-0.048, -0.024, 0, 0.024, 0.048]) {
    add('head', COL.gap, onFace(roundRect(new THREE.Shape(), x, (ty + tb) / 2 + 0.002, 0.003, ty - tb - 0.008, 0.0012), 0.001, 0.0056), { outline: 0 });
  }
  add('head', COL.tongue, onFace(new THREE.Shape().absellipse(0, MY - MH + 0.021, 0.03, 0.009, 0, Math.PI * 2, false), 0.001, 0.0038), { outline: 0 });
  // (the bottom teeth: a band along the bottom of the mouth, 30 degrees each way)
  const low = [];
  for (let k = 0; k <= 12; k++) {
    const t = Math.PI * (1.5 - 0.17 + (0.34 * k) / 12);
    low.push(new THREE.Vector2(Math.cos(t) * (MW - 0.003), MY + Math.sin(t) * (MH - 0.003)));
  }
  for (let k = 12; k >= 0; k--) {
    const t = Math.PI * (1.5 - 0.17 + (0.34 * k) / 12);
    low.push(new THREE.Vector2(Math.cos(t) * (MW - 0.007), MY + Math.sin(t) * (MH - 0.014)));
  }
  add('head', COL.teeth, onFace(new THREE.Shape(low), 0.001, 0.0045), { outline: 0 });
  const m = new THREE.Shape();
  m.moveTo(-0.09, 1.206);
  m.quadraticCurveTo(-0.072, 1.237, -0.036, 1.242);
  m.quadraticCurveTo(-0.012, 1.247, 0, 1.24);
  m.quadraticCurveTo(0.012, 1.247, 0.036, 1.242);
  m.quadraticCurveTo(0.072, 1.237, 0.09, 1.206);
  m.quadraticCurveTo(0.066, 1.216, 0.036, 1.214);
  m.quadraticCurveTo(0.012, 1.213, 0, 1.209);
  m.quadraticCurveTo(-0.012, 1.213, -0.036, 1.214);
  m.quadraticCurveTo(-0.066, 1.216, -0.09, 1.206);
  add('head', COL.hair, onFace(m, 0.01, 0.006), { outline: 0 });
  add('head', COL.hair, chinBeard(1.018), { smooth: true, outline: 0 });

  // the big fluffy wavy hair: a close crown and a mass behind the head, then rounded tufts
  // over them, wider than the head, puffing out over the ears and bushing out at the back
  // to the shoulders. Above and below the band they stand a little proud of it, so the
  // band presses in.
  add('head', COL.hair, scalp(1.06, COL.hair, COL.hairEdge, 48, 8, HAIRLINE, 0.03), { smooth: true, outline: 0.5 });
  add('head', COL.hair, sph(1, 0, 1.2, 0.12, 0.3, 0.24, 0.24, 3), { smooth: true, outline: 1 });
  const tone = [COL.hair, COL.sheen, COL.curl];
  let n = 0;
  const puff = (a, y, R, r, sx, sy, sz) => {
    const k = 1 + 0.07 * (((n * 5) % 3) - 1); // (a little more or less, so the waves are not a pattern)
    add('head', tone[n++ % 3], tuft(a, y, R, r * k, sx, sy, sz), { smooth: true, outline: 1 });
  };
  puff(0, 1.59, 0, 0.12, 1.2, 0.45, 1.2);
  for (const a of [0, 60, 120, 180, -120, -60]) puff(a, 1.585 - 0.02 * (1 - Math.cos((a * Math.PI) / 180)), 0.12, 0.085, 1.15, 0.65, 0.85);
  for (const a of [0, 45, 90, 135, 180, -135, -90, -45]) puff(a, bandY(a) + 0.062, bandR(a) - 0.066, 0.08, 1.2, 0.85, 0.8);
  // wavy locks: below the band, over the ears, then down to the shoulders, and the ends
  [62, 86, 110, 134, 158, 180, -158, -134, -110, -86, -62].forEach((a, i) => puff(a, bandY(a) - 0.1 - (i % 2) * 0.012, bandR(a) - 0.035, 0.085, 1, 1.25, 0.75));
  [72, 97, 122, 147, 172, -172, -147, -122, -97, -72].forEach((a, i) => puff(a, 1.23 - (i % 2) * 0.02, 0.3, 0.11, 0.95, 1.3, 0.8));
  [85, 110, 135, 160, 180, -160, -135, -110, -85].forEach((a, i) => puff(a, 1.07 + (i % 2) * 0.02, 0.25, 0.095, 1, 1.3, 0.75));
  for (const a of [122, 147, 172, -172, -147, -122]) puff(a, 0.975, 0.225, 0.07, 1.15, 1, 0.8);

  // the head torch on its green band, round the hair
  add('head', COL.band, place(new THREE.CylinderGeometry(1, 1, BAND.h, 40, 1, true), 0, BAND.y, BAND.z0, BAND.rx, 1, BAND.rz, BAND.tilt, 0, 0), { smooth: true, outline: 0.5 });
  const ty0 = bandY(0) - 0.006, tz0 = BAND.z0 - BAND.rz * Math.cos(BAND.tilt);
  add('head', COL.torch, rbox(0.072, 0.05, 0.04, 0.012, 0, ty0, tz0 - 0.021, -BAND.tilt, 0, 0), { outline: 0 });
  add('head', COL.rim, place(new THREE.CylinderGeometry(0.023, 0.023, 0.008, 16), 0, ty0 - 0.002, tz0 - 0.039, 1, 1, 1, Math.PI / 2 - BAND.tilt, 0, 0), { outline: 0 });
  add('head', COL.lamp, place(new THREE.CylinderGeometry(0.017, 0.017, 0.012, 16), 0, ty0 - 0.003, tz0 - 0.042, 1, 1, 1, Math.PI / 2 - BAND.tilt, 0, 0), { outline: 0 });

  return mergeParts(parts);
}

// ---------------------------------------------------------------- Jon

const TALK_D = 2.0; // he stops this far from the player to talk
const UP_SPEED = 1.6, OFF_SPEED = 1.6;
const RETIE_AFTER = 1.7; // seconds from a snap to his coming for the re-tie
// the spheres that hold him, swinging arms and boots mid-stride too: [height of the
// centre, radius]
const BODY = [[1.33, 0.46], [0.8, 0.45], [0.3, 0.36], [0.12, 0.42]];

const NUMBERS = ['no', 'one', 'two', 'three', 'four', 'five'];
const wrap = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };

// a segment against an ellipsoid volume { cx, cy, cz, rx, ry, rz } or an upright
// cylinder { x, z, r, y0, y1 }
function hits(ax, ay, az, bx, by, bz, v) {
  if (v.rx) {
    const px = (ax - v.cx) / v.rx, py = (ay - v.cy) / v.ry, pz = (az - v.cz) / v.rz;
    const dx = (bx - ax) / v.rx, dy = (by - ay) / v.ry, dz = (bz - az) / v.rz;
    const dd = dx * dx + dy * dy + dz * dz;
    const t = dd > 0 ? Math.max(0, Math.min(1, -(px * dx + py * dy + pz * dz) / dd)) : 0;
    const qx = px + dx * t, qy = py + dy * t, qz = pz + dz * t;
    return qx * qx + qy * qy + qz * qz < 1;
  }
  const px = ax - v.x, pz = az - v.z, dx = bx - ax, dz = bz - az;
  const A = dx * dx + dz * dz, B = 2 * (px * dx + pz * dz), C = px * px + pz * pz - v.r * v.r;
  if (A < 1e-9) return C < 0 && Math.max(ay, by) > v.y0 && Math.min(ay, by) < v.y1;
  const disc = B * B - 4 * A * C;
  if (disc <= 0) return false;
  const s = Math.sqrt(disc), t0 = Math.max(0, (-B - s) / (2 * A)), t1 = Math.min(1, (-B + s) / (2 * A));
  if (t0 >= t1) return false;
  const y0 = ay + (by - ay) * t0, y1 = ay + (by - ay) * t1;
  return Math.max(y0, y1) > v.y0 && Math.min(y0, y1) < v.y1;
}

export function buildJon(game, { story, shot, endShot, parent }) {
  const { player, camera, collision } = game;
  const T = game.data.terrain;
  let model = null, group = null;
  function ensure() {
    if (model) return model;
    model = buildJames(game, { geometry: jonGeometry, name: 'jon', bag: false, solid: false });
    model.showPole(false);
    group = model.group;
    group.visible = false;
    parent.add(group);
    jon.model = model;
    jon.group = group;
    return model;
  }

  // The trees and bushes as rough volumes, a little inside what is drawn: solid (bushes
  // and trunks) is what can hide him; vols (the crowns too) is what must not stand
  // between the talk camera and him. covers: the ones he can walk off behind.
  const hosts = (game.veg && game.veg.hosts) || {};
  const crownOf = new Map();
  for (const c of hosts.crowns || []) if (!crownOf.has(c.owner)) crownOf.set(c.owner, c);
  const occluders = [];
  for (const m of hosts.mounds || []) {
    const vol = { cx: m.x, cy: m.y, cz: m.z, rx: 0.85 * m.r, ry: 0.9 * m.h, rz: 0.85 * m.r };
    occluders.push({ kind: 'bush', x: m.x, z: m.z, r: m.r, vols: [vol], solid: vol, cover: m.h >= 1 && m.r >= 0.5 });
  }
  for (const t of hosts.trunks || []) {
    const c = crownOf.get(t.owner);
    const solid = { x: t.x, z: t.z, r: 0.8 * t.r0, y0: t.y0, y1: t.y1 };
    const vols = [solid];
    if (c) vols.push({ cx: c.cx, cy: c.cy, cz: c.cz, rx: 0.75 * c.rx, ry: 0.75 * c.ry, rz: 0.75 * c.rz });
    occluders.push({ kind: 'tree', x: t.x, z: t.z, r: Math.max(t.r0, c ? c.rx : 0), vols, solid, trunk: t.r0, cover: t.r0 >= 0.12 });
  }
  const covers = occluders.filter((o) => o.cover);

  const jon = {
    model: null, group: null, ensure,
    state: 'away', // 'visit' (talking), 'leaving' (walking off, still in view)
    kind: null,
    frames: { appear: -1, gone: -1 },
    get visible() { return !!group && group.visible; },
    get cover() { return cover; }, // the tree or bush he is walking off behind (or null)
    hidden: () => !model || hiddenAt(model.position.x, model.position.z),
    visit(kind, species = null) { forced = { kind, species }; },
    get visits() { return today().visits; },
    get notes() { return { ...today().notes }; },
    steer,
    update,
  };

  // ---------------------------------------------------------------- what the camera sees

  const frustum = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sph = new THREE.Sphere();
  const _right = new THREE.Vector3(), _up = new THREE.Vector3(), _pt = new THREE.Vector3(), _head = new THREE.Vector3();
  function view() {
    camera.updateMatrixWorld();
    _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(_pm);
    _right.setFromMatrixColumn(camera.matrixWorld, 0);
    _up.setFromMatrixColumn(camera.matrixWorld, 1);
  }
  // the spheres round him standing at (x, z), and round his shadow on the ground
  const _spheres = [];
  function spheres(x, z) {
    _spheres.length = 0;
    const g = Math.max(0, T.heightAt(x, z));
    for (const [h, r] of BODY) _spheres.push([x, g + h, z, r]);
    const sun = game.sky && game.sky.state && game.sky.state.sunDir;
    if (sun && sun.y > 0.03) {
      let dx = (-sun.x / Math.max(0.12, sun.y)) * 1.6, dz = (-sun.z / Math.max(0.12, sun.y)) * 1.6;
      const L = Math.hypot(dx, dz);
      if (L > 9) { dx *= 9 / L; dz *= 9 / L; }
      for (const f of [0.35, 0.7, 1]) {
        const sx = x + dx * f, sz = z + dz * f;
        _spheres.push([sx, Math.max(0, T.heightAt(sx, sz)) + 0.1, sz, 0.55]);
      }
    }
    return _spheres;
  }
  // a tree or bush the vegetation cut-out (the tunnel from the camera to the player's
  // head) may be opening up: it hides nothing
  function cutNear(c) {
    const cut = vegUniforms.uVegCut.value;
    if (!(cut > 0)) return false;
    player.headPosition(_head);
    const ax = camera.position.x, az = camera.position.z, dx = _head.x - ax, dz = _head.z - az;
    const L2 = dx * dx + dz * dz;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((c.x - ax) * dx + (c.z - az) * dz) / L2)) : 0;
    return Math.hypot(c.x - ax - dx * t, c.z - az - dz * t) < cut + (c.trunk || c.r) + 0.6;
  }
  // Out of view standing at (x, z): every sphere round him and his shadow outside the
  // view, or wholly in it and all round behind trunks and bushes (one across an edge of the
  // view counts as seen: the samples could miss the part inside). hidBy: what hid him last
  // ('tree', 'bush' or null for out of the view).
  const OFFS = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
  const _near = [];
  let hidBy = null;
  function hiddenAt(x, z) {
    view();
    const C = camera.position;
    let by = null;
    for (const [sx, sy, sz, r] of spheres(x, z)) {
      _sph.center.set(sx, sy, sz);
      _sph.radius = r;
      if (!frustum.intersectsSphere(_sph)) continue;
      for (const pl of frustum.planes) if (pl.distanceToPoint(_sph.center) < r) return false;
      // the trunks and bushes near the line to this sphere
      _near.length = 0;
      const dx = sx - C.x, dz = sz - C.z, L2 = dx * dx + dz * dz || 1;
      for (const o of occluders) {
        const t = Math.max(0, Math.min(1, ((o.x - C.x) * dx + (o.z - C.z) * dz) / L2));
        if (Math.hypot(o.x - C.x - dx * t, o.z - C.z - dz * t) < (o.trunk || o.r) + r + 0.3 && !cutNear(o)) _near.push(o);
      }
      if (!_near.length) return false;
      for (const [a, b] of OFFS) {
        _pt.copy(_sph.center).addScaledVector(_right, a * r).addScaledVector(_up, b * r);
        if (!frustum.containsPoint(_pt)) continue;
        let hit = null;
        for (const o of _near) if (hits(C.x, C.y, C.z, _pt.x, _pt.y, _pt.z, o.solid)) { hit = o; break; }
        if (!hit) return false;
        by = hit.kind;
      }
    }
    hidBy = by;
    return true;
  }

  // ---------------------------------------------------------------- where he goes

  // free walkable ground all along a to b, clear of the player
  function clear(a, b, r = 0.26) {
    const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 0.3)), p = player.position;
    for (let i = 1; i <= n; i++) {
      const x = a.x + ((b.x - a.x) * i) / n, z = a.z + ((b.z - a.z) * i) / n;
      if (!collision.isFree(x, z, r) || Math.hypot(x - p.x, z - p.z) < 0.7) return false;
    }
    return true;
  }
  // as far as free ground goes from a along (ux, uz), up to max metres, short of the player
  function reach(a, ux, uz, max) {
    let x = a.x, z = a.z;
    const p = player.position;
    for (let s = 0.3; s <= max; s += 0.3) {
      const nx = a.x + ux * s, nz = a.z + uz * s;
      if (!collision.isFree(nx, nz, 0.26) || Math.hypot(nx - p.x, nz - p.z) < 0.7) break;
      x = nx; z = nz;
    }
    return { x, z };
  }

  // The talk camera for him at tp: over the player's shoulder (as with James), on the
  // side with nothing in the way. Null when neither side is clear.
  const _cam = new THREE.Vector3(), _look = new THREE.Vector3();
  function lensFor(tp) {
    const p = player.position, dx = tp.x - p.x, dz = tp.z - p.z, d = Math.max(0.5, Math.hypot(dx, dz));
    const ux = dx / d, uz = dz / d, gy = Math.max(0, T.heightAt(tp.x, tp.z));
    for (const sgn of [1, -1]) {
      const cx = p.x - ux * 2.6 + uz * 2.0 * sgn, cz = p.z - uz * 2.6 - ux * 2.0 * sgn, cy = p.y + 1.85;
      if (Math.max(0, T.heightAt(cx, cz)) > cy - 0.8) continue;
      let ok = true;
      for (const o of occluders) {
        // (only those near the line from the camera to him)
        const ex = tp.x - cx, ez = tp.z - cz, L2 = ex * ex + ez * ez;
        const t = Math.max(0, Math.min(1, ((o.x - cx) * ex + (o.z - cz) * ez) / L2));
        if (Math.hypot(o.x - cx - ex * t, o.z - cz - ez * t) > o.r + 0.5) continue;
        for (const v of o.vols) {
          if (hits(cx, cy, cz, tp.x, gy + 1.35, tp.z, v) || hits(cx, cy, cz, tp.x, gy + 0.75, tp.z, v) || hits(cx, cy, cz, p.x, p.y + 1.2, p.z, v)) { ok = false; break; }
          // (the camera itself inside a bush or a crown)
          if (v.rx && hits(cx, cy, cz, cx, cy + 0.01, cz, v)) { ok = false; break; }
        }
        if (!ok) break;
      }
      if (!ok) continue;
      return { cam: _cam.set(cx, cy, cz).clone(), look: _look.set(p.x + dx * 0.7, gy + 1.05, p.z + dz * 0.7).clone() };
    }
    return null;
  }

  // A spot RULES.jon.near metres from the player, out of view, with a clear walk up to
  // the talk point and a clear talk camera; the side-behind of the player first.
  const ANGLES = [50, -50, 75, -75, 30, -30, 100, -100, 125, -125, 15, -15, 150, -150, 0, 180];
  function findSpot() {
    view();
    const p = player.position, [n0, n1] = RULES.jon.near;
    const back = Math.atan2(camera.position.x - p.x, camera.position.z - p.z);
    const radii = [0.5, 0.25, 0.75, 0, 1].map((f) => n0 + (n1 - n0) * f);
    for (const deg of ANGLES) {
      const a = back + (deg * Math.PI) / 180, ux = Math.sin(a), uz = Math.cos(a);
      for (const R of radii) {
        const x = p.x + ux * R, z = p.z + uz * R;
        if (!collision.isFree(x, z, 0.32)) continue;
        if (Math.abs(Math.max(0, T.heightAt(x, z)) - p.y) > 1.2) continue;
        let out = true;
        for (const [sx, sy, sz, r] of spheres(x, z)) {
          _sph.center.set(sx, sy, sz);
          _sph.radius = r + 0.15;
          if (frustum.intersectsSphere(_sph)) { out = false; break; }
        }
        if (!out) continue;
        const tp = { x: p.x + ux * TALK_D, z: p.z + uz * TALK_D };
        if (!collision.isFree(tp.x, tp.z, 0.3) || !clear({ x, z }, tp)) continue;
        const lens = lensFor(tp);
        if (lens) return { x, z, heading: Math.atan2(ux, uz), tp, lens };
      }
    }
    return null;
  }

  // Off behind the nearest tree or bush: one that hides him from here, unless walking out
  // of the side of the view is much shorter; else one on his way out of the view, and on
  // out of that side from behind it (walkOn).
  let cover = null;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  function planLeave() {
    view();
    const C = camera.position, J = model.position;
    const near = [];
    for (const c of covers) {
      const d = Math.hypot(c.x - J.x, c.z - J.z);
      if (d < 12 && d > c.r + 0.3) near.push([d, c]);
    }
    near.sort((a, b) => a[0] - b[0]);
    const out = planOut();
    const outLen = out.length ? dist(out[0], J) : Infinity;
    const ox = out.length ? (out[0].x - J.x) / (outLen || 1) : 0, oz = out.length ? (out[0].z - J.z) / (outLen || 1) : 0;
    let best = null, onWay = null;
    for (const [, c] of near.slice(0, 24)) {
      if (cutNear(c)) continue;
      let ux = c.x - C.x, uz = c.z - C.z;
      const L = Math.hypot(ux, uz) || 1;
      ux /= L; uz /= L;
      const R = c.trunk || c.r;
      const side = (J.x - c.x) * -uz + (J.z - c.z) * ux >= 0 ? 1 : -1;
      const W = { x: c.x - uz * side * (R + 0.8), z: c.z + ux * side * (R + 0.8) };
      const B = { x: c.x + ux * (R + 0.9), z: c.z + uz * (R + 0.9) };
      const len = dist(J, W) + dist(W, B);
      if ((best && len >= best.len) || !clear(J, W) || !clear(W, B)) continue;
      if (hiddenAt(B.x, B.z)) best = { c, len, path: [W, B] };
      else if (!onWay && len < 7 && ((B.x - J.x) * ox + (B.z - J.z) * oz) / (dist(B, J) || 1) > 0.3) onWay = { c, len, path: [W, B] };
    }
    const pick = best && best.len <= outLen + 4 ? best : onWay && onWay.len <= outLen + 3 ? onWay : null;
    cover = pick ? pick.c : null;
    return pick ? pick.path : out;
  }
  // Out of the side of the view: across the nearer side plane of the view (or the other,
  // or as far as he can get); straight away from the camera when hemmed in.
  function planOut() {
    view();
    const C = camera.position, J = model.position, ways = [];
    for (const k of [0, 1]) {
      const n = frustum.planes[k].normal, nl = Math.hypot(n.x, n.z);
      if (nl < 0.2) continue;
      const d = frustum.planes[k].distanceToPoint(_pt.set(J.x, J.y + 0.8, J.z));
      ways.push([Math.min(14, (d + 2.2) / nl), -n.x / nl, -n.z / nl]); // (2.2: his width and some of his shadow)
    }
    ways.sort((a, b) => a[0] - b[0]);
    let far = null;
    for (const [need, ux, uz] of ways) {
      const E = reach(J, ux, uz, need + 0.5);
      if (dist(E, J) >= need - 0.3) return [E];
      if (!far || dist(E, J) > dist(far, J)) far = E;
    }
    if (far && dist(far, J) > 2) return [far];
    const L = dist(J, C) || 1, E = reach(J, (J.x - C.x) / L, (J.z - C.z) / L, 10);
    return dist(E, J) > 1 ? [E] : [];
  }

  // Last of all: well away from the player, since the follow camera keeps whatever is near
  // them in frame however it turns. A spot AWAY metres off with a clear straight walk to
  // it, the nearest out of view if there is one, else the nearest; none (he stands) when
  // he is already that far off and nowhere out of view can be reached.
  const AWAY = [7, 9.5, 12];
  function planAway() {
    const J = model.position, p = player.position;
    let best = null;
    for (const R of AWAY) {
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2, E = { x: p.x + Math.sin(a) * R, z: p.z + Math.cos(a) * R };
        if (!collision.isFree(E.x, E.z, 0.32) || Math.abs(Math.max(0, T.heightAt(E.x, E.z)) - p.y) > 1.2 || !clear(J, E)) continue;
        const hid = hiddenAt(E.x, E.z), d = dist(J, E);
        if (!best || (hid && !best.hid) || (hid === best.hid && d < best.d)) best = { ...E, hid, d };
      }
    }
    if (!best || (!best.hid && dist(J, p) >= AWAY[0] - 1)) return [];
    return [{ x: best.x, z: best.z }];
  }

  // On along the way; at its end, still in view, out of the side of the view (twice at
  // most), then well away from the player; standing, he looks again every so often.
  let path = [], planNext = false, legs = 0, replanT = 0;
  function walkOn() {
    let p = path.shift();
    if (!p && jon.state === 'leaving') {
      legs++;
      path = legs <= 2 ? planOut() : planAway();
      p = path.shift();
    }
    if (!p) { model.face(model.heading); replanT = 1.5; return; } // (stands looking off)
    model.walkTo(p.x, p.z, OFF_SPEED).then((ok) => {
      if (jon.state !== 'leaving') return;
      if (ok) walkOn(); else replanT = 0.5;
    });
  }

  // ---------------------------------------------------------------- appearing and going

  function appear(spot, kind) {
    ensure();
    today().visits++;
    model.place(spot.x, spot.z, spot.heading);
    model.lookAtPlayer = true;
    model.face(null);
    group.visible = true;
    jon.frames.appear = game.frame;
    events.emit('jon:appear', { kind, x: spot.x, z: spot.z });
  }
  function gone() {
    group.visible = false;
    model.talking = false;
    jon.frames.gone = game.frame;
    events.emit('jon:gone', { x: model.position.x, z: model.position.z, behind: hidBy });
    jon.state = 'away';
    jon.kind = null;
    cover = null;
    path = [];
  }

  // ---------------------------------------------------------------- a visit

  const breaks = () => (game.catching && game.catching.breaks) || null;

  // today's visits and notes; whether he can come now (the re-tie may break the gap)
  const day = { key: -1, visits: 0, notes: {} };
  function today() {
    const k = dayKey();
    if (day.key !== k) { day.key = k; day.visits = 0; day.notes = {}; }
    return day;
  }
  const canVisit = (retie = false) => today().visits < RULES.jon.most && (retie || state.clock.hours - lastEnd >= RULES.jon.gap);

  // a note from him: a toast with his portrait, and he does not come
  function note(kind, text, species = null) {
    const d = today();
    d.notes[kind] = (d.notes[kind] || 0) + 1;
    kit.toast(`${JON.name}: ${say(text, { name: state.playerName || SCRIPT.nameFallback })}`, { portrait: 'jon', tone: 'info', ms: 5200 });
    events.emit('jon:note', { kind, species });
  }
  function giveSpares() {
    const n = RULES.jon.spares;
    state.inventory.backpacks += n;
    sparesDay = dayKey();
    return n;
  }
  let visitN = 0;
  async function visit(want, plan) {
    const my = ++visitN;
    const alive = () => my === visitN && state.phase === 'survey';
    jon.state = 'visit';
    jon.kind = want.kind;
    story.cutscene = true;
    player.hold('jon', true);
    shot(plan.lens.cam, plan.lens.look, { snap: true });
    // (the player drawn in full: a catch's close-up may have left them faded)
    if (player.avatar && player.avatar.setFade) player.avatar.setFade(0);
    model.lookAtPlayer = true;
    model.walkTo(plan.tp.x, plan.tp.z, UP_SPEED);
    model.wave();

    const S = SCRIPT.jon, B = breaks();
    const lines = [state.jon.met ? S.hello : S.meet];
    state.jon.met = true;
    let at = -1, act = null;
    if (want.kind === 'retie') {
      lines.push(...S.retie);
      at = 2;
      act = () => { if (B && B.retie('jon')) state.jon.retied = true; };
    } else if (want.kind === 'hint') {
      lines.push(S.hints[want.species]);
      if (!state.jon.hints.includes(want.species)) state.jon.hints.push(want.species);
    } else if (want.kind === 'nudge') {
      const ph = game.lizards && game.lizards.thermalPhase ? game.lizards.thermalPhase() : 'morning';
      lines.push(S.nudge[ph] || S.nudge.morning);
      nudgeDay = dayKey();
    } else if (want.kind === 'spares') {
      const n = RULES.jon.spares;
      lines.push(S.spares[0], say(S.spares[1], { n: NUMBERS[n] || n }));
      at = 2;
      act = () => {
        giveSpares();
        kit.toast(say(S.sparesToast, { n }), { icon: 'backpack', tone: 'good' });
      };
      sparesDay = dayKey();
    } else if (want.kind === 'steer') {
      lines.push(want.line);
    }
    const vars = { name: state.playerName || SCRIPT.nameFallback };
    model.talking = true;
    let picked;
    try {
      picked = await kit.dialogue({
        speaker: JON.name, portrait: 'jon', lines: lines.map((l) => say(l, vars)),
        onLine: (i) => { if (i === at && act) { const f = act; act = null; f(); } },
        ...(want.choices ? { choices: want.choices, defaultChoice: 0 } : null),
      });
    } finally {
      model.talking = false;
    }
    if (!alive()) return picked; // (back to the title, or the day over: that has tidied up)
    if (act) act();
    endShot();
    story.cutscene = false;
    player.hold('jon', false);
    lastEnd = state.clock.hours;
    save();
    jon.state = 'leaving';
    model.lookAtPlayer = false;
    planNext = true;
    return picked;
  }

  // gone at once, behind the fade of a new day, the title or the day's end
  function abort() {
    if (steerWant) { const w = steerWant; steerWant = null; w.resolve(true); }
    if (jon.state === 'away' && !jon.visible) return;
    visitN++;
    player.hold('jon', false);
    if (jon.visible) gone();
    jon.state = 'away';
  }
  events.on('story:abort', abort);
  events.on('day:end', abort);
  events.on('phase:change', (e) => { if (!e || e.phase !== 'survey') abort(); });

  // ---------------------------------------------------------------- the backpacks

  // The species in his words, and the part of the island by the compass from the middle of
  // the walkable ground (north is -z), or round the lawn near the middle.
  const SHORT = { crested: 'crested', brown: 'brown', green: 'green', bark: 'bark anole', knight: 'knight', basilisk: 'basilisk' };
  const NAME = { crested: 'crested anole', brown: 'brown anole', green: 'green anole', bark: 'bark anole', knight: 'knight anole', basilisk: 'brown basilisk' };
  const OTHERS = ['brown', 'bark', 'green', 'knight', 'crested'];
  const WB = T.walk_bounds || [-46, -34, 63, 47], MID = { x: (WB[0] + WB[2]) / 2, z: (WB[1] + WB[3]) / 2 };
  function sideOf(x, z) {
    const dx = x - MID.x, dz = z - MID.z;
    if (Math.hypot(dx, dz) < 14) return 'mid';
    return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'east' : 'west') : dz < 0 ? 'north' : 'south';
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // A GPS backpack about to go on lz (catching.js, before its card). Today's fits already
  // on RULES.jon.sameSpecies of its species, or the last RULES.jon.sameArea all within
  // RULES.jon.area metres of it: he comes with a word, and the choice. Resolves true to fit
  // it, false to let it go without (the default; the backpack stays in the case). He comes
  // from update(), where every visit starts, so the frame he appears in is judged on its
  // own camera; when he cannot come (his visits, the gap, or no spot out of view for half a
  // second), the word and the choice come as a note.
  const steered = { day: -1, species: new Set(), areas: [] };
  let steerWant = null; // { line, mark, resolve, t }
  async function steer(lz) {
    const h = lz && lz.home;
    if (!h || state.phase !== 'survey' || story.cutscene) return true;
    const M = game.missions;
    if (M && M.activeMission && M.activeMission()) return true;
    const day = dayKey(), R = RULES.jon, S = SCRIPT.jon.steer, key = speciesKey(lz.species);
    if (steered.day !== day) { steered.day = day; steered.species.clear(); steered.areas.length = 0; }
    const fits = state.tracked.filter((t) => t.dk === day && t.lizard && t.lizard !== lz && t.lizard.home);
    const near = (p) => Math.hypot(p.x - h.x, p.z - h.z) <= R.area;
    const last = fits.slice(-R.sameArea);
    let line = null, area = false;
    if (!steered.species.has(key) && fits.filter((t) => t.species === key).length >= R.sameSpecies) {
      const o = OTHERS.filter((k) => k !== key && !fits.some((t) => t.species === k)).slice(0, 2);
      const others = o.length === 2 ? `A ${SHORT[o[0]].replace(/ anole$/, '')} or a ${NAME[o[1]]}` : o.length ? `A ${NAME[o[0]]}` : S.anyOther;
      const n = fits.filter((t) => t.species === key).length;
      line = say(key === 'basilisk' ? S.basilisk : S.species, { species: SHORT[key], others, n: ['two', 'three', 'four'][n - 2] || String(n) });
    } else if (last.length >= R.sameArea && last.every((t) => near(t.lizard.home)) && !steered.areas.some(near)) {
      const side = sideOf(h.x, h.z);
      line = say(S.area, { here: S.here[side], there: cap(S.there[side]) });
      area = true;
    }
    if (!line) return true;
    const mark = () => { if (area) steered.areas.push({ x: h.x, z: h.z }); else steered.species.add(key); };
    if (!canVisit() || jon.state !== 'away') { mark(); return steerNote(line); }
    return new Promise((resolve) => { steerWant = { line, mark, resolve, t: 0 }; });
  }
  // the same word and choice as a note, when he cannot come
  async function steerNote(line) {
    const S = SCRIPT.jon.steer, d = today();
    d.notes.steer = (d.notes.steer || 0) + 1;
    events.emit('jon:note', { kind: 'steer', species: null });
    const pick = await kit.dialogue({
      speaker: S.noteFrom, portrait: 'jon', lines: [line],
      choices: [{ label: S.letGo, value: 'skip', icon: 'heart' }, { label: S.fit, value: 'fit', icon: 'backpack' }], defaultChoice: 0,
    });
    return pick === 'fit';
  }
  // (from update: the word on the backpacks, once he can come unseen)
  function steerNow(dt) {
    const w = steerWant;
    const spot = jon.state === 'away' ? findSpot() : null;
    if (!spot) {
      // (nowhere to come from unseen: the note instead)
      if (jon.state !== 'away' || (w.t += dt) > 0.5) { steerWant = null; w.mark(); steerNote(w.line).then(w.resolve, (e) => { console.error(e); w.resolve(true); }); }
      return;
    }
    steerWant = null;
    w.mark();
    appear(spot, 'steer');
    const S = SCRIPT.jon.steer;
    const choices = [{ label: S.letGo, value: 'skip', icon: 'heart' }, { label: S.fit, value: 'fit', icon: 'backpack' }];
    visit({ kind: 'steer', line: w.line, choices }, spot).then((pick) => w.resolve(pick === 'fit'), (e) => { console.error(e); w.resolve(true); });
  }

  // ---------------------------------------------------------------- when he comes

  let pendingRetie = false, retieAt = 0, forced = null;
  let lastEnd = -Infinity, lastCatch = null, nudgeDay = -1, sparesDay = -1, lastNote = -Infinity;
  let lockLz = null, lockT = 0, searchT = 0, calmT = 0;
  events.on('day:new', () => { lastEnd = -Infinity; lastCatch = null; pendingRetie = false; lastNote = -Infinity; });
  events.on('lizard:caught', () => { lastCatch = state.clock.hours; });
  // a snapped loop, until he has re-tied one: his to re-tie
  events.on('loop:snap', (e) => {
    if (!e || state.jon.retied || state.phase !== 'survey' || jon.state === 'visit') return;
    const M = game.missions;
    if (M && M.activeMission && M.activeMission()) return;
    if (!canVisit(true)) return; // (his visits for the day are used up: the player's)
    e.claim();
    pendingRetie = true;
    // (a beat after the snap, so it is seen and heard first)
    retieAt = game.time + RETIE_AFTER;
  });

  // free to come: nothing else going on
  function free() {
    if (state.phase !== 'survey' || story.cutscene || kit.busy() || player.held || player.pushed) return false;
    const C = game.catching;
    if (C && C.busy) return false;
    const B = breaks();
    if (B && (B.busy || B.tying)) return false;
    const M = game.missions;
    return !(M && M.activeMission && M.activeMission());
  }

  function wanted(dt) {
    // the player's own lock-on (not one scripted play forced), held half a second
    const LP = game.catching && game.catching.loopPole;
    const lz = LP && LP.aiming && !LP.forceLock && LP.lock && LP.lock.visible ? LP.lock : null;
    if (lz !== lockLz) { lockLz = lz; lockT = 0; } else if (lz) lockT += dt;
    if (forced) return forced;
    if (pendingRetie) {
      const B = breaks();
      if (B && B.snapped && B.claimT > 0) return game.time >= retieAt ? { kind: 'retie' } : null;
      pendingRetie = false;
    }
    const h = state.clock.hours;
    if (lastCatch == null) lastCatch = h;
    const open = canVisit();
    const key = lz ? speciesKey(lz.species) : null;
    const rec = key && state.species[key];
    if (lz && lockT >= 0.5 && SCRIPT.jon.hints[key] && !state.jon.hints.includes(key) && !(rec && rec.caught > 0)) {
      if (open) return { kind: 'hint', species: key };
      if (h - lastNote >= RULES.jon.noteGap) return { kind: 'hint', species: key, note: true };
    }
    if (sparesDay !== dayKey() && state.inventory.backpacks === 0 && state.today.tagged >= RULES.inventory.backpacks) return { kind: 'spares', note: !open };
    if (nudgeDay !== dayKey() && h - lastCatch >= RULES.jon.nudge) {
      if (open) return { kind: 'nudge' };
      nudgeDay = dayKey(); // (dropped)
    }
    return null;
  }

  function update(dt, t) {
    if (state.phase !== 'survey') return;
    if (jon.visible) model.update(dt, t);
    if (jon.state === 'visit') {
      // the player turns to him as he talks
      const p = player.position, J = model.position;
      const want = Math.atan2(-(J.x - p.x), -(J.z - p.z));
      player.heading = wrap(player.heading + wrap(want - player.heading) * Math.min(1, dt * 5));
      return;
    }
    if (jon.state === 'leaving') {
      if (planNext) { planNext = false; legs = 0; replanT = 0; path = planLeave(); walkOn(); }
      if (hiddenAt(model.position.x, model.position.z)) gone();
      else if (replanT > 0 && (replanT -= dt) <= 0) { replanT = 0; path = []; walkOn(); }
    }
    if (steerWant) { steerNow(dt); return; }
    // (free for a moment first: not the instant a catch or a card ends)
    calmT = free() ? calmT + dt : 0;
    const want = wanted(dt);
    if (!want || calmT < 0.8) return;
    if (want.note) {
      if (jon.state !== 'away') return; // (not while he is still in sight)
      const S = SCRIPT.jon;
      if (want.kind === 'hint') {
        note('hint', S.notes[want.species] || S.hints[want.species], want.species);
        if (!state.jon.hints.includes(want.species)) state.jon.hints.push(want.species);
        lastNote = state.clock.hours;
      } else if (want.kind === 'spares') {
        note('spares', say(S.sparesNote, { n: NUMBERS[giveSpares()] || RULES.jon.spares }));
      }
      save();
      return;
    }
    if (jon.state === 'leaving') {
      // still in sight on his way off: only the re-tie brings him back, from where he is
      if (want.kind !== 'retie') return;
      const p = player.position, J = model.position, d = Math.hypot(J.x - p.x, J.z - p.z) || 1;
      const tp = { x: p.x + ((J.x - p.x) / d) * TALK_D, z: p.z + ((J.z - p.z) / d) * TALK_D };
      const lens = clear(J, tp) ? lensFor(tp) : null;
      if (!lens) return;
      if (want === forced) forced = null;
      pendingRetie = false;
      path = [];
      today().visits++; // (coming back counts as a visit too)
      visit(want, { tp, lens }).catch((e) => console.error(e));
      return;
    }
    if ((searchT -= dt) > 0) return;
    searchT = 0.25;
    const spot = findSpot();
    if (!spot) return;
    if (want === forced) forced = null;
    if (want.kind === 'retie') pendingRetie = false;
    appear(spot, want.kind);
    visit(want, spot).catch((e) => console.error(e));
  }

  return jon;
}
