// Shared vegetation shader additions, injected with onBeforeCompile:
// - gentle wind sway in world space, growing with height above the ground, so a trunk
//   and the crown on top of it move together; leaves add a small flutter;
// - the camera cut-out: fragments inside a capsule from the camera to the player's head
//   are dithered away (8x8 ordered dither), so crowns never hide the player;
// - a soft blue-green self-light (uVegLift) so shaded foliage never goes dark.
// All vegetation materials share one set of uniforms, set once a frame by veg.update.

import * as THREE from 'three';

export const vegUniforms = {
  uVegTime: { value: 0 },
  uVegWind: { value: 1 },
  uVegCam: { value: new THREE.Vector3() },
  uVegFocus: { value: new THREE.Vector3() },
  uVegCut: { value: 0 }, // capsule radius in metres, 0 turns the cut-out off
  uVegLift: { value: new THREE.Color(0.17, 0.18, 0.26) }, // bluish self-light so shade stays soft
};

const VERT_HEAD = /* glsl */ `
attribute float aSway;
uniform float uVegTime;
uniform float uVegWind;
uniform float uVegFlutter;
varying vec3 vVegWorld;
vec3 vegSway(vec3 w, float weight) {
  float h = max(w.y - 0.3, 0.0);
  float amp = uVegWind * weight * 0.0042 * h * sqrt(h);
  float ph = uVegTime * 0.85 + dot(w.xz, vec2(0.11, 0.07));
  vec3 off = vec3(sin(ph) + 0.35 * sin(ph * 2.3 + 1.7), 0.0, 0.6 * cos(ph * 0.8 + 0.4)) * amp;
  float fl = uVegFlutter * weight * min(h, 3.0) * 0.011;
  float q = uVegTime * 3.1 + dot(w, vec3(1.7, 1.3, 2.1));
  off += vec3(sin(q), 0.6 * sin(q * 1.3 + 2.0), cos(q * 0.9)) * fl;
  return off;
}
`;

const VERT_PROJECT = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
vec4 vegW = modelMatrix * mvPosition;
vegW.xyz += vegSway( vegW.xyz, aSway );
vVegWorld = vegW.xyz;
mvPosition = viewMatrix * vegW;
gl_Position = projectionMatrix * mvPosition;
`;

// Push the shadow lookup out along the normal: overlapping blobs and two-sided leaves
// would otherwise shadow themselves in fine stripes.
const SHADOW_OFFSET = /* glsl */ `
#if defined( USE_SHADOWMAP )
  worldPosition.xyz += normalize( inverseTransformDirection( transformedNormal, viewMatrix ) ) * 0.09;
#endif
`;

const FRAG_HEAD = /* glsl */ `
uniform vec3 uVegLift;
uniform vec3 uVegCam;
uniform vec3 uVegFocus;
uniform float uVegCut;
varying vec3 vVegWorld;
float vegBayer( vec2 p ) {
  // 8x8 ordered dither from the 2x2 pattern at three scales, finest scale weighted most
  ivec2 q = ivec2( mod( p, 8.0 ) );
  int v = 0;
  for ( int s = 0; s < 3; s ++ ) {
    int x = ( q.x >> s ) & 1, y = ( q.y >> s ) & 1;
    v = v * 4 + ( ( x ^ y ) * 2 + y );
  }
  return ( float( v ) + 0.5 ) / 64.0;
}
`;

const FRAG_CUT = /* glsl */ `
if ( uVegCut > 0.0 ) {
  vec3 ab = uVegFocus - uVegCam;
  float l2 = max( dot( ab, ab ), 1e-4 );
  float t = dot( vVegWorld - uVegCam, ab ) / l2;
  if ( t < 1.0 ) {
    float tc = max( t, 0.0 );
    float d = length( vVegWorld - ( uVegCam + ab * tc ) );
    float r = uVegCut * mix( 1.0, 0.55, smoothstep( 0.75, 1.0, tc ) );
    float fade = 1.0 - smoothstep( r * 0.55, r, d );
    if ( vegBayer( gl_FragCoord.xy ) < fade ) discard;
  }
}
`;

// The cut-out as a GLSL function for other materials (the lizards fade with the wood
// they sit on): the uniforms, vegBayer() and vegCutFade(world) -> 0 (kept) .. 1 (cut).
// Pass vegUniforms' uVegCam, uVegFocus and uVegCut to the material.
export const CUT_GLSL = /* glsl */ `
uniform vec3 uVegCam;
uniform vec3 uVegFocus;
uniform float uVegCut;
float vegBayer( vec2 p ) {
  ivec2 q = ivec2( mod( p, 8.0 ) );
  int v = 0;
  for ( int s = 0; s < 3; s ++ ) {
    int x = ( q.x >> s ) & 1, y = ( q.y >> s ) & 1;
    v = v * 4 + ( ( x ^ y ) * 2 + y );
  }
  return ( float( v ) + 0.5 ) / 64.0;
}
float vegCutFade( vec3 w ) {
  if ( uVegCut <= 0.0 ) return 0.0;
  vec3 ab = uVegFocus - uVegCam;
  float l2 = max( dot( ab, ab ), 1e-4 );
  float t = dot( w - uVegCam, ab ) / l2;
  if ( t >= 1.0 ) return 0.0;
  float tc = max( t, 0.0 );
  float d = length( w - ( uVegCam + ab * tc ) );
  float r = uVegCut * mix( 1.0, 0.55, smoothstep( 0.75, 1.0, tc ) );
  return 1.0 - smoothstep( r * 0.55, r, d );
}
`;

// Adds sway (and flutter, for leaves) and the cut-out to a built-in material.
export function applyVegShader(material, { flutter = 0 } = {}) {
  const flutterU = { value: flutter };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, vegUniforms);
    shader.uniforms.uVegFlutter = flutterU;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <project_vertex>', VERT_PROJECT)
      .replace('#include <shadowmap_vertex>', SHADOW_OFFSET + '#include <shadowmap_vertex>');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FRAG_CUT}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uVegLift;');
  };
  material.customProgramCacheKey = () => 'veg-v2';
  material.userData.flutter = flutterU;
  return material;
}

// Toon ramps: dotNL from -1 to 1 maps across the texels. Leaves get a soft three-step
// ramp, wood four steps; the hemisphere light and uVegLift fill the rest.
export const TOON_LEAF = [150, 210, 255];
export const TOON_WOOD = [110, 170, 225, 255];

export function makeToonGradient(steps = TOON_LEAF) {
  const tex = new THREE.DataTexture(new Uint8Array(steps), steps.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// Updates the shared uniforms. focus null turns the cut-out off.
export function setVegFrame(t, cameraPosition, focus, cutRadius) {
  vegUniforms.uVegTime.value = t;
  if (cameraPosition && focus && cutRadius > 0) {
    vegUniforms.uVegCam.value.copy(cameraPosition);
    vegUniforms.uVegFocus.value.copy(focus);
    vegUniforms.uVegCut.value = cutRadius;
  } else {
    vegUniforms.uVegCut.value = 0;
  }
}
