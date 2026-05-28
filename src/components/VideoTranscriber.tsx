import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { Upload, FileVideo, CheckCircle2, AlertCircle, Sparkles, Trash2, ShieldCheck, Lock } from 'lucide-react';
import { GeminiTTSService } from '../services/geminiService';
import { logActivity } from '../services/activityService';
import { translateError } from '../utils/errorUtils';
import { VBSUserControl } from '../types';
import { db, doc, updateDoc } from '../firebase';
import { useLanguage } from '../contexts/LanguageContext';

interface VideoTranscriberProps {
  onTranscriptionComplete: (text: string, duration?: number) => void;
  getApiKey: () => string | null;
  showToast: (message: string, type: 'success' | 'error') => void;
  isAdmin: boolean;
  userControl: VBSUserControl | null;
  isUsingAdminKey: boolean;
  allowVideoRecapAdminKey?: boolean;
}

export const VideoTranscriber: React.FC<VideoTranscriberProps> = ({ 
  onTranscriptionComplete, 
  getApiKey, 
  showToast,
  isAdmin,
  userControl,
  isUsingAdminKey,
  allowVideoRecapAdminKey = true
}) => {
  const { language, t } = useLanguage();
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (videoFile) {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        window.URL.revokeObjectURL(video.src);
        setVideoDuration(video.duration);
      };
      video.src = URL.createObjectURL(videoFile);
    } else {
      setVideoDuration(null);
    }
  }, [videoFile]);

  const isExpired = (() => {
    if (!userControl?.expiryDate) return false;
    try {
      const expiry = new Date(userControl.expiryDate);
      if (isNaN(expiry.getTime())) return false;
      return expiry.setHours(23, 59, 59, 999) < Date.now();
    } catch {
      return false;
    }
  })();
  const isPremium = isAdmin || (userControl?.membershipStatus === 'premium' && !isExpired);
  const isRecapRestricted = isUsingAdminKey && !allowVideoRecapAdminKey;

  const incrementUsage = async () => {
    if (isPremium) return;
    if (!userControl?.vbsId) return;

    const today = new Date().toDateString();
    const currentUsage = userControl.lastUsedDate === today ? userControl.dailyUsage : 0;
    const newCount = currentUsage + 1;
    
    try {
      await updateDoc(doc(db, 'user_controls', userControl.vbsId), {
        dailyUsage: newCount,
        lastUsedDate: today,
        updatedAt: new Date()
      });
    } catch (err) {
      console.error("Failed to update usage in Firestore:", err);
      // Fallback to localStorage if Firestore fails
      localStorage.setItem('vbs_transcription_usage', JSON.stringify({ date: today, count: newCount }));
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('video/')) {
        setVideoFile(file);
      } else {
        showToast(t('video.onlyVideos'), 'error');
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setVideoFile(e.target.files[0]);
    }
  };

  const handleTranscribe = async () => {
    if (!videoFile) return;

    if (!isAdmin) {
      if (userControl?.isBlocked) {
        showToast(t('video.blocked'), 'error');
        return;
      }

      if (!isPremium) {
        showToast(`${t('video.recapLocked')} - ${t('video.contactAdmin')} [${userControl?.vbsId || 'VBS-XXXX'}]`, 'error');
        return;
      }

      if (isRecapRestricted) {
        showToast(t('video.videoRecapLimited'), 'error');
        return;
      }
    }
    
    const rawKey = getApiKey();
    const apiKey = (rawKey || '').trim();
    if (!apiKey) {
      showToast(t('generate.noApiKey'), 'error');
      return;
    }

    setIsTranscribing(true);
    
    // Increment usage IMMEDIATELY to prevent bypass
    await incrementUsage();

    try {
      const gemini = new GeminiTTSService(apiKey);
      
      // Step 1: Transcribe using File API (Unified multi-step upload)
      const transcription = await gemini.transcribeVideoFile(videoFile);
      
      // Step 2: Auto-Translate to Burmese
      const translatedText = await gemini.translateContent(transcription);
      
      onTranscriptionComplete(translatedText, videoDuration || undefined);
      showToast(t('video.success'), 'success');
      
      if (userControl?.vbsId) {
        logActivity(userControl.vbsId, 'transcription', `Transcribed video: ${videoFile.name}`);
      }
      
      setVideoFile(null);
    } catch (err: unknown) {
      console.error('Transcription/Translation failed:', err);
      showToast(translateError(err as { message?: string; status?: number }, language), 'error');
    } finally {
      setIsTranscribing(false);
    }
  };

  if (!isAdmin && !isPremium) {
    return (
      <div className="premium-glass rounded-[32px] p-12 text-center shadow-2xl">
        <div className="w-20 h-20 bg-rose-500/10 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-6">
          <Lock size={40} />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">{t('video.recapLocked')}</h2>
        <p className="text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
          {t('video.contactAdmin')}
        </p>
      </div>
    );
  }

  if (isRecapRestricted) {
    return (
      <div className="premium-glass rounded-[32px] p-12 text-center shadow-2xl border border-amber-500/20">
        <div className="w-20 h-20 bg-amber-500/10 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertCircle size={40} />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">{t('admin.adminFeatureControl')}</h2>
        <p className="text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed italic">
          {t('video.videoRecapLimited')}
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
    <div className="premium-glass rounded-[32px] p-8 sm:p-12 shadow-2xl transition-all duration-300 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-64 h-64 bg-brand-purple/5 blur-[100px] -z-10" />
      
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold flex items-center gap-4 text-slate-900 dark:text-white tracking-tight">
            <div className="p-2.5 bg-brand-purple/10 rounded-xl text-brand-purple">
              <FileVideo size={24} />
            </div>
            {t('video.title')}
            <span className="text-[10px] bg-brand-purple/20 text-brand-purple px-3 py-1 rounded-full font-bold tracking-[0.15em] uppercase">
              Premium
            </span>
          </h2>
          <div className="flex items-center gap-3 mt-2">
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              {t('video.subtitle')}
            </p>
            {userControl?.vbsId && false && (
              <div className="flex items-center gap-2 px-2 py-0.5 bg-slate-100 dark:bg-white/5 rounded-md border border-slate-200 dark:border-white/10">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">ID:</span>
                <span className="text-[10px] font-mono font-bold text-brand-purple">{userControl.vbsId}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isPremium ? (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 text-emerald-600 rounded-full text-xs font-bold border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]"
            >
              <ShieldCheck size={14} />
              {t('video.premiumActive')}
            </motion.div>
          ) : null}
        </div>
      </div>

      {!videoFile ? (
        <div 
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative group cursor-pointer border-2 border-dashed rounded-[32px] p-12 sm:p-20 flex flex-col items-center justify-center text-center transition-all duration-300 ${
            dragActive 
              ? 'border-brand-purple bg-brand-purple/5 scale-[0.99]' 
              : 'border-slate-200 dark:border-slate-800 hover:border-brand-purple/50 hover:bg-slate-50/50 dark:hover:bg-white/5'
          }`}
        >
          <input 
            ref={fileInputRef}
            type="file" 
            accept="video/*" 
            onChange={handleFileChange}
            className="hidden" 
          />
          
          <div className="w-20 h-20 bg-slate-50 dark:bg-slate-900/50 rounded-[24px] flex items-center justify-center text-slate-400 dark:text-slate-600 mb-6 border border-slate-200 dark:border-slate-800 group-hover:scale-110 group-hover:text-brand-purple transition-all duration-500 shadow-inner">
            <Upload size={40} />
          </div>
          
          <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">{t('video.dragDrop')}</h3>
          <p className="text-slate-500 dark:text-slate-400 text-sm max-w-xs leading-relaxed">
            {t('video.supportFormats')}
          </p>
          
          {dragActive && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 bg-brand-purple/10 backdrop-blur-[2px] rounded-[32px] flex items-center justify-center"
            >
              <div className="bg-white dark:bg-slate-900 px-6 py-3 rounded-full shadow-xl border border-brand-purple/20 flex items-center gap-2">
                <CheckCircle2 className="text-brand-purple" size={20} />
                <span className="font-bold text-brand-purple">{t('video.dropToUpload')}</span>
              </div>
            </motion.div>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          <div className="bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-[24px] p-8 flex flex-col sm:flex-row items-center gap-6 relative group">
            <div className="w-16 h-16 bg-brand-purple/10 rounded-2xl flex items-center justify-center text-brand-purple shrink-0">
              <FileVideo size={32} />
            </div>
            <div className="flex-1 text-center sm:text-left overflow-hidden">
              <h4 className="font-bold text-slate-900 dark:text-white truncate">{videoFile.name}</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {(videoFile.size / (1024 * 1024)).toFixed(2)} MB • {videoFile.type}
              </p>
            </div>
            <button 
              onClick={() => setVideoFile(null)}
              className="p-3 text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 rounded-xl transition-all"
            >
              <Trash2 size={20} />
            </button>
          </div>

          <button
            onClick={handleTranscribe}
            disabled={isTranscribing}
            className="w-full py-6 rounded-[24px] font-bold text-xl shadow-2xl flex items-center justify-center gap-4 transition-all active:scale-[0.98] bg-brand-purple hover:bg-brand-purple/90 text-white shadow-brand-purple/40 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isTranscribing ? (
              <div className="flex items-center gap-1.5 h-6">
                {[...Array(4)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="w-1.5 bg-white rounded-full"
                    animate={{
                      height: [10, 24, 10],
                    }}
                    transition={{
                      duration: 0.6,
                      repeat: Infinity,
                      delay: i * 0.1,
                    }}
                  />
                ))}
              </div>
            ) : (
              <Sparkles size={28} />
            )}
            {isTranscribing ? t('video.transcribing') : t('video.transcribeBtn')}
          </button>
        </div>
      )}

      {isTranscribing && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-8 p-6 bg-brand-purple/5 rounded-[24px] border border-brand-purple/10 flex flex-col items-center text-center gap-4"
        >
          <div className="flex items-center gap-1.5 h-8">
            {[...Array(6)].map((_, i) => (
              <motion.div
                key={i}
                className="w-1.5 bg-brand-purple rounded-full"
                animate={{
                  height: [10, 30, 10],
                }}
                transition={{
                  duration: 0.8,
                  repeat: Infinity,
                  delay: i * 0.1,
                }}
              />
            ))}
          </div>
          <p className="text-sm font-bold text-brand-purple animate-pulse">
            {t('video.aiListening')}
          </p>
        </motion.div>
      )}
    </div>
  );
};
