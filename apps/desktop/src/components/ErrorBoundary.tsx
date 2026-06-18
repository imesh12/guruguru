import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      error,
    };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Kurukuru Monitor frontend crashed.', error, errorInfo);
    const payload = {
      route: window.location.hash,
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
      componentStack: errorInfo.componentStack,
    };
    console.info('[wall-debug] ErrorBoundary crash', payload);
    try {
      window.electronAPI?.wallDebugLog?.('[wall-debug] ErrorBoundary crash', payload);
    } catch (bridgeError) {
      console.error('[wall-debug] ErrorBoundary wallDebugLog failed', bridgeError);
    }
  }

  private reload = () => {
    window.location.reload();
  };

  override render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 px-6 py-8 text-slate-900">
        <div className="w-full max-w-2xl rounded-2xl border border-rose-300 bg-white p-8 shadow-sm">
          <p className="text-[16px] font-semibold text-rose-700">画面エラー</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">操作画面で予期しないエラーが発生しました。</h1>
          <p className="mt-4 text-[16px] leading-7 text-slate-700">
            画面を再読み込みしてください。再発する場合は、API復旧後にシステム状態画面から診断情報を出力してください。
          </p>
          <pre className="mt-6 overflow-x-auto rounded-2xl border border-slate-300 bg-slate-100 p-4 text-[14px] text-slate-800">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={this.reload}
            className="mt-6 min-h-12 rounded-xl border border-slate-400 bg-slate-900 px-5 py-3 text-[16px] font-semibold text-white"
          >
            再読み込み
          </button>
        </div>
      </main>
    );
  }
}
