import React, { useState } from 'react';
import { Trash2, Clipboard, Sparkles, RefreshCw, Check } from 'lucide-react';
import { motion } from 'motion/react';
import { GeminiTTSService } from '../services/geminiService';
import { useLanguage } from '../contexts/LanguageContext';

interface ContentInputProps {
  text: string;
  setText: (text: string) => void;
  isDarkMode: boolean;
  getApiKey: () => string | null;
  showToast: (message: string, type: 'success' | 'error') => void;
  engineStatus: 'ready' | 'cooling' | 'limit';
  retryCountdown: number;
}

export const ContentInput: React.FC<ContentInputProps> = ({ 
  text, 
  setText, 
  isDarkMode, 
  getApiKey, 
  showToast,
  engineStatus,
  retryCountdown
}) => {
  const { t } = useLanguage();
  const [isRewriting, setIsRewriting] = useState(false);
  const [localEngineStatus, setLocalEngineStatus] = useState<'ready' | 'cooling' | 'limit'>('ready');
  const [localRetryCountdown, setLocalRetryCountdown] = useState(0);

  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async (textToCopy: string) => {
    try {
      await navigator.clipboard.writeText(textToCopy);
      setIsCopied(true);
      showToast(t('generate.copySuccess'), 'success');
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text');
    }
  };

  const handlePaste = async () => {
    try {
      const clipboardText = await navigator.clipboard.readText();
      setText(text + clipboardText);
      showToast(t('generate.pasteSuccess'), 'success');
    } catch (err) {
      console.error('Failed to read clipboard');
    }
  };

  const handleRewrite = async (retryAttempt = 0) => {
    if (!text.trim()) return;
    
    const apiKey = getApiKey();
    
    if (!apiKey) {
      showToast(t('generate.noApiKey'), 'error');
      return;
    }

    setIsRewriting(true);
    setLocalEngineStatus('ready');

    const runRewrite = async (attempt: number): Promise<void> => {
      try {
        const gemini = new GeminiTTSService(apiKey);
        const rewrittenText = await gemini.rewriteContent(text);
        
        setText(rewrittenText);
        setLocalEngineStatus('ready');
        showToast(t('generate.rewriteSuccess'), 'success');
      } catch (err: any) {
        console.error('Rewriting failed:', err);
        const isRateLimit = err.message === 'RATE_LIMIT_EXHAUSTED' || 
                          (err.status === 429) || 
                          (err.message && err.message.includes('429'));

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
        } else {
          showToast(err.message || t('errors.generic'), 'error');
        }
      } finally {
        if (attempt >= 0) {
          // Keep isRewriting true during cooling
        }
      }
    };

    await runRewrite(retryAttempt);
    setIsRewriting(false);
  };

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

  return (
    <div className="premium-glass rounded-[32px] p-8 sm:p-12 shadow-2xl transition-all duration-300 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-64 h-64 bg-brand-purple/5 blur-[100px] -z-10" />
      
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
        
        <div className="flex flex-wrap items-center gap-3">
          <motion.button
            whileHover={{ scale: 1.05, boxShadow: '0 0 20px rgba(139, 92, 246, 0.4)' }}
            whileTap={{ scale: 0.95 }}
            onClick={() => handleRewrite(0)}
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
              <Trash2 size={16} /> {t('history.delete')}
            </button>
          </div>
        </div>
      </div>

      <div className="relative group/textarea">
        <textarea
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
