import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Headphones, Download, Play, Pause, FileText, Music, Volume2, VolumeX, RefreshCw, Clock, Plus, Minus, Sparkles } from 'lucide-react';
import { AudioResult } from '../types';

interface OutputPreviewProps {
  result: AudioResult | null;
  isLoading: boolean;
  globalVolume?: number;
  engineStatus?: 'ready' | 'cooling' | 'limit';
  retryCountdown?: number;
}

export const OutputPreview: React.FC<OutputPreviewProps> = ({ 
  result, 
  isLoading, 
  globalVolume,
  engineStatus = 'ready',
  retryCountdown = 0
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playerVolume, setPlayerVolume] = useState(globalVolume !== undefined ? globalVolume / 100 : 0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [currentSrt, setCurrentSrt] = useState('');
  const [syncMs, setSyncMs] = useState<number>(0);
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
      setSyncMs(0);

      const updateTime = () => setCurrentTime(audio.currentTime);
      const updateDuration = () => setDuration(audio.duration);
      const onEnded = () => setIsPlaying(false);

      audio.addEventListener('timeupdate', updateTime);
      audio.addEventListener('loadedmetadata', updateDuration);
      audio.addEventListener('ended', onEnded);

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

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (audioRef.current) {
      const time = parseFloat(e.target.value);
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const timeToMs = (timeStr: string): number => {
    const [hms, ms] = timeStr.split(',');
    const [h, m, s] = hms.split(':').map(Number);
    return h * 3600000 + m * 60000 + s * 1000 + Number(ms);
  };

  const msToTime = (ms: number): string => {
    if (ms < 0) ms = 0;
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const mmm = Math.floor(ms % 1000);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${mmm.toString().padStart(3, '0')}`;
  };

  const adjustSync = (ms: number) => {
    if (!result) return;
    
    const blocks = result.srtContent.trim().split(/\n\s*\n/);
    const adjustedBlocks = blocks.map(block => {
      const lines = block.split('\n');
      if (lines.length < 3) return block;
      
      const timeLine = lines[1];
      const [startStr, endStr] = timeLine.split(' --> ');
      
      const newStart = msToTime(timeToMs(startStr) + ms);
      const newEnd = msToTime(timeToMs(endStr) + ms);
      
      lines[1] = `${newStart} --> ${newEnd}`;
      return lines.join('\n');
    });

    setCurrentSrt(adjustedBlocks.join('\n\n') + '\n\n');
    setSyncMs(prev => prev + ms);
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

  if (isLoading) {
    return (
      <div className="glass-card rounded-[32px] p-12 sm:p-20 shadow-2xl flex flex-col items-center justify-center text-center transition-all duration-300">
        <div className="relative">
          <div className="w-20 h-20 border-4 border-brand-purple/20 border-t-brand-purple rounded-full animate-spin mb-6" />
          <RefreshCw size={24} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-brand-purple animate-pulse" />
        </div>
        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Generating Audio...</h3>
        <p className="text-slate-500 dark:text-slate-400 max-w-xs">Our AI engine is crafting your professional Myanmar voiceover.</p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="glass-card rounded-[32px] p-12 sm:p-20 shadow-2xl flex flex-col items-center justify-center text-center transition-all duration-300 group">
        <div className="w-24 h-24 bg-slate-50 dark:bg-slate-900/50 rounded-[32px] flex items-center justify-center text-slate-400 dark:text-slate-600 mb-8 border border-slate-200 dark:border-slate-800 group-hover:scale-110 transition-transform duration-500 shadow-inner">
          <Headphones size={48} />
        </div>
        <h3 className="text-2xl font-bold mb-3 text-slate-900 dark:text-white tracking-tight">Output Preview</h3>
        <p className="text-slate-500 dark:text-slate-400 text-sm sm:text-base max-w-xs leading-relaxed">
          Generated audio and subtitles will appear here after you click generate.
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
          AI Narrator Studio
        </h2>
        <div className="px-5 py-2 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-full text-[10px] font-bold uppercase tracking-[0.15em] w-fit shadow-sm neon-glow-indigo">
          Premium Output
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
              
              {/* Timestamps */}
              <div className="flex items-center justify-between w-full px-1">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {formatDisplayTime(currentTime)}
                </span>
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {formatDisplayTime(duration)}
                </span>
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

        <div className="space-y-6">
          {/* Subtitle Preview Box */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <FileText size={14} /> Subtitle Preview (SRT)
              </h3>
              {syncMs !== 0 && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${syncMs > 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                  Sync: {syncMs > 0 ? '+' : ''}{syncMs}ms
                </span>
              )}
            </div>
            <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 h-40 overflow-y-auto custom-scrollbar shadow-inner">
              <pre className="text-[11px] sm:text-xs font-mono text-slate-600 dark:text-slate-400 whitespace-pre-wrap break-keep leading-[1.6]">
                {currentSrt}
              </pre>
            </div>
          </div>

          {/* Sync Adjustment Tool */}
          <div className="premium-glass border border-white/10 dark:border-white/5 rounded-[24px] p-6 space-y-4 neon-glow-indigo relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-neon-indigo/5 to-transparent pointer-events-none" />
            
            <div className="flex items-center justify-between relative z-10">
              <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <Clock size={14} className="text-neon-indigo" /> Sync Adjustment
              </h4>
              <button 
                onClick={() => {
                  setCurrentSrt(result.srtContent);
                  setSyncMs(0);
                }}
                className="text-[10px] font-bold text-neon-indigo hover:text-neon-magenta transition-colors uppercase tracking-wider"
              >
                Reset Sync
              </button>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-4 relative z-10">
              <div className="flex items-center gap-2 bg-white/50 dark:bg-slate-900/50 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2.5 w-full sm:w-auto shadow-inner">
                <input 
                  type="number" 
                  id="sync-input"
                  placeholder="ms"
                  className="bg-transparent text-sm font-bold w-20 focus:outline-none text-slate-900 dark:text-white"
                  defaultValue={100}
                />
                <span className="text-[10px] font-bold text-slate-400">MS</span>
              </div>

              <div className="flex items-center gap-3 w-full sm:w-auto">
                <motion.button 
                  whileHover={{ scale: 1.05, borderColor: '#D946EF' }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => {
                    const val = parseInt((document.getElementById('sync-input') as HTMLInputElement).value) || 0;
                    adjustSync(-val);
                  }}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 metallic-btn text-rose-500 rounded-xl text-xs font-bold transition-all border border-rose-500/20"
                >
                  <Minus size={14} /> Shift Back
                </motion.button>
                <motion.button 
                  whileHover={{ scale: 1.05, borderColor: '#D946EF' }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => {
                    const val = parseInt((document.getElementById('sync-input') as HTMLInputElement).value) || 0;
                    adjustSync(val);
                  }}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 metallic-btn text-emerald-500 rounded-xl text-xs font-bold transition-all border border-emerald-500/20"
                >
                  <Plus size={14} /> Shift Forward
                </motion.button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1 relative z-10">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-2">Presets:</span>
              {[ -1000, -500, 500, 1000 ].map(ms => (
                <motion.button
                  key={ms}
                  whileHover={{ scale: 1.1, borderColor: '#D946EF', backgroundColor: 'rgba(217, 70, 239, 0.1)' }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => adjustSync(ms)}
                  className="px-3 py-1.5 metallic-btn text-slate-600 dark:text-slate-300 rounded-lg text-[10px] font-bold transition-all border border-slate-200 dark:border-white/5"
                >
                  {ms > 0 ? '+' : ''}{ms/1000}s
                </motion.button>
              ))}
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
                Download MP3
              </button>
              <button
                onClick={() => downloadFile(currentSrt, 'vlogs-by-saw-subs.srt')}
                className="flex items-center justify-center gap-3 py-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-2xl font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all border border-slate-200 dark:border-slate-700 group"
              >
                <FileText size={20} className="group-hover:scale-110 transition-transform" />
                Download SRT
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
                  {engineStatus === 'ready' ? 'Engine: Ready' : 
                   engineStatus === 'cooling' ? `Cooling Down (${retryCountdown}s)` : 'Limit Reached'}
                </span>
              </div>
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

function parseSRTTime(timeStr: string): number {
  const [hms, ms] = timeStr.split(',');
  const [h, m, s] = hms.split(':').map(Number);
  return h * 3600 + m * 60 + s + Number(ms) / 1000;
}
