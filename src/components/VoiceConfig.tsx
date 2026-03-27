import React from 'react';
import { Zap, ChevronDown, Volume2, Info, Waves, Radio, Music, Activity, Settings } from 'lucide-react';
import { TTSConfig, AudioEffects } from '../types';
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

  const handleEffectChange = (effect: keyof AudioEffects, key: string, value: any) => {
    const currentEffects = config.effects || {
      echo: { enabled: false, delay: 0.3, feedback: 0.4 },
      reverb: { enabled: false, decay: 1.5, mix: 0.3 },
      pitchShift: { enabled: false, semitones: 0 },
      chorus: { enabled: false, rate: 1.5, depth: 0.5 }
    };
    
    setConfig({
      ...config,
      effects: {
        ...currentEffects,
        [effect]: {
          ...currentEffects[effect],
          [key]: value
        }
      }
    });
  };

  return (
    <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800/50 rounded-[32px] p-8 shadow-2xl transition-all duration-300 hover:neon-border-blue">
      <div className="flex flex-col items-center text-center mb-8 border-b border-slate-200/50 dark:border-slate-800/50 pb-6">
        <div className="w-12 h-12 bg-brand-purple/10 text-brand-purple rounded-xl flex items-center justify-center mb-2 border border-brand-purple/20 shadow-[0_0_15px_rgba(168,85,247,0.3)]">
          <Settings size={24} strokeWidth={1.5} />
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white font-mono tracking-tighter uppercase">အသံထည့်သွင်းခြင်း</h2>
      </div>
      <div className="space-y-8">
        {/* Voice Selection */}
        <div className="group">
          <label className="flex items-center gap-2 text-sm font-bold text-slate-500 dark:text-slate-400 mb-4 group-hover:text-brand-purple transition-colors font-mono uppercase tracking-widest">
            <Volume2 size={18} className="text-brand-purple" strokeWidth={1.5} />
            အသံရွေးချယ်ရန်
          </label>
          <div className="relative">
            <select
              value={config.voiceId}
              onChange={(e) => handleChange('voiceId', e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200/50 dark:border-slate-800/50 rounded-2xl px-6 py-4 text-slate-900 dark:text-white appearance-none focus:outline-none focus:ring-2 focus:ring-brand-purple/50 transition-all cursor-pointer font-sans text-sm"
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
        <div className="flex items-center gap-2 px-4 py-2 bg-brand-purple/5 border border-brand-purple/10 rounded-xl font-mono">
          <Info size={14} className="text-brand-purple shrink-0" />
          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            အပြောင်းအလဲများသည် နောက်တစ်ကြိမ်တွင် အကျိုးသက်ရောက်မည်ဖြစ်သည်။
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

        {/* Voice Effects Section */}
        <div className="pt-8 border-t border-slate-200 dark:border-slate-800">
          <label className="flex items-center gap-2 text-sm font-bold text-slate-500 dark:text-slate-400 mb-6 font-mono uppercase tracking-widest">
            <Waves size={18} className="text-brand-purple" strokeWidth={1.5} />
            အသံပြုပြင်မွမ်းမံမှုများ
          </label>
          
          <div className="grid grid-cols-1 gap-6">
            {/* Echo */}
            <EffectToggle
              label="Echo (ပဲ့တင်သံ)"
              icon={<Radio size={18} strokeWidth={1.5} />}
              enabled={config.effects?.echo.enabled || false}
              onToggle={(enabled) => handleEffectChange('echo', 'enabled', enabled)}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                <Slider
                  label="နှောင့်နှေးမှု (Delay)"
                  value={config.effects?.echo.delay || 0.3}
                  min={0.1}
                  max={1.0}
                  step={0.1}
                  suffix="s"
                  onChange={(v) => handleEffectChange('echo', 'delay', v)}
                  isDarkMode={isDarkMode}
                  compact
                />
                <Slider
                  label="တုံ့ပြန်မှု (Feedback)"
                  value={config.effects?.echo.feedback || 0.4}
                  min={0}
                  max={0.9}
                  step={0.1}
                  suffix=""
                  onChange={(v) => handleEffectChange('echo', 'feedback', v)}
                  isDarkMode={isDarkMode}
                  compact
                />
              </div>
            </EffectToggle>

            {/* Reverb */}
            <EffectToggle
              label="Reverb (ခန်းမသံ)"
              icon={<Music size={18} strokeWidth={1.5} />}
              enabled={config.effects?.reverb.enabled || false}
              onToggle={(enabled) => handleEffectChange('reverb', 'enabled', enabled)}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                <Slider
                  label="လျော့ပါးမှု (Decay)"
                  value={config.effects?.reverb.decay || 1.5}
                  min={0.5}
                  max={5.0}
                  step={0.5}
                  suffix="s"
                  onChange={(v) => handleEffectChange('reverb', 'decay', v)}
                  isDarkMode={isDarkMode}
                  compact
                />
                <Slider
                  label="ရောစပ်မှု (Mix)"
                  value={config.effects?.reverb.mix || 0.3}
                  min={0}
                  max={1.0}
                  step={0.1}
                  suffix=""
                  onChange={(v) => handleEffectChange('reverb', 'mix', v)}
                  isDarkMode={isDarkMode}
                  compact
                />
              </div>
            </EffectToggle>

            {/* Pitch Shift */}
            <EffectToggle
              label="Pitch Shift (အသံပြောင်းလဲခြင်း)"
              icon={<Activity size={18} strokeWidth={1.5} />}
              enabled={config.effects?.pitchShift.enabled || false}
              onToggle={(enabled) => handleEffectChange('pitchShift', 'enabled', enabled)}
            >
              <div className="mt-4">
                <Slider
                  label="အသံအနိမ့်အမြင့် (Semitones)"
                  value={config.effects?.pitchShift.semitones || 0}
                  min={-12}
                  max={12}
                  step={1}
                  suffix="st"
                  onChange={(v) => handleEffectChange('pitchShift', 'semitones', v)}
                  isDarkMode={isDarkMode}
                  compact
                />
              </div>
            </EffectToggle>

            {/* Chorus */}
            <EffectToggle
              label="Chorus (အဖွဲ့လိုက်သံ)"
              icon={<Zap size={18} strokeWidth={1.5} />}
              enabled={config.effects?.chorus.enabled || false}
              onToggle={(enabled) => handleEffectChange('chorus', 'enabled', enabled)}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                <Slider
                  label="နှုန်း (Rate)"
                  value={config.effects?.chorus.rate || 1.5}
                  min={0.1}
                  max={5.0}
                  step={0.1}
                  suffix="Hz"
                  onChange={(v) => handleEffectChange('chorus', 'rate', v)}
                  isDarkMode={isDarkMode}
                  compact
                />
                <Slider
                  label="အနက် (Depth)"
                  value={config.effects?.chorus.depth || 0.5}
                  min={0}
                  max={1.0}
                  step={0.1}
                  suffix=""
                  onChange={(v) => handleEffectChange('chorus', 'depth', v)}
                  isDarkMode={isDarkMode}
                  compact
                />
              </div>
            </EffectToggle>
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
  isDarkMode: boolean;
  compact?: boolean;
}

const Slider: React.FC<SliderProps> = ({ label, value, min, max, step, suffix, onChange, isDarkMode, compact }) => {
  return (
    <div className={`group ${compact ? 'space-y-2' : 'space-y-4'}`}>
      <div className="flex justify-between items-center">
        <span className={`${compact ? 'text-xs' : 'text-[11px]'} font-bold text-slate-500 dark:text-slate-400 group-hover:text-brand-purple transition-colors font-mono uppercase tracking-wider`}>{label}</span>
        <span className={`${compact ? 'text-xs' : 'text-sm'} font-bold text-brand-purple font-mono`}>
          {value > 0 && (label === 'Pitch' || label === 'အသံအနိမ့်အမြင့်' || label === 'Semitones') ? `+${value}` : value}
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
          className={`w-full ${compact ? 'h-1' : 'h-1.5'} bg-slate-200 dark:bg-white/5 rounded-full appearance-none cursor-pointer accent-brand-purple hover:bg-slate-300 dark:hover:bg-white/10 transition-all`}
          style={{
            background: `linear-gradient(to right, #8B5CF6 0%, #8B5CF6 ${( (value - min) / (max - min) ) * 100}%, ${isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'} ${( (value - min) / (max - min) ) * 100}%, ${isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'} 100%)`
          }}
        />
      </div>
    </div>
  );
};

interface EffectToggleProps {
  label: string;
  icon: React.ReactNode;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  children: React.ReactNode;
}

const EffectToggle: React.FC<EffectToggleProps> = ({ label, icon, enabled, onToggle, children }) => {
  return (
    <div className={`p-5 rounded-2xl border transition-all duration-300 ${enabled ? 'bg-brand-purple/5 border-brand-purple/30 shadow-[0_0_15px_rgba(168,85,247,0.1)]' : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg transition-all ${enabled ? 'bg-brand-purple text-white shadow-[0_0_10px_rgba(168,85,247,0.5)]' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'}`}>
            {icon}
          </div>
          <span className={`text-xs font-bold font-mono uppercase tracking-wider ${enabled ? 'text-slate-900 dark:text-white' : 'text-slate-500'}`}>{label}</span>
        </div>
        <button
          onClick={() => onToggle(!enabled)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${enabled ? 'bg-brand-purple' : 'bg-slate-300 dark:bg-slate-700'}`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`}
          />
        </button>
      </div>
      {enabled && children}
    </div>
  );
};
