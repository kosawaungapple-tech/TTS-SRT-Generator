import { TTSConfig, AudioResult, SRTSubtitle } from "../types";
import { VOICE_OPTIONS, GEMINI_MODELS } from "../constants";
import { formatTime, pcmToWav } from "../utils/audioUtils";
import { generateOptimizedSubtitles, generateSubtitlesFromTimestamps } from "../utils/subtitleUtils";
import { apiChannelManager } from "./apiChannelManager";
import { getIdToken } from "../firebase";
import { ttsCache } from "./ttsCache";

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

  private async geminiRequest(
    modelName: string, 
    body: { contents: unknown[]; generationConfig?: unknown }, 
    retryCount: number = 0,
    onRetry?: (seconds: number, message: string) => void
  ): Promise<GeminiResponse> {
    const executeRequest = async (key: string) => {
      console.log(`Gemini Proxy Request [${modelName}]. Key:`, key ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : "ADMIN_POOL (Server-side)");
      
      const MAX_RETRIES = 5; // Increased retries for better stability

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
            if (onRetry) onRetry(Math.round(delay / 1000), `Network error. Retrying in ${Math.round(delay/1000)}s...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return this.geminiRequest(modelName, body, retryCount + 1, onRetry);
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
          const isStartingPage = text.includes("<title>Starting Server...") || text.includes("Starting Server...");
          
          console.error(`Gemini Proxy: Non-JSON response received [${response.status}]:`, text.substring(0, 500));
          
          // Retry on certain errors or platform splash pages (Starting Server...)
          if ((response.status === 200 || response.status === 500 || response.status === 503 || response.status === 504 || response.status === 502) && retryCount < MAX_RETRIES) {
            const delay = Math.pow(2, retryCount) * 2000 + Math.random() * 1000;
            const statusMsg = isStartingPage ? "Server starting..." : `Server error (${response.status})`;
            console.warn(`Gemini Proxy: ${statusMsg} for ${modelName}. Retrying in ${Math.round(delay)}ms... (${retryCount + 1}/${MAX_RETRIES})`);
            if (onRetry) onRetry(Math.round(delay / 1000), `${statusMsg}. Retrying in ${Math.round(delay/1000)}s...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return this.geminiRequest(modelName, body, retryCount + 1, onRetry);
          }

          throw new Error(`Proxy error (${response.status}): Server returned non-JSON response.`);
        }

        // Handle error status codes with data
        if (!response.ok) {
          const status = response.status;
          const errorMsg = data.error || data.message || response.statusText || "Unknown error";
          
          console.error(`Gemini Proxy Error Response [${modelName}] (${status}):`, data);

          // Retry on certain errors: 429 (Rate Limit), 500 (Internal), 503 (High Demand/Service Unavailable), 504/502 (Gateway)
          if ((status === 429 || status === 500 || status === 503 || status === 504 || status === 502) && retryCount < MAX_RETRIES) {
            let delay = Math.pow(2, retryCount) * 2000 + Math.random() * 1000;
            
            // If it's a 429, try to parse the retry delay from the error message or details
            if (status === 429) {
              const retryMatch = errorMsg.match(/retry in ([\d.]+)s/i) || errorMsg.match(/after ([\d.]+)s/i);
              let waitSeconds = 0;
              
              if (retryMatch && retryMatch[1]) {
                waitSeconds = parseFloat(retryMatch[1]);
              } else {
                // Try parsing from details array if it exists (standard Google API format)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const details = (data as any).details;
                if (details && Array.isArray(details.details)) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const retryInfo = details.details.find((d: any) => d['@type']?.includes('RetryInfo'));
                  if (retryInfo?.retryDelay) {
                    waitSeconds = parseFloat(retryInfo.retryDelay.replace('s', ''));
                  }
                }
              }

            if (waitSeconds > 0) {
                delay = (waitSeconds + 1) * 1000; // Add 1s buffer
                console.warn(`Gemini Proxy: Rate limited (429). Server requested ${waitSeconds}s wait. Waiting ${Math.round(delay)}ms...`);
                
                if (onRetry) {
                  // Start a countdown display if it's a long wait
                  const waitInt = Math.ceil(waitSeconds);
                  const mmMessage = waitInt > 60 
                    ? `API limit ထိနေသည်၊ ${Math.ceil(waitInt/60)} မိနစ်ခန့် နောက် ပြန်ကြိုးစားမည်...`
                    : `API limit ထိနေသည်၊ ${waitInt} စက္ကန့်နောက် ပြန်ကြိုးစားမည်...`;
                  onRetry(waitInt, mmMessage);
                }
                
                // For 429, we might want to wait longer than the standard exponential backoff if requested
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.geminiRequest(modelName, body, retryCount + 1, onRetry);
              } else {
                console.warn(`Gemini Proxy: Status ${status} for ${modelName}. Retrying in ${Math.round(delay)}ms... (${retryCount + 1}/${MAX_RETRIES})`);
                if (onRetry) onRetry(Math.round(delay/1000), `API Error ${status}. Retrying in ${Math.round(delay/1000)}s...`);
              }
            } else {
              console.warn(`Gemini Proxy: Status ${status} for ${modelName}. Retrying in ${Math.round(delay)}ms... (${retryCount + 1}/${MAX_RETRIES})`);
              if (onRetry) onRetry(Math.round(delay/1000), `API Error ${status}. Retrying in ${Math.round(delay/1000)}s...`);
            }
            
            await new Promise(resolve => setTimeout(resolve, delay));
            return this.geminiRequest(modelName, body, retryCount + 1, onRetry);
          }
          
          // If we are at MAX_RETRIES or it's a non-retryable error, throw it
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

  async generateTTS(
    text: string, 
    config: TTSConfig, 
    onFirstChunk?: (result: AudioResult) => void,
    onProgress?: (current: number, total: number, message: string) => void,
    onRetry?: (seconds: number, message: string) => void
  ): Promise<AudioResult> {
    const chunks = this.splitIntoChunks(text, 4000); 
    console.log(`TTS Service: Splitting text into ${chunks.length} chunks for controlled generation...`);

    if (chunks.length <= 1) {
      if (onProgress) onProgress(1, 1, "အသံထုတ်ယူနေပါသည်...");
      return this.generateSingleTTS(text, config, onRetry);
    }

    const results: AudioResult[] = [];
    const DELAY_BETWEEN_CHUNKS = 8000; // Reduced delay since we have larger chunks now, but still safe for RPM
    
    console.log(`TTS Service: Processing ${chunks.length} chunks sequentially with ${DELAY_BETWEEN_CHUNKS}ms delay...`);
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkNum = i + 1;
      
      if (onProgress) onProgress(chunkNum, chunks.length, `အပိုင်း ${chunkNum}/${chunks.length} ကို ထုတ်ယူနေပါသည်...`);
      
      let retryCount = 0;
      const MAX_CHUNK_RETRIES = 5;
      let success = false;
      let lastError = null;

      while (retryCount <= MAX_CHUNK_RETRIES && !success) {
        try {
          const result = await this.generateSingleTTS(chunk, config, onRetry);

          if (i === 0 && onFirstChunk) {
            onFirstChunk(result);
          }

          results.push(result);
          success = true;
          
          if (i < chunks.length - 1) {
            const nextChunkNum = i + 2;
            const jitter = Math.random() * 2000;
            const waitTime = DELAY_BETWEEN_CHUNKS + jitter;
            if (onProgress) onProgress(chunkNum, chunks.length, `အပိုင်း ${nextChunkNum}/${chunks.length} အတွက် ခဏစောင့်နေပါသည်...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        } catch (error: unknown) {
          lastError = error;
          retryCount++;
          if (retryCount <= MAX_CHUNK_RETRIES) {
             const delay = Math.pow(2, retryCount) * 5000;
             if (onRetry) onRetry(Math.round(delay/1000), `Error. Retrying chunk ${chunkNum} in ${Math.round(delay/1000)}s...`);
             await new Promise(resolve => setTimeout(resolve, delay));
             continue;
          }
          throw error;
        }
      }
      
      if (!success && lastError) {
        throw lastError;
      }
    }

    console.log(`TTS Service: All ${results.length} chunks generated successfully.`);
    return await this.mergeAudioResults(results);
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

  private async generateSingleTTS(text: string, config: TTSConfig, onRetry?: (seconds: number, message: string) => void): Promise<AudioResult> {
    const voice = VOICE_OPTIONS.find(v => v.id === config.voiceId) || VOICE_OPTIONS.find(v => v.voiceName === 'Leda') || VOICE_OPTIONS[0];
    const styleInstruction = config.styleInstruction?.trim() || '';

    // Check Cache First
    try {
      const cached = await ttsCache.get(text, config.voiceId, styleInstruction);
      if (cached) {
        console.log(`TTS Service: Cache hit for "${text.substring(0, 30)}..."`);
        // If it's a valid object URL from a previous session, it might be revoked.
        // We should recreate the object URL from rawAudio.
        if (cached.rawAudio) {
           const blob = new Blob([cached.rawAudio], { type: 'audio/mpeg' });
           cached.audioUrl = URL.createObjectURL(blob);
        }
        return cached;
      }
    } catch (e) {
      console.warn("TTS Service: Cache error", e);
    }

    const pitchInstruction = config.pitch > 0
      ? `Speak with a noticeably higher pitched, brighter voice tone (+${config.pitch} semitones higher than normal). `
      : config.pitch < 0
      ? `Speak with a noticeably deeper, lower pitched voice tone (${config.pitch} semitones lower than normal). `
      : '';

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
              voiceName: voice.voiceName || "Leda"
            }
          }
        }
      }
    };

    const data = await this.geminiRequest(GEMINI_MODELS.TTS, body, 0, onRetry);
    const audioPart = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    const base64PCM = audioPart?.data;

    if (!base64PCM) {
      console.error('No audio in response:', JSON.stringify(data));
      throw new Error('No audio data returned from Gemini');
    }

    const binaryPCM = atob(base64PCM);
    const pcmBytes = new Uint8Array(binaryPCM.length);
    for (let i = 0; i < binaryPCM.length; i++) {
      pcmBytes[i] = binaryPCM.charCodeAt(i);
    }

    const audioBlob = pcmToWav(pcmBytes, 24000);
    const audioUrl = URL.createObjectURL(audioBlob);
    const arrayBuffer = await audioBlob.arrayBuffer();

    // Convert WAV Blob to Base64
    const wavBase64 = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.readAsDataURL(audioBlob);
    });

    const AudioContextClass = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
    const audioContext = new AudioContextClass();
    let totalDuration = 0;
    try {
      // Decode audio for duration - AudioContext can decode WAV
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

    const result: AudioResult = {
      audioUrl,
      audioData: wavBase64,
      pcmData: base64PCM,
      rawAudio: arrayBuffer,
      srtContent: subtitles.map(s => `${s.index}\r\n${s.startTime} --> ${s.endTime}\r\n${s.text}\r\n\r\n`).join(''),
      subtitles,
      baseDuration: totalDuration,
      oneXDuration: totalDuration,
      speed: 1.0,
      duration: totalDuration,
      baseAudio: arrayBuffer
    };

    // Save to Cache (non-blocking)
    ttsCache.set(text, config.voiceId, styleInstruction, result).catch(e => console.warn("TTS Service: Cache save failed", e));

    return result;
  }

  private async mergeAudioResults(results: AudioResult[]): Promise<AudioResult> {
    // 1. Merge PCM data
    let totalLength = 0;
    const pcmChunks: Uint8Array[] = [];
    
    for (const res of results) {
      const pcmBase64 = res.pcmData || res.audioData;
      const binaryString = atob(pcmBase64);
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

    // Convert merged PCM to MP3 Blob
    const audioBlob = pcmToWav(mergedPCM, 24000);
    const audioUrl = URL.createObjectURL(audioBlob);
    const arrayBuffer = await audioBlob.arrayBuffer();

    // Convert WAV Blob to Base64
    const wavBase64 = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.readAsDataURL(audioBlob);
    });

    // Convert merged PCM to Base64 (for potential future merging)
    const pcmBase64 = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.readAsDataURL(new Blob([mergedPCM]));
    });

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
        srtParts.push(`${newSub.index}\r\n${newSub.startTime} --> ${newSub.endTime}\r\n${newSub.text}\r\n\r\n`);
      });
      cumulativeTime += res.duration;
    });

    return {
      audioUrl,
      audioData: wavBase64,
      pcmData: pcmBase64,
      rawAudio: arrayBuffer,
      srtContent: srtParts.join(''),
      subtitles: allSubtitles,
      baseDuration: cumulativeTime,
      oneXDuration: cumulativeTime,
      speed: 1.0,
      duration: cumulativeTime,
      baseAudio: arrayBuffer
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

  async rewriteContent(text: string, style: 'conversational' | 'storytelling' | 'news' | 'poetic' | 'educational' = 'conversational', onRetry?: (seconds: number, message: string) => void): Promise<string> {
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
    }, 0, onRetry);
    const textResult = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textResult) throw new Error('No text generated by Gemini');
    return textResult.trim();
  }

  async translateContent(text: string, style: string = 'Movie Recap', tone: string = '', duration: string = 'Medium', onRetry?: (seconds: number, message: string) => void): Promise<string> {
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
    }, 0, onRetry);
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

  async transcribeVideoFile(file: File, chunks?: Blob[], onRetry?: (seconds: number, message: string) => void): Promise<string> {
    if (chunks && chunks.length > 0) {
      console.log(`[VBS Video] Transcribing video in ${chunks.length} chunks...`);
      let fullTranscription = "";
      const DELAY_BETWEEN_CHUNKS = 10000;

      for (let i = 0; i < chunks.length; i++) {
        const chunkBlob = chunks[i];
        const chunkNum = i + 1;
        console.log(`[VBS Video] Processing chunk ${chunkNum}/${chunks.length}`);
        
        try {
          const base64Data = await this.blobToBase64(chunkBlob);
          const body = {
            contents: [{
              parts: [
                { inlineData: { mimeType: 'video/mp4', data: base64Data } },
                { text: `Transcribe this video chunk in Myanmar language accurately with timestamps. This is part ${chunkNum} of ${chunks.length}. Note that the overall timestamps should account for the fact that each chunk is approximately 30 seconds. Output only the transcription text with [MM:SS.mmm] format.` }
              ]
            }]
          };

          const data = await this.geminiRequest(GEMINI_MODELS.VIDEO, body, 0, onRetry);
          const resultText = (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
          fullTranscription += resultText + "\n\n";

          if (i < chunks.length - 1) {
            console.log(`[VBS Video] Waiting ${DELAY_BETWEEN_CHUNKS}ms before next chunk...`);
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CHUNKS));
          }
        } catch (err) {
          console.error(`[VBS Video] Failed at chunk ${chunkNum}:`, err);
          throw err;
        }
      }
      return fullTranscription.trim();
    }

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

      const data = await this.geminiRequest(GEMINI_MODELS.VIDEO, body, 0, onRetry);
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

  private async blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = (e) => reject(new Error(`Blob reading failed: ${e}`));
      reader.readAsDataURL(blob);
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

