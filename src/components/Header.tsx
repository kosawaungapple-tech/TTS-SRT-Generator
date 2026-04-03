import React, { useState, useRef, useEffect } from 'react';
import { Sun, Moon, Settings, Mic2, User, ChevronDown, LogOut, ShieldCheck, Calendar, UserCircle } from 'lucide-react';
import { AuthorizedUser } from '../types';

interface HeaderProps {
  isDarkMode: boolean;
  toggleTheme: () => void;
  onOpenTools: () => void;
  isAccessGranted: boolean;
  isAdmin: boolean;
  onLogout: () => void;
  profile: AuthorizedUser | null;
}

export const Header: React.FC<HeaderProps> = ({ 
  isDarkMode, 
  toggleTheme, 
  onOpenTools,
  isAccessGranted,
  isAdmin,
  onLogout,
  profile
}) => {
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'N/A';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-GB'); // DD/MM/YYYY
    } catch (e) {
      return dateStr;
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-[#020617]/80 backdrop-blur-md transition-colors duration-300">
      <div className="container mx-auto px-3 sm:px-4 h-16 flex items-center justify-between">
        <div 
          className="flex items-center gap-1.5 sm:gap-2 cursor-pointer"
          onClick={() => {
            window.history.pushState({}, '', '/');
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
        >
          <div className="w-8 h-8 sm:w-10 sm:h-10 bg-brand-purple rounded-lg sm:rounded-xl flex items-center justify-center shadow-lg shadow-brand-purple/20">
            <Mic2 className="text-white w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-sm sm:text-xl font-bold tracking-tight text-slate-900 dark:text-white leading-none">
              Vlogs By Saw
            </h1>
            <p className="text-[8px] sm:text-[10px] uppercase tracking-widest text-brand-purple font-semibold mt-0.5">
              Narration Engine
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-3">
          <button
            onClick={toggleTheme}
            className="p-1.5 sm:p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 transition-colors text-slate-500 dark:text-slate-400"
            title="Toggle Theme"
          >
            {isDarkMode ? <Sun size={16} className="sm:w-5 sm:h-5 text-amber-400" /> : <Moon size={16} className="sm:w-5 sm:h-5 text-slate-700" />}
          </button>
          {isAccessGranted && (
            <div className="flex items-center gap-1.5 sm:gap-3">
              {isAdmin && (
                <button 
                  onClick={() => {
                    window.history.pushState({}, '', '/vbs-admin');
                    window.dispatchEvent(new PopStateEvent('popstate'));
                  }}
                  className="px-2 py-1 sm:px-3 sm:py-1.5 bg-brand-purple/10 dark:bg-brand-purple/20 text-brand-purple border border-brand-purple/20 dark:border-brand-purple/30 rounded-lg text-[8px] sm:text-[10px] font-bold uppercase hover:bg-brand-purple hover:text-white transition-all"
                >
                  Admin
                </button>
              )}
              <button 
                onClick={onOpenTools}
                className="p-1.5 sm:p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 transition-colors text-slate-500 dark:text-slate-400"
                title="Settings"
              >
                <Settings size={16} className="sm:w-5 sm:h-5" />
              </button>
              
              {/* User Profile Dropdown */}
              <div className="relative" ref={dropdownRef}>
                <button 
                  onClick={() => setIsProfileOpen(!isProfileOpen)}
                  className="flex items-center gap-1 sm:gap-2 p-1 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 transition-all border border-transparent hover:border-slate-200 dark:hover:border-white/10"
                >
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-gradient-to-br from-brand-purple to-purple-700 flex items-center justify-center text-white shadow-lg shadow-brand-purple/20">
                    <User size={14} className="sm:w-[18px] sm:h-[18px]" />
                  </div>
                  <ChevronDown size={12} className={`text-slate-400 transition-transform duration-300 ${isProfileOpen ? 'rotate-180' : ''}`} />
                </button>

                {isProfileOpen && (
                  <div className="absolute right-0 mt-3 w-72 bg-white/90 dark:bg-[#0f172a]/90 backdrop-blur-xl border border-slate-200 dark:border-white/10 rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200 z-[60]">
                    <div className="p-6">
                      {/* User Info */}
                      <div className="flex items-center gap-4 mb-6">
                        <div className="w-12 h-12 rounded-2xl bg-brand-purple/10 flex items-center justify-center text-brand-purple">
                          <UserCircle size={32} />
                        </div>
                        <div className="overflow-hidden">
                          <h3 className="font-bold text-slate-900 dark:text-white truncate">
                            {profile?.note || profile?.label || 'Saw User'}
                          </h3>
                          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-500">
                            <ShieldCheck size={12} />
                            အကောင့်အခြေအနေ: Active
                          </div>
                        </div>
                      </div>

                      {/* Details */}
                      <div className="space-y-3 mb-6">
                        <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5">
                          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                            <Calendar size={14} />
                            သက်တမ်းကုန်ဆုံးရက်
                          </div>
                          <div className="text-xs font-bold text-slate-900 dark:text-white">
                            {formatDate(profile?.expiryDate)}
                          </div>
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
                          Sign Out
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
