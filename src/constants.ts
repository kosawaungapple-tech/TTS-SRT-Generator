import { VoiceOption } from './types';

export const VOICE_OPTIONS: VoiceOption[] = [
  { id: 'puck', name: 'Myanmar Male (အမျိုးသား) - Puck', gender: 'male', voiceName: 'Puck' },
  { id: 'charon', name: 'Myanmar Male (အမျိုးသား) - Charon', gender: 'male', voiceName: 'Charon' },
  { id: 'kore', name: 'Myanmar Male (အမျိုးသား) - Kore', gender: 'male', voiceName: 'Kore' },
  { id: 'fenrir', name: 'Myanmar Male (အမျိုးသား) - Fenrir', gender: 'male', voiceName: 'Fenrir' },
  { id: 'aoede', name: 'Myanmar Female (အမျိုးသမီး) - Aoede', gender: 'female', voiceName: 'Aoede' },
  { id: 'orbit', name: 'Myanmar Female (အမျိုးသမီး) - Orbit', gender: 'female', voiceName: 'Orbit' },
  { id: 'zephyr', name: 'Myanmar Female (အမျိုးသမီး) - Zephyr', gender: 'female', voiceName: 'Zephyr' },
  { id: 'leda', name: 'Myanmar Female (အမျိုးသမီး) - Leda', gender: 'female', voiceName: 'Leda' },
];

// Supported voices are listed in VOICE_OPTIONS
export const SUPPORTED_VOICES = VOICE_OPTIONS.map(v => v.id);

export const DEFAULT_RULES = [
  { id: '1', original: 'Vlogs By Saw', replacement: 'ဗလော့ ဘိုင် စော' },
  { id: '2', original: 'AI', replacement: 'အေအိုင်' },
  { id: '3', original: 'မေတ္တာ', replacement: 'မစ်တာ' },
  { id: '4', original: 'သစ္စာ', replacement: 'သစ်စာ' },
  { id: '5', original: 'ပြဿနာ', replacement: 'ပရတ်သနာ' },
  { id: '6', original: 'ဥက္က', replacement: 'အုတ်က' },
  { id: '7', original: 'ဦးနှောက်', replacement: 'အုန်းနှောက်' },
  { id: '8', original: 'တက္ကသိုလ်', replacement: 'တက်ကသိုလ်' },
];

export const GEMINI_MODELS = {
  VERIFY: 'gemini-2.5-flash',
  REWRITE: 'gemini-2.5-flash',
  TRANSLATE: 'gemini-2.5-flash',
  IMAGE: 'gemini-2.0-flash-preview-image-generation',
  TTS: 'gemini-2.5-flash-preview-tts',
  VIDEO: 'gemini-2.5-flash'
};
