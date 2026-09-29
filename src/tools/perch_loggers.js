// Perch loggers: what field biologists do to measure the temperature a lizard actually
// lives in. As a caught lizard goes home on the survey day, the release cards offer one
// quick clip (src/catch/release.js, perchLoggerCard): a tiny button logger on its perch,
// right where it sat and at the height it was caught, three a day. It shows on the bark
// (a coloured coin on a steel rim with a little paper tag, one instanced mesh for all of
// them), and walking or creeping past it later (within DOWNLOAD_R, like the flags'
// loggers; never while aiming, never mid-job) downloads it by itself and opens that
// lizard's "day in temperature" card (src/ui/perch_day.js). While its logger is ready and
// the player is near, the followed lizard is used to them (the brain's `calm`, as the
// opening's practice lizard: it watches and only a run bolts it), so a walk up to its
// logger never flushes it, and a fright during that visit is not put down in its day.
//
// While a logger is out it records, on the day's clock:
//   - the perch's temperature every PERCH.sampleT game hours: the loggers' microclimate
//     (src/tools/loggers.js baseCelsius and RULES.climate) evaluated at the button itself,
//     with the lizards' own sun test at its spot and facing (the drawn crowns, fans,
//     bushes and trunks, and which side of the trunk the sun is on), the canopy's shade
//     and the lake's cool over it, a little warmth near sunny ground and a breeze high
//     up, and the bark's lag (PERCH.lag) so the line warms and cools like wood;
//   - the lizard's own day every PERCH.stateT game hours, one letter a spell (perch_day.js
//     CODES): read from its behaviour while it is active near the player (basking, too
//     hot, round to the shady side, sheltering out of sight, hiding from you), and while
//     it is not, worked out by the same basking and shade rules its brain would apply on
//     waking (lizards.js activate: sunny and cool, basking; too hot, round the trunk to
//     the shade or off into cover until the day cools; cold in the shade, round into the
//     sun);
//   - with a GPS backpack, its fixes as offsets from the perch (never a position) and the
//     metres between them.
// A download copies what was recorded so far into its life story (state.followed, saved
// with the notebook), whose page the notebook's "Followed lizards" section shows. At the
// day's end the loggers still out are picked up and their stories filled in.
//
//   build(game) -> { group, update, today(), download(rec), visiting(), stats }
//   events: perch:clip { entry, kind: 'sunny' | 'shady' | 'dappled', species, lizard },
//           perch:download { entry, first, whole, hours }
//   state: state.followed (life stories), state.inventory.perch (left today),
//          state.today.perchClipped and perchDownloads (also counted in loggersRead, the
//          end card's "Loggers downloaded"), state.perchIntro (James's word said); a story
//          downloaded on a day left unfinished is kept, marked cut (perch_day.js todaysStories)
//   window.__game.play.perch: auto (null; 'clip' lets a scripted catch clip one and the
//     day card close by itself; 'show' offers the card and holds it), list(), goto(i, m),
//     download(i), entries(), demo()
//   ?catchstep=perchlogger holds the catch at the clip card; ?catchstep=perchintro at
//     James's word (the first on a save); ?perchdemo=1 opens a made-up day card;
//     ?noperch=1 offers none (for scripted runs that press through every card).

import * as THREE from 'three';
import { events } from '../core/events.js';
import { state, RULES, addScore, clockText, speciesKey, save } from '../game/state.js';
import * as kit from '../ui/kit.js';
import { toonGradient } from '../player/avatar.js';
import { THERMAL, SPECIES_INFO } from '../lizards/species.js';
import { SURF } from '../lizards/perches.js';
import { vegUniforms } from '../world/wind.js';
import { baseCelsius, DOWNLOAD_R } from './loggers.js';
import { SCRIPT, JAMES, say } from '../story/script.js';
import { setPerchLogger, perchLoggerCard, standIn } from '../catch/release.js';
import { NICKNAMES } from '../catch/tuning.js';
import { HOMES, perchScene, daySentence, registerDayCard, ensurePerchStyle } from '../ui/perch_day.js';

export const PERCH = {
  first: 1.0, // game hours after the clip before the first download (about a minute of play)
  again: 1.5, // and between downloads (as the flags' loggers, RULES.loggerReadEvery)
  sampleT: 1 / 6, // game hours between temperature readings (10 minutes)
  stateT: 1 / 12, // and between looks at what the lizard is up to (5 minutes)
  lag: 0.3, // game hours: how slowly the bark follows the sun (thermal inertia)
  keep: 30, // life stories kept in the notebook
  trail: 80, // backpack fixes kept on a story
  r: 0.036, // the button's radius, metres (drawn about twice real size, like the lizards)
  visitR: 9, // metres: the followed lizard is calm while the player is this near its ready logger
  visitT: 25, // and for this many seconds (outside the cards) after a download, while they stay near
  calm: 0.9, // the brain's threat cap meanwhile (catching.js's practiceCalm)
  // the day's three buttons
  colours: [['#ff7b54', 'coral'], ['#9a7cf0', 'violet'], ['#2fb8a8', 'teal']],
};
const MAX = 4; // instances
const params = new URLSearchParams(location.search);
const STEP = params.get('catchstep');
const DEMO = params.get('perchdemo'); // ?perchdemo=1 (or nopack) opens a made-up day card, for layout checks
// ?noperch=1: no perch loggers are offered (for scripted runs that press through every
// card, which would clip one and then meet its day card on a walk)
const OFF = /[?&]noperch(=(1|true|yes))?(&|$)/.test(location.search);

// narration (not James; his lines are SCRIPT.perch)
const WORDS = {
  clipped: 'Clipped! *{name}*\'s perch logger is ticking. Walk past after {time} to download it.',
  ready: '*{name}*\'s perch logger is ready. Walk past its perch to download it!',
  // the clip card, naming the lizard (a new nickname is given here)
  clipCard: 'Clip a button logger on *{name}*\'s perch, right where it sat. It logs the temperature *{name}* lives in.',
  clipDappled: 'Clip a button logger on *{name}*\'s perch, right where it sat. Dappled light, so not one for the Sun & shade stamp.',
};

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100, half = (v) => Math.round(v * 2) / 2;
// clock times kept on a story, down to the hundredth of an hour as the HUD's clock reads
// them (clockText floors), so a download at 16:11 never says 16:12
const t2 = (v) => Math.floor(v * 100 + 1e-6) / 100;
function hash(str, n) {
  let h = 2166136261 ^ n;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

// ---------------------------------------------------------------- the button

// One mesh for every button: the steel rim, the coloured face (aTint 1 takes the
// instance's colour), a shine, a loop of string and a paper tag that hangs down the
// bark (local +z), the coin's face out along local +y (the perch's normal).
function buttonGeometry() {
  const R = PERCH.r;
  const parts = [];
  const add = (g, c, tint) => parts.push([g.index ? g.toNonIndexed() : g, new THREE.Color(c), tint]);
  add(new THREE.CylinderGeometry(R, R * 1.04, R * 0.36, 20).translate(0, R * 0.18, 0), '#c3c9cf', 0);
  add(new THREE.CylinderGeometry(R * 0.8, R * 0.86, R * 0.22, 20).translate(0, R * 0.46, 0), '#ffffff', 1);
  add(new THREE.SphereGeometry(R * 0.46, 14, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.28, 1).translate(0, R * 0.56, 0), '#ffffff', 0.45);
  add(new THREE.TorusGeometry(R * 0.2, R * 0.07, 5, 10).rotateY(Math.PI / 2).translate(0, R * 0.22, R * 1.12), '#6e5a44', 0);
  add(new THREE.BoxGeometry(R * 0.95, R * 0.08, R * 1.3).translate(0, 0, R * 0.65).rotateX(0.32).translate(0, R * 0.26, R * 1.3), '#fff4d6', 0);
  add(new THREE.BoxGeometry(R * 0.5, R * 0.09, R * 0.08).translate(0, 0, R * 0.5).rotateX(0.32).translate(0, R * 0.31, R * 1.3), '#b9a37a', 0);
  let n = 0;
  for (const [g] of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), tint = new Float32Array(n);
  let o = 0;
  for (const [g, c, t] of parts) {
    g.computeVertexNormals();
    const cnt = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    for (let k = 0; k < cnt; k++) { col[(o + k) * 3] = c.r; col[(o + k) * 3 + 1] = c.g; col[(o + k) * 3 + 2] = c.b; }
    tint.fill(t, o, o + cnt);
    o += cnt;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));
  geo.computeBoundingSphere();
  return geo;
}

// aGlow (per instance): a soft pulse on the coloured face while a download is due
function buttonMaterial() {
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTint;\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <color_vertex>', `#include <color_vertex>
        #ifdef USE_INSTANCING_COLOR
          vColor.xyz = mix(color.xyz, color.xyz * instanceColor.xyz, aTint);
        #endif
        vGlow = aGlow * aTint;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow * 0.6;');
  };
  mat.customProgramCacheKey = () => 'perch-loggers-1';
  return mat;
}

// ---------------------------------------------------------------- the system

export async function build(game) {
  ensurePerchStyle();
  registerDayCard(game);
  const { player } = game;
  const T = game.data.terrain;
  const group = new THREE.Group();
  group.name = 'perch-loggers';
  const geo = buttonGeometry();
  const glow = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
  glow.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aGlow', glow);
  const mesh = new THREE.InstancedMesh(geo, buttonMaterial(), MAX);
  mesh.name = 'perch-loggers';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  const white = new THREE.Color('#ffffff');
  for (let i = 0; i < MAX; i++) mesh.setColorAt(i, white); // so the instance colour is there from the first draw
  mesh.count = 0;
  group.add(mesh);

  // today's loggers out on their perches (in memory; the stories are in state.followed)
  const live = [];
  let inHand = null; // the lizard whose release cards are open
  events.on('lizard:caught', (e) => { inHand = (e && e.lizard) || null; });
  events.on('lizard:released', (e) => {
    inHand = null;
    // a followed lizard caught again runs home too: its day picks up once it is back
    const lz = e && e.lizard;
    for (const rec of live) if (rec.lz === lz) rec.settle = true;
  });
  events.on('practice:done', () => { inHand = null; });

  // scratch
  const _m = new THREE.Matrix4(), _sv = new THREE.Vector3(), _o = { x: 0, y: 0, z: 0 };
  const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _col = new THREE.Color();
  const hitA = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, kind: 0, tri: -1, w: 0 };
  const temp = { c: 0, e: 0 };

  // ---- where the button goes: clear of the lizard's body on the surface it sits on, on
  // its own side of a trunk (so the two read the same sun and shade), beside it on the
  // ground or a leaf, along a branch or a log past its snout or its tail. out.how says
  // which spot was used (for checks: 100 the drawn bark, 0 to 4 a surface found below a
  // try, 10 up the nearest drawn surface, -1 or -2 a spot worked out without one).
  function placeFor(lz) {
    const H = lz.home, P = game.lizards && game.lizards.perches;
    const side = (lz.index % 2) ? 1 : -1;
    // clear of the lizard's body, however big it is (a knight anole is twice a crested)
    const len = Number.isFinite(lz.length) ? lz.length : 0.38;
    const aside = 0.06 + 0.2 * len, ahead = 0.06 + 0.45 * len;
    const out = { x: H.x, y: H.y, z: H.z, nx: H.nx, ny: H.ny, nz: H.nz, dx: 0, dy: -1, dz: 0, w: H.w || 0, fl: H.fl || 0 };
    if (H.mode === SURF.BARK && Number.isFinite(H.ax) && Number.isFinite(H.az)) {
      // on the same side of the trunk (so it reads the same sun and shade as the lizard):
      // just beside it on a stout trunk, else a little way up or down the trunk past its
      // snout (or its tail when that runs out of trunk), a touch to one side
      const r = Math.max(0.03, Math.hypot(H.x - H.ax, H.z - H.az));
      const th0 = Math.atan2(H.z - H.az, H.x - H.ax);
      let th = th0, y = H.y - 0.05;
      if (r >= 0.24) th = th0 + side * (aside + 0.03) / r;
      else {
        const up = lz.headDown ? -1 : 1;
        const lo = Number.isFinite(H.yLo) ? H.yLo + 0.05 : H.y - 1, hi = Number.isFinite(H.yHi) ? H.yHi - 0.03 : H.y + 1;
        y = H.y + up * (ahead + 0.04);
        if (y < lo || y > hi) y = H.y - up * (0.62 * len + 0.08);
        y = Math.min(hi, Math.max(lo, y));
        th = th0 + side * Math.min(0.35, 0.05 / r);
      }
      if (P && P.trunkPoint && P.trunkPoint(H.ax, H.az, th, y, r, hitA)) {
        out.x = hitA.x; out.y = hitA.y; out.z = hitA.z; out.nx = hitA.nx; out.ny = hitA.ny; out.nz = hitA.nz; out.w = hitA.w || out.w;
        out.how = 100;
      } else {
        out.how = -2;
        out.x = H.ax + Math.cos(th) * r; out.y = y; out.z = H.az + Math.sin(th) * r;
        out.nx = Math.cos(th); out.ny = 0; out.nz = Math.sin(th);
      }
      out.fl = 0;
    } else {
      // across the surface from its side, then along it, where there is surface
      const nx = H.nx, ny = H.ny, nz = H.nz;
      let sx = ny * H.fz - nz * H.fy, sy = nz * H.fx - nx * H.fz, sz = nx * H.fy - ny * H.fx;
      const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
      // wide surfaces (the ground, a leaf) beside it first; narrow ones (a branch, a log)
      // along them, in front of its snout, then behind its tail
      const beside = [[side * aside, 0], [-side * aside, 0]];
      const along = [[0, ahead], [0, ahead * 1.3], [0, -ahead * 1.4], [0, ahead * 0.8], [side * aside * 0.5, ahead * 0.9]];
      const tries = H.mode === SURF.GROUND ? [[side * (aside + 0.04), 0], [-side * (aside + 0.04), 0], [0, ahead + 0.05]]
        : H.mode === SURF.LEAF ? [...beside, ...along] : [...along, ...beside];
      let ok = false;
      for (let k = 0; k < tries.length; k++) {
        const a = tries[k][0], b = tries[k][1];
        out.how = k;
        const cx = H.x + sx * a + H.fx * b, cy = H.y + sy * a + H.fy * b, cz = H.z + sz * a + H.fz * b;
        if (H.mode === SURF.GROUND) {
          if (T.isWater(cx, cz)) continue;
          out.x = cx; out.z = cz; out.y = Math.max(0, T.heightAt(cx, cz));
          const g = P && P.groundNormalAt ? P.groundNormalAt(cx, cz) : null;
          if (g) { out.nx = g.nx; out.ny = g.ny; out.nz = g.nz; }
          ok = true; break;
        }
        if (P && P.surfaceBelow && P.surfaceBelow(cx, cy, cz, 0.18, 0.3, P.ANY, hitA, 0.3) && Math.abs(hitA.y - H.y) < 0.22) {
          out.x = hitA.x; out.y = hitA.y; out.z = hitA.z; out.nx = hitA.nx; out.ny = hitA.ny; out.nz = hitA.nz; out.w = hitA.w || out.w;
          ok = true; break;
        }
      }
      // else the nearest drawn surface to those spots (the side of a thin limb will do)
      for (let k = 0; !ok && k < tries.length && P && P.index && P.index.closest; k++) {
        if (H.mode === SURF.GROUND) break;
        const a = tries[k][0], b = tries[k][1];
        const cx = H.x + sx * a + H.fx * b, cy = H.y + sy * a + H.fy * b, cz = H.z + sz * a + H.fz * b;
        if (P.index.closest(cx, cy, cz, 0.16, P.ANY, hitA) && Math.hypot(hitA.x - H.x, hitA.y - H.y, hitA.z - H.z) > aside * 0.8) {
          out.x = hitA.x; out.y = hitA.y; out.z = hitA.z; out.nx = hitA.nx; out.ny = hitA.ny; out.nz = hitA.nz; out.w = hitA.w || out.w;
          out.how = 10 + k; ok = true;
        }
      }
      if (!ok) { out.how = -1; out.x = H.x + sx * 0.06 - H.fx * 0.1; out.y = H.y + sy * 0.06 - H.fy * 0.1; out.z = H.z + sz * 0.06 - H.fz * 0.1; }
      // the tag trails back along the lizard's way
      out.dx = -H.fx; out.dy = -H.fy; out.dz = -H.fz;
    }
    // "down the surface" in its plane, for the tag
    const d = out.dx * out.nx + out.dy * out.ny + out.dz * out.nz;
    let dx = out.dx - out.nx * d, dy = out.dy - out.ny * d, dz = out.dz - out.nz * d;
    const dl = Math.hypot(dx, dy, dz);
    if (dl < 1e-3) { dx = out.ny; dy = -out.nx; dz = 0; } else { dx /= dl; dy /= dl; dz /= dl; }
    out.dx = dx; out.dy = dy; out.dz = dz;
    return out;
  }

  // the base matrix: the coin's face out along the normal, its tag down the surface
  function baseMatrix(p, m) {
    _y.set(p.nx, p.ny, p.nz).normalize();
    _z.set(p.dx, p.dy, p.dz);
    _x.crossVectors(_y, _z).normalize();
    _z.crossVectors(_x, _y).normalize();
    m.makeBasis(_x, _y, _z);
    m.setPosition(p.x + p.nx * 0.004, p.y + p.ny * 0.004, p.z + p.nz * 0.004);
    return m;
  }

  // metres to the lake, to the nearest 1.5 m, up to 6 m
  function waterDistance(x, z) {
    if (T.isWater(x, z)) return 0;
    for (let r = 1.5; r <= 6; r += 1.5) {
      for (let a = 0; a < 8; a++) {
        const ang = a * 0.7854 + r;
        if (T.isWater(x + Math.cos(ang) * r, z + Math.sin(ang) * r)) return r;
      }
    }
    return 6;
  }

  // ---- what the logger reads: the perch's temperature now (target, before the lag)
  function perchTarget(rec, hours) {
    const C = RULES.climate, L = game.lizards;
    const e = L && L.sunExposure ? L.sunExposure(rec.x, rec.y, rec.z, rec.nx, rec.ny, rec.nz) : 0.3;
    const sky = game.sky && game.sky.state;
    const sunY = sky && sky.sunDir ? Math.max(0, sky.sunDir.y) : 0.7;
    let c = baseCelsius(hours) + C.sun * e * Math.pow(sunY, 0.8) + rec.local;
    // near sunny ground a touch warmer, high up a touch breezier
    c += 0.5 * e * (1 - smooth(0.15, 1.2, rec.above)) - Math.min(0.5, 0.12 * Math.max(0, rec.above - 1.5));
    c += (hash(rec.key, Math.floor(hours * 6)) - 0.5) * C.wobble;
    temp.c = c; temp.e = e;
    return temp;
  }
  function sampleTemp(rec, hours, first = false) {
    const t = perchTarget(rec, hours);
    if (first || rec.c == null) rec.c = t.c;
    else rec.c += (t.c - rec.c) * (1 - Math.exp(-Math.max(0, hours - rec.tT) / PERCH.lag));
    rec.tT = hours;
    const last = rec.temps[rec.temps.length - 1];
    if (last && Math.abs(last[0] - hours) < 1e-3) { last[1] = r1(rec.c); last[2] = r2(t.e); return; }
    rec.temps.push([r2(hours), r1(rec.c), r2(t.e)]);
    if (rec.temps.length > 90) rec.temps.shift();
  }

  // ---- what the lizard is up to (perch_day.js CODES)
  function derivedCode(rec, lz) {
    const L = game.lizards, H = lz.home;
    const e = L.sunExposure(H.x, H.y, H.z, H.nx, H.ny, H.nz);
    const w = L.warmth();
    const TH = THERMAL, heat = (SPECIES_INFO[lz.species] && SPECIES_INFO[lz.species].heat) || 1;
    const onTrunk = H.mode === SURF.BARK && Number.isFinite(H.ax) && Number.isFinite(H.az);
    const sky = game.sky && game.sky.state, s = sky && sky.sunDir;
    // round its trunk towards the sun (1) or away from it (-1): that side's sun
    const round = (dir) => {
      if (!onTrunk || !s || Math.hypot(s.x, s.z) < 0.05) return -1;
      const r = Math.max(0.03, Math.hypot(H.x - H.ax, H.z - H.az));
      const th = Math.atan2(s.z, s.x) + (dir > 0 ? 0 : Math.PI);
      const c = Math.cos(th), sn = Math.sin(th);
      return L.sunExposure(H.ax + c * r, H.y, H.az + sn * r, c, 0, sn);
    };
    // sheltering from the heat lasts till the day cools (the brain's comeOut)
    if (rec.last === 'x' && w >= TH.comeOut && w > 0.3) return 'x';
    if (w > TH.hot.above && e > TH.sunny * heat) {
      const e2 = round(-1);
      if (e2 >= 0 && e2 < TH.shady + 0.5 * (e - TH.shady)) return 'm';
      return 'x';
    }
    if (w < TH.cold && e < TH.shady) {
      const e2 = round(1);
      if (e2 > e + 0.15) return w < TH.bask.below ? 'u' : 's';
    }
    if (e > TH.sunny) return w < TH.bask.below ? 'b' : 's';
    return 'd';
  }
  function stateCode(rec) {
    const lz = rec.lz;
    if (!lz || !lz.home || lz.state === 'captured' || !game.lizards) return null;
    if (!lz.handle) { rec.settle = false; return derivedCode(rec, lz); }
    // just let go, it runs home and waits out of sight a moment: not a fright of its own
    if (rec.settle) {
      if (lz.state !== 'idle' || lz.away) return null;
      rec.settle = false;
    }
    if (lz.state === 'return' || lz.state === 'frozen') return null; // on its way back: as it was
    if (lz.state === 'hidden' || lz.away) return lz.shelter ? 'x' : 'f';
    if (lz.state === 'flee') return 'f';
    const H = lz.home, p = lz.pos;
    const moved = Math.hypot(p.x - H.x, p.y - H.y, p.z - H.z) > 0.18;
    const m = lz.mood;
    if (m.night) return 'd';
    if (m.bask) return moved ? 'u' : 'b';
    if (m.hot) return 'h';
    if (lz.exposure > THERMAL.sunny) return moved ? 'u' : 's';
    return moved ? 'm' : 'd';
  }
  function sampleState(rec, hours) {
    rec.sT = hours;
    const code = stateCode(rec);
    if (code) {
      if (code !== rec.last) {
        if (code === 'f') rec.flights++;
        rec.states.push([t2(hours), code]);
        if (rec.states.length > 160) rec.states.shift();
        rec.last = code;
      }
    }
    // the backpack's latest fix, as an offset from the perch
    const t = rec.tracked;
    if (t) {
      const src = Array.isArray(t.fixes) && t.fixes.length ? t.fixes : t.trail;
      const f = Array.isArray(src) && src.length ? src[src.length - 1] : null;
      if (f && Number.isFinite(f[0]) && Number.isFinite(f[1])) {
        const dx = half(f[0] - rec.hx), dz = half(f[1] - rec.hz);
        const last = rec.trail[rec.trail.length - 1];
        if (!last || last[0] !== dx || last[1] !== dz) {
          rec.dist += last ? Math.hypot(dx - last[0], dz - last[1]) : Math.hypot(dx, dz);
          rec.trail.push([dx, dz]);
          if (rec.trail.length > PERCH.trail) rec.trail.shift();
        }
      }
    }
  }
  // a fright from the player between looks still counts, but not one during a visit to
  // its own logger (only a run bolts it then): it goes home as after a release instead
  events.on('lizard:flee', (lz) => {
    if (state.phase !== 'survey') return;
    for (const rec of live) {
      if (rec.lz !== lz || rec.last === 'f' || rec.settle) continue;
      if (rec.calmed) { rec.settle = true; continue; }
      rec.flights++;
      rec.states.push([t2(state.clock.hours), 'f']);
      rec.last = 'f';
    }
  });

  // ---- clipping
  const nextColour = () => PERCH.colours.find((c) => !live.some((r) => r.entry.col === c[0])) || PERCH.colours[live.length % PERCH.colours.length];
  function nickFor(lz) {
    const tag = lz.tag && typeof lz.tag === 'object' ? lz.tag : null;
    if (tag && tag.nickname) return tag.nickname;
    const used = new Set();
    for (const t of state.tracked) if (t.nickname) used.add(t.nickname);
    for (const f of state.followed) if (f.nick) used.add(f.nick);
    // from the far end of the backpacks' list, so the two rarely meet
    for (let k = 0; k < NICKNAMES.length; k++) {
      const n = NICKNAMES[NICKNAMES.length - 1 - ((state.followed.length + k) % NICKNAMES.length)];
      if (!used.has(n)) return n;
    }
    return NICKNAMES[state.followed.length % NICKNAMES.length];
  }
  const nextK = () => { let k = 0; for (const f of state.followed) if (f.k > k) k = f.k; return k + 1; };

  function makeRec(entry, lz, place, tracked) {
    const H = lz.home;
    const C = RULES.climate;
    const canopy = T.canopyAt(place.x, place.z);
    const rec = {
      entry, lz, tracked,
      x: place.x, y: place.y, z: place.z, nx: place.nx, ny: place.ny, nz: place.nz, w: place.w, fl: place.fl,
      hx: H.x, hz: H.z,
      above: Math.max(0, place.y - Math.max(0, T.heightAt(place.x, place.z))),
      local: C.shade * smooth(2, 12, canopy) + C.water * (1 - smooth(0, 6, waterDistance(place.x, place.z))),
      key: 'perch' + entry.k,
      base: baseMatrix(place, new THREE.Matrix4()),
      c: null, tT: -1, sT: -1, last: null,
      temps: [], states: [], trail: [], dist: 0, flights: 0,
      pop: 0, wig: 0, due: false, told: false, marker: null, markOff: null,
      visit: 0, calmed: false, ownCalm: false, // a visit to its logger (seconds left) and the calm it gives
      settle: true, // until it is back on its perch after the release
    };
    return rec;
  }

  function clip(lz, c, place, kind, colour, nick) {
    const hours = state.clock.hours;
    if (!lz.tag || typeof lz.tag !== 'object') lz.tag = {};
    const tag = lz.tag;
    if (!tag.nickname) tag.nickname = nick;
    const tracked = state.tracked.find((t) => t.lizard === lz) || null;
    const flags = game.tools && game.tools.flags;
    const entry = {
      k: nextK(), nick: tag.nickname, sp: speciesKey(lz.species), sex: lz.sex === 'm' || lz.sex === 'f' ? lz.sex : null,
      svl: Number(c.measured) || Number(tag.svl) || null, mark: tag.mark || c.mark || null,
      perch: c.perch || lz.perch || null, seen: c.perchSeen || null, h: half(Number(c.height) || 0), taped: !!c.taped,
      flag: flags && flags.whereOf ? flags.whereOf(lz) : null,
      pack: tracked ? tracked.colour : null, gps: tracked ? tracked.id : null,
      day: (state.days || 0) + 1, col: colour[0], cname: colour[1],
      clip: t2(hours), kind, dl: [], upto: null, end: false,
      temps: [], states: [], trail: [], dist: 0, flights: 0, line: '', whole: false,
    };
    state.followed.push(entry);
    // the oldest stories go first once the notebook is full (never one still out)
    while (state.followed.length > PERCH.keep) {
      const i = state.followed.findIndex((f) => !live.some((r) => r.entry === f));
      if (i < 0) break;
      HOMES.delete(state.followed[i].k);
      state.followed.splice(i, 1);
    }
    state.inventory.perch = Math.max(0, (Number(state.inventory.perch) || 0) - 1);
    state.today.perchClipped = (state.today.perchClipped || 0) + 1;
    const rec = makeRec(entry, lz, place, tracked);
    live.push(rec);
    HOMES.set(entry.k, { x: lz.home.x, z: lz.home.z });
    sampleTemp(rec, hours, true);
    sampleState(rec, hours);
    addMarker(rec);
    addScore(RULES.points.perchClip || 0, 'perch');
    events.emit('perch:clip', { entry, kind, species: entry.sp, lizard: lz });
    kit.toast(say(WORDS.clipped, { name: entry.nick, time: clockText(hours + PERCH.first) }), { icon: 'thermometer', tone: 'good', ms: 3800 });
    return entry;
  }

  function addMarker(rec) {
    const maps = game.ui && game.ui.maps;
    if (!maps || !maps.addMarker || rec.markOff) return;
    rec.marker = { x: rec.x, z: rec.z, colour: rec.entry.col, label: `${rec.entry.nick}'s logger`, pulse: false };
    rec.markOff = maps.addMarker(rec.marker);
  }

  // James's word, once on a save: the first time a lizard goes home on the survey day
  async function intro() {
    state.perchIntro = true;
    const lines = (SCRIPT.perch && SCRIPT.perch.intro) || [];
    if (!lines.length) return;
    const J = game.james && game.james.position, P = player.position;
    const near = !!J && Math.hypot(J.x - P.x, J.z - P.z) < 9;
    if (!near && game.audio && game.audio.cue) game.audio.cue('radio', true);
    const name = state.playerName || SCRIPT.nameFallback || '';
    if (near && game.james) game.james.talking = true;
    try {
      await kit.dialogue({
        speaker: near ? JAMES.name : (SCRIPT.radioSpeaker || JAMES.name + ' (radio)'), portrait: 'james',
        lines: lines.map((l) => say(l, { name }).replace(/\[([^\]]{1,14})\]/g, '$1')),
      });
    } finally { if (game.james) game.james.talking = false; }
  }

  // The release cards ask here whether to offer a logger for the lizard in hand (c is
  // their plain description of it). Null: no offer.
  function offerFor(c) {
    if (OFF || state.phase !== 'survey' || !c || c.practice || c.recapture) return null;
    const lz = inHand;
    if (!lz || !lz.home || !game.lizards) return null;
    const left = Number(state.inventory.perch) || 0;
    if (left <= 0 || live.length >= MAX || live.some((r) => r.lz === lz)) return null;
    const P = game.play && game.play.perch;
    const held = STEP === 'perchlogger' || STEP === 'perchintro';
    // scripted catches (the checks' own runs) leave the loggers alone unless asked
    if (c.auto && !(P && P.auto) && !held) return null;
    const place = placeFor(lz);
    // sunny or shady: the lizard's own perch, as the map's patches and its brain read it
    const H = lz.home;
    const e = game.lizards.sunExposure(H.x, H.y, H.z, H.nx, H.ny, H.nz);
    const kind = e > THERMAL.sunny ? 'sunny' : e < THERMAL.shady ? 'shady' : 'dappled';
    const colour = nextColour();
    const nick = nickFor(lz);
    const scene = perchScene({
      sp: lz.species, sex: lz.sex, mark: c.mark, pack: c.tracked ? c.packColour : null, perch: c.perch, seen: c.perchSeen,
      kind, colour: colour[0], clipped: false, left, h: c.height,
    });
    const quiet = c.auto && P && P.auto === 'clip' && STEP !== 'perchintro';
    return {
      art: scene.svg, tray: scene.tray, spot: scene.spot, left, colour: colour[0], nick,
      kindWord: kind === 'sunny' ? 'A sunny perch' : kind === 'shady' ? 'A shady perch' : 'A dappled perch',
      kindTone: kind === 'sunny' ? 'gold' : kind === 'shady' ? 'info' : 'good',
      leftWord: left === 1 ? 'Last one today' : `${left} left today`,
      // a dappled perch says it will not count for the Sun & shade stamp, while that is still to get
      instructions: say(kind === 'dappled' && !(state.tasks['perch.sunshade'] && state.tasks['perch.sunshade'].done) ? WORDS.clipDappled : WORDS.clipCard, { name: nick }),
      intro: !state.perchIntro && !quiet && STEP !== 'perchlogger' ? intro : null,
      hold: !!(P && P.auto === 'show'), // a scripted catch holds the card for a look
      clip: () => clip(lz, c, place, kind, colour, nick),
      onClipStart: () => { if (game.audio && game.audio.cue) game.audio.cue('packClick'); },
    };
  }
  setPerchLogger(offerFor);

  // the clip card on its own with a stand-in lizard (?open=minigame:perchlogger[:sp])
  const LONG = { crested: 'cristatellus', brown: 'sagrei', green: 'carolinensis', bark: 'distichus', knight: 'equestris' };
  kit.registerMinigame('perchlogger', (arg) => {
    const c = standIn(LONG[arg] || (arg && arg.length > 6 ? arg : 'cristatellus'));
    const perch = { sagrei: 'ground', carolinensis: 'leaf', equestris: 'branch' }[c.sp] || 'trunk';
    c.perch = perch; c.perchSeen = perch; c.height = perch === 'ground' ? 0 : c.height;
    const scene = perchScene({ sp: c.sp, sex: c.sex, mark: c.mark, pack: c.packColour, perch, seen: perch, kind: 'sunny', colour: PERCH.colours[0][0], clipped: false, left: 3, h: c.height });
    return perchLoggerCard(c, {
      art: scene.svg, tray: scene.tray, spot: scene.spot, kindWord: 'A sunny perch', kindTone: 'gold',
      leftWord: '3 left today', instructions: say(WORDS.clipCard, { name: c.nickname || 'Pip' }), onClipStart: () => { if (game.audio && game.audio.cue) game.audio.cue('packClick'); },
    });
  });

  // ---- downloads
  const isDue = (rec, h = state.clock.hours) => {
    const e = rec.entry;
    if (h - e.clip < PERCH.first - 1e-6) return false;
    const n = e.dl.length;
    return !n || h - e.dl[n - 1] >= PERCH.again - 1e-6;
  };
  // copies what the logger holds so far into its story
  function fill(rec, hours) {
    const e = rec.entry;
    e.temps = rec.temps.map((p) => p.slice());
    e.states = rec.states.map((p) => p.slice());
    e.trail = rec.trail.map((p) => p.slice());
    e.dist = r1(rec.dist);
    e.flights = rec.flights;
    e.upto = t2(hours);
    e.line = daySentence(e, e.upto);
  }
  let wordAfter = null; // James's word once the day card closes: { line, nick }
  let wholeSaid = -1; // the day (state.days) James last said his whole-day word
  function download(rec) {
    const e = rec.entry;
    const hours = state.clock.hours;
    sampleTemp(rec, hours);
    sampleState(rec, hours);
    const first = e.dl.length === 0;
    const firstEver = !state.followed.some((f) => f !== e && f.dl && f.dl.length);
    e.dl.push(t2(hours));
    if (e.dl.length > 12) e.dl.shift();
    const whole = e.clip < 10 && hours >= 16;
    const wasWhole = e.whole;
    if (whole) e.whole = true;
    fill(rec, hours);
    const points = first ? (RULES.points.perchDownload || 0) : Math.round((RULES.points.perchDownload || 0) / 3);
    addScore(points, 'perch');
    state.today.perchDownloads = (state.today.perchDownloads || 0) + 1;
    // a logger downloaded, as the end-of-day card counts them (not a logger:read, so the
    // flags' logger tasks and requests are unchanged)
    state.today.loggersRead = (state.today.loggersRead || 0) + 1;
    rec.wig = 0.6;
    rec.visit = PERCH.visitT; // it stays calm while the player walks on past
    rec.due = false; rec.told = true;
    if (rec.marker) rec.marker.pulse = false;
    if (game.fx && game.fx.burst) game.fx.burst('sparkle', rec.x, rec.y + 0.15, rec.z, 6);
    if (game.audio && game.audio.cue) game.audio.cue('download');
    events.emit('perch:download', { entry: e, first, whole, hours });
    const P = SCRIPT.perch || {};
    // the whole-day word once a day; a second or third whole day gets a short one by name
    wordAfter = null;
    if (whole && !wasWhole) {
      if (wholeSaid !== state.days && P.wholeDay) { wholeSaid = state.days; wordAfter = { line: P.wholeDay, nick: e.nick }; }
      else if (P.wholeDayAgain) wordAfter = { line: P.wholeDayAgain, nick: e.nick };
    }
    if (!wordAfter && firstEver && P.firstDownload) wordAfter = { line: P.firstDownload, nick: e.nick };
    kit.openPanel('perchday', { entry: e, points, first });
    return e;
  }
  events.on('panel:close', (p) => {
    if (!p || p.id !== 'perchday' || !wordAfter) return;
    const w = wordAfter;
    wordAfter = null;
    setTimeout(() => {
      if (state.phase !== 'survey') return;
      kit.toast(`${JAMES.name}: ${say(w.line, { name: state.playerName || '', nick: w.nick })}`, { icon: 'cap', tone: 'gold', ms: 4600 });
    }, 500);
  });

  // walking or creeping past (creeping up keeps its lizard put); never while aiming
  const canDownload = () => state.phase === 'survey' && !(game.story && game.story.cutscene) && !kit.busy() &&
    !(game.catching && game.catching.busy) && !player.held &&
    !(game.catching && game.catching.loopPole && game.catching.loopPole.aiming) &&
    !(game.missions && game.missions.busyOther && game.missions.busyOther(null));
  function checkNearby() {
    if (!canDownload()) return;
    const P = player.position;
    let best = null, bd = DOWNLOAD_R;
    for (let i = 0; i < live.length; i++) {
      const rec = live[i];
      if (!rec.due) continue;
      const d = Math.hypot(rec.x - P.x, rec.z - P.z);
      if (d < bd && Math.abs(rec.y - P.y) < 5) { bd = d; best = rec; }
    }
    if (best) download(best);
  }
  // the followed lizard is calm (the brain's own cap, as the practice lizard's) while
  // the player is near its ready logger and a little while after its download; only the
  // calm set here is taken off again
  function setCalm(rec, on) {
    const lz = rec.lz;
    if (!lz || on === rec.calmed) return;
    rec.calmed = on;
    if (on) { if (!(lz.calm > 0)) { lz.calm = PERCH.calm; rec.ownCalm = true; } }
    else if (rec.ownCalm) { lz.calm = 0; rec.ownCalm = false; }
  }
  function checkDue() {
    if (state.phase !== 'survey') return;
    const P = player.position, busy = kit.busy();
    for (let i = 0; i < live.length; i++) {
      const rec = live[i];
      const near = Math.hypot(rec.x - P.x, rec.z - P.z) < PERCH.visitR;
      if (rec.visit > 0) { if (!near) rec.visit = 0; else if (!busy) rec.visit = Math.max(0, rec.visit - 0.1); }
      setCalm(rec, (rec.due && near) || rec.visit > 0);
      const due = isDue(rec);
      if (due === rec.due) continue;
      rec.due = due;
      if (rec.marker) rec.marker.pulse = due;
      if (due && !rec.told && !kit.busy()) {
        rec.told = true;
        kit.toast(say(WORDS.ready, { name: rec.entry.nick }), { icon: 'thermometer', tone: 'info', ms: 3600 });
      } else if (due && !rec.told) rec.due = false; // said once the cards are shut
    }
  }

  // ---- the day's end: the loggers still out are picked up, their stories filled in
  function removeAll() {
    for (const rec of live) { if (rec.markOff) rec.markOff(); setCalm(rec, false); }
    live.length = 0;
    mesh.count = 0;
  }
  function collectAll() {
    const hours = Math.min(state.clock.hours, RULES.day.end);
    const had = live.length > 0;
    for (const rec of live) {
      sampleTemp(rec, hours);
      sampleState(rec, hours);
      fill(rec, hours);
      rec.entry.end = true;
    }
    removeAll();
    // the day's own save came just before this (flow.js endDay), so the stories filled
    // in here are saved again, or a page closed on the end-of-day card would lose them
    if (had) save();
  }
  // a day left unfinished (back to the title, a new day): the ones never downloaded go,
  // and the ones downloaded stay in the notebook, marked cut so the end card of the day
  // played again leaves them out (state.js marks them so on load after a reload too)
  function dropUnfinished() {
    for (const rec of live) {
      if (rec.entry.end) continue;
      if (rec.entry.dl.length) { rec.entry.cut = true; continue; }
      const i = state.followed.indexOf(rec.entry);
      if (i >= 0) state.followed.splice(i, 1);
      HOMES.delete(rec.entry.k);
    }
    removeAll();
  }
  events.on('day:end', collectAll);
  events.on('day:new', dropUnfinished);
  events.on('phase:change', (e) => { if (e && e.phase === 'title') dropUnfinished(); });
  events.on('state:reset', () => { removeAll(); HOMES.clear(); });

  // ---- per frame: the buttons (sway with their perch, pop in, wiggle on a download,
  // glow while due), the readings on the clock, and the walk-past check ten times a
  // second; nothing here allocates
  // the per-frame timers in a typed array (a number kept in a closure is boxed on every write)
  const TM = new Float64Array(2); // [0] till the next walk-past check, [1] till ?perchdemo opens
  // the perch's sway (perches.js swayOffset, worked out here from the record itself so
  // no number is boxed on the way into a call)
  function sway(rec) {
    _o.x = 0; _o.y = 0; _o.z = 0;
    if (!(rec.w > 0)) return;
    const T = vegUniforms.uVegTime.value, Wd = vegUniforms.uVegWind.value;
    const h = Math.max(rec.y - 0.3, 0);
    const amp = Wd * rec.w * 0.0042 * h * Math.sqrt(h);
    const ph = T * 0.85 + rec.x * 0.11 + rec.z * 0.07;
    _o.x = (Math.sin(ph) + 0.35 * Math.sin(ph * 2.3 + 1.7)) * amp;
    _o.z = 0.6 * Math.cos(ph * 0.8 + 0.4) * amp;
    if (rec.fl) {
      const fl = rec.w * Math.min(h, 3) * 0.011;
      const q = T * 3.1 + rec.x * 1.7 + rec.y * 1.3 + rec.z * 2.1;
      _o.x += Math.sin(q) * fl;
      _o.y += 0.6 * Math.sin(q * 1.3 + 2.0) * fl;
      _o.z += Math.cos(q * 0.9) * fl;
    }
  }
  function writeInstance(rec, i, dt, t) {
    let s = 1;
    if (rec.pop < 1) {
      rec.pop = Math.min(1, rec.pop + dt / 0.45);
      const k = rec.pop;
      s = k < 0.55 ? 1.25 * smooth(0, 0.55, k) : 1.25 - 0.25 * smooth(0.55, 1, k);
    }
    if (rec.wig > 0) {
      rec.wig = Math.max(0, rec.wig - dt);
      s *= 1 + 0.4 * Math.sin((0.6 - rec.wig) * 20) * (rec.wig / 0.6);
    }
    sway(rec);
    _m.copy(rec.base);
    if (s !== 1) _m.scale(_sv.set(s, s, s));
    const el = _m.elements;
    el[12] += _o.x; el[13] += _o.y; el[14] += _o.z;
    mesh.setMatrixAt(i, _m);
    glow.array[i] = rec.due ? 0.35 + 0.35 * Math.sin(t * 4.2) : rec.wig > 0 ? rec.wig : 0;
  }
  function sampleAll() {
    const h = state.clock.hours;
    for (let i = 0; i < live.length; i++) {
      const rec = live[i];
      if (h - rec.tT >= PERCH.sampleT - 1e-6) sampleTemp(rec, h);
      if (h - rec.sT >= PERCH.stateT - 1e-6) sampleState(rec, h);
    }
  }
  TM[1] = DEMO ? 2.5 : -1;
  function update(dt, t) {
    if (TM[1] > 0 && state.phase !== 'boot' && (TM[1] -= dt) <= 0) play.demo({ pack: DEMO !== 'nopack' });
    const n = live.length;
    if (mesh.count !== n) {
      for (let i = 0; i < n; i++) mesh.setColorAt(i, _col.set(live[i].entry.col));
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.count = n;
    }
    if (!n) return;
    for (let i = 0; i < n; i++) writeInstance(live[i], i, dt, t);
    mesh.instanceMatrix.needsUpdate = true;
    glow.needsUpdate = true;
    if (state.phase === 'survey') sampleAll();
    TM[0] -= dt;
    if (TM[0] <= 0) {
      TM[0] = 0.1;
      checkDue();
      checkNearby();
    }
  }
  // ---- scripted play and checks
  const play = {
    auto: null,
    list: () => live.map((r) => ({ nick: r.entry.nick, sp: r.entry.sp, kind: r.entry.kind, due: r.due, clip: r.entry.clip, dl: r.entry.dl.slice(), temps: r.temps.length, states: r.states.map((s) => s[1]).join(''), active: !!(r.lz && r.lz.handle) })),
    entries: () => state.followed,
    // stands the player m metres from logger i (default 4.5, out of reach), facing it
    goto(i = 0, m = 4.5) {
      const rec = live[i];
      if (!rec) return false;
      const P = player.position;
      let dx = P.x - rec.x, dz = P.z - rec.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      const x = rec.x + dx * m, z = rec.z + dz * m;
      player.teleport(x, z, Math.atan2(-(rec.x - x), -(rec.z - z)));
      return true;
    },
    download: (i = 0) => (live[i] ? download(live[i]) : null),
    // what each followed lizard is up to now, as read from it and as the rules would have it
    place: (lz) => placeFor(lz),
    codes: () => live.map((r) => [r.entry.nick, !!(r.lz && r.lz.handle), r.lz ? stateCode(r) : null, r.lz && r.lz.home ? derivedCode(r, r.lz) : null]),
    // a made-up story on the card, for layout checks
    demo(opts = {}) {
      const e = demoEntry(opts);
      return kit.openPanel('perchday', { entry: e, points: 15, first: true });
    },
    get live() { return live; },
  };
  game.play = Object.assign(game.play || {}, { perch: play });

  return {
    group,
    update,
    today: () => live.map((r) => ({ entry: r.entry, ready: r.due, next: r.entry.dl.length ? r.entry.dl[r.entry.dl.length - 1] + PERCH.again : r.entry.clip + PERCH.first })),
    download,
    // the player is at (or just leaving) a ready perch logger: catching.js may skip its
    // "Too quick!" tip for a lizard flushed beside it, as for one flushed on the way to a flag
    visiting() { for (let i = 0; i < live.length; i++) if (live[i].calmed) return true; return false; },
    play,
    get stats() { return { out: live.length, followed: state.followed.length, drawCalls: live.length ? 1 : 0 }; },
  };
}

// A story made up for layout checks (?perchdemo=1 opens it): a crested anole clipped at
// 08:40 that basked till 10:50, sheltered through the heat and came back out at 15:30.
function demoEntry({ pack = true } = {}) {
  const e = {
    k: 0, nick: 'Mango', sp: 'crested', sex: 'm', svl: 61, mark: '#ff4fa3', perch: 'trunk', seen: 'trunk', h: 1.5, taped: false,
    flag: 'C07', pack: pack ? '#ffd23f' : null, gps: pack ? 'GPS 02' : null, day: 1, col: '#ff7b54', cname: 'coral',
    clip: 8.67, kind: 'sunny', dl: [11.2, 16.4], upto: 16.4, end: false, temps: [], states: [], trail: [], dist: 0, flights: 1, line: '', whole: false,
  };
  for (let h = e.clip; h <= e.upto + 1e-6; h += 1 / 6) {
    const sun = h < 10.9 || h > 15.4 ? 1 : 0.15;
    const c = baseCelsius(h) + 2.6 * sun * Math.sin(Math.PI * Math.min(1, Math.max(0, (h - 7) / 11))) - 0.3;
    e.temps.push([r2(h), r1(c), r2(sun * 0.6)]);
  }
  e.states = [[8.67, 'b'], [9.9, 'f'], [10.0, 'b'], [10.85, 'm'], [11.6, 'x'], [15.45, 'b'], [16.2, 's']];
  if (pack) {
    let x = 0, z = 0;
    for (let k = 0; k < 24; k++) { x = half(1.6 * Math.sin(k * 0.45) + 0.6 * Math.sin(k * 1.3)); z = half(1.3 * Math.cos(k * 0.38) - 0.5); e.trail.push([x, z]); }
    e.dist = 17;
  }
  e.line = daySentence(e, e.upto);
  return e;
}
