/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createQueuePanel,
  type QueuePanelHandle,
  type QueuePanelCallbacks,
  type QueuedMessage,
} from '../../src/chatView/queuePanel';
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

describe('QueuePanel', () => {
  let container: HTMLElement;
  let deps: ModuleDeps;
  let callbacks: QueuePanelCallbacks;
  let handle: QueuePanelHandle;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    deps = {
      app: {} as ModuleDeps['app'],
      plugin: {} as ModuleDeps['plugin'],
    };
    callbacks = {
      onRemove: vi.fn(),
      onClear: vi.fn(),
    };
  });

  afterEach(() => {
    handle?.destroy();
    container.remove();
  });

  describe('creation', () => {
    it('should create queue container', () => {
      handle = createQueuePanel(container, deps, callbacks);
      expect(container.querySelector('.chat-queue-container')).not.toBeNull();
    });

    it('should be hidden when empty', () => {
      handle = createQueuePanel(container, deps, callbacks);
      const queueContainer = container.querySelector('.chat-queue-container') as HTMLElement;
      expect(queueContainer.style.display).toBe('none');
      expect(handle.isVisible()).toBe(false);
    });
  });

  describe('adding', () => {
    it('should show panel when message added', () => {
      handle = createQueuePanel(container, deps, callbacks);
      const message: QueuedMessage = { content: 'Test message', timestamp: Date.now() };
      handle.add(message);
      expect(handle.isVisible()).toBe(true);
    });

    it('should display message in list', () => {
      handle = createQueuePanel(container, deps, callbacks);
      const message: QueuedMessage = { content: 'Test message', timestamp: Date.now() };
      handle.add(message);
      const queueContainer = container.querySelector('.chat-queue-container') as HTMLElement;
      expect(queueContainer.textContent).toContain('Test message');
    });

    it('should truncate long messages to 50 chars', () => {
      handle = createQueuePanel(container, deps, callbacks);
      const longContent = 'A'.repeat(60);
      const message: QueuedMessage = { content: longContent, timestamp: Date.now() };
      handle.add(message);
      const queueContainer = container.querySelector('.chat-queue-container') as HTMLElement;
      expect(queueContainer.textContent).toContain('A'.repeat(50) + '...');
    });

    it('should update badge count', () => {
      handle = createQueuePanel(container, deps, callbacks);
      handle.add({ content: 'Message 1', timestamp: Date.now() });
      handle.add({ content: 'Message 2', timestamp: Date.now() });
      expect(handle.getCount()).toBe(2);
    });
  });

  describe('removing', () => {
    it('should remove item from queue', () => {
      handle = createQueuePanel(container, deps, callbacks);
      handle.add({ content: 'Message 1', timestamp: Date.now() });
      handle.add({ content: 'Message 2', timestamp: Date.now() });
      handle.remove(0);
      expect(handle.getCount()).toBe(1);
    });

    it('should call onRemove callback', () => {
      handle = createQueuePanel(container, deps, callbacks);
      handle.add({ content: 'Message 1', timestamp: Date.now() });
      handle.remove(0);
      expect(callbacks.onRemove).toHaveBeenCalledWith(0);
    });

    it('should hide panel when last item removed', () => {
      handle = createQueuePanel(container, deps, callbacks);
      handle.add({ content: 'Message 1', timestamp: Date.now() });
      handle.remove(0);
      expect(handle.isVisible()).toBe(false);
    });
  });

  describe('clearing', () => {
    it('should clear all items', () => {
      handle = createQueuePanel(container, deps, callbacks);
      handle.add({ content: 'Message 1', timestamp: Date.now() });
      handle.add({ content: 'Message 2', timestamp: Date.now() });
      handle.clear();
      expect(handle.getCount()).toBe(0);
    });

    it('should call onClear callback', () => {
      handle = createQueuePanel(container, deps, callbacks);
      handle.add({ content: 'Message 1', timestamp: Date.now() });
      handle.clear();
      expect(callbacks.onClear).toHaveBeenCalled();
    });

    it('should hide panel after clearing', () => {
      handle = createQueuePanel(container, deps, callbacks);
      handle.add({ content: 'Message 1', timestamp: Date.now() });
      handle.clear();
      expect(handle.isVisible()).toBe(false);
    });
  });

  describe('getting next', () => {
    it('should return first item (FIFO)', () => {
      handle = createQueuePanel(container, deps, callbacks);
      const msg1: QueuedMessage = { content: 'First', timestamp: 1 };
      const msg2: QueuedMessage = { content: 'Second', timestamp: 2 };
      handle.add(msg1);
      handle.add(msg2);
      const next = handle.getNext();
      expect(next?.content).toBe('First');
    });

    it('should remove returned item from queue', () => {
      handle = createQueuePanel(container, deps, callbacks);
      handle.add({ content: 'First', timestamp: 1 });
      handle.add({ content: 'Second', timestamp: 2 });
      handle.getNext();
      expect(handle.getCount()).toBe(1);
    });

    it('should return null when empty', () => {
      handle = createQueuePanel(container, deps, callbacks);
      const next = handle.getNext();
      expect(next).toBeNull();
    });
  });

  describe('destruction', () => {
    it('should clean up DOM on destroy', () => {
      handle = createQueuePanel(container, deps, callbacks);
      handle.destroy();
      expect(container.querySelector('.chat-queue-container')).toBeNull();
    });
  });
});
