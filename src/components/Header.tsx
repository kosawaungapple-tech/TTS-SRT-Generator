import React, { useState, useRef, useEffect } from 'react';
import { Sun, Moon, Mic2, Globe, Shield, Palette } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

interface HeaderProps {
  isDarkMode: boolean;
  toggleTheme: () => void;
  uiTheme: 'glassmorphism' | 'minimal' | 'neon' | 'cyberpunk';
  onThemeChange: (theme: 'glassmorphism' | 'minimal' | 'neon' | 'cyberpunk') => void;
  isAccessGranted: boolean;
  isAdmin: boolean;
  apiKeyStatus: { state: 'admin' | 'personal' | 'none'; label: string };
  userControl?: import('../types').VBSUserControl | null;
}

export const Header: React.FC<HeaderProps> = ({ 
  isDarkMode, 
  toggleTheme, 
  uiTheme,
  onThemeChange,
  isAccessGranted,
  isAdmin,
  apiKeyStatus,
  userControl
}) => {
  const [isThemeOpen, setIsThemeOpen] = useState(false);
  const themeRef = useRef<HTMLDivElement>(null);
  const { language, setLanguage, t } = useLanguage();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (themeRef.current && !themeRef.current.contains(event.target as Node)) {
        setIsThemeOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200/50 dark:border-slate-800/50 bg-white/70 dark:bg-[#020617]/70 backdrop-blur-xl transition-colors duration-300">
      <div className="container mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between">
        <div 
          className="flex items-center gap-2 sm:gap-3 cursor-pointer group"
          onClick={() => {
            window.history.pushState({}, '', '/');
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
        >
          <div className="w-9 h-9 sm:w-11 sm:h-11 bg-brand-purple rounded-[14px] sm:rounded-[16px] flex items-center justify-center shadow-lg shadow-brand-purple/30 group-hover:scale-105 transition-transform animate-shine">
            <Mic2 className="text-white w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-base sm:text-xl font-bold tracking-tight text-slate-900 dark:text-white leading-none">
              Vlogs By Saw
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] bg-clip-text text-transparent bg-gradient-to-r from-brand-purple to-neon-magenta font-bold opacity-90 leading-none">
                {t('auth.title')}
              </p>
              
              {/* API Key Status Dot */}
              {isAccessGranted && (
                <div className="flex items-center gap-1 bg-white/50 dark:bg-white/5 px-1.5 py-0.5 rounded-full border border-slate-200 dark:border-white/5">
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    apiKeyStatus.state !== 'none' ? 'bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]' : 
                    'bg-rose-500 animate-pulse shadow-[0_0_5px_rgba(244,63,94,0.5)]'
                  }`} />
                  <span className={`text-[8px] font-black uppercase tracking-wider hidden xs:inline ${
                    apiKeyStatus.state !== 'none' ? 'text-emerald-500' : 
                    'text-rose-500'
                  }`}>
                    {apiKeyStatus.state === 'none' ? 'NO KEY' : apiKeyStatus.state === 'admin' ? 'ADMIN KEY' : 'PERS KEY'}
                  </span>
                </div>
              )}
              
              {/* Credits Display */}
              {isAccessGranted && userControl && (
                <div className="flex items-center gap-1.5 bg-brand-purple/5 dark:bg-brand-purple/10 px-2 py-0.5 rounded-full border border-brand-purple/10">
                  <span className="text-[8px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-tighter">Credits:</span>
                  <span className={`text-[10px] font-black font-mono ${
                    (userControl.credits || 0) > 0 ? 'text-brand-purple' : 'text-rose-500'
                  }`}>
                    {userControl.credits || 0}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <button
            onClick={() => setLanguage(language === 'mm' ? 'en' : 'mm')}
            className={`flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-[14px] border transition-all text-[10px] sm:text-[11px] font-extrabold uppercase tracking-widest w-10 sm:w-36 h-10 sm:h-11 shadow-sm shrink-0 ${
              language === 'mm' 
                ? 'bg-amber-500/10 text-amber-500 border-amber-500/20 hover:bg-amber-500/20' 
                : 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20 hover:bg-indigo-500/20'
            }`}
            title="Switch Language"
          >
            <Globe size={14} className="shrink-0" />
            <span className="hidden sm:inline sm:w-20 text-center">
              {language === 'mm' ? 'BURMESE' : 'ENGLISH'}
            </span>
          </button>

          <div className="relative" ref={themeRef}>
            <button
              onClick={() => setIsThemeOpen(!isThemeOpen)}
              className="p-2 sm:p-2.5 rounded-[12px] hover:bg-slate-100 dark:hover:bg-white/5 transition-all text-slate-500 dark:text-slate-400 border border-transparent hover:border-slate-200 dark:hover:border-white/10"
              title="UI Theme"
            >
              <Palette size={18} className="sm:w-5 sm:h-5" />
            </button>

            {isThemeOpen && (
              <div className="absolute right-0 mt-4 w-56 glass-card rounded-[20px] shadow-2xl overflow-hidden z-[60] p-3 space-y-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 px-2 pb-1">UI Style</p>
                {[
                  { id: 'glassmorphism', label: 'Glassmorphism', emoji: '🪟' },
                  { id: 'minimal', label: 'Minimal', emoji: '⬜' },
                  { id: 'neon', label: 'Neon', emoji: '🌟' },
                  { id: 'cyberpunk', label: 'Cyberpunk', emoji: '⚡' },
                ].map((theme) => (
                  <button
                    key={theme.id}
                    onClick={() => {
                      onThemeChange(theme.id as 'glassmorphism' | 'minimal' | 'neon' | 'cyberpunk');
                      setIsThemeOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all ${
                      uiTheme === theme.id
                        ? 'bg-brand-purple text-white'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'
                    }`}
                  >
                    <span>{theme.emoji}</span>
                    {theme.label}
                    {uiTheme === theme.id && <span className="ml-auto text-[10px]">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={toggleTheme}
            className="p-2 sm:p-2.5 rounded-[12px] hover:bg-slate-100 dark:hover:bg-white/5 transition-all text-slate-500 dark:text-slate-400 border border-transparent hover:border-slate-200 dark:hover:border-white/10"
            title={language === 'mm' ? 'Theme ပြောင်းရန်' : 'Toggle Theme'}
          >
            {isDarkMode ? <Sun size={18} className="sm:w-5 sm:h-5 text-amber-400" /> : <Moon size={18} className="sm:w-5 sm:h-5 text-slate-700" />}
          </button>
          {isAccessGranted && (
            <div className="flex items-center gap-2 sm:gap-4">
              {isAdmin && (
                <button 
                  onClick={() => {
                    window.history.pushState({}, '', '/vbs-admin');
                    window.dispatchEvent(new PopStateEvent('popstate'));
                  }}
                  className="px-3 py-1.5 sm:px-4 sm:py-2 bg-brand-purple/10 dark:bg-brand-purple/20 text-brand-purple border border-brand-purple/20 dark:border-brand-purple/30 rounded-[12px] text-[10px] font-bold uppercase tracking-wider hover:bg-brand-purple hover:text-white transition-all shadow-sm flex items-center gap-1.5"
                >
                  <Shield size={14} className="sm:hidden" />
                  <span className="hidden sm:inline">{t('nav.admin')}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
