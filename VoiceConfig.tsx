import React from 'react';
import { motion } from 'motion/react';
import { 
  Mic, 
  Type, 
  Clapperboard, 
  Sparkles,
  MoveRight
} from 'lucide-react';

import { useLanguage } from '../contexts/LanguageContext';

interface WelcomePageProps {
  onEnter: () => void;
}

export const WelcomePage: React.FC<WelcomePageProps> = ({ onEnter }) => {
  const { language } = useLanguage();

  // Animation variants
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.2,
        delayChildren: 0.3
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: { 
      opacity: 1, 
      y: 0, 
      transition: { duration: 0.8, ease: "easeOut" } 
    }
  };

  return (
    <div className="min-h-screen bg-[#000000] text-white flex flex-col items-center justify-center p-6 overflow-hidden relative selection:bg-amber-400/30 font-sans">
      
      {/* Background Effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="noise-overlay absolute inset-0 mix-blend-overlay opacity-10" />
        
        {/* Animated Orbs */}
        <motion.div 
          animate={{
            x: [0, 50, 0],
            y: [0, -30, 0],
            scale: [1, 1.1, 1],
          }}
          transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
          className="absolute top-[5%] left-[5%] w-[40vw] h-[40vw] bg-amber-400/5 rounded-full blur-[120px]" 
        />
        <motion.div 
          animate={{
            x: [0, -50, 0],
            y: [0, 50, 0],
            scale: [1, 1.2, 1],
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className="absolute bottom-[5%] right-[5%] w-[35vw] h-[35vw] bg-purple-600/10 rounded-full blur-[120px]" 
        />

        {/* Global Inner Glow */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      </div>

      <motion.div 
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="max-w-6xl w-full z-10 flex flex-col items-center text-center py-20"
      >
        {/* Brand Badge */}
        <motion.div variants={itemVariants} className="mb-12">
          <div className="inline-flex items-center gap-3 px-5 py-2 bg-white/[0.03] border border-white/10 rounded-full backdrop-blur-2xl shadow-2xl">
            <Sparkles size={16} className="text-amber-400 animate-pulse" />
            <span className="text-[10px] font-black tracking-[0.3em] uppercase text-slate-400">
              {language === 'mm' ? 'မြန်မာနိုင်ငံ၏ အပိုင်နိုင်ဆုံး AI စနစ်' : 'VLOGS BY SAW • PREMIUM AI STUDIO'}
            </span>
          </div>
        </motion.div>

        {/* Hero Section */}
        <motion.div variants={itemVariants} className="relative mb-12">
          <h1 className="text-7xl md:text-9xl font-black tracking-tighter leading-[0.9] mb-8">
            <span className="text-white">BURMESE</span>
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-amber-200 to-amber-500">
              AI STUDIO
            </span>
          </h1>
          <p className="text-xl md:text-2xl font-medium text-slate-400 tracking-tight max-w-2xl mx-auto leading-relaxed">
            {language === 'mm' ? 'အစွမ်းထက်ဆုံး AI အသံထုတ်စနစ်' : 'Professional Narration & Cinematic Content Tools.'}
            <br />
            <span className="text-slate-600 text-base">
              {language === 'mm' ? 'Professional Narration & Cinematic Content Tools.' : 'Engineered for high-end movie recappers and storytellers.'}
            </span>
          </p>
        </motion.div>

        {/* Call to Action */}
        <motion.div variants={itemVariants} className="mb-32">
          <motion.button
            whileHover={{ scale: 1.05, boxShadow: '0 20px 40px rgba(234, 179, 8, 0.15)' }}
            whileTap={{ scale: 0.95 }}
            onClick={onEnter}
            className="group relative flex items-center gap-6 bg-amber-400 text-black px-12 py-6 rounded-[24px] font-black text-xl transition-all duration-500"
          >
            <span className="tracking-tighter">ENTER STUDIO</span>
            <div className="flex items-center justify-center bg-black rounded-xl p-2 transition-transform group-hover:translate-x-2">
              <MoveRight size={24} className="text-amber-400" />
            </div>
            
            {/* Glossy Overlay */}
            <div className="absolute inset-0 rounded-[24px] overflow-hidden pointer-events-none">
              <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/40 to-white/0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 -translate-x-full group-hover:translate-x-full transform skew-x-12" />
            </div>
          </motion.button>
        </motion.div>

        {/* Features Minimal Grid */}
        <motion.div 
          variants={itemVariants}
          className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-5xl px-4"
        >
          <FeatureCard 
            icon={<Mic className="text-amber-400" />}
            title={language === 'mm' ? 'AI အသံဖန်တီးမှု' : 'AI VOICE GENERATION'}
            desc={language === 'mm' ? 'သဘာဝကျသောအသံများ' : 'Natural human-like Burmese narratives'}
            delay={0.1}
          />
          <FeatureCard 
            icon={<Type className="text-amber-400" />}
            title={language === 'mm' ? 'အလိုအလျောက် စာတန်းထိုး' : 'AUTO SUBTITLES'}
            desc={language === 'mm' ? 'တိကျမြန်ဆန်သော SRT' : 'Timed SRT subtitle synthesis'}
            delay={0.2}
          />
          <FeatureCard 
            icon={<Clapperboard className="text-amber-400" />}
            title={language === 'mm' ? 'ရုပ်ရှင်အဆင့်မီ အရည်အသွေး' : 'CINEMATIC QUALITY'}
            desc={language === 'mm' ? 'ပရော်ဖက်ရှင်နယ် အဆင့်' : 'Studio-grade output for movie recaps'}
            delay={0.3}
          />
        </motion.div>
      </motion.div>

      {/* Footer */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2 }}
        className="absolute bottom-12 flex flex-col items-center gap-4"
      >
        <p className="text-slate-700 font-black text-[9px] tracking-[0.6em] uppercase">
          PROFESSIONAL AI CONTENT SUITE • V3
        </p>
      </motion.div>
    </div>
  );
};

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  desc: string;
  delay: number;
}

const FeatureCard: React.FC<FeatureCardProps> = ({ icon, title, desc, delay }) => (
  <motion.div 
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: 1 + delay, duration: 0.6 }}
    className="relative group p-8 rounded-3xl bg-white/[0.03] border border-white/5 hover:border-white/10 hover:bg-white/[0.05] transition-all duration-500 overflow-hidden"
  >
    {/* Hover highlight background */}
    <div className="absolute inset-0 bg-gradient-to-br from-white/[0.05] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
    
    <div className="relative z-10 flex flex-col items-center">
      <div className="mb-6 p-4 rounded-2xl bg-white/[0.03] border border-white/10 group-hover:scale-110 group-hover:bg-white/[0.08] transition-all duration-500">
        {React.cloneElement(icon as React.ReactElement, { size: 28 })}
      </div>
      <h3 className="text-lg font-bold text-white mb-2 tracking-tight text-center">{title}</h3>
      <p className="text-slate-500 text-sm text-center">{desc}</p>
    </div>
  </motion.div>
);

