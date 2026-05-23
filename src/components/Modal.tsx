import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, AlertCircle, CheckCircle2, HelpCircle, Info, Calendar, Lock, Key } from 'lucide-react';

export type ModalType = 'alert' | 'confirm' | 'prompt' | 'success' | 'error' | 'info';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm?: (value?: string) => void;
  title: string;
  message: string;
  type?: ModalType;
  confirmText?: string;
  cancelText?: string;
  placeholder?: string;
  defaultValue?: string;
  inputType?: 'text' | 'password' | 'date';
  showIcon?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  type = 'alert',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  placeholder = 'Enter value...',
  defaultValue = '',
  inputType = 'text',
  showIcon = true,
}) => {
  const [inputValue, setInputValue] = useState(defaultValue);

  useEffect(() => {
    if (isOpen) {
      setInputValue(defaultValue);
    }
  }, [isOpen, defaultValue]);

  const handleConfirm = () => {
    if (onConfirm) {
      onConfirm(type === 'prompt' ? inputValue : undefined);
    }
    onClose();
  };

  const getIcon = () => {
    switch (type) {
      case 'success':
        return <CheckCircle2 className="text-emerald-500" size={24} />;
      case 'error':
      case 'alert':
        return <AlertCircle className="text-red-500" size={24} />;
      case 'confirm':
        return <HelpCircle className="text-brand-purple" size={24} />;
      case 'prompt':
        if (inputType === 'password') return <Lock className="text-brand-purple" size={24} />;
        if (inputType === 'date') return <Calendar className="text-brand-purple" size={24} />;
        return <Key className="text-brand-purple" size={24} />;
      case 'info':
        return <Info className="text-brand-purple" size={24} />;
      default:
        return <Info className="text-blue-500" size={24} />;
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6">
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
            className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-[32px] shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
          >
            {/* Header */}
            <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-white/[0.02]">
              <div className="flex items-center gap-3">
                {showIcon && (
                  <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-xl flex items-center justify-center">
                    {getIcon()}
                  </div>
                )}
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-widest">Notification</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-slate-200 dark:hover:bg-white/10 rounded-full transition-colors text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              <p className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed">
                {message}
              </p>

              {type === 'prompt' && (
                <div className="relative">
                  <input
                    type={inputType}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder={placeholder}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl px-4 py-3.5 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-brand-purple/50 text-slate-900 dark:text-white placeholder:text-slate-400"
                    autoFocus
                  />
                </div>
              )}

              <div className="flex gap-3">
                {type !== 'alert' && type !== 'success' && type !== 'error' && type !== 'info' && (
                  <button
                    onClick={onClose}
                    className="flex-1 py-3.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-2xl font-bold text-sm transition-all hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-[0.98]"
                  >
                    {cancelText}
                  </button>
                )}
                <button
                  onClick={handleConfirm}
                  className="flex-1 py-3.5 bg-brand-purple text-white rounded-2xl font-bold text-sm shadow-lg shadow-brand-purple/20 transition-all hover:bg-brand-purple/90 active:scale-[0.98]"
                >
                  {confirmText}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
