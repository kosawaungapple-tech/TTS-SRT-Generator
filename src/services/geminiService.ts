import { GenerateContentResponse } from "@google/genai";
import { TTSConfig, AudioResult, SRTSubtitle } from "../types";
import { GEMINI_MODELS, VOICE_OPTIONS } from "../constants";
import { pcmToWav, formatTime } from "../utils/audioUtils";
import { getIdToken } from "../firebase";

export class GeminiTTSService {
  private apiKey: string;

  constructor(apiKey?: string) {
    const rawKey = apiKey || (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : '') || '';
    this.apiKey = rawKey.trim();
    console.log("GeminiTTSService: Initialized with key:", this.apiKey ? `Present (Starts with ${this.apiKey.substring(0, 4)}...)` : "Missing");
  }

  async verifyConnection(): Promise<{ isValid: boolean; status?: number; error?: string }> {
    if (!this.apiKey) {
      console.error("GeminiTTSService: Cannot verify connection - API Key is empty");
      return { isValid: false, error: "Empty API Key" };
    }

    try {
      console.log("GeminiTTSService: Verifying connection via proxy...");
      const idToken = await getIdToken();
      if (!idToken) throw new Error("Unauthenticated: No ID Token");

      const response = await fetch("/api/proxy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`
        },
        body: JSON.stringify({
          apiKey: this.apiKey,
          model: GEMINI_MODELS.VERIFY,
          contents: [{ parts: [{ text: "Hello" }] }]
        })
      });

      if (response.ok) {
        return { isValid: true };
      } else {
        const data = await response.json();
        return { isValid: false, error: data.error || "Proxy verification failed", status: response.status };
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
      
      const dummyBytes = new Uint8Array(24000 * 2 * 5); // 5 seconds of silence for mock
      const wavBlob = pcmToWav(dummyBytes, 24000);
      const audioUrl = URL.createObjectURL(wavBlob);
      const duration = dummyBytes.length / (24000 * 2);
      const subtitles = this.generateMockSRT(text, duration);
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

    console.log("TTS Service: Sending request to Gemini TTS Proxy (Binary)...", { speed, pitch, volumeGainDb });

    try {
      const idToken = await getIdToken();
      if (!idToken) {
        throw new Error("Unauthenticated: No ID Token. Please enable Anonymous Auth in Firebase Console.");
      }

      // Add a timeout to the fetch request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

      const response = await fetch("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`
        },
        body: JSON.stringify({
          apiKey: this.apiKey,
          text: text,
          config: {
            ...config,
            speed,
            pitch,
            volume,
            voiceName: voice.voiceName
          }
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `Proxy error: ${response.status}` }));
        console.error("TTS Service: Proxy returned error:", errorData);
        
        let errorMessage = `Proxy error: ${response.status}`;
        if (errorData.error) {
          if (typeof errorData.error === 'object') {
            errorMessage = errorData.error.message || JSON.stringify(errorData.error);
          } else {
            errorMessage = errorData.error;
          }
        }

        // Special handling for Quota Exceeded
        if (errorMessage.toLowerCase().includes('quota exceeded') || response.status === 429) {
          errorMessage = "Gemini API Quota Exceeded. ကျေးဇူးပြု၍ ခေတ္တစောင့်ဆိုင်းပြီးမှ ပြန်လည်ကြိုးစားပေးပါ။ သို့မဟုတ် Settings တွင် သင်၏ကိုယ်ပိုင် API Key ကို အသုံးပြုပါ။ (Free tier limit reached. Please wait or use your own API Key in Settings.)";
        }
        
        throw new Error(errorMessage);
      }

      // Check for generated text in headers
      const xGeneratedText = response.headers.get('X-Generated-Text');
      let finalScript = text;
      if (xGeneratedText) {
        try {
          // Decode base64 text from header
          const decodedText = atob(xGeneratedText);
          // Handle UTF-8 correctly
          const utf8Text = decodeURIComponent(escape(decodedText));
          finalScript = utf8Text;
          console.log("TTS Service: Received generated script from Gemini:", finalScript.substring(0, 50) + "...");
        } catch (e) {
          console.warn("TTS Service: Failed to decode X-Generated-Text header", e);
        }
      }

      const wavBlob = await response.blob();
      console.log("TTS Service: Received binary audio from Proxy", { size: wavBlob.size });

      if (wavBlob.size < 100) {
        throw new Error('Generated audio file is corrupted or empty.');
      }

      const audioUrl = URL.createObjectURL(wavBlob);
      
      // We need the base64 for the history storage, so we convert it back
      const audioData = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.readAsDataURL(wavBlob);
      });

      // Calculate duration roughly from blob size (minus 44 byte header)
      // 24000 samples/sec * 2 bytes/sample = 48000 bytes/sec
      const duration = (wavBlob.size - 44) / 48000;
      console.log(`TTS Service: Audio generation complete. Duration: ${duration.toFixed(3)}s`);
      
      const subtitles = this.generateMockSRT(finalScript, duration);
      const srtContent = subtitles.map(s => 
        `${s.index}\n${s.startTime} --> ${s.endTime}\n${s.text}\n`
      ).join('\n');

      return {
        audioUrl,
        audioData,
        wavBlob,
        srtContent,
        subtitles,
        generatedText: finalScript !== text ? finalScript : undefined
      };
    } catch (err: any) {
      const errorMsg = err instanceof Error ? err.message : JSON.stringify(err);
      console.error("TTS Service: Proxy API call failed. Full error details:", errorMsg);
      
      // Detailed logging for "Load failed" (TypeError)
      if (err instanceof TypeError && errorMsg === "Load failed") {
        console.error("TTS Service: Network error or connection reset. This often happens if the server is restarting or the request timed out.");
      } else if (err.name === "AbortError") {
        console.error("TTS Service: Request was aborted (timeout).");
      }

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
      const text = lines.slice(2).join('\n');
      return { index, startTime, endTime, text };
    }).filter((s): s is SRTSubtitle => s !== null);
  }

  private generateMockSRT(text: string, duration: number): SRTSubtitle[] {
    const totalChars = text.length;
    const charPerSec = totalChars / duration;
    
    // Commander's Order: Max 1.5 - 2.0 seconds per segment.
    // We calculate a dynamic character limit based on the speaking rate.
    const maxCharsForTwoSeconds = Math.floor(charPerSec * 1.8); 
    const MAX_PHRASE_CHARS = Math.max(12, Math.min(25, maxCharsForTwoSeconds));

    // 1. Split text into meaningful phrases (Burmese phrase-aware)
    const segments = this.splitTextIntoPhrases(text, MAX_PHRASE_CHARS);
    const subtitles: SRTSubtitle[] = [];
    
    const TOTAL_DURATION = duration; 
    const MAX_SEGMENT_DURATION = 2.0; 
    const MIN_SEGMENT_DURATION = 0.8; 
    
    // First pass: calculate raw durations
    let rawDurations = segments.map(s => (s.length / totalChars) * TOTAL_DURATION);
    
    // Second pass: enforce constraints
    let totalAssigned = 0;
    let adjustedDurations = rawDurations.map(d => {
      // Clamp duration between min and max
      const adj = Math.max(MIN_SEGMENT_DURATION, Math.min(d, MAX_SEGMENT_DURATION));
      totalAssigned += adj;
      return adj;
    });

    // Scale to fit total duration exactly
    const scaleFactor = TOTAL_DURATION / totalAssigned;
    adjustedDurations = adjustedDurations.map(d => d * scaleFactor);

    let currentTime = 0;

    segments.forEach((segmentText, index) => {
      const formattedText = this.applyInternalLineBreaks(segmentText, 45);
      const segmentDuration = adjustedDurations[index];
      
      const startTime = currentTime;
      let endTime = currentTime + segmentDuration;
      
      // Ensure the last segment ends exactly at 40.000
      if (index === segments.length - 1) {
        endTime = TOTAL_DURATION;
      }

      subtitles.push({
        index: index + 1,
        startTime: formatTime(startTime),
        endTime: formatTime(endTime),
        text: formattedText
      });
      
      currentTime = endTime;
    });

    return subtitles;
  }

  private isBurmeseDependent(char: string): boolean {
    if (!char) return false;
    const code = char.charCodeAt(0);
    // Burmese dependent characters (vowels, medials, asat, etc.)
    // Range: \u102B-\u103E
    return (code >= 0x102B && code <= 0x103E);
  }

  private getSafeSplitIndex(text: string, index: number): number {
    let safeIndex = index;
    while (safeIndex < text.length && this.isBurmeseDependent(text[safeIndex])) {
      safeIndex++;
    }
    return safeIndex;
  }

  private splitTextIntoPhrases(text: string, maxChars: number = 28): string[] {
    // Burmese phrase markers and punctuation
    const punctuation = ['။', '၊'];
    
    // First, split by punctuation which are definitive breaks
    let segments: string[] = [text];

    punctuation.forEach(p => {
      let nextTemp: string[] = [];
      segments.forEach(s => {
        const parts = s.split(p);
        parts.forEach((part, i) => {
          let trimmed = part.trim();
          if (trimmed) {
            // Add the punctuation back if it's not the last part
            if (i < parts.length - 1) trimmed += p;
            nextTemp.push(trimmed);
          }
        });
      });
      segments = nextTemp;
    });

    // Now further split long segments by spaces, markers or character limits
    // Reduced limit for short, punchy fragments (TikTok/Reels style)
    const MAX_PHRASE_CHARS = maxChars; 
    const MIN_PHRASE_CHARS = Math.floor(maxChars / 3);
    const markers = ['ကြောင့်', 'ပြီး', 'ဆို', 'ကို', 'မှာ', 'ဖြင့်', 'လျှင်', 'သော်လည်း', 'သဖြင့်', '၍', '၏', '၌', 'မှ', 'သို့', 'နှင့်', 'လည်း', 'ပင်', 'သာ', 'ကော', 'ပါ', 'ဦး', 'တော့', 'လေ', 'ပေါ့', 'နော်', 'ဖြစ်', 'သည်', '၏', 'က', 'ကို', 'မှ'];

    let intermediateSegments: string[] = [];
    segments.forEach(s => {
      if (s.length <= MAX_PHRASE_CHARS) {
        intermediateSegments.push(s);
      } else {
        let subCurrent = s;
        while (subCurrent.length > MAX_PHRASE_CHARS) {
          // 1. Try splitting at space first for phrase integrity
          let splitIdx = subCurrent.lastIndexOf(' ', MAX_PHRASE_CHARS);
          
          // 2. If no space, try markers
          if (splitIdx === -1) {
            for (const marker of markers) {
              const idx = subCurrent.lastIndexOf(marker, MAX_PHRASE_CHARS);
              if (idx > splitIdx) splitIdx = idx + marker.length;
            }
          }

          if (splitIdx !== -1 && splitIdx > 10) {
            // Ensure we don't split a cluster even at a marker/space
            splitIdx = this.getSafeSplitIndex(subCurrent, splitIdx);
            intermediateSegments.push(subCurrent.substring(0, splitIdx).trim());
            subCurrent = subCurrent.substring(splitIdx).trim();
          } else {
            // 3. Fallback to character limit with safe split
            const safeIdx = this.getSafeSplitIndex(subCurrent, MAX_PHRASE_CHARS);
            intermediateSegments.push(subCurrent.substring(0, safeIdx).trim());
            subCurrent = subCurrent.substring(safeIdx).trim();
          }
        }
        if (subCurrent) intermediateSegments.push(subCurrent);
      }
    });

    // Final pass: Combine segments that are too short to ensure natural reading flow
    let finalSegments: string[] = [];
    let currentBuffer = "";

    intermediateSegments.forEach((seg) => {
      if (currentBuffer === "") {
        currentBuffer = seg;
      } else if (currentBuffer.length + seg.length < MAX_PHRASE_CHARS) {
        // Combine if the result is still within a reasonable phrase length
        // Use space if it's not already ending with punctuation
        const separator = /[။၊]$/.test(currentBuffer) ? "" : " ";
        currentBuffer += separator + seg;
      } else {
        finalSegments.push(currentBuffer.trim());
        currentBuffer = seg;
      }
    });
    
    if (currentBuffer) {
      if (currentBuffer.length < MIN_PHRASE_CHARS && finalSegments.length > 0) {
        const separator = /[။၊]$/.test(finalSegments[finalSegments.length - 1]) ? "" : " ";
        finalSegments[finalSegments.length - 1] += separator + currentBuffer;
      } else {
        finalSegments.push(currentBuffer.trim());
      }
    }

    return finalSegments.filter(s => s.length > 0);
  }

  private splitTextIntoSegments(text: string, maxWords: number, maxChars: number): string[] {
    // This is now a legacy method, but we'll keep it for compatibility if needed
    return this.splitTextIntoPhrases(text);
  }

  private applyInternalLineBreaks(text: string, maxCharsPerLine: number): string {
    if (text.length <= maxCharsPerLine) return text;
    
    // Find a good place to split (e.g., middle space)
    const mid = Math.floor(text.length / 2);
    const spaceBefore = text.lastIndexOf(' ', mid);
    const spaceAfter = text.indexOf(' ', mid);
    
    let splitIdx = -1;
    if (spaceBefore !== -1 && spaceAfter !== -1) {
      splitIdx = (mid - spaceBefore < spaceAfter - mid) ? spaceBefore : spaceAfter;
    } else {
      splitIdx = spaceBefore !== -1 ? spaceBefore : spaceAfter;
    }
    
    if (splitIdx !== -1) {
      const safeSplitIdx = this.getSafeSplitIndex(text, splitIdx);
      // If we adjusted the split index, we might have moved past a space, 
      // so we handle the newline carefully
      if (safeSplitIdx === splitIdx) {
        return text.substring(0, splitIdx).trim() + '\n' + text.substring(splitIdx + 1).trim();
      } else {
        return text.substring(0, safeSplitIdx).trim() + '\n' + text.substring(safeSplitIdx).trim();
      }
    }
    
    // No space found, split at mid but ensure it's safe
    const safeMid = this.getSafeSplitIndex(text, mid);
    if (safeMid >= text.length - 1) return text; // Don't split if it's too close to the end
    return text.substring(0, safeMid).trim() + '\n' + text.substring(safeMid).trim();
  }
}
