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
      <div className="bg-white/[0.02] backdrop-blur-3xl rounded-[40px] p-12 sm:p-20 shadow-2xl flex flex-col items-center justify-center text-center border border-rose-500/20 group animate-pulse-soft">
        <div className="w-24 h-24 bg-rose-500/10 rounded-[32px] flex items-center justify-center text-rose-500 mb-8 border border-rose-500/30 group-hover:scale-110 transition-transform duration-500 shadow-[0_0_40px_rgba(244,63,94,0.2)]">
          <AlertCircle size={48} />
        </div>
        <h3 className="text-3xl font-black mb-4 text-white tracking-tight uppercase">{t('common.error')}</h3>
        <p className="text-slate-500 text-base max-w-sm leading-relaxed mb-10 font-medium">
          {error === 'SERVER_BUSY_RETRY' ? 'The AI engine is currently under heavy load. Please attempt your generation again.' : error}
        </p>
        <button
          onClick={onRetry}
          className="flex items-center gap-3 px-10 py-5 bg-white text-black rounded-2xl font-black uppercase tracking-widest shadow-2xl hover:scale-105 active:scale-95 transition-all"
        >
          <RefreshCw size={20} />
          Retry Studio Process
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="bg-white/[0.02] backdrop-blur-3xl rounded-[40px] p-12 sm:p-20 shadow-2xl flex flex-col items-center justify-center text-center relative overflow-hidden border border-white/5">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-400/5 via-transparent to-purple-500/5 pointer-events-none" />
        
        <div className="relative mb-16">
          <LoadingWaveform />
          <div className="absolute -inset-24 bg-amber-400/10 blur-[100px] -z-10 animate-pulse" />
        </div>

        <motion.h3 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-4xl font-black mb-6 tracking-tighter text-white uppercase"
        >
          {t('output.generating')}
        </motion.h3>
        
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 1 }}
          className="space-y-4"
        >
          <p className="text-slate-500 max-w-xs leading-relaxed font-bold uppercase tracking-[0.2em] text-xs">
            {t('output.tuning')}
          </p>
          <div className="flex items-center justify-center gap-2">
            <div className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce [animation-delay:-0.3s] shadow-[0_0_8px_rgba(234,179,8,0.6)]" />
            <div className="w-1.5 h-1.5 bg-amber-400/60 rounded-full animate-bounce [animation-delay:-0.15s]" />
            <div className="w-1.5 h-1.5 bg-amber-400/30 rounded-full animate-bounce" />
          </div>
        </motion.div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="bg-white/[0.02] backdrop-blur-3xl rounded-[40px] p-12 sm:p-20 shadow-2xl flex flex-col items-center justify-center text-center group border border-white/5">
        <div className="w-24 h-24 bg-white/5 rounded-[32px] flex items-center justify-center text-slate-500 mb-8 border border-white/10 group-hover:scale-110 group-hover:border-amber-400/30 transition-all duration-500 shadow-inner">
          <Headphones size={48} />
        </div>
        <h3 className="text-3xl font-black mb-4 text-white tracking-tight uppercase">{t('output.emptyTitle')}</h3>
        <p className="text-slate-500 text-base max-w-xs leading-relaxed font-medium">
          {t('output.emptySubtitle')}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white/[0.02] backdrop-blur-3xl rounded-[40px] p-8 sm:p-12 border border-white/5 shadow-2xl relative overflow-hidden group">
      <div className="absolute top-0 right-0 w-64 h-64 bg-amber-400/5 blur-[100px] -z-10 group-hover:bg-amber-400/10 transition-colors duration-1000" />
      <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-500/5 blur-[100px] -z-10" />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-8 mb-12">
        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-black text-white tracking-tight uppercase flex items-center gap-5">
            <div className="p-3 bg-amber-400/10 rounded-2xl text-amber-400 shadow-lg shadow-amber-400/5">
              <Sparkles size={32} />
            </div>
            {t('output.title')}
          </h2>
          <p className="text-slate-500 text-sm font-medium">Professional Burmese generation ready for cinematic use.</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="px-6 py-2 bg-amber-400 text-black rounded-full text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-amber-400/10">
            {t('output.premiumOutput')}
          </div>
          {result && (
            <div className="px-5 py-2 bg-white/5 text-amber-400 border border-amber-400/20 rounded-full text-[10px] font-black uppercase tracking-widest">
              Duration: {formatMyanmarDuration(duration)}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-12">
        {/* Modern Audio Player Card */}
        <div className="bg-black/40 backdrop-blur-2xl rounded-[40px] p-10 border border-white/5 shadow-2xl relative overflow-hidden group/player flex flex-col items-center space-y-10">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-400/5 via-transparent to-transparent opacity-50 pointer-events-none" />
          
          {/* Waveform Visualizer Area */}
          <div className="relative h-40 w-full rounded-3xl overflow-hidden shrink-0 bg-black/60 shadow-inner border border-white/5 p-4">
            <canvas 
              ref={canvasRef} 
              className="w-full h-full"
              width={1200}
              height={160}
            />
          </div>

          <div className="w-full flex flex-col items-center gap-8">
            {/* Centered Play/Pause Button */}
            <button
              onClick={togglePlay}
              className="w-24 h-24 bg-amber-400 text-black rounded-full flex items-center justify-center shadow-[0_0_50px_rgba(234,179,8,0.3)] hover:shadow-[0_0_60px_rgba(234,179,8,0.5)] hover:scale-105 active:scale-95 transition-all group/play relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-tr from-white/20 to-transparent opacity-0 group-hover/play:opacity-100 transition-opacity" />
              {isPlaying ? (
                <Pause size={40} fill="currentColor" />
              ) : (
                <Play size={40} fill="currentColor" className="ml-2" />
              )}
            </button>

            {/* Timeline Bar (Scrubber) */}
            <div className="w-full space-y-4">
              <div className="relative flex items-center w-full px-2">
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.01}
                  value={currentTime}
                  onChange={handleSeek}
                  className="w-full h-2 bg-white/5 rounded-full appearance-none cursor-pointer accent-amber-400 hover:h-2.5 transition-all shadow-inner"
                  style={{
                    background: `linear-gradient(to right, #EAB308 0%, #EAB308 ${(currentTime / (duration || 1)) * 100}%, rgba(255, 255, 255, 0.05) ${(currentTime / (duration || 1)) * 100}%, rgba(255, 255, 255, 0.05) 100%)`
                  }}
                />
              </div>
              
              <div className="flex items-center justify-between w-full px-6">
                <span className="text-[10px] font-black font-mono text-slate-500 uppercase tracking-widest">
                  {formatTime(currentTime).split(',')[0]}
                </span>
                <span className="text-[10px] font-black font-mono text-slate-500 uppercase tracking-widest">
                  {formatTime(duration).split(',')[0]}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          {/* Subtitle Preview Box */}
          <div className="space-y-6">
            <div className="flex items-center justify-between px-2">
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-3">
                <FileText size={16} className="text-amber-400/50" /> {t('output.srtPreview')}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleCopy(currentSrt, 'srt')}
                  className="p-2.5 bg-white/5 rounded-xl text-slate-500 hover:text-amber-400 transition-all border border-white/5"
                  title={t('translator.copy')}
                >
                  {isSrtCopied ? <Check size={16} className="text-emerald-500" /> : <Clipboard size={16} />}
                </button>
              </div>
            </div>
            <div className="bg-black/60 border border-white/5 rounded-[32px] p-8 h-80 overflow-y-auto custom-scrollbar shadow-inner relative group/srt">
              <pre className="text-xs font-mono text-slate-400 whitespace-pre-wrap break-keep leading-relaxed tracking-tight">
                {currentSrt}
              </pre>
            </div>
          </div>

          {/* Action Column */}
          <div className="flex flex-col justify-between gap-6 py-2">
            <div className="space-y-4">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] px-2">Export Studio Assets</p>
              <div className="grid grid-cols-1 gap-4">
                <button
                  onClick={handleDownloadAudio}
                  className="flex items-center justify-center gap-4 py-6 bg-amber-400 text-black rounded-[24px] font-black uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-amber-400/5 group"
                >
                  <Music size={24} />
                  {t('output.downloadMp3')}
                </button>
                <button
                  onClick={() => downloadFile(currentSrt, `vlogs-by-saw-subs.srt`)}
                  className="flex items-center justify-center gap-4 py-6 bg-white/5 text-white rounded-[24px] font-black uppercase tracking-widest border border-white/10 hover:bg-white/10 transition-all group"
                >
                  <FileText size={24} />
                  {t('output.downloadSrt')}
                </button>
              </div>
            </div>

            {/* Status Information */}
            <div className="bg-white/5 rounded-[24px] p-6 border border-white/5 flex items-center justify-between shadow-2xl">
              <div className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full animate-pulse ${
                  engineStatus === 'ready' ? 'bg-emerald-500' : 
                  engineStatus === 'cooling' ? 'bg-amber-500' : 'bg-rose-500'
                } shadow-[0_0_8px_currentColor]`} />
                <div className="flex flex-col">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-0.5">Engine Status</span>
                  <span className={`text-xs font-black uppercase tracking-widest ${
                    engineStatus === 'ready' ? 'text-emerald-500' : 
                    engineStatus === 'cooling' ? 'text-amber-500' : 'text-rose-500'
                  }`}>
                    {engineStatus === 'ready' ? t('generate.engineReady') : 
                     engineStatus === 'cooling' ? `${t('generate.engineCooling')} (${retryCountdown}s)` : t('generate.engineLimit')}
                  </span>
                </div>
              </div>
              <Sparkles size={16} className="text-slate-700" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
