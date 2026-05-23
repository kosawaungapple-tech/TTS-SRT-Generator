import express from "express";
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

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "Server is healthy", timestamp: new Date().toISOString() });
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
        '-f', 'mp4',
        '-movflags', '+faststart',
        '-pix_fmt', 'yuv420p'
      ];

      if (needsVideoProcessing) {
        outputOptions.push('-map', filterComplex.length > 0 && currentVideoLabel !== '0:v' ? `[${currentVideoLabel}]` : '0:v');
        outputOptions.push('-vcodec', 'libx264', '-preset', 'ultrafast');
      } else {
        outputOptions.push('-map', '0:v:0', '-c:v', 'copy');
      }

      if (currentAudioLabel) {
        // If we processed the audio, use the label, otherwise use the source index
        const finalAudioSource = currentAudioLabel.includes('_proc') ? `[${currentAudioLabel}]` : (audioInputPath ? '1:a:0' : '0:a:0');
        outputOptions.push('-map', finalAudioSource);
        outputOptions.push('-acodec', 'aac');
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

  // Gemini Proxy Endpoint
  // This allows authorized users to access Gemini via this server.
  // It handles secure server-side API key management for admin keys.
  app.post("/api/gemini/proxy", authenticate, async (req, res) => {
    const { model, contents, config, apiKey: providedKey } = req.body;
    
    // Priority: 1. Key provided in body (Personal Key), 2. Admin Pool Keys from Firestore
    const apiKey = providedKey;
    
    if (!model) {
      return res.status(400).json({ error: "Model name is required" });
    }

    try {
      // If no personal key provided, we fetch and rotate through admin keys from Firestore
      if (!apiKey) {
        try {
          const adminChannelsSnapshot = await db.collection('admin_channels').get();
          const adminKeys = adminChannelsSnapshot.docs
            .map(doc => doc.data().key)
            .filter(key => !!key);

          if (adminKeys.length === 0) {
            // Fallback to environment variable if no firestore keys
            if (process.env.GEMINI_API_KEY) {
              adminKeys.push(process.env.GEMINI_API_KEY);
            } else {
              return res.status(400).json({ error: "No API Keys available. Please add one in settings." });
            }
          }

          let lastError = null;
          // Try up to 3 keys or all available (whichever is less) to avoid excessive retries
          const totalKeys = adminKeys.length;
          const maxAttempts = Math.min(totalKeys, 3);
          const startIndex = Math.floor(Math.random() * totalKeys);

          for (let i = 0; i < maxAttempts; i++) {
            const currentKey = adminKeys[(startIndex + i) % totalKeys];
            
            try {
              const ai = new GoogleGenAI({ apiKey: currentKey });
              console.log(`[Proxy] Requesting model: ${model} with Admin Pool Key (${i + 1}/${maxAttempts})`);
              
              const result = await ai.models.generateContent({
                model: model,
                contents,
                config
              });
              return res.json(result);
            } catch (err: unknown) {
              lastError = err as Error;
              const errorObj = err as { status?: number; statusCode?: number; response?: { status: number }; message?: string };
              const status = errorObj.status || errorObj.statusCode || (errorObj.response ? errorObj.response.status : 500);
              
              // If it's a rate limit or overloaded error, try the next key
              if (status === 429 || status === 503 || (errorObj.message && errorObj.message.includes('RESOURCES_EXHAUSTED'))) {
                console.warn(`[Proxy] Admin key failed (status ${status}), rotating...`);
                continue;
              }
              // For other errors (like invalid prompt), throw immediately
              throw err;
            }
          }
          
          if (lastError) throw lastError;
        } catch (dbErr) {
          console.error("[Proxy] Firestore/Rotation Error:", dbErr);
          throw dbErr;
        }
      } else {
        // PERSONAL KEY MODE
        const ai = new GoogleGenAI({ apiKey });
        console.log(`[Proxy] Requesting model: ${model} with Personal Key: ${apiKey.substring(0, 4)}...`);
        
        const result = await ai.models.generateContent({
          model: model,
          contents,
          config
        });
        return res.json(result);
      }
    } catch (error: unknown) {
      console.error("[Proxy] Gemini Error:", error);
      
      const err = error as { status?: number; statusCode?: number; response?: { status: number }; message?: string };
      
      // Extract status and message from the various error formats Gemini can return
      const status = err.status || err.statusCode || (err.response ? err.response.status : 500);
      const message = err.message || "Failed to call Gemini API";
      
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
}

startServer();
