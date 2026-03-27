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
        const pkg = await import('youtube-transcript');
        const YoutubeTranscript = pkg.YoutubeTranscript || (pkg as any).default;
        
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
          const userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36'
          ];
          const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
          
          // Try direct fetch first
          let response = await fetch(watchUrl, {
            headers: {
              'User-Agent': randomUA,
              'Accept-Language': 'en-US,en;q=0.9'
            }
          });

          let html = '';
          let usedProxy = false;

          // If direct fetch is blocked (403/429), try proxies
          if (!response.ok) {
            console.warn(`YouTube Transcript: Direct fetch failed (${response.status}), trying AllOrigins proxy...`);
            const proxies = [
              `https://api.allorigins.win/get?url=${encodeURIComponent(watchUrl)}`,
              `https://corsproxy.io/?${encodeURIComponent(watchUrl)}`
            ];

            for (const proxyUrl of proxies) {
              try {
                const proxyRes = await fetch(proxyUrl);
                if (proxyRes.ok) {
                  if (proxyUrl.includes('allorigins')) {
                    const proxyData = await proxyRes.json();
                    html = proxyData.contents;
                  } else {
                    html = await proxyRes.text();
                  }
                  if (html) {
                    usedProxy = true;
                    break;
                  }
                }
              } catch (pErr) {
                console.warn(`Proxy ${proxyUrl} failed:`, pErr);
              }
            }
          } else {
            html = await response.text();
          }

          if (html) {
            transcript = await parseTranscriptFromHtml(html, usedProxy);
          }
        } catch (scrapeError) {
          console.error("YouTube Transcript: Scraping fallback failed:", scrapeError);
        }
      }

      async function parseTranscriptFromHtml(html: string, useProxy: boolean) {
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
            
            let transcriptUrl = track.baseUrl;
            let xmlResponse;

            if (useProxy) {
              const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(transcriptUrl)}`;
              const pRes = await fetch(proxyUrl);
              if (pRes.ok) {
                const pData = await pRes.json();
                xmlResponse = pData.contents;
              }
            }

            if (!xmlResponse) {
              const res = await fetch(transcriptUrl);
              xmlResponse = await res.text();
            }
            
            if (xmlResponse) {
              const textRegex = /<text start="([\d.]+)" dur="([\d.]+)".*?>(.*?)<\/text>/g;
              const results = [];
              let m;
              while ((m = textRegex.exec(xmlResponse)) !== null) {
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
            }
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
