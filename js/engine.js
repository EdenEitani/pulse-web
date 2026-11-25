// Workout engine: monotonic clock, UI-independent (port of the iPhone app's WorkoutEngine).
// Views only READ snapshot(), so correctness doesn't depend on frame rate, throttled timers or re-renders.
import { compile } from './model.js';
import { segments, workoutLanguage, completeText, halfwayText, primary } from './speech.js';

export class Engine {
  /**
   * @param {object} workout
   * @param {object} settings  { prepDuration, cueStyle:'voice'|'beeps', countdown, announceNext, haptics, voiceRate }
   * @param {object} io        { speaker, beeper, clock(): seconds, onEvent(name), autoTick }
   */
  constructor(workout, settings, io = {}) {
    this.workout = workout; this.settings = settings;
    this.speaker = io.speaker || null; this.beeper = io.beeper || null;
    this.clock = io.clock || (() => performance.now() / 1000);
    this.onEvent = io.onEvent || (() => {});
    this.autoTick = io.autoTick !== false;
    this.plan = compile(workout, settings.prepDuration);
    this.language = workoutLanguage(this.plan, io.device);
    let run = 0; this.offsets = this.plan.map((i) => { const o = run; run += i.duration; return o; });
    this.total = run;
    this.index = 0; this.paused = false; this.finished = false; this.result = null;
    this._sound = true; // every workout starts with sound ON; muting is per workout
    this.accumulated = 0; this.resumedAt = null; this.spoken = new Set(); this.started = false; this.timer = null;
  }

  get current() { return this.plan[Math.min(this.index, this.plan.length - 1)]; }
  get next() { return this.plan[this.index + 1] || null; }
  get isHebrew() { return primary(this.language) === 'he'; }
  get prepareDuration() { return this.plan[0] && this.plan[0].kind === 'prepare' ? this.plan[0].duration : 0; }
  get sound() { return this._sound; }
  set sound(on) {
    if (on === this._sound) return;
    this._sound = on;
    if (!on) { this.speaker?.stop(); this.beeper?.stop(); }
    this.onEvent('sound');
  }

  #elapsed(t) { return this.accumulated + (this.resumedAt == null ? 0 : Math.max(0, t - this.resumedAt)); }

  snapshot() {
    const d = this.current.duration;
    const el = this.finished ? d : Math.min(Math.max(this.#elapsed(this.clock()), 0), d);
    return { elapsed: el, remaining: d - el, progress: d > 0 ? el / d : 1, position: this.offsets[Math.min(this.index, this.offsets.length - 1)] + el };
  }

  start() {
    if (this.started || !this.plan.length) return;
    this.started = true;
    this.speaker?.activate(); this.beeper?.activate();
    this.resumedAt = this.clock();
    this.#announce();
    if (this.autoTick) this.timer = setInterval(() => this.tick(), 50);
    this.onEvent('started');
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.speaker?.stop(); this.beeper?.stop(); }

  /** Advances through every interval that has fully elapsed and announces only the one we land on — once. */
  tick() {
    if (!this.started || this.paused || this.finished) return;
    const t = this.clock();
    let landed = false;
    for (;;) {
      const el = this.#elapsed(t), d = this.current.duration;
      if (el < d) break;
      if (this.index + 1 >= this.plan.length) { this.#finish(true, t); return; }
      this.index += 1; this.accumulated = el - d; this.resumedAt = t; landed = true;
    }
    if (landed) { this.spoken.clear(); this.#announce(); this.#haptic([40]); this.onEvent('intervalChanged'); }
    const el = this.#elapsed(t);
    this.#halfway(el);
    this.#countdown(el);
  }

  /** One "halfway there" cue per interval (not the get-ready phase, and only when the interval is long enough not to crowd the 3·2·1). */
  #halfway(el) {
    if (!this.settings.halfway) return;
    const c = this.current, d = c.duration;
    if (c.kind === 'prepare' || d < 10 || this.spoken.has('half') || el < d / 2) return;
    this.spoken.add('half');
    if (d - el < 3) return; // we resumed or jumped past the middle: don't announce late
    if (this.settings.cueStyle === 'voice') this.#say(halfwayText(this.isHebrew)); else this.#beep('halfway');
  }

  #countdown(el) {
    if (!this.settings.countdown) return;
    const d = this.current.duration;
    if (d <= 3) return;
    const n = Math.ceil(d - el - 1e-9);
    if (n >= 1 && n <= 3 && !this.spoken.has(n)) {
      this.spoken.add(n);
      if (this.settings.cueStyle === 'voice') this.#say(String(n)); else this.#beep('countdown');
    }
  }

  togglePause() {
    if (!this.started || this.finished) return;
    const t = this.clock();
    if (this.paused) { this.resumedAt = t; this.paused = false; }
    else { this.accumulated = this.#elapsed(t); this.resumedAt = null; this.paused = true; this.speaker?.stop(); this.beeper?.stop(); }
    this.#haptic([20]);
    this.onEvent(this.paused ? 'paused' : 'resumed');
  }
  pauseIfRunning() { if (this.started && !this.paused && !this.finished) this.togglePause(); }

  skipForward() {
    if (!this.started || this.finished) return;
    if (this.index + 1 >= this.plan.length) this.#finish(true, this.clock()); else this.#jump(this.index + 1);
  }
  /** Restarts the current interval when it is underway; otherwise goes back one. */
  skipBack() {
    if (!this.started || this.finished) return;
    this.#jump(this.#elapsed(this.clock()) > 2 || this.index === 0 ? this.index : this.index - 1);
  }
  finishEarly() { if (this.started && !this.finished) this.#finish(false, this.clock()); }

  #jump(i) {
    this.index = i; this.accumulated = 0; this.resumedAt = this.paused ? null : this.clock();
    this.spoken.clear(); this.#announce(); this.#haptic([20]); this.onEvent('intervalChanged');
  }

  #finish(natural, t) {
    const position = natural ? this.total : this.offsets[this.index] + this.#elapsed(t);
    if (this.timer) clearInterval(this.timer); this.timer = null;
    this.result = { time: Math.max(0, position - this.prepareDuration), completedFully: natural };
    this.finished = true; this.paused = false; this.resumedAt = null;
    if (this.settings.cueStyle === 'voice') this.#say(completeText(this.isHebrew)); else this.#beep('complete');
    this.#haptic([80, 60, 80]);
    this.onEvent('finished');
  }

  // Voice style speaks numbers and exercise names; beeps style plays the classic HIIT tones and never speaks.
  #announce() {
    if (this.settings.cueStyle === 'voice') {
      if (!this._sound) return;
      this.speaker?.speak(segments(this.plan, this.index, this.language, this.settings.announceNext), this.settings.voiceRate || 1);
    } else {
      const k = this.current.kind;
      if (k === 'work' || k === 'forTime') this.#beep('go'); else if (k === 'rest' || k === 'setRest') this.#beep('rest');
    }
  }
  #say(text) { if (this._sound) this.speaker?.speak([{ text, lang: this.language }], this.settings.voiceRate || 1); }
  #beep(kind) { if (this._sound) this.beeper?.play(kind); }
  #haptic(p) { if (this.settings.haptics && globalThis.navigator && navigator.vibrate) { try { navigator.vibrate(p); } catch { /* unsupported */ } } }
}
