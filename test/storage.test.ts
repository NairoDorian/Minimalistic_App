import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { readStored, writeStored, removeStored } from '../src/lib/storage';

/**
 * `src/lib/storage.ts` exists to make one guarantee: a `localStorage` failure
 * degrades to "not persisted" and never propagates into the render tree. These
 * tests drive both halves of that contract — the working store, and every way
 * the browser can refuse.
 */

const originalLocalStorage = Reflect.get(globalThis, 'localStorage') as Storage | undefined;

/** Installs a minimal in-memory Storage stand-in and returns its backing map. */
function installWorkingStorage(): Map<string, string> {
  const backing = new Map<string, string>();
  Reflect.set(globalThis, 'localStorage', {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => {
      backing.set(key, value);
    },
    removeItem: (key: string) => {
      backing.delete(key);
    },
  } as unknown as Storage);
  return backing;
}

/** Every Storage operation refuses, as in a locked-down browser profile. */
function boom(): never {
  throw new DOMException('The operation is insecure.', 'SecurityError');
}

/** Installs a store where every operation throws. */
function installThrowingStorage(): void {
  Reflect.set(globalThis, 'localStorage', {
    getItem: boom,
    setItem: boom,
    removeItem: boom,
  } as unknown as Storage);
}

/**
 * Removes the global entirely. Touching `localStorage` then throws a
 * ReferenceError rather than a DOMException — a different failure mode that the
 * guard must swallow just the same.
 */
function installMissingStorage(): void {
  Reflect.deleteProperty(globalThis, 'localStorage');
}

afterAll(() => {
  if (originalLocalStorage !== undefined) {
    Reflect.set(globalThis, 'localStorage', originalLocalStorage);
  } else {
    Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

describe('storage helpers — working store', () => {
  let backing: Map<string, string>;

  beforeEach(() => {
    backing = installWorkingStorage();
  });

  it('round-trips a written value', () => {
    expect(writeStored('k', 'v')).toBe(true);
    expect(readStored('k')).toBe('v');
    expect(backing.get('k')).toBe('v');
  });

  it('reports null for a key that was never written', () => {
    expect(readStored('absent')).toBeNull();
  });

  it('removes a key', () => {
    writeStored('k', 'v');
    expect(removeStored('k')).toBe(true);
    expect(readStored('k')).toBeNull();
  });

  it('overwrites rather than appending', () => {
    writeStored('k', 'first');
    writeStored('k', 'second');
    expect(readStored('k')).toBe('second');
    expect(backing.size).toBe(1);
  });

  it('preserves values that look like JSON, empty strings, and unicode', () => {
    for (const value of ['', '{"a":1}', 'null', '⌘+/ 😀']) {
      writeStored('k', value);
      expect(readStored('k')).toBe(value);
    }
  });
});

describe('storage helpers — store that throws', () => {
  beforeEach(() => {
    installThrowingStorage();
  });

  it('reads degrade to null instead of throwing', () => {
    expect(() => readStored('k')).not.toThrow();
    expect(readStored('k')).toBeNull();
  });

  it('writes report failure instead of throwing', () => {
    expect(() => writeStored('k', 'v')).not.toThrow();
    expect(writeStored('k', 'v')).toBe(false);
  });

  it('removals report failure instead of throwing', () => {
    expect(() => removeStored('k')).not.toThrow();
    expect(removeStored('k')).toBe(false);
  });
});

describe('storage helpers — no localStorage global at all', () => {
  beforeEach(() => {
    installMissingStorage();
  });

  it('survives a missing global on every operation', () => {
    expect(readStored('k')).toBeNull();
    expect(writeStored('k', 'v')).toBe(false);
    expect(removeStored('k')).toBe(false);
  });
});
