// Research tasks: a few per species in the notebook, the
// opening's jobs and a little field work, each with a stamp when done. Progress
// comes from game events; state.tasks[id] = { n, done, ids? } is saved with the
// notebook. Each task: { id, group ('setup', 'species' or 'field'), species?, label,
// stamp (the stamp's short word), goal, on (event name), test(e, lizard) }. A set-up
// task marked optional is a bonus stamp that skipping the day does not give.
//
// The field kit's tasks (group 'kit') stamp the first finish of each
// mission (src/missions) and a three-star finish.
//
// James's requests: every survey day (state.js emits 'day:new') RULES.requestsPerDay
// small jobs are drawn from REQUESTS into state.today.requests ({ id, label, goal, n,
// done }); each is worth RULES.points.request once, that day only.
//
//   buildTasks(game) -> { update(dt), list, progress(id), requests }
//   events: task:progress { id, n, goal, task }, task:done { id, task },
//           request:progress { id, n, goal, request }, request:done { id, request }

import { events } from '../core/events.js';
import { state, RULES, addScore, perchHeight, speciesKey } from './state.js';
import * as kit from '../ui/kit.js';

const lizardOf = (e) => (e && e.lizard ? e.lizard : e);
const isSp = (sp) => (e) => { const lz = lizardOf(e); return !!lz && speciesKey(lz.species) === sp; };
const displayOf = (e) => {
  const b = e && e.bonus;
  return (b && typeof b === 'object' && b.display) || (typeof b === 'string' ? b : null) || (e && e.display) || null;
};
const onGround = (lz) => lz && (lz.perch === 'ground' || lz.perch === 'log');
const onLeaves = (lz) => lz && (lz.perch === 'leaf' || lz.perch === 'palm_frond');

export const TASKS = [
  // the opening, in its order: the kit the ibises scattered, the station
  // put right, a fresh loop and a practice catch (no points; the HUD's checklist)
  { id: 'setup.kit', group: 'setup', label: 'Find the kit the ibises scattered', stamp: 'All found!', goal: 5, on: 'kit:found', unique: (e) => (e && e.id) || null },
  { id: 'setup.station', group: 'setup', label: 'Set the field station to rights', stamp: 'Station', goal: 1, on: 'setup:station' },
  { id: 'setup.floss', group: 'setup', label: 'Tie a fresh floss loop on the pole', stamp: 'Loop', goal: 1, on: 'setup:floss' },
  { id: 'setup.practice', group: 'setup', label: 'Try the loop pole on a practice catch', stamp: 'Practice', goal: 1, on: 'setup:practice' },

  // research tasks per species
  { id: 'crested.catch', group: 'species', species: 'crested', label: 'Catch 5 crested anoles', stamp: 'Crested', goal: 5, on: 'lizard:caught', test: isSp('crested') },
  { id: 'crested.dewlap', group: 'species', species: 'crested', label: 'Catch one mid dewlap flash', stamp: 'Dewlap!', goal: 1, on: 'lizard:caught', test: (e) => isSp('crested')(e) && displayOf(e) === 'dewlap' },
  { id: 'crested.tag', group: 'species', species: 'crested', label: 'Fit backpacks on 3 crested anoles', stamp: 'Tagged', goal: 3, on: 'lizard:tagged', test: isSp('crested') },
  { id: 'brown.ground', group: 'species', species: 'brown', label: 'Catch 3 brown anoles on the ground', stamp: 'Brown', goal: 3, on: 'lizard:caught', test: (e) => isSp('brown')(e) && onGround(lizardOf(e)) },
  { id: 'brown.tag', group: 'species', species: 'brown', label: 'Fit a backpack on a brown anole', stamp: 'Tagged', goal: 1, on: 'lizard:tagged', test: isSp('brown') },
  { id: 'green.leaves', group: 'species', species: 'green', label: 'Spot a green anole on the leaves', stamp: 'Spotted', goal: 1, on: 'lizard:spotted', test: (e) => isSp('green')(e) && (e.onLeaves ?? onLeaves(lizardOf(e))) },
  { id: 'green.catch', group: 'species', species: 'green', label: 'Catch a green anole', stamp: 'Green', goal: 1, on: 'lizard:caught', test: isSp('green') },
  { id: 'bark.spot', group: 'species', species: 'bark', label: 'Spot a bark anole', stamp: 'Spotted', goal: 1, on: 'lizard:spotted', test: isSp('bark') },
  { id: 'bark.catch', group: 'species', species: 'bark', label: 'Catch 3 bark anoles', stamp: 'Bark', goal: 3, on: 'lizard:caught', test: isSp('bark') },
  { id: 'knight.canopy', group: 'species', species: 'knight', label: 'Spot a knight anole up in the canopy', stamp: 'Spotted', goal: 1, on: 'lizard:spotted', test: (e) => isSp('knight')(e) && (e.canopy ?? perchHeight(lizardOf(e)) >= 2.5) },
  { id: 'knight.tag', group: 'species', species: 'knight', label: 'Fit a backpack on a knight anole', stamp: 'Knight!', goal: 1, on: 'lizard:tagged', test: isSp('knight') },
  { id: 'croc.spot', group: 'species', species: 'croc', label: 'Spot the crocodile from a safe distance', stamp: 'Croc!', goal: 1, on: 'croc:spotted', test: (e) => !e || e.safe !== false },

  // field work
  // (a logger stands on every one of the 12 grid flags, src/tools/loggers.js; each downloads as you pass)
  { id: 'field.loggers', group: 'field', label: 'Download every temperature logger in one day', stamp: 'Readings', goal: 12, on: 'logger:read', unique: (e) => (e && e.id ? e.id + ':' + (state.days + 1) : null), perDay: true },
  { id: 'field.display', group: 'field', label: 'Catch a lizard mid head bob, push-up or dewlap', stamp: 'Showtime', goal: 1, on: 'lizard:caught', test: (e) => !!displayOf(e) },
  { id: 'field.creep', group: 'field', label: 'Catch 3 lizards before they notice you', stamp: 'Sneaky', goal: 3, on: 'lizard:caught', test: (e) => { const b = e && e.bonus; return !!(b && (b.creep || b === 'creep')); } },
  { id: 'field.tape', group: 'field', label: 'Tape 3 perch heights before the catch', stamp: 'Taped', goal: 3, on: 'lizard:caught', test: (e) => !!(e && e.taped) },
  { id: 'field.gps', group: 'field', label: 'Download a tagged lizard\'s GPS track', stamp: 'Tracked', goal: 1, on: 'gps:download' },

  // perch loggers (src/tools/perch_loggers.js): clipped on a released lizard's perch,
  // downloaded by walking past; the notebook's "Followed lizards" pages show them too
  { id: 'perch.sunshade', group: 'field', icon: 'thermometer', label: 'Clip loggers on a sunny perch and a shady one', stamp: 'Sun & shade', goal: 2, on: 'perch:clip', unique: (e) => (e && (e.kind === 'sunny' || e.kind === 'shady') ? e.kind : null) },
  { id: 'perch.wholeday', group: 'field', icon: 'thermometer', label: 'Follow one lizard all day: clip before 10:00, download after 16:00', stamp: 'All day!', goal: 1, on: 'perch:download', test: (e) => !!(e && e.whole) },
  { id: 'perch.species', group: 'field', icon: 'thermometer', label: 'Clip loggers on the perches of three different species', stamp: 'Perch trio', goal: 3, on: 'perch:clip', unique: (e) => (e && e.species) || null },

  // the field kit (src/missions): each mission finished once, and a
  // three-star finish on any of them
  { id: 'kit.drone', group: 'kit', mission: 'drone', icon: 'drone', label: 'Fly the drone survey', stamp: 'Aerial!', goal: 1, on: 'mission:done', test: (e) => !!e && e.id === 'drone' },
  { id: 'kit.tls', group: 'kit', mission: 'tls', icon: 'tls', label: 'Make 3 laser scans', stamp: 'Scanned!', goal: 1, on: 'mission:done', test: (e) => !!e && e.id === 'tls' },
  { id: 'kit.rtk', group: 'kit', mission: 'rtk', icon: 'rtk', label: 'Record 5 plants with the RTK rover', stamp: 'Botanist', goal: 1, on: 'mission:done', test: (e) => !!e && e.id === 'rtk' },
  { id: 'kit.stars', group: 'kit', icon: 'star', label: 'Three stars on a field-kit job', stamp: 'Top kit', goal: 1, on: 'mission:done', test: (e) => !!e && Number(e.stars) >= 3 },

  // the brown basilisks (src/wildlife/basilisk.js), last so the Today card picks them only
  // when nothing else is open; the notebook shows them once a basilisk has been seen
  { id: 'basilisk.catch', group: 'species', species: 'basilisk', label: 'Catch a brown basilisk', stamp: 'Basilisk!', goal: 1, on: 'lizard:caught', test: isSp('basilisk') },
  { id: 'basilisk.water', group: 'species', species: 'basilisk', label: 'Watch a basilisk run across the water', stamp: 'Water runner', goal: 1, on: 'basilisk:waterrun' },
];

// James's requests, a few drawn each survey day. when(state): offered at all today.
// make(): for a request drawn fresh each day (its label and the fields it keeps, such as
// the flag it names), { label, extra } or null to leave it out today; test(e, request).
const caughtSp = (sp) => (e) => isSp(sp)(e);
let gameRef = null; // the game, for the requests that read the flags and the loggers' map
const homeOf = (e) => { const lz = lizardOf(e); return lz ? lz.home || lz.pos || null : null; };
// in a warm patch of the loggers' map (fresh), where it perches
const inWarmPatch = (e) => {
  const h = homeOf(e), lg = gameRef && gameRef.tools && gameRef.tools.loggers;
  return !!(h && lg && lg.patchAt && lg.patchAt(h.x, h.z) === 'warm');
};
// "Catch a brown anole near D05": a species with a few perches near one of the flags
const nearFlagRequest = () => {
  const F = gameRef && gameRef.tools && gameRef.tools.flags;
  const p = F && F.requestPick ? F.requestPick(Math.random) : null;
  return p ? { label: `Catch a ${p.word} near ${p.flag}`, extra: { flag: p.flag, key: p.key, radius: 8 } } : null;
};
const nearFlagCaught = (e, r) => {
  const F = gameRef && gameRef.tools && gameRef.tools.flags, h = homeOf(e), lz = lizardOf(e);
  if (!F || !h || !lz || !r || !r.flag || speciesKey(lz.species) !== r.key) return false;
  const s = gameRef.stakes && gameRef.stakes.byId.get(r.flag);
  return !!s && Math.hypot(s.x - h.x, s.z - h.z) <= (r.radius || 8) + 1;
};
export const REQUESTS = [
  { id: 'req.brown2', label: 'Catch 2 brown anoles', goal: 2, on: 'lizard:caught', test: caughtSp('brown') },
  { id: 'req.crested3', label: 'Catch 3 crested anoles', goal: 3, on: 'lizard:caught', test: caughtSp('crested') },
  { id: 'req.rare', label: 'Catch a green, bark or knight anole', goal: 1, on: 'lizard:caught', test: (e) => isSp('green')(e) || isSp('bark')(e) || isSp('knight')(e) },
  { id: 'req.ground', label: 'Catch a lizard on the ground or a log', goal: 1, on: 'lizard:caught', test: (e) => onGround(lizardOf(e)) },
  { id: 'req.creep2', label: 'Catch 2 lizards before they notice you', goal: 2, on: 'lizard:caught', test: (e) => !!(e && e.bonus && e.bonus.creep) },
  { id: 'req.show', label: 'Catch one mid display', goal: 1, on: 'lizard:caught', test: (e) => !!displayOf(e) },
  { id: 'req.noon3', label: 'Download 4 loggers before noon', goal: 4, on: 'logger:read', test: (e) => !!e && e.hours < 12, unique: (e) => e && e.id },
  { id: 'req.loggers4', label: 'Download 6 different loggers', goal: 6, on: 'logger:read', unique: (e) => e && e.id },
  { id: 'req.warm', label: 'Catch a lizard in a warm patch on your map', goal: 1, on: 'lizard:caught', test: inWarmPatch },
  { id: 'req.flag', label: 'Catch a lizard near a flag', goal: 1, on: 'lizard:caught', make: nearFlagRequest, test: nearFlagCaught },
  { id: 'req.packs2', label: 'Fit 2 backpacks', goal: 2, on: 'lizard:tagged' },
  { id: 'req.spot6', label: 'Spot 6 lizards', goal: 6, on: 'lizard:spotted', test: (e) => !(e && e.quiet) },
  { id: 'req.tape2', label: 'Tape 2 perch heights', goal: 2, on: 'tape:measured' },
  { id: 'req.gps', label: 'Download a GPS track', goal: 1, on: 'gps:download', when: (st) => st.tracked.length > 0 },
];

export function buildTasks(game) {
  gameRef = game;
  const byId = new Map(TASKS.map((t) => [t.id, t]));
  const reqById = new Map(REQUESTS.map((r) => [r.id, r]));
  const rec = (id) => state.tasks[id] || (state.tasks[id] = { n: 0, done: false });

  function bump(task, e) {
    const r = rec(task.id);
    if (r.done) return;
    if (task.unique) {
      const key = task.unique(e);
      if (!key) return;
      r.ids = r.ids || [];
      if (task.perDay) r.ids = r.ids.filter((k) => k.endsWith(':' + (state.days + 1)));
      if (r.ids.includes(key)) return;
      r.ids.push(key);
      r.n = r.ids.length;
    } else {
      r.n++;
    }
    events.emit('task:progress', { id: task.id, n: r.n, goal: task.goal, task });
    if (r.n >= task.goal) {
      r.done = true;
      r.n = task.goal;
      if (task.group !== 'setup') addScore(RULES.points.task, 'task');
      events.emit('task:done', { id: task.id, task });
      kit.stamp(task.stamp || 'Done', {
        tone: task.group === 'setup' ? 'green' : task.group === 'kit' ? 'blue' : task.species === 'knight' || task.species === 'bark' || task.species === 'basilisk' ? 'gold' : 'red',
        icon: task.icon || (task.species === 'croc' ? 'croc' : task.group === 'setup' ? 'check' : 'lizard'),
      });
      // (a field-kit job's stamp stands for its task: James's word on it is its one toast)
      // (the opening's steps have James's own words; their stamps are enough)
      if (task.group !== 'kit' && task.group !== 'setup') kit.toast(`Task done: ${task.label}`, { icon: 'star', tone: 'gold' });
    }
  }

  // ---- James's requests for the day
  function drawRequests(today) {
    const pool = REQUESTS.filter((r) => !r.when || r.when(state));
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const out = [];
    const on = new Set();
    for (const r of pool) {
      if (out.length >= RULES.requestsPerDay) break;
      // no two about the same kind of thing (two logger requests, two backpack ones)
      const kind = r.on === 'lizard:caught' ? r.id : r.on;
      if (on.has(kind)) continue;
      on.add(kind);
      let made = null;
      if (r.make) { try { made = r.make(); } catch (e) { made = null; } if (!made) continue; }
      out.push({ id: r.id, label: made ? made.label : r.label, goal: r.goal, n: 0, done: false, ...(made && made.extra) });
    }
    today.requests = out;
  }
  events.on('day:new', (today) => drawRequests(today || state.today));

  function bumpRequest(r, e) {
    const def = reqById.get(r.id);
    if (!def || r.done) return;
    if (def.unique) {
      const key = def.unique(e);
      if (!key) return;
      r.ids = r.ids || [];
      if (r.ids.includes(key)) return;
      r.ids.push(key);
      r.n = r.ids.length;
    } else r.n++;
    events.emit('request:progress', { id: r.id, n: r.n, goal: r.goal, request: r });
    if (r.n >= r.goal) {
      r.done = true;
      r.n = r.goal;
      addScore(RULES.points.request, 'request');
      events.emit('request:done', { id: r.id, request: r });
      kit.toast(`James's request done: ${r.label}! +${RULES.points.request}`, { icon: 'star', tone: 'gold' });
    }
  }
  const reqEvents = new Set(REQUESTS.map((r) => r.on));
  for (const name of reqEvents) {
    events.on(name, (e) => {
      if (state.phase !== 'survey') return;
      const list = state.today.requests || [];
      for (const r of list) {
        const def = reqById.get(r.id);
        if (!def || def.on !== name) continue;
        try { if (!def.test || def.test(e, r)) bumpRequest(r, e); } catch (err) { console.error(err); }
      }
    });
  }

  const byEvent = new Map();
  for (const t of TASKS) {
    if (!byEvent.has(t.on)) byEvent.set(t.on, []);
    byEvent.get(t.on).push(t);
  }
  for (const [name, list] of byEvent) {
    events.on(name, (e) => {
      const setup = name === 'setup:floss' || name === 'setup:station' || name === 'setup:practice' || name === 'kit:found';
      if (!setup && state.phase !== 'survey') return;
      for (const t of list) {
        try { if (!t.test || t.test(e)) bump(t, e); } catch (err) { console.error(err); }
      }
    });
  }

  if (!state.today.requests || !state.today.requests.length) drawRequests(state.today);

  return {
    list: TASKS,
    byId,
    requests: REQUESTS,
    progress(id) { const r = state.tasks[id]; return r ? { ...r, goal: byId.get(id)?.goal } : { n: 0, done: false, goal: byId.get(id)?.goal }; },
    update() {},
  };
}
