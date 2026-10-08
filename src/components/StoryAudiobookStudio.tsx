import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  BookOpen,
  Headphones,
  Music,
  Sparkles,
  Download,
  Play,
  Pause,
  RotateCcw,
  Volume2,
  Plus,
  Trash2,
  Copy,
  Check,
  Wand2,
  Image as ImageIcon,
  Layers,
  FileText,
  Sliders,
  ChevronRight,
  RefreshCw,
  Mic,
  AlignLeft,
  Bookmark,
  ShieldCheck,
  Upload,
  Disc
} from 'lucide-react';
import { GeminiTTSService } from '../services/geminiService';
import { ambienceSynthesizer, AMBIENCE_TRACKS, AmbienceType } from '../utils/ambienceSynthesizer';
import { useLanguage } from '../contexts/LanguageContext';
import { AudioResult, VBSUserControl, TTSConfig, ModalConfig, CustomFont } from '../types';
import { formatMyanmarDuration } from '../utils/audioUtils';
import { generateSRT, downloadSrtFile } from '../utils/subtitleUtils';
import { GEMINI_MODELS } from '../constants';

interface StoryAudiobookStudioProps {
  showToast: (message: string, type: 'success' | 'error') => void;
  openModal: (config: ModalConfig) => void;
  getApiKey: () => string | null;
  isAdmin: boolean;
  isPremium: boolean;
  userControl?: VBSUserControl | null;
  onNavigateToSettings?: () => void;
  onProcessingStateChange?: (isProcessing: boolean) => void;
  customFonts?: CustomFont[];
}

interface Chapter {
  id: string;
  number: number;
  title: string;
  content: string;
  audioResult?: AudioResult | null;
  voiceId: string;
  speed: number;
  pitch: number;
  ambience: AmbienceType;
  lastUpdated: number;
}

interface StoryProject {
  title: string;
  author: string;
  genre: 'horror' | 'fantasy' | 'romance' | 'mystery' | 'dhamma' | 'kids' | 'drama';
  synopsis: string;
  chapters: Chapter[];
  activeChapterId: string;
}

const STORY_GENRES = [
  { id: 'horror', labelMm: 'သရဲ / သည်းထိတ်ရင်ဖို', labelEn: 'Horror & Suspense', emoji: '👻', bgHint: 'dark haunted night, ancient mist, mysterious shadowy mansion', promptSuffix: 'dark cinematic mood, ominous shadows' },
  { id: 'fantasy', labelMm: 'စိတ်ကူးယဉ် / ဒဏ္ဍာရီ', labelEn: 'Fantasy & Myth', emoji: '🏰', bgHint: 'ancient mythical pagoda, magical glowing clouds, dragon sky', promptSuffix: 'epic fantasy art, ethereal golden light' },
  { id: 'romance', labelMm: 'အချစ် / ရသစုံ', labelEn: 'Romance & Drama', emoji: '🌸', bgHint: 'romantic golden hour sunset, ancient Bagan temples, nostalgic river', promptSuffix: 'warm cinematic lighting, emotive ambiance' },
  { id: 'mystery', labelMm: 'စုံထောက် / လျှို့ဝှက်ဆန်းကြယ်', labelEn: 'Mystery & Thriller', emoji: '🕵️', bgHint: 'foggy colonial street at midnight, dim streetlamps, detective aesthetic', promptSuffix: 'film noir style, high contrast shadows' },
  { id: 'dhamma', labelMm: 'တရားတော်နှင့် အတွေးအမြင်', labelEn: 'Dhamma & Reflection', emoji: '🧘', bgHint: 'peaceful forest monastery, serene Buddha silhouette, golden morning rays', promptSuffix: 'sacred peaceful serenity, morning mist' },
  { id: 'kids', labelMm: 'ပုံပြင် / ညအိပ်ရာဝင်', labelEn: 'Folk Tale & Bedtime', emoji: '🌙', bgHint: 'whimsical storybook landscape, glowing moon, cute magical forest', promptSuffix: 'soft watercolor storybook style, dreamy warmth' },
  { id: 'drama', labelMm: 'ဘဝသရုပ်ဖော် / ရသစာပေ', labelEn: 'Literary & Drama', emoji: '📖', bgHint: 'vintage library, rustic wooden desk with candles, rainy window', promptSuffix: 'aesthetic cozy cinematic atmosphere' },
];

const STORY_VOICES = [
  { id: 'kore', name: 'Kore', gender: 'Male (အမျိုးသား)', descMm: 'ခိုင်မာလေးနက်သော ဇာတ်ကြောင်းပြောသူ', descEn: 'Authoritative, engaging narrator' },
  { id: 'fenrir', name: 'Fenrir', gender: 'Male (အမျိုးသား)', descMm: 'နက်နဲဆန်းကြယ်သော ရုပ်ရှင်ဆန်ဆန်အသံ', descEn: 'Deep, cinematic, thrilling mystery voice' },
  { id: 'aoede', name: 'Aoede', gender: 'Female (အမျိုးသမီး)', descMm: 'ကြည်လင်ချိုသာသော ပုံပြင်ပြောဟန်', descEn: 'Clear, melodious, warm storyteller' },
  { id: 'puck', name: 'Puck', gender: 'Male (အမျိုးသား)', descMm: 'သွက်လက်ရွှင်လန်းသော ဇာတ်ကောင်အသံ', descEn: 'Lively, expressive character narration' },
  { id: 'charon', name: 'Charon', gender: 'Male (အမျိုးသား)', descMm: 'ရင့်ကျက်ဩဇာညောင်းသော လူကြီးအသံ', descEn: 'Wise, resonant elder storyteller' },
  { id: 'leda', name: 'Leda', gender: 'Female (အမျိုးသမီး)', descMm: 'နူးညံ့သိမ်မွေ့သော ညအိပ်ရာဝင် အသံ', descEn: 'Gentle, soothing bedtime reading' },
];

const STORY_MOOD_STYLES = [
  { id: 'classic', labelMm: 'ရိုးရာ ပုံပြင်ပြောဟန်', labelEn: 'Classic Storyteller', instruction: 'Speak like a traditional captivating storyteller with steady cadence and natural warmth.' },
  { id: 'horror', labelMm: 'သရဲ / သည်းထိတ်ရင်ဖို', labelEn: 'Horror & Suspense', instruction: 'Speak in a deep, whispering, tense and suspenseful narration tone with dramatic pacing.' },
  { id: 'bedtime', labelMm: 'ညအိပ်ရာဝင် / အေးချမ်း', labelEn: 'Soothing & Bedtime', instruction: 'Speak softly, rhythmically, and gently like reading a calming bedtime fairy tale.' },
  { id: 'epic', labelMm: 'စွန့်စားခန်း / ဇာတ်ရှိန်တက်', labelEn: 'Epic & Adventure', instruction: 'Speak with intense energy, dramatic momentum, and heroic cinematic gravitas.' },
  { id: 'emotional', labelMm: 'စိတ်ထိခိုက်ဖွယ် ရသစုံ', labelEn: 'Emotional & Poetic', instruction: 'Speak with deep heartfelt emotion, poetic pauses, and tender empathy.' },
];

const SAMPLE_STORIES = [
  {
    title: 'နဂါးမင်း၏ ကျောက်မျက်ရတနာ',
    author: 'စောမင်းခန့်',
    genre: 'fantasy' as const,
    chapter1Title: 'မှော်ဆန်သော လှိုဏ်ဂူတော်',
    content: `ဟိုးရှေးရှေးတုန်းက ပုပ္ပါးတောင်ကြီးရဲ့ နက်ရှိုင်းလှတဲ့ ချောက်ကမ်းပါးယံကြားမှာ မည်သူမျှ မရောက်ဖူးတဲ့ မှော်ဂူကြီးတစ်ခု ရှိခဲ့ပါတယ်။\n\nဂူနံရံတွေပေါ်မှာတော့ စိမ်းပြာရောင် ကျောက်မျက်တွေက ကြယ်ရောင်တွေလို တလက်လက် တောက်ပနေခဲ့ကြတယ်။\n\n[... ခေတ္တရပ်နား ...]\n\nထိုအချိန်မှာပင် ဂူအပြင်ဘက်ဆီမှ လေပြင်းကြီး တဟူးဟူး တိုက်ခတ်လာပြီး ဧရာမ နဂါးကြီးတစ်ကောင်ရဲ့ အသက်ရှူသံလို ဟိန်းဟောက်သံကြီး ပေါ်ထွက်လာခဲ့ပါတော့တယ်...။`
  },
  {
    title: 'သုသာန်ဟောင်းမှ ခြေသံများ',
    author: 'မင်းသုတ',
    genre: 'horror' as const,
    chapter1Title: 'မိုးသည်းထန်သော ညတစ်ည',
    content: `ညဉ့်သန်းခေါင်ယံ အချိန်။ မိုးခြိမ်းသံတွေက တစ်ချက်တစ်ချက် ကောင်းကင်ယံကို တုန်ခါသွားစေပါတယ်။\n\nရွာအစွန်က သစ်ပင်ဟောင်းကြီးအောက်မှာ ရပ်နေတဲ့ ကိုကျော်တစ်ယောက် လေပြင်းတွေကြားက ထူးဆန်းတဲ့ ခြေသံတွေကို စတင်ကြားလိုက်ရတယ်။\n\n[... ခေတ္တရပ်နား ...]\n\n"တရှပ်ရှပ်... တရှပ်ရှပ်..."\n\nခြေသံက တစ်လှမ်းချင်း သူ့အနားကို တိုးကပ်လာနေတယ်။ နောက်ကို လှည့်ကြည့်လိုက်တဲ့အခါမှာတော့... အဖြူရောင် အရိပ်မည်းကြီးတစ်ခုက သူ့ကို စိုက်ကြည့်နေတာ တွေ့လိုက်ရပါတော့တယ်...။`
  },
  {
    title: 'အလွမ်းညနေနှင့် မိုးစက်များ',
    author: 'နွေဦးမေ',
    genre: 'romance' as const,
    chapter1Title: 'မပြီးဆုံးသေးသော နှုတ်ဆက်ခြင်း',
    content: `မိုးဖွဲဖွဲကျနေတဲ့ ရန်ကုန်ညနေခင်းတစ်ခုမှာ ကော်ဖီဆိုင်လေးရဲ့ ပြတင်းပေါက်မှန်ကို မိုးစက်တွေက တဖွဲဖွဲ လာရောက်ရိုက်ခတ်နေကြပါတယ်။\n\nစားပွဲပေါ်မှာတော့ အေးစက်စက်ဖြစ်နေပြီဖြစ်တဲ့ ကော်ဖီခွက်လေးတစ်ခုရယ်၊ သူ ချန်ထားခဲ့တဲ့ စာအုပ်အဝါရောင်လေးရယ်ပဲ ကျန်ရစ်ခဲ့တယ်။\n\nအချိန်တွေ ဘယ်လောက်ပဲ ကုန်ဆုံးသွားပါစေ... သူ့ရဲ့ နွေးထွေးတဲ့ အပြုံးလေးတွေကိုတော့ ဒီရင်ထဲက ဘယ်တော့မှ မေ့ပျောက်နိုင်မှာ မဟုတ်ပါဘူး။`
  },
  {
    title: 'စိတ်၏ အေးချမ်းရာ ရိပ်သာ',
    author: 'သုခကာရီ',
    genre: 'dhamma' as const,
    chapter1Title: 'လက်ရှိပစ္စုပ္ပန်တွင် နေထိုင်ခြင်း',
    content: `လူ့ဘဝဆိုတာ လောဘ၊ ဒေါသ၊ မောဟ အပူမီးတွေကြားမှာ နေ့စဉ်နှင့်အမျှ မျောပါနေရတဲ့ ခရီးရှည်ကြီးတစ်ခု ဖြစ်ပါတယ်။\n\nသို့သော်လည်း တစ်ခဏတာမျှ မိမိရဲ့ ဝင်လေ၊ ထွက်လေကို သတိကပ်ပြီး နှလုံးသွင်းလိုက်တဲ့အခါမှာတော့ စိတ်ရဲ့ အေးချမ်းမှုကို ချက်ချင်း လက်ငင်း ခံစားသိရှိနိုင်ပါတယ်။\n\n[... ခေတ္တရပ်နား ...]\n\nအရာရာကို လက်ကိုင်မထားဘဲ အနတ္တသဘောအတိုင်း ခွင့်ပြုပေးနိုင်မယ်ဆိုရင် စစ်မှန်တဲ့ တည်ငြိမ်မှု အေးချမ်းမှုကို ရှာဖွေတွေ့ရှိနိုင်မည် ဖြစ်ပါသည်။`
  }
];

export const StoryAudiobookStudio: React.FC<StoryAudiobookStudioProps> = ({
  showToast,
  openModal,
  getApiKey,
  isAdmin,
  isPremium,
  userControl,
  onNavigateToSettings,
  onProcessingStateChange,
  customFonts = []
}) => {
  const { language, t } = useLanguage();
  const isMm = language === 'mm';

  // Sub tabs within the Audiobook Studio
  const [subTab, setSubTab] = useState<'script' | 'narration' | 'ambience' | 'cover' | 'ai'>('script');

  // Story Project State (Saved locally for convenience)
  const [project, setProject] = useState<StoryProject>(() => {
    const saved = localStorage.getItem('vbs_story_project');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse saved story project:', e);
      }
    }
    const sample = SAMPLE_STORIES[0];
    const initialChapterId = 'ch-1';
    return {
      title: sample.title,
      author: sample.author,
      genre: sample.genre,
      synopsis: 'စိတ်ဝင်စားဖွယ် မှော်ဆန်သော ပုံပြင် အသံစာအုပ်။',
      chapters: [
        {
          id: initialChapterId,
          number: 1,
          title: sample.chapter1Title,
          content: sample.content,
          audioResult: null,
          voiceId: 'kore',
          speed: 1.0,
          pitch: 0,
          ambience: 'mystery',
          lastUpdated: Date.now()
        }
      ],
      activeChapterId: initialChapterId
    };
  });

  // Save project to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem('vbs_story_project', JSON.stringify(project));
    } catch (e) {
      console.warn('Could not cache story project:', e);
    }
  }, [project]);

  // Current active chapter
  const activeChapter = useMemo(() => {
    return project.chapters.find(c => c.id === project.activeChapterId) || project.chapters[0];
  }, [project.chapters, project.activeChapterId]);

  // Audio Playback & Generation State
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<{ current: number; total: number; msg: string }>({ current: 0, total: 0, msg: '' });
  const [selectedMood, setSelectedMood] = useState<string>('classic');
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioVolume, setAudioVolume] = useState(1);
  const [ambienceVolume, setAmbienceVolume] = useState(0.35);
  const [activeAmbience, setActiveAmbience] = useState<AmbienceType>(activeChapter.ambience || 'none');
  const [isPlayingAmbience, setIsPlayingAmbience] = useState(false);
  const [isExportingMaster, setIsExportingMaster] = useState(false);

  // Audio element reference
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  // AI Assistant State
  const [aiPromptOutline, setAiPromptOutline] = useState('');
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiOutputPreview, setAiOutputPreview] = useState('');

  // Audiobook Cover & Thumbnail State
  const [coverPlatform, setCoverPlatform] = useState<'youtube' | 'podcast' | 'shorts'>('youtube');
  const [coverTitle, setCoverTitle] = useState(project.title);
  const [coverChapterText, setCoverChapterText] = useState(`အခန်း (${activeChapter.number})`);
  const [coverBadgeText, setCoverBadgeText] = useState('VlogsBySaw အသံစာအုပ်');
  const [coverFontFamily, setCoverFontFamily] = useState<string>('"Noto Sans Myanmar", sans-serif');

  const allMergedFonts = useMemo(() => {
    let userFonts: CustomFont[] = [];
    try {
      const stored = localStorage.getItem('vbs_user_custom_fonts');
      if (stored) userFonts = JSON.parse(stored);
    } catch {}
    const list = [...(customFonts || [])];
    userFonts.forEach(uf => {
      if (!list.some(f => f.id === uf.id || f.family === uf.family)) {
        list.push(uf);
      }
    });
    return list;
  }, [customFonts]);

  // Track any active processing and notify parent tab
  const isAnyProcessing = isGeneratingAudio || isExportingMaster || isAiGenerating;
  useEffect(() => {
    onProcessingStateChange?.(isAnyProcessing);
  }, [isAnyProcessing, onProcessingStateChange]);
  const [coverStylePreset, setCoverStylePreset] = useState<'fire' | 'neon' | 'diamond' | 'gold' | 'gothic'>('gold');
  const [coverVisualPrompt, setCoverVisualPrompt] = useState('');
  const [isGeneratingCover, setIsGeneratingCover] = useState(false);
  const [generatedCoverImage, setGeneratedCoverImage] = useState<string | null>(null);
  const [finalCoverUrl, setFinalCoverUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-repair audio URLs from base64 if revoked or dead after refresh
  useEffect(() => {
    if (activeChapter.audioResult && activeChapter.audioResult.audioData) {
      try {
        const bin = atob(activeChapter.audioResult.audioData);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: activeChapter.audioResult.mimeType || 'audio/wav' });
        const freshUrl = URL.createObjectURL(blob);
        
        // If current url is empty or dead, update it
        if (!activeChapter.audioResult.audioUrl || activeChapter.audioResult.audioUrl.length < 5) {
          updateActiveChapter({
            audioResult: {
              ...activeChapter.audioResult,
              audioUrl: freshUrl
            }
          });
        }
      } catch (err) {
        console.warn("Could not reconstruct audio URL from base64:", err);
      }
    }
  }, [activeChapter.id]);

  // Sync Cover inputs with project changes
  useEffect(() => {
    setCoverTitle(project.title);
    setCoverChapterText(`အခန်း (${activeChapter.number})`);
  }, [project.title, activeChapter.number]);

  // Sync live audio player speed slider
  useEffect(() => {
    if (audioElementRef.current) {
      audioElementRef.current.playbackRate = activeChapter.speed;
    }
  }, [activeChapter.speed, activeChapter.id]);

  // Word & Reading Time stats
  const scriptStats = useMemo(() => {
    const text = activeChapter.content || '';
    const charCount = text.length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const estimatedMinutes = Math.max(1, Math.round(words / 130));
    return { charCount, words, estimatedMinutes };
  }, [activeChapter.content]);

  // Handle Ambience volume updates
  const handleAmbienceVolumeChange = (newVol: number) => {
    setAmbienceVolume(newVol);
    ambienceSynthesizer.setVolume(newVol);
  };

  // Toggle Ambience play
  const toggleAmbience = (type: AmbienceType) => {
    if (activeAmbience === type && isPlayingAmbience) {
      ambienceSynthesizer.stop();
      setIsPlayingAmbience(false);
      setActiveAmbience('none');
    } else {
      ambienceSynthesizer.play(type);
      setActiveAmbience(type);
      setIsPlayingAmbience(true);
    }
  };

  // Stop sound on unmount
  useEffect(() => {
    return () => {
      ambienceSynthesizer.stop();
    };
  }, []);

  // Update current chapter property
  const updateActiveChapter = (fields: Partial<Chapter>) => {
    setProject(prev => ({
      ...prev,
      chapters: prev.chapters.map(c => c.id === prev.activeChapterId ? { ...c, ...fields, lastUpdated: Date.now() } : c)
    }));
  };

  // Add new chapter
  const handleAddChapter = () => {
    const newNumber = project.chapters.length + 1;
    const newId = `ch-${Date.now()}`;
    const newChapter: Chapter = {
      id: newId,
      number: newNumber,
      title: `အခန်း (${newNumber})`,
      content: '',
      audioResult: null,
      voiceId: activeChapter.voiceId || 'kore',
      speed: 1.0,
      pitch: 0,
      ambience: activeChapter.ambience || 'none',
      lastUpdated: Date.now()
    };
    setProject(prev => ({
      ...prev,
      chapters: [...prev.chapters, newChapter],
      activeChapterId: newId
    }));
    showToast(`အခန်း (${newNumber}) အသစ် ထည့်သွင်းပြီးပါပြီ`, 'success');
  };

  // Delete chapter
  const handleDeleteChapter = (id: string) => {
    if (project.chapters.length <= 1) {
      showToast('အနည်းဆုံး အခန်း (၁) ခန်း ရှိရပါမည်', 'error');
      return;
    }
    const remaining = project.chapters.filter(c => c.id !== id);
    const renumbered = remaining.map((c, i) => ({ ...c, number: i + 1 }));
    setProject(prev => ({
      ...prev,
      chapters: renumbered,
      activeChapterId: prev.activeChapterId === id ? renumbered[0].id : prev.activeChapterId
    }));
    showToast('အခန်းကို ပယ်ဖျက်ပြီးပါပြီ', 'success');
  };

  // Safe Chapter Switching
  const handleSwitchChapter = (targetId: string) => {
    if (audioElementRef.current) {
      audioElementRef.current.pause();
    }
    setIsPlayingAudio(false);
    setAudioCurrentTime(0);
    setProject(p => ({ ...p, activeChapterId: targetId }));
  };

  // Quick Formatting Tools
  const insertTagAtCursor = (tag: string) => {
    const textarea = document.getElementById('chapter-script-editor') as HTMLTextAreaElement | null;
    if (!textarea) {
      updateActiveChapter({ content: (activeChapter.content || '') + '\n' + tag });
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = activeChapter.content;
    const newText = text.substring(0, start) + tag + text.substring(end);
    updateActiveChapter({ content: newText });

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + tag.length, start + tag.length);
    }, 50);
  };

  // Clean Burmese punctuation
  const handleCleanPunctuation = () => {
    let text = activeChapter.content;
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\s*။\s*/g, '။ ');
    text = text.replace(/\s*၊\s*/g, '၊ ');
    text = text.replace(/\.{3,}/g, ' [... ခေတ္တရပ်နား ...] ');
    updateActiveChapter({ content: text.trim() });
    showToast('စာသားများကို သပ်ရပ်စွာ ညှိပြီးပါပြီ ✨', 'success');
  };

  // Load Sample Story
  const handleLoadSample = (sample: typeof SAMPLE_STORIES[0]) => {
    if (audioElementRef.current) audioElementRef.current.pause();
    setIsPlayingAudio(false);
    setAudioCurrentTime(0);

    const initialId = `ch-${Date.now()}`;
    setProject({
      title: sample.title,
      author: sample.author,
      genre: sample.genre,
      synopsis: `${sample.title} အသံစာအုပ် စတူဒီယို ပရောဂျက်`,
      chapters: [
        {
          id: initialId,
          number: 1,
          title: sample.chapter1Title,
          content: sample.content,
          audioResult: null,
          voiceId: 'kore',
          speed: 1.0,
          pitch: 0,
          ambience: sample.genre === 'horror' ? 'rain' : sample.genre === 'dhamma' ? 'zen' : 'piano',
          lastUpdated: Date.now()
        }
      ],
      activeChapterId: initialId
    });
    showToast(`နမူနာပုံပြင် "${sample.title}" ကို ထည့်သွင်းပြီးပါပြီ`, 'success');
  };

  // Generate Chapter Audio via Gemini TTS
  const handleGenerateChapterAudio = async () => {
    if (!activeChapter.content.trim()) {
      showToast('အသံထုတ်ယူရန် ဇာတ်လမ်းစာသား ရိုက်ထည့်ပါ', 'error');
      return;
    }

    const apiKey = getApiKey() || '';
    if (!apiKey.trim()) {
      openModal({
        title: t('common.error'),
        message: t('generate.noApiKey'),
        type: 'error',
        confirmText: isMm ? 'ပြင်ဆင်ချက်သို့ သွားမည်' : 'Go to Settings',
        onConfirm: () => { if (onNavigateToSettings) onNavigateToSettings(); }
      });
      return;
    }

    setIsGeneratingAudio(true);
    setGenerationProgress({ current: 0, total: 1, msg: 'စနစ်ကို စတင်ပြင်ဆင်နေပါသည်...' });

    try {
      const gemini = new GeminiTTSService(apiKey, isAdmin);
      const mood = STORY_MOOD_STYLES.find(m => m.id === selectedMood);

      const config: TTSConfig = {
        voiceId: activeChapter.voiceId,
        speed: activeChapter.speed,
        pitch: activeChapter.pitch,
        volume: 0,
        styleInstruction: mood?.instruction || '',
        selectedModel: GEMINI_MODELS.TTS,
        customFileName: `${project.title}_Ch${activeChapter.number}`,
        exportFormat: 'wav'
      };

      const result = await gemini.generateTTS(
        activeChapter.content,
        config,
        undefined,
        (current, total, msg) => {
          setGenerationProgress({ current, total, msg });
        }
      );

      // Reconstruct fresh URL to guarantee playback
      if (result.audioData) {
        const bin = atob(result.audioData);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: result.mimeType || 'audio/wav' });
        result.audioUrl = URL.createObjectURL(blob);
      }

      // Save audio result to chapter
      updateActiveChapter({ audioResult: result });
      showToast(`အခန်း (${activeChapter.number}) အသံဖိုင် အောင်မြင်စွာ ဖန်တီးပြီးပါပြီ 🎙️`, 'success');
      setSubTab('narration');
    } catch (err: unknown) {
      console.error('Audio generation error:', err);
      let msg = err instanceof Error ? err.message : 'အသံထုတ်ယူမှု မအောင်မြင်ပါ။ နောက်မှ ထပ်မံကြိုးစားပါ';
      if (typeof msg === 'string' && msg.startsWith('{') && msg.includes('"message"')) {
        try {
          const parsed = JSON.parse(msg);
          msg = parsed.error?.message || parsed.message || msg;
        } catch {
          // ignore
        }
      }
      showToast(msg, 'error');
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  // Audio Player Controls
  const togglePlayAudio = () => {
    if (!audioElementRef.current) return;
    if (isPlayingAudio) {
      audioElementRef.current.pause();
      setIsPlayingAudio(false);
    } else {
      audioElementRef.current.play().catch(e => console.error('Audio play error:', e));
      setIsPlayingAudio(true);
      // Auto start matching ambience if set
      if (activeChapter.ambience && activeChapter.ambience !== 'none' && !isPlayingAmbience) {
        ambienceSynthesizer.play(activeChapter.ambience);
        setActiveAmbience(activeChapter.ambience);
        setIsPlayingAmbience(true);
      }
    }
  };

  const handleRestartAudio = () => {
    if (!audioElementRef.current) return;
    audioElementRef.current.currentTime = 0;
    audioElementRef.current.play().catch(e => console.error('Audio play error:', e));
    setIsPlayingAudio(true);
  };

  // Download Voice-Only Audio (WAV)
  const handleDownloadWav = () => {
    if (!activeChapter.audioResult) return;
    try {
      const link = document.createElement('a');
      link.href = activeChapter.audioResult.audioUrl;
      link.download = `${project.title || 'Audiobook'}_Ch${activeChapter.number}.wav`;
      link.click();
      showToast('WAV အသံဖိုင်ကို ဒေါင်းလုဒ်ဆွဲပြီးပါပြီ 🎵', 'success');
    } catch {
      showToast('ဒေါင်းလုဒ် မအောင်မြင်ပါ', 'error');
    }
  };

  // Download Master (Voice + BGM Mixed) WAV
  const handleDownloadMasterMixWav = async () => {
    if (!activeChapter.audioResult) return;
    setIsExportingMaster(true);
    try {
      showToast('Master Mix (Voice + BGM) ပြုလုပ်နေပါသည်... ခဏစောင့်ပါ', 'success');

      let voiceBlob: Blob;
      if (activeChapter.audioResult.audioData) {
        const bin = atob(activeChapter.audioResult.audioData);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        voiceBlob = new Blob([bytes], { type: 'audio/wav' });
      } else {
        const resp = await fetch(activeChapter.audioResult.audioUrl);
        voiceBlob = await resp.blob();
      }

      const mixedWavBlob = await ambienceSynthesizer.mixVoiceWithAmbience(
        voiceBlob,
        activeChapter.ambience || 'none',
        ambienceVolume,
        audioVolume
      );

      const link = document.createElement('a');
      link.href = URL.createObjectURL(mixedWavBlob);
      link.download = `${project.title || 'Audiobook'}_Ch${activeChapter.number}_Master_BGM.wav`;
      link.click();
      showToast('Master Mixed WAV ဒေါင်းလုဒ်ဆွဲပြီးပါပြီ 🎶', 'success');
    } catch (err) {
      console.error('Master Mix error:', err);
      showToast('Master Mix ဒေါင်းလုဒ် မအောင်မြင်ပါ', 'error');
    } finally {
      setIsExportingMaster(false);
    }
  };

  // Download Subtitles (SRT)
  const handleDownloadSrt = () => {
    if (!activeChapter.audioResult?.subtitles) return;
    try {
      const srtContent = generateSRT(activeChapter.audioResult.subtitles);
      downloadSrtFile(srtContent, `${project.title || 'Audiobook'}_Ch${activeChapter.number}.srt`);
      showToast('SRT စာတန်းထိုးဖိုင်ကို ဒေါင်းလုဒ်ဆွဲပြီးပါပြီ 📝', 'success');
    } catch {
      showToast('SRT ဒေါင်းလုဒ် မအောင်မြင်ပါ', 'error');
    }
  };

  // Download Chapter Script (.txt)
  const handleDownloadScriptTxt = () => {
    if (!activeChapter.content.trim()) return;
    const fullText = `ခေါင်းစဉ်: ${project.title}\nစာရေးသူ: ${project.author}\nအမျိုးအစား: ${project.genre}\n${activeChapter.title || `အခန်း (${activeChapter.number})`}\n\n${activeChapter.content}`;
    const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${project.title || 'Audiobook'}_Ch${activeChapter.number}_Script.txt`;
    link.click();
    showToast('စာသားဖိုင် (.txt) ဒေါင်းလုဒ်ဆွဲပြီးပါပြီ 📄', 'success');
  };

  // AI Story Assistant: Generate Chapter from Outline
  const handleAiGenerateChapter = async () => {
    if (!aiPromptOutline.trim()) {
      showToast('ဇာတ်လမ်း အကျဉ်းချုပ် သို့မဟုတ် ခေါင်းစဉ် ရိုက်ထည့်ပါ', 'error');
      return;
    }
    const apiKey = getApiKey() || '';
    if (!apiKey.trim()) {
      openModal({
        title: t('common.error'),
        message: t('generate.noApiKey'),
        type: 'error',
        confirmText: isMm ? 'ပြင်ဆင်ချက်သို့ သွားမည်' : 'Go to Settings',
        onConfirm: () => { if (onNavigateToSettings) onNavigateToSettings(); }
      });
      return;
    }

    setIsAiGenerating(true);
    try {
      const gemini = new GeminiTTSService(apiKey, isAdmin);
      const genreObj = STORY_GENRES.find(g => g.id === project.genre);
      const moodObj = STORY_MOOD_STYLES.find(m => m.id === selectedMood);

      const generatedScript = await gemini.generateStoryChapter(
        project.title,
        activeChapter.number,
        activeChapter.title,
        genreObj?.labelMm || project.genre,
        aiPromptOutline,
        moodObj?.labelMm || 'သဘာဝကျနားဝင်ချိုသော ပုံစံ'
      );

      setAiOutputPreview(generatedScript);
      showToast('AI ဇာတ်လမ်းအခန်းကို ဖန်တီးပေးပြီးပါပြီ ✨', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'AI ဇာတ်လမ်းဖန်တီးမှု မအောင်မြင်ပါ';
      openModal({
        title: t('common.error'),
        message: msg,
        type: 'error'
      });
    } finally {
      setIsAiGenerating(false);
    }
  };

  // AI Story Assistant: Polish existing script for audiobook
  const handleAiPolishScript = async (style: 'suspense' | 'emotional' | 'folk' | 'bedtime' | 'cinematic') => {
    if (!activeChapter.content.trim()) {
      showToast('ပြုပြင်ရန် ဇာတ်လမ်းစာသား မရှိသေးပါ', 'error');
      return;
    }
    const apiKey = getApiKey() || '';
    if (!apiKey.trim()) {
      openModal({
        title: t('common.error'),
        message: t('generate.noApiKey'),
        type: 'error',
        confirmText: isMm ? 'ပြင်ဆင်ချက်သို့ သွားမည်' : 'Go to Settings',
        onConfirm: () => { if (onNavigateToSettings) onNavigateToSettings(); }
      });
      return;
    }

    setIsAiGenerating(true);
    try {
      const gemini = new GeminiTTSService(apiKey, isAdmin);
      const polished = await gemini.polishStoryForAudiobook(activeChapter.content, style);
      setAiOutputPreview(polished);
      showToast('ဇာတ်လမ်းကို အသံစာအုပ်ဖတ်ဟန်ဖြင့် ပိုမိုကောင်းမွန်အောင် ပြင်ဆင်ပြီးပါပြီ ✨', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'စာသားပြင်ဆင်မှု မအောင်မြင်ပါ';
      openModal({
        title: t('common.error'),
        message: msg,
        type: 'error'
      });
    } finally {
      setIsAiGenerating(false);
    }
  };

  // Apply AI output directly to active chapter script
  const handleApplyAiOutput = () => {
    if (!aiOutputPreview.trim()) return;
    updateActiveChapter({ content: aiOutputPreview.trim() });
    showToast('လက်ရှိအခန်းထဲသို့ စာသားထည့်သွင်းပြီးပါပြီ 📖', 'success');
    setSubTab('script');
  };

  // --- AUDIOBOOK COVER & THUMBNAIL CREATOR LOGIC ---
  const COVER_RESOLUTIONS = {
    youtube: { width: 1280, height: 720, label: '16:9 YouTube Audiobook' },
    podcast: { width: 1080, height: 1080, label: '1:1 Podcast / Spotify Square' },
    shorts: { width: 1080, height: 1920, label: '9:16 TikTok / Reels Story' }
  };

  const handleGenerateCoverArtwork = async () => {
    const apiKey = getApiKey() || '';
    if (!apiKey.trim()) {
      openModal({
        title: t('common.error'),
        message: t('generate.noApiKey'),
        type: 'error',
        confirmText: isMm ? 'ပြင်ဆင်ချက်သို့ သွားမည်' : 'Go to Settings',
        onConfirm: () => { if (onNavigateToSettings) onNavigateToSettings(); }
      });
      return;
    }

    setIsGeneratingCover(true);
    try {
      const gemini = new GeminiTTSService(apiKey, isAdmin);
      const genreObj = STORY_GENRES.find(g => g.id === project.genre);
      const resolution = COVER_RESOLUTIONS[coverPlatform];

      const scenePrompt = coverVisualPrompt.trim() 
        ? coverVisualPrompt 
        : `${project.title}, ${genreObj?.bgHint || 'mythical book cover background'}`;

      const enhancedPrompt = `Create an ultra-detailed, professional audiobook cover artwork background ONLY.
Genre: ${genreObj?.labelEn || project.genre}
Theme: ${scenePrompt}
Style: ${genreObj?.promptSuffix || 'cinematic masterpiece, depth of field, 8K wallpaper'}
Dimensions: ${resolution.width}x${resolution.height}
CRITICAL REQUIREMENT: Do NOT include ANY text, words, letters, logos, typography or watermark. Generate ONLY the background scene image.`;

      const dataUrl = await gemini.generateImage(enhancedPrompt);
      const base64Content = dataUrl.includes('base64,') ? dataUrl.split('base64,')[1] : dataUrl;
      setGeneratedCoverImage(base64Content);
      showToast('ကာဗာပုံရိပ် အောင်မြင်စွာ ထုတ်ယူပြီးပါပြီ 🎨', 'success');
      renderCoverCanvas(base64Content);
    } catch (err: unknown) {
      console.error('Cover generation error:', err);
      const msg = err instanceof Error ? err.message : 'ကာဗာထုတ်ယူမှု မအောင်မြင်ပါ';
      showToast(msg, 'error');
    } finally {
      setIsGeneratingCover(false);
    }
  };

  // Handle Custom Image Upload
  const handleCustomImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      const base64 = dataUrl.includes('base64,') ? dataUrl.split('base64,')[1] : dataUrl;
      setGeneratedCoverImage(base64);
      renderCoverCanvas(base64);
      showToast('ကာဗာနောက်ခံပုံ ထည့်သွင်းပြီးပါပြီ 🖼️', 'success');
    };
    reader.readAsDataURL(file);
  };

  // Render Canvas with text overlay
  const renderCoverCanvas = (base64Img: string | null = generatedCoverImage) => {
    const canvas = canvasRef.current || document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const res = COVER_RESOLUTIONS[coverPlatform];
    canvas.width = res.width;
    canvas.height = res.height;

    const drawText = () => {
      // Vignette shadow at bottom for text contrast
      const grad = ctx.createLinearGradient(0, canvas.height * 0.4, 0, canvas.height);
      grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      grad.addColorStop(0.7, 'rgba(0, 0, 0, 0.7)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0.95)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, canvas.height * 0.4, canvas.width, canvas.height * 0.6);

      // Top subtle badge shadow
      const topGrad = ctx.createLinearGradient(0, 0, 0, canvas.height * 0.3);
      topGrad.addColorStop(0, 'rgba(0,0,0,0.8)');
      topGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = topGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height * 0.3);

      // Safe roundRect helper
      const fillRoundRect = (x: number, y: number, w: number, h: number, r: number) => {
        if (typeof ctx.roundRect === 'function') {
          ctx.beginPath();
          ctx.roundRect(x, y, w, h, r);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.rect(x, y, w, h);
          ctx.fill();
        }
      };
      const strokeRoundRect = (x: number, y: number, w: number, h: number, r: number) => {
        if (typeof ctx.roundRect === 'function') {
          ctx.beginPath();
          ctx.roundRect(x, y, w, h, r);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.rect(x, y, w, h);
          ctx.stroke();
        }
      };

      // 1. Top Badges (Genre & Badge Text)
      ctx.save();
      const badgeText = coverBadgeText || 'VlogsBySaw အသံစာအုပ်';
      ctx.font = `bold 36px "Inter", ${coverFontFamily}`;
      const badgeWidth = ctx.measureText(badgeText).width + 50;
      const badgeX = 50;
      const badgeY = 50;

      ctx.fillStyle = 'rgba(234, 179, 8, 0.9)'; // Amber
      fillRoundRect(badgeX, badgeY, badgeWidth, 54, 12);

      ctx.fillStyle = '#000000';
      ctx.fillText(badgeText, badgeX + 25, badgeY + 39);
      ctx.restore();

      // 2. Chapter Badge
      if (coverChapterText.trim()) {
        ctx.save();
        ctx.font = `bold 42px ${coverFontFamily}`;
        const chWidth = ctx.measureText(coverChapterText).width + 60;
        const chX = canvas.width - chWidth - 50;
        const chY = 50;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 3;
        fillRoundRect(chX, chY, chWidth, 58, 12);
        strokeRoundRect(chX, chY, chWidth, 58, 12);

        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(coverChapterText, chX + 30, chY + 42);
        ctx.restore();
      }

      // 3. Main Book Title
      const title = coverTitle.trim() || project.title || 'အသံစာအုပ်';
      const titleFontSize = coverPlatform === 'shorts' ? 84 : 76;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = `900 ${titleFontSize}px ${coverFontFamily}`;

      const titleX = canvas.width / 2;
      const titleY = canvas.height - (coverPlatform === 'shorts' ? 260 : 160);

      // Title Glow & Stroke
      ctx.shadowColor = coverStylePreset === 'fire' ? 'rgba(255, 69, 0, 0.9)' :
                        coverStylePreset === 'neon' ? 'rgba(0, 255, 255, 0.9)' :
                        coverStylePreset === 'gold' ? 'rgba(234, 179, 8, 0.8)' : 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 30;
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 14;
      ctx.strokeText(title, titleX, titleY);

      // Title Fill Gradient
      const textGrad = ctx.createLinearGradient(0, titleY - 60, 0, titleY);
      if (coverStylePreset === 'fire') {
        textGrad.addColorStop(0, '#FFE259');
        textGrad.addColorStop(1, '#FF4500');
      } else if (coverStylePreset === 'neon') {
        textGrad.addColorStop(0, '#00FFFF');
        textGrad.addColorStop(1, '#D946EF');
      } else if (coverStylePreset === 'gold') {
        textGrad.addColorStop(0, '#FFF5C0');
        textGrad.addColorStop(0.5, '#EAB308');
        textGrad.addColorStop(1, '#B45309');
      } else {
        textGrad.addColorStop(0, '#FFFFFF');
        textGrad.addColorStop(1, '#E2E8F0');
      }
      ctx.fillStyle = textGrad;
      ctx.fillText(title, titleX, titleY);

      // 4. Author Name Subtitle
      const authorText = `ရေးသားသူ / ဇာတ်ကြောင်းပြောသူ - ${project.author || 'VlogsBySaw'}`;
      ctx.font = `600 38px ${coverFontFamily}`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#000000';
      ctx.fillText(authorText, titleX, titleY + 65);
      ctx.restore();

      setFinalCoverUrl(canvas.toDataURL('image/png'));
    };

    if (base64Img) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        drawText();
      };
      img.src = base64Img.startsWith('data:') ? base64Img : `data:image/png;base64,${base64Img}`;
    } else {
      const bgGrad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      bgGrad.addColorStop(0, '#0f172a');
      bgGrad.addColorStop(0.5, '#1e1b4b');
      bgGrad.addColorStop(1, '#020617');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawText();
    }
  };

  // Re-render canvas when cover text properties change
  useEffect(() => {
    if (subTab === 'cover') {
      renderCoverCanvas();
    }
  }, [coverPlatform, coverTitle, coverChapterText, coverBadgeText, coverStylePreset, subTab]);

  // Download Final Cover PNG
  const handleDownloadCoverPng = () => {
    if (!finalCoverUrl) return;
    try {
      const link = document.createElement('a');
      link.href = finalCoverUrl;
      link.download = `${project.title || 'Audiobook'}_Cover_${coverPlatform}_Ch${activeChapter.number}.png`;
      link.click();
      showToast('ကာဗာပုံကို ဒေါင်းလုဒ်ဆွဲပြီးပါပြီ 🖼️', 'success');
    } catch {
      showToast('ကာဗာ ဒေါင်းလုဒ် မအောင်မြင်ပါ', 'error');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Banner / Studio Title */}
      <div className="premium-glass rounded-3xl p-6 sm:p-8 border border-amber-500/20 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold uppercase tracking-wider">
                <Sparkles size={13} />
                <span>Cinematic Story Audiobook Engine</span>
              </div>
              {isPremium && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold">
                  <ShieldCheck size={13} />
                  <span>Premium Active</span>
                </div>
              )}
              {userControl?.vbsId && (
                <span className="text-[11px] font-mono text-slate-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/5">
                  ID: {userControl.vbsId}
                </span>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white tracking-tight flex items-center gap-3">
              <BookOpen className="text-amber-400 w-8 h-8 sm:w-10 sm:h-10 shrink-0" />
              <span>{isMm ? 'ပုံပြင်နှင့် အသံစာအုပ် စတူဒီယို' : 'Story & Audiobook Studio'}</span>
            </h1>
            <p className="text-sm sm:text-base text-slate-300 max-w-2xl leading-relaxed">
              {isMm 
                ? 'ဝတ္ထု၊ ပုံပြင်၊ သရဲဇာတ်လမ်းနှင့် တရားဓမ္မ အသံစာအုပ်များအတွက် အခန်းလိုက် စီမံခန့်ခွဲမှု၊ နောက်ခံအသံလှိုင်း (BGM) ရောစပ်မှုနှင့် စာအုပ်ကာဗာ ဖန်တီးသည့် အပြည့်စုံဆုံး ကိရိယာများ' 
                : 'Create full-length audiobooks with multi-chapter management, character voices, atmospheric soundscapes (BGM), and cover art generator.'}
            </p>
          </div>

          {/* Quick Stats Pill */}
          <div className="flex items-center gap-3 sm:gap-4 bg-black/40 border border-white/10 rounded-2xl p-3 sm:p-4 shrink-0">
            <div className="text-center px-2">
              <span className="text-[10px] sm:text-xs text-slate-400 font-medium block">အခန်းပေါင်း</span>
              <span className="text-lg sm:text-2xl font-black text-amber-400">{project.chapters.length}</span>
            </div>
            <div className="h-8 w-px bg-white/10" />
            <div className="text-center px-2">
              <span className="text-[10px] sm:text-xs text-slate-400 font-medium block">စာလုံးရေ</span>
              <span className="text-lg sm:text-2xl font-black text-white">{scriptStats.charCount}</span>
            </div>
            <div className="h-8 w-px bg-white/10" />
            <div className="text-center px-2">
              <span className="text-[10px] sm:text-xs text-slate-400 font-medium block">ခန့်မှန်းကြာချိန်</span>
              <span className="text-lg sm:text-2xl font-black text-emerald-400">~{scriptStats.estimatedMinutes} မိနစ်</span>
            </div>
          </div>
        </div>

        {/* Audiobook Tools Navigation Tabs */}
        <div className="mt-8 flex items-center gap-2 overflow-x-auto no-scrollbar border-t border-white/10 pt-4">
          <button
            onClick={() => setSubTab('script')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm tracking-wide transition-all whitespace-nowrap shrink-0 ${
              subTab === 'script'
                ? 'bg-amber-400 text-black shadow-lg shadow-amber-400/20'
                : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white border border-white/5'
            }`}
          >
            <AlignLeft size={16} />
            <span>၁။ ဇာတ်လမ်း & အခန်းများ (Script)</span>
          </button>

          <button
            onClick={() => setSubTab('narration')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm tracking-wide transition-all whitespace-nowrap shrink-0 ${
              subTab === 'narration'
                ? 'bg-amber-400 text-black shadow-lg shadow-amber-400/20'
                : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white border border-white/5'
            }`}
          >
            <Mic size={16} />
            <span>၂။ အသံသွင်း Narration (TTS)</span>
            {activeChapter.audioResult && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>

          <button
            onClick={() => setSubTab('ambience')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm tracking-wide transition-all whitespace-nowrap shrink-0 ${
              subTab === 'ambience'
                ? 'bg-amber-400 text-black shadow-lg shadow-amber-400/20'
                : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white border border-white/5'
            }`}
          >
            <Music size={16} />
            <span>၃။ နောက်ခံ BGM & Ambience Mixer</span>
            {isPlayingAmbience && (
              <span className="w-2 h-2 rounded-full bg-amber-300 animate-ping" />
            )}
          </button>

          <button
            onClick={() => setSubTab('cover')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm tracking-wide transition-all whitespace-nowrap shrink-0 ${
              subTab === 'cover'
                ? 'bg-amber-400 text-black shadow-lg shadow-amber-400/20'
                : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white border border-white/5'
            }`}
          >
            <ImageIcon size={16} />
            <span>၄။ ကာဗာ & သမ်းနေးလ် (Cover Art)</span>
          </button>

          <button
            onClick={() => setSubTab('ai')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm tracking-wide transition-all whitespace-nowrap shrink-0 ${
              subTab === 'ai'
                ? 'bg-amber-400 text-black shadow-lg shadow-amber-400/20'
                : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white border border-white/5'
            }`}
          >
            <Wand2 size={16} />
            <span>၅။ AI ဇာတ်လမ်းလက်ထောက် (AI Story)</span>
          </button>
        </div>
      </div>

      {/* Hidden Audio Element for Chapter Audio Playback */}
      {Boolean(activeChapter.audioResult?.audioUrl) && (
        <audio
          ref={audioElementRef}
          src={activeChapter.audioResult!.audioUrl}
          onTimeUpdate={(e) => setAudioCurrentTime((e.target as HTMLAudioElement).currentTime)}
          onLoadedMetadata={(e) => setAudioDuration((e.target as HTMLAudioElement).duration)}
          onEnded={() => setIsPlayingAudio(false)}
          onError={() => {}}
        />
      )}

      {/* SUB-TAB 1: SCRIPT & CHAPTERS */}
      {subTab === 'script' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Chapters & Story Info (4 cols) */}
          <div className="lg:col-span-4 space-y-6">
            {/* Story Details Card */}
            <div className="premium-glass rounded-2xl p-5 border border-white/10 space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
                <Bookmark size={16} />
                <span>ဇာတ်လမ်း အချက်အလက်</span>
              </h3>

              <div>
                <label className="text-xs text-slate-400 block mb-1">ဇာတ်လမ်း ခေါင်းစဉ် (Story Title)</label>
                <input
                  type="text"
                  value={project.title}
                  onChange={(e) => setProject(p => ({ ...p, title: e.target.value }))}
                  placeholder="ဥပမာ- နဂါးမင်း၏ ကျောက်မျက်ရတနာ"
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 transition-colors"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">စာရေးသူ / ဇာတ်ကြောင်းပြောသူ အမည်</label>
                <input
                  type="text"
                  value={project.author}
                  onChange={(e) => setProject(p => ({ ...p, author: e.target.value }))}
                  placeholder="ဥပမာ- စောမင်းခန့်"
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 transition-colors"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">ဇာတ်လမ်း အမျိုးအစား (Genre)</label>
                <select
                  value={project.genre}
                  onChange={(e) => setProject(p => ({ ...p, genre: e.target.value as StoryProject['genre'] }))}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-amber-400 transition-colors"
                >
                  {STORY_GENRES.map(g => (
                    <option key={g.id} value={g.id} className="bg-slate-900 text-white">
                      {g.emoji} {g.labelMm} ({g.labelEn})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Chapters List */}
            <div className="premium-glass rounded-2xl p-5 border border-white/10 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
                  <Layers size={16} />
                  <span>အခန်းများ စာရင်း ({project.chapters.length})</span>
                </h3>
                <button
                  onClick={handleAddChapter}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-400/20 hover:bg-amber-400/30 text-amber-300 rounded-lg text-xs font-bold border border-amber-400/30 transition-all"
                >
                  <Plus size={14} />
                  <span>အခန်းအသစ်</span>
                </button>
              </div>

              <div className="space-y-2 max-h-72 overflow-y-auto pr-1 custom-scrollbar">
                {project.chapters.map((ch) => {
                  const isActive = ch.id === project.activeChapterId;
                  return (
                    <div
                      key={ch.id}
                      onClick={() => handleSwitchChapter(ch.id)}
                      className={`group p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                        isActive
                          ? 'bg-amber-400/15 border-amber-400/40 text-white shadow-md'
                          : 'bg-white/5 border-white/5 text-slate-300 hover:bg-white/10'
                      }`}
                    >
                      <div className="flex items-center gap-3 truncate">
                        <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black shrink-0 ${
                          isActive ? 'bg-amber-400 text-black' : 'bg-white/10 text-slate-400'
                        }`}>
                          {ch.number}
                        </span>
                        <div className="truncate">
                          <p className="text-sm font-bold truncate leading-tight">{ch.title || `အခန်း (${ch.number})`}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5 truncate">
                            {ch.content ? `${ch.content.length} စာလုံး` : 'စာသားမရှိသေးပါ'}
                            {ch.audioResult && ' • 🔊 အသံသွင်းပြီး'}
                          </p>
                        </div>
                      </div>

                      {project.chapters.length > 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteChapter(ch.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1.5 hover:text-rose-400 transition-opacity"
                          title="အခန်း ပယ်ဖျက်ရန်"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Quick Sample Stories to Load */}
            <div className="premium-glass rounded-2xl p-5 border border-white/10 space-y-3">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                နမူနာ ဇာတ်လမ်းများ စမ်းသပ်ရန်
              </span>
              <div className="grid grid-cols-1 gap-2">
                {SAMPLE_STORIES.map((s, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleLoadSample(s)}
                    className="text-left p-2.5 rounded-xl bg-white/5 hover:bg-amber-400/10 border border-white/5 hover:border-amber-400/30 text-xs text-slate-300 hover:text-white transition-all flex items-center justify-between"
                  >
                    <span className="truncate font-medium">{s.title} ({s.author})</span>
                    <span className="text-amber-400 text-[10px] font-bold shrink-0 ml-2">Load</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Active Chapter Script Editor (8 cols) */}
          <div className="lg:col-span-8 space-y-4">
            <div className="premium-glass rounded-2xl p-6 border border-white/10 space-y-4">
              {/* Chapter Header & Title Edit */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <span className="px-3 py-1 bg-amber-400 text-black text-xs font-black rounded-lg">
                    အခန်း ({activeChapter.number})
                  </span>
                  <input
                    type="text"
                    value={activeChapter.title}
                    onChange={(e) => updateActiveChapter({ title: e.target.value })}
                    placeholder="အခန်း ခေါင်းစဉ်"
                    className="bg-transparent text-lg font-bold text-white focus:outline-none focus:border-b border-amber-400 pb-0.5"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(activeChapter.content);
                      showToast('ဇာတ်လမ်းစာသားကို ကူးယူပြီးပါပြီ 📋', 'success');
                    }}
                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white text-xs flex items-center gap-1.5 transition-colors"
                    title="စာသားကူးယူရန်"
                  >
                    <Copy size={14} />
                    <span>Copy</span>
                  </button>
                  <button
                    onClick={handleDownloadScriptTxt}
                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white text-xs flex items-center gap-1.5 transition-colors"
                    title="စာသားဖိုင် (.txt) ဒေါင်းလုဒ်ဆွဲရန်"
                  >
                    <Download size={14} />
                    <span>.txt</span>
                  </button>
                  <button
                    onClick={handleCleanPunctuation}
                    className="p-2 rounded-lg bg-white/5 hover:bg-amber-400/20 text-slate-300 hover:text-amber-300 text-xs flex items-center gap-1.5 transition-colors"
                    title="စာသားနှင့် ပုဒ်ဖြတ်ပုဒ်ရပ်များကို ညှိရန်"
                  >
                    <Wand2 size={14} />
                    <span>Format & Clean</span>
                  </button>
                </div>
              </div>

              {/* Story Audio Script Tag Shortcuts */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar text-xs">
                <span className="text-slate-500 font-bold uppercase text-[10px] shrink-0">Tags:</span>
                <button
                  onClick={() => insertTagAtCursor('\n[... ခေတ္တရပ်နား ...]\n')}
                  className="px-2.5 py-1 rounded-md bg-amber-400/10 hover:bg-amber-400/20 text-amber-300 border border-amber-400/20 font-mono shrink-0 transition-colors"
                >
                  ⏱️ [ခေတ္တရပ်နား]
                </button>
                <button
                  onClick={() => insertTagAtCursor('\n[သည်းထိတ်ရင်ဖို လေသံဖြင့်]\n')}
                  className="px-2.5 py-1 rounded-md bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20 shrink-0 transition-colors"
                >
                  👻 [သည်းထိတ်ရင်ဖို]
                </button>
                <button
                  onClick={() => insertTagAtCursor('\n[ညင်သာအေးချမ်းသော လေသံ]\n')}
                  className="px-2.5 py-1 rounded-md bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/20 shrink-0 transition-colors"
                >
                  🌙 [ညင်သာအေးချမ်း]
                </button>
                <button
                  onClick={() => insertTagAtCursor('\n[ဇာတ်ကောင် စကားပြော: ]\n')}
                  className="px-2.5 py-1 rounded-md bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/20 shrink-0 transition-colors"
                >
                  🗣️ [ဇာတ်ကောင်ခွဲ]
                </button>
              </div>

              {/* Textarea Editor */}
              <div className="relative">
                <textarea
                  id="chapter-script-editor"
                  value={activeChapter.content}
                  onChange={(e) => updateActiveChapter({ content: e.target.value })}
                  placeholder="ဤနေရာတွင် အခန်းလိုက် ဇာတ်လမ်းစာသား ရိုက်ထည့်ပါ သို့မဟုတ် ကူးထည့်ပါ... (မြန်မာဘာသာဖြင့် သဘာဝကျသော စကားပြောဟန်ဖြင့် ရေးသားပါက အသံထွက် ပိုမိုကောင်းမွန်ပါသည်)"
                  rows={16}
                  className="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-sm sm:text-base text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-400 transition-colors resize-y leading-relaxed font-sans"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <span>စာလုံးရေ: <strong className="text-white">{scriptStats.charCount}</strong></span>
                  <span>•</span>
                  <span>ခန့်မှန်းကြာချိန်: <strong className="text-emerald-400">~{scriptStats.estimatedMinutes} မိနစ်</strong></span>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <button
                    onClick={() => setSubTab('ai')}
                    className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold transition-all flex items-center justify-center gap-2"
                  >
                    <Wand2 size={15} className="text-amber-400" />
                    <span>AI ဖြင့် ပြင်ဆင်မည်</span>
                  </button>

                  <button
                    onClick={handleGenerateChapterAudio}
                    disabled={isGeneratingAudio || !activeChapter.content.trim()}
                    className={`flex-1 sm:flex-none px-6 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all flex items-center justify-center gap-2 shadow-lg ${
                      isGeneratingAudio || !activeChapter.content.trim()
                        ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-black shadow-amber-400/20'
                    }`}
                  >
                    {isGeneratingAudio ? (
                      <>
                        <RefreshCw size={16} className="animate-spin" />
                        <span>အသံထုတ်ယူနေပါသည်...</span>
                      </>
                    ) : (
                      <>
                        <Mic size={16} />
                        <span>အခန်း အသံဖိုင် ဖန်တီးမည်</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Generation Progress Indicator */}
              {isGeneratingAudio && (
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-2 animate-pulse">
                  <div className="flex items-center justify-between text-xs text-amber-300 font-bold">
                    <span>{generationProgress.msg || 'အသံဖိုင် ထုတ်ယူနေပါသည်...'}</span>
                    <span>{generationProgress.current} / {generationProgress.total}</span>
                  </div>
                  <div className="w-full bg-black/40 h-2 rounded-full overflow-hidden">
                    <div 
                      className="bg-amber-400 h-full transition-all duration-300"
                      style={{ width: `${Math.max(10, (generationProgress.current / Math.max(1, generationProgress.total)) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: VOICE NARRATION & TTS */}
      {subTab === 'narration' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Controls Column (5 cols) */}
          <div className="lg:col-span-5 space-y-6">
            {/* Voice Selection */}
            <div className="premium-glass rounded-2xl p-5 border border-white/10 space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
                <Mic size={16} />
                <span>ဇာတ်ကြောင်းပြောသူ အသံရွေးချယ်မှု</span>
              </h3>

              <div className="grid grid-cols-1 gap-2.5">
                {STORY_VOICES.map((v) => {
                  const isSelected = activeChapter.voiceId === v.id;
                  return (
                    <div
                      key={v.id}
                      onClick={() => updateActiveChapter({ voiceId: v.id })}
                      className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                        isSelected
                          ? 'bg-amber-400/20 border-amber-400 text-white shadow-md'
                          : 'bg-white/5 border-white/5 text-slate-300 hover:bg-white/10'
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm">{v.name}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-slate-300">{v.gender}</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">{isMm ? v.descMm : v.descEn}</p>
                      </div>
                      {isSelected && <Check size={18} className="text-amber-400 shrink-0" />}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Story Mood & Emotion */}
            <div className="premium-glass rounded-2xl p-5 border border-white/10 space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
                <Sliders size={16} />
                <span>ဇာတ်လမ်း ရသနှင့် လေသံ (Atmosphere Tone)</span>
              </h3>

              <div className="grid grid-cols-1 gap-2">
                {STORY_MOOD_STYLES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setSelectedMood(m.id)}
                    className={`text-left p-3 rounded-xl border transition-all text-xs ${
                      selectedMood === m.id
                        ? 'bg-amber-400/20 border-amber-400 text-amber-300 font-bold'
                        : 'bg-white/5 border-white/5 text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span>{isMm ? m.labelMm : m.labelEn}</span>
                      {selectedMood === m.id && <Check size={14} />}
                    </div>
                    <p className="text-[10px] text-slate-400 font-normal leading-relaxed">{m.instruction}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Voice Sliders (Speed, Pitch) */}
            <div className="premium-glass rounded-2xl p-5 border border-white/10 space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
                <Sliders size={16} />
                <span>အသံအမြန်နှုန်းနှင့် အမြင့်ချိန်ညှိမှု</span>
              </h3>

              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-xs text-slate-300 mb-1">
                    <span>အသံ အမြန်နှုန်း (Speed)</span>
                    <span className="font-mono text-amber-400 font-bold">{activeChapter.speed}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.7"
                    max="1.4"
                    step="0.05"
                    value={activeChapter.speed}
                    onChange={(e) => {
                      const newSpeed = parseFloat(e.target.value);
                      updateActiveChapter({ speed: newSpeed });
                      if (audioElementRef.current) {
                        audioElementRef.current.playbackRate = newSpeed;
                      }
                    }}
                    className="w-full accent-amber-400 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs text-slate-300 mb-1">
                    <span>အသံ အနိမ့်အမြင့် (Pitch)</span>
                    <span className="font-mono text-amber-400 font-bold">{activeChapter.pitch}</span>
                  </div>
                  <input
                    type="range"
                    min="-4"
                    max="4"
                    step="1"
                    value={activeChapter.pitch}
                    onChange={(e) => updateActiveChapter({ pitch: parseInt(e.target.value) })}
                    className="w-full accent-amber-400 cursor-pointer"
                  />
                </div>
              </div>

              <button
                onClick={handleGenerateChapterAudio}
                disabled={isGeneratingAudio}
                className="w-full py-3 bg-amber-400 hover:bg-amber-300 text-black font-bold rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-amber-400/20"
              >
                {isGeneratingAudio ? <RefreshCw className="animate-spin" size={16} /> : <Mic size={16} />}
                <span>အသံဖိုင် ပြန်လည်ထုတ်ယူမည်</span>
              </button>
            </div>
          </div>

          {/* Right Column: Audio Player & Waveform Visualizer (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            <div className="premium-glass rounded-2xl p-6 sm:p-8 border border-white/10 space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-white/10">
                <div>
                  <span className="text-xs uppercase font-bold text-amber-400 tracking-wider">Audiobook Master Player</span>
                  <h2 className="text-xl font-black text-white mt-1">
                    {project.title} — {activeChapter.title || `အခန်း (${activeChapter.number})`}
                  </h2>
                </div>
                <div className="px-3 py-1 bg-white/10 rounded-full text-xs text-slate-300">
                  Voice: <strong className="text-amber-300 uppercase">{activeChapter.voiceId}</strong>
                </div>
              </div>

              {/* Player Body */}
              {activeChapter.audioResult ? (
                <div className="space-y-6">
                  {/* Waveform Animation */}
                  <div className="h-28 bg-black/50 border border-white/10 rounded-2xl p-4 flex items-center justify-center gap-1 overflow-hidden relative">
                    {Array.from({ length: 42 }).map((_, i) => {
                      const heightPercent = isPlayingAudio 
                        ? Math.max(15, Math.sin((i + audioCurrentTime * 8) * 0.4) * 80 + Math.random() * 20)
                        : 20 + Math.sin(i * 0.3) * 15;
                      return (
                        <div
                          key={i}
                          className={`w-1.5 rounded-full transition-all duration-100 ${
                            isPlayingAudio ? 'bg-amber-400' : 'bg-slate-700'
                          }`}
                          style={{ height: `${heightPercent}%` }}
                        />
                      );
                    })}
                  </div>

                  {/* Seek Bar */}
                  <div className="space-y-1">
                    <input
                      type="range"
                      min="0"
                      max={audioDuration || 100}
                      value={audioCurrentTime}
                      onChange={(e) => {
                        const newTime = parseFloat(e.target.value);
                        setAudioCurrentTime(newTime);
                        if (audioElementRef.current) {
                          audioElementRef.current.currentTime = newTime;
                        }
                      }}
                      className="w-full accent-amber-400 cursor-pointer"
                    />
                    <div className="flex justify-between text-xs text-slate-400 font-mono">
                      <span>{formatMyanmarDuration(audioCurrentTime)}</span>
                      <span>{formatMyanmarDuration(audioDuration || activeChapter.audioResult.duration)}</span>
                    </div>
                  </div>

                  {/* Playback Buttons */}
                  <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleRestartAudio}
                        className="p-3 rounded-full bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-colors"
                        title="ပြန်လည်စတင်ရန်"
                      >
                        <RotateCcw size={18} />
                      </button>

                      <button
                        onClick={togglePlayAudio}
                        className="w-14 h-14 rounded-full bg-amber-400 hover:bg-amber-300 text-black flex items-center justify-center shadow-lg shadow-amber-400/30 transition-all hover:scale-105"
                      >
                        {isPlayingAudio ? <Pause size={24} /> : <Play size={24} className="ml-1" />}
                      </button>

                      <div className="flex items-center gap-2 ml-2">
                        <Volume2 size={16} className="text-slate-400" />
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={audioVolume}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            setAudioVolume(v);
                            if (audioElementRef.current) audioElementRef.current.volume = v;
                          }}
                          className="w-20 accent-amber-400"
                        />
                      </div>
                    </div>

                    {/* Export Actions */}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={handleDownloadWav}
                        className="px-3.5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold flex items-center gap-1.5 transition-colors border border-white/10"
                        title="အသံသီးသန့် WAV ဒေါင်းလုဒ်ဆွဲရန်"
                      >
                        <Download size={14} className="text-amber-400" />
                        <span>Voice WAV</span>
                      </button>

                      <button
                        onClick={handleDownloadMasterMixWav}
                        disabled={isExportingMaster}
                        className="px-3.5 py-2.5 rounded-xl bg-amber-400/20 hover:bg-amber-400/30 text-amber-300 text-xs font-bold flex items-center gap-1.5 transition-colors border border-amber-400/30"
                        title="Voice + BGM ရောစပ်ထားသော Master WAV ဒေါင်းလုဒ်ဆွဲရန်"
                      >
                        {isExportingMaster ? <RefreshCw size={14} className="animate-spin" /> : <Disc size={14} />}
                        <span>Voice + BGM Master</span>
                      </button>

                      <button
                        onClick={handleDownloadSrt}
                        className="px-3.5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold flex items-center gap-1.5 transition-colors border border-white/10"
                        title="SRT စာတန်းထိုးဖိုင် ဒေါင်းလုဒ်ဆွဲရန်"
                      >
                        <FileText size={14} className="text-sky-400" />
                        <span>SRT</span>
                      </button>
                    </div>
                  </div>

                  {/* Ambience Simultaneous Play Indicator */}
                  {activeChapter.ambience !== 'none' && (
                    <div className="p-3.5 rounded-xl bg-black/40 border border-white/10 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 text-slate-300">
                        <Music size={15} className="text-amber-400" />
                        <span>နောက်ခံအသံလှိုင်း: <strong className="text-white">{AMBIENCE_TRACKS.find(t => t.id === activeChapter.ambience)?.nameMm}</strong></span>
                      </div>
                      <button
                        onClick={() => toggleAmbience(activeChapter.ambience)}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                          isPlayingAmbience ? 'bg-amber-400 text-black' : 'bg-white/10 text-white'
                        }`}
                      >
                        {isPlayingAmbience ? 'BGM ဖွင့်ထားသည်' : 'BGM ဖွင့်မည်'}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-12 text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto text-slate-500">
                    <Headphones size={32} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">ဤအခန်းအတွက် အသံဖိုင် မထုတ်ယူရသေးပါ</h3>
                    <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                      "အခန်း အသံဖိုင် ဖန်တီးမည်" ခလုတ်ကို နှိပ်ပြီး ဇာတ်ကြောင်းပြောသူ အသံဖိုင်ကို တိုက်ရိုက်ထုတ်ယူနားဆင်နိုင်ပါသည်။
                    </p>
                  </div>
                  <button
                    onClick={handleGenerateChapterAudio}
                    disabled={isGeneratingAudio || !activeChapter.content.trim()}
                    className="px-6 py-2.5 bg-amber-400 hover:bg-amber-300 text-black font-bold rounded-xl text-xs transition-all inline-flex items-center gap-2 shadow-lg shadow-amber-400/20"
                  >
                    <Mic size={15} />
                    <span>ယခု အသံထုတ်ယူမည်</span>
                  </button>
                </div>
              )}
            </div>

            {/* Script Read-Along Preview */}
            <div className="premium-glass rounded-2xl p-6 border border-white/10 space-y-3">
              <span className="text-xs font-bold text-amber-400 uppercase tracking-wider block">
                ဇာတ်လမ်းစာသား ပြန်လည်စစ်ဆေးရန်
              </span>
              <div className="bg-black/30 rounded-xl p-4 max-h-56 overflow-y-auto custom-scrollbar text-sm text-slate-200 leading-relaxed font-sans whitespace-pre-wrap border border-white/5">
                {activeChapter.content || 'စာသားမရှိသေးပါ'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: BGM & AMBIENCE MIXER */}
      {subTab === 'ambience' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Ambience Tracks Selection (7 cols) */}
          <div className="lg:col-span-7 space-y-4">
            <div className="premium-glass rounded-2xl p-6 border border-white/10 space-y-4">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Music className="text-amber-400" size={20} />
                  <span>နောက်ခံ အသံလှိုင်းနှင့် သီချင်း ရွေးချယ်မှု (BGM Soundscapes)</span>
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  အသံစာအုပ် နားဆင်သူများ စိတ်ခံစားမှု အပြည့်အဝရရှိစေရန် Web Audio နည်းပညာဖြင့် ဖန်တီးထားသော အသံလှိုင်းများကို ရောစပ်အသုံးပြုနိုင်ပါသည်
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                {AMBIENCE_TRACKS.map((track) => {
                  const isCurrent = activeAmbience === track.id;
                  const isPlayingThis = isCurrent && isPlayingAmbience;

                  return (
                    <div
                      key={track.id}
                      onClick={() => {
                        updateActiveChapter({ ambience: track.id });
                        toggleAmbience(track.id);
                      }}
                      className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                        isCurrent
                          ? 'bg-amber-400/20 border-amber-400 text-white shadow-lg'
                          : 'bg-white/5 border-white/5 text-slate-300 hover:bg-white/10'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-2xl">{track.icon}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                            isPlayingThis ? 'bg-amber-400 text-black animate-pulse' : 'bg-white/10 text-slate-400'
                          }`}>
                            {isPlayingThis ? 'PLAYING' : 'READY'}
                          </span>
                        </div>
                        <h4 className="font-bold text-sm text-white pt-2">{track.nameMm}</h4>
                        <p className="text-[11px] text-slate-400 leading-snug">{track.descriptionMm}</p>
                      </div>

                      <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-xs">
                        <span className="text-slate-400 font-mono text-[10px]">{track.name}</span>
                        <span className="text-amber-400 font-bold">{isPlayingThis ? 'Stop' : 'Play Live'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Ambience Mixer Controls (5 cols) */}
          <div className="lg:col-span-5 space-y-6">
            <div className="premium-glass rounded-2xl p-6 border border-white/10 space-y-6">
              <h3 className="text-sm font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
                <Sliders size={16} />
                <span>အသံ ပမာဏ ထိန်းချုပ်မှု (Audio Mixer)</span>
              </h3>

              <div className="space-y-4">
                {/* Ambience Volume */}
                <div>
                  <div className="flex justify-between text-xs text-slate-300 mb-2">
                    <span className="flex items-center gap-1.5 font-bold">
                      <Music size={14} className="text-amber-400" />
                      <span>နောက်ခံ BGM ပမာဏ (Ambience Level)</span>
                    </span>
                    <span className="font-mono text-amber-400 font-bold">{Math.round(ambienceVolume * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.02"
                    value={ambienceVolume}
                    onChange={(e) => handleAmbienceVolumeChange(parseFloat(e.target.value))}
                    className="w-full accent-amber-400 cursor-pointer"
                  />
                </div>

                {/* Voice Volume */}
                <div>
                  <div className="flex justify-between text-xs text-slate-300 mb-2">
                    <span className="flex items-center gap-1.5 font-bold">
                      <Mic size={14} className="text-sky-400" />
                      <span>ဇာတ်ကြောင်းပြောသူ အသံ (Narrator Voice)</span>
                    </span>
                    <span className="font-mono text-sky-400 font-bold">{Math.round(audioVolume * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={audioVolume}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setAudioVolume(v);
                      if (audioElementRef.current) audioElementRef.current.volume = v;
                    }}
                    className="w-full accent-sky-400 cursor-pointer"
                  />
                </div>
              </div>

              {/* Master Play Together Test */}
              <div className="pt-4 border-t border-white/10 space-y-3">
                <span className="text-xs text-slate-400 block font-medium">
                  ဇာတ်ကြောင်းပြောသံနှင့် နောက်ခံအသံလှိုင်းကို အတူတကွ စမ်းသပ်နားဆင်ရန်:
                </span>

                <button
                  onClick={() => {
                    togglePlayAudio();
                    if (!isPlayingAmbience && activeChapter.ambience !== 'none') {
                      toggleAmbience(activeChapter.ambience);
                    }
                  }}
                  className="w-full py-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-amber-400/20"
                >
                  {isPlayingAudio || isPlayingAmbience ? <Pause size={18} /> : <Play size={18} />}
                  <span>{isPlayingAudio || isPlayingAmbience ? 'ရပ်နားမည်' : 'အသံနှင့် BGM အတူတကွ ဖွင့်မည်'}</span>
                </button>

                {activeChapter.audioResult && (
                  <button
                    onClick={handleDownloadMasterMixWav}
                    disabled={isExportingMaster}
                    className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold text-xs transition-all flex items-center justify-center gap-2 border border-white/10"
                  >
                    {isExportingMaster ? <RefreshCw size={14} className="animate-spin" /> : <Disc size={14} className="text-amber-400" />}
                    <span>Voice + BGM Master Mix WAV ထုတ်ယူမည်</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 4: AUDIOBOOK COVER & THUMBNAIL */}
      {subTab === 'cover' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Controls Column (5 cols) */}
          <div className="lg:col-span-5 space-y-5">
            {/* Format Platform Selection */}
            <div className="premium-glass rounded-2xl p-5 border border-white/10 space-y-3">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-400 block">
                ကာဗာ အရွယ်အစား ရွေးချယ်မှု
              </span>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setCoverPlatform('youtube')}
                  className={`p-3 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition-all ${
                    coverPlatform === 'youtube'
                      ? 'bg-amber-400 text-black border-amber-400'
                      : 'bg-white/5 text-slate-300 border-white/5 hover:bg-white/10'
                  }`}
                >
                  <span className="text-sm">📺</span>
                  <span>16:9 YouTube</span>
                </button>

                <button
                  onClick={() => setCoverPlatform('podcast')}
                  className={`p-3 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition-all ${
                    coverPlatform === 'podcast'
                      ? 'bg-amber-400 text-black border-amber-400'
                      : 'bg-white/5 text-slate-300 border-white/5 hover:bg-white/10'
                  }`}
                >
                  <span className="text-sm">🎧</span>
                  <span>1:1 Spotify</span>
                </button>

                <button
                  onClick={() => setCoverPlatform('shorts')}
                  className={`p-3 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition-all ${
                    coverPlatform === 'shorts'
                      ? 'bg-amber-400 text-black border-amber-400'
                      : 'bg-white/5 text-slate-300 border-white/5 hover:bg-white/10'
                  }`}
                >
                  <span className="text-sm">📱</span>
                  <span>9:16 TikTok</span>
                </button>
              </div>
            </div>

            {/* Cover Text Overlays */}
            <div className="premium-glass rounded-2xl p-5 border border-white/10 space-y-4">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-400 block">
                ကာဗာပေါ်ရှိ စာသားများ (Text Overlays)
              </span>

              <div>
                <label className="text-xs text-slate-400 block mb-1">စာအုပ် ခေါင်းစဉ် (Book Title)</label>
                <input
                  type="text"
                  value={coverTitle}
                  onChange={(e) => setCoverTitle(e.target.value)}
                  placeholder="ဇာတ်လမ်းခေါင်းစဉ်"
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">အခန်း Badge (Chapter)</label>
                  <input
                    type="text"
                    value={coverChapterText}
                    onChange={(e) => setCoverChapterText(e.target.value)}
                    placeholder="ဥပမာ- အခန်း (၁)"
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-400 block mb-1">စတူဒီယို Badge (Label)</label>
                  <input
                    type="text"
                    value={coverBadgeText}
                    onChange={(e) => setCoverBadgeText(e.target.value)}
                    placeholder="VlogsBySaw အသံစာအုပ်"
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">စာလုံး စတိုင် (Font Style)</label>
                <select
                  value={coverFontFamily}
                  onChange={(e) => setCoverFontFamily(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-400"
                >
                  <optgroup label="System Fonts">
                    <option value='"Noto Sans Myanmar", sans-serif'>Noto Sans MM (Default)</option>
                    <option value='"Pyidaungsu", serif'>Pyidaungsu</option>
                    <option value='"Myanmar3", sans-serif'>Myanmar3</option>
                  </optgroup>
                  {allMergedFonts.length > 0 && (
                    <optgroup label="Custom / Installed Fonts">
                      {allMergedFonts.map(f => (
                        <option key={f.id} value={`"${f.family}", sans-serif`}>{f.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              {/* Style Presets */}
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">စာလုံး ဒီဇိုင်း စတိုင် (Text Style)</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'gold', label: '👑 ရွှေရောင်' },
                    { id: 'fire', label: '🔥 မီးတောက်' },
                    { id: 'neon', label: '⚡ နီယွန်' },
                    { id: 'diamond', label: '💎 စိန်ရောင်' },
                    { id: 'gothic', label: '🕯️ လျှို့ဝှက်' }
                  ].map(style => (
                    <button
                      key={style.id}
                      onClick={() => setCoverStylePreset(style.id as typeof coverStylePreset)}
                      className={`py-1.5 px-2 rounded-lg text-xs font-bold border transition-all ${
                        coverStylePreset === style.id
                          ? 'bg-amber-400 text-black border-amber-400'
                          : 'bg-white/5 text-slate-300 border-white/5 hover:bg-white/10'
                      }`}
                    >
                      {style.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* AI Image Background Generator or Custom Upload */}
            <div className="premium-glass rounded-2xl p-5 border border-white/10 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-400 block">
                  ကာဗာ နောက်ခံပုံရိပ်
                </span>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-[11px] font-bold text-slate-300 hover:text-amber-300 flex items-center gap-1 transition-colors"
                >
                  <Upload size={13} />
                  <span>ပုံကိုယ်တိုင်တင်မည်</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleCustomImageUpload}
                  style={{ display: 'none' }}
                />
              </div>

              <textarea
                value={coverVisualPrompt}
                onChange={(e) => setCoverVisualPrompt(e.target.value)}
                placeholder="ကာဗာနောက်ခံပုံအတွက် စိတ်ကြိုက် ဇာတ်ကွင်း ရေးသားရန် (ဥပမာ- ရှေးဟောင်းပုဂံဘုရားများနှင့် ရွှေရောင်နေဝင်ချိန်၊ သို့မဟုတ် တိမ်မြူဖုံးနေသော ရှေးဟောင်းသုသာန်)"
                rows={3}
                className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 resize-none leading-relaxed"
              />

              <button
                onClick={handleGenerateCoverArtwork}
                disabled={isGeneratingCover}
                className="w-full py-2.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-black font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-2 shadow-lg shadow-amber-400/20"
              >
                {isGeneratingCover ? <RefreshCw className="animate-spin" size={15} /> : <Sparkles size={15} />}
                <span>AI ကာဗာပုံ ထုတ်ယူမည်</span>
              </button>
            </div>
          </div>

          {/* Right Column: Live Cover Canvas Preview (7 cols) */}
          <div className="lg:col-span-7 space-y-4">
            <div className="premium-glass rounded-2xl p-6 border border-white/10 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-400">Live Cover Preview</span>
                <button
                  onClick={handleDownloadCoverPng}
                  disabled={!finalCoverUrl}
                  className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-black font-bold rounded-xl text-xs transition-all flex items-center gap-2 shadow-md shadow-amber-400/20"
                >
                  <Download size={15} />
                  <span>Download High-Res PNG</span>
                </button>
              </div>

              {/* Cover Preview Container */}
              <div className="w-full bg-black/60 rounded-2xl border border-white/10 p-4 flex items-center justify-center overflow-hidden min-h-[380px]">
                {finalCoverUrl ? (
                  <img
                    src={finalCoverUrl}
                    alt="Audiobook Cover Preview"
                    className="max-h-[480px] w-auto rounded-lg shadow-2xl object-contain border border-white/10"
                  />
                ) : (
                  <div className="text-center text-slate-500 space-y-2">
                    <ImageIcon size={40} className="mx-auto" />
                    <p className="text-xs">ကာဗာ ပုံရိပ် ဖန်တီးနေပါသည်...</p>
                  </div>
                )}
              </div>

              {/* Hidden canvas element */}
              <canvas ref={canvasRef} style={{ display: 'none' }} />
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 5: AI STORY ASSISTANT */}
      {subTab === 'ai' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Controls Column (5 cols) */}
          <div className="lg:col-span-5 space-y-5">
            {/* Outline Input */}
            <div className="premium-glass rounded-2xl p-5 border border-white/10 space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
                <Wand2 size={16} />
                <span>AI ဇာတ်လမ်း အခန်း ရေးသားပေးစနစ်</span>
              </h3>

              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  ဇာတ်လမ်းအကျဉ်းချုပ် သို့မဟုတ် ဖြစ်စဉ်ဖော်ပြချက် ရိုက်ထည့်ပါ
                </label>
                <textarea
                  value={aiPromptOutline}
                  onChange={(e) => setAiPromptOutline(e.target.value)}
                  placeholder="ဥပမာ- ရွာအစွန်ရှိ တောင်ကုန်းဟောင်းပေါ်တွင် လျှို့ဝှက်ရတနာသိုက်ကို ရှာဖွေတွေ့ရှိခြင်း၊ သူငယ်ချင်းသုံးဦး စွန့်စားသွားရောက်ပုံနှင့် မထင်မှတ်သော အန္တရာယ်များနှင့် ရင်ဆိုင်ရပုံ..."
                  rows={6}
                  className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 resize-none leading-relaxed"
                />
              </div>

              <button
                onClick={handleAiGenerateChapter}
                disabled={isAiGenerating || !aiPromptOutline.trim()}
                className="w-full py-2.5 bg-amber-400 hover:bg-amber-300 text-black font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-2 shadow-lg shadow-amber-400/20"
              >
                {isAiGenerating ? <RefreshCw className="animate-spin" size={15} /> : <Sparkles size={15} />}
                <span>အခန်းအပြည့်အစုံ ရေးသားပေးပါ</span>
              </button>
            </div>

            {/* Script Polishers */}
            <div className="premium-glass rounded-2xl p-5 border border-white/10 space-y-3">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-400 block">
                လက်ရှိ စာသားကို အသံစာအုပ်ဟန်ဖြင့် ပြန်ပြင်ရန်
              </span>

              <div className="grid grid-cols-1 gap-2">
                <button
                  onClick={() => handleAiPolishScript('suspense')}
                  disabled={isAiGenerating}
                  className="p-2.5 rounded-xl bg-white/5 hover:bg-amber-400/10 border border-white/5 text-left text-xs text-slate-300 hover:text-amber-300 transition-all flex items-center justify-between"
                >
                  <span>👻 သည်းထိတ်ရင်ဖို ပိုမိုပြင်းထန်စေရန် (Suspense)</span>
                  <ChevronRight size={14} />
                </button>

                <button
                  onClick={() => handleAiPolishScript('emotional')}
                  disabled={isAiGenerating}
                  className="p-2.5 rounded-xl bg-white/5 hover:bg-amber-400/10 border border-white/5 text-left text-xs text-slate-300 hover:text-amber-300 transition-all flex items-center justify-between"
                >
                  <span>🌸 စိတ်ထိခိုက်ဖွယ် ရသပိုမိုပေါ်လွင်စေရန် (Emotional)</span>
                  <ChevronRight size={14} />
                </button>

                <button
                  onClick={() => handleAiPolishScript('bedtime')}
                  disabled={isAiGenerating}
                  className="p-2.5 rounded-xl bg-white/5 hover:bg-amber-400/10 border border-white/5 text-left text-xs text-slate-300 hover:text-amber-300 transition-all flex items-center justify-between"
                >
                  <span>🌙 ညအိပ်ရာဝင် အေးချမ်းသော လေသံဖြစ်စေရန် (Bedtime)</span>
                  <ChevronRight size={14} />
                </button>

                <button
                  onClick={() => handleAiPolishScript('cinematic')}
                  disabled={isAiGenerating}
                  className="p-2.5 rounded-xl bg-white/5 hover:bg-amber-400/10 border border-white/5 text-left text-xs text-slate-300 hover:text-amber-300 transition-all flex items-center justify-between"
                >
                  <span>🎬 ရုပ်ရှင်ဆန်ဆန် ဇာတ်ရှိန်မြင့်တင်ရန် (Cinematic)</span>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: AI Output Preview (7 cols) */}
          <div className="lg:col-span-7 space-y-4">
            <div className="premium-glass rounded-2xl p-6 border border-white/10 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
                  AI ရေးသားပေးထားသော စာသား (Generated Script)
                </span>
                {aiOutputPreview && (
                  <button
                    onClick={handleApplyAiOutput}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-xl text-xs transition-all flex items-center gap-1.5 shadow-md shadow-emerald-500/20"
                  >
                    <Check size={14} />
                    <span>အခန်းထဲသို့ ထည့်သွင်းမည် (Apply)</span>
                  </button>
                )}
              </div>

              <textarea
                value={aiOutputPreview}
                onChange={(e) => setAiOutputPreview(e.target.value)}
                placeholder="AI မှ ရေးသားပေးသော စာသားများ ဤနေရာတွင် ပေါ်လာမည်ဖြစ်ပါသည်။ တည်းဖြတ်ပြင်ဆင်ပြီးပါက 'အခန်းထဲသို့ ထည့်သွင်းမည်' ခလုတ်ကို နှိပ်နိုင်ပါသည်..."
                rows={16}
                className="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-sm sm:text-base text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-400 transition-colors resize-y leading-relaxed font-sans"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
