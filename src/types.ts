export interface VBSUserControl {
  vbsId: string;
  dailyUsage: number;
  lastUsedDate: string;
  isUnlimited: boolean;
  isBlocked: boolean;
  membershipStatus?: 'standard' | 'premium';
  customLimit?: number;
  expiryDate?: string; // ISO date string or YYYY-MM-DD
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updatedAt: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lastLoginAt?: any;
  dailyTasks?: number;
  role?: 'admin' | 'user';
  isActive?: boolean;
  note?: string;
  password?: string;
  api_key_stored?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createdAt?: any;
}

export interface Announcement {
  id: string;
  message: string;
  type: 'info' | 'warning' | 'success' | 'promotion';
  isActive: boolean;
  startDate?: string;
  endDate?: string;
  createdAt: string;
  dismissible: boolean;
  title?: string;
  ctaLabel?: string;
  ctaLink?: string;
  scrollSpeed?: 'slow' | 'normal' | 'fast';
}

export interface GlobalSettings {
  global_system_key?: string;
  api_keys?: string[]; // List of rotated API keys
  primary_key?: string;
  secondary_key?: string;
  backup_key?: string;
  allow_admin_keys: boolean; // Toggle to allow users to use admin keys
  allow_video_recap_admin_key?: boolean; // New gate for video recap
  allow_thumbnail_admin_key?: boolean; // New gate for thumbnail
  total_generations: number;
  mock_mode?: boolean;
  transcription_daily_limit?: number;
  transcription_public_access?: boolean;
  announcements?: Announcement[];
}

export interface SystemConfig {
  firebase_project_id: string;
  firebase_api_key: string;
  firebase_auth_domain: string;
  firebase_app_id: string;
  telegram_bot_token: string;
  telegram_chat_id: string;
  mock_mode?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  baseDuration: number;
  oneXDuration: number;
  duration?: number;
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
  styleInstruction?: string;
  vocalStyle?: 'Neutral' | 'Expressive' | 'Energetic' | 'Calm';
  creativityLevel?: number; // 0.2 to 0.8
  useGrounding?: boolean;
  highFidelity?: boolean;
  fastTrack?: boolean;
  effects?: Record<string, boolean | number | string>;
}

export interface AudioResult {
  audioUrl: string; // Blob URL for local preview
  audioData: string; // base64 for download/upload
  rawAudio?: ArrayBuffer; // Raw binary data to avoid base64 corruption
  srtContent: string;
  subtitles: SRTSubtitle[];
  baseDuration: number; // Actual duration of the generated audio file (already speed-adjusted)
  oneXDuration: number; // Normalized duration at 1.0x speed for estimation
  speed: number; // Speed at which it was generated
  duration: number; // Duration in seconds
}

export interface ActivityLog {
  id?: string;
  vbsId: string;
  type: 'login' | 'tts' | 'transcription' | 'translation' | 'recap';
  details: string;
  createdAt: string; // ISO string
}
