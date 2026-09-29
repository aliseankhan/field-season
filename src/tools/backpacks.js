// The GPS backpacks: tiny sensor packs in a little orange case. They are fitted
// during a catch (src/catch/release.js); the case in hand is the base station that
// downloads a tagged lizard's GPS fixes. Walk within RULES.reach.gps of a lizard
// wearing a pack and press [E]: a quick wake-and-catch mini-game (the loggers' read
// card), and its fixes go onto the map as its dotted trail. A pack is offered once it
// has MIN_FIXES waiting, so the hint does not nag after every new fix.

import { state, RULES, addScore } from '../game/state.js';
import { events } from '../core/events.js';
import * as kit from '../ui/kit.js';
import { registerTool } from './ring.js';
import { readMinigame } from './loggers.js';

const MIN_FIXES = 5;

export async function build(game) {
  const { player } = game;

  // the nearest tracked lizard with fixes waiting, within reach
  function nearestWaiting() {
    let best = null, bd = RULES.reach.gps;
    for (const e of state.tracked) {
      const lz = e.lizard;
      if (!lz || !Array.isArray(e.fixes) || e.fixes.length < MIN_FIXES) continue;
      const p = lz.pos || lz.home;
      if (!p) continue;
      const d = Math.hypot(p.x - player.position.x, p.z - player.position.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best ? { entry: best, dist: bd } : null;
  }

  let busy = false;
  async function downloadFrom(entry) {
    if (busy || !entry) return;
    const C = game.catching;
    if (!C || !C.download) return;
    busy = true;
    const name = entry.nickname || entry.id;
    const res = await kit.minigame(readMinigame({
      name: 'gps', label: entry.id, text: entry.fixes.length, unit: 'fixes', icon: 'backpack',
      title: `Download ${name}'s GPS`,
      instructions: 'Press [E] to wake the backpack, then press again while its fix count shows!',
    }));
    busy = false;
    if (!res || !res.success) return;
    const n = C.download(entry);
    if (!n) return;
    addScore(RULES.points.gpsDownload, 'gps');
    events.emit('gps:download', { id: entry.id, n, species: entry.species });
    kit.toast(`${n} GPS fix${n === 1 ? '' : 'es'} from *${name}*. Its trail is on your map [M]`, { icon: 'backpack', tone: 'good' });
  }

  const offer = { score: 0, prompt: '', why: '', run: null, entry: null };
  const run = () => downloadFrom(offer.entry);
  const count = { score: 0.1, prompt: '', run: null };
  registerTool({
    id: 'backpacks', name: 'GPS backpacks', phrase: 'GPS case', icon: 'backpack', key: 4, pose: 'hold', order: 4,
    suggestFor(ctx) {
      if (state.phase === 'survey') {
        const near = nearestWaiting();
        if (near) {
          const name = near.entry.nickname || near.entry.id;
          offer.score = 1.2 - near.dist * 0.1; // above the loop pole's creep hint, below a logger or a flag
          offer.entry = near.entry;
          offer.prompt = `[E] Download *${name}*'s GPS (${near.entry.fixes.length} fixes)`;
          offer.why = `to download ${name}'s GPS`;
          offer.run = run;
          return offer;
        }
      }
      if (ctx.tool !== 'backpacks') return null;
      const n = state.inventory.backpacks;
      count.prompt = state.tracked.length
        ? `Walk near a tagged lizard to download its GPS. ${n} pack${n === 1 ? '' : 's'} left today`
        : n > 0 ? `${n} backpack${n === 1 ? '' : 's'} left: fit one after catching a big adult` : 'No backpacks left today';
      return count;
    },
  });
  kit.registerMinigame('gps', () => readMinigame({ name: 'gps', label: 'GPS 01', text: 12, unit: 'fixes', icon: 'backpack', title: 'Download Pip\'s GPS' }));
  return { update() {} };
}
