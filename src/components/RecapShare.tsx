import React, { useEffect, useState } from 'react';
import { Share2, Copy, ExternalLink, Loader2 } from 'lucide-react';

interface Props {
  videoUrl: string;
  fileName: string;
  defaultTitle: string;
  isMm: boolean;
}

const KEY = 'vbs_recap_share_settings';
const PLATFORMS = [
  { name: 'YouTube', url: 'https://www.youtube.com/upload' },
  { name: 'TikTok', url: 'https://www.tiktok.com/creator-center/upload' },
  { name: 'Facebook', url: 'https://business.facebook.com/latest/reels_composer' },
];

/** Caption settings + share the rendered mp4 straight to a social app (phone share sheet) or open the platform's upload page. */
export const RecapShare: React.FC<Props> = ({ videoUrl, fileName, defaultTitle, isMm }) => {
  const [title, setTitle] = useState(defaultTitle);
  const [tags, setTags] = useState('#recap #movierecap #myanmar');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (typeof s.tags === 'string') setTags(s.tags);
      if (typeof s.note === 'string') setNote(s.note);
    } catch { /* storage unavailable */ }
  }, []);
  useEffect(() => { setTitle(defaultTitle); }, [defaultTitle]);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ tags, note })); } catch { /* storage unavailable */ }
  }, [tags, note]);

  const caption = [title, note, tags].map(s => s.trim()).filter(Boolean).join('\n\n');

  const copy = async () => {
    try { await navigator.clipboard.writeText(caption); setMsg(isMm ? 'Caption ကူးပြီးပါပြီ' : 'Caption copied'); }
    catch { setMsg(isMm ? 'ကူးမရပါ' : 'Could not copy'); }
  };

  const share = async () => {
    setBusy(true); setMsg('');
    try {
      const blob = await (await fetch(videoUrl)).blob();
      const file = new File([blob], fileName, { type: 'video/mp4' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title, text: caption });
        setMsg(isMm ? 'Share ပြီးပါပြီ' : 'Shared');
      } else {
        setMsg(isMm
          ? 'ဒီ browser က ဖိုင် share မလုပ်နိုင်ပါ — အောက်က ခလုတ်နဲ့ ဒေါင်းပြီး platform ကို တင်ပါ (ဖုန်းမှာ ပိုအဆင်ပြေပါတယ်)'
          : 'This browser cannot share files — download the video and upload it on the platform (works best on a phone)');
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setMsg(isMm ? 'Share မအောင်မြင်ပါ' : 'Share failed');
    } finally { setBusy(false); }
  };

  const open = async (url: string) => {
    await copy();
    window.open(url, '_blank', 'noopener');
  };

  const field = 'w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-[12px] text-white';
  return (
    <div className="mt-4 p-4 rounded-2xl border border-white/10 bg-white/5 space-y-3">
      <div className="text-[12px] font-bold text-slate-200">{isMm ? 'Social Media သို့ တင်ရန်' : 'Post to social media'}</div>
      <input className={field} value={title} onChange={e => setTitle(e.target.value)} placeholder={isMm ? 'ခေါင်းစဉ်' : 'Title'} />
      <textarea className={field} rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder={isMm ? 'ဖော်ပြချက် (မှတ်ထားမည်)' : 'Description (remembered)'} />
      <input className={field} value={tags} onChange={e => setTags(e.target.value)} placeholder="#hashtags" />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={share} disabled={busy} className="h-11 rounded-xl bg-sky-400 text-black text-[12px] font-extrabold flex items-center justify-center gap-2 disabled:opacity-60">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}{isMm ? 'App သို့ တိုက်ရိုက် Share' : 'Share to an app'}
        </button>
        <button type="button" onClick={copy} className="h-11 rounded-xl bg-white/10 border border-white/10 text-white text-[12px] font-bold flex items-center justify-center gap-2">
          <Copy size={14} />{isMm ? 'Caption ကူးမည်' : 'Copy caption'}
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {PLATFORMS.map(p => (
          <button key={p.name} type="button" onClick={() => open(p.url)} className="h-10 rounded-xl bg-white/10 border border-white/10 text-white text-[11px] font-bold flex items-center justify-center gap-1">
            {p.name}<ExternalLink size={11} />
          </button>
        ))}
      </div>
      <p className="text-[10px] text-slate-500 leading-relaxed">
        {isMm
          ? 'ဖုန်းမှာ "App သို့ Share" က TikTok/Facebook/YouTube app ထဲ ဗီဒီယိုနဲ့ caption ကို တန်းပို့ပေးပါတယ်။ ကွန်ပျူတာမှာတော့ ဗီဒီယိုကို အရင်ဒေါင်းပြီး platform ခလုတ်နဲ့ upload စာမျက်နှာကို ဖွင့်ပါ (caption ကို အလိုအလျောက် ကူးပေးထားပါတယ်)။'
          : 'On a phone, "Share to an app" sends the video and caption straight into TikTok / Facebook / YouTube. On a computer, download the video first, then use a platform button (the caption is copied for you).'}
      </p>
      {msg && <p className="text-[11px] text-amber-300">{msg}</p>}
    </div>
  );
};
