import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Headphones, Download, Play, Pause, FileText, Music, Volume2, VolumeX, RefreshCw, Sparkles, Clipboard, Check } from 'lucide-react';
import { AudioResult } from '../types';
import { useLanguage } from '../contexts/LanguageContext';

interface OutputPreviewProps {
  result: AudioResult | null;
  isLoading: boolean;
  globalVolume?: number;
  engineStatus?: 'ready' | 'cooling' | 'limit';
  retryCountdown?: number;
  targetDuration?: {
    minutes: number;
    seconds: number;
  };
  showToast: (message: string, type: 'success' | 'error') => void;
}

const LoadingWaveform = () => {
  return (
    <div className="flex items-center justify-center gap-1.5 h-20">
      {[...Array(16)].map((_, i) => (
        <motion.div
          key={i}
          className="w-2 bg-gradient-to-t from-brand-purple via-neon-indigo to-neon-magenta rounded-full"
          animate={{
            height: [
              15 + Math.random() * 10, 
              40 + Math.random() * 40, 
              15 + Math.random() * 10
            ],
            opacity: [0.4, 1, 0.4],
          }}
          transition={{
            duration: 0.6 + Math.random() * 0.4,
            repeat: Infinity,
            delay: i * 0.04,
            ease: "easeInOut",
          }}
          style={{
            boxShadow: '0 0 20px rgba(139, 92, 246, 0.4)',
          }}
        />
      ))}
    </div>
  );
};

export const OutputPreview: React.FC<OutputPreviewProps> = ({ 
  result, 
  isLoading, 
  globalVolume,
  engineStatus = 'ready',
  retryCountdown = 0,
  targetDuration,
  showToast
}) => {
  const { t } = useLanguage();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playerVolume, setPlayerVolume] = useState(globalVolume !== undefined ? globalVolume / 100 : 0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [currentSrt, setCurrentSrt] = useState('');
  const [isSrtCopied, setIsSrtCopied] = useState(false);
  const [isTextCopied, setIsTextCopied] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  useEffect(() => {
    if (audioRef.current && result) {
      const audio = audioRef.current;
      audio.load();
      setCurrentSrt(result.srtContent);

      const updateTime = () => setCurrentTime(audio.currentTime);
      const updateDuration = () => setDuration(audio.duration);
      const onEnded = () => setIsPlaying(false);

      audio.addEventListener('timeupdate', updateTime);
      audio.addEventListener('loadedmetadata', updateDuration);
      audio.addEventListener('ended', onEnded);

      // Auto-sync playback rate if target duration is set
      if (targetDuration) {
        const targetSeconds = targetDuration.minutes * 60 + targetDuration.seconds;
        if (targetSeconds > 0) {
          const syncRate = () => {
            if (audio.duration > 0) {
              const rate = audio.duration / targetSeconds;
              audio.playbackRate = rate;
              console.log(`Auto-sync: Adjusting playback rate to ${rate.toFixed(3)} to match target ${targetSeconds}s`);
            }
          };
          audio.addEventListener('loadedmetadata', syncRate);
          syncRate();
        }
      }

      return () => {
        audio.removeEventListener('timeupdate', updateTime);
        audio.removeEventListener('loadedmetadata', updateDuration);
        audio.removeEventListener('ended', onEnded);
      };
    }
  }, [result]);

  useEffect(() => {
    if (globalVolume !== undefined) {
      setPlayerVolume(globalVolume / 100);
    }
  }, [globalVolume]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : playerVolume;
    }
  }, [playerVolume, isMuted]);

  const initAudioContext = () => {
    if (!audioContextRef.current && audioRef.current) {
      const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
      audioContextRef.current = new AudioContextClass();
      analyserRef.current = audioContextRef.current.createAnalyser();
      sourceRef.current = audioContextRef.current.createMediaElementSource(audioRef.current);
      sourceRef.current.connect(analyserRef.current);
      analyserRef.current.connect(audioContextRef.current.destination);
      analyserRef.current.fftSize = 256;
    }
  };

  const drawWaveform = () => {
    if (!canvasRef.current || !analyserRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const renderFrame = () => {
      animationRef.current = requestAnimationFrame(renderFrame);
      analyserRef.current!.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      // Add a subtle pulsing effect based on overall volume
      const average = dataArray.reduce((a, b) => a + b, 0) / bufferLength;
      const pulseScale = 1 + (average / 255) * 0.2;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255) * canvas.height * pulseScale;

        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, '#8B5CF6'); // brand-purple
        gradient.addColorStop(0.5, '#6366F1'); // neon-indigo
        gradient.addColorStop(1, '#D946EF'); // neon-magenta

        ctx.fillStyle = gradient;
        
        // Center the waveform vertically
        const y = (canvas.height - barHeight) / 2;
        
        // Add rounded corners to bars
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth - 2, barHeight, 4);
        ctx.fill();

        x += barWidth;
      }
    };

    renderFrame();
  };

  useEffect(() => {
    if (isPlaying) {
      initAudioContext();
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume();
      }
      drawWaveform();
    } else {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    }
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying]);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const totalTargetSeconds = targetDuration ? (targetDuration.minutes * 60 + targetDuration.seconds) : 0;
  const displayDuration = totalTargetSeconds > 0 ? totalTargetSeconds : duration;
  const displayCurrentTime = (totalTargetSeconds > 0 && duration > 0) 
    ? (currentTime * (totalTargetSeconds / duration)) 
    : currentTime;

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (audioRef.current) {
      const displayTime = parseFloat(e.target.value);
      const actualTime = (totalTargetSeconds > 0 && duration > 0)
        ? (displayTime * (duration / totalTargetSeconds))
        : displayTime;
      audioRef.current.currentTime = actualTime;
      setCurrentTime(actualTime);
    }
  };

  const downloadFile = (content: string | Blob, fileName: string) => {
    let blob: Blob;
    if (typeof content === 'string') {
      if (fileName.endsWith('.srt')) {
        // Add UTF-8 BOM for mobile compatibility
        const BOM = '\uFEFF';
        blob = new Blob([BOM + content], { type: 'text/srt;charset=utf-8' });
      } else {
        blob = new Blob([content], { type: 'text/plain' });
      }
    } else {
      blob = content;
    }
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName.toLowerCase(); // Ensure lowercase .srt
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = async (textToCopy: string, type: 'srt' | 'text') => {
    try {
      await navigator.clipboard.writeText(textToCopy);
      if (type === 'srt') {
        setIsSrtCopied(true);
        setTimeout(() => setIsSrtCopied(false), 2000);
      } else {
        setIsTextCopied(true);
        setTimeout(() => setIsTextCopied(false), 2000);
      }
      showToast(t('generate.copySuccess'), 'success');
    } catch (err) {
      console.error('Failed to copy text');
    }
  };

  if (isLoading) {
    return (
      <div className="relative p-[1px] rounded-[32px] overflow-hidden group">
        {/* Gradient Border Wrapper */}
        <div className="absolute inset-0 bg-gradient-to-br from-brand-purple via-neon-indigo to-neon-magenta opacity-40 animate-pulse-soft" />
        
        <div className="premium-glass rounded-[32px] p-12 sm:p-20 shadow-2xl flex flex-col items-center justify-center text-center transition-all duration-300 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-brand-purple/10 via-transparent to-neon-indigo/10 pointer-events-none" />
          
          <div className="relative mb-12">
            <LoadingWaveform />
            {/* Glow Effect */}
            <div className="absolute -inset-16 bg-brand-purple/20 blur-[80px] -z-10 animate-pulse" />
          </div>

          <motion.h3 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-2xl sm:text-3xl font-bold mb-4 tracking-tight bg-gradient-to-r from-brand-purple via-neon-indigo to-neon-magenta bg-clip-text text-transparent drop-shadow-sm"
          >
            {t('output.generating')}
          </motion.h3>
          
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 1 }}
            className="space-y-2"
          >
            <p className="text-slate-500 dark:text-slate-400 max-w-xs leading-relaxed font-medium">
              {t('output.tuning')}
            </p>
            <div className="flex items-center justify-center gap-1.5">
              <div className="w-1 h-1 bg-brand-purple rounded-full animate-bounce [animation-delay:-0.3s]" />
              <div className="w-1 h-1 bg-neon-indigo rounded-full animate-bounce [animation-delay:-0.15s]" />
              <div className="w-1 h-1 bg-neon-magenta rounded-full animate-bounce" />
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="glass-card rounded-[32px] p-12 sm:p-20 shadow-2xl flex flex-col items-center justify-center text-center transition-all duration-300 group">
        <div className="w-24 h-24 bg-slate-50 dark:bg-slate-900/50 rounded-[32px] flex items-center justify-center text-slate-400 dark:text-slate-600 mb-8 border border-slate-200 dark:border-slate-800 group-hover:scale-110 transition-transform duration-500 shadow-inner">
          <Headphones size={48} />
        </div>
        <h3 className="text-2xl font-bold mb-3 text-slate-900 dark:text-white tracking-tight">{t('output.emptyTitle')}</h3>
        <p className="text-slate-500 dark:text-slate-400 text-sm sm:text-base max-w-xs leading-relaxed">
          {t('output.emptySubtitle')}
        </p>
      </div>
    );
  }

  return (
    <div className="premium-glass rounded-[32px] p-8 sm:p-12 shadow-2xl space-y-10 transition-all duration-300 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-64 h-64 bg-brand-purple/10 blur-[100px] -z-10" />
      <div className="absolute bottom-0 left-0 w-64 h-64 bg-neon-magenta/10 blur-[100px] -z-10" />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <h2 className="text-2xl sm:text-3xl font-bold flex items-center gap-4 text-slate-900 dark:text-white tracking-tight">
          <div className="p-2.5 bg-brand-purple/10 rounded-xl text-brand-purple animate-pulse-soft">
            <Sparkles size={28} />
          </div>
          {t('output.title')}
        </h2>
        <div className="px-5 py-2 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-full text-[10px] font-bold uppercase tracking-[0.15em] w-fit shadow-sm neon-glow-indigo">
          {t('output.premiumOutput')}
        </div>
      </div>

      <div className="space-y-8">
        {/* Modern Audio Player Card */}
        <div className="bg-slate-50/80 dark:bg-slate-800/40 backdrop-blur-md rounded-[32px] p-8 border border-slate-200/50 dark:border-slate-700/50 shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.1)] relative overflow-hidden group flex flex-col items-center space-y-8">
          <div className="absolute inset-0 bg-gradient-to-br from-brand-purple/5 via-transparent to-blue-500/5 pointer-events-none" />
          
          {/* Waveform Visualizer Area */}
          <div className="relative h-32 w-full rounded-2xl overflow-hidden shrink-0">
            <canvas 
              ref={canvasRef} 
              className="w-full h-full opacity-90"
              width={800}
              height={128}
            />
          </div>

          {/* Centered Play/Pause Button */}
          <div className="flex justify-center w-full relative z-10 shrink-0">
            <button
              onClick={togglePlay}
              className="w-20 h-20 bg-gradient-to-tr from-brand-purple to-blue-500 text-white rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(139,92,246,0.4)] hover:shadow-[0_0_40px_rgba(139,92,246,0.6)] hover:scale-105 active:scale-95 transition-all group/play"
            >
              {isPlaying ? (
                <Pause size={32} fill="currentColor" />
              ) : (
                <Play size={32} fill="currentColor" className="ml-1.5" />
              )}
            </button>
          </div>

          {/* Bottom Controls Area */}
          <div className="w-full flex flex-col gap-4 relative z-10">
            
            {/* Timeline Bar (Scrubber) */}
            <div className="w-full flex flex-col gap-2">
              <div className="relative flex items-center w-full group/slider">
                <input
                  type="range"
                  min={0}
                  max={displayDuration || 0}
                  step={0.01}
                  value={displayCurrentTime}
                  onChange={handleSeek}
                  className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full appearance-none cursor-pointer accent-brand-purple hover:h-2 transition-all"
                  style={{
                    background: `linear-gradient(to right, #8B5CF6 0%, #3B82F6 ${(displayCurrentTime / (displayDuration || 1)) * 100}%, transparent ${(displayCurrentTime / (displayDuration || 1)) * 100}%, transparent 100%)`
                  }}
                />
              </div>
              
              {/* Timestamps */}
              <div className="flex items-center justify-between w-full px-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-900 dark:text-white">
                    {formatDisplayTime(displayCurrentTime)}
                  </span>
                  {targetDuration && (
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-600">
                      / {formatDisplayTime(displayDuration)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {targetDuration && (
                    <div className="flex flex-col items-end gap-0.5">
                      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-brand-purple/5 rounded-md border border-brand-purple/10">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">{t('output.target')}:</span>
                        <span className="text-[10px] font-mono font-bold text-brand-purple">
                          {formatDisplayTime(targetDuration.minutes * 60 + targetDuration.seconds)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-slate-100/50 dark:bg-slate-800/50 rounded-md border border-slate-200/50 dark:border-slate-700/50">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">{t('output.original')}:</span>
                        <span className="text-[10px] font-mono font-bold text-slate-500">
                          {formatDisplayTime(duration)}
                        </span>
                      </div>
                    </div>
                  )}
                  {!targetDuration && (
                    <span className="text-xs font-medium text-slate-900 dark:text-white">
                      {formatDisplayTime(displayDuration)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Volume Control */}
            <div className="flex items-center justify-center w-full shrink-0">
              <div className="flex items-center gap-4 bg-slate-100/50 dark:bg-slate-800/50 px-6 py-3 rounded-2xl border border-slate-200/50 dark:border-slate-700/50">
                <button 
                  onClick={() => setIsMuted(!isMuted)}
                  className="text-slate-400 hover:text-brand-purple transition-colors p-1"
                >
                  {isMuted || playerVolume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
                </button>
                
                <div className="w-32 sm:w-48 flex items-center">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={isMuted ? 0 : playerVolume}
                    onChange={(e) => {
                      setPlayerVolume(parseFloat(e.target.value));
                      if (isMuted) setIsMuted(false);
                    }}
                    className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full appearance-none cursor-pointer accent-brand-purple"
                    style={{
                      background: `linear-gradient(to right, #8B5CF6 0%, #8B5CF6 ${(isMuted ? 0 : playerVolume) * 100}%, transparent ${(isMuted ? 0 : playerVolume) * 100}%, transparent 100%)`
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          <audio ref={audioRef} src={result.audioUrl} className="hidden" />
        </div>

      {/* Subtitle Preview Box */}
          <div className="space-y-3 flex-1">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <FileText size={14} /> {t('output.srtPreview')}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleCopy(currentSrt, 'srt')}
                  className="p-2 bg-slate-100 dark:bg-white/5 rounded-lg text-slate-500 hover:text-brand-purple transition-all"
                  title={t('translator.copy')}
                >
                  {isSrtCopied ? <Check size={14} className="text-emerald-500" /> : <Clipboard size={14} />}
                </button>
                {targetDuration && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand-purple/10 text-brand-purple border border-brand-purple/20">
                    Target: {targetDuration.minutes.toString().padStart(2, '0')}:{targetDuration.seconds.toString().padStart(2, '0')}.000
                  </span>
                )}
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 h-64 overflow-y-auto custom-scrollbar shadow-inner relative group/srt">
              <pre className="text-[11px] sm:text-xs font-mono text-slate-600 dark:text-slate-400 whitespace-pre-wrap break-keep leading-[1.6]">
                {currentSrt}
              </pre>
            </div>
          </div>

          {/* Download Buttons & Status */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                onClick={() => fetch(result.audioUrl).then(r => r.blob()).then(b => downloadFile(b, 'vlogs-by-saw-audio.mp3'))}
                className="flex items-center justify-center gap-3 py-4 bg-brand-purple/10 text-brand-purple rounded-2xl font-bold hover:bg-brand-purple hover:text-white transition-all border border-brand-purple/20 group"
              >
                <Music size={20} className="group-hover:scale-110 transition-transform" />
                {t('output.downloadMp3')}
              </button>
              <button
                onClick={() => downloadFile(currentSrt, 'vlogs-by-saw-subs.srt')}
                className="flex items-center justify-center gap-3 py-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-2xl font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all border border-slate-200 dark:border-slate-700 group"
              >
                <FileText size={20} className="group-hover:scale-110 transition-transform" />
                {t('output.downloadSrt')}
              </button>
            </div>

            {/* Subtle Engine Status Dot */}
            <div className="flex items-center justify-center gap-4 py-2">
              <div className="flex items-center gap-2 px-3 py-1 bg-slate-100/50 dark:bg-white/5 rounded-full border border-slate-200/50 dark:border-white/5">
                <div className={`w-2 h-2 rounded-full animate-pulse ${
                  engineStatus === 'ready' ? 'bg-emerald-500' : 
                  engineStatus === 'cooling' ? 'bg-amber-500' : 'bg-rose-500'
                }`} />
                <span className={`text-[10px] font-bold uppercase tracking-widest ${
                  engineStatus === 'ready' ? 'text-emerald-500' : 
                  engineStatus === 'cooling' ? 'text-amber-500' : 'text-rose-500'
                }`}>
                  {engineStatus === 'ready' ? t('generate.engineReady') : 
                   engineStatus === 'cooling' ? `${t('generate.engineCooling')} (${retryCountdown}s)` : t('generate.engineLimit')}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

function formatDisplayTime(seconds: number): string {
  if (isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
