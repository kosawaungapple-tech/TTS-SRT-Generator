import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Key, Eye, EyeOff, Save, RefreshCw, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react';
import { GeminiTTSService } from '../services/geminiService';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (key: string, apiSwitch: 'admin' | 'personal') => void;
  onClear?: () => void;
  initialKey?: string;
  initialSwitch?: 'admin' | 'personal';
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ 
  isOpen, 
  onClose, 
  onSave, 
  onClear, 
  initialKey = '',
  initialSwitch = 'admin'
}) => {
  const [apiKey, setApiKey] = useState(initialKey);
  const [apiSwitch, setApiSwitch] = useState<'admin' | 'personal'>(initialSwitch);
  const [showKey, setShowKey] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validationStatus, setValidationStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (isOpen) {
      setApiKey(initialKey);
      setApiSwitch(initialSwitch);
      setValidationStatus('idle');
      setErrorMessage('');
    }
  }, [isOpen, initialKey, initialSwitch]);

  const handleClear = () => {
    if (onClear) {
      onClear();
      setApiKey('');
      setValidationStatus('idle');
    }
  };

  const handleSaveAndTest = async () => {
    // If Admin Key is selected, we don't need to validate the input key here 
    // as it uses the system key. We just save the preference.
    if (apiSwitch === 'admin') {
      setValidationStatus('success');
      onSave(apiKey.trim(), 'admin');
      setTimeout(() => {
        onClose();
      }, 1500);
      return;
    }

    if (!apiKey.trim()) {
      setValidationStatus('error');
      setErrorMessage('ကျေးဇူးပြု၍ API Key ထည့်သွင်းပါ။ (Please enter an API Key).');
      return;
    }

    setIsValidating(true);
    setValidationStatus('idle');
    
    try {
      const service = new GeminiTTSService(apiKey);
      const result = await service.verifyConnection();
      
      if (result.isValid) {
        setValidationStatus('success');
        onSave(apiKey.trim(), 'personal');
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
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white font-mono uppercase tracking-tighter">ဆက်တင်များ</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider font-mono">API CONFIGURATION</p>
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
              {/* API Switch */}
              <div className="space-y-3">
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 px-1 font-mono uppercase tracking-widest">
                  API Key အမျိုးအစား ရွေးချယ်ပါ
                </label>
                <div className="grid grid-cols-2 gap-3 p-1 bg-slate-100 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800">
                  <button
                    onClick={() => setApiSwitch('admin')}
                    className={`py-3 rounded-xl text-sm font-bold transition-all font-mono uppercase tracking-widest ${
                      apiSwitch === 'admin' 
                        ? 'bg-brand-purple text-white shadow-lg shadow-brand-purple/20' 
                        : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    စနစ်သုံး (Free)
                  </button>
                  <button
                    onClick={() => setApiSwitch('personal')}
                    className={`py-3 rounded-xl text-sm font-bold transition-all font-mono uppercase tracking-widest ${
                      apiSwitch === 'personal' 
                        ? 'bg-brand-purple text-white shadow-lg shadow-brand-purple/20' 
                        : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    ကိုယ်ပိုင် Key
                  </button>
                </div>
              </div>

              {apiSwitch === 'personal' && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="space-y-3 overflow-hidden"
                >
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 px-1 font-mono uppercase tracking-widest">
                    သင်၏ API Key ကို ဤနေရာတွင် ထည့်ပါ
                  </label>
                  <div className="relative group">
                    <input
                      type={showKey ? "text" : "password"}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="AIza... ဖြင့် စသော Key ကို ထည့်ပါ"
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
                    className="flex items-center gap-2 text-xs font-bold text-brand-purple hover:underline px-1 w-fit group font-mono uppercase tracking-widest"
                  >
                    API Key မရှိသေးပါက ဤနေရာတွင် ရယူပါ
                    <ExternalLink size={12} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                  </a>
                </motion.div>
              )}

              {apiSwitch === 'admin' && (
                <div className="p-4 bg-brand-purple/5 border border-brand-purple/10 rounded-2xl">
                  <p className="text-xs text-brand-purple font-medium leading-relaxed font-mono uppercase tracking-tight">
                    စနစ်သုံး Key ကို အသုံးပြုပါက အခမဲ့ အသုံးပြုနိုင်ပါသည်။
                  </p>
                </div>
              )}

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
                  <span className="text-sm font-bold font-mono uppercase tracking-tight">
                    {validationStatus === 'success' 
                      ? 'ဆက်တင်များကို သိမ်းဆည်းပြီးပါပြီ။' 
                      : errorMessage}
                  </span>
                </motion.div>
              )}

              <div className="flex gap-3">
                {onClear && initialKey && (
                  <button
                    onClick={handleClear}
                    className="flex-1 py-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-2xl font-bold text-lg transition-all hover:bg-red-500/10 hover:text-red-500 active:scale-[0.98] font-mono uppercase tracking-widest"
                  >
                    ဖျက်မည်
                  </button>
                )}
                <button
                  onClick={handleSaveAndTest}
                  disabled={isValidating}
                  className={`${onClear && initialKey ? 'flex-[2]' : 'w-full'} py-4 bg-brand-purple text-white rounded-2xl font-bold text-lg shadow-xl shadow-brand-purple/20 flex items-center justify-center gap-3 transition-all hover:bg-brand-purple/90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed font-mono uppercase tracking-widest btn-pulse`}
                >
                  {isValidating ? (
                    <RefreshCw size={22} className="animate-spin" />
                  ) : (
                    <Save size={22} />
                  )}
                  သိမ်းဆည်းမည်
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
