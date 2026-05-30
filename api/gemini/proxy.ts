import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Add CORS headers for production
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { model, contents, config, apiKey: providedKey, selectedModel, isTts } = req.body;

    let targetModel = selectedModel || model;

    if (!targetModel) {
      return res.status(400).json({ error: 'Model name is required' });
    }

    // Map friendly value to actual preview modelName only for TTS requests
    if (isTts) {
      if (targetModel === 'gemini-3.1-flash-tts' || targetModel === 'gemini-3.1-flash-tts-preview') {
        targetModel = 'gemini-3.1-flash-tts-preview';
      }
    }

    const isTwoStepTts = isTts && (targetModel === 'gemini-2.5-flash' || targetModel === 'gemini-3.1-flash-lite' || targetModel === 'gemini-3.1-flash-lite-8b');

    // Use provided key or fallback to environment variable
    const apiKey = providedKey || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(400).json({ error: 'No API Key available.' });
    }

    if (isTwoStepTts) {
      let firstStepModel = targetModel;
      // Optimization: For 3.1 Lite, use it directly as it has high quota. 
      // We only fallback to 2.5 flash if needed, but 3.1 lite is preferred if selected.
      if (firstStepModel === 'gemini-3.1-flash-lite-8b') {
        firstStepModel = 'gemini-3.1-flash-lite';
      }

      // Step 1: Clean/Strip audio args to prevent 400 Bad Request
      const textOnlyConfig: Record<string, unknown> = config ? { ...config } : {};
      delete textOnlyConfig.responseModalities;
      delete textOnlyConfig.speechConfig;
      delete textOnlyConfig.responseMimeType;

      console.log(`[Proxy Vercel] Two-step TTS Step 1: Generating text with standard model: ${firstStepModel}`);
      const textResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${firstStepModel}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents, generationConfig: textOnlyConfig })
        }
      );

      const textData = await textResponse.json();
      if (!textResponse.ok) {
        console.error(`[Proxy Vercel] Gemini Step 1 Error (${textResponse.status}):`, textData);
        return res.status(textResponse.status).json(textData);
      }

      const generatedText = textData.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!generatedText) {
        return res.status(400).json({ error: "No text generated from standard Gemini model in Step 1 of TTS pipeline" });
      }

      console.log(`[Proxy Vercel] Two-step TTS Step 1 text output received: "${generatedText.substring(0, 50)}..."`);

      // Grab style instruction if present
      let styleMatch = "";
      const originalText = contents?.[0]?.parts?.[0]?.text || "";
      if (typeof originalText === "string" && originalText.startsWith("[")) {
        const closingBracketIndex = originalText.indexOf("]");
        if (closingBracketIndex !== -1) {
          styleMatch = originalText.substring(0, closingBracketIndex + 1);
        }
      }

      const ttsText = styleMatch ? `${styleMatch}\n\n${generatedText}` : generatedText;
      const ttsContents = [{ parts: [{ text: ttsText }] }];

      const ttsConfig: Record<string, unknown> = config ? { ...config } : {};
      ttsConfig.responseModalities = ["AUDIO"];

      console.log(`[Proxy Vercel] Two-step TTS Step 2: Pitching to dedicated audio pipeline gemini-3.1-flash-tts-preview`);
      const ttsResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: ttsContents, generationConfig: ttsConfig })
        }
      );

      const ttsData = await ttsResponse.json();
      if (!ttsResponse.ok) {
        console.error(`[Proxy Vercel] Gemini Step 2 Error (${ttsResponse.status}):`, ttsData);
        return res.status(ttsResponse.status).json(ttsData);
      }

      return res.status(200).json(ttsData);
    } else {
      const updatedConfig: Record<string, unknown> = config ? { ...config } : {};
      if (isTts) {
        updatedConfig.responseModalities = ["AUDIO"];
      }

      console.log(`[Proxy Vercel] Requesting model: ${targetModel}`);

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json' 
          },
          body: JSON.stringify({ 
            contents, 
            generationConfig: updatedConfig 
          })
        }
      );

      const data = await response.json();
      
      if (!response.ok) {
        console.error(`[Proxy Vercel] Gemini API Error (${response.status}):`, data);
        return res.status(response.status).json(data);
      }

      return res.status(200).json(data);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    console.error('[Proxy Vercel] Serverless Error:', error);
    return res.status(500).json({ 
      error: message,
      details: error
    });
  }
}
