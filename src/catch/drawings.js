// SVG drawings for the catch-and-release cards: each anole side on (for the bag and the
// ruler) and from above (for the paint pen and the backpack), in the colours of the
// models in src/lizards/anole.js (and the brown basilisk's, src/wildlife/basilisk_model.js),
// plus the clear bag and the ruler. Plain strings, so the notebook can use them too.
//
// Side view: local units with the snout-vent length 100, the snout at x 100 and the
// vent at x 0, y down; anoleSide() places it with the snout at (x, y) - facing * len.
// Top view: the snout at y -100, the vent at y 0, the shoulders at y -58.

const OUT = '#3a2f2a';

export const LOOK = {
  cristatellus: {
    body: ['#a38c4c', '#a2906a'], dark: ['#6c5a2d', '#7e6e4e'], belly: '#ebdfae', lip: '#d9cc9a', leg: ['#9a8347', '#9c8a64'],
    dewlap: ['#d6d64a', '#f4b83c', '#ff8a2e'], pattern: 'chevrons', crest: '#8e7c46', head: 1, girth: 1,
  },
  sagrei: {
    body: ['#7c5231', '#9c6c43'], dark: ['#5b3920', '#6a4428'], belly: '#eed9b3', lip: '#c9a57a', leg: ['#744c2e', '#93653f'],
    dewlap: ['#ff4a26', '#ff6a2c', '#ffd23e'], pattern: 'spots', spot: '#f1cf7e', head: 0.95, girth: 1.08,
  },
  carolinensis: {
    body: ['#82de3c', '#82de3c'], dark: ['#6cca34', '#6cca34'], belly: '#f2fbdc', lip: '#d8f5b0', leg: ['#78d53a', '#78d53a'],
    dewlap: ['#ff7fae', '#ff8fb8', '#ffb0cc'], pattern: 'plain', head: 1.22, girth: 0.9,
  },
  distichus: {
    body: ['#a09d8f', '#aaa79a'], dark: ['#67645b', '#6f6c63'], belly: '#e4e1d0', lip: '#cfccbc', leg: ['#9a978a', '#a3a093'],
    dewlap: ['#f2b24c', '#f6d766', '#fbf0a2'], pattern: 'bars', lichen: '#bccb9b', head: 0.9, girth: 0.86,
  },
  equestris: {
    body: ['#6ed63e', '#6ed63e'], dark: ['#52bd35', '#52bd35'], belly: '#e4f7c4', lip: '#caf0a2', leg: ['#62cc3a', '#62cc3a'],
    dewlap: ['#ffadc6', '#ff9fc0', '#ffe0ea'], pattern: 'stripes', stripe: '#fff6c8', head: 1.3, girth: 1.08, casque: '#46a837',
  },
  // no dewlap to go by: a male has the tall head crest (and low crests on the back and tail)
  basilisk: {
    body: ['#8a7444', '#8f7a4c'], dark: ['#5f4d2b', '#655230'], belly: '#d9c690', lip: '#f3e5b4', leg: ['#7c6739', '#816c3e'],
    dewlap: null, pattern: 'basilisk', stripe: '#f6e6a4', crest: '#a17f47', headCrest: true, head: 1.08, girth: 0.95,
  },
};

let uid = 0;
const n1 = (v) => Math.round(v * 10) / 10;

// A side view as an SVG <g>. opts: { x, y, len (SVL in px), facing (1: snout to the
// right), sex, dewlap (0..1 open), mark (paint colour), pack (backpack colour),
// tilt (degrees) }.
export function anoleSide(sp, opts = {}) {
  const L = LOOK[sp] || LOOK.cristatellus;
  const { x = 0, y = 0, len = 100, facing = 1, sex = 'm', dewlap = 0, mark = null, pack = null, tilt = 0, curl = false } = opts;
  const male = sex !== 'f';
  const s = len / 100;
  const body = L.body[male ? 0 : 1], dark = L.dark[male ? 0 : 1], leg = L.leg[male ? 0 : 1];
  const id = 'an' + (++uid);
  const hL = 31 * L.head, hx = 100 - hL; // head from hx to the snout
  const g = L.girth;
  const by = 13.5 * g; // body half height
  const sw = 'vector-effect="non-scaling-stroke"';
  const st = `stroke="${OUT}" stroke-width="2" stroke-linejoin="round" ${sw}`;
  const parts = [];
  // far legs, a shade darker
  parts.push(`<path d="M16 4 L24 14 L16 19" fill="none" stroke="${dark}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`);
  parts.push(`<path d="M${hx - 2} 4 L${hx + 6} 13 L${hx} 17" fill="none" stroke="${dark}" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/>`);
  // tail, a long taper with a gentle curl, or curled right round under it (in a bag)
  if (curl) {
    const seg = [['M8 1 C -12 0 -30 2 -44 10', 15], ['M-44 10 C -58 18 -64 30 -56 40', 10.5], ['M-56 40 C -48 50 -30 48 -20 40', 6]];
    for (const [d, w] of seg) parts.push(`<path d="${d}" fill="none" stroke="${OUT}" stroke-width="${(w * g + 3.2).toFixed(1)}" stroke-linecap="round"/>`);
    for (const [d, w] of seg) parts.push(`<path d="${d}" fill="none" stroke="${body}" stroke-width="${(w * g).toFixed(1)}" stroke-linecap="round"/>`);
  } else {
    parts.push(`<path d="M6 ${-8 * g} C -30 ${-8.5 * g} -70 -2 -104 7 C -118 11 -128 8 -134 2 C -126 13 -110 18 -96 16 C -60 14 -28 ${11 * g} 6 ${10 * g} Z" fill="${body}" ${st}/>`);
  }
  if (L.crest && male && !curl) {
    // the crested anole's tail fin (a basilisk's is lower)
    const f = L.headCrest ? 0.5 : 1;
    parts.push(`<path d="M2 ${-6 * g} C -8 ${-19 * f} -22 ${-21 * f} -34 ${-15 * f} C -40 ${-12 * f} -46 -7 -52 -5 C -30 -6 -12 ${-7 * g} 2 ${-6 * g} Z" fill="${L.crest}" ${st}/>`);
  }
  // tail bands
  for (let k = 0; k < (curl ? 0 : 5); k++) {
    const tx = -18 - k * 22;
    parts.push(`<path d="M${tx} ${-5 + k * 1.6} Q ${tx - 4} ${1 + k * 1.7} ${tx} ${7 + k * 1.3}" stroke="${dark}" stroke-width="${4.2 - k * 0.5}" fill="none" opacity="0.55" stroke-linecap="round"/>`);
  }
  // body and head in one outline
  const hy = 12.5 * Math.sqrt(L.head); // head half height at the back
  const bodyPath = `M4 ${-by * 0.7} C 18 ${-by * 1.12} 50 ${-by * 1.1} ${hx - 4} ${-by * 0.85} C ${hx + 4} ${-hy} ${hx + hL * 0.55} ${-hy * 0.95} ${99} -3 C 102 0 101 4 97 5.5 C ${hx + hL * 0.5} ${hy * 0.75} ${hx + 2} ${hy * 0.9} ${hx - 6} ${by * 0.9} C 50 ${by * 1.12} 18 ${by * 1.05} 4 ${by * 0.75} C 0 ${by * 0.3} 0 ${-by * 0.3} 4 ${-by * 0.7} Z`;
  parts.push(`<clipPath id="${id}c"><path d="${bodyPath}"/></clipPath>`);
  parts.push(`<path d="${bodyPath}" fill="${body}"/>`);
  const pat = [];
  pat.push(`<ellipse cx="46" cy="${by * 0.95}" rx="46" ry="${by * 0.5}" fill="${L.belly}"/>`);
  pat.push(`<path d="M${hx + 4} ${hy * 0.45} Q ${hx + hL * 0.6} ${hy * 0.55} 98 3" stroke="${L.lip}" stroke-width="3" fill="none"/>`);
  if (L.pattern === 'chevrons') {
    for (let k = 0; k < 4; k++) {
      const cx = 12 + k * 15;
      pat.push(`<path d="M${cx - 6} ${-by * 1.1} L${cx + 2} ${-by * 0.45} L${cx + 10} ${-by * 1.1}" stroke="${dark}" stroke-width="4" fill="none" opacity="0.7" stroke-linejoin="round"/>`);
    }
    if (!male) pat.push(`<path d="M6 ${-by * 0.95} L ${hx} ${-by * 0.95}" stroke="#dccd9f" stroke-width="2.4" opacity="0.9"/>`);
  } else if (L.pattern === 'spots') {
    for (let k = 0; k < 7; k++) pat.push(`<circle cx="${8 + k * 9.5}" cy="${(k % 2 ? -3 : -7) * g}" r="2.1" fill="${L.spot}" opacity="0.85"/>`);
    if (!male) pat.push(`<path d="M6 ${-by} l6 3 l6 -3 l6 3 l6 -3 l6 3 l6 -3 l6 3 l6 -3 l6 3" stroke="#efc896" stroke-width="2.2" fill="none"/>`);
  } else if (L.pattern === 'bars') {
    for (let k = 0; k < 5; k++) pat.push(`<path d="M${8 + k * 13} ${-by * 1.1} q 3 ${by * 0.7} 0 ${by * 1.3}" stroke="${dark}" stroke-width="3.2" fill="none" opacity="0.75"/>`);
    for (let k = 0; k < 4; k++) pat.push(`<ellipse cx="${14 + k * 15}" cy="${-by * 0.35}" rx="4" ry="2.6" fill="${L.lichen}" opacity="0.8"/>`);
  } else if (L.pattern === 'basilisk') {
    // two pale stripes down each side: eye to hip, and lip to shoulder
    pat.push(`<path d="M${hx + hL * 0.32} ${-hy * 0.5} C ${hx - 12} ${-by * 0.78} 40 ${-by * 0.7} 4 ${-by * 0.48}" stroke="${L.stripe}" stroke-width="3.6" fill="none" stroke-linecap="round"/>`);
    pat.push(`<path d="M95 3.6 Q ${hx + hL * 0.4} ${hy * 0.55} ${hx - 16} ${by * 0.3}" stroke="${L.stripe}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`);
  } else if (L.pattern === 'stripes') {
    pat.push(`<path d="M${hx + hL * 0.2} ${hy * 0.3} Q ${hx} ${hy * 0.6} ${hx - 14} ${by * 0.2}" stroke="${L.stripe}" stroke-width="4.5" fill="none" stroke-linecap="round"/>`);
    pat.push(`<path d="M${hx + hL * 0.5} ${hy * 0.52} L ${hx + hL * 0.85} 3" stroke="${L.stripe}" stroke-width="3" fill="none" stroke-linecap="round"/>`);
  } else {
    pat.push(`<path d="M8 ${-by * 0.2} L ${hx} ${-by * 0.2}" stroke="${dark}" stroke-width="3" opacity="0.35"/>`);
  }
  if (L.casque) pat.push(`<path d="M${hx + 2} ${-hy * 0.8} Q ${hx + hL * 0.4} ${-hy * 1.2} ${hx + hL * 0.8} ${-hy * 0.45}" stroke="${L.casque}" stroke-width="4" fill="none"/>`);
  if (mark) pat.push(`<circle cx="40" cy="${-by * 0.72}" r="4.6" fill="${mark}" stroke="#fff" stroke-width="1.2"/>`);
  parts.push(`<g clip-path="url(#${id}c)">${pat.join('')}</g>`);
  parts.push(`<path d="${bodyPath}" fill="none" ${st}/>`);
  if (L.crest && male && !L.headCrest) parts.push(`<path d="M${hx - 12} ${-by * 0.95} q 3 -4 6 0 q 3 -4 6 0" stroke="${L.crest}" stroke-width="2.4" fill="none"/>`);
  if (L.headCrest) {
    // the crest on the back of the head: tall on a male, a small one on a female; a male's
    // low saw-tooth crest runs down the back too
    const top = male ? 3.1 : 1.6;
    parts.push(`<path d="M${hx + hL * 0.42} ${-hy * 0.86} L${hx - 2} ${-hy * top} L${hx - 7} ${-hy * 0.8} Z" fill="${L.crest}" ${st}/>`);
    if (male) {
      let d = `M${hx - 8} ${-by * 0.86}`;
      for (let x = hx - 8; x > 8; x -= 8) d += ` L${x - 4} ${-by * 1.3} L${x - 8} ${-by * 0.9}`;
      parts.push(`<path d="${d}" fill="none" stroke="${L.crest}" stroke-width="2.2" stroke-linejoin="round"/>`);
    }
  }
  // dewlap
  if (L.dewlap && (male || dewlap > 0.5)) {
    const d = (male ? 1 : 0.5) * Math.max(0.12, dewlap);
    const dx0 = hx - 6, dx1 = hx + hL * 0.62, dy = 6 + 20 * d;
    const [a, b, c] = L.dewlap;
    parts.push(`<linearGradient id="${id}d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="0.6" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient>`);
    parts.push(`<path d="M${dx0} ${by * 0.6} Q ${(dx0 + dx1) / 2 - 4} ${by * 0.6 + dy * 1.6} ${dx1} ${hy * 0.55} Z" fill="url(#${id}d)" ${st}/>`);
  }
  // near legs with little toes
  const toes = (fx, fy) => `<path d="M${fx} ${fy} l5 1.5 M${fx} ${fy} l4.5 -1.5 M${fx} ${fy} l3 3" stroke="${OUT}" stroke-width="1.4" stroke-linecap="round" fill="none"/>`;
  parts.push(`<path d="M10 ${by * 0.5} L2 ${by + 5} L12 ${by + 9}" fill="none" stroke="${OUT}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`);
  parts.push(`<path d="M10 ${by * 0.5} L2 ${by + 5} L12 ${by + 9}" fill="none" stroke="${leg}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`);
  parts.push(toes(13, by + 9));
  parts.push(`<path d="M${hx - 6} ${by * 0.5} L${hx - 10} ${by + 4} L${hx - 1} ${by + 7}" fill="none" stroke="${OUT}" stroke-width="8.2" stroke-linecap="round" stroke-linejoin="round"/>`);
  parts.push(`<path d="M${hx - 6} ${by * 0.5} L${hx - 10} ${by + 4} L${hx - 1} ${by + 7}" fill="none" stroke="${leg}" stroke-width="5.4" stroke-linecap="round" stroke-linejoin="round"/>`);
  parts.push(toes(hx, by + 7));
  // the backpack between the shoulders, with its wire antenna
  if (pack) {
    parts.push(`<path d="M${hx - 24} ${-by * 1.2} Q ${hx - 44} ${-by * 1.9} ${hx - 58} ${-by * 1.4}" stroke="${OUT}" stroke-width="1.2" fill="none"/>`);
    parts.push(`<rect x="${hx - 26}" y="${-by * 1.05 - 6}" width="15" height="8" rx="3" fill="${pack}" ${st}/>`);
  }
  // eye, nostril and a small smile
  const ex = hx + hL * 0.52, ey = -hy * 0.3, er = 5.8 + 0.6 * (L.head - 1);
  parts.push(`<circle cx="${ex}" cy="${ey}" r="${er + 1.4}" fill="${L.lip}" stroke="${OUT}" stroke-width="1.2" ${sw}/>`);
  parts.push(`<circle cx="${ex + 0.4}" cy="${ey}" r="${er}" fill="#2b2320"/>`);
  parts.push(`<circle cx="${ex + 1.8}" cy="${ey - 1.6}" r="${er * 0.38}" fill="#fff"/>`);
  parts.push(`<circle cx="98" cy="-1.6" r="0.9" fill="${OUT}"/>`);
  parts.push(`<path d="M95 2.8 Q ${hx + hL * 0.6} 5.4 ${hx + hL * 0.42} 3.2" stroke="${OUT}" stroke-width="1.3" fill="none" stroke-linecap="round" ${sw}/>`);
  const tf = `translate(${n1(x - facing * len)} ${n1(y)}) rotate(${tilt}) scale(${n1(s * facing * 1000) / 1000} ${n1(s * 1000) / 1000})`;
  return `<g transform="${tf}">${parts.join('')}</g>`;
}

// A view from above as an SVG <g>: the snout at (x, y), pointing up, SVL len px.
// opts: { sex, mark, pack, wriggle (degrees for the tail and legs) }.
export function anoleTop(sp, opts = {}) {
  const L = LOOK[sp] || LOOK.cristatellus;
  const { x = 0, y = 0, len = 100, sex = 'm', mark = null, pack = null, wriggle = 0, rot = 0 } = opts;
  const male = sex !== 'f';
  const s = len / 100;
  const body = L.body[male ? 0 : 1], dark = L.dark[male ? 0 : 1], leg = L.leg[male ? 0 : 1];
  const st = `stroke="${OUT}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"`;
  const g = L.girth, hw = 12.5 * Math.sqrt(L.head), bw = 15.5 * g;
  const w = wriggle;
  const legPath = (sx, sy, a) => {
    const kx = sx + Math.sign(sx) * 14, ky = sy + a;
    return `M${sx} ${sy} L${kx} ${ky} L${kx + Math.sign(sx) * 3} ${ky + (a > 0 ? 9 : -9)}`;
  };
  const parts = [];
  for (const [sx, sy, a] of [[-bw * 0.8, -62, -6 + w * 0.3], [bw * 0.8, -62, -6 - w * 0.3], [-bw * 0.8, -8, 8 - w * 0.3], [bw * 0.8, -8, 8 + w * 0.3]]) {
    parts.push(`<path d="${legPath(sx, sy, a)}" fill="none" stroke="${OUT}" stroke-width="7.6" stroke-linecap="round" stroke-linejoin="round"/>`);
    parts.push(`<path d="${legPath(sx, sy, a)}" fill="none" stroke="${leg}" stroke-width="4.8" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  const tw = w * 0.9;
  parts.push(`<path d="M${-bw * 0.55} -4 C ${-7 + tw * 0.2} 40 ${-3 + tw} 90 ${tw * 1.6} 136 C ${3 + tw} 90 ${7 + tw * 0.2} 40 ${bw * 0.55} -4 Z" fill="${body}" ${st}/>`);
  if (L.crest && male) parts.push(`<path d="M0 0 C ${tw * 0.2} 30 ${tw * 0.6} 60 ${tw} 70" stroke="${L.crest}" stroke-width="3" fill="none"/>`);
  const bodyPath = `M0 -104 C ${hw * 0.7} -104 ${hw} -86 ${hw} -72 C ${bw} -66 ${bw} -30 ${bw * 0.7} -2 C ${bw * 0.3} 4 ${-bw * 0.3} 4 ${-bw * 0.7} -2 C ${-bw} -30 ${-bw} -66 ${-hw} -72 C ${-hw} -86 ${-hw * 0.7} -104 0 -104 Z`;
  parts.push(`<path d="${bodyPath}" fill="${body}" ${st}/>`);
  if (L.pattern === 'chevrons') for (let k = 0; k < 4; k++) parts.push(`<path d="M${-bw * 0.7} ${-50 + k * 12} L0 ${-42 + k * 12} L${bw * 0.7} ${-50 + k * 12}" stroke="${dark}" stroke-width="3.4" fill="none" opacity="0.65"/>`);
  else if (L.pattern === 'spots') for (let k = 0; k < 6; k++) parts.push(`<circle cx="${k % 2 ? 5 : -5}" cy="${-56 + k * 9}" r="2.2" fill="${L.spot}"/>`);
  else if (L.pattern === 'bars') for (let k = 0; k < 4; k++) parts.push(`<path d="M${-bw * 0.8} ${-54 + k * 13} Q 0 ${-48 + k * 13} ${bw * 0.8} ${-54 + k * 13}" stroke="${dark}" stroke-width="3" fill="none" opacity="0.7"/>`);
  else if (L.pattern === 'basilisk') for (const sx of [-1, 1]) parts.push(`<path d="M${sx * hw * 0.55} -80 Q ${sx * bw * 0.75} -40 ${sx * bw * 0.45} -4" stroke="${L.stripe}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`);
  else parts.push(`<path d="M0 -66 L0 -6" stroke="${dark}" stroke-width="4" opacity="0.4"/>`);
  if (L.casque) parts.push(`<path d="M${-hw * 0.5} -76 L0 -98 L${hw * 0.5} -76" stroke="${L.casque}" stroke-width="3" fill="none"/>`);
  // eyes bulge at the sides of the head
  for (const sx of [-1, 1]) {
    parts.push(`<circle cx="${sx * hw * 0.82}" cy="-86" r="4.4" fill="${L.lip}" stroke="${OUT}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`);
    parts.push(`<circle cx="${sx * hw * 0.9}" cy="-86.5" r="2.8" fill="#2b2320"/>`);
  }
  if (mark) parts.push(`<circle cx="0" cy="-30" r="5" fill="${mark}" stroke="#fff" stroke-width="1.2"/>`);
  if (pack) {
    parts.push(`<path d="M0 -52 Q 6 -20 2 18" stroke="${OUT}" stroke-width="1.2" fill="none"/>`);
    parts.push(`<rect x="-7" y="-64" width="14" height="13" rx="4" fill="${pack}" ${st}/>`);
    parts.push(`<rect x="-4" y="-61" width="4" height="3" rx="1" fill="#fff" opacity="0.8"/>`);
  }
  return `<g transform="translate(${n1(x)} ${n1(y + 100 * s)}) rotate(${rot}) scale(${n1(s * 1000) / 1000})">${parts.join('')}</g>`;
}

// The clear bag, held up to the light, with the lizard inside: a whole <svg>.
export function bagScene(sp, { sex = 'm', mark = null, pack = null, dewlap = 0 } = {}) {
  // a soft clear bag, twisted shut with a tie, pinched at the top in a hand and held up
  // to the sun; the lizard (a little smaller than on the other cards) lies wholly inside
  const svl = sp === 'equestris' || sp === 'basilisk' ? 80 : 92;
  const lizard = anoleSide(sp, { x: 276, y: 206, len: svl, facing: 1, sex, mark, pack, dewlap, tilt: -12, curl: true });
  const rays = [];
  for (let k = 0; k < 9; k++) {
    const a = (-70 + k * 17.5) * Math.PI / 180;
    rays.push(`<path d="M318 40 L${n1(318 + Math.cos(a) * 340)} ${n1(40 + Math.sin(a + Math.PI / 2) * 340)} L${n1(318 + Math.cos(a + 0.12) * 340)} ${n1(40 + Math.sin(a + 0.12 + Math.PI / 2) * 340)} Z" fill="#fff6c9" opacity="${k % 2 ? 0.2 : 0.32}"/>`);
  }
  const body = 'M176 98 C 150 104 112 122 102 160 C 96 184 101 204 97 222 C 94 244 108 262 126 272 C 150 286 176 280 200 284 C 226 288 254 284 276 270 C 296 256 306 236 302 212 C 299 196 305 180 300 162 C 290 124 252 106 224 98 C 214 94 208 86 206 74 L 194 74 C 192 86 186 94 176 98 Z';
  const ruffle = 'M195 72 C 186 64 176 56 181 44 L 190 51 L 194 38 L 200 49 L 207 37 L 211 50 L 220 43 C 225 55 215 64 205 72 Z';
  return `<svg class="catch-bag" viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="The lizard in a clear bag, held up to the light">
  <defs>
    <radialGradient id="bagSky" cx="0.8" cy="0.12" r="0.95"><stop offset="0" stop-color="#fffbe6"/><stop offset="0.35" stop-color="#ffe7a6"/><stop offset="1" stop-color="#9fdcf0"/></radialGradient>
    <linearGradient id="bagFilm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.5"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0.1"/><stop offset="1" stop-color="#e8f7ff" stop-opacity="0.38"/></linearGradient>
  </defs>
  <rect width="400" height="300" fill="url(#bagSky)"/>
  <g class="catch-rays">${rays.join('')}</g>
  <circle cx="318" cy="40" r="28" fill="#fff8d8"/>
  <g class="catch-bag-sway">
    <path d="${body}" fill="url(#bagFilm)" stroke="#ffffff" stroke-width="3" stroke-opacity="0.9"/>
    ${lizard}
    <path d="${body}" fill="#dff4ff" fill-opacity="0.14" stroke="#8fc8df" stroke-width="1.3" stroke-opacity="0.7"/>
    <g stroke="#fff" fill="none" stroke-linecap="round">
      <path d="M112 132 Q 100 190 122 252" stroke-width="6" opacity="0.7"/>
      <path d="M286 134 Q 296 180 284 226" stroke-width="3.5" opacity="0.55"/>
      <path d="M196 80 Q 178 100 152 116" stroke-width="2" opacity="0.5"/>
      <path d="M204 80 Q 222 100 248 116" stroke-width="2" opacity="0.5"/>
      <path d="M200 82 Q 202 100 196 118" stroke-width="1.6" opacity="0.4"/>
      <path d="M150 276 Q 200 266 250 276" stroke-width="2" opacity="0.4"/>
      <path d="M110 238 q 14 6 22 22" stroke-width="2" opacity="0.55"/>
      <path d="M290 232 q -12 8 -18 24" stroke-width="2" opacity="0.55"/>
      <path d="M140 146 q 22 18 14 44" stroke-width="1.6" opacity="0.35"/>
    </g>
    <path d="${ruffle}" fill="#eaf7ff" fill-opacity="0.8" stroke="#9fd0e6" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M198 68 L 196 50 M 204 68 L 206 50" stroke="#fff" stroke-width="1.6" opacity="0.8"/>
    <rect x="187" y="68" width="26" height="9" rx="4.5" fill="#ff7a3d" stroke="${OUT}" stroke-width="2" transform="rotate(-8 200 72)"/>
    <path d="M211 70 q 9 -3 12 3" fill="none" stroke="#ff7a3d" stroke-width="3" stroke-linecap="round"/>
    <path d="M185 -4 L 215 -4 L 217 30 L 183 30 Z" fill="#f3c29c" stroke="${OUT}" stroke-width="2.4" stroke-linejoin="round"/>
    <rect x="181" y="-4" width="38" height="12" rx="3" fill="#e9dcc0" stroke="${OUT}" stroke-width="2.2"/>
    <rect x="178" y="24" width="44" height="26" rx="12" fill="#f3c29c" stroke="${OUT}" stroke-width="2.4"/>
    <path d="M190 30 v 15 M 200 29 v 17 M 210 30 v 15" stroke="#e0a07f" stroke-width="2" stroke-linecap="round"/>
    <ellipse cx="178" cy="41" rx="6.5" ry="9.5" fill="#f3c29c" stroke="${OUT}" stroke-width="2.2" transform="rotate(-24 178 41)"/>
  </g>
  <g class="catch-sparkles" fill="#fff">
    <path d="M70 70 l4 10 l10 4 l-10 4 l-4 10 l-4 -10 l-10 -4 l10 -4 Z"/>
    <path d="M330 150 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 Z"/>
    <path d="M262 64 l2.5 6 l6 2.5 l-6 2.5 l-2.5 6 l-2.5 -6 l-6 -2.5 l6 -2.5 Z"/>
  </g>
</svg>`;
}

// A ruler strip: mm ticks from 0 to max, px per mm. Returns an SVG <g> whose zero is at
// x 0 and whose top edge is at y 0.
export function rulerStrip(max, pxPerMm) {
  const w = max * pxPerMm;
  const t = [`<rect x="-14" y="0" width="${n1(w + 28)}" height="46" rx="7" fill="#f7d77e" stroke="${OUT}" stroke-width="2.4"/>`,
    `<rect x="-14" y="30" width="${n1(w + 28)}" height="16" rx="0" fill="#eec463" opacity="0.7"/>`];
  const step = pxPerMm < 2.2 ? 2 : 1;
  for (let mm = 0; mm <= max; mm += step) {
    const x = n1(mm * pxPerMm);
    const h = mm % 10 === 0 ? 18 : mm % 5 === 0 ? 12 : 7;
    t.push(`<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="${OUT}" stroke-width="${mm % 10 === 0 ? 1.8 : 1}"/>`);
    if (mm % 10 === 0) t.push(`<text x="${x}" y="31" font-size="11" text-anchor="middle" fill="${OUT}" font-weight="700">${mm}</text>`);
  }
  t.push(`<line x1="0" y1="0" x2="0" y2="26" stroke="#e8504a" stroke-width="3"/>`);
  return `<g class="catch-ruler">${t.join('')}</g>`;
}

// A small species badge for toasts and cards: the side view in a round frame.
export function anoleBadge(sp, sex = 'm') {
  return `<svg viewBox="0 0 64 64" width="44" height="44" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="#fff7e2" stroke="${OUT}" stroke-width="2.4"/>${anoleSide(sp, { x: 58, y: 34, len: 30, facing: 1, sex })}</svg>`;
}
