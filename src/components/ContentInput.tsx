import React, { useState } from 'react';
import { Trash2, Clipboard, Sparkles, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import { GeminiTTSService } from '../services/geminiService';

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
  const [isRewriting, setIsRewriting] = useState(false);
  const [localEngineStatus, setLocalEngineStatus] = useState<'ready' | 'cooling' | 'limit'>('ready');
  const [localRetryCountdown, setLocalRetryCountdown] = useState(0);

  const handlePaste = async () => {
    try {
      const clipboardText = await navigator.clipboard.readText();
      setText(text + clipboardText);
    } catch (err) {
      console.error('Failed to read clipboard');
    }
  };

  const handleRewrite = async (retryAttempt = 0) => {
    if (!text.trim()) return;
    
    const apiKey = getApiKey();
    
    if (!apiKey) {
      showToast('ကျေးဇူးပြု၍ Settings တွင် API Key အရင်ထည့်သွင်းပါ။ (No API Key found. Please add one in Settings.)', 'error');
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
        showToast('စာသားကို အောင်မြင်စွာ ပြန်လည်ရေးသားပြီးပါပြီ။ (Text rewritten successfully!)', 'success');
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
          showToast(err.message || 'Rewrite failed. Please check your connection.', 'error');
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
      case 'ready': return { label: 'Engine: Ready', color: 'text-emerald-500', dot: 'bg-emerald-500' };
      case 'cooling': return { label: 'Engine: Cooling Down', color: 'text-amber-500', dot: 'bg-amber-500' };
      case 'limit': return { label: 'Engine: Limit Reached', color: 'text-rose-500', dot: 'bg-rose-500' };
      default: return { label: 'Engine: Ready', color: 'text-emerald-500', dot: 'bg-emerald-500' };
    }
  };

  const status = getStatusLabel();

  return (
    <div className="glass-card rounded-[24px] p-6 sm:p-8 shadow-2xl transition-all duration-300 relative overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 mb-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold flex items-center gap-3 text-slate-900 dark:text-white">
            <div className="p-2 bg-brand-purple/10 rounded-lg text-brand-purple">
              <Clipboard size={20} />
            </div>
            Content Input
            <span className="text-[10px] bg-brand-purple/20 text-brand-purple px-2.5 py-1 rounded-full font-bold tracking-wider">
              MY / EN / ZH
            </span>
          </h2>
          <div className="flex items-center gap-2 px-1 mt-1">
            <div className={`w-2 h-2 rounded-full ${status.dot} animate-pulse`} />
            <span className={`text-[10px] font-bold uppercase tracking-widest ${status.color}`}>
              {status.label}
            </span>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => handleRewrite(0)}
            disabled={isRewriting || !text.trim() || currentStatus === 'cooling'}
            className="flex items-center gap-2 px-5 py-2.5 bg-brand-purple text-white rounded-[14px] text-xs font-bold hover:bg-brand-purple/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-brand-purple/30 active:scale-95 min-w-[140px] justify-center"
          >
            {isRewriting ? (
              <RefreshCw size={16} className="animate-spin" />
            ) : (
              <Sparkles size={16} />
            )}
            {isRewriting 
              ? (currentStatus === 'cooling' ? `Cooling down... (${currentCountdown}s)` : 'Rewriting...') 
              : 'Rewrite with AI'}
          </button>

          <div className="h-6 w-[1px] bg-slate-200 dark:bg-slate-800 hidden sm:block mx-1" />

          <div className="flex gap-2">
            <button
              onClick={handlePaste}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 transition-all"
            >
              <Clipboard size={16} /> Paste
            </button>
            <button
              onClick={() => setText('')}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-rose-500/10 hover:text-rose-500 transition-all"
            >
              <Trash2 size={16} /> Clear
            </button>
          </div>
        </div>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="စာသားများကို ဤနေရာတွင် ရိုက်ထည့်ပါ... (Enter text here...)"
        className="w-full h-72 bg-slate-50/50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-[20px] p-6 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 resize-none custom-scrollbar transition-all duration-300 font-medium leading-relaxed"
      />

      <div className="mt-4 flex items-center justify-between">
        <div className="flex-1">
          {currentStatus === 'limit' && (
            <motion.div 
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-[11px] font-bold text-rose-500 bg-rose-500/10 px-4 py-2 rounded-xl border border-rose-500/20"
            >
              Your API Key has reached its temporary limit. The system will resume shortly.
            </motion.div>
          )}
        </div>
        <div className="px-3 py-1 bg-slate-100 dark:bg-white/5 rounded-full border border-slate-200 dark:border-white/5 ml-4">
          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-bold font-mono uppercase tracking-widest">
            {text.length} characters
          </span>
        </div>
      </div>
    </div>
  );
};
