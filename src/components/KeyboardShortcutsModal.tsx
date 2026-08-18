import { createEffect, type Component } from 'solid-js';
import { Command, X } from '../lib/icons';
import { APP_SHORTCUTS, type KeyboardShortcut } from '../lib/shortcuts';

interface KeyboardShortcutsModalProps {
  isOpen: () => boolean;
  onClose: () => void;
}

/**
 * Keyboard Shortcuts modal cheat sheet with accessible dialog markup.
 * SolidJS 2.0 uses onSettled-like createEffect for focus management;
 * callback refs replace useRef for DOM access.
 */
export const KeyboardShortcutsModal: Component<KeyboardShortcutsModalProps> = (props) => {
  let modalRef: HTMLDivElement | undefined;
  let previouslyFocused: HTMLElement | null = null;

  createEffect(
    () => props.isOpen(),
    (open) => {
      if (!open) return;

      // Remember what had focus before the modal opened so it can be restored on close.
      previouslyFocused = document.activeElement as HTMLElement | null;
      // Move focus into the dialog (the close button) so keyboard users land inside the trap.
      modalRef?.querySelector<HTMLElement>('.modal-close-btn')?.focus();

      const handleKeyDown = (e: KeyboardEvent) => {
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

  const categories: KeyboardShortcut['category'][] = ['Navigation', 'General'];

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
              {categories.map((cat) => {
                const list = APP_SHORTCUTS.filter((s) => s.category === cat);
                if (list.length === 0) return null;

                return (
                  <div class="shortcuts-category-section">
                    <span class="shortcuts-category-title">{cat}</span>
                    <div class="shortcuts-list">
                      {list.map((sc) => (
                        <div class="shortcut-row">
                          <span class="shortcut-desc">{sc.description}</span>
                          <kbd class="shortcut-kbd">{sc.label}</kbd>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
