/**
 * VBS FFmpeg Worker Engine Client Service
 * Manages connection, real-time health heartbeat, and rendering
 * for Local PC Worker (http://localhost:5005) or VPS Server.
 */

export interface WorkerHealthInfo {
  status: 'online' | 'offline' | 'checking';
  engine?: string;
  version?: string;
  ffmpegAvailable?: boolean;
  ffmpegVersion?: string;
  platform?: string;
  hostname?: string;
  lanIps?: string[];
  isProxied?: boolean;
  uptimeSeconds?: number;
  lastChecked?: number;
  error?: string;
}

const STORAGE_KEY = 'VBS_FFMPEG_WORKER_URL';
export const DEFAULT_WORKER_URL = 'http://localhost:5005';

export class WorkerEngineService {
  private static cachedUrl: string | null = null;
  private static currentHealth: WorkerHealthInfo = { status: 'checking' };
  private static listeners: Set<(health: WorkerHealthInfo) => void> = new Set();
  private static checkTimer: number | null = null;

  public static getWorkerUrl(): string {
    if (this.cachedUrl) return this.cachedUrl;
    const stored = localStorage.getItem(STORAGE_KEY);
    this.cachedUrl = stored && stored.trim() ? stored.trim() : DEFAULT_WORKER_URL;
    return this.cachedUrl;
  }

  /** True for http(s)://localhost, 127.x.x.x and [::1]. */
  public static isLoopbackUrl(url: string): boolean {
    try {
      const h = new URL(url).hostname.replace(/^\[|\]$/g, '');
      return h === 'localhost' || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h);
    } catch {
      return false;
    }
  }

  /** Compares dotted versions, e.g. isVersionAtLeast('1.2.0', '1.3.0') === false. Unknown version = too old. */
  public static isVersionAtLeast(version: string | undefined, min: string): boolean {
    const parse = (v?: string) => (v || '0').split('.').map(n => parseInt(n, 10) || 0);
    const a = parse(version);
    const b = parse(min);
    for (let i = 0; i < 3; i++) {
      if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
    }
    return true;
  }

  public static setWorkerUrl(url: string): void {
    const clean = url.trim().replace(/\/+$/, '');
    this.cachedUrl = clean || DEFAULT_WORKER_URL;
    localStorage.setItem(STORAGE_KEY, this.cachedUrl);
    this.checkHealthNow();
  }

  public static subscribe(listener: (health: WorkerHealthInfo) => void): () => void {
    this.listeners.add(listener);
    listener(this.currentHealth);

    if (!this.checkTimer) {
      this.startHeartbeat();
    }

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.checkTimer) {
        window.clearInterval(this.checkTimer);
        this.checkTimer = null;
      }
    };
  }

  public static getHealth(): WorkerHealthInfo {
    return this.currentHealth;
  }

  public static async checkHealthNow(): Promise<WorkerHealthInfo> {
    const url = this.getWorkerUrl();
    const endpoint = `${url}/health`;

    // 1. Try Direct fetch first
    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 2000);

      const resp = await fetch(endpoint, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });
      window.clearTimeout(timeoutId);

      if (resp.ok) {
        const data = await resp.json();
        this.currentHealth = {
          status: 'online',
          engine: data.engine || 'vbs-ffmpeg-worker',
          version: data.version,
          ffmpegAvailable: data.ffmpegAvailable,
          ffmpegVersion: data.ffmpegVersion,
          platform: data.platform,
          hostname: data.hostname,
          lanIps: data.lanIps || [],
          isProxied: false,
          uptimeSeconds: data.uptimeSeconds,
          lastChecked: Date.now()
        };
        this.notify();
        return this.currentHealth;
      }
    } catch {
      // Direct connection failed (may be mixed-content on mobile HTTPS or private network blocked).
      // Fall through to server proxy check.
    }

    // 2. Try Server Proxy check (crucial for mobile/tablet accessing remote/local worker)
    try {
      const proxyResp = await fetch(`/api/worker/health?url=${encodeURIComponent(url)}`);
      if (proxyResp.ok) {
        const data = await proxyResp.json();
        if (data.status === 'online') {
          this.currentHealth = {
            status: 'online',
            engine: data.engine || 'vbs-ffmpeg-worker',
            version: data.version,
            ffmpegAvailable: data.ffmpegAvailable,
            ffmpegVersion: data.ffmpegVersion,
            platform: data.platform,
            hostname: data.hostname,
            lanIps: data.lanIps || [],
            isProxied: true,
            uptimeSeconds: data.uptimeSeconds,
            lastChecked: Date.now()
          };
          this.notify();
          return this.currentHealth;
        }
      }
    } catch {
      // Proxy also failed
    }

    this.currentHealth = {
      status: 'offline',
      lastChecked: Date.now(),
      error: 'Unreachable'
    };
    this.notify();
    return this.currentHealth;
  }

  private static startHeartbeat(): void {
    this.checkHealthNow();
    this.checkTimer = window.setInterval(() => {
      this.checkHealthNow();
    }, 4000);
  }

  private static notify(): void {
    this.listeners.forEach(fn => fn(this.currentHealth));
  }

  /**
   * Send video processing job to the Local PC / VPS FFmpeg Worker
   * with automatic Server FFmpeg fallback for other devices.
   */
  public static async processVideo(
    formData: FormData,
    onProgress?: (text: string) => void
  ): Promise<{ success: boolean; downloadUrl: string; filename?: string }> {
    const url = this.getWorkerUrl();
    if (onProgress) onProgress('FFmpeg Worker Engine သို့ ချိတ်ဆက်ပေးပို့နေသည်...');

    // 1. Try Direct Worker Post (Works when browser can directly reach worker, e.g. on localhost or same HTTP network)
    const isHttpsOrigin = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const isHttpWorker = url.startsWith('http://');

    // Browsers block HTTPS page -> plain-HTTP requests (mixed content) EXCEPT to loopback
    // (localhost / 127.0.0.1), which they treat as secure. A worker running on this PC
    // therefore works fine straight from the Vercel site.
    const isLoopbackWorker = WorkerEngineService.isLoopbackUrl(url);

    // Only skip direct if it would be blocked (HTTPS page to HTTP LAN IP)
    if (!isHttpsOrigin || !isHttpWorker || isLoopbackWorker) {
      try {
        const response = await fetch(`${url}/process`, {
          method: 'POST',
          body: formData
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.downloadUrl) {
            return data;
          }
        }
      } catch (directErr) {
        console.warn('[VBS Worker] Direct worker post failed (trying Server Proxy):', directErr);
      }
    }

    // 2. Try Server Worker Proxy (Enables phones/tablets/other devices on HTTPS to render via LAN/VPS worker without mixed-content error)
    try {
      if (onProgress) onProgress('Cross-Device Worker Proxy ဖြင့် ချိတ်ဆက် Render လုပ်နေပါသည်...');
      const proxyResp = await fetch(`/api/worker/process?url=${encodeURIComponent(url)}`, {
        method: 'POST',
        body: formData
      });

      if (proxyResp.ok) {
        const data = await proxyResp.json();
        if (data.success && data.downloadUrl) {
          return data;
        }
      }
    } catch (proxyErr) {
      console.warn('[VBS Worker] Server worker proxy failed (falling back to Server Native FFmpeg):', proxyErr);
    }

    // 3. Fallback to Server FFmpeg Engine
    if (onProgress) onProgress('Server Native FFmpeg Engine ဖြင့် Zero-Stutter ဆက်လက် Render လုပ်နေပါသည်...');
    const serverResp = await fetch('/api/video/process', {
      method: 'POST',
      body: formData
    });

    if (!serverResp.ok) {
      if (serverResp.status === 404 || serverResp.status === 405) {
        // Static hosts (e.g. Vercel) have no /api/video/process route, so this means no render engine was reached.
        throw new Error(
          `FFmpeg Worker ကို မချိတ်ဆက်နိုင်ပါ (${url}). PC ပေါ်တွင် vbs-ffmpeg-worker.js ကို run ထားပါ ` +
          `(Worker is not reachable at ${url}; start vbs-ffmpeg-worker.js on your PC. This site has no built-in render server.)`
        );
      }
      const errText = await serverResp.text();
      throw new Error(`Video processing failed (HTTP ${serverResp.status}): ${errText.slice(0, 200)}`);
    }

    const serverData = await serverResp.json();
    if (!serverData.success || !serverData.downloadUrl) {
      throw new Error(serverData.error || 'Server processing returned unknown error');
    }

    return serverData;
  }
}
