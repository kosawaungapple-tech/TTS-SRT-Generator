import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clapperboard, Upload, Download, Sparkles, Mic, FileText, Film, Loader2, CheckCircle2, Eye, MessageSquareText, ChevronDown, RefreshCw, Smartphone, Globe2, Gauge, Layers } from 'lucide-react';
import { useActivity } from '../services/activity';
import { GeminiTTSService, type RecapPlanScene } from '../services/geminiService';
import { assemblyAiService } from '../services/assemblyAiService';
import { apiChannelManager } from '../services/apiChannelManager';
import { renderSceneRecap } from '../services/recapRenderService';
import { captureVideoFrames } from '../utils/videoFrames';
import { applyLoudnessGain, audioBufferToWav, normalizeLoudness, renderProcessedAudio } from '../utils/audioUtils';
import { generateSRT, downloadSrtFile, splitSentenceIntoCueBlocks } from '../utils/subtitleUtils';
import { getRecapOutputSize, planSubtitlePieces } from '../utils/recapGeometry';
import { renderSubtitleVideo } from '../utils/subtitleVideo';
import { extractSpeechWav } from '../utils/voiceAudio';
import { getCustomPronunciation, setCustomPronunciation } from '../utils/pronunciation';
import { RecapPreview } from './RecapPreview';
import { FfmpegWorkerManager } from './FfmpegWorkerManager';
import { RecapShare } from './RecapShare';
import { SceneEditor } from './SceneEditor';
import { TextLayersEditor } from './TextLayersEditor';
import { renderTextLayerPng, type TextLayer } from '../utils/recapTextLayers';
import { getExtraKeys } from '../services/geminiKeyPool';
import { authHeader } from '../services/serverAuth';
import { loadLogoImage, renderLogoPng, type LogoPosition } from '../utils/recapLogo';
import { SUBTITLE_PRESETS, getSubtitleStyle } from '../utils/subtitlePresets';
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
  sceneTimes: { start: number; dur: number }[];
  srt: string;
  cues: { start: number; end: number; text: string }[];
  duration: number;
}

// One steady narrator in every scene: separate TTS calls can drift into different-sounding voices.
const NARRATOR_STYLE = 'Read as ONE single narrator with the exact same voice, pitch, age and pace in every part. Never act out characters or change voice for quoted speech or dialogue; keep a steady, warm storyteller tone.';

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
  <div className="flex items-center gap-1.5 mb-2 text-[11.5px] font-semibold tracking-wide text-slate-400">
    {icon}
    <span>{children}</span>
  </div>
);

const Group: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <section className="mt-4 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
    <div className="flex items-center gap-2.5 mb-4">
      <span className="w-6 h-6 rounded-full bg-amber-400/15 border border-amber-400/30 text-amber-300 text-[11px] font-extrabold grid place-items-center">{n}</span>
      <h3 className="text-[13px] font-extrabold text-white tracking-tight">{title}</h3>
    </div>
    {children}
  </section>
);

const Select: React.FC<{ icon?: React.ReactNode; value: string; onChange: (v: string) => void; children: React.ReactNode }> = ({ icon, value, onChange, children }) => (
  <div className="relative">
    {icon && <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-base leading-none pointer-events-none">{icon}</span>}
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{ colorScheme: 'dark' }}
      className={`w-full appearance-none [&>option]:bg-slate-900 [&>option]:text-white rounded-2xl bg-white/[0.04] border border-white/10 py-3.5 pr-10 text-[13px] font-medium text-white shadow-inner shadow-black/30 transition focus:outline-none focus:border-amber-400/60 focus:bg-white/[0.07] ${icon ? 'pl-11' : 'pl-4'}`}
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
  const baseRef = useRef<{ segments: Segment[]; sceneAudios: Blob[] } | null>(null);
  const baseVer = useRef(0);
  const lapRef = useRef<{ name: string; at: number }>({ name: '', at: 0 });
  /** Writes "how long the previous step took" into the activity log, so a slow step is easy to spot. */
  const lap = (next: string) => {
    const now = Date.now();
    const prev = lapRef.current;
    if (prev.name) {
      const sec = Math.round((now - prev.at) / 1000);
      setProgress(p => ({ text: `⏱ ${prev.name}: ${sec}s`, percent: p?.percent ?? 0 }));
    }
    lapRef.current = { name: next, at: now };
  };
  const [result, setResult] = useState<Result | null>(null);
  const [rendering, setRendering] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const draftRef = useRef<{ segments: Segment[]; hasVideoTimes: boolean; audios?: Blob[] } | null>(null);
  const [canResume, setCanResume] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [errorInfo, setErrorInfo] = useState<string | null>(null);
  useActivity(busy, isMm ? 'Auto Recap လုပ်နေသည်' : 'Auto Recap running', { detail: progress?.text, percent: progress?.percent, failed: errorInfo });
  const stageRef = useRef('start');
  const [thumb, setThumb] = useState<string | null>(null);
  const [subPreset, setSubPreset] = useState('viral');
  const [subY, setSubY] = useState(84);
  const [subScale, setSubScale] = useState(1);
  const [framing, setFraming] = useState<'blurred-fit' | 'cover' | 'letterbox'>('blurred-fit');
  const [blurAmount, setBlurAmount] = useState(40);
  const [textLayers, setTextLayers] = useState<TextLayer[]>([]);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [bri, setBri] = useState(0);
  const [con, setCon] = useState(1);
  const [sat, setSat] = useState(1);
  const adjusted = zoom !== 1 || bri !== 0 || con !== 1 || sat !== 1;
  const adjust = adjusted ? { zoom, panX, panY, brightness: bri, contrast: con, saturation: sat } : undefined;
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [srcRatio, setSrcRatio] = useState(0);
  const [pron, setPron] = useState(getCustomPronunciation());
  const [reviewScript, setReviewScript] = useState(true);
  const [draft, setDraft] = useState<{ segments: Segment[]; hasVideoTimes: boolean } | null>(null);
  const [blurSubOn, setBlurSubOn] = useState(false);
  const [blurSubY, setBlurSubY] = useState(78);
  const [blurSubH, setBlurSubH] = useState(16);
  const [bgmFile, setBgmFile] = useState<File | null>(null);
  const [bgmVol, setBgmVol] = useState(0.2);
  const [logoImg, setLogoImg] = useState<HTMLImageElement | null>(null);
  const [logoName, setLogoName] = useState('');
  const [logoText, setLogoText] = useState('');
  const [logoPos, setLogoPos] = useState<LogoPosition>('tr');
  const [logoSize, setLogoSize] = useState(14);
  const [logoOpacity, setLogoOpacity] = useState(0.9);
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

  const run = async (resume = false) => {
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
    stageRef.current = 'start'; lapRef.current = { name: '', at: Date.now() };
    setResult(null);
    setVideoUrl(null);
    setDraft(null);
    setCanResume(false);
    if (!resume) draftRef.current = null;
    try {
      const g = gemini();
      let segments: Segment[] = [];
      let hasVideoTimes = true;
      if (resume && draftRef.current) {
        segments = draftRef.current.segments.filter(sg => sg.text.trim());
        hasVideoTimes = draftRef.current.hasVideoTimes;
        if (!segments.length) throw new Error(isMm ? 'ဇာတ်ညွှန်း ဗလာဖြစ်နေသည်' : 'The script is empty');
      } else {
      // ---- 1. Listen (only for talking videos) ----------------------------------------------
      let cues: { start: number; end: number; text: string }[] = [];
      if (mode === 'speech') {
        const key = assemblyAiService.getStoredApiKey();
        if (!key) {
          showToast(isMm ? 'Settings ထဲမှာ AssemblyAI API Key အရင်ထည့်ပါ' : 'Add your AssemblyAI API key in Settings first', 'error');
          onNavigateToSettings?.();
          return;
        }
        stageRef.current = '1 listen (AssemblyAI)'; lap('1 listen (AssemblyAI)');
        setProgress({ text: isMm ? '၁/၄ စကားပြောကို နားထောင်နေသည်…' : '1/4 Listening to the speech…', percent: 3 });
        // Upload only the sound (small WAV) instead of the whole video: big uploads from a phone often die with "Load failed".
        const speech = (await extractSpeechWav(file)) || file;
        const tr = await assemblyAiService.processToSrt({
          apiKey: key,
          file: speech,
          languageCode: spokenLang,
          autoLanguage: spokenLang === 'auto',
          speakerLabels: false,
          speechModel: 'best',
          onProgress: (step, percent) => setProgress({ text: `${isMm ? '၁/၄ ' : '1/4 '}${step}`, percent: Math.min(25, Math.round((percent ?? 0) * 0.25)) }),
        });
        cues = parseSrtCues(tr.srt);
      }

      // ---- 2. Watch + write ------------------------------------------------------------------
      stageRef.current = '2 watch/write (Gemini)'; lap('2 watch/write (Gemini)');
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
          coverage: length === 'short' ? 0.55 : length === 'full' ? 1 : 0.85,
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

      draftRef.current = { segments, hasVideoTimes };
      if (reviewScript) {
        // Pause here so the script can be edited before any voice is recorded.
        draftRef.current = { segments, hasVideoTimes };
        setDraft({ segments, hasVideoTimes });
        setProgress(null);
        showToast(isMm ? 'ဇာတ်ညွှန်း ရပါပြီ — ပြင်ချင်ရင် ပြင်ပြီး "အသံသွင်းမည်" ကို နှိပ်ပါ' : 'Script ready — edit it if you like, then press "Record voiceover"', 'success');
        return;
      }
      }

      // ---- 3. Voice every scene --------------------------------------------------------------
      stageRef.current = '3 voiceover (Gemini TTS)'; lap('3 voiceover (Gemini TTS)');
      const Ctx0 = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      // On a resumed run the scenes already voiced are kept; only the rest is recorded.
      const sceneAudios: Blob[] = resume && draftRef.current?.audios ? [...draftRef.current.audios] : [];
      if (sceneAudios.length > segments.length) sceneAudios.length = segments.length;
      // The voiceover must fit the video: each scene gets the time of the part of the video it tells.
      const coverageFactor = length === 'short' ? 0.55 : length === 'full' ? 1 : 0.85;
      const totalTarget = duration > 0 ? duration * coverageFactor : 0;
      const totalChars = segments.reduce((n, sg) => n + sg.text.length, 0) || 1;
      const lang: 'mm' | 'en' = language === 'en' ? 'en' : 'mm';
      const durOf = async (blob: Blob) => {
        const c = new Ctx0();
        try { return (await c.decodeAudioData(await blob.arrayBuffer())).duration; } finally { void c.close(); }
      };
      const speakOnce = async (text: string, i: number) => {
        const r = await g.generateTTS(text, { voiceId: voice, speed, pitch: 0, volume: 100, vocalStyle: 'Expressive', styleInstruction: NARRATOR_STYLE }, undefined, undefined, (s, msg) =>
          setProgress(p => ({ text: `${msg} (${s}s)`, percent: p?.percent ?? 60 }))
        );
        if (!r?.audioUrl) throw new Error(`No audio for part ${i + 1}`);
        const blob = await (await fetch(r.audioUrl)).blob();
        if (!blob.size) throw new Error(`Empty audio for part ${i + 1}`);
        return blob;
      };
      // Scenes are voiced a few at a time (the API allows it) instead of one after another.
      const voiced: (Blob | undefined)[] = segments.map((_, i) => sceneAudios[i]);
      let finished = voiced.filter(Boolean).length;
      const pending = voiced.map((v, i) => (v ? -1 : i)).filter(i => i >= 0);
      const CONC = getExtraKeys().length > 0 ? 3 : 2;
      let failure: unknown = null;
      const worker = async () => {
        while (pending.length && !failure) {
          if (ctrl.signal.aborted) { failure = new Error('Cancelled'); return; }
          const i = pending.shift() as number;
          const t0 = Date.now();
          try {
            let blob = await speakOnce(segments[i].text, i);
            if (totalTarget > 0) {
              const budget = Math.max(
                2,
                (hasVideoTimes ? (segments[i].end - segments[i].start) * coverageFactor : (totalTarget * segments[i].text.length) / totalChars) - GAP
              );
              let dur = await durOf(blob);
              if (dur > budget * 1.02) {
                // 1) cheap and instant: speed the voice up locally (pitch-preserving) up to 1.25x — no extra API calls
                const MAX_FAST = 1.25;
                setProgress(p => ({ text: `${isMm ? '၃/၄ ဗီဒီယိုအချိန်နဲ့ ကိုက်အောင် ညှိနေသည်' : '3/4 Fitting the narration to the video'} (${i + 1}/${segments.length})`, percent: p?.percent ?? 60 }));
                if (dur / budget > MAX_FAST) {
                  // 2) only if it is far too long: shorten the paragraph and voice it again (slow: 2 more API calls)
                  const target = Math.max(20, Math.round(segments[i].text.length * ((budget * MAX_FAST) / dur) * 0.97));
                  const shorter = await g.condenseNarration(segments[i].text, target, lang);
                  if (shorter) {
                    const b2 = await speakOnce(shorter, i);
                    const d2 = await durOf(b2);
                    if (d2 < dur) { segments[i] = { ...segments[i], text: shorter }; blob = b2; dur = d2; }
                  }
                }
                const rate = Math.min(MAX_FAST, dur / budget);
                if (rate > 1.03) {
                  try { blob = (await renderProcessedAudio(blob, { speed: rate })).blob; } catch { /* keep as is */ }
                }
              }
            }
            voiced[i] = blob;
            finished++;
            console.info(`[Auto Recap] scene ${i + 1}/${segments.length} voiced in ${Math.round((Date.now() - t0) / 1000)}s`);
            setProgress(p => ({ text: `${isMm ? '၃/၄ အသံသွင်းနေသည်' : '3/4 Recording the voiceover'} (${finished}/${segments.length})`, percent: 50 + Math.round((finished / segments.length) * 40) }));
            // keep a resumable draft: the finished scenes from the start
            const prefix: Blob[] = [];
            for (const v of voiced) { if (!v) break; prefix.push(v); }
            draftRef.current = { segments, hasVideoTimes, audios: prefix };
          } catch (e) { failure = failure || e; }
        }
      };
      await Promise.all(Array.from({ length: CONC }, () => worker()));
      if (failure) throw failure;
      sceneAudios.length = 0;
      voiced.forEach(v => { if (v) sceneAudios.push(v); });

      // ---- 4. Join voiceover + build the SRT on the same timeline ---------------------------
      stageRef.current = '4 join audio'; lap('4 join audio');
      setProgress({ text: isMm ? '၄/၄ Voiceover နဲ့ SRT ပေါင်းနေသည်' : '4/4 Joining voiceover and subtitles', percent: 93 });
      const joined = await joinScenes(segments, sceneAudios, true);

      setResult({
        script: segments.map(s => s.text).join('\n\n'),
        segments,
        hasVideoTimes,
        voiceoverBlob: joined.voiceoverBlob,
        voiceoverUrl: URL.createObjectURL(joined.voiceoverBlob),
        sceneAudios: joined.sceneAudios,
        sceneTimes: joined.sceneTimes,
        srt: joined.srt,
        cues: joined.cues,
        duration: joined.duration,
      });
      baseRef.current = { segments: segments.map(sg => ({ ...sg })), sceneAudios: joined.sceneAudios };
      baseVer.current++;
      draftRef.current = null;
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
      if (draftRef.current) setCanResume(true);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!file) { setSrcUrl(null); setSrcRatio(0); return; }
    const u = URL.createObjectURL(file);
    setSrcUrl(u);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => setSrcRatio(v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 0);
    v.src = u;
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const baseName = (file?.name || 'recap').replace(/\.[^/.]+$/, '');
  const [dlBusy, setDlBusy] = useState(false);
  /** Applies the scene editor: skipped scenes are dropped, the rest are re-ordered / re-trimmed, and the voiceover + subtitles are rebuilt to match. */
  const applySceneEdits = async (plan: { idx: number; on: boolean; start: number; end: number }[]) => {
    const base = baseRef.current;
    if (!base || !result) return;
    const kept = plan.filter(p => p.on);
    if (!kept.length) { showToast(isMm ? 'အနည်းဆုံး scene တစ်ခု ရှိရပါမယ်' : 'Keep at least one scene', 'error'); return; }
    try {
      const segments = kept.map(p => ({ start: p.start, end: p.end, text: base.segments[p.idx].text }));
      const joined = await joinScenes(segments, kept.map(p => base.sceneAudios[p.idx]), false);
      URL.revokeObjectURL(result.voiceoverUrl);
      setResult({
        ...result,
        segments,
        script: segments.map(sg => sg.text).join('\n\n'),
        voiceoverBlob: joined.voiceoverBlob,
        voiceoverUrl: URL.createObjectURL(joined.voiceoverBlob),
        sceneAudios: joined.sceneAudios,
        sceneTimes: joined.sceneTimes,
        srt: joined.srt,
        cues: joined.cues,
        duration: joined.duration,
      });
      setVideoUrl(null);
      showToast(isMm ? 'ပြင်ဆင်ချက်တွေ အသုံးပြုပြီးပါပြီ — Preview နဲ့ render မှာ ပါပါမယ်' : 'Edits applied — used by the preview and the render', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not apply the edits', 'error');
    }
  };
  const downloadVideo = async () => {
    if (!videoUrl) return;
    setDlBusy(true);
    try {
      const blob = await (await fetch(videoUrl)).blob();
      if (!blob.size) throw new Error('empty');
      saveBlob(blob, `${baseName}_recap.mp4`);
    } catch {
      // the file may have expired on the worker (hosted files are deleted after a while) or the worker is unreachable
      showToast?.(isMm ? 'ဗီဒီယို ဒေါင်းမရပါ — Worker ပိတ်သွားခြင်း သို့မဟုတ် ဖိုင် သက်တမ်းကုန်ခြင်း ဖြစ်နိုင်ပါတယ်၊ ပြန် render လုပ်ပါ' : 'Could not download — the worker may be offline or the file expired. Render again.', 'error');
      window.open(videoUrl, '_blank', 'noopener');
    } finally { setDlBusy(false); }
  };

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
      const [width, height] = aspect === '9:16' ? [720, 1280] : aspect === '1:1' ? [720, 720] : aspect === '4:5' ? [720, 900] : [1280, 720];
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
        style: getSubtitleStyle(subPreset, subY, subScale),
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
      // Regular users render on the hosted server (short-lived signed token); admins keep using their own local PC worker.
      let serverUrl: string | undefined;
      let authToken: string | undefined;
      if (!isAdmin) {
        let code = '';
        try { code = localStorage.getItem('vbs_access_code') || ''; } catch { /* storage unavailable */ }
        const tr = await fetch('/api/render/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
          body: JSON.stringify({ accessCode: code }),
        }).catch(() => null);
        const td = tr ? await tr.json().catch(() => ({})) : {};
        if (!tr || !tr.ok || !td.token) {
          const reason = td?.error === 'not_granted'
            ? (isMm ? 'Recap ဗီဒီယို render လုပ်ခွင့်ကို Admin က မပေးရသေးပါ' : 'The admin has not allowed video rendering for your account yet')
            : td?.error === 'worker_offline'
            ? (isMm ? 'Render လုပ်ပေးမယ့် PC က အခု ပိတ်ထားပါတယ် — Admin က PC ဖွင့်မှ ပြန်ကြိုးစားပါ' : 'The render PC is offline right now — try again when the admin turns it on')
            : td?.error === 'not_configured'
            ? (isMm ? 'Render server မတပ်ဆင်ရသေးပါ — Admin ကို ဆက်သွယ်ပါ' : 'The render server is not set up yet — contact the admin')
            : td?.message || (isMm ? 'Render server နဲ့ မချိတ်နိုင်ပါ' : 'Could not reach the render server');
          throw new Error(reason);
        }
        serverUrl = td.url;
        authToken = td.token;
      }
      const scenes: RecapPlanScene[] = result.segments.map((s, i) => ({ fromCue: i, toCue: i, start: s.start, end: s.end, narration: s.text }));
      const r = await renderSceneRecap({
        serverUrl,
        authToken,
        gemini: gemini(),
        videoFile: file,
        videoFileName: file.name,
        scenes,
        audios: result.sceneAudios,
        tts: { voiceId: voice, speed, pitch: 0, volume: 100 },
        outputWidth: w,
        outputHeight: h,
        aspectRatio: aspect,
        framing,
        blurAmount,
        adjust: adjust || null,
        textLayers: (await Promise.all(textLayers.map(async l => ({ png: await renderTextLayerPng(l, w, h), start: l.start, end: l.end }))))
          .filter((t): t is { png: Blob; start: number; end: number } => !!t.png),
        bgColor: '#000000',
        subtitleStyle: getSubtitleStyle(subPreset, subY, subScale),
        subtitleBlur: blurSubOn ? { y: blurSubY / 100, h: blurSubH / 100 } : null,
        bgm: bgmFile,
        bgmVolume: bgmVol,
        logoPng: await renderLogoPng({ image: logoImg, text: logoText, position: logoPos, sizePct: logoSize, opacity: logoOpacity }, w, h),
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

  const settingsBlock = (
    <>
        {/* What kind of video */}
        <Group n={1} title={isMm ? 'အကြောင်းအရာ' : 'Content'}>
        <div>
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
        <div className="mt-5">
          <Label icon={<Gauge size={12} />}>{isMm ? 'ဘယ်လောက် ပါမလဲ' : 'Coverage'}</Label>
          <Segmented
            value={length}
            onChange={setLength}
            options={[
              { id: 'short', label: isMm ? 'အဓိက' : 'Highlights', sub: '55%' },
              { id: 'medium', label: isMm ? 'ပုံမှန်' : 'Standard', sub: '85%' },
              { id: 'full', label: isMm ? 'အပြည့်' : 'Whole video', sub: '100%' },
            ]}
          />
        </div>

        </Group>

        {/* Selects */}
        <Group n={2} title={isMm ? 'ဘာသာစကားနဲ့ အသံ' : 'Language & voice'}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-x-4 gap-y-5">
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
          <div className="sm:col-span-2 lg:col-span-1">
            <div className="flex items-center justify-between mb-2">
              <Label>{isMm ? 'အသံနှုန်း' : 'Voice speed'}</Label>
              <span className="mb-2 px-2.5 py-0.5 rounded-full bg-amber-400/15 text-amber-300 text-[12px] font-mono font-bold">{speed.toFixed(2)}x</span>
            </div>
            <input type="range" min={0.8} max={1.3} step={0.05} value={speed} onChange={e => setSpeed(Number(e.target.value))} className="w-full h-2 rounded-full accent-amber-400" />
          </div>
        </div>

        </Group>
    </>
  );

  return (
    <div className="max-w-2xl lg:max-w-none mx-auto space-y-5 lg:space-y-0 lg:grid lg:grid-cols-12 lg:gap-6 lg:items-start">
      <div className={`${panel} lg:col-span-5 xl:col-span-4 lg:order-2`}>
        {/* Header */}
        <div className="flex items-center gap-3.5 mb-5 pb-5 border-b border-white/10">
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
          <label className="lg:hidden group block rounded-3xl border-2 border-dashed border-white/15 bg-white/[0.02] px-5 py-9 text-center cursor-pointer transition hover:border-amber-400/60 hover:bg-amber-400/[0.04]">
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

        <div className="lg:hidden">{settingsBlock}</div>

        {/* Start */}
        <div className="lg:sticky lg:bottom-3 z-10 mt-4 -mx-1 px-1 pt-2 pb-1 bg-gradient-to-t from-black via-black/95 to-transparent rounded-b-2xl">
        <button
          type="button"
          onClick={() => void run(false)}
          disabled={busy || !file}
          className="w-full h-14 rounded-2xl bg-gradient-to-r from-amber-300 via-amber-400 to-orange-500 text-black text-[15px] font-extrabold flex items-center justify-center gap-2.5 shadow-xl shadow-amber-500/25 transition active:scale-[0.99] disabled:opacity-40 disabled:shadow-none"
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
          {busy ? (isMm ? 'လုပ်ဆောင်နေသည်…' : 'Working…') : isMm ? 'Auto Recap စတင်မည်' : 'Start Auto Recap'}
        </button>

        <label className="mt-2 flex items-center gap-2.5 rounded-2xl bg-white/[0.04] border border-white/10 px-4 py-3 text-[12.5px] text-slate-200 cursor-pointer">
          <input type="checkbox" checked={reviewScript} onChange={e => setReviewScript(e.target.checked)} className="accent-amber-400 w-4 h-4" />
          {isMm ? '✍️ အသံမသွင်းခင် ဇာတ်ညွှန်းကို ပြင်ခွင့်ရအောင် ခဏရပ်ပါ' : '✍️ Pause to let me edit the script before recording'}
        </label>
        </div>

        <details className="mt-3 rounded-2xl bg-white/[0.04] border border-white/10">
          <summary className="cursor-pointer list-none px-4 py-3 text-[12.5px] text-slate-200 flex items-center gap-2">
            🔤 {isMm ? 'အသံထွက် ပြင်ဆင်ချက် (မှားဖတ်တဲ့စာလုံး)' : 'Pronunciation fixes (words read wrongly)'}
            <ChevronDown size={14} className="ml-auto" />
          </summary>
          <div className="px-4 pb-4">
            <p className="text-[11.5px] text-slate-400 mb-2">
              {isMm ? 'တစ်ကြောင်းကို စာလုံး -> ဖတ်စေချင်တဲ့ရေးပုံ ပုံစံနဲ့ ရေးပါ။ အသံထွက်ကိုပဲ ပြောင်းပြီး စာတန်းမှာ မူရင်းစာပဲ ပေါ်ပါမယ်။ "အံ့ဩ" ကိုတော့ ပြင်ထားပြီးသားပါ။' : 'One per line: word -> how to write it so it is read right. Only the spoken text changes; subtitles keep the original. "အံ့ဩ" is already fixed.'}
            </p>
            <textarea
              value={pron}
              onChange={e => { setPron(e.target.value); setCustomPronunciation(e.target.value); }}
              rows={4}
              placeholder={'ဥပမာ - စာလုံး -> ဖတ်စေချင်တဲ့ရေးပုံ'}
              className="w-full rounded-xl bg-black/50 border border-white/10 p-3 text-[13px] text-slate-100 focus:outline-none focus:border-amber-400/60"
            />
          </div>
        </details>

        {draft && !busy && (
          <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/[0.05] p-4">
            <div className="text-[13px] font-extrabold text-amber-200 mb-1">{isMm ? '📝 ဇာတ်ညွှန်း — ပြင်လို့ရပါတယ်' : '📝 Script — editable'}</div>
            <p className="text-[11.5px] text-slate-400 mb-3">{isMm ? 'စာပိုဒ်တစ်ခုစီက ဗီဒီယိုရဲ့ အပိုင်းတစ်ခုနဲ့ ကိုက်ပါတယ်။ ဖျက်ချင်ရင် စာကို ဗလာထားပါ။ ရှည်လွန်းရင် အသံသွင်းချိန်မှာ အလိုအလျောက် တိုအောင် ညှိပါလိမ့်မယ်။' : 'Each paragraph matches one part of the video. Clear a paragraph to drop it. Overlong ones are shortened automatically when recording.'}</p>
            <div className="space-y-3">
              {draft.segments.map((sg, i) => (
                <div key={i}>
                  <div className="text-[10.5px] font-mono text-slate-500 mb-1">
                    {i + 1}{draft.hasVideoTimes ? ` · ${fmt(sg.start)}–${fmt(sg.end)}` : ''}
                  </div>
                  <textarea
                    value={sg.text}
                    onChange={e => {
                      const text = e.target.value;
                      setDraft(d => {
                        if (!d) return d;
                        const segs = d.segments.map((x, k) => (k === i ? { ...x, text } : x));
                        draftRef.current = { segments: segs, hasVideoTimes: d.hasVideoTimes };
                        return { ...d, segments: segs };
                      });
                    }}
                    rows={Math.max(3, Math.ceil(sg.text.length / 38))}
                    className="w-full rounded-xl bg-black/50 border border-white/10 p-3 text-[13px] leading-[1.9] text-slate-100 focus:outline-none focus:border-amber-400/60"
                  />
                </div>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <button type="button" onClick={() => { setDraft(null); draftRef.current = null; }} className="h-12 rounded-2xl bg-white/10 text-white text-[12.5px] font-bold">{isMm ? 'ပယ်ဖျက်' : 'Discard'}</button>
              <button type="button" onClick={() => void run(true)} className="col-span-2 h-12 rounded-2xl bg-emerald-400 text-black text-[13px] font-extrabold flex items-center justify-center gap-2">
                <Mic size={16} />{isMm ? 'အသံသွင်းမည်' : 'Record voiceover'}
              </button>
            </div>
          </div>
        )}

        {errorInfo && (
          <div className="mt-4 rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-[12px] text-red-200 break-words select-all">
            <div className="font-bold mb-1">{isMm ? '❌ Error — ဒီစာကို ကူးပြီး ပို့ပေးပါ' : '❌ Error — copy this text'}</div>
            {errorInfo}
            {canResume && !busy && (
              <button type="button" onClick={() => void run(true)} className="mt-3 w-full h-11 rounded-xl bg-emerald-400 text-black text-[12.5px] font-extrabold flex items-center justify-center gap-2">
                <RefreshCw size={15} />
                {isMm
                  ? `ဆက်လုပ်မည် (ပြီးသွားတဲ့ အပိုင်း ${draftRef.current?.audios?.length ?? 0} ခုကို ပြန်မလုပ်ဘူး)`
                  : `Continue (keeps the ${draftRef.current?.audios?.length ?? 0} parts already voiced)`}
              </button>
            )}
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

      <div className="lg:col-span-7 xl:col-span-8 lg:order-1 space-y-5 min-w-0">
      {!result && (
        <div className={`${panel} hidden lg:grid min-h-[440px] place-items-center text-center`}>
          {!file ? (
            <label className="group w-full h-full min-h-[500px] grid place-items-center rounded-3xl border-2 border-dashed border-white/15 bg-white/[0.015] cursor-pointer transition hover:border-amber-400/60 hover:bg-amber-400/[0.04]">
              <input type="file" accept="video/*" className="hidden" onChange={e => pickFile(e.target.files?.[0] || null)} />
              <div className="max-w-md px-6">
                <div className="mx-auto mb-5 w-20 h-20 rounded-3xl bg-amber-400/10 border border-amber-400/30 grid place-items-center group-hover:scale-105 transition">
                  <Upload className="text-amber-400" size={34} />
                </div>
                <div className="text-xl font-extrabold text-white mb-1.5">{isMm ? 'Recap လုပ်မယ့် ဗီဒီယိုကို ဒီမှာ ရွေးပါ' : 'Drop or choose a video to recap'}</div>
                <p className="text-[13px] leading-relaxed text-slate-400">{isMm ? 'MP4 · MOV · WebM — ညာဘက်မှာ ဆက်တင်တွေ ရွေးပြီး Auto Recap စတင်ပါ။ ပြီးရင် ရလဒ်ကို ဒီနေရာမှာ ကြည့်ပြီး ပြင်လို့ရမယ်။' : 'MP4 · MOV · WebM — pick your settings on the right, then start. The result shows up here, ready to edit.'}</p>
              </div>
            </label>
          ) : (
            <div className="w-full">
              <div className="mx-auto max-w-[520px] aspect-video rounded-3xl overflow-hidden bg-black border border-white/10 grid place-items-center shadow-2xl shadow-black/60">
                {thumb ? <img src={thumb} alt="" className="w-full h-full object-contain" /> : <Film size={40} className="text-slate-600" />}
              </div>
              <div className="mt-5 text-[15px] font-extrabold text-white truncate">{file.name}</div>
              <div className="mt-2 flex items-center justify-center gap-2 text-[11.5px] text-slate-400">
                <span className="px-2.5 py-1 rounded-full bg-white/10">{duration > 0 ? fmt(duration) : '…'}</span>
                <span className="px-2.5 py-1 rounded-full bg-white/10">{(file.size / 1048576).toFixed(1)} MB</span>
              </div>
              <p className="mt-4 text-[12.5px] text-slate-400">{isMm ? 'အဆင်သင့်ပါပြီ — ညာဘက်က “Auto Recap စတင်မည်” ကို နှိပ်ပါ။' : 'Ready — press “Start Auto Recap” on the right.'}</p>
            </div>
          )}
        </div>
      )}

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

          <div className="2xl:grid 2xl:grid-cols-[minmax(340px,440px)_minmax(0,1fr)] 2xl:gap-8 items-start">
            {/* Left: what you hear and see */}
            <div className="xl:sticky xl:top-4">
          <audio controls src={result.voiceoverUrl} className="w-full mb-4" />

            {/* Live preview: the recap itself (voice + subtitles + matching footage) with the chosen look */}
            <div>
              <Label>{isMm ? 'ကြိုကြည့် (Recap အသံ + စာတန်းနဲ့)' : 'Preview (recap voice + subtitles)'}</Label>
              <RecapPreview
                srcUrl={srcUrl}
                thumb={thumb}
                srcRatio={srcRatio}
                aspect={aspect}
                framing={framing}
                blurAmount={blurAmount}
                adjust={adjust}
                textLayers={textLayers}
                subPreset={subPreset}
                subY={subY}
                subScale={subScale}
                blurBand={blurSubOn ? { y: blurSubY / 100, h: blurSubH / 100 } : null}
                logoImg={logoImg}
                logoText={logoText}
                logoPos={logoPos}
                logoSize={logoSize}
                logoOpacity={logoOpacity}
                recap={result ? { voiceoverUrl: result.voiceoverUrl, cues: result.cues, duration: result.duration, sceneTimes: result.sceneTimes, segments: result.segments, hasVideoTimes: result.hasVideoTimes } : null}
                isMm={isMm}
              />
              <p className="mt-2 text-[11px] text-slate-500">{isMm ? 'ဒါက Recap အသံ၊ စာတန်း၊ ဗီဒီယိုအပိုင်းတွေကို ဘရောက်ဇာထဲမှာ တွဲဖွင့်ပြတာပါ။ BGM မပါပါဘူး၊ ထွက်လာမယ့် mp4 နဲ့ အတိအကျ မတူနိုင်ပါဘူး။' : 'The recap voice, subtitles and matching footage played together in your browser. No BGM, and not frame-exact with the final mp4.'}</p>
            </div>

          {baseRef.current && result.hasVideoTimes && (
            <div className="mt-5 pt-5 border-t border-white/10">
              <SceneEditor
                key={baseVer.current}
                base={baseRef.current.segments}
                srcUrl={srcUrl}
                videoDuration={duration}
                isMm={isMm}
                onApply={applySceneEdits}
              />
            </div>
          )}
          {result.hasVideoTimes && (
            <div className="mt-5 pt-5 border-t border-white/10">
              <TextLayersEditor layers={textLayers} onChange={setTextLayers} duration={result.duration} isMm={isMm} />
            </div>
          )}
          <div className="mt-5 pt-5 border-t border-white/10">
            <Label icon={<Film size={12} />}>{isAdmin ? (isMm ? 'Recap ဗီဒီယိုပါ လိုချင်ရင် (PC Worker လိုသည်)' : 'Recap video (needs PC worker)') : (isMm ? 'Recap ဗီဒီယိုပါ လိုချင်ရင် (Server မှာ render လုပ်မည်)' : 'Recap video (rendered on our server)')}</Label>
            {isAdmin && (
              <details className="mb-3 rounded-2xl border border-white/10 bg-white/5 p-3">
                <summary className="cursor-pointer text-[12px] font-bold text-slate-300">
                  {isMm ? 'PC Worker ချိတ်ဆက်မှု (ဖုန်းကနေ သုံးရင် Tunnel URL + password ထည့်ပါ)' : 'PC worker connection (on a phone: enter the tunnel URL + password)'}
                </summary>
                <div className="mt-3"><FfmpegWorkerManager /></div>
              </details>
            )}
            <button type="button" onClick={buildVideo} disabled={!!rendering || !result.hasVideoTimes} className="w-full h-12 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/10 text-white text-[13px] font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition">
              {rendering ? <Loader2 size={16} className="animate-spin" /> : <Film size={16} />}
              {rendering || (isMm ? 'Recap ဗီဒီယို ထုတ်မည်' : 'Render recap video')}
            </button>
            {videoUrl && (
              <button type="button" onClick={downloadVideo} disabled={dlBusy} className="mt-3 w-full flex items-center justify-center gap-2 h-12 rounded-2xl bg-emerald-400 text-black text-[13px] font-extrabold disabled:opacity-60">
                {dlBusy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}{isMm ? 'Recap ဗီဒီယို ဒေါင်းမည် (.mp4)' : 'Download recap video (.mp4)'}
              </button>
            )}
            {videoUrl && <RecapShare videoUrl={videoUrl} fileName={`${baseName}_recap.mp4`} defaultTitle={baseName} isMm={isMm} />}
          </div>
            </div>

            {/* Right: files and settings */}
            <div className="mt-6 2xl:mt-0">
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

          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-5">
            <div className="text-[13px] font-extrabold text-white">{isMm ? '🎛️ ဗီဒီယို ပြင်ဆင်ချက်များ' : '🎛️ Video options'}</div>

            <div>
              <Label>{isMm ? 'ဗီဒီယိုအချိုး (Ratio)' : 'Video ratio'}</Label>
              <div className="grid grid-cols-5 gap-2">
                {[['original', isMm ? 'မူရင်း' : 'Original'], ['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1'], ['4:5', '4:5']].map(([id, label]) => (
                  <button key={id} type="button" onClick={() => setAspect(id)} className={`rounded-xl border py-2.5 text-[12px] font-bold transition ${aspect === id ? 'border-emerald-400 bg-emerald-400/10 text-white' : 'border-white/10 bg-white/[0.04] text-slate-300'}`}>{label}</button>
                ))}
              </div>
            </div>

            <div>
              <Label>{isMm ? 'မူရင်းဗီဒီယို အနားနေရာ' : 'Original video framing'}</Label>
              <Segmented
                value={framing}
                onChange={setFraming}
                options={[
                  { id: 'blurred-fit', label: isMm ? 'Blur နောက်ခံ' : 'Blur', sub: isMm ? 'အပြည့်မပြတ်' : 'full video' },
                  { id: 'cover', label: isMm ? 'ဖြတ်ပြည့်' : 'Crop fill', sub: isMm ? 'အနားဖြတ်' : 'cut edges' },
                  { id: 'letterbox', label: isMm ? 'အနက်ဘား' : 'Black bars', sub: isMm ? 'အနက်ရောင်' : 'solid' },
                ]}
              />
              {framing === 'blurred-fit' && (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11.5px] text-slate-400">{isMm ? 'Blur ပမာဏ' : 'Blur amount'}</span>
                    <span className="text-[11px] font-mono text-amber-300">{blurAmount}</span>
                  </div>
                  <input type="range" min={10} max={80} step={5} value={blurAmount} onChange={e => setBlurAmount(Number(e.target.value))} className="w-full h-2 rounded-full accent-amber-400" />
                </div>
              )}
              <div className="mt-4 pt-4 border-t border-white/10">
                <Label>{isMm ? 'ပုံ ညှိရန် (Zoom / အရောင်)' : 'Picture (zoom / colour)'}</Label>
                {([
                  { k: 'zoom', label: isMm ? 'Zoom / Crop' : 'Zoom / crop', v: zoom, set: setZoom, min: 1, max: 1.6, step: 0.05, show: `${zoom.toFixed(2)}x` },
                  ...(zoom > 1 ? [
                    { k: 'px', label: isMm ? 'ဘယ် ↔ ညာ' : 'Left ↔ right', v: panX, set: setPanX, min: -1, max: 1, step: 0.1, show: panX.toFixed(1) },
                    { k: 'py', label: isMm ? 'အပေါ် ↕ အောက်' : 'Up ↕ down', v: panY, set: setPanY, min: -1, max: 1, step: 0.1, show: panY.toFixed(1) },
                  ] : []),
                  { k: 'bri', label: isMm ? 'အလင်း' : 'Brightness', v: bri, set: setBri, min: -0.3, max: 0.3, step: 0.02, show: bri.toFixed(2) },
                  { k: 'con', label: isMm ? 'Contrast' : 'Contrast', v: con, set: setCon, min: 0.7, max: 1.4, step: 0.05, show: con.toFixed(2) },
                  { k: 'sat', label: isMm ? 'အရောင်ထိန်း' : 'Saturation', v: sat, set: setSat, min: 0.5, max: 1.8, step: 0.05, show: sat.toFixed(2) },
                ]).map(r => (
                  <div key={r.k} className="mb-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11.5px] text-slate-400">{r.label}</span>
                      <span className="text-[11px] font-mono text-amber-300">{r.show}</span>
                    </div>
                    <input type="range" min={r.min} max={r.max} step={r.step} value={r.v} onChange={e => r.set(Number(e.target.value))} className="w-full h-2 rounded-full accent-amber-400" />
                  </div>
                ))}
                {adjusted && (
                  <button type="button" onClick={() => { setZoom(1); setPanX(0); setPanY(0); setBri(0); setCon(1); setSat(1); }} className="text-[11px] text-slate-400 underline">
                    {isMm ? 'မူလအတိုင်း ပြန်ထားမည်' : 'Reset picture'}
                  </button>
                )}
              </div>
              {aspect === 'original' && (
                <p className="mt-2 text-[11px] text-slate-500">{isMm ? 'အချိုး "မူရင်း" ဆိုရင် မူရင်းဗီဒီယိုက ဘောင်ပြည့်နေလို့ blur မထင်ရှားပါ — 9:16 / 1:1 / 4:5 ရွေးမှ နောက်ခံ blur မြင်ရပါမယ်။' : 'With "Original" the video already fills the frame, so there is nothing to blur — pick 9:16 / 1:1 / 4:5 to see the blurred background.'}</p>
              )}
            </div>

            <div>
              <Label>{isMm ? 'စာတန်းပုံစံ' : 'Subtitle look'}</Label>
              <div className="grid grid-cols-4 gap-2">
                {SUBTITLE_PRESETS.map(p => (
                  <button key={p.id} type="button" onClick={() => setSubPreset(p.id)} className={`rounded-2xl border px-2 py-3 flex flex-col items-center gap-1.5 transition ${subPreset === p.id ? 'border-emerald-400 bg-emerald-400/10' : 'border-white/10 bg-white/[0.04]'}`}>
                    <span className="text-[20px] font-black leading-none" style={{ color: p.swatch.fill, WebkitTextStroke: `2px ${p.swatch.stroke}`, paintOrder: 'stroke fill' }}>Aa</span>
                    <span className="text-[10.5px] text-slate-300 text-center leading-tight">{isMm ? p.name.mm : p.name.en}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label>{isMm ? 'စာတန်းနေရာ (အပေါ် ↔ အောက်)' : 'Subtitle position (top ↔ bottom)'}</Label>
                <span className="mb-2 text-[11px] font-mono text-amber-300">{subY}%</span>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-3">
                {[[14, isMm ? 'အပေါ်' : 'Top'], [50, isMm ? 'အလယ်' : 'Middle'], [84, isMm ? 'အောက်' : 'Bottom']].map(([v, l]) => (
                  <button key={String(v)} type="button" onClick={() => setSubY(Number(v))} className={`rounded-xl border py-2 text-[12px] font-bold transition ${subY === v ? 'border-emerald-400 bg-emerald-400/10 text-white' : 'border-white/10 bg-white/[0.04] text-slate-300'}`}>{l}</button>
                ))}
              </div>
              <input type="range" min={8} max={94} step={1} value={subY} onChange={e => setSubY(Number(e.target.value))} className="w-full h-2 rounded-full accent-amber-400" />
              <div className="flex items-center justify-between mt-3 mb-1.5">
                <span className="text-[11.5px] text-slate-400">{isMm ? 'စာလုံးအရွယ်' : 'Text size'}</span>
                <span className="text-[11px] font-mono text-amber-300">{Math.round(subScale * 100)}%</span>
              </div>
              <input type="range" min={0.6} max={1.5} step={0.05} value={subScale} onChange={e => setSubScale(Number(e.target.value))} className="w-full h-2 rounded-full accent-amber-400" />
            </div>

            <div>
              <label className="flex items-center gap-2.5 text-[12.5px] text-slate-200 cursor-pointer">
                <input type="checkbox" checked={blurSubOn} onChange={e => setBlurSubOn(e.target.checked)} className="accent-amber-400 w-4 h-4" />
                {isMm ? '🙈 မူရင်းဗီဒီယိုထဲက စာတန်း/စာသားကို blur လုပ်မည်' : '🙈 Blur the original burned-in subtitles'}
              </label>
              {blurSubOn && (
                <div className="mt-3 space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1.5"><span className="text-[11.5px] text-slate-400">{isMm ? 'နေရာ (မူရင်းဗီဒီယိုရဲ့ အပေါ်ကနေ)' : 'Position (from top of the original)'}</span><span className="text-[11px] font-mono text-amber-300">{blurSubY}%</span></div>
                    <input type="range" min={0} max={95} step={1} value={blurSubY} onChange={e => setBlurSubY(Number(e.target.value))} className="w-full h-2 rounded-full accent-amber-400" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5"><span className="text-[11.5px] text-slate-400">{isMm ? 'အမြင့်' : 'Height'}</span><span className="text-[11px] font-mono text-amber-300">{blurSubH}%</span></div>
                    <input type="range" min={5} max={40} step={1} value={blurSubH} onChange={e => setBlurSubH(Number(e.target.value))} className="w-full h-2 rounded-full accent-amber-400" />
                  </div>
                  <p className="text-[11px] text-slate-500">{isMm ? 'ကြိုကြည့်ထဲမှာ မှုန်ဝါးတဲ့ ဘားကို မူရင်းစာတန်းပေါ် ကျအောင် ချိန်ပါ။ Recap ဗီဒီယို (.mp4) ထုတ်တဲ့အခါ PC Worker မှာ လုပ်ပေးပါတယ်။' : 'Line the blurred bar up with the original text in the preview. It is applied when the Recap video (.mp4) is rendered on the PC worker.'}</p>
                </div>
              )}
            </div>

            <div>
              <Label>{isMm ? '🏷️ Logo / Logo စာသား (မထည့်လည်းရ)' : '🏷️ Logo / logo text (optional)'}</Label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-white/[0.04] py-3 text-[12px] text-slate-200 cursor-pointer">
                  <Upload size={14} />
                  <span className="truncate max-w-[110px]">{logoName || (isMm ? 'Logo ပုံရွေး' : 'Choose logo')}</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async e => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (!f) return;
                      try { setLogoImg(await loadLogoImage(f)); setLogoName(f.name); } catch (err) { showToast(err instanceof Error ? err.message : 'Logo error', 'error'); }
                    }}
                  />
                </label>
                <input
                  value={logoText}
                  onChange={e => setLogoText(e.target.value)}
                  placeholder={isMm ? 'Logo စာသား (ဥပမာ VBS)' : 'Logo text (e.g. VBS)'}
                  className="rounded-xl bg-white/[0.04] border border-white/10 px-3 text-[12.5px] text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400/60"
                />
              </div>
              {(logoImg || logoText.trim()) && (
                <div className="mt-3 space-y-3">
                  {logoImg && (
                    <button type="button" onClick={() => { setLogoImg(null); setLogoName(''); }} className="text-[11px] text-red-300 underline">{isMm ? 'Logo ပုံ ဖယ်မည်' : 'Remove logo image'}</button>
                  )}
                  <div className="grid grid-cols-4 gap-2">
                    {([['tl', '↖'], ['tr', '↗'], ['bl', '↙'], ['br', '↘']] as [LogoPosition, string][]).map(([id, a]) => (
                      <button key={id} type="button" onClick={() => setLogoPos(id)} className={`rounded-xl border py-2 text-[16px] transition ${logoPos === id ? 'border-emerald-400 bg-emerald-400/10 text-white' : 'border-white/10 bg-white/[0.04] text-slate-300'}`}>{a}</button>
                    ))}
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5"><span className="text-[11.5px] text-slate-400">{isMm ? 'အရွယ်' : 'Size'}</span><span className="text-[11px] font-mono text-amber-300">{logoSize}%</span></div>
                    <input type="range" min={6} max={35} step={1} value={logoSize} onChange={e => setLogoSize(Number(e.target.value))} className="w-full h-2 rounded-full accent-amber-400" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5"><span className="text-[11.5px] text-slate-400">{isMm ? 'ဖောက်ထွင်းမြင်ရမှု' : 'Opacity'}</span><span className="text-[11px] font-mono text-amber-300">{Math.round(logoOpacity * 100)}%</span></div>
                    <input type="range" min={0.2} max={1} step={0.05} value={logoOpacity} onChange={e => setLogoOpacity(Number(e.target.value))} className="w-full h-2 rounded-full accent-amber-400" />
                  </div>
                </div>
              )}
            </div>

            <div>
              <Label>{isMm ? '🎵 နောက်ခံတေးဂီတ (BGM) — ကိုယ်ပိုင်/လိုင်စင်ရတာသာ' : '🎵 Background music — your own / licensed only'}</Label>
              <label className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-white/[0.04] py-3 text-[12px] text-slate-200 cursor-pointer">
                <Upload size={14} />
                <span className="truncate max-w-[220px]">{bgmFile ? bgmFile.name : (isMm ? 'BGM ဖိုင်ရွေး (mp3/wav/m4a)' : 'Choose BGM file (mp3/wav/m4a)')}</span>
                <input type="file" accept="audio/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setBgmFile(f); }} />
              </label>
              {bgmFile && (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11.5px] text-slate-400">{isMm ? 'BGM အသံ (ပြောသံပေါ်မှာ အလိုအလျောက်ကျသွားမည်)' : 'BGM level (ducks under the voice)'}</span>
                    <span className="text-[11px] font-mono text-amber-300">{Math.round(bgmVol * 100)}%</span>
                  </div>
                  <input type="range" min={0.05} max={0.6} step={0.05} value={bgmVol} onChange={e => setBgmVol(Number(e.target.value))} className="w-full h-2 rounded-full accent-amber-400" />
                  <button type="button" onClick={() => setBgmFile(null)} className="mt-2 text-[11px] text-red-300 underline">{isMm ? 'BGM ဖယ်မည်' : 'Remove BGM'}</button>
                </div>
              )}
            </div>
          </div>

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

            </div>
          </div>
        </div>
      )}

        <div className="hidden lg:grid lg:grid-cols-2 gap-5 items-start [&>section]:mt-0">{settingsBlock}</div>
      </div>
    </div>
  );
};

/** Joins the per-scene voice clips into one voiceover and builds the SRT / cue timeline for them. */
async function joinScenes(segments: Segment[], audios: Blob[], normalize: boolean) {
  const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  const ctx = new Ctx();
  const buffers: AudioBuffer[] = [];
  try {
    for (const b of audios) buffers.push(await ctx.decodeAudioData(await b.arrayBuffer()));
  } finally { void ctx.close(); }
  const rate = buffers[0].sampleRate;
  const total = buffers.reduce((n, b) => n + b.duration, 0) + GAP * (buffers.length - 1);
  const out = new AudioBuffer({ length: Math.ceil(total * rate), numberOfChannels: 1, sampleRate: rate });
  const ch = out.getChannelData(0);
  let t = 0;
  const subs: SRTSubtitle[] = [];
  const cues: { start: number; end: number; text: string }[] = [];
  const sceneTimes: { start: number; dur: number }[] = [];
  buffers.forEach((buf, i) => {
    sceneTimes.push({ start: t, dur: buf.duration });
    ch.set(buf.getChannelData(0), Math.round(t * rate));
    planSubtitlePieces(segments[i].text, splitSentenceIntoCueBlocks).forEach(pc => {
      cues.push({ start: t + pc.from * buf.duration, end: t + pc.to * buf.duration, text: pc.text });
      subs.push({ index: subs.length + 1, startTime: secToSrt(t + pc.from * buf.duration), endTime: secToSrt(t + pc.to * buf.duration), text: pc.text });
    });
    t += buf.duration + GAP;
  });
  let sceneAudios = audios;
  if (normalize) {
    const gainDb = normalizeLoudness(ch, -16);
    // Same gain for the per-scene clips, so the rendered recap video sounds as loud as the joined voiceover.
    sceneAudios = buffers.map(b => {
      for (let c = 0; c < b.numberOfChannels; c++) applyLoudnessGain(b.getChannelData(c), gainDb);
      return audioBufferToWav(b);
    });
  }
  return { voiceoverBlob: audioBufferToWav(out), sceneAudios, sceneTimes, srt: generateSRT(subs), cues, duration: total };
}

function secToSrt(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(h)}:${p(m)}:${p(r)},${p(ms === 1000 ? 999 : ms, 3)}`;
}
