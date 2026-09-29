// Debug hooks shared by every part of the game:
//   ?diag=1        JSON report in <pre id="diag"> after 60 rendered frames
//   ?view=top      orthographic top-down render of a fixed extent
//   ?cam=x,y,z,tx,ty,tz   fixed camera; ?t=hours; ?at=x,z[,heading]
//   ?debug=1       on-screen readout and collider circles; ?debug=spawns lizard
//                  spawn markers; ?debug=hosts lizard hosts; ?debug=all
//   ?nocut=1       no vegetation cut-out round the player
//   window.__game  handles for poking at the running game

import * as THREE from 'three';
import { FLAGS, CONFIG } from './config.js';

export const errors = [];
export const warnings = []; // console.warn lines, reported by ?diag=1 but not counted as failures

export function recordError(e, where = '') {
  const msg = e && e.stack ? String(e.stack).split('\n').slice(0, 3).join(' | ') : String(e);
  const line = where ? `${where}: ${msg}` : msg;
  if (errors.length < 50 && !errors.includes(line)) errors.push(line);
}

// Install as early as possible so load-time errors are caught too.
export function captureErrors() {
  for (const e of window.__earlyErrors || []) recordError(e, 'early');
  window.addEventListener('error', (ev) => recordError(ev.error || ev.message, 'window'));
  window.addEventListener('unhandledrejection', (ev) => recordError(ev.reason, 'promise'));
  const orig = console.error.bind(console);
  console.error = (...args) => {
    recordError(args.map((a) => (a && a.message) || String(a)).join(' '), 'console');
    orig(...args);
  };
  const origWarn = console.warn.bind(console);
  console.warn = (...args) => {
    const line = args.map((a) => (a && a.message) || String(a)).join(' ').slice(0, 300);
    if (warnings.length < 30 && !warnings.includes(line)) warnings.push(line);
    origWarn(...args);
  };
}

export function makeTopCamera() {
  const v = CONFIG.topView;
  const cx = (v.xmin + v.xmax) / 2, cz = (v.zmin + v.zmax) / 2;
  const hw = (v.xmax - v.xmin) / 2, hd = (v.zmax - v.zmin) / 2;
  const cam = new THREE.OrthographicCamera(-hw, hw, hd, -hd, 1, 1000);
  cam.up.set(0, 0, -1); // north up on screen, east to the right
  cam.position.set(cx, 400, cz);
  cam.lookAt(cx, 0, cz);
  cam.updateProjectionMatrix();
  return cam;
}

export function applyFixedCamera(camera) {
  const { pos, target } = FLAGS.cam;
  camera.position.set(pos[0], pos[1], pos[2]);
  camera.lookAt(target[0], target[1], target[2]);
}

function renderStats(renderer) {
  const r = renderer.info.render;
  return { calls: r.calls, triangles: r.triangles };
}

// Main-pass counts: one extra render with the shadow map frozen.
// three.js resets renderer.info after the shadow pass, so the usual counts are
// the main pass alone; a manual reset around one render adds the shadow pass.
export function measureMainPass(renderer, scene, camera) {
  renderer.render(scene, camera);
  const main = renderStats(renderer);
  renderer.info.autoReset = false;
  renderer.info.reset();
  renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, camera);
  const frame = renderStats(renderer);
  renderer.info.autoReset = true;
  return { main, frame };
}

export function writeDiag(game) {
  const { renderer, scene, camera, player, veg } = game;
  const { main, frame } = measureMainPass(renderer, scene, camera);
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const out = {
    ok: errors.length === 0 && game.ready === true,
    errors: [...errors],
    warnings: [...warnings],
    loadMs: Math.round(game.loadMs),
    drawCalls: main.calls,
    triangles: main.triangles,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    programs: renderer.info.programs ? renderer.info.programs.length : null,
    player: player && {
      x: +player.position.x.toFixed(3),
      y: +player.position.y.toFixed(3),
      z: +player.position.z.toFixed(3),
      heading: +player.heading.toFixed(4),
      walkable: game.data.terrain.isWalkable(player.position.x, player.position.z),
    },
    veg: veg ? veg.stats : null,
    props: game.props ? game.props.stats || { loaded: true } : null,
    collision: game.collision && { circles: game.collision.n, data: game.collision.dataCount, trunks: game.collision.trunks },
    frameDrawCalls: frame.calls, // main pass plus the shadow pass
    frameTriangles: frame.triangles,
    terrain: game.terrain && game.terrain.stats,
    modules: typeof game.stats === 'function' ? game.stats().modules : null, // lizards, croc
    view: FLAGS.view || (FLAGS.cam ? 'cam' : 'follow'),
    hours: game.sky ? +game.sky.state.hours.toFixed(2) : null,
    gl: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    pixelRatio: renderer.getPixelRatio(),
    canvas: [renderer.domElement.width, renderer.domElement.height],
  };
  const pre = document.getElementById('diag');
  if (pre) pre.textContent = JSON.stringify(out);
  return out;
}

// ?debug layers (see FLAGS.debug in config.js): the on-screen readout, collider
// circles, lizard spawn markers and the lizard hosts from veg.hosts. Returns a
// system with update(dt), or null when nothing needs updating each frame.
export async function makeDebugLayers(game) {
  const on = FLAGS.debug;
  if (!on) return null;
  if (on.has('colliders')) game.scene.add(colliderLines(game.data, game.collision));
  if (on.has('hosts') && game.veg) game.scene.add(hostLines(game.veg.hosts));
  if (on.has('spawns')) {
    try {
      const mod = await import('./world/vegetation.js');
      for (const m of spawnMarkers(mod.buildSpawnMarkers(game.data))) game.scene.add(m);
    } catch (e) {
      recordError(e, 'debug spawns');
    }
  }
  return on.has('readout') ? readout(game) : null;
}

function segmentLines(pts, cols, name) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  if (cols) g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const mat = new THREE.LineBasicMaterial({ color: cols ? 0xffffff : 0xff3355, vertexColors: !!cols, depthTest: false, fog: false });
  const lines = new THREE.LineSegments(g, mat);
  lines.renderOrder = 10;
  lines.frustumCulled = false;
  lines.name = name;
  return lines;
}

// Pushes a horizontal ellipse (or circle) as line segments.
function ring(pts, x, y, z, rx, rz, seg = 16) {
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
    pts.push(x + Math.cos(a0) * rx, y, z + Math.sin(a0) * rz, x + Math.cos(a1) * rx, y, z + Math.sin(a1) * rz);
  }
}

// Data circles in red, circles the vegetation added in orange, the props' in cyan.
function colliderLines(data, collision) {
  const T = data.terrain;
  const pts = [], cols = [];
  for (let i = 0; i < collision.n; i++) {
    const x = collision.cx[i], z = collision.cz[i], r = collision.cr[i];
    const from = pts.length;
    ring(pts, x, T.heightAt(x, z) + 0.05, z, r, r);
    const prop = (collision.owners[i] || '')[0] === 'X';
    const c = i < collision.dataCount ? [1, 0.2, 0.33] : prop ? [0.2, 0.9, 1] : [1, 0.62, 0.1];
    for (let k = from; k < pts.length; k += 3) cols.push(c[0], c[1], c[2]);
  }
  return segmentLines(pts, cols, 'debug-colliders');
}

// Trunks as axis lines with rings at both ends, crowns as three ellipses, branches
// and fronds as lines, palm crowns as rings, logs as their axis.
function hostLines(hosts) {
  const pts = [], cols = [];
  const colour = { trunk: [1, 0.55, 0.2], crown: [0.3, 1, 0.45], branch: [1, 0.95, 0.3], palm: [0.3, 0.85, 1], log: [0.9, 0.5, 1] };
  const add = (kind, from) => {
    const c = colour[kind];
    for (let i = from; i < pts.length; i += 3) cols.push(c[0], c[1], c[2]);
  };
  let n = 0;
  for (const t of hosts.trunks) {
    pts.push(t.x, t.y0, t.z, t.x, t.y1, t.z);
    ring(pts, t.x, t.y0, t.z, t.r0, t.r0, 8);
    ring(pts, t.x, t.y1, t.z, t.r1, t.r1, 8);
  }
  add('trunk', n); n = pts.length;
  for (const c of hosts.crowns) {
    ring(pts, c.cx, c.cy, c.cz, c.rx, c.rz, 16);
    ring(pts, c.cx, c.cy - c.ry * 0.7, c.cz, c.rx * 0.71, c.rz * 0.71, 12);
    ring(pts, c.cx, c.cy + c.ry * 0.7, c.cz, c.rx * 0.71, c.rz * 0.71, 12);
  }
  add('crown', n); n = pts.length;
  for (const b of hosts.branches) pts.push(...b.a, ...b.b);
  add('branch', n); n = pts.length;
  for (const p of hosts.palms) ring(pts, p.cx, p.cy, p.cz, p.r, p.r, 16);
  add('palm', n); n = pts.length;
  for (const l of hosts.logs || []) {
    const ax = Math.cos(l.rot) * l.len / 2, az = -Math.sin(l.rot) * l.len / 2;
    pts.push(l.x - ax, l.y + l.r, l.z - az, l.x + ax, l.y + l.r, l.z + az);
  }
  add('log', n);
  return segmentLines(pts, cols, 'debug-hosts');
}

// The spawn markers, plus a faint copy drawn through everything so hidden ones show.
function spawnMarkers(mesh) {
  const ghost = new THREE.InstancedMesh(mesh.geometry, new THREE.MeshBasicMaterial({
    color: 0xffffff, fog: false, transparent: true, opacity: 0.3, depthTest: false, depthWrite: false,
  }), mesh.count);
  ghost.instanceMatrix = mesh.instanceMatrix;
  ghost.instanceColor = mesh.instanceColor;
  ghost.boundingSphere = mesh.boundingSphere;
  ghost.renderOrder = 11;
  ghost.name = 'spawn-markers-ghost';
  return [mesh, ghost];
}

function readout(game) {
  const T = game.data.terrain;
  const el = document.createElement('div');
  el.className = 'debug-readout';
  document.getElementById('ui').appendChild(el);
  let acc = 0, frames = 0, fps = 0;
  return {
    name: 'debug',
    update(dt) {
      acc += dt; frames++;
      if (acc < 0.5) return;
      fps = frames / acc; acc = 0; frames = 0;
      const p = game.player, r = game.renderer.info.render;
      el.textContent =
        `fps ${fps.toFixed(0)}  calls ${r.calls}  tris ${(r.triangles / 1000).toFixed(0)}k\n` +
        `x ${p.position.x.toFixed(2)}  y ${p.position.y.toFixed(2)}  z ${p.position.z.toFixed(2)}  h ${p.heading.toFixed(2)}\n` +
        `${p.mode}  speed ${p.speed.toFixed(2)}  noise ${p.noise.toFixed(2)}  walkable ${T.isWalkable(p.position.x, p.position.z)}`;
    },
  };
}
