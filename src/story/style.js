// Loads story.css once: the tool ring, the story's fades and title cards, and the
// insides of the set-up and logger mini-games (the UI kit draws their cards).

let added = false;
export function ensureStoryStyle() {
  if (added || typeof document === 'undefined') return;
  added = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./story.css', import.meta.url).href;
  document.head.appendChild(link);
}

// A small helper for building DOM with a class and inner markup.
export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
