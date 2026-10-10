import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Clapperboard, Upload, Download, Sparkles, Mic, FileText, Film, Loader2, CheckCircle2, Eye, MessageSquareText } from 'lucide-react';
import { GeminiTTSService, type RecapPlanScene } from '../services/geminiService';
import { assemblyAiService } from '../services/assemblyAiService';
import { apiChannelManager } from '../services/apiChannelManager';
import { renderSceneRecap } from '../services/recapRenderService';
import { captureVideoFrames } from '../utils/videoFrames';
import { audioBufferToWav } from '../utils/audioUtils';
import { generateSRT, downloadSrtFile, splitSentenceIntoCueBlocks } from '../utils/subtitleUtils';
import { getRecapOutputSize, planSubtitlePieces } from '../utils/recapGeometry';
import { renderSubtitleVideo } from '../utils/subtitleVideo';
import { VOICE_OPTIONS } from '../constants';
import type { SRTSubtitle } from '../types';

interface Props {
  showToast: (message: string, type: 'success' | 'error') => void;
  isAdmin: boolean;
  isMm: boolean;
  onNavigateToSettings?: () => void;
}

type SourceMode = 'speech' | 'visual';

interface Segment { start: number; end: number; text: string }

interface Result {
  script: string;
  segments: Segment[];
  hasVideoTimes: boolean;
  voiceoverBlob: Blob;
  voiceoverUrl: string;
  sceneAudios: Blob[];
  srt: string;
  cues: { start: number; end: number; text: string }[];
  duration: number;
}

const GAP = 0.25; // seconds of silence between narrated scenes

function parseSrtCues(srt: string): { start: number; end: number; text: string }[] {
  const toSec = (t: string) => {
    const m = t.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
    return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, '0').slice(0, 3) / 1000 : 0;
  };
  return srt
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map(block => {
      const lines = block.trim().split('\n');
      const ti = lines.findIndex(l => l.includes('-->'));
      if (ti < 0) return null;
      const [a, b] = lines[ti].split('-->');
      return { start: toSec(a), end: toSec(b), text: lines.slice(ti + 1).join(' ').trim() };
    })
    .filter((c): c is { start: number; end: number; text: string } => !!c && !!c.text);
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 500);
}

async function getVideoDuration(file: File): Promise<number> {
  return new Promise(resolve => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      resolve(isFinite(v.duration) ? v.duration : 0);
      URL.revokeObjectURL(url);
    };
    v.onerror = () => {
      resolve(0);
      URL.revokeObjectURL(url);
    };
    v.src = url;
  });
}

export const AutoRecapStudio: React.FC<Props> = ({ showToast, isAdmin, isMm, onNavigateToSettings }) => {
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState(0);
  const [mode, setMode] = useState<SourceMode>('speech');
  const [spokenLang, setSpokenLang] = useState('auto');
  const [style, setStyle] = useState('cinematic');
  const [length, setLength] = useState<'short' | 'medium' | 'full'>('medium');
  const [language, setLanguage] = useState<'mm' | 'en'>('mm');
  const [voice, setVoice] = useState('aoede');
  const [speed, setSpeed] = useState(1.0);
  const [aspect, setAspect] = useState('original');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ text: string; percent: number } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [rendering, setRendering] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [overlayBg, setOverlayBg] = useState<'black' | 'green'>('black');
  const [overlayWithVoice, setOverlayWithVoice] = useState(true);
  const [overlayBusy, setOverlayBusy] = useState<number | null>(null);
  const [overlayFile, setOverlayFile] = useState<{ blob: Blob; name: string } | null>(null);

  const styleHints: Record<string, string> = useMemo(
    () => ({
      cinematic: 'Cinematic movie recap with suspense, character hooks and high emotion',
      tiktok: 'Fast viral TikTok pacing, punchy hooks, high energy',
      thriller: 'Dark thriller and mystery with plot twists and tension',
      action: 'High action momentum, dramatic turns and climax',
      drama: 'Deep emotional drama, character decisions, heartbreak',
      summary: 'Clear summary of the key points and takeaways',
    }),
    []
  );

  const gemini = useCallback(() => {
    const useManaged = isAdmin || apiChannelManager.getSettings().useAdminKeys;
    return new GeminiTTSService(useManaged ? '' : apiChannelManager.getActiveKey() || '', isAdmin);
  }, [isAdmin]);

  const pickFile = async (f: File | null) => {
    setFile(f);
    setResult(null);
    setVideoUrl(null);
    setDuration(f ? await getVideoDuration(f) : 0);
  };

  const run = async () => {
    if (!file) {
      showToast(isMm ? 'ဗီဒီယိုဖိုင် အရင်တင်ပါ' : 'Please upload a video first', 'error');
      return;
    }
    if (!duration) {
      showToast(isMm ? 'ဗီဒီယိုအရှည်ကို ဖတ်မရပါ — mp4 ဖိုင်ကို စမ်းပါ' : 'Could not read the video length', 'error');
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setResult(null);
    setVideoUrl(null);
    try {
      // ---- 1. Listen (only for talking videos) ----------------------------------------------
      let cues: { start: number; end: number; text: string }[] = [];
      if (mode === 'speech') {
        const key = assemblyAiService.getStoredApiKey();
        if (!key) {
          showToast(isMm ? 'Settings ထဲမှာ AssemblyAI API Key အရင်ထည့်ပါ' : 'Add your AssemblyAI API key in Settings first', 'error');
          onNavigateToSettings?.();
          return;
        }
        setProgress({ text: isMm ? '၁/၄ စကားပြောကို နားထောင်နေသည်…' : '1/4 Listening to the speech…', percent: 3 });
        const tr = await assemblyAiService.processToSrt({
          apiKey: key,
          file,
          languageCode: spokenLang,
          autoLanguage: spokenLang === 'auto',
          speakerLabels: false,
          speechModel: 'best',
          onProgress: (step, percent) => setProgress({ text: `${isMm ? '၁/၄ ' : '1/4 '}${step}`, percent: Math.min(25, Math.round((percent ?? 0) * 0.25)) }),
        });
        cues = parseSrtCues(tr.srt);
      }

      // ---- 2. Watch + write ------------------------------------------------------------------
      const g = gemini();
      const recap = await g.generateMovieRecap(
        cues.map((c, i) => `[${i + 1}] ${c.text}`).join('\n'),
        (s, msg) => setProgress(p => ({ text: `${msg} (${s}s)`, percent: p?.percent ?? 30 })),
        {
          style: styleHints[style],
          tone: 'Engaging, emotional, cinematic and captivating',
          targetMinutes: style === 'tiktok' ? 1 : length === 'short' ? 1.5 : length === 'full' ? 9 : 4,
          sourceSeconds: duration,
          targetLanguage: language,
          cues,
          coverage: length === 'short' ? 0.4 : length === 'full' ? 1 : 0.7,
          getFrames: async (a, b) => {
            const n = 5;
            return captureVideoFrames(file, Array.from({ length: n }, (_, i) => a + ((b - a) * (i + 0.5)) / n), 448, 0.6);
          },
          onStage: st => {
            const t =
              st.stage === 'watch'
                ? `${isMm ? '၂/၄ ဗီဒီယိုကို ကြည့်နေသည်' : '2/4 Watching the video'} (${st.done}/${st.total})`
                : st.stage === 'write'
                  ? `${isMm ? '၂/၄ ဇာတ်ညွှန်း ရေးနေသည်' : '2/4 Writing the script'} (${st.done}/${st.total})`
                  : st.stage === 'outline'
                    ? isMm ? '၂/၄ ဇာတ်ကွက်စီစဉ်နေသည်' : '2/4 Planning the beats'
                    : isMm ? '၂/၄ ရေးနေသည်' : '2/4 Writing';
            const frac = st.stage === 'watch' ? st.done / Math.max(1, st.total) * 0.25 : st.stage === 'write' ? 0.25 + st.done / Math.max(1, st.total) * 0.2 : 0.25;
            setProgress({ text: t, percent: 25 + Math.round(frac * 100) });
          },
        }
      );

      let segments: Segment[];
      let hasVideoTimes = true;
      if (recap.segments?.length) {
        segments = recap.segments;
      } else {
        hasVideoTimes = false;
        segments = recap.text
          .split(/\n{2,}/)
          .map(t => t.trim())
          .filter(Boolean)
          .map(text => ({ start: 0, end: 0, text }));
      }

      // ---- 3. Voice every scene --------------------------------------------------------------
      const sceneAudios: Blob[] = [];
      for (let i = 0; i < segments.length; i++) {
        if (ctrl.signal.aborted) throw new Error('Cancelled');
        setProgress({ text: `${isMm ? '၃/၄ အသံသွင်းနေသည်' : '3/4 Recording the voiceover'} (${i + 1}/${segments.length})`, percent: 50 + Math.round((i / segments.length) * 40) });
        const r = await g.generateTTS(segments[i].text, { voiceId: voice, speed, pitch: 0, volume: 100, vocalStyle: 'Expressive' }, undefined, undefined, (s, msg) =>
          setProgress(p => ({ text: `${msg} (${s}s)`, percent: p?.percent ?? 60 }))
        );
        if (!r?.audioUrl) throw new Error(`No audio for part ${i + 1}`);
        const blob = await (await fetch(r.audioUrl)).blob();
        if (!blob.size) throw new Error(`Empty audio for part ${i + 1}`);
        sceneAudios.push(blob);
      }

      // ---- 4. Join voiceover + build the SRT on the same timeline ---------------------------
      setProgress({ text: isMm ? '၄/၄ Voiceover နဲ့ SRT ပေါင်းနေသည်' : '4/4 Joining voiceover and subtitles', percent: 93 });
      const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      const ctx = new Ctx();
      const buffers: AudioBuffer[] = [];
      for (const b of sceneAudios) buffers.push(await ctx.decodeAudioData(await b.arrayBuffer()));
      const rate = buffers[0].sampleRate;
      const total = buffers.reduce((n, b) => n + b.duration, 0) + GAP * (buffers.length - 1);
      const out = ctx.createBuffer(1, Math.ceil(total * rate), rate);
      const ch = out.getChannelData(0);
      let t = 0;
      const subs: SRTSubtitle[] = [];
      const cueTimes: { start: number; end: number; text: string }[] = [];
      buffers.forEach((buf, i) => {
        ch.set(buf.getChannelData(0), Math.round(t * rate));
        const pieces = planSubtitlePieces(segments[i].text, splitSentenceIntoCueBlocks);
        pieces.forEach(pc => {
          cueTimes.push({ start: t + pc.from * buf.duration, end: t + pc.to * buf.duration, text: pc.text });
          subs.push({
            index: subs.length + 1,
            startTime: secToSrt(t + pc.from * buf.duration),
            endTime: secToSrt(t + pc.to * buf.duration),
            text: pc.text,
          });
        });
        t += buf.duration + GAP;
      });
      void ctx.close();
      const voiceoverBlob = audioBufferToWav(out);

      setResult({
        script: segments.map(s => s.text).join('\n\n'),
        segments,
        hasVideoTimes,
        voiceoverBlob,
        voiceoverUrl: URL.createObjectURL(voiceoverBlob),
        sceneAudios,
        srt: generateSRT(subs),
        cues: cueTimes,
        duration: total,
      });
      setProgress({ text: isMm ? 'ပြီးပါပြီ ✅' : 'Done ✅', percent: 100 });
      showToast(isMm ? '🎉 Auto Recap ပြီးပါပြီ — Voiceover နဲ့ SRT ကို ဒေါင်းလို့ရပါပြီ' : '🎉 Recap ready — download the voiceover and SRT', 'success');
    } catch (e) {
      console.error('[AutoRecap]', e);
      showToast(e instanceof Error ? e.message : 'Auto recap failed', 'error');
      setProgress(null);
    } finally {
      setBusy(false);
    }
  };

  const baseName = (file?.name || 'recap').replace(/\.[^/.]+$/, '');

  const downloadAll = () => {
    if (!result) return;
    saveBlob(result.voiceoverBlob, `${baseName}_recap_voiceover.wav`);
    setTimeout(() => downloadSrtFile(result.srt, `${baseName}_recap.srt`), 700);
    setTimeout(() => saveBlob(new Blob(['﻿' + result.script], { type: 'text/plain;charset=utf-8' }), `${baseName}_recap_script.txt`), 1400);
  };

  const buildOverlay = async () => {
    if (!result) return;
    setOverlayFile(null);
    setOverlayBusy(0);
    try {
      const portrait = aspect === '9:16';
      const square = aspect === '1:1';
      const width = portrait ? 720 : square ? 720 : 1280;
      const height = portrait ? 1280 : square ? 720 : 720;
      let audio: AudioBuffer | undefined;
      if (overlayWithVoice) {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const c = new Ctx();
        audio = await c.decodeAudioData(await result.voiceoverBlob.arrayBuffer());
        void c.close();
      }
      const { blob, ext } = await renderSubtitleVideo({
        subtitles: result.cues,
        audio,
        duration: result.duration,
        width,
        height,
        background: overlayBg,
        style: {
          fontSize: 44,
          fontFamily: '"Noto Sans Myanmar", "Padauk", sans-serif',
          fontColor: '#ffffff',
          strokeColor: '#000000',
          strokeWidth: 0,
          bgBoxEnabled: false,
          bgBoxColor: 'rgba(0,0,0,0.6)',
          positionY: portrait ? 80 : 86,
        },
        onProgress: f => setOverlayBusy(f),
      });
      setOverlayFile({ blob, name: `${baseName}_subtitle_overlay.${ext}` });
      showToast(isMm ? 'Subtitle Overlay ဗီဒီယို ပြီးပါပြီ' : 'Subtitle overlay video ready', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Overlay render failed', 'error');
    } finally {
      setOverlayBusy(null);
    }
  };

  // On iPhone the share sheet's "Save Video" puts the file in Photos, which is where CapCut picks media from.
  const saveOverlay = () => {
    if (!overlayFile) return;
    const nav = navigator;
    try {
      const f = new File([overlayFile.blob], overlayFile.name, { type: overlayFile.blob.type || 'video/mp4' });
      if (typeof nav.share === 'function' && (!nav.canShare || nav.canShare({ files: [f] }))) {
        nav.share({ files: [f], title: overlayFile.name }).catch(err => {
          if ((err as { name?: string })?.name !== 'AbortError') saveBlob(overlayFile.blob, overlayFile.name);
        });
        return;
      }
    } catch { /* fall through */ }
    saveBlob(overlayFile.blob, overlayFile.name);
  };

  const buildVideo = async () => {
    if (!result || !file) return;
    if (!result.hasVideoTimes) {
      showToast(isMm ? 'ဗီဒီယိုအချိန်မှတ်ချက် မပါလို့ ဗီဒီယိုမထုတ်နိုင်ပါ' : 'No video timing available for this script', 'error');
      return;
    }
    setRendering(isMm ? 'စတင်နေသည်…' : 'Starting…');
    try {
      const probe = document.createElement('video');
      const probeUrl = URL.createObjectURL(file);
      probe.src = probeUrl;
      await new Promise(r => {
        probe.onloadedmetadata = r;
        probe.onerror = r;
      });
      const [w, h] = getRecapOutputSize(aspect, probe.videoWidth || 1920, probe.videoHeight || 1080);
      URL.revokeObjectURL(probeUrl);
      const scenes: RecapPlanScene[] = result.segments.map((s, i) => ({ fromCue: i, toCue: i, start: s.start, end: s.end, narration: s.text }));
      const r = await renderSceneRecap({
        gemini: gemini(),
        videoFile: file,
        videoFileName: file.name,
        scenes,
        audios: result.sceneAudios,
        tts: { voiceId: voice, speed, pitch: 0, volume: 100 },
        outputWidth: w,
        outputHeight: h,
        aspectRatio: aspect,
        framing: 'blurred-fit',
        blurAmount: 40,
        bgColor: '#000000',
        subtitleStyle: {
          fontSize: 40,
          fontFamily: '"Noto Sans Myanmar", "Padauk", sans-serif',
          fontColor: '#ffffff',
          strokeColor: '#000000',
          strokeWidth: 4,
          bgBoxEnabled: false,
          bgBoxColor: 'rgba(0,0,0,0.6)',
          positionY: 86,
        },
        onProgress: (d, tot, msg) => setRendering(`${msg} (${d}/${tot})`),
      });
      setVideoUrl(r.downloadUrl);
      showToast(isMm ? 'Recap ဗီဒီယို ပြီးပါပြီ' : 'Recap video ready', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Render failed', 'error');
    } finally {
      setRendering(null);
    }
  };

  const card = 'bg-slate-900/60 border border-white/10 rounded-2xl p-4 space-y-3';
  const label = 'text-[11px] font-bold text-slate-400 block mb-1';
  const field = 'w-full bg-black/80 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400/50';

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className={card}>
        <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
          <Clapperboard size={18} />
          <span>{isMm ? 'Auto Recap — ဗီဒီယိုကို ကြည့်ပြီး Recap ဇာတ်ညွှန်း + Voiceover + SRT ထုတ်ပေးမည်' : 'Auto Recap — watch the video, write the script, voice it, export SRT'}</span>
        </div>

        <label className="block border-2 border-dashed border-white/15 rounded-2xl p-6 text-center cursor-pointer hover:border-amber-400/50 transition-colors">
          <input type="file" accept="video/*" className="hidden" onChange={e => pickFile(e.target.files?.[0] || null)} />
          <Upload className="mx-auto text-amber-400 mb-2" size={28} />
          <div className="text-sm text-white font-bold">{file ? file.name : isMm ? 'Recap လုပ်မယ့် ဗီဒီယိုကို ရွေးပါ' : 'Choose the video to recap'}</div>
          {file && duration > 0 && <div className="text-[11px] text-slate-400 mt-1">{Math.floor(duration / 60)}:{String(Math.floor(duration % 60)).padStart(2, '0')}</div>}
        </label>

        <div>
          <span className={label}>{isMm ? 'ဒီဗီဒီယိုက ဘာအမျိုးအစားလဲ' : 'What kind of video is it?'}</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button type="button" onClick={() => setMode('speech')} className={`text-left rounded-xl p-3 border text-xs transition-all ${mode === 'speech' ? 'border-amber-400 bg-amber-400/10 text-white' : 'border-white/10 text-slate-400'}`}>
              <div className="flex items-center gap-1.5 font-bold mb-1"><MessageSquareText size={14} />{isMm ? 'စကားပြော Video' : 'Talking video'}</div>
              {isMm ? 'အသံထဲက စကားကို အရင်နားထောင်ပြီး (AssemblyAI) ပုံနဲ့ တွဲကြည့်ကာ Recap လုပ်မည်' : 'Listens to the speech first, then watches the picture'}
            </button>
            <button type="button" onClick={() => setMode('visual')} className={`text-left rounded-xl p-3 border text-xs transition-all ${mode === 'visual' ? 'border-amber-400 bg-amber-400/10 text-white' : 'border-white/10 text-slate-400'}`}>
              <div className="flex items-center gap-1.5 font-bold mb-1"><Eye size={14} />{isMm ? 'Recap ထားပြီးသား / အသံမပါ Video' : 'Already-recapped / silent video'}</div>
              {isMm ? 'စကားမနားထောင်ဘဲ ပုံကိုပဲ ကြည့်ပြီး Recap အသစ် ပြန်လုပ်မည်' : 'Skips the speech and recaps from the picture only'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {mode === 'speech' && (
            <div className="col-span-2 sm:col-span-1">
              <label className={label}>{isMm ? 'စကားပြော ဘာသာစကား' : 'Spoken language'}</label>
              <select className={field} value={spokenLang} onChange={e => setSpokenLang(e.target.value)}>
                <option value="auto">{isMm ? '✨ Auto Detect' : '✨ Auto detect'}</option>
                <option value="en">English</option><option value="th">Thai</option><option value="ja">Japanese</option>
                <option value="ko">Korean</option><option value="zh">Chinese</option><option value="es">Spanish</option>
                <option value="fr">French</option><option value="de">German</option>
              </select>
            </div>
          )}
          <div>
            <label className={label}>{isMm ? 'Recap စတိုင်' : 'Style'}</label>
            <select className={field} value={style} onChange={e => setStyle(e.target.value)}>
              <option value="cinematic">🎬 Cinematic</option><option value="tiktok">⚡ TikTok / Reels</option>
              <option value="thriller">🕵️ Thriller</option><option value="action">💥 Action</option>
              <option value="drama">💔 Drama</option><option value="summary">📚 Summary</option>
            </select>
          </div>
          <div>
            <label className={label}>{isMm ? 'ပါဝင်မှု' : 'Coverage'}</label>
            <select className={field} value={length} onChange={e => setLength(e.target.value as 'short' | 'medium' | 'full')}>
              <option value="short">{isMm ? 'အဓိကအချိန်ကာလ (၄၀%)' : 'Highlights (40%)'}</option>
              <option value="medium">{isMm ? 'ပုံမှန် (၇၀%)' : 'Standard (70%)'}</option>
              <option value="full">{isMm ? 'ဗီဒီယိုတစ်ခုလုံး (၁၀၀%)' : 'Whole video (100%)'}</option>
            </select>
          </div>
          <div>
            <label className={label}>{isMm ? 'Recap ဘာသာစကား' : 'Recap language'}</label>
            <select className={field} value={language} onChange={e => setLanguage(e.target.value as 'mm' | 'en')}>
              <option value="mm">🇲🇲 မြန်မာ</option><option value="en">🇬🇧 English</option>
            </select>
          </div>
          <div>
            <label className={label}>{isMm ? 'AI အသံရှင်' : 'Voice'}</label>
            <select className={field} value={voice} onChange={e => setVoice(e.target.value)}>
              {VOICE_OPTIONS.map(v => (
                <option key={v.id} value={v.id}>{v.gender === 'female' ? '👩' : '👨'} {v.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>{isMm ? 'အသံနှုန်း' : 'Speed'} {speed.toFixed(2)}x</label>
            <input type="range" min={0.8} max={1.3} step={0.05} value={speed} onChange={e => setSpeed(Number(e.target.value))} className="w-full" />
          </div>
        </div>

        <button
          type="button"
          onClick={run}
          disabled={busy || !file}
          className="w-full py-3 rounded-xl bg-amber-400 text-black font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {busy ? (isMm ? 'လုပ်ဆောင်နေသည်…' : 'Working…') : isMm ? 'Auto Recap စတင်မည်' : 'Start Auto Recap'}
        </button>

        {progress && (
          <div className="space-y-1">
            <div className="text-[11px] text-slate-300">{progress.text}</div>
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden"><div className="h-full bg-amber-400 transition-all" style={{ width: `${progress.percent}%` }} /></div>
          </div>
        )}
      </div>

      {result && (
        <div className={card}>
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
            <CheckCircle2 size={18} />
            <span>{isMm ? `ပြီးပါပြီ — ${result.segments.length} ပိုင်း၊ ${Math.floor(result.duration / 60)}:${String(Math.floor(result.duration % 60)).padStart(2, '0')}` : `Done — ${result.segments.length} parts, ${Math.floor(result.duration / 60)}:${String(Math.floor(result.duration % 60)).padStart(2, '0')}`}</span>
          </div>

          <audio controls src={result.voiceoverUrl} className="w-full" />

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button type="button" onClick={() => saveBlob(result.voiceoverBlob, `${baseName}_recap_voiceover.wav`)} className="py-2.5 rounded-xl bg-purple-600 text-white text-xs font-bold flex items-center justify-center gap-1.5"><Mic size={14} />Voiceover (.wav)</button>
            <button type="button" onClick={() => downloadSrtFile(result.srt, `${baseName}_recap.srt`)} className="py-2.5 rounded-xl bg-amber-400 text-black text-xs font-bold flex items-center justify-center gap-1.5"><FileText size={14} />SRT (.srt)</button>
            <button type="button" onClick={() => saveBlob(new Blob(['﻿' + result.script], { type: 'text/plain;charset=utf-8' }), `${baseName}_recap_script.txt`)} className="py-2.5 rounded-xl bg-slate-700 text-white text-xs font-bold flex items-center justify-center gap-1.5"><FileText size={14} />Script (.txt)</button>
            <button type="button" onClick={downloadAll} className="py-2.5 rounded-xl bg-emerald-500 text-black text-xs font-bold flex items-center justify-center gap-1.5"><Download size={14} />{isMm ? 'အားလုံးဒေါင်း' : 'Download all'}</button>
          </div>
          <p className="text-[11px] text-slate-500">
            {isMm ? 'Voiceover နဲ့ SRT က အချိန်တူညီပါတယ် — CapCut ထဲမှာ နှစ်ခုစလုံးကို အစကနေ တင်လိုက်ရုံပါ။' : 'The voiceover and SRT share one timeline — drop both at 0:00 in CapCut.'}
          </p>

          <div className="rounded-xl border border-sky-400/30 bg-sky-400/5 p-3 space-y-2">
            <div className="text-xs font-bold text-sky-300">{isMm ? '📱 iPhone / Android CapCut သုံးမယ်ဆိုရင်' : '📱 Using CapCut on a phone?'}</div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              {isMm
                ? 'CapCut ဖုန်းအက်ပ်က SRT/စာတန်းဖိုင်ကို လုံးဝ import မလုပ်နိုင်ပါဘူး (CapCut ရဲ့ တရားဝင်ပြောချက်)၊ ဖိုင်ရွေးတဲ့စာမျက်နှာမှာ မှိန်နေတာ ဒါကြောင့်ပါ။ ဗီဒီယိုပဲ ရွေးလို့ရပါတယ်။ ဒါကြောင့် စာတန်းကို ဗီဒီယိုအဖြစ် ထုတ်ပေးပါတယ် — CapCut မှာ Overlay အဖြစ်ထည့်ပြီး Blend = Screen (အနက်ရောင်နောက်ခံ) သို့ Chroma key (အစိမ်းရောင်) သုံးပါ။ SRT ကို PC (CapCut Desktop / Web) မှာပဲ ထည့်လို့ရပါတယ်။'
                : 'The CapCut phone app cannot import subtitle files at all (per CapCut), which is why they are greyed out — only videos are selectable. So here the subtitles come as a video: add it as an Overlay and set Blend = Screen (black) or Chroma key (green). SRT import works on CapCut Desktop / Web only.'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select className={`${field} !w-auto`} value={overlayBg} onChange={e => setOverlayBg(e.target.value as 'black' | 'green')}>
                <option value="black">{isMm ? 'အနက်ရောင် (Blend: Screen)' : 'Black (Blend: Screen)'}</option>
                <option value="green">{isMm ? 'အစိမ်းရောင် (Chroma key)' : 'Green (Chroma key)'}</option>
              </select>
              <label className="text-[11px] text-slate-300 flex items-center gap-1.5">
                <input type="checkbox" checked={overlayWithVoice} onChange={e => setOverlayWithVoice(e.target.checked)} />
                {isMm ? 'Voiceover အသံပါထည့်' : 'Include voiceover'}
              </label>
            </div>
            <button type="button" onClick={buildOverlay} disabled={overlayBusy !== null} className="w-full py-2.5 rounded-xl bg-sky-400 text-black text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-60">
              {overlayBusy !== null ? <Loader2 size={14} className="animate-spin" /> : <Film size={14} />}
              {overlayBusy !== null
                ? `${isMm ? 'ထုတ်နေသည်… ဒီစာမျက်နှာကို မပိတ်ပါနဲ့' : 'Rendering… keep this page open'} ${Math.round(overlayBusy * 100)}%`
                : isMm ? 'Subtitle Overlay ဗီဒီယို ထုတ်မည်' : 'Make subtitle overlay video'}
            </button>
            {overlayFile && (
              <button type="button" onClick={saveOverlay} className="w-full py-2.5 rounded-xl bg-emerald-500 text-black text-xs font-bold flex items-center justify-center gap-1.5">
                <Download size={14} />
                {isMm ? 'သိမ်းမည် (iPhone: "Save Video" ကိုရွေးပါ)' : 'Save (iPhone: choose "Save Video")'}
              </button>
            )}
          </div>

          <textarea readOnly value={result.script} className="w-full h-56 bg-black/60 border border-white/10 rounded-xl p-3 text-xs text-slate-200 leading-relaxed" />

          <div className="border-t border-white/10 pt-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <select className={`${field} !w-auto`} value={aspect} onChange={e => setAspect(e.target.value)}>
                <option value="original">Original</option><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="1:1">1:1</option>
              </select>
              <button type="button" onClick={buildVideo} disabled={!!rendering || !result.hasVideoTimes} className="flex-1 py-2.5 rounded-xl bg-sky-500 text-black text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50">
                {rendering ? <Loader2 size={14} className="animate-spin" /> : <Film size={14} />}
                {rendering || (isMm ? 'Recap ဗီဒီယိုပါ ထုတ်မည် (PC Worker လိုသည်)' : 'Also render the recap video (needs PC worker)')}
              </button>
            </div>
            {videoUrl && (
              <a href={videoUrl} download={`${baseName}_recap.mp4`} className="block text-center py-2.5 rounded-xl bg-emerald-500 text-black text-xs font-bold">
                <Download size={14} className="inline mr-1" />{isMm ? 'Recap ဗီဒီယို ဒေါင်းမည် (.mp4)' : 'Download recap video (.mp4)'}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

function secToSrt(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(h)}:${p(m)}:${p(r)},${p(ms === 1000 ? 999 : ms, 3)}`;
}
