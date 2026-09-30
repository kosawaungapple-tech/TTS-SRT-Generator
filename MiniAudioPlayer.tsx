import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX } from 'lucide-react';
import { pcmToWav } from '../utils/audioUtils';

interface MiniAudioPlayerProps {
  base64Data: string;
}

export const MiniAudioPlayer: React.FC<MiniAudioPlayerProps> = ({ base64Data }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string>('');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (base64Data) {
      try {
        // [WAV CONVERSION]
        // Gemini TTS returns LINEAR16 PCM. Wrapping with WAV header.
        const binaryString = window.atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        
        const wavBlob = pcmToWav(bytes, 24000);
        const url = URL.createObjectURL(wavBlob);
        setAudioUrl(url);
        
        // Force reload the audio element
        if (audioRef.current) {
          audioRef.current.load();
          // [AUTO-PLAY REMOVED]
          setIsPlaying(false);
        }

        return () => URL.revokeObjectURL(url);
      } catch (err) {
        console.error("Error creating audio URL:", err);
      }
    }
  }, [base64Data]);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play().catch(err => console.error("Playback error:", err));
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (audioRef.current) {
      const time = parseFloat(e.target.value);
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const toggleMute = () => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-4 bg-slate-50 dark:bg-slate-900 rounded-2xl px-5 py-3 border border-slate-200 dark:border-slate-800 group transition-all hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors duration-300">
      <button
        onClick={togglePlay}
        className="w-10 h-10 bg-brand-purple text-white rounded-full flex items-center justify-center hover:scale-105 transition-transform shadow-lg shadow-brand-purple/20"
      >
        {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
      </button>

      <div className="flex-1 flex flex-col gap-1.5">
        <div className="relative w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
          <div 
            className="absolute top-0 left-0 h-full bg-brand-purple transition-all duration-100"
            style={{ width: `${(currentTime / (duration || 1)) * 100}%` }}
          />
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={handleProgressChange}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          />
        </div>
        <div className="flex justify-between text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-widest">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <button
        onClick={toggleMute}
        className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
      >
        {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>

      <audio 
        ref={audioRef} 
        src={audioUrl} 
        className="hidden" 
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onEnded={() => setIsPlaying(false)}
      />
    </div>
  );
};
