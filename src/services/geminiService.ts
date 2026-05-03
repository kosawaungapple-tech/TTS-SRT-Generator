import { GoogleGenAI, Modality } from "@google/genai";
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

/**
 * GeminiTTSService handles integration with Google Generative AI
 */
export class GeminiTTSService {
  private apiKey: string;
  private isAdmin: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private ai: any = null;

  constructor(apiKey?: string, isAdmin: boolean = false) {
    this.apiKey = apiKey || '';
    this.isAdmin = isAdmin;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getAI(key: string): any {
    if (!this.ai || this.apiKey !== key) {
      this.ai = new GoogleGenAI({ apiKey: key });
    }
    return this.ai;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async geminiRequest(modelName: string, body: { contents: any[]; generationConfig?: any }): Promise<GeminiResponse> {
    const executeRequest = async (key: string) => {
      const ai = this.getAI(key);
      const modelPath = modelName;
      
      console.log(`Gemini SDK Request [${modelName}]:`, modelPath, "Key:", key ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : "MISSING");
      
      try {
        const result = await ai.models.generateContent({
          model: modelPath,
          contents: body.contents,
          config: body.generationConfig
        });
        
        // Some SDK versions might wrap the response
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response = (result as any).response || result;
        
        console.log(`Gemini SDK Response Keys [${modelName}]:`, Object.keys(response));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!response.candidates && (result as any).candidates) {
          console.log(`Gemini SDK: Candidates found in root instead of response wrapper`);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const candidates = response.candidates || (result as any).candidates;

        if (!candidates || candidates.length === 0) {
          console.warn(`Gemini SDK: No candidates in response for ${modelName}`);
          // Log more of the response object manually if JSON.stringify is failing us
          console.log(`Gemini SDK: Full Response Object Keys:`, Object.keys(result));
          if (response.text) console.log(`Gemini SDK: Response has text:`, response.text.substring(0, 50));
        }
        
        // Map SDK response back to our internal GeminiResponse interface
        return {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          candidates: candidates?.map((c: any) => ({
            content: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              parts: c.content?.parts?.map((p: any) => ({
                text: p.text,
                inlineData: p.inlineData ? {
                  data: p.inlineData.data,
                  mimeType: p.inlineData.mimeType
                } : undefined
              }))
            }
          }))
        } as GeminiResponse;
      } catch (err) {
        console.error(`Gemini SDK Error [${modelName}]:`, err);
        throw err;
      }
    };

    if (this.apiKey) {
      return executeRequest(this.apiKey);
    }

    return apiChannelManager.callWithAutoSwitch((key) => executeRequest(key), false, this.isAdmin);
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

  private convertPCMToWav(base64PCM: string, sampleRate: number = 24000): Blob {
    const pcmBytes = Uint8Array.from(atob(base64PCM), c => c.charCodeAt(0));
    const wavBuffer = new ArrayBuffer(44 + pcmBytes.length);
    const view = new DataView(wavBuffer);

    // WAV header
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + pcmBytes.length, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);       // PCM format
    view.setUint16(22, 1, true);       // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, pcmBytes.length, true);

    // Copy PCM data
    new Uint8Array(wavBuffer, 44).set(pcmBytes);

    return new Blob([wavBuffer], { type: 'audio/wav' });
  }

  async generateTTS(text: string, config: TTSConfig, onFirstChunk?: (result: AudioResult) => void): Promise<AudioResult> {
    const chunks = this.splitIntoChunks(text, 250); // Split into ~250 char chunks (slightly more than 200 for better context)
    console.log(`TTS Service: Splitting text into ${chunks.length} chunks for parallel generation...`);

    if (chunks.length <= 1) {
      return this.generateSingleTTS(text, config);
    }

    // Generate all chunks in parallel with a timeout
    const chunkPromises = chunks.map((chunk, index) => {
      // Wrap each request in a 30s timeout as requested
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error(`TTS chunk ${index} timed out after 30s`)), 30000)
      );

      return Promise.race([
        this.generateSingleTTS(chunk, config),
        timeoutPromise
      ]);
    });

    try {
      // Special handling for first chunk to play fast
      if (onFirstChunk) {
        chunkPromises[0].then(firstResult => {
          console.log("TTS Service: First chunk ready, triggering callback...");
          onFirstChunk(firstResult);
        }).catch(err => console.error("TTS Service: First chunk failed:", err));
      }

      const results = await Promise.all(chunkPromises);
      console.log(`TTS Service: All ${results.length} chunks generated successfully.`);

      // Combine results
      return this.mergeAudioResults(results);
    } catch (error) {
      console.error("TTS Service: Parallel generation failed, falling back to single request:", error);
      return this.generateSingleTTS(text, config);
    }
  }

  private splitIntoChunks(text: string, maxChars: number): string[] {
    const chunks: string[] = [];
    // Split by Myanmar full stop (။), comma (၊), or newline.
    const sentences = text.split(/([။၊\n])/g);
    
    let currentChunk = "";
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      if (!s) continue;
      
      // If s is just a punctuation mark from the split group
      if (s === "။" || s === "၊" || s === "\n") {
        currentChunk += s;
        continue;
      }

      if (currentChunk.length + s.length > maxChars) {
        if (currentChunk.trim()) chunks.push(currentChunk.trim());
        currentChunk = s;
      } else {
        currentChunk += s;
      }
    }
    
    if (currentChunk.trim()) chunks.push(currentChunk.trim());
    return chunks;
  }

  private async generateSingleTTS(text: string, config: TTSConfig): Promise<AudioResult> {
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
        responseModalities: [Modality.AUDIO],
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
    const audioPart = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    const base64Audio = audioPart?.data;

    if (!base64Audio) {
      console.error('No audio in response:', JSON.stringify(data));
      throw new Error('No audio data returned from Gemini');
    }

    const audioBlob = this.convertPCMToWav(base64Audio, 24000);
    const audioUrl = URL.createObjectURL(audioBlob);
    const arrayBuffer = await audioBlob.arrayBuffer();

    const AudioContextClass = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
    const audioContext = new AudioContextClass();
    let totalDuration = 0;
    try {
      const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      totalDuration = decodedBuffer.duration;
    } catch (e) {
      console.warn("Failed to decode audio duration, using estimation", e);
      totalDuration = text.length * 0.08;
    } finally {
      await audioContext.close();
    }

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

  private mergeAudioResults(results: AudioResult[]): AudioResult {
    // 1. Merge PCM data
    let totalLength = 0;
    const pcmChunks: Uint8Array[] = [];
    
    for (const res of results) {
      const binaryString = atob(res.audioData);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      pcmChunks.push(bytes);
      totalLength += bytes.length;
    }

    const mergedPCM = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of pcmChunks) {
      mergedPCM.set(chunk, offset);
      offset += chunk.length;
    }

    // Convert merged PCM to Base64
    let binary = "";
    const len = mergedPCM.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(mergedPCM[i]);
    }
    const base64Audio = btoa(binary);

    // 2. Merge Subtitles
    let cumulativeTime = 0;
    const allSubtitles: SRTSubtitle[] = [];
    const srtParts: string[] = [];
    
    results.forEach((res) => {
      res.subtitles.forEach((sub) => {
        const start = this.parseTimestampToSeconds(sub.startTime) + cumulativeTime;
        const end = this.parseTimestampToSeconds(sub.endTime) + cumulativeTime;
        
        const newSub = {
          ...sub,
          index: allSubtitles.length + 1,
          startTime: formatTime(start),
          endTime: formatTime(end)
        };
        allSubtitles.push(newSub);
        srtParts.push(`${newSub.index}\n${newSub.startTime} --> ${newSub.endTime}\n${newSub.text}\n`);
      });
      cumulativeTime += res.duration;
    });

    const audioBlob = this.convertPCMToWav(base64Audio, 24000);
    const audioUrl = URL.createObjectURL(audioBlob);

    return {
      audioUrl,
      audioData: base64Audio,
      rawAudio: mergedPCM.buffer,
      srtContent: srtParts.join('\n'),
      subtitles: allSubtitles,
      baseDuration: cumulativeTime,
      oneXDuration: cumulativeTime,
      speed: 1.0,
      duration: cumulativeTime
    };
  }

  private parseTimestampToSeconds(timestamp: string): number {
    const [hms, ms] = timestamp.split(',');
    const [h, m, s] = hms.split(':').map(Number);
    return h * 3600 + m * 60 + s + (Number(ms) / 1000);
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

  private async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = (e) => reject(new Error(`File reading failed: ${e}`));
      reader.readAsDataURL(file);
    });
  }

  async transcribeVideoFile(file: File): Promise<string> {
    console.log(`[VBS Video] Starting transcription using inline base64 for: ${file.name} (${file.size} bytes)`);
    
    // Check for size limit (Gemini inline data limit is ~20MB)
    const MAX_INLINE_SIZE = 20 * 1024 * 1024;
    if (file.size > MAX_INLINE_SIZE) {
      throw new Error(`File too large for direct processing (${(file.size / 1024 / 1024).toFixed(1)}MB). Please use a file smaller than 20MB.`);
    }

    try {
      const base64Data = await this.fileToBase64(file);
      console.log(`[VBS Video] File converted to base64, requesting transcription...`);

      const body = {
        contents: [{
          parts: [
            {
              inlineData: {
                mimeType: file.type || 'video/mp4',
                data: base64Data
              }
            },
            { text: "Transcribe this video in Myanmar language accurately. Output only the transcription text, formatted nicely." }
          ]
        }]
      };

      const data = await this.geminiRequest(GEMINI_MODELS.VIDEO, body);
      const resultText = (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
      
      if (!resultText) {
        console.warn(`[VBS Video] Gemini returned empty response`);
        return "No transcription could be generated for this video.";
      }

      console.log(`[VBS Video] Transcription successful!`);
      return resultText;
    } catch (error) {
      console.error(`[VBS Video] Error in transcribeVideoFile:`, error);
      throw error;
    }
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

