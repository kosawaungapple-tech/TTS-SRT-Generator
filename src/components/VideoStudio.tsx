import React from 'react';
import { motion } from 'motion/react';
import { 
  Sparkles, 
  Lock, 
  Layers, 
  Video, 
  Monitor, 
  Zap, 
  Shield, 
  Bell,
  Cpu
} from 'lucide-react';

interface VideoStudioProps {
  isAdmin?: boolean;
}

export const VideoStudio: React.FC<VideoStudioProps> = ({ isAdmin = false }) => {
  const features = [
    {
      title: "မူရင်း Subtitle ဖုံးရန် Blur",
      description: "original subtitle ကို blur လုပ်ပေးတယ်",
      icon: <Layers className="text-amber-400" size={24} />,
      status: "Soon"
    },
    {
      title: "Myanmar Subtitle Burn-in",
      description: "မြန်မာစာတန်း ထည့်ပေးတယ်",
      icon: <Video className="text-amber-400" size={24} />,
      status: "Soon"
    },
    {
      title: "Auto Flip & Zoom",
      description: "copyright bypass အတွက်",
      icon: <Zap className="text-amber-400" size={24} />,
      status: "Soon"
    },
    {
      title: "Color Grading",
      description: "video အရောင်ပြောင်းပေးတယ်",
      icon: <Sparkles className="text-amber-400" size={24} />,
      status: "Soon"
    },
    {
      title: "Logo Watermark",
      description: "ကိုယ်ပိုင် logo ထည့်ပေးတယ်",
      icon: <Shield className="text-amber-400" size={24} />,
      status: "Soon"
    },
    {
      title: "Freeze Frame",
      description: "copyright ကာကွယ်ဖို့",
      icon: <Monitor className="text-amber-400" size={24} />,
      status: "Soon"
    }
  ];

  return (
    <div className="space-y-12 py-6">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-[40px] premium-glass p-10 sm:p-20 text-center space-y-6">
        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-amber-400/5 blur-[120px] -z-10" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-brand-purple/5 blur-[120px] -z-10" />
        
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-amber-400/10 text-amber-500 rounded-full border border-amber-400/20 text-xs font-black uppercase tracking-widest mb-4"
        >
          <Sparkles size={14} className="animate-pulse" />
          Next Generation AI
        </motion.div>

        <motion.h1 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-4xl sm:text-6xl font-black text-slate-900 dark:text-white tracking-tight"
        >
          Video <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-amber-200 to-amber-500">Studio</span>
        </motion.h1>
        
        <motion.p 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-slate-500 dark:text-slate-400 text-lg sm:text-xl font-medium max-w-2xl mx-auto"
        >
          AI-Powered Myanmar Video Enhancement
        </motion.p>

        {isAdmin && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="mt-6 flex justify-center"
          >
            <div className="bg-brand-purple/20 text-brand-purple px-4 py-2 rounded-xl text-xs font-bold border border-brand-purple/30 cursor-pointer hover:bg-brand-purple/30 transition-all flex items-center gap-2">
              <Cpu size={14} />
              [Admin] Click to enable beta testing
            </div>
          </motion.div>
        )}

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="pt-10 flex flex-wrap justify-center gap-4"
        >
          <button className="px-8 py-4 bg-amber-400 text-black rounded-2xl font-black shadow-xl shadow-amber-400/20 hover:scale-105 active:scale-95 transition-all flex items-center gap-3 group">
            <Bell size={20} className="group-hover:animate-bounce" />
            Notify Me
          </button>
        </motion.div>
      </div>

      {/* Features Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {features.map((feature, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 * index }}
            className="glass-card p-8 rounded-[32px] border border-slate-200 dark:border-white/5 relative group overflow-hidden"
          >
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <Lock size={40} className="text-slate-500 dark:text-white" />
            </div>
            
            <div className="w-14 h-14 bg-amber-400/10 rounded-2xl flex items-center justify-center mb-6 shadow-inner">
              {feature.icon}
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">{feature.title}</h3>
                <span className="text-[10px] font-black uppercase bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-full border border-slate-200 dark:border-white/5">
                  {feature.status}
                </span>
              </div>
              <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">
                {feature.description}
              </p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* FFmpeg Badge */}
      <div className="flex justify-center pt-8">
        <div className="bg-slate-50 dark:bg-slate-950/50 px-6 py-3 rounded-full border border-slate-200 dark:border-white/5 flex items-center gap-3 shadow-inner">
          <div className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
          <p className="text-[11px] font-bold tracking-widest text-slate-500 dark:text-slate-400">
            လုပ်ဆောင်ချက်များ မကြာမီ ရရှိနိုင်မည်
          </p>
        </div>
      </div>
    </div>
  );
};
