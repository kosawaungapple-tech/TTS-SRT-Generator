import React, { useMemo, useEffect, useState } from 'react';
import { 
  Server, 
  Cpu, 
  Sliders, 
  Volume2, 
  Wand2, 
  FileText, 
  Plus, 
  Minus, 
  UserCheck, 
  Music, 
  ChevronDown, 
  Check, 
  Layers, 
  History, 
  BookOpen, 
  Sparkles, 
  LayoutGrid
} from 'lucide-react';
import { TTSConfig } from '../types';
import { VOICE_OPTIONS } from '../constants';
import { useLanguage } from '../contexts/LanguageContext';
import { CustomVoiceProfile } from './CustomVoiceProfile';
import { getCustomPronunciation, setCustomPronunciation, parsePronunciation, BUILTIN_PRONUNCIATION } from '../utils/pronunciation';

interface VoiceConfigProps {
  config: TTSConfig;
  setConfig: (config: TTSConfig) => void;
  baseDuration?: number; // Optional actual base duration from last result
  isAdmin?: boolean;
  saveToHistory?: boolean;
  setSaveToHistory?: (val: boolean) => void;
  onOpenBatchQueue?: () => void;
  customRules?: string;
  setCustomRules?: (val: string) => void;
}

type ActivePanel = 'grid' | 'engine' | 'voice' | 'rules';

export const VoiceConfig: React.FC<VoiceConfigProps> = ({ 
  config, 
  setConfig, 
  baseDuration,
  saveToHistory,
  setSaveToHistory,
  onOpenBatchQueue,
  customRules,
  setCustomRules
}) => {
  const { language, t } = useLanguage();
  const isMm = language === 'mm';
  const [activePanel, setActivePanel] = useState<ActivePanel>('grid');
  const [showVoiceCloning, setShowVoiceCloning] = useState(false);
  const [localPronunciation, setLocalPronunciation] = useState(() => customRules ?? getCustomPronunciation());
  
  // Keep local pronunciation synced with storage / parent
  useEffect(() => {
    if (customRules !== undefined && customRules !== localPronunciation) {
      setLocalPronunciation(customRules);
    }
  }, [customRules]);

  const handlePronunciationChange = (val: string) => {
    setLocalPronunciation(val);
    setCustomPronunciation(val);
    if (setCustomRules) {
      setCustomRules(val);
    }
  };

  const parsedCustomRules = useMemo(() => {
    return parsePronunciation(localPronunciation);
  }, [localPronunciation]);

  const estimatedDisplay = useMemo(() => {
    if (!baseDuration) return null;
    const estimatedSeconds = baseDuration / (config.speed || 1);
    const m = Math.floor(estimatedSeconds / 60);
    const s = Math.floor(estimatedSeconds % 60);
    const timeStr = m > 0 ? `${m}m ${s}s` : `${s}s`;
    return `~${timeStr} @ ${config.speed}x`;
  }, [baseDuration, config.speed]);

  const QUICK_STYLES = useMemo(() => [
    { label: t('voiceConfig.styles.warm') || 'Warm', value: 'Warm', emoji: '☀️' },
    { label: t('voiceConfig.styles.storytelling') || 'Storytelling', value: 'Storytelling', emoji: '📖' },
    { label: t('voiceConfig.styles.professional') || 'Professional', value: 'Professional', emoji: '💼' },
    { label: t('voiceConfig.styles.suspense') || 'Suspense', value: 'Suspense', emoji: '⏳' },
    { label: t('voiceConfig.styles.horror') || 'Horror', value: 'Horror', emoji: '👻' },
    { label: t('voiceConfig.styles.excited') || 'Excited', value: 'Excited', emoji: '⚡' },
    { label: t('voiceConfig.styles.calm') || 'Calm', value: 'Calm', emoji: '🍃' },
    { label: t('voiceConfig.styles.whisper') || 'Whisper', value: 'Whisper', emoji: '🤫' },
    { label: t('voiceConfig.styles.energetic') || 'Energetic', value: 'Energetic', emoji: '🔥' },
    { label: t('voiceConfig.styles.serious') || 'Serious', value: 'Serious', emoji: '🎯' },
    { label: t('voiceConfig.styles.happy') || 'Happy', value: 'Happy', emoji: '😊' },
    { label: t('voiceConfig.styles.sad') || 'Sad', value: 'Sad', emoji: '🌧️' },
    { label: t('voiceConfig.styles.angry') || 'Angry', value: 'Angry', emoji: '💢' },
    { label: t('voiceConfig.styles.panic') || 'Panic', value: 'Panic', emoji: '😱' },
  ], [t]);

  const toggleStyle = (style: string) => {
    const currentStyles = (config.styleInstruction || '').split(',').map(s => s.trim()).filter(Boolean);
    const hasStyle = currentStyles.includes(style);
    
    let newStyles;
    if (hasStyle) {
      newStyles = currentStyles.filter(s => s !== style);
    } else {
      newStyles = [...currentStyles, style];
    }
    
    handleChange('styleInstruction', newStyles.join(', '));
  };

  const isStyleActive = (style: string) => {
    const currentStyles = (config.styleInstruction || '').split(',').map(s => s.trim()).filter(Boolean);
    return currentStyles.includes(style);
  };

  const activeStyleCount = useMemo(() => {
    return (config.styleInstruction || '').split(',').map(s => s.trim()).filter(Boolean).length;
  }, [config.styleInstruction]);

  const handleChange = (key: keyof TTSConfig, value: string | number | undefined) => {
    if (key === 'voiceProfile') {
      if (value) {
        localStorage.setItem('vbs_custom_voice_profile', value as string);
      } else {
        localStorage.removeItem('vbs_custom_voice_profile');
      }
    }
    setConfig({ ...config, [key]: value });
  };

  const filteredVoices = useMemo(() => VOICE_OPTIONS, []);

  // Ensure valid voice is selected
  useEffect(() => {
    if (filteredVoices.length > 0 && !filteredVoices.some(v => v.id === config.voiceId)) {
      handleChange('voiceId', filteredVoices[0].id);
    }
  }, [filteredVoices, config.voiceId]);

  const currentVoiceObj = useMemo(() => {
    return VOICE_OPTIONS.find(v => v.id === config.voiceId) || VOICE_OPTIONS[0];
  }, [config.voiceId]);

  return (
    <div className="space-y-4">
      {/* Grouped Panel Selector Navigation */}
      <div className="p-1 rounded-2xl bg-black/50 border border-white/10 backdrop-blur-xl grid grid-cols-4 gap-1 shadow-lg">
        <button
          type="button"
          onClick={() => setActivePanel('grid')}
          className={`py-2 px-2.5 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all ${
            activePanel === 'grid'
              ? 'bg-amber-400 text-black shadow-md font-black'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
          title={isMm ? 'အားလုံးကို တစ်ပြိုင်နက် ကြည့်ရှုမည်' : 'View All Grouped Panels'}
        >
          <LayoutGrid size={13} />
          <span className="truncate">{isMm ? 'စုံလင်စွာ' : 'Overview'}</span>
        </button>

        <button
          type="button"
          onClick={() => setActivePanel('engine')}
          className={`py-2 px-2.5 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all ${
            activePanel === 'engine'
              ? 'bg-amber-400 text-black shadow-md font-black'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
          title={isMm ? 'ဆာဗာနှင့် စနစ် ဆက်တင်များ' : 'Engine Settings'}
        >
          <Cpu size={13} />
          <span className="truncate">{isMm ? 'Engine' : 'Engine'}</span>
        </button>

        <button
          type="button"
          onClick={() => setActivePanel('voice')}
          className={`py-2 px-2.5 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all ${
            activePanel === 'voice'
              ? 'bg-amber-400 text-black shadow-md font-black'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
          title={isMm ? 'အသံရှင်နှင့် အသံညှိချက်များ' : 'Voice Parameters'}
        >
          <Sliders size={13} />
          <span className="truncate">{isMm ? 'Voice' : 'Voice'}</span>
        </button>

        <button
          type="button"
          onClick={() => setActivePanel('rules')}
          className={`py-2 px-2.5 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all ${
            activePanel === 'rules'
              ? 'bg-amber-400 text-black shadow-md font-black'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
          title={isMm ? 'ဇာတ်ကြောင်းပြော ပုံစံနှင့် စည်းမျဉ်းများ' : 'Narration Rules'}
        >
          <BookOpen size={13} />
          <span className="truncate">{isMm ? 'Rules' : 'Rules'}</span>
          {(activeStyleCount > 0 || parsedCustomRules.length > 0) && (
            <span className={`w-1.5 h-1.5 rounded-full ${activePanel === 'rules' ? 'bg-black' : 'bg-amber-400'}`} />
          )}
        </button>
      </div>

      {/* ========================================================================= */}
      {/* 1. ENGINE SETTINGS PANEL                                                  */}
      {/* ========================================================================= */}
      {(activePanel === 'grid' || activePanel === 'engine') && (
        <section className="rounded-3xl border border-white/10 bg-gradient-to-b from-slate-900/90 to-black/90 p-5 sm:p-6 shadow-2xl relative overflow-hidden backdrop-blur-xl group transition-all duration-300">
          <div className="absolute top-0 right-0 w-48 h-48 bg-amber-400/5 blur-[80px] -z-10 pointer-events-none" />

          {/* Panel Header */}
          <div className="flex items-center justify-between pb-4 mb-5 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-400/15 border border-amber-400/30 text-amber-400 grid place-items-center shadow-lg shadow-amber-500/10">
                <Cpu size={19} />
              </div>
              <div>
                <h3 className="text-sm font-black text-white tracking-tight flex items-center gap-2">
                  <span>Engine Settings</span>
                  <span className="text-[11px] font-medium text-slate-400 hidden sm:inline">· ဆာဗာနှင့် စနစ် ဆက်တင်များ</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {isMm ? 'AI Model ဆာဗာ၊ Export Format နှင့် Output စနစ်များ' : 'AI Model, audio encoding & system pipeline'}
                </p>
              </div>
            </div>
            <span className="text-[10px] font-mono font-bold text-amber-300 px-2.5 py-1 rounded-xl bg-amber-400/10 border border-amber-400/25">
              {(config.selectedModel || 'gemini-3.8-flash-lite-tts').replace('gemini-', '')}
            </span>
          </div>

          <div className="space-y-5">
            {/* AI Model Server Selection */}
            <div>
              <label className="flex items-center justify-between text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2.5">
                <span className="flex items-center gap-1.5 text-slate-300">
                  <Server size={13} className="text-amber-400" />
                  {isMm ? 'AI Model / ဆာဗာရွေးချယ်ရန်' : 'AI Generation Model'}
                </span>
                <span className="text-[10px] text-emerald-400 lowercase font-medium">high speed</span>
              </label>
              <div className="relative">
                <select
                  value={config.selectedModel || 'gemini-3.8-flash-lite-tts'}
                  onChange={(e) => handleChange('selectedModel', e.target.value)}
                  style={{ colorScheme: 'dark' }}
                  className="w-full bg-black/60 border border-white/15 rounded-2xl px-4 py-3.5 text-[13px] text-white appearance-none focus:outline-none focus:border-amber-400/70 transition-all cursor-pointer font-medium pr-10"
                >
                  <option value="gemini-3.8-flash-lite-tts" className="bg-slate-950 text-white">
                    ⚡ Gemini 3.8 Flash Lite TTS (Recommended / Fresh Quota / မြန်ဆန်)
                  </option>
                  <option value="gemini-3.8-flash-tts" className="bg-slate-950 text-white">
                    🎬 Gemini 3.8 Flash TTS (Cinematic Studio Persona / အရည်အသွေးမြင့်)
                  </option>
                  <option value="gemini-3.1-flash-lite" className="bg-slate-950 text-white">
                    🚀 Gemini 3.1 Flash Lite (High Quota Two-Step / အကန့်အသတ်မရှိသလောက်)
                  </option>
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                  <ChevronDown size={18} />
                </div>
              </div>
            </div>

            {/* Audio Export Format Selector (WAV vs MP3) */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                  <Music size={13} className="text-amber-400" />
                  {t('voiceConfig.exportFormat')}
                </label>
                <span className="text-[10px] font-mono font-bold text-slate-400">
                  {(config.exportFormat || 'wav').toUpperCase()}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => handleChange('exportFormat', 'wav')}
                  className={`p-3.5 rounded-2xl border text-left transition-all relative overflow-hidden ${
                    (config.exportFormat || 'wav') === 'wav'
                      ? 'bg-amber-400 text-black border-amber-400 shadow-lg shadow-amber-400/20'
                      : 'bg-black/50 text-slate-400 border-white/10 hover:border-amber-400/30 hover:text-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[13px] font-black uppercase tracking-wider flex items-center gap-1.5">
                      WAV
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-black ${
                        (config.exportFormat || 'wav') === 'wav'
                          ? 'bg-black/20 text-black'
                          : 'bg-white/10 text-amber-400'
                      }`}>
                        Lossless
                      </span>
                    </span>
                    <span className={`w-2 h-2 rounded-full ${
                      (config.exportFormat || 'wav') === 'wav' ? 'bg-black' : 'bg-slate-700'
                    }`} />
                  </div>
                  <p className={`text-[10.5px] leading-tight font-medium ${
                    (config.exportFormat || 'wav') === 'wav' ? 'text-black/80' : 'text-slate-500'
                  }`}>
                    PCM 24kHz • Broadcast Grade
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => handleChange('exportFormat', 'mp3')}
                  className={`p-3.5 rounded-2xl border text-left transition-all relative overflow-hidden ${
                    config.exportFormat === 'mp3'
                      ? 'bg-amber-400 text-black border-amber-400 shadow-lg shadow-amber-400/20'
                      : 'bg-black/50 text-slate-400 border-white/10 hover:border-amber-400/30 hover:text-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[13px] font-black uppercase tracking-wider flex items-center gap-1.5">
                      MP3
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-black ${
                        config.exportFormat === 'mp3'
                          ? 'bg-black/20 text-black'
                          : 'bg-white/10 text-amber-400'
                      }`}>
                        Compact
                      </span>
                    </span>
                    <span className={`w-2 h-2 rounded-full ${
                      config.exportFormat === 'mp3' ? 'bg-black' : 'bg-slate-700'
                    }`} />
                  </div>
                  <p className={`text-[10.5px] leading-tight font-medium ${
                    config.exportFormat === 'mp3' ? 'text-black/80' : 'text-slate-500'
                  }`}>
                    192 kbps • Fast Web Delivery
                  </p>
                </button>
              </div>
            </div>

            {/* Custom File Name */}
            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-2">
                <FileText size={13} className="text-amber-400" />
                {isMm ? 'ဖိုင်အမည် သတ်မှတ်ရန် (Optional)' : 'Custom File Name Prefix'}
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={config.customFileName || ''}
                  onChange={(e) => handleChange('customFileName', e.target.value)}
                  placeholder={isMm ? 'ဥပမာ - my_narration_audio' : 'e.g., episode_01_voiceover'}
                  className="w-full bg-black/60 border border-white/15 rounded-2xl px-4 py-3 text-[13px] text-white focus:outline-none focus:border-amber-400/70 transition-all font-medium placeholder:text-slate-600"
                />
              </div>
            </div>

            {/* System Controls: Save to History & Batch Queue */}
            <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Save To History Toggle Card */}
              {setSaveToHistory && (
                <div className="flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition-all">
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    <div className="p-2 bg-amber-400/10 text-amber-400 rounded-xl shrink-0">
                      <History size={16} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[12px] font-bold text-white truncate">{t('generate.saveToHistory')}</p>
                      <p className="text-[10px] text-slate-400 truncate">{isMm ? 'မှတ်တမ်းသိမ်းမည်' : 'Save generated'}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSaveToHistory(!saveToHistory)}
                    className={`w-11 h-6 rounded-full transition-all relative shrink-0 ${
                      saveToHistory ? 'bg-amber-400' : 'bg-white/15'
                    }`}
                  >
                    <div className={`absolute top-1 w-4 h-4 rounded-full transition-all ${
                      saveToHistory ? 'left-6 bg-black' : 'left-1 bg-white/70'
                    }`} />
                  </button>
                </div>
              )}

              {/* Batch Queue Launcher Card */}
              {onOpenBatchQueue && (
                <button
                  type="button"
                  onClick={onOpenBatchQueue}
                  className="flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-amber-400/40 hover:bg-white/[0.06] transition-all text-left group"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="p-2 bg-purple-400/10 text-purple-400 rounded-xl shrink-0 group-hover:scale-105 transition-transform">
                      <Layers size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] font-bold text-white truncate">{t('history.batchQueue')}</span>
                      </div>
                      <p className="text-[10px] text-slate-400 truncate">{isMm ? 'စာပိုဒ်အများအပြားသွင်းရန်' : 'Multi-Input'}</p>
                    </div>
                  </div>
                  <span className="text-[11px] font-bold text-amber-400 group-hover:translate-x-0.5 transition-transform shrink-0">
                    Open →
                  </span>
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ========================================================================= */}
      {/* 2. VOICE PARAMETERS PANEL                                                 */}
      {/* ========================================================================= */}
      {(activePanel === 'grid' || activePanel === 'voice') && (
        <section className="rounded-3xl border border-white/10 bg-gradient-to-b from-slate-900/90 to-black/90 p-5 sm:p-6 shadow-2xl relative overflow-hidden backdrop-blur-xl group transition-all duration-300">
          <div className="absolute top-0 right-0 w-48 h-48 bg-violet-400/5 blur-[80px] -z-10 pointer-events-none" />

          {/* Panel Header */}
          <div className="flex items-center justify-between pb-4 mb-5 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-violet-400/15 border border-violet-400/30 text-violet-400 grid place-items-center shadow-lg shadow-violet-500/10">
                <Sliders size={19} />
              </div>
              <div>
                <h3 className="text-sm font-black text-white tracking-tight flex items-center gap-2">
                  <span>Voice Parameters</span>
                  <span className="text-[11px] font-medium text-slate-400 hidden sm:inline">· အသံရှင်နှင့် အသံညှိချက်များ</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {isMm ? 'Persona အသံရှင်၊ အမြန်နှုန်း၊ Pitch နှင့် Gain ချိန်ညှိမှု' : 'Character voice, speed rate, pitch & volume gain'}
                </p>
              </div>
            </div>
            {estimatedDisplay && (
              <span className="text-[10px] font-mono font-bold text-violet-300 px-2.5 py-1 rounded-xl bg-violet-400/10 border border-violet-400/25">
                {estimatedDisplay}
              </span>
            )}
          </div>

          <div className="space-y-6">
            {/* Voice Character Selection */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                  <Volume2 size={13} className="text-violet-400" />
                  {t('voiceConfig.voice')}
                </label>
                <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                  <span>{currentVoiceObj.gender === 'female' ? '👩' : '👨'}</span>
                  <span>{currentVoiceObj.name}</span>
                </span>
              </div>
              <div className="relative">
                <select
                  value={config.voiceId}
                  onChange={(e) => handleChange('voiceId', e.target.value)}
                  style={{ colorScheme: 'dark' }}
                  className="w-full bg-black/60 border border-white/15 rounded-2xl px-4 py-3.5 text-[13px] text-white appearance-none focus:outline-none focus:border-violet-400/70 transition-all cursor-pointer font-medium pr-10"
                >
                  {filteredVoices.map((voice) => (
                    <option key={voice.id} value={voice.id} className="bg-slate-950 text-white">
                      {voice.gender === 'female' ? '👩' : '👨'} {voice.name} {voice.voiceName ? `(${voice.voiceName})` : ''}
                    </option>
                  ))}
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                  <ChevronDown size={18} />
                </div>
              </div>
            </div>

            {/* Precision Acoustic Sliders Grid */}
            <div className="p-4 rounded-2xl bg-black/40 border border-white/10 space-y-5">
              {/* Speed Slider */}
              <Slider
                label={t('voiceConfig.speed')}
                value={config.speed}
                min={0.5}
                max={2.0}
                step={0.05}
                suffix="x"
                onChange={(v) => handleChange('speed', v)}
                accentColor="#A78BFA"
              />

              {/* Pitch Slider */}
              <Slider
                label={t('voiceConfig.pitch')}
                value={config.pitch}
                min={-10.0}
                max={10.0}
                step={1}
                suffix=""
                onChange={(v) => handleChange('pitch', v)}
                accentColor="#A78BFA"
              />

              {/* Loudness Gain Boost */}
              <div>
                <Slider
                  label={t('voiceConfig.volume')}
                  value={config.volume ?? 0}
                  min={0}
                  max={10}
                  step={1}
                  suffix=" dB"
                  onChange={(v) => handleChange('volume', v)}
                  accentColor="#A78BFA"
                />
                <div className="flex justify-between items-center px-1 text-[10px] text-slate-500 font-mono mt-1">
                  <span>0 dB (Standard Gain)</span>
                  <span>+10 dB (Max Loudness Boost)</span>
                </div>
              </div>
            </div>

            {/* Custom Voice Cloning Section */}
            <div className="rounded-2xl border border-white/10 bg-black/30 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowVoiceCloning(!showVoiceCloning)}
                className="w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-white/[0.04] transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <UserCheck size={16} className="text-violet-400" />
                  <span className="text-[12.5px] font-bold text-white">
                    {isMm ? 'Custom Voice Cloning (အသံတုပြုလုပ်ရန်)' : 'Custom Voice Profile Cloning'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    config.voiceProfile ? 'bg-emerald-400/20 text-emerald-300' : 'text-slate-500'
                  }`}>
                    {config.voiceProfile ? (isMm ? 'အသံတုထည့်ပြီး' : 'Active Profile') : (isMm ? 'မရှိသေးပါ' : 'Optional')}
                  </span>
                  <ChevronDown size={14} className={`text-slate-400 transition-transform ${showVoiceCloning ? 'rotate-180' : ''}`} />
                </div>
              </button>
              {showVoiceCloning && (
                <div className="p-4 pt-1 border-t border-white/5">
                  <CustomVoiceProfile 
                    initialProfile={config.voiceProfile}
                    onProfileChange={(base64) => handleChange('voiceProfile', base64 || undefined)}
                  />
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ========================================================================= */}
      {/* 3. NARRATION RULES PANEL                                                  */}
      {/* ========================================================================= */}
      {(activePanel === 'grid' || activePanel === 'rules') && (
        <section className="rounded-3xl border border-white/10 bg-gradient-to-b from-slate-900/90 to-black/90 p-5 sm:p-6 shadow-2xl relative overflow-hidden backdrop-blur-xl group transition-all duration-300">
          <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-400/5 blur-[80px] -z-10 pointer-events-none" />

          {/* Panel Header */}
          <div className="flex items-center justify-between pb-4 mb-5 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-400/15 border border-emerald-400/30 text-emerald-400 grid place-items-center shadow-lg shadow-emerald-500/10">
                <BookOpen size={19} />
              </div>
              <div>
                <h3 className="text-sm font-black text-white tracking-tight flex items-center gap-2">
                  <span>Narration Rules</span>
                  <span className="text-[11px] font-medium text-slate-400 hidden sm:inline">· ဇာတ်ကြောင်းပြော ပုံစံနှင့် စည်းမျဉ်းများ</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {isMm ? 'ဇာတ်လမ်းခံစားချက်၊ စတိုင်များနှင့် စာလုံးအသံထွက် ပြင်ဆင်ချက်များ' : 'Storytelling tones, style prompts & phonetic pronunciation rules'}
                </p>
              </div>
            </div>
            <span className="text-[10px] font-mono font-bold text-emerald-300 px-2.5 py-1 rounded-xl bg-emerald-400/10 border border-emerald-400/25">
              {activeStyleCount > 0 ? `${activeStyleCount} Moods` : (isMm ? 'မူလစတိုင်' : 'Natural')}
            </span>
          </div>

          <div className="space-y-5">
            {/* Expressive Tone & Emotion Chips */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                  <Sparkles size={13} className="text-emerald-400" />
                  {t('voiceConfig.style')}
                </label>
                {activeStyleCount > 0 && (
                  <button
                    type="button"
                    onClick={() => handleChange('styleInstruction', '')}
                    className="text-[10px] text-rose-400 hover:underline font-bold"
                  >
                    {isMm ? 'ပြန်ရှင်းမည်' : 'Clear all'}
                  </button>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5 sm:gap-2">
                {QUICK_STYLES.map((style) => {
                  const active = isStyleActive(style.value);
                  return (
                    <button
                      type="button"
                      key={style.label}
                      onClick={() => toggleStyle(style.value)}
                      className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all border flex items-center gap-1.5 ${
                        active
                          ? 'bg-emerald-400 text-black border-emerald-400 shadow-lg shadow-emerald-400/20 scale-[1.02]'
                          : 'bg-black/50 text-slate-300 border-white/10 hover:border-emerald-400/40 hover:text-white'
                      }`}
                    >
                      <span className="text-[12px]">{style.emoji}</span>
                      <span>{style.label}</span>
                      {active && <Check size={11} className="stroke-[3]" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom Style Prompt Directive */}
            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-2">
                <Wand2 size={13} className="text-emerald-400" />
                {isMm ? 'စိတ်ကြိုက် ညွှန်ကြားချက် စာသား (Custom Prompt)' : 'Custom Narration Directive'}
              </label>
              <input
                type="text"
                value={config.styleInstruction || ''}
                onChange={(e) => handleChange('styleInstruction', e.target.value)}
                placeholder={t('voiceConfig.stylePlaceholder')}
                className="w-full bg-black/60 border border-white/15 rounded-2xl px-4 py-3 text-[13px] text-white focus:outline-none focus:border-emerald-400/70 transition-all font-medium placeholder:text-slate-600"
              />
            </div>

            {/* Phonetic Pronunciation Replacement Rules */}
            <div className="p-4 rounded-2xl bg-black/40 border border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                  <FileText size={13} className="text-emerald-400" />
                  {isMm ? 'အသံထွက် ပြင်ဆင်ချက် စည်းမျဉ်းများ' : 'Pronunciation & Phonetic Rules'}
                </label>
                <span className="text-[10px] font-mono font-bold text-emerald-300 px-2 py-0.5 rounded-lg bg-emerald-400/10 border border-emerald-400/20">
                  {parsedCustomRules.length + BUILTIN_PRONUNCIATION.length} Active Rules
                </span>
              </div>

              {/* Builtin rule indicator */}
              <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-slate-400">
                <span className="text-slate-500 font-bold">{isMm ? 'အသင့်ပြင်ဆင်ပြီး:' : 'Built-in:'}</span>
                {BUILTIN_PRONUNCIATION.map(([from, to]) => (
                  <span key={from} className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-emerald-300 font-mono">
                    {from} → {to}
                  </span>
                ))}
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                {isMm 
                  ? 'တစ်ကြောင်းလျှင် စာလုံး -> အသံထွက်ပုံစံ ရေးပါ။ အသံထွက်ကိုသာ ပြောင်းပြီး စာတန်းထိုးတွင် မူရင်းအတိုင်း ဆက်လက်ရှိနေပါမည်။' 
                  : 'One per line: word -> phonetic spelling. Only the audio changes; subtitles keep the original text.'}
              </p>

              <textarea
                value={localPronunciation}
                onChange={(e) => handlePronunciationChange(e.target.value)}
                rows={3}
                placeholder="အံ့ဩ -> အံ့အော&#10;word -> replacement"
                className="w-full rounded-xl bg-black/70 border border-white/10 p-3 text-[12px] font-mono leading-relaxed text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-emerald-400/60 custom-scrollbar"
              />
            </div>
          </div>
        </section>
      )}
    </div>
  );
};

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (val: number) => void;
  accentColor?: string;
}

const Slider: React.FC<SliderProps> = ({ 
  label, 
  value, 
  min, 
  max, 
  step, 
  suffix, 
  onChange,
  accentColor = '#F59E0B'
}) => {
  const [localValue, setLocalValue] = useState(value);

  const prevValueRef = React.useRef(value);
  React.useEffect(() => {
    if (prevValueRef.current !== value) {
      prevValueRef.current = value;
      setLocalValue(value);
    }
  }, [value]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setLocalValue(val);
    onChange(val);
  };

  const handleDecrement = () => {
    const newVal = Math.max(min, Number((localValue - step).toFixed(2)));
    setLocalValue(newVal);
    onChange(newVal);
  };

  const handleIncrement = () => {
    const newVal = Math.min(max, Number((localValue + step).toFixed(2)));
    setLocalValue(newVal);
    onChange(newVal);
  };

  const pct = Math.max(0, Math.min(100, ((localValue - min) / (max - min)) * 100));

  return (
    <div className="group">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 mb-2">
        <span className="text-xs sm:text-[13px] font-bold text-slate-200 group-hover:text-white transition-colors shrink-0">
          {label}
        </span>
        <div className="flex-1 flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={handleDecrement}
            disabled={localValue <= min}
            className="w-7 h-7 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:border-white/30 hover:bg-white/10 transition-all disabled:opacity-20 disabled:cursor-not-allowed grid place-items-center shrink-0"
            title="Decrease"
          >
            <Minus size={13} />
          </button>

          <div className="relative flex-1 flex items-center">
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={localValue}
              onChange={handleSliderChange}
              className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer hover:bg-white/15 transition-colors"
              style={{
                background: `linear-gradient(to right, ${accentColor} 0%, ${accentColor} ${pct}%, rgba(255, 255, 255, 0.1) ${pct}%, rgba(255, 255, 255, 0.1) 100%)`
              }}
            />
          </div>

          <button
            type="button"
            onClick={handleIncrement}
            disabled={localValue >= max}
            className="w-7 h-7 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:border-white/30 hover:bg-white/10 transition-all disabled:opacity-20 disabled:cursor-not-allowed grid place-items-center shrink-0"
            title="Increase"
          >
            <Plus size={13} />
          </button>

          <div className="w-16 px-1.5 py-1 bg-white/5 rounded-xl text-center shrink-0 border border-white/10">
            <span className="text-[11px] font-mono font-bold text-white">
              {localValue > 0 && (label.toLowerCase().includes('pitch') || label.includes('အသံအနိမ့်အမြင့်') || suffix?.includes('dB')) ? `+${localValue}` : localValue}
              {suffix}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
