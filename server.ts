import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "ffmpeg-static";
import { execSync } from "child_process";

// Configure FFmpeg to use the static binary if available
if (ffmpegInstaller) {
  ffmpeg.setFfmpegPath(ffmpegInstaller);
  console.log('[VBS Server] FFmpeg set to static path:', ffmpegInstaller);
}
import { getFirestore } from "firebase-admin/firestore";
import { getAuth, DecodedIdToken } from "firebase-admin/auth";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import firebaseConfig from "./firebase-applet-config.json" with { type: "json" };
import { GoogleGenAI } from "@google/genai";
import { MediaResolverService } from "./src/services/mediaResolverService";
import { SystemConfig } from "./src/types";

// Initialize Firebase Admin
const app = getApps().length 
  ? getApp() 
  : initializeApp({
      projectId: firebaseConfig.projectId,
    });

const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
const auth = getAuth(app);
console.log('Firebase Auth initialized:', !!auth);

// Cache for system configuration
let cachedSystemConfig: SystemConfig | null = null;
let lastConfigFetch = 0;
const CONFIG_CACHE_TTL = 60000; // 1 minute

async function getSystemConfig() {
  const now = Date.now();
  if (cachedSystemConfig && (now - lastConfigFetch < CONFIG_CACHE_TTL)) {
    return cachedSystemConfig;
  }
  try {
    const docSnap = await db.collection('system_config').doc('main').get();
    if (docSnap.exists) {
      cachedSystemConfig = docSnap.data() as SystemConfig;
      lastConfigFetch = now;
      return cachedSystemConfig;
    }
  } catch (err) {
    console.error('[VBS Server] Error fetching system config:', err);
  }
  return cachedSystemConfig || {} as SystemConfig;
}

// Setup Multer for video uploads
const upload = multer({ dest: 'uploads/' });

// Create uploads and output directories if they don't exist
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
if (!fs.existsSync('public/output')) {
  if (!fs.existsSync('public')) fs.mkdirSync('public');
  fs.mkdirSync('public/output');
}

interface AuthenticatedRequest extends express.Request {
  user?: DecodedIdToken;
}

// Middleware to verify Firebase ID Token
const authenticate = async (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
  // Video processing currently doesn't strictly require authentication in this mock-up for ease of use,
  // but in production we'd want it.
  next();
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "500mb" }));
  app.use(express.urlencoded({ limit: "500mb", extended: true }));
  app.use("/output", express.static("public/output"));
  app.use("/worker", express.static("public/worker"));

  // Worker Script Download Routes
  app.get("/api/worker/download/:type", (req, res) => {
    const { type } = req.params;
    let filename = 'vbs-ffmpeg-worker.js';
    if (type === 'bat' || type === 'windows') filename = 'run-worker-windows.bat';
    if (type === 'sh' || type === 'mac' || type === 'linux') filename = 'run-worker-mac-linux.sh';

    const filePath = path.join('public/worker', filename);
    if (fs.existsSync(filePath)) {
      res.download(filePath, filename);
    } else {
      res.status(404).send('File not found');
    }
  });

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "Server is healthy", timestamp: new Date().toISOString() });
  });

  // Worker Health Proxy Endpoint (enables phones/tablets on HTTPS/remote to ping LAN/VPS worker)
  app.get("/api/worker/health", async (req, res) => {
    const targetUrl = (req.query.url as string) || "http://localhost:5005";
    const cleanUrl = targetUrl.trim().replace(/\/+$/, "");
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`${cleanUrl}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      if (response.ok) {
        const data = await response.json();
        return res.json({ ...data, proxied: true });
      }
      return res.status(response.status).json({ status: "offline", error: `HTTP ${response.status}` });
    } catch (err: unknown) {
      return res.json({ status: "offline", error: err instanceof Error ? err.message : "Unreachable" });
    }
  });

  // AssemblyAI Audio/Video Upload Endpoint
  app.post("/api/assemblyai/upload", upload.single("file"), async (req: express.Request, res: express.Response) => {
    const file = req.file;
    const apiKey = (req.headers['x-assemblyai-key'] as string) || 
                   (req.headers['authorization'] as string)?.replace(/^Bearer\s+/i, '') ||
                   process.env.ASSEMBLYAI_API_KEY;

    if (!apiKey) {
      if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(400).json({ error: "AssemblyAI API Key is required." });
    }

    if (!file) {
      return res.status(400).json({ error: "No media file received for upload." });
    }

    try {
      const fileBuffer = fs.readFileSync(file.path);
      const aaiResponse = await fetch("https://api.assemblyai.com/v2/upload", {
        method: "POST",
        headers: {
          "Authorization": apiKey.trim(),
          "Content-Type": "application/octet-stream"
        },
        body: fileBuffer
      });

      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);

      const data = await aaiResponse.json();
      return res.status(aaiResponse.status).json(data);
    } catch (err: unknown) {
      if (file && fs.existsSync(file.path)) {
        try { fs.unlinkSync(file.path); } catch {}
      }
      console.error("[AssemblyAI Server Upload] Error:", err);
      return res.status(500).json({ error: err instanceof Error ? err.message : "AssemblyAI upload failed" });
    }
  });

  // AssemblyAI YouTube / TikTok / Media Link Downloader & Uploader Endpoint
  app.post("/api/assemblyai/resolve-url", async (req: express.Request, res: express.Response) => {
    const { url, cookies } = req.body;
    const apiKey = (req.headers['x-assemblyai-key'] as string) || 
                   (req.headers['authorization'] as string)?.replace(/^Bearer\s+/i, '') ||
                   process.env.ASSEMBLYAI_API_KEY;

    const youtubeCookies = cookies || (req.headers['x-youtube-cookies'] as string);

    if (!apiKey) {
      return res.status(400).json({ error: "AssemblyAI API Key is required." });
    }

    if (!url || typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({ error: "Media URL is required." });
    }

    try {
      const result = await MediaResolverService.resolveAndUploadToAssemblyAI(
        url.trim(), 
        apiKey.trim(), 
        { cookies: typeof youtubeCookies === 'string' ? youtubeCookies : undefined }
      );
      return res.json(result);
    } catch (err: unknown) {
      console.error("[MediaResolver] Error resolving URL:", err);
      const errMsg = err instanceof Error ? err.message : "Failed to extract audio from URL";
      const isBotBlocked = errMsg.includes("YOUTUBE_BOT_DETECTED") || errMsg.includes("bot");
      return res.status(400).json({ 
        error: errMsg,
        isBotBlocked,
        platform: MediaResolverService.isYouTubeUrl(url) ? 'youtube' : (MediaResolverService.isTikTokUrl(url) ? 'tiktok' : 'direct')
      });
    }
  });

  // AssemblyAI Submit Transcription Endpoint
  app.post("/api/assemblyai/transcribe", async (req: express.Request, res: express.Response) => {
    const apiKey = (req.headers['x-assemblyai-key'] as string) || 
                   (req.headers['authorization'] as string)?.replace(/^Bearer\s+/i, '') ||
                   process.env.ASSEMBLYAI_API_KEY;

    if (!apiKey) {
      return res.status(400).json({ error: "AssemblyAI API Key is required." });
    }

    try {
      const aaiResponse = await fetch("https://api.assemblyai.com/v2/transcript", {
        method: "POST",
        headers: {
          "Authorization": apiKey.trim(),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(req.body)
      });

      const data = await aaiResponse.json();
      return res.status(aaiResponse.status).json(data);
    } catch (err: unknown) {
      console.error("[AssemblyAI Server Transcribe] Error:", err);
      return res.status(500).json({ error: err instanceof Error ? err.message : "AssemblyAI transcription submit failed" });
    }
  });

  // AssemblyAI Poll Transcript Status Endpoint
  app.get("/api/assemblyai/transcript/:id", async (req: express.Request, res: express.Response) => {
    const apiKey = (req.headers['x-assemblyai-key'] as string) || 
                   (req.headers['authorization'] as string)?.replace(/^Bearer\s+/i, '') ||
                   process.env.ASSEMBLYAI_API_KEY;

    if (!apiKey) {
      return res.status(400).json({ error: "AssemblyAI API Key is required." });
    }

    try {
      const { id } = req.params;
      const aaiResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
        headers: {
          "Authorization": apiKey.trim()
        }
      });

      const data = await aaiResponse.json();
      return res.status(aaiResponse.status).json(data);
    } catch (err: unknown) {
      console.error("[AssemblyAI Server Poll] Error:", err);
      return res.status(500).json({ error: err instanceof Error ? err.message : "AssemblyAI status check failed" });
    }
  });

  // AssemblyAI Fetch SRT Subtitles Endpoint
  app.get("/api/assemblyai/transcript/:id/srt", async (req: express.Request, res: express.Response) => {
    const apiKey = (req.headers['x-assemblyai-key'] as string) || 
                   (req.headers['authorization'] as string)?.replace(/^Bearer\s+/i, '') ||
                   process.env.ASSEMBLYAI_API_KEY;

    if (!apiKey) {
      return res.status(400).json({ error: "AssemblyAI API Key is required." });
    }

    try {
      const { id } = req.params;
      const aaiResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${id}/srt`, {
        headers: {
          "Authorization": apiKey.trim()
        }
      });

      const srtText = await aaiResponse.text();
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.status(aaiResponse.status).send(srtText);
    } catch (err: unknown) {
      console.error("[AssemblyAI Server SRT] Error:", err);
      return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch SRT subtitles" });
    }
  });

  // Audio Conversion Endpoint (WAV to MP3)
  app.post("/api/audio/convert-to-mp3", upload.single("audio"), async (req: express.Request, res: express.Response) => {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No audio file received" });
    }

    const inputPath = file.path;
    const outputPath = path.join("uploads", `converted_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`);

    try {
      ffmpeg(inputPath)
        .toFormat("mp3")
        .audioBitrate(192)
        .on("end", () => {
          res.download(outputPath, "audio.mp3", (err) => {
            if (err) console.error("[Audio Convert] Send error:", err);
            if (fs.existsSync(inputPath)) {
              try { fs.unlinkSync(inputPath); } catch {}
            }
            if (fs.existsSync(outputPath)) {
              try { fs.unlinkSync(outputPath); } catch {}
            }
          });
        })
        .on("error", (err) => {
          console.error("[Audio Convert] FFmpeg error:", err);
          if (fs.existsSync(inputPath)) {
            try { fs.unlinkSync(inputPath); } catch {}
          }
          if (fs.existsSync(outputPath)) {
            try { fs.unlinkSync(outputPath); } catch {}
          }
          res.status(500).json({ error: "Conversion to MP3 failed" });
        })
        .save(outputPath);
    } catch (err) {
      console.error("[Audio Convert] Route exception:", err);
      if (fs.existsSync(inputPath)) {
        try { fs.unlinkSync(inputPath); } catch {}
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Cross-Device Worker Proxy Endpoint
  // Allows mobile phones, tablets, or other PCs (especially on HTTPS) to utilize the PC / VPS FFmpeg worker
  // without mixed-content restrictions, and provides seamless Server FFmpeg fallback!
  app.post("/api/worker/process", upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'audio', maxCount: 1 },
    { name: 'logo', maxCount: 1 },
    { name: 'fontFile', maxCount: 1 }
  ]), async (req: express.Request, res: express.Response) => {
    let targetUrl = (req.query.url as string) || (req.body.workerUrl as string);
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const videoFile = files?.['video']?.[0];

    if (!videoFile) {
      return res.status(400).json({ success: false, error: "No video file received" });
    }

    const config = await getSystemConfig();
    const globalWorkerUrl = config?.global_worker_url;

    // Smart target selection:
    // If target is localhost (default) and we have a global worker, use global worker for remote users
    if (globalWorkerUrl && (!targetUrl || targetUrl.includes('localhost') || targetUrl.includes('127.0.0.1'))) {
      console.log(`[Worker Proxy] Defaulting to Global Worker: ${globalWorkerUrl}`);
      targetUrl = globalWorkerUrl;
    }

    let proxySucceeded = false;

    if (targetUrl && targetUrl.trim()) {
      const cleanUrl = targetUrl.trim().replace(/\/+$/, '');
      try {
        console.log(`[Worker Proxy] Forwarding render job to: ${cleanUrl}/process`);
        const forwardFormData = new FormData();
        const videoBuffer = fs.readFileSync(videoFile.path);
        forwardFormData.append('video', new Blob([videoBuffer]), videoFile.originalname || 'video.mp4');

        if (files?.['audio']?.[0]) {
          const audioBuf = fs.readFileSync(files['audio'][0].path);
          forwardFormData.append('audio', new Blob([audioBuf]), files['audio'][0].originalname || 'audio.mp3');
        }
        if (files?.['logo']?.[0]) {
          const logoBuf = fs.readFileSync(files['logo'][0].path);
          forwardFormData.append('logo', new Blob([logoBuf]), files['logo'][0].originalname || 'logo.png');
        }
        if (files?.['fontFile']?.[0]) {
          const fontBuf = fs.readFileSync(files['fontFile'][0].path);
          forwardFormData.append('fontFile', new Blob([fontBuf]), files['fontFile'][0].originalname || 'font.ttf');
        }

        for (const [key, val] of Object.entries(req.body)) {
          if (typeof val === 'string') {
            forwardFormData.append(key, val);
          }
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 600000); // Increased to 10 min
        const workerResponse = await fetch(`${cleanUrl}/process`, {
          method: 'POST',
          body: forwardFormData,
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (workerResponse.ok) {
          const workerData = await workerResponse.json();
          if (workerData.success) {
            proxySucceeded = true;
            // Clean up files locally since we've sent them
            for (const fileList of Object.values(files)) {
              for (const f of fileList) {
                try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch {}
              }
            }
            return res.json({ ...workerData, proxied: true });
          }
        }
        console.warn(`[Worker Proxy] Worker response unsuccessful, proceeding with server FFmpeg fallback`);
      } catch (proxyErr) {
        console.warn(`[Worker Proxy] Forwarding to ${cleanUrl} failed; fallback to server FFmpeg:`, proxyErr);
      }
    }

    if (!proxySucceeded) {
      // Direct Server Render Fallback: Internal call to process route logic
      // Instead of redirecting (which triggers a new upload), we call the logic directly
      console.log('[Worker Proxy] Falling back to Internal Server Render...');
      // We pass the already parsed request to a shared logic function
      return await handleVideoProcessInternal(req, res);
    }
  });

  // Re-usable internal logic for video processing to avoid redundant code and redirects
  async function handleVideoProcessInternal(req: express.Request, res: express.Response) {
    console.log('[VBS Video] Processing request (Internal)');
    try {
      // Check if FFmpeg is available
      try {
        if (ffmpegInstaller) {
          // Already set above
        } else {
          execSync('ffmpeg -version', { stdio: 'ignore' });
        }
      } catch (e) {
        console.error('[VBS Video] FFmpeg not found on server:', e);
        return res.json({ success: false, error: 'FFmpeg not found on server. Please use Local PC Worker Engine or contact administrator.' });
      }

      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const videoFile = files?.['video']?.[0];
      const audioFile = files?.['audio']?.[0];
      const logoFile = files?.['logo']?.[0];
      const fontFile = files?.['fontFile']?.[0];

      if (!videoFile) {
        return res.json({ success: false, error: "No video file received" });
      }

      const featuresRaw = req.body.features || "{}";
      const features = typeof featuresRaw === "string" ? JSON.parse(featuresRaw) : featuresRaw;
      const activeFeatureNames = Object.entries(features)
        .filter(([, active]) => active)
        .map(([name]) => name);

      const subtitleText = req.body.subtitleText || "";
      const subtitleSize = req.body.subtitleSize || "medium";
      const pitchShift = parseFloat(req.body.pitchShift || "0");

      const fontFamily = (req.body.fontFamily || "").replace(/['"]/g, '').split(',')[0].trim();
      const fontColor = req.body.fontColor || "#FFFFFF";
      const strokeColor = req.body.strokeColor || "#000000";
      const fontSizeNum = parseInt(req.body.fontSize) || 24;

      const hexToAss = (hex: string, fallback: string) => {
        if (!hex || typeof hex !== 'string') return fallback;
        const clean = hex.replace('#', '').trim();
        if (clean.length === 6) {
          const r = clean.substring(0, 2);
          const g = clean.substring(2, 4);
          const b = clean.substring(4, 6);
          return `&H00${b}${g}${r}`.toUpperCase();
        }
        return fallback;
      };

      const assPrimary = hexToAss(fontColor, '&H00FFFFFF');
      const assOutline = hexToAss(strokeColor, '&H00000000');

      let customFontTempPath: string | null = null;
      let fontDirForAss: string | null = null;

      if (fontFile && fs.existsSync(fontFile.path)) {
        const ext = path.extname(fontFile.originalname || '') || '.ttf';
        const fontNameBase = (fontFamily || 'CustomFont').replace(/[^a-zA-Z0-9_-]/g, '_');
        const fontDir = path.join('/tmp', `fonts_${Date.now()}`);
        try {
          if (!fs.existsSync(fontDir)) fs.mkdirSync(fontDir, { recursive: true });
          customFontTempPath = path.join(fontDir, `${fontNameBase}${ext}`);
          fs.copyFileSync(fontFile.path, customFontTempPath);
          fontDirForAss = fontDir;
        } catch (e) {
          console.warn('[VBS Video] Could not stage custom font:', e);
        }
      }

      const videoSpeed = parseFloat(req.body.videoSpeed || "1.0");
      const audioSpeed = parseFloat(req.body.audioSpeed || "1.0");
      const aspectRatio = req.body.aspectRatio || "16:9";
      const logoPosition = req.body.logoPosition || "top-right";
      const logoOpacity = parseFloat(req.body.logoOpacity || "0.8");
      const logoSize = parseFloat(req.body.logoSize || "0.15");

      const inputPath = videoFile.path;
      const audioInputPath = audioFile?.path;
      const logoInputPath = logoFile?.path;
      const outputFilename = `processed_${Date.now()}.mp4`;
      const finalOutputPath = path.join('public/output', outputFilename);
      const tempOutputPath = path.join('/tmp', outputFilename);

      let hasInputAudio = false;
      try {
        const probeResult = execSync(`ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "${inputPath}"`).toString().trim();
        hasInputAudio = probeResult.includes('audio');
      } catch {
        console.log('[VBS Video] Input video has no audio or probe failed');
      }

      const srtContent = req.body.srtContent || "";
      const hasSubtitles = Boolean(srtContent && typeof srtContent === "string" && srtContent.trim());
      const trimStart = parseFloat(req.body.trimStart || "0");
      const trimEnd = parseFloat(req.body.trimEnd || "0");

      const needsVideoProcessing = 
        activeFeatureNames.includes("flip") || 
        activeFeatureNames.includes("hflip") ||
        activeFeatureNames.includes("vflip") ||
        activeFeatureNames.includes("flipHorizontal") ||
        activeFeatureNames.includes("flipVertical") ||
        activeFeatureNames.includes("crop") ||
        activeFeatureNames.includes("colorGrade") ||
        activeFeatureNames.includes("burnIn") ||
        hasSubtitles ||
        (aspectRatio !== "16:9" && aspectRatio !== "original") ||
        videoSpeed !== 1.0 ||
        Boolean(logoInputPath);

      const command = ffmpeg(inputPath);
      if (trimStart > 0) command.setStartTime(trimStart);
      if (trimEnd > trimStart) command.setDuration(trimEnd - trimStart);
      if (audioInputPath) command.input(audioInputPath);
      if (logoInputPath) command.input(logoInputPath);

      const filterComplex: string[] = [];
      let currentVideoLabel = '0:v';

      if (needsVideoProcessing) {
        const vFilters: string[] = [];
        if (activeFeatureNames.includes("flip") || activeFeatureNames.includes("hflip") || activeFeatureNames.includes("flipHorizontal")) vFilters.push("hflip");
        if (activeFeatureNames.includes("vflip") || activeFeatureNames.includes("flipVertical")) vFilters.push("vflip");
        if (activeFeatureNames.includes("crop")) vFilters.push("crop=iw*0.97:ih*0.97:(iw-iw*0.97)/2:(ih-ih*0.97)/2");
        if (activeFeatureNames.includes("colorGrade")) vFilters.push("eq=contrast=1.1:saturation=1.2:brightness=-0.05");
        
        if (aspectRatio !== "original" && aspectRatio !== "16:9") {
          const resolutions: Record<string, string> = {
            "9:16": "1080:1920", "1:1": "1080:1080", "4:5": "1080:1350", "4:3": "1440:1080", "21:9": "2560:1080"
          };
          const targetResString = resolutions[aspectRatio];
          if (targetResString) {
            const [tw, th] = targetResString.split(':');
            vFilters.push(`scale=${tw}:${th}:force_original_aspect_ratio=decrease,pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`);
          }
        }

        if (videoSpeed !== 1.0) vFilters.push(`setpts=PTS/${videoSpeed}`);

        let tempSrtPath: string | null = null;
        if (hasSubtitles) {
          try {
            tempSrtPath = path.join('/tmp', `sub_${Date.now()}_${Math.random().toString(36).substring(7)}.srt`);
            fs.writeFileSync(tempSrtPath, srtContent, 'utf-8');
            const escapedSrtPath = tempSrtPath.replace(/\\/g, '/').replace(/'/g, "'\\''").replace(/:/g, '\\:');
            const fontNamePart = fontFamily ? `FontName=${fontFamily},` : (fontFile ? '' : 'FontName=Noto Sans Myanmar,');
            const fontsDirPart = fontDirForAss ? `:fontsdir='${fontDirForAss.replace(/\\/g, '/').replace(/'/g, "'\\''")}'` : '';
            vFilters.push(`subtitles='${escapedSrtPath}'${fontsDirPart}:force_style='${fontNamePart}FontSize=${fontSizeNum},PrimaryColour=${assPrimary},OutlineColour=${assOutline},BorderStyle=3,Outline=2.5,MarginV=40'`);
          } catch (srtErr) {
            console.error('[VBS Video] Failed to write temporary SRT file:', srtErr);
          }
        } else if (activeFeatureNames.includes("burnIn") && subtitleText) {
          const fontSizeMap: Record<string, number> = { 'small': 30, 'medium': 45, 'large': 60 };
          const fontSize = fontSizeNum || fontSizeMap[subtitleSize] || 45;
          const chosenFontPath = customFontTempPath || fontFile?.path || '/usr/share/fonts/truetype/noto/NotoSansMyanmar-Regular.ttf';
          const fontArg = fs.existsSync(chosenFontPath) ? `:fontfile='${chosenFontPath.replace(/\\/g, '/').replace(/'/g, "'\\''")}'` : '';
          const escapedText = subtitleText.replace(/'/g, "'\\''").replace(/:/g, "\\:");
          vFilters.push(`drawtext=text='${escapedText}':fontcolor=${fontColor || 'white'}:fontsize=${fontSize}:shadowcolor=black:shadowx=2:shadowy=2:x=(w-text_w)/2:y=h-(h*0.15)${fontArg}`);
        }

        if (vFilters.length > 0) {
          filterComplex.push(`[${currentVideoLabel}]${vFilters.join(',')}[v_proc]`);
          currentVideoLabel = 'v_proc';
        }

        if (logoInputPath) {
          const logoInIdx = audioInputPath ? 2 : 1;
          const logoScale = `scale=iw*${logoSize}:-1,format=rgba,colorchannelmixer=aa=${logoOpacity}`;
          const pos = { 'top-left': '20:20', 'top-right': 'W-w-20:20', 'bottom-left': '20:H-h-20', 'bottom-right': 'W-w-20:H-h-20', 'center': '(W-w)/2:(H-h)/2' }[logoPosition] || 'W-w-20:20';
          filterComplex.push(`[${logoInIdx}:v]${logoScale}[l_ready]`);
          filterComplex.push(`[${currentVideoLabel}][l_ready]overlay=${pos}[v_branded]`);
          currentVideoLabel = 'v_branded';
        }
      }

      let currentAudioLabel = audioInputPath ? '1:a' : (hasInputAudio ? '0:a' : null);
      if (currentAudioLabel) {
        const aFilters: string[] = [];
        if (activeFeatureNames.includes("pitch") && pitchShift !== 0) {
          const factor = Math.pow(2, pitchShift / 12);
          aFilters.push(`asetrate=44100*${factor}`, `atempo=${(1/factor).toFixed(2)}`);
        }
        if (audioSpeed !== 1.0) aFilters.push(`atempo=${audioSpeed.toFixed(2)}`);
        if (aFilters.length > 0) {
          filterComplex.push(`[${currentAudioLabel}]${aFilters.join(',')}[a_proc]`);
          currentAudioLabel = 'a_proc';
        }
      }

      const outputOptions = [
        '-y', '-vcodec', 'libx264', '-acodec', 'aac', '-ar', '44100', '-ac', '2', '-pix_fmt', 'yuv420p',
        '-preset', 'fast', '-crf', '19', '-movflags', '+faststart', '-f', 'mp4'
      ];
      outputOptions.push('-map', filterComplex.length > 0 && currentVideoLabel !== '0:v' ? `[${currentVideoLabel}]` : '0:v');
      if (currentAudioLabel) {
        const finalAudioSource = currentAudioLabel.includes('_proc') ? `[${currentAudioLabel}]` : (audioInputPath ? '1:a:0' : '0:a:0');
        outputOptions.push('-map', finalAudioSource);
        outputOptions.push('-shortest');
      }

      if (filterComplex.length > 0) command.complexFilter(filterComplex);

      command
        .outputOptions(outputOptions)
        .output(tempOutputPath)
        .on('start', (cmd) => console.log('[VBS Video] Executing FFmpeg command:', cmd))
        .on('end', () => {
          try {
            const stats = fs.statSync(tempOutputPath);
            if (stats.size === 0) throw new Error('Processed output file is empty (0 bytes).');
            fs.renameSync(tempOutputPath, finalOutputPath);
            cleanupLocalFiles(files, tempOutputPath);
            res.json({ success: true, downloadUrl: `/output/${outputFilename}` });
          } catch (verifyErr: unknown) {
            console.error('[VBS Video] post-process verification failed:', verifyErr);
            res.status(500).json({ success: false, error: "Output verification failed: " + (verifyErr instanceof Error ? verifyErr.message : String(verifyErr)) });
          }
        })
        .on('error', (err) => {
          console.error('[VBS Video] FFmpeg error:', err);
          cleanupLocalFiles(files, tempOutputPath);
          res.status(500).json({ success: false, error: "FFmpeg execution failed: " + err.message });
        })
        .run();
    } catch (err: unknown) {
      console.error('Global Processing error:', err);
      cleanupLocalFiles(req.files as { [fieldname: string]: Express.Multer.File[] } | undefined);
      res.status(500).json({ success: false, error: "Server Error: " + (err instanceof Error ? err.message : String(err)) });
    }
  }

  function cleanupLocalFiles(files: { [fieldname: string]: Express.Multer.File[] } | undefined, tempOutput?: string) {
    if (!files) return;
    Object.values(files).flat().forEach(f => {
      try { if (f?.path && fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch {}
    });
    if (tempOutput && fs.existsSync(tempOutput)) {
      try { fs.unlinkSync(tempOutput); } catch {}
    }
  }

  // Original Video Processing Endpoint (now uses shared logic)
  app.post("/api/video/process", upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'audio', maxCount: 1 },
    { name: 'logo', maxCount: 1 },
    { name: 'fontFile', maxCount: 1 }
  ]), async (req: express.Request, res: express.Response) => {
    return await handleVideoProcessInternal(req, res);
  });


  // Helper function to recursively convert server-side Buffer objects to Base64 strings for serialization
  function convertBuffersToBase64(obj: unknown): unknown {
    if (!obj) return obj;
    if (Buffer.isBuffer(obj)) {
      return obj.toString("base64");
    }
    if (Array.isArray(obj)) {
      return obj.map(convertBuffersToBase64);
    }
    if (typeof obj === "object") {
      const newObj: Record<string, unknown> = {};
      const objRec = obj as Record<string, unknown>;
      for (const key of Object.keys(objRec)) {
        newObj[key] = convertBuffersToBase64(objRec[key]);
      }
      return newObj;
    }
    return obj;
  }

  // Gemini Proxy Endpoint
  // This allows authorized users to access Gemini via this server.
  // It handles secure server-side API key management for admin keys.
  app.post("/api/gemini/proxy", authenticate, async (req, res) => {
    console.log(`[Proxy] Hit /api/gemini/proxy. Model: ${req.body?.model}, SelectedModel: ${req.body?.selectedModel}`);
    const { model, contents, config, apiKey: providedKey, selectedModel, isTts } = req.body;
    
    let targetModel = selectedModel || model;
    
    if (!targetModel) {
      return res.status(400).json({ error: "Model name is required" });
    }

    // Check if providedKey is plausible format
    const trimmedProvidedKey = typeof providedKey === 'string' ? providedKey.trim() : '';
    const lowerKey = trimmedProvidedKey.toLowerCase();
    const isPlausiblePersonalKey = trimmedProvidedKey.length >= 25 && 
      !lowerKey.startsWith('my_') && 
      !lowerKey.startsWith('my ') && 
      !lowerKey.startsWith('test') && 
      !lowerKey.startsWith('sample') && 
      !lowerKey.startsWith('key_') && 
      !lowerKey.startsWith('gemini_') && 
      !lowerKey.includes('placeholder') && 
      !lowerKey.includes('...');

    const personalKey = isPlausiblePersonalKey ? trimmedProvidedKey : null;

    // Map friendly value to actual production modelName only for TTS requests
    if (isTts) {
      if (targetModel.includes('tts')) {
        targetModel = 'gemini-1.5-flash';
      }
    }

    const executeWithClient = async (ai: GoogleGenAI): Promise<unknown> => {
      const updatedConfig: Record<string, unknown> = config ? { ...config } : {};
      if (isTts) {
        updatedConfig.responseModalities = ["AUDIO"];
      }

      try {
        return await ai.models.generateContent({
          model: targetModel,
          contents,
          config: updatedConfig
        });
      } catch (directErr: unknown) {
        const errMsg = String(directErr);
        const isQuota = errMsg.includes('quota') || errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('resource_exhausted');
        
        if (isQuota) {
          // Standard fallback to high-quota model if primary fails
          if (targetModel !== 'gemini-1.5-flash') {
            console.warn(`[Proxy] Quota exceeded on ${targetModel}, falling back to gemini-1.5-flash`);
            return await ai.models.generateContent({
              model: 'gemini-1.5-flash',
              contents,
              config: updatedConfig
            });
          }
        }
        throw directErr;
      }
    };

    try {
      // 1. If personalKey is provided and plausible, try it first
      if (personalKey) {
        try {
          const ai = new GoogleGenAI({ apiKey: personalKey });
          console.log(`[Proxy] Requesting model: ${targetModel} with Personal Key: ${personalKey.substring(0, 4)}...`);
          const result = await executeWithClient(ai);
          return res.json(convertBuffersToBase64(result));
        } catch (personalKeyErr: unknown) {
          const errMsg = String(personalKeyErr);
          console.warn(`[Proxy] Personal Key failed (${errMsg.substring(0, 100)}...). Falling back to system pool...`);
          // Proceed to system/admin pool fallback below
        }
      }

      // 2. System / Admin Pool Fallback
      const poolKeys: string[] = [];
      if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
        poolKeys.push(process.env.GEMINI_API_KEY.trim());
      }

      try {
        const adminChannelsSnapshot = await db.collection('admin_channels').get();
        adminChannelsSnapshot.docs.forEach(doc => {
          const k = doc.data()?.key;
          if (k && typeof k === 'string') {
            const tk = k.trim();
            const lk = tk.toLowerCase();
            if (tk.length >= 25 && !lk.startsWith('my_') && !lk.startsWith('my ') && !lk.includes('placeholder') && !poolKeys.includes(tk)) {
              poolKeys.push(tk);
            }
          }
        });
      } catch (fsErr: unknown) {
        console.warn("[Proxy] Firestore admin_channels fetch skipped/failed, proceeding with env keys:", (fsErr as Error)?.message || fsErr);
      }

      fs.appendFileSync('/tmp/proxy_debug.log', `[Proxy Call] targetModel: ${targetModel}, poolKeys length: ${poolKeys.length}, env key present: ${!!process.env.GEMINI_API_KEY}\n`);

      if (poolKeys.length === 0) {
        return res.status(400).json({ error: "No API Keys available. Please add one in settings." });
      }

      let lastError = null;
      for (let i = 0; i < poolKeys.length; i++) {
        const currentKey = poolKeys[i];
        try {
          const ai = new GoogleGenAI({ apiKey: currentKey });
          console.log(`[Proxy] Requesting model: ${targetModel} with System/Admin Pool Key (${i + 1}/${poolKeys.length})`);
          
          const result = await executeWithClient(ai);
          return res.json(convertBuffersToBase64(result));
        } catch (err: unknown) {
          lastError = err as Error;
          const errorObj = err as { status?: number; statusCode?: number; response?: { status: number }; message?: string };
          const status = errorObj.status || errorObj.statusCode || (errorObj.response ? errorObj.response.status : 500);
          const errMsg = errorObj.message || "";
          
          fs.appendFileSync('/tmp/proxy_debug.log', `[Pool Key ${i + 1} Failed] key: ${currentKey.substring(0, 6)}... status: ${status}, msg: ${errMsg}\n`);
          console.warn(`[Proxy] Pool key [${i + 1}/${poolKeys.length}] failed: Status ${status}, Message: ${errMsg.substring(0, 100)}... Trying next key...`);
          // Try next pool key for any failure
          continue;
        }
      }
      
      if (lastError) throw lastError;
    } catch (error: unknown) {
      console.error("[Proxy] Gemini Error:", error);
      
      const err = error as { status?: number; statusCode?: number; response?: { status: number }; message?: string };
      
      // Extract status and message from the various error formats Gemini can return
      const status = err.status || err.statusCode || (err.response ? err.response.status : 500);
      let message = err.message || "Failed to call Gemini API";
      if (typeof message === 'string' && message.startsWith('{') && message.includes('"message"')) {
        try {
          const parsed = JSON.parse(message);
          message = parsed.error?.message || parsed.message || message;
        } catch {
          // keep original message
        }
      }
      
      res.status(status).json({ 
        error: message,
        details: error
      });
    }
  });

  // Telegram Notification Endpoint
  app.post("/api/notify-activation", authenticate, async (req, res) => {
    const { email, displayName } = req.body;
    
    let botToken = process.env.TELEGRAM_BOT_TOKEN;
    let chatId = process.env.TELEGRAM_CHAT_ID;

    // Try to get from Firestore if not in env
    try {
      const systemConfigDoc = await db.collection('system_config').doc('main').get();
      if (systemConfigDoc.exists) {
        const data = systemConfigDoc.data();
        if (data?.telegram_bot_token) botToken = data.telegram_bot_token;
        if (data?.telegram_chat_id) chatId = data.telegram_chat_id;
      }
    } catch (err) {
      console.error("Error fetching system config from Firestore:", err);
    }

    if (!botToken || !chatId) {
      console.warn("Telegram configuration missing. Skipping notification.");
      return res.status(200).json({ success: true, message: "Notification skipped (config missing)" });
    }

    const message = `🔔 *New Activation Request*\n\nUser: ${email}\nName: ${displayName}\nTime: ${new Date().toLocaleString()}`;
    
    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'Markdown'
        })
      });

      if (!response.ok) {
        throw new Error(`Telegram API error: ${response.statusText}`);
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error sending Telegram notification:", error);
      res.status(500).json({ error: "Failed to send notification" });
    }
  });

  // Example protected route
  app.get("/api/user/profile", authenticate, async (req: AuthenticatedRequest, res) => {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthenticated' });
    }
    try {
      const userDoc = await db.collection('users').doc(userId).get();
      if (userDoc.exists) {
        res.json(userDoc.data());
      } else {
        res.status(404).json({ error: 'User not found' });
      }
    } catch (err) {
      console.error("Profile fetch error:", err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        hmr: false
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });

  process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
  });
}

startServer();
