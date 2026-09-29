// Small inline SVG icons for the UI, drawn in a 24 x 24 box with round strokes in
// currentColor. icon(name) returns markup; an unknown name is shown as plain text,
// so a toast can also take a short word or symbol.

const P = {
  loop_pole: '<path d="M4 21 15.5 8.5"/><circle cx="18" cy="6" r="3.2" stroke="#ff6f61"/><path d="M15.6 8.4 17 7.2" stroke="#ff6f61"/>',
  hand: '<path d="M8 20.5c-1.8-1.3-3.4-3.6-4-5.6-.4-1.2.9-2 1.8-1.2L8 15.5V6a1.4 1.4 0 0 1 2.8 0v6-8a1.4 1.4 0 0 1 2.8 0v8-6.5a1.4 1.4 0 0 1 2.8 0V13v-4a1.4 1.4 0 0 1 2.8 0v6.5c0 3.3-2.4 5.5-5.4 5.5z"/>',
  flag: '<path d="M6 21.5V3"/><path d="M6.4 3.8h11.1l-2.8 4 2.8 4H6.4z" fill="#ff9ec4" stroke="currentColor"/>',
  logger: '<path d="M10 4.2a2 2 0 0 1 4 0v9.6a4.1 4.1 0 1 1-4 0z"/><circle cx="12" cy="17.3" r="1.9" fill="#ff6f61" stroke="none"/><path d="M12 15.5V9" stroke="#ff6f61"/>',
  backpack: '<rect x="5.5" y="7" width="13" height="14" rx="4"/><path d="M9 7V5.5a3 3 0 0 1 6 0V7"/><path d="M5.5 12.5h13"/><rect x="9.5" y="14.5" width="5" height="3.5" rx="1"/>',
  tape: '<circle cx="10" cy="12" r="7"/><circle cx="10" cy="12" r="2.2"/><path d="M17 15.5h5v3h-5"/><path d="M19 15.5v1.3M21 15.5v1.3"/>',
  book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v16H6.5A1.5 1.5 0 0 0 5 20.5z"/><path d="M5 20.5A1.5 1.5 0 0 0 6.5 22H19v-3"/><path d="M9 7.5h6M9 11h4"/>',
  map: '<path d="M3.5 6.2 9 4l6 2.5 5.5-2.2v13.5L15 20l-6-2.5-5.5 2.2z"/><path d="M9 4v13.5M15 6.5V20"/>',
  pause: '<rect x="6.5" y="5" width="3.6" height="14" rx="1.4"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.4"/>',
  star: '<path d="m12 3.2 2.6 5.5 6 .7-4.4 4.1 1.2 5.9L12 16.5l-5.4 2.9 1.2-5.9-4.4-4.1 6-.7z" fill="currentColor"/>',
  leaf: '<path d="M5 19C4 11 9 5 19.5 4.5 20 14 14 19.5 5 19z" fill="currentColor" fill-opacity=".25"/><path d="M5 19c3-4 6.5-7.5 11-10"/>',
  lizard: '<path d="M12 2.8c1.3 0 2.1 1.2 2 2.6l-.4 2.2c.8 1.6.9 3.6.4 5.6-.5 2-.6 3.6.6 5 1 1.2 2.8 1.5 4.2.8" /><path d="M12 2.8c-1.3 0-2.1 1.2-2 2.6l.4 2.2c-.8 1.6-.9 3.6-.4 5.6.3 1.3.9 2.3 2 2.6"/><path d="M10.2 8.6 7 7.2l-.8-1.6M13.8 8.6 17 7.2l.8-1.6M10.4 13.2 7.2 15l-.4 1.8M13.6 13.2l3.2 1.6.6 1.8"/>',
  croc: '<path d="M2.5 13.5c2-2.2 4.5-3.2 8-3.2h7.5c2 0 3.5 1 3.5 2.3s-1.5 2.1-3.5 2.1H10c-3.5 0-5.5.2-7.5-1.2z"/><path d="M11 14.7l.8 1.3.8-1.3.8 1.3.8-1.3.8 1.3.8-1.3"/><circle cx="9.3" cy="8.8" r="1.6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.2 2"/>',
  sun: '<circle cx="12" cy="12" r="4" fill="currentColor" fill-opacity=".3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  bag: '<path d="M6 7h12l-1 13a1.6 1.6 0 0 1-1.6 1.5H8.6A1.6 1.6 0 0 1 7 20z" fill="#d6f0ff" fill-opacity=".6"/><path d="M9 7c0-2 1.3-3.5 3-3.5S15 5 15 7"/>',
  ruler: '<rect x="2.5" y="8" width="19" height="8" rx="1.5"/><path d="M6 8v3M9.5 8v4.5M13 8v3M16.5 8v4.5"/>',
  paint: '<path d="m14.5 4.5 5 5-9.5 9.5H5v-5z"/><path d="m12.5 6.5 5 5"/><circle cx="6.5" cy="17.5" r="1.4" fill="#ff6f61" stroke="none"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  station: '<path d="M3.5 11.5 12 5l8.5 6.5"/><path d="M5.5 10v9.5h13V10"/><rect x="10" y="14" width="4" height="5.5"/>',
  cap: '<path d="M4 15a8 7 0 0 1 16 0z" fill="currentColor" fill-opacity=".3"/><path d="M4 15h16M20 15l2.5 1.2"/>',
  thermometer: '<path d="M10 4.2a2 2 0 0 1 4 0v9.6a4.1 4.1 0 1 1-4 0z"/><circle cx="12" cy="17.3" r="1.9" fill="currentColor" stroke="none"/>',
  gift: '<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M3 9h18M12 9v11"/><path d="M12 9c-2-4-6-4-6-1.5S9 9 12 9zm0 0c2-4 6-4 6-1.5S15 9 12 9z"/>',
  warn: '<path d="M12 3.5 21.5 20h-19z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.2" r=".6" fill="currentColor"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.2 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" fill="currentColor" fill-opacity=".25"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 5.5H4.5c0 3 1.5 4.5 3.8 4.8M16 5.5h3.5c0 3-1.5 4.5-3.8 4.8M12 13v4M8.5 20.5h7M9.5 17h5v3.5h-5z"/>',
  home: '<path d="M3.5 11.5 12 5l8.5 6.5"/><path d="M5.5 10v9.5h13V10"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.5"/><circle cx="12" cy="16.6" r=".5" fill="currentColor"/>',
  close: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8"/><circle cx="12" cy="12" r="6.2"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" fill-opacity=".25"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" fill-opacity=".25"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4.2h4.2"/>',
  // the field kit: the drone's controller in the ring shows the drone, the
  // laser scanner on its tripod, the RTK rover's pole with its antenna and phone, and the
  // kit box for the notebook's Field kit tab
  drone: '<path d="M2.8 6.8h6.4M14.8 6.8h6.4" stroke="#3fb8c4"/><path d="M6 6.8v3.4M18 6.8v3.4M5 10.5h14"/><rect x="8.3" y="9" width="7.4" height="5.4" rx="2.2" fill="currentColor" fill-opacity=".2"/><path d="M9.4 14.4 8 18.6M14.6 14.4l1.4 4.2M6.6 18.6h3M14.4 18.6h3"/><circle cx="12" cy="16.4" r="1.5" fill="#ff6f61" stroke="none"/>',
  tls: '<rect x="8.2" y="2.6" width="7.6" height="9" rx="2.6" fill="currentColor" fill-opacity=".2"/><rect x="10.4" y="4.6" width="3.2" height="4.4" rx="1.1" fill="#3fb8c4" stroke="none"/><path d="M12 11.6v2.2M12 13.8l-5.4 7.6M12 13.8l5.4 7.6M12 13.8v7.6"/>',
  rtk: '<path d="M11 8.2v13.4"/><path d="M6.6 5.8a4.4 2 0 0 1 8.8 0v.9a4.4 1.6 0 0 1-8.8 0z" fill="currentColor" fill-opacity=".2"/><rect x="13.4" y="10.6" width="4.6" height="7" rx="1.2" fill="#8fe0bf" fill-opacity=".7"/><path d="M11 13.4h2.4"/><circle cx="11" cy="3.2" r=".7" fill="#ff6f61" stroke="none"/>',
  kit: '<rect x="3" y="8.6" width="18" height="11.4" rx="2.2" fill="currentColor" fill-opacity=".15"/><path d="M9 8.6V6.6A1.6 1.6 0 0 1 10.6 5h2.8A1.6 1.6 0 0 1 15 6.6v2"/><path d="M3 13.4h18"/><rect x="10.4" y="11.8" width="3.2" height="3.2" rx=".8" fill="currentColor"/>',
  plant: '<path d="M12 21v-8.5"/><path d="M12 13.5C8 13.5 5.5 11 5.5 6.5 9.5 6.5 12 9 12 13.5z" fill="currentColor" fill-opacity=".25"/><path d="M12 11c0-4 2.5-6.5 6.5-6.5 0 4-2.5 6.5-6.5 6.5z" fill="currentColor" fill-opacity=".25"/><path d="M8 21h8"/>',
};

// other names the game uses for the same pictures
const ALIAS = {
  flags: 'flag', loggers: 'logger', backpacks: 'backpack', hands: 'hand', none: 'hand', empty: 'hand',
  notebook: 'book', temperature: 'thermometer', gps: 'backpack', james: 'cap', crocodile: 'croc', score: 'leaf',
  scanner: 'tls', lidar: 'tls', rover: 'rtk', gnss: 'rtk', controller: 'drone', toolbox: 'kit', fieldkit: 'kit', plants: 'plant',
};

export function icon(name, cls = '') {
  const body = P[name] || P[ALIAS[name]];
  if (!body) return `<span class="ui-icon ${cls}" aria-hidden="true">${escapeHtml(String(name || ''))}</span>`;
  return `<svg class="ui-icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

// The inner markup of an icon (for drawing it inside another SVG), or '' when unknown.
export function iconBody(name) {
  return P[name] || P[ALIAS[name]] || '';
}

export function hasIcon(name) {
  return Object.prototype.hasOwnProperty.call(P, name) || Object.prototype.hasOwnProperty.call(ALIAS, name);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Plain text with [Key] marks turned into key caps and *word* into bold, for hints
// and instructions: "Hold [F] to aim, then [E] to catch".
export function richText(text) {
  return escapeHtml(text)
    .replace(/\[([^\]]{1,14})\]/g, '<kbd>$1</kbd>')
    .replace(/\*([^*]+)\*/g, '<b>$1</b>');
}
