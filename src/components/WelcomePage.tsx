import React from 'react';
import { motion } from 'motion/react';
import { Mic, Zap, Languages, ChevronRight } from 'lucide-react';

import { useLanguage } from '../contexts/LanguageContext';

interface WelcomePageProps {
  onEnter: () => void;
}

export const WelcomePage: React.FC<WelcomePageProps> = ({ onEnter }) => {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen bg-[#020617] text-white flex flex-col items-center justify-center p-6 overflow-hidden relative">
      {/* Animated Background Elements */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-600/10 rounded-full blur-[120px] animate-pulse-soft" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-brand-purple/10 rounded-full blur-[120px] animate-pulse-soft" style={{ animationDelay: '1s' }} />
      </div>

      <div className="max-w-4xl w-full z-10 flex flex-col items-center text-center py-12">
        {/* Logo/Icon Section */}
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 20 }}
          className="relative mb-10"
        >
          <div className="absolute inset-0 bg-purple-500 rounded-full blur-2xl opacity-50 animate-pulse" />
          <div className="relative bg-gradient-to-b from-purple-400 to-purple-700 p-6 rounded-full shadow-[0_0_50px_rgba(168,85,247,0.4)] border border-purple-300/30">
            <Mic size={64} className="text-white" />
          </div>
        </motion.div>

        {/* Title Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex flex-col gap-4 md:gap-6 mb-8 md:mb-12 px-4"
        >
          <h1 className="text-3xl md:text-6xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-b from-white via-white to-purple-400 leading-tight">
            {t('welcome.title')}
          </h1>
          <p className="text-base md:text-xl font-bold text-purple-300 tracking-wide">
            {t('welcome.subtitle')}
          </p>
          <p className="text-slate-400 max-w-2xl mx-auto text-sm md:text-lg">
            {t('welcome.description')}
          </p>
        </motion.div>

        {/* Features Section */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="flex flex-col md:flex-row justify-center gap-6 md:grid md:grid-cols-3 mb-16 w-full px-4 sm:px-6 max-w-5xl"
        >
          <div className="w-full flex-1">
            <FeatureCard 
              icon={<Mic className="text-purple-400" />}
              title={t('welcome.feature1Title')}
            />
          </div>
          <div className="w-full flex-1">
            <FeatureCard 
              icon={<Languages className="text-purple-400" />}
              title={t('welcome.feature2Title')}
            />
          </div>
          <div className="w-full flex-1">
            <FeatureCard 
              icon={<Zap className="text-purple-400" />}
              title={t('welcome.feature3Title')}
            />
          </div>
        </motion.div>

        {/* CTA Section */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.6 }}
          className="mt-4 w-full flex justify-center px-6"
        >
        <motion.button
            whileHover={{ scale: 1.05, boxShadow: "0 0 30px rgba(168,85,247,0.6)" }}
            whileTap={{ scale: 0.95 }}
            onClick={onEnter}
            className="group relative bg-brand-purple hover:bg-purple-500 text-white w-full max-w-[320px] md:max-w-md py-4 md:py-5 rounded-2xl font-black text-lg md:text-xl tracking-widest uppercase flex items-center justify-center gap-3 transition-all duration-300 shadow-[0_0_20px_rgba(168,85,247,0.3)] metallic-btn"
          >
            {t('welcome.startBtn')}
            <ChevronRight className="group-hover:translate-x-1 transition-transform" />
          </motion.button>
        </motion.div>
      </div>

      {/* Footer Branding */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="absolute bottom-8 left-0 right-0 flex justify-center px-6"
      >
        <p className="text-slate-500 font-mono text-[10px] md:text-sm tracking-[0.2em] uppercase text-center max-w-xs md:max-w-none leading-relaxed">
          © 2026 Vlogs By Saw <span className="mx-2 hidden md:inline">•</span> <br className="md:hidden" /> Premium AI Narration
        </p>
      </motion.div>
    </div>
  );
};

const FeatureCard: React.FC<{ icon: React.ReactNode; title: string }> = ({ icon, title }) => (
  <div className="premium-glass p-6 md:p-10 rounded-[24px] md:rounded-[32px] hover:scale-105 transition-all duration-500 group flex flex-col items-center text-center h-full shadow-2xl neon-glow-indigo border border-white/5">
    <div className="bg-purple-500/10 w-14 h-14 md:w-20 md:h-20 rounded-2xl flex items-center justify-center mb-6 md:mb-8 group-hover:bg-purple-500/20 transition-all shadow-xl shadow-purple-500/5">
      {React.cloneElement(icon as React.ReactElement, { size: 40 })}
    </div>
    <h3 className="text-lg md:text-2xl font-black text-white leading-tight tracking-tight">{title}</h3>
  </div>
);
