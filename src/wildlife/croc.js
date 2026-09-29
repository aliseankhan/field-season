// Crocodiles: two American crocodiles that cruise the lake with only their eyes,
// nose, a line of snout and the scutes on their backs showing, trailing a soft V of
// wake. They keep to the player's side of the lake, and now and then one swims to a
// haul-out spot near where the player is walking (a mud islet, or the lawn at the
// water's edge, where it may block a route or guard a tree with rare lizards),
// crawls out, turns round to face the lake and basks for a minute or two, mouth open
// to cool, then belly-slides back in.
//
// A hazard, not a monster. First it quietly lifts its head and watches the player;
// then, within 4 m (further for a player on the move: 6 m walking, 8 m running), it
// hisses and shows a "!" (croc:warn). Stay within 2 m for a moment in front of its
// head, or keep coming, and it lunges with a comic SNAP (croc:snap, with
// { penalty: { seconds, points } } and the position, so lizards nearby can bolt):
// the player is pushed back a couple of metres, the camera shakes, and the croc
// settles back or slides away (croc:calm). Come at it from behind and it slides off
// into the water instead. It never leaves the water to chase, never warns a player
// on the causeway, and no part of it comes within 15 m of the start. A croc lying
// on land is solid (moving circles in Collision).
//
// build(game) returns { group, update(dt, t), stats, crocs, nearest(), ... }. Set
// haul = false to keep them afloat (the set-up day: none hauls out, one on land slides
// back in); newDay() starts a survey day (none lies across a path for the first 90 s and
// none near the start); director = true (the survey day) sends one round to where the
// player is when there has been no encounter (a croc in view within 30 m) for 2 to 3
// minutes; shake = false keeps the camera still on a snap.
//
// URL flags, for checks only:
//   ?croc=cruise|haul|bask|warn|snap|warncalm|walkin   a scene near the player (haul:
//       croc 0 swims in to a spot and climbs out; warncalm: the player steps away after
//       a warning; walkin: the player walks up to the croc)
//   ?crocspot=k  the haul-out spot for a scene     ?crocat=x,z  where the cruiser starts
//   ?crocbask=s  how long the scene's croc basks    ?crocfreeze=1  hold the snap
//   ?crocfast=k  run the crocs k times faster        ?crocseed=n  fix the random choices
//   ?crocview=m  a camera m metres beside croc 0 (?crocside=-1, ?crocup=k to move it)
//   ?crocyaw=a   turn the follow camera a radians round the player in a scene
//   ?crocdiag=s  after s seconds, stats, spots and event counts as JSON in <pre id="croc-diag">
//   ?debug=croc  the swim map, the haul-out spots and the current routes

import * as THREE from 'three';
import { FLAGS } from '../config.js';
import { createCrocMeshes, defaultAnim, CROC } from './croc_model.js';
import { createCrocFx } from './croc_fx.js';
import { buildCrocMap, makeRandom, PIVOT_S, OPEN, NEAR, START_CLEAR } from './croc_sites.js';

export const CROC_RULES = {
  count: 2,
  warnDist: 4.0, // metres from the nearest part of the croc, for a player standing still
  warnPerSpeed: 1.0, // and this much further per m/s of the player's speed
  watchLead: 3.0, // it lifts its head and watches from this far beyond the warning
  snapDist: 2.0,
  snapHold: 0.9, // seconds within snapDist before it lunges
  lungeDist: 1.3, // closer than this and it lunges at once
  snapCone: 100, // degrees either side of its nose (seen from its neck) it can snap at;
  // come at it from further behind and it slides off into the water instead
  calmDist: 5.2, // the warning ends 1.2 m beyond where it began (5.2 m for a still player)
  knockback: 2.4,
  penalty: { seconds: 20, points: 50 },
  scareRadius: 10, // lizards within this of a snap bolt
  cruiseSpeed: 0.55,
  crawlSpeed: 0.32,
  slideSpeed: 1.25,
  swimTurn: 0.55, // rad/s
  commute: 3.0, // how much faster it swims out of sight and more than 20 m from the player
  restless: 45, // seconds basking out of sight, 30 m or more from the player, before it moves on
  baskTime: [70, 140],
  cruiseTime: [25, 60],
  cooldown: 6, // seconds after a snap before it warns again
  patience: 12, // seconds of warning a player out of reach before it gives up and leaves
  pathSpotsAfter: 90, // seconds into a day before it may lie across a path
  spotRetry: 300, // seconds before it tries a spot again after failing to reach it
  // encounters: a croc in view within `range` m of the player counts once, and again
  // after it has been more than `rearm` m off; with the director on, a quiet spell of
  // `every` seconds sends one round (`hurry` times its speed while out of sight) to
  // `near` m from the player, in front of the camera, where it idles afloat for `loiter`
  // s: with the swim there, about one encounter every 2 to 3 minutes near the water
  encounter: { range: 30, rearm: 40, every: [85, 125], retry: 25, near: [12, 25], loiter: [14, 26], hurry: 4 },
};

const Q = new URLSearchParams(location.search);
const SCENE = Q.get('croc');
const FREEZE = Q.has('crocfreeze');
const DEBUG = !!(FLAGS.debug && FLAGS.debug.has('croc'));
const DIAG_AT = Q.has('crocdiag') ? Number(Q.get('crocdiag')) || 8 : -1;
const VIEW = Q.has('crocview') ? Number(Q.get('crocview')) || 4 : 0;
const FAST = Math.max(0.1, Number(Q.get('crocfast')) || 1);

const smooth = (e0, e1, v) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const wrap = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};
const approach = (v, target, rate, dt) => v + (target - v) * Math.min(1, rate * dt);

// Solid circles along a croc lying on land: [s, r].
const BODY_CIRCLES = [[0.85, 0.2], [0.3, 0.3], [-0.35, 0.33], [-0.95, 0.17]];
const SNOUT = 1.15, TAIL = 1.35; // the body line from the centre, forward and back
const NECK = 0.4; // where its head swings from
const EYES = 0.6; // where it aims its snap from

export async function build(game) {
  const { data, events, player, collision, sky } = game;
  const T = data.terrain;
  const R = CROC_RULES;
  const seed = Q.has('crocseed') ? Number(Q.get('crocseed')) : (Date.now() & 0xffff);
  const rand = makeRandom(seed);
  const rr = (a, b) => a + (b - a) * rand();

  // Trunks from the vegetation (mangroves keep a wide berth for their roots).
  const trunks = [];
  if (game.veg && game.veg.hosts) for (const t of game.veg.hosts.trunks) trunks.push({ x: t.x, z: t.z, r: t.r0 || 0.1 });
  let pathDistance = null;
  try { pathDistance = (await import('../world/ground_decor.js')).pathDistance; } catch (e) { /* no paths: fine */ }
  const map = buildCrocMap(T, { trunks, collision, start: T.start, spawns: (data.spawns && data.spawns.spawns) || [], pathDistance });

  const group = new THREE.Group();
  group.name = 'crocodiles';
  const meshes = createCrocMeshes(R.count);
  group.add(meshes.mesh);
  if (meshes.outline) group.add(meshes.outline);
  const fx = createCrocFx(R.count);
  group.add(fx.mesh);
  const topView = FLAGS.view === 'top';
  if (topView && !DEBUG) group.visible = false;

  // ---------------------------------------------------------------- sun and shade

  // Sunlight on a point 0..1 from the sun's height and the canopy grid towards it.
  const SUN_STEPS = [0.5, 1, 2, 3.5, 5.5, 8];
  function sunExposure(x, z, y = T.heightAt(x, z) + 0.3) {
    const st = sky && sky.state;
    if (!st) return 0.5;
    const s = st.sunDir;
    if (s.y <= 0.01) return 0;
    let lit = 1;
    for (const d of SUN_STEPS) {
      const qx = x + s.x * d, qy = y + s.y * d, qz = z + s.z * d;
      const c = T.canopyAt(qx, qz);
      if (c > 0.3 && T.heightAt(qx, qz) + c > qy) lit *= 0.3;
    }
    return smooth(0.02, 0.25, s.y) * lit;
  }
  const hours = () => (sky ? sky.hours ?? 10.5 : 10.5);

  // ---------------------------------------------------------------- the crocs

  const crocs = [];
  for (let i = 0; i < R.count; i++) {
    const c = {
      id: i, state: 'cruise', x: 0, z: 0, y: CROC.floatY, h: 0, pitch: 0, speed: 0,
      path: null, pk: 0, spot: null, timer: 0, nextHaul: 0, stuck: 0, rerouted: false, turnDir: 1, turnLeft: 0, turned: false,
      anim: defaultAnim(), target: defaultAnim(), wet: 0, bend: 0,
      alerted: false, hold: 0, alertT: 0, cooldown: 0, lunge: -1, lx: 0, lz: 0, ldx: 0, ldz: 0, calmIn: -1,
      watch: false, reach: R.warnDist, drift: false, legStuck: 0, unseen: 0, restless: false, shyT: 0,
      gape: 0, gapeT: rr(4, 12), blinkT: rr(2, 5), blink: 0, curl: 0, curlT: 0, leaveSoon: false, slideT: 0, snapped: false,
      dist: Infinity, visible: true, freeze: false, met: false, called: false, loiter: false, unseenNear: 0, callT: 0,
      circles: collision && collision.addDynamic ? BODY_CIRCLES.map(() => collision.addDynamic(0, 0, 0)) : [],
      position: new THREE.Vector3(),
      headPosition(v) {
        const f = fwd(this.h);
        return v.set(this.x + f.x * 0.75, this.y + 0.35, this.z + f.z * 0.75);
      },
    };
    crocs.push(c);
  }

  const _f = { x: 0, z: 0 };
  function fwd(h) { _f.x = -Math.sin(h); _f.z = -Math.cos(h); return _f; }
  const headingTo = (dx, dz) => Math.atan2(-dx, -dz);

  // fresh: a new leg (a reroute keeps the leg's count of time spent stuck)
  function setPath(c, pts, fresh = true) {
    c.path = pts; c.pk = pts.length > 2 ? 1 : 0; c.stuck = 0;
    if (fresh) { c.legStuck = 0; c.drift = false; }
  }

  function cellXZ(i) { return [map.xOf(i % map.w), map.zOf((i / map.w) | 0)]; }

  // A cruise across open water, somewhere 12 to 45 m away. It keeps to the
  // player's side of the lake when it can (15 to 40 m from them), so its next
  // haul-out is somewhere they may be walking; awayX, awayZ: move further off.
  function newCruise(c, awayX = null, awayZ = null) {
    const p = player.position;
    for (let tries = 0; tries < 24; tries++) {
      const [x, z] = cellXZ(map.cruise[(rand() * map.cruise.length) | 0]);
      const d = Math.hypot(x - c.x, z - c.z);
      const dp = Math.hypot(x - p.x, z - p.z);
      const toPlayer = tries < 14 && awayX === null;
      if (d < 12 || d > (toPlayer ? 70 : 45)) continue;
      if (awayX !== null && Math.hypot(x - awayX, z - awayZ) < Math.hypot(c.x - awayX, c.z - awayZ) + 4) continue;
      if (toPlayer && (dp < 15 || dp > 40)) continue;
      if (crocs.some((o) => o !== c && o.path && Math.hypot(o.path[o.path.length - 2] - x, o.path[o.path.length - 1] - z) < 8)) continue;
      const pts = map.route(c.x, c.z, x, z);
      if (!pts) continue;
      setPath(c, pts);
      c.state = 'cruise';
      return true;
    }
    return false;
  }

  // Off on a cruise (away from awayX, awayZ if it can), or failing any route, idle
  // afloat in the cruise state for a moment: never left in a state without a spot.
  function cruiseOn(c, awayX = null, awayZ = null) {
    if ((awayX !== null && newCruise(c, awayX, awayZ)) || newCruise(c)) return;
    c.state = 'cruise'; c.path = null; c.timer = 1;
  }

  // The point out in the water the crawl line starts from, and a lead-in before it.
  function spotLead(s) {
    if (s.lead) return s.lead;
    const f = fwd(s.hIn);
    s.lead = [s.ax, s.az];
    for (const back of [2.2, 1.4, 0.6]) {
      const x = s.ax - f.x * back, z = s.az - f.z * back;
      if (map.swimmable(x, z)) { s.lead = [x, z]; break; }
    }
    return s.lead;
  }

  // Haul-out spots it likes now: sunny ones in the morning and late afternoon,
  // shady ones in the heat of the day, anything at night.
  function spotScore(s) {
    const e = sunExposure(s.x, s.z);
    const hr = hours();
    const want = hr >= 11 && hr <= 15 ? 1 - e : hr > 6.5 && hr < 18.5 ? e : 0.5;
    // round where the player is walking, and a tree with rare lizards is worth guarding
    const dp = Math.hypot(s.x - player.position.x, s.z - player.position.z);
    return s.score * 0.4 + want * 2 + rand() * 1.5 + 4.5 * (1 - smooth(15, 50, dp)) + Math.min(1, (s.rare || 0) / 4);
  }

  // Somewhere 8 to 25 m ahead of the player is best, so it is lying there when
  // they arrive; never within 12 m behind them or 8 m ahead. The best three by
  // score are weighed by how far it has to swim to reach them (the causeway
  // splits the southern channel, so a spot close by can be a long way round).
  const _cands = [];
  function trySpot(c, now) {
    const p = player.position;
    const hx = -Math.sin(player.heading), hz = -Math.cos(player.heading);
    _cands.length = 0;
    for (const s of map.spots) {
      if (s.taken !== null || (s.failUntil || 0) > now) continue;
      if (s.blocksPath && now - dayAt < R.pathSpotsAfter) continue;
      const dx = s.x - p.x, dz = s.z - p.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const ahead = (dx * hx + dz * hz) > 0.3 * d;
      if (d < (ahead ? 8 : 12)) continue;
      s.pick = spotScore(s) + (ahead && d <= 25 ? 1.2 : 0);
      _cands.push(s);
    }
    _cands.sort((a, b) => b.pick - a.pick);
    let best = null, bs = -Infinity, bestPts = null;
    for (let k = 0; k < Math.min(3, _cands.length); k++) {
      const s = _cands[k];
      const [lx, lz] = spotLead(s);
      const pts = map.route(c.x, c.z, lx, lz);
      if (!pts) continue;
      let len = 0;
      for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
      const sc = s.pick - len / 25;
      if (sc > bs) { bs = sc; best = s; bestPts = pts; }
    }
    if (!best) return false;
    bestPts.push(best.ax, best.az);
    setPath(c, bestPts);
    c.spot = best;
    best.taken = c.id;
    c.state = 'approach';
    note(c, 'heads for a spot');
    return true;
  }

  function nextLeg(c, now) {
    if (haulOK && now >= c.nextHaul && trySpot(c, now)) return;
    if (!newCruise(c)) { counts.noRoute++; c.path = null; c.timer = 2; }
  }

  // Lie on a spot straight away (the start of the game and the check scenes).
  function placeBasking(c, s, now) {
    c.spot = s; s.taken = c.id;
    c.turned = s.turn;
    c.h = s.turn ? wrap(s.hIn + Math.PI) : s.hIn;
    const f = fwd(s.hIn);
    // the pivot stays put through the turn
    const px = s.x + f.x * PIVOT_S, pz = s.z + f.z * PIVOT_S;
    const g = fwd(c.h);
    c.x = px - g.x * PIVOT_S; c.z = pz - g.z * PIVOT_S;
    c.state = 'bask';
    c.timer = now + rr(R.baskTime[0], R.baskTime[1]);
    c.wet = 1;
    c.path = null;
    settle(c, 1, 0);
  }

  function placeSwimming(c, x, z, h) {
    c.x = x; c.z = z; c.h = h; c.state = 'cruise'; c.path = null; c.wet = 0;
    settle(c, 1, 0);
  }

  // ---------------------------------------------------------------- motion

  // Height and pitch from the ground under the head and hips, floating in water
  // low and a little nose up.
  function settle(c, dt, lift) {
    const f = fwd(c.h);
    const hf = Math.max(CROC.floatY, T.heightAt(c.x + f.x * 0.75, c.z + f.z * 0.75));
    const hb = Math.max(CROC.floatY, T.heightAt(c.x - f.x * 0.6, c.z - f.z * 0.6));
    // 0 afloat, 1 with the belly on the ground
    const wet = smooth(CROC.bedY + 0.03, CROC.bedY + 0.24, (Math.max(hf, CROC.bedY) + Math.max(hb, CROC.bedY)) / 2);
    c.wet = dt >= 1 ? wet : approach(c.wet, wet, 4, dt);
    const y = hb + (hf - hb) * (0.6 / 1.35) + 0.008 + lift;
    const pitch = Math.atan2(hf - hb, 1.35) + (1 - c.wet) * CROC.swimPitch;
    c.y = dt >= 1 ? y : approach(c.y, y, 6, dt);
    c.pitch = dt >= 1 ? pitch : approach(c.pitch, pitch, 5, dt);
  }

  // A new way from here to the end of the current path (for an approach, to the
  // lead-in, then on to the crawl line). False if there is none.
  function reroute(c) {
    const P = c.path;
    const n = P.length;
    const toSpot = c.state === 'approach' && n >= 4;
    const ex = toSpot ? P[n - 4] : P[n - 2], ez = toSpot ? P[n - 3] : P[n - 1];
    const pts = map.route(c.x, c.z, ex, ez);
    if (!pts) return false;
    if (toSpot) pts.push(P[n - 2], P[n - 1]);
    setPath(c, pts, false);
    return true;
  }

  // Off the swim grid near the start: would the body line from s -TAIL to SNOUT
  // along heading f, centred on (x, z), come within START_CLEAR of the start?
  function nearStart(x, z, f) {
    const dx = T.start.x - x, dz = T.start.z - z;
    const s = Math.max(-TAIL, Math.min(SNOUT, dx * f.x + dz * f.z));
    const ex = dx - f.x * s, ez = dz - f.z * s;
    return ex * ex + ez * ez < START_CLEAR * START_CLEAR;
  }

  // Swim towards the next waypoint, turning at a limited rate. Returns true at the end.
  // strict keeps the snout over water too (not when nosing up to a haul-out).
  function swim(c, dt, speed, strict = true) {
    const P = c.path;
    if (!P) return true;
    if (c.drift) { drift(c, dt); return false; }
    let tx = P[c.pk * 2], tz = P[c.pk * 2 + 1];
    let last = c.pk * 2 >= P.length - 2;
    let ddx = tx - c.x, ddz = tz - c.z;
    let d = Math.sqrt(ddx * ddx + ddz * ddz);
    // on to the next waypoint once close, or early when the way to it is open water
    if (!last && (d < 0.6 || (d < 2.2 && map.route.clear(c.x, c.z, P[c.pk * 2 + 2], P[c.pk * 2 + 3])))) {
      c.pk++; tx = P[c.pk * 2]; tz = P[c.pk * 2 + 1];
      ddx = tx - c.x; ddz = tz - c.z; d = Math.sqrt(ddx * ddx + ddz * ddz);
      last = c.pk * 2 >= P.length - 2;
    }
    if (last && d < 0.45) return true;
    // out of sight and well away from the player it swims faster, so it is round
    // where they are walking in good time (never seen: in view it cruises gently)
    const boost = !c.visible && c.dist > 20 ? (c.loiter ? R.encounter.hurry : R.commute) : 1;
    speed *= boost;
    const want = headingTo(tx - c.x, tz - c.z);
    const err = wrap(want - c.h);
    const turn = Math.max(-R.swimTurn * boost * dt, Math.min(R.swimTurn * boost * dt, err));
    c.h = wrap(c.h + turn);
    const v = speed * Math.max(0.2, Math.cos(err)) * Math.min(1, 0.3 + d / 2);
    c.speed = approach(c.speed, v, 2, dt);
    c.bend = approach(c.bend, dt > 0 ? Math.max(-0.8, Math.min(0.8, turn / dt / Math.max(0.2, c.speed))) : 0, 3, dt);
    const f = fwd(c.h);
    const nx = c.x + f.x * c.speed * dt, nz = c.z + f.z * c.speed * dt;
    // stay on the swim grid, or at least keep the body (and snout) over water, and
    // never off the grid anywhere near the start
    if (map.swimmable(nx, nz) || (T.isWater(nx, nz) && (!strict || T.isWater(nx + f.x * 1.1, nz + f.z * 1.1)) && !nearStart(nx, nz, f))) {
      c.x = nx; c.z = nz; c.stuck = 0;
    } else {
      c.speed = 0;
      c.stuck += dt;
      c.legStuck += dt;
      // wedged on this leg for too long all told: the caller gives the leg up
      if (c.legStuck > 8) { c.stuck = Math.max(c.stuck, 3.1); return false; }
      // nosed into a bank: find a new way from here to the same end
      if (c.stuck > 0.4 && !c.rerouted) {
        c.rerouted = true;
        if (reroute(c)) c.stuck = 0.41; // keep the flag until it moves
      } else if (c.stuck > 1.2 && c.rerouted) {
        // still wedged: ease back to the middle of the nearest swim cell, then try again
        c.drift = true;
      }
    }
    if (c.stuck === 0) c.rerouted = false;
    return false;
  }

  // Drift straight to the centre of the nearest swim cell, then find a new way on.
  function drift(c, dt) {
    c.legStuck += dt;
    if (c.legStuck > 8) { c.drift = false; c.stuck = 3.1; return; }
    const i = map.route.nearestCell(c.x, c.z);
    let d = 0;
    if (i >= 0) {
      const dx = map.xOf(i % map.w) - c.x, dz = map.zOf((i / map.w) | 0) - c.z;
      d = Math.sqrt(dx * dx + dz * dz);
      const step = Math.min(d, 0.45 * dt);
      if (d > 1e-4) { c.x += (dx / d) * step; c.z += (dz / d) * step; d -= step; }
    }
    c.speed = approach(c.speed, 0.15, 3, dt);
    c.bend = approach(c.bend, 0, 3, dt);
    if (d < 0.02) {
      c.drift = false;
      c.rerouted = false;
      c.stuck = 0;
      if (!reroute(c)) c.stuck = 3.1; // no way on from here: the caller gives this leg up
    }
  }

  // Crawl straight towards (tx, tz), steering gently. Returns true on arrival.
  function crawl(c, dt, tx, tz, speed, reverse = false) {
    const dx = tx - c.x, dz = tz - c.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.05) return true;
    if (!reverse) {
      const err = wrap(headingTo(dx, dz) - c.h);
      c.h = wrap(c.h + Math.max(-0.9 * dt, Math.min(0.9 * dt, err)));
    }
    const v = Math.min(speed, d / Math.max(dt, 1e-3));
    c.speed = approach(c.speed, reverse ? -v : v, 3, dt);
    const s = Math.min(d, Math.abs(c.speed) * dt);
    c.x += (dx / d) * s; c.z += (dz / d) * s;
    c.bend = approach(c.bend, 0, 3, dt);
    return false;
  }

  function stepLocomotion(c, dt, now) {
    // afloat, it never swims up to a player on the bank: within a metre and a half
    // of the warning it turns off and heads away (a player who walks at it is another matter)
    c.shyT -= dt;
    if ((c.state === 'cruise' || c.state === 'approach') && c.wet < 0.5 && c.shyT <= 0 && c.dist < R.warnDist + 1.5) {
      c.shyT = 4;
      counts.shy++;
      note(c, 'keeps clear of the player');
      dropSpot(c);
      cruiseOn(c, player.position.x, player.position.z);
      return;
    }
    switch (c.state) {
      case 'cruise': {
        if (!c.path) {
          c.timer -= dt;
          c.speed = approach(c.speed, 0, 2, dt);
          if (c.timer <= 0) nextLeg(c, now);
          break;
        }
        if (swim(c, dt, R.cruiseSpeed) || c.stuck > 3) {
          if (c.stuck > 3) { counts.stuck++; note(c, 'stuck cruising'); }
          // one the director called round idles there a while, where it can be seen
          c.path = null; c.timer = c.loiter ? rr(R.encounter.loiter[0], R.encounter.loiter[1]) : rr(0.5, 4); c.drift = false;
          c.loiter = false;
        }
        break;
      }
      case 'approach': {
        const s = c.spot;
        if (!s) { cruiseOn(c); break; }
        // someone on the spot: give it up
        const px = player.position.x - s.x, pz = player.position.z - s.z;
        if (px * px + pz * pz < 25) { note(c, 'spot taken by the player'); dropSpot(c); cruiseOn(c); break; }
        if (swim(c, dt, R.cruiseSpeed * 0.8, c.pk * 2 < c.path.length - 2) || c.stuck > 3) {
          if (c.stuck > 3) {
            // could not get there: leave that spot alone for a while and cruise on
            counts.stuck++; note(c, 'stuck approaching');
            s.failUntil = now + R.spotRetry;
            dropSpot(c); c.path = null; c.timer = 1; c.state = 'cruise'; c.drift = false;
            c.nextHaul = now + rr(R.cruiseTime[0], R.cruiseTime[1]);
            break;
          }
          c.state = 'crawl';
          c.path = null;
          note(c, 'crawls out');
        }
        break;
      }
      case 'crawl': {
        const s = c.spot;
        if (crawl(c, dt, s.x, s.z, c.wet > 0.5 ? R.crawlSpeed : R.cruiseSpeed * 0.6)) {
          c.x = s.x; c.z = s.z;
          if (s.turn) {
            c.state = 'turn';
            c.turnLeft = Math.PI;
            c.turnDir = rand() < 0.5 ? -1 : 1;
          } else {
            c.state = 'bask';
            c.turned = false;
            c.timer = now + rr(R.baskTime[0], R.baskTime[1]);
            counts.hauls++;
          }
        }
        break;
      }
      case 'turn': {
        // round on the spot about the belly, legs walking
        const f0 = fwd(c.h);
        const px = c.x + f0.x * PIVOT_S, pz = c.z + f0.z * PIVOT_S;
        const step = Math.min(c.turnLeft, 0.42 * dt);
        c.turnLeft -= step;
        c.h = wrap(c.h + c.turnDir * step);
        const f = fwd(c.h);
        c.x = px - f.x * PIVOT_S; c.z = pz - f.z * PIVOT_S;
        c.speed = 0.22;
        c.bend = approach(c.bend, c.turnDir * 0.55, 3, dt);
        if (c.turnLeft <= 1e-4) {
          c.state = 'bask';
          c.turned = true;
          c.timer = now + (c.leaveSoon ? 1.2 : rr(R.baskTime[0], R.baskTime[1]));
          c.leaveSoon = false;
          counts.hauls++;
        }
        break;
      }
      case 'bask': {
        c.speed = approach(c.speed, 0, 3, dt);
        c.bend = approach(c.bend, 0, 1, dt);
        // basking where nobody comes by: it grows restless and moves nearer the player
        c.unseen = !c.visible && c.dist > 30 ? c.unseen + dt : 0;
        if (c.unseen > R.restless) { c.timer = now; c.restless = true; }
        if (now >= c.timer) c.state = 'slide';
        break;
      }
      case 'slide': {
        const s = c.spot;
        if (!s) { leaveSpot(c, now); break; }
        if (c.turned) {
          // forwards, faster and faster, legs tucked: a belly slide
          const lead = spotLead(s);
          const wasWet = c.wet;
          const done = crawl(c, dt, lead[0], lead[1], Math.min(R.slideSpeed, 0.35 + Math.max(0, c.slideT || 0) * 0.9));
          c.slideT = (c.slideT || 0) + dt;
          if (wasWet > 0.4 && c.wet <= 0.4) fx.ring(c.id, c.x + fwd(c.h).x * 0.6, c.z + fwd(c.h).z * 0.6, 1.5);
          if (done || (c.wet < 0.05 && c.slideT > 1)) leaveSpot(c, now);
        } else {
          // backwards down the bank, then turn round in the water
          const wasWet = c.wet;
          const done = crawl(c, dt, s.ax, s.az, 0.42, true);
          if (wasWet > 0.4 && c.wet <= 0.4) fx.ring(c.id, c.x, c.z, 1.3);
          if (done || c.wet < 0.05) leaveSpot(c, now);
        }
        break;
      }
      default:
        break;
    }
  }

  function dropSpot(c) {
    if (c.spot) c.spot.taken = null;
    c.spot = null;
  }

  function leaveSpot(c, now) {
    note(c, c.restless ? 'restless: back in the water' : 'back in the water');
    dropSpot(c);
    c.slideT = 0;
    c.turned = false;
    c.unseen = 0;
    c.nextHaul = now + (c.restless ? rr(8, 20) : rr(R.cruiseTime[0], R.cruiseTime[1]));
    c.restless = false;
    // called round by the director: off towards the player rather than away
    if (c.called) { c.called = false; if (cruiseNear(c)) return; }
    const p = player.position;
    cruiseOn(c, p.x, p.z);
  }

  // ---------------------------------------------------------------- the hazard

  // Distance from (px, pz) to the croc's body line, tail tip to snout.
  function bodyDistance(c, px, pz) {
    const f = fwd(c.h);
    const dx = px - c.x, dz = pz - c.z;
    const s = Math.max(-TAIL, Math.min(SNOUT, dx * f.x + dz * f.z));
    const ex = dx - f.x * s, ez = dz - f.z * s;
    return Math.sqrt(ex * ex + ez * ez);
  }

  // Is (px, pz) where its head can swing round to (the snap cone about its neck)?
  const SNAP_COS = Math.cos((R.snapCone * Math.PI) / 180);
  function inFront(c, px, pz) {
    const f = fwd(c.h);
    const dx = px - (c.x + f.x * NECK), dz = pz - (c.z + f.z * NECK);
    const l = Math.sqrt(dx * dx + dz * dz);
    return l < 0.3 || dx * f.x + dz * f.z > SNAP_COS * l;
  }

  // The warning's reach for the player as they are moving now.
  const warnReach = () => R.warnDist + R.warnPerSpeed * Math.min(4.5, player.speed || 0);
  const onCauseway = (p) => (T.maskAt(p.x, p.z) & T.bits.causeway) !== 0;

  const kb = { t: 1, dur: 0.38, dx: 0, dz: 0, active: false };
  const shake = { t: 1, dur: 0.5, amp: 0.13 };
  const kbPos = { x: 0, z: 0 };
  const counts = { warns: 0, snaps: 0, calms: 0, hauls: 0, stuck: 0, noRoute: 0, slips: 0, shy: 0, encounters: 0, calls: 0, farFromWater: 0, jumps: 0 };
  const log = []; // the last few notable moments, for ?crocdiag
  const note = (c, what) => { if (DIAG_AT > 0) { log.push([+time.toFixed(1), c.id, what, +c.x.toFixed(2), +c.z.toFixed(2), c.spot ? c.spot.id : -1]); if (log.length > 40) log.shift(); } };
  let enabled = true;
  let haulOK = true; // false: they stay afloat (the set-up day)
  let shakeOn = true; // the settings' camera shake
  let dayAt = 0; // when the day began (croc time), for the path spots
  let director = false; // the survey day: keep encounters coming
  const E = R.encounter;
  let lastEnc = 0, nextGap = rr(E.every[0], E.every[1]), pushAt = 0;

  function warn(c, d, reach) {
    c.alerted = true;
    c.hold = 0;
    c.alertT = 0;
    c.reach = reach;
    counts.warns++;
    events.emit('croc:warn', { croc: c.id, x: c.x, y: c.y, z: c.z, distance: d, onLand: c.wet > 0.5 });
  }

  function calm(c) {
    if (!c.alerted && c.calmIn === -1) return;
    c.alerted = false;
    c.calmIn = -1;
    c.hold = 0;
    counts.calms++;
    events.emit('croc:calm', { croc: c.id, x: c.x, y: c.y, z: c.z });
  }

  // A lunge that has not snapped yet stops where it is (the hazard switched off).
  function cancelLunge(c) {
    if (c.lunge < 0 || c.snapped) return;
    c.lunge = -1;
    c.lx = 0; c.lz = 0;
    c.freeze = false;
  }

  // Where the jaws close: from its eyes 0.6 m towards the player (its head swung
  // round to them), no further than the player.
  const _snap = { x: 0, z: 0 };
  function snapPoint(c, out) {
    const f = fwd(c.h), p = player.position;
    const ex = c.x + f.x * EYES + c.lx, ez = c.z + f.z * EYES + c.lz;
    const dx = p.x - ex, dz = p.z - ez;
    const d = Math.sqrt(dx * dx + dz * dz);
    const k = d > 1e-3 ? Math.min(0.6, d * 0.8) / d : 0;
    out.x = ex + dx * k; out.z = ez + dz * k;
    return out;
  }

  function startLunge(c) {
    c.lunge = 0;
    c.lx = 0; c.lz = 0;
    const p = player.position;
    const f = fwd(c.h);
    // from the eyes, so a snap at the side swings the head round
    const dx = p.x - (c.x + f.x * EYES), dz = p.z - (c.z + f.z * EYES);
    const d = Math.sqrt(dx * dx + dz * dz) || 1;
    c.ldx = dx / d; c.ldz = dz / d;
  }

  // Come at it from behind on land: a hiss, then it slides off into the water.
  function slipAway(c, now) {
    calm(c);
    c.cooldown = 10;
    counts.slips++;
    note(c, 'slips away from behind');
    if (c.state === 'turn') { c.leaveSoon = true; return; }
    if (c.state === 'bask' || c.state === 'crawl') { c.state = 'slide'; c.slideT = 0.6; c.timer = now; }
    else if (c.wet > 0.5) { dropSpot(c); cruiseOn(c, player.position.x, player.position.z); }
  }

  function doSnap(c) {
    const p = player.position;
    const f = fwd(c.h);
    // push away from the nearest point of the body
    const s = Math.max(-TAIL, Math.min(SNOUT, (p.x - c.x) * f.x + (p.z - c.z) * f.z));
    let ax = p.x - (c.x + f.x * s), az = p.z - (c.z + f.z * s);
    let l = Math.sqrt(ax * ax + az * az);
    if (l < 1e-3) { ax = c.ldx; az = c.ldz; l = 1; }
    kb.dx = (ax / l) * R.knockback; kb.dz = (az / l) * R.knockback;
    kb.t = 0;
    kb.active = true;
    player.pushed = true;
    if (shakeOn) shake.t = 0;
    // the burst where the jaws close, between its head and the player
    snapPoint(c, _snap);
    const hx = _snap.x, hz = _snap.z;
    fx.snap(c.id, hx, c.y + 1.0, hz);
    if (c.wet < 0.5) fx.ring(c.id, hx, hz, 1.6);
    counts.snaps++;
    c.cooldown = R.cooldown;
    events.emit('croc:snap', {
      croc: c.id, penalty: { seconds: R.penalty.seconds, points: R.penalty.points },
      x: hx, y: c.y, z: hz, position: new THREE.Vector3(hx, c.y, hz), radius: R.scareRadius,
    });
  }

  function hazard(c, dt, now) {
    c.cooldown = Math.max(0, c.cooldown - dt);
    const p = player.position;
    const d = bodyDistance(c, p.x, p.z);
    c.dist = d;
    c.watch = false;
    if (c.lunge >= 0) return;
    const safe = onCauseway(p);
    const canWarn = enabled && c.cooldown <= 0 && c.state !== 'slide' && !topView && !safe;
    if (!c.alerted) {
      const reach = warnReach();
      if (canWarn && d < reach) warn(c, d, reach);
      // before that, a silent look: the head comes up and the eyes follow the player
      else c.watch = canWarn && d < reach + R.watchLead;
    } else {
      if (!enabled || safe || d > c.reach + R.calmDist - R.warnDist) { calm(c); return; }
      c.hold = d < R.snapDist ? c.hold + dt : Math.max(0, c.hold - dt * 0.5);
      c.alertT += dt;
      if (d < R.lungeDist || c.hold > R.snapHold) {
        if (inFront(c, p.x, p.z)) startLunge(c);
        else if (c.wet > 0.5) slipAway(c, now);
        // afloat it is still turning to face the player
      } else if (c.alertT > R.patience) {
        // a player who waits it out: the croc loses interest and leaves
        calm(c);
        c.cooldown = 10; // time to get clear before it could warn again
        if (c.wet > 0.5 && (c.state === 'bask' || c.state === 'crawl')) { c.state = 'bask'; c.timer = now; }
        else if (c.state === 'turn') c.leaveSoon = true;
        else if (c.wet <= 0.5) { dropSpot(c); cruiseOn(c, p.x, p.z); }
      }
    }
    if (c.calmIn !== -1) {
      c.calmIn = Math.max(0, c.calmIn - dt);
      if (c.calmIn <= 0 || d > c.reach + R.calmDist - R.warnDist) calm(c);
    }
  }

  // The lunge: wind up, strike towards the player, SNAP, pull back.
  function stepLunge(c, dt, now) {
    if (c.lunge < 0) return;
    // switched off before the jaws closed: no snap
    if (!enabled && !c.snapped) { cancelLunge(c); calm(c); return; }
    if (!c.freeze) c.lunge += dt;
    const t = c.lunge;
    const reach = t < 0.12 ? 0 : t < 0.24 ? smooth(0.12, 0.24, t) : 1 - smooth(0.3, 0.9, t);
    const amt = 0.55 * reach;
    c.lx = c.ldx * amt; c.lz = c.ldz * amt;
    if (t >= 0.24 && !c.snapped) {
      c.snapped = true;
      doSnap(c);
      if (FREEZE) { c.freeze = true; c.lunge = 0.2; }
    }
    if (c.freeze) {
      snapPoint(c, _snap);
      fx.snap(c.id, _snap.x, c.y + 1.0, _snap.z, 0.4);
      return;
    }
    if (t >= 0.9) {
      c.lunge = -1;
      c.snapped = false;
      c.lx = 0; c.lz = 0;
      c.alerted = false;
      c.calmIn = 2.5; // croc:calm once the player is clear, or soon anyway
      if (c.state === 'turn') {
        c.leaveSoon = true; // finish turning round, then slide away
      } else if (c.state === 'bask' || c.state === 'crawl') {
        // settle for a breath, then slide away
        c.state = 'bask';
        c.timer = now + 1.2;
      } else if (c.wet < 0.5) {
        dropSpot(c);
        cruiseOn(c, player.position.x, player.position.z);
      }
    }
  }

  // ---------------------------------------------------------------- animation

  function animate(c, dt, t) {
    const a = c.anim, g = c.target;
    const moving = Math.abs(c.speed) > 0.03;
    const afloat = 1 - c.wet;
    // swimming: a travelling wave down the tail, legs folded back
    g.swimAmp = afloat * (0.35 + 0.65 * Math.min(1, Math.abs(c.speed) / 0.45)) + (c.state === 'slide' && c.turned ? 0.35 : 0);
    g.tuck = afloat * 0.95 + (c.state === 'slide' && c.turned ? 0.7 * c.wet : 0);
    g.walk = c.wet * (moving || c.state === 'turn' ? 1 : 0) * (c.state === 'slide' && c.turned ? 0.2 : 1);
    g.bend = c.bend;
    g.headPitch = afloat * CROC.swimHeadPitch;
    g.jaw = 0; g.headYaw = 0; g.breath = 0; g.tailCurl = 0;
    // basking: gape to cool now and then (head tipped up so the chin rests on the
    // ground), slow blinks, breathing, a lazy tail
    if (c.state === 'bask') {
      c.gapeT -= dt;
      if (c.gapeT <= 0) { c.gape = c.gape ? 0 : 1; c.gapeT = c.gape ? rr(10, 25) : rr(6, 14); }
      g.jaw = c.gape * 0.5;
      g.headPitch = 0.03 + c.gape * 0.19;
      c.curlT -= dt;
      if (c.curlT <= 0) { c.curl = rr(-0.35, 0.45); c.curlT = rr(6, 14); }
      g.tailCurl = c.curl;
      g.breath = 0.5 + 0.5 * Math.sin(t * 1.3 + c.id);
      g.headYaw = 0.08 * Math.sin(t * 0.21 + c.id * 2);
    }
    // it has noticed the player: head up a little, eyes and head on them
    const p = player.position;
    if (c.watch) {
      const want = wrap(headingTo(p.x - c.x, p.z - c.z) - c.h);
      g.headYaw = Math.max(-0.8, Math.min(0.8, want));
      g.headPitch = Math.max(g.headPitch, 0.16) + afloat * 0.06;
      g.jaw = Math.min(g.jaw, 0.12);
    }
    // warning: head up, a hissing gape, puffed up, the head towards the player
    if (c.alerted || c.lunge >= 0) {
      const want = wrap(headingTo(p.x - c.x, p.z - c.z) - c.h);
      g.headYaw = Math.max(-1.0, Math.min(1.0, want));
      g.bend = Math.max(-0.7, Math.min(0.7, want * 0.5));
      g.headPitch = 0.3;
      g.jaw = 0.36 + 0.06 * Math.sin(t * 24);
      g.breath = 1;
      g.tailCurl = 0.25 * Math.sin(t * 5);
    }
    if (c.lunge >= 0) {
      // the head rears up with the jaws wide (the chin clear of the ground), then SNAP
      const lt = c.lunge;
      g.jaw = lt < 0.2 ? 1.05 : lt < 0.26 ? 1.05 * (1 - smooth(0.2, 0.26, lt)) : 0.05;
      g.headPitch = lt < 0.24 ? 0.55 : 0.55 * (1 - smooth(0.24, 0.8, lt));
    }
    // rates: quick for the lunge, gentle otherwise
    const fast = c.lunge >= 0 ? 40 : 5;
    a.swimAmp = approach(a.swimAmp, g.swimAmp, 2, dt);
    a.tuck = approach(a.tuck, g.tuck, 3, dt);
    a.walk = approach(a.walk, g.walk, 4, dt);
    a.bend = approach(a.bend, g.bend, 3, dt);
    a.headPitch = approach(a.headPitch, g.headPitch, fast, dt);
    a.jaw = approach(a.jaw, g.jaw, c.lunge >= 0 ? fast : 2.5, dt);
    a.headYaw = approach(a.headYaw, g.headYaw, 4, dt);
    a.breath = approach(a.breath, g.breath, 2, dt);
    a.tailCurl = approach(a.tailCurl, g.tailCurl, 0.8, dt);
    a.swimPhase += dt * (1.6 + 5.5 * Math.abs(c.speed)) * (a.swimAmp > 0.05 ? 1 : 0.3);
    a.walkPhase += dt * (c.state === 'turn' ? 4.2 : 12 * c.speed);
    // blinks
    c.blinkT -= dt;
    if (c.blinkT <= 0) { c.blink = 0.18; c.blinkT = rr(2.5, 6); }
    c.blink = Math.max(0, c.blink - dt);
    a.blink = c.blink > 0 ? Math.sin((c.blink / 0.18) * Math.PI) : (c.state === 'bask' && c.gape === 0 && !c.watch && !c.alerted ? 0.35 : 0);
  }

  // ---------------------------------------------------------------- start

  const start = T.start;
  const open = map.cruise.map(cellXZ).filter(([x, z]) => Math.hypot(x - start.x, z - start.z) > 25);
  const pickOpen = () => open[(rand() * open.length) | 0] || [0, -45];
  // The morning's places (at the start and each survey day): one cruising out on open
  // water, the other already basking somewhere in sight of the paths but not lying
  // across one, so a new player's first detours stay clear (afloat when haul is off).
  // now is the crocs' own clock.
  function placeForDay(now) {
    for (const c of crocs) {
      cancelLunge(c); calm(c); dropSpot(c);
      c.alerted = false; c.watch = false; c.leaveSoon = false; c.restless = false; c.called = false;
      c.unseen = 0; c.slideT = 0; c.turned = false; c.met = false; c.timer = 0; c.loiter = false; c.unseenNear = 0;
    }
    const [x, z] = pickOpen();
    placeSwimming(crocs[0], x, z, rand() * 6.28);
    crocs[0].nextHaul = now + rr(20, 60);
    if (R.count > 1) {
      const near = (s) => s.score + 4 * (1 - smooth(20, 50, Math.hypot(s.x - start.x, s.z - start.z)));
      const good = haulOK ? map.spots.filter((s) => !s.blocksPath).sort((a, b) => near(b) - near(a)).slice(0, 2) : [];
      if (good.length) {
        placeBasking(crocs[1], good[(rand() * good.length) | 0], now);
        crocs[1].timer = now + rr(40, 100);
      } else { const [x1, z1] = pickOpen(); placeSwimming(crocs[1], x1, z1, 0); }
      crocs[1].nextHaul = now + rr(60, 120);
    }
  }
  placeForDay(0);

  // A cruise to open water E.near metres from the player (in front of the camera if it
  // can be, and never round the start). False when there is none or no way there.
  const _look = new THREE.Vector3();
  function cruiseNear(c) {
    const p = player.position;
    game.camera.getWorldDirection(_look);
    const ll = Math.hypot(_look.x, _look.z) || 1, hx = _look.x / ll, hz = _look.z / ll;
    const mid = (E.near[0] + E.near[1]) / 2, far = E.near[1] + 3;
    let bx = 0, bz = 0, bs = -Infinity;
    // every swimmable metre round the player (open water scores a little higher)
    const cs = map.cell, step = Math.max(1, Math.round(1 / cs));
    const c0 = Math.max(0, Math.floor((p.x - far - map.x0) / cs)), c1 = Math.min(map.w - 1, Math.floor((p.x + far - map.x0) / cs));
    const r0 = Math.max(0, Math.floor((p.z - far - map.z0) / cs)), r1 = Math.min(map.h - 1, Math.floor((p.z + far - map.z0) / cs));
    for (let r = r0; r <= r1; r += step) {
      for (let q = c0; q <= c1; q += step) {
        const cl = map.cls[r * map.w + q];
        if (!cl) continue;
        const x = map.xOf(q), z = map.zOf(r);
        const dx = x - p.x, dz = z - p.z, d = Math.sqrt(dx * dx + dz * dz);
        if (d < E.near[0] || d > far) continue;
        if (Math.hypot(x - start.x, z - start.z) < 22) continue;
        const sc = -Math.abs(d - mid) * 0.15 + 1.5 * (dx * hx + dz * hz) / d + (cl === OPEN ? 0.4 : 0) + rand() * 0.6;
        if (sc > bs) { bs = sc; bx = x; bz = z; }
      }
    }
    if (bs === -Infinity) { counts.farFromWater++; return false; }
    const pts = map.route(c.x, c.z, bx, bz);
    if (!pts) { counts.noRoute++; return false; }
    catchUp(c, pts);
    setPath(c, pts);
    c.state = 'cruise';
    c.loiter = true;
    c.called = false;
    c.callT = 0;
    return true;
  }

  // The lake rings the island, so the way round can be long: a called croc out of sight
  // starts from the last point on its route (40 m or less from its end) that is out of
  // view and over 30 m from the player. Nobody sees the jump. pts is trimmed in place.
  const _cu = new THREE.Sphere(new THREE.Vector3(), 2.2);
  function catchUp(c, pts) {
    if (c.visible || pts.length < 6) return;
    const p = player.position;
    let left = 0, k = pts.length - 2;
    for (; k >= 2; k -= 2) {
      left += Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]);
      if (left > 40) break;
    }
    for (let j = Math.max(0, k); j < pts.length - 4; j += 2) {
      const x = pts[j], z = pts[j + 1];
      _cu.center.set(x, CROC.floatY, z);
      if (Math.hypot(x - p.x, z - p.z) < 30 || frustum.intersectsSphere(_cu)) continue;
      if (j === 0) return;
      c.x = x; c.z = z;
      c.h = headingTo(pts[j + 2] - x, pts[j + 3] - z);
      pts.splice(0, j);
      settle(c, 1, 0);
      counts.jumps++;
      return;
    }
  }

  // Encounters: a croc in view within E.range of the player counts once, until it has
  // been E.rearm away. With the director on (the survey day) and the hazard on, a quiet
  // spell of E.every seconds calls the nearest free croc out of view round: one afloat
  // swims (from the far end of its route, catchUp) to E.near metres from the player and
  // idles there, one basking slides in first; a new goal every 12 s if the player has
  // walked on. Nothing calls one while another is round, just out of view.
  let quiet = 0;
  function encounters(dt) {
    for (const c of crocs) {
      if (!c.met && c.visible && c.dist < E.range) {
        c.met = true;
        counts.encounters++;
        quiet = 0;
        nextGap = rr(E.every[0], E.every[1]);
      } else if (c.met && c.dist > E.rearm) c.met = false;
      c.unseenNear = c.dist < E.range && !c.visible ? c.unseenNear + dt : 0;
    }
    if (!director || !haulOK || !enabled) return;
    // one on its way whose goal the player has walked away from: a new goal
    for (const c of crocs) {
      if (!c.loiter || !c.path || c.visible) continue;
      c.callT += dt;
      if (c.callT < 12) continue;
      c.callT = 0;
      const P = c.path, ex = P[P.length - 2], ez = P[P.length - 1];
      if (Math.hypot(ex - player.position.x, ez - player.position.z) > E.near[1] + 6) cruiseNear(c);
    }
    quiet += dt;
    if (quiet < nextGap || time < pushAt) return;
    pushAt = time + E.retry;
    // one is round already, out of view for now (unless it has been for a while)
    for (const c of crocs) if (c.dist < E.range && c.unseenNear < 20) return;
    let best = null, bd = Infinity;
    for (const c of crocs) {
      if (c.alerted || c.lunge >= 0 || c.visible) continue; // not one already in view
      const afloat = c.state === 'cruise' || c.state === 'approach';
      if (!afloat && c.state !== 'bask') continue;
      const d = c.dist + (afloat ? 0 : 20);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) return;
    counts.calls++;
    if (best.state === 'bask') {
      best.called = true;
      best.timer = time;
      note(best, 'called round: slides in');
      return;
    }
    dropSpot(best);
    if (cruiseNear(best)) {
      best.nextHaul = time + rr(15, 35);
      note(best, 'called round to the player');
    } else if (best.state === 'approach') cruiseOn(best); // no way round: at least not left without a spot
  }

  // A new survey day: the morning's places, no path spots for a while, the count afresh.
  function newDay() {
    dayAt = time;
    quiet = 30; // the first one comes a little sooner
    pushAt = 0;
    nextGap = rr(E.every[0], E.every[1]);
    if (!SCENE) placeForDay(time);
  }

  // Afloat only (haul off): none heads for a spot, and one out on land goes back in.
  function toWater(now) {
    for (const c of crocs) {
      if (c.state === 'approach') { dropSpot(c); cruiseOn(c); }
      else if (c.state === 'crawl') { c.state = 'slide'; c.turned = false; }
      else if (c.state === 'turn') c.leaveSoon = true;
      else if (c.state === 'bask') c.timer = Math.min(c.timer, now);
    }
  }

  // Check scenes near the player (?croc=...).
  if (SCENE) {
    const p = player.position;
    const c = crocs[0];
    if (crocs[1] && crocs[1].spot) dropSpot(crocs[1]);
    if (SCENE === 'cruise') {
      let best = null, bd = Infinity;
      const at = (Q.get('crocat') || '').split(',').map(Number);
      if (at.length === 2 && at.every(Number.isFinite)) best = at;
      else {
        for (const [x, z] of map.cruise.map(cellXZ)) {
          const d = Math.hypot(x - p.x, z - p.z);
          if (d > 5 && d < bd) { bd = d; best = [x, z]; }
        }
      }
      if (best) {
        placeSwimming(c, best[0], best[1], 0);
        newCruise(c);
        c.nextHaul = 1e9;
      }
      if (crocs[1]) { placeSwimming(crocs[1], ...pickOpen(), 0); crocs[1].nextHaul = 1e9; }
    } else {
      const k = Q.has('crocspot') ? Number(Q.get('crocspot')) : -1;
      let s = map.spots[k];
      if (!s) s = [...map.spots].sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
      if (s && SCENE === 'haul') {
        const [lx, lz] = spotLead(s);
        const f = fwd(s.hIn);
        placeSwimming(c, lx - f.x * 3, lz - f.z * 3, s.hIn);
        setPath(c, [c.x, c.z, lx, lz, s.ax, s.az]);
        c.spot = s; s.taken = c.id; c.state = 'approach';
        if (crocs[1]) { placeSwimming(crocs[1], ...pickOpen(), 0); crocs[1].nextHaul = 1e9; }
        if (!Q.has('at')) {
          // watch from the land, well back from the spot
          const g = fwd(s.hIn);
          player.teleport(s.x + g.x * 7, s.z + g.z * 7, wrap(s.hIn + Math.PI));
        }
      } else if (s) {
        placeBasking(c, s, 0);
        c.timer = Q.has('crocbask') ? Number(Q.get('crocbask')) : 1e9;
        if (crocs[1]) { placeSwimming(crocs[1], ...pickOpen(), 0); crocs[1].state = 'cruise'; crocs[1].nextHaul = 1e9; }
        if (!Q.has('at')) placePlayerNear(c, SCENE === 'warn' || SCENE === 'warncalm' ? 3.1 : SCENE === 'snap' ? 1.65 : SCENE === 'walkin' ? 5 : 6.5, SCENE === 'walkin');
        // look from a little to the side so the player does not hide the croc
        if (game.rig && Q.has('crocyaw')) { game.rig.yaw += Number(Q.get('crocyaw')); game.rig.snap(); }
      }
    }
  }

  // The player on walkable ground at distance d from the croc's head, facing it
  // (with walk, only where nothing stands between them and the head).
  function placePlayerNear(c, d, walk = false) {
    const f = fwd(c.h);
    const hx = c.x + f.x * 0.9, hz = c.z + f.z * 0.9;
    let best = null, bs = -Infinity;
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      const x = hx + Math.cos(a) * d, z = hz + Math.sin(a) * d;
      if (!collision.isFree(x, z)) continue;
      let open = true;
      for (let s = 0.25; walk && open && s < d - 1.2; s += 0.25) open = collision.isFree(x - Math.cos(a) * s, z - Math.sin(a) * s);
      if (!open) continue;
      const bd = bodyDistance(c, x, z);
      if (bd < d - 0.35) continue;
      const front = (Math.cos(a) * f.x + Math.sin(a) * f.z);
      if (front > bs) { bs = front; best = [x, z]; }
    }
    if (!best) return;
    const h = headingTo(hx - best[0], hz - best[1]);
    player.teleport(best[0], best[1], h);
  }

  // Scripted player moves for the check scenes (never in play).
  const scriptPos = { x: 0, z: 0 };
  function script(dt) {
    const c = crocs[0];
    if (SCENE === 'warncalm' && time > 2.5 && !script.done) {
      script.done = true;
      const f = fwd(c.h);
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const x = c.x + f.x * 0.9 + Math.cos(a) * 8, z = c.z + f.z * 0.9 + Math.sin(a) * 8;
        if (collision.isFree(x, z) && bodyDistance(c, x, z) > 7) { player.teleport(x, z, player.heading); break; }
      }
    }
    if (SCENE === 'walkin' && time > 1 && !kb.active && counts.snaps === 0) {
      const f = fwd(c.h);
      const hx = c.x + f.x * 0.9 - player.position.x, hz = c.z + f.z * 0.9 - player.position.z;
      const l = Math.hypot(hx, hz) || 1;
      scriptPos.x = player.position.x; scriptPos.z = player.position.z;
      collision.move(scriptPos, (hx / l) * 1.2 * dt, (hz / l) * 1.2 * dt);
      player.position.x = scriptPos.x; player.position.z = scriptPos.z;
      player.position.y = collision.supportHeight(scriptPos.x, scriptPos.z);
      player.object.position.copy(player.position);
    }
  }

  // ---------------------------------------------------------------- debug layer

  let debugRoutes = null;
  if (DEBUG) group.add(debugLayer(map, T));
  if (DEBUG) {
    debugRoutes = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, fog: false }));
    debugRoutes.renderOrder = 12;
    debugRoutes.frustumCulled = false;
    group.add(debugRoutes);
  }
  const routeKeys = [];
  function updateDebugRoutes() {
    if (!debugRoutes) return;
    const keyNow = crocs.map((c) => c.path);
    if (keyNow.every((p, i) => p === routeKeys[i])) return;
    keyNow.forEach((p, i) => { routeKeys[i] = p; });
    const pts = [];
    for (const c of crocs) {
      const P = c.path;
      if (!P) continue;
      for (let i = 0; i + 3 < P.length; i += 2) pts.push(P[i], 0.08, P[i + 1], P[i + 2], 0.08, P[i + 3]);
    }
    debugRoutes.geometry.dispose();
    debugRoutes.geometry = new THREE.BufferGeometry();
    debugRoutes.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts.length ? pts : [0, 0, 0, 0, 0, 0], 3));
  }

  // ---------------------------------------------------------------- per frame

  // Is the player's disc inside any of the crocs' solid circles?
  function touchingPlayer() {
    const p = player.position, pr = collision.radius - 0.01;
    for (let i = 0; i < crocs.length; i++) {
      const cc = crocs[i].circles;
      for (let k = 0; k < cc.length; k++) {
        const d = cc[k];
        if (!(d[2] > 0)) continue;
        const dx = p.x - d[0], dz = p.z - d[1], lim = d[2] + pr;
        if (dx * dx + dz * dz < lim * lim) return true;
      }
    }
    return false;
  }

  const frustum = new THREE.Frustum();
  const projScreen = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  const head = new THREE.Vector3();
  const pose = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 };
  let time = 0;

  function simulate(c, dt, now, t) {
    hazard(c, dt, now);
    if (!c.alerted && c.lunge < 0) {
      stepLocomotion(c, dt, now);
    } else {
      c.speed = approach(c.speed, 0, 4, dt);
      // afloat, it turns to face the player
      if (c.wet < 0.3 && c.lunge < 0) {
        const p = player.position;
        const err = wrap(headingTo(p.x - c.x, p.z - c.z) - c.h);
        c.h = wrap(c.h + Math.max(-0.7 * dt, Math.min(0.7 * dt, err)));
      }
    }
    stepLunge(c, dt, now);
    settle(c, dt, 0);
    animate(c, dt, t);
  }

  function update(dt, t) {
    // ?crocfast runs the crocs faster in sub-steps of at most 0.05 s
    const steps = FAST > 1 ? Math.max(1, Math.ceil((dt * FAST) / 0.05)) : 1;
    const sdt = (dt * FAST) / steps;
    for (let k = 0; k < steps; k++) {
      time += sdt;
      if (SCENE === 'warncalm' || SCENE === 'walkin') script(sdt);
      for (let i = 0; i < crocs.length; i++) simulate(crocs[i], sdt, time, t);
    }
    const cam = game.camera;
    cam.updateMatrixWorld();
    projScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);
    let slots = 0; // crocs in view take the first instance slots; the rest are not drawn
    const shown = group.visible; // hidden in the top view

    for (let i = 0; i < crocs.length; i++) {
      const c = crocs[i];
      const f = fwd(c.h);
      const x = c.x + c.lx, z = c.z + c.lz;
      c.position.set(x, c.y, z);
      sphere.center.set(x - f.x * 0.15, c.y + 0.2, z - f.z * 0.15);
      sphere.radius = 1.7;
      c.visible = shown && frustum.intersectsSphere(sphere);
      if (c.visible) {
        pose.x = x; pose.y = c.y; pose.z = z; pose.heading = c.h; pose.pitch = c.pitch;
        meshes.set(slots++, pose, c.anim);
      }

      // solid on land
      for (let k = 0; k < c.circles.length; k++) {
        const s = BODY_CIRCLES[k][0], r = BODY_CIRCLES[k][1];
        const bx = x + f.x * s, bz = z + f.z * s;
        const onLand = c.wet > 0.35 && !T.isWater(bx, bz);
        collision.setDynamic(c.circles[k], bx, bz, onLand ? r : 0);
      }

      // wake where the head meets the water, and the "!" over it
      const swimming = (1 - c.wet) * Math.min(1, Math.abs(c.speed) / 0.35);
      fx.wake(c.id, x + f.x * 1.25, z + f.z * 1.25, swimming);
      c.headPosition(head);
      // the "!" goes the moment it lunges, leaving the SNAP! on its own
      fx.alert(c.id, c.alerted && c.lunge < 0, head.x + c.lx, c.y + 1.15, head.z + c.lz);

      // the effects reach further: the wake behind, the signs above
      sphere.center.set(x - f.x * 2.0, c.y + 0.6, z - f.z * 2.0);
      sphere.radius = 4.2;
      fx.show(c.id, shown && frustum.intersectsSphere(sphere));
    }
    meshes.show(slots);
    if (!haulOK) toWater(time);
    encounters(dt);

    // a croc that crawls or lunges onto a player standing still shoves them aside
    if (!kb.active && touchingPlayer()) {
      kbPos.x = player.position.x; kbPos.z = player.position.z;
      collision.resolve(kbPos);
      if (collision.isFree(kbPos.x, kbPos.z)) {
        player.position.x = kbPos.x; player.position.z = kbPos.z;
        player.position.y = collision.supportHeight(kbPos.x, kbPos.z);
        player.object.position.copy(player.position);
      }
    }

    // the knockback: a quick slide away that respects collision; player.pushed holds
    // the player's own steering off (player.frozen is left to the menus and the catch)
    if (kb.active) {
      const k0 = kb.t / kb.dur;
      kb.t = Math.min(kb.dur, kb.t + dt);
      const k1 = kb.t / kb.dur;
      const e0 = 1 - (1 - k0) * (1 - k0), e1 = 1 - (1 - k1) * (1 - k1);
      kbPos.x = player.position.x; kbPos.z = player.position.z;
      collision.move(kbPos, kb.dx * (e1 - e0), kb.dz * (e1 - e0));
      player.position.x = kbPos.x; player.position.z = kbPos.z;
      player.position.y = collision.supportHeight(kbPos.x, kbPos.z);
      if (player.velocity) player.velocity.set(0, 0, 0);
      player.speed = 0;
      player.object.position.copy(player.position);
      if (kb.t >= kb.dur) {
        kb.active = false;
        player.pushed = false;
      }
    }
    // camera shake, on top of the follow rig's placement this frame
    if (shake.t < shake.dur) {
      shake.t += dt;
      if (game.rig && game.rig.enabled) {
        const k = shake.amp * (1 - shake.t / shake.dur);
        cam.position.x += Math.sin(shake.t * 57) * k;
        cam.position.y += Math.sin(shake.t * 49 + 1.3) * k * 0.6;
        cam.position.z += Math.sin(shake.t * 63 + 2.1) * k;
      }
    }

    if (VIEW && game.rig) {
      // a check camera beside croc 0, a little ahead of it and above
      const c = crocs[0], f = fwd(c.h);
      game.rig.enabled = false;
      const side = Number(Q.get('crocside') || 1);
      const up = Number(Q.get('crocup') || 0.42);
      cam.position.set(c.x + f.x * VIEW * 0.45 - f.z * VIEW * side, c.y + 0.35 + VIEW * up, c.z + f.z * VIEW * 0.45 + f.x * VIEW * side);
      cam.position.y = Math.max(cam.position.y, T.heightAt(cam.position.x, cam.position.z) + 0.4);
      cam.lookAt(c.x + f.x * 0.3, c.y + 0.25, c.z + f.z * 0.3);
    }
    fx.update(dt * FAST, t, cam);
    updateDebugRoutes();
    if (DIAG_AT > 0 && time >= DIAG_AT) writeDiag();
  }

  let diagDone = false;
  function writeDiag() {
    if (diagDone) return;
    diagDone = true;
    let pre = document.getElementById('croc-diag');
    if (!pre) { pre = document.createElement('pre'); pre.id = 'croc-diag'; pre.hidden = true; document.body.appendChild(pre); }
    const r = game.renderer.info.render;
    pre.textContent = JSON.stringify({
      time: +time.toFixed(2), stats: api.stats, map: map.stats, frameCalls: r.calls,
      player: [+player.position.x.toFixed(2), +player.position.z.toFixed(2)],
      crocs: crocs.map((c) => ({ state: c.state, x: +c.x.toFixed(2), z: +c.z.toFixed(2), h: +c.h.toFixed(2), y: +c.y.toFixed(3), wet: +c.wet.toFixed(2), dist: +c.dist.toFixed(2), alerted: c.alerted, watch: c.watch, visible: c.visible, spot: c.spot ? c.spot.id : null, yaw: +c.anim.headYaw.toFixed(2), pitch: +c.anim.headPitch.toFixed(2) })),
      spots: map.spots,
      dynamic: collision.dynamic ? collision.dynamic.filter((d) => d[2] > 0).length : null,
      log,
    });
  }

  const api = {
    group,
    update,
    crocs,
    map,
    rules: R,
    get enabled() { return enabled; },
    // switch the hazard off during menus or a catch (a lunge that has
    // not snapped yet stops, with no penalty)
    set enabled(v) {
      enabled = !!v;
      if (!enabled) for (const c of crocs) { cancelLunge(c); calm(c); }
    },
    // false keeps them afloat (the set-up day); a croc on land slides back in
    get haul() { return haulOK; },
    set haul(v) { haulOK = !!v; if (!haulOK) toWater(time); },
    // true in the survey day: an encounter every 2 to 3 minutes (CROC_RULES.encounter)
    get director() { return director; },
    set director(v) { director = !!v; },
    // the settings' camera shake on a snap
    get shake() { return shakeOn; },
    set shake(v) { shakeOn = !!v; if (!shakeOn) shake.t = shake.dur; },
    newDay,
    sunExposure,
    hours,
    // The nearest croc to pos within maxDist (by its body line), or null.
    nearest(pos, maxDist = Infinity) {
      let best = null, bd = maxDist;
      for (const c of crocs) {
        const d = bodyDistance(c, pos.x, pos.z);
        if (d < bd) { bd = d; best = c; }
      }
      return best;
    },
    calmAll() { for (const c of crocs) { cancelLunge(c); calm(c); } },
    get stats() {
      const shown = group.visible;
      return {
        count: crocs.length,
        // this frame: bodies, outlines, effects (at most 3; none when hidden, as in the top view)
        drawCalls: shown ? (meshes.mesh.count > 0 ? 1 + (meshes.outline ? 1 : 0) : 0) + (fx.mesh.visible ? 1 : 0) : 0,
        triangles: shown ? meshes.triangles() : 0,
        trianglesPerCroc: meshes.trianglesPerCroc(),
        spots: map.spots.length,
        spotKinds: map.spots.map((s) => s.kind + (s.blocksPath ? '*' : '')).join(' '),
        swimM2: Math.round(map.stats.openM2 + map.stats.nearM2),
        mapMs: map.stats.ms,
        states: crocs.map((c) => c.state + (c.alerted ? '!' : '')).join(' '),
        warns: counts.warns, snaps: counts.snaps, calms: counts.calms,
        hauls: counts.hauls, stuck: counts.stuck, noRoute: counts.noRoute, slips: counts.slips, shy: counts.shy,
        encounters: counts.encounters, calls: counts.calls, farFromWater: counts.farFromWater, jumps: counts.jumps, quiet: Math.round(quiet), haul: haulOK, director,
      };
    },
  };
  return api;
}

// The swim map as a translucent overlay (open water blue, the approach water
// teal), the haul-out spots (the crawl line yellow, the body orange, a ring where
// it turns) for ?debug=croc.
function debugLayer(map, T) {
  const g = new THREE.Group();
  g.name = 'croc-debug';
  const px = new Uint8Array(map.w * map.h * 4);
  for (let i = 0; i < map.w * map.h; i++) {
    const c = map.cls[i];
    if (c === OPEN) px.set([40, 120, 255, 110], i * 4);
    else if (c === NEAR) px.set([0, 220, 190, 120], i * 4);
  }
  const tex = new THREE.DataTexture(px, map.w, map.h, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.flipY = false;
  const W = map.w * map.cell, H = map.h * map.cell;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(W, H).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  // PlaneGeometry's v runs from +z (bottom) to -z after the turn: flip it to rows
  const uv = plane.geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  plane.position.set(map.x0 + W / 2, 0.03, map.z0 + H / 2);
  plane.renderOrder = 11;
  g.add(plane);
  const pts = [], cols = [];
  const seg = (a, b, c) => { pts.push(...a, ...b); cols.push(...c, ...c); };
  for (const s of map.spots) {
    const fx = -Math.sin(s.hIn), fz = -Math.cos(s.hIn);
    const y = T.heightAt(s.x, s.z) + 0.25;
    seg([s.ax, 0.1, s.az], [s.x, y, s.z], [1, 1, 0.2]);
    seg([s.x - fx * 1.5, y, s.z - fz * 1.5], [s.x + fx * 1.2, y, s.z + fz * 1.2], s.kind === 'islet' ? [1, 0.4, 0.2] : [1, 0.2, 0.8]);
    if (s.turn) {
      const cx = s.x + fx * PIVOT_S, cz = s.z + fz * PIVOT_S;
      for (let k = 0; k < 24; k++) {
        const a0 = (k / 24) * Math.PI * 2, a1 = ((k + 1) / 24) * Math.PI * 2;
        seg([cx + Math.cos(a0) * 1.6, y, cz + Math.sin(a0) * 1.6], [cx + Math.cos(a1) * 1.6, y, cz + Math.sin(a1) * 1.6], [1, 0.8, 0.4]);
      }
    }
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  lg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, fog: false }));
  lines.renderOrder = 12;
  lines.frustumCulled = false;
  g.add(lines);
  return g;
}
