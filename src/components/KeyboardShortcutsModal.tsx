import { createEffect, createSignal, onSettled, type Component } from 'solid-js';
import { Command, RotateCcw, X } from '../lib/icons';
import {
  APP_SHORTCUTS,
  SHORTCUT_CATEGORIES,
  findShortcutConflicts,
  getShortcutSpec,
  isShortcutOverridden,
  resetShortcuts,
  setShortcutSpec,
  subscribeShortcuts,
  type ShortcutId,
} from '../lib/shortcuts';
import { isCapturingHotkey } from '../lib/keyboard';
import { HotkeyRecorder } from './HotkeyRecorder';
import { toast } from '../lib/toast';

interface KeyboardShortcutsModalProps {
  isOpen: () => boolean;
  onClose: () => void;
}

/** Applies a captured chord, reporting rejection or an overlapping binding. */
function applyRebind(id: ShortcutId, spec: string): void {
  if (!setShortcutSpec(id, spec)) {
    toast.error('That key combination cannot be used as a shortcut');
    return;
  }
  const conflicts = findShortcutConflicts(id, spec);
  if (conflicts.length > 0) {
    toast.warning(`Shortcut also bound to: ${conflicts.map((sc) => sc.description).join(', ')}`);
  } else {
    toast.success('Shortcut updated');
  }
}

/**
 * Keyboard shortcuts cheat sheet and rebinding surface.
 *
 * Every row is a live `HotkeyRecorder`, so the sheet documents the shortcuts
 * and changes them in the same place — the list can never drift from what the
 * app actually listens for, because both read the same registry.
 */
export const KeyboardShortcutsModal: Component<KeyboardShortcutsModalProps> = (props) => {
  let modalRef: HTMLDivElement | undefined;
  let previouslyFocused: HTMLElement | null = null;

  // Bindings live in a module-level store; this counter republishes them into
  // the reactive graph so labels update the moment a shortcut is rebound.
  const [revision, setRevision] = createSignal(0);
  onSettled(() => subscribeShortcuts(() => setRevision((n) => n + 1)));

  const specOf = (id: ShortcutId): string => {
    revision();
    return getShortcutSpec(id);
  };
  const overriddenOf = (id: ShortcutId): boolean => {
    revision();
    return isShortcutOverridden(id);
  };
  const conflictOf = (id: ShortcutId): string | null => {
    const conflicts = findShortcutConflicts(id, specOf(id));
    if (conflicts.length === 0) return null;
    return `Also bound to: ${conflicts.map((sc) => sc.description).join(', ')}`;
  };

  createEffect(
    () => props.isOpen(),
    (open) => {
      if (!open) return;

      // Remember what had focus before the modal opened so it can be restored on close.
      previouslyFocused = document.activeElement as HTMLElement | null;
      // Move focus into the dialog (the close button) so keyboard users land inside the trap.
      modalRef?.querySelector<HTMLElement>('.modal-close-btn')?.focus();

      const handleKeyDown = (e: KeyboardEvent) => {
        // A recorder owns the keyboard while it is armed — Escape must cancel
        // the capture, not close the dialog out from under it.
        if (isCapturingHotkey()) return;

        if (e.key === 'Escape') {
          e.preventDefault();
          props.onClose();
          return;
        }

        // Focus trap: cycle focus within the dialog, wrapping at both ends so
        // Tab can never escape into the background page.
        if (e.key === 'Tab') {
          const dialog = modalRef;
          if (!dialog) return;
          const focusables = Array.from(
            dialog.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            )
          ).filter((el) => !el.hasAttribute('disabled'));
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (first === undefined || last === undefined) return;
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        previouslyFocused?.focus();
      };
    }
  );

  return (
    <>
      {props.isOpen() && (
        <div
          class="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) props.onClose();
          }}
          role="presentation"
        >
          <div
            class="modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcuts-modal-title"
            aria-describedby="shortcuts-modal-desc"
            ref={(el) => (modalRef = el)}
          >
            <div class="modal-header">
              <div class="modal-title-row">
                <Command size={18} color="var(--accent-cyan)" />
                <h2 id="shortcuts-modal-title" class="modal-title">
                  Keyboard Shortcuts
                </h2>
              </div>
              <button
                type="button"
                class="modal-close-btn"
                onClick={props.onClose}
                aria-label="Close shortcuts dialog"
              >
                <X size={14} />
              </button>
            </div>

            <div class="modal-body" id="shortcuts-modal-desc">
              <p class="shortcuts-hint">
                Click a shortcut and press the key combination you want. Bindings are stored per
                machine and shown using this platform's conventions.
              </p>

              {SHORTCUT_CATEGORIES.map((cat) => {
                const list = APP_SHORTCUTS.filter((s) => s.category === cat);
                if (list.length === 0) return null;

                return (
                  <div class="shortcuts-category-section">
                    <span class="shortcuts-category-title">{cat}</span>
                    <div class="shortcuts-list">
                      {list.map((sc) => (
                        <div class="shortcut-row">
                          <span class="shortcut-desc">{sc.description}</span>
                          <HotkeyRecorder
                            ariaLabel={`Rebind: ${sc.description}`}
                            spec={() => specOf(sc.id)}
                            disabled={sc.fixed === true}
                            canReset={() => overriddenOf(sc.id)}
                            warning={() => conflictOf(sc.id)}
                            onRecord={(spec) => applyRebind(sc.id, spec)}
                            onReset={() => setShortcutSpec(sc.id, null)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div class="modal-footer">
              <button
                type="button"
                class="btn-update-secondary"
                onClick={() => {
                  resetShortcuts();
                  toast.info('All shortcuts restored to defaults');
                }}
                disabled={!APP_SHORTCUTS.some((sc) => overriddenOf(sc.id))}
              >
                <RotateCcw size={13} />
                <span>Reset All Shortcuts</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
