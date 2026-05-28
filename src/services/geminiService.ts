import { TTSConfig, AudioResult, SRTSubtitle } from "../types";
import { VOICE_OPTIONS, GEMINI_MODELS } from "../constants";
import { formatTime } from "../utils/audioUtils";
import { generateOptimizedSubtitles } from "../utils/subtitleUtils";
import { apiChannelManager } from "./apiChannelManager";

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: {
          data: string;
          mimeType: string;
        };
      }>;
    };
  }>;
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * GeminiTTSService handles integration with Google Generative AI
 */
export class GeminiTTSService {
  private apiKey: string;
  private isAdmin: boolean;

  constructor(apiKey?: string, isAdmin: boolean = false) {
    this.apiKey = apiKey || '';
    this.isAdmin = isAdmin;
  }

  private async geminiRequest(model: string, body: object): Promise<GeminiResponse> {
    const executeRequest = async (key: string) => {
      const url = `${GEMINI_BASE}/${model}:generateContent?key=${key}`;
      console.log(`Gemini Request [${model}]:`, url);
      
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const responseText = await res.text();
        let err;
        try {
          err = JSON.parse(responseText);
        } catch {
          err = { error: { message: responseText || res.statusText, status: res.status } };
        }
        throw err;
      }

      return res.json() as Promise<GeminiResponse>;
    };

    // If we have an explicit apiKey passed to constructor, use it
    if (this.apiKey) {
      return executeRequest(this.apiKey);
    }

    // Otherwise use channel manager which handles auto-switching
    return apiChannelManager.callWithAutoSwitch((key) => executeRequest(key), this.isAdmin);
  }

  public static getActiveKeyIndex(): number {
    return apiChannelManager.getAdminActiveIndex();
  }

  async verifyConnection(): Promise<{ isValid: boolean; status?: number; error?: string }> {
    try {
      await this.geminiRequest(GEMINI_MODELS.VERIFY, {
        contents: [{ parts: [{ text: "ping" }] }]
      });
      return { isValid: true };
    } catch (err: unknown) {
      const error = err as { error?: { message?: string, status?: number } };
      return { 
        isValid: false, 
        error: error.error?.message || "Connection failed", 
        status: error.error?.status 
      };
    }
  }

  async generateTTS(text: string, config: TTSConfig): Promise<AudioResult> {
    const voice = VOICE_OPTIONS.find(v => v.id === config.voiceId) || VOICE_OPTIONS[0];

    const pitchInstruction = config.pitch > 0
      ? `Speak with a noticeably higher pitched, brighter voice tone (+${config.pitch} semitones higher than normal). `
      : config.pitch < 0
      ? `Speak with a noticeably deeper, lower pitched voice tone (${config.pitch} semitones lower than normal). `
      : '';

    const styleInstruction = config.styleInstruction?.trim() || '';
    const combinedInstruction = `${pitchInstruction}${styleInstruction}`.trim();

    const textWithInstruction = combinedInstruction
      ? `[${combinedInstruction}]\n\n${text}`
      : text;

    const body = {
      contents: [{ parts: [{ text: textWithInstruction }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voice.voiceName || "Puck"
            }
          }
        }
      }
    };

    const data = await this.geminiRequest(GEMINI_MODELS.TTS, body);
    const part = data.candidates?.[0]?.content?.parts?.[0];
    const base64Audio = part?.inlineData?.data;

    if (!base64Audio) {
      console.error('No audio in response:', JSON.stringify(data));
      throw new Error('No audio data returned from Gemini candidates');
    }

    // [PCM to WAV CONVERSION]
    const pcmToWavBlob = (base64: string): Blob => {
      const pcm = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const sampleRate = 24000;
      const buf = new ArrayBuffer(44 + pcm.length);
      const view = new DataView(buf);
      const w = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); view.setUint32(4, 36 + pcm.length, true);
      w(8, 'WAVE'); w(12, 'fmt '); view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      w(36, 'data'); view.setUint32(40, pcm.length, true);
      new Uint8Array(buf).set(pcm, 44);
      return new Blob([buf], { type: 'audio/wav' });
    };

    const audioBlob = pcmToWavBlob(base64Audio);
    const audioUrl = URL.createObjectURL(audioBlob);
    const arrayBuffer = await audioBlob.arrayBuffer();

    // Duration estimation for subtitles (Baseline 1x)
    const AudioContextClass = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
    const audioContext = new AudioContextClass();
    const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const totalDuration = decodedBuffer.duration;
    await audioContext.close();

    const subtitles = generateOptimizedSubtitles(text, totalDuration);

    return {
      audioUrl,
      audioData: base64Audio,
      rawAudio: arrayBuffer,
      srtContent: subtitles.map(s => `${s.index}\n${s.startTime} --> ${s.endTime}\n${s.text}\n`).join('\n'),
      subtitles,
      baseDuration: totalDuration,
      oneXDuration: totalDuration,
      speed: 1.0,
      duration: totalDuration
    };
  }

  static parseSRT(srt: string): SRTSubtitle[] {
    const blocks = srt.trim().split(/\n\s*\n/);
    return blocks.map(block => {
      const lines = block.split('\n');
      if (lines.length < 3) return null;
      const index = parseInt(lines[0]);
      if (isNaN(index)) return null;
      const [startTime, endTime] = lines[1].split(' --> ');
      const text = lines.slice(2).join(' ');
      return { index, startTime, endTime, text };
    }).filter((s): s is SRTSubtitle => s !== null);
  }

  private async generateSRTWithGemini(text: string, totalDuration: number): Promise<SRTSubtitle[]> {
    try {
      console.log("TTS Service: Generating optimized subtitles with strict chunking rules...");
      // Using the deterministic chunking logic to ensure strict adherence to character and line limits
      const subtitles = generateOptimizedSubtitles(text, totalDuration);
      
      if (subtitles.length === 0) {
        throw new Error("Generated zero subtitles");
      }
      
      return subtitles;
    } catch (error) {
      console.error("TTS Service: Failed to generate optimized SRT, falling back to mock:", error);
      return this.generateMockSRT(text, totalDuration);
    }
  }

  private generateMockSRT(text: string, totalDuration: number = 0): SRTSubtitle[] {
    const words = text.split(/\s+/);
    const subtitles: SRTSubtitle[] = [];
    const estimatedTotalDuration = totalDuration > 0 ? totalDuration : text.length * 0.1;
    const wordsPerSubtitle = 5;
    const totalChunks = Math.ceil(words.length / wordsPerSubtitle);
    const durationPerChunk = estimatedTotalDuration / Math.max(1, totalChunks);

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

  /**
   * Rewrites content to be unique using gemini-2.5-flash with specific styles
   */
  async rewriteContent(text: string, style: 'conversational' | 'storytelling' | 'news' | 'poetic' | 'educational' = 'conversational'): Promise<string> {
    const stylePrompts = {
      conversational: "Rewrite this Myanmar text to be conversational and natural. Remove formal endings.",
      storytelling: "Rewrite this Myanmar text in a storytelling style. Make it engaging.",
      news: "Rewrite this Myanmar text in a formal news anchor style.",
      poetic: "Rewrite this Myanmar text to be poetic and rhythmic.",
      educational: "Rewrite this Myanmar text using very simple, short sentences."
    };

    const prompt = `${stylePrompts[style]}\n\nOriginal Text:\n${text}\n\nOutput only the rewritten Myanmar text.`;
    const data = await this.geminiRequest(GEMINI_MODELS.REWRITE, {
      contents: [{ parts: [{ text: prompt }] }]
    });
    const textResult = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textResult) throw new Error('No text generated by Gemini');
    return textResult.trim();
  }

  async translateContent(text: string): Promise<string> {
    const prompt = `Translate the following text into natural, cinematic Burmese for high-end video narration: ${text}`;
    const data = await this.geminiRequest(GEMINI_MODELS.TRANSLATE, {
      contents: [{ parts: [{ text: prompt }] }]
    });
    return (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
  }

  async transcribeVideoFile(file: File): Promise<string> {
    return apiChannelManager.callWithAutoSwitch(async (key) => {
      // 1. Upload file using File API
      const uploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${key}`;
      
      const uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'X-Goog-Upload-Command': 'start, upload, finalize',
          'X-Goog-Upload-Header-Content-Length': file.size.toString(),
          'X-Goog-Upload-Header-Content-Type': file.type,
          'Content-Type': 'application/octet-stream'
        },
        body: file
      });

      if (!uploadRes.ok) {
        throw new Error(`File upload failed: ${uploadRes.statusText}`);
      }

      const uploadData = await uploadRes.json();
      const fileUri = uploadData.file.uri;

      // 2. Generate transcript
      // We pass null to geminiRequest to force it to use the external callWithAutoSwitch context if needed,
      // but actually we can just pass the key to geminiRequest if we modify it further,
      // or just re-implement the request here since we have the key.
      const url = `${GEMINI_BASE}/${GEMINI_MODELS.VIDEO}:generateContent?key=${key}`;
      const body = {
        contents: [{
          parts: [
            { fileData: { mimeType: file.type, fileUri } },
            { text: "Transcribe this video in Myanmar language accurately." }
          ]
        }]
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!res.ok) throw new Error("Transcription generation failed");
      const data = await res.json() as GeminiResponse;
      return (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
    });
  }

  async generateImage(prompt: string): Promise<string> {
    const body = {
      contents: [{ parts: [{ text: `Generate thumbnail: ${prompt}` }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"]
      }
    };

    const data = await this.geminiRequest(GEMINI_MODELS.IMAGE, body);
    
    for (const part of data.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData?.mimeType?.startsWith('image/')) {
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }

    throw new Error("No image data received from Gemini candidates");
  }
}

