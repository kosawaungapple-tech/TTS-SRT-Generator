export interface AppUser {
  id: string; // Access ID (e.g., VIP-0001)
  name: string;
  createdAt: string;
  expiryDate: string;
  isActive: boolean;
  api_key_stored?: string;
}

export interface Config {
  gemini_api_key?: string;
  rapidapi_key?: string;
  openai_api_key?: string;
  isSystemLive: boolean;
  allow_global_key: boolean;
  total_generations?: number;
  updatedAt?: string;
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
  srtContent: string;
  subtitles: SRTSubtitle[];
}
