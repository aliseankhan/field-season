// Tiny event bus: on(name, fn) returns an unsubscribe function.

export function createEvents() {
  const map = new Map();
  return {
    on(name, fn) {
      if (!map.has(name)) map.set(name, new Set());
      map.get(name).add(fn);
      return () => map.get(name)?.delete(fn);
    },
    once(name, fn) {
      const off = this.on(name, (...a) => { off(); fn(...a); });
      return off;
    },
    off(name, fn) {
      map.get(name)?.delete(fn);
    },
    emit(name, ...args) {
      const set = map.get(name);
      if (!set) return;
      for (const fn of [...set]) {
        try { fn(...args); } catch (e) { console.error(e); }
      }
    },
  };
}

export const events = createEvents();
