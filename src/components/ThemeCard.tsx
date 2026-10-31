import React, { useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { getThemeChoice, setThemeChoice, type ThemeChoice } from '../utils/theme';

export const ThemeCard: React.FC<{ isMm: boolean }> = ({ isMm }) => {
  const [c, setC] = useState<ThemeChoice>(getThemeChoice());
  const opts: { id: ThemeChoice; icon: React.ReactNode; label: string }[] = [
    { id: 'light', icon: <Sun size={15} />, label: isMm ? 'အလင်း' : 'Light' },
    { id: 'dark', icon: <Moon size={15} />, label: isMm ? 'အမှောင်' : 'Dark' },
    { id: 'system', icon: <Monitor size={15} />, label: isMm ? 'စက်အတိုင်း' : 'System' },
  ];
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 mb-4">
      <div className="text-[13px] font-extrabold text-white mb-2.5">{isMm ? 'အရောင်ဘက် (Theme)' : 'Theme'}</div>
      <div className="grid grid-cols-3 gap-2">
        {opts.map(o => (
          <button key={o.id} type="button" onClick={() => { setThemeChoice(o.id); setC(o.id); }}
            className={`h-10 rounded-xl text-[12.5px] font-bold flex items-center justify-center gap-1.5 border transition ${c === o.id ? 'bg-amber-400 text-black border-amber-400' : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'}`}>
            {o.icon}{o.label}
          </button>
        ))}
      </div>
    </div>
  );
};
