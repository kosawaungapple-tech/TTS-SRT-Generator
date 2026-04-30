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
  AlertCircle,
  Type,
  Palette,
  Layout
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

import { GeminiTTSService } from '../services/geminiService';

interface ThumbnailTabProps {
  isDarkMode: boolean;
  showToast: (message: string, type: 'success' | 'error') => void;
  getApiKey: () => string | null;
  isAdmin: boolean;
  isPremium: boolean;
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

const THUMBNAIL_PRESETS = [
  {
    id: 'gaming',
    label: 'Gaming',
    emoji: '🎮',
    promptPrefix: 'Epic gaming setup with dramatic RGB lighting, dark background, neon accents, cinematic fog,',
    promptSuffix: 'photorealistic, 8K quality, gaming aesthetic',
    textColor: '#00FF88',
    bgHint: 'dark cyberpunk gaming room'
  },
  {
    id: 'vlog',
    label: 'Vlog',
    emoji: '🎬',
    promptPrefix: 'Warm lifestyle photography, golden hour lighting, bokeh background, vibrant colors,',
    promptSuffix: 'professional vlog style, natural and authentic feel',
    textColor: '#FFD700',
    bgHint: 'warm outdoor or lifestyle setting'
  },
  {
    id: 'tech',
    label: 'Tech',
    emoji: '💻',
    promptPrefix: 'Futuristic technology background, circuit board patterns, blue and white lighting, clean minimal,',
    promptSuffix: 'tech review style, professional, modern',
    textColor: '#00BFFF',
    bgHint: 'futuristic tech environment'
  },
  {
    id: 'drama',
    label: 'Drama',
    emoji: '🎭',
    promptPrefix: 'Dramatic cinematic scene, deep shadows, moody lighting, high contrast, emotional atmosphere,',
    promptSuffix: 'movie poster quality, intense and powerful',
    textColor: '#FF4444',
    bgHint: 'dramatic emotional scene'
  },
  {
    id: 'nature',
    label: 'Nature',
    emoji: '🌿',
    promptPrefix: 'Beautiful nature landscape, lush greenery, golden sunlight, peaceful atmosphere,',
    promptSuffix: 'travel photography style, stunning natural scenery',
    textColor: '#7CFC00',
    bgHint: 'beautiful nature landscape'
  },
];

const TEXT_STYLES = [
  { id: 'fire', label: '🔥 Fire' },
  { id: 'neon', label: '⚡ Neon' },
  { id: 'diamond', label: '💎 Diamond' },
  { id: 'cinematic', label: '🎬 Cinematic' },
  { id: 'youtube', label: '🌟 YouTube' },
];

const TEXT_POSITIONS = [
  { id: 'top-left', label: 'Top Left' },
  { id: 'top-center', label: 'Top Center' },
  { id: 'top-right', label: 'Top Right' },
  { id: 'middle', label: 'Middle' },
  { id: 'bottom-left', label: 'Bottom Left' },
  { id: 'bottom-center', label: 'Bottom Center' },
  { id: 'bottom-right', label: 'Bottom Right' },
];

interface TextStylePreset {
  fontSize: number;
  strokeWidth: number;
  strokeColor: string;
  glowColor: string;
  glowBlur: number;
  gradient?: string[];
  letterSpacing: number;
  uppercase?: boolean;
  solidFill?: string;
  yellowBg?: boolean;
}

// --- STYLE PRESET HELPERS ---    
function getTextStyle(styleName: string, text: string): TextStylePreset {
  const styles: Record<string, TextStylePreset> = {
    fire: {
      fontSize: text.length <= 4 ? 90 : text.length <= 10 ? 72 : 52,
      strokeWidth: 6,
      strokeColor: "#1a0000",
      glowColor: "rgba(255,100,0,0.9)",
      glowBlur: 30,
      gradient: ["#FFE259", "#FFA500", "#FF4500"],
      letterSpacing: 3
    },
    neon: {
      fontSize: text.length <= 4 ? 90 : text.length <= 10 ? 72 : 52,
      strokeWidth: 5,
      strokeColor: "#000033",
      glowColor: "#00FFFF",
      glowBlur: 25,
      gradient: ["#00FFFF", "#BF00FF"],
      letterSpacing: 4
    },
    diamond: {
      fontSize: text.length <= 4 ? 90 : text.length <= 10 ? 72 : 52,
      strokeWidth: 5,
      strokeColor: "#000000",
      glowColor: "rgba(255,255,255,0.9)",
      glowBlur: 15,
      gradient: ["#FFFFFF", "#C0C0C0", "#FFFFFF"],
      letterSpacing: 2
    },
    cinematic: {
      fontSize: text.length <= 4 ? 80 : text.length <= 10 ? 64 : 48,
      strokeWidth: 4,
      strokeColor: "#000000",
      glowColor: "rgba(255,180,0,0.7)",
      glowBlur: 20,
      gradient: ["#FFD700", "#B8860B"],
      letterSpacing: 8,
      uppercase: true
    },
    youtube: {
      fontSize: text.length <= 4 ? 90 : text.length <= 10 ? 72 : 52,
      strokeWidth: 8,
      strokeColor: "#000000",
      glowColor: "rgba(0,0,0,0.9)",
      glowBlur: 20,
      solidFill: "#FFFFFF",
      letterSpacing: 2,
      yellowBg: true
    }
  };
  return styles[styleName] || styles.fire;
}

function drawStyledText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, style: TextStylePreset) {
  const displayText = style.uppercase ? text.toUpperCase() : text;
  
  ctx.save();
  ctx.font = `900 ${style.fontSize}px 'Pyidaungsu', 'Noto Sans Myanmar', sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Yellow background strip for youtube style
  if (style.yellowBg) {
    const metrics = ctx.measureText(displayText);
    const bgW = metrics.width + 24;
    const bgH = style.fontSize + 16;
    ctx.fillStyle = "rgba(255,220,0,0.85)";
    ctx.fillRect(x - bgW / 2, y - bgH / 2, bgW, bgH);
  }

  // Step 1: Glow shadow
  ctx.shadowColor = style.glowColor;
  ctx.shadowBlur = style.glowBlur;

  // Step 2: Stroke (drawn FIRST)
  ctx.lineWidth = style.strokeWidth;
  ctx.strokeStyle = style.strokeColor;
  ctx.strokeText(displayText, x, y);

  // Step 3: Clear shadow before fill
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";

  // Step 4: Gradient or solid fill
  if (style.solidFill) {
    ctx.fillStyle = style.solidFill;
  } else {
    const grad = ctx.createLinearGradient(x, y - style.fontSize / 2, x, y + style.fontSize / 2);
    const stops = style.gradient;
    stops.forEach((color: string, i: number) => {
      grad.addColorStop(i / (stops.length - 1), color);
    });
    ctx.fillStyle = grad;
  }

  // Step 5: Fill on top
  ctx.fillText(displayText, x, y);
  ctx.restore();
}

// MAIN FUNCTION - call this to draw text on canvas
function applyTextOverlay(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, text: string, position: string, styleName: string) {
  const lines = text.split("\n");
  const style = getTextStyle(styleName, text);
  const lineHeight = style.fontSize * 1.3;
  const totalHeight = lines.length * lineHeight;
  const padding = 80;

  let x = canvas.width / 2;
  let startY;
  let textAlign: CanvasTextAlign = 'center';

  // Position logic (Enhanced from 3-state to handle all 7 states)
  switch (position) {
    case 'top-left': x = padding; startY = padding + style.fontSize/2; textAlign = 'left'; break;
    case 'top-center': x = canvas.width / 2; startY = padding + style.fontSize/2; textAlign = 'center'; break;
    case 'top-right': x = canvas.width - padding; startY = padding + style.fontSize/2; textAlign = 'right'; break;
    case 'middle': x = canvas.width / 2; startY = (canvas.height - totalHeight) / 2 + style.fontSize / 2; textAlign = 'center'; break;
    case 'bottom-left': x = padding; startY = canvas.height - padding - totalHeight + style.fontSize/2; textAlign = 'left'; break;
    case 'bottom-center': x = canvas.width / 2; startY = canvas.height - padding - totalHeight + style.fontSize/2; textAlign = 'center'; break;
    case 'bottom-right': x = canvas.width - padding; startY = canvas.height - padding - totalHeight + style.fontSize/2; textAlign = 'right'; break;
    default: x = canvas.width / 2; startY = (canvas.height - totalHeight) / 2 + style.fontSize / 2; textAlign = 'center';
  }

  ctx.textAlign = textAlign;

  lines.forEach((line, i) => {
    drawStyledText(ctx, line.trim(), x, startY + i * lineHeight, style);
  });
}

export const ThumbnailCreator: React.FC<ThumbnailTabProps> = ({ 
  isDarkMode, 
  showToast, 
  getApiKey,
  isAdmin,
  isPremium
}) => {
  const { t } = useLanguage();
  const [platform, setPlatform] = useState<Platform>(PLATFORMS[0]);
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);

  // Text Overlay State
  const [overlayText, setOverlayText] = useState('');
  const [fontSize, setFontSize] = useState(60);
  const [textPosition, setTextPosition] = useState('middle');
  const [textStyle, setTextStyle] = useState('fire');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isApplyingText, setIsApplyingText] = useState(false);

  const isThumbnailRestricted = false;
  const canUseThumbnail = isAdmin || isPremium;

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
      const gemini = new GeminiTTSService(apiKey, isAdmin);
      const aspectRatio = platform.aspectRatio;
      const resolution = `${platform.width}x${platform.height}`;

      const preset = THUMBNAIL_PRESETS.find(p => p.id === selectedPreset);

      const enhancedPrompt = `Create a professional ${platform.name} thumbnail BACKGROUND image only.
Platform: ${platform.name} (${resolution}, ${aspectRatio} aspect ratio)
${preset ? `Style: ${preset.promptPrefix}` : 'Style: Cinematic, dramatic lighting, vivid colors, high contrast, professional'}
Requirements:
- Do NOT include any text, letters, numbers, or typography in the image
- Create a visually stunning background scene only
- Strong focal point, depth of field
- Suitable as a YouTube/social media thumbnail background
${preset ? `Theme: ${preset.bgHint}` : ''}

Scene description: ${prompt}

${preset ? `Additional style: ${preset.promptSuffix}` : ''}
CRITICAL: Generate ONLY the background visual. NO TEXT of any kind in the image.`;

      const dataUrl = await gemini.generateImage(enhancedPrompt);
      
      // The service returns a full data URL (data:image/png;base64,...)
      // But the component adds the prefix itself: src={`data:image/png;base64,${generatedImage}`}
      // So I should strip the prefix if it exists, or update the component.
      // Let's strip it for compatibility or update the component to take full dataUrl.
      const base64Content = dataUrl.includes('base64,') ? dataUrl.split('base64,')[1] : dataUrl;
      
      setGeneratedImage(base64Content);
      setPreviewImage(`data:image/png;base64,${base64Content}`);
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
    if (!previewImage) return;

    setIsExporting(true);
    try {
      const link = document.createElement('a');
      link.download = `vbs_thumbnail_${platform.id}_${Date.now()}.png`;
      link.href = previewImage;
      link.click();
      showToast('Thumbnail downloaded!', 'success');
    } catch (err) {
      console.error('Download error:', err);
      showToast('Failed to download thumbnail.', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const handleApplyText = async () => {
    if (!generatedImage) return;
    setIsApplyingText(true);

    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Could not get canvas context");

      const img = new Image();
      img.crossOrigin = "anonymous";
      
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = `data:image/png;base64,${generatedImage}`;
      });

      canvas.width = platform.width;
      canvas.height = platform.height;

      // Draw background
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      if (overlayText.trim()) {
        await document.fonts.load(`${fontSize}px "Noto Sans Myanmar"`);
        applyTextOverlay(ctx, canvas, overlayText, textPosition, textStyle);
      }

      setPreviewImage(canvas.toDataURL('image/png'));
    } catch (err) {
      console.error("Text application error:", err);
      showToast("စာသားထည့်သွင်းမှု အမှားဖြစ်သွားပါသည်", "error");
    } finally {
      setIsApplyingText(false);
    }
  };

  if (!isAdmin && !isPremium) {
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

  if (isThumbnailRestricted) {
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

        {/* Preset Themes */}
        <div className="glass-card p-6 rounded-[28px] border border-white/40 dark:border-slate-800/40 shadow-xl space-y-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-neon-magenta/10 rounded-xl text-neon-magenta">
              <Sparkles size={18} />
            </div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-white uppercase tracking-widest">Preset Themes</h3>
          </div>

          <div className="grid grid-cols-5 gap-2">
            {THUMBNAIL_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => {
                  if (selectedPreset === preset.id) {
                    setSelectedPreset(null);
                  } else {
                    setSelectedPreset(preset.id);
                  }
                }}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl border transition-all ${
                  selectedPreset === preset.id
                    ? 'bg-brand-purple border-brand-purple text-white shadow-lg shadow-brand-purple/20'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-brand-purple/40'
                }`}
              >
                <span className="text-xl">{preset.emoji}</span>
                <span className="text-[9px] font-bold uppercase tracking-wider">{preset.label}</span>
              </button>
            ))}
          </div>

          {selectedPreset && (
            <div className="flex items-center gap-2 px-3 py-2 bg-brand-purple/10 rounded-xl border border-brand-purple/20">
              <span className="text-[10px] font-bold text-brand-purple uppercase tracking-widest">
                {THUMBNAIL_PRESETS.find(p => p.id === selectedPreset)?.emoji} {THUMBNAIL_PRESETS.find(p => p.id === selectedPreset)?.label} Theme Active
              </span>
              <button
                onClick={() => setSelectedPreset(null)}
                className="ml-auto text-[10px] text-slate-400 hover:text-red-500 font-bold transition-colors"
              >
                ✕ Clear
              </button>
            </div>
          )}
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

          {/* Text Overlay Section */}
          <div className="glass-card p-6 rounded-[28px] border border-white/40 dark:border-slate-800/40 shadow-xl space-y-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-brand-purple/10 rounded-xl text-brand-purple">
                <Type size={18} />
              </div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-white uppercase tracking-widest">ထည့်စေချင်သော စာသား (Text Overlay)</h3>
            </div>

            <div className="space-y-4">
              <div>
                <textarea
                  value={overlayText}
                  onChange={(e) => setOverlayText(e.target.value)}
                  placeholder="Enter text here..."
                  className="w-full h-24 px-4 py-3 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-purple/50 resize-none transition-all"
                />
              </div>

              {/* Font Size */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Font Size: {fontSize}px</label>
                </div>
                <input 
                  type="range" 
                  min="20" 
                  max="120" 
                  value={fontSize} 
                  onChange={(e) => setFontSize(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-brand-purple"
                />
              </div>

              {/* Positions */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                   <Layout size={12} /> Text Position
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {TEXT_POSITIONS.map(pos => (
                    <button
                      key={pos.id}
                      onClick={() => setTextPosition(pos.id)}
                      className={`py-2 px-1 rounded-xl border text-[9px] font-bold transition-all ${
                        textPosition === pos.id 
                          ? 'bg-brand-purple border-brand-purple text-white' 
                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500'
                      }`}
                    >
                      {pos.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Look/Styles */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                   <Palette size={12} /> Style Preset
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {TEXT_STYLES.map(style => (
                    <button
                      key={style.id}
                      onClick={() => setTextStyle(style.id)}
                      className={`py-2 px-1 rounded-xl border text-[9px] font-bold transition-all ${
                        textStyle === style.id 
                          ? 'bg-brand-purple border-brand-purple text-white' 
                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500'
                      }`}
                    >
                      {style.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleApplyText}
                disabled={!generatedImage || isApplyingText}
                className="w-full py-3 bg-slate-100 dark:bg-white/5 hover:bg-brand-purple hover:text-white text-slate-600 dark:text-slate-400 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all border border-slate-200 dark:border-slate-800 hover:border-brand-purple"
              >
                {isApplyingText ? 'Applying...' : 'Apply Text'}
              </button>
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
                    src={previewImage || ''} 
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
