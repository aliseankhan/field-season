// Sky dome, sun (the one shadow-casting light), hemisphere fill, fog, a few
// puffy low-poly clouds and the time of day.
//
// The day is a row of keyframes (DAY) by sky hour: a soft golden morning with a
// little mist on the water, a bright bleached noon with heat haze, a warm golden
// late afternoon and a pink-orange sunset glow, with dawn, dusk and night round
// them for ?t=. Every colour and number eases between its neighbours, so the look
// never jumps however the clock moves. The sun's direction is the real one for
// Fairchild in late October.
//
// Shadows are soft and blue-violet, never black: the sun's light in full shadow
// is not cut to zero but to a lifted share of SHADOW_TINT. This is patched into
// three.js's light chunk once, before any material compiles, so the terrain, the
// water, the vegetation, the props and the player all share it. The share, how
// much of the sun's colour the shade keeps and the width of the shadow filter change
// through the day (paler, cool lavender shade under the low gold sun of the morning
// and evening, crisper shadows at noon); all three ride on the sun's shadow.radius,
// which three's PCF soft filter does not otherwise read.

import * as THREE from 'three';
import { CONFIG } from '../config.js';

const LAT = 25.68 * Math.PI / 180; // Fairchild, Miami
const DEC = -12 * Math.PI / 180; // late October
const SOLAR_NOON = 13.1; // local daylight time

export const SHADOW_TINT = new THREE.Color('#8a90e6');
const SHADOW_LIFT = 0.36; // share of the sun kept in full shadow, tinted (the default)
const PACK = 8192; // the packed shadow radius's fraction: 256 lifts times 32 cools
const SUN_INTENSITY = 3.4;
const HEMI_INTENSITY = 1.35;

// The day's keyframes, by sky hour (the clock's 07:30 to 18:30 is sky 8.4 to 17.9,
// RULES.day.skyHours). Colours are sRGB. sun and hemi scale SUN_INTENSITY and
// HEMI_INTENSITY; lift is the share of sunlight kept in full shadow and cool how far
// that shaded share loses the sun's own colour (so a low orange sun leaves lavender
// shade, not olive); soft widens the shadow filter; cloudA is the clouds' albedo under
// the sun (low at sunset, so they keep their form instead of burning out); mist lies on
// the water, haze is the noon heat haze (and shimmer), glow the warm light round a low
// sun, dusk how far into the evening it is (the fireflies' cue); fog is [near, far] in
// metres. The warm colour stays on the sun: the fill (hemiSky, hemiGround) is kept cool
// and green at the ends of the day, so sunlit patches read gold against cool shade.
// The low-sun keys keep soft near 1: a low sun stretches the shadow texels already.
const DAY = [
  { h: 4.5, top: '#0d1a30', horizon: '#27385a', fog: '#34466a', sun: '#ffb070', sunI: 0, hemiSky: '#34476e', hemiGround: '#2c3a38', hemiI: 0.46, cloud: '#3a4468', cloudI: 0.3, cloudA: 1, lift: 0.5, cool: 0.3, soft: 1.6, mist: 0.5, haze: 0, glow: 0, dusk: 1, fog0: 60, fog1: 360 },
  { h: 6.5, top: '#35477e', horizon: '#c9a0b4', fog: '#8e8aa8', sun: '#ff9a70', sunI: 0.2, hemiSky: '#6c70a8', hemiGround: '#5a6a58', hemiI: 0.63, cloud: '#c89cb4', cloudI: 0.55, cloudA: 0.8, lift: 0.52, cool: 0.6, soft: 1.3, mist: 1, haze: 0, glow: 0.6, dusk: 0.6, fog0: 45, fog1: 340 },
  { h: 7.4, top: '#6c8cc8', horizon: '#f8c4a2', fog: '#e8cdb8', sun: '#ffa868', sunI: 0.75, hemiSky: '#b4b0e0', hemiGround: '#8ca46c', hemiI: 0.95, cloud: '#ffc8b0', cloudI: 0.62, cloudA: 0.8, lift: 0.46, cool: 0.55, soft: 1.1, mist: 1, haze: 0, glow: 0.8, dusk: 0, fog0: 38, fog1: 350 },
  // 07:30, the survey day opens: soft gold sun, cool lavender shade, long shadows, a
  // peach haze in the middle distance and mist on the water
  { h: 8.4, top: '#86b2e2', horizon: '#fcdab2', fog: '#f1dcc4', sun: '#ffc682', sunI: 1.05, hemiSky: '#bebcf0', hemiGround: '#96ba76', hemiI: 1.2, cloud: '#ffdcc2', cloudI: 0.66, cloudA: 0.9, lift: 0.42, cool: 0.5, soft: 1.1, mist: 1, haze: 0, glow: 0.45, dusk: 0, fog0: 40, fog1: 380 },
  { h: 9.6, top: '#7abaec', horizon: '#fde8d0', fog: '#eaeddc', sun: '#ffdcaa', sunI: 1.04, hemiSky: '#bcc4f2', hemiGround: '#9ec27a', hemiI: 1.06, cloud: '#f2def0', cloudI: 0.64, cloudA: 1, lift: 0.39, cool: 0.25, soft: 1.08, mist: 0.3, haze: 0, glow: 0.15, dusk: 0, fog0: 70, fog1: 480 },
  // late morning: the game's familiar bright day
  { h: 11.2, top: '#74bff0', horizon: '#fbeede', fog: '#ebefe1', sun: '#ffe8c2', sunI: 1, hemiSky: '#b8c2f4', hemiGround: '#a8c67c', hemiI: 1, cloud: '#e9def6', cloudI: 0.62, cloudA: 1, lift: 0.36, cool: 0, soft: 1.05, mist: 0, haze: 0.35, glow: 0, dusk: 0, fog0: 90, fog1: 520 },
  // noon: a deeper blue overhead, a pale bleached horizon, short crisp shadows, heat haze
  { h: 13.1, top: '#64b4f2', horizon: '#f5f3e6', fog: '#e9f0e6', sun: '#fff2d8', sunI: 1.06, hemiSky: '#c2cef6', hemiGround: '#b2cc84', hemiI: 0.98, cloud: '#efeaf8', cloudI: 0.66, cloudA: 1, lift: 0.33, cool: 0, soft: 1, mist: 0, haze: 1, glow: 0, dusk: 0, fog0: 84, fog1: 470 },
  { h: 14.8, top: '#6fb8ee', horizon: '#fcecd6', fog: '#e8eedc', sun: '#ffe6bc', sunI: 1.02, hemiSky: '#bcc4f2', hemiGround: '#aec67c', hemiI: 1, cloud: '#eee0f2', cloudI: 0.63, cloudA: 1, lift: 0.36, cool: 0, soft: 1.05, mist: 0, haze: 0.65, glow: 0, dusk: 0, fog0: 88, fog1: 500 },
  // the warm golden late afternoon
  { h: 16.3, top: '#79aee4', horizon: '#fcdaae', fog: '#f0dfc6', sun: '#ffc88a', sunI: 1.0, hemiSky: '#c0bef0', hemiGround: '#9cbc78', hemiI: 1.04, cloud: '#ffe0c4', cloudI: 0.64, cloudA: 0.9, lift: 0.38, cool: 0.35, soft: 1.1, mist: 0, haze: 0.1, glow: 0.35, dusk: 0, fog0: 64, fog1: 460 },
  { h: 17.3, top: '#7c9fd8', horizon: '#f6c498', fog: '#f3d2b4', sun: '#ffaf66', sunI: 1.0, hemiSky: '#bcb6ee', hemiGround: '#94b474', hemiI: 1.08, cloud: '#ffc6b2', cloudI: 0.74, cloudA: 0.78, lift: 0.38, cool: 0.55, soft: 1.05, mist: 0, haze: 0, glow: 0.7, dusk: 0.25, fog0: 42, fog1: 360 },
  // 18:30, the end of the day: a pink-orange sunset glow, the sun low and soft, the
  // shade lavender and the lawn still green, so the fireflies show
  { h: 17.9, top: '#7a8bcc', horizon: '#f2a890', fog: '#f0c0aa', sun: '#ff9460', sunI: 0.75, hemiSky: '#b8b2ec', hemiGround: '#8cae6c', hemiI: 0.95, cloud: '#ffc0b0', cloudI: 0.8, cloudA: 0.75, lift: 0.34, cool: 0.75, soft: 1.05, mist: 0.2, haze: 0, glow: 1, dusk: 0.75, fog0: 38, fog1: 320 },
  { h: 18.7, top: '#50609e', horizon: '#e8907e', fog: '#b890a0', sun: '#ff7e58', sunI: 0.3, hemiSky: '#9486bc', hemiGround: '#62725c', hemiI: 0.76, cloud: '#e8909a', cloudI: 0.6, cloudA: 0.7, lift: 0.5, cool: 0.75, soft: 1.3, mist: 0.6, haze: 0, glow: 0.8, dusk: 1, fog0: 45, fog1: 350 },
  { h: 19.5, top: '#1e2c52', horizon: '#5a5a86', fog: '#4a5478', sun: '#ff9a70', sunI: 0, hemiSky: '#46558a', hemiGround: '#343e40', hemiI: 0.5, cloud: '#4c5278', cloudI: 0.4, cloudA: 1, lift: 0.5, cool: 0.5, soft: 1.6, mist: 0.6, haze: 0, glow: 0.15, dusk: 1, fog0: 60, fog1: 360 },
  { h: 20.5, top: '#0d1a30', horizon: '#27385a', fog: '#34466a', sun: '#ffb070', sunI: 0, hemiSky: '#34476e', hemiGround: '#2c3a38', hemiI: 0.46, cloud: '#3a4468', cloudI: 0.3, cloudA: 1, lift: 0.5, cool: 0.3, soft: 1.6, mist: 0.5, haze: 0, glow: 0, dusk: 1, fog0: 60, fog1: 360 },
];
const COLOUR_KEYS = ['top', 'horizon', 'fog', 'sun', 'hemiSky', 'hemiGround', 'cloud'];
const NUMBER_KEYS = ['sunI', 'hemiI', 'cloudI', 'cloudA', 'lift', 'cool', 'soft', 'mist', 'haze', 'glow', 'dusk', 'fog0', 'fog1'];
const GLOW_COLOUR = '#f29a7e'; // the sunset's pink-orange, added round the low sun (red kept under 255)

const smooth = (e0, e1, v) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// Directional shadows lift to a tinted share of the light instead of black, and the
// PCF soft filter widens by a factor. In the shade the sun's own colour can also be
// washed out towards grey first (cool), so a low orange sun leaves lavender shade on
// the green lawn rather than olive. All three come packed in the light's shadowRadius
// (see packShadow): a radius under 1.5 (a plain light, as in the galleries) keeps
// the defaults.
function installShadowTint() {
  const C = THREE.ShaderChunk;
  const src = C.lights_fragment_begin;
  if (src.includes('shadow tint lift')) return true;
  const t = SHADOW_TINT;
  const lum = 0.2126 * t.r + 0.7152 * t.g + 0.0722 * t.b;
  const v = [t.r, t.g, t.b].map((c) => (c / lum).toFixed(4));
  const find = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
  if (!src.includes(find)) {
    console.warn('sky.js: three.js light chunk changed; shadows keep their plain colour');
    return false;
  }
  const repl = `// shadow tint lift
		float shPack = floor( fract( directionalLightShadow.shadowRadius ) * ${PACK.toFixed(1)} + 0.5 );
		float shLift = directionalLightShadow.shadowRadius > 1.5 ? floor( shPack / 32.0 ) / 255.0 : ${SHADOW_LIFT.toFixed(3)};
		float shCool = directionalLightShadow.shadowRadius > 1.5 ? ( shPack - 32.0 * floor( shPack / 32.0 ) ) / 31.0 : 0.0;
		vec3 shLit = directLight.color;
		vec3 shShade = mix( shLit, vec3( dot( shLit, vec3( 0.2126, 0.7152, 0.0722 ) ) ), shCool ) * vec3( ${v.join(', ')} ) * shLift;
		directLight.color = mix( shShade, shLit, ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0 );`;
  C.lights_fragment_begin = src.replace(find, repl);

  // the soft filter on a grid shSoft texels apart
  const pars = C.shadowmap_pars_fragment;
  const soft0 = `vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx = texelSize.x;
			float dy = texelSize.y;
			vec2 uv = shadowCoord.xy;
			vec2 f = fract( uv * shadowMapSize + 0.5 );
			uv -= f * texelSize;`;
  const i = pars.indexOf('SHADOWMAP_TYPE_PCF_SOFT');
  const j = i >= 0 ? pars.indexOf(soft0, i) : -1;
  if (j < 0) {
    console.warn('sky.js: three.js shadow chunk changed; shadows keep one softness');
  } else {
    const soft1 = `float shSoft = shadowRadius > 1.5 ? floor( shadowRadius ) / 20.0 : 1.0;
			vec2 texelSize = vec2( shSoft ) / shadowMapSize;
			float dx = texelSize.x;
			float dy = texelSize.y;
			vec2 uv = shadowCoord.xy;
			vec2 f = fract( uv * shadowMapSize / shSoft + 0.5 );
			uv -= f * texelSize;`;
    C.shadowmap_pars_fragment = pars.slice(0, j) + soft1 + pars.slice(j + soft0.length);
  }
  return true;
}
const tintInstalled = installShadowTint();

// soft in [1, 3] in the whole part (in 1/20ths), lift (in 1/255ths) and cool (in
// 1/31sts) in the fraction: the radius the patched chunks decode
const packShadow = (lift, soft, cool = 0) => {
  const L = Math.round(Math.min(1, Math.max(0, lift)) * 255), K = Math.round(Math.min(1, Math.max(0, cool)) * 31);
  return Math.floor(Math.min(3, Math.max(1, soft)) * 20) + (L * 32 + K) / PACK;
};

// Unit vector towards the sun in the game frame (x east, y up, z south).
export function sunDirection(hours, out = new THREE.Vector3()) {
  const H = (hours - SOLAR_NOON) * 15 * Math.PI / 180;
  const east = -Math.cos(DEC) * Math.sin(H);
  const north = Math.cos(LAT) * Math.sin(DEC) - Math.sin(LAT) * Math.cos(DEC) * Math.cos(H);
  const up = Math.sin(LAT) * Math.sin(DEC) + Math.cos(LAT) * Math.cos(DEC) * Math.cos(H);
  return out.set(east, up, -north).normalize();
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uGlowColor;
uniform float uSunVis;
uniform float uGlow;
uniform float uHaze;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uTop, pow(smoothstep(-0.03, 0.62, h), 0.72));
  // A warm glow along the horizon, strongest towards a low sun (the sunset).
  vec2 dh = normalize(d.xz + vec2(1e-5, 0.0));
  vec2 sh = normalize(uSunDir.xz + vec2(1e-5, 0.0));
  float az = max(dot(dh, sh), 0.0);
  float low = 1.0 - smoothstep(-0.02, 0.4, h);
  col = mix(col, uGlowColor, uGlow * low * low * (0.22 + 0.78 * az * az * az) * 0.75);
  // Noon's heat haze: a pale, bleached band on the horizon.
  col = mix(col, uHorizon + vec3(0.03), uHaze * (1.0 - smoothstep(0.0, 0.1, h)) * 0.5);
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 10.0) * (0.14 + 0.16 * uGlow) + pow(sd, 90.0) * 0.3) * uSunVis;
  // With the sun low, a soft shoulder keeps the glow round it from burning out to flat
  // red: channels ease towards 1 instead of clipping (off at noon, where uGlow is 0).
  vec3 over = max(col - 0.75, 0.0);
  col = mix(col, min(col, 0.75) + 0.25 * (1.0 - exp(-over / 0.25)), uGlow);
  col = mix(col, vec3(1.0, 0.97, 0.86) * 1.15, smoothstep(0.9993, 0.9996, sd) * uSunVis);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // a whisper of dither so the long sunset gradient never bands
  gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
}
`;

// Puffy clouds: 22 of them, each a row of round puffs with a flat-ish base, in a
// ring 220 to 520 m out and 55 to 110 m up, so some show from the path camera.
function makeClouds(rand, emissive) {
  const puff = new THREE.IcosahedronGeometry(1, 2); // smooth normals at detail 2
  puff.deleteAttribute('uv');
  const mat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    emissive,
    emissiveIntensity: 0.62,
    fog: false,
  });
  // Clouds see the sky all round: their undersides take the sky's colour, a little
  // dimmer, instead of the ground's, so a sunset cloud stays pink underneath rather
  // than going the lawn's grey-green.
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_pars_begin>', `#include <lights_pars_begin>
vec3 cloudHemi( const in HemisphereLight hemiLight, const in vec3 normal ) {
  return hemiLight.skyColor * ( 0.86 + 0.14 * dot( normal, hemiLight.direction ) );
}`)
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin
        .replace('getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal )', 'cloudHemi( hemisphereLights[ i ], geometryNormal )'));
  };
  const matrices = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const e = new THREE.Euler();
  const nClouds = 22;
  for (let k = 0; k < nClouds; k++) {
    const ang = (k / nClouds) * Math.PI * 2 + (rand() - 0.5) * 0.25;
    const dist = 220 + rand() * 300;
    const cx = 10 + Math.cos(ang) * dist, cz = Math.sin(ang) * dist;
    const cy = 55 + rand() * 55;
    const size = 9 + rand() * 11;
    const n = 4 + Math.floor(rand() * 4);
    const along = ang + Math.PI / 2 + (rand() - 0.5) * 0.8;
    for (let i = 0; i < n; i++) {
      const u = (i / (n - 1) - 0.5) * 2;
      const r = size * (0.5 + 0.5 * (1 - u * u)) * (0.85 + rand() * 0.3);
      p.set(cx + Math.cos(along) * u * size * 1.25, cy + r * 0.32, cz + Math.sin(along) * u * size * 1.25);
      s.set(r * 1.15, r * 0.8, r);
      q.setFromEuler(e.set(0, rand() * 6.28, 0));
      matrices.push(m.compose(p, q, s).clone());
    }
    // A wide flat base puff so the underside reads as one soft shelf.
    p.set(cx, cy + size * 0.05, cz);
    s.set(size * 1.9, size * 0.3, size * 0.9);
    q.setFromEuler(e.set(0, -along, 0));
    matrices.push(m.compose(p, q, s).clone());
  }
  const mesh = new THREE.InstancedMesh(puff, mat, matrices.length);
  matrices.forEach((mm, i) => mesh.setMatrixAt(i, mm));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = 'clouds';
  return mesh;
}

export function buildSky({ scene }) {
  // The keyframes as flat numbers, colours converted once (linear, for lerping): per
  // key the seven colours' rgb, then the numbers in NUMBER_KEYS order. Blending runs
  // over these in index loops and writes the result into look's fixed fields, so a
  // frame's re-blend (the clock moves the sky every frame) allocates nothing.
  const NC = COLOUR_KEYS.length, NN = NUMBER_KEYS.length, W = NC * 3 + NN;
  const keyH = new Float64Array(DAY.length), keyV = new Float64Array(DAY.length * W);
  const tmpC = new THREE.Color();
  DAY.forEach((k, i) => {
    keyH[i] = k.h;
    COLOUR_KEYS.forEach((c, j) => { tmpC.set(k[c]); keyV[i * W + j * 3] = tmpC.r; keyV[i * W + j * 3 + 1] = tmpC.g; keyV[i * W + j * 3 + 2] = tmpC.b; });
    NUMBER_KEYS.forEach((nm, j) => { keyV[i * W + NC * 3 + j] = k[nm]; });
  });
  const blend = new Float64Array(W);
  // the current blend (read-only for others), in COLOUR_KEYS and NUMBER_KEYS order
  const look = {
    h: 0,
    top: new THREE.Color(), horizon: new THREE.Color(), fog: new THREE.Color(), sun: new THREE.Color(),
    hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), cloud: new THREE.Color(),
    sunI: 0, hemiI: 0, cloudI: 0, cloudA: 0, lift: 0, cool: 0, soft: 0, mist: 0, haze: 0, glow: 0, dusk: 0, fog0: 0, fog1: 0,
  };
  const lookColours = [look.top, look.horizon, look.fog, look.sun, look.hemiSky, look.hemiGround, look.cloud];

  // Blends the two keyframes either side of the sky hour, eased (smoothstep), so
  // each value glides from key to key with no kink or jump; the list wraps round
  // midnight.
  function blendDay(hours) {
    const n = keyH.length;
    let ia = n - 1, ib = 0, t0 = keyH[n - 1] - 24, t1 = keyH[0];
    const h = hours;
    if (h >= keyH[0] && h < keyH[n - 1]) {
      for (let i = 0; i < n - 1; i++) {
        if (h >= keyH[i] && h < keyH[i + 1]) { ia = i; ib = i + 1; t0 = keyH[i]; t1 = keyH[i + 1]; break; }
      }
    } else if (h >= keyH[n - 1]) {
      t1 = keyH[0] + 24; t0 = keyH[n - 1]; // after the last key: on towards the first, tomorrow
    }
    const u = smooth(0, 1, (h - t0) / (t1 - t0));
    const oa = ia * W, ob = ib * W;
    for (let k = 0; k < W; k++) blend[k] = keyV[oa + k] + (keyV[ob + k] - keyV[oa + k]) * u;
    for (let j = 0; j < NC; j++) { const c = lookColours[j]; c.r = blend[j * 3]; c.g = blend[j * 3 + 1]; c.b = blend[j * 3 + 2]; }
    const o = NC * 3;
    look.sunI = blend[o]; look.hemiI = blend[o + 1]; look.cloudI = blend[o + 2]; look.cloudA = blend[o + 3];
    look.lift = blend[o + 4]; look.cool = blend[o + 5]; look.soft = blend[o + 6]; look.mist = blend[o + 7];
    look.haze = blend[o + 8]; look.glow = blend[o + 9]; look.dusk = blend[o + 10]; look.fog0 = blend[o + 11]; look.fog1 = blend[o + 12];
    look.h = hours;
    return look;
  }

  const group = new THREE.Group();
  group.name = 'sky';

  const domeUniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3() },
    uSunColor: { value: new THREE.Color() },
    uGlowColor: { value: new THREE.Color(GLOW_COLOUR) },
    uSunVis: { value: 1 },
    uGlow: { value: 0 },
    uHaze: { value: 0 },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1000, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: domeUniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    }),
  );
  dome.name = 'sky-dome';
  dome.renderOrder = -1000;
  dome.frustumCulled = false;
  group.add(dome);

  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const clouds = makeClouds(rand, new THREE.Color('#e9def6'));
  const cloudPivot = new THREE.Group();
  cloudPivot.add(clouds);
  group.add(cloudPivot);

  const sun = new THREE.DirectionalLight(0xffffff, SUN_INTENSITY);
  sun.name = 'sun';
  sun.castShadow = true;
  sun.shadow.mapSize.set(CONFIG.shadowMapSize, CONFIG.shadowMapSize);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = packShadow(SHADOW_LIFT, 1);
  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, HEMI_INTENSITY);
  hemi.name = 'hemisphere';
  scene.add(sun, sun.target, hemi);

  const fog = new THREE.Fog(new THREE.Color('#e4efe2'), CONFIG.fog.near, CONFIG.fog.far);
  scene.fog = fog;
  scene.add(group);

  const state = {
    hours: 10.5,
    top: new THREE.Color(),
    horizon: new THREE.Color(),
    sunDir: new THREE.Vector3(0, 1, 0),
    sunColor: new THREE.Color(),
    elevation: 0,
    // atmosphere for the water and the effects, 0..1
    mist: 0, // morning mist on the water
    haze: 0, // noon heat haze and shimmer
    glow: 0, // the warm light round a low sun
    dusk: 0, // how far into the evening (fireflies)
    fogColor: fog.color,
    look, // the blended keyframe (read-only)
  };

  // Fit the orthographic shadow camera tightly around a world box.
  const box = CONFIG.shadowBox;
  const centre = new THREE.Vector3((box.xmin + box.xmax) / 2, 0, (box.zmin + box.zmax) / 2);
  const probe = new THREE.OrthographicCamera();
  const lightDir = new THREE.Vector3();
  const corner = new THREE.Vector3();
  function fitShadow(d) {
    sun.position.copy(centre).addScaledVector(d, 200);
    sun.target.position.copy(centre);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
    probe.position.copy(sun.position);
    probe.lookAt(centre);
    probe.updateMatrixWorld();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? box.xmax : box.xmin, i & 2 ? box.ymax : box.ymin, i & 4 ? box.zmax : box.zmin);
      corner.applyMatrix4(probe.matrixWorldInverse);
      x0 = Math.min(x0, corner.x); x1 = Math.max(x1, corner.x);
      y0 = Math.min(y0, corner.y); y1 = Math.max(y1, corner.y);
      z0 = Math.min(z0, corner.z); z1 = Math.max(z1, corner.z);
    }
    const cam = sun.shadow.camera;
    cam.left = x0; cam.right = x1; cam.bottom = y0; cam.top = y1;
    cam.near = Math.max(0.5, -z1 - 5);
    cam.far = -z0 + 5;
    cam.updateProjectionMatrix();
    sun.shadow.needsUpdate = true;
  }

  // hours: the sky hour for the keyframes, or null (setSun) to key the look on the
  // sun's height alone (as a late-morning day)
  function applySun(dir, hours) {
    state.sunDir.copy(dir);
    const el = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    state.elevation = el;
    const deg = el * 180 / Math.PI;
    const L = blendDay(hours ?? 11.2);

    state.top.copy(L.top);
    state.horizon.copy(L.horizon);
    state.sunColor.copy(L.sun);
    state.mist = L.mist; state.haze = L.haze; state.glow = L.glow; state.dusk = L.dusk;

    domeUniforms.uTop.value.copy(state.top);
    domeUniforms.uHorizon.value.copy(state.horizon);
    domeUniforms.uSunDir.value.copy(dir);
    domeUniforms.uSunColor.value.copy(state.sunColor);
    domeUniforms.uSunVis.value = smooth(-3, 2, deg);
    domeUniforms.uGlow.value = L.glow * smooth(-6, 1, deg);
    domeUniforms.uHaze.value = L.haze;

    // The fog melts the tree line into the horizon without a seam.
    fog.color.copy(L.fog);
    fog.near = L.fog0; fog.far = L.fog1;

    // The shadow light stays above the horizon so it never lights from below.
    sun.color.copy(state.sunColor);
    sun.intensity = SUN_INTENSITY * L.sunI * smooth(-1.5, 6, deg);
    sun.shadow.radius = packShadow(L.lift, L.soft, L.cool);
    hemi.color.copy(L.hemiSky);
    hemi.groundColor.copy(L.hemiGround);
    hemi.intensity = HEMI_INTENSITY * L.hemiI;
    clouds.material.emissive.copy(L.cloud);
    clouds.material.emissiveIntensity = L.cloudI;
    clouds.material.color.setScalar(L.cloudA);
    lightDir.copy(dir);
    if (lightDir.y < 0.12) lightDir.setY(0.12).normalize();
    fitShadow(lightDir);
  }

  const tmpDir = new THREE.Vector3();
  // The clock moves the sky every frame; the look is re-blended only once the sky
  // hour has moved on by STEP (a few seconds of sky time, 0.015 degrees of sun), so
  // most frames do nothing here.
  const STEP = 0.001;
  let applied = NaN;
  return {
    group,
    sun,
    hemi,
    fog,
    dome,
    clouds,
    state,
    shadowTint: tintInstalled,
    // The time of day in hours and the sun's height (sin of its elevation), for the
    // wildlife's sun and shade.
    get hours() { return state.hours; },
    get sunHeight() { return state.sunDir.y; },
    setTimeOfDay(hours) {
      state.hours = ((hours % 24) + 24) % 24;
      if (Math.abs(state.hours - applied) < STEP) return;
      applied = state.hours;
      applySun(sunDirection(state.hours, tmpDir), state.hours);
    },
    // Direct control, used by ?view=top (sun high, from the south-east).
    setSun(elevationDeg, azimuthDeg) {
      const el = elevationDeg * Math.PI / 180, az = azimuthDeg * Math.PI / 180;
      tmpDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
      applied = NaN;
      applySun(tmpDir, null);
    },
    update(dt, t, camera) {
      if (camera) dome.position.copy(camera.position);
      cloudPivot.rotation.y = t * 0.002;
    },
  };
}
