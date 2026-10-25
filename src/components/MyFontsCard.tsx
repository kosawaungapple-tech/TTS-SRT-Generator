import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Type, Upload, Trash2, Loader2 } from 'lucide-react';
import { addUserFont, loadUserFonts, removeUserFont, FONTS_EVENT, type UserFont } from '../utils/userFonts';

interface Props {
  isMm: boolean;
  showToast: (m: string, t?: 'success' | 'error' | 'info') => void;
}

/** Settings card: add your own fonts for captions and titles (kept in this browser). */
export const MyFontsCard: React.FC<Props> = ({ isMm, showToast }) => {
  const [fonts, setFonts] = useState<UserFont[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => { void loadUserFonts().then(setFonts); }, []);
  useEffect(() => {
    refresh();
    window.addEventListener(FONTS_EVENT, refresh);
    return () => window.removeEventListener(FONTS_EVENT, refresh);
  }, [refresh]);

  const onPick = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    let ok = 0;
    for (const f of Array.from(files)) {
      try { await addUserFont(f); ok++; } catch (e) {
        showToast(`${f.name}: ${e instanceof Error && /font|file|large/i.test(e.message) ? e.message : (isMm ? 'ဖောင့်ဖိုင် မမှန်ပါ' : 'This is not a valid font file')}`, 'error');
      }
    }
    setBusy(false);
    if (input.current) input.current.value = '';
    if (ok) showToast(isMm ? `ဖောင့် ${ok} ခု ထည့်ပြီးပါပြီ` : `${ok} font(s) added`, 'success');
  };

  return (
    <div className="glass-card rounded-[32px] p-6 sm:p-8 shadow-2xl">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-400/10 border border-amber-400/20 grid place-items-center text-amber-400"><Type size={18} /></div>
          <div>
            <h3 className="text-base font-extrabold text-white leading-tight">{isMm ? 'ကျွန်ုပ်၏ ဖောင့်များ' : 'My fonts'}</h3>
            <p className="text-[11.5px] text-slate-400">{isMm ? 'စာတန်းနဲ့ Title မှာ သုံးမယ့် ဖောင့်ကို ထည့်ပါ (.ttf .otf .woff .woff2)' : 'Add fonts for captions and titles (.ttf .otf .woff .woff2)'}</p>
          </div>
        </div>
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="px-4 py-2.5 rounded-xl bg-amber-400 text-black text-[12.5px] font-extrabold flex items-center gap-1.5 disabled:opacity-60">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {isMm ? 'ဖောင့်ထည့်မည်' : 'Add font'}
        </button>
        <input ref={input} type="file" multiple accept=".ttf,.otf,.woff,.woff2" className="hidden" onChange={e => void onPick(e.target.files)} />
      </div>

      {fonts.length === 0 ? (
        <p className="text-[12px] text-slate-500">{isMm ? 'ဖောင့် မထည့်ရသေးပါ။ ထည့်ပြီးရင် Auto Recap ရဲ့ Captions > ဖောင့် မှာ ရွေးသုံးလို့ရပါမယ်။' : 'No fonts yet. Once added, pick them in Auto Recap > Captions > Font.'}</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-2">
          {fonts.map(f => (
            <div key={f.id} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[20px] font-black text-white truncate" style={{ fontFamily: `"${f.family}"` }}>မင်္ဂလာပါ Abc 123</div>
                <div className="text-[10.5px] text-slate-400 truncate">{f.name}</div>
              </div>
              <button type="button" title={isMm ? 'ဖျက်မည်' : 'Remove'} onClick={() => { void removeUserFont(f.id); }} className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-400/10"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-[10.5px] text-slate-500">{isMm ? 'ဖောင့်တွေကို ဒီ browser ထဲမှာပဲ သိမ်းပါတယ်။ တခြားစက်မှာ သုံးချင်ရင် ထပ်ထည့်ရပါမယ်။ လိုင်စင်ရှိတဲ့ ဖောင့်ကိုသာ သုံးပါ။' : 'Fonts are stored in this browser only; add them again on another device. Only use fonts you are licensed to use.'}</p>
    </div>
  );
};
