// The survey's stake lattice from data/stakes.json (preprocess/stakes.py): every
// stake in the game frame, whether the player can reach it, and the set-up day's
// flag and logger targets. Loaded once and shared (game.stakes).

import { CONFIG } from '../config.js';

let loading = null;

export function loadStakes(game) {
  if (game.stakes) return Promise.resolve(game.stakes);
  if (!loading) {
    loading = fetch(CONFIG.dataBase + 'stakes.json')
      .then((r) => {
        if (!r.ok) throw new Error('stakes.json: HTTP ' + r.status);
        return r.json();
      })
      .then((raw) => {
        const T = game.data.terrain;
        const list = raw.stakes.map((s) => ({
          ...s,
          y: T.heightAt(s.x, s.z), // the drawn ground, not the rounded file value
          stand: s.stand ? { x: s.stand[0], z: s.stand[1] } : null,
        }));
        const byId = new Map(list.map((s) => [s.id, s]));
        const flags = raw.targets.flags.map((id) => byId.get(id)).filter(Boolean);
        const loggers = raw.targets.loggers.map((id) => byId.get(id)).filter(Boolean);
        game.stakes = { list, byId, targets: { flags, loggers } };
        return game.stakes;
      });
  }
  return loading;
}
