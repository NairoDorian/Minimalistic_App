import { useState, useEffect, type FC } from 'react';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';
import { subscribeToasts, removeToast, type ToastItem, type ToastType } from '../lib/toast';

const TOAST_ICONS: Record<ToastType, FC<{ size?: number; color?: string; className?: string }>> = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

/** Individual Toast Notification View with auto-dismiss progress timer */
const ToastEntry: FC<{ item: ToastItem }> = ({ item }) => {
  const [progress, setProgress] = useState(100);
  const Icon = TOAST_ICONS[item.type];

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remainingPct = Math.max(0, 100 - (elapsed / item.durationMs) * 100);
      setProgress(remainingPct);

      if (elapsed >= item.durationMs) {
        clearInterval(interval);
        removeToast(item.id);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [item.id, item.durationMs]);

  return (
    <div
      className={`toast-item toast-${item.type}`}
      role={item.type === 'error' ? 'alert' : 'status'}
      aria-live={item.type === 'error' ? 'assertive' : 'polite'}
    >
      <div className="toast-content">
        <Icon size={16} className="toast-icon" />
        <span className="toast-message">{item.message}</span>
        <button
          type="button"
          className="toast-close"
          onClick={() => removeToast(item.id)}
          aria-label="Dismiss notification"
        >
          <X size={12} />
        </button>
      </div>
      <div className="toast-progress-track">
        <div className="toast-progress-fill" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
};

/**
 * Toast Container component rendered near the root of the app.
 */
export function ToastContainer() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    return subscribeToasts(setItems);
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="toast-container" aria-label="Notifications">
      {items.map((item) => (
        <ToastEntry key={item.id} item={item} />
      ))}
    </div>
  );
}
