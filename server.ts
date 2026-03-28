import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import firebaseConfig from "./firebase-applet-config.json" with { type: "json" };

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

  // Telegram Notification Endpoint
  app.post("/api/notify-activation", authenticate, async (req, res) => {
    const { email, displayName } = req.body;
    
    let botToken = process.env.TELEGRAM_BOT_TOKEN;
    let chatId = process.env.TELEGRAM_CHAT_ID;

    // Try to get from Firestore if not in env
    try {
      const systemConfigDoc = await db.collection('settings').doc('global_config').get();
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

  // Gemini API Proxy
  app.post("/api/proxy", authenticate, async (req, res) => {
    let { apiKey, model, contents, generationConfig } = req.body;

    // DIRECT API KEY LINKING: If no key provided, pull from Firestore System Config
    if (!apiKey) {
      try {
        const systemConfigDoc = await db.collection('settings').doc('global_config').get();
        if (systemConfigDoc.exists) {
          const data = systemConfigDoc.data();
          // COMMANDER'S ORDER: Only use global key if allow_global_key is ON
          if (data?.gemini_api_key && data?.allow_global_key === true) {
            apiKey = data.gemini_api_key.trim();
            console.log("Gemini Proxy: Using system-wide API Key from Firestore (Global Usage ENABLED)");
          } else if (data?.gemini_api_key && data?.allow_global_key !== true) {
            console.log("Gemini Proxy: Global API Key exists but Global Usage is DISABLED");
          }
        }
      } catch (err) {
        console.error("Gemini Proxy: Error fetching global API key:", err);
      }
    }

    // Fallback to environment variable if still missing
    if (!apiKey && process.env.GEMINI_API_KEY) {
      apiKey = process.env.GEMINI_API_KEY.trim();
      console.log("Gemini Proxy: Using environment variable API Key");
    }

    if (!apiKey) {
      return res.status(400).json({ error: "Missing API Key. Please configure it in Settings or Firestore." });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
      // COMMANDER'S ORDER: Pass the entire body to support systemInstruction, safetySettings etc.
      const { apiKey: _, model: __, ...geminiBody } = req.body;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(geminiBody)
      });

      const data = await response.json();

      if (!response.ok) {
        console.error("Gemini Proxy: API Error:", data);
        return res.status(response.status).json(data);
      }

      res.json(data);
    } catch (error) {
      console.error("Gemini Proxy: Network Error:", error);
      res.status(500).json({ error: "Failed to proxy request to Gemini" });
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
