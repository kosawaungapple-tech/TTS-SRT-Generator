export interface AppUser {
  id: string; // Access ID (e.g., VIP-0001)
  name: string;
  password?: string; // Hashed password
  access_password?: string; // Plain text password for admin to reveal
  failedAttempts?: number;
  lastFailedAttempt?: string; // ISO string
  createdAt: string;
  expiryDate: string;
  isActive: boolean;
  api_key_stored?: string;
}

export interface ApiKey {
  id: string;
  key: string;
  usageCount: number;
  status: 'active' | 'idle' | 'full';
  label?: string;
}

export interface Config {
  gemini_api_key?: string; // Legacy
  gemini_api_keys?: ApiKey[];
  openai_api_key?: string; // Legacy
  openai_api_keys?: ApiKey[];
  isSystemLive: boolean;
  allow_global_key: boolean;
  total_generations?: number;
  updatedAt?: string;
  active_gemini_key_index?: number;
  active_openai_key_index?: number;
  key_logs?: { message: string; timestamp: string }[];
  telegram_bot_token?: string;
  telegram_chat_id?: string;
}

export interface HistoryItem {
  id: string;
  userId: string;
  text: string;
  audioStorageUrl?: string;
  srtStorageUrl?: string;
  srtContent?: string; // Cache the SRT content
  createdAt: string;
  config: TTSConfig;
}

export interface VoiceOption {
  id: string;
  name: string;
  gender: 'male' | 'female';
  voiceName: string;
}

export interface PronunciationRule {
  id: string;
  original: string;
  replacement: string;
}

export interface SRTSubtitle {
  index: number;
  startTime: string;
  endTime: string;
  text: string;
}

export interface TTSConfig {
  voiceId: string;
  speed: number;
  pitch: number;
  volume: number;
}

export interface AudioResult {
  audioUrl: string; // Blob URL for local preview
  audioData: string; // base64 for download/upload
  wavBlob?: Blob; // Actual WAV blob
  srtContent: string;
  subtitles: SRTSubtitle[];
}
