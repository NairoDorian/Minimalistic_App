import { createSignal, onCleanup, type Component } from 'solid-js';
import { Command, RotateCcw } from '../lib/icons';
import {
  MOD,
  beginHotkeyCapture,
  createKeyboardListener,
  formatHotkey,
  formatHotkeySpec,
  hotkeyFromTrackedEvent,
  hotkeyToString,
  type Hotkey,
} from '../lib/keyboard';

interface HotkeyRecorderProps {
  /** The currently bound spec string, as a signal getter. */
  spec: () => string;
  /** Receives the new canonical spec once a chord is captured. */
  onRecord: (spec: string) => void;
  /** Clears the binding back to its default. Omit to hide the reset button. */
  onReset?: () => void;
  /** Whether a reset is currently meaningful (i.e. an override is in effect). */
  canReset?: () => boolean;
  /** Renders a warning under the control, e.g. a conflicting binding. */
  warning?: (spec: string) => string | null;
  /** Fixed bindings render as a plain, non-interactive label. */
  disabled?: boolean;
  /** Accessible name, e.g. "Rebind: Switch to Preferences tab". */
  ariaLabel: string;
}

/**
 * "Press a shortcut" capture control.
 *
 * While armed it takes over the keyboard through `beginHotkeyCapture()` — the
 * app's global handler bails out for the duration, so pressing the chord being
 * bound doesn't also fire whatever that chord currently does. A side-aware
 * `createKeyboardListener` supplies the live preview and the final chord, so
 * left/right modifiers and modifier-only combinations are captured faithfully.
 *
 * Escape cancels; losing focus cancels; a real (non-modifier) key commits.
 */
export const HotkeyRecorder: Component<HotkeyRecorderProps> = (props) => {
  const [recording, setRecording] = createSignal(false);
  const [preview, setPreview] = createSignal<Hotkey | null>(null);

  let stopCapture: (() => void) | null = null;
  let disposeListener: (() => void) | null = null;

  const endRecording = () => {
    disposeListener?.();
    disposeListener = null;
    stopCapture?.();
    stopCapture = null;
    setPreview(null);
    setRecording(false);
  };

  onCleanup(endRecording);

  const startRecording = () => {
    if (props.disabled === true || recording()) return;

    setRecording(true);
    setPreview(null);
    stopCapture = beginHotkeyCapture();

    const listener = createKeyboardListener(window);
    const unsubscribe = listener.subscribe((event) => {
      // Swallow everything while armed so the chord under capture never reaches
      // the page (Ctrl+/ must not open a browser find bar, Alt must not focus a
      // menu bar, and Tab must not move focus out of the recorder).
      event.domEvent.preventDefault();

      if (!event.isKeyDown) {
        // Releasing back to nothing clears the preview; releasing one modifier
        // of several keeps showing what is still held.
        setPreview(hotkeyFromTrackedEvent(event));
        return;
      }

      if (event.domEvent.key === 'Escape' && event.modifiers === MOD.NONE) {
        endRecording();
        return;
      }

      const hotkey = hotkeyFromTrackedEvent(event);
      setPreview(hotkey);

      // A modifier press only updates the preview; a real key finalizes.
      if (hotkey !== null && hotkey.key !== null) {
        props.onRecord(hotkeyToString(hotkey));
        endRecording();
      }
    });

    disposeListener = () => {
      unsubscribe();
      listener.stop();
    };
  };

  const label = () => {
    if (!recording()) return formatHotkeySpec(props.spec());
    const current = preview();
    return current === null ? 'Press a shortcut…' : formatHotkey(current);
  };

  const warningText = () => props.warning?.(props.spec()) ?? null;

  return (
    <div class="hotkey-recorder">
      <div class="hotkey-recorder-row">
        <button
          type="button"
          class={`hotkey-recorder-btn ${recording() ? 'recording' : ''}`}
          onClick={startRecording}
          onBlur={endRecording}
          disabled={props.disabled === true}
          aria-label={props.ariaLabel}
          aria-live="polite"
          title={
            props.disabled === true
              ? 'This shortcut is fixed and cannot be changed'
              : 'Click, then press the key combination to bind'
          }
        >
          {recording() && <Command size={11} />}
          <kbd class="shortcut-kbd">{label()}</kbd>
        </button>

        {props.onReset && (
          <button
            type="button"
            class="hotkey-recorder-reset"
            onClick={() => props.onReset?.()}
            disabled={props.canReset?.() !== true}
            aria-label={`Reset to default — ${props.ariaLabel}`}
            title="Reset to the default binding"
          >
            <RotateCcw size={11} />
          </button>
        )}
      </div>

      {warningText() !== null && <span class="hotkey-recorder-warning">{warningText()}</span>}
    </div>
  );
};
