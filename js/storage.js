// Everything is stored on the device (localStorage). No network, no account. Falls back to memory if storage is blocked.

class Storage {
  constructor(backend) { this.backend = backend; this.mem = new Map(); }
  #get(k) { try { const v = this.backend?.getItem(k); if (v != null) return v; } catch { /* blocked */ } return this.mem.has(k) ? this.mem.get(k) : null; }
  getJSON(k, fallback) { try { const v = this.#get(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } }
  setJSON(k, v) { const s = JSON.stringify(v); this.mem.set(k, s); try { this.backend?.setItem(k, s); } catch { /* blocked */ } }
  remove(k) { this.mem.delete(k); try { this.backend?.removeItem(k); } catch { /* blocked */ } }
}

export const storage = new Storage((() => { try { return globalThis.localStorage; } catch { return null; } })());
export { Storage };

// v: 2 = beeps became the default cue sound. Settings saved before that (no `v`) stored the old default ("voice") without the
// user ever choosing it, so their cueStyle is dropped once and they get beeps; every later choice is kept.
export const DEFAULT_SETTINGS = { v: 2, cueStyle: 'beeps', countdown: true, announceNext: true, haptics: true, prepDuration: 5, voiceRate: 1 };

export function loadSettings() {
  const saved = storage.getJSON('pulse.settings.v1', {}) || {};
  if (saved.v !== 2) delete saved.cueStyle;
  return { ...DEFAULT_SETTINGS, ...saved, v: 2 };
}
export const saveSettings = (s) => storage.setJSON('pulse.settings.v1', s);

export const loadWorkouts = () => { const w = storage.getJSON('pulse.workouts.v1', []); return Array.isArray(w) ? w : []; };
export function saveWorkout(w) {
  const list = loadWorkouts(); const copy = { ...JSON.parse(JSON.stringify(w)), updatedAt: Date.now() };
  const i = list.findIndex((x) => x.id === w.id);
  if (i >= 0) list[i] = copy; else list.unshift(copy);
  storage.setJSON('pulse.workouts.v1', list);
}
export function deleteWorkout(id) { storage.setJSON('pulse.workouts.v1', loadWorkouts().filter((w) => w.id !== id)); }
