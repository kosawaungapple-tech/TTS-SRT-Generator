import { TTSConfig } from "../types";

export class WebSpeechService {
  private static instance: WebSpeechService;
  private synthesis: SpeechSynthesis;
  private activeUtterance: SpeechSynthesisUtterance | null = null;

  private constructor() {
    this.synthesis = window.speechSynthesis;
  }

  public static getInstance(): WebSpeechService {
    if (!WebSpeechService.instance) {
      WebSpeechService.instance = new WebSpeechService();
    }
    return WebSpeechService.instance;
  }

  /**
   * Speaks the provided text using the browser's Synthesis API.
   * Note: This is playback-only and cannot be recorded to a Blob directly.
   */
  public speak(text: string, config: TTSConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      this.stop();

      const utterance = new SpeechSynthesisUtterance(text);
      
      // Try to find a Myanmar voice, fallback to any available
      const voices = this.synthesis.getVoices();
      const myanmarVoice = voices.find(v => v.lang.includes('my') || v.lang.includes('MM'));
      
      if (myanmarVoice) {
        utterance.voice = myanmarVoice;
      }
      
      utterance.lang = 'my-MM';
      utterance.rate = config.speed || 1.0;
      utterance.pitch = config.pitch !== undefined ? (config.pitch + 10) / 10 : 1.0; // Map -10/10 to 0/2
      utterance.volume = config.volume !== undefined ? Math.max(0, Math.min(1, 1 + (config.volume / 20))) : 1.0;

      utterance.onend = () => {
        this.activeUtterance = null;
        resolve();
      };

      utterance.onerror = (event) => {
        this.activeUtterance = null;
        reject(event);
      };

      this.activeUtterance = utterance;
      this.synthesis.speak(utterance);
    });
  }

  public stop(): void {
    if (this.synthesis.speaking) {
      this.synthesis.cancel();
    }
    this.activeUtterance = null;
  }

  public isSpeaking(): boolean {
    return this.synthesis.speaking;
  }

  public getVoices(): SpeechSynthesisVoice[] {
    return this.synthesis.getVoices();
  }
}

export const webSpeechService = WebSpeechService.getInstance();
