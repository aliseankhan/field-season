// Lake surface: a flat plane at y = 0, drawn as a Phong material (so it takes
// the sun, its shadows and the fog) with a patched shader for the depth tint,
// the pale band and foam line at the shore, ripples, sparkles, a sky reflection
// and the morning mist. The real lake is tea-brown; this one is a cheerful clear
// teal. Each ripple band fades out once a wavelength covers only a few pixels, so
// the far lake lies smooth at grazing angles instead of knitting a crosshatch.

import * as THREE from 'three';
import { distanceField } from './terrain.js';

const WHITE = new THREE.Color(1, 1, 1);
const MAX_DEPTH = 1.5; // metres, R channel scale
const MAX_SHORE = 4.0; // metres, G channel scale

const WATER = {
  deep: '#1e8c9e',
  mid: '#35b0ae',
  shallow: '#84dac6',
  band: '#bdf0dc',
  foam: '#ffffff',
  leafShade: '#2f6a55',
};

function depthTexture(data, fields) {
  const T = data.terrain;
  const { cols, rows, height, bits } = T;
  const toLand = distanceField(T, (m) => (m & bits.water) === 0, MAX_SHORE);
  const px = new Uint8Array(cols * rows * 4);
  for (let i = 0; i < cols * rows; i++) {
    const depth = Math.max(0, -height[i]);
    px[i * 4] = Math.min(255, Math.round((depth / MAX_DEPTH) * 255));
    px[i * 4 + 1] = Math.min(255, Math.round((toLand[i] / MAX_SHORE) * 255));
    // Canopy over the water (blurred), so the shade under the mangroves reflects leaves, not sky.
    px[i * 4 + 2] = fields ? Math.min(255, Math.round(fields.canopy[i] * 25)) : 0;
    px[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(px, cols, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const VERT_HEAD = /* glsl */ `
varying vec3 vWPos;
`;

const FRAG_HEAD = /* glsl */ `
varying vec3 vWPos;
uniform float uTime;
uniform sampler2D uDepthTex;
uniform vec4 uGrid;          // xmin, zmin, width, depth of the grid
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uShallow;
uniform vec3 uBand;
uniform vec3 uFoam;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyTop;
uniform vec3 uSunDir;
uniform vec3 uLeafShade;
uniform float uRipple;       // ripple strength, 1 in play (calmer in the top view)
uniform float uMist;         // morning mist over the water, 0..1
uniform vec3 uMistColor;

float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x),
             mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// How much of a ripple of wavenumber k (radians per metre) to keep where a pixel
// covers fw metres: all of it over 6 pixels a wavelength, none under 2.5.
float wKeep(float k, float fw) { return smoothstep(2.5, 6.0, 6.2832 / (k * fw)); }
float wWaves(vec2 p, float t, vec4 keep) {
  return sin(dot(p, vec2(0.83, 0.55)) * 1.7 + t * 1.1) * 0.5 * keep.x
       + sin(dot(p, vec2(-0.47, 0.88)) * 2.9 + t * 1.6) * 0.3 * keep.y
       + sin(dot(p, vec2(0.95, -0.31)) * 4.6 - t * 2.2) * 0.16 * keep.z
       + wNoise(p * 1.4 + vec2(t * 0.25, -t * 0.18)) * 0.6 * keep.w;
}
`;

const FRAG_COLOUR = /* glsl */ `
  vec2 wUv = (vWPos.xz - uGrid.xy) / uGrid.zw;
  vec4 wTex = texture2D(uDepthTex, wUv);
  float wDepth = wTex.r * ${MAX_DEPTH.toFixed(2)};
  float wShore = wTex.g * ${MAX_SHORE.toFixed(2)};
  float wCanopy = smoothstep(0.08, 0.45, wTex.b);
  // Beyond the grid the lake is open water: no streaks from the clamped edge.
  vec2 wOut = max(-wUv, wUv - 1.0) * uGrid.zw;
  float wBeyond = max(wOut.x, wOut.y);
  if (wBeyond > 0.0) {
    wShore = max(wShore, min(${MAX_SHORE.toFixed(2)}, wBeyond * 2.0));
    wDepth = mix(wDepth, ${MAX_DEPTH.toFixed(2)}, smoothstep(0.0, 6.0, wBeyond));
  }
  vec2 wp = vWPos.xz;
  float wt = uTime;

  // Ripple normal (world space) from a finite-difference gradient, each band
  // filtered by the pixel's footprint on the water (the larger of its two sides).
  vec2 wdx = dFdx(wp), wdy = dFdy(wp);
  float wFw = max(max(length(wdx), length(wdy)), 1e-4);
  vec4 wK = vec4(wKeep(1.7, wFw), wKeep(2.9, wFw), wKeep(4.6, wFw), wKeep(8.8, wFw));
  float e = 0.12;
  float h0 = wWaves(wp, wt, wK);
  float hx = wWaves(wp + vec2(e, 0.0), wt, wK);
  float hz = wWaves(wp + vec2(0.0, e), wt, wK);
  float calm = mix(0.35, 1.0, smoothstep(0.2, 2.5, wShore)) * uRipple;
  vec3 wN = normalize(vec3(-(hx - h0) / e * 0.028 * calm, 1.0, -(hz - h0) / e * 0.028 * calm));

  // Depth tint: pale aqua over the shallows, turquoise, then a deep teal.
  vec3 wCol = mix(uShallow, uMid, smoothstep(0.04, 0.3, wDepth));
  wCol = mix(wCol, uDeep, smoothstep(0.3, 0.8, wDepth));
  // A light band hugging the shore.
  wCol = mix(wCol, uBand, (1.0 - smoothstep(0.3, 0.85, wShore)) * 0.75);
  wCol *= 0.96 + 0.08 * wNoise(wp * 0.23 + vec2(wt * 0.03, 0.0));

  // Foam: a bright wobbling line at the shore and a fainter one pulsing outside it.
  float fn = wNoise(wp * 2.2 + vec2(wt * 0.35, wt * 0.2));
  float foam = 1.0 - smoothstep(0.2, 0.3 + 0.15 * fn + wFw, wShore);
  float ring = 0.62 + 0.16 * sin(wt * 0.9 + fn * 5.0);
  // the thin pulsing ring fades where it would be thinner than a pixel
  float ringW = 0.06 + 0.05 * fn;
  foam = max(foam, (1.0 - smoothstep(0.0, ringW + wFw, abs(wShore - ring))) * 0.35 * (1.0 - smoothstep(0.9, 1.2, wShore)) * ringW / (ringW + wFw));
  foam *= step(0.001, wDepth);

  diffuseColor.rgb = mix(wCol, uFoam, foam);
  diffuseColor.a = mix(0.7, 0.94, smoothstep(0.04, 0.6, wDepth));
  diffuseColor.a = max(diffuseColor.a, foam);
`;

const FRAG_NORMAL = /* glsl */ `
  normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
`;

const FRAG_OUT = /* glsl */ `
  {
    vec3 V = normalize(cameraPosition - vWPos);
    float fres = pow(1.0 - clamp(dot(wN, V), 0.0, 1.0), 4.0);
    vec3 R = reflect(-V, wN);
    vec3 sky = mix(uSkyHorizon, uSkyTop, smoothstep(-0.12, 0.4, R.y));
    sky = mix(sky, uLeafShade, wCanopy * 0.85);
    float refl = (0.04 + 0.3 * fres) * (1.0 - foam);
    outgoingLight = mix(outgoingLight, sky, refl);
    // with the sun low the surface would go dull: the open sky keeps it bright
    outgoingLight += wCol * mix(vec3(0.34), uSkyTop, 0.35) * (1.0 - smoothstep(0.25, 0.7, uSunDir.y)) * (1.0 - foam) * (1.0 - 0.6 * wCanopy);
    // Little white sparkles where the sun catches the ripples.
    float sp = wNoise(wp * 3.1 + vec2(wt * 0.6, -wt * 0.4)) * wNoise(wp * 1.7 - vec2(wt * 0.3, wt * 0.5));
    float wDist = length(cameraPosition - vWPos);
    float wNear = (1.0 - smoothstep(22.0, 55.0, wDist)) * wK.z; // no speckle far off, nor where it would alias
    float glint = smoothstep(0.78, 0.83, sp) * smoothstep(0.1, 0.5, uSunDir.y) * (1.0 - foam) * (1.0 - wCanopy) * wNear;
    outgoingLight = mix(outgoingLight, vec3(1.0), glint * 0.85);
    diffuseColor.a = mix(diffuseColor.a, 1.0, fres * 0.8);
    // Morning mist: soft drifting veils lying on the water, thicker further off.
    float veil = smoothstep(0.25, 0.8, wNoise(wp * 0.06 + vec2(wt * 0.02, wt * 0.012)))
               * (0.55 + 0.45 * wNoise(wp * 0.19 - vec2(wt * 0.03, 0.0)));
    float mist = uMist * smoothstep(3.0, 30.0, wDist) * (0.25 + 0.75 * veil) * (1.0 - 0.5 * wCanopy);
    outgoingLight = mix(outgoingLight, uMistColor, mist * 0.42);
    diffuseColor.a = mix(diffuseColor.a, 1.0, mist * 0.4);
  }
`;

export function buildWater(data, sky, fields = null) {
  const T = data.terrain;
  const tex = depthTexture(data, fields);
  const C = (h) => new THREE.Color(h);

  const uniforms = {
    uTime: { value: 0 },
    uDepthTex: { value: tex },
    uGrid: { value: new THREE.Vector4(T.xmin, T.zmin, T.xmax - T.xmin, T.zmax - T.zmin) },
    uDeep: { value: C(WATER.deep) },
    uMid: { value: C(WATER.mid) },
    uShallow: { value: C(WATER.shallow) },
    uBand: { value: C(WATER.band) },
    uFoam: { value: C(WATER.foam) },
    uSkyHorizon: { value: new THREE.Color() },
    uSkyTop: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uLeafShade: { value: C(WATER.leafShade) },
    uRipple: { value: 1 },
    uMist: { value: 0 },
    uMistColor: { value: new THREE.Color() },
  };

  const material = new THREE.MeshPhongMaterial({
    color: 0xffffff,
    specular: 0x3a3a34,
    shininess: 160,
    transparent: true,
    depthWrite: true,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_HEAD)
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <color_fragment>', FRAG_COLOUR)
      .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
      .replace('#include <opaque_fragment>', FRAG_OUT + '\n#include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => 'lake-water-3';

  const geo = new THREE.PlaneGeometry(2600, 2600, 4, 4);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'water';
  mesh.position.set(10, data.water.level_y || 0, 0);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.renderOrder = 1;

  function syncSky() {
    if (!sky) return;
    uniforms.uSkyHorizon.value.copy(sky.state.horizon);
    uniforms.uSkyTop.value.copy(sky.state.top);
    uniforms.uSunDir.value.copy(sky.state.sunDir);
    // the mist takes the fog's colour, a touch lighter
    uniforms.uMist.value = sky.state.mist || 0;
    if (sky.state.fogColor) uniforms.uMistColor.value.copy(sky.state.fogColor).lerp(WHITE, 0.25);
  }
  syncSky();

  return {
    mesh,
    uniforms,
    update(dt, t) {
      uniforms.uTime.value = t;
      syncSky();
    },
  };
}
