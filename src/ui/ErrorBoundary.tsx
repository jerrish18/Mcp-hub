import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'An unexpected application error occurred.',
    };
  }

  override componentDidCatch(error: Error) {
    console.error('MCP Hub ErrorBoundary caught:', error.message);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div
          style={{ backgroundColor: 'var(--m3-surface)' }}
          className="h-dvh flex items-center justify-center p-6"
        >
          <div
            style={{
              backgroundColor: 'var(--m3-surface-container)',
              borderColor: 'var(--m3-outline)',
            }}
            className="w-full max-w-md rounded-[28px] border p-6 text-center space-y-4 shadow-xl"
          >
            <div className="w-14 h-14 rounded-2xl bg-rose-500/15 text-rose-500 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <div className="space-y-1.5">
              <h1 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                Something went wrong
              </h1>
              <p className="text-xs text-slate-600 dark:text-slate-400 break-words">
                {this.state.message}
              </p>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                backgroundColor: 'var(--m3-primary)',
                color: 'var(--m3-on-primary)',
              }}
              className="min-h-[44px] px-5 rounded-full text-sm font-semibold inline-flex items-center gap-2 transition-opacity hover:opacity-90"
            >
              <RotateCcw className="w-4 h-4" />
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
