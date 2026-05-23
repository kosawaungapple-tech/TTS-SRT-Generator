import React, { useState, useRef, useEffect } from "react";
import { motion } from "motion/react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import {
  Upload,
  Clock,
  Maximize2,
  Image as ImageIcon,
  Ghost,
  Type as Font,
  RotateCcw,
  Download,
  AlertCircle,
  FileVideo,
  CheckCircle2,
  Trash2,
  Settings2,
  Zap,
  Languages,
  Mic2,
  Loader2,
} from "lucide-react";
import { GeminiTTSService } from "../services/geminiService";
import { VOICE_OPTIONS } from "../constants";

// Types
interface ProgressState {
  step: string;
  percent: number;
}

export const VideoStudio: React.FC = () => {
  // Files
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);

  // Preview Logic
  useEffect(() => {
    if (!videoFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(videoFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [videoFile]);
  const [logoFile, setLogoFile] = useState<File | null>(null);

  // Constants for Step 1
  const NARRATION_STYLES = [
    { id: "Movie Recap", name: "🎬 Movie Recap", desc: "Dramatic, fast-paced summary" },
    { id: "Storytelling", name: "📖 Storytelling", desc: "Flowing narrative, emotional" },
    { id: "Documentary", name: "🎙️ Documentary", desc: "Neutral, factual tone" },
    { id: "Entertaining", name: "😄 Entertaining", desc: "Fun, engaging, youth-friendly" },
    { id: "Suspense", name: "🔥 Suspense", desc: "Thriller style, build tension" },
  ];

  // Settings
  const [videoSpeed] = useState(1.05);
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [useDynamicZoom, setUseDynamicZoom] = useState(true);
  const [useFreezeFrame, setUseFreezeFrame] = useState(true);
  const [logoPosition] = useState<"top-right" | "top-left" | "bottom-right" | "bottom-left">("top-right");
  const [useSubtitleBlur, setUseSubtitleBlur] = useState(true);
  const [useSubtitleBurnIn, setUseSubtitleBurnIn] = useState(true);

  // Narration Style State
  const [narrationStyle, setNarrationStyle] = useState("Movie Recap");
  const [narrationTone, setNarrationTone] = useState("");
  const [videoDuration, setVideoDuration] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);

  const getCalculatedTargetDuration = () => {
    if (videoDuration === 0) return "Medium";
    const mins = videoDuration / 60;
    let targetPercent = 0.50;
    if (mins > 30) targetPercent = 0.15;
    else if (mins > 15) targetPercent = 0.25;
    else if (mins > 5) targetPercent = 0.35;
    
    const targetSeconds = Math.round(videoDuration * targetPercent);
    const targetMins = (targetSeconds / 60).toFixed(1);
    return `${targetMins} minutes (${targetSeconds} seconds)`;
  };

  // Workflow State
  const [currentStep, setCurrentStep] = useState<1 | 2>(1);
  const [analysisStatus, setAnalysisStatus] = useState<"idle" | "analyzing" | "ready" | "error">("idle");
  const [analysisProgress, setAnalysisProgress] = useState("");

  // Dubbing State
  const [transcribedText, setTranscribedText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [dubbingVoice, setDubbingVoice] = useState("kore");

  // Processing State
  const [status, setStatus] = useState<"idle" | "loading" | "processing" | "success" | "error">("idle");
  const [progress, setProgress] = useState<ProgressState>({ step: "", percent: 0 });
  const [errorMessage, setErrorMessage] = useState("");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const ffmpegRef = useRef(new FFmpeg());

  // FFmpeg Loading
  useEffect(() => {
    loadFFmpeg();
  }, []);

  const loadFFmpeg = async () => {
    try {
      const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
      const ffmpeg = ffmpegRef.current;
      
      ffmpeg.on("log", ({ message }) => {
        console.log(message);
      });

      ffmpeg.on("progress", ({ progress: p }) => {
        setProgress((prev) => ({ ...prev, percent: Math.round(p * 100) }));
      });

      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
      });
    } catch (err) {
      console.error("FFmpeg Load Error:", err);
      setErrorMessage("FFmpeg load မအောင်မြင်ပါ။");
      setStatus("error");
    }
  };

  const handleVideoUpload = (file: File | null) => {
    setVideoFile(file);
    if (!file) {
      setAnalysisStatus("idle");
      setTranscribedText("");
      setTranslatedText("");
      setCurrentStep(1);
      setVideoDuration(0);
    } else {
      // Get video duration
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        setVideoDuration(video.duration);
        URL.revokeObjectURL(video.src);
      };
      video.src = URL.createObjectURL(file);
    }
  };

  const startAnalysis = async () => {
    if (!videoFile) return;
    setAnalysisStatus("analyzing");
    setErrorMessage("");
    setDownloadUrl(null);
    const gemini = new GeminiTTSService("", false);

    try {
      // Step 1: Transcribe
      setAnalysisProgress("အသံဖတ်နေသည်... (Transcribing)");
      const transcription = await gemini.transcribeVideoFile(videoFile);
      setTranscribedText(transcription);
      
      // Step 2: Translate
      setAnalysisProgress("စာသားပြန်ဆိုနေသည်... (Translating)");
      const translation = await gemini.translateContent(
        transcription,
        narrationStyle,
        narrationTone,
        getCalculatedTargetDuration()
      );
      setTranslatedText(translation);
      
      // Step 3: Generate TTS
      setAnalysisProgress("မြန်မာအသံဖန်တီးနေသည်... (Generating Voice)");
      const result = await gemini.generateTTS(
        translation, 
        {
          voiceId: dubbingVoice,
          speed: 1.0, // Initial generation at 1.0
          pitch: 0,
          volume: 100,
          styleInstruction: `Style: ${narrationStyle}. Tone: ${narrationTone}`
        },
        undefined, // onFirstChunk
        (current, total, message) => {
          setAnalysisProgress(message);
        }
      );
      
      setAudioDuration(result.duration);
      const response = await fetch(result.audioUrl);
      const blob = await response.blob();
      const dubbedFile = new File([blob], "dubbed_audio.wav", { type: "audio/wav" });
      setAudioFile(dubbedFile);
      
      setAnalysisStatus("ready");
    } catch (err: unknown) {
      const error = err as Error;
      setErrorMessage(`Analysis Error: ${error.message}`);
      setAnalysisStatus("error");
    }
  };

  const proceedToStep2 = () => {
    setCurrentStep(2);
  };

  const handleProcess = async () => {
    console.log("[VBS Studio] START button clicked. Preparing data...");
    
    if (!videoFile) {
      console.warn("[VBS Studio] Process aborted: Missing video file");
      setErrorMessage("ဗီဒီယိုဖိုင် မရှိသေးပါ။");
      return;
    }

    if (!audioFile) {
      console.warn("[VBS Studio] Process aborted: Missing audio file");
      setErrorMessage("အသံဖိုင် မရှိသေးပါ။");
      return;
    }

    setStatus("processing");
    setErrorMessage("");
    setDownloadUrl(null);
    setProgress({ step: "ဗီဒီယိုပေးပို့နေသည် (Compressing & Uploading)...", percent: 5 });

    try {
      const formData = new FormData();
      formData.append("video", videoFile);
      formData.append("audio", audioFile);
      if (logoFile) formData.append("logo", logoFile);
      
      const durationSpeed = audioDuration > 0 && videoDuration > 0 ? (audioDuration / videoDuration) : 1.0;
      
      const features = {
        dynamicZoom: useDynamicZoom,
        freezeFrame: useFreezeFrame,
        blur: useSubtitleBlur,
        burnIn: useSubtitleBurnIn
      };
      
      formData.append("features", JSON.stringify(features));
      formData.append("subtitleText", translatedText);
      formData.append("aspectRatio", aspectRatio);
      formData.append("videoSpeed", videoSpeed.toString());
      formData.append("audioSpeed", durationSpeed.toString());
      formData.append("logoPosition", logoPosition);

      console.log("[VBS Studio] Calling API /api/video/process with:", {
        video: videoFile.name,
        audio: audioFile.name,
        aspectRatio,
        audioSpeed: durationSpeed.toFixed(3),
        features
      });

      const response = await fetch("/api/video/process", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown server error" }));
        throw new Error(errorData.error || `Server responded with ${response.status}`);
      }

      setProgress({ step: "ဗီဒီယိုပြင်ဆင်ပြီးပါပြီ။ ဖိုင်ထုတ်ယူနေသည်...", percent: 90 });
      
      const result = await response.json();
      console.log("[VBS Studio] API Response success:", result);

      if (result.success && result.downloadUrl) {
        setDownloadUrl(result.downloadUrl);
        setStatus("success");
        setProgress({ step: "ပြီးဆုံးပါပြီ", percent: 100 });
      } else {
        throw new Error("Download URL not found in response");
      }
    } catch (err: unknown) {
      const error = err as Error;
      console.error("[VBS Studio] Processing Error:", error);
      setErrorMessage("Processing Error: " + error.message);
      setStatus("error");
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-200 py-12 px-4 selection:bg-amber-500/30">
      <div className="max-w-5xl mx-auto space-y-12">
        {/* Header */}
        <div className="text-center space-y-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs font-black uppercase tracking-widest"
          >
            <Zap size={14} className="animate-pulse" />
            <span>AI Powered Video Editor</span>
          </motion.div>
          <h1 className="text-4xl md:text-6xl font-black tracking-tighter text-white">
            Video <span className="text-amber-500 font-serif italic">Studio</span>
          </h1>
          <p className="text-slate-400 font-medium">Professional Video Recap Tools (Myanmar)</p>
        </div>

        {/* Workflow Steps Indicator */}
        <div className="flex items-center justify-center gap-4">
          <div className={`px-6 py-2 rounded-full text-xs font-black uppercase tracking-widest border transition-all ${currentStep === 1 ? "bg-amber-500 border-amber-500 text-black shadow-lg shadow-amber-500/20" : "bg-white/5 border-white/10 text-slate-500"}`}>
            Step 1: ဆန်းစစ်မည် (Analyze)
          </div>
          <div className="w-8 h-px bg-white/10" />
          <div className={`px-6 py-2 rounded-full text-xs font-black uppercase tracking-widest border transition-all ${currentStep === 2 ? "bg-amber-500 border-amber-500 text-black shadow-lg shadow-amber-500/20" : "bg-white/5 border-white/10 text-slate-500"}`}>
            Step 2: ပြုလုပ်မည် (Process)
          </div>
        </div>

        {currentStep === 1 ? (
          /* STEP 1: ANALYZE */
          <div className="max-w-4xl mx-auto space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
              {/* Left Column: Upload & Options */}
              <div className="md:col-span-12 lg:col-span-7 space-y-6">
                {!videoFile ? (
                  <div className="bg-white/[0.03] border border-white/5 rounded-[40px] p-8 shadow-2xl relative overflow-hidden group">
                    <label className="flex flex-col items-center justify-center py-20 cursor-pointer text-center relative z-10">
                      <div className="w-20 h-20 bg-amber-500/10 rounded-3xl flex items-center justify-center text-amber-500 mb-6 group-hover:scale-110 transition-transform">
                        <Upload size={40} />
                      </div>
                      <h3 className="text-xl font-bold text-white mb-2">ဗီဒီယိုဖိုင် ရွေးချယ်ပါ</h3>
                      <p className="text-slate-500 text-sm">ဇာတ်လမ်းပြော အသံများကို AI ဖြင့် ဆန်းစစ်မည်</p>
                      <input type="file" accept="video/*" className="hidden" onChange={(e) => handleVideoUpload(e.target.files?.[0] || null)} />
                    </label>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Video Info Card */}
                    <div className="bg-white/[0.03] border border-white/5 rounded-[40px] p-6 shadow-2xl relative overflow-hidden group">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-amber-500/10 rounded-2xl flex items-center justify-center text-amber-500">
                            <FileVideo size={24} />
                          </div>
                          <div>
                            <p className="text-white font-bold truncate max-w-[200px]">{videoFile.name}</p>
                            <p className="text-slate-500 text-xs font-bold uppercase">{(videoFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                          </div>
                        </div>
                        {analysisStatus !== "analyzing" && (
                          <button onClick={() => handleVideoUpload(null)} className="p-2 hover:bg-rose-500/10 hover:text-rose-500 transition-colors rounded-xl">
                            <Trash2 size={20} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Narration Style Options */}
                    <div className="bg-white/[0.03] border border-white/5 rounded-[40px] p-8 shadow-2xl space-y-6">
                      <div className="flex items-center gap-3 mb-2">
                        <Mic2 size={20} className="text-amber-500" />
                        <h3 className="text-lg font-black text-white uppercase tracking-tight">Narration Style</h3>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest pl-1 flex items-center gap-2">
                            <Maximize2 size={12} /> Narration Style
                          </label>
                          <select 
                            value={narrationStyle}
                            onChange={(e) => setNarrationStyle(e.target.value)}
                            className="w-full bg-black/40 border border-white/10 rounded-2xl px-4 py-3 text-sm font-bold text-white focus:outline-none focus:border-amber-500"
                          >
                            {NARRATION_STYLES.map(s => (
                              <option key={s.id} value={s.id}>{s.name} - {s.desc}</option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-2">
                          <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest pl-1 flex items-center gap-2">
                            <Clock size={12} /> Target Duration (Auto)
                          </label>
                          <div className="w-full bg-white/5 border border-white/5 rounded-2xl px-4 py-3 text-sm font-bold text-amber-500/80">
                            {getCalculatedTargetDuration()}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest pl-1">Tone Instructions (Optional)</label>
                        <textarea
                          placeholder="ဇာတ်လမ်းကို စိတ်လှုပ်ရှားစေအောင် ပြောပြပါ..."
                          value={narrationTone}
                          onChange={(e) => setNarrationTone(e.target.value)}
                          className="w-full h-24 bg-black/40 border border-white/5 rounded-2xl p-4 text-xs text-white focus:outline-none focus:border-amber-500/50 resize-none transition-all placeholder:text-slate-600"
                        />
                      </div>

                      <div className="pt-4">
                        <button
                          disabled={analysisStatus === "analyzing"}
                          onClick={startAnalysis}
                          className="w-full py-4 bg-amber-500 text-black rounded-2xl font-black uppercase tracking-tight shadow-xl hover:bg-amber-400 active:scale-95 transition-all shadow-amber-500/20 flex items-center justify-center gap-3"
                        >
                          {analysisStatus === "analyzing" ? (
                            <Loader2 size={24} className="animate-spin" />
                          ) : (
                            <Zap size={24} />
                          )}
                          ဆန်းစစ်မည် (ANALYZE)
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Analysis Progress & Result */}
              <div className="md:col-span-12 lg:col-span-5">
                {(analysisStatus !== "idle" || transcribedText || translatedText) && (
                  <div className="space-y-6">
                    {analysisStatus === "analyzing" && (
                      <div className="bg-white/[0.03] border border-white/5 rounded-[40px] p-8 shadow-2xl flex flex-col items-center justify-center gap-6 min-h-[300px]">
                        <div className="relative w-20 h-20">
                          <Loader2 size={80} className="text-amber-500 animate-spin opacity-20" />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Mic2 size={32} className="text-amber-500 animate-pulse" />
                          </div>
                        </div>
                        <div className="text-center space-y-2">
                          <p className="text-xl font-bold text-white animate-pulse">{analysisProgress}</p>
                          <p className="text-xs text-slate-500 font-medium tracking-wide">ခေတ္တခဏ စောင့်ဆိုင်းပေးပါ...</p>
                        </div>
                        <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                          <motion.div 
                            className="h-full bg-amber-500"
                            animate={{ x: ["-100%", "100%"] }}
                            transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                          />
                        </div>
                      </div>
                    )}

                    {analysisStatus === "ready" && (
                      <motion.div 
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="bg-white/[0.03] border border-white/5 rounded-[40px] p-8 shadow-2xl space-y-6"
                      >
                        <div className="flex items-center gap-3">
                          <CheckCircle2 size={24} className="text-emerald-500" />
                          <h3 className="text-lg font-black text-white uppercase tracking-tight">Review Translation</h3>
                        </div>

                        <div className="space-y-3">
                          <span className="text-[10px] font-black uppercase text-amber-500 tracking-widest pl-1 flex items-center justify-between">
                            Myanmar Narration Script
                            <button onClick={startAnalysis} className="text-xs font-bold text-slate-500 hover:text-amber-500 transition-colors">Regenerate</button>
                          </span>
                          <textarea
                            value={translatedText}
                            onChange={(e) => setTranslatedText(e.target.value)}
                            className="w-full h-64 bg-black/40 border border-amber-500/20 rounded-3xl p-6 text-sm text-white focus:outline-none focus:border-amber-500/50 resize-none font-medium leading-relaxed shadow-inner"
                          />
                        </div>

                        <div className="space-y-4">
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest pl-1">Narration Voice</span>
                            <select 
                              value={dubbingVoice}
                              onChange={(e) => setDubbingVoice(e.target.value)}
                              className="bg-black/40 border border-white/10 rounded-2xl px-4 py-3 text-sm font-bold text-white focus:outline-none focus:border-amber-500"
                            >
                              {VOICE_OPTIONS.map(v => (
                                <option key={v.id} value={v.id}>{v.name}</option>
                              ))}
                            </select>
                          </div>
                          
                          <button
                            onClick={proceedToStep2}
                            className="w-full py-5 bg-gradient-to-r from-amber-500 to-amber-600 text-black rounded-[32px] font-black uppercase tracking-tight shadow-xl hover:from-amber-400 hover:to-amber-500 active:scale-95 transition-all shadow-amber-500/20 flex items-center justify-center gap-3 group"
                          >
                            <span>ဆက်လုပ်မည် (NEXT STEP)</span>
                            <RotateCcw size={20} className="rotate-180 group-hover:translate-x-1 transition-transform" />
                          </button>
                        </div>
                      </motion.div>
                    )}

                    {analysisStatus === "error" && (
                      <div className="p-8 bg-rose-500/10 border border-rose-500/20 rounded-[40px] flex flex-col items-center gap-4 text-rose-500 text-center">
                        <AlertCircle size={48} className="opacity-50" />
                        <div className="space-y-1">
                          <p className="text-lg font-bold">Analysis Failed</p>
                          <p className="text-xs opacity-70 max-w-[200px] mx-auto leading-relaxed">{errorMessage}</p>
                        </div>
                        <button onClick={startAnalysis} className="mt-2 px-8 py-3 bg-rose-500 text-white rounded-2xl text-xs font-black uppercase tracking-widest transition-transform active:scale-95 shadow-lg shadow-rose-500/20">Retry Analysis</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* STEP 2: PROCESS */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start text-left">
            {/* Left: Preview */}
            <div className="lg:col-span-7 space-y-6">
              {previewUrl && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white/[0.03] border border-white/5 rounded-[40px] p-6 shadow-2xl space-y-4"
                >
                  <div className="aspect-video bg-black rounded-3xl overflow-hidden border border-white/5 shadow-inner">
                    <video src={previewUrl} controls className="w-full h-full object-contain" />
                  </div>
                </motion.div>
              )}

              <button 
                onClick={() => setCurrentStep(1)}
                className="flex items-center gap-2 text-xs font-black uppercase text-slate-500 hover:text-amber-500 transition-colors"
              >
                <RotateCcw size={14} />
                Back to Analysis
              </button>
            </div>

            {/* Right: Controls */}
            <div className="lg:col-span-5 space-y-6">
              <div className="bg-white/[0.03] border border-white/5 rounded-[40px] p-8 shadow-2xl space-y-8">
                <div className="flex items-center gap-3">
                  <Settings2 size={20} className="text-amber-500" />
                  <h3 className="text-lg font-black text-white uppercase tracking-tight">Final Settings</h3>
                </div>

                <div className="space-y-4">
                  <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Aspect Ratio</span>
                  <select 
                    value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value as "16:9" | "9:16" | "1:1")}
                    className="w-full bg-black/40 border border-white/5 rounded-2xl px-4 py-3 text-sm font-bold focus:outline-none focus:border-amber-400"
                  >
                    <option value="16:9">YouTube (16:9)</option>
                    <option value="9:16">Short/TikTok (9:16)</option>
                    <option value="1:1">Square (1:1)</option>
                  </select>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  {[
                    { state: useDynamicZoom, set: setUseDynamicZoom, label: "Dynamic Zoom", icon: Maximize2 },
                    { state: useFreezeFrame, set: setUseFreezeFrame, label: "Freeze Pattern", icon: Ghost },
                    { state: useSubtitleBlur, set: setUseSubtitleBlur, label: "Subtitle Blur", icon: Languages },
                    { state: useSubtitleBurnIn, set: setUseSubtitleBurnIn, label: "Subtitle Burn-in", icon: Font },
                  ].map((item) => (
                    <button 
                      key={item.label}
                      onClick={() => item.set(!item.state)}
                      className={`flex items-center justify-between p-4 rounded-3xl border transition-all ${item.state ? "bg-amber-500/10 border-amber-500/40 text-amber-400" : "bg-white/5 border-white/5 text-slate-500 opacity-60"}`}
                    >
                      <div className="flex items-center gap-3">
                        <item.icon size={18} />
                        <span className="text-[10px] font-black uppercase">{item.label}</span>
                      </div>
                      <div className={`w-8 h-4 rounded-full relative transition-colors ${item.state ? "bg-amber-500" : "bg-white/10"}`}>
                        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${item.state ? "right-0.5" : "left-0.5"}`} />
                      </div>
                    </button>
                  ))}
                </div>

                {/* Logo Upload */}
                <div className="space-y-4 pt-4 border-t border-white/5">
                  <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest pl-1">Brand Logo (Optional)</span>
                  {!logoFile ? (
                    <label className="flex items-center gap-3 px-4 py-4 bg-white/5 border border-white/5 rounded-2xl cursor-pointer hover:bg-white/10 transition-colors">
                      <ImageIcon size={18} className="text-cyan-500" />
                      <span className="text-xs font-bold uppercase">Upload Logo</span>
                      <input type="file" accept="image/png" className="hidden" onChange={(e) => setLogoFile(e.target.files?.[0] || null)} />
                    </label>
                  ) : (
                    <div className="flex items-center justify-between px-4 py-3 bg-cyan-500/5 border border-cyan-500/20 rounded-2xl">
                      <span className="text-xs font-bold truncate max-w-[150px]">{logoFile.name}</span>
                      <button onClick={() => setLogoFile(null)} className="text-rose-500 hover:text-rose-400 leading-none">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Process Button / Progress */}
                <div className="pt-4">
                  {status === "processing" ? (
                    <div className="space-y-4">
                      <div className="flex justify-between items-center text-xs font-black uppercase text-amber-500 tracking-widest">
                         <span>{progress.step}</span>
                         <span>{progress.percent}%</span>
                      </div>
                      <div className="w-full h-3 bg-white/5 rounded-full overflow-hidden">
                        <motion.div 
                          className="h-full bg-amber-500"
                          initial={{ width: 0 }}
                          animate={{ width: `${progress.percent}%` }}
                        />
                      </div>
                    </div>
                  ) : status === "success" && downloadUrl ? (
                    <div className="space-y-4">
                      <a href={downloadUrl} download="recap_video.mp4" className="w-full py-4 bg-emerald-500 text-black rounded-2xl flex items-center justify-center gap-3 font-black uppercase tracking-tight shadow-xl hover:bg-emerald-400 transition-all shadow-emerald-500/20">
                        <Download size={20} />
                        Download Video
                      </a>
                      <button onClick={() => setStatus("idle")} className="w-full py-4 bg-white/5 text-white rounded-2xl font-black uppercase border border-white/10 hover:bg-white/10">
                        Edit More
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <button 
                        disabled={!videoFile || !audioFile || status === "processing"}
                        onClick={handleProcess}
                        className="w-full py-5 bg-amber-500 disabled:bg-white/5 disabled:text-slate-600 text-black rounded-[32px] flex items-center justify-center gap-3 font-black text-lg uppercase tracking-tighter shadow-2xl hover:bg-amber-400 active:scale-95 transition-all shadow-amber-500/20"
                      >
                        {status === "processing" ? <Loader2 className="animate-spin" size={24} /> : <Zap size={24} />}
                        {status === "processing" ? "လုပ်ဆောင်နေပါသည်..." : "ပြုလုပ်မည် (START)"}
                      </button>
                      {(!videoFile || !audioFile) && (
                        <p className="text-[10px] font-bold text-center text-rose-500 uppercase tracking-widest animate-pulse">
                          {!videoFile ? "Video မရှိသေးပါ (No Video)" : "အသံမထုတ်ရသေးပါ (No Audio)"}
                        </p>
                      )}
                      {errorMessage && (
                        <p className="text-[10px] font-bold text-center text-rose-500 uppercase tracking-tight">
                          Error: {errorMessage}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
