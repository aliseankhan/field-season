// Writes check/james_script.html: every line James says, laid out for reading.
//
//   node tools/james_script.mjs
//
// It reads src/story/script.js as the game does, so re-run it after editing lines.
// Words in {braces} are filled in by the game (the player's name and so on).

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const { SCRIPT, JAMES } = await import(pathToFileURL(path.join(root, 'src/story/script.js')).href);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fill = (s) => esc(s).replace(/\{(\w+)\}/g, '<span class="slot">$1</span>');
const title = (k) => k.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

let lines = 0;
function render(value, key, depth) {
  if (value == null) return '';
  if (typeof value === 'string') {
    lines++;
    return `<div class="line"><span class="key">${esc(title(key))}</span><p>${fill(value)}</p></div>`;
  }
  if (Array.isArray(value)) {
    const pool = value.some((v) => Array.isArray(v));
    const items = value.map((v) => (Array.isArray(v) ? v[0] : v)).filter((v) => typeof v === 'string');
    lines += items.length;
    const body = items.map((v) => `<li>${fill(v)}</li>`).join('');
    const note = pool ? '<span class="note">one of these, picked at random</span>' : '<span class="note">said in order</span>';
    return `<div class="line"><span class="key">${esc(title(key))}</span>${note}${pool ? `<ul class="pool">${body}</ul>` : `<ol>${body}</ol>`}</div>`;
  }
  if (typeof value === 'object') {
    const h = Math.min(4, depth + 2);
    const inner = Object.entries(value).map(([k, v]) => render(v, k, depth + 1)).join('');
    return `<section class="d${depth}"><h${h}>${esc(title(key))}</h${h}>${inner}</section>`;
  }
  return '';
}

const body = Object.entries(SCRIPT).map(([k, v]) => render(v, k, 0)).join('');
const html = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>James's Lines</title>
<style>
  :root { --bg: #fbf6ea; --card: #fffdf7; --ink: #2f3a2c; --muted: #7a806f; --leaf: #4f9a4a; --line: #e6dcc4; --slot: #fde7b0; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #1d211b; --card: #262b23; --ink: #e9ecdf; --muted: #a3a996; --leaf: #8fcf86; --line: #3a4135; --slot: #5b4a1d; } }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 28px 16px 60px; }
  header h1 { margin: 0; font-size: 26px; }
  header p { margin: 4px 0 18px; color: var(--muted); }
  section { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px 16px; margin: 14px 0; }
  section section { border: none; border-left: 3px solid var(--leaf); border-radius: 0; padding: 4px 0 4px 12px; margin: 10px 0; background: transparent; }
  h2 { margin: 2px 0 8px; font-size: 20px; color: var(--leaf); }
  h3, h4 { margin: 6px 0; font-size: 16px; }
  .line { margin: 10px 0; }
  .key { display: inline-block; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin-right: 8px; }
  .note { font-size: 12px; color: var(--muted); font-style: italic; }
  .line p { margin: 2px 0 0; }
  ol, ul { margin: 4px 0 0; padding-left: 22px; }
  li { margin: 3px 0; }
  ul.pool { list-style: "~  "; }
  .slot { background: var(--slot); border-radius: 5px; padding: 0 5px; font-size: 14px; }
</style>
</head>
<body>
<main>
<header>
  <h1>${esc(JAMES.name)}'s lines</h1>
  <p>${esc(JAMES.role)}, Stroud Lab: Field Season. ${lines} lines from src/story/script.js. Highlighted words are filled in by the game.</p>
</header>
${body}
</main>
</body>
</html>
`;
const out = path.join(root, 'check', 'james_script.html');
writeFileSync(out, html);
console.log(`wrote ${out} (${lines} lines)`);
