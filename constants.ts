import React, { useMemo, useEffect, useState } from 'react';
import { ChevronDown, Volume2, Wand2 } from 'lucide-react';
import { TTSConfig } from '../types';
import { VOICE_OPTIONS } from '../constants';
import { useLanguage } from '../contexts/LanguageContext';

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

  const handleChange = (key: keyof TTSConfig, value: string | number) => {
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
              min={0.25}
              max={4.0}
              step={0.25}
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
            min={-20.0}
            max={20.0}
            step={0.5}
            suffix=""
            onChange={(v) => handleChange('pitch', v)}
          />
          <Slider
            label={t('voiceConfig.volume')}
            value={config.volume}
            min={0}
            max={100}
            step={1}
            suffix="%"
            onChange={(v) => handleChange('volume', v)}
          />
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

  return (
    <div className="group">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 mb-2">
        <span className="text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-200 group-hover:text-amber-500 transition-colors shrink-0">
          {label}
        </span>
        <div className="flex-1 flex items-center gap-3 sm:gap-4">
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
          <div className="w-14 sm:w-16 px-1 sm:px-2 py-0.5 bg-amber-400/10 rounded-lg text-center shrink-0 border border-amber-400/10">
            <span className="text-[10px] sm:text-[11px] font-bold text-amber-500">
              {localValue > 0 && (label === 'Pitch' || label === 'အသံအနိမ့်အမြင့်') ? `+${localValue}` : localValue}
              {suffix}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
