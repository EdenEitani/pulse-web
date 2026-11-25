import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBlock, draftFor, compile, blockDuration, workoutDuration, clock, stepped, summary } from '../js/model.js';
import { Engine } from '../js/engine.js';
import { scriptLang, detectLang, workoutLanguage, segments, textOf } from '../js/speech.js';
import { parse, clean, key, ExerciseStore, DEFAULTS } from '../js/exercises.js';
import { Storage } from '../js/storage.js';
import { TONES } from '../js/beeps.js';

import { loadSettings, saveSettings, DEFAULT_SETTINGS, storage } from '../js/storage.js';

// ───── default cue sound ─────
test('beeps are the default cue sound; old saved "voice" is migrated once; a later choice is kept', () => {
  storage.remove('pulse.settings.v1');
  assert.equal(loadSettings().cueStyle, 'beeps'); assert.equal(DEFAULT_SETTINGS.cueStyle, 'beeps');
  storage.setJSON('pulse.settings.v1', { cueStyle: 'voice', prepDuration: 3 });        // written by the previous version (no `v`)
  const migrated = loadSettings(); assert.equal(migrated.cueStyle, 'beeps'); assert.equal(migrated.prepDuration, 3);
  saveSettings({ ...migrated, cueStyle: 'voice' });                                     // the user now chooses voice on purpose
  assert.equal(loadSettings().cueStyle, 'voice'); assert.equal(loadSettings().prepDuration, 3);
  storage.remove('pulse.settings.v1');
});

// ───── helpers ─────
const mem = () => new Storage(null);
class Clock { constructor() { this.t = 1000; } now = () => this.t; advance(s) { this.t += s; } }
class FakeSpeaker { spoken = []; segs = []; stops = 0; activate() {} speak(s) { this.segs.push(s); this.spoken.push(s.map((x) => x.text).join('')); } stop() { this.stops++; } }
class FakeBeeper { played = []; activate() {} play(k) { this.played.push(k); } stop() {} }
const settings = (o = {}) => ({ prepDuration: 0, cueStyle: 'voice', countdown: false, announceNext: true, haptics: false, voiceRate: 1, ...o });
const tabata = (o = {}) => { const b = { ...makeBlock('TABATA'), work: 20, rest: 10, rounds: 3, sets: 1, setRest: 60, exercises: ['A', 'B'], ...o }; return { id: 'w', name: 't', mode: 'TABATA', blocks: [b] }; };
const rig = (w, s = settings(), extra = {}) => { const c = new Clock(), sp = new FakeSpeaker(), be = new FakeBeeper(); const e = new Engine(w, s, { speaker: sp, beeper: be, clock: c.now, autoTick: false, device: 'en-US', ...extra }); return { c, sp, be, e }; };

// ───── plan & durations ─────
test('tabata plan shape and builder total equals compiled plan', () => {
  const w = tabata({ rounds: 3, sets: 2 });
  const plan = compile(w);
  assert.deepEqual(plan.map((i) => i.kind), ['work', 'rest', 'work', 'rest', 'work', 'setRest', 'work', 'rest', 'work', 'rest', 'work']);
  assert.equal(plan.reduce((n, i) => n + i.duration, 0), 6 * 20 + 4 * 10 + 60);
  assert.equal(workoutDuration(w), 220);
});
test('exercises cycle across work intervals; zero-length intervals dropped', () => {
  assert.deepEqual(compile(tabata({ rounds: 3 })).filter((i) => i.kind === 'work').map((i) => i.exercise), ['A', 'B', 'A']);
  assert.deepEqual(compile(tabata({ rest: 0, rounds: 2 })).map((i) => i.kind), ['work', 'work']);
});
test('block defaults: new timers start without exercises; durations per type', () => {
  for (const t of ['AMRAP', 'FOR TIME', 'EMOM', 'TABATA', 'REST']) assert.deepEqual(makeBlock(t).exercises, []);
  for (const m of ['AMRAP', 'FOR TIME', 'EMOM', 'TABATA', 'MIX']) assert.ok(draftFor(m).blocks.every((b) => b.exercises.length === 0));
  assert.equal(blockDuration(makeBlock('AMRAP')), 600);
  assert.equal(compile(draftFor('FOR TIME'))[0].kind, 'forTime');
});
test('clock formatting and stepping', () => {
  assert.equal(clock(65), '01:05'); assert.equal(clock(3725), '1:02:05');
  assert.equal(stepped(20, 1, 5, 0, 999), 25); assert.equal(stepped(22, 1, 5, 0, 999), 25); assert.equal(stepped(22, -1, 5, 0, 999), 20);
  assert.equal(stepped(5, -1, 5, 1, 999), 1); assert.equal(stepped(58, 1, 5, 0, 60), 60); assert.equal(stepped(1, -1, 1, 1, 9), 1);
  assert.match(summary(makeBlock('TABATA')), /20s work \/ 10s rest × 8 rounds × 1 set/);
});

// ───── engine ─────
test('announces each interval exactly once, with the next exercise during rest', () => {
  const { c, sp, e } = rig(tabata({ rounds: 2, exercises: ['Squats', 'Lunges'] }));
  e.start(); assert.deepEqual(sp.spoken, ['Squats']);
  for (let i = 0; i < 10; i++) { c.advance(0.5); e.tick(); }
  assert.equal(sp.spoken.length, 1);
  c.advance(15.2); e.tick();
  assert.equal(e.index, 1); assert.equal(sp.spoken.at(-1), 'Rest. Next exercise: Lunges');
  e.tick(); e.tick(); assert.equal(sp.spoken.length, 2);
});
test('carry-over keeps the timeline exact; a long gap announces only the landing interval', () => {
  let { c, e } = rig(tabata({ rounds: 3 })); e.start(); c.advance(20.3); e.tick();
  assert.equal(e.index, 1); assert.ok(Math.abs(e.snapshot().elapsed - 0.3) < 1e-6);
  const r = rig(tabata({ rounds: 4, exercises: ['A', 'B', 'C', 'D'] })); r.e.start(); r.c.advance(65); r.e.tick();
  assert.equal(r.e.index, 4); assert.deepEqual(r.sp.spoken, ['A', 'C']);
});
test('pause freezes time and resume does not drift', () => {
  const { c, e, sp } = rig(tabata()); e.start(); c.advance(7); e.tick(); e.togglePause();
  const frozen = e.snapshot().elapsed; c.advance(600); e.tick();
  assert.equal(e.snapshot().elapsed, frozen); assert.equal(e.index, 0);
  e.togglePause(); c.advance(3); e.tick(); assert.ok(Math.abs(e.snapshot().elapsed - 10) < 1e-6); assert.equal(sp.stops, 1);
});
test('3-2-1 countdown is spoken once per number', () => {
  const { c, e, sp } = rig(tabata({ work: 10, rounds: 1, exercises: ['A'] }), settings({ countdown: true }));
  e.start(); for (let i = 0; i < 95; i++) { c.advance(0.1); e.tick(); }
  assert.deepEqual(sp.spoken, ['A', '3', '2', '1']);
});
test('prepare interval previews the first exercise; result excludes prepare', () => {
  const { c, e, sp } = rig(tabata({ work: 10, rounds: 1 }), settings({ prepDuration: 5 }));
  e.start(); assert.deepEqual(sp.spoken, ['Get ready. First exercise: A']);
  c.advance(5.1); e.tick(); assert.equal(e.current.kind, 'work'); assert.equal(sp.spoken.at(-1), 'A');
  c.advance(10); e.tick(); assert.ok(e.finished); assert.ok(Math.abs(e.result.time - 10) < 1e-6); assert.equal(sp.spoken.at(-1), 'Workout complete');
});
test('skip forward/back and FOR TIME counting up with finish early', () => {
  const { c, e } = rig(tabata({ rounds: 3 })); e.start(); e.skipForward(); assert.equal(e.index, 1);
  c.advance(5); e.tick(); e.skipBack(); assert.equal(e.index, 1); assert.equal(e.snapshot().elapsed, 0); e.skipBack(); assert.equal(e.index, 0);
  const f = rig({ id: 'f', name: 'f', mode: 'FOR TIME', blocks: [makeBlock('FOR TIME')] }); f.e.start();
  assert.ok(f.e.current.kind === 'forTime'); f.c.advance(125); f.e.tick(); f.e.finishEarly();
  assert.deepEqual(f.e.result, { time: 125, completedFully: false });
});
test('sound starts ON, mute silences and is per workout', () => {
  const a = rig(tabata()); assert.equal(a.e.sound, true); a.e.sound = false; a.e.start(); assert.deepEqual(a.sp.spoken, []);
  assert.equal(rig(tabata()).e.sound, true);
  const m = rig(tabata()); m.e.start(); const s = m.sp.stops; m.e.sound = false; assert.equal(m.sp.stops, s + 1);
});
test('beeps mode: GO / countdown / rest / complete, and never speaks', () => {
  const { c, e, sp, be } = rig(tabata({ work: 10, rest: 10, rounds: 2 }), settings({ cueStyle: 'beeps', countdown: true }));
  e.start(); assert.deepEqual(be.played, ['go']);
  for (let i = 0; i < 95; i++) { c.advance(0.1); e.tick(); }
  assert.deepEqual(be.played, ['go', 'countdown', 'countdown', 'countdown']);
  c.advance(1); e.tick(); assert.equal(be.played.at(-1), 'rest'); assert.deepEqual(sp.spoken, []);
  const f = rig(tabata({ rounds: 1, work: 5 }), settings({ cueStyle: 'beeps' })); f.e.start(); f.c.advance(6); f.e.tick(); assert.equal(f.be.played.at(-1), 'complete');
  assert.ok(TONES.go[0][0] > TONES.countdown[0][0] && TONES.rest[0][0] < TONES.countdown[0][0] && TONES.go[0][1] > TONES.countdown[0][1] * 3);
});

// ───── language ─────
test('script detection and workout language', () => {
  const cases = { 'סקוואט': 'he-IL', 'قرفصاء': 'ar-SA', 'Приседания': 'ru-RU', 'Βάδην': 'el-GR', '深蹲': 'zh-CN', 'スクワット': 'ja-JP', '腕立て伏せ': 'ja-JP', '스쿼트': 'ko-KR', 'สควอท': 'th-TH', 'स्क्वाट': 'hi-IN', '10 שכיבות סמיכה!': 'he-IL' };
  for (const [t, l] of Object.entries(cases)) assert.equal(scriptLang(t), l, t);
  assert.equal(detectLang('Squats'), 'en-US'); assert.equal(scriptLang('Squats'), null);
  const plan = (ex) => compile(tabata({ exercises: ex }));
  assert.equal(workoutLanguage(plan(['כפיפות בטן']), 'en-US'), 'he-IL');
  assert.equal(workoutLanguage(plan(['Squats']), 'he-IL'), 'en-US');
  assert.equal(workoutLanguage(plan([]), 'he-IL'), 'he-IL'); assert.equal(workoutLanguage(plan([]), 'fr-FR'), 'en-US');
});
test('Hebrew workout speaks Hebrew phrases; a Hebrew name inside an English workout uses the Hebrew voice', () => {
  const he = rig(tabata({ exercises: ['כפיפות בטן'] }), settings({ prepDuration: 5 })); he.e.start();
  assert.deepEqual(he.sp.segs.at(-1), [{ text: 'להתכונן', lang: 'he-IL' }, { text: '. התרגיל הראשון: ', lang: 'he-IL' }, { text: 'כפיפות בטן', lang: 'he-IL' }]);
  const en = rig(tabata({ rounds: 2, exercises: ['Squats', 'כפיפות בטן'] }), settings({ prepDuration: 5 })); en.e.start(); en.c.advance(5.1); en.e.tick(); en.c.advance(20); en.e.tick();
  assert.deepEqual(en.sp.segs.at(-1), [{ text: 'Rest', lang: 'en-US' }, { text: '. Next exercise: ', lang: 'en-US' }, { text: 'כפיפות בטן', lang: 'he-IL' }]);
  assert.equal(textOf(segments(compile(tabata({ exercises: [] })), 0, 'en-US')), 'Work');
});

// ───── exercise list ─────
test('import parsing: commas, new lines, bullets, numbering, dupes, Hebrew/Arabic commas', () => {
  assert.deepEqual(parse('Squats, Push-ups,Lunges\nBurpees\r\nPlank'), ['Squats', 'Push-ups', 'Lunges', 'Burpees', 'Plank']);
  assert.deepEqual(parse('1. Squats\n2) Push-ups\n- Lunges\n• Burpees\n* Plank\n\nsquats,  PUSH-UPS ,\n3 - Sit-ups'), ['Squats', 'Push-ups', 'Lunges', 'Burpees', 'Plank', 'Sit-ups']);
  assert.deepEqual(parse('כפיפות בטן, שכיבות סמיכה\nסקוואט; ריצה'), ['כפיפות בטן', 'שכיבות סמיכה', 'סקוואט', 'ריצה']);
  assert.deepEqual(parse('قرفصاء،ضغط'), ['قرفصاء', 'ضغط']);
  assert.deepEqual(parse('5 x Pull-ups, 100m sprint, 21-15-9 thrusters'), ['5 x Pull-ups', '100m sprint', '21-15-9 thrusters']);
  assert.equal(parse('a'.repeat(300))[0].length, 90); assert.deepEqual(parse(' , ,\n\n ; '), []); assert.equal(clean('  Mountain    climbers '), 'Mountain climbers');
});
test('starter list is large, unique and clean', () => {
  assert.ok(DEFAULTS.length >= 150); assert.equal(new Set(DEFAULTS.map(key)).size, DEFAULTS.length);
  for (const m of ['Squats', 'Push-ups', 'Burpees', 'Mountain climbers', 'Plank']) assert.ok(DEFAULTS.includes(m));
});
test('exercise store: persistence, merge/replace, remove/reset, no writes until changed', () => {
  const st = mem(); let s = new ExerciseStore(st);
  assert.ok(s.isDefault); assert.equal(st.getJSON('pulse.exercises.v1', null), null);
  assert.equal(s.add('squats'), false); assert.equal(s.addAll(['Squats', 'Brand new', 'brand NEW', '']), 1);
  s = new ExerciseStore(st); assert.ok(s.has('BRAND new'));
  s.replace(parse('A, B\nC, a')); assert.deepEqual(new ExerciseStore(st).list, ['A', 'B', 'C']);
  s.remove('b'); assert.deepEqual(s.list, ['A', 'C']); s.reset(); assert.ok(new ExerciseStore(st).isDefault);
  s.replace(['banana', 'Apple', 'cherry', 'apple2']); assert.deepEqual(s.sorted, ['Apple', 'apple2', 'banana', 'cherry']);
});

// ───── halfway cue ─────
test('halfway cue: beeps and voice, once per interval, not in get-ready or short intervals', () => {
  const b = rig(tabata({ work: 20, rest: 10, rounds: 1 }), settings({ cueStyle: 'beeps', halfway: true, prepDuration: 5 }));
  b.e.start(); assert.deepEqual(b.be.played, []);
  for (let i = 0; i < 60; i++) { b.c.advance(0.1); b.e.tick(); }          // 6 s: get-ready (5 s) is over, GO beeped, no halfway in get-ready
  assert.deepEqual(b.be.played, ['go']);
  for (let i = 0; i < 100; i++) { b.c.advance(0.1); b.e.tick(); }         // 16 s: past 10 s of the 20 s work
  assert.deepEqual(b.be.played, ['go', 'halfway']);
  for (let i = 0; i < 40; i++) { b.c.advance(0.1); b.e.tick(); }
  assert.equal(b.be.played.filter((k) => k === 'halfway').length, 1);
  const v = rig(tabata({ work: 20, rest: 10, rounds: 1, exercises: ['Squats'] }), settings({ halfway: true }));
  v.e.start(); for (let i = 0; i < 105; i++) { v.c.advance(0.1); v.e.tick(); }
  assert.deepEqual(v.sp.spoken, ['Squats', 'Halfway there']);
  const short = rig(tabata({ work: 8, rest: 5, rounds: 1 }), settings({ cueStyle: 'beeps', halfway: true })); short.e.start();
  for (let i = 0; i < 70; i++) { short.c.advance(0.1); short.e.tick(); }
  assert.ok(!short.be.played.includes('halfway'));
  const off = rig(tabata({ work: 20, rounds: 1 }), settings({ cueStyle: 'beeps', halfway: false })); off.e.start();
  for (let i = 0; i < 120; i++) { off.c.advance(0.1); off.e.tick(); }
  assert.ok(!off.be.played.includes('halfway'));
  assert.ok(TONES.halfway.length === 2 && TONES.halfway[0][0] !== TONES.countdown[0][0]);
  assert.equal(DEFAULT_SETTINGS.halfway, true);
});
