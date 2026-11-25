# Pulse — Workout Interval Timer (web app)

Installable web app (PWA) version of the Pulse iPhone app, for Android phones and any modern browser.
Plain HTML/CSS/JavaScript — no frameworks, no build step, no server, no account, no cost.

## Install on an Android phone
1. Open the app's link in **Chrome**.
2. Menu **⋮ → Install app** (or **Add to Home screen**). Pulse then opens full-screen like a normal app and works offline.
3. (Optional) Settings → **Install as an app** shows an Install button when Chrome offers it.

On iPhone: Safari → Share → **Add to Home Screen**.

## What's in it
AMRAP · FOR TIME · EMOM · TABATA · MIX builder (reorder, duplicate, delete) · mode-specific timer faces ·
classic HIIT beeps (default) or voice announcements · 183 built-in exercises, import by comma/new line, one-tap Clear all with Undo ·
saved workouts · everything stored on the phone (localStorage).

- **Voice:** each exercise is spoken in the language it's written in; the connecting phrases follow the first exercise
  (Hebrew → Hebrew phrases, anything else → English). It uses the phone's text-to-speech voices — install a voice for any
  language you use (Android: Settings → System → Languages → Text-to-speech).
- **Beeps (the default):** 3 short beeps for 3·2·1, two rising notes (or "Halfway there" in voice mode) at the middle of each interval of 10 s or more (can be turned off in Settings), a longer higher beep on GO, a lower beep when rest starts, a celebration fanfare at the end (plus "Well done!" in voice mode).

## Differences from the iPhone app
| iPhone | Web |
|---|---|
| Runs with the screen locked | **Keeps the screen on** during a workout (Screen Wake Lock). Pulse plays no background media, so your own music keeps playing and only dips briefly under each beep. |
| Live Activity / Dynamic Island | Not available on the web |
| Local-notification fallback | Not reliable on the web — not included |
| Voices from iOS | Voices from the phone; quality/availability varies |

## Develop & test
```sh
npm test                      # unit + PWA static checks (Node's built-in runner, no dependencies)
python3 -m http.server 8080   # serve locally, then open http://localhost:8080/
```
Browser end-to-end test (real Chrome, Android phone profile, 41 checks) needs `playwright-core`:
```sh
npm i --no-save playwright-core
node tests/e2e.mjs                                  # serves the files itself under https://pulse.test/pulse-web/
URL=https://<user>.github.io/pulse-web/ node tests/e2e.mjs   # also checks installability + offline against a real HTTPS URL
```

## Deploy (GitHub Pages)
Push to `main`; Settings → Pages → Deploy from branch → `main` / root. All paths are relative, so it works under a sub-path.
When you change any file, bump `VERSION` in `sw.js` so installed copies refresh.

## Layout
`js/model.js` plan compiler · `js/engine.js` timing engine (monotonic clock, UI-independent) · `js/speech.js` language + TTS ·
`js/beeps.js` Web Audio tones · `js/exercises.js` list + import parsing · `js/storage.js` · `js/lockscreen.js` wake lock only (no media session, so music is not interrupted) ·
`js/app.js` + `js/ui.js` screens · `sw.js` offline cache · `manifest.webmanifest`.
