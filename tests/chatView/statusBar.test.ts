/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createStatusBar,
  type StatusBarHandle,
  type StatusBarCallbacks,
  type BackendInfo,
  type ContextInfo,
  type AccountInfo,
  type TokenInfo,
} from '../../src/chatView/statusBar';
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

describe('StatusBar', () => {
  let container: HTMLElement;
  let deps: ModuleDeps;
  let callbacks: StatusBarCallbacks;
  let handle: StatusBarHandle;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    deps = {
      app: {} as ModuleDeps['app'],
      plugin: {} as ModuleDeps['plugin'],
    };
    callbacks = {
      onBackendClick: vi.fn(),
      onContextClick: vi.fn(),
      onAccountClick: vi.fn(),
      onTokenCounterClick: vi.fn(),
      getBackendInfo: vi.fn(() => ({ type: 'claude', label: 'Claude' })),
      getActiveNoteInfo: vi.fn(() => null),
      getAccountInfo: vi.fn(() => null),
      getTokenEstimate: vi.fn(() => ({ tokens: 0, cost: 0 })),
    };
  });

  afterEach(() => {
    handle?.destroy();
    container.remove();
  });

  describe('creation', () => {
    it('should create chat badges container', () => {
      handle = createStatusBar(container, deps, callbacks);
      expect(container.querySelector('.chat-badges')).not.toBeNull();
    });

    it('should create backend badge', () => {
      handle = createStatusBar(container, deps, callbacks);
      expect(container.querySelector('.backend-badge')).not.toBeNull();
    });

    it('should call refresh on creation to populate initial state', () => {
      handle = createStatusBar(container, deps, callbacks);
      expect(callbacks.getBackendInfo).toHaveBeenCalled();
      expect(callbacks.getActiveNoteInfo).toHaveBeenCalled();
      expect(callbacks.getAccountInfo).toHaveBeenCalled();
      expect(callbacks.getTokenEstimate).toHaveBeenCalled();
    });
  });

  describe('backend badge', () => {
    it('should display backend type in data-type attribute', () => {
      callbacks.getBackendInfo = vi.fn(() => ({ type: 'openai', label: 'OpenAI' }));
      handle = createStatusBar(container, deps, callbacks);
      const badge = container.querySelector('.backend-badge') as HTMLElement;
      expect(badge.getAttribute('data-type')).toBe('openai');
    });

    it('should display backend label', () => {
      callbacks.getBackendInfo = vi.fn(() => ({ type: 'claude', label: 'Claude API' }));
      handle = createStatusBar(container, deps, callbacks);
      const badge = container.querySelector('.backend-badge') as HTMLElement;
      expect(badge.textContent).toContain('Claude API');
    });

    it('should call onBackendClick callback on click', () => {
      handle = createStatusBar(container, deps, callbacks);
      const badge = container.querySelector('.backend-badge') as HTMLElement;
      badge.click();
      expect(callbacks.onBackendClick).toHaveBeenCalled();
    });

    it('should update when updateBackend is called', () => {
      handle = createStatusBar(container, deps, callbacks);
      handle.updateBackend({ type: 'openai', label: 'GPT-4' });
      const badge = container.querySelector('.backend-badge') as HTMLElement;
      expect(badge.getAttribute('data-type')).toBe('openai');
      expect(badge.textContent).toContain('GPT-4');
    });
  });

  describe('context badge', () => {
    it('should be hidden when no active note', () => {
      callbacks.getActiveNoteInfo = vi.fn(() => null);
      handle = createStatusBar(container, deps, callbacks);
      const badge = container.querySelector('.context-badge') as HTMLElement;
      expect(badge.style.display).toBe('none');
    });

    it('should show when note is active', () => {
      callbacks.getActiveNoteInfo = vi.fn(() => ({
        path: '/path/to/note.md',
        title: 'My Note',
      }));
      handle = createStatusBar(container, deps, callbacks);
      const badge = container.querySelector('.context-badge') as HTMLElement;
      expect(badge.style.display).not.toBe('none');
    });

    it('should display note title', () => {
      callbacks.getActiveNoteInfo = vi.fn(() => ({
        path: '/path/to/note.md',
        title: 'My Note',
      }));
      handle = createStatusBar(container, deps, callbacks);
      const badge = container.querySelector('.context-badge') as HTMLElement;
      expect(badge.textContent).toContain('My Note');
    });

    it('should set path in title attribute', () => {
      callbacks.getActiveNoteInfo = vi.fn(() => ({
        path: '/path/to/note.md',
        title: 'My Note',
      }));
      handle = createStatusBar(container, deps, callbacks);
      const badge = container.querySelector('.context-badge') as HTMLElement;
      expect(badge.getAttribute('title')).toBe('/path/to/note.md');
    });

    it('should call onContextClick callback on click', () => {
      callbacks.getActiveNoteInfo = vi.fn(() => ({
        path: '/path/to/note.md',
        title: 'My Note',
      }));
      handle = createStatusBar(container, deps, callbacks);
      const badge = container.querySelector('.context-badge') as HTMLElement;
      badge.click();
      expect(callbacks.onContextClick).toHaveBeenCalled();
    });

    it('should update when updateContext is called', () => {
      handle = createStatusBar(container, deps, callbacks);
      handle.updateContext({ path: '/new/path.md', title: 'New Note' });
      const badge = container.querySelector('.context-badge') as HTMLElement;
      expect(badge.style.display).not.toBe('none');
      expect(badge.textContent).toContain('New Note');
    });

    it('should hide when updateContext called with null', () => {
      callbacks.getActiveNoteInfo = vi.fn(() => ({
        path: '/path/to/note.md',
        title: 'My Note',
      }));
      handle = createStatusBar(container, deps, callbacks);
      handle.updateContext(null);
      const badge = container.querySelector('.context-badge') as HTMLElement;
      expect(badge.style.display).toBe('none');
    });
  });

  describe('account badge', () => {
    it('should be hidden when no account info', () => {
      callbacks.getAccountInfo = vi.fn(() => null);
      handle = createStatusBar(container, deps, callbacks);
      const badge = container.querySelector('.account-badge') as HTMLElement;
      expect(badge.style.display).toBe('none');
    });

    it('should show when account has name', () => {
      callbacks.getAccountInfo = vi.fn(() => ({ name: 'John Doe' }));
      handle = createStatusBar(container, deps, callbacks);
      const badge = container.querySelector('.account-badge') as HTMLElement;
      expect(badge.style.display).not.toBe('none');
    });

    it('should show when account has email', () => {
      callbacks.getAccountInfo = vi.fn(() => ({ email: 'john@example.com' }));
      handle = createStatusBar(container, deps, callbacks);
      const badge = container.querySelector('.account-badge') as HTMLElement;
      expect(badge.style.display).not.toBe('none');
    });

    it('should display account name or email', () => {
      callbacks.getAccountInfo = vi.fn(() => ({
        name: 'John Doe',
        email: 'john@example.com',
      }));
      handle = createStatusBar(container, deps, callbacks);
      const badge = container.querySelector('.account-badge') as HTMLElement;
      expect(badge.textContent).toContain('John Doe');
    });

    it('should call onAccountClick callback on click', () => {
      callbacks.getAccountInfo = vi.fn(() => ({ name: 'John' }));
      handle = createStatusBar(container, deps, callbacks);
      const badge = container.querySelector('.account-badge') as HTMLElement;
      badge.click();
      expect(callbacks.onAccountClick).toHaveBeenCalled();
    });
  });

  describe('token counter', () => {
    it('should display token count', () => {
      callbacks.getTokenEstimate = vi.fn(() => ({ tokens: 1500, cost: 0.05 }));
      handle = createStatusBar(container, deps, callbacks);
      const counter = container.querySelector('.chat-token-counter') as HTMLElement;
      expect(counter.textContent).toContain('1500');
    });

    it('should format cost with 2 decimals when >= 0.01', () => {
      callbacks.getTokenEstimate = vi.fn(() => ({ tokens: 1000, cost: 0.05 }));
      handle = createStatusBar(container, deps, callbacks);
      const counter = container.querySelector('.chat-token-counter') as HTMLElement;
      expect(counter.textContent).toContain('$0.05');
    });

    it('should format cost with 4 decimals when > 0 and < 0.01', () => {
      callbacks.getTokenEstimate = vi.fn(() => ({ tokens: 100, cost: 0.001 }));
      handle = createStatusBar(container, deps, callbacks);
      const counter = container.querySelector('.chat-token-counter') as HTMLElement;
      expect(counter.textContent).toContain('$0.0010');
    });

    it('should show $0.00 when cost is 0', () => {
      callbacks.getTokenEstimate = vi.fn(() => ({ tokens: 0, cost: 0 }));
      handle = createStatusBar(container, deps, callbacks);
      const counter = container.querySelector('.chat-token-counter') as HTMLElement;
      expect(counter.textContent).toContain('$0.00');
    });

    it('should call onTokenCounterClick callback on click', () => {
      handle = createStatusBar(container, deps, callbacks);
      const counter = container.querySelector('.chat-token-counter') as HTMLElement;
      counter.click();
      expect(callbacks.onTokenCounterClick).toHaveBeenCalled();
    });

    it('should update when updateTokens is called', () => {
      handle = createStatusBar(container, deps, callbacks);
      handle.updateTokens({ tokens: 2000, cost: 0.10 });
      const counter = container.querySelector('.chat-token-counter') as HTMLElement;
      expect(counter.textContent).toContain('2000');
      expect(counter.textContent).toContain('$0.10');
    });
  });

  describe('ephemeral badge', () => {
    it('should be hidden by default', () => {
      handle = createStatusBar(container, deps, callbacks);
      const badge = container.querySelector('.ephemeral-badge') as HTMLElement;
      expect(badge.style.display).toBe('none');
    });

    it('should show when updateEphemeral called with true', () => {
      handle = createStatusBar(container, deps, callbacks);
      handle.updateEphemeral(true);
      const badge = container.querySelector('.ephemeral-badge') as HTMLElement;
      expect(badge.style.display).not.toBe('none');
    });

    it('should hide when updateEphemeral called with false', () => {
      handle = createStatusBar(container, deps, callbacks);
      handle.updateEphemeral(true);
      handle.updateEphemeral(false);
      const badge = container.querySelector('.ephemeral-badge') as HTMLElement;
      expect(badge.style.display).toBe('none');
    });

    it('should display "Ephemeral" text', () => {
      handle = createStatusBar(container, deps, callbacks);
      handle.updateEphemeral(true);
      const badge = container.querySelector('.ephemeral-badge') as HTMLElement;
      expect(badge.textContent).toContain('Ephemeral');
    });
  });

  describe('refresh', () => {
    it('should call all get callbacks and update display', () => {
      handle = createStatusBar(container, deps, callbacks);
      vi.clearAllMocks();
      handle.refresh();
      expect(callbacks.getBackendInfo).toHaveBeenCalled();
      expect(callbacks.getActiveNoteInfo).toHaveBeenCalled();
      expect(callbacks.getAccountInfo).toHaveBeenCalled();
      expect(callbacks.getTokenEstimate).toHaveBeenCalled();
    });
  });

  describe('destruction', () => {
    it('should clean up DOM on destroy', () => {
      handle = createStatusBar(container, deps, callbacks);
      handle.destroy();
      expect(container.querySelector('.chat-badges')).toBeNull();
    });
  });
});
