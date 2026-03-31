import React from 'react';
import { motion } from 'motion/react';
import { Rocket, ArrowRight } from 'lucide-react';

interface WelcomePageProps {
  onGetStarted: () => void;
}

export const WelcomePage: React.FC<WelcomePageProps> = ({ onGetStarted }) => {
  return (
    <div className="fixed inset-0 z-[100] bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6 overflow-hidden">
      {/* Background Decorative Elements */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-brand-purple/5 rounded-full blur-[120px]" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-brand-purple/10 rounded-full blur-[120px]" />
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="max-w-3xl w-full text-center space-y-10 relative z-10"
      >
        <div className="space-y-6">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="w-24 h-24 bg-brand-purple/10 rounded-[32px] flex items-center justify-center text-brand-purple mx-auto mb-8 shadow-2xl shadow-brand-purple/20"
          >
            <Rocket size={48} className="animate-pulse" />
          </motion.div>
          
          <motion.h1 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            className="text-5xl md:text-7xl font-black text-slate-900 dark:text-white tracking-tight leading-tight"
          >
            Welcome <span className="text-brand-purple">Vlogs By Saw</span>
          </motion.h1>
          
          <motion.p 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.5 }}
            className="text-lg md:text-xl text-slate-500/80 dark:text-slate-400/80 font-medium max-w-2xl mx-auto leading-[1.8]"
          >
            မြန်မာစာမှ အသံပြောင်းလဲခြင်းနှင့် ဗီဒီယိုစာတန်းထိုးခြင်း လုပ်ဆောင်ချက်အားလုံးကို တစ်နေရာတည်းတွင် ရယူလိုက်ပါ
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.8, duration: 0.5 }}
        >
          <button
            onClick={onGetStarted}
            className="group relative px-12 py-6 bg-brand-purple text-white rounded-[32px] font-bold text-2xl shadow-2xl shadow-brand-purple/40 hover:bg-brand-purple/90 transition-all active:scale-[0.98] flex items-center gap-4 mx-auto overflow-hidden"
          >
            <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
            <span className="relative z-10">Get Started</span>
            <Rocket size={28} className="relative z-10 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform duration-300" />
            <ArrowRight size={24} className="relative z-10 opacity-0 -translate-x-4 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300" />
          </button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2, duration: 1 }}
          className="pt-12 flex items-center justify-center gap-8 text-slate-400 dark:text-slate-600 font-bold text-xs uppercase tracking-[0.3em]"
        >
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-brand-purple" />
            Premium Quality
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-brand-purple" />
            AI Powered
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-brand-purple" />
            Fast Generation
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
};
