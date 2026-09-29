// Crocodile effects, all in one draw call: a soft V-shaped wake that follows each
// croc's path across the water, splash rings, the "!" it shows when it warns and
// a comic "SNAP!" burst. The two signs are drawn in front of everything, so a
// croc under a crown still shows its warning. The wake and rings are drawn in the shader; the two signs
// come from one small canvas texture. Vertex positions are rewritten each frame
// in place, with no allocation.

import * as THREE from 'three';

const TRAIL = 30; // wake points per croc
const TRAIL_DT = 0.14; // seconds between wake points
const WAKE_LIFE = 4.2; // seconds a point of wake lasts
const SPREAD = 0.36; // metres per second the V opens out, each side
const PER = TRAIL * 2 + 12; // vertices per croc: ribbon, ring, "!", "SNAP!"

const VERT = /* glsl */ `
attribute vec4 aFx; // kind (0 wake, 1 ring, 2 alert, 3 snap), u, v, strength
varying vec4 vFx;
#include <fog_pars_vertex>
void main() {
  vFx = aFx;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform float uTime;
varying vec4 vFx;
#include <fog_pars_fragment>
void main() {
  float kind = vFx.x;
  vec4 col = vec4(0.0);
  if (kind < 0.5) {
    // wake: u across (-1..1), v the age in seconds
    float u = abs(vFx.y), age = vFx.z;
    float k = age / ${WAKE_LIFE.toFixed(2)};
    float arm = smoothstep(0.42, 0.78, u) * (1.0 - smoothstep(0.84, 1.0, u));
    float ripple = 0.5 + 0.5 * sin(age * 9.0 - u * 4.0 - uTime * 2.0);
    // faint chevrons inside the V, and a bright bow wave at the nose
    float inner = (1.0 - smoothstep(0.15, 0.75, u)) * smoothstep(0.55, 0.9, ripple) * 0.45 * smoothstep(0.15, 0.7, age);
    float bow = (1.0 - smoothstep(0.05, 0.3, age)) * smoothstep(0.35, 0.75, u) * (1.0 - smoothstep(0.8, 1.0, u)) * 0.55;
    float a = (arm * (0.85 + 0.15 * ripple) * smoothstep(0.25, 1.0, age) + inner + bow) * pow(max(0.0, 1.0 - k), 1.4) * vFx.w;
    col = vec4(0.97, 1.0, 0.99, min(1.0, a) * 0.85);
  } else if (kind < 1.5) {
    // ring: v is the progress 0..1
    float r = length(vFx.yz * vec2(1.0, 1.0));
    float p = vFx.w;
    float ring = 1.0 - smoothstep(0.0, 0.07, abs(r - (0.25 + 0.75 * p)));
    ring += (1.0 - smoothstep(0.0, 0.06, abs(r - 0.55 * p))) * 0.6;
    col = vec4(1.0, 1.0, 1.0, ring * (1.0 - p) * 0.85);
  } else {
    vec2 uv = vFx.yz;
    // the atlas: "!" in the top-left square, "SNAP!" across the bottom half
    uv = kind < 2.5 ? vec2(uv.x * 0.5, 0.5 + uv.y * 0.5) : vec2(uv.x, uv.y * 0.5);
    col = texture2D(uTex, uv);
    col.a *= vFx.w;
  }
  if (col.a < 0.004) discard;
  #if __VERSION__ >= 300
  // the signs show through leaves and bodies; the wake and rings sit in the water
  gl_FragDepth = kind > 1.5 ? 0.0 : gl_FragCoord.z;
  #endif
  gl_FragColor = col;
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

function signTexture() {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 512;
  const g = cv.getContext('2d');
  const ink = '#3a2f2a';
  // "!" in a round bubble with a little tail (top-left 256 square).
  g.save();
  g.translate(128, 118);
  g.beginPath();
  g.arc(0, 0, 92, 0, Math.PI * 2);
  g.moveTo(-26, 84); g.lineTo(0, 128); g.lineTo(26, 84);
  g.fillStyle = '#fffaf0';
  g.fill();
  g.lineWidth = 12; g.strokeStyle = ink; g.lineJoin = 'round';
  g.stroke();
  g.fillStyle = '#ff5e4d';
  g.beginPath();
  g.moveTo(-17, -62); g.lineTo(17, -62); g.lineTo(10, 26); g.lineTo(-10, 26); g.closePath();
  g.fill();
  g.beginPath(); g.arc(0, 52, 15, 0, Math.PI * 2); g.fill();
  g.lineWidth = 6; g.strokeStyle = '#b8352a';
  g.beginPath(); g.moveTo(-17, -62); g.lineTo(17, -62); g.lineTo(10, 26); g.lineTo(-10, 26); g.closePath(); g.stroke();
  g.restore();
  // "SNAP!" on a yellow starburst (bottom half).
  g.save();
  g.translate(256, 384);
  g.beginPath();
  const n = 14;
  for (let i = 0; i <= n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const r = i % 2 ? 0.7 : 1;
    const x = Math.cos(a) * 240 * r, y = Math.sin(a) * 118 * r;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.closePath();
  g.fillStyle = '#ffd84a';
  g.fill();
  g.lineWidth = 10; g.strokeStyle = ink; g.lineJoin = 'round';
  g.stroke();
  g.rotate(-0.08);
  g.font = '900 104px ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 18; g.strokeStyle = '#fffaf0';
  g.strokeText('SNAP!', 0, 6);
  g.fillStyle = '#ff4f3f';
  g.fillText('SNAP!', 0, 6);
  g.restore();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createCrocFx(nCrocs) {
  const nv = PER * nCrocs;
  const pos = new Float32Array(nv * 3);
  const fx = new Float32Array(nv * 4);
  const idx = [];
  for (let c = 0; c < nCrocs; c++) {
    const b = c * PER;
    for (let k = 0; k < TRAIL - 1; k++) {
      const a = b + k * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    for (const q of [TRAIL * 2, TRAIL * 2 + 4, TRAIL * 2 + 8]) {
      const a = b + q;
      idx.push(a, a + 1, a + 2, a, a + 2, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const fxAttr = new THREE.BufferAttribute(fx, 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('aFx', fxAttr);
  geo.setIndex(idx);

  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTex: { value: null }, uTime: { value: 0 } }]);
  uniforms.uTex.value = signTexture();
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'croc-fx';
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;

  // Per croc state: the wake's ring buffer of points, one ring, the two signs.
  const crocs = [];
  for (let c = 0; c < nCrocs; c++) {
    crocs.push({
      tx: new Float32Array(TRAIL), tz: new Float32Array(TRAIL), tt: new Float32Array(TRAIL), ts: new Float32Array(TRAIL),
      head: 0, count: 0, last: -1e9, hx: 0, hz: 0, hs: 0,
      ring: { x: 0, z: 0, size: 1, t: 1, on: false },
      alert: { x: 0, y: 0, z: 0, on: false, k: 0 },
      snap: { x: 0, y: 0, z: 0, t: 9 },
      shown: true,
    });
  }

  let time = 0;
  const right = new THREE.Vector3(), up = new THREE.Vector3();

  const setV = (v, x, y, z, kind, u, w, s) => {
    pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
    fx[v * 4] = kind; fx[v * 4 + 1] = u; fx[v * 4 + 2] = w; fx[v * 4 + 3] = s;
  };
  const hideQuad = (v) => { for (let k = 0; k < 4; k++) setV(v + k, 0, -50, 0, 0, 0, 0, 0); };
  const billboard = (v, kind, x, y, z, hw, hh, alpha) => {
    setV(v, x - right.x * hw - up.x * hh, y - right.y * hw - up.y * hh, z - right.z * hw - up.z * hh, kind, 0, 0, alpha);
    setV(v + 1, x + right.x * hw - up.x * hh, y + right.y * hw - up.y * hh, z + right.z * hw - up.z * hh, kind, 1, 0, alpha);
    setV(v + 2, x + right.x * hw + up.x * hh, y + right.y * hw + up.y * hh, z + right.z * hw + up.z * hh, kind, 1, 1, alpha);
    setV(v + 3, x - right.x * hw + up.x * hh, y - right.y * hw + up.y * hh, z - right.z * hw + up.z * hh, kind, 0, 1, alpha);
  };

  return {
    mesh,
    // Each frame while it swims: the point where the head meets the water and the
    // wake strength (0 when still or on land).
    wake(i, x, z, strength) {
      const c = crocs[i];
      c.hx = x; c.hz = z; c.hs = strength;
      if (strength > 0.02 && time - c.last >= TRAIL_DT) {
        c.head = (c.head + 1) % TRAIL;
        c.tx[c.head] = x; c.tz[c.head] = z; c.tt[c.head] = time; c.ts[c.head] = strength;
        c.count = Math.min(TRAIL, c.count + 1);
        c.last = time;
      }
    },
    ring(i, x, z, size = 1.4) {
      const r = crocs[i].ring;
      r.x = x; r.z = z; r.size = size; r.t = 0; r.on = true;
    },
    alert(i, on, x = 0, y = 0, z = 0) {
      const a = crocs[i].alert;
      a.on = on;
      if (on) { a.x = x; a.y = y; a.z = z; }
    },
    // t0 > 0 starts part way in (a held pose for checks passes 0.4).
    snap(i, x, y, z, t0 = 0) {
      const s = crocs[i].snap;
      s.x = x; s.y = y; s.z = z; s.t = t0;
    },
    // Whether this croc's effects are in view (they still age when not).
    show(i, on) { crocs[i].shown = on; },
    update(dt, t, camera) {
      time += dt;
      uniforms.uTime.value = t;
      right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
      let any = false;
      for (let i = 0; i < crocs.length; i++) {
        const c = crocs[i], b = i * PER;
        // The wake ribbon: newest point first (the live head), then the stored ones.
        let n = 0;
        let px = c.hx, pz = c.hz;
        for (let k = 0; k < TRAIL; k++) {
          let x, z, age, s;
          if (k === 0) { x = c.hx; z = c.hz; age = 0; s = c.hs; } else if (k - 1 < c.count) {
            const j = (c.head - (k - 1) + TRAIL) % TRAIL;
            x = c.tx[j]; z = c.tz[j]; age = time - c.tt[j]; s = c.ts[j];
          } else { x = px; z = pz; age = WAKE_LIFE; s = 0; }
          if (age >= WAKE_LIFE) { age = WAKE_LIFE; s = 0; x = px; z = pz; } // spent: fold away
          // direction of travel from the next older point
          let dx, dz;
          if (k === 0 && c.count > 0) { const j = c.head; dx = c.hx - c.tx[j]; dz = c.hz - c.tz[j]; } else { dx = px - x; dz = pz - z; }
          const l = Math.sqrt(dx * dx + dz * dz);
          if (l > 1e-4) { dx /= l; dz /= l; } else { dx = 0; dz = 1; }
          const hw = 0.16 + age * SPREAD;
          setV(b + k * 2, x - dz * hw, 0.02, z + dx * hw, 0, -1, age, s);
          setV(b + k * 2 + 1, x + dz * hw, 0.02, z - dx * hw, 0, 1, age, s);
          if (s > 0) n++;
          px = x; pz = z;
        }
        if ((n > 1 || c.hs > 0.02) && c.shown) any = true;
        // Splash ring.
        const r = c.ring;
        const rv = b + TRAIL * 2;
        if (r.on) {
          r.t += dt / 1.3;
          if (r.t >= 1) r.on = false;
        }
        if (r.on) {
          const R = r.size * (0.6 + 0.8 * r.t);
          setV(rv, r.x - R, 0.014, r.z - R, 1, -1, -1, r.t);
          setV(rv + 1, r.x + R, 0.014, r.z - R, 1, 1, -1, r.t);
          setV(rv + 2, r.x + R, 0.014, r.z + R, 1, 1, 1, r.t);
          setV(rv + 3, r.x - R, 0.014, r.z + R, 1, -1, 1, r.t);
          if (c.shown) any = true;
        } else hideQuad(rv);
        // The "!" pops in with a little overshoot and bobs.
        const a = c.alert;
        a.k = Math.max(0, Math.min(1, a.k + (a.on ? dt * 6 : -dt * 5)));
        const av = rv + 4;
        if (a.k > 0.01) {
          const pop = a.on ? 1 + 0.25 * Math.sin(Math.min(1, a.k) * Math.PI) : a.k;
          const size = 0.34 * pop;
          billboard(av, 2, a.x, a.y + 0.06 * Math.sin(time * 7), a.z, size, size, Math.min(1, a.k * 1.5));
          any = true;
        } else hideQuad(av);
        // "SNAP!" grows, holds and fades.
        const s = c.snap;
        s.t += dt;
        const sv = av + 4;
        if (s.t < 1.1) {
          const grow = Math.min(1, s.t / 0.12);
          const k = (0.8 + 0.35 * grow) * (1 + 0.08 * Math.sin(s.t * 30) * (1 - grow));
          billboard(sv, 3, s.x, s.y + 0.25 * s.t, s.z, 0.72 * k, 0.36 * k, 1 - Math.max(0, (s.t - 0.75) / 0.35));
          any = true;
        } else hideQuad(sv);
      }
      posAttr.needsUpdate = true;
      fxAttr.needsUpdate = true;
      mesh.visible = any;
    },
  };
}
