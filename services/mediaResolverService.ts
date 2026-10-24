import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface ResolvedMediaResult {
  upload_url: string;
  title: string;
  source: 'youtube' | 'tiktok' | 'direct';
  duration?: number;
}

export interface MediaResolverOptions {
  cookies?: string;
}

export class MediaResolverService {
  /**
   * Check if a URL is a YouTube link (regular, shorts, mobile, youtu.be, live)
   */
  static isYouTubeUrl(url: string): boolean {
    if (!url) return false;
    const clean = url.trim().toLowerCase();
    return clean.includes('youtube.com/') || clean.includes('youtu.be/');
  }

  /**
   * Check if a URL is a TikTok link
   */
  static isTikTokUrl(url: string): boolean {
    if (!url) return false;
    const clean = url.trim().toLowerCase();
    return clean.includes('tiktok.com/');
  }

  /**
   * Extract audio buffer from TikTok URL using high-speed TikWM API with fallback to yt-dlp
   */
  static async extractTikTokAudio(url: string, options?: MediaResolverOptions): Promise<{ buffer: Buffer; title: string }> {
    console.log(`[MediaResolver] Extracting TikTok audio for: ${url}`);
    
    // Strategy 1: TikWM API (High speed, zero watermark, returns direct MP3/MP4)
    try {
      const tikwmUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url.trim())}`;
      const response = await fetch(tikwmUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        }
      });

      if (response.ok) {
        const json = await response.json();
        if (json.code === 0 && json.data) {
          const directAudioUrl = json.data.music || json.data.play;
          const title = json.data.title || 'TikTok Audio';
          if (directAudioUrl) {
            console.log(`[MediaResolver] TikWM success, downloading stream: ${directAudioUrl.substring(0, 60)}...`);
            const audioStreamResp = await fetch(directAudioUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://www.tiktok.com/'
              }
            });

            if (audioStreamResp.ok) {
              const arrayBuf = await audioStreamResp.arrayBuffer();
              const buffer = Buffer.from(arrayBuf);
              if (buffer.length > 1000) {
                return { buffer, title };
              }
            }
          }
        }
      }
    } catch (tikwmErr) {
      console.warn('[MediaResolver] TikWM extraction failed, trying yt-dlp fallback:', tikwmErr);
    }

    // Strategy 2: yt-dlp fallback
    return await this.extractWithYtDlp(url, 'TikTok Audio', options);
  }

  /**
   * Extract audio buffer from YouTube URL using optimized yt-dlp
   */
  static async extractYouTubeAudio(url: string, options?: MediaResolverOptions): Promise<{ buffer: Buffer; title: string }> {
    console.log(`[MediaResolver] Extracting YouTube audio for: ${url}`);
    return await this.extractWithYtDlp(url, 'YouTube Audio', options);
  }

  /**
   * Common yt-dlp audio extractor
   */
  private static async extractWithYtDlp(
    url: string, 
    defaultTitle: string, 
    options?: MediaResolverOptions
  ): Promise<{ buffer: Buffer; title: string }> {
    const tmpDir = os.tmpdir();
    const fileId = `media_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const outputTemplate = path.join(tmpDir, `${fileId}.%(ext)s`);
    const finalMp3Path = path.join(tmpDir, `${fileId}.mp3`);
    let cookieFilePath: string | null = null;

    // Find yt-dlp executable
    let ytdlpBin = 'yt-dlp';
    const localBin = path.join(process.cwd(), 'bin', 'yt-dlp');
    if (fs.existsSync(localBin)) {
      ytdlpBin = localBin;
    }

    // Prepare node runtime path for JS challenge solver
    const nodeBin = process.execPath || '/usr/local/bin/node';
    const jsRuntimeArg = fs.existsSync(nodeBin) ? [`--js-runtimes`, `node:${nodeBin}`] : [];

    // Check if cookies are provided in options or environment or file
    const rawCookies = options?.cookies?.trim() || 
                       process.env.YOUTUBE_COOKIES?.trim() || 
                       (fs.existsSync(path.join(process.cwd(), 'cookies.txt')) ? fs.readFileSync(path.join(process.cwd(), 'cookies.txt'), 'utf8') : '');

    if (rawCookies) {
      cookieFilePath = path.join(tmpDir, `cookies_${fileId}.txt`);
      fs.writeFileSync(cookieFilePath, rawCookies, 'utf8');
      console.log(`[MediaResolver] Using YouTube cookies (${rawCookies.length} bytes)`);
    }

    const cookieArgs = cookieFilePath ? ['--cookies', cookieFilePath] : [];

    let title = defaultTitle;

    try {
      // First attempt title extraction
      try {
        const titleRes = await execFileAsync(ytdlpBin, [
          '--get-title',
          '--no-warnings',
          ...jsRuntimeArg,
          ...cookieArgs,
          '--extractor-args', 'youtube:player_client=android',
          '--user-agent', 'com.google.android.youtube/19.29.37 (Linux; U; Android 14) gzip',
          url
        ], { timeout: 15000 });
        if (titleRes.stdout && titleRes.stdout.trim()) {
          title = titleRes.stdout.trim().split('\n')[0];
        }
      } catch {
        // Continue with default title
      }

      console.log(`[MediaResolver] Downloading audio via yt-dlp for ${url}`);
      await execFileAsync(ytdlpBin, [
        '--user-agent', 'com.google.android.youtube/19.29.37 (Linux; U; Android 14) gzip',
        '--extractor-args', 'youtube:player_client=android',
        ...jsRuntimeArg,
        ...cookieArgs,
        '-f', 'ba/b',
        '-x',
        '--audio-format', 'mp3',
        '--audio-quality', '0',
        '-o', outputTemplate,
        '--max-filesize', '120M',
        '--no-playlist',
        url
      ], { timeout: 90000 });

      // Check if file exists
      if (fs.existsSync(finalMp3Path)) {
        const buffer = fs.readFileSync(finalMp3Path);
        try { fs.unlinkSync(finalMp3Path); } catch {}
        return { buffer, title };
      }

      // Check other extensions if mp3 was not generated
      const matchingFiles = fs.readdirSync(tmpDir).filter(f => f.startsWith(fileId));
      if (matchingFiles.length > 0) {
        const foundPath = path.join(tmpDir, matchingFiles[0]);
        const buffer = fs.readFileSync(foundPath);
        try { fs.unlinkSync(foundPath); } catch {}
        return { buffer, title };
      }

      throw new Error('yt-dlp completed but output audio file was not found.');
    } catch (err: unknown) {
      console.error('[MediaResolver] yt-dlp extraction error:', err);
      
      const errMsg = err instanceof Error ? err.message : String(err);
      const isBotBlocked = errMsg.includes("Sign in to confirm you’re not a bot") || 
                           errMsg.includes("Sign in to confirm you're not a bot") ||
                           errMsg.includes("LOGIN_REQUIRED") ||
                           errMsg.includes("confirm you’re not a bot");

      if (isBotBlocked) {
        throw new Error(
          `YOUTUBE_BOT_DETECTED: YouTube ၏ Bot စစ်ဆေးရေးစနစ် (Bot Protection) ကြောင့် Server မှ ဤဗီဒီယိုကို တိုက်ရိုက်ဆွဲယူခွင့် မရနိုင်ပါ။\n` +
          `အကြံပြုချက်- 'ဖိုင်တင်သွင်းမည် (Upload)' tab မှ မိမိစက်ထဲရှိ Video/Audio ဖိုင်ကို တိုက်ရိုက်တင်သွင်းပါ (အကောင်းဆုံးနှင့် ၁၀၀% အောင်မြင်ပါသည်) သို့မဟုတ် TikTok လင့်ခ်များကို အသုံးပြုပါ။`
        );
      }

      throw new Error(`Media audio extraction failed: ${errMsg}`);
    } finally {
      // Clean up temp files & cookie file
      if (cookieFilePath && fs.existsSync(cookieFilePath)) {
        try { fs.unlinkSync(cookieFilePath); } catch {}
      }
      try {
        const matchingFiles = fs.readdirSync(tmpDir).filter(f => f.startsWith(fileId));
        for (const f of matchingFiles) {
          try { fs.unlinkSync(path.join(tmpDir, f)); } catch {}
        }
      } catch {}
    }
  }

  /**
   * Main resolver: Takes any URL (YouTube, TikTok, Direct), extracts audio, uploads to AssemblyAI, returns upload_url
   */
  static async resolveAndUploadToAssemblyAI(
    url: string, 
    apiKey: string, 
    options?: MediaResolverOptions
  ): Promise<ResolvedMediaResult> {
    const cleanUrl = url.trim();
    if (!cleanUrl) {
      throw new Error('URL is required');
    }

    const key = apiKey.trim();
    if (!key) {
      throw new Error('AssemblyAI API Key is required');
    }

    let audioBuffer: Buffer;
    let title = 'Audio Media';
    let source: 'youtube' | 'tiktok' | 'direct' = 'direct';

    if (this.isTikTokUrl(cleanUrl)) {
      source = 'tiktok';
      const extracted = await this.extractTikTokAudio(cleanUrl, options);
      audioBuffer = extracted.buffer;
      title = extracted.title;
    } else if (this.isYouTubeUrl(cleanUrl)) {
      source = 'youtube';
      const extracted = await this.extractYouTubeAudio(cleanUrl, options);
      audioBuffer = extracted.buffer;
      title = extracted.title;
    } else {
      // Direct media link (fetch audio directly)
      source = 'direct';
      title = cleanUrl.split('/').pop()?.split('?')[0] || 'Direct Audio';
      console.log(`[MediaResolver] Fetching direct media from: ${cleanUrl}`);
      const directResp = await fetch(cleanUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      if (!directResp.ok) {
        throw new Error(`Failed to fetch direct media URL (HTTP ${directResp.status})`);
      }
      const arrayBuf = await directResp.arrayBuffer();
      audioBuffer = Buffer.from(arrayBuf);
    }

    console.log(`[MediaResolver] Uploading extracted audio (${(audioBuffer.length / (1024 * 1024)).toFixed(2)} MB) to AssemblyAI...`);
    
    // Upload buffer to AssemblyAI
    const aaiUploadResp = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: {
        'Authorization': key,
        'Content-Type': 'application/octet-stream'
      },
      body: audioBuffer
    });

    if (!aaiUploadResp.ok) {
      const errText = await aaiUploadResp.text();
      throw new Error(`AssemblyAI upload failed: ${errText || aaiUploadResp.statusText}`);
    }

    const uploadData = await aaiUploadResp.json();
    if (!uploadData.upload_url) {
      throw new Error('No upload_url returned from AssemblyAI');
    }

    console.log(`[MediaResolver] Successfully resolved & uploaded to AssemblyAI: ${uploadData.upload_url}`);
    return {
      upload_url: uploadData.upload_url,
      title,
      source
    };
  }
}
