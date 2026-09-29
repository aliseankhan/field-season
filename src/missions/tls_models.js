// The laser scanner's models, all procedural: the scanner on its tripod (a chunky cream
// head with a coral band, a dark window with a spinning mirror, a carrying handle and a
// tiny display on the back, on a yellow survey tripod), the same head carried by its
// handle with the tripod bundled on the backpack, the sweeping laser fan, and a white
// ibis that flaps through a scan now and then.
//
//   buildScanner(clock)  -> { group, head, mirror, setDisplay(lines, mood), update(spin) }
//   buildCarried()       -> { hand, back }   (hung on the avatar's bones by tls.js)
//   buildFan(clock)      -> { mesh, F, len, set(), update(on) }
//   buildBird(clock)     -> { mesh, update() }
// clock is a Float64Array [t, dt] the mission sets once a frame (no numbers passed).

import * as THREE from 'three';
import { toonGradient } from '../player/avatar.js';

export const HEAD_Y = 1.18; // the head sits on the tribrach this high
export const LASER_Y = 1.42; // and the laser leaves the window this high over the ground
const HEAD_R = 0.16;

const COL = {
  cream: '#f5efe0', creamDark: '#ddd3bd', coral: '#ff7a6b', coralDark: '#e25f55', window: '#26334a',
  glass: '#9fd8ff', mirror: '#d8f1ff', handle: '#3a3f4a', bezel: '#2f3440', leg: '#f2b33d', legDark: '#c98a22',
  metal: '#b8c0c8', clamp: '#3a3f4a', foot: '#4a3b35', plate: '#4d5360', knob: '#ffcf3f', bubble: '#8fe0a0',
  strap: '#3fb8c4',
};
const C = Object.fromEntries(Object.entries(COL).map(([k, v]) => [k, new THREE.Color(v)]));

// Merges [geometry, colour] parts into one non-indexed geometry with vertex colours
// (and an optional extra float attribute from each part's third entry).
function merge(parts, extra = null) {
  let n = 0;
  const flat = parts.map(([g, c, e]) => {
    const f = g.index ? g.toNonIndexed() : g;
    f.computeVertexNormals();
    n += f.attributes.position.count;
    return [f, c, e || 0];
  });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const ex = extra ? new Float32Array(n) : null;
  let o = 0;
  for (const [g, c, e] of flat) {
    const cnt = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    for (let k = 0; k < cnt; k++) { col[(o + k) * 3] = c.r; col[(o + k) * 3 + 1] = c.g; col[(o + k) * 3 + 2] = c.b; }
    if (ex) {
      if (typeof e === 'function') { const p = g.attributes.position.array; for (let k = 0; k < cnt; k++) ex[o + k] = e(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]); }
      else ex.fill(e, o, o + cnt);
    }
    o += cnt;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (ex) geo.setAttribute(extra, new THREE.BufferAttribute(ex, 1));
  geo.computeBoundingSphere();
  return geo;
}

const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), p4 = new THREE.Vector3(), s4 = new THREE.Vector3();
function at(g, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  m4.compose(p4.set(x, y, z), q4.setFromEuler(e4.set(rx, ry, rz)), s4.set(sx, sy, sz));
  return g.applyMatrix4(m4);
}
// a cylinder from a to b
function rod(a, b, r0, r1 = r0, seg = 8) {
  const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b);
  const len = A.distanceTo(Bv);
  const g = new THREE.CylinderGeometry(r1, r0, len, seg);
  const mid = A.clone().add(Bv).multiplyScalar(0.5);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), Bv.clone().sub(A).normalize());
  return g.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
}

let sharedMat = null;
function toonMat() {
  if (!sharedMat) {
    sharedMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });
    sharedMat.customProgramCacheKey = () => 'tls-toon-1';
  }
  return sharedMat;
}

// ---------------------------------------------------------------- the head

// The head in its own frame: its base at y 0, the rotation axis up y, the window
// facing -z (a head turned by rotation.y = a looks along (-sin a, 0, -cos a)).
function headParts() {
  const P = [];
  const H0 = 0.06, H1 = 0.36; // the body's bottom and top
  P.push([new THREE.CylinderGeometry(HEAD_R * 0.8, HEAD_R * 0.86, H0, 20).translate(0, H0 / 2, 0), C.creamDark]); // the turntable
  P.push([new THREE.CylinderGeometry(HEAD_R, HEAD_R, H1 - H0, 24).translate(0, (H0 + H1) / 2, 0), C.cream]);
  P.push([new THREE.CylinderGeometry(HEAD_R * 1.04, HEAD_R * 1.04, 0.045, 24).translate(0, H1 - 0.06, 0), C.coral]); // the band
  P.push([new THREE.CylinderGeometry(HEAD_R * 1.03, HEAD_R * 1.03, 0.018, 24).translate(0, H0 + 0.035, 0), C.coralDark]);
  P.push([new THREE.SphereGeometry(HEAD_R, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.32, 1).translate(0, H1, 0), C.cream]); // the dome
  // the carrying handle
  P.push([rod([-0.075, H1 + 0.03, 0], [-0.075, H1 + 0.085, 0], 0.014), C.handle]);
  P.push([rod([0.075, H1 + 0.03, 0], [0.075, H1 + 0.085, 0], 0.014), C.handle]);
  P.push([rod([-0.085, H1 + 0.085, 0], [0.085, H1 + 0.085, 0], 0.017, 0.017, 10), C.handle]);
  // the window: a dark recess on the front with a glassy rim
  const wy = LASER_Y - HEAD_Y;
  P.push([new THREE.BoxGeometry(0.15, 0.2, 0.05).translate(0, wy, -HEAD_R + 0.012), C.window]);
  P.push([new THREE.BoxGeometry(0.17, 0.018, 0.04).translate(0, wy + 0.108, -HEAD_R + 0.008), C.glass]);
  P.push([new THREE.BoxGeometry(0.17, 0.018, 0.04).translate(0, wy - 0.108, -HEAD_R + 0.008), C.glass]);
  // the display's bezel on the back
  P.push([new THREE.BoxGeometry(0.13, 0.095, 0.02).translate(0, wy + 0.01, HEAD_R + 0.002), C.bezel]);
  // two little buttons under it
  P.push([new THREE.CylinderGeometry(0.011, 0.011, 0.012, 8).rotateX(Math.PI / 2).translate(-0.03, wy - 0.065, HEAD_R + 0.002), C.coral]);
  P.push([new THREE.CylinderGeometry(0.011, 0.011, 0.012, 8).rotateX(Math.PI / 2).translate(0.03, wy - 0.065, HEAD_R + 0.002), C.knob]);
  return P;
}
function mirrorGeometry() {
  // a little silver prism that spins about the window's horizontal axis
  const g = new THREE.CylinderGeometry(0.052, 0.052, 0.1, 4, 1).rotateZ(Math.PI / 2);
  return merge([[g, C.mirror]]);
}

// The display on the back: a tiny green LCD drawn on a canvas, redrawn only when its
// words change.
function makeDisplay() {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 88;
  const ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.108, 0.074), mat);
  // (a plane faces +z already: out of the back of the head)
  mesh.position.set(0, LASER_Y - HEAD_Y + 0.01, HEAD_R + 0.0145);
  let last = '';
  function draw(lines, mood = 'ok', bar = -1) {
    const key = lines.join('|') + mood + (bar >= 0 ? Math.round(bar * 20) : '');
    if (key === last) return;
    last = key;
    const bg = mood === 'ghost' ? '#3a2a4a' : mood === 'done' ? '#1f4a36' : '#1b3a2f';
    const fg = mood === 'ghost' ? '#e6d8ff' : mood === 'warn' ? '#ffd27a' : '#9dffba';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 128, 88);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let y = 0; y < 88; y += 4) ctx.fillRect(0, y, 128, 2);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (lines.length === 1) {
      ctx.font = 'bold ' + (lines[0].length <= 2 ? 56 : lines[0].length <= 5 ? 34 : 24) + 'px ui-monospace, Menlo, monospace';
      ctx.fillText(lines[0], 64, bar >= 0 ? 36 : 46);
    } else {
      ctx.font = 'bold 24px ui-monospace, Menlo, monospace';
      ctx.fillText(lines[0], 64, 28);
      ctx.font = 'bold 20px ui-monospace, Menlo, monospace';
      ctx.fillText(lines[1], 64, 60);
    }
    if (bar >= 0) {
      ctx.strokeStyle = fg; ctx.lineWidth = 3;
      ctx.strokeRect(14, 64, 100, 14);
      ctx.fillRect(17, 67, 94 * Math.min(1, bar), 8);
    }
    tex.needsUpdate = true;
  }
  draw(['HI!'], 'ok');
  return { mesh, draw, tex, mat };
}

// ---------------------------------------------------------------- the tripod

function tripodParts() {
  const P = [];
  const top = HEAD_Y - 0.1, footR = 0.52;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 6;
    const cx = Math.cos(a), cz = Math.sin(a);
    const A = [cx * 0.07, top, cz * 0.07], F = [cx * footR, 0.02, cz * footR];
    const M = [A[0] + (F[0] - A[0]) * 0.55, A[1] + (F[1] - A[1]) * 0.55, A[2] + (F[2] - A[2]) * 0.55];
    P.push([rod(A, M, 0.024, 0.026), C.leg]);
    P.push([rod(M, F, 0.016, 0.016), C.metal]);
    P.push([rod([M[0] * 0.97, M[1] + 0.04, M[2] * 0.97], [M[0] * 1.03, M[1] - 0.04, M[2] * 1.03], 0.032, 0.032), C.clamp]);
    P.push([rod(F, [F[0] * 1.02, -0.04, F[2] * 1.02], 0.016, 0.004, 6), C.foot]);
    P.push([rod([A[0], A[1] + 0.02, A[2]], [A[0] * 1.6, A[1] - 0.05, A[2] * 1.6], 0.03, 0.03), C.legDark]);
  }
  // the head plate, the tribrach with its three knobs and its round bubble
  P.push([new THREE.CylinderGeometry(0.115, 0.11, 0.035, 20).translate(0, top + 0.02, 0), C.plate]);
  P.push([new THREE.CylinderGeometry(0.1, 0.1, 0.05, 20).translate(0, top + 0.065, 0), C.clamp]);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    P.push([new THREE.CylinderGeometry(0.02, 0.02, 0.034, 10).translate(Math.cos(a) * 0.1, top + 0.06, Math.sin(a) * 0.1), C.knob]);
  }
  P.push([new THREE.CylinderGeometry(0.018, 0.018, 0.012, 12).translate(0.055, top + 0.093, -0.045), C.bubble]);
  return P;
}

export function buildScanner(clock) {
  const mat = toonMat();
  const group = new THREE.Group();
  group.name = 'tls-scanner';
  const tripod = new THREE.Mesh(merge(tripodParts()), mat);
  tripod.name = 'tls-tripod';
  tripod.castShadow = true;
  group.add(tripod);
  const head = new THREE.Group();
  head.position.y = HEAD_Y;
  group.add(head);
  const body = new THREE.Mesh(merge(headParts()), mat);
  body.name = 'tls-head';
  body.castShadow = true;
  head.add(body);
  const mirror = new THREE.Mesh(mirrorGeometry(), mat);
  mirror.name = 'tls-mirror';
  mirror.position.set(0, LASER_Y - HEAD_Y, -HEAD_R + 0.005);
  head.add(mirror);
  const display = makeDisplay();
  head.add(display.mesh);
  group.visible = false;
  return {
    group, head, mirror, tripod, display,
    setDisplay: display.draw,
    // clock: [t, dt]; spin in radians a second
    update(spin) { mirror.rotation.x += clock[1] * spin; },
  };
}

// The head hung from the hand by its handle, and the tripod folded on the backpack.
export function buildCarried() {
  const mat = toonMat();
  const hand = new THREE.Group();
  hand.name = 'tls-carried';
  const k = 0.82;
  // the head and its mirror (still while carried) in one mesh
  const parts = headParts();
  parts.push([new THREE.CylinderGeometry(0.052, 0.052, 0.1, 4, 1).rotateZ(Math.PI / 2).rotateX(0.5).translate(0, LASER_Y - HEAD_Y, -HEAD_R + 0.005), C.mirror]);
  const body = new THREE.Mesh(merge(parts), mat);
  body.castShadow = true;
  body.scale.setScalar(k);
  body.position.set(0, -0.445 * k, -0.02);
  hand.add(body);
  hand.visible = false;
  // three legs in a bundle with two straps
  const P = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const ox = Math.cos(a) * 0.022, oz = Math.sin(a) * 0.022;
    P.push([rod([ox, -0.28, oz], [ox, 0.08, oz], 0.017, 0.019), C.leg]);
    P.push([rod([ox, -0.46, oz], [ox, -0.28, oz], 0.012, 0.012), C.metal]);
  }
  P.push([new THREE.CylinderGeometry(0.052, 0.052, 0.03, 12).translate(0, -0.12, 0), C.strap]);
  P.push([new THREE.CylinderGeometry(0.052, 0.052, 0.03, 12).translate(0, 0.02, 0), C.strap]);
  P.push([new THREE.CylinderGeometry(0.06, 0.055, 0.04, 14).translate(0, 0.1, 0), C.plate]);
  const back = new THREE.Mesh(merge(P), mat);
  back.name = 'tls-tripod-bundle';
  back.castShadow = true;
  back.visible = false;
  return { hand, back };
}

// ---------------------------------------------------------------- the laser fan

// A thin sheet in the vertical plane the mirror sweeps, reaching out as far as each ray
// went (so it touches the ground and the trees), with three fainter sheets trailing
// behind it: the light the head leaves as it turns. Along the leading sheet its rays are
// drawn as bright beams a few pixels wide (quads widened across the sheet in the vertex
// shader, by the distance to the camera), so the fan still reads as a bright line when it
// runs edge on, away from or towards the camera. One draw call, additive.
const FAN_SEG = 34, FAN_PLANES = 4, FAN_LAG = 2.2 * Math.PI / 180;
export const FAN_EL = [-52, 78];
export function buildFan(clock) {
  const nSheet = FAN_PLANES * (FAN_SEG + 1) * 2; // the sheets' vertices, then the beams'
  const nv = nSheet + (FAN_SEG + 1) * 4;
  const pos = new Float32Array(nv * 3);
  const aU = new Float32Array(nv), aK = new Float32Array(nv), aE = new Float32Array(nv), aS = new Float32Array(nv);
  const idx = [];
  for (let p = 0; p < FAN_PLANES; p++) {
    for (let j = 0; j <= FAN_SEG; j++) {
      const v = (p * (FAN_SEG + 1) + j) * 2;
      aU[v] = 0; aU[v + 1] = 1;
      aK[v] = aK[v + 1] = p;
      aE[v] = aE[v + 1] = j / FAN_SEG;
      if (j < FAN_SEG) idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  }
  // the beams: a quad per ray of the leading sheet, window to hit, -1 and +1 across
  for (let j = 0; j <= FAN_SEG; j++) {
    const v = nSheet + j * 4;
    for (let q = 0; q < 4; q++) {
      aU[v + q] = q < 2 ? 0 : 1;
      aS[v + q] = q % 2 ? 1 : -1;
      aK[v + q] = -1;
      aE[v + q] = j / FAN_SEG;
    }
    idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
  }
  const geo = new THREE.BufferGeometry();
  const aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', aPos);
  geo.setAttribute('aU', new THREE.BufferAttribute(aU, 1));
  geo.setAttribute('aK', new THREE.BufferAttribute(aK, 1));
  geo.setAttribute('aE', new THREE.BufferAttribute(aE, 1));
  geo.setAttribute('aS', new THREE.BufferAttribute(aS, 1));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 60);
  const uNrm = { value: new THREE.Vector3(1, 0, 0) };
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOn: { value: 0 }, uLen: { value: 10 }, uNrm },
    vertexShader: /* glsl */`
      attribute float aU; attribute float aK; attribute float aE; attribute float aS;
      varying float vU; varying float vK; varying float vE; varying float vD; varying float vS;
      uniform float uLen; uniform vec3 uNrm;
      void main() {
        vU = aU; vK = aK; vE = aE; vS = aS;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        // a beam: widened across the sheet, about two pixels either side wherever it is
        if (aK < -0.5) wp.xyz += uNrm * aS * (0.0024 * distance(cameraPosition, wp.xyz) + 0.004);
        vD = aU; // 0 at the window, 1 at the hit
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      varying float vU; varying float vK; varying float vE; varying float vD; varying float vS;
      uniform float uTime; uniform float uOn;
      void main() {
        if (vK < -0.5) {
          // a beam: a hot core fading to the sides, brightest by the window and where it lands
          float core = 1.0 - vS * vS;
          float run = 0.5 + 0.5 * sin(vU * 30.0 - uTime * 22.0 + vE * 7.0);
          float a = core * (0.2 + 0.26 * pow(1.0 - vU, 1.5) + 0.3 * smoothstep(0.85, 1.0, vU)) * (0.75 + 0.25 * run);
          vec3 bc = mix(vec3(1.0, 0.2, 0.38), vec3(1.0, 0.66, 0.76), core * core * core);
          gl_FragColor = vec4(bc * uOn, a * uOn);
          return;
        }
        float lead = 1.0 - vK / ${FAN_PLANES.toFixed(1)};
        float a = pow(lead, 3.0) * (0.1 + 0.42 * pow(1.0 - vU, 1.3));
        // pulses running out along the rays, and a bright rim where they land
        float pulse = 0.5 + 0.5 * sin(vU * 46.0 - uTime * 26.0 + vE * 9.0);
        float rim = smoothstep(0.93, 1.0, vU) * (vK < 0.5 ? 1.0 : 0.25);
        vec3 col = mix(vec3(1.0, 0.18, 0.3), vec3(1.0, 0.7, 0.76), 0.3 * pulse + 0.6 * rim);
        gl_FragColor = vec4(col * uOn, (a * (0.6 + 0.4 * pulse) + rim * 0.7) * uOn);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'tls-fan';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.visible = false;
  const elRad = new Float32Array(FAN_SEG + 1);
  for (let j = 0; j <= FAN_SEG; j++) elRad[j] = ((FAN_EL[0] + (FAN_EL[1] - FAN_EL[0]) * (j / FAN_SEG)) * Math.PI) / 180;
  // F: [x, y, z, azimuth, dir] of the window; len[j]: metres the ray at elevation sample
  // j went (from the scan's last column). Typed arrays in, so nothing is boxed.
  const F = new Float64Array(5), len = new Float32Array(FAN_SEG + 1).fill(8);
  function set() {
    const x = F[0], y = F[1], z = F[2], az = F[3], dir = F[4];
    // the beams along the leading sheet, and the sheet's normal to widen them
    uNrm.value.set(Math.cos(az), 0, -Math.sin(az));
    {
      const sx = -Math.sin(az), sz = -Math.cos(az);
      for (let j = 0; j <= FAN_SEG; j++) {
        const v = nSheet + j * 4;
        const e = elRad[j], ce = Math.cos(e), se = Math.sin(e), L = len[j];
        const wx = x + sx * ce * 0.14, wy = y + se * 0.14, wz = z + sz * ce * 0.14;
        const hx = x + sx * ce * L, hy = y + se * L, hz = z + sz * ce * L;
        pos[v * 3] = wx; pos[v * 3 + 1] = wy; pos[v * 3 + 2] = wz;
        pos[v * 3 + 3] = wx; pos[v * 3 + 4] = wy; pos[v * 3 + 5] = wz;
        pos[v * 3 + 6] = hx; pos[v * 3 + 7] = hy; pos[v * 3 + 8] = hz;
        pos[v * 3 + 9] = hx; pos[v * 3 + 10] = hy; pos[v * 3 + 11] = hz;
      }
    }
    for (let p = 0; p < FAN_PLANES; p++) {
      const a = az - dir * p * FAN_LAG;
      const sx = -Math.sin(a), sz = -Math.cos(a);
      for (let j = 0; j <= FAN_SEG; j++) {
        const v = (p * (FAN_SEG + 1) + j) * 2;
        const e = elRad[j], ce = Math.cos(e), se = Math.sin(e);
        const L = len[j];
        pos[v * 3] = x + sx * ce * 0.14; pos[v * 3 + 1] = y + se * 0.14; pos[v * 3 + 2] = z + sz * ce * 0.14;
        pos[v * 3 + 3] = x + sx * ce * L; pos[v * 3 + 4] = y + se * L; pos[v * 3 + 5] = z + sz * ce * L;
      }
    }
    aPos.needsUpdate = true;
  }
  return {
    mesh, set, F, len, elRad, SEG: FAN_SEG,
    update(on) { mat.uniforms.uTime.value = clock[0]; mat.uniforms.uOn.value = on; mesh.visible = on > 0.01; },
  };
}

// ---------------------------------------------------------------- the bird

// A white ibis: white body, long curved coral beak, black wing tips, legs trailing.
// The wings flap in the vertex shader (aWing: 0 on the body, the span out to +-1).
export function buildBird(clock) {
  const P = [];
  const white = new THREE.Color('#fbfaf4'), tip = new THREE.Color('#2e3440'), beak = new THREE.Color('#ff8f6b'), eye = new THREE.Color('#2a2530');
  P.push([new THREE.SphereGeometry(0.12, 12, 8).scale(1, 0.85, 1.9).translate(0, 0, 0.02), white, 0]);
  P.push([rod([0, 0.03, -0.18], [0, 0.07, -0.3], 0.035, 0.04), white, 0]);
  P.push([new THREE.SphereGeometry(0.05, 10, 8).translate(0, 0.08, -0.32), white, 0]);
  P.push([new THREE.SphereGeometry(0.011, 6, 4).translate(0.035, 0.1, -0.34), eye, 0]);
  P.push([new THREE.SphereGeometry(0.011, 6, 4).translate(-0.035, 0.1, -0.34), eye, 0]);
  // the curved beak in three pieces
  P.push([rod([0, 0.08, -0.36], [0, 0.065, -0.45], 0.014, 0.011, 6), beak, 0]);
  P.push([rod([0, 0.065, -0.45], [0, 0.035, -0.52], 0.011, 0.008, 6), beak, 0]);
  P.push([rod([0, 0.035, -0.52], [0, 0.0, -0.56], 0.008, 0.004, 6), beak, 0]);
  // legs trailing behind
  P.push([rod([0.03, -0.05, 0.15], [0.035, -0.07, 0.42], 0.009, 0.007, 5), beak, 0]);
  P.push([rod([-0.03, -0.05, 0.15], [-0.035, -0.07, 0.42], 0.009, 0.007, 5), beak, 0]);
  // wings: flat, tapered, black at the tips
  for (const s of [1, -1]) {
    const w = new THREE.BoxGeometry(0.46, 0.018, 0.2, 6, 1, 1);
    const p = w.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + 0.23; // 0 at the shoulder
      p.setZ(i, p.getZ(i) * (1 - 0.45 * (x / 0.46)) + 0.03 * (x / 0.46));
      p.setX(i, s * (x + 0.06));
    }
    P.push([w, white, (x) => Math.abs(x) / 0.52]);
    const t = new THREE.BoxGeometry(0.12, 0.02, 0.11).translate(s * 0.47, 0.001, 0.035);
    P.push([t, tip, (x) => Math.abs(x) / 0.52]);
  }
  const geo = merge(P, 'aWing');
  const uFlap = { value: 0 };
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uFlap = uFlap;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aWing;\nuniform float uFlap;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        if (aWing > 0.0) {
          float s = sign(transformed.x);
          float a = s * uFlap * (0.4 + 0.6 * aWing);
          float px = s * 0.06;
          vec2 d = vec2(transformed.x - px, transformed.y);
          transformed.x = px + d.x * cos(a) - d.y * sin(a);
          transformed.y = d.x * sin(a) + d.y * cos(a);
        }`);
  };
  mat.customProgramCacheKey = () => 'tls-bird-1';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'tls-bird';
  mesh.castShadow = true;
  mesh.visible = false;
  mesh.scale.setScalar(1.35);
  let phase = 0;
  return {
    mesh,
    update() {
      const dt = clock[1], t = clock[0];
      // flap for a while, glide a little
      const glide = Math.sin(t * 0.9) > 0.55;
      phase += dt * (glide ? 2 : 11);
      const want = glide ? 0.12 : Math.sin(phase) * 0.85;
      uFlap.value += (want - uFlap.value) * Math.min(1, dt * 14);
    },
  };
}
