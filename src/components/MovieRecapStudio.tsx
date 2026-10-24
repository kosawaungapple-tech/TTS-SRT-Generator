import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Upload, Loader2, Sparkles, Copy, Download, RefreshCw, Film, Mic, Globe2, Wand2, CheckCircle2, Volume2, FileText } from 'lucide-react';
import { GeminiTTSService } from '../services/geminiService';
import { assemblyAiService } from '../services/assemblyAiService';
import { apiChannelManager } from '../services/apiChannelManager';
import { estimateNarrationSeconds } from '../services/recapScriptPipeline';
import { getExtraKeys } from '../services/geminiKeyPool';
import { captureVideoFrames } from '../utils/videoFrames';
import { extractSpeechWav } from '../utils/voiceAudio';
import { audioBufferToWav, renderProcessedAudio } from '../utils/audioUtils';
import { generateSRT, downloadSrtFile, splitSentenceIntoCueBlocks } from '../utils/subtitleUtils';
import { planSubtitlePieces } from '../utils/recapGeometry';
import { VOICE_OPTIONS } from '../constants';
import type { SRTSubtitle } from '../types';

interface Props {
  showToast: (message: string, type: 'success' | 'error') => void;
  isAdmin: boolean;
  isMm: boolean;
  onNavigateToSettings?: () => void;
}

type Source = 'speech' | 'recap';
interface Para { start: number; end: number; text: string }

const panel = 'min-w-0 w-full rounded-3xl sm:rounded-[28px] border border-white/10 bg-gradient-to-b from-slate-900/90 to-black/90 p-4 sm:p-6 shadow-2xl shadow-black/50';
const MAX_MIN_USER = 40; // the shared Gemini key is protected: normal users can recap up to 40 minutes at a time

const GAP = 0.25;
const secToSrt = (sec: number) => {
  const v = Math.max(0, sec);
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  const ms = Math.min(999, Math.round((v - Math.floor(v)) * 1000));
  return `${p(Math.floor(v / 3600))}:${p(Math.floor((v % 3600) / 60))}:${p(Math.floor(v % 60))},${p(ms, 3)}`;
};
/** Subtitle lines for one paragraph spread across [t0, t1]. */
function subsFor(text: string, t0: number, t1: number, from: number): SRTSubtitle[] {
  return planSubtitlePieces(text, splitSentenceIntoCueBlocks).map((pc, i) => ({
    index: from + i + 1,
    startTime: secToSrt(t0 + pc.from * (t1 - t0)),
    endTime: secToSrt(t0 + pc.to * (t1 - t0)),
    text: pc.text,
  }));
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function parseSrtCues(srt: string): { start: number; end: number; text: string }[] {
  const toSec = (t: string) => {
    const m = t.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0').slice(0, 3)) / 1000 : 0;
  };
  return srt.split(/\r?\n\r?\n/).map(block => {
    const lines = block.split(/\r?\n/).filter(Boolean);
    const ti = lines.findIndex(l => l.includes('-->'));
    if (ti < 0) return null;
    const [a, b] = lines[ti].split('-->');
    const text = lines.slice(ti + 1).join(' ').trim();
    return text ? { start: toSec(a), end: toSec(b), text } : null;
  }).filter((x): x is { start: number; end: number; text: string } => !!x);
}

function getDuration(f: File): Promise<number> {
  return new Promise(resolve => {
    const v = document.createElement('video');
    const u = URL.createObjectURL(f);
    v.preload = 'metadata';
    v.onloadedmetadata = () => { const d = v.duration; URL.revokeObjectURL(u); resolve(Number.isFinite(d) ? d : 0); };
    v.onerror = () => { URL.revokeObjectURL(u); resolve(0); };
    v.src = u;
  });
}

const Chip: React.FC<{ on: boolean; onClick: () => void; children: React.ReactNode }> = ({ on, onClick, children }) => (
  <button type="button" onClick={onClick} className={`px-3 py-2 rounded-xl text-[12px] font-bold border transition text-left leading-snug ${on ? 'bg-amber-400 text-black border-amber-400' : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'}`}>
    {children}
  </button>
);

/**
 * Movie Recap: a TEXT-ONLY recap tool open to every user. A video goes in, a recap script comes out - written to the
 * video's real running time and scene order (each paragraph is tied to the stretch of video it tells), in connected
 * spoken storytelling, ready to be voiced at a normal pace.
 */
export const MovieRecapStudio: React.FC<Props> = ({ showToast, isAdmin, isMm, onNavigateToSettings }) => {
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState(0);
  const [thumb, setThumb] = useState<string | null>(null);
  const [source, setSource] = useState<Source>('speech');
  const [language, setLanguage] = useState<'mm' | 'en'>('mm');
  const [spokenLang, setSpokenLang] = useState('auto');
  const [coverage, setCoverage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ text: string; percent: number } | null>(null);
  const [error, setError] = useState('');
  const [paras, setParas] = useState<Para[] | null>(null);
  const [timed, setTimed] = useState(true);
  const [fitting, setFitting] = useState<number | 'all' | null>(null);
  const abortRef = useRef(false);
  const [voice, setVoice] = useState(VOICE_OPTIONS.find(v => v.id === 'aoede')?.id || VOICE_OPTIONS[0].id);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceProg, setVoiceProg] = useState('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioSrt, setAudioSrt] = useState('');
  const [audioDur, setAudioDur] = useState(0);

  const gemini = useCallback(() => new GeminiTTSService(apiChannelManager.getActiveKey(false, isAdmin) || '', isAdmin), [isAdmin]);

  useEffect(() => () => { abortRef.current = true; }, []);

  const pick = async (f: File | null) => {
    setFile(f);
    setParas(null);
    setError('');
    setThumb(null);
    const d = f ? await getDuration(f) : 0;
    setDuration(d);
    if (f && d) {
      try {
        const [img] = await captureVideoFrames(f, [Math.min(d * 0.1, 5)], 360, 0.7);
        if (img) setThumb(`data:image/jpeg;base64,${img}`);
      } catch { /* thumbnail is optional */ }
    }
  };

  const lang = language;
  const slotOf = (p: Para) => Math.max(1, (p.end - p.start) * coverage);

  const generate = async () => {
    if (!file) { showToast(isMm ? 'ဗီဒီယို အရင်ရွေးပါ' : 'Choose a video first', 'error'); return; }
    if (!duration) { showToast(isMm ? 'ဗီဒီယိုအရှည်ကို ဖတ်မရပါ — mp4 ကို စမ်းပါ' : 'Could not read the video length', 'error'); return; }
    if (!isAdmin && duration > MAX_MIN_USER * 60) {
      showToast(isMm ? `တစ်ခါမှာ မိနစ် ${MAX_MIN_USER} အထိပဲ လုပ်လို့ရပါတယ် — ဗီဒီယိုကို ဖြတ်ပြီး ထပ်ကြိုးစားပါ` : `Up to ${MAX_MIN_USER} minutes at a time — trim the video and try again`, 'error');
      return;
    }
    abortRef.current = false;
    setBusy(true);
    setError('');
    setParas(null);
    try {
      const g = gemini();
      let cues: { start: number; end: number; text: string }[] = [];
      if (source === 'speech') {
        const key = assemblyAiService.getStoredApiKey();
        if (!key) {
          showToast(isMm ? 'Settings ထဲမှာ AssemblyAI API Key အရင်ထည့်ပါ' : 'Add your AssemblyAI API key in Settings first', 'error');
          onNavigateToSettings?.();
          return;
        }
        setProgress({ text: isMm ? '၁/၂ စကားပြောကို နားထောင်နေသည်…' : '1/2 Listening to the speech…', percent: 3 });
        const speech = (await extractSpeechWav(file)) || file;
        const tr = await assemblyAiService.processToSrt({
          apiKey: key,
          file: speech,
          languageCode: spokenLang,
          autoLanguage: spokenLang === 'auto',
          speakerLabels: false,
          speechModel: 'best',
          onProgress: (step, percent) => setProgress({ text: `${isMm ? '၁/၂ ' : '1/2 '}${step}`, percent: Math.min(25, Math.round((percent ?? 0) * 0.25)) }),
        });
        cues = parseSrtCues(tr.srt);
      }
      if (abortRef.current) return;

      const recap = await g.generateMovieRecap(
        cues.map((c, i) => `[${i + 1}] ${c.text}`).join('\n'),
        (s, msg) => setProgress(p => ({ text: `${isMm ? 'Gemini ပြည့်ကျပ်နေပါတယ် — ' : 'Gemini is busy — '}${msg} (${s}s)`, percent: p?.percent ?? 30 })),
        {
          style: source === 'recap'
            ? 'A re-recap of a video that is already a recap: retell its story afresh in your own storyteller words, following the footage in order, without repeating the earlier narration word for word.'
            : 'Cinematic recap that follows the story itself: infer the genre and mood from what actually happens and let it shift scene by scene. Never impose a genre the footage does not show.',
          tone: 'Engaging, emotional, cinematic and captivating',
          targetMinutes: Math.max(1, (duration * coverage) / 60),
          sourceSeconds: duration,
          targetLanguage: lang,
          cues,
          coverage,
          flow: true,
          concurrency: Math.min(6, getExtraKeys().length + 2),
          getFrames: async (a, b) => {
            const n = 5;
            return captureVideoFrames(file, Array.from({ length: n }, (_, i) => a + ((b - a) * (i + 0.5)) / n), 448, 0.6);
          },
          onStage: st => {
            const t = st.stage === 'watch'
              ? `${isMm ? '၂/၂ ဗီဒီယိုကို ကြည့်နေသည်' : '2/2 Watching the video'} (${st.done}/${st.total})`
              : st.stage === 'write'
                ? `${isMm ? '၂/၂ စာသား ရေးနေသည်' : '2/2 Writing the script'} (${st.done}/${st.total})`
                : st.stage === 'outline'
                  ? (isMm ? '၂/၂ ဇာတ်ကွက်စီစဉ်နေသည်' : '2/2 Planning the beats')
                  : (isMm ? '၂/၂ စကားဆက်တွေ ညှိနေသည်' : '2/2 Polishing the flow');
            const frac = st.stage === 'watch' ? (st.done / Math.max(1, st.total)) * 0.6 : st.stage === 'write' ? 0.6 + (st.done / Math.max(1, st.total)) * 0.4 : 0.6;
            setProgress({ text: t, percent: 25 + Math.round(frac * 70) });
          },
        }
      );
      if (abortRef.current) return;

      const out: Para[] = recap.segments?.length
        ? recap.segments.map(s => ({ start: s.start, end: s.end, text: s.text }))
        : recap.text.split(/\n{2,}/).map(t => t.trim()).filter(Boolean).map((text, i, arr) => ({
            start: (duration * i) / arr.length,
            end: (duration * (i + 1)) / arr.length,
            text,
          }));
      setParas(out);
      setAudioUrl(null);
      setAudioSrt('');
      setProgress({ text: isMm ? 'ပြီးပါပြီ ✅' : 'Done ✅', percent: 100 });
      showToast(isMm ? '🎉 Recap စာသား ရပါပြီ' : '🎉 Recap script ready', 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      showToast(msg, 'error');
      setProgress(null);
    } finally {
      setBusy(false);
    }
  };

  /** Pulls one paragraph toward the time it has on screen (shorter if it would be read too fast, fuller if too slow). */
  const fitOne = async (i: number, quiet = false): Promise<boolean> => {
    if (!paras) return false;
    const p = paras[i];
    const est = estimateNarrationSeconds(p.text, lang);
    const slot = slotOf(p);
    const perChar = est > 0 ? est / Math.max(1, p.text.replace(/\s+/g, '').length) : 60 / 340;
    const targetChars = Math.round(slot / perChar);
    if (est >= slot * 0.9 && est <= slot * 1.1) return true;
    try {
      const g = gemini();
      const next = est > slot ? await g.condenseNarration(p.text, targetChars, lang) : await g.expandNarration(p.text, targetChars, lang);
      if (next) {
        setParas(cur => cur ? cur.map((x, k) => (k === i ? { ...x, text: next } : x)) : cur);
        return true;
      }
      if (!quiet) showToast(isMm ? 'ဒီပိုဒ်ကို ညှိမရပါ — ကိုယ်တိုင်ပြင်ပါ' : 'Could not fit this paragraph — edit it by hand', 'error');
    } catch (e) {
      if (!quiet) showToast(e instanceof Error ? e.message : 'Failed', 'error');
    }
    return false;
  };

  const fitAll = async () => {
    if (!paras) return;
    setFitting('all');
    let n = 0;
    for (let i = 0; i < paras.length; i++) {
      const p = paras[i];
      const est = estimateNarrationSeconds(p.text, lang);
      const slot = slotOf(p);
      if (est > slot * 1.1 || est < slot * 0.9) { if (await fitOne(i, true)) n++; }
    }
    setFitting(null);
    showToast(isMm ? `${n} ပိုဒ် ညှိပြီးပါပြီ` : `${n} paragraphs adjusted`, 'success');
  };

  const baseName = (file?.name || 'recap').replace(/\.[^/.]+$/, '');

  /** Voices every paragraph at the voice's normal pace, joins them into one WAV and times an SRT to that audio. */
  const makeVoice = async () => {
    if (!paras?.length) return;
    setVoiceBusy(true);
    setAudioUrl(null);
    setAudioSrt('');
    try {
      const g = gemini();
      const blobs: (Blob | undefined)[] = paras.map(() => undefined);
      const texts = paras.map(p => p.text);
      let done = 0;
      const queue = paras.map((_, i) => i);
      let failure: unknown = null;
      const Ctx0 = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const durOf = async (b: Blob) => {
        const c = new Ctx0();
        try { return (await c.decodeAudioData(await b.arrayBuffer())).duration; } finally { void c.close(); }
      };
      const speak = async (text: string, i: number) => {
        const r = await g.generateTTS(text.replace(/\s+/g, ' ').trim(), { voiceId: voice, speed: 1, pitch: 0, volume: 100, vocalStyle: 'Expressive', styleInstruction: 'Read as a gripping storyteller, natural and clear, at a normal speaking pace.' }, undefined, undefined, (sec, msg) => setVoiceProg(`${msg} (${sec}s)`));
        if (!r?.audioUrl) throw new Error(`No audio for paragraph ${i + 1}`);
        return await (await fetch(r.audioUrl)).blob();
      };
      const MAX_FAST = 1.25; // never faster than this: the voice must stay natural
      const worker = async () => {
        while (queue.length && !failure) {
          const i = queue.shift() as number;
          try {
            let blob = await speak(texts[i], i);
            // The voiceover must fit the video: this paragraph gets the time of the scene it tells.
            const budget = Math.max(2, slotOf(paras[i]) - GAP);
            let dur = await durOf(blob);
            if (dur > budget * 1.02) {
              setVoiceProg(`${isMm ? 'ဗီဒီယိုအချိန်နဲ့ ကိုက်အောင် ညှိနေသည်' : 'Fitting to the video'} (${i + 1}/${paras.length})`);
              if (dur / budget > MAX_FAST) {
                // far too long: shorten the paragraph and voice it again
                const target = Math.max(20, Math.round(texts[i].length * ((budget * MAX_FAST) / dur) * 0.97));
                const shorter = await g.condenseNarration(texts[i], target, lang);
                if (shorter) {
                  const b2 = await speak(shorter, i);
                  const d2 = await durOf(b2);
                  if (d2 < dur) { texts[i] = shorter; blob = b2; dur = d2; }
                }
              }
              const rate = Math.min(MAX_FAST, dur / budget);
              if (rate > 1.03) {
                try { blob = (await renderProcessedAudio(blob, { speed: rate })).blob; } catch { /* keep as is */ }
              }
            }
            blobs[i] = blob;
            done++;
            setVoiceProg(`${isMm ? 'အသံထုတ်နေသည်' : 'Voicing'} ${done}/${paras.length}`);
          } catch (e) { failure = e; }
        }
      };
      await Promise.all([worker(), worker()]);
      if (failure) throw failure;

      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const bufs: AudioBuffer[] = [];
      try { for (const b of blobs) bufs.push(await ctx.decodeAudioData(await (b as Blob).arrayBuffer())); } finally { void ctx.close(); }
      const rate = bufs[0].sampleRate;
      const total = bufs.reduce((n, b) => n + b.duration, 0) + GAP * (bufs.length - 1);
      const out = new AudioBuffer({ length: Math.ceil(total * rate), numberOfChannels: 1, sampleRate: rate });
      const ch = out.getChannelData(0);
      const subs: SRTSubtitle[] = [];
      let t = 0;
      bufs.forEach((b, i) => {
        ch.set(b.getChannelData(0), Math.round(t * rate));
        subs.push(...subsFor(texts[i], t, t + b.duration, subs.length));
        t += b.duration + GAP;
      });
      if (texts.some((x, i) => x !== paras[i].text)) setParas(cur => cur ? cur.map((x, i) => ({ ...x, text: texts[i] })) : cur);
      setAudioUrl(URL.createObjectURL(audioBufferToWav(out)));
      setAudioSrt(generateSRT(subs));
      setAudioDur(total);
      setVoiceProg('');
      showToast(isMm ? '🎙 အသံနဲ့ SRT ရပါပြီ' : '🎙 Voiceover and SRT ready', 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setVoiceProg('');
      showToast(msg, 'error');
    } finally {
      setVoiceBusy(false);
    }
  };

  /** SRT laid on the VIDEO's own timeline (each paragraph over the scene it tells) - no voice needed. */
  const videoTimedSrt = () => generateSRT((paras || []).reduce<SRTSubtitle[]>((acc, p) => acc.concat(subsFor(p.text, p.start, p.end, acc.length)), []));

  const plain = (paras || []).map(p => p.text.trim()).join('\n\n');
  const withTimes = (paras || []).map(p => `[${fmt(p.start)} – ${fmt(p.end)}]\n${p.text.trim()}`).join('\n\n');
  const outText = timed ? withTimes : plain;

  const copy = async () => {
    try { await navigator.clipboard.writeText(outText); showToast(isMm ? 'ကူးပြီးပါပြီ' : 'Copied', 'success'); }
    catch { showToast(isMm ? 'ကူးမရပါ — စာသားကို ရွေးပြီး ကိုယ်တိုင်ကူးပါ' : 'Copy failed — select the text and copy it by hand', 'error'); }
  };
  const download = () => {
    const base = (file?.name || 'recap').replace(/\.[^/.]+$/, '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([outText], { type: 'text/plain;charset=utf-8' }));
    a.download = `${base}_recap_script.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  const totalEst = (paras || []).reduce((n, p) => n + estimateNarrationSeconds(p.text, lang), 0);
  const totalSlot = (paras || []).reduce((n, p) => n + slotOf(p), 0);

  const badge = (p: Para) => {
    const r = estimateNarrationSeconds(p.text, lang) / slotOf(p);
    if (r > 1.1) return { cls: 'bg-rose-400/15 text-rose-300 border-rose-400/30', label: isMm ? 'ရှည်နေ' : 'too long' };
    if (r < 0.9) return { cls: 'bg-sky-400/15 text-sky-300 border-sky-400/30', label: isMm ? 'တိုနေ' : 'too short' };
    return { cls: 'bg-emerald-400/15 text-emerald-300 border-emerald-400/30', label: isMm ? 'ကိုက်' : 'fits' };
  };

  return (
    <div className="w-full max-w-5xl mx-auto grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] items-start overflow-x-hidden">
      {/* Setup */}
      <div className={panel}>
        <div className="flex items-center gap-3.5 mb-5 pb-5 border-b border-white/10">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-400 to-fuchsia-500 grid place-items-center shadow-lg shadow-fuchsia-500/20">
            <BookOpen size={22} className="text-black" />
          </div>
          <div>
            <h2 className="text-lg font-extrabold text-white leading-tight">Movie Recap</h2>
            <p className="text-[12px] text-slate-400">{isMm ? 'ဗီဒီယိုကို ကြည့်ပြီး Recap စာသား ရေးပေးမည်' : 'Watches a video and writes the recap script'}</p>
          </div>
        </div>

        {!file ? (
          <label className="group block rounded-3xl border-2 border-dashed border-white/15 bg-white/[0.02] px-5 py-9 text-center cursor-pointer transition hover:border-violet-400/60 hover:bg-violet-400/[0.04]">
            <input type="file" accept="video/*" className="hidden" onChange={e => void pick(e.target.files?.[0] || null)} />
            <div className="mx-auto mb-3 w-14 h-14 rounded-2xl bg-violet-400/10 border border-violet-400/30 grid place-items-center group-hover:scale-105 transition">
              <Upload className="text-violet-300" size={24} />
            </div>
            <div className="text-[15px] font-bold text-white">{isMm ? 'Recap လုပ်မယ့် ဗီဒီယိုကို ရွေးပါ' : 'Choose the video to recap'}</div>
            <div className="text-[12px] text-slate-500 mt-1">MP4 · MOV · WebM</div>
          </label>
        ) : (
          <div className="flex items-center gap-3 rounded-3xl bg-white/[0.04] border border-white/10 p-2.5 sm:p-3 min-w-0">
            <div className="w-20 h-14 sm:w-24 sm:h-16 rounded-2xl overflow-hidden bg-black grid place-items-center shrink-0 border border-white/10">
              {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" /> : <Film size={20} className="text-slate-600" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold text-white truncate max-w-full">{file.name}</div>
              <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[11px] text-slate-400">
                <span className="px-2 py-0.5 rounded-full bg-white/10 whitespace-nowrap">{duration > 0 ? fmt(duration) : '…'}</span>
                <span className="px-2 py-0.5 rounded-full bg-white/10 whitespace-nowrap">{(file.size / 1048576).toFixed(1)} MB</span>
              </div>
            </div>
            <label className="shrink-0 w-10 h-10 rounded-2xl bg-white/10 hover:bg-white/20 grid place-items-center cursor-pointer transition" title={isMm ? 'ပြောင်းမည်' : 'Change'}>
              <input type="file" accept="video/*" className="hidden" onChange={e => void pick(e.target.files?.[0] || null)} />
              <RefreshCw size={16} className="text-slate-200" />
            </label>
          </div>
        )}

        <div className="mt-5">
          <div className="flex items-center gap-1.5 mb-2 text-[11.5px] font-semibold tracking-wide text-slate-400"><Film size={12} />{isMm ? 'ဘာကို Recap လုပ်မလဲ' : 'What are you recapping?'}</div>
          <div className="grid grid-cols-1 gap-2">
            <button type="button" onClick={() => setSource('speech')} className={`text-left w-full min-w-0 rounded-2xl border p-3 sm:p-3.5 transition ${source === 'speech' ? 'border-violet-400 bg-violet-400/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`}>
              <div className="text-[13px] font-extrabold text-white">{isMm ? '🎙 မူရင်း စကားပြော ဗီဒီယို' : '🎙 Original video with speech'}</div>
              <div className="text-[11.5px] text-slate-400 mt-0.5 leading-relaxed">{isMm ? 'ရုပ်ရှင်/ဗီဒီယိုထဲက စကားကို အရင်နားထောင် (AssemblyAI) ပြီး ပုံနဲ့တွဲကြည့်ကာ Recap စာသား ရေးမည်။' : 'Listens to the dialogue first (AssemblyAI), then watches the footage and writes the recap.'}</div>
            </button>
            <button type="button" onClick={() => setSource('recap')} className={`text-left w-full min-w-0 rounded-2xl border p-3 sm:p-3.5 transition ${source === 'recap' ? 'border-violet-400 bg-violet-400/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`}>
              <div className="text-[13px] font-extrabold text-white">{isMm ? '🔁 Recap ဗီဒီယိုကို ပြန် Recap' : '🔁 Re-recap a recap video'}</div>
              <div className="text-[11.5px] text-slate-400 mt-0.5 leading-relaxed">{isMm ? 'Recap လုပ်ပြီးသား ဗီဒီယိုအတွက် — စကားမနားထောင်ဘဲ ပုံကိုပဲကြည့်ပြီး ကိုယ့်စကားနဲ့ ပြန်ရေးမည် (AssemblyAI မလို)။' : 'For a video that is already a recap — watches the pictures only and retells it in your own words (no AssemblyAI needed).'}</div>
            </button>
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-center gap-1.5 mb-2 text-[11.5px] font-semibold tracking-wide text-slate-400"><Wand2 size={12} />{isMm ? 'စာသား အရှည်' : 'Script length'}</div>
          <div className="flex flex-wrap gap-1.5">
            <Chip on={coverage === 1} onClick={() => setCoverage(1)}>{isMm ? 'ဗီဒီယိုအချိန်အတိုင်း (၁၀၀%)' : 'Match video length (100%)'}</Chip>
            <Chip on={coverage === 0.7} onClick={() => setCoverage(0.7)}>{isMm ? 'အတိုချုပ် (၇၀%)' : 'Shorter (70%)'}</Chip>
            <Chip on={coverage === 0.45} onClick={() => setCoverage(0.45)}>{isMm ? 'အဓိကသာ (၄၅%)' : 'Highlights (45%)'}</Chip>
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-slate-500">
            {isMm ? 'ပုံမှန် ပြောနှုန်း (အသံကို မမြန်စေဘဲ) နဲ့ ဖတ်ရင် ဗီဒီယိုအချိန်နဲ့ ကိုက်အောင် စာအရေအတွက်ကို တွက်ပေးပါတယ်။' : 'The text is sized so that, read at a normal pace (no speeding up), it fits the video\'s running time.'}
          </p>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3">
          <div>
            <div className="flex items-center gap-1.5 mb-2 text-[11.5px] font-semibold tracking-wide text-slate-400"><Globe2 size={12} />{isMm ? 'Recap ဘာသာစကား' : 'Recap language'}</div>
            <div className="flex gap-1.5">
              <Chip on={language === 'mm'} onClick={() => setLanguage('mm')}>🇲🇲 {isMm ? 'မြန်မာ' : 'Burmese'}</Chip>
              <Chip on={language === 'en'} onClick={() => setLanguage('en')}>🇬🇧 English</Chip>
            </div>
          </div>
          {source === 'speech' && (
            <div>
              <div className="flex items-center gap-1.5 mb-2 text-[11.5px] font-semibold tracking-wide text-slate-400"><Mic size={12} />{isMm ? 'စကားပြော ဘာသာစကား' : 'Spoken language'}</div>
              <select value={spokenLang} onChange={e => setSpokenLang(e.target.value)} style={{ colorScheme: 'dark' }} className="w-full rounded-2xl bg-white/[0.04] border border-white/10 px-4 py-3 text-[13px] text-white focus:outline-none focus:border-violet-400/60">
                <option value="auto">Auto detect</option>
                <option value="en">English</option><option value="th">Thai</option><option value="ja">Japanese</option>
                <option value="ko">Korean</option><option value="zh">Chinese</option><option value="es">Spanish</option>
                <option value="fr">French</option><option value="de">German</option>
              </select>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => void generate()}
          disabled={busy || !file}
          className="mt-6 w-full h-14 rounded-2xl bg-gradient-to-r from-violet-300 via-violet-400 to-fuchsia-500 text-black text-[15px] font-extrabold flex items-center justify-center gap-2.5 shadow-xl shadow-fuchsia-500/20 transition disabled:opacity-40"
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
          {busy ? (isMm ? 'လုပ်ဆောင်နေသည်…' : 'Working…') : (paras ? (isMm ? 'ပြန်ရေးမည်' : 'Write again') : (isMm ? 'Recap စာသား ရေးမည်' : 'Write the recap script'))}
        </button>

        {progress && (
          <div className="mt-4 rounded-2xl bg-white/[0.03] border border-white/10 p-4">
            <div className="text-[12px] text-slate-300 mb-2">{progress.text}</div>
            <div className="h-2 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-violet-300 to-fuchsia-500 transition-all duration-500" style={{ width: `${progress.percent}%` }} />
            </div>
          </div>
        )}
        {error && (
          <div className="mt-4 rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-[12px] text-red-200 break-words select-all">
            <div className="font-bold mb-1">{isMm ? '❌ Error — ဒီစာကို ကူးပြီး ပို့ပေးပါ' : '❌ Error — copy this text'}</div>
            {error}
          </div>
        )}
      </div>

      {/* Result */}
      <div className={panel}>
        {!paras ? (
          <div className="min-h-[320px] grid place-items-center text-center">
            <div className="max-w-sm">
              <div className="text-5xl mb-4">📖</div>
              <div className="text-[15px] font-extrabold text-white mb-1">{isMm ? 'Recap စာသားကို ဒီမှာ တွေ့ရမယ်' : 'Your recap script will appear here'}</div>
              <p className="text-[12.5px] leading-relaxed text-slate-400">
                {isMm ? 'ဗီဒီယိုထည့်ပြီး "Recap စာသား ရေးမည်" ကို နှိပ်ပါ။ ပိုဒ်တစ်ခုစီက ဗီဒီယိုရဲ့ ဇာတ်ကွက်တစ်ခုနဲ့ ကိုက်ပြီး စကားဆက်တွေနဲ့ ဆက်စပ်ပြီး ပြောသလို ရေးပေးပါလိမ့်မယ်။' : 'Add a video and press "Write the recap script". Every paragraph matches one scene of the video and is written as connected, spoken storytelling.'}
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <div className="w-11 h-11 rounded-2xl bg-emerald-400/15 border border-emerald-400/30 grid place-items-center"><CheckCircle2 size={22} className="text-emerald-400" /></div>
              <div className="min-w-0">
                <div className="text-[15px] font-extrabold text-white">{isMm ? 'Recap စာသား ရပါပြီ' : 'Your recap script is ready'}</div>
                <div className="text-[12px] text-slate-400">
                  {paras.length} {isMm ? 'ပိုဒ်' : 'paragraphs'} · {isMm ? 'ပုံမှန်ပြောနှုန်းနဲ့ ဖတ်ရင်' : 'read at normal pace'} ≈ {fmt(totalEst)} / {isMm ? 'ဗီဒီယို' : 'video'} {fmt(totalSlot)}
                </div>
              </div>
              <button type="button" onClick={() => void fitAll()} disabled={fitting !== null} className="w-full sm:w-auto sm:ml-auto justify-center px-3.5 py-2.5 rounded-xl bg-violet-400 text-black text-[12px] font-extrabold flex items-center gap-1.5 disabled:opacity-50">
                {fitting === 'all' ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                {isMm ? 'အကုန် အချိန်ကိုက်ညှိမည်' : 'Fit all to time'}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 mb-4">
              <label className="flex items-center gap-2 text-[12px] text-slate-300 mr-auto cursor-pointer">
                <input type="checkbox" checked={timed} onChange={e => setTimed(e.target.checked)} className="accent-violet-400 w-4 h-4" />
                {isMm ? 'အချိန် [၀:၀၀ – ၀:၂၀] ပါအောင်' : 'Include time ranges'}
              </label>
              <button type="button" onClick={() => void copy()} className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-[12.5px] font-bold flex items-center gap-2"><Copy size={14} />{isMm ? 'ကူးမည်' : 'Copy'}</button>
              <button type="button" onClick={download} className="px-4 py-2.5 rounded-xl bg-emerald-400 text-black text-[12.5px] font-extrabold flex items-center gap-2"><Download size={14} />{isMm ? 'TXT ဒေါင်းမည်' : 'Download TXT'}</button>
            </div>

            <div className="mb-5 rounded-2xl border border-violet-400/25 bg-violet-400/[0.05] p-3.5 sm:p-4 min-w-0">
              <div className="flex items-center gap-2 mb-3 text-[13px] font-extrabold text-white"><Volume2 size={16} className="text-violet-300" />{isMm ? 'အသံနဲ့ SRT ထုတ်ရန်' : 'Voiceover & subtitles'}</div>
              <select value={voice} onChange={e => setVoice(e.target.value)} style={{ colorScheme: 'dark' }} className="w-full min-w-0 rounded-2xl bg-white/[0.06] border border-white/10 px-4 py-3 text-[13px] text-white focus:outline-none focus:border-violet-400/60">
                {VOICE_OPTIONS.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                <button type="button" onClick={() => void makeVoice()} disabled={voiceBusy} className="h-12 rounded-xl bg-violet-400 text-black text-[13px] font-extrabold flex items-center justify-center gap-2 disabled:opacity-50">
                  {voiceBusy ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}{voiceBusy ? (voiceProg || '…') : (isMm ? 'အသံ + SRT ထုတ်မည်' : 'Make voice + SRT')}
                </button>
                <button type="button" onClick={() => downloadSrtFile(videoTimedSrt(), `${baseName}_video_timed.srt`)} className="h-12 rounded-xl bg-white/10 hover:bg-white/15 text-white text-[13px] font-bold flex items-center justify-center gap-2">
                  <FileText size={16} />{isMm ? 'SRT သီးသန့် (ဗီဒီယိုအချိန်)' : 'SRT only (video timing)'}
                </button>
              </div>
              <p className="mt-2 text-[11.5px] leading-relaxed text-slate-400">{isMm ? 'အသံကို ပုံမှန်ပြောနှုန်းအတိုင်း ထုတ်ပြီး SRT ကို အသံအချိန်နဲ့ ကိုက်အောင် ညှိပေးပါတယ်။ စာသားကို အရင်ပြင်ပြီးမှ ထုတ်ပါ။' : 'The voice is made at normal pace and the SRT is timed to it. Finish editing the text first.'}</p>
              {audioUrl && (
                <div className="mt-3 rounded-xl bg-black/40 border border-white/10 p-3">
                  <div className="text-[11.5px] text-slate-400 mb-2">{isMm ? 'အသံ' : 'Voiceover'} · {fmt(audioDur)} / {isMm ? 'ဗီဒီယို' : 'video'} {fmt(duration)}{audioDur > duration + 1 ? (isMm ? ' ⚠ ကျော်နေ' : ' ⚠ longer than the video') : ' ✓'}</div>
                  <audio src={audioUrl} controls className="w-full" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                    <a href={audioUrl} download={`${baseName}_voiceover.wav`} className="h-11 rounded-xl bg-emerald-400 text-black text-[12.5px] font-extrabold flex items-center justify-center gap-2"><Download size={15} />{isMm ? 'အသံ ဒေါင်းမည် (WAV)' : 'Download WAV'}</a>
                    <button type="button" onClick={() => downloadSrtFile(audioSrt, `${baseName}_voiceover.srt`)} className="h-11 rounded-xl bg-amber-400 text-black text-[12.5px] font-extrabold flex items-center justify-center gap-2"><FileText size={15} />{isMm ? 'SRT ဒေါင်းမည်' : 'Download SRT'}</button>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3">
              {paras.map((p, i) => {
                const b = badge(p);
                const est = estimateNarrationSeconds(p.text, lang);
                return (
                  <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="w-6 h-6 rounded-full bg-violet-400/15 border border-violet-400/30 text-violet-300 text-[11px] font-extrabold grid place-items-center">{i + 1}</span>
                      <span className="text-[11.5px] font-mono text-slate-400">{fmt(p.start)} – {fmt(p.end)}</span>
                      <span className={`px-2 py-0.5 rounded-full border text-[10.5px] font-bold ${b.cls}`}>{b.label} · {est}s / {Math.round(slotOf(p))}s</span>
                      <button type="button" onClick={async () => { setFitting(i); await fitOne(i); setFitting(null); }} disabled={fitting !== null} className="ml-auto px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-[11px] font-bold text-slate-200 flex items-center gap-1 disabled:opacity-50">
                        {fitting === i ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}{isMm ? 'ညှိ' : 'Fit'}
                      </button>
                    </div>
                    <textarea
                      value={p.text}
                      onChange={e => { const text = e.target.value; setParas(cur => cur ? cur.map((x, k) => (k === i ? { ...x, text } : x)) : cur); }}
                      rows={Math.max(3, Math.ceil(p.text.length / 46))}
                      className="w-full rounded-xl bg-black/50 border border-white/10 p-3 text-[13px] leading-[1.9] text-slate-100 focus:outline-none focus:border-violet-400/60"
                    />
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
