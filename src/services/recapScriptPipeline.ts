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
  /** This narration is one part of a long film's recap split into several videos */
  part?: { index: number; count: number; prevTail?: string };
  /** How many Gemini calls may run at once (more when several API keys are set) */
  concurrency?: number;
  /** Connective flow between paragraphs (default on); false = off */
  flow?: boolean;
  /** Dub style: key lines are spoken by the characters (tagged `[Name|♂] line` / `[Name|♀] line`), the rest is narration */
  dub?: boolean;
  onStage?: (s: RecapStage) => void;
}

export interface RecapSegment { start: number; end: number; text: string }

interface Bible {
  times?: number[];
  setting: string;
  characters: { name: string; who: string }[];
  events: string[];
}
interface Section { title: string; events: number[]; emotion?: string; tease?: string }

const FOREIGN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u0e00-\u0e7f]/g;

/** Burmese output must be Burmese: no Chinese/Japanese/Korean/Thai text copied from the source dialogue. */
export function languageOk(text: string, language: 'mm' | 'en'): boolean {
  if (language === 'en') return (text.match(FOREIGN) || []).length === 0;
  if ((text.match(FOREIGN) || []).length > 0) return false;
  const mm = (text.match(/[\u1000-\u109f]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return mm >= latin; // a few Latin names are fine, a mostly-English paragraph is not
}

const LANG_RULE = (language: 'mm' | 'en') =>
  language === 'mm'
    ? 'LANGUAGE: every word you output must be Burmese (မြန်မာ). The video dialogue may be Chinese/English/etc.: understand it and TELL it in Burmese, never copy or quote foreign-language sentences. Write foreign names in Burmese script.'
    : 'LANGUAGE: every word you output must be English. If the video dialogue is in another language, translate it; never copy foreign-language sentences.';

// Measured: Gemini Burmese voices read ~340 characters per minute at 1.0x (a 1:58 video at 520/min came out as 3:05).
const CHARS_PER_MIN = { mm: 340, en: 800 };

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
    return `VOICE: ${style}. Tone: ${tone}. Spoken, punchy, present tense, short sentences. Make the audience FEEL it: show fear, hope, tension and stakes the footage/events actually imply, ask the audience questions, vary rhythm (short lines at peaks), and end each section on a question or teaser that pulls into the next. No headings, timestamps, emojis, stage directions or markdown. Never invent names, events or endings.`;
  }
  return `အသံ/စတိုင်: ${style}။ လေသံ: ${tone}။
- မြန်မာ ရီကပ်ဇာတ်ကားပြောသူ၏ သဘာဝစကားပြော (…တယ်၊ …ပါတယ်၊ …လိုက်တော့၊ …ပေမယ့်) ကို သုံးပါ။ စာအုပ်စာပေဟန် (၏၊ ၌၊ သည်) မသုံးပါနှင့်။
- စာကြောင်းတိုတို၊ ပုံရိပ်ပေါ်စေသော ကြိယာများဖြင့် ရေးပါ။ တစ်ကြောင်းတည်းတွင် အကြောင်းအရာ တစ်ခုသာ ထားပါ။
- အလွတ်အချော့ စကားလုံးများ ("အလွန်စိတ်ဝင်စားဖွယ်", "ထူးဆန်းသော ဇာတ်လမ်း" စသည့် ယေဘုယျချီးမွမ်းစကား) နှင့် ထပ်ခါထပ်ခါ ပြောခြင်း မလုပ်ပါနှင့်။ ဖြစ်ရပ်၊ လုပ်ရပ်၊ အကြောင်းအကျိုး ကိုသာ ပြောပါ။
- ပုံပြင်ပြောသူလို ပြောပါ၊ အနှစ်ချုပ်လို မရေးပါနှင့်: အခြေအနေကို အရင်ပုံဖော်၊ ပြီးမှ ဖြစ်ရပ်ကို ဆက်ပါ။ "ဘာဖြစ်ခဲ့လဲ → ဘာကြောင့်အရေးကြီးလဲ → ဘာဆုံးရှုံးနိုင်လဲ" ဆိုတဲ့ အစီအစဉ်နဲ့ ဇာတ်ကောင်တွေ ဘာလုပ်နေလဲ၊ ဘာတွေးနေလဲ ဆိုတာ ထည့်ပြောပါ။ အလှည့်အပြောင်းနေရာမှာ စာကြောင်းတိုတစ်ကြောင်းနဲ့ ရပ်ပါ။
- Timestamp၊ ခေါင်းစဉ်၊ [Scene]၊ (Sound effect)၊ emoji၊ markdown မထည့်ပါနှင့်။
- မူရင်းတွင် မပါသော ဇာတ်ကောင်၊ အမည်၊ ဖြစ်ရပ်၊ ဇာတ်သိမ်း မဖန်တီးပါနှင့်။
- ရသ (EMOTION) ကို အသက်သွင်းပါ: ဇာတ်ကောင်ရဲ့ ကြောက်စိတ်၊ မျှော်လင့်ချက်၊ နှောင်ကြိုးတွေကို ပြောပါ (မျက်နှာအမူအရာ၊ အသံ၊ အခြေအနေကနေ ထင်ရှားတာကိုသာ)။ ပရိသတ်ကို မေးခွန်းမေးပါ ("ဒီလူ ဘာကြောင့် ပြုံးနေတာလဲ?")။ တင်းမာတဲ့နေရာမှာ စာကြောင်းတို၊ သက်သာတဲ့နေရာမှာ ရှည်ပါ။ အပိုင်းတစ်ခုချင်းကို နောက်အပိုင်းကို စိတ်ဝင်စားစေမယ့် မေးခွန်း/အရိပ်အမြွက်ဖြင့် ပိတ်ပါ။
- စတိုင်ကို သာဓကအတိုင်း ခံစားပါ၊ အကြောင်းအရာကို မကူးပါနှင့်: "တစ်ညတည်းနဲ့ သူ့ဘဝတစ်ခုလုံး ပြောင်းသွားမယ်လို့ ဘယ်သူမှ မထင်ခဲ့ဘူး။ ဒါပေမယ့် တံခါးကို ဖွင့်လိုက်တဲ့အချိန်မှာ သူမြင်လိုက်ရတာက... ဒါကို ကြည့်ပြီး ခြေထောက်တောင် မလှုပ်နိုင်တော့ဘူး။"`;
}

function partRule(part: RecapScriptOptions['part'], language: 'mm' | 'en'): string {
  if (!part || part.count <= 1) return '';
  const first = part.index === 0, last = part.index >= part.count - 1;
  return `\nMULTI-PART RECAP: this narration is PART ${part.index + 1} of ${part.count} of the recap of ONE long film; the viewer watches the parts in order. ` +
    (first ? 'Open with the hook. ' : 'Do NOT introduce the film or its characters from scratch: carry on the story as if the viewer has just watched the previous part. ') +
    (part.prevTail ? `The previous part ended with: "${part.prevTail.slice(-500)}" — keep every character named exactly as in that text. ` : '') +
    (last ? 'This is the final part: land the ending. ' : 'Do NOT wrap the story up or reveal an ending: finish on a cliffhanger that pulls into the next part. ') +
    (language === 'mm' ? '' : '');
}

function flowRule(flow: boolean | undefined, language: 'mm' | 'en'): string {
  if (flow === false) return '';
  const examples = language === 'mm'
    ? 'Burmese connectives to use (vary them): ဒီလိုနဲ့၊ အဲဒီအချိန်မှာပဲ၊ ဒါပေမယ့်၊ ဒါကြောင့်၊ နောက်တော့၊ တစ်ဖက်မှာတော့၊ ထိုအခိုက်မှာ၊ ဒီတော့မှ၊ အဲဒါနဲ့၊ ကံဆိုးချင်တော့၊ နောက်ဆုံးမှာတော့၊ ဘယ်လိုပဲဖြစ်ဖြစ်၊ ဒါကိုကြည့်ပြီး၊ ဒီအချိန်မှာ'
    : 'English connectives to use (vary them): "Meanwhile", "But then", "Because of that", "By the time", "Little did he know", "Just as", "From that moment"';
  return `\nCONNECTIVE FLOW (very important): the narration must sound like ONE continuous story told aloud, not a list of facts. Every paragraph after the first must OPEN with a natural spoken connective that ties it to the last beat of the previous paragraph (time, cause→effect, contrast or reaction), and sentences inside a paragraph must be joined with connectives too instead of standing alone. Never use the same opening connective in two paragraphs in a row. End each paragraph so that it hands over to the next one (a consequence, a question, or a hint of what comes). ${examples}.`;
}

function dubRule(dub: boolean | undefined): string {
  if (!dub) return '';
  return `\nDUB STYLE: this recap is performed by a cast. The narrator tells the story, and at the key moments the characters SPEAK their own important lines (what they say, or plausibly say, according to the events) as direct first-person speech. Put every spoken line on its OWN line inside the paragraph text, written exactly like this: [Name|♂] the line   or   [Name|♀] the line   (♂ = male character, ♀ = female character; Name = the character's name in the output language's script, spelled the same way every time). Narration lines have NO tag. At most 1-3 spoken lines per paragraph, each short (under about 25 words), always emotional and in character, never inventing plot that is not in the events. Use at most 4 different speaking characters in the whole recap. Never write the tag for the narrator.`;
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
  // Talky videos: the dialogue already carries the story, so look at fewer, longer windows (half the calls).
  const spoken = (opts.cues || []).reduce((n, c) => n + c.text.replace(/\s+/g, '').length, 0);
  const winSec = spoken / Math.max(1, dur) >= 4 ? 40 : 20;
  // a feature film gets more (and longer) windows than a short clip
  const count = Math.max(1, Math.min(dur > 1800 ? 60 : 30, Math.ceil(dur / winSec)));
  const len = dur / count;
  const bible: Bible = { setting: '', characters: [], events: [], times: [] };
  const seen = new Set<string>();
  const perWindow: { t: number; text: string }[][] = new Array(count).fill(null).map(() => []);
  const chars: { name: string; who: string }[][] = new Array(count).fill(null).map(() => []);
  const settings: string[] = new Array(count).fill('');
  let done = 0;
  const failed: string[] = [];
  opts.onStage?.({ stage: 'watch', done: 0, total: count });

  const runWindow = async (i: number) => {
    const a = i * len;
    const b = (i + 1) * len;
    const frames = (await opts.getFrames!(a, b).catch(() => [])).slice(0, len > 30 ? 8 : 6);
    const dialogue = (opts.cues || [])
      .filter(c => c.start < b && c.end > a)
      .map(c => `[${fmtT(c.start)}] ${c.text.trim().replace(/\s+/g, ' ')}`)
      .join('\n');
    const prompt = `You are a film editor WATCHING a video before writing its recap. This is the part from ${fmtT(a)} to ${fmtT(b)} (${frames.length} frames attached in time order).
Describe what really happens: who is on screen and what they do, where, what changes, and what is said (dialogue below). Use only what the frames and dialogue show; if something is unclear say so instead of guessing.
Return JSON: {"setting":"place/time/kind of story if visible","characters":[{"name":"name as spoken/shown, or a short visual description like 'the man in the red jacket'","who":"role, short"}],"events":[{"t":<seconds from video start>,"text":"one concrete sentence: who does what, the visible cause/result, and the visible emotion or tension (expression, tone of voice, danger, relief)"}]}
${len > 30 ? "8-14" : "4-8"} events, chronological; do not skip small turning points. ${LANG_RULE(language)}

DIALOGUE IN THIS PART:
${dialogue || '(none)'}`;
    let raw = await llm(prompt, { json: true, images: frames });
    if (!languageOk(raw, language)) {
      raw = await llm(prompt + '\n\nYour previous answer contained text in the wrong language. Redo it, fully in the required language.', { json: true, images: frames });
    }
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
      try { await runWindow(i); } catch (e1) {
        try { await runWindow(i); } catch (e2) {
          failed.push(`${fmtT(i * len)}: ${e2 instanceof Error ? e2.message : String(e2)}`);
          done++; opts.onStage?.({ stage: 'watch', done, total: count });
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(8, opts.concurrency || 3)) }, () => worker()));

  for (let i = 0; i < count; i++) {
    if (!bible.setting && settings[i]) bible.setting = settings[i];
    for (const c of chars[i]) {
      const key = c.name.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      bible.characters.push(c);
    }
    for (const e of perWindow[i].sort((x, y) => x.t - y.t)) { bible.events.push(`[${fmtT(e.t)}] ${e.text}`); bible.times!.push(e.t); }
  }
  if (bible.events.length === 0) throw new Error(`Could not understand the video content. ${failed.slice(0, 2).join(' | ')}`);
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
${LANG_RULE(language)}

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
For each section also give the dominant feeling the audience should have ("emotion", e.g. dread, hope, betrayal, relief, awe) and a one-line cliffhanger/question that pulls into the next section ("tease"; for the last section, the closing punch).
Return JSON: {"sections":[{"title":"short purpose of the section","emotion":"...","tease":"...","events":[1,2,3]}]}

${bibleText(bible)}`,
      { json: true }
    );
    const parsed = extractJson<{ sections?: Section[] }>(raw).sections || [];
    const used = new Set<number>();
    const clean: Section[] = [];
    for (const s of parsed) {
      const evs = (s.events || []).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= count && !used.has(n));
      evs.forEach(n => used.add(n));
      if (evs.length) clean.push({ title: String(s.title || ''), events: evs, emotion: s.emotion ? String(s.emotion) : undefined, tease: s.tease ? String(s.tease) : undefined });
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
  language: 'mm' | 'en',
  partCtx?: { first: boolean; last: boolean }
): Promise<Para[][]> {
  const lines = batch.map(b => {
    const evs = b.section.events.map(n => `E${n}. ${bible.events[n - 1]}`).join('\n');
    return `SECTION ${b.index + 1}/${total} — ${b.section.title}\nFeeling to evoke: ${b.section.emotion || 'fitting the events'}\nEnd the section with this pull toward what comes next: ${b.section.tease || '(natural cliffhanger)'}\nTarget length ≈ ${b.chars} characters (do not write less than ${Math.round(b.chars * 0.9)}).\nAllowed events:\n${evs}`;
  }).join('\n\n');
  const opening = batch[0].index === 0 && (!partCtx || partCtx.first);
  const closing = batch[batch.length - 1].index === total - 1 && (!partCtx || partCtx.last);
  const prompt = `You are a professional ${language === 'mm' ? 'Burmese ' : ''}movie/video recap scriptwriter.
${rules}

STORY BIBLE (for names and facts only):
${bibleText(bible)}

${prevTail ? `The narration so far ends with: "${prevTail}"\nContinue naturally from it; do not repeat it.\n` : ''}${opening ? 'The first paragraph is the HOOK: open on the most gripping real situation from the events (no generic praise, no "this movie is about").\n' : ''}${closing ? 'The last paragraph lands the ending exactly as the events say, with one closing line.\n' : ''}
${LANG_RULE(language)}
Write each section below using ONLY its allowed events. Every paragraph must list the event numbers it is based on; a paragraph may not state a fact that is not in those events. Tell it like a gifted storyteller talking to a friend, not like a summary: set the scene first, then let each beat land (what happened → why it matters → what it costs or risks), name who does what, and let the turning points breathe with a short punchy line. Add cause→effect, the characters' feelings and the stakes that the events imply, and vivid sensory detail from what is described, but no new facts, names or plot points. Cover EVERY listed event — never skip one. 
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
        if (paras.some(p => !languageOk(p.text, language))) return null;
        out.push(paras);
      }
      return out;
    } catch { return null; }
  };

  let raw = await llm(prompt, { json: true });
  let res = parse(raw);
  const want = batch.reduce((n, b) => n + b.chars, 0);
  const have = (r: Para[][] | null) => (r ? r.flat().reduce((n, p) => n + p.text.length, 0) : 0);
  if (res && have(res) < want * 0.88) {
    const raw2 = await llm(prompt + `\n\nIMPORTANT: your previous answer was too short (${have(res)} of ~${want} characters) and flat. The narration MUST reach at least ${Math.round(want * 0.95)} characters. Rewrite it fuller: go through every event, add what the characters see, feel and risk, and keep the emotional build-up. Still cite events correctly.`, { json: true });
    const res2 = parse(raw2);
    if (res2 && have(res2) > have(res)) { res = res2; raw = raw2; }
  }
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

Improve the draft: smoother transitions, remove repeated phrases and filler, make the hook gripping, sharpen the emotional peaks, keep the rhetorical questions and section-ending teasers, land a memorable closing line, keep every event in the same order, keep roughly the same length (±15%). Do NOT add facts. Output ONLY the final narration text, paragraphs separated by a blank line.

DRAFT:
${script}`
    );
    const out = raw.trim().replace(/^```[a-z]*\n?|```$/g, '').trim();
    if (out.length >= script.length * 0.75 && out.length <= script.length * 1.3) return out;
  } catch { /* keep draft */ }
  return script;
}

/**
 * The video is watched window by window, so the same person is often named differently
 * ("the man in the red jacket" / "Li Wei" / "the boss"). Merge them into one canonical name
 * and rewrite the events, so the script keeps calling each character the same thing.
 */
async function unifyCharacters(llm: RecapLlm, bible: Bible, language: 'mm' | 'en'): Promise<void> {
  if (bible.characters.length < 3) return;
  try {
    const list = bible.characters.map((c, i) => `${i + 1}. ${c.name} — ${c.who}`).join('\n');
    const raw = await llm(
      `These character labels were written independently for different parts of one video, so several may be the SAME person.
Merge entries that are clearly the same person (same role/relationship/appearance). Prefer a real name that is spoken or shown over a visual description. Do not merge people you are not sure about.
Return JSON: {"characters":[{"name":"canonical name","who":"role, short","aliases":["other labels copied EXACTLY from the list that mean the same person"]}]}
${LANG_RULE(language)}

${list}`,
      { json: true }
    );
    if (!languageOk(raw, language)) return;
    const parsed = extractJson<{ characters?: { name?: string; who?: string; aliases?: string[] }[] }>(raw).characters || [];
    const known = new Set(bible.characters.map(c => c.name));
    const merged: { name: string; who: string }[] = [];
    const replace: [string, string][] = [];
    for (const c of parsed) {
      const name = String(c.name || '').trim();
      if (!name) continue;
      merged.push({ name, who: String(c.who || '') });
      for (const a of c.aliases || []) {
        const alias = String(a).trim();
        if (alias.length >= 2 && alias !== name && known.has(alias)) replace.push([alias, name]);
      }
    }
    if (merged.length === 0 || merged.length > bible.characters.length) return;
    // longest aliases first so "the man in the red jacket" wins over "the man"
    replace.sort((a, b) => b[0].length - a[0].length);
    bible.events = bible.events.map(e => replace.reduce((acc, [from, to]) => acc.split(from).join(to), e));
    bible.characters = merged;
  } catch { /* keep the original labels */ }
}

/** Polish the narration paragraph by paragraph (keeps the count/order, so the video time alignment stays valid). */
async function editParagraphs(
  llm: RecapLlm,
  bible: Bible,
  paragraphs: string[],
  rules: string,
  language: 'mm' | 'en'
): Promise<string[]> {
  const out = [...paragraphs];
  const W = 8;
  const starts: number[] = [];
  for (let i = 0; i < paragraphs.length; i += W) starts.push(i);
  // windows are independent (context comes from the original previous paragraph), so run them in parallel
  await Promise.all(starts.map(async i => {
    const part = paragraphs.slice(i, i + W);
    const prev = i > 0 ? paragraphs[i - 1].slice(-200) : '';
    try {
      const raw = await llm(
        `You are the final editor of a recap voice-over. Edit the numbered paragraphs below.
${rules}

FACTS (the only allowed facts):
${bibleText(bible)}

${prev ? `The paragraph before these ends with: "${prev}"\n` : ''}Do this: make each paragraph flow into the next (every paragraph after the first MUST open with a natural spoken connective and the sentences inside must be joined with connectives - never remove or flatten these, add them where missing, but vary them so no two neighbouring paragraphs open the same way), remove repeated filler words across paragraphs, call every character by the same name, sharpen the emotional peaks, ${i === 0 ? 'make the very first line a gripping hook, ' : ''}keep questions and teasers. Keep EXACTLY ${part.length} paragraphs in the same order (never merge or split), keep each paragraph's facts, keep each about the same length (±15%). Do NOT add facts.
${LANG_RULE(language)}
Return JSON: {"paragraphs":["...","..."]}

${part.map((t, k) => `${k + 1}. ${t}`).join('\n\n')}`,
        { json: true }
      );
      const edited = extractJson<{ paragraphs?: string[] }>(raw).paragraphs?.map(x => String(x).trim());
      if (!edited || edited.length !== part.length) return;
      const ok = edited.every((t, k) => t && t.length >= part[k].length * 0.7 && t.length <= part[k].length * 1.35 && languageOk(t, language));
      if (ok) edited.forEach((t, k) => { out[i + k] = t; });
    } catch { /* keep the original paragraphs of this window */ }
  }));
  return out;
}


/**
 * Connective pass: makes sure every paragraph after the first opens with a spoken connective that ties it to the
 * paragraph before, and that sentences inside are joined too. Count, order, facts, length and dub tags are kept.
 */
async function connectParagraphs(
  llm: RecapLlm,
  paragraphs: string[],
  rules: string,
  language: 'mm' | 'en'
): Promise<string[]> {
  const out = [...paragraphs];
  const W = 6;
  const starts: number[] = [];
  for (let i = 0; i < paragraphs.length; i += W) starts.push(i);
  const tags = (t: string) => (t.match(/\[[^\]|]+\|[♂♀]\]/g) || []).length;
  await Promise.all(starts.map(async i => {
    const part = paragraphs.slice(i, i + W);
    const prev = i > 0 ? paragraphs[i - 1].slice(-220) : '';
    try {
      const raw = await llm(
        `You are polishing the CONNECTIVES of a recap voice-over so it sounds like one story told aloud.
${rules}

${prev ? `The paragraph before these ends with: "${prev}"\n` : 'The first paragraph below is the opening: keep it as the hook.\n'}For each numbered paragraph: ${i === 0 ? 'keep paragraph 1 as the hook; for all the others ' : ''}make it OPEN with a natural spoken connective that links it to the previous paragraph's last beat (time, cause and effect, contrast or reaction), join the sentences inside with connectives instead of standing alone, and end it so it hands over to the next. Never use the same opening connective in two neighbouring paragraphs. Do NOT change facts, names, order or meaning, do not add events, keep each paragraph about the same length (+-20%), and keep every dialogue tag like [Name|♂] and its line exactly as written.
Keep EXACTLY ${part.length} paragraphs. ${LANG_RULE(language)}
Return JSON: {"paragraphs":["...","..."]}

${part.map((t, k) => `${k + 1}. ${t}`).join('\n\n')}`,
        { json: true }
      );
      const edited = extractJson<{ paragraphs?: string[] }>(raw).paragraphs?.map(x => String(x).trim());
      if (!edited || edited.length !== part.length) return;
      const ok = edited.every((t, k) => t && t.length >= part[k].length * 0.75 && t.length <= part[k].length * 1.4 && tags(t) === tags(part[k]) && languageOk(t, language));
      if (ok) edited.forEach((t, k) => { out[i + k] = t; });
    } catch { /* keep this window as it was */ }
  }));
  return out;
}

export async function generateGroundedRecapScript(llm: RecapLlm, source: string, opts: RecapScriptOptions = {}): Promise<string> {
  return (await generateGroundedRecap(llm, source, opts)).text;
}

/** Same as generateGroundedRecapScript, but when the video was watched every paragraph also carries its video time range. */
export async function generateGroundedRecap(
  llm: RecapLlm,
  source: string,
  opts: RecapScriptOptions = {}
): Promise<{ text: string; segments?: RecapSegment[] }> {
  const language = opts.language || 'mm';
  const style = opts.style || 'Cinematic movie recap';
  const tone = opts.tone || 'Engaging, dramatic';
  const minutes = opts.targetMinutes ?? 4;
  const rules = voiceRules(language, style, tone) + partRule(opts.part, language) + dubRule(opts.dub) + flowRule(opts.flow, language);
  const partCtx = opts.part && opts.part.count > 1 ? { first: opts.part.index === 0, last: opts.part.index >= opts.part.count - 1 } : undefined;

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
    return { text: out.trim() };
  }

  const watching = !!(opts.getFrames && opts.sourceSeconds && opts.sourceSeconds > 0);
  const bible = watching
    ? await watchVideo(llm, opts, language)
    : await buildBible(llm, source, language, opts.frames, opts.onStage);
  if (watching) await unifyCharacters(llm, bible, language);
  const totalChars = computeTargetChars(
    language,
    minutes,
    opts.sourceSeconds,
    watching ? undefined : bible.events.length,
    watching ? opts.coverage ?? 1 : undefined
  );
  const sectionCount = watching
    ? Math.max(3, Math.min(48, Math.round(((opts.sourceSeconds as number) * (opts.coverage ?? 1)) / 25), bible.events.length))
    : Math.max(2, Math.min(14, Math.round(totalChars / (language === 'mm' ? 450 : 700)), bible.events.length));

  opts.onStage?.({ stage: 'outline' });
  const sections = await buildOutline(llm, bible, sectionCount);

  const totalEvents = sections.reduce((n, s) => n + s.events.length, 0) || 1;
  // When the video was watched, a section's share of the narration follows the time its events span on screen.
  const startOf = (sec: Section) => Math.min(...sec.events.map(n => bible.times?.[n - 1] ?? 0));
  const spans = sections.map((sec, i) => {
    const next = i + 1 < sections.length ? startOf(sections[i + 1]) : (opts.sourceSeconds as number);
    return Math.max(3, next - startOf(sec));
  });
  const spanSum = spans.reduce((a, b) => a + b, 0) || 1;
  const planned = sections.map((section, index) => ({
    index,
    section,
    chars: Math.max(
      120,
      Math.round(watching ? (totalChars * spans[index]) / spanSum : (totalChars * section.events.length) / totalEvents)
    ),
  }));

  const paragraphs: string[] = [];
  const paraEvents: number[][] = [];
  const BATCH = 3;
  // Batches are written in parallel (3 at a time). Only the "continue from the previous ending" hint is given up;
  // the edit pass below smooths the joins.
  const batches: typeof planned[] = [];
  for (let i = 0; i < planned.length; i += BATCH) batches.push(planned.slice(i, i + BATCH));
  const results: Para[][][] = new Array(batches.length);
  let nextBatch = 0;
  let writtenCount = 0;
  opts.onStage?.({ stage: 'write', done: 0, total: planned.length });
  await Promise.all(Array.from({ length: Math.max(1, Math.min(6, opts.concurrency || 3)) }, () => 0).map(async () => {
    while (nextBatch < batches.length) {
      const bi = nextBatch++;
      results[bi] = await writeBatch(llm, bible, batches[bi], planned.length, '', rules, language, partCtx);
      writtenCount += batches[bi].length;
      opts.onStage?.({ stage: 'write', done: writtenCount, total: planned.length });
    }
  }));
  results.forEach(written => written.forEach(sec => sec.forEach(p => { paragraphs.push(p.text); paraEvents.push(p.events); })));
  opts.onStage?.({ stage: 'write', done: planned.length, total: planned.length });

  // Final guard: any paragraph still in the wrong language is rewritten (never shipped as is).
  for (let i = 0; i < paragraphs.length; i++) {
    if (languageOk(paragraphs[i], language)) continue;
    try {
      const fixed = (await llm(
        `${LANG_RULE(language)}\nRewrite this recap narration paragraph entirely in ${language === 'mm' ? 'spoken Burmese' : 'English'}, same meaning, same emotion, no foreign-language text. Output only the paragraph.\n\n${paragraphs[i]}`
      )).trim();
      if (fixed && languageOk(fixed, language)) paragraphs[i] = fixed;
      else paragraphs[i] = paragraphs[i].replace(FOREIGN, '').replace(/\s{2,}/g, ' ').trim() || paragraphs[i];
    } catch { /* keep */ }
  }

  if (watching && bible.times && !opts.dub) {
    opts.onStage?.({ stage: 'edit' });
    const polished = await editParagraphs(llm, bible, paragraphs, rules, language);
    polished.forEach((t, i) => { paragraphs[i] = t; });
  }
  // Connective pass (also for dub recaps, which skip the edit pass above): every paragraph must hand over to the next.
  if (opts.flow !== false && paragraphs.length > 1) {
    const linked = await connectParagraphs(llm, paragraphs, rules, language);
    linked.forEach((t, i) => { paragraphs[i] = t; });
  }
  const draft = paragraphs.join('\n\n');

  if (watching && bible.times) {
    // Time-align: every paragraph starts where the first event it tells happens on screen.
    const dur = opts.sourceSeconds as number;
    const MIN_GAP = 2;
    const starts: number[] = [];
    paragraphs.forEach((_, i) => {
      const ts = paraEvents[i].map(n => bible.times![n - 1]).filter(t => Number.isFinite(t));
      let st = ts.length ? Math.min(...ts) : i ? starts[i - 1] + MIN_GAP : 0;
      if (i === 0) st = 0;
      if (i > 0) st = Math.max(st, starts[i - 1] + MIN_GAP);
      starts.push(Math.min(st, Math.max(0, dur - MIN_GAP)));
    });
    const segments: RecapSegment[] = paragraphs.map((text, i) => ({
      start: starts[i],
      end: i + 1 < paragraphs.length ? Math.max(starts[i] + 1, starts[i + 1]) : dur,
      text,
    })).filter(sg => sg.end - sg.start >= 0.5);
    if (segments.length) return { text: draft, segments };
  }

  opts.onStage?.({ stage: 'edit' });
  return { text: opts.dub ? draft : await editPass(llm, bible, draft, rules) };
}
