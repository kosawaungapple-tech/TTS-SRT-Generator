import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { Headphones, Play, Pause, FileText, Music, RefreshCw, Sparkles, Clipboard, Check, AlertCircle } from 'lucide-react';
import { AudioResult } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { formatTime, formatMyanmarDuration } from '../utils/audioUtils';

interface OutputPreviewProps {
  result: AudioResult | null;
  isLoading: boolean;
  globalVolume?: number;
  engineStatus?: 'ready' | 'cooling' | 'limit';
  retryCountdown?: number;
  error?: string | null;
  onRetry?: () => void;
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
  error = null,
  onRetry,
  showToast
}) => {
  const { t } = useLanguage();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playerVolume, setPlayerVolume] = useState(globalVolume !== undefined ? globalVolume / 100 : 0.8);
  const [currentSrt, setCurrentSrt] = useState('');
  const [isSrtCopied, setIsSrtCopied] = useState(false);
  
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const fallbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedTimeRef = useRef<number>(0);
  const gainNodeRef = useRef<GainNode | null>(null);
  const [isFallback, setIsFallback] = useState(false);

  // Set duration and current SRT from result
  useEffect(() => {
    if (result) {
      setCurrentSrt(result.srtContent || '');
      setDuration(result.baseDuration);
    }
  }, [result]);

  // Handle Playback Speed change
  // Note: We ignore playbackSpeed for the audio node because the speed is already baked into the file
  useEffect(() => {
    if (result) {
      setDuration(result.baseDuration);
    }
  }, [result]);

  // Initialize/Reset Player when result changes
  useEffect(() => {
    if (result) {
      stopAudio();
      setCurrentTime(0);
      pausedTimeRef.current = 0;
      audioBufferRef.current = null;
      
      // Decode audio data early
      const decode = async () => {
        try {
          let bufferToDecode: ArrayBuffer;
          
          if (result.rawAudio) {
            bufferToDecode = result.rawAudio;
          } else {
            const binaryStr = window.atob(result.audioData);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }
            bufferToDecode = bytes.buffer;
          }
          
          if (!audioContextRef.current) {
            const AudioContextClass = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
            audioContextRef.current = new AudioContextClass();
          }
          
          try {
            // slice(0) to avoid detached buffer issues if decoded multiple times
            const buffer = await audioContextRef.current.decodeAudioData(bufferToDecode.slice(0));
            audioBufferRef.current = buffer;
            setDuration(buffer.duration);
            setIsFallback(false);
          } catch (decodeErr) {
            console.error("Decode failed, preparing fallback:", decodeErr);
            setIsFallback(true);
            setupFallbackAudio(bufferToDecode);
          }
        } catch (err) {
          console.error("Error in decode process:", err);
          setIsFallback(true);
        }
      };
      decode();
    }
    return () => {
      stopAudio();
      if (fallbackAudioRef.current) {
        fallbackAudioRef.current.pause();
        fallbackAudioRef.current = null;
      }
    };
  }, [result]);

  const setupFallbackAudio = (data: ArrayBuffer) => {
    // Gemini returns WAV
    const blob = new Blob([data], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.playbackRate = 1.0; 
    
    audio.onended = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      pausedTimeRef.current = 0;
    };

    audio.ontimeupdate = () => {
      if (isFallback) {
        setCurrentTime(audio.currentTime);
      }
    };

    audio.onloadedmetadata = () => {
      setDuration(audio.duration);
    };

    fallbackAudioRef.current = audio;
  };

  const stopAudio = () => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch {
        // Already stopped
      }
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    
    if (fallbackAudioRef.current) {
      fallbackAudioRef.current.pause();
    }
    
    setIsPlaying(false);
  };

  useEffect(() => {
    if (globalVolume !== undefined) {
      setPlayerVolume(globalVolume / 100);
    }
  }, [globalVolume]);

  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = playerVolume;
    }
  }, [playerVolume]);

  const initAudioContext = () => {
    if (!audioContextRef.current) {
      const AudioContextClass = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
      audioContextRef.current = new AudioContextClass();
    }
    
    if (!analyserRef.current && audioContextRef.current) {
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      
      gainNodeRef.current = audioContextRef.current.createGain();
      gainNodeRef.current.gain.value = playerVolume;
      
      gainNodeRef.current.connect(analyserRef.current);
      analyserRef.current.connect(audioContextRef.current.destination);
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

  useEffect(() => {
    let interval: number;
    if (isPlaying && audioContextRef.current) {
      interval = window.setInterval(() => {
        if (audioContextRef.current) {
          const elapsed = (audioContextRef.current.currentTime - startTimeRef.current);
          const newTime = Math.min(elapsed, duration);
          setCurrentTime(newTime);
          if (newTime >= duration) {
            setIsPlaying(false);
          }
        }
      }, 50);
    }
    return () => clearInterval(interval);
  }, [isPlaying, duration]);

  const togglePlay = async () => {
    if (isFallback) {
      if (!fallbackAudioRef.current) return;
      
      if (isPlaying) {
        fallbackAudioRef.current.pause();
        setIsPlaying(false);
      } else {
        fallbackAudioRef.current.currentTime = currentTime;
        fallbackAudioRef.current.play();
        setIsPlaying(true);
      }
      return;
    }

    if (!audioBufferRef.current || !audioContextRef.current) return;

    if (isPlaying) {
      pausedTimeRef.current = currentTime;
      stopAudio();
    } else {
      initAudioContext();
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBufferRef.current;
      source.playbackRate.value = 1.0; 
      source.connect(gainNodeRef.current!);
      
      source.start(0, currentTime);
      sourceNodeRef.current = source;
      startTimeRef.current = audioContextRef.current.currentTime - currentTime;
      
      setIsPlaying(true);

      source.onended = () => {
        // Only reset if it ended naturally
        if (sourceNodeRef.current === source) {
          setIsPlaying(false);
          if (currentTime >= duration - 0.1) {
            setCurrentTime(0);
            pausedTimeRef.current = 0;
          }
        }
      };
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    pausedTimeRef.current = newTime;
    
    if (isFallback && fallbackAudioRef.current) {
      fallbackAudioRef.current.currentTime = newTime;
    }

    if (isPlaying) {
      stopAudio();
      togglePlay();
    }
  };

  const handleDownloadAudio = async () => {
    if (!result) return;
    try {
      showToast(t('output.tuning'), 'success');
      
      let audioBlob: Blob;
      if (result.rawAudio) {
        audioBlob = new Blob([result.rawAudio], { type: 'audio/wav' });
      } else {
        const binaryStr = window.atob(result.audioData);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        audioBlob = new Blob([bytes], { type: 'audio/wav' });
      }

      const filename = `vlogs-by-saw-audio`;
      const url = URL.createObjectURL(audioBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.wav`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download failed:", err);
      showToast("Download failed", "error");
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
      }
      showToast(t('generate.copySuccess'), 'success');
    } catch {
      console.error('Failed to copy text');
    }
  };

  if (error && !isLoading) {
    return (
      <div className="glass-card rounded-[32px] p-12 sm:p-20 shadow-2xl flex flex-col items-center justify-center text-center transition-all duration-300 border border-rose-500/20 bg-rose-500/5 group">
        <div className="w-24 h-24 bg-rose-50 dark:bg-rose-950/20 rounded-[32px] flex items-center justify-center text-rose-500 mb-8 border border-rose-200 dark:border-rose-800/50 group-hover:scale-110 transition-transform duration-500 shadow-inner">
          <AlertCircle size={48} />
        </div>
        <h3 className="text-2xl font-bold mb-3 text-slate-900 dark:text-white tracking-tight">{t('common.error')}</h3>
        <p className="text-slate-500 dark:text-slate-400 text-sm sm:text-base max-w-sm leading-relaxed mb-8">
          {error === 'SERVER_BUSY_RETRY' ? 'Server Busy - Please Retry' : error}
        </p>
        <button
          onClick={onRetry}
          className="flex items-center gap-3 px-8 py-4 bg-brand-purple text-white rounded-2xl font-bold shadow-xl shadow-brand-purple/20 hover:bg-brand-purple/90 transition-all active:scale-95"
        >
          <RefreshCw size={20} />
          Retry Generation
        </button>
      </div>
    );
  }

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
        <div className="flex flex-wrap items-center gap-3">
          <div className="px-5 py-2 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-full text-[10px] font-bold uppercase tracking-[0.15em] w-fit shadow-sm neon-glow-indigo">
            {t('output.premiumOutput')}
          </div>
          {result && (
            <div className="px-4 py-2 bg-brand-purple/10 text-brand-purple border border-brand-purple/20 rounded-full text-[10px] font-bold uppercase tracking-tight w-fit">
              တကယ်ကြာချိန်: {formatMyanmarDuration(duration)}
            </div>
          )}
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
                  max={duration || 0}
                  step={0.01}
                  value={currentTime}
                  onChange={handleSeek}
                  className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full appearance-none cursor-pointer accent-brand-purple hover:h-2 transition-all"
                  style={{
                    background: `linear-gradient(to right, #8B5CF6 0%, #3B82F6 ${(currentTime / (duration || 1)) * 100}%, transparent ${(currentTime / (duration || 1)) * 100}%, transparent 100%)`
                  }}
                />
              </div>
              
              <div className="flex items-center justify-between w-full px-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-900 dark:text-white">
                    {formatTime(currentTime).split(',')[0]}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-slate-900 dark:text-white">
                    {formatTime(duration).split(',')[0]}
                  </span>
                </div>
              </div>
            </div>

          </div>
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
                onClick={handleDownloadAudio}
                className="flex items-center justify-center gap-3 py-4 bg-brand-purple/10 text-brand-purple rounded-2xl font-bold hover:bg-brand-purple hover:text-white transition-all border border-brand-purple/20 group"
              >
                <Music size={20} className="group-hover:scale-110 transition-transform" />
                {t('output.downloadMp3')}
              </button>
              <button
                onClick={() => downloadFile(currentSrt, `vlogs-by-saw-subs.srt`)}
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
