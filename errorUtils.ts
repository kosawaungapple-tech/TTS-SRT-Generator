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
  credits?: number;
  videosGeneratedToday?: number;
  dailyVideoLimit?: number;
  lastVideoDate?: string;
  admin_override_active?: boolean;
  api_key_stored?: string;
  allowAdminKey?: boolean;
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
  elevenlabs_key_1?: string;
  elevenlabs_key_2?: string;
  elevenlabs_key_3?: string;
  elevenlabs_key_4?: string;
  elevenlabs_key_5?: string;
  allow_elevenlabs?: boolean;
  allow_admin_keys: boolean; // Toggle to allow users to use admin keys
  sharedChannelIds?: string[]; // IDs of admin keys allowed in shared pool
  allow_video_recap_admin_key?: boolean; // New gate for video recap
  allow_thumbnail_admin_key?: boolean; // New gate for thumbnail
  total_generations: number;
  mock_mode?: boolean;
  transcription_daily_limit?: number;
  transcription_public_access?: boolean;
  welcome_credits?: number;
  recap_cost?: number;
  tts_cost?: number;
  rewrite_cost?: number;
  announcements?: Announcement[];
}

export interface CreditSettings {
  videoRecapCost: number;
  ttsGenerationCost: number;
  aiRewriteCost: number;
  newPremiumWelcomeCredits: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updatedAt?: any;
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
  ttsProvider?: 'gemini' | 'elevenlabs';
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
  isLoadingPartial?: boolean; // Flag to indicate more chunks are coming
}

export interface ActivityLog {
  id?: string;
  vbsId: string;
  type: 'login' | 'tts' | 'transcription' | 'translation' | 'recap';
  details: string;
  createdAt: string; // ISO string
}
