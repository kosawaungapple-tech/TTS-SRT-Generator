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

  const colors = {
    success: 'from-emerald-500/10 to-emerald-500/5 border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.2)] dark:border-emerald-500/30 text-emerald-400',
    error: 'from-red-500/10 to-red-500/5 border-red-500/50 shadow-[0_0_20px_rgba(239,68,68,0.2)] dark:border-red-500/30 text-red-400',
    info: 'from-brand-purple/10 to-brand-purple/5 border-brand-purple/50 shadow-[0_0_20px_rgba(139,92,246,0.2)] dark:border-brand-purple/30 text-brand-purple',
  };

  const icons = {
    success: <CheckCircle2 size={24} />,
    error: <XCircle size={24} />,
    info: <AlertCircle size={24} />,
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 pointer-events-none">
          {/* Subtle Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px] pointer-events-auto"
          />
          
          {/* Centered Toast */}
          <motion.div
            initial={{ opacity: 0, scale: 0.4, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.15 } }}
            className={`relative z-10 flex flex-col items-center gap-4 px-8 py-10 rounded-[40px] border bg-gradient-to-b backdrop-blur-3xl shadow-3xl text-center min-w-[300px] max-w-sm sm:max-w-md w-full pointer-events-auto transition-all duration-500 ${colors[type]}`}
          >
            <motion.div 
              initial={{ rotate: -10, scale: 0.5 }}
              animate={{ rotate: 0, scale: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
              className="p-4 rounded-3xl bg-white/5 dark:bg-black/20 border border-white/10 shadow-inner"
            >
              {icons[type]}
            </motion.div>
            
            <p className="text-base sm:text-lg font-bold leading-relaxed tracking-tight break-words px-2">
              {message}
            </p>

            <motion.button 
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onClose}
              className="mt-2 px-6 py-2 rounded-full text-xs font-bold uppercase tracking-widest bg-white/10 dark:bg-white/5 hover:bg-white/20 dark:hover:bg-white/10 border border-white/10 transition-all text-slate-300 hover:text-white"
            >
              Dismiss
            </motion.button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
