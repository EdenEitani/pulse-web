// Small DOM toolkit: element builder, icons, modals (Android back button closes them), toasts, form widgets.
import { stepped } from './model.js';

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') { for (const [p, val] of Object.entries(v)) { if (val === '' || val == null) continue; if (p.startsWith('--')) el.style.setProperty(p, val); else el.style[p] = val; } }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value' || k === 'checked' || k === 'disabled') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) { if (kid == null || kid === false) continue; el.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
  return el;
}

/** replaceChildren that flattens arrays and skips null/false (the native one would print them as text). */
export function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  return el;
}

const P = {
  back: '<path d="M15 5l-7 7 7 7"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 00-2-1.2L14 3h-4l-.5 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 002 1.2L10 21h4l.5-2.6a7 7 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/>',
  timer: '<circle cx="12" cy="13" r="7.5"/><path d="M12 13l3-3.5M10 3h4"/>', list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>', plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  pencil: '<path d="M4 20l4-1 11-11-3-3L5 16l-1 4z"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
  up: '<path d="M6 14l6-6 6 6"/>', down: '<path d="M6 10l6 6 6-6"/>', undo: '<path d="M9 7L4 12l5 5M4 12h10a6 6 0 010 8"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>', import: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>', check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  stack: '<rect x="6" y="9" width="12" height="11" rx="2"/><path d="M9 6h6M10 3.5h4"/>', speaker: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12"/>',
  speakerOff: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/>',
};
const SOLID = {
  play: '<path d="M8 5v14l11-7z"/>', pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
  prev: '<path d="M6 5h2.5v14H6zM20 5v14L9.5 12z"/>', next: '<path d="M15.5 5H18v14h-2.5zM4 5l10.5 7L4 19z"/>',
};
export function icon(name, cls = '') {
  const solid = SOLID[name];
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', `ico${solid ? ' fill' : ''} ${cls}`.trim()); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = solid || P[name] || '';
  return s;
}
export const roundBtn = (name, label, onClick, cls = '') => h('button', { class: `round ${cls}`, 'aria-label': label, onClick }, icon(name));

// ───── modals ─────
const stack = [];
let suppress = 0;
export const suppressNextPop = () => { suppress++; };
export const popSuppressed = () => (suppress > 0 ? (suppress--, true) : false);

export function openModal(build, { dismissable = true } = {}) {
  const overlay = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true' });
  const ctl = { close: (fromPop = false) => closeModal(ctl, fromPop), overlay };
  const sheet = h('div', { class: 'sheet' }); sheet.append(...[].concat(build(ctl)));
  overlay.append(sheet);
  if (dismissable) overlay.addEventListener('click', (e) => { if (e.target === overlay) ctl.close(); });
  document.body.append(overlay);
  stack.push(ctl); history.pushState({ modal: true }, '');
  return ctl;
}
function closeModal(ctl, fromPop) {
  const i = stack.indexOf(ctl); if (i < 0) return;
  stack.splice(i, 1); ctl.overlay.remove();
  if (!fromPop) { suppress++; history.back(); }
  ctl.onClose?.();
}
export function closeTopModal(fromPop = false) { const top = stack[stack.length - 1]; if (!top) return false; closeModal(top, fromPop); return true; }
export const hasModal = () => stack.length > 0;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && stack.length) closeTopModal(); });

export const sheetHeader = (title, ctl) => h('div', { class: 'shead' }, h('h2', null, title), roundBtn('x', 'Close', () => ctl.close()));

export function confirmDialog({ title, message, confirm = 'OK', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    openModal((ctl) => {
      ctl.onClose = () => { if (!answered) resolve(false); };
      return [h('div', { class: 'shead' }, h('h2', null, title)),
        message && h('p', { class: 'muted', style: { margin: '0 0 18px' } }, message),
        h('button', { class: 'primary', style: danger ? { background: '#d66f93', color: '#170b15' } : {}, onClick: () => { answered = true; resolve(true); ctl.close(); } }, confirm),
        h('button', { class: 'ghost', style: { width: '100%', marginTop: '10px', height: '48px' }, onClick: () => ctl.close() }, 'Cancel')];
    });
  });
}

// ───── toast ─────
let toastTimer = 0;
export function toast(message) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast', role: 'status' }, message); document.body.append(el);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.remove(), 2400);
}

// ───── form widgets ─────
export function toggleSwitch(label, checked, onChange, help) {
  const t = h('button', { class: 'toggle', role: 'switch', 'aria-checked': String(!!checked), 'aria-label': label });
  t.addEventListener('click', () => { const v = t.getAttribute('aria-checked') !== 'true'; t.setAttribute('aria-checked', String(v)); onChange(v); });
  return h('div', { class: 'switch' }, h('div', null, label, help && h('small', null, help)), t);
}

export function segmented(options, value, onChange, id) {
  const wrap = h('div', { class: 'seg', role: 'group', id });
  const draw = (v) => wrap.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  for (const [v, text] of options) wrap.append(h('button', { 'data-v': v, 'aria-pressed': String(v === value), onClick: () => { draw(v); onChange(v); } }, text));
  return wrap;
}

export function field(title, ...kids) { return h('div', { class: 'field' }, h('div', { class: 'lab' }, title), ...kids); }

/** Number input with −/+ buttons. `step` > 1 snaps to multiples (22 → 25). */
export function numberField(title, value, { min = 0, max = 999, step = 1, unit = '', onChange }) {
  const input = h('input', { type: 'number', inputmode: 'numeric', value: String(value), 'aria-label': title });
  const set = (n) => { const v = Math.min(max, Math.max(min, Math.round(n))); input.value = String(v); onChange(v); };
  input.addEventListener('change', () => { const n = Number(input.value); set(Number.isFinite(n) ? n : value); });
  return field(title, h('div', { class: 'numrow' }, input, unit && h('span', { class: 'unit' }, unit), h('span', { class: 'sp' }),
    h('button', { class: 'step', 'aria-label': `Decrease ${title}`, onClick: () => set(stepped(Number(input.value) || 0, -1, step, min, max)) }, '−'),
    h('button', { class: 'step', 'aria-label': `Increase ${title}`, onClick: () => set(stepped(Number(input.value) || 0, 1, step, min, max)) }, '+')));
}

/** mm : ss input stored as seconds. */
export function durationField(title, seconds, { maxSeconds = 86400, onChange }) {
  let total = seconds;
  const mm = h('input', { type: 'number', inputmode: 'numeric', value: String(Math.floor(total / 60)), 'aria-label': `${title} minutes` });
  const ss = h('input', { type: 'number', inputmode: 'numeric', value: String(total % 60), 'aria-label': `${title} seconds` });
  const apply = () => { total = Math.min(maxSeconds, Math.max(0, (Math.floor(Number(mm.value)) || 0) * 60 + Math.min(59, Math.max(0, Math.floor(Number(ss.value)) || 0)))); mm.value = String(Math.floor(total / 60)); ss.value = String(total % 60); onChange(total); };
  mm.addEventListener('change', apply); ss.addEventListener('change', apply);
  return field(title, h('div', { class: 'numrow' }, mm, h('span', { class: 'unit' }, 'min'), h('span', { style: { color: 'var(--subtle)', fontWeight: 800 } }, ':'), ss, h('span', { class: 'unit' }, 'sec')));
}
