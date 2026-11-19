// The user's reusable exercise names: starter list, import parsing, and a localStorage-backed store.
import { DEFAULTS } from './exercise-defaults.js';
import { storage } from './storage.js';

export const MAX_NAME = 90;
export { DEFAULTS };

export const clean = (name) => String(name ?? '').split(/\s+/).filter(Boolean).join(' ').slice(0, MAX_NAME).trim();
/** Case/diacritic-insensitive identity used to avoid duplicates. */
export const key = (name) => clean(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function stripMarker(s) {
  let t = s.trim();
  t = t.replace(/^\d{1,3}\s*[.)\-:]\s+/, '');                 // "1. " "2) " "3 - "
  while (t && '-•*–—·▪◦'.includes(t[0])) t = t.slice(1).trim(); // bullets
  return t;
}

/** Pasted text → names. Separators: commas (also ، ， ;) and new lines. Bullets/numbering stripped; dupes dropped. */
export function parse(text) {
  const seen = new Set(), out = [];
  for (const raw of String(text ?? '').split(/[,\n\r;،，]/)) {
    const name = clean(stripMarker(raw));
    if (name && !seen.has(key(name))) { seen.add(key(name)); out.push(name); }
  }
  return out;
}

const KEY = 'pulse.exercises.v1';

export class ExerciseStore {
  constructor(store = storage) {
    this.store = store;
    const saved = store.getJSON(KEY, null);
    this.list = Array.isArray(saved) ? saved.filter((x) => typeof x === 'string') : [...DEFAULTS];
  }
  get sorted() { return [...this.list].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })); }
  get isDefault() { return this.list.length === DEFAULTS.length && this.list.every((x, i) => x === DEFAULTS[i]); }
  has(name) { const k = key(name); return this.list.some((x) => key(x) === k); }
  add(name) { return this.addAll([name]) === 1; }
  /** Appends new names, ignoring duplicates. Returns how many were added. */
  addAll(names) {
    let n = 0;
    for (const raw of names) { const name = clean(raw); if (name && !this.has(name)) { this.list.push(name); n++; } }
    if (n) this.#save();
    return n;
  }
  replace(names) {
    const seen = new Set(); this.list = [];
    for (const raw of names) { const name = clean(raw); if (name && !seen.has(key(name))) { seen.add(key(name)); this.list.push(name); } }
    this.#save();
  }
  remove(name) { const k = key(name); this.list = this.list.filter((x) => key(x) !== k); this.#save(); }
  reset() { this.list = [...DEFAULTS]; this.store.remove(KEY); }
  #save() { this.store.setJSON(KEY, this.list); }
}
