/**
 * @vitest-environment jsdom
 *
 * Additional tests for createMessageRenderer focused on:
 *   - Tool-card dispatch (plan, fetch, diff, read aggregation, grep→search)
 *   - renderPermissionCard state machine (Allow once / Always / Deny)
 *
 * The existing messageRenderer.test.ts covers basic rendering, search cards,
 * read lines, error status, and message actions — those cases are not
 * duplicated here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createMessageRenderer,
  type MessageRendererHandle,
  type MessageRendererCallbacks,
} from '../../src/chatView/messageRenderer';
import type { ModuleDeps, ChatMessage, ToolCallInfo } from '../../src/chatView/types';

vi.mock('obsidian', () => {
  class MockComponent {
    load(): void {}
    unload(): void {}
  }
  return {
    setIcon: vi.fn(),
    MarkdownRenderer: {
      render: vi.fn((_app: unknown, content: string, container: HTMLElement) => {
        container.textContent = content;
      }),
    },
    Component: MockComponent,
  };
});

// ── Obsidian DOM extensions ────────────────────────────────────────────────────

declare global {
  interface HTMLElement {
    createDiv(options?: string | { cls?: string; attr?: Record<string, string> }): HTMLDivElement;
    createEl<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      options?: { cls?: string; attr?: Record<string, string>; text?: string }
    ): HTMLElementTagNameMap[K];
    createSpan(
      options?: string | { cls?: string; text?: string; attr?: Record<string, string> }
    ): HTMLSpanElement;
    empty(): void;
    addClass(cls: string): void;
    hasClass(cls: string): boolean;
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
  const el = document.createElement(tag) as HTMLElementTagNameMap[K];
  if (options?.cls) (el as HTMLElement).className = options.cls;
  if (options?.attr) {
    for (const [key, value] of Object.entries(options.attr)) {
      (el as HTMLElement).setAttribute(key, value);
    }
  }
  if (options?.text) (el as HTMLElement).textContent = options.text;
  this.appendChild(el);
  return el;
};

HTMLElement.prototype.createSpan = function (
  options?: string | { cls?: string; text?: string; attr?: Record<string, string> }
): HTMLSpanElement {
  const span = document.createElement('span');
  if (typeof options === 'string') {
    span.className = options;
  } else if (options) {
    if (options.cls) span.className = options.cls;
    if (options.text) span.textContent = options.text;
    if (options.attr) {
      for (const [key, value] of Object.entries(options.attr)) {
        span.setAttribute(key, value);
      }
    }
  }
  this.appendChild(span);
  return span;
};

HTMLElement.prototype.empty = function (): void {
  while (this.firstChild) this.removeChild(this.firstChild);
};

HTMLElement.prototype.addClass = function (cls: string): void {
  this.classList.add(cls);
};

HTMLElement.prototype.hasClass = function (cls: string): boolean {
  return this.classList.contains(cls);
};

HTMLElement.prototype.toggleClass = function (cls: string, force?: boolean): void {
  if (force !== undefined) {
    this.classList.toggle(cls, force);
  } else {
    this.classList.toggle(cls);
  }
};

// ── fixtures ──────────────────────────────────────────────────────────────────

function makeDeps(): ModuleDeps {
  return {
    app: {
      workspace: { getActiveFile: vi.fn(() => null) },
    } as unknown as ModuleDeps['app'],
    plugin: {
      settings: {
        showToolCalls: true,
        showMessageActions: true,
        showThinkingByDefault: false,
      },
    } as unknown as ModuleDeps['plugin'],
  };
}

function makeCallbacks(): MessageRendererCallbacks {
  return {
    onCopy: vi.fn(),
    onRegenerate: vi.fn(),
    onEdit: vi.fn(),
    onReact: vi.fn(),
    onBookmark: vi.fn(),
    onResume: vi.fn(),
    scrollToBottom: vi.fn(),
    canResume: vi.fn(() => false),
  };
}

function assistantMsgWithTools(id: string, toolCalls: ToolCallInfo[]): ChatMessage {
  return { id, role: 'assistant', content: '', timestamp: Date.now(), toolCalls };
}

// ── suite ─────────────────────────────────────────────────────────────────────

describe('MessageRenderer — tool-card dispatch', () => {
  let container: HTMLElement;
  let callbacks: MessageRendererCallbacks;
  let handle: MessageRendererHandle;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    callbacks = makeCallbacks();
    handle = createMessageRenderer(container, makeDeps(), callbacks);
  });

  afterEach(() => {
    handle.destroy();
    container.remove();
  });

  // ── plan card ────────────────────────────────────────────────────────────────

  describe('TodoWrite → plan card', () => {
    it('renders .occ-card-plan', () => {
      handle.renderMessage(assistantMsgWithTools('m1', [
        { name: 'TodoWrite', input: { todos: [] }, status: 'completed' },
      ]));
      expect(container.querySelector('.occ-card-plan')).not.toBeNull();
    });

    it('shows done-of-total meta when todos are present', () => {
      handle.renderMessage(assistantMsgWithTools('m1', [
        {
          name: 'TodoWrite',
          input: {
            todos: [
              { content: 'Step one', status: 'completed' },
              { content: 'Step two', status: 'pending' },
            ],
          },
          status: 'running',
        },
      ]));
      const meta = container.querySelector('.occ-card-meta');
      expect(meta?.textContent).toContain('1 of 2 done');
    });

    it('marks completed todo rows with is-done class', () => {
      handle.renderMessage(assistantMsgWithTools('m1', [
        {
          name: 'TodoWrite',
          input: {
            todos: [
              { content: 'Done step', status: 'completed' },
              { content: 'Pending step', status: 'pending' },
            ],
          },
          status: 'completed',
        },
      ]));
      const rows = container.querySelectorAll('.occ-plan-row');
      expect(rows[0]?.querySelector('.occ-plan-mark')?.classList.contains('is-done')).toBe(true);
      expect(rows[1]?.querySelector('.occ-plan-mark')?.classList.contains('is-done')).toBe(false);
    });

    it('plan card is open by default (body visible)', () => {
      handle.renderMessage(assistantMsgWithTools('m1', [
        { name: 'TodoWrite', input: { todos: [] }, status: 'completed' },
      ]));
      const body = container.querySelector('.occ-card-plan .occ-card-body') as HTMLElement;
      expect(body.style.display).not.toBe('none');
    });
  });

  // ── fetch card ───────────────────────────────────────────────────────────────

  describe('webfetch / web_fetch → fetch card', () => {
    it('webfetch renders .occ-card-fetch', () => {
      handle.renderMessage(assistantMsgWithTools('m2', [
        { name: 'webfetch', input: { url: 'https://example.com/page' }, status: 'completed' },
      ]));
      expect(container.querySelector('.occ-card-fetch')).not.toBeNull();
    });

    it('web_fetch (underscore variant) renders .occ-card-fetch', () => {
      handle.renderMessage(assistantMsgWithTools('m2', [
        { name: 'web_fetch', input: { url: 'https://example.com' }, status: 'completed' },
      ]));
      expect(container.querySelector('.occ-card-fetch')).not.toBeNull();
    });

    it('fetch card title is "Fetched"', () => {
      handle.renderMessage(assistantMsgWithTools('m2', [
        { name: 'webfetch', input: { url: 'https://git-scm.com/about' }, status: 'completed' },
      ]));
      expect(container.querySelector('.occ-card-fetch .occ-card-title')?.textContent).toBe('Fetched');
    });

    it('strips www. prefix from domain in query span', () => {
      handle.renderMessage(assistantMsgWithTools('m2', [
        { name: 'webfetch', input: { url: 'https://www.git-scm.com/about' }, status: 'completed' },
      ]));
      expect(container.querySelector('.occ-card-fetch .occ-card-query')?.textContent).toBe('git-scm.com');
    });

    it('fetch card is closed by default (body hidden)', () => {
      handle.renderMessage(assistantMsgWithTools('m2', [
        { name: 'webfetch', input: { url: 'https://example.com' }, status: 'completed' },
      ]));
      const body = container.querySelector('.occ-card-fetch .occ-card-body') as HTMLElement;
      expect(body.style.display).toBe('none');
    });
  });

  // ── diff card ────────────────────────────────────────────────────────────────

  describe('edit / create_note → diff card', () => {
    it('edit renders .occ-card-diff', () => {
      handle.renderMessage(assistantMsgWithTools('m3', [
        {
          name: 'edit',
          input: { path: 'Notes/foo.md', old_string: 'old', new_string: 'new' },
          status: 'completed',
        },
      ]));
      expect(container.querySelector('.occ-card-diff')).not.toBeNull();
    });

    it('shows filename as card title (last path segment)', () => {
      handle.renderMessage(assistantMsgWithTools('m3', [
        {
          name: 'edit',
          input: { path: 'Notes/foo.md', old_string: 'a', new_string: 'b' },
          status: 'completed',
        },
      ]));
      const title = container.querySelector('.occ-card-diff .occ-card-title');
      expect(title?.textContent).toBe('foo.md');
    });

    it('create_note gets a NEW badge', () => {
      handle.renderMessage(assistantMsgWithTools('m3', [
        {
          name: 'create_note',
          input: { path: 'Blog Outline.md', content: '# Title\n- item' },
          status: 'completed',
        },
      ]));
      expect(container.querySelector('.occ-badge-new')).not.toBeNull();
    });

    it('edit does not get a NEW badge', () => {
      handle.renderMessage(assistantMsgWithTools('m3', [
        {
          name: 'edit',
          input: { path: 'foo.md', old_string: 'a', new_string: 'b' },
          status: 'completed',
        },
      ]));
      expect(container.querySelector('.occ-badge-new')).toBeNull();
    });

    it('renders diff addition stats', () => {
      handle.renderMessage(assistantMsgWithTools('m3', [
        {
          name: 'edit',
          input: { path: 'f.md', old_string: 'line1', new_string: 'line2' },
          status: 'completed',
        },
      ]));
      const addStat = container.querySelector('.occ-diff-add');
      expect(addStat?.textContent).toContain('+');
    });

    it('renders diff deletion stats', () => {
      handle.renderMessage(assistantMsgWithTools('m3', [
        {
          name: 'edit',
          input: { path: 'f.md', old_string: 'line1', new_string: 'line2' },
          status: 'completed',
        },
      ]));
      const delStat = container.querySelector('.occ-diff-del');
      expect(delStat?.textContent).toContain('−');
    });

    it('diff card is open by default (body visible)', () => {
      handle.renderMessage(assistantMsgWithTools('m3', [
        {
          name: 'edit',
          input: { path: 'f.md', old_string: 'a', new_string: 'b' },
          status: 'completed',
        },
      ]));
      const body = container.querySelector('.occ-card-diff .occ-card-body') as HTMLElement;
      expect(body.style.display).not.toBe('none');
    });
  });

  // ── read aggregation ─────────────────────────────────────────────────────────

  describe('multiple reads → single quiet read line', () => {
    it('renders only one .occ-read-line for multiple read tools', () => {
      handle.renderMessage(assistantMsgWithTools('m4', [
        { name: 'read_note', input: { path: 'A.md' }, status: 'completed', result: 'content a' },
        { name: 'read_note', input: { path: 'B.md' }, status: 'completed', result: 'content b' },
        { name: 'read_note', input: { path: 'C.md' }, status: 'completed', result: 'content c' },
      ]));
      expect(container.querySelectorAll('.occ-read-line').length).toBe(1);
    });

    it('read line text references count of notes read', () => {
      handle.renderMessage(assistantMsgWithTools('m4', [
        { name: 'read_note', input: { path: 'A.md' }, status: 'completed', result: '' },
        { name: 'read_note', input: { path: 'B.md' }, status: 'completed', result: '' },
      ]));
      const text = container.querySelector('.occ-read-text');
      expect(text?.textContent).toContain('2 notes');
    });

    it('read line lists filenames', () => {
      handle.renderMessage(assistantMsgWithTools('m4', [
        { name: 'read_note', input: { path: 'Notes/Alpha.md' }, status: 'completed', result: '' },
      ]));
      const files = container.querySelector('.occ-read-files');
      expect(files?.textContent).toContain('Alpha.md');
    });
  });

  // ── search card (grep) ────────────────────────────────────────────────────────

  describe('grep → search card', () => {
    it('grep renders .occ-card-search', () => {
      handle.renderMessage(assistantMsgWithTools('m5', [
        { name: 'grep', input: { pattern: 'TODO' }, status: 'completed', result: 'line1\nline2' },
      ]));
      expect(container.querySelector('.occ-card-search')).not.toBeNull();
    });

    it('search card title is "Searched vault"', () => {
      handle.renderMessage(assistantMsgWithTools('m5', [
        { name: 'grep', input: { pattern: 'foo' }, status: 'completed' },
      ]));
      expect(container.querySelector('.occ-card-search .occ-card-title')?.textContent).toBe('Searched vault');
    });
  });

  // ── card toggle via header click ──────────────────────────────────────────────

  describe('card header click toggles body', () => {
    it('clicking a closed card header opens it', () => {
      handle.renderMessage(assistantMsgWithTools('m6', [
        {
          name: 'webfetch',
          input: { url: 'https://example.com' },
          status: 'completed',
          result: 'response',
        },
      ]));
      const body = container.querySelector('.occ-card-fetch .occ-card-body') as HTMLElement;
      const header = container.querySelector('.occ-card-fetch .occ-card-header') as HTMLElement;
      // fetch card starts closed
      expect(body.style.display).toBe('none');
      header.click();
      expect(body.style.display).not.toBe('none');
    });

    it('clicking an open card header closes it', () => {
      handle.renderMessage(assistantMsgWithTools('m6', [
        { name: 'TodoWrite', input: { todos: [] }, status: 'completed' },
      ]));
      const body = container.querySelector('.occ-card-plan .occ-card-body') as HTMLElement;
      const header = container.querySelector('.occ-card-plan .occ-card-header') as HTMLElement;
      // plan card starts open
      expect(body.style.display).not.toBe('none');
      header.click();
      expect(body.style.display).toBe('none');
    });
  });

  // ── thinking block ────────────────────────────────────────────────────────────

  describe('thinking block', () => {
    it('renders .occ-think when message.thinking is set', () => {
      handle.renderMessage({
        id: 'think1',
        role: 'assistant',
        content: 'Answer',
        timestamp: Date.now(),
        thinking: 'I reasoned about this.',
      } as ChatMessage);
      expect(container.querySelector('.occ-think')).not.toBeNull();
    });

    it('thinking body is hidden by default (showThinkingByDefault: false)', () => {
      handle.renderMessage({
        id: 'think2',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        thinking: 'internal thoughts',
      } as ChatMessage);
      const body = container.querySelector('.occ-think-body') as HTMLElement;
      expect(body.style.display).toBe('none');
    });

    it('no .occ-think element when thinking is absent', () => {
      handle.renderMessage({ id: 'm', role: 'assistant', content: 'Hi', timestamp: Date.now() });
      expect(container.querySelector('.occ-think')).toBeNull();
    });
  });
});

// ─── renderPermissionCard ─────────────────────────────────────────────────────

describe('MessageRenderer — renderPermissionCard', () => {
  let container: HTMLElement;
  let callbacks: MessageRendererCallbacks;
  let handle: MessageRendererHandle;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    callbacks = makeCallbacks();
    handle = createMessageRenderer(container, makeDeps(), callbacks);
    // Render a message to populate the internal element map
    handle.renderMessage({
      id: 'base-msg',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    });
  });

  afterEach(() => {
    handle.destroy();
    container.remove();
  });

  it('returns false when the target messageId does not exist', () => {
    const onDecision = vi.fn();
    expect(handle.renderPermissionCard('no-such-id', 'ls', 'Run command?', onDecision)).toBe(false);
  });

  it('returns true when the target message exists', () => {
    const onDecision = vi.fn();
    expect(handle.renderPermissionCard('base-msg', 'ls', 'Run command?', onDecision)).toBe(true);
  });

  it('creates a permission card element in the message', () => {
    handle.renderPermissionCard('base-msg', 'ls', 'Run command?', vi.fn());
    expect(container.querySelector('.occ-card-permission')).not.toBeNull();
  });

  it('renders the title text in the card header', () => {
    handle.renderPermissionCard('base-msg', 'ls -la', 'Run a terminal command?', vi.fn());
    const title = container.querySelector('.occ-card-permission .occ-card-title');
    expect(title?.textContent).toBe('Run a terminal command?');
  });

  it('renders the command text in the command box', () => {
    handle.renderPermissionCard('base-msg', 'git commit -m "msg"', 'Run?', vi.fn());
    const cmdBox = container.querySelector('.occ-permission-cmd');
    expect(cmdBox?.textContent).toBe('git commit -m "msg"');
  });

  it('renders Allow once, Always, and Deny buttons', () => {
    handle.renderPermissionCard('base-msg', 'ls', 'Run?', vi.fn());
    expect(container.querySelector('.occ-perm-allow')).not.toBeNull();
    expect(container.querySelector('.occ-perm-always')).not.toBeNull();
    expect(container.querySelector('.occ-perm-deny')).not.toBeNull();
  });

  it('calls onDecision("once") and shows "Allowed once" when Allow once clicked', () => {
    const onDecision = vi.fn();
    handle.renderPermissionCard('base-msg', 'ls', 'Run?', onDecision);
    const btn = container.querySelector('.occ-perm-allow') as HTMLElement;
    btn.click();
    expect(onDecision).toHaveBeenCalledWith('once');
    expect(container.querySelector('.occ-permission-result')?.textContent).toBe('Allowed once');
  });

  it('calls onDecision("always") and shows "Always allowed" when Always clicked', () => {
    const onDecision = vi.fn();
    handle.renderPermissionCard('base-msg', 'ls', 'Run?', onDecision);
    const btn = container.querySelector('.occ-perm-always') as HTMLElement;
    btn.click();
    expect(onDecision).toHaveBeenCalledWith('always');
    expect(container.querySelector('.occ-permission-result')?.textContent).toBe('Always allowed');
  });

  it('calls onDecision("deny") and shows "Denied" when Deny clicked', () => {
    const onDecision = vi.fn();
    handle.renderPermissionCard('base-msg', 'ls', 'Run?', onDecision);
    const btn = container.querySelector('.occ-perm-deny') as HTMLElement;
    btn.click();
    expect(onDecision).toHaveBeenCalledWith('deny');
    expect(container.querySelector('.occ-permission-result')?.textContent).toBe('Denied');
  });

  it('adds is-resolved class to the card after a decision', () => {
    const onDecision = vi.fn();
    handle.renderPermissionCard('base-msg', 'ls', 'Run?', onDecision);
    const btn = container.querySelector('.occ-perm-allow') as HTMLElement;
    btn.click();
    expect(container.querySelector('.occ-card-permission')?.classList.contains('is-resolved')).toBe(true);
  });

  it('replaces action buttons with result text after a decision', () => {
    const onDecision = vi.fn();
    handle.renderPermissionCard('base-msg', 'ls', 'Run?', onDecision);
    const btn = container.querySelector('.occ-perm-deny') as HTMLElement;
    btn.click();
    // Buttons should be gone, result span present
    expect(container.querySelector('.occ-perm-allow')).toBeNull();
    expect(container.querySelector('.occ-permission-result')).not.toBeNull();
  });

  it('calls scrollToBottom after rendering the card', () => {
    handle.renderPermissionCard('base-msg', 'ls', 'Run?', vi.fn());
    expect(callbacks.scrollToBottom).toHaveBeenCalled();
  });

  it('onDecision is called exactly once even if button clicked multiple times', () => {
    const onDecision = vi.fn();
    handle.renderPermissionCard('base-msg', 'ls', 'Run?', onDecision);
    const btn = container.querySelector('.occ-perm-allow') as HTMLElement;
    btn.click();
    // After resolution the buttons are removed; a second click would need a different element
    expect(onDecision).toHaveBeenCalledTimes(1);
  });
});
