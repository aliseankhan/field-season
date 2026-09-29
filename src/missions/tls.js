// The TLS scanner. In October 2025 the lab scanned Lizard Island with a
// RIEGL terrestrial laser scanner on a tripod from 88 scan positions, and anyone who
// walked through a scan had to be cleaned out of the cloud afterwards. James asks for
// three scans. Carry the scanner (a chunky cream head in the hand, the tripod on the
// pack) to one of the coral markers (real scan positions, data/scanpos.json), set it
// down, level it (a bubble-level mini-game), then keep out of its sight while the head
// turns once with its laser fan sweeping: duck behind a trunk or a bush (the radar shows
// only cover that hides someone creeping low), or keep round behind the head as it
// turns. If it sees you, you land in the cloud as a sheet ghost (eyes and all) and the
// scan loses a star; "Hidden!" is a promise (a pass of the fan that began while you were
// hidden is forgiven unless you stepped well out). A white ibis may flap through for a
// cameo. The scan paints its cloud over the island behind the fan (rays cast from the
// head against the ground grid and veg.hosts, tls_cast.js), a wave of light runs out as
// it lands, and it lingers and fades away. Every scan joins one combined cloud on the
// mission's notebook page, in a small 3D view you can turn.
//
// A mission (src/missions/index.js): build(game) -> { id: 'tls', title: 'Laser scans', tool: 'tls',
// available(), start(opts), active, update(dt, t), progress(), notebook(), stats,
// mapMarks() }, and the tool 'tls' in the ring (no quick key). Events: mission:start
// { id, from }, mission:step { id, step: 'walk' | 'level' | 'scan' | 'ghost' | 'bird' |
// 'scanned' (with n, stars, ghosts) | 'packed' }, mission:done { id, stars } (the registry scores it),
// mission:fail { id, why: 'packed' } (the level given up; James says never mind and the
// mission stays on). A new day or the day's end puts it away quietly. Each scan scores its own small
// points (stars x RULES.points.scan, reason 'scan').
//
// Flags: ?mission=tls (implies ?phase=survey) starts the mission as the day begins and
// stands the player by a spot (&missionspot=1..8, else 1, or 5 for the reveal);
// &missionstep=level holds the level
// card, =scan holds a scan mid-sweep (the fan and the cloud so far), =ghost lets the
// scanner see you and holds on your ghost, =reveal holds the landed cloud from above,
// =done makes three quick scans (the mission finishes), =notebook makes three scans
// (one with a ghost, one with the ibis) and opens the notebook's page, =auto plays
// scans with the player keeping behind the head, =countdown holds the countdown with a
// close look at the scanner. window.__game.play.tls has helpers.

import * as THREE from 'three';
import { events } from '../core/events.js';
import { state, RULES, addScore, dayKey, save, holdClock } from '../game/state.js';
import * as kit from '../ui/kit.js';
import { registerTool, registerInteraction, equip, current as currentTool } from '../tools/ring.js';
import { getMarkers } from '../tools/markers.js';
import { audio } from '../audio/index.js';
import { SCRIPT, say } from '../story/script.js';
import { registerMission, missionRecord } from './index.js';
import { buildCaster, KIND } from './tls_cast.js';
import { buildCloud, COLS, RANGE } from './tls_cloud.js';
import { buildScanner, buildCarried, buildFan, buildBird, LASER_Y } from './tls_models.js';
import { levelMinigame } from './tls_level.js';
import { makeHud, renderNotebook, ensureTlsStyle } from './tls_ui.js';
import { FLAGS } from '../config.js';

// How the scanning feels.
export const TLS = {
  goal: 3, // scans James asks for
  reach: 1.9, // m from a spot where [E] sets the scanner down
  stand: 1.45, // m from the tripod where the player ends up
  turn: [17, 15, 13.5], // s for the head's full turn: the day's first scan, second, third on
  countdown: 3, // s
  lead: 0.33, // the fan starts this share of a turn before the player
  ghostMin: 6, // points of you that make a ghost at least (fewer: a stray sleeve, no star lost)
  ghostShare: 0.15, // and the share of you (as seen standing in the open) the fan must catch
  hiddenShare: 2, // times as much when the fan reached you while you were hidden
  probe: 0.35, // m of leaves a look from the window must cross for a bush to hide you
  behind: 2.44, // rad (140 degrees) round from the fan: behind the head, calm
  seenFor: 1.3, // s the card says "Seen!"
  linger: 7, // s the cloud stays bright before it fades away (it stays in the notebook)
  reveal: 4.4, // s the camera looks over the landed cloud
  pack: 0.55, // s to fold it up
  birdChance: 0.55,
  cover: 13, // m round the scanner the radar shows trunks and bushes (those that hide you)
  mark: '#ff7a6b',
  colsPerFrame: 40, // at most (a slow frame catches up over the next few)
};
const TAU = Math.PI * 2;
const DAZ = TAU / COLS; // the fan's step round, radians
const params = new URLSearchParams(location.search);
const FLAG_ON = params.get('mission') === 'tls';
const STEP = FLAG_ON ? params.get('missionstep') || 'walk' : null;
// the spot each check image uses unless &missionspot= says (at spot 1 the fan sweeps
// side on to the camera; the reveal's spot 5 is an open lawn)
const FLAG_SPOT = Math.max(1, Math.min(8, Number(params.get('missionspot')) || ({ reveal: 5 }[STEP] || 1)));

const wrap = (a) => { a %= TAU; return a < 0 ? a + TAU : a; };
const azimuthOf = (dx, dz) => Math.atan2(-dx, -dz); // heading convention: (-sin a, -cos a)
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export async function build(game) {
  const t0 = performance.now();
  ensureTlsStyle();
  const { player, scene } = game;
  let data = null;
  try {
    const r = await fetch('data/scanpos.json');
    if (r.ok) data = await r.json();
  } catch (e) { data = null; }
  if (!data || !Array.isArray(data.mission) || !data.mission.length) {
    console.warn('tls: no data/scanpos.json; the laser scan is off');
    return null;
  }

  const caster = buildCaster(game);
  const cloud = buildCloud(game, caster);
  const NOW = cloud.now; // [t, dt], set once a frame; the parts read it (no numbers passed)
  const scanner = buildScanner(NOW);
  const carried = buildCarried();
  const fan = buildFan(NOW);
  const bird = buildBird(NOW);
  const group = new THREE.Group();
  group.name = 'tls';
  group.add(cloud.points, cloud.dim, scanner.group, fan.mesh, bird.mesh);
  const topView = FLAGS.view === 'top';
  if (topView) group.visible = false;
  // Its shaders are compiled now, while the game loads, not at the first scan's set-down,
  // countdown and reveal (each hitched once a session), and its parts are drawn once, tiny
  // and see-through, in the first two frames under the loading card (primeParts), so the
  // graphics driver has set up their drawing too. The notebook view's are its own.
  if (!topView && game.renderer && game.camera) {
    try {
      const R = game.renderer;
      if (typeof R.compileAsync === 'function') R.compileAsync(group, game.camera, scene).catch(() => {});
      else R.compile(group, game.camera, scene);
    } catch (e) { /* compiled at first use instead */ }
  }

  // the spots: the mission's eight, on the ground grid
  const spots = data.mission.map((m) => ({ n: m.n, x: m.x, z: m.z, y: caster.groundAt(m.x, m.z), place: m.place || '' }));
  const surveyed = (data.stats && data.stats.surveyed) || 88;
  cloud.setMarks(spots);

  // the carried scanner on the avatar's bones: the head in the right hand (turned like
  // the avatar's own held tools), the tripod bundle on the pack
  const B = player.avatar && player.avatar.bones;
  if (B && B.armR && B.holdGps) {
    carried.hand.position.copy(B.holdGps.position);
    B.armR.add(carried.hand);
  }
  if (B && B.spine) {
    carried.back.position.set(-0.15, 0.17, 0.25);
    carried.back.rotation.set(0.12, 0, 0.42);
    B.spine.add(carried.back);
  }

  const hud = makeHud();
  const markers = getMarkers(scene);

  // ---------------------------------------------------------------- the mission's state

  const M = {
    id: 'tls', title: 'Laser scans', tool: 'tls',
    active: false,
    step: 'idle', // idle, placing, level, countdown, scan, reveal, packing
  };
  let today = { day: dayKey(), scans: [] }; // this survey day's scans: { n, place, stars, ghosts, bird }
  let spot = null; // the spot being scanned
  let scan = null; // the cloud's scan object
  let stand = { x: 0, z: 0, fx: 0, fz: 0 }; // where the player steps back to
  let dyn = null; // the tripod's collision circle
  let flag = { t: 0, done: !FLAG_ON, stage: 'wait', freeze: false, noGhost: false, autoHide: false };
  const run = {
    turn: 15, theta0: 0, dir: 1, sweep: 0, az: 0, ahead: 9, ghosts: 0, ghostPts: 0, seenT: -9, birdOn: false, birdSeen: false,
    birdPlanned: false, birdT: 0, birdAt: 0.4, birdDur: 5, birdFrom: new THREE.Vector3(), birdTo: new THREE.Vector3(),
    motorT: 0, warnT: 0, checkT: 0, headFrom: 0, lastPct: -1, lastMood: 0,
    state: 'open', hint: '', lastCd: -1, gh: [], hat: [], stars: 3, stepT: 0, hudT: 0,
    // a pass of the fan over you: on, and whether you were hidden and where you were when
    // it reached you
    passOn: false, passHidden: false, passX: 0, passZ: 0, passH: 1.58,
    // the ibis's flight in columns of the scan: [from xyz, to xyz, first column, columns]
    birdPath: new Float64Array(8),
  };
  const reveal = { t: 0, from: new THREE.Vector3(), look: new THREE.Vector3(), cam: new THREE.Vector3(), yaw0: 0, hold: false };

  const todayCount = () => today.scans.length;
  // the three scans' stars: three only with not a ghost in any of them (James says so),
  // else the rounded mean, at most two
  function missionStars(list) {
    if (!list.length) return 1;
    const mean = list.reduce((a, x) => a + x.stars, 0) / list.length;
    const clean = list.every((x) => !x.ghosts);
    return clean ? 3 : Math.max(1, Math.min(2, Math.round(mean)));
  }
  const doneToday = (n) => today.scans.some((s) => s.n === n);
  function available() { return state.phase === 'survey' && todayCount() < TLS.goal; }
  function progress() { return { done: Math.min(TLS.goal, todayCount()), goal: TLS.goal, label: 'Laser scans' }; }
  function step(name, extra = {}) { events.emit('mission:step', { id: 'tls', step: name, ...extra }); }

  // saved with the notebook: every scan's spot, stars, the ghosts' places and seeds, so
  // the combined cloud can be cast again after a reload
  function rec() { return missionRecord('tls'); }
  function saveScan(entry) {
    const d = rec().data;
    if (!Array.isArray(d.scans)) d.scans = [];
    d.scans.push(entry);
    while (d.scans.length > 8) d.scans.shift();
    d.total = (d.total || 0) + 1;
    if (entry.ghosts) d.ghosts = (d.ghosts || 0) + entry.ghosts;
    if (entry.bird) d.birds = (d.birds || 0) + 1;
    if (entry.stars >= 3) d.clean = (d.clean || 0) + 1;
  }

  // ---------------------------------------------------------------- start and stop

  function start(opts = {}) {
    if (M.active || state.phase !== 'survey') return false;
    if (today.day !== dayKey()) today = { day: dayKey(), scans: [] };
    M.active = true;
    M.step = 'idle';
    showMarkers();
    if (!opts.noEquip) equip('tls');
    events.emit('mission:start', { id: 'tls', from: opts.from || 'james' });
    step('walk');
    if (opts.from === 'ring' && SCRIPT.missions && SCRIPT.missions.selfStart) {
      kit.toast(`James: ${say(SCRIPT.missions.selfStart, { title: 'laser scanner', name: state.playerName })}`, { icon: 'tls', tone: 'good', ms: 3600 });
    } else if (!opts.debug) {
      kit.toast('Carry the scanner to a *coral marker* and press [E] to set it down', { icon: 'tls', tone: 'info', ms: 4200 });
    }
    return true;
  }
  function stop(why = 'stopped') {
    abortScan();
    if (!M.active) return;
    M.active = false;
    M.step = 'idle';
    showMarkers();
    if (why) events.emit('mission:fail', { id: 'tls', why });
  }
  events.on('day:new', () => { if (M.active) stop(null); today = { day: dayKey(), scans: [] }; });
  events.on('phase:change', (e) => { if (e && e.phase !== 'survey' && (M.active || M.step !== 'idle')) stop(null); });

  // the coral markers on the spots still to scan today, in the world and on the maps
  // (while the mission is on and the scanner is not set down)
  const mapMarks = [];
  let marksKey = '';
  function showMarkers() {
    const on = M.active && M.step === 'idle';
    const left = on ? spots.filter((s) => !doneToday(s.n)) : [];
    const key = left.map((s) => s.n).join(',');
    if (key === marksKey) return;
    marksKey = key;
    markers.set('tls', left.length ? left.map((s) => ({ x: s.x, y: s.y, z: s.z, colour: TLS.mark })) : null);
    for (const off of mapMarks) off();
    mapMarks.length = 0;
    const maps = game.ui && game.ui.maps;
    if (maps && maps.addMarker) for (const s of left) mapMarks.push(maps.addMarker({ x: s.x, z: s.z, colour: TLS.mark, pulse: true, label: 'Scan' }));
  }

  // ---------------------------------------------------------------- the tool

  registerTool({
    id: 'tls', name: 'Laser scanner', icon: 'tls', key: null, order: 62, pose: 'hold', phrase: 'laser scanner',
    onEquip() {
      if (state.phase === 'survey' && !M.active && available()) start({ from: 'ring', noEquip: true });
      else if (state.phase === 'setup') kit.toast('The field kit is for survey day. James will hand out the jobs!', { icon: 'tls', tone: 'info' });
      if (deployed()) player.avatar.setTool('tls', { pose: 'free' });
    },
  });
  const deployed = () => M.step !== 'idle';

  // [E] by a spot: set the scanner down (taking it out first if need be)
  const offer = { score: 0, prompt: '[E] Set up the laser scanner here', run: null };
  let offered = null;
  const setUpOffered = () => { if (offered) setUp(offered); };
  offer.run = setUpOffered;
  // (during the countdown and the scan [E] does nothing else, and the scan card says it
  // all: no hint along the bottom)
  const busyOffer = { score: 99, prompt: '', run: null };
  registerInteraction({
    id: 'tls',
    check() {
      if (M.step === 'countdown' || M.step === 'scan') return busyOffer;
      if (!M.active || M.step !== 'idle' || state.phase !== 'survey') return null;
      let best = null, bd = TLS.reach;
      for (const s of spots) {
        if (doneToday(s.n)) continue;
        const d = Math.hypot(s.x - player.position.x, s.z - player.position.z);
        if (d < bd) { bd = d; best = s; }
      }
      if (!best) return null;
      offered = best;
      offer.score = 20 - bd; // at a spot, setting up comes before anything else here
      return offer;
    },
  });

  // ---------------------------------------------------------------- setting down, levelling

  function setUp(s) {
    if (M.step !== 'idle' || !s) return;
    spot = s;
    equip('tls', { silent: true });
    M.step = 'placing';
    run.stepT = 0;
    // where the player stands: stepped back along the way they came, on free ground
    const px = player.position.x, pz = player.position.z;
    let ax = px - s.x, az = pz - s.z;
    const al = Math.hypot(ax, az) || 1;
    ax /= al; az /= al;
    let best = null;
    for (let k = 0; k < 16 && !best; k++) {
      const a = Math.atan2(az, ax) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (TAU / 16);
      const x = s.x + Math.cos(a) * TLS.stand, z = s.z + Math.sin(a) * TLS.stand;
      if (game.collision.isFree(x, z)) best = { x, z };
    }
    if (!best) best = { x: px, z: pz };
    stand.x = best.x; stand.z = best.z; stand.fx = px; stand.fz = pz;
    player.hold('tls', true);
    // the scanner pops up on its tripod, its display to the player
    scanner.group.position.set(s.x, s.y, s.z);
    scanner.group.visible = true;
    scanner.group.scale.setScalar(0.01);
    scanner.head.rotation.y = azimuthOf(best.x - s.x, best.z - s.z) + Math.PI;
    scanner.setDisplay(['LEVEL?'], 'warn');
    if (dyn) game.collision.setDynamic(dyn, s.x, s.z, 0.42); else dyn = game.collision.addDynamic(s.x, s.z, 0.42);
    coverFor(s); // (once a spot: the cover that hides someone creeping low, for the radar)
    frame.yaw = null; frame.back = false; frame.user = false;
    if (game.rig) frame.yaw0 = game.rig.yaw;
    player.avatar.setTool('tls', { pose: 'free' });
    audio.cue('tlsSetDown', true);
    if (game.fx && game.fx.burst) game.fx.burst('dust', s.x, s.y + 0.05, s.z, 7);
    showMarkers();
    step('level');
  }

  async function level() {
    M.step = 'level';
    const n = todayCount();
    const res = await kit.minigame(levelMinigame({ difficulty: 0.25 + 0.25 * n, hold: flag.stage === 'level' }));
    if (M.step !== 'level') return; // the day ended meanwhile
    if (!res || !res.success) {
      // given up: packed away, and James says never mind (the mission stays on)
      packUp(false);
      events.emit('mission:fail', { id: 'tls', why: 'packed' });
      return;
    }
    beginCountdown();
  }

  function beginCountdown() {
    M.step = 'countdown';
    run.stepT = 0;
    run.lastCd = -1;
    const n = todayCount();
    hudState.title = scanTitle();
    run.turn = TLS.turn[Math.min(TLS.turn.length - 1, n)] * (flag.fast || 1);
    run.dir = n % 2 ? -1 : 1;
    // the fan starts a third of a turn before wherever you stand now
    const a = azimuthOf(player.position.x - spot.x, player.position.z - spot.z);
    // (rounded as it is saved, so a re-cast after a reload starts exactly where this did)
    run.theta0 = +wrap(a - run.dir * TLS.lead * TAU + (flag.theta || 0)).toFixed(4);
    run.headFrom = scanner.head.rotation.y;
    run.sweep = 0;
    run.stars = 3;
    run.ghosts = 0; run.ghostPts = 0; run.seenT = -9; run.gh.length = 0; run.hat.length = 0;
    run.passOn = false; run.passHidden = false; run.state = 'open'; run.ahead = 9;
    run.birdPath[7] = 0;
    run.birdOn = false; run.birdSeen = false;
    run.birdPlanned = rand01(spot.n * 13 + dayKey() * 7 + n) < TLS.birdChance || flag.bird === true;
    if (flag.bird === false) run.birdPlanned = false;
    run.birdAt = 0.18 + 0.4 * rand01(spot.n * 31 + n);
    collectCover();
    hud.show(true);
    player.hold('tls', false);
  }

  function beginScan() {
    M.step = 'scan';
    run.stepT = 0;
    hudState.title = scanTitle();
    const slot = cloud.freeSlot();
    // a spot scanned again replaces its old scan
    for (const s of cloud.slots) if (s.used && !s.hidden && s.spot === spot.n && s.i !== slot) cloud.hide(s.i);
    scan = cloud.begin(slot, {
      x: spot.x, y: spot.y + LASER_Y, z: spot.z, theta0: run.theta0, dir: run.dir, spot: spot.n,
      seed: spot.n * 1009 + dayKey() * 17 + todayCount(), linger: flag.hold ? 1e6 : TLS.linger,
    });
    run.motorT = 0;
    audio.cue('tlsSweep');
    scanner.setDisplay(['SCAN', '0%'], 'ok', 0);
    step('scan');
  }

  // ---------------------------------------------------------------- the scan, each frame

  const _v = new THREE.Vector3();
  function scanFrame() {
    const dt = NOW[1], t = NOW[0];
    run.sweep = Math.min(1, run.sweep + dt / run.turn);
    const want = Math.min(COLS, Math.floor(run.sweep * COLS + 1e-6));
    // the player's sheet ghost, where they stand now, and the bird
    const G = caster.ghost;
    G[0] = flag.noGhost ? 0 : 1;
    G[1] = player.position.x; G[2] = player.position.z; G[3] = player.position.y;
    G[4] = 1.58 - player.crouch * 0.42; G[5] = 0.3;
    const gx = spot.x - player.position.x, gz = spot.z - player.position.z, gl = Math.sqrt(gx * gx + gz * gz) || 1;
    G[6] = gx / gl; G[7] = gz / gl; G[8] = t;
    cloud.now[0] = t;
    let n = 0;
    // (the ibis stands where its flight puts it at each column, so a re-cast after a
    // reload draws the same streak)
    while (scan.col < want && n < TLS.colsPerFrame) { birdAtColumn(run.birdPath, scan.col); cloud.column(scan, scan.col); n++; }
    cloud.flush(scan);
    run.az = run.theta0 + run.dir * (scan.col / COLS) * TAU;
    scanner.head.rotation.y = run.az;
    // the fan has reached you: were you hidden (then the pass is forgiven unless it sees
    // a lot more of you), and where were you
    if (scan.ghostRun > 0 && !run.passOn) {
      run.passOn = true;
      run.passHidden = hiddenAt(player.position.x, player.position.z, player.position.y, G[4]);
      run.passX = player.position.x; run.passZ = player.position.z; run.passH = G[4];
    }
    // a pass of the fan over you ended: a ghost if it saw a good share of you (about a
    // sixth of what it would get of you standing in the open there), else only a bit of
    // hat or sleeve, forgiven
    if (scan.ghostRun > 0 && (scan.col - scan.ghostCol > 3 || scan.col >= COLS)) {
      const whole = (0.6 / (gl * DAZ)) * (G[4] / (gl * 0.0087));
      const need = Math.max(TLS.ghostMin, TLS.ghostShare * whole) * (run.passHidden ? TLS.hiddenShare : 1);
      if (scan.ghostRun >= need) ghostEvent();
      else {
        run.hat.push([+run.passX.toFixed(2), +run.passZ.toFixed(2), +run.passH.toFixed(2)]);
        kit.toast('Phew! Only a bit of your hat got scanned', { icon: 'eye', tone: 'info', ms: 2200 });
      }
      scan.ghostRun = 0;
      run.passOn = false;
      run.checkT = 0; // the card says so at once
    }
    if (scan.birdHits > 0 && !run.birdSeen) {
      run.birdSeen = true;
      kit.toast('An ibis flew through the scan! The lab would clean it out too', { icon: 'eye', tone: 'info', ms: 3200 });
      step('bird');
    }
    // the fan: its sheet reaches as far as its rays went
    const FL = fan.len, FT = cloud.fanT, lim = 11;
    for (let j = 0; j < FL.length; j++) { const v = FT[rowIdx[j]]; FL[j] = v < 0.3 ? 0.3 : v > lim ? lim : v; }
    const FF = fan.F;
    FF[0] = spot.x; FF[1] = spot.y + LASER_Y; FF[2] = spot.z; FF[3] = run.az; FF[4] = run.dir;
    fan.set();
    // the motor's whirr, a segment at a time (so a pause stops it)
    run.motorT -= dt;
    if (run.motorT <= 0) { run.motorT = 0.85; audio.cue('tlsMotor', 1.0, 1 + 0.05 * todayCount(), spot.x, spot.z); }
    // are you seen, hidden, or safe in the part already scanned?
    run.checkT -= dt;
    if (run.checkT <= 0) { run.checkT = 0.15; exposure(); }
    const ahead = run.ahead;
    if (run.state === 'open' && ahead < 1.2 && ahead >= 0) {
      run.warnT -= dt;
      if (run.warnT <= 0) { run.warnT = 0.1 + 0.45 * (ahead / 1.2); audio.cue('tlsWarn', 1 - ahead / 1.2); }
    }
    // the little display: its percentage (redrawn only when it changes)
    const pct = Math.round(run.sweep * 100), mood = t - run.seenT < 1.5 ? 1 : 0;
    if (pct !== run.lastPct || mood !== run.lastMood) {
      run.lastPct = pct; run.lastMood = mood;
      scanner.setDisplay(mood ? ['BOO!', pct + '%'] : ['SCAN', pct + '%'], mood ? 'ghost' : 'ok', run.sweep);
    }
    if (scan.col >= COLS) finishScan();
  }
  // the fan's elevation samples to the cloud's rows (tls_cloud.js's table), found once
  const ROW_EL = [];
  for (let r = 0; r < cloud.ROWS; r++) ROW_EL.push(Math.asin(cloud.rowSin[r]));
  const rowIdx = Int32Array.from(fan.elRad, (e) => { let b = 0, bd = 9; ROW_EL.forEach((x, r) => { if (Math.abs(x - e) < bd) { bd = Math.abs(x - e); b = r; } }); return b; });

  // The ibis's place for column c of the scan (caster.bird), from its flight
  // P = [from xyz, to xyz, first column, columns] (P[7] 0: no bird)
  function birdAtColumn(P, c) {
    const Bd = caster.bird;
    const k = P[7] > 0 ? (c + 0.5 - P[6]) / P[7] : -1;
    if (k < 0 || k > 1) { Bd[0] = 0; return; }
    Bd[0] = 1; Bd[4] = 0.42;
    Bd[1] = P[0] + (P[3] - P[0]) * k;
    Bd[2] = P[1] + (P[4] - P[1]) * k + Math.sin(k * Math.PI) * 0.6;
    Bd[3] = P[2] + (P[5] - P[2]) * k;
  }

  // Is someone standing at (px, pz) on ground py, hgt tall (the ghost's height: 1.58
  // standing, 1.16 creeping), hidden from the window? Seven looks from the window at the
  // sheet the scan would draw of them: the top of the head, the shoulders either side,
  // the chest, the middle either side and the knees; each must be stopped by the
  // ground, a trunk, a limb or at least TLS.probe metres of leaves. Probes only: the
  // scan's random stream is left alone.
  const BODY = new Float64Array([
    // across (m, to the right as the scanner sees you), up (m from the top when < 0,
    // else a share of the height)
    0, -0.06, -0.17, -0.2, 0.17, -0.2, 0, 0.58, -0.23, 0.5, 0.23, 0.5, 0, 0.26,
  ]);
  function hiddenAt(px, pz, py, hgt, from = spot) {
    const G = caster.ghost, Bd = caster.bird, g0 = G[0], b0 = Bd[0];
    G[0] = 0; Bd[0] = 0;
    const R = caster.R;
    const ox = from.x, oy = from.y + LASER_Y, oz = from.z;
    let ax = px - ox, az = pz - oz;
    const al = Math.sqrt(ax * ax + az * az) || 1;
    ax /= al; az /= al;
    let hidden = true;
    for (let k = 0; k < BODY.length && hidden; k += 2) {
      const side = BODY[k], up = BODY[k + 1];
      const h = up < 0 ? hgt + up : hgt * up;
      const tx = px - az * side - ox, ty = py + h - oy, tz = pz + ax * side - oz;
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
      R[0] = ox; R[1] = oy; R[2] = oz; R[3] = tx / tl; R[4] = ty / tl; R[5] = tz / tl; R[6] = Math.max(0.1, tl - 0.3);
      const kind = caster.probe(TLS.probe);
      if (kind === 0 || kind === KIND.WATER) hidden = false;
    }
    G[0] = g0; Bd[0] = b0;
    return hidden;
  }

  // What the scanner makes of you now: seen (just), being scanned (the fan is on you:
  // the verdict comes when it has gone by), safe in the part already scanned, hidden
  // behind something (hiddenAt), behind the head (the fan more than 140 degrees round
  // from you), or in the open. run.ahead: radians before the fan reaches you.
  function exposure() {
    const px = player.position.x, pz = player.position.z, py = player.position.y;
    const dx = px - spot.x, dz = pz - spot.z, d = Math.sqrt(dx * dx + dz * dz);
    const a = azimuthOf(dx, dz);
    const off = wrap((a - run.theta0) * run.dir);
    const swept = run.sweep * TAU;
    run.ahead = off - swept;
    if (game.time - run.seenT < TLS.seenFor) { run.state = 'seen'; return; }
    if (scan && scan.ghostRun > 0) { run.state = run.passHidden ? 'hidden' : 'scanning'; return; }
    // (safe once the fan is past the whole of you, not just your middle)
    if (off < swept - (0.05 + 0.32 / Math.max(0.5, d))) { run.state = 'safe'; return; }
    if (d > RANGE) { run.state = 'safe'; return; }
    if (hiddenAt(px, pz, py, 1.58 - player.crouch * 0.42)) { run.state = 'hidden'; return; }
    run.state = run.ahead >= TLS.behind ? 'behind' : 'open';
  }

  function ghostEvent() {
    run.ghosts++;
    run.seenT = game.time;
    run.stars = Math.max(1, 3 - run.ghosts);
    // (where you were when the fan reached you: a re-cast after a reload stands the ghost there)
    run.gh.push([+run.passX.toFixed(2), +run.passZ.toFixed(2), +run.passH.toFixed(2)]);
    audio.cue('tlsGhost');
    kit.toast(run.ghosts === 1 ? 'Boo! The scanner saw you: you\'re a ghost in the cloud. -1 star' : 'Another ghost of you in the cloud! -1 star', { icon: 'eye', tone: 'warn', ms: 3000 });
    step('ghost', { ghosts: run.ghosts });
  }

  // the bird: planned to cross where the fan will be when it is half way over
  function birdStart() {
    run.birdOn = true;
    run.birdT = 0;
    const tMid = 2.6; // s to the middle of its flight
    const azMid = run.theta0 + run.dir * Math.min(0.98, run.sweep + tMid / run.turn) * TAU;
    const r = 6 + 3 * rand01(spot.n + 5);
    const mx = spot.x - Math.sin(azMid) * r, mz = spot.z - Math.cos(azMid) * r;
    const my = Math.max(caster.groundAt(mx, mz), 0) + 3.2 + 1.8 * rand01(spot.n + 9);
    const across = azMid + (rand01(spot.n + 3) < 0.5 ? 1 : -1) * (Math.PI / 2 + 0.4 * (rand01(spot.n + 4) - 0.5));
    const vx = -Math.sin(across), vz = -Math.cos(across);
    const speed = 6.2;
    run.birdFrom.set(mx - vx * speed * tMid, my + 1.2, mz - vz * speed * tMid);
    run.birdTo.set(mx + vx * speed * tMid, my - 0.4, mz + vz * speed * tMid);
    run.birdDur = tMid * 2;
    // its flight in the scan's columns (for the caster, and saved with the scan)
    // (rounded as it is saved: a re-cast draws the very same streak)
    const P = run.birdPath, r2 = (v) => Math.round(v * 100) / 100;
    P[0] = r2(run.birdFrom.x); P[1] = r2(run.birdFrom.y); P[2] = r2(run.birdFrom.z);
    P[3] = r2(run.birdTo.x); P[4] = r2(run.birdTo.y); P[5] = r2(run.birdTo.z);
    P[6] = Math.round(run.sweep * COLS * 10) / 10; P[7] = Math.round((run.birdDur / run.turn) * COLS * 10) / 10;
    bird.mesh.visible = true;
    bird.mesh.rotation.set(0, Math.atan2(-vx, -vz), 0);
    bird.mesh.position.copy(run.birdFrom);
    audio.cue('tlsBird', mx, mz);
  }
  function birdFrame() {
    const dt = NOW[1], t = NOW[0];
    if (!run.birdOn) return;
    run.birdT += dt;
    const k = run.birdT / run.birdDur;
    bird.mesh.position.lerpVectors(run.birdFrom, run.birdTo, k);
    bird.mesh.position.y += Math.sin(k * Math.PI) * 0.6;
    bird.mesh.rotation.z = Math.sin(t * 1.3) * 0.12;
    bird.update();
    if (k >= 1) { run.birdOn = false; bird.mesh.visible = false; }
  }

  function finishScan() {
    const t = NOW[0];
    cloud.finish(scan, t, flag.hold ? 1e6 : TLS.linger);
    fan.update(0);
    const stars = run.stars;
    const entry = {
      n: spot.n, place: spot.place, stars, ghosts: run.ghosts, bird: run.birdSeen,
      seed: spot.n * 1009 + dayKey() * 17 + todayCount(), theta0: +run.theta0.toFixed(4), dir: run.dir, gh: run.gh.slice(),
    };
    // the forgiven bits of hat, and the ibis's flight, so a re-cast after a reload has them
    if (run.hat.length) entry.hat = run.hat.slice();
    if (run.birdPath[7] > 0) entry.bp = Array.from(run.birdPath);
    caster.bird[0] = 0;
    today.scans.push({ n: spot.n, place: spot.place, stars, ghosts: run.ghosts, bird: run.birdSeen });
    saveScan(entry);
    addScore(stars * RULES.points.scan, 'scan');
    audio.cue('tlsLanded', stars);
    scanner.setDisplay(stars >= 3 ? ['DONE', ':)'] : ['DONE', run.ghosts ? 'BOO!' : ':)'], 'done');
    const n = todayCount();
    hud.result({
      title: `Scan ${Math.min(n, TLS.goal)} of ${TLS.goal}`,
      stars,
      line: run.ghosts === 0 ? (run.birdSeen ? 'Clean scan! (bar one ibis)' : 'Clean scan!') : run.ghosts === 1 ? 'One ghost to clean out' : `${run.ghosts} ghosts! The lab will laugh`,
      help: `+${stars * RULES.points.scan} points`,
    });
    step('scanned', { n, stars, ghosts: run.ghosts });
    M.step = 'reveal';
    run.stepT = 0;
    reveal.t = 0;
    reveal.hold = flag.stage === 'reveal' || flag.stage === 'ghost';
    reveal.from.copy(game.camera.position);
    reveal.yaw0 = clearYaw(game.rig ? game.rig.yaw : 0, 19, 0.8);
    player.hold('tls', true);
  }
  // Of a dozen yaws round the scanner (nearest the camera's first), one whose view down
  // onto it crosses no crown.
  function clearYaw(from, dist, pitch) {
    const R = caster.R, G = caster.ghost, Bd = caster.bird, g0 = G[0], b0 = Bd[0];
    G[0] = 0; Bd[0] = 0;
    let best = from;
    for (let k = 0; k < 12; k++) {
      const yaw = from + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (TAU / 12);
      const dx = Math.sin(yaw) * Math.cos(pitch), dy = Math.sin(pitch), dz = Math.cos(yaw) * Math.cos(pitch);
      R[0] = spot.x; R[1] = spot.y + 1.2; R[2] = spot.z; R[3] = dx; R[4] = dy; R[5] = dz; R[6] = dist;
      if (caster.probe(0) === 0) { best = yaw; break; }
    }
    G[0] = g0; Bd[0] = b0;
    return best;
  }

  // The camera's look over the landed cloud: eased out of the follow view up to an
  // oblique view over the scanner, a slow turn, and back. E skips it.
  const _look = new THREE.Vector3(), _pos = new THREE.Vector3(), _rigLook = new THREE.Vector3();
  function revealCamera() {
    reveal.t += NOW[1];
    const T = TLS.reveal;
    const cam = game.camera, rig = game.rig;
    const k = reveal.hold ? smooth(0, 0.9, reveal.t) : smooth(0, 0.9, reveal.t) * (1 - smooth(T - 0.9, T, reveal.t));
    // the scanner view: the island dims and the cloud shows through, then back
    cloud.setReveal(flag.stage === 'ghost' ? 0 : (reveal.hold ? 1 : smooth(0.2, 0.9, reveal.t) * (1 - smooth(T - 1.4, T - 0.3, reveal.t))));
    if (k <= 0 || !rig) return;
    if (flag.stage === 'ghost' && run.gh.length) {
      // (the ghost check image) from the scanner's side, looking at the ghost's face
      const g = run.gh[0];
      const gx = spot.x - g[0], gz = spot.z - g[1], gl = Math.hypot(gx, gz) || 1;
      const gy = caster.groundAt(g[0], g[1]);
      _look.set(g[0] + gz / gl * 0.45 * run.dir, gy + 0.85, g[1] - gx / gl * 0.45 * run.dir);
      _pos.set(g[0] + gx / gl * 3.4 - gz / gl * 1.1 * run.dir, gy + 1.8, g[1] + gz / gl * 3.4 + gx / gl * 1.1 * run.dir);
    } else {
      const yaw = reveal.yaw0 + 0.35 * Math.min(reveal.t, T) / T;
      const dist = 19, pitch = 0.8;
      _look.set(spot.x, spot.y + 1.2, spot.z);
      _pos.set(spot.x + Math.sin(yaw) * Math.cos(pitch) * dist, _look.y + Math.sin(pitch) * dist, spot.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    }
    _rigLook.copy(rig.target);
    cam.position.lerp(_pos, k);
    _rigLook.lerp(_look, k);
    cam.lookAt(_rigLook);
  }

  function packUp(scanned = true) {
    cloud.setReveal(0);
    M.step = 'packing';
    run.stepT = 0;
    audio.cue('tlsSetDown', false);
    if (game.fx && game.fx.burst) game.fx.burst('sparkle', spot.x, spot.y + 1.2, spot.z, 6);
    hud.show(false);
  }
  function packed() {
    scanner.group.visible = false;
    if (dyn) game.collision.setDynamic(dyn, 0, 0, 0);
    player.hold('tls', false);
    M.step = 'idle';
    scan = null;
    const cur = currentTool();
    if (cur === 'tls') player.avatar.setTool('tls', { pose: 'hold' });
    else if (cur == null && M.active) equip('tls', { silent: true });
    step('packed');
    // three in the bag: the mission is done (the registry scores it by the stars)
    if (M.active && todayCount() >= TLS.goal) {
      const stars = missionStars(today.scans.slice(-TLS.goal));
      M.active = false;
      showMarkers();
      events.emit('mission:done', { id: 'tls', stars });
    } else if (M.active) {
      const left = TLS.goal - todayCount();
      if (todayCount() > 0) kit.toast(`${left} more scan${left === 1 ? '' : 's'} to go: carry it to another coral marker`, { icon: 'tls', tone: 'good', ms: 3000 });
    }
    showMarkers();
    save();
  }

  function abortScan() {
    if (M.step === 'idle') return;
    cloud.setReveal(0);
    if (scan && scan.col < COLS) cloud.hide(scan.slot);
    if (kit.modalKind() === 'minigame' && M.step === 'level') kit.escape();
    scanner.group.visible = false;
    fan.update(0);
    bird.mesh.visible = false;
    run.birdOn = false;
    caster.ghost[0] = 0; caster.bird[0] = 0;
    if (dyn) game.collision.setDynamic(dyn, 0, 0, 0);
    player.hold('tls', false);
    hud.show(false);
    M.step = 'idle';
    scan = null;
    showMarkers();
  }

  // ---------------------------------------------------------------- the cover on the radar

  // The radar shows only the cover that hides someone creeping low (1.16 m tall) just
  // behind it: for each bush and trunk round the spot, the first free place straight
  // behind it as the scanner sees it, one the player can walk to from the scanner (a
  // flood fill over free ground), tested there and a step to either side with
  // hiddenAt(), the same test as the card's "Hidden!". Worked out once a spot (a few
  // hundred probe rays and a flood fill, 2 to 15 ms, spread over frames below).
  const COVER_MAX = 90;
  const cover = { list: new Float32Array(COVER_MAX * 4), n: 0 };
  const CROUCH_H = 1.58 - 0.42;
  const COVER_SIDES = [0, -0.12, 0.12]; // m either side of straight behind it
  // The work is done a little each frame while the mission is on (the spots nearest the
  // player first), so setting the scanner down never waits for it; a spot not yet worked
  // out when it is set down is finished there and then.
  const REACH = { cell: 0.25, n: Math.ceil((2 * (TLS.cover + 1.5)) / 0.25) };
  const reachGrid = new Uint8Array(REACH.n * REACH.n), reachQ = new Int32Array(REACH.n * REACH.n);
  // job: the spot being worked out; stage 1 the flood fill over free ground from beside
  // the scanner (reachGrid: 0 not looked at, 1 blocked, 2 reached), stage 2 the cover
  const job = { s: null, stage: 0, head: 0, tail: 0, x0: 0, z0: 0, cands: null, k: 0, out: null, ms: 0 };
  function freeCell(i, j) {
    const x = job.x0 + (i + 0.5) * REACH.cell, z = job.z0 + (j + 0.5) * REACH.cell;
    return game.collision.isFree(x, z) && game.data.terrain.isWalkable(x, z);
  }
  function reached(x, z) {
    const i = Math.floor((x - job.x0) / REACH.cell), j = Math.floor((z - job.z0) / REACH.cell), n = REACH.n;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const a = i + di, b = j + dj;
      if (a >= 0 && b >= 0 && a < n && b < n && reachGrid[b * n + a] === 2) return true;
    }
    return false;
  }
  function jobBegin(s) {
    const n = REACH.n, cell = REACH.cell;
    job.s = s; job.stage = 1; job.head = 0; job.tail = 0; job.ms = 0;
    job.x0 = s.x - (n * cell) / 2; job.z0 = s.z - (n * cell) / 2;
    reachGrid.fill(0);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU, i = Math.floor((s.x + Math.cos(a) * 1.5 - job.x0) / cell), j = Math.floor((s.z + Math.sin(a) * 1.5 - job.z0) / cell);
      const c = j * n + i;
      if (reachGrid[c] || !freeCell(i, j)) continue;
      reachGrid[c] = 2; reachQ[job.tail++] = c;
    }
    // the candidates: bushes whose top stands 0.6 m over the ground, trunks 0.12 m round
    const H = (game.veg && game.veg.hosts) || {};
    job.cands = [];
    for (const m of H.mounds || []) {
      if (Math.hypot(m.x - s.x, m.z - s.z) - m.r > TLS.cover) continue;
      if (m.y + m.h - caster.groundAt(m.x, m.z) > 0.6) job.cands.push([m.x, m.z, m.r, 1, m.r * 0.9]);
    }
    for (const t of H.trunks || []) {
      const r = (t.r0 + t.r1) / 2;
      if (r >= 0.12 && Math.hypot(t.x - s.x, t.z - s.z) - r <= TLS.cover) job.cands.push([t.x, t.z, r, 0, r]);
    }
    job.k = 0; job.out = [];
  }
  // works on the job for up to budget ms; true once the spot's cover is known
  function jobStep(budget) {
    const t0 = performance.now(), n = REACH.n, s = job.s;
    let steps = 0;
    if (job.stage === 1) {
      while (job.head < job.tail) {
        if ((++steps & 63) === 0 && performance.now() - t0 > budget) { job.ms += performance.now() - t0; return false; }
        const c = reachQ[job.head++], i = c % n, j = (c - i) / n;
        for (let k = 0; k < 4; k++) {
          const a = i + (k === 0 ? 1 : k === 1 ? -1 : 0), b = j + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (a < 0 || b < 0 || a >= n || b >= n) continue;
          const q = b * n + a;
          if (reachGrid[q]) continue;
          if (!freeCell(a, b)) { reachGrid[q] = 1; continue; }
          reachGrid[q] = 2; reachQ[job.tail++] = q;
        }
      }
      job.stage = 2;
    }
    const col = game.collision, terr = game.data.terrain;
    while (job.k < job.cands.length && job.out.length < COVER_MAX) {
      if (performance.now() - t0 > budget) { job.ms += performance.now() - t0; return false; }
      const [x, z, r, kind, drawR] = job.cands[job.k++];
      const dx = x - s.x, dz = z - s.z, d = Math.hypot(dx, dz);
      if (d < 0.8) continue;
      const ux = dx / d, uz = dz / d;
      // the first free place behind it (a player's circle, from its middle outwards)
      let at = -1;
      for (let e = r * 0.6 + 0.3; e <= r + 1.3; e += 0.12) {
        const hx = x + ux * e, hz = z + uz * e;
        if (col.isFree(hx, hz) && terr.isWalkable(hx, hz)) { at = e; break; }
      }
      if (at < 0) continue;
      const hx = x + ux * at, hz = z + uz * at;
      if (!reached(hx, hz)) continue;
      let ok = true;
      for (const side of COVER_SIDES) {
        const sx = hx - uz * side, sz = hz + ux * side;
        if (!hiddenAt(sx, sz, caster.groundAt(sx, sz), CROUCH_H, s)) { ok = false; break; }
      }
      if (ok) job.out.push([x, z, drawR, kind]);
    }
    job.ms += performance.now() - t0;
    s.cover = job.out;
    s.coverMs = +job.ms.toFixed(1);
    job.s = null; job.stage = 0; job.cands = null;
    return true;
  }
  function coverFor(s) {
    if (s.cover) return s.cover;
    if (job.s !== s) jobBegin(s);
    jobStep(Infinity);
    return s.cover;
  }
  // a millisecond a frame while the mission is on: the spots still to do, nearest first
  function coverWork() {
    if (!job.s) {
      let best = null, bd = Infinity;
      for (const s of spots) {
        if (s.cover) continue;
        const d = Math.hypot(s.x - player.position.x, s.z - player.position.z);
        if (d < bd) { bd = d; best = s; }
      }
      if (!best) return;
      jobBegin(best);
    }
    jobStep(1);
  }
  function collectCover() {
    const list = coverFor(spot);
    cover.n = 0;
    for (const [x, z, r, kind] of list) {
      const o = cover.n++ * 4;
      cover.list[o] = x; cover.list[o + 1] = z; cover.list[o + 2] = r; cover.list[o + 3] = kind;
    }
    hud.cover({ cover: cover.list, n: cover.n, sx: spot.x, sz: spot.z });
  }
  const radar = { yaw: 0, sx: 0, sz: 0, theta0: 0, dir: 1, sweep: 0, az: 0, px: 0, pz: 0, state: 'open', t: 0 };

  const hudState = { title: '', pct: 0, stars: 3, status: '', tone: '', help: '', danger: false };
  const HUD_HELP = '[Ctrl] creep behind the radar\'s cover. The red line is the laser';
  const scanTitle = () => `Scan ${Math.min(todayCount() + 1, TLS.goal)} of ${TLS.goal}`;
  function hudFrame() {
    const t = NOW[0];
    if (M.step === 'countdown') return;
    const st = run.state;
    const close = run.ahead < 1.2;
    const text = st === 'seen' ? 'Seen! A ghost of you in the scan'
      : st === 'scanning' ? 'Scanning you...'
        : st === 'safe' ? 'Safe: that side\'s already scanned'
          : st === 'hidden' ? (close || run.passOn ? 'Hidden! Stay put...' : 'Hidden')
            : st === 'behind' ? 'Behind the head: keep pace with it!'
              : close ? 'It\'s coming! Hide!' : 'In the open: find cover';
    const tone = st === 'seen' ? 'bad' : st === 'open' || st === 'scanning' ? 'warn' : st === 'safe' || st === 'behind' ? 'calm' : '';
    run.hint = text;
    if (!hudState.title) hudState.title = scanTitle();
    hudState.pct = run.sweep; hudState.stars = run.stars; hudState.status = text; hudState.tone = tone;
    hudState.help = HUD_HELP; hudState.danger = (st === 'open' && close) || st === 'scanning';
    hud.scan(hudState);
    radarNow(run.sweep, run.az, t);
  }
  function radarNow(sweep, az, t) {
    radar.yaw = game.rig ? game.rig.yaw : 0;
    radar.sx = spot.x; radar.sz = spot.z; radar.theta0 = run.theta0; radar.dir = run.dir;
    radar.sweep = sweep; radar.az = az; radar.px = player.position.x; radar.pz = player.position.z;
    radar.state = M.step === 'countdown' ? 'open' : run.state; radar.t = t;
    hud.radar(radar);
  }

  // ---------------------------------------------------------------- the per-frame update

  // While the level card is up (docked on the right), the camera turns a little so the
  // scanner stands beside the player rather than behind them, and slides right so the two
  // sit left of the card; as the countdown starts it slides back and turns back to where
  // the player had it (unless they turn it themselves meanwhile).
  const frame = { k: 0, yaw: null, yaw0: 0, back: false, user: false };
  function frameScanner(dt) {
    const on = M.step === 'placing' || M.step === 'level';
    frame.k += ((on ? 1 : 0) - frame.k) * Math.min(1, dt * (on ? 2.2 : 3.5));
    const rig = game.rig;
    if (!rig || !rig.enabled || !spot) return;
    const turned = game.input.look.x !== 0;
    if (on && turned) { frame.user = true; frame.back = false; } // (their camera: left alone)
    if (on && !frame.user) {
      if (frame.yaw == null) { frame.yaw = azimuthOf(spot.x - stand.x, spot.z - stand.z) - 0.55; frame.back = true; }
      let d = frame.yaw - rig.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      rig.yaw += d * Math.min(1, dt * 2.5);
    } else if (!on && frame.back) {
      let d = frame.yaw0 - rig.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (turned || Math.abs(d) < 0.005 || M.step !== 'countdown') frame.back = false;
      else rig.yaw += d * Math.min(1, dt * 3.5);
    }
    if (frame.k < 0.004) return;
    const s = 0.85 * frame.k, cam = game.camera;
    cam.position.x += Math.cos(rig.yaw) * s;
    cam.position.z -= Math.sin(rig.yaw) * s;
  }

  // The caster's first rays of a session run slowly (the engine has not optimised them
  // yet), so a few thousand throwaway ones are cast from the spot while the level card is
  // up, a little each frame, before the first scan needs them. Its random stream is kept.
  const warm = { left: 6000, k: 0 };
  function warmCaster() {
    const t0 = performance.now();
    const S = caster.S, R = caster.R, G = caster.ghost, Bd = caster.bird;
    const rs = S[0], g0 = G[0], b0 = Bd[0];
    G[0] = 0; Bd[0] = 0;
    const oy = spot.y + LASER_Y;
    while (warm.left > 0 && performance.now() - t0 < 0.7) {
      for (let j = 0; j < 40; j++) {
        warm.k++;
        const az = warm.k * 2.39996, e = cloud.rowSin[(warm.k * 7) % cloud.ROWS], ce = cloud.rowCos[(warm.k * 7) % cloud.ROWS];
        R[0] = spot.x; R[1] = oy; R[2] = spot.z; R[3] = -Math.sin(az) * ce; R[4] = e; R[5] = -Math.cos(az) * ce; R[6] = RANGE;
        caster.cast();
      }
      warm.left -= 40;
    }
    S[0] = rs; G[0] = g0; Bd[0] = b0;
  }

  const prime = { n: topView ? 0 : 2, on: false };
  function primeParts() {
    if (prime.n > 0 && M.step === 'idle') {
      prime.n--;
      prime.on = true;
      const cam = game.camera;
      cam.getWorldDirection(_v).multiplyScalar(4).add(cam.position);
      scanner.group.position.copy(_v); scanner.group.scale.setScalar(0.01); scanner.group.visible = true;
      bird.mesh.position.copy(_v); bird.mesh.visible = true;
      fan.mesh.visible = true; // (uOn 0: nothing shows)
      cloud.dim.visible = true; // (uDim 0)
    } else if (prime.on) {
      prime.on = false; prime.n = 0;
      scanner.group.visible = false; bird.mesh.visible = false; fan.mesh.visible = false; cloud.dim.visible = false;
    }
  }

  let clockHeld = false;
  function update(dt, t) {
    NOW[0] = t; NOW[1] = dt;
    // the day's clock waits while the scanner is set down (the level card, the countdown,
    // the scan and its reveal, packing up): a scan is a mini-game, as the drone's flight
    // and the rover's cards are; the walks between the spots take time
    const held = M.step !== 'idle';
    if (held !== clockHeld) { clockHeld = held; holdClock('tls', held); }
    cloud.update(game.camera, game.renderer);
    frameScanner(dt);
    if (warm.left > 0 && spot && (M.step === 'level' || M.step === 'countdown')) warmCaster();
    if (M.active && M.step === 'idle' && !topView) coverWork();
    // the carried scanner: in hand while it is the tool shown and not set down; the
    // tripod on the pack while the mission is on
    const av = player.avatar;
    const inHand = !!(av && av.tool && av.tool.shown === 'tls') && M.step === 'idle' && state.phase !== 'title';
    carried.hand.visible = inHand;
    carried.back.visible = (M.active || inHand) && M.step === 'idle';
    if (inHand && B && B.holdGps) carried.hand.rotation.copy(B.holdGps.rotation);

    flagUpdate();
    const paused = kit.busy() && M.step !== 'level';
    if (paused && (M.step === 'countdown' || M.step === 'scan')) { renderViews(); return; }

    switch (M.step) {
      case 'placing': {
        run.stepT += dt;
        const k = Math.min(1, run.stepT / 0.45);
        const pop = k < 0.7 ? smooth(0, 0.7, k) * 1.12 : 1.12 - 0.12 * smooth(0.7, 1, k);
        scanner.group.scale.setScalar(Math.max(0.01, pop));
        // step back from it, facing it
        const p = player.position;
        p.x += (stand.x - p.x) * Math.min(1, dt * 9);
        p.z += (stand.z - p.z) * Math.min(1, dt * 9);
        p.y = game.collision.supportHeight(p.x, p.z);
        player.heading = azimuthOf(spot.x - p.x, spot.z - p.z);
        player.object.position.copy(p);
        player.object.rotation.y = player.heading;
        if (run.stepT > 0.55) { scanner.group.scale.setScalar(1); level(); }
        break;
      }
      case 'countdown': {
        if (flag.holdCount && run.stepT > 1.3) { lookAtScanner(); run.stepT = 1.3; dt = 0; }
        run.stepT += dt;
        const left = Math.ceil(TLS.countdown - run.stepT);
        // the head turns to where it starts
        const k = smooth(0, TLS.countdown * 0.8, run.stepT);
        let d = run.theta0 - run.headFrom;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        scanner.head.rotation.y = run.headFrom + d * k;
        if (left !== run.lastCd && left > 0) {
          run.lastCd = left;
          audio.cue('tlsCount', false);
          scanner.setDisplay([String(left)], 'warn');
          hud.count(left, hudState.title, 'It turns once: hide behind the radar\'s cover, or keep behind its head');
          run.hint = 'Get ready to hide!';
        }
        run.motorT -= dt;
        if (run.motorT <= 0) { run.motorT = 0.85; audio.cue('tlsMotor', 0.9, 0.85, spot.x, spot.z); }
        scanner.update(6 * k);
        // the radar already shows where the fan will start
        run.hudT -= dt;
        if (run.hudT <= 0) { run.hudT = 0.1; radarNow(0, run.theta0, t); }
        if (run.stepT >= TLS.countdown) { audio.cue('tlsCount', true); beginScan(); }
        break;
      }
      case 'scan': {
        scanFrame();
        if (run.birdPlanned && !run.birdOn && !run.birdSeen && run.sweep >= run.birdAt && run.birdT === 0) birdStart();
        birdFrame();
        scanner.update(34);
        if (M.step === 'scan') fan.update(1);
        run.hudT -= dt;
        if (run.hudT <= 0 && M.step === 'scan') { run.hudT = 0.1; hudFrame(); }
        if (flag.freeze && flag.stage === 'scan' && run.sweep >= flag.freezeAt) holdForShot();
        break;
      }
      case 'reveal': {
        run.stepT += dt;
        birdFrame();
        scanner.update(Math.max(0, 34 - run.stepT * 30));
        revealCamera();
        const skip = run.stepT > 0.8 && game.input.pressed('use') && !kit.busy();
        if (!reveal.hold && (run.stepT >= TLS.reveal || skip)) {
          if (skip) reveal.t = TLS.reveal;
          packUp(true);
        }
        break;
      }
      case 'packing': {
        run.stepT += dt;
        const k = Math.min(1, run.stepT / TLS.pack);
        scanner.group.scale.setScalar(Math.max(0.01, 1 + 0.12 * Math.sin(k * Math.PI) - smooth(0.35, 1, k)));
        if (k >= 1) packed();
        break;
      }
      default:
        break;
    }
    if (M.step !== 'scan' && M.step !== 'reveal' && fan.mesh.visible) fan.update(0);
    if (prime.n > 0 || prime.on) primeParts();
    renderViews();
    if (rebuild) rebuildFrame();
  }

  // the notebook's 3D view, while its page is open
  function renderViews() {
    const v = cloud.view;
    if (v && v.attached) v.render(NOW[1]);
  }

  // ---------------------------------------------------------------- the notebook page

  function notebook() {
    const r = rec();
    const d = r.data || {};
    return {
      title: 'Laser scans',
      blurb: 'The scanner spins its laser round and back comes a cloud of 3D points: beige for the ground, green by height for the plants. Anyone it sees ends up in it!',
      stamps: [
        { label: 'Scanned!', done: r.done > 0, icon: 'tls', tone: 'blue' },
        { label: 'Clean scan', done: (d.clean || 0) > 0, icon: 'star', tone: 'gold' },
        { label: 'Ghost!', done: (d.ghosts || 0) > 0, icon: 'eye', tone: 'red' },
        { label: 'Birdie', done: (d.birds || 0) > 0, icon: 'heart', tone: 'green' },
      ],
      count: Array.isArray(d.scans) ? d.scans.length : 0,
      render: (el) => renderPage(el),
    };
  }
  function renderPage(el) {
    const d = rec().data || {};
    const scans = Array.isArray(d.scans) ? d.scans : [];
    const { view } = renderNotebook(el, { scans, surveyed, total: d.total || scans.length, clean: d.clean || 0, ghosts: d.ghosts || 0, birds: d.birds || 0, points: cloud.stats.points, hasPoints: cloud.stats.points > 0 });
    if (!(cloud.stats.points > 0) || !view) return () => {};
    // the one view, made the first time, moved into this page (it stops drawing when the
    // page goes)
    const v = cloud.bookView();
    v.attach(view, { still: flag.stage === 'notebook' });
    v.render(0);
    return () => {};
  }

  // ---------------------------------------------------------------- the cloud after a reload

  // A saved season's scans come back: each is cast again (a few columns a frame, in the
  // background, for the notebook only) from its spot, seed and start, with its ghosts and
  // forgiven bits of hat where they were and the ibis on its flight, so it is the scan the
  // player saw (a scan keeps its own random stream, tls_cloud.js).
  let rebuild = null;
  const replayBird = new Float64Array(8);
  function queueRebuild() {
    const d = rec().data || {};
    const list = (Array.isArray(d.scans) ? d.scans : []).filter((s) => spots.some((p) => p.n === s.n));
    const seen = new Set(), keep = [];
    for (let i = list.length - 1; i >= 0; i--) if (!seen.has(list[i].n)) { seen.add(list[i].n); keep.unshift(list[i]); }
    rebuild = keep.length ? { list: keep, i: 0, scan: null } : null;
  }
  function rebuildFrame() {
    const budgetMs = 1.2;
    if (!rebuild || M.step === 'scan') return;
    const t0 = performance.now();
    while (performance.now() - t0 < budgetMs) {
      if (!rebuild.scan) {
        const e = rebuild.list[rebuild.i];
        if (!e) { rebuild = null; return; }
        const s = spots.find((p) => p.n === e.n);
        rebuild.scan = cloud.begin(cloud.freeSlot(), { x: s.x, y: s.y + LASER_Y, z: s.z, theta0: e.theta0 || 0, dir: e.dir || 1, spot: s.n, seed: e.seed || s.n, linger: 0, quiet: true });
        rebuild.gh = (Array.isArray(e.gh) ? e.gh : []).concat(Array.isArray(e.hat) ? e.hat : []);
        rebuild.s = s;
        replayBird.fill(0);
        if (Array.isArray(e.bp) && e.bp.length === 8) for (let k = 0; k < 8; k++) replayBird[k] = Number(e.bp[k]) || 0;
      }
      const sc = rebuild.scan;
      const G = caster.ghost;
      G[0] = 0;
      // a saved ghost stands where it was, for the columns that face it
      const az = sc.theta0 + sc.dir * (sc.col / COLS) * TAU;
      for (const g of rebuild.gh) {
        const ga = azimuthOf(g[0] - rebuild.s.x, g[1] - rebuild.s.z);
        if (Math.abs(Math.atan2(Math.sin(ga - az), Math.cos(ga - az))) < 0.3) {
          const gx = rebuild.s.x - g[0], gz = rebuild.s.z - g[1], gl = Math.hypot(gx, gz) || 1;
          G[0] = 1; G[1] = g[0]; G[2] = g[1]; G[3] = caster.groundAt(g[0], g[1]); G[4] = g[2] || 1.58; G[5] = 0.3; G[6] = gx / gl; G[7] = gz / gl; G[8] = 0;
        }
      }
      cloud.now[0] = -100;
      birdAtColumn(replayBird, sc.col);
      cloud.column(sc, sc.col);
      if (sc.col >= COLS) {
        cloud.finish(sc, -100, 0);
        rebuild.scan = null;
        rebuild.i++;
      }
    }
    if (rebuild && rebuild.scan) cloud.flush(rebuild.scan);
    caster.ghost[0] = 0; caster.bird[0] = 0;
  }
  events.on('phase:change', (e) => {
    if (e && (e.phase === 'survey' || e.phase === 'setup') && !FLAG_ON && cloud.stats.points === 0 && !rebuild) queueRebuild();
  });

  // ---------------------------------------------------------------- flags and scripted runs

  function rand01(n) {
    let h = Math.imul((n | 0) ^ 0x5bd1e995, 2654435761);
    h ^= h >>> 13; h = Math.imul(h, 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // Stands the player by spot n, a couple of metres off on free ground, facing it.
  function goTo(n, dist = 2.2, aroundDeg = null) {
    const s = spots.find((p) => p.n === n) || spots[0];
    let at = null;
    for (let k = 0; k < 24 && !at; k++) {
      const a = (aroundDeg != null ? aroundDeg * Math.PI / 180 : 0.6) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (TAU / 24);
      const x = s.x + Math.cos(a) * dist, z = s.z + Math.sin(a) * dist;
      if (game.collision.isFree(x, z) && game.data.terrain.isWalkable(x, z)) at = { x, z };
    }
    if (!at) at = { x: s.x + dist, z: s.z };
    player.teleport(at.x, at.z, azimuthOf(s.x - at.x, s.z - at.z));
    if (game.rig) { game.rig.yaw = player.heading; game.rig.snap(); }
    return s;
  }

  // A whole scan at once (no fan, no waiting): for scripted runs and the notebook check.
  function quickScan(n, opts = {}) {
    const s = spots.find((p) => p.n === n);
    if (!s || M.step !== 'idle') return null;
    spot = s;
    const idx = todayCount();
    run.theta0 = +(opts.theta0 ?? rand01(n * 7) * TAU).toFixed(4);
    run.dir = idx % 2 ? -1 : 1;
    const slot = cloud.freeSlot();
    for (const sl of cloud.slots) if (sl.used && !sl.hidden && sl.spot === s.n && sl.i !== slot) cloud.hide(sl.i);
    const sc = cloud.begin(slot, { x: s.x, y: s.y + LASER_Y, z: s.z, theta0: run.theta0, dir: run.dir, spot: s.n, seed: s.n * 1009 + idx, linger: opts.linger ?? 0 });
    const gh = [];
    if (opts.ghost) {
      // someone standing in the open 3 m out, a little to one side
      const a = run.theta0 + run.dir * 0.3 * TAU;
      const gx = +(s.x - Math.sin(a) * 3).toFixed(2), gz = +(s.z - Math.cos(a) * 3).toFixed(2);
      const G = caster.ghost, fx = s.x - gx, fz = s.z - gz, fl = Math.hypot(fx, fz);
      G[0] = 1; G[1] = gx; G[2] = gz; G[3] = caster.groundAt(gx, gz); G[4] = 1.58; G[5] = 0.3; G[6] = fx / fl; G[7] = fz / fl; G[8] = 0;
      gh.push([+gx.toFixed(2), +gz.toFixed(2), 1.58]);
    }
    // (a bird hovering 7 m out over the whole scan: a "flight" from there to there)
    const bp = new Float64Array(8);
    if (opts.bird) {
      const a = run.theta0 + run.dir * 0.6 * TAU;
      const bx = +(s.x - Math.sin(a) * 7).toFixed(2), bz = +(s.z - Math.cos(a) * 7).toFixed(2), by = +(caster.groundAt(bx, bz) + 4).toFixed(2);
      bp[0] = bp[3] = bx; bp[1] = bp[4] = by; bp[2] = bp[5] = bz; bp[6] = 0; bp[7] = COLS;
    }
    cloud.now[0] = game.time - 50;
    for (let c = 0; c < COLS; c++) {
      birdAtColumn(bp, c);
      cloud.column(sc, c);
    }
    caster.ghost[0] = 0; caster.bird[0] = 0;
    cloud.finish(sc, game.time - (opts.linger === 1e6 ? 0 : 50), opts.linger ?? 0);
    const ghosts = opts.ghost && sc.ghostHits >= TLS.ghostMin ? 1 : 0;
    const stars = Math.max(1, 3 - ghosts);
    const bird = !!(opts.bird && sc.birdHits > 0);
    today.scans.push({ n: s.n, place: s.place, stars, ghosts, bird });
    const entry = { n: s.n, place: s.place, stars, ghosts, bird, seed: s.n * 1009 + idx, theta0: +run.theta0.toFixed(4), dir: run.dir, gh };
    if (opts.bird) entry.bp = Array.from(bp);
    saveScan(entry);
    step('scanned', { n: todayCount(), stars, ghosts });
    if (M.active && todayCount() >= TLS.goal) {
      M.active = false;
      showMarkers();
      events.emit('mission:done', { id: 'tls', stars: missionStars(today.scans.slice(-TLS.goal)) });
    }
    showMarkers();
    return { points: sc.n, ms: Math.round(sc.ms), ghostHits: sc.ghostHits, birdHits: sc.birdHits, stars };
  }

  // Holds the scene for a screenshot: the scan stops mid-sweep, the player stands in the
  // swept part where the camera sees the fan side on and the cloud behind it.
  // (the countdown check image) a close look at the scanner on its tripod, the player
  // beside it
  function lookAtScanner() {
    if (flag.looked) return;
    flag.looked = true;
    // its display faces (sin h, cos h): the player a little round from there, the camera
    // behind them on the display's side
    const h = scanner.head.rotation.y, a = h + 0.8;
    const x = spot.x + Math.sin(a) * 1.25, z = spot.z + Math.cos(a) * 1.25;
    if (game.collision.isFree(x, z)) player.teleport(x, z, azimuthOf(spot.x - x, spot.z - z));
    if (game.rig) {
      game.rig.yaw = h + 0.3;
      game.rig.pitch = 0.3;
      game.rig.distance = 3.6;
      game.rig._userPitch = true;
      game.rig.snap();
    }
  }

  function holdForShot() {
    if (flag.held) return;
    flag.held = true;
    run.turn = 1e9; // the fan stays where it is
    // stand ahead of the fan (it is held, so it never gets there), the camera behind,
    // looking back over the scanner at the cloud so far with the fan side on; of a few
    // such places, the first where the camera is clear of the crowns
    const R = caster.R, G = caster.ghost, g0 = G[0];
    G[0] = 0;
    let pick = null;
    const pitch = 0.5, dist = 10;
    for (let k = 0; k < 26 && !(pick && pick.good); k++) {
      const f = 0.45 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.05 * (k > 13 ? 1 : 1);
      const d = k > 13 ? 5 : 3.4;
      const a = run.az + run.dir * f * Math.PI;
      const x = spot.x - Math.sin(a) * d, z = spot.z - Math.cos(a) * d;
      if (!game.collision.isFree(x, z)) continue;
      // where the follow camera will be: behind the player, looking at the scanner
      const yaw = azimuthOf(spot.x - x, spot.z - z) + run.dir * 0.12;
      const ty = caster.groundAt(x, z) + 1.25;
      const cx = x + Math.sin(yaw) * Math.cos(pitch) * dist, cz = z + Math.cos(yaw) * Math.cos(pitch) * dist, cy = ty + Math.sin(pitch) * dist;
      if (!pick) pick = { x, z, yaw };
      if (caster.near(cx, cy, cz, 2.5)) continue;
      // the view from there to the player and to the scanner's head crosses no leaves
      let clear = true;
      for (const [px, py, pz] of [[x, ty, z], [spot.x, spot.y + 1.4, spot.z], [(x + spot.x) / 2, ty + 1, (z + spot.z) / 2]]) {
        const dx = px - cx, dy = py - cy, dz = pz - cz, dl = Math.hypot(dx, dy, dz);
        R[0] = cx; R[1] = cy; R[2] = cz; R[3] = dx / dl; R[4] = dy / dl; R[5] = dz / dl; R[6] = dl - 0.5;
        if (caster.probe(0) === KIND.VEG) { clear = false; break; }
      }
      if (clear) pick = { x, z, yaw, good: true };
    }
    G[0] = g0;
    if (!pick) return;
    player.teleport(pick.x, pick.z, azimuthOf(spot.x - pick.x, spot.z - pick.z));
    if (game.rig) {
      game.rig.yaw = pick.yaw;
      game.rig.pitch = pitch;
      game.rig.distance = dist;
      game.rig._userPitch = true;
      game.rig.snap();
    }
  }

  function flagUpdate() {
    const dt = NOW[1];
    if (flag.autoHide && M.step === 'scan') {
      // (scripted runs, play.tls.autoHide) keep round behind the head, 1.6 m out, as a player would
      const a = run.az + Math.PI;
      const x = spot.x - Math.sin(a) * 1.6, z = spot.z - Math.cos(a) * 1.6;
      const p = player.position;
      p.x += (x - p.x) * Math.min(1, dt * 4); p.z += (z - p.z) * Math.min(1, dt * 4);
      game.collision.resolve(p);
      p.y = game.collision.supportHeight(p.x, p.z);
      player.heading = azimuthOf(spot.x - p.x, spot.z - p.z);
    }
    if (flag.done) return;
    if (flag.stage === 'wait') {
      if (state.phase !== 'survey' || !state.clock.running || kit.busy()) return;
      flag.t += dt;
      if (flag.t < 0.7) return;
      start({ from: 'flag', debug: true });
      const s = goTo(FLAG_SPOT, STEP === 'walk' ? 1.6 : 2.2);
      flag.stage = STEP;
      if (STEP === 'walk') { flag.done = true; return; }
      if (STEP === 'level') { flag.hold = true; setUp(s); flag.done = true; return; }
      if (STEP === 'done' || STEP === 'notebook') {
        const plan = STEP === 'notebook' ? [[1, {}], [4, { ghost: true }], [2, { bird: true }]] : [[1, {}], [4, {}], [3, {}]];
        const nums = plan.map(([n]) => Math.min(spots.length, n));
        nums.forEach((n, i) => quickScan(n, plan[i][1]));
        if (STEP === 'notebook') {
          flag.stage = 'notebook';
          setTimeout(() => kit.openPanel('notebook', 'kit:tls'), 400);
        }
        flag.done = true;
        return;
      }
      if (STEP === 'scan') { flag.freeze = true; flag.freezeAt = 0.62; flag.noGhost = true; flag.bird = false; flag.hold = true; flag.fast = 0.55; }
      if (STEP === 'reveal') { flag.noGhost = true; flag.hold = true; flag.fast = 0.4; flag.bird = true; }
      if (STEP === 'ghost') { flag.hold = true; flag.fast = 0.5; flag.bird = false; }
      if (STEP === 'auto') { flag.autoHide = true; game.play.auto = true; }
      if (STEP === 'countdown') { flag.holdCount = true; }
      game.play.auto = true;
      setUp(s);
      return;
    }
    if (flag.stage === 'ghost' && M.step === 'scan') {
      // stand in the open, 3 m out where the fan comes a quarter of a turn in; once it
      // has seen you, step aside so the ghost shows
      if (!flag.placed) {
        flag.placed = true;
        // an open spot a quarter turn in: free ground, in plain view of the window
        const R = caster.R, G = caster.ghost, g0 = G[0];
        G[0] = 0;
        let at = null;
        for (const f of [0.22, 0.18, 0.26, 0.3, 0.14, 0.34, 0.4]) {
          for (const d of [3.2, 3.8, 2.6]) {
            const a = run.theta0 + run.dir * f * TAU;
            const x = spot.x - Math.sin(a) * d, z = spot.z - Math.cos(a) * d;
            if (!game.collision.isFree(x, z, 0.5) || !game.data.terrain.isWalkable(x, z)) continue;
            const ty = caster.groundAt(x, z) + 1.0, oy = spot.y + LASER_Y;
            const dx = x - spot.x, dy = ty - oy, dz = z - spot.z, dl = Math.hypot(dx, dy, dz);
            R[0] = spot.x; R[1] = oy; R[2] = spot.z; R[3] = dx / dl; R[4] = dy / dl; R[5] = dz / dl; R[6] = dl + 3;
            if (caster.probe(0) !== 0 && R[7] < dl + 0.4) continue;
            at = { x, z };
            break;
          }
          if (at) break;
        }
        G[0] = g0;
        if (!at) { const a = run.theta0 + run.dir * 0.22 * TAU; at = { x: spot.x - Math.sin(a) * 3, z: spot.z - Math.cos(a) * 3 }; }
        player.teleport(at.x, at.z, azimuthOf(spot.x - at.x, spot.z - at.z));
        flag.ghostAt = at;
        if (game.rig) { game.rig.yaw = player.heading + run.dir * 0.9; game.rig.pitch = 0.45; game.rig.distance = 7; game.rig._userPitch = true; game.rig.snap(); }
      }
      if (run.ghosts > 0 && !flag.stepped && run.sweep > 0.3) {
        // step aside (back into the part already scanned) and look at your ghost
        flag.stepped = true;
        const g = run.gh[0];
        const gx = spot.x - g[0], gz = spot.z - g[1], gl = Math.hypot(gx, gz) || 1;
        const sx = -gz / gl * run.dir, sz = gx / gl * run.dir;
        let x = g[0] - sx * 1.25 + gx / gl * 0.5, z = g[1] - sz * 1.25 + gz / gl * 0.5;
        if (!game.collision.isFree(x, z)) { x = g[0] + sx * 1.25 + gx / gl * 0.5; z = g[1] + sz * 1.25 + gz / gl * 0.5; }
        player.teleport(x, z, azimuthOf(g[0] - x, g[1] - z));
      }
    }
    if (flag.stage === 'auto' && M.step === 'idle' && M.active && todayCount() < TLS.goal) {
      const next = spots.find((s) => !doneToday(s.n));
      if (next) { goTo(next.n); setUp(next); }
    }
  }

  function holdStage() { return flag.stage; }

  game.play = Object.assign(game.play || {}, {
    tls: {
      spots: () => spots.map((s) => ({ n: s.n, place: s.place, done: doneToday(s.n) })),
      goTo: (n, d = 1.5) => goTo(n, d),
      setUp: (n) => { const s = spots.find((p) => p.n === n) || spots[0]; goTo(s.n); setUp(s); return M.step; },
      quick: (n, opts) => quickScan(n, opts),
      autoHide: (on = true) => { flag.autoHide = !!on; },
      state: () => ({ step: M.step, active: M.active, today: today.scans.slice(), sweep: +run.sweep.toFixed(3), stars: run.stars, ghosts: run.ghosts, seen: run.state, points: cloud.stats.points, stage: holdStage() }),
      stats: () => ({ ...cloud.stats, caster: { ...caster.stats } }),
    },
  });

  kit.registerMinigame('tls-level', () => levelMinigame({ difficulty: 0.3 }));

  const sys = {
    id: 'tls', title: 'Laser scans', tool: 'tls',
    group,
    get active() { return M.active; },
    set active(v) { M.active = !!v; },
    get step() { return M.step; },
    // mid-job (set down, levelling, scanning, packing): another mission waits (the registry's busyOther)
    get busy() { return M.step !== 'idle'; },
    available, start, stop, progress, notebook, update,
    // for the maps: the mission's spots, today's scanned ones done
    mapMarks: () => (M.active ? spots.map((s) => ({ x: s.x, z: s.z, done: doneToday(s.n), n: s.n, colour: TLS.mark })) : []),
    cloud, caster,
    get stats() {
      let calls = cloud.stats.drawCalls;
      if (scanner.group.visible) calls += 4;
      if (fan.mesh.visible) calls += 1;
      if (bird.mesh.visible) calls += 1;
      if (carried.hand.visible) calls += 2;
      if (carried.back.visible) calls += 1;
      // (the cloud's count has its reveal dimming in it)
      return {
        step: M.step, active: M.active, scansToday: todayCount(), points: cloud.stats.points,
        lastScanPoints: cloud.stats.lastScanPoints, lastScanMs: cloud.stats.lastScanMs, lastKinds: cloud.stats.lastKinds || null,
        primitives: caster.stats.primitives, rays: caster.stats.rays, drawCalls: topView ? 0 : calls, buildMs,
        rebuilding: !!rebuild,
      };
    },
  };
  const buildMs = Math.round(performance.now() - t0);
  // (for memory checks: the parts of a scan's frame one by one)
  sys._parts = { hud, radar, fan, scanner, bird, exposure, hiddenAt, coverFor, hudFrame, cloud, NOW, run, spots };
  registerMission(sys);
  if (!FLAG_ON) queueRebuild();
  return sys;
}
