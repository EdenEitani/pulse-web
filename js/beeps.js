// Classic HIIT beeps synthesised with Web Audio (no audio files).
// countdown = short high beep (3·2·1) · go = longer, higher · rest = lower · complete = 3 rising notes.

export const TONES = {
  countdown: [[880, 0.14, 0]],
  go: [[1320, 0.70, 0]],
  rest: [[587, 0.45, 0]],
  complete: [[880, 0.14, 0], [1100, 0.14, 0.22], [1320, 0.70, 0.44]],
};

export class Beeper {
  constructor() { this.ctx = null; }
  /** Must be called from a user gesture (the Start tap) so the browser lets audio play. */
  activate() {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) this.ctx = new AC();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  #tone(freq, dur, at, gain = 0.5) {
    const c = this.ctx; if (!c) return;
    const t0 = c.currentTime + at;
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.006);               // fade in/out: no clicks
    g.gain.setValueAtTime(gain, t0 + Math.max(0.006, dur - 0.012));
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }
  play(kind) {
    this.activate();
    for (const [f, d, at] of TONES[kind] || []) this.#tone(f, d, at);
  }
  stop() { /* tones are short; nothing to cancel */ }
  /** Settings → "Play sample": 3 · 2 · 1 · GO · REST. */
  sample() {
    this.activate();
    [['countdown', 0], ['countdown', 0.8], ['countdown', 1.6], ['go', 2.4], ['rest', 3.6]].forEach(([k, at]) => setTimeout(() => this.play(k), at * 1000));
  }
}
