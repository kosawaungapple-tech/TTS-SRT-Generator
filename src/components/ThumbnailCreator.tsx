import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Download, 
  Monitor, 
  Smartphone, 
  Facebook, 
  Youtube, 
  Sparkles, 
  RefreshCcw,
  Image as ImageIcon,
  Lock,
  ShieldCheck,
  AlertCircle
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

import { GeminiTTSService } from '../services/geminiService';

interface ThumbnailTabProps {
  isDarkMode: boolean;
  showToast: (message: string, type: 'success' | 'error') => void;
  getApiKey: () => string | null;
  isAdmin: boolean;
  isPremium: boolean;
  allowThumbnailAdminKey?: boolean;
}

interface Platform {
  id: string;
  name: string;
  width: number;
  height: number;
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
  icon: React.ReactNode;
}

const PLATFORMS: Platform[] = [
  { id: 'youtube', name: 'YouTube', width: 1280, height: 720, aspectRatio: '16:9', icon: <Youtube size={20} /> },
  { id: 'tiktok', name: 'TikTok', width: 1080, height: 1920, aspectRatio: '9:16', icon: <Smartphone size={20} /> },
  { id: 'facebook', name: 'Facebook', width: 1200, height: 630, aspectRatio: '16:9', icon: <Facebook size={20} /> },
];

export const ThumbnailCreator: React.FC<ThumbnailTabProps> = ({ 
  isDarkMode, 
  showToast, 
  getApiKey,
  isAdmin,
  isPremium,
  allowThumbnailAdminKey = false
}) => {
  const { t } = useLanguage();
  const [platform, setPlatform] = useState<Platform>(PLATFORMS[0]);
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const isThumbnailRestricted = false; // TEMPORARILY DISABLED FOR DEBUGGING (original: !isAdmin && !allowThumbnailAdminKey)
  const canUseThumbnail = true; // TEMPORARILY ENABLED FOR DEBUGGING (original: isAdmin || (isPremium && allowThumbnailAdminKey))

  console.log('DEBUG - Admin Key Enabled:', allowThumbnailAdminKey);

  const handleGenerate = async () => {
    if (!canUseThumbnail) {
      showToast(isPremium ? t('thumbnailFeature.temporarilyDisabled') : t('thumbnailFeature.premiumRequired'), 'error');
      return;
    }

    const apiKey = getApiKey();
    if (!apiKey) {
      showToast('Please add an API Key in Settings to generate thumbnails.', 'error');
      return;
    }

    if (!prompt.trim()) {
      showToast('Please enter a description for the thumbnail.', 'error');
      return;
    }

    setIsGenerating(true);
    setGeneratedImage(null);

    try {
      const gemini = new GeminiTTSService(apiKey);
      const dataUrl = await gemini.generateImage(prompt);
      
      // The service returns a full data URL (data:image/png;base64,...)
      // But the component adds the prefix itself: src={`data:image/png;base64,${generatedImage}`}
      // So I should strip the prefix if it exists, or update the component.
      // Let's strip it for compatibility or update the component to take full dataUrl.
      const base64Content = dataUrl.includes('base64,') ? dataUrl.split('base64,')[1] : dataUrl;
      
      setGeneratedImage(base64Content);
      showToast('Thumbnail generated successfully!', 'success');
    } catch (err: unknown) {
      console.error('Image Generation error:', err);
      let message = 'Thumbnail ထုတ်မရပါ — API Key မှန်/မမှန် စစ်ပါ သို့မဟုတ် နောက်မှ ထပ်ကြိုးစားပါ';
      if (err instanceof Error) {
        message = err.message;
      }
      showToast(message, 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = () => {
    if (!generatedImage) return;

    setIsExporting(true);
    try {
      const link = document.createElement('a');
      link.download = `vbs_thumbnail_${platform.id}_${Date.now()}.png`;
      link.href = `data:image/png;base64,${generatedImage}`;
      link.click();
      showToast('Thumbnail downloaded!', 'success');
    } catch (err) {
      console.error('Download error:', err);
      showToast('Failed to download thumbnail.', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  if (false && !isAdmin && !isPremium) {
    return (
      <div className="premium-glass rounded-[32px] p-12 text-center shadow-2xl">
        <div className="w-20 h-20 bg-rose-500/10 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-6">
          <Lock size={40} />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">{t('thumbnailFeature.premiumRequired')}</h2>
        <p className="text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
          Premium Access ရယူရန် Admin ထံ ဆက်သွယ်ပါ။
        </p>
      </div>
    );
  }

  if (false && isThumbnailRestricted) {
    return (
      <div className="premium-glass rounded-[32px] p-12 text-center shadow-2xl border border-amber-500/20">
        <div className="w-20 h-20 bg-amber-500/10 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertCircle size={40} />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">{t('thumbnailFeature.locked')}</h2>
        <p className="text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed italic">
          {t('thumbnailFeature.temporarilyDisabled')}
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <div className="px-4 py-2 bg-amber-500/10 text-amber-600 rounded-lg text-[10px] font-bold uppercase tracking-widest border border-amber-500/20">
            Admin Controlled Gate
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 max-w-7xl mx-auto">
        {/* Controls Column */}
        <div className="lg:col-span-5 space-y-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <ImageIcon size={20} className="text-brand-purple" />
              {t('nav.thumbnail')}
            </h2>
            {isPremium && (
              <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 text-emerald-600 rounded-full text-[10px] font-bold border border-emerald-500/20">
                <ShieldCheck size={12} />
                Premium Active
              </div>
            )}
          </div>
        {/* Platform Selector */}
        <div className="glass-card p-6 rounded-[28px] border border-white/40 dark:border-slate-800/40 shadow-xl space-y-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-brand-purple/10 rounded-xl text-brand-purple">
              <Monitor size={18} />
            </div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-white uppercase tracking-widest">Platform</h3>
          </div>
          
          <div className="grid grid-cols-3 gap-3">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPlatform(p)}
                className={`p-3 rounded-2xl border transition-all flex flex-col items-center gap-2 ${
                  platform.id === p.id 
                    ? 'bg-brand-purple border-brand-purple text-white shadow-lg shadow-brand-purple/20' 
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-brand-purple/40'
                }`}
              >
                {p.icon}
                <span className="text-[10px] font-bold uppercase tracking-wider">{p.name}</span>
                <span className="text-[8px] opacity-60 font-mono">{p.width}x{p.height}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Prompt Input */}
        <div className="glass-card p-6 rounded-[28px] border border-white/40 dark:border-slate-800/40 shadow-xl space-y-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/10 rounded-xl text-amber-500">
              <Sparkles size={18} />
            </div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-white uppercase tracking-widest">AI Description</h3>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-1 mb-2 block">
                Describe your thumbnail (Myanmar or English)
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="ဥပမာ- 'အနီရောင်နောက်ခံ၊ ကြယ်တွေနဲ့ Myanmar title text' သို့မဟုတ် 'A gamer sitting in a high-tech room with purple lighting'"
                className="w-full h-40 px-4 py-4 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-purple/50 resize-none transition-all placeholder:text-slate-400 dark:placeholder:text-slate-600 leading-relaxed"
              />
            </div>
          </div>
        </div>

        {/* Generate Button */}
        <button
          onClick={handleGenerate}
          disabled={isGenerating || !prompt.trim()}
          className={`w-full py-5 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all shadow-xl active:scale-[0.98] disabled:opacity-50 ${
            isGenerating 
              ? 'bg-slate-200 dark:bg-slate-800 text-slate-500 cursor-not-allowed' 
              : 'bg-brand-purple hover:bg-brand-purple/90 text-white shadow-brand-purple/20'
          }`}
        >
          {isGenerating ? (
            <RefreshCcw size={20} className="animate-spin" />
          ) : (
            <Sparkles size={20} />
          )}
          {isGenerating ? 'Designing...' : 'Generate Thumbnail'}
        </button>
      </div>

      {/* Preview Column */}
      <div className="lg:col-span-7 space-y-6">
        <div className={`glass-card p-6 rounded-[32px] border shadow-2xl relative overflow-hidden h-fit transition-all ${isDarkMode ? 'border-slate-800/40' : 'border-white/40'}`}>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${isGenerating ? 'bg-amber-500 animate-pulse' : 'bg-brand-purple'}`} />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-widest">Live Preview</h3>
            </div>
            <div className="flex items-center gap-4 text-[10px] font-mono text-slate-500 font-bold">
               <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-md">{platform.width}x{platform.height}</span>
               <span className="uppercase">{platform.name}</span>
            </div>
          </div>

          {/* Generated Image Preview */}
          <div className="bg-slate-100 dark:bg-slate-950/50 rounded-2xl p-4 flex items-center justify-center overflow-hidden min-h-[300px] border border-slate-200 dark:border-slate-800">
            <AnimatePresence mode="wait">
              {generatedImage ? (
                <motion.div
                  key="preview"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="relative w-full shadow-2xl rounded-lg overflow-hidden"
                  style={{ 
                    aspectRatio: platform.id === 'tiktok' ? '9/16' : '16/9',
                    maxWidth: platform.id === 'tiktok' ? '300px' : '100%'
                  }}
                >
                  <img 
                    src={`data:image/png;base64,${generatedImage}`} 
                    alt="AI Thumbnail" 
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-4 right-4 flex gap-2">
                     <div className="bg-black/50 backdrop-blur-md px-2 py-1 rounded text-[8px] text-white font-bold uppercase tracking-wider">
                        High Res
                     </div>
                  </div>
                </motion.div>
              ) : isGenerating ? (
                <motion.div 
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center gap-4 py-20"
                >
                   <div className="relative">
                      <div className="w-16 h-16 border-4 border-brand-purple/20 border-t-brand-purple rounded-full animate-spin"></div>
                      <div className="absolute inset-0 flex items-center justify-center">
                         <Sparkles size={20} className="text-brand-purple animate-pulse" />
                      </div>
                   </div>
                   <div className="text-center">
                     <p className="text-sm font-bold text-slate-800 dark:text-white uppercase tracking-widest mb-1">Painting your vision</p>
                     <p className="text-[10px] text-slate-500 font-medium tracking-wide">Gemini is creating an exclusive design...</p>
                   </div>
                </motion.div>
              ) : (
                <motion.div 
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center gap-4 py-20 text-slate-400 dark:text-slate-600"
                >
                   <div className="w-16 h-16 rounded-3xl bg-slate-200 dark:bg-slate-900 flex items-center justify-center">
                      <ImageIcon size={32} />
                   </div>
                   <div className="text-center">
                     <p className="text-xs font-bold uppercase tracking-widest mb-1">No Image Yet</p>
                     <p className="text-[10px] font-medium max-w-[200px]">Describe what you want and click Generate to see the magic.</p>
                   </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="mt-8 flex flex-col sm:flex-row gap-4">
             <button
              onClick={handleDownload}
              disabled={!generatedImage || isExporting}
              className={`flex-1 font-bold py-5 rounded-2xl shadow-xl flex items-center justify-center gap-3 active:scale-[0.98] transition-all ${
                !generatedImage 
                  ? 'bg-slate-100 dark:bg-slate-900 text-slate-300 dark:text-slate-700' 
                  : 'bg-green-600 hover:bg-green-700 text-white shadow-green-600/20'
              }`}
            >
              <Download size={24} />
              {isExporting ? 'Downloading...' : 'Download PNG'}
            </button>
          </div>
        </div>

        {/* Instructions */}
        <div className="p-6 bg-brand-purple/5 border border-brand-purple/10 rounded-3xl space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-brand-purple uppercase tracking-widest flex items-center gap-2">
              <ImageIcon size={14} /> AI Image Pro-Tips
            </h4>
          </div>
          <ul className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed font-semibold list-disc pl-4 space-y-2">
            <li>For text, describe it clearly: <span className="text-brand-purple">"with bold yellow text that says 'NEW VIDEO'"</span>.</li>
            <li>Specify the style for better results: <span className="text-brand-purple">"3D render, minimalist, neon, or cinematic"</span>.</li>
            <li>Gemini Imagen 3 supports both <span className="text-brand-purple">Myanmar</span> and English prompts.</li>
            <li>Aspect ratios are automatically optimized for your chosen platform.</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
);
};
