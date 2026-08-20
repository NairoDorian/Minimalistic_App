import { createSignal, onSettled, For, type Component } from 'solid-js';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from '../lib/icons';
import { subscribeToasts, removeToast, type ToastItem, type ToastType } from '../lib/toast';

const TOAST_ICONS: Record<
  ToastType,
  Component<{ size?: number; color?: string; class?: string }>
> = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

/**
 * Individual toast notification with an auto-dismiss timer.
 *
 * The draining progress bar is a pure CSS animation whose duration is bound to
 * the toast's lifetime, so the timeline is driven by the compositor rather than
 * by a 20 Hz timer re-rendering the DOM for every visible toast.
 */
const ToastEntry: Component<{ item: ToastItem }> = (props) => {
  const Icon = TOAST_ICONS[props.item.type];

  onSettled(() => {
    const timer = setTimeout(() => removeToast(props.item.id), props.item.durationMs);
    return () => clearTimeout(timer);
  });

  return (
    <div
      class={`toast-item toast-${props.item.type}`}
      role={props.item.type === 'error' ? 'alert' : 'status'}
      aria-live={props.item.type === 'error' ? 'assertive' : 'polite'}
    >
      <div class="toast-content">
        <Icon size={16} class="toast-icon" />
        <span class="toast-message">{props.item.message}</span>
        <button
          type="button"
          class="toast-close"
          onClick={() => removeToast(props.item.id)}
          aria-label="Dismiss notification"
        >
          <X size={12} />
        </button>
      </div>
      <div class="toast-progress-track">
        <div
          class="toast-progress-fill"
          style={{ 'animation-duration': `${props.item.durationMs}ms` }}
        />
      </div>
    </div>
  );
};

/**
 * Toast Container component rendered near the root of the app.
 * Subscribes to the module-level toast event bus (src/lib/toast.ts).
 */
export function ToastContainer() {
  const [items, setItems] = createSignal<ToastItem[]>([]);

  onSettled(() => {
    return subscribeToasts(setItems);
  });

  return (
    <>
      {items().length > 0 && (
        <div class="toast-container" aria-label="Notifications">
          <For each={items()} keyed>
            {(item) => <ToastEntry item={item} />}
          </For>
        </div>
      )}
    </>
  );
}
