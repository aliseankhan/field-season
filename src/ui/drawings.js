// Notebook drawings as inline SVG: the five anoles side on (in the colours of
// anole.js), the American crocodile, and James's portrait for the dialogue box.
// Every function returns markup; ids inside are made unique per call.

let uid = 0;
const OUT = '#4b3a26';

// Colours follow the anole models (src/lizards/anole.js), the male of each species.
export const ANOLE_LOOK = {
  cristatellus: {
    body: '#a38c4c', back: '#8a7640', belly: '#ebdfae', leg: '#9a8347', dark: '#6c5a2d',
    dew: ['#d6d64a', '#f4b83c', '#ff8a2e'], sail: true, chevrons: true, perch: 'branch', bg: '#e8f3d8',
  },
  sagrei: {
    body: '#86593a', back: '#6a4428', belly: '#eed9b3', leg: '#744c2e', dark: '#5b3920', spots: '#f1cf7e',
    dew: ['#ff4a26', '#ff6a2c', '#ffd23e'], ridge: true, perch: 'ground', bg: '#f3ead2',
  },
  carolinensis: {
    body: '#82de3c', back: '#6cca34', belly: '#f2fbdc', leg: '#78d53a', dark: '#4f9e2a', flank: '#c5ef8a',
    dew: ['#ff7fae', '#ff8fb8', '#ffb0cc'], headLen: 1.28, slim: true, perch: 'leaf', bg: '#e6f4f7',
  },
  distichus: {
    body: '#a09d8f', back: '#8f8c7f', belly: '#e4e1d0', leg: '#9a978a', dark: '#67645b', lichen: '#bccb9b',
    dew: ['#f2b24c', '#f6d766', '#fbf0a2'], flat: true, perch: 'trunk', bg: '#eef0e4',
  },
  equestris: {
    body: '#6ed63e', back: '#52bd35', belly: '#e4f7c4', leg: '#62c93a', dark: '#3f9a2a', stripe: '#fff6c8',
    dew: ['#ffadc6', '#ff9fc0', '#ffe0ea'], casque: true, headLen: 1.12, big: true, perch: 'branch', bg: '#e3f1dc',
  },
};

const SIL = { body: '#b8a883', back: '#b8a883', belly: '#b8a883', leg: '#a9997a', dark: '#b8a883', out: '#8f8068' };

function leg(pts, colour, out) {
  const d = 'M' + pts.map((p) => p.join(' ')).join(' L');
  const [fx, fy] = pts[pts.length - 1];
  const toes = [[-7, 3], [0, 5], [7, 3]].map(([dx, dy]) => `M${fx} ${fy} l${dx} ${dy}`).join(' ');
  return `<path d="${d}" stroke="${out}" stroke-width="15" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${toes}" stroke="${out}" stroke-width="7" fill="none" stroke-linecap="round"/>` +
    `<path d="${d}" stroke="${colour}" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${toes}" stroke="${colour}" stroke-width="3.4" fill="none" stroke-linecap="round"/>`;
}

function perchArt(kind, id) {
  if (kind === 'ground') {
    return `<path d="M0 138 Q80 130 160 136 T320 134 V170 H0z" fill="#cdb488"/>` +
      `<path d="M0 138 Q80 130 160 136 T320 134" stroke="#a88b5c" stroke-width="3" fill="none"/>` +
      '<g stroke="#7cb85a" stroke-width="3.5" stroke-linecap="round" fill="none">' +
      '<path d="M40 136 l-4 -12 M44 136 l2 -14 M48 136 l6 -10"/><path d="M262 135 l-5 -11 M266 135 l1 -14 M270 135 l6 -9"/>' +
      '<path d="M300 134 l-3 -9 M304 134 l3 -10"/></g>' +
      '<circle cx="210" cy="146" r="4" fill="#b99c6c"/><circle cx="96" cy="150" r="3" fill="#b99c6c"/>';
  }
  if (kind === 'leaf') {
    return `<path d="M-10 146 C 60 112, 190 112, 330 140 C 200 168, 70 170, -10 146z" fill="#6fcf5a" stroke="#3f8f3a" stroke-width="3"/>` +
      '<path d="M0 145 C 90 132, 200 132, 320 141" stroke="#a6e38e" stroke-width="3" fill="none"/>' +
      '<path d="M90 137 l-12 10 M150 134 l-10 12 M210 135 l-8 12 M260 137 l-6 10" stroke="#a6e38e" stroke-width="2" fill="none"/>';
  }
  if (kind === 'trunk') {
    return `<path d="M-5 128 C 80 124, 240 124, 325 130 L325 170 L-5 170z" fill="#9b7b5c" stroke="#6e5238" stroke-width="3"/>` +
      '<path d="M20 142 q30 -4 60 2 M150 150 q40 -5 80 1 M250 138 q20 -3 40 1" stroke="#7d5f43" stroke-width="3" fill="none" stroke-linecap="round"/>' +
      '<ellipse cx="120" cy="140" rx="9" ry="4" fill="#bccb9b" opacity=".8"/><ellipse cx="228" cy="156" rx="7" ry="3" fill="#bccb9b" opacity=".8"/>';
  }
  // a branch
  return `<path d="M-10 134 C 80 128, 200 130, 330 138" stroke="#6e5238" stroke-width="15" fill="none" stroke-linecap="round"/>` +
    '<path d="M-10 134 C 80 128, 200 130, 330 138" stroke="#9b7b5c" stroke-width="9" fill="none" stroke-linecap="round"/>' +
    '<path d="M250 135 q20 -18 40 -22" stroke="#6e5238" stroke-width="7" fill="none" stroke-linecap="round"/>' +
    '<path d="M292 112 c8 -10 22 -8 24 2 c-8 8 -20 8 -24 -2z" fill="#7ccb6a" stroke="#3f8f3a" stroke-width="2"/>';
}

// A cute side-on anole facing right. opts: { silhouette, dewlap (default true for
// the male look), perch (default true), background (default true), rig (the body,
// head and tail in groups .an-lift, the front legs in .an-fleg and the dewlap in
// .an-dew, for the title's push-ups) }.
export function anoleSVG(sp, opts = {}) {
  const L = ANOLE_LOOK[sp] || ANOLE_LOOK.cristatellus;
  const sil = !!opts.silhouette;
  const c = sil ? SIL : L;
  const out = sil ? SIL.out : OUT;
  const id = 'an' + (++uid);
  const hl = L.headLen || 1;
  const hx = (x) => 198 + (x - 198) * hl; // stretch the head forwards
  const bodyRy = L.flat ? 17 : L.slim ? 18.5 : 21;
  const bg = opts.background === false ? '' : `<rect width="320" height="170" rx="14" fill="${sil ? '#efe6d2' : L.bg}"/>`;
  const perch = opts.perch === false ? '' : perchArt(L.perch, id);
  const dewOn = !sil && opts.dewlap !== false;

  const head = `M198 74 C214 66 ${hx(238)} 68 ${hx(256)} 78 C${hx(268)} 84 ${hx(274)} ${L.big ? 92 : 90} ${hx(270)} ${L.big ? 98 : 95} ` +
    `C${hx(262)} ${L.big ? 106 : 101} ${hx(240)} ${L.big ? 108 : 104} ${hx(222)} ${L.big ? 109 : 106} C208 108 196 106 190 100 Z`;
  const tail = 'M128 84 C95 80 55 84 10 66 C50 90 92 104 130 108 Z';

  let sail = '';
  if (L.sail) {
    // the tall, scalloped tail crest of the male
    let d = 'M134 86';
    const bumps = [[121, 52], [108, 58], [95, 50], [83, 40], [72, 30], [62, 20]];
    let x = 134;
    for (const [nx, h] of bumps) { d += ` Q${(x + nx) / 2 + 2} ${86 - h} ${nx} ${86 - (134 - nx) * 0.05}`; x = nx; }
    d += ' L60 84 Z';
    sail = `<path d="${d}" fill="${sil ? c.body : '#8e7c46'}" stroke="${out}" stroke-width="3" stroke-linejoin="round"/>`;
  }
  let ridge = '';
  if (L.ridge || L.casque) {
    let d = '';
    for (let x = 196; x > 128; x -= 9) d += `M${x} ${76 - Math.sin((x - 120) / 80 * Math.PI) * 4} l-4.5 -7 l-4.5 7 `;
    ridge = `<path d="${d}" fill="${sil ? c.body : c.dark}" stroke="${out}" stroke-width="2" stroke-linejoin="round"/>`;
  }

  // body details, clipped to the body
  let marks = '';
  if (!sil) {
    if (L.chevrons) marks += `<path d="M140 78 l9 9 l9 -9 M162 76 l9 9 l9 -9 M184 78 l8 8 l8 -8" stroke="${L.dark}" stroke-width="5" fill="none" stroke-linecap="round" opacity=".55"/>`;
    if (L.spots) marks += [[150, 92], [166, 88], [180, 95], [140, 100], [196, 90], [158, 102]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.2" fill="${L.spots}"/>`).join('');
    if (L.flank) marks += `<path d="M126 98 C150 102 180 102 204 98" stroke="${L.flank}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    if (L.lichen) {
      marks += [[140, 84, 9, 5], [170, 80, 11, 6], [196, 88, 7, 5], [158, 96, 6, 4]].map(([x, y, rx, ry]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${L.lichen}"/>`).join('');
      marks += [[152, 88], [184, 92], [132, 94], [206, 82]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="${L.dark}" opacity=".7"/>`).join('');
      marks += `<path d="M150 76 l7 6 l7 -6 M176 76 l7 6 l7 -6" stroke="${L.dark}" stroke-width="3.5" fill="none" opacity=".45"/>`;
    }
    marks += `<ellipse cx="165" cy="${95 + bodyRy * 0.95}" rx="46" ry="${bodyRy * 0.55}" fill="${L.belly}"/>`;
  }
  const body = `<ellipse cx="165" cy="95" rx="50" ry="${bodyRy}"`;

  let headMarks = '';
  if (!sil) {
    headMarks += `<path d="M${hx(270)} 94 Q${hx(250)} 101 ${hx(232)} 99" stroke="${out}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
    headMarks += `<circle cx="${hx(263)}" cy="84" r="1.8" fill="${out}"/>`;
    if (L.stripe) headMarks += `<path d="M206 101 C${hx(222)} 102 ${hx(238)} 102 ${hx(250)} 99" stroke="${L.stripe}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
    if (L.casque) headMarks += `<path d="M204 72 L${hx(250)} 76 M${hx(214)} 69 L${hx(262)} 83 M${hx(226)} 70 L${hx(236)} 84" stroke="${L.dark}" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".7"/>`;
    headMarks += `<ellipse cx="${hx(244)}" cy="96" rx="6" ry="3.5" fill="#ff9f9f" opacity=".35"/>`;
  }
  const ex = 198 + 28 * Math.min(hl, 1.1), ey = 83, er = L.big ? 8 : 9.2;
  const eye = sil ? '' :
    `<circle cx="${ex}" cy="${ey}" r="${er + 3}" fill="${c.dark}" opacity=".55"/>` +
    `<circle cx="${ex}" cy="${ey}" r="${er}" fill="#1f1a15"/>` +
    `<circle cx="${ex - er * 0.32}" cy="${ey - er * 0.35}" r="${er * 0.34}" fill="#fff"/>` +
    `<circle cx="${ex + er * 0.35}" cy="${ey + er * 0.3}" r="${er * 0.14}" fill="#fff"/>`;

  let dew = '';
  if (dewOn) {
    const [a, b, e] = L.dew;
    const big = L.big ? 1.25 : 1;
    const x0 = 204, x1 = hx(246);
    dew = `<defs><radialGradient id="${id}d" cx="30%" cy="10%" r="95%"><stop offset="0" stop-color="${a}"/><stop offset=".6" stop-color="${b}"/><stop offset="1" stop-color="${e}"/></radialGradient></defs>` +
      `<path d="M${x0} 104 C${x0 - 4} ${104 + 32 * big} ${x1 - 12} ${104 + 42 * big} ${x1} 104 Z" fill="url(#${id}d)" stroke="${out}" stroke-width="3" stroke-linejoin="round"/>` +
      `<path d="M${x0 + 6} ${112 + 6 * big} q${(x1 - x0) * 0.4} ${10 * big} ${(x1 - x0) * 0.75} 0 M${x0 + 10} ${122 + 10 * big} q${(x1 - x0) * 0.3} ${8 * big} ${(x1 - x0) * 0.55} 0" stroke="#fff" stroke-opacity=".45" stroke-width="2" fill="none"/>`;
  }

  // with rig, the parts move as groups (the legs' feet stay put)
  const g = (cls, inner) => (opts.rig ? `<g class="${cls}">${inner}</g>` : inner);
  return `<svg viewBox="0 0 320 170" xmlns="http://www.w3.org/2000/svg" role="img">` +
    `<defs><clipPath id="${id}c">${body}/></clipPath></defs>` +
    bg + perch +
    g('an-fleg', leg([[208, 104], [222, 118], [216, 131]], sil ? c.leg : L.dark, out)) +
    leg([[134, 100], [150, 116], [144, 129]], sil ? c.leg : L.dark, out) +
    g('an-lift', `<path d="${tail}" fill="${c.body}" stroke="${out}" stroke-width="3" stroke-linejoin="round"/>` +
      sail + ridge +
      `${body} fill="${c.body}" stroke="${out}" stroke-width="3"/>` +
      `<g clip-path="url(#${id}c)">${marks}</g>`) +
    g('an-fleg', leg([[196, 106], [186, 122], [196, 134]], c.leg, out)) +
    leg([[124, 104], [106, 118], [118, 132]], c.leg, out) +
    g('an-lift', g('an-dew', dew) +
      `<path d="${head}" fill="${c.body}" stroke="${out}" stroke-width="3" stroke-linejoin="round"/>` +
      headMarks + eye) +
    (sil ? `<text x="160" y="60" text-anchor="middle" font-size="34" font-weight="800" fill="#8f8068" font-family="system-ui, sans-serif">?</text>` : '') +
    '</svg>';
}

// The American crocodile on a muddy bank, a friendly grin and a row of scutes.
export function crocSVG(opts = {}) {
  const sil = !!opts.silhouette;
  const body = sil ? SIL.body : '#7d8c4e', back = sil ? SIL.body : '#5f6d38', belly = sil ? SIL.body : '#e2dca8';
  const out = sil ? SIL.out : '#3d4424';
  const scutes = [];
  for (let x = 40; x < 206; x += 12) {
    const y = x < 120 ? 90 - (x - 40) * 0.07 : 80 + Math.abs(x - 165) * 0.08;
    scutes.push(`M${x} ${y + 3} l5 -8 l5 8`);
  }
  let teeth = '';
  if (!sil) for (let x = 240; x < 296; x += 7) teeth += `M${x} 105 l3 5 l3 -5 `;
  return `<svg viewBox="0 0 320 170" xmlns="http://www.w3.org/2000/svg" role="img">` +
    (opts.background === false ? '' : `<rect width="320" height="170" rx="14" fill="${sil ? '#efe6d2' : '#e3f0ea'}"/>`) +
    `<path d="M0 132 Q100 124 200 130 T320 128 V170 H0z" fill="${sil ? '#e0d4b8' : '#c8ad83'}"/>` +
    (sil ? '' : '<path d="M0 150 q20 -6 40 0 t40 0 t40 0" stroke="#7fcfc6" stroke-width="4" fill="none" stroke-linecap="round"/>') +
    leg([[210, 108], [222, 122], [216, 131]], back, out) +
    leg([[128, 106], [140, 120], [134, 130]], back, out) +
    `<path d="${scutes.join(' ')}" fill="${back}" stroke="${out}" stroke-width="2" stroke-linejoin="round"/>` +
    `<path d="M16 100 C50 86 100 84 132 86 L134 112 C100 114 56 110 16 100 Z" fill="${body}" stroke="${out}" stroke-width="3" stroke-linejoin="round"/>` +
    `<ellipse cx="168" cy="98" rx="58" ry="22" fill="${body}" stroke="${out}" stroke-width="3"/>` +
    `<ellipse cx="168" cy="113" rx="48" ry="8" fill="${belly}"/>` +
    leg([[196, 110], [186, 124], [196, 133]], body, out) +
    leg([[134, 108], [120, 122], [130, 132]], body, out) +
    `<path d="M206 88 C232 82 262 88 300 95 C308 98 308 106 300 108 C270 114 240 115 206 113 Z" fill="${body}" stroke="${out}" stroke-width="3" stroke-linejoin="round"/>` +
    (sil ? '' : `<path d="${teeth}" fill="#fffdf2" stroke="${out}" stroke-width="1.2" stroke-linejoin="round"/>` +
      `<path d="M298 102 C270 106 244 106 214 104" stroke="${out}" stroke-width="2.5" fill="none" stroke-linecap="round"/>` +
      '<circle cx="296" cy="95" r="2" fill="#3d4424"/>' +
      `<circle cx="228" cy="84" r="10" fill="${body}" stroke="${out}" stroke-width="3"/>` +
      '<circle cx="229" cy="84" r="6.5" fill="#f2d25a"/><ellipse cx="229" cy="84" rx="2" ry="5.5" fill="#1f1a15"/>' +
      '<circle cx="226.5" cy="81" r="1.8" fill="#fff"/>') +
    (sil ? `<text x="160" y="60" text-anchor="middle" font-size="34" font-weight="800" fill="#8f8068" font-family="system-ui, sans-serif">?</text>` : '') +
    '</svg>';
}

// James: backwards dark cap, khaki-grey field shirt, light stubble and a big grin.
export function jamesPortrait() {
  const id = 'jp' + (++uid);
  return `<svg viewBox="7 6 86 86" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="James">` +
    `<defs><pattern id="${id}s" width="3" height="3" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r=".55" fill="#6b4f3a" opacity=".45"/></pattern></defs>` +
    // shirt with the collar open
    '<path d="M8 102 C12 82 28 75 50 75 C72 75 88 82 92 102z" fill="#aaa68b" stroke="#6f6a52" stroke-width="2"/>' +
    '<path d="M40 76 L50 88 L60 76" fill="#e9b98f" stroke="#6f6a52" stroke-width="1.5"/>' +
    '<path d="M36 76 L44 90 L50 80 M64 76 L56 90 L50 80" fill="#bdb99e" stroke="#6f6a52" stroke-width="1.8" stroke-linejoin="round"/>' +
    '<path d="M22 86 l6 -2 M78 86 l-6 -2" stroke="#6f6a52" stroke-width="1.5"/>' +
    // neck, ears, head
    '<rect x="43" y="62" width="14" height="16" rx="5" fill="#e3ad83"/>' +
    '<circle cx="27.5" cy="51" r="5" fill="#e9b98f" stroke="#8a5b3e" stroke-width="1.5"/>' +
    '<circle cx="72.5" cy="51" r="5" fill="#e9b98f" stroke="#8a5b3e" stroke-width="1.5"/>' +
    '<ellipse cx="50" cy="49" rx="22.5" ry="24" fill="#f0c49c" stroke="#8a5b3e" stroke-width="1.8"/>' +
    // light stubble round the jaw
    `<path d="M29 55 C31 70 42 73 50 73 C58 73 69 70 71 55 C66 62 60 64 50 64 C40 64 34 62 29 55z" fill="url(#${id}s)"/>` +
    // sideburns
    '<path d="M28.5 44 q0 6 1.5 9 M71.5 44 q0 6 -1.5 9" stroke="#5a3e2b" stroke-width="3" stroke-linecap="round"/>' +
    // cap, worn backwards: the strap opening over the forehead
    '<path d="M62 22 C72 16 86 18 90 25 C84 28 74 28 66 29z" fill="#232a36" stroke="#1b2029" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M26.5 43 C25 22 38 16.5 50 16.5 C62 16.5 75 22 73.5 43 C66 37.5 34 37.5 26.5 43z" fill="#2e3542" stroke="#1b2029" stroke-width="1.6"/>' +
    '<path d="M42.5 39.5 Q50 30.5 57.5 39.5z" fill="#5a3e2b"/>' +
    '<path d="M41.5 40 H58.5" stroke="#1b2029" stroke-width="2.2" stroke-linecap="round"/>' +
    '<circle cx="50" cy="17.2" r="1.7" fill="#3e4757"/>' +
    '<path d="M36 25 Q50 20 64 25" stroke="#3e4757" stroke-width="1.2" fill="none"/>' +
    // brows, eyes, nose, cheeks
    '<path d="M36.5 43.5 q4 -2.5 8 -.5 M55.5 43 q4 -2 8 .5" stroke="#5a3e2b" stroke-width="2" fill="none" stroke-linecap="round"/>' +
    '<path d="M37.5 49.5 q3.2 -3.5 6.4 0 M56 49.5 q3.2 -3.5 6.4 0" stroke="#2b2320" stroke-width="2.4" fill="none" stroke-linecap="round"/>' +
    '<path d="M49 51 q2.5 4 -1 5" stroke="#b07a58" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
    '<ellipse cx="35" cy="57" rx="4.2" ry="2.6" fill="#ff9d8a" opacity=".55"/><ellipse cx="65" cy="57" rx="4.2" ry="2.6" fill="#ff9d8a" opacity=".55"/>' +
    // the big grin
    '<path d="M38 58.5 Q50 74 62 58.5 Q50 61.5 38 58.5z" fill="#8c3b36" stroke="#6a2a26" stroke-width="1.4" stroke-linejoin="round"/>' +
    '<path d="M39.5 59.2 Q50 62.4 60.5 59.2 L59.6 61.6 Q50 64.4 40.4 61.6z" fill="#fffdf6"/>' +
    '<path d="M44 66 Q50 69.5 56 66 Q50 71 44 66z" fill="#e8747a"/>' +
    '</svg>';
}

// The player's own little badge for the name box: their hat and shirt colours.
export function playerBadge(looks = {}) {
  const hat = looks.hat || '#f2dca0', shirt = looks.shirt || '#7cc7f0';
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img">` +
    `<path d="M10 102 C14 82 30 76 50 76 C70 76 86 82 90 102z" fill="${shirt}" stroke="#3a2f2a" stroke-width="2"/>` +
    '<path d="M30 80 L36 102 M70 80 L64 102" stroke="#d9a55a" stroke-width="9"/>' +
    '<ellipse cx="50" cy="52" rx="23" ry="23" fill="#f3c29c" stroke="#3a2f2a" stroke-width="2"/>' +
    '<path d="M28 46 q0 10 4 14 M72 46 q0 10 -4 14" stroke="#6b4128" stroke-width="5" stroke-linecap="round"/>' +
    '<circle cx="42" cy="53" r="3" fill="#2b2320"/><circle cx="58" cy="53" r="3" fill="#2b2320"/>' +
    '<circle cx="41" cy="52" r="1" fill="#fff"/><circle cx="57" cy="52" r="1" fill="#fff"/>' +
    '<ellipse cx="36" cy="60" rx="4" ry="2.4" fill="#ff8f8f" opacity=".6"/><ellipse cx="64" cy="60" rx="4" ry="2.4" fill="#ff8f8f" opacity=".6"/>' +
    '<path d="M45 62 q5 4 10 0" stroke="#9a4b3c" stroke-width="2.2" fill="none" stroke-linecap="round"/>' +
    `<ellipse cx="50" cy="36" rx="34" ry="8" fill="${hat}" stroke="#3a2f2a" stroke-width="2"/>` +
    `<path d="M31 36 C31 18 69 18 69 36z" fill="${hat}" stroke="#3a2f2a" stroke-width="2"/>` +
    '<path d="M31.5 32 C40 29 60 29 68.5 32" stroke="#e8744f" stroke-width="4" fill="none"/>' +
    '<circle cx="62" cy="31" r="3" fill="#fffaf0" stroke="#e0c070" stroke-width="1"/><circle cx="62" cy="31" r="1.2" fill="#ffc93a"/>' +
    '</svg>';
}
