import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import helmet from "helmet";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";

const firebaseConfig = JSON.parse(
  fs.readFileSync(new URL("./firebase-applet-config.json", import.meta.url), "utf-8")
);

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const db = getFirestore(firebaseConfig.firestoreDatabaseId);

// Authentication Middleware
const authenticate = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    (req as any).user = decodedToken;
    next();
  } catch (error) {
    console.error('Error verifying ID token:', error);
    res.status(401).json({ error: 'Unauthorized' });
  }
};

// Helper: Fetch with Retry
async function fetchWithRetry(url: string, options: any, retries = 3, backoff = 1000): Promise<any> {
  try {
    const response = await fetch(url, options);
    if (!response.ok && retries > 0 && (response.status === 429 || response.status >= 500)) {
      console.warn(`Fetch failed with ${response.status}. Retrying in ${backoff}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoff));
      return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
    return response;
  } catch (error) {
    if (retries > 0) {
      console.warn(`Fetch error: ${error}. Retrying in ${backoff}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoff));
      return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
    throw error;
  }
}

// Helper: Get Best API Key from Firestore
async function getBestApiKey(type: string, req: express.Request) {
  try {
    const keysSnapshot = await db.collection('api_keys')
      .where('type', '==', type)
      .where('is_active', '==', true)
      .where('is_full', '==', false)
      .orderBy('usage_count', 'asc')
      .limit(1)
      .get();

    if (keysSnapshot.empty) return null;

    const keyDoc = keysSnapshot.docs[0];
    const data = keyDoc.data();
    return {
      key: data.key,
      index: data.index || 0,
      id: keyDoc.id
    };
  } catch (error) {
    console.error(`Error getting best ${type} API key:`, error);
    return null;
  }
}

// Helper: Mark Key as Full
async function markKeyAsFull(type: string, index: number) {
  try {
    const keysSnapshot = await db.collection('api_keys')
      .where('type', '==', type)
      .where('index', '==', index)
      .limit(1)
      .get();

    if (!keysSnapshot.empty) {
      await keysSnapshot.docs[0].ref.update({ 
        is_full: true, 
        last_full_at: admin.firestore.FieldValue.serverTimestamp() 
      });
    }
  } catch (error) {
    console.error(`Error marking ${type} key #${index} as full:`, error);
  }
}

// Helper: Increment Key Usage
async function incrementKeyUsage(type: string, index: number) {
  try {
    const keysSnapshot = await db.collection('api_keys')
      .where('type', '==', type)
      .where('index', '==', index)
      .limit(1)
      .get();

    if (!keysSnapshot.empty) {
      await keysSnapshot.docs[0].ref.update({ 
        usage_count: admin.firestore.FieldValue.increment(1),
        last_used_at: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  } catch (error) {
    console.error(`Error incrementing ${type} key #${index} usage:`, error);
  }
}

// Security Audit Log Helper
const logSecurityEvent = async (userId: string, email: string, action: string, details: any) => {
  try {
    await db.collection('security_logs').add({
      userId,
      email,
      action,
      details,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ip: 'server-side',
    });
  } catch (error) {
    console.error('Failed to log security event:', error);
  }
};

const app = express();

async function startServer() {
  const PORT = 3000;

  // 1. Content Security Policy (CSP) and Security Headers
  const frameAncestors = [
    "'self'",
    process.env.APP_URL,
    process.env.SHARED_APP_URL,
    "https://ai.studio",
    "https://*.google.com",
    "https://*.run.app"
  ].filter(Boolean) as string[];

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://apis.google.com", "https://www.gstatic.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "https://picsum.photos", "https://*.googleusercontent.com", "https://www.gstatic.com"],
        connectSrc: ["'self'", "https://*.googleapis.com", "https://*.firebaseio.com", "wss://*.run.app"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        objectSrc: ["'none'"],
        frameAncestors: frameAncestors,
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,
    frameguard: false, // Allow embedding in AI Studio iframe
  }));

  // 2. CORS Restriction
  const allowedOrigins = [
    process.env.APP_URL,
    process.env.SHARED_APP_URL,
    'http://localhost:3000',
  ].filter(Boolean) as string[];

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }));

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

  // General Telegram Notification Endpoint
  app.post("/api/telegram/send", async (req, res) => {
    const { message, config } = req.body;
    
    let botToken = config?.telegram_bot_token?.trim();
    let chatId = config?.telegram_chat_id?.trim();

    // If not provided in body, try to get from Firestore (Global Config)
    if (!botToken || !chatId) {
      try {
        const systemConfigDoc = await db.collection('settings').doc('global_config').get();
        if (systemConfigDoc.exists) {
          const data = systemConfigDoc.data();
          if (!botToken && data?.telegram_bot_token) botToken = data.telegram_bot_token.trim();
          if (!chatId && data?.telegram_chat_id) chatId = data.telegram_chat_id.trim();
        }
      } catch (err) {
        console.error("Error fetching system config for Telegram:", err);
      }
    }

    if (!botToken || !chatId) {
      return res.status(400).json({ error: "Telegram configuration missing" });
    }

    // Remove 'bot' prefix if user accidentally included it
    if (botToken.toLowerCase().startsWith('bot')) {
      botToken = botToken.substring(3);
    }

    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML'
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.description || `Telegram API error: ${response.status}`);
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error sending Telegram notification:", error);
      res.status(500).json({ error: error.message || "Failed to send notification" });
    }
  });

  // Telegram Webhook Handler
  app.post("/api/telegram/webhook", async (req, res) => {
    const update = req.body;
    if (!update || !update.message) return res.sendStatus(200);

    const { message } = update;
    const chatId = message.chat.id.toString();
    const text = message.text || "";

    try {
      // Get system config to verify chat ID and get bot token
      const systemConfigDoc = await db.collection('settings').doc('global_config').get();
      if (!systemConfigDoc.exists) return res.sendStatus(200);
      
      const config = systemConfigDoc.data();
      const authorizedChatId = config?.telegram_chat_id?.trim();
      let botToken = config?.telegram_bot_token?.trim();

      if (!botToken || !authorizedChatId) return res.sendStatus(200);
      if (chatId !== authorizedChatId) {
        console.warn(`Unauthorized Telegram access attempt from Chat ID: ${chatId}`);
        return res.sendStatus(200);
      }

      if (botToken.toLowerCase().startsWith('bot')) {
        botToken = botToken.substring(3);
      }

      const sendResponse = async (replyText: string) => {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: replyText,
            parse_mode: 'HTML'
          })
        });
      };

      // Command Parsing
      if (text === "/start") {
        await sendResponse(
          `👋 <b>Welcome to Vlogs By Saw Admin Bot</b>\n\n` +
          `Available Commands:\n` +
          `• <code>/status [id]</code> - Check user status\n` +
          `• <code>/activate [id] [days]</code> - Activate and extend expiry\n` +
          `• <code>/deactivate [id]</code> - Deactivate user\n` +
          `• <code>/users</code> - List active users`
        );
      } else if (text.startsWith("/status ")) {
        const userId = text.split(" ")[1];
        if (!userId) return await sendResponse("❌ Please provide a User ID.");
        
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) return await sendResponse(`❌ User <code>${userId}</code> not found.`);
        
        const userData = userDoc.data();
        await sendResponse(
          `👤 <b>User Status: ${userId}</b>\n\n` +
          `<b>Name:</b> ${userData?.name}\n` +
          `<b>Status:</b> ${userData?.isActive ? '✅ Active' : '❌ Inactive'}\n` +
          `<b>Expiry:</b> ${new Date(userData?.expiryDate).toLocaleString()}\n` +
          `<b>Created:</b> ${new Date(userData?.createdAt).toLocaleDateString()}`
        );
      } else if (text.startsWith("/activate ")) {
        const parts = text.split(" ");
        const userId = parts[1];
        const days = parseInt(parts[2] || "30");

        if (!userId) return await sendResponse("❌ Please provide a User ID.");
        
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) return await sendResponse(`❌ User <code>${userId}</code> not found.`);
        
        const userData = userDoc.data();
        const currentExpiry = new Date(userData?.expiryDate);
        const baseDate = currentExpiry < new Date() ? new Date() : currentExpiry;
        baseDate.setDate(baseDate.getDate() + days);

        await db.collection('users').doc(userId).update({
          isActive: true,
          expiryDate: baseDate.toISOString()
        });

        await sendResponse(
          `✅ <b>User Activated: ${userId}</b>\n\n` +
          `<b>New Expiry:</b> ${baseDate.toLocaleString()}\n` +
          `<b>Days Added:</b> ${days}`
        );
      } else if (text.startsWith("/deactivate ")) {
        const userId = text.split(" ")[1];
        if (!userId) return await sendResponse("❌ Please provide a User ID.");
        
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) return await sendResponse(`❌ User <code>${userId}</code> not found.`);

        await db.collection('users').doc(userId).update({
          isActive: false
        });

        await sendResponse(`❌ <b>User Deactivated: ${userId}</b>`);
      } else if (text === "/users") {
        const usersSnapshot = await db.collection('users').where('isActive', '==', true).get();
        if (usersSnapshot.empty) return await sendResponse("No active users found.");

        let userList = "👥 <b>Active Users:</b>\n\n";
        usersSnapshot.forEach(doc => {
          const data = doc.data();
          userList += `• <code>${doc.id}</code> (${data.name}) - Exp: ${new Date(data.expiryDate).toLocaleDateString()}\n`;
        });
        await sendResponse(userList);
      }

    } catch (err: any) {
      console.error("Telegram Webhook Error:", err);
    }

    res.sendStatus(200);
  });

  // Setup Telegram Webhook
  app.post("/api/telegram/setup-webhook", async (req, res) => {
    const { config } = req.body;
    let botToken = config?.telegram_bot_token?.trim();

    if (!botToken) {
      try {
        const systemConfigDoc = await db.collection('settings').doc('global_config').get();
        if (systemConfigDoc.exists) {
          botToken = systemConfigDoc.data()?.telegram_bot_token?.trim();
        }
      } catch (err) {
        console.error("Error fetching system config for Webhook Setup:", err);
      }
    }

    if (!botToken) {
      return res.status(400).json({ error: "Bot Token missing" });
    }

    if (botToken.toLowerCase().startsWith('bot')) {
      botToken = botToken.substring(3);
    }

    const appUrl = process.env.APP_URL || "";
    if (!appUrl) {
      return res.status(400).json({ error: "App URL missing in environment" });
    }

    const webhookUrl = `${appUrl}/api/telegram/webhook`;

    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook?url=${webhookUrl}`);
      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.description || `Telegram API error: ${response.status}`);
      }

      res.json({ success: true, description: data.description });
    } catch (error: any) {
      console.error("Error setting Telegram webhook:", error);
      res.status(500).json({ error: error.message || "Failed to set webhook" });
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
    let activeKeyIndex = -1;
    let isUsingGlobalKey = false;

    // If no API key provided by user, try to get from Firestore (Global Config)
    if (!apiKey) {
      try {
        const bestKeyData = await getBestApiKey('gemini', req);
        if (bestKeyData) {
          apiKey = bestKeyData.key;
          activeKeyIndex = bestKeyData.index;
          isUsingGlobalKey = true;
          console.log(`Gemini Proxy: Using Global Key #${activeKeyIndex + 1}`);
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

    const maxKeyRetries = isUsingGlobalKey ? 3 : 1;
    let keyRetries = 0;

    while (keyRetries < maxKeyRetries) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      try {
        const { apiKey: _, model: __, ...geminiBody } = req.body;
        
        const response = await fetchWithRetry(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(geminiBody)
        });

        const data = await response.json();

        if (!response.ok) {
          // If Quota/Rate Limit error and using global key, rotate and retry
          if ((response.status === 429 || response.status === 403) && isUsingGlobalKey && activeKeyIndex !== -1) {
            console.warn(`Gemini Proxy: Key #${activeKeyIndex + 1} failed with ${response.status}. Rotating...`);
            await markKeyAsFull('gemini', activeKeyIndex);
            
            const nextKeyData = await getBestApiKey('gemini', req);
            if (nextKeyData) {
              apiKey = nextKeyData.key;
              activeKeyIndex = nextKeyData.index;
              keyRetries++;
              continue;
            }
          }
          
          console.error("Gemini Proxy: API Error:", data);
          return res.status(response.status).json(data);
        }

        // Success! Increment usage count if global key
        if (isUsingGlobalKey && activeKeyIndex !== -1) {
          await incrementKeyUsage('gemini', activeKeyIndex);
        }

        return res.json(data);
      } catch (error) {
        console.error("Gemini Proxy: Network Error:", error);
        return res.status(500).json({ error: "Failed to proxy request to Gemini" });
      }
    }
    
    res.status(500).json({ error: "All available Gemini API keys are exhausted." });
  });

  // Gemini TTS Proxy (Returns Binary Audio)
  app.post("/api/tts", authenticate, async (req, res) => {
    let { apiKey, text, config } = req.body;
    let activeKeyIndex = -1;
    let isUsingGlobalKey = false;

    if (!apiKey) {
      try {
        const bestKeyData = await getBestApiKey('gemini', req); // TTS uses Gemini keys
        if (bestKeyData) {
          apiKey = bestKeyData.key;
          activeKeyIndex = bestKeyData.index;
          isUsingGlobalKey = true;
          console.log(`Gemini TTS Proxy: Using Global Key #${activeKeyIndex + 1}`);
        }
      } catch (err) {
        console.error("Gemini TTS Proxy: Error fetching global API key from Firestore:", err);
      }
    }

    if (!apiKey && process.env.GEMINI_API_KEY) {
      apiKey = process.env.GEMINI_API_KEY.trim();
    }

    if (!apiKey) {
      return res.status(400).json({ error: "Missing API Key" });
    }

    const model = "gemini-2.5-flash-preview-tts";
    const maxKeyRetries = isUsingGlobalKey ? 3 : 1;
    let keyRetries = 0;

    while (keyRetries < maxKeyRetries) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      try {
        const geminiBody = {
          contents: [{ 
            parts: [{ 
              text: text 
            }] 
          }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: config.voiceName
                }
              }
            }
          }
        };

        const response = await fetchWithRetry(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiBody)
        });

        const data = await response.json();

        if (!response.ok) {
          // If Quota/Rate Limit error and using global key, rotate and retry
          if ((response.status === 429 || response.status === 403) && isUsingGlobalKey && activeKeyIndex !== -1) {
            console.warn(`Gemini TTS Proxy: Key #${activeKeyIndex + 1} failed with ${response.status}. Rotating...`);
            await markKeyAsFull('gemini', activeKeyIndex);
            
            const nextKeyData = await getBestApiKey('gemini', req);
            if (nextKeyData) {
              apiKey = nextKeyData.key;
              activeKeyIndex = nextKeyData.index;
              keyRetries++;
              continue;
            }
          }

          console.error("Gemini TTS Proxy: API Error:", JSON.stringify(data));
          return res.status(response.status).json(data);
        }

        // Success! Increment usage count if global key
        if (isUsingGlobalKey && activeKeyIndex !== -1) {
          await incrementKeyUsage('gemini', activeKeyIndex);
        }

        const base64Audio = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        const audioMimeType = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.mimeType;
        
        if (!base64Audio) {
          console.error("Gemini TTS Proxy: No audio data in response", JSON.stringify(data));
          return res.status(500).json({ error: "No audio data received from Gemini" });
        }

        console.log(`Gemini TTS Proxy: Received audio data. MimeType: ${audioMimeType}, Base64 Length: ${base64Audio.length}`);

        let binaryString = Buffer.from(base64Audio, 'base64');
        
        // Ensure even length for 16-bit PCM
        if (binaryString.length % 2 !== 0) {
          console.warn(`Gemini TTS Proxy: Audio data length is odd (${binaryString.length}). Truncating last byte.`);
          binaryString = binaryString.subarray(0, binaryString.length - 1);
        }
        
        // Convert PCM to WAV
        const sampleRate = 24000;
        const numChannels = 1;
        const bitsPerSample = 16;
        const byteRate = sampleRate * numChannels * bitsPerSample / 8;
        const blockAlign = numChannels * bitsPerSample / 8;
        
        const wavHeader = Buffer.alloc(44);
        
        // RIFF identifier
        wavHeader.write('RIFF', 0);
        // File length (36 + data length)
        wavHeader.writeUInt32LE(36 + binaryString.length, 4);
        // RIFF type
        wavHeader.write('WAVE', 8);
        // Format chunk identifier
        wavHeader.write('fmt ', 12);
        // Format chunk length
        wavHeader.writeUInt32LE(16, 16);
        // Sample format (1 is PCM)
        wavHeader.writeUInt16LE(1, 20);
        // Channel count
        wavHeader.writeUInt16LE(numChannels, 22);
        // Sample rate
        wavHeader.writeUInt32LE(sampleRate, 24);
        // Byte rate
        wavHeader.writeUInt32LE(byteRate, 28);
        // Block align
        wavHeader.writeUInt16LE(blockAlign, 32);
        // Bits per sample
        wavHeader.writeUInt16LE(bitsPerSample, 34);
        // Data chunk identifier
        wavHeader.write('data', 36);
        // Data chunk length
        wavHeader.writeUInt32LE(binaryString.length, 40);

        const wavFile = Buffer.concat([wavHeader, binaryString]);

        console.log(`Gemini TTS Proxy: Sending WAV file. Total Size: ${wavFile.length} bytes`);
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Content-Length', wavFile.length);
        return res.send(wavFile);
      } catch (error) {
        console.error("Gemini TTS Proxy: Network Error:", error);
        return res.status(500).json({ error: "Failed to proxy request to Gemini" });
      }
    }
    
    res.status(500).json({ error: "All available Gemini API keys are exhausted for TTS." });
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
