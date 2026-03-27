import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Key, Eye, EyeOff, Save, RefreshCw, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react';
import { GeminiTTSService } from '../services/geminiService';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (key: string) => void;
  onClear?: () => void;
  initialKey?: string;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ isOpen, onClose, onSave, onClear, initialKey = '' }) => {
  const [apiKey, setApiKey] = useState(initialKey);
  const [showKey, setShowKey] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validationStatus, setValidationStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (isOpen) {
      setApiKey(initialKey);
      setValidationStatus('idle');
      setErrorMessage('');
    }
  }, [isOpen, initialKey]);

  const handleClear = () => {
    if (onClear) {
      onClear();
      setApiKey('');
      setValidationStatus('idle');
    }
  };

  const handleSaveAndTest = async () => {
    if (!apiKey.trim()) {
      setValidationStatus('success');
      onSave('');
      setTimeout(() => {
        onClose();
      }, 1500);
      return;
    }

    setIsValidating(true);
    setValidationStatus('idle');
    
    try {
      const service = new GeminiTTSService(apiKey);
      const result = await service.verifyConnection();
      
      if (result.isValid) {
        setValidationStatus('success');
        onSave(apiKey.trim());
        setTimeout(() => {
          onClose();
        }, 1500);
      } else {
        setValidationStatus('error');
        setErrorMessage('API Key မှားယွင်းနေပါသည်။ ပြန်စစ်ပေးပါ (Invalid API Key. Please check again).');
      }
    } catch (error) {
      setValidationStatus('error');
      setErrorMessage('An unexpected error occurred during verification.');
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-[#020617]/80 backdrop-blur-sm"
          />
          
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-[32px] shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
          >
            {/* Header */}
            <div className="px-8 py-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-brand-purple/10 rounded-xl flex items-center justify-center text-brand-purple">
                  <Key size={20} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">ဆက်တင်များ (Settings)</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider">API Configuration</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-slate-200 dark:hover:bg-white/10 rounded-full transition-colors text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="p-8 space-y-6">
              <div className="space-y-3">
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 px-1">
                  သင်၏ API Key ကို ဤနေရာတွင် ထည့်ပါ (Google AI Studio API Key)
                </label>
                <div className="relative group">
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Paste your API Key here (starts with AIza...)"
                    className={`w-full bg-slate-50 dark:bg-slate-950 border rounded-2xl px-6 py-4 text-lg font-mono transition-all pr-14 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 text-slate-900 dark:text-white placeholder:text-slate-400 ${
                      !apiKey.trim() 
                        ? 'border-red-500/50' 
                        : 'border-slate-200 dark:border-slate-800'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-brand-purple transition-colors"
                  >
                    {showKey ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
                
                <a 
                  href="https://aistudio.google.com/app/apikey" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs font-bold text-brand-purple hover:underline px-1 w-fit group"
                >
                  How to get a free API Key?
                  <ExternalLink size={12} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                </a>
              </div>

              {validationStatus !== 'idle' && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`p-4 rounded-2xl border flex items-center gap-3 ${
                    validationStatus === 'success' 
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400' 
                      : 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400'
                  }`}
                >
                  {validationStatus === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                  <span className="text-sm font-bold">
                    {validationStatus === 'success' 
                      ? 'ဆက်တင်များကို သိမ်းဆည်းပြီးပါပြီ။ Website ကို ပြန်ဖွင့်ပါမည်။ (Settings saved. Reloading page...)' 
                      : errorMessage}
                  </span>
                </motion.div>
              )}

              <div className="flex gap-3">
                {onClear && initialKey && (
                  <button
                    onClick={handleClear}
                    className="flex-1 py-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-2xl font-bold text-lg transition-all hover:bg-red-500/10 hover:text-red-500 active:scale-[0.98]"
                  >
                    ဖျက်မည် (Clear Key)
                  </button>
                )}
                <button
                  onClick={handleSaveAndTest}
                  disabled={isValidating}
                  className={`${onClear && initialKey ? 'flex-[2]' : 'w-full'} py-4 bg-brand-purple text-white rounded-2xl font-bold text-lg shadow-xl shadow-brand-purple/20 flex items-center justify-center gap-3 transition-all hover:bg-brand-purple/90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {isValidating ? (
                    <RefreshCw size={22} className="animate-spin" />
                  ) : (
                    <Save size={22} />
                  )}
                  သိမ်းဆည်းမည် (Save & Test)
                </button>
              </div>
            </div>
            
            {/* Footer Info */}
            <div className="px-8 py-4 bg-slate-50 dark:bg-white/[0.02] border-t border-slate-100 dark:border-slate-800">
              <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center uppercase tracking-widest font-bold">
                Your API Key is stored locally and never sent to our servers.
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
