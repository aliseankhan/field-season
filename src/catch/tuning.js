// Catching numbers in one place: the loop pole's reach and feel, the startle rules, the
// snug-the-loop timing per species, the lizards' sizes and the catch-and-release
// steps. The main points live with the rest of the game's in src/game/rules.js.

import { RULES } from '../game/rules.js';

export const CATCH = {
  // The opening's practice lizard: its threat is held under this (a flight at 1) unless
  // the player runs, so it may stop and watch a walking player but never bolts from one
  practiceCalm: 0.9,
  // The pole: a 2.3 m bamboo pole from the hand to the tip, with the loop hanging
  // 0.215 m below the tip. The loop can reach a sphere round the shoulder (arm, pole
  // and a little slide through the hands), no further out than `out` from the body,
  // and no higher than `top` above the feet.
  reach: {
    shoulder: 0.95, // metres above the feet
    radius: 2.75, // shoulder to tip
    out: 2.5, // horizontal, body to loop
    near: 0.75, // the loop stays at least this far out
    top: 3.5, // loop above the feet
    floor: 0.08, // loop above the ground under it
    drop: 0.215, // tip to loop centre
    defaultDepth: 1.7, // where the loop sits in front with nothing to aim at
    tipSmooth: 0.085, // seconds, the pole following the pointer
    sway: 2.2, // damping of the loop's swing, per second
  },
  // A lizard is "under the loop" when the loop's centre is this near its head
  // (plus a share of its body length), and the pointer counts as on a lizard
  // within `magnet` metres of the ray (plus a share of the distance).
  over: { base: 0.1, perLength: 0.2 },
  magnet: { base: 0.22, perMetre: 0.025, pull: 0.65 },
  // Lock-on aiming (the default; "Precise aiming" in the pause card brings back the
  // pointer): holding aim picks the lizard in reach nearest the middle of the view and
  // the player (never one mostly hidden by wood), and the loop glides over its head by
  // itself, slower than `startle.safe` (in this mode only the player's own movement and
  // noise startle). Tab, the wheel or a quick sideways flick of the mouse moves to the
  // next one in reach and round to the first again; holding Tab moves to one out of
  // reach instead (one high up to spot, or one to creep up on).
  lock: {
    glide: 0.85, // m/s at most, the loop gliding over
    ease: 5, // per second, the glide easing into place
    start: 0.4, // the glide starts this share of the way from the carry point to the head
    every: 0.25, // s between looks round for a target
    angle: 1.0, distance: 0.45, // score: radians off the middle of the view, plus metres from the player
    front: 1.9, // radians either side of the camera's heading a lizard in reach may be
    lead: 12, // m, how far off the lizard the prompt points to may be
    flick: 70, // px of quick sideways mouse move that switches target
    flickDecay: 0.15, // s, how fast a slow drift is forgotten
    wheel: 40, // wheel delta for one step
    cooldown: 0.28, // s between two switches
    queue: 1.6, // s a click made while the loop glides waits for it to settle
    hold: 0.4, // s Tab is held to move to a lizard out of reach
    seen: 2, // of three points (head, middle, hips) that must be in clear view
    seenFor: 0.5, // s a lizard's view is remembered before it is looked at again
  },
  // Startle: the loop moving faster than `safe` m/s within `radius` of a lizard's
  // head adds to its threat (1 bolts, about 0.5 turns it to watch); faster than
  // `bop` within `bopRadius` and it bolts at once.
  startle: { safe: 0.9, radius: 1.4, gain: 0.55, bop: 2.6, bopRadius: 0.3 },
  // Carrying the pole out makes lizards a little warier: their flight distance is
  // multiplied by this while the player moves with it (walking, creeping).
  poleWary: { walk: 1.14, creep: 1.05 },
  // Spotting: hold the aim on a lizard (or the crocodile) this long, within range.
  spot: { hold: 0.9, range: 15, crocRange: 26, crocSafe: 7.0 },
  // Snug the loop: the ring shrinks from r0 px to rMin px over `time` s; the band
  // (the sweet spot) sits at `at` px with a half width of `band` x r0. `rounds` is
  // how many snugs it takes. Alert lizards narrow the band, displaying and unaware
  // (creeping) lizards widen it, and so does the set-up day's practice catch. A very
  // rare lizard forgives one miss a day (the loop slips and the round starts again).
  timing: {
    r0: 120, rMin: 14, at: 48, perfect: 0.34, lead: 0.4,
    alert: 0.72, unaware: 1.15, display: 1.1, recapture: 1.15, practice: 1.35,
    species: {
      cristatellus: { time: 1.5, band: 0.16, rounds: 1 },
      sagrei: { time: 1.12, band: 0.105, rounds: 1 },
      carolinensis: { time: 1.28, band: 0.12, rounds: 1 },
      distichus: { time: 0.98, band: 0.11, rounds: 1, slip: true },
      equestris: { time: 1.2, band: 0.105, rounds: 2, second: 0.95, slip: true },
    },
  },
  // Snout-vent length in mm (adults, by sex), and the smallest that can carry a
  // 0.06 g backpack.
  svl: {
    cristatellus: { m: [55, 72], f: [40, 51], pack: 46 },
    sagrei: { m: [45, 63], f: [36, 46], pack: 42 },
    carolinensis: { m: [50, 68], f: [42, 54], pack: 46 },
    distichus: { m: [40, 52], f: [35, 44], pack: 40 },
    equestris: { m: [140, 186], f: [118, 152], pack: 100 },
  },
  // Tagged lizards: a GPS fix every `fix` s of play, the trail kept to `keep` fixes.
  track: { fix: 6, keep: 80, grid: 0.5 },
  // A creep catch: the lizard was not alert in the last `creepWindow` seconds.
  creepWindow: 8,
  // The catch-and-release steps, and how steady the backpack fit must be.
  ruler: { drift: 9, driftKnight: 16, period: 2.9, spotOn: 2 }, // mm either side, seconds a sweep; spot on within 2 mm
  paint: { wriggle: 7, target: 13 },
  pack: { hold: 0.9, shake: 360, tries: 3 },
};

// The catch's points, all from RULES.points in src/game/rules.js (the one place the
// game's numbers are tuned): rarity, creep, display, first of a species, backpack and
// spotting through catchPoints(), and these small extras.
const RP = RULES.points;
export const CATCH_POINTS = {
  perfect: RP.perfectSnug, spotOn: RP.spotOn, perch: RP.perchNotes, spotCroc: RP.crocSpotted,
  recapture: RP.recapture, spot: RP.spot, backpack: RP.backpack, tape: RP.tapeHeight, gps: RP.gpsDownload,
};

export const SPECIES_NAMES = {
  cristatellus: { common: 'crested anole', sci: 'Anolis cristatellus' },
  sagrei: { common: 'brown anole', sci: 'Anolis sagrei' },
  carolinensis: { common: 'green anole', sci: 'Anolis carolinensis' },
  distichus: { common: 'bark anole', sci: 'Anolis distichus' },
  equestris: { common: 'knight anole', sci: 'Anolis equestris' },
  crocodile: { common: 'American crocodile', sci: 'Crocodylus acutus' },
};

// The recorded perch classes, as a field notebook would put them.
export const PERCH_WORDS = {
  trunk: 'tree trunk', branch: 'branch', ground: 'ground', palm_stem: 'palm trunk', root: 'roots',
  leaf: 'leaves', palm_frond: 'palm frond', log: 'log',
};

// What the player saw it sitting on, as a perch class: the drawn surface under it (a
// 'trunk' record can sit on a limb of its tree, a 'leaf' one on a twig), read the way
// the recorded classes are.
export function perchSeen(lz) {
  const s = lz.surface, p = lz.perch;
  if (s === 'bark') return p === 'palm_stem' || p === 'root' ? p : 'trunk';
  if (s === 'branch') return 'branch';
  if (s === 'leaf') return p === 'palm_frond' ? 'palm_frond' : 'leaf';
  if (s === 'ground') return p === 'root' ? 'root' : 'ground';
  if (s === 'log') return 'log';
  return p;
}

// Names for tracked lizards, shown in the notebook.
export const NICKNAMES = [
  'Pip', 'Mango', 'Biscuit', 'Clover', 'Nutmeg', 'Sprout', 'Pickle', 'Button', 'Fern', 'Toffee',
  'Moss', 'Pebble', 'Kiwi', 'Bramble', 'Hazel', 'Juniper', 'Pepper', 'Sorrel', 'Tamarind', 'Wren',
];
