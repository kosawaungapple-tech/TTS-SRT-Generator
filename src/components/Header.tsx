import React, { useState, useRef, useEffect } from 'react';
import { Sun, Moon, Mic2, User, ChevronDown, LogOut, ShieldCheck, UserCircle, Globe, Shield } from 'lucide-react';
import { VBSUserControl } from '../types';
import { useLanguage } from '../contexts/LanguageContext';

interface HeaderProps {
  isDarkMode: boolean;
  toggleTheme: () => void;
  isAccessGranted: boolean;
  isAdmin: boolean;
  onLogout: () => void;
  profile: VBSUserControl | null;
  userControl: VBSUserControl | null;
}

export const Header: React.FC<HeaderProps> = ({ 
  isDarkMode, 
  toggleTheme, 
  isAccessGranted,
  isAdmin,
  onLogout,
  profile,
  userControl
}) => {
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { language, setLanguage, t } = useLanguage();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
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
            <p className="text-[9px] sm:text-[10px] uppercase tracking-[0.2em] bg-clip-text text-transparent bg-gradient-to-r from-brand-purple to-neon-magenta font-bold mt-1 opacity-90">
              {t('auth.title')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <button
            onClick={() => setLanguage(language === 'mm' ? 'en' : 'mm')}
            className={`flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-[14px] border transition-all text-[10px] sm:text-[11px] font-extrabold uppercase tracking-widest w-24 sm:w-36 h-10 sm:h-11 shadow-sm shrink-0 ${
              language === 'mm' 
                ? 'bg-amber-500/10 text-amber-500 border-amber-500/20 hover:bg-amber-500/20' 
                : 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20 hover:bg-indigo-500/20'
            }`}
            title="Switch Language"
          >
            <Globe size={14} className="shrink-0" />
            <span className="w-16 sm:w-20 text-center">
              {language === 'mm' ? 'BURMESE' : 'ENGLISH'}
            </span>
          </button>

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
                  className="px-3 py-1.5 sm:px-4 sm:py-2 bg-brand-purple/10 dark:bg-brand-purple/20 text-brand-purple border border-brand-purple/20 dark:border-brand-purple/30 rounded-[12px] text-[10px] font-bold uppercase tracking-wider hover:bg-brand-purple hover:text-white transition-all shadow-sm"
                >
                  {t('nav.admin')}
                </button>
              )}
              
              {/* User Profile Dropdown */}
              <div className="relative" ref={dropdownRef}>
                <button 
                  onClick={() => setIsProfileOpen(!isProfileOpen)}
                  className="flex items-center gap-1.5 sm:gap-2 p-1 rounded-[14px] hover:bg-slate-100 dark:hover:bg-white/5 transition-all border border-transparent hover:border-slate-200 dark:hover:border-white/10"
                >
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-[12px] bg-gradient-to-br from-brand-purple to-purple-700 flex items-center justify-center text-white shadow-lg shadow-brand-purple/20">
                    <User size={16} className="sm:w-5 sm:h-5" />
                  </div>
                  <ChevronDown size={14} className={`text-slate-400 transition-transform duration-300 ${isProfileOpen ? 'rotate-180' : ''}`} />
                </button>

                {isProfileOpen && (
                  <div className="absolute right-0 mt-4 w-72 glass-card rounded-[24px] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200 z-[60]">
                    <div className="p-6">
                      {/* User Info */}
                      <div className="flex items-center gap-4 mb-6">
                        <div className="w-12 h-12 rounded-2xl bg-brand-purple/10 flex items-center justify-center text-brand-purple">
                          <UserCircle size={32} />
                        </div>
                        <div className="overflow-hidden">
                          <h3 className="font-bold text-slate-900 dark:text-white truncate">
                            {profile?.note || profile?.label || (language === 'mm' ? 'Saw အသုံးပြုသူ' : 'Saw User')}
                          </h3>
                           <div className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.1em] ${
                            isAdmin 
                              ? 'text-amber-500' 
                              : (userControl?.membershipStatus === 'premium' ? 'text-emerald-500' : 'text-slate-500')
                          }`}>
                            {isAdmin ? <Shield size={10} className="fill-current" /> : <ShieldCheck size={10} />}
                            {!isAdmin && (userControl?.membershipStatus === 'premium' ? 'PREMIUM ACCESS' : 'STANDARD USER')}
                          </div>
                          {!(isAdmin || profile?.id === 'saw_vlogs_2026' || userControl?.vbsId === 'saw_vlogs_2026') && (
                            <div className="mt-1.5 text-[10px] font-mono font-bold text-brand-purple/80 bg-brand-purple/5 px-2 py-0.5 rounded-lg border border-brand-purple/10 w-fit">
                              ID: {profile?.id || userControl?.vbsId || 'Unknown'}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="space-y-2">
                        <button 
                          onClick={() => {
                            setIsProfileOpen(false);
                            onLogout();
                          }}
                          className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium text-rose-500 hover:bg-rose-500/10 transition-colors text-left"
                        >
                          <LogOut size={16} />
                          {t('settings.logout')}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
