// Boot: load the data, build the world, the player and the camera, then run
// the systems from renderer.setAnimationLoop (never a raw requestAnimationFrame
// loop, so a WebXR session can take the loop over later).

import { captureErrors, recordError, errors, makeTopCamera, applyFixedCamera, writeDiag, makeDebugLayers } from './debug.js';
captureErrors();

import * as THREE from 'three';
import { FLAGS, CONFIG } from './config.js';
import { loadGameData } from './data.js';
import { events } from './core/events.js';
import { Input } from './core/input.js';
import { buildSky } from './world/sky.js';
import { buildTerrain, isTrunkCircle } from './world/terrain.js';
import { buildWater } from './world/water.js';
import { buildAvatar } from './player/avatar.js';
import { Player } from './player/player.js';
import { Collision } from './player/collision.js';
import { FollowCamera } from './player/camera.js';

const loading = document.getElementById('loading');

function showHud() {
  if (FLAGS.nohud || FLAGS.view === 'top') return;
  const line = document.createElement('div');
  line.className = 'hud-line';
  line.innerHTML =
    '<b>WASD</b> or <b>arrow keys</b> to walk · hold <b>Shift</b> to run · ' +
    'hold <b>Ctrl</b> to creep · <b>drag</b> to look round · <b>scroll</b> to zoom';
  document.getElementById('ui').appendChild(line);
}

async function loadVegetation(data, renderer) {
  if (FLAGS.noveg) return null;
  try {
    const mod = await import('./world/vegetation.js');
    const veg = mod.buildVegetation({ data, renderer });
    if (!veg || !veg.group) throw new Error('buildVegetation returned no group');
    return veg;
  } catch (e) {
    recordError(e, 'vegetation');
    console.warn('Vegetation not loaded:', e);
    return null;
  }
}

// The props (signpost, field station, pond life) are optional: a missing module
// is fine, a broken one is reported.
async function loadProps(data, renderer, veg) {
  if (FLAGS.noprops) return null;
  if (veg && veg.props && veg.props.group) return veg.props; // already built by the vegetation
  let mod;
  try {
    mod = await import('./world/props.js');
  } catch (e) {
    if (/dynamically imported module|Importing a module script failed|error loading dynamically/i.test(String(e && e.message))) {
      console.info('No props module yet; carrying on without props.');
    } else {
      recordError(e, 'props');
    }
    return null;
  }
  try {
    if (typeof mod.buildProps !== 'function') return null;
    const props = mod.buildProps({ data, renderer });
    if (!props || !props.group) throw new Error('buildProps returned no group');
    return props;
  } catch (e) {
    recordError(e, 'props');
    console.warn('Props not loaded:', e);
    return null;
  }
}

// The gameplay modules. Each exports build(game), which returns
// { group?, update(dt, t), stats? }; it is stored as game[name]. A missing module
// is skipped, and ?no<name>=1 turns one off.
const OPTIONAL_SYSTEMS = [
  { name: 'lizards', path: './lizards/lizards.js' },
  { name: 'croc', path: './wildlife/croc.js' },
  // the tool ring with the grid flags, loggers, backpacks and tape
  // (game.tools), and the story: James, the phases and the set-up day (game.story)
  { name: 'tools', path: './tools/ring.js' },
  // catching: the loop pole on the ring, spotting, snug-the-loop and catch and release (game.catching)
  { name: 'catching', path: './catch/catching.js' },
  { name: 'story', path: './story/flow.js' },
  // the HUD, minimap, notebook, title, summary and the UI kit's layers (game.ui)
  { name: 'ui', path: './ui/ui.js' },
  // every sound, synthesised live (game.audio; ?noaudio=1 skips it)
  { name: 'audio', path: './audio/index.js' },
  // particles and small effects: leaves, dust, splashes, sparkles, fireflies, mist, shimmer (game.fx)
  { name: 'fx', path: './world/fx.js' },
  // the field kit's missions, each its own system (game.missions_<id>),
  // then the registry that wires them into James's requests, the HUD and the notebook
  { name: 'missions_tls', path: './missions/tls.js' },
  { name: 'missions_drone', path: './missions/drone.js' },
  { name: 'missions_rtk', path: './missions/rtk.js' },
  { name: 'missions', path: './missions/index.js' },
];
async function loadOptional(spec, game) {
  if (new RegExp('[?&]no' + spec.name + '(=(1|true|yes))?(&|$)').test(location.search)) return null;
  let mod;
  try {
    mod = await import(spec.path);
  } catch (e) {
    if (/dynamically imported module|Importing a module script failed|error loading dynamically/i.test(String(e && e.message))) {
      console.info('No ' + spec.name + ' module yet; carrying on without it.');
    } else {
      recordError(e, spec.name);
    }
    return null;
  }
  try {
    if (typeof mod.build !== 'function') return null;
    const sys = await mod.build(game);
    if (!sys) return null;
    if (sys.group) game.scene.add(sys.group);
    return sys;
  } catch (e) {
    recordError(e, spec.name);
    return null;
  }
}

// Grass tufts and the ground's grass pattern are optional too (?nograss=1 turns
// them off, for comparisons).
const NO_GRASS = /[?&]nograss(=(1|true|yes))?(&|$)/.test(location.search);
async function loadGrass(data, terrain, topView) {
  if (NO_GRASS) return null;
  let mod;
  try {
    mod = await import('./world/grass.js');
  } catch (e) {
    if (/dynamically imported module|Importing a module script failed|error loading dynamically/i.test(String(e && e.message))) {
      console.info('No grass module; carrying on without grass.');
    } else {
      recordError(e, 'grass');
    }
    return null;
  }
  try {
    const grass = mod.buildGrass({ data, terrain, topView });
    if (!grass || !grass.group) throw new Error('buildGrass returned no group');
    return grass;
  } catch (e) {
    recordError(e, 'grass');
    console.warn('Grass not loaded:', e);
    return null;
  }
}

// Extra collision circles in the colliders.json shape: the vegetation's solid
// bushes, then the props (owners X<i>).
function extraColliders(veg, props) {
  const circles = [], owners = [];
  const vc = veg && veg.colliders;
  if (vc && Array.isArray(vc.circles)) {
    vc.circles.forEach((c, i) => { circles.push(c); owners.push((vc.owners && vc.owners[i]) || 'V' + i); });
  } else if (Array.isArray(vc)) {
    vc.forEach((c, i) => { circles.push(c); owners.push('V' + i); });
  }
  const pc = props && props.colliders;
  if (Array.isArray(pc)) {
    pc.forEach((c, i) => {
      if (Array.isArray(c) && c.length >= 3 && c.every(Number.isFinite)) { circles.push([c[0], c[1], c[2]]); owners.push('X' + i); }
    });
  }
  return circles.length ? { circles, owners } : null;
}

async function boot() {
  const topView = FLAGS.view === 'top';
  if (topView) document.body.classList.add('view-top');

  const data = await loadGameData(CONFIG.dataBase);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(topView ? 1 : Math.min(window.devicePixelRatio || 1, CONFIG.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.tabIndex = 0;
  document.getElementById('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const C = CONFIG.camera;
  const camera = new THREE.PerspectiveCamera(C.fov, window.innerWidth / window.innerHeight, C.near, C.far);

  const sky = buildSky({ scene, data });
  sky.setTimeOfDay(FLAGS.t);
  const terrain = buildTerrain(data);
  scene.add(terrain.mesh, terrain.backdrop);
  const water = buildWater(data, sky, terrain.fields);
  scene.add(water.mesh);
  const grass = await loadGrass(data, terrain, topView);
  if (grass) {
    scene.add(grass.group);
    terrain.stats.grass = grass.stats; // shows in ?diag=1 under terrain
  }

  const veg = await loadVegetation(data, renderer);
  if (veg) scene.add(veg.group);

  const props = await loadProps(data, renderer, veg);
  const propsOwn = !!props && props !== (veg && veg.props); // not already inside the vegetation
  if (propsOwn) scene.add(props.group);

  const input = new Input(renderer.domElement);
  const P = CONFIG.player;
  const collision = new Collision(data, {
    radius: P.radius, gridRadius: P.gridRadius, maxStep: P.maxStep,
    extra: extraColliders(veg, props),
    trunkShrink: P.radius - P.trunkRadius,
    isTrunk: (i) => isTrunkCircle(data, i),
  });
  const avatar = buildAvatar();
  const player = new Player({ data, collision, avatar, input });
  scene.add(player.object);
  if (FLAGS.at) player.teleport(FLAGS.at.x, FLAGS.at.z, FLAGS.at.heading ?? player.heading);

  const rig = new FollowCamera(camera, { terrain: data.terrain, input });
  rig.follow(player);
  events.on('player:teleport', (p) => { rig.yaw = p.heading; rig.snap(); });

  let activeCamera = camera;
  if (topView) {
    activeCamera = makeTopCamera();
    scene.fog = null;
    // Sun nearly overhead, so the figure shows the layout rather than the shadows of one hour.
    sky.setSun(80, 160);
    water.uniforms.uRipple.value = 0.3; // no sun-glitter knit from straight above
    // With the sun this high the whole lake sits in the specular lobe and turns
    // pale mint; from straight above the water should show its own teal.
    water.mesh.material.specular.setScalar(0);
    sky.dome.visible = false;
    sky.clouds.visible = false;
    player.object.visible = false;
    rig.enabled = false;
  } else if (FLAGS.cam) {
    rig.enabled = false;
    applyFixedCamera(camera);
  }

  const game = {
    data, scene, renderer, camera: activeCamera, player, veg, props, grass, sky, terrain, water, collision, input, rig, events,
    ready: false, loadMs: 0, frame: 0, time: 0,
    teleport(x, z, heading) { player.teleport(x, z, heading); },
    setTimeOfDay(h) { sky.setTimeOfDay(h); },
    stats() {
      const r = renderer.info;
      return {
        drawCalls: r.render.calls, triangles: r.render.triangles,
        geometries: r.memory.geometries, textures: r.memory.textures,
        programs: r.programs ? r.programs.length : null,
        veg: veg ? veg.stats : null, props: props ? props.stats || null : null, terrain: terrain.stats,
        modules: Object.fromEntries(OPTIONAL_SYSTEMS.filter((o) => game[o.name]).map((o) => [o.name, game[o.name].stats || null])),
      };
    },
  };
  window.__game = game;

  // Systems run in order each frame; each has update(dt, t).
  const head = new THREE.Vector3();
  // The vegetation cut-out: a capsule from the camera to the player's head keeps
  // the player in sight. Off in the top view (no player) and with ?nocut=1.
  const cutOn = !FLAGS.nocut && !topView;
  const vegCtx = { cameraPosition: activeCamera.position, focus: cutOn ? head : null };
  const systems = [
    { name: 'player', update: (dt, t) => { player.moveYaw = rig.yaw; player.update(dt, t); } },
    { name: 'camera', update: (dt) => rig.update(dt) },
    { name: 'sky', update: (dt, t) => sky.update(dt, t, activeCamera) },
    { name: 'water', update: (dt, t) => water.update(dt, t) },
    { name: 'ground', update: (dt, t) => terrain.update(dt, t) },
  ];
  if (grass) {
    const grassCtx = { camera: activeCamera, player: player.position };
    systems.push({ name: 'grass', update: (dt, t) => grass.update(dt, t, grassCtx) });
  }
  if (propsOwn && typeof props.update === 'function') systems.push({ name: 'props', update: (dt, t) => props.update(dt, t) });
  if (veg) {
    systems.push({
      name: 'vegetation',
      update: (dt, t) => {
        if (cutOn) player.headPosition(head);
        veg.update(dt, t, vegCtx);
      },
    });
  }
  game.systems = systems;
  for (const spec of OPTIONAL_SYSTEMS) {
    const sys = await loadOptional(spec, game);
    if (!sys) continue;
    game[spec.name] = sys;
    if (typeof sys.update === 'function') systems.push({ name: spec.name, update: (dt, t) => sys.update(dt, t) });
  }
  const debugSystem = await makeDebugLayers(game);
  if (debugSystem) systems.push(debugSystem);
  game.systems = systems;

  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', onResize);

  showHud();
  game.loadMs = performance.now();
  game.ready = true;

  let last = performance.now();
  let diagErrors = 0;
  const failed = new Set();
  function tick() {
    const now = performance.now();
    lastTick = now;
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    game.time += dt;
    input.update(dt);
    for (const s of systems) {
      if (failed.has(s)) continue;
      try { s.update(dt, game.time); } catch (e) { failed.add(s); recordError(e, s.name); }
    }
    renderer.render(scene, activeCamera);
    input.endFrame();
    lastTick = performance.now();
    game.frame++;
    if (game.frame === 2) {
      loading.classList.add('done');
      setTimeout(() => { loading.style.display = 'none'; }, 600);
    }
    // ?diag=1: the report after 60 frames, written again if an error turns up later
    if (FLAGS.diag && (game.frame === 60 || (game.frame > 60 && errors.length !== diagErrors))) {
      diagErrors = errors.length;
      writeDiag(game);
    }
  }
  renderer.setAnimationLoop(tick);

  // A headless browser (tools/shot.py) delivers no animation frames, so there,
  // and only there (FLAGS.headless), stalled frames are pumped from a timer.
  // Normal play and XR run purely from setAnimationLoop.
  let lastTick = performance.now();
  if (FLAGS.headless) {
    setInterval(() => {
      if (renderer.xr.isPresenting || document.visibilityState !== 'visible') return;
      if (performance.now() - lastTick > 120) tick();
    }, 40);
  }
}

boot().catch((e) => {
  recordError(e, 'boot');
  console.warn(e);
  loading.classList.add('failed');
  loading.querySelector('.loading-text').textContent = 'The island could not be loaded: ' + (e.message || e);
  if (FLAGS.diag) {
    const pre = document.getElementById('diag');
    pre.textContent = JSON.stringify({ ok: false, errors: [...errors], fatal: String((e && e.stack) || e) });
  }
});
