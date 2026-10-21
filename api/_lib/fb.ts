import { initializeApp, getApps, getApp, cert, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

export const OWNER_ID = 'saw_vlogs_2026';
const DATABASE_ID = process.env.FIREBASE_DATABASE_ID || 'ai-studio-recap1062026srts-ff74dc66-bac1-45e8-851d-dcb5797f03e0';

/** True when the Vercel project has the Firebase service account (FIREBASE_SERVICE_ACCOUNT = the JSON, or the JSON base64-encoded). */
export function adminReady(): boolean {
  return !!process.env.FIREBASE_SERVICE_ACCOUNT;
}

function parseAccount(): Record<string, unknown> {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  return JSON.parse(text);
}

let cached: App | null = null;
export function getAdmin() {
  if (!cached) {
    cached = getApps().length ? getApp() : initializeApp({ credential: cert(parseAccount() as Parameters<typeof cert>[0]) });
  }
  return { auth: getAuth(cached), db: getFirestore(cached, DATABASE_ID) };
}
