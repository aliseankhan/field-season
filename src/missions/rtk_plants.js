// What the plant survey knows about the island's plants: for each scientific name in
// data/placements.json (the lab's June 2026 RTK survey), a friendly common name, the
// family (Latin and in plain words), what its leaf looks like (for the sketch on the
// log card) and a short hint of what to look for. Plants the survey could not name
// ("palm", "tree", "mangrove", an unknown shrub) are left out of the mission.
//
//   plantInfo(p) -> { common, sci, family, familyCommon, leaf, hint, fact } | null
//   allNames() -> every name the log card may offer, with its family and leaf
//   leafSketch(kind, { size }) -> SVG markup of a pencil sketch of that leaf
//   FORM_WORD[form] -> 'Tree', 'Palm', ...

export const FAMILY = {
  Arecaceae: 'palm family',
  Polygonaceae: 'buckwheat family',
  Combretaceae: 'white mangrove family',
  Poaceae: 'grass family',
  Chrysobalanaceae: 'cocoplum family',
  Rubiaceae: 'coffee family',
  Asparagaceae: 'asparagus family',
  Burseraceae: 'torchwood family',
  Fabaceae: 'pea family',
  Ebenaceae: 'ebony family',
  Moraceae: 'fig family',
  Sapotaceae: 'sapodilla family',
  Bignoniaceae: 'trumpet vine family',
  Malvaceae: 'mallow family',
  Myrtaceae: 'myrtle family',
  Lauraceae: 'laurel family',
  Canellaceae: 'wild cinnamon family',
  Amaryllidaceae: 'amaryllis family',
  Typhaceae: 'cattail family',
  Araliaceae: 'ivy family',
};

// by scientific name as the survey wrote it. `hint` is what to look for (how it looks and
// what it is used for, never a word of its name: the log card asks the name); `fact` is
// the little wink told once it is named.
const PLANTS = {
  'Coccoloba uvifera': { common: 'sea grape', family: 'Polygonaceae', leaf: 'round', hint: 'Big round leathery leaves, like dinner plates, with reddish veins.', fact: 'Its fruit hangs in bunches, just like grapes.' },
  'Conocarpus erectus': { common: 'buttonwood', family: 'Combretaceae', leaf: 'narrow', hint: 'Slim pointed leaves, and it loves salty ground by the water.', fact: 'Its little round seed heads look like buttons.' },
  'Cocos nucifera': { common: 'coconut palm', family: 'Arecaceae', leaf: 'feather', hint: 'Long feathery fronds on a tall, leaning trunk.', fact: 'Yes, the one with coconuts!' },
  'Sabal causiarum': { common: 'Puerto Rico hat palm', family: 'Arecaceae', leaf: 'fan', hint: 'Huge stiff fan leaves on a smooth, pale grey trunk.', fact: 'People wove its leaves into hats!' },
  'Sabal sp.': { common: 'palmetto', family: 'Arecaceae', leaf: 'fan', hint: 'Big fan leaves on a stout, rough trunk.', fact: 'Its cousin, the cabbage palm, is Florida\'s state tree.' },
  'Leucothrinax morrisii': { common: 'key thatch palm', family: 'Arecaceae', leaf: 'fan', hint: 'Neat little fan leaves, silvery underneath.', fact: 'Its leaves were used to thatch roofs.' },
  'Oncosperma tigillarium': { common: 'nibung palm', family: 'Arecaceae', leaf: 'feather', hint: 'Clumps of slim, spiny trunks with feathery fronds.', fact: 'Its tough trunks make posts for houses on stilts.' },
  'Nypa fruticans': { common: 'nipa palm', family: 'Arecaceae', leaf: 'feather', hint: 'No trunk at all: feathery fronds straight up out of the mud.', fact: 'Its fronds make thatch, and its sap makes sugar.' },
  'Roystonea regia': { common: 'royal palm', family: 'Arecaceae', leaf: 'feather', hint: 'A smooth grey trunk like a column, topped with a green crownshaft.', fact: 'It lines grand avenues, fit for a king.' },
  'Corypha umbraculifera': { common: 'talipot palm', family: 'Arecaceae', leaf: 'fan', hint: 'Enormous fan leaves, the biggest of any palm.', fact: 'It flowers only once in its long life.' },
  'Bambusa dolichoclada': { common: 'bamboo', family: 'Poaceae', leaf: 'blade', hint: 'Tall hollow stems with joints, in a tight clump.', fact: 'It\'s a grass, just a giant one!' },
  'Chrysobalanus icaco': { common: 'cocoplum', family: 'Chrysobalanaceae', leaf: 'obovate', hint: 'Shiny round-tipped leaves and small fruit, pink to dark purple.', fact: 'Its fruit looks like a tiny plum, and you can eat it.' },
  'Casasia clusiifolia': { common: 'seven-year apple', family: 'Rubiaceae', leaf: 'obovate', hint: 'Thick glossy leaves bunched at the tips of the twigs.', fact: 'Its fruit takes an age to ripen.' },
  'Dracaena reflexa': { common: 'song of India', family: 'Asparagaceae', leaf: 'strap', hint: 'Pointed strap leaves with yellow edges, in spirals up the stems.', fact: 'A favourite pot plant all over the world.' },
  'Randia aculeata': { common: 'white indigoberry', family: 'Rubiaceae', leaf: 'small', hint: 'Tiny leaves in clusters and sharp little spines.', fact: 'Its white berries hold a deep blue pulp, once used as dye.' },
  'Bucida spinosa x buceras': { common: 'spiny black olive', family: 'Combretaceae', leaf: 'small', hint: 'Small leaves in rosettes on zigzag, thorny twigs.', fact: 'Not a real olive! Bonsai growers love it.' },
  'Bursera sp.': { common: 'gumbo limbo kin', family: 'Burseraceae', leaf: 'compound', hint: 'Peeling reddish bark and leaves split into leaflets.', fact: 'Gumbo limbos are called tourist trees: red and peeling, like a sunburn!' },
  'Caesalpinia vesicaria': { common: 'brasiletto', family: 'Fabaceae', leaf: 'compound', hint: 'Leaves of small paired leaflets, and bright yellow flowers.', fact: 'A pea cousin, with its seeds in pods.' },
  'Diospyros sp.': { common: 'persimmon kin', family: 'Ebenaceae', leaf: 'oval', hint: 'Plain oval leaves on a tree with very dark, hard wood.', fact: 'Ebony comes from its close cousins.' },
  'Ficus perforata': { common: 'wild fig', family: 'Moraceae', leaf: 'oval', hint: 'Glossy leaves, milky sap and little round fruit along the twigs.', fact: 'Those little fruits are figs, a feast for the birds.' },
  'Pithecellobium sp.': { common: 'blackbead', family: 'Fabaceae', leaf: 'compound', hint: 'Leaflets in pairs, like butterfly wings.', fact: 'Its pods split open to show shiny dark seeds.' },
  'Sideroxylon americanum': { common: 'bully tree', family: 'Sapotaceae', leaf: 'obovate', hint: 'Small blunt leaves and thorny twigs.', fact: 'Its sweet little berries feed the birds.' },
  'Sideroxylon inerme': { common: 'white milkwood', family: 'Sapotaceae', leaf: 'obovate', hint: 'Leathery leaves and small greenish flowers.', fact: 'Snap a leaf and it bleeds milky sap.' },
  'Tabebuia riparia': { common: 'river trumpet tree', family: 'Bignoniaceae', leaf: 'palmate', hint: 'Leaves of a few leaflets from one point, and pale flared flowers.', fact: 'Its flowers are shaped like little trumpets.' },
  'Tabebuia heterophylla': { common: 'pink trumpet tree', family: 'Bignoniaceae', leaf: 'palmate', hint: 'Clouds of rosy flowers, and leaves of five leaflets from one point.', fact: 'Its flowers are shaped like little trumpets.' },
  'Gliricidia sepium': { common: 'gliricidia', family: 'Fabaceae', leaf: 'compound', hint: 'Pink pea flowers. Farmers grow it as living fence posts!', fact: 'Its leaves feed the soil where they fall.' },
  'Heritiera littoralis': { common: 'looking-glass mangrove', family: 'Malvaceae', leaf: 'oval', hint: 'Leaves silvery underneath, and it grows by the water\'s edge.', fact: 'The leaves shine like a mirror underneath.' },
  'Melaleuca styphelioides': { common: 'prickly paperbark', family: 'Myrtaceae', leaf: 'small', hint: 'Soft, peeling layers of bark and tiny sharp-tipped leaves.', fact: 'Its bark peels off in sheets, just like paper.' },
  'Persea palustris': { common: 'swamp bay', family: 'Lauraceae', leaf: 'oval', hint: 'Leaves that smell spicy when crushed. An avocado cousin!', fact: 'It loves wet, boggy ground.' },
  'Canella winterana': { common: 'wild cinnamon', family: 'Canellaceae', leaf: 'obovate', hint: 'Glossy leaves bunched at the twig tips, and small purple flowers.', fact: 'Its bark smells of cinnamon and cloves.' },
  'Crinum augustum': { common: 'Queen Emma lily', family: 'Amaryllidaceae', leaf: 'strap', hint: 'Long strap leaves and big pink and white flowers.', fact: 'Named after a queen of Hawaii.' },
};


// Names the log card may offer as a near miss but the survey never recorded: each shares
// a family or a leaf with an island plant that has no near miss of its own (sea grape,
// bamboo, the trumpet trees), so every plant's quiz needs both clues.
const DECOYS = {
  'Coccoloba diversifolia': { common: 'pigeon plum', family: 'Polygonaceae', leaf: 'oval' },
  'Typha domingensis': { common: 'southern cattail', family: 'Typhaceae', leaf: 'blade' },
  'Tecoma stans': { common: 'yellow elder', family: 'Bignoniaceae', leaf: 'compound' },
  'Schefflera actinophylla': { common: 'umbrella tree', family: 'Araliaceae', leaf: 'palmate' },
};

export const FORM_WORD = { tree: 'Tree', palm: 'Palm', shrub: 'Shrub', herb: 'Herb', mangrove: 'Mangrove' };

// The survey's own common name when it gave one (lower case words), else ours.
export function plantInfo(p) {
  if (!p || !p.sci) return null;
  const k = PLANTS[p.sci];
  if (!k) return null;
  const own = typeof p.name === 'string' && p.name !== p.sci && /^[a-z]/.test(p.name) ? p.name : null;
  return { common: own || k.common, sci: p.sci, family: k.family, familyCommon: FAMILY[k.family] || k.family, leaf: k.leaf, hint: k.hint, fact: k.fact || '' };
}

// Every name the log card may offer as a choice, one per common name.
export function allNames() {
  return Object.entries(PLANTS).concat(Object.entries(DECOYS))
    .map(([sci, k]) => ({ common: k.common, sci, family: k.family, familyCommon: FAMILY[k.family], leaf: k.leaf }));
}

export const cap = (s) => String(s || '').replace(/^./, (m) => m.toUpperCase());

// ---------------------------------------------------------------- leaf sketches

// A pencil sketch of a leaf in a 120 x 120 box: soft green wash, a darker line, veins.
const LINE = '#4f7a34', WASH = '#cfeab0', WASH2 = '#b6de92', VEIN = '#6d9a4a';

function leafPath(d, veins = '', extra = '') {
  return `<path d="${d}" fill="${WASH}" stroke="${LINE}" stroke-width="2.4" stroke-linejoin="round"/>` +
    (veins ? `<path d="${veins}" fill="none" stroke="${VEIN}" stroke-width="1.5" stroke-linecap="round"/>` : '') + extra;
}

// side veins off a midrib from (x, y0) to (x, y1), n pairs, reaching w across
function sideVeins(x, y0, y1, n, w, lift = 8) {
  let s = `M${x} ${y0} L${x} ${y1}`;
  for (let i = 1; i <= n; i++) {
    const y = y0 + ((y1 - y0) * i) / (n + 1);
    const k = Math.sin((i / (n + 1)) * Math.PI);
    s += ` M${x} ${y.toFixed(1)} Q${(x - w * 0.5 * k).toFixed(1)} ${(y - lift * 0.5).toFixed(1)} ${(x - w * k).toFixed(1)} ${(y - lift).toFixed(1)}`;
    s += ` M${x} ${y.toFixed(1)} Q${(x + w * 0.5 * k).toFixed(1)} ${(y - lift * 0.5).toFixed(1)} ${(x + w * k).toFixed(1)} ${(y - lift).toFixed(1)}`;
  }
  return s;
}

// a small oval leaflet centred at (x, y), long l, wide w, turned a degrees
function leaflet(x, y, l, w, a, fill = WASH) {
  return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(w / 2).toFixed(1)}" ry="${(l / 2).toFixed(1)}" transform="rotate(${a.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="${fill}" stroke="${LINE}" stroke-width="1.8"/>`;
}

const SKETCH = {
  round: () => leafPath('M60 102 C 22 102 12 58 26 34 C 40 12 80 12 94 34 C 108 58 98 102 60 102 Z',
    'M60 108 L60 30 M60 88 Q42 76 30 62 M60 88 Q78 76 90 62 M60 70 Q46 54 38 40 M60 70 Q74 54 82 40 M60 52 Q54 40 50 30 M60 52 Q66 40 70 30',
    '<path d="M60 102 L60 114" stroke="#b5654a" stroke-width="3" stroke-linecap="round"/>'),
  narrow: () => leafPath('M52 108 C 36 80 36 42 56 12 C 74 42 72 80 52 108 Z', sideVeins(54, 104, 20, 5, 12, 6)) +
    '<g fill="#8f6a3c" stroke="#5e4424" stroke-width="1.4"><circle cx="92" cy="36" r="7"/><circle cx="98" cy="50" r="6"/><circle cx="88" cy="58" r="5"/></g>' +
    '<path d="M92 36 L86 72 M98 50 L86 72 M88 58 L86 72" stroke="#5e4424" stroke-width="1.4" fill="none"/>',
  oval: () => leafPath('M60 106 C 28 86 28 38 60 12 C 92 38 92 86 60 106 Z', sideVeins(60, 104, 18, 6, 20, 8)),
  obovate: () => leafPath('M60 110 C 48 96 32 70 32 44 C 32 20 48 10 60 10 C 72 10 88 20 88 44 C 88 70 72 96 60 110 Z', sideVeins(60, 106, 16, 5, 22, 7)),
  strap: () => {
    let s = '';
    for (const [x0, x1, y1, bend] of [[52, 18, 20, -1], [60, 64, 8, 0.2], [66, 104, 26, 1], [56, 36, 14, -0.5]]) {
      const cx = x0 + (x1 - x0) * 0.35 + bend * 10;
      s += `<path d="M${x0 - 4} 112 Q${cx - 6} 60 ${x1} ${y1} Q${cx + 8} 62 ${x0 + 5} 112 Z" fill="${WASH}" stroke="${LINE}" stroke-width="2.2" stroke-linejoin="round"/>`;
      s += `<path d="M${x0} 110 Q${cx + 1} 62 ${x1} ${y1 + 2}" fill="none" stroke="${VEIN}" stroke-width="1.2"/>`;
    }
    return s;
  },
  feather: () => {
    let s = `<path d="M18 110 Q40 48 104 16" fill="none" stroke="${LINE}" stroke-width="3" stroke-linecap="round"/>`;
    for (let i = 1; i <= 11; i++) {
      const f = i / 12;
      const x = 18 + (104 - 18) * f + Math.sin(f * Math.PI) * -6, y = 110 - (110 - 16) * f - Math.sin(f * Math.PI) * 14;
      const len = 26 * Math.sin(Math.min(1, f + 0.15) * Math.PI) + 8;
      s += `<path d="M${x.toFixed(1)} ${y.toFixed(1)} q${(-len * 0.55).toFixed(1)} ${(-len * 0.2).toFixed(1)} ${(-len * 0.8).toFixed(1)} ${(-len * 0.9).toFixed(1)}" fill="none" stroke="${LINE}" stroke-width="3.4" stroke-linecap="round"/>`;
      s += `<path d="M${x.toFixed(1)} ${y.toFixed(1)} q${(len * 0.2).toFixed(1)} ${(len * 0.35).toFixed(1)} ${(len * 0.9).toFixed(1)} ${(len * 0.55).toFixed(1)}" fill="none" stroke="${LINE}" stroke-width="3.4" stroke-linecap="round"/>`;
      s += `<path d="M${x.toFixed(1)} ${y.toFixed(1)} q${(-len * 0.55).toFixed(1)} ${(-len * 0.2).toFixed(1)} ${(-len * 0.8).toFixed(1)} ${(-len * 0.9).toFixed(1)}" fill="none" stroke="${WASH2}" stroke-width="1.6" stroke-linecap="round"/>`;
    }
    return s;
  },
  fan: () => {
    let s = `<path d="M60 112 L60 78" stroke="${LINE}" stroke-width="3.2" stroke-linecap="round"/>`;
    s += `<path d="M60 78 L14 44 Q20 22 36 14 Q60 4 84 14 Q100 22 106 44 Z" fill="${WASH}" stroke="${LINE}" stroke-width="2.4" stroke-linejoin="round"/>`;
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * (1.12 + (i / 10) * 0.76);
      const x = 60 + Math.cos(a) * 52, y = 78 + Math.sin(a) * 60;
      s += `<path d="M60 78 L${x.toFixed(1)} ${y.toFixed(1)}" stroke="${VEIN}" stroke-width="1.3"/>`;
    }
    return s;
  },
  compound: () => {
    let s = `<path d="M60 112 Q58 60 64 10" fill="none" stroke="${LINE}" stroke-width="2.6" stroke-linecap="round"/>`;
    for (let i = 0; i < 6; i++) {
      const y = 94 - i * 15, x = 60 + (i * 0.8);
      s += leaflet(x - 15, y - 3, 22, 11, 62) + leaflet(x + 15, y - 3, 22, 11, -62);
    }
    return s + leaflet(64.5, 10, 20, 11, 0);
  },
  palmate: () => {
    let s = `<path d="M60 112 L60 66" stroke="${LINE}" stroke-width="2.8" stroke-linecap="round"/>`;
    for (const [a, l] of [[-70, 40], [-35, 50], [0, 56], [35, 50], [70, 40]]) {
      const r = (a * Math.PI) / 180;
      s += leaflet(60 + Math.sin(r) * l * 0.55, 64 - Math.cos(r) * l * 0.55, l, l * 0.4, a);
    }
    return s;
  },
  blade: () => {
    let s = `<path d="M40 114 L44 8" stroke="#8fae4a" stroke-width="6" stroke-linecap="round"/>`;
    for (const y of [30, 62, 94]) s += `<path d="M36 ${y} L48 ${y - 1}" stroke="#6f8a34" stroke-width="2.4" stroke-linecap="round"/>`;
    for (const [y, dir, l] of [[30, 1, 58], [48, -1, 34], [62, 1, 62], [80, -1, 30]]) {
      const x0 = 44 + dir * 1;
      s += `<path d="M${x0} ${y} Q${x0 + dir * l * 0.5} ${y - 22} ${x0 + dir * l} ${y - 4} Q${x0 + dir * l * 0.5} ${y - 12} ${x0} ${y + 3} Z" fill="${WASH}" stroke="${LINE}" stroke-width="2" stroke-linejoin="round"/>`;
    }
    return s;
  },
  small: () => {
    let s = `<path d="M16 104 L40 80 L34 56 L62 40 L60 18 M40 80 L72 84 L96 64 M62 40 L88 32 L104 14" fill="none" stroke="#7a5a36" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
    for (const [x, y] of [[40, 80], [34, 56], [62, 40], [72, 84], [96, 64], [88, 32], [60, 18], [104, 14]]) {
      for (let k = 0; k < 5; k++) {
        const a = k * 72 + x;
        const r = (a * Math.PI) / 180;
        s += leaflet(x + Math.cos(r) * 7, y + Math.sin(r) * 7, 12, 6.5, a + 90);
      }
    }
    for (const [x, y, dx, dy] of [[28, 92, -5, -7], [50, 47, 6, -6], [84, 74, 6, 6]]) s += `<path d="M${x} ${y} l${dx} ${dy}" stroke="#7a5a36" stroke-width="1.8" stroke-linecap="round"/>`;
    return s;
  },
};

export function leafSketch(kind, { size = '100%', cls = 'rtk-leaf' } = {}) {
  const body = (SKETCH[kind] || SKETCH.oval)();
  return `<svg class="${cls}" viewBox="0 0 120 120" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
}
