/**
 * Global Keyboard Shortcuts Definition & Utilities.
 */

export interface KeyboardShortcut {
  key: string;
  ctrlOrCmd?: boolean;
  shift?: boolean;
  alt?: boolean;
  label: string;
  description: string;
  category: 'Navigation' | 'Actions' | 'General';
}

export const APP_SHORTCUTS: readonly KeyboardShortcut[] = [
  {
    key: '1',
    ctrlOrCmd: true,
    label: 'Ctrl+1 / Cmd+1',
    description: 'Switch to Preferences tab',
    category: 'Navigation',
  },
  {
    key: '2',
    ctrlOrCmd: true,
    label: 'Ctrl+2 / Cmd+2',
    description: 'Switch to System & About tab',
    category: 'Navigation',
  },
  {
    key: '3',
    ctrlOrCmd: true,
    label: 'Ctrl+3 / Cmd+3',
    description: 'Switch to Developer Hub tab',
    category: 'Navigation',
  },
  {
    key: ',',
    ctrlOrCmd: true,
    label: 'Ctrl+, / Cmd+,',
    description: 'Open Preferences',
    category: 'Navigation',
  },
  {
    key: '/',
    ctrlOrCmd: true,
    label: 'Ctrl+/ / Cmd+/',
    description: 'Show Keyboard Shortcuts cheat sheet',
    category: 'General',
  },
  {
    key: '?',
    label: '?',
    description: 'Show Keyboard Shortcuts cheat sheet',
    category: 'General',
  },
  {
    key: 'Escape',
    label: 'Esc',
    description: 'Close active modal / dialog',
    category: 'General',
  },
];
