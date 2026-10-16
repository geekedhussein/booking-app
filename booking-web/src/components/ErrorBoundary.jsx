import { Component } from 'react';

/** Last line of defence: a render error shows a recoverable screen, not a blank page. */
export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Render error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="crash">
        <h1>This page stopped working</h1>
        <p>Reload to try again. If it keeps happening, the problem is on our side.</p>
        <button className="btn btn--primary btn--md" onClick={() => window.location.reload()}>
          <span className="btn__label">Reload page</span>
        </button>
      </main>
    );
  }
}
