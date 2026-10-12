import type { VercelRequest, VercelResponse } from '@vercel/node';

// Gemini custom voices (voice replication) + synthesis with a custom voice.
// Uses the caller's Google AI Studio key (falls back to the server key).
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const TTS_MODEL = 'gemini-3.8-flash-tts';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { action, apiKey: provided, sourceAudio, consentAudio, voice, text, style, displayName } = req.body || {};
    const personal = typeof provided === 'string' && provided.trim().length >= 25 && !provided.includes('...');
    const key = personal ? provided.trim() : process.env.GEMINI_API_KEY;
    if (!key) return res.status(400).json({ error: 'No API Key available.' });
    const headers = { 'x-goog-api-key': key, 'Content-Type': 'application/json' };

    if (action === 'create') {
      if (!sourceAudio || !consentAudio) return res.status(400).json({ error: 'sourceAudio and consentAudio are required' });
      const r = await fetch(`${BASE}/voices`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          store: true,
          voice: {
            model: TTS_MODEL,
            type: 'replicated',
            display_name: displayName || 'VBS Custom Voice',
            replicated: {
              source_audio: { mime_type: 'audio/wav', data: sourceAudio },
              consent_audio: { mime_type: 'audio/wav', data: consentAudio },
            },
          },
        }),
      });
      const data = await r.json().catch(() => ({}));
      return res.status(r.status).json(data);
    }

    if (action === 'delete') {
      const id = String(voice || '').replace(/^voices\//, '');
      if (!/^voice_[A-Za-z0-9]+$/.test(id)) return res.status(400).json({ error: 'Bad voice id' });
      const r = await fetch(`${BASE}/voices/${id}`, { method: 'DELETE', headers });
      return res.status(r.status).json(await r.json().catch(() => ({})));
    }

    if (action === 'speak') {
      if (!voice || !text) return res.status(400).json({ error: 'voice and text are required' });
      const content: Record<string, unknown> = { type: 'text', text };
      if (style) content.annotations = [{ type: 'speech_metadata', style }];
      const r = await fetch(`${BASE}/interactions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: TTS_MODEL,
          input: [{ type: 'user_input', content: [content] }],
          response_format: { type: 'audio' },
          generation_config: { speech_config: [{ voice }] },
        }),
      });
      const data = await r.json().catch(() => ({}));
      return res.status(r.status).json(data);
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Internal Server Error' });
  }
}
