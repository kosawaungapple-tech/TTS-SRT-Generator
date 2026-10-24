import React from 'react';
import { motion } from 'motion/react';
import { Sparkles } from 'lucide-react';

export const MaintenanceOverlay: React.FC = () => {
  return (
    <div className="fixed inset-0 z-[9999] bg-[#000000] flex flex-col items-center justify-center p-6 select-none overflow-hidden font-sans">
      {/* Background Ambience */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div 
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.1, 0.15, 0.1],
          }}
          transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
          className="absolute top-1/4 left-1/4 w-[60vw] h-[60vw] bg-amber-400/10 rounded-full blur-[120px]" 
        />
        <motion.div 
          animate={{
            scale: [1, 1.1, 1],
            opacity: [0.05, 0.1, 0.05],
          }}
          transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
          className="absolute bottom-1/4 right-1/4 w-[50vw] h-[50vw] bg-purple-600/10 rounded-full blur-[100px]" 
        />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="max-w-xl w-full z-10 flex flex-col items-center text-center"
      >
        {/* Brand Logo / Badge */}
        <div className="mb-12">
          <div className="inline-flex items-center gap-3 px-5 py-2 bg-white/[0.03] border border-white/10 rounded-full backdrop-blur-2xl">
            <Sparkles size={16} className="text-amber-400" />
            <span className="text-[10px] font-black tracking-[0.3em] uppercase text-white/50">
              VLOGS BY SAW • PREMIUM AI STUDIO
            </span>
          </div>
        </div>

        {/* Maintenance Message */}
        <h1 className="text-4xl md:text-6xl font-black tracking-tight text-white mb-6">
          ယာယီပြုပြင်နေပါသည်
        </h1>
        
        <p className="text-lg md:text-xl font-medium text-slate-400 mb-12 max-w-sm leading-relaxed">
          ခဏစောင့်ပါ၊ မကြာမီပြန်လည်ဝန်ဆောင်မှုပေးမည်
        </p>

        {/* Animated Loading Dots */}
        <div className="flex items-center gap-3 bg-white/[0.03] border border-white/5 px-8 py-4 rounded-3xl backdrop-blur-sm">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              animate={{
                scale: [1, 1.5, 1],
                opacity: [0.3, 1, 0.3],
                backgroundColor: ["rgba(251, 191, 36, 0.3)", "rgba(251, 191, 36, 1)", "rgba(251, 191, 36, 0.3)"]
              }}
              transition={{
                duration: 1.2,
                repeat: Infinity,
                delay: i * 0.2,
                ease: "easeInOut"
              }}
              className="w-3 h-3 rounded-full"
            />
          ))}
        </div>
      </motion.div>

      {/* Footer Branding */}
      <div className="absolute bottom-12">
        <p className="text-white/20 font-black text-[9px] tracking-[0.6em] uppercase">
          SYSTEM UNDER MAINTENANCE • V3
        </p>
      </div>
    </div>
  );
};
