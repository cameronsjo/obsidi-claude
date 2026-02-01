/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createStatusBar,
  type StatusBarHandle,
  type StatusBarCallbacks,
  type StatusBarContainers,
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
    createSpan(options?: string | { cls?: string; text?: string }): HTMLSpanElement;
    setText(text: string): void;
    empty(): void;
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

HTMLElement.prototype.createSpan = function (
  options?: string | { cls?: string; text?: string }
): HTMLSpanElement {
  const span = document.createElement('span');
  if (typeof options === 'string') {
    span.className = options;
  } else if (options) {
    if (options.cls) span.className = options.cls;
    if (options.text) span.textContent = options.text;
  }
  this.appendChild(span);
  return span;
};

HTMLElement.prototype.setText = function (text: string): void {
  this.textContent = text;
};

HTMLElement.prototype.empty = function (): void {
  while (this.firstChild) {
    this.removeChild(this.firstChild);
  }
};

describe('StatusBar', () => {
  let badgesContainer: HTMLElement;
  let tokenContainer: HTMLElement;
  let containers: StatusBarContainers;
  let deps: ModuleDeps;
  let callbacks: StatusBarCallbacks;
  let handle: StatusBarHandle;

  beforeEach(() => {
    badgesContainer = document.createElement('div');
    tokenContainer = document.createElement('div');
    document.body.appendChild(badgesContainer);
    document.body.appendChild(tokenContainer);
    containers = { badgesContainer, tokenContainer };
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
    badgesContainer.remove();
    tokenContainer.remove();
  });

  describe('creation', () => {
    it('should create backend badge in badges container', () => {
      handle = createStatusBar(containers, deps, callbacks);
      expect(badgesContainer.querySelector('.backend-badge')).not.toBeNull();
    });

    it('should create token counter in token container', () => {
      handle = createStatusBar(containers, deps, callbacks);
      expect(tokenContainer.querySelector('.chat-token-counter')).not.toBeNull();
    });

    it('should call refresh on creation to populate initial state', () => {
      handle = createStatusBar(containers, deps, callbacks);
      expect(callbacks.getBackendInfo).toHaveBeenCalled();
      expect(callbacks.getActiveNoteInfo).toHaveBeenCalled();
      expect(callbacks.getAccountInfo).toHaveBeenCalled();
      expect(callbacks.getTokenEstimate).toHaveBeenCalled();
    });
  });

  describe('backend badge', () => {
    it('should set SDK aria-label for sdk type', () => {
      callbacks.getBackendInfo = vi.fn(() => ({ type: 'sdk', label: 'SDK' }));
      handle = createStatusBar(containers, deps, callbacks);
      const badge = badgesContainer.querySelector('.backend-badge') as HTMLElement;
      expect(badge.getAttribute('aria-label')).toContain('SDK');
    });

    it('should display backend label', () => {
      callbacks.getBackendInfo = vi.fn(() => ({ type: 'claude', label: 'Claude API' }));
      handle = createStatusBar(containers, deps, callbacks);
      const badge = badgesContainer.querySelector('.backend-badge') as HTMLElement;
      expect(badge.textContent).toContain('Claude API');
    });

    it('should call onBackendClick callback on click', () => {
      handle = createStatusBar(containers, deps, callbacks);
      const badge = badgesContainer.querySelector('.backend-badge') as HTMLElement;
      badge.click();
      expect(callbacks.onBackendClick).toHaveBeenCalled();
    });

    it('should update when updateBackend is called', () => {
      handle = createStatusBar(containers, deps, callbacks);
      handle.updateBackend({ type: 'sdk', label: 'SDK Mode' });
      const badge = badgesContainer.querySelector('.backend-badge') as HTMLElement;
      expect(badge.className).toContain('backend-sdk');
      expect(badge.textContent).toContain('SDK Mode');
    });
  });

  describe('context badge', () => {
    it('should be hidden when no active note', () => {
      callbacks.getActiveNoteInfo = vi.fn(() => null);
      handle = createStatusBar(containers, deps, callbacks);
      const badge = badgesContainer.querySelector('.context-badge') as HTMLElement;
      expect(badge.style.display).toBe('none');
    });

    it('should show when note is active', () => {
      callbacks.getActiveNoteInfo = vi.fn(() => ({
        path: '/path/to/note.md',
        title: 'My Note',
      }));
      handle = createStatusBar(containers, deps, callbacks);
      const badge = badgesContainer.querySelector('.context-badge') as HTMLElement;
      expect(badge.style.display).not.toBe('none');
    });

    it('should display note title', () => {
      callbacks.getActiveNoteInfo = vi.fn(() => ({
        path: '/path/to/note.md',
        title: 'My Note',
      }));
      handle = createStatusBar(containers, deps, callbacks);
      const badge = badgesContainer.querySelector('.context-badge') as HTMLElement;
      expect(badge.textContent).toContain('My Note');
    });

    it('should set path in aria-label attribute', () => {
      callbacks.getActiveNoteInfo = vi.fn(() => ({
        path: '/path/to/note.md',
        title: 'My Note',
      }));
      handle = createStatusBar(containers, deps, callbacks);
      const badge = badgesContainer.querySelector('.context-badge') as HTMLElement;
      expect(badge.getAttribute('aria-label')).toContain('/path/to/note.md');
    });

    it('should call onContextClick callback on click', () => {
      callbacks.getActiveNoteInfo = vi.fn(() => ({
        path: '/path/to/note.md',
        title: 'My Note',
      }));
      handle = createStatusBar(containers, deps, callbacks);
      const badge = badgesContainer.querySelector('.context-badge') as HTMLElement;
      badge.click();
      expect(callbacks.onContextClick).toHaveBeenCalled();
    });

    it('should update when updateContext is called', () => {
      handle = createStatusBar(containers, deps, callbacks);
      handle.updateContext({ path: '/new/path.md', title: 'New Note' });
      const badge = badgesContainer.querySelector('.context-badge') as HTMLElement;
      expect(badge.style.display).not.toBe('none');
      expect(badge.textContent).toContain('New Note');
    });

    it('should hide when updateContext called with null', () => {
      callbacks.getActiveNoteInfo = vi.fn(() => ({
        path: '/path/to/note.md',
        title: 'My Note',
      }));
      handle = createStatusBar(containers, deps, callbacks);
      handle.updateContext(null);
      const badge = badgesContainer.querySelector('.context-badge') as HTMLElement;
      expect(badge.style.display).toBe('none');
    });

    it('should truncate long titles', () => {
      callbacks.getActiveNoteInfo = vi.fn(() => ({
        path: '/path/to/note.md',
        title: 'This is a very long note title that should be truncated',
      }));
      handle = createStatusBar(containers, deps, callbacks);
      const badge = badgesContainer.querySelector('.context-badge') as HTMLElement;
      expect(badge.textContent).toContain('...');
      expect(badge.textContent?.length).toBeLessThan(20);
    });
  });

  describe('account badge', () => {
    it('should be hidden when no account info', () => {
      callbacks.getAccountInfo = vi.fn(() => null);
      handle = createStatusBar(containers, deps, callbacks);
      const badge = badgesContainer.querySelector('.account-badge') as HTMLElement;
      expect(badge.style.display).toBe('none');
    });

    it('should show when account has name', () => {
      callbacks.getAccountInfo = vi.fn(() => ({ name: 'John Doe' }));
      handle = createStatusBar(containers, deps, callbacks);
      const badge = badgesContainer.querySelector('.account-badge') as HTMLElement;
      expect(badge.style.display).not.toBe('none');
    });

    it('should show when account has email', () => {
      callbacks.getAccountInfo = vi.fn(() => ({ email: 'john@example.com' }));
      handle = createStatusBar(containers, deps, callbacks);
      const badge = badgesContainer.querySelector('.account-badge') as HTMLElement;
      expect(badge.style.display).not.toBe('none');
    });

    it('should show when account has tier', () => {
      callbacks.getAccountInfo = vi.fn(() => ({ tier: 'Pro' }));
      handle = createStatusBar(containers, deps, callbacks);
      const badge = badgesContainer.querySelector('.account-badge') as HTMLElement;
      expect(badge.style.display).not.toBe('none');
      expect(badge.textContent).toContain('Pro');
    });

    it('should call onAccountClick callback on click', () => {
      callbacks.getAccountInfo = vi.fn(() => ({ name: 'John' }));
      handle = createStatusBar(containers, deps, callbacks);
      const badge = badgesContainer.querySelector('.account-badge') as HTMLElement;
      badge.click();
      expect(callbacks.onAccountClick).toHaveBeenCalled();
    });
  });

  describe('token counter', () => {
    it('should display token count', () => {
      callbacks.getTokenEstimate = vi.fn(() => ({ tokens: 1500, cost: 0.05 }));
      handle = createStatusBar(containers, deps, callbacks);
      const counter = tokenContainer.querySelector('.chat-token-counter') as HTMLElement;
      expect(counter.textContent).toContain('1.5K');
    });

    it('should format smaller token counts without K suffix', () => {
      callbacks.getTokenEstimate = vi.fn(() => ({ tokens: 500, cost: 0.02 }));
      handle = createStatusBar(containers, deps, callbacks);
      const counter = tokenContainer.querySelector('.chat-token-counter') as HTMLElement;
      expect(counter.textContent).toContain('500');
      expect(counter.textContent).not.toContain('K');
    });

    it('should display cost with 4 decimals', () => {
      callbacks.getTokenEstimate = vi.fn(() => ({ tokens: 1000, cost: 0.0512 }));
      handle = createStatusBar(containers, deps, callbacks);
      const counter = tokenContainer.querySelector('.chat-token-counter') as HTMLElement;
      expect(counter.textContent).toContain('$0.0512');
    });

    it('should hide when tokens and cost are 0', () => {
      callbacks.getTokenEstimate = vi.fn(() => ({ tokens: 0, cost: 0 }));
      handle = createStatusBar(containers, deps, callbacks);
      const counter = tokenContainer.querySelector('.chat-token-counter') as HTMLElement;
      expect(counter.style.display).toBe('none');
    });

    it('should call onTokenCounterClick callback on click', () => {
      callbacks.getTokenEstimate = vi.fn(() => ({ tokens: 100, cost: 0.01 }));
      handle = createStatusBar(containers, deps, callbacks);
      const counter = tokenContainer.querySelector('.chat-token-counter') as HTMLElement;
      counter.click();
      expect(callbacks.onTokenCounterClick).toHaveBeenCalled();
    });

    it('should update when updateTokens is called', () => {
      callbacks.getTokenEstimate = vi.fn(() => ({ tokens: 100, cost: 0.01 }));
      handle = createStatusBar(containers, deps, callbacks);
      handle.updateTokens({ tokens: 2000, cost: 0.10 });
      const counter = tokenContainer.querySelector('.chat-token-counter') as HTMLElement;
      expect(counter.textContent).toContain('2.0K');
      expect(counter.textContent).toContain('$0.1000');
    });
  });

  describe('ephemeral badge', () => {
    it('should be hidden by default', () => {
      handle = createStatusBar(containers, deps, callbacks);
      const badge = badgesContainer.querySelector('.ephemeral-badge') as HTMLElement;
      expect(badge.style.display).toBe('none');
    });

    it('should show when updateEphemeral called with true', () => {
      handle = createStatusBar(containers, deps, callbacks);
      handle.updateEphemeral(true);
      const badge = badgesContainer.querySelector('.ephemeral-badge') as HTMLElement;
      expect(badge.style.display).not.toBe('none');
    });

    it('should hide when updateEphemeral called with false', () => {
      handle = createStatusBar(containers, deps, callbacks);
      handle.updateEphemeral(true);
      handle.updateEphemeral(false);
      const badge = badgesContainer.querySelector('.ephemeral-badge') as HTMLElement;
      expect(badge.style.display).toBe('none');
    });

    it('should have lock emoji content', () => {
      handle = createStatusBar(containers, deps, callbacks);
      const badge = badgesContainer.querySelector('.ephemeral-badge') as HTMLElement;
      // The badge shows a lock emoji
      expect(badge.textContent).toBeTruthy();
    });
  });

  describe('refresh', () => {
    it('should call all get callbacks and update display', () => {
      handle = createStatusBar(containers, deps, callbacks);
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
      handle = createStatusBar(containers, deps, callbacks);
      handle.destroy();
      expect(badgesContainer.querySelector('.backend-badge')).toBeNull();
      expect(badgesContainer.querySelector('.context-badge')).toBeNull();
      expect(badgesContainer.querySelector('.account-badge')).toBeNull();
      expect(badgesContainer.querySelector('.ephemeral-badge')).toBeNull();
      expect(tokenContainer.querySelector('.chat-token-counter')).toBeNull();
    });
  });
});
