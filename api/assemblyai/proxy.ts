import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '100mb',
    },
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, x-assemblyai-key'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const apiKey = (req.headers['x-assemblyai-key'] as string) || 
                 (req.headers['authorization'] as string)?.replace(/^Bearer\s+/i, '') ||
                 process.env.ASSEMBLYAI_API_KEY;

  if (!apiKey || !apiKey.trim()) {
    return res.status(400).json({ error: 'AssemblyAI API Key is missing. Please provide key in header or environment.' });
  }

  const { action, id } = req.query;

  // Extract transcript ID from path if present (e.g. /transcript/:id or /transcript/:id/srt)
  const srtMatch = req.url?.match(/\/transcript\/([a-zA-Z0-9_-]+)\/srt/i);
  const pollMatch = req.url?.match(/\/transcript\/([a-zA-Z0-9_-]+)(?:\?|$)/i);
  const targetId = (id as string) || (action as string) || srtMatch?.[1] || pollMatch?.[1];

  try {
    // Action 0: Resolve YouTube/TikTok/Media URL
    if (req.method === 'POST' && (action === 'resolve-url' || req.url?.includes('resolve-url'))) {
      const { url } = req.body || {};
      if (!url) return res.status(400).json({ error: 'URL is required' });
      const { MediaResolverService } = await import('../../src/services/mediaResolverService');
      const result = await MediaResolverService.resolveAndUploadToAssemblyAI(url, apiKey.trim());
      return res.status(200).json(result);
    }

    // Action 1: Upload media
    if (req.method === 'POST' && (action === 'upload' || req.url?.includes('/upload'))) {
      const uploadResp = await fetch('https://api.assemblyai.com/v2/upload', {
        method: 'POST',
        headers: {
          'Authorization': apiKey.trim(),
          'Content-Type': 'application/octet-stream'
        },
        body: req.body
      });

      const data = await uploadResp.json();
      return res.status(uploadResp.status).json(data);
    }

    // Action 2: Transcribe submit
    if (req.method === 'POST' && (action === 'transcribe' || req.url?.includes('/transcribe'))) {
      const transcribeResp = await fetch('https://api.assemblyai.com/v2/transcript', {
        method: 'POST',
        headers: {
          'Authorization': apiKey.trim(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(req.body)
      });

      const data = await transcribeResp.json();
      return res.status(transcribeResp.status).json(data);
    }

    // Action 3: Fetch SRT
    if (req.method === 'GET' && (action === 'srt' || req.url?.includes('/srt')) && targetId) {
      const srtResp = await fetch(`https://api.assemblyai.com/v2/transcript/${targetId}/srt`, {
        headers: {
          'Authorization': apiKey.trim()
        }
      });

      const srtText = await srtResp.text();
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(srtResp.status).send(srtText);
    }

    // Action 4: Poll Transcript by ID
    if (req.method === 'GET' && (action === 'poll' || targetId)) {
      const pollResp = await fetch(`https://api.assemblyai.com/v2/transcript/${targetId}`, {
        headers: {
          'Authorization': apiKey.trim()
        }
      });

      const data = await pollResp.json();
      return res.status(pollResp.status).json(data);
    }

    return res.status(400).json({ error: 'Unsupported action or method for AssemblyAI proxy.' });
  } catch (err: unknown) {
    console.error('[AssemblyAI Proxy] Serverless Error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal AssemblyAI proxy error'
    });
  }
}
