import type { VercelRequest, VercelResponse } from '@vercel/node';

// In-memory cache for bad/invalid keys (10 minute TTL)
const invalidKeyCache = new Map<string, number>();

function isKeyMarkedInvalid(key: string): boolean {
  const exp = invalidKeyCache.get(key);
  if (!exp) return false;
  if (Date.now() > exp) {
    invalidKeyCache.delete(key);
    return false;
  }
  return true;
}

function markKeyInvalid(key: string): void {
  invalidKeyCache.set(key, Date.now() + 10 * 60 * 1000);
}

function maskApiKey(key?: string | null): string {
  if (!key || typeof key !== 'string') return '[empty]';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '****';
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

function isPlausibleKeyCandidate(key?: string | null): boolean {
  if (!key || typeof key !== 'string') return false;
  const trimmed = key.trim();
  const lower = trimmed.toLowerCase();
  if (trimmed.length < 25) return false;
  if (
    lower.startsWith('my_') ||
    lower.startsWith('my ') ||
    lower.startsWith('test') ||
    lower.startsWith('sample') ||
    lower.startsWith('key_') ||
    lower.startsWith('gemini_') ||
    lower.includes('placeholder') ||
    lower.includes('...')
  ) {
    return false;
  }
  return !isKeyMarkedInvalid(trimmed);
}

function extractErrorDetails(err: unknown): { status: number; message: string; raw: string } {
  const e = err as { status?: number; statusCode?: number; response?: { status: number }; message?: string };
  let status = e.status || e.statusCode || (e.response ? e.response.status : 0);
  let message = e.message || "Unknown error";
  const raw = typeof err === 'string' ? err : JSON.stringify(err);

  if (!status) {
    const statusMatch = message.match(/\b(400|401|403|404|429|500|502|503|504)\b/);
    if (statusMatch) {
      status = parseInt(statusMatch[1], 10);
    }
  }

  if (typeof message === 'string' && message.startsWith('{') && message.includes('"message"')) {
    try {
      const parsed = JSON.parse(message);
      message = parsed.error?.message || parsed.message || message;
    } catch {}
  }

  return { status: status || 500, message, raw };
}

function isApiKeyInvalidError(err: unknown, status: number): boolean {
  const { message, raw } = extractErrorDetails(err);
  const combined = (message + ' ' + raw).toUpperCase();
  if (status === 400 || combined.includes('API_KEY_INVALID') || combined.includes('API KEY NOT VALID')) {
    return (
      combined.includes('API_KEY_INVALID') ||
      combined.includes('API KEY NOT VALID') ||
      combined.includes('API_KEY_SERVICE_BLOCKED') ||
      combined.includes('CONSUMER_INVALID') ||
      combined.includes('API KEY EXPIRED') ||
      (status === 400 && combined.includes('INVALID_ARGUMENT') && combined.includes('API KEY'))
    );
  }
  return false;
}

function isOverloadError(err: unknown, status: number): boolean {
  if (status === 503 || status === 500 || status === 429 || status === 502 || status === 504) {
    return true;
  }
  const { message, raw } = extractErrorDetails(err);
  const lower = (message + ' ' + raw).toLowerCase();
  return (
    lower.includes('high demand') ||
    lower.includes('spikes in demand') ||
    lower.includes('currently experiencing') ||
    lower.includes('overloaded') ||
    lower.includes('unavailable') ||
    lower.includes('resource_exhausted') ||
    lower.includes('rate limit') ||
    lower.includes('quota') ||
    lower.includes('timeout') ||
    lower.includes('etimedout') ||
    lower.includes('econnreset') ||
    lower.includes('socket hang up') ||
    lower.includes('fetch failed')
  );
}

function getCapabilityModelGroup(initialModel: string, isTts: boolean): string[] {
  if (isTts) {
    if (initialModel === 'gemini-3.8-flash-tts') {
      return ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'];
    }
    return ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'];
  }
  if (initialModel === 'gemini-3.8-flash') {
    return ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
  }
  if (initialModel === 'gemini-3.5-flash') {
    return ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'];
  }
  if (initialModel === 'gemini-3.5-flash-lite') {
    return ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash'];
  }
  return [initialModel, 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
}

interface AttemptRecord {
  keyLabel: string;
  model: string;
  status: number;
  isKeyValid: boolean;
  isOverload: boolean;
  rawMessage: string;
}

function formatAttemptSummary(attempts: AttemptRecord[]): string {
  if (attempts.length === 0) return "ကြိုးစားမှု မရှိသေးပါ။";

  const keySummaries: string[] = [];
  const keysSeen = new Set<string>();

  for (const a of attempts) {
    if (keysSeen.has(a.keyLabel)) continue;
    keysSeen.add(a.keyLabel);

    const forThisKey = attempts.filter(x => x.keyLabel === a.keyLabel);
    const modelsTried = [...new Set(forThisKey.map(x => x.model))].join(', ');
    const latest = forThisKey[forThisKey.length - 1];

    if (!latest.isKeyValid) {
      keySummaries.push(`${latest.keyLabel}: မမှန်ပါ (${latest.status || 400})။`);
    } else if (latest.isOverload) {
      const statusCode = latest.status || 503;
      const statusText = statusCode === 429 ? 'limit ပြည့်ကျပ် (429)' : `server ပြည့်ကျပ် (${statusCode})`;
      keySummaries.push(`${modelsTried}: ${statusText}, ${latest.keyLabel} မှန်ပါတယ်။`);
    } else {
      keySummaries.push(`${modelsTried}: အမှား (${latest.status || 'unknown'}), ${latest.keyLabel} မှန်ပါတယ်။`);
    }
  }

  return keySummaries.join(' ');
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Add CORS headers for production
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { model, contents, config, apiKey: providedKey, selectedModel, isTts } = req.body;

    let targetModel = selectedModel || model;

    if (!targetModel) {
      targetModel = isTts ? 'gemini-3.8-flash-lite-tts' : 'gemini-3.8-flash';
    }

    if (isTts && !targetModel.includes('tts')) {
      targetModel = 'gemini-3.8-flash-lite-tts';
    }

    interface KeyCandidate {
      key: string;
      source: 'personal' | 'env';
      label: string;
    }

    const keyCandidates: KeyCandidate[] = [];

    if (isPlausibleKeyCandidate(providedKey)) {
      const pk = providedKey.trim();
      keyCandidates.push({
        key: pk,
        source: 'personal',
        label: `key ${pk.slice(-4)}`
      });
    }

    if (isPlausibleKeyCandidate(process.env.GEMINI_API_KEY)) {
      const ek = process.env.GEMINI_API_KEY.trim();
      if (!keyCandidates.some(c => c.key === ek)) {
        keyCandidates.push({
          key: ek,
          source: 'env',
          label: 'environment key'
        });
      }
    }

    if (keyCandidates.length === 0) {
      return res.status(400).json({ 
        error: 'အသုံးပြုနိုင်သော API Key မရှိသေးပါ။ Settings တွင် API Key အသစ်ထည့်သွင်းပေးပါ။',
        burmeseSummary: 'အသုံးပြုနိုင်သော API Key မရှိသေးပါ။ Settings တွင် API Key အသစ်ထည့်သွင်းပေးပါ။'
      });
    }

    const voiceIdVal = String(
      config?.speechConfig?.voiceConfig?.voiceId || 
      config?.speechConfig?.voiceConfig?.voiceKeyConfig?.voiceKey || 
      config?.speech_config?.[0]?.voice || 
      ''
    );
    const isClonedVoice = Boolean(
      isTts && (
        voiceIdVal.startsWith('voices/') || 
        voiceIdVal.startsWith('voice_') || 
        voiceIdVal.startsWith('voicekey_')
      )
    );

    if (isClonedVoice) {
      if (targetModel !== 'gemini-3.8-flash-tts' && targetModel !== 'gemini-3.8-flash-lite-tts') {
        targetModel = 'gemini-3.8-flash-tts';
      }
    } else if (isTts) {
      if (!targetModel.includes('tts')) {
        targetModel = 'gemini-3.8-flash-lite-tts';
      }
    }

    const capabilityModels = getCapabilityModelGroup(targetModel, !!isTts);
    const attempts: AttemptRecord[] = [];
    let firstMeaningfulError: { status: number; message: string; raw: string } | null = null;

    const executeCall = async (key: string, currentModel: string) => {
      if (isClonedVoice) {
        const textPart = contents?.[0]?.parts?.find((p: { text?: string; speechMetadata?: { style?: string } }) => p.text);
        const text = textPart?.text || "";
        const annotations: Array<{ type: string; style: string }> = [];
        if (textPart?.speechMetadata?.style) {
          annotations.push({
            type: "speech_metadata",
            style: textPart.speechMetadata.style
          });
        } else if (text.startsWith('[') && text.includes(']')) {
          const closingIdx = text.indexOf(']');
          const style = text.substring(1, closingIdx);
          annotations.push({
            type: "speech_metadata",
            style: style
          });
        }

        const interactionPayload = {
          model: currentModel,
          input: [
            {
              type: "user_input",
              content: [
                {
                  type: "text",
                  text: text,
                  ...(annotations.length > 0 ? { annotations } : {})
                }
              ]
            }
          ],
          response_format: { type: "audio" },
          generation_config: {
            speech_config: [
              {
                voice: voiceIdVal
              }
            ]
          }
        };

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/interactions?key=${key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify(interactionPayload)
          }
        );

        const data = await response.json();
        if (!response.ok) {
          const errorObj = new Error(data.error?.message || response.statusText || 'API Call Failed') as Error & { status?: number; data?: unknown };
          errorObj.status = response.status;
          errorObj.data = data;
          throw errorObj;
        }

        let base64Audio = "";
        let mimeType = "audio/wav";

        if (data.output_audio?.data) {
          base64Audio = data.output_audio.data;
          mimeType = data.output_audio.mime_type || mimeType;
        } else if (Array.isArray(data.output)) {
          for (const out of data.output) {
            if (out.type === 'audio' && out.data) {
              base64Audio = out.data;
              mimeType = out.mime_type || mimeType;
              break;
            }
            if (Array.isArray(out.content)) {
              for (const c of out.content) {
                if (c.type === 'audio' && c.data) {
                  base64Audio = c.data;
                  mimeType = c.mime_type || mimeType;
                  break;
                }
              }
            }
          }
        } else if (data.output?.audio?.data) {
          base64Audio = data.output.audio.data;
          mimeType = data.output.audio.mime_type || mimeType;
        } else if (data.candidates?.[0]?.content?.parts) {
          for (const p of data.candidates[0].content.parts) {
            if (p.inlineData?.data) {
              base64Audio = p.inlineData.data;
              mimeType = p.inlineData.mimeType || mimeType;
              break;
            }
          }
        }

        if (!base64Audio) {
          throw new Error("No audio data returned from Interactions API");
        }

        return {
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      data: base64Audio,
                      mimeType: mimeType
                    }
                  }
                ]
              }
            }
          ]
        };
      }

      const updatedConfig: Record<string, unknown> = config ? { ...config } : {};
      if (isTts) {
        updatedConfig.responseModalities = ["AUDIO"];
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents, generationConfig: updatedConfig })
        }
      );

      const data = await response.json();
      if (!response.ok) {
        const errorObj = new Error(data.error?.message || response.statusText || 'API Call Failed') as Error & { status?: number; data?: unknown };
        errorObj.status = response.status;
        errorObj.data = data;
        throw errorObj;
      }
      return data;
    };

    for (let keyIdx = 0; keyIdx < keyCandidates.length; keyIdx++) {
      const candidate = keyCandidates[keyIdx];
      if (isKeyMarkedInvalid(candidate.key)) {
        console.log(`[Proxy Vercel] Skipping invalid cached key: ${candidate.label} (${maskApiKey(candidate.key)})`);
        continue;
      }

      let keyFailedWithBadKey = false;

      for (let modelIdx = 0; modelIdx < capabilityModels.length; modelIdx++) {
        const currentModel = capabilityModels[modelIdx];
        console.log(`[Proxy Vercel] Trying model ${currentModel} with ${candidate.label} (${maskApiKey(candidate.key)})`);

        try {
          const result = await executeCall(candidate.key, currentModel);
          return res.status(200).json(result);
        } catch (err: unknown) {
          const errDetails = extractErrorDetails(err);

          if (isApiKeyInvalidError(err, errDetails.status)) {
            markKeyInvalid(candidate.key);
            attempts.push({
              keyLabel: candidate.label,
              model: currentModel,
              status: 400,
              isKeyValid: false,
              isOverload: false,
              rawMessage: errDetails.message
            });
            keyFailedWithBadKey = true;
            console.warn(`[Proxy Vercel] Key ${candidate.label} (${maskApiKey(candidate.key)}) failed: 400 API_KEY_INVALID. Moving to next key.`);
            break;
          }

          if (isOverloadError(err, errDetails.status)) {
            attempts.push({
              keyLabel: candidate.label,
              model: currentModel,
              status: errDetails.status,
              isKeyValid: true,
              isOverload: true,
              rawMessage: errDetails.message
            });

            if (!firstMeaningfulError) {
              firstMeaningfulError = errDetails;
            }

            const backoffs = [1000, 2000, 4000];
            for (let r = 0; r < backoffs.length; r++) {
              const delay = backoffs[r];
              console.log(`[Proxy Vercel] Retrying ${currentModel} with ${candidate.label} (${maskApiKey(candidate.key)}) in ${delay}ms (retry ${r + 1}/3)...`);
              await sleep(delay);

              try {
                const retryResult = await executeCall(candidate.key, currentModel);
                return res.status(200).json(retryResult);
              } catch (retryErr: unknown) {
                const rDetails = extractErrorDetails(retryErr);
                if (isApiKeyInvalidError(retryErr, rDetails.status)) {
                  markKeyInvalid(candidate.key);
                  keyFailedWithBadKey = true;
                  break;
                }
                console.warn(`[Proxy Vercel] Retry ${r + 1}/3 failed for ${currentModel} on ${candidate.label} with status ${rDetails.status}`);
              }
            }

            if (keyFailedWithBadKey) break;

            console.warn(`[Proxy Vercel] Model ${currentModel} exhausted 3 retries on ${candidate.label}. Trying fallback model in capability group with SAME key...`);
            continue;
          }

          attempts.push({
            keyLabel: candidate.label,
            model: currentModel,
            status: errDetails.status,
            isKeyValid: true,
            isOverload: false,
            rawMessage: errDetails.message
          });
          if (!firstMeaningfulError) {
            firstMeaningfulError = errDetails;
          }
        }

        if (keyFailedWithBadKey) break;
      }
    }

    const burmeseSummary = formatAttemptSummary(attempts);
    console.error(`[Proxy Vercel] All attempts failed. Summary: ${burmeseSummary}`);

    const chosenStatus = firstMeaningfulError ? firstMeaningfulError.status : (attempts[0]?.status || 503);
    const returnStatus = (chosenStatus === 400 && attempts.some(a => a.isKeyValid)) ? 503 : chosenStatus;
    const firstErrorMsg = firstMeaningfulError ? firstMeaningfulError.message : (attempts[0]?.rawMessage || "Request failed");

    return res.status(returnStatus).json({ 
      error: `${burmeseSummary}\n\n${firstErrorMsg}`,
      burmeseSummary,
      firstMeaningfulError: firstErrorMsg,
      attempts
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    console.error('[Proxy Vercel] Serverless Error:', error);
    return res.status(500).json({ 
      error: message,
      details: error
    });
  }
}
