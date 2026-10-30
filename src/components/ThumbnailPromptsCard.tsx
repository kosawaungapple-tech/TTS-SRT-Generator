import React, { useState } from 'react';
import { Image as ImageIcon, Loader2, Copy, Check, RefreshCw } from 'lucide-react';
import type { GeminiTTSService } from '../services/geminiService';

interface Props {
  /** The story: the recap script, or the subtitles. */
  getText: () => string;
  getService: () => GeminiTTSService;
  isMm: boolean;
  /** Language of the short title text on the thumbnail. */
  titleLanguage?: 'mm' | 'en';
  showToast?: (message: string, type: 'success' | 'error') => void;
}

type Idea = { concept: string; imagePrompt: string; titleText: string };

async function copyText(t: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(t); return true; } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

export const ThumbnailPromptsCard: React.FC<Props> = ({ getText, getService, isMm, titleLanguage = 'mm', showToast }) => {
  const [busy, setBusy] = useState(false);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [copied, setCopied] = useState('');

  const run = async () => {
    const text = getText().trim();
    if (text.length < 40) { showToast?.(isMm ? 'ဇာတ်လမ်းစာသား မလုံလောက်ပါ' : 'Not enough story text yet', 'error'); return; }
    setBusy(true);
    try {
      setIdeas(await getService().generateThumbnailPrompts(text, titleLanguage));
    } catch (e) {
      showToast?.(e instanceof Error ? e.message : 'Failed', 'error');
    } finally { setBusy(false); }
  };

  const copy = async (key: string, t: string) => {
    if (await copyText(t)) { setCopied(key); setTimeout(() => setCopied(c => (c === key ? '' : c)), 1500); }
    else showToast?.(isMm ? 'Copy မရပါ' : 'Could not copy', 'error');
  };

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[13px] font-extrabold text-white flex items-center gap-2"><ImageIcon size={15} />{isMm ? 'Thumbnail Prompt များ' : 'Thumbnail prompts'}</div>
          <div className="text-[11.5px] text-slate-500 mt-0.5">{isMm ? 'ဇာတ်လမ်းအပေါ်မူတည်ပြီး AI ပုံထုတ်ဖို့ Prompt နဲ့ ခေါင်းစဉ် အကြံပြုပေးပါတယ်' : 'Image-generator prompts and a headline, written from your story'}</div>
        </div>
        <button type="button" onClick={run} disabled={busy} className="shrink-0 h-10 px-4 rounded-xl bg-amber-400 text-black text-[12.5px] font-extrabold flex items-center gap-2 disabled:opacity-50">
          {busy ? <Loader2 size={15} className="animate-spin" /> : ideas.length ? <RefreshCw size={15} /> : <ImageIcon size={15} />}
          {ideas.length ? (isMm ? 'ပြန်ရေး' : 'Again') : (isMm ? 'ရေးပေးပါ' : 'Write')}
        </button>
      </div>
      {ideas.length > 0 && (
        <div className="mt-3 space-y-3">
          {ideas.map((d, i) => (
            <div key={i} className="rounded-xl bg-black/30 border border-white/10 p-3">
              <div className="text-[12px] font-bold text-amber-300">{i + 1}. {d.concept}</div>
              {d.titleText && (
                <div className="mt-2 flex items-start justify-between gap-2">
                  <div className="text-[13px] font-extrabold text-white">“{d.titleText}”</div>
                  <button type="button" onClick={() => copy(`t${i}`, d.titleText)} className="shrink-0 text-[11px] text-slate-400 hover:text-white flex items-center gap-1">{copied === `t${i}` ? <Check size={13} /> : <Copy size={13} />}{isMm ? 'ခေါင်းစဉ်' : 'Title'}</button>
                </div>
              )}
              <p className="mt-2 text-[11.5px] leading-relaxed text-slate-400 font-mono break-words">{d.imagePrompt}</p>
              <button type="button" onClick={() => copy(`p${i}`, d.imagePrompt)} className="mt-2 h-8 px-3 rounded-lg bg-white/10 hover:bg-white/15 text-[11.5px] font-bold text-white flex items-center gap-1.5">
                {copied === `p${i}` ? <Check size={13} /> : <Copy size={13} />}{isMm ? 'Prompt ကူးမည်' : 'Copy prompt'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
