// Keeps the screen awake during a workout and, where Chrome allows, shows lock-screen media controls.
// (No Live Activity on the web: the media notification is the closest equivalent and is best-effort.)

function silentWav() {
  const sr = 8000, n = sr, bytes = new Uint8Array(44 + n * 2), dv = new DataView(bytes.buffer);
  const str = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, n * 2, true);
  return new Blob([bytes], { type: 'audio/wav' });
}

export class LockSupport {
  constructor() { this.wake = null; this.audio = null; this.engine = null; this.onVisible = () => { if (document.visibilityState === 'visible' && this.engine) this.#acquire(); }; }

  async start(engine) {
    this.engine = engine;
    await this.#acquire();
    document.addEventListener('visibilitychange', this.onVisible);
    this.#audio(true);
    this.#handlers();
    this.update();
  }

  async #acquire() {
    try { if ('wakeLock' in navigator && (!this.wake || this.wake.released)) { this.wake = await navigator.wakeLock.request('screen'); } } catch { /* denied or unsupported */ }
  }

  /** Inaudible looping audio keeps the media session (and the page) alive while the screen is off — only while sound is on. */
  #audio(on) {
    if (!on) { if (this.audio) { this.audio.pause(); this.audio.removeAttribute('src'); this.audio = null; } return; }
    try {
      this.audio = this.audio || Object.assign(new Audio(URL.createObjectURL(silentWav())), { loop: true, volume: 0.01 });
      const p = this.audio.play(); if (p && p.catch) p.catch(() => {});
    } catch { /* autoplay blocked */ }
  }

  update() {
    const e = this.engine; if (!e) return;
    this.#audio(e.sound && !e.finished);
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    const i = e.current, label = { prepare: 'Get ready', work: 'Work', rest: 'Rest', setRest: 'Set rest', forTime: 'For time' }[i.kind];
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: i.exercise ? `${label} · ${i.exercise}` : label,
        artist: `Pulse · ${e.workout.mode}${i.rounds > 1 ? ` · Round ${i.round}/${i.rounds}` : ''}`,
        album: e.workout.name,
        artwork: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
      });
      navigator.mediaSession.playbackState = e.paused ? 'paused' : 'playing';
    } catch { /* ignore */ }
  }

  #handlers() {
    if (!('mediaSession' in navigator)) return;
    const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch { /* unsupported action */ } };
    set('play', () => this.engine?.paused && this.engine.togglePause());
    set('pause', () => this.engine && !this.engine.paused && this.engine.togglePause());
    set('nexttrack', () => this.engine?.skipForward());
    set('previoustrack', () => this.engine?.skipBack());
  }

  stop() {
    document.removeEventListener('visibilitychange', this.onVisible);
    this.engine = null; this.#audio(false);
    try { this.wake?.release(); } catch { /* ignore */ }
    this.wake = null;
    if ('mediaSession' in navigator) { try { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; } catch { /* ignore */ } }
  }
}
