import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminReady } from '../_lib/fb';

/** Tells the website whether server-side login is set up (so it knows whether to use it). */
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ configured: adminReady(), adminPasswordSet: !!process.env.ADMIN_PASSWORD });
}
