
import { db, setDoc, doc, serverTimestamp, increment, getCurrentUserId } from '../firebase';

/**
 * API Key Channel Manager - Redesigned for Admin/User Roles
 * Handles separate pools for Admin (Multi-channel) and User (Single-channel + Shared access).
 */

export type ChannelStatus = 'active' | 'idle' | 'limit';

export interface ApiChannel {
  id: string;
  key: string;
  status: ChannelStatus;
  label: string;
}

interface ChannelSettings {
  allowSharedKeys: boolean;      // Admin Master Toggle
  sharedChannelIds: string[];    // Which Admin IDs are shared
  useAdminKeys: boolean;         // User Preference Toggle
}

class ApiChannelManager {
  private adminChannels: ApiChannel[] = [];
  private userChannel: ApiChannel | null = null;
  private settings: ChannelSettings = {
    allowSharedKeys: false,
    sharedChannelIds: [],
    useAdminKeys: true
  };

  private adminActiveIndex: number = 0;
  private sharedActiveIndex: number = 0;
  private static currentRotateIndex: number = 0;

  constructor() {
    this.loadFromStorage();
    const savedIndex = localStorage.getItem('vbs_admin_key_index');
    if (savedIndex) {
      this.adminActiveIndex = parseInt(savedIndex, 10);
      ApiChannelManager.currentRotateIndex = this.adminActiveIndex;
    }
  }

  async logKeyUsage(id: string, status: 'success' | 'rate_limited' | 'error') {
    // Guard: Never write with anonymous or null user
    const userId = getCurrentUserId();
    if (!userId) {
      console.warn('[VBS] Skipping key usage log — user not authenticated or anonymous');
      return;
    }

    try {
      const statsRef = doc(db, 'adminKeyStats', id);
      const isRateLimited = status === 'rate_limited';
      
      await setDoc(statsRef, {
        totalRequests: increment(1),
        rateLimitCount: isRateLimited ? increment(1) : increment(0),
        lastUsed: serverTimestamp(),
        lastStatus: status,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      console.error("Failed to log key usage:", err);
    }
  }

  async resetKeyStats(id: string) {
    // Guard: Never write with anonymous or null user
    const userId = getCurrentUserId();
    if (!userId) {
      console.warn('[VBS] Skipping key stats reset — user not authenticated or anonymous');
      return false;
    }

    try {
      await setDoc(doc(db, 'adminKeyStats', id), {
        totalRequests: 0,
        rateLimitCount: 0,
        updatedAt: serverTimestamp()
      }, { merge: true });
      return true;
    } catch (err) {
      console.error("Failed to reset stats:", err);
      return false;
    }
  }

  private loadFromStorage() {
    try {
      // 1. Load Admin Channels
      const adminSaved = localStorage.getItem('adminChannels');
      if (adminSaved) {
        this.adminChannels = JSON.parse(adminSaved).map((ch: ApiChannel) => ({
          ...ch,
          status: ch.status === 'limit' ? 'idle' : ch.status
        }));
      }

      // 2. Load User Channel
      const userSaved = localStorage.getItem('userChannel');
      if (userSaved) {
        const parsedUser = JSON.parse(userSaved);
        this.userChannel = parsedUser ? {
          ...parsedUser,
          status: parsedUser.status === 'limit' ? 'idle' : parsedUser.status
        } : null;
      }

      // 3. Load Settings
      const settingsSaved = localStorage.getItem('vbs_channel_settings');
      if (settingsSaved) {
        this.settings = { ...this.settings, ...JSON.parse(settingsSaved) };
      }
      
      // Specifically check for useAdminKeyPool if requested separately
      const specificShared = localStorage.getItem('useAdminKeyPool');
      if (specificShared !== null) {
        this.settings.useAdminKeys = JSON.parse(specificShared);
      }

      // 4. Legacy Migration (if needed)
      if (this.adminChannels.length === 0 && !this.userChannel) {
        const legacyKey = localStorage.getItem('VLOGS_BY_SAW_API_KEY');
        if (legacyKey) {
          this.userChannel = {
            id: crypto.randomUUID(),
            key: legacyKey,
            status: 'active',
            label: 'Personal Key'
          };
          this.saveToStorage();
        }
      }
    } catch (e) {
      console.error("Failed to load channel data", e);
    }
  }

  private saveToStorage() {
    localStorage.setItem('adminChannels', JSON.stringify(this.adminChannels));
    localStorage.setItem('userChannel', JSON.stringify(this.userChannel));
    localStorage.setItem('vbs_channel_settings', JSON.stringify(this.settings));
    localStorage.setItem('vbs_admin_key_index', this.adminActiveIndex.toString());
    
    // Sync with legacy key for other services
    const activeKey = this.getActiveKey();
    if (activeKey) {
      localStorage.setItem('VLOGS_BY_SAW_API_KEY', activeKey);
    } else {
      localStorage.removeItem('VLOGS_BY_SAW_API_KEY');
    }
    
    window.dispatchEvent(new Event('storage'));
  }

  // --- GETTERS ---

  getAdminChannels() { return [...this.adminChannels]; }
  getUserChannel() { return this.userChannel; }
  getSettings() { return { ...this.settings }; }
  getAdminActiveIndex() { return this.adminActiveIndex; }

  // Sync Admin Keys from Firestore
  syncAdminKeys(keys: string[]) {
    const validKeys = keys.filter(k => k && k.trim());
    if (validKeys.length === 0) return;

    // Only update if keys have changed to avoid resetting status
    const currentKeys = this.adminChannels.map(c => c.key);
    if (JSON.stringify(currentKeys) === JSON.stringify(validKeys)) return;

    this.adminChannels = validKeys.map(key => ({
      id: crypto.randomUUID(),
      key: key.trim(),
      status: 'idle',
      label: `Admin Key`
    }));
    
    if (this.adminActiveIndex >= this.adminChannels.length) {
      this.adminActiveIndex = 0;
    }
    this.saveToStorage();
  }

  getActiveSourceInfo(isAdminContext: boolean = false): { label: string; key: string; isShared: boolean } | null {
    if (isAdminContext) {
      if (this.adminChannels.length === 0) return null;
      const ch = this.adminChannels[this.adminActiveIndex] || this.adminChannels[0];
      return { label: ch.label, key: ch.key, isShared: false };
    }

    // Determine what key to use for normal operations
    const personalKey = this.userChannel?.key;
    const canUseAdmin = this.settings.useAdminKeys && this.settings.allowSharedKeys;

    if (personalKey) {
      // We always prefer personal key if it exists, UNLESS it's explicitly marked as limit
      // But getActiveSourceInfo doesn't track live rate limits easily without state. 
      // For UI purposes, we show what will be tried first.
      return { label: 'My Key', key: personalKey, isShared: false };
    }

    if (canUseAdmin) {
      const shared = this.getSharedAdminChannel();
      if (shared) return { label: `Admin: ${shared.label}`, key: shared.key, isShared: true };
    }

    return null;
  }

  getActiveKey(isAdminContext: boolean = false): string | null {
    return this.getActiveSourceInfo(isAdminContext)?.key || null;
  }

  private getSharedAdminChannel(): ApiChannel | null {
    if (!this.settings.allowSharedKeys) return null;
    
    const sharedIds = this.settings.sharedChannelIds;
    // If specific shared IDs are provided, filter those. 
    // If NO specific IDs are provided but sharing is enabled, allow ANY active admin key as fallback.
    const sharedChannels = this.adminChannels.filter(ch => {
      const isWhitelisted = sharedIds.length === 0 || sharedIds.includes(ch.id);
      return isWhitelisted && ch.status !== 'limit';
    });

    if (sharedChannels.length === 0) return null;

    if (this.sharedActiveIndex >= sharedChannels.length) this.sharedActiveIndex = 0;
    return sharedChannels[this.sharedActiveIndex];
  }

  // --- SETTERS ---

  updateSettings(newSettings: Partial<ChannelSettings>) {
    this.settings = { ...this.settings, ...newSettings };
    this.saveToStorage();
  }

  // Admin Pool
  addAdminChannel(key: string, label?: string) {
    const ch: ApiChannel = {
      id: crypto.randomUUID(),
      key: key.trim(),
      status: 'idle',
      label: label || `Admin CH ${this.adminChannels.length + 1}`
    };
    this.adminChannels.push(ch);
    this.saveToStorage();
  }

  deleteAdminChannel(id: string) {
    this.adminChannels = this.adminChannels.filter(ch => ch.id !== id);
    this.settings.sharedChannelIds = this.settings.sharedChannelIds.filter(sid => sid !== id);
    this.saveToStorage();
  }

  toggleSharedChannel(id: string) {
    const exists = this.settings.sharedChannelIds.includes(id);
    if (exists) {
      this.settings.sharedChannelIds = this.settings.sharedChannelIds.filter(sid => sid !== id);
    } else {
      this.settings.sharedChannelIds.push(id);
    }
    this.saveToStorage();
  }

  // User Pool
  setUserChannel(key: string) {
    this.userChannel = {
      id: crypto.randomUUID(),
      key: key.trim(),
      status: 'active',
      label: 'Personal Key'
    };
    this.saveToStorage();
  }

  clearUserChannel() {
    this.userChannel = null;
    this.saveToStorage();
  }

  // --- AUTO-SWITCH LOGIC ---

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private isRateLimit(err: any): boolean {
    return err?.status === 429 ||
      err?.message?.includes("429") ||
      err?.message?.includes("rate limit") ||
      err?.message?.includes("RESOURCE_EXHAUSTED");
  }

  async callWithAutoSwitch<T>(apiFn: (key: string) => Promise<T>, isAdmin: boolean = false): Promise<T> {
    const personalKey = this.userChannel?.key;
    const adminKeys = this.adminChannels.map(c => c.key);
    const useAdminMode = this.settings.useAdminKeys;
    const canUseAdminPool = this.settings.allowSharedKeys;

    // 1. Personal Mode Logic
    if (!isAdmin && !useAdminMode) {
      if (personalKey) {
        return await apiFn(personalKey);
      }
      throw new Error("Personal API Key မရှိသေးပါ။ Key ထည့်ပါ သို့မဟုတ် Admin Pool ပြောင်းပါ။");
    }

    // 2. Admin Pool Mode Logic
    // If not in admin context but mode is admin, check if sharing is allowed
    if (!isAdmin && useAdminMode && !canUseAdminPool) {
      if (personalKey) return await apiFn(personalKey);
      throw new Error("Admin Pool Sharing ကို Admin မှ ပိတ်ထားပါသည်။ Personal Key ထည့်ပါ။");
    }

    if (adminKeys.length === 0) {
      // Fallback: If no admin keys managed yet, try environment variable (only for real admins or when absolutely needed)
      if (typeof process !== 'undefined' && process.env.GEMINI_API_KEY) {
        return await apiFn(process.env.GEMINI_API_KEY);
      }
      throw new Error("Admin API Keys မရှိသေးပါ။ Admin ထံ ဆက်သွယ်ပါ။");
    }

    const startIndex = this.adminActiveIndex;
    let attempts = 0;

    while (attempts < this.adminChannels.length) {
      const keyIndex = (startIndex + attempts) % this.adminChannels.length;
      const channel = this.adminChannels[keyIndex];

      try {
        console.log("[VBS API] Using Admin Key:", channel.label);
        const result = await apiFn(channel.key);
        this.adminActiveIndex = keyIndex; // Remember working key
        this.saveToStorage();
        
        // Log usage
        this.logKeyUsage(channel.id, 'success');
        
        return result;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        if (this.isRateLimit(err)) {
          console.log("[VBS API] Key", channel.label, "rate limited, rotating...");
          this.logKeyUsage(channel.id, 'rate_limited');
          attempts++;
          continue;
        }
        this.logKeyUsage(channel.id, 'error');
        throw err; // Non-rate-limit error → rethrow immediately
      }
    }

    throw new Error("API Keys အားလုံး Rate Limit ကျနေသည်။ ခဏစောင့်ပါ။");
  }
}

export const apiChannelManager = new ApiChannelManager();

