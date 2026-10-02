// Floss loops that snap and loop poles that break, on the survey day only (built by
// catching.js, kept as game.catching.breaks). The odds and timings are RULES.breaks.
//
// Loop snaps. A missed snug (too early or too late) or a bop (Precise aiming: the loop
// swung into a face) may snap the floss loop, more often on a knight anole, which bites
// floss; never in the opening. It goes where it is seen: the loop's halves whip off the
// tip with a small white burst (snap_fx.js), the pole kicks back (avatar.aim.recoil), the
// snap sounds and a toast says so, and the pole stays in hand for SETTLE_S seconds before
// it comes down. The tool badge reads "Loop snapped" (hud.js) until it is re-tied.
// The pole cannot loop again until the loop is re-tied with
// the opening's floss card ([E] with the pole in hand). Another system may do the re-tie
// instead: loop:snap carries claim(), and whoever claims it calls retie(by) when done
// (handBack() gives it back to the player; so does a claim left for CLAIM_S seconds, and
// the player is then told to re-tie it).
//
// Pole breaks. A miss on a lizard high in the branches or leaves may tangle the pole and
// break it (canopy: no penalty). With the pole raised, jogging into a trunk or the field
// station or driving the loop into the ground in Precise aiming is a stub: the day's first only
// warns, after that each may break the pole in half (careless: RULES.points.carelessBreak,
// which state.js takes off the day). The first break of the season, of any kind, is free:
// James says so over the radio and a new pole is in your hands. After that the loop pole
// is out of the ring until James hands over a new one at the station (flow.js calls
// replace()). Without a pole you can still walk, spot and use the other tools.
//
// Nothing goes without a tell: the loop frays or the pole creaks and wobbles for
// RULES.breaks.tell seconds first. Putting the pole away during a creak saves it.
// A claimed re-tie's CLAIM_S seconds do not run while a talk or a card is up.
//
// Events (on game.events):
//   loop:fray { lizard }                the tell before a snap
//   loop:snap { first, count, lizard, species, why, claim() }  after it went; first: the
//                                       season's first; why: 'early', 'late' or 'bop'
//   loop:tied { by }                    'player' (the floss card) or retie(by)'s caller
//   pole:stub { warn }                  a stub that did not break it (warn: the day's first)
//   pole:creak { kind }                 the tell before a break: 'canopy' or 'careless'
//   pole:break { kind, free, count }    count: poles broken this season, this one included
//   pole:new { from }                   'radio' (the free one), 'james' or 'reset' (a new day)
//
// breaks: { snapped, settling (the moment after a snap, the pole still in hand), fx (the
//   snap's strands, once there has been one), noPole, onTheWay (the free pole is coming: no walk to James), kind (how
//   the last pole broke), fate(lz), tell(fate, lz), apply(fate, lz, why), retie(by),
//   handBack(), replace(), offer(), update(dt, catchBusy), stats }
// ?breakseed=n fixes the random draws (by default they follow the clock).

import { events } from '../core/events.js';
import * as kit from '../ui/kit.js';
import { state, dayKey } from '../game/state.js';
import { RULES } from '../game/rules.js';
import { SCRIPT, JAMES } from '../story/script.js';
import { flossMinigame } from '../story/floss.js';
import { current, equip, setToolFilter } from '../tools/ring.js';
import { makeRng } from '../world/models.js';
import { buildSnapFx } from './snap_fx.js';

const CLAIM_S = 6; // seconds another system has to re-tie a loop it claimed
const SETTLE_S = 0.8; // seconds the pole stays in hand after a snap
const RETIE_HOW_S = 1.4; // seconds after an unclaimed snap before the player is told to re-tie it
const STUB_GAP = 1.5; // seconds between two stubs
const LEAFY = new Set(['branch', 'leaf', 'palm_frond']);

const params = new URLSearchParams(location.search);
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));

export function buildBreaks(game, loopPole) {
  const seed = params.has('breakseed') ? Number(params.get('breakseed')) : (Date.now() & 0xffff);
  const rand = makeRng(seed);
  const S = SCRIPT.breaks;
  const T = game.data.terrain;
  const avatar = () => (game.player && game.player.avatar) || null;
  const surveying = () => state.phase === 'survey';
  const cue = (name) => { if (game.audio && game.audio.cue) game.audio.cue(name); };

  const br = {
    snapped: false, // the floss loop is off the pole
    noPole: false, // no pole in hand: broken, and the next one not here yet
    onTheWay: false, // (the free one, a moment after the break: no walk to James)
    kind: null, // how the last pole broke
    claimT: 0, // seconds left on another system's claim of the re-tie
    busy: false, // a fray or a creak is showing
    tying: false, // the floss card is open for a re-tie
    stubDay: -1, // the day of the last stub warning
    wobT: 0,
    settleT: 0,
    fx: null,
    get settling() { return br.settleT > 0; },
    get stats() { return { snapped: br.snapped, noPole: br.noPole, onTheWay: br.onTheWay, kind: br.kind, claimed: br.claimT > 0, season: { ...state.breaks } }; },
  };

  // the pole shakes in the hands, and the loop swings if it is up
  const kick = (k) => { if (loopPole.weight > 0.05) loopPole.kick = Math.max(loopPole.kick, k); };
  function wobble(sec) {
    br.wobT = sec;
    kick(1);
  }

  // ---------------------------------------------------------------- a miss

  // high in the branches or leaves, where a pole can tangle
  function inCanopy(lz) {
    const p = lz && lz.pos;
    if (!p || !(LEAFY.has(lz.surface) || LEAFY.has(lz.perch))) return false;
    return p.y - Math.max(0, T.heightAt(p.x, p.z)) >= RULES.breaks.canopyHeight - 0.05;
  }

  // What a missed snug does to the kit: null, 'snap' or 'canopy'.
  function fate(lz) {
    if (!surveying() || br.snapped || br.noPole || br.busy || !lz) return null;
    const R = RULES.breaks;
    if (inCanopy(lz) && rand() < R.canopy) return 'canopy';
    return rand() < (lz.species === 'equestris' ? R.loopKnight : R.loop) ? 'snap' : null;
  }

  // The tell, while the loop is still over the lizard.
  async function tell(f, lz) {
    br.busy = true;
    try {
      if (f === 'snap') {
        events.emit('loop:fray', { lizard: lz });
        kit.toast(S.fray, { icon: 'loop_pole', tone: 'warn' });
      } else {
        events.emit('pole:creak', { kind: 'canopy' });
        kit.toast(S.tangle, { icon: 'loop_pole', tone: 'warn' });
      }
      wobble(RULES.breaks.tell);
      await wait(RULES.breaks.tell);
    } finally {
      br.busy = false;
    }
  }

  // After the miss has played out.
  function apply(f, lz, why) {
    if (!surveying()) return;
    if (f === 'snap') snapLoop(lz, why);
    else if (f === 'canopy') breakPole('canopy');
  }

  // ---------------------------------------------------------------- the loop

  function snapLoop(lz, why) {
    if (br.snapped || br.noPole) return;
    snapN++;
    br.snapped = true;
    br.settleT = SETTLE_S;
    const av = avatar();
    if (av && av.bones && av.bones.loop) {
      if (!br.fx) br.fx = buildSnapFx(game);
      br.fx.play(av.bones.loop);
    }
    if (av && av.aim) av.aim.recoil = 1;
    if (av && av.setLoop) av.setLoop(false);
    let claimed = false;
    events.emit('loop:snap', {
      first: (state.breaks.loops || 0) === 0, count: (state.breaks.loops || 0) + 1,
      lizard: lz || null, species: lz ? lz.species : null, why,
      claim: () => { claimed = true; },
    });
    br.claimT = claimed ? CLAIM_S : 0;
    kit.toast(S.snapped, { icon: 'loop_pole', tone: 'snap', ms: 4200 });
    if (!claimed) { const n = snapN; setTimeout(() => { if (n === snapN && br.snapped && br.claimT <= 0 && !br.tying) lapse(); }, RETIE_HOW_S * 1000); }
    events.emit('hud:tool');
  }
  let snapN = 0;

  // The loop back on the pole, no card (by: who tied it).
  function retie(by = 'player') {
    if (!br.snapped) return false;
    br.snapped = false;
    br.claimT = 0;
    const av = avatar();
    if (av && av.setLoop) av.setLoop(true);
    events.emit('loop:tied', { by });
    events.emit('hud:tool');
    return true;
  }
  // the job back to the player, who is told so
  function lapse() { if (br.snapped) kit.toast(S.retieHow, { icon: 'loop_pole', tone: 'warn' }); }
  function handBack() { if (br.claimT > 0) { br.claimT = 0; lapse(); } }

  // [E] with the pole in hand: the floss card, one go a press
  async function tieByHand() {
    if (br.tying || !br.snapped || br.claimT > 0) return;
    br.tying = true;
    try {
      const r = await kit.minigame(flossMinigame());
      if (r && r.success && retie('player')) kit.toast(S.retied, { icon: 'loop_pole', tone: 'good' });
    } finally {
      br.tying = false;
    }
  }
  const tieOffer = { score: 0.9, prompt: S.retiePrompt, run: tieByHand, why: 'to loop again' };
  // the loop pole's job while its loop is off (null while someone else has the re-tie)
  const offer = () => (br.snapped && !br.tying && br.claimT <= 0 ? tieOffer : null);

  // a bop in Precise aiming may snap it too
  events.on('pole:bop', (e) => {
    const lz = e && e.lizard;
    if (!surveying() || br.snapped || br.noPole || br.busy || !lz) return;
    if (rand() >= (lz.species === 'equestris' ? RULES.breaks.loopKnight : RULES.breaks.loop)) return;
    tell('snap', lz).then(() => { if (current() === 'loop_pole') apply('snap', lz, 'bop'); });
  });

  // ---------------------------------------------------------------- the pole

  function breakPole(kind) {
    if (br.noPole) return;
    const free = (state.breaks.poles || 0) === 0;
    const av = avatar();
    const L = loopPole.weight > 0.3 ? loopPole.loop : game.player.position;
    if (game.fx && game.fx.burst) game.fx.burst(kind === 'canopy' ? 'leaves' : 'dust', L.x, L.y + 0.2, L.z, 8);
    br.kind = kind;
    br.noPole = true;
    br.onTheWay = free; // (before the pole goes down: the tool badge reads it)
    br.snapped = false;
    br.claimT = 0;
    if (av && av.setLoop) av.setLoop(true);
    if (av && av.setStowed) av.setStowed({ pole: false });
    setToolFilter((id) => id !== 'loop_pole'); // (puts the pole down)
    kit.toast(kind === 'canopy' ? S.canopyBreak : S.carelessBreak, { icon: 'loop_pole', tone: 'warn', ms: 3600 });
    events.emit('pole:break', { kind, free, count: (state.breaks.poles || 0) + 1 });
    if (free) {
      wait(1.2).then(() => {
        br.onTheWay = false;
        if (!br.noPole || !surveying()) return;
        cue('radio');
        kit.toast(`${JAMES.name}: ${S.free}`, { icon: 'cap', tone: 'gold', ms: 4200 });
        givePole('radio');
        kit.toast(S.newPole, { icon: 'loop_pole', tone: 'good' });
      });
    } else {
      kit.toast(S.goToJames, { icon: 'cap', tone: 'info', ms: 5200 });
    }
  }

  function givePole(from) {
    br.noPole = false;
    br.onTheWay = false;
    setToolFilter(null);
    const av = avatar();
    if (av && av.setStowed) av.setStowed({ pole: true });
    if (from !== 'reset') equip('loop_pole');
    events.emit('pole:new', { from });
  }

  // James hands over a new pole (flow.js, at the station)
  function replace() {
    if (!br.noPole) return false;
    givePole('james');
    kit.toast(S.newPole, { icon: 'loop_pole', tone: 'good' });
    return true;
  }

  // A stub: jogging into a trunk or the station with the pole raised, or the loop driven
  // into the ground. The day's first warns; after that it may creak and break.
  let stubT = 0;
  function stub() {
    stubT = STUB_GAP;
    cue('thunk');
    kit.toast(S.stub, { icon: 'loop_pole', tone: 'warn' });
    kick(0.6);
    if (br.stubDay !== dayKey()) {
      br.stubDay = dayKey();
      events.emit('pole:stub', { warn: true });
      return;
    }
    if (rand() >= RULES.breaks.careless) { events.emit('pole:stub', { warn: false }); return; }
    br.busy = true;
    events.emit('pole:creak', { kind: 'careless' });
    kit.toast(S.creak, { icon: 'loop_pole', tone: 'warn' });
    wobble(RULES.breaks.tell);
    wait(RULES.breaks.tell).then(() => {
      br.busy = false;
      if (surveying() && current() === 'loop_pole' && !loopPole.hold) breakPole('careless');
    });
  }

  // something hard just ahead on the way the player was running (with the pole up they
  // face where it points, not where they go): a trunk (as the vegetation draws them), or the
  // field station's table, sign and crates (the props' circles); not a bush, nor the
  // water's edge
  const prev = { x: 0, z: 0 }, way = { x: 0, z: -1 };
  function solidAhead() {
    const pl = game.player, C = game.collision;
    const x = pl.position.x + way.x * 0.5, z = pl.position.z + way.z * 0.5;
    const trunks = (game.veg && game.veg.hosts && game.veg.hosts.trunks) || [];
    for (const t of trunks) if (Math.abs(x - t.x) < 1.5 && Math.hypot(x - t.x, z - t.z) < (t.r0 || 0.1) + 0.35) return true;
    let hit = false;
    C.forEachCircleNear(x, z, (i) => {
      if (i < C.dataCount || String(C.owners[i] || '')[0] !== 'X') return;
      const dx = x - C.cx[i], dz = z - C.cz[i], r = C.cr[i] + 0.1;
      if (dx * dx + dz * dz < r * r) hit = true;
    });
    return hit;
  }

  // ---------------------------------------------------------------- per frame

  let lastSpeed = 0;
  function update(dt, catchBusy) {
    if (br.wobT > 0) br.wobT = Math.max(0, br.wobT - dt);
    if (br.settleT > 0) br.settleT = Math.max(0, br.settleT - dt);
    if (br.fx) br.fx.update(dt);
    const av = avatar();
    if (av && av.aim) { const w = br.wobT > 0 ? 1 : 0; if (av.aim.wobble !== w) av.aim.wobble = w; }
    if (br.claimT > 0 && !kit.busy()) { // (not while a talk is up)
      br.claimT -= dt;
      if (br.claimT <= 0) { br.claimT = 0; lapse(); }
    }
    if (stubT > 0) stubT = Math.max(0, stubT - dt);
    const pl = game.player;
    const was = lastSpeed;
    lastSpeed = pl.speed;
    const mx = pl.position.x - prev.x, mz = pl.position.z - prev.z, ml = Math.hypot(mx, mz);
    if (ml > 0.02 && ml < 1) { way.x = mx / ml; way.z = mz / ml; }
    prev.x = pl.position.x; prev.z = pl.position.z;
    if (!surveying() || br.noPole || br.busy || stubT > 0 || catchBusy || current() !== 'loop_pole' || kit.busy() || pl.held) return;
    const inp = game.input, m = inp.move;
    // a jog stopped dead with the stick still pushed and the pole raised
    const raised = loopPole.aiming || loopPole.weight > 0.5;
    const jogged = raised && was > 3.2 && pl.speed < 1.2 && inp.down('jog') && Math.hypot(m.x, m.y) > 0.6 && solidAhead();
    // Precise aiming: the loop swung hard along the ground
    const L = loopPole.loop;
    const grounded = loopPole.aiming && !loopPole.hold && loopPole._precise && loopPole.weight > 0.95 &&
      loopPole.loopSpeed > RULES.breaks.ground && L.y - Math.max(0, T.heightAt(L.x, L.z)) < 0.2;
    if (jogged || grounded) stub();
  }

  // a new day (or a new season, or back to the title): a whole pole and loop
  function reset() {
    if (br.snapped) { br.snapped = false; const av = avatar(); if (av && av.setLoop) av.setLoop(true); events.emit('hud:tool'); }
    br.settleT = 0;
    if (br.noPole) givePole('reset');
    br.kind = null;
    br.claimT = 0;
    br.stubDay = -1;
  }
  events.on('day:new', reset);
  events.on('state:reset', reset);
  events.on('phase:change', (e) => { if (e.phase !== 'survey' && e.phase !== 'summary') reset(); });

  return Object.assign(br, { fate, tell, apply, retie, handBack, replace, offer, update });
}
