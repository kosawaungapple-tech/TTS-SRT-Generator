import React, { useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { getSoundPrefs, setSoundPrefs, playUiSound } from '../utils/uiSound';

export const SoundSettingsCard: React.FC<{ isMm: boolean }> = ({ isMm }) => {
  const [p, setP] = useState(getSoundPrefs());
  const update = (patch: Partial<typeof p>) => { setSoundPrefs(patch); setP(getSoundPrefs()); };
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 mb-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[13px] font-extrabold text-white flex items-center gap-2">{p.enabled ? <Volume2 size={15} /> : <VolumeX size={15} />}{isMm ? 'အသံများ' : 'Sounds'}</div>
          <div className="text-[11.5px] text-slate-500 mt-0.5">{isMm ? 'ခလုတ်နှိပ်သံ၊ အောင်မြင်/မအောင်မြင်သံ၊ အလုပ်ပြီးသံ' : 'Button clicks, success / error tones and a chime when a job finishes'}</div>
        </div>
        <label className="shrink-0 flex items-center gap-2 text-[12px] text-slate-200 cursor-pointer">
          <input type="checkbox" checked={p.enabled} onChange={e => { update({ enabled: e.target.checked }); if (e.target.checked) playUiSound('success'); }} className="accent-amber-400 w-4 h-4" />
          {isMm ? 'ဖွင့်မည်' : 'On'}
        </label>
      </div>
      {p.enabled && (
        <div className="mt-3 space-y-2.5">
          <label className="flex items-center gap-2.5 text-[12px] text-slate-300 cursor-pointer">
            <input type="checkbox" checked={p.clicks} onChange={e => update({ clicks: e.target.checked })} className="accent-amber-400 w-4 h-4" />
            {isMm ? 'ခလုတ်နှိပ်သံ' : 'Click sounds'}
          </label>
          <div className="flex items-center gap-3 text-[12px] text-slate-300">
            <span className="shrink-0">{isMm ? 'အသံအတိုးအကျယ်' : 'Volume'}</span>
            <input type="range" min={0} max={100} value={Math.round(p.volume * 100)} onChange={e => update({ volume: Number(e.target.value) / 100 })} onMouseUp={() => playUiSound('success')} onTouchEnd={() => playUiSound('success')} className="flex-1 accent-amber-400" />
          </div>
          <div className="flex flex-wrap gap-2">
            {(['success', 'done', 'error', 'notify'] as const).map(n => (
              <button key={n} type="button" onClick={() => playUiSound(n)} className="h-8 px-3 rounded-lg bg-white/10 hover:bg-white/15 text-[11.5px] font-bold text-white">▶ {n}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
