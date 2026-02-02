/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createScrollManager,
  type ScrollManagerHandle,
  type ScrollManagerCallbacks,
} from '../../src/chatView/scrollManager';
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
    toggleClass(cls: string, enabled: boolean): void;
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

HTMLElement.prototype.toggleClass = function (cls: string, enabled: boolean): void {
  if (enabled) {
    this.classList.add(cls);
  } else {
    this.classList.remove(cls);
  }
};

describe('ScrollManager', () => {
  let messagesContainer: HTMLElement;
  let deps: ModuleDeps;
  let callbacks: ScrollManagerCallbacks;
  let handle: ScrollManagerHandle;

  beforeEach(() => {
    messagesContainer = document.createElement('div');
    // Set up scrollable container properties
    Object.defineProperty(messagesContainer, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(messagesContainer, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(messagesContainer, 'scrollTop', { value: 500, writable: true, configurable: true });
    document.body.appendChild(messagesContainer);

    deps = {
      app: {} as ModuleDeps['app'],
      plugin: {} as ModuleDeps['plugin'],
    };
    callbacks = {
      onUserScrollChange: vi.fn(),
      getMessageElement: vi.fn(),
    };
  });

  afterEach(() => {
    handle?.destroy();
    messagesContainer.remove();
  });

  describe('scroll-to-bottom button creation', () => {
    it('should create scroll-to-bottom button', () => {
      handle = createScrollManager(messagesContainer, deps, callbacks);
      expect(messagesContainer.querySelector('.scroll-to-bottom-btn')).not.toBeNull();
    });

    it('should set aria-label on button', () => {
      handle = createScrollManager(messagesContainer, deps, callbacks);
      const btn = messagesContainer.querySelector('.scroll-to-bottom-btn') as HTMLElement;
      expect(btn.getAttribute('aria-label')).toBe('Scroll to bottom');
    });

    it('should call scrollToBottom when button is clicked', () => {
      handle = createScrollManager(messagesContainer, deps, callbacks);
      const btn = messagesContainer.querySelector('.scroll-to-bottom-btn') as HTMLElement;
      btn.click();
      // scrollTop should be set to scrollHeight
      expect(messagesContainer.scrollTop).toBe(1000);
    });
  });

  describe('scroll state tracking', () => {
    it('should initially report not scrolled up', () => {
      // Start at bottom
      Object.defineProperty(messagesContainer, 'scrollTop', { value: 500, writable: true, configurable: true });
      handle = createScrollManager(messagesContainer, deps, callbacks);
      expect(handle.isUserScrolledUp()).toBe(false);
    });

    it('should detect user scrolled up when far from bottom', () => {
      handle = createScrollManager(messagesContainer, deps, callbacks);

      // Scroll up (scrollTop = 0 means at top)
      Object.defineProperty(messagesContainer, 'scrollTop', { value: 0, writable: true, configurable: true });
      messagesContainer.dispatchEvent(new Event('scroll'));

      expect(handle.isUserScrolledUp()).toBe(true);
    });

    it('should detect user at bottom when within threshold', () => {
      handle = createScrollManager(messagesContainer, deps, callbacks);

      // Scroll to near bottom (within 100px threshold)
      Object.defineProperty(messagesContainer, 'scrollTop', { value: 450, writable: true, configurable: true });
      messagesContainer.dispatchEvent(new Event('scroll'));

      expect(handle.isUserScrolledUp()).toBe(false);
    });

    it('should notify callback when scroll state changes', () => {
      handle = createScrollManager(messagesContainer, deps, callbacks);

      // Scroll up
      Object.defineProperty(messagesContainer, 'scrollTop', { value: 0, writable: true, configurable: true });
      messagesContainer.dispatchEvent(new Event('scroll'));

      expect(callbacks.onUserScrollChange).toHaveBeenCalledWith(true);
    });

    it('should not notify callback when scroll state unchanged', () => {
      handle = createScrollManager(messagesContainer, deps, callbacks);

      // Stay at bottom (within threshold)
      Object.defineProperty(messagesContainer, 'scrollTop', { value: 480, writable: true, configurable: true });
      messagesContainer.dispatchEvent(new Event('scroll'));

      // Should not have been called since state didn't change
      expect(callbacks.onUserScrollChange).not.toHaveBeenCalled();
    });
  });

  describe('scrollToBottom', () => {
    it('should scroll to bottom when not scrolled up', () => {
      handle = createScrollManager(messagesContainer, deps, callbacks);
      messagesContainer.scrollTop = 0;
      handle.scrollToBottom();
      expect(messagesContainer.scrollTop).toBe(1000);
    });

    it('should force scroll to bottom when forced', () => {
      handle = createScrollManager(messagesContainer, deps, callbacks);

      // Scroll up first
      Object.defineProperty(messagesContainer, 'scrollTop', { value: 0, writable: true, configurable: true });
      messagesContainer.dispatchEvent(new Event('scroll'));

      // Force scroll
      handle.scrollToBottom(true);
      expect(messagesContainer.scrollTop).toBe(1000);
    });

    it('should not scroll when user scrolled up and not forced', () => {
      handle = createScrollManager(messagesContainer, deps, callbacks);

      // Scroll up first
      Object.defineProperty(messagesContainer, 'scrollTop', { value: 0, writable: true, configurable: true });
      messagesContainer.dispatchEvent(new Event('scroll'));

      // Try to scroll without forcing
      handle.scrollToBottom(false);
      expect(messagesContainer.scrollTop).toBe(0);
    });
  });

  describe('scrollToMessage', () => {
    it('should call getMessageElement callback', () => {
      handle = createScrollManager(messagesContainer, deps, callbacks);
      handle.scrollToMessage('msg-123');
      expect(callbacks.getMessageElement).toHaveBeenCalledWith('msg-123');
    });

    it('should scroll element into view when found', () => {
      const mockElement = document.createElement('div');
      mockElement.scrollIntoView = vi.fn();
      callbacks.getMessageElement = vi.fn(() => mockElement);

      handle = createScrollManager(messagesContainer, deps, callbacks);
      handle.scrollToMessage('msg-123');

      expect(mockElement.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'center',
      });
    });

    it('should handle missing element gracefully', () => {
      callbacks.getMessageElement = vi.fn(() => undefined);
      handle = createScrollManager(messagesContainer, deps, callbacks);
      expect(() => handle.scrollToMessage('nonexistent')).not.toThrow();
    });
  });

  describe('showScrollButton', () => {
    it('should show button when true', () => {
      handle = createScrollManager(messagesContainer, deps, callbacks);
      handle.showScrollButton(true);
      const btn = messagesContainer.querySelector('.scroll-to-bottom-btn') as HTMLElement;
      expect(btn.classList.contains('visible')).toBe(true);
    });

    it('should hide button when false', () => {
      handle = createScrollManager(messagesContainer, deps, callbacks);
      handle.showScrollButton(true);
      handle.showScrollButton(false);
      const btn = messagesContainer.querySelector('.scroll-to-bottom-btn') as HTMLElement;
      expect(btn.classList.contains('visible')).toBe(false);
    });
  });

  describe('resetScrollState', () => {
    it('should reset userScrolledUp to false', () => {
      handle = createScrollManager(messagesContainer, deps, callbacks);

      // Scroll up first
      Object.defineProperty(messagesContainer, 'scrollTop', { value: 0, writable: true, configurable: true });
      messagesContainer.dispatchEvent(new Event('scroll'));
      expect(handle.isUserScrolledUp()).toBe(true);

      // Reset
      handle.resetScrollState();
      expect(handle.isUserScrolledUp()).toBe(false);
    });

    it('should hide scroll button', () => {
      handle = createScrollManager(messagesContainer, deps, callbacks);
      handle.showScrollButton(true);
      handle.resetScrollState();
      const btn = messagesContainer.querySelector('.scroll-to-bottom-btn') as HTMLElement;
      expect(btn.classList.contains('visible')).toBe(false);
    });
  });

  describe('destruction', () => {
    it('should remove scroll-to-bottom button on destroy', () => {
      handle = createScrollManager(messagesContainer, deps, callbacks);
      expect(messagesContainer.querySelector('.scroll-to-bottom-btn')).not.toBeNull();
      handle.destroy();
      expect(messagesContainer.querySelector('.scroll-to-bottom-btn')).toBeNull();
    });

    it('should remove scroll event listener on destroy', () => {
      handle = createScrollManager(messagesContainer, deps, callbacks);
      handle.destroy();

      // Scroll event should not trigger callback after destroy
      Object.defineProperty(messagesContainer, 'scrollTop', { value: 0, writable: true, configurable: true });
      messagesContainer.dispatchEvent(new Event('scroll'));

      // The callback should not have been called since we destroyed the handler
      // (though we already had one call during setup transition)
      expect(callbacks.onUserScrollChange).not.toHaveBeenCalled();
    });

    it('should handle multiple destroy calls gracefully', () => {
      handle = createScrollManager(messagesContainer, deps, callbacks);
      expect(() => {
        handle.destroy();
        handle.destroy();
      }).not.toThrow();
    });
  });
});
