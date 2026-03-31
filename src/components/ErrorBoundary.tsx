import * as React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { safeLocation } from '../utils/safeBrowser';

export class ErrorBoundary extends React.Component<any, any> {
  constructor(props: any) {
    super(props);
    (this as any).state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error('Uncaught error:', error, errorInfo);
  }

  handleReset = () => {
    (this as any).setState({ hasError: false, error: null });
    safeLocation.reload();
  };

  render() {
    const { hasError, error } = (this as any).state;
    if (hasError) {
      let errorMessage = 'An unexpected error occurred.';
      let errorDetail = '';

      try {
        if (error?.message) {
          const parsed = JSON.parse(error.message);
          if (parsed.error) {
            errorMessage = 'Firestore Permission Error';
            errorDetail = `Operation: ${parsed.operationType} on path: ${parsed.path}. Error: ${parsed.error}`;
          }
        }
      } catch (e) {
        errorMessage = error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-slate-50 dark:bg-[#020617] text-slate-900 dark:text-white transition-colors duration-300">
          <div className="w-full max-w-md bg-white/50 backdrop-blur dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 shadow-2xl text-center">
            <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-red-500/20">
              <AlertCircle size={32} />
            </div>
            
            <h2 className="text-2xl font-bold mb-2">{errorMessage}</h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-8">
              {errorDetail || 'Something went wrong while loading the application. Please try refreshing the page.'}
            </p>

            <button
              onClick={this.handleReset}
              className="w-full py-4 bg-brand-purple text-white rounded-2xl font-bold hover:bg-brand-purple/90 transition-all shadow-lg shadow-brand-purple/20 flex items-center justify-center gap-2"
            >
              <RefreshCw size={20} />
              Refresh Application
            </button>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}
