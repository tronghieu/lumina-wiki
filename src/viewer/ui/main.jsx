import { Component } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { STRINGS } from './lib/strings.mjs';

// A render throw must show the load-failure notice, never a blank page.
class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="notice" role="alert">
        <p>{STRINGS.loadFailed}</p>
        <p className="notice-hint">{STRINGS.loadFailedHint}</p>
        <button type="button" className="notice-button" onClick={() => window.location.reload()}>{STRINGS.reload}</button>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
