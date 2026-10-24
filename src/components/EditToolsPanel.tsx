import React, { useState } from 'react';
import { ArrowLeft, Layers, Palette, Type, Image as ImageIcon, Volume2, Film, Plus, Trash2 } from 'lucide-react';
import { TextLayersEditor } from './TextLayersEditor';
import type { TextLayer } from '../utils/recapTextLayers';
import {
  FILTERS, FILTER_CSS, TRANSITIONS, newImageOverlay,
  type CardCfg, type ImageOverlay, type RecapFx,
} from '../utils/recapFx';

interface Props {
  fx: RecapFx;
  onFx: (f: RecapFx) => void;
  textLayers: TextLayer[];
  onTextLayers: (l: TextLayer[]) => void;
  overlays: ImageOverlay[];
  onOverlays: (o: ImageOverlay[]) => void;
  duration: number;
  hasBgm: boolean;
  thumb: string | null;
  isMm: boolean;
}

type Tab = 'trans' | 'look' | 'text' | 'cards' | 'audio';

const inp = 'w-full bg-slate-900 border border-white/10 rounded-lg px-2 py-1.5 text-[11px] text-white';

const Chip: React.FC<{ on: boolean; onClick: () => void; children: React.ReactNode }> = ({ on, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={`px-3 py-2 rounded-xl text-[11.5px] font-bold border transition ${on ? 'bg-amber-400 text-black border-amber-400 shadow-md shadow-amber-400/20' : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'}`}
  >
    {children}
  </button>
);

const Slider: React.FC<{ label: string; value: number; min: number; max: number; step: number; show: string; onChange: (v: number) => void }> = ({ label, value, min, max, step, show, onChange }) => (
  <div>
    <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
      <span>{label}</span>
      <span className="px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-300 font-mono font-bold">{show}</span>
    </div>
    <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="w-full accent-amber-400" />
  </div>
);

const CardEditor: React.FC<{ title: string; card: CardCfg; onChange: (c: CardCfg) => void; isMm: boolean }> = ({ title, card, onChange, isMm }) => {
  const set = (p: Partial<CardCfg>) => onChange({ ...card, ...p });
  return (
    <div className={`rounded-2xl border p-3 space-y-2.5 ${card.on ? 'border-amber-400/40 bg-amber-400/[0.05]' : 'border-white/10 bg-white/[0.03]'}`}>
      <label className="flex items-center gap-2 text-[12px] font-bold text-slate-100 cursor-pointer">
        <input type="checkbox" checked={card.on} onChange={e => set({ on: e.target.checked })} className="accent-amber-400 w-4 h-4" />
        {title}
      </label>
      {card.on && (
        <>
          <input className={inp} value={card.title} onChange={e => set({ title: e.target.value })} placeholder={isMm ? 'ခေါင်းစဉ်' : 'Title'} />
          <input className={inp} value={card.sub} onChange={e => set({ sub: e.target.value })} placeholder={isMm ? 'စာကြောင်းငယ် (မထည့်လည်းရ)' : 'Small line (optional)'} />
          <div className="grid grid-cols-3 gap-2 items-end">
            <label className="text-[10px] text-slate-400">{isMm ? 'ကြာချိန် (စက္ကန့်)' : 'Length (s)'}
              <input type="number" className={inp} min={1} max={8} step={0.5} value={card.dur} onChange={e => set({ dur: Math.max(1, Math.min(8, Number(e.target.value) || 2)) })} />
            </label>
            <label className="text-[10px] text-slate-400">{isMm ? 'နောက်ခံ' : 'Background'}
              <input type="color" value={card.bg} onChange={e => set({ bg: e.target.value })} className="block w-full h-8 rounded bg-transparent" />
            </label>
            <label className="text-[10px] text-slate-400">{isMm ? 'စာအရောင်' : 'Text colour'}
              <input type="color" value={card.color} onChange={e => set({ color: e.target.value })} className="block w-full h-8 rounded bg-transparent" />
            </label>
          </div>
        </>
      )}
    </div>
  );
};

/** The recap's edit tools, grouped in tabs: transitions & fades, colour looks, text & stickers, intro/outro cards, audio. */
export const EditToolsPanel: React.FC<Props> = ({ fx, onFx, textLayers, onTextLayers, overlays, onOverlays, duration, hasBgm, thumb, isMm }) => {
  const [tab, setTab] = useState<Tab | null>(null);
  const setF = (p: Partial<RecapFx>) => onFx({ ...fx, ...p });
  const maxT = Math.max(1, Math.floor(duration));
  const patchOv = (id: number, p: Partial<ImageOverlay>) => onOverlays(overlays.map(o => (o.id === id ? { ...o, ...p } : o)));

  const tabs: { id: Tab; icon: React.ReactNode; label: string; dot: boolean }[] = [
    { id: 'trans', icon: <Layers size={14} />, label: isMm ? 'ကူးပြောင်း' : 'Transitions', dot: fx.transition.type !== 'none' },
    { id: 'look', icon: <Palette size={14} />, label: isMm ? 'အရောင်' : 'Filters', dot: fx.filter !== 'none' },
    { id: 'text', icon: <Type size={14} />, label: isMm ? 'စာ/ပုံ' : 'Text & stickers', dot: textLayers.length + overlays.length > 0 },
    { id: 'cards', icon: <Film size={14} />, label: isMm ? 'Intro/Outro' : 'Intro/Outro', dot: fx.intro.on || fx.outro.on },
    { id: 'audio', icon: <Volume2 size={14} />, label: isMm ? 'အသံ' : 'Audio', dot: !fx.duck.on || fx.fadeIn > 0 || fx.fadeOut > 0 },
  ];

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-[13px] font-extrabold text-white mb-3">{isMm ? '✂️ Edit Tools' : '✂️ Edit tools'}</div>
      {tab === null ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {tabs.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="relative text-left rounded-2xl border border-white/10 bg-black/30 hover:bg-white/[0.07] hover:border-amber-400/40 p-3.5 transition"
            >
              <span className="w-9 h-9 rounded-xl bg-white/10 grid place-items-center text-slate-200 mb-2">{t.icon}</span>
              <span className="block text-[12.5px] font-bold text-white leading-tight">{t.label}</span>
              {t.dot && <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-amber-400" />}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setTab(null)} className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-[12px] font-bold flex items-center gap-1.5"><ArrowLeft size={14} />{isMm ? 'နောက်သို့' : 'Back'}</button>
          <span className="text-[13px] font-extrabold text-white flex items-center gap-1.5">{tabs.find(t => t.id === tab)?.icon}{tabs.find(t => t.id === tab)?.label}</span>
        </div>
      )}

      <div className="mt-3 space-y-4">
        {tab === 'trans' && (
          <>
            <p className="text-[10.5px] leading-relaxed text-slate-500">{isMm ? 'ဇာတ်ကွက်တစ်ခုနဲ့တစ်ခု ကူးတဲ့အခါ အသုံးပြုမယ့် effect။ အသံနဲ့ စာတန်း အချိန်မပြောင်းပါဘူး။' : 'The effect between one scene and the next. Voice and subtitle timing are not changed.'}</p>
            <div className="flex flex-wrap gap-1.5">
              {TRANSITIONS.map(t => <Chip key={t.id} on={fx.transition.type === t.id} onClick={() => setF({ transition: { ...fx.transition, type: t.id } })}>{isMm ? t.mm : t.en}</Chip>)}
            </div>
            {fx.transition.type !== 'none' && (
              <Slider label={isMm ? 'ကြာချိန်' : 'Duration'} value={fx.transition.dur} min={0.2} max={1.2} step={0.1} show={`${fx.transition.dur.toFixed(1)}s`} onChange={v => setF({ transition: { ...fx.transition, dur: v } })} />
            )}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <Slider label={isMm ? 'အစ Fade-in' : 'Fade in (start)'} value={fx.fadeIn} min={0} max={2} step={0.1} show={fx.fadeIn ? `${fx.fadeIn.toFixed(1)}s` : (isMm ? 'ပိတ်' : 'off')} onChange={v => setF({ fadeIn: v })} />
              <Slider label={isMm ? 'အဆုံး Fade-out' : 'Fade out (end)'} value={fx.fadeOut} min={0} max={3} step={0.1} show={fx.fadeOut ? `${fx.fadeOut.toFixed(1)}s` : (isMm ? 'ပိတ်' : 'off')} onChange={v => setF({ fadeOut: v })} />
            </div>
          </>
        )}

        {tab === 'look' && (
          <>
            <p className="text-[10.5px] leading-relaxed text-slate-500">{isMm ? 'ဗီဒီယိုတစ်ခုလုံးကို အရောင်ပုံစံ တစ်ချက်နှိပ်ရုံ။ စာတန်း/Logo ကို မထိပါဘူး။ Preview မှာ အနီးစပ်ဆုံးပဲ ပြပါတယ်။' : 'One-tap colour look for the whole video. Subtitles and logo are left alone. The preview is an approximation.'}</p>
            <div className="grid grid-cols-3 gap-2">
              {FILTERS.map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setF({ filter: f.id })}
                  className={`rounded-xl overflow-hidden border text-left transition ${fx.filter === f.id ? 'border-amber-400 ring-2 ring-amber-400/30' : 'border-white/10 hover:border-white/30'}`}
                >
                  <div className="h-14 bg-gradient-to-br from-slate-700 to-slate-900 overflow-hidden">
                    {thumb && <img src={thumb} alt="" className="w-full h-full object-cover" style={{ filter: FILTER_CSS[f.id] || undefined }} />}
                  </div>
                  <div className={`px-2 py-1.5 text-[11px] font-bold ${fx.filter === f.id ? 'text-amber-300' : 'text-slate-300'}`}>{isMm ? f.mm : f.en}</div>
                </button>
              ))}
            </div>
          </>
        )}

        {tab === 'text' && (
          <>
            <TextLayersEditor layers={textLayers} onChange={onTextLayers} duration={duration} isMm={isMm} />
            <div className="pt-4 border-t border-white/10">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[12px] font-bold text-slate-200 flex items-center gap-1.5"><ImageIcon size={13} />{isMm ? 'ပုံ / Sticker ထပ်တင်ရန်' : 'Image / sticker overlay'}</div>
                <label className={`px-2.5 py-1 rounded-lg bg-white/10 border border-white/10 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer ${overlays.length >= 8 ? 'opacity-40 pointer-events-none' : ''}`}>
                  <Plus size={12} />{isMm ? 'ပုံရွေး' : 'Add image'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (!f) return;
                      const id = overlays.reduce((m, o) => Math.max(m, o.id), 0) + 1;
                      onOverlays([...overlays, newImageOverlay(id, f, duration)]);
                    }}
                  />
                </label>
              </div>
              {overlays.length === 0 && <p className="text-[10px] text-slate-500">{isMm ? 'PNG (နောက်ခံမရှိ) က အကောင်းဆုံး။ GIF ဆိုရင်ပထမဆုံး frame ပဲ သုံးပါမယ်။' : 'A transparent PNG works best. For a GIF only the first frame is used.'}</p>}
              <div className="space-y-2">
                {overlays.map(o => (
                  <div key={o.id} className="p-2.5 rounded-xl border border-white/10 bg-white/5 space-y-2">
                    <div className="flex items-center gap-2">
                      <img src={o.url} alt="" className="w-10 h-10 object-contain rounded bg-black/40" />
                      <div className="min-w-0 flex-1 text-[11px] text-slate-300 truncate">{o.name}</div>
                      <button type="button" onClick={() => { URL.revokeObjectURL(o.url); onOverlays(overlays.filter(x => x.id !== o.id)); }} className="p-2 rounded-lg bg-red-400/15 text-red-300"><Trash2 size={13} /></button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[10px] text-slate-400">{isMm ? 'စတင်ချိန် (စက္ကန့်)' : 'Start (s)'}
                        <input type="number" className={inp} min={0} max={maxT} step={0.5} value={o.start} onChange={e => patchOv(o.id, { start: Math.max(0, Math.min(Number(e.target.value) || 0, o.end - 0.5)) })} />
                      </label>
                      <label className="text-[10px] text-slate-400">{isMm ? 'ပြီးချိန် (စက္ကန့်)' : 'End (s)'}
                        <input type="number" className={inp} min={0} max={maxT} step={0.5} value={o.end} onChange={e => patchOv(o.id, { end: Math.max(o.start + 0.5, Math.min(Number(e.target.value) || 0, maxT)) })} />
                      </label>
                      <label className="text-[10px] text-slate-400">{isMm ? 'ဘယ်-ညာ %' : 'Left-right %'}
                        <input type="range" className="w-full accent-amber-400" min={5} max={95} value={o.x} onChange={e => patchOv(o.id, { x: Number(e.target.value) })} />
                      </label>
                      <label className="text-[10px] text-slate-400">{isMm ? 'အပေါ်-အောက် %' : 'Up-down %'}
                        <input type="range" className="w-full accent-amber-400" min={5} max={95} value={o.y} onChange={e => patchOv(o.id, { y: Number(e.target.value) })} />
                      </label>
                      <label className="text-[10px] text-slate-400">{isMm ? 'အရွယ်အစား' : 'Size'}
                        <input type="range" className="w-full accent-amber-400" min={5} max={90} value={o.size} onChange={e => patchOv(o.id, { size: Number(e.target.value) })} />
                      </label>
                      <label className="text-[10px] text-slate-400">{isMm ? 'ပွင့်လင်းမှု' : 'Opacity'}
                        <input type="range" className="w-full accent-amber-400" min={0.1} max={1} step={0.05} value={o.opacity} onChange={e => patchOv(o.id, { opacity: Number(e.target.value) })} />
                      </label>
                      <label className="text-[10px] text-slate-400 col-span-2">{isMm ? 'ပေါ်လာပုံ' : 'Animation'}
                        <select className={inp} value={o.anim} onChange={e => patchOv(o.id, { anim: e.target.value as ImageOverlay['anim'] })}>
                          <option value="none">{isMm ? 'ချက်ချင်းပေါ်' : 'None'}</option>
                          <option value="fade">Fade</option>
                          <option value="slide">{isMm ? 'အောက်ကနေ တက်လာ' : 'Slide up + fade'}</option>
                        </select>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {tab === 'cards' && (
          <>
            <p className="text-[10.5px] leading-relaxed text-slate-500">{isMm ? 'ဗီဒီယိုရဲ့ အစ/အဆုံးမှာ ခေါင်းစဉ်ကဒ် ထည့်နိုင်ပါတယ် (အသံမပါ)။ ထည့်ရင် Recap ကြာချိန် တိုးသွားပါမယ်။' : 'Add a title card at the start and/or end (silent). The video becomes that much longer.'}</p>
            <CardEditor title={isMm ? 'Intro ကဒ် (အစ)' : 'Intro card (start)'} card={fx.intro} onChange={c => setF({ intro: c })} isMm={isMm} />
            <CardEditor title={isMm ? 'Outro ကဒ် (အဆုံး)' : 'Outro card (end)'} card={fx.outro} onChange={c => setF({ outro: c })} isMm={isMm} />
          </>
        )}

        {tab === 'audio' && (
          <>
            <div className={`rounded-2xl border p-3 space-y-3 ${hasBgm ? 'border-white/10 bg-white/[0.03]' : 'border-white/5 bg-black/20 opacity-60'}`}>
              <label className="flex items-center gap-2 text-[12px] font-bold text-slate-100 cursor-pointer">
                <input type="checkbox" checked={fx.duck.on} disabled={!hasBgm} onChange={e => setF({ duck: { ...fx.duck, on: e.target.checked } })} className="accent-amber-400 w-4 h-4" />
                {isMm ? 'စကားပြောချိန် BGM ကို အလိုအလျောက် တိုးတိုးလုပ် (Ducking)' : 'Lower the BGM while the narrator speaks (ducking)'}
              </label>
              {!hasBgm && <p className="text-[10px] text-slate-500">{isMm ? 'အရင်ဆုံး "ဗီဒီယို ပြင်ဆင်ချက်များ" ထဲမှာ BGM ဖိုင် ရွေးပါ။' : 'Choose a BGM file first (in the video settings below).'}</p>}
              {hasBgm && fx.duck.on && (
                <div className="flex gap-1.5">
                  {(['soft', 'normal', 'strong'] as const).map(s => (
                    <Chip key={s} on={fx.duck.strength === s} onClick={() => setF({ duck: { ...fx.duck, strength: s } })}>
                      {s === 'soft' ? (isMm ? 'နည်းနည်း' : 'Soft') : s === 'normal' ? (isMm ? 'ပုံမှန်' : 'Normal') : (isMm ? 'အပြင်းအထန်' : 'Strong')}
                    </Chip>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Slider label={isMm ? 'အစ Fade-in (အသံ+ပုံ)' : 'Fade in (picture + sound)'} value={fx.fadeIn} min={0} max={2} step={0.1} show={fx.fadeIn ? `${fx.fadeIn.toFixed(1)}s` : (isMm ? 'ပိတ်' : 'off')} onChange={v => setF({ fadeIn: v })} />
              <Slider label={isMm ? 'အဆုံး Fade-out' : 'Fade out'} value={fx.fadeOut} min={0} max={3} step={0.1} show={fx.fadeOut ? `${fx.fadeOut.toFixed(1)}s` : (isMm ? 'ပိတ်' : 'off')} onChange={v => setF({ fadeOut: v })} />
            </div>
          </>
        )}
      </div>
    </div>
  );
};
