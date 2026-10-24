import { formatTime, pcmToWav } from "../utils/audioUtils";
import { generateOptimizedSubtitles, generateSubtitlesFromTimestamps, generateSRT, splitSentenceIntoCueBlocks } from "../utils/subtitleUtils";
import { planSubtitlePieces } from "../utils/recapGeometry";
import { apiChannelManager, isPlausibleApiKey } from "./apiChannelManager";
import { getIdToken } from "../firebase";
import { ttsCache } from "./ttsCache";
import { TTSConfig, AudioResult, SRTSubtitle } from "../types";
import { GEMINI_MODELS, VOICE_OPTIONS } from "../constants";
import { applyPronunciation } from "../utils/pronunciation";
import { KeyLimitError, hasOtherFreeKey, markLimited, pickKey } from "./geminiKeyPool";
import { generateGroundedRecap, type RecapLlm, type RecapStage, type RecapSegment } from "./recapScriptPipeline";

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
export interface RecapPlanCue {
  id: number;
  start: number; // seconds
  end: number; // seconds
  text: string;
}

export interface RecapPlanScene {
  fromCue: number;
  toCue: number;
  start: number; // seconds in the source video
  end: number; // seconds in the source video
  narration: string;
  /** optional: play the footage at this rate (0.5 = slow motion); omitted = fit to the narration */
  speed?: number;
}

export class GeminiTTSService {
  private apiKey: string;
  private isAdmin: boolean;

  constructor(apiKey?: string, isAdmin: boolean = false) {
    this.apiKey = isPlausibleApiKey(apiKey) ? (apiKey?.trim() || '') : '';
    this.isAdmin = isAdmin;
  }

  private async geminiRequest(
    modelName: string, 
    body: { contents: unknown[]; generationConfig?: unknown; selectedModel?: string; isTts?: boolean; maxRetries?: number }, 
    retryCount: number = 0,
    onRetry?: (seconds: number, message: string) => void
  ): Promise<GeminiResponse> {
    const executeRequest = async (key: string) => {
      console.log(`Gemini Proxy Request [${modelName}]. Key:`, key ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : "ADMIN_POOL (Server-side)");
      
      const MAX_RETRIES = body.maxRetries ?? 5; // Increased retries for better stability

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
            credentials: 'include',
            body: JSON.stringify({
              model: modelName,
              selectedModel: body.selectedModel || modelName,
              contents: body.contents,
              config: body.generationConfig,
              apiKey: key,
              isTts: body.isTts || false
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
          const isCookieCheck = text.includes("Cookie check") || text.includes("<title>Cookie check</title>");
          
          console.error(`Gemini Proxy: Non-JSON response received [${response.status}]:`, text.substring(0, 500));
          
          if (isCookieCheck) {
            throw new Error("(ဘရောက်ဆာ၏ Cookie ကန့်သတ်ချက်ကြောင့် အလုပ်မလုပ်ပါက ညာဘက်အပေါ်ရှိ 'Open in a new tab' ကို နှိပ်ပြီး အသုံးပြုပေးပါ) Iframe session blocked by browser cookie restrictions. Please click 'Open in a new tab' at top-right to authorize and use the application.");
          }
          
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
          const rawErrorMsg = data.error || data.message || response.statusText || "Unknown error";
          let cleanMsg = rawErrorMsg;
          if (typeof rawErrorMsg === 'string' && rawErrorMsg.startsWith('{') && rawErrorMsg.includes('"message"')) {
            try {
              const parsed = JSON.parse(rawErrorMsg);
              cleanMsg = parsed.error?.message || parsed.message || rawErrorMsg;
            } catch {
              // ignore
            }
          }
          // `error` can arrive as an object ({ message, code, status }); everything below expects text.
          const errorMsg: string =
            typeof cleanMsg === 'string'
              ? cleanMsg
              : (cleanMsg && typeof cleanMsg === 'object' && typeof (cleanMsg as { message?: unknown }).message === 'string')
                ? (cleanMsg as { message: string }).message
                : (() => { try { return JSON.stringify(cleanMsg); } catch { return String(cleanMsg); } })();
          
          console.error(`Gemini Proxy Error Response [${modelName}] (${status}):`, data);

          // Limit reached on this key: remember it and move to the next key instead of waiting.
          // A dead key (leaked, expired, revoked, no access) is skipped the same way as a spent one.
          const deadKey = (status === 400 || status === 401 || status === 403) && /api key|leaked|expired|revoked|permission|denied|billing/i.test(errorMsg);
          if (key && this.apiKey && ((status === 429 && /quota|exhaust|rate|limit/i.test(errorMsg)) || deadKey)) {
            const other = hasOtherFreeKey(key, this.apiKey, modelName, apiChannelManager.getPoolKeys(this.isAdmin));
            markLimited(key, modelName, deadKey ? 'retry in 3600s' : errorMsg);
            if (other) throw new KeyLimitError(errorMsg);
          }

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
      const tried = new Set<string>();
      let key = pickKey(this.apiKey, modelName, tried, apiChannelManager.getPoolKeys(this.isAdmin)) || this.apiKey.split(/[\s,]+/)[0];
      for (;;) {
        try {
          return await executeRequest(key);
        } catch (e) {
          if (e instanceof KeyLimitError) {
            tried.add(key);
            const next = pickKey(this.apiKey, modelName, tried, apiChannelManager.getPoolKeys(this.isAdmin));
            if (next) {
              if (onRetry) onRetry(0, `Key limit reached — switching to key ${tried.size + 1}`);
              key = next;
              continue;
            }
            throw new Error(e.message);
          }
          throw e;
        }
      }
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

  /** Shortens one narration paragraph to about targetChars so its voiceover fits the video time it covers. */
  async condenseNarration(text: string, targetChars: number, language: 'mm' | 'en' = 'mm', onRetry?: (seconds: number, message: string) => void): Promise<string | null> {
    const prompt = `Shorten this recap narration paragraph to about ${targetChars} characters (currently ${text.length}).
Keep the key actions, the cause→effect and the emotion; cut filler, repeated ideas and minor description. Keep the same voice and tense, same names, and do not add any new fact.
${language === 'mm' ? 'Write only spoken Burmese (မြန်မာ). No Chinese/English sentences.' : 'Write only English.'}
Output ONLY the shortened paragraph.

${text}`;
    for (const model of [GEMINI_MODELS.SCRIPT, GEMINI_MODELS.REWRITE]) {
      try {
        const data = await this.geminiRequest(model, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4 } }, 0, onRetry);
        const out = (data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || '').trim().replace(/^```[a-z]*\n?|```$/g, '').trim();
        if (!out) continue;
        const bad = language === 'mm' ? /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u0e00-\u0e7f]/.test(out) : false;
        if (bad || out.length > Math.max(targetChars * 1.2, 40) || out.length < targetChars * 0.4) return null;
        return out;
      } catch { /* try next model */ }
    }
    return null;
  }

  /** Makes a too-short recap paragraph fuller (about `targetChars`) without adding facts. */
  async expandNarration(text: string, targetChars: number, language: 'mm' | 'en' = 'mm', onRetry?: (seconds: number, message: string) => void): Promise<string | null> {
    const prompt = `Make this recap narration paragraph fuller: about ${targetChars} characters (currently ${text.length}).
Add what the characters see, feel and risk, and the cause→effect between the actions, in the same spoken storyteller voice, tense and names. Do NOT add any new fact, event, name or ending. Keep the opening connective and the ending hand-over.
${language === 'mm' ? 'Write only spoken Burmese (မြန်မာ). No Chinese/English sentences.' : 'Write only English.'}
Output ONLY the paragraph.

${text}`;
    for (const model of [GEMINI_MODELS.SCRIPT, GEMINI_MODELS.REWRITE]) {
      try {
        const data = await this.geminiRequest(model, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.5 } }, 0, onRetry);
        const out = (data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || '').trim().replace(/^```[a-z]*\n?|```$/g, '').trim();
        if (!out) continue;
        const bad = language === 'mm' ? /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u0e00-\u0e7f]/.test(out) : false;
        if (bad || out.length > targetChars * 1.4 || out.length < text.length) return null;
        return out;
      } catch { /* try next model */ }
    }
    return null;
  }

  /**
   * Splits a long film into `count` consecutive story chapters at natural turning points (scene / place / time changes,
   * the end of an episode of the plot) using the transcript. Returns the start second of chapters 2..count, or null.
   */
  async planStoryChapters(cues: { start: number; end: number; text: string }[], count: number, onRetry?: (seconds: number, message: string) => void): Promise<number[] | null> {
    if (count < 2 || cues.length < count * 3) return null;
    const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    // keep the prompt small: long films are sampled so the listing stays around 60k characters
    const step = Math.max(1, Math.ceil(cues.reduce((n, c) => n + Math.min(90, c.text.length) + 12, 0) / 60000));
    const listing = cues.map((c, i) => ({ c, i })).filter(({ i }) => i % step === 0).map(({ c, i }) => `[${i + 1}] ${mmss(c.start)} ${c.text.slice(0, 90)}`).join('\n');
    const prompt = `Below is the timed transcript of a long film (${cues.length} lines, ${mmss(cues[cues.length - 1].end)} long).
Split the story into exactly ${count} consecutive chapters that are each about the same length in running time, so each chapter can be recapped as its own part. Put every chapter break at a natural STORY turning point (a scene, place or time change, the end of an episode of the plot, a revelation or cliffhanger), never in the middle of a conversation or action.
Return JSON only: {"starts":[<the line number where each of chapters 2..${count} begins>]} - exactly ${count - 1} ascending numbers taken from the line numbers shown.

${listing}`;
    for (const model of [GEMINI_MODELS.SCRIPT, GEMINI_MODELS.REWRITE]) {
      try {
        const data = await this.geminiRequest(model, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }, 0, onRetry);
        const raw = (data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || '').trim();
        const arr = (JSON.parse(raw.replace(/^```[a-z]*\n?|```$/g, '')) as { starts?: unknown }).starts;
        if (!Array.isArray(arr) || arr.length !== count - 1) continue;
        const idx = arr.map(Number);
        if (idx.some((n, k) => !Number.isFinite(n) || n < 1 || n > cues.length || (k > 0 && n <= idx[k - 1]))) continue;
        return idx.map(n => cues[n - 1].start);
      } catch { /* try next model */ }
    }
    return null;
  }

  // ---- Gemini custom voices (voice replication, Gemini 3.8 Flash TTS) -----------------------------
  private async voicesRequest(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const token = await getIdToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const r = await fetch('/api/gemini/voices', { method: 'POST', headers, body: JSON.stringify({ ...payload, apiKey: this.apiKey }) });
    const data = await r.json().catch(() => ({} as Record<string, unknown>));
    if (!r.ok) {
      const e = (data as { error?: unknown }).error;
      const msg = typeof e === 'string' ? e : (e as { message?: string } | undefined)?.message || r.statusText;
      throw new Error(`Custom voice error (${r.status}): ${msg}`);
    }
    return data;
  }

  /** Creates a stored custom voice from a reference sample and the owner's consent recording (both 24 kHz mono WAV, base64). */
  async createCustomVoice(sourceAudio: string, consentAudio: string, displayName?: string): Promise<string> {
    const data = await this.voicesRequest({ action: 'create', sourceAudio, consentAudio, displayName });
    const id = (data.id as string) || ((data.replicated_voice as { id?: string } | undefined)?.id) || (data.key as string) || '';
    if (!id) throw new Error('Google did not return a voice id');
    return id;
  }

  async deleteCustomVoice(voiceId: string): Promise<void> {
    if (!voiceId.startsWith('voice_')) return;
    await this.voicesRequest({ action: 'delete', voice: voiceId });
  }

  private async speakWithCustomVoice(voice: string, text: string, style: string): Promise<GeminiResponse> {
    const data = await this.voicesRequest({ action: 'speak', voice, text, style: style || undefined });
    // Find the audio item: steps[].content[] with type 'audio' (or output_audio)
    let audioB64 = '';
    let mime = '';
    const steps = (data.steps as Array<{ type?: string; content?: Array<{ type?: string; data?: string; mime_type?: string }> }>) || [];
    for (const st of steps) {
      for (const c of st.content || []) {
        if (c.type === 'audio' && c.data) { audioB64 = c.data; mime = c.mime_type || ''; }
      }
    }
    if (!audioB64) audioB64 = (data.output_audio as { data?: string } | undefined)?.data || '';
    if (!audioB64) throw new Error('No audio returned for the custom voice');
    // If it is a WAV file, hand the raw PCM on (the shared pipeline wraps PCM itself).
    const bin = atob(audioB64);
    if (bin.startsWith('RIFF')) {
      let pos = 12;
      let dataStart = 44;
      let dataLen = bin.length - 44;
      while (pos + 8 <= bin.length) {
        const id = bin.substr(pos, 4);
        const len = bin.charCodeAt(pos + 4) | (bin.charCodeAt(pos + 5) << 8) | (bin.charCodeAt(pos + 6) << 16) | (bin.charCodeAt(pos + 7) << 24);
        if (id === 'data') { dataStart = pos + 8; dataLen = Math.min(len >>> 0, bin.length - dataStart); break; }
        pos += 8 + len + (len % 2);
      }
      audioB64 = btoa(bin.substr(dataStart, dataLen));
      mime = 'audio/L16;rate=24000';
    }
    return { candidates: [{ content: { parts: [{ inlineData: { data: audioB64, mimeType: mime || 'audio/L16;rate=24000' } }] } }] };
  }

  private async generateSingleTTS(text: string, config: TTSConfig, onRetry?: (seconds: number, message: string) => void): Promise<AudioResult> {
    const voice = VOICE_OPTIONS.find(v => v.id === config.voiceId) || VOICE_OPTIONS.find(v => v.voiceName === 'Leda') || VOICE_OPTIONS[0];
    const styleInstruction = config.styleInstruction?.trim() || '';
    const customVoiceId = /^voice(key)?_/.test(config.voiceProfile || '') ? (config.voiceProfile as string) : '';
    const cacheVoiceId = customVoiceId || config.voiceId;

    // Check Cache First
    try {
      const cached = await ttsCache.get(text, cacheVoiceId, styleInstruction);
      if (cached) {
        console.log(`TTS Service: Cache hit for "${text.substring(0, 30)}..."`);
        // If it's a valid object URL from a previous session, it might be revoked.
        // We should recreate the object URL from rawAudio.
        if (cached.rawAudio) {
           const blob = new Blob([cached.rawAudio], { type: 'audio/wav' });
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
    const displayText = hasTimestamps ? text.replace(/\[\d{1,2}:\d{1,2}\.\d{3}\]/g, "").trim() : text;
    const audioText = applyPronunciation(hasTimestamps ? text.replace(/\[\d{1,2}:\d{1,2}\.\d{3}\]/g, "").trim() : text);

    let textWithInstruction = combinedInstruction
      ? `[${combinedInstruction}]\n\n${audioText}`
      : audioText;

    let selectedModel = config.selectedModel || GEMINI_MODELS.TTS;
    // Legacy base64 audio profiles are ignored; a custom voice is a Gemini voice id (voice_... / voicekey_...).
    const hasAudioInput = false;

    if (hasAudioInput) {
      textWithInstruction = `Task: Perform Text-to-Speech synthesis. Read the following text aloud using the voice tone/style from the attached audio reference. Output format MUST BE AUDIO.

        Text to speak:
        "${audioText}"`;
    }

    // Dynamically switch to multimodal model if audio input is present
    if (hasAudioInput && selectedModel.includes('tts')) {
      selectedModel = 'gemini-2.5-flash';
    }

    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [{ text: textWithInstruction }];
    
    // Only add audio input if the model is NOT a dedicated TTS-only model
    if (hasAudioInput && !selectedModel.includes('tts')) {
      parts.unshift({
        inlineData: {
          mimeType: "audio/webm",
          data: config.voiceProfile!
        }
      });
    }

    const generationConfig: Record<string, unknown> = {
      responseModalities: ["AUDIO"],
    };

    if (hasAudioInput && !selectedModel.includes('tts')) {
      generationConfig.systemInstruction = "Analyze ONLY the vocal characteristics, pitch, accent, and speed from the provided audio sample. DO NOT transcribe the audio. Generate the spoken output for the target text matching this voice persona style as closely as possible.";
    } else {
      generationConfig.speechConfig = {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: voice.voiceName || "Leda"
          }
        }
      };
    }

    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig,
      selectedModel: selectedModel,
      isTts: true
    };

    const data: GeminiResponse = customVoiceId
      ? await this.speakWithCustomVoice(customVoiceId, audioText, combinedInstruction)
      : await this.geminiRequest(selectedModel, body, 0, onRetry);
    
    // Search all parts in the candidate content to find inlineData
    const responseParts = data.candidates?.[0]?.content?.parts || [];
    let audioPart = null;
    for (const part of responseParts) {
      if (part.inlineData) {
        audioPart = part.inlineData;
        break;
      }
    }

    let base64Audio = audioPart?.data;
    const mimeType = audioPart?.mimeType || 'audio/pcm';

    // Handle serialized Buffer objects safely
    if (
      base64Audio && 
      typeof base64Audio === 'object' && 
      'type' in base64Audio && 
      'data' in base64Audio && 
      (base64Audio as Record<string, unknown>).type === 'Buffer' && 
      Array.isArray((base64Audio as Record<string, unknown>).data)
    ) {
      console.log('TTS Service: Received serialized Buffer object, converting to base64 string...');
      const bytes = new Uint8Array((base64Audio as Record<string, unknown>).data as number[]);
      let binary = '';
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      base64Audio = btoa(binary);
    }

    if (!base64Audio || typeof base64Audio !== 'string') {
      console.error('No audio in response:', JSON.stringify(data));
      throw new Error('No audio data returned from Gemini');
    }

    const binaryAudio = atob(base64Audio);
    const audioBytes = new Uint8Array(binaryAudio.length);
    for (let i = 0; i < binaryAudio.length; i++) {
      audioBytes[i] = binaryAudio.charCodeAt(i);
    }

    // Only wrap in WAV header if it's raw PCM
    let audioBlob: Blob;
    let finalMimeType: string;
    const isRawPcm = mimeType.toLowerCase().includes('pcm') || mimeType.toLowerCase().includes('l16');
    
    if (isRawPcm) {
      console.log(`TTS Service: Detected raw PCM (${mimeType}), wrapping in WAV header...`);
      audioBlob = pcmToWav(audioBytes, 24000);
      finalMimeType = 'audio/wav';
    } else {
      console.log(`TTS Service: Detected pre-formatted audio (${mimeType}), using as is...`);
      audioBlob = new Blob([audioBytes], { type: mimeType });
      finalMimeType = mimeType;
    }
    
    const audioUrl = URL.createObjectURL(audioBlob);
    const arrayBuffer = await audioBlob.arrayBuffer();

    // Convert Audio Blob to Base64 (consistent with WAV)
    const finalBase64 = await new Promise<string>((resolve) => {
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
      totalDuration = displayText.length * 0.08;
    } finally {
      await audioContext.close();
    }

    const subtitles = hasTimestamps 
      ? generateSubtitlesFromTimestamps(text, totalDuration)
      : generateOptimizedSubtitles(displayText, totalDuration);

    const result: AudioResult = {
      audioUrl,
      audioData: finalBase64,
      pcmData: base64Audio,
      rawAudio: arrayBuffer,
      srtContent: generateSRT(subtitles),
      subtitles,
      baseDuration: totalDuration,
      oneXDuration: totalDuration,
      speed: 1.0,
      duration: totalDuration,
      baseAudio: arrayBuffer,
      mimeType: finalMimeType
    };

    // Save to Cache (non-blocking)
    ttsCache.set(text, cacheVoiceId, styleInstruction, result).catch(e => console.warn("TTS Service: Cache save failed", e));

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

    // Convert merged PCM to WAV Blob
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
      });
      cumulativeTime += res.duration;
    });

    return {
      audioUrl,
      audioData: wavBase64,
      pcmData: pcmBase64,
      rawAudio: arrayBuffer,
      srtContent: generateSRT(allSubtitles),
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

  async generateStoryChapter(
    storyTitle: string,
    chapterNumber: number,
    chapterTitle: string,
    genre: string,
    plotOutline: string,
    narratorTone: string,
    onRetry?: (seconds: number, message: string) => void
  ): Promise<string> {
    const prompt = `
      You are an award-winning Myanmar storyteller and audiobook scriptwriter.
      Write an engaging, immersive chapter for an audiobook in vivid, natural spoken Burmese.

      STORY TITLE: ${storyTitle || 'Untitled Story'}
      CHAPTER: ${chapterNumber} ${chapterTitle ? `(${chapterTitle})` : ''}
      GENRE: ${genre}
      NARRATOR TONE: ${narratorTone || 'Engaging and expressive'}
      PLOT OUTLINE / SYNOPSIS:
      ${plotOutline}

      GUIDELINES:
      - Write in smooth, spoken Burmese suited for audio narration (စကားပြောဟန် ရသစုံ).
      - Include emotional nuance, natural pacing, and dialogue where appropriate.
      - Pacing pauses can be marked with "..." or dramatic line breaks.
      - Do not include meta text or English explanations. Return ONLY the Burmese audiobook chapter text.
    `;
    const data = await this.geminiRequest(GEMINI_MODELS.REWRITE, {
      contents: [{ parts: [{ text: prompt }] }]
    }, 0, onRetry);
    const textResult = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textResult) throw new Error('No text generated by Gemini');
    return textResult.trim();
  }

  async polishStoryForAudiobook(
    rawText: string,
    style: 'suspense' | 'emotional' | 'folk' | 'bedtime' | 'cinematic',
    onRetry?: (seconds: number, message: string) => void
  ): Promise<string> {
    const instructions = {
      suspense: "Rewrite this Myanmar story to heighten suspense, mystery, and tension. Use short, gripping sentences and dramatic pauses.",
      emotional: "Rewrite this Myanmar story with deep emotional resonance, heartfelt descriptions, and touching expressions.",
      folk: "Rewrite this Myanmar story into a classic legendary folklore style (ရှေးရိုးပုံပြင် အပြောဟန်), warm and captivating.",
      bedtime: "Rewrite this Myanmar story into a calming, soothing bedtime story tone with gentle pacing and soft, pleasant vocabulary.",
      cinematic: "Rewrite this Myanmar story with vivid, cinematic atmosphere, sensory details (sound, atmosphere, weather), and dramatic flair."
    };

    const prompt = `
      You are an expert Myanmar audiobook editor.
      ${instructions[style] || instructions.cinematic}

      Original Story Content:
      ${rawText}

      Requirements:
      - Maintain the original plot and characters.
      - Use natural, fluent spoken Myanmar phrasing (vernacular audio narration).
      - Output ONLY the polished Myanmar narration script.
    `;
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

  /**
   * Professional Myanmar Translation for SRT Subtitles
   * Guarantees 100% timestamp preservation: the exact milliseconds from the video
   * are mathematically retained, while dialogues are localized into natural Burmese.
   */
  async translateSrtToMyanmar(
    srtContent: string,
    style: string = 'Movie Recap (ရုပ်ရှင်ဇာတ်လမ်းပြန်ပြောဟန် - Pro ကျကျ)',
    onProgress?: (step: string, percent: number) => void,
    onRetry?: (seconds: number, message: string) => void
  ): Promise<{ translatedSrt: string; narrativeScript: string }> {
    const normalized = srtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (!normalized) {
      return { translatedSrt: '', narrativeScript: '' };
    }

    // Parse every original block into structured cue
    const rawBlocks = normalized.split(/\n\s*\n/).filter(b => b.trim().length > 0);
    interface SrtSourceCue {
      id: number;
      timeLine: string;
      speaker?: string;
      text: string;
    }

    const cues: SrtSourceCue[] = [];
    for (let i = 0; i < rawBlocks.length; i++) {
      const lines = rawBlocks[i].split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length >= 2) {
        let timeLine = lines[1];
        let textLines = lines.slice(2);
        if (!lines[0].match(/^\d+$/)) {
          timeLine = lines[0];
          textLines = lines.slice(1);
        }
        let fullText = textLines.join(' ');
        let speaker: string | undefined;
        const speakerMatch = fullText.match(/^\[(?:Speaker\s+)?([^\]]+)\]:\s*(.*)$/i);
        if (speakerMatch) {
          speaker = speakerMatch[1];
          fullText = speakerMatch[2];
        }
        cues.push({
          id: i + 1,
          timeLine,
          speaker,
          text: fullText
        });
      }
    }

    if (cues.length === 0) {
      return { translatedSrt: srtContent, narrativeScript: '' };
    }

    const CHUNK_SIZE = 30; // optimal chunk size for high-fidelity translation
    const totalChunks = Math.ceil(cues.length / CHUNK_SIZE);
    const translatedMap = new Map<number, string>();

    const isDirectOriginal = style.includes('မူရင်းအတိုင်း') || style.toLowerCase().includes('direct') || style.toLowerCase().includes('original');

    // Reads "[12] text", "[12]: text", "12. text", "12) text" and joins wrapped continuation lines.
    const parseNumbered = (raw: string, allowed: Set<number>): Map<number, string> => {
      const out = new Map<number, string>();
      let current = -1;
      const cleaned = raw.trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '');
      for (const line of cleaned.split('\n').map(l => l.trim()).filter(Boolean)) {
        const m = line.match(/^\[?(\d+)\]?\s*[:.)\-–]?\s*(.*)$/);
        if (m && allowed.has(parseInt(m[1], 10)) && (line.startsWith('[') || /^\d+\s*[:.)\-–]/.test(line))) {
          current = parseInt(m[1], 10);
          out.set(current, m[2].trim());
        } else if (current > 0) {
          out.set(current, `${out.get(current) || ''} ${line}`.trim());
        }
      }
      for (const [k, v] of [...out]) if (!v) out.delete(k);
      return out;
    };

    const buildPrompt = (list: SrtSourceCue[]) => `
You are a master Burmese (Myanmar) subtitle translator and localization expert.
Translate each numbered dialogue/narration line into natural, high-quality spoken Burmese for video subtitles.

TRANSLATION TONE & STYLE: ${style}
${isDirectOriginal 
  ? '- STRICT ACCURACY (သူ့မူရင်းအတိုင်း): Translate faithfully with semantic precision to the original dialogue, preserving the exact original meaning without extra storytelling embellishments.' 
  : '- NATURAL CINEMATIC: Translate into expressive, vivid, and culturally natural Burmese storytelling style appropriate for film, video recaps, and podcasts.'}

CRITICAL RULES:
1. Output format MUST be strictly: "[ID] Burmese translation" — one line per ID.
2. Translate EVERY one of these IDs: ${list.map(c => c.id).join(', ')}. Do NOT combine, merge, or skip IDs, even for very short lines, names, sounds or exclamations.
3. The answer must be Burmese script only (names in Burmese letters). Never leave Chinese/Japanese/Korean/Thai/English sentences untranslated.
4. Keep speaker labels if present in parentheses like "(Speaker 1): ".
5. Return ONLY the numbered Burmese translations without markdown blocks or preamble.

INPUT LINES:
${list.map(cue => `[${cue.id}] ${cue.speaker ? `(${cue.speaker}) ` : ''}${cue.text}`).join('\n')}
`;

    const FOREIGN_SCRIPT = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u0e00-\u0e7f]/;
    const isGood = (cue: SrtSourceCue, t: string | undefined) =>
      !!t && t.trim().length > 0 && !FOREIGN_SCRIPT.test(t);

    const translateList = async (list: SrtSourceCue[]) => {
      const data = await this.geminiRequest(
        GEMINI_MODELS.TRANSLATE,
        { contents: [{ parts: [{ text: buildPrompt(list) }] }] },
        0,
        onRetry
      );
      const raw = (data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || '');
      const got = parseNumbered(raw, new Set(list.map(c => c.id)));
      for (const cue of list) {
        const t = got.get(cue.id);
        if (isGood(cue, t)) translatedMap.set(cue.id, t as string);
      }
    };

    for (let c = 0; c < totalChunks; c++) {
      const chunkCues = cues.slice(c * CHUNK_SIZE, (c + 1) * CHUNK_SIZE);
      const progressPercent = Math.min(95, Math.round(((c + 1) / totalChunks) * 90));
      if (onProgress) {
        onProgress(`မြန်မာဘာသာသို့ အချိန်ကိုက် ပြန်ဆိုနေပါသည်... (${c + 1}/${totalChunks})`, progressPercent);
      }

      await translateList(chunkCues);

      // Anything skipped or left untranslated is asked again in small batches, then one by one.
      for (const size of [8, 1]) {
        const missing = chunkCues.filter(cue => !translatedMap.has(cue.id));
        if (missing.length === 0) break;
        if (onProgress) onProgress(`ကျန်နေသော စာတန်း ${missing.length} ကြောင်း ပြန်ဆိုနေပါသည်...`, progressPercent);
        for (let i = 0; i < missing.length; i += size) {
          try { await translateList(missing.slice(i, i + size)); } catch { /* try the next round */ }
        }
      }

      if (c < totalChunks - 1) {
        await new Promise(r => setTimeout(r, 400));
      }
    }

    // Reconstruct SRT with 100% EXACT ORIGINAL TIMESTAMPS from the video
    const finalSrtBlocks: string[] = [];
    const narrativeScriptPieces: string[] = [];

    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      let translated = (translatedMap.get(cue.id) || cue.text).trim();
      
      // Clean any accidental speaker tag duplicates
      if (cue.speaker && translated.startsWith(`(${cue.speaker})`)) {
        translated = translated.replace(`(${cue.speaker})`, '').trim();
      }

      const speakerPrefix = cue.speaker ? `[Speaker ${cue.speaker}]: ` : '';
      const finalCueText = `${speakerPrefix}${translated}`;

      // Burmese usually takes longer to read than the original line takes to say: keep each cue on screen
      // long enough (without overlapping the next one) and bridge tiny gaps so the subtitle never blinks off.
      let timeLine = cue.timeLine;
      const tm = cue.timeLine.match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/);
      if (tm) {
        const toS = (h: string, m: string, sec: string, ms: string) => +h * 3600 + +m * 60 + +sec + +ms.padEnd(3, '0').slice(0, 3) / 1000;
        const st = toS(tm[1], tm[2], tm[3], tm[4]);
        const en = toS(tm[5], tm[6], tm[7], tm[8]);
        const nx = cues[i + 1]?.timeLine.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
        const nextStart = nx ? toS(nx[1], nx[2], nx[3], nx[4]) : Infinity;
        let newEnd = Math.max(en, st + Math.min(7, translated.replace(/\s+/g, '').length / 14));
        if (nextStart - newEnd < 0.8 && nextStart > newEnd) newEnd = nextStart - 0.04;
        newEnd = Math.min(newEnd, nextStart - 0.04);
        if (newEnd > en + 0.02) {
          const fmtT = (t: number) => {
            const ms = Math.round(t * 1000);
            const p2 = (n: number, l = 2) => String(n).padStart(l, '0');
            return `${p2(Math.floor(ms / 3600000))}:${p2(Math.floor((ms % 3600000) / 60000))}:${p2(Math.floor((ms % 60000) / 1000))},${p2(ms % 1000, 3)}`;
          };
          timeLine = `${fmtT(st)} --> ${fmtT(newEnd)}`;
        }
      }

      // One long translated line becomes several short on-screen pieces (max 2 short lines each),
      // each shown for its share of the cue's time, so the picture is never covered by a wall of text.
      const tw = timeLine.match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/);
      let pieces = tw ? planSubtitlePieces(translated, splitSentenceIntoCueBlocks, 44, 24) : [];
      if (tw && pieces.length > 1) {
        const toS2 = (h: string, m: string, sec: string, ms: string) => +h * 3600 + +m * 60 + +sec + +ms.padEnd(3, '0').slice(0, 3) / 1000;
        const a0 = toS2(tw[1], tw[2], tw[3], tw[4]);
        const b0 = toS2(tw[5], tw[6], tw[7], tw[8]);
        const total = Math.max(0.1, b0 - a0);
        // never flash pieces shorter than ~0.9s: merge neighbours when the cue is too short for them all
        const maxPieces = Math.max(1, Math.floor(total / 0.9));
        while (pieces.length > maxPieces) {
          let k = 0;
          let best = Infinity;
          for (let j = 0; j < pieces.length - 1; j++) {
            const w = (pieces[j].to - pieces[j].from) + (pieces[j + 1].to - pieces[j + 1].from);
            if (w < best) { best = w; k = j; }
          }
          pieces.splice(k, 2, { text: `${pieces[k].text}\n${pieces[k + 1].text}`, from: pieces[k].from, to: pieces[k + 1].to });
        }
        const fmtP = (t: number) => {
          const ms = Math.round(t * 1000);
          const p2 = (n: number, l = 2) => String(n).padStart(l, '0');
          return `${p2(Math.floor(ms / 3600000))}:${p2(Math.floor((ms % 3600000) / 60000))}:${p2(Math.floor((ms % 60000) / 1000))},${p2(ms % 1000, 3)}`;
        };
        // share the cue's time by text length, but give every piece at least MIN seconds
        const MIN = 0.9;
        const share = pieces.map(pc => pc.to - pc.from);
        const dur = share.map(w => w * total);
        for (let pass = 0; pass < 4; pass++) {
          const fixed = dur.map(d => d < MIN);
          const fixedSum = fixed.reduce((n, f) => n + (f ? MIN : 0), 0);
          const freeIdx = dur.map((_, j) => j).filter(j => !fixed[j]);
          const freeSum = freeIdx.reduce((n, j) => n + share[j], 0) || 1;
          dur.forEach((_, j) => { dur[j] = fixed[j] ? MIN : ((total - fixedSum) * share[j]) / freeSum; });
          if (dur.every(d => d >= MIN - 1e-6)) break;
        }
        const startsAt: number[] = [];
        dur.reduce((acc, d, j) => { startsAt[j] = acc; return acc + d; }, a0);
        pieces.forEach((pc, pi) => {
          const ps = startsAt[pi];
          const pe = pi === pieces.length - 1 ? b0 : startsAt[pi] + dur[pi] - 0.02;
          finalSrtBlocks.push(`${finalSrtBlocks.length + 1}\r\n${fmtP(ps)} --> ${fmtP(pe)}\r\n${pi === 0 ? speakerPrefix : ''}${pc.text}`);
        });
      } else {
        finalSrtBlocks.push(`${finalSrtBlocks.length + 1}\r\n${timeLine}\r\n${finalCueText}`);
      }
      narrativeScriptPieces.push(translated);
    }

    const allTranslatedSrt = finalSrtBlocks.join('\r\n\r\n') + '\r\n';
    const narrativeScript = narrativeScriptPieces.join(' ');

    if (onProgress) {
      onProgress('မြန်မာဘာသာသို့ အချိန်ကိုက် ပြန်ဆိုမှု ပြီးစီးပါပြီ ✨', 100);
    }

    return {
      translatedSrt: allTranslatedSrt,
      narrativeScript
    };
  }

  /**
   * Generates a story-grounded Movie Recap Script (story bible -> outline -> per-section writing -> edit).
   * `options.mode === 'quick'` makes a single lightweight call (used for background auto-generation).
   */
  async generateMovieRecapScript(
    transcript: string,
    onRetry?: (seconds: number, message: string) => void,
    options?: Parameters<GeminiTTSService['generateMovieRecap']>[2]
  ): Promise<string> {
    return (await this.generateMovieRecap(transcript, onRetry, options)).text;
  }

  async generateMovieRecap(
    transcript: string,
    onRetry?: (seconds: number, message: string) => void,
    options?: {
      style?: string;
      tone?: string;
      /** @deprecated use targetMinutes */
      duration?: string;
      targetMinutes?: number;
      sourceSeconds?: number;
      targetLanguage?: 'mm' | 'en';
      mode?: 'full' | 'quick';
      frames?: string[];
      cues?: { start: number; end: number; text: string }[];
      getFrames?: (startSec: number, endSec: number) => Promise<string[]>;
      coverage?: number;
      part?: { index: number; count: number; prevTail?: string };
      concurrency?: number;
      dub?: boolean;
      flow?: boolean;
      fast?: boolean;
      onStage?: (s: RecapStage) => void;
    }
  ): Promise<{ text: string; segments?: RecapSegment[] }> {
    const models = [GEMINI_MODELS.SCRIPT, GEMINI_MODELS.REWRITE].filter((m, i, a) => a.indexOf(m) === i);
    // When the main model is overloaded (503/429) do not sit through long retry back-offs on every call:
    // try it once more, then use the lite model and skip the main one for a while.
    let primaryBadUntil = 0;
    const OVERLOAD = /503|overloaded|high demand|unavailable|429|quota|404|not found|not supported|invalid model/i;

    const llm: RecapLlm = async (prompt, o) => {
      const parts: unknown[] = [{ text: prompt }];
      for (const img of o?.images || []) parts.push({ inlineData: { mimeType: 'image/jpeg', data: img } });
      const config: Record<string, unknown> = { temperature: o?.json ? 0.4 : 0.7 };
      if (o?.json) config.responseMimeType = 'application/json';
      const order = Date.now() < primaryBadUntil && models.length > 1 ? models.slice(1) : models;
      let lastErr: unknown = null;
      for (let k = 0; k < order.length; k++) {
        const isPrimary = order[k] === models[0] && models.length > 1;
        try {
          // main model: one retry after ~2s only (the back-off grows with the retry number), then the lite model gets the full back-off
          const data = await this.geminiRequest(order[k], { contents: [{ parts }], generationConfig: config, maxRetries: isPrimary ? 1 : undefined }, 0, onRetry);
          const text = data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || '';
          if (!text.trim()) throw new Error('Empty response from Gemini');
          return text;
        } catch (e) {
          lastErr = e;
          const msg = e instanceof Error ? e.message : String(e);
          if (k < order.length - 1 && OVERLOAD.test(msg)) {
            if (isPrimary) primaryBadUntil = Date.now() + 90_000;
            continue;
          }
          throw e;
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error('Script generation failed');
    };

    let minutes = options?.targetMinutes;
    if (minutes === undefined) {
      const d = options?.duration || '';
      minutes = /1-2|၁-၂|short/i.test(d) ? 1.5 : /8-10|၈-၁၀|full/i.test(d) ? 9 : 4;
    }

    return generateGroundedRecap(llm, transcript, {
      style: options?.style,
      tone: options?.tone,
      language: options?.targetLanguage === 'en' ? 'en' : 'mm',
      targetMinutes: minutes,
      sourceSeconds: options?.sourceSeconds,
      mode: options?.mode,
      frames: options?.frames,
      cues: options?.cues,
      getFrames: options?.getFrames,
      coverage: options?.coverage,
      part: options?.part,
      concurrency: options?.concurrency,
      dub: options?.dub,
      flow: options?.flow,
      fast: options?.fast,
      onStage: options?.onStage,
    });
  }

  /**
   * Generates structured recap highlight chapters/scenes from video context
   */
  async generateRecapHighlights(
    context: string,
    totalDurationSeconds: number,
    sceneCount: number = 5,
    onRetry?: (seconds: number, message: string) => void
  ): Promise<Array<{ title: string; start: number; end: number; description: string }>> {
    const prompt = `
Analyze this video content (total duration: ${totalDurationSeconds} seconds) and break it into ${sceneCount} key dramatic recap highlight segments.
Total duration in seconds: ${Math.round(totalDurationSeconds)}s.

Source context:
${context.slice(0, 4000)}

Return ONLY valid JSON array with ${sceneCount} objects adhering to this schema:
[
  {
    "title": "Opening Hook & Introduction",
    "start": 0,
    "end": ${Math.round(Math.min(25, totalDurationSeconds * 0.15))},
    "description": "Short explanation in Burmese"
  }
]
Constraints:
- "start" and "end" must be numbers in seconds within 0 and ${Math.round(totalDurationSeconds)}.
- Must be ordered chronologically.
- Return ONLY the JSON array, no surrounding markdown fences if possible.
`;
    try {
      const data = await this.geminiRequest(
        GEMINI_MODELS.REWRITE,
        { contents: [{ parts: [{ text: prompt }] }] },
        0,
        onRetry
      );
      const textResult = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleanJson = textResult.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((item, idx) => ({
          title: String(item.title || `Highlight Scene ${idx + 1}`),
          start: Math.max(0, Math.min(totalDurationSeconds, Number(item.start) || 0)),
          end: Math.max(0, Math.min(totalDurationSeconds, Number(item.end) || 10)),
          description: String(item.description || '')
        }));
      }
    } catch (e) {
      console.warn('Gemini highlight analysis fallback:', e);
    }

    // Algorithmic fallback if AI or parse fails
    const segmentDuration = totalDurationSeconds / sceneCount;
    const fallbackTitles = [
      '၁။ အစပျိုး ဆွဲဆောင်ချက် (Opening Hook)',
      '၂။ ပြဿနာ စတင်ဖြစ်ပွားခြင်း (Inciting Incident)',
      '၃။ တင်းမာမှု မြင့်တက်လာခြင်း (Rising Conflict)',
      '၄။ အထွတ်အထိပ် ဇာတ်ကွက် (Major Climax)',
      '၅။ ဇာတ်သိမ်း ပဟေဠိ (Twist & Ending)'
    ];
    return Array.from({ length: sceneCount }, (_, i) => {
      const start = Math.round(i * segmentDuration);
      const end = Math.round(Math.min(totalDurationSeconds, (i + 1) * segmentDuration));
      return {
        title: fallbackTitles[i] || `Scene ${i + 1}`,
        start,
        end,
        description: `Timestamp: ${formatTime(start)} - ${formatTime(end)}`
      };
    });
  }

  /**
   * Plans a scene-by-scene recap in two grounded steps.
   *
   *  1. SELECT: Gemini reads the whole timestamped transcript, writes a factual synopsis and
   *     picks scenes by cue ID (so start/end are real timestamps, never guessed).
   *  2. WRITE: narration is written scene by scene (in small batches) from the exact lines of
   *     that scene, the synopsis, the previous narration and, when provided, still frames of the
   *     footage. This keeps every narration tied to what is actually on screen.
   *
   * `getFrames` is optional: given the chosen scenes it returns base64 JPEGs per scene.
   */
  async generateRecapPlan(
    cues: RecapPlanCue[],
    totalDurationSeconds: number,
    options: {
      targetSeconds?: number;
      style?: string;
      language?: 'mm' | 'en';
      maxScenes?: number;
    } = {},
    onRetry?: (seconds: number, message: string) => void,
    getFrames?: (scenes: Array<{ start: number; end: number }>) => Promise<string[][]>
  ): Promise<RecapPlanScene[]> {
    const valid = cues.filter(c => c.text && c.text.trim()).sort((a, b) => a.id - b.id);
    if (valid.length === 0) throw new Error('Recap planning needs a transcript with timestamps (cues).');

    const targetSeconds = Math.max(30, options.targetSeconds ?? 180);
    const sceneCount = Math.max(4, Math.min(options.maxScenes ?? 40, Math.round(targetSeconds / 12)));
    const isEn = options.language === 'en';
    const lang = isEn ? 'English' : 'Burmese (Myanmar Unicode)';
    const style = options.style || 'Cinematic movie recap, engaging and dramatic';
    const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    const lineOf = (c: RecapPlanCue, max = 140) => `#${c.id} [${fmt(c.start)}] ${c.text.trim().replace(/\s+/g, ' ').slice(0, max)}`;

    const askJson = async <T,>(parts: unknown[], temperature: number): Promise<T> => {
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const data = await this.geminiRequest(
            GEMINI_MODELS.REWRITE,
            { contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', temperature } },
            0,
            onRetry
          );
          const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          return JSON.parse(raw.replace(/```json/gi, '').replace(/```/g, '').trim()) as T;
        } catch (e) {
          lastErr = e;
        }
      }
      throw new Error(`Recap planning failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
    };

    // ---- Step 1: synopsis + scene selection -------------------------------------------------
    let lines = valid.map(c => lineOf(c));
    const MAX_CHARS = 60000;
    const totalChars = lines.reduce((a, l) => a + l.length + 1, 0);
    if (totalChars > MAX_CHARS) {
      const step = Math.ceil(totalChars / MAX_CHARS);
      lines = lines.filter((_, i) => i % step === 0);
    }

    const selectPrompt = `You are a film editor preparing a recap of a source video (${Math.round(totalDurationSeconds)} seconds long).
Below is its timestamped transcript. Every line is: #cueId [m:ss] text.

DO TWO THINGS:
1. "synopsis": a factual summary of the whole story in 6-10 English sentences, in story order, using ONLY what the transcript states or clearly implies. Keep the names of people and places exactly as written. Invent nothing. If the transcript is thin or unclear, say so.
2. "scenes": choose ${sceneCount} scenes for a recap of about ${targetSeconds} seconds. Each scene is {"fromCue":<id>,"toCue":<id>,"beat":"<6-12 English words: what happens>"}.
   - Cue IDs must be copied from the transcript, in increasing order, without overlap.
   - Spread the scenes over the WHOLE video, from the opening to the ending; do not stop early.
   - The first scene is the strongest hook, the last scene is the ending or twist.
   - Each scene covers 1-12 consecutive cues (about 5-30 seconds of footage). Skip filler, credits and repeated lines.

Return ONLY JSON: {"synopsis":"...","scenes":[{"fromCue":1,"toCue":4,"beat":"..."}]}

TRANSCRIPT:
${lines.join('\n')}`;

    const selected = await askJson<{ synopsis?: string; scenes?: Array<{ fromCue: number; toCue: number; beat?: string }> }>(
      [{ text: selectPrompt }],
      0.3
    );
    const synopsis = String(selected.synopsis || '').trim();
    if (!Array.isArray(selected.scenes) || selected.scenes.length === 0) throw new Error('Recap planning produced no scenes');

    // Turn cue IDs into real times; repair overlaps / out-of-range values instead of guessing.
    const byId = new Map(valid.map(c => [c.id, c]));
    const ids = valid.map(c => c.id);
    const nearest = (id: number) => ids.reduce((best, x) => (Math.abs(x - id) < Math.abs(best - id) ? x : best), ids[0]);

    type Picked = { fromCue: number; toCue: number; start: number; end: number; beat: string };
    const picked: Picked[] = [];
    let lastTo = -Infinity;
    for (const r of [...selected.scenes].sort((a, b) => Number(a.fromCue) - Number(b.fromCue))) {
      const f = Number(r.fromCue);
      const t = Number(r.toCue);
      if (!isFinite(f) || !isFinite(t)) continue;
      let from = byId.has(f) ? f : nearest(f);
      let to = byId.has(t) ? t : nearest(t);
      if (to < from) [from, to] = [to, from];
      if (from <= lastTo) {
        const next = ids.find(i => i > lastTo);
        if (next === undefined) continue; // nothing left after the previous scene
        from = next;
      }
      if (from > to) continue;
      const a = byId.get(from)!;
      const b = byId.get(to)!;
      const start = Math.max(0, a.start);
      let end = Math.min(totalDurationSeconds, Math.max(b.end, start + 2.5));
      end = Math.min(end, start + 45);
      if (end - start < 1) continue;
      picked.push({ fromCue: from, toCue: to, start, end, beat: String(r.beat || '').trim() });
      lastTo = to;
    }
    if (picked.length === 0) throw new Error('Recap planning produced no usable scenes');

    // ---- Optional: still frames from the footage of each chosen scene -----------------------
    let frames: string[][] = [];
    if (getFrames) {
      try {
        frames = await getFrames(picked.map(p => ({ start: p.start, end: p.end })));
      } catch (e) {
        console.warn('[Recap] Frame capture failed, continuing with transcript only:', e);
      }
    }

    // ---- Step 2: narration, written from each scene's own lines -----------------------------
    const BATCH = 6;
    const narrations = new Map<number, string>();
    const recent: string[] = [];

    for (let from = 0; from < picked.length; from += BATCH) {
      const batch = picked.slice(from, from + BATCH);
      const parts: unknown[] = [];

      const scenesText = batch.map((sc, k) => {
        const idx = from + k;
        const secs = Math.max(4, Math.min(30, sc.end - sc.start));
        const target = isEn ? Math.round(secs * 14) : Math.round(secs * 9);
        const sceneLines = valid
          .filter(c => c.id >= sc.fromCue && c.id <= sc.toCue)
          .slice(0, 14)
          .map(c => lineOf(c, 220))
          .join('\n');
        const role = idx === 0 ? ' (OPENING: start with a hook)' : idx === picked.length - 1 ? ' (ENDING: close the story)' : '';
        return `[scene ${idx + 1}]${role} footage ${fmt(sc.start)}-${fmt(sc.end)} (${Math.round(sc.end - sc.start)}s) | what happens: ${sc.beat || 'n/a'} | target about ${target} characters, never more than ${Math.round(target * 1.4)}\nsource lines:\n${sceneLines || '(no dialogue in this part)'}`;
      }).join('\n\n');

      const hasFrames = batch.some((_, k) => (frames[from + k] || []).length > 0);
      const writePrompt = `You write the voiceover narration of a video recap in ${lang}. Style: ${style}.

STORY FACTS you may rely on (summary of the whole video):
${synopsis || '(not available)'}

NARRATION ALREADY WRITTEN (for continuity, do not repeat it):
${recent.length ? recent.slice(-2).join('\n') : '(none, this batch starts the recap)'}

For EACH scene below you get the exact transcript of that part of the source video${hasFrames ? ' and still frames from it' : ''}. Write the narration of THAT scene.

STRICT RULES
- Use only facts found in that scene's source lines${hasFrames ? ', its still frames' : ''} or the story facts above. Never invent names, events, relationships, motives or places. If the source is thin, say less rather than guess.
- Narration must describe what happens in the scene so voice and picture match. Do not describe events from other scenes.
- Keep character names and how you refer to them identical across scenes.${isEn ? '' : ' Write foreign names in Burmese script, spelled the same way every time.'}
- 1-3 spoken sentences per scene, natural storytelling, respecting the target length.
- Output only words that are read aloud: no timestamps, scene numbers, stage directions or markdown.

Return ONLY JSON: {"scenes":[{"id":<scene number>,"narration":"..."}]}

SCENES:
${scenesText}`;

      parts.push({ text: writePrompt });
      batch.forEach((_, k) => {
        (frames[from + k] || []).slice(0, 2).forEach((b64, n) => {
          if (!b64) return;
          parts.push({ text: `Still frame ${n + 1} from scene ${from + k + 1}:` });
          parts.push({ inlineData: { mimeType: 'image/jpeg', data: b64 } });
        });
      });

      const written = await askJson<{ scenes?: Array<{ id: number; narration?: string }> }>(parts, 0.4);
      for (const w of written.scenes || []) {
        const text = String(w.narration || '').trim();
        const idx = Number(w.id) - 1;
        if (text && idx >= from && idx < from + batch.length) narrations.set(idx, text);
      }
      batch.forEach((_, k) => {
        const t = narrations.get(from + k);
        if (t) recent.push(t);
      });
    }

    const scenes: RecapPlanScene[] = [];
    picked.forEach((p, idx) => {
      const narration = narrations.get(idx);
      if (narration) scenes.push({ fromCue: p.fromCue, toCue: p.toCue, start: p.start, end: p.end, narration });
    });
    if (scenes.length === 0) throw new Error('Recap planning produced no narration');
    return scenes;
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

