import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Modality } from "@google/genai";

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

    console.log(`[Proxy Vercel] Request received for model: ${targetModel}, isTts: ${isTts}`);

    if (!targetModel) {
      return res.status(400).json({ error: 'Model name is required' });
    }

    // Map friendly value to actual preview modelName only for TTS requests
    if (isTts) {
      if (targetModel === 'gemini-3.1-flash-tts' || targetModel === 'gemini-3.1-flash-tts-preview' || targetModel === 'TTS') {
        targetModel = 'gemini-3.1-flash-tts-preview';
      }
    }

    const isTwoStepTts = isTts && (targetModel === 'gemini-2.5-flash' || targetModel === 'gemini-3.1-flash-lite' || targetModel === 'gemini-3.1-flash-lite-8b');

    // Use provided key or fallback to environment variable
    const apiKey = providedKey || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(400).json({ error: 'No API Key available.' });
    }

    // Initialize SDK
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });

    if (isTwoStepTts) {
      let firstStepModel = targetModel;
      if (firstStepModel === 'gemini-3.1-flash-lite-8b') {
        firstStepModel = 'gemini-3.1-flash-lite';
      }

      // Step 1: Generate text
      const textOnlyConfig = config ? JSON.parse(JSON.stringify(config)) : {};
      delete textOnlyConfig.responseModalities;
      delete textOnlyConfig.speechConfig;
      delete textOnlyConfig.responseMimeType;

      console.log(`[Proxy Vercel] Two-step TTS Step 1: Generating text with: ${firstStepModel}`);
      
      const textResult = await ai.models.generateContent({
        model: firstStepModel,
        contents,
        config: Object.keys(textOnlyConfig).length > 0 ? textOnlyConfig : undefined
      });

      const generatedText = textResult.text;
      if (!generatedText) {
        return res.status(400).json({ error: "No text generated from standard Gemini model in Step 1 of TTS pipeline" });
      }

      // Grab style instruction
      let styleMatch = "";
      const firstPart = contents?.[0]?.parts?.[0];
      const originalText = typeof firstPart === 'string' ? firstPart : firstPart?.text || "";
      
      if (typeof originalText === "string" && originalText.startsWith("[")) {
        const closingBracketIndex = originalText.indexOf("]");
        if (closingBracketIndex !== -1) {
          styleMatch = originalText.substring(0, closingBracketIndex + 1);
        }
      }

      const ttsText = styleMatch ? `${styleMatch}\n\n${generatedText}` : generatedText;
      const ttsContents = [{ role: 'user', parts: [{ text: ttsText }] }];
      const ttsConfig = config ? JSON.parse(JSON.stringify(config)) : {};
      ttsConfig.responseModalities = [Modality.AUDIO];

      console.log(`[Proxy Vercel] Two-step TTS Step 2: Audio pipeline gemini-3.1-flash-tts-preview`);
      const ttsResult = await ai.models.generateContent({
        model: 'gemini-3.1-flash-tts-preview',
        contents: ttsContents,
        config: ttsConfig
      });

      return res.status(200).json(ttsResult);
    } else {
      const updatedConfig = config ? JSON.parse(JSON.stringify(config)) : {};
      if (isTts) {
        updatedConfig.responseModalities = [Modality.AUDIO];
      }

      console.log(`[Proxy Vercel] Requesting model via SDK: ${targetModel}`);
      
      const requestParams = {
        model: targetModel,
        contents,
        config: Object.keys(updatedConfig).length > 0 ? updatedConfig : undefined
      };

      const result = await ai.models.generateContent(requestParams);
      return res.status(200).json(result);
    }
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string };
    console.error('[Proxy Vercel] SDK Error:', error);
    
    // Extract details from SDK error
    const status = error.status || 500;
    const message = error.message || 'Internal Server Error';
    
    // Attempt to stringify the error object more thoroughly for the client
    const errorString = JSON.stringify(err, Object.getOwnPropertyNames(err as object));
    const errorObj = JSON.parse(errorString);

    return res.status(status).json({ 
      error: message,
      details: errorObj,
      rawError: String(err)
    });
  }
}
