import { MODES, BLOCK_TYPES, COLORS, INK, TAGLINES, makeBlock, draftFor, summary, blockDuration, workoutDuration, clock, stateLabel, accentFor, uid } from './model.js';
import { Engine } from './engine.js';
import { Speaker } from './speech.js';
import { Beeper } from './beeps.js';
import { ExerciseStore, parse, clean, key } from './exercises.js';
import { loadSettings, saveSettings, loadWorkouts, saveWorkout, deleteWorkout } from './storage.js';
import { LockSupport } from './lockscreen.js';
import { h, fill, icon, roundBtn, openModal, closeTopModal, hasModal, popSuppressed, suppressNextPop, sheetHeader, confirmDialog, toast, toggleSwitch, segmented, field, numberField, durationField } from './ui.js';

// ───────────────────────── state ─────────────────────────
const S = { tab: 'timer', route: 'home', mode: null, draft: null, addOpen: false, engine: null, timerUI: null, lock: null, installPrompt: null,
  settings: loadSettings(), lib: new ExerciseStore(), hist: [] };

// History entries we pushed (builder/timer) so the Android back button steps back through the app instead of leaving it.
function pushRoute(name) { history.pushState({ r: name }, ''); S.hist.push(name); }
function popRoute() { if (S.hist.length) { S.hist.pop(); suppressNextPop(); history.back(); } }
const speaker = new Speaker(), beeper = new Beeper();
const root = document.getElementById('app');
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const set = (patch) => { Object.assign(S.settings, patch); saveSettings(S.settings); };

/** Rebuilds the screen. Keeps the scroll position unless `top` is true. */
function render(top = false) {
  const y = window.scrollY;
  const timer = S.route === 'timer' && S.tab === 'timer';
  S.timerUI = null;
  const screen = S.tab === 'saved' ? savedScreen() : S.tab === 'settings' ? settingsScreen()
    : S.route === 'home' ? homeScreen() : S.route === 'builder' ? builderScreen() : (S.engine?.finished ? completionScreen() : timerScreen());
  fill(root, screen, timer ? null : tabbar());
  window.scrollTo(0, top ? 0 : y);
  if (S.timerUI) startFrameLoop(S.timerUI);
}

/** Screen change with a shared-element morph where the browser supports View Transitions. */
function go(change) {
  if (document.startViewTransition && !reduceMotion()) document.startViewTransition(() => { change(); render(true); });
  else { change(); render(true); }
}

function tabbar() {
  const tab = (id, ic, label) => h('button', { class: 'tab', 'aria-current': S.tab === id ? 'page' : null, 'data-tab': id, onClick: () => { S.tab = id; render(true); } }, icon(ic), label);
  return h('nav', { class: 'tabbar', 'aria-label': 'Main' }, tab('timer', 'timer', 'Timer'), tab('saved', 'stack', 'Saved'), tab('settings', 'gear', 'Settings'));
}

// ───────────────────────── home ─────────────────────────
function homeScreen() {
  const pill = (mode) => h('button', {
    class: 'pill', 'data-mode': mode, 'aria-label': `${mode} workout`, style: { background: COLORS[mode], color: INK[mode], viewTransitionName: S.mode === mode ? 'mode-hdr' : '' },
    onClick: (ev) => { ev.currentTarget.style.viewTransitionName = 'mode-hdr'; openBuilder(mode); },
  }, mode, mode === 'MIX' && h('span', { class: 'tag' }, 'CUSTOM'));
  return h('div', { class: 'screen home' },
    h('div', { class: 'topbar' }, h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, icon('timer')), 'pulse', h('small', null, 'timer')),
      roundBtn('gear', 'Settings', () => { S.tab = 'settings'; render(true); })),
    h('div', { class: 'tiny' }, 'Train on your terms'),
    h('h1', null, 'Every second', h('br'), 'counts.'),
    h('p', { class: 'sub' }, 'One timer. Endless ways to move.', h('br'), 'Build your workout, then just follow the flow.'),
    h('div', { class: 'pills' }, MODES.map(pill)),
    h('p', { class: 'footnote' }, '100% free · Offline · Voice-guided'),
    h('a', { class: 'coffee-small', id: 'buy-coffee-home', href: 'https://buymeacoffee.com/eden6454o', target: '_blank', rel: 'noopener noreferrer' }, '☕ Support Pulse'));
}

function openBuilder(mode) {
  S.mode = mode; S.draft = draftFor(mode); S.addOpen = false;
  go(() => { S.route = 'builder'; pushRoute('builder'); });
}
function leaveBuilder() { popRoute(); go(() => { S.route = 'home'; }); }

// ───────────────────────── builder ─────────────────────────
function builderScreen() {
  const w = S.draft, accent = COLORS[w.mode], ink = INK[w.mode];
  const redraw = () => render(false);
  const total = h('b', null, clock(workoutDuration(w)));

  const cue = field('Cue sound',
    segmented([['voice', 'Voice'], ['beeps', 'Beeps']], S.settings.cueStyle, (v) => { set({ cueStyle: v }); redraw(); }, 'cue-style'),
    h('div', { class: 'help' }, S.settings.cueStyle === 'voice' ? 'Spoken countdown and exercise names.' : 'Three short beeps for 3 · 2 · 1, one longer high beep on GO, a lower beep when rest starts.'),
    S.settings.cueStyle === 'beeps' && h('button', { class: 'btn-outline', onClick: () => beeper.sample() }, icon('speaker'), 'Play sample'));

  let body;
  if (w.mode === 'MIX') {
    body = [h('div', { class: 'section' }, 'Workout timeline'),
      w.blocks.map((b, i) => blockCard(b, i, redraw)), addArea(redraw)];
  } else {
    body = blockFields(w.blocks[0], redraw);
  }

  return h('div', { class: 'screen builder', style: { '--accent': accent } },
    h('div', { class: 'topbar' }, roundBtn('back', 'Back', leaveBuilder), h('button', { class: 'ghost', onClick: saveDraft }, 'Save')),
    h('div', { class: 'hdr', style: { background: accent, color: ink, viewTransitionName: 'mode-hdr' } },
      h('div', null, h('h2', null, w.mode === 'MIX' ? 'MIX BUILDER' : w.mode), h('div', { class: 'tg' }, TAGLINES[w.mode])),
      h('div', { class: 'tot' }, h('span', { class: 'tg' }, 'TOTAL'), total)),
    field('Workout name', h('input', { type: 'text', value: w.name, maxlength: '75', 'aria-label': 'Workout name', onInput: (e) => { w.name = e.target.value; } })),
    cue, body,
    h('div', { style: { height: '90px' } }),
    h('div', { class: 'startbar' }, h('button', { class: 'btn-solid', id: 'start', style: { background: accent, color: ink, viewTransitionName: 'start-btn' }, disabled: workoutDuration(w) <= 0,
      onClick: (ev) => { ev.currentTarget.style.viewTransitionName = 'start-btn'; startWorkout(S.draft); } }, 'START WORKOUT  →')));
}

function saveDraft() {
  if (!S.draft.blocks.length) return toast('Add a workout block first');
  S.draft.name = S.draft.name.trim() || 'Untitled workout';
  saveWorkout(S.draft); toast('Workout saved ✓');
}

function blockCard(b, i, redraw) {
  const w = S.draft, c = COLORS[b.type];
  const move = (d) => { const j = i + d; if (j < 0 || j >= w.blocks.length) return; [w.blocks[i], w.blocks[j]] = [w.blocks[j], w.blocks[i]]; redraw(); };
  const tool = (ic, label, fn) => h('button', { class: 'mini', 'aria-label': label, onClick: fn }, icon(ic));
  return h('div', { class: 'bcard', style: { '--c': c } },
    h('div', { class: 'row' }, h('strong', null, b.type),
      h('div', { class: 'tools' }, tool('up', 'Move block up', () => move(-1)), tool('down', 'Move block down', () => move(1)), tool('pencil', 'Edit block', () => editBlock(b, redraw)),
        tool('copy', 'Duplicate block', () => { w.blocks.splice(i + 1, 0, { ...JSON.parse(JSON.stringify(b)), id: uid() }); redraw(); }),
        tool('trash', 'Delete block', () => { w.blocks.splice(i, 1); redraw(); }))),
    h('div', { class: 'd' }, summary(b)),
    h('small', null, `${b.exercises.length} exercise${b.exercises.length === 1 ? '' : 's'} · ${clock(blockDuration(b))} total`));
}

function addArea(redraw) {
  if (!S.addOpen) return h('button', { class: 'btn-outline', id: 'add-block', style: { height: '56px', borderStyle: 'solid', borderColor: '#304247', background: '#1c2a2e', color: '#e7f8f7' }, onClick: () => { S.addOpen = true; redraw(); setTimeout(() => document.getElementById('add-area')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50); } }, icon('plus'), 'Add workout block');
  return h('div', { class: 'field', id: 'add-area' }, h('div', { class: 'lab' }, 'Add block'),
    h('div', { class: 'chooser' }, BLOCK_TYPES.map((t) => h('button', { 'data-type': t, style: { background: COLORS[t], color: INK[t] }, onClick: () => {
      const b = makeBlock(t); S.draft.blocks.push(b); S.addOpen = false; redraw(); editBlock(b, redraw);
    } }, t))),
    h('button', { class: 'linkbtn', style: { marginTop: '10px' }, onClick: () => { S.addOpen = false; redraw(); } }, 'Cancel'));
}

function editBlock(b, redraw) {
  openModal((ctl) => {
    ctl.onClose = redraw;
    const body = h('div', { class: 'body', style: { '--accent': COLORS[b.type] } });
    const draw = () => { const y = body.scrollTop; body.replaceChildren(...blockFields(b, draw)); body.scrollTop = y; };
    draw();
    return [h('div', { class: 'shead' }, h('h2', { style: { color: COLORS[b.type] } }, `Edit ${b.type}`), roundBtn('x', 'Close', () => ctl.close())),
      body, h('button', { class: 'primary', id: 'save-block', style: { background: COLORS[b.type], color: INK[b.type] }, onClick: () => ctl.close() }, 'SAVE BLOCK')];
  });
}

// Per-block "cleared exercises" so Undo can bring them back.
const cleared = new Map();

function blockFields(b, redraw) {
  const out = [];
  const num = (title, prop, o) => numberField(title, b[prop], { ...o, onChange: (v) => { b[prop] = v; redraw(); } });
  const dur = (title, prop) => durationField(title, b[prop], { onChange: (v) => { b[prop] = v; redraw(); } });
  const label = (title, ph) => field(title, h('input', { type: 'text', placeholder: ph, value: b.exercises[0] || '', 'aria-label': title, onInput: (e) => { b.exercises = e.target.value ? [e.target.value] : []; } }));
  switch (b.type) {
    case 'REST': out.push(dur('Rest duration', 'work')); break;
    case 'AMRAP': out.push(dur('As many rounds as possible in', 'work'), label('Workout (optional)', 'e.g. 5 pull-ups, 10 push-ups, 15 squats')); break;
    case 'FOR TIME': out.push(dur('Time cap', 'work'), label('Workout (optional)', 'e.g. 100 burpees')); break;
    case 'EMOM': out.push(dur('Every', 'work'), num('Intervals', 'rounds', { min: 1, max: 1000 }), exerciseEditor(b, redraw)); break;
    default:
      out.push(h('div', { class: 'pair' }, num('Work (sec)', 'work', { min: 1, max: 3600, step: 5 }), num('Rest (sec)', 'rest', { min: 0, max: 3600, step: 5 })),
        h('div', { class: 'pair' }, num('Rounds', 'rounds', { min: 1, max: 1000 }), num('Sets', 'sets', { min: 1, max: 1000 })),
        num('Rest between sets (sec)', 'setRest', { min: 0, max: 3600, step: 5 }), exerciseEditor(b, redraw));
  }
  return out;
}

function exerciseEditor(b, redraw) {
  const rows = b.exercises.map((name, i) => h('div', { class: 'exrow' }, h('span', null, `${i + 1}.`),
    h('input', { type: 'text', value: name, maxlength: '90', 'aria-label': `Exercise ${i + 1}`, placeholder: `Exercise ${i + 1}`, onInput: (e) => { b.exercises[i] = e.target.value; } }),
    h('button', { 'aria-label': `Remove exercise ${i + 1}`, onClick: () => { b.exercises.splice(i, 1); redraw(); } }, icon('x'))));
  const head = h('div', { class: 'exhead' }, h('div', { class: 'section', style: { margin: 0 } }, 'Exercise list'),
    b.exercises.length
      ? h('button', { class: 'linkbtn', id: 'clear-exercises', onClick: () => { cleared.set(b.id, [...b.exercises]); b.exercises = []; redraw(); } }, icon('trash'), 'Clear all')
      : cleared.has(b.id) && h('button', { class: 'linkbtn', id: 'undo-clear-exercises', style: { color: 'var(--accent)' }, onClick: () => { b.exercises = cleared.get(b.id); cleared.delete(b.id); redraw(); } }, icon('undo'), 'Undo'));
  return h('div', { class: 'exlist' }, head,
    h('p', { class: 'help muted', style: { fontSize: '12px', margin: '6px 0' } }, 'Each work interval takes the next exercise from this list, repeating when needed. An empty list announces “Work”.'),
    rows, h('button', { class: 'btn-outline', id: 'add-exercise', onClick: () => openPicker((names) => { cleared.delete(b.id); b.exercises.push(...names); redraw(); }) }, icon('plus'), 'Add exercise'));
}

// ───────────────────────── exercise picker / library tools ─────────────────────────
function openPicker(onAdd) {
  openModal((ctl) => {
    let query = '', saveNew = true; const selected = [];
    const sel = (n) => selected.some((x) => key(x) === key(n));
    const list = h('div', { class: 'body' }), foot = h('div'), addBtn = h('button', { class: 'primary', id: 'picker-add', disabled: true }, 'Add');
    const search = h('input', { type: 'search', placeholder: 'Search, or type a new exercise', id: 'picker-search', 'aria-label': 'Search or type a new exercise', autocomplete: 'off', enterkeyhint: 'done' });
    const toggle = (n) => { const i = selected.findIndex((x) => key(x) === key(n)); if (i >= 0) selected.splice(i, 1); else selected.push(n); draw(); };
    const useTyped = () => { const n = clean(query); if (!n) return; const existing = S.lib.list.find((x) => key(x) === key(n)); if (!sel(existing || n)) selected.push(existing || n); query = ''; search.value = ''; draw(); };
    function item(name, isNew) {
      return h('button', { class: `item${isNew ? ' new' : ''}`, 'aria-pressed': String(sel(name)), 'aria-label': name, onClick: () => toggle(name) }, h('span', { class: 'ck' }, sel(name) ? '✓' : ''), name, isNew && h('span', { class: 'x tiny' }, 'NEW'));
    }
    function draw() {
      const q = key(query), cq = clean(query);
      const typedNew = cq && !S.lib.has(cq) && !sel(cq);
      const fresh = selected.filter((n) => !S.lib.has(n));
      const filtered = S.lib.sorted.filter((n) => !q || key(n).includes(q));
      fill(list,
        typedNew && h('button', { class: 'item new', id: 'picker-use-typed', onClick: useTyped }, icon('plus'), `Use “${cq}”`, h('span', { class: 'x tiny' }, 'NEW')),
        fresh.map((n) => item(n, true)), filtered.map((n) => item(n, false)),
        !filtered.length && !typedNew && h('p', { class: 'empty' }, 'No exercises match.'));
      fill(foot, fresh.length ? toggleSwitch('Save new exercises to my list', saveNew, (v) => { saveNew = v; }) : null);
      addBtn.disabled = !selected.length; addBtn.textContent = selected.length ? `Add (${selected.length})` : 'Add';
    }
    search.addEventListener('input', () => { query = search.value; draw(); });
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); useTyped(); } });
    addBtn.addEventListener('click', () => { if (saveNew) S.lib.addAll(selected.filter((n) => !S.lib.has(n))); const picked = [...selected]; ctl.close(); onAdd(picked); });
    draw();
    return [h('div', { class: 'shead' }, h('h2', null, 'Add exercises'), roundBtn('x', 'Close', () => ctl.close())),
      h('div', { class: 'search' }, icon('search'), search), list, foot, addBtn];
  });
}

function openManage(onClose) {
  openModal((ctl) => {
    ctl.onClose = onClose;
    let query = '';
    const body = h('div', { class: 'body' });
    const counter = h('p', { class: 'muted', style: { margin: '0 0 12px', fontSize: '13px' } });
    const add = h('input', { type: 'text', placeholder: 'Add an exercise', id: 'manage-add-field', 'aria-label': 'Add an exercise', enterkeyhint: 'done', style: { flex: 1, background: 'var(--surface)', border: '1px solid var(--stroke)', borderRadius: '14px', padding: '13px', outline: 0 } });
    const reset = h('button', { class: 'ghost', id: 'reset-defaults' }, icon('undo'), ' Reset to defaults');
    function draw() {
      const q = key(query);
      counter.textContent = `${S.lib.list.length} exercises · used when you add exercises to a block`;
      reset.disabled = S.lib.isDefault;
      body.replaceChildren(...S.lib.sorted.filter((n) => !q || key(n).includes(q)).map((n) => h('div', { class: 'item' }, n,
        h('button', { class: 'x', 'aria-label': `Remove ${n}`, onClick: () => { S.lib.remove(n); draw(); } }, icon('x')))));
    }
    const addOne = () => { const n = clean(add.value); if (n) { S.lib.add(n); add.value = ''; draw(); } };
    add.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addOne(); } });
    reset.addEventListener('click', async () => { if (await confirmDialog({ title: 'Reset the exercise list?', message: 'This replaces your list with the built-in one. Saved workouts are not changed.', confirm: 'Reset', danger: true })) { S.lib.reset(); draw(); } });
    draw();
    return [sheetHeader('Exercise list', ctl), counter,
      h('div', { style: { display: 'flex', gap: '10px', marginBottom: '10px' } }, add, h('button', { class: 'round', 'aria-label': 'Add exercise to list', style: { background: 'var(--accent)', color: '#09201b', border: 0 }, onClick: addOne }, icon('plus'))),
      h('div', { style: { display: 'flex', gap: '10px', marginBottom: '10px' } }, h('button', { class: 'ghost', id: 'import-open', onClick: () => openImport(draw) }, icon('import'), ' Import…'), reset),
      h('div', { class: 'search' }, icon('search'), h('input', { type: 'search', placeholder: 'Search', 'aria-label': 'Search list', onInput: (e) => { query = e.target.value; draw(); } })), body];
  });
}

function openImport(after) {
  openModal((ctl) => {
    ctl.onClose = after;
    const ta = h('textarea', { id: 'import-text', 'aria-label': 'Exercises to import', placeholder: 'Squats, Push-ups, Lunges\nBurpees\nסקוואט' });
    const summaryEl = h('p', { id: 'import-summary', style: { fontWeight: 700, fontSize: '13px', margin: '10px 0' } });
    const addBtn = h('button', { class: 'primary', id: 'import-add' }, 'Add to list'), repBtn = h('button', { class: 'ghost', id: 'import-replace', style: { width: '100%', height: '48px', marginTop: '10px' } }, 'Replace list');
    const draw = () => { const p = parse(ta.value), fresh = p.filter((n) => !S.lib.has(n)).length;
      summaryEl.textContent = p.length ? `${p.length} found · ${fresh} new · ${p.length - fresh} already in your list` : 'Nothing to import yet'; summaryEl.style.color = p.length ? 'var(--accent)' : 'var(--subtle)'; addBtn.disabled = repBtn.disabled = !p.length; };
    ta.addEventListener('input', draw);
    addBtn.addEventListener('click', () => { const n = S.lib.addAll(parse(ta.value)); toast(`${n} exercise${n === 1 ? '' : 's'} added`); ctl.close(); });
    repBtn.addEventListener('click', async () => { const p = parse(ta.value); if (await confirmDialog({ title: 'Replace your whole list?', message: `Your current list will be replaced by these ${p.length} exercises.`, confirm: 'Replace', danger: true })) { S.lib.replace(p); ctl.close(); } });
    draw();
    return [sheetHeader('Import exercises', ctl), h('p', { class: 'muted', style: { fontSize: '13px', margin: '0 0 10px' } }, 'Paste or type exercises separated by commas or new lines. Bullets and numbering are ignored.'), ta, summaryEl, addBtn, repBtn];
  });
}

// ───────────────────────── timer ─────────────────────────
function startWorkout(w) {
  if (workoutDuration(w) <= 0) return toast('Workout needs a positive duration');
  S.draft = w;
  const engine = new Engine(w, S.settings, { speaker, beeper, onEvent });
  S.engine = engine; S.lock = new LockSupport();
  engine.start();                                    // inside the tap, so the browser allows audio and speech
  S.lock.start(engine);
  go(() => { S.tab = 'timer'; S.route = 'timer'; pushRoute('timer'); });
}

function onEvent(name) {
  if (!S.engine) return;
  if (name === 'finished') { S.lock?.update(); S.lock?.stop(); render(true); return; }
  S.timerUI?.refresh(); S.lock?.update();
}

async function exitTimer(confirm = true, alreadyPopped = false) {
  if (confirm && S.engine && !S.engine.finished && !(await confirmDialog({ title: 'End this workout?', confirm: 'End workout', danger: true }))) return;
  S.engine?.stop(); S.lock?.stop(); S.engine = null; S.lock = null;
  if (!alreadyPopped) popRoute();
  go(() => { S.route = S.draft ? 'builder' : 'home'; });
}

const R = 44, CIRC = 2 * Math.PI * R;
const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, a = {}, parent) => { const e = document.createElementNS(SVGNS, tag); for (const k in a) e.setAttribute(k, a[k]); parent?.append(e); return e; };

/** Mode-specific ring: AMRAP dotted · FOR TIME thin · EMOM segmented · TABATA smooth · REST smooth (contracts). */
function buildRing(style) {
  const svg = sv('svg', { viewBox: '0 0 100 100', class: 'ring', 'aria-hidden': 'true' });
  const g = sv('g', { transform: 'rotate(-90 50 50)' }, svg);
  const circle = (extra) => sv('circle', { cx: 50, cy: 50, r: R, ...extra }, g);
  let prog, maskCircle = null;
  if (style === 'dotted') { circle({ stroke: '#2d3a40', 'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-dasharray': '0.1 5.3' }); prog = circle({ class: 'prog', 'stroke-width': 5, 'stroke-linecap': 'round' }); }
  else if (style === 'seg') {
    const seg = CIRC / 12 - 3.2;
    circle({ stroke: '#27333a', 'stroke-width': 6.5, 'stroke-dasharray': `${seg} 3.2` });
    const defs = sv('defs', {}, svg), mask = sv('mask', { id: 'segmask' }, defs), mg = sv('g', {}, mask); // the mask already lives in the rotated user space
    maskCircle = sv('circle', { cx: 50, cy: 50, r: R, fill: 'none', stroke: '#fff', 'stroke-width': 14 }, mg);
    prog = circle({ class: 'prog', 'stroke-width': 6.5, 'stroke-dasharray': `${seg} 3.2`, mask: 'url(#segmask)' });
  } else if (style === 'thin') { circle({ stroke: '#233b48', 'stroke-width': 1.6 }); prog = circle({ class: 'prog', 'stroke-width': 1.6, 'stroke-linecap': 'round' }); }
  else { circle({ stroke: '#27333a', 'stroke-width': 5 }); prog = circle({ class: 'prog', 'stroke-width': 5, 'stroke-linecap': 'round' }); }
  const setProgress = (p) => {
    const len = Math.max(0, Math.min(1, p)) * CIRC;
    if (maskCircle) maskCircle.setAttribute('stroke-dasharray', `${len} ${CIRC}`);
    else { prog.setAttribute('stroke-dasharray', `${len} ${CIRC}`); prog.style.opacity = len < 0.4 ? 0 : 1; }
  };
  return { svg, setProgress };
}
const faceStyle = (i) => (i.kind === 'rest' || i.kind === 'setRest' || i.kind === 'prepare') ? 'smooth' : ({ 'AMRAP': 'dotted', 'FOR TIME': 'thin', 'EMOM': 'seg', 'TABATA': 'smooth', 'REST': 'smooth' }[i.blockType] || 'smooth');
const faceWeight = (i) => (i.kind === 'rest' || i.kind === 'setRest') ? 400 : ({ 'AMRAP': 700, 'FOR TIME': 200, 'EMOM': 800, 'TABATA': 300 }[i.blockType] || 300);

function timerScreen() {
  const e = S.engine;
  const root_ = h('div', { class: 'screen timer' });
  const ui = { el: root_, ring: null, refs: {} };
  const R_ = ui.refs;

  R_.title = h('div', { class: 'ttl' }); R_.sound = roundBtn('speaker', 'Mute sound', () => { e.sound = !e.sound; });
  R_.t1 = h('div', { class: 't1' }); R_.t2 = h('div', { class: 't2' }); R_.t3 = h('div', { class: 't3' });
  R_.wrap = h('div', { class: 'ringwrap' }); R_.next = h('div', { class: 'nextline' }); R_.segs = h('div', { class: 'segs', 'aria-hidden': 'true' });
  R_.elapsed = h('span'); R_.remaining = h('span');
  R_.pause = h('button', { class: 'round main', onClick: () => e.togglePause() });
  R_.finish = h('button', { class: 'finish', id: 'finish-early', onClick: () => e.finishEarly() }, 'FINISH · LOG MY TIME');
  root_.append(
    h('div', { class: 'backdrop', style: { viewTransitionName: 'start-btn' } }),
    h('div', { class: 'tbar' }, roundBtn('x', 'End workout', () => exitTimer()), R_.title, R_.sound),
    h('div', { class: 'tcenter' }, R_.t1, R_.t2, R_.t3, R_.wrap, R_.next, R_.segs, h('div', { class: 'meta' }, R_.elapsed, R_.remaining)),
    h('div', { class: 'controls' }, roundBtn('prev', 'Previous interval', () => e.skipBack()), R_.pause, roundBtn('next', 'Skip interval', () => e.skipForward())), R_.finish);

  ui.refresh = () => {
    const i = e.current, accent = accentFor(i);
    root_.style.setProperty('--accent', accent);
    R_.title.textContent = i.kind === 'prepare' ? 'GET READY' : i.blockType || '';
    R_.t1.textContent = i.kind === 'prepare' || e.workout.blocks.length === 1 ? e.workout.name : `BLOCK ${i.blockIndex + 1} OF ${e.workout.blocks.length}`;
    R_.t2.textContent = i.rounds > 1 ? `ROUND ${i.round} / ${i.rounds}${i.sets > 1 ? ` · SET ${i.set} / ${i.sets}` : ''}` : i.kind === 'forTime' ? `STOPWATCH · TIME CAP ${clock(i.duration)}` : '';
    R_.t3.textContent = i.kind === 'prepare' ? 'YOUR WORKOUT STARTS SOON' : (i.kind === 'rest' || i.kind === 'setRest') ? 'RECOVER · BREATHE' : (TAGLINES[i.blockType] || 'WORKOUT IN PROGRESS');
    ui.ring = buildRing(faceStyle(i));
    const name = i.kind === 'prepare' ? 'GET READY' : (i.kind === 'rest' || i.kind === 'setRest') ? 'REST' : i.exercise || (i.kind === 'forTime' ? 'FOR TIME' : 'WORK');
    R_.nm = h('div', { class: 'nm', dir: 'auto' }, name); R_.tm = h('div', { class: 'tm', style: { fontWeight: faceWeight(i) } }); R_.st = h('div', { class: 'st' }, stateLabel(i));
    R_.wrap.className = `ringwrap${i.kind === 'rest' || i.kind === 'setRest' ? ' rest' : ''}`;
    R_.wrap.replaceChildren(ui.ring.svg, h('div', { class: 'face' }, R_.nm, R_.tm, R_.st));
    const n = e.next; R_.next.textContent = n ? `Up next: ${n.kind === 'rest' || n.kind === 'setRest' ? 'rest' : n.kind === 'prepare' ? 'get ready' : n.exercise || (n.blockType || 'work').toLowerCase()}` : 'Final interval';
    const total = e.plan.length, cnt = Math.min(total, 12);
    R_.segs.replaceChildren(...Array.from({ length: cnt }, (_, j) => { const idx = total <= cnt ? j : Math.min(total - 1, Math.floor(j * total / cnt)); return h('i', { class: idx < e.index ? 'done' : idx === e.index ? 'cur' : '' }); }));
    R_.pause.replaceChildren(icon(e.paused ? 'play' : 'pause')); R_.pause.setAttribute('aria-label', e.paused ? 'Resume' : 'Pause');
    R_.sound.replaceChildren(icon(e.sound ? 'speaker' : 'speakerOff')); R_.sound.setAttribute('aria-label', e.sound ? 'Mute sound' : 'Unmute sound');
    R_.finish.style.display = i.kind === 'forTime' ? '' : 'none';
    ui.frame();
  };
  ui.frame = () => {
    const i = e.current, s = e.snapshot();
    ui.ring?.setProgress(s.progress);
    R_.tm.textContent = i.kind === 'forTime' ? clock(s.elapsed) : clock(Math.ceil(s.remaining - 1e-9));
    R_.tm.setAttribute('aria-label', `${R_.nm.textContent}, ${R_.tm.textContent} ${i.kind === 'forTime' ? 'elapsed' : 'remaining'}`);
    R_.elapsed.textContent = `Elapsed ${clock(Math.max(0, s.position - e.prepareDuration))}`;
    R_.remaining.textContent = `Remaining ${clock(Math.max(0, e.total - s.position))}`;
  };
  S.timerUI = ui; ui.refresh();
  return root_;
}

let frameHandle = 0;
function startFrameLoop(ui) {
  cancelAnimationFrame(frameHandle);
  const loop = () => { if (S.timerUI !== ui || !S.engine || S.engine.finished) return; if (!S.engine.paused) ui.frame(); frameHandle = requestAnimationFrame(loop); };
  frameHandle = requestAnimationFrame(loop);
}

function completionScreen() {
  const e = S.engine, r = e.result, accent = COLORS[e.workout.mode];
  const ring = buildRing('smooth'); ring.setProgress(1);
  return h('div', { class: 'screen timer', style: { '--accent': accent } },
    h('div', { class: 'done' },
      h('div', { class: 'ringc' }, ring.svg, h('div', { class: 'ck' }, h('svg', { viewBox: '0 0 24 24', width: 72, height: 72, html: '<path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' }))),
      h('div', { class: 'tiny', style: { color: accent, letterSpacing: '2.4px' } }, r.completedFully ? 'WORKOUT COMPLETE' : 'WORKOUT LOGGED'),
      h('h2', null, e.workout.name),
      h('div', { class: 'stats' }, [['TIME', clock(r.time)], ['MODE', e.workout.mode], ['INTERVALS', String(e.plan.filter((i) => i.kind !== 'prepare').length)]].map(([k, v]) => h('div', { class: 'stat' }, h('b', null, v), h('span', null, k)))),
      h('button', { class: 'btn-solid', id: 'done', style: { background: accent, color: INK[e.workout.mode] }, onClick: () => exitTimer(false) }, 'DONE')));
}

// ───────────────────────── saved ─────────────────────────
function savedScreen() {
  const items = loadWorkouts();
  return h('div', { class: 'screen saved' }, h('div', { class: 'tiny', style: { marginTop: '38px' } }, 'Your collection'), h('h1', null, 'Saved workouts.'),
    h('p', { class: 'sub' }, 'Pick up exactly where your routine begins.'),
    items.length ? items.map((w) => h('div', { class: 'scard', 'data-name': w.name },
      h('h3', null, h('span', { class: 'dot', style: { background: COLORS[w.mode] } }), w.name),
      h('p', null, `${w.mode} · ${w.blocks.length} block${w.blocks.length === 1 ? '' : 's'} · ${clock(workoutDuration(w))}`),
      h('div', { class: 'acts' },
        h('button', { class: 'go', style: { background: COLORS[w.mode], color: INK[w.mode] }, onClick: () => { S.tab = 'timer'; S.mode = w.mode; startWorkout(JSON.parse(JSON.stringify(w))); } }, '▶ Start'),
        h('button', { class: 'ghost', onClick: () => { S.draft = JSON.parse(JSON.stringify(w)); S.mode = w.mode; S.tab = 'timer'; go(() => { S.route = 'builder'; pushRoute('builder'); }); } }, 'Edit'),
        h('button', { class: 'ghost', onClick: async () => { if (await confirmDialog({ title: 'Delete this saved workout?', confirm: 'Delete', danger: true })) { deleteWorkout(w.id); render(); } } }, 'Delete'))))
      : h('div', { class: 'empty' }, 'No workouts saved yet.', h('br'), 'Create a timer and tap Save.'));
}

// ───────────────────────── settings ─────────────────────────
function settingsScreen() {
  const st = S.settings;
  const count = h('p', { class: 'help', id: 'exercise-count', style: { margin: '0 0 10px', fontSize: '14px', color: 'var(--muted)' } }, `${S.lib.list.length} exercises to pick from when you build a workout.`);
  const btn = (txt, ic, id, fn) => h('button', { class: 'btn-outline', id, style: { marginTop: 0 }, onClick: fn }, icon(ic), txt);
  const refresh = () => { count.textContent = `${S.lib.list.length} exercises to pick from when you build a workout.`; };
  const install = installCard();
  return h('div', { class: 'screen settings' },
    h('div', { class: 'topbar' }, h('h2', { style: { fontSize: '22px', margin: 0, letterSpacing: '-.65px' } }, 'Settings')),
    field('Exercise list', count, h('div', { class: 'pair', style: { gap: '10px' } }, btn(' Manage', 'list', 'manage-exercises', () => openManage(refresh)), btn(' Import', 'import', 'import-exercises', () => openImport(refresh))),
      h('p', { class: 'help' }, 'Exercises are spoken in the language they are written in.')),
    field('Cue sound', segmented([['voice', 'Voice'], ['beeps', 'Beeps']], st.cueStyle, (v) => { set({ cueStyle: v }); render(); }, 'cue-style-settings'),
      h('div', { class: 'help' }, st.cueStyle === 'voice' ? 'Spoken countdown and exercise names.' : 'Three short beeps for 3 · 2 · 1, one longer high beep on GO, a lower beep when rest starts.'),
      h('button', { class: 'btn-outline', id: 'play-sample', onClick: () => (st.cueStyle === 'beeps' ? beeper.sample() : speaker.speak([{ text: 'First exercise: Squats', lang: 'en-US' }], st.voiceRate)) }, icon('speaker'), st.cueStyle === 'beeps' ? 'Play sample' : 'Test voice')),
    toggleSwitch('Final 3-second countdown', st.countdown, (v) => set({ countdown: v })),
    toggleSwitch('Announce upcoming exercise during rest', st.announceNext, (v) => set({ announceNext: v })),
    toggleSwitch('Vibration at interval changes', st.haptics, (v) => set({ haptics: v })),
    numberField('Preparation countdown', st.prepDuration, { min: 0, max: 60, step: 5, unit: 'seconds', onChange: (v) => set({ prepDuration: v }) }),
    install,
    field('Support Pulse', h('p', { class: 'help', style: { margin: '0 0 10px', fontSize: '14px', color: 'var(--muted)' } }, 'Pulse is free, with no ads and no account. If it helps your training, you can buy me a coffee.'),
      h('a', { class: 'coffee-btn', id: 'buy-coffee', href: 'https://buymeacoffee.com/eden6454o', target: '_blank', rel: 'noopener noreferrer' }, '☕ Buy me a coffee')),
    h('p', { class: 'help muted', style: { fontSize: '12px', lineHeight: 1.6, marginTop: '10px' } },
      'Keep the screen on while training: Pulse asks your phone to stay awake during a workout. Voices come from your phone, so install a voice for any language you use (Android: Settings → System → Languages → Text-to-speech).'));
}

function installCard() {
  const note = standalone() ? 'Installed ✓ — you are running Pulse as an app.'
    : S.installPrompt ? 'Install Pulse on your home screen to use it like an app, even offline.'
    : /iphone|ipad/i.test(navigator.userAgent) ? 'Safari: tap Share, then “Add to Home Screen”.' : 'Chrome menu ⋮ → “Install app” (or “Add to Home screen”).';
  return field('Install as an app', h('p', { class: 'help', style: { margin: '0 0 10px', fontSize: '14px', color: 'var(--muted)' } }, note),
    S.installPrompt && !standalone() && h('button', { class: 'primary', id: 'install-app', style: { marginTop: 0 }, onClick: async () => { const p = S.installPrompt; S.installPrompt = null; p.prompt(); await p.userChoice.catch(() => {}); render(); } }, 'Install Pulse'));
}

// ───────────────────────── PWA + lifecycle ─────────────────────────
window.addEventListener('beforeinstallprompt', (ev) => { ev.preventDefault(); S.installPrompt = ev; if (S.tab === 'settings') render(); });
window.addEventListener('appinstalled', () => { S.installPrompt = null; toast('Pulse installed'); if (S.tab === 'settings') render(); });

// Android back button: close a modal first; then step back through builder / timer.
window.addEventListener('popstate', () => {
  if (popSuppressed()) return;
  if (closeTopModal(true)) return;
  const top = S.hist.pop(); // the browser already stepped back
  if (top === 'timer') {
    if (S.engine && !S.engine.finished) { pushRoute('timer'); exitTimer(); } else exitTimer(false, true);
  } else if (top === 'builder') go(() => { S.route = 'home'; });
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

window.__pulse = { S, render }; // handy for tests/debugging
history.replaceState({ r: 'home' }, '');
render(true);
