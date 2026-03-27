import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, XCircle, AlertCircle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

interface ToastProps {
  message: string;
  type: ToastType;
  isVisible: boolean;
  onClose: () => void;
  duration?: number;
}

export const Toast: React.FC<ToastProps> = ({ 
  message, 
  type, 
  isVisible, 
  onClose, 
  duration = 3000 
}) => {
  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(() => {
        onClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [isVisible, onClose, duration]);

  const styles = {
    success: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500',
    error: 'bg-red-500/10 border-red-500/20 text-red-500',
    info: 'bg-brand-purple/10 border-brand-purple/20 text-brand-purple',
  };

  const icons = {
    success: <CheckCircle2 size={18} />,
    error: <XCircle size={18} />,
    info: <AlertCircle size={18} />,
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.9, filter: 'blur(10px)' }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: 0.9, filter: 'blur(10px)', transition: { duration: 0.2 } }}
          className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 px-6 py-4 rounded-2xl border backdrop-blur-xl shadow-[0_0_30px_rgba(0,0,0,0.5)] min-w-[320px] max-w-md transition-colors duration-300 dark:bg-slate-950/90 dark:border-slate-800 ${styles[type]}`}
        >
          <div className="flex-shrink-0">
            {icons[type]}
          </div>
          <p className="text-[11px] font-bold flex-grow font-mono uppercase tracking-wider">{message}</p>
          <button 
            onClick={onClose}
            className="flex-shrink-0 ml-4 hover:opacity-70 transition-opacity"
          >
            <XCircle size={16} className="opacity-50" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
