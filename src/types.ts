export interface User {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  role: 'admin' | 'user';
  is_verified?: boolean;
  pending_verification?: boolean;
  createdAt?: any;
  lastSignInAt?: any;
}

export interface AuthorizedUser {
  id: string; // Document ID (Access Code)
  userId?: string; // Explicit User ID as requested
  createdAt: any; // Firestore Timestamp
  isActive: boolean;
  role: 'admin' | 'user';
  note?: string; // Optional name/label
  label?: string; // Alias for note
  api_key_stored?: string;
  password?: string; // User password
  expiryDate?: string; // ISO date string
  createdBy?: string;
}

export interface GlobalSettings {
  global_system_key?: string;
  api_keys?: string[]; // List of rotated API keys
  allow_admin_keys: boolean; // Toggle to allow users to use admin keys
  total_generations: number;
  mock_mode?: boolean;
}

export interface SystemConfig {
  firebase_project_id: string;
  firebase_api_key: string;
  firebase_auth_domain: string;
  firebase_app_id: string;
  telegram_bot_token: string;
  telegram_chat_id: string;
  mock_mode?: boolean;
  updatedAt?: any;
}

export interface HistoryItem {
  id: string;
  userId: string;
  text: string;
  audioStorageUrl?: string;
  srtStorageUrl?: string;
  srtContent?: string;
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
  model: string;
  voiceId: string;
  speed: number;
  pitch: number;
  volume: number;
  styleInstruction?: string;
}

export interface AudioResult {
  audioUrl: string; // Blob URL for local preview
  audioData: string; // base64 for download/upload
  srtContent: string;
  subtitles: SRTSubtitle[];
}
