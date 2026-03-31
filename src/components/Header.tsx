import React from 'react';
import { Sun, Moon, Settings, Mic2, LogOut } from 'lucide-react';

import { safeHistory } from '../utils/safeBrowser';

interface HeaderProps {
  isDarkMode: boolean;
  toggleTheme: () => void;
  onOpenTools: () => void;
  isAccessGranted: boolean;
  onLogout: () => void;
  isAdminRoute?: boolean;
  isAdmin?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ 
  isDarkMode, 
  toggleTheme, 
  onOpenTools,
  isAccessGranted,
  onLogout,
  isAdminRoute = false,
  isAdmin = false
}) => {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-[#020617]/80 backdrop-blur-md transition-colors duration-300">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-brand-purple rounded-xl flex items-center justify-center shadow-lg shadow-brand-purple/20">
            <Mic2 className="text-white w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                Vlogs By Saw
              </h1>
            </div>
            <p className="text-[10px] uppercase tracking-widest text-brand-purple font-semibold">
              Narration Engine
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 transition-colors text-slate-500 dark:text-slate-400 flex items-center justify-center"
            title="Toggle Theme"
          >
            {isDarkMode ? <Sun size={18} className="sm:w-5 sm:h-5 text-amber-400" /> : <Moon size={18} className="sm:w-5 sm:h-5 text-slate-700" />}
          </button>
          {isAccessGranted && (
            <div className="flex items-center gap-2 sm:gap-3">
              {isAdmin && (
                <>
                  <button 
                    onClick={() => {
                      if (isAdminRoute) {
                        safeHistory.pushState({}, '', '/');
                      } else {
                        safeHistory.pushState({}, '', '/vbs-admin');
                      }
                      try {
                        window.dispatchEvent(new PopStateEvent('popstate'));
                      } catch (e) {
                        // Ignore dispatch errors
                      }
                    }}
                    className="px-2 py-1 sm:px-3 sm:py-1.5 bg-brand-purple/10 dark:bg-brand-purple/20 text-brand-purple border border-brand-purple/20 dark:border-brand-purple/30 rounded-lg text-[9px] sm:text-[10px] font-bold uppercase hover:bg-brand-purple hover:text-white transition-all"
                  >
                    {isAdminRoute ? 'Back to App' : 'Admin'}
                  </button>
                  <button 
                    onClick={onOpenTools}
                    className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 transition-colors text-slate-500 dark:text-slate-400 flex items-center justify-center"
                    title="Settings"
                  >
                    <Settings size={18} className="sm:w-5 sm:h-5" />
                  </button>
                </>
              )}
              <div className="flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-slate-800">
                <button 
                  onClick={onLogout}
                  className="flex items-center gap-1.5 text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap"
                >
                  <LogOut size={14} className="sm:w-4 sm:h-4" />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
