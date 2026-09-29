// Grass: chunky instanced tufts round the camera, and a painted grass pattern
// on the ground itself.
//
// Tufts. One draw call. A square of tuft slots (a jittered lattice) follows the
// camera and wraps round, so each spot of ground always maps to the same slot
// and the same random numbers: nothing shimmers as the camera moves. The vertex
// shader places each tuft on the height grid and reads a density, a height and
// the ground colour from three small textures baked here from the terrain's own
// fields. Tufts are dense on the open lawn and the far banks, short and sparse on
// the worn paths, thin in the shade, and absent in the thicket, water and mud.
// Far tufts shrink into the ground (the fade is well inside the square, so its
// wrapping edge is never seen). They sway with the vegetation's wind time, roll
// in gentle gusts, and part round the player's feet. They receive shadows but
// do not cast them.
//
// Ground. The terrain material gets a world-space pattern: soft colour patches
// at two sizes, brush dabs laid across the view, and little blade ticks at two
// sizes (big ones for the middle distance and views from above, small ones near
// the camera), all in a few flat tones. Each layer fades out once it would be
// smaller than a pixel, so the lawn stays calm at any distance. It follows a
// per-vertex grass cover, so the paths, mud and litter stay smooth.

import * as THREE from 'three';
import { vegUniforms } from './wind.js';

export const GRASS = {
  tile: 64, // m, side of the square of slots round the camera
  spacing: 0.34, // m between slots (at most about 8.6 tufts per square metre)
  width: 0.32, // m across a full-size tuft
  height: 0.23, // m tall at tallness 1
  fade: [13, 30], // m from the camera; moves out when the camera zooms out
  lead: 12, // m the square sits ahead of the camera
  push: 0.8, // m, radius round the player's feet where the blades part
  wind: [-0.9, 0.42], // gust direction on the ground (x, z)
};

const smooth = (e0, e1, v) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function hash2(ix, iz) {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  let fx = x - ix, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

// ---------------------------------------------------------------- fields

// Per cell of the terrain grid: tuft density, tallness and the ground pattern's
// cover, from the terrain fields (distance to water and thicket, blurred canopy,
// paths, litter and the fake occlusion round trunks).
function grassFields(data, f) {
  const T = data.terrain;
  const { cols, rows, mask, bits } = T;
  const n = cols * rows;
  const field = new Uint8Array(n * 4); // density, tallness / 1.5, cover, path
  const cover = new Float32Array(n);
  const land = bits.island | bits.causeway | bits.bank;
  let dLawn = 0, nLawn = 0; // open lawn: walkable, no canopy, off the paths
  for (let r = 0; r < rows; r++) {
    const z = T.zOf(r);
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const m = mask[i];
      if ((m & bits.water) || !(m & land)) continue;
      const x = T.xOf(c);
      const bank = (m & bits.bank) !== 0;
      const dW = f.toWater[i];
      const pm = f.path ? f.path[i] : 0;
      const lit = f.litter ? f.litter[i] : 0;
      const ao = f.ao ? f.ao[i] : 0;
      const shade = smooth(1.5, 4.5, f.canopy[i]);
      const clear = m & bits.thicket ? 0 : smooth(0.05, 0.7, f.thicketDist[i]);
      const clump = noise(x * 0.3 + 5.1, z * 0.3 - 2.3); // patches about 3 m across
      const fine = noise(x * 0.9 - 7.7, z * 0.9 + 3.3);

      let d = (bank ? 0.95 : 1) * smooth(0.95, 1.6, dW) * clear;
      d *= 1 - 0.88 * pm;
      d *= 1 - 0.72 * shade;
      d *= 1 - 0.85 * lit;
      d *= Math.max(0.3, 1 - 2.4 * ao);
      d *= (0.5 + 0.5 * smooth(0.18, 0.62, clump)) * (0.82 + 0.18 * fine);

      const tall = (bank ? 1.1 : 1) * (1 - 0.5 * pm) * (1 - 0.3 * shade) *
        (0.8 + 0.2 * smooth(0.95, 2.4, dW)) * (0.82 + 0.36 * fine);
      const cv = smooth(0.8, 1.4, dW) * (1 - pm) * (1 - 0.8 * lit) * (m & bits.thicket ? 0.5 : 1);

      field[i * 4] = Math.round(255 * Math.min(1, d));
      field[i * 4 + 1] = Math.round(255 * Math.min(1, tall / 1.5));
      field[i * 4 + 2] = Math.round(255 * cv);
      field[i * 4 + 3] = Math.round(255 * pm);
      cover[i] = cv;
      if ((m & bits.walkable) && f.canopy[i] < 1 && pm < 0.1) { dLawn += d; nLawn++; }
    }
  }
  return { field, cover, lawnDensity: nLawn ? dLawn / nLawn : 0 };
}

// The painted ground colour at 0.5 m, sRGB in bytes, for tinting the tufts.
// Lake samples are never read (tufts stand at least 0.95 m from the water), so
// they are not painted.
function groundColours(data, paint) {
  const T = data.terrain;
  const cols2 = Math.ceil(T.cols / 2), rows2 = Math.ceil(T.rows / 2);
  const out = new Uint8Array(cols2 * rows2 * 4);
  const c3 = new THREE.Color();
  const fallback = new THREE.Color('#8fcc58');
  for (let r2 = 0; r2 < rows2; r2++) {
    const r = Math.min(T.rows - 1, r2 * 2);
    for (let c2 = 0; c2 < cols2; c2++) {
      const c = Math.min(T.cols - 1, c2 * 2);
      const i = r * T.cols + c;
      if (paint && !(T.mask[i] & T.bits.water)) paint(c3, T.xOf(c), T.zOf(r), T.height[i], i);
      else c3.copy(fallback);
      c3.convertLinearToSRGB();
      const k = (r2 * cols2 + c2) * 4;
      out[k] = Math.round(255 * Math.min(1, c3.r));
      out[k + 1] = Math.round(255 * Math.min(1, c3.g));
      out[k + 2] = Math.round(255 * Math.min(1, c3.b));
      out[k + 3] = 255;
    }
  }
  return { bytes: out, cols2, rows2 };
}

function dataTexture(arr, w, h, format, type, linear) {
  const tex = new THREE.DataTexture(arr, w, h, format, type);
  tex.minFilter = tex.magFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------- tuft

// Unit tuft, 1 tall and about 1 across: five single-triangle blades fanning out
// from the middle. aBlade.x is 0 at a blade's base and 1 at its tip; aBlade.y
// orders the blades, so the shader can drop the last two for three-blade tufts.
// Normals lean mostly up, so the tufts shade like the lawn they grow from.
function tuftGeometry() {
  const BLADES = [
    // azimuth, lean (rad), height, half-width at the base
    [0.2, 0.14, 1.0, 0.15],
    [1.5, 0.45, 0.8, 0.14],
    [2.75, 0.36, 0.88, 0.15],
    [4.05, 0.52, 0.68, 0.13],
    [5.25, 0.42, 0.76, 0.14],
  ];
  const pos = [], nor = [], blade = [];
  BLADES.forEach(([az, lean, h, w], k) => {
    const ox = Math.cos(az), oz = Math.sin(az); // outwards
    const tx = -oz, tz = ox; // across the blade
    // Turn the blade a little off the radial, so it shows some face from any side.
    const tw = 0.5;
    const ax = tx * Math.cos(tw) + ox * Math.sin(tw), az2 = tz * Math.cos(tw) + oz * Math.sin(tw);
    const bx = ox * 0.06, bz = oz * 0.06;
    const tip = [bx + ox * Math.sin(lean) * h * 0.55, h * Math.cos(lean), bz + oz * Math.sin(lean) * h * 0.55];
    const verts = [[bx - ax * w, 0, bz - az2 * w], [bx + ax * w, 0, bz + az2 * w], tip];
    const nv = new THREE.Vector3(ox * 0.35, 1, oz * 0.35).normalize();
    verts.forEach((v, j) => {
      pos.push(v[0], v[1], v[2]);
      nor.push(nv.x, nv.y, nv.z);
      blade.push(j === 2 ? 1 : 0, k / BLADES.length);
    });
  });
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aBlade', new THREE.Float32BufferAttribute(blade, 2));
  return g;
}

// ---------------------------------------------------------------- shaders

const TUFT_VERT_HEAD = /* glsl */ `
attribute vec3 aSlot;
attribute vec2 aBlade;
uniform sampler2D uGHeight;
uniform sampler2D uGField;
uniform sampler2D uGColour;
uniform vec4 uGGrid;     // x0, z0, 1 / cell, 0
uniform vec4 uGSize;     // cols, rows, colour cols, colour rows
uniform vec3 uGCentre;   // square centre x, z, and its side
uniform vec4 uGFade;     // start, end, tuft width, tuft height
uniform vec4 uGPlayer;   // feet x, y, z, push radius
uniform vec2 uGWindDir;
uniform vec3 uGLawn;     // tint for the few tufts on the paths
uniform float uVegTime;
uniform float uVegWind;
varying vec3 vGCol;

uint gHash( uint x ) {
  x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16;
  return x;
}
float gRand( uint s ) { return float( gHash( s ) & 0xffffffu ) / 16777216.0; }

// Bilinear on the cell-centre lattice, as data.js heightAt does.
float gHeightAt( vec2 f ) {
  f = clamp( f, vec2( 0.0 ), uGSize.xy - 1.0 );
  vec2 c = min( floor( f ), uGSize.xy - 2.0 );
  vec2 t = f - c;
  ivec2 ic = ivec2( c );
  float a = texelFetch( uGHeight, ic, 0 ).r;
  float b = texelFetch( uGHeight, ic + ivec2( 1, 0 ), 0 ).r;
  float d = texelFetch( uGHeight, ic + ivec2( 0, 1 ), 0 ).r;
  float e = texelFetch( uGHeight, ic + ivec2( 1, 1 ), 0 ).r;
  return mix( mix( a, b, t.x ), mix( d, e, t.x ), t.y );
}
`;

// Runs straight after beginnormal_vertex: works out where this tuft stands.
const TUFT_VERT_SETUP = /* glsl */ `
vec2 gK = floor( ( uGCentre.xy - aSlot.xy ) / uGCentre.z + 0.5 );
vec2 gP = aSlot.xy + gK * uGCentre.z;
uint gSeed = uint( gl_InstanceID ) * 2654435761u ^ uint( int( gK.x ) + 4096 ) * 40503u ^ uint( int( gK.y ) + 4096 ) * 2246822519u;
float gR1 = gRand( gSeed ), gR2 = gRand( gSeed + 1u ), gR3 = gRand( gSeed + 2u ), gR4 = gRand( gSeed + 3u );
vec2 gF = ( gP - uGGrid.xy ) * uGGrid.z;
float gIn = step( 0.0, gF.x ) * step( 0.0, gF.y ) * step( gF.x, uGSize.x - 1.0 ) * step( gF.y, uGSize.y - 1.0 );
vec4 gField = texture( uGField, ( gF + 0.5 ) / uGSize.xy );
float gY = gHeightAt( gF );
float gDist = distance( cameraPosition, vec3( gP.x, gY, gP.y ) );
float gNear = 1.0 - smoothstep( uGFade.x, uGFade.y, gDist + ( gR4 - 0.5 ) * 7.0 );
float gS = smoothstep( gR1, gR1 + 0.1, gField.r ) * gNear * gIn;
// Three-blade tufts drop their last two blades.
float gOn = step( aBlade.y, mix( 0.5, 1.0, step( 0.4, gR3 ) ) );
float gYaw = gR2 * 6.2831853 + gR3 * 17.0;
float gc = cos( gYaw ), gs = sin( gYaw );
mat2 gRot = mat2( gc, gs, -gs, gc );
objectNormal.xz = gRot * objectNormal.xz;
`;

// Replaces begin_vertex: the blade vertex in world space (the mesh has no transform).
const TUFT_VERT_PLACE = /* glsl */ `
float gH = gS * gOn * gField.g * 1.5 * uGFade.w * ( 0.72 + 0.56 * gR4 );
float gW = gOn * uGFade.z * ( 0.8 + 0.4 * gR1 ) * mix( 0.5, 1.0, gS );
// Each blade of each tuft gets its own height, so no two tufts look alike.
float gBh = 0.75 + 0.5 * fract( gR4 * 7.31 + gR1 * 3.17 + aBlade.y * 2.93 );
vec2 gXZ = gRot * position.xz * mix( 1.0, gBh, aBlade.x );
vec3 transformed = vec3( gP.x + gXZ.x * gW, gY - 0.03 + position.y * gH * gBh, gP.y + gXZ.y * gW );
float gTip = aBlade.x * aBlade.x;
// Wind: a steady lean and slow gusts rolling across the lawn, plus a small flutter.
float gWave = 0.5 + 0.5 * sin( uVegTime * 1.15 - dot( gP, uGWindDir ) * 0.5 + 0.9 * sin( dot( gP, vec2( uGWindDir.y, -uGWindDir.x ) ) * 0.15 ) );
float gFl = sin( uVegTime * 2.7 + gR2 * 6.2831853 + aBlade.y * 4.0 );
vec2 gWind = uGWindDir * ( 0.05 + 0.2 * gWave * gWave ) + vec2( uGWindDir.y, -uGWindDir.x ) * gFl * 0.04;
transformed.xz += gWind * uVegWind * gTip * gH * 1.6;
// The player's feet part the blades.
vec2 gD = gP - uGPlayer.xz;
float gPd = length( gD );
float gPush = 1.0 - smoothstep( 0.12, uGPlayer.w, gPd );
transformed.xz += ( gD / max( gPd, 1e-3 ) ) * gPush * gTip * gH * 0.9;
transformed.y -= gPush * gTip * gH * 0.45;
// Colour: the ground colour below, darker at the base and brighter, warmer at the tips.
vec3 gGround = pow( texture( uGColour, ( gF * 0.5 + 0.5 ) / uGSize.zw ).rgb, vec3( 2.2 ) );
gGround = mix( gGround, uGLawn, gField.a * 0.85 );
float gLum = dot( gGround, vec3( 0.2126, 0.7152, 0.0722 ) );
vec3 gSat = max( mix( vec3( gLum ), gGround, 1.18 ), 0.0 );
vec3 gBase = gSat * vec3( 0.6, 0.66, 0.7 );
vec3 gTop = gSat * vec3( 1.2, 1.17, 0.98 ) + vec3( 0.012, 0.016, 0.0 );
gTop *= 1.0 + 0.07 * gWave * gWave * uVegWind;
vGCol = mix( gBase, gTop, pow( aBlade.x, 0.8 ) ) * ( 0.92 + 0.16 * gR2 );
vGCol = mix( gGround, vGCol, gS );
`;

// Two-sided blades keep their up-leaning normal on the back face too.
function normalChunkNoFlip() {
  const src = THREE.ShaderChunk.normal_fragment_begin;
  const out = src.replace('normal *= faceDirection;', '');
  if (out === src) console.warn('grass.js: normal chunk changed; tuft backs may shade dark');
  return out;
}

function tuftMaterial(uniforms) {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${TUFT_VERT_HEAD}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${TUFT_VERT_SETUP}`)
      .replace('#include <begin_vertex>', TUFT_VERT_PLACE);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGCol;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vGCol;')
      .replace('#include <normal_fragment_begin>', normalChunkNoFlip());
  };
  m.customProgramCacheKey = () => 'grass-tuft-1';
  return m;
}

// Ground pattern for the terrain material.
const GROUND_VERT = /* glsl */ `
attribute float aGrass;
varying vec3 vGWorld;
varying float vGCover;
`;

const GROUND_FRAG_HEAD = /* glsl */ `
uniform float uGGround;
uniform float uGTop;
varying vec3 vGWorld;
varying float vGCover;

float gH21( vec2 p ) {
  uvec2 q = uvec2( ivec2( p ) + ivec2( 65536 ) );
  uint h = q.x * 0x8da6b343u ^ q.y * 0xd8163841u;
  h ^= h >> 15; h *= 0x2c1b3c6du; h ^= h >> 12; h *= 0x297a2d39u; h ^= h >> 15;
  return float( h & 0xffffffu ) / 16777216.0;
}
float gNoise( vec2 p ) {
  vec2 i = floor( p ), f = p - i;
  f = f * f * ( 3.0 - 2.0 * f );
  float a = gH21( i ), b = gH21( i + vec2( 1.0, 0.0 ) ), c = gH21( i + vec2( 0.0, 1.0 ) ), d = gH21( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}
// Brush dabs: ellipses laid across the view, one or none per cell of side s.
// Along the view they are measured in screen-corrected units (times sE), so a
// dab keeps its shape on screen as the ground tilts away. dark and light
// collect the cover of the two tones.
void gDabs( vec2 p, vec2 R, vec2 U, float sE, float s, vec2 axes, float aa, inout float dark, inout float light ) {
  vec2 gi = floor( p / s );
  for ( int j = -1; j <= 1; j ++ ) {
    for ( int i = -1; i <= 1; i ++ ) {
      vec2 id = gi + vec2( i, j );
      float pick = gH21( id + 71.0 );
      if ( pick > 0.66 ) continue;
      vec2 c = ( id + 0.5 + ( vec2( gH21( id ), gH21( id + 13.0 ) ) - 0.5 ) * 0.7 ) * s;
      vec2 d = p - c;
      vec2 ax = axes * ( 0.7 + 0.6 * gH21( id + 29.0 ) );
      vec2 q = vec2( dot( d, R ), dot( d, U ) * sE ) / ax;
      float e = length( q );
      float w = aa / ax.y + 0.08;
      float cov = 1.0 - smoothstep( 1.0 - w, 1.0 + w, e );
      if ( pick < 0.46 ) dark = max( dark, cov ); else light = max( light, cov );
    }
  }
}
// Blade ticks: two or three short, nearly upright strokes pointing away from the camera.
float gStroke( vec2 q, vec2 base, vec2 tip, float w0, float aa ) {
  q -= base;
  float h = clamp( dot( q, tip ) / dot( tip, tip ), 0.0, 1.0 );
  float d = length( q - tip * h );
  float w = mix( w0, w0 * 0.2, h );
  return 1.0 - smoothstep( w - aa, w + aa, d );
}
// k scales the glyph (1 is about 0.1 m tall); returns the cover of dark and light ticks.
vec2 gTicks( vec2 p, vec2 R, vec2 U, float sE, float s, float k, float aa ) {
  vec2 gi = floor( p / s );
  vec2 cov = vec2( 0.0 );
  for ( int j = -1; j <= 1; j ++ ) {
    for ( int i = -1; i <= 1; i ++ ) {
      vec2 id = gi + vec2( i, j );
      float pick = gH21( id + 5.0 );
      if ( pick > 0.6 ) continue;
      vec2 c = ( id + 0.5 + ( vec2( gH21( id + 3.0 ), gH21( id + 11.0 ) ) - 0.5 ) * 0.6 ) * s;
      vec2 d = p - c;
      float sz = k * ( 0.8 + 0.4 * gH21( id + 19.0 ) );
      vec2 q = vec2( dot( d, R ), dot( d, U ) * sE ) / sz;
      float a = aa / sz;
      float r = gH21( id + 23.0 ) - 0.5;
      float t = gStroke( q, vec2( -0.034, 0.0 ), vec2( -0.014 + r * 0.02, 0.062 ), 0.012, a );
      t = max( t, gStroke( q, vec2( 0.0, -0.006 ), vec2( 0.004 + r * 0.03, 0.085 ), 0.013, a ) );
      if ( r > -0.2 ) t = max( t, gStroke( q, vec2( 0.036, 0.0 ), vec2( 0.016 + r * 0.02, 0.058 ), 0.012, a ) );
      if ( pick < 0.33 ) cov.y = max( cov.y, t ); else cov.x = max( cov.x, t );
    }
  }
  return cov;
}

vec3 groundGrass( vec3 col ) {
  float cover = clamp( vGCover, 0.0, 1.0 ) * uGGround;
  vec2 p = vGWorld.xz;
  vec3 toCam = cameraPosition - vGWorld;
  float dist = length( toCam );
  // Directions on the ground: U away from the camera (up the screen), R across.
  vec2 U = normalize( mix( -toCam.xz, vec2( 0.0, -1.0 ) * dist, uGTop ) + vec2( 1e-5, 0.0 ) );
  vec2 R = vec2( -U.y, U.x );
  float sinE = toCam.y / max( dist, 1e-3 );
  float sE = clamp( sinE, 0.5, 1.0 ); // blade ticks
  float sD = clamp( sinE, 0.25, 1.0 ); // dabs
  // Ground metres per pixel across the view and along it, and the larger of the
  // two in the dabs' corrected units.
  float pxR = max( fwidth( dot( p, R ) ), 1e-4 );
  float pxU = max( fwidth( dot( p, U ) ), 1e-4 );
  float pxD = max( pxR, pxU * sD );

  // Soft painted patches at about 3 m and 1 m, in three gentle tones.
  float n = gNoise( p * 0.33 + 11.0 ) * 0.62 + gNoise( p * 0.95 - 4.0 ) * 0.38;
  float fw = max( fwidth( n ), 0.025 );
  float lo = 1.0 - smoothstep( 0.42 - fw, 0.42 + fw, n );
  float hi = smoothstep( 0.6 - fw, 0.6 + fw, n );

  float dark = 0.0, light = 0.0;
  // Soft brush dabs across the view, fading once their short side nears a pixel.
  float fDab = 1.0 - smoothstep( 0.05, 0.11, pxD );
  if ( cover > 0.0 && fDab > 0.0 ) {
    gDabs( p, R, U, sD, 1.9, vec2( 0.62, 0.17 ), pxD, dark, light );
    dark *= fDab; light *= fDab;
  }
  // Blade ticks at two sizes: big ones for the middle distance and views from
  // above, small ones near the camera between the tufts.
  vec2 tk = vec2( 0.0 );
  float fBig = ( 1.0 - smoothstep( 0.014, 0.032, pxR ) ) * smoothstep( 4.0, 9.0, dist );
  if ( cover > 0.0 && fBig > 0.0 ) tk = gTicks( p, R, U, sE, 1.05, 2.3, pxR * 0.8 ) * fBig;
  float fSmall = ( 1.0 - smoothstep( 0.007, 0.016, pxR ) ) * smoothstep( 3.5, 7.0, dist ) * ( 1.0 - smoothstep( 9.0, 18.0, dist ) );
  if ( cover > 0.0 && fSmall > 0.0 ) tk = max( tk, gTicks( p + 3.1, R, U, sE, 0.42, 1.0, pxR * 0.8 ) * fSmall );

  vec3 c = col;
  c *= mix( vec3( 1.0 ), vec3( 0.92, 0.95, 0.99 ), lo * cover );
  c *= mix( vec3( 1.0 ), vec3( 1.06, 1.055, 0.96 ), hi * cover );
  c *= mix( vec3( 1.0 ), vec3( 0.9, 0.93, 0.94 ), dark * cover );
  c *= mix( vec3( 1.0 ), vec3( 1.06, 1.055, 0.96 ), light * cover );
  c *= mix( vec3( 1.0 ), vec3( 0.84, 0.89, 0.88 ), tk.x * cover );
  c *= mix( vec3( 1.0 ), vec3( 1.1, 1.1, 0.92 ), tk.y * cover );
  return c;
}
`;

const groundUniforms = {
  uGGround: { value: 1 },
  uGTop: { value: 0 },
};

// Patches the terrain material (a MeshLambertMaterial with vertex colours) and
// gives the terrain geometry its per-vertex grass cover.
function patchGround(mesh, data, cover) {
  const T = data.terrain;
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const a = new Float32Array(pos.count);
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
    const i = T.cellIndex(x, z);
    a[k] = i >= 0 ? cover[i] : y > 0.05 ? 1 : 0; // the skirt beyond the grid is bank
  }
  geo.setAttribute('aGrass', new THREE.BufferAttribute(a, 1));

  const mat = mesh.material;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    Object.assign(shader.uniforms, groundUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GROUND_VERT}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvGCover = aGrass;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GROUND_FRAG_HEAD}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = groundGrass( diffuseColor.rgb );');
  };
  const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.customProgramCacheKey = () => prevKey() + '|ground-grass-1';
  mat.needsUpdate = true;
}

// ---------------------------------------------------------------- build

// terrain: the buildTerrain() result (mesh, fields and, when present, paint).
// Returns { group, update(dt, t, ctx), stats, uniforms }.
export function buildGrass({ data, terrain, topView = false }) {
  const t0 = performance.now();
  const T = data.terrain;
  const { field, cover, lawnDensity } = grassFields(data, terrain.fields);
  const t1 = performance.now();
  const colours = groundColours(data, terrain.paint);
  const t2 = performance.now();

  const heightTex = dataTexture(T.height, T.cols, T.rows, THREE.RedFormat, THREE.FloatType, false);
  const fieldTex = dataTexture(field, T.cols, T.rows, THREE.RGBAFormat, THREE.UnsignedByteType, true);
  const colourTex = dataTexture(colours.bytes, colours.cols2, colours.rows2, THREE.RGBAFormat, THREE.UnsignedByteType, true);

  const uniforms = {
    uGHeight: { value: heightTex },
    uGField: { value: fieldTex },
    uGColour: { value: colourTex },
    uGGrid: { value: new THREE.Vector4(T.x0, T.z0, 1 / T.cell, 0) },
    uGSize: { value: new THREE.Vector4(T.cols, T.rows, colours.cols2, colours.rows2) },
    uGCentre: { value: new THREE.Vector3(T.start.x, T.start.z, GRASS.tile) },
    uGFade: { value: new THREE.Vector4(GRASS.fade[0], GRASS.fade[1], GRASS.width, GRASS.height) },
    uGPlayer: { value: new THREE.Vector4(T.start.x, T.start.y, T.start.z, GRASS.push) },
    uGWindDir: { value: new THREE.Vector2(GRASS.wind[0], GRASS.wind[1]).normalize() },
    uGLawn: { value: new THREE.Color('#86c254') },
    uVegTime: vegUniforms.uVegTime,
    uVegWind: vegUniforms.uVegWind,
  };

  // Slots: a jittered lattice over one square.
  const side = Math.round(GRASS.tile / GRASS.spacing);
  const count = side * side;
  const slots = new Float32Array(count * 3);
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const k = (j * side + i) * 3;
      slots[k] = (i + 0.5 + (hash2(i * 3 + 1, j * 7 + 2) - 0.5) * 0.8) * GRASS.spacing;
      slots[k + 1] = (j + 0.5 + (hash2(i * 5 + 3, j * 11 + 5) - 0.5) * 0.8) * GRASS.spacing;
      slots[k + 2] = hash2(i * 13, j * 17);
    }
  }
  const geo = tuftGeometry();
  geo.setAttribute('aSlot', new THREE.InstancedBufferAttribute(slots, 3));
  geo.instanceCount = count;
  const mesh = new THREE.Mesh(geo, tuftMaterial(uniforms));
  mesh.name = 'grass-tufts';
  mesh.frustumCulled = false; // the slots follow the camera
  mesh.matrixAutoUpdate = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.name = 'grass';
  group.add(mesh);
  if (topView) group.visible = false;

  groundUniforms.uGTop.value = topView ? 1 : 0;
  patchGround(terrain.mesh, data, cover);
  const t3 = performance.now();

  const fwd = new THREE.Vector3();
  const tris = geo.attributes.position.count / 3;
  return {
    group,
    mesh,
    uniforms,
    ground: groundUniforms,
    // ctx: { camera, player } (player: the feet position, a Vector3)
    update(dt, t, ctx) {
      vegUniforms.uVegTime.value = t; // the same wind time the vegetation sets
      const cam = ctx && ctx.camera;
      if (!cam) return;
      cam.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      const u = uniforms;
      // Zoomed out, the fade moves out with the camera. Capped so that even the
      // latest-fading tufts stay well inside the square on a wide screen.
      let near = GRASS.fade[0];
      const pl = ctx.player;
      if (pl) {
        near = Math.min(18, Math.max(GRASS.fade[0], cam.position.distanceTo(pl) + 4));
        u.uGPlayer.value.set(pl.x, pl.y, pl.z, GRASS.push);
      }
      u.uGFade.value.x = near;
      u.uGFade.value.y = near + (GRASS.fade[1] - GRASS.fade[0]);
      u.uGCentre.value.set(cam.position.x + fwd.x * GRASS.lead, cam.position.z + fwd.z * GRASS.lead, GRASS.tile);
    },
    stats: {
      drawCalls: 1,
      instances: count,
      trianglesPerTuft: tris,
      triangles: count * tris,
      tuftsPerM2OpenLawn: +(lawnDensity / (GRASS.spacing * GRASS.spacing)).toFixed(2),
      textures: 3,
      buildMs: Math.round(t3 - t0), // fields, colours, the rest
      buildSplitMs: [Math.round(t1 - t0), Math.round(t2 - t1), Math.round(t3 - t2)],
    },
  };
}
