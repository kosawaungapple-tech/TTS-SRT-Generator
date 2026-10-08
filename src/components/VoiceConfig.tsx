import React, { useMemo, useEffect, useState } from 'react';
import { ChevronDown, Volume2, Wand2, Server, FileText, Plus, Minus, UserCheck, Music } from 'lucide-react';
import { TTSConfig } from '../types';
import { VOICE_OPTIONS } from '../constants';
import { useLanguage } from '../contexts/LanguageContext';
import { CustomVoiceProfile } from './CustomVoiceProfile';

interface VoiceConfigProps {
  config: TTSConfig;
  setConfig: (config: TTSConfig) => void;
  baseDuration?: number; // Optional actual base duration from last result
  isAdmin?: boolean;
}

export const VoiceConfig: React.FC<VoiceConfigProps> = ({ config, setConfig, baseDuration }) => {
  const { t } = useLanguage();
  
  const estimatedDisplay = useMemo(() => {
    if (!baseDuration) return null;
    const estimatedSeconds = baseDuration / (config.speed || 1);
    const m = Math.floor(estimatedSeconds / 60);
    const s = Math.floor(estimatedSeconds % 60);
    const timeStr = m > 0 ? `${m}m ${s}s` : `${s}s`;
    return `~${timeStr} at ${config.speed}x`;
  }, [baseDuration, config.speed]);
  
  const QUICK_STYLES = [
    { label: t('voiceConfig.styles.warm'), value: 'Warm' },
    { label: t('voiceConfig.styles.professional'), value: 'Professional' },
    { label: t('voiceConfig.styles.excited'), value: 'Excited' },
    { label: t('voiceConfig.styles.angry'), value: 'Angry' },
    { label: t('voiceConfig.styles.sad'), value: 'Sad' },
    { label: t('voiceConfig.styles.whisper'), value: 'Whisper' },
    { label: t('voiceConfig.styles.calm'), value: 'Calm' },
    { label: t('voiceConfig.styles.energetic'), value: 'Energetic' },
    { label: t('voiceConfig.styles.storytelling'), value: 'Storytelling' },
    { label: t('voiceConfig.styles.serious'), value: 'Serious' },
    { label: t('voiceConfig.styles.happy'), value: 'Happy' },
    { label: t('voiceConfig.styles.horror'), value: 'Horror' },
    { label: t('voiceConfig.styles.panic'), value: 'Panic' },
    { label: t('voiceConfig.styles.suspense'), value: 'Suspense' },
  ];

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

  // Use all available voices as model is now locked
  const filteredVoices = useMemo(() => {
    return VOICE_OPTIONS;
  }, []);

  // Reset voice if needed (should not be needed as model is fixed)
  useEffect(() => {
    if (filteredVoices.length > 0 && !filteredVoices.some(v => v.id === config.voiceId)) {
      handleChange('voiceId', filteredVoices[0].id);
    }
  }, [filteredVoices, config.voiceId]);

  return (
    <div className="bg-white/5 backdrop-blur-xl rounded-2xl sm:rounded-3xl p-4 sm:p-8 border border-white/10 shadow-2xl relative overflow-hidden group">
      <div className="absolute top-0 left-0 w-64 h-64 bg-amber-400/5 blur-[100px] -z-10 group-hover:bg-amber-400/10 transition-colors duration-1000" />
      <div className="space-y-8 sm:space-y-10">
        {/* AI Model Server Selection */}
        <div className="group/item">
          <label className="flex items-center gap-3 text-[9px] sm:text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 sm:mb-4 group-hover/item:text-amber-500 transition-colors">
            <div className="p-1.5 sm:p-2 bg-amber-400/10 rounded-lg text-amber-500">
              <Server size={14} className="sm:w-4 sm:h-4" />
            </div>
            AI Model / ဆာဗာရွေးချယ်ရန်
          </label>
          <div className="relative">
            <select
              value={config.selectedModel || 'gemini-3.8-flash-lite-tts'}
              onChange={(e) => handleChange('selectedModel', e.target.value)}
              className="w-full bg-black/40 border border-white/5 rounded-xl px-4 sm:px-5 py-3.5 sm:py-4 text-sm sm:text-base text-white appearance-none focus:outline-none focus:ring-1 focus:ring-amber-400/30 focus:border-amber-400/50 transition-all cursor-pointer font-medium"
            >
              <option value="gemini-3.8-flash-lite-tts" className="bg-black text-white">
                Gemini 3.8 Flash Lite TTS (Recommended / Fresh Quota / မြန်ဆန်)
              </option>
              <option value="gemini-3.8-flash-tts" className="bg-black text-white">
                Gemini 3.8 Flash TTS (Cinematic Studio Persona / အရည်အသွေးမြင့်)
              </option>
              <option value="gemini-3.1-flash-lite" className="bg-black text-white">
                Gemini 3.1 Flash Lite (High Quota Two-Step / အကန့်အသတ်မရှိသလောက်သုံးရန်)
              </option>
            </select>
            <div className="absolute right-8 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500 group-hover/item:text-amber-500 transition-colors">
              <ChevronDown size={24} />
            </div>
          </div>
        </div>

        {/* Voice Selection */}
        <div className="group/item">
          <label className="flex items-center gap-3 text-[9px] sm:text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 sm:mb-4 group-hover/item:text-amber-500 transition-colors">
            <div className="p-1.5 sm:p-2 bg-amber-400/10 rounded-lg text-amber-500">
              <Volume2 size={14} className="sm:w-4 sm:h-4" />
            </div>
            {t('voiceConfig.voice')}
          </label>
          <div className="relative">
            <select
              value={config.voiceId}
              onChange={(e) => handleChange('voiceId', e.target.value)}
              className="w-full bg-black/40 border border-white/5 rounded-xl px-4 sm:px-5 py-3.5 sm:py-4 text-sm sm:text-base text-white appearance-none focus:outline-none focus:ring-1 focus:ring-amber-400/30 focus:border-amber-400/50 transition-all cursor-pointer font-medium"
            >
              {filteredVoices.map((voice) => (
                <option key={voice.id} value={voice.id} className="bg-black text-white">
                  {voice.name}
                </option>
              ))}
            </select>
            <div className="absolute right-8 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500 group-hover/item:text-amber-500 transition-colors">
              <ChevronDown size={24} />
            </div>
          </div>
        </div>

        {/* Custom Voice Profile Section */}
        <div className="group/item">
          <label className="flex items-center gap-3 text-[9px] sm:text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 sm:mb-4 group-hover/item:text-amber-500 transition-colors">
            <div className="p-1.5 sm:p-2 bg-amber-400/10 rounded-lg text-amber-500">
              <UserCheck size={14} className="sm:w-4 sm:h-4" />
            </div>
            Custom Voice Cloning / အသံတုပြုလုပ်ရန်
          </label>
          <div className="bg-black/20 rounded-2xl p-4 sm:p-6 border border-white/5">
            <CustomVoiceProfile 
              initialProfile={config.voiceProfile}
              onProfileChange={(base64) => handleChange('voiceProfile', base64 || undefined)}
            />
          </div>
        </div>

        {/* Custom File Name */}
        <div className="group/item">
          <label className="flex items-center gap-3 text-[9px] sm:text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 sm:mb-4 group-hover/item:text-amber-500 transition-colors">
            <div className="p-1.5 sm:p-2 bg-amber-400/10 rounded-lg text-amber-500">
              <FileText size={14} className="sm:w-4 sm:h-4" />
            </div>
            ဖိုင်အမည်သတ်မှတ်ရန် (Optional)
          </label>
          <div className="relative">
            <input
              type="text"
              value={config.customFileName || ''}
              onChange={(e) => handleChange('customFileName', e.target.value)}
              placeholder="ဥပမာ - vlogs_by_saw_audio"
              className="w-full bg-black/40 border border-white/5 rounded-xl px-4 sm:px-5 py-3.5 sm:py-4 text-sm sm:text-base text-white focus:outline-none focus:ring-1 focus:ring-amber-400/30 focus:border-amber-400/50 transition-all font-medium placeholder:text-slate-600"
            />
          </div>
        </div>

        {/* Audio Export Format Toggle (WAV vs MP3) */}
        <div className="group/item">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <label className="flex items-center gap-3 text-[9px] sm:text-[10px] font-bold text-slate-500 uppercase tracking-widest group-hover/item:text-amber-500 transition-colors">
              <div className="p-1.5 sm:p-2 bg-amber-400/10 rounded-lg text-amber-500">
                <Music size={14} className="sm:w-4 sm:h-4" />
              </div>
              {t('voiceConfig.exportFormat')}
            </label>
            <span className="text-[9px] font-mono uppercase tracking-widest text-slate-500 font-bold">
              Format: {(config.exportFormat || 'wav').toUpperCase()}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => handleChange('exportFormat', 'wav')}
              className={`p-3.5 sm:p-4 rounded-xl border text-left transition-all relative overflow-hidden group/btn ${
                (config.exportFormat || 'wav') === 'wav'
                  ? 'bg-amber-400 text-black border-amber-400 shadow-xl shadow-amber-400/20 scale-[1.01]'
                  : 'bg-black/40 text-slate-400 border-white/5 hover:border-amber-400/30 hover:text-white'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs sm:text-sm font-black uppercase tracking-wider flex items-center gap-1.5">
                  WAV
                  <span className={`text-[8px] sm:text-[9px] px-1.5 py-0.5 rounded font-black tracking-normal uppercase ${
                    (config.exportFormat || 'wav') === 'wav'
                      ? 'bg-black/20 text-black'
                      : 'bg-white/10 text-amber-400'
                  }`}>
                    Lossless
                  </span>
                </span>
                <span className={`w-2 h-2 rounded-full ${
                  (config.exportFormat || 'wav') === 'wav'
                    ? 'bg-black shadow-[0_0_6px_currentColor]'
                    : 'bg-slate-700'
                }`} />
              </div>
              <p className={`text-[10px] sm:text-[11px] leading-tight font-medium ${
                (config.exportFormat || 'wav') === 'wav' ? 'text-black/80' : 'text-slate-500'
              }`}>
                {t('voiceConfig.formatWavSubtitle')} • PCM 24kHz
              </p>
            </button>

            <button
              type="button"
              onClick={() => handleChange('exportFormat', 'mp3')}
              className={`p-3.5 sm:p-4 rounded-xl border text-left transition-all relative overflow-hidden group/btn ${
                config.exportFormat === 'mp3'
                  ? 'bg-amber-400 text-black border-amber-400 shadow-xl shadow-amber-400/20 scale-[1.01]'
                  : 'bg-black/40 text-slate-400 border-white/5 hover:border-amber-400/30 hover:text-white'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs sm:text-sm font-black uppercase tracking-wider flex items-center gap-1.5">
                  MP3
                  <span className={`text-[8px] sm:text-[9px] px-1.5 py-0.5 rounded font-black tracking-normal uppercase ${
                    config.exportFormat === 'mp3'
                      ? 'bg-black/20 text-black'
                      : 'bg-white/10 text-amber-400'
                  }`}>
                    Compact
                  </span>
                </span>
                <span className={`w-2 h-2 rounded-full ${
                  config.exportFormat === 'mp3'
                    ? 'bg-black shadow-[0_0_6px_currentColor]'
                    : 'bg-slate-700'
                }`} />
              </div>
              <p className={`text-[10px] sm:text-[11px] leading-tight font-medium ${
                config.exportFormat === 'mp3' ? 'text-black/80' : 'text-slate-500'
              }`}>
                {t('voiceConfig.formatMp3Subtitle')} • 192 kbps
              </p>
            </button>
          </div>
        </div>

        {/* Style Instructions */}
        <div className="group/item">
          <label className="flex items-center gap-3 text-[9px] sm:text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 sm:mb-4 group-hover/item:text-amber-500 transition-colors">
            <div className="p-1.5 sm:p-2 bg-amber-400/10 rounded-lg text-amber-500">
              <Wand2 size={14} className="sm:w-4 sm:h-4" />
            </div>
            {t('voiceConfig.style')}
          </label>
          <div className="space-y-4">
            <input
              type="text"
              value={config.styleInstruction || ''}
              onChange={(e) => handleChange('styleInstruction', e.target.value)}
              placeholder={t('voiceConfig.stylePlaceholder')}
              className="w-full bg-black/40 border border-white/5 rounded-xl px-4 sm:px-5 py-3.5 sm:py-4 text-sm sm:text-base text-white focus:outline-none focus:ring-1 focus:ring-amber-400/30 focus:border-amber-400/50 transition-all font-medium placeholder:text-slate-600"
            />
            <div className="flex flex-wrap gap-1.5 sm:gap-2">
              {QUICK_STYLES.map((style) => (
                <button
                  type="button"
                  key={style.label}
                  onClick={() => toggleStyle(style.value)}
                  className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-[8px] sm:text-[9px] font-bold uppercase tracking-widest transition-all border ${
                    isStyleActive(style.value)
                      ? 'bg-amber-400 text-black border-amber-400 shadow-lg shadow-amber-400/20'
                      : 'bg-white/5 text-slate-500 border-white/5 hover:border-amber-400/30 hover:text-amber-500'
                  }`}
                >
                  {style.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-10 pt-4">
          <div className="space-y-4">
            <Slider
              label={t('voiceConfig.speed')}
              value={config.speed}
              min={0.5}
              max={2.0}
              step={0.1}
              suffix="x"
              onChange={(v) => handleChange('speed', v)}
            />
            {estimatedDisplay && (
              <div className="flex justify-end px-2">
                <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest italic bg-white/5 px-3 py-1 rounded-full">
                  {estimatedDisplay}
                </span>
              </div>
            )}
          </div>
          <Slider
            label={t('voiceConfig.pitch')}
            value={config.pitch}
            min={-10.0}
            max={10.0}
            step={1}
            suffix=""
            onChange={(v) => handleChange('pitch', v)}
          />
          <div className="space-y-1">
            <Slider
              label={t('voiceConfig.volume')}
              value={config.volume ?? 0}
              min={0}
              max={10}
              step={1}
              suffix=" dB"
              onChange={(v) => handleChange('volume', v)}
            />
            <div className="flex justify-between items-center px-1 text-[9px] sm:text-[10px] text-slate-500 font-medium">
              <span>0 dB (Unity Gain)</span>
              <span>+10 dB (Max Gain Boost)</span>
            </div>
          </div>
        </div>
      </div>
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
}

const Slider: React.FC<SliderProps> = ({ label, value, min, max, step, suffix, onChange }) => {
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

  return (
    <div className="group">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 mb-2">
        <span className="text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-200 group-hover:text-amber-500 transition-colors shrink-0">
          {label}
        </span>
        <div className="flex-1 flex items-center gap-2 sm:gap-3">
          <button
            onClick={handleDecrement}
            disabled={localValue <= min}
            className="p-1 sm:p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-amber-500 hover:border-amber-400/50 hover:bg-amber-400/5 transition-all disabled:opacity-20 disabled:cursor-not-allowed shrink-0"
            title="Decrease"
          >
            <Minus size={14} className="sm:w-4 sm:h-4" />
          </button>

          <div className="relative flex-1 flex items-center">
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={localValue}
              onChange={handleSliderChange}
              className="w-full h-1.5 bg-slate-200 dark:bg-white/5 rounded-full appearance-none cursor-pointer accent-amber-400 hover:bg-slate-300 dark:hover:bg-white/10 transition-colors"
              style={{
                background: `linear-gradient(to right, #EAB308 0%, #EAB308 ${( (localValue - min) / (max - min) ) * 100}%, rgba(255, 255, 255, 0.05) ${( (localValue - min) / (max - min) ) * 100}%, rgba(255, 255, 255, 0.05) 100%)`
              }}
            />
          </div>

          <button
            onClick={handleIncrement}
            disabled={localValue >= max}
            className="p-1 sm:p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-amber-500 hover:border-amber-400/50 hover:bg-amber-400/5 transition-all disabled:opacity-20 disabled:cursor-not-allowed shrink-0"
            title="Increase"
          >
            <Plus size={14} className="sm:w-4 sm:h-4" />
          </button>

          <div className="w-14 sm:w-16 px-1 sm:px-2 py-0.5 bg-amber-400/10 rounded-lg text-center shrink-0 border border-amber-400/10">
            <span className="text-[10px] sm:text-[11px] font-bold text-amber-500">
              {localValue > 0 && (label.toLowerCase().includes('pitch') || label.includes('အသံအနိမ့်အမြင့်') || suffix?.includes('dB')) ? `+${localValue}` : localValue}
              {suffix}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
