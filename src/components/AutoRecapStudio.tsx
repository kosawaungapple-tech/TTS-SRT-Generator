import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clapperboard, Upload, Download, Sparkles, Mic, FileText, Film, Loader2, CheckCircle2, ChevronDown, RefreshCw, Smartphone, Globe2, Gauge, Layers, ShieldAlert } from 'lucide-react';
import { CopyrightModal } from './CopyrightModal';
import { useActivity } from '../services/activity';
import { GeminiTTSService, cancelGeminiRequests, type RecapPlanScene } from '../services/geminiService';
import { assemblyAiService } from '../services/assemblyAiService';
import { apiChannelManager } from '../services/apiChannelManager';
import { renderSceneRecap } from '../services/recapRenderService';
import { isLongVideo, uploadVideoToWorker, fetchWorkerSpeech, transcribeWithWhisper } from '../services/workerSession';
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
import { renderTextLayerPng, type TextLayer } from '../utils/recapTextLayers';
import { EditToolsPanel } from './EditToolsPanel';
import { defaultFx, renderCardPng, renderImageOverlayPng, FILTER_CSS, type ImageOverlay, type RecapFx } from '../utils/recapFx';
import { getExtraKeys, soonestFreeSeconds } from '../services/geminiKeyPool';
import { authHeader } from '../services/serverAuth';
import { loadLogoImage, renderLogoPng, type LogoPosition } from '../utils/recapLogo';
import { SUBTITLE_PRESETS, SUBTITLE_FONTS, getSubtitleStyle, type SubtitleFontId } from '../utils/subtitlePresets';
import { loadUserFonts, FONTS_EVENT, type UserFont } from '../utils/userFonts';
import { VOICE_OPTIONS } from '../constants';
import type { SRTSubtitle } from '../types';

interface Props {
  showToast: (message: string, type: 'success' | 'error') => void;
  isAdmin: boolean;
  isMm: boolean;
  onNavigateToSettings?: () => void;
}

type SourceMode = 'speech' | 'visual';

interface Segment { start: number; end: number; text: string; speed?: number }

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

const DIALOGUE_STYLE = 'Perform this line as the character speaking in first person, with natural emotion and acting. Keep this character\'s voice, age and pace the same every time.';
/** `[Name|♂] line` = a line spoken by a character in dub style; every other line is the narrator's. */
const DUB_TAG = /^\s*\[([^\]|]+)\|([♂♀])\]\s*/;
const hasDubTags = (t: string) => t.split('\n').some(l => DUB_TAG.test(l));
const stripDubTags = (t: string) => t.split('\n').map(l => l.replace(DUB_TAG, '')).join('\n');

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

const Chip: React.FC<{ on: boolean; onClick: () => void; children: React.ReactNode }> = ({ on, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={`px-3 py-2 rounded-xl text-[12px] font-bold border transition text-left leading-snug flex items-center gap-1.5 ${
      on
        ? 'bg-amber-400 text-black border-amber-400 shadow-sm shadow-amber-400/20'
        : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
    }`}
  >
    {children}
  </button>
);

export const AutoRecapStudio: React.FC<Props> = ({ showToast, isAdmin, isMm, onNavigateToSettings }) => {
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState(0);
  const [mode, setMode] = useState<SourceMode>('speech');
  /** Talking videos: write the story from what is said only (no frame-by-frame looking): much faster */
  const [talkOnly, setTalkOnly] = useState(true);
  const [spokenLang, setSpokenLang] = useState('auto');
  const [sttEngine, setSttEngine] = useState<'assembly' | 'whisper'>(() => { try { return localStorage.getItem('VBS_STT_ENGINE') === 'whisper' ? 'whisper' : 'assembly'; } catch { return 'assembly'; } });
  const [whisperModel, setWhisperModel] = useState(() => { try { return localStorage.getItem('VBS_WHISPER_MODEL') || 'small'; } catch { return 'small'; } });
  useEffect(() => { try { localStorage.setItem('VBS_STT_ENGINE', sttEngine); localStorage.setItem('VBS_WHISPER_MODEL', whisperModel); } catch { /* storage unavailable */ } }, [sttEngine, whisperModel]);
  const [style, setStyle] = useState('cinematic');
  const [length, setLength] = useState<'short' | 'medium' | 'full'>('medium');
  const [language, setLanguage] = useState<'mm' | 'en'>('mm');
  const [voice, setVoice] = useState('aoede');
  /** Dub style: the characters speak their key lines in their own voices; the narrator tells the rest */
  const [dub, setDub] = useState(false);
  const [cast, setCast] = useState<{ name: string; voice: string }[]>([]);
  const castRef = useRef<Map<string, string>>(new Map());
  const [speed, setSpeed] = useState(1.0);
  const [aspect, setAspect] = useState('original');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ text: string; percent: number } | null>(null);
  const baseRef = useRef<{ segments: Segment[]; sceneAudios: Blob[] } | null>(null);
  const baseVer = useRef(0);
  const lapRef = useRef<{ name: string; at: number }>({ name: '', at: 0 });
  /** Writes "how long the previous step took" into the activity log, so a slow step is easy to spot. */
  const [stepTimes, setStepTimes] = useState<string[]>([]);
  const lap = (next: string) => {
    const now = Date.now();
    const prev = lapRef.current;
    if (prev.name) {
      const sec = Math.round((now - prev.at) / 1000);
      setProgress(p => ({ text: `⏱ ${prev.name}: ${sec}s`, percent: p?.percent ?? 0 }));
      setStepTimes(t => [...t, `${prev.name}: ${sec}s`]);
    }
    lapRef.current = { name: next, at: now };
  };
  const [result, setResult] = useState<Result | null>(null);
  const [rendering, setRendering] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const draftRef = useRef<{ segments: Segment[]; hasVideoTimes: boolean; audios?: Blob[] } | null>(null);
  const [canResume, setCanResume] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const renderAbortRef = useRef<AbortController | null>(null);
  /** Stop button: cancels the running recap (every Gemini call, the PC worker call) or the video render. */
  const stopAll = () => {
    autoAbort.current = true;
    abortRef.current?.abort();
    renderAbortRef.current?.abort();
    cancelGeminiRequests();
    setProgress(null);
  };
  const [errorInfo, setErrorInfo] = useState<string | null>(null);
  useActivity(busy, isMm ? 'Auto Recap လုပ်နေသည်' : 'Auto Recap running', { detail: progress?.text, percent: progress?.percent, failed: errorInfo });
  const stageRef = useRef('start');
  const [thumb, setThumb] = useState<string | null>(null);
  const [subPreset, setSubPreset] = useState('viral');
  const [subY, setSubY] = useState(84);
  const [subScale, setSubScale] = useState(1);
  const [subFont, setSubFont] = useState<SubtitleFontId>('noto');
  const [myFonts, setMyFonts] = useState<UserFont[]>([]);
  useEffect(() => {
    const refresh = () => { void loadUserFonts().then(setMyFonts); };
    refresh();
    window.addEventListener(FONTS_EVENT, refresh);
    return () => window.removeEventListener(FONTS_EVENT, refresh);
  }, []);
  // a font that was removed in Settings falls back to the default
  useEffect(() => {
    if (subFont !== 'noto' && subFont !== 'padauk' && !myFonts.some(f => f.family === subFont)) setSubFont('noto');
  }, [myFonts, subFont]);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [capTab, setCapTab] = useState<'presets' | 'font' | 'effects'>('presets');
  const [framing, setFraming] = useState<'blurred-fit' | 'cover' | 'letterbox'>('blurred-fit');
  const [blurAmount, setBlurAmount] = useState(40);
  const [textLayers, setTextLayers] = useState<TextLayer[]>([]);
  const [fx, setFx] = useState<RecapFx>(defaultFx);
  // The preview stays on screen while you scroll the tools; it is taller when the page is wide enough for side-by-side columns.
  const [wideScreen, setWideScreen] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1536px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1536px)');
    const on = () => setWideScreen(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  /** 0 = by coverage (Highlights / Standard / Whole); otherwise the recap length in minutes (for long films) */
  const [targetMin, setTargetMin] = useState(0);
  const sessionRef = useRef<{ file: File; id: string } | null>(null);
  // ---- Split a long film into several recap videos (each part is a small, separate job) ----------------------------
  const [splitOn, setSplitOn] = useState(false);
  const [partMin, setPartMin] = useState(3);
  const [partIdx, setPartIdx] = useState(0);
  const cuesRef = useRef<{ key: string; cues: { start: number; end: number; text: string }[] } | null>(null);
  const prRef = useRef<{ from: number; to: number } | null>(null);
  const partTails = useRef<Record<number, string>>({});
  const doneIdx = useRef(0); // which part the result on screen belongs to
  /** The voiced scenes of every finished part; "Combine" joins them into ONE complete recap. */
  const partResults = useRef<Record<number, { segments: Segment[]; sceneAudios: Blob[] }>>({});
  const [partsVer, setPartsVer] = useState(0);
  const [isCombined, setIsCombined] = useState(false);
  const [combining, setCombining] = useState(false);
  const coverage = targetMin > 0 && duration > 0 ? Math.min(1, (targetMin * 60) / duration) : length === 'short' ? 0.55 : length === 'full' ? 1 : 0.85;
  const longFilm = !!file && isAdmin && isLongVideo(file, duration);
  const partCount = duration > 0 ? Math.max(1, Math.round((duration * coverage) / (partMin * 60))) : 1;
  const splitActive = splitOn && partCount > 1;
  const curPart = Math.min(partIdx, partCount - 1);
  /** Part boundaries: equal slices of the film, moved to the nearest gap between sentences when the speech is known. */
  const partBounds = (cues?: { start: number; end: number }[]) => {
    const b: number[] = [0];
    for (let i = 1; i < partCount; i++) {
      let t = (duration * i) / partCount;
      if (cues?.length) {
        let best: number | null = null;
        for (const c of cues) if (Math.abs(c.end - t) < 45 && (best === null || Math.abs(c.end - t) < Math.abs(best - t))) best = c.end;
        if (best !== null) t = best;
      }
      b.push(Math.max(b[i - 1] + 5, Math.min(duration - 5, t)));
    }
    b.push(duration);
    return b;
  };
  const [overlays, setOverlays] = useState<ImageOverlay[]>([]);
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
  const [setupTab, setSetupTab] = useState<'content' | 'lang'>('content');
  const [resTab, setResTab] = useState<'scenes' | 'captions' | 'video' | 'brand' | 'export'>('export');
  const [draft, setDraft] = useState<{ segments: Segment[]; hasVideoTimes: boolean } | null>(null);
  const [blurSubOn, setBlurSubOn] = useState(false);
  const [blurSubY, setBlurSubY] = useState(78);
  const [blurSubH, setBlurSubH] = useState(16);
  const [showCopyrightModal, setShowCopyrightModal] = useState(false);

  const handleApplyFullAntiCopyright = () => {
    setBlurSubOn(true);
    setBlurSubY(80);
    setBlurSubH(16);
    setFraming('blurred-fit');
    setBlurAmount(45);
    setFx(prev => ({ ...prev, filter: 'cinematic' }));
    showToast(isMm ? '🛡️ မူပိုင်ခွင့် ကာကွယ်ရေးစနစ် (Anti-Copyright & Subtitle Blur) အောင်မြင်စွာ ဖွင့်ထားပြီးပါပြီ' : '🛡️ Full Anti-Copyright suite & Subtitle Blur activated!', 'success');
  };
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
    partResults.current = {}; partTails.current = {}; cuesRef.current = null; boundsRef.current = null; castRef.current = new Map(); setCast([]); setPartsVer(v => v + 1); setIsCombined(false); setPartIdx(0);
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

  /** Long videos live on the PC worker: uploaded once (streamed to disk), reused for the speech track and the render. */
  const ensureSession = async (signal?: AbortSignal): Promise<string> => {
    if (!file) throw new Error('No video');
    if (sessionRef.current && sessionRef.current.file === file) return sessionRef.current.id;
    const mb = Math.round(file.size / 1048576);
    const r = await uploadVideoToWorker(file, f => setProgress({ text: `${isMm ? 'PC Worker ဆီ ဗီဒီယို ပို့နေသည်' : 'Sending the video to your PC worker'} (${mb} MB) ${Math.round(f * 100)}%`, percent: Math.max(1, Math.round(f * 12)) }), signal);
    sessionRef.current = { file, id: r.videoId };
    return r.videoId;
  };

  const boundsRef = useRef<{ key: string; b: number[] } | null>(null);
  const lastErrRef = useRef('');
  const [autoAll, setAutoAll] = useState(false);
  const autoAbort = useRef(false);
  /** Part boundaries at story turning points (one extra Gemini call for the whole film); falls back to the quietest gaps. */
  const ensureBounds = async (cues: { start: number; end: number; text: string }[], cueKey: string): Promise<number[]> => {
    const key = `${cueKey}|${partCount}|${Math.round(duration)}`;
    if (boundsRef.current?.key === key) return boundsRef.current.b;
    let b: number[] | null = null;
    if (cues.length >= partCount * 3) {
      setProgress({ text: isMm ? 'ဇာတ်လမ်းကို အပိုင်းခွဲနေသည် (ဇာတ်ကွက်ပြောင်းတဲ့နေရာတွေမှာ)…' : 'Planning the parts at story turning points…', percent: 26 });
      try {
        const starts = await gemini().planStoryChapters(cues, partCount);
        if (starts) {
          const cand = [0, ...starts, duration];
          const even = duration / partCount;
          // reject a plan whose parts are far from equal (a part of 0.5x-1.7x the even length is fine)
          if (cand.every((t, i) => i === 0 || (t - cand[i - 1] > even * 0.5 && t - cand[i - 1] < even * 1.7))) b = cand;
        }
      } catch { /* fall back */ }
    }
    if (!b) b = partBounds(cues);
    boundsRef.current = { key, b };
    setPartsVer(v => v + 1);
    return b;
  };

  const run = async (resume = false, forcePart?: number, quiet = false): Promise<boolean> => {
    const part = forcePart ?? curPart;
    if (!file) {
      showToast(isMm ? 'ဗီဒီယိုဖိုင် အရင်တင်ပါ' : 'Please upload a video first', 'error');
      return false;
    }
    if (!duration) {
      showToast(isMm ? 'ဗီဒီယိုအရှည်ကို ဖတ်မရပါ — mp4 ဖိုင်ကို စမ်းပါ' : 'Could not read the video length', 'error');
      return false;
    }
    if (!isAdmin && file.size > 190 * 1048576) {
      showToast(isMm ? 'ဒီဗီဒီယိုက ကြီးလွန်းပါတယ် (190 MB ထက်ကျော်) — ရှည်တဲ့ ဇာတ်ကားကို Admin ရဲ့ PC Worker နဲ့ပဲ လုပ်လို့ရပါတယ်' : 'This video is too large for the shared server (over 190 MB). Long films can only be recapped with the admin PC worker.', 'error');
      return false;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    doneIdx.current = part;
    setIsCombined(false);
    setBusy(true);
    if (!resume) { setStepTimes([]); lapRef.current = { name: '', at: 0 }; }
    setErrorInfo(null);
    stageRef.current = 'start'; lapRef.current = { name: '', at: Date.now() };
    setResult(null);
    setVideoUrl(null);
    setDraft(null);
    setCanResume(false);
    if (!resume) draftRef.current = null;
    let completed = false;
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
      const cueKey = `${file.name}|${file.size}|${spokenLang}|${sttEngine}|${whisperModel}`;
      if (mode === 'speech' && splitActive && cuesRef.current && cuesRef.current.key === cueKey) {
        cues = cuesRef.current.cues; // an earlier part already listened to the whole film
      } else if (mode === 'speech') {
        const key = sttEngine === 'whisper' ? 'whisper' : assemblyAiService.getStoredApiKey();
        if (!key) {
          showToast(isMm ? 'Settings ထဲမှာ AssemblyAI API Key အရင်ထည့်ပါ' : 'Add your AssemblyAI API key in Settings first', 'error');
          onNavigateToSettings?.();
          return false;
        }
        stageRef.current = sttEngine === 'whisper' ? '1 listen (Whisper PC)' : '1 listen (AssemblyAI)'; lap(stageRef.current);
        setProgress({ text: isMm ? '၁/၄ စကားပြောကို နားထောင်နေသည်…' : '1/4 Listening to the speech…', percent: 3 });
        // Upload only the sound (small WAV) instead of the whole video: big uploads from a phone often die with "Load failed".
        // A long film is sent to the PC worker once, which extracts the speech (the browser cannot hold a whole movie in memory).
        let speech: Blob | null = null;
        let whisperVid = '';
        if (sttEngine === 'whisper') {
          setProgress({ text: isMm ? '၁/၄ Whisper (PC) နဲ့ နားထောင်နေသည်… (မိနစ်အနည်းငယ်ကြာနိုင်သည်)' : '1/4 Listening with Whisper on your PC… (can take a few minutes)', percent: 8 });
          if (longFilm) whisperVid = await ensureSession(ctrl.signal);
          else speech = (await extractSpeechWav(file)) || file;
          const w = await transcribeWithWhisper(longFilm ? { videoId: whisperVid } : { audio: speech as Blob }, spokenLang, whisperModel, ctrl.signal);
          cues = w.cues;
          if (!cues.length) throw new Error(isMm ? 'Whisper က စကားပြောကို မတွေ့ပါ' : 'Whisper found no speech');
          cuesRef.current = { key: cueKey, cues };
        } else {
        if (longFilm) {
          const vid = await ensureSession(ctrl.signal);
          setProgress({ text: isMm ? '၁/၄ စကားပြောကို ထုတ်ယူနေသည်…' : '1/4 Extracting the speech…', percent: 13 });
          speech = await fetchWorkerSpeech(vid);
        } else {
          speech = (await extractSpeechWav(file)) || file;
        }
        const tr = await assemblyAiService.processToSrt({
          apiKey: key,
          file: speech as Blob,
          languageCode: spokenLang,
          autoLanguage: spokenLang === 'auto',
          speakerLabels: false,
          speechModel: 'best',
          onProgress: (step, percent) => setProgress({ text: `${isMm ? '၁/၄ ' : '1/4 '}${step}`, percent: Math.min(25, Math.round((percent ?? 0) * 0.25)) }),
        });
        cues = parseSrtCues(tr.srt);
        cuesRef.current = { key: cueKey, cues };
        }
      }

      if (ctrl.signal.aborted) throw new Error('Cancelled');
      // Which stretch of the film this run covers (the whole film unless it is split into parts).
      const bounds = splitActive ? await ensureBounds(cues, cueKey) : null;
      const pr = bounds ? { from: bounds[part], to: bounds[part + 1] } : { from: 0, to: duration };
      prRef.current = pr;
      const partLen = pr.to - pr.from;
      const partCues = cues.filter(c => c.end > pr.from && c.start < pr.to).map(c => ({ ...c, start: Math.max(0, c.start - pr.from), end: Math.min(partLen, c.end - pr.from) }));

      // ---- 2. Watch + write ------------------------------------------------------------------
      stageRef.current = '2 watch/write (Gemini)'; lap('2 watch/write (Gemini)');
      const recap = await g.generateMovieRecap(
        partCues.map((c, i) => `[${i + 1}] ${c.text}`).join('\n'),
        (s, msg) => setProgress(p => ({ text: `${msg} (${s}s)`, percent: p?.percent ?? 30 })),
        {
          style: styleHints[style] || 'Cinematic recap that follows the story itself: infer the genre and mood (drama, thriller, action, comedy, romance...) from what actually happens and let it shift scene by scene. Never impose a genre the footage does not show.',
          tone: style === 'tiktok' ? 'Fast viral TikTok pacing, punchy hooks, high energy' : 'Engaging, emotional, cinematic and captivating',
          targetMinutes: targetMin > 0 ? targetMin : length === 'short' ? 1.5 : length === 'full' ? 9 : 4,
          sourceSeconds: partLen,
          targetLanguage: language,
          cues: partCues,
          coverage,
          part: splitActive ? { index: part, count: partCount, prevTail: partTails.current[part - 1] } : undefined,
          concurrency: Math.min(6, Math.max(getExtraKeys().length + 1, apiChannelManager.getPoolKeys(isAdmin).length) + 1),
          dub,
          talkOnly: mode === 'speech' && talkOnly && partCues.length >= 3,
          getFrames: async (a, b) => {
            const n = 5;
            return captureVideoFrames(file, Array.from({ length: n }, (_, i) => pr.from + a + ((b - a) * (i + 0.5)) / n), 448, 0.6);
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

      if (ctrl.signal.aborted) throw new Error('Cancelled');
      if (recap.segments?.length) {
        segments = pr.from > 0 ? recap.segments.map(sg => ({ ...sg, start: sg.start + pr.from, end: sg.end + pr.from })) : recap.segments;
      } else {
        hasVideoTimes = false;
        segments = recap.text
          .split(/\n{2,}/)
          .map(t => t.trim())
          .filter(Boolean)
          .map(text => ({ start: 0, end: 0, text }));
      }

      draftRef.current = { segments, hasVideoTimes };
      if (splitActive) partTails.current[part] = segments.map(sg => sg.text).join(' ').slice(-600);
      if (reviewScript && !quiet) {
        // Pause here so the script can be edited before any voice is recorded.
        draftRef.current = { segments, hasVideoTimes };
        setDraft({ segments, hasVideoTimes });
        setProgress(null);
        showToast(isMm ? 'ဇာတ်ညွှန်း ရပါပြီ — ပြင်ချင်ရင် ပြင်ပြီး "အသံသွင်းမည်" ကို နှိပ်ပါ' : 'Script ready — edit it if you like, then press "Record voiceover"', 'success');
        return false;
      }
      }

      // ---- 3. Voice every scene --------------------------------------------------------------
      stageRef.current = '3 voiceover (Gemini TTS)'; lap('3 voiceover (Gemini TTS)');
      const Ctx0 = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      // On a resumed run the scenes already voiced are kept; only the rest is recorded.
      const sceneAudios: Blob[] = resume && draftRef.current?.audios ? [...draftRef.current.audios] : [];
      if (sceneAudios.length > segments.length) sceneAudios.length = segments.length;
      // The voiceover must fit the video: each scene gets the time of the part of the video it tells.
      const coverageFactor = coverage;
      const totalTarget = duration > 0 ? ((prRef.current ? prRef.current.to - prRef.current.from : duration)) * coverageFactor : 0;
      const totalChars = segments.reduce((n, sg) => n + sg.text.length, 0) || 1;
      const lang: 'mm' | 'en' = language === 'en' ? 'en' : 'mm';
      // One shared AudioContext for measuring clip lengths (creating and closing a new one per clip, several at a time, can hit the browser's limit).
      let durCtx: AudioContext | null = null;
      const durOf = async (blob: Blob) => {
        if (!durCtx) durCtx = new Ctx0();
        return (await durCtx.decodeAudioData(await blob.arrayBuffer())).duration;
      };
      const speakWith = async (text: string, i: number, voiceId: string, style: string) => {
        const r = await g.generateTTS(text, { voiceId, speed, pitch: 0, volume: 100, vocalStyle: 'Expressive', styleInstruction: style }, undefined, undefined, (s, msg) =>
          setProgress(p => ({ text: `${msg} (${s}s)`, percent: p?.percent ?? 60 }))
        );
        if (!r?.audioUrl) throw new Error(`No audio for part ${i + 1}`);
        const blob = await (await fetch(r.audioUrl)).blob();
        if (!blob.size) throw new Error(`Empty audio for part ${i + 1}`);
        return blob;
      };
      /** The voice of a character: one per name, a different one for each (by gender), never the narrator's. */
      const voiceFor = (name: string, gender: '♂' | '♀') => {
        const key = name.trim();
        const have = castRef.current.get(key);
        if (have) return have;
        const pool = VOICE_OPTIONS.filter(v => v.gender === (gender === '♂' ? 'male' : 'female') && v.id !== voice);
        const used = new Set(castRef.current.values());
        const pick = (pool.find(v => !used.has(v.id)) || pool[castRef.current.size % Math.max(1, pool.length)] || VOICE_OPTIONS.find(v => v.id !== voice))!.id;
        castRef.current.set(key, pick);
        setCast(Array.from(castRef.current, ([n, v]) => ({ name: n, voice: v })));
        return pick;
      };
      const speakOnce = async (text: string, i: number) => {
        if (!dub || !hasDubTags(text)) return speakWith(stripDubTags(text), i, voice, NARRATOR_STYLE);
        // Dub style: narration lines and character lines are voiced separately, then joined into the one scene clip.
        const parts: { voiceId: string; style: string; text: string }[] = [];
        for (const raw of text.split('\n')) {
          const line = raw.trim();
          if (!line) continue;
          const m = DUB_TAG.exec(line);
          if (m) {
            const body = line.replace(DUB_TAG, '').trim();
            if (body) parts.push({ voiceId: voiceFor(m[1], m[2] as '♂' | '♀'), style: DIALOGUE_STYLE, text: body });
          } else if (parts.length && parts[parts.length - 1].voiceId === voice) {
            parts[parts.length - 1].text += ' ' + line; // consecutive narration is one reading
          } else {
            parts.push({ voiceId: voice, style: NARRATOR_STYLE, text: line });
          }
        }
        const blobs: Blob[] = [];
        for (const pt of parts) blobs.push(await speakWith(pt.text, i, pt.voiceId, pt.style));
        return blobs.length === 1 ? blobs[0] : mergeAudio(blobs, 0.12);
      };
      // Scenes are voiced a few at a time (the API allows it) instead of one after another.
      const voiced: (Blob | undefined)[] = segments.map((_, i) => sceneAudios[i]);
      let finished = voiced.filter(Boolean).length;
      const pending = voiced.map((v, i) => (v ? -1 : i)).filter(i => i >= 0);
      const nKeys = Math.max(getExtraKeys().length + 1, apiChannelManager.getPoolKeys(isAdmin).length);
      const CONC = nKeys >= 8 ? 5 : nKeys >= 4 ? 4 : nKeys >= 2 ? 3 : 2;
      let failure: unknown = null;
      let condenseFails = 0;
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
                if (dur / budget > MAX_FAST && !hasDubTags(segments[i].text) && condenseFails < 2) {
                  // 2) only if it is far too long: shorten the paragraph and voice it again (slow: 2 more API calls)
                  const target = Math.max(20, Math.round(segments[i].text.length * ((budget * MAX_FAST) / dur) * 0.97));
                  const shorter = await g.condenseNarration(segments[i].text, target, lang);
                  // when the text model is overloaded this keeps failing: after two misses stop trying for this run (speeding the voice up still works)
                  if (shorter) condenseFails = 0; else condenseFails++;
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
            setStepTimes(t => [...t.filter(x => !x.startsWith(`  scene ${i + 1}:`)), `  scene ${i + 1}: ${Math.round((Date.now() - t0) / 1000)}s`]);
            setProgress(() => ({ text: `${isMm ? '၃/၄ အသံသွင်းနေသည်' : '3/4 Recording the voiceover'} (${finished}/${segments.length})`, percent: 50 + Math.round((finished / segments.length) * 40) }));
            // keep a resumable draft: the finished scenes from the start
            const prefix: Blob[] = [];
            for (const v of voiced) { if (!v) break; prefix.push(v); }
            draftRef.current = { segments, hasVideoTimes, audios: prefix };
          } catch (e) { failure = failure || e; }
        }
      };
      try { await Promise.all(Array.from({ length: CONC }, () => worker())); } finally { const c = durCtx as AudioContext | null; if (c) void c.close().catch(() => undefined); }
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
      if (splitActive) { partResults.current[part] = { segments: segments.map(sg => ({ ...sg })), sceneAudios: joined.sceneAudios }; setPartsVer(v => v + 1); }
      draftRef.current = null;
      lap('done');
      setProgress({ text: isMm ? 'ပြီးပါပြီ ✅' : 'Done ✅', percent: 100 });
      completed = true;
      showToast(isMm ? '🎉 Auto Recap ပြီးပါပြီ — Voiceover နဲ့ SRT ကို ဒေါင်းလို့ရပါပြီ' : '🎉 Recap ready — download the voiceover and SRT', 'success');
    } catch (e) {
      if (ctrl.signal.aborted || (e instanceof Error && e.message === 'Cancelled')) {
        showToast(isMm ? '⏹ ရပ်လိုက်ပါပြီ' : '⏹ Stopped', 'success');
        setProgress(null);
        if (draftRef.current) setCanResume(true);
        return false;
      }
      console.error('[AutoRecap]', e);
      let msg = e instanceof Error ? e.message : String(e);
      if (/api key not valid|invalid api key|API_KEY_INVALID/i.test(msg)) {
        msg += isMm
          ? ' — Gemini API Key မှားနေသည်။ Settings ထဲက Gemini API Key ကို စစ်ပြီး (AI Studio က key အသစ်ကို အပြည့်ကူးထည့်ပါ) ပြန်သိမ်းပါ။'
          : ' — The Gemini API key is invalid. Check the key in Settings (paste the full key from AI Studio) and save it again.';
      }
      lastErrRef.current = msg;
      setErrorInfo(`[${stageRef.current}] ${msg}`);
      showToast(msg, 'error');
      setProgress(null);
      if (draftRef.current) setCanResume(true);
    } finally {
      setBusy(false);
    }
    return completed;
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

  const doneParts = Object.keys(partResults.current).map(Number).sort((a, b) => a - b);
  void partsVer;
  /** Joins every finished part (in film order) into one complete recap: one voiceover, one SRT, one video to render. */
  const combineParts = async () => {
    const idxs = Object.keys(partResults.current).map(Number).sort((a, b) => a - b);
    if (!idxs.length) return;
    setCombining(true);
    try {
      const segs = idxs.flatMap(i => partResults.current[i].segments.map(sg => ({ ...sg })));
      const auds = idxs.flatMap(i => partResults.current[i].sceneAudios);
      const joined = await joinScenes(segs, auds, false);
      if (result) URL.revokeObjectURL(result.voiceoverUrl);
      setResult({
        script: segs.map(sg => sg.text).join('\n\n'),
        segments: segs,
        hasVideoTimes: true,
        voiceoverBlob: joined.voiceoverBlob,
        voiceoverUrl: URL.createObjectURL(joined.voiceoverBlob),
        sceneAudios: joined.sceneAudios,
        sceneTimes: joined.sceneTimes,
        srt: joined.srt,
        cues: joined.cues,
        duration: joined.duration,
      });
      baseRef.current = { segments: segs.map(sg => ({ ...sg })), sceneAudios: joined.sceneAudios };
      baseVer.current++;
      setVideoUrl(null);
      setIsCombined(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showToast(isMm ? `🎬 အပိုင်း ${idxs.length} ပိုင်းကို ပေါင်းပြီးပါပြီ — ${fmt(joined.duration)} ရှိတဲ့ Recap တစ်ပုဒ်တည်း၊ Render လုပ်လို့ရပါပြီ` : `🎬 ${idxs.length} parts joined — one ${fmt(joined.duration)} recap, ready to render`, 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not join the parts', 'error');
    } finally {
      setCombining(false);
    }
  };

  /** Does every part that is not done yet, one after another (no stops for script review), then joins them all. Waits when every API key is at its limit. */
  const runAllParts = async () => {
    if (autoAll) { autoAbort.current = true; abortRef.current?.abort(); return; }
    if (!file || !splitActive) return;
    autoAbort.current = false;
    setAutoAll(true);
    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
    try {
      for (let p = 0; p < partCount; p++) {
        if (autoAbort.current) break;
        if (partResults.current[p]) continue;
        setPartIdx(p);
        let ok = false, resume = false;
        for (let attempt = 0; attempt < 40 && !autoAbort.current; attempt++) {
          ok = await run(resume, p, true);
          if (ok || autoAbort.current) break;
          if (!/limit|quota|429|exhaust|RESOURCE|overload|503|unavailable/i.test(lastErrRef.current)) break;
          resume = !!draftRef.current;
          const wait = Math.min(900, Math.max(30, soonestFreeSeconds() ?? 60));
          for (let s2 = wait; s2 > 0 && !autoAbort.current; s2--) {
            setProgress({ text: isMm ? `API key အားလုံး limit ထိနေပါတယ် — ${s2} စက္ကန့်စောင့်ပြီး အပိုင်း ${p + 1} ကို ဆက်လုပ်မယ်` : `Every API key is at its limit — continuing part ${p + 1} in ${s2}s`, percent: 50 });
            await sleep(1000);
          }
        }
        if (!ok) {
          if (!autoAbort.current) showToast(isMm ? `အပိုင်း ${p + 1} မှာ ရပ်သွားပါတယ် — အပေါ်က Error ကိုကြည့်ပြီး "စတင်မည်" နဲ့ ပြန်လုပ်ပါ (ပြီးသားအပိုင်းတွေ မပျောက်ပါဘူး)` : `Stopped at part ${p + 1} — see the error, then press Start to retry (finished parts are kept)`, 'error');
          return;
        }
      }
      if (!autoAbort.current) await combineParts();
    } finally {
      setAutoAll(false);
      autoAbort.current = false;
    }
  };

  const baseName = (file?.name || 'recap').replace(/\.[^/.]+$/, '') + (isCombined && result ? '_full' : splitActive ? `_part${(result ? doneIdx.current : curPart) + 1}` : '');
  const [dlBusy, setDlBusy] = useState(false);
  /** Applies the scene editor: skipped scenes are dropped, the rest are re-ordered / re-trimmed, and the voiceover + subtitles are rebuilt to match. */
  const applySceneEdits = async (plan: { idx: number; on: boolean; start: number; end: number; speed: number }[]) => {
    const base = baseRef.current;
    if (!base || !result) return;
    const kept = plan.filter(p => p.on);
    if (!kept.length) { showToast(isMm ? 'အနည်းဆုံး scene တစ်ခု ရှိရပါမယ်' : 'Keep at least one scene', 'error'); return; }
    try {
      const segments = kept.map(p => ({ start: p.start, end: p.end, text: base.segments[p.idx].text, speed: p.speed || 0 }));
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
      if (splitActive && !isCombined) { partResults.current[doneIdx.current] = { segments, sceneAudios: joined.sceneAudios }; setPartsVer(v => v + 1); }
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
        style: getSubtitleStyle(subPreset, subY, subScale, subFont),
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
    const rctrl = new AbortController();
    renderAbortRef.current = rctrl;
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
      let videoId: string | undefined;
      if (longFilm) {
        setRendering(isMm ? 'PC Worker ဆီ ဗီဒီယို ပို့နေသည်…' : 'Sending the video to your PC worker…');
        videoId = await ensureSession(rctrl.signal);
      }
      const scenes: RecapPlanScene[] = result.segments.map((s, i) => ({ fromCue: i, toCue: i, start: s.start, end: s.end, narration: stripDubTags(s.text), speed: s.speed || 0 }));
      const r = await renderSceneRecap({
        signal: rctrl.signal,
        serverUrl,
        authToken,
        videoId,
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
        textLayers: [
          ...(await Promise.all(textLayers.map(async l => ({ png: await renderTextLayerPng(l, w, h), start: l.start, end: l.end, anim: l.anim || 'none' })))),
          ...(await Promise.all(overlays.map(async o => ({ png: await renderImageOverlayPng(o, w, h), start: o.start, end: o.end, anim: o.anim })))),
        ].filter((t): t is { png: Blob; start: number; end: number; anim: 'none' | 'fade' | 'slide' } => !!t.png),
        fx,
        introPng: await renderCardPng(fx.intro, w, h),
        outroPng: await renderCardPng(fx.outro, w, h),
        bgColor: '#000000',
        subtitleStyle: captionsOn ? getSubtitleStyle(subPreset, subY, subScale, subFont) : null,
        subtitleBlur: blurSubOn ? { y: blurSubY / 100, h: blurSubH / 100 } : null,
        bgm: bgmFile,
        bgmVolume: bgmVol,
        logoPng: await renderLogoPng({ image: logoImg, text: logoText, position: logoPos, sizePct: logoSize, opacity: logoOpacity }, w, h),
        onProgress: (d, tot, msg) => setRendering(`${msg} (${d}/${tot})`),
      });
      setVideoUrl(r.downloadUrl);
      showToast(isMm ? 'Recap ဗီဒီယို ပြီးပါပြီ' : 'Recap video ready', 'success');
    } catch (e) {
      if (rctrl.signal.aborted || (e instanceof Error && (e.message === 'Cancelled' || e.name === 'AbortError'))) showToast(isMm ? '⏹ ရပ်လိုက်ပါပြီ' : '⏹ Stopped', 'success');
      else showToast(e instanceof Error ? e.message : 'Render failed', 'error');
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

  const voiceControls = (
    <div className="space-y-5">
          <div>
            <Label icon={<Mic size={12} />}>{isMm ? 'AI အသံရှင်' : 'Voice'}</Label>
            <Select icon={VOICE_OPTIONS.find(v => v.id === voice)?.gender === 'female' ? '👩' : '👨'} value={voice} onChange={setVoice}>
              {VOICE_OPTIONS.map(v => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </Select>
          </div>
          <div className="sm:col-span-2 lg:col-span-1">
            <div className="flex items-center justify-between mb-2">
              <Label>{isMm ? 'အသံနှုန်း' : 'Voice speed'}</Label>
              <span className="mb-2 px-2.5 py-0.5 rounded-full bg-amber-400/15 text-amber-300 text-[12px] font-mono font-bold">{speed.toFixed(2)}x</span>
            </div>
            <input type="range" min={0.8} max={1.3} step={0.05} value={speed} onChange={e => setSpeed(Number(e.target.value))} className="w-full h-2 rounded-full accent-amber-400" />
          </div>
    </div>
  );

  const settingsBlock = (
    <>
        {/* What kind of video */}
        <div className="mt-4 grid grid-cols-2 gap-1 rounded-2xl border border-white/10 bg-black/40 p-1">
          {([
            { id: 'content', icon: '🎞', mm: 'အကြောင်းအရာ', en: 'Content' },
            { id: 'lang', icon: '🌐', mm: 'ဘာသာစကား · Dub', en: 'Language · Dub' },
          ] as const).map(t => (
            <button key={t.id} type="button" onClick={() => setSetupTab(t.id)} className={`rounded-xl py-2.5 flex items-center justify-center gap-1.5 text-[12px] font-bold transition ${setupTab === t.id ? 'bg-white text-slate-900' : 'text-slate-300 hover:bg-white/10'}`}>
              <span>{t.icon}</span>{isMm ? t.mm : t.en}
            </button>
          ))}
        </div>
        <div className={setupTab === 'content' ? '' : 'hidden'}>
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
          {mode === 'speech' && (
            <label className="mt-3 flex items-start gap-2.5 rounded-2xl bg-white/[0.04] border border-white/10 px-4 py-3 text-[12.5px] text-slate-200 cursor-pointer">
              <input type="checkbox" checked={talkOnly} onChange={e => setTalkOnly(e.target.checked)} className="accent-amber-400 w-4 h-4 mt-0.5" />
              <span>
                {isMm ? '⚡ စကားပြောကိုပဲ အခြေခံပြီး ဇာတ်လမ်းဖွဲ့မည် (ပိုမြန်)' : '⚡ Tell the story from the dialogue only (faster)'}
                <span className="block text-[11px] text-slate-500 mt-0.5">{isMm ? 'ပုံကို တစ်ဖရိန်ချင်း မကြည့်တော့ဘဲ စကားပြောကနေ ဇာတ်လမ်းကို လှအောင်ဖွဲ့ပါတယ်။ ပုံထဲက အလုပ်တွေပါ ထည့်ချင်ရင် ပိတ်ပါ။' : 'Skips looking at the frames and retells what is said as a story. Turn off to include what is only visible on screen.'}</span>
              </span>
            </label>
          )}
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

        {/* Recap Style */}
        <div className="mt-5">
          <Label icon={<Sparkles size={12} />}>{isMm ? 'ဇာတ်လမ်းစတိုင်' : 'Recap style'}</Label>
          <div className="flex flex-wrap gap-1.5">
            {styles.map(s => (
              <Chip key={s.id} on={style === s.id} onClick={() => setStyle(s.id)}>
                <span>{s.emoji}</span> {s.name}
              </Chip>
            ))}
          </div>
        </div>

        {/* Fixed length: for long films (e.g. a 2-hour movie into a 15 or 30 minute recap) */}
        {duration >= 480 && (
          <div className="mt-5">
            <Label icon={<Film size={12} />}>{isMm ? 'Recap ကြာချိန် သတ်မှတ်မယ် (ဇာတ်ကားရှည်အတွက်)' : 'Recap length (for long films)'}</Label>
            <div className="flex flex-wrap gap-1.5">
              {[0, 5, 10, 15, 20, 30, 45, 60].filter(m => m === 0 || m * 60 < duration * 0.9).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setTargetMin(m)}
                  className={`px-3 py-2 rounded-xl text-[12px] font-bold border transition ${targetMin === m ? 'bg-amber-400 text-black border-amber-400' : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'}`}
                >
                  {m === 0 ? (isMm ? 'အပေါ်ကအတိုင်း' : 'As above') : `${m} ${isMm ? 'မိနစ်' : 'min'}`}
                </button>
              ))}
            </div>
            {targetMin > 0 && (
              <p className="mt-2 text-[11.5px] leading-relaxed text-slate-500">
                {isMm
                  ? `${fmt(duration)} ရှိတဲ့ ဗီဒီယိုကို ~${targetMin} မိနစ် Recap အဖြစ် အကျဉ်းချုပ်မယ်။ ဇာတ်လမ်းတစ်ခုလုံးကို အစအဆုံး ဖော်ပြပြီး တစ်ပိုင်းချင်းစီမှာ မူရင်းထဲက အပိုင်းအစတွေကို ရောစပ်ပြပါမယ်။`
                  : `Condenses the ${fmt(duration)} video into a ~${targetMin} minute recap that tells the whole story, showing several moments from each stretch.`}
                {duration > 1800 && (isMm ? ' ကြာပါလိမ့်မယ် (ဇာတ်ကားရှည်ဆိုရင် မိနစ် ၃၀–၆၀ ထိ ကြာနိုင်ပါတယ်) — ဖွင့်ထားပြီး စောင့်ပါ။' : ' This takes a while (30-60 minutes for a feature film) - keep the page open.')}
              </p>
            )}
            {longFilm && (
              <p className="mt-2 text-[11.5px] leading-relaxed text-sky-300/80">
                {isMm ? 'ဇာတ်ကားရှည်ဖြစ်လို့ ဗီဒီယိုကို PC Worker ဆီ တစ်ခါပို့ပြီး အဲဒီမှာပဲ အသံထုတ်/render လုပ်ပါမယ်။ Worker v1.12.0 နဲ့ ဖွင့်ထားရပါမယ်။' : 'Long film: the video is sent once to your PC worker, which extracts the speech and renders it. Needs worker v1.12.0.'}
              </p>
            )}
          </div>
        )}

        {/* Split a long film into several recap videos */}
        {duration >= 600 && (
          <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-3.5">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={splitOn} onChange={e => { setSplitOn(e.target.checked); setPartIdx(0); }} className="accent-amber-400 w-4 h-4" />
              <span className="text-[12.5px] font-bold text-white">{isMm ? '✂️ ပိုင်းခွဲပြီး လုပ်မယ် (API မကုန်အောင်၊ နောက်ဆုံး တစ်ပုဒ်တည်း ပေါင်းမယ်)' : '✂️ Do it in parts, then join into one recap (lighter on the API)'}</span>
            </label>
            {splitOn && (
              <div className="mt-3 space-y-3">
                <div>
                  <Label>{isMm ? 'တစ်ပိုင်း Recap ကြာချိန်' : 'Recap length per part'}</Label>
                  <div className="flex gap-1.5">
                    {[3, 5, 7].map(m => (
                      <button key={m} type="button" onClick={() => { setPartMin(m); setPartIdx(0); }} className={`px-3 py-2 rounded-xl text-[12px] font-bold border transition ${partMin === m ? 'bg-amber-400 text-black border-amber-400' : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'}`}>
                        {m} {isMm ? 'မိနစ်' : 'min'}
                      </button>
                    ))}
                  </div>
                </div>
                {partCount > 1 ? (
                  <div>
                    <Label>{isMm ? `အပိုင်း ${partCount} ပိုင်း — ဘယ်ပိုင်းကို လုပ်မလဲ` : `${partCount} parts — which one now?`}</Label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {Array.from({ length: partCount }, (_, i) => {
                        const b = boundsRef.current && boundsRef.current.b.length === partCount + 1 ? boundsRef.current.b : partBounds(cuesRef.current?.cues);
                        return (
                          <button key={i} type="button" onClick={() => setPartIdx(i)} className={`px-2.5 py-2 rounded-xl text-left border transition ${curPart === i ? 'bg-white text-slate-900 border-white' : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'}`}>
                            <div className="text-[12px] font-extrabold">{isMm ? `အပိုင်း ${i + 1}` : `Part ${i + 1}`}{partResults.current[i] ? ' ✓' : ''}</div>
                            <div className="text-[10.5px] font-mono opacity-70">{fmt(b[i])}–{fmt(b[i + 1])}</div>
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-[11.5px] leading-relaxed text-slate-500">
                      {isMm
                        ? 'အပိုင်းတစ်ခုချင်းကို အစဉ်လိုက် ဇာတ်ညွှန်း + အသံသွင်းပါ (အပိုင်း ၁ ကနေ)။ အားလုံးပြီးရင် အောက်က "ပေါင်းမယ်" ကို နှိပ်ပြီး Recap တစ်ပုဒ်တည်း ဖြစ်အောင် ပေါင်းကာ တစ်ခါတည်း Render လုပ်ပါ။ ဇာတ်ကားတစ်ခုလုံးကို တစ်ခါပဲ နားထောင်ပါတယ်။'
                        : 'Script + voice each part in order (from part 1). When they are all done, press "Combine" to join them into ONE recap and render it once. The film is listened to only once.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => void runAllParts()}
                      disabled={(busy && !autoAll) || combining}
                      className={`mt-3 w-full h-12 rounded-xl text-[13px] font-extrabold flex items-center justify-center gap-2 disabled:opacity-40 ${autoAll ? 'bg-rose-500 text-white' : 'bg-gradient-to-r from-amber-300 to-orange-500 text-black'}`}
                    >
                      {autoAll ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                      {autoAll ? (isMm ? 'ရပ်မည် (အလိုအလျောက် လုပ်နေသည်)' : 'Stop (running all parts)') : (isMm ? '⚡ အပိုင်းအားလုံး အလိုအလျောက်လုပ် + ပေါင်း' : '⚡ Do all parts automatically, then join')}
                    </button>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{isMm ? 'ဇာတ်ညွှန်းပြင်ခွင့်မပေးဘဲ အပိုင်း ၁ ကနေ အဆုံးထိ ဆက်တိုက်လုပ်ပါတယ်။ API key (အပိုထည့်ထားတာတွေပါ) ကုန်သွားရင် အားတဲ့ key ကို အလိုအလျောက်ပြောင်းသုံးပြီး အကုန်လုံး limit ထိရင် စောင့်ပြီး ဆက်လုပ်ပါတယ်။' : 'Runs part 1 to the end without pausing for script review. When a key hits its limit it switches to a free key by itself; if all are at the limit it waits and continues.'}</p>
                    <div className="mt-3 flex items-center justify-between gap-2 text-[11.5px] text-slate-400">
                      <span>{isMm ? `ပြီးပြီ: ${doneParts.length}/${partCount} ပိုင်း` : `Done: ${doneParts.length} of ${partCount} parts`}</span>
                      {isCombined && <span className="text-emerald-300 font-bold">{isMm ? 'ပေါင်းပြီး ✓' : 'Combined ✓'}</span>}
                    </div>
                    <button
                      type="button"
                      onClick={() => void combineParts()}
                      disabled={combining || busy || doneParts.length === 0}
                      className="mt-2 w-full h-11 rounded-xl bg-emerald-400 text-black text-[12.5px] font-extrabold flex items-center justify-center gap-2 disabled:opacity-40"
                    >
                      {combining ? <Loader2 size={15} className="animate-spin" /> : <Layers size={15} />}
                      {isMm ? `ပေါင်းမယ် (${doneParts.length}/${partCount} ပိုင်း → Recap တစ်ပုဒ်)` : `Combine (${doneParts.length}/${partCount} parts → one recap)`}
                    </button>
                    {doneParts.length > 0 && doneParts.length < partCount && (
                      <p className="mt-1.5 text-[11px] text-amber-300/80">{isMm ? 'အပိုင်း မစုံသေးပါဘူး — ပေါင်းရင် ပြီးထားတဲ့ အပိုင်းတွေပဲ ပါပါမယ်။' : 'Not all parts are done yet — only the finished ones will be joined.'}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-[11.5px] text-slate-500">{isMm ? 'ဒီအရှည်အတွက် ပိုင်းခွဲစရာ မလိုပါဘူး (၁ ပိုင်းတည်း)။' : 'Nothing to split at this length (one part).'}</p>
                )}
              </div>
            )}
          </div>
        )}

        </Group>
        </div>

        {/* Selects */}
        <div className={setupTab === 'lang' ? '' : 'hidden'}>
        <Group n={2} title={isMm ? 'ဘာသာစကားနဲ့ အသံ' : 'Language & voice'}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-x-4 gap-y-5">
          <div>
            <Label icon={<Globe2 size={12} />}>{isMm ? 'Recap ဘာသာစကား' : 'Language'}</Label>
            <Select icon={language === 'mm' ? '🇲🇲' : '🇬🇧'} value={language} onChange={v => setLanguage(v as 'mm' | 'en')}>
              <option value="mm">Burmese · မြန်မာ</option>
              <option value="en">English</option>
            </Select>
          </div>
          {mode === 'speech' && (
            <div>
              <Label>{isMm ? 'စကားနားထောင်တဲ့ engine' : 'Speech-to-text engine'}</Label>
              <Select icon={sttEngine === 'whisper' ? '🖥️' : '☁️'} value={sttEngine} onChange={v => setSttEngine(v as 'assembly' | 'whisper')}>
                <option value="assembly">AssemblyAI (cloud)</option>
                <option value="whisper">Whisper (PC worker · free)</option>
              </Select>
              {sttEngine === 'whisper' && (
                <div className="mt-2">
                  <Select icon="🧠" value={whisperModel} onChange={setWhisperModel}>
                    <option value="small">small · {isMm ? 'မြန်' : 'fast'}</option>
                    <option value="medium">medium</option>
                    <option value="large-v3">large-v3 · {isMm ? 'အတိကျဆုံး' : 'most accurate'}</option>
                  </Select>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                    {isMm ? 'PC မှာ worker run ထားရမယ်၊ ပထမဆုံးအကြိမ် `pip install faster-whisper` လုပ်ပြီး model ကို အလိုလို ဒေါင်းပါမယ်။' : 'Needs the PC worker running and `pip install faster-whisper` once; the model downloads automatically on first use.'}
                  </p>
                </div>
              )}
            </div>
          )}
          {mode === 'speech' && (
            <div>
              <Label>{isMm ? 'စကားပြော ဘာသာစကား' : 'Spoken language'}</Label>
              <Select icon="✨" value={spokenLang} onChange={setSpokenLang}>
                <option value="auto">Auto detect</option>
                <option value="en">English</option><option value="th">Thai</option><option value="ja">Japanese</option>
                <option value="ko">Korean</option><option value="zh">Chinese</option><option value="es">Spanish</option>
                <option value="fr">French</option><option value="de">German</option>
                {sttEngine === 'whisper' && <option value="my">Burmese · မြန်မာ</option>}
              </Select>
            </div>
          )}
        </div>
        <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-3.5">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={dub} onChange={e => { setDub(e.target.checked); castRef.current = new Map(); setCast([]); }} className="accent-amber-400 w-4 h-4 mt-0.5" />
            <span>
              <span className="block text-[12.5px] font-bold text-white">{isMm ? '🎭 Dub Recap — ဇာတ်ကောင်တစ်ယောက်ချင်းစီ ကိုယ်ပိုင်အသံနဲ့' : '🎭 Dub Recap — characters speak in their own voices'}</span>
              <span className="block mt-1 text-[11.5px] leading-relaxed text-slate-500">
                {isMm
                  ? 'အဓိကဇာတ်ကွက်တွေမှာ ဇာတ်ကောင်တွေက ကိုယ်တိုင်ပြောတဲ့ စကားတွေ ပါလာပြီး ပြောသူအလိုက် အသံမတူအောင် (အမျိုးသား/အမျိုးသမီး) ခွဲပေးပါတယ်။ ကျန်တာကို အထက်က AI အသံရှင်က ဇာတ်ကြောင်းပြောပါတယ်။ အသံသွင်းတဲ့ TTS ခေါ်ယူမှု ပိုများပါတယ်။'
                  : 'At key moments the characters speak their own lines, each in a different voice (male / female); the narrator voice above tells the rest. Uses more TTS calls.'}
              </span>
            </span>
          </label>
          {dub && cast.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {cast.map(c => (
                <span key={c.name} className="px-2.5 py-1 rounded-full bg-white/10 text-[11px] text-slate-200">{c.name} → {VOICE_OPTIONS.find(v => v.id === c.voice)?.voiceName || c.voice}</span>
              ))}
            </div>
          )}
        </div>

        {!reviewScript && (
          <details className="mt-4 rounded-2xl border border-white/10 bg-black/30">
            <summary className="cursor-pointer list-none px-4 py-3 text-[12.5px] font-bold text-slate-200 flex items-center justify-between">
              <span>🎙 {isMm ? 'အသံသွင်း ဆက်တင် (AI အသံရှင် · အသံနှုန်း)' : 'Voice settings (voice · speed)'}</span>
              <span className="text-[11px] font-normal text-slate-400">{VOICE_OPTIONS.find(v => v.id === voice)?.voiceName} · {speed.toFixed(2)}x</span>
            </summary>
            <div className="px-4 pb-4 pt-1">{voiceControls}</div>
          </details>
        )}
        </Group>
        </div>
    </>
  );

  return (
    <div className="max-w-2xl lg:max-w-none mx-auto space-y-5 lg:space-y-0 lg:grid lg:grid-cols-12 lg:gap-6 lg:items-start">
      <div className={`${panel} lg:col-span-5 xl:col-span-4 lg:order-2`}>
        {/* Header */}
        <div className="flex items-center justify-between gap-3.5 mb-5 pb-5 border-b border-white/10">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-300 to-orange-500 grid place-items-center shadow-lg shadow-amber-500/30">
              <Clapperboard size={22} className="text-black" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-extrabold text-white leading-tight">Auto Recap</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-400/20 text-amber-300 border border-amber-400/30">PRO</span>
              </div>
              <p className="text-[12px] text-slate-400">{isMm ? 'ဗီဒီယိုကို ကြည့်ပြီး ဇာတ်ညွှန်း · Voiceover · SRT ထုတ်ပေးမည်' : 'Watches your video → script · voiceover · SRT'}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowCopyrightModal(true)}
            className="px-3 py-2 rounded-xl bg-amber-400/15 hover:bg-amber-400/25 border border-amber-400/35 text-amber-300 text-[12px] font-extrabold flex items-center gap-1.5 transition active:scale-95 shadow-sm shrink-0"
            title={isMm ? 'မူပိုင်ခွင့် ကာကွယ်ရေး စစ်ဆေးမည်' : 'Anti-Copyright Protection'}
          >
            <ShieldAlert size={14} className="text-amber-400" />
            <span>{isMm ? 'Copyright' : 'Copyright'}</span>
            {blurSubOn && <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />}
          </button>
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
          {busy ? (isMm ? 'လုပ်ဆောင်နေသည်…' : 'Working…') : splitActive ? (isMm ? `အပိုင်း ${curPart + 1}/${partCount} စတင်မည်` : `Start part ${curPart + 1} of ${partCount}`) : isMm ? 'Auto Recap စတင်မည်' : 'Start Auto Recap'}
        </button>
        {busy && (
          <button
            type="button"
            onClick={stopAll}
            className="mt-2 w-full h-11 rounded-2xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-200 text-[13px] font-bold flex items-center justify-center gap-2 transition active:scale-[0.99]"
          >
            ⏹ {isMm ? 'ရပ်မည်' : 'Stop'}
          </button>
        )}

        <label className="mt-2 flex items-center gap-2.5 rounded-2xl bg-white/[0.04] border border-white/10 px-4 py-3 text-[12.5px] text-slate-200 cursor-pointer">
          <input type="checkbox" checked={reviewScript} onChange={e => setReviewScript(e.target.checked)} className="accent-amber-400 w-4 h-4" />
          {isMm ? '✍️ အသံမသွင်းခင် ဇာတ်ညွှန်းကို ပြင်ခွင့်ရအောင် ခဏရပ်ပါ' : '✍️ Pause to let me edit the script before recording'}
        </label>
        </div>

        {stepTimes.length > 0 && (
          <div className="mt-3 rounded-2xl bg-white/[0.03] border border-white/10 px-4 py-3">
            <div className="text-[11px] font-bold text-slate-300 mb-1">{isMm ? '⏱ အဆင့်တစ်ခုချင်း ကြာချိန်' : '⏱ Time per step'}</div>
            <pre className="text-[11px] leading-relaxed font-mono text-slate-400 whitespace-pre-wrap">{stepTimes.join('\n')}</pre>
          </div>
        )}

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
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-3.5">
              <div className="text-[12.5px] font-bold text-white mb-3">🎙 {isMm ? 'အသံသွင်း ဆက်တင်' : 'Voice settings'}</div>
              {voiceControls}
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
              <div className="mx-auto max-w-[520px] aspect-video rounded-3xl overflow-hidden bg-black border border-white/10 grid place-items-center shadow-2xl shadow-black/60 relative">
                {thumb ? <img src={thumb} alt="" className="w-full h-full object-contain" /> : <Film size={40} className="text-slate-600" />}
                {blurSubOn && (
                  <div
                    className="absolute inset-x-0 bg-amber-400/25 border-y-2 border-dashed border-amber-400/80 backdrop-blur-md pointer-events-none flex items-center justify-center z-10"
                    style={{ top: `${blurSubY}%`, height: `${blurSubH}%` }}
                  >
                    <span className="px-2.5 py-1 rounded bg-black/85 text-[11px] font-bold text-amber-300 flex items-center gap-1 shadow-md">
                      🙈 {isMm ? 'မူရင်းစာတန်း Blur နေရာ' : 'Original Subtitle Blur'} ({blurSubY}%, {blurSubH}%)
                    </span>
                  </div>
                )}
              </div>
              <div className="mt-5 text-[15px] font-extrabold text-white truncate">{file.name}</div>
              <div className="mt-2 flex items-center justify-center gap-2 text-[11.5px] text-slate-400">
                <span className="px-2.5 py-1 rounded-full bg-white/10">{duration > 0 ? fmt(duration) : '…'}</span>
                <span className="px-2.5 py-1 rounded-full bg-white/10">{(file.size / 1048576).toFixed(1)} MB</span>
              </div>
              <div className="mt-3 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowCopyrightModal(true)}
                  className="px-3.5 py-1.5 rounded-xl bg-amber-400/15 hover:bg-amber-400/25 border border-amber-400/35 text-amber-300 text-[11.5px] font-extrabold flex items-center gap-1.5 transition active:scale-95 shadow-sm"
                >
                  <ShieldAlert size={13} className="text-amber-400" />
                  <span>{isMm ? 'Anti-Copyright & စာတန်း Blur စစ်ဆေးမည်' : 'Anti-Copyright & Subtitle Blur'}</span>
                  {blurSubOn && <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />}
                </button>
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
              <div className="text-[15px] font-extrabold text-white">{isCombined ? (isMm ? 'ပေါင်းပြီးသား Recap အပြည့်အစုံ' : 'Full recap (all parts joined)') : (isMm ? 'Recap ပြီးပါပြီ' : 'Your recap is ready')}</div>
              <div className="text-[12px] text-slate-400">{result.segments.length} {isMm ? 'ပိုင်း' : 'parts'} · {fmt(result.duration)}</div>
            </div>
            {splitActive && !isCombined && doneParts.length === partCount && (
              <button type="button" onClick={() => void combineParts()} disabled={combining} className="ml-auto px-3.5 py-2 rounded-xl bg-emerald-400 text-black text-[12px] font-extrabold">
                {isMm ? 'အားလုံးပေါင်းမယ် →' : 'Combine all →'}
              </button>
            )}
            {splitActive && !isCombined && doneParts.length < partCount && curPart < partCount - 1 && (
              <button type="button" onClick={() => { setPartIdx(curPart + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="ml-auto px-3.5 py-2 rounded-xl bg-amber-400 text-black text-[12px] font-extrabold">
                {isMm ? `နောက်အပိုင်း ${curPart + 2} →` : `Next: part ${curPart + 2} →`}
              </button>
            )}
          </div>

          <div className="2xl:grid 2xl:grid-cols-[minmax(340px,440px)_minmax(0,1fr)] 2xl:gap-8 items-start">
            {/* Left: what you hear and see */}
            <div className="sticky top-[5.5rem] z-30 mb-5 2xl:mb-0 rounded-2xl border border-white/10 bg-slate-950/95 backdrop-blur-xl p-3 shadow-2xl shadow-black/60">
          <audio controls src={result.voiceoverUrl} className="w-full mb-3 h-9" />

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
                filterCss={FILTER_CSS[fx.filter]}
                subPreset={subPreset}
                subFont={subFont}
                captionsOn={captionsOn}
                subY={subY}
                subScale={subScale}
                blurBand={blurSubOn ? { y: blurSubY / 100, h: blurSubH / 100 } : null}
                logoImg={logoImg}
                logoText={logoText}
                logoPos={logoPos}
                logoSize={logoSize}
                logoOpacity={logoOpacity}
                maxHeight={wideScreen ? 470 : 230}
                recap={result ? { voiceoverUrl: result.voiceoverUrl, cues: result.cues, duration: result.duration, sceneTimes: result.sceneTimes, segments: result.segments, hasVideoTimes: result.hasVideoTimes } : null}
                isMm={isMm}
              />
              <p className="mt-2 hidden 2xl:block text-[11px] text-slate-500">{isMm ? 'ဒါက Recap အသံ၊ စာတန်း၊ ဗီဒီယိုအပိုင်းတွေကို ဘရောက်ဇာထဲမှာ တွဲဖွင့်ပြတာပါ။ BGM မပါပါဘူး၊ ထွက်လာမယ့် mp4 နဲ့ အတိအကျ မတူနိုင်ပါဘူး။' : 'The recap voice, subtitles and matching footage played together in your browser. No BGM, and not frame-exact with the final mp4.'}</p>
            </div>

            </div>

            {/* Right: files and settings */}
            <div className="mt-6 2xl:mt-0">
          <div className="mb-4 grid grid-cols-5 gap-1 rounded-2xl border border-white/10 bg-black/40 p-1">
            {([
              { id: 'scenes', icon: '🎞', mm: 'ဇာတ်ကွက်', en: 'Scenes' },
              { id: 'captions', icon: '💬', mm: 'စာတန်း', en: 'Captions' },
              { id: 'video', icon: '🎬', mm: 'ဗီဒီယို', en: 'Video' },
              { id: 'brand', icon: '🏷', mm: 'Logo/BGM', en: 'Brand' },
              { id: 'export', icon: '⬇', mm: 'ထုတ်ရန်', en: 'Export' },
            ] as const).map(t => (
              <button key={t.id} type="button" onClick={() => setResTab(t.id)} className={`rounded-xl py-2.5 flex flex-col items-center gap-0.5 text-[11px] font-bold transition ${resTab === t.id ? 'bg-white text-slate-900' : 'text-slate-300 hover:bg-white/10'}`}>
                <span className="text-[15px] leading-none">{t.icon}</span>{isMm ? t.mm : t.en}
              </button>
            ))}
          </div>
          <div className={resTab === 'scenes' ? '' : 'hidden'}>
          {baseRef.current && result.hasVideoTimes && (
            <div className="mb-5 pb-5 border-b border-white/10">
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
          </div>
          <div className={resTab === 'captions' ? '' : 'hidden'}>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-5">
            <label className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 cursor-pointer">
              <span className="text-[13px] font-bold text-white">{isMm ? 'စာတန်း ပြမည်' : 'Show captions'}</span>
              <input type="checkbox" checked={captionsOn} onChange={e => setCaptionsOn(e.target.checked)} className="accent-emerald-400 w-5 h-5" />
            </label>
            {captionsOn && (
              <>
                <div className="grid grid-cols-3 gap-1 rounded-xl bg-white/[0.05] p-1">
                  {([['presets', isMm ? 'ပုံစံ' : 'Presets'], ['font', isMm ? 'ဖောင့်' : 'Font'], ['effects', isMm ? 'Effects' : 'Effects']] as const).map(([id, l]) => (
                    <button key={id} type="button" onClick={() => setCapTab(id)} className={`rounded-lg py-2 text-[12px] font-bold transition ${capTab === id ? 'bg-amber-400 text-black' : 'text-slate-300'}`}>{l}</button>
                  ))}
                </div>
                <div className={capTab === 'presets' ? '' : 'hidden'}>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {SUBTITLE_PRESETS.map(p => (
                      <button key={p.id} type="button" onClick={() => setSubPreset(p.id)} className={`rounded-2xl border px-2 py-3 flex flex-col items-center gap-2 transition ${subPreset === p.id ? 'border-emerald-400 bg-emerald-400/10' : 'border-white/10 bg-white/[0.04]'}`}>
                        <span className="rounded-lg px-2.5 py-1 text-[17px] font-black leading-none" style={{ background: p.swatch.bg, color: p.swatch.fill, WebkitTextStroke: p.swatch.bg ? undefined : `2px ${p.swatch.stroke}`, paintOrder: 'stroke fill' }}>
                          {p.swatch.accent ? <>A<span style={{ color: p.swatch.accent }}>a</span></> : 'Aa'}
                        </span>
                        <span className="text-[10.5px] text-slate-300 text-center leading-tight">{isMm ? p.name.mm : p.name.en}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className={capTab === 'font' ? '' : 'hidden'}>
                  <div className="grid grid-cols-2 gap-2">
                    {SUBTITLE_FONTS.map(f => (
                      <button key={f.id} type="button" onClick={() => setSubFont(f.id)} className={`rounded-2xl border px-3 py-4 flex flex-col items-center gap-1.5 transition ${subFont === f.id ? 'border-emerald-400 bg-emerald-400/10' : 'border-white/10 bg-white/[0.04]'}`}>
                        <span className="text-[22px] font-black text-white" style={{ fontFamily: f.family }}>{f.sample}</span>
                        <span className="text-[10.5px] text-slate-300">{f.label}</span>
                      </button>
                    ))}
                    {myFonts.map(f => (
                      <button key={f.id} type="button" onClick={() => setSubFont(f.family)} className={`rounded-2xl border px-3 py-4 flex flex-col items-center gap-1.5 transition ${subFont === f.family ? 'border-emerald-400 bg-emerald-400/10' : 'border-white/10 bg-white/[0.04]'}`}>
                        <span className="text-[22px] font-black text-white" style={{ fontFamily: `"${f.family}"` }}>မင်္ဂလာပါ Abc</span>
                        <span className="text-[10.5px] text-slate-300 truncate max-w-full">{f.name}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500">{isMm ? 'ကိုယ်ပိုင်ဖောင့် ထပ်ထည့်ချင်ရင် ပြင်ဆင်ချက် (Settings) ထဲက "ကျွန်ုပ်၏ ဖောင့်များ" မှာ ထည့်ပါ။' : 'To add your own font, use "My fonts" in Settings.'}</p>
                </div>
                <div className={capTab === 'effects' ? '' : 'hidden'}>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-2xl border border-emerald-400 bg-emerald-400/10 px-3 py-4 text-center">
                      <div className="text-[13px] font-bold text-white">{isMm ? 'Still (ငြိမ်)' : 'Still'}</div>
                      <div className="text-[10.5px] text-slate-400 mt-1">{isMm ? 'စာတန်းတစ်ကြောင်းလုံး တစ်ပြိုင်နက်ပေါ်' : 'Whole line appears at once'}</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-3 py-4 text-center opacity-50">
                      <div className="text-[13px] font-bold text-slate-300">{isMm ? 'Animation' : 'Animation'}</div>
                      <div className="text-[10.5px] text-slate-500 mt-1">{isMm ? 'စကားလုံးတစ်လုံးချင်း — မရသေးပါ' : 'Word-by-word — not supported yet'}</div>
                    </div>
                  </div>
                </div>
              </>
            )}

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

          </div>
          </div>
          <div className={resTab === 'video' ? '' : 'hidden'}>
          {result.hasVideoTimes && (
            <div className="mt-5">
              <EditToolsPanel
                fx={fx}
                onFx={setFx}
                textLayers={textLayers}
                onTextLayers={setTextLayers}
                overlays={overlays}
                onOverlays={setOverlays}
                duration={result.duration}
                hasBgm={!!bgmFile}
                thumb={thumb}
                isMm={isMm}
              />
            </div>
          )}

          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-5">
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

          </div>
          </div>
          <div className={resTab === 'brand' ? '' : 'hidden'}>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-5">
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
          </div>
          <div className={resTab === 'export' ? '' : 'hidden'}>
          <div className="mb-5 pb-5 border-b border-white/10">
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
            {rendering && (
              <button type="button" onClick={stopAll} className="mt-2 w-full h-10 rounded-2xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-200 text-[12.5px] font-bold transition">
                ⏹ {isMm ? 'ရပ်မည်' : 'Stop'}
              </button>
            )}
            {videoUrl && (
              <button type="button" onClick={downloadVideo} disabled={dlBusy} className="mt-3 w-full flex items-center justify-center gap-2 h-12 rounded-2xl bg-emerald-400 text-black text-[13px] font-extrabold disabled:opacity-60">
                {dlBusy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}{isMm ? 'Recap ဗီဒီယို ဒေါင်းမည် (.mp4)' : 'Download recap video (.mp4)'}
              </button>
            )}
            {videoUrl && <RecapShare videoUrl={videoUrl} fileName={`${baseName}_recap.mp4`} defaultTitle={baseName} isMm={isMm} />}
          </div>
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
          </div>

            </div>
          </div>
        </div>
      )}

        <div className="hidden lg:block">{settingsBlock}</div>
      </div>

      <CopyrightModal
        isOpen={showCopyrightModal}
        onClose={() => setShowCopyrightModal(false)}
        isMm={isMm}
        hasVideo={!!file}
        scriptText={draft?.segments.map(s => s.text).join('\n\n') || result?.scenes.map(s => s.text).join('\n\n')}
        subtitleBlurOn={blurSubOn}
        subtitleBlurY={blurSubY}
        subtitleBlurH={blurSubH}
        onSubtitleBlurChange={(on, y, h) => {
          setBlurSubOn(on);
          setBlurSubY(y);
          setBlurSubH(h);
        }}
        onApplyFullProtection={handleApplyFullAntiCopyright}
      />
    </div>
  );
};

/** Joins the per-scene voice clips into one voiceover and builds the SRT / cue timeline for them. */
/** Joins several voiced lines into one clip (short pause between them). */
async function mergeAudio(blobs: Blob[], gap: number): Promise<Blob> {
  const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  const ctx = new Ctx();
  const bufs: AudioBuffer[] = [];
  try {
    for (const b of blobs) bufs.push(await ctx.decodeAudioData(await b.arrayBuffer()));
  } finally { void ctx.close(); }
  const rate = bufs[0].sampleRate;
  const total = bufs.reduce((n, b) => n + b.duration, 0) + gap * (bufs.length - 1);
  const out = new AudioBuffer({ length: Math.ceil(total * rate), numberOfChannels: 1, sampleRate: rate });
  const ch = out.getChannelData(0);
  let t = 0;
  for (const b of bufs) {
    // clips from the same TTS model share a sample rate; resample by index if one differs
    const src = b.getChannelData(0);
    if (b.sampleRate === rate) ch.set(src, Math.round(t * rate));
    else for (let k = 0; k < src.length; k++) { const idx = Math.round(t * rate) + Math.round((k * rate) / b.sampleRate); if (idx < ch.length) ch[idx] = src[k]; }
    t += b.duration + gap;
  }
  return audioBufferToWav(out);
}

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
    planSubtitlePieces(stripDubTags(segments[i].text), splitSentenceIntoCueBlocks).forEach(pc => {
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
