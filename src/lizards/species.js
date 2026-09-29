// The five anoles as behaviour numbers. Sizes are the game size (about twice real,
// the male; anole.js draws females a little smaller), distances in metres, speeds in
// m/s, rates in bouts per minute (snap: bug snaps, shuffle: small turns on the spot;
// blinks and tail flicks are the renderer's). The look lives in anole.js; this file
// only says how each species lives, notices and runs.
//
// Flight distance: a lizard flees when the player is closer than
//   fid[perch] * noise * approach * facing * sight * behind * height * mood * habit
// where noise is 0.58 creeping, 1 walking and 2.2 running (from player.noise), approach
// 1 for walking straight at it, facing 1 when the player faces it, behind 0.75 when the
// player comes up behind a lizard on an open perch. It turns to watch (alert) at
// alertRatio times that distance, and once alert it is `sensitise` times jumpier, so a
// creeping player has to stop while it watches. Each time an alert lizard settles
// without running it gets bolder (habit), which is what lets a patient player close in.
// Straight at a calm crested anole on a trunk it turns to watch at about 2.6 m creeping
// and runs at about 1.8 to 2.1 m, so a creeper reaches the loop pole's 2.5 m (CATCH.reach)
// before it runs; walking, 4.5 m and 3.1 m; running, 9.4 m and 6.9 m. The time of day
// moves these a little (THERMAL): a basking lizard on the ground or a low branch runs
// at about 2 to 2.2 m creeping, one in the shade a little later. (Measured by a
// scripted approach test at sky hours 8.7, 10.5 and 12.7.)

export const SPECIES_ORDER = ['cristatellus', 'sagrei', 'carolinensis', 'distichus', 'equestris'];

export const SPECIES_INFO = {
  cristatellus: {
    common: 'crested anole',
    length: 0.38, // snout to tail tip at game size
    weight: 1.0, // encounter weight: how far away a slot will still reach for one
    fid: { perch: 2.8, ground: 2.9 },
    alertRatio: 1.9,
    sensitise: 1.35,
    speed: 2.2, // dash
    walk: 0.45, // walking back
    climb: [0.2, 0.45], // how far up the trunk it goes when darting round
    headDown: 0.65, // chance of resting head down on a trunk
    style: 'round', // dart round to the far side of the trunk
    hide: [5, 9], // seconds before it comes back
    display: { m: 3.0, f: 0.7 }, // display bouts per minute
    mix: { headbob: 0.4, pushup: 0.3, dewlap: 0.3 },
    alertDisplay: { m: 0.55, f: 0.15 }, // chance of a dewlap at the player when alert
    snap: 1.0, shuffle: 0.8,
    flattenAlert: 0.25,
    tintAlert: 0.35,
    heat: 1.0, // the sun it takes in the heat of the day, times THERMAL.sunny
  },
  sagrei: {
    common: 'brown anole',
    length: 0.34,
    weight: 1.1,
    fid: { perch: 2.9, ground: 3.5 }, // flighty, most of all on the ground
    alertRatio: 1.8,
    sensitise: 1.4,
    speed: 3.0,
    walk: 0.55,
    climb: [0.15, 0.35],
    headDown: 0.6,
    style: 'dash', // on the ground, dash to cover; on a trunk, round like the crested
    hide: [7, 12],
    display: { m: 2.6, f: 0.6 },
    mix: { headbob: 0.35, pushup: 0.25, dewlap: 0.4 },
    alertDisplay: { m: 0.35, f: 0.1 },
    snap: 1.6, shuffle: 1.2,
    flattenAlert: 0.15,
    tintAlert: 0.4,
    heat: 1.25, // takes the heat best
  },
  carolinensis: {
    common: 'green anole',
    length: 0.36,
    weight: 1.0,
    fid: { perch: 2.7, ground: 3.0 },
    alertRatio: 1.9,
    sensitise: 1.35,
    speed: 1.9,
    walk: 0.4,
    climb: [0.6, 1.4], // up into the crown
    headDown: 0.3,
    style: 'climb', // climb higher into the crown or hop into the leaves
    hide: [6, 11],
    display: { m: 1.5, f: 0.5 },
    mix: { headbob: 0.3, pushup: 0.2, dewlap: 0.5 },
    alertDisplay: { m: 0.4, f: 0.1 },
    snap: 1.0, shuffle: 0.6,
    flattenAlert: 0.1,
    tintAlert: 0.6, // green goes brown when stressed
    heat: 0.85, // the first into the shade
  },
  distichus: {
    common: 'bark anole',
    length: 0.26,
    weight: 1.3,
    fid: { perch: 3.2, ground: 3.4 }, // wary: cryptic until it is sure, then gone
    alertRatio: 1.6,
    sensitise: 1.45,
    speed: 2.5,
    walk: 0.4,
    climb: [0.15, 0.35],
    headDown: 0.5,
    style: 'scuttle', // flatten and scuttle round the trunk
    restFlatten: 0.55, // pressed flat to the wood even at rest
    hide: [9, 15],
    display: { m: 1.0, f: 0.4 },
    mix: { headbob: 0.5, pushup: 0.2, dewlap: 0.3 },
    alertDisplay: { m: 0.1, f: 0.0 },
    snap: 0.8, shuffle: 0.5,
    flattenAlert: 0.9,
    tintAlert: 0.2,
    heat: 0.9, // likes dappled bark
  },
  equestris: {
    common: 'knight anole',
    length: 0.8,
    weight: 1.15,
    fid: { perch: 2.0, ground: 2.2 }, // slow and bold
    alertRatio: 2.2,
    sensitise: 1.3,
    speed: 0.9,
    walk: 0.3,
    climb: [0.6, 1.2],
    headDown: 0.4,
    style: 'climb',
    cornered: 1.6, // closer than this when it would flee: it gapes instead
    hide: [4, 8],
    display: { m: 0.8, f: 0.4 },
    mix: { headbob: 0.2, pushup: 0.2, dewlap: 0.6 },
    alertDisplay: { m: 0.6, f: 0.3 },
    snap: 0.5, shuffle: 0.4,
    flattenAlert: 0.0,
    tintAlert: 0.3,
    heat: 1.0, // the sun it takes in the heat of the day, times THERMAL.sunny
  },
};

// Shared tunables for noticing and moods (the time of day is THERMAL, below).
export const AWARENESS = {
  // player.noise (0 still, 0.05 creeping, 0.5 walking, 1 running) to a distance factor
  noise: [[0, 0.33], [0.05, 0.58], [0.5, 1.0], [1.0, 2.2]],
  still: 0.55, // approach factor when the player stands still
  approach: [0.65, 0.35], // moving: a + b * (closing speed / speed)
  facing: [0.85, 0.15], // a + b * cos(angle between the player's heading and the lizard)
  behind: [0.75, 0.25], // open perches: a + b * max(0, cos(the lizard's heading, the player))
  unseen: 0.55, // a trunk lizard with its trunk between it and the player
  heightFree: 1.8, // metres above the player's feet before height makes it bolder
  heightK: 0.15,
  wary: 1.35, // after coming back or being released
  waryTime: 40,
  rise: 10, // threat smoothing, per second, rising and falling
  fall: 2.0,
  calmAt: 0.5, // alert lizards settle below this threat for calmTime seconds
  calmTime: 2.0,
  habit: { step: 0.8, floor: 0.55, recover: 30 }, // bolder each time it settles; back to 1 in about 30 s or on a flight
  settleBob: 0.7, // chance of a head bob as an alert lizard settles
  returnClear: 4.0, // a hidden lizard comes back once the player is this far off,
  returnClearStill: 2.0, // or this far when the player stands still (so waiting at pole range pays)
  peekAt: 0.6, // a lizard hiding behind its trunk peeks round at this share of its hiding time
  watched: { range: 6, m: 2, f: 3 }, // a still player this near sees displays m or f times as often
};

// Time of day and the sun: real anole thermal ecology, simplified so it reads. Anoles
// warm up by basking, so in the cool morning they sit out on sunlit perches, flattened
// and broadside to the sun, and display the most; as the heat builds towards midday a
// lizard in full sun slips round its trunk to the shady side or off into cover, hides
// longer and displays less; in the late afternoon they come back out to bask. In the
// shade a lizard is calmer and harder to spot; a basking one is warier but showier.
//
// Hours are the sky's (the clock's 07:30 to 18:30 is sky 8.4 to 17.9). warmth() is 0
// in the cool morning, 1 through the heat of the day and 0 again late in the
// afternoon, weighted by the sun's height so the heat spell sits round midday.
// exposure (0..1) is sunlight on the lizard: the sun's height, what the ray to the sun
// passes through (the drawn crowns, palm fans, bushes and trunks, so the lizards bask
// where the shadow map draws sun) and, on a trunk, whether the sun is on its side.
export const THERMAL = {
  // the drawn shade: crowns, palm fans (flattened) and bushes as ellipsoids a little
  // inside their outlines, and the light lost per metre of them the ray crosses (1/m,
  // soft at the edges like the shadow map's). Checked against the shadow map itself:
  // about nine perches in ten agree through the day (the canopy grid alone managed about
  // eight in ten, and put half its sunny perches in drawn shade). About a fifth of the
  // perches are in the sun in the morning.
  drawn: { crown: 0.9, palm: 0.8, palmFlat: 0.35, mound: 0.95, loss: 2.5 },
  // without the vegetation (?noveg=1): the canopy grid
  crownBase: 0.5, // crowns fill the canopy from this share of its height up
  crownMin: 1.5, // m: lower growth (grass, ferns, low shrubs) casts no real shade
  foliage: 0.4, // sunlight lost per metre of crown the ray crosses (Beer-Lambert, 1/m)
  warmth: [9.6, 12.2, 14.9, 16.7], // sky hours: warming from, hot from, cooling from, cool from
  // the sun's height (sine of its elevation) from which it counts towards the warmth, and
  // at which it counts in full: a low sun is not the fierce noon one, so the heat spell
  // sits round midday (about 10:55 to 15:15 on the clock) even under the crowns, where
  // the low afternoon sun reaches the trunks
  sunHot: [0.55, 0.78],
  sunny: 0.3, // exposure over this is in the sun
  shady: 0.12, // and under this in the shade
  // in the sun while it is cool: showier and a little warier (fid; brain.js caps the
  // mood's fid times the sight at 1, so a basking or hot lizard is never jumpier than a
  // calm one watching the player come straight at it)
  bask: { below: 0.5, display: 1.35, fid: 1.05, flatten: 0.3 },
  hot: { above: 0.55, display: 0.5, fid: 1.08 }, // in the sun in the heat: it moves into shade
  shade: { display: 0.8, fid: 0.88, pick: 0.78 }, // in the shade: calmer, fewer displays, a smaller target to spot
  cold: 0.35, // below this warmth a lizard in the shade looks for sun
  display: [1.3, 0.6], // displays by the time of day: the cool morning, the heat
  hideLonger: 0.5, // hides this much longer after a flight at the height of the heat
  comeOut: 0.42, // lizards sheltering from the heat come out again below this warmth
  moveEvery: [5, 12], // seconds between a lizard's moves for sun or shade
  // slot weights for the spawns near the player (under 1: picked sooner): sunny homes
  // in the cool of the day, shady ones in the heat. In the cool a sunny home also
  // reaches `reach` metres past the slots' radius: the landing and the causeway lie in
  // the island's morning shade (no perch within 40 m of the start sees the 07:30 sun),
  // so the nearest basking lizards, on the sunny lawn beyond the causeway, are about
  // from the start and "look in the sun" holds from the first step.
  slot: { sunnyCool: 0.55, shadyCool: 1.15, sunnyHot: 1.5, shadyHot: 0.85, reach: 14 },
  night: { display: 0.0, fid: 0.6 }, // asleep
};

// 0 in the cool morning, 1 in the heat of the day, 0 again late in the afternoon: the
// day's curve (THERMAL.warmth) times the sun's height (THERMAL.sunHot). sunY is the sine
// of the sun's elevation (sky.sunHeight); without it only the curve counts.
export function warmth(hours, sunY = 1) {
  const W = THERMAL.warmth, a = W[0], b = W[1], c = W[2], d = W[3];
  const up = hours <= a ? 0 : hours >= b ? 1 : (hours - a) / (b - a);
  const down = hours <= c ? 1 : hours >= d ? 0 : 1 - (hours - c) / (d - c);
  const k = Math.min(up, down);
  const H = THERMAL.sunHot, s = Math.min(1, Math.max(0, (sunY - H[0]) / (H[1] - H[0])));
  return k * k * (3 - 2 * k) * s * s * (3 - 2 * s);
}

// 'morning', 'midday' or 'afternoon', for James's lines about the sun, from the sky hour
// and the warmth (lizards.js also keeps 'midday' while more lizards are still hot or
// sheltering than basking).
export function thermalPhase(hours, w = warmth(hours)) {
  if (w > 0.5) return 'midday';
  return hours < 13 ? 'morning' : 'afternoon';
}

// A bounded, deterministic random stream per lizard.
export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function noiseFactor(noise) {
  const k = AWARENESS.noise;
  if (noise <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (noise <= k[i][0]) {
      const a = k[i - 1], b = k[i];
      return a[1] + (b[1] - a[1]) * (noise - a[0]) / (b[0] - a[0]);
    }
  }
  return k[k.length - 1][1];
}
