import React, { useState } from 'react';
import { Key, Plus, Trash2, Layers } from 'lucide-react';
import { getExtraKeys, setExtraKeys } from '../services/geminiKeyPool';
import { isPlausibleApiKey } from '../services/apiChannelManager';

const mask = (k: string) => `${k.slice(0, 6)}…${k.slice(-4)}`;

/** Extra personal Google AI Studio keys. When one key hits its limit the app moves to the next. */
export const ExtraGeminiKeys: React.FC<{ isMm: boolean; showToast?: (m: string, t: 'success' | 'error') => void }> = ({ isMm, showToast }) => {
  const [keys, setKeys] = useState<string[]>(() => getExtraKeys());
  const [input, setInput] = useState('');

  const add = () => {
    const k = input.trim();
    if (!isPlausibleApiKey(k)) {
      showToast?.(isMm ? 'Key မှားနေပါတယ် — AI Studio က key ကို အပြည့်ကူးထည့်ပါ' : 'That does not look like a full API key', 'error');
      return;
    }
    if (keys.includes(k)) { setInput(''); return; }
    const next = [...keys, k];
    setExtraKeys(next);
    setKeys(next);
    setInput('');
    showToast?.(isMm ? 'Key ထပ်ထည့်ပြီးပါပြီ ✨' : 'Extra key added ✨', 'success');
  };

  const remove = (k: string) => {
    const next = keys.filter(x => x !== k);
    setExtraKeys(next);
    setKeys(next);
  };

  return (
    <div className="glass-card rounded-[24px] p-6 sm:p-8 shadow-2xl">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 bg-sky-400/10 rounded-xl flex items-center justify-center text-sky-400"><Layers size={20} /></div>
        <div>
          <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">{isMm ? 'Gemini Key အပို (အလိုအလျောက် ပြောင်းသုံး)' : 'Extra Gemini keys (auto-switch)'}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {isMm
              ? 'အဓိက key limit ပြည့်ရင် ဒီ key တွေကို အလိုအလျောက် ဆက်သုံးပါမယ်။ ကိုယ်ပိုင် Google AI Studio key တွေသာ ထည့်ပါ။'
              : 'When your main key hits its limit, these are used next, automatically. Add only your own Google AI Studio keys.'}
          </p>
        </div>
      </div>

      {keys.length > 0 && (
        <div className="space-y-2 mb-3">
          {keys.map((k, i) => (
            <div key={k} className="flex items-center justify-between rounded-xl bg-slate-50/50 dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 px-4 py-2.5">
              <span className="text-sm font-mono text-slate-700 dark:text-slate-200">#{i + 2} · {mask(k)}</span>
              <button type="button" onClick={() => remove(k)} className="p-2 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500/20" title="Remove"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="password"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={isMm ? 'Key အသစ် ထည့်ပါ (AIza...)' : 'Paste another key (AIza...)'}
          className="flex-1 bg-slate-50/50 dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 font-mono focus:outline-none focus:ring-2 focus:ring-sky-400/40"
        />
        <button type="button" onClick={add} className="px-6 py-3 rounded-xl bg-sky-400 hover:bg-sky-300 text-black font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shrink-0 active:scale-95">
          <Plus size={16} /><Key size={14} />
          <span>{isMm ? 'ထပ်ထည့်' : 'ADD'}</span>
        </button>
      </div>
      <p className="mt-3 text-[11px] text-slate-500">
        {isMm
          ? 'မှတ်ချက် — Google ရဲ့ စည်းကမ်းအရ project/account အများကြီးဖွင့်ပြီး limit ကို ရှောင်တာကို ခွင့်မပြုနိုင်ပါဘူး၊ ဒါကြောင့် key တွေက သင့်ကိုယ်ပိုင် (တခုချင်း တရားဝင်) ဖြစ်ရပါမယ်။ ရေရှည်သုံးမယ်ဆိုရင် billing ချိတ်တာက ပိုကောင်းပါတယ်။ Key တွေကို ဒီစက်ထဲမှာပဲ မှတ်ထားပါတယ်။'
          : 'Note: Google’s terms do not allow spreading usage across many projects/accounts just to dodge limits, so only add keys that are legitimately yours. For regular use, enabling billing is the better route. Keys are stored on this device only.'}
      </p>
    </div>
  );
};
