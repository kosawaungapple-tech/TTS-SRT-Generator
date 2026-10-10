/**
 * Story-grounded recap script pipeline.
 *
 *  1. Story bible  – extract characters + ordered events from the source (chunked + merged)
 *  2. Outline      – group the numbered events into narrative sections (hook → climax → ending)
 *  3. Writing      – write each section from ONLY its events; every paragraph must cite event numbers
 *  4. Editor pass  – smooth transitions / repetition without adding facts (length-validated)
 *
 * The LLM is injected so the flow can be unit-tested without network access.
 */

export interface LlmCallOptions {
  json?: boolean;
  /** base64 JPEG frames (no data: prefix) */
  images?: string[];
}
export type RecapLlm = (prompt: string, opts?: LlmCallOptions) => Promise<string>;

export type RecapStage =
  | { stage: 'watch'; done: number; total: number }
  | { stage: 'bible'; done: number; total: number }
  | { stage: 'outline' }
  | { stage: 'write'; done: number; total: number }
  | { stage: 'edit' }
  | { stage: 'quick' };

export interface RecapScriptOptions {
  style?: string;
  tone?: string;
  language?: 'mm' | 'en';
  /** Desired narration length in minutes */
  targetMinutes?: number;
  /** Duration of the source video in seconds, if known (caps the narration) */
  sourceSeconds?: number;
  /** 'quick' = one call, no grounding stages (used for background auto-generation) */
  mode?: 'full' | 'quick';
  frames?: string[];
  /** Timed dialogue/subtitles of the source video (enables the per-window "watch" step) */
  cues?: { start: number; end: number; text: string }[];
  /** Returns base64 JPEG frames for a time window of the source video. Enables the "watch" step. */
  getFrames?: (startSec: number, endSec: number) => Promise<string[]>;
  /** How much of the source the recap should cover: short highlights .4, medium .7, full 1 */
  coverage?: number;
  onStage?: (s: RecapStage) => void;
}

interface Bible {
  setting: string;
  characters: { name: string; who: string }[];
  events: string[];
}
interface Section { title: string; events: number[] }

const CHARS_PER_MIN = { mm: 520, en: 800 };

export function computeTargetChars(
  language: 'mm' | 'en',
  targetMinutes: number,
  sourceSeconds?: number,
  eventCount?: number,
  coverage?: number
): number {
  // When the source video length is known the narration is paced to what is on screen:
  // coverage 1 = tell the whole video at speaking pace, lower = highlights only.
  if (sourceSeconds && sourceSeconds > 0 && coverage) {
    const chars = Math.round((sourceSeconds / 60) * CHARS_PER_MIN[language] * coverage);
    return Math.max(200, chars);
  }
  const minutes = Math.max(0.5, targetMinutes);
  let chars = Math.round(minutes * CHARS_PER_MIN[language]);
  // Never pad: a handful of facts cannot honestly fill a long script.
  if (eventCount && eventCount > 0) chars = Math.min(chars, Math.max(300, eventCount * 380));
  return chars;
}

/** Narration time estimate that works for Burmese (no spaces) as well as English. */
export function estimateNarrationSeconds(text: string, language: 'mm' | 'en' = 'mm'): number {
  const t = text.trim();
  if (!t) return 0;
  if (language === 'en' || /^[\x00-\x7F\s]+$/.test(t)) {
    const words = t.split(/\s+/).filter(Boolean).length;
    return Math.round((words / 150) * 60);
  }
  return Math.round((t.replace(/\s+/g, '').length / CHARS_PER_MIN.mm) * 60);
}

export function extractJson<T>(raw: string): T {
  let s = (raw || '').trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(s) as T; } catch { /* fall through */ }
  const a = s.search(/[\[{]/);
  const closer = a >= 0 && s[a] === '[' ? ']' : '}';
  const b = s.lastIndexOf(closer);
  if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1)) as T;
  throw new Error('Model did not return valid JSON');
}

function chunkSource(text: string, max = 6000): string[] {
  const lines = text.split('\n');
  const out: string[] = [];
  let cur = '';
  for (const ln of lines) {
    if (cur.length + ln.length + 1 > max && cur) { out.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + ln;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function voiceRules(language: 'mm' | 'en', style: string, tone: string): string {
  if (language === 'en') {
    return `VOICE: ${style}. Tone: ${tone}. Spoken, punchy, present tense, short sentences. No headings, timestamps, emojis, stage directions or markdown. Never invent names, events or endings.`;
  }
  return `အသံ/စတိုင်: ${style}။ လေသံ: ${tone}။
- မြန်မာ ရီကပ်ဇာတ်ကားပြောသူ၏ သဘာဝစကားပြော (…တယ်၊ …ပါတယ်၊ …လိုက်တော့၊ …ပေမယ့်) ကို သုံးပါ။ စာအုပ်စာပေဟန် (၏၊ ၌၊ သည်) မသုံးပါနှင့်။
- စာကြောင်းတိုတို၊ ပုံရိပ်ပေါ်စေသော ကြိယာများဖြင့် ရေးပါ။ တစ်ကြောင်းတည်းတွင် အကြောင်းအရာ တစ်ခုသာ ထားပါ။
- အလွတ်အချော့ စကားလုံးများ ("အလွန်စိတ်ဝင်စားဖွယ်", "ထူးဆန်းသော ဇာတ်လမ်း" စသည့် ယေဘုယျချီးမွမ်းစကား) နှင့် ထပ်ခါထပ်ခါ ပြောခြင်း မလုပ်ပါနှင့်။ ဖြစ်ရပ်၊ လုပ်ရပ်၊ အကြောင်းအကျိုး ကိုသာ ပြောပါ။
- Timestamp၊ ခေါင်းစဉ်၊ [Scene]၊ (Sound effect)၊ emoji၊ markdown မထည့်ပါနှင့်။
- မူရင်းတွင် မပါသော ဇာတ်ကောင်၊ အမည်၊ ဖြစ်ရပ်၊ ဇာတ်သိမ်း မဖန်တီးပါနှင့်။`;
}

function bibleText(b: Bible): string {
  const chars = b.characters.map(c => `- ${c.name}: ${c.who}`).join('\n') || '- (unknown)';
  const ev = b.events.map((e, i) => `E${i + 1}. ${e}`).join('\n');
  return `SETTING: ${b.setting || '(unknown)'}\nCHARACTERS:\n${chars}\nEVENTS (chronological):\n${ev}`;
}

const fmtT = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** "Watch" the video window by window: frames + the dialogue spoken in that window -> timed events. */
async function watchVideo(
  llm: RecapLlm,
  opts: RecapScriptOptions,
  language: 'mm' | 'en'
): Promise<Bible> {
  const dur = opts.sourceSeconds as number;
  const count = Math.max(1, Math.min(20, Math.ceil(dur / 30)));
  const len = dur / count;
  const bible: Bible = { setting: '', characters: [], events: [] };
  const seen = new Set<string>();
  const perWindow: { t: number; text: string }[][] = new Array(count).fill(null).map(() => []);
  const chars: { name: string; who: string }[][] = new Array(count).fill(null).map(() => []);
  const settings: string[] = new Array(count).fill('');
  let done = 0;
  opts.onStage?.({ stage: 'watch', done: 0, total: count });

  const runWindow = async (i: number) => {
    const a = i * len;
    const b = (i + 1) * len;
    const frames = (await opts.getFrames!(a, b).catch(() => [])).slice(0, 5);
    const dialogue = (opts.cues || [])
      .filter(c => c.start < b && c.end > a)
      .map(c => `[${fmtT(c.start)}] ${c.text.trim().replace(/\s+/g, ' ')}`)
      .join('\n');
    const prompt = `You are a film editor WATCHING a video before writing its recap. This is the part from ${fmtT(a)} to ${fmtT(b)} (${frames.length} frames attached in time order).
Describe what really happens: who is on screen and what they do, where, what changes, and what is said (dialogue below). Use only what the frames and dialogue show; if something is unclear say so instead of guessing.
Return JSON: {"setting":"place/time/kind of story if visible","characters":[{"name":"name as spoken/shown, or a short visual description like 'the man in the red jacket'","who":"role, short"}],"events":[{"t":<seconds from video start>,"text":"one concrete sentence: who does what, and the visible cause/result"}]}
3-6 events, chronological. Write values in ${language === 'mm' ? 'Burmese' : 'English'}.

DIALOGUE IN THIS PART:
${dialogue || '(none)'}`;
    const raw = await llm(prompt, { json: true, images: frames });
    const part = extractJson<{ setting?: string; characters?: { name: string; who?: string }[]; events?: { t?: number; text?: string }[] }>(raw);
    settings[i] = String(part.setting || '');
    chars[i] = (part.characters || []).map(c => ({ name: String(c.name), who: String(c.who || '') }));
    perWindow[i] = (part.events || [])
      .map(e => ({ t: Number.isFinite(Number(e.t)) ? Math.min(b, Math.max(a, Number(e.t))) : a, text: String(e.text || '').trim() }))
      .filter(e => e.text);
    // never end up with an empty window: fall back to the spoken lines
    if (!perWindow[i].length && dialogue) perWindow[i] = [{ t: a, text: dialogue.split('\n').slice(0, 3).join(' ') }];
    done++;
    opts.onStage?.({ stage: 'watch', done, total: count });
  };

  const queue = Array.from({ length: count }, (_, i) => i);
  const worker = async () => {
    while (queue.length) {
      const i = queue.shift()!;
      try { await runWindow(i); } catch (e) { if (done === 0 && queue.length === count - 1) throw e; done++; opts.onStage?.({ stage: 'watch', done, total: count }); }
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  for (let i = 0; i < count; i++) {
    if (!bible.setting && settings[i]) bible.setting = settings[i];
    for (const c of chars[i]) {
      const key = c.name.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      bible.characters.push(c);
    }
    for (const e of perWindow[i].sort((x, y) => x.t - y.t)) bible.events.push(`[${fmtT(e.t)}] ${e.text}`);
  }
  if (bible.events.length === 0) throw new Error('Could not understand the video content');
  return bible;
}

async function buildBible(
  llm: RecapLlm,
  source: string,
  language: 'mm' | 'en',
  frames: string[] | undefined,
  onStage?: (s: RecapStage) => void
): Promise<Bible> {
  const chunks = chunkSource(source);
  const bible: Bible = { setting: '', characters: [], events: [] };
  const seen = new Set<string>();
  for (let i = 0; i < chunks.length; i++) {
    onStage?.({ stage: 'bible', done: i, total: chunks.length });
    const prompt = `You are analysing part ${i + 1}/${chunks.length} of a video's transcript/subtitles${frames?.length && i === 0 ? ' (sample frames attached)' : ''}.
Extract ONLY what is actually said or shown. Do not guess.
Return JSON: {"setting":"where/when/what kind of story, one sentence","characters":[{"name":"name or role as used in the source","who":"who they are / relation, short"}],"events":["concrete things that happen, in order, one short sentence each, include who did what and why/result"]}
Write values in ${language === 'mm' ? 'Burmese (keep names as in the source)' : 'English'}.

SOURCE:
${chunks[i]}`;
    const raw = await llm(prompt, { json: true, images: i === 0 ? frames?.slice(0, 4) : undefined });
    const part = extractJson<Partial<Bible>>(raw);
    if (!bible.setting && part.setting) bible.setting = String(part.setting);
    for (const c of part.characters || []) {
      const key = String(c?.name || '').trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      bible.characters.push({ name: String(c.name), who: String(c.who || '') });
    }
    for (const e of part.events || []) {
      const s = String(e || '').trim();
      if (s) bible.events.push(s);
    }
  }
  onStage?.({ stage: 'bible', done: chunks.length, total: chunks.length });
  if (bible.events.length === 0) throw new Error('Could not extract any story events from the source');
  return bible;
}

function fallbackOutline(eventCount: number, sections: number): Section[] {
  const n = Math.max(1, Math.min(sections, eventCount));
  const out: Section[] = [];
  for (let i = 0; i < n; i++) {
    const from = Math.floor((i * eventCount) / n) + 1;
    const to = Math.floor(((i + 1) * eventCount) / n);
    const events: number[] = [];
    for (let e = from; e <= to; e++) events.push(e);
    out.push({ title: `Part ${i + 1}`, events });
  }
  return out;
}

async function buildOutline(llm: RecapLlm, bible: Bible, sectionCount: number): Promise<Section[]> {
  const count = bible.events.length;
  try {
    const raw = await llm(
      `Plan a recap narration as ${sectionCount} sections (hook first, escalation, turning point, climax, ending).
Assign EVERY event number below to exactly one section, keeping chronological order (sections may not overlap or skip).
Return JSON: {"sections":[{"title":"short purpose of the section","events":[1,2,3]}]}

${bibleText(bible)}`,
      { json: true }
    );
    const parsed = extractJson<{ sections?: Section[] }>(raw).sections || [];
    const used = new Set<number>();
    const clean: Section[] = [];
    for (const s of parsed) {
      const evs = (s.events || []).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= count && !used.has(n));
      evs.forEach(n => used.add(n));
      if (evs.length) clean.push({ title: String(s.title || ''), events: evs });
    }
    // add any forgotten events to the nearest section so nothing is lost
    for (let n = 1; n <= count; n++) {
      if (used.has(n) || clean.length === 0) continue;
      const target = clean.reduce((best, s) => {
        const d = Math.abs(s.events[s.events.length - 1] - n);
        return d < best.d ? { s, d } : best;
      }, { s: clean[0], d: Infinity }).s;
      target.events.push(n);
      target.events.sort((a, b) => a - b);
    }
    if (clean.length) return clean;
  } catch { /* use fallback */ }
  return fallbackOutline(count, sectionCount);
}

interface Para { events: number[]; text: string }

async function writeBatch(
  llm: RecapLlm,
  bible: Bible,
  batch: { index: number; section: Section; chars: number }[],
  total: number,
  prevTail: string,
  rules: string,
  language: 'mm' | 'en'
): Promise<Para[][]> {
  const lines = batch.map(b => {
    const evs = b.section.events.map(n => `E${n}. ${bible.events[n - 1]}`).join('\n');
    return `SECTION ${b.index + 1}/${total} — ${b.section.title}\nTarget length ≈ ${b.chars} characters.\nAllowed events:\n${evs}`;
  }).join('\n\n');
  const opening = batch[0].index === 0;
  const closing = batch[batch.length - 1].index === total - 1;
  const prompt = `You are a professional ${language === 'mm' ? 'Burmese ' : ''}movie/video recap scriptwriter.
${rules}

STORY BIBLE (for names and facts only):
${bibleText(bible)}

${prevTail ? `The narration so far ends with: "${prevTail}"\nContinue naturally from it; do not repeat it.\n` : ''}${opening ? 'The first paragraph is the HOOK: open on the most gripping real situation from the events (no generic praise, no "this movie is about").\n' : ''}${closing ? 'The last paragraph lands the ending exactly as the events say, with one closing line.\n' : ''}
Write each section below using ONLY its allowed events. Every paragraph must list the event numbers it is based on; a paragraph may not state a fact that is not in those events. Add cause→effect and emotion between events, but no new facts.
Return JSON: {"sections":[{"section":<number>,"paragraphs":[{"events":[<numbers>],"text":"narration"}]}]}

${lines}`;

  const parse = (raw: string): Para[][] | null => {
    try {
      const secs = extractJson<{ sections?: { section: number; paragraphs: Para[] }[] }>(raw).sections || [];
      const out: Para[][] = [];
      for (const b of batch) {
        const s = secs.find(x => Number(x.section) === b.index + 1);
        const allowed = new Set(b.section.events);
        const paras = (s?.paragraphs || [])
          .map(p => ({ events: (p.events || []).map(Number), text: String(p.text || '').trim() }))
          .filter(p => p.text);
        if (!paras.length) return null;
        // grounded = every paragraph cites only allowed events, and at least one
        if (paras.some(p => p.events.length === 0 || p.events.some(e => !allowed.has(e)))) return null;
        out.push(paras);
      }
      return out;
    } catch { return null; }
  };

  let raw = await llm(prompt, { json: true });
  let res = parse(raw);
  if (!res) {
    raw = await llm(prompt + '\n\nIMPORTANT: your previous answer cited events outside the allowed list or was malformed. Cite only allowed event numbers and return valid JSON.', { json: true });
    res = parse(raw);
  }
  if (res) return res;
  // Last resort: accept whatever readable text came back, trusting the prompt constraints.
  try {
    const secs = extractJson<{ sections?: { section: number; paragraphs: Para[] }[] }>(raw).sections || [];
    return batch.map(b => {
      const s = secs.find(x => Number(x.section) === b.index + 1);
      const paras = (s?.paragraphs || []).map(p => ({ events: b.section.events, text: String(p.text || '').trim() })).filter(p => p.text);
      return paras.length ? paras : [{ events: b.section.events, text: b.section.events.map(n => bible.events[n - 1]).join(' ') }];
    });
  } catch {
    return batch.map(b => [{ events: b.section.events, text: b.section.events.map(n => bible.events[n - 1]).join(' ') }]);
  }
}

async function editPass(llm: RecapLlm, bible: Bible, script: string, rules: string): Promise<string> {
  if (script.length > 9000) return script;
  try {
    const raw = await llm(
      `You are the final editor of a recap voice-over.
${rules}

FACTS (the only allowed facts):
${bibleText(bible)}

Improve the draft: smoother transitions, remove repeated phrases and filler, make the hook sharper, keep every event in the same order, keep roughly the same length (±15%). Do NOT add facts. Output ONLY the final narration text, paragraphs separated by a blank line.

DRAFT:
${script}`
    );
    const out = raw.trim().replace(/^```[a-z]*\n?|```$/g, '').trim();
    if (out.length >= script.length * 0.75 && out.length <= script.length * 1.3) return out;
  } catch { /* keep draft */ }
  return script;
}

export async function generateGroundedRecapScript(
  llm: RecapLlm,
  source: string,
  opts: RecapScriptOptions = {}
): Promise<string> {
  const language = opts.language || 'mm';
  const style = opts.style || 'Cinematic movie recap';
  const tone = opts.tone || 'Engaging, dramatic';
  const minutes = opts.targetMinutes ?? 4;
  const rules = voiceRules(language, style, tone);

  if (opts.mode === 'quick') {
    opts.onStage?.({ stage: 'quick' });
    const chars = computeTargetChars(language, minutes, opts.sourceSeconds);
    const out = await llm(
      `${rules}

Write a recap voice-over of about ${chars} characters from the source below. Open with a hook taken from a real moment in it, follow the real order of events, end as the source ends. Use only facts present in the source. Output only the narration.

SOURCE:
${source.slice(0, 24000)}`,
      { images: opts.frames?.slice(0, 4) }
    );
    if (!out.trim()) throw new Error('No script generated');
    return out.trim();
  }

  const watching = !!(opts.getFrames && opts.sourceSeconds && opts.sourceSeconds > 0);
  const bible = watching
    ? await watchVideo(llm, opts, language)
    : await buildBible(llm, source, language, opts.frames, opts.onStage);
  const totalChars = computeTargetChars(
    language,
    minutes,
    opts.sourceSeconds,
    watching ? undefined : bible.events.length,
    watching ? opts.coverage ?? 1 : undefined
  );
  const sectionCount = Math.max(2, Math.min(14, Math.round(totalChars / (language === 'mm' ? 450 : 700)), bible.events.length));

  opts.onStage?.({ stage: 'outline' });
  const sections = await buildOutline(llm, bible, sectionCount);

  const totalEvents = sections.reduce((n, s) => n + s.events.length, 0) || 1;
  const planned = sections.map((section, index) => ({
    index,
    section,
    chars: Math.max(120, Math.round((totalChars * section.events.length) / totalEvents)),
  }));

  const paragraphs: string[] = [];
  const BATCH = 3;
  for (let i = 0; i < planned.length; i += BATCH) {
    opts.onStage?.({ stage: 'write', done: i, total: planned.length });
    const batch = planned.slice(i, i + BATCH);
    const tail = paragraphs.length ? paragraphs[paragraphs.length - 1].slice(-160) : '';
    const written = await writeBatch(llm, bible, batch, planned.length, tail, rules, language);
    written.forEach(sec => sec.forEach(p => paragraphs.push(p.text)));
  }
  opts.onStage?.({ stage: 'write', done: planned.length, total: planned.length });

  const draft = paragraphs.join('\n\n');
  opts.onStage?.({ stage: 'edit' });
  return editPass(llm, bible, draft, rules);
}
