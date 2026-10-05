/**
 * AssemblyAI Speech-to-Text & Auto-SRT Subtitle Generation Service
 * Supports:
 * - Direct audio/video file upload or external media URL
 * - Automatic speech transcription with millisecond-accurate timestamps
 * - Native .SRT & .VTT subtitle generation
 * - Fallback to proxy route (/api/assemblyai/proxy) or direct browser fetch
 */

import { generateOptimizedSubtitles } from '../utils/subtitleUtils';

export interface AssemblyAIWord {
  text: string;
  start: number; // milliseconds
  end: number;   // milliseconds
  confidence: number;
  speaker?: string | null;
}

export interface AssemblyAIUtterance {
  start: number;
  end: number;
  confidence: number;
  channel?: string;
  speaker?: string;
  text: string;
  words: AssemblyAIWord[];
}

export interface AssemblyAITranscriptResponse {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  text?: string;
  words?: AssemblyAIWord[];
  utterances?: AssemblyAIUtterance[];
  confidence?: number;
  audio_duration?: number; // seconds
  language_code?: string;
  error?: string;
}

export interface AssemblyAITranscribeOptions {
  apiKey: string;
  audioUrl?: string;
  file?: File | Blob;
  youtubeCookies?: string;
  languageCode?: string;
  autoLanguage?: boolean;
  speakerLabels?: boolean;
  speechModel?: 'best' | 'nano';
  punctuate?: boolean;
  formatText?: boolean;
  onProgress?: (step: string, percent?: number) => void;
}

class AssemblyAIService {
  private static STORAGE_KEY = 'vbs_assemblyai_api_key';
  private static YOUTUBE_COOKIES_KEY = 'vbs_youtube_cookies';

  /**
   * Get the saved AssemblyAI API key from localStorage or env
   */
  getStoredApiKey(): string {
    const local = localStorage.getItem(AssemblyAIService.STORAGE_KEY);
    if (local && local.trim().length > 10) return local.trim();
    // Check if injected via Vite env
    const envKey = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_ASSEMBLYAI_API_KEY;
    if (envKey && envKey.trim().length > 10) return envKey.trim();
    return '';
  }

  /**
   * Get saved YouTube Cookies
   */
  getYoutubeCookies(): string {
    return localStorage.getItem(AssemblyAIService.YOUTUBE_COOKIES_KEY) || '';
  }

  /**
   * Save YouTube Cookies to localStorage
   */
  setYoutubeCookies(cookies: string): void {
    if (cookies && cookies.trim()) {
      localStorage.setItem(AssemblyAIService.YOUTUBE_COOKIES_KEY, cookies.trim());
    } else {
      localStorage.removeItem(AssemblyAIService.YOUTUBE_COOKIES_KEY);
    }
  }

  /**
   * Remove saved YouTube Cookies
   */
  clearYoutubeCookies(): void {
    localStorage.removeItem(AssemblyAIService.YOUTUBE_COOKIES_KEY);
  }

  /**
   * Save the AssemblyAI API key to localStorage
   */
  setStoredApiKey(key: string): void {
    if (key && key.trim()) {
      localStorage.setItem(AssemblyAIService.STORAGE_KEY, key.trim());
    } else {
      localStorage.removeItem(AssemblyAIService.STORAGE_KEY);
    }
  }

  /**
   * Remove the stored AssemblyAI API key
   */
  clearStoredApiKey(): void {
    localStorage.removeItem(AssemblyAIService.STORAGE_KEY);
  }

  /**
   * Detect type of media link (YouTube, TikTok, Direct)
   */
  detectUrlType(url: string): 'youtube' | 'tiktok' | 'direct' {
    if (!url) return 'direct';
    const clean = url.trim().toLowerCase();
    if (clean.includes('youtube.com/') || clean.includes('youtu.be/')) {
      return 'youtube';
    }
    if (clean.includes('tiktok.com/')) {
      return 'tiktok';
    }
    return 'direct';
  }

  /**
   * Resolve YouTube, TikTok, or web media URL, extract audio on the backend,
   * upload it to AssemblyAI, and return the upload_url
   */
  async resolveMediaUrl(
    url: string, 
    apiKey: string, 
    cookies?: string
  ): Promise<{ upload_url: string; title: string; source: 'youtube' | 'tiktok' | 'direct' }> {
    const key = apiKey.trim();
    if (!key) throw new Error('AssemblyAI API Key မရှိပါ။ ကျေးဇူးပြု၍ API Key အရင်ထည့်သွင်းပါ။');

    const cleanUrl = url.trim();
    if (!cleanUrl) throw new Error('Media URL ထည့်သွင်းပေးရန် လိုအပ်ပါသည်။');

    const effectiveCookies = cookies?.trim() || this.getYoutubeCookies();

    // Call backend endpoint to download and upload to AssemblyAI
    const resp = await fetch('/api/assemblyai/resolve-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-assemblyai-key': key
      },
      body: JSON.stringify({ 
        url: cleanUrl,
        cookies: effectiveCookies || undefined
      })
    });

    if (!resp.ok) {
      const errJson = await resp.json().catch(() => ({}));
      const rawError = errJson.error || '';
      
      if (errJson.isBotBlocked || rawError.includes('YOUTUBE_BOT_DETECTED') || rawError.includes('bot') || rawError.includes('Bot')) {
        throw new Error(
          `YouTube ၏ Bot စစ်ဆေးရေးစနစ် (Bot Verification) ကြောင့် Cloud Server မှ ဤဗီဒီယိုကို တိုက်ရိုက်ဆွဲယူခွင့် မရနိုင်ပါ။\n\n` +
          `အကြံပြုချက်- အမြန်ဆုံးနှင့် ၁၀၀% အဆင်ပြေစေရန် 'ဖိုင်တင်သွင်းမည် (Upload)' tab သို့ ပြောင်း၍ မိမိစက်ထဲရှိ Video/Audio ဖိုင်ကို တိုက်ရိုက်တင်သွင်းပါ (သို့မဟုတ် TikTok / Direct URL သုံးပါ)။`
        );
      }

      throw new Error(errJson.error || `Media ဒေါင်းလုဒ် မအောင်မြင်ပါ (HTTP ${resp.status})`);
    }

    const data = await resp.json();
    if (!data.upload_url) {
      throw new Error('Backend failed to return an AssemblyAI upload_url');
    }

    return data;
  }

  /**
   * Upload audio/video file to AssemblyAI hosting
   * Attempts server proxy first, falls back to direct AssemblyAI API if needed.
   */
  async uploadMedia(file: File | Blob, apiKey: string, onProgress?: (percent: number) => void): Promise<string> {
    const key = apiKey.trim();
    if (!key) throw new Error('AssemblyAI API Key မရှိပါ။ ကျေးဇူးပြု၍ API Key အရင်ထည့်သွင်းပါ။');

    onProgress?.(10);

    // Strategy 1: Try backend Express/Vercel proxy
    try {
      const formData = new FormData();
      formData.append('file', file);

      const resp = await fetch('/api/assemblyai/upload', {
        method: 'POST',
        headers: {
          'x-assemblyai-key': key
        },
        body: formData
      });

      if (resp.ok) {
        const data = await resp.json();
        if (data.upload_url) {
          return data.upload_url;
        }
      }
    } catch (proxyErr) {
      console.warn('[AssemblyAI] Backend upload proxy failed, trying direct upload:', proxyErr);
    }

    // Strategy 2: Direct upload to AssemblyAI API
    try {
      const uploadResp = await fetch('https://api.assemblyai.com/v2/upload', {
        method: 'POST',
        headers: {
          'Authorization': key,
          'Content-Type': 'application/octet-stream'
        },
        body: file
      });

      if (!uploadResp.ok) {
        const errJson = await uploadResp.json().catch(() => ({}));
        throw new Error(errJson.error || `Upload failed with status ${uploadResp.status}`);
      }

      const uploadData = await uploadResp.json();
      if (!uploadData.upload_url) {
        throw new Error('AssemblyAI upload did not return an upload_url');
      }

      return uploadData.upload_url;
    } catch (directErr) {
      console.error('[AssemblyAI] Direct upload failed:', directErr);
      throw new Error(`ဖိုင်တင်ခြင်း မအောင်မြင်ပါ: ${directErr instanceof Error ? directErr.message : String(directErr)}`);
    }
  }

  /**
   * Submit media URL for transcription
   */
  async submitTranscription(options: {
    audioUrl: string;
    apiKey: string;
    languageCode?: string;
    autoLanguage?: boolean;
    speakerLabels?: boolean;
    speechModel?: 'best' | 'nano';
    punctuate?: boolean;
    formatText?: boolean;
  }): Promise<string> {
    const {
      audioUrl,
      apiKey,
      languageCode,
      autoLanguage = true,
      speakerLabels = true,
      speechModel = 'best',
      punctuate = true,
      formatText = true
    } = options;

    const payload: Record<string, unknown> = {
      audio_url: audioUrl,
      speech_model: speechModel === 'nano' ? 'nano' : 'best',
      punctuate,
      format_text: formatText,
      speaker_labels: speakerLabels
    };

    if (languageCode && languageCode !== 'auto') {
      payload.language_code = languageCode;
    } else if (autoLanguage) {
      payload.language_detection = true;
    }

    // Strategy 1: Try proxy endpoint
    try {
      const resp = await fetch('/api/assemblyai/transcribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-assemblyai-key': apiKey.trim()
        },
        body: JSON.stringify(payload)
      });

      if (resp.ok) {
        const data = await resp.json();
        if (data.id) return data.id;
      }
    } catch (e) {
      console.warn('[AssemblyAI] Proxy transcribe failed, trying direct API:', e);
    }

    // Strategy 2: Direct API
    const directResp = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        'Authorization': apiKey.trim(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!directResp.ok) {
      const err = await directResp.json().catch(() => ({}));
      throw new Error(err.error || `Transcription request failed (${directResp.status})`);
    }

    const resData = await directResp.json();
    if (!resData.id) {
      throw new Error('No transcript ID returned by AssemblyAI');
    }

    return resData.id;
  }

  /**
   * Poll transcript status until completed or failed
   */
  async pollTranscript(id: string, apiKey: string): Promise<AssemblyAITranscriptResponse> {
    // Try proxy
    try {
      const resp = await fetch(`/api/assemblyai/transcript/${id}`, {
        headers: { 'x-assemblyai-key': apiKey.trim() }
      });
      if (resp.ok) {
        return await resp.json();
      }
    } catch {
      // ignore, fall back
    }

    // Direct
    const directResp = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { 'Authorization': apiKey.trim() }
    });

    if (!directResp.ok) {
      const err = await directResp.json().catch(() => ({}));
      throw new Error(err.error || `Polling failed (${directResp.status})`);
    }

    return await directResp.json();
  }

  /**
   * Fetch ready-to-use SRT subtitles from AssemblyAI (with custom chars_per_caption)
   */
  async getSrtContent(id: string, apiKey: string, charsPerCaption = 36): Promise<string> {
    const query = charsPerCaption ? `?chars_per_caption=${charsPerCaption}` : '';
    const isValidSrt = (text: string): boolean => {
      if (!text || text.trim().length === 0) return false;
      const clean = text.trim();
      if (clean.startsWith('<') || clean.toLowerCase().includes('<!doctype') || clean.toLowerCase().includes('<html')) return false;
      return /-->|->/.test(clean);
    };

    // Try proxy
    try {
      const resp = await fetch(`/api/assemblyai/transcript/${id}/srt${query}`, {
        headers: { 'x-assemblyai-key': apiKey.trim() }
      });
      const contentType = resp.headers.get('content-type') || '';
      if (resp.ok && !contentType.includes('text/html')) {
        const srtText = await resp.text();
        if (isValidSrt(srtText)) return srtText;
      }
    } catch {
      // fallback
    }

    // Direct
    const directResp = await fetch(`https://api.assemblyai.com/v2/transcript/${id}/srt${query}`, {
      headers: { 'Authorization': apiKey.trim() }
    });

    if (!directResp.ok) {
      throw new Error(`Failed to fetch SRT subtitles (${directResp.status})`);
    }

    const srtText = await directResp.text();
    if (isValidSrt(srtText)) {
      return srtText;
    }
    throw new Error('Received invalid SRT content from endpoint');
  }

  /**
   * Helper to format milliseconds to SRT timestamp: 00:01:23,456
   */
  formatSrtTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const milliseconds = Math.floor(ms % 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const pad = (n: number, z = 2) => String(n).padStart(z, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(milliseconds, 3)}`;
  }

  /**
   * Generate SRT manually from word-level timestamps with silence/pause detection
   * Ensures captions match spoken words in video frame-by-frame without staying open during silences.
   */
  generateSrtFromWords(words: AssemblyAIWord[], maxCharsPerLine = 38, maxDurationMs = 3600): string {
    if (!words || words.length === 0) return '';

    const lines: Array<{ start: number; end: number; text: string; speaker?: string | null }> = [];
    let currentWords: AssemblyAIWord[] = [];
    let currentLength = 0;

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const wordText = (w.text || '').trim();
      if (!wordText) continue;

      currentWords.push(w);
      currentLength += wordText.length + 1;

      const firstWord = currentWords[0];
      const duration = w.end - firstWord.start;

      const nextWord = i + 1 < words.length ? words[i + 1] : null;
      const isNextDifferentSpeaker = nextWord ? nextWord.speaker !== w.speaker : false;
      const pauseAfterWord = nextWord ? (nextWord.start - w.end) : 0;
      const isPunctuationEnd = /[.!?။]$/.test(wordText);

      // Natural subtitle break conditions:
      // 1. Pause between words (>600ms) - speaker paused/stopped speaking
      // 2. Sentence end punctuation with pause (>300ms)
      // 3. Speaker change
      // 4. Max characters reached or duration exceeded
      // 5. Last word in transcript
      const shouldBreak =
        !nextWord ||
        isNextDifferentSpeaker ||
        (pauseAfterWord > 600 && currentWords.length >= 1) ||
        (isPunctuationEnd && pauseAfterWord > 300) ||
        currentLength >= maxCharsPerLine ||
        duration >= maxDurationMs;

      if (shouldBreak) {
        lines.push({
          start: firstWord.start,
          end: Math.max(w.end, firstWord.start + 500),
          text: currentWords.map(item => item.text).join(' '),
          speaker: firstWord.speaker
        });
        currentWords = [];
        currentLength = 0;
      }
    }

    return lines
      .map((item, index) => {
        const timecode = `${this.formatSrtTime(item.start)} --> ${this.formatSrtTime(item.end)}`;
        const speakerPrefix = item.speaker ? `[Speaker ${item.speaker}]: ` : '';
        return `${index + 1}\r\n${timecode}\r\n${speakerPrefix}${item.text}\r\n`;
      })
      .join('\r\n');
  }

  /**
   * High-level complete runner:
   * Takes audio/video file OR public URL -> uploads -> submits -> polls -> returns transcript + srt
   */
  async processToSrt(options: AssemblyAITranscribeOptions): Promise<{
    transcript: AssemblyAITranscriptResponse;
    srt: string;
    audioUrl: string;
  }> {
    const { apiKey, file, audioUrl: providedUrl, onProgress } = options;

    let targetAudioUrl = providedUrl?.trim() || '';

    // Step 1: Upload media if file provided, or extract from YouTube/TikTok if URL provided
    if (file) {
      onProgress?.('ဖိုင်ကို စနစ်ထဲသို့ တင်သွင်းနေပါသည်...', 15);
      targetAudioUrl = await this.uploadMedia(file, apiKey, (p) => {
        onProgress?.(`ဖိုင်ကို တင်သွင်းနေပါသည်... (${p}%)`, Math.round(p * 0.3));
      });
    } else if (targetAudioUrl) {
      const urlType = this.detectUrlType(targetAudioUrl);
      if (urlType === 'youtube' || urlType === 'tiktok') {
        const platformName = urlType === 'youtube' ? 'YouTube' : 'TikTok';
        onProgress?.(`${platformName} မှ အသံဖိုင်ကို ရယူနေပါသည်...`, 10);
        
        try {
          const resolved = await this.resolveMediaUrl(targetAudioUrl, apiKey, options.youtubeCookies);
          targetAudioUrl = resolved.upload_url;
          onProgress?.(`အသံဖိုင်ကို စနစ်ထဲသို့ ထည့်သွင်းပြီးပါပြီ`, 30);
        } catch (resolveErr: unknown) {
          console.error(`[AssemblyAI] ${platformName} resolution failed:`, resolveErr);
          throw resolveErr;
        }
      }
    }

    if (!targetAudioUrl) {
      throw new Error('အသံ သို့မဟုတ် ဗီဒီယို ဖိုင်/URL ထည့်သွင်းပေးရန် လိုအပ်ပါသည်။');
    }

    // Step 2: Submit transcription request
    onProgress?.('အသံဖိုင်အား စာတန်းထိုး စတင်ခွဲခြမ်းစိတ်ဖြာနေပါသည်...', 35);
    const transcriptId = await this.submitTranscription({
      ...options,
      audioUrl: targetAudioUrl
    });

    // Step 3: Polling
    onProgress?.('အသံနှင့် စာသား အချိန်ကိုက် ချိန်ညှိနေပါသည်...', 50);

    let attempts = 0;
    const maxAttempts = 180; // ~6 minutes max with 2s interval
    let transcriptResult: AssemblyAITranscriptResponse | null = null;

    while (attempts < maxAttempts) {
      attempts++;
      await new Promise(res => setTimeout(res, 2500));

      const status = await this.pollTranscript(transcriptId, apiKey);

      if (status.status === 'completed') {
        transcriptResult = status;
        break;
      }

      if (status.status === 'error') {
        throw new Error(status.error || 'စာတန်းထိုး ထုတ်ယူမှုတွင် အမှားတစ်ခု ဖြစ်ပေါ်ခဲ့ပါသည်');
      }

      const progressPercent = Math.min(92, 50 + Math.round((attempts / 40) * 40));
      onProgress?.('အသံဖိုင် စာတန်းထိုး တိကျစွာ ထုတ်လုပ်နေပါသည်...', progressPercent);
    }

    if (!transcriptResult) {
      throw new Error('အချိန်ကြာမြင့်နေသဖြင့် ခေတ္တစောင့်ဆိုင်းပြီး ပြန်လည်စစ်ဆေးပေးပါ။');
    }

    // Step 4: Generate time-synchronized SRT Subtitle File
    onProgress?.('SRT စာတန်းထိုးဖိုင်ကို အချိန်ကိုက် စီစဉ်ပြင်ဆင်နေပါသည်...', 96);
    let srtText = '';

    // Strategy 1: Prefer high-precision word-level timestamps with silence pause detection
    const allWords: AssemblyAIWord[] = (transcriptResult.words && transcriptResult.words.length > 0)
      ? transcriptResult.words
      : (transcriptResult.utterances?.flatMap(u => (u.words || []).map(w => ({ ...w, speaker: u.speaker }))) || []);

    if (allWords && allWords.length > 0) {
      srtText = this.generateSrtFromWords(allWords, 36, 3500);
    }

    // Strategy 2: If word-level SRT was empty, build SRT directly from utterances
    if ((!srtText || srtText.trim().length === 0 || !srtText.includes('-->')) && transcriptResult.utterances && transcriptResult.utterances.length > 0) {
      srtText = transcriptResult.utterances.map((u, i) => {
        const timecode = `${this.formatSrtTime(u.start)} --> ${this.formatSrtTime(u.end)}`;
        const speakerPrefix = u.speaker ? `[Speaker ${u.speaker}]: ` : '';
        return `${i + 1}\r\n${timecode}\r\n${speakerPrefix}${u.text}\r\n`;
      }).join('\r\n');
    }

    // Strategy 3: Fetch directly from AssemblyAI native SRT endpoint
    if (!srtText || srtText.trim().length === 0 || !srtText.includes('-->')) {
      try {
        srtText = await this.getSrtContent(transcriptId, apiKey, 36);
      } catch (e) {
        console.warn('SRT endpoint fallback failed:', e);
      }
    }

    // Strategy 4: Fallback to synthetic timed subtitles from transcript text & duration
    if ((!srtText || srtText.trim().length === 0 || !srtText.includes('-->')) && transcriptResult.text) {
      const dur = transcriptResult.audio_duration || 60;
      const synthSubtitles = generateOptimizedSubtitles(transcriptResult.text, dur);
      srtText = synthSubtitles.map((sub, i) => {
        const start = sub.startTime.replace(/\./g, ',');
        const end = sub.endTime.replace(/\./g, ',');
        return `${i + 1}\r\n${start} --> ${end}\r\n${sub.text}\r\n`;
      }).join('\r\n');
    }

    onProgress?.('စာတန်းထိုး ထုတ်ယူမှု အောင်မြင်စွာ ပြီးစီးပါပြီ!', 100);

    return {
      transcript: transcriptResult,
      srt: srtText,
      audioUrl: targetAudioUrl
    };
  }
}

export const assemblyAiService = new AssemblyAIService();
