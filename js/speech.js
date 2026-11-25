// Spoken announcements: per-exercise language detection, phrase building, and the speechSynthesis wrapper.

const RANGES = [
  ['he-IL', [[0x0590, 0x05ff], [0xfb1d, 0xfb4f]]], ['ar-SA', [[0x0600, 0x06ff], [0x0750, 0x077f], [0xfb50, 0xfdff], [0xfe70, 0xfeff]]],
  ['ru-RU', [[0x0400, 0x04ff]]], ['el-GR', [[0x0370, 0x03ff]]], ['ja-JP', [[0x3040, 0x30ff]]], ['zh-CN', [[0x4e00, 0x9fff]]],
  ['ko-KR', [[0xac00, 0xd7af], [0x1100, 0x11ff]]], ['th-TH', [[0x0e00, 0x0e7f]]], ['hi-IN', [[0x0900, 0x097f]]],
];
const NON_LATIN = new Set(['he', 'ar', 'ru', 'el', 'th', 'ko', 'ja', 'zh', 'hi']);

export const primary = (lang) => String(lang || 'en').split('-')[0].toLowerCase();

/** Dominant non-Latin script of the text as a voice language, or null for Latin text. Any kana means Japanese. */
export function scriptLang(text) {
  const counts = {};
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    for (const [lang, rs] of RANGES) if (rs.some(([a, b]) => cp >= a && cp <= b)) { counts[lang] = (counts[lang] || 0) + 1; break; }
  }
  if (counts['ja-JP']) return 'ja-JP';
  let best = null;
  for (const [lang, n] of Object.entries(counts)) if (!best || n > counts[best]) best = lang;
  return best;
}

/** Latin text is spoken in English (the browser has no language recogniser). */
export const detectLang = (text) => scriptLang(text) || 'en-US';

/** There is no language setting: phrases follow the first named exercise; with no names, the phone's language. */
export function workoutLanguage(plan, device = (globalThis.navigator && navigator.language) || 'en-US') {
  const named = plan.find((i) => i.exercise);
  const basis = named ? detectLang(named.exercise) : device;
  return primary(basis) === 'he' ? 'he-IL' : 'en-US';
}

/** Pieces of speech for the interval at `index`; each exercise name carries its own language. */
export function segments(plan, index, language, announceNext = true) {
  const i = plan[index];
  if (!i) return [];
  const he = primary(language) === 'he';
  const phrase = (text) => ({ text, lang: language });
  const name = (text) => ({ text, lang: detectLang(text) });
  const upcoming = () => {
    const u = plan.slice(index + 1).find((x) => (x.kind === 'work' || x.kind === 'forTime') && x.exercise);
    return u ? u.exercise : null;
  };
  switch (i.kind) {
    case 'prepare': {
      const out = [phrase(he ? 'להתכונן' : 'Get ready')];
      const first = announceNext ? upcoming() : null;
      if (first) out.push(phrase(he ? '. התרגיל הראשון: ' : '. First exercise: '), name(first));
      return out;
    }
    case 'rest': case 'setRest': {
      const out = [phrase(he ? 'מנוחה' : 'Rest')];
      const next = announceNext ? upcoming() : null;
      if (next) out.push(phrase(he ? '. התרגיל הבא: ' : '. Next exercise: '), name(next));
      return out;
    }
    case 'work': return i.exercise ? [name(i.exercise)] : [phrase(he ? 'עבודה' : 'Work')];
    default: return i.exercise ? [name(i.exercise)] : [phrase(he ? 'יאללה' : 'Go')];
  }
}
export const textOf = (segs) => segs.map((s) => s.text).join('');
export const halfwayText = (he) => (he ? 'חצי הדרך' : 'Halfway there');
export const wellDoneText = (he) => (he ? 'כל הכבוד!' : 'Well done!');
export const completeText = (he) => (he ? 'האימון הסתיים' : 'Workout complete');

/** speechSynthesis wrapper. Utterances queue in order; each picks the best installed voice for its language. */
export class Speaker {
  constructor(synth = globalThis.speechSynthesis) { this.synth = synth; this.voices = []; this.#load(); }
  get supported() { return !!this.synth; }
  #load() {
    if (!this.synth) return;
    const read = () => { this.voices = this.synth.getVoices ? this.synth.getVoices() : []; };
    read();
    if (this.synth.addEventListener) this.synth.addEventListener('voiceschanged', read);
  }
  voiceFor(lang) {
    const code = primary(lang);
    const matches = this.voices.filter((v) => primary(v.lang) === code);
    return matches.find((v) => v.lang.replace('_', '-').toLowerCase() === lang.toLowerCase()) || matches.find((v) => v.localService) || matches[0] || null;
  }
  activate() { /* speechSynthesis needs no activation beyond the user's Start tap */ }
  speak(segs, rate = 1) {
    if (!this.synth) return;
    const parts = segs.filter((s) => s.text);
    if (!parts.length) return;
    this.synth.cancel();
    for (const p of parts) {
      const u = new SpeechSynthesisUtterance(p.text);
      u.lang = p.lang;
      const v = this.voiceFor(p.lang);
      if (v) u.voice = v;
      u.rate = Math.min(2, Math.max(0.5, rate));
      this.synth.speak(u);
    }
  }
  stop() { if (this.synth) this.synth.cancel(); }
}
