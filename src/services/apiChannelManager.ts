
import { db, setDoc, doc, serverTimestamp, increment, getCurrentUserId, collection, onSnapshot, deleteDoc } from '../firebase';

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
  private isSyncInitialized: boolean = false;
  private static currentRotateIndex: number = 0;
  private listeners: (() => void)[] = [];

  constructor() {
    this.loadFromStorage();
    const savedIndex = localStorage.getItem('vbs_admin_key_index');
    if (savedIndex) {
      this.adminActiveIndex = parseInt(savedIndex, 10);
      ApiChannelManager.currentRotateIndex = this.adminActiveIndex;
    }
  }

  // Event System
  subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach(l => l());
  }

  // Real-time Sync with Firestore
  initializeRealtimeSync() {
    if (this.isSyncInitialized) return;
    this.isSyncInitialized = true;

    console.log("[VBS] Initializing Admin Channels Sync...");
    
    // 1. Sync Admin Channels Collection
    // Security: ONLY admins should sync these keys to their browser.
    // Regular users will use the server-side proxy pool without seeing the keys.
    onSnapshot(collection(db, 'admin_channels'), (snapshot) => {
      const channels: ApiChannel[] = snapshot.docs.map(d => ({
        ...d.data() as ApiChannel,
        id: d.id
      }));
      
      console.log(`[VBS] Synced ${channels.length} Admin Channels from Firestore`);
      this.adminChannels = channels.sort((a, b) => a.label.localeCompare(b.label));
      
      if (this.adminActiveIndex >= this.adminChannels.length) {
        this.adminActiveIndex = 0;
      }
      
      this.saveToStorage();
      this.notify();
    }, () => {
      // It is EXPECTED that regular users fail this sync.
      // They will rely on the server-side proxy.
      console.log("[VBS] Admin Channels sync restricted (User is not Admin). Using server-side pool.");
    });

    // 2. Sync Settings (Partial - just the admin pieces if needed, though App.tsx handles globalSettings)
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

  getActiveSourceInfo(isAdminContext: boolean = false, isUserAdmin: boolean = false): { label: string; key: string; isShared: boolean } | null {
    // 1. If we are in an admin-only context (e.g. Admin Dashboard), always use the admin pool
    if (isAdminContext) {
      if (this.adminChannels.length === 0) return null;
      const ch = this.adminChannels[this.adminActiveIndex] || this.adminChannels[0];
      return { label: ch.label, key: ch.key, isShared: false };
    }

    // Determine what key to use for normal operations
    const personalKey = this.userChannel?.key;
    const adminPoolSelected = this.settings.useAdminKeys;
    const canUseAdminPool = this.settings.allowSharedKeys || isUserAdmin; // Admins always have access to their own pool

    // 2. If Admin Pool is selected AND allowed, prioritize it
    if (adminPoolSelected && canUseAdminPool) {
      if (isUserAdmin) {
        // Admin user using their own pool
        if (this.adminChannels.length === 0) return null;
        const ch = this.adminChannels[this.adminActiveIndex] || this.adminChannels[0];
        return { label: ch.label, key: ch.key, isShared: false };
      } else {
        // Regular user using shared pool
        const shared = this.getSharedAdminChannel();
        if (shared) {
          return { label: `ADMIN KEY`, key: shared.key, isShared: true };
        }
      }
    }

    // 3. Otherwise (Personal Key mode selected OR fallback), use Personal Key
    if (personalKey) {
      return { label: 'MY KEY', key: personalKey, isShared: false };
    }

    return null;
  }

  getActiveKey(isAdminContext: boolean = false, isUserAdmin: boolean = false): string | null {
    return this.getActiveSourceInfo(isAdminContext, isUserAdmin)?.key || null;
  }

  private getSharedAdminChannel(): ApiChannel | null {
    // Note: this internal method is for users. Admins skip this and use getAdminChannels logic.
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
    this.notify();
  }

  // Admin Pool
  async addAdminChannel(key: string, label?: string) {
    const id = crypto.randomUUID();
    const ch: ApiChannel = {
      id,
      key: key.trim(),
      status: 'idle',
      label: label || `Admin CH ${this.adminChannels.length + 1}`
    };
    
    try {
      await setDoc(doc(db, 'admin_channels', id), {
        ...ch,
        createdAt: serverTimestamp()
      });
      // We don't push locally, onSnapshot will handle it, but we can notify to refresh UI if needed
      // Actually onSnapshot is quite fast.
      return true;
    } catch (err) {
      console.error("Failed to add admin channel to Firestore:", err);
      return false;
    }
  }

  async deleteAdminChannel(id: string) {
    try {
      await deleteDoc(doc(db, 'admin_channels', id));
      
      // Update local shared list too if it was there
      if (this.settings.sharedChannelIds.includes(id)) {
        this.settings.sharedChannelIds = this.settings.sharedChannelIds.filter(sid => sid !== id);
        this.saveToStorage();
      }
      return true;
    } catch (err) {
      console.error("Failed to delete admin channel from Firestore:", err);
      return false;
    }
  }

  toggleSharedChannel(id: string) {
    const exists = this.settings.sharedChannelIds.includes(id);
    if (exists) {
      this.settings.sharedChannelIds = this.settings.sharedChannelIds.filter(sid => sid !== id);
    } else {
      this.settings.sharedChannelIds.push(id);
    }
    this.saveToStorage();
    this.notify();
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
    this.notify();
  }

  clearUserChannel() {
    this.userChannel = null;
    this.saveToStorage();
    this.notify();
  }

  // --- AUTO-SWITCH LOGIC ---

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private isRateLimit(err: any): boolean {
    return err?.status === 429 ||
      err?.message?.includes("429") ||
      err?.message?.includes("rate limit") ||
      err?.message?.includes("RESOURCE_EXHAUSTED");
  }

  async callWithAutoSwitch<T>(apiFn: (key: string) => Promise<T>, isAdmin: boolean = false, isUserAdmin: boolean = false): Promise<T> {
    const personalKey = this.userChannel?.key;
    const adminKeys = this.adminChannels.map(c => c.key);
    const useAdminMode = this.settings.useAdminKeys;
    const canUseAdminPool = this.settings.allowSharedKeys || isUserAdmin;

    // Logic:
    // A. If Admin Context (Dashboard) -> Always Pool
    // B. If NOT Admin Mode -> Use Personal Key if exists
    // C. If Admin Mode AND Allowed -> Use Pool

    if (!isAdmin && !useAdminMode) {
      if (personalKey) return await apiFn(personalKey);
      
      // Fallback: If no personal key but allowed to use admin pool, use it instead of throwing error
      if (canUseAdminPool) {
        console.log("[VBS API] No personal key found, falling back to Admin Pool...");
      } else {
        if (!isUserAdmin) throw new Error("Personal API Key မရှိသေးပါ။ Key ထည့်ပါ သို့မဟုတ် Admin Pool ပြောင်းပါ။");
      }
    }

    // If we reach here, we are either in Admin Context OR Admin Mode is selected
    if (!isAdmin && useAdminMode && !canUseAdminPool) {
       if (personalKey) return await apiFn(personalKey);
       throw new Error("Admin Pool Sharing ကို Admin မှ ပိတ်ထားပါသည်။ Personal Key ထည့်ပါ။");
    }

    // if user is regular user (no keys synced due to restricted permissions) but chose admin pool -> use SERVER POOL (send empty string to proxy)
    if (!isUserAdmin && useAdminMode && adminKeys.length === 0) {
      console.log("[VBS] Using Server-side Admin Pool (Keys are hidden from browser)");
      return await apiFn(""); // Empty string triggers server-side rotate/fetch
    }

    if (adminKeys.length === 0) {
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

