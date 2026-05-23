import React from 'react';
import { Mic2, Globe, Settings } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

interface HeaderProps {
  isAccessGranted: boolean;
  isAdmin: boolean;
  apiKeyStatus: { state: 'admin' | 'personal' | 'none'; label: string };
  userControl?: import('../types').VBSUserControl | null;
  setActiveTab: (tab: 'generate' | 'translator' | 'transcriber' | 'thumbnail' | 'video-studio' | 'history' | 'tools' | 'admin' | 'vbs-admin') => void;
}

export const Header: React.FC<HeaderProps> = ({ 
  isAccessGranted,
  isAdmin,
  apiKeyStatus,
  userControl,
  setActiveTab
}) => {
  const { language, setLanguage, t } = useLanguage();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-black/80 backdrop-blur-2xl transition-all duration-300">
      <div className="container mx-auto px-4 sm:px-6 h-20 flex items-center justify-between">
        <div 
          className="flex items-center gap-3 cursor-pointer group"
          onClick={() => {
            window.history.pushState({}, '', '/');
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
        >
          <div className="w-10 h-10 bg-white/5 border border-white/10 rounded-xl flex items-center justify-center shadow-xl group-hover:scale-105 group-hover:border-amber-400/50 transition-all duration-300">
            <Mic2 className="text-amber-400 w-5 h-5" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-base sm:text-lg font-bold tracking-tight text-white leading-none whitespace-nowrap">
              Vlogs <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-amber-200 to-amber-500">By Saw</span>
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-[9px] sm:text-[10px] uppercase font-bold tracking-widest text-slate-500 leading-none">
                AI STUDIO
              </p>
              
              {/* API Key Status Dot */}
              {isAccessGranted && (
                <div className="flex items-center gap-1 bg-white/5 px-1.5 sm:px-2 py-0.5 rounded-full border border-white/5">
                  <div className={`w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full ${
                    apiKeyStatus.state !== 'none' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 
                    'bg-rose-500 animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.5)]'
                  }`} />
                  <span className={`text-[7px] sm:text-[8px] font-bold uppercase tracking-wider hidden xs:inline ${
                    apiKeyStatus.state !== 'none' ? 'text-emerald-500' : 
                    'text-rose-500'
                  }`}>
                    {apiKeyStatus.state === 'none' ? 'OFFLINE' : apiKeyStatus.state === 'admin' ? 'SYSTEM' : 'PERSONAL'}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          {/* Credits Display */}
          {isAccessGranted && userControl && (
            <div className="hidden lg:flex items-center gap-2 bg-white/5 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl border border-white/10">
              <span className="text-[9px] sm:text-[10px] font-bold text-slate-500 uppercase tracking-widest">CREDITS</span>
              <span className={`text-xs sm:text-sm font-bold font-mono ${
                (userControl.credits || 0) > 0 ? 'text-amber-400' : 'text-rose-500'
              }`}>
                {userControl.credits || 0}
              </span>
            </div>
          )}

          <button
            onClick={() => setLanguage(language === 'mm' ? 'en' : 'mm')}
            className={`flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-xl border transition-all text-[10px] sm:text-xs font-bold uppercase tracking-widest h-9 sm:h-10 shadow-sm shrink-0 ${
              language === 'mm' 
                ? 'bg-amber-400/10 text-amber-500 border-amber-400/20 hover:bg-amber-400/20' 
                : 'bg-white/5 text-white border-white/10 hover:bg-white/10'
            }`}
          >
            <Globe size={14} className="shrink-0" />
            <span className="hidden xs:inline">{language === 'mm' ? 'Burmese' : 'English'}</span>
            <span className="xs:hidden">{language === 'mm' ? 'MM' : 'EN'}</span>
          </button>

          <button
            onClick={() => setActiveTab('tools')}
            className="p-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-amber-400 hover:bg-white/10 transition-all shadow-sm h-9 sm:h-10 w-9 sm:w-10 flex items-center justify-center"
            title={t('nav.settings')}
          >
            <Settings size={18} />
          </button>

          {isAccessGranted && isAdmin && (
            <button 
              onClick={() => {
                window.history.pushState({}, '', '/vbs-admin');
                window.dispatchEvent(new PopStateEvent('popstate'));
              }}
              className="px-3 sm:px-6 py-2 bg-amber-400 text-black rounded-xl text-[10px] sm:text-xs font-bold uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-lg shadow-amber-400/20 h-9 sm:h-10"
            >
              ADMIN
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
