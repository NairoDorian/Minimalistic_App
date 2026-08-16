import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertOctagon, RotateCcw, Copy, Check } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

/**
 * Top-level React 19 Error Boundary with a sleek glassmorphic crash card.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error('Unhandled Application Error:', error, errorInfo);
  }

  handleCopy = async () => {
    const { error, errorInfo } = this.state;
    const text = [
      '```markdown',
      '# Application Crash Report',
      `- Error: ${error?.name}: ${error?.message}`,
      `- Stack: ${error?.stack ?? 'N/A'}`,
      `- Component Stack: ${errorInfo?.componentStack ?? 'N/A'}`,
      '```',
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2500);
    } catch {
      // ignore
    }
  };

  handleReload = () => {
    window.location.reload();
  };

  override render() {
    const { hasError, error, copied } = this.state;
    const { children, fallback } = this.props;

    if (hasError) {
      if (fallback) return fallback;

      return (
        <div className="error-boundary-screen" role="alert">
          <div className="error-card">
            <div className="error-header">
              <div className="error-icon">
                <AlertOctagon size={24} color="#f43f5e" />
              </div>
              <div>
                <h1 className="error-title">Application Encountered an Error</h1>
                <p className="error-subtitle">
                  An unhandled exception occurred in the React rendering tree.
                </p>
              </div>
            </div>

            <div className="error-details">
              <span className="error-message">
                {error?.name}: {error?.message}
              </span>
              {error?.stack && <pre className="error-stack">{error.stack}</pre>}
            </div>

            <div className="error-actions">
              <button type="button" className="btn-update-secondary" onClick={this.handleCopy}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{copied ? 'Copied Details' : 'Copy Crash Log'}</span>
              </button>
              <button type="button" className="btn-update-primary" onClick={this.handleReload}>
                <RotateCcw size={14} />
                <span>Reload Application</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return children;
  }
}
