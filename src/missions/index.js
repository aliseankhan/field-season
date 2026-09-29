// The field-kit missions: the drone survey, the TLS scanner and the RTK
// plant survey, each a short mini-game James offers as an optional request on the
// survey day. Each mission is its own module, src/missions/<id>.js, loaded by main.js
// as an optional system (game.missions_<id>), whose build(game) returns:
//
//   { id: 'drone' | 'tls' | 'rtk', title, tool (the tool id it registers with the ring),
//     available() -> bool, start(opts?), active: bool, update(dt, t),
//     busy: bool (in the middle of its job: the drone up, a scan set down, the pole up),
//     progress() -> { done, goal, label },          (James's requests and the HUD list)
//     notebook() -> { title, blurb, stamps: [...], render(el) },   (its notebook page)
//     stats }
//
// and emits 'mission:start' { id }, 'mission:step' { id, step }, 'mission:done'
// { id, stars (1 to 3), points } and 'mission:fail' { id, why }.
//
// This registry is loaded after them (game.missions) and is what the rest of the game
// talks to: James offers the missions (flow.js), taking one on makes it one of today's
// requests (state.today.requests, with mission: id, its goal and progress from
// progress()), the HUD's Today card lists it, the notebook's Field kit tab shows each
// mission's page, and a finished mission is scored here: `points` from mission:done
// (else RULES.points.mission by stars), the request's own points, a toast, and its
// record in state.missions[id] (saved with the notebook). A mission never calls
// addScore for its finish itself (small in-mission points, like a plant logged, are
// its own).
//
//   registerMission(m)      optional: a mission may register itself from build(); the
//                           registry also finds game.missions_<id> on its own
//   getMission(id), listMissions(), MISSION_IDS, MISSION_INFO
//   missionRecord(id)       state.missions[id]: { runs, done, best, points, data }; `data`
//                           is the mission's own (saved as plain JSON, no positions of
//                           lizards, no dates)
//   game.missions           { list(), get(id), info(id), accept(id, opts), offerable(),
//                             activeMission(), busyOther(id), request(id), record(id), update, stats }
//                           busyOther(id): another mission mid-job, which the drone waits for
//
// James's lines are SCRIPT.missions (script.js): each mission's brief,
// done[stars - 1], fail (a line, or one per why) and active (while it is under way).
//
// ?mission=drone|tls|rtk (with ?phase=survey, which it implies) starts that mission as
// the survey day begins; a mission module handles its own flag, and the registry starts
// one that is still idle 3 s into the day. window.__game.play.mission(id) takes one on
// without James's talk.

import { events } from '../core/events.js';
import { state, RULES, addScore, save } from '../game/state.js';
import { missionPoints } from '../game/rules.js';
import * as kit from '../ui/kit.js';
import { SCRIPT, say } from '../story/script.js';

export const MISSION_IDS = ['drone', 'tls', 'rtk'];

// What the game shows for each mission when the module says nothing else (and when a
// module is missing: its notebook page and James's offer fall back to these).
export const MISSION_INFO = {
  drone: { title: 'Drone survey', icon: 'drone', tool: 'drone', stamp: 'Aerial!', tone: 'blue', label: 'Fly the drone survey', short: 'Drone survey' },
  tls: { title: 'Laser scans', icon: 'tls', tool: 'tls', stamp: 'Scanned!', tone: 'blue', label: 'Make 3 laser scans', short: 'Laser scans' },
  rtk: { title: 'Plant survey', icon: 'rtk', tool: 'rtk', stamp: 'Botanist', tone: 'green', label: 'Record 5 plants with the RTK rover', short: 'Plant survey' },
};

const registered = new Map();
let game = null;

export function registerMission(m) {
  if (m && m.id) registered.set(m.id, m);
  return m;
}
export function getMission(id) {
  return registered.get(id) || (game && game['missions_' + id]) || null;
}
export function listMissions() {
  return MISSION_IDS.map(getMission).filter(Boolean);
}
export const missionInfo = (id) => MISSION_INFO[id] || { title: id, icon: 'star', tool: id, stamp: 'Done!', tone: 'blue', label: id, short: id };

// state.missions[id], made on first use
export function missionRecord(id) {
  if (!state.missions || typeof state.missions !== 'object') state.missions = {};
  let r = state.missions[id];
  if (!r || typeof r !== 'object') r = state.missions[id] = { runs: 0, done: 0, best: 0, points: 0, data: {} };
  if (!r.data || typeof r.data !== 'object') r.data = {};
  return r;
}

const params = new URLSearchParams(location.search);
const FLAG_MISSION = MISSION_IDS.includes(params.get('mission')) ? params.get('mission') : null;

export async function build(g) {
  game = g;
  const reqId = (id) => 'mission.' + id;
  const todayReq = (id) => ((state.today && state.today.requests) || []).find((r) => r.mission === id) || null;
  const safe = (fn, fallback) => { try { return fn(); } catch (e) { console.error(e); return fallback; } };
  const progressOf = (m) => {
    const p = m && typeof m.progress === 'function' ? safe(() => m.progress(), null) : null;
    return p && typeof p === 'object' ? p : null;
  };

  // Today's request for a mission, made when it is taken on (from James, the tool ring
  // or a flag), with its goal and label from the mission's progress().
  function ensureRequest(id) {
    if (state.phase !== 'survey') return null;
    let r = todayReq(id);
    if (r) return r;
    const m = getMission(id), info = missionInfo(id), p = progressOf(m);
    const goal = Math.max(1, Math.round(Number(p && p.goal) || 1));
    r = {
      id: reqId(id), mission: id, icon: info.icon,
      label: info.label, goal, n: Math.min(goal, Math.max(0, Math.round(Number(p && p.done) || 0))), done: false,
    };
    if (!state.today.requests) state.today.requests = [];
    state.today.requests.push(r);
    events.emit('request:progress', { id: r.id, n: r.n, goal: r.goal, request: r });
    return r;
  }
  function syncRequest(id) {
    const r = todayReq(id);
    if (!r || r.done) return;
    const p = progressOf(getMission(id));
    if (!p) return;
    const goal = Math.max(1, Math.round(Number(p.goal) || r.goal));
    const n = Math.min(goal, Math.max(0, Math.round(Number(p.done) || 0)));
    if (n === r.n && goal === r.goal) return;
    r.n = n; r.goal = goal;
    events.emit('request:progress', { id: r.id, n: r.n, goal: r.goal, request: r });
  }

  events.on('mission:start', (e) => {
    const id = e && e.id;
    if (!MISSION_IDS.includes(id)) return;
    const rec = missionRecord(id);
    rec.runs++;
    ensureRequest(id);
  });
  events.on('mission:step', (e) => { if (e && e.id) syncRequest(e.id); });

  // A mission finished: its points, the request's, a word from James and the record.
  // One finish gives one toast: the kit's task stamp stands for the task (tasks.js shows
  // no "Task done" toast for the kit), and James's line carries the request's points. It
  // waits for the mission's own card (the plant survey's end card, the drone's photo) to
  // close, so nothing lands over it.
  const saidLater = { queue: [], wait: 0 }; // [{ text, icon }], said one by one
  events.on('mission:done', (e) => {
    const id = e && e.id;
    if (!MISSION_IDS.includes(id)) return;
    const stars = Math.max(1, Math.min(3, Math.round(Number(e.stars) || 1)));
    const pts = Number.isFinite(Number(e.points)) && e.points != null ? Math.round(Number(e.points)) : missionPoints(stars);
    const rec = missionRecord(id);
    rec.done++;
    rec.best = Math.max(rec.best || 0, stars);
    rec.points = Math.max(rec.points || 0, pts);
    if (state.phase === 'survey') {
      addScore(pts, 'mission');
      if (!state.today.kit) state.today.kit = {};
      state.today.kit[id] = stars;
      const r = todayReq(id) || ensureRequest(id);
      let bonus = 0;
      if (r && !r.done) {
        r.n = r.goal;
        r.done = true;
        bonus = RULES.points.request;
        addScore(bonus, 'request');
        events.emit('request:done', { id: r.id, request: r });
      }
      // his line by stars; a line may be one per reason ({ named, steady }, the mission's `why`)
      const S = SCRIPT.missions && SCRIPT.missions[id];
      let line = S && S.done ? S.done[Math.max(0, Math.min(S.done.length - 1, stars - 1))] : null;
      if (line && typeof line === 'object') line = line[e.why] || line.default || Object.values(line)[0] || null;
      const plus = bonus ? ` *Request done +${bonus}*` : '';
      const text = line ? `James: ${say(line, { name: state.playerName || SCRIPT.nameFallback })}${plus}`
        : bonus ? `James's request done: ${r.label}! +${bonus}` : null;
      if (text) { saidLater.queue.push({ text, icon: line ? missionInfo(id).icon : 'star' }); saidLater.wait = 0.6; }
    }
    save();
  });
  // (the day ending first: the summary says it all)
  events.on('phase:change', () => { saidLater.queue.length = 0; });
  events.on('mission:fail', (e) => {
    const id = e && e.id;
    if (!MISSION_IDS.includes(id) || state.phase !== 'survey') return;
    const S = SCRIPT.missions && SCRIPT.missions[id];
    // his line, or one per reason ({ water, battery, ... }; `default` for the rest)
    const f = S && S.fail;
    const line = f && typeof f === 'object' ? f[e.why] || f.default || null : f;
    if (line) kit.toast(`James: ${say(line, { name: state.playerName || SCRIPT.nameFallback })}`, { icon: missionInfo(id).icon, tone: 'warn', ms: 4200 });
  });

  // James's offer: the missions he can hand out now (in the survey day, not running,
  // not done today, and the module says it is available).
  function offerable() {
    if (state.phase !== 'survey') return [];
    const out = [];
    for (const id of MISSION_IDS) {
      const m = getMission(id);
      if (!m || m.active) continue;
      const r = todayReq(id);
      if (r && r.done) continue;
      if (typeof m.available === 'function' && !safe(() => m.available(), false)) continue;
      out.push(m);
    }
    return out;
  }
  // another mission in the middle of its job (a scan sweeping, a pole up, the drone in
  // the air), which one mission's start waits for: returns it, or null
  function busyOther(id) {
    for (const k of MISSION_IDS) {
      if (k === id) continue;
      const m = getMission(k);
      if (m && m.busy) return m;
    }
    return null;
  }
  function activeMission() {
    for (const id of MISSION_IDS) { const m = getMission(id); if (m && m.active) return m; }
    return null;
  }
  // Take a mission on: today's request, then the mission starts (it takes out its own
  // tool). Returns true when it started.
  function accept(id, opts = {}) {
    const m = getMission(id);
    if (!m || state.phase !== 'survey') return false;
    if (m.active) return true;
    ensureRequest(id);
    try { m.start({ from: 'james', ...opts }); } catch (e) { console.error(e); return false; }
    return true;
  }

  // ?mission=<id>: once the survey day is running, a mission its own module has not
  // started yet is started here
  const clocks = { flag: FLAG_MISSION ? 0 : -1, sync: 0 }; // (timers on an object: no boxed number a frame)
  function update(dt) {
    if (clocks.flag >= 0 && state.phase === 'survey' && state.clock.running) {
      clocks.flag += dt;
      if (clocks.flag > 3) {
        clocks.flag = -1;
        const m = getMission(FLAG_MISSION);
        if (m && !m.active && !(todayReq(FLAG_MISSION) || {}).done) accept(FLAG_MISSION, { from: 'flag', debug: true });
      }
    }
    // James's word on a finished job, once its card has closed
    if (saidLater.queue.length) {
      if (kit.modalKind() === 'minigame' || kit.modalKind() === 'panel') saidLater.wait = 0.6;
      else if ((saidLater.wait -= dt) <= 0) {
        const s = saidLater.queue.shift();
        kit.toast(s.text, { icon: s.icon, tone: 'good', ms: 4600 });
        saidLater.wait = 1.2;
      }
    }
    // keep each running mission's request in step (a cheap look, twice a second)
    clocks.sync -= dt;
    if (clocks.sync <= 0) {
      clocks.sync = 0.5;
      for (const id of MISSION_IDS) { const m = getMission(id); if (m && m.active) syncRequest(id); }
    }
  }

  game.play = Object.assign(game.play || {}, {
    mission: (id) => accept(id, { from: 'play' }),
    missions: () => MISSION_IDS.map((id) => ({ id, loaded: !!getMission(id), active: !!(getMission(id) && getMission(id).active), request: todayReq(id), record: state.missions && state.missions[id] })),
  });

  return {
    list: listMissions,
    get: getMission,
    info: missionInfo,
    record: missionRecord,
    request: todayReq,
    accept,
    offerable,
    activeMission,
    busyOther,
    update,
    get stats() {
      return {
        loaded: MISSION_IDS.filter((id) => !!getMission(id)),
        active: (activeMission() || {}).id || null,
        drawCalls: 0,
      };
    },
  };
}
