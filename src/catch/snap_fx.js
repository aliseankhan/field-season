// A floss loop snapping off the pole tip (breaks.js): the loop's two halves whip away from
// the tip and fall as two short strands, with a small white burst where it went.
//
//   const fx = buildSnapFx(game)   built the first time a loop snaps: three.js draws on
//                                  Math.random for every object's id
//   fx.play(loopBone)              the avatar's loop bone, before it is hidden
//   fx.update(dt)                  every frame (breaks.update)
//   fx.active, fx.t                playing, and seconds since it started
//   fx.rate                        time scale (1; 0 holds it still)

import * as THREE from 'three';

const N = 7; // points along each strand
const SEG = N - 1;
const RING_R = 0.11, RING_Y = -0.215; // the loop's ring in the loop bone's frame (avatar.js)
const LIFE = 1.8; // seconds until the strands are tidied away
const BURST = 0.28; // seconds the white burst shows
const GRAVITY = 9.8;
const H = 1 / 120; // the strands' time step

// a white starburst, drawn once
function burstTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.translate(64, 64);
  const rays = 9;
  g.beginPath();
  for (let i = 0; i < rays * 2; i++) {
    const a = (i / (rays * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? 20 : i % 4 ? 46 : 60;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.lineJoin = 'round';
  g.lineWidth = 7;
  g.strokeStyle = 'rgba(90, 60, 50, 0.55)';
  g.stroke();
  g.fillStyle = '#ffffff';
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildSnapFx(game) {
  const T = game.data.terrain;
  const group = new THREE.Group();
  group.name = 'snap-fx';
  group.visible = false;
  game.scene.add(group);

  const geo = new THREE.CylinderGeometry(0.011, 0.011, 1, 5, 1);
  const mat = new THREE.MeshBasicMaterial({ color: '#ff6f61' });
  const strands = new THREE.InstancedMesh(geo, mat, 2 * SEG);
  strands.frustumCulled = false;
  group.add(strands);
  const burst = new THREE.Sprite(new THREE.SpriteMaterial({ map: burstTexture(), transparent: true, depthTest: false, depthWrite: false }));
  burst.renderOrder = 10;
  group.add(burst);

  // two strands of N points: position, last position
  const P = [0, 1].map(() => Array.from({ length: N }, () => ({ p: new THREE.Vector3(), q: new THREE.Vector3() })));
  const segLen = (Math.PI * RING_R) / SEG;
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _d = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0), _side = new THREE.Vector3(), _centre = new THREE.Vector3(), _v = new THREE.Vector3();

  const fx = { active: false, t: 0, rate: 1, group, play, update };
  let acc = 0;

  function play(bone) {
    bone.updateWorldMatrix(true, false);
    const W = bone.matrixWorld;
    _centre.set(0, RING_Y, 0).applyMatrix4(W);
    _side.set(1, 0, 0).transformDirection(W);
    for (let s = 0; s < 2; s++) {
      const sign = s ? -1 : 1;
      for (let i = 0; i < N; i++) {
        // from the knot under the tip (i = 0) round to the bottom, where it went
        const a = (i / SEG) * Math.PI * sign, u = i / SEG;
        const pt = P[s][i];
        pt.p.set(RING_R * Math.sin(a), RING_Y + RING_R * Math.cos(a), 0).applyMatrix4(W);
        // out to the side and up, the loose end fastest (a whip), a little spin either way
        _v.copy(_side).multiplyScalar(sign * (1.1 + 1.9 * u))
          .addScaledVector(_up, 1.0 + 2.4 * u + 0.4 * Math.sin(i * 1.7 + s))
          .addScaledVector(_d.subVectors(pt.p, _centre), 6 * (0.5 + u));
        pt.q.copy(pt.p).addScaledVector(_v, -H);
      }
    }
    fx.t = 0;
    acc = 0;
    fx.active = true;
    group.visible = true;
    burst.position.copy(_centre);
    burst.visible = true;
    draw();
  }

  function simulate() {
    const h = H, k = Math.exp(-1.6 * h); // (air drag)
    for (const S of P) {
      for (const pt of S) {
        const x = pt.p.x, y = pt.p.y, z = pt.p.z;
        pt.p.x += (x - pt.q.x) * k;
        pt.p.y += (y - pt.q.y) * k - GRAVITY * h * h;
        pt.p.z += (z - pt.q.z) * k;
        pt.q.set(x, y, z);
        const floor = Math.max(T.heightAt(pt.p.x, pt.p.z), 0) + 0.012;
        if (pt.p.y < floor) { pt.p.y = floor; pt.q.x = pt.p.x - (pt.p.x - pt.q.x) * 0.3; pt.q.z = pt.p.z - (pt.p.z - pt.q.z) * 0.3; pt.q.y = floor; }
      }
      // the floss keeps its length
      for (let it = 0; it < 3; it++) {
        for (let i = 0; i < SEG; i++) {
          const a = S[i].p, b = S[i + 1].p;
          _d.subVectors(b, a);
          const L = _d.length() || 1e-6, f = (L - segLen) / L / 2;
          a.addScaledVector(_d, f);
          b.addScaledVector(_d, -f);
        }
      }
    }
  }

  function draw() {
    let n = 0;
    for (const S of P) {
      for (let i = 0; i < SEG; i++) {
        const a = S[i].p, b = S[i + 1].p;
        _d.subVectors(b, a);
        const L = _d.length();
        _q.setFromUnitVectors(_up, L > 1e-6 ? _d.multiplyScalar(1 / L) : _up);
        _m.compose(_s.addVectors(a, b).multiplyScalar(0.5), _q, _v.set(1, Math.max(L, 1e-3), 1));
        strands.setMatrixAt(n++, _m);
      }
    }
    strands.instanceMatrix.needsUpdate = true;
    const b = Math.min(1, fx.t / BURST);
    burst.visible = b < 1;
    burst.scale.setScalar(0.1 + 0.26 * Math.sqrt(b));
    burst.material.opacity = b < 0.6 ? 1 : 1 - (b - 0.6) / 0.4;
    burst.material.rotation = 0.6 * b;
  }

  function update(dt) {
    if (!fx.active) return;
    const d = Math.min(0.05, dt) * fx.rate;
    if (d <= 0) return;
    fx.t += d;
    if (fx.t >= LIFE) { fx.active = false; group.visible = false; return; }
    for (acc += d; acc >= H; acc -= H) simulate();
    draw();
  }

  return fx;
}
