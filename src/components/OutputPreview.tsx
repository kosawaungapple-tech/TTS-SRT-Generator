import React, { useState, useRef, useEffect } from 'react';
import { Headphones, Download, Play, Pause, FileText, Music, Volume2, VolumeX } from 'lucide-react';
import { AudioResult } from '../types';

interface OutputPreviewProps {
  result: AudioResult | null;
  isLoading: boolean;
  globalVolume?: number;
}

export const OutputPreview: React.FC<OutputPreviewProps> = ({ result, isLoading, globalVolume }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playerVolume, setPlayerVolume] = useState(globalVolume !== undefined ? globalVolume / 100 : 0.8);
  const [isMuted, setIsMuted] = useState(false);
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

      for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255) * canvas.height;

        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, '#8B5CF6'); // brand-purple
        gradient.addColorStop(1, '#3B82F6'); // blue-500

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

  const downloadFile = (content: string | Blob, fileName: string) => {
    const url = typeof content === 'string' 
      ? URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
      : URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 shadow-xl flex flex-col items-center justify-center text-center transition-colors duration-300">
        <div className="w-16 h-16 border-4 border-brand-purple/20 border-t-brand-purple rounded-full animate-spin mb-4" />
        <p className="text-slate-500 dark:text-slate-400">Generating your voiceover...</p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 shadow-xl flex flex-col items-center justify-center text-center transition-colors duration-300">
        <div className="w-20 h-20 bg-slate-50 dark:bg-slate-900 rounded-full flex items-center justify-center text-slate-400 dark:text-slate-600 mb-6 border border-slate-200 dark:border-slate-800">
          <Headphones size={40} />
        </div>
        <h3 className="text-lg font-semibold mb-2 text-slate-900 dark:text-white">Output Preview</h3>
        <p className="text-slate-500 dark:text-slate-400 text-sm max-w-xs">
          Generated audio and subtitles will appear here after you click generate.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[32px] p-8 sm:p-10 shadow-xl space-y-8 transition-colors duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold flex items-center gap-3 text-slate-900 dark:text-white">
          <Music className="text-brand-purple" size={24} />
          Output Preview
        </h2>
        <div className="px-4 py-1.5 bg-brand-purple/10 text-brand-purple rounded-full text-xs font-bold uppercase tracking-wider w-fit">
          Ready to Download
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
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <FileText size={14} /> Subtitle Preview (SRT)
            </h3>
            <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 h-40 overflow-y-auto custom-scrollbar shadow-inner">
              <pre className="text-[11px] sm:text-xs font-mono text-slate-600 dark:text-slate-400 whitespace-pre-wrap leading-relaxed">
                {result.srtContent}
              </pre>
            </div>
          </div>

          {/* Download Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              onClick={() => fetch(result.audioUrl).then(r => r.blob()).then(b => downloadFile(b, 'vlogs-by-saw-audio.mp3'))}
              className="flex items-center justify-center gap-3 py-4 bg-brand-purple/10 text-brand-purple rounded-2xl font-bold hover:bg-brand-purple hover:text-white transition-all border border-brand-purple/20 group"
            >
              <Music size={20} className="group-hover:scale-110 transition-transform" />
              Download MP3
            </button>
            <button
              onClick={() => downloadFile(result.srtContent, 'vlogs-by-saw-subs.srt')}
              className="flex items-center justify-center gap-3 py-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-2xl font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all border border-slate-200 dark:border-slate-700 group"
            >
              <FileText size={20} className="group-hover:scale-110 transition-transform" />
              Download SRT
            </button>
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
