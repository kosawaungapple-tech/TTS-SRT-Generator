import React, { useMemo, useEffect, useState } from 'react';
import { ChevronDown, Volume2, Wand2 } from 'lucide-react';
import { TTSConfig } from '../types';
import { VOICE_OPTIONS } from '../constants';
import { useLanguage } from '../contexts/LanguageContext';

interface VoiceConfigProps {
  config: TTSConfig;
  setConfig: (config: TTSConfig) => void;
  isDarkMode: boolean;
  baseDuration?: number; // Optional actual base duration from last result
  isAdmin?: boolean;
}

export const VoiceConfig: React.FC<VoiceConfigProps> = ({ config, setConfig, isDarkMode, baseDuration }) => {
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
    { label: t('voiceConfig.styles.warm'), value: 'Warm and friendly' },
    { label: t('voiceConfig.styles.professional'), value: 'Professional and authoritative' },
    { label: t('voiceConfig.styles.excited'), value: 'Excited and energetic' },
    { label: t('voiceConfig.styles.angry'), value: 'Angry and intense' },
    { label: t('voiceConfig.styles.sad'), value: 'Sad and emotional' },
    { label: t('voiceConfig.styles.whisper'), value: 'Whispering and soft' },
  ];

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
    <div className="premium-glass rounded-[32px] p-8 sm:p-10 shadow-2xl transition-all duration-300 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-64 h-64 bg-brand-purple/5 blur-[100px] -z-10" />
      <div className="space-y-10">
        {/* Voice Selection */}
        <div className="group">
          <label className="flex items-center gap-3 text-lg font-bold text-slate-800 dark:text-slate-100 mb-5 group-hover:text-brand-purple transition-colors">
            <div className="p-2 bg-brand-purple/10 rounded-lg">
              <Volume2 size={20} className="text-brand-purple" />
            </div>
            {t('voiceConfig.voice')}
          </label>
          <div className="relative">
            <select
              value={config.voiceId}
              onChange={(e) => handleChange('voiceId', e.target.value)}
              className="w-full bg-slate-50/50 dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-[20px] px-6 py-4 text-slate-900 dark:text-white appearance-none focus:outline-none focus:ring-2 focus:ring-brand-purple/30 transition-all cursor-pointer font-bold shadow-inner"
            >
              {filteredVoices.map((voice) => (
                <option key={voice.id} value={voice.id} className="bg-white dark:bg-slate-950 text-slate-900 dark:text-white">
                  {voice.name}
                </option>
              ))}
            </select>
            <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
              <ChevronDown size={20} />
            </div>
          </div>
        </div>

        {/* Style Instructions */}
        <div className="group">
          <label className="flex items-center gap-3 text-lg font-bold text-slate-800 dark:text-slate-100 mb-5 group-hover:text-brand-purple transition-colors">
            <div className="p-2 bg-brand-purple/10 rounded-lg">
              <Wand2 size={20} className="text-brand-purple" />
            </div>
            {t('voiceConfig.style')}
          </label>
          <div className="space-y-5">
            <input
              type="text"
              value={config.styleInstruction || ''}
              onChange={(e) => handleChange('styleInstruction', e.target.value)}
              placeholder={t('voiceConfig.stylePlaceholder')}
              className="w-full bg-slate-50/50 dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-[20px] px-6 py-4 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-purple/30 transition-all font-bold placeholder:text-slate-400 shadow-inner"
            />
            <div className="flex flex-wrap gap-2">
              {QUICK_STYLES.map((style) => (
                <button
                  type="button"
                  key={style.label}
                  onClick={() => handleChange('styleInstruction', style.value)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
                    config.styleInstruction === style.value
                      ? 'bg-brand-purple text-white border-brand-purple shadow-lg shadow-brand-purple/30'
                      : 'bg-white/50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-brand-purple/50 hover:text-brand-purple'
                  }`}
                >
                  {style.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-8">
          <div className="space-y-2">
            <Slider
              label={t('voiceConfig.speed')}
              value={config.speed}
              min={0.25}
              max={4.0}
              step={0.25}
              suffix="x"
              onChange={(v) => handleChange('speed', v)}
              isDarkMode={isDarkMode}
            />
            {estimatedDisplay && (
              <div className="flex justify-end px-2">
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 italic">
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
            isDarkMode={isDarkMode}
          />
          <Slider
            label={t('voiceConfig.volume')}
            value={config.volume}
            min={0}
            max={100}
            step={1}
            suffix="%"
            onChange={(v) => handleChange('volume', v)}
            isDarkMode={isDarkMode}
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
  isDarkMode: boolean;
}

const Slider: React.FC<SliderProps> = ({ label, value, min, max, step, suffix, onChange, isDarkMode }) => {
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
      <div className="flex items-center justify-between gap-4 mb-2">
        <span className="text-sm font-bold text-slate-700 dark:text-slate-200 group-hover:text-brand-purple transition-colors shrink-0">
          {label}
        </span>
        <div className="flex-1 flex items-center gap-4">
          <div className="relative flex-1 flex items-center">
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={localValue}
              onChange={handleSliderChange}
              className="w-full h-1.5 bg-slate-200 dark:bg-white/5 rounded-full appearance-none cursor-pointer accent-brand-purple hover:bg-slate-300 dark:hover:bg-white/10 transition-colors"
              style={{
                background: `linear-gradient(to right, #8B5CF6 0%, #8B5CF6 ${( (localValue - min) / (max - min) ) * 100}%, ${isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'} ${( (localValue - min) / (max - min) ) * 100}%, ${isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'} 100%)`
              }}
            />
          </div>
          <div className="w-16 px-2 py-0.5 bg-brand-purple/10 rounded-lg text-center shrink-0 border border-brand-purple/10">
            <span className="text-[11px] font-bold text-brand-purple">
              {localValue > 0 && (label === 'Pitch' || label === 'အသံအနိမ့်အမြင့်') ? `+${localValue}` : localValue}
              {suffix}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
