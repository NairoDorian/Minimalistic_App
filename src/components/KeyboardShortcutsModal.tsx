import { useEffect, useRef, type FC } from 'react';
import { Command, X } from 'lucide-react';
import { APP_SHORTCUTS, type KeyboardShortcut } from '../lib/shortcuts';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Keyboard Shortcuts modal cheat sheet with accessible dialog markup.
 */
export const KeyboardShortcutsModal: FC<KeyboardShortcutsModalProps> = ({ isOpen, onClose }) => {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const categories: KeyboardShortcut['category'][] = ['Navigation', 'General'];

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-modal-title"
        ref={modalRef}
      >
        <div className="modal-header">
          <div className="modal-title-row">
            <Command size={18} color="var(--accent-cyan)" />
            <h2 id="shortcuts-modal-title" className="modal-title">
              Keyboard Shortcuts
            </h2>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close shortcuts dialog"
          >
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          {categories.map((cat) => {
            const list = APP_SHORTCUTS.filter((s) => s.category === cat);
            if (list.length === 0) return null;

            return (
              <div key={cat} className="shortcuts-category-section">
                <span className="shortcuts-category-title">{cat}</span>
                <div className="shortcuts-list">
                  {list.map((sc) => (
                    <div key={sc.label} className="shortcut-row">
                      <span className="shortcut-desc">{sc.description}</span>
                      <kbd className="shortcut-kbd">{sc.label}</kbd>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
