import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { loadUserFonts, FONTS_EVENT, type UserFont } from '../utils/userFonts';
import { newTextLayer, TITLE_LOOKS, type TextLayer } from '../utils/recapTextLayers';

interface Props {
  layers: TextLayer[];
  onChange: (l: TextLayer[]) => void;
  duration: number;
  isMm: boolean;
}

/** Titles / captions / stickers-as-text shown over the recap between two moments. */
export const TextLayersEditor: React.FC<Props> = ({ layers, onChange, duration, isMm }) => {
  const set = (id: number, p: Partial<TextLayer>) => onChange(layers.map(l => (l.id === id ? { ...l, ...p } : l)));
  const add = () => {
    const id = layers.reduce((m, l) => Math.max(m, l.id), 0) + 1;
    onChange([...layers, newTextLayer(id, 0, Math.min(3, Math.max(1, duration)))]);
  };
  const [fonts, setFonts] = useState<UserFont[]>([]);
  useEffect(() => {
    const refresh = () => { void loadUserFonts().then(setFonts); };
    refresh();
    window.addEventListener(FONTS_EVENT, refresh);
    return () => window.removeEventListener(FONTS_EVENT, refresh);
  }, []);
  const inp = 'w-full bg-slate-900 border border-white/10 rounded-lg px-2 py-1.5 text-[11px] text-white';
  const max = Math.max(1, Math.floor(duration));
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[12px] font-bold text-slate-200">{isMm ? 'စာသား ထည့်ရန် (ခေါင်းစဉ် / စာတန်း)' : 'Text on the video (titles / captions)'}</div>
        <button type="button" onClick={add} disabled={layers.length >= 12} className="px-2.5 py-1 rounded-lg bg-white/10 border border-white/10 text-white text-[11px] font-bold flex items-center gap-1 disabled:opacity-40">
          <Plus size={12} />{isMm ? 'ထည့်မည်' : 'Add'}
        </button>
      </div>
      {layers.length === 0 && (
        <p className="text-[10px] text-slate-500">{isMm ? 'ဗီဒီယိုပေါ် အချိန်သတ်မှတ်ပြီး ပေါ်စေချင်တဲ့ စာသား (ဥပမာ intro ခေါင်းစဉ်၊ ကြော်ငြာစာ) ထည့်လို့ရပါတယ်။' : 'Add text that shows over the video for a chosen time (an intro title, a call to action…).'}</p>
      )}
      <div className="space-y-2">
        {layers.map(l => (
          <div key={l.id} className="p-2.5 rounded-xl border border-white/10 bg-white/5 space-y-2">
            <div className="flex gap-2">
              <input className={inp} value={l.text} onChange={e => set(l.id, { text: e.target.value })} placeholder={isMm ? 'စာသား' : 'Text'} />
              <button type="button" onClick={() => onChange(layers.filter(x => x.id !== l.id))} className="p-2 rounded-lg bg-red-400/15 text-red-300"><Trash2 size={13} /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] text-slate-400">{isMm ? 'စတင်ချိန် (စက္ကန့်)' : 'Start (s)'}
                <input type="number" className={inp} min={0} max={max} step={0.5} value={l.start} onChange={e => set(l.id, { start: Math.max(0, Math.min(Number(e.target.value), l.end - 0.5)) })} />
              </label>
              <label className="text-[10px] text-slate-400">{isMm ? 'ပြီးချိန် (စက္ကန့်)' : 'End (s)'}
                <input type="number" className={inp} min={0} max={max} step={0.5} value={l.end} onChange={e => set(l.id, { end: Math.max(l.start + 0.5, Math.min(Number(e.target.value), duration || 9999)) })} />
              </label>
              <label className="text-[10px] text-slate-400">{isMm ? 'ဘယ်-ညာ %' : 'Left-right %'}
                <input type="range" className="w-full accent-amber-400" min={5} max={95} value={l.x} onChange={e => set(l.id, { x: Number(e.target.value) })} />
              </label>
              <label className="text-[10px] text-slate-400">{isMm ? 'အပေါ်-အောက် %' : 'Up-down %'}
                <input type="range" className="w-full accent-amber-400" min={4} max={96} value={l.y} onChange={e => set(l.id, { y: Number(e.target.value) })} />
              </label>
              <label className="text-[10px] text-slate-400">{isMm ? 'အရွယ်အစား' : 'Size'}
                <input type="range" className="w-full accent-amber-400" min={2} max={14} step={0.5} value={l.size} onChange={e => set(l.id, { size: Number(e.target.value) })} />
              </label>
              <label className="text-[10px] text-slate-400">{isMm ? 'ပေါ်လာပုံ' : 'Animation'}
                <select className={inp} value={l.anim || 'none'} onChange={e => set(l.id, { anim: e.target.value as TextLayer['anim'] })}>
                  <option value="none">{isMm ? 'ချက်ချင်းပေါ်' : 'None'}</option>
                  <option value="fade">Fade</option>
                  <option value="slide">{isMm ? 'အောက်ကနေ တက်လာ' : 'Slide up + fade'}</option>
                </select>
              </label>
              {fonts.length > 0 && (
                <label className="col-span-full text-[10px] text-slate-400">{isMm ? 'ဖောင့်' : 'Font'}
                  <select className={inp} value={l.font || ''} onChange={e => set(l.id, { font: e.target.value || undefined })}>
                    <option value="">Noto Sans Myanmar</option>
                    {fonts.map(f => <option key={f.id} value={f.family}>{f.name}</option>)}
                  </select>
                </label>
              )}
              <div className="col-span-full flex flex-wrap gap-1.5">
                {(['plain', 'plate', 'news', 'banner', 'sticker'] as const).map(k => (
                  <button key={k} type="button" onClick={() => set(l.id, { look: k })} className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold transition ${(l.look || 'plain') === k ? 'border-emerald-400 bg-emerald-400/10 text-white' : 'border-white/10 bg-white/[0.04] text-slate-300'}`}>
                    {k === 'plain' ? (isMm ? 'ရိုးရိုး' : 'Plain') : TITLE_LOOKS[k].label[isMm ? 'mm' : 'en']}
                  </button>
                ))}
              </div>
              <div className="flex items-end gap-3 text-[10px] text-slate-300">
                <input type="color" value={l.color} onChange={e => set(l.id, { color: e.target.value })} className="w-7 h-7 rounded bg-transparent" />
                <label className="flex items-center gap-1"><input type="checkbox" checked={l.stroke} onChange={e => set(l.id, { stroke: e.target.checked })} />{isMm ? 'အနား' : 'Outline'}</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={l.box} onChange={e => set(l.id, { box: e.target.checked })} />{isMm ? 'ဘောက်စ်' : 'Box'}</label>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
