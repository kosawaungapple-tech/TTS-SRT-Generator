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

    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 2500);

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
          uptimeSeconds: data.uptimeSeconds,
          lastChecked: Date.now()
        };
      } else {
        this.currentHealth = {
          status: 'offline',
          lastChecked: Date.now(),
          error: `HTTP ${resp.status}`
        };
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unreachable';
      this.currentHealth = {
        status: 'offline',
        lastChecked: Date.now(),
        error: errMsg
      };
    }

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
   */
  public static async processVideo(
    formData: FormData,
    onProgress?: (text: string) => void
  ): Promise<{ success: boolean; downloadUrl: string; filename?: string }> {
    const url = this.getWorkerUrl();
    if (onProgress) onProgress('Local PC FFmpeg Engine သို့ ဒေတာပေးပို့နေသည်...');

    const response = await fetch(`${url}/process`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Local PC Worker failed (HTTP ${response.status}): ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    if (!data.success || !data.downloadUrl) {
      throw new Error(data.error || 'Local PC Worker returned unknown error');
    }

    return data;
  }
}
