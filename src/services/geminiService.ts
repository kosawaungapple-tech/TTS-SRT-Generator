import { GoogleGenAI, Modality } from "@google/genai";
import { TTSConfig, AudioResult, SRTSubtitle } from "../types";
import { GEMINI_MODELS, VOICE_OPTIONS } from "../constants";
import { pcmToWav, formatTime } from "../utils/audioUtils";

export class GeminiTTSService {
  private ai: GoogleGenAI;
  private apiKey: string;

  constructor(apiKey?: string) {
    const rawKey = apiKey || (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : '') || '';
    this.apiKey = rawKey.trim();
    console.log("GeminiTTSService: Initialized with key:", this.apiKey ? `Present (Starts with ${this.apiKey.substring(0, 4)}...)` : "Missing");
    this.ai = new GoogleGenAI({ apiKey: this.apiKey });
  }

  async verifyConnection(): Promise<{ isValid: boolean; status?: number; error?: string }> {
    if (!this.apiKey) {
      console.error("GeminiTTSService: Cannot verify connection - API Key is empty");
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
      hasKey: !!this.apiKey,
      keyPreview: this.apiKey ? `${this.apiKey.substring(0, 4)}...` : 'none'
    });

    const runMock = async () => {
      console.log("TTS Service: Running in SIMULATION mode");
      await new Promise(resolve => setTimeout(resolve, 1500)); // Brief delay for realism
      
      const dummyBytes = new Uint8Array(24000);
      const wavBlob = pcmToWav(dummyBytes, 24000);
      const audioUrl = URL.createObjectURL(wavBlob);
      const subtitles = this.generateMockSRT(text);
      const srtContent = subtitles.map(s => 
        `${s.index}\n${s.startTime} --> ${s.endTime}\n${s.text}\n`
      ).join('\n');

      console.log("TTS Service: Simulation generation successful");
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

    if (!this.apiKey) {
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

    console.log("TTS Service: Sending request to Gemini API via @google/genai...", { speed, pitch, volumeGainDb });

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

    console.log("TTS Service: API Payload (Simplified):", JSON.stringify(payload, null, 2));

    try {
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
      const wavBlob = pcmToWav(bytes, 24000);
      const audioUrl = URL.createObjectURL(wavBlob);
      const subtitles = this.generateMockSRT(text);
      const srtContent = subtitles.map(s => 
        `${s.index}\n${s.startTime} --> ${s.endTime}\n${s.text}\n`
      ).join('\n');

      return {
        audioUrl,
        audioData: base64Audio,
        srtContent,
        subtitles
      };
    } catch (err: any) {
      // Debugging: Capture exact error message from Google API response
      console.error("TTS Service: Real API call failed (Error 400 check). Full error details:", {
        message: err.message,
        status: err.status,
        statusText: err.statusText,
        details: err.details || err.response?.data?.error || "No extra details",
        stack: err.stack,
        rawError: err
      });
      // Fallback to mock if it's a network error, timeout, or CORS issue
      return await runMock();
    }
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

  private generateMockSRT(text: string): SRTSubtitle[] {
    const words = text.split(/\s+/);
    const subtitles: SRTSubtitle[] = [];
    let currentTime = 0;
    const wordsPerSubtitle = 5;

    for (let i = 0; i < words.length; i += wordsPerSubtitle) {
      const chunk = words.slice(i, i + wordsPerSubtitle).join(' ');
      const duration = chunk.length * 0.1; // Rough estimate
      
      subtitles.push({
        index: Math.floor(i / wordsPerSubtitle) + 1,
        startTime: formatTime(currentTime),
        endTime: formatTime(currentTime + duration),
        text: chunk
      });
      
      currentTime += duration + 0.5;
    }

    return subtitles;
  }
}
