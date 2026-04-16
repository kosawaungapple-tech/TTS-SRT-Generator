import React, { useMemo, useEffect } from 'react';
import { Zap, ChevronDown, Volume2, Info, Wand2 } from 'lucide-react';
import { TTSConfig } from '../types';
import { VOICE_OPTIONS, MODEL_OPTIONS, MODEL_VOICE_MAPPING } from '../constants';
import { useLanguage } from '../contexts/LanguageContext';

interface VoiceConfigProps {
  config: TTSConfig;
  setConfig: (config: TTSConfig) => void;
  isDarkMode: boolean;
}

export const VoiceConfig: React.FC<VoiceConfigProps> = ({ config, setConfig, isDarkMode }) => {
  const { t } = useLanguage();
  
  const QUICK_STYLES = [
    { label: t('voiceConfig.styles.warm'), value: 'Warm and friendly' },
    { label: t('voiceConfig.styles.professional'), value: 'Professional and authoritative' },
    { label: t('voiceConfig.styles.excited'), value: 'Excited and energetic' },
    { label: t('voiceConfig.styles.angry'), value: 'Angry and intense' },
    { label: t('voiceConfig.styles.sad'), value: 'Sad and emotional' },
    { label: t('voiceConfig.styles.whisper'), value: 'Whispering and soft' },
  ];

  const handleChange = (key: keyof TTSConfig, value: any) => {
    setConfig({ ...config, [key]: value });
  };

  // Filtered voices based on selected model
  const filteredVoices = useMemo(() => {
    const supportedVoiceIds = MODEL_VOICE_MAPPING[config.model] || [];
    return VOICE_OPTIONS.filter(voice => supportedVoiceIds.includes(voice.id));
  }, [config.model]);

  // Reset voice if not supported by new model
  useEffect(() => {
    const isSupported = filteredVoices.some(v => v.id === config.voiceId);
    if (!isSupported && filteredVoices.length > 0) {
      handleChange('voiceId', filteredVoices[0].id);
    }
  }, [config.model, filteredVoices]);

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
          <div className="flex items-center gap-3 px-5 py-3 bg-brand-purple/5 border border-brand-purple/10 rounded-2xl">
            <Info size={16} className="text-brand-purple shrink-0" />
            <p className="text-[11px] text-slate-600 dark:text-slate-400 font-medium leading-relaxed">
              {t('voiceConfig.changesApplyNext')}
            </p>
          </div>
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
  return (
    <div className="group">
      <div className="flex justify-between items-center mb-5">
        <span className="text-base font-bold text-slate-700 dark:text-slate-200 group-hover:text-brand-purple transition-colors">{label}</span>
        <div className="px-3 py-1 bg-brand-purple/10 rounded-lg">
          <span className="text-sm font-bold text-brand-purple">
            {value > 0 && (label === 'Pitch' || label === 'အသံအနိမ့်အမြင့်') ? `+${value}` : value}
            {suffix}
          </span>
        </div>
      </div>
      <div className="relative flex items-center">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full h-2 bg-slate-200 dark:bg-white/5 rounded-full appearance-none cursor-pointer accent-brand-purple hover:bg-slate-300 dark:hover:bg-white/10 transition-colors"
          style={{
            background: `linear-gradient(to right, #8B5CF6 0%, #8B5CF6 ${( (value - min) / (max - min) ) * 100}%, ${isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'} ${( (value - min) / (max - min) ) * 100}%, ${isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'} 100%)`
          }}
        />
      </div>
    </div>
  );
};
