import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { 
  Headphones, 
  Play, 
  Pause, 
  FileText, 
  Music, 
  RefreshCw, 
  Sparkles, 
  Clipboard, 
  Check, 
  AlertCircle,
  Scissors,
  RotateCcw,
  Download,
  CheckCircle2
} from 'lucide-react';
import { AudioResult } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { formatTime, formatMyanmarDuration, pcmToWav, detectSilence, trimAudioBuffer, audioBufferToWav, convertWavToMp3 } from '../utils/audioUtils';
import { generateSRT, generateASS, generateLRC, shiftSubtitles } from '../utils/subtitleUtils';

interface OutputPreviewProps {
  result: AudioResult | null;
  isLoading: boolean;
  engineStatus?: 'ready' | 'cooling' | 'limit';
  retryCountdown?: number;
  error?: string | null;
  onRetry?: () => void;
  showToast: (message: string, type: 'success' | 'error' | 'info') => void;
  config?: import('../types').TTSConfig;
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
  engineStatus = 'ready',
  retryCountdown = 0,
  error = null,
  onRetry,
  showToast,
  config
}) => {
  const { t } = useLanguage();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playerVolume] = useState(1.0);
  const [currentSrt, setCurrentSrt] = useState('');
  const [isSrtCopied, setIsSrtCopied] = useState(false);

  // Audio Trimming State
  const [trimStart, setTrimStart] = useState<number>(0);
  const [trimEnd, setTrimEnd] = useState<number>(0);
  const [audioBufferState, setAudioBufferState] = useState<AudioBuffer | null>(null);
  const [isPreviewTrimmed, setIsPreviewTrimmed] = useState<boolean>(false);
  
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

  const isTrimActive = trimStart > 0 || trimEnd > 0;
  const trimmedDuration = Math.max(0.1, duration - trimStart - trimEnd);

  // Synchronized subtitles adjusted for start trim and duration
  const activeSubtitles = useMemo(() => {
    if (!result?.subtitles || result.subtitles.length === 0) return [];
    if (isTrimActive && trimStart > 0) {
      return shiftSubtitles(result.subtitles, trimStart, trimmedDuration);
    }
    return result.subtitles;
  }, [result?.subtitles, isTrimActive, trimStart, trimmedDuration]);

  // Set duration and current SRT from result
  useEffect(() => {
    if (result) {
      if (isTrimActive && activeSubtitles.length > 0) {
        setCurrentSrt(generateSRT(activeSubtitles));
      } else {
        setCurrentSrt(result.srtContent || '');
      }
      setDuration(result.baseDuration);
    }
  }, [result, isTrimActive, activeSubtitles]);

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
      setAudioBufferState(null);
      setTrimStart(0);
      setTrimEnd(0);
      setIsPreviewTrimmed(false);
      
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
            setAudioBufferState(buffer);
            setDuration(buffer.duration);
            setIsFallback(false);
          } catch {
            console.warn("audioUtils: Standard decoding failed in Preview, attempting to wrap as raw PCM (L16) with WAV header...");
            try {
              const pcmData = new Uint8Array(bufferToDecode);
              // Gemini 3.1 TTS returns 24000Hz, 16-bit Mono PCM
              const wavBlob = pcmToWav(pcmData, 24000);
              const wavBuffer = await wavBlob.arrayBuffer();
              const buffer = await audioContextRef.current.decodeAudioData(wavBuffer);
              audioBufferRef.current = buffer;
              setAudioBufferState(buffer);
              setDuration(buffer.duration);
              setIsFallback(false);
              console.log("audioUtils: Successfully decoded audio in Preview after wrapping raw PCM as WAV.");
            } catch (pcmErr) {
              console.error("Decode failed even after PCM wrapping, preparing fallback:", pcmErr);
              setIsFallback(true);
              setupFallbackAudio(bufferToDecode);
            }
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
    const bytes = new Uint8Array(data);
    let mimeType = 'audio/wav';
    
    // Check for ID3/Sync (MP3) or RIFF (WAV) headers
    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
      mimeType = 'audio/mpeg';
    } else if (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) {
      mimeType = 'audio/mpeg';
    } else if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      mimeType = 'audio/wav';
    }

    console.log(`[DEBUG] setupFallbackAudio: Detected mimeType ${mimeType} from headers, bytes: ${bytes.length}`);
    
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    audio.src = url;
    audio.playbackRate = 1.0; 
    
    audio.onerror = (e) => {
      console.error("[DEBUG] Fallback Audio Player Error:", e);
      // Log more details if available
      if (audio.error) {
        console.error(`[DEBUG] Audio Error Code: ${audio.error.code}, Message: ${audio.error.message}`);
      }
      showToast("Audio playback error", "error");
    };

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
          const maxPlayTime = isPreviewTrimmed ? (duration - trimEnd) : duration;
          const newTime = Math.min(elapsed, maxPlayTime);
          setCurrentTime(newTime);
          if (newTime >= maxPlayTime) {
            setIsPlaying(false);
            if (isPreviewTrimmed) {
              setIsPreviewTrimmed(false);
              setCurrentTime(trimStart);
              pausedTimeRef.current = trimStart;
            }
          }
        }
      }, 50);
    }
    return () => clearInterval(interval);
  }, [isPlaying, duration, isPreviewTrimmed, trimEnd, trimStart]);

  const togglePlay = async () => {
    try {
      if (isFallback) {
        if (!fallbackAudioRef.current) return;
        
        if (isPlaying) {
          fallbackAudioRef.current.pause();
          setIsPlaying(false);
          setIsPreviewTrimmed(false);
        } else {
          fallbackAudioRef.current.currentTime = currentTime;
          console.log(`[DEBUG] Fallback Play triggered at ${currentTime}s`);
          await fallbackAudioRef.current.play();
          setIsPlaying(true);
        }
        return;
      }

      if (!audioBufferRef.current || !audioContextRef.current) return;

      if (isPlaying) {
        pausedTimeRef.current = currentTime;
        stopAudio();
        setIsPreviewTrimmed(false);
      } else {
        initAudioContext();
        if (audioContextRef.current.state === 'suspended') {
          await audioContextRef.current.resume();
        }

        const source = audioContextRef.current.createBufferSource();
        source.buffer = audioBufferRef.current;
        source.playbackRate.value = 1.0; 
        source.connect(gainNodeRef.current!);
        
        const startSeek = currentTime >= duration - 0.1 ? 0 : currentTime;
        source.start(0, startSeek);
        sourceNodeRef.current = source;
        startTimeRef.current = audioContextRef.current.currentTime - startSeek;
        
        console.log(`[DEBUG] AudioContext Play triggered at ${startSeek}s`);
        setIsPlaying(true);
        setIsPreviewTrimmed(false);

        source.onended = () => {
          // Only reset if it ended naturally
          if (sourceNodeRef.current === source) {
            setIsPlaying(false);
            setIsPreviewTrimmed(false);
            if (currentTime >= duration - 0.1) {
              setCurrentTime(0);
              pausedTimeRef.current = 0;
            }
          }
        };
      }
    } catch (err) {
      console.error("[DEBUG] togglePlay error:", err);
      showToast("Playback failed", "error");
    }
  };

  const handlePreviewTrimmed = async () => {
    if (isPlaying && isPreviewTrimmed) {
      stopAudio();
      setIsPreviewTrimmed(false);
      setCurrentTime(trimStart);
      pausedTimeRef.current = trimStart;
      return;
    }

    if (isPlaying) {
      stopAudio();
    }

    if (isFallback) {
      if (!fallbackAudioRef.current) return;
      fallbackAudioRef.current.currentTime = trimStart;
      await fallbackAudioRef.current.play();
      setIsPlaying(true);
      setIsPreviewTrimmed(true);
      return;
    }

    const buffer = audioBufferRef.current || audioBufferState;
    if (!buffer || !audioContextRef.current) {
      showToast("Audio buffer not ready for preview", "error");
      return;
    }

    try {
      initAudioContext();
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const source = audioContextRef.current.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = 1.0; 
      source.connect(gainNodeRef.current!);

      const startPos = trimStart;
      const endPos = Math.max(startPos + 0.1, duration - trimEnd);
      const playDuration = endPos - startPos;

      source.start(0, startPos, playDuration);
      sourceNodeRef.current = source;
      startTimeRef.current = audioContextRef.current.currentTime - startPos;
      
      setCurrentTime(startPos);
      setIsPlaying(true);
      setIsPreviewTrimmed(true);

      source.onended = () => {
        if (sourceNodeRef.current === source) {
          setIsPlaying(false);
          setIsPreviewTrimmed(false);
          setCurrentTime(startPos);
          pausedTimeRef.current = startPos;
        }
      };
    } catch (err) {
      console.error("[DEBUG] handlePreviewTrimmed error:", err);
      showToast("Playback failed", "error");
    }
  };

  const handleAutoDetectSilence = () => {
    const buffer = audioBufferRef.current || audioBufferState;
    if (!buffer) {
      showToast("Audio is still decoding. Please wait a moment...", "error");
      return;
    }

    try {
      const { startSilence, endSilence } = detectSilence(buffer, 0.012, 0.03);
      if (startSilence > 0 || endSilence > 0) {
        const maxStart = Math.max(0, buffer.duration - 0.2);
        const safeStart = Math.min(maxStart, startSilence);
        const maxEnd = Math.max(0, buffer.duration - safeStart - 0.2);
        const safeEnd = Math.min(maxEnd, endSilence);

        setTrimStart(safeStart);
        setTrimEnd(safeEnd);
        showToast(
          `Auto-detected silence: -${safeStart.toFixed(2)}s start, -${safeEnd.toFixed(2)}s end`,
          'success'
        );
      } else {
        showToast(t('output.noSilenceDetected'), 'info');
      }
    } catch (err) {
      console.error("Auto detect silence error:", err);
      showToast("Could not detect silence", "error");
    }
  };

  const handleResetTrim = () => {
    setTrimStart(0);
    setTrimEnd(0);
    if (isPreviewTrimmed) {
      stopAudio();
      setIsPreviewTrimmed(false);
      setCurrentTime(0);
      pausedTimeRef.current = 0;
    }
    showToast(t('output.resetTrim'), 'success');
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

  const handleDownloadAudio = async (forceOriginal: boolean = false) => {
    if (!result) return;
    
    try {
      console.log(`[DEBUG] handleDownloadAudio triggered (forceOriginal: ${forceOriginal})`);
      showToast(t('output.tuning'), 'success');
      
      const shouldTrim = !forceOriginal && (trimStart > 0 || trimEnd > 0);
      let finalBlob: Blob;
      const targetFormat = config?.exportFormat || 'wav';
      let ext = targetFormat;

      if (shouldTrim) {
        let bufferToTrim = audioBufferRef.current || audioBufferState;
        if (!bufferToTrim) {
          // Decode buffer if not cached yet
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
          bufferToTrim = await audioContextRef.current.decodeAudioData(bufferToDecode.slice(0));
          audioBufferRef.current = bufferToTrim;
          setAudioBufferState(bufferToTrim);
        }

        const trimmed = trimAudioBuffer(bufferToTrim, trimStart, trimEnd);
        const wavBlob = audioBufferToWav(trimmed);
        
        if (targetFormat === 'mp3') {
          finalBlob = await convertWavToMp3(wavBlob);
          ext = 'mp3';
        } else {
          finalBlob = wavBlob;
          ext = 'wav';
        }
      } else {
        if (result.rawAudio) {
          // Use raw binary if available (most reliable)
          const bytes = new Uint8Array(result.rawAudio);
          let type = 'audio/mpeg';
          if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
            type = 'audio/wav';
          }
          finalBlob = new Blob([result.rawAudio], { type });
          console.log(`[DEBUG] Download: Using result.rawAudio, type: ${finalBlob.type}, size: ${finalBlob.size}`);
        } else if (result.audioData) {
          // Fallback to base64
          const binaryStr = window.atob(result.audioData);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          
          let type = 'audio/mpeg';
          if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
            type = 'audio/wav';
          }
          finalBlob = new Blob([bytes], { type });
          console.log(`[DEBUG] Download: Using result.audioData base64, type: ${finalBlob.type}, size: ${finalBlob.size}`);
        } else if (audioBufferRef.current) {
          finalBlob = audioBufferToWav(audioBufferRef.current);
        } else {
          throw new Error("No audio data available for download");
        }

        if (targetFormat === 'mp3' && finalBlob.type !== 'audio/mpeg') {
          finalBlob = await convertWavToMp3(finalBlob);
          ext = 'mp3';
        } else if (targetFormat === 'wav' && finalBlob.type === 'audio/wav') {
          ext = 'wav';
        } else {
          ext = targetFormat;
        }
      }

      let baseName = '';
      if (config?.customFileName?.trim()) {
        baseName = config.customFileName.trim();
        // Remove .mp3 or .wav if user added it manually to avoid double extension
        baseName = baseName.replace(/\.(mp3|wav)$/i, '');
      } else {
        baseName = `vbs_tts_${Date.now()}`;
      }
      const filename = shouldTrim ? `${baseName}_trimmed.${ext}` : `${baseName}.${ext}`;
      
      console.log(`[DEBUG] Creating ObjectURL for download ${filename}...`);
      const url = URL.createObjectURL(finalBlob);
      
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      
      console.log(`[DEBUG] Triggering click on anchor element for ${filename}`);
      a.click();
      
      // Small delay before cleanup to ensure click is handled
      setTimeout(() => {
        if (document.body.contains(a)) {
          document.body.removeChild(a);
        }
        URL.revokeObjectURL(url);
        console.log(`[DEBUG] Download cleanup completed for ${filename}`);
      }, 200);

      showToast(`Downloaded ${filename}`, 'success');
      
    } catch (err) {
      console.error("[DEBUG] handleDownloadAudio Error:", err);
      showToast("Download failed", "error");
    }
  };

  const handleDownloadSubtitles = (format: 'srt' | 'txt' | 'ass' | 'lrc') => {
    if (!result) return;
    const subs = activeSubtitles.length > 0 ? activeSubtitles : (result.subtitles || []);
    const ts = new Date().getTime();
    let baseName = config?.customFileName?.trim() 
      ? config.customFileName.trim().replace(/\.(mp3|wav|srt|txt|ass|lrc)$/i, '')
      : `vbs-saw-subtitles-${ts}`;
    if (isTrimActive) {
      baseName += '_trimmed';
    }

    if (format === 'srt') {
      downloadFile(generateSRT(subs), `${baseName}.srt`);
    } else if (format === 'txt') {
      downloadFile(generateSRT(subs), `${baseName}.txt`);
    } else if (format === 'ass') {
      downloadFile(generateASS(subs), `${baseName}.ass`);
    } else if (format === 'lrc') {
      downloadFile(generateLRC(subs), `${baseName}.lrc`);
    }
  };

  const downloadFile = (content: string, fileName: string) => {
    if (!content || content.trim().length === 0) {
      showToast("No content to export", "error");
      return;
    }

    console.log(`[DEBUG] Subtitle File: ${fileName}`);
    
    // Strict formatting for compatibility
    // CRLF line endings (\r\n) as requested for SRT files
    const sanitizedContent = content.replace(/\r?\n/g, '\r\n');
    
    // Use text/srt as requested by user for better CapCut recognition. 
    // Standard SRT is UTF-8 without BOM.
    const blob = new Blob([sanitizedContent], { type: 'text/srt;charset=utf-8' });
    
    console.log(`[DEBUG] Subtitle File Size: ${blob.size} bytes`);

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = fileName;
    
    document.body.appendChild(a);
    console.log(`[DEBUG] Triggering subtitle download for ${fileName}`);
    a.click();
    
    // Small delay before cleanup to ensure trigger is handled
    setTimeout(() => {
      if (document.body.contains(a)) {
        document.body.removeChild(a);
      }
      URL.revokeObjectURL(url);
    }, 200);

    showToast(`Downloaded ${fileName}`, 'success');
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
        {result.isFallback && (
          <div className="bg-amber-400/10 border border-amber-400/30 rounded-3xl p-6 flex flex-col sm:flex-row items-center gap-5 text-center sm:text-left group animate-pulse-soft">
            <div className="p-4 bg-amber-400/20 rounded-2xl text-amber-400">
              <AlertCircle size={28} />
            </div>
            <div className="space-y-1">
              <p className="font-black text-amber-400 uppercase tracking-widest text-xs">AI Fallback Active</p>
              <p className="text-slate-400 text-[11px] leading-relaxed font-medium">
                Gemini AI is currently unavailable or rate-limited. The system is using your device's native voice as a temporary backup (English only).
              </p>
            </div>
          </div>
        )}

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
          aria-label={isPlaying ? "Pause" : "Play"}
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
                {/* Visual Trim Regions Overlay */}
                {duration > 0 && isTrimActive && (
                  <div className="absolute inset-x-2 h-2 rounded-full overflow-hidden pointer-events-none flex z-0">
                    {trimStart > 0 && (
                      <div 
                        style={{ width: `${Math.min(100, (trimStart / duration) * 100)}%` }} 
                        className="bg-rose-500/40 h-full border-r border-rose-500/80 backdrop-blur-xs"
                      />
                    )}
                    <div 
                      style={{ width: `${Math.max(0, (trimmedDuration / duration) * 100)}%` }} 
                      className="h-full"
                    />
                    {trimEnd > 0 && (
                      <div 
                        style={{ width: `${Math.min(100, (trimEnd / duration) * 100)}%` }} 
                        className="bg-indigo-500/40 h-full border-l border-indigo-500/80 backdrop-blur-xs ml-auto"
                      />
                    )}
                  </div>
                )}
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.01}
                  value={currentTime}
                  onChange={handleSeek}
                  className="w-full h-2 bg-white/5 rounded-full appearance-none cursor-pointer accent-amber-400 hover:h-2.5 transition-all shadow-inner relative z-10"
                  style={{
                    background: `linear-gradient(to right, #EAB308 0%, #EAB308 ${(currentTime / (duration || 1)) * 100}%, rgba(255, 255, 255, 0.05) ${(currentTime / (duration || 1)) * 100}%, rgba(255, 255, 255, 0.05) 100%)`
                  }}
                />
              </div>
              
              <div className="flex items-center justify-between w-full px-6">
                <span className="text-[10px] font-black font-mono text-slate-500 uppercase tracking-widest">
                  {formatTime(currentTime).split(',')[0]}
                </span>
                {isTrimActive ? (
                  <span className="text-[10px] font-black font-mono text-amber-400/90 uppercase tracking-widest flex items-center gap-1.5">
                    <Scissors size={10} />
                    {formatTime(trimmedDuration).split(',')[0]} / {formatTime(duration).split(',')[0]}
                  </span>
                ) : (
                  <span className="text-[10px] font-black font-mono text-slate-500 uppercase tracking-widest">
                    {formatTime(duration).split(',')[0]}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Audio Trimming Card */}
        <div className="bg-black/40 backdrop-blur-2xl rounded-[36px] p-6 sm:p-8 border border-white/5 shadow-2xl relative overflow-hidden space-y-6">
          <div className="absolute top-0 right-0 w-48 h-48 bg-amber-400/5 blur-[80px] -z-10 pointer-events-none" />
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
            <div className="flex items-center gap-3.5">
              <div className="p-3 bg-amber-400/10 rounded-2xl text-amber-400 border border-amber-400/20 shadow-lg shadow-amber-400/5">
                <Scissors size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <h3 className="text-base font-black text-white uppercase tracking-wider">
                    {t('output.audioTrimming')}
                  </h3>
                  {isTrimActive ? (
                    <span className="px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-amber-400/20 text-amber-400 border border-amber-400/30 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                      {t('output.trimActive')} (-{(trimStart + trimEnd).toFixed(2)}s)
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-white/5 text-slate-500 border border-white/10">
                      {t('output.untrimmed')}
                    </span>
                  )}
                </div>
                <p className="text-slate-400 text-xs font-medium mt-0.5">
                  {t('output.trimHint')}
                </p>
              </div>
            </div>

            {/* Trimming Quick Action Buttons */}
            <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
              <button
                type="button"
                onClick={handleAutoDetectSilence}
                className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-black rounded-xl text-xs font-black uppercase tracking-wider shadow-lg shadow-amber-400/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
                title="Automatically analyze audio and detect start/end silence"
              >
                <Sparkles size={14} />
                {t('output.autoDetectSilence')}
              </button>

              <button
                type="button"
                onClick={handlePreviewTrimmed}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all border shadow-lg ${
                  isPlaying && isPreviewTrimmed
                    ? 'bg-amber-400 text-black border-amber-400 shadow-amber-400/20 scale-[1.02]'
                    : 'bg-white/5 text-slate-200 border-white/10 hover:bg-white/10 hover:border-white/20'
                }`}
                title="Preview only the trimmed audio segment"
              >
                {isPlaying && isPreviewTrimmed ? <Pause size={14} /> : <Play size={14} />}
                {t('output.previewTrimmed')}
              </button>

              {isTrimActive && (
                <button
                  type="button"
                  onClick={handleResetTrim}
                  className="flex items-center gap-1.5 px-3 py-2.5 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white rounded-xl text-xs font-bold transition-all border border-white/5"
                  title="Reset trim values back to 0"
                >
                  <RotateCcw size={13} />
                  {t('output.resetTrim')}
                </button>
              )}
            </div>
          </div>

          {/* Sliders Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-1">
            {/* Start Silence Trim */}
            <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-4 space-y-3 relative group/start">
              <div className="flex items-center justify-between">
                <label className="text-xs font-black text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.5)]" />
                  {t('output.trimStart')}
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-black text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-lg border border-rose-500/20">
                    -{trimStart.toFixed(2)}s
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, Number((duration - trimEnd - 0.2).toFixed(2)))}
                  step={0.01}
                  value={trimStart}
                  onChange={(e) => setTrimStart(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="w-full h-2 bg-white/10 rounded-full appearance-none cursor-pointer accent-rose-400 hover:h-2.5 transition-all"
                />
              </div>

              <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                <span>0.00s</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setTrimStart(prev => Math.max(0, Number((prev - 0.05).toFixed(2))))}
                    className="px-2 py-0.5 bg-white/5 hover:bg-white/10 rounded text-slate-400 hover:text-white transition-colors border border-white/5 font-mono"
                  >
                    -0.05s
                  </button>
                  <button
                    type="button"
                    onClick={() => setTrimStart(prev => Math.min(Math.max(0, duration - trimEnd - 0.2), Number((prev + 0.05).toFixed(2))))}
                    className="px-2 py-0.5 bg-white/5 hover:bg-white/10 rounded text-slate-400 hover:text-white transition-colors border border-white/5 font-mono"
                  >
                    +0.05s
                  </button>
                </div>
                <span>{Math.max(0, duration - trimEnd - 0.2).toFixed(2)}s</span>
              </div>
            </div>

            {/* End Silence Trim */}
            <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-4 space-y-3 relative group/end">
              <div className="flex items-center justify-between">
                <label className="text-xs font-black text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.5)]" />
                  {t('output.trimEnd')}
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-black text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-lg border border-indigo-500/20">
                    -{trimEnd.toFixed(2)}s
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, Number((duration - trimStart - 0.2).toFixed(2)))}
                  step={0.01}
                  value={trimEnd}
                  onChange={(e) => setTrimEnd(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="w-full h-2 bg-white/10 rounded-full appearance-none cursor-pointer accent-indigo-400 hover:h-2.5 transition-all"
                />
              </div>

              <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                <span>0.00s</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setTrimEnd(prev => Math.max(0, Number((prev - 0.05).toFixed(2))))}
                    className="px-2 py-0.5 bg-white/5 hover:bg-white/10 rounded text-slate-400 hover:text-white transition-colors border border-white/5 font-mono"
                  >
                    -0.05s
                  </button>
                  <button
                    type="button"
                    onClick={() => setTrimEnd(prev => Math.min(Math.max(0, duration - trimStart - 0.2), Number((prev + 0.05).toFixed(2))))}
                    className="px-2 py-0.5 bg-white/5 hover:bg-white/10 rounded text-slate-400 hover:text-white transition-colors border border-white/5 font-mono"
                  >
                    +0.05s
                  </button>
                </div>
                <span>{Math.max(0, duration - trimStart - 0.2).toFixed(2)}s</span>
              </div>
            </div>
          </div>

          {/* Duration Summary Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-white/[0.02] border border-white/5 rounded-2xl text-xs">
            <div className="flex flex-wrap items-center gap-4 text-slate-400">
              <div>
                <span className="text-slate-500 text-[10px] uppercase block font-bold tracking-wider">Original</span>
                <span className="font-mono font-bold text-white text-xs">{duration.toFixed(2)}s</span>
              </div>
              {isTrimActive && (
                <>
                  <span className="text-slate-600 font-bold">➔</span>
                  <div>
                    <span className="text-rose-400/90 text-[10px] uppercase block font-bold tracking-wider">Silence Removed</span>
                    <span className="font-mono font-bold text-rose-400 text-xs">-{(trimStart + trimEnd).toFixed(2)}s</span>
                  </div>
                  <span className="text-slate-600 font-bold">➔</span>
                </>
              )}
              <div>
                <span className="text-amber-400 text-[10px] uppercase block font-bold tracking-wider">{t('output.trimmedDuration')}</span>
                <span className="font-mono font-black text-amber-400 text-xs">
                  {trimmedDuration.toFixed(2)}s ({formatMyanmarDuration(trimmedDuration)})
                </span>
              </div>
            </div>

            {isTrimActive && (
              <div className="text-[11px] text-emerald-400 bg-emerald-400/10 px-3 py-1.5 rounded-full border border-emerald-400/20 font-bold flex items-center gap-1.5">
                <CheckCircle2 size={13} />
                Subtitles & Downloads Synchronized
              </div>
            )}
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
                {isTrimActive && trimStart > 0 && (
                  <span className="text-[9px] font-bold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/20 flex items-center gap-1 font-mono">
                    <Scissors size={10} />
                    Synced (-{trimStart.toFixed(2)}s)
                  </span>
                )}
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
                  onClick={() => handleDownloadAudio(false)}
                  disabled={!result || (!result.audioData && !result.rawAudio)}
                  className={`flex items-center justify-center gap-4 py-6 rounded-[24px] font-black uppercase tracking-widest transition-all shadow-xl group ${
                    !result || (!result.audioData && !result.rawAudio)
                      ? 'bg-white/5 text-slate-500 cursor-not-allowed border border-white/10' 
                      : 'bg-amber-400 text-black hover:scale-[1.02] active:scale-[0.98]'
                  }`}
                >
                  <Music size={24} />
                  {(config?.exportFormat === 'mp3')
                    ? (isTrimActive ? t('output.downloadTrimmedMp3') : t('output.downloadMp3'))
                    : (isTrimActive ? t('output.downloadTrimmedWav') : t('output.downloadWav'))}
                  <span className="px-2.5 py-0.5 bg-black/20 text-black rounded-full text-[10px] font-mono font-black uppercase">
                    {isTrimActive ? `${trimmedDuration.toFixed(2)}s • ${(config?.exportFormat || 'wav').toUpperCase()}` : (config?.exportFormat || 'wav').toUpperCase()}
                  </span>
                </button>

                {isTrimActive && (
                  <button
                    type="button"
                    onClick={() => handleDownloadAudio(true)}
                    className="flex items-center justify-center gap-2 py-3 bg-white/5 text-slate-400 hover:text-white rounded-[20px] font-black uppercase tracking-widest border border-white/10 hover:bg-white/10 transition-all text-[10px]"
                    title="Download the unedited original audio"
                  >
                    <Download size={14} />
                    {t('output.downloadOriginal')} ({duration.toFixed(2)}s • {(config?.exportFormat || 'wav').toUpperCase()})
                  </button>
                )}

                <div className="grid grid-cols-3 gap-3">
                  <button
                    onClick={() => handleDownloadSubtitles('srt')}
                    className="flex flex-col items-center justify-center gap-2 py-4 bg-amber-400 text-black rounded-[24px] font-black uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-amber-400/10 text-[9px]"
                  >
                    <FileText size={16} />
                    SRT {isTrimActive ? '✂' : ''}
                  </button>
                  <button
                    onClick={() => handleDownloadSubtitles('txt')}
                    className="flex flex-col items-center justify-center gap-2 py-4 bg-white/5 text-white rounded-[24px] font-black uppercase tracking-widest border border-white/10 hover:bg-white/10 transition-all text-[9px]"
                  >
                    <FileText size={16} />
                    TXT {isTrimActive ? '✂' : ''}
                  </button>
                  <button
                    onClick={() => handleDownloadSubtitles('ass')}
                    className="flex flex-col items-center justify-center gap-2 py-4 bg-white/5 text-slate-300 rounded-[24px] font-black uppercase tracking-widest border border-white/10 hover:bg-white/10 transition-all text-[9px]"
                  >
                    <FileText size={16} />
                    ASS {isTrimActive ? '✂' : ''}
                  </button>
                </div>
                
                <div className="grid grid-cols-1">
                  <button
                    onClick={() => handleDownloadSubtitles('lrc')}
                    className="flex items-center justify-center gap-3 py-3 bg-white/5 text-slate-500 rounded-[20px] font-black uppercase tracking-widest border border-white/5 hover:bg-white/10 transition-all text-[10px]"
                  >
                    LRC Lyrics {isTrimActive ? '✂' : ''}
                  </button>
                </div>
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
