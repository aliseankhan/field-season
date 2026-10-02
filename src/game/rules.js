// Every number the field season plays by, in one place: the day's length, what
// you carry, the points, the colours on offer and the loggers' weather. Edit here
// to tune; nothing else in the game hard-codes these.

export const RULES = {
  // The survey day runs 07:30 to 18:30 game time over dayMinutes real minutes
  // (?fast=n multiplies the pace). The opening (the kit hunt and the practice catch,
  // the same morning) holds the clock at setupHours, the survey day's start.
  // The sky follows the clock gently squeezed into skyHours, so the day opens and
  // closes in golden light rather than at sunrise and sunset (07:25 and 18:40 in late
  // October), and the lizards (which read the sky's hours) are never put to bed.
  day: { start: 7.5, end: 18.5, dayMinutes: 12, setupHours: 7.5, titleHours: 9.5, skyHours: [8.4, 17.9] },

  // What goes out in the field bag each survey day.
  // (perch: the button loggers clipped on the perches of released lizards)
  inventory: { backpacks: 5, flags: 12, loggers: 5, perch: 3 },

  points: {
    // a catch: rarity points, plus bonuses the catch flow adds up (see catchPoints)
    rarity: { common: 10, uncommon: 25, rare: 50, 'very rare': 100 },
    creep: 15, // caught without it ever noticing you
    display: 30, // caught mid head bob, push-up or dewlap flash
    firstOfSpecies: 40, // the first of its species in the notebook
    backpack: 40, // a GPS backpack fitted
    spot: 5, // a first sighting today (spotting only)
    task: 100, // a research task stamped
    loggerRead: 15, // a logger read
    // the catch's small extras
    perfectSnug: 10, // the loop snugged right in the gold
    spotOn: 5, // a snout-vent length read within 2 mm
    perchNotes: 5, // the perch noted right
    crocSpotted: 25, // the crocodile spotted from a safe distance
    recapture: 5, // caught again the same day (a quick look and back it goes)
    // the same species again the same day: its rarity points times this, by how many
    // of it were caught before today (the very rare ones sit close to the landing)
    repeat: [1, 1, 0.5, 0.5, 0.25],
    request: 50, // one of James's requests for the day done
    gpsDownload: 15, // a tagged lizard's GPS fixes downloaded
    perchClip: 10, // a perch logger clipped on a released lizard's perch (3 a day)
    perchDownload: 15, // a perch logger's first download (a later one, a third of it)
    tapeHeight: 5, // a perch height taped before the catch
    flagPlaced: 0, // set-up day is untimed; stamps, no points
    croc: -50, // the crocodile's snap (and the seconds it costs are in croc.rules)
    carelessBreak: -25, // a loop pole broken by stubbing it (not the first break: that one's free)
    // the field kit's missions (src/missions): a finished mission scores by its stars
    // (1 to 3) on top of the request's own 50; the plant survey adds a little per plant
    mission: [0, 40, 80, 120],
    plant: 10, // a plant recorded with the RTK rover
    plantName: 10, // and its name picked right
    scan: 10, // a laser scan landed, per star (1 to 3)
  },

  // The field kit's missions (src/missions). James offers them on the survey
  // day; each is one of his requests once taken on.
  missions: {
    // the RTK plant survey: plants a day, how long each stage of the fix takes with the
    // pole held still (seconds), and the stars (named right, steadiness)
    rtk: {
      plants: 5,
      fix: { single: 1.5, float: 3.2 }, // SINGLE for 1.5 s, then FLOAT for 3.2 s, then FIX
      stars: { named: 4, steady: 2 }, // a star for 4 of 5 named right, one for 2 wobbles or fewer
    },
  },

  // James's requests: this many a day, drawn from the pool in tasks.js.
  requestsPerDay: 3,

  // James's line at the end of the day, banded on the day's work rather than the score
  // (which the one-time task stamps swell on the first day): a band is reached when
  // the catches, the species caught and the requests done all meet it.
  summaryBands: [
    ['great', { caught: 8, species: 3, requests: 2 }],
    ['good', { caught: 4, species: 2, requests: 1 }],
    ['ok', { caught: 1, species: 1, requests: 0 }],
  ],

  // The croc's snap costs this much of the day (real seconds of clock time).
  crocSeconds: 20,

  // Loops that snap and poles that break (src/catch/breaks.js), survey day only. Odds are
  // per missed snug, per bop, or per stub; `tell` is how long the creak or the fraying
  // shows before anything goes (seconds); a canopy break needs a lizard this high (m) on
  // branches or leaves; a stub is a jog stopped dead by something solid, or the loop
  // driven into the ground at `ground` m/s or more.
  breaks: { loop: 0.2, loopKnight: 0.3, canopy: 0.1, canopyHeight: 2, careless: 0.3, tell: 0.6, ground: 2.6 },

  // Jon (src/story/jon.js): at most `most` visits a day, `gap` game hours apart (the re-tie
  // may come sooner; an hour is about a minute of play), and a hint as a note at most one
  // every `noteGap` game hours when he cannot come; a spot `near` metres from the player, a nudge after `nudge` game hours with no catch, and `spares` backpacks once all
  // five are fitted. A backpack word comes when today's fits include `sameSpecies` of that
  // species, or the last `sameArea` fits were all within `area` metres of this lizard.
  jon: { gap: 3, most: 3, noteGap: 2, near: [3, 6], nudge: 2, spares: 2, sameSpecies: 2, sameArea: 2, area: 15 },

  // James's word on the radio towards a field job not done yet (flow.js): after `catches`
  // catches in the day, or `since` since the last field job, at most `most` a day and
  // `gap` game hours apart.
  kitNudge: { catches: 8, since: 6, most: 2, gap: 1.5 },

  // Rarity from the lab's real record counts.
  rarity: {
    crested: { records: 6330, rarity: 'common' },
    brown: { records: 631, rarity: 'uncommon' },
    green: { records: 233, rarity: 'rare' },
    bark: { records: 39, rarity: 'very rare' },
    knight: { records: 27, rarity: 'very rare' },
    croc: { records: 0, rarity: 'rare' },
    basilisk: { records: 11, rarity: 'very rare' }, // the spring 2026 survey's (data/basilisks.json)
  },

  // Backpack colours handed out in turn, one per tagged lizard.
  backpackColours: ['#ff5fa2', '#ffd23f', '#3fc4ff', '#8cff5a', '#c07bff', '#ff8a3d', '#5affd8', '#ff4d4d'],

  // The avatar's looks on offer in the intro (the first of each is the default).
  looks: {
    hats: [
      { name: 'Sand', colour: '#f2dca0' },
      { name: 'Sunflower', colour: '#ffcf3f' },
      { name: 'Coral', colour: '#ff8a6b' },
      { name: 'Leaf', colour: '#7cc05a' },
      { name: 'Sky', colour: '#6fc3ef' },
      { name: 'Lilac', colour: '#b9a3e8' },
    ],
    shirts: [
      { name: 'Sky', colour: '#7cc7f0' },
      { name: 'Mint', colour: '#8fe0bf' },
      { name: 'Peach', colour: '#ffb38a' },
      { name: 'Lemon', colour: '#ffe27a' },
      { name: 'Rose', colour: '#ff9ec4' },
      { name: 'Lavender', colour: '#c4b0ff' },
    ],
  },

  // Distances in metres for jobs in the world (gps: downloading a tagged lizard's pack,
  // tape: a lizard's perch height).
  reach: { flag: 1.9, logger: 1.9, james: 2.4, station: 2.6, suggest: 4.5, gps: 6, tape: 3 },

  // A logger can be read again once this many game hours have passed.
  loggerReadEvery: 1.5,

  // The loggers' simulated microclimate, degrees C. A late-October day in Miami:
  // a gentle curve from the dawn low to an early-afternoon high, warmer in sun,
  // cooler in shade and next to the lake.
  climate: {
    low: 23.2, high: 28.6, lowHour: 6.5, highHour: 14.5,
    sun: 3.2, // extra at full sun and a high sun, open ground
    shade: -0.8, // under a full canopy (12 m or more of trees overhead)
    water: -0.9, // right beside the water, fading out by 6 m
    wobble: 0.25, // a little noise between readings
  },
};

// Points for a finished field-kit mission by its stars (1 to 3).
export function missionPoints(stars) {
  const P = RULES.points.mission;
  const k = Math.max(1, Math.min(P.length - 1, Math.round(Number(stars) || 1)));
  return P[k] || 0;
}

// Points for one catch: parts the catch flow can show, and their total.
//   opts: { alerted: bool, display: null | 'headbob' | 'pushup' | 'dewlap', first: bool,
//           backpack: bool, today: how many of this species were caught earlier today }
export function catchPoints(species, opts = {}) {
  const P = RULES.points;
  const r = RULES.rarity[species] ? RULES.rarity[species].rarity : 'common';
  const rep = P.repeat, n = Math.max(0, Math.floor(opts.today || 0));
  const k = rep[Math.min(n, rep.length - 1)];
  const parts = [{ reason: r, points: Math.round((P.rarity[r] || 0) * k), repeat: k < 1 }];
  if (!opts.alerted) parts.push({ reason: 'creep', points: P.creep });
  if (opts.display) parts.push({ reason: 'display', points: P.display });
  if (opts.first) parts.push({ reason: 'first', points: P.firstOfSpecies });
  if (opts.backpack) parts.push({ reason: 'backpack', points: P.backpack });
  let total = 0;
  for (const p of parts) total += p.points;
  return { parts, total };
}
