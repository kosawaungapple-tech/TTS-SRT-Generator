import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Key, Eye, EyeOff, Save, CheckCircle2, AlertCircle, ExternalLink, ShieldCheck } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { GeminiTTSService } from '../services/geminiService';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (keys: string[]) => void;
  onClear?: () => void;
  initialKey?: string;
  vbsId?: string | null;
  activeKeyIndex?: number;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ isOpen, onClose, onSave, onClear, initialKey = '', vbsId, activeKeyIndex = 0 }) => {
  const { t } = useLanguage();
  const [apiKeys, setApiKeys] = useState<string[]>(initialKey ? [initialKey] : ['']);
  const [showKeys, setShowKeys] = useState<boolean[]>([]);
  const [validationStatus, setValidationStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (isOpen) {
      const keys = initialKey ? initialKey.split(',').map(k => k.trim()).filter(k => k) : [''];
      setApiKeys(keys.length > 0 ? keys : ['']);
      setShowKeys(new Array(keys.length || 1).fill(false));
      setValidationStatus('idle');
      setErrorMessage('');
    }
  }, [isOpen, initialKey]);

  const handleAddField = () => {
    if (apiKeys.length < 5) {
      setApiKeys([...apiKeys, '']);
      setShowKeys([...showKeys, false]);
    }
  };

  const handleRemoveField = (index: number) => {
    const newKeys = apiKeys.filter((_, i) => i !== index);
    setApiKeys(newKeys.length > 0 ? newKeys : ['']);
    setShowKeys(showKeys.filter((_, i) => i !== index));
  };

  const handleValueChange = (index: number, value: string) => {
    const newKeys = [...apiKeys];
    newKeys[index] = value;
    setApiKeys(newKeys);
  };

  const toggleShowKey = (index: number) => {
    const newShow = [...showKeys];
    newShow[index] = !newShow[index];
    setShowKeys(newShow);
  };

  const handleClear = () => {
    if (onClear) {
      onClear();
      setApiKeys(['']);
      setValidationStatus('idle');
    }
  };

  const handleSaveAndTest = (e?: React.FormEvent | React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    const validKeys = apiKeys.map(k => k.trim()).filter(k => k);
    if (validKeys.length === 0) {
      onSave([]);
      onClose();
      return;
    }

    try {
      onSave(validKeys);
      setValidationStatus('success');
      setTimeout(() => {
        onClose();
      }, 600);
    } catch (err) {
      console.error("Save failed:", err);
      setValidationStatus('error');
      setErrorMessage("သိမ်းဆည်း၍ မရပါ။ (Save Failed)");
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
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">{t('keyModal.title')}</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider">{t('keyModal.config')}</p>
                </div>
              </div>
              <button 
                type="button"
                onClick={onClose}
                className="p-2 hover:bg-slate-200 dark:hover:bg-white/10 rounded-full transition-colors text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="p-8 space-y-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
              <form 
                onSubmit={handleSaveAndTest}
                className="space-y-6"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between px-1">
                    <label className="block text-sm font-bold text-slate-700 dark:text-slate-300">
                      {t('keyModal.label')}
                    </label>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded-full">
                      {apiKeys.length} / 5 Channels
                    </span>
                  </div>

                  <div className="space-y-3">
                    {apiKeys.map((key, index) => (
                      <div key={index} className="space-y-1">
                        <div className="flex items-center justify-between px-1">
                          <div className="flex items-center gap-2">
                             <div className={`w-1.5 h-1.5 rounded-full ${index === activeKeyIndex ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300 dark:bg-slate-700'}`} />
                             <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Channel {index + 1}</span>
                             {index === activeKeyIndex && (
                               <span className="text-[9px] bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5 rounded-md font-bold uppercase">သုံးနေသည်</span>
                             )}
                          </div>
                          {apiKeys.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveField(index)}
                              className="text-[10px] font-bold text-rose-500 hover:underline"
                            >
                              ဖျက်ရန်
                            </button>
                          )}
                        </div>
                        <div className="relative group">
                          <input
                            type={showKeys[index] ? "text" : "password"}
                            value={key}
                            onChange={(e) => handleValueChange(index, e.target.value)}
                            placeholder={t('keyModal.placeholder')}
                            className={`w-full bg-slate-50 dark:bg-slate-950 border rounded-2xl px-6 py-4 text-base font-mono transition-all pr-14 focus:outline-none focus:ring-2 focus:ring-brand-purple/50 text-slate-900 dark:text-white placeholder:text-slate-400 ${
                              !key.trim() && apiKeys.length === 1
                                ? 'border-red-500/50' 
                                : 'border-slate-200 dark:border-slate-800'
                            }`}
                          />
                          <button
                            type="button"
                            onClick={() => toggleShowKey(index)}
                            className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-brand-purple transition-colors"
                          >
                            {showKeys[index] ? <EyeOff size={18} /> : <Eye size={18} />}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {apiKeys.length < 5 && (
                    <button
                      type="button"
                      onClick={handleAddField}
                      className="w-full py-3 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl text-xs font-bold text-slate-400 hover:text-brand-purple hover:border-brand-purple/50 transition-all flex items-center justify-center gap-2"
                    >
                      + Add Another Key
                    </button>
                  )}
                  
                  <a 
                    href="https://aistudio.google.com/app/apikey" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-xs font-bold text-brand-purple hover:underline px-1 w-fit group"
                  >
                    {t('keyModal.getApiKey')}
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
                        ? t('keyModal.verifying')
                        : errorMessage}
                    </span>
                  </motion.div>
                )}

                <div className="flex gap-3">
                  {onClear && initialKey && (
                    <button
                      type="button"
                      onClick={handleClear}
                      className="flex-1 py-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-2xl font-bold text-lg transition-all hover:bg-red-500/10 hover:text-red-500 active:scale-[0.98]"
                    >
                      {t('keyModal.clear')}
                    </button>
                  )}
                  <button
                    type="submit"
                    className={`${onClear && initialKey ? 'flex-[2]' : 'w-full'} py-4 bg-brand-purple text-white rounded-2xl font-bold text-lg shadow-xl shadow-brand-purple/20 flex items-center justify-center gap-3 transition-all hover:bg-brand-purple/90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <Save size={22} />
                    {t('keyModal.save')}
                  </button>
                </div>
              </form>
            </div>
            
            {/* Footer Info */}
            <div className="px-8 py-6 bg-slate-50 dark:bg-white/[0.02] border-t border-slate-100 dark:border-slate-800 space-y-4">
              {vbsId && (
                <div className="flex items-center justify-between p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-brand-purple/10 rounded-md flex items-center justify-center text-brand-purple">
                      <ShieldCheck size={14} />
                    </div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('keyModal.userIdLabel')}</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-brand-purple">{vbsId}</span>
                </div>
              )}
              <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center uppercase tracking-widest font-bold">
                {t('keyModal.localStoreNotice')}
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
