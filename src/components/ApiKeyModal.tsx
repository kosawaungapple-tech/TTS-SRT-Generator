import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Key, Eye, EyeOff, Save, RefreshCw, CheckCircle2, AlertCircle, ExternalLink, ShieldCheck, User } from 'lucide-react';
import { safeLocation } from '../utils/safeBrowser';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (key: string) => void;
  onClear?: () => void;
  initialKey?: string;
  initialMode?: 'admin' | 'personal';
  onSaveMode?: (mode: 'admin' | 'personal') => void;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ 
  isOpen, 
  onClose, 
  onSave, 
  onClear, 
  initialKey = '',
  initialMode = 'admin',
  onSaveMode
}) => {
  const [apiKey, setApiKey] = useState(initialKey);
  const [apiKeyMode, setApiKeyMode] = useState<'admin' | 'personal'>(initialMode);
  const [showKey, setShowKey] = useState(false);
  const [validationStatus, setValidationStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (isOpen) {
      setApiKey(initialKey);
      setApiKeyMode(initialMode);
      setValidationStatus('idle');
      setErrorMessage('');
    }
  }, [isOpen, initialKey, initialMode]);

  const handleClear = () => {
    if (onClear) {
      onClear();
      setApiKey('');
      setValidationStatus('idle');
    }
  };

  const handleSaveAndTest = () => {
    // If Admin mode is selected, we just save the mode and close
    if (apiKeyMode === 'admin') {
      if (onSaveMode) onSaveMode('admin');
    } else {
      // Personal mode - Force save without validation as requested
      if (onSaveMode) onSaveMode('personal');
      onSave(apiKey.trim());
    }

    setValidationStatus('success');
    setTimeout(() => {
      onClose();
      // Reload to apply changes if needed, or just let App state handle it
      safeLocation.reload();
    }, 1000);
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
            <div className="p-8 space-y-8">
              {/* API Mode Toggle Switch */}
              <div className="bg-slate-50 dark:bg-white/[0.02] border border-slate-100 dark:border-slate-800 rounded-3xl p-6 space-y-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1">
                      Use Admin's Global API Key
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      When ON, you use the system's shared quota. When OFF, you must provide your own API Key.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const newMode = apiKeyMode === 'admin' ? 'personal' : 'admin';
                      setApiKeyMode(newMode);
                      setValidationStatus('idle');
                      setErrorMessage('');
                    }}
                    className={`relative w-14 h-8 rounded-full transition-all duration-300 shrink-0 ${
                      apiKeyMode === 'admin' ? 'bg-brand-purple' : 'bg-slate-300 dark:bg-slate-700'
                    }`}
                  >
                    <motion.div
                      animate={{ x: apiKeyMode === 'admin' ? 28 : 4 }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                      className="absolute top-1 w-6 h-6 bg-white rounded-full shadow-lg"
                    />
                  </button>
                </div>
              </div>

              <AnimatePresence mode="wait">
                {apiKeyMode === 'personal' ? (
                  <motion.div
                    key="personal-input"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-3 overflow-hidden"
                  >
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
                  </motion.div>
                ) : (
                  <motion.div
                    key="admin-info"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="p-5 bg-brand-purple/5 rounded-2xl border border-brand-purple/10 space-y-2"
                  >
                    <div className="flex items-center gap-2 text-brand-purple">
                      <ShieldCheck size={18} />
                      <span className="font-bold text-sm">Admin Key Mode Active</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      Admin Key ကို အသုံးပြုပါက သင်ကိုယ်တိုင် API Key ထည့်ရန် မလိုပါ။ Admin မှ ပေးထားသော Key ကို အသုံးပြု၍ အခမဲ့ အသုံးပြုနိုင်ပါသည်။
                      (Using Admin Key means you don't need to provide your own. You can use the app for free using the system key).
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

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
                      ? 'Gemini API Key ကို သိမ်းဆည်းပြီးပါပြီ။ ✅' 
                      : errorMessage}
                  </span>
                </motion.div>
              )}

              <div className="flex gap-3">
                {onClear && initialKey && apiKeyMode === 'personal' && (
                  <button
                    onClick={handleClear}
                    className="flex-1 py-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-2xl font-bold text-lg transition-all hover:bg-red-500/10 hover:text-red-500 active:scale-[0.98]"
                  >
                    ဖျက်မည် (Clear Key)
                  </button>
                )}
                <button
                  onClick={handleSaveAndTest}
                  className={`${onClear && initialKey && apiKeyMode === 'personal' ? 'flex-[2]' : 'w-full'} py-4 bg-brand-purple text-white rounded-2xl font-bold text-lg shadow-xl shadow-brand-purple/20 flex items-center justify-center gap-3 transition-all hover:bg-brand-purple/90 active:scale-[0.98]`}
                >
                  <Save size={22} />
                  သိမ်းဆည်းမည် (Save & Apply)
                </button>
              </div>
            </div>
            
            {/* Footer Info */}
            <div className="px-8 py-4 bg-slate-50 dark:bg-white/[0.02] border-t border-slate-100 dark:border-slate-800">
              <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center uppercase tracking-widest font-bold">
                {apiKeyMode === 'personal' 
                  ? "Your API Key is stored locally and never sent to our servers."
                  : "Using Admin's Global API Key for all generations."}
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
