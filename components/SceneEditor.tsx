import React, { useRef, useState } from 'react';
import { ArrowUp, ArrowDown, Play, Pause, RotateCcw, Check } from 'lucide-react';

export interface ScenePlanItem { idx: number; on: boolean; start: number; end: number; /** 0 = fit to the narration */ speed: number }

interface Props {
  base: { start: number; end: number; text: string; speed?: number }[];
  srcUrl: string | null;
  videoDuration: number;
  isMm: boolean;
  onApply: (plan: ScenePlanItem[]) => void;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

/** Before rendering: skip scenes, re-order them, and change which part of the footage each scene shows. */
export const SceneEditor: React.FC<Props> = ({ base, srcUrl, videoDuration, isMm, onApply }) => {
  const fresh = () => base.map((s, i) => ({ idx: i, on: true, start: s.start, end: s.end, speed: s.speed || 0 }));
  const [plan, setPlan] = useState<ScenePlanItem[]>(fresh);
  const [playing, setPlaying] = useState<number | null>(null);
  const vids = useRef<Record<number, HTMLVideoElement | null>>({});
  const max = videoDuration > 0 ? videoDuration : Math.max(...base.map(b => b.end), 1);

  const patch = (pos: number, p: Partial<ScenePlanItem>) => setPlan(pl => pl.map((x, i) => (i === pos ? { ...x, ...p } : x)));
  const move = (pos: number, d: number) => setPlan(pl => {
    const j = pos + d;
    if (j < 0 || j >= pl.length) return pl;
    const c = [...pl];
    [c[pos], c[j]] = [c[j], c[pos]];
    return c;
  });
  const setStart = (pos: number, v: number) => patch(pos, { start: Math.max(0, Math.min(v, plan[pos].end - 0.5)) });
  const setEnd = (pos: number, v: number) => patch(pos, { end: Math.min(max, Math.max(v, plan[pos].start + 0.5)) });

  const toggleRange = (pos: number) => {
    const el = vids.current[plan[pos].idx];
    if (!el) return;
    if (playing === plan[pos].idx) { el.pause(); setPlaying(null); return; }
    (Object.values(vids.current) as (HTMLVideoElement | null)[]).forEach(v => v?.pause());
    el.currentTime = plan[pos].start;
    const stop = () => { if (el.currentTime >= plan[pos].end) { el.pause(); el.removeEventListener('timeupdate', stop); setPlaying(null); } };
    el.addEventListener('timeupdate', stop);
    void el.play();
    setPlaying(plan[pos].idx);
  };

  const num = 'w-20 bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white font-mono';
  const kept = plan.filter(p => p.on).length;
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[12px] font-bold text-slate-200">{isMm ? 'Render မလုပ်ခင် Scene တွေ ပြင်ရန်' : 'Edit scenes before rendering'}</div>
        <span className="text-[10px] text-slate-500">{kept}/{plan.length}</span>
      </div>
      <p className="text-[10px] text-slate-500 leading-relaxed mb-3">
        {isMm
          ? 'မလိုတဲ့ scene ကို ဖြုတ်၊ အစီအစဉ်ပြောင်း၊ scene တစ်ခုချင်းမှာ ပြမယ့် ဗီဒီယိုအပိုင်း (စ/ဆုံး စက္ကန့်) ကို ချိန်လို့ရပါတယ်။ ပြီးရင် "အသုံးပြုမည်" ကို နှိပ်ပါ — Preview၊ SRT နဲ့ Render အားလုံး ပြင်ထားတဲ့အတိုင်း ဖြစ်သွားပါမယ်။'
          : 'Drop scenes you do not need, re-order them, and choose which part of the footage (start/end seconds) each scene shows. Press Apply — the preview, SRT and render all follow your edits.'}
      </p>
      <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
        {plan.map((p, pos) => (
          <div key={p.idx} className={`flex gap-2 p-2 rounded-xl border ${p.on ? 'border-white/10 bg-white/5' : 'border-white/5 bg-black/20 opacity-50'}`}>
            <div className="relative w-24 shrink-0">
              {srcUrl && (
                <video
                  ref={el => { vids.current[p.idx] = el; }}
                  src={`${srcUrl}#t=${p.start.toFixed(1)}`}
                  preload="metadata"
                  muted
                  playsInline
                  className="w-24 h-16 object-cover rounded-lg bg-black"
                />
              )}
              <button type="button" onClick={() => toggleRange(pos)} className="absolute inset-0 m-auto w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center">
                {playing === p.idx ? <Pause size={12} /> : <Play size={12} />}
              </button>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-slate-300 line-clamp-2">{pos + 1}. {base[p.idx].text}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <label className="text-[10px] text-slate-400 flex items-center gap-1">{isMm ? 'စ' : 'from'}
                  <input type="number" step={0.5} min={0} max={max} value={Number(p.start.toFixed(1))} onChange={e => setStart(pos, Number(e.target.value))} className={num} />
                </label>
                <label className="text-[10px] text-slate-400 flex items-center gap-1">{isMm ? 'ဆုံး' : 'to'}
                  <input type="number" step={0.5} min={0} max={max} value={Number(p.end.toFixed(1))} onChange={e => setEnd(pos, Number(e.target.value))} className={num} />
                </label>
                <label className="text-[10px] text-slate-400 flex items-center gap-1">{isMm ? 'အမြန်နှုန်း' : 'speed'}
                  <select value={p.speed} onChange={e => patch(pos, { speed: Number(e.target.value) })} className="bg-slate-900 border border-white/10 rounded-lg px-1.5 py-1 text-[11px] text-white">
                    <option value={0}>{isMm ? 'အလိုအလျောက်' : 'Auto'}</option>
                    <option value={0.5}>0.5x ({isMm ? 'Slow-mo' : 'slow-mo'})</option>
                    <option value={0.75}>0.75x</option>
                    <option value={1}>1x</option>
                    <option value={1.5}>1.5x</option>
                    <option value={2}>2x</option>
                  </select>
                </label>
                <span className="text-[10px] text-slate-500">{fmt(p.start)}–{fmt(p.end)}</span>
              </div>
            </div>
            <div className="flex flex-col items-center gap-1 shrink-0">
              <button type="button" onClick={() => move(pos, -1)} disabled={pos === 0} className="p-1 rounded-md bg-white/10 text-white disabled:opacity-30"><ArrowUp size={12} /></button>
              <button type="button" onClick={() => move(pos, 1)} disabled={pos === plan.length - 1} className="p-1 rounded-md bg-white/10 text-white disabled:opacity-30"><ArrowDown size={12} /></button>
              <button type="button" onClick={() => patch(pos, { on: !p.on })} className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${p.on ? 'bg-emerald-400/20 text-emerald-300' : 'bg-red-400/20 text-red-300'}`}>{p.on ? (isMm ? 'ပါ' : 'in') : (isMm ? 'ဖြုတ်' : 'out')}</button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => { setPlan(fresh()); setPlaying(null); }} className="h-10 rounded-xl bg-white/10 border border-white/10 text-white text-[12px] font-bold flex items-center justify-center gap-1.5">
          <RotateCcw size={13} />{isMm ? 'မူလအတိုင်း' : 'Reset'}
        </button>
        <button type="button" onClick={() => onApply(plan)} className="h-10 rounded-xl bg-amber-400 text-black text-[12px] font-extrabold flex items-center justify-center gap-1.5">
          <Check size={13} />{isMm ? 'အသုံးပြုမည်' : 'Apply'}
        </button>
      </div>
    </div>
  );
};
