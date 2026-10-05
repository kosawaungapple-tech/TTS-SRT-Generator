import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { 
  Upload, 
  FileVideo, 
  FileAudio,
  Sparkles, 
  Trash2, 
  ShieldCheck, 
  Key,
  Download,
  Copy,
  Check,
  RefreshCw,
  FileText,
  Clock,
  Zap,
  Globe,
  Search,
  Mic2,
  Sliders,
  Settings,
  Languages,
  ArrowRight,
  Play,
  RotateCcw,
  Volume2
} from 'lucide-react';
import { GeminiTTSService } from '../services/geminiService';
import { assemblyAiService, AssemblyAITranscriptResponse } from '../services/assemblyAiService';
import { apiChannelManager } from '../services/apiChannelManager';
import { logActivity } from '../services/activityService';
import { parseTimestampToSeconds, shiftSrtContent } from '../utils/subtitleUtils';
import { formatTime } from '../utils/audioUtils';
import { VBSUserControl, ModalConfig } from '../types';
import { useLanguage } from '../contexts/LanguageContext';

interface VideoTranscriberProps {
  onTranscriptionComplete: (text: string, duration?: number) => void;
  getApiKey: () => string | null;
  showToast: (message: string, type: 'success' | 'error') => void;
  openModal: (config: ModalConfig) => void;
  isAdmin: boolean;
  userControl: VBSUserControl | null;
  onNavigateToSettings?: () => void;
  onProcessingStateChange?: (isProcessing: boolean) => void;
}

interface SrtCue {
  index: number;
  start: string;
  end: string;
  text: string;
  speaker?: string;
}

function parseSrtToCues(srtText: string): SrtCue[] {
  if (!srtText) return [];
  const raw = srtText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = raw.split(/\n\s*\n/).filter(b => b.trim().length > 0);

  const cues: SrtCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length >= 2) {
      let index = parseInt(lines[0], 10);
      let timeLine = lines[1];
      let textLines = lines.slice(2);

      if (isNaN(index) || !lines[0].match(/^\d+$/)) {
        timeLine = lines[0];
        textLines = lines.slice(1);
        index = cues.length + 1;
      }

      const timeParts = timeLine.split('-->');
      if (timeParts.length === 2) {
        const start = timeParts[0].trim();
        const end = timeParts[1].trim();
        let fullText = textLines.join(' ');
        let speaker: string | undefined;

        const speakerMatch = fullText.match(/^\[Speaker\s+([^\]]+)\]:\s*(.*)$/i);
        if (speakerMatch) {
          speaker = speakerMatch[1];
          fullText = speakerMatch[2];
        }

        cues.push({
          index,
          start,
          end,
          text: fullText,
          speaker
        });
      }
    }
  }
  return cues;
}

export const VideoTranscriber: React.FC<VideoTranscriberProps> = ({ 
  onTranscriptionComplete, 
  getApiKey, 
  showToast,
  openModal,
  isAdmin,
  userControl,
  onNavigateToSettings,
  onProcessingStateChange
}) => {
  const { language, t } = useLanguage();
  const isMm = language === 'mm';

  // ==========================================
  // AssemblyAI State
  // ==========================================
  const [assemblyApiKey, setAssemblyApiKey] = useState(() => assemblyAiService.getStoredApiKey());

  // Listen to changes in localStorage for AssemblyAI Key
  useEffect(() => {
    const handleStorage = () => {
      setAssemblyApiKey(assemblyAiService.getStoredApiKey());
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const [assemblyMediaFile, setAssemblyMediaFile] = useState<File | null>(null);
  const [assemblyLanguage, setAssemblyLanguage] = useState('auto');
  const [assemblySpeakerLabels, setAssemblySpeakerLabels] = useState(true);
  const [assemblySpeechModel, setAssemblySpeechModel] = useState<'best' | 'nano'>('best');

  const [isProcessingAssemblyAI, setIsProcessingAssemblyAI] = useState(false);
  const [assemblyProgress, setAssemblyProgress] = useState<{ step: string; percent: number }>({ step: '', percent: 0 });
  const [assemblyResult, setAssemblyResult] = useState<{ transcript: AssemblyAITranscriptResponse; srt: string } | null>(null);
  const [activeResultTab, setActiveResultTab] = useState<'cues' | 'raw' | 'text' | 'recap'>('cues');
  const [recapScript, setRecapScript] = useState<string | null>(null);
  const [isGeneratingRecap, setIsGeneratingRecap] = useState(false);
  const [srtSearchQuery, setSrtSearchQuery] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [copiedCueIndex, setCopiedCueIndex] = useState<number | null>(null);

  // ==========================================
  // Media Player & Real-time Subtitle Sync State
  // ==========================================
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const [playbackTime, setPlaybackTime] = useState<number>(0);
  const [mediaDuration, setMediaDuration] = useState<number>(0);
  const [timingOffset, setTimingOffset] = useState<number>(0); // in seconds (+ or -)
  const [mediaFileUrl, setMediaFileUrl] = useState<string | null>(null);

  useEffect(() => {
    if (assemblyMediaFile) {
      const url = URL.createObjectURL(assemblyMediaFile);
      setMediaFileUrl(url);
      setPlaybackTime(0);
      return () => {
        URL.revokeObjectURL(url);
      };
    } else {
      setMediaFileUrl(null);
    }
  }, [assemblyMediaFile]);

  // Helper to apply timing offset to raw SRT content
  const getEffectiveSrt = (rawSrt: string | null | undefined): string => {
    if (!rawSrt) return '';
    if (timingOffset === 0) return rawSrt;
    return shiftSrtContent(rawSrt, timingOffset);
  };

  // Adjust timing offset (+/- seconds)
  const handleAdjustTimingOffset = (delta: number) => {
    const next = Math.round((timingOffset + delta) * 10) / 10;
    setTimingOffset(next);
    showToast(
      isMm 
        ? `စာတန်းထိုး အချိန်ကိုက် ချိန်ညှိမှု: ${next >= 0 ? '+' : ''}${next.toFixed(1)}s` 
        : `Subtitle sync offset: ${next >= 0 ? '+' : ''}${next.toFixed(1)}s`, 
      'success'
    );
  };

  // Seek media player to specific cue timestamp
  const handleSeekToCue = (timeStr: string) => {
    const sec = parseTimestampToSeconds(timeStr);
    if (mediaRef.current) {
      mediaRef.current.currentTime = Math.max(0, sec);
      mediaRef.current.play().catch(() => {});
    }
  };

  // ==========================================
  // Burmese Pro Translation State (Google AI)
  // ==========================================
  const [isTranslatingSrt, setIsTranslatingSrt] = useState(false);
  const [translationProgress, setTranslationProgress] = useState<{ step: string; percent: number }>({ step: '', percent: 0 });
  const [translatedBurmeseSrt, setTranslatedBurmeseSrt] = useState<string | null>(null);
  const [translatedNarrativeScript, setTranslatedNarrativeScript] = useState<string | null>(null);
  
  // Style selector - 'သူ့မူရင်းအတိုင်း' as first & prominent option per user request
  const [translationStyle, setTranslationStyle] = useState('သူ့မူရင်းအတိုင်း (Original Fidelity / Direct - မူရင်းစကားအတိုင်း တိကျစွာ)');
  const [activeSubtitleLang, setActiveSubtitleLang] = useState<'burmese' | 'original'>('burmese');

  // Track any active background process and notify parent tab
  const isAnyProcessing = isProcessingAssemblyAI || isTranslatingSrt || isGeneratingRecap;
  useEffect(() => {
    onProcessingStateChange?.(isAnyProcessing);
  }, [isAnyProcessing, onProcessingStateChange]);

  const assemblyFileInputRef = useRef<HTMLInputElement>(null);
  const [assemblyDragActive, setAssemblyDragActive] = useState(false);

  // ==========================================
  // AssemblyAI Drag & Drop Handlers
  // ==========================================
  const handleAssemblyDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setAssemblyDragActive(true);
    } else if (e.type === "dragleave") {
      setAssemblyDragActive(false);
    }
  };

  const handleAssemblyDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setAssemblyDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setAssemblyMediaFile(file);
      setAssemblyResult(null);
      setTranslatedBurmeseSrt(null);
      setTranslatedNarrativeScript(null);
    }
  };

  const handleAssemblyFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setAssemblyMediaFile(e.target.files[0]);
      setAssemblyResult(null);
      setTranslatedBurmeseSrt(null);
      setTranslatedNarrativeScript(null);
    }
  };

  // Start AssemblyAI Auto-SRT
  const handleStartAssemblyAITranscription = async () => {
    const key = assemblyApiKey.trim() || assemblyAiService.getStoredApiKey();
    if (!key) {
      openModal({
        title: t('common.error'),
        message: isMm ? 'ကျေးဇူးပြု၍ AssemblyAI API Key ကို Settings တွင် အရင်ထည့်သွင်းပါ' : 'Please configure your AssemblyAI API Key in Settings',
        type: 'error',
        confirmText: isMm ? 'ပြင်ဆင်ချက်သို့ သွားမည်' : 'Go to Settings',
        onConfirm: () => { if (onNavigateToSettings) onNavigateToSettings(); }
      });
      return;
    }

    if (!assemblyMediaFile) {
      showToast(isMm ? 'ကျေးဇူးပြု၍ ဗီဒီယို သို့မဟုတ် အသံဖိုင် တင်သွင်းပါ' : 'Please upload a video or audio file', 'error');
      return;
    }

    setIsProcessingAssemblyAI(true);
    setAssemblyProgress({ step: isMm ? 'အသံဖိုင် စတင်ပြင်ဆင်နေပါသည်...' : 'Preparing audio...', percent: 10 });
    setAssemblyResult(null);
    setTranslatedBurmeseSrt(null);
    setTranslatedNarrativeScript(null);

    try {
      const result = await assemblyAiService.processToSrt({
        apiKey: key,
        file: assemblyMediaFile || undefined,
        languageCode: assemblyLanguage,
        autoLanguage: assemblyLanguage === 'auto',
        speakerLabels: assemblySpeakerLabels,
        speechModel: assemblySpeechModel,
        onProgress: (step, percent) => {
          setAssemblyProgress({ step, percent });
        }
      });

      setAssemblyResult({
        transcript: result.transcript,
        srt: result.srt
      });
      setActiveSubtitleLang('original');

      // Automatically generate Movie Recap Script
      if (result.transcript.text) {
        handleGenerateRecapScript(result.transcript.text);
      }

      showToast(isMm ? 'အချိန်ကိုက် SRT စာတန်းထိုး အောင်မြင်စွာ ထုတ်ယူပြီးပါပြီ! ⚡' : 'SRT subtitles generated successfully!', 'success');
      
      if (userControl?.vbsId) {
        logActivity(userControl.vbsId, 'transcription', `Generated AssemblyAI SRT: ${assemblyMediaFile?.name || 'File'}`);
      }
    } catch (err: unknown) {
      console.error('[AssemblyAI] Processing error:', err);
      const msg = err instanceof Error ? err.message : 'Transcription failed';
      showToast(msg, 'error');
    } finally {
      setIsProcessingAssemblyAI(false);
    }
  };

  // ==========================================
  // Burmese Pro Translation Handler (Google AI)
  // ==========================================
  const handleTranslateToBurmese = async () => {
    if (!assemblyResult?.srt) {
      showToast(isMm ? 'ဘာသာပြန်ရန် SRT စာတန်းထိုး မရှိသေးပါ' : 'No SRT subtitles to translate', 'error');
      return;
    }

    const rawKey = getApiKey();
    const apiKey = (rawKey || '').trim();
    if (!apiKey && !isAdmin && !apiChannelManager.getSettings().useAdminKeys) {
      openModal({
        title: t('common.error'),
        message: t('generate.noApiKey'),
        type: 'error',
        confirmText: isMm ? 'ပြင်ဆင်ချက်သို့ သွားမည်' : 'Go to Settings',
        onConfirm: () => { if (onNavigateToSettings) onNavigateToSettings(); }
      });
      return;
    }

    setIsTranslatingSrt(true);
    setTranslationProgress({ 
      step: isMm ? 'စာတန်းထိုးများကို မြန်မာလို စတင်ပြန်ဆိုနေပါသည်...' : 'Translating subtitles to Burmese...', 
      percent: 10 
    });

    try {
      const useManaged = isAdmin || apiChannelManager.getSettings().useAdminKeys;
      const gemini = new GeminiTTSService(useManaged ? '' : apiKey, isAdmin);

      const result = await gemini.translateSrtToMyanmar(
        assemblyResult.srt,
        translationStyle,
        (step, percent) => {
          setTranslationProgress({ step, percent });
        }
      );

      setTranslatedBurmeseSrt(result.translatedSrt);
      setTranslatedNarrativeScript(result.narrativeScript);
      setActiveSubtitleLang('burmese');
      showToast(isMm ? 'မြန်မာဘာသာသို့ အောင်မြင်စွာ ပြန်ဆိုပြီးပါပြီ! 🇲🇲✨' : 'Translated to Burmese successfully!', 'success');

      if (userControl?.vbsId) {
        logActivity(userControl.vbsId, 'translation', `Translated SRT to Burmese: ${assemblyMediaFile?.name || 'Subtitles'}`);
      }
    } catch (err: unknown) {
      console.error('[Translation] Error:', err);
      const msg = err instanceof Error ? err.message : 'Translation failed';
      openModal({
        title: t('common.error'),
        message: msg,
        type: 'error'
      });
    } finally {
      setIsTranslatingSrt(false);
    }
  };

  // Generate Movie Recap Script
  const handleGenerateRecapScript = async (transcript: string) => {
    const rawKey = getApiKey();
    const apiKey = (rawKey || '').trim();
    if (!apiKey && !isAdmin && !apiChannelManager.getSettings().useAdminKeys) {
      return;
    }

    setIsGeneratingRecap(true);
    try {
      const useManaged = isAdmin || apiChannelManager.getSettings().useAdminKeys;
      const gemini = new GeminiTTSService(useManaged ? '' : apiKey, isAdmin);
      const script = await gemini.generateMovieRecapScript(transcript);
      setRecapScript(script);
    } catch (err) {
      console.error('[Recap] Error:', err);
      const msg = err instanceof Error ? err.message : 'Recap generation failed';
      // Only show error if it's not a background auto-generation or if it's specifically requested
      // For now, let's show it to help user see what's wrong
      if (msg.includes('API Key')) {
        openModal({
          title: t('common.error'),
          message: msg,
          type: 'error'
        });
      }
    } finally {
      setIsGeneratingRecap(false);
    }
  };

  // Download Burmese .SRT
  const handleDownloadBurmeseSrtFile = () => {
    if (!translatedBurmeseSrt) return;
    try {
      const baseName = assemblyMediaFile?.name
        ? assemblyMediaFile.name.replace(/\.[^/.]+$/, "")
        : 'subtitles';
      
      const effectiveContent = getEffectiveSrt(translatedBurmeseSrt);
      const blob = new Blob([effectiveContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${baseName}_Burmese${timingOffset !== 0 ? `_offset_${timingOffset}s` : ''}.srt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast(isMm ? 'မြန်မာ .SRT ဖိုင်ကို ဒေါင်းလုဒ်ဆွဲပြီးပါပြီ 🇲🇲📝' : 'Burmese .SRT file downloaded!', 'success');
    } catch {
      showToast(isMm ? 'ဒေါင်းလုဒ် မအောင်မြင်ပါ' : 'Download failed', 'error');
    }
  };

  // Download Original .SRT File (သူ့မူရင်းအတိုင်း)
  const handleDownloadOriginalSrtFile = () => {
    if (!assemblyResult?.srt) return;
    try {
      const baseName = assemblyMediaFile?.name
        ? assemblyMediaFile.name.replace(/\.[^/.]+$/, "")
        : 'subtitles';
      
      const effectiveContent = getEffectiveSrt(assemblyResult.srt);
      const blob = new Blob([effectiveContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${baseName}_Original${timingOffset !== 0 ? `_offset_${timingOffset}s` : ''}.srt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast(isMm ? 'မူရင်း .SRT ဖိုင်ကို ဒေါင်းလုဒ်ဆွဲပြီးပါပြီ 📝' : 'Original .SRT downloaded!', 'success');
    } catch {
      showToast(isMm ? 'ဒေါင်းလုဒ် မအောင်မြင်ပါ' : 'Download failed', 'error');
    }
  };

  // Download .TXT Transcript File
  const handleDownloadTxtFile = () => {
    const text = activeResultTab === 'recap' 
      ? recapScript
      : (activeSubtitleLang === 'burmese' && translatedNarrativeScript) 
        ? translatedNarrativeScript 
        : assemblyResult?.transcript?.text;
    if (!text) return;
    try {
      const baseName = assemblyMediaFile?.name
        ? assemblyMediaFile.name.replace(/\.[^/.]+$/, "")
        : 'transcript';

      let suffix = '_Original.txt';
      if (activeResultTab === 'recap') {
        suffix = '_Recap_Script.txt';
      } else if (activeSubtitleLang === 'burmese' && translatedNarrativeScript) {
        suffix = '_Burmese_Script.txt';
      }
      
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${baseName}${suffix}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast(isMm ? '.TXT စာသားဖိုင်ကို ဒေါင်းလုဒ်ဆွဲပြီးပါပြီ 📄' : '.TXT transcript downloaded!', 'success');
    } catch {
      showToast(isMm ? 'ဒေါင်းလုဒ် မအောင်မြင်ပါ' : 'Download failed', 'error');
    }
  };

  // Copy Active SRT Content to Clipboard
  const handleCopyActiveSrt = () => {
    const targetSrt = activeResultTab === 'recap'
      ? recapScript
      : activeSubtitleLang === 'burmese' && translatedBurmeseSrt 
        ? getEffectiveSrt(translatedBurmeseSrt)
        : getEffectiveSrt(assemblyResult?.srt);
    if (!targetSrt) return;
    navigator.clipboard.writeText(targetSrt);
    setIsCopied(true);
    showToast(isMm ? 'စာသားများကို ကူးယူပြီးပါပြီ 📋' : 'Content copied to clipboard!', 'success');
    setTimeout(() => setIsCopied(false), 2000);
  };

  // Copy individual cue text
  const handleCopyCue = (cueText: string, index: number) => {
    navigator.clipboard.writeText(cueText);
    setCopiedCueIndex(index);
    setTimeout(() => setCopiedCueIndex(null), 1500);
  };

  // Send Transcript to Voiceover Studio
  const handleSendToVoiceStudio = () => {
    const text = activeResultTab === 'recap'
      ? recapScript
      : (activeSubtitleLang === 'burmese' && translatedNarrativeScript)
        ? translatedNarrativeScript
        : assemblyResult?.transcript?.text;
    if (!text) return;
    const dur = assemblyResult?.transcript?.audio_duration;
    onTranscriptionComplete(text, dur);
    showToast(isMm ? 'စာသားများကို Voiceover Studio သို့ ပို့ဆောင်ပြီးပါပြီ 🎙️' : 'Sent script to Voice Studio!', 'success');
  };

  // Parse SRT cues for list view (Original vs Burmese) with applied timing offset
  const originalCues = useMemo<SrtCue[]>(() => {
    const srt = getEffectiveSrt(assemblyResult?.srt);
    return parseSrtToCues(srt);
  }, [assemblyResult?.srt, timingOffset]);

  const burmeseCues = useMemo<SrtCue[]>(() => {
    const srt = getEffectiveSrt(translatedBurmeseSrt);
    return parseSrtToCues(srt);
  }, [translatedBurmeseSrt, timingOffset]);

  // Active cues according to language selection
  const currentDisplayedCues = useMemo<SrtCue[]>(() => {
    if (activeSubtitleLang === 'burmese' && burmeseCues.length > 0) {
      return burmeseCues;
    }
    return originalCues;
  }, [activeSubtitleLang, burmeseCues, originalCues]);

  // Filter cues based on search query
  const filteredCues = useMemo(() => {
    if (!srtSearchQuery.trim()) return currentDisplayedCues;
    const q = srtSearchQuery.toLowerCase();
    return currentDisplayedCues.filter(c => 
      c.text.toLowerCase().includes(q) || 
      (c.speaker && c.speaker.toLowerCase().includes(q))
    );
  }, [currentDisplayedCues, srtSearchQuery]);

  // Active Cue for live video/audio player overlay
  const activeCue = useMemo<SrtCue | null>(() => {
    if (!currentDisplayedCues || currentDisplayedCues.length === 0) return null;
    return currentDisplayedCues.find(c => {
      const startSec = parseTimestampToSeconds(c.start);
      const endSec = parseTimestampToSeconds(c.end);
      return playbackTime >= startSec && playbackTime <= endSec;
    }) || null;
  }, [currentDisplayedCues, playbackTime]);

  return (
    <div className="space-y-6">
      {/* Unified Status Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-2.5 bg-black/60 border border-white/10 rounded-2xl backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2.5 px-4 sm:px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm text-amber-400 bg-amber-400/5 border border-amber-400/10">
            <Zap size={16} className="text-amber-400" />
            <span>{isMm ? 'အချိန်ကိုက် SRT စာတန်းထိုး စနစ်' : 'Time-Synced SRT Subtitle Studio'}</span>
            <span className="hidden sm:inline text-[9px] uppercase tracking-wider bg-amber-400/10 text-amber-400 px-2 py-0.5 rounded-md font-black">
              Time-Synced
            </span>
          </div>
        </div>

        {/* API Key Status & Settings Link */}
        <div className="flex items-center gap-2 justify-end">
          {assemblyApiKey.trim() ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-xl text-[11px] font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>{isMm ? 'စာတန်းထိုးစနစ် ချိတ်ဆက်ပြီး' : 'Subtitle Engine Ready'}</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={onNavigateToSettings}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-400/10 hover:bg-amber-400/20 text-amber-300 border border-amber-400/20 rounded-xl text-[11px] font-bold transition-colors"
              title="Add Key in Settings"
            >
              <Key size={12} className="text-amber-400" />
              <span>{isMm ? 'Settings တွင် Key ထည့်ပါ' : 'Key in Settings'}</span>
              <ArrowRight size={10} />
            </button>
          )}

          {onNavigateToSettings && (
            <button
              type="button"
              onClick={onNavigateToSettings}
              className="p-2 text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 transition-colors"
              title="Open Settings"
            >
              <Settings size={14} />
            </button>
          )}
        </div>
      </div>

      <motion.div
        key="assemblyai"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -15 }}
        className="space-y-6"
      >
        {/* Main Input & Transcription Card */}
        <div className="bg-[#0e121a] rounded-[28px] p-6 sm:p-8 border border-white/10 shadow-2xl relative overflow-hidden">
          {/* Ambient background glow */}
          <div className="absolute top-0 right-0 w-72 h-72 bg-amber-500/5 blur-[120px] pointer-events-none -mr-20 -mt-20" />

          {/* Header info */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 bg-amber-400/10 border border-amber-400/25 rounded-2xl flex items-center justify-center text-amber-400 shadow-lg shadow-amber-400/10 shrink-0">
                <Zap size={24} className="fill-amber-400/20" />
              </div>
              <div>
                <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
                  <span>{isMm ? 'အော်တို SRT စာတန်းထိုး ထုတ်ယူခြင်း' : 'Auto-SRT Subtitle Studio'}</span>
                </h2>
                <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
                  {isMm 
                    ? 'ဗီဒီယို (သို့) အသံဖိုင်မှ အချိန်ကိုက် SRT စာတန်းထိုး ထုတ်ယူပြီး မြန်မာလို Pro ကျကျ ပြန်ဆိုနိုင်ပါသည်' 
                    : 'Time-synced .SRT subtitles with 1-click Pro Burmese Translation'}
                </p>
              </div>
            </div>
          </div>

          {/* Media Upload Area */}
          <div className="mb-6">
            <div>
              {!assemblyMediaFile ? (
                <div
                  onDragEnter={handleAssemblyDrag}
                  onDragLeave={handleAssemblyDrag}
                  onDragOver={handleAssemblyDrag}
                  onDrop={handleAssemblyDrop}
                  onClick={() => assemblyFileInputRef.current?.click()}
                  className={`relative group cursor-pointer border-2 border-dashed rounded-2xl p-7 sm:p-9 flex flex-col items-center justify-center text-center transition-all duration-200 ${
                    assemblyDragActive
                      ? 'border-amber-400 bg-amber-400/10 scale-[0.99]'
                      : 'border-white/10 hover:border-amber-400/40 bg-white/[0.02] hover:bg-white/[0.04]'
                  }`}
                >
                  <input
                    ref={assemblyFileInputRef}
                    type="file"
                    accept="video/*,audio/*"
                    onChange={handleAssemblyFileChange}
                    className="hidden"
                  />
                  <div className="w-14 h-14 bg-amber-400/10 rounded-2xl flex items-center justify-center text-amber-400 mb-3 border border-amber-400/20 group-hover:scale-105 transition-transform">
                    <Upload size={26} />
                  </div>
                  <h3 className="text-sm sm:text-base font-bold text-white mb-1">
                    {isMm ? 'ဗီဒီယို (သို့) အသံဖိုင်အား ဤနေရာသို့ ဆွဲထည့်ပါ သို့မဟုတ် နှိပ်၍ရွေးပါ' : 'Drop audio/video file here, or click to browse'}
                  </h3>
                  <p className="text-xs text-slate-400 max-w-md">
                    {isMm 
                      ? 'MP4, MKV, MOV, WebM, MP3, WAV, M4A, FLAC, OGG, AAC ဖိုင်များ တင်သွင်းနိုင်ပါသည်' 
                      : 'Supports MP4, MKV, MOV, WebM, MP3, WAV, M4A, FLAC, OGG, AAC files'}
                  </p>
                </div>
              ) : (
                <div className="bg-black/50 border border-amber-400/25 rounded-2xl p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-12 h-12 bg-amber-400/10 rounded-xl flex items-center justify-center text-amber-400 shrink-0 border border-amber-400/20">
                      {assemblyMediaFile.type.startsWith('video/') ? <FileVideo size={22} /> : <FileAudio size={22} />}
                    </div>
                    <div className="overflow-hidden">
                      <h4 className="font-bold text-white text-sm truncate">{assemblyMediaFile.name}</h4>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {(assemblyMediaFile.size / (1024 * 1024)).toFixed(2)} MB • {assemblyMediaFile.type || 'Media File'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAssemblyMediaFile(null);
                      setAssemblyResult(null);
                      setTranslatedBurmeseSrt(null);
                      setTranslatedNarrativeScript(null);
                    }}
                    className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-colors shrink-0"
                    title="Remove file"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Options Row (Language, Diarization, Model) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 mb-6 p-4 bg-black/40 border border-white/5 rounded-2xl">
            <div>
              <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5 mb-1.5">
                <Globe size={13} className="text-amber-400" />
                <span>{isMm ? 'စကားပြော ဘာသာစကား' : 'Spoken Language'}</span>
              </label>
              <select
                value={assemblyLanguage}
                onChange={(e) => setAssemblyLanguage(e.target.value)}
                className="w-full bg-black/80 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400/50"
              >
                <option value="auto">{isMm ? '✨ အလိုအလျောက် ရှာဖွေမည် (Auto Detect)' : '✨ Auto Detect Language'}</option>
                <option value="en">English (အင်္ဂလိပ်)</option>
                <option value="th">Thai (ထိုင်း)</option>
                <option value="ja">Japanese (ဂျပန်)</option>
                <option value="ko">Korean (ကိုရီးယား)</option>
                <option value="zh">Chinese (တရုတ်)</option>
                <option value="es">Spanish (စပိန်)</option>
                <option value="fr">French (ပြင်သစ်)</option>
                <option value="de">German (ဂျာမန်)</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5 mb-1.5">
                <Mic2 size={13} className="text-amber-400" />
                <span>{isMm ? 'စကားပြောသူ ခွဲခြားမှု' : 'Speaker Diarization'}</span>
              </label>
              <button
                type="button"
                onClick={() => setAssemblySpeakerLabels(!assemblySpeakerLabels)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border text-xs font-bold transition-all ${
                  assemblySpeakerLabels
                    ? 'bg-amber-400/10 border-amber-400/30 text-amber-300'
                    : 'bg-black/60 border-white/10 text-slate-400'
                }`}
              >
                <span>{assemblySpeakerLabels ? (isMm ? 'Speaker A / B ခွဲမည်' : 'Speaker Labels ON') : (isMm ? 'မခွဲပါ' : 'Labels OFF')}</span>
                <div className={`w-8 h-4 rounded-full transition-colors relative ${assemblySpeakerLabels ? 'bg-amber-400' : 'bg-slate-700'}`}>
                  <div className={`w-3 h-3 rounded-full bg-black absolute top-0.5 transition-all ${assemblySpeakerLabels ? 'left-4.5' : 'left-0.5'}`} />
                </div>
              </button>
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5 mb-1.5">
                <Sliders size={13} className="text-amber-400" />
                <span>{isMm ? 'အရည်အသွေး ရွေးချယ်မှု' : 'Quality Preset'}</span>
              </label>
              <select
                value={assemblySpeechModel}
                onChange={(e) => setAssemblySpeechModel(e.target.value as 'best' | 'nano')}
                className="w-full bg-black/80 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400/50"
              >
                <option value="best">{isMm ? 'Pro Studio (တိကျမှု အမြင့်ဆုံး / အကောင်းဆုံး)' : 'Pro Studio (Best Quality & Accuracy)'}</option>
                <option value="nano">{isMm ? 'Express (အမြန်ဆုံး / ပေါ့ပါးမှု ဦးစားပေး)' : 'Express (Fast Speed)'}</option>
              </select>
            </div>
          </div>

          {/* Main Action CTA Button */}
          <button
            type="button"
            onClick={handleStartAssemblyAITranscription}
            disabled={isProcessingAssemblyAI || !assemblyMediaFile}
            className={`w-full py-4 sm:py-4.5 rounded-2xl font-bold text-sm sm:text-base flex items-center justify-center gap-2.5 transition-all shadow-xl disabled:opacity-50 disabled:cursor-not-allowed ${
              isProcessingAssemblyAI
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'bg-gradient-to-r from-amber-400 via-amber-300 to-amber-500 text-black hover:opacity-95 shadow-amber-400/20 active:scale-[0.99]'
            }`}
          >
            {isProcessingAssemblyAI ? (
              <>
                <RefreshCw size={19} className="animate-spin text-amber-400" />
                <span className="font-bold text-amber-300">
                  {assemblyProgress.step || (isMm ? 'စာတန်းထိုး ထုတ်လုပ်နေပါသည်...' : 'Generating Subtitles...')}
                </span>
              </>
            ) : (
              <>
                <Zap size={20} className="fill-black" />
                <span>
                  {isMm ? 'အချိန်ကိုက် SRT စာတန်းထိုး ထုတ်ယူမည်' : 'Generate Time-Synced SRT Subtitles'}
                </span>
              </>
            )}
          </button>

          {/* Live Progress Bar */}
          {isProcessingAssemblyAI && (
            <div className="mt-4 space-y-1.5">
              <div className="w-full bg-black/60 h-2 rounded-full overflow-hidden border border-white/10">
                <motion.div
                  className="bg-gradient-to-r from-amber-400 to-amber-500 h-full rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${assemblyProgress.percent}%` }}
                  transition={{ duration: 0.4 }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>{assemblyProgress.step}</span>
                <span className="font-mono font-bold text-amber-400">{assemblyProgress.percent}%</span>
              </div>
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* STEP 3: Subtitles Result & Burmese Pro Translation Section                */}
        {/* ========================================================================= */}
        {assemblyResult && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            {/* Pro Burmese Translation Panel Card */}
            <div className="bg-gradient-to-br from-emerald-950/30 via-[#0a1512] to-black rounded-[28px] p-6 sm:p-7 border border-emerald-500/30 shadow-2xl relative overflow-hidden">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
                <div className="space-y-1.5">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] font-bold uppercase tracking-wider">
                    <Languages size={13} />
                    <span>{isMm ? 'မြန်မာဘာသာသို့ ပြန်ဆိုခြင်း' : 'Pro Subtitle Translator'}</span>
                  </div>
                  <h3 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2">
                    <span>🇲🇲</span>
                    <span>Translate Subtitles to Burmese</span>
                    <span className="text-sm font-semibold text-emerald-300">({isMm ? 'မြန်မာလို ဘာသာပြန်မည်' : 'Burmese'})</span>
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-300 max-w-xl leading-relaxed">
                    {isMm 
                      ? 'မူရင်း SRT ၏ Timestamp များကို တစ်စက္ကန့်မလွဲ ထိန်းသိမ်းပြီး မြန်မာစကားပြောဟန်ဖြင့် အချိန်ကိုက် SRT အဖြစ် ဘာသာပြန်ပေးမည်' 
                      : 'Translate dialogues into accurate, expressive Burmese with 100% time-synchronized SRT timestamps'}
                  </p>
                </div>

                {/* Translation Style & "Translate to Burmese" Button */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                  <div className="flex-1 sm:w-72">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                      {isMm ? 'ဘာသာပြန်ဟန် စတိုင်' : 'Translation Tone & Style'}
                    </label>
                    <select
                      value={translationStyle}
                      onChange={(e) => setTranslationStyle(e.target.value)}
                      className="w-full bg-black/80 border border-emerald-500/30 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-400 font-medium"
                    >
                      <option value="သူ့မူရင်းအတိုင်း (Original Fidelity / Direct - မူရင်းစကားအတိုင်း တိကျစွာ)">
                        🎯 သူ့မူရင်းအတိုင်း (Original / Direct - တိကျစွာ)
                      </option>
                      <option value="Movie Recap (ရုပ်ရှင်ဇာတ်လမ်းပြန်ပြောဟန် - Pro ကျကျ)">
                        🎬 Movie Recap (ရုပ်ရှင်ဇာတ်လမ်းပြန်ပြောဟန်)
                      </option>
                      <option value="Natural Dialogue (သဘာဝကျ နေ့စဉ်စကားပြောဟန်)">
                        📖 Natural Dialogue (သဘာဝကျ စကားပြောဟန်)
                      </option>
                      <option value="Storyteller & Narrative (ရသစုံ ဇာတ်ကြောင်းပြောဟန်)">
                        🎙️ Storyteller (ရသစုံ ဇာတ်ကြောင်းပြောဟန်)
                      </option>
                      <option value="Dramatic & Thriller (သည်းထိတ်ရင်ဖို ရုပ်ရှင်ဟန်)">
                        🔥 Dramatic (သည်းထိတ်ရင်ဖို ရုပ်ရှင်ဟန်)
                      </option>
                    </select>
                  </div>

                  <div className="sm:self-end">
                    <button
                      type="button"
                      onClick={handleTranslateToBurmese}
                      disabled={isTranslatingSrt}
                      className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 via-emerald-400 to-teal-400 hover:opacity-95 text-black font-extrabold text-xs sm:text-sm shadow-xl shadow-emerald-500/20 transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
                    >
                      {isTranslatingSrt ? (
                        <>
                          <RefreshCw size={16} className="animate-spin text-black" />
                          <span>{isMm ? 'ဘာသာပြန်နေသည်...' : 'Translating...'}</span>
                        </>
                      ) : (
                        <>
                          <Sparkles size={16} className="fill-black" />
                          <span>Translate to Burmese</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Live Translation Progress Bar */}
              {isTranslatingSrt && (
                <div className="mt-4 space-y-1.5 pt-3 border-t border-emerald-500/20">
                  <div className="w-full bg-black/60 h-2 rounded-full overflow-hidden border border-white/10">
                    <motion.div
                      className="bg-gradient-to-r from-emerald-400 to-teal-400 h-full rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${translationProgress.percent}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-300">
                    <span className="animate-pulse">{translationProgress.step}</span>
                    <span className="font-mono font-bold text-emerald-400">{translationProgress.percent}%</span>
                  </div>
                </div>
              )}
            </div>

            {/* Results Display Area: Combined for both languages */}
            <div className="bg-[#0e121a] rounded-[28px] p-6 sm:p-8 border border-white/10 shadow-2xl space-y-5">
              {/* Header Bar: File stats, Language switchers, & Action buttons */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-white/10 pb-5">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-white text-xs font-bold truncate max-w-xs">
                      {assemblyMediaFile?.name || 'Media Subtitle'}
                    </span>
                    {translatedBurmeseSrt && (
                      <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-bold flex items-center gap-1.5">
                        <span>🇲🇲</span>
                        <span>Burmese Subtitles Ready</span>
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                    {assemblyResult.transcript.audio_duration && (
                      <span className="flex items-center gap-1 font-mono">
                        <Clock size={13} className="text-amber-400" />
                        <span>{Math.round(assemblyResult.transcript.audio_duration)}s</span>
                      </span>
                    )}
                    <span className="flex items-center gap-1 font-mono">
                      <FileText size={13} className="text-amber-400" />
                      <span>{originalCues.length} Cues</span>
                    </span>
                    {assemblyResult.transcript.confidence && (
                      <span className="flex items-center gap-1 font-mono">
                        <ShieldCheck size={13} className="text-emerald-400" />
                        <span>{(assemblyResult.transcript.confidence * 100).toFixed(1)}% Accuracy</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Primary Action Buttons Bar */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* Download Burmese .SRT (if available) */}
                  {translatedBurmeseSrt && (
                    <button
                      type="button"
                      onClick={handleDownloadBurmeseSrtFile}
                      className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs shadow-md shadow-emerald-500/20 transition-all active:scale-95"
                    >
                      <Download size={14} />
                      <span>{isMm ? '📥 မြန်မာ .SRT' : 'Burmese .SRT'}</span>
                    </button>
                  )}

                  {/* Download Original .SRT (သူ့မူရင်းအတိုင်း) */}
                  <button
                    type="button"
                    onClick={handleDownloadOriginalSrtFile}
                    className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-bold text-xs shadow-md shadow-amber-400/20 transition-all active:scale-95"
                  >
                    <Download size={14} />
                    <span>{isMm ? '🌐 မူရင်း .SRT' : 'Original .SRT'}</span>
                  </button>

                  {/* Copy Active SRT */}
                  <button
                    type="button"
                    onClick={handleCopyActiveSrt}
                    className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold text-xs border border-white/10 transition-all"
                  >
                    {isCopied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                    <span>{isCopied ? (isMm ? 'ကူးပြီးပါပြီ' : 'Copied') : (isMm ? 'SRT ကူးမည်' : 'Copy SRT')}</span>
                  </button>

                  {/* Send to Voiceover Studio */}
                  <button
                    type="button"
                    onClick={handleSendToVoiceStudio}
                    className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 font-bold text-xs border border-purple-500/30 transition-all"
                    title="Send script to Voice Studio"
                  >
                    <Mic2 size={14} />
                    <span>Voice Studio</span>
                  </button>

                  {/* Download Text Transcript / Recap */}
                  <button
                    type="button"
                    onClick={handleDownloadTxtFile}
                    className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-purple-500 hover:bg-purple-400 text-white font-bold text-xs shadow-md shadow-purple-500/20 transition-all active:scale-95"
                    title="Download text script (.txt)"
                  >
                    <FileText size={15} />
                    <span>{activeResultTab === 'recap' ? (isMm ? 'Recap ဇာတ်ညွှန်း' : 'Recap Script') : (isMm ? 'စာသားဖိုင်' : 'Text File')}</span>
                  </button>
                </div>
              </div>

              {/* Media Preview Player with Live Subtitle Overlay */}
              {mediaFileUrl && (
                <div className="bg-black/90 border border-white/10 rounded-2xl overflow-hidden relative shadow-2xl">
                  {assemblyMediaFile?.type.startsWith('video/') ? (
                    <div>
                      <div className="relative aspect-video max-h-[380px] w-full bg-black flex items-center justify-center overflow-hidden">
                        <video
                          ref={mediaRef as React.RefObject<HTMLVideoElement>}
                          src={mediaFileUrl}
                          className="w-full h-full object-contain"
                          controls
                          playsInline
                          onTimeUpdate={(e) => setPlaybackTime(e.currentTarget.currentTime)}
                          onLoadedMetadata={(e) => setMediaDuration(e.currentTarget.duration)}
                        />
                        {/* Floating Subtitle Overlay on Video */}
                        {activeCue && (
                          <div className="absolute bottom-14 sm:bottom-12 inset-x-2 sm:inset-x-4 flex justify-center pointer-events-none z-20">
                            <div className="bg-black/90 backdrop-blur-md text-white font-bold text-xs sm:text-base px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl border border-white/20 shadow-2xl text-center max-w-xl animate-fade-in break-words">
                              {activeCue.speaker && (
                                <span className="text-amber-400 text-[10px] sm:text-xs block mb-0.5 font-mono">
                                  [Speaker {activeCue.speaker}]
                                </span>
                              )}
                              <span className="leading-snug">{activeCue.text}</span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Active Subtitle Display beneath video for clear mobile reading */}
                      <div className="p-3 sm:p-4 bg-black/60 border-t border-white/10 flex items-center justify-between gap-3">
                        <div className="flex-1 overflow-hidden">
                          {activeCue ? (
                            <div className="text-left">
                              {activeCue.speaker && (
                                <span className="text-amber-400 text-[10px] font-bold inline-block mr-2 font-mono">
                                  [Speaker {activeCue.speaker}]
                                </span>
                              )}
                              <span className="text-xs sm:text-sm font-bold text-white leading-relaxed break-words">
                                {activeCue.text}
                              </span>
                            </div>
                          ) : (
                            <p className="text-xs text-slate-500 text-left italic truncate">
                              {isMm ? 'ဗီဒီယို ဖွင့်ထားချိန်တွင် အချိန်ကိုက် စာတန်းထိုးများကို ဤနေရာတွင် တိုက်ရိုက် ပြသပါမည်' : 'Subtitles will appear here in sync with video playback'}
                            </p>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-400 font-mono shrink-0">
                          {formatTime(playbackTime)} / {formatTime(mediaDuration || 0)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 sm:p-5 flex flex-col gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-amber-400/10 text-amber-400 rounded-xl flex items-center justify-center shrink-0 border border-amber-400/20">
                          <Volume2 size={20} />
                        </div>
                        <div className="flex-1 overflow-hidden">
                          <h4 className="text-xs sm:text-sm font-bold text-white truncate">{assemblyMediaFile?.name}</h4>
                          <span className="text-[11px] text-slate-400 font-mono">
                            {formatTime(playbackTime)} / {formatTime(mediaDuration || 0)}
                          </span>
                        </div>
                      </div>
                      <audio
                        ref={mediaRef as React.RefObject<HTMLAudioElement>}
                        src={mediaFileUrl}
                        className="w-full h-9 rounded-lg"
                        controls
                        onTimeUpdate={(e) => setPlaybackTime(e.currentTarget.currentTime)}
                        onLoadedMetadata={(e) => setMediaDuration(e.currentTarget.duration)}
                      />
                      {/* Active Subtitle Display for Audio */}
                      {activeCue ? (
                        <div className="p-3 bg-amber-400/10 border border-amber-400/20 rounded-xl text-center">
                          {activeCue.speaker && (
                            <span className="text-amber-400 text-[10px] font-bold block mb-0.5 font-mono">
                              [Speaker {activeCue.speaker}]
                            </span>
                          )}
                          <p className="text-sm font-bold text-white leading-relaxed">{activeCue.text}</p>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 text-center italic">
                          {isMm ? 'အချိန်ကိုက် စာတန်းထိုးများကို နားဆင်ရန် ဖွင့်ပါ' : 'Play audio to preview time-synced subtitles'}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Subtitle Timing Calibration & Fine-Tuner */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-black/60 border border-white/10 rounded-2xl">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-amber-400/10 rounded-lg text-amber-400">
                    <Sliders size={15} />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-white block">
                      {isMm ? 'စက္ကန့်အလိုက် အချိန်ကိုက် ညှိရန် (Timing Calibration)' : 'Timing Calibration'}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {isMm ? 'ဗီဒီယိုနှင့် စာတန်းထိုး နှေး/မြန် လွဲနေပါက +/- ဖြင့် တိကျစွာ ညှိပါ' : 'Fine-tune subtitle alignment with video'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => handleAdjustTimingOffset(-0.5)}
                    className="px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-mono text-slate-300 hover:text-white transition-colors"
                    title="Shift 0.5s earlier"
                  >
                    -0.5s
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAdjustTimingOffset(-0.2)}
                    className="px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-mono text-slate-300 hover:text-white transition-colors"
                    title="Shift 0.2s earlier"
                  >
                    -0.2s
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAdjustTimingOffset(-0.1)}
                    className="px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-mono text-slate-300 hover:text-white transition-colors"
                    title="Shift 0.1s earlier"
                  >
                    -0.1s
                  </button>

                  <div className={`px-3 py-1 rounded-lg border text-xs font-mono font-bold ${
                    timingOffset !== 0 
                      ? 'bg-amber-400/20 text-amber-300 border-amber-400/40' 
                      : 'bg-black/60 text-slate-400 border-white/10'
                  }`}>
                    {timingOffset > 0 ? `+${timingOffset.toFixed(1)}s` : `${timingOffset.toFixed(1)}s`}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleAdjustTimingOffset(0.1)}
                    className="px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-mono text-slate-300 hover:text-white transition-colors"
                    title="Shift 0.1s later"
                  >
                    +0.1s
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAdjustTimingOffset(0.2)}
                    className="px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-mono text-slate-300 hover:text-white transition-colors"
                    title="Shift 0.2s later"
                  >
                    +0.2s
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAdjustTimingOffset(0.5)}
                    className="px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-mono text-slate-300 hover:text-white transition-colors"
                    title="Shift 0.5s later"
                  >
                    +0.5s
                  </button>

                  {timingOffset !== 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setTimingOffset(0);
                        showToast(isMm ? 'အချိန်ကိုက် မူလအတိုင်း ပြန်သတ်မှတ်ပါသည်' : 'Reset timing offset', 'success');
                      }}
                      className="p-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 rounded-lg text-xs transition-colors"
                      title="Reset Offset"
                    >
                      <RotateCcw size={13} />
                    </button>
                  )}
                </div>
              </div>

              {/* Subtitle Language Switcher & View Tabs */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Burmese vs Original Language Toggle */}
                  <div className="flex items-center p-1 bg-black/60 rounded-xl border border-white/10">
                    {translatedBurmeseSrt && (
                      <button
                        type="button"
                        onClick={() => setActiveSubtitleLang('burmese')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          activeSubtitleLang === 'burmese'
                            ? 'bg-emerald-500 text-black shadow-md'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <span>🇲🇲</span>
                        <span>{isMm ? 'မြန်မာ စာတန်းထိုး' : 'Burmese Subtitles'}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setActiveSubtitleLang('original')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        activeSubtitleLang === 'original'
                          ? 'bg-amber-400 text-black shadow-md'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <span>🌐</span>
                      <span>{isMm ? 'သူ့မူရင်းအတိုင်း (Original)' : 'Original (မူရင်းအတိုင်း)'}</span>
                    </button>
                  </div>

                  {/* Result View Tabs */}
                  <div className="flex items-center p-1 bg-black/60 rounded-xl border border-white/10">
                    <button
                      type="button"
                      onClick={() => setActiveResultTab('cues')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        activeResultTab === 'cues'
                          ? 'bg-white/15 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {isMm ? 'အပိုင်းလိုက်' : 'Cues'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveResultTab('text')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        activeResultTab === 'text'
                          ? 'bg-white/15 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {isMm ? 'စာသားပြား' : 'Plain Text'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveResultTab('raw')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        activeResultTab === 'raw'
                          ? 'bg-white/15 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      SRT Code
                    </button>
                    {recapScript && (
                      <button
                        type="button"
                        onClick={() => setActiveResultTab('recap')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                          activeResultTab === 'recap'
                            ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/20'
                            : 'text-purple-400 hover:text-purple-300'
                        }`}
                      >
                        <Sparkles size={13} className={activeResultTab === 'recap' ? "fill-white" : ""} />
                        <span>Recap Script</span>
                      </button>
                    )}
                    {isGeneratingRecap && (
                      <div className="px-3 py-1.5 text-xs text-purple-400 flex items-center gap-1.5 animate-pulse">
                        <RefreshCw size={13} className="animate-spin" />
                        <span>Generating...</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Search Input for Cues */}
                {activeResultTab === 'cues' && (
                  <div className="relative w-full sm:w-60">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      value={srtSearchQuery}
                      onChange={(e) => setSrtSearchQuery(e.target.value)}
                      placeholder={isMm ? 'စာတန်းထိုး ရှာရန်...' : 'Search cues...'}
                      className="w-full bg-black/60 border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400/50"
                    />
                  </div>
                )}
              </div>

              {/* Tab Content Display */}
              <div className="mt-6">
                {activeResultTab === 'recap' && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-black/40 border border-purple-500/20 rounded-2xl p-5 sm:p-7 min-h-[300px] relative overflow-hidden"
                  >
                    {/* Background glow */}
                    <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/5 blur-[100px] pointer-events-none" />
                    
                    <div className="flex items-center justify-between mb-4 pb-3 border-b border-purple-500/10 relative z-10">
                      <h4 className="text-purple-300 font-black text-sm uppercase tracking-wider flex items-center gap-2">
                        <Sparkles size={16} className="text-purple-400" />
                        <span>{isMm ? 'ရုပ်ရှင်ဇာတ်လမ်းပြန်ပြော ဇာတ်ညွှန်း' : 'Movie Recap Script'}</span>
                      </h4>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleCopyActiveSrt}
                          className="p-2 text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors border border-white/5"
                          title="Copy Script"
                        >
                          {isCopied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                        </button>
                        <button
                          onClick={handleDownloadTxtFile}
                          className="p-2 text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors border border-white/5"
                          title="Download Script"
                        >
                          <Download size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="text-slate-200 text-sm sm:text-base leading-relaxed whitespace-pre-wrap font-medium relative z-10 selection:bg-purple-500/30">
                      {recapScript}
                    </div>
                  </motion.div>
                )}

                {activeResultTab === 'cues' && (
                  <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1.5 custom-scrollbar">
                    {filteredCues.length === 0 ? (
                      <div className="text-center py-12 text-slate-500 text-sm">
                        {isMm ? 'ရှာဖွေမှုရလဒ် မတွေ့ပါ' : 'No subtitles found'}
                      </div>
                    ) : (
                      filteredCues.map((cue) => {
                        // Matching original cue for comparison when viewing Burmese
                        const matchingOriginalCue = activeSubtitleLang === 'burmese' 
                          ? originalCues.find(c => c.index === cue.index) 
                          : null;
                        const isCueActive = activeCue?.index === cue.index;

                        return (
                          <div
                            key={cue.index}
                            className={`p-3.5 sm:p-4 rounded-xl border transition-all ${
                              isCueActive
                                ? activeSubtitleLang === 'burmese'
                                  ? 'bg-emerald-950/40 border-emerald-400 ring-2 ring-emerald-400/50 shadow-lg shadow-emerald-500/10'
                                  : 'bg-amber-950/40 border-amber-400 ring-2 ring-amber-400/50 shadow-lg shadow-amber-500/10'
                                : activeSubtitleLang === 'burmese'
                                  ? 'bg-black/60 border-emerald-500/15 hover:border-emerald-500/30'
                                  : 'bg-black/60 border-white/5 hover:border-amber-400/25'
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                              <div className="flex items-center gap-1.5 sm:gap-2">
                                <span className={`text-[10px] sm:text-[11px] font-mono px-2 py-0.5 rounded font-bold ${
                                  isCueActive
                                    ? activeSubtitleLang === 'burmese' ? 'bg-emerald-400 text-black' : 'bg-amber-400 text-black'
                                    : activeSubtitleLang === 'burmese'
                                      ? 'bg-emerald-500/10 text-emerald-400'
                                      : 'bg-amber-400/10 text-amber-400'
                                }`}>
                                  #{cue.index}
                                </span>
                                {cue.speaker && (
                                  <span className="text-[9px] sm:text-[10px] font-bold uppercase bg-purple-500/20 text-purple-300 px-1.5 sm:px-2 py-0.5 rounded">
                                    Spk {cue.speaker}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-1.5 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => handleSeekToCue(cue.start)}
                                  className={`flex items-center gap-1 sm:gap-1.5 px-2 py-0.5 rounded-lg text-[10px] sm:text-[11px] font-mono transition-colors ${
                                    isCueActive
                                      ? 'bg-amber-400 text-black font-bold'
                                      : 'text-slate-300 hover:text-white bg-white/5 hover:bg-white/10'
                                  }`}
                                  title={isMm ? 'ဤစက္ကန့်သို့ ဗီဒီယို ရွှေ့ဖွင့်မည်' : 'Seek video to this timestamp'}
                                >
                                  <Play size={10} className="fill-current shrink-0" />
                                  <span>{cue.start}</span>
                                  <span>➔</span>
                                  <span>{cue.end}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleCopyCue(cue.text, cue.index)}
                                  className="p-1 text-slate-500 hover:text-slate-300 rounded transition-colors"
                                  title="Copy text"
                                >
                                  {copiedCueIndex === cue.index ? (
                                    <Check size={12} className="text-emerald-400" />
                                  ) : (
                                    <Copy size={12} />
                                  )}
                                </button>
                              </div>
                            </div>

                            <p className="text-xs sm:text-sm text-slate-100 leading-relaxed font-medium break-words">
                              {cue.text}
                            </p>

                            {/* Bilingual Comparison view */}
                            {matchingOriginalCue && (
                              <p className="text-[11px] sm:text-xs text-slate-400 mt-2 pt-1.5 border-t border-white/5 italic break-words">
                                <span className="text-slate-500 font-semibold not-italic">မူရင်း: </span>
                                {matchingOriginalCue.text}
                              </p>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

              {/* View 2: Narrative Script (Continuous story text) */}
              {activeResultTab === 'text' && (
                <div className="relative">
                  <div className="w-full max-h-[500px] overflow-y-auto p-4 sm:p-5 bg-black/80 border border-white/10 rounded-2xl text-sm text-slate-200 whitespace-pre-wrap leading-relaxed custom-scrollbar font-sans">
                    {(activeSubtitleLang === 'burmese' && translatedNarrativeScript) 
                      ? translatedNarrativeScript 
                      : (assemblyResult.transcript.text || (isMm ? 'စာသား မရှိပါ' : 'No transcript text'))}
                  </div>
                  <div className="absolute top-3 right-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSendToVoiceStudio}
                      className="px-3 py-1.5 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5"
                    >
                      <Mic2 size={13} />
                      <span>Voice Studio</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const t = (activeSubtitleLang === 'burmese' && translatedNarrativeScript) 
                          ? translatedNarrativeScript 
                          : assemblyResult.transcript.text;
                        if (t) {
                          navigator.clipboard.writeText(t);
                          showToast(isMm ? 'စာသား ကူးယူပြီးပါပြီ 📋' : 'Transcript copied!', 'success');
                        }
                      }}
                      className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-bold transition-colors"
                      title="Copy Transcript"
                    >
                      <Copy size={13} />
                    </button>
                  </div>
                </div>
              )}

              {/* View 3: Raw SRT */}
              {activeResultTab === 'raw' && (
                <div className="relative">
                  <pre className="w-full max-h-[500px] overflow-y-auto p-4 bg-black/80 border border-white/10 rounded-2xl font-mono text-xs text-amber-300/90 whitespace-pre-wrap leading-relaxed custom-scrollbar">
                    {activeSubtitleLang === 'burmese' && translatedBurmeseSrt
                      ? translatedBurmeseSrt
                      : assemblyResult.srt}
                  </pre>
                  <button
                    type="button"
                    onClick={handleCopyActiveSrt}
                    className="absolute top-3 right-3 p-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-bold transition-colors"
                    title="Copy Raw SRT"
                  >
                    <Copy size={14} />
                  </button>
                </div>
              )}
              </div>
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
};
