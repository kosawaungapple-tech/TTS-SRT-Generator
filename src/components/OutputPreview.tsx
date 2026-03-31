import React, { useState, useRef, useEffect } from 'react';
import { Headphones, Download, Play, Pause, FileText, Music, Volume2, VolumeX, Copy, CheckCircle2 } from 'lucide-react';
import { AudioResult } from '../types';
import { safeClipboard } from '../utils/safeBrowser';

interface OutputPreviewProps {
  result: AudioResult | null;
  isLoading: boolean;
  globalVolume?: number;
  isAdmin?: boolean;
  onToast?: (message: string, type: 'success' | 'error') => void;
}

export const OutputPreview: React.FC<OutputPreviewProps> = ({ result, isLoading, globalVolume, isAdmin = false, onToast }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playerVolume, setPlayerVolume] = useState(globalVolume !== undefined ? globalVolume / 100 : 0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const retryCountRef = useRef(0);

  useEffect(() => {
    if (audioRef.current && result) {
      const audio = audioRef.current;
      setPlaybackError(null);
      retryCountRef.current = 0;
      
      // Reset audio element
      audio.pause();
      audio.currentTime = 0;
      audio.load();

      const updateTime = () => setCurrentTime(audio.currentTime);
      const updateDuration = () => setDuration(audio.duration);
      const onEnded = () => setIsPlaying(false);
      const onError = (e: any) => {
        const error = audio.error;
        console.error("OutputPreview: HTMLAudioElement error:", error);
        setPlaybackError(error ? `Audio Error: ${error.message || error.code}` : "Unknown audio error");
      };

      audio.addEventListener('timeupdate', updateTime);
      audio.addEventListener('loadedmetadata', updateDuration);
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);

      return () => {
        audio.removeEventListener('timeupdate', updateTime);
        audio.removeEventListener('loadedmetadata', updateDuration);
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
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
    if (audioContextRef.current || !audioRef.current) return;

    try {
      const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
      if (!AudioContextClass) {
        console.warn("OutputPreview: AudioContext not supported in this browser.");
        return;
      }

      audioContextRef.current = new AudioContextClass();
      analyserRef.current = audioContextRef.current.createAnalyser();
      
      // Only create source if not already connected (though ref check should handle this)
      try {
        sourceRef.current = audioContextRef.current.createMediaElementSource(audioRef.current);
        sourceRef.current.connect(analyserRef.current);
        analyserRef.current.connect(audioContextRef.current.destination);
        analyserRef.current.fftSize = 256;
      } catch (sourceErr) {
        console.warn("OutputPreview: Could not connect MediaElementSource (might already be connected):", sourceErr);
      }
    } catch (err) {
      console.error("OutputPreview: Failed to initialize AudioContext (visualization will be disabled):", err);
      audioContextRef.current = null;
      analyserRef.current = null;
      sourceRef.current = null;
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
      if (!analyserRef.current) return;
      animationRef.current = requestAnimationFrame(renderFrame);
      analyserRef.current.getByteFrequencyData(dataArray);

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
        
        // Add rounded corners to bars with fallback
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(x, y, barWidth - 2, barHeight, 4);
        } else {
          ctx.rect(x, y, barWidth - 2, barHeight);
        }
        ctx.fill();

        x += barWidth;
      }
    };

    renderFrame();
  };

  useEffect(() => {
    if (isPlaying) {
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

  const togglePlay = async () => {
    if (audioRef.current) {
      try {
        if (isPlaying) {
          audioRef.current.pause();
          setIsPlaying(false);
        } else {
          setPlaybackError(null);
          
          // Initialize AudioContext and resume on user gesture
          initAudioContext();
          if (audioContextRef.current?.state === 'suspended') {
            await audioContextRef.current.resume();
          }

          console.log("OutputPreview: Attempting to play audio...", result?.audioUrl);
          
          // Ensure audio is loaded and source is valid
          if (audioRef.current.readyState < 2) {
            console.log("OutputPreview: Audio not ready, calling load()...");
            audioRef.current.load();
          }
          
          try {
            await audioRef.current.play();
            setIsPlaying(true);
            retryCountRef.current = 0;
          } catch (playErr: any) {
            // If it's a NotSupportedError and we haven't retried yet, try reloading
            if (playErr.name === 'NotSupportedError' && retryCountRef.current < 2) {
              console.warn("OutputPreview: NotSupportedError detected. Attempting reload and retry...");
              retryCountRef.current++;
              audioRef.current.load();
              // Wait a bit for load to start
              await new Promise(resolve => setTimeout(resolve, 500));
              await audioRef.current.play();
              setIsPlaying(true);
            } else {
              throw playErr;
            }
          }
        }
      } catch (err: any) {
        console.error("OutputPreview: Audio playback failed:", err);
        
        let message = 'Audio playback failed.';
        
        // Handle specific errors
        if (err instanceof DOMException) {
          if (err.name === 'NotAllowedError') {
            message = 'Playback blocked. Please click play again.';
            console.warn("OutputPreview: Playback blocked by browser.");
          } else if (err.name === 'NotSupportedError') {
            message = 'Audio format not supported or file is corrupt.';
            console.error("OutputPreview: Format or operation not supported.");
          } else if (err.name === 'AbortError') {
            message = 'Playback was aborted.';
          }
        } else if (err.message) {
          message = err.message;
        }
        
        setPlaybackError(message);
        if (onToast) onToast(message, 'error');
        setIsPlaying(false);
      }
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
    const isSrt = fileName.toLowerCase().endsWith('.srt');
    let finalContent = content;
    let mimeType = isSrt ? 'application/x-subrip' : 'text/plain';

    if (isSrt && typeof content === 'string') {
      // Add UTF-8 BOM (\ufeff) for mobile compatibility
      finalContent = "\ufeff" + content;
    }

    const blob = typeof finalContent === 'string' 
      ? new Blob([finalContent], { type: mimeType })
      : finalContent;
      
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a); // Append to body for better cross-browser support
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = async (text: string) => {
    const success = await safeClipboard.writeText(text);
    if (success) {
      setIsCopying(true);
      if (onToast) onToast('Subtitles copied to clipboard!', 'success');
      setTimeout(() => setIsCopying(false), 2000);
    } else {
      if (onToast) onToast('Failed to copy. Please copy manually.', 'error');
    }
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
    <div className="space-y-8">
      {/* Card 1: Output Preview (Audio) */}
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
                title={isPlaying ? "Pause" : "Play"}
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
              
              {/* Playback Error Message */}
              {playbackError && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-center">
                  <p className="text-xs text-red-500 font-medium mb-2">{playbackError}</p>
                  <button 
                    onClick={() => {
                      setPlaybackError(null);
                      if (audioRef.current) {
                        audioRef.current.load();
                        setTimeout(() => togglePlay(), 500);
                      }
                    }}
                    className="text-[10px] uppercase tracking-wider font-bold text-red-600 dark:text-red-400 hover:underline"
                  >
                    Try Reloading
                  </button>
                </div>
              )}

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

            <audio 
              ref={audioRef} 
              src={result.audioUrl} 
              className="hidden" 
              playsInline
              preload="auto"
            />
          </div>

          {/* Download WAV Button */}
          <button
            onClick={() => fetch(result.audioUrl).then(r => r.blob()).then(b => downloadFile(b, 'vlogs-by-saw-audio.wav'))}
            className="w-full flex items-center justify-center gap-3 py-5 bg-brand-purple text-white rounded-[24px] font-bold hover:bg-brand-purple/90 transition-all shadow-xl shadow-brand-purple/20 group text-lg"
          >
            <Music size={22} className="group-hover:scale-110 transition-transform" />
            Download Audio (WAV)
          </button>
        </div>
      </div>

      {/* Card 2: Subtitle Preview (SRT) */}
      {isAdmin && (
        <div className="bg-white/50 backdrop-blur dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[32px] p-8 sm:p-10 shadow-xl space-y-6 transition-colors duration-300">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold flex items-center gap-3 text-slate-900 dark:text-white">
              <FileText className="text-amber-500" size={24} />
              Subtitle Preview (SRT)
            </h2>
          </div>

          <div className="bg-slate-50/80 dark:bg-slate-950/40 backdrop-blur-sm border border-slate-200 dark:border-slate-800 rounded-2xl p-6 h-64 overflow-y-auto custom-scrollbar shadow-inner">
            <pre className="text-xs sm:text-sm font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-[1.8]">
              {result.srtContent}
            </pre>
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            <button
              onClick={() => copyToClipboard(result.srtContent)}
              className="flex-1 flex items-center justify-center gap-3 py-5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-[24px] font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all group text-lg"
            >
              {isCopying ? <CheckCircle2 size={22} className="text-emerald-500" /> : <Copy size={22} className="group-hover:scale-110 transition-transform" />}
              {isCopying ? 'Copied!' : 'Copy to Clipboard'}
            </button>
            <button
              onClick={() => downloadFile(result.srtContent, 'vlogs-by-saw-subs.srt')}
              className="flex-1 flex items-center justify-center gap-3 py-5 bg-orange-500 text-white rounded-[24px] font-bold hover:bg-orange-600 transition-all shadow-xl shadow-orange-500/20 group text-lg"
            >
              <FileText size={22} className="group-hover:scale-110 transition-transform" />
              Download Subtitles (SRT)
            </button>
          </div>
        </div>
      )}
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
