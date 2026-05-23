import type { VercelRequest, VercelResponse } from '@vercel/node';

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
    const { model, contents, config, apiKey: providedKey } = req.body;

    if (!model) {
      return res.status(400).json({ error: 'Model name is required' });
    }

    // Use provided key or fallback to environment variable
    const apiKey = providedKey || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(400).json({ error: 'No API Key available.' });
    }

    console.log(`[Proxy Vercel] Requesting model: ${model}`);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ 
          contents, 
          generationConfig: config 
        })
      }
    );

    const data = await response.json();
    
    if (!response.ok) {
      console.error(`[Proxy Vercel] Gemini API Error (${response.status}):`, data);
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    console.error('[Proxy Vercel] Serverless Error:', error);
    return res.status(500).json({ 
      error: message,
      details: error
    });
  }
}
