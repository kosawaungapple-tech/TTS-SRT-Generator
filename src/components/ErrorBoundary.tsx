import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      let errorMessage = 'စနစ်တွင် အမှားတစ်ခု ဖြစ်ပေါ်နေပါသည်။';
      let errorDetail = '';

      try {
        if (this.state.error?.message) {
          const parsedError = JSON.parse(this.state.error.message);
          if (parsedError.error === 'Missing or insufficient permissions.') {
            errorMessage = 'ခွင့်ပြုချက် မရှိပါ။ ကျေးဇူးပြု၍ ပြန်လည်ဝင်ရောက်ကြည့်ပါ။';
            errorDetail = `Operation: ${parsedError.operationType} on ${parsedError.path}`;
          } else {
            errorDetail = parsedError.error || this.state.error.message;
          }
        }
      } catch (e) {
        errorDetail = this.state.error?.message || 'Unknown error';
      }

      return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4 font-sans">
          <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-3xl p-8 shadow-2xl border border-slate-200 dark:border-slate-800 text-center space-y-6">
            <div className="w-20 h-20 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mx-auto border border-red-500/20 shadow-[0_0_20px_rgba(239,68,68,0.2)]">
              <AlertCircle size={40} strokeWidth={1.5} />
            </div>
            
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{errorMessage}</h1>
              <p className="text-slate-500 dark:text-slate-400 text-sm font-mono break-all">{errorDetail}</p>
            </div>

            <button
              onClick={this.handleReset}
              className="w-full py-4 bg-brand-purple hover:bg-brand-purple/90 text-white rounded-2xl font-bold flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg shadow-brand-purple/30"
            >
              <RefreshCw size={20} />
              ပြန်လည်စတင်မည်
            </button>
            
            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-mono uppercase tracking-widest">
              System Error Recovery Protocol
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
