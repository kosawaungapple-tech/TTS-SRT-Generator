import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'motion/react';
import {
  Film,
  Upload,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Download,
  Camera,
  RefreshCw,
  ShieldAlert,
  Type,
  Palette,
  Ratio,
  Music,
  Scissors,
  Eye,
  EyeOff,
  FlipHorizontal,
  FlipVertical,
  FileText,
  Sparkles,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  Plus,
  Trash2,
  Edit3,
  Check,
  X,
  ChevronDown,
  Sliders,
  Cpu,
  Laptop,
  Mic,
  Copy,
  Zap,
  WrapText
} from 'lucide-react';
import { WorkerEngineService, WorkerHealthInfo } from '../services/workerEngineService';
import { FfmpegWorkerManager } from './FfmpegWorkerManager';
import { useLanguage } from '../contexts/LanguageContext';
import { SRTSubtitle, AudioResult, VBSUserControl, ModalConfig, CustomFont } from '../types';
import { formatTime } from '../utils/audioUtils';
import { 
  generateSRT, 
  normalizeSrtTimestamp, 
  downloadSrtFile, 
  wrapTextIntoLines, 
  splitSentenceIntoCueBlocks 
} from '../utils/subtitleUtils';
import { GeminiTTSService } from '../services/geminiService';
import { apiChannelManager } from '../services/apiChannelManager';
import { VOICE_OPTIONS } from '../constants';

export interface VideoEditorSharedMedia {
  videoFile?: File | null;
  videoUrl?: string | null;
  fileName?: string | null;
  srtContent?: string | null;
  subtitles?: SRTSubtitle[] | null;
}

interface VideoEditorStudioProps {
  sharedMedia?: VideoEditorSharedMedia | null;
  ttsAudioResult?: AudioResult | null;
  showToast: (message: string, type: 'success' | 'error' | 'info') => void;
  openModal?: (config: ModalConfig) => void;
  isAdmin?: boolean;
  isPremium?: boolean;
  userControl?: VBSUserControl | null;
  onProcessingStateChange?: (isProcessing: boolean) => void;
  customFonts?: CustomFont[];
}

export type AspectRatioType = '16:9' | '9:16' | '1:1' | '4:5' | '4:3' | '21:9' | 'original';
export type FramingMode = 'blurred-fit' | 'letterbox' | 'cover' | 'contain';
export type InspectorTab = 'recap' | 'subtitles' | 'mirror' | 'color' | 'ratio' | 'audio' | 'anticopyright' | 'trim' | 'watermark';
export type MirrorPresetMode = 'none' | 'flip-h' | 'flip-v' | 'flip-hv' | 'split-h' | 'split-v' | 'quad';

export interface RecapHighlight {
  id: string;
  title: string;
  start: number;
  end: number;
  description: string;
}

interface SubtitleCue {
  id: string;
  index: number;
  startSeconds: number;
  endSeconds: number;
  startStr: string;
  endStr: string;
  text: string;
}

function parseSrtText(srtText: string): SubtitleCue[] {
  if (!srtText) return [];
  const normalized = srtText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n\s*\n/).filter(b => b.trim().length > 0);

  const cues: SubtitleCue[] = [];
  blocks.forEach((block, idx) => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length >= 2) {
      let timeLine = lines[1];
      let textLines = lines.slice(2);
      if (!timeLine.includes('-->') && lines[0].includes('-->')) {
        timeLine = lines[0];
        textLines = lines.slice(1);
      }
      const parts = timeLine.split('-->');
      if (parts.length === 2) {
        const startStr = parts[0].trim();
        const endStr = parts[1].trim();
        const startSec = timeToSeconds(startStr);
        const endSec = timeToSeconds(endStr);

        // Auto-wrap any long line exceeding 34 chars into balanced 2-line format
        const cleanLines: string[] = [];
        textLines.forEach(l => {
          if (l.length > 34) {
            cleanLines.push(...wrapTextIntoLines(l, 32, 2));
          } else {
            cleanLines.push(l);
          }
        });

        cues.push({
          id: `cue-${idx}-${Date.now()}`,
          index: idx + 1,
          startSeconds: startSec,
          endSeconds: endSec,
          startStr: normalizeSrtTimestamp(startSec),
          endStr: normalizeSrtTimestamp(endSec),
          text: cleanLines.join('\n')
        });
      }
    }
  });
  return cues;
}

function timeToSeconds(t: string): number {
  const parts = t.split(':');
  if (parts.length < 2) return 0;
  const h = parseFloat(parts[0]) || 0;
  const m = parseFloat(parts[1]) || 0;
  const secParts = (parts[2] || '0').replace(',', '.').split('.');
  const s = parseFloat(secParts[0]) || 0;
  const ms = parseFloat(secParts[1] || '0') / 1000;
  return h * 3600 + m * 60 + s + ms;
}

function secondsToSrtTime(sec: number): string {
  return normalizeSrtTimestamp(sec);
}

export const VideoEditorStudio: React.FC<VideoEditorStudioProps> = ({
  sharedMedia,
  ttsAudioResult,
  showToast,
  isAdmin = false,
  onProcessingStateChange,
  customFonts = []
}) => {
  const { language } = useLanguage();
  const isMm = language === 'mm';

  // Video Element & Canvas References
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Active Video State
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoFileName, setVideoFileName] = useState<string>('video.mp4');
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number }>({ width: 1280, height: 720 });
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [showOriginalComparison, setShowOriginalComparison] = useState<boolean>(false);

  // Inspector Tab
  const [activeInspectorTab, setActiveInspectorTab] = useState<InspectorTab>('subtitles');

  // ==========================================
  // 1. Aspect Ratio & Framing (Ration ပြောင်းတာ)
  // ==========================================
  const [aspectRatio, setAspectRatio] = useState<AspectRatioType>('16:9');
  const [framingMode, setFramingMode] = useState<FramingMode>('blurred-fit');
  const [customBgColor, setCustomBgColor] = useState<string>('#000000');
  const [blurAmount, setBlurAmount] = useState<number>(20);

  // ==========================================
  // 2. Color Grading & Looks (Color ပြောင်းတာ)
  // ==========================================
  const [brightness, setBrightness] = useState<number>(100);
  const [contrast, setContrast] = useState<number>(100);
  const [saturation, setSaturation] = useState<number>(100);
  const [hueRotate, setHueRotate] = useState<number>(0);
  const [sepia, setSepia] = useState<number>(0);
  const [vignette, setVignette] = useState<number>(0);

  // ==========================================
  // 3. Subtitles Overlay (Video ကိုပါ စာတန်းထိုးတာ)
  // ==========================================
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState<boolean>(true);
  const [subFontSize, setSubFontSize] = useState<number>(28);
  const [subFontFamily, setSubFontFamily] = useState<string>('"Noto Sans Myanmar", "Pyidaungsu", "Inter", sans-serif');
  const [userCustomFonts, setUserCustomFonts] = useState<CustomFont[]>(() => {
    try {
      const stored = localStorage.getItem('vbs_user_custom_fonts');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [isFontModalOpen, setIsFontModalOpen] = useState<boolean>(false);
  const [fontModalTab, setFontModalTab] = useState<'file' | 'url'>('file');
  const [newFontName, setNewFontName] = useState<string>('');
  const [newFontUrl, setNewFontUrl] = useState<string>('');
  const [newFontFile, setNewFontFile] = useState<File | null>(null);
  const [isFontGoogle, setIsFontGoogle] = useState<boolean>(false);
  const [isAddingFont, setIsAddingFont] = useState<boolean>(false);

  const allAvailableFonts = useMemo(() => {
    const list: CustomFont[] = [...userCustomFonts];
    (customFonts || []).forEach(cf => {
      if (!list.some(f => f.id === cf.id || f.family === cf.family)) {
        list.push(cf);
      }
    });
    return list;
  }, [userCustomFonts, customFonts]);

  useEffect(() => {
    userCustomFonts.forEach(font => {
      if (font.url) {
        if (font.isGoogleFont) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = font.url;
          document.head.appendChild(link);
        } else {
          try {
            const fontFace = new FontFace(font.family, `url(${font.url})`);
            fontFace.load().then(loaded => {
              document.fonts.add(loaded);
            }).catch(() => {});
          } catch {
            // ignore
          }
          const style = document.createElement('style');
          style.textContent = `
            @font-face {
              font-family: '${font.family}';
              src: url('${font.url}');
              font-display: swap;
            }
          `;
          document.head.appendChild(style);
        }
      }
    });
  }, [userCustomFonts]);
  const [subFontColor, setSubFontColor] = useState<string>('#FFFFFF');
  const [subStrokeColor, setSubStrokeColor] = useState<string>('#000000');
  const [subStrokeWidth, setSubStrokeWidth] = useState<number>(4);
  const [subBgBoxEnabled, setSubBgBoxEnabled] = useState<boolean>(true);
  const [subBgBoxColor, setSubBgBoxColor] = useState<string>('rgba(0,0,0,0.7)');
  const [subPositionY, setSubPositionY] = useState<number>(85);
  const [subTimingOffset, setSubTimingOffset] = useState<number>(0);
  const [subTextSearch, setSubTextSearch] = useState<string>('');

  // ==========================================
  // 4. Mirror Function & Anti-Copyright Tools
  // ==========================================
  const [flipHorizontal, setFlipHorizontal] = useState<boolean>(false);
  const [flipVertical, setFlipVertical] = useState<boolean>(false);
  const [mirrorEffect, setMirrorEffect] = useState<'none' | 'split-h' | 'split-v' | 'quad'>('none');
  const [rotationDegrees, setRotationDegrees] = useState<number>(0);
  const [microZoom, setMicroZoom] = useState<number>(1.0);
  const [microRotation, setMicroRotation] = useState<number>(0);
  const [antiCopyrightBorder, setAntiCopyrightBorder] = useState<boolean>(false);
  const [borderWidth, setBorderWidth] = useState<number>(4);
  const [borderColor, setBorderColor] = useState<string>('#F59E0B');

  // Audio Anti-Copyright
  const [pitchShiftSemitones, setPitchShiftSemitones] = useState<number>(0);
  const [microSpeedModulation, setMicroSpeedModulation] = useState<number>(1.0);
  const [antiHashMaskNoise, setAntiHashMaskNoise] = useState<boolean>(false);
  const [bassBoostDb, setBassBoostDb] = useState<number>(0);
  const [trebleBoostDb, setTrebleBoostDb] = useState<number>(0);
  const [originalAudioVolume, setOriginalAudioVolume] = useState<number>(100);

  // Additional Audio Layer (BGM or TTS Voiceover)
  const [voiceoverAudioUrl, setVoiceoverAudioUrl] = useState<string | null>(null);
  const [voiceoverVolume, setVoiceoverVolume] = useState<number>(100);

  // ==========================================
  // 5. Watermark & Branding
  // ==========================================
  const [watermarkEnabled, setWatermarkEnabled] = useState<boolean>(false);
  const [watermarkText, setWatermarkText] = useState<string>('VlogsBySaw Recap');
  const [watermarkOpacity, setWatermarkOpacity] = useState<number>(60);
  const [watermarkPosition, setWatermarkPosition] = useState<'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'>('top-right');
  const [watermarkFontSize, setWatermarkFontSize] = useState<number>(16);

  // ==========================================
  // 6. Trimming & Segment
  // ==========================================
  const [trimStart, setTrimStart] = useState<number>(0);
  const [trimEnd, setTrimEnd] = useState<number>(0);

  // ==========================================
  // 7. Rendering / Export State
  // ==========================================
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [exportStatusText, setExportStatusText] = useState<string>('');
  const exportAbortRef = useRef<boolean>(false);
  const [exportQuality, setExportQuality] = useState<'original' | 'high' | 'standard'>('original');
  const [showExportOptions, setShowExportOptions] = useState<boolean>(false);
  const [rawVideoFile, setRawVideoFile] = useState<File | null>(null);
  const [exportEngine, setExportEngine] = useState<'server' | 'browser' | 'worker'>('worker');
  const [showEngineOptions, setShowEngineOptions] = useState<boolean>(false);
  const [workerHealth, setWorkerHealth] = useState<WorkerHealthInfo>(WorkerEngineService.getHealth());
  const [isWorkerModalOpen, setIsWorkerModalOpen] = useState<boolean>(false);

  // Subscribe to real-time Worker Engine status (Local PC / VPS)
  useEffect(() => {
    const unsub = WorkerEngineService.subscribe((h) => {
      setWorkerHealth(h);
      if (h.status === 'online') {
        setExportEngine('worker');
      }
    });
    return unsub;
  }, []);

  // ==========================================
  // 8. Player Sizing, Zoom & Theater Mode (လိုသလို ဆွဲချဲ့ခြင်း)
  // ==========================================
  const [playerHeight, setPlayerHeight] = useState<number>(460);
  const [isResizingPlayer, setIsResizingPlayer] = useState<boolean>(false);
  const [previewZoom, setPreviewZoom] = useState<number>(100);
  const [isTheaterMode, setIsTheaterMode] = useState<boolean>(false);

  // ==========================================
  // 9. Subtitle Editing Suite (စာတန်းထိုး ပြင်ဆင်ခြင်း)
  // ==========================================
  const [editingCueId, setEditingCueId] = useState<string | null>(null);
  const [editCueDraftText, setEditCueDraftText] = useState<string>('');
  const [editCueDraftStart, setEditCueDraftStart] = useState<number>(0);
  const [editCueDraftEnd, setEditCueDraftEnd] = useState<number>(0);
  const [isFullSrtModalOpen, setIsFullSrtModalOpen] = useState<boolean>(false);
  const [fullSrtDraftText, setFullSrtDraftText] = useState<string>('');
  const [isSubtitleStylingCollapsed, setIsSubtitleStylingCollapsed] = useState<boolean>(true);

  // ==========================================
  // 10. Pro Auto Recap Suite (အော်တို ရီကပ် ဖန်တီးစနစ်)
  // ==========================================
  const [recapScript, setRecapScript] = useState<string>('');
  const [isGeneratingRecapScript, setIsGeneratingRecapScript] = useState<boolean>(false);
  const [recapSource, setRecapSource] = useState<'subtitles' | 'prompt'>('subtitles');
  const [recapPrompt, setRecapPrompt] = useState<string>('');
  const [recapStyle, setRecapStyle] = useState<string>('cinematic');
  const [recapDuration, setRecapDuration] = useState<string>('medium');
  const [recapTargetLanguage, setRecapTargetLanguage] = useState<'mm' | 'en'>('mm');
  const [isGeneratingRecapVoiceover, setIsGeneratingRecapVoiceover] = useState<boolean>(false);
  const [recapVoice, setRecapVoice] = useState<string>('aoede');
  const [recapVoiceSpeed, setRecapVoiceSpeed] = useState<number>(1.05);
  const [recapAutoDucking, setRecapAutoDucking] = useState<boolean>(true);
  const [recapHighlights, setRecapHighlights] = useState<RecapHighlight[]>([]);
  const [isAnalyzingHighlights, setIsAnalyzingHighlights] = useState<boolean>(false);
  const [recapRetryNotice, setRecapRetryNotice] = useState<string | null>(null);

  // Fast Offscreen Canvas for Blur Optimization
  const blurCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Sync shared media from props
  useEffect(() => {
    if (sharedMedia) {
      let createdUrl: string | null = null;
      if (sharedMedia.videoFile) {
        setRawVideoFile(sharedMedia.videoFile);
        createdUrl = URL.createObjectURL(sharedMedia.videoFile);
        setVideoSrc(createdUrl);
        setVideoFileName(sharedMedia.fileName || sharedMedia.videoFile.name || 'imported_video.mp4');
      } else if (sharedMedia.videoUrl) {
        setVideoSrc(sharedMedia.videoUrl);
        setVideoFileName(sharedMedia.fileName || 'imported_video.mp4');
      }
      if (sharedMedia.srtContent) {
        const parsed = parseSrtText(sharedMedia.srtContent);
        setCues(parsed);
      }
      return () => {
        if (createdUrl) {
          URL.revokeObjectURL(createdUrl);
        }
      };
    }
  }, [sharedMedia]);

  // Sync TTS Audio result if user has generated voice
  useEffect(() => {
    if (ttsAudioResult && ttsAudioResult.audioUrl) {
      setVoiceoverAudioUrl(ttsAudioResult.audioUrl);
    }
  }, [ttsAudioResult]);

  // Handle Video File Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('video/')) {
      showToast(isMm ? 'ဗီဒီယိုဖိုင်သာ ရွေးချယ်ပါ' : 'Please select a valid video file', 'error');
      return;
    }

    setRawVideoFile(file);
    const url = URL.createObjectURL(file);
    setVideoSrc(url);
    setVideoFileName(file.name);
    setTrimStart(0);
    showToast(isMm ? `ဗီဒီယို "${file.name}" ကို ထည့်သွင်းပြီးပါပြီ` : `Loaded video "${file.name}"`, 'success');
  };

  // Handle SRT File Upload
  const handleSrtUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        const parsed = parseSrtText(text);
        setCues(parsed);
        showToast(isMm ? `စာတန်းထိုး ${parsed.length} ခု ထည့်သွင်းပြီးပါပြီ` : `Loaded ${parsed.length} subtitle cues`, 'success');
      }
    };
    reader.readAsText(file);
  };

  // Video Loaded Metadata handler
  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    const dur = video.duration || 0;
    setVideoDuration(dur);
    setTrimEnd(dur);
    setVideoDimensions({
      width: video.videoWidth || 1280,
      height: video.videoHeight || 720
    });
  };

  // Play / Pause toggle
  const togglePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().then(() => setIsPlaying(true)).catch((err) => console.error(err));
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  // Seek time update
  const handleSeek = (newTime: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = newTime;
    setCurrentTime(newTime);
  };

  // Target Canvas Dimensions calculation based on selected Aspect Ratio (မူရင်း Video အရည်အသွေးတိုင်း ထိန်းသိမ်းခြင်း)
  const targetCanvasSize = useMemo(() => {
    const rawW = videoDimensions.width || 1280;
    const rawH = videoDimensions.height || 720;

    switch (aspectRatio) {
      case '16:9': {
        const w = Math.max(1920, rawW);
        const h = Math.round((w * 9) / 16);
        return { width: w, height: h };
      }
      case '9:16':
        return { width: 1080, height: 1920 };
      case '1:1':
        return { width: Math.max(1080, Math.min(rawW, rawH)), height: Math.max(1080, Math.min(rawW, rawH)) };
      case '4:5':
        return { width: 1080, height: 1350 };
      case '4:3':
        return { width: 1440, height: 1080 };
      case '21:9':
        return { width: 2560, height: 1080 };
      case 'original':
      default:
        return { width: rawW, height: rawH };
    }
  }, [aspectRatio, videoDimensions]);

  // Find active subtitle cue at currentTime (Supports live preview while editing a cue!)
  const currentActiveCue = useMemo(() => {
    if (!subtitlesEnabled || cues.length === 0) return null;
    const adjustedTime = currentTime - subTimingOffset;
    const found = cues.find(c => {
      const s = editingCueId === c.id ? editCueDraftStart : c.startSeconds;
      const e = editingCueId === c.id ? editCueDraftEnd : c.endSeconds;
      return adjustedTime >= s && adjustedTime <= e;
    });
    if (!found) return null;
    if (editingCueId === found.id) {
      return {
        ...found,
        text: editCueDraftText,
        startSeconds: editCueDraftStart,
        endSeconds: editCueDraftEnd
      };
    }
    return found;
  }, [subtitlesEnabled, cues, currentTime, subTimingOffset, editingCueId, editCueDraftText, editCueDraftStart, editCueDraftEnd]);

  // Canvas Frame Drawing
  const drawFrameToCanvas = useCallback((
    targetCtx: CanvasRenderingContext2D,
    vElement: HTMLVideoElement,
    canvasW: number,
    canvasH: number,
    activeCueOverride?: SubtitleCue | null,
    isBypassEffects: boolean = false
  ) => {
    const vw = vElement.videoWidth || 1280;
    const vh = vElement.videoHeight || 720;

    targetCtx.save();
    targetCtx.imageSmoothingEnabled = true;
    targetCtx.imageSmoothingQuality = 'high';
    targetCtx.clearRect(0, 0, canvasW, canvasH);

    // If Original Comparison is held, draw raw unprocessed video
    if (isBypassEffects || showOriginalComparison) {
      targetCtx.fillStyle = '#000000';
      targetCtx.fillRect(0, 0, canvasW, canvasH);
      const scale = Math.min(canvasW / vw, canvasH / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      const dx = (canvasW - dw) / 2;
      const dy = (canvasH - dh) / 2;
      targetCtx.drawImage(vElement, dx, dy, dw, dh);
      targetCtx.restore();
      return;
    }

    // 1. Draw Background (Blurred Ambient or Solid Color - 100x Accelerated via Offscreen Canvas)
    if (framingMode === 'blurred-fit' && aspectRatio !== 'original') {
      if (!blurCanvasRef.current) {
        blurCanvasRef.current = document.createElement('canvas');
        blurCanvasRef.current.width = 320;
        blurCanvasRef.current.height = 180;
      }
      const bCanvas = blurCanvasRef.current;
      const bCtx = bCanvas.getContext('2d');
      if (bCtx) {
        bCtx.filter = `blur(${Math.max(2, Math.round(blurAmount / 4))}px) brightness(0.65) saturate(1.2)`;
        bCtx.drawImage(vElement, 0, 0, 320, 180);
        targetCtx.drawImage(bCanvas, 0, 0, canvasW, canvasH);
      }
    } else {
      targetCtx.fillStyle = customBgColor;
      targetCtx.fillRect(0, 0, canvasW, canvasH);
    }

    // 2. Compute Main Video Dimensions and Positioning
    let dw = canvasW;
    let dh = canvasH;
    let dx = 0;
    let dy = 0;

    if (framingMode === 'cover') {
      const scale = Math.max(canvasW / vw, canvasH / vh);
      dw = vw * scale;
      dh = vh * scale;
      dx = (canvasW - dw) / 2;
      dy = (canvasH - dh) / 2;
    } else {
      const scale = Math.min(canvasW / vw, canvasH / vh);
      dw = vw * scale;
      dh = vh * scale;
      dx = (canvasW - dw) / 2;
      dy = (canvasH - dh) / 2;
    }

    // Apply micro-zoom
    if (microZoom !== 1.0) {
      const zScale = microZoom;
      const ozW = dw * zScale;
      const ozH = dh * zScale;
      dx = dx - (ozW - dw) / 2;
      dy = dy - (ozH - dh) / 2;
      dw = ozW;
      dh = ozH;
    }

    // 3. Draw Video with Color Grading and Geometric Transformations
    targetCtx.save();

    const cssFilters: string[] = [];
    if (brightness !== 100) cssFilters.push(`brightness(${brightness}%)`);
    if (contrast !== 100) cssFilters.push(`contrast(${contrast}%)`);
    if (saturation !== 100) cssFilters.push(`saturate(${saturation}%)`);
    if (hueRotate !== 0) cssFilters.push(`hue-rotate(${hueRotate}deg)`);
    if (sepia !== 0) cssFilters.push(`sepia(${sepia}%)`);
    targetCtx.filter = cssFilters.length > 0 ? cssFilters.join(' ') : 'none';

    targetCtx.translate(canvasW / 2, canvasH / 2);
    const scaleX = flipHorizontal ? -1 : 1;
    const scaleY = flipVertical ? -1 : 1;
    targetCtx.scale(scaleX, scaleY);
    const totalRotation = rotationDegrees + microRotation;
    if (totalRotation !== 0) {
      targetCtx.rotate((totalRotation * Math.PI) / 180);
    }
    targetCtx.translate(-canvasW / 2, -canvasH / 2);

    if (mirrorEffect === 'split-h') {
      targetCtx.drawImage(vElement, 0, 0, vw / 2, vh, dx, dy, dw / 2, dh);
      targetCtx.save();
      targetCtx.translate(dx + dw, dy);
      targetCtx.scale(-1, 1);
      targetCtx.drawImage(vElement, 0, 0, vw / 2, vh, 0, 0, dw / 2, dh);
      targetCtx.restore();
    } else if (mirrorEffect === 'split-v') {
      targetCtx.drawImage(vElement, 0, 0, vw, vh / 2, dx, dy, dw, dh / 2);
      targetCtx.save();
      targetCtx.translate(dx, dy + dh);
      targetCtx.scale(1, -1);
      targetCtx.drawImage(vElement, 0, 0, vw, vh / 2, 0, 0, dw, dh / 2);
      targetCtx.restore();
    } else if (mirrorEffect === 'quad') {
      const halfW = dw / 2;
      const halfH = dh / 2;
      // Top-Left (Standard)
      targetCtx.drawImage(vElement, 0, 0, vw / 2, vh / 2, dx, dy, halfW, halfH);
      // Top-Right (Flipped X)
      targetCtx.save();
      targetCtx.translate(dx + dw, dy);
      targetCtx.scale(-1, 1);
      targetCtx.drawImage(vElement, 0, 0, vw / 2, vh / 2, 0, 0, halfW, halfH);
      targetCtx.restore();
      // Bottom-Left (Flipped Y)
      targetCtx.save();
      targetCtx.translate(dx, dy + dh);
      targetCtx.scale(1, -1);
      targetCtx.drawImage(vElement, 0, 0, vw / 2, vh / 2, 0, 0, halfW, halfH);
      targetCtx.restore();
      // Bottom-Right (Flipped X & Y)
      targetCtx.save();
      targetCtx.translate(dx + dw, dy + dh);
      targetCtx.scale(-1, -1);
      targetCtx.drawImage(vElement, 0, 0, vw / 2, vh / 2, 0, 0, halfW, halfH);
      targetCtx.restore();
    } else {
      targetCtx.drawImage(vElement, dx, dy, dw, dh);
    }
    targetCtx.restore();

    // 4. Draw Vignette
    if (vignette > 0) {
      targetCtx.save();
      const radius = Math.max(canvasW, canvasH) * 0.7;
      const vigGradient = targetCtx.createRadialGradient(
        canvasW / 2, canvasH / 2, radius * 0.4,
        canvasW / 2, canvasH / 2, radius
      );
      vigGradient.addColorStop(0, 'rgba(0,0,0,0)');
      vigGradient.addColorStop(1, `rgba(0,0,0,${(vignette / 100) * 0.85})`);
      targetCtx.fillStyle = vigGradient;
      targetCtx.fillRect(0, 0, canvasW, canvasH);
      targetCtx.restore();
    }

    // 5. Anti-Copyright Decorative Border
    if (antiCopyrightBorder) {
      targetCtx.save();
      targetCtx.strokeStyle = borderColor;
      targetCtx.lineWidth = borderWidth;
      targetCtx.strokeRect(borderWidth / 2, borderWidth / 2, canvasW - borderWidth, canvasH - borderWidth);
      targetCtx.restore();
    }

    // 6. Watermark Overlay
    if (watermarkEnabled && watermarkText.trim()) {
      targetCtx.save();
      targetCtx.font = `bold ${watermarkFontSize * (canvasW / 1280)}px "Inter", "Noto Sans Myanmar", sans-serif`;
      targetCtx.fillStyle = `rgba(255, 255, 255, ${watermarkOpacity / 100})`;
      targetCtx.shadowColor = 'rgba(0,0,0,0.8)';
      targetCtx.shadowBlur = 4;

      const padding = 24 * (canvasW / 1280);
      let wx = padding;
      let wy = padding + watermarkFontSize;
      targetCtx.textAlign = 'left';

      if (watermarkPosition === 'top-right') {
        wx = canvasW - padding;
        targetCtx.textAlign = 'right';
      } else if (watermarkPosition === 'bottom-right') {
        wx = canvasW - padding;
        wy = canvasH - padding;
        targetCtx.textAlign = 'right';
      } else if (watermarkPosition === 'bottom-left') {
        wx = padding;
        wy = canvasH - padding;
        targetCtx.textAlign = 'left';
      }

      targetCtx.fillText(watermarkText, wx, wy);
      targetCtx.restore();
    }

    // 7. Subtitles Overlay
    const activeCue = activeCueOverride !== undefined ? activeCueOverride : currentActiveCue;
    if (subtitlesEnabled && activeCue && activeCue.text.trim()) {
      targetCtx.save();

      const scaleMultiplier = canvasW / 1280;
      const scaledFontSize = Math.round(subFontSize * scaleMultiplier);
      targetCtx.font = `bold ${scaledFontSize}px ${subFontFamily}`;
      targetCtx.textAlign = 'center';
      targetCtx.textBaseline = 'middle';

      // Auto-wrap lines that are too wide for the video frame or contain long unbroken text
      const rawLines = activeCue.text.split('\n');
      const maxAllowedWidth = canvasW * 0.86;
      const lines: string[] = [];
      rawLines.forEach(l => {
        const trimmed = l.trim();
        if (!trimmed) return;
        if (targetCtx.measureText(trimmed).width <= maxAllowedWidth && trimmed.length <= 36) {
          lines.push(trimmed);
        } else {
          lines.push(...wrapTextIntoLines(trimmed, 30, 2));
        }
      });
      if (lines.length === 0) lines.push(activeCue.text);
      const lineHeight = scaledFontSize * 1.35;
      const totalTextHeight = lines.length * lineHeight;
      const posY = (canvasH * (subPositionY / 100));

      let maxLineWidth = 0;
      lines.forEach(line => {
        const m = targetCtx.measureText(line);
        if (m.width > maxLineWidth) maxLineWidth = m.width;
      });

      if (subBgBoxEnabled && maxLineWidth > 0) {
        const boxPaddingX = 24 * scaleMultiplier;
        const boxPaddingY = 12 * scaleMultiplier;
        const boxW = maxLineWidth + boxPaddingX * 2;
        const boxH = totalTextHeight + boxPaddingY * 2;
        const boxX = (canvasW - boxW) / 2;
        const boxY = posY - (totalTextHeight / 2) - boxPaddingY;
        const radius = 12 * scaleMultiplier;

        targetCtx.save();
        targetCtx.fillStyle = subBgBoxColor;
        targetCtx.beginPath();
        targetCtx.roundRect(boxX, boxY, boxW, boxH, radius);
        targetCtx.fill();
        targetCtx.restore();
      }

      lines.forEach((line, lIdx) => {
        const lineY = posY - (totalTextHeight / 2) + (lIdx * lineHeight) + (lineHeight / 2);

        if (subStrokeWidth > 0) {
          targetCtx.strokeStyle = subStrokeColor;
          targetCtx.lineWidth = subStrokeWidth * scaleMultiplier;
          targetCtx.lineJoin = 'round';
          targetCtx.miterLimit = 2;
          targetCtx.strokeText(line, canvasW / 2, lineY);
        }

        targetCtx.fillStyle = subFontColor;
        targetCtx.fillText(line, canvasW / 2, lineY);
      });

      targetCtx.restore();
    }

    targetCtx.restore();
  }, [
    showOriginalComparison,
    framingMode,
    blurAmount,
    customBgColor,
    microZoom,
    brightness,
    contrast,
    saturation,
    hueRotate,
    sepia,
    flipHorizontal,
    flipVertical,
    mirrorEffect,
    microRotation,
    vignette,
    antiCopyrightBorder,
    borderColor,
    borderWidth,
    watermarkEnabled,
    watermarkText,
    watermarkFontSize,
    watermarkOpacity,
    watermarkPosition,
    subtitlesEnabled,
    currentActiveCue,
    subFontSize,
    subFontFamily,
    subPositionY,
    subBgBoxEnabled,
    subBgBoxColor,
    subStrokeWidth,
    subStrokeColor,
    subFontColor
  ]);

  // Animation Loop for live canvas rendering
  useEffect(() => {
    let isCancelled = false;

    const renderLoop = () => {
      if (isCancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      // Pause preview rendering loop during export to avoid GPU/CPU resource competition
      if (video && canvas && !isExporting) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          if (canvas.width !== targetCanvasSize.width || canvas.height !== targetCanvasSize.height) {
            canvas.width = targetCanvasSize.width;
            canvas.height = targetCanvasSize.height;
          }
          drawFrameToCanvas(ctx, video, canvas.width, canvas.height);
        }
      }
      animationFrameRef.current = requestAnimationFrame(renderLoop);
    };

    renderLoop();

    return () => {
      isCancelled = true;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [drawFrameToCanvas, targetCanvasSize, isExporting]);

  // Audio Playback Rate & Volume update
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = microSpeedModulation;
    video.volume = Math.min(1, originalAudioVolume / 100);
  }, [microSpeedModulation, originalAudioVolume]);

  // One-Click Color Filter Presets
  const applyColorPreset = (presetName: string) => {
    switch (presetName) {
      case 'cinematic':
        setBrightness(105);
        setContrast(120);
        setSaturation(125);
        setHueRotate(-10);
        setSepia(15);
        setVignette(35);
        showToast('Applied: Cinematic Teal & Orange 🎬', 'info');
        break;
      case 'vibrant':
        setBrightness(110);
        setContrast(125);
        setSaturation(145);
        setHueRotate(0);
        setSepia(0);
        setVignette(15);
        showToast('Applied: Viral Pop & Vibrant ✨', 'info');
        break;
      case 'golden':
        setBrightness(105);
        setContrast(110);
        setSaturation(120);
        setHueRotate(15);
        setSepia(35);
        setVignette(25);
        showToast('Applied: Golden Hour Sunset 🌅', 'info');
        break;
      case 'noir':
        setBrightness(95);
        setContrast(140);
        setSaturation(0);
        setHueRotate(0);
        setSepia(0);
        setVignette(55);
        showToast('Applied: Moody Noir B&W 🖤', 'info');
        break;
      case 'cyberpunk':
        setBrightness(110);
        setContrast(130);
        setSaturation(155);
        setHueRotate(45);
        setSepia(0);
        setVignette(40);
        showToast('Applied: Cyberpunk Neon ⚡', 'info');
        break;
      case 'vintage':
        setBrightness(100);
        setContrast(90);
        setSaturation(85);
        setHueRotate(5);
        setSepia(50);
        setVignette(30);
        showToast('Applied: 90s Retro Film 📼', 'info');
        break;
      case 'reset':
      default:
        setBrightness(100);
        setContrast(100);
        setSaturation(100);
        setHueRotate(0);
        setSepia(0);
        setVignette(0);
        showToast('Reset Color to Normal', 'info');
        break;
    }
  };

  // Mirror Mode Presets (မှန်ရိပ် စတိုင်များ)
  const applyMirrorMode = (mode: 'none' | 'flip-h' | 'flip-v' | 'flip-hv' | 'split-h' | 'split-v' | 'quad') => {
    switch (mode) {
      case 'none':
        setFlipHorizontal(false);
        setFlipVertical(false);
        setMirrorEffect('none');
        setRotationDegrees(0);
        setMicroRotation(0);
        showToast(isMm ? 'မှန်ရိပ်အားလုံးကို မူရင်းအတိုင်း ပြန်ထားပါသည်' : 'Reset Mirror effects to normal', 'info');
        break;
      case 'flip-h':
        setFlipHorizontal(true);
        setFlipVertical(false);
        setMirrorEffect('none');
        showToast(isMm ? 'Horizontal Mirror (ဘယ်/ညာ ပြောင်းပြန်) ဖွင့်ပါသည်' : 'Horizontal Mirror Flip activated', 'success');
        break;
      case 'flip-v':
        setFlipHorizontal(false);
        setFlipVertical(true);
        setMirrorEffect('none');
        showToast(isMm ? 'Vertical Mirror (အထက်/အောက်) ဖွင့်ပါသည်' : 'Vertical Mirror Flip activated', 'success');
        break;
      case 'flip-hv':
        setFlipHorizontal(true);
        setFlipVertical(true);
        setMirrorEffect('none');
        showToast(isMm ? 'Dual Mirror (ဘယ်/ညာ + အထက်/အောက်) ဖွင့်ပါသည်' : 'Both H & V Mirror activated', 'success');
        break;
      case 'split-h':
        setFlipHorizontal(false);
        setFlipVertical(false);
        setMirrorEffect('split-h');
        showToast(isMm ? 'Split Horizontal Mirror (အလယ်ခွဲ မှန်ရိပ်) ဖွင့်ပါသည်' : 'Split Horizontal Mirror activated', 'success');
        break;
      case 'split-v':
        setFlipHorizontal(false);
        setFlipVertical(false);
        setMirrorEffect('split-v');
        showToast(isMm ? 'Split Vertical Mirror (အထက်/အောက် ခွဲခြမ်းမှန်ရိပ်) ဖွင့်ပါသည်' : 'Split Vertical Mirror activated', 'success');
        break;
      case 'quad':
        setFlipHorizontal(false);
        setFlipVertical(false);
        setMirrorEffect('quad');
        showToast(isMm ? 'Quad Mirror 4X (၄ မျက်နှာ မှန်ရိပ်) ဖွင့်ပါသည်' : 'Quad 4-Way Mirror activated', 'success');
        break;
    }
  };

  const handleRotateVideo = (deltaDegrees: number) => {
    setRotationDegrees((prev) => {
      const next = (prev + deltaDegrees + 360) % 360;
      showToast(isMm ? `ဗီဒီယိုကို ${next}° သို့ လှည့်ပါသည်` : `Rotated video to ${next}°`, 'info');
      return next;
    });
  };

  // Anti-Copyright Auto 1-Click Preset
  const applyAntiCopyrightPreset = () => {
    setFlipHorizontal(true);
    setMicroZoom(1.08);
    setMicroRotation(1);
    setMicroSpeedModulation(1.03);
    setPitchShiftSemitones(1);
    setAntiHashMaskNoise(true);
    setAntiCopyrightBorder(true);
    setBorderWidth(3);
    showToast(isMm ? '🛡️ မူပိုင်ခွင့် ကာကွယ်ရေး အပြည့်အစုံ ဖွင့်ထားပြီးပါပြီ' : '🛡️ Full Anti-Copyright bypass suite activated!', 'success');
  };

  // Capture High-Res Snapshot (Thumbnail)
  const handleCaptureSnapshot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      const dataUrl = canvas.toDataURL('image/png', 1.0);
      const link = document.createElement('a');
      link.download = `snapshot_${videoFileName.replace(/\.[^/.]+$/, "")}_${Math.round(currentTime)}s.png`;
      link.href = dataUrl;
      link.click();
      showToast(isMm ? '📸 ရုပ်ထွက်အရည်အသွေးမြင့် ပုံကို ဒေါင်းလုဒ်လုပ်ပြီးပါပြီ' : 'Captured HD Frame Snapshot!', 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to capture snapshot', 'error');
    }
  };

  // ==========================================
  // Auto Recap Handlers & Logic (Pro Movie & Video Recap Suite)
  // ==========================================
  const getGeminiInstance = useCallback(() => {
    const useManaged = isAdmin || apiChannelManager.getSettings().useAdminKeys;
    const activeKey = apiChannelManager.getActiveKey();
    return new GeminiTTSService(useManaged ? '' : (activeKey || ''), isAdmin);
  }, [isAdmin]);

  const recapScriptStats = useMemo(() => {
    if (!recapScript) return { words: 0, chars: 0, estTime: '00:00' };
    const words = recapScript.trim().split(/\s+/).filter(Boolean).length;
    const chars = recapScript.length;
    const estSec = Math.round((words / 130) * 60);
    const m = Math.floor(estSec / 60);
    const s = estSec % 60;
    return {
      words,
      chars,
      estTime: `${m}:${String(s).padStart(2, '0')}`
    };
  }, [recapScript]);

  // 1. Auto Recap Script Generator
  const handleGenerateRecapScript = async () => {
    let sourceContent = '';
    if (recapSource === 'subtitles') {
      if (cues.length > 0) {
        sourceContent = cues.map(c => `[${c.startStr}] ${c.text}`).join('\n');
      } else if (sharedMedia?.srtContent) {
        sourceContent = sharedMedia.srtContent;
      }
    } else {
      sourceContent = recapPrompt.trim();
    }

    if (!sourceContent && cues.length === 0 && !recapPrompt.trim()) {
      showToast(
        isMm
          ? 'ကျေးဇူးပြု၍ စာတန်းထိုး (Subtitles) ထည့်ပါ သို့မဟုတ် ရီကပ်လုပ်လိုသော ဇာတ်လမ်းအကြောင်းအရာကို ရေးထည့်ပါ'
          : 'Please load subtitles or write a synopsis/plot prompt for recap generation',
        'error'
      );
      return;
    }

    if (!sourceContent) {
      sourceContent = recapPrompt.trim();
    }

    setIsGeneratingRecapScript(true);
    setRecapRetryNotice(null);

    const styleMap: Record<string, string> = {
      cinematic: 'ရုပ်ရှင်ဇာတ်ကားပြော ရသစုံ ပုံစံ (Cinematic Movie Recap with suspense, character hooks and high emotion)',
      tiktok: 'TikTok / Reels အမြန်သွက်လက် 60s ဗိုင်းရပ်စ်စတိုင် (Fast viral pacing, high energy, punchy hooks for maximum watch retention)',
      thriller: 'သည်းထိတ်ရင်ဖို ပဟေဠိ လျှို့ဝှက်ဆန်းကြယ်စတိုင် (Dark thriller & suspense mystery with plot twists and tension)',
      action: 'အက်ရှင် စွန့်စားခန်းနှင့် အလှည့်အပြောင်း ဇာတ်ကွက် (High action momentum, dramatic combat, and climax turns)',
      drama: 'ခံစားချက်ရသစုံ ဒရာမာ ဇာတ်လမ်းစတိုင် (Deep emotional journey, character decisions, and heartbreaking moments)',
      summary: 'အနှစ်ချုပ် ဗဟုသုတနှင့် အဓိကအချက်များ (Key story takeaways and educational summaries)'
    };

    const durationMap: Record<string, string> = {
      short: 'Short (၁-၂ မိနစ် အမြန်ရီကပ် / 150-250 words)',
      medium: 'Medium (၃-၅ မိနစ် ပုံမှန်ရုပ်ရှင်ရီကပ် / 400-600 words)',
      full: 'Full Extended (၈-၁၀ မိနစ် အပြည့်အစုံ ရီကပ် / 800+ words)'
    };

    try {
      const gemini = getGeminiInstance();
      const script = await gemini.generateMovieRecapScript(
        sourceContent,
        (seconds, msg) => {
          setRecapRetryNotice(`${msg} (${seconds}s)`);
        },
        {
          style: styleMap[recapStyle] || recapStyle,
          tone: 'Engaging, viral, cinematic, and captivating',
          duration: durationMap[recapDuration] || recapDuration,
          targetLanguage: recapTargetLanguage
        }
      );
      setRecapScript(script);
      setRecapRetryNotice(null);
      showToast(
        isMm ? '🎉 Auto Recap ဇာတ်ညွှန်း အောင်မြင်စွာ ထုတ်ယူပြီးပါပြီ!' : '🎉 Auto Recap Script generated successfully!',
        'success'
      );
    } catch (err) {
      console.error('[Auto Recap] Script error:', err);
      const msg = err instanceof Error ? err.message : 'Recap generation failed';
      showToast(msg, 'error');
    } finally {
      setIsGeneratingRecapScript(false);
    }
  };

  // 2. Sync Recap Script to Timeline as Timed Subtitles (SRT)
  const handleSyncRecapAsSubtitles = () => {
    if (!recapScript || !recapScript.trim()) {
      showToast(
        isMm ? 'စာတန်းထိုး ချိတ်ဆက်ရန်အတွက် Recap ဇာတ်ညွှန်း မရှိသေးပါ' : 'No recap script to sync',
        'error'
      );
      return;
    }

    const rawSegments = recapScript
      .split(/[။\n]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    const cueTexts: string[] = [];
    rawSegments.forEach(seg => {
      // Split into clean cue blocks where each cue has max 2 lines, max 30 chars/line
      const blocks = splitSentenceIntoCueBlocks(seg, 52, 30);
      blocks.forEach(lines => {
        const joined = lines.join('\n').trim();
        if (joined) cueTexts.push(joined);
      });
    });

    if (cueTexts.length === 0) {
      showToast(isMm ? 'စာသားများ မလုံလောက်ပါ' : 'Script too short', 'error');
      return;
    }

    const availableDuration = (trimEnd > trimStart && trimEnd - trimStart > 3)
      ? (trimEnd - trimStart)
      : (videoDuration > 0 ? videoDuration : 180);
    const startOffset = (trimEnd > trimStart) ? trimStart : 0;
    const count = cueTexts.length;
    const cueDuration = Math.max(2.2, availableDuration / Math.max(1, count));

    const newCues: SubtitleCue[] = cueTexts.map((text, idx) => {
      const cueStartSec = startOffset + (idx * cueDuration);
      const cueEndSec = Math.min(startOffset + availableDuration, cueStartSec + cueDuration - 0.2);
      return {
        id: `recap-cue-${idx}-${Date.now()}`,
        index: idx + 1,
        startSeconds: cueStartSec,
        endSeconds: cueEndSec,
        startStr: normalizeSrtTimestamp(cueStartSec),
        endStr: normalizeSrtTimestamp(cueEndSec),
        text: text
      };
    });

    setCues(newCues);
    setSubtitlesEnabled(true);
    showToast(
      isMm
        ? `✨ Recap ဇာတ်ညွှန်းကို အချိန်ကိုက် စာတန်းထိုး (${newCues.length} ခု) အဖြစ် ချိတ်ဆက်ပြီးပါပြီ!`
        : `✨ Synced ${newCues.length} timed subtitle cues to timeline!`,
      'success'
    );
  };

  // 3. Generate AI Recap Voiceover (TTS)
  const handleGenerateRecapVoiceover = async () => {
    if (!recapScript || !recapScript.trim()) {
      showToast(
        isMm ? 'ကျေးဇူးပြု၍ Voiceover အသံသွင်းရန်အတွက် Recap ဇာတ်ညွှန်းကို အရင်ထုတ်ယူပါ' : 'Please generate recap script first',
        'error'
      );
      return;
    }

    setIsGeneratingRecapVoiceover(true);
    try {
      const gemini = getGeminiInstance();
      const result = await gemini.generateTTS(
        recapScript,
        {
          voiceId: recapVoice,
          speed: recapVoiceSpeed,
          pitch: 0,
          volume: 100,
          vocalStyle: 'Expressive'
        },
        undefined,
        (current, total, msg) => {
          setExportStatusText(`${msg} (${current}/${total})`);
        }
      );

      if (result && result.audioUrl) {
        setVoiceoverAudioUrl(result.audioUrl);
        setVoiceoverVolume(100);
        if (recapAutoDucking) {
          setOriginalAudioVolume(15);
        }
        showToast(
          isMm
            ? '🎙️ Recap Voiceover AI အသံသွင်းဖိုင် အောင်မြင်စွာ ဖန်တီးပြီး Timeline သို့ ချိတ်ဆက်ပြီးပါပြီ!'
            : '🎙️ Recap Voiceover narration generated & linked to timeline!',
          'success'
        );
      } else {
        throw new Error('No audio URL returned from TTS');
      }
    } catch (err) {
      console.error('[Auto Recap] Voiceover error:', err);
      const msg = err instanceof Error ? err.message : 'Voiceover generation failed';
      showToast(msg, 'error');
    } finally {
      setIsGeneratingRecapVoiceover(false);
    }
  };

  // 4. Smart Scene Highlights Detection & Extraction
  const handleGenerateRecapHighlights = async () => {
    setIsAnalyzingHighlights(true);
    try {
      const gemini = getGeminiInstance();
      const contextText = cues.length > 0
        ? cues.map(c => `[${c.startStr}] ${c.text}`).join('\n')
        : (recapScript || recapPrompt || videoFileName);

      const scenes = await gemini.generateRecapHighlights(
        contextText,
        videoDuration > 0 ? videoDuration : 180,
        5
      );

      setRecapHighlights(scenes.map((s, i) => ({
        id: `highlight-${i}-${Date.now()}`,
        title: s.title,
        start: s.start,
        end: s.end,
        description: s.description
      })));

      showToast(
        isMm ? '🎬 အဓိက ဇာတ်ကွက် (Highlights) ၅ ခုကို ခွဲထုတ်ပြီးပါပြီ!' : '🎬 5 Key Highlights extracted!',
        'success'
      );
    } catch (err) {
      console.error('[Auto Recap] Highlights error:', err);
      showToast('Could not extract highlights', 'error');
    } finally {
      setIsAnalyzingHighlights(false);
    }
  };

  // 5. Apply Scene Highlight as Active Timeline Trim
  const handleApplyHighlightAsTrim = (start: number, end: number) => {
    setTrimStart(start);
    setTrimEnd(end);
    handleSeek(start);
    showToast(
      isMm
        ? `✂️ Highlight ဇာတ်ကွက်သို့ Trim ချိန်ညှိပြီးပါပြီ (${formatTime(start)} - ${formatTime(end)})`
        : `✂️ Trimmed to scene (${formatTime(start)} - ${formatTime(end)})`,
      'info'
    );
  };

  // 6. Apply Full Pro Recapper Suite Preset (Anti-Copyright, Speed, Color Grading, Ducking)
  const handleApplyProRecapperSuite = () => {
    setMicroSpeedModulation(1.06);
    setBrightness(105);
    setContrast(120);
    setSaturation(125);
    setVignette(30);
    setHueRotate(-5);
    setFlipHorizontal(false);
    setSubtitlesEnabled(true);
    if (recapAutoDucking) {
      setOriginalAudioVolume(15);
    }
    showToast(
      isMm
        ? '⚡ Pro Recapper မူပိုင်ခွင့်လွတ်၊ 1.06x အမြန်နှုန်းနှင့် Cinematic Grading Suite ကို အပြည့်အစုံ ဖွင့်ထားပြီးပါပြီ!'
        : '⚡ Full Pro Recapper Suite activated (1.06x Speed, Cinematic Grade & Audio Ducking)!',
      'success'
    );
  };

  // Export Subtitle File (.srt) - 100% CapCut & NLE Compatible
  const handleExportSrt = () => {
    if (cues.length === 0) {
      showToast(isMm ? 'ထုတ်ယူရန် စာတန်းထိုး မရှိပါ' : 'No subtitles to export', 'error');
      return;
    }

    const subs: SRTSubtitle[] = cues
      .filter(c => c.text && c.text.trim().length > 0)
      .map((c, i) => {
        const startSec = Math.max(0, c.startSeconds + subTimingOffset);
        const endSec = Math.max(startSec + 0.2, c.endSeconds + subTimingOffset);
        return {
          index: i + 1,
          startTime: normalizeSrtTimestamp(startSec),
          endTime: normalizeSrtTimestamp(endSec),
          text: c.text
        };
      });

    if (subs.length === 0) {
      showToast(isMm ? 'ထုတ်ယူရန် စာတန်းထိုး မရှိပါ' : 'No subtitles to export', 'error');
      return;
    }

    const srtContent = generateSRT(subs);
    downloadSrtFile(srtContent, `${videoFileName.replace(/\.[^/.]+$/, "")}_edited.srt`);
    showToast(
      isMm ? 'CapCut တွဲသုံးနိုင်သော .SRT စာတန်းထိုးဖိုင်ကို ထုတ်ယူပြီးပါပြီ ✅' : 'Exported CapCut-compatible .SRT file ✅',
      'success'
    );
  };

  // Drag-to-resize player height handler (ဗီဒီယိုအရွယ်အစား အပေါ်/အောက် ဆွဲချဲ့ခြင်း)
  const handleStartResize = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsResizingPlayer(true);
    const startY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const startHeight = playerHeight;

    const onMove = (moveEvent: MouseEvent | TouchEvent) => {
      const currentY = 'touches' in moveEvent ? moveEvent.touches[0].clientY : moveEvent.clientY;
      const deltaY = currentY - startY;
      const newHeight = Math.min(800, Math.max(260, startHeight + deltaY));
      setPlayerHeight(newHeight);
    };

    const onEnd = () => {
      setIsResizingPlayer(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', onMove);
    window.addEventListener('touchend', onEnd);
  };

  // Subtitle Cue Operations (စာတန်းထိုး ပြင်ဆင်/ထည့်သွင်း/ဖျက်ပစ်ခြင်း)
  const handleStartEditCue = (cue: SubtitleCue) => {
    setEditingCueId(cue.id);
    setEditCueDraftText(cue.text);
    setEditCueDraftStart(cue.startSeconds);
    setEditCueDraftEnd(cue.endSeconds);
    handleSeek(cue.startSeconds + 0.05);
  };

  const handleSaveEditCue = () => {
    if (!editingCueId) return;
    setCues(prev => prev.map(c => {
      if (c.id === editingCueId) {
        const startSec = Math.max(0, parseFloat(editCueDraftStart.toFixed(2)));
        const endSec = Math.max(startSec + 0.2, parseFloat(editCueDraftEnd.toFixed(2)));
        let formattedText = editCueDraftText.trim() || c.text;
        // If single line longer than 32 chars, wrap into 2 lines
        if (!formattedText.includes('\n') && formattedText.length > 32) {
          formattedText = wrapTextIntoLines(formattedText, 32, 2).join('\n');
        }
        return {
          ...c,
          text: formattedText,
          startSeconds: startSec,
          endSeconds: endSec,
          startStr: normalizeSrtTimestamp(startSec),
          endStr: normalizeSrtTimestamp(endSec)
        };
      }
      return c;
    }));
    setEditingCueId(null);
    showToast(isMm ? 'စာတန်းထိုး ပြင်ဆင်ချက် သိမ်းဆည်းပြီးပါပြီ' : 'Subtitle cue updated', 'success');
  };

  const handleAutoBalanceCues = () => {
    if (cues.length === 0) {
      showToast(isMm ? 'ညှိစရာ စာတန်းထိုး မရှိပါ' : 'No subtitle cues to balance', 'error');
      return;
    }
    let modifiedCount = 0;
    const updated = cues.map(cue => {
      const rawText = cue.text.trim();
      const needsWrapping = !rawText.includes('\n') ? rawText.length > 30 : rawText.split('\n').some(l => l.trim().length > 34);
      if (needsWrapping) {
        modifiedCount++;
        const wrappedLines = wrapTextIntoLines(rawText, 30, 2);
        return {
          ...cue,
          text: wrappedLines.join('\n')
        };
      }
      return cue;
    });

    setCues(updated);
    showToast(
      isMm
        ? `✨ ရှည်လျားသော စာတန်းထိုး (${modifiedCount} ခု) ကို ၂ ကြောင်းညီအောင် အလိုအလျောက် ခွဲညှိပေးပြီးပါပြီ!`
        : `✨ Auto-wrapped ${modifiedCount} long subtitle cues into clean 2-line format!`,
      'success'
    );
  };

  const handleCancelEditCue = () => {
    setEditingCueId(null);
  };

  const handleDeleteCue = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setCues(prev => {
      const updated = prev.filter(c => c.id !== id);
      return updated.map((c, idx) => ({ ...c, index: idx + 1 }));
    });
    if (editingCueId === id) setEditingCueId(null);
    showToast(isMm ? 'စာတန်းထိုး ဖျက်ပြီးပါပြီ' : 'Subtitle cue deleted', 'info');
  };

  const handleAddNewCue = () => {
    const newStart = Math.max(0, parseFloat(currentTime.toFixed(2)));
    const newEnd = parseFloat((newStart + 2.5).toFixed(2));
    const newId = `cue-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newCue: SubtitleCue = {
      id: newId,
      index: cues.length + 1,
      startSeconds: newStart,
      endSeconds: newEnd,
      startStr: secondsToSrtTime(newStart),
      endStr: secondsToSrtTime(newEnd),
      text: isMm ? 'စာတန်းထိုး အသစ်' : 'New subtitle'
    };

    setCues(prev => {
      const combined = [...prev, newCue].sort((a, b) => a.startSeconds - b.startSeconds);
      return combined.map((c, i) => ({ ...c, index: i + 1 }));
    });

    setEditingCueId(newId);
    setEditCueDraftText(newCue.text);
    setEditCueDraftStart(newStart);
    setEditCueDraftEnd(newEnd);
    showToast(isMm ? 'စာတန်းထိုး အသစ် ထည့်သွင်းပြီးပါပြီ' : 'Added new subtitle cue', 'success');
  };

  const handleOpenFullSrtModal = () => {
    const subs: SRTSubtitle[] = cues.map((c, i) => ({
      index: i + 1,
      startTime: c.startStr,
      endTime: c.endStr,
      text: c.text
    }));
    setFullSrtDraftText(generateSRT(subs));
    setIsFullSrtModalOpen(true);
  };

  const handleApplyFullSrt = () => {
    if (!fullSrtDraftText.trim()) {
      showToast(isMm ? 'SRT စာသား မရှိပါ' : 'No SRT text provided', 'error');
      return;
    }
    const parsed = parseSrtText(fullSrtDraftText);
    if (parsed.length === 0) {
      showToast(isMm ? 'SRT format မမှန်ကန်ပါ' : 'Invalid SRT format', 'error');
      return;
    }
    setCues(parsed);
    setIsFullSrtModalOpen(false);
    showToast(isMm ? `စာတန်းထိုး ${parsed.length} ခု အားလုံး ပြင်ဆင်ပြီးပါပြီ` : `Updated ${parsed.length} subtitle cues`, 'success');
  };

  // User Custom Font Handlers
  const handleAddUserFont = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newFontName.trim()) {
      showToast(isMm ? 'Font အမည် ထည့်သွင်းပေးပါ' : 'Please enter font name', 'error');
      return;
    }

    setIsAddingFont(true);
    try {
      const fontId = `user_font_${Date.now()}`;
      const familyName = newFontName.trim().replace(/['"]/g, '');
      let fontUrl = newFontUrl.trim();

      if (newFontFile) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(newFontFile);
        });
        fontUrl = dataUrl;

        try {
          const fontFace = new FontFace(familyName, `url(${dataUrl})`);
          await fontFace.load();
          document.fonts.add(fontFace);
        } catch (fontErr) {
          console.warn('FontFace API load warning:', fontErr);
        }

        const style = document.createElement('style');
        style.textContent = `
          @font-face {
            font-family: '${familyName}';
            src: url('${dataUrl}');
            font-display: swap;
          }
        `;
        document.head.appendChild(style);
      } else if (fontUrl) {
        if (isFontGoogle) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = fontUrl;
          document.head.appendChild(link);
        } else {
          const style = document.createElement('style');
          style.textContent = `
            @font-face {
              font-family: '${familyName}';
              src: url('${fontUrl}');
              font-display: swap;
            }
          `;
          document.head.appendChild(style);
        }
      } else {
        showToast(isMm ? 'Font ဖိုင် (.ttf/.otf/.woff) သို့မဟုတ် URL ရွေးချယ်ပေးပါ' : 'Please upload a font file or enter URL', 'error');
        setIsAddingFont(false);
        return;
      }

      const newFont: CustomFont = {
        id: fontId,
        name: newFontName.trim(),
        family: familyName,
        url: fontUrl,
        isGoogleFont: isFontGoogle,
        createdAt: new Date().toISOString()
      };

      const updated = [...userCustomFonts.filter(f => f.family !== familyName), newFont];
      setUserCustomFonts(updated);
      try {
        localStorage.setItem('vbs_user_custom_fonts', JSON.stringify(updated));
      } catch (storageErr) {
        console.warn('LocalStorage font save warning:', storageErr);
      }

      setSubFontFamily(`"${familyName}", sans-serif`);
      setNewFontName('');
      setNewFontUrl('');
      setNewFontFile(null);
      setIsFontModalOpen(false);
      showToast(isMm ? `🎉 Font "${familyName}" ကို အောင်မြင်စွာ ထည့်သွင်းအသုံးပြုလိုက်ပါပြီ!` : `Font "${familyName}" added and applied!`, 'success');
    } catch (err) {
      console.error('Failed to add font:', err);
      showToast(isMm ? 'Font ထည့်သွင်းခြင်း မအောင်မြင်ပါ' : 'Failed to add custom font', 'error');
    } finally {
      setIsAddingFont(false);
    }
  };

  const handleDeleteUserFont = (id: string, name: string) => {
    const updated = userCustomFonts.filter(f => f.id !== id);
    setUserCustomFonts(updated);
    try {
      localStorage.setItem('vbs_user_custom_fonts', JSON.stringify(updated));
    } catch (e) {
      console.warn('LocalStorage remove warning:', e);
    }
    showToast(isMm ? `Font "${name}" ကို ဖျက်ပြီးပါပြီ` : `Deleted font "${name}"`, 'info');
  };

  // Browser Direct Video Export (Upgraded Zero-Stutter Frame Capture)
  const handleExportBrowser = async () => {
    const video = videoRef.current;
    if (!video || !videoSrc) return;

    setExportProgress(10);
    setExportStatusText(isMm ? 'Browser Engine ဖြင့် စတင်နေသည်...' : 'Initializing Browser Engine...');

    const renderCanvas = document.createElement('canvas');
    renderCanvas.width = targetCanvasSize.width;
    renderCanvas.height = targetCanvasSize.height;
    const renderCtx = renderCanvas.getContext('2d', { alpha: false });
    if (!renderCtx) throw new Error('Could not create render context');

    renderCtx.imageSmoothingEnabled = true;
    renderCtx.imageSmoothingQuality = 'high';

    const AudioCtxConstructor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const audioCtx = new AudioCtxConstructor();
    const dest = audioCtx.createMediaStreamDestination();

    const videoAudioSource = audioCtx.createMediaElementSource(video);
    const videoGain = audioCtx.createGain();
    videoGain.gain.value = originalAudioVolume / 100;

    const bassFilter = audioCtx.createBiquadFilter();
    bassFilter.type = 'lowshelf';
    bassFilter.frequency.value = 250;
    bassFilter.gain.value = bassBoostDb;

    const trebleFilter = audioCtx.createBiquadFilter();
    trebleFilter.type = 'highshelf';
    trebleFilter.frequency.value = 4000;
    trebleFilter.gain.value = trebleBoostDb;

    videoAudioSource.connect(bassFilter);
    bassFilter.connect(trebleFilter);
    trebleFilter.connect(videoGain);
    videoGain.connect(dest);

    if (antiHashMaskNoise) {
      const bufferSize = audioCtx.sampleRate * 2;
      const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      const whiteNoise = audioCtx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;
      whiteNoise.loop = true;

      const noiseFilter = audioCtx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.value = 1000;

      const noiseGain = audioCtx.createGain();
      noiseGain.gain.value = 0.003;

      whiteNoise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(dest);
      whiteNoise.start(0);
    }

    let voiceoverElement: HTMLAudioElement | null = null;
    if (voiceoverAudioUrl && voiceoverAudioUrl.trim() !== '') {
      voiceoverElement = new Audio(voiceoverAudioUrl);
      voiceoverElement.onerror = () => {};
      const voSource = audioCtx.createMediaElementSource(voiceoverElement);
      const voGain = audioCtx.createGain();
      voGain.gain.value = voiceoverVolume / 100;
      voSource.connect(voGain);
      voGain.connect(dest);
    }

    // Stream Capture with frame sync
    const canvasStream = renderCanvas.captureStream(30);
    const audioTracks = dest.stream.getAudioTracks();
    if (audioTracks.length > 0) {
      canvasStream.addTrack(audioTracks[0]);
    }

    const mimeType = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1,mp4a.40.2')
      ? 'video/mp4;codecs=avc1,mp4a.40.2'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : 'video/webm';

    // Bitrate mapping for crystal-clear original quality
    const bitrateMap: Record<string, number> = {
      original: 32000000, // 32 Mbps for pristine original quality
      high: 18000000,     // 18 Mbps high quality
      standard: 8000000   // 8 Mbps standard
    };
    const selectedBitrate = bitrateMap[exportQuality] || 32000000;

    const mediaRecorder = new MediaRecorder(canvasStream, {
      mimeType,
      videoBitsPerSecond: selectedBitrate,
      audioBitsPerSecond: 256000
    });

    const chunks: Blob[] = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunks.push(e.data);
      }
    };

    const renderStartTime = trimStart;
    const renderEndTime = trimEnd > trimStart ? trimEnd : (video.duration || 1000);
    const totalRenderDuration = Math.max(0.1, renderEndTime - renderStartTime);

    video.currentTime = renderStartTime;
    video.playbackRate = 1.0;
    await new Promise(r => setTimeout(r, 250));

    // Draw initial frame before recording starts
    const initialCue = cues.find(c => {
      const adjT = renderStartTime - subTimingOffset;
      return adjT >= c.startSeconds && adjT <= c.endSeconds;
    });
    drawFrameToCanvas(renderCtx, video, renderCanvas.width, renderCanvas.height, initialCue);

    mediaRecorder.start(100);
    if (voiceoverElement) {
      voiceoverElement.currentTime = 0;
      voiceoverElement.play().catch(() => {});
    }
    await video.play();

    // Smooth, frame-synchronized render loop with zero timer skipping
    await new Promise<void>((resolve, reject) => {
      let isEnded = false;

      const onFrameTick = () => {
        if (isEnded || exportAbortRef.current) return;

        const cueAtTime = cues.find(c => {
          const adjT = video.currentTime - subTimingOffset;
          return adjT >= c.startSeconds && adjT <= c.endSeconds;
        });
        drawFrameToCanvas(renderCtx, video, renderCanvas.width, renderCanvas.height, cueAtTime);

        const elapsed = Math.max(0, video.currentTime - renderStartTime);
        const pct = Math.min(99, Math.round((elapsed / totalRenderDuration) * 100));
        setExportProgress(pct);
        setExportStatusText(
          isMm
            ? `Browser မှ ထုတ်ယူနေသည် (${pct}%) — Frame အားလုံး တိကျစွာ ပေါင်းစပ်နေသည်...`
            : `Rendering in browser (${pct}%) — smoothly burning subtitles...`
        );

        if (video.currentTime >= renderEndTime || video.ended) {
          isEnded = true;
          video.pause();
          if (voiceoverElement) voiceoverElement.pause();
          mediaRecorder.stop();
          resolve();
          return;
        }

        if ('requestVideoFrameCallback' in video && typeof (video as unknown as { requestVideoFrameCallback: (cb: () => void) => number }).requestVideoFrameCallback === 'function') {
          (video as unknown as { requestVideoFrameCallback: (cb: () => void) => number }).requestVideoFrameCallback(onFrameTick);
        } else {
          requestAnimationFrame(onFrameTick);
        }
      };

      if ('requestVideoFrameCallback' in video && typeof (video as unknown as { requestVideoFrameCallback: (cb: () => void) => number }).requestVideoFrameCallback === 'function') {
        (video as unknown as { requestVideoFrameCallback: (cb: () => void) => number }).requestVideoFrameCallback(onFrameTick);
      } else {
        requestAnimationFrame(onFrameTick);
      }

      const safetyCheck = setInterval(() => {
        if (exportAbortRef.current) {
          clearInterval(safetyCheck);
          isEnded = true;
          video.pause();
          mediaRecorder.stop();
          reject(new Error('Export cancelled by user'));
          return;
        }
        if (video.currentTime >= renderEndTime || video.ended) {
          clearInterval(safetyCheck);
          if (!isEnded) {
            isEnded = true;
            video.pause();
            if (voiceoverElement) voiceoverElement.pause();
            mediaRecorder.stop();
            resolve();
          }
        }
      }, 150);
    });

    await new Promise(r => setTimeout(r, 400));
    const blob = new Blob(chunks, { type: mimeType });
    const finalUrl = URL.createObjectURL(blob);
    setExportProgress(100);
    setExportStatusText(isMm ? 'ဗီဒီယို ထုတ်ယူခြင်း ပြီးစီးပါပြီ!' : 'Export completed successfully!');

    const link = document.createElement('a');
    link.href = finalUrl;
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    link.download = `VBS_Browser_${videoFileName.replace(/\.[^/.]+$/, "")}_${aspectRatio.replace(':', '-')}.${ext}`;
    link.click();

    showToast(isMm ? '🎉 ဗီဒီယိုကို Browser မှ အောင်မြင်စွာ ထုတ်ယူပြီးပါပြီ!' : 'Export complete!', 'success');
  };

  // Video Export Engine: Server FFmpeg (100% Zero-Stutter & Original Quality) + Browser Direct Fallback
  const handleExportVideo = async () => {
    const video = videoRef.current;
    if (!video || !videoSrc) {
      showToast(isMm ? 'ဗီဒီယိုဖိုင် မရှိသေးပါ' : 'No video loaded to export', 'error');
      return;
    }

    setIsExporting(true);
    setExportProgress(5);
    exportAbortRef.current = false;
    if (onProcessingStateChange) onProcessingStateChange(true);

    try {
      // 0. If Local PC / VPS Worker Engine is selected
      if (exportEngine === 'worker') {
        const currentH = WorkerEngineService.getHealth();
        if (currentH.status !== 'online') {
          showToast(
            isMm
              ? 'Local PC Worker ချိတ်ဆက်မထားပါ (ကွန်ပျူတာ ပိတ်ထားပါသလား စစ်ဆေးပါ) — Cloud Server Engine သို့ ပြောင်းလဲထုတ်ယူပါသည်'
              : 'Local PC Worker is offline. Switching to Cloud Server Engine...',
            'info'
          );
          // Fall through to cloud server export below
        } else {
          setExportStatusText(
            isMm
              ? 'သင့် Computer ပေါ်ရှိ Local FFmpeg Engine ဖြင့် စတင် Render နေပါသည် (100% Zero-Stutter)...'
              : 'Rendering via Local PC FFmpeg Engine (Zero-Stutter Lossless)...'
          );

          let fileToSend: File | Blob | null = rawVideoFile;
          if (!fileToSend) {
            setExportStatusText(isMm ? 'ဗီဒီယို အချက်အလက်များ ပြင်ဆင်နေပါသည်...' : 'Preparing video data...');
            const resp = await fetch(videoSrc);
            const blob = await resp.blob();
            fileToSend = new File([blob], videoFileName || 'video.mp4', { type: blob.type || 'video/mp4' });
          }

          const formData = new FormData();
          formData.append('video', fileToSend, videoFileName || 'video.mp4');

          if (subtitlesEnabled && cues.length > 0) {
            const subs: SRTSubtitle[] = cues.map((cue, i) => ({
              index: i + 1,
              startTime: cue.startStr,
              endTime: cue.endStr,
              text: cue.text
            }));
            formData.append('srtContent', generateSRT(subs));
            formData.append('fontFamily', subFontFamily);
            formData.append('fontSize', String(subFontSize));
            formData.append('fontColor', subFontColor);
            formData.append('strokeColor', subStrokeColor);

            // If user selected a custom uploaded font, include the font file for FFmpeg
            const activeCustomFont = userCustomFonts.find(f =>
              subFontFamily.includes(f.family) || subFontFamily.includes(f.name)
            );
            if (activeCustomFont?.url && activeCustomFont.url.startsWith('data:')) {
              try {
                const fontResp = await fetch(activeCustomFont.url);
                const fontBlob = await fontResp.blob();
                const fontSafeName = `${activeCustomFont.family.replace(/[^a-zA-Z0-9_-]/g, '_')}.ttf`;
                formData.append('fontFile', fontBlob, fontSafeName);
              } catch (fontBlobErr) {
                console.warn('Could not serialize custom font for FFmpeg:', fontBlobErr);
              }
            }
          }

          if (voiceoverAudioUrl) {
            try {
              const audioResp = await fetch(voiceoverAudioUrl);
              const audioBlob = await audioResp.blob();
              formData.append('audio', audioBlob, 'narration.mp3');
            } catch (audioErr) {
              console.warn('Could not serialize voiceover audio for worker:', audioErr);
            }
          }

          formData.append('aspectRatio', aspectRatio);
          formData.append('trimStart', String(trimStart));
          if (trimEnd > trimStart) {
            formData.append('trimEnd', String(trimEnd));
          }

          const features: Record<string, boolean> = {
            flip: flipHorizontal,
            vflip: flipVertical,
            colorGrade: brightness !== 100 || contrast !== 100 || saturation !== 100,
            burnIn: subtitlesEnabled && cues.length > 0
          };
          formData.append('features', JSON.stringify(features));

          setExportProgress(45);
          setExportStatusText(
            isMm
              ? 'သင့် PC ပေါ်ရှိ FFmpeg ဖြင့် ဗီဒီယို Frame တိုင်းကို တိကျစွာ မထစ်အောင် Render လုပ်နေပါသည်...'
              : 'Local PC FFmpeg rendering frames at full speed...'
          );

          const workerResult = await WorkerEngineService.processVideo(formData, (txt) => setExportStatusText(txt));

          setExportProgress(100);
          setExportStatusText(isMm ? 'ဗီဒီယို ထုတ်ယူခြင်း ပြီးစီးပါပြီ!' : 'Export completed successfully!');

          const downloadLink = document.createElement('a');
          downloadLink.href = workerResult.downloadUrl;
          downloadLink.download = `VBS_LocalPC_${videoFileName.replace(/\.[^/.]+$/, "")}_${aspectRatio.replace(':', '-')}.mp4`;
          document.body.appendChild(downloadLink);
          downloadLink.click();
          document.body.removeChild(downloadLink);

          showToast(
            isMm
              ? '🎉 သင့် Computer ပေါ်ရှိ Local FFmpeg ဖြင့် လုံးဝမထစ်သော မူရင်း HD ဗီဒီယိုကို အောင်မြင်စွာ ထုတ်ယူပြီးပါပြီ!'
              : 'Export complete via Local PC Worker Engine!',
            'success'
          );
          return;
        }
      }

      // 1. If Server FFmpeg engine is selected (or Worker fell through)
      if (exportEngine === 'server' || exportEngine === 'worker') {
        setExportStatusText(
          isMm
            ? 'Server FFmpeg Engine ဖြင့် စတင်နေသည် (100% Zero-Stutter, မူရင်းအရည်အသွေး)...'
            : 'Connecting to Server FFmpeg Engine (Zero-Stutter lossless encoding)...'
        );

        let fileToSend: File | Blob | null = rawVideoFile;

        // If no raw file in memory, convert current videoSrc to Blob
        if (!fileToSend) {
          setExportStatusText(isMm ? 'ဗီဒီယို အချက်အလက်များ ပြင်ဆင်နေပါသည်...' : 'Preparing video data...');
          const resp = await fetch(videoSrc);
          const blob = await resp.blob();
          fileToSend = new File([blob], videoFileName || 'video.mp4', { type: blob.type || 'video/mp4' });
        }

        const formData = new FormData();
        formData.append('video', fileToSend, videoFileName || 'video.mp4');

        // Prepare exact SRT subtitles if cues exist
        if (subtitlesEnabled && cues.length > 0) {
          const subs: SRTSubtitle[] = cues.map((cue, i) => ({
            index: i + 1,
            startTime: cue.startStr,
            endTime: cue.endStr,
            text: cue.text
          }));
          formData.append('srtContent', generateSRT(subs));
          formData.append('fontFamily', subFontFamily);
          formData.append('fontSize', String(subFontSize));
          formData.append('fontColor', subFontColor);
          formData.append('strokeColor', subStrokeColor);

          // If user selected a custom uploaded font, include the font file for FFmpeg
          const activeCustomFont = userCustomFonts.find(f =>
            subFontFamily.includes(f.family) || subFontFamily.includes(f.name)
          );
          if (activeCustomFont?.url && activeCustomFont.url.startsWith('data:')) {
            try {
              const fontResp = await fetch(activeCustomFont.url);
              const fontBlob = await fontResp.blob();
              const fontSafeName = `${activeCustomFont.family.replace(/[^a-zA-Z0-9_-]/g, '_')}.ttf`;
              formData.append('fontFile', fontBlob, fontSafeName);
            } catch (fontBlobErr) {
              console.warn('Could not serialize custom font for Server FFmpeg:', fontBlobErr);
            }
          }
        }

        if (voiceoverAudioUrl) {
          try {
            const audioResp = await fetch(voiceoverAudioUrl);
            const audioBlob = await audioResp.blob();
            formData.append('audio', audioBlob, 'narration.mp3');
          } catch (audioErr) {
            console.warn('Could not serialize voiceover audio for server:', audioErr);
          }
        }

        formData.append('aspectRatio', aspectRatio);
        formData.append('trimStart', String(trimStart));
        if (trimEnd > trimStart) {
          formData.append('trimEnd', String(trimEnd));
        }

        // Active features for server FFmpeg processing
        const features: Record<string, boolean> = {
          flip: flipHorizontal,
          vflip: flipVertical,
          colorGrade: brightness !== 100 || contrast !== 100 || saturation !== 100,
          burnIn: subtitlesEnabled && cues.length > 0
        };
        formData.append('features', JSON.stringify(features));

        setExportProgress(35);
        setExportStatusText(
          isMm
            ? 'Server FFmpeg Engine ဖြင့် ဗီဒီယိုကို မထစ်အောင် Frame တိုင်း တိကျစွာ Render ပြုလုပ်နေပါသည်...'
            : 'Server FFmpeg encoding in progress (Frame-accurate Zero Stutter)...'
        );

        const response = await fetch('/api/video/process', {
          method: 'POST',
          body: formData
        });

        if (!response.ok) {
          throw new Error(`Server returned HTTP ${response.status}`);
        }

        const resData = await response.json();
        if (!resData.success || !resData.downloadUrl) {
          throw new Error(resData.error || 'Server processing failed');
        }

        setExportProgress(100);
        setExportStatusText(isMm ? 'ဗီဒီယို ထုတ်ယူခြင်း ပြီးစီးပါပြီ!' : 'Export completed successfully!');

        // Download the processed video directly
        const downloadLink = document.createElement('a');
        downloadLink.href = resData.downloadUrl;
        downloadLink.download = `VBS_ZeroStutter_${videoFileName.replace(/\.[^/.]+$/, "")}_${aspectRatio.replace(':', '-')}.mp4`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);

        showToast(
          isMm
            ? '🎉 Server FFmpeg ဖြင့် လုံးဝမထစ်သော မူရင်းအရည်အသွေး ဗီဒီယိုကို အောင်မြင်စွာ ထုတ်ယူပြီးပါပြီ!'
            : 'Export complete! 100% Smooth Zero-Stutter Original Quality!',
          'success'
        );
        return;
      }

      // 2. Browser Direct Engine
      await handleExportBrowser();
    } catch (err: unknown) {
      console.error('Export error:', err);
      const msg = err instanceof Error ? err.message : 'Failed to export video';

      // If server failed, try fallback to browser engine
      if (exportEngine === 'server') {
        showToast(
          isMm
            ? 'Server ချိတ်ဆက်မှု အခက်အခဲရှိ၍ Browser Engine သို့ ပြောင်းလဲထုတ်ယူပါသည်...'
            : 'Server error, falling back to Browser Engine...',
          'info'
        );
        try {
          await handleExportBrowser();
          return;
        } catch (browserErr: unknown) {
          console.error('Fallback Browser Export error:', browserErr);
          const bMsg = browserErr instanceof Error ? browserErr.message : 'Fallback export failed';
          showToast(bMsg, 'error');
        }
      } else {
        showToast(msg, 'error');
      }
    } finally {
      setIsExporting(false);
      if (onProcessingStateChange) onProcessingStateChange(false);
    }
  };

  const filteredCues = useMemo(() => {
    if (!subTextSearch.trim()) return cues;
    const term = subTextSearch.toLowerCase();
    return cues.filter(c => c.text.toLowerCase().includes(term));
  }, [cues, subTextSearch]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-2 sm:px-4 pb-16">
      {/* Top Banner / Hero */}
      <div className="glass-card rounded-[28px] p-6 sm:p-8 border border-white/10 shadow-2xl relative overflow-hidden bg-gradient-to-br from-black/80 via-slate-950/70 to-black/90">
        <div className="absolute top-0 right-0 w-80 h-80 bg-amber-500/10 rounded-full blur-[90px] -z-10 pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="p-2.5 bg-amber-400/15 border border-amber-400/30 rounded-2xl text-amber-400 shadow-lg shadow-amber-400/10">
                <Film size={26} />
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                {isMm ? 'Video Edit Studio' : 'Video Edit Studio'}
              </h2>
              <span className="px-3 py-1 bg-amber-400/20 text-amber-300 border border-amber-400/40 rounded-full text-xs font-black uppercase tracking-wider">
                PRO SUITE
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 max-w-2xl leading-relaxed">
              {isMm
                ? 'ဗီဒီယိုတွင် မြန်မာစာတန်းထိုး (Subtitles) ထိုးခြင်း၊ Aspect Ratio (16:9 / 9:16 Shorts) ပြောင်းခြင်း၊ Color Grading ပြုလုပ်ခြင်း နှင့် မူပိုင်ခွင့် (Copyright) လွတ်အောင် အသံ/ရုပ် ပြင်ဆင်ခြင်း tools များ'
                : 'Burn-in Burmese subtitles, change aspect ratios with blurred backgrounds, grade colors, and apply anti-copyright visual & audio bypass tools.'}
            </p>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold text-xs border border-white/10 transition-all cursor-pointer shadow-sm active:scale-95">
              <Upload size={15} />
              <span>{isMm ? 'ဗီဒီယို တင်ရန်' : 'Load Video'}</span>
              <input type="file" accept="video/*" onChange={handleFileUpload} className="hidden" />
            </label>

            <label className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold text-xs border border-white/10 transition-all cursor-pointer shadow-sm active:scale-95">
              <FileText size={15} />
              <span>{isMm ? '.SRT ထည့်ရန်' : 'Load .SRT'}</span>
              <input type="file" accept=".srt,.vtt,.txt" onChange={handleSrtUpload} className="hidden" />
            </label>

            <button
              type="button"
              onClick={applyAntiCopyrightPreset}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-extrabold text-xs border border-amber-500/40 shadow-lg shadow-amber-500/10 transition-all active:scale-95"
              title="Activate full anti-copyright audio and video bypass suite"
            >
              <ShieldAlert size={15} />
              <span>{isMm ? '1-Click မူပိုင်ခွင့်ကာကွယ်' : 'Anti-Copyright'}</span>
            </button>

            {/* Quick Auto Recap Studio Launch Button */}
            <button
              type="button"
              onClick={() => setActiveInspectorTab('recap')}
              className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl font-black text-xs border shadow-lg transition-all active:scale-95 cursor-pointer ${
                activeInspectorTab === 'recap'
                  ? 'bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 text-black border-amber-300 shadow-amber-400/30'
                  : 'bg-gradient-to-r from-amber-500/20 via-yellow-500/10 to-amber-500/20 hover:from-amber-500/30 hover:to-yellow-500/20 text-amber-300 border-amber-500/40 shadow-amber-500/10'
              }`}
              title="Open Pro Auto Movie & Video Recap Studio"
            >
              <Sparkles size={14} className={activeInspectorTab === 'recap' ? "fill-black text-black" : "text-amber-400 animate-pulse"} />
              <span>{isMm ? '⚡ Auto Recap' : '⚡ Auto Recap'}</span>
              <span className={`text-[9px] px-1.5 py-0.2 rounded font-black tracking-wider uppercase ${
                activeInspectorTab === 'recap' ? 'bg-black text-amber-400' : 'bg-amber-400/30 text-amber-200'
              }`}>PRO</span>
            </button>

            {/* Engine Selector: Local PC Worker (Zero-Stutter) vs Cloud Server vs Browser */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowEngineOptions(!showEngineOptions)}
                className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-extrabold border transition-all shadow-sm ${
                  exportEngine === 'worker'
                    ? (workerHealth.status === 'online'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-emerald-500/10'
                        : 'bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-rose-500/10')
                    : exportEngine === 'server'
                    ? 'bg-amber-400/20 text-amber-300 border-amber-400/40'
                    : 'bg-white/10 text-slate-300 border-white/10'
                }`}
                title="Select video export engine: Local PC Worker (Recommended), Cloud Server, or Browser"
              >
                {exportEngine === 'worker' ? (
                  <Laptop size={14} className={workerHealth.status === 'online' ? 'text-emerald-400' : 'text-rose-400'} />
                ) : (
                  <Cpu size={14} className="text-amber-400" />
                )}
                <span>
                  {exportEngine === 'worker'
                    ? (workerHealth.status === 'online'
                        ? (isMm ? '🟢 Local PC (Online)' : '🟢 PC Worker (Online)')
                        : (isMm ? '🔴 Local PC (Offline)' : '🔴 PC Worker (Offline)'))
                    : exportEngine === 'server'
                    ? (isMm ? '🚀 Cloud Server' : '🚀 Cloud Server')
                    : (isMm ? '🌐 Browser' : '🌐 Browser')}
                </span>
                <ChevronDown size={13} className={`transition-transform ${showEngineOptions ? 'rotate-180' : ''}`} />
              </button>

              {showEngineOptions && (
                <div className="absolute right-0 top-full mt-2 w-72 p-2.5 rounded-2xl bg-slate-950/95 backdrop-blur-xl border border-white/15 shadow-2xl z-50 space-y-1.5">
                  <div className="flex items-center justify-between px-2 py-0.5">
                    <p className="text-[10px] font-bold text-slate-400 px-2 py-0.5 uppercase tracking-wider">
                      {isMm ? 'ထုတ်ယူမည့် Video Engine' : 'Rendering Engine'}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setShowEngineOptions(false);
                        setIsWorkerModalOpen(true);
                      }}
                      className="text-[10px] text-amber-400 hover:text-amber-300 underline font-bold"
                    >
                      {isMm ? 'Worker တင်နည်း' : 'Setup Worker'}
                    </button>
                  </div>

                  {/* Option 1: Local PC Worker */}
                  <button
                    type="button"
                    onClick={() => {
                      setExportEngine('worker');
                      setShowEngineOptions(false);
                      if (workerHealth.status !== 'online') {
                        setIsWorkerModalOpen(true);
                      }
                    }}
                    className={`w-full flex flex-col p-2.5 rounded-xl text-left transition-all ${
                      exportEngine === 'worker'
                        ? 'bg-emerald-500/20 text-white border border-emerald-500/40 shadow-md'
                        : 'text-slate-200 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full font-bold text-xs">
                      <span className="flex items-center gap-1.5">
                        <Laptop size={14} className={workerHealth.status === 'online' ? 'text-emerald-400' : 'text-rose-400'} />
                        <span>💻 Local PC / VPS Engine</span>
                      </span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-black ${
                        workerHealth.status === 'online'
                          ? 'bg-emerald-500 text-black animate-pulse'
                          : 'bg-rose-500/30 text-rose-300'
                      }`}>
                        {workerHealth.status === 'online' ? 'ONLINE 🟢' : 'OFFLINE 🔴'}
                      </span>
                    </div>
                    <span className="text-[11px] opacity-80 mt-1 leading-snug">
                      {workerHealth.status === 'online'
                        ? (isMm ? 'သင့် PC မှ Native FFmpeg ဖြင့် ၁၀၀% မထစ်ဘဲ အမြန်ဆုံး Render လုပ်မည်' : 'Fastest native FFmpeg on your PC. 100% Zero-stutter')
                        : (isMm ? 'ကွန်ပျူတာ ပိတ်ထားသည် သို့မဟုတ် Worker မဖွင့်ရသေးပါ (နှိပ်၍ စတင်နည်းကြည့်ပါ)' : 'PC is off or worker not running. Click to setup.')}
                    </span>
                  </button>

                  {/* Option 2: Cloud Server */}
                  <button
                    type="button"
                    onClick={() => {
                      setExportEngine('server');
                      setShowEngineOptions(false);
                    }}
                    className={`w-full flex flex-col p-2.5 rounded-xl text-left transition-all ${
                      exportEngine === 'server' ? 'bg-amber-400 text-black shadow-md' : 'text-slate-200 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full font-bold text-xs">
                      <span>🚀 Cloud Server FFmpeg</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-black ${exportEngine === 'server' ? 'bg-black text-amber-300' : 'bg-amber-400/20 text-amber-300'}`}>
                        Cloud
                      </span>
                    </div>
                    <span className="text-[11px] opacity-80 mt-1 leading-snug">
                      {isMm ? 'Server ပေါ်တွင် Frame တိုင်း တိကျစွာ Render ပြုလုပ်မည်' : 'Cloud server frame-accurate rendering'}
                    </span>
                  </button>

                  {/* Option 3: Browser Direct */}
                  <button
                    type="button"
                    onClick={() => {
                      setExportEngine('browser');
                      setShowEngineOptions(false);
                    }}
                    className={`w-full flex flex-col p-2.5 rounded-xl text-left transition-all ${
                      exportEngine === 'browser' ? 'bg-white/20 text-white shadow-md' : 'text-slate-200 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full font-bold text-xs">
                      <span>🌐 Browser Direct Engine</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 font-mono">
                        Client
                      </span>
                    </div>
                    <span className="text-[11px] opacity-80 mt-1 leading-snug">
                      {isMm ? 'Browser ပေါ်မှ အမြန်ဆုံး Frame sync ဖြင့် တိုက်ရိုက်ထုတ်ယူမည်' : 'In-browser direct client rendering'}
                    </span>
                  </button>
                </div>
              )}
            </div>

            {/* Quality Selector */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowExportOptions(!showExportOptions)}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold text-xs border border-white/10 transition-all shadow-sm"
                title="Select video export quality & bitrate"
              >
                <Sliders size={14} className="text-amber-400" />
                <span>
                  {exportQuality === 'original'
                    ? (isMm ? 'မူရင်း (Original 30M)' : 'Original (30M)')
                    : exportQuality === 'high'
                    ? (isMm ? 'မြင့်မား (High 18M)' : 'High (18M)')
                    : (isMm ? 'ပုံမှန် (Standard 8M)' : 'Standard (8M)')}
                </span>
                <ChevronDown size={13} className={`transition-transform ${showExportOptions ? 'rotate-180' : ''}`} />
              </button>

              {showExportOptions && (
                <div className="absolute right-0 top-full mt-2 w-56 p-2 rounded-2xl bg-slate-950/95 backdrop-blur-xl border border-white/15 shadow-2xl z-50 space-y-1">
                  <p className="text-[10px] font-bold text-slate-400 px-2 py-1 uppercase tracking-wider">
                    {isMm ? 'ထုတ်ယူမည့် အရည်အသွေး (Bitrate)' : 'Export Video Quality'}
                  </p>
                  {(['original', 'high', 'standard'] as const).map(q => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => {
                        setExportQuality(q);
                        setShowExportOptions(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold text-left transition-all ${
                        exportQuality === q ? 'bg-amber-400 text-black shadow-md' : 'text-slate-300 hover:bg-white/10'
                      }`}
                    >
                      <span>
                        {q === 'original' ? (isMm ? '🌟 မူရင်း (Original HD)' : '🌟 Original HD') : q === 'high' ? (isMm ? '✨ မြင့်မား (High 1080p)' : '✨ High 1080p') : (isMm ? '⚡ ပုံမှန် (Standard)' : '⚡ Standard Web')}
                      </span>
                      <span className="text-[10px] opacity-80 font-mono">
                        {q === 'original' ? '30 Mbps' : q === 'high' ? '18 Mbps' : '8 Mbps'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Theater Mode Toggle */}
            <button
              type="button"
              onClick={() => setIsTheaterMode(!isTheaterMode)}
              className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl border font-bold text-xs transition-all ${
                isTheaterMode
                  ? 'bg-amber-400/20 text-amber-300 border-amber-400/40 shadow-sm'
                  : 'bg-white/10 hover:bg-white/15 text-white border-white/10'
              }`}
              title={isTheaterMode ? 'Switch to Split Studio View' : 'Expand Video to Theater Mode'}
            >
              {isTheaterMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              <span>{isTheaterMode ? (isMm ? 'ဘေးချင်းယှဉ် (Split)' : 'Split View') : (isMm ? 'ရုပ်ရှင်ရုံဟန် (Theater)' : 'Theater Mode')}</span>
            </button>

            <button
              type="button"
              onClick={handleCaptureSnapshot}
              disabled={!videoSrc}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 font-bold text-xs border border-purple-500/30 transition-all active:scale-95 disabled:opacity-40"
              title="Capture HD snapshot at current timestamp"
            >
              <Camera size={15} />
              <span>{isMm ? 'ပုံရိုက်မည်' : 'Snapshot'}</span>
            </button>

            <button
              type="button"
              onClick={handleExportVideo}
              disabled={!videoSrc || isExporting}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 via-amber-300 to-yellow-400 text-black font-black text-xs shadow-xl shadow-amber-400/20 hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
            >
              {isExporting ? (
                <>
                  <RefreshCw size={15} className="animate-spin text-black" />
                  <span>{isMm ? 'ထုတ်ယူနေသည်...' : 'Rendering...'}</span>
                </>
              ) : (
                <>
                  <Download size={15} className="stroke-[2.5]" />
                  <span>{isMm ? 'မူရင်းအရည်အသွေး ဗီဒီယို ထုတ်ယူမည်' : 'Export Ultra-HD Video'}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {isExporting && (
          <div className="mt-6 pt-5 border-t border-white/10 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span className="flex items-center gap-2 font-bold text-amber-400">
                <RefreshCw size={13} className="animate-spin" />
                {exportStatusText}
              </span>
              <span className="font-mono font-bold text-amber-400">{exportProgress}%</span>
            </div>
            <div className="w-full bg-black/60 h-2.5 rounded-full overflow-hidden border border-white/10">
              <motion.div
                className="bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 h-full rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${exportProgress}%` }}
                transition={{ duration: 0.2 }}
              />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => { exportAbortRef.current = true; }}
                className="text-[11px] text-rose-400 hover:text-rose-300 underline"
              >
                Cancel Export
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main Workspace (Sticky Video Preview keeps video visible while editing tools!) */}
      <div className={`grid grid-cols-1 ${isTheaterMode ? 'gap-6' : 'lg:grid-cols-12 gap-6'}`}>
        {/* Left Video Canvas Area - Pinned & Sticky */}
        <div className={`${isTheaterMode ? 'w-full' : 'lg:col-span-7 lg:sticky lg:top-4 self-start lg:max-h-[calc(100vh-2rem)] overflow-y-auto no-scrollbar'} space-y-3`}>
          <div className="glass-card rounded-[24px] p-4 sm:p-5 border border-white/10 shadow-2xl space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/10">
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
                {(['16:9', '9:16', '1:1', '4:5', '4:3', '21:9', 'original'] as AspectRatioType[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setAspectRatio(r)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all shrink-0 ${
                      aspectRatio === r
                        ? 'bg-amber-400 text-black shadow-md shadow-amber-400/20'
                        : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    {r === '16:9' ? '16:9 (Landscape)' : r === '9:16' ? '9:16 (Shorts/TikTok)' : r === 'original' ? (isMm ? 'မူရင်းအရွယ်အစား (Original)' : 'Original') : r}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                {/* Quick Mirror Horizontal */}
                <button
                  type="button"
                  onClick={() => {
                    setFlipHorizontal(!flipHorizontal);
                    showToast(isMm ? (!flipHorizontal ? 'Flip Horizontal (ဘယ်/ညာ) ဖွင့်ပါသည်' : 'Flip Horizontal ပိတ်ပါသည်') : (!flipHorizontal ? 'Flip Horizontal ON' : 'Flip Horizontal OFF'), 'info');
                  }}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold border transition-all ${
                    flipHorizontal
                      ? 'bg-amber-400 text-black border-amber-400 shadow-sm'
                      : 'bg-white/5 hover:bg-white/10 text-slate-300 border-white/10'
                  }`}
                  title="Horizontal Mirror Flip (Flip X)"
                >
                  <FlipHorizontal size={13} />
                  <span>Mirror H</span>
                </button>

                {/* Quick Mirror Vertical */}
                <button
                  type="button"
                  onClick={() => {
                    setFlipVertical(!flipVertical);
                    showToast(isMm ? (!flipVertical ? 'Flip Vertical (အထက်/အောက်) ဖွင့်ပါသည်' : 'Flip Vertical ပိတ်ပါသည်') : (!flipVertical ? 'Flip Vertical ON' : 'Flip Vertical OFF'), 'info');
                  }}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold border transition-all ${
                    flipVertical
                      ? 'bg-amber-400 text-black border-amber-400 shadow-sm'
                      : 'bg-white/5 hover:bg-white/10 text-slate-300 border-white/10'
                  }`}
                  title="Vertical Mirror Flip (Flip Y)"
                >
                  <FlipVertical size={13} />
                  <span>Mirror V</span>
                </button>

                <button
                  type="button"
                  onMouseDown={() => setShowOriginalComparison(true)}
                  onMouseUp={() => setShowOriginalComparison(false)}
                  onTouchStart={() => setShowOriginalComparison(true)}
                  onTouchEnd={() => setShowOriginalComparison(false)}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold border border-white/10 transition-all select-none active:bg-amber-400/20 active:text-amber-300"
                  title="Press and hold to see raw original video without edits"
                >
                  {showOriginalComparison ? <EyeOff size={13} className="text-amber-400" /> : <Eye size={13} />}
                  <span>{showOriginalComparison ? (isMm ? 'မူရင်းပြနေသည်' : 'Original') : (isMm ? 'မူရင်းကြည့်ရန် ဖိထားပါ' : 'Hold Original')}</span>
                </button>
              </div>
            </div>

            {/* Video Canvas Container with Resizable Height (လိုသလို ဆွဲချဲ့နိုင်သည်) */}
            <div
              style={{ height: `${playerHeight}px` }}
              className="relative w-full bg-black rounded-2xl overflow-hidden flex items-center justify-center border border-white/10 shadow-inner group transition-all"
            >
              {videoSrc && (
                <video
                  ref={videoRef}
                  src={videoSrc}
                  className="hidden"
                  playsInline
                  onLoadedMetadata={handleLoadedMetadata}
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  onEnded={() => setIsPlaying(false)}
                  onError={() => {}}
                />
              )}

              {videoSrc ? (
                <>
                  <canvas
                    ref={canvasRef}
                    style={{
                      transform: previewZoom !== 100 ? `scale(${previewZoom / 100})` : undefined,
                      transformOrigin: 'center center'
                    }}
                    className="max-h-full max-w-full object-contain cursor-pointer transition-transform duration-150"
                    onClick={togglePlayPause}
                  />

                  <div
                    onClick={togglePlayPause}
                    className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer pointer-events-none"
                  >
                    <div className="w-14 h-14 rounded-full bg-black/70 backdrop-blur border border-white/20 flex items-center justify-center text-white shadow-2xl">
                      {isPlaying ? <Pause size={24} /> : <Play size={24} className="ml-1" />}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center p-8 text-center space-y-4">
                  <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-amber-400">
                    <Film size={32} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">
                      {isMm ? 'ပြင်ဆင်လိုသော ဗီဒီယိုဖိုင်ကို ထည့်သွင်းပါ' : 'Load a video to begin editing'}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      {isMm ? 'MP4, WebM, MOV စသည့် ဖိုင်များကို ထည့်သွင်းနိုင်ပါသည်' : 'Supports MP4, WebM, MOV or clips from the Transcriber tab'}
                    </p>
                  </div>
                  <label className="px-5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-extrabold text-xs shadow-lg shadow-amber-400/20 cursor-pointer transition-all active:scale-95">
                    {isMm ? 'ဖိုင်ရွေးချယ်မည်' : 'Select Video File'}
                    <input type="file" accept="video/*" onChange={handleFileUpload} className="hidden" />
                  </label>
                </div>
              )}
            </div>

            {/* Draggable Height Resize Handle Bar */}
            <div
              onMouseDown={handleStartResize}
              onTouchStart={handleStartResize}
              className={`h-4 w-full flex items-center justify-center cursor-ns-resize rounded-lg transition-colors group/drag select-none ${
                isResizingPlayer ? 'bg-amber-400/30' : 'hover:bg-white/10 active:bg-amber-400/30'
              }`}
              title="Click and drag up/down to resize video player height"
            >
              <div className="w-20 h-1 bg-white/30 group-hover/drag:bg-amber-400 group-hover/drag:w-28 rounded-full transition-all flex items-center justify-center" />
            </div>

            {/* Player Resizing & Zoom Controls Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-1 border-t border-white/5">
              <div className="flex items-center gap-1 text-[11px] text-slate-400 font-bold">
                <span>{isMm ? 'အရွယ်အစား:' : 'Size:'}</span>
                {([320, 460, 600, 750] as const).map(h => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setPlayerHeight(h)}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-all ${
                      playerHeight === h ? 'bg-amber-400 text-black' : 'bg-white/5 hover:bg-white/15 text-slate-300'
                    }`}
                  >
                    {h === 320 ? 'Small' : h === 460 ? 'Medium' : h === 600 ? 'Large' : 'Max'}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-bold">
                <span>{isMm ? 'ချဲ့/ကျုံ့ (Zoom):' : 'Zoom:'}</span>
                <button
                  type="button"
                  onClick={() => setPreviewZoom(prev => Math.max(50, prev - 25))}
                  className="p-1 rounded bg-white/5 hover:bg-white/15 text-slate-300"
                  title="Zoom Out"
                >
                  <ZoomOut size={12} />
                </button>
                <span className="font-mono text-amber-400 text-[10px] w-8 text-center">{previewZoom}%</span>
                <button
                  type="button"
                  onClick={() => setPreviewZoom(prev => Math.min(175, prev + 25))}
                  className="p-1 rounded bg-white/5 hover:bg-white/15 text-slate-300"
                  title="Zoom In"
                >
                  <ZoomIn size={12} />
                </button>
                {previewZoom !== 100 && (
                  <button
                    type="button"
                    onClick={() => setPreviewZoom(100)}
                    className="text-[10px] text-amber-400 underline hover:text-amber-300 pl-1"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>

            {videoSrc && (
              <div className="space-y-3 pt-2">
                <div className="relative flex items-center">
                  <input
                    type="range"
                    min={0}
                    max={videoDuration || 100}
                    step={0.05}
                    value={currentTime}
                    onChange={(e) => handleSeek(parseFloat(e.target.value))}
                    className="w-full accent-amber-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={togglePlayPause}
                      className="p-2.5 rounded-xl bg-amber-400 text-black hover:bg-amber-300 transition-all font-bold shadow-md shadow-amber-400/20 active:scale-95"
                    >
                      {isPlaying ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSeek(0)}
                      className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 transition-all"
                      title="Rewind to beginning"
                    >
                      <RotateCcw size={16} />
                    </button>

                    <div className="flex items-center gap-1 font-mono text-xs font-bold text-slate-300 pl-2">
                      <span className="text-amber-400">{formatTime(currentTime)}</span>
                      <span className="text-slate-600">/</span>
                      <span>{formatTime(videoDuration)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsMuted(!isMuted)}
                      className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 transition-all"
                    >
                      {isMuted ? <VolumeX size={16} className="text-rose-400" /> : <Volume2 size={16} />}
                    </button>

                    {trimEnd > 0 && trimEnd < videoDuration && (
                      <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-[11px] font-mono text-amber-300">
                        Trim: {formatTime(trimStart)} - {formatTime(trimEnd)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {cues.length > 0 && (
            <div className="glass-card rounded-2xl p-4 border border-white/10 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-500/15 text-emerald-400 rounded-xl">
                  <Type size={18} />
                </div>
                <div>
                  <p className="text-xs font-bold text-white">
                    {isMm ? `စာတန်းထိုး ${cues.length} ခု ထည့်သွင်းထားသည်` : `${cues.length} Subtitle Cues Loaded`}
                  </p>
                  <p className="text-[11px] text-slate-400 truncate max-w-sm">
                    {currentActiveCue ? `Current: "${currentActiveCue.text}"` : 'No cue at current time'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSubtitlesEnabled(!subtitlesEnabled)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                    subtitlesEnabled
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      : 'bg-white/5 text-slate-400 border-white/10'
                  }`}
                >
                  {subtitlesEnabled ? (isMm ? 'စာတန်းထိုး ဖွင့်ထားသည်' : 'Subtitles ON') : (isMm ? 'ပိတ်ထားသည်' : 'Subtitles OFF')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Inspector Tools Panel */}
        <div className="lg:col-span-5 space-y-4">
          <div className="glass-card rounded-[24px] p-5 border border-white/10 shadow-2xl space-y-5">
            {/* Inspector Navigation Tabs */}
            <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-white/10 overflow-x-auto no-scrollbar">
              <button
                type="button"
                onClick={() => setActiveInspectorTab('recap')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all shrink-0 cursor-pointer ${
                  activeInspectorTab === 'recap'
                    ? 'bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 text-black shadow-md shadow-amber-400/30 font-extrabold'
                    : 'text-amber-400 hover:text-white hover:bg-amber-400/10'
                }`}
              >
                <Sparkles size={14} className={activeInspectorTab === 'recap' ? "fill-black" : "animate-pulse"} />
                <span>{isMm ? 'Auto Recap' : 'Auto Recap'}</span>
                <span className={`text-[9px] px-1.5 py-0.2 rounded font-black uppercase ${
                  activeInspectorTab === 'recap' ? 'bg-black text-amber-400' : 'bg-amber-400/20 text-amber-300'
                }`}>PRO</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveInspectorTab('subtitles')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all shrink-0 ${
                  activeInspectorTab === 'subtitles'
                    ? 'bg-amber-400 text-black shadow-md shadow-amber-400/20'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Type size={14} />
                <span>{isMm ? 'စာတန်းထိုး' : 'Subtitles'}</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveInspectorTab('mirror')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all shrink-0 ${
                  activeInspectorTab === 'mirror'
                    ? 'bg-amber-400 text-black shadow-md shadow-amber-400/20'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <FlipHorizontal size={14} />
                <span>{isMm ? 'မှန်ရိပ် (Mirror)' : 'Mirror & Flip'}</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveInspectorTab('color')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all shrink-0 ${
                  activeInspectorTab === 'color'
                    ? 'bg-amber-400 text-black shadow-md shadow-amber-400/20'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Palette size={14} />
                <span>{isMm ? 'အရောင်' : 'Color'}</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveInspectorTab('ratio')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all shrink-0 ${
                  activeInspectorTab === 'ratio'
                    ? 'bg-amber-400 text-black shadow-md shadow-amber-400/20'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Ratio size={14} />
                <span>{isMm ? 'အချိုးအစား' : 'Format'}</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveInspectorTab('anticopyright')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all shrink-0 ${
                  activeInspectorTab === 'anticopyright'
                    ? 'bg-amber-400 text-black shadow-md shadow-amber-400/20'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <ShieldAlert size={14} />
                <span>{isMm ? 'မူပိုင်ခွင့်လွတ်' : 'Anti-Copy'}</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveInspectorTab('audio')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all shrink-0 ${
                  activeInspectorTab === 'audio'
                    ? 'bg-amber-400 text-black shadow-md shadow-amber-400/20'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Music size={14} />
                <span>{isMm ? 'အသံ' : 'Audio'}</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveInspectorTab('trim')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all shrink-0 ${
                  activeInspectorTab === 'trim'
                    ? 'bg-amber-400 text-black shadow-md shadow-amber-400/20'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Scissors size={14} />
                <span>{isMm ? 'ဖြတ်တောက်' : 'Trim'}</span>
              </button>
            </div>

            {/* TAB 0: PRO AUTO RECAP STUDIO (ရုပ်ရှင်နှင့် ဗီဒီယို အော်တို ရီကပ် ဖန်တီးစနစ်) */}
            {activeInspectorTab === 'recap' && (
              <div className="space-y-4">
                {/* Header Banner */}
                <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-500/15 via-yellow-500/10 to-transparent border border-amber-500/30 shadow-lg relative overflow-hidden">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="p-1.5 rounded-xl bg-amber-400 text-black shadow-md">
                          <Sparkles size={16} className="fill-black" />
                        </span>
                        <h3 className="text-sm font-black text-amber-400 tracking-wide">
                          {isMm ? 'Pro Auto Recap Studio (ရုပ်ရှင်/ဗီဒီယို အော်တို ရီကပ်)' : 'Pro Auto Recap Studio'}
                        </h3>
                        <span className="px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 text-[10px] font-mono font-black border border-amber-400/30">
                          AI WORKFLOW
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        {isMm
                          ? 'AI ဖြင့် ရုပ်ရှင်ဇာတ်လမ်းပြော ရီကပ်ဇာတ်ညွှန်း၊ Voiceover အသံသွင်း၊ အချိန်ကိုက် စာတန်းထိုးနှင့် အဓိက ဇာတ်ကွက်များကို တစ်နေရာတည်းတွင် အလွယ်တကူ ဖန်တီးနိုင်ပါသည်'
                          : 'Generate viral movie recap narration script, AI voiceover, synchronized subtitles, and highlights montage.'}
                      </p>
                    </div>
                  </div>

                  {recapRetryNotice && (
                    <div className="mt-2.5 p-2 rounded-xl bg-amber-500/20 border border-amber-500/40 text-[11px] text-amber-300 font-bold flex items-center gap-2">
                      <RefreshCw size={13} className="animate-spin text-amber-400" />
                      <span>{recapRetryNotice}</span>
                    </div>
                  )}
                </div>

                {/* Section 1: AI Recap Script Engine */}
                <div className="rounded-2xl border border-white/10 bg-black/40 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                      <FileText size={14} />
                      <span>{isMm ? '၁။ ရီကပ် ဇာတ်ညွှန်း ထုတ်လုပ်ခြင်း' : '1. Recap Script Generator'}</span>
                    </span>
                    <span className="text-[11px] text-slate-400 font-bold">
                      {isMm ? 'ဇာတ်လမ်းဇာတ်ကွက် အချက်အလက်' : 'Source Context'}
                    </span>
                  </div>

                  {/* Source Toggle */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRecapSource('subtitles')}
                      className={`flex items-center justify-center gap-1.5 p-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                        recapSource === 'subtitles'
                          ? 'bg-amber-400/20 text-amber-300 border-amber-400/40 shadow-sm'
                          : 'bg-white/5 text-slate-400 border-white/5 hover:text-white'
                      }`}
                    >
                      <Type size={13} />
                      <span>{isMm ? `စာတန်းထိုးမှ (${cues.length} ခု)` : `From Cues (${cues.length})`}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRecapSource('prompt')}
                      className={`flex items-center justify-center gap-1.5 p-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                        recapSource === 'prompt'
                          ? 'bg-amber-400/20 text-amber-300 border-amber-400/40 shadow-sm'
                          : 'bg-white/5 text-slate-400 border-white/5 hover:text-white'
                      }`}
                    >
                      <Edit3 size={13} />
                      <span>{isMm ? 'ဇာတ်လမ်းအကျဉ်း ရေးမည်' : 'Custom Synopsis'}</span>
                    </button>
                  </div>

                  {recapSource === 'prompt' && (
                    <div className="space-y-1.5">
                      <label className="text-[11px] text-slate-400 font-bold">
                        {isMm ? 'ရုပ်ရှင်အမည် / ဇာတ်လမ်းအကျဉ်း / အဓိက ဇာတ်ကွက်များ' : 'Movie Title / Synopsis / Plot Points'}
                      </label>
                      <textarea
                        value={recapPrompt}
                        onChange={(e) => setRecapPrompt(e.target.value)}
                        rows={3}
                        placeholder={
                          isMm
                            ? 'ဥပမာ - Train to Busan ရုပ်ရှင်ဇာတ်ကား ရီကပ်၊ ဖခင်တစ်ယောက် သမီးလေးကို ကာကွယ်ရင်း ဇွန်ဘီတွေရန်က လွတ်အောင် ရထားပေါ်မှာ ရုန်းကန်ရတဲ့ စိတ်လှုပ်ရှားဖွယ် ဇာတ်လမ်း...'
                            : 'Enter movie title, plot points, synopsis, or character highlights to recap...'
                        }
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                    </div>
                  )}

                  {/* Style Presets */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-slate-400 font-bold">
                      {isMm ? 'ရီကပ်စတိုင် (Recap Style Preset)' : 'Recap Style Preset'}
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {[
                        { id: 'cinematic', icon: '🎬', nameMm: 'ရုပ်ရှင် ရသစုံ', nameEn: 'Cinematic Recap' },
                        { id: 'tiktok', icon: '🔥', nameMm: 'TikTok အမြန် 60s', nameEn: 'Viral 60s Short' },
                        { id: 'thriller', icon: '🕵️', nameMm: 'သည်းထိတ်ရင်ဖို', nameEn: 'Thriller Mystery' },
                        { id: 'action', icon: '⚔️', nameMm: 'အက်ရှင် အလှည့်အပြောင်း', nameEn: 'Action & Twists' },
                        { id: 'drama', icon: '🎭', nameMm: 'ဒရာမာ ခံစားချက်', nameEn: 'Emotional Drama' },
                        { id: 'summary', icon: '💡', nameMm: 'အနှစ်ချုပ် ဗဟုသုတ', nameEn: 'Key Summary' }
                      ].map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setRecapStyle(item.id)}
                          className={`flex items-center gap-1.5 p-2 rounded-xl text-left text-xs font-bold border transition-all cursor-pointer ${
                            recapStyle === item.id
                              ? 'bg-amber-400 text-black border-amber-300 font-black shadow-md'
                              : 'bg-white/5 text-slate-300 border-white/5 hover:bg-white/10'
                          }`}
                        >
                          <span className="text-sm">{item.icon}</span>
                          <span className="truncate">{isMm ? item.nameMm : item.nameEn}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Duration & Language Options */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-slate-400 font-bold block mb-1">
                        {isMm ? 'ပစ်မှတ် ကြာချိန်' : 'Target Length'}
                      </label>
                      <select
                        value={recapDuration}
                        onChange={(e) => setRecapDuration(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                      >
                        <option value="short">⚡ Short (၁-၂ မိနစ် / 60-120s)</option>
                        <option value="medium">🎬 Medium (၃-၅ မိနစ် / 3-5 Mins)</option>
                        <option value="full">📜 Full Story (၈-၁၀ မိနစ် / 8-10 Mins)</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[11px] text-slate-400 font-bold block mb-1">
                        {isMm ? 'ဘာသာစကား' : 'Language'}
                      </label>
                      <select
                        value={recapTargetLanguage}
                        onChange={(e) => setRecapTargetLanguage(e.target.value as 'mm' | 'en')}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                      >
                        <option value="mm">🇲🇲 မြန်မာစကားပြော (Burmese)</option>
                        <option value="en">🇺🇸 English Narration</option>
                      </select>
                    </div>
                  </div>

                  {/* Generate Button */}
                  <button
                    type="button"
                    onClick={handleGenerateRecapScript}
                    disabled={isGeneratingRecapScript}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 hover:from-amber-300 hover:to-yellow-400 text-black font-black text-xs shadow-lg shadow-amber-400/20 transition-all active:scale-98 disabled:opacity-50 cursor-pointer"
                  >
                    {isGeneratingRecapScript ? (
                      <>
                        <RefreshCw size={14} className="animate-spin stroke-[2.5]" />
                        <span>{isMm ? 'AI ဖြင့် Recap ဇာတ်ညွှန်း ရေးသားနေပါသည်...' : 'Generating AI Recap Script...'}</span>
                      </>
                    ) : (
                      <>
                        <Sparkles size={14} className="fill-black stroke-[2.5]" />
                        <span>{isMm ? '✨ Recap ဇာတ်ညွှန်း ထုတ်လုပ်မည်' : '✨ Generate Recap Script'}</span>
                      </>
                    )}
                  </button>

                  {/* Generated Script Display & Editor */}
                  {recapScript && (
                    <div className="space-y-2 pt-2 border-t border-white/10">
                      <div className="flex items-center justify-between text-[11px] text-slate-300">
                        <div className="flex items-center gap-2 font-mono font-bold text-amber-400">
                          <span>{recapScriptStats.words} Words</span>
                          <span>•</span>
                          <span>{recapScriptStats.chars} Chars</span>
                          <span>•</span>
                          <span>⏱️ ~{recapScriptStats.estTime} Narration</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(recapScript);
                            showToast(isMm ? '📋 Script ကို ကူးယူပြီးပါပြီ' : 'Copied script to clipboard', 'success');
                          }}
                          className="flex items-center gap-1 text-slate-400 hover:text-white text-[11px] font-bold cursor-pointer"
                        >
                          <Copy size={12} />
                          <span>{isMm ? 'ကူးယူမည်' : 'Copy'}</span>
                        </button>
                      </div>

                      <textarea
                        value={recapScript}
                        onChange={(e) => setRecapScript(e.target.value)}
                        rows={6}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-white leading-relaxed focus:outline-none focus:ring-1 focus:ring-amber-500 font-sans"
                        placeholder="Generated recap script..."
                      />
                    </div>
                  )}
                </div>

                {/* Section 2: AI Voiceover Narration & Subtitle Sync */}
                {recapScript && (
                  <div className="rounded-2xl border border-white/10 bg-black/40 p-4 space-y-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold uppercase tracking-wider text-purple-400 flex items-center gap-1.5">
                        <Mic size={14} />
                        <span>{isMm ? '၂။ Voiceover အသံသွင်းနှင့် စာတန်းထိုး' : '2. Voiceover & Subtitles'}</span>
                      </span>
                      {voiceoverAudioUrl && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                          VO Track Active 🟢
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] text-slate-400 font-bold block mb-1">
                          {isMm ? 'AI အသံရှင် (Voice Talent)' : 'Voice Talent'}
                        </label>
                        <select
                          value={recapVoice}
                          onChange={(e) => setRecapVoice(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                        >
                          {VOICE_OPTIONS.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.gender === 'female' ? '👩' : '👨'} {v.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[11px] text-slate-400 font-bold flex justify-between mb-1">
                          <span>{isMm ? 'အသံနှုန်း' : 'Speed'}</span>
                          <span className="text-purple-400 font-mono">{recapVoiceSpeed.toFixed(2)}x</span>
                        </label>
                        <input
                          type="range"
                          min="0.9"
                          max="1.3"
                          step="0.05"
                          value={recapVoiceSpeed}
                          onChange={(e) => setRecapVoiceSpeed(parseFloat(e.target.value))}
                          className="w-full accent-purple-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer mt-2"
                        />
                      </div>
                    </div>

                    {/* Audio Ducking Toggle */}
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20">
                      <div className="space-y-0.5">
                        <span className="text-xs font-bold text-white flex items-center gap-1.5">
                          <Volume2 size={13} className="text-purple-400" />
                          <span>{isMm ? 'မူရင်း ဗီဒီယိုအသံ လျှော့ချခြင်း (Ducking)' : 'Auto Audio Ducking'}</span>
                        </span>
                        <p className="text-[10px] text-slate-400">
                          {isMm ? 'မူရင်းဗီဒီယိုအသံကို ၁၅% သို့ လျှော့ချပြီး Voiceover ကို ကြည်လင်ပြတ်သားစေမည်' : 'Lowers original video to 15% so narration voice is crystal clear'}
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={recapAutoDucking}
                        onChange={(e) => setRecapAutoDucking(e.target.checked)}
                        className="w-4 h-4 accent-purple-500 rounded cursor-pointer"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        type="button"
                        onClick={handleGenerateRecapVoiceover}
                        disabled={isGeneratingRecapVoiceover}
                        className="flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-extrabold text-xs shadow-md transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                      >
                        {isGeneratingRecapVoiceover ? (
                          <>
                            <RefreshCw size={13} className="animate-spin" />
                            <span>{isMm ? 'ထုတ်ယူနေပါသည်...' : 'Generating...'}</span>
                          </>
                        ) : (
                          <>
                            <Mic size={13} />
                            <span>{isMm ? '🎙️ Voiceover အသံသွင်းမည်' : '🎙️ Generate Voiceover'}</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={handleSyncRecapAsSubtitles}
                        className="flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-extrabold text-xs shadow-md transition-all active:scale-95 cursor-pointer"
                      >
                        <Type size={13} />
                        <span>{isMm ? '⏱️ စာတန်းထိုး ချိတ်ဆက်မည်' : '⏱️ Sync Subtitles'}</span>
                      </button>
                    </div>

                    {voiceoverAudioUrl && (
                      <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-2">
                        <audio src={voiceoverAudioUrl} controls className="h-8 max-w-[200px]" />
                        <button
                          type="button"
                          onClick={() => setVoiceoverAudioUrl(null)}
                          className="text-[11px] text-rose-400 hover:underline font-bold cursor-pointer"
                        >
                          {isMm ? 'ဖယ်ရှားမည်' : 'Remove Track'}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Section 3: Smart Highlights Montage */}
                <div className="rounded-2xl border border-white/10 bg-black/40 p-4 space-y-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                      <Scissors size={14} />
                      <span>{isMm ? '၃။ အဓိက ဇာတ်ကွက်များ ခွဲထုတ်ခြင်း' : '3. Key Highlights Extraction'}</span>
                    </span>
                    <button
                      type="button"
                      onClick={handleGenerateRecapHighlights}
                      disabled={isAnalyzingHighlights}
                      className="text-xs text-cyan-400 hover:text-cyan-300 font-extrabold flex items-center gap-1 hover:underline cursor-pointer"
                    >
                      {isAnalyzingHighlights ? (
                        <>
                          <RefreshCw size={12} className="animate-spin" />
                          <span>{isMm ? 'ရှာဖွေနေပါသည်...' : 'Analyzing...'}</span>
                        </>
                      ) : (
                        <>
                          <Sparkles size={12} />
                          <span>{isMm ? 'ဇာတ်ကွက် ခွဲထုတ်မည်' : 'Analyze Scenes'}</span>
                        </>
                      )}
                    </button>
                  </div>

                  {recapHighlights.length > 0 ? (
                    <div className="space-y-2">
                      {recapHighlights.map((hl) => (
                        <div
                          key={hl.id}
                          className="p-2.5 rounded-xl bg-slate-900/80 border border-white/5 flex items-center justify-between gap-2 hover:border-cyan-500/30 transition-all"
                        >
                          <div className="space-y-0.5 min-w-0">
                            <p className="text-xs font-bold text-white truncate">{hl.title}</p>
                            <span className="text-[10px] font-mono text-cyan-400 font-bold">
                              {formatTime(hl.start)} - {formatTime(hl.end)}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleSeek(hl.start)}
                              className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-white text-[10px] font-bold transition-all cursor-pointer"
                              title="Seek playhead to highlight"
                            >
                              <Play size={10} className="inline mr-1" />
                              {isMm ? 'ကြည့်မည်' : 'Jump'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleApplyHighlightAsTrim(hl.start, hl.end)}
                              className="px-2 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/30 text-[10px] font-bold transition-all cursor-pointer"
                              title="Set timeline trim to this highlight"
                            >
                              <Scissors size={10} className="inline mr-1" />
                              Trim
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-4 px-2 rounded-xl bg-white/5 border border-dashed border-white/10 space-y-2">
                      <p className="text-xs text-slate-400">
                        {isMm
                          ? 'ဗီဒီယို၏ အဓိက အရေးပါသော ဇာတ်ကွက် ၅ ခု (Opening Hook, Incident, Conflict, Climax, Ending) ကို အလိုအလျောက် ခွဲထုတ်ပေးပါသည်'
                          : 'Auto-extract 5 dramatic scene chapters across video timeline for quick montage cuts.'}
                      </p>
                      <button
                        type="button"
                        onClick={handleGenerateRecapHighlights}
                        disabled={isAnalyzingHighlights}
                        className="px-3 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-extrabold transition-all cursor-pointer"
                      >
                        {isMm ? '🎬 အဓိက ဇာတ်ကွက်များ စတင်ခွဲထုတ်မည်' : '🎬 Extract Highlights Now'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Section 4: Pro Recapper Anti-Copyright & Styling Suite */}
                <div className="rounded-2xl border border-white/10 bg-black/40 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-rose-400 flex items-center gap-1.5">
                      <ShieldAlert size={14} />
                      <span>{isMm ? '၄။ Pro Recapper မူပိုင်ခွင့်လွတ် Preset' : '4. Pro Recapper Anti-Copyright'}</span>
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 font-bold">
                      1-Click Preset
                    </span>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">
                    {isMm
                      ? 'YouTube / Facebook မူပိုင်ခွင့် (Copyright Bot) ရှောင်ရှားရန်အတွက် 1.06x Pacing Speed, Cinematic Contrast Grading, နှင့် Audio Ducking ကို တစ်ချက်နှိပ်ရုံဖြင့် အလိုအလျောက် သတ်မှတ်ပေးပါသည်'
                      : 'Applies 1.06x speed modulation, cinematic teal & orange grading, and audio ducking for copyright avoidance.'}
                  </p>

                  <button
                    type="button"
                    onClick={handleApplyProRecapperSuite}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-rose-500/20 via-rose-500/30 to-rose-500/20 hover:from-rose-500/30 hover:to-rose-500/40 text-rose-300 border border-rose-500/40 font-black text-xs shadow-md transition-all active:scale-98 cursor-pointer"
                  >
                    <Zap size={14} className="text-rose-400 fill-rose-400" />
                    <span>{isMm ? '⚡ Pro Recapper မူပိုင်ခွင့်လွတ် Preset အားလုံး ဖွင့်မည်' : '⚡ Activate Full Pro Recapper Suite'}</span>
                  </button>
                </div>

                {/* Section 5: Master Export with FFmpeg */}
                <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-yellow-500/5 to-transparent p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                      <Download size={14} />
                      <span>{isMm ? '၅။ Recap ဗီဒီယို ထုတ်ယူခြင်း (FFmpeg)' : '5. Export Recap Video'}</span>
                    </span>
                    <span className="text-[10px] text-amber-300 font-mono font-bold">
                      Lossless 1080p
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleExportVideo()}
                    disabled={isExporting}
                    className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 hover:from-amber-300 hover:to-yellow-400 text-black font-black text-sm shadow-xl shadow-amber-400/20 transition-all active:scale-98 disabled:opacity-50 cursor-pointer"
                  >
                    {isExporting ? (
                      <>
                        <RefreshCw size={16} className="animate-spin stroke-[2.5]" />
                        <span>{isMm ? 'FFmpeg ဖြင့် Render လုပ်နေပါသည်...' : 'Exporting Video...'}</span>
                      </>
                    ) : (
                      <>
                        <Download size={16} className="stroke-[2.5]" />
                        <span>{isMm ? '🚀 Recap ဗီဒီယိုကို FFmpeg ဖြင့် ထုတ်ယူမည်' : '🚀 Export Recap Video via FFmpeg'}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* TAB 1: SUBTITLES (စာတန်းထိုး အပြည့်အစုံ ပြင်ဆင်ခြင်း) */}
            {activeInspectorTab === 'subtitles' && (
              <div className="space-y-4">
                {/* Subtitle Action Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/10">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                      <Type size={14} />
                      <span>{isMm ? 'စာတန်းထိုး တည်းဖြတ်ရေး' : 'Subtitle Editor'}</span>
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 text-[10px] font-mono font-bold">
                      {cues.length}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleAddNewCue}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-extrabold text-[11px] shadow-sm transition-all active:scale-95"
                      title="Add subtitle cue at current video playhead"
                    >
                      <Plus size={13} className="stroke-[3]" />
                      <span>{isMm ? '+ အသစ်ထည့်' : '+ Add Cue'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleOpenFullSrtModal}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold text-[11px] border border-white/10 transition-all"
                      title="Edit entire SRT script in text editor"
                    >
                      <Edit3 size={12} />
                      <span>{isMm ? 'SRT အပြည့်အစုံ' : 'Full SRT'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleExportSrt}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-amber-400 font-bold text-[11px] border border-white/10 transition-all"
                      title="Export synchronized .SRT file"
                    >
                      <Download size={12} />
                      <span>.SRT</span>
                    </button>
                  </div>
                </div>

                {/* Collapsible Subtitle Styling & Offset Accordion (ရှုပ်ပွမှုကင်းဝေးစေရန်) */}
                <div className="rounded-xl border border-white/10 bg-black/40 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setIsSubtitleStylingCollapsed(!isSubtitleStylingCollapsed)}
                    className="w-full flex items-center justify-between p-3 text-xs font-bold text-slate-300 hover:bg-white/5 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <Palette size={14} className="text-amber-400" />
                      <span>{isMm ? 'စာလုံးစတိုင်နှင့် နေရာချထားမှု ချိန်ညှိချက်များ' : 'Font, Color & Style Settings'}</span>
                    </span>
                    <ChevronDown size={14} className={`transition-transform duration-200 ${!isSubtitleStylingCollapsed ? 'rotate-180 text-amber-400' : 'text-slate-500'}`} />
                  </button>

                  {!isSubtitleStylingCollapsed && (
                    <div className="p-3 border-t border-white/5 space-y-3.5 bg-black/20">
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <label className="text-[11px] text-slate-400 font-bold">
                            {isMm ? 'စာလုံးစတိုင် (Font Family)' : 'Font Family'}
                          </label>
                          <button
                            type="button"
                            onClick={() => setIsFontModalOpen(true)}
                            className="text-[10px] text-amber-400 hover:text-amber-300 font-bold flex items-center gap-1 hover:underline cursor-pointer"
                          >
                            <Plus size={11} className="stroke-[3]" />
                            <span>{isMm ? '+ Font အသစ်ထည့်မည်' : '+ Add Font'}</span>
                          </button>
                        </div>
                        <select
                          value={subFontFamily}
                          onChange={(e) => setSubFontFamily(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500 transition-all"
                        >
                          <optgroup label="System Fonts">
                            <option value='"Noto Sans Myanmar", "Pyidaungsu", "Inter", sans-serif'>Default (Noto Sans MM)</option>
                            <option value='"Pyidaungsu", serif'>Pyidaungsu</option>
                            <option value='"Myanmar3", sans-serif'>Myanmar3</option>
                            <option value='sans-serif'>System Sans-Serif</option>
                            <option value='serif'>System Serif</option>
                          </optgroup>
                          {allAvailableFonts.length > 0 && (
                            <optgroup label={isMm ? '⭐ ထည့်သွင်းထားသော Font များ (Custom & Installed)' : '⭐ Custom & Installed Fonts'}>
                              {allAvailableFonts.map(f => (
                                <option key={f.id} value={`"${f.family}", sans-serif`}>{f.name}</option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[11px] text-slate-400 font-bold flex justify-between">
                            <span>Font Size</span>
                            <span className="text-amber-400 font-mono">{subFontSize}px</span>
                          </label>
                          <input
                            type="range"
                            min={16}
                            max={56}
                            value={subFontSize}
                            onChange={(e) => setSubFontSize(parseInt(e.target.value))}
                            className="w-full accent-amber-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer mt-1"
                          />
                        </div>

                        <div>
                          <label className="text-[11px] text-slate-400 font-bold flex justify-between">
                            <span>Position Y</span>
                            <span className="text-amber-400 font-mono">{subPositionY}%</span>
                          </label>
                          <input
                            type="range"
                            min={10}
                            max={95}
                            value={subPositionY}
                            onChange={(e) => setSubPositionY(parseInt(e.target.value))}
                            className="w-full accent-amber-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer mt-1"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[11px] text-slate-400 font-bold block mb-1">Text Color</label>
                          <div className="flex items-center gap-2 bg-black/40 p-1.5 rounded-xl border border-white/10">
                            <input
                              type="color"
                              value={subFontColor}
                              onChange={(e) => setSubFontColor(e.target.value)}
                              className="w-7 h-7 rounded border-0 bg-transparent cursor-pointer"
                            />
                            <span className="text-xs font-mono text-slate-300">{subFontColor}</span>
                          </div>
                        </div>

                        <div>
                          <label className="text-[11px] text-slate-400 font-bold block mb-1">Outline Stroke</label>
                          <div className="flex items-center gap-2 bg-black/40 p-1.5 rounded-xl border border-white/10">
                            <input
                              type="color"
                              value={subStrokeColor}
                              onChange={(e) => setSubStrokeColor(e.target.value)}
                              className="w-7 h-7 rounded border-0 bg-transparent cursor-pointer"
                            />
                            <input
                              type="range"
                              min={0}
                              max={8}
                              value={subStrokeWidth}
                              onChange={(e) => setSubStrokeWidth(parseInt(e.target.value))}
                              className="w-full accent-amber-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                            />
                            <span className="text-xs font-mono text-slate-300 w-6">{subStrokeWidth}p</span>
                          </div>
                        </div>
                      </div>

                      {/* Background Box */}
                      <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between">
                        <div>
                          <p className="text-xs font-bold text-white">{isMm ? 'စာတန်းထိုး နောက်ခံဘောင်' : 'Subtitle Background Box'}</p>
                          <p className="text-[10px] text-slate-400">{isMm ? 'စာဖတ်ရလွယ်စေရန် နောက်ခံမည်းထည့်မည်' : 'Contrast backing'}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {subBgBoxEnabled && (
                            <input
                              type="color"
                              value={subBgBoxColor.startsWith('#') ? subBgBoxColor : '#000000'}
                              onChange={(e) => setSubBgBoxColor(e.target.value)}
                              className="w-6 h-6 rounded border-0 bg-transparent cursor-pointer"
                            />
                          )}
                          <input
                            type="checkbox"
                            checked={subBgBoxEnabled}
                            onChange={(e) => setSubBgBoxEnabled(e.target.checked)}
                            className="w-5 h-5 accent-amber-400 cursor-pointer"
                          />
                        </div>
                      </div>

                      {/* Sync Offset */}
                      <div className="p-2.5 rounded-xl bg-black/40 border border-white/10 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-slate-300">{isMm ? 'အချိန်ကိုက် ညှိမှု (Sync Offset)' : 'Sync Offset'}</span>
                          <span className={`font-mono font-bold ${subTimingOffset === 0 ? 'text-slate-400' : 'text-amber-400'}`}>
                            {subTimingOffset > 0 ? `+${subTimingOffset.toFixed(1)}s` : `${subTimingOffset.toFixed(1)}s`}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          {[-1.0, -0.5, -0.1, 0.0, 0.1, 0.5, 1.0].map((v) => (
                            <button
                              key={v}
                              type="button"
                              onClick={() => setSubTimingOffset(v === 0 ? 0 : parseFloat((subTimingOffset + v).toFixed(2)))}
                              className={`flex-1 py-1 rounded text-[10px] font-mono font-bold border transition-all ${
                                v === 0
                                  ? 'bg-white/10 text-slate-300 border-white/10'
                                  : 'bg-white/5 hover:bg-white/15 text-slate-400 border-white/5'
                              }`}
                            >
                              {v === 0 ? '0' : v > 0 ? `+${v}` : v}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Subtitle Cue List with Search & Direct Inline Editing */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-300">
                      {isMm ? 'စာတန်းထိုး စာရင်း' : 'Subtitle Cues'} ({cues.length})
                    </span>
                    <div className="flex items-center gap-1.5">
                      {cues.length > 0 && (
                        <button
                          type="button"
                          onClick={handleAutoBalanceCues}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold transition-all shadow-sm active:scale-95"
                          title={isMm ? 'ရှည်လျားသော စာတန်းများကို ၂ ကြောင်းညီအောင် အလိုအလျောက် ခွဲညှိမည်' : 'Auto balance & wrap long lines into 2 lines'}
                        >
                          <WrapText size={11} />
                          <span>{isMm ? '၂ ကြောင်းခွဲညှိမည်' : 'Wrap 2-Lines'}</span>
                        </button>
                      )}
                      <span className="text-[10px] text-slate-500">
                        {isMm ? 'တည်းဖြတ်ရန် ✏️ နှိပ်ပါ' : 'Click ✏️ to edit'}
                      </span>
                    </div>
                  </div>

                  <input
                    type="text"
                    value={subTextSearch}
                    onChange={(e) => setSubTextSearch(e.target.value)}
                    placeholder={isMm ? 'စာသား ရှာဖွေရန်...' : 'Search subtitle text...'}
                    className="w-full bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                  />

                  <div className="max-h-72 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                    {filteredCues.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-white/10 rounded-xl space-y-2">
                        <p>{isMm ? 'စာတန်းထိုး မရှိသေးပါ' : 'No subtitle cues loaded.'}</p>
                        <button
                          type="button"
                          onClick={handleAddNewCue}
                          className="px-3 py-1.5 rounded-lg bg-amber-400/20 hover:bg-amber-400/30 text-amber-300 font-bold text-xs border border-amber-400/30 transition-all"
                        >
                          {isMm ? '+ ပထမဆုံး စာတန်းထိုး ထည့်မည်' : '+ Add First Cue'}
                        </button>
                      </div>
                    ) : (
                      filteredCues.map((cue) => {
                        const isCurrent = currentActiveCue?.id === cue.id;
                        const isEditingThis = editingCueId === cue.id;

                        if (isEditingThis) {
                          return (
                            <div
                              key={cue.id}
                              className="p-3 rounded-xl border border-amber-400 bg-amber-500/10 shadow-lg shadow-amber-500/10 space-y-2.5 transition-all"
                            >
                              <div className="flex items-center justify-between text-[11px] font-bold text-amber-300 pb-1 border-b border-amber-400/20">
                                <span>#{cue.index} {isMm ? 'ပြင်ဆင်နေသည်' : 'Editing Cue'}</span>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={handleSaveEditCue}
                                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-400 text-black font-extrabold text-[10px] hover:bg-amber-300 transition-all"
                                  >
                                    <Check size={11} className="stroke-[3]" />
                                    <span>{isMm ? 'ပြီးပါပြီ' : 'Save'}</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={handleCancelEditCue}
                                    className="p-1 rounded-lg bg-white/10 hover:bg-white/15 text-slate-300"
                                    title="Cancel"
                                  >
                                    <X size={12} />
                                  </button>
                                </div>
                              </div>

                              {/* Editable Text Area (Live Canvas Sync) */}
                              <div>
                                <label className="text-[10px] text-slate-400 font-bold block mb-1">
                                  {isMm ? 'စာတန်းထိုး စာသား (ရိုက်ထည့်ပါက Video တွင် တိုက်ရိုက်ပြပါမည်):' : 'Subtitle Text (Live synced):'}
                                </label>
                                <textarea
                                  rows={2}
                                  value={editCueDraftText}
                                  onChange={(e) => setEditCueDraftText(e.target.value)}
                                  className="w-full bg-black/80 border border-amber-400/50 rounded-lg p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-400 resize-none font-sans"
                                  placeholder="Type subtitle text..."
                                  autoFocus
                                />
                              </div>

                              {/* Editable Time Controls */}
                              <div className="grid grid-cols-2 gap-2 text-[11px]">
                                <div className="space-y-1 bg-black/40 p-2 rounded-lg border border-white/5">
                                  <span className="text-[10px] text-slate-400 block">{isMm ? 'အစချိန် (Start)' : 'Start'}</span>
                                  <div className="flex items-center justify-between font-mono font-bold text-white text-xs">
                                    <span>{secondsToSrtTime(editCueDraftStart)}</span>
                                  </div>
                                  <div className="flex items-center gap-1 pt-1">
                                    <button
                                      type="button"
                                      onClick={() => setEditCueDraftStart(prev => Math.max(0, parseFloat((prev - 0.2).toFixed(2))))}
                                      className="flex-1 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[10px] font-mono text-slate-200"
                                    >
                                      -0.2s
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditCueDraftStart(prev => parseFloat((prev + 0.2).toFixed(2)))}
                                      className="flex-1 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[10px] font-mono text-slate-200"
                                    >
                                      +0.2s
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditCueDraftStart(parseFloat(currentTime.toFixed(2)))}
                                      className="px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300 hover:bg-amber-400/30 text-[9px] font-bold"
                                      title="Set start to current playhead"
                                    >
                                      Now
                                    </button>
                                  </div>
                                </div>

                                <div className="space-y-1 bg-black/40 p-2 rounded-lg border border-white/5">
                                  <span className="text-[10px] text-slate-400 block">{isMm ? 'အဆုံးချိန် (End)' : 'End'}</span>
                                  <div className="flex items-center justify-between font-mono font-bold text-white text-xs">
                                    <span>{secondsToSrtTime(editCueDraftEnd)}</span>
                                  </div>
                                  <div className="flex items-center gap-1 pt-1">
                                    <button
                                      type="button"
                                      onClick={() => setEditCueDraftEnd(prev => Math.max(editCueDraftStart + 0.2, parseFloat((prev - 0.2).toFixed(2))))}
                                      className="flex-1 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[10px] font-mono text-slate-200"
                                    >
                                      -0.2s
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditCueDraftEnd(prev => parseFloat((prev + 0.2).toFixed(2)))}
                                      className="flex-1 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[10px] font-mono text-slate-200"
                                    >
                                      +0.2s
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditCueDraftEnd(parseFloat(currentTime.toFixed(2)))}
                                      className="px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300 hover:bg-amber-400/30 text-[9px] font-bold"
                                      title="Set end to current playhead"
                                    >
                                      Now
                                    </button>
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center justify-between pt-1">
                                <button
                                  type="button"
                                  onClick={(e) => handleDeleteCue(cue.id, e)}
                                  className="flex items-center gap-1 text-[11px] text-rose-400 hover:text-rose-300 hover:underline"
                                >
                                  <Trash2 size={12} />
                                  <span>{isMm ? 'စာတန်းထိုး ဖျက်မည်' : 'Delete Cue'}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={handleSaveEditCue}
                                  className="px-3 py-1 rounded-lg bg-amber-400 hover:bg-amber-300 text-black font-extrabold text-xs shadow-md shadow-amber-400/20"
                                >
                                  {isMm ? 'သိမ်းဆည်းမည် ✓' : 'Save Changes ✓'}
                                </button>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div
                            key={cue.id}
                            onClick={() => handleSeek(cue.startSeconds + 0.05)}
                            className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all group ${
                              isCurrent
                                ? 'bg-amber-400/15 border-amber-400/50 shadow-md shadow-amber-400/10'
                                : 'bg-black/40 border-white/5 hover:border-white/20'
                            }`}
                          >
                            <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono mb-1">
                              <span className="font-bold text-amber-400">#{cue.index}</span>
                              <span className="group-hover:text-slate-200 transition-colors">{cue.startStr} → {cue.endStr}</span>
                              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                <button
                                  type="button"
                                  onClick={() => handleStartEditCue(cue)}
                                  className="p-1 rounded bg-white/5 hover:bg-amber-400 hover:text-black text-slate-300 transition-colors"
                                  title="Edit subtitle text & timing"
                                >
                                  <Edit3 size={12} />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => handleDeleteCue(cue.id, e)}
                                  className="p-1 rounded bg-white/5 hover:bg-rose-500 hover:text-white text-slate-400 transition-colors"
                                  title="Delete subtitle cue"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>
                            <p className="text-white font-medium line-clamp-2 leading-relaxed">
                              {cue.text}
                            </p>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* FULL SRT MODAL EDITOR */}
            {isFullSrtModalOpen && (
              <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
                <div className="bg-slate-950 border border-white/20 rounded-2xl max-w-2xl w-full p-5 space-y-4 shadow-2xl">
                  <div className="flex items-center justify-between pb-2 border-b border-white/10">
                    <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                      <FileText size={18} />
                      <span>{isMm ? 'SRT စာတန်းထိုး အပြည့်အစုံ တည်းဖြတ်ခြင်း' : 'Full .SRT Text Editor'}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsFullSrtModalOpen(false)}
                      className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed">
                    {isMm
                      ? 'SRT ဖိုင်တစ်ခုလုံးကို စာသားအနေဖြင့် တိုက်ရိုက် ပြင်ဆင်နိုင်ပါသည်။ အမှားများကို ပြင်ဆင်ပြီးပါက "အတည်ပြုမည်" ကို နှိပ်ပါ။'
                      : 'Directly view and edit the raw .SRT script. Changes will immediately sync to all cues.'}
                  </p>

                  <textarea
                    rows={14}
                    value={fullSrtDraftText}
                    onChange={(e) => setFullSrtDraftText(e.target.value)}
                    className="w-full bg-black border border-white/15 rounded-xl p-3 text-xs font-mono text-emerald-300 focus:outline-none focus:border-amber-400 custom-scrollbar leading-relaxed resize-none"
                    placeholder="1&#10;00:00:00,000 --> 00:00:02,500&#10;Subtitles text here..."
                  />

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
                    <button
                      type="button"
                      onClick={() => setIsFullSrtModalOpen(false)}
                      className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-slate-300 text-xs font-bold"
                    >
                      {isMm ? 'မလုပ်တော့ပါ' : 'Cancel'}
                    </button>
                    <button
                      type="button"
                      onClick={handleApplyFullSrt}
                      className="px-5 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-black text-xs font-extrabold shadow-lg shadow-amber-400/20"
                    >
                      {isMm ? 'ပြင်ဆင်ချက်များ အတည်ပြုမည် ✓' : 'Save & Apply SRT ✓'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: MIRROR & FLIP (မှန်ရိပ်လှန်ခြင်း) */}
            {activeInspectorTab === 'mirror' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-white/10">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                      <FlipHorizontal size={14} />
                      <span>{isMm ? 'Mirror & Flip Studio (မှန်ရိပ် စတူဒီယို)' : 'Mirror & Flip Controls'}</span>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => applyMirrorMode('none')}
                    className="text-xs text-slate-400 hover:text-white transition-colors"
                  >
                    {isMm ? 'မူလအတိုင်းပြန်ထား' : 'Reset All'}
                  </button>
                </div>

                {/* Anti-Copyright Highlight Banner */}
                <div className="p-3 rounded-xl bg-gradient-to-r from-amber-500/10 via-yellow-500/10 to-amber-500/5 border border-amber-400/20 space-y-1">
                  <div className="flex items-center gap-2 text-xs font-bold text-amber-400">
                    <Sparkles size={14} />
                    <span>{isMm ? 'မူပိုင်ခွင့် (Copyright) လွတ်ကင်းစေရန် အကြံပြုချက်' : 'Anti-Copyright Best Practice'}</span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    {isMm
                      ? 'ဗီဒီယိုကို Flip Horizontal (ဘယ်/ညာ မှန်ရိပ်လှန်ခြင်း) ပြုလုပ်ခြင်းဖြင့် Facebook/YouTube Content ID မှ မူရင်းဗီဒီယိုဟု မသတ်မှတ်နိုင်တော့ဘဲ မူပိုင်ခွင့်ငြိစွန်းမှုမှ ကာကွယ်ပေးနိုင်ပါသည်။'
                      : 'Mirroring video horizontally completely alters frame pixel vectors, allowing creators to bypass automatic Content ID duplicate filters.'}
                  </p>
                </div>

                {/* 1-Click Mirror Presets */}
                <div>
                  <label className="text-[11px] text-slate-400 font-bold block mb-2">
                    {isMm ? '၁-ချက်နှိပ် အသင့်သုံး မှန်ရိပ်စတိုင်များ' : '1-Click Mirror Presets'}
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {([
                      { id: 'flip-h', label: '🪞 Flip H (ဘယ်/ညာ)', desc: 'Anti-Copyright', active: flipHorizontal && !flipVertical && mirrorEffect === 'none' },
                      { id: 'flip-v', label: '↕️ Flip V (အထက်/အောက်)', desc: 'Vertical Invert', active: !flipHorizontal && flipVertical && mirrorEffect === 'none' },
                      { id: 'flip-hv', label: '🔄 Dual Flip (H + V)', desc: '180° Inverted', active: flipHorizontal && flipVertical && mirrorEffect === 'none' },
                      { id: 'split-h', label: '👥 Split-H (အလယ်ခွဲ)', desc: 'Left/Right Mirror', active: mirrorEffect === 'split-h' },
                      { id: 'split-v', label: '⏳ Split-V (အထက်/အောက်)', desc: 'Top/Bottom Mirror', active: mirrorEffect === 'split-v' },
                      { id: 'quad', label: '💠 Quad 4X (၄ မျက်နှာ)', desc: 'Kaleidoscope', active: mirrorEffect === 'quad' }
                    ] as const satisfies readonly { id: MirrorPresetMode; label: string; desc: string; active: boolean }[]).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => applyMirrorMode(m.id)}
                        className={`p-2.5 rounded-xl border text-left transition-all ${
                          m.active
                            ? 'bg-amber-400/20 border-amber-400 text-white shadow-md shadow-amber-400/10'
                            : 'bg-black/40 border-white/10 hover:border-white/20 text-slate-300 hover:bg-white/5'
                        }`}
                      >
                        <p className="text-xs font-bold leading-tight">{m.label}</p>
                        <p className="text-[9px] text-slate-400 mt-0.5">{m.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Manual Toggles */}
                <div className="space-y-2 pt-1">
                  {/* Flip Horizontal Toggle */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-black/40 border border-white/10">
                    <div className="flex items-center gap-2.5">
                      <div className={`p-1.5 rounded-lg ${flipHorizontal ? 'bg-amber-400 text-black' : 'bg-white/5 text-slate-400'}`}>
                        <FlipHorizontal size={16} />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-white">
                          {isMm ? 'Flip Horizontal (ဘယ်/ညာ မှန်ရိပ်လှန်)' : 'Horizontal Flip (X-Axis)'}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {isMm ? 'ဗီဒီယို ဘယ်ဘက်နှင့် ညာဘက် ပြောင်းပြန်လှည့်မည်' : 'Mirrors left and right horizontally'}
                        </p>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={flipHorizontal}
                        onChange={(e) => {
                          setFlipHorizontal(e.target.checked);
                          if (e.target.checked && mirrorEffect !== 'none') setMirrorEffect('none');
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-400"></div>
                    </label>
                  </div>

                  {/* Flip Vertical Toggle */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-black/40 border border-white/10">
                    <div className="flex items-center gap-2.5">
                      <div className={`p-1.5 rounded-lg ${flipVertical ? 'bg-amber-400 text-black' : 'bg-white/5 text-slate-400'}`}>
                        <FlipVertical size={16} />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-white">
                          {isMm ? 'Flip Vertical (အထက်/အောက် မှန်ရိပ်လှန်)' : 'Vertical Flip (Y-Axis)'}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {isMm ? 'ဗီဒီယို အထက်နှင့် အောက် ပြောင်းပြန်လှည့်မည်' : 'Inverts top and bottom vertically'}
                        </p>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={flipVertical}
                        onChange={(e) => {
                          setFlipVertical(e.target.checked);
                          if (e.target.checked && mirrorEffect !== 'none') setMirrorEffect('none');
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-400"></div>
                    </label>
                  </div>
                </div>

                {/* Rotation & Angle Skew */}
                <div className="p-3.5 rounded-xl bg-white/5 border border-white/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200">
                      {isMm ? 'ဗီဒီယို လှည့်ခြင်း (Rotation)' : 'Video Rotation'}
                    </span>
                    <span className="text-xs font-mono font-bold text-amber-400">
                      {rotationDegrees}°
                    </span>
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    {[0, 90, 180, 270].map((deg) => (
                      <button
                        key={deg}
                        type="button"
                        onClick={() => setRotationDegrees(deg)}
                        className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
                          rotationDegrees === deg
                            ? 'bg-amber-400 text-black shadow-sm'
                            : 'bg-black/40 text-slate-300 hover:bg-black/60 border border-white/10'
                        }`}
                      >
                        {deg}°
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleRotateVideo(-90)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-black/40 hover:bg-black/60 border border-white/10 text-xs font-bold text-slate-300 transition-all active:scale-95"
                    >
                      <RotateCcw size={14} />
                      <span>-90° Spin</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRotateVideo(90)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-black/40 hover:bg-black/60 border border-white/10 text-xs font-bold text-slate-300 transition-all active:scale-95"
                    >
                      <RotateCw size={14} />
                      <span>+90° Spin</span>
                    </button>
                  </div>
                </div>

                {/* Micro Angle Skew & Micro Zoom */}
                <div className="p-3.5 rounded-xl bg-black/40 border border-white/10 space-y-3">
                  <div>
                    <label className="text-[11px] text-slate-400 font-bold flex justify-between">
                      <span>{isMm ? 'ထောင့်စောင်း အနုစိတ် ချိန်ညှိမှု (Micro Tilt)' : 'Micro Tilt Angle'}</span>
                      <span className="text-amber-400 font-mono">{microRotation > 0 ? `+${microRotation}°` : `${microRotation}°`}</span>
                    </label>
                    <input
                      type="range"
                      min={-10}
                      max={10}
                      step={0.5}
                      value={microRotation}
                      onChange={(e) => setMicroRotation(parseFloat(e.target.value))}
                      className="w-full accent-amber-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer mt-1"
                    />
                    <div className="flex justify-between text-[9px] text-slate-500 mt-0.5">
                      <span>-10°</span>
                      <span onClick={() => setMicroRotation(0)} className="cursor-pointer hover:text-amber-400">0° Reset</span>
                      <span>+10°</span>
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-400 font-bold flex justify-between">
                      <span>{isMm ? 'အနုစိတ် ချဲ့ထွင်မှု (Micro Zoom)' : 'Micro Zoom'}</span>
                      <span className="text-amber-400 font-mono">{microZoom.toFixed(2)}x</span>
                    </label>
                    <input
                      type="range"
                      min={1.0}
                      max={1.3}
                      step={0.01}
                      value={microZoom}
                      onChange={(e) => setMicroZoom(parseFloat(e.target.value))}
                      className="w-full accent-amber-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer mt-1"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: COLOR */}
            {activeInspectorTab === 'color' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-white/10">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-slate-300">
                    {isMm ? 'Color Grading & Looks' : 'Color Grading'}
                  </span>
                  <button
                    type="button"
                    onClick={() => applyColorPreset('reset')}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    Reset
                  </button>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 font-bold block mb-2">1-Click Look Presets</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'cinematic', label: '🎬 Cinematic' },
                      { id: 'vibrant', label: '✨ Vibrant Pop' },
                      { id: 'golden', label: '🌅 Golden Hour' },
                      { id: 'noir', label: '🖤 B&W Noir' },
                      { id: 'cyberpunk', label: '⚡ Cyberpunk' },
                      { id: 'vintage', label: '📼 90s Retro' }
                    ].map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => applyColorPreset(p.id)}
                        className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-bold text-center transition-all active:scale-95"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3 pt-2">
                  <div>
                    <label className="text-[11px] text-slate-400 font-bold flex justify-between">
                      <span>Brightness (တောက်ပမှု)</span>
                      <span className="text-amber-400 font-mono">{brightness}%</span>
                    </label>
                    <input
                      type="range"
                      min={50}
                      max={180}
                      value={brightness}
                      onChange={(e) => setBrightness(parseInt(e.target.value))}
                      className="w-full accent-amber-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer mt-1"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-400 font-bold flex justify-between">
                      <span>Contrast (အလင်းအမှောင် ကွဲပြားမှု)</span>
                      <span className="text-amber-400 font-mono">{contrast}%</span>
                    </label>
                    <input
                      type="range"
                      min={50}
                      max={180}
                      value={contrast}
                      onChange={(e) => setContrast(parseInt(e.target.value))}
                      className="w-full accent-amber-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer mt-1"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-400 font-bold flex justify-between">
                      <span>Saturation (အရောင်စိုပြေမှု)</span>
                      <span className="text-amber-400 font-mono">{saturation}%</span>
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={220}
                      value={saturation}
                      onChange={(e) => setSaturation(parseInt(e.target.value))}
                      className="w-full accent-amber-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer mt-1"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-400 font-bold flex justify-between">
                      <span>Hue Rotation (အရောင် ကာလာလှည့်ခြင်း)</span>
                      <span className="text-amber-400 font-mono">{hueRotate}°</span>
                    </label>
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      value={hueRotate}
                      onChange={(e) => setHueRotate(parseInt(e.target.value))}
                      className="w-full accent-amber-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer mt-1"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-400 font-bold flex justify-between">
                      <span>Vignette (ရုပ်ရှင်ဟန် အနားသတ်အမည်း)</span>
                      <span className="text-amber-400 font-mono">{vignette}%</span>
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={vignette}
                      onChange={(e) => setVignette(parseInt(e.target.value))}
                      className="w-full accent-amber-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer mt-1"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: RATIO */}
            {activeInspectorTab === 'ratio' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-white/10">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-slate-300">
                    {isMm ? 'Canvas Aspect Ratio & Framing' : 'Aspect Ratio & Framing'}
                  </span>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 font-bold block mb-2">Target Ratio</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: '16:9', title: '16:9 Landscape', desc: 'YouTube / Facebook' },
                      { id: '9:16', title: '9:16 Vertical', desc: 'TikTok / Shorts / Reels' },
                      { id: '1:1', title: '1:1 Square', desc: 'Instagram Feed' },
                      { id: '4:5', title: '4:5 Portrait', desc: 'Social Media Post' },
                      { id: '4:3', title: '4:3 Standard', desc: 'Classic Retro TV' },
                      { id: '21:9', title: '21:9 Cinema', desc: 'Ultrawide Movie' }
                    ].map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setAspectRatio(item.id as AspectRatioType)}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          aspectRatio === item.id
                            ? 'bg-amber-400/15 border-amber-400 text-white shadow-md shadow-amber-400/10'
                            : 'bg-black/40 border-white/10 hover:border-white/20 text-slate-300'
                        }`}
                      >
                        <p className="text-xs font-bold">{item.title}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">{item.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <label className="text-[11px] text-slate-400 font-bold block">Framing & Background Style</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'blurred-fit', label: 'Blurred BG', desc: 'Viral Shorts style' },
                      { id: 'letterbox', label: 'Black Bars', desc: 'Clean padding' },
                      { id: 'cover', label: 'Crop to Fill', desc: 'No borders' }
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setFramingMode(f.id as FramingMode)}
                        className={`p-2.5 rounded-xl border text-center transition-all ${
                          framingMode === f.id
                            ? 'bg-amber-400 text-black font-extrabold shadow-md shadow-amber-400/20'
                            : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                        }`}
                      >
                        <p className="text-xs">{f.label}</p>
                        <p className="text-[9px] opacity-75">{f.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {framingMode === 'blurred-fit' && (
                  <div>
                    <label className="text-[11px] text-slate-400 font-bold flex justify-between">
                      <span>Background Blur Amount</span>
                      <span className="text-amber-400 font-mono">{blurAmount}px</span>
                    </label>
                    <input
                      type="range"
                      min={5}
                      max={45}
                      value={blurAmount}
                      onChange={(e) => setBlurAmount(parseInt(e.target.value))}
                      className="w-full accent-amber-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer mt-1"
                    />
                  </div>
                )}

                {framingMode === 'letterbox' && (
                  <div className="flex items-center justify-between p-3 rounded-xl bg-black/40 border border-white/10">
                    <span className="text-xs text-slate-300 font-bold">Letterbox Padding Color:</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={customBgColor}
                        onChange={(e) => setCustomBgColor(e.target.value)}
                        className="w-7 h-7 rounded border-0 bg-transparent cursor-pointer"
                      />
                      <span className="text-xs font-mono text-slate-300">{customBgColor}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: ANTI-COPYRIGHT */}
            {activeInspectorTab === 'anticopyright' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-white/10">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                    <ShieldAlert size={14} />
                    <span>{isMm ? 'Anti-Copyright Protection Engine' : 'Anti-Copyright Tools'}</span>
                  </span>
                  <button
                    type="button"
                    onClick={applyAntiCopyrightPreset}
                    className="text-xs text-amber-400 hover:underline font-bold"
                  >
                    {isMm ? 'အားလုံးဖွင့်ရန်' : 'Enable All'}
                  </button>
                </div>

                <p className="text-[11px] text-slate-400 leading-relaxed bg-amber-400/5 p-3 rounded-xl border border-amber-400/20">
                  {isMm
                    ? 'YouTube, Facebook, TikTok စသည့် စနစ်များတွင် Content ID မမိစေရန် ဗီဒီယိုနှင့် အသံ ဖိုင် hash algorithm ကို ပြောင်းလဲပေးသည့် အဆင့်မြင့် tools များဖြစ်ပါသည်။'
                    : 'Modifies video geometry and audio frequency hashes to evade Content ID automated matching without ruining viewer experience.'}
                </p>

                <div className="flex items-center justify-between p-3 rounded-xl bg-black/40 border border-white/10">
                  <div className="flex items-center gap-2.5">
                    <FlipHorizontal size={18} className="text-amber-400" />
                    <div>
                      <p className="text-xs font-bold text-white">{isMm ? 'ဗီဒီယို ဘယ်/ညာ ပြောင်းပြန်လှည့် (Flip X)' : 'Horizontal Mirror Flip'}</p>
                      <p className="text-[10px] text-slate-400">{isMm ? 'Content ID မမိစေရန် အထိရောက်ဆုံး နည်းလမ်း' : 'Mirrors frames horizontally'}</p>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={flipHorizontal}
                    onChange={(e) => setFlipHorizontal(e.target.checked)}
                    className="w-5 h-5 accent-amber-400 cursor-pointer"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 font-bold flex justify-between">
                    <span>Micro-Zoom (အတွင်းသို့ အနည်းငယ် ချဲ့ခြင်း)</span>
                    <span className="text-amber-400 font-mono">{microZoom.toFixed(2)}x</span>
                  </label>
                  <input
                    type="range"
                    min={1.0}
                    max={1.25}
                    step={0.01}
                    value={microZoom}
                    onChange={(e) => setMicroZoom(parseFloat(e.target.value))}
                    className="w-full accent-amber-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer mt-1"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Crops original edges and watermarks (1.05x - 1.10x recommended)</p>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 font-bold flex justify-between">
                    <span>Micro-Rotation Tilt (ထောင့်စောင်း အနည်းငယ်စောင်း)</span>
                    <span className="text-amber-400 font-mono">{microRotation}°</span>
                  </label>
                  <input
                    type="range"
                    min={-4}
                    max={4}
                    step={0.5}
                    value={microRotation}
                    onChange={(e) => setMicroRotation(parseFloat(e.target.value))}
                    className="w-full accent-amber-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer mt-1"
                  />
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl bg-black/40 border border-white/10">
                  <div>
                    <p className="text-xs font-bold text-white">{isMm ? 'Anti-Audio Fingerprint Mask' : 'Audio Hash Mask (Inaudible Noise)'}</p>
                    <p className="text-[10px] text-slate-400">{isMm ? 'လူမကြားနိုင်သော အလွန်တိုးသော noise ထည့်၍ audio hash ဖျက်ခြင်း' : 'Injects imperceptible noise layer to break Shazam & Content ID'}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={antiHashMaskNoise}
                    onChange={(e) => setAntiHashMaskNoise(e.target.checked)}
                    className="w-5 h-5 accent-amber-400 cursor-pointer"
                  />
                </div>

                <div className="p-3 rounded-xl bg-black/40 border border-white/10 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-white">{isMm ? 'Anti-Perception Border Frame' : 'Framing Border'}</p>
                      <p className="text-[10px] text-slate-400">{isMm ? 'ဗီဒီယို ဘေးဘောင် အနားသတ် ထည့်သွင်းခြင်း' : 'Adds border to break video perimeter matching'}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={antiCopyrightBorder}
                      onChange={(e) => setAntiCopyrightBorder(e.target.checked)}
                      className="w-5 h-5 accent-amber-400 cursor-pointer"
                    />
                  </div>
                  {antiCopyrightBorder && (
                    <div className="flex items-center justify-between pt-2 border-t border-white/10">
                      <span className="text-xs text-slate-400">Border Color:</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={borderColor}
                          onChange={(e) => setBorderColor(e.target.value)}
                          className="w-6 h-6 rounded border-0 bg-transparent cursor-pointer"
                        />
                        <span className="text-xs font-mono text-slate-300">{borderColor}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Watermark Branding Section */}
                <div className="p-3 rounded-xl bg-black/40 border border-white/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-white">{isMm ? 'Watermark / စာသား လိုဂို' : 'Watermark Branding'}</p>
                      <p className="text-[10px] text-slate-400">{isMm ? 'ချန်နယ်အမည် သို့မဟုတ် လိုဂိုစာသား ထည့်သွင်းမည်' : 'Channel handle or text watermark'}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={watermarkEnabled}
                      onChange={(e) => setWatermarkEnabled(e.target.checked)}
                      className="w-5 h-5 accent-amber-400 cursor-pointer"
                    />
                  </div>

                  {watermarkEnabled && (
                    <div className="space-y-2 pt-2 border-t border-white/10">
                      <input
                        type="text"
                        value={watermarkText}
                        onChange={(e) => setWatermarkText(e.target.value)}
                        placeholder="e.g. @VlogsBySaw"
                        className="w-full bg-black/60 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-400"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-slate-400 flex justify-between">
                            <span>Opacity</span>
                            <span className="text-amber-400">{watermarkOpacity}%</span>
                          </label>
                          <input
                            type="range"
                            min={10}
                            max={100}
                            value={watermarkOpacity}
                            onChange={(e) => setWatermarkOpacity(parseInt(e.target.value))}
                            className="w-full accent-amber-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-400 flex justify-between">
                            <span>Font Size</span>
                            <span className="text-amber-400">{watermarkFontSize}px</span>
                          </label>
                          <input
                            type="range"
                            min={12}
                            max={36}
                            value={watermarkFontSize}
                            onChange={(e) => setWatermarkFontSize(parseInt(e.target.value))}
                            className="w-full accent-amber-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 pt-1">
                        <span className="text-[10px] text-slate-400">Position:</span>
                        {(['top-right', 'top-left', 'bottom-right', 'bottom-left'] as const).map(pos => (
                          <button
                            key={pos}
                            type="button"
                            onClick={() => setWatermarkPosition(pos)}
                            className={`px-2 py-0.5 rounded text-[9px] font-bold ${watermarkPosition === pos ? 'bg-amber-400 text-black' : 'bg-white/5 text-slate-400'}`}
                          >
                            {pos.replace('-', ' ')}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 5: AUDIO EDITING */}
            {activeInspectorTab === 'audio' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-white/10">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-slate-300">
                    {isMm ? 'အသံပိုင်းဆိုင်ရာ ပြင်ဆင်ချက်များ' : 'Audio Editing & Mixing'}
                  </span>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 font-bold flex justify-between">
                    <span>Micro-Tempo Speed (အမြန်နှုန်း အနည်းငယ် ချိန်ခြင်း)</span>
                    <span className="text-amber-400 font-mono">{microSpeedModulation.toFixed(2)}x</span>
                  </label>
                  <input
                    type="range"
                    min={0.96}
                    max={1.06}
                    step={0.01}
                    value={microSpeedModulation}
                    onChange={(e) => setMicroSpeedModulation(parseFloat(e.target.value))}
                    className="w-full accent-amber-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer mt-1"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">1.03x speed safely bypasses automated audio fingerprinting</p>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 font-bold flex justify-between">
                    <span>Original Video Volume (မူရင်းအသံ ကျယ်/တိုး)</span>
                    <span className="text-amber-400 font-mono">{originalAudioVolume}%</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={150}
                    value={originalAudioVolume}
                    onChange={(e) => setOriginalAudioVolume(parseInt(e.target.value))}
                    className="w-full accent-amber-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer mt-1"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 font-bold flex justify-between">
                    <span>Pitch Modulation (အသံ အနိမ့်အမြင့် ကွဲပြားအောင် ပြောင်းခြင်း)</span>
                    <span className="text-amber-400 font-mono">
                      {pitchShiftSemitones > 0 ? `+${pitchShiftSemitones}` : pitchShiftSemitones} st
                    </span>
                  </label>
                  <div className="flex items-center gap-2 mt-1">
                    {[-2, -1, 0, 1, 2].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setPitchShiftSemitones(s)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold font-mono border transition-all ${
                          pitchShiftSemitones === s
                            ? 'bg-amber-400 text-black border-amber-400'
                            : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
                        }`}
                      >
                        {s === 0 ? 'Normal' : s > 0 ? `+${s}` : s}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-slate-400 font-bold flex justify-between">
                      <span>Bass Boost EQ</span>
                      <span className="text-amber-400 font-mono">{bassBoostDb > 0 ? `+${bassBoostDb}` : bassBoostDb} dB</span>
                    </label>
                    <input
                      type="range"
                      min={-6}
                      max={6}
                      value={bassBoostDb}
                      onChange={(e) => setBassBoostDb(parseInt(e.target.value))}
                      className="w-full accent-amber-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer mt-1"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-400 font-bold flex justify-between">
                      <span>Treble Boost EQ</span>
                      <span className="text-amber-400 font-mono">{trebleBoostDb > 0 ? `+${trebleBoostDb}` : trebleBoostDb} dB</span>
                    </label>
                    <input
                      type="range"
                      min={-6}
                      max={6}
                      value={trebleBoostDb}
                      onChange={(e) => setTrebleBoostDb(parseInt(e.target.value))}
                      className="w-full accent-amber-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer mt-1"
                    />
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-black/40 border border-white/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-2">
                      <Music size={14} className="text-purple-400" />
                      {isMm ? 'AI အသံသွင်းဖိုင် ရောစပ်ခြင်း (Voiceover / TTS)' : 'AI Voiceover Audio Mix'}
                    </span>
                    {voiceoverAudioUrl && (
                      <span className="text-[10px] text-emerald-400 font-bold">Active</span>
                    )}
                  </div>

                  {voiceoverAudioUrl ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-300">
                        <span className="truncate max-w-[200px]">TTS Narration Track Loaded</span>
                        <button
                          type="button"
                          onClick={() => setVoiceoverAudioUrl(null)}
                          className="text-rose-400 hover:underline text-[11px]"
                        >
                          Remove
                        </button>
                      </div>
                      <div>
                        <label className="text-[11px] text-slate-400 flex justify-between">
                          <span>Voiceover Volume</span>
                          <span className="text-purple-400 font-mono">{voiceoverVolume}%</span>
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={150}
                          value={voiceoverVolume}
                          onChange={(e) => setVoiceoverVolume(parseInt(e.target.value))}
                          className="w-full accent-purple-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer mt-1"
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="text-[11px] text-slate-400 mb-2">
                        {isMm
                          ? 'Studio တက်ဘ်တွင် AI အသံဖန်တီးထားပါက သို့မဟုတ် MP3/WAV ဖိုင် တင်သွင်းပါက ဤဗီဒီယိုနှင့် ပေါင်းစပ်နိုင်ပါသည်။'
                          : 'Load voiceover audio generated in the Studio tab or upload custom MP3/WAV'}
                      </p>
                      <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 text-xs font-bold border border-purple-500/30 cursor-pointer">
                        <Upload size={12} />
                        <span>Upload Audio File</span>
                        <input
                          type="file"
                          accept="audio/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              setVoiceoverAudioUrl(URL.createObjectURL(file));
                              showToast('Loaded custom voiceover audio', 'success');
                            }
                          }}
                          className="hidden"
                        />
                      </label>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 6: TRIM */}
            {activeInspectorTab === 'trim' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-white/10">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-slate-300">
                    {isMm ? 'Trim & Cut Segment' : 'Trimming & Segment'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setTrimStart(0);
                      setTrimEnd(videoDuration);
                    }}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    Reset
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-black/40 border border-white/10 space-y-2">
                    <span className="text-[11px] text-slate-400 font-bold block">Start Time (အစ)</span>
                    <p className="text-sm font-mono font-bold text-amber-400">{formatTime(trimStart)}</p>
                    <button
                      type="button"
                      onClick={() => setTrimStart(currentTime)}
                      className="w-full py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-bold transition-all"
                    >
                      {isMm ? 'လက်ရှိနေရာကို အစထား' : 'Set to Playhead [ { ]'}
                    </button>
                  </div>

                  <div className="p-3 rounded-xl bg-black/40 border border-white/10 space-y-2">
                    <span className="text-[11px] text-slate-400 font-bold block">End Time (အဆုံး)</span>
                    <p className="text-sm font-mono font-bold text-amber-400">{formatTime(trimEnd)}</p>
                    <button
                      type="button"
                      onClick={() => setTrimEnd(currentTime)}
                      className="w-full py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-bold transition-all"
                    >
                      {isMm ? 'လက်ရှိနေရာကို အဆုံးထား' : 'Set to Playhead [ } ]'}
                    </button>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-slate-400">Export Segment Duration:</span>
                    <p className="text-sm font-mono font-bold text-white mt-0.5">
                      {formatTime(Math.max(0, trimEnd - trimStart))}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      handleSeek(trimStart);
                      const video = videoRef.current;
                      if (video) video.play();
                    }}
                    className="px-3 py-1.5 rounded-lg bg-amber-400 text-black text-xs font-bold"
                  >
                    Preview Segment
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Local PC / VPS Worker Setup Modal */}
      {isWorkerModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
          <div className="relative w-full max-w-4xl bg-slate-950 border border-white/15 rounded-[32px] p-5 sm:p-7 shadow-2xl space-y-6 my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-amber-400/20 text-amber-300 border border-amber-400/30">
                  <Laptop size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">
                    {isMm ? 'Local PC / VPS Dedicated FFmpeg Worker' : 'Local PC / VPS FFmpeg Worker'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {isMm ? 'သင့် Computer တွင် တင်ရန် One-Click Runner ဖိုင်များနှင့် အချိန်နှင့်တပြေးညီ အခြေအနေ' : '1-Click runner files and real-time connection status'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsWorkerModalOpen(false)}
                className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <FfmpegWorkerManager onToast={(msg, type) => showToast(msg, type)} />
          </div>
        </div>
      )}

      {/* User Custom Font Modal */}
      {isFontModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
          <div className="relative w-full max-w-xl bg-slate-950 border border-white/15 rounded-[32px] p-5 sm:p-7 shadow-2xl space-y-6 my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-amber-400/20 text-amber-300 border border-amber-400/30">
                  <Type size={22} />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">
                    {isMm ? 'မိမိစိတ်ကြိုက် Font ထည့်သွင်းခြင်း' : 'Add Custom Subtitle Font'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {isMm ? 'သင့်ကွန်ပျူတာ သို့မဟုတ် ဖုန်းမှ Font ဖိုင် (.ttf / .otf / .woff) တင်၍ အသုံးပြုနိုင်ပါသည်' : 'Upload font file (.ttf / .otf / .woff) or enter Google Font URL'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsFontModalOpen(false)}
                className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Tabs */}
            <div className="flex p-1 bg-white/5 rounded-xl border border-white/10">
              <button
                type="button"
                onClick={() => setFontModalTab('file')}
                className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                  fontModalTab === 'file'
                    ? 'bg-amber-400 text-black shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                📁 {isMm ? 'Font ဖိုင် တင်မည် (.ttf / .otf)' : 'Upload Font File'}
              </button>
              <button
                type="button"
                onClick={() => setFontModalTab('url')}
                className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                  fontModalTab === 'url'
                    ? 'bg-amber-400 text-black shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                🌐 {isMm ? 'Web / Google Font URL' : 'Google / Web Font URL'}
              </button>
            </div>

            <form onSubmit={handleAddUserFont} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  {isMm ? 'Font အမည် (Font Name / Family)' : 'Font Name'}
                </label>
                <input
                  type="text"
                  value={newFontName}
                  onChange={(e) => setNewFontName(e.target.value)}
                  placeholder={isMm ? 'ဥပမာ: Walone, Masterpiece, Zawgyi' : 'e.g. My Custom Font, Walone'}
                  className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                  required
                />
              </div>

              {fontModalTab === 'file' ? (
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                    {isMm ? 'Font ဖိုင် ရွေးချယ်ပါ (.ttf, .otf, .woff, .woff2)' : 'Select Font File'}
                  </label>
                  <label className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-white/20 hover:border-amber-400/60 rounded-2xl cursor-pointer bg-white/[0.02] hover:bg-white/[0.05] transition-all">
                    <Upload size={24} className="text-amber-400 mb-2" />
                    <span className="text-xs font-bold text-white">
                      {newFontFile ? newFontFile.name : (isMm ? 'Font ဖိုင် ရွေးချယ်ရန် နှိပ်ပါ' : 'Click to select font file')}
                    </span>
                    <span className="text-[10px] text-slate-400 mt-1">
                      .ttf, .otf, .woff, .woff2 formats supported
                    </span>
                    <input
                      type="file"
                      accept=".ttf,.otf,.woff,.woff2"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setNewFontFile(file);
                          if (!newFontName.trim()) {
                            const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
                            setNewFontName(cleanName);
                          }
                        }
                      }}
                    />
                  </label>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                      {isMm ? 'Web Font URL / Google Font link' : 'Font URL'}
                    </label>
                    <input
                      type="url"
                      value={newFontUrl}
                      onChange={(e) => setNewFontUrl(e.target.value)}
                      placeholder="https://fonts.googleapis.com/css2?family=Padauk&display=swap"
                      className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                      required={fontModalTab === 'url'}
                    />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={isFontGoogle}
                      onChange={(e) => setIsFontGoogle(e.target.checked)}
                      className="rounded accent-amber-400"
                    />
                    <span>{isMm ? 'Google Fonts link ဖြစ်ပါသည်' : 'This is a Google Fonts link'}</span>
                  </label>
                </div>
              )}

              {/* Real-time Preview */}
              {newFontName.trim() && (
                <div className="p-3.5 rounded-xl bg-black/60 border border-white/10 space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">
                    {isMm ? 'စာလုံးနမူနာ Preview' : 'Sample Preview'}:
                  </span>
                  <p
                    className="text-base text-amber-300 py-1"
                    style={{ fontFamily: `"${newFontName.trim()}", sans-serif` }}
                  >
                    ၁၂၃ မင်္ဂလာပါ မြန်မာစာတန်းထိုး နမူနာ (The quick brown fox)
                  </p>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsFontModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold transition-colors"
                >
                  {isMm ? 'ပိတ်မည်' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={isAddingFont}
                  className="px-5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-black text-xs font-extrabold shadow-md shadow-amber-400/20 transition-all flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
                >
                  {isAddingFont ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
                  <span>{isMm ? 'Font ထည့်ပြီး အသုံးပြုမည်' : 'Save & Apply Font'}</span>
                </button>
              </div>
            </form>

            {/* List of User's Installed Fonts */}
            {userCustomFonts.length > 0 && (
              <div className="pt-4 border-t border-white/10 space-y-2.5">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  {isMm ? `သင်ထည့်သွင်းထားသော Font များ (${userCustomFonts.length})` : `My Installed Fonts (${userCustomFonts.length})`}
                </span>
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {userCustomFonts.map((f) => (
                    <div
                      key={f.id}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white truncate" style={{ fontFamily: `"${f.family}", sans-serif` }}>
                          {f.name}
                        </p>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {f.isGoogleFont ? 'Google Font' : 'Custom Font'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setSubFontFamily(`"${f.family}", sans-serif`);
                            setIsFontModalOpen(false);
                            showToast(isMm ? `Font "${f.name}" ကို ရွေးချယ်ပြီးပါပြီ` : `Applied "${f.name}"`, 'success');
                          }}
                          className="px-2.5 py-1 rounded-lg bg-amber-400/20 hover:bg-amber-400/30 text-amber-300 text-[10px] font-bold transition-colors"
                        >
                          {isMm ? 'အသုံးပြုမည်' : 'Use'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteUserFont(f.id, f.name)}
                          className="p-1.5 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors"
                          title="Delete font"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
