import { TTSConfig, AudioResult, SRTSubtitle } from "../types";
import { VOICE_OPTIONS, GEMINI_MODELS } from "../constants";
import { formatTime } from "../utils/audioUtils";
import { generateOptimizedSubtitles, generateSubtitlesFromTimestamps } from "../utils/subtitleUtils";
import { apiChannelManager } from "./apiChannelManager";
import { getIdToken } from "../firebase";

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

  constructor(apiKey?: string, isAdmin: boolean = false) {
    this.apiKey = apiKey || '';
    this.isAdmin = isAdmin;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async geminiRequest(modelName: string, body: { contents: any[]; generationConfig?: any }, retryCount: number = 0): Promise<GeminiResponse> {
    const executeRequest = async (key: string) => {
      console.log(`Gemini Proxy Request [${modelName}]. Key:`, key ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : "ADMIN_POOL (Server-side)");
      
      const MAX_RETRIES = 3;

      try {
        const token = await getIdToken();
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        let response: Response;
        try {
          response = await fetch('/api/gemini/proxy', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: modelName,
              contents: body.contents,
              config: body.generationConfig,
              apiKey: key
            })
          });
        } catch (fetchErr) {
          // Network error (Failed to fetch)
          if (retryCount < MAX_RETRIES) {
            const delay = Math.pow(2, retryCount) * 2000 + Math.random() * 1000;
            console.warn(`Gemini Proxy: Network error for ${modelName}. Retrying in ${Math.round(delay)}ms... (${retryCount + 1}/${MAX_RETRIES})`, fetchErr);
            await new Promise(resolve => setTimeout(resolve, delay));
            return this.geminiRequest(modelName, body, retryCount + 1);
          }
          throw fetchErr;
        }

        const contentType = response.headers.get("content-type");
        let data: GeminiResponse & { error?: string; message?: string };

        if (contentType && contentType.includes("application/json")) {
          data = await response.json();
        } else {
          // Handle non-JSON response (likely an HTML error page from proxy or infrastructure)
          const text = await response.text();
          console.error(`Gemini Proxy: Non-JSON response received [${response.status}]:`, text.substring(0, 500));
          
          if ((response.status === 503 || response.status === 504 || response.status === 502) && retryCount < MAX_RETRIES) {
            const delay = Math.pow(2, retryCount) * 2000 + Math.random() * 1000;
            console.warn(`Gemini Proxy: Server error (${response.status}) for ${modelName}. Retrying in ${Math.round(delay)}ms... (${retryCount + 1}/${MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return this.geminiRequest(modelName, body, retryCount + 1);
          }

          throw new Error(`Proxy error (${response.status}): Server returned non-JSON response. This might be a temporary infrastructure issue.`);
        }

        // Handle error status codes with data
        if (!response.ok) {
          const status = response.status;
          const errorMsg = data.error || data.message || response.statusText || "Unknown error";
          
          console.error(`Gemini Proxy Error Response [${modelName}] (${status}):`, data);

          // Retry on certain errors: 429 (Rate Limit), 503 (High Demand/Service Unavailable), 504/502 (Gateway)
          if ((status === 429 || status === 503 || status === 504 || status === 502) && retryCount < MAX_RETRIES) {
            let delay = Math.pow(2, retryCount) * 2000 + Math.random() * 1000;
            
            // If it's a 429, try to parse the retry delay from the error message
            if (status === 429) {
              const retryMatch = errorMsg.match(/retry in ([\d.]+)s/i);
              if (retryMatch && retryMatch[1]) {
                const waitSeconds = parseFloat(retryMatch[1]);
                delay = (waitSeconds + 1) * 1000; // Add 1s buffer
                console.warn(`Gemini Proxy: Rate limited (429). Server requested ${waitSeconds}s wait. Waiting ${Math.round(delay)}ms...`);
              } else {
                console.warn(`Gemini Proxy: Status ${status} for ${modelName}. Retrying in ${Math.round(delay)}ms... (${retryCount + 1}/${MAX_RETRIES})`);
              }
            } else {
              console.warn(`Gemini Proxy: Status ${status} for ${modelName}. Retrying in ${Math.round(delay)}ms... (${retryCount + 1}/${MAX_RETRIES})`);
            }
            
            await new Promise(resolve => setTimeout(resolve, delay));
            return this.geminiRequest(modelName, body, retryCount + 1);
          }
          
          throw new Error(errorMsg);
        }
        
        console.log(`Gemini Proxy Response Keys [${modelName}]:`, Object.keys(data));

        const candidates = data.candidates;

        if (!candidates || candidates.length === 0) {
          console.warn(`Gemini Proxy: No candidates in response for ${modelName}`);
        }
        
        // Map proxy response back to our internal GeminiResponse interface
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
        console.error(`Gemini Proxy Error [${modelName}]:`, err);
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

  async generateTTS(
    text: string, 
    config: TTSConfig, 
    onFirstChunk?: (result: AudioResult) => void,
    onProgress?: (current: number, total: number, message: string) => void
  ): Promise<AudioResult> {
    const chunks = this.splitIntoChunks(text, 1000); 
    console.log(`TTS Service: Splitting text into ${chunks.length} chunks for controlled generation...`);

    if (chunks.length <= 1) {
      if (onProgress) onProgress(1, 1, "အသံထုတ်ယူနေပါသည်...");
      return this.generateSingleTTS(text, config);
    }

    const results: AudioResult[] = [];
    const DELAY_BETWEEN_CHUNKS = 10000; // 10 seconds delay to respect 10 RPM limit
    
    console.log(`TTS Service: Processing ${chunks.length} chunks sequentially with ${DELAY_BETWEEN_CHUNKS}ms delay...`);
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkNum = i + 1;
      
      if (onProgress) onProgress(chunkNum, chunks.length, `အပိုင်း ${chunkNum}/${chunks.length} ကို ထုတ်ယူနေပါသည်...`);
      
      let retryCount = 0;
      const MAX_CHUNK_RETRIES = 3;
      let success = false;
      let lastError = null;

      while (retryCount <= MAX_CHUNK_RETRIES && !success) {
        try {
          // Wrap request in a 60s timeout
          const timeoutPromise = new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error(`TTS chunk ${i} timed out after 60s`)), 60000)
          );

          const result = await Promise.race([
            this.generateSingleTTS(chunk, config),
            timeoutPromise
          ]);

          if (i === 0 && onFirstChunk) {
            onFirstChunk(result);
          }

          results.push(result);
          success = true;
          
          if (i < chunks.length - 1) {
            const nextChunkNum = i + 2;
            if (onProgress) onProgress(chunkNum, chunks.length, `အပိုင်း ${nextChunkNum}/${chunks.length} အတွက် စောင့်ဆိုင်းနေပါသည် (၁၀ စက္ကန့်)...`);
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CHUNKS));
          }
        } catch (error: unknown) {
          lastError = error;
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          // Check for retryable quota error
          if (
            errorMessage.includes("429") || 
            errorMessage.includes("503") ||
            errorMessage.includes("quota") || 
            errorMessage.includes("RESOURCE_EXHAUSTED")
          ) {
            // Check if the error message already has a specific wait time parsed from geminiRequest
            const retryMatch = errorMessage.match(/retry in ([\d.]+)s/i);
            let backoffDelay = Math.pow(2, retryCount) * 10000; // 10s, 20s, 40s...
            
            if (retryMatch && retryMatch[1]) {
               backoffDelay = (parseFloat(retryMatch[1]) + 2) * 1000;
            }

            retryCount++;
            if (retryCount <= MAX_CHUNK_RETRIES) {
              if (onProgress) onProgress(chunkNum, chunks.length, `API အသုံးပြုမှု များနေပါသည်။ ${Math.round(backoffDelay/1000)} စက္ကန့်အကြာတွင် နောက်တစ်ကြိမ် ကြိုးစားပါမည်...`);
              await new Promise(resolve => setTimeout(resolve, backoffDelay));
              continue;
            }
          }
          
          // Non-retryable or max retries reached
          console.error(`TTS Service: Generation failed at chunk ${i}:`, errorMessage);
          if (
            errorMessage.includes("429") || 
            errorMessage.includes("quota") || 
            errorMessage.includes("RESOURCE_EXHAUSTED") ||
            errorMessage.includes("API quota ကုန်သွားပါပြီ")
          ) {
            throw new Error("API အသုံးပြုမှု ကန့်သတ်ချက် ပြည့်နေသည်။ မိနစ်အနည်းငယ် စောင့်ပြီး ထပ်ကြိုးစားပါ");
          }
          throw error;
        }
      }
      
      if (!success && lastError) {
        throw lastError;
      }
    }

    console.log(`TTS Service: All ${results.length} chunks generated successfully.`);
    return this.mergeAudioResults(results);
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

    // Check for timestamps to handle them correctly
    const hasTimestamps = /\[\d{1,2}:\d{1,2}\.\d{3}\]/.test(text);
    const audioText = hasTimestamps ? text.replace(/\[\d{1,2}:\d{1,2}\.\d{3}\]/g, "").trim() : text;

    const textWithInstruction = combinedInstruction
      ? `[${combinedInstruction}]\n\n${audioText}`
      : audioText;

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
      totalDuration = audioText.length * 0.08;
    } finally {
      await audioContext.close();
    }

    const subtitles = hasTimestamps 
      ? generateSubtitlesFromTimestamps(text, totalDuration)
      : generateOptimizedSubtitles(audioText, totalDuration);

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

  async translateContent(text: string, style: string = 'Movie Recap', tone: string = '', duration: string = 'Medium'): Promise<string> {
    const prompt = `
      You are a professional video recap scriptwriter for the Myanmar audience.
      Translate and adapt the following source text into natural, engaging, and cinematic Burmese video narration.

      STYLE: ${style}
      TONE/INSTRUCTION: ${tone || 'Professional and engaging'}
      TARGET DURATION: ${duration}

      Source Text:
      ${text}

      Guidelines:
      - Use natural, spoken Burmese (vernacular) instead of overly formal literary Burmese.
      - Keep and reuse the original timestamps in the translated output (e.g., [00:01.200] Translated Text).
      - Ensure the flow matches the ${style} style.
      - Output ONLY the translated Myanmar text with timestamps.
    `;
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
            { text: "Transcribe this video in Myanmar language accurately with timestamps. Output the transcription in a clear format like '[00:01.200] စာသား' for each major sentence or phrase. Output only the transcription." }
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

