import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  checkNotificationPermission,
  requestNotificationPermission,
  sendAppNotification,
  sendOsNotification,
} from '../src/lib/notification';
import { APP_NAME } from '../src/lib/appMeta';
import { clearAllToasts, subscribeToasts, type ToastItem } from '../src/lib/toast';

/**
 * These tests run outside Tauri (`isTauri` is false in the Bun process), so
 * they exercise the web transport and the toast fallback. The native transport
 * is the same code path with the plugin substituted for the browser API, which
 * is why the permission handling lives in one module in the first place.
 */

describe('Cross-Platform Notification Service', () => {
  let capturedToasts: ToastItem[] = [];
  let unsubscribeToast: (() => void) | null = null;
  const originalNotification = (globalThis as unknown as { Notification?: unknown }).Notification;

  beforeEach(() => {
    clearAllToasts();
    capturedToasts = [];
    unsubscribeToast = subscribeToasts((list) => {
      capturedToasts = list;
    });
  });

  afterEach(() => {
    if (unsubscribeToast) {
      unsubscribeToast();
      unsubscribeToast = null;
    }
    clearAllToasts();
    if (originalNotification !== undefined) {
      (globalThis as unknown as { Notification: unknown }).Notification = originalNotification;
    } else {
      delete (globalThis as unknown as { Notification?: unknown }).Notification;
    }
  });

  describe('permission inspection', () => {
    it('returns unsupported when window.Notification is absent in web/test environment', async () => {
      delete (globalThis as unknown as { Notification?: unknown }).Notification;
      const perm = await checkNotificationPermission();
      expect(perm).toBe('unsupported');
    });

    it('returns the permission value when Notification API exists', async () => {
      (globalThis as unknown as { Notification: unknown }).Notification = {
        permission: 'granted',
      };
      const perm = await checkNotificationPermission();
      expect(perm).toBe('granted');
    });

    it('returns denied when Notification API reports denied', async () => {
      (globalThis as unknown as { Notification: unknown }).Notification = {
        permission: 'denied',
      };
      const perm = await checkNotificationPermission();
      expect(perm).toBe('denied');
    });
  });

  describe('requesting permission', () => {
    it('returns unsupported when Notification global is absent', async () => {
      delete (globalThis as unknown as { Notification?: unknown }).Notification;
      const perm = await requestNotificationPermission();
      expect(perm).toBe('unsupported');
    });

    it('delegates to Notification.requestPermission when present', async () => {
      (globalThis as unknown as { Notification: unknown }).Notification = {
        permission: 'default',
        requestPermission: async () => 'granted',
      };
      const perm = await requestNotificationPermission();
      expect(perm).toBe('granted');
    });
  });

  describe('sending notifications', () => {
    it('falls back to toast notification when Notification is unsupported', async () => {
      delete (globalThis as unknown as { Notification?: unknown }).Notification;

      const result = await sendAppNotification({
        title: 'Test Notification',
        body: 'Payload message body',
      });

      expect(result.success).toBe(true);
      expect(result.deliveredVia).toBe('toast-fallback');
      expect(result.permission).toBe('unsupported');
      expect(capturedToasts.length).toBeGreaterThan(0);
      expect(capturedToasts[0]?.message).toContain('Test Notification');
      expect(capturedToasts[0]?.message).toContain('Payload message body');
    });

    it('accepts a bare string message and defaults title', async () => {
      delete (globalThis as unknown as { Notification?: unknown }).Notification;

      const result = await sendAppNotification('Bare string notification');

      expect(result.success).toBe(true);
      expect(result.deliveredVia).toBe('toast-fallback');
      expect(capturedToasts.length).toBeGreaterThan(0);
      expect(capturedToasts[0]?.message).toContain('Bare string notification');
    });

    it('uses Web Notification API when granted in browser environment', async () => {
      let createdTitle = '';
      let createdBody = '';

      class MockNotification {
        static permission = 'granted';
        static async requestPermission() {
          return 'granted';
        }
        constructor(title: string, options?: { body?: string }) {
          createdTitle = title;
          createdBody = options?.body ?? '';
        }
      }

      (globalThis as unknown as { Notification: unknown }).Notification = MockNotification;

      const result = await sendAppNotification({
        title: 'Web Title',
        body: 'Web Body Content',
      });

      expect(result.success).toBe(true);
      expect(result.deliveredVia).toBe('web-api');
      expect(result.permission).toBe('granted');
      expect(createdTitle).toBe('Web Title');
      expect(createdBody).toBe('Web Body Content');
      // The OS took it, so no toast was shown.
      expect(capturedToasts).toHaveLength(0);
    });

    it('asks for permission once when it is undecided, then delivers', async () => {
      let prompts = 0;
      let created = 0;

      class MockNotification {
        static permission = 'default';
        static async requestPermission() {
          prompts += 1;
          MockNotification.permission = 'granted';
          return 'granted';
        }
        constructor() {
          created += 1;
        }
      }

      (globalThis as unknown as { Notification: unknown }).Notification = MockNotification;

      const result = await sendAppNotification({ title: 'Ask first', body: 'then send' });

      expect(prompts).toBe(1);
      expect(created).toBe(1);
      expect(result.deliveredVia).toBe('web-api');
    });

    it('falls back to a toast when permission is denied, and never prompts again', async () => {
      let prompts = 0;

      class MockNotification {
        static permission = 'denied';
        static async requestPermission() {
          prompts += 1;
          return 'denied';
        }
        constructor() {
          throw new Error('a denied notification must never be constructed');
        }
      }

      (globalThis as unknown as { Notification: unknown }).Notification = MockNotification;

      const result = await sendAppNotification({ title: 'Denied', body: 'quietly' });

      // A recorded denial is final: re-prompting on every send would be the
      // browser-hostile behaviour this module exists to avoid.
      expect(prompts).toBe(0);
      expect(result.deliveredVia).toBe('toast-fallback');
      expect(result.permission).toBe('denied');
      expect(capturedToasts[0]?.message).toBe('[Denied] quietly');
    });

    it('defaults a blank title to the product name', async () => {
      delete (globalThis as unknown as { Notification?: unknown }).Notification;

      await sendAppNotification({ title: '   ', body: 'no title given' });

      expect(capturedToasts[0]?.message).toBe(`[${APP_NAME}] no title given`);
    });
  });

  describe('sendOsNotification (no in-app fallback)', () => {
    it('resolves false and shows no toast when notifications are unsupported', async () => {
      // The update checker calls this while the window is hidden: a toast
      // there would be drawn for nobody, so "not delivered" must be the answer
      // rather than a fallback that looks like success.
      delete (globalThis as unknown as { Notification?: unknown }).Notification;

      const delivered = await sendOsNotification({ title: 'Update', body: 'v9 is ready' });

      expect(delivered).toBe(false);
      expect(capturedToasts).toHaveLength(0);
    });

    it('resolves true when the browser API accepted the notification', async () => {
      let created = 0;

      class MockNotification {
        static permission = 'granted';
        static async requestPermission() {
          return 'granted';
        }
        constructor() {
          created += 1;
        }
      }

      (globalThis as unknown as { Notification: unknown }).Notification = MockNotification;

      expect(await sendOsNotification('Body only')).toBe(true);
      expect(created).toBe(1);
      expect(capturedToasts).toHaveLength(0);
    });

    it('resolves false when constructing the notification throws', async () => {
      class MockNotification {
        static permission = 'granted';
        static async requestPermission() {
          return 'granted';
        }
        constructor() {
          throw new Error('engine refused');
        }
      }

      (globalThis as unknown as { Notification: unknown }).Notification = MockNotification;

      expect(await sendOsNotification({ body: 'boom' })).toBe(false);
      expect(capturedToasts).toHaveLength(0);
    });
  });
});
