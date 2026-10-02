// Notebook drawings as inline SVG: the five anoles side on (in the colours of
// anole.js), the brown basilisk running on the water, the American crocodile, and James's
// and Jon's portraits for the dialogue box.
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
  // the brown basilisk (src/wildlife/basilisk_model.js), drawn by basiliskSVG
  vittatus: { body: '#8a7444', back: '#76623a', belly: '#d9c690', leg: '#7c6739', dark: '#5f4d2b', stripe: '#f6e6a4', crest: '#a17f47', bg: '#e1eff0' },
};
ANOLE_LOOK.basilisk = ANOLE_LOOK.vittatus; // (the board and the day notebooks go by the species key)

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
  if (sp === 'vittatus' || sp === 'basilisk') return basiliskSVG(opts);
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

// A male brown basilisk up on its hind legs running across the water, facing right: the
// tall head crest, low crests down the back and tail, two pale stripes down the side and
// little splashes under its feet. opts: { silhouette, background (default true), sex }.
export function basiliskSVG(opts = {}) {
  const L = ANOLE_LOOK.vittatus;
  const sil = !!opts.silhouette, male = opts.sex !== 'f';
  const c = sil ? SIL : L, out = sil ? SIL.out : OUT;
  const id = 'bz' + (++uid);
  const bg = opts.background === false ? '' : `<rect width="320" height="170" rx="14" fill="${sil ? '#efe6d2' : L.bg}"/>`;
  const water = `<path d="M0 132 Q80 126 160 131 T320 129 V170 H0z" fill="${sil ? '#e0d4b8' : '#9fd8d6'}"/>` +
    (sil ? '' : '<path d="M14 148 q16 -5 32 0 t32 0 M200 152 q16 -5 32 0 t32 0" stroke="#d6f3ef" stroke-width="3" fill="none" stroke-linecap="round"/>');
  const splash = sil ? '' : [[150, 131], [182, 133], [118, 130]].map(([x, y], k) =>
    `<path d="M${x - 10} ${y} q4 -9 6 -1 M${x - 2} ${y - 1} q2 -12 5 -1 M${x + 6} ${y} q5 -8 7 0" stroke="#ffffff" stroke-width="2.6" fill="none" stroke-linecap="round" opacity="${0.95 - k * 0.25}"/>` +
    `<ellipse cx="${x}" cy="${y + 2}" rx="${14 - k * 2}" ry="3" fill="none" stroke="#ffffff" stroke-width="1.8" opacity="${0.8 - k * 0.2}"/>`).join('');
  // the body pitched up from the hips, the tail streaming back
  const tail = 'M150 98 C118 96 80 98 44 92 C30 90 18 86 8 80 C20 92 40 98 60 102 C92 108 124 110 150 112 Z';
  const body = 'M144 112 C134 98 150 78 172 64 C186 55 202 54 210 64 C214 72 206 86 192 96 C178 106 160 116 150 118 Z';
  const head = 'M200 66 C200 48 214 38 230 40 C246 42 258 50 262 60 C264 66 258 70 250 70 C236 72 216 76 206 74 Z';
  const crest = male
    ? `<path d="M206 50 L190 8 L214 40 Z" fill="${sil ? c.body : L.crest}" stroke="${out}" stroke-width="3" stroke-linejoin="round"/>`
    : `<path d="M208 48 L200 30 L216 41 Z" fill="${sil ? c.body : L.crest}" stroke="${out}" stroke-width="3" stroke-linejoin="round"/>`;
  let ridge = '';
  if (male) {
    let d = '';
    for (let k = 0; k < 6; k++) { const x = 196 - k * 9, y = 60 + k * 7.4; d += `M${x} ${y} l-3 -8 l-6 6 `; }
    for (let k = 0; k < 5; k++) { const x = 142 - k * 9, y = 98 - k * 0.4; d += `M${x} ${y} l-3 -7 l-6 6 `; }
    ridge = `<path d="${d}" fill="${sil ? c.body : L.crest}" stroke="${out}" stroke-width="2" stroke-linejoin="round"/>`;
  }
  let marks = '';
  if (!sil) {
    marks += `<path d="M150 112 C160 104 172 98 184 92" stroke="${L.belly}" stroke-width="9" fill="none" stroke-linecap="round"/>`;
    marks += `<path d="M152 104 C164 90 178 76 198 66" stroke="${L.stripe}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
    marks += `<path d="M168 104 C178 96 188 88 196 84" stroke="${L.stripe}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    for (let k = 0; k < 6; k++) marks += `<path d="M${136 - k * 20} ${92 - k * 1.2} q-4 8 0 ${16 - k * 1.6}" stroke="${L.dark}" stroke-width="${5 - k * 0.5}" fill="none" opacity=".55" stroke-linecap="round"/>`;
  }
  const headMarks = sil ? '' :
    `<path d="M216 66 C226 70 242 69 254 66" stroke="${L.stripe}" stroke-width="4" fill="none" stroke-linecap="round"/>` +
    `<path d="M228 52 C220 54 212 58 206 64" stroke="${L.stripe}" stroke-width="3.6" fill="none" stroke-linecap="round"/>` +
    `<path d="M260 62 Q246 66 236 64" stroke="${out}" stroke-width="2.2" fill="none" stroke-linecap="round"/>` +
    '<circle cx="256" cy="54" r="1.6" fill="#4b3a26"/>' +
    '<circle cx="236" cy="52" r="10.5" fill="#e2c35e" stroke="#4b3a26" stroke-width="2"/><circle cx="237.5" cy="52" r="7.4" fill="#1f1a15"/>' +
    '<circle cx="234.5" cy="48.8" r="2.6" fill="#fff"/><circle cx="240" cy="55" r="1.1" fill="#fff"/>';
  // the hind legs mid-stride and the front legs tucked up
  const hind = (pts, col) => leg(pts, col, out);
  return `<svg viewBox="0 0 320 170" xmlns="http://www.w3.org/2000/svg" role="img">` +
    `<defs><clipPath id="${id}c"><path d="${body}"/><path d="${tail}"/></clipPath></defs>` +
    bg + water + splash +
    hind([[150, 112], [128, 120], [118, 130]], sil ? c.leg : L.dark) +
    `<path d="${tail}" fill="${c.body}" stroke="${out}" stroke-width="3" stroke-linejoin="round"/>` +
    ridge + crest +
    `<path d="${body}" fill="${c.body}" stroke="${out}" stroke-width="3" stroke-linejoin="round"/>` +
    `<g clip-path="url(#${id}c)">${marks}</g>` +
    hind([[156, 112], [178, 118], [170, 132]], c.leg) +
    leg([[196, 86], [208, 92], [214, 86]], c.leg, out) +
    `<path d="${head}" fill="${c.body}" stroke="${out}" stroke-width="3" stroke-linejoin="round"/>` +
    headMarks +
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

// James: short neat sandy blonde hair, backwards dark cap, khaki-grey field shirt, light
// stubble and a big grin.
export function jamesPortrait() {
  const id = 'jp' + (++uid);
  return `<svg viewBox="7 6 86 86" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="James">` +
    `<defs><pattern id="${id}s" width="3" height="3" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r=".55" fill="#b98a55" opacity=".5"/></pattern></defs>` +
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
    // the sandy blonde hair, short and neat: a tidy hairline under the cap in front, a close
    // strip above the ears and neat short sideburns
    '<path d="M26.9 40.2 C26.6 42 26.8 44 27.4 45.8 L28.3 48.2 L30.6 48.2 C30.6 46 31 44 32.6 42.2 ' +
    'C36 40 42 39.1 50 39.2 C58 39.1 64 40 67.4 42.2 C69 44 69.4 46 69.4 48.2 L71.7 48.2 L72.6 45.8 ' +
    'C73.2 44 73.4 42 73.1 40.2 L73 34 L27 34z" fill="#d8b878" stroke="#9a7a45" stroke-width="1.1" stroke-linejoin="round"/>' +
    '<path d="M28.6 44.6 C28.7 43 29.4 41.9 30.6 41.2 M71.4 44.6 C71.3 43 70.6 41.9 69.4 41.2 M43 40.2 Q50 38.9 57 40.2" stroke="#ecd59f" stroke-width="1.1" fill="none" stroke-linecap="round"/>' +
    // cap, worn backwards (the peak is behind his head, out of view): his hair showing
    // through the strap opening
    '<path d="M26.7 40.2 C25.3 20.5 38 15.8 50 15.8 C62 15.8 74.7 20.5 73.3 40.2 C66 34.6 34 34.6 26.7 40.2z" fill="#2e3542" stroke="#1b2029" stroke-width="1.6"/>' +
    '<path d="M41.5 36.4 Q50 25 58.5 36.4z" fill="#d8b878" stroke="#9a7a45" stroke-width="1"/>' +
    '<path d="M40.5 36.6 H59.5" stroke="#1b2029" stroke-width="2.3" stroke-linecap="round"/>' +
    '<circle cx="50" cy="16.5" r="1.7" fill="#3e4757"/>' +
    '<path d="M36 24.3 Q50 19.3 64 24.3" stroke="#3e4757" stroke-width="1.2" fill="none"/>' +
    // brows, eyes, nose, cheeks
    '<path d="M37 44.6 q3.8 -2 7.6 -.4 M55.4 44.2 q3.8 -1.6 7.6 .4" stroke="#9a7448" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
    '<path d="M37.5 49.5 q3.2 -3.5 6.4 0 M56 49.5 q3.2 -3.5 6.4 0" stroke="#2b2320" stroke-width="2.4" fill="none" stroke-linecap="round"/>' +
    '<path d="M49 51 q2.5 4 -1 5" stroke="#b07a58" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
    '<ellipse cx="35" cy="57" rx="4.2" ry="2.6" fill="#ff9d8a" opacity=".55"/><ellipse cx="65" cy="57" rx="4.2" ry="2.6" fill="#ff9d8a" opacity=".55"/>' +
    // the big grin
    '<path d="M38 58.5 Q50 74 62 58.5 Q50 61.5 38 58.5z" fill="#8c3b36" stroke="#6a2a26" stroke-width="1.4" stroke-linejoin="round"/>' +
    '<path d="M39.5 59.2 Q50 62.4 60.5 59.2 L59.6 61.6 Q50 64.4 40.4 61.6z" fill="#fffdf6"/>' +
    '<path d="M44 66 Q50 69.5 56 66 Q50 71 44 66z" fill="#e8747a"/>' +
    '</svg>';
}

// Jon: big fluffy wavy dark hair to the shoulders under the head torch's green band, thin
// dark rectangular glasses, a moustache and a short chin beard along the jaw, a big toothy
// grin, a fine blue gingham shirt, a plain green lanyard and the orange straps of his GPS
// backpack.
export function jonPortrait() {
  const id = 'jn' + (++uid);
  const hair = '#2b1d17', hairEdge = '#140c09', wave = '#4a3427';
  // a cloud of tufts: an outline pass under a fill pass, so only the outside is edged
  const cloud = (tufts, w) => tufts.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${hair}" stroke="${hairEdge}" stroke-width="${w}"/>`).join('') +
    tufts.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${hair}"/>`).join('');
  // the chin beard: round the jaw from 50 to 130 degrees, deepest under the lip
  const jaw = (k, d) => { const t = (d * Math.PI) / 180; return `${(50 + 22.5 * k * Math.cos(t)).toFixed(1)} ${(49 + 24 * k * Math.sin(t)).toFixed(1)}`; };
  const bump = (d) => Math.cos(((d - 90) / 40) * (Math.PI / 2)) ** 2;
  const outer = [], inner = [];
  for (let d = 50; d <= 130; d += 5) { outer.push(jaw(1.02 + 0.09 * bump(d), d)); inner.unshift(jaw(0.99 - 0.075 * bump(d), d)); }
  const mouth = 'M37 60.8 Q50 63.8 63 60.8 Q61 69 50 69.6 Q39 69 37 60.8z';
  return `<svg viewBox="7 6 86 86" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Jon">` +
    `<defs><pattern id="${id}c" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#eef3fb"/>` +
    '<rect width="2" height="4" fill="#9dbdf0"/><rect width="4" height="2" fill="#9dbdf0"/><rect width="2" height="2" fill="#4a78cc"/></pattern>' +
    `<clipPath id="${id}m"><path d="${mouth}"/></clipPath></defs>` +
    // the hair behind: a few big soft waves, a little wider than the head at the ears and
    // falling to the shoulders
    cloud([[50, 30, 19], [33, 29, 12.5], [67, 29, 12.5], [28.5, 44, 10.5], [71.5, 44, 10.5], [29, 59, 10], [71, 59, 10], [31.5, 72, 9], [68.5, 72, 9]], 3.2) +
    `<path d="M22 40 q4 5 1 10 q-3 5 0.5 10 M78 40 q-4 5 -1 10 q3 5 -0.5 10 M24.5 66 q3 4 1 8.5 M75.5 66 q-3 4 -1 8.5" stroke="${wave}" stroke-width="1.3" fill="none" stroke-linecap="round"/>` +
    // the checked shirt, its collar, the lanyard and the backpack's straps
    `<path d="M8 102 C12 82 28 75 50 75 C72 75 88 82 92 102z" fill="url(#${id}c)" stroke="#2f4f8a" stroke-width="2"/>` +
    '<path d="M40 76 L50 88 L60 76" fill="#e8b48e" stroke="#2f4f8a" stroke-width="1.5"/>' +
    '<path d="M36 76 L44 90 L50 80 M64 76 L56 90 L50 80" fill="#cfe0fa" stroke="#2f4f8a" stroke-width="1.8" stroke-linejoin="round"/>' +
    '<path d="M27 79 L31 102 M73 79 L69 102" stroke="#c4581f" stroke-width="7" stroke-linecap="round"/>' +
    '<path d="M27 79 L31 102 M73 79 L69 102" stroke="#ff8a3d" stroke-width="4.4" stroke-linecap="round"/>' +
    '<path d="M43.5 77.5 L49 89.4 M56.5 77.5 L51 89.4" stroke="#3fae4a" stroke-width="2.4" stroke-linecap="round"/>' +
    '<circle cx="50" cy="90.2" r="1.7" fill="#9aa0a8" stroke="#6b7078" stroke-width=".8"/>' +
    // neck and face
    '<rect x="43" y="62" width="14" height="16" rx="5" fill="#dea47e"/>' +
    '<ellipse cx="50" cy="49" rx="22.5" ry="24" fill="#efc29b" stroke="#8a5b3e" stroke-width="1.8"/>' +
    // the hair over the face: a wave down each side, and the crown bulging over the band
    cloud([[26.5, 44, 6.5], [73.5, 44, 6.5], [25.5, 57.5, 5.6], [74.5, 57.5, 5.6], [38, 27.5, 8], [62, 27.5, 8], [50, 25, 8.5]], 2.4) +
    `<path d="M24.6 46 q2.4 3.4 .4 7 M75.4 46 q-2.4 3.4 -.4 7 M36 24.5 q4 -2.6 8 -1 M56 23.5 q4 -1.6 8 1" stroke="${wave}" stroke-width="1.1" fill="none" stroke-linecap="round"/>` +
    // the green band round the hair, pressing it in, and the head torch
    '<path d="M19.5 41.5 C27 31.6 73 31.6 80.5 41.5 L81 36.8 C73 26.2 27 26.2 19 36.8z" fill="#3fae4a" stroke="#23752f" stroke-width="1.3" stroke-linejoin="round"/>' +
    '<rect x="43.6" y="24.2" width="12.8" height="9" rx="2.6" fill="#373b42" stroke="#1d2024" stroke-width="1.2"/>' +
    '<circle cx="50" cy="28.7" r="3.1" fill="#fff3b0" stroke="#b9a24c" stroke-width="1"/><circle cx="49" cy="27.7" r=".9" fill="#ffffff"/>' +
    // brows, the eyes behind thin dark rectangular glasses, nose, cheeks
    `<path d="M36.4 42.4 q4 -2.2 8 -.6 M55.6 41.8 q4 -1.6 8 .6" stroke="${hair}" stroke-width="2.3" fill="none" stroke-linecap="round"/>` +
    '<path d="M38.4 50.2 q2.8 -3 5.6 0 M56 50.2 q2.8 -3 5.6 0" stroke="#2b2320" stroke-width="2.2" fill="none" stroke-linecap="round"/>' +
    '<rect x="34.4" y="44.6" width="13.2" height="10" rx="1.4" fill="#e4f3fb" fill-opacity=".35" stroke="#1f1a1a" stroke-width="1.4"/>' +
    '<rect x="52.4" y="44.6" width="13.2" height="10" rx="1.4" fill="#e4f3fb" fill-opacity=".35" stroke="#1f1a1a" stroke-width="1.4"/>' +
    '<path d="M47.6 48.6 Q50 47.4 52.4 48.6 M34.4 47.4 L30.6 46.8 M65.6 47.4 L69.4 46.8" stroke="#1f1a1a" stroke-width="1.2" fill="none" stroke-linecap="round"/>' +
    '<path d="M49.4 53.6 q2.5 3.4 -.8 4.4" stroke="#b07a58" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
    '<ellipse cx="35" cy="59" rx="4" ry="2.4" fill="#ff9d8a" opacity=".5"/><ellipse cx="65" cy="59" rx="4" ry="2.4" fill="#ff9d8a" opacity=".5"/>' +
    // the big toothy grin: dark inside, the top teeth, the tongue and a few bottom teeth
    `<path d="${mouth}" fill="#8c3b36"/>` +
    `<g clip-path="url(#${id}m)"><path d="M36 58 H64 V64.4 Q50 67.2 36 64.4z" fill="#fffdf6"/>` +
    '<path d="M44.6 63.2 v2.6 M50 63.8 v2.8 M55.4 63.2 v2.6" stroke="#d9cfbf" stroke-width=".8"/>' +
    '<ellipse cx="50" cy="68.4" rx="5.6" ry="2.4" fill="#e8747a"/><path d="M36 74 V69.2 Q50 67.4 64 69.2 V74z" fill="#fffdf6"/></g>' +
    `<path d="${mouth}" fill="none" stroke="#6a2a26" stroke-width="1.3" stroke-linejoin="round"/>` +
    // the moustache, and the chin beard along the jaw
    `<path d="M36.6 61.4 C39.6 57 45 56.4 50 58.4 C55 56.4 60.4 57 63.4 61.4 C59.4 59.4 55 59.6 50 60.8 C45 59.6 40.6 59.4 36.6 61.4z" fill="${hair}" stroke="${hairEdge}" stroke-width=".8" stroke-linejoin="round"/>` +
    `<path d="M${outer.join(' L')} L${inner.join(' L')}z" fill="${hair}" stroke="${hairEdge}" stroke-width=".8" stroke-linejoin="round"/>` +
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
