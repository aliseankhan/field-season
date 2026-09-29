// Catching, as one optional system (main.js OPTIONAL_SYSTEMS, stored as game.catching):
// the loop pole on the tool ring (loop_pole.js), spotting (spotting.js), snug-the-loop
// (timing.js) and the catch-and-release cards (release.js); the points and events of
// a catch; the pole's small effect on the lizards; and the GPS fixes of tagged lizards
// for the map.
//
// Events (on game.events):
//   lizard:spotted { lizard, species, key, perch, surface, height, onLeaves, canopy }
//   croc:spotted { croc, distance, safe }
//   lizard:caught { lizard, species, key, bonus: { creep, display, first, perfect }, points, perch, seen, surface, height, taped }
//   lizard:recaptured { lizard }  (caught again the same day: a quick look and back it goes)
//   lizard:escaped { lizard, why }  (the snug missed)
//   lizard:measured { lizard, svl }  lizard:marked { lizard, colour }  lizard:tagged { lizard, colour, svl }
//   lizard:released { lizard }  pole:aim { on }  pole:whiff { lizard, why }  pole:bop { lizard }
//   practice:done { lizard }  (the opening's practice catch: no points, no counts)
//
// In the opening only the practice lizard (practice.start(index)) can be caught; the
// rest can be spotted. A very rare lizard forgives one missed snug a day.
//
// Flags: ?catch=<species> (crested or cristatellus ...) takes the player to the nearest
// one of that species that the pole can reach and starts the catch there;
// &catchstep=aim|timing|bag|ruler|paint|backpack|perch holds at that step for a
// screenshot, &catchstep=auto plays it all through. The cards also open on their own
// with a stand-in lizard: ?open=minigame:bag|ruler|paint|backpack|perch.
//
// game.catching: { loopPole, timing, spotter, startCatch(lizard, info, opts), busy, step,
// practice: { start(), stop(), lizard }, pointOut(species, maxDist) (the survey day's
// first lizard, pinned; pointOut(null) lets it go), download(entry), stats, play } where play is
// for scripted tests: catchNearest(species, 'perfect' | 'good' | 'early' | 'late') ->
// Promise of the result, goTo(species) -> the lizard, aim(on), lock(lizard). Numbers
// are in tuning.js.
//
// Tagged lizards: state.tracked entries get a nickname, and their backpack logs a GPS
// fix every CATCH.track.fix seconds of the survey day into entry.fixes ([x, z] pairs,
// 0.5 m grid, a wander round the perch). The maps draw entry.trail, the fixes downloaded
// so far: the first at the fitting, the rest when the player downloads them with the
// GPS case (tools/backpacks.js calls download(entry)). Kept in memory only.

import * as THREE from 'three';
import { events } from '../core/events.js';
import { recordError } from '../debug.js';
import * as kit from '../ui/kit.js';
import { state, addScore, GAME_FLAGS, perchHeight, nextBackpackColour, dayKey, holdClock, preciseAiming } from '../game/state.js';
import { catchPoints, RULES } from '../game/rules.js';
import { registerTool, current, equip } from '../tools/ring.js';
import { vegUniforms } from '../world/wind.js';
import { CATCH, CATCH_POINTS, SPECIES_NAMES, PERCH_WORDS, NICKNAMES, perchSeen } from './tuning.js';
import { LoopPole } from './loop_pole.js';
import { SnugTiming } from './timing.js';
import { Spotter } from './spotting.js';
import { runRelease, standIn, bagCard, rulerCard, paintCard, packCard, perchCard } from './release.js';

// the notebook's species keys
export const SHORT = { cristatellus: 'crested', sagrei: 'brown', carolinensis: 'green', distichus: 'bark', equestris: 'knight' };
const LONG = Object.fromEntries(Object.entries(SHORT).map(([k, v]) => [v, k]));
const DISPLAY_STAMP = { headbob: 'Head bob!', pushup: 'Push-up!', dewlap: 'Dewlap!' };
const DISPLAY_WORD = { headbob: 'mid head bob', pushup: 'mid push-up', dewlap: 'mid dewlap' };
const MARKS = ['#ff4fa3', '#3ec7ff', '#ffb52e', '#9b6bff', '#35d49a'];
// how far a tagged lizard wanders from its perch through the day, metres (the map's GPS fixes)
const WANDER = { cristatellus: 2.2, sagrei: 3.6, carolinensis: 2.8, distichus: 1.4, equestris: 4.5 };
const PLAY = new Set(['setup', 'survey']);
const MISS = {
  early: ['Too soon! The loop bopped it on the nose.', 'Boing! The loop bounced off its snout.', 'Too eager! It ducked and dashed off.'],
  late: ['Too slow! It slipped out of the loop.', 'It wriggled free and scampered off.', 'The {common} gave you a look and left.'],
  knight: ['The knight anole shook its big head free. So proud!', 'It puffed its pink dewlap and marched off.'],
  after: ['It\'ll come back in a bit.', 'Anoles are forgiving. Wait a bit!', 'Stand still and it may come back.'],
  practice: ['Nearly! Ease the loop back over its head and try again.', 'So close! It\'s a patient one. Have another go.'],
};
const VERY_RARE = new Set(['distichus', 'equestris']);

const params = new URLSearchParams(location.search);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const common = (sp) => (SPECIES_NAMES[sp] ? SPECIES_NAMES[sp].common : sp);

// A lizard's true snout-vent length (mm), the same every time for the same lizard.
function trueSvl(lz) {
  const r = CATCH.svl[lz.species] || CATCH.svl.cristatellus;
  const range = lz.sex === 'm' ? r.m : r.f;
  let s = ((lz.index + 1) * 2654435761) >>> 0;
  s = (s ^ (s >>> 15)) >>> 0; s = Math.imul(s, 0x2c1b3c6d) >>> 0; s = (s ^ (s >>> 12)) >>> 0;
  const u = (s % 10000) / 10000;
  return Math.round(range[0] + (range[1] - range[0]) * u);
}

export async function build(game) {
  const cssId = 'catch-css';
  if (!document.getElementById(cssId)) {
    const link = document.createElement('link');
    link.id = cssId;
    link.rel = 'stylesheet';
    link.href = new URL('./catch.css', import.meta.url).href;
    document.head.appendChild(link);
  }

  const flow = { busy: false, lizard: null, step: null };
  const alertAt = new WeakMap();
  events.on('lizard:alert', (lz) => { alertAt.set(lz, game.time); });
  // leaving the field mid-catch (the pause card's back to the title): the snug or the card
  // is dropped and the lizard goes home
  events.on('phase:change', (e) => {
    if (!flow.busy || PLAY.has(e.phase)) return;
    if (timing.active) timing.cancel();
    else if (kit.modalKind() === 'minigame') kit.escape();
  });
  // lizards handled or spotted this session: a new season (state:reset) takes their
  // dots, packs and sightings off, and the crocodiles can be spotted again
  const handled = new Set();
  events.on('state:reset', () => {
    for (const lz of handled) { lz.tag = null; lz.setBackpack(null); }
    handled.clear();
    spotter.forget();
  });

  const playing = () => PLAY.has(state.phase) && !(game.story && game.story.cutscene);
  const uiBusy = () => kit.busy() || !playing();
  const speciesRec = (sp) => state.species[sp] || state.species[SHORT[sp]] || null;

  // the opening: only the practice lizard can be caught (spotting works on all)
  const practice = { lizard: null, start: practiceStart, stop: practiceStop, auto: practiceAuto };
  const catchable = (lz) => state.phase !== 'setup' || lz === practice.lizard;
  let notTodayT = -9;
  function onSnug(lz, info) {
    if (catchable(lz)) return startCatch(lz, info, lz === practice.lizard ? { practice: true } : {});
    if (game.time - notTodayT > 4) {
      notTodayT = game.time;
      kit.toast('James: Save the catching for survey day! Hold the aim on it to spot it instead.', { icon: 'loop_pole', tone: 'info' });
    }
    return null;
  }
  // lock-on unless the pause card's "Precise aiming" is on (?precise=1 for checks)
  const loopPole = new LoopPole(game, {
    onSnug, hint: kit.hint, canCatch: catchable,
    precise: preciseAiming,
    spotted: (lz) => !!(lz.tag && typeof lz.tag === 'object' && lz.tag.spottedDay === dayKey()),
    crocSpotted: (c) => spotter.crocSpotted(c),
    // the opening's hints leave out the other lizards out of reach (Tab)
    quiet: () => state.phase === 'setup',
  });
  const timing = new SnugTiming(game);
  const spotter = new Spotter(game, { onSpot, onCroc, dayKey });

  // How blocked a view is, for the aim camera's choice of shoulder: bushes, trunks and
  // low foliage along the near 80 % of the line from the camera spot to the target
  // (what is near the lens fills more of the frame, so it counts double), and above
  // all whether the lizard being aimed at can be seen from there at all (a lizard on
  // bark can be round the curve of its trunk from one shoulder).
  if (game.rig) {
    const col = game.collision, T = game.data.terrain;
    const ray = new THREE.Ray(), head = new THREE.Vector3();
    game.rig.clearance = (cx, cy, cz, tx, ty, tz) => {
      let s = 0;
      const lz = loopPole.hold || loopPole.framed || loopPole.lock;
      if (lz && lz.visible && game.lizards) {
        lz.headPosition(head);
        ray.origin.set(cx, cy, cz);
        ray.direction.copy(head).sub(ray.origin);
        const dd = ray.direction.length();
        if (dd > 1e-3) {
          ray.direction.multiplyScalar(1 / dd);
          const hit = game.lizards.pick(ray, dd + 0.5);
          if (!hit || hit.lizard !== lz) s += 8;
          else if (loopPole.leavesBetween(lz, cx, cy, cz)) s += 6; // in the leaves from here
        }
      }
      // along the line, and to either side of its near half (a bush beside the lens
      // fills a side of the frame)
      const lx = tz - cz, lz2 = -(tx - cx), ll = Math.hypot(lx, lz2) || 1;
      for (let i = 0; i <= 6; i++) {
        const f = (i / 6) * 0.8;
        const w = i < 2 ? 2 : 1;
        for (const side of i > 0 && i < 4 ? [0, -1, 1] : [0]) {
          const off = side * (0.5 + f * 1.5) / ll;
          const x = cx + (tx - cx) * f + lx * off, y = cy + (ty - cy) * f, z = cz + (tz - cz) * f + lz2 * off;
          const g = T.heightAt(x, z), up = y - Math.max(0, g);
          const k = side ? 0.5 : 1;
          if (g > -0.05 && up < 3 && !col.isFree(x, z, 0.3)) s += w * k; // water blocks walking, not the view
          const c = T.canopyAt(x, z);
          if (c < 6 && c > up - 0.3) s += 0.5 * w * k;
        }
      }
      return s;
    };
  }

  // ---------------------------------------------------------------- the tool

  // Near a lizard: beyond the pole's reach the hint teaches creeping (and freezing while
  // it watches); within reach, raising the loop pole.
  const offer = { score: 0.35, prompt: '', run: null, why: '' };
  const visible = (lz) => lz.visible;
  const REACH_HINT = CATCH.reach.out + 0.3;
  registerTool({
    id: 'loop_pole', name: 'Loop pole', icon: 'loop_pole', key: 1, pose: 'pole', order: 1,
    suggestFor(ctx) {
      if (loopPole.aiming || flow.busy || !game.lizards) return null;
      const pl = game.player, p = pl.position;
      // in the opening, only the practice lizard (from a little further off)
      const lz = state.phase === 'setup' ? practice.lizard : game.lizards.nearest(p, 5.5, visible);
      if (!lz || !lz.visible || !catchable(lz)) return null;
      const d = Math.hypot(lz.pos.x - p.x, lz.pos.z - p.z);
      if (d > (state.phase === 'setup' ? 9 : 5.5)) return null;
      if (d > REACH_HINT) {
        offer.prompt = pl.mode !== 'creep' ? 'Hold [Ctrl] to creep closer'
          : lz.state === 'alert' ? 'It\'s watching you. Freeze till it relaxes!' : 'Nice and slow. Creep a little closer';
      } else {
        offer.prompt = 'Hold [F] or right mouse to raise the loop pole';
      }
      offer.why = 'to catch the ' + common(lz.species);
      return offer;
    },
  });

  // Walking up on a lizard makes it bolt: say why, twice a day at most.
  let fleeToasts = 0, fleeDay = -1;
  events.on('lizard:flee', (lz) => {
    if (state.phase !== 'survey' || flow.busy || !lz || !lz.pos) return;
    const pl = game.player;
    if (pl.mode !== 'walk' && pl.mode !== 'jog') return;
    // not while the player is at a ready perch logger: the walk is for the download
    const perch = game.tools && game.tools.perch;
    if (perch && perch.visiting && perch.visiting()) return;
    // only a lizard the player was heading for (within about 30 degrees), not one flushed
    // beside the path on the way to a logger or a flag
    const dx = lz.pos.x - pl.position.x, dz = lz.pos.z - pl.position.z, d = Math.hypot(dx, dz);
    if (d > 5 || d < 0.01 || (-Math.sin(pl.heading) * dx - Math.cos(pl.heading) * dz) / d < 0.87) return;
    if (fleeDay !== dayKey()) { fleeDay = dayKey(); fleeToasts = 0; }
    if (fleeToasts >= 2) return;
    fleeToasts++;
    kit.toast('Too quick! Hold [Ctrl] to creep up on them, and freeze if one looks at you.', { icon: 'lizard', tone: 'warn', ms: 4200 });
  });

  // ---------------------------------------------------------------- spotting

  function onSpot(lz) {
    // the opening's practice anole is one to catch, not to count (and the practice's
    // words are James's)
    if (state.phase === 'setup' && lz === practice.lizard) return;
    const height = perchHeight(lz);
    const surface = lz.surface;
    const onLeaves = surface === 'leaf' || lz.perch === 'leaf' || lz.perch === 'palm_frond';
    const payload = { lizard: lz, species: lz.species, key: SHORT[lz.species], perch: lz.perch, surface, height, onLeaves, canopy: height >= 2.5 };
    const rec = speciesRec(lz.species);
    const firstEver = rec ? rec.spotted === 0 : false;
    handled.add(lz);
    events.emit('lizard:spotted', payload);
    if (state.phase === 'survey') addScore(CATCH_POINTS.spot, 'spot');
    kit.toast(`Spotted: *${common(lz.species)}*` + (firstEver ? ' (new to your notebook!)' : ''), { icon: 'eye', tone: firstEver ? 'gold' : 'info' });
  }

  function onCroc(c) {
    const p = game.player.position;
    c.headPosition(tmp);
    const distance = Math.hypot(tmp.x - p.x, tmp.z - p.z);
    events.emit('croc:spotted', { croc: c, distance: Math.round(distance), safe: distance >= CATCH.spot.crocSafe });
    if (state.phase === 'survey') addScore(CATCH_POINTS.spotCroc, 'croc spotted');
    kit.toast('Spotted: *American crocodile*. Keep your distance!', { icon: 'croc', tone: 'gold' });
  }

  // ---------------------------------------------------------------- the catch

  const tmp = new THREE.Vector3();
  const hand = new THREE.Vector3();
  let whiffT = 0;
  events.on('pole:whiff', (e) => {
    if (game.time - whiffT < 3) return;
    whiffT = game.time;
    if (e.why === 'high') kit.toast('Too high for the pole! Keep aiming at it to spot it instead.', { icon: 'loop_pole', tone: 'info' });
    else if (e.why === 'far') kit.toast('Just out of reach. Creep a little closer.', { icon: 'loop_pole', tone: 'info' });
    else if (e.why === 'behind') kit.toast('The trunk is in the way! Circle round to its side.', { icon: 'loop_pole', tone: 'info' });
    else if (e.why === 'aim') kit.toast('Swish! Get the loop right over its head first.', { icon: 'loop_pole', tone: 'info' });
    else if (e.why === 'spot') kit.toast('James: Save the catching for survey day! Hold the aim on it to spot it instead.', { icon: 'loop_pole', tone: 'info' });
    else if (e.why === 'turn') kit.toast('Turn round to face it first.', { icon: 'loop_pole', tone: 'info' });
    else if (e.why === 'hidden') kit.toast('Too much in the way! Step round for a clear view.', { icon: 'loop_pole', tone: 'info' });
    else if (e.why === 'croc' || e.why === 'crocClose') kit.toast('Not with the loop pole! Just spot it from a safe distance.', { icon: 'croc', tone: 'warn' });
  });
  let bopT = -9;
  events.on('pole:bop', () => {
    if (game.time - bopT < 4) return;
    bopT = game.time;
    kit.toast('Bonk! Too quick with the loop. Slow and gentle wins.', { icon: 'loop_pole', tone: 'warn' });
  });

  function timingSpec(lz, { wasAlert, creep, display, recapture, practice: prac }) {
    const T = CATCH.timing;
    const base = T.species[lz.species] || T.species.cristatellus;
    let band = base.band;
    if (wasAlert) band *= T.alert; else if (creep) band *= T.unaware;
    if (display) band *= T.display;
    if (recapture) band *= T.recapture;
    if (prac) band *= T.practice;
    return { time: base.time, band, rounds: base.rounds, second: base.second, slip: !!base.slip && !prac };
  }

  // Holds the player and the croc for the whole catch; the kit's own hold nests inside.
  let held = null;
  function holdWorld(on) {
    const pl = game.player, cr = game.croc;
    if (on && !held) {
      held = { croc: cr && 'enabled' in cr ? cr.enabled : null };
      pl.hold('catch', true);
      if (cr && 'enabled' in cr) cr.enabled = false;
    } else if (!on && held) {
      pl.hold('catch', false);
      if (cr && held.croc !== null) cr.enabled = held.croc;
      held = null;
    }
  }

  async function startCatch(lz, info = {}, opts = {}) {
    if (flow.busy || !lz) return null;
    flow.busy = true;
    flow.lizard = lz;
    try {
      return await catchFlow(lz, info, opts);
    } catch (e) {
      recordError(e, 'catch');
      return null;
    } finally {
      loopPole.letGo();
      if (timing.active) timing.cancel();
      holdWorld(false);
      holdClock('catch', false);
      flow.busy = false;
      flow.lizard = null;
      flow.step = null;
    }
  }

  async function catchFlow(lz, info, opts) {
    const pl = game.player;
    const prac = !!opts.practice;
    const display = info.display !== undefined ? info.display : lz.display;
    const wasAlert = (info.state || lz.state) === 'alert';
    const last = alertAt.has(lz) ? alertAt.get(lz) : -1e9;
    const creep = !wasAlert && game.time - last > CATCH.creepWindow;
    if (!lz.tag || typeof lz.tag !== 'object') lz.tag = {};
    handled.add(lz);
    const tag = lz.tag;
    if (!tag.trueSvl) tag.trueSvl = trueSvl(lz);
    const day = dayKey();
    const recapture = !prac && tag.caughtDay === day;
    // what the player saw, before the loop lifts it off its perch
    const seen = perchSeen(lz), surface = lz.surface;
    const taped = tag.tapeDay === day && Number.isFinite(tag.tapeHeight);
    const height = taped ? tag.tapeHeight : perchHeight(lz);

    holdWorld(true);
    loopPole.holdOn(lz);
    lz.freeze();
    kit.hint(null);
    flow.step = 'timing';
    const spec = timingSpec(lz, { wasAlert, creep, display, recapture, practice: prac });
    spec.auto = opts.auto ? (opts.quality || 'good') : null;
    spec.holdAt = opts.stopAt === 'timing';
    let res = await timing.start(lz, spec);

    // a very rare lizard forgives one miss a day: the loop slips and the round goes again
    if (!res.success && !res.cancelled && spec.slip && tag.slipDay !== day) {
      tag.slipDay = day;
      await loopPole.snap(false);
      const left = Math.max(1, (spec.rounds || 1) - Math.max(0, (res.rounds || 1) - 1));
      const again = { ...spec, rounds: left, word: 'It\'s slipping! Again!' };
      if (left < (spec.rounds || 1)) { again.time = spec.time * (spec.second || 1); again.second = 1; }
      res = await timing.start(lz, again);
      res.perfect = false;
    }

    if (res.cancelled) { // left the field mid-snug (back to the title): it simply stays put
      loopPole.letGo();
      lz.unfreeze();
      return { success: false, cancelled: true };
    }
    if (!res.success) {
      await loopPole.snap(false);
      loopPole.letGo();
      lz.unfreeze();
      if (prac) {
        kit.toast(pick(MISS.practice), { icon: 'loop_pole', tone: 'info', ms: 3600 });
        return { success: false, practice: true };
      }
      lz.bolt(pl.position.x, pl.position.z);
      const line = lz.species === 'equestris' && Math.random() < 0.7 ? pick(MISS.knight) : pick(res.early ? MISS.early : MISS.late);
      kit.toast(line.replace('{common}', common(lz.species)) + ' ' + pick(MISS.after), { icon: 'lizard', tone: 'warn', ms: 3600 });
      events.emit('lizard:escaped', { lizard: lz, why: res.early ? 'early' : 'late' });
      return { success: false, early: res.early };
    }

    // the snap: the loop draws tight and the pole lifts it off its perch
    await loopPole.snap(true);
    lz.capture();
    loopPole.letGo();
    // the cards take no time off the day
    holdClock('catch', true);

    const key = SHORT[lz.species];
    const rec = speciesRec(lz.species);
    const first = !prac && rec ? rec.caught === 0 : false;
    const chips = [];
    let points = 0;
    if (prac) {
      // (the card and James say the rest)
      chips.push(['Practice catch', 'info'], ['No points today', 'info']);
    } else if (recapture) {
      points = CATCH_POINTS.recapture;
      chips.push(['Already has today\'s dot', 'info'], [`+${points}`, 'gold']);
      events.emit('lizard:recaptured', { lizard: lz });
      addScore(points, 'recapture');
      kit.toast(`A recapture! This ${common(lz.species)} already has today's paint dot.`, { icon: 'bag', tone: 'info' });
    } else {
      const cp = catchPoints(key, { alerted: !creep, display, first, today: state.today.caught[key] || 0 });
      points = cp.total;
      const words = { common: 'common', uncommon: 'uncommon', rare: 'rare', 'very rare': 'very rare', creep: 'crept up', display: DISPLAY_WORD[display] || 'mid display', first: 'first one!' };
      for (const p of cp.parts) {
        const word = (words[p.reason] || p.reason) + (p.repeat ? ', again today' : '');
        chips.push([`${word} +${p.points}`, p.reason === 'creep' || p.reason === 'display' || p.reason === 'first' ? 'gold' : 'good']);
      }
      if (res.perfect) { points += CATCH_POINTS.perfect; chips.push([`perfect snug +${CATCH_POINTS.perfect}`, 'gold']); }
      if (taped) { points += CATCH_POINTS.tape; chips.push([`perch taped +${CATCH_POINTS.tape}`, 'good']); }
      tag.caughtDay = day;
      tag.caught = (tag.caught || 0) + 1;
      // a lizard in the hand has been seen, too (quietly: no toast, no points)
      if (tag.spottedDay !== day) {
        tag.spottedDay = day;
        events.emit('lizard:spotted', { lizard: lz, species: lz.species, key, perch: lz.perch, surface, height, onLeaves: surface === 'leaf' || lz.perch === 'leaf' || lz.perch === 'palm_frond', canopy: height >= 2.5, quiet: true });
      }
      events.emit('lizard:caught', {
        lizard: lz, species: lz.species, key, points,
        bonus: { creep, display: display || null, first, perfect: !!res.perfect },
        perch: lz.perch, seen, surface, height, taped,
      });
      addScore(points, 'catch');
      kit.toast(`Gotcha! A ${sexWord(lz.sex)} *${common(lz.species)}*`, { icon: 'lizard', tone: 'good' });
      // (a first of its kind shows as the bag card's "first one!" chip, not a stamp)
      if (display) kit.stamp(DISPLAY_STAMP[display], { tone: 'gold', icon: 'star' });
    }
    if (tag.tracked) chips.push(['Wearing its backpack', 'info']);

    // the release cards
    const packsLeft = state.inventory.backpacks;
    const big = tag.trueSvl >= (CATCH.svl[lz.species] || CATCH.svl.cristatellus).pack;
    const c = {
      sp: lz.species, sex: lz.sex, perch: lz.perch, perchSeen: seen, height, taped, svl: tag.trueSvl, display,
      chips, mark: tag.mark || MARKS[state.days % MARKS.length], packColour: tag.packColour || nextBackpackColour(),
      packsLeft, canPack: !prac && ((big && packsLeft > 0) || opts.stopAt === 'backpack'), tracked: tag.tracked || null,
      recapture, practice: prac, auto: null, nickname: tag.nickname || null,
      // the third of a species today on: the bag card moves on by itself
      quick: !prac && !recapture && (state.today.caught[key] || 0) >= 3,
    };
    const autoFor = (name) => (opts.stopAt === name ? null : opts.auto || opts.stopAt ? 'fast' : null);
    const cards = { minigame: (spec) => { flow.step = spec.name; c.auto = autoFor(spec.name); return kit.minigame(spec); } };
    const out = await runRelease(c, cards, {
      measured(svl, r) {
        events.emit('lizard:measured', { lizard: lz, svl });
        tag.svl = svl;
        if (r.off <= CATCH.ruler.spotOn) addScore(CATCH_POINTS.spotOn, 'measured');
        if (!big && packsLeft > 0) kit.toast('A bit small for a backpack, this one.', { icon: 'backpack', tone: 'info' });
      },
      marked(q) {
        tag.mark = c.mark;
        events.emit('lizard:marked', { lizard: lz, colour: c.mark, quality: q });
      },
      tagged() {
        lz.setBackpack(c.packColour);
        tag.packColour = c.packColour;
        const n = state.tracked.length;
        events.emit('lizard:tagged', { lizard: lz, colour: c.packColour, svl: tag.svl || tag.trueSvl, height });
        const entry = state.tracked.find((t) => t.lizard === lz) || null;
        const nickname = NICKNAMES[n % NICKNAMES.length];
        tag.nickname = nickname;
        if (entry) {
          entry.nickname = nickname;
          if (!entry.trail) entry.trail = [];
          if (!entry.fixes) entry.fixes = [];
          // the first fix, at its perch, goes on the map straight away
          const g = CATCH.track.grid;
          if (lz.home) entry.trail.push([Math.round(lz.home.x / g) * g, Math.round(lz.home.z / g) * g]);
        }
        addScore(CATCH_POINTS.backpack, 'backpack');
        kit.toast(`Backpack fitted! Say hello to *${nickname}*. Download its GPS later with the case [4].`, { icon: 'backpack', tone: 'gold', ms: 4200 });
        return { id: entry ? entry.id : 'GPS', nickname };
      },
      noted(right) {
        if (right) addScore(CATCH_POINTS.perch, 'notes');
      },
    });

    // back onto its perch: it runs home from the player's hands
    flow.step = 'release';
    holdClock('catch', false);
    const h = pl.heading;
    hand.set(pl.position.x - Math.sin(h) * 0.45, pl.position.y + 0.1, pl.position.z - Math.cos(h) * 0.45);
    lz.release(hand.x, hand.y, hand.z);
    if (prac) {
      events.emit('practice:done', { lizard: lz });
      kit.toast('Off it goes, back to its perch. Lovely!', { icon: 'heart', tone: 'good' });
      return { success: true, practice: true, points: 0, ...out };
    }
    events.emit('lizard:released', { lizard: lz });
    const where = lz.perch === 'ground' ? 'spot on the ground' : PERCH_WORDS[lz.perch] || 'perch';
    kit.toast(out.skipped ? `Let go. Back to its ${where} it runs!` : `All done! Back to its ${where} it goes.`, { icon: 'heart', tone: 'good' });
    return { success: true, points, ...out };
  }

  // ---------------------------------------------------------------- the practice catch

  // The opening's practice: spawn `index` (src/story/practice.js picks one on a trunk
  // by a path, in the open, facing the way the player comes), or failing that the nearest
  // crested anole the pole can reach, kept awake and calm until it has been caught once:
  // it may stop and watch the player, but only running at it makes it bolt.
  function practiceStart(index = null) {
    if (practice.lizard) return practice.lizard;
    const L = game.lizards;
    if (!L || !L.pin) return null;
    const i = index != null ? index : findTarget('cristatellus');
    if (i == null) return null;
    const lz = L.pin(i);
    if (!lz || !lz.handle) { L.unpin(); return null; }
    lz.tame = false;
    lz.calm = CATCH.practiceCalm;
    practice.lizard = lz;
    return lz;
  }
  // For scripted play (game.play.auto): stand by it and catch it with a perfect snug.
  async function practiceAuto() {
    const lz = practice.lizard;
    if (!lz || flow.busy) return null;
    if (standSpot(lz, spot)) game.player.teleport(spot.x, spot.z, Math.atan2(-(lz.home.x - spot.x), -(lz.home.z - spot.z)));
    equip('loop_pole', { instant: true, silent: true });
    await new Promise((r) => setTimeout(r, 300));
    return startCatch(lz, { display: null, state: 'idle' }, { practice: true, auto: true, quality: 'perfect' });
  }
  function practiceStop() {
    const lz = practice.lizard;
    practice.lizard = null;
    if (lz) { lz.tame = false; lz.calm = 0; }
    if (game.lizards && game.lizards.unpin) game.lizards.unpin();
  }

  // The survey day's first lizard (flow.js, for a new player): the nearest reachable
  // one of a species within maxDist (that accept(home) likes, if any does; accept may be
  // a list of tests tried in turn), kept active (pinned) until pointOut(null). It is not
  // tamed: creeping up on it is the lesson.
  let pointed = null;
  function pointOut(sp, maxDist = 26, accept = null) {
    const L = game.lizards;
    if (!sp) {
      if (pointed && L && L.unpin && !practice.lizard) L.unpin();
      pointed = null;
      return null;
    }
    if (!L || !L.pin || practice.lizard) return null;
    let i = null;
    for (const a of Array.isArray(accept) ? accept : accept ? [accept] : []) {
      i = findTarget(sp, maxDist, a);
      if (i != null) break;
    }
    if (i == null) i = findTarget(sp, maxDist);
    if (i == null) return null;
    const lz = L.pin(i);
    if (!lz || !lz.handle) { L.unpin(); return null; }
    pointed = lz;
    return lz;
  }

  // ---------------------------------------------------------------- GPS downloads

  // Moves a tracked lizard's logged fixes onto the map; returns how many.
  function download(entry) {
    if (!entry || !Array.isArray(entry.fixes)) return 0;
    const n = entry.fixes.length;
    if (!Array.isArray(entry.trail)) entry.trail = [];
    for (const f of entry.fixes) entry.trail.push(f);
    entry.fixes.length = 0;
    const keep = CATCH.track.keep;
    if (entry.trail.length > keep) entry.trail.splice(0, entry.trail.length - keep);
    return n;
  }

  // ---------------------------------------------------------------- kit cards on their own

  const demo = (arg) => {
    const sp = LONG[arg] || (SPECIES_NAMES[arg] ? arg : 'cristatellus');
    const c = standIn(sp);
    c.chips = [['crept up +15', 'gold'], ['common +10', 'good']];
    return c;
  };
  kit.registerMinigame('bag', (arg) => bagCard(demo(arg)));
  kit.registerMinigame('ruler', (arg) => rulerCard(demo(arg)));
  kit.registerMinigame('paint', (arg) => paintCard(demo(arg)));
  kit.registerMinigame('backpack', (arg) => { const c = demo(arg); c.mark = MARKS[0]; return packCard(c); });
  kit.registerMinigame('perch', (arg) => { const c = demo(arg); c.measured = c.svl; return perchCard(c); });

  // ---------------------------------------------------------------- per frame

  let fixT = 0;
  function gpsFixes(dt) {
    if (state.phase !== 'survey') return;
    fixT -= dt;
    if (fixT > 0) return;
    fixT = CATCH.track.fix;
    const grid = CATCH.track.grid, hours = state.clock.hours;
    for (const tr of state.tracked) {
      const lz = tr.lizard;
      if (!lz || !lz.pos) continue;
      if (!Array.isArray(tr.fixes)) tr.fixes = [];
      const w = WANDER[lz.species] || 2, s = (lz.index % 97) * 0.37;
      const x = lz.pos.x + w * (0.6 * Math.sin(hours * 1.3 + s) + 0.4 * Math.sin(hours * 3.1 + s * 2));
      const z = lz.pos.z + w * (0.6 * Math.cos(hours * 1.1 + s * 1.7) + 0.4 * Math.sin(hours * 2.3 + s));
      const gx = Math.round(x / grid) * grid, gz = Math.round(z / grid) * grid;
      // the last fix logged, or the last one on the map when nothing is waiting
      const list = tr.fixes.length ? tr.fixes : tr.trail || tr.fixes;
      const lastFix = list[list.length - 1];
      if (lastFix && lastFix[0] === gx && lastFix[1] === gz) continue;
      tr.fixes.push([gx, gz]);
      if (tr.fixes.length > CATCH.track.keep) tr.fixes.shift();
    }
  }

  // Carrying the pole out makes lizards a little warier: their habit (the flight
  // distance factor that drops as they get used to you) is raised while you move
  // with it, for lizards not already made bolder by watching you.
  function poleWary() {
    const L = game.lizards;
    if (!L) return;
    const pl = game.player;
    const out = current() === 'loop_pole' && playing() && !flow.busy;
    const k = !out ? 1 : pl.mode === 'walk' || pl.mode === 'jog' ? CATCH.poleWary.walk : pl.mode === 'creep' && pl.speed > 0.1 ? CATCH.poleWary.creep : 1;
    for (const lz of L.all) if (lz.habit >= 0.999 && lz.habit !== k) lz.habit = k;
  }

  const flagRun = setupFlag();

  // While aiming, the vegetation cut-out runs from the camera towards the lizard (it
  // ran to the player's head), a little wider, and stopping 1.4 m short of it so its
  // own perch stays whole (the capsule narrows to 0.55 of its radius at the end).
  // The vegetation's update ran earlier this frame; this only moves the capsule.
  const _cutEnd = new THREE.Vector3();
  const AIM_CUT = { radius: 2.2, short: 1.4 };
  function aimCut() {
    const rig = game.rig;
    if (!rig || !rig.aimPoint || rig.aimK < 0.3 || vegUniforms.uVegCut.value <= 0) return;
    const c = vegUniforms.uVegCam.value;
    _cutEnd.copy(rig.aimPoint).sub(c);
    const d = _cutEnd.length();
    if (d < AIM_CUT.short + 0.5) return;
    _cutEnd.multiplyScalar((d - AIM_CUT.short) / d).add(c);
    // blend from the head to the lizard as the aim framing eases in
    const k = Math.min(1, (rig.aimK - 0.3) / 0.5);
    vegUniforms.uVegFocus.value.lerp(_cutEnd, k);
    const r = vegUniforms.uVegCut.value;
    vegUniforms.uVegCut.value = r + (AIM_CUT.radius - r) * k;
  }

  const poleCtx = { equipped: false, busy: false };
  let framed = false;
  function update(dt, t) {
    poleCtx.equipped = current() === 'loop_pole';
    poleCtx.busy = uiBusy() || (flow.busy && !loopPole.hold);
    loopPole.update(dt, t, poleCtx);
    // the camera stays on the catch while the cards are up, then eases back
    const rig = game.rig;
    if (rig && flow.busy) { rig.aim = 1; rig.aimPoint = loopPole.framePoint; framed = true; }
    else if (rig && framed) { framed = false; if (!loopPole.aiming) { rig.aim = 0; rig.aimPoint = null; } }
    aimCut();
    if (!kit.busy()) timing.update(dt); // a panel opened over the snug pauses it
    const canSpot = playing() && !kit.busy() && !flow.busy && !game.player.pushed && (game.input.down('aim') || flagRun.spot);
    // the crocodile is looked for along the lock-on's ray when the prompt is on it
    spotter.update(dt, loopPole.spotRay(), canSpot, loopPole.leadWhy === 'croc' || loopPole.leadWhy === 'crocClose' ? loopPole.spotRay() : loopPole.pointerRay());
    poleWary();
    gpsFixes(dt);
    flagRun.update(dt);
  }

  // ---------------------------------------------------------------- ?catch=

  // A free spot about 1.5 m from a lizard's perch, facing it, from which the pole
  // reaches it: towards the side it faces where there is room, else any side.
  function standSpot(lz, out) {
    const col = game.collision, hm = lz.home, p = game.player.position, T = game.data.terrain;
    let px = hm.nx, pz = hm.nz;
    if (Math.hypot(px, pz) < 0.3) { px = p.x - hm.x; pz = p.z - hm.z; }
    const pa = Math.atan2(pz, px);
    const onBark = Math.hypot(hm.nx, hm.nz) > 0.3;
    let best = Infinity;
    for (const d of [1.5, 1.8, 1.25, 2.1]) {
      for (let k = 0; k < 16; k++) {
        const a = pa + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 8);
        // on a trunk, only from the side it faces (the pole cannot go through the wood)
        if (onBark && Math.ceil(k / 2) > 4) continue;
        const x = hm.x + Math.cos(a) * d, z = hm.z + Math.sin(a) * d;
        if (!col.isFree(x, z) || !col.roomy(x, z)) continue;
        // clear ground most of the way in
        let clear = true;
        for (const f of [0.35, 0.6]) if (!col.isFree(hm.x + (x - hm.x) * (1 - f * 0.5), hm.z + (z - hm.z) * (1 - f * 0.5), 0.12)) clear = false;
        const ground = col.supportHeight(x, z);
        if (hm.y - ground > 2.4) continue;
        // room behind and to the right for the camera
        const ux = (x - hm.x) / d, uz = (z - hm.z) / d;
        let open = 0;
        for (const [b, r] of [[1.6, 0.5], [3, 0.9], [4.4, 1.2]]) {
          const cx = x + ux * b - uz * r, cz = z + uz * b + ux * r;
          if (col.isFree(cx, cz, 0.25)) open++;
          if (T.canopyAt(cx, cz) < 1.2) open++;
        }
        const s = Math.ceil(k / 2) * 0.5 + Math.abs(d - 1.5) * 2 + (clear ? 0 : 3) + (6 - open) * 1.5;
        if (s < best) { best = s; out.x = x; out.z = z; out.score = s; }
      }
      if (best < 1.5) break;
    }
    return best < Infinity;
  }

  const spot = { x: 0, z: 0, score: 0 };
  // The spawn of a species the pole can reach (0.7 to 2 m up, or on the ground) with
  // room to stand, near the player (within maxDist when given, and accept(home) true).
  function findTarget(sp, maxDist = Infinity, accept = null) {
    const L = game.lizards;
    if (!L || !L.lizard) return null;
    const p = game.player.position;
    const cand = [];
    for (let i = 0; i < L.spawnCount; i++) {
      const lz = L.lizard(i);
      if (!lz || lz.species !== sp || lz.captured) continue;
      const hm = lz.home;
      if (!hm || hm.skip || hm.snapped === false) continue;
      const ground = Math.max(0, game.data.terrain.heightAt(hm.x, hm.z));
      const up = hm.y - ground;
      if (up > 2.0 || (up < 0.7 && lz.perch !== 'ground')) continue;
      const d = Math.hypot(hm.x - p.x, hm.z - p.z);
      if (d > maxDist) continue;
      cand.push([d + (lz.sex === 'm' ? 0 : 4), i]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    // of the nearest few, the one with the most room round the place to stand
    let best = null, bs = Infinity;
    for (const [d, i] of cand.slice(0, 24)) {
      if (!standSpot(L.lizard(i), spot)) continue;
      if (accept && !accept(L.lizard(i).home)) continue;
      const s = d * 0.25 + spot.score;
      if (s < bs) { bs = s; best = i; }
    }
    return best;
  }

  // Wakes spawn i's lizard and stands the player next to it, facing it.
  function goTo(i) {
    const lz = game.lizards.pin(i);
    if (!lz || !lz.handle) return null;
    lz.tame = true;
    standSpot(lz, spot);
    const hm = lz.home;
    game.player.teleport(spot.x, spot.z, Math.atan2(-(hm.x - spot.x), -(hm.z - spot.z)));
    equip('loop_pole', { instant: true, silent: true });
    return lz;
  }

  function setupFlag() {
    const want = GAME_FLAGS.catch;
    const stepArg = params.get('catchstep') || 'aim';
    const run = { spot: false, update() {} };
    if (!want) return run;
    const sp = LONG[want] || (SPECIES_NAMES[want] ? want : null);
    if (!sp) return run;
    let phaseT = 0, stage = 'wait', lz = null, t = 0;
    run.update = (dt) => {
      t += dt;
      if (stage === 'wait') {
        if (!playing() || kit.busy() || !game.lizards) return;
        phaseT += dt;
        if (phaseT < 0.6) return;
        const i = findTarget(sp);
        if (i == null) { stage = 'none'; console.warn('?catch: no reachable ' + sp); return; }
        lz = goTo(i);
        if (!lz) { stage = 'none'; console.warn('?catch: could not wake the ' + sp); return; }
        loopPole.forceLock = lz;
        stage = 'aim';
        t = 0;
        return;
      }
      if (stage === 'aim') {
        loopPole.forceAim = true;
        if (t > 1.6 && stepArg !== 'aim') {
          stage = 'catch';
          const auto = stepArg === 'auto';
          startCatch(lz, { display: null, state: 'idle' }, { auto: auto || stepArg !== 'timing', quality: 'perfect', stopAt: auto ? null : stepArg }).then(() => { lz.tame = false; });
        }
        return;
      }
      if (stage === 'catch' && !flow.busy) { loopPole.forceAim = false; loopPole.forceLock = null; stage = 'done'; }
    };
    return run;
  }

  // ---------------------------------------------------------------- scripted play

  const play = {
    // Catches the nearest reachable lizard of a species (teleporting next to it); quality
    // 'perfect' | 'good' | 'early' | 'late'. Resolves with the catch's result.
    async catchNearest(species, quality = 'good') {
      const sp = LONG[species] || species;
      const i = findTarget(sp);
      if (i == null) return null;
      const lz = goTo(i);
      if (!lz) return null;
      const r = await startCatch(lz, { display: null, state: 'idle' }, { auto: true, quality });
      lz.tame = false;
      game.lizards.unpin();
      return r;
    },
    // Stands the player by the nearest reachable lizard of a species; returns it.
    goTo(species) {
      const i = findTarget(LONG[species] || species);
      return i == null ? null : goTo(i);
    },
    aim(on = true) { loopPole.forceAim = !!on; },
    lock(lz) { loopPole.forceLock = lz || null; },
    get busy() { return flow.busy; },
  };

  game.play = Object.assign(game.play || {}, { catch: play });

  return {
    group: loopPole.group,
    update,
    loopPole, timing, spotter, play, practice, download,
    startCatch, pointOut,
    get busy() { return flow.busy; },
    get step() { return flow.step; },
    get stats() {
      return { ...loopPole.stats, busy: flow.busy, step: flow.step, spotting: spotter.name, timing: timing.active };
    },
  };
}

function sexWord(sex) { return sex === 'm' ? 'male' : sex === 'f' ? 'female' : ''; }
