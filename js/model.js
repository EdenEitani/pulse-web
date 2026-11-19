// Workout model + plan compiler (port of the iPhone app's Workout.swift; durations come from one place).

export const MODES = ['AMRAP', 'FOR TIME', 'EMOM', 'TABATA', 'MIX'];
export const BLOCK_TYPES = ['AMRAP', 'FOR TIME', 'EMOM', 'TABATA', 'REST'];

export const COLORS = {
  'AMRAP': '#D66F93', 'FOR TIME': '#91DDED', 'EMOM': '#EDC881', 'TABATA': '#A4A0EE',
  'MIX': '#A1E5D5', 'REST': '#6CE4CF', 'PREPARE': '#A0C0D2',
};
export const INK = {
  'AMRAP': '#170B15', 'FOR TIME': '#08151A', 'EMOM': '#211707', 'TABATA': '#111024', 'MIX': '#09201B', 'REST': '#09201B',
};
export const TAGLINES = {
  'AMRAP': 'AS MANY ROUNDS AS POSSIBLE', 'FOR TIME': 'RACE AGAINST THE CLOCK', 'EMOM': 'EVERY MINUTE ON THE MINUTE',
  'TABATA': 'INTERVAL TRAINING', 'MIX': 'BUILD YOUR OWN FLOW', 'REST': 'RECOVERY',
};

export const uid = () => (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);

export function makeBlock(type) {
  const b = { id: uid(), type, work: 60, rest: 0, rounds: 1, sets: 1, setRest: 0, exercises: [] };
  switch (type) {
    case 'AMRAP': case 'FOR TIME': b.work = 600; break;
    case 'EMOM': b.work = 60; b.rounds = 10; break;
    case 'TABATA': b.work = 20; b.rest = 10; b.rounds = 8; b.setRest = 60; break;
    case 'REST': b.work = 60; break;
  }
  return b; // new timers start without exercises; the user picks their own
}

export function draftFor(mode) {
  const blocks = mode === 'MIX' ? [makeBlock('TABATA'), makeBlock('EMOM')] : [makeBlock(mode)];
  return { id: uid(), name: mode === 'MIX' ? 'My mixed workout' : `My ${mode.toLowerCase()} workout`, mode, blocks, updatedAt: Date.now() };
}

/** Intervals for one block. Zero-length intervals are dropped. */
export function blockIntervals(b, blockIndex = 0) {
  const out = [];
  const put = (kind, seconds, exercise, round, rounds, set, sets) => {
    if (!(seconds > 0)) return;
    out.push({ kind, duration: seconds, exercise, round, rounds, set, sets, blockIndex, blockType: b.type });
  };
  const ex = (i) => (b.exercises.length ? b.exercises[i % b.exercises.length] : '');
  switch (b.type) {
    case 'TABATA': {
      let k = 0;
      for (let s = 1; s <= Math.max(1, b.sets); s++) {
        for (let r = 1; r <= Math.max(1, b.rounds); r++) {
          put('work', b.work, ex(k), r, b.rounds, s, b.sets);
          if (r < b.rounds) put('rest', b.rest, '', r, b.rounds, s, b.sets);
          k++;
        }
        if (s < b.sets) put('setRest', b.setRest, '', s, b.sets, s, b.sets);
      }
      break;
    }
    case 'EMOM':
      for (let r = 1; r <= Math.max(1, b.rounds); r++) put('work', b.work, ex(r - 1), r, b.rounds, 1, 1);
      break;
    case 'REST': put('rest', b.work, '', 1, 1, 1, 1); break;
    case 'AMRAP': put('work', b.work, b.exercises[0] || '', 1, 1, 1, 1); break;
    case 'FOR TIME': put('forTime', b.work, b.exercises[0] || '', 1, 1, 1, 1); break;
  }
  return out;
}

export function compile(workout, prepare = 0) {
  const plan = [];
  if (prepare > 0) plan.push({ kind: 'prepare', duration: prepare, exercise: '', round: 0, rounds: 0, set: 0, sets: 0, blockIndex: 0, blockType: null });
  workout.blocks.forEach((b, i) => plan.push(...blockIntervals(b, i)));
  return plan;
}

export const blockDuration = (b) => blockIntervals(b).reduce((n, i) => n + i.duration, 0);
export const workoutDuration = (w) => w.blocks.reduce((n, b) => n + blockDuration(b), 0);

export function summary(b) {
  switch (b.type) {
    case 'REST': return `${clock(b.work)} rest`;
    case 'AMRAP': return `${clock(b.work)} timer`;
    case 'FOR TIME': return `${clock(b.work)} time cap`;
    case 'EMOM': return `${clock(b.work)} × ${b.rounds} intervals`;
    default: return `${b.work}s work / ${b.rest}s rest × ${b.rounds} rounds × ${b.sets} set${b.sets === 1 ? '' : 's'}`;
  }
}

/** mm:ss, or h:mm:ss from one hour up. */
export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const p = (n) => String(n).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}` : `${p(Math.floor(s / 60))}:${p(s % 60)}`;
}

/** Interval state label shown under the digits. */
export function stateLabel(i) {
  return { prepare: 'GET READY', work: 'WORK', rest: 'REST', setRest: 'SET REST', forTime: 'COUNT UP' }[i.kind];
}
export function accentFor(i) {
  if (i.kind === 'rest' || i.kind === 'setRest') return COLORS.REST;
  if (i.kind === 'prepare' || !i.blockType) return COLORS.PREPARE;
  return COLORS[i.blockType];
}

/** Next multiple of `step` in a direction, clamped (22 → 25 up, 20 down). */
export function stepped(value, dir, step, min, max) {
  const s = Math.max(1, step);
  const target = dir > 0 ? (Math.floor(value / s) + 1) * s : (value % s === 0 ? value - s : Math.floor(value / s) * s);
  return Math.min(max, Math.max(min, target));
}
