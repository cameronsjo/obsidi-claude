# ChatView Refactoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract the monolithic 5,425-line chatView.ts into cohesive, testable modules with clear responsibilities and minimal coupling.

**Architecture:** Factory-based module pattern where each module exports a `create*()` function returning a handle interface. Modules receive dependencies and callbacks for parent communication, following the pattern from the previously-attempted (and reverted) refactoring.

**Tech Stack:** TypeScript, Obsidian API, Vitest for testing

---

## Background

A previous refactoring attempt (commit `1aaa159`) extracted 8 modules totaling 2,309 lines but was reverted (`8d6e08c`). This plan learns from that attempt while addressing its potential issues:

1. Incremental extraction with tests at each step (TDD)
2. Clear dependency injection patterns
3. Each module is independently testable
4. Explicit callback contracts between modules

## Module Architecture

```
src/chatView/
  types.ts              - Shared types and interfaces
  index.ts              - Module exports
  messageRenderer.ts    - Message display, tool calls, code blocks
  inputArea.ts          - Text input, voice, autocomplete, images
  historyPanel.ts       - Conversation list, search, tags, bulk ops
  searchBar.ts          - In-message search and navigation
  queuePanel.ts         - Message queue display
  statusBar.ts          - Backend/context badges, token counter
  tabBar.ts             - Multi-conversation tabs
  mobileSupport.ts      - Touch gestures, FAB

tests/chatView/
  messageRenderer.test.ts
  inputArea.test.ts
  historyPanel.test.ts
  searchBar.test.ts
  queuePanel.test.ts
  statusBar.test.ts
  tabBar.test.ts
  mobileSupport.test.ts
```

---

## Task 1: Create Module Foundation Types

**Files:**
- Create: `src/chatView/types.ts`
- Create: `src/chatView/index.ts`
- Create: `tests/chatView/types.test.ts`

**Step 1: Write the test for module types**

```typescript
// tests/chatView/types.test.ts
import { describe, it, expect } from 'vitest';
import type {
  ModuleDeps,
  ModuleHandle,
  ConversationMeta,
} from '../../src/chatView/types';

describe('ChatView module types', () => {
  it('should define ModuleDeps interface with required properties', () => {
    // Type-level test - if this compiles, types are correct
    const deps: ModuleDeps = {
      app: {} as any,
      plugin: {} as any,
    };
    expect(deps).toBeDefined();
  });

  it('should define ModuleHandle with destroy method', () => {
    const handle: ModuleHandle = {
      destroy: () => {},
    };
    expect(typeof handle.destroy).toBe('function');
  });

  it('should define ConversationMeta with required fields', () => {
    const meta: ConversationMeta = {
      id: 'test-id',
      title: 'Test Conversation',
      messageCount: 5,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(meta.id).toBe('test-id');
    expect(meta.title).toBe('Test Conversation');
    expect(meta.messageCount).toBe(5);
  });

  it('should allow optional fields on ConversationMeta', () => {
    const meta: ConversationMeta = {
      id: 'test-id',
      title: 'Test',
      messageCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: ['work', 'urgent'],
      pinned: true,
      preview: 'Hello...',
    };
    expect(meta.tags).toEqual(['work', 'urgent']);
    expect(meta.pinned).toBe(true);
    expect(meta.preview).toBe('Hello...');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/chatView/types.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Create the types module**

```typescript
// src/chatView/types.ts
/**
 * Shared types for ChatView modules.
 */
import type { App } from 'obsidian';
import type ObsidiClaudePlugin from '../../main';
import type {
  ChatMessage,
  Conversation,
  ToolCallInfo,
  ImageAttachment,
  MessageReaction,
  ChatTab,
  ConversationUsage,
} from '../types';

// Re-export for convenience
export type {
  ChatMessage,
  Conversation,
  ToolCallInfo,
  ImageAttachment,
  MessageReaction,
  ChatTab,
  ConversationUsage,
};

/**
 * Conversation metadata for history list display.
 */
export interface ConversationMeta {
  id: string;
  title: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
  tags?: string[];
  pinned?: boolean;
  preview?: string;
}

/**
 * Common dependencies passed to all modules.
 */
export interface ModuleDeps {
  app: App;
  plugin: ObsidiClaudePlugin;
}

/**
 * Base handle interface for all UI modules.
 */
export interface ModuleHandle {
  destroy(): void;
}
```

**Step 4: Create the index module**

```typescript
// src/chatView/index.ts
/**
 * ChatView modules index.
 * Re-exports all chatView modules for convenient importing.
 */

export * from './types';
```

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/chatView/types.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/chatView/types.ts src/chatView/index.ts tests/chatView/types.test.ts
git commit -m "$(cat <<'EOF'
feat(chatView): add module foundation types

Establish shared types and interfaces for ChatView module extraction:
- ModuleDeps for dependency injection
- ModuleHandle base interface with destroy()
- ConversationMeta for history list items

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Extract Search Bar Module

**Why start here:** Search bar is the smallest (212 lines), most self-contained module with minimal external dependencies. Perfect for establishing the pattern.

**Files:**
- Create: `src/chatView/searchBar.ts`
- Create: `tests/chatView/searchBar.test.ts`
- Modify: `src/chatView/index.ts`

**Step 1: Write tests for search bar**

```typescript
// tests/chatView/searchBar.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSearchBar, type SearchBarHandle, type SearchBarCallbacks } from '../../src/chatView/searchBar';
import type { ModuleDeps } from '../../src/chatView/types';

// Mock Obsidian
vi.mock('obsidian', () => ({
  setIcon: vi.fn(),
}));

describe('SearchBar', () => {
  let container: HTMLElement;
  let deps: ModuleDeps;
  let callbacks: SearchBarCallbacks;
  let handle: SearchBarHandle;

  beforeEach(() => {
    container = document.createElement('div');
    deps = {
      app: {} as any,
      plugin: {} as any,
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
      // Mock multiple matches
      callbacks.getMessageContent = vi.fn((id) => 'test message');
      handle.search('test');
      handle.navigateNext();
      expect(callbacks.scrollToMessage).toHaveBeenCalled();
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
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/chatView/searchBar.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Implement search bar module**

```typescript
// src/chatView/searchBar.ts
/**
 * Search bar module for ChatView.
 * Provides message search and navigation functionality.
 */
import { setIcon } from 'obsidian';
import type { ModuleDeps, ModuleHandle } from './types';

export interface SearchBarCallbacks {
  getMessageIds: () => string[];
  getMessageContent: (id: string) => string;
  scrollToMessage: (id: string) => void;
  highlightMessage: (id: string) => void;
  clearHighlights: () => void;
}

export interface SearchBarHandle extends ModuleHandle {
  show(): void;
  hide(): void;
  toggle(): void;
  isVisible(): boolean;
  search(query: string): void;
  navigateNext(): void;
  navigatePrev(): void;
  clear(): void;
}

export function createSearchBar(
  container: HTMLElement,
  deps: ModuleDeps,
  callbacks: SearchBarCallbacks
): SearchBarHandle {
  // Internal state
  let visible = false;
  let query = '';
  let matches: string[] = [];
  let currentIndex = -1;

  // DOM elements
  const searchBar = container.createDiv('chat-search-bar');
  searchBar.style.display = 'none';

  const inputWrapper = searchBar.createDiv('search-input-wrapper');
  const searchInput = inputWrapper.createEl('input', {
    cls: 'search-input',
    attr: { type: 'text', placeholder: 'Search messages...' },
  });

  const resultsEl = inputWrapper.createSpan('search-results');
  resultsEl.style.display = 'none';

  const navButtons = searchBar.createDiv('search-nav');

  const prevBtn = navButtons.createEl('button', {
    cls: 'search-nav-btn',
    attr: { 'aria-label': 'Previous match' },
  });
  setIcon(prevBtn, 'chevron-up');
  prevBtn.onclick = () => navigatePrev();

  const nextBtn = navButtons.createEl('button', {
    cls: 'search-nav-btn',
    attr: { 'aria-label': 'Next match' },
  });
  setIcon(nextBtn, 'chevron-down');
  nextBtn.onclick = () => navigateNext();

  const closeBtn = navButtons.createEl('button', {
    cls: 'search-close-btn',
    attr: { 'aria-label': 'Close search' },
  });
  setIcon(closeBtn, 'x');
  closeBtn.onclick = () => hide();

  // Event handlers
  searchInput.addEventListener('input', () => {
    search(searchInput.value);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        navigatePrev();
      } else {
        navigateNext();
      }
    } else if (e.key === 'Escape') {
      hide();
    }
  });

  function show(): void {
    visible = true;
    searchBar.style.display = 'flex';
    searchInput.focus();
    searchInput.select();
  }

  function hide(): void {
    visible = false;
    searchBar.style.display = 'none';
    clear();
  }

  function toggle(): void {
    if (visible) {
      hide();
    } else {
      show();
    }
  }

  function isVisible(): boolean {
    return visible;
  }

  function search(newQuery: string): void {
    query = newQuery.toLowerCase().trim();
    matches = [];
    currentIndex = -1;
    callbacks.clearHighlights();

    if (!query) {
      resultsEl.style.display = 'none';
      return;
    }

    // Find matching messages
    const messageIds = callbacks.getMessageIds();
    for (const id of messageIds) {
      const content = callbacks.getMessageContent(id);
      if (content.toLowerCase().includes(query)) {
        matches.push(id);
      }
    }

    // Update results display
    if (matches.length > 0) {
      currentIndex = 0;
      resultsEl.textContent = `1 of ${matches.length}`;
      resultsEl.style.display = 'inline';
      callbacks.highlightMessage(matches[0]);
      callbacks.scrollToMessage(matches[0]);
    } else {
      resultsEl.textContent = 'No matches';
      resultsEl.style.display = 'inline';
    }
  }

  function navigateNext(): void {
    if (matches.length === 0) return;
    currentIndex = (currentIndex + 1) % matches.length;
    updateNavigation();
  }

  function navigatePrev(): void {
    if (matches.length === 0) return;
    currentIndex = (currentIndex - 1 + matches.length) % matches.length;
    updateNavigation();
  }

  function updateNavigation(): void {
    resultsEl.textContent = `${currentIndex + 1} of ${matches.length}`;
    callbacks.clearHighlights();
    callbacks.highlightMessage(matches[currentIndex]);
    callbacks.scrollToMessage(matches[currentIndex]);
  }

  function clear(): void {
    query = '';
    matches = [];
    currentIndex = -1;
    searchInput.value = '';
    resultsEl.style.display = 'none';
    callbacks.clearHighlights();
  }

  function destroy(): void {
    searchBar.remove();
  }

  return {
    show,
    hide,
    toggle,
    isVisible,
    search,
    navigateNext,
    navigatePrev,
    clear,
    destroy,
  };
}
```

**Step 4: Update index exports**

```typescript
// src/chatView/index.ts
/**
 * ChatView modules index.
 * Re-exports all chatView modules for convenient importing.
 */

export * from './types';
export * from './searchBar';
```

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/chatView/searchBar.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/chatView/searchBar.ts src/chatView/index.ts tests/chatView/searchBar.test.ts
git commit -m "$(cat <<'EOF'
feat(chatView): extract searchBar module

Extract message search functionality into standalone module:
- Search bar with keyboard navigation
- Match highlighting and navigation
- Callback-based integration with parent

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Extract Queue Panel Module

**Files:**
- Create: `src/chatView/queuePanel.ts`
- Create: `tests/chatView/queuePanel.test.ts`
- Modify: `src/chatView/index.ts`

**Step 1: Write tests for queue panel**

```typescript
// tests/chatView/queuePanel.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createQueuePanel, type QueuePanelHandle, type QueuePanelCallbacks, type QueuedMessage } from '../../src/chatView/queuePanel';
import type { ModuleDeps } from '../../src/chatView/types';

vi.mock('obsidian', () => ({
  setIcon: vi.fn(),
}));

describe('QueuePanel', () => {
  let container: HTMLElement;
  let deps: ModuleDeps;
  let callbacks: QueuePanelCallbacks;
  let handle: QueuePanelHandle;

  beforeEach(() => {
    container = document.createElement('div');
    deps = { app: {} as any, plugin: {} as any };
    callbacks = {
      onRemove: vi.fn(),
      onClear: vi.fn(),
    };
  });

  afterEach(() => {
    handle?.destroy();
  });

  describe('creation', () => {
    it('should create queue container', () => {
      handle = createQueuePanel(container, deps, callbacks);
      expect(container.querySelector('.chat-queue-container')).not.toBeNull();
    });

    it('should be hidden when empty', () => {
      handle = createQueuePanel(container, deps, callbacks);
      expect(handle.isVisible()).toBe(false);
    });
  });

  describe('adding items', () => {
    it('should show panel when item added', () => {
      handle = createQueuePanel(container, deps, callbacks);
      handle.add({ content: 'Test message', timestamp: Date.now() });
      expect(handle.isVisible()).toBe(true);
    });

    it('should display queued message', () => {
      handle = createQueuePanel(container, deps, callbacks);
      handle.add({ content: 'Test message', timestamp: Date.now() });
      expect(container.textContent).toContain('Test message');
    });

    it('should update badge count', () => {
      handle = createQueuePanel(container, deps, callbacks);
      handle.add({ content: 'First', timestamp: Date.now() });
      handle.add({ content: 'Second', timestamp: Date.now() });
      expect(handle.getCount()).toBe(2);
    });
  });

  describe('removing items', () => {
    it('should remove item and call callback', () => {
      handle = createQueuePanel(container, deps, callbacks);
      const msg = { content: 'Test', timestamp: Date.now() };
      handle.add(msg);
      handle.remove(0);
      expect(callbacks.onRemove).toHaveBeenCalledWith(0);
    });

    it('should hide panel when last item removed', () => {
      handle = createQueuePanel(container, deps, callbacks);
      handle.add({ content: 'Test', timestamp: Date.now() });
      handle.remove(0);
      expect(handle.isVisible()).toBe(false);
    });
  });

  describe('clearing', () => {
    it('should clear all items', () => {
      handle = createQueuePanel(container, deps, callbacks);
      handle.add({ content: 'First', timestamp: Date.now() });
      handle.add({ content: 'Second', timestamp: Date.now() });
      handle.clear();
      expect(handle.getCount()).toBe(0);
      expect(callbacks.onClear).toHaveBeenCalled();
    });
  });

  describe('getting next item', () => {
    it('should return and remove first item', () => {
      handle = createQueuePanel(container, deps, callbacks);
      handle.add({ content: 'First', timestamp: 1000 });
      handle.add({ content: 'Second', timestamp: 2000 });
      const next = handle.getNext();
      expect(next?.content).toBe('First');
      expect(handle.getCount()).toBe(1);
    });

    it('should return null when empty', () => {
      handle = createQueuePanel(container, deps, callbacks);
      expect(handle.getNext()).toBeNull();
    });
  });

  describe('destruction', () => {
    it('should clean up DOM', () => {
      handle = createQueuePanel(container, deps, callbacks);
      handle.destroy();
      expect(container.innerHTML).toBe('');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/chatView/queuePanel.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Implement queue panel module**

```typescript
// src/chatView/queuePanel.ts
/**
 * Queue panel module for ChatView.
 * Displays queued messages when agent is busy.
 */
import { setIcon } from 'obsidian';
import type { ModuleDeps, ModuleHandle } from './types';

export interface QueuedMessage {
  content: string;
  timestamp: number;
}

export interface QueuePanelCallbacks {
  onRemove: (index: number) => void;
  onClear: () => void;
}

export interface QueuePanelHandle extends ModuleHandle {
  add(message: QueuedMessage): void;
  remove(index: number): void;
  clear(): void;
  getNext(): QueuedMessage | null;
  getCount(): number;
  isVisible(): boolean;
  updateBadge(count: number): void;
}

export function createQueuePanel(
  container: HTMLElement,
  deps: ModuleDeps,
  callbacks: QueuePanelCallbacks
): QueuePanelHandle {
  // Internal state
  const queue: QueuedMessage[] = [];

  // DOM elements
  const queueContainer = container.createDiv('chat-queue-container');
  queueContainer.style.display = 'none';

  const header = queueContainer.createDiv('queue-header');
  const titleWrapper = header.createDiv('queue-title-wrapper');

  const badge = titleWrapper.createSpan('queue-badge');
  badge.textContent = '0';

  titleWrapper.createSpan({ text: ' messages queued' });

  const clearBtn = header.createEl('button', {
    cls: 'queue-clear-btn',
    attr: { 'aria-label': 'Clear queue' },
  });
  setIcon(clearBtn, 'trash-2');
  clearBtn.onclick = () => {
    clear();
    callbacks.onClear();
  };

  const listContainer = queueContainer.createDiv('queue-list');

  function render(): void {
    listContainer.empty();

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      const itemEl = listContainer.createDiv('queue-item');

      const contentEl = itemEl.createDiv('queue-item-content');
      contentEl.textContent = item.content.length > 50
        ? item.content.slice(0, 50) + '...'
        : item.content;

      const removeBtn = itemEl.createEl('button', {
        cls: 'queue-item-remove',
        attr: { 'aria-label': 'Remove from queue' },
      });
      setIcon(removeBtn, 'x');
      const index = i;
      removeBtn.onclick = () => {
        remove(index);
        callbacks.onRemove(index);
      };
    }

    badge.textContent = String(queue.length);
    queueContainer.style.display = queue.length > 0 ? 'block' : 'none';
  }

  function add(message: QueuedMessage): void {
    queue.push(message);
    render();
  }

  function remove(index: number): void {
    if (index >= 0 && index < queue.length) {
      queue.splice(index, 1);
      render();
    }
  }

  function clear(): void {
    queue.length = 0;
    render();
  }

  function getNext(): QueuedMessage | null {
    if (queue.length === 0) return null;
    const next = queue.shift()!;
    render();
    return next;
  }

  function getCount(): number {
    return queue.length;
  }

  function isVisible(): boolean {
    return queue.length > 0;
  }

  function updateBadge(count: number): void {
    badge.textContent = String(count);
  }

  function destroy(): void {
    queueContainer.remove();
  }

  return {
    add,
    remove,
    clear,
    getNext,
    getCount,
    isVisible,
    updateBadge,
    destroy,
  };
}
```

**Step 4: Update index exports**

Add to `src/chatView/index.ts`:
```typescript
export * from './queuePanel';
```

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/chatView/queuePanel.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/chatView/queuePanel.ts src/chatView/index.ts tests/chatView/queuePanel.test.ts
git commit -m "$(cat <<'EOF'
feat(chatView): extract queuePanel module

Extract message queue display into standalone module:
- Queue display with add/remove/clear
- Badge count updates
- FIFO message retrieval

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Extract Status Bar Module

**Files:**
- Create: `src/chatView/statusBar.ts`
- Create: `tests/chatView/statusBar.test.ts`
- Modify: `src/chatView/index.ts`

**Step 1: Write tests for status bar**

```typescript
// tests/chatView/statusBar.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createStatusBar, type StatusBarHandle, type StatusBarCallbacks } from '../../src/chatView/statusBar';
import type { ModuleDeps } from '../../src/chatView/types';

vi.mock('obsidian', () => ({
  setIcon: vi.fn(),
}));

describe('StatusBar', () => {
  let container: HTMLElement;
  let deps: ModuleDeps;
  let callbacks: StatusBarCallbacks;
  let handle: StatusBarHandle;

  beforeEach(() => {
    container = document.createElement('div');
    deps = { app: {} as any, plugin: {} as any };
    callbacks = {
      onBackendClick: vi.fn(),
      onContextClick: vi.fn(),
      onAccountClick: vi.fn(),
      onTokenCounterClick: vi.fn(),
      getBackendInfo: vi.fn(() => ({ type: 'api', label: 'API' })),
      getActiveNoteInfo: vi.fn(() => null),
      getAccountInfo: vi.fn(() => null),
      getTokenEstimate: vi.fn(() => ({ tokens: 100, cost: 0.01 })),
    };
  });

  afterEach(() => {
    handle?.destroy();
  });

  describe('creation', () => {
    it('should create status container', () => {
      handle = createStatusBar(container, deps, callbacks);
      expect(container.querySelector('.chat-badges')).not.toBeNull();
    });

    it('should create backend badge', () => {
      handle = createStatusBar(container, deps, callbacks);
      expect(container.querySelector('.backend-badge')).not.toBeNull();
    });
  });

  describe('backend badge', () => {
    it('should display backend type', () => {
      handle = createStatusBar(container, deps, callbacks);
      handle.updateBackend({ type: 'sdk', label: 'Claude CLI' });
      const badge = container.querySelector('.backend-badge');
      expect(badge?.textContent).toContain('Claude CLI');
    });

    it('should call callback on click', () => {
      handle = createStatusBar(container, deps, callbacks);
      const badge = container.querySelector('.backend-badge') as HTMLElement;
      badge?.click();
      expect(callbacks.onBackendClick).toHaveBeenCalled();
    });
  });

  describe('context badge', () => {
    it('should show when note is active', () => {
      handle = createStatusBar(container, deps, callbacks);
      handle.updateContext({ path: 'notes/test.md', title: 'Test Note' });
      const badge = container.querySelector('.context-badge');
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toContain('Test Note');
    });

    it('should hide when no note', () => {
      handle = createStatusBar(container, deps, callbacks);
      handle.updateContext(null);
      const badge = container.querySelector('.context-badge') as HTMLElement;
      expect(badge?.style.display).toBe('none');
    });
  });

  describe('token counter', () => {
    it('should display token estimate', () => {
      handle = createStatusBar(container, deps, callbacks);
      handle.updateTokens({ tokens: 500, cost: 0.05 });
      const counter = container.querySelector('.token-counter');
      expect(counter?.textContent).toContain('500');
    });

    it('should format cost correctly', () => {
      handle = createStatusBar(container, deps, callbacks);
      handle.updateTokens({ tokens: 1000, cost: 0.123 });
      const counter = container.querySelector('.token-counter');
      expect(counter?.textContent).toContain('$0.12');
    });
  });

  describe('ephemeral badge', () => {
    it('should show when ephemeral mode active', () => {
      handle = createStatusBar(container, deps, callbacks);
      handle.updateEphemeral(true);
      const badge = container.querySelector('.ephemeral-badge');
      expect(badge).not.toBeNull();
    });

    it('should hide when ephemeral mode inactive', () => {
      handle = createStatusBar(container, deps, callbacks);
      handle.updateEphemeral(false);
      const badge = container.querySelector('.ephemeral-badge') as HTMLElement;
      expect(badge?.style.display).toBe('none');
    });
  });

  describe('destruction', () => {
    it('should clean up DOM', () => {
      handle = createStatusBar(container, deps, callbacks);
      handle.destroy();
      expect(container.innerHTML).toBe('');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/chatView/statusBar.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Implement status bar module**

```typescript
// src/chatView/statusBar.ts
/**
 * Status bar module for ChatView.
 * Displays backend, context, account badges and token counter.
 */
import { setIcon } from 'obsidian';
import type { ModuleDeps, ModuleHandle } from './types';

export interface BackendInfo {
  type: string;
  label: string;
}

export interface ContextInfo {
  path: string;
  title: string;
}

export interface AccountInfo {
  name?: string;
  email?: string;
  tier?: string;
}

export interface TokenInfo {
  tokens: number;
  cost: number;
}

export interface StatusBarCallbacks {
  onBackendClick: () => void;
  onContextClick: () => void;
  onAccountClick: () => void;
  onTokenCounterClick: () => void;
  getBackendInfo: () => BackendInfo;
  getActiveNoteInfo: () => ContextInfo | null;
  getAccountInfo: () => AccountInfo | null;
  getTokenEstimate: () => TokenInfo;
}

export interface StatusBarHandle extends ModuleHandle {
  updateBackend(info: BackendInfo): void;
  updateContext(info: ContextInfo | null): void;
  updateAccount(info: AccountInfo | null): void;
  updateTokens(info: TokenInfo): void;
  updateEphemeral(active: boolean): void;
  refresh(): void;
}

export function createStatusBar(
  container: HTMLElement,
  deps: ModuleDeps,
  callbacks: StatusBarCallbacks
): StatusBarHandle {
  // DOM elements
  const badgesContainer = container.createDiv('chat-badges');

  // Backend badge
  const backendBadge = badgesContainer.createDiv('chat-badge backend-badge');
  backendBadge.onclick = () => callbacks.onBackendClick();
  const backendIcon = backendBadge.createSpan('badge-icon');
  setIcon(backendIcon, 'cpu');
  const backendLabel = backendBadge.createSpan('badge-label');

  // Context badge
  const contextBadge = badgesContainer.createDiv('chat-badge context-badge');
  contextBadge.style.display = 'none';
  contextBadge.onclick = () => callbacks.onContextClick();
  const contextIcon = contextBadge.createSpan('badge-icon');
  setIcon(contextIcon, 'file-text');
  const contextLabel = contextBadge.createSpan('badge-label');

  // Account badge
  const accountBadge = badgesContainer.createDiv('chat-badge account-badge');
  accountBadge.style.display = 'none';
  accountBadge.onclick = () => callbacks.onAccountClick();
  const accountIcon = accountBadge.createSpan('badge-icon');
  setIcon(accountIcon, 'user');
  const accountLabel = accountBadge.createSpan('badge-label');

  // Ephemeral badge
  const ephemeralBadge = badgesContainer.createDiv('chat-badge ephemeral-badge');
  ephemeralBadge.style.display = 'none';
  const ephemeralIcon = ephemeralBadge.createSpan('badge-icon');
  setIcon(ephemeralIcon, 'ghost');
  ephemeralBadge.createSpan({ text: 'Ephemeral', cls: 'badge-label' });

  // Token counter
  const tokenCounter = badgesContainer.createDiv('chat-token-counter');
  tokenCounter.onclick = () => callbacks.onTokenCounterClick();

  function updateBackend(info: BackendInfo): void {
    backendLabel.textContent = info.label;
    backendBadge.setAttribute('data-type', info.type);
  }

  function updateContext(info: ContextInfo | null): void {
    if (info) {
      contextLabel.textContent = info.title;
      contextBadge.setAttribute('title', info.path);
      contextBadge.style.display = 'flex';
    } else {
      contextBadge.style.display = 'none';
    }
  }

  function updateAccount(info: AccountInfo | null): void {
    if (info && (info.name || info.email)) {
      accountLabel.textContent = info.name || info.email || 'Account';
      accountBadge.style.display = 'flex';
    } else {
      accountBadge.style.display = 'none';
    }
  }

  function updateTokens(info: TokenInfo): void {
    const costStr = info.cost >= 0.01
      ? `$${info.cost.toFixed(2)}`
      : info.cost > 0
        ? `$${info.cost.toFixed(4)}`
        : '$0.00';
    tokenCounter.textContent = `~${info.tokens} tokens (${costStr})`;
  }

  function updateEphemeral(active: boolean): void {
    ephemeralBadge.style.display = active ? 'flex' : 'none';
  }

  function refresh(): void {
    updateBackend(callbacks.getBackendInfo());
    updateContext(callbacks.getActiveNoteInfo());
    updateAccount(callbacks.getAccountInfo());
    updateTokens(callbacks.getTokenEstimate());
  }

  function destroy(): void {
    badgesContainer.remove();
  }

  // Initial render
  refresh();

  return {
    updateBackend,
    updateContext,
    updateAccount,
    updateTokens,
    updateEphemeral,
    refresh,
    destroy,
  };
}
```

**Step 4: Update index exports**

Add to `src/chatView/index.ts`:
```typescript
export * from './statusBar';
```

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/chatView/statusBar.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/chatView/statusBar.ts src/chatView/index.ts tests/chatView/statusBar.test.ts
git commit -m "$(cat <<'EOF'
feat(chatView): extract statusBar module

Extract status badges and token counter into standalone module:
- Backend, context, account, ephemeral badges
- Token counter with cost display
- Click handlers for each badge

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Extract Mobile Support Module

**Files:**
- Create: `src/chatView/mobileSupport.ts`
- Create: `tests/chatView/mobileSupport.test.ts`
- Modify: `src/chatView/index.ts`

**Step 1: Write tests for mobile support**

```typescript
// tests/chatView/mobileSupport.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createMobileSupport, type MobileSupportHandle, type MobileSupportCallbacks } from '../../src/chatView/mobileSupport';
import type { ModuleDeps } from '../../src/chatView/types';

vi.mock('obsidian', () => ({
  setIcon: vi.fn(),
  Platform: {
    isMobile: false,
  },
}));

describe('MobileSupport', () => {
  let container: HTMLElement;
  let deps: ModuleDeps;
  let callbacks: MobileSupportCallbacks;
  let handle: MobileSupportHandle;

  beforeEach(() => {
    container = document.createElement('div');
    deps = { app: {} as any, plugin: {} as any };
    callbacks = {
      onNewConversation: vi.fn(),
      onSwipeLeft: vi.fn(),
      onSwipeRight: vi.fn(),
      isMobile: vi.fn(() => false),
    };
  });

  afterEach(() => {
    handle?.destroy();
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

    it('should call new conversation on FAB click', () => {
      callbacks.isMobile = vi.fn(() => true);
      handle = createMobileSupport(container, deps, callbacks);
      const fab = container.querySelector('.mobile-fab') as HTMLElement;
      fab?.click();
      expect(callbacks.onNewConversation).toHaveBeenCalled();
    });
  });

  describe('platform detection', () => {
    it('should report mobile status correctly', () => {
      callbacks.isMobile = vi.fn(() => true);
      handle = createMobileSupport(container, deps, callbacks);
      expect(handle.isMobile()).toBe(true);
    });
  });

  describe('swipe hint', () => {
    it('should add swipe hint on mobile', () => {
      callbacks.isMobile = vi.fn(() => true);
      handle = createMobileSupport(container, deps, callbacks);
      handle.showSwipeHint(container);
      expect(container.querySelector('.mobile-swipe-hint')).not.toBeNull();
    });

    it('should not add swipe hint on desktop', () => {
      callbacks.isMobile = vi.fn(() => false);
      handle = createMobileSupport(container, deps, callbacks);
      handle.showSwipeHint(container);
      expect(container.querySelector('.mobile-swipe-hint')).toBeNull();
    });
  });

  describe('destruction', () => {
    it('should clean up FAB on destroy', () => {
      callbacks.isMobile = vi.fn(() => true);
      handle = createMobileSupport(container, deps, callbacks);
      handle.destroy();
      expect(container.querySelector('.mobile-fab')).toBeNull();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/chatView/mobileSupport.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Implement mobile support module**

```typescript
// src/chatView/mobileSupport.ts
/**
 * Mobile support module for ChatView.
 * Provides touch gestures, FAB, and mobile-specific UI.
 */
import { setIcon } from 'obsidian';
import type { ModuleDeps, ModuleHandle } from './types';

export interface MobileSupportCallbacks {
  onNewConversation: () => void;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  isMobile: () => boolean;
}

export interface MobileSupportHandle extends ModuleHandle {
  isMobile(): boolean;
  showSwipeHint(container: HTMLElement): void;
  setupTouchHandling(container: HTMLElement): void;
}

export function createMobileSupport(
  container: HTMLElement,
  deps: ModuleDeps,
  callbacks: MobileSupportCallbacks
): MobileSupportHandle {
  let fab: HTMLElement | null = null;
  let touchStartX = 0;
  let touchStartY = 0;
  const SWIPE_THRESHOLD = 50;

  function isMobile(): boolean {
    return callbacks.isMobile();
  }

  // Create FAB only on mobile
  if (isMobile()) {
    fab = container.createDiv('mobile-fab');
    fab.setAttribute('aria-label', 'New conversation');
    setIcon(fab, 'plus');
    fab.onclick = () => callbacks.onNewConversation();
  }

  function showSwipeHint(targetContainer: HTMLElement): void {
    if (!isMobile()) return;

    const hint = targetContainer.createDiv('mobile-swipe-hint');
    hint.style.cssText = 'display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; padding: 2rem; text-align: center; color: var(--text-muted);';

    const icon = hint.createDiv();
    icon.style.cssText = 'font-size: 2rem; margin-bottom: 1rem;';
    setIcon(icon, 'message-circle');

    const title = hint.createEl('h3', { text: 'Chat with Claude' });
    title.style.cssText = 'margin: 0 0 0.5rem 0; color: var(--text-normal);';

    hint.createDiv({ text: 'Swipe left for history' }).style.cssText = 'font-size: 0.9rem;';
  }

  function setupTouchHandling(targetContainer: HTMLElement): void {
    if (!isMobile()) return;

    targetContainer.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    targetContainer.addEventListener('touchend', (e) => {
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const deltaX = touchEndX - touchStartX;
      const deltaY = Math.abs(touchEndY - touchStartY);

      // Only trigger swipe if horizontal movement is significant and vertical is minimal
      if (Math.abs(deltaX) > SWIPE_THRESHOLD && deltaY < SWIPE_THRESHOLD) {
        if (deltaX < 0) {
          callbacks.onSwipeLeft();
        } else {
          callbacks.onSwipeRight();
        }
      }
    }, { passive: true });
  }

  function destroy(): void {
    fab?.remove();
  }

  return {
    isMobile,
    showSwipeHint,
    setupTouchHandling,
    destroy,
  };
}
```

**Step 4: Update index exports**

Add to `src/chatView/index.ts`:
```typescript
export * from './mobileSupport';
```

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/chatView/mobileSupport.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/chatView/mobileSupport.ts src/chatView/index.ts tests/chatView/mobileSupport.test.ts
git commit -m "$(cat <<'EOF'
feat(chatView): extract mobileSupport module

Extract mobile-specific UI into standalone module:
- Floating action button for new conversation
- Touch gesture handling for swipe navigation
- Mobile swipe hint display

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Extract Tab Bar Module

**Files:**
- Create: `src/chatView/tabBar.ts`
- Create: `tests/chatView/tabBar.test.ts`
- Modify: `src/chatView/index.ts`

**Step 1: Write tests for tab bar**

```typescript
// tests/chatView/tabBar.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createTabBar, type TabBarHandle, type TabBarCallbacks, type TabInfo } from '../../src/chatView/tabBar';
import type { ModuleDeps } from '../../src/chatView/types';

vi.mock('obsidian', () => ({
  setIcon: vi.fn(),
  Menu: vi.fn().mockImplementation(() => ({
    addItem: vi.fn().mockReturnThis(),
    showAtMouseEvent: vi.fn(),
  })),
}));

describe('TabBar', () => {
  let container: HTMLElement;
  let deps: ModuleDeps;
  let callbacks: TabBarCallbacks;
  let handle: TabBarHandle;

  beforeEach(() => {
    container = document.createElement('div');
    deps = { app: {} as any, plugin: {} as any };
    callbacks = {
      onTabSelect: vi.fn(),
      onTabClose: vi.fn(),
      onNewTab: vi.fn(),
      onTabRename: vi.fn(),
      getTabs: vi.fn(() => []),
      getActiveTabId: vi.fn(() => null),
      saveState: vi.fn(),
    };
  });

  afterEach(() => {
    handle?.destroy();
  });

  describe('creation', () => {
    it('should create tab bar container', () => {
      handle = createTabBar(container, deps, callbacks);
      expect(container.querySelector('.chat-tab-bar')).not.toBeNull();
    });

    it('should create new tab button', () => {
      handle = createTabBar(container, deps, callbacks);
      expect(container.querySelector('.tab-new-btn')).not.toBeNull();
    });
  });

  describe('rendering tabs', () => {
    it('should render tabs from callback', () => {
      callbacks.getTabs = vi.fn(() => [
        { id: 'tab-1', label: 'Tab 1', conversationId: 'conv-1' },
        { id: 'tab-2', label: 'Tab 2', conversationId: 'conv-2' },
      ]);
      handle = createTabBar(container, deps, callbacks);
      handle.render();
      const tabs = container.querySelectorAll('.chat-tab');
      expect(tabs.length).toBe(2);
    });

    it('should mark active tab', () => {
      callbacks.getTabs = vi.fn(() => [
        { id: 'tab-1', label: 'Tab 1', conversationId: 'conv-1' },
      ]);
      callbacks.getActiveTabId = vi.fn(() => 'tab-1');
      handle = createTabBar(container, deps, callbacks);
      handle.render();
      const activeTab = container.querySelector('.chat-tab.active');
      expect(activeTab).not.toBeNull();
    });
  });

  describe('tab interactions', () => {
    it('should call onTabSelect when tab clicked', () => {
      callbacks.getTabs = vi.fn(() => [
        { id: 'tab-1', label: 'Tab 1', conversationId: 'conv-1' },
      ]);
      handle = createTabBar(container, deps, callbacks);
      handle.render();
      const tab = container.querySelector('.chat-tab') as HTMLElement;
      tab?.click();
      expect(callbacks.onTabSelect).toHaveBeenCalledWith('tab-1');
    });

    it('should call onTabClose when close button clicked', () => {
      callbacks.getTabs = vi.fn(() => [
        { id: 'tab-1', label: 'Tab 1', conversationId: 'conv-1' },
      ]);
      handle = createTabBar(container, deps, callbacks);
      handle.render();
      const closeBtn = container.querySelector('.tab-close-btn') as HTMLElement;
      closeBtn?.click();
      expect(callbacks.onTabClose).toHaveBeenCalledWith('tab-1');
    });

    it('should call onNewTab when new button clicked', () => {
      handle = createTabBar(container, deps, callbacks);
      const newBtn = container.querySelector('.tab-new-btn') as HTMLElement;
      newBtn?.click();
      expect(callbacks.onNewTab).toHaveBeenCalled();
    });
  });

  describe('label updates', () => {
    it('should update tab label', () => {
      callbacks.getTabs = vi.fn(() => [
        { id: 'tab-1', label: 'Original', conversationId: 'conv-1' },
      ]);
      handle = createTabBar(container, deps, callbacks);
      handle.render();
      handle.updateLabel('tab-1', 'Updated');
      const label = container.querySelector('.tab-label');
      expect(label?.textContent).toBe('Updated');
    });
  });

  describe('destruction', () => {
    it('should clean up DOM', () => {
      handle = createTabBar(container, deps, callbacks);
      handle.destroy();
      expect(container.innerHTML).toBe('');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/chatView/tabBar.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Implement tab bar module**

```typescript
// src/chatView/tabBar.ts
/**
 * Tab bar module for ChatView.
 * Manages multi-conversation tabs.
 */
import { setIcon, Menu } from 'obsidian';
import type { ModuleDeps, ModuleHandle } from './types';

export interface TabInfo {
  id: string;
  label: string;
  conversationId: string;
}

export interface TabBarCallbacks {
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onNewTab: () => void;
  onTabRename: (tabId: string, newLabel: string) => void;
  getTabs: () => TabInfo[];
  getActiveTabId: () => string | null;
  saveState: () => void;
}

export interface TabBarHandle extends ModuleHandle {
  render(): void;
  updateLabel(tabId: string, label: string): void;
  setActiveTab(tabId: string): void;
}

export function createTabBar(
  container: HTMLElement,
  deps: ModuleDeps,
  callbacks: TabBarCallbacks
): TabBarHandle {
  // DOM elements
  const tabBar = container.createDiv('chat-tab-bar');
  const tabsContainer = tabBar.createDiv('chat-tabs-container');

  // New tab button
  const newTabBtn = tabBar.createEl('button', {
    cls: 'tab-new-btn',
    attr: { 'aria-label': 'New tab' },
  });
  setIcon(newTabBtn, 'plus');
  newTabBtn.onclick = () => callbacks.onNewTab();

  // Track tab elements for updates
  const tabElements = new Map<string, HTMLElement>();
  const labelElements = new Map<string, HTMLElement>();

  function render(): void {
    tabsContainer.empty();
    tabElements.clear();
    labelElements.clear();

    const tabs = callbacks.getTabs();
    const activeId = callbacks.getActiveTabId();

    for (const tab of tabs) {
      const tabEl = tabsContainer.createDiv('chat-tab');
      tabEl.dataset.tabId = tab.id;

      if (tab.id === activeId) {
        tabEl.addClass('active');
      }

      const labelEl = tabEl.createSpan('tab-label');
      labelEl.textContent = tab.label;
      labelEl.setAttribute('title', tab.label);

      const closeBtn = tabEl.createEl('button', {
        cls: 'tab-close-btn',
        attr: { 'aria-label': 'Close tab' },
      });
      setIcon(closeBtn, 'x');
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        callbacks.onTabClose(tab.id);
      };

      tabEl.onclick = () => callbacks.onTabSelect(tab.id);

      tabEl.oncontextmenu = (e) => {
        e.preventDefault();
        showContextMenu(tab, e);
      };

      tabElements.set(tab.id, tabEl);
      labelElements.set(tab.id, labelEl);
    }
  }

  function showContextMenu(tab: TabInfo, event: MouseEvent): void {
    const menu = new Menu();

    menu.addItem((item) =>
      item
        .setTitle('Rename')
        .setIcon('pencil')
        .onClick(() => {
          const newLabel = prompt('Rename tab:', tab.label);
          if (newLabel && newLabel !== tab.label) {
            callbacks.onTabRename(tab.id, newLabel);
          }
        })
    );

    menu.addItem((item) =>
      item
        .setTitle('Close')
        .setIcon('x')
        .onClick(() => callbacks.onTabClose(tab.id))
    );

    menu.showAtMouseEvent(event);
  }

  function updateLabel(tabId: string, label: string): void {
    const labelEl = labelElements.get(tabId);
    if (labelEl) {
      labelEl.textContent = label;
      labelEl.setAttribute('title', label);
    }
  }

  function setActiveTab(tabId: string): void {
    for (const [id, el] of tabElements) {
      if (id === tabId) {
        el.addClass('active');
      } else {
        el.removeClass('active');
      }
    }
  }

  function destroy(): void {
    tabBar.remove();
  }

  return {
    render,
    updateLabel,
    setActiveTab,
    destroy,
  };
}
```

**Step 4: Update index exports**

Add to `src/chatView/index.ts`:
```typescript
export * from './tabBar';
```

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/chatView/tabBar.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/chatView/tabBar.ts src/chatView/index.ts tests/chatView/tabBar.test.ts
git commit -m "$(cat <<'EOF'
feat(chatView): extract tabBar module

Extract tab management into standalone module:
- Tab rendering with active state
- Tab selection, close, and new tab actions
- Context menu for rename/close
- Label updates for conversation title sync

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Extract Message Renderer Module

**Files:**
- Create: `src/chatView/messageRenderer.ts`
- Create: `tests/chatView/messageRenderer.test.ts`
- Modify: `src/chatView/index.ts`

**Step 1: Write tests for message renderer**

```typescript
// tests/chatView/messageRenderer.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createMessageRenderer, type MessageRendererHandle, type MessageRendererCallbacks } from '../../src/chatView/messageRenderer';
import type { ModuleDeps, ChatMessage, ToolCallInfo } from '../../src/chatView/types';

vi.mock('obsidian', () => ({
  setIcon: vi.fn(),
  MarkdownRenderer: {
    render: vi.fn(),
  },
  Component: vi.fn().mockImplementation(() => ({
    load: vi.fn(),
    unload: vi.fn(),
  })),
}));

describe('MessageRenderer', () => {
  let container: HTMLElement;
  let deps: ModuleDeps;
  let callbacks: MessageRendererCallbacks;
  let handle: MessageRendererHandle;

  beforeEach(() => {
    container = document.createElement('div');
    deps = {
      app: {
        workspace: { getActiveFile: vi.fn(() => null) }
      } as any,
      plugin: {} as any
    };
    callbacks = {
      onCopy: vi.fn(),
      onRegenerate: vi.fn(),
      onEdit: vi.fn(),
      onReact: vi.fn(),
      scrollToBottom: vi.fn(),
    };
  });

  afterEach(() => {
    handle?.destroy();
  });

  describe('creation', () => {
    it('should create renderer', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      expect(handle).toBeDefined();
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
      expect(msgEl?.classList.contains('user')).toBe(true);
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
      expect(msgEl?.classList.contains('assistant')).toBe(true);
    });

    it('should render streaming indicator', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      const msg: ChatMessage = {
        id: 'msg-3',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
      };
      handle.renderMessage(msg);
      const cursor = container.querySelector('.streaming-cursor');
      expect(cursor).not.toBeNull();
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
      // Content update is handled via markdown rendering
      expect(handle.getMessageElement('msg-1')).not.toBeNull();
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
        toolCalls: [{
          name: 'read_file',
          status: 'running',
        }],
      };
      handle.renderMessage(msg);
      const toolEl = container.querySelector('.tool-call');
      expect(toolEl).not.toBeNull();
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

      const toolCalls: ToolCallInfo[] = [{
        name: 'read_file',
        status: 'completed',
        result: 'file contents',
      }];
      handle.updateTools('msg-1', toolCalls);
      // Should have updated tool display
      expect(handle.getMessageElement('msg-1')).not.toBeNull();
    });
  });

  describe('message actions', () => {
    it('should show action buttons on hover', () => {
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
  });

  describe('clearing', () => {
    it('should clear all messages', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      handle.renderMessage({
        id: 'msg-1',
        role: 'user',
        content: 'Test',
        timestamp: Date.now(),
      });
      handle.clear();
      expect(container.innerHTML).toBe('');
    });
  });

  describe('destruction', () => {
    it('should clean up on destroy', () => {
      handle = createMessageRenderer(container, deps, callbacks);
      handle.destroy();
      expect(handle.getMessageElement('msg-1')).toBeNull();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/chatView/messageRenderer.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Implement message renderer module**

```typescript
// src/chatView/messageRenderer.ts
/**
 * Message renderer module for ChatView.
 * Handles message display, tool calls, code blocks, and message actions.
 */
import { setIcon, MarkdownRenderer, Component } from 'obsidian';
import type { ModuleDeps, ModuleHandle, ChatMessage, ToolCallInfo } from './types';

// Tool status icons
const TOOL_STATUS_ICONS: Record<ToolCallInfo['status'], string> = {
  completed: 'check-circle',
  running: 'loader',
  error: 'x-circle',
  pending: 'circle',
};

export interface MessageRendererCallbacks {
  onCopy: (messageId: string) => void;
  onRegenerate: (messageId: string) => void;
  onEdit: (messageId: string) => void;
  onReact: (messageId: string, reaction: string) => void;
  scrollToBottom: () => void;
}

export interface MessageRendererHandle extends ModuleHandle {
  renderMessage(message: ChatMessage): HTMLElement;
  updateContent(messageId: string, content: string): void;
  updateTools(messageId: string, toolCalls: ToolCallInfo[]): void;
  getMessageElement(messageId: string): HTMLElement | null;
  clear(): void;
  showWelcome(welcomeEl: HTMLElement): void;
  addCodeBlockCopyButtons(): void;
}

export function createMessageRenderer(
  container: HTMLElement,
  deps: ModuleDeps,
  callbacks: MessageRendererCallbacks
): MessageRendererHandle {
  const messageElements = new Map<string, HTMLElement>();
  const renderComponents = new Map<string, Component>();

  function renderMessage(message: ChatMessage): HTMLElement {
    const msgEl = container.createDiv({
      cls: `chat-message ${message.role}`,
      attr: { 'data-message-id': message.id },
    });

    // Avatar
    const avatar = msgEl.createDiv('message-avatar');
    if (message.role === 'user') {
      setIcon(avatar, 'user');
    } else {
      setIcon(avatar, 'bot');
    }

    // Content wrapper
    const contentWrapper = msgEl.createDiv('message-content-wrapper');

    // Message content
    const contentEl = contentWrapper.createDiv('message-content');

    if (message.isStreaming && !message.content) {
      // Show streaming cursor
      const cursor = contentEl.createSpan('streaming-cursor');
      cursor.textContent = '▋';
    } else if (message.content) {
      // Render markdown content
      const component = new Component();
      component.load();
      renderComponents.set(message.id, component);

      MarkdownRenderer.render(
        deps.app,
        message.content,
        contentEl,
        deps.app.workspace.getActiveFile()?.path ?? '',
        component
      );
    }

    // Tool calls
    if (message.toolCalls && message.toolCalls.length > 0) {
      const toolsContainer = contentWrapper.createDiv('message-tools');
      renderToolCalls(toolsContainer, message.toolCalls);
    }

    // Message actions (for assistant messages)
    if (message.role === 'assistant' && !message.isStreaming) {
      const actions = contentWrapper.createDiv('message-actions');
      createMessageActions(actions, message.id);
    }

    messageElements.set(message.id, msgEl);
    return msgEl;
  }

  function renderToolCalls(container: HTMLElement, toolCalls: ToolCallInfo[]): void {
    container.empty();

    for (const tool of toolCalls) {
      const toolEl = container.createDiv('tool-call');
      toolEl.addClass(`status-${tool.status}`);

      const header = toolEl.createDiv('tool-call-header');

      const icon = header.createSpan('tool-icon');
      setIcon(icon, TOOL_STATUS_ICONS[tool.status] || 'circle');

      const name = header.createSpan('tool-name');
      name.textContent = tool.name;

      if (tool.status === 'running') {
        icon.addClass('spinning');
      }

      // Show result if completed
      if (tool.status === 'completed' && tool.result) {
        const resultEl = toolEl.createDiv('tool-result');
        const preview = typeof tool.result === 'string'
          ? tool.result.slice(0, 100)
          : JSON.stringify(tool.result).slice(0, 100);
        resultEl.textContent = preview + (preview.length >= 100 ? '...' : '');
      }

      // Show error if failed
      if (tool.status === 'error' && tool.error) {
        const errorEl = toolEl.createDiv('tool-error');
        errorEl.textContent = tool.error;
      }
    }
  }

  function createMessageActions(container: HTMLElement, messageId: string): void {
    const copyBtn = container.createEl('button', {
      cls: 'message-action-btn',
      attr: { 'aria-label': 'Copy' },
    });
    setIcon(copyBtn, 'copy');
    copyBtn.onclick = () => callbacks.onCopy(messageId);

    const regenerateBtn = container.createEl('button', {
      cls: 'message-action-btn',
      attr: { 'aria-label': 'Regenerate' },
    });
    setIcon(regenerateBtn, 'refresh-cw');
    regenerateBtn.onclick = () => callbacks.onRegenerate(messageId);
  }

  function updateContent(messageId: string, content: string): void {
    const msgEl = messageElements.get(messageId);
    if (!msgEl) return;

    const contentEl = msgEl.querySelector('.message-content');
    if (!contentEl) return;

    // Clear existing content
    contentEl.empty();

    // Re-render markdown
    const component = renderComponents.get(messageId) || new Component();
    component.load();
    renderComponents.set(messageId, component);

    MarkdownRenderer.render(
      deps.app,
      content,
      contentEl as HTMLElement,
      deps.app.workspace.getActiveFile()?.path ?? '',
      component
    );

    // Add copy buttons to code blocks
    addCodeBlockCopyButtons();
  }

  function updateTools(messageId: string, toolCalls: ToolCallInfo[]): void {
    const msgEl = messageElements.get(messageId);
    if (!msgEl) return;

    let toolsContainer = msgEl.querySelector('.message-tools') as HTMLElement;
    if (!toolsContainer) {
      const contentWrapper = msgEl.querySelector('.message-content-wrapper');
      if (contentWrapper) {
        toolsContainer = (contentWrapper as HTMLElement).createDiv('message-tools');
      } else {
        return;
      }
    }

    renderToolCalls(toolsContainer, toolCalls);
  }

  function getMessageElement(messageId: string): HTMLElement | null {
    return messageElements.get(messageId) || null;
  }

  function clear(): void {
    container.empty();
    messageElements.clear();
    for (const component of renderComponents.values()) {
      component.unload();
    }
    renderComponents.clear();
  }

  function showWelcome(welcomeEl: HTMLElement): void {
    container.empty();
    container.appendChild(welcomeEl);
  }

  function addCodeBlockCopyButtons(): void {
    const codeBlocks = container.querySelectorAll('pre:not(.has-copy-btn)');

    for (const block of codeBlocks) {
      block.addClass('has-copy-btn');

      const copyBtn = block.createEl('button', {
        cls: 'code-copy-btn',
        attr: { 'aria-label': 'Copy code' },
      });
      setIcon(copyBtn, 'copy');

      copyBtn.onclick = async () => {
        const code = block.querySelector('code');
        if (code) {
          await navigator.clipboard.writeText(code.textContent || '');
          setIcon(copyBtn, 'check');
          setTimeout(() => setIcon(copyBtn, 'copy'), 2000);
        }
      };
    }
  }

  function destroy(): void {
    clear();
  }

  return {
    renderMessage,
    updateContent,
    updateTools,
    getMessageElement,
    clear,
    showWelcome,
    addCodeBlockCopyButtons,
    destroy,
  };
}
```

**Step 4: Update index exports**

Add to `src/chatView/index.ts`:
```typescript
export * from './messageRenderer';
```

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/chatView/messageRenderer.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/chatView/messageRenderer.ts src/chatView/index.ts tests/chatView/messageRenderer.test.ts
git commit -m "$(cat <<'EOF'
feat(chatView): extract messageRenderer module

Extract message rendering into standalone module:
- Message display with markdown rendering
- Tool call visualization with status icons
- Streaming indicator support
- Message action buttons (copy, regenerate)
- Code block copy buttons

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Extract Input Area Module

**Files:**
- Create: `src/chatView/inputArea.ts`
- Create: `tests/chatView/inputArea.test.ts`
- Modify: `src/chatView/index.ts`

**Step 1: Write tests for input area**

```typescript
// tests/chatView/inputArea.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createInputArea, type InputAreaHandle, type InputAreaCallbacks } from '../../src/chatView/inputArea';
import type { ModuleDeps } from '../../src/chatView/types';

vi.mock('obsidian', () => ({
  setIcon: vi.fn(),
}));

describe('InputArea', () => {
  let container: HTMLElement;
  let deps: ModuleDeps;
  let callbacks: InputAreaCallbacks;
  let handle: InputAreaHandle;

  beforeEach(() => {
    container = document.createElement('div');
    deps = { app: {} as any, plugin: {} as any };
    callbacks = {
      onSend: vi.fn(),
      onStop: vi.fn(),
      onVoiceToggle: vi.fn(),
      onImageAdd: vi.fn(),
      onImageRemove: vi.fn(),
      onInputChange: vi.fn(),
      getCommands: vi.fn(() => []),
      isVoiceAvailable: vi.fn(() => true),
    };
  });

  afterEach(() => {
    handle?.destroy();
  });

  describe('creation', () => {
    it('should create input area container', () => {
      handle = createInputArea(container, deps, callbacks);
      expect(container.querySelector('.chat-input-area')).not.toBeNull();
    });

    it('should create textarea', () => {
      handle = createInputArea(container, deps, callbacks);
      expect(container.querySelector('textarea')).not.toBeNull();
    });

    it('should create send button', () => {
      handle = createInputArea(container, deps, callbacks);
      expect(container.querySelector('.chat-send-btn')).not.toBeNull();
    });
  });

  describe('input handling', () => {
    it('should get input value', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.setValue('Hello');
      expect(handle.getValue()).toBe('Hello');
    });

    it('should clear input', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.setValue('Hello');
      handle.clear();
      expect(handle.getValue()).toBe('');
    });

    it('should focus input', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.focus();
      const textarea = container.querySelector('textarea');
      expect(document.activeElement).toBe(textarea);
    });
  });

  describe('sending', () => {
    it('should call onSend when send button clicked', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.setValue('Test message');
      const sendBtn = container.querySelector('.chat-send-btn') as HTMLElement;
      sendBtn?.click();
      expect(callbacks.onSend).toHaveBeenCalledWith('Test message');
    });

    it('should call onSend on Enter key', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.setValue('Test');
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(callbacks.onSend).toHaveBeenCalled();
    });

    it('should not send on Shift+Enter', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.setValue('Test');
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));
      expect(callbacks.onSend).not.toHaveBeenCalled();
    });
  });

  describe('processing state', () => {
    it('should show stop button when processing', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.setProcessing(true);
      const stopBtn = container.querySelector('.chat-stop-btn') as HTMLElement;
      expect(stopBtn?.style.display).not.toBe('none');
    });

    it('should hide send button when processing', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.setProcessing(true);
      const sendBtn = container.querySelector('.chat-send-btn') as HTMLElement;
      expect(sendBtn?.style.display).toBe('none');
    });
  });

  describe('voice input', () => {
    it('should show voice button when available', () => {
      callbacks.isVoiceAvailable = vi.fn(() => true);
      handle = createInputArea(container, deps, callbacks);
      const voiceBtn = container.querySelector('.chat-voice-btn');
      expect(voiceBtn).not.toBeNull();
    });

    it('should hide voice button when unavailable', () => {
      callbacks.isVoiceAvailable = vi.fn(() => false);
      handle = createInputArea(container, deps, callbacks);
      const voiceBtn = container.querySelector('.chat-voice-btn') as HTMLElement;
      expect(voiceBtn?.style.display).toBe('none');
    });

    it('should toggle recording state', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.setRecording(true);
      const voiceBtn = container.querySelector('.chat-voice-btn');
      expect(voiceBtn?.classList.contains('recording')).toBe(true);
    });
  });

  describe('image handling', () => {
    it('should show image preview container', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.addImage({ data: 'base64data', mimeType: 'image/png' });
      const preview = container.querySelector('.chat-image-preview');
      expect(preview?.style.display).not.toBe('none');
    });

    it('should clear images', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.addImage({ data: 'base64data', mimeType: 'image/png' });
      handle.clearImages();
      expect(handle.getImages().length).toBe(0);
    });
  });

  describe('input history', () => {
    it('should navigate history with up arrow', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.addToHistory('First');
      handle.addToHistory('Second');
      handle.navigateHistory('up');
      expect(handle.getValue()).toBe('Second');
    });

    it('should navigate history with down arrow', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.addToHistory('First');
      handle.addToHistory('Second');
      handle.navigateHistory('up');
      handle.navigateHistory('up');
      handle.navigateHistory('down');
      expect(handle.getValue()).toBe('Second');
    });
  });

  describe('destruction', () => {
    it('should clean up DOM', () => {
      handle = createInputArea(container, deps, callbacks);
      handle.destroy();
      expect(container.innerHTML).toBe('');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/chatView/inputArea.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Implement input area module** (large - split into focused sections)

```typescript
// src/chatView/inputArea.ts
/**
 * Input area module for ChatView.
 * Handles text input, voice input, autocomplete, and image attachments.
 */
import { setIcon } from 'obsidian';
import type { ModuleDeps, ModuleHandle } from './types';

const MAX_TEXTAREA_HEIGHT_PX = 180;
const MAX_INPUT_HISTORY_SIZE = 50;

export interface ImageAttachment {
  data: string;
  mimeType: string;
  filename?: string;
}

export interface CommandInfo {
  name: string;
  description: string;
}

export interface InputAreaCallbacks {
  onSend: (content: string) => void;
  onStop: () => void;
  onVoiceToggle: () => void;
  onImageAdd: (image: ImageAttachment) => void;
  onImageRemove: (index: number) => void;
  onInputChange: (value: string) => void;
  getCommands: () => CommandInfo[];
  isVoiceAvailable: () => boolean;
}

export interface InputAreaHandle extends ModuleHandle {
  getValue(): string;
  setValue(value: string): void;
  clear(): void;
  focus(): void;
  setProcessing(processing: boolean): void;
  setRecording(recording: boolean): void;
  addImage(image: ImageAttachment): void;
  clearImages(): void;
  getImages(): ImageAttachment[];
  addToHistory(content: string): void;
  navigateHistory(direction: 'up' | 'down'): void;
  resize(): void;
}

export function createInputArea(
  container: HTMLElement,
  deps: ModuleDeps,
  callbacks: InputAreaCallbacks
): InputAreaHandle {
  // State
  const images: ImageAttachment[] = [];
  const inputHistory: string[] = [];
  let inputHistoryIndex = -1;
  let inputDraft = '';
  let isProcessing = false;

  // DOM elements
  const inputArea = container.createDiv('chat-input-area');
  const inputWrapper = inputArea.createDiv('chat-input-wrapper');

  // Image preview container
  const imagePreview = inputWrapper.createDiv('chat-image-preview');
  imagePreview.style.display = 'none';

  // Textarea
  const textarea = inputWrapper.createEl('textarea', {
    cls: 'chat-input',
    attr: { placeholder: 'Ask Claude anything...' },
  });

  // Event handlers
  textarea.addEventListener('keydown', handleKeydown);
  textarea.addEventListener('input', handleInput);
  textarea.addEventListener('paste', handlePaste);

  // Drag and drop
  inputWrapper.addEventListener('dragover', (e) => {
    e.preventDefault();
    inputWrapper.addClass('drag-over');
  });
  inputWrapper.addEventListener('dragleave', () => {
    inputWrapper.removeClass('drag-over');
  });
  inputWrapper.addEventListener('drop', handleDrop);

  // Button area
  const buttonArea = inputWrapper.createDiv('chat-buttons');

  // Left side: hints
  const leftArea = buttonArea.createDiv('chat-buttons-left');
  const hintEl = leftArea.createSpan('chat-input-hint');
  hintEl.setText('Enter to send · Queue when busy · /help');

  // Stop button (hidden by default)
  const stopButton = buttonArea.createEl('button', { cls: 'chat-stop-btn' });
  setIcon(stopButton, 'circle-stop');
  stopButton.createSpan({ text: 'Stop' });
  stopButton.style.display = 'none';
  stopButton.onclick = () => callbacks.onStop();

  // Voice button
  const voiceButton = buttonArea.createEl('button', {
    cls: 'chat-voice-btn',
    attr: { 'aria-label': 'Voice input' },
  });
  setIcon(voiceButton, 'mic');
  voiceButton.onclick = () => callbacks.onVoiceToggle();
  if (!callbacks.isVoiceAvailable()) {
    voiceButton.style.display = 'none';
  }

  // Send button
  const sendButton = buttonArea.createEl('button', { cls: 'chat-send-btn mod-cta' });
  setIcon(sendButton, 'send');
  sendButton.createSpan({ text: 'Send' });
  sendButton.onclick = handleSend;

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === 'ArrowUp' && textarea.selectionStart === 0) {
      navigateHistory('up');
    } else if (e.key === 'ArrowDown' && textarea.selectionEnd === textarea.value.length) {
      navigateHistory('down');
    }
  }

  function handleInput(): void {
    resize();
    callbacks.onInputChange(textarea.value);
  }

  function handlePaste(e: ClipboardEvent): void {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          handleImageFile(file);
        }
        break;
      }
    }
  }

  function handleDrop(e: DragEvent): void {
    e.preventDefault();
    inputWrapper.removeClass('drag-over');

    const files = e.dataTransfer?.files;
    if (!files) return;

    for (const file of files) {
      if (file.type.startsWith('image/')) {
        handleImageFile(file);
      }
    }
  }

  async function handleImageFile(file: File): Promise<void> {
    const reader = new FileReader();
    reader.onload = () => {
      const data = reader.result as string;
      const image: ImageAttachment = {
        data: data.split(',')[1], // Remove data URL prefix
        mimeType: file.type,
        filename: file.name,
      };
      addImage(image);
      callbacks.onImageAdd(image);
    };
    reader.readAsDataURL(file);
  }

  function handleSend(): void {
    const content = textarea.value.trim();
    if (content || images.length > 0) {
      callbacks.onSend(content);
    }
  }

  function getValue(): string {
    return textarea.value;
  }

  function setValue(value: string): void {
    textarea.value = value;
    resize();
  }

  function clear(): void {
    textarea.value = '';
    resize();
  }

  function focus(): void {
    textarea.focus();
  }

  function setProcessing(processing: boolean): void {
    isProcessing = processing;
    inputWrapper.toggleClass('processing', processing);
    sendButton.style.display = processing ? 'none' : 'flex';
    stopButton.style.display = processing ? 'flex' : 'none';
    textarea.disabled = processing;
  }

  function setRecording(recording: boolean): void {
    voiceButton.toggleClass('recording', recording);
    if (recording) {
      setIcon(voiceButton, 'mic-off');
    } else {
      setIcon(voiceButton, 'mic');
    }
  }

  function addImage(image: ImageAttachment): void {
    images.push(image);
    renderImagePreviews();
  }

  function clearImages(): void {
    images.length = 0;
    renderImagePreviews();
  }

  function getImages(): ImageAttachment[] {
    return [...images];
  }

  function renderImagePreviews(): void {
    imagePreview.empty();

    if (images.length === 0) {
      imagePreview.style.display = 'none';
      return;
    }

    imagePreview.style.display = 'flex';

    images.forEach((img, index) => {
      const wrapper = imagePreview.createDiv('image-preview-item');
      const imgEl = wrapper.createEl('img');
      imgEl.src = `data:${img.mimeType};base64,${img.data}`;

      const removeBtn = wrapper.createEl('button', {
        cls: 'image-remove-btn',
        attr: { 'aria-label': 'Remove image' },
      });
      setIcon(removeBtn, 'x');
      removeBtn.onclick = () => {
        images.splice(index, 1);
        callbacks.onImageRemove(index);
        renderImagePreviews();
      };
    });
  }

  function addToHistory(content: string): void {
    if (inputHistory.length === 0 || inputHistory[inputHistory.length - 1] !== content) {
      inputHistory.push(content);
      if (inputHistory.length > MAX_INPUT_HISTORY_SIZE) {
        inputHistory.shift();
      }
    }
    inputHistoryIndex = -1;
    inputDraft = '';
  }

  function navigateHistory(direction: 'up' | 'down'): void {
    if (inputHistory.length === 0) return;

    if (inputHistoryIndex === -1) {
      inputDraft = textarea.value;
    }

    if (direction === 'up') {
      if (inputHistoryIndex < inputHistory.length - 1) {
        inputHistoryIndex++;
        textarea.value = inputHistory[inputHistory.length - 1 - inputHistoryIndex];
      }
    } else {
      if (inputHistoryIndex > 0) {
        inputHistoryIndex--;
        textarea.value = inputHistory[inputHistory.length - 1 - inputHistoryIndex];
      } else if (inputHistoryIndex === 0) {
        inputHistoryIndex = -1;
        textarea.value = inputDraft;
      }
    }
  }

  function resize(): void {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT_PX) + 'px';
  }

  function destroy(): void {
    inputArea.remove();
  }

  return {
    getValue,
    setValue,
    clear,
    focus,
    setProcessing,
    setRecording,
    addImage,
    clearImages,
    getImages,
    addToHistory,
    navigateHistory,
    resize,
    destroy,
  };
}
```

**Step 4: Update index exports**

Add to `src/chatView/index.ts`:
```typescript
export * from './inputArea';
```

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/chatView/inputArea.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/chatView/inputArea.ts src/chatView/index.ts tests/chatView/inputArea.test.ts
git commit -m "$(cat <<'EOF'
feat(chatView): extract inputArea module

Extract input handling into standalone module:
- Textarea with auto-resize
- Send/stop button states
- Voice input toggle
- Image paste and drag-drop
- Input history navigation
- Processing state management

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Extract History Panel Module

**Files:**
- Create: `src/chatView/historyPanel.ts`
- Create: `tests/chatView/historyPanel.test.ts`
- Modify: `src/chatView/index.ts`

**Step 1: Write tests for history panel**

```typescript
// tests/chatView/historyPanel.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createHistoryPanel, type HistoryPanelHandle, type HistoryPanelCallbacks } from '../../src/chatView/historyPanel';
import type { ModuleDeps, ConversationMeta } from '../../src/chatView/types';

vi.mock('obsidian', () => ({
  setIcon: vi.fn(),
  Menu: vi.fn().mockImplementation(() => ({
    addItem: vi.fn().mockReturnThis(),
    addSeparator: vi.fn().mockReturnThis(),
    showAtMouseEvent: vi.fn(),
  })),
}));

describe('HistoryPanel', () => {
  let container: HTMLElement;
  let deps: ModuleDeps;
  let callbacks: HistoryPanelCallbacks;
  let handle: HistoryPanelHandle;

  const mockConversations: ConversationMeta[] = [
    { id: 'conv-1', title: 'First Chat', messageCount: 5, createdAt: 1000, updatedAt: 2000 },
    { id: 'conv-2', title: 'Second Chat', messageCount: 3, createdAt: 500, updatedAt: 1500, pinned: true },
    { id: 'conv-3', title: 'Tagged Chat', messageCount: 2, createdAt: 100, updatedAt: 500, tags: ['work'] },
  ];

  beforeEach(() => {
    container = document.createElement('div');
    deps = { app: {} as any, plugin: {} as any };
    callbacks = {
      onSelect: vi.fn(),
      onDelete: vi.fn(),
      onDeleteBulk: vi.fn(),
      onDuplicate: vi.fn(),
      onRename: vi.fn(),
      onTogglePin: vi.fn(),
      onManageTags: vi.fn(),
      onContinue: vi.fn(),
      getConversations: vi.fn(() => Promise.resolve(mockConversations)),
      getAllTags: vi.fn(() => Promise.resolve(['work', 'personal'])),
      getCurrentId: vi.fn(() => 'conv-1'),
      showStatus: vi.fn(),
    };
  });

  afterEach(() => {
    handle?.destroy();
  });

  describe('creation', () => {
    it('should create history panel container', () => {
      handle = createHistoryPanel(container, deps, callbacks);
      expect(container.querySelector('.chat-history-panel')).not.toBeNull();
    });

    it('should be hidden by default', () => {
      handle = createHistoryPanel(container, deps, callbacks);
      expect(handle.isVisible()).toBe(false);
    });
  });

  describe('visibility', () => {
    it('should show panel', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();
      expect(handle.isVisible()).toBe(true);
    });

    it('should hide panel', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();
      handle.hide();
      expect(handle.isVisible()).toBe(false);
    });

    it('should toggle visibility', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.toggle();
      expect(handle.isVisible()).toBe(true);
      await handle.toggle();
      expect(handle.isVisible()).toBe(false);
    });

    it('should load conversations on show', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();
      expect(callbacks.getConversations).toHaveBeenCalled();
    });
  });

  describe('conversation list', () => {
    it('should render conversations', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();
      const items = container.querySelectorAll('.history-item');
      expect(items.length).toBe(3);
    });

    it('should mark pinned conversations', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();
      const pinnedItems = container.querySelectorAll('.history-item.pinned');
      expect(pinnedItems.length).toBe(1);
    });

    it('should mark current conversation', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();
      const currentItem = container.querySelector('.history-item.current');
      expect(currentItem?.getAttribute('data-id')).toBe('conv-1');
    });
  });

  describe('search', () => {
    it('should filter conversations by search', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();

      const searchInput = container.querySelector('.history-search-input') as HTMLInputElement;
      searchInput.value = 'First';
      searchInput.dispatchEvent(new Event('input'));

      // Wait for re-render
      await new Promise(r => setTimeout(r, 0));

      const visibleItems = container.querySelectorAll('.history-item:not([style*="display: none"])');
      expect(visibleItems.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('tag filtering', () => {
    it('should show tags bar', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();
      expect(container.querySelector('.history-tags-bar')).not.toBeNull();
    });

    it('should filter by tag when clicked', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();

      const tagBtn = container.querySelector('.history-tag-btn') as HTMLElement;
      tagBtn?.click();

      await handle.refresh();
      // Should filter to show only tagged items
    });
  });

  describe('bulk selection', () => {
    it('should toggle bulk select mode', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();

      const bulkBtn = container.querySelector('[aria-label="Select multiple"]') as HTMLElement;
      bulkBtn?.click();

      expect(container.querySelector('.history-bulk-actions')?.style.display).not.toBe('none');
    });
  });

  describe('actions', () => {
    it('should call onSelect when item clicked', async () => {
      handle = createHistoryPanel(container, deps, callbacks);
      await handle.show();

      const item = container.querySelector('.history-item') as HTMLElement;
      item?.click();

      expect(callbacks.onSelect).toHaveBeenCalled();
    });
  });

  describe('destruction', () => {
    it('should clean up DOM', () => {
      handle = createHistoryPanel(container, deps, callbacks);
      handle.destroy();
      expect(container.innerHTML).toBe('');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/chatView/historyPanel.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Implement history panel module** (largest module - 474 lines from previous attempt)

```typescript
// src/chatView/historyPanel.ts
/**
 * History panel module for ChatView.
 * Manages conversation list, search, tags, and bulk operations.
 */
import { setIcon, Menu } from 'obsidian';
import type { ModuleDeps, ModuleHandle, ConversationMeta } from './types';

export interface HistoryPanelState {
  visible: boolean;
  filterTag: string | null;
  searchQuery: string;
  bulkSelectMode: boolean;
  selectedIds: Set<string>;
}

export interface HistoryPanelCallbacks {
  onSelect: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onDeleteBulk: (ids: string[]) => Promise<void>;
  onDuplicate: (id: string) => Promise<void>;
  onRename: (id: string, title: string) => Promise<void>;
  onTogglePin: (id: string) => Promise<void>;
  onManageTags: (id: string, tags: string[]) => void;
  onContinue: (id: string) => Promise<void>;
  getConversations: () => Promise<ConversationMeta[]>;
  getAllTags: () => Promise<string[]>;
  getCurrentId: () => string;
  showStatus: (msg: string, type: 'info' | 'error' | 'success') => void;
}

export interface HistoryPanelHandle extends ModuleHandle {
  show(): Promise<void>;
  hide(): void;
  toggle(): Promise<void>;
  refresh(): Promise<void>;
  isVisible(): boolean;
}

export function createHistoryPanel(
  container: HTMLElement,
  deps: ModuleDeps,
  callbacks: HistoryPanelCallbacks
): HistoryPanelHandle {
  // Internal state
  const state: HistoryPanelState = {
    visible: false,
    filterTag: null,
    searchQuery: '',
    bulkSelectMode: false,
    selectedIds: new Set(),
  };

  // DOM elements
  const panel = container.createDiv('chat-history-panel');
  panel.style.display = 'none';

  let historyList: HTMLElement;
  let tagsBar: HTMLElement;
  let bulkActionsBar: HTMLElement;
  let searchInput: HTMLInputElement;

  // Build UI
  buildPanel();

  function buildPanel(): void {
    const header = panel.createDiv('history-header');
    header.createEl('h4', { text: 'Conversations' });

    const headerActions = header.createDiv('history-header-actions');

    // Bulk select toggle
    const bulkSelectBtn = headerActions.createEl('button', {
      cls: 'chat-action-btn',
      attr: { 'aria-label': 'Select multiple' },
    });
    setIcon(bulkSelectBtn, 'list-checks');
    bulkSelectBtn.onclick = () => toggleBulkSelectMode();

    const closeBtn = headerActions.createEl('button', {
      cls: 'chat-action-btn',
      attr: { 'aria-label': 'Close history' },
    });
    setIcon(closeBtn, 'x');
    closeBtn.onclick = () => hide();

    // Bulk actions bar (hidden by default)
    bulkActionsBar = panel.createDiv('history-bulk-actions');
    bulkActionsBar.style.display = 'none';
    buildBulkActionsBar();

    // Search bar
    const searchBar = panel.createDiv('history-search-bar');
    searchInput = searchBar.createEl('input', {
      cls: 'history-search-input',
      attr: { type: 'text', placeholder: 'Search conversations...' },
    });
    searchInput.addEventListener('input', () => {
      state.searchQuery = searchInput.value;
      filterList();
    });

    // Tags bar
    tagsBar = panel.createDiv('history-tags-bar');

    // History list
    historyList = panel.createDiv('history-list');
  }

  function buildBulkActionsBar(): void {
    const selectAllBtn = bulkActionsBar.createEl('button', {
      cls: 'bulk-action-btn',
      text: 'Select All',
    });
    selectAllBtn.onclick = selectAll;

    const deselectBtn = bulkActionsBar.createEl('button', {
      cls: 'bulk-action-btn',
      text: 'Deselect',
    });
    deselectBtn.onclick = deselectAll;

    const deleteBtn = bulkActionsBar.createEl('button', {
      cls: 'bulk-action-btn mod-warning',
      text: 'Delete Selected',
    });
    deleteBtn.onclick = deleteSelected;

    const countSpan = bulkActionsBar.createSpan('bulk-count');
    countSpan.textContent = '0 selected';
  }

  function toggleBulkSelectMode(): void {
    state.bulkSelectMode = !state.bulkSelectMode;
    state.selectedIds.clear();
    bulkActionsBar.style.display = state.bulkSelectMode ? 'flex' : 'none';
    refresh();
  }

  function selectAll(): void {
    const items = historyList.querySelectorAll('.history-item');
    items.forEach((item) => {
      const id = item.getAttribute('data-id');
      if (id) state.selectedIds.add(id);
    });
    updateBulkCount();
    refresh();
  }

  function deselectAll(): void {
    state.selectedIds.clear();
    updateBulkCount();
    refresh();
  }

  async function deleteSelected(): Promise<void> {
    if (state.selectedIds.size === 0) return;

    const ids = Array.from(state.selectedIds);
    await callbacks.onDeleteBulk(ids);
    state.selectedIds.clear();
    updateBulkCount();
    await refresh();
  }

  function updateBulkCount(): void {
    const countSpan = bulkActionsBar.querySelector('.bulk-count');
    if (countSpan) {
      countSpan.textContent = `${state.selectedIds.size} selected`;
    }
  }

  async function renderTags(): Promise<void> {
    tagsBar.empty();

    const tags = await callbacks.getAllTags();
    if (tags.length === 0) {
      tagsBar.style.display = 'none';
      return;
    }

    tagsBar.style.display = 'flex';

    // All button
    const allBtn = tagsBar.createEl('button', {
      cls: `history-tag-btn ${state.filterTag === null ? 'active' : ''}`,
      text: 'All',
    });
    allBtn.onclick = () => {
      state.filterTag = null;
      refresh();
    };

    // Tag buttons
    for (const tag of tags) {
      const btn = tagsBar.createEl('button', {
        cls: `history-tag-btn ${state.filterTag === tag ? 'active' : ''}`,
        text: tag,
      });
      btn.onclick = () => {
        state.filterTag = tag;
        refresh();
      };
    }
  }

  async function renderList(): Promise<void> {
    historyList.empty();

    const conversations = await callbacks.getConversations();
    const currentId = callbacks.getCurrentId();

    // Sort: pinned first, then by updatedAt
    const sorted = [...conversations].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.updatedAt - a.updatedAt;
    });

    // Filter by tag
    const filtered = state.filterTag
      ? sorted.filter((c) => c.tags?.includes(state.filterTag!))
      : sorted;

    for (const conv of filtered) {
      const item = historyList.createDiv({
        cls: 'history-item',
        attr: { 'data-id': conv.id },
      });

      if (conv.id === currentId) {
        item.addClass('current');
      }
      if (conv.pinned) {
        item.addClass('pinned');
      }
      if (state.selectedIds.has(conv.id)) {
        item.addClass('selected');
      }

      // Checkbox for bulk select
      if (state.bulkSelectMode) {
        const checkbox = item.createEl('input', {
          cls: 'history-checkbox',
          attr: { type: 'checkbox' },
        });
        (checkbox as HTMLInputElement).checked = state.selectedIds.has(conv.id);
        checkbox.onclick = (e) => {
          e.stopPropagation();
          if (state.selectedIds.has(conv.id)) {
            state.selectedIds.delete(conv.id);
            item.removeClass('selected');
          } else {
            state.selectedIds.add(conv.id);
            item.addClass('selected');
          }
          updateBulkCount();
        };
      }

      // Pin indicator
      if (conv.pinned) {
        const pinIcon = item.createSpan('history-pin-icon');
        setIcon(pinIcon, 'pin');
      }

      // Title and preview
      const content = item.createDiv('history-item-content');
      const title = content.createDiv('history-item-title');
      title.textContent = conv.title;

      const meta = content.createDiv('history-item-meta');
      meta.textContent = `${conv.messageCount} messages · ${formatDate(conv.updatedAt)}`;

      // Tags
      if (conv.tags && conv.tags.length > 0) {
        const tagsEl = content.createDiv('history-item-tags');
        for (const tag of conv.tags) {
          tagsEl.createSpan({ cls: 'history-item-tag', text: tag });
        }
      }

      // Click handler
      item.onclick = async () => {
        if (state.bulkSelectMode) return;
        await callbacks.onSelect(conv.id);
        hide();
      };

      // Context menu
      item.oncontextmenu = (e) => {
        e.preventDefault();
        showContextMenu(conv, e);
      };
    }

    filterList();
  }

  function filterList(): void {
    const query = state.searchQuery.toLowerCase();
    const items = historyList.querySelectorAll('.history-item');

    items.forEach((item) => {
      const title = item.querySelector('.history-item-title')?.textContent?.toLowerCase() || '';
      const match = query === '' || title.includes(query);
      (item as HTMLElement).style.display = match ? 'flex' : 'none';
    });
  }

  function showContextMenu(conv: ConversationMeta, event: MouseEvent): void {
    const menu = new Menu();

    menu.addItem((item) =>
      item
        .setTitle(conv.pinned ? 'Unpin' : 'Pin')
        .setIcon('pin')
        .onClick(() => callbacks.onTogglePin(conv.id))
    );

    menu.addItem((item) =>
      item
        .setTitle('Rename')
        .setIcon('pencil')
        .onClick(async () => {
          const newTitle = prompt('Rename conversation:', conv.title);
          if (newTitle && newTitle !== conv.title) {
            await callbacks.onRename(conv.id, newTitle);
            await refresh();
          }
        })
    );

    menu.addItem((item) =>
      item
        .setTitle('Duplicate')
        .setIcon('copy')
        .onClick(() => callbacks.onDuplicate(conv.id))
    );

    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle('Delete')
        .setIcon('trash-2')
        .onClick(async () => {
          await callbacks.onDelete(conv.id);
          await refresh();
        })
    );

    menu.showAtMouseEvent(event);
  }

  function formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return 'Today';
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return `${days} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  }

  async function show(): Promise<void> {
    state.visible = true;
    panel.style.display = 'block';
    await refresh();
  }

  function hide(): void {
    state.visible = false;
    panel.style.display = 'none';
  }

  async function toggle(): Promise<void> {
    if (state.visible) {
      hide();
    } else {
      await show();
    }
  }

  async function refresh(): Promise<void> {
    await renderTags();
    await renderList();
  }

  function isVisible(): boolean {
    return state.visible;
  }

  function destroy(): void {
    panel.remove();
  }

  return {
    show,
    hide,
    toggle,
    refresh,
    isVisible,
    destroy,
  };
}
```

**Step 4: Update index exports**

Add to `src/chatView/index.ts`:
```typescript
export * from './historyPanel';
```

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/chatView/historyPanel.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/chatView/historyPanel.ts src/chatView/index.ts tests/chatView/historyPanel.test.ts
git commit -m "$(cat <<'EOF'
feat(chatView): extract historyPanel module

Extract conversation history into standalone module:
- Conversation list with pinned/current indicators
- Search and tag filtering
- Bulk selection and deletion
- Context menu actions (pin, rename, duplicate, delete)
- Relative date formatting

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Integrate Modules into ChatView

**Files:**
- Modify: `src/chatView.ts`

**Step 1: Run all module tests**

Run: `npm test -- tests/chatView/`
Expected: All PASS

**Step 2: Update ChatView to use extracted modules**

This is a gradual replacement. Start by importing and using one module at a time, verifying the app still works after each integration.

**Step 2a: Import modules**

Add to top of `src/chatView.ts`:
```typescript
import {
  createSearchBar,
  createQueuePanel,
  createStatusBar,
  createMobileSupport,
  createTabBar,
  createMessageRenderer,
  createInputArea,
  createHistoryPanel,
  type SearchBarHandle,
  type QueuePanelHandle,
  type StatusBarHandle,
  type MobileSupportHandle,
  type TabBarHandle,
  type MessageRendererHandle,
  type InputAreaHandle,
  type HistoryPanelHandle,
} from './chatView/index';
```

**Step 2b: Add module handles to class**

Add to ChatView class properties:
```typescript
// Module handles
private searchBarModule: SearchBarHandle | null = null;
private queueModule: QueuePanelHandle | null = null;
private statusModule: StatusBarHandle | null = null;
private mobileModule: MobileSupportHandle | null = null;
private tabModule: TabBarHandle | null = null;
private messageModule: MessageRendererHandle | null = null;
private inputModule: InputAreaHandle | null = null;
private historyModule: HistoryPanelHandle | null = null;
```

**Step 2c: Initialize modules in onOpen()**

Replace inline UI creation with module initialization. Do this one module at a time, testing after each:

```typescript
// Example: Replace search bar creation
// OLD: this.createSearchBar(this.searchContainer);
// NEW:
this.searchBarModule = createSearchBar(this.searchContainer,
  { app: this.plugin.app, plugin: this.plugin },
  {
    getMessageIds: () => this.conversation.messages.map(m => m.id),
    getMessageContent: (id) => this.conversation.messages.find(m => m.id === id)?.content ?? '',
    scrollToMessage: (id) => this.scrollToMessage(id),
    highlightMessage: (id) => this.highlightMessage(id),
    clearHighlights: () => this.clearSearchHighlights(),
  }
);
```

**Step 2d: Update method calls to use modules**

Replace internal method calls with module method calls:
```typescript
// OLD: this.refreshHistoryList();
// NEW: await this.historyModule?.refresh();

// OLD: this.updateTokenCounter();
// NEW: this.statusModule?.updateTokens(this.getTokenEstimate());
```

**Step 2e: Clean up in onClose()**

Add module destruction:
```typescript
async onClose(): Promise<void> {
  this.searchBarModule?.destroy();
  this.queueModule?.destroy();
  this.statusModule?.destroy();
  this.mobileModule?.destroy();
  this.tabModule?.destroy();
  this.messageModule?.destroy();
  this.inputModule?.destroy();
  this.historyModule?.destroy();
  // ... existing cleanup
}
```

**Step 3: Run application to verify integration**

Test in Obsidian:
1. Open chat view
2. Send a message
3. Open history panel
4. Search messages
5. Use tabs
6. Test on mobile (if available)

**Step 4: Remove dead code**

After verifying all modules work, remove the now-unused methods from ChatView that have been replaced by modules.

**Step 5: Run all tests**

Run: `npm test`
Expected: All PASS

**Step 6: Commit**

```bash
git add src/chatView.ts src/chatView/index.ts
git commit -m "$(cat <<'EOF'
refactor(chatView): integrate extracted modules

Replace inline UI creation with modular components:
- searchBarModule for message search
- queueModule for message queue display
- statusModule for badges and token counter
- mobileModule for mobile-specific UI
- tabModule for conversation tabs
- messageModule for message rendering
- inputModule for input handling
- historyModule for conversation history

Reduces chatView.ts by ~2000 lines while maintaining all functionality.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Final Cleanup and Documentation

**Files:**
- Modify: `src/chatView.ts` (remove remaining dead code)
- Modify: `src/chatView/index.ts` (verify exports)

**Step 1: Remove all unused private methods**

Search for methods that are now delegated to modules and remove them from ChatView.

**Step 2: Update remaining inline methods to use modules**

Ensure all UI interactions go through module handles.

**Step 3: Run final test suite**

Run: `npm test`
Expected: All PASS

**Step 4: Run linting**

Run: `npm run lint` (if available)
Expected: No errors

**Step 5: Build verification**

Run: `npm run build`
Expected: Build succeeds

**Step 6: Final commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(chatView): complete module extraction

Final cleanup after chatView modularization:
- Remove unused private methods
- Ensure consistent module delegation
- Verify all tests pass

ChatView reduced from 5,425 to ~2,500 lines.
Each module is independently testable.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Summary

This plan extracts the 5,425-line monolithic `chatView.ts` into 8 focused modules:

| Module | Lines | Responsibility |
|--------|-------|----------------|
| types.ts | ~50 | Shared interfaces |
| searchBar.ts | ~150 | Message search |
| queuePanel.ts | ~100 | Message queue display |
| statusBar.ts | ~150 | Badges and token counter |
| mobileSupport.ts | ~100 | Touch gestures, FAB |
| tabBar.ts | ~150 | Conversation tabs |
| messageRenderer.ts | ~300 | Message display |
| inputArea.ts | ~250 | Input handling |
| historyPanel.ts | ~400 | Conversation history |

**Key improvements:**
- Each module has tests before implementation (TDD)
- Clear callback interfaces for parent communication
- Independent testability
- Incremental commits for safe rollback
- ~50% reduction in main file size
