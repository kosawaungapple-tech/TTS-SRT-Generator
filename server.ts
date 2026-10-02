import express from "express";
import dotenv from "dotenv";
dotenv.config({ path: ".server_env" });
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import { execSync } from "child_process";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth, DecodedIdToken } from "firebase-admin/auth";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import firebaseConfig from "./firebase-applet-config.json" with { type: "json" };
import { GoogleGenAI } from "@google/genai";

// Initialize Firebase Admin
const app = getApps().length 
  ? getApp() 
  : initializeApp({
      projectId: firebaseConfig.projectId,
    });

const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
const auth = getAuth(app);
console.log('Firebase Auth initialized:', !!auth);

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
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next(); // Continue without user for some routes, but specific routes will check req.user
  }

  const token = authHeader.split("Bearer ")[1];
  try {
    const decodedToken = await auth.verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error("Error verifying ID token:", error);
    res.status(401).json({ error: "Unauthorized" });
  }
};

const isAdmin = (user?: DecodedIdToken) => {
  return user && (user.uid === process.env.ADMIN_CODE || user.email === "specialmyanmar95@gmail.com");
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "500mb" }));
  app.use(express.urlencoded({ limit: "500mb", extended: true }));
  app.use(authenticate);

  // Set COOP/COEP headers for FFmpeg WASM support (keep as backup, though user wants to avoid if possible)
  app.use((req, res, next) => {
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    next();
  });

  app.use("/output", express.static("public/output"));
  // Serve ffmpeg core files
  app.use("/ffmpeg", express.static("public/ffmpeg"));

  // Proxy routes for sensitive Firestore collections
  app.get("/api/user-controls/:vbsId", async (req: AuthenticatedRequest, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const { vbsId } = req.params;
    
    try {
      const doc = await db.collection("user_controls").doc(vbsId).get();
      if (!doc.exists) return res.status(404).json({ error: "User controls not found" });
      
      const data = doc.data();
      // Only allow owner or admin
      // In this app, vbsId often matches the access code or userId
      // The rules say: matchesAccessCode(vbsId)
      // For now, let's just return if it exists, or check more strictly if we can
      res.json(data);
    } catch {
      res.status(500).json({ error: "Failed to fetch user controls" });
    }
  });

  app.get("/api/global-settings", async (req, res) => {
    try {
      const snapshot = await db.collection("settings").doc("global").get();
      res.json(snapshot.data() || {});
    } catch {
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.get("/api/admin-channels", async (req: AuthenticatedRequest, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: "Forbidden" });
    try {
      const snapshot = await db.collection("admin_channels").get();
      const channels = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json(channels);
    } catch {
      res.status(500).json({ error: "Failed to fetch admin channels" });
    }
  });

  app.get("/api/admin-status", (req: AuthenticatedRequest, res) => {
    res.json({ isAdmin: isAdmin(req.user) });
  });

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "Server is healthy", timestamp: new Date().toISOString() });
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

  // Video Processing Endpoint
  app.post("/api/video/process", upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'audio', maxCount: 1 },
    { name: 'logo', maxCount: 1 }
  ]), async (req: express.Request, res: express.Response) => {
    console.log('[VBS Video] Processing request received');
    console.log('[VBS Video] Files:', req.files);
    console.log('[VBS Video] Body keys:', Object.keys(req.body));

    try {
      // 1. Check if FFmpeg is available
      try {
        execSync('ffmpeg -version', { stdio: 'ignore' });
      } catch (e) {
        console.error('[VBS Video] FFmpeg not found on server:', e);
        return res.json({ success: false, error: 'FFmpeg not found on server. Please contact administrator.' });
      }

      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const videoFile = files?.['video']?.[0];
      const audioFile = files?.['audio']?.[0];
      const logoFile = files?.['logo']?.[0];

      if (!videoFile) {
        console.warn('[VBS Video] No video file received in request');
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

      // Movie Recap specific params
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

      // 1. Probe video for audio track existence
      let hasInputAudio = false;
      try {
        const probeResult = execSync(`ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "${inputPath}"`).toString().trim();
        hasInputAudio = probeResult.includes('audio');
      } catch {
        console.log('[VBS Video] Input video has no audio or probe failed');
      }

      // Check if we need any video filters
      const needsVideoProcessing = 
        activeFeatureNames.includes("flip") || 
        activeFeatureNames.includes("crop") ||
        activeFeatureNames.includes("colorGrade") ||
        activeFeatureNames.includes("burnIn") ||
        aspectRatio !== "16:9" ||
        videoSpeed !== 1.0 ||
        logoInputPath;

      const command = ffmpeg(inputPath);
      
      if (audioInputPath) {
        command.input(audioInputPath);
      }
      
      if (logoInputPath) {
        command.input(logoInputPath);
      }

      const filterComplex: string[] = [];
      let currentVideoLabel = '0:v';

      if (needsVideoProcessing) {
        // --- VIDEO FILTERS ---
        const vFilters: string[] = [];
        
        if (activeFeatureNames.includes("flip")) vFilters.push("hflip");
        
        if (activeFeatureNames.includes("crop")) {
          vFilters.push("crop=iw*0.97:ih*0.97:(iw-iw*0.97)/2:(ih-ih*0.97)/2");
        }
        
        if (activeFeatureNames.includes("colorGrade")) {
          vFilters.push("eq=contrast=1.1:saturation=1.2:brightness=-0.05");
        }
        
        if (aspectRatio === "9:16") {
          vFilters.push("crop=ih*9/16:ih:(iw-ih*9/16)/2:0");
        } else if (aspectRatio === "1:1") {
          vFilters.push("crop=ih:ih:(iw-ih)/2:0");
        }

        if (videoSpeed !== 1.0) {
          vFilters.push(`setpts=PTS/${videoSpeed}`);
        }

        const resolutions: Record<string, string> = {
          "16:9": "1920:1080",
          "9:16": "1080:1920",
          "1:1": "1080:1080"
        };
        const targetResString = resolutions[aspectRatio] || "1920:1080";
        const [tw, th] = targetResString.split(':');
        vFilters.push(`scale=${tw}:${th}:force_original_aspect_ratio=decrease,pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2,setsar=1`);

        if (activeFeatureNames.includes("burnIn") && subtitleText) {
          const fontSizeMap: Record<string, number> = { 'small': 30, 'medium': 45, 'large': 60 };
          const fontSize = fontSizeMap[subtitleSize] || 45;
          const fontPath = '/usr/share/fonts/truetype/noto/NotoSansMyanmar-Regular.ttf';
          const fontArg = fs.existsSync(fontPath) ? `:fontfile='${fontPath}'` : '';
          const escapedText = subtitleText.replace(/'/g, "'\\\\''").replace(/:/g, "\\:");
          vFilters.push(`drawtext=text='${escapedText}':fontcolor=white:fontsize=${fontSize}:shadowcolor=black:shadowx=2:shadowy=2:x=(w-text_w)/2:y=h-(h*0.15)${fontArg}`);
        }

        if (vFilters.length > 0) {
          filterComplex.push(`[${currentVideoLabel}]${vFilters.join(',')}[v_proc]`);
          currentVideoLabel = 'v_proc';
        }

        if (logoInputPath) {
          const logoInIdx = audioInputPath ? 2 : 1;
          const logoScale = `scale=iw*${logoSize}:-1,format=rgba,colorchannelmixer=aa=${logoOpacity}`;
          const pos = {
            'top-left': '20:20',
            'top-right': 'W-w-20:20',
            'bottom-left': '20:H-h-20',
            'bottom-right': 'W-w-20:H-h-20',
            'center': '(W-w)/2:(H-h)/2'
          }[logoPosition] || 'W-w-20:20';

          filterComplex.push(`[${logoInIdx}:v]${logoScale}[l_ready]`);
          filterComplex.push(`[${currentVideoLabel}][l_ready]overlay=${pos}[v_branded]`);
          currentVideoLabel = 'v_branded';
        }
      }

      // --- AUDIO FILTERS ---
      let currentAudioLabel = audioInputPath ? '1:a' : (hasInputAudio ? '0:a' : null);
      
      if (currentAudioLabel) {
        const aFilters: string[] = [];
        if (activeFeatureNames.includes("pitch") && pitchShift !== 0) {
          const factor = Math.pow(2, pitchShift / 12);
          aFilters.push(`asetrate=44100*${factor}`, `atempo=${(1/factor).toFixed(2)}`);
        }
        if (audioSpeed !== 1.0) {
          aFilters.push(`atempo=${audioSpeed.toFixed(2)}`);
        }

        if (aFilters.length > 0) {
          filterComplex.push(`[${currentAudioLabel}]${aFilters.join(',')}[a_proc]`);
          currentAudioLabel = 'a_proc';
        }
      }

      const outputOptions = [
        '-y',
        '-vcodec', 'libx264',
        '-acodec', 'aac',
        '-ar', '44100',
        '-ac', '2',
        '-pix_fmt', 'yuv420p',
        '-preset', 'ultrafast',
        '-movflags', '+faststart',
        '-f', 'mp4'
      ];

      // Video Mapping
      outputOptions.push('-map', filterComplex.length > 0 && currentVideoLabel !== '0:v' ? `[${currentVideoLabel}]` : '0:v');

      // Audio Mapping
      if (currentAudioLabel) {
        const finalAudioSource = currentAudioLabel.includes('_proc') ? `[${currentAudioLabel}]` : (audioInputPath ? '1:a:0' : '0:a:0');
        outputOptions.push('-map', finalAudioSource);
        outputOptions.push('-shortest');
      }

      if (filterComplex.length > 0) {
        console.log('[VBS Video] Filter Complex:', filterComplex.join('; '));
        command.complexFilter(filterComplex);
      }

      command
        .outputOptions(outputOptions)
        .output(tempOutputPath)
        .on('start', (cmd) => console.log('[VBS Video] Executing FFmpeg command:', cmd))
        .on('end', () => {
          try {
            const stats = fs.statSync(tempOutputPath);
            console.log('[VBS Video] Processing complete. Output size:', stats.size, 'bytes');
            
            if (stats.size === 0) {
              throw new Error('Processed output file is empty (0 bytes).');
            }

            // Move from temp to final public output
            fs.renameSync(tempOutputPath, finalOutputPath);

            // Clean up inputs
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            if (audioInputPath && fs.existsSync(audioInputPath)) fs.unlinkSync(audioInputPath);
            if (logoInputPath && fs.existsSync(logoInputPath)) fs.unlinkSync(logoInputPath);
            
            res.json({ 
              success: true, 
              downloadUrl: `/output/${outputFilename}` 
            });
          } catch (verifyErr: unknown) {
            const verifyErrMsg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
            console.error('[VBS Video] post-process verification failed:', verifyErr);
            res.status(500).json({ success: false, error: "Output verification failed: " + verifyErrMsg });
          }
        })
        .on('error', (err) => {
          console.error('[VBS Video] FFmpeg error:', err);
          if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
          if (audioInputPath && fs.existsSync(audioInputPath)) fs.unlinkSync(audioInputPath);
          if (logoInputPath && fs.existsSync(logoInputPath)) fs.unlinkSync(logoInputPath);
          if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
          res.status(500).json({ success: false, error: "FFmpeg execution failed: " + err.message });
        })
        .run();

    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('Global Processing error:', err);
      // Clean up files if possible
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      if (files?.['video']?.[0]?.path && fs.existsSync(files['video'][0].path)) fs.unlinkSync(files['video'][0].path);
      if (files?.['audio']?.[0]?.path && fs.existsSync(files['audio'][0].path)) fs.unlinkSync(files['audio'][0].path);
      if (files?.['logo']?.[0]?.path && fs.existsSync(files['logo'][0].path)) fs.unlinkSync(files['logo'][0].path);
      
      res.status(500).json({ 
        success: false, 
        error: "Server Error: " + errorMessage
      });
    }
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

  // In-memory cache for bad/invalid keys (10 minute TTL)
  const invalidKeyCache = new Map<string, number>();

  function isKeyMarkedInvalid(key: string): boolean {
    const exp = invalidKeyCache.get(key);
    if (!exp) return false;
    if (Date.now() > exp) {
      invalidKeyCache.delete(key);
      return false;
    }
    return true;
  }

  function markKeyInvalid(key: string): void {
    invalidKeyCache.set(key, Date.now() + 10 * 60 * 1000); // 10 minutes
    console.warn(`[Proxy] API Key marked invalid for 10 minutes: ${maskApiKey(key)}`);
  }

  function maskApiKey(key?: string | null): string {
    if (!key || typeof key !== 'string') return '[empty]';
    const trimmed = key.trim();
    if (trimmed.length <= 8) return '****';
    return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
  }

  function isPlausibleKeyCandidate(key?: string | null): boolean {
    if (!key || typeof key !== 'string') return false;
    const trimmed = key.trim();
    const lower = trimmed.toLowerCase();
    if (trimmed.length < 25) return false;
    if (
      lower.startsWith('my_') ||
      lower.startsWith('my ') ||
      lower.startsWith('test') ||
      lower.startsWith('sample') ||
      lower.startsWith('key_') ||
      lower.startsWith('gemini_') ||
      lower.includes('placeholder') ||
      lower.includes('...')
    ) {
      return false;
    }
    return !isKeyMarkedInvalid(trimmed);
  }

  function extractErrorDetails(err: unknown): { status: number; message: string; raw: string } {
    const e = err as { status?: number; statusCode?: number; response?: { status: number }; message?: string };
    let status = e.status || e.statusCode || (e.response ? e.response.status : 0);
    let message = e.message || "Unknown error";
    const raw = typeof err === 'string' ? err : JSON.stringify(err);

    if (!status) {
      const statusMatch = message.match(/\b(400|401|403|404|429|500|502|503|504)\b/);
      if (statusMatch) {
        status = parseInt(statusMatch[1], 10);
      }
    }

    if (typeof message === 'string' && message.startsWith('{') && message.includes('"message"')) {
      try {
        const parsed = JSON.parse(message);
        message = parsed.error?.message || parsed.message || message;
      } catch {}
    }

    return { status: status || 500, message, raw };
  }

  function isApiKeyInvalidError(err: unknown, status: number): boolean {
    const { message, raw } = extractErrorDetails(err);
    const combined = (message + ' ' + raw).toUpperCase();
    if (status === 400 || combined.includes('API_KEY_INVALID') || combined.includes('API KEY NOT VALID')) {
      return (
        combined.includes('API_KEY_INVALID') ||
        combined.includes('API KEY NOT VALID') ||
        combined.includes('API_KEY_SERVICE_BLOCKED') ||
        combined.includes('CONSUMER_INVALID') ||
        combined.includes('API KEY EXPIRED') ||
        (status === 400 && combined.includes('INVALID_ARGUMENT') && combined.includes('API KEY'))
      );
    }
    return false;
  }

  function isOverloadError(err: unknown, status: number): boolean {
    if (status === 503 || status === 500 || status === 429 || status === 502 || status === 504) {
      return true;
    }
    const { message, raw } = extractErrorDetails(err);
    const lower = (message + ' ' + raw).toLowerCase();
    return (
      lower.includes('high demand') ||
      lower.includes('spikes in demand') ||
      lower.includes('currently experiencing') ||
      lower.includes('overloaded') ||
      lower.includes('unavailable') ||
      lower.includes('resource_exhausted') ||
      lower.includes('rate limit') ||
      lower.includes('quota') ||
      lower.includes('timeout') ||
      lower.includes('etimedout') ||
      lower.includes('econnreset') ||
      lower.includes('socket hang up') ||
      lower.includes('fetch failed')
    );
  }

  function getCapabilityModelGroup(initialModel: string, isTts: boolean, isClonedVoice: boolean): string[] {
    if (isClonedVoice) {
      return ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'];
    }
    if (isTts) {
      if (initialModel === 'gemini-3.8-flash-tts') {
        return ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'];
      }
      return ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'];
    }
    // Text capability group: try initial model first, then gemini-3.5-flash, then gemini-3.5-flash-lite
    if (initialModel === 'gemini-3.8-flash') {
      return ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
    }
    if (initialModel === 'gemini-3.5-flash') {
      return ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'];
    }
    if (initialModel === 'gemini-3.5-flash-lite') {
      return ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash'];
    }
    return [initialModel, 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
  }

  interface AttemptRecord {
    keyLabel: string;
    model: string;
    status: number;
    isKeyValid: boolean;
    isOverload: boolean;
    rawMessage: string;
  }

  function formatAttemptSummary(attempts: AttemptRecord[]): string {
    if (attempts.length === 0) return "ကြိုးစားမှု မရှိသေးပါ။";

    const keySummaries: string[] = [];
    const keysSeen = new Set<string>();

    for (const a of attempts) {
      if (keysSeen.has(a.keyLabel)) continue;
      keysSeen.add(a.keyLabel);

      const forThisKey = attempts.filter(x => x.keyLabel === a.keyLabel);
      const modelsTried = [...new Set(forThisKey.map(x => x.model))].join(', ');
      const latest = forThisKey[forThisKey.length - 1];

      if (!latest.isKeyValid) {
        keySummaries.push(`${latest.keyLabel}: မမှန်ပါ (${latest.status || 400})။`);
      } else if (latest.isOverload) {
        const statusCode = latest.status || 503;
        const statusText = statusCode === 429 ? 'limit ပြည့်ကျပ် (429)' : `server ပြည့်ကျပ် (${statusCode})`;
        keySummaries.push(`${modelsTried}: ${statusText}, ${latest.keyLabel} မှန်ပါတယ်။`);
      } else {
        keySummaries.push(`${modelsTried}: အမှား (${latest.status || 'unknown'}), ${latest.keyLabel} မှန်ပါတယ်။`);
      }
    }

    return keySummaries.join(' ');
  }

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  interface KeyCandidate {
    key: string;
    source: 'personal' | 'env' | 'admin_channel';
    label: string;
  }

  async function getKeyCandidates(providedKey?: string | null): Promise<KeyCandidate[]> {
    const candidates: KeyCandidate[] = [];

    // 1. Personal key
    if (isPlausibleKeyCandidate(providedKey)) {
      const pk = providedKey!.trim();
      candidates.push({
        key: pk,
        source: 'personal',
        label: `key ${pk.slice(-4)}`
      });
    }

    // 2. Environment key
    if (isPlausibleKeyCandidate(process.env.GEMINI_API_KEY)) {
      const ek = process.env.GEMINI_API_KEY!.trim();
      if (!candidates.some(c => c.key === ek)) {
        candidates.push({
          key: ek,
          source: 'env',
          label: 'environment key'
        });
      }
    }

    // 3. Admin channels from Firestore
    try {
      const adminChannelsSnapshot = await db.collection('admin_channels').get();
      adminChannelsSnapshot.docs.forEach(doc => {
        const k = doc.data()?.key;
        if (isPlausibleKeyCandidate(k)) {
          const tk = k.trim();
          if (!candidates.some(c => c.key === tk)) {
            candidates.push({
              key: tk,
              source: 'admin_channel',
              label: `admin key ${tk.slice(-4)}`
            });
          }
        }
      });
    } catch (fsErr) {
      console.warn("[Key Candidates] Firestore admin_channels fetch skipped:", (fsErr as Error)?.message || fsErr);
    }

    return candidates;
  }

  function translateVoiceError(status: number, message: string, details?: unknown): { burmeseMessage: string; technicalMessage: string } {
    const msgLower = (message || '').toLowerCase();
    const detStr = typeof details === 'string' ? details.toLowerCase() : JSON.stringify(details || '').toLowerCase();
    const combined = `${msgLower} ${detStr}`;

    let burmese = '';
    if (combined.includes('speaker') || combined.includes('mismatch') || combined.includes('not match') || combined.includes('verification')) {
      burmese = 'အသံရှင် မတူညီပါ သို့မဟုတ် Reference နှင့် Consent အသံရှင် တစ်ဦးတည်း မဟုတ်ပါ (Speaker verification mismatch)';
    } else if (combined.includes('consent') || combined.includes('statement') || combined.includes('phrase') || combined.includes('unrecognized')) {
      burmese = 'Consent စာကြောင်းကို တိကျစွာ မဖတ်ထားပါ သို့မဟုတ် ရွေးချယ်ထားသော ဘာသာစကားနှင့် မကိုက်ညီပါ (Consent statement mismatch or unrecognized)';
    } else if (combined.includes('silent') || combined.includes('quiet') || combined.includes('volume') || combined.includes('audio quality')) {
      burmese = 'အသံဖိုင် အရည်အသွေး မပြည့်မီပါ သို့မဟုတ် အသံတိုးလွန်း/ဆူညံသံများလွန်းပါသည် (Audio quality too low or too noisy)';
    } else if (combined.includes('duration') || combined.includes('too short') || combined.includes('too long')) {
      burmese = 'အသံဖိုင်ကြာချိန် မမှန်ကန်ပါ (Reference: ၁၀-၃၀ စက္ကန့်၊ Consent: ၃-၂၀ စက္ကန့် ရှိရမည်)';
    } else if (status === 429 || combined.includes('quota') || combined.includes('rate limit')) {
      burmese = 'Google Gemini အသံတု API အသုံးပြုမှု ပမာဏ ပြည့်သွားပါသည် (429 Rate Limit Exceeded)';
    } else if (status === 503 || combined.includes('overload') || combined.includes('high demand') || combined.includes('unavailable')) {
      burmese = 'Google Gemini အသံတု ဆာဗာ လက်ရှိ ဝန်ပိနေပါသည် ခဏစောင့်ပြီး ပြန်ကြိုးစားပါ (503 Service Unavailable)';
    } else if (status === 400 && (combined.includes('api_key_invalid') || combined.includes('api key not valid'))) {
      burmese = 'API Key မမှန်ကန်ပါ (400 Invalid API Key)';
    } else {
      burmese = `အသံတု ပြုလုပ်မှု မအောင်မြင်ပါ (${status || 'အမှား'}): ${message}`;
    }

    const technicalMessage = message || (typeof details === 'string' ? details : JSON.stringify(details));

    return {
      burmeseMessage: burmese,
      technicalMessage: technicalMessage
    };
  }

  // Gemini Voices API Endpoints
  // List Voices (type=replicated)
  app.get("/api/voices", authenticate, async (req, res) => {
    try {
      const userApiKey = req.headers['x-api-key'] as string;
      const candidates = await getKeyCandidates(userApiKey);

      if (candidates.length === 0) {
        return res.status(400).json({ error: "No API Keys available", voices: [] });
      }

      let lastError: unknown = null;
      for (const candidate of candidates) {
        if (isKeyMarkedInvalid(candidate.key)) continue;

        try {
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/voices?key=${candidate.key}&type=replicated`);
          
          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            if (response.status === 400 && isApiKeyInvalidError(errData, 400)) {
              markKeyInvalid(candidate.key);
            }
            throw new Error(errData.error?.message || `Failed to list voices (${response.status})`);
          }

          const data = await response.json();
          return res.json(data);
        } catch (err: unknown) {
          lastError = err;
          console.warn(`[Voices List] Key ${candidate.label} failed, trying next... Error: ${(err as Error).message}`);
        }
      }
      throw lastError || new Error("Failed to list voices from all keys");
    } catch (error: unknown) {
      console.error("[Voices List] Error:", error);
      res.status(500).json({ error: (error as Error).message || "Internal server error", voices: [] });
    }
  });

  // Create Voice (Replication via JSON body as specified: POST /api/voices/create)
  app.post("/api/voices/create", authenticate, async (req, res) => {
    try {
      const userApiKey = (req.headers['x-api-key'] as string) || req.body?.apiKey;
      const candidates = await getKeyCandidates(userApiKey);

      if (candidates.length === 0) {
        return res.status(400).json({
          error: "အသုံးပြုနိုင်သော API Key မရှိသေးပါ။ Settings တွင် API Key ထည့်သွင်းပေးပါ။",
          status: 400,
          details: null
        });
      }

      const { displayName, voiceName, name, sourceAudio, source_audio, consentAudio, consent_audio, model, store } = req.body;
      const targetName = (displayName || voiceName || name || '').trim();
      const rawSource = sourceAudio || source_audio;
      const rawConsent = consentAudio || consent_audio;

      if (!targetName) {
        return res.status(400).json({
          error: "အသံအမည် ထည့်သွင်းပေးပါ (Voice name is required)",
          status: 400
        });
      }

      if (!rawSource || !rawConsent) {
        return res.status(400).json({
          error: "Reference နှင့် Consent အသံဖိုင် နှစ်ခုစလုံး လိုအပ်ပါသည် (Both source and consent audio are required)",
          status: 400
        });
      }

      const cleanSource = rawSource.includes(',') ? rawSource.split(',')[1] : rawSource;
      const cleanConsent = rawConsent.includes(',') ? rawConsent.split(',')[1] : rawConsent;
      const storeBool = store === true || store === 'true';
      const targetModel = model || "gemini-3.8-flash-tts";

      const googlePayload = {
        store: storeBool,
        voice: {
          model: targetModel,
          type: "replicated",
          display_name: targetName,
          replicated: {
            source_audio: {
              mime_type: "audio/wav",
              data: cleanSource
            },
            consent_audio: {
              mime_type: "audio/wav",
              data: cleanConsent
            }
          }
        }
      };

      let lastErrorData: { status: number; message: string; details: unknown } | null = null;

      for (const candidate of candidates) {
        if (isKeyMarkedInvalid(candidate.key)) {
          console.log(`[Voice Create] Skipping invalid key: ${candidate.label}`);
          continue;
        }

        const maskedKey = maskApiKey(candidate.key);
        console.log(`[Voice Create] Calling Google voices API with ${candidate.label} (${maskedKey}), Model: ${targetModel}, Store: ${storeBool}`);

        let attemptsOnThisKey = 0;
        const maxRetries = 3;
        const backoffs = [1000, 2000, 4000];

        while (attemptsOnThisKey <= maxRetries) {
          try {
            const googleRes = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/voices?key=${candidate.key}`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-goog-api-key": candidate.key
                },
                body: JSON.stringify(googlePayload)
              }
            );

            if (googleRes.ok) {
              const data = await googleRes.json();
              const voiceId = data.name || data.id || data.voice_key || data.voiceKey || data.key || '';
              const voiceKey = data.voice_key || data.voiceKey || (String(voiceId).startsWith('voicekey_') ? voiceId : undefined);
              const maskedId = voiceId ? `${String(voiceId).substring(0, 8)}...` : 'unknown';
              console.log(`[Voice Create] Voice created successfully: ID: ${maskedId}, Key: ${maskedKey}`);

              return res.json({
                ...data,
                id: voiceId,
                name: data.name || voiceId,
                voiceKey: voiceKey,
                displayName: data.display_name || targetName,
                model: targetModel,
                store: storeBool,
                createdAt: new Date().toISOString(),
                expiry: storeBool
                  ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
                  : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
              });
            }

            const errJson = await googleRes.json().catch(() => ({}));
            const errStatus = googleRes.status;
            const errMsg = errJson.error?.message || googleRes.statusText || "Voice creation failed";
            console.warn(`[Voice Create] Key ${candidate.label} error (${errStatus}): ${errMsg}`);

            // If 400 API_KEY_INVALID
            if (isApiKeyInvalidError(errJson, errStatus)) {
              markKeyInvalid(candidate.key);
              lastErrorData = { status: 400, message: errMsg, details: errJson };
              break; // move to next key
            }

            // If overload (503 / 500 / 429), retry with backoff
            if (isOverloadError(errJson, errStatus) && attemptsOnThisKey < maxRetries) {
              const delay = backoffs[attemptsOnThisKey] || 4000;
              attemptsOnThisKey++;
              console.log(`[Voice Create] Overload (${errStatus}). Retrying in ${delay}ms (attempt ${attemptsOnThisKey}/${maxRetries})...`);
              await sleep(delay);
              continue;
            }

            // If speaker mismatch or audio issue, return immediately with clear Burmese message
            const { burmeseMessage, technicalMessage } = translateVoiceError(errStatus, errMsg, errJson);
            return res.status(errStatus).json({
              error: burmeseMessage,
              status: errStatus,
              originalMessage: technicalMessage,
              details: errJson,
              burmeseSummary: burmeseMessage
            });
          } catch (netErr: unknown) {
            console.warn(`[Voice Create] Network error on ${candidate.label}:`, (netErr as Error).message);
            if (attemptsOnThisKey < maxRetries) {
              const delay = backoffs[attemptsOnThisKey] || 4000;
              attemptsOnThisKey++;
              await sleep(delay);
              continue;
            }
            lastErrorData = { status: 500, message: (netErr as Error).message, details: netErr };
            break;
          }
        }
      }

      // If all keys failed
      const finalStatus = lastErrorData?.status || 500;
      const finalMsg = lastErrorData?.message || "All keys failed to create voice";
      const { burmeseMessage, technicalMessage } = translateVoiceError(finalStatus, finalMsg, lastErrorData?.details);

      return res.status(finalStatus).json({
        error: burmeseMessage,
        status: finalStatus,
        originalMessage: technicalMessage,
        details: lastErrorData?.details || null,
        burmeseSummary: burmeseMessage
      });
    } catch (globalErr: unknown) {
      console.error("[Voice Create] Unhandled error:", globalErr);
      const errMsg = (globalErr as Error).message || "Internal server error";
      const { burmeseMessage, technicalMessage } = translateVoiceError(500, errMsg, globalErr);
      return res.status(500).json({
        error: burmeseMessage,
        status: 500,
        originalMessage: technicalMessage,
        details: globalErr,
        burmeseSummary: burmeseMessage
      });
    }
  });

  // Alias /api/voices POST (handles both multipart and JSON)
  app.post("/api/voices", upload.fields([{ name: 'source', maxCount: 1 }, { name: 'consent', maxCount: 1 }]), async (req, res) => {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const sourceFile = files?.['source']?.[0];
    const consentFile = files?.['consent']?.[0];

    // If sent as JSON body
    if (!sourceFile && !consentFile && req.body?.sourceAudio) {
      // Forward directly to JSON handler logic
      const userApiKey = (req.headers['x-api-key'] as string) || req.body?.apiKey;
      const candidates = await getKeyCandidates(userApiKey);
      if (candidates.length === 0) {
        return res.status(400).json({ error: "No API Keys available" });
      }

      const { displayName, sourceAudio, consentAudio, model, store } = req.body;
      const cleanSource = sourceAudio.includes(',') ? sourceAudio.split(',')[1] : sourceAudio;
      const cleanConsent = consentAudio.includes(',') ? consentAudio.split(',')[1] : consentAudio;
      const storeBool = store === true || store === 'true';
      const targetModel = model || "gemini-3.8-flash-tts";

      const googlePayload = {
        store: storeBool,
        voice: {
          model: targetModel,
          type: "replicated",
          display_name: (displayName || 'My Voice').trim(),
          replicated: {
            source_audio: { mime_type: "audio/wav", data: cleanSource },
            consent_audio: { mime_type: "audio/wav", data: cleanConsent }
          }
        }
      };

      for (const candidate of candidates) {
        if (isKeyMarkedInvalid(candidate.key)) continue;
        try {
          const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/voices?key=${candidate.key}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": candidate.key },
            body: JSON.stringify(googlePayload)
          });
          if (resp.ok) {
            const data = await resp.json();
            const voiceId = data.name || data.id || data.voice_key || data.voiceKey || '';
            return res.json({
              ...data,
              id: voiceId,
              name: data.name || voiceId,
              voiceKey: data.voice_key || data.voiceKey,
              displayName: data.display_name || displayName,
              model: targetModel,
              store: storeBool,
              createdAt: new Date().toISOString()
            });
          }
        } catch {}
      }
    }

    if (!sourceFile || !consentFile) {
      if (sourceFile) fs.unlinkSync(sourceFile.path);
      if (consentFile) fs.unlinkSync(consentFile.path);
      return res.status(400).json({ error: "Both source and consent audio files are required" });
    }

    try {
      const sourceData = fs.readFileSync(sourceFile.path).toString("base64");
      const consentData = fs.readFileSync(consentFile.path).toString("base64");
      const targetModel = req.body.model || "gemini-3.8-flash-tts";
      const storeBool = req.body.store === true || req.body.store === 'true';
      const displayName = req.body.displayName || "My Voice";

      const userApiKey = req.headers['x-api-key'] as string;
      const candidates = await getKeyCandidates(userApiKey);

      if (candidates.length === 0) {
        if (fs.existsSync(sourceFile.path)) fs.unlinkSync(sourceFile.path);
        if (fs.existsSync(consentFile.path)) fs.unlinkSync(consentFile.path);
        return res.status(400).json({ error: "No API Keys available" });
      }

      const requestBody = {
        store: storeBool,
        voice: {
          display_name: displayName.trim(),
          model: targetModel,
          type: "replicated",
          replicated: {
            source_audio: { data: sourceData, mime_type: "audio/wav" },
            consent_audio: { data: consentData, mime_type: "audio/wav" }
          }
        }
      };

      let lastError: unknown = null;
      for (const candidate of candidates) {
        if (isKeyMarkedInvalid(candidate.key)) continue;

        try {
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/voices?key=${candidate.key}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": candidate.key },
            body: JSON.stringify(requestBody)
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            if (response.status === 400 && isApiKeyInvalidError(errData, 400)) {
              markKeyInvalid(candidate.key);
            }
            throw new Error(errData.error?.message || response.statusText || "Failed to create voice");
          }

          const data = await response.json();
          if (fs.existsSync(sourceFile.path)) fs.unlinkSync(sourceFile.path);
          if (fs.existsSync(consentFile.path)) fs.unlinkSync(consentFile.path);

          const voiceId = data.name || data.id || data.voice_key || data.voiceKey || data.key;
          return res.json({
            ...data,
            id: voiceId,
            name: data.name || voiceId,
            voiceKey: data.voice_key || data.voiceKey,
            displayName: data.display_name || displayName.trim(),
            model: targetModel,
            store: storeBool,
            createdAt: new Date().toISOString()
          });
        } catch (err: unknown) {
          lastError = err;
        }
      }
      throw lastError;
    } catch (error: unknown) {
      if (sourceFile && fs.existsSync(sourceFile.path)) fs.unlinkSync(sourceFile.path);
      if (consentFile && fs.existsSync(consentFile.path)) fs.unlinkSync(consentFile.path);
      res.status(500).json({ error: (error as Error).message || "Internal server error" });
    }
  });

  // Rename Voice (PATCH /api/voices/:voiceId)
  app.patch("/api/voices/:voiceId", authenticate, async (req, res) => {
    const rawVoiceId = req.params.voiceId;
    const voiceId = decodeURIComponent(rawVoiceId);
    const { displayName, display_name } = req.body || {};
    const newName = (displayName || display_name || '').trim();

    if (!newName) {
      return res.status(400).json({ error: "New displayName is required" });
    }

    if (voiceId.startsWith('voicekey_')) {
      return res.json({ success: true, id: voiceId, displayName: newName, localOnly: true });
    }

    const voicePath = voiceId.startsWith('voices/') ? voiceId : `voices/${voiceId}`;
    const userApiKey = req.headers['x-api-key'] as string;
    const candidates = await getKeyCandidates(userApiKey);

    for (const candidate of candidates) {
      if (isKeyMarkedInvalid(candidate.key)) continue;
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/${voicePath}?updateMask=display_name`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": candidate.key
            },
            body: JSON.stringify({ display_name: newName })
          }
        );
        if (response.ok) {
          const data = await response.json();
          return res.json({ success: true, ...data, displayName: newName });
        }
      } catch {}
    }

    return res.json({ success: true, id: voiceId, displayName: newName, localOnly: true });
  });

  // Delete Voice (DELETE /api/voices/:voiceId)
  app.delete("/api/voices/:voiceId", authenticate, async (req, res) => {
    const rawVoiceId = req.params.voiceId;
    const voiceId = decodeURIComponent(rawVoiceId);
    const maskedId = voiceId ? `${voiceId.substring(0, 8)}...` : 'empty';
    console.log(`[Voice Delete] Attempting delete for voice: ${maskedId}`);

    if (voiceId.startsWith('voicekey_')) {
      return res.json({ success: true, message: "Client-only key removed" });
    }

    const voicePath = voiceId.startsWith('voices/') ? voiceId : `voices/${voiceId}`;
    const userApiKey = req.headers['x-api-key'] as string;
    const candidates = await getKeyCandidates(userApiKey);

    if (candidates.length === 0) {
      return res.status(400).json({ error: "No API Keys available" });
    }

    let lastError = null;
    for (const candidate of candidates) {
      if (isKeyMarkedInvalid(candidate.key)) continue;

      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${voicePath}?key=${candidate.key}`, {
          method: "DELETE"
        });

        if (!response.ok) {
          if (response.status === 404) {
            console.log(`[Voice Delete] Voice ${maskedId} already deleted (404)`);
            return res.json({ success: true });
          }
          const errData = await response.json().catch(() => ({}));
          if (response.status === 400 && isApiKeyInvalidError(errData, 400)) {
            markKeyInvalid(candidate.key);
          }
          throw new Error(errData.error?.message || `Failed to delete voice (${response.status})`);
        }

        console.log(`[Voice Delete] Successfully deleted voice: ${maskedId}`);
        return res.json({ success: true });
      } catch (err: unknown) {
        lastError = err;
        console.warn(`[Voice Delete] Key failed, trying next... Error: ${(err as Error).message}`);
      }
    }

    const errMsg = (lastError as Error)?.message || "Failed to delete voice";
    return res.status(500).json({
      error: `အသံဖျက်သိမ်းမှု မအောင်မြင်ပါ: ${errMsg}`,
      originalMessage: errMsg
    });
  });

  // Gemini Proxy Endpoint
  app.post("/api/gemini/proxy", authenticate, async (req, res) => {
    console.log(`[Proxy] Hit /api/gemini/proxy. Model: ${req.body?.model}, SelectedModel: ${req.body?.selectedModel}`);
    const { model, contents, config, apiKey: providedKey, selectedModel, isTts } = req.body;
    
    let targetModel = selectedModel || model;
    
    if (!targetModel) {
      targetModel = isTts ? 'gemini-3.8-flash-lite-tts' : 'gemini-3.8-flash';
    }

    // Check if request is using a cloned voice
    const voiceIdVal = String(
      config?.speechConfig?.voiceConfig?.voiceId || 
      config?.speechConfig?.voiceConfig?.voiceKeyConfig?.voiceKey || 
      config?.speech_config?.[0]?.voice || 
      ''
    );
    const isClonedVoice = Boolean(
      isTts && (
        voiceIdVal.startsWith('voices/') || 
        voiceIdVal.startsWith('voice_') || 
        voiceIdVal.startsWith('voicekey_')
      )
    );

    if (isClonedVoice) {
      const maskedVoice = voiceIdVal.substring(0, 8) + '...';
      console.log(`[Proxy] Cloned voice detected (${maskedVoice}). Enforcing voice replication model.`);
      if (targetModel !== 'gemini-3.8-flash-tts' && targetModel !== 'gemini-3.8-flash-lite-tts') {
        targetModel = 'gemini-3.8-flash-tts';
      }
    } else if (isTts) {
      if (!targetModel.includes('tts')) {
        targetModel = 'gemini-3.8-flash-lite-tts';
      }
    }

    const executeModelCall = async (apiKey: string, currentModel: string): Promise<unknown> => {
      const ai = new GoogleGenAI({ apiKey });

      if (isClonedVoice) {
        console.log(`[Proxy] Using Interactions API for cloned voice: ${voiceIdVal} on model: ${currentModel}`);
        const textPart = contents?.[0]?.parts?.find((p: { text?: string; speechMetadata?: { style?: string } }) => p.text);
        const text = textPart?.text || "";
        const annotations: Array<{ type: string; style: string }> = [];
        if (textPart?.speechMetadata?.style) {
          annotations.push({
            type: "speech_metadata",
            style: textPart.speechMetadata.style
          });
        } else if (text.startsWith('[') && text.includes(']')) {
          const closingIdx = text.indexOf(']');
          const style = text.substring(1, closingIdx);
          annotations.push({
            type: "speech_metadata",
            style: style
          });
        }

        const interactionPayload = {
          model: currentModel,
          input: [
            {
              type: "user_input",
              content: [
                {
                  type: "text",
                  text: text,
                  ...(annotations.length > 0 ? { annotations } : {})
                }
              ]
            }
          ],
          response_format: { type: "audio" },
          generation_config: {
            speech_config: [
              {
                voice: voiceIdVal
              }
            ]
          }
        };

        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/interactions?key=${apiKey}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: JSON.stringify(interactionPayload)
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const errMsg = errData.error?.message || res.statusText || "Interactions API call failed";
          const errObj = new Error(errMsg) as Error & { status?: number; data?: unknown };
          errObj.status = res.status;
          errObj.data = errData;
          throw errObj;
        }

        const interactionData = await res.json();
        let base64Audio = "";
        let mimeType = "audio/wav";

        if (interactionData.output_audio?.data) {
          base64Audio = interactionData.output_audio.data;
          mimeType = interactionData.output_audio.mime_type || mimeType;
        } else if (Array.isArray(interactionData.output)) {
          for (const out of interactionData.output) {
            if (out.type === 'audio' && out.data) {
              base64Audio = out.data;
              mimeType = out.mime_type || mimeType;
              break;
            }
            if (Array.isArray(out.content)) {
              for (const c of out.content) {
                if (c.type === 'audio' && c.data) {
                  base64Audio = c.data;
                  mimeType = c.mime_type || mimeType;
                  break;
                }
              }
            }
          }
        } else if (interactionData.output?.audio?.data) {
          base64Audio = interactionData.output.audio.data;
          mimeType = interactionData.output.audio.mime_type || mimeType;
        } else if (interactionData.candidates?.[0]?.content?.parts) {
          for (const p of interactionData.candidates[0].content.parts) {
            if (p.inlineData?.data) {
              base64Audio = p.inlineData.data;
              mimeType = p.inlineData.mimeType || mimeType;
              break;
            }
          }
        }

        if (!base64Audio) {
          throw new Error("No audio data returned from Interactions API");
        }

        return {
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      data: base64Audio,
                      mimeType: mimeType
                    }
                  }
                ]
              }
            }
          ]
        };
      }

      const updatedConfig: Record<string, unknown> = config ? { ...config } : {};
      if (isTts) {
        updatedConfig.responseModalities = ["AUDIO"];
      }

      return await ai.models.generateContent({
        model: currentModel,
        contents,
        config: updatedConfig
      });
    };

    const keyCandidates = await getKeyCandidates(providedKey);

    if (keyCandidates.length === 0) {
      return res.status(400).json({ 
        error: "အသုံးပြုနိုင်သော API Key မရှိသေးပါ။ Settings တွင် API Key အသစ်ထည့်သွင်းပေးပါ။",
        burmeseSummary: "အသုံးပြုနိုင်သော API Key မရှိသေးပါ။ Settings တွင် API Key အသစ်ထည့်သွင်းပေးပါ။" 
      });
    }

    const capabilityModels = getCapabilityModelGroup(targetModel, isTts, isClonedVoice);
    const attempts: AttemptRecord[] = [];
    let firstMeaningfulError: { status: number; message: string; raw: string } | null = null;

    for (let keyIdx = 0; keyIdx < keyCandidates.length; keyIdx++) {
      const candidate = keyCandidates[keyIdx];
      if (isKeyMarkedInvalid(candidate.key)) {
        console.log(`[Proxy] Skipping invalid cached key: ${candidate.label} (${maskApiKey(candidate.key)})`);
        continue;
      }

      let keyFailedWithBadKey = false;

      for (let modelIdx = 0; modelIdx < capabilityModels.length; modelIdx++) {
        const currentModel = capabilityModels[modelIdx];
        console.log(`[Proxy] Trying model ${currentModel} with ${candidate.label} (${maskApiKey(candidate.key)})`);

        try {
          const result = await executeModelCall(candidate.key, currentModel);
          return res.json(convertBuffersToBase64(result));
        } catch (err: unknown) {
          const errDetails = extractErrorDetails(err);

          // 2. Bad Key check (400 API_KEY_INVALID)
          if (isApiKeyInvalidError(err, errDetails.status)) {
            markKeyInvalid(candidate.key);
            attempts.push({
              keyLabel: candidate.label,
              model: currentModel,
              status: 400,
              isKeyValid: false,
              isOverload: false,
              rawMessage: errDetails.message
            });
            keyFailedWithBadKey = true;
            console.warn(`[Proxy] Key ${candidate.label} (${maskApiKey(candidate.key)}) failed: 400 API_KEY_INVALID. Moving to next key.`);
            break; // Stop testing other models with this bad key
          }

          // 1. Overload check (503 / 500 / 429 / timeout)
          if (isOverloadError(err, errDetails.status)) {
            attempts.push({
              keyLabel: candidate.label,
              model: currentModel,
              status: errDetails.status,
              isKeyValid: true,
              isOverload: true,
              rawMessage: errDetails.message
            });

            if (!firstMeaningfulError) {
              firstMeaningfulError = errDetails;
            }

            // Retry SAME key 3 times with backoff (1s, 2s, 4s)
            const backoffs = [1000, 2000, 4000];
            for (let r = 0; r < backoffs.length; r++) {
              const delay = backoffs[r];
              console.log(`[Proxy] Retrying ${currentModel} with ${candidate.label} (${maskApiKey(candidate.key)}) in ${delay}ms (retry ${r + 1}/3)...`);
              await sleep(delay);

              try {
                const retryResult = await executeModelCall(candidate.key, currentModel);
                return res.json(convertBuffersToBase64(retryResult));
              } catch (retryErr: unknown) {
                const rDetails = extractErrorDetails(retryErr);
                if (isApiKeyInvalidError(retryErr, rDetails.status)) {
                  markKeyInvalid(candidate.key);
                  keyFailedWithBadKey = true;
                  break;
                }
                console.warn(`[Proxy] Retry ${r + 1}/3 failed for ${currentModel} on ${candidate.label} with status ${rDetails.status}`);
              }
            }

            if (keyFailedWithBadKey) break;

            // Model is overloaded on this key, try next model in capability group with SAME key
            console.warn(`[Proxy] Model ${currentModel} exhausted 3 retries on ${candidate.label}. Trying fallback model in capability group with SAME key...`);
            continue;
          }

          // Non-overload, non-invalid key error
          attempts.push({
            keyLabel: candidate.label,
            model: currentModel,
            status: errDetails.status,
            isKeyValid: true,
            isOverload: false,
            rawMessage: errDetails.message
          });
          if (!firstMeaningfulError) {
            firstMeaningfulError = errDetails;
          }
        }

        if (keyFailedWithBadKey) break;
      }
      // Finished all models for this key, now move to next key
    }

    // If every attempt failed
    const burmeseSummary = formatAttemptSummary(attempts);
    console.error(`[Proxy] All attempts failed. Summary: ${burmeseSummary}`);

    const chosenStatus = firstMeaningfulError ? firstMeaningfulError.status : (attempts[0]?.status || 503);
    const returnStatus = (chosenStatus === 400 && attempts.some(a => a.isKeyValid)) ? 503 : chosenStatus;
    const firstErrorMsg = firstMeaningfulError ? firstMeaningfulError.message : (attempts[0]?.rawMessage || "Request failed");

    res.status(returnStatus).json({ 
      error: `${burmeseSummary}\n\n${firstErrorMsg}`,
      burmeseSummary,
      firstMeaningfulError: firstErrorMsg,
      attempts
    });
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
      server: { middlewareMode: true },
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
