import React from 'react';
import { logEvent } from '../lib/firebase.js';
import { getSnapshots } from '../../tools/bug-hunting/stateSnapshot.js';
import { saveCrash } from '../../tools/bug-hunting/crashStorage.js';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, copied: false };
    this.lastReportRef = React.createRef();
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error);
    console.error('[ErrorBoundary] Component stack:', errorInfo?.componentStack);

    const report = {
      message: error?.message ?? String(error),
      stack: error?.stack?.slice(0, 4000),
      componentStack: errorInfo?.componentStack?.slice(0, 4000),
      url: typeof window !== 'undefined' ? window.location.href : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      snapshots: getSnapshots(),
    };
    this.lastReportRef.current = report;

    // Persistent local capture for matgrind-crash-triage skill.
    saveCrash(report);

    // Existing Firebase Analytics breadcrumb (kept for parity).
    logEvent('app_crash', {
      error_message: error?.message?.slice(0, 100),
      component_stack: errorInfo?.componentStack?.slice(0, 200),
    });
  }

  componentWillUnmount() {
    if (this._copyTimer) clearTimeout(this._copyTimer);
  }

  handleCopy = async () => {
    const report = this.lastReportRef.current;
    if (!report) return;
    const text = JSON.stringify(report, null, 2);
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Capacitor WebView fallback. document.execCommand('copy') is
        // deprecated but still the only thing that works in some older
        // WKWebView/WebView contexts where the Clipboard API isn't
        // exposed.
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        try {
          ta.select();
          const ok = document.execCommand('copy');
          if (!ok) throw new Error('execCommand copy returned false');
        } finally {
          document.body.removeChild(ta);
        }
      }
      if (this._copyTimer) clearTimeout(this._copyTimer);
      this.setState({ copied: true });
      this._copyTimer = setTimeout(() => {
        this._copyTimer = null;
        this.setState({ copied: false });
      }, 2000);
    } catch (e) {
      console.warn('[ErrorBoundary] Copy failed:', e);
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 max-w-sm w-full text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
              <span className="text-red-400 text-2xl font-black">!</span>
            </div>
            <h2 className="text-white font-bold text-lg">Something Went Wrong</h2>
            <p className="text-zinc-400 text-sm">
              An unexpected error occurred. You can try returning to the menu or reloading the app.
            </p>
            {this.state.error?.message && (
              <p className="text-zinc-600 text-xs font-mono bg-zinc-800 rounded px-3 py-2 break-all">
                {this.state.error.message}
              </p>
            )}
            <div className="flex flex-col gap-2 pt-2">
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => {
                    this.props.onReturnToMenu?.();
                    this.setState({ hasError: false, error: null });
                  }}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold rounded-lg text-sm transition-colors"
                >
                  Return to Menu
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-black font-bold rounded-lg text-sm transition-colors"
                >
                  Reload App
                </button>
              </div>
              <button
                onClick={this.handleCopy}
                className="px-4 py-2 bg-zinc-800/60 hover:bg-zinc-700 text-zinc-400 font-medium rounded-lg text-xs transition-colors"
              >
                {this.state.copied ? 'Copied!' : 'Copy Crash Report'}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
