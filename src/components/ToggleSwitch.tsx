import type { KeyboardEvent, ReactNode } from "react";

interface ToggleSwitchProps {
  /** Icon rendered in the setting row's leading tile. */
  icon: ReactNode;
  /** Bold title label, e.g. "Start at OS launch". */
  title: string;
  /** Muted helper text explaining the setting. */
  subtitle: string;
  /** Current on/off state. */
  checked: boolean;
  /** Accessible name announced by screen readers (same as the visual title). */
  ariaLabel: string;
  /** Called with the new value on user toggle (click, Space, or Enter). */
  onToggle: (newValue: boolean) => void;
}

/**
 * Accessible glassmorphic toggle switch used by the Preferences tab.
 *
 * Accessibility contract:
 * - `role="switch"` + `aria-checked` so screen readers expose on/off semantics.
 * - `tabIndex={0}` on the label makes it keyboard-focusable; Space / Enter
 *   trigger `onToggle` with the inverse value.
 * - The native checkbox stays in the DOM (visually hidden) to drive click
 *   handling and state semantics for assistive tech and form tooling.
 */
export function ToggleSwitch({
  icon,
  title,
  subtitle,
  checked,
  ariaLabel,
  onToggle,
}: ToggleSwitchProps) {
  /** Keyboard activation handler for Space / Enter keys. */
  const handleKeyDown = (e: KeyboardEvent<HTMLLabelElement>) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      onToggle(!checked);
    }
  };

  return (
    <div className="setting-item">
      <div className="setting-info">
        <div className="setting-icon">{icon}</div>
        <div className="setting-text">
          <span className="setting-title">{title}</span>
          <span className="setting-subtitle">{subtitle}</span>
        </div>
      </div>
      <label
        className="switch"
        tabIndex={0}
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        onKeyDown={handleKeyDown}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          tabIndex={-1}
          // Hidden from assistive tech: the label's role="switch" + aria-checked
          // already expose the on/off semantics — without this, screen readers
          // announce the control twice (once as switch, once as checkbox).
          aria-hidden="true"
        />
        <span className="slider"></span>
      </label>
    </div>
  );
}
