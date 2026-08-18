import { Errored } from '@solidjs/web';
import type { JSX } from '@solidjs/web';
import { createSignal } from 'solid-js';
import { AlertOctagon, RotateCcw, Copy, Check } from '../lib/icons';

const handleReload = () => {
  window.location.reload();
};

function ErrorFallback(props: { error: unknown }) {
  const error = props.error instanceof Error ? props.error : new Error(String(props.error));
  const [copied, setCopied] = createSignal(false);

  const handleCopy = async () => {
    const text = [
      '```markdown',
      '# Application Crash Report',
      `- Error: ${error.name}: ${error.message}`,
      `- Stack: ${error.stack ?? 'N/A'}`,
      '```',
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // ignore
    }
  };

  return (
    <div class="error-boundary-screen" role="alert">
      <div class="error-card">
        <div class="error-header">
          <div class="error-icon">
            <AlertOctagon size={24} color="#f43f5e" />
          </div>
          <div>
            <h1 class="error-title">Application Encountered an Error</h1>
            <p class="error-subtitle">
              An unhandled exception occurred in the SolidJS rendering tree.
            </p>
          </div>
        </div>

        <div class="error-details">
          <span class="error-message">
            {error.name}: {error.message}
          </span>
          {error.stack && <pre class="error-stack">{error.stack}</pre>}
        </div>

        <div class="error-actions">
          <button type="button" class="btn-update-secondary" onClick={handleCopy}>
            {copied() ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied() ? 'Copied Details' : 'Copy Crash Log'}</span>
          </button>
          <button type="button" class="btn-update-primary" onClick={handleReload}>
            <RotateCcw size={14} />
            <span>Reload Application</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Top-level error boundary wrapping the application.
 * Uses SolidJS 2.0's <Errored> boundary which replaces React's class-based ErrorBoundary.
 * The fallback receives an error accessor: (err) => err().
 */
export function ErrorBoundary(props: { children: JSX.Element }) {
  return <Errored fallback={(err) => <ErrorFallback error={err()} />}>{props.children}</Errored>;
}
