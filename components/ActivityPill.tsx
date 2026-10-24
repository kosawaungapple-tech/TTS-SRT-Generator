import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Loader2, CheckCircle2, AlertCircle, ChevronUp, X } from 'lucide-react';
import { activity } from '../services/activity';

const fmt = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export const ActivityPill: React.FC<{ mm?: boolean }> = ({ mm }) => {
  const tasks = useSyncExternalStore(activity.subscribe, activity.getTasks, activity.getTasks);
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(i); }, []);
  const task = tasks[tasks.length - 1];
  if (!task) return null;
  const running = task.status === 'running';
  const err = task.status === 'error';
  const elapsed = (task.endedAt ?? Date.now()) - task.startedAt;

  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-24 z-40 w-[calc(100%-32px)] max-w-md">
      <div className={`rounded-2xl border backdrop-blur-xl shadow-2xl overflow-hidden ${err ? 'bg-red-950/80 border-red-500/30' : 'bg-black/80 border-white/10'}`}>
        <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
          {running ? <Loader2 size={18} className="animate-spin text-amber-400 shrink-0" /> : err ? <AlertCircle size={18} className="text-red-400 shrink-0" /> : <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-white truncate">
              {running ? task.label : err ? (mm ? 'အမှားဖြစ်သွားသည်' : 'Something went wrong') : (mm ? 'ပြီးပါပြီ' : 'Done')}
            </p>
            {task.detail && task.detail !== task.label && <p className="text-[11px] text-slate-400 truncate">{task.detail}</p>}
          </div>
          <span className="text-[11px] font-mono text-slate-400 shrink-0">{fmt(elapsed)}</span>
          <ChevronUp size={16} className={`text-slate-500 shrink-0 transition-transform ${open ? '' : 'rotate-180'}`} />
          {!running && (
            <span role="button" onClick={e => { e.stopPropagation(); activity.dismiss(task.id); }} className="p-1 text-slate-500 hover:text-white"><X size={14} /></span>
          )}
        </button>
        {running && typeof task.percent === 'number' && (
          <div className="h-1 bg-white/10"><div className="h-full bg-gradient-to-r from-amber-300 to-orange-500 transition-all duration-500" style={{ width: `${Math.min(100, task.percent)}%` }} /></div>
        )}
        {open && (
          <div className="max-h-48 overflow-y-auto border-t border-white/10 px-4 py-2 space-y-1">
            {task.logs.slice().reverse().map((l, i) => (
              <p key={i} className="text-[11px] text-slate-300 leading-snug"><span className="text-slate-600 font-mono mr-2">{fmt(l.t - task.startedAt)}</span>{l.text}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
