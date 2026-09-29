// Pulsing job markers: a soft ring on the ground and a bobbing diamond above it,
// one instanced mesh for every marker in the game (flag targets, logger targets,
// the field station). Owners set their own list; the instances are rebuilt only
// when a list changes. Animated in the vertex shader, so update() only sets time.
//
//   const markers = getMarkers(scene);
//   markers.set('flags', [{ x, y, z, colour, lift, scale }]);   markers.set('flags', null);
//
// scale (default 1) shrinks the whole marker, the diamond's 1.55 m height with it.

import * as THREE from 'three';

const MAX = 32;
let shared = null;

function markerGeometry() {
  const parts = [];
  // the ground ring, drawn flat just above the grass
  const ring = new THREE.RingGeometry(0.42, 0.56, 28, 1).rotateX(-Math.PI / 2);
  ring.translate(0, 0.06, 0);
  parts.push([ring, 0]);
  // an inner dotted ring
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const dot = new THREE.CircleGeometry(0.045, 8).rotateX(-Math.PI / 2);
    dot.translate(Math.cos(a) * 0.3, 0.065, Math.sin(a) * 0.3);
    parts.push([dot, 0]);
  }
  // the diamond above
  const gem = new THREE.OctahedronGeometry(0.13, 0);
  gem.scale(1, 1.5, 1);
  gem.translate(0, 1.55, 0);
  parts.push([gem, 1]);
  let n = 0;
  const flat = parts.map(([g, part]) => {
    const f = g.index ? g.toNonIndexed() : g;
    n += f.attributes.position.count;
    return [f, part];
  });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), prt = new Float32Array(n);
  let o = 0;
  for (const [g, part] of flat) {
    g.computeVertexNormals();
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    prt.fill(part, o, o + g.attributes.position.count);
    o += g.attributes.position.count;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('aPart', new THREE.BufferAttribute(prt, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.8, 0), 1.2);
  return geo;
}

export function getMarkers(scene) {
  if (shared) return shared;
  const geo = markerGeometry();
  const uTime = { value: 0 };
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, fog: true });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPart;\nuniform float uTime;\nvarying float vPart;\nvarying float vPulse;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vPart = aPart;
        float seed = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
        float pulse = 0.5 + 0.5 * sin(uTime * 3.4 + seed);
        vPulse = pulse;
        if (aPart < 0.5) {
          transformed.xz *= 0.92 + 0.16 * pulse;
        } else {
          transformed.y += 0.09 * sin(uTime * 2.2 + seed);
          float a = uTime * 1.6 + seed;
          float c = cos(a), s = sin(a);
          transformed.xz = mat2(c, -s, s, c) * transformed.xz;
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vPart;\nvarying float vPulse;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.a *= vPart > 0.5 ? 1.0 : 0.55 + 0.4 * vPulse;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), vPart > 0.5 ? 0.12 * vPulse : 0.18 * vPulse);`);
  };
  mat.customProgramCacheKey = () => 'job-markers-1';
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.name = 'job-markers';
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
  scene.add(mesh);

  const lists = new Map();
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  function rebuild() {
    let i = 0;
    for (const list of lists.values()) {
      for (const p of list) {
        if (i >= MAX) break;
        const k = p.scale || 1;
        m.makeScale(k, k, k).setPosition(p.x, p.y + (p.lift || 0), p.z);
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, col.set(p.colour || '#ff9ec4'));
        i++;
      }
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }

  shared = {
    mesh,
    set(owner, list) {
      if (list && list.length) lists.set(owner, list.slice());
      else lists.delete(owner);
      rebuild();
    },
    update(t) { uTime.value = t; },
    get count() { return mesh.count; },
  };
  return shared;
}
