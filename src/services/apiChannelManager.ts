
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
    useAdminKeys: false
  };

  private adminActiveIndex: number = 0;
  private sharedActiveIndex: number = 0;

  constructor() {
    this.loadFromStorage();
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

  getActiveSourceInfo(isAdminContext: boolean = false): { label: string; key: string; isShared: boolean } | null {
    if (isAdminContext) {
      if (this.adminChannels.length === 0) return null;
      const ch = this.adminChannels[this.adminActiveIndex] || this.adminChannels[0];
      return { label: ch.label, key: ch.key, isShared: false };
    }

    if (this.settings.useAdminKeys && this.settings.allowSharedKeys) {
      const shared = this.getSharedAdminChannel();
      if (shared) return { label: `Admin: ${shared.label}`, key: shared.key, isShared: true };
    }

    if (this.userChannel) {
      return { label: 'My Key', key: this.userChannel.key, isShared: false };
    }

    return null;
  }

  getActiveKey(isAdminContext: boolean = false): string | null {
    return this.getActiveSourceInfo(isAdminContext)?.key || null;
  }

  private getSharedAdminChannel(): ApiChannel | null {
    const sharedIds = this.settings.sharedChannelIds;
    if (!this.settings.allowSharedKeys || sharedIds.length === 0) return null;

    const sharedChannels = this.adminChannels.filter(ch => sharedIds.includes(ch.id) && ch.status !== 'limit');
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

  markCurrentAsLimit() {
    const activeInfo = this.getActiveSourceInfo();
    const currentKey = activeInfo?.key;
    if (!currentKey) return { success: false };

    // 1. Check Admin Pool
    const adminIdx = this.adminChannels.findIndex(ch => ch.key === currentKey);
    if (adminIdx !== -1) {
      this.adminChannels[adminIdx].status = 'limit';
      // Advance admin index if it was the active one
      if (adminIdx === this.adminActiveIndex) {
        this.adminActiveIndex = (this.adminActiveIndex + 1) % this.adminChannels.length;
      }
      
      // Advance shared index if it was used
      if (activeInfo?.isShared) {
         // Find in shared list
         const sharedIds = this.settings.sharedChannelIds;
         const sharedChannels = this.adminChannels.filter(ch => sharedIds.includes(ch.id) && ch.status !== 'limit');
         if (sharedChannels.length > 1) {
           this.sharedActiveIndex = (this.sharedActiveIndex + 1) % sharedChannels.length;
         }
      }
    }

    // 2. Check User Pool
    if (this.userChannel?.key === currentKey) {
      this.userChannel.status = 'limit';
    }

    const message = `API Key limit reached for ${activeInfo?.label}. Switching...`;
    window.dispatchEvent(new CustomEvent('channel-switch', { detail: { message } }));

    this.saveToStorage();
    return { success: true };
  }

  async callWithAutoSwitch<T>(apiFn: (key: string) => Promise<T>, isAdmin: boolean = false): Promise<T> {
    const key = this.getActiveKey(isAdmin);
    if (!key) throw new Error("No API key available.");

    try {
      return await apiFn(key);
    } catch (error: unknown) {
      const err = error as { error?: { status?: number }; status?: number };
      const status = err?.error?.status || err?.status;
      if (status === 429 || status === 503) {
        this.markCurrentAsLimit();
        // Retry recursively
        return this.callWithAutoSwitch(apiFn, isAdmin);
      }
      throw error;
    }
  }
}

export const apiChannelManager = new ApiChannelManager();

