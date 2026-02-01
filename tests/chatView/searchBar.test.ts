/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createSearchBar,
  type SearchBarHandle,
  type SearchBarCallbacks,
} from '../../src/chatView/searchBar';
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
      options?: { cls?: string; attr?: Record<string, string> }
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
  options?: { cls?: string; attr?: Record<string, string> }
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (options?.cls) el.className = options.cls;
  if (options?.attr) {
    for (const [key, value] of Object.entries(options.attr)) {
      el.setAttribute(key, value);
    }
  }
  this.appendChild(el);
  return el;
};

HTMLElement.prototype.createSpan = function (cls?: string): HTMLSpanElement {
  const span = document.createElement('span');
  if (cls) span.className = cls;
  this.appendChild(span);
  return span;
};

describe('SearchBar', () => {
  let container: HTMLElement;
  let deps: ModuleDeps;
  let callbacks: SearchBarCallbacks;
  let handle: SearchBarHandle;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    deps = {
      app: {} as ModuleDeps['app'],
      plugin: {} as ModuleDeps['plugin'],
    };
    callbacks = {
      getMessageIds: vi.fn(() => ['msg-1', 'msg-2', 'msg-3']),
      getMessageContent: vi.fn((id) => {
        const contents: Record<string, string> = {
          'msg-1': 'Hello world',
          'msg-2': 'Search test message',
          'msg-3': 'Another message',
        };
        return contents[id] || '';
      }),
      scrollToMessage: vi.fn(),
      highlightMessage: vi.fn(),
      clearHighlights: vi.fn(),
    };
  });

  afterEach(() => {
    handle?.destroy();
    container.remove();
  });

  describe('creation', () => {
    it('should create search bar container', () => {
      handle = createSearchBar(container, deps, callbacks);
      expect(container.querySelector('.chat-search-bar')).not.toBeNull();
    });

    it('should be hidden by default', () => {
      handle = createSearchBar(container, deps, callbacks);
      expect(handle.isVisible()).toBe(false);
    });
  });

  describe('visibility', () => {
    it('should show when toggle called while hidden', () => {
      handle = createSearchBar(container, deps, callbacks);
      handle.toggle();
      expect(handle.isVisible()).toBe(true);
    });

    it('should hide when toggle called while visible', () => {
      handle = createSearchBar(container, deps, callbacks);
      handle.show();
      handle.toggle();
      expect(handle.isVisible()).toBe(false);
    });

    it('should focus input when shown', () => {
      handle = createSearchBar(container, deps, callbacks);
      handle.show();
      const input = container.querySelector('input');
      expect(document.activeElement).toBe(input);
    });
  });

  describe('search', () => {
    it('should find matching messages', () => {
      handle = createSearchBar(container, deps, callbacks);
      handle.show();
      handle.search('test');
      expect(callbacks.highlightMessage).toHaveBeenCalledWith('msg-2');
    });

    it('should clear highlights when search cleared', () => {
      handle = createSearchBar(container, deps, callbacks);
      handle.show();
      handle.search('test');
      handle.search('');
      expect(callbacks.clearHighlights).toHaveBeenCalled();
    });

    it('should navigate to next match', () => {
      handle = createSearchBar(container, deps, callbacks);
      handle.show();
      // Mock multiple matches - all messages contain 'message'
      callbacks.getMessageContent = vi.fn((id) => {
        const contents: Record<string, string> = {
          'msg-1': 'First message',
          'msg-2': 'Second message',
          'msg-3': 'Third message',
        };
        return contents[id] || '';
      });
      handle.search('message');
      handle.navigateNext();
      expect(callbacks.scrollToMessage).toHaveBeenCalled();
    });

    it('should navigate to previous match', () => {
      handle = createSearchBar(container, deps, callbacks);
      handle.show();
      callbacks.getMessageContent = vi.fn((id) => {
        const contents: Record<string, string> = {
          'msg-1': 'First message',
          'msg-2': 'Second message',
          'msg-3': 'Third message',
        };
        return contents[id] || '';
      });
      handle.search('message');
      handle.navigatePrev();
      expect(callbacks.scrollToMessage).toHaveBeenCalled();
      // Should wrap around to the last match
      expect(callbacks.highlightMessage).toHaveBeenLastCalledWith('msg-3');
    });

    it('should be case insensitive', () => {
      handle = createSearchBar(container, deps, callbacks);
      handle.show();
      handle.search('TEST');
      expect(callbacks.highlightMessage).toHaveBeenCalledWith('msg-2');
    });

    it('should show no matches when query has no results', () => {
      handle = createSearchBar(container, deps, callbacks);
      handle.show();
      handle.search('nonexistent');
      const resultsEl = container.querySelector('.search-results');
      expect(resultsEl?.textContent).toBe('No matches');
    });
  });

  describe('destruction', () => {
    it('should clean up DOM on destroy', () => {
      handle = createSearchBar(container, deps, callbacks);
      handle.destroy();
      expect(container.innerHTML).toBe('');
    });
  });
});
