import { GoogleGenAI, Modality } from "@google/genai";
import { TTSConfig, AudioResult, SRTSubtitle } from "../types";
import { GEMINI_MODELS, VOICE_OPTIONS } from "../constants";
import { pcmToWav, formatTime, applyAudioEffects } from "../utils/audioUtils";

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
      let processedBytes = bytes;
      if (config.effects) {
        console.log("TTS Service: Applying post-processing effects...");
        processedBytes = await applyAudioEffects(bytes, config.effects, 24000);
      }

      const wavBlob = pcmToWav(processedBytes, 24000);
      const audioUrl = URL.createObjectURL(wavBlob);
      
      // Calculate actual duration for accurate timing sync
      const totalDuration = processedBytes.length / (24000 * 2); // 2 bytes per sample (16-bit)
      
      console.log(`TTS Service: Audio generated. Duration: ${totalDuration.toFixed(2)}s. Generating SRT...`);
      
      const subtitles = await this.generateSRTWithGemini(text, totalDuration);
      const srtContent = subtitles.map(s => 
        `${s.index}\n${s.startTime} --> ${s.endTime}\n${s.text}\n`
      ).join('\n');

      // Convert processed bytes back to base64 for history/download
      let processedBase64 = base64Audio;
      if (config.effects) {
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < processedBytes.length; i += chunkSize) {
          binary += String.fromCharCode.apply(null, Array.from(processedBytes.subarray(i, i + chunkSize)));
        }
        processedBase64 = window.btoa(binary);
      }

      return {
        audioUrl,
        audioData: processedBase64,
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

  private async generateSRTWithGemini(text: string, totalDuration: number): Promise<SRTSubtitle[]> {
    try {
      console.log("TTS Service: Requesting Gemini to generate optimized SRT...");
      const prompt = `Generate a standard SRT subtitle content for the following text. 
      The total duration of the audio is exactly ${totalDuration.toFixed(2)} seconds.
      
      STRICT INSTRUCTIONS:
      1. Each subtitle segment (SRT block) must not exceed 7-10 words per line.
      2. Break longer sentences into multiple smaller segments while maintaining natural pauses.
      3. Keep the SRT format clean. Avoid having more than 2 lines of text per timestamp.
      4. For Myanmar language, ensure the word-breaking (syllable breaking) is natural and doesn't cut words in the middle of a meaning.
      5. Distribute the timestamps (start and end) accurately across the total duration of ${totalDuration.toFixed(2)} seconds based on the text length and natural speaking pace.
      6. Output ONLY the raw SRT content, no extra text, no markdown code blocks, no preamble.
      
      Text to process:
      ${text}`;

      const response = await this.ai.models.generateContent({
        model: GEMINI_MODELS.VERIFY,
        contents: [{ parts: [{ text: prompt }] }]
      });

      const srtText = response.text || '';
      const parsed = GeminiTTSService.parseSRT(srtText);
      
      if (parsed.length === 0) {
        throw new Error("Gemini returned empty or invalid SRT format");
      }
      
      return parsed;
    } catch (error) {
      console.error("TTS Service: Failed to generate SRT with Gemini, falling back to mock:", error);
      return this.generateMockSRT(text, totalDuration);
    }
  }

  private generateMockSRT(text: string, totalDuration: number = 0): SRTSubtitle[] {
    // Improved mock splitting for Myanmar (simple space split is bad, but we try to be better)
    const words = text.split(/\s+/);
    const subtitles: SRTSubtitle[] = [];
    
    // If we have totalDuration, we can distribute it better
    const estimatedTotalDuration = totalDuration > 0 ? totalDuration : text.length * 0.1;
    const wordsPerSubtitle = 5;
    const totalChunks = Math.ceil(words.length / wordsPerSubtitle);
    const durationPerChunk = estimatedTotalDuration / totalChunks;

    let currentTime = 0;

    for (let i = 0; i < words.length; i += wordsPerSubtitle) {
      const chunk = words.slice(i, i + wordsPerSubtitle).join(' ');
      
      subtitles.push({
        index: Math.floor(i / wordsPerSubtitle) + 1,
        startTime: formatTime(currentTime),
        endTime: formatTime(currentTime + durationPerChunk),
        text: chunk
      });
      
      currentTime += durationPerChunk;
    }

    return subtitles;
  }
}
