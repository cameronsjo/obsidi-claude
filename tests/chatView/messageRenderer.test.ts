/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createMessageRenderer,
  type MessageRendererHandle,
  type MessageRendererCallbacks,
} from '../../src/chatView/messageRenderer';
import type { ModuleDeps, ChatMessage, ToolCallInfo } from '../../src/chatView/types';

// Mock Obsidian
vi.mock('obsidian', () => {
  // Define Component class inside the mock factory
  class MockComponent {
    load(): void {}
    unload(): void {}
  }

  return {
    setIcon: vi.fn(),
    MarkdownRenderer: {
      render: vi.fn((app: unknown, content: string, container: HTMLElement) => {
        // Simulate basic markdown rendering using textContent (safe in tests)
        container.textContent = content;
      }),
    },
    Component: MockComponent,
  };
});

// Extend HTMLElement with Obsidian's createDiv/createEl/createSpan methods
declare global {
  interface HTMLElement {
    createDiv(options?: string | { cls?: string; attr?: Record<string, string> }): HTMLDivElement;
    createEl<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      options?: { cls?: string; attr?: Record<string, string>; text?: string }
    ): HTMLElementTagNameMap[K];
    createSpan(cls?: string): HTMLSpanElement;
    empty(): void;
    addClass(cls: string): void;
    toggleClass(cls: string, force?: boolean): void;
  }
}

HTMLElement.prototype.createDiv = function (
  options?: string | { cls?: string; attr?: Record<string, string> }
): HTMLDivElement {
  const div = document.createElement('div');
  if (typeof options === 'string') {
    div.className = options;
  } else if (options?.cls) {
    div.className = options.cls;
  }
  if (typeof options === 'object' && options?.attr) {
    for (const [key, value] of Object.entries(options.attr)) {
      div.setAttribute(key, value);
    }
  }
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

HTMLElement.prototype.empty = function (): void {
  while (this.firstChild) {
    this.removeChild(this.firstChild);
  }
};

HTMLElement.prototype.addClass = function (cls: string): void {
  this.classList.add(cls);
};

HTMLElement.prototype.toggleClass = function (cls: string, force?: boolean): void {
  if (force !== undefined) {
    this.classList.toggle(cls, force);
  } else {
    this.classList.toggle(cls);
  }
};

describe('MessageRenderer', () => {
  let container: HTMLElement;
  let deps: ModuleDeps;
  let callbacks: MessageRendererCallbacks;
  let handle: MessageRendererHandle;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    deps = {
      app: {
        workspace: { getActiveFile: vi.fn(() => null) },
      } as unknown as ModuleDeps['app'],
      plugin: {
        settings: {
          showToolCalls: true,
          showMessageActions: true,
        },
      } as unknown as ModuleDeps['plugin'],
    };
    callbacks = {
      onCopy: vi.fn(),
      onRegenerate: vi.fn(),
      onBookmark: vi.fn(),
      onReact: vi.fn(),
      scrollToBottom: vi.fn(),
    };
  });

  afterEach(() => {
    handle?.destroy();
    container.remove();
  });

  describe('creation', () => {
    it('should create renderer', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      expect(handle).toBeDefined();
    });

    it('should have required methods', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      expect(typeof handle.renderMessage).toBe('function');
      expect(typeof handle.updateContent).toBe('function');
      expect(typeof handle.updateTools).toBe('function');
      expect(typeof handle.getMessageElement).toBe('function');
      expect(typeof handle.clear).toBe('function');
      expect(typeof handle.destroy).toBe('function');
    });
  });

  describe('rendering messages', () => {
    it('should render user message', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      const msg: ChatMessage = {
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      };
      handle.renderMessage(msg);
      const msgEl = container.querySelector('[data-message-id="msg-1"]');
      expect(msgEl).not.toBeNull();
      expect(msgEl?.classList.contains('user-message')).toBe(true);
    });

    it('should render assistant message', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      const msg: ChatMessage = {
        id: 'msg-2',
        role: 'assistant',
        content: 'Hi there!',
        timestamp: Date.now(),
      };
      handle.renderMessage(msg);
      const msgEl = container.querySelector('[data-message-id="msg-2"]');
      expect(msgEl).not.toBeNull();
      expect(msgEl?.classList.contains('assistant-message')).toBe(true);
    });

    it('should render typing indicator for streaming', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      const msg: ChatMessage = {
        id: 'msg-3',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
      };
      handle.renderMessage(msg);
      const typingIndicator = container.querySelector('.typing-indicator');
      expect(typingIndicator).not.toBeNull();
    });

    it('should render message header with role and time', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      const msg: ChatMessage = {
        id: 'msg-4',
        role: 'user',
        content: 'Test',
        timestamp: Date.now(),
      };
      handle.renderMessage(msg);
      const header = container.querySelector('.message-header');
      expect(header).not.toBeNull();
      expect(header?.querySelector('.message-role')).not.toBeNull();
      expect(header?.querySelector('.message-time')).not.toBeNull();
    });

    it('should add bookmarked class when message is bookmarked', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      const msg: ChatMessage = {
        id: 'msg-5',
        role: 'assistant',
        content: 'Bookmarked content',
        timestamp: Date.now(),
        bookmarked: true,
      };
      handle.renderMessage(msg);
      const msgEl = container.querySelector('[data-message-id="msg-5"]');
      expect(msgEl?.classList.contains('message-bookmarked')).toBe(true);
    });

    it('should render images when present', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      // Use empty content so mock doesn't overwrite images
      const msg: ChatMessage = {
        id: 'msg-6',
        role: 'user',
        content: '',
        timestamp: Date.now(),
        images: [
          {
            data: 'base64data',
            mimeType: 'image/png',
            filename: 'test.png',
          },
        ],
      };
      handle.renderMessage(msg);
      const imagesDiv = container.querySelector('.message-images');
      expect(imagesDiv).not.toBeNull();
      const img = imagesDiv?.querySelector('img');
      expect(img).not.toBeNull();
      expect(img?.getAttribute('alt')).toBe('test.png');
    });
  });

  describe('updating content', () => {
    it('should update message content', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      const msg: ChatMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: 'Initial',
        timestamp: Date.now(),
      };
      handle.renderMessage(msg);
      handle.updateContent('msg-1', 'Updated content');
      expect(handle.getMessageElement('msg-1')).not.toBeNull();
    });

    it('should not throw for non-existent message', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      expect(() => handle.updateContent('non-existent', 'Content')).not.toThrow();
    });

    it('should show message actions after streaming completes', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      const msg: ChatMessage = {
        id: 'msg-stream',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
      };
      handle.renderMessage(msg);
      const actionsDiv = container.querySelector('.message-actions') as HTMLElement;
      expect(actionsDiv?.style.display).toBe('none');

      // Update with final content
      handle.updateContent('msg-stream', 'Final content');
      const updatedActions = container.querySelector('.message-actions') as HTMLElement;
      expect(updatedActions?.style.display).toBe('');
    });
  });

  describe('tool calls', () => {
    it('should render tool calls', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      const msg: ChatMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: 'Using tool',
        timestamp: Date.now(),
        toolCalls: [
          {
            name: 'read_note',
            input: { path: 'test.md' },
            status: 'running',
          },
        ],
      };
      handle.renderMessage(msg);
      const toolEl = container.querySelector('.tool-call');
      expect(toolEl).not.toBeNull();
    });

    it('should show tool name', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      const msg: ChatMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [
          {
            name: 'semantic_search',
            input: { query: 'test query' },
            status: 'completed',
            result: 'found results',
          },
        ],
      };
      handle.renderMessage(msg);
      const toolName = container.querySelector('.tool-name');
      expect(toolName?.textContent).toBe('semantic_search');
    });

    it('should update tool status', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      const msg: ChatMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      };
      handle.renderMessage(msg);

      const toolCalls: ToolCallInfo[] = [
        {
          name: 'read_note',
          input: { path: 'test.md' },
          status: 'completed',
          result: 'file contents',
        },
      ];
      handle.updateTools('msg-1', toolCalls);
      expect(handle.getMessageElement('msg-1')).not.toBeNull();
      const toolEl = container.querySelector('.tool-call');
      expect(toolEl).not.toBeNull();
    });

    it('should add status class to tool call', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      const msg: ChatMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [
          {
            name: 'test_tool',
            input: {},
            status: 'error',
          },
        ],
      };
      handle.renderMessage(msg);
      const toolEl = container.querySelector('.tool-call');
      expect(toolEl?.classList.contains('tool-status-error')).toBe(true);
    });
  });

  describe('message actions', () => {
    it('should show action buttons for assistant messages', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      const msg: ChatMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: 'Test',
        timestamp: Date.now(),
      };
      handle.renderMessage(msg);
      const actions = container.querySelector('.message-actions');
      expect(actions).not.toBeNull();
    });

    it('should show action buttons for user messages', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      const msg: ChatMessage = {
        id: 'msg-1',
        role: 'user',
        content: 'Test',
        timestamp: Date.now(),
      };
      handle.renderMessage(msg);
      const actions = container.querySelector('.message-actions');
      expect(actions).not.toBeNull();
    });

    it('should hide actions during streaming', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      const msg: ChatMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
      };
      handle.renderMessage(msg);
      const actions = container.querySelector('.message-actions') as HTMLElement;
      expect(actions?.style.display).toBe('none');
    });

    it('should call onCopy when copy button clicked', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      const msg: ChatMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: 'Test content',
        timestamp: Date.now(),
      };
      handle.renderMessage(msg);
      const copyBtn = container.querySelector('.message-action-btn[aria-label="Copy message"]') as HTMLElement;
      expect(copyBtn).not.toBeNull();
      copyBtn?.click();
      expect(callbacks.onCopy).toHaveBeenCalledWith('msg-1');
    });

    it('should call onBookmark when bookmark button clicked', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      const msg: ChatMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: 'Test',
        timestamp: Date.now(),
      };
      handle.renderMessage(msg);
      const bookmarkBtn = container.querySelector('.bookmark-btn') as HTMLElement;
      expect(bookmarkBtn).not.toBeNull();
      bookmarkBtn?.click();
      expect(callbacks.onBookmark).toHaveBeenCalledWith('msg-1');
    });
  });

  describe('clearing', () => {
    it('should clear all messages', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      handle.renderMessage({
        id: 'msg-1',
        role: 'user',
        content: 'Test 1',
        timestamp: Date.now(),
      });
      handle.renderMessage({
        id: 'msg-2',
        role: 'assistant',
        content: 'Test 2',
        timestamp: Date.now(),
      });
      handle.clear();
      expect(container.children.length).toBe(0);
      expect(handle.getMessageElement('msg-1')).toBeNull();
      expect(handle.getMessageElement('msg-2')).toBeNull();
    });
  });

  describe('getMessageElement', () => {
    it('should return message element by ID', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      const msg: ChatMessage = {
        id: 'msg-find',
        role: 'user',
        content: 'Find me',
        timestamp: Date.now(),
      };
      handle.renderMessage(msg);
      const el = handle.getMessageElement('msg-find');
      expect(el).not.toBeNull();
      expect(el?.dataset.messageId).toBe('msg-find');
    });

    it('should return null for non-existent message', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      const el = handle.getMessageElement('non-existent');
      expect(el).toBeNull();
    });
  });

  describe('showWelcome', () => {
    it('should display welcome element', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      const welcomeEl = document.createElement('div');
      welcomeEl.className = 'welcome-state';
      welcomeEl.textContent = 'Welcome!';
      handle.showWelcome(welcomeEl);
      expect(container.querySelector('.welcome-state')).not.toBeNull();
    });

    it('should clear previous messages', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      handle.renderMessage({
        id: 'msg-1',
        role: 'user',
        content: 'Old message',
        timestamp: Date.now(),
      });
      const welcomeEl = document.createElement('div');
      welcomeEl.className = 'welcome-state';
      handle.showWelcome(welcomeEl);
      expect(container.querySelector('[data-message-id="msg-1"]')).toBeNull();
    });
  });

  describe('code blocks', () => {
    it('should add copy buttons to code blocks', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      // Create a pre>code structure manually
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = 'const x = 1;';
      pre.appendChild(code);
      container.appendChild(pre);

      handle.addCodeBlockCopyButtons();
      const copyBtn = container.querySelector('.code-copy-btn');
      expect(copyBtn).not.toBeNull();
    });

    it('should not add duplicate copy buttons', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = 'const x = 1;';
      pre.appendChild(code);
      container.appendChild(pre);

      handle.addCodeBlockCopyButtons();
      handle.addCodeBlockCopyButtons();
      const copyBtns = container.querySelectorAll('.code-copy-btn');
      expect(copyBtns.length).toBe(1);
    });
  });

  describe('destruction', () => {
    it('should clean up on destroy', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      handle.renderMessage({
        id: 'msg-1',
        role: 'user',
        content: 'Test',
        timestamp: Date.now(),
      });
      handle.destroy();
      expect(handle.getMessageElement('msg-1')).toBeNull();
    });

    it('should be safe to call destroy multiple times', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      expect(() => {
        handle.destroy();
        handle.destroy();
      }).not.toThrow();
    });
  });
});
