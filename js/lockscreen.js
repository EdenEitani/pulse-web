// Keeps the screen awake during a workout (Screen Wake Lock).
// Deliberately plays NO background media (no silent <audio>, no Media Session): on Android that makes Chrome take audio focus,
// which stops or heavily ducks the user's music for the whole workout. Beeps are short Web Audio tones, so music only dips for the beep.

export class LockSupport {
  constructor() { this.wake = null; this.engine = null; this.onVisible = () => { if (document.visibilityState === 'visible' && this.engine) this.#acquire(); }; }

  async start(engine) {
    this.engine = engine;
    await this.#acquire();
    document.addEventListener('visibilitychange', this.onVisible);
  }

  async #acquire() {
    try { if ('wakeLock' in navigator && (!this.wake || this.wake.released)) { this.wake = await navigator.wakeLock.request('screen'); } } catch { /* denied or unsupported */ }
  }

  update() { /* nothing to refresh: the wake lock needs no per-interval state */ }

  stop() {
    document.removeEventListener('visibilitychange', this.onVisible);
    this.engine = null;
    try { this.wake?.release(); } catch { /* ignore */ }
    this.wake = null;
  }
}
