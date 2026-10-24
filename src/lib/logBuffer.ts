// Server-side ring buffer for driver/pool request logs.
//
// Patches console.* once — any line starting with a known prefix
// ([MuseDriver], [MusePool], [API …], [Responses …], [Launch …]) is also
// teed into an in-memory buffer served by GET /api/logs. The Next.js /
// React noise (un-prefixed) is ignored so the page stays readable.
//
// State lives on globalThis so Next dev module reloads don't split the
// buffer or double-patch console.

export interface LogLine {
  ts: number;
  level: 'log' | 'warn' | 'error';
  text: string;
}

const MAX_LINES = 500;
const CAPTURE = /^\[(Muse|API|Responses|Pool|Keep|Launch|Chat)/;

interface LogState {
  lines: LogLine[];
  patched: boolean;
}

const g = globalThis as any;
if (!g.__museLogState) {
  g.__museLogState = { lines: [], patched: false } satisfies LogState;
}
const state: LogState = g.__museLogState;

function fmt(a: any): string {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return a.stack || a.message;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

export function pushLog(level: LogLine['level'], text: string): void {
  state.lines.push({ ts: Date.now(), level, text });
  if (state.lines.length > MAX_LINES) {
    state.lines.splice(0, state.lines.length - MAX_LINES);
  }
}

export function getLogs(): LogLine[] {
  return state.lines;
}

export function clearLogs(): void {
  state.lines.length = 0;
}

if (!state.patched) {
  state.patched = true;
  (['log', 'info', 'warn', 'error'] as const).forEach((m) => {
    const orig = console[m].bind(console);
    (console as any)[m] = (...args: any[]) => {
      try {
        const text = args.map(fmt).join(' ');
        if (CAPTURE.test(text)) pushLog(m === 'error' ? 'error' : m === 'warn' ? 'warn' : 'log', text);
      } catch {
        /* never break logging */
      }
      orig(...args);
    };
  });
}
