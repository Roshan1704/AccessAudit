import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  failed: boolean;
}

/** Last-resort screen so an unexpected render error never leaves a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console -- last-resort diagnostics; no logger exists in the browser
    console.error('ui_render_error', error.message, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="quick-wrap" role="alert">
        <h1>Something went wrong</h1>
        <p className="muted">
          The page hit an unexpected error. Your data is safe. Reload to try again.
        </p>
        <button
          type="button"
          className="btn"
          onClick={() => {
            window.location.reload();
          }}
        >
          Reload page
        </button>
      </main>
    );
  }
}
