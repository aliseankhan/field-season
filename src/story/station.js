// The field station's kit, back on the table once the ibises' mess is put right in
// the opening: a striped sunshade over the folding table, a stack of clear lizard
// bags, the spring scale on its little stand with the ruler beside it, the paint
// pens in a jar, the clipboard and specimen jars and the field notebook open on the
// table. One merged mesh (one draw call), shown with a small pop once the table is
// set upright (the table itself is the props' own mesh, src/world/props.js).

import * as THREE from 'three';
import { toonGradient } from '../player/avatar.js';

// The folding table from props.js (PROP_SPOTS.table): centre, top height, turn.
export const TABLE = { x: -13.42, z: 43.75, top: 0.72, rot: 0 };
const SHADE = { x: -13.95, z: 44.05 };
// the field notebook's cover, the same warm orange as the one found in the kit hunt
export const NOTEBOOK_COVER = '#ef7d4f';

function part(g, colour) {
  const f = g.index ? g.toNonIndexed() : g;
  f.computeVertexNormals();
  const c = new THREE.Color(colour);
  const n = f.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  f.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (f.attributes.uv) f.deleteAttribute('uv');
  return f;
}

function mergeParts(parts) {
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array, o * 3);
    nor.set(p.attributes.normal.array, o * 3);
    col.set(p.attributes.color.array, o * 3);
    o += p.attributes.position.count;
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

// Built in the table's frame (origin on the ground under the table centre; the table
// runs along z, 0.56 m wide and 1.04 m long).
function kitGeometry(groundAt) {
  const P = [];
  const H = TABLE.top;
  const at = (g, x, y, z) => g.translate(x, y, z);
  // the sunshade: a pole, a scalloped canopy of coral and cream panels, a knob
  const sx = SHADE.x - TABLE.x, sz = SHADE.z - TABLE.z;
  const gy = groundAt(SHADE.x, SHADE.z) - groundAt(TABLE.x, TABLE.z);
  P.push(part(at(new THREE.CylinderGeometry(0.022, 0.026, 2.3, 8), sx, gy + 1.1, sz), '#f4efe2'));
  const panels = 10;
  for (let k = 0; k < panels; k++) {
    const g = new THREE.ConeGeometry(1.15, 0.42, 3, 1, true, (k / panels) * Math.PI * 2, (Math.PI * 2) / panels);
    P.push(part(at(g, sx, gy + 2.12, sz), k % 2 ? '#fff4e0' : '#ff8a6b'));
    const lip = new THREE.SphereGeometry(0.06, 6, 4);
    const a = ((k + 0.5) / panels) * Math.PI * 2;
    P.push(part(at(lip, sx + Math.sin(a) * 1.08, gy + 1.9, sz + Math.cos(a) * 1.08), k % 2 ? '#ff8a6b' : '#fff4e0'));
  }
  P.push(part(at(new THREE.SphereGeometry(0.05, 8, 6), sx, gy + 2.36, sz), '#ffcf3f'));
  // a stack of clear lizard bags, slightly fanned, with a coral twist tie
  for (let k = 0; k < 4; k++) {
    const g = new THREE.BoxGeometry(0.16, 0.008, 0.22);
    g.rotateY(k * 0.09 - 0.12);
    P.push(part(at(g, -0.14, H + 0.01 + k * 0.009, 0.34), k % 2 ? '#dff4ff' : '#c9ecff'));
  }
  P.push(part(at(new THREE.BoxGeometry(0.03, 0.012, 0.03), -0.19, H + 0.05, 0.42), '#ff6f61'));
  // the spring scale hanging from a little stand at the far end of the table
  P.push(part(at(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 6), 0.2, H + 0.21, -0.44), '#9aa6ad'));
  P.push(part(at(new THREE.BoxGeometry(0.16, 0.012, 0.12), 0.2, H + 0.006, -0.44), '#8a5a3c'));
  P.push(part(at(new THREE.BoxGeometry(0.12, 0.012, 0.012), 0.15, H + 0.42, -0.44), '#9aa6ad'));
  P.push(part(at(new THREE.CylinderGeometry(0.016, 0.016, 0.16, 8), 0.1, H + 0.31, -0.44), '#62d26f'));
  P.push(part(at(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 8), 0.1, H + 0.4, -0.44), '#3f8f4c'));
  P.push(part(at(new THREE.TorusGeometry(0.018, 0.004, 4, 10).rotateY(Math.PI / 2), 0.1, H + 0.215, -0.44), '#9aa6ad'));
  // the ruler beside it, a yellow strip with dark ticks
  const ruler = new THREE.BoxGeometry(0.04, 0.006, 0.3);
  ruler.rotateY(0.18);
  P.push(part(at(ruler, 0.19, H + 0.004, -0.18), '#ffd24a'));
  for (let k = 0; k < 6; k++) {
    const tick = new THREE.BoxGeometry(0.018, 0.003, 0.004);
    tick.rotateY(0.18);
    P.push(part(at(tick, 0.18 + Math.sin(0.18) * (k * 0.05 - 0.12), H + 0.008, -0.18 + Math.cos(0.18) * (k * 0.05 - 0.12)), '#5a4a38'));
  }
  // the paint pens standing in a jar
  P.push(part(at(new THREE.CylinderGeometry(0.035, 0.032, 0.09, 10, 1, true), -0.17, H + 0.045, -0.34), '#bfe6ef'));
  ['#ff4fa3', '#3ec7ff', '#ffb52e'].forEach((c, k) => {
    const a = (k / 3) * Math.PI * 2;
    const pen = new THREE.CylinderGeometry(0.009, 0.009, 0.14, 6);
    pen.rotateZ(0.12 * Math.cos(a)); pen.rotateX(0.12 * Math.sin(a));
    P.push(part(at(pen, -0.17 + Math.cos(a) * 0.014, H + 0.08, -0.34 + Math.sin(a) * 0.014), c));
    P.push(part(at(new THREE.CylinderGeometry(0.0095, 0.0095, 0.03, 6), -0.17 + Math.cos(a) * 0.02, H + 0.16, -0.34 + Math.sin(a) * 0.02), '#fff8ec'));
  });
  // the clipboard with its field sheet, and two specimen jars
  const clip = new THREE.BoxGeometry(0.24, 0.012, 0.32);
  clip.rotateY(0.12);
  P.push(part(at(clip, -0.1, H + 0.008, -0.05), '#8a5a3c'));
  const sheet = new THREE.BoxGeometry(0.2, 0.006, 0.27);
  sheet.rotateY(0.12);
  P.push(part(at(sheet, -0.1, H + 0.016, -0.04), '#fffdf6'));
  P.push(part(at(new THREE.CylinderGeometry(0.05, 0.05, 0.13, 10), 0.17, H + 0.065, 0.42), '#bfe6ef'));
  P.push(part(at(new THREE.CylinderGeometry(0.054, 0.054, 0.03, 10), 0.17, H + 0.145, 0.42), '#ff8a5c'));
  P.push(part(at(new THREE.CylinderGeometry(0.043, 0.043, 0.11, 10), 0.05, H + 0.055, 0.45), '#bfe6ef'));
  P.push(part(at(new THREE.CylinderGeometry(0.047, 0.047, 0.03, 10), 0.05, H + 0.125, 0.45), '#6fc3d9'));
  // the notebook, open, with a pencil
  const book = new THREE.BoxGeometry(0.14, 0.012, 0.2);
  book.rotateY(-0.25);
  P.push(part(at(book, 0.14, H + 0.032, 0.16), '#fff8e6'));
  const cover = new THREE.BoxGeometry(0.3, 0.006, 0.21);
  cover.rotateY(-0.25);
  P.push(part(at(cover, 0.14, H + 0.024, 0.16), NOTEBOOK_COVER));
  P.push(part(at(new THREE.CylinderGeometry(0.006, 0.006, 0.14, 5).rotateZ(Math.PI / 2).rotateY(0.6), 0.18, H + 0.044, 0.21), '#ffd84a'));
  return mergeParts(P);
}

export function buildStation(game) {
  const T = game.data.terrain;
  const ground = (x, z) => Math.max(0, T.heightAt(x, z));
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });
  const mesh = new THREE.Mesh(kitGeometry(ground), mat);
  mesh.name = 'station-kit';
  mesh.position.set(TABLE.x, ground(TABLE.x, TABLE.z), TABLE.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.visible = false;
  let pop = 1;
  return {
    mesh,
    table: TABLE,
    get shown() { return mesh.visible; },
    show(animate = true) {
      mesh.visible = true;
      pop = animate ? 0 : 1;
      mesh.scale.setScalar(animate ? 0.01 : 1);
    },
    hide() { mesh.visible = false; },
    update(dt) {
      if (pop >= 1) return;
      pop = Math.min(1, pop + dt / 0.6);
      const e = pop;
      const s = e < 0.5 ? (e / 0.5) * 1.1 : 1 + 0.1 * Math.exp(-(e - 0.5) * 10) * Math.cos((e - 0.5) * 25);
      mesh.scale.set(1, Math.max(0.01, s), 1);
    },
  };
}

