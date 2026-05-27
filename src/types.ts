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
  createdAt: any; // Firestore Timestamp
  isActive: boolean;
  role: 'admin' | 'user';
  note?: string; // Optional name/label
  label?: string; // Alias for note
  api_key_stored?: string;
  createdBy?: string;
}

export interface GlobalSettings {
  global_system_key?: string;
  allow_global_key: boolean;
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

export interface AudioEffects {
  echo: {
    enabled: boolean;
    delay: number; // in seconds
    feedback: number; // 0 to 1
  };
  reverb: {
    enabled: boolean;
    decay: number; // in seconds
    mix: number; // 0 to 1
  };
  pitchShift: {
    enabled: boolean;
    semitones: number; // -12 to 12
  };
  chorus: {
    enabled: boolean;
    rate: number; // in Hz
    depth: number; // 0 to 1
  };
}

export interface TTSConfig {
  voiceId: string;
  speed: number;
  pitch: number;
  volume: number;
  effects?: AudioEffects;
}

export interface AudioResult {
  audioUrl: string; // Blob URL for local preview
  audioData: string; // base64 for download/upload
  srtContent: string;
  subtitles: SRTSubtitle[];
}
