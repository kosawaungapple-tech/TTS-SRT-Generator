import React from 'react';
import { Zap, ChevronDown, Volume2, Info } from 'lucide-react';
import { TTSConfig } from '../types';
import { VOICE_OPTIONS } from '../constants';

interface VoiceConfigProps {
  config: TTSConfig;
  setConfig: (config: TTSConfig) => void;
  isDarkMode: boolean;
}

export const VoiceConfig: React.FC<VoiceConfigProps> = ({ config, setConfig, isDarkMode }) => {
  const handleChange = (key: keyof TTSConfig, value: any) => {
    setConfig({ ...config, [key]: value });
  };

  return (
    <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[32px] p-8 shadow-2xl transition-colors duration-300">
      <div className="space-y-8">
        {/* Voice Selection */}
        <div className="group">
          <label className="flex items-center gap-2 text-lg font-medium text-slate-700 dark:text-slate-100 mb-4 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">
            <Volume2 size={20} className="text-brand-purple" />
            အသံရွေးချယ်ရန်
          </label>
          <div className="relative">
            <select
              value={config.voiceId}
              onChange={(e) => handleChange('voiceId', e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl px-6 py-4 text-slate-900 dark:text-white appearance-none focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all cursor-pointer font-medium"
            >
              {VOICE_OPTIONS.map((voice) => (
                <option key={voice.id} value={voice.id} className="bg-white dark:bg-slate-950 text-slate-900 dark:text-white">
                  {voice.name}
                </option>
              ))}
            </select>
            <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
              <ChevronDown size={20} />
            </div>
          </div>
        </div>

        <Slider
          label="အမြန်နှုန်း"
          value={config.speed}
          min={0.25}
          max={4.0}
          step={0.05}
          suffix="x"
          onChange={(v) => handleChange('speed', v)}
          isDarkMode={isDarkMode}
        />
        <Slider
          label="အသံအနိမ့်အမြင့်"
          value={config.pitch}
          min={-20.0}
          max={20.0}
          step={0.5}
          suffix=""
          onChange={(v) => handleChange('pitch', v)}
          isDarkMode={isDarkMode}
        />
        <div className="flex items-center gap-2 px-4 py-2 bg-brand-purple/5 border border-brand-purple/10 rounded-xl">
          <Info size={14} className="text-brand-purple shrink-0" />
          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            Changes will apply to the next generation.
          </p>
        </div>
        <Slider
          label="အသံပမာဏ"
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
      <div className="flex justify-between items-center mb-4">
        <span className="text-lg font-medium text-slate-700 dark:text-slate-100 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">{label}</span>
        <span className="text-lg font-medium text-brand-purple">
          {value > 0 && (label === 'Pitch' || label === 'အသံအနိမ့်အမြင့်') ? `+${value}` : value}
          {suffix}
        </span>
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
