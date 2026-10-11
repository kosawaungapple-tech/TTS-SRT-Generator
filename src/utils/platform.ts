// Detects the Capacitor native shell (Android/iOS app) without importing the
// Capacitor runtime, so the web build stays lightweight.
export const PRODUCTION_ORIGIN = 'https://tts-srt-generator.vercel.app';

export function isNativeApp(): boolean {
  try {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return !!cap?.isNativePlatform?.();
  } catch {
    return false;
  }
}

/**
 * Inside the native app the bundle is served from https://localhost, so relative
 * `/api/...` calls would hit the app itself. Point them at the hosted backend.
 */
export function installNativeApiBase(): void {
  if (!isNativeApp() || typeof window.fetch !== 'function') return;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      return original(PRODUCTION_ORIGIN + input, init);
    }
    if (input instanceof Request) {
      const u = new URL(input.url);
      if (u.origin === window.location.origin && u.pathname.startsWith('/api/')) {
        return original(new Request(PRODUCTION_ORIGIN + u.pathname + u.search, input), init);
      }
    }
    return original(input, init);
  };
}
