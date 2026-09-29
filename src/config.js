// Constants and URL flags. Everything tunable lives here so every system
// (and a WebXR mode) can read the same numbers.

const params = new URLSearchParams(location.search);

function numList(name, min, max) {
  const raw = params.get(name);
  if (raw == null) return null;
  const v = raw.split(',').map(Number);
  if (v.length < min || v.length > max || v.some((n) => !Number.isFinite(n))) return null;
  return v;
}

function flag(name) {
  if (!params.has(name)) return false;
  const v = params.get(name);
  return v === '' || v === '1' || v === 'true' || v === 'yes';
}

// ?debug=1 shows the readout and collider circles; ?debug=spawns the lizard spawn
// markers; ?debug=hosts the lizard hosts from veg.hosts. Words combine with commas,
// and ?debug=all turns on everything.
function debugWords() {
  if (!params.has('debug')) return null;
  const out = new Set();
  for (const w of (params.get('debug') || '1').toLowerCase().split(',')) {
    const word = w.trim();
    if (word === '' || word === '1' || word === 'true' || word === 'yes') out.add('readout').add('colliders');
    else if (word === 'all') ['readout', 'colliders', 'spawns', 'hosts'].forEach((k) => out.add(k));
    else out.add(word);
  }
  return out;
}

const cam = numList('cam', 6, 6);
const at = numList('at', 2, 3);
const t = Number(params.get('t'));

export const FLAGS = {
  debug: debugWords(), // null, or a Set of: readout, colliders, spawns, hosts
  diag: flag('diag'),
  view: params.get('view') || null, // 'top' for the orthographic comparison render
  cam: cam && { pos: cam.slice(0, 3), target: cam.slice(3, 6) },
  at: at && { x: at[0], z: at[1], heading: at.length > 2 ? at[2] : null },
  t: params.has('t') && Number.isFinite(t) ? t : 10.5,
  noveg: flag('noveg'), // skip vegetation, for engine testing
  nohud: flag('nohud'),
  nocut: flag('nocut'), // turn off the vegetation cut-out round the player, for checks
  noprops: flag('noprops'), // skip the props (signpost, field station, pond life)
  // A headless browser delivers no animation frames; ?headless=1 (or ?diag=1, or an
  // automated browser) pumps the loop from a timer when frames stall.
  headless: flag('headless') || flag('diag') || navigator.webdriver === true || /HeadlessChrome/.test(navigator.userAgent),
};

export const CONFIG = {
  dataBase: 'data/',
  maxPixelRatio: 1.5,
  shadowMapSize: 4096,

  // Fixed extent of ?view=top: x -62..82, z -50..52 (E 573088-573232, N 2840050-2840152).
  topView: { xmin: -62, xmax: 82, zmin: -50, zmax: 52 },
  // Box the sun's shadow camera covers: the island, its fringe and the causeway.
  shadowBox: { xmin: -62, xmax: 82, ymin: -1.5, ymax: 30, zmin: -50, zmax: 52 },

  player: {
    creepSpeed: 0.9,
    walkSpeed: 2.0,
    jogSpeed: 4.0,
    accel: 9.0, // m/s^2 towards the target speed
    decel: 12.0,
    turnRate: 10.0, // heading smoothing, 1/s
    radius: 0.28, // against bush circles
    trunkRadius: 0.2, // against trunk circles (r = dbh / 2 + 0.15), so the chest can near the bark
    gridRadius: 0.18, // against blocked cells
    height: 1.52,
    eyeHeight: 1.25,
    maxStep: 0.1, // collision sub-step length, m
  },

  camera: {
    fov: 42,
    near: 0.15,
    far: 2400,
    distance: 8.0,
    minDistance: 2.4,
    maxDistance: 18,
    pitch: 0.5, // radians above the horizontal: looking down onto the lawn and paths
    startPitch: 0.36, // a lower first view, up the causeway to the island
    minPitch: 0.22,
    maxPitch: 1.1,
    targetHeight: 1.25,
    followRate: 7.0, // target smoothing, 1/s
    orbitSpeed: 0.0055, // radians per pixel dragged
    zoomSpeed: 0.0012,
    autoAlignDelay: 1.6, // seconds after the last manual orbit
    autoAlignRate: 0.9, // radians per second at walking pace
    groundClearance: 0.35,
  },

  fog: { near: 90, far: 520 },

  // The island board (src/ui/scoreboard.js, tools/scoreboard_server.py): the API's
  // folder, relative to the page, pinged once on load; with no API there every board UI
  // stays hidden. ?noboard=1 turns it off for a run. version goes with each day posted,
  // so a board can tell days from different builds apart.
  scoreboard: { enabled: true, api: 'api/', timeoutMs: 4000, version: '1.0' },
};
