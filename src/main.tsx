import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LanguageProvider } from './contexts/LanguageContext';
import { installNativeApiBase } from './utils/platform';

// After a new deploy, a tab that is still open asks for page chunks that no longer exist ("Failed to fetch dynamically
// imported module"). Reload once to pick up the new version; the guard stops a reload loop if the problem is something else.
export function reloadOnceForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem('vbs_chunk_reload') || 0);
    if (Date.now() - last < 30000) return false;
    sessionStorage.setItem('vbs_chunk_reload', String(Date.now()));
  } catch { /* storage unavailable: reload anyway */ }
  window.location.reload();
  return true;
}
window.addEventListener('vite:preloadError', e => { e.preventDefault(); reloadOnceForNewVersion(); });


installNativeApiBase();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </ErrorBoundary>
  </StrictMode>,
);
