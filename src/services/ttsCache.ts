
import { AudioResult } from "../types";

/**
 * Simple IndexedDB wrapper for caching TTS audio results.
 * Helps reduce API calls and costs for identical text.
 */
export class TTSCache {
  private dbName = 'vbs_tts_cache';
  private storeName = 'audio_results';
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  private generateKey(text: string, voiceId: string, styleInstruction: string = ''): string {
    // Basic hash-like key
    return `${voiceId}_${styleInstruction}_${text.substring(0, 100)}_${text.length}`;
  }

  async get(text: string, voiceId: string, styleInstruction: string = ''): Promise<AudioResult | null> {
    await this.init();
    if (!this.db) return null;
    const key = this.generateKey(text, voiceId, styleInstruction);
    return new Promise((resolve) => {
      const transaction = this.db!.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  }

  async set(text: string, voiceId: string, styleInstruction: string = '', result: AudioResult): Promise<void> {
    await this.init();
    if (!this.db) return;
    const key = this.generateKey(text, voiceId, styleInstruction);
    return new Promise((resolve) => {
      const transaction = this.db!.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      store.put(result, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
    });
  }

  async clear(): Promise<void> {
    await this.init();
    if (!this.db) return;
    return new Promise((resolve) => {
      const transaction = this.db!.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      store.clear();
      transaction.oncomplete = () => resolve();
    });
  }
}

export const ttsCache = new TTSCache();
