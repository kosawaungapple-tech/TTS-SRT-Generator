import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import firebaseConfig from "./firebase-applet-config.json" assert { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const db = admin.firestore();

// Middleware to verify Firebase ID Token
const authenticate = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthenticated: Missing authorization header' });
  }

  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    (req as any).user = decodedToken;
    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    res.status(401).json({ error: 'Unauthenticated: Invalid token' });
  }
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "Server is healthy" });
  });

  // YouTube Transcript Endpoint
  app.get("/api/youtube-transcript", async (req, res) => {
    const videoUrl = req.query.url as string;
    if (!videoUrl) {
      return res.status(400).json({ error: "Missing video URL" });
    }

    const extractVideoId = (url: string) => {
      const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([^"&?\/\s]{11})/i;
      const match = url.match(regex);
      return match ? match[1] : null;
    };

    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
      return res.status(400).json({ error: "Invalid YouTube URL" });
    }

    try {
      console.log("YouTube Transcript: Fetching real data for", videoId);
      
      let transcript;
      
      // Method 1: Try youtube-transcript library
      try {
        const { YoutubeTranscript } = await import('youtube-transcript');
        if (YoutubeTranscript && typeof YoutubeTranscript.fetchTranscript === 'function') {
          transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
        }
      } catch (e) {
        console.warn("YouTube Transcript: Library method failed, trying scraping fallback...");
      }

      // Method 2: Scraping Fallback (Manual fetch and parse)
      if (!transcript || transcript.length === 0) {
        try {
          const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
          
          // Try direct fetch first
          let response = await fetch(watchUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept-Language': 'en-US,en;q=0.9'
            }
          });

          // If direct fetch is blocked (403/429), try proxy
          if (!response.ok) {
            console.warn(`YouTube Transcript: Direct fetch failed (${response.status}), trying AllOrigins proxy...`);
            const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(watchUrl)}`;
            const proxyRes = await fetch(proxyUrl);
            if (proxyRes.ok) {
              const proxyData = await proxyRes.json();
              const html = proxyData.contents;
              transcript = parseTranscriptFromHtml(html);
            }
          } else {
            const html = await response.text();
            transcript = parseTranscriptFromHtml(html);
          }
        } catch (scrapeError) {
          console.error("YouTube Transcript: Scraping fallback failed:", scrapeError);
        }
      }

      function parseTranscriptFromHtml(html: string) {
        const regex = /ytInitialPlayerResponse\s*=\s*({.+?});/s;
        const match = html.match(regex);
        if (match) {
          const playerResponse = JSON.parse(match[1]);
          const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
          
          if (tracks && tracks.length > 0) {
            const track = tracks.find((t: any) => t.languageCode === 'en') || 
                          tracks.find((t: any) => t.languageCode === 'en-US') ||
                          tracks.find((t: any) => t.languageCode.startsWith('en')) ||
                          tracks[0];
            
            return fetch(track.baseUrl)
              .then(res => res.text())
              .then(xml => {
                const textRegex = /<text start="([\d.]+)" dur="([\d.]+)".*?>(.*?)<\/text>/g;
                const results = [];
                let m;
                while ((m = textRegex.exec(xml)) !== null) {
                  results.push({
                    text: m[3]
                      .replace(/&amp;/g, '&')
                      .replace(/&lt;/g, '<')
                      .replace(/&gt;/g, '>')
                      .replace(/&quot;/g, '"')
                      .replace(/&#39;/g, "'")
                      .replace(/&nbsp;/g, ' '),
                    offset: parseFloat(m[1]) * 1000,
                    duration: parseFloat(m[2]) * 1000
                  });
                }
                return results;
              });
          }
        }
        return null;
      }

      // Wait for the promise if parseTranscriptFromHtml returned one
      if (transcript instanceof Promise) {
        transcript = await transcript;
      }

      if (!transcript || transcript.length === 0) {
        return res.status(404).json({ error: "No transcript found for this video. Please ensure the video has English captions enabled." });
      }

      res.json({ transcript });
    } catch (error: any) {
      console.error("YouTube Transcript Error:", error);
      res.status(500).json({ error: error.message || "Failed to fetch transcript" });
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
  app.get("/api/user/profile", authenticate, async (req, res) => {
    const userId = (req as any).user.uid;
    try {
      const userDoc = await db.collection('users').doc(userId).get();
      if (userDoc.exists) {
        res.json(userDoc.data());
      } else {
        res.status(404).json({ error: 'User not found' });
      }
    } catch (error) {
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
