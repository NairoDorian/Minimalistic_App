import { type Component } from 'solid-js';
import type { JSX } from '@solidjs/web';

export interface ToggleSwitchProps {
  /** Icon rendered in the setting row's leading tile. */
  icon: JSX.Element;
  /** Bold title label, e.g. "Start at OS launch". */
  title: string;
  /** Muted helper text explaining the setting. */
  subtitle: string;
  /** Current on/off state — passed as a signal getter for reactivity. */
  checked: () => boolean;
  /** Accessible name announced by screen readers (same as the visual title). */
  ariaLabel: string;
  /** Whether the switch is disabled / non-interactive. */
  disabled?: boolean;
  /** Called with the new value on user toggle (click, Space, or Enter). */
  onToggle: (newValue: boolean) => void;
}

/**
 * Accessible glassmorphic toggle switch used by the Preferences tab.
 *
 * Accessibility contract:
 * - `role="switch"` + `aria-checked` + `aria-disabled` so screen readers expose on/off and enabled/disabled semantics.
 * - `tabIndex={disabled ? -1 : 0}` on the label makes it keyboard-focusable only when active; Space / Enter
 *   trigger `onToggle` with the inverse value.
 * - The native checkbox stays in the DOM (visually hidden) to drive click
 *   handling and state semantics for assistive tech and form tooling.
 */
export const ToggleSwitch: Component<ToggleSwitchProps> = (props) => {
  /** Keyboard activation handler for Space / Enter keys. */
  const handleKeyDown = (e: KeyboardEvent) => {
    if (props.disabled) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      props.onToggle(!props.checked());
    }
  };

  return (
    <div class={`setting-item ${props.disabled ? 'disabled' : ''}`}>
      <div class="setting-info">
        <div class="setting-icon">{props.icon}</div>
        <div class="setting-text">
          <span class="setting-title">{props.title}</span>
          <span class="setting-subtitle">{props.subtitle}</span>
        </div>
      </div>
      <label
        class={`switch ${props.disabled ? 'disabled' : ''}`}
        tabindex={props.disabled ? -1 : 0}
        role="switch"
        aria-checked={props.checked() ? 'true' : 'false'}
        aria-disabled={props.disabled ? 'true' : 'false'}
        aria-label={props.ariaLabel}
        onKeyDown={handleKeyDown}
      >
        <input
          type="checkbox"
          checked={props.checked()}
          disabled={props.disabled}
          onChange={(e) => {
            if (!props.disabled) props.onToggle(e.currentTarget.checked);
          }}
          tabindex={-1}
          aria-hidden="true"
        />
        <span class="slider"></span>
      </label>
    </div>
  );
};
