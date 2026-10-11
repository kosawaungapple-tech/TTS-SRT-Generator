// Groq (OpenAI-compatible, very fast LLM inference). Used for the text-only parts of Auto Recap
// (outline, script writing, translation-style rewriting). Video "watching" stays on Gemini because
// Groq's chat models here are text-only.
const KEY = 'vbs_groq_api_key';
const MODEL = 'vbs_groq_model';
const ENGINE = 'vbs_recap_engine';

export const GROQ_MODELS = [
  { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (balanced)' },
  { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B (best quality)' },
  { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (fastest, weaker)' },
];

const read = (k: string) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const write = (k: string, v: string) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* ignore */ } };

export const groqService = {
  getKey: () => read(KEY).trim(),
  setKey: (k: string) => write(KEY, k.trim()),
  clearKey: () => write(KEY, ''),
  getModel: () => read(MODEL) || GROQ_MODELS[0].id,
  setModel: (m: string) => write(MODEL, m),
  getEngine: (): 'gemini' | 'groq' => (read(ENGINE) === 'groq' && read(KEY) ? 'groq' : 'gemini'),
  setEngine: (e: 'gemini' | 'groq') => write(ENGINE, e),

  async chat(prompt: string, opts: { json?: boolean; temperature?: number } = {}, retry = 0): Promise<string> {
    const key = this.getKey();
    if (!key) throw new Error('Groq API key is not set');
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: this.getModel(),
        temperature: opts.temperature ?? 0.7,
        messages: [{ role: 'user', content: opts.json ? `${prompt}\n\nReturn valid JSON only.` : prompt }],
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (res.status === 429 && retry < 2) {
      const wait = Math.min(15, Number(res.headers.get('retry-after')) || 4 * (retry + 1));
      await new Promise(r => setTimeout(r, wait * 1000));
      return this.chat(prompt, opts, retry + 1);
    }
    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok) {
      const msg = (data as { error?: { message?: string } })?.error?.message || res.statusText;
      throw new Error(`Groq ${res.status}: ${msg}`);
    }
    const text = (data as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content || '';
    if (!text.trim()) throw new Error('Empty response from Groq');
    return text;
  },
};
