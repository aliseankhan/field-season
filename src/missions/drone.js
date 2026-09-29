// The drone survey: the lab flew a drone over Lizard Island at 150 ft
// in lawnmower lines and stitched the photos into one map. Here a cute little
// quadcopter waits on a pad by the field station; take the drone controller from
// the tool ring there and it lifts off, the camera follows it, and you fly it
// through ten glowing rings laid out as the survey's lanes, then home for a soft
// landing on the H. The reward is an aerial photo of the island, rendered from
// straight above at that hour, for the notebook and the big map's aerial layer.
//
// Mission interface (src/missions/index.js): build(game) -> { id, title, tool,
// available(), start(opts), active, update, progress(), notebook(), stats }, and the
// events mission:start, mission:step { step }, mission:done { stars, points },
// mission:fail { why: 'water' | 'battery' }.
//
// Flying, on the input action layer (so a VR controller can map onto it): move (WASD,
// arrows, a stick) flies, tool and use (Q and E) turn it left and right (the camera
// follows), climb (Space) and descend (C, or Ctrl) go up and down, jog (Shift) is
// faster, look (drag) turns the camera, zoom (wheel) moves it in and out, stow (X)
// flies home and lands by itself. While the drone is up the ring's quick keys are held
// back, the player stands still at the pad and the day's clock waits.
//
// In the 150 ft band the drone's camera takes a photo of each patch of the island it
// passes over, one a lane every 12 m (a soft shutter tick, and the plan's dots there turn
// mint); the aerial print at the end leaves any patch never photographed as blank paper.
//
// The battery: a star needs 35 % left, it warns at 20 % and flies itself home at 10 %
// (at 3 % once all ten rings are through). Flown home with a map's worth of rings, it
// stops 4 m over the pad and hands the controls back for the landing. Coming down near
// the pad, the camera tips to look down on it, a dotted drop line and a gold ring on
// the pad show where it will land, and the key strip steps aside.
//
// The 150 ft is played at 30 m (the island's tallest crowns reach about 20 m), and
// the height readout counts 5 ft a metre so the survey height reads 150 ft. The
// tallest crowns (the rainbow eucalyptus, the talipot palms, the osprey pole) are
// solid: a bump wobbles the drone and costs battery; any other canopy is a soft
// floor it skims over; the lake is a splashy fail that sends it home.
//
// Flags: ?mission=drone (with the survey day it implies) stands you at the pad and
// launches; &missionstep=pad|takeoff|hello|rings|lanes|high|osprey|land|splash|photo|map|notebook
// sets up that moment for a check image; ?dronelog=1 writes the flight's state as JSON
// into <pre id="drone-log"> once a second. window.__game.play.drone: start(), launch(),
// auto(on) (flies the whole survey and lands through the real controls), home(),
// place(x, y, z), leafTop(x, z), state(), gotoPad(), photos() (the lane photos taken).
// A headless script can drive those (a whole survey, a flight home, a splash) and check
// each outcome. mission.hintPad(on) shows the pad's job
// marker before the mission starts (for James's offer).
//
// Taken from the ring without James, he says so in a toast (SCRIPT.missions.selfStart).
// The aerial photo develops over the frames after the landing (drone_photo.js), so the
// touchdown never waits on the GPU; the flight's shaders are compiled at load.
//
// Gamepad: the left stick flies, the right stick looks, the d-pad's up and down climb
// and descend, RB is faster, B flies home, X and A turn it (the tool and use buttons).

import * as THREE from 'three';
import { events } from '../core/events.js';
import { state, clockText, holdClock, save } from '../game/state.js';
import { missionPoints } from '../game/rules.js';
import * as kit from '../ui/kit.js';
import { registerTool, registerInteraction, equip, current } from '../tools/ring.js';
import { getMarkers } from '../tools/markers.js';
import { vegUniforms } from '../world/wind.js';
import { FLAGS } from '../config.js';
import { SCRIPT, say as sayLine } from '../story/script.js';
import * as SFX from '../audio/sfx.js';
import { missionRecord } from './index.js';
import { buildKitMesh, buildOsprey, buildRings, buildPathDots, buildDropLine, buildBlob, SKID_Y, PAD, RING_R } from './drone_model.js';
import { buildDroneHud, photoCard, notebookPage } from './drone_hud.js';
import { startAerialPhoto, warmAerialPhoto, drawMapMarks, PHOTO_EXTENT } from './drone_photo.js';

const ID = 'drone';
const TITLE = 'Drone survey';
const FT_PER_M = 5; // the game's 150 ft is 30 m
const SURVEY_M = 30;

// Where things are: the pad on the landing by the field station, in the open between
// the path, the bucket and the flag (the causeway itself runs under the mangroves),
// and the player's spot beside it on the path.
const PAD_AT = { x: -9.55, z: 44.75 };
const STAND = { x: -10.35, z: 45.5, heading: 0.1 }; // south-west of it, facing up the landing to the causeway
const LAUNCH_R = 2.6; // how near the pad the controller launches it

// The survey: five lanes across the island, a ring at each end, flown south to north.
const LANES = [26, 12, -2, -16, -30];
const WEST = -30, EAST = 42;
// Along each lane a photo spot every 12 m (the rings sit on the end ones)
const SNAP_GAP = 12;
const SNAPS_PER_LANE = Math.round((EAST - WEST) / SNAP_GAP) + 1;

// Every number the flight plays by.
export const DRONE = {
  cruise: 8, fast: 13, // m/s across
  climb: 4.5, climbFast: 6.5, sink: 3.5, sinkFast: 5, landSink: 1.1, // m/s up and down (landSink over the pad)
  accel: 2.0, vAccel: 3.0, // 1/s: how quickly it takes up the stick (gentle momentum)
  turn: 1.92, // rad/s: Q and E turn it (110 degrees a second), the camera following
  ceiling: 45, // m over the pad (225 ft)
  range: { x0: -80, x1: 100, z0: -70, z1: 62 },
  wind: { speed: 1.0, yaw: 2.1, gust: 0.45 }, // m/s at survey height, blowing towards yaw (three.js heading)
  // % a second, % a knock; it warns at `low`, flies home at `home` (at `homeAll` once all
  // ten rings are through), and a flight home with a map's worth of rings stops `handBackY`
  // m over the pad and hands the landing back (unless the battery is under `handBack`)
  battery: { hover: 0.28, move: 0.16, climb: 0.3, bump: 5, bird: 6, ground: 2, low: 20, home: 10, homeAll: 3, handBack: 0.5, handBackY: 4 },
  stars: { rings: 10, battery: 35, soft: { vy: 1.6, speed: 1.0, off: 0.45 } },
  minRings: 6, // rings for a map (fewer, and a landing is a pit stop)
  snap: { band: 2.6 }, // the lane photos: taken within band m of 150 ft (the height tape's green band)
  osprey: { patrolR: 7, patrolY: 25, speed: 5, chase: 9, notice: 17, giveUp: 30, cooldown: 5, hit: 1.25 },
  // the chase camera: lift-off high enough to look over the player's hat, then the cruise
  // framing; coming in to land (within landR m of the pad, from the survey height down) it tips down onto the pad
  camera: { dist: 6.2, minDist: 3, maxDist: 20, pitch: 0.4, fov: 55, liftPitch: 0.72, liftDist: 6.6, landR: 10, landY: 34, landPitch: 0.85, landDist: 5 },
};
const TALL = new Set(['rainbow_eucalyptus', 'talipot', 'osprey_pole']);

const params = new URLSearchParams(location.search);
const FLAG = params.get('mission') === ID;
const STEP = FLAG ? (params.get('missionstep') || 'takeoff') : null;

const wrap = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = (k, dt) => 1 - Math.exp(-k * dt);
// lengths without Math.hypot, which allocates on every call in V8 (these run each frame)
const len2 = (a, b) => Math.sqrt(a * a + b * b);
const len3 = (a, b, c) => Math.sqrt(a * a + b * b + c * c);

export async function build(game) {
  const { scene, player, rig, camera, data, input } = game;
  const T = data.terrain;
  const topView = FLAGS.view === 'top';
  const padY = Math.max(0.05, T.heightAt(PAD_AT.x, PAD_AT.z));
  const padTop = padY + PAD.h;
  const surveyY = padTop + SURVEY_M;

  // ---------------------------------------------------------------- the plan
  const corners = [];
  for (let i = 0; i < LANES.length; i++) {
    const z = LANES[i];
    if (i % 2 === 0) corners.push([WEST, z], [EAST, z]); else corners.push([EAST, z], [WEST, z]);
  }
  const rings = corners.map(([x, z], i) => {
    const [fx, fz] = i ? corners[i - 1] : [PAD_AT.x, PAD_AT.z];
    return { x, y: surveyY, z, yaw: Math.atan2(-(x - fx), -(z - fz)), n: i + 1 };
  });
  const NR = rings.length;
  const passed = new Array(NR).fill(false);
  const side = new Float64Array(NR); // the drone's side of each ring's plane last frame
  // each ring as numbers (x, y, z and the way through it, fx, fz), for the per-frame test
  const RG = new Float64Array(NR * 5);
  for (let i = 0; i < NR; i++) {
    const r = rings[i];
    RG[i * 5] = r.x; RG[i * 5 + 1] = r.y; RG[i * 5 + 2] = r.z; RG[i * 5 + 3] = -Math.sin(r.yaw); RG[i * 5 + 4] = -Math.cos(r.yaw);
  }
  const PAD_RING = NR; // the ring mesh's last instance: the gold landing ring round the pad

  // the photo spots along the lanes, lane by lane from west to east: taken[k] once photographed
  const NS = LANES.length * SNAPS_PER_LANE;
  const taken = new Uint8Array(NS);
  const SPOTS = Array.from({ length: NS }, (_, k) => [WEST + (k % SNAPS_PER_LANE) * SNAP_GAP, LANES[Math.floor(k / SNAPS_PER_LANE)]]);
  // the island's photo in cells, one a spot: each lane's band runs halfway to its
  // neighbours (the outer ones to the photo's edge), each spot's halfway to the next
  const cellOf = (k) => {
    const li = Math.floor(k / SNAPS_PER_LANE), si = k % SNAPS_PER_LANE;
    const z = LANES[li], xs = WEST + si * SNAP_GAP;
    const zA = li > 0 ? (LANES[li - 1] + z) / 2 : PHOTO_EXTENT.z1, zB = li < LANES.length - 1 ? (LANES[li + 1] + z) / 2 : PHOTO_EXTENT.z0;
    return { x0: si ? xs - SNAP_GAP / 2 : PHOTO_EXTENT.x0, x1: si < SNAPS_PER_LANE - 1 ? xs + SNAP_GAP / 2 : PHOTO_EXTENT.x1, z0: Math.min(zA, zB), z1: Math.max(zA, zB) };
  };

  // ---------------------------------------------------------------- the world
  const group = new THREE.Group();
  group.name = 'mission-drone';
  if (topView) group.visible = false;
  const kitM = buildKitMesh([PAD_AT.x, padY, PAD_AT.z]);
  const bird = buildOsprey();
  const ringM = buildRings([...rings, { x: PAD_AT.x, y: padTop + 0.07, z: PAD_AT.z, flat: true, scale: 0.25 }]);
  const dots = buildPathDots([{ x: PAD_AT.x, y: padTop + 2.5, z: PAD_AT.z }, ...rings, { x: PAD_AT.x, y: padTop + 12, z: PAD_AT.z }]);
  const drop = buildDropLine();
  const blob = buildBlob();
  group.add(kitM.mesh, bird.mesh, ringM.mesh, dots.points, drop.points, blob.mesh);
  const U = kitM.uniforms, BU = bird.uniforms;
  U.uShow.value.set(1, 0, 1, 1);

  // the pad and the windsock's pole are solid
  if (game.collision && game.collision.addDynamic) {
    game.collision.addDynamic(PAD_AT.x, PAD_AT.z, PAD.r + 0.02);
    game.collision.addDynamic(kitM.sock.x, kitM.sock.z, 0.08);
  }

  // the controller rides on the right arm's bone, turned upright like the other held tools
  const av = player.avatar;
  const anchor = new THREE.Object3D();
  anchor.name = 'drone-controller-anchor';
  if (av && av.bones && av.bones.armR) {
    av.bones.armR.add(anchor);
    anchor.position.set(0.025, -0.28, -0.01);
    U.uHand.value = anchor.matrixWorld; // read at draw time, after the scene's matrices update
  }

  // the tall crowns and trunks that are solid to the drone, from the drawn vegetation
  const hard = [];
  const lms = data.placements.landmarks || [];
  const tallOwners = new Map();
  lms.forEach((l, i) => { if (TALL.has(l.kind)) tallOwners.set('L' + i, l); });
  const hosts = game.veg && game.veg.hosts;
  if (hosts) {
    for (const c of hosts.crowns || []) if (tallOwners.has(c.owner)) hard.push({ kind: 'crown', cx: c.cx, cy: c.cy, cz: c.cz, rx: c.rx, ry: c.ry, rz: c.rz, lm: tallOwners.get(c.owner) });
    for (const p of hosts.palms || []) if (tallOwners.has(p.owner)) hard.push({ kind: 'crown', cx: p.cx, cy: p.cy, cz: p.cz, rx: p.r, ry: p.r * 0.55, rz: p.r, lm: tallOwners.get(p.owner) });
    for (const t of hosts.trunks || []) if (tallOwners.has(t.owner)) hard.push({ kind: 'trunk', x: t.x, z: t.z, y0: t.y0, y1: t.y1, r: Math.max(t.r0, t.r1), lm: tallOwners.get(t.owner) });
  }
  if (!hard.length) {
    for (const l of tallOwners.values()) {
      const top = l.y + l.height, base = l.y + l.crown_base;
      hard.push({ kind: 'crown', cx: l.crown_x ?? l.x, cy: (top + base) / 2, cz: l.crown_z ?? l.z, rx: l.crown_w_ew / 2, ry: Math.max(0.6, (top - base) / 2), rz: l.crown_w_ns / 2, lm: l });
      hard.push({ kind: 'trunk', x: l.x, z: l.z, y0: l.y, y1: base, r: Math.max(0.15, l.dbh / 2), lm: l });
    }
  }
  // packed as numbers for the per-frame test: crowns (cx, cy, cz, rx, ry, rz), trunks
  // (x, z, y0, y1, r), each with its landmark for the bump's message
  const hardCrowns = hard.filter((o) => o.kind === 'crown'), hardTrunks = hard.filter((o) => o.kind !== 'crown');
  const HC = new Float64Array(hardCrowns.length * 6), HT = new Float64Array(hardTrunks.length * 5);
  hardCrowns.forEach((o, i) => HC.set([o.cx, o.cy, o.cz, o.rx, o.ry, o.rz], i * 6));
  hardTrunks.forEach((o, i) => HT.set([o.x, o.z, o.y0, o.y1, o.r], i * 5));
  const NHC = hardCrowns.length, NHT = hardTrunks.length;
  // Every other drawn crown, palm and bush is a soft floor the drone skims over: their
  // tops rasterised once into a 1 m grid (the lidar canopy grid is no use here, since
  // it holds the garden's trees over the landing that the game does not draw).
  const FG = { x0: -84, z0: -76, w: 190, h: 142 };
  const tops = new Float32Array(FG.w * FG.h);
  function stamp(cx, cy, cz, rx, ry, rz) {
    if (!(rx > 0.3 && rz > 0.3 && ry > 0.1)) return;
    const i0 = Math.max(0, Math.floor(cx - rx - FG.x0)), i1 = Math.min(FG.w - 1, Math.ceil(cx + rx - FG.x0));
    const j0 = Math.max(0, Math.floor(cz - rz - FG.z0)), j1 = Math.min(FG.h - 1, Math.ceil(cz + rz - FG.z0));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        // the cell's nearest point to the middle, so the grid errs on the side of leaves
        const x = clamp(cx, FG.x0 + i - 0.5, FG.x0 + i + 0.5), z = clamp(cz, FG.z0 + j - 0.5, FG.z0 + j + 0.5);
        const dx = (x - cx) / rx, dz = (z - cz) / rz;
        const d = dx * dx + dz * dz;
        if (d >= 1) continue;
        const top = cy + ry * Math.sqrt(1 - d);
        const k = j * FG.w + i;
        if (top > tops[k]) tops[k] = top;
      }
    }
  }
  if (hosts) {
    for (const c of hosts.crowns || []) if (!tallOwners.has(c.owner)) stamp(c.cx, c.cy, c.cz, c.rx, c.ry, c.rz);
    for (const p of hosts.palms || []) if (!tallOwners.has(p.owner)) stamp(p.cx, p.cy, p.cz, p.r, p.r * 0.5, p.r);
    for (const m of hosts.mounds || []) stamp(m.x, m.y, m.z, m.r, m.h, m.r);
  }
  const noVeg = !hosts;
  // the top of the leaves under (x, z), or 0 where there are none
  function leafTop(x, z) {
    if (noVeg) {
      // (?noveg=1: the lidar canopy grid, which also holds the garden's trees over the landing)
      if (len2(x - PAD_AT.x, z - PAD_AT.z) < 2.5) return 0;
      const c = T.canopyAt(x, z);
      return c > 1.2 ? Math.max(0, T.heightAt(x, z)) + c : 0;
    }
    const i = Math.round(x - FG.x0), j = Math.round(z - FG.z0);
    if (i < 0 || j < 0 || i >= FG.w || j >= FG.h) return 0;
    return tops[j * FG.w + i];
  }
  const pole = lms.find((l) => l.kind === 'osprey_pole') || { x: 57.6, z: -18.9, y: 1, height: 9.5 };

  // ---------------------------------------------------------------- the state

  const D = {
    x: PAD_AT.x, y: padTop + SKID_Y, z: PAD_AT.z, vx: 0, vy: 0, vz: 0, yaw: 0,
    tiltX: 0, tiltZ: 0, wobX: 0, wobZ: 0, wobVX: 0, wobVZ: 0, pvx: 0, pvz: 0,
    spin: 0, blur: 0, battery: 100, flown: false, onPad: true, onGround: false,
    bumpT: 0, brushT: 0, time: 0,
  };
  const props4 = new THREE.Vector4();
  // frame: the camera's framing ('lift', 'cruise', 'land'), eased towards for frameT s
  // after it changes (or while landing), unless the player looks or zooms themselves
  const cam = { yaw: 0, pitch: DRONE.camera.pitch, dist: DRONE.camera.dist, tx: 0, ty: 0, tz: 0, want: null, blend: 1, out: 0, fov: 42, shake: 0,
    frame: 'cruise', frameT: 0, zoomAt: -1e9, turnAt: -1e9, handAt: -1e9, look: 0 };
  const O = { x: pole.x, y: pole.y + pole.height + 12, z: pole.z, vx: 0, vy: 0, vz: 0, yaw: 0, bank: 0, mode: 'patrol', ang: 0, cool: 0, t: 0, flap: 0, callT: 0, hold: false };
  const run = {
    stage: 'idle', t: 0, from: null, prevTool: null, auto: false, splashHold: false, home: null, rings: 0,
    landing: null, result: null, lowSaid: false, edgeT: 0, treeT: 0, stoodT: 0, rthAsked: false, stowWas: false,
    todayBest: 0, day: -1,
    yawIn: 0, // Q (+1) and E (-1) this frame
    handBack: false, handedBack: false, // flown home by the battery: hand the landing back over the pad
    dunkT: 0, dripT: 0, // in the lake a moment before it limps home
    photos: 0, edge: false, landZone: false, lowHedge: false,
    still: false, // (a check image's moment: no wind drift)
  };
  const mission = {
    id: ID, title: TITLE, tool: ID,
    active: false,
    available,
    start,
    update: lateUpdate,
    progress,
    notebook,
    group,
    get stage() { return run.stage; },
    // in the air (or landing, or the photo card): another mission waits (the registry's busyOther)
    get busy() { return run.stage !== 'idle' && run.stage !== 'toPad'; },
    get stats() {
      return {
        stage: run.stage, rings: run.rings, photos: run.photos, battery: +D.battery.toFixed(1), obstacles: NHC + NHT,
        drawCalls: topView ? 0 : 1 + (ringM.mesh.visible ? 1 : 0) + (dots.points.visible ? 1 : 0) + (blob.mesh.visible ? 1 : 0) + (drop.points.visible ? 1 : 0) + (bird.mesh.visible ? 1 : 0),
        triangles: topView ? 0 : Math.round(kitM.triangles + (ringM.mesh.visible ? NR * 960 : 0) + (bird.mesh.visible ? bird.triangles : 0)),
        dots: dots.count, photoMs: lastPhotoMs, photoParts: lastPhotoParts, photoFrames: lastPhotoFrames,
      };
    },
    // the pad's job marker, for a moment the pad should be pointed out (James offering the
    // job, say) before the mission starts; start() takes it over
    hintPad(on) { if (run.stage === 'idle') markers.set('drone', on ? PAD_MARK : null); },
  };
  let lastPhotoMs = 0, lastPhotoParts = null, lastPhotoFrames = 0;
  let photoJob = null, cardApi = null;
  const flying = () => run.stage === 'spinup' || run.stage === 'lift' || run.stage === 'fly' || run.stage === 'home' || run.stage === 'land';
  const paused = () => kit.busy() || !!(game.story && game.story.cutscene);

  // ---------------------------------------------------------------- the HUD and markers

  const hud = buildDroneHud(game, { rings, pad: PAD_AT, land: data.water && data.water.land, photos: NS, batteryGoal: DRONE.stars.battery, lowAt: DRONE.battery.low });
  // the lane photos' shutter: a soft tick of its own if the sound has one (droneSnap),
  // else the UI's small click (the camera's shutter is too loud to hear every 12 m)
  const SNAP_CUE = typeof SFX.droneSnap === 'function' ? 'droneSnap' : 'uiClick';
  const markers = getMarkers(scene);
  const PAD_MARK = [{ x: PAD_AT.x, y: padTop, z: PAD_AT.z, colour: '#3fb0ad', lift: 0, scale: 1 }];
  const aud = () => (game.audio && typeof game.audio.cue === 'function' ? game.audio : null);
  const cue = (name, ...args) => { const a = aud(); return a ? a.cue(name, ...args) : null; };
  let hum = null, humT = 0, humTry = 0;
  let mapMarker = null;
  const mapDot = { x: 0, z: 0, colour: '#ff8a5c', label: 'Drone', pulse: false };

  // ---------------------------------------------------------------- the tool and the pad

  const padDist = () => len2(player.position.x - PAD_AT.x, player.position.z - PAD_AT.z);
  let lastOther = current() === ID ? 'loop_pole' : current(); // the tool in hand before the controller
  events.on('tool:equip', (e) => { const id = e && typeof e === 'object' ? e.id : e; if (id !== ID) lastOther = id === undefined ? null : id; });
  registerTool({
    id: ID, name: 'Drone controller', icon: 'drone', key: null, order: 61, pose: 'hold', phrase: 'drone controller',
    onEquip() {
      if (run.stage !== 'idle') return;
      if (!available()) {
        if (state.phase === 'setup') kit.toast('The drone is for the survey day. It will keep!', { icon: 'map', tone: 'info' });
        else if (state.phase === 'survey' && busyElsewhere()) kit.toast(`One job at a time: finish the ${busyElsewhere().title.toLowerCase()} first!`, { icon: 'drone', tone: 'info' });
        return;
      }
      start({ from: 'ring' });
    },
    onStow() {
      if (run.stage === 'toPad') cancel();
      else if (flying() && state.phase === 'survey' && !(game.story && game.story.cutscene)) {
        // a key the flight did not catch (an input source added after its own): X or a
        // quick key mid-flight means "come home", and the controller stays in hand
        run.rthAsked = true;
        queueMicrotask(() => { if (flying() && current() !== ID) equip(ID, { silent: true, instant: true }); });
      } else if (flying()) abort();
    },
    suggestFor() {
      if (state.phase !== 'survey' || run.stage !== 'toPad') return null;
      if (padDist() < LAUNCH_R) return { score: 6, prompt: '[E] Launch the drone', run: () => launch() };
      return { score: 0.15, prompt: 'Take the controller to the drone pad by the field station', run: null };
    },
  });
  registerInteraction({
    id: 'drone-pad',
    check() {
      if (state.phase !== 'survey' || run.stage !== 'idle' || current() === ID || padDist() > 2.2 || busyElsewhere()) return null;
      return { score: 1.5, prompt: '[E] Fly the drone survey', run: () => start({ from: 'pad' }) };
    },
  });

  function available() {
    return state.phase === 'survey' && run.stage === 'idle' && !topView && !busyElsewhere();
  }
  // another mission mid-job (a laser scan sweeping, the rover's pole up): the drone waits
  const busyElsewhere = () => (game.missions && game.missions.busyOther ? game.missions.busyOther(ID) : null);

  // The mission taken on (from James, the ring, the pad or a flag): the controller comes
  // out, and at the pad the drone launches; elsewhere a marker shows the pad.
  function start(opts = {}) {
    if (!available()) return false;
    run.from = opts.from || 'play';
    run.prevTool = current() === ID ? lastOther : current(); // taken from the ring: what was in hand before
    run.stage = 'toPad';
    run.t = 0;
    mission.active = true;
    resetFlight();
    if (current() !== ID) equip(ID);
    events.emit('mission:start', { id: ID });
    events.emit('mission:step', { id: ID, step: 'pad' });
    // taken from the ring (or asked for with [E]) right at the pad, it lifts off; handed
    // over by James, it waits for [E] at the pad, so nothing happens by surprise
    const go = (run.from === 'ring' || run.from === 'pad') && padDist() < LAUNCH_R && !opts.noLaunch;
    if (go) setTimeout(() => { if (run.stage === 'toPad' && padDist() < LAUNCH_R && !kit.busy()) launch(); }, 450);
    markers.set('drone', go ? null : PAD_MARK);
    // taken from the ring without asking him: James's word, as for the other kit
    if (run.from === 'ring' && SCRIPT.missions && SCRIPT.missions.selfStart) {
      kit.toast(`James: ${sayLine(SCRIPT.missions.selfStart, { title: 'drone', name: state.playerName })}`, { icon: 'drone', tone: 'good', ms: 3600 });
    }
    return true;
  }
  function cancel() {
    markers.set('drone', null);
    run.stage = 'idle';
    mission.active = false;
  }

  function resetFlight() {
    passed.fill(false);
    run.rings = 0; run.auto = false; run.home = null; run.landing = null; run.lowSaid = false; run.rthAsked = false;
    run.handBack = false; run.handedBack = false; run.dunkT = 0; run.photos = 0; run.edge = false; run.landZone = false;
    taken.fill(0);
    dots.snap(0, 0, 0, 0);
    hud.photos(0);
    D.x = PAD_AT.x; D.y = padTop + SKID_Y; D.z = PAD_AT.z; D.vx = D.vy = D.vz = 0;
    D.battery = 100; D.flown = false; D.onPad = true; D.spin = 0; D.wobX = D.wobZ = D.wobVX = D.wobVZ = 0;
    for (let i = 0; i < NR; i++) { ringM.setState(i, 0, 0); side[i] = 0; ringFade[i] = 0; }
    ringM.setState(PAD_RING, 3, 0);
    O.mode = 'patrol'; O.cool = 0; O.x = pole.x + DRONE.osprey.patrolR; O.y = pole.y + DRONE.osprey.patrolY; O.z = pole.z; O.vx = O.vy = O.vz = 0;
  }

  // At the pad with the controller: the player stands still, the camera leaves them and
  // follows the drone, the props spin up and it lifts off.
  function launch() {
    if (run.stage !== 'toPad' && run.stage !== 'idle') return;
    markers.set('drone', null);
    run.stage = 'spinup';
    run.t = 0;
    player.hold('drone', true);
    holdClock('drone', true); // a flight is a mini-game: it does not eat the day
    // face the pad
    player.heading = Math.atan2(-(PAD_AT.x - player.position.x), -(PAD_AT.z - player.position.z));
    player.object.rotation.y = player.heading;
    D.yaw = rings[0].yaw;
    // high and back enough to look over the player's hat and James at the lift-off; it
    // settles to the cruise framing once the drone is up
    cam.yaw = rig.yaw; cam.pitch = DRONE.camera.liftPitch; cam.dist = DRONE.camera.liftDist;
    cam.frame = 'lift'; cam.frameT = 0;
    cam.want = rings[0].yaw;
    cam.tx = D.x; cam.ty = D.y + 0.25; cam.tz = D.z;
    beginBlend();
    rig.enabled = false;
    lastWord();
    ringM.mesh.visible = true; dots.points.visible = true; blob.mesh.visible = true;
    hud.show(true);
    document.body.classList.add('drone-flying');
    hud.rings(0, passed, 0);
    hud.msg('Props spinning up...', 'info', 1.4);
    cue('droneSpin', true);
    humTry = 0;
    if (game.ui && game.ui.maps && !mapMarker) mapMarker = game.ui.maps.addMarker(mapDot);
    events.emit('mission:step', { id: ID, step: 'launch' });
  }

  // ---------------------------------------------------------------- input: the mission's own layer

  // While the drone is up: the ring's quick keys and X belong to the flight (X flies
  // home); the autopilot (fly home, or play.drone.auto) steers through the same actions.
  const flightKeys = (f) => {
    if (!flying()) { run.stowWas = !!f.held.stow; run.yawIn = 0; return; }
    if (f.held.stow && !run.stowWas) run.rthAsked = true;
    run.stowWas = !!f.held.stow;
    // Q (the ring's key) and E (use) turn it while it flies; nothing else hears them (but
    // with a card or a talk open, E is theirs)
    if (paused()) run.yawIn = 0;
    else { run.yawIn = (f.held.tool ? 1 : 0) - (f.held.use ? 1 : 0); f.held.use = false; }
    f.held.stow = false; f.held.tool = false; f.held.aim = false;
    f.held.tool1 = f.held.tool2 = f.held.tool3 = f.held.tool4 = f.held.tool5 = f.held.tool6 = false;
    if (run.splashHold) { f.move.x = f.move.y = 0; f.held.climb = f.held.descend = false; return; }
    if (run.stage === 'home' || run.auto) autopilot(f);
  };
  let offKeys = input.addSource(flightKeys);
  // at each launch it goes to the end of the list, after any source added since (a VR
  // controller's), so the flight has the last word on the keys it keeps for itself
  function lastWord() { offKeys(); offKeys = input.addSource(flightKeys); }

  const AP = { x: 0, y: 0, z: 0, ring: -1, through: false };
  function autopilot(f) {
    // where to: the next ring (through it), else over the pad and down
    let ring = -1;
    if (run.stage !== 'home') for (let i = 0; i < NR; i++) if (!passed[i]) { ring = i; break; }
    let alt, fast = false, landing = false;
    if (ring >= 0) {
      const r = rings[ring];
      const fx = -Math.sin(r.yaw), fz = -Math.cos(r.yaw);
      const along = (D.x - r.x) * fx + (D.z - r.z) * fz;
      // line up nine metres before it at its height, then straight through the middle
      // (and round again for another go if it slipped past)
      if (AP.ring !== ring) { AP.ring = ring; AP.through = false; }
      if (!AP.through) {
        AP.x = r.x - fx * 9; AP.z = r.z - fz * 9;
        if (len2(AP.x - D.x, AP.z - D.z) < 3 && Math.abs(D.y - r.y) < 1.2) AP.through = true;
      } else {
        AP.x = r.x + fx * 6; AP.z = r.z + fz * 6;
        if (along > 5) AP.through = false;
      }
      alt = r.y;
      fast = len2(AP.x - D.x, AP.z - D.z) > 30;
    } else {
      AP.x = PAD_AT.x; AP.z = PAD_AT.z;
      const hd = len2(D.x - PAD_AT.x, D.z - PAD_AT.z);
      if (run.stage === 'home' && run.handBack) {
        // flown home by the battery with a map's worth of rings: stop over the pad and
        // hand the landing back, so the soft-landing star is still the player's to win
        const hover = padTop + DRONE.battery.handBackY + SKID_Y;
        alt = hd > 14 ? Math.max(padTop + 16, Math.min(D.y, surveyY)) : Math.max(hover, padTop + 3 + hd * 0.5);
        if (hd < 1.2 && Math.abs(D.y - hover) < 0.8 && len2(D.vx, D.vz) < 1.6) {
          if (D.battery >= DRONE.battery.handBack) { handBackNow(); f.move.x = f.move.y = 0; f.held.climb = f.held.descend = false; return; }
          run.handBack = false; // too flat to hand over: it lands itself
        }
      } else {
        alt = hd > 14 ? Math.max(padTop + 16, Math.min(D.y, surveyY)) : hd > 1.2 ? padTop + 3 + hd * 0.5 : padTop - 1;
        landing = hd <= 1.2;
      }
      fast = hd > 40;
    }
    let dx = AP.x - D.x, dz = AP.z - D.z;
    const d = len2(dx, dz);
    // full stick towards the aim point, easing off (and braking) in the last few metres
    const near = landing || (d < 6 && !(ring >= 0 && AP.through));
    const gain = near ? Math.min(1, d / 6) * 0.8 : 1;
    const brake = near ? 0.35 / DRONE.cruise : 0;
    dx = dx / Math.max(1e-3, d) * gain - D.vx * brake;
    dz = dz / Math.max(1e-3, d) * gain - D.vz * brake;
    const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
    const my = -sy * dx - cy * dz, mx = cy * dx - sy * dz;
    const l = len2(mx, my);
    f.move.x = l > 1 ? mx / l : mx;
    f.move.y = l > 1 ? my / l : my;
    const err = alt - D.y;
    f.held.climb = err > 0.4;
    f.held.descend = err < -0.4;
    f.held.creep = false;
    f.held.jog = fast;
  }

  // ---------------------------------------------------------------- the flight, before the sky and trees see the camera

  const V = new THREE.Vector3(), V2 = new THREE.Vector3(), LOOK = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const Mx = new THREE.Matrix4(), Qd = new THREE.Quaternion(), Eu = new THREE.Euler(0, 0, 0, 'YXZ'), ONE = new THREE.Vector3(1, 1, 1);
  const fromPos = new THREE.Vector3(), fromQ = new THREE.Quaternion(), toQ = new THREE.Quaternion();
  let fromFov = 42;
  function beginBlend() {
    fromPos.copy(camera.position);
    fromQ.copy(camera.quaternion);
    fromFov = camera.fov;
    cam.blend = 0;
  }

  function flight(dt, t) {
    D.time += dt;
    const live = flying();
    if (run.stage === 'outro') { outro(dt); return; }
    if (!live) { idlePose(dt, t); return; }
    if (paused()) { placeCamera(0, true); return; }
    run.t += dt;
    const inp = input;

    // ---- the stages before and after free flight
    if (run.stage === 'spinup') {
      D.spin = Math.min(1, run.t / 0.9);
      if (run.t > 0.95) { run.stage = 'lift'; run.t = 0; }
    } else if (run.stage === 'lift') {
      D.spin = 1;
      D.vy = 1.8;
      if (D.y - padTop - SKID_Y > 2.2) { run.stage = 'fly'; run.t = 0; D.onPad = false; hud.msg('Up to 150 ft and through ring 1!', 'gold', 3.2); cue('droneBeep', 'ready'); }
    } else if (run.stage === 'land') {
      D.spin = Math.max(0, 1 - run.t / 0.9);
      D.vx = D.vy = D.vz = 0;
      // the camera settles, looking down at the drone home on its pad
      cam.pitch += (0.72 - cam.pitch) * ease(2.5, dt);
      cam.dist += (4.6 - cam.dist) * ease(2.5, dt);
      if (run.t > 1.0) afterLanding();
    }
    if (run.stage === 'fly' || run.stage === 'home') {
      if (run.rthAsked && run.stage === 'fly') { run.rthAsked = false; if (!D.onPad) goHome('rth'); else stopOnPad(); }
      steer(dt, inp);
    }
    if (run.stage === 'lift') { D.y += D.vy * dt; D.vx *= 0.9; D.vz *= 0.9; }
    if (run.stage === 'fly' || run.stage === 'home') {
      if (run.dunkT > 0) dunk(dt);
      else {
        move(dt);
        touch(dt);
        if (run.stage === 'fly') { checkRings(); lanePhotos(t); }
        drain(dt);
      }
    }
    osprey(dt);
    pose(dt, t);
    placeCamera(dt, false);
  }

  // the controls (or the autopilot) into the drone's wanted velocity
  const W = { x: 0, z: 0 };
  function steer(dt, inp) {
    const fast = inp.down('jog');
    const top = fast ? DRONE.fast : DRONE.cruise;
    const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
    const mx = inp.move.x, my = inp.move.y;
    let tvx = (-sy * my + cy * mx) * top, tvz = (-cy * my - sy * mx) * top;
    // the wind: a steady drift, gustier and stronger up high
    const alt = D.y - padTop;
    const wk = clamp((alt - 2) / 15, 0, 1) * DRONE.wind.speed * (1 + DRONE.wind.gust * Math.sin(D.time * 0.7) * Math.sin(D.time * 0.23 + 1));
    W.x = -Math.sin(DRONE.wind.yaw) * wk; W.z = -Math.cos(DRONE.wind.yaw) * wk;
    if (!D.onPad && !run.still) { tvx += W.x; tvz += W.z; }
    // up and down; slow and careful right over the pad
    const up = inp.down('climb'), down = inp.down('descend');
    const overPad = len2(D.x - PAD_AT.x, D.z - PAD_AT.z) < 2.2 && D.y - padTop < 3;
    let tvy = up && !down ? (fast ? DRONE.climbFast : DRONE.climb) : down && !up ? -(fast ? DRONE.sinkFast : overPad ? DRONE.landSink : DRONE.sink) : 0;
    if (D.onPad) { tvx = 0; tvz = 0; if (tvy < 0) tvy = 0; }
    const k = ease(DRONE.accel, dt), kv = ease(DRONE.vAccel, dt);
    D.pvx = D.vx; D.pvz = D.vz;
    D.vx += (tvx - D.vx) * k;
    D.vz += (tvz - D.vz) * k;
    D.vy += (tvy - D.vy) * kv;
    // a gentle pull to the middle of the pad when coming in to land
    if (overPad && D.y - padTop < 2.5 && !D.onPad) {
      const cx = PAD_AT.x - D.x, cz = PAD_AT.z - D.z;
      D.vx += cx * 1.4 * dt; D.vz += cz * 1.4 * dt;
    }
    if (D.onPad && up) { D.onPad = false; if (run.landing === 'pit') { run.landing = null; hud.msg('And off again!', 'good', 1.6); } }
  }

  function move(dt) {
    D.x += D.vx * dt; D.y += D.vy * dt; D.z += D.vz * dt;
    // the ceiling and the edge of the map
    if (D.y > padTop + DRONE.ceiling) { D.y = padTop + DRONE.ceiling; if (D.vy > 0) D.vy = 0; say('That is as high as the drone may go.', 'info', 'ceiling'); }
    // at the edge of the flying area only the outward part of the speed goes, so it
    // slides along the edge (and the camera swings back towards the island, placeCamera)
    const R = DRONE.range;
    run.edge = false;
    if (D.x < R.x0) { D.x = R.x0; if (D.vx < 0) D.vx = 0; run.edge = true; } else if (D.x > R.x1) { D.x = R.x1; if (D.vx > 0) D.vx = 0; run.edge = true; }
    if (D.z < R.z0) { D.z = R.z0; if (D.vz < 0) D.vz = 0; run.edge = true; } else if (D.z > R.z1) { D.z = R.z1; if (D.vz > 0) D.vz = 0; run.edge = true; }
    if (run.edge) {
      run.edgeT -= dt;
      if (run.edgeT <= 0) { run.edgeT = 2.5; cue('droneBeep', 'edge'); hud.msg('Edge of the flying area! Back to the island.', 'warn', 2.2); }
    }
  }

  // Everything the drone can touch: the tall crowns (a bump), the rest of the canopy (a
  // soft floor), the ground, the lake (a splash) and the pad (a landing).
  function touch(dt) {
    D.bumpT -= dt; D.brushT -= dt;
    // the solid crowns and trunks (packed numbers: no objects touched in the loop)
    for (let i = 0; i < NHC; i++) {
      const b = i * 6, m = 0.42;
      const cx = HC[b], cy = HC[b + 1], cz = HC[b + 2];
      const ax = HC[b + 3] + m, ay = HC[b + 4] + m, az = HC[b + 5] + m;
      const dx = (D.x - cx) / ax, dz = (D.z - cz) / az;
      if (dx * dx + dz * dz > 1) continue;
      const dy = (D.y - cy) / ay;
      const q = dx * dx + dy * dy + dz * dz;
      if (q >= 1) continue;
      const s = 1.03 / Math.sqrt(Math.max(q, 1e-4));
      D.x = cx + (D.x - cx) * s; D.y = cy + (D.y - cy) * s; D.z = cz + (D.z - cz) * s;
      let nx = dx / ax, ny = dy / ay, nz = dz / az;
      const nl = len3(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      bounce(nx, ny, nz, 'leaves', hardCrowns[i]);
    }
    for (let i = 0; i < NHT; i++) {
      const b = i * 5;
      if (D.y < HT[b + 2] - 0.3 || D.y > HT[b + 3] + 0.3) continue;
      const tx = HT[b], tz = HT[b + 1];
      const dx = D.x - tx, dz = D.z - tz, r = HT[b + 4] + 0.36;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      const d = Math.sqrt(d2) || 1e-3;
      D.x = tx + dx / d * r * 1.02; D.z = tz + dz / d * r * 1.02;
      bounce(dx / d, 0, dz / d, 'ground', hardTrunks[i]);
    }
    // the pad
    const pd = len2(D.x - PAD_AT.x, D.z - PAD_AT.z);
    if (pd < PAD.r - 0.08 && D.y - SKID_Y <= padTop + 0.005) {
      const vy = D.vy, hs = len2(D.vx, D.vz);
      D.y = padTop + SKID_Y;
      if (D.vy < 0) D.vy = 0;
      if (!D.onPad) touchdown(vy, hs, pd);
      return;
    }
    // the canopy's soft floor, the ground and the lake
    const g = T.heightAt(D.x, D.z);
    const water = T.isWater(D.x, D.z);
    const surf = Math.max(0, g);
    let floor = surf;
    const leaves = leafTop(D.x, D.z);
    const bottom = D.y - SKID_Y;
    // the low hedge round the pad is no soft floor that bounces a missed approach up
    // (with a telling off every few seconds): the skids just rest on its leaves, quietly,
    // and it slides off towards the pad
    run.lowHedge = false;
    if (leaves > surf + 0.3 && leaves < surf + 1.7 && pd < PAD.r + 3.2) {
      const top = leaves + 0.04;
      if (bottom < top) {
        D.y = top + SKID_Y;
        if (D.vy < 0) D.vy = 0;
        D.vx *= 0.9; D.vz *= 0.9;
        D.vx += (PAD_AT.x - D.x) / Math.max(0.5, pd) * 0.6 * dt; D.vz += (PAD_AT.z - D.z) / Math.max(0.5, pd) * 0.6 * dt;
        run.lowHedge = true;
      }
      return;
    }
    if (leaves > surf + 0.6) floor = leaves + 0.3;
    if (floor > surf + 0.1) {
      if (bottom < floor) {
        D.y = Math.min(floor + SKID_Y, D.y + 7 * dt + (floor - bottom) * 0.5);
        if (D.vy < 0.6) D.vy = 0.6;
        if (D.brushT <= 0) {
          D.brushT = 0.55;
          if (game.fx && game.fx.burst) game.fx.burst('leaves', D.x, floor, D.z, 5);
          cue('droneBump', 'leaves');
          say('Mind the trees! Up you go.', 'warn', 'trees');
        }
      }
      return;
    }
    if (water && g < 0.02) {
      if (bottom < 0.04) splash();
      return;
    }
    if (bottom < floor) {
      const vy = D.vy;
      D.y = floor + SKID_Y;
      if (D.vy < 0) D.vy = 0;
      D.vx *= 0.8; D.vz *= 0.8;
      if (vy < -2.4 && D.bumpT <= 0) bounce(0, 1, 0, 'ground', null, DRONE.battery.ground);
      else if (!D.onGround) say('Down on the grass. [Space] to climb.', 'info', 'grass');
      D.onGround = true;
    } else D.onGround = false;
  }

  function bounce(nx, ny, nz, kind, o, cost = DRONE.battery.bump) {
    const vn = D.vx * nx + D.vy * ny + D.vz * nz;
    if (vn < 0) { D.vx -= 1.6 * vn * nx; D.vy -= 1.6 * vn * ny; D.vz -= 1.6 * vn * nz; }
    D.vx += nx * 1.2; D.vy += ny * 1.2; D.vz += nz * 1.2;
    if (D.bumpT > 0) return;
    D.bumpT = 0.8;
    D.wobVX += (Math.random() - 0.5) * 9; D.wobVZ += (Math.random() < 0.5 ? -1 : 1) * 7;
    D.battery = Math.max(0, D.battery - cost);
    cue('droneBump', kind);
    if (kind === 'leaves' && game.fx && game.fx.burst) game.fx.burst('leaves', D.x, D.y, D.z, 10);
    const name = o && o.lm ? (o.lm.kind === 'rainbow_eucalyptus' ? 'the rainbow eucalyptus' : o.lm.kind === 'talipot' ? 'a talipot palm' : o.lm.kind === 'osprey_pole' ? 'the osprey pole' : 'a tree') : null;
    hud.msg(kind === 'bird' ? `The osprey! -${cost}% battery` : name ? `Bump! Into ${name}. -${cost}% battery` : `Bump! -${cost}% battery`, 'warn', 2.2);
    shake(0.25);
  }

  function shake(k) {
    if (!state.settings || state.settings.cameraShake === false) return;
    cam.shake = Math.max(cam.shake || 0, k);
  }

  function splash() {
    if (run.stage === 'home' && run.home === 'water') return;
    // it sits in the lake a moment, skids under, in a ring of splashes, then limps home
    D.y = SKID_Y - 0.07;
    D.vx = D.vz = D.vy = 0;
    D.wobVX += 8; D.wobVZ -= 6;
    D.battery = Math.max(0, D.battery - 8);
    run.dunkT = run.splashHold ? 1e9 : 0.7;
    run.dripT = 0.12;
    if (game.fx && game.fx.burst) {
      game.fx.burst('splash', D.x, 0.05, D.z, 16);
      for (let k = 0; k < 4; k++) game.fx.burst('splash', D.x + Math.cos(k * 1.571 + 0.4) * 0.45, 0.05, D.z + Math.sin(k * 1.571 + 0.4) * 0.45, 5);
    }
    cue('droneSplash');
    shake(0.35);
    hud.msg('Splash! The drone is limping home.', 'warn', run.splashHold ? 60 : 3.2);
    events.emit('mission:step', { id: ID, step: 'splash' });
    goHome('water');
  }
  // in the lake: skids under, bobbing, drips and little rings round it; then up it limps
  function dunk(dt) {
    run.dunkT -= dt;
    D.vx = D.vz = D.vy = 0;
    D.y = SKID_Y - 0.07 + Math.sin(D.time * 6.5) * 0.018;
    run.dripT -= dt;
    if (run.dripT <= 0 && game.fx && game.fx.burst) {
      run.dripT = run.splashHold ? 0.5 : 0.25;
      const a = D.time * 2.3;
      for (let k = 0; k < 3; k++) game.fx.burst('splash', D.x + Math.cos(a + k * 2.09) * 0.36, 0.05, D.z + Math.sin(a + k * 2.09) * 0.36, 4);
    }
    if (run.dunkT <= 0) { run.dunkT = 0; D.y = SKID_Y + 0.06; D.vy = 1.8; }
  }

  function goHome(why) {
    run.stage = 'home';
    run.home = why;
    run.t = 0;
    run.auto = false;
    // the battery with a map's worth of rings: it stops over the pad for you to land it
    run.handBack = why === 'battery' && run.rings >= DRONE.minRings && !run.handedBack && D.battery >= DRONE.battery.handBack;
    cue('droneBeep', 'home');
    if (why === 'rth') hud.msg('Flying home by itself...', 'info', 2.6);
    else if (why === 'battery') hud.msg(run.handBack ? 'Battery nearly flat: bringing it over the pad for you!' : 'Battery nearly flat: coming home!', 'warn', 3.2);
    events.emit('mission:step', { id: ID, step: 'home' });
  }
  // over the pad after a flight home on a low battery: the controls come back
  function handBackNow() {
    run.handBack = false;
    run.handedBack = true;
    run.stage = 'fly';
    run.home = null;
    run.t = 0;
    D.vx *= 0.3; D.vz *= 0.3;
    cam.handAt = D.time;
    cue('droneBeep', 'ready');
    hud.msg('Over the pad: bring it down gently on the H! [C] descend', 'gold', 4.5);
    events.emit('mission:step', { id: ID, step: 'handback' });
  }
  function stopOnPad() {
    // X while sitting on the pad with too few rings for a map: pack it away
    if (run.rings >= DRONE.minRings) { touchdown(0, 0, 0, true); return; }
    hud.msg('Flight packed away. Have another go any time!', 'info', 2.4);
    finishQuiet();
  }

  function touchdown(vy, hs, off, forced = false) {
    D.onPad = true;
    D.vx = D.vz = 0;
    if (!D.flown && !forced) {
      // back down before it ever got going: it just sits, unless it was flying itself
      // home (X during the lift-off), which ends as X on the pad does: packed away
      if (run.stage === 'home') { run.stage = 'fly'; run.home = null; stopOnPad(); }
      return;
    }
    const auto = run.stage === 'home';
    if (run.home === 'water') { landed({ fail: 'water' }); return; }
    if (run.rings < DRONE.minRings) {
      if (run.home === 'battery') { landed({ fail: 'battery' }); return; }
      run.landing = 'pit';
      run.stage = 'fly';
      run.home = null;
      cue('droneLand', true);
      hud.msg(run.rings ? `Only ${run.rings} of ${NR} rings: not enough for a map yet. [Space] to take off, [X] to pack up.` : 'Back on the pad. [Space] to take off again, [X] to pack up.', 'info', 4.5);
      return;
    }
    const S = DRONE.stars.soft;
    const soft = !auto && !forced && -vy <= S.vy && hs <= S.speed && off <= S.off;
    landed({ soft, auto: auto || forced, vy, hs, off });
  }

  function landed(r) {
    run.stage = 'land';
    run.t = 0;
    run.landing = r;
    D.onPad = true;
    D.x = PAD_AT.x + clamp(D.x - PAD_AT.x, -0.5, 0.5); D.z = PAD_AT.z + clamp(D.z - PAD_AT.z, -0.5, 0.5);
    cue('droneLand', !!(r.soft || (r.auto && !r.fail)));
    cue('droneSpin', false);
    if (hum) { hum.stop(); hum = null; }
    if (r.fail) hud.msg(r.fail === 'water' ? 'Home, dripping wet.' : 'Home on the last of the battery.', 'warn', 2.5);
    else hud.msg(r.soft ? 'Soft as a feather!' : r.auto ? 'Landed by itself.' : 'Bumpy landing, but home!', r.soft ? 'gold' : 'good', 2.2);
    events.emit('mission:step', { id: ID, step: 'land' });
  }

  function afterLanding() {
    const r = run.landing || {};
    if (r.fail) {
      events.emit('mission:fail', { id: ID, why: r.fail });
      finishQuiet();
      return;
    }
    // the photo: a flash, the shutter, and the island from straight above (rendered now,
    // read back, graded and printed over the next few frames while the card comes up)
    run.stage = 'photo';
    hud.flash();
    cue('shutter');
    const stamp = `DAY ${state.days + 1}  ${clockText()}`;
    photoJob = null;
    try {
      photoJob = startAerialPhoto(game, { hide: [kitM.mesh, bird.mesh, ringM.mesh, dots.points, drop.points, blob.mesh], missing: gaps() });
      photoJob.stamp = stamp;
    } catch (e) {
      console.warn('drone: the aerial photo did not render', e);
    }
    const S = DRONE.stars;
    const ringsAll = run.rings >= S.rings;
    const batt = D.battery >= S.battery;
    const stars = Math.max(1, (ringsAll ? 1 : 0) + (batt ? 1 : 0) + (r.soft ? 1 : 0));
    // today's first finish scores its stars; flying again scores only an improvement
    const dayNow = state.days;
    if (run.day !== dayNow) { run.day = dayNow; run.todayBest = 0; }
    const todayBest = Math.max(run.todayBest, (state.today && state.today.kit && state.today.kit[ID]) || 0);
    const points = Math.max(0, missionPoints(stars) - (todayBest ? missionPoints(todayBest) : 0));
    run.todayBest = Math.max(run.todayBest, stars);
    const result = { photo: null, stamp, stars, rings: run.rings, total: NR, battery: D.battery, soft: !!r.soft, auto: !!r.auto, batteryGoal: S.battery, points,
      photos: run.photos, photoTotal: NS,
      landing: r.soft ? 'Soft landing' : r.auto ? 'Landed by itself' : 'Bumpy landing' };
    run.result = result;
    // the record first (the registry saves it with the notebook on mission:done; the
    // photo joins it, and is saved, once its JPEG is ready)
    const rec = missionRecord(ID);
    const d = rec.data;
    d.log = Array.isArray(d.log) ? d.log : [];
    d.log.push({ rings: run.rings, total: NR, battery: Math.round(D.battery), soft: !!r.soft, auto: !!r.auto, stars, day: state.days + 1, photos: run.photos });
    if (d.log.length > 8) d.log.splice(0, d.log.length - 8);
    d.bestRings = Math.max(d.bestRings || 0, run.rings);
    d.lastSpots = Array.from(taken).join(''); // which photo spots the last flight took (for the notebook's plan)
    d.bestPhotos = Math.max(d.bestPhotos || 0, run.photos);
    d.bestBattery = Math.max(d.bestBattery || 0, Math.round(D.battery));
    if (r.soft) { d.soft = true; d.softs = (d.softs || 0) + 1; }
    d.best = Math.max(d.best || 0, stars);
    hud.show(false);
    document.body.classList.remove('drone-flying');
    ringM.mesh.visible = false; dots.points.visible = false; blob.mesh.visible = false; bird.mesh.visible = false; drop.points.visible = false;
    const word = stars >= 3 ? 'Perfect!' : stars === 2 ? 'Lovely!' : 'Got it!';
    const whole = run.photos >= NS;
    let closeCard = null, openedAt = 0;
    cardApi = null;
    kit.minigame({
      name: 'drone-photo', title: 'Aerial photo', icon: 'map', card: 'dr-photo-card', cancellable: true,
      instructions: whole ? 'The whole island from 150 ft, stitched from your survey.' : `Stitched from your ${run.photos} photos: the blank bits were never photographed.`,
      foot: '[E] to pin it in the notebook',
      mount(stage, api) {
        openedAt = performance.now();
        closeCard = () => api.done({ success: true, quality: stars / 3, label: word, hold: 650 });
        cardApi = photoCard(stage, result, closeCard);
        if (result.photo) cardApi.setPhoto(result.photo);
        else if (photoJob && photoJob.printReady) { photoJob.printSent = true; cardApi.setPhoto(photoJob.print); }
        // (E was the turn key a moment ago: a tap that lands just after the touchdown
        // does not close the card before it has been seen)
        return { onUse: () => { if (performance.now() - openedAt > 900) closeCard(); } };
      },
    }).then(() => { cardApi = null; finishQuiet(); });
    events.emit('mission:done', { id: ID, stars, points });
    events.emit('mission:step', { id: ID, step: 'photo' });
    if (photoJob) stepPhoto(); // (a job with nothing to wait for may already be done)
  }

  // The photo's later frames: the big map's layer as soon as it is graded, then the
  // print into the record (and the save) and onto the card
  function stepPhoto() {
    const job = photoJob;
    if (!job) return;
    try { job.step(); } catch (e) { console.warn('drone: the aerial photo did not develop', e); photoJob = null; return; }
    const maps = game.ui && game.ui.maps;
    // the print on the card as soon as it is made (the JPEG for the save follows)
    if (job.printReady && !job.printSent && cardApi) { job.printSent = true; cardApi.setPhoto(job.print); }
    if (job.mapReady && !job.mapSent) {
      job.mapSent = true;
      if (maps && maps.setAerial) maps.setAerial(job.canvas, job.extent);
    }
    if (!job.done) return;
    photoJob = null;
    lastPhotoMs = Math.round(job.ms * 10) / 10;
    lastPhotoFrames = job.frames;
    lastPhotoParts = {};
    for (const k in job.parts) lastPhotoParts[k] = Math.round(job.parts[k] * 10) / 10;
    if (!job.jpeg) return;
    aerialSrc = job.jpeg;
    const d = missionRecord(ID).data;
    d.photo = job.jpeg;
    d.stamp = job.stamp;
    if (run.result) run.result.photo = job.jpeg;
    if (cardApi) cardApi.setPhoto(job.jpeg);
    save();
  }

  // the parts of the island the lane photos missed, as world rectangles
  function gaps() {
    const out = [];
    for (let k = 0; k < NS; k++) if (!taken[k]) out.push(cellOf(k));
    return out;
  }

  // Back on foot: the camera eases from the drone back to over the player's shoulder.
  function finishQuiet() {
    const wasFlying = run.stage !== 'idle' && run.stage !== 'toPad';
    run.stage = wasFlying ? 'outro' : 'idle';
    run.t = 0;
    mission.active = false;
    run.auto = false;
    player.hold('drone', false);
    holdClock('drone', false);
    hud.show(false);
    document.body.classList.remove('drone-flying');
    markers.set('drone', null);
    ringM.mesh.visible = false; dots.points.visible = false; blob.mesh.visible = false; bird.mesh.visible = false; drop.points.visible = false;
    run.yawIn = 0;
    if (hum) { hum.stop(); hum = null; }
    if (mapMarker) { mapMarker(); mapMarker = null; }
    D.x = PAD_AT.x; D.y = padTop + SKID_Y; D.z = PAD_AT.z; D.vx = D.vy = D.vz = 0; D.onPad = true;
    if (wasFlying) {
      beginBlend();
      rig.enabled = true;
      rig.yaw = player.heading;
      rig.snap();
      cam.out = 0;
    } else rig.enabled = true;
    const back = run.prevTool !== ID && run.prevTool !== undefined ? run.prevTool : 'loop_pole';
    if (current() === ID) equip(back);
  }
  // the day ended, the phase changed or a menu took over: straight back, nothing scored
  function abort() {
    if (run.stage === 'idle') return;
    if (run.stage === 'outro') { run.stage = 'idle'; return; }
    const was = run.stage;
    finishQuiet();
    if (was !== 'toPad') run.stage = 'idle'; // the story (or the title) has the camera now
  }

  function outro(dt) {
    // the rig has placed the camera this frame: ease into it from where the drone view was
    run.t += dt;
    const k = Math.min(1, run.t / 0.9);
    const e = k * k * (3 - 2 * k);
    toQ.copy(camera.quaternion);
    V.copy(camera.position);
    camera.position.lerpVectors(fromPos, V, e);
    camera.quaternion.slerpQuaternions(fromQ, toQ, e);
    const fov = fromFov + (camera.fov - fromFov) * e;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    idlePose(dt, D.time);
    if (k >= 1) run.stage = 'idle';
  }

  // Through a ring (in any order): the drone's side of each ring's plane, frame to frame,
  // tested only for rings within 12 m (packed numbers, no objects, nothing allocated)
  function checkRings() {
    for (let i = 0; i < NR; i++) {
      if (passed[i]) continue;
      const b = i * 5;
      const dx = D.x - RG[b], dy = D.y - RG[b + 1], dz = D.z - RG[b + 2];
      if (dx > 12 || dx < -12 || dz > 12 || dz < -12) { side[i] = 0; continue; }
      const s = dx * RG[b + 3] + dz * RG[b + 4];
      const was = side[i];
      side[i] = s;
      if (was === 0 || (was < 0) === (s < 0) || s === 0 || Math.abs(s - was) > 6) continue;
      const radial = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - s * s));
      if (radial > RING_R + 0.15) continue;
      passRing(i);
    }
  }
  function passRing(i) {
    const r = rings[i];
    passed[i] = true;
    run.rings++;
    ringM.setState(i, 2, 0.001);
    ringFade[i] = 0.001;
    const last = run.rings === NR;
    cue('droneRing', run.rings, last);
    if (game.fx && game.fx.burst) game.fx.burst('sparkle', r.x, r.y, r.z, last ? 22 : 12);
    D.flown = true;
    hud.msg(last ? 'All ten rings! Now home for a soft landing on the H.' : `Ring ${run.rings} of ${NR}!`, last ? 'gold' : 'good', last ? 4 : 1.6);
    events.emit('mission:step', { id: ID, step: 'ring', n: run.rings });
  }
  const ringFade = new Float64Array(NR);

  // The survey's photos: in the 150 ft band, the camera takes a photo of each patch of
  // the island it passes over, one a lane every 12 m (a soft shutter tick; the plan's dots
  // there turn mint). Flown along the lanes that is every patch; cutting the corners from
  // ring to ring leaves a few blank.
  function lanePhotos(t) {
    if (Math.abs(D.y - surveyY) > DRONE.snap.band) return;
    if (D.x < PHOTO_EXTENT.x0 || D.x > PHOTO_EXTENT.x1 || D.z < PHOTO_EXTENT.z0 || D.z > PHOTO_EXTENT.z1) return;
    let li = 0;
    while (li < LANES.length - 1 && D.z < (LANES[li] + LANES[li + 1]) / 2) li++;
    const si = clamp(Math.round((D.x - WEST) / SNAP_GAP), 0, SNAPS_PER_LANE - 1);
    const k = li * SNAPS_PER_LANE + si;
    if (!taken[k]) takePhoto(k, t, true);
  }
  function takePhoto(k, t, loud) {
    taken[k] = 1;
    run.photos++;
    const li = Math.floor(k / SNAPS_PER_LANE), si = k % SNAPS_PER_LANE;
    const xs = WEST + si * SNAP_GAP;
    // lane li is the plan's leg 2 li + 1 (pad, ring 1, ..., ring 10, home)
    dots.snap(2 * li + 1, xs - SNAP_GAP / 2 - 0.01, xs + SNAP_GAP / 2 + 0.01, Math.max(0.001, t));
    hud.photos(run.photos);
    if (loud) cue(SNAP_CUE);
  }

  function drain(dt) {
    const B = DRONE.battery;
    const hs = len2(D.vx, D.vz);
    const use = D.onPad ? 0.05 : B.hover + B.move * Math.min(1.8, hs / DRONE.cruise) + B.climb * Math.max(0, D.vy) / DRONE.climb;
    D.battery = Math.max(0, D.battery - dt * use);
    if (D.y - padTop > 3) D.flown = true;
    if (run.stage !== 'fly') return;
    const all = run.rings >= NR;
    if (!run.lowSaid && D.battery <= B.low) {
      run.lowSaid = true;
      cue('droneBeep', 'low');
      hud.msg(all ? 'Battery low: bring it down on the H!' : 'Battery low: time to head home! [X] flies it back.', 'warn', 4);
    }
    // it takes over at 10 %; with all ten rings through, not till 3 %, so the landing is
    // the player's; handed back over the pad, only once the battery is flat
    const home = run.handedBack ? 0 : all ? B.homeAll : B.home;
    if (D.battery <= home && !D.onPad) goHome('battery');
  }

  // ---------------------------------------------------------------- the osprey who is not amused

  function osprey(dt) {
    const P = DRONE.osprey;
    const up = run.stage === 'fly' || run.stage === 'home';
    bird.mesh.visible = up && !topView;
    if (!up) return;
    O.t += dt; O.cool -= dt; O.callT -= dt;
    const px = pole.x, pz = pole.z, py = pole.y + P.patrolY;
    const ddx = D.x - O.x, ddy = D.y - O.y, ddz = D.z - O.z;
    const dd = len3(ddx, ddy, ddz);
    const fromPole = len2(D.x - px, D.z - pz);
    let tx, ty, tz, speed;
    if (O.hold) {
      // a check image's moment: hovering a few metres off the drone's nose, telling it off
      O.x = D.x - Math.sin(D.yaw) * 2.8 + Math.cos(D.yaw) * 1.5; O.y = D.y + 0.9; O.z = D.z - Math.cos(D.yaw) * 2.8 - Math.sin(D.yaw) * 1.5;
      O.yaw = Math.atan2(-(D.x - O.x), -(D.z - O.z)) + 0.55; O.bank = 0.12; O.flap = -0.05 + Math.sin(O.t * 6) * 0.22;
      if (O.callT <= 0) { O.callT = 1.3; cue('osprey'); }
      Eu.set(0.1, O.yaw, O.bank);
      BU.uDrone.value.compose(V.set(O.x, O.y, O.z), Qd.setFromEuler(Eu), ONE);
      BU.uAngles.value.w = O.flap;
      return;
    }
    if (O.mode === 'patrol') {
      O.ang += 0.7 * dt;
      tx = px + Math.cos(O.ang) * P.patrolR; tz = pz + Math.sin(O.ang) * P.patrolR; ty = py + 2.5 * Math.sin(O.t * 0.5);
      speed = P.speed;
      if (O.cool <= 0 && dd < P.notice && run.stage === 'fly') {
        O.mode = 'chase';
        O.callT = 0;
        hud.msg('The osprey is not amused! [Shift] to get away.', 'warn', 2.6);
      }
    } else if (O.mode === 'chase') {
      tx = D.x; ty = D.y; tz = D.z;
      speed = P.chase;
      if (O.callT <= 0) { O.callT = 1.3; cue('osprey'); }
      if (dd < P.hit) {
        bounce(ddx / (dd || 1), ddy / (dd || 1), ddz / (dd || 1), 'bird', null, DRONE.battery.bird);
        O.mode = 'retreat'; O.cool = P.cooldown;
      } else if (fromPole > P.giveUp || run.stage !== 'fly') { O.mode = 'retreat'; O.cool = 2; }
    } else {
      tx = px + Math.cos(O.ang) * P.patrolR; tz = pz + Math.sin(O.ang) * P.patrolR; ty = py;
      speed = 7;
      if (len3(tx - O.x, ty - O.y, tz - O.z) < 3) O.mode = 'patrol';
    }
    let dx = tx - O.x, dy = ty - O.y, dz = tz - O.z;
    const d = len3(dx, dy, dz) || 1;
    dx = dx / d * speed; dy = dy / d * speed; dz = dz / d * speed;
    const k = ease(O.mode === 'chase' ? 1.6 : 2.2, dt);
    const pyaw = O.yaw;
    O.vx += (dx - O.vx) * k; O.vy += (dy - O.vy) * k; O.vz += (dz - O.vz) * k;
    O.x += O.vx * dt; O.y += O.vy * dt; O.z += O.vz * dt;
    const hs = len2(O.vx, O.vz);
    if (hs > 0.3) O.yaw = Math.atan2(-O.vx, -O.vz);
    const turn = wrap(O.yaw - pyaw) / Math.max(dt, 1e-3);
    O.bank += (clamp(-turn * 0.25, -0.7, 0.7) - O.bank) * ease(4, dt);
    const flapping = O.mode !== 'patrol' || Math.sin(O.t * 0.8) > 0.4;
    O.flap = flapping ? Math.sin(O.t * (O.mode === 'chase' ? 11 : 7)) * 0.55 : 0.1 + Math.sin(O.t * 2) * 0.06;
    Eu.set(clamp(-O.vy * 0.06, -0.4, 0.4), O.yaw, O.bank);
    BU.uDrone.value.compose(V.set(O.x, O.y, O.z), Qd.setFromEuler(Eu), ONE);
    BU.uAngles.value.w = O.flap;
    BU.uTime.value = O.t;
  }

  // ---------------------------------------------------------------- how it looks

  function pose(dt, t) {
    // tilt into the acceleration, lean with the speed, wobble after a bump
    const cy = Math.cos(D.yaw), sy = Math.sin(D.yaw);
    const ax = (D.vx - D.pvx) / Math.max(dt, 1e-3), az = (D.vz - D.pvz) / Math.max(dt, 1e-3);
    const aF = -sy * ax - cy * az, aR = cy * ax - sy * az;
    const vF = -sy * D.vx - cy * D.vz, vR = cy * D.vx - sy * D.vz;
    const k = ease(6, dt);
    D.tiltX += (clamp(-(aF * 0.05 + vF * 0.022), -0.42, 0.42) - D.tiltX) * k;
    D.tiltZ += (clamp(-(aR * 0.05 + vR * 0.022), -0.42, 0.42) - D.tiltZ) * k;
    D.wobVX += (-42 * D.wobX - 4.5 * D.wobVX) * dt; D.wobX += D.wobVX * dt;
    D.wobVZ += (-42 * D.wobZ - 4.5 * D.wobVZ) * dt; D.wobZ += D.wobVZ * dt;
    // the nose turns to where the camera looks while flying
    if (run.faceCam) D.yaw += wrap(cam.yaw + Math.PI - 0.5 - D.yaw) * ease(4, dt); // a check image's hello to the lens
    else if (!D.onPad || run.stage === 'lift') D.yaw += wrap(cam.yaw - D.yaw) * ease(2.5, dt);
    const hover = D.onPad ? 0 : Math.sin(D.time * 2.1) * 0.04 * D.spin;
    Eu.set(D.tiltX + D.wobX, D.yaw, D.tiltZ + D.wobZ);
    U.uDrone.value.compose(V.set(D.x, D.y + hover, D.z), Qd.setFromEuler(Eu), ONE);
    spinProps(dt, t);
  }

  function idlePose(dt, t) {
    // parked on the pad: props winding down, lights off but the status light
    D.spin = Math.max(0, D.spin - dt * 1.5);
    D.tiltX *= 0.9; D.tiltZ *= 0.9;
    Eu.set(D.tiltX, D.yaw, D.tiltZ);
    U.uDrone.value.compose(V.set(D.x, padTop + SKID_Y, D.z), Qd.setFromEuler(Eu), ONE);
    spinProps(dt, t);
  }

  const propA = [0, 0, 0, 0];
  function spinProps(dt, t) {
    const hs = len2(D.vx, D.vz);
    const v = clamp(hs / DRONE.fast, 0, 1);
    // an easy spin the eye can follow, with the blur disc filling in as it speeds up
    const rate = D.spin * (13 + 5 * v);
    for (let k = 0; k < 4; k++) propA[k] = (propA[k] + dt * rate * (k % 2 ? 1 : -1)) % (Math.PI * 2);
    props4.set(propA[0], propA[1], propA[2], propA[3]);
    U.uSpin.value.copy(props4);
    U.uBlur.value = D.spin * (0.5 + 0.35 * v);
    U.uShow.value.w = D.spin > 0.05 ? 1 : 0;
    const high = clamp((D.y - padTop) / SURVEY_M, 0, 1);
    U.uAngles.value.x = 0.25 + 0.6 * high;
    // the windsock swings to point downwind, drooping when it drops
    const wind = DRONE.wind.speed * (1 + DRONE.wind.gust * Math.sin(D.time * 0.7) * Math.sin(D.time * 0.23 + 1));
    U.uAngles.value.y = Math.atan2(Math.cos(DRONE.wind.yaw), -Math.sin(DRONE.wind.yaw)) + Math.sin(t * 1.7) * 0.08;
    U.uAngles.value.z = -(0.9 - 0.45 * clamp(wind, 0, 1.6)) + Math.sin(t * 3.1) * 0.04;
    // lights: nav lights while powered, a strobe blink, screens, the pad lights pulse on the way in
    const on = D.spin > 0.05 ? 1 : 0;
    const strobe = on && (t * 0.9) % 1 < 0.07 ? 1 : 0;
    const coming = run.stage === 'home' || (run.stage === 'fly' && (run.rings >= DRONE.minRings || run.landing === 'pit'));
    U.uGlowK.value.set(on, strobe, 1, coming ? 0.5 + 0.5 * Math.sin(t * 5) : run.stage === 'toPad' ? 0.35 + 0.35 * Math.sin(t * 3) : 0);
    U.uTime.value = t;
    ringM.uniforms.uTime.value = t;
    dots.uniforms.uTime.value = t;
  }

  // ---------------------------------------------------------------- the chase camera

  function placeCamera(dt, still) {
    const C = DRONE.camera;
    const inp = input;
    if (!still) {
      cam.yaw = wrap(cam.yaw - inp.look.x * 0.0055);
      cam.pitch = clamp(cam.pitch + inp.look.y * 0.0045, -0.12, 1.25);
      if (inp.zoom) { cam.dist = clamp(cam.dist * Math.exp(inp.zoom * 0.0012), C.minDist, C.maxDist); cam.zoomAt = D.time; }
      // Q and E turn it (the nose follows the camera's heading)
      // (not in the lift-off, where the E that launched it may still be held down)
      if (run.yawIn && (run.stage === 'fly' || run.stage === 'home')) { cam.yaw = wrap(cam.yaw + run.yawIn * DRONE.turn * dt); cam.turnAt = D.time; cam.want = null; }
      const hs = len2(D.vx, D.vz);
      const idle = (performance.now() - inp.lastLookTime) / 1000;
      const hands = idle > 1.2 && D.time - cam.turnAt > 0.8; // nobody steering the view
      if (cam.want != null && run.stage !== 'fly') {
        cam.yaw += wrap(cam.want - cam.yaw) * ease(1.6, dt);
      } else if (run.edge && hands) {
        // at the edge of the flying area: round towards the island, about 1 rad/s
        const to = Math.atan2(-(ISLAND.x - D.x), -(ISLAND.z - D.z));
        cam.yaw = wrap(cam.yaw + clamp(wrap(to - cam.yaw), -1.0 * dt, 1.0 * dt));
      } else if (hands && hs > 1) {
        // swing round behind the way it is going: straight on quickly, sideways slowly
        // (quicker with a sideways key held, so steering with A or D comes round too)
        const vyaw = Math.atan2(-D.vx, -D.vz);
        const diff = wrap(vyaw - cam.yaw), c = Math.cos(diff);
        const w = c > -0.3 ? 0.35 + 0.65 * Math.max(0, c) : 0;
        const rate = Math.abs(inp.move.x) > 0.3 ? 2.0 : 1.1;
        cam.yaw = wrap(cam.yaw + diff * Math.min(1, rate * dt * Math.min(1.6, hs / DRONE.cruise) * w));
      }
      if (run.stage === 'fly') cam.want = null;
      frameCamera(dt, idle);
    }
    const k = still ? 0 : ease(9, dt);
    cam.tx += (D.x - cam.tx) * k; cam.ty += (D.y + 0.25 - cam.ty) * k; cam.tz += (D.z - cam.tz) * k;
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    V.set(cam.tx + Math.sin(cam.yaw) * cp * cam.dist, cam.ty + sp * cam.dist, cam.tz + Math.cos(cam.yaw) * cp * cam.dist);
    const floor = Math.max(0, T.heightAt(V.x, V.z)) + 0.55;
    if (V.y < floor) V.y = floor;
    // coming in to land the view looks down past the drone to what is under it, so the
    // pad sits in the middle of the screen rather than under the bottom edge
    if (!still) cam.look += ((run.landZone && run.stage !== 'land' ? 1 : 0) - cam.look) * ease(2, dt);
    const lk = cam.look;
    const under = lk > 0.001 ? Math.min(10, Math.max(0, D.y - SKID_Y - (len2(D.x - PAD_AT.x, D.z - PAD_AT.z) < PAD.r ? padTop : Math.max(0, T.heightAt(D.x, D.z))))) : 0;
    LOOK.set(cam.tx - Math.sin(cam.yaw) * 1.4 * (1 - lk), cam.ty - 0.2 - lk * under * 0.55, cam.tz - Math.cos(cam.yaw) * 1.4 * (1 - lk));
    if (cam.shake > 0 && !still) {
      const s = cam.shake * cam.shake;
      V.x += (Math.random() - 0.5) * s; V.y += (Math.random() - 0.5) * s; V.z += (Math.random() - 0.5) * s;
      cam.shake = Math.max(0, cam.shake - dt * 1.2);
    }
    Mx.lookAt(V, LOOK, UP);
    toQ.setFromRotationMatrix(Mx);
    if (cam.blend < 1) {
      if (!still) cam.blend = Math.min(1, cam.blend + dt / 1.3);
      const e = cam.blend * cam.blend * (3 - 2 * cam.blend);
      camera.position.lerpVectors(fromPos, V, e);
      camera.quaternion.slerpQuaternions(fromQ, toQ, e);
      setFov(fromFov + (C.fov - fromFov) * e);
    } else {
      camera.position.copy(V);
      camera.quaternion.copy(toQ);
      setFov(C.fov);
    }
  }
  function setFov(f) {
    if (Math.abs(camera.fov - f) > 0.01) { camera.fov = f; camera.updateProjectionMatrix(); }
  }

  // The camera's framing: high over the player's hat at the lift-off, easing to the
  // cruise framing once the drone is up; coming in to land (a map's worth of rings, or
  // flown home, near the pad and low) it tips to look down on the pad. It eases only
  // while nobody steers the view (a drag, the wheel), and the cruise framing only for a
  // moment after it changes, so a view the player chose stays theirs.
  const ISLAND = { x: 8, z: -2 }; // the middle of the survey, for the edge's swing back
  function frameCamera(dt, idle) {
    const C = DRONE.camera;
    const hd = len2(D.x - PAD_AT.x, D.z - PAD_AT.z), alt = D.y - SKID_Y - padTop;
    const coming = run.stage === 'home' || (run.stage === 'fly' && (run.rings >= DRONE.minRings || run.handedBack || run.landing === 'pit'));
    const zone = coming && hd < C.landR && alt < C.landY;
    run.landZone = zone;
    let target = cam.frame;
    if (zone) target = 'land';
    else if (cam.frame === 'land') target = 'cruise';
    else if (cam.frame === 'lift' && run.stage === 'fly' && alt > 3.5) target = 'cruise';
    if (target !== cam.frame) { cam.frame = target; cam.frameT = target === 'cruise' ? 2.5 : 0; }
    const handsOff = idle > (cam.frame === 'land' ? 2.5 : 1.2) && D.time - cam.zoomAt > 2.5;
    if (!handsOff) { if (cam.frame === 'cruise') cam.frameT = 0; return; }
    if (cam.frame === 'land') {
      const k = ease(1.8, dt);
      cam.pitch += (C.landPitch - cam.pitch) * k;
      cam.dist += (C.landDist - cam.dist) * k;
    } else if (cam.frame === 'cruise' && cam.frameT > 0) {
      cam.frameT -= dt;
      const k = ease(1.5, dt);
      cam.pitch += (C.pitch - cam.pitch) * k;
      cam.dist += (C.dist - cam.dist) * k;
    }
  }

  // this system runs right after the follow camera, so the sky, the trees' cut-out and
  // everything else this frame see the drone's camera
  const flightSystem = { name: 'drone-flight', update: (dt, t) => { try { flight(dt, t); } catch (e) { console.error(e); abort(); } } };
  if (Array.isArray(game.systems)) {
    const at = game.systems.findIndex((s) => s.name === 'camera');
    game.systems.splice(at >= 0 ? at + 1 : game.systems.length, 0, flightSystem);
  }

  // ---------------------------------------------------------------- after everything else: the screens and sound

  const P2 = new THREE.Vector3();
  const G = { battery: 100, ft: 0, kmh: 0, wind: 0, windYaw: 0, camYaw: 0 }; // the gauges' numbers, reused
  const LABELS = rings.map((r) => String(r.n));
  let screenT = 0, restoreT = 0, aerialSrc = null, gaugeT = 0, planN = 0;
  function lateUpdate(dt, t) {
    // the controller in the hand
    if (av && av.bones) {
      const B = av.bones;
      anchor.rotation.x = -B.armR.rotation.x * 0.85 - B.spine.rotation.x;
      anchor.rotation.z = -B.armR.rotation.z;
    }
    U.uShow.value.y = av && av.tool && av.tool.shown === ID && player.object.visible ? 1 : 0;
    hud.tick(dt);
    // the day ended, or the story took over
    if (run.stage !== 'idle' && run.stage !== 'outro' && (state.phase !== 'survey' || (flying() && game.story && game.story.cutscene))) abort();
    // the aerial photo developing over the frames after the landing
    if (photoJob) stepPhoto();
    restoreT -= dt;
    if (restoreT <= 0) { restoreT = 2; restoreAerial(); }
    flagStep(dt);
    if (LOGGING) writeLog(dt);
    if (!flying()) return;
    // the trees' cut-out runs from the camera to the drone, so a crown never hides it
    // (coming down near the pad it reaches on down to the pad, so the crowns round the
    // landing do not hide the H)
    const fk = cam.look * clamp(1 - len2(D.x - PAD_AT.x, D.z - PAD_AT.z) / 10, 0, 1) * 0.85;
    vegUniforms.uVegCam.value.copy(camera.position);
    vegUniforms.uVegFocus.value.set(D.x + (PAD_AT.x - D.x) * fk, D.y + (padTop - D.y) * fk, D.z + (PAD_AT.z - D.z) * fk);
    vegUniforms.uVegCut.value = 1.6;
    // the soft shadow on whatever is under it: the pad's top, leaves or the ground;
    // darker in the last few metres, so it reads as where it will land
    const pd = len2(D.x - PAD_AT.x, D.z - PAD_AT.z);
    const g = Math.max(0, T.heightAt(D.x, D.z));
    const leaves = leafTop(D.x, D.z);
    const surf = pd < PAD.r ? padTop : leaves > g + 0.3 ? leaves : g;
    const hgt = D.y - SKID_Y - surf;
    const low = clamp(1 - hgt / 4, 0, 1);
    blob.mesh.visible = hgt < 24 && !D.onPad && run.dunkT <= 0;
    blob.mesh.position.set(D.x, surf + 0.03, D.z);
    // (a crisp spot about the drone's size near the ground, smaller than the pad so it
    // reads against it; softer and wider the higher it flies)
    blob.mesh.scale.setScalar(0.9 + Math.max(0, hgt) * 0.06);
    blob.mat.opacity = (0.36 + 0.3 * low) * clamp(1 - hgt / 24, 0, 1);
    // the landing aids: the dotted drop line under the skids and the gold ring round the
    // pad, and the key strip stepping aside in the last few metres
    const aid = run.landZone && run.stage !== 'land';
    drop.points.visible = aid && hgt > 0.25 && !D.onPad;
    if (drop.points.visible) {
      drop.points.position.set(D.x, D.y - SKID_Y, D.z);
      drop.uniforms.uLen.value = hgt;
      drop.uniforms.uTime.value = state.settings && state.settings.reducedMotion ? 0 : t; // (still with Reduced motion)
      drop.uniforms.uOk.value = pd < PAD.r - 0.1 ? 1 : 0;
      drop.uniforms.uScale.value = game.renderer.domElement.height * 0.5 / Math.tan(camera.fov * Math.PI / 360);
    }
    ringM.setState(PAD_RING, aid && !D.onPad ? 1 : 3, 0);
    hud.keys(!(aid && hgt < 5 && pd < 4)); // (not while it sits in a tree beside the landing: Space is wanted then)
    // the next ring in gold, the two after it in a paler gold, the rest out of sight
    // (the plan's dots and the inset still show the whole survey); the rings passed
    // fade out as they swell
    const nx = next();
    let ahead = 0;
    for (let i = 0; i < NR; i++) {
      if (!passed[i]) { ringM.setState(i, i === nx ? 1 : ahead <= 2 ? 0 : 3, 0); ahead++; continue; }
      if (ringFade[i] > 0 && ringFade[i] < 1) { ringFade[i] = Math.min(1, ringFade[i] + dt * 1.6); ringM.setState(i, 2, ringFade[i]); }
      else if (ringFade[i] >= 1) ringM.setState(i, 3, 0);
    }
    dots.uniforms.uNext.value = nx >= 0 ? nx : NR;
    dots.uniforms.uScale.value = game.renderer.domElement.height * 0.5 / Math.tan(camera.fov * Math.PI / 360);
    // sound: the hum follows the props and the speed
    humT -= dt;
    if (humT <= 0) {
      humT = 0.05;
      if (!hum && run.stage !== 'land') {
        // made once the sound is running (a browser wakes it on the first key or click)
        humTry -= 0.05;
        const A = aud();
        if (humTry <= 0 && A && A.ctx && A.ctx.state === 'running') { humTry = 1; const h = cue('droneHum'); hum = h && typeof h.set === 'function' ? h : null; }
      }
      const hs = len2(D.vx, D.vz);
      if (hum) hum.set(paused() ? 0.4 * D.spin : D.spin, clamp(hs / DRONE.fast, 0, 1), clamp(D.vy / DRONE.climb, -1, 1));
    }
    // the HUD
    const n = next();
    hud.rings(run.rings, passed, n);
    gaugeT -= dt;
    if (gaugeT <= 0) {
      gaugeT = 1 / 15;
      G.battery = D.battery; G.ft = (D.y - SKID_Y - padTop) * FT_PER_M; G.kmh = len3(D.vx, D.vy, D.vz) * 3.6;
      G.wind = DRONE.wind.speed; G.windYaw = DRONE.wind.yaw; G.camYaw = cam.yaw;
      hud.gauges(G);
    }
    mapDot.x = D.x; mapDot.z = D.z;
    screenT -= dt;
    if (screenT <= 0) { screenT = 1 / 20; screens(n); if (++planN % 2 === 0) hud.drone(D.x, D.z, D.yaw); }
  }
  function next() { for (let i = 0; i < NR; i++) if (!passed[i]) return i; return -1; }

  // ?dronelog=1: the flight's state as JSON in <pre id="drone-log"> once a second (for checks)
  let logEl = null, logT = 0;
  const LOGGING = params.has('dronelog');
  function writeLog(dt) {
    logT -= dt;
    if (logT > 0) return;
    logT = 1;
    if (!logEl) { logEl = document.createElement('pre'); logEl.id = 'drone-log'; logEl.hidden = true; document.body.appendChild(logEl); }
    const st = game.play.drone.state();
    st.leafAtDrone = +leafTop(D.x, D.z).toFixed(2); st.leafAtPad = +leafTop(PAD_AT.x, PAD_AT.z).toFixed(2); st.padTop = +padTop.toFixed(2);
    st.vx = +D.vx.toFixed(2); st.vz = +D.vz.toFixed(2); st.vy = +D.vy.toFixed(2); st.t = +D.time.toFixed(1);
    const ri = game.renderer.info.render;
    st.calls = ri.calls; st.tris = ri.triangles; st.maxCalls = Math.max(logEl.maxCalls || 0, ri.calls); logEl.maxCalls = st.maxCalls;
    st.hist = (logEl.hist = (logEl.hist || []).concat([[st.t, st.stage, st.x, st.y, st.z]]).slice(-40));
    logEl.textContent = JSON.stringify(st);
  }

  // the next ring's number over it (or an arrow at the edge of the screen pointing to
  // it, or to the pad once the rings are done), and the osprey's complaint
  function screens(n) {
    const W = window.innerWidth, H = window.innerHeight;
    // the pad's H stays up all the way down, until the drone is right over it (where the
    // gold ring, the drop line and the shadow take over)
    const hd = len2(D.x - PAD_AT.x, D.z - PAD_AT.z);
    const overPad = hd < 1.6 && D.y - padTop < 2.8;
    if ((run.stage === 'fly' || run.stage === 'home') && !(overPad && (n < 0 || run.stage === 'home' || run.landZone))) {
      const goal = n >= 0 && run.stage === 'fly' && !run.landZone ? rings[n] : null;
      if (goal) P2.set(goal.x, goal.y + RING_R + 0.9, goal.z); else P2.set(PAD_AT.x, padTop + (hd < 6 ? 0.35 : 1.2), PAD_AT.z);
      V2.copy(P2).project(camera);
      const behind = V2.z > 1;
      let sx = V2.x, sy = -V2.y;
      const on = !behind && Math.abs(sx) < 0.92 && Math.abs(sy) < 0.86;
      if (on) {
        hud.arrow(false);
        hud.tag(true, (sx * 0.5 + 0.5) * W, (sy * 0.5 + 0.5) * H, goal ? LABELS[n] : 'H');
      } else {
        hud.tag(false);
        if (behind) { sx = -sx; sy = -sy; }
        const m = Math.max(Math.abs(sx) / 0.86, Math.abs(sy) / 0.72, 1e-3);
        const ex = sx / m, ey = sy / m;
        hud.arrow(true, (ex * 0.5 + 0.5) * W, (ey * 0.5 + 0.5) * H, Math.atan2(sx, -sy));
      }
    } else { hud.arrow(false); hud.tag(false); }
    if (bird.mesh.visible && O.mode === 'chase') {
      V2.set(O.x, O.y + 0.9, O.z).project(camera);
      hud.bubble(V2.z < 1 && Math.abs(V2.x) < 1 && Math.abs(V2.y) < 1, (V2.x * 0.5 + 0.5) * W, (-V2.y * 0.5 + 0.5) * H);
    } else hud.bubble(false);
  }

  // messages, each kind at most every few seconds
  const saidAt = {};
  function say(text, tone, kind) {
    const now = D.time;
    if (saidAt[kind] != null && now - saidAt[kind] < 4) return;
    saidAt[kind] = now;
    hud.msg(text, tone, 2.4);
  }

  // ---------------------------------------------------------------- the photo on the big map, after a reload too

  function restoreAerial() {
    if (photoJob) return; // a new one is developing
    const rec = state.missions && state.missions[ID];
    const src = rec && rec.data && typeof rec.data.photo === 'string' ? rec.data.photo : null;
    const maps = game.ui && game.ui.maps;
    if (!maps || !maps.setAerial) return;
    if (src === aerialSrc) return;
    aerialSrc = src;
    if (!src) { maps.setAerial(null); return; }
    const img = new Image();
    img.onload = () => {
      if (aerialSrc !== src) return;
      // the print, with the map's paths and landmark trees faintly over it
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      try { cv.getContext('2d').drawImage(img, 0, 0); drawMapMarks(cv, PHOTO_EXTENT, data); } catch (e) { /* the marks are a nicety */ }
      maps.setAerial(cv, PHOTO_EXTENT);
    };
    img.src = src;
  }

  // ---------------------------------------------------------------- the mission's face to the rest of the game

  function progress() {
    const doneToday = !!(state.today && state.today.kit && state.today.kit[ID]);
    return { done: flying() || run.stage === 'photo' ? run.rings : doneToday ? NR : 0, goal: NR, label: 'rings flown' };
  }
  function notebook() {
    const rec = state.missions && state.missions[ID];
    const d = (rec && rec.data) || {};
    const flown = !!(rec && rec.done > 0);
    return {
      title: TITLE,
      blurb: 'Ten rings at 150 ft in lawnmower lines, then a soft landing on the pad: the lab\'s aerial map of the island.',
      stamps: [
        { id: 'drone.flown', label: 'Aerial!', icon: 'drone', done: flown },
        { id: 'drone.full', label: 'Full coverage', icon: 'map', done: (d.bestRings || 0) >= NR },
        { id: 'drone.soft', label: 'Soft landing', icon: 'star', done: !!d.soft },
        { id: 'drone.stars', label: 'Top pilot', icon: 'trophy', done: (rec && rec.best >= 3) || false },
      ],
      render(el) {
        const log = Array.isArray(d.log) ? d.log : [];
        // (records from before these were kept: worked out from the flight log)
        const bestBattery = d.bestBattery != null ? d.bestBattery : log.length ? Math.max(...log.map((f) => f.battery || 0)) : null;
        const softs = d.softs != null ? d.softs : log.filter((f) => f.soft).length;
        notebookPage(el, {
          photo: d.photo || null, stamp: d.stamp || '', best: (rec && rec.best) || 0, log, flown, batteryGoal: DRONE.stars.battery,
          bestRings: d.bestRings || 0, bestBattery, softs, bestPhotos: d.bestPhotos != null ? d.bestPhotos : null, photoTotal: NS,
          plan: { land: data.water && data.water.land, spots: SPOTS, taken: typeof d.lastSpots === 'string' ? d.lastSpots : null, rings, pad: PAD_AT },
        });
      },
    };
  }

  events.on('phase:change', () => { if (run.stage !== 'idle' && run.stage !== 'outro') abort(); });
  events.on('day:new', () => { run.todayBest = 0; run.day = state.days; });

  // ---------------------------------------------------------------- flags and scripted play

  let flagT = FLAG ? 0 : -1;
  function flagStep(dt) {
    if (flagT < 0 || state.phase !== 'survey' || !state.clock.running || (game.story && game.story.cutscene)) return;
    flagT += dt;
    if (flagT < 0.6) return;
    flagT = -1;
    player.teleport(STAND.x, STAND.z, STAND.heading);
    rig.yaw = STAND.heading; rig.snap();
    if (STEP === 'pad') { start({ from: 'flag', noLaunch: true }); return; }
    start({ from: 'flag', noLaunch: true });
    launch();
    const after = (s, fn) => setTimeout(fn, s * 1000);
    const skipLift = () => { run.stage = 'fly'; D.onPad = false; D.flown = true; cam.want = null; cam.blend = 1; cam.frame = 'cruise'; cam.frameT = 0; };
    // the first n rings passed, with the photos along the lanes flown through them
    const passN = (n) => {
      for (let i = 0; i < n; i++) { passed[i] = true; ringM.setState(i, 2, 1); ringFade[i] = 1; }
      run.rings = n;
      for (let li = 0; li < LANES.length; li++) {
        for (let si = 0; si < SNAPS_PER_LANE; si++) {
          const first = li % 2 ? SNAPS_PER_LANE - 1 : 0;
          if (n >= 2 * li + 2 || (n >= 2 * li + 1 && si === first)) takePhoto(li * SNAPS_PER_LANE + si, 0.001, false);
        }
      }
    };
    const at = (x, y, z, yaw, pitch = 0.3, dist = DRONE.camera.dist) => {
      D.x = x; D.y = y; D.z = z; D.vx = D.vz = D.vy = 0; D.yaw = yaw; cam.yaw = yaw; cam.pitch = pitch; cam.dist = dist;
      cam.tx = x; cam.ty = y + 0.25; cam.tz = z;
      for (let i = 0; i < NR; i++) side[i] = 0;
    };
    if (STEP === 'hello') after(2.4, () => { skipLift(); at(PAD_AT.x - 0.4, padTop + 2.9, PAD_AT.z - 1.2, 2.6, 0.2, 2.5); run.faceCam = true; run.still = true; });
    else if (STEP === 'rings') after(2.4, () => { skipLift(); passN(2); at(52, surveyY + 1.5, 21, rings[2].yaw, 0.28, 7.5); D.battery = 88; });
    else if (STEP === 'lanes') after(2.4, () => {
      // half way along the second lane, looking back along it at the photos taken, turned mint
      skipLift(); passN(3); at(-2, surveyY, 12.4, rings[3].yaw + Math.PI - 0.3, 0.7, 12); D.battery = 81; run.still = true;
      for (const si of [5, 4, 3]) takePhoto(SNAPS_PER_LANE + si, 0.001, false);
    });
    else if (STEP === 'high') after(2.4, () => { skipLift(); passN(4); at(-24, surveyY + 2, 4, -1.2, 0.36, 8); D.battery = 76; });
    else if (STEP === 'osprey') after(2.4, () => { skipLift(); passN(6); at(46, surveyY - 1, -6, rings[6].yaw + 0.35, 0.22, 6.5); D.battery = 60; O.mode = 'chase'; O.hold = true; hud.msg('The osprey is not amused! [Shift] to get away.', 'warn', 30); });
    else if (STEP === 'land') after(2.4, () => { skipLift(); passN(NR); at(PAD_AT.x + 0.4, padTop + 2.4, PAD_AT.z + 0.3, 0.35, 1.05, 5.4); D.battery = 47; });
    else if (STEP === 'splash') after(2.4, () => {
      skipLift(); passN(3); at(-29.3, 1.6, 30.0, 0.6, 0.32, 6); D.battery = 70;
      const off = input.addSource((f) => { f.held.descend = true; });
      after(1.0, off);
      run.splashHold = true; // the check image's moment: it stays in the splash, dripping
    });
    else if (STEP === 'photo' || STEP === 'map' || STEP === 'notebook') after(2.4, () => {
      skipLift(); passN(NR); D.battery = 46; D.flown = true;
      at(PAD_AT.x, padTop + SKID_Y + 0.4, PAD_AT.z, 0.9, 0.5, 5.5);
      run.stage = 'fly';
      touchdown(-0.9, 0.3, 0.1);
      if (STEP === 'map') after(3.2, () => { kit.escape(); after(1.4, () => kit.openPanel('map')); });
      if (STEP === 'notebook') after(3.2, () => { kit.escape(); after(1.4, () => kit.openPanel('notebook', 'kit:drone')); });
    });
  }

  game.play = Object.assign(game.play || {}, {
    drone: {
      start: (o) => start({ from: 'play', ...(o || {}) }),
      launch: () => { if (run.stage === 'idle') start({ from: 'play', noLaunch: true }); launch(); },
      auto(on = true) { run.auto = !!on; return run.auto; },
      home: () => { run.rthAsked = true; },
      leafTop: (x, z) => +leafTop(x, z).toFixed(2),
      state: () => ({ stage: run.stage, rings: run.rings, photos: run.photos, battery: +D.battery.toFixed(1), x: +D.x.toFixed(2), y: +D.y.toFixed(2), z: +D.z.toFixed(2), onPad: D.onPad, osprey: O.mode, handedBack: run.handedBack, landZone: run.landZone, frame: cam.frame, camPitch: +cam.pitch.toFixed(2), camDist: +cam.dist.toFixed(2), camYaw: +cam.yaw.toFixed(3), developing: !!photoJob, result: run.result && { ...run.result, photo: !!run.result.photo || !!photoJob } }), // (photo: taken, even while it develops)
      // for checks: put the drone somewhere (it keeps flying from there)
      place(x, y, z) { D.x = x; D.y = y; D.z = z; D.vx = D.vy = D.vz = 0; D.onPad = false; D.flown = true; for (let i = 0; i < NR; i++) side[i] = 0; cam.tx = x; cam.ty = y; cam.tz = z; },
      gotoPad: () => { player.teleport(STAND.x, STAND.z, STAND.heading); rig.yaw = STAND.heading; rig.snap(); },
      rings, pad: { ...PAD_AT, top: padTop }, DRONE,
      photos: () => ({ taken: run.photos, total: NS, gaps: gaps().length, spots: Array.from(taken).join('') }),
    },
  });

  // the flight's shaders (rings, plan, drop line, shadow, osprey) compiled now, while the
  // game loads, not on the first lift-off (where they cost a hitch); the parked kit mesh
  // is on show from the start, so it is compiled with the scene anyway
  if (!topView && game.renderer && typeof game.renderer.compileAsync === 'function') {
    const hidden = [bird.mesh, ringM.mesh, dots.points, drop.points, blob.mesh].filter((o) => !o.visible);
    for (const o of hidden) o.visible = true;
    try { game.renderer.compileAsync(group, camera, scene).catch(() => {}); } catch (e) { /* only a head start */ }
    for (const o of hidden) o.visible = false;
    // and the photo's readback, a few seconds on, once the game is up
    setTimeout(() => { try { warmAerialPhoto(game); } catch (e) { /* only a head start */ } }, 4000);
  }

  return mission;
}
