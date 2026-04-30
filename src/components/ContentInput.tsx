import React, { useState, useRef, useEffect } from 'react';
import { Trash2, Clipboard, Sparkles, RefreshCw, Check, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GeminiTTSService } from '../services/geminiService';
import { useLanguage } from '../contexts/LanguageContext';
import { translateError } from '../utils/errorUtils';
import { estimateMyanmarDuration, formatMyanmarDuration } from '../utils/audioUtils';

interface ContentInputProps {
  text: string;
  setText: (text: string) => void;
  getApiKey: () => string | null;
  showToast: (message: string, type: 'success' | 'error') => void;
  engineStatus: 'ready' | 'cooling' | 'limit';
  retryCountdown: number;
  speed: number;
  hasResult?: boolean;
}

export const ContentInput: React.FC<ContentInputProps> = ({ 
  text, 
  setText, 
  getApiKey, 
  showToast,
  engineStatus,
  retryCountdown,
  speed,
  hasResult
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
        const gemini = new GeminiTTSService(trimmedApiKey);
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
    <div className="premium-glass rounded-[32px] p-8 sm:p-12 shadow-2xl transition-all duration-300 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-64 h-64 bg-brand-purple/5 blur-[100px] -z-10" />
      
      {/* VPN NOTICE - COMMANDER ORDER */}
      <AnimatePresence>
        {showVpnNotice && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="mb-8"
          >
            <div className="bg-rose-500/10 border-2 border-rose-500/30 rounded-2xl p-5 flex items-center justify-between gap-4 shadow-[0_0_30px_rgba(244,63,94,0.15)] group hover:border-rose-500/50 transition-all duration-300">
              <div className="flex items-center gap-4">
                <div className="p-2.5 bg-rose-500/20 rounded-xl text-rose-500 animate-pulse border border-rose-500/30">
                  <Info size={20} />
                </div>
                <div className="flex flex-col">
                  <p className="text-[13px] font-black text-rose-500 uppercase tracking-tight leading-tight">
                    ပိုမိုမြန်ဆန်စေရန် VPN ဖွင့်၍ အသုံးပြုပေးပါ
                  </p>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1 opacity-80">
                    Use VPN for faster AI Narration processing
                  </p>
                </div>
              </div>
              <button 
                onClick={dismissVpnNotice}
                className="p-2 hover:bg-rose-500/10 rounded-lg text-rose-500/50 hover:text-rose-500 transition-colors"
              >
                <RefreshCw size={14} className="rotate-45" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 mb-8">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold flex items-center gap-4 text-slate-900 dark:text-white tracking-tight">
            <div className="p-2.5 bg-brand-purple/10 rounded-xl text-brand-purple">
              <Clipboard size={24} />
            </div>
            {t('generate.contentStudio')}
            <span className="text-[10px] bg-brand-purple/20 text-brand-purple px-3 py-1 rounded-full font-bold tracking-[0.15em] uppercase">
              {t('generate.aiPowered')}
            </span>
          </h2>
          <div className="flex items-center gap-2 px-1 mt-2">
            <div className={`w-2 h-2 rounded-full ${status.dot} animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]`} />
            <span className={`text-[10px] font-bold uppercase tracking-widest ${status.color}`}>
              {status.label}
            </span>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 relative">
          <motion.button
            whileHover={{ scale: 1.05, boxShadow: '0 0 20px rgba(139, 92, 246, 0.4)' }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowStyleSelector(!showStyleSelector)}
            disabled={isRewriting || !text.trim() || currentStatus === 'cooling'}
            className="flex items-center gap-2 px-6 py-3 bg-brand-purple text-white rounded-xl text-xs font-bold hover:bg-brand-purple/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-brand-purple/30 min-w-[160px] justify-center metallic-btn"
          >
            {isRewriting ? (
              <div className="flex items-center gap-0.5 h-4">
                {[...Array(3)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="w-0.5 bg-white rounded-full"
                    animate={{
                      height: [4, 12, 4],
                    }}
                    transition={{
                      duration: 0.6,
                      repeat: Infinity,
                      delay: i * 0.1,
                    }}
                  />
                ))}
              </div>
            ) : (
              <Sparkles size={16} />
            )}
            {isRewriting 
              ? (currentStatus === 'cooling' ? `${t('generate.coolingDown')} (${currentCountdown}s)` : t('generate.rewriting')) 
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

          <div className="flex gap-2">
            <button
              onClick={handlePaste}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 transition-all transition-all"
            >
              <Clipboard size={16} /> {t('translator.copy').includes('စာသား') ? 'ထည့်သွင်းမည် (Paste)' : 'Paste'}
            </button>
            <button
              onClick={() => setText('')}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-rose-500/10 hover:text-rose-500 transition-all"
            >
              <Trash2 size={16} /> {t('history.clearScript')}
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
          className="w-full h-72 bg-slate-50/50 dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-[24px] p-6 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/30 focus:border-brand-purple/50 resize-none custom-scrollbar transition-all duration-300 font-medium leading-relaxed shadow-inner"
        />
        <div className="absolute top-4 right-4 flex gap-2">
          <button
            onClick={() => handleCopy(text)}
            disabled={!text}
            className="p-2.5 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200 dark:border-white/10 rounded-xl text-slate-500 hover:text-brand-purple hover:border-brand-purple/50 transition-all shadow-sm disabled:opacity-30"
            title={t('translator.copy')}
          >
            {isCopied ? <Check size={18} className="text-emerald-500" /> : <Clipboard size={18} />}
          </button>
        </div>
      </div>

      {/* Real-time Duration Estimate Label */}
      {!hasResult && (
        <div className="mt-2 px-1">
          <p className="text-[11px] font-bold text-slate-500 dark:text-slate-500 flex items-center gap-2 opacity-80">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-600" />
            {formattedDuration}
          </p>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <div className="flex-1">
          {currentStatus === 'limit' && (
            <motion.div 
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-[11px] font-bold text-rose-500 bg-rose-500/10 px-4 py-2 rounded-xl border border-rose-500/20 neon-glow-magenta"
            >
              {t('errors.rateLimit')}
            </motion.div>
          )}
        </div>
        <div className="px-4 py-1.5 bg-white/50 dark:bg-white/5 rounded-full border border-slate-200 dark:border-white/10 ml-4 shadow-sm">
          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-bold font-mono uppercase tracking-widest">
            {text.length} {t('generate.characters')}
          </span>
        </div>
      </div>
    </div>
  );
};
