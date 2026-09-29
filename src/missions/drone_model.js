// The drone survey's models, all procedural and cheap to draw:
//
//   buildKitMesh(padAt)   one mesh, one draw call: the landing pad and its windsock
//                         (fixed in the world), the little quadcopter (moved by a
//                         matrix uniform, its props spinning and its gimbal tilting in
//                         the vertex shader, blur discs dithered in, blinking lights)
//                         and the controller in the player's hand (a second matrix
//                         uniform), each with a thin outline shell in the same call
//   buildOsprey()         the osprey who is not amused: one mesh with its outline,
//                         wings flapping in the vertex shader
//   buildRings(rings)     the glowing survey rings (and the landing ring round the
//                         pad): one instanced mesh
//   buildPathDots(points) the dotted flight plan, whose dots turn mint as the photos
//                         along the lanes are taken: one Points draw call
//   buildDropLine()       the dotted drop line under the drone near the pad: one Points
//   buildBlob()           the drone's soft shadow on the ground, the pad or the canopy
//
// Frames: the drone's own frame has y up and its nose towards -z (three.js style), with
// its centre between the arms; the skids' feet are SKID_Y below the centre.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { toonGradient } from '../player/avatar.js';

export const SKID_Y = 0.165; // centre to the bottom of the skids
export const PAD = { r: 0.6, h: 0.1 }; // the pad's platform radius and the height of its top
export const MOTORS = [[-0.24, -0.24], [0.24, -0.24], [0.24, 0.24], [-0.24, 0.24]]; // x, z: front left, front right, back right, back left
const MOTOR_Y = 0.035;
const PROP_R = 0.19;
const OUTLINE_W = 0.011;

const lin = (hex) => new THREE.Color(hex); // vertex colours: three converts sRGB hex to linear

// ---------------------------------------------------------------- a geometry builder

// Collects primitives into flat arrays: position, normal, colour, and per vertex the
// part (0 world, 1 drone, 2..5 a prop, 6 the gimbal, 7 the controller, 8 the windsock),
// a pivot (the prop's hub, the gimbal's hinge, the sock's swivel), a glow kind, the
// outline flag and a blur-disc flag. add() also writes a flipped, pushed-out copy of
// the part as its outline, unless told not to.
class Builder {
  constructor() {
    this.p = []; this.n = []; this.c = []; this.part = []; this.pivot = []; this.glow = []; this.out = []; this.disc = [];
  }
  add(geo, { part = 1, colour = '#ffffff', pivot = [0, 0, 0], glow = 0, outline = true, disc = 0, shade = null } = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    const P = g.attributes.position.array, N = g.attributes.normal.array;
    const col = lin(colour);
    const pass = (flip) => {
      const n = P.length / 3;
      for (let i = 0; i < n; i += 3) {
        const order = flip ? [0, 2, 1] : [0, 1, 2];
        for (const k of order) {
          const j = (i + k) * 3;
          this.p.push(P[j], P[j + 1], P[j + 2]);
          this.n.push(N[j], N[j + 1], N[j + 2]);
          // a touch of shading baked in by height, so flat colours still read round
          const s = shade ? shade(P[j], P[j + 1], P[j + 2], N[j], N[j + 1], N[j + 2]) : 1;
          this.c.push(col.r * s, col.g * s, col.b * s);
          this.part.push(part);
          this.pivot.push(pivot[0], pivot[1], pivot[2]);
          this.glow.push(flip ? 0 : glow);
          this.out.push(flip ? 1 : 0);
          this.disc.push(flip ? 0 : disc);
        }
      }
    };
    pass(false);
    if (outline) pass(true);
    g.dispose();
    if (g !== geo) geo.dispose();
  }
  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    geo.setAttribute('aPart', new THREE.Float32BufferAttribute(this.part, 1));
    geo.setAttribute('aPivot', new THREE.Float32BufferAttribute(this.pivot, 3));
    geo.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.glow, 1));
    geo.setAttribute('aOutline', new THREE.Float32BufferAttribute(this.out, 1));
    geo.setAttribute('aDisc', new THREE.Float32BufferAttribute(this.disc, 1));
    return geo;
  }
}

const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3();
function place(geo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  geo.applyMatrix4(M4.compose(V.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S.set(sx, sy, sz)));
  return geo;
}
const sphere = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);
const cyl = (r0, r1, h, seg = 12) => new THREE.CylinderGeometry(r1, r0, h, seg, 1);
// a cylinder from a to b
function rod(a, b, r, seg = 8) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const L = d.length();
  const g = new THREE.CylinderGeometry(r, r, L, seg, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(1, 1, 1)));
  return g;
}
const topLit = (x, y, z, nx, ny) => 0.86 + 0.16 * ny;

// ---------------------------------------------------------------- the shader

// Shared by the kit mesh and the osprey: the per-part transforms in the vertex shader,
// the outline shell, the blur discs' dither and the glowing lights.
const PART_VERT_HEAD = /* glsl */ `
attribute float aPart;
attribute vec3 aPivot;
attribute float aGlow;
attribute float aOutline;
attribute float aDisc;
uniform mat4 uDrone;
uniform mat4 uHand;
uniform vec4 uSpin;
uniform vec4 uAngles; // x gimbal pitch, y sock yaw, z sock droop, w wing flap (the osprey)
uniform vec4 uShow;   // x drone, y controller, z world parts, w discs
uniform float uOutlineW;
varying float vGlow;
varying float vOutline;
varying float vDisc;
varying float vDiscR;
mat4 kitRotY(float a) { float c = cos(a), s = sin(a); return mat4(c, 0.0, -s, 0.0, 0.0, 1.0, 0.0, 0.0, s, 0.0, c, 0.0, 0.0, 0.0, 0.0, 1.0); }
mat4 kitRotX(float a) { float c = cos(a), s = sin(a); return mat4(1.0, 0.0, 0.0, 0.0, 0.0, c, s, 0.0, 0.0, -s, c, 0.0, 0.0, 0.0, 0.0, 1.0); }
mat4 kitRotZ(float a) { float c = cos(a), s = sin(a); return mat4(c, s, 0.0, 0.0, -s, c, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0); }
mat4 kitMove(vec3 t) { return mat4(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, t.x, t.y, t.z, 1.0); }
mat4 kitPart() {
  mat4 m = mat4(1.0);
#ifdef KIT_BIRD
  // the osprey: 1 its left wing, 2 its right, flapping about the shoulder
  if (aPart > 0.5 && aPart < 1.5) m = kitMove(aPivot) * kitRotZ(-uAngles.w) * kitMove(-aPivot);
  else if (aPart > 1.5 && aPart < 2.5) m = kitMove(aPivot) * kitRotZ(uAngles.w) * kitMove(-aPivot);
  m = uDrone * m;
#else
  if (aPart > 1.5 && aPart < 5.5) {
    float a = aPart < 2.5 ? uSpin.x : aPart < 3.5 ? uSpin.y : aPart < 4.5 ? uSpin.z : uSpin.w;
    m = kitMove(aPivot) * kitRotY(a) * kitMove(-aPivot);
  } else if (aPart > 5.5 && aPart < 6.5) {
    m = kitMove(aPivot) * kitRotX(-uAngles.x) * kitMove(-aPivot);
  } else if (aPart > 7.5) {
    m = kitMove(aPivot) * kitRotY(uAngles.y) * kitRotZ(uAngles.z) * kitMove(-aPivot);
  }
  if (aPart > 0.5 && aPart < 6.5) m = uDrone * m;
  else if (aPart > 6.5 && aPart < 7.5) m = uHand * m;
#endif
  return m;
}
float kitShow() {
#ifdef KIT_BIRD
  return uShow.x;
#else
  if (aPart > 0.5 && aPart < 6.5) return uShow.x * (aDisc > 0.5 ? uShow.w : 1.0);
  if (aPart > 6.5 && aPart < 7.5) return uShow.y;
  return uShow.z;
#endif
}
`;

const PART_FRAG_HEAD = /* glsl */ `
uniform float uTime;
uniform float uBlur;
uniform vec3 uOutlineCol;
uniform vec4 uGlowK; // x nav lights, y strobe, z screens, w pad lights
varying float vGlow;
varying float vOutline;
varying float vDisc;
varying float vDiscR;
float kitBayer(vec2 p) {
  int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0));
  int i = x + y * 4;
  const float B[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (B[i] + 0.5) / 16.0;
}
`;

function partMaterial({ bird = false, key }) {
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });
  const uniforms = {
    uDrone: { value: new THREE.Matrix4() },
    uHand: { value: new THREE.Matrix4() },
    uSpin: { value: new THREE.Vector4() },
    uAngles: { value: new THREE.Vector4() },
    uShow: { value: new THREE.Vector4(1, 0, 1, 1) },
    uOutlineW: { value: OUTLINE_W },
    uTime: { value: 0 },
    uBlur: { value: 0 },
    uOutlineCol: { value: new THREE.Color('#3a2f2a') },
    uGlowK: { value: new THREE.Vector4(1, 0, 1, 0) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    if (bird) shader.defines = { ...(shader.defines || {}), KIT_BIRD: '' };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + PART_VERT_HEAD)
      .replace('#include <beginnormal_vertex>', `mat4 kitM = kitPart();
float kitK = kitShow();
vec3 objectNormal = mat3(kitM) * vec3(normal);
#ifdef USE_TANGENT
vec3 objectTangent = vec3(tangent.xyz);
#endif`)
      .replace('#include <begin_vertex>', `vec3 transformed = (kitM * vec4(position * kitK + normal * aOutline * uOutlineW * kitK, 1.0)).xyz;
vGlow = aGlow; vOutline = aOutline; vDisc = aDisc;
vDiscR = length(position.xz - aPivot.xz) / ${PROP_R.toFixed(3)};`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + PART_FRAG_HEAD)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (vDisc > 0.5) {
  // a blurred prop: denser near the rim, dithered so it needs no sorting
  float a = uBlur * (0.28 + 0.55 * smoothstep(0.35, 0.95, vDiscR)) * (1.0 - smoothstep(0.95, 1.0, vDiscR));
  if (kitBayer(gl_FragCoord.xy) >= a) discard;
}`)
      .replace('#include <opaque_fragment>', `if (vGlow > 0.5) {
  float k = vGlow < 2.5 ? uGlowK.x : vGlow < 3.5 ? uGlowK.y : vGlow < 4.5 ? uGlowK.z : uGlowK.w;
  outgoingLight = mix(outgoingLight, vColor.rgb * 1.35, clamp(k, 0.0, 1.0));
}
if (vOutline > 0.5) outgoingLight = uOutlineCol;
#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => key;
  return { mat, uniforms };
}

// ---------------------------------------------------------------- the kit: pad, drone, controller

export function buildKitMesh(padAt) {
  const b = new Builder();
  const [px, py, pz] = padAt;
  const W = (geo, o = {}) => b.add(geo, { part: 0, ...o });

  // --- the pad: a round wooden platform with a teal mat, a white ring and an H
  W(place(cyl(PAD.r, PAD.r * 0.97, 0.08, 24), px, py + 0.04, pz), { colour: '#c9955e', shade: topLit });
  W(place(cyl(PAD.r * 0.9, PAD.r * 0.9, 0.022, 24), px, py + 0.089, pz), { colour: '#3fb0ad', outline: false, shade: topLit });
  W(place(new THREE.RingGeometry(0.38, 0.445, 32, 1), px, py + 0.101, pz, -Math.PI / 2), { colour: '#fffaf0', outline: false });
  W(place(new THREE.PlaneGeometry(0.06, 0.3), px - 0.1, py + 0.101, pz, -Math.PI / 2), { colour: '#fffaf0', outline: false });
  W(place(new THREE.PlaneGeometry(0.06, 0.3), px + 0.1, py + 0.101, pz, -Math.PI / 2), { colour: '#fffaf0', outline: false });
  W(place(new THREE.PlaneGeometry(0.16, 0.055), px, py + 0.101, pz, -Math.PI / 2), { colour: '#fffaf0', outline: false });
  // little lights round the rim that pulse while the drone comes in to land
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3;
    W(place(sphere(0.026, 1), px + Math.cos(a) * 0.565, py + 0.09, pz + Math.sin(a) * 0.565, 0, 0, 0, 1, 0.7, 1), { colour: '#ffd84a', glow: 5, outline: false });
  }
  // the windsock on its pole, which swings to point downwind
  const sx = px + 0.78, sz = pz - 0.62, sy = py + 1.55; // by the hedge, off the landing's lawn
  W(rod([sx, py, sz], [sx, sy + 0.05, sz], 0.022), { colour: '#e9e2d0' });
  W(place(sphere(0.035, 1), sx, sy + 0.06, sz), { colour: '#ff8a5c' });
  const sock = [['#ff8a5c', 0, 0.12, 0.1, 0.085], ['#fffaf0', 0.12, 0.24, 0.085, 0.07], ['#ff8a5c', 0.24, 0.36, 0.07, 0.055], ['#fffaf0', 0.36, 0.46, 0.055, 0.045]];
  for (const [colour, a, bb, r0, r1] of sock) {
    const g = new THREE.CylinderGeometry(r1, r0, bb - a, 12, 1, true);
    g.rotateZ(-Math.PI / 2);
    g.translate(sx + 0.03 + (a + bb) / 2, sy, sz);
    b.add(g, { part: 8, colour, pivot: [sx, sy, sz] });
  }

  // --- the drone
  const D = (geo, o = {}) => b.add(geo, { part: 1, ...o });
  const cream = '#fff4df', coral = '#ff8a5c', coralDeep = '#e0643c', grey = '#8f9aa6', dark = '#3a3f47';
  D(new RoundedBoxGeometry(0.3, 0.13, 0.36, 3, 0.055), { colour: cream, shade: topLit });
  D(place(sphere(0.125, 2), 0, 0.055, 0.01, 0, 0, 0, 1, 0.42, 1.18), { colour: coral, shade: topLit }); // the top shell
  D(place(new RoundedBoxGeometry(0.1, 0.035, 0.08, 2, 0.012), 0, 0.075, 0.1), { colour: '#3fb0ad' }); // the battery
  // a face: big eyes on the nose, with shines, and rosy cheeks
  for (const s of [-1, 1]) {
    D(place(sphere(0.045, 2), s * 0.066, 0.0, -0.168, 0, 0, 0, 1, 1.1, 0.45), { colour: '#2b2320', outline: false });
    D(place(sphere(0.014, 1), s * 0.058 + 0.01, 0.018, -0.19), { colour: '#ffffff', outline: false });
    D(place(sphere(0.022, 1), s * 0.112, -0.034, -0.162, 0, 0, 0, 1, 0.6, 0.4), { colour: '#ff9aa8', outline: false });
  }
  // arms, motors and hubs
  for (let k = 0; k < 4; k++) {
    const [mx, mz] = MOTORS[k];
    D(rod([mx * 0.35, 0.0, mz * 0.35], [mx, MOTOR_Y - 0.01, mz], 0.021), { colour: grey });
    D(place(cyl(0.042, 0.038, 0.06, 14), mx, MOTOR_Y, mz), { colour: coralDeep, shade: topLit });
    // the prop: a hub and two blades with coral tips, and its blur disc
    const hub = [mx, MOTOR_Y + 0.04, mz];
    const P = (geo, o = {}) => b.add(geo, { part: 2 + k, pivot: hub, ...o });
    P(place(cyl(0.024, 0.018, 0.03, 10), mx, MOTOR_Y + 0.045, mz), { colour: '#fffaf0' });
    const spin = k % 2 ? 1 : -1;
    for (const s of [-1, 1]) {
      P(place(new THREE.BoxGeometry(0.15, 0.006, 0.036), mx + s * 0.09, MOTOR_Y + 0.05, mz, spin * s * 0.25, 0, 0), { colour: '#fbfbf6' });
      P(place(new THREE.BoxGeometry(0.035, 0.007, 0.037), mx + s * 0.165, MOTOR_Y + 0.05, mz, spin * s * 0.25, 0, 0), { colour: coral, outline: false });
    }
    // the blur disc, both faces (seen from above and below)
    P(place(new THREE.CircleGeometry(PROP_R, 24), mx, MOTOR_Y + 0.052, mz, -Math.PI / 2), { colour: '#eef3f6', outline: false, disc: 1 });
    P(place(new THREE.CircleGeometry(PROP_R, 24), mx, MOTOR_Y + 0.048, mz, Math.PI / 2), { colour: '#eef3f6', outline: false, disc: 1 });
  }
  // nav lights: red front left, green front right, a white strobe at the back, a teal status light on top
  D(place(sphere(0.02, 1), MOTORS[0][0], MOTOR_Y - 0.04, MOTORS[0][1]), { colour: '#ff4a3a', glow: 1, outline: false });
  D(place(sphere(0.02, 1), MOTORS[1][0], MOTOR_Y - 0.04, MOTORS[1][1]), { colour: '#44f07a', glow: 2, outline: false });
  D(place(sphere(0.022, 1), 0, 0.02, 0.19), { colour: '#ffffff', glow: 3, outline: false });
  D(place(sphere(0.018, 1), 0, 0.105, 0.02), { colour: '#6ff5e6', glow: 4, outline: false });
  // skids: two rails on four struts
  for (const s of [-1, 1]) {
    D(rod([s * 0.13, -SKID_Y + 0.012, -0.15], [s * 0.13, -SKID_Y + 0.012, 0.15], 0.013), { colour: grey });
    D(rod([s * 0.08, -0.05, -0.09], [s * 0.13, -SKID_Y + 0.012, -0.1], 0.011), { colour: grey });
    D(rod([s * 0.08, -0.05, 0.09], [s * 0.13, -SKID_Y + 0.012, 0.1], 0.011), { colour: grey });
  }
  // the gimbal camera under the nose, which tilts to look down
  const hinge = [0, -0.07, -0.11];
  const G = (geo, o = {}) => b.add(geo, { part: 6, pivot: hinge, ...o });
  G(place(new RoundedBoxGeometry(0.1, 0.03, 0.05, 2, 0.01), 0, -0.07, -0.11), { colour: grey });
  G(place(sphere(0.048, 2), 0, -0.1, -0.125), { colour: dark });
  G(place(cyl(0.028, 0.028, 0.02, 14), 0, -0.1, -0.168, Math.PI / 2), { colour: '#1e2a38', outline: false });
  G(place(sphere(0.009, 1), 0.01, -0.09, -0.178), { colour: '#ffffff', outline: false });

  // --- the controller in the hand (its frame: the hand, upright, facing -z)
  const C = (geo, o = {}) => b.add(geo, { part: 7, ...o });
  const cx = -0.07, cy = 0.02, cz = -0.07;
  C(place(new RoundedBoxGeometry(0.17, 0.035, 0.09, 2, 0.016), cx, cy, cz, 0.25), { colour: '#5b6470' });
  for (const s of [-1, 1]) {
    C(place(sphere(0.03, 1), cx + s * 0.085, cy - 0.01, cz + 0.02, 0, 0, 0, 1, 0.8, 1.2), { colour: '#4a525d' }); // grips
    C(place(cyl(0.007, 0.007, 0.03, 6), cx + s * 0.045, cy + 0.03, cz + 0.005, 0.25), { colour: '#2b2f36', outline: false });
    C(place(sphere(0.014, 1), cx + s * 0.045, cy + 0.045, cz + 0.0, 0, 0, 0, 1, 0.6, 1), { colour: '#2b2f36' });
  }
  // the phone clipped on top, its screen glowing
  C(place(new RoundedBoxGeometry(0.13, 0.075, 0.009, 2, 0.006), cx, cy + 0.07, cz - 0.02, -0.55), { colour: '#2b2f36' });
  C(place(new THREE.PlaneGeometry(0.112, 0.06), cx, cy + 0.072, cz - 0.0245, -0.55), { colour: '#7fe7dc', glow: 4, outline: false });
  C(place(cyl(0.005, 0.005, 0.06, 6), cx + 0.07, cy + 0.04, cz + 0.035), { colour: '#2b2f36', outline: false }); // the antenna

  const geo = b.build();
  const { mat, uniforms } = partMaterial({ key: 'drone-kit-1' });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'drone-kit';
  mesh.frustumCulled = false; // its parts move in the vertex shader
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return { mesh, uniforms, triangles: geo.attributes.position.count / 3, sock: { x: sx, y: sy, z: sz } };
}

// ---------------------------------------------------------------- the osprey

// A chunky osprey about 3.4 m across the wings (larger than life, like the lizards):
// white below, brown above, a dark mask through the eye, a hooked beak and a pair of
// cross little eyebrows. Nose towards -z; wings pivot at the shoulders.
export function buildOsprey() {
  const b = new Builder();
  const white = '#fbf8ef', brown = '#6b4a32', dark = '#33261c', beak = '#34343a', eye = '#ffd21f';
  const B = (geo, o = {}) => b.add(geo, { part: 0, ...o });
  B(place(sphere(0.24, 2), 0, 0, 0, 0, 0, 0, 1, 0.9, 1.85), { colour: white, shade: topLit }); // body
  B(place(sphere(0.24, 2), 0, 0.07, 0.06, 0, 0, 0, 0.95, 0.62, 1.75), { colour: brown, shade: topLit }); // back
  B(place(sphere(0.17, 2), 0, 0.12, -0.46), { colour: white, shade: topLit }); // head
  for (const s of [-1, 1]) {
    B(place(sphere(0.1, 1), s * 0.1, 0.13, -0.44, 0, 0, 0, 0.4, 0.35, 1.3), { colour: dark, outline: false }); // mask
    B(place(sphere(0.03, 1), s * 0.13, 0.15, -0.54), { colour: eye, outline: false });
    B(place(sphere(0.013, 1), s * 0.14, 0.155, -0.56), { colour: '#1a1410', outline: false });
    // cross eyebrows, tipped down towards the beak
    B(place(new THREE.BoxGeometry(0.09, 0.022, 0.024), s * 0.11, 0.205, -0.55, 0, 0, s * 0.5), { colour: dark, outline: false });
  }
  B(place(new THREE.ConeGeometry(0.05, 0.16, 8), 0, 0.08, -0.64, -Math.PI / 2 - 0.55), { colour: beak });
  B(place(new THREE.BoxGeometry(0.24, 0.035, 0.3), 0, 0.03, 0.5, 0.1), { colour: brown }); // tail
  B(place(new THREE.BoxGeometry(0.2, 0.03, 0.08), 0, 0.035, 0.66, 0.1), { colour: white, outline: false }); // tail band
  // the wings: an osprey's crooked M, raised at the shoulder and drooping past the wrist
  for (const s of [-1, 1]) {
    const part = s < 0 ? 1 : 2;
    const pivot = [s * 0.16, 0.06, -0.05];
    const Wg = (geo, o = {}) => b.add(geo, { part, pivot, ...o });
    Wg(place(sphere(0.32, 2), s * 0.52, 0.18, -0.02, 0, 0, s * 0.3, 1.3, 0.17, 0.7), { colour: brown, shade: topLit }); // inner
    Wg(place(sphere(0.3, 2), s * 1.2, 0.2, 0.06, 0, s * 0.2, -s * 0.3, 1.25, 0.15, 0.6), { colour: brown, shade: topLit }); // outer
    Wg(place(sphere(0.24, 1), s * 0.55, 0.15, 0.0, 0, 0, s * 0.3, 1.2, 0.1, 0.5), { colour: white, outline: false }); // pale underwing
    Wg(place(sphere(0.07, 1), s * 0.9, 0.28, -0.12, 0, 0, 0, 1, 0.8, 1), { colour: dark, outline: false }); // the dark wrist patch
    for (let k = 0; k < 4; k++) Wg(place(new THREE.BoxGeometry(0.2, 0.025, 0.055), s * (1.55 + k * 0.015), 0.06 - k * 0.01, 0.0 + k * 0.07, 0, s * (0.25 - k * 0.17), -s * 0.3), { colour: dark }); // fingers
  }
  const geo = b.build();
  const { mat, uniforms } = partMaterial({ bird: true, key: 'drone-osprey-1' });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'drone-osprey';
  mesh.frustumCulled = false;
  mesh.visible = false;
  uniforms.uShow.value.set(1, 0, 0, 0);
  return { mesh, uniforms, triangles: geo.attributes.position.count / 3 };
}

// ---------------------------------------------------------------- the rings

// rings: [{ x, y, z, yaw, flat?, scale? }]. Each ring's colour and state is per
// instance: aState 0 waiting (a paler cream gold), 1 next (gold, lights chasing round
// it), 2 passed (fading out in a dither while it swells), 3 hidden; aFade 0..1 for the
// passing. A `flat` ring lies on the ground (the landing target round the pad). The
// rings are guidance, not scenery, so the fog leaves them alone: a far ring stays gold
// instead of washing out to a pale outline.
export const RING_R = 3.0;
export function buildRings(rings) {
  const geo = new THREE.TorusGeometry(RING_R, 0.2, 10, 48);
  const n = rings.length;
  const state = new Float32Array(n), fade = new Float32Array(n);
  state.fill(3);
  geo.setAttribute('aState', new THREE.InstancedBufferAttribute(state, 1));
  geo.setAttribute('aFade', new THREE.InstancedBufferAttribute(fade, 1));
  const uniforms = { uTime: { value: 0 } };
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aState;
attribute float aFade;
uniform float uTime;
varying float vState;
varying float vFade;
varying float vGlint;
varying float vFacing;`)
      .replace('#include <begin_vertex>', `vec3 transformed = vec3(position) * (1.0 + aFade * 0.6);
vState = aState; vFade = aFade;
float ang = atan(position.y, position.x);
vGlint = aState > 0.5 && aState < 1.5 ? pow(0.5 + 0.5 * sin(ang * 6.0 - uTime * 5.0), 4.0) : 0.0;
// how squarely the ring faces the camera (a ring seen edge on is a thin bar, which
// from far off reads as a stray stick rather than a ring)
#ifdef USE_INSTANCING
mat4 ringMV = modelViewMatrix * instanceMatrix;
#else
mat4 ringMV = modelViewMatrix;
#endif
vec3 ringN = normalize(mat3(ringMV) * vec3(0.0, 0.0, 1.0));
vec3 ringC = (ringMV * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
vFacing = abs(dot(ringN, normalize(-ringC)));`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
varying float vState;
varying float vFade;
varying float vGlint;
varying float vFacing;
float ringBayer(vec2 p) {
  int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0));
  int i = x + y * 4;
  const float B[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (B[i] + 0.5) / 16.0;
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
if (vState > 2.5) discard;
if (vState > 1.5 && ringBayer(gl_FragCoord.xy) < vFade) discard;
// the rings after the next: a lighter preview, gone when seen edge on
if (vState < 0.5 && ringBayer(gl_FragCoord.xy) > 0.8 * smoothstep(0.2, 0.65, vFacing)) discard;
vec3 waitC = vec3(1.0, 0.78, 0.36);  // (linear) a paler cream gold: the rings after the next
vec3 nextC = vec3(1.0, 0.5, 0.035);  // warm gold
vec3 doneC = vec3(0.26, 0.87, 0.3);  // mint
vec3 c = vState < 0.5 ? waitC : vState < 1.5 ? nextC : doneC;
float pulse = vState > 0.5 && vState < 1.5 ? 0.9 + 0.1 * sin(uTime * 4.0) : 0.8;
diffuseColor.rgb = c * pulse + vec3(1.0, 0.95, 0.7) * vGlint * 0.7;`);
  };
  mat.customProgramCacheKey = () => 'drone-rings-3';
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.name = 'drone-rings';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  const e = new THREE.Euler();
  rings.forEach((r, i) => {
    q.setFromEuler(r.flat ? e.set(-Math.PI / 2, 0, 0) : e.set(0, r.yaw, 0));
    s.setScalar(r.scale || 1);
    mesh.setMatrixAt(i, m.compose(p.set(r.x, r.y, r.z), q, s));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.visible = false;
  return {
    mesh, uniforms,
    setState(i, st, f = 0) {
      if (state[i] === st && fade[i] === f) return;
      state[i] = st; fade[i] = f;
      geo.attributes.aState.needsUpdate = true;
      geo.attributes.aFade.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------- the dotted flight plan

// points: the plan's corners [{ x, y, z }] from the pad through each ring and home; a
// dot every `gap` metres, each knowing its leg (0 = pad to ring 1). Legs before the
// next ring's are hidden, the next one's dots are gold and march, later ones are faint.
// A dot the drone's camera has photographed (snap(leg, x0, x1, t)) turns mint, pops,
// and stays, so the lanes fill in as the survey's photos are taken.
export function buildPathDots(points, gap = 2.6) {
  const pos = [], leg = [], along = [];
  let dist = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i], b = points[i + 1];
    const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const n = Math.max(1, Math.floor(L / gap));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      pos.push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
      leg.push(i);
      along.push(dist + L * t);
    }
    dist += L;
  }
  const count = pos.length / 3;
  const snapT = new Float32Array(count); // 0, or the time the dot's spot was photographed
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aLeg', new THREE.Float32BufferAttribute(leg, 1));
  geo.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
  geo.setAttribute('aSnap', new THREE.BufferAttribute(snapT, 1));
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, uNext: { value: 0 }, uScale: { value: 500 },
  }]);
  const mat = new THREE.ShaderMaterial({
    uniforms, fog: true, transparent: true, depthWrite: false,
    vertexShader: /* glsl */ `
attribute float aLeg;
attribute float aAlong;
attribute float aSnap;
uniform float uTime;
uniform float uNext;
uniform float uScale;
varying float vA;
varying float vNext;
varying float vSnap;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float next = abs(aLeg - uNext) < 0.5 ? 1.0 : 0.0;
  float later = aLeg > uNext + 0.5 ? 1.0 : 0.0;
  float snap = aSnap > 0.0 ? 1.0 : 0.0;
  float march = 0.5 + 0.5 * sin(aAlong * 0.9 - uTime * 6.0);
  vA = next * (0.55 + 0.45 * march) + later * 0.32;
  vNext = next;
  vSnap = snap;
  float size = next > 0.5 ? 0.42 + 0.12 * march : 0.3;
  // a photographed spot: a mint dot that pops when its photo is taken and stays
  float pop = snap * max(0.0, 1.0 - (uTime - aSnap) * 2.2);
  size = mix(size, 0.42, snap) * (1.0 + 1.1 * pop);
  vA = mix(vA, 0.95, snap);
  float depth = max(1.0, -mvPosition.z);
  vA *= smoothstep(4.0, 12.0, depth); // not in the lens's face
  gl_PointSize = aLeg < uNext - 0.5 && snap < 0.5 ? 0.0 : min(size * uScale / depth, 22.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: /* glsl */ `
varying float vA;
varying float vNext;
varying float vSnap;
#include <fog_pars_fragment>
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  float edge = smoothstep(0.5, 0.36, r);
  vec3 c = vNext > 0.5 ? mix(vec3(1.0, 0.45, 0.04), vec3(1.0, 0.9, 0.6), smoothstep(0.3, 0.0, r)) : vec3(0.85, 0.92, 1.0);
  // photographed: mint with a white middle
  c = mix(c, mix(vec3(0.2, 0.8, 0.36), vec3(0.9, 1.0, 0.92), smoothstep(0.26, 0.0, r)), vSnap);
  gl_FragColor = vec4(c, vA * edge);
  #include <fog_fragment>
  #include <colorspace_fragment>
}`,
  });
  mat.customProgramCacheKey = () => 'drone-plan-2';
  const points3 = new THREE.Points(geo, mat);
  points3.name = 'drone-plan';
  points3.frustumCulled = false;
  points3.visible = false;
  points3.renderOrder = 3;
  const attr = geo.attributes.aSnap;
  return {
    points: points3, uniforms, count,
    // mark the dots of one leg with x in [x0, x1] photographed at time t (0 clears them all)
    snap(legI, x0, x1, t) {
      let any = false;
      for (let i = 0; i < count; i++) {
        if (t === 0) { if (snapT[i] !== 0) { snapT[i] = 0; any = true; } continue; }
        if (leg[i] !== legI || snapT[i] > 0) continue;
        const x = pos[i * 3];
        if (x < x0 || x > x1) continue;
        snapT[i] = t; any = true;
      }
      if (any) attr.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------- the drop line

// A dotted line straight down from the drone's skids to whatever is under it, the dots
// marching downwards, so the height over the pad reads at a glance when coming in to
// land. One Points draw call; the object sits at the skids and uLen is the drop in
// metres (dots past it are not drawn). uOk turns it mint when the pad is right below.
export function buildDropLine() {
  const N = 124, GAP = 0.28; // up to 34 m
  const pos = new Float32Array(N * 3);
  for (let k = 0; k < N; k++) pos[k * 3 + 1] = k; // the dot's number; the shader places it
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const uniforms = { uLen: { value: 0 }, uScale: { value: 500 }, uTime: { value: 0 }, uOk: { value: 0 }, uAlpha: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false,
    vertexShader: /* glsl */ `
uniform float uLen;
uniform float uScale;
uniform float uTime;
varying float vA;
void main() {
  float d = (position.y + fract(uTime * 1.6)) * ${GAP.toFixed(2)};
  vec4 mvPosition = modelViewMatrix * vec4(0.0, -d, 0.0, 1.0);
  float depth = max(0.5, -mvPosition.z);
  // fade in under the drone and out just above the ground
  vA = smoothstep(0.05, 0.4, d) * (1.0 - smoothstep(uLen - 0.35, uLen - 0.05, d));
  gl_PointSize = d > uLen ? 0.0 : clamp(0.1 * uScale / depth, 2.5, 9.0);
  gl_Position = projectionMatrix * mvPosition;
}`,
    fragmentShader: /* glsl */ `
uniform float uOk;
uniform float uAlpha;
varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  float edge = smoothstep(0.5, 0.3, r);
  vec3 c = mix(vec3(1.0, 0.97, 0.88), vec3(0.62, 1.0, 0.7), uOk);
  gl_FragColor = vec4(c, vA * edge * uAlpha);
  #include <colorspace_fragment>
}`,
  });
  mat.customProgramCacheKey = () => 'drone-drop-1';
  const points = new THREE.Points(geo, mat);
  points.name = 'drone-drop';
  points.frustumCulled = false;
  points.visible = false;
  points.renderOrder = 3;
  return { points, uniforms };
}

// ---------------------------------------------------------------- the soft shadow

export function buildBlob() {
  const size = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(0.55, '#e6e6e6');
  grad.addColorStop(0.8, '#777');
  grad.addColorStop(1, '#000');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.MeshBasicMaterial({
    color: '#2a2548', alphaMap: tex, transparent: true, opacity: 0.34, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20).rotateX(-Math.PI / 2), mat);
  mesh.name = 'drone-shadow';
  mesh.renderOrder = 2;
  mesh.visible = false;
  return { mesh, mat };
}
