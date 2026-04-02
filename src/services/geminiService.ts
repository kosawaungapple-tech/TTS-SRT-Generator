import { GoogleGenAI, Modality } from "@google/genai";
import { TTSConfig, AudioResult, SRTSubtitle } from "../types";
import { GEMINI_MODELS, VOICE_OPTIONS } from "../constants";
import { pcmToWav, formatTime } from "../utils/audioUtils";

export class GeminiTTSService {
  private ai: GoogleGenAI;
  private apiKeys: string[];
  private currentKeyIndex: number = 0;

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

    console.log("GeminiTTSService: Initialized with", this.apiKeys.length, "keys");
    this.ai = new GoogleGenAI({ apiKey: this.apiKeys[0] });
  }

  private rotateKey(): boolean {
    if (this.apiKeys.length <= 1) return false;
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
    const nextKey = this.apiKeys[this.currentKeyIndex];
    this.ai = new GoogleGenAI({ apiKey: nextKey });
    console.log(`GeminiTTSService: Rotated to key index ${this.currentKeyIndex} (Starts with ${nextKey.substring(0, 4)}...)`);
    return true;
  }

  async verifyConnection(): Promise<{ isValid: boolean; status?: number; error?: string }> {
    if (!this.apiKeys[this.currentKeyIndex]) {
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
      currentKeyIndex: this.currentKeyIndex
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
        `${s.index}\n${s.startTime} --> ${s.endTime}\n${s.text}\n`
      ).join('\n');

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

    if (!this.apiKeys[this.currentKeyIndex]) {
      console.error("TTS Service: API Key missing, falling back to simulation");
      return await runMock();
    }

    const voice = VOICE_OPTIONS.find(v => v.id === config.voiceId) || VOICE_OPTIONS[0];
    const language = voice.name.split(' ')[0];
    
    // Request Validation (Error 400 Fix)
    const speed = Math.max(0.25, Math.min(4.0, parseFloat(String(config.speed)) || 1.0));
    const pitch = Math.max(-20.0, Math.min(20.0, parseFloat(String(config.pitch)) || 0.0));
    const volume = Math.max(0, Math.min(100, parseFloat(String(config.volume)) || 80));
    const volumeGainDb = Math.max(-96.0, Math.min(16.0, -96.0 + (volume / 100) * 112.0));

    const payload = {
      model: GEMINI_MODELS.TTS,
      contents: [{ parts: [{ text: `Narrate the following text in a natural, clear, and cinematic ${language} ${voice.gender} voice. 
      Speaking rate: ${speed.toFixed(2)}x. 
      Pitch: ${pitch.toFixed(1)}. 
      Volume: ${volume}%.
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

    let attempts = 0;
    const maxAttempts = this.apiKeys.length;

    while (attempts < maxAttempts) {
      try {
        console.log(`TTS Service: Sending request (Attempt ${attempts + 1}/${maxAttempts}) using key index ${this.currentKeyIndex}`);
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
        
        const subtitles = this.generateMockSRT(text, actualDuration);
        const srtContent = subtitles.map(s => 
          `${s.index}\n${s.startTime} --> ${s.endTime}\n${s.text}\n`
        ).join('\n');

        console.log("TTS Service: API generation successful", { actualDuration });
        return {
          audioUrl,
          audioData: base64Audio,
          srtContent,
          subtitles
        };
      } catch (err: any) {
        const isRateLimit = err.status === 429 || (err.message && err.message.includes('429')) || (err.details && err.details.includes('429'));
        
        if (isRateLimit && attempts < maxAttempts - 1) {
          console.warn(`TTS Service: Rate limit hit (429) on key index ${this.currentKeyIndex}. Rotating key...`);
          this.rotateKey();
          attempts++;
          continue;
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
    const words = text.split(/\s+/);
    const subtitles: SRTSubtitle[] = [];
    const wordsPerSubtitle = 5;
    const chunks: string[] = [];

    for (let i = 0; i < words.length; i += wordsPerSubtitle) {
      chunks.push(words.slice(i, i + wordsPerSubtitle).join(' '));
    }

    const totalChars = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    
    // If totalDuration is not provided, estimate it (approx 15 chars per second)
    const effectiveDuration = totalDuration || (totalChars / 15);
    
    let currentTime = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      // Calculate weight based on character length
      const weight = chunk.length / totalChars;
      const duration = weight * effectiveDuration;
      
      subtitles.push({
        index: i + 1,
        startTime: formatTime(currentTime),
        endTime: formatTime(currentTime + duration),
        text: chunk
      });
      
      currentTime += duration;
    }

    return subtitles;
  }
}
