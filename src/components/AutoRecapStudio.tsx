import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Clapperboard, Upload, Download, Sparkles, Mic, FileText, Film, Loader2, CheckCircle2, Eye, MessageSquareText, ChevronDown, RefreshCw, Smartphone, Globe2, Gauge, Layers } from 'lucide-react';
import { GeminiTTSService, type RecapPlanScene } from '../services/geminiService';
import { assemblyAiService } from '../services/assemblyAiService';
import { apiChannelManager } from '../services/apiChannelManager';
import { renderSceneRecap } from '../services/recapRenderService';
import { captureVideoFrames } from '../utils/videoFrames';
import { audioBufferToWav, renderProcessedAudio } from '../utils/audioUtils';
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

const Label: React.FC<{ icon?: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <div className="flex items-center gap-1.5 mb-2 text-[11.5px] font-semibold text-slate-400">
    {icon}
    <span className="border-b border-dotted border-slate-600 pb-px">{children}</span>
  </div>
);

const Select: React.FC<{ icon?: React.ReactNode; value: string; onChange: (v: string) => void; children: React.ReactNode }> = ({ icon, value, onChange, children }) => (
  <div className="relative">
    {icon && <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-base leading-none pointer-events-none">{icon}</span>}
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`w-full appearance-none rounded-2xl bg-white/[0.04] border border-white/10 py-3.5 pr-10 text-[13px] font-medium text-white shadow-inner shadow-black/30 transition focus:outline-none focus:border-amber-400/60 focus:bg-white/[0.07] ${icon ? 'pl-11' : 'pl-4'}`}
    >
      {children}
    </select>
    <ChevronDown size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
  </div>
);

const Segmented = <T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string; sub?: string }[] }) => (
  <div className="grid gap-1 p-1 rounded-2xl bg-black/50 border border-white/10" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
    {options.map(o => (
      <button
        key={o.id}
        type="button"
        onClick={() => onChange(o.id)}
        className={`rounded-xl py-2.5 px-2 text-[12px] font-bold transition-all ${value === o.id ? 'bg-white text-slate-900 shadow-md shadow-black/40' : 'text-slate-400 hover:text-white'}`}
      >
        <div>{o.label}</div>
        {o.sub && <div className={`text-[10px] font-medium mt-0.5 ${value === o.id ? 'text-slate-500' : 'text-slate-500'}`}>{o.sub}</div>}
      </button>
    ))}
  </div>
);


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
  const [errorInfo, setErrorInfo] = useState<string | null>(null);
  const stageRef = useRef('start');
  const [thumb, setThumb] = useState<string | null>(null);
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
    // Use the key chosen in Settings (personal key, or the admin pool for admins). Only when none is set
    // does the server fall back to its own key — which is what produced "API key not valid".
    return new GeminiTTSService(apiChannelManager.getActiveKey(false, isAdmin) || '', isAdmin);
  }, [isAdmin]);

  const pickFile = async (f: File | null) => {
    setFile(f);
    setResult(null);
    setVideoUrl(null);
    setThumb(null);
    const d = f ? await getVideoDuration(f) : 0;
    setDuration(d);
    if (f && d > 0) {
      try {
        const [img] = await captureVideoFrames(f, [Math.min(d * 0.1, 5)], 360, 0.7);
        if (img) setThumb(`data:image/jpeg;base64,${img}`);
      } catch { /* thumbnail is optional */ }
    }
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
    setErrorInfo(null);
    stageRef.current = 'start';
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
        stageRef.current = '1 listen (AssemblyAI)';
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
      stageRef.current = '2 watch/write (Gemini)';
      const recap = await g.generateMovieRecap(
        cues.map((c, i) => `[${i + 1}] ${c.text}`).join('\n'),
        (s, msg) => setProgress(p => ({ text: `${msg} (${s}s)`, percent: p?.percent ?? 30 })),
        {
          style: 'Cinematic recap that follows the story itself: infer the genre and mood (drama, thriller, action, comedy, romance...) from what actually happens and let it shift scene by scene. Never impose a genre the footage does not show.',
          tone: 'Engaging, emotional, cinematic and captivating',
          targetMinutes: length === 'short' ? 1.5 : length === 'full' ? 9 : 4,
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
            const frac = st.stage === 'watch' ? (st.done / Math.max(1, st.total)) * 0.6 : st.stage === 'write' ? 0.6 + (st.done / Math.max(1, st.total)) * 0.4 : 0.6;
            setProgress({ text: t, percent: 25 + Math.round(frac * 25) });
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
      stageRef.current = '3 voiceover (Gemini TTS)';
      const Ctx0 = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      const sceneAudios: Blob[] = [];
      // The voiceover must fit the video: each scene gets the time of the part of the video it tells.
      const coverageFactor = length === 'short' ? 0.4 : length === 'full' ? 1 : 0.7;
      const totalTarget = duration > 0 ? duration * coverageFactor : 0;
      const totalChars = segments.reduce((n, sg) => n + sg.text.length, 0) || 1;
      const lang: 'mm' | 'en' = language === 'en' ? 'en' : 'mm';
      const durOf = async (blob: Blob) => {
        const c = new Ctx0();
        try { return (await c.decodeAudioData(await blob.arrayBuffer())).duration; } finally { void c.close(); }
      };
      const speakOnce = async (text: string, i: number) => {
        const r = await g.generateTTS(text, { voiceId: voice, speed, pitch: 0, volume: 100, vocalStyle: 'Expressive' }, undefined, undefined, (s, msg) =>
          setProgress(p => ({ text: `${msg} (${s}s)`, percent: p?.percent ?? 60 }))
        );
        if (!r?.audioUrl) throw new Error(`No audio for part ${i + 1}`);
        const blob = await (await fetch(r.audioUrl)).blob();
        if (!blob.size) throw new Error(`Empty audio for part ${i + 1}`);
        return blob;
      };
      for (let i = 0; i < segments.length; i++) {
        if (ctrl.signal.aborted) throw new Error('Cancelled');
        setProgress({ text: `${isMm ? '၃/၄ အသံသွင်းနေသည်' : '3/4 Recording the voiceover'} (${i + 1}/${segments.length})`, percent: 50 + Math.round((i / segments.length) * 40) });
        let blob = await speakOnce(segments[i].text, i);
        if (totalTarget > 0) {
          const budget = Math.max(
            2,
            (hasVideoTimes ? (segments[i].end - segments[i].start) * coverageFactor : (totalTarget * segments[i].text.length) / totalChars) - GAP
          );
          let dur = await durOf(blob);
          if (dur > budget * 1.08) {
            // too long for its part of the video: tell the paragraph shorter, then voice it again
            setProgress(p => ({ text: `${isMm ? '၃/၄ ဗီဒီယိုအချိန်နဲ့ ကိုက်အောင် ညှိနေသည်' : '3/4 Fitting the narration to the video'} (${i + 1}/${segments.length})`, percent: p?.percent ?? 60 }));
            const target = Math.max(20, Math.round(segments[i].text.length * (budget / dur) * 0.97));
            const shorter = await g.condenseNarration(segments[i].text, target, lang);
            if (shorter) {
              const b2 = await speakOnce(shorter, i);
              const d2 = await durOf(b2);
              if (d2 < dur) { segments[i] = { ...segments[i], text: shorter }; blob = b2; dur = d2; }
            }
            // still a little long: speed it up slightly (max 1.12x) rather than letting the voiceover run past the picture
            if (dur > budget * 1.02) {
              const rate = Math.min(1.12, dur / budget);
              if (rate > 1.03) {
                try { blob = (await renderProcessedAudio(blob, { speed: rate })).blob; } catch { /* keep as is */ }
              }
            }
          }
        }
        sceneAudios.push(blob);
      }

      // ---- 4. Join voiceover + build the SRT on the same timeline ---------------------------
      stageRef.current = '4 join audio';
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
      let msg = e instanceof Error ? e.message : String(e);
      if (/api key not valid|invalid api key|API_KEY_INVALID/i.test(msg)) {
        msg += isMm
          ? ' — Gemini API Key မှားနေသည်။ Settings ထဲက Gemini API Key ကို စစ်ပြီး (AI Studio က key အသစ်ကို အပြည့်ကူးထည့်ပါ) ပြန်သိမ်းပါ။'
          : ' — The Gemini API key is invalid. Check the key in Settings (paste the full key from AI Studio) and save it again.';
      }
      setErrorInfo(`[${stageRef.current}] ${msg}`);
      showToast(msg, 'error');
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

  // ---- UI helpers ---------------------------------------------------------------------------
  const activeStep = !progress ? 0 : progress.percent < 25 ? 1 : progress.percent < 50 ? 2 : progress.percent < 93 ? 3 : 4;
  const steps = [
    { n: 1, label: isMm ? 'နားထောင်' : 'Listen', hidden: mode !== 'speech' },
    { n: 2, label: isMm ? 'ကြည့်+ရေး' : 'Watch & write', hidden: false },
    { n: 3, label: isMm ? 'အသံသွင်း' : 'Voice', hidden: false },
    { n: 4, label: isMm ? 'ပေါင်း' : 'Join', hidden: false },
  ].filter(x => !x.hidden);

  const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

  const styles: { id: string; emoji: string; name: string }[] = [
    { id: 'cinematic', emoji: '🎬', name: 'Cinematic' },
    { id: 'tiktok', emoji: '⚡', name: 'Fast Recap' },
    { id: 'thriller', emoji: '🕵️', name: 'Thriller' },
    { id: 'action', emoji: '💥', name: 'Action' },
    { id: 'drama', emoji: '💔', name: 'Drama' },
    { id: 'summary', emoji: '📚', name: 'Summary' },
  ];

  const panel = 'rounded-[28px] border border-white/10 bg-gradient-to-b from-slate-900/90 to-black/90 p-5 sm:p-6 shadow-2xl shadow-black/50';

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className={panel}>
        {/* Header */}
        <div className="flex items-center gap-3.5 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-300 to-orange-500 grid place-items-center shadow-lg shadow-amber-500/30">
            <Clapperboard size={22} className="text-black" />
          </div>
          <div>
            <h2 className="text-lg font-extrabold text-white leading-tight">Auto Recap</h2>
            <p className="text-[12px] text-slate-400">{isMm ? 'ဗီဒီယိုကို ကြည့်ပြီး ဇာတ်ညွှန်း · Voiceover · SRT ထုတ်ပေးမည်' : 'Watches your video → script · voiceover · SRT'}</p>
          </div>
        </div>

        {/* Video */}
        {!file ? (
          <label className="group block rounded-3xl border-2 border-dashed border-white/15 bg-white/[0.02] px-5 py-9 text-center cursor-pointer transition hover:border-amber-400/60 hover:bg-amber-400/[0.04]">
            <input type="file" accept="video/*" className="hidden" onChange={e => pickFile(e.target.files?.[0] || null)} />
            <div className="mx-auto mb-3 w-14 h-14 rounded-2xl bg-amber-400/10 border border-amber-400/30 grid place-items-center group-hover:scale-105 transition">
              <Upload className="text-amber-400" size={24} />
            </div>
            <div className="text-[15px] font-bold text-white">{isMm ? 'Recap လုပ်မယ့် ဗီဒီယိုကို ရွေးပါ' : 'Choose the video to recap'}</div>
            <div className="text-[12px] text-slate-500 mt-1">MP4 · MOV · WebM</div>
          </label>
        ) : (
          <div className="flex items-center gap-3.5 rounded-3xl bg-white/[0.04] border border-white/10 p-3">
            <div className="w-24 h-16 rounded-2xl overflow-hidden bg-black grid place-items-center shrink-0 border border-white/10">
              {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" /> : <Film size={20} className="text-slate-600" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold text-white truncate">{file.name}</div>
              <div className="flex items-center gap-2 mt-1.5 text-[11px] text-slate-400">
                <span className="px-2 py-0.5 rounded-full bg-white/10">{duration > 0 ? fmt(duration) : '…'}</span>
                <span className="px-2 py-0.5 rounded-full bg-white/10">{(file.size / 1048576).toFixed(1)} MB</span>
              </div>
            </div>
            <label className="shrink-0 w-10 h-10 rounded-2xl bg-white/10 hover:bg-white/20 grid place-items-center cursor-pointer transition" title={isMm ? 'ပြောင်းမည်' : 'Change'}>
              <input type="file" accept="video/*" className="hidden" onChange={e => pickFile(e.target.files?.[0] || null)} />
              <RefreshCw size={16} className="text-slate-200" />
            </label>
          </div>
        )}

        {/* What kind of video */}
        <div className="mt-6">
          <Label icon={<Layers size={12} />}>{isMm ? 'ဗီဒီယိုအမျိုးအစား' : 'What to make'}</Label>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { id: 'speech', label: isMm ? '🎙 စကားပြော Video' : '🎙 Talking video' },
              { id: 'visual', label: isMm ? '👁 ပုံကိုကြည့်ပြီး' : '👁 Picture only' },
            ]}
          />
          <p className="mt-2 text-[11.5px] leading-relaxed text-slate-500">
            {mode === 'speech'
              ? isMm ? 'အသံထဲက စကားကို အရင်နားထောင် (AssemblyAI) ပြီး ပုံနဲ့တွဲကြည့်ကာ Recap လုပ်မည်။' : 'Listens to the speech first, then reads it together with the picture.'
              : isMm ? 'Recap ထားပြီးသား / အသံမပါ ဗီဒီယိုအတွက် — စကားမနားထောင်ဘဲ ပုံကိုပဲကြည့်ပြီး Recap အသစ် ပြန်လုပ်မည်။' : 'For already-recapped or silent videos — skips the speech, works from the picture only.'}
          </p>
        </div>

        {/* Coverage */}
        <div className="mt-6">
          <Label icon={<Gauge size={12} />}>{isMm ? 'ဘယ်လောက် ပါမလဲ' : 'Coverage'}</Label>
          <Segmented
            value={length}
            onChange={setLength}
            options={[
              { id: 'short', label: isMm ? 'အဓိက' : 'Highlights', sub: '40%' },
              { id: 'medium', label: isMm ? 'ပုံမှန်' : 'Standard', sub: '70%' },
              { id: 'full', label: isMm ? 'အပြည့်' : 'Whole video', sub: '100%' },
            ]}
          />
        </div>

        {/* Selects */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
          <div>
            <Label icon={<Globe2 size={12} />}>{isMm ? 'Recap ဘာသာစကား' : 'Language'}</Label>
            <Select icon={language === 'mm' ? '🇲🇲' : '🇬🇧'} value={language} onChange={v => setLanguage(v as 'mm' | 'en')}>
              <option value="mm">Burmese · မြန်မာ</option>
              <option value="en">English</option>
            </Select>
          </div>
          <div>
            <Label icon={<Mic size={12} />}>{isMm ? 'AI အသံရှင်' : 'Voice'}</Label>
            <Select icon={VOICE_OPTIONS.find(v => v.id === voice)?.gender === 'female' ? '👩' : '👨'} value={voice} onChange={setVoice}>
              {VOICE_OPTIONS.map(v => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </Select>
          </div>
          {mode === 'speech' && (
            <div>
              <Label>{isMm ? 'စကားပြော ဘာသာစကား' : 'Spoken language'}</Label>
              <Select icon="✨" value={spokenLang} onChange={setSpokenLang}>
                <option value="auto">Auto detect</option>
                <option value="en">English</option><option value="th">Thai</option><option value="ja">Japanese</option>
                <option value="ko">Korean</option><option value="zh">Chinese</option><option value="es">Spanish</option>
                <option value="fr">French</option><option value="de">German</option>
              </Select>
            </div>
          )}
          <div>
            <Label>{isMm ? 'Aspect (ဗီဒီယိုထုတ်ရင်)' : 'Aspect (video export)'}</Label>
            <Select icon="📐" value={aspect} onChange={setAspect}>
              <option value="original">Auto</option><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="1:1">1:1</option>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <Label>{isMm ? 'အသံနှုန်း' : 'Voice speed'}</Label>
              <span className="mb-2 px-2.5 py-0.5 rounded-full bg-amber-400/15 text-amber-300 text-[12px] font-mono font-bold">{speed.toFixed(2)}x</span>
            </div>
            <input type="range" min={0.8} max={1.3} step={0.05} value={speed} onChange={e => setSpeed(Number(e.target.value))} className="w-full h-2 rounded-full accent-amber-400" />
          </div>
        </div>

        {/* Start */}
        <button
          type="button"
          onClick={run}
          disabled={busy || !file}
          className="mt-7 w-full h-14 rounded-2xl bg-gradient-to-r from-amber-300 via-amber-400 to-orange-500 text-black text-[15px] font-extrabold flex items-center justify-center gap-2.5 shadow-xl shadow-amber-500/25 transition active:scale-[0.99] disabled:opacity-40 disabled:shadow-none"
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
          {busy ? (isMm ? 'လုပ်ဆောင်နေသည်…' : 'Working…') : isMm ? 'Auto Recap စတင်မည်' : 'Start Auto Recap'}
        </button>

        {errorInfo && (
          <div className="mt-4 rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-[12px] text-red-200 break-words select-all">
            <div className="font-bold mb-1">{isMm ? '❌ Error — ဒီစာကို ကူးပြီး ပို့ပေးပါ' : '❌ Error — copy this text'}</div>
            {errorInfo}
          </div>
        )}

        {progress && (
          <div className="mt-5 rounded-2xl bg-white/[0.03] border border-white/10 p-4">
            <div className="flex items-center justify-between gap-1 mb-3">
              {steps.map((st, i) => {
                const done = activeStep > st.n || progress.percent >= 100;
                const now = activeStep === st.n && progress.percent < 100;
                return (
                  <React.Fragment key={st.n}>
                    <div className="flex flex-col items-center gap-1.5 min-w-0">
                      <div className={`w-8 h-8 rounded-full grid place-items-center text-[12px] font-bold transition ${done ? 'bg-emerald-400 text-black' : now ? 'bg-amber-400 text-black ring-4 ring-amber-400/25 animate-pulse' : 'bg-white/10 text-slate-500'}`}>
                        {done ? '✓' : st.n}
                      </div>
                      <span className={`text-[10px] font-semibold ${now ? 'text-amber-300' : done ? 'text-emerald-300' : 'text-slate-500'}`}>{st.label}</span>
                    </div>
                    {i < steps.length - 1 && <div className={`h-px flex-1 mb-5 ${done ? 'bg-emerald-400/60' : 'bg-white/10'}`} />}
                  </React.Fragment>
                );
              })}
            </div>
            <div className="text-[12px] text-slate-300 mb-2">{progress.text}</div>
            <div className="h-2 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-amber-300 to-orange-500 transition-all duration-500" style={{ width: `${progress.percent}%` }} />
            </div>
          </div>
        )}
      </div>

      {result && (
        <div className={panel}>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-11 h-11 rounded-2xl bg-emerald-400/15 border border-emerald-400/30 grid place-items-center">
              <CheckCircle2 size={22} className="text-emerald-400" />
            </div>
            <div>
              <div className="text-[15px] font-extrabold text-white">{isMm ? 'Recap ပြီးပါပြီ' : 'Your recap is ready'}</div>
              <div className="text-[12px] text-slate-400">{result.segments.length} {isMm ? 'ပိုင်း' : 'parts'} · {fmt(result.duration)}</div>
            </div>
          </div>

          <audio controls src={result.voiceoverUrl} className="w-full mb-4" />

          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: <Mic size={18} />, name: 'Voiceover', ext: '.wav', tone: 'from-violet-500 to-purple-700 text-white', onClick: () => saveBlob(result.voiceoverBlob, `${baseName}_recap_voiceover.wav`) },
              { icon: <FileText size={18} />, name: 'Subtitles', ext: '.srt', tone: 'from-amber-300 to-orange-500 text-black', onClick: () => downloadSrtFile(result.srt, `${baseName}_recap.srt`) },
              { icon: <FileText size={18} />, name: 'Script', ext: '.txt', tone: 'from-slate-600 to-slate-800 text-white', onClick: () => saveBlob(new Blob(['﻿' + result.script], { type: 'text/plain;charset=utf-8' }), `${baseName}_recap_script.txt`) },
            ].map(d => (
              <button key={d.name} type="button" onClick={d.onClick} className={`rounded-2xl bg-gradient-to-br ${d.tone} p-3.5 text-left shadow-lg shadow-black/40 transition active:scale-[0.98]`}>
                <div className="mb-3 opacity-90">{d.icon}</div>
                <div className="text-[13px] font-extrabold leading-tight">{d.name}</div>
                <div className="text-[11px] opacity-70 font-mono">{d.ext}</div>
              </button>
            ))}
          </div>
          <button type="button" onClick={downloadAll} className="mt-3 w-full h-12 rounded-2xl bg-emerald-400 text-black text-[14px] font-extrabold flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition active:scale-[0.99]">
            <Download size={17} />
            {isMm ? 'အားလုံး တစ်ခါတည်း ဒေါင်းမည်' : 'Download all'}
          </button>
          <p className="mt-3 text-[11.5px] leading-relaxed text-slate-500">
            {isMm ? 'Voiceover နဲ့ SRT က အချိန်တူညီပါတယ် — CapCut Desktop/Web မှာ နှစ်ခုစလုံးကို 0:00 မှာ တင်လိုက်ရုံပါ။' : 'Voiceover and SRT share one timeline — drop both at 0:00 in CapCut Desktop / Web.'}
          </p>

          <details className="mt-5 group rounded-2xl border border-sky-400/25 bg-sky-400/[0.05]">
            <summary className="flex items-center gap-2 cursor-pointer list-none px-4 py-3.5 text-[13px] font-bold text-sky-300">
              <Smartphone size={16} />
              {isMm ? 'ဖုန်း CapCut မှာ သုံးမလား? (SRT မရလို့)' : 'Using CapCut on a phone?'}
              <ChevronDown size={16} className="ml-auto transition group-open:rotate-180" />
            </summary>
            <div className="px-4 pb-4 space-y-3">
              <p className="text-[12px] leading-relaxed text-slate-300">
                {isMm
                  ? 'CapCut ဖုန်းအက်ပ်က စာတန်းဖိုင် (SRT) ကို import မလုပ်နိုင်ပါဘူး၊ ဗီဒီယိုပဲ ရွေးလို့ရတယ်။ ဒါကြောင့် စာတန်းကို ဗီဒီယိုအဖြစ် ထုတ်ပေးပါတယ်။ CapCut မှာ Overlay အဖြစ်ထည့်ပြီး Blend = Screen (အနက်) သို့ Chroma key (အစိမ်း) သုံးပါ။'
                  : 'The CapCut phone app cannot import subtitle files — only videos. So the subtitles come as a video: add it as an Overlay and set Blend = Screen (black) or Chroma key (green).'}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Select value={overlayBg} onChange={v => setOverlayBg(v as 'black' | 'green')}>
                  <option value="black">{isMm ? 'အနက် · Screen' : 'Black · Screen'}</option>
                  <option value="green">{isMm ? 'အစိမ်း · Chroma key' : 'Green · Chroma key'}</option>
                </Select>
                <label className="flex items-center gap-2 rounded-2xl bg-white/[0.04] border border-white/10 px-4 text-[12px] text-slate-200">
                  <input type="checkbox" checked={overlayWithVoice} onChange={e => setOverlayWithVoice(e.target.checked)} className="accent-sky-400" />
                  {isMm ? 'အသံပါထည့်' : 'With voice'}
                </label>
              </div>
              <button type="button" onClick={buildOverlay} disabled={overlayBusy !== null} className="w-full h-12 rounded-2xl bg-sky-400 text-black text-[13px] font-extrabold flex items-center justify-center gap-2 disabled:opacity-60">
                {overlayBusy !== null ? <Loader2 size={16} className="animate-spin" /> : <Film size={16} />}
                {overlayBusy !== null
                  ? `${isMm ? 'ထုတ်နေသည်… စာမျက်နှာကို မပိတ်ပါနဲ့' : 'Rendering… keep this page open'} ${Math.round(overlayBusy * 100)}%`
                  : isMm ? 'Subtitle Overlay ဗီဒီယို ထုတ်မည်' : 'Make subtitle overlay video'}
              </button>
              {overlayFile && (
                <button type="button" onClick={saveOverlay} className="w-full h-12 rounded-2xl bg-emerald-400 text-black text-[13px] font-extrabold flex items-center justify-center gap-2">
                  <Download size={16} />
                  {isMm ? 'သိမ်းမည် (iPhone: "Save Video")' : 'Save (iPhone: "Save Video")'}
                </button>
              )}
            </div>
          </details>

          <div className="mt-5">
            <Label>{isMm ? 'Recap ဇာတ်ညွှန်း' : 'Script'}</Label>
            <textarea readOnly value={result.script} className="w-full h-64 rounded-2xl bg-black/50 border border-white/10 p-4 text-[13px] leading-[1.9] text-slate-200 focus:outline-none" />
          </div>

          <div className="mt-5 pt-5 border-t border-white/10">
            <Label icon={<Film size={12} />}>{isMm ? 'Recap ဗီဒီယိုပါ လိုချင်ရင် (PC Worker လိုသည်)' : 'Recap video (needs PC worker)'}</Label>
            <button type="button" onClick={buildVideo} disabled={!!rendering || !result.hasVideoTimes} className="w-full h-12 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/10 text-white text-[13px] font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition">
              {rendering ? <Loader2 size={16} className="animate-spin" /> : <Film size={16} />}
              {rendering || (isMm ? 'Recap ဗီဒီယို ထုတ်မည်' : 'Render recap video')}
            </button>
            {videoUrl && (
              <a href={videoUrl} download={`${baseName}_recap.mp4`} className="mt-3 flex items-center justify-center gap-2 h-12 rounded-2xl bg-emerald-400 text-black text-[13px] font-extrabold">
                <Download size={16} />{isMm ? 'Recap ဗီဒီယို ဒေါင်းမည် (.mp4)' : 'Download recap video (.mp4)'}
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
