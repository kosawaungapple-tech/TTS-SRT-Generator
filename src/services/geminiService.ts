import { GoogleGenAI, Modality } from "@google/genai";
import { TTSConfig, AudioResult, SRTSubtitle } from "../types";
import { GEMINI_MODELS, VOICE_OPTIONS } from "../constants";
import { pcmToWav, formatTime } from "../utils/audioUtils";

export class GeminiTTSService {
  private ai: GoogleGenAI;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.ai = new GoogleGenAI({ apiKey });
  }

  async verifyConnection(): Promise<boolean> {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1/models?key=${this.apiKey}`,
        { method: 'GET' }
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  async generateTTS(text: string, config: TTSConfig, forceMock: boolean = false): Promise<AudioResult & { isSimulation?: boolean }> {
    console.log("TTS Service: Starting generation...", { forceMock, textLength: text.length });

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
    
    console.log("TTS Service: Sending request to Gemini API via @google/genai...");

    try {
      const response = await this.ai.models.generateContent({
        model: GEMINI_MODELS.TTS,
        contents: [{ parts: [{ text: `Narrate the following text in a natural, clear, and cinematic ${language} ${voice.gender} voice. Ensure word-for-word accuracy and do not summarize: ${text}` }] }],
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
      });

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
      console.error("TTS Service: Real API call failed, falling back to simulation mode", err);
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
