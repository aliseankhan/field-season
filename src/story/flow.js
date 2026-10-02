// The story, as one optional system (game.story): title -> intro (James at the field
// station the ibises raided overnight; your name and looks) -> the opening, the same
// morning (find the five pieces of kit scattered round the island, the last one in an
// ibis's bill; set the table upright; tie a fresh floss loop; a practice catch on a
// calm crested anole in the open) -> survey day, straight away at 07:30 (the clock runs
// to 18:30) -> summary -> title. The grid flags and the temperature loggers stand on
// the island from the start. It builds James, the station kit, the kit hunt and the
// tasks, owns the day's clock, and the cutscene camera.
//
//   game.story.start(), .continue(), .skip()  the title's three buttons
//   game.story.toTitle({ save }), .endDay()   back to the title (save: false after
//                                             "Reset save"), end the survey day now
//   game.story.cutscene                        true while the story holds the camera
//   game.story.step                            the opening's step: hunt, ibis, station,
//                                             floss, practice (null otherwise)
//   game.story.hunt                            the kit hunt (src/story/kit_hunt.js)
//   game.story.notebookFound                   false until the notebook has been found
//   game.story.wrapLens                        the wrap-up camera's tries (checks)
//   game.play                                  helpers for scripted tests (see below)
//
// URL flags: ?phase=title|intro|hunt|practice|survey|summary (setup is kept as hunt),
// ?huntstep=loop_pole|notebook|bags|scales|ibis|station|floss|practice (where in the opening
// to start: everything before it done), ?name=, ?skipsetup=1 (skip the opening, after
// the intro), ?clock=hh.mm, ?fast=n, ?tool=loop_pole|flags|loggers|backpacks|tape|none,
// ?nosave=1 (?open= is the UI's). Any of them but ?nosave leaves the real save alone
// unless ?save=1 is given too. ?t=hours sets the title's sky; once a day runs, ?clock=
// does. James's lines are all in script.js.

import * as THREE from 'three';
import { events } from '../core/events.js';
import {
  state, RULES, GAME_FLAGS, attach, setPhase, save, load, hasSave, newDay, resetAll, setClock, tickClock, cleanName, skyHours, dayKey,
  preciseAiming,
} from '../game/state.js';
import { warmth as warmthAt, thermalPhase, THERMAL } from '../lizards/species.js';
import { FLAGS } from '../config.js';
import { buildTasks, TASKS } from '../game/tasks.js';
import * as kit from '../ui/kit.js';
import { SCRIPT, JAMES, say, pick } from './script.js';
import { buildJames } from './james.js';
import { buildJon } from './jon.js';
import { buildStation, TABLE } from './station.js';
import { flossMinigame } from './floss.js';
import { buildKitHunt, KIT_IDS } from './kit_hunt.js';
import { choosePractice, CREEP_VIEW } from './practice.js';
import { registerInteraction, equip, setToolFilter } from '../tools/ring.js';
import { getMarkers } from '../tools/markers.js';
import { vegUniforms } from '../world/wind.js';
import { ensureStoryStyle, el } from './style.js';

// Spots on the landing at the causeway's garden end (props.js PROP_SPOTS: the table
// is at -13.42, 43.75; the start at -11.36, 39.0 facing up the causeway).
const SPOT = {
  jamesHome: { x: -12.45, z: 44.2, heading: 0.45 },
  jamesIntroFrom: { x: -10.2, z: 45.4 },
  jamesIntroTo: { x: -11.75, z: 43.45 },
  playerIntro: { x: -11.35, z: 42.05, heading: Math.PI - 0.25 },
  // a little up the causeway, so the follow camera sits clear of the garden gate's arch
  surveyStart: { x: -11.35, z: 41.2, heading: 0.1 },
  dayEnd: { x: -11.3, z: 42.2, heading: Math.PI - 0.3 }, // back by James for the summary
};
const SPEAKER = JAMES.name;
// Check-image flags (fixed views for screenshots) hold their own camera or player spot:
// without ?phase= the story then leaves the game in its plain walking state.
const CHECK_VIEW = /[?&](cam|lizard|croc|view|at)=/.test(location.search);
const STATION_MARK = '#ffcf3f';
const T_FLAG = new URLSearchParams(location.search).has('t'); // ?t= keeps the title's sky
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
// the opening's steps, in order (?huntstep= starts at one of them)
const STEPS = ['loop_pole', 'notebook', 'bags', 'scales', 'ibis', 'station', 'floss', 'practice'];
// James's radio lines stay close enough to hear him face to face within this many metres
const NEAR_JAMES = 9;

export async function build(game) {
  const { scene, player, camera, rig, collision } = game;
  attach(game);
  ensureStoryStyle();
  const tasks = buildTasks(game);
  const group = new THREE.Group();
  group.name = 'story';
  const topView = FLAGS.view === 'top'; // the layout figure shows no James and no station kit
  if (topView) group.visible = false;

  const james = buildJames(game);
  group.add(james.group);
  game.james = james; // the minimap follows him
  const station = buildStation(game);
  group.add(station.mesh);
  const hunt = buildKitHunt(game);
  group.add(hunt.group);
  const markers = getMarkers(scene);

  // free spots near the wanted ones (the props and bushes are solid)
  const free = (s) => {
    const f = collision.nearestFree ? collision.nearestFree(s.x, s.z, 2) : null;
    return f ? { ...s, x: f.x, z: f.z } : s;
  };
  for (const k of Object.keys(SPOT)) SPOT[k] = free(SPOT[k]);
  james.setHome(SPOT.jamesHome.x, SPOT.jamesHome.z, SPOT.jamesHome.heading);
  james.place(SPOT.jamesHome.x, SPOT.jamesHome.z, SPOT.jamesHome.heading);

  const tools = () => game.tools || null;
  const flags = () => (tools() && tools().flags) || null;
  const loggers = () => (tools() && tools().loggers) || null;
  const name = () => state.playerName || SCRIPT.nameFallback;
  const talk = (lines, extra = {}) => {
    james.talking = true;
    const spoken = (Array.isArray(lines) ? lines : [lines]).map((l) => say(l, { name: name(), ...extra.vars }).replace(/\[([^\]]{1,14})\]/g, '$1'));
    return kit.dialogue({ speaker: SPEAKER, lines: spoken, ...extra })
      .finally(() => { james.talking = false; });
  };
  // James over the radio, from wherever the player is
  const radio = (lines, extra = {}) => talk(lines, { speaker: SCRIPT.radioSpeaker || SPEAKER + ' (radio)', portrait: 'james', ...extra });
  const nearJames = () => Math.hypot(player.position.x - james.position.x, player.position.z - james.position.z) < NEAR_JAMES;
  // a one-line word from James as a toast; over the radio (its squelch) when he is far off
  const word = (line, { icon = 'cap', tone = 'info', ms = 4200, vars = {} } = {}) => {
    if (!line) return;
    const far = !nearJames();
    if (far && game.audio && game.audio.cue) game.audio.cue('radio', true);
    return kit.toast(`${SPEAKER}: ${say(line, { name: name(), ...vars })}`, { icon, tone, ms });
  };
  const hold = (on) => player.hold('story', on);

  // ---------------------------------------------------------------- the camera

  // track: (out) => fills out with the point to look at each frame (a moving subject), or null
  const cine = { on: false, pos: new THREE.Vector3(), look: new THREE.Vector3(), cur: new THREE.Vector3(), curLook: new THREE.Vector3(), rate: 2.5, snap: true, fov: 0, baseFov: 42, track: null };
  // fov: a lens drawn in (degrees) for this shot; the camera's own otherwise
  function shot(pos, look, { rate = 2.5, snap = false, fov = 0 } = {}) {
    if (!cine.on) { cine.cur.copy(camera.position); rig.enabled = false; cine.snap = true; cine.baseFov = camera.fov; }
    cine.fov = fov || cine.baseFov;
    cine.on = true;
    cine.pos.copy(pos);
    cine.look.copy(look);
    cine.rate = rate;
    if (snap || cine.snap) { cine.cur.copy(pos); cine.curLook.copy(look); cine.snap = false; }
  }
  function endShot() {
    cine.track = null;
    if (!cine.on) return;
    cine.on = false;
    if (Math.abs(camera.fov - cine.baseFov) > 0.01) { camera.fov = cine.baseFov; camera.updateProjectionMatrix(); }
    rig.enabled = true;
    rig.yaw = player.heading;
    rig.snap();
  }
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  // over the player's shoulder, looking at James's face; standing close to him (under
  // 1.8 m, as at the station's table) the camera moves further round to the side, so your
  // hat does not cover his face. `show` (a point, or null): take the shoulder on its side,
  // so it is in the picture too (the station's table with its kit back on it)
  function shotTalk(snap = false, show = null) {
    const p = player.position, j = james.position;
    const dx = j.x - p.x, dz = j.z - p.z, d = Math.max(0.5, Math.hypot(dx, dz));
    const ux = dx / d, uz = dz / d;
    const k = Math.min(1, Math.max(0, (1.8 - d) / 1.1)), back = 2.6 - 0.9 * k;
    const sgn = show && (show.x - p.x) * uz - (show.z - p.z) * ux < 0 ? -1 : 1;
    const side = (2.0 + 2.0 * k) * sgn;
    _a.set(p.x - ux * back + uz * side, p.y + 1.85, p.z - uz * back - ux * side);
    _b.set(p.x + dx * 0.7, j.y + 1.05, p.z + dz * 0.7);
    shot(_a, _b, { snap });
  }
  // the end of the day: James in the left third, clear of the summary card on the right
  // (the camera looks a third of its distance to the right of him)
  function shotSummary() {
    const p = player.position, j = james.position;
    const dx = j.x - p.x, dz = j.z - p.z, d = Math.max(0.5, Math.hypot(dx, dz)), ux = dx / d, uz = dz / d;
    // beside and behind the player, far enough aside that the player stands behind the card
    _a.set(p.x - ux * 2.2 + uz * 1.5, p.y + 1.7, p.z - uz * 2.2 - ux * 1.5);
    const D = Math.hypot(j.x - _a.x, j.z - _a.z);
    _b.set(j.x - uz * 0.33 * D, j.y + 1.1, j.z + ux * 0.33 * D);
    shot(_a, _b, { snap: true });
    james.wave();
  }
  // the raided station: James and the knocked-over table, from beside the player
  function shotRaid() {
    const g = Math.max(0, game.data.terrain.heightAt(TABLE.x, TABLE.z));
    _a.set(TABLE.x + 1.05, g + 2.3, TABLE.z - 4.0);
    _b.set(TABLE.x + 0.55, g + 0.35, TABLE.z - 0.45);
    shot(_a, _b, { rate: 2.4 });
  }
  // in front of the player, for choosing the looks
  function shotPlayer() {
    const p = player.position, h = player.heading;
    const fx = -Math.sin(h), fz = -Math.cos(h);
    // in front and well to one side, so James is not in the way
    _a.set(p.x + fx * 2.3 + fz * 2.1, p.y + 1.5, p.z + fz * 2.3 - fx * 2.1);
    _b.set(p.x + fz * 0.35, p.y + 0.9, p.z - fx * 0.35);
    shot(_a, _b);
  }

  // ---------------------------------------------------------------- fades and cards

  let fadeEl = null;
  function fade(on, { title = '', sub = '', ms = 700 } = {}) {
    if (!fadeEl) {
      fadeEl = el('div', 'st-fade');
      fadeEl.innerHTML = '<div class="st-fade-card"><b></b><span></span></div>';
      (document.getElementById('ui') || document.body).appendChild(fadeEl);
    }
    fadeEl.querySelector('b').textContent = title;
    fadeEl.querySelector('span').textContent = sub;
    fadeEl.classList.toggle('has-card', !!title);
    fadeEl.style.transitionDuration = ms + 'ms';
    void fadeEl.offsetWidth;
    fadeEl.classList.toggle('is-on', on);
    return wait(ms / 1000);
  }

  // ---------------------------------------------------------------- phases

  let run = 0; // bumps when a new flow starts, so an old one stops
  const story = {
    group,
    james, station, tasks, hunt,
    cutscene: false,
    step: null, // the opening's step: hunt, ibis, station, floss, practice
    update,
    start: () => begin(() => startNew()),
    continue: () => begin(() => continueGame()),
    skip: () => begin(() => skipToSurvey()),
    toTitle: (o) => begin(() => toTitle(o)),
    clearWorld, // the raided station and the scattered kit back (a reset save)
    endDay: () => begin(() => endDay()),
    // the notebook is out on the island until it has been found (the opening only)
    get notebookFound() { return state.phase !== 'setup' || !!state.setup.done || hunt.found('notebook'); },
    get practicePick() { return prac.pick; }, // the practice lizard and its creep (practice.js)
    get stats() { return { phase: state.phase, step: story.step, james: topView ? 0 : 2, station: station.shown && !topView ? 1 : 0, hunt: hunt.stats }; },
    get firstLizard() { return first.lz; }, // the crested anole James pointed out this morning
    get sunPhase() { return state.phase === 'survey' ? sun.phase : null; }, // as the Today card shows it
  };
  game.story = story; // (main.js sets it too; the kit hunt reads it before)
  // Jon, from the lab (jon.js): he just appears on the survey day, talks with the story's
  // camera and is gone when you look back
  const jon = buildJon(game, { story, shot, endShot, parent: group });
  story.jon = jon;
  // Each flow carries its own token (alive), so a flow left behind (back to the title,
  // Skip, Start again) stops at its next step, and any wait it is in ends at once
  // ('story:abort'), taking its listeners with it.
  function begin(fn) {
    run++;
    events.emit('story:abort');
    return fn().catch((e) => console.error(e));
  }
  // a token for the flow running now: false once a newer one has begun
  const token = () => { const my = run; return () => my === run; };

  const found = () => (Array.isArray(state.setup.kit) ? state.setup.kit : (state.setup.kit = []));
  const poleFound = () => !!(state.setup.done || found().includes('loop_pole'));
  function applyLooks() {
    const av = player.avatar;
    if (av && av.setLooks) av.setLooks(state.looks);
    // the floss loop is on the pole once it has been tied
    if (av && av.setLoop) av.setLoop(!!(state.setup.floss || state.setup.done));
    // and the pole rides on the pack only once it has been found
    if (av && av.setStowed) av.setStowed({ pole: poleFound() });
    // James's own pole was on the table the ibises knocked over: back in his hand once
    // the station is set right
    james.showPole(!!(state.setup.station || state.setup.done));
    kit.vars.name = state.playerName;
    kit.vars.looks = state.looks;
  }
  // The tool ring in the opening holds only what has been found (the loop pole, once it is).
  function toolsFor() {
    if (state.phase === 'setup' && !state.setup.done) setToolFilter((id) => id === 'loop_pole' && poleFound());
    else setToolFilter(null);
  }

  function place(p) { player.teleport(p.x, p.z, p.heading); }

  // The grid flags and the temperature loggers stand on the island from the start.
  function islandOut() {
    const F = flags(), L = loggers();
    try {
      if (F) { F.restore(); F.placeAll(); }
      if (L) { L.restore(); L.deployAll(); }
    } catch (e) { console.error(e); }
  }
  // The field station as the ibises left it (the table over, the mess, the kit out
  // round the island, less what has been found), or set up.
  function worldRaided() {
    hunt.reset();
    hunt.restore(found());
    if (state.setup.station) { hunt.tidy(0); hunt.messShown(true, false); station.show(false); } else { hunt.tidy(1); hunt.messShown(true, true); station.hide(); }
  }
  function worldSet() {
    hunt.reset();
    hunt.restore(KIT_IDS);
    hunt.live(false);
    hunt.tidy(0);
    hunt.messShown(false);
    station.show(false);
  }

  async function toTitle({ save: keep = true } = {}) {
    if (keep && (state.phase === 'setup' || state.phase === 'survey')) save(); // left mid-day from the pause card
    story.cutscene = false;
    story.step = null;
    clearFirst();
    endShot();
    kit.hint(null);
    hunt.live(false);
    hunt.hideCard();
    stationMark(false);
    markers.set('station', null);
    state.clock.running = false;
    setClock(RULES.day.titleHours, false);
    if (T_FLAG && game.sky) game.sky.setTimeOfDay(FLAGS.t);
    crocsAfloat(false);
    crocWatch = false;
    if (game.croc) game.croc.director = false;
    stopPractice();
    prac.last = null;
    place(SPOT.surveyStart);
    player.object.visible = false;
    hold(true);
    james.place(SPOT.jamesHome.x, SPOT.jamesHome.z, SPOT.jamesHome.heading);
    james.face(null);
    prac.james = null;
    // the island as the save left it: set up once the opening is done, else raided
    if (state.setup.done) worldSet(); else worldRaided();
    setToolFilter(null);
    equip('loop_pole', { instant: true, silent: true });
    setPhase('title');
  }

  // A new season's island (Reset save): the raided station and the kit scattered again.
  function clearWorld() {
    islandOut();
    worldRaided();
  }

  async function startNew(alive = token()) {
    resetAll();
    if (GAME_FLAGS.name) state.playerName = GAME_FLAGS.name;
    applyLooks();
    islandOut();
    worldRaided();
    await runIntro(alive);
  }

  async function continueGame(alive = token()) {
    const raw = load();
    applyLooks();
    islandOut();
    if (state.setup.done) {
      worldSet();
      await startSurvey({}, alive);
      return;
    }
    worldRaided();
    if (!state.playerName) { await runIntro(alive); return; }
    // a save from the old set-up day (before the opening was the kit hunt) starts the
    // opening afresh with a word from James; a new one carries on where it was
    await runOpening({ resumed: !!(raw && state.setup.migrated) }, alive);
  }

  // Straight to the survey day: a name, the station set, the opening done.
  async function skipToSurvey(alive = token()) {
    const had = hasSave();
    if (had) load(); else resetAll();
    if (!state.playerName) state.playerName = GAME_FLAGS.name || SCRIPT.nameFallback;
    applyLooks();
    completeSetup();
    await startSurvey({}, alive);
  }

  // Everything the opening does, done at once (no stamps).
  function completeSetup() {
    for (const t of TASKS) if (t.group === 'setup' && !t.optional) state.tasks[t.id] = { n: t.goal, done: true };
    state.setup = { kit: KIT_IDS.slice(), station: 1, floss: true, practice: true, done: true, v: 2 };
    applyLooks();
    islandOut();
    worldSet();
    stationMark(false);
    toolsFor();
  }

  // ---- the intro: James walks up to the raided field station
  async function runIntro(alive = token()) {
    setPhase('intro');
    story.cutscene = true;
    setClock(RULES.day.setupHours, false);
    player.object.visible = true;
    // the ibises have the loop pole: empty hands until it is found
    setToolFilter(null);
    equip(poleFound() ? 'loop_pole' : null, { instant: true, silent: true });
    applyLooks();
    place(SPOT.playerIntro);
    hold(true);
    james.place(SPOT.jamesIntroFrom.x, SPOT.jamesIntroFrom.z, 2.6);
    shotTalk(true);
    await wait(0.4);
    const walked = james.walkTo(SPOT.jamesIntroTo.x, SPOT.jamesIntroTo.z);
    await Promise.race([walked, wait(4)]);
    if (!alive()) return;
    james.wave();
    shotTalk();
    // on the second line (the raid) the camera looks over the mess
    await talk(SCRIPT.intro, { onLine: (i) => { if (i === 1) shotRaid(); else if (i === 2) shotTalk(); } });
    if (!alive()) return;
    shotTalk();
    const typed = await talk([SCRIPT.askName], { input: { placeholder: SCRIPT.namePlaceholder, maxLength: 14, value: GAME_FLAGS.name || state.playerName || '' } });
    if (!alive()) return;
    state.playerName = cleanName(typed) || SCRIPT.nameFallback;
    applyLooks();
    // (his greeting and the hat question in one box, the camera in front of you)
    shotPlayer();
    const hat = await talk([`${SCRIPT.greetName} ${SCRIPT.askHat}`], { choices: RULES.looks.hats.map((h) => ({ label: h.name, value: h.colour, swatch: h.colour })), preview: 'hat', onFocus: tryLook('hat') });
    if (typeof hat === 'string' && hat.startsWith('#')) state.looks.hat = hat;
    applyLooks();
    const shirt = await talk([SCRIPT.askShirt], { choices: RULES.looks.shirts.map((h) => ({ label: h.name, value: h.colour, swatch: h.colour })), preview: 'shirt', onFocus: tryLook('shirt') });
    if (typeof shirt === 'string' && shirt.startsWith('#')) state.looks.shirt = shirt;
    applyLooks();
    if (!alive()) return;
    shotTalk();
    if (GAME_FLAGS.skipSetup) {
      await talk([SCRIPT.looksDone]);
      if (!alive()) return;
      completeSetup();
      await startSurvey({}, alive);
      return;
    }
    const H = SCRIPT.opening.hunt;
    await talk([`${SCRIPT.looksDone} ${H[0]}`, ...H.slice(1)]);
    if (!alive()) return;
    save();
    james.goHome();
    // off you go facing up the causeway (the kit is that way), not back at James
    const n = hunt.spot('loop_pole');
    if (n && !n.found) player.heading = Math.atan2(-(n.x - player.position.x), -(n.z - player.position.z));
    else player.heading = SPOT.surveyStart.heading;
    await runOpening({ fresh: true }, alive);
  }

  // the avatar tries on the colour under the pointer (or the arrow keys) as you choose
  const tryLook = (part) => (colour) => {
    const av = player.avatar;
    if (av && av.setLooks && typeof colour === 'string' && colour.startsWith('#')) av.setLooks({ ...state.looks, [part]: colour });
  };

  // ---- the opening, the same morning as the survey
  // (waits end when done() holds, or at once when a newer flow begins)
  const waitFor = (name, done, alive) => waitAny([name], done, alive);
  const waitAny = (names, done, alive) => new Promise((resolve) => {
    if (done() || !alive()) { resolve(); return; }
    const offs = [];
    const check = () => { if (done() || !alive()) { for (const off of offs) off(); resolve(); } };
    for (const n of names) offs.push(events.on(n, check));
    offs.push(events.on('story:abort', check));
  });
  // the first step not done yet
  function currentStep() {
    const f = found();
    if (f.length < KIT_IDS.length) return f.length >= KIT_IDS.length - 1 ? 'ibis' : 'hunt';
    if (!state.setup.station) return 'station';
    if (!state.setup.floss) return 'floss';
    if (!state.setup.practice) return 'practice';
    return null;
  }

  async function runOpening({ fresh = false, resumed = false } = {}, alive = token()) {
    setPhase('setup');
    story.cutscene = false;
    endShot();
    player.object.visible = true;
    hold(false);
    if (game.croc) { game.croc.enabled = false; game.croc.director = false; } // no crocodile trouble in the opening
    crocsAfloat(true);
    crocSaid = false;
    setClock(RULES.day.setupHours, false);
    if (!state.playerName) state.playerName = GAME_FLAGS.name || SCRIPT.nameFallback;
    applyLooks();
    toolsFor();
    if (GAME_FLAGS.skipSetup) { completeSetup(); await startSurvey({}, alive); return; }
    const O = SCRIPT.opening;
    if (GAME_FLAGS.tool) equip(GAME_FLAGS.tool === 'none' ? null : GAME_FLAGS.tool, { instant: true });
    else equip(poleFound() ? 'loop_pole' : null, { instant: true, silent: true });

    // back in the middle of it (Continue): at the station, with a word from James first
    // (not for the ibis, whose own call follows at once, nor the practice catch, whose
    // own instructions say it all)
    const step = currentStep();
    if (!fresh && (resumed || step !== 'ibis')) {
      place(SPOT.playerIntro);
      if (resumed || step !== 'practice') {
        story.cutscene = true;
        hold(true);
        shotTalk(true);
        await talk(resumed ? O.resume : [O.nudge[step] || O.nudge.hunt]);
        endShot();
        story.cutscene = false;
        hold(false);
        if (!alive()) return;
      }
    }

    if (found().length < KIT_IDS.length) { await runHunt(alive); if (!alive()) return; }
    if (!state.setup.station) { await runStation(alive); if (!alive()) return; }
    let tied = false;
    if (!state.setup.floss) { await runFloss(alive); tied = true; if (!alive()) return; }
    if (!state.setup.practice) { await runPractice(alive, { tied }); if (!alive()) return; }

    story.step = null;
    state.setup.done = true;
    toolsFor();
    save();
    await startSurvey({ stay: true, opening: true }, alive);
  }

  // (1) the kit hunt: four pieces out by the landmarks, then the ibis with the pens
  async function runHunt(alive) {
    const O = SCRIPT.opening;
    story.step = found().length >= KIT_IDS.length - 1 ? 'ibis' : 'hunt';
    hunt.restore(found());
    hunt.live(true);
    // James's radio after the first two finds other than the notebook (and the last)
    let heard = Math.min(2, found().filter((id) => id !== 'notebook').length);
    const onFound = (e) => {
      const list = found();
      if (!e || !e.id || list.includes(e.id)) return;
      list.push(e.id);
      save();
      if (e.id === 'loop_pole') {
        // the pole goes in your hands and in the ring
        toolsFor();
        applyLooks();
        equip('loop_pole');
      }
      if (e.id === 'notebook') {
        // the notebook opens at its cover, your name on it
        setTimeout(() => { if (alive() && state.phase === 'setup' && !kit.busy()) kit.openPanel('notebook', 'cover'); }, 1000);
      } else if (heard < 2 && list.length < KIT_IDS.length - 1) {
        const line = O.radio[heard++];
        const vars = { n: list.length, left: KIT_IDS.length - list.length };
        setTimeout(() => { if (alive() && state.phase === 'setup') word(line, { vars }); }, 1700);
      }
      if (list.length === KIT_IDS.length - 1 && !list.includes('pens')) {
        story.step = 'ibis';
        setTimeout(() => { if (alive() && state.phase === 'setup') callIbis(alive); }, 1500);
      }
    };
    const offs = [
      events.on('kit:found', onFound),
      events.on('ibis:flutter', (e) => { if (e && e.n === 1) kit.toast(O.ibisFlutter, { icon: 'warn', tone: 'warn', ms: 3800 }); }),
      events.on('ibis:drop', (e) => {
        kit.toast(e && e.gaveUp ? O.ibisGaveUp : O.ibisDropped, { icon: 'paint', tone: 'good', ms: 3600 });
        dropShot(alive);
      }),
    ];
    // back with only the pens to find (a save, or ?huntstep=ibis): the ibis comes now
    if (story.step === 'ibis' && !hunt.found('pens')) callIbis(alive);
    await waitFor('kit:found', () => found().length >= KIT_IDS.length, alive);
    for (const off of offs) off();
    if (!alive()) return;
    hunt.live(false);
    // all five: a word on the radio as you set off home (a toast: nothing to stop for)
    setTimeout(() => { if (alive() && state.phase === 'setup') word(O.allFound[0], { icon: 'bag', tone: 'gold', ms: 5600 }); }, 1400);
  }
  // The ibis comes down with the pens on the way back to the station, 10 to 25 m off, and
  // James says so over the radio while the camera watches it land: over your shoulder
  // if that view is clear, else from a few metres off its spot. It flies in past the
  // lens (or over your head), so the first sight of it is on screen.
  async function callIbis(alive) {
    const O = SCRIPT.opening;
    if (hunt.found('pens') || hunt.ibis.state !== 'away') return;
    while (kit.busy() && alive()) await wait(0.25); // the notebook's cover, a card
    if (!alive() || state.phase !== 'setup' || hunt.found('pens') || hunt.ibis.state !== 'away') return;
    const spot = hunt.ibisSpot(player.position);
    story.cutscene = true;
    hold(true);
    const lens = ibisLens(spot);
    const p = player.position;
    if (lens) {
      hunt.callIbis(p, { spot, via: _c });
      const len = _c.distanceTo(_b);
      shot(_c, _b, { rate: 2.4, snap: true, fov: Math.max(16, Math.min(44, 2 * Math.atan(2.4 / len) * 180 / Math.PI)) });
      story.ibisLens = lens;
    } else {
      // no clear lens: the follow camera turned towards it, the bird over your head
      hunt.callIbis(p, { spot });
      player.heading = Math.atan2(-(spot.x - p.x), -(spot.z - p.z));
      rig.yaw = player.heading;
      rig.snap();
      story.ibisLens = 'follow';
    }
    await radio(O.ibis);
    // back to you, facing it
    const I = hunt.ibis;
    if (I.state !== 'away') player.heading = Math.atan2(-(I.x - p.x), -(I.z - p.z));
    endShot();
    story.cutscene = false;
    hold(false);
  }
  // The lens for the ibis's landing (left in _c, looking at _b): over the player's
  // shoulder when it is near enough, else a few metres off the spot on the player's side.
  function ibisLens(spot) {
    const T = game.data.terrain, p = player.position;
    const gy = Math.max(0, T.heightAt(spot.x, spot.z));
    _b.set(spot.x, gy + 0.8, spot.z);
    const d = Math.hypot(spot.x - p.x, spot.z - p.z);
    if (d < 24 && shoulderView(spot.x, gy + 0.8, spot.z, null)) { _b.set(spot.x, gy + 0.8, spot.z); return 'shoulder'; }
    const base = Math.atan2(p.z - spot.z, p.x - spot.x);
    for (const da of [0.35, -0.35, 0.8, -0.8, 0, 1.3, -1.3]) {
      for (const r of [7, 5.5, 9]) {
        const x = spot.x + Math.cos(base + da) * r, z = spot.z + Math.sin(base + da) * r;
        if (collision.isFree && !collision.isFree(x, z, 0.3)) continue;
        const g = Math.max(0, T.heightAt(x, z));
        for (const up of [1.7, 2.6]) {
          if (!clearLens(x, g + up, z, spot.x, gy + 0.6, spot.z, null)) continue;
          _b.set(spot.x, gy + 0.8, spot.z);
          return 'near';
        }
      }
    }
    return null;
  }
  // When the ibis lets go of the pens: a short look from the side (from behind the
  // player it stands behind your hat), until it has turned and stalked off a step.
  let dropping = false;
  async function dropShot(alive) {
    const I = hunt.ibis, p = player.position, T = game.data.terrain;
    if (dropping || story.cutscene || !alive() || kit.busy()) return;
    const dx = I.x - p.x, dz = I.z - p.z, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
    const gy = Math.max(0, T.heightAt(I.x, I.z));
    const mx = p.x + dx * 0.6, mz = p.z + dz * 0.6;
    for (const side of [1, -1]) {
      for (const r of [3.4, 4.4]) {
        const x = mx - uz * side * r, z = mz + ux * side * r;
        if (collision.isFree && !collision.isFree(x, z, 0.3)) continue;
        const g = Math.max(0, T.heightAt(x, z));
        if (!clearLens(x, g + 1.3, z, I.x, gy + 0.5, I.z, null)) continue;
        dropping = true;
        story.cutscene = true;
        hold(true);
        _b.set(I.x, gy + 0.45, I.z);
        shot(_c, _b, { rate: 3, snap: true, fov: 40 });
        cine.track = trackIbis;
        await wait(2.6);
        cine.track = null;
        dropping = false;
        if (!alive()) return;
        endShot();
        story.cutscene = false;
        hold(false);
        return;
      }
    }
  }
  // (the drop shot keeps the ibis in the middle as it turns and walks off)
  const trackIbis = (out) => { const I = hunt.ibis; out.set(I.x, I.y + 0.45, I.z); };

  // (2) the station: one tap stands the table up and the kit pops back onto it
  const stationMapMark = { x: TABLE.x, z: TABLE.z, colour: '#f5b82e', pulse: true, label: 'Station' };
  let stationMapOff = null;
  function stationMark(on) {
    if (on) {
      const y = Math.max(0, game.data.terrain.heightAt(TABLE.x, TABLE.z));
      markers.set('station', [{ x: TABLE.x + 0.75, y, z: TABLE.z - 0.3, colour: STATION_MARK }]);
      const M = game.ui && game.ui.maps;
      if (!stationMapOff && M && M.addMarker) stationMapOff = M.addMarker(stationMapMark);
    } else {
      markers.set('station', null);
      if (stationMapOff) { stationMapOff(); stationMapOff = null; }
    }
  }
  async function runStation(alive) {
    story.step = 'station';
    stationMark(true);
    if (game.play && game.play.auto) { game.play.gotoTable(); righten(); } // scripted play
    await waitFor('setup:station', () => !!state.setup.station, alive);
    stationMark(false);
    if (!alive()) return;
    save();
    await wait(1.0);
    if (!alive()) return;
    story.cutscene = true;
    hold(true);
    shotTalk(false, TABLE);
    await talk(SCRIPT.opening.station);
    endShot();
    story.cutscene = false;
    hold(false);
  }
  const stationOffer = { score: 6, prompt: SCRIPT.hunt.tablePrompt, run: null };
  let righting = false;
  async function righten() {
    if (righting || state.setup.station) return;
    righting = true;
    player.heading = Math.atan2(-(TABLE.x - player.position.x), -(TABLE.z - player.position.z));
    hold(true);
    hunt.tidy(0, true);
    if (game.audio && game.audio.cue) game.audio.cue('tableUp');
    await wait(0.62);
    station.show(true);
    hunt.messShown(true, false);
    james.showPole(true); // his pole was on the table
    const gy = Math.max(0, game.data.terrain.heightAt(TABLE.x, TABLE.z));
    if (game.fx && game.fx.burst) game.fx.burst('sparkle', TABLE.x, gy + 0.95, TABLE.z, 16);
    state.setup.station = 1;
    events.emit('setup:station');
    hold(false);
    righting = false;
  }
  registerInteraction({
    id: 'station-setup',
    check() {
      if (state.phase !== 'setup' || story.step !== 'station' || state.setup.station || righting) return null;
      const d = Math.hypot(player.position.x - TABLE.x, player.position.z - TABLE.z);
      if (d > RULES.reach.station) return null;
      stationOffer.run = righten;
      return stationOffer;
    },
  });

  // (3) a fresh floss loop on the pole (James's "Perfect loop!" opens the practice brief)
  async function runFloss(alive) {
    const O = SCRIPT.opening;
    story.step = 'floss';
    equip('loop_pole');
    // while you tie it, James sets off up the causeway to the practice anole
    jamesToPractice(alive);
    for (;;) {
      if (!alive()) return;
      const r = await kit.minigame(flossMinigame());
      if (!alive()) return;
      if (r && r.success) break;
      await (nearJames() ? talk : radio)([O.flossRetry]);
    }
    state.setup.floss = true;
    applyLooks();
    events.emit('setup:floss');
    save();
  }

  // (4) the practice catch on a calm crested anole out in the open (practice.js picks
  // it by testing the real world: on a trunk by a path, facing the way you come, a clear
  // straight creep in, and in view from the creep camera all the way). At the station
  // James says where it is and a gold marker leads to the start of the creep, on the
  // path; there the camera shows it on its trunk and he says to creep, the marker moves
  // in front of its perch, and he talks you through each step with a word as it comes.
  // james: null (at the station), 'walking' (up the causeway) or 'there' (by the creep)
  const prac = { pick: null, lz: null, said: {}, fledT: -9, hidden: false, arrived: false, tip: null, last: null, james: null };
  // the creep camera's pitch while creeping up on it (lower than the usual creep framing,
  // so a perch 0.75 m up stays in the upper part of the picture: camera.js creepPitch;
  // practice.js picks a lizard in view from that camera)
  const PRACTICE_CREEP_PITCH = CREEP_VIEW.pitch;
  function practicePick() {
    if (!prac.pick) {
      try { prac.pick = choosePractice(game, { from: TABLE, hours: game.sky ? game.sky.hours : null }); } catch (e) { console.error(e); prac.pick = null; }
    }
    return prac.pick;
  }
  // the gold marker (at the start of the creep until you get there, then in front of its
  // perch) and a gold dot on the maps at the lizard
  const pracMapMark = { x: 0, z: 0, colour: '#f5b82e', pulse: true, label: 'Crested anole' };
  const _pm = [{ x: 0, y: 0, z: 0, colour: STATION_MARK }];
  let pracMapOff = null;
  function markPractice() {
    const lz = prac.lz, pk = prac.pick;
    if (!lz) { markers.set('practice', null); return; }
    const hm = lz.home || lz.pos, nh = hm.nx != null ? Math.hypot(hm.nx, hm.nz) : 0;
    const m = _pm[0];
    if (!prac.arrived && pk && pk.start) { m.x = pk.start.x; m.z = pk.start.z; } else {
      m.x = hm.x + (nh > 0.3 ? (hm.nx / nh) * 0.5 : 0);
      m.z = hm.z + (nh > 0.3 ? (hm.nz / nh) * 0.5 : 0);
    }
    m.y = Math.max(0, game.data.terrain.heightAt(m.x, m.z));
    markers.set('practice', _pm);
    const M = game.ui && game.ui.maps;
    pracMapMark.x = hm.x; pracMapMark.z = hm.z;
    if (!pracMapOff && M && M.addMarker) pracMapOff = M.addMarker(pracMapMark);
  }
  function stopPractice() {
    const C = game.catching;
    if (C && C.practice) C.practice.stop();
    prac.lz = null;
    prac.hidden = false;
    prac.arrived = false;
    dropTip();
    if (rig) rig.creepPitch = null;
    markers.set('practice', null);
    if (pracMapOff) { pracMapOff(); pracMapOff = null; }
  }
  async function runPractice(alive, { tied = false } = {}) {
    const O = SCRIPT.opening;
    story.step = 'practice';
    const C = game.catching;
    const pk = practicePick();
    const lz = C && C.practice && pk ? C.practice.start(pk.index) : null;
    const finish = () => {
      state.setup.practice = true;
      prac.last = lz; // (the survey day that follows gives it today's paint dot)
      events.emit('setup:practice');
      stopPractice();
      save();
    };
    // ("Perfect loop!" leads his next line when the loop has just been tied)
    const lead = (line) => (tied ? `${O.flossDone} ${line}` : line);
    if (!lz) { await talk([lead(O.practiceNone)]); finish(); return; }
    prac.lz = lz;
    prac.said = {};
    prac.arrived = false;
    prac.hidden = false;
    markPractice();
    // at the station: where it is, face to face (on the radio if you are elsewhere)
    story.cutscene = true;
    hold(true);
    const lines = [lead(O.practice[0]), ...O.practice.slice(1)];
    if (nearJames()) { shotTalk(); await talk(lines); } else await radio(lines);
    endShot();
    story.cutscene = false;
    hold(false);
    if (!alive()) return;
    if (prac.james !== 'walking' && prac.james !== 'there') jamesToPractice(alive);
    equip('loop_pole');
    let caught = false;
    const off = events.on('practice:done', () => { caught = true; });
    if (game.play && game.play.auto && C.practice.auto) C.practice.auto();
    // on the way: at the start of the creep, or near it any other way (sooner at a jog,
    // before it bolts), a look at it on its trunk and his word on creeping
    const p = player.position;
    while (alive() && !caught && !prac.arrived && state.phase === 'setup') {
      const ds = pk.start ? Math.hypot(pk.start.x - p.x, pk.start.z - p.z) : 99;
      const dl = Math.hypot(lz.pos.x - p.x, lz.pos.z - p.z);
      if (ds < 2.4 || dl < 8 || (player.mode === 'jog' && dl < 11.5)) break;
      await wait(0.1);
    }
    if (!alive()) { off(); return; }
    if (!caught && !prac.arrived && !(game.play && game.play.auto)) await practiceHere(lz, alive);
    await waitFor('practice:done', () => caught, alive);
    off();
    finish();
    if (!alive()) return;
    await wait(1.2);
  }
  // There it is: a look at it on its trunk from a few metres in front of its perch on
  // your side, his word on creeping, then back behind you facing it.
  async function practiceHere(lz, alive) {
    prac.arrived = true;
    markPractice();
    const C = game.catching;
    if ((C && (C.busy || (C.loopPole && C.loopPole.aiming))) || kit.busy()) return;
    story.cutscene = true;
    hold(true);
    const shown = shotLizard(lz, { near: true });
    story.practiceLens = shown ? 'lizard' : 'none';
    await (nearJames() ? talk : radio)([SCRIPT.opening.practiceHere]);
    const p = player.position;
    player.heading = Math.atan2(-(lz.pos.x - p.x), -(lz.pos.z - p.z));
    endShot();
    story.cutscene = false;
    hold(false);
  }
  // James walks up the causeway to watch the practice catch (while you tie the floss, or
  // after his brief), meets you by the start of the creep and goes home as the survey
  // begins. CAUSEWAY: the causeway path from the station to the fork.
  const CAUSEWAY = [[-11.25, 41.5], [-11.6, 39], [-12.3, 36.5], [-13.1, 33], [-13, 30], [-13.5, 25], [-13.3, 21], [-13, 16], [-12.6, 13]];
  const JAMES_BRISK = 1.7;
  let jamesTrip = 0;
  async function jamesWalk(points, alive) {
    const my = ++jamesTrip;
    for (const [x, z] of points) {
      const ok = await james.walkTo(x, z, JAMES_BRISK);
      if (!ok || my !== jamesTrip || !alive()) return false;
    }
    return true;
  }
  // where he stands to watch: a few metres out to the side of the perch, clear of the
  // creep line, of your way in from the station and of his talk reach from where you
  // loop it (so E stays the loop pole's), on open ground with his head under the leaves
  function watchSpot(pk) {
    const lz = game.lizards && game.lizards.lizard ? game.lizards.lizard(pk.index) : null;
    const hm = lz && lz.home, S = pk.start, u = pk.dir, T = game.data.terrain;
    if (!hm) return null;
    const tl = Math.hypot(TABLE.x - S.x, TABLE.z - S.z) || 1;
    const ax = S.x + ((TABLE.x - S.x) / tl) * 8, az = S.z + ((TABLE.z - S.z) / tl) * 8; // your way in
    const seg = (px, pz, x0, z0, x1, z1) => {
      const vx = x1 - x0, vz = z1 - z0, l = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((px - x0) * vx + (pz - z0) * vz) / l));
      return Math.hypot(px - x0 - vx * t, pz - z0 - vz * t);
    };
    const a0 = Math.atan2(u.z, u.x);
    for (const r of [4.8, 4, 5.6]) {
      for (const deg of [60, -60, 75, -75, 45, -45, 90, -90]) {
        const x = hm.x + Math.cos(a0 + deg * Math.PI / 180) * r, z = hm.z + Math.sin(a0 + deg * Math.PI / 180) * r;
        if (!T.isWalkable(x, z) || (T.maskAt(x, z) & 16) || (collision.isFree && !collision.isFree(x, z, 0.5))) continue;
        if (Math.hypot(x - pk.stand.x, z - pk.stand.z) < 3.8 || seg(x, z, hm.x, hm.z, S.x, S.z) < 3.2 || seg(x, z, S.x, S.z, ax, az) < 4.5) continue;
        if (inLeaves(x, Math.max(0, T.heightAt(x, z)) + 1.6, z, 0)) continue;
        return { x, z };
      }
    }
    return null; // (none: he stays at the station and talks over the radio)
  }
  async function jamesToPractice(alive) {
    const pk = practicePick();
    if (!pk || !pk.start) return;
    const w = watchSpot(pk), j = james.position;
    if (!w) return;
    // along the causeway from wherever he is (the stretch ahead of him), by the start of
    // the creep, then to his spot
    const pts = CAUSEWAY.filter(([, z]) => z < j.z - 0.8);
    pts.push([pk.start.x, pk.start.z], [w.x, w.z]);
    prac.james = 'walking';
    james.face(null);
    const ok = await jamesWalk(pts, alive);
    if (!ok) return;
    prac.james = 'there';
    // watching the lizard (he turns to you as you come near)
    const lz = game.lizards && game.lizards.lizard ? game.lizards.lizard(pk.index) : null;
    if (lz && lz.home) james.face(Math.atan2(-(lz.home.x - w.x), -(lz.home.z - w.z)));
  }
  function jamesHome(alive) {
    const j = james.position;
    if (Math.hypot(j.x - SPOT.jamesHome.x, j.z - SPOT.jamesHome.z) < 1) return;
    const pts = CAUSEWAY.filter(([, z]) => z > j.z + 0.8).reverse();
    const pk = prac.pick;
    if (pk && pk.start && Math.hypot(j.x - pk.start.x, j.z - pk.start.z) < 9) pts.unshift([pk.start.x, pk.start.z]);
    pts.push([SPOT.jamesHome.x, SPOT.jamesHome.z]);
    prac.james = null;
    james.face(null);
    jamesWalk(pts, alive);
  }

  // The wrap-up on the radio after the practice catch: a look at you from beside the
  // creep (you, the talipot with its anole back on the trunk, the path you came along)
  // rather than the follow camera under the palm's fans; none without a clear view.
  const WRAP_LENS = [[8, 2, 3.2], [-8, 2, 3.2], [5.2, 1.2, 2.4], [-5.2, 1.2, 2.4]]; // [aside, out along the creep (+: behind you), up]
  function shotWrap() {
    const pk = prac.pick;
    if (!pk || !pk.dir) return false;
    const p = player.position, ux = pk.dir.x, uz = pk.dir.z, hy = p.y + 1.0;
    story.wrapLens = [];
    for (const [side, out, up] of WRAP_LENS) {
      const x = p.x - uz * side + ux * out, z = p.z + ux * side + uz * out;
      // (over a bush is fine: clearLens keeps the lens itself out of the leaves)
      if (!clearLens(x, Math.max(0, game.data.terrain.heightAt(x, z)) + up, z, p.x, hy, p.z, null)) { story.wrapLens.push([side, 'leaves']); continue; }
      story.wrapLens.push([side, 'used', +x.toFixed(1), +z.toFixed(1)]);
      _b.set(p.x - ux * 0.8, hy, p.z - uz * 0.8); // between you and the trunk
      shot(_c, _b, { rate: 2.0, fov: 44 });
      return true;
    }
    return false;
  }

  // James's word at each step of the practice catch, once each, one at a time: a new one
  // takes the place of the last (and the snug's ring says its own)
  function dropTip() {
    const el = prac.tip;
    prac.tip = null;
    if (!el || !el.isConnected) return;
    clearTimeout(el._outTimer);
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 420);
  }
  function tip(line, opts) {
    dropTip();
    prac.tip = word(line, opts) || null;
  }
  const once = (k, icon) => { if (prac.said[k]) return; prac.said[k] = true; tip(SCRIPT.opening.steps[k], { icon }); };
  function practiceGuide() {
    const lz = prac.lz, C = game.catching;
    if (!lz || story.step !== 'practice' || state.phase !== 'setup') return;
    if (rig) rig.creepPitch = PRACTICE_CREEP_PITCH;
    if (story.cutscene) return;
    // the gold marker goes while the loop is up or the lizard is in hand
    const aiming = !!(C && (C.busy || (C.loopPole && C.loopPole.aiming)));
    if (aiming !== prac.hidden) { prac.hidden = aiming; if (aiming) markers.set('practice', null); else markPractice(); }
    if (C && C.busy) {
      const st = C.step;
      if (st === 'timing') { if (prac.tip) dropTip(); } else if (st === 'bag') once('bag', 'bag');
      else if (st === 'ruler') once('ruler', 'ruler');
      else if (st === 'paint') once('paint', 'paint');
      return;
    }
    if (C && C.loopPole && C.loopPole.aiming) { once('aim', 'loop_pole'); return; }
    if (!prac.arrived) return;
    const p = player.position, d = Math.hypot(lz.pos.x - p.x, lz.pos.z - p.z);
    if (d < 2.9) once('reach', 'loop_pole');
    else if (d < 5.5) once('near', 'lizard');
  }
  events.on('lizard:flee', (lz) => {
    if (state.phase !== 'setup' || !prac.lz || lz !== prac.lz || game.time - prac.fledT < 8) return;
    prac.fledT = game.time;
    tip(SCRIPT.opening.steps.fled, { icon: 'lizard', tone: 'warn' });
  });

  // ---- the survey day
  let lastHourSaid = false;
  // ?phase=survey and ?phase=summary start without James's morning lines (once)
  let skipMorning = GAME_FLAGS.phase === 'survey' || GAME_FLAGS.phase === 'summary';
  // stay: the day starts where the player stands (straight on from the opening's
  // practice catch); opening: James's wrap-up of the opening instead of his morning talk
  async function startSurvey({ stay = false, opening = false } = {}, alive = token()) {
    story.cutscene = true;
    story.step = null;
    newDay();
    lastHourSaid = false;
    // the practice anole has today's paint dot: caught again this morning it is a
    // recapture (a quick look, 5 points), as James's paint line says
    const painted = opening ? prac.last : null;
    prac.last = null;
    if (painted && painted.tag && typeof painted.tag === 'object') painted.tag.caughtDay = dayKey();
    // the sun's phase is taken afresh once the day is under way, and its words wait for a change
    sun.phase = null; sun.cand = null; sun.pending = null; sun.settle = 0.5;
    sun.said.on = sun.said.off = false;
    hunt.live(false);
    hunt.hideCard();
    hunt.messShown(false);
    hunt.tidy(0);
    stationMark(false);
    markers.set('station', null);
    stopPractice();
    crocsAfloat(false);
    toolsFor();
    applyLooks();
    player.object.visible = true;
    if (!stay) {
      place(SPOT.surveyStart);
      james.place(SPOT.jamesHome.x, SPOT.jamesHome.z, SPOT.jamesHome.heading);
      james.face(null);
      prac.james = null;
    }
    hold(true);
    if (!station.shown) station.show(false);
    equip(GAME_FLAGS.tool ? (GAME_FLAGS.tool === 'none' ? null : GAME_FLAGS.tool) : 'loop_pole', { instant: true, silent: stay });
    if (game.croc) {
      // the morning's places (none near the start or across a path), then an encounter
      // every 2 to 3 minutes through the day
      game.croc.enabled = true;
      if (game.croc.newDay) game.croc.newDay();
      game.croc.director = true;
    }
    endShot();
    setPhase('survey');
    const quiet = skipMorning;
    skipMorning = false;
    // a new player's first catch: James points out a crested anole near the start (woken
    // now, so it is out on its perch by the time he gets to it); not straight after the
    // opening's practice catch, which has just shown how
    const firstLz = quiet || opening ? null : pointOutFirst();
    if (fadeEl) fadeEl.classList.remove('is-on');
    if (!alive()) return;
    // straight on from the opening, the first crocodile on screen gets James's word (the
    // morning talk has it on other days)
    crocWatch = opening && !quiet;
    if (opening && !quiet) {
      // the wrap-up: a line, the day's requests and off you go (the Today card shows the
      // sun rule, the first logger download says what the colours mean, and the first
      // crocodile on screen gets its own word)
      const lines = [...SCRIPT.opening.done, requestsLine(), SCRIPT.survey.morningEnd].filter(Boolean);
      if (nearJames()) { shotTalk(true); await talk(lines); } else { shotWrap(); await radio(lines); }
      endShot();
      if (!alive()) return;
    } else if (!quiet) {
      shotTalk(true);
      await talk([...SCRIPT.survey.morning, requestsLine(), kitLine(), sunBriefLine()].filter(Boolean));
      if (!alive()) return;
      if (firstLz && shotLizard(firstLz)) { markFirst(true); await wait(0.5); }
      const firstLine = firstLz ? (first.sun && SCRIPT.survey.firstLizardSun) || SCRIPT.survey.firstLizard : null;
      await talk([firstLine, SCRIPT.survey.morningEnd].filter(Boolean));
      markFirst(false);
      endShot();
      if (!alive()) return;
    }
    story.cutscene = false;
    hold(false);
    // the day's play starts here: Precise aiming switched on during the morning talk still
    // makes a Steady hands day (switched off at any point today, it can't)
    if (!state.today.steadyOff) state.today.steady = preciseAiming();
    state.clock.running = true;
    if (stay) jamesHome(alive); // (from the practice catch, back to the station)
  }

  // The morning talk's word on the sun: basking in the cool, shade in the heat (or, on a
  // day started later, how it is now).
  function sunBriefLine() {
    const S = SCRIPT.survey;
    const ph = sunPhaseAtClock();
    return ph === 'morning' ? S.sunBrief : (S.sun && S.sun[ph]) || null;
  }
  // the sun rule's phase ('morning', 'midday', 'afternoon') at the clock's hour, worked
  // out here (right after the clock is set, before the lizards have caught up)
  function sunPhaseAtClock() {
    const h = skyHours(state.clock.hours), sy = game.sky && game.sky.state ? game.sky.state.sunDir.y : 1;
    return thermalPhase(h, warmthAt(h, sy));
  }

  // The sun's phase as the player is told it (story.sunPhase, which the Today card's sun
  // row shows): the lizards' own thermalPhase() once a change has held for 2 s, so a
  // wobble at the turn is never shown. As the heat comes and goes James says so, once
  // each way a day, waiting out a talk, a card or a catch.
  const sun = { phase: null, cand: null, t: 0, settle: 0, pending: null, said: { on: false, off: false } };
  function followSun(dt) {
    if (sun.settle > 0) { sun.settle -= dt; return; }
    const L = game.lizards;
    const ph = L && L.thermalPhase ? L.thermalPhase() : sunPhaseAtClock();
    if (sun.phase === null) sun.phase = ph; // the day's start: the morning talk covered it
    if (ph === sun.phase) sun.cand = null;
    else if (ph !== sun.cand) { sun.cand = ph; sun.t = 0; } else if ((sun.t += dt) >= 2) {
      const was = sun.phase;
      sun.phase = ph;
      sun.cand = null;
      if (ph === 'midday' && !sun.said.on) sun.pending = 'on';
      else if (was === 'midday' && !sun.said.off) sun.pending = 'off';
    }
    const H = SCRIPT.survey.heat;
    if (!sun.pending || !H || kit.busy() || (game.catching && game.catching.busy)) return;
    sun.said[sun.pending] = true;
    kit.toast(`James: ${say(H[sun.pending], { name: name() })}`, { icon: 'sun', tone: 'gold', ms: 4600 });
    sun.pending = null;
  }

  // ---- the survey day's first lizard: for a new player (under three crested anoles in
  // the notebook), James points out a reachable crested anole near the start with a gold
  // marker in front of its perch, and the camera glances over. The marker goes at the
  // day's first catch, after three minutes, or at the end of the day.
  const first = { lz: null, t: 0, sun: false }; // sun: it was basking when he pointed it out
  function pointOutFirst() {
    const C = game.catching;
    clearFirst();
    if (!C || !C.pointOut || (state.species.crested && state.species.crested.caught >= 3)) return null;
    // one the glance can see, and first choice one sitting as the sun rule says (basking
    // in the cool, in the shade in the heat), so the first catch shows the rule too
    const L = game.lizards, hot = sunPhaseAtClock() === 'midday';
    const view = (hm) => !!shoulderView(hm.x + (hm.nx || 0) * 0.06, hm.y + 0.06, hm.z + (hm.nz || 0) * 0.06, null);
    const suits = (hm) => {
      if (!L || !L.sunExposure) return false;
      const e = L.sunExposure(hm.x, hm.y, hm.z, hm.nx || 0, hm.ny ?? 1, hm.nz || 0);
      return hot ? e < THERMAL.shady : e > THERMAL.sunny;
    };
    const lz = C.pointOut('cristatellus', 26, [(hm) => suits(hm) && view(hm), view]);
    if (!lz) return null;
    first.lz = lz;
    first.t = 0;
    first.sun = !hot && suits(lz.home || lz.pos);
    markFirst(false);
    return lz;
  }
  // The marker (a ring with its diamond 1.55 m over it): in play, the ring on the ground
  // in front of the perch and the diamond a little above the lizard; in James's zoomed
  // glance, the diamond right over the lizard's head, so the drawn-in lens shows the two
  // together (its ring then sits under the lizard, round the trunk, or out of sight).
  // In the glance the whole marker is drawn at GLANCE_SCALE, so the zoomed lens shows a
  // diamond smaller than the anole under it.
  const GLANCE_SCALE = 0.6;
  const _fm = [{ x: 0, y: 0, z: 0, colour: STATION_MARK, lift: 0, scale: 1 }];
  function markFirst(glance) {
    const lz = first.lz;
    if (!lz) return;
    const m = _fm[0], T = game.data.terrain;
    m.scale = glance ? GLANCE_SCALE : 1;
    if (glance) {
      lz.headPosition(_a);
      m.x = _a.x; m.z = _a.z;
      m.y = Math.max(0, T.heightAt(m.x, m.z));
      m.lift = _a.y + 0.24 - 1.55 * GLANCE_SCALE - m.y;
    } else {
      const hm = lz.home || lz.pos, nh = hm.nx != null ? Math.hypot(hm.nx, hm.nz) : 0;
      m.x = hm.x + (nh > 0.3 ? (hm.nx / nh) * 0.55 : 0);
      m.z = hm.z + (nh > 0.3 ? (hm.nz / nh) * 0.55 : 0);
      m.y = Math.max(0, T.heightAt(m.x, m.z));
      m.lift = Math.max(0, hm.y + 0.55 - m.y - 1.55);
    }
    markers.set('first', _fm);
  }
  function clearFirst() {
    if (!first.lz) return;
    first.lz = null;
    markers.set('first', null);
    if (game.catching && game.catching.pointOut) game.catching.pointOut(null);
  }
  events.on('lizard:caught', () => { if (state.phase === 'survey') clearFirst(); });

  // A look at the lizard James points out, from over the player's shoulder with the lens
  // drawn in on it (so the picture shows the way there too): the first of a few places
  // behind the player with no wood and no leafy mound between; false when there is none
  // (the talk then stays on James).
  const _ray = new THREE.Ray(), _c = new THREE.Vector3();
  const hosts = game.veg && game.veg.hosts ? game.veg.hosts : { mounds: [], crowns: [] };
  function inLeaves(x, y, z, pad = 0.35) { // pad: the drawn puffs bulge past the hosts' domes
    for (const m of hosts.mounds || []) {
      if (y < m.y - 0.3) continue;
      const dx = (x - m.x) / (m.r + pad), dz = (z - m.z) / (m.r + pad), dy = Math.max(0, y - m.y) / (m.h + pad);
      if (dx * dx + dz * dz + dy * dy < 1) return true;
    }
    for (const c of hosts.crowns || []) {
      const dx = (x - c.cx) / (c.rx + pad), dy = (y - c.cy) / (c.ry + pad), dz = (z - c.cz) / (c.rz + pad);
      if (dx * dx + dy * dy + dz * dz < 1) return true;
    }
    return false;
  }
  // a leafy mound or crown on the line from a towards b, over the share `upto` of it
  const leafyLine = (a, bx, by, bz, upto, pad) => {
    for (let k = 1; k <= 12; k++) {
      const f = (k / 12) * upto;
      if (inLeaves(a.x + (bx - a.x) * f, a.y + (by - a.y) * f, a.z + (bz - a.z) * f, pad)) return true;
    }
    return false;
  };
  // A lens at (x, y, z) in clear air with the head at (hx, hy, hz) in view past leaves
  // and wood: the near two thirds clear of leaves with room (no bush filling the
  // picture), the head clear with room up to a metre short (its own tree may stand in a
  // thicket) and a little below it clear too, no drawn wood between, and, for a live
  // lizard lz, the lizards' own pick on it.
  const _wood = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, kind: 0, tri: -1, w: 0 };
  function clearLens(x, y, z, hx, hy, hz, lz) {
    const L = game.lizards;
    _c.set(x, y, z);
    if (inLeaves(x, y, z) || inLeaves(x, y - 0.9, z)) return false;
    const far = Math.hypot(hx - x, hy - y, hz - z);
    if (leafyLine(_c, hx, hy, hz, 0.66, 0.35) || leafyLine(_c, hx, hy, hz, Math.max(0, far - 1.0) / far, 0.35) ||
      leafyLine(_c, hx, hy - 0.25, hz, Math.max(0, far - 0.4) / far, 0)) return false;
    const P = L && L.perches && L.perches.index;
    const back = Math.min(far, 12) - 0.12, dx = (hx - x) / far, dy = (hy - y) / far, dz = (hz - z) / far, s0 = far - 0.12 - back;
    if (P && back > 0.1 && P.blocked(x + dx * s0, y + dy * s0, z + dz * s0, dx, dy, dz, back, _wood)) return false;
    if (!lz) return true;
    _ray.origin.copy(_c);
    _ray.direction.set(dx, dy, dz);
    const hit = L.pick(_ray, far + 0.5);
    return !!(hit && hit.lizard === lz);
  }
  // over the player's shoulder: the first clear place for the lens (left in _c), or null
  function shoulderView(hx, hy, hz, lz) {
    const p = player.position;
    const dx = hx - p.x, dz = hz - p.z, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
    for (const [back, side, up] of [[1.6, 0.7, 1.9], [1.6, -0.7, 1.9], [2.2, 0.5, 3.0], [2.2, -0.5, 3.0], [0.3, 0, 2.4]]) {
      if (clearLens(p.x - ux * back - uz * side, p.y + up, p.z - uz * back + ux * side, hx, hy, hz, lz)) return _c;
    }
    return null;
  }
  // near: skip the look over the shoulder (the practice catch: the lizard itself, big in
  // the picture, rather than the way there with your own pole across it)
  function shotLizard(lz, { near = false } = {}) {
    const L = game.lizards, T = game.data.terrain;
    if (!L || !L.pick || !lz.visible) return false;
    const p = player.position, h = lz.home || lz.pos;
    lz.headPosition(_b);
    // over the player's shoulder first (the picture shows the way there), the lens drawn in
    if (!near && shoulderView(_b.x, _b.y, _b.z, lz)) {
      const len = _c.distanceTo(_b);
      shot(_c, _b, { rate: 2.2, fov: Math.max(14, Math.min(40, 2 * Math.atan(1.4 / len) * 180 / Math.PI)) });
      return true;
    }
    const clear = (x, y, z) => clearLens(x, y, z, _b.x, _b.y, _b.z, lz);
    // else from a few metres in front of its perch, on the player's side if it can be
    const base = Math.atan2(p.z - h.z, p.x - h.x);
    for (const lift of [0.7, 1.5]) {
      for (const da of [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35]) {
        for (const r of [3.4, 4.6, 2.6]) {
          const x = h.x + Math.cos(base + da) * r, z = h.z + Math.sin(base + da) * r;
          const g = Math.max(0, T.heightAt(x, z));
          if (collision.isFree && !collision.isFree(x, z, 0.3)) continue;
          if (!clear(x, Math.max(_b.y + lift, g + 1.4), z)) continue;
          shot(_c, _b, { rate: 2.2 });
          return true;
        }
      }
    }
    return false;
  }

  // the field kit's jobs (src/missions), mentioned in the morning talk when there are any
  function kitLine() {
    const K = game.missions, S = SCRIPT.missions;
    if (!K || !S || !K.offerable || !K.offerable().length) return null;
    return S.morning || null;
  }

  // "catch 2 brown anoles, read 3 loggers before noon and fit 2 backpacks"
  function requestsLine() {
    const list = (state.today.requests || []).map((r) => r.label.charAt(0).toLowerCase() + r.label.slice(1));
    if (!list.length) return null;
    const joined = list.length === 1 ? list[0] : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
    return say(SCRIPT.survey.requests, { list: joined });
  }

  // The day's work for James's line: catches, species caught, requests done.
  function dayBand() {
    const T = state.today;
    let caught = 0, species = 0;
    for (const [k, n] of Object.entries(T.caught || {})) { if (k === 'croc') continue; caught += n; if (n > 0) species++; }
    // a field-kit job finished counts as a request done; "every one of my requests" means
    // his own few (the kit jobs are optional)
    const requests = (T.requests || []).filter((r) => r.done).length;
    const own = (T.requests || []).filter((r) => !r.mission);
    const hit = RULES.summaryBands.find(([, m]) => caught >= m.caught && species >= m.species && requests >= m.requests);
    return { band: hit ? hit[0] : 'quiet', caught, species, requests, allRequests: !!(own.length && own.every((r) => r.done)) };
  }

  async function endDay(alive = token()) {
    if (state.phase !== 'survey') return;
    state.clock.running = false;
    clearFirst();
    if (game.croc) game.croc.director = false;
    // a catch or a logger reading still going finishes first
    while ((game.catching && game.catching.busy) || kit.modalKind() === 'minigame') {
      await wait(0.25);
      if (!alive() || state.phase !== 'survey') return;
    }
    story.cutscene = true;
    hold(true);
    kit.toast(SCRIPT.cards.endToast, { icon: 'sun', tone: 'gold' });
    await wait(1.2);
    await fade(true, { title: SCRIPT.cards.endTitle, sub: SCRIPT.cards.endSub, ms: 800 });
    player.teleport(SPOT.dayEnd.x, SPOT.dayEnd.z, SPOT.dayEnd.heading);
    james.place(SPOT.jamesHome.x, SPOT.jamesHome.z, SPOT.jamesHome.heading);
    shotSummary();
    const isBest = state.score > (state.best || 0);
    const work = dayBand();
    let line = say(SCRIPT.summary[work.band], { name: name(), score: state.score });
    // a day spent with the field kit (src/missions) is not a quiet one
    const kitDone = (state.today.requests || []).filter((r) => r.mission && r.done).length;
    if (kitDone && work.band === 'quiet' && SCRIPT.summary.kitDay) line = say(SCRIPT.summary.kitDay, { name: name() });
    else if (kitDone && SCRIPT.summary.kit) line += ' ' + say(SCRIPT.summary.kit, { name: name() });
    if (work.allRequests && SCRIPT.summary.requests) line += ' ' + say(SCRIPT.summary.requests, { name: name() });
    else if (isBest && state.score > 0) line += ' ' + say(SCRIPT.summary.best, { name: name() });
    state.summary = {
      score: state.score, best: Math.max(state.best, state.score), newBest: isBest && state.score > 0,
      caught: { ...state.today.caught }, tagged: state.today.tagged, loggersRead: state.today.loggersRead,
      tasksDone: state.today.tasksDone, spotted: state.today.spotted, line, band: work.band,
      steady: state.today.steady === true, // Precise aiming from start to end (the Steady hands board)
      requests: (state.today.requests || []).map((r) => ({ label: r.label, done: r.done, n: r.n, goal: r.goal, mission: r.mission || null })),
    };
    state.best = Math.max(state.best, state.score);
    state.days++;
    save();
    events.emit('day:end', state.summary);
    await fade(false, { ms: 700 });
    setPhase('summary');
    story.cutscene = true;
  }

  // ---- talking to James during the day
  const talkOffer = { score: 5, prompt: SCRIPT.talkPrompt, run: null };
  // A pole broken after the free one: James has the spare, so the maps point to him
  // until he hands it over.
  const poleOut = () => { const B = game.catching && game.catching.breaks; return !!(B && B.noPole && !B.onTheWay); };
  const poleMapMark = { x: 0, z: 0, colour: '#f5b82e', pulse: true, label: 'New pole' };
  let poleMapOff = null;
  events.on('pole:break', (e) => {
    const M = game.ui && game.ui.maps;
    if (!e || e.free || poleMapOff || !M || !M.addMarker) return;
    poleMapMark.x = james.position.x;
    poleMapMark.z = james.position.z;
    poleMapOff = M.addMarker(poleMapMark);
  });
  events.on('pole:new', () => { if (poleMapOff) { poleMapOff(); poleMapOff = null; } });

  // A friendly word on the radio towards the field jobs (RULES.kitNudge): after a good run
  // of catches with one not done today, James names it and the maps mark where it is (the
  // station for the kit, the nearest logger) until it is done or the day ends. Never in a
  // catch, a mission, a talk or a cutscene, and only once nothing has been going on for a
  // moment. since: catches since the last field job done (a mission finished, a logger
  // read) or the last nudge; null before either today.
  const KIT_JOBS = ['tls', 'drone', 'rtk', 'loggers'];
  const kitMarkLabel = { tls: 'Laser scanner', drone: 'Drone', rtk: 'RTK rover', loggers: 'Logger' };
  const kitNudge = { n: 0, since: null, last: -Infinity, said: null, calm: 0, off: null, mark: { x: 0, z: 0, colour: '#ff6fa8', label: '' } };
  const kitUnmark = (id) => { if (kitNudge.off && (!id || id === kitNudge.said)) { kitNudge.off(); kitNudge.off = null; } };
  const kitReset = () => { kitUnmark(); kitNudge.n = 0; kitNudge.since = null; kitNudge.last = -Infinity; kitNudge.said = null; };
  events.on('day:new', kitReset);
  events.on('phase:change', kitReset);
  events.on('lizard:caught', () => { if (kitNudge.since != null) kitNudge.since++; });
  events.on('mission:start', (e) => kitUnmark(e && e.id));
  events.on('mission:done', (e) => { kitNudge.since = 0; kitUnmark(e && e.id); });
  events.on('logger:read', () => { kitNudge.since = 0; kitUnmark('loggers'); });
  // the jobs not done today, the kit first
  function jobsLeft() {
    const K = game.missions, out = (K && K.offerable ? K.offerable() : []).map((m) => m.id);
    if (!(state.today.loggersRead > 0)) out.push('loggers');
    return KIT_JOBS.filter((id) => out.includes(id));
  }
  function kitNudgeCheck(dt) {
    const R = RULES.kitNudge, K = game.missions;
    const free = !kit.busy() && !story.cutscene && !(game.catching && game.catching.busy) && !(K && K.activeMission && K.activeMission()) && jon.state === 'away';
    kitNudge.calm = free ? kitNudge.calm + dt : 0;
    if (kitNudge.calm < 2.5 || kitNudge.n >= R.most || state.clock.hours - kitNudge.last < R.gap) return;
    let caught = 0;
    for (const [k, n] of Object.entries(state.today.caught || {})) if (k !== 'croc') caught += n;
    if (!((kitNudge.since != null && kitNudge.since >= R.since) || (kitNudge.n === 0 && caught >= R.catches))) return;
    const left = jobsLeft();
    const id = left.find((j) => j !== kitNudge.said) || left[0];
    if (!id) return;
    kitNudge.n++;
    kitNudge.since = 0;
    kitNudge.last = state.clock.hours;
    kitUnmark();
    kitNudge.said = id;
    word(SCRIPT.survey.kitNudge[id], { icon: id === 'loggers' ? 'logger' : id, ms: 6500 });
    // the mark: James at the station for the kit, else the nearest logger
    let at = james.position;
    if (id === 'loggers') {
      const p = player.position;
      for (const l of state.loggers || []) if (at === james.position || Math.hypot(l.x - p.x, l.z - p.z) < Math.hypot(at.x - p.x, at.z - p.z)) at = l;
    }
    const M = game.ui && game.ui.maps;
    kitNudge.mark.x = at.x;
    kitNudge.mark.z = at.z;
    kitNudge.mark.label = kitMarkLabel[id];
    if (M && M.addMarker) kitNudge.off = M.addMarker(kitNudge.mark);
  }
  const rng = Math.random;
  registerInteraction({
    id: 'james-talk',
    check() {
      if ((state.phase !== 'setup' && state.phase !== 'survey') || story.cutscene) return null;
      const d = Math.hypot(player.position.x - james.position.x, player.position.z - james.position.z);
      if (d > RULES.reach.james) return null;
      talkOffer.score = 5 - d;
      talkOffer.run = talkToJames;
      talkOffer.prompt = poleOut() ? SCRIPT.breaks.askPrompt : SCRIPT.talkPrompt;
      return talkOffer;
    },
  });
  async function talkToJames(opts = {}) {
    story.cutscene = true;
    shotTalk();
    let after = null;
    try {
      after = await chat(opts);
    } finally {
      endShot();
      story.cutscene = false;
    }
    // a field-kit job taken on starts once the talk's camera has let go
    if (typeof after === 'function') after();
  }

  // The field kit (src/missions, game.missions): with a job under way James asks how it
  // is going; with one to hand out he offers them (or just a chat). Taking one on hears
  // its brief (ending with his send-off) and returns what starts it. Returns false for
  // the usual chat. "Just a chat" lasts that one talk: he offers again the next time
  // (E is a habit here, and the offer is easy to wave off without meaning to).
  let kitDeclined = null; // the day (state.today) of the last "Just a chat": he asks "Still fancy..." after it
  let kitThanked = null; // the day (state.today) he said every job had had a run
  async function kitChat() {
    const alive = token(); // (a flow begun meanwhile, back to the title: the offer lapses)
    const K = game.missions, S = SCRIPT.missions;
    if (!K || !S || state.phase !== 'survey') return false;
    const act = K.activeMission ? K.activeMission() : null;
    if (act) {
      let p = null;
      try { p = act.progress ? act.progress() : null; } catch (e) { p = null; }
      const info = K.info(act.id);
      const line = (S[act.id] && S[act.id].active) || S.active;
      await talk([say(line, { title: (info.short || info.title).toLowerCase(), n: p ? p.done : 0, goal: p ? p.goal : 1 })]);
      return true;
    }
    const list = K.offerable ? K.offerable() : [];
    if (!list.length) {
      // every job done today: he says so, once a day
      const all = K.list ? K.list() : [];
      if (S.allDone && all.length && kitThanked !== state.today && all.every((m) => (K.request(m.id) || {}).done)) {
        kitThanked = state.today;
        await talk([S.allDone]);
        return true;
      }
      return false;
    }
    const choices = list.map((m) => ({ label: (S.choices && S.choices[m.id]) || K.info(m.id).title, value: m.id, icon: K.info(m.id).icon }));
    choices.push({ label: (S.choices && S.choices.chat) || 'Just a chat', value: 'chat', icon: 'cap' });
    // "Just a chat" is the default a plain [E] takes (focused, not the solid main button:
    // the choices all look alike so the jobs are not drawn as the lesser ones); a job is
    // picked with the pointer, the arrows or its number
    const line = kitDeclined === state.today && S.offerAgain ? S.offerAgain : S.offer;
    // while the drone is on offer its pad's marker shows, so the job's place is pointed out
    // (the survey's first view has the pad just below the screen); the mission's start
    // takes the marker over, any other choice puts it away
    const D = list.some((m) => m.id === 'drone') ? game.missions_drone : null;
    const hint = (on) => { try { if (D && typeof D.hintPad === 'function') D.hintPad(on); } catch (e) { console.error(e); } };
    hint(true);
    const pickId = await talk([line], { choices, defaultChoice: choices.length - 1, plainChoices: true });
    if (pickId !== 'drone' || !alive()) hint(false);
    if (!alive()) return true;
    if (!list.some((m) => m.id === pickId)) { kitDeclined = state.today; return false; }
    const brief = S[pickId] && S[pickId].brief;
    if (brief) await talk(brief);
    return () => { if (state.phase === 'survey') K.accept(pickId); };
  }

  async function chat(opts = {}) {
    // a broken pole first (src/catch/breaks.js): his line goes by how it broke
    if (state.phase === 'survey' && poleOut()) {
      const B = game.catching.breaks;
      await talk([SCRIPT.breaks.replace[B.kind] || SCRIPT.breaks.replace.careless]);
      if (state.phase === 'survey') B.replace();
      return;
    }
    if (state.phase === 'survey' && opts.kit !== false) {
      const k = await kitChat();
      if (k) return k;
    }
    if (state.phase === 'setup') {
      const nudge = SCRIPT.opening.nudge[story.step] || pick(SCRIPT.survey.cheers, rng);
      await talk([nudge]);
      return;
    }
    const S = SCRIPT.survey;
    const lines = [];
    // a tip for a species with an open task, now and then
    const open = TASKS.filter((t) => t.group === 'species' && !(state.tasks[t.id] && state.tasks[t.id].done));
    if (open.length && rng() < 0.6) {
      const t = open[Math.floor(rng() * open.length)];
      lines.push(S.tips[t.species] || pick(S.cheers, rng));
    } else lines.push(pick(S.cheers, rng));
    // a word about the sun: basking in the morning, shade at midday, out again late on
    const sunLine = S.sun && game.lizards && game.lizards.thermalPhase ? S.sun[game.lizards.thermalPhase()] : null;
    if (sunLine && rng() < 0.45) lines.push(sunLine);
    // a request still open, or thanks when they are all done
    const reqs = state.today.requests || [];
    const openReq = reqs.filter((r) => !r.done);
    if (openReq.length && rng() < 0.6) {
      const r = openReq[Math.floor(rng() * openReq.length)];
      lines.push(say(S.requestLeft, { label: r.label.charAt(0).toLowerCase() + r.label.slice(1), n: r.n, goal: r.goal }));
    } else if (reqs.length && !openReq.length && rng() < 0.6) lines.push(S.requestsAllDone);
    let due = false;
    try { due = state.loggers.some((l) => loggers() && loggers().due(l)); } catch (e) { due = false; }
    if (due && rng() < 0.5) lines.push(S.loggersDue);
    else if (state.inventory.backpacks > 0 && rng() < 0.4) lines.push(say(S.backpacksLeft, { n: state.inventory.backpacks }));
    else if (state.inventory.backpacks === 0 && state.today.tagged > 0) lines.push(S.noBackpacks);
    await talk(lines, { vars: { n: state.inventory.backpacks } });
    if (rng() < 0.5) james.showBag();
  }

  // the floss mini-game on its own (?open=minigame:floss)
  kit.registerMinigame('floss', () => flossMinigame());

  // the notebook is saved as stamps land, now and then through the day, and on leaving
  const saving = () => state.phase === 'setup' || state.phase === 'survey';
  events.on('task:done', () => { if (saving()) save(); });
  let saveT = 0;
  window.addEventListener('pagehide', () => { if (saving()) save(); });
  // Ctrl creeps, and on some systems Ctrl+W closes the tab: while creeping mid-day,
  // leaving the page asks first (a plain reload does not).
  window.addEventListener('beforeunload', (e) => {
    if (!saving() || !game.input.down('creep')) return;
    save();
    e.preventDefault();
    e.returnValue = '';
  });

  // The opening keeps the crocodiles afloat (croc.haul = false): none hauls out on the
  // lawn by a piece of kit while its hazard is off (the tutorial must not teach that a
  // croc on land is safe), and one already out slides back in.
  let afloat = false, crocSaid = false, crocWatch = false;
  function crocsAfloat(on) {
    afloat = on;
    if (game.croc && 'haul' in game.croc) game.croc.haul = !on;
  }
  // the first time one is close by and on screen in the opening (or straight on from it,
  // that survey day), a word from James over the radio
  const _cw = new THREE.Vector3();
  function crocWord() {
    const C = game.croc;
    if (crocSaid || !C || !C.crocs || kit.busy() || story.cutscene) return;
    for (const c of C.crocs) {
      if (!c.visible || !(c.dist < 30)) continue;
      if (c.headPosition) c.headPosition(_cw); else _cw.set(c.x, 0.2, c.z);
      _cw.project(camera);
      if (_cw.z > 1 || Math.abs(_cw.x) > 0.85 || Math.abs(_cw.y) > 0.85) continue;
      crocSaid = true;
      kit.toast(`James: ${say(SCRIPT.opening.croc, { name: name() })}`, { icon: 'croc', tone: 'warn', ms: 4200 });
      return;
    }
  }

  // the season's first basilisk seen running across the water (src/wildlife/basilisk.js):
  // a word from James over the radio
  events.on('basilisk:waterrun', (e) => {
    if (e && e.first && state.phase === 'survey') word(SCRIPT.survey.basiliskRun, { icon: 'lizard', ms: 4600 });
  });

  // the croc's snap: a word from James over the radio, now and then
  events.on('croc:snap', () => {
    if (state.phase === 'survey' && rng() < 0.5) setTimeout(() => { if (!kit.busy()) kit.toast(`James: ${pick(SCRIPT.survey.crocSnap, rng)}`, { icon: 'croc', tone: 'warn' }); }, 1600);
  });

  // ---------------------------------------------------------------- per frame

  let started = false;
  let t0 = 0;
  function update(dt, t) {
    t0 += dt;
    if (!started && t0 > 0.05) { started = true; boot(); }
    james.update(dt, t);
    station.update(dt);
    hunt.update(dt, t);
    tasks.update(dt);
    if (cine.on) {
      rig.enabled = false;
      if (state.phase === 'intro' || story.cutscene) {
        if (cine.track) cine.track(cine.look);
        const k = 1 - Math.exp(-cine.rate * dt);
        cine.cur.lerp(cine.pos, k);
        cine.curLook.lerp(cine.look, k);
        camera.position.copy(cine.cur);
        camera.lookAt(cine.curLook);
        if (Math.abs(camera.fov - cine.fov) > 0.01) { camera.fov += (cine.fov - camera.fov) * k; camera.updateProjectionMatrix(); }
      }
    }
    // a far camera (the title's drift, a cutscene) would cut a tunnel through the trees
    if (state.phase === 'title' || cine.on) vegUniforms.uVegCut.value = 0;
    if (afloat && state.phase === 'setup') { crocWord(); practiceGuide(); } else if (crocWatch && state.phase === 'survey' && !crocSaid) crocWord();
    if (first.lz && state.phase === 'survey' && !story.cutscene) {
      first.t += dt;
      if (first.t > 180) clearFirst();
    }
    if (state.phase === 'survey' && !story.cutscene) {
      followSun(dt);
      kitNudgeCheck(dt);
      saveT += dt;
      if (saveT > 60) { saveT = 0; save(); }
      if (tickClock(dt)) story.endDay();
      else if (!lastHourSaid && RULES.day.end - state.clock.hours <= 1) {
        lastHourSaid = true;
        kit.toast(`James: ${say(SCRIPT.survey.lastHour, { name: name() })}`, { icon: 'clock', tone: 'warn' });
      }
    }
    // (last: whether Jon is in view is judged on this frame's camera)
    jon.update(dt, t);
  }

  // The first frame: every system is built, so the phase can start.
  function boot() {
    const P = GAME_FLAGS.phase;
    if (P === 'intro') story.start();
    else if (P === 'setup' || P === 'hunt' || P === 'practice' || (GAME_FLAGS.huntStep && !P)) {
      begin(() => openingAt(P === 'practice' ? 'practice' : GAME_FLAGS.huntStep || 'loop_pole'));
    } else if (P === 'survey') story.skip();
    else if (P === 'summary') {
      begin(async () => {
        const alive = token();
        await skipToSurvey(alive);
        if (!alive()) return;
        // the day's end, as in play: the sunset sky and the fireflies (or ?clock=)
        setClock(GAME_FLAGS.clock ?? RULES.day.end, false);
        await endDay(alive);
      });
    } else if (CHECK_VIEW) {
      // a check image with its own camera or player spot: no title, the player left free
      story.cutscene = false;
    } else story.toTitle();
  }

  // ?phase=hunt|practice and ?huntstep=: a fresh opening with everything before that
  // step done, the player standing where it starts.
  async function openingAt(step, alive = token()) {
    resetAll();
    state.playerName = GAME_FLAGS.name || SCRIPT.nameFallback;
    const k = Math.max(0, STEPS.indexOf(step));
    const kitN = k >= STEPS.indexOf('station') ? KIT_IDS.length : Math.min(k, KIT_IDS.length - 1);
    state.setup = { kit: KIT_IDS.slice(0, kitN), station: k > STEPS.indexOf('station') ? 1 : 0, floss: k > STEPS.indexOf('floss'), practice: false, done: false, v: 2 };
    const set = (id, n, goal) => { if (n > 0) state.tasks[id] = { n, done: n >= goal }; };
    set('setup.kit', kitN, KIT_IDS.length);
    if (state.tasks['setup.kit']) state.tasks['setup.kit'].ids = state.setup.kit.slice();
    set('setup.station', state.setup.station ? 1 : 0, 1);
    set('setup.floss', state.setup.floss ? 1 : 0, 1);
    applyLooks();
    islandOut();
    worldRaided();
    // stand by the piece to find, the last one found (for the ibis), or the station
    const it = step === 'ibis' ? hunt.byId.get('scales') : hunt.byId.get(step);
    if (it && !it.ibis) {
      const f = collision.nearestFree ? collision.nearestFree(it.x + 3.5, it.z + 2.5, 3) : null;
      const at = f || { x: it.x + 3.5, z: it.z + 2.5 };
      player.teleport(at.x, at.z, Math.atan2(-(it.x - at.x), -(it.z - at.z)));
    } else place({ x: TABLE.x + 1.6, z: TABLE.z - 1.4, heading: Math.atan2(1.6, -1.4) });
    rig.yaw = player.heading;
    rig.snap();
    await runOpening({ fresh: true }, alive);
  }

  // ---------------------------------------------------------------- scripted tests

  const press = (action, frames = 1) => new Promise((resolve) => {
    let n = frames;
    const off = game.input.addSource((f) => {
      f.held[action] = true;
      if (--n <= 0) { off(); setTimeout(resolve, 0); }
    });
  });
  const standBy = (x, z, dist = 1.6, face = null) => {
    let at = null;
    for (let k = 0; k < 16 && !at; k++) {
      const a = (k / 16) * Math.PI * 2 + 2.2;
      const px = x + Math.cos(a) * dist, pz = z + Math.sin(a) * dist;
      if (collision.isFree(px, pz)) at = { x: px, z: pz };
    }
    if (!at) at = { x: x + dist, z };
    const fx = face ? face.x : x, fz = face ? face.z : z;
    player.teleport(at.x, at.z, Math.atan2(-(fx - at.x), -(fz - at.z)) || 0);
    rig.yaw = player.heading;
    rig.snap();
    return at;
  };
  game.play = Object.assign(game.play || {}, {
    auto: false, // true: the story's mini-games play themselves
    state,
    story,
    press,
    hold: (action, seconds) => new Promise((resolve) => {
      const end = performance.now() + seconds * 1000;
      const off = game.input.addSource((f) => { f.held[action] = true; if (performance.now() > end) { off(); resolve(); } });
    }),
    setClock: (h) => setClock(h, state.clock.running),
    equip: (id) => equip(id),
    // stand by stake id (its free standing spot), facing it
    goto(id, dist = 1.1) {
      const s = game.stakes && game.stakes.byId.get(id);
      if (!s) return false;
      standBy(s.x, s.z, dist);
      return true;
    },
    gotoJames() { player.teleport(james.position.x + 1.4, james.position.z - 0.9, Math.atan2(1.4, -0.9)); },
    gotoTable() { player.teleport(TABLE.x + 1.1, TABLE.z - 0.3, Math.PI / 2); },
    // the kit hunt: stand by a piece (dist m off, facing it), or by the ibis
    gotoKit(id, dist = 2.2) { const s = hunt.spot(id); return s ? standBy(s.x, s.z, dist) : null; },
    gotoIbis(dist = 7) { const I = hunt.ibis; return I.state !== 'away' ? standBy(I.x, I.z, dist) : null; },
    kitLeft: () => hunt.left(),
    huntAll() { for (const id of KIT_IDS) if (!hunt.found(id)) hunt.give(id); },
    // the practice lizard: its pick (practice.js) and the start of its straight creep
    practicePick: () => practicePick(),
    // (a scripted run stood at the start of the creep has arrived: no look at it, and
    // the marker moves in front of its perch)
    gotoPracticeStart() {
      const pk = practicePick();
      if (!pk) return null;
      if (prac.lz) { prac.arrived = true; markPractice(); }
      const lz = game.lizards.lizard(pk.index);
      player.teleport(pk.start.x, pk.start.z, Math.atan2(-(lz.home.x - pk.start.x), -(lz.home.z - pk.start.z)));
      rig.yaw = player.heading;
      rig.snap();
      return pk;
    },
    completeSetup,
    talk: (o) => talkToJames({ kit: false, ...o }), // a plain chat (scripted runs); { kit: true } lets him offer the field kit
    endDay: () => story.endDay(),
  });

  return story;
}
