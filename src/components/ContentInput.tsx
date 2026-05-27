import React, { useState, useRef, useEffect } from 'react';
import { Trash2, Clipboard, Sparkles, RefreshCw, Check, Info, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GeminiTTSService } from '../services/geminiService';
import { apiChannelManager } from '../services/apiChannelManager';
import { useLanguage } from '../contexts/LanguageContext';
import { translateError } from '../utils/errorUtils';
import { estimateMyanmarDuration, formatMyanmarDuration } from '../utils/audioUtils';

import { VBSUserControl } from '../types';
import { checkAndDeductCredits } from '../services/creditService';

interface ContentInputProps {
  text: string;
  setText: (text: string) => void;
  getApiKey: () => string | null;
  showToast: (message: string, type: 'success' | 'error') => void;
  engineStatus: 'ready' | 'cooling' | 'limit';
  retryCountdown: number;
  speed: number;
  hasResult?: boolean;
  isAdmin: boolean;
  userControl: VBSUserControl | null;
  isSharedKey: boolean;
  rewriteCost?: number;
}

export const ContentInput: React.FC<ContentInputProps> = ({ 
  text, 
  setText, 
  getApiKey, 
  showToast,
  engineStatus,
  retryCountdown,
  speed,
  hasResult,
  isAdmin,
  userControl,
  isSharedKey
}) => {
  const { language, t } = useLanguage();
  const [isRewriting, setIsRewriting] = useState(false);
  const [showStyleSelector, setShowStyleSelector] = useState(false);
  const [localEngineStatus, setLocalEngineStatus] = useState<'ready' | 'cooling' | 'limit'>('ready');
  const [localRetryCountdown, setLocalRetryCountdown] = useState(0);
  const [isCopied, setIsCopied] = useState(false);
  const [showVpnNotice, setShowVpnNotice] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Storage key for vpn notice
  const VPN_NOTICE_KEY = 'vbs_vpn_notice_dismissed';

  useEffect(() => {
    const dismissed = localStorage.getItem(VPN_NOTICE_KEY) === 'true';
    if (dismissed) setShowVpnNotice(false);
  }, []);

  const dismissVpnNotice = () => {
    setShowVpnNotice(false);
    localStorage.setItem(VPN_NOTICE_KEY, 'true');
  };

  const handleCopy = async (textToCopy: string) => {
    try {
      await navigator.clipboard.writeText(textToCopy);
      setIsCopied(true);
      showToast(t('generate.copySuccess'), 'success');
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      console.error('Failed to copy text');
    }
  };

  const handlePaste = async () => {
    try {
      const clipboardText = await navigator.clipboard.readText();
      setText(text + clipboardText);
      showToast(t('generate.pasteSuccess'), 'success');
    } catch {
      console.error('Failed to read clipboard');
    }
  };

  const handleRewrite = async (style: 'conversational' | 'storytelling' | 'news' | 'poetic' | 'educational' = 'conversational', retryAttempt = 0) => {
    if (!text.trim()) return;
    
    const apiKey = getApiKey();
    const trimmedApiKey = (apiKey || '').trim();
    
    if (!trimmedApiKey) {
      showToast(t('generate.noApiKey'), 'error');
      return;
    }

    setIsRewriting(true);
    setShowStyleSelector(false);
    setLocalEngineStatus('ready');

    const runRewrite = async (attempt: number): Promise<void> => {
      try {
        // Credit Check - Only if using shared admin key
        if (!isAdmin && isSharedKey && userControl?.vbsId) {
          const creditResult = await checkAndDeductCredits(userControl.vbsId, 'rewrite');
          if (!creditResult.success) {
            showToast(creditResult.message || "Credit ကုန်ဆုံးသွားပါပြီ။", 'error');
            setIsRewriting(false);
            return;
          }
        }

        const useManaged = isAdmin || apiChannelManager.getSettings().useAdminKeys;
        const gemini = new GeminiTTSService(useManaged ? '' : trimmedApiKey, isAdmin);
        const rewrittenText = await gemini.rewriteContent(text, style);
        
        setText(rewrittenText);
        setLocalEngineStatus('ready');
        showToast(t('generate.rewriteSuccess'), 'success');
      } catch (err: unknown) {
        console.error('Rewriting failed:', err);
        const error = err as { message?: string; status?: number };
        const isRateLimit = error.message === 'RATE_LIMIT_EXHAUSTED' || 
                          (error.status === 429) || 
                          (error.message && error.message.includes('429'));

        if (isRateLimit && attempt < 1) {
          setLocalEngineStatus('cooling');
          setLocalRetryCountdown(10);
          
          const timer = setInterval(() => {
            setLocalRetryCountdown(prev => {
              if (prev <= 1) {
                clearInterval(timer);
                return 0;
              }
              return prev - 1;
            });
          }, 1000);

          setTimeout(() => {
            runRewrite(attempt + 1);
          }, 10000);
          return;
        }

        if (isRateLimit) {
          setLocalEngineStatus('limit');
          showToast(translateError(err, language), 'error');
        } else {
          showToast(translateError(err, language), 'error');
        }
      } 
    };

    await runRewrite(retryAttempt);
    setIsRewriting(false);
  };

  const REWRITE_STYLES = [
    { id: 'conversational', name: 'နားထောင်ရလွယ်', description: 'Conversational, natural speech', icon: <Sparkles size={14} />, color: 'bg-emerald-500/10 text-emerald-500' },
    { id: 'storytelling', name: 'ဇာတ်လမ်းပြော', description: 'Engaging narrative flow', icon: <Clipboard size={14} />, color: 'bg-blue-500/10 text-blue-500' },
    { id: 'news', name: 'သတင်းထောက်', description: 'Clear and authoritative', icon: <Info size={14} />, color: 'bg-indigo-500/10 text-indigo-500' },
    { id: 'poetic', name: 'ကဗျာဆန်', description: 'Rhythmic, beautiful language', icon: <Sparkles size={14} />, color: 'bg-rose-500/10 text-rose-500' },
    { id: 'educational', name: 'ကလေးသင်ခန်းစာ', description: 'Simple short sentences', icon: <RefreshCw size={14} />, color: 'bg-amber-500/10 text-amber-500' },
  ] as const;

  const currentStatus = engineStatus !== 'ready' ? engineStatus : localEngineStatus;
  const currentCountdown = retryCountdown > 0 ? retryCountdown : localRetryCountdown;

  const getStatusLabel = () => {
    switch (currentStatus) {
      case 'ready': return { label: t('generate.engineReady'), color: 'text-emerald-500', dot: 'bg-emerald-500' };
      case 'cooling': return { label: t('generate.engineCooling'), color: 'text-amber-500', dot: 'bg-amber-500' };
      case 'limit': return { label: t('generate.engineLimit'), color: 'text-rose-500', dot: 'bg-rose-500' };
      default: return { label: t('generate.engineReady'), color: 'text-emerald-500', dot: 'bg-emerald-500' };
    }
  };

  const status = getStatusLabel();

  // [REAL-TIME DURATION ESTIMATOR - COMMANDER ORDER]
  const estimatedSeconds = estimateMyanmarDuration(text, speed);
  const formattedDuration = language === 'mm' 
    ? `ခန့်မှန်းကြာချိန်: ~${formatMyanmarDuration(estimatedSeconds)}`
    : `Estimated Duration: ~${Math.floor(estimatedSeconds / 60)}m ${Math.round(estimatedSeconds % 60)}s`;

  return (
    <div className="bg-white/5 backdrop-blur-xl rounded-2xl sm:rounded-3xl p-4 sm:p-10 border border-white/10 shadow-2xl relative overflow-hidden group">
      <div className="absolute top-0 right-0 w-64 h-64 bg-amber-400/5 blur-[100px] -z-10 group-hover:bg-amber-400/10 transition-colors duration-1000" />
      
      {/* VPN NOTICE */}
      <AnimatePresence>
        {showVpnNotice && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="mb-6 sm:mb-8"
          >
            <div className="bg-amber-400/5 border border-amber-400/20 rounded-xl sm:rounded-2xl p-4 sm:p-6 flex items-center justify-between gap-4 shadow-xl relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-amber-400/5 to-transparent opacity-50" />
              <div className="flex items-center gap-3 sm:gap-5 relative z-10">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-amber-400 rounded-xl flex items-center justify-center text-black shadow-lg shadow-amber-400/20 shrink-0">
                  <Info size={20} className="sm:w-6 sm:h-6" />
                </div>
                <div className="flex flex-col">
                  <p className="text-xs sm:text-sm font-bold text-amber-500 uppercase tracking-widest leading-relaxed">
                    ပိုမိုမြန်ဆန်စေရန် VPN ဖွင့်၍ အသုံးပြုပေးပါ
                  </p>
                  <p className="text-[9px] sm:text-[10px] text-slate-500 font-medium uppercase tracking-widest mt-0.5">
                    Use VPN for professional-grade processing speeds
                  </p>
                </div>
              </div>
              <button 
                onClick={dismissVpnNotice}
                className="p-1 sm:p-2 hover:bg-white/10 rounded-xl text-slate-500 hover:text-white transition-all relative z-10"
              >
                <X size={18} className="sm:w-5 sm:h-5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-6 sm:mb-8">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              {t('generate.contentStudio')}
            </h2>
            <div className="flex items-center gap-2 px-2.5 py-1 bg-white/5 rounded-full border border-white/10">
              <div className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
              <span className={`text-[9px] sm:text-[10px] font-bold uppercase tracking-wider ${status.color}`}>
                {status.label}
              </span>
            </div>
          </div>
        </div>
        
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 relative">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowStyleSelector(!showStyleSelector)}
            disabled={isRewriting || !text.trim() || currentStatus === 'cooling'}
            className="flex items-center gap-2 px-6 py-3.5 sm:py-3 bg-amber-400 text-black rounded-xl text-[10px] sm:text-xs font-bold uppercase tracking-widest transition-all disabled:opacity-50 disabled:grayscale shadow-lg shadow-amber-400/20 w-full sm:min-w-[180px] justify-center"
          >
            {isRewriting ? (
              <RefreshCw size={16} className="animate-spin sm:w-4.5 sm:h-4.5" />
            ) : (
              <Sparkles size={16} className="sm:w-4.5 sm:h-4.5" />
            )}
            {isRewriting 
              ? (currentStatus === 'cooling' ? `${t('generate.coolingDown')} (${currentCountdown}s)` : 'PROCESSING...') 
              : t('generate.rewriteBtn')}
          </motion.button>

          {/* Style Selector Popup */}
          <AnimatePresence>
            {showStyleSelector && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className="absolute top-full left-0 mt-3 p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl z-50 min-w-[240px]"
              >
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2 mb-2">
                  Select Writing Style
                </div>
                <div className="flex flex-col gap-1">
                  {REWRITE_STYLES.map((style) => (
                    <button
                      key={style.id}
                      onClick={() => handleRewrite(style.id)}
                      className="flex items-center gap-3 p-3 hover:bg-slate-50 dark:hover:bg-white/5 rounded-xl transition-all text-left group"
                    >
                      <div className={`p-2 rounded-lg ${style.color} group-hover:scale-110 transition-transform`}>
                        {style.icon}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-800 dark:text-white">{style.name}</div>
                        <div className="text-[9px] text-slate-500 font-medium">{style.description}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="h-6 w-[1px] bg-slate-200 dark:bg-slate-800 hidden sm:block mx-1" />

          <div className="flex flex-wrap gap-2 justify-end sm:justify-start">
            <button
              onClick={handlePaste}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] sm:text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 transition-all"
            >
              <Clipboard size={14} className="sm:w-4 sm:h-4" /> {t('translator.copy').includes('စာသား') ? 'ထည့်သွင်းမည် (Paste)' : 'Paste'}
            </button>
            <button
              onClick={() => setText('')}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] sm:text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-rose-500/10 hover:text-rose-500 transition-all"
            >
              <Trash2 size={14} className="sm:w-4 sm:h-4" /> {t('history.clearScript')}
            </button>
          </div>
        </div>
      </div>

      <div className="relative group/textarea">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('generate.inputPlaceholder')}
          className="w-full h-64 sm:h-80 bg-black/40 border border-white/5 rounded-xl sm:rounded-2xl p-4 sm:p-6 text-sm sm:text-base text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-400/30 focus:border-amber-400/50 resize-none custom-scrollbar transition-all duration-300 font-medium leading-relaxed"
        />
        <div className="absolute top-4 right-4 flex gap-2">
          <button
            onClick={() => handleCopy(text)}
            disabled={!text}
            className="p-2.5 bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl text-slate-400 hover:text-amber-400 hover:border-amber-400/50 transition-all shadow-xl disabled:opacity-20"
            title={t('translator.copy')}
          >
            {isCopied ? <Check size={20} className="text-emerald-500" /> : <Clipboard size={20} />}
          </button>
        </div>
      </div>

      {/* Real-time Duration Estimate Label */}
      {!hasResult && (
        <div className="mt-4">
          <p className="text-[11px] font-bold text-slate-500 flex items-center gap-2 uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            {formattedDuration}
          </p>
        </div>
      )}

      <div className="mt-8 flex items-center justify-between">
        <div className="flex-1">
          {currentStatus === 'limit' && (
            <motion.div 
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-[11px] font-black text-rose-500 bg-rose-500/10 px-6 py-3 rounded-2xl border border-rose-500/20 uppercase tracking-widest shadow-[0_0_20px_rgba(244,63,94,0.1)]"
            >
              {t('errors.rateLimit')}
            </motion.div>
          )}
        </div>
        <div className="px-5 py-2 bg-white/5 rounded-full border border-white/5 ml-4 shadow-xl">
          <span className="text-[10px] text-slate-500 font-black font-mono uppercase tracking-[0.2em]">
            {text.length} {t('generate.characters')}
          </span>
        </div>
      </div>
    </div>
  );
};
