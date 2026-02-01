/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createMobileSupport,
  type MobileSupportHandle,
  type MobileSupportCallbacks,
} from '../../src/chatView/mobileSupport';
import type { ModuleDeps } from '../../src/chatView/types';

// Mock Obsidian
vi.mock('obsidian', () => ({
  setIcon: vi.fn(),
}));

// Extend HTMLElement with Obsidian's createDiv/createEl/createSpan methods
declare global {
  interface HTMLElement {
    createDiv(cls?: string): HTMLDivElement;
    createEl<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      options?: { cls?: string; attr?: Record<string, string>; text?: string }
    ): HTMLElementTagNameMap[K];
    createSpan(cls?: string): HTMLSpanElement;
  }
}

HTMLElement.prototype.createDiv = function (cls?: string): HTMLDivElement {
  const div = document.createElement('div');
  if (cls) div.className = cls;
  this.appendChild(div);
  return div;
};

HTMLElement.prototype.createEl = function <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: { cls?: string; attr?: Record<string, string>; text?: string }
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (options?.cls) el.className = options.cls;
  if (options?.attr) {
    for (const [key, value] of Object.entries(options.attr)) {
      el.setAttribute(key, value);
    }
  }
  if (options?.text) el.textContent = options.text;
  this.appendChild(el);
  return el;
};

HTMLElement.prototype.createSpan = function (cls?: string): HTMLSpanElement {
  const span = document.createElement('span');
  if (cls) span.className = cls;
  this.appendChild(span);
  return span;
};

describe('MobileSupport', () => {
  let container: HTMLElement;
  let deps: ModuleDeps;
  let callbacks: MobileSupportCallbacks;
  let handle: MobileSupportHandle;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    deps = {
      app: {} as ModuleDeps['app'],
      plugin: {} as ModuleDeps['plugin'],
    };
    callbacks = {
      onNewConversation: vi.fn(),
      onSwipeLeft: vi.fn(),
      onSwipeRight: vi.fn(),
      isMobile: vi.fn(() => false),
    };
  });

  afterEach(() => {
    handle?.destroy();
    container.remove();
  });

  describe('FAB creation', () => {
    it('should not create FAB on desktop', () => {
      callbacks.isMobile = vi.fn(() => false);
      handle = createMobileSupport(container, deps, callbacks);
      expect(container.querySelector('.mobile-fab')).toBeNull();
    });

    it('should create FAB on mobile', () => {
      callbacks.isMobile = vi.fn(() => true);
      handle = createMobileSupport(container, deps, callbacks);
      expect(container.querySelector('.mobile-fab')).not.toBeNull();
    });

    it('should set aria-label on FAB', () => {
      callbacks.isMobile = vi.fn(() => true);
      handle = createMobileSupport(container, deps, callbacks);
      const fab = container.querySelector('.mobile-fab') as HTMLElement;
      expect(fab.getAttribute('aria-label')).toBe('New conversation');
    });

    it('should call onNewConversation when FAB is clicked', () => {
      callbacks.isMobile = vi.fn(() => true);
      handle = createMobileSupport(container, deps, callbacks);
      const fab = container.querySelector('.mobile-fab') as HTMLElement;
      fab.click();
      expect(callbacks.onNewConversation).toHaveBeenCalled();
    });
  });

  describe('platform detection', () => {
    it('should return false when isMobile callback returns false', () => {
      callbacks.isMobile = vi.fn(() => false);
      handle = createMobileSupport(container, deps, callbacks);
      expect(handle.isMobile()).toBe(false);
    });

    it('should return true when isMobile callback returns true', () => {
      callbacks.isMobile = vi.fn(() => true);
      handle = createMobileSupport(container, deps, callbacks);
      expect(handle.isMobile()).toBe(true);
    });

    it('should delegate to callback each time isMobile is called', () => {
      let mobile = false;
      callbacks.isMobile = vi.fn(() => mobile);
      handle = createMobileSupport(container, deps, callbacks);
      expect(handle.isMobile()).toBe(false);
      mobile = true;
      expect(handle.isMobile()).toBe(true);
      expect(callbacks.isMobile).toHaveBeenCalledTimes(3); // 1 at creation + 2 calls
    });
  });

  describe('swipe hint', () => {
    it('should not add hint on desktop', () => {
      callbacks.isMobile = vi.fn(() => false);
      handle = createMobileSupport(container, deps, callbacks);
      const hintContainer = document.createElement('div');
      handle.showSwipeHint(hintContainer);
      expect(hintContainer.querySelector('.mobile-swipe-hint')).toBeNull();
    });

    it('should add hint on mobile', () => {
      callbacks.isMobile = vi.fn(() => true);
      handle = createMobileSupport(container, deps, callbacks);
      const hintContainer = document.createElement('div');
      handle.showSwipeHint(hintContainer);
      expect(hintContainer.querySelector('.mobile-swipe-hint')).not.toBeNull();
    });

    it('should include title in swipe hint', () => {
      callbacks.isMobile = vi.fn(() => true);
      handle = createMobileSupport(container, deps, callbacks);
      const hintContainer = document.createElement('div');
      handle.showSwipeHint(hintContainer);
      const hint = hintContainer.querySelector('.mobile-swipe-hint');
      expect(hint?.textContent).toBeTruthy();
    });

    it('should include swipe instruction in hint', () => {
      callbacks.isMobile = vi.fn(() => true);
      handle = createMobileSupport(container, deps, callbacks);
      const hintContainer = document.createElement('div');
      handle.showSwipeHint(hintContainer);
      const hint = hintContainer.querySelector('.mobile-swipe-hint');
      expect(hint?.textContent?.toLowerCase()).toContain('swipe');
    });
  });

  describe('touch handling', () => {
    it('should not set up touch handling on desktop', () => {
      callbacks.isMobile = vi.fn(() => false);
      handle = createMobileSupport(container, deps, callbacks);
      const touchContainer = document.createElement('div');

      // Manually check that calling setupTouchHandling does nothing on desktop
      handle.setupTouchHandling(touchContainer);

      // Simulate swipe - should not trigger callback
      const touchStart = new TouchEvent('touchstart', {
        touches: [{ clientX: 100, clientY: 100 } as Touch],
      });
      const touchEnd = new TouchEvent('touchend', {
        changedTouches: [{ clientX: 200, clientY: 100 } as Touch],
      });
      touchContainer.dispatchEvent(touchStart);
      touchContainer.dispatchEvent(touchEnd);

      expect(callbacks.onSwipeLeft).not.toHaveBeenCalled();
      expect(callbacks.onSwipeRight).not.toHaveBeenCalled();
    });

    it('should call onSwipeRight for right swipe on mobile', () => {
      callbacks.isMobile = vi.fn(() => true);
      handle = createMobileSupport(container, deps, callbacks);
      const touchContainer = document.createElement('div');
      handle.setupTouchHandling(touchContainer);

      // Swipe right (start at 100, end at 200, delta = +100)
      const touchStart = new TouchEvent('touchstart', {
        touches: [{ clientX: 100, clientY: 100 } as Touch],
      });
      const touchEnd = new TouchEvent('touchend', {
        changedTouches: [{ clientX: 200, clientY: 100 } as Touch],
      });
      touchContainer.dispatchEvent(touchStart);
      touchContainer.dispatchEvent(touchEnd);

      expect(callbacks.onSwipeRight).toHaveBeenCalled();
      expect(callbacks.onSwipeLeft).not.toHaveBeenCalled();
    });

    it('should call onSwipeLeft for left swipe on mobile', () => {
      callbacks.isMobile = vi.fn(() => true);
      handle = createMobileSupport(container, deps, callbacks);
      const touchContainer = document.createElement('div');
      handle.setupTouchHandling(touchContainer);

      // Swipe left (start at 200, end at 100, delta = -100)
      const touchStart = new TouchEvent('touchstart', {
        touches: [{ clientX: 200, clientY: 100 } as Touch],
      });
      const touchEnd = new TouchEvent('touchend', {
        changedTouches: [{ clientX: 100, clientY: 100 } as Touch],
      });
      touchContainer.dispatchEvent(touchStart);
      touchContainer.dispatchEvent(touchEnd);

      expect(callbacks.onSwipeLeft).toHaveBeenCalled();
      expect(callbacks.onSwipeRight).not.toHaveBeenCalled();
    });

    it('should not trigger swipe for small horizontal movements', () => {
      callbacks.isMobile = vi.fn(() => true);
      handle = createMobileSupport(container, deps, callbacks);
      const touchContainer = document.createElement('div');
      handle.setupTouchHandling(touchContainer);

      // Small swipe (delta = 30, less than threshold of 50)
      const touchStart = new TouchEvent('touchstart', {
        touches: [{ clientX: 100, clientY: 100 } as Touch],
      });
      const touchEnd = new TouchEvent('touchend', {
        changedTouches: [{ clientX: 130, clientY: 100 } as Touch],
      });
      touchContainer.dispatchEvent(touchStart);
      touchContainer.dispatchEvent(touchEnd);

      expect(callbacks.onSwipeLeft).not.toHaveBeenCalled();
      expect(callbacks.onSwipeRight).not.toHaveBeenCalled();
    });

    it('should not trigger swipe when vertical movement exceeds threshold', () => {
      callbacks.isMobile = vi.fn(() => true);
      handle = createMobileSupport(container, deps, callbacks);
      const touchContainer = document.createElement('div');
      handle.setupTouchHandling(touchContainer);

      // Diagonal swipe (horizontal delta = 100, vertical delta = 100)
      const touchStart = new TouchEvent('touchstart', {
        touches: [{ clientX: 100, clientY: 100 } as Touch],
      });
      const touchEnd = new TouchEvent('touchend', {
        changedTouches: [{ clientX: 200, clientY: 200 } as Touch],
      });
      touchContainer.dispatchEvent(touchStart);
      touchContainer.dispatchEvent(touchEnd);

      expect(callbacks.onSwipeLeft).not.toHaveBeenCalled();
      expect(callbacks.onSwipeRight).not.toHaveBeenCalled();
    });
  });

  describe('destruction', () => {
    it('should remove FAB on destroy when it exists', () => {
      callbacks.isMobile = vi.fn(() => true);
      handle = createMobileSupport(container, deps, callbacks);
      expect(container.querySelector('.mobile-fab')).not.toBeNull();
      handle.destroy();
      expect(container.querySelector('.mobile-fab')).toBeNull();
    });

    it('should handle destroy gracefully when FAB does not exist', () => {
      callbacks.isMobile = vi.fn(() => false);
      handle = createMobileSupport(container, deps, callbacks);
      expect(() => handle.destroy()).not.toThrow();
    });
  });
});
