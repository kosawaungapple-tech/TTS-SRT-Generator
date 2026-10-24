import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";
import { GEMINI_MODELS } from "../constants";

export class GeminiLiveService {
  private ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async connect(onAudioChunk: (base64Data: string) => void, onTranscription?: (text: string) => void) {
    const session = await this.ai.live.connect({
      model: GEMINI_MODELS.LIVE,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: 'Kore' // Default
            }
          }
        },
        outputAudioTranscription: {}
      },
      callbacks: {
        onmessage: async (message: LiveServerMessage) => {
          if (message.serverContent?.modelTurn?.parts) {
            for (const part of message.serverContent.modelTurn.parts) {
              if (part.inlineData) {
                onAudioChunk(part.inlineData.data);
              }
            }
          }
          
          if (message.serverContent?.outputTranscription && onTranscription) {
            onTranscription(message.serverContent.outputTranscription.text);
          }
        },
        onopen: () => console.log('Live API connected'),
        onclose: () => console.log('Live API closed'),
        onerror: (err) => console.error('Live API error:', err)
      }
    });

    return session;
  }
}
