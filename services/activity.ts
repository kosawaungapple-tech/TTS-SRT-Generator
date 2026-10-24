import { useEffect, useRef } from 'react';

// Tiny global "what is the app doing right now" store, shown by <ActivityPill/>.
// Never put API keys here: log() masks anything that looks like one.

export interface ActivityLog { t: number; text: string }
export interface ActivityTask {
  id: string;
  label: string;
  detail?: string;
  percent?: number;
  status: 'running' | 'done' | 'error';
  startedAt: number;
  endedAt?: number;
  logs: ActivityLog[];
}

const KEY_LIKE = /(AIza[0-9A-Za-z_\-]{20,}|gsk_[0-9A-Za-z]{20,}|sk-[0-9A-Za-z\-_]{20,}|[0-9a-f]{32})/g;
const clean = (s: string) => String(s).replace(KEY_LIKE, '••••');

let tasks: ActivityTask[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
let seq = 0;

export const activity = {
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  getTasks: () => tasks,
  start(label: string): string {
    const id = `t${++seq}`;
    tasks = [...tasks.filter(t => t.status === 'running'), { id, label: clean(label), status: 'running', startedAt: Date.now(), logs: [{ t: Date.now(), text: clean(label) }] }];
    emit();
    return id;
  },
  update(id: string, p: { detail?: string; percent?: number; label?: string }) {
    tasks = tasks.map(t => {
      if (t.id !== id) return t;
      const detail = p.detail !== undefined ? clean(p.detail) : t.detail;
      const logs = detail && detail !== t.detail ? [...t.logs, { t: Date.now(), text: detail }].slice(-60) : t.logs;
      return { ...t, label: p.label ? clean(p.label) : t.label, detail, percent: p.percent ?? t.percent, logs };
    });
    emit();
  },
  finish(id: string) { activity.end(id, 'done'); },
  fail(id: string, text: string) {
    tasks = tasks.map(t => (t.id === id ? { ...t, logs: [...t.logs, { t: Date.now(), text: clean(text) }].slice(-60), detail: clean(text) } : t));
    activity.end(id, 'error');
  },
  end(id: string, status: 'done' | 'error') {
    tasks = tasks.map(t => (t.id === id ? { ...t, status, percent: status === 'done' ? 100 : t.percent, endedAt: Date.now() } : t));
    emit();
    if (status === 'done') setTimeout(() => activity.dismiss(id), 3500);
  },
  dismiss(id: string) { tasks = tasks.filter(t => t.id !== id); emit(); },
};

/** Show a task in the activity pill while `active` is true. */
export function useActivity(active: boolean, label: string, opts: { detail?: string; percent?: number; failed?: string | null } = {}) {
  const idRef = useRef<string | null>(null);
  const latest = useRef(opts);
  latest.current = opts;
  useEffect(() => {
    if (active && !idRef.current) {
      idRef.current = activity.start(label);
    } else if (!active && idRef.current) {
      const f = latest.current.failed;
      if (f) activity.fail(idRef.current, f); else activity.finish(idRef.current);
      idRef.current = null;
    }
  }, [active]);
  useEffect(() => {
    if (active && idRef.current) activity.update(idRef.current, { detail: opts.detail, percent: opts.percent });
  }, [active, opts.detail, opts.percent]);
}
