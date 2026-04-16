import { GoogleGenAI, Modality } from "@google/genai";
import { TTSConfig, AudioResult, SRTSubtitle } from "../types";
import { GEMINI_MODELS, VOICE_OPTIONS } from "../constants";
import { pcmToWav, formatTime } from "../utils/audioUtils";

export class GeminiTTSService {
  private ai: GoogleGenAI;
  private apiKeys: string[];
  private static currentKeyIndex: number = 0;
  private static keyStatuses: { [index: number]: { isRateLimited: boolean; lastUsed: number } } = {};

  constructor(apiKeys?: string | string[]) {
    if (Array.isArray(apiKeys)) {
      this.apiKeys = apiKeys.filter(k => k.trim()).map(k => k.trim());
    } else {
      const rawKey = apiKeys || (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : '') || '';
      // Support comma-separated keys if passed as string
      this.apiKeys = rawKey.split(',').map(k => k.trim()).filter(k => k);
    }

    if (this.apiKeys.length === 0) {
      this.apiKeys = [''];
    }

    // Initialize statuses if not already present
    this.apiKeys.forEach((_, i) => {
      if (!GeminiTTSService.keyStatuses[i]) {
        GeminiTTSService.keyStatuses[i] = { isRateLimited: false, lastUsed: 0 };
      }
    });

    console.log("GeminiTTSService: Initialized with", this.apiKeys.length, "keys");
    this.ai = new GoogleGenAI({ apiKey: this.apiKeys[GeminiTTSService.currentKeyIndex] || this.apiKeys[0], apiVersion: 'v1beta' });
  }

  public static getActiveKeyIndex(): number {
    return GeminiTTSService.currentKeyIndex;
  }

  public getKeyCount(): number {
    return this.apiKeys.length;
  }

  private rotateKey(): boolean {
    if (this.apiKeys.length <= 1) return false;
    
    // Mark current key as rate limited
    GeminiTTSService.keyStatuses[GeminiTTSService.currentKeyIndex].isRateLimited = true;
    GeminiTTSService.keyStatuses[GeminiTTSService.currentKeyIndex].lastUsed = Date.now();

    // Find next available key that isn't rate limited (or the one that was limited longest ago)
    let nextIndex = (GeminiTTSService.currentKeyIndex + 1) % this.apiKeys.length;
    let found = false;
    
    // Try to find a non-limited key
    for (let i = 0; i < this.apiKeys.length; i++) {
      const idx = (GeminiTTSService.currentKeyIndex + 1 + i) % this.apiKeys.length;
      if (!GeminiTTSService.keyStatuses[idx].isRateLimited) {
        nextIndex = idx;
        found = true;
        break;
      }
    }

    // If all are limited, just pick the next one anyway (it might have recovered)
    if (!found) {
      nextIndex = (GeminiTTSService.currentKeyIndex + 1) % this.apiKeys.length;
    }

    GeminiTTSService.currentKeyIndex = nextIndex;
    const nextKey = this.apiKeys[GeminiTTSService.currentKeyIndex];
    this.ai = new GoogleGenAI({ apiKey: nextKey, apiVersion: 'v1beta' });
    console.log(`GeminiTTSService: Rotated to key index ${GeminiTTSService.currentKeyIndex} (Starts with ${nextKey.substring(0, 4)}...)`);
    return true;
  }

  async verifyConnection(): Promise<{ isValid: boolean; status?: number; error?: string }> {
    if (!this.apiKeys[GeminiTTSService.currentKeyIndex]) {
      console.error("GeminiTTSService: Cannot verify connection - Current API Key is empty");
      return { isValid: false, error: "Empty API Key" };
    }

    try {
      console.log("GeminiTTSService: Verifying connection with models.list...");
      const response = await this.ai.models.list();
      
      if (response) {
        return { isValid: true };
      } else {
        return { isValid: false, error: "No response from models.list" };
      }
    } catch (err: any) {
      console.error("GeminiTTSService: Verification failed:", err);
      return { isValid: false, error: err.message, status: err.status };
    }
  }

  async generateTTS(text: string, config: TTSConfig, forceMock: boolean = false): Promise<AudioResult & { isSimulation?: boolean }> {
    console.log("TTS Service: Starting generation...", { 
      forceMock, 
      textLength: text.length,
      keyCount: this.apiKeys.length,
      currentKeyIndex: GeminiTTSService.currentKeyIndex
    });

    const runMock = async () => {
      console.log("TTS Service: Running in SIMULATION mode");
      await new Promise(resolve => setTimeout(resolve, 1500)); // Brief delay for realism
      
      // Estimate duration for simulation (approx 15 chars per second)
      const estimatedDuration = Math.max(2, text.length / 15);
      const sampleRate = 24000;
      const numSamples = Math.floor(estimatedDuration * sampleRate);
      const dummyBytes = new Uint8Array(numSamples * 2); // 16-bit PCM
      
      const wavBlob = pcmToWav(dummyBytes, sampleRate);
      const audioUrl = URL.createObjectURL(wavBlob);
      const subtitles = this.generateMockSRT(text, estimatedDuration);
      const srtContent = subtitles.map(s => 
        `${s.index}\n${s.startTime} --> ${s.endTime}\n${s.text}`
      ).join('\n\n') + '\n\n';

      console.log("TTS Service: Simulation generation successful", { estimatedDuration });
      return {
        audioUrl,
        audioData: "MOCK_DATA",
        srtContent,
        subtitles,
        isSimulation: true
      };
    };

    if (forceMock) {
      return await runMock();
    }

    if (!this.apiKeys[GeminiTTSService.currentKeyIndex]) {
      console.error("TTS Service: API Key missing, falling back to simulation");
      return await runMock();
    }

    const voiceId = config.voiceId || 'zephyr';
    const voice = VOICE_OPTIONS.find(v => v.id === voiceId) || VOICE_OPTIONS[0];
    const language = voice.name.split(' ')[0];
    
    // Request Validation (Error 400 Fix)
    const speed = Math.max(0.25, Math.min(4.0, parseFloat(String(config.speed)) || 1.0));
    const pitch = Math.max(-20.0, Math.min(20.0, parseFloat(String(config.pitch)) || 0.0));
    const volume = Math.max(0, Math.min(100, parseFloat(String(config.volume)) || 80));

    const styleCmd = config.styleInstruction?.trim() 
      ? `Command: ${config.styleInstruction.trim()}. Now, read the following text: ` 
      : "Narrate the following text in a natural, clear, and cinematic voice. ";

    const targetDuration = config.targetDuration;
    const totalTargetSeconds = targetDuration ? (targetDuration.minutes * 60 + targetDuration.seconds) : 0;
    
    const durationConstraint = totalTargetSeconds > 0
      ? `You are a speed-controlled narrator. Current text MUST be narrated to fit EXACTLY into ${totalTargetSeconds} seconds. 
         If the text is too long, you MUST speak faster. If it's too short, you MUST add pauses. 
         DO NOT exceed the limit by even one second. 
         You are a professional voice actor. You MUST time your speech to finish EXACTLY at ${targetDuration?.minutes} minutes and ${targetDuration?.seconds} seconds (${totalTargetSeconds} seconds). Do not finish early, do not finish late. 
         Adjust the narration speed and word count accordingly to hit the target duration with 100% precision.`
      : "";

    const payload = {
      model: config.model || GEMINI_MODELS.TTS,
      contents: [{ parts: [{ text: `${styleCmd}
      Language: ${language}.
      Gender: ${voice.gender}.
      Speaking rate: ${speed.toFixed(2)}x. 
      Pitch: ${pitch.toFixed(1)}. 
      Volume: ${volume}%.
      ${durationConstraint}
      Ensure word-for-word accuracy and do not summarize: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voice.voiceName
            }
          }
        }
      }
    };

    console.log("TTS Service: API Payload", JSON.stringify(payload, null, 2));

    let attempts = 0;
    const maxAttempts = this.apiKeys.length;

    while (attempts < maxAttempts) {
      try {
        console.log(`TTS Service: Sending request (Attempt ${attempts + 1}/${maxAttempts}) using key index ${GeminiTTSService.currentKeyIndex}`);
        const response = await this.ai.models.generateContent(payload);

        console.log("TTS Service: Received response from API");

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

        if (!base64Audio) {
          throw new Error('No audio data received from Gemini');
        }

        const binaryString = window.atob(base64Audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        // Gemini TTS returns raw PCM (24000Hz, 16-bit, mono)
        const sampleRate = 24000;
        const wavBlob = pcmToWav(bytes, sampleRate);
        const audioUrl = URL.createObjectURL(wavBlob);
        
        // Calculate actual duration: bytes / (sampleRate * bytesPerSample * channels)
        // 16-bit mono = 2 bytes per sample
        const actualDuration = bytes.length / (sampleRate * 2);
        
        const effectiveDuration = totalTargetSeconds > 0 ? totalTargetSeconds : actualDuration;
        const subtitles = this.generateMockSRT(text, effectiveDuration);
        const srtContent = subtitles.map(s => 
          `${s.index}\n${s.startTime} --> ${s.endTime}\n${s.text}`
        ).join('\n\n') + '\n\n';

        console.log("TTS Service: API generation successful", { actualDuration });
        return {
          audioUrl,
          audioData: base64Audio,
          srtContent,
          subtitles
        };
      } catch (err: any) {
        const isRateLimit = err.status === 429 || 
                          (err.message && err.message.includes('429')) || 
                          (err.details && err.details.includes('429')) ||
                          (err.message && err.message.toLowerCase().includes('rate limit'));
        
        if (isRateLimit && attempts < maxAttempts - 1) {
          console.warn(`TTS Service: Rate limit hit (429) on key index ${GeminiTTSService.currentKeyIndex}. Rotating key...`);
          this.rotateKey();
          attempts++;
          continue;
        }

        if (isRateLimit && attempts >= maxAttempts - 1) {
          throw new Error("RATE_LIMIT_EXHAUSTED");
        }

        console.error("TTS Service: API call failed.", {
          message: err.message,
          status: err.status,
          attempts: attempts + 1
        });
        
        // If we've exhausted all keys or it's not a rate limit error, fallback to mock
        return await runMock();
      }
    }

    return await runMock();
  }

  async rewriteContent(text: string): Promise<string> {
    console.log("GeminiTTSService: Rewriting content...");
    
    if (!this.apiKeys[GeminiTTSService.currentKeyIndex]) {
      throw new Error("No API Key available for rewriting");
    }

    const prompt = `You are a professional Burmese content creator. Paraphrase the following text to be unique, engaging, and copyright-safe. Use a natural storytelling tone. Original text: ${text}`;

    let attempts = 0;
    const maxAttempts = this.apiKeys.length;

    while (attempts < maxAttempts) {
      try {
        const response = await this.ai.models.generateContent({
          model: GEMINI_MODELS.REWRITE,
          contents: prompt,
        });

        const resultText = response.text;
        if (!resultText) {
          throw new Error("No text returned from Gemini");
        }

        return resultText.trim();
      } catch (err: any) {
        const isRateLimit = err.status === 429 || (err.message && err.message.includes('429'));
        
        if (isRateLimit && attempts < maxAttempts - 1) {
          this.rotateKey();
          attempts++;
          continue;
        }

        if (isRateLimit && attempts >= maxAttempts - 1) {
          throw new Error("RATE_LIMIT_EXHAUSTED");
        }
        throw err;
      }
    }
    throw new Error("Failed to rewrite content after all attempts");
  }

  async translateContent(text: string): Promise<string> {
    console.log("GeminiTTSService: Translating content...");
    
    if (!this.apiKeys[GeminiTTSService.currentKeyIndex]) {
      throw new Error("No API Key available for translation");
    }

    const prompt = `Translate the provided text into Natural, Cinematic, and Professional storytelling Burmese. Use a tone suitable for high-end video narration. Ensure the phrasing is concise and readable for subtitles. Original: ${text}`;

    let attempts = 0;
    const maxAttempts = this.apiKeys.length;

    while (attempts < maxAttempts) {
      try {
        const response = await this.ai.models.generateContent({
          model: GEMINI_MODELS.TRANSLATE,
          contents: prompt,
        });

        const resultText = response.text;
        if (!resultText) {
          throw new Error("No text returned from Gemini");
        }

        return resultText.trim();
      } catch (err: any) {
        const isRateLimit = err.status === 429 || (err.message && err.message.includes('429'));
        
        if (isRateLimit && attempts < maxAttempts - 1) {
          this.rotateKey();
          attempts++;
          continue;
        }

        if (isRateLimit && attempts >= maxAttempts - 1) {
          throw new Error("RATE_LIMIT_EXHAUSTED");
        }
        throw err;
      }
    }
    throw new Error("Failed to translate content after all attempts");
  }

  async transcribeVideo(videoBase64: string, mimeType: string): Promise<string> {
    console.log("GeminiTTSService: Transcribing video...");
    
    if (!this.apiKeys[GeminiTTSService.currentKeyIndex]) {
      throw new Error("No API Key available for transcription");
    }

    const prompt = "Listen to this video carefully. Transcribe every word spoken. Output the result in a clean script format. Do not include timestamps, just the spoken text.";

    let attempts = 0;
    const maxAttempts = this.apiKeys.length;

    while (attempts < maxAttempts) {
      try {
        const response = await this.ai.models.generateContent({
          model: GEMINI_MODELS.REWRITE,
          contents: {
            parts: [
              { inlineData: { data: videoBase64, mimeType } },
              { text: prompt }
            ]
          },
        });

        const resultText = response.text;
        if (!resultText) {
          throw new Error("No text returned from Gemini");
        }

        return resultText.trim();
      } catch (err: any) {
        const isRateLimit = err.status === 429 || (err.message && err.message.includes('429'));
        
        if (isRateLimit && attempts < maxAttempts - 1) {
          this.rotateKey();
          attempts++;
          continue;
        }

        if (isRateLimit && attempts >= maxAttempts - 1) {
          throw new Error("RATE_LIMIT_EXHAUSTED");
        }
        throw err;
      }
    }
    throw new Error("Failed to transcribe video after all attempts");
  }

  static parseSRT(srt: string): SRTSubtitle[] {
    const blocks = srt.trim().split(/\n\s*\n/);
    return blocks.map(block => {
      const lines = block.split('\n');
      if (lines.length < 3) return null;
      const index = parseInt(lines[0]);
      const [startTime, endTime] = lines[1].split(' --> ');
      const text = lines.slice(2).join(' ');
      return { index, startTime, endTime, text };
    }).filter((s): s is SRTSubtitle => s !== null);
  }

  private generateMockSRT(text: string, totalDuration?: number): SRTSubtitle[] {
    // Clean text and handle multiple spaces
    const cleanText = text.replace(/\s+/g, ' ').trim();
    
    // Burmese text often doesn't have spaces. 
    // We'll split by spaces first, then further split long chunks by characters.
    const words = cleanText.split(' ');
    const chunks: string[] = [];
    const MAX_CHARS_PER_LINE = 48; // Target 45-50
    const MAX_WORDS_PER_LINE = 10; // Target 10-12 Burmese words (if space-separated)

    let currentChunk = "";
    let wordCountInChunk = 0;

    for (const word of words) {
      // If adding this word exceeds character limit or word limit
      if ((currentChunk.length + word.length + 1 > MAX_CHARS_PER_LINE && currentChunk.length > 0) || 
          (wordCountInChunk >= MAX_WORDS_PER_LINE)) {
        chunks.push(currentChunk);
        currentChunk = word;
        wordCountInChunk = 1;
      } else {
        currentChunk = currentChunk ? `${currentChunk} ${word}` : word;
        wordCountInChunk++;
      }

      // Handle extremely long words (e.g. long Burmese strings without spaces)
      while (currentChunk.length > MAX_CHARS_PER_LINE) {
        chunks.push(currentChunk.substring(0, MAX_CHARS_PER_LINE));
        currentChunk = currentChunk.substring(MAX_CHARS_PER_LINE);
        wordCountInChunk = 1; // Reset word count for the remainder
      }
    }
    if (currentChunk) chunks.push(currentChunk);

    const subtitles: SRTSubtitle[] = [];
    const totalChars = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    
    // If totalDuration is not provided, estimate it (approx 15 chars per second)
    const effectiveDuration = totalDuration || (totalChars / 15);
    
    let currentTime = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      // Calculate weight based on character length
      const weight = chunk.length / totalChars;
      let duration = weight * effectiveDuration;
      
      // Ensure the last subtitle ends EXACTLY at the effectiveDuration
      let endTime = currentTime + duration;
      if (i === chunks.length - 1) {
        endTime = effectiveDuration;
      }
      
      subtitles.push({
        index: i + 1,
        startTime: formatTime(currentTime),
        endTime: formatTime(endTime),
        text: chunk
      });
      
      currentTime = endTime;
    }

    return subtitles;
  }
}
