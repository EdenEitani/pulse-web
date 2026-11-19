// End-to-end check in real Chrome with an Android phone profile.
//   npm i --no-save playwright-core   &&   python3 -m http.server 8080 &   &&   node tests/e2e.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';

// By default the project files are served from disk at https://pulse.test/pulse-web/ (the same sub-path GitHub Pages uses),
// so no local server is needed. Set URL=http://localhost:8080/ to test against a real server instead.
const URL_ = process.env.URL || 'https://pulse.test/pulse-web/';
const ROOT = new URL('..', import.meta.url).pathname;
const TYPES = { html: 'text/html', js: 'text/javascript', css: 'text/css', png: 'image/png', webmanifest: 'application/manifest+json', json: 'application/json' };
const fromDisk = async (route) => {
  const u = new URL(route.request().url());
  let p = decodeURIComponent(u.pathname).replace(/^\/pulse-web\/?/, '');
  if (!p || p.endsWith('/')) p += 'index.html';
  const file = ROOT + p;
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
  return route.fulfill({ status: 200, contentType: TYPES[p.split('.').pop()] || 'application/octet-stream', body: fs.readFileSync(file), headers: { 'cache-control': 'no-cache' } });
};
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = process.env.SHOTS || '';
setTimeout(() => { console.log('TIMEOUT: e2e took longer than 4 minutes'); process.exit(2); }, 240000).unref();
const results = [];
const ok = (name, cond, extra = '') => { results.push([cond, name, extra]); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra ? '  → ' + extra : ''}`); };

// Stubs: record what would be spoken / beeped / vibrated and what screen-wake was requested.
const STUBS = `
  window.__spoken = []; window.__beeps = []; window.__vibr = []; window.__wake = 0;
  window.__ann = []; window.__cur = null; // one group per announcement: speak() queues segments, cancel() starts a new announcement
  const synth = { speak(u){ if (!window.__cur) { window.__cur = []; window.__ann.push(window.__cur); } window.__cur.push({ text:u.text, lang:u.lang }); window.__spoken.push({ text:u.text, lang:u.lang }); }, cancel(){ window.__cur = null; }, getVoices(){ return []; }, addEventListener(){} };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  class Osc { constructor(){ this.frequency = { value: 0 }; } connect(n){ return n; } start(){ window.__beeps.push(Math.round(this.frequency.value)); } stop(){} }
  class Gain { constructor(){ this.gain = { setValueAtTime(){}, linearRampToValueAtTime(){} }; } connect(n){ return n; } }
  window.AudioContext = class { constructor(){ this.currentTime = 0; this.state = 'running'; this.destination = {}; } resume(){} createOscillator(){ return new Osc(); } createGain(){ return new Gain(); } };
  navigator.vibrate = (p) => { window.__vibr.push(p); return true; };
  Object.defineProperty(navigator, 'wakeLock', { value: { request: async () => { window.__wake++; return { released: false, release(){} }; } }, configurable: true });
  HTMLMediaElement.prototype.play = function(){ return Promise.resolve(); };
`;

const browser = await chromium.launch({ executablePath: CHROME, args: ['--autoplay-policy=no-user-gesture-required'] });
const mk = async (settings, { offline = false } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
  if (!process.env.URL) await ctx.route('https://pulse.test/**', fromDisk);
  await ctx.addInitScript(STUBS);
  if (settings) await ctx.addInitScript(`try{ if(!localStorage.getItem('pulse.settings.v1')) localStorage.setItem('pulse.settings.v1', ${JSON.stringify(JSON.stringify({ v: 2, cueStyle: 'voice', ...settings }))}); }catch{}`);
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL_); await page.waitForSelector('.pill');
  return { ctx, page, errors };
};
const shot = async (page, name) => { if (SHOTS) { await sleep(700); /* let screen/transition animations finish */ fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } };
const spoken = (page) => page.evaluate(() => window.__ann.map((g) => g.map((s) => s.text).join('')));
const lastSpoken = async (page) => (await spoken(page)).at(-1);
const realErrors = (errors) => errors.filter((e) => process.env.URL || !/fetching the script/.test(e)); // fake-origin mode can't register the SW
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────────── PWA installability + offline ─────────────
{
  const { ctx, page, errors } = await mk({ prepDuration: 0 });
  const REAL = !!process.env.URL; // service workers need a real HTTPS origin
  if (REAL) await page.evaluate(() => navigator.serviceWorker.ready);
  const man =await page.evaluate(async () => { const l = document.querySelector('link[rel=manifest]'); const r = await fetch(l.href); return r.json(); });
  ok('manifest: standalone, start_url, 192/512 + maskable icons', man.display === 'standalone' && !!man.start_url && man.icons.some((i) => i.sizes === '192x192') && man.icons.some((i) => i.sizes === '512x512') && man.icons.some((i) => i.purpose === 'maskable'));
  if (REAL) {
  const cdp = await ctx.newCDPSession(page); await cdp.send('Page.enable');
  const inst = await cdp.send('Page.getInstallabilityErrors');
  // The test browser is an incognito-style context, where Chrome never offers installs: that one reason is expected.
  const instErrors = inst.installabilityErrors.filter((e) => e.errorId !== 'in-incognito');
  ok('Chrome reports no installability errors', instErrors.length === 0, JSON.stringify(instErrors));
  const swState = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
  ok('service worker active', swState);
  await page.reload(); await page.waitForSelector('.pill'); await sleep(800);
  if (!process.env.URL) await ctx.unroute('https://pulse.test/**', fromDisk); // from here on only the service worker's cache can answer
  await ctx.setOffline(true); await page.reload(); await page.waitForSelector('.pill', { timeout: 8000 }).catch(() => {});
  ok('works fully offline after first load', (await page.locator('.pill').count()) === 5);
  await ctx.setOffline(false);
  } else console.log('SKIP  installability + offline checks (they need a real HTTPS origin: run with URL=https://…)');
  const real = errors.filter((e) => !(process.env.URL ? false : /fetching the script/.test(e))); // the fake-origin mode can't register the SW
  ok('no console/page errors on load', real.length === 0, real.join(' | '));
  await shot(page, '01-home'); await ctx.close();
}

// ───────────── Tabata flow: builder, exercise picker, steppers, voice, controls ─────────────
{
  const { ctx, page, errors } = await mk({ prepDuration: 5 });
  await page.click('[data-mode="TABATA"]'); await page.waitForSelector('#start');
  ok('builder opens for TABATA with no exercises', (await page.locator('.exrow').count()) === 0 && (await page.locator('#clear-exercises').count()) === 0);
  await shot(page, '02-builder');
  await page.click('button[aria-label="Increase Work (sec)"]');
  ok('work steps 20 → 25', (await page.locator('input[aria-label="Work (sec)"]').inputValue()) === '25');
  await page.click('button[aria-label="Increase Rounds"]');
  ok('rounds step by 1 (8 → 9)', (await page.locator('input[aria-label="Rounds"]').inputValue()) === '9');

  await page.click('#add-exercise'); await page.fill('#picker-search', 'plank');
  await page.click('button.item[aria-label="Plank"]'); await page.fill('#picker-search', ''); await page.fill('#picker-search', 'Brand new move');
  await page.click('#picker-use-typed'); await shot(page, '03-picker');
  ok('picker add button counts 2 selected', (await page.textContent('#picker-add')) === 'Add (2)');
  await page.click('#picker-add');
  ok('picked + typed exercises added to the block', (await page.locator('.exrow input').evaluateAll((els) => els.map((e) => e.value))).join('|') === 'Plank|Brand new move');
  await page.click('#clear-exercises');
  ok('Clear all empties the list in one tap and offers Undo', (await page.locator('.exrow').count()) === 0 && (await page.locator('#undo-clear-exercises').count()) === 1);
  await page.click('#undo-clear-exercises');
  ok('Undo restores the list', (await page.locator('.exrow').count()) === 2);

  await page.click('#start'); await page.waitForSelector('.ringwrap'); await sleep(300); await shot(page, '04-timer-prep');
  ok('Get ready previews the first exercise', (await spoken(page))[0] === 'Get ready. First exercise: Plank', (await spoken(page)).join(' | '));
  ok('screen wake lock requested', (await page.evaluate(() => window.__wake)) >= 1);
  await page.click('button[aria-label="Skip interval"]'); await sleep(250);
  ok('first work interval announces the exercise', (await lastSpoken(page)) === 'Plank');
  await shot(page, '05-timer-work');
  await page.click('button[aria-label="Skip interval"]'); await sleep(250);
  ok('rest announces the next exercise', (await lastSpoken(page)) === 'Rest. Next exercise: Brand new move', await lastSpoken(page));
  ok('ring contracts for rest', await page.locator('.ringwrap.rest').count() === 1); await shot(page, '06-timer-rest');
  await page.click('button[aria-label="Pause"]'); const t1 = await page.textContent('.tm'); await sleep(1400); const t2 = await page.textContent('.tm');
  ok('pause freezes the digits', t1 === t2 && (await page.locator('button[aria-label="Resume"]').count()) === 1, `${t1} vs ${t2}`);
  await page.click('button[aria-label="Resume"]'); await sleep(1300);
  ok('resume continues counting', (await page.textContent('.tm')) !== t2);
  await page.click('button[aria-label="Mute sound"]'); const n = (await spoken(page)).length; await page.click('button[aria-label="Skip interval"]'); await sleep(250);
  ok('mute silences announcements', (await spoken(page)).length === n && (await page.locator('button[aria-label="Unmute sound"]').count()) === 1);
  await page.click('button[aria-label="End workout"]'); await page.click('.sheet .primary');
  await page.waitForSelector('#start'); ok('ending returns to the builder', true);
  ok('no console/page errors in flow', realErrors(errors).length === 0, realErrors(errors).join(' | '));
  await ctx.close();
}

// ───────────── Hebrew workout: Hebrew phrases + Hebrew voice; beeps mode; completion ─────────────
{
  const { ctx, page } = await mk({ prepDuration: 5 });
  await page.click('[data-mode="EMOM"]'); await page.waitForSelector('#start');
  await page.click('#add-exercise'); await page.fill('#picker-search', 'כפיפות בטן'); await page.click('#picker-use-typed'); await page.click('#picker-add');
  await page.click('#start'); await page.waitForSelector('.ringwrap'); await sleep(250);
  const segs = await page.evaluate(() => window.__ann[0]);
  ok('Hebrew first exercise → Hebrew phrases', segs.slice(0, 3).map((s) => s.text).join('') === 'להתכונן. התרגיל הראשון: כפיפות בטן', JSON.stringify(segs));
  ok('Hebrew name spoken with the Hebrew voice', segs.at(-1).lang === 'he-IL' && segs[0].lang === 'he-IL', JSON.stringify(segs.map((s) => s.lang)));
  await shot(page, '07-timer-emom'); await ctx.close();

  const b = await mk({ prepDuration: 0, cueStyle: 'beeps', countdown: true });
  await b.page.click('[data-mode="TABATA"]'); await b.page.waitForSelector('#start');
  await b.page.click('#start'); await b.page.waitForSelector('.ringwrap'); await sleep(250);
  ok('beeps mode: GO beep at start, no speech', JSON.stringify(await b.page.evaluate(() => window.__beeps)) === '[1320]' && (await spoken(b.page)).length === 0, JSON.stringify(await b.page.evaluate(() => window.__beeps)));
  await b.page.click('button[aria-label="Skip interval"]'); await sleep(200);
  ok('beeps mode: lower beep when rest starts', (await b.page.evaluate(() => window.__beeps.at(-1))) === 587);
  ok('vibration at interval change', (await b.page.evaluate(() => window.__vibr.length)) >= 1);
  // finish the whole workout by skipping → completion screen
  for (let i = 0; i < 20 && (await b.page.locator('#done').count()) === 0; i++) { await b.page.click('button[aria-label="Skip interval"]').catch(() => {}); await sleep(80); }
  await b.page.waitForSelector('#done'); ok('completion screen after the last interval', true);
  ok('completion beeps (ascending pattern)', (await b.page.evaluate(() => window.__beeps.slice(-3))).join(',') === '880,1100,1320');
  await shot(b.page, '08-complete'); await b.page.click('#done'); await b.page.waitForSelector('#start'); await b.ctx.close();
}

// ───────────── defaults: a fresh visit uses beeps; an old saved "voice" is migrated; a deliberate choice is kept ─────────────
{
  const fresh = await mk(null);
  await fresh.page.click('[data-mode="TABATA"]'); await fresh.page.waitForSelector('#cue-style');
  ok('fresh visit: Beeps is the default cue sound', (await fresh.page.getAttribute('#cue-style button[data-v="beeps"]', 'aria-pressed')) === 'true');
  await fresh.page.click('#cue-style button[data-v="voice"]');
  await fresh.page.reload(); await fresh.page.waitForSelector('.pill'); await fresh.page.click('[data-mode="TABATA"]'); await fresh.page.waitForSelector('#cue-style');
  ok('choosing Voice is remembered after a reload', (await fresh.page.getAttribute('#cue-style button[data-v="voice"]', 'aria-pressed')) === 'true');
  await fresh.ctx.close();
  const old = await mk(null);
  await old.page.evaluate(() => localStorage.setItem('pulse.settings.v1', JSON.stringify({ cueStyle: 'voice', prepDuration: 3 }))); // saved by the previous version
  await old.page.reload(); await old.page.waitForSelector('.pill'); await old.page.click('[data-mode="TABATA"]'); await old.page.waitForSelector('#cue-style');
  ok('settings saved before the change are migrated to beeps (other settings kept)', (await old.page.getAttribute('#cue-style button[data-v="beeps"]', 'aria-pressed')) === 'true'
    && (await old.page.evaluate(() => JSON.parse(localStorage.getItem('pulse.settings.v1') || '{}').prepDuration ?? 3)) === 3);
  await old.ctx.close();
}

// ───────────── every mode has its own face; FOR TIME counts up ─────────────
{
  const { ctx, page } = await mk({ prepDuration: 0 });
  for (const mode of ['AMRAP', 'EMOM', 'FOR TIME', 'TABATA']) {
    await page.click(`[data-mode="${mode}"]`); await page.waitForSelector('#start'); await page.click('#start'); await page.waitForSelector('.ringwrap'); await sleep(1500);
    const dashes = await page.locator('.ring circle').evaluateAll((cs) => cs.map((c) => c.getAttribute('stroke-dasharray') || '-').join(';'));
    ok(`${mode}: ring face rendered`, (await page.locator('.ring').count()) === 1 && dashes.length > 0);
    await shot(page, `09-face-${mode.replace(' ', '')}`);
    if (mode === 'FOR TIME') { const tm = await page.textContent('.tm'); ok('FOR TIME counts UP', tm === '00:01' || tm === '00:02', tm); ok('FOR TIME shows the finish button', (await page.locator('#finish-early:visible').count()) === 1); }
    await page.click('button[aria-label="End workout"]'); await page.click('.sheet .primary'); await page.waitForSelector('#start'); await page.click('button[aria-label="Back"]'); await page.waitForSelector('.pill');
  }
  await ctx.close();
}

// ───────────── settings: import, manage, saved workouts, back button ─────────────
{
  const { ctx, page } = await mk({ prepDuration: 0 });
  await page.click('[data-tab="settings"]'); await page.waitForSelector('#exercise-count');
  const base = Number((await page.textContent('#exercise-count')).split(' ')[0]);
  ok('180+ starter exercises', base >= 150, String(base));
  const cof = async (id) => (await page.getAttribute(id, 'href')) === 'https://buymeacoffee.com/eden6454o' && (await page.getAttribute(id, 'target')) === '_blank' && (await page.getAttribute(id, 'rel')).includes('noopener');
  ok('Buy me a coffee link in Settings', await cof('#buy-coffee'));
  await page.click('[data-tab="timer"]'); await page.waitForSelector('#buy-coffee-home');
  ok('small Support link on the home page', await cof('#buy-coffee-home'));
  await page.click('[data-tab="settings"]'); await page.waitForSelector('#exercise-count');
  await page.click('#import-exercises'); await page.fill('#import-text', 'Zebra walks, Moon kicks\nPlank');
  ok('import summary counts new vs existing', (await page.textContent('#import-summary')) === '3 found · 2 new · 1 already in your list');
  await shot(page, '10-import'); await page.click('#import-add');
  await page.waitForFunction((b) => Number(document.querySelector('#exercise-count').textContent.split(' ')[0]) === b + 2, base);
  ok('import added the new exercises', true);
  await page.click('#manage-exercises'); await page.fill('#manage-add-field', 'Sandbag cleans'); await page.press('#manage-add-field', 'Enter');
  ok('manage: add one', (await page.locator('.sheet .item', { hasText: 'Sandbag cleans' }).count()) === 1);
  await page.keyboard.press('Escape'); await sleep(100);

  await page.click('[data-tab="timer"]'); await page.click('[data-mode="TABATA"]'); await page.waitForSelector('#start');
  await page.fill('input[aria-label="Workout name"]', 'Leg day'); await page.click('.ghost:has-text("Save")');
  await page.click('button[aria-label="Back"]'); await page.waitForSelector('.pill');
  await page.click('[data-tab="saved"]'); await page.waitForSelector('.scard');
  ok('saved workout appears and persists across reload', true);
  await shot(page, '11-saved');
  await page.reload(); await page.click('[data-tab="saved"]'); await page.waitForSelector('.scard');
  ok('saved workout survives a reload', (await page.locator('.scard h3', { hasText: 'Leg day' }).count()) === 1);
  await page.click('.scard .go'); await page.waitForSelector('.ringwrap'); ok('saved workout starts', true);
  // Android back button: confirm dialog, then returns into the app (not out of it)
  await page.goBack(); await page.waitForSelector('.sheet'); ok('back button on the timer asks to end the workout', (await page.locator('.sheet h2:has-text("End this workout")').count()) === 1);
  await page.click('.sheet .ghost'); await sleep(200); ok('cancel keeps the timer running', (await page.locator('.ringwrap').count()) === 1);
  await shot(page, '12-settings'); await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r[0]);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
